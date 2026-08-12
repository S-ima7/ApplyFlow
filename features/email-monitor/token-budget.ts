import {
  EmailAutomationJobStatus,
  Prisma
} from "@prisma/client";
import { getEmailMonitorDailyNeuronBudget } from "@/features/email-monitor/constants";
import { AI_PROVIDER } from "@/lib/ai/responses";
import { prisma } from "@/lib/prisma";

export const AI_NEURON_RESERVATION_PER_REQUEST = 1_500;

export async function reserveAiNeuronBudget(
  jobId: string,
  now: Date,
  requestedNeurons = AI_NEURON_RESERVATION_PER_REQUEST
) {
  const normalizedRequestedNeurons = normalizeRequestedNeurons(
    requestedNeurons
  );
  const dailyBudget = getEmailMonitorDailyNeuronBudget();
  if (
    normalizedRequestedNeurons === null ||
    normalizedRequestedNeurons > dailyBudget
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
        aiReservedNeurons: number;
        aiNeuronReservationDate: string | null;
      }>
    >`
      SELECT "status", "aiReservedNeurons", "aiNeuronReservationDate"
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

    if (job.aiReservedNeurons > 0 && job.aiNeuronReservationDate) {
      await consumeReservation(tx, {
        jobId,
        usageDate: job.aiNeuronReservationDate,
        reservedNeurons: job.aiReservedNeurons,
        chargedNeurons: job.aiReservedNeurons
      });
    }

    const usageDate = toUtcUsageDate(now);
    const usage = await tx.aiDailyUsage.upsert({
      where: {
        provider_usageDate: {
          provider: AI_PROVIDER,
          usageDate
        }
      },
      create: {
        provider: AI_PROVIDER,
        usageDate
      },
      update: {}
    });
    if (
      !canReserveAiNeurons(
        usage.usedNeurons,
        usage.reservedNeurons,
        dailyBudget,
        normalizedRequestedNeurons
      )
    ) {
      return false;
    }

    await tx.aiDailyUsage.update({
      where: {
        provider_usageDate: {
          provider: AI_PROVIDER,
          usageDate
        }
      },
      data: {
        reservedNeurons: {
          increment: normalizedRequestedNeurons
        }
      }
    });
    await tx.emailAutomationJob.update({
      where: { id: jobId },
      data: {
        aiReservedNeurons: normalizedRequestedNeurons,
        aiNeuronReservationDate: usageDate
      }
    });
    return true;
  });
}

export async function settleAiNeuronBudget(
  tx: Prisma.TransactionClient,
  jobId: string,
  actualNeurons: number | null
) {
  const job = await lockNeuronReservation(tx, jobId);
  if (job.aiReservedNeurons <= 0 || !job.aiNeuronReservationDate) return;

  await consumeReservation(tx, {
    jobId,
    usageDate: job.aiNeuronReservationDate,
    reservedNeurons: job.aiReservedNeurons,
    chargedNeurons:
      actualNeurons === null
        ? job.aiReservedNeurons
        : Math.max(0, Math.ceil(actualNeurons))
  });
}

export async function consumeAiNeuronReservationAsUsed(jobId: string) {
  await prisma.$transaction(async (tx) => {
    await consumeAiNeuronReservationAsUsedInTransaction(tx, jobId);
  });
}

export async function consumeAiNeuronReservationAsUsedInTransaction(
  tx: Prisma.TransactionClient,
  jobId: string
) {
  const job = await lockNeuronReservation(tx, jobId);
  if (job.aiReservedNeurons <= 0 || !job.aiNeuronReservationDate) return;

  await consumeReservation(tx, {
    jobId,
    usageDate: job.aiNeuronReservationDate,
    reservedNeurons: job.aiReservedNeurons,
    chargedNeurons: job.aiReservedNeurons
  });
}

async function lockNeuronReservation(
  tx: Prisma.TransactionClient,
  jobId: string
) {
  const [job] = await tx.$queryRaw<
    Array<{
      aiReservedNeurons: number;
      aiNeuronReservationDate: string | null;
    }>
  >`
    SELECT "aiReservedNeurons", "aiNeuronReservationDate"
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
    reservedNeurons: number;
    chargedNeurons: number;
  }
) {
  await tx.aiDailyUsage.upsert({
    where: {
      provider_usageDate: {
        provider: AI_PROVIDER,
        usageDate: input.usageDate
      }
    },
    create: {
      provider: AI_PROVIDER,
      usageDate: input.usageDate,
      reservedNeurons: input.reservedNeurons
    },
    update: {}
  });
  await tx.$executeRaw`
    UPDATE "AiDailyUsage"
    SET
      "reservedNeurons" = GREATEST(0, "reservedNeurons" - ${input.reservedNeurons}),
      "usedNeurons" = "usedNeurons" + ${input.chargedNeurons},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "provider" = ${AI_PROVIDER}
      AND "usageDate" = ${input.usageDate}
  `;
  await tx.emailAutomationJob.update({
    where: { id: input.jobId },
    data: {
      aiReservedNeurons: 0,
      aiNeuronReservationDate: null
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
  throw new Error("AI neuron budget transaction failed");
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

export function canReserveAiNeurons(
  usedNeurons: number,
  reservedNeurons: number,
  dailyBudget: number,
  requestedNeurons = AI_NEURON_RESERVATION_PER_REQUEST
) {
  return usedNeurons + reservedNeurons + requestedNeurons <= dailyBudget;
}

function normalizeRequestedNeurons(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}
