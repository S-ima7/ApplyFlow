import {
  EmailAutomationJobStatus,
  Prisma
} from "@prisma/client";
import { getEmailMonitorDailyTokenBudget } from "@/features/email-monitor/constants";
import { prisma } from "@/lib/prisma";

const AI_BUDGET_PROVIDER = "groq";
export const AI_TOKEN_RESERVATION_PER_REQUEST = 20_000;

export async function reserveAiTokenBudget(
  jobId: string,
  now: Date,
  requestedTokens = AI_TOKEN_RESERVATION_PER_REQUEST
) {
  const normalizedRequestedTokens = normalizeRequestedTokens(requestedTokens);
  const dailyBudget = getEmailMonitorDailyTokenBudget();
  if (
    normalizedRequestedTokens === null ||
    normalizedRequestedTokens > dailyBudget
  ) {
    return false;
  }

  return withSerializableRetry(async (tx) => {
    const identity = await tx.emailAutomationJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { userId: true }
    });
    const [monitorConfig] = await tx.$queryRaw<
      Array<{ enabled: boolean; consentedAt: Date | null }>
    >`
      SELECT "enabled", "consentedAt"
      FROM "EmailMonitorConfig"
      WHERE "userId" = ${identity.userId}
      FOR UPDATE
    `;
    const [job] = await tx.$queryRaw<
      Array<{
        status: EmailAutomationJobStatus;
        aiReservedTokens: number;
        aiReservationDate: string | null;
      }>
    >`
      SELECT "status", "aiReservedTokens", "aiReservationDate"
      FROM "EmailAutomationJob"
      WHERE "id" = ${jobId}
      FOR UPDATE
    `;
    if (
      !job ||
      job.status !== EmailAutomationJobStatus.PROCESSING ||
      !monitorConfig?.enabled ||
      !monitorConfig.consentedAt
    ) {
      return false;
    }

    if (job.aiReservedTokens > 0 && job.aiReservationDate) {
      await consumeReservation(tx, {
        jobId,
        usageDate: job.aiReservationDate,
        reservedTokens: job.aiReservedTokens,
        chargedTokens: job.aiReservedTokens
      });
    }

    const usageDate = toUtcUsageDate(now);
    const usage = await tx.aiDailyUsage.upsert({
      where: {
        provider_usageDate: {
          provider: AI_BUDGET_PROVIDER,
          usageDate
        }
      },
      create: {
        provider: AI_BUDGET_PROVIDER,
        usageDate
      },
      update: {}
    });
    if (
      !canReserveAiTokens(
        usage.usedTokens,
        usage.reservedTokens,
        dailyBudget,
        normalizedRequestedTokens
      )
    ) {
      return false;
    }

    await tx.aiDailyUsage.update({
      where: {
        provider_usageDate: {
          provider: AI_BUDGET_PROVIDER,
          usageDate
        }
      },
      data: {
        reservedTokens: {
          increment: normalizedRequestedTokens
        }
      }
    });
    await tx.emailAutomationJob.update({
      where: { id: jobId },
      data: {
        aiReservedTokens: normalizedRequestedTokens,
        aiReservationDate: usageDate
      }
    });
    return true;
  });
}

export async function settleAiTokenBudget(
  tx: Prisma.TransactionClient,
  jobId: string,
  actualTokens: number
) {
  const job = await lockTokenReservation(tx, jobId);
  if (job.aiReservedTokens <= 0 || !job.aiReservationDate) return;

  await consumeReservation(tx, {
    jobId,
    usageDate: job.aiReservationDate,
    reservedTokens: job.aiReservedTokens,
    chargedTokens: Math.max(0, Math.trunc(actualTokens))
  });
}

export async function consumeAiTokenReservationAsUsed(jobId: string) {
  await prisma.$transaction(async (tx) => {
    await consumeAiTokenReservationAsUsedInTransaction(tx, jobId);
  });
}

export async function consumeAiTokenReservationAsUsedInTransaction(
  tx: Prisma.TransactionClient,
  jobId: string
) {
  const job = await lockTokenReservation(tx, jobId);
  if (job.aiReservedTokens <= 0 || !job.aiReservationDate) return;

  await consumeReservation(tx, {
    jobId,
    usageDate: job.aiReservationDate,
    reservedTokens: job.aiReservedTokens,
    chargedTokens: job.aiReservedTokens
  });
}

async function lockTokenReservation(
  tx: Prisma.TransactionClient,
  jobId: string
) {
  const [job] = await tx.$queryRaw<
    Array<{
      aiReservedTokens: number;
      aiReservationDate: string | null;
    }>
  >`
    SELECT "aiReservedTokens", "aiReservationDate"
    FROM "EmailAutomationJob"
    WHERE "id" = ${jobId}
    FOR UPDATE
  `;
  if (!job) throw new Error("Email automation job was not found");
  return job;
}

async function consumeReservation(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string;
    usageDate: string;
    reservedTokens: number;
    chargedTokens: number;
  }
) {
  await tx.aiDailyUsage.upsert({
    where: {
      provider_usageDate: {
        provider: AI_BUDGET_PROVIDER,
        usageDate: input.usageDate
      }
    },
    create: {
      provider: AI_BUDGET_PROVIDER,
      usageDate: input.usageDate,
      reservedTokens: input.reservedTokens
    },
    update: {}
  });
  await tx.$executeRaw`
    UPDATE "AiDailyUsage"
    SET
      "reservedTokens" = GREATEST(0, "reservedTokens" - ${input.reservedTokens}),
      "usedTokens" = "usedTokens" + ${input.chargedTokens},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "provider" = ${AI_BUDGET_PROVIDER}
      AND "usageDate" = ${input.usageDate}
  `;
  await tx.emailAutomationJob.update({
    where: { id: input.jobId },
    data: {
      aiReservedTokens: 0,
      aiReservationDate: null
    }
  });
}

async function withSerializableRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
    }
  }
  throw new Error("AI token budget transaction failed");
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

export function toUtcUsageDate(now: Date) {
  return now.toISOString().slice(0, 10);
}

export function canReserveAiTokens(
  usedTokens: number,
  reservedTokens: number,
  dailyBudget: number,
  requestedTokens = AI_TOKEN_RESERVATION_PER_REQUEST
) {
  return usedTokens + reservedTokens + requestedTokens <= dailyBudget;
}

function normalizeRequestedTokens(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}
