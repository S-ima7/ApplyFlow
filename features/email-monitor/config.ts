import { EmailAutomationJobStatus } from "@prisma/client";
import { DEFAULT_EMAIL_MONITOR_QUERY } from "@/features/email-monitor/constants";
import { dispatchEmailMonitorBackground } from "@/features/email-monitor/internal-auth";
import { consumeAiTokenReservationAsUsedInTransaction } from "@/features/email-monitor/token-budget";
import { prisma } from "@/lib/prisma";

export type SaveEmailMonitorConfigInput = {
  enabled: boolean;
  query: string;
  consentToAiProcessing: boolean;
};

export async function getEmailMonitorConfig(userId: string) {
  return prisma.emailMonitorConfig.findUnique({ where: { userId } });
}

export async function saveEmailMonitorConfig(
  userId: string,
  input: SaveEmailMonitorConfigInput,
  now = new Date()
) {
  const gmailQuery = normalizeGmailQuery(input.query);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.emailMonitorConfig.findUnique({
      where: { userId },
      select: {
        enabled: true,
        consentedAt: true,
        gmailQuery: true
      }
    });
    const consentedAt = resolveEmailMonitorConsent(
      existing?.consentedAt ?? null,
      input,
      now
    );
    const transition = getEmailMonitorConfigTransition(
      existing,
      input.enabled,
      gmailQuery
    );
    const config = await tx.emailMonitorConfig.upsert({
      where: { userId },
      create: {
        userId,
        enabled: input.enabled,
        gmailQuery,
        consentedAt,
        monitoringSince: now,
        cursorAt: now
      },
      update: {
        enabled: input.enabled,
        gmailQuery,
        consentedAt,
        ...(transition.resetScan
          ? {
              cursorAt: now,
              monitoringSince: now,
              scanUpperBoundAt: null,
              scanPageToken: null,
              lastErrorCode: null,
              lastErrorMessage: null
            }
          : {})
      }
    });

    if (transition.reviewPendingJobs) {
      const affectedJobs = await tx.emailAutomationJob.findMany({
        where: {
          userId,
          status: {
            in: [
              EmailAutomationJobStatus.PENDING,
              EmailAutomationJobStatus.PROCESSING,
              EmailAutomationJobStatus.RETRY_WAIT
            ]
          },
          aiReservedTokens: { gt: 0 }
        },
        select: { id: true }
      });
      for (const job of affectedJobs) {
        await consumeAiTokenReservationAsUsedInTransaction(tx, job.id);
      }
      await tx.emailAutomationJob.updateMany({
        where: {
          userId,
          status: {
            in: [
              EmailAutomationJobStatus.PENDING,
              EmailAutomationJobStatus.PROCESSING,
              EmailAutomationJobStatus.RETRY_WAIT
            ]
          }
        },
        data: {
          status: EmailAutomationJobStatus.REVIEW_REQUIRED,
          errorCode: transition.reviewReason,
          errorMessage: null,
          leaseUntil: null,
          nextAttemptAt: null,
          processedAt: now
        }
      });
    }
    return config;
  });
}

export async function getEmailMonitorOverview(userId: string) {
  const [config, counts] = await Promise.all([
    getEmailMonitorConfig(userId),
    prisma.emailAutomationJob.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true }
    })
  ]);

  const statusCounts = Object.fromEntries(
    Object.values(EmailAutomationJobStatus).map((status) => [status, 0])
  ) as Record<EmailAutomationJobStatus, number>;
  for (const count of counts) {
    statusCounts[count.status] = count._count._all;
  }

  return { config, statusCounts };
}

export async function runEmailMonitorForUser(userId: string, origin: string) {
  const config = await prisma.emailMonitorConfig.findUnique({
    where: { userId },
    select: { enabled: true, consentedAt: true }
  });
  if (!config?.enabled || !config.consentedAt) {
    throw new Error("メール監視が有効ではありません");
  }

  await dispatchEmailMonitorBackground({ origin, userId });
}

function normalizeGmailQuery(query: string) {
  const normalized = query.trim() || DEFAULT_EMAIL_MONITOR_QUERY;
  if (normalized.length > 500) {
    throw new Error("Gmail検索条件は500文字以内で入力してください");
  }
  return normalized;
}

export function resolveEmailMonitorConsent(
  existingConsentedAt: Date | null,
  input: Pick<
    SaveEmailMonitorConfigInput,
    "enabled" | "consentToAiProcessing"
  >,
  now: Date
) {
  if (input.enabled && !input.consentToAiProcessing) {
    throw new Error("AI処理への同意が必要です");
  }
  if (!input.consentToAiProcessing) return null;
  return existingConsentedAt ?? now;
}

export function getEmailMonitorConfigTransition(
  existing: { enabled: boolean; gmailQuery: string } | null,
  enabled: boolean,
  gmailQuery: string
) {
  const startsMonitoring = enabled && !existing?.enabled;
  const queryChanged = Boolean(
    existing && existing.gmailQuery !== gmailQuery
  );

  return {
    resetScan: startsMonitoring || queryChanged,
    reviewPendingJobs: !enabled || queryChanged,
    reviewReason: !enabled
      ? "MONITOR_DISABLED"
      : queryChanged
        ? "MONITOR_QUERY_CHANGED"
        : null
  };
}

export { DEFAULT_EMAIL_MONITOR_QUERY };
