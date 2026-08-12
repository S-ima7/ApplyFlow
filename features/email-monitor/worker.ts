import {
  EmailAutomationJobStatus,
  Prisma
} from "@prisma/client";
import { decideAndApplyEmailAutomation } from "@/features/email-monitor/automation";
import {
  EMAIL_MONITOR_BATCH_SIZE,
  EMAIL_MONITOR_LEASE_MS,
  EMAIL_MONITOR_MAX_ATTEMPTS
} from "@/features/email-monitor/constants";
import { buildEmailMessageDigest } from "@/features/email-monitor/digest";
import {
  buildEmailMonitorGmailQuery,
  completeEmailMonitorScanPage,
  isWithinEmailMonitorActivationBoundary,
  startOrResumeEmailMonitorScan
} from "@/features/email-monitor/polling";
import {
  normalizeEmailMonitorAiResult,
  type EmailMonitorAiResult
} from "@/features/email-monitor/schema";
import {
  getEmailAutomationRetryTransition,
  nextUtcDay
} from "@/features/email-monitor/state-machine";
import {
  consumeAiNeuronReservationAsUsed,
  reserveAiNeuronBudget,
  settleAiNeuronBudget
} from "@/features/email-monitor/token-budget";
import { calculateCloudflareNeurons } from "@/lib/ai/responses";
import {
  getGmailMessage,
  searchGmailMessages,
  type GmailFullMessage
} from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

export type EmailMonitorWorkerOptions = {
  userId?: string;
  now?: Date;
  extract?: (
    email: GmailFullMessage,
    timezone: string,
    referenceNow: Date
  ) => Promise<EmailMonitorAiResult>;
};

export async function runEmailMonitorBatch(
  options: EmailMonitorWorkerOptions = {}
) {
  const currentTime = () => options.now ?? new Date();
  const configs = await prisma.emailMonitorConfig.findMany({
    where: {
      enabled: true,
      consentedAt: { not: null },
      ...(options.userId ? { userId: options.userId } : {})
    },
    orderBy: { updatedAt: "asc" }
  });

  let enqueued = 0;
  for (const config of configs) {
    if (enqueued >= EMAIL_MONITOR_BATCH_SIZE) break;
    enqueued += await enqueueEmailMonitorScanPage(
      config,
      EMAIL_MONITOR_BATCH_SIZE - enqueued,
      currentTime()
    );
  }

  let processed = 0;
  while (processed < EMAIL_MONITOR_BATCH_SIZE) {
    const iterationNow = currentTime();
    const job = await claimNextEmailAutomationJob(
      options.userId,
      iterationNow
    );
    if (!job) break;
    processed += 1;
    const result = await processClaimedJob(
      job.id,
      currentTime(),
      options.extract ?? extractEmailWithConfiguredAi
    );
    if (result === "QUOTA_PAUSED") {
      await markQuotaPaused(options.userId, iterationNow);
      break;
    }
  }

  return { configs: configs.length, enqueued, processed };
}

async function enqueueEmailMonitorScanPage(
  config: {
    id: string;
    userId: string;
    gmailQuery: string;
    monitoringSince: Date;
    cursorAt: Date;
    scanUpperBoundAt: Date | null;
    scanPageToken: string | null;
  },
  maxResults: number,
  now: Date
) {
  const scan = startOrResumeEmailMonitorScan(config, now);
  const query = buildEmailMonitorGmailQuery(
    config.gmailQuery,
    scan.queryAfter,
    scan.queryBefore
  );
  const result = await searchGmailMessages(config.userId, query, {
    maxResults,
    pageToken: scan.pageToken
  });

  await prisma.emailMonitorConfig.update({
    where: { id: config.id },
    data: { lastRunAt: now }
  });

  if (result.status !== "connected") {
    await handleGmailConnectionFailure(config.id, result.status, result.message);
    return 0;
  }

  let created = 0;
  for (const summary of result.messages) {
    const fullResult = await getGmailMessage(config.userId, summary.id);
    if (fullResult.status !== "connected" || !fullResult.gmailMessage) {
      await handleGmailConnectionFailure(
        config.id,
        fullResult.status,
        fullResult.message
      );
      return created;
    }

    const message = fullResult.gmailMessage;
    if (
      !isWithinEmailMonitorActivationBoundary(
        message.internalDate,
        config.monitoringSince
      )
    ) {
      continue;
    }
    const digest = buildEmailMessageDigest(message);
    const wasCreated = await prisma.$transaction(async (tx) => {
      const emailImport = await tx.emailImport.upsert({
        where: {
          userId_gmailMessageId: {
            userId: config.userId,
            gmailMessageId: message.id
          }
        },
        create: {
          userId: config.userId,
          gmailMessageId: message.id,
          gmailThreadId: message.threadId,
          subject: message.subject,
          fromAddress: message.fromAddress,
          sentAt: message.sentAt
        },
        update: {
          gmailThreadId: message.threadId,
          subject: message.subject,
          fromAddress: message.fromAddress,
          sentAt: message.sentAt
        },
        select: { id: true }
      });
      const existing = await tx.emailAutomationJob.findUnique({
        where: { emailImportId: emailImport.id },
        select: { id: true }
      });
      if (existing) return false;

      await tx.emailAutomationJob.create({
        data: {
          userId: config.userId,
          emailImportId: emailImport.id,
          gmailMessageId: message.id,
          messageDigest: digest
        }
      });
      return true;
    });
    if (wasCreated) created += 1;
  }

  const scanState = completeEmailMonitorScanPage(
    scan.upperBoundAt,
    result.nextPageToken
  );
  await prisma.emailMonitorConfig.update({
    where: { id: config.id },
    data: {
      ...scanState,
      lastSuccessAt: now,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  });
  return created;
}

async function claimNextEmailAutomationJob(userId: string | undefined, now: Date) {
  await prisma.emailAutomationJob.updateMany({
    where: {
      status: EmailAutomationJobStatus.PROCESSING,
      leaseUntil: { lt: now },
      attempts: { gte: EMAIL_MONITOR_MAX_ATTEMPTS },
      ...(userId ? { userId } : {})
    },
    data: {
      status: EmailAutomationJobStatus.FAILED,
      errorCode: "LEASE_EXPIRED",
      errorMessage: null,
      leaseUntil: null,
      processedAt: now
    }
  });

  const claimable = {
    attempts: { lt: EMAIL_MONITOR_MAX_ATTEMPTS },
    OR: [
      { status: EmailAutomationJobStatus.PENDING },
      {
        status: EmailAutomationJobStatus.RETRY_WAIT,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      {
        status: EmailAutomationJobStatus.PROCESSING,
        leaseUntil: { lt: now }
      }
    ],
    ...(userId ? { userId } : {}),
    user: {
      emailMonitorConfig: {
        is: {
          enabled: true,
          consentedAt: { not: null }
        }
      }
    }
  } satisfies Prisma.EmailAutomationJobWhereInput;

  for (let contention = 0; contention < 5; contention += 1) {
    const candidate = await prisma.emailAutomationJob.findFirst({
      where: claimable,
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      select: { id: true }
    });
    if (!candidate) return null;

    const claimed = await prisma.emailAutomationJob.updateMany({
      where: { id: candidate.id, ...claimable },
      data: {
        status: EmailAutomationJobStatus.PROCESSING,
        attempts: { increment: 1 },
        leaseUntil: new Date(now.getTime() + EMAIL_MONITOR_LEASE_MS),
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null
      }
    });
    if (claimed.count === 1) {
      return prisma.emailAutomationJob.findUnique({
        where: { id: candidate.id },
        select: { id: true }
      });
    }
  }
  return null;
}

async function processClaimedJob(
  jobId: string,
  now: Date,
  extract: (
    email: GmailFullMessage,
    timezone: string,
    referenceNow: Date
  ) => Promise<EmailMonitorAiResult>
) {
  const job = await prisma.emailAutomationJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      user: { select: { timezone: true } },
      emailImport: true,
      extractionResult: true
    }
  });

  const messageResult = await getGmailMessage(job.userId, job.gmailMessageId);
  if (messageResult.status !== "connected" || !messageResult.gmailMessage) {
    if (
      ["not_connected", "missing_scope", "missing_token"].includes(
        messageResult.status
      )
    ) {
      await prisma.emailMonitorConfig.update({
        where: { userId: job.userId },
        data: {
          enabled: false,
          lastErrorCode: "NEEDS_REAUTH",
          lastErrorMessage: safeErrorMessage(messageResult.message)
        }
      });
    }
    await markJobForRetry(job.id, job.attempts, "GMAIL_FETCH_FAILED", now);
    return;
  }

  const message = messageResult.gmailMessage;
  if (buildEmailMessageDigest(message) !== job.messageDigest) {
    await prisma.emailAutomationJob.update({
      where: { id: job.id },
      data: {
        status: EmailAutomationJobStatus.REVIEW_REQUIRED,
        errorCode: "MESSAGE_DIGEST_CHANGED",
        errorMessage: null,
        leaseUntil: null,
        processedAt: now
      }
    });
    return;
  }

  let normalized: EmailMonitorAiResult;
  if (job.extractionResult) {
    normalized = normalizeEmailMonitorAiResult({
      ok: true,
      data: job.extractionResult.extractedJson,
      metadata: {
        model: job.extractionResult.modelName ?? "unknown",
        promptVersion: job.extractionResult.promptVersion ?? "unknown",
        usage: {
          inputTokens: job.aiInputTokens,
          outputTokens: job.aiOutputTokens,
          totalTokens: job.aiTotalTokens
        }
      }
    });
  } else {
    const maximumRequestUsage =
      await estimateEmailWithConfiguredAiUsageCeiling(
        message,
        job.user.timezone,
        now
      );
    const maximumRequestNeurons = calculateCloudflareNeurons({
      inputTokens: maximumRequestUsage.inputTokens,
      outputTokens: maximumRequestUsage.outputTokens
    });
    const reserved = await reserveAiNeuronBudget(
      job.id,
      now,
      maximumRequestNeurons ?? Number.POSITIVE_INFINITY
    );
    if (!reserved) {
      const currentJob = await prisma.emailAutomationJob.findUnique({
        where: { id: job.id },
        select: { status: true }
      });
      if (currentJob?.status !== EmailAutomationJobStatus.PROCESSING) {
        return "PROCESSED" as const;
      }
      await deferJobForQuota(job.id, now);
      return "QUOTA_PAUSED" as const;
    }
    normalized = await extract(message, job.user.timezone, now);
  }

  if (!normalized.ok) {
    await consumeAiNeuronReservationAsUsed(job.id);
    const errorCode = normalized.error?.code ?? classifyAiError(normalized.message);
    if (errorCode === "RATE_LIMITED") {
      await deferJobForQuota(job.id, now);
      return "QUOTA_PAUSED" as const;
    }
    if (normalized.error?.retryable === false) {
      await markJobFailed(job.id, errorCode, now, normalized.message);
      return;
    }
    await markJobForRetry(
      job.id,
      job.attempts,
      errorCode,
      now,
      normalized.message
    );
    return;
  }

  if (!job.extractionResultId) {
    await prisma.$transaction(async (tx) => {
      const extraction = await tx.aiExtractionResult.create({
        data: {
          userId: job.userId,
          emailImportId: job.emailImportId,
          extractedJson: normalized.data,
          confidence: normalized.data.confidence,
          modelName: normalized.metadata.model,
          promptVersion: normalized.metadata.promptVersion
        }
      });
      await tx.emailAutomationJob.update({
        where: { id: job.id },
        data: {
          extractionResultId: extraction.id,
          aiInputTokens: normalized.metadata.usage.inputTokens,
          aiOutputTokens: normalized.metadata.usage.outputTokens,
          aiTotalTokens: normalized.metadata.usage.totalTokens,
          aiProcessedAt: now
        }
      });
      await settleAiNeuronBudget(
        tx,
        job.id,
        calculateCloudflareNeurons(normalized.metadata.usage)
      );
    });
  }

  await decideAndApplyEmailAutomation({
    jobId: job.id,
    userId: job.userId,
    userTimezone: job.user.timezone,
    extraction: normalized.data
  });
  return "PROCESSED" as const;
}

async function deferJobForQuota(jobId: string, now: Date) {
  await prisma.emailAutomationJob.update({
    where: { id: jobId },
    data: {
      status: EmailAutomationJobStatus.RETRY_WAIT,
      attempts: { decrement: 1 },
      leaseUntil: null,
      nextAttemptAt: nextUtcDay(now),
      errorCode: "AI_DAILY_NEURON_BUDGET",
      errorMessage: null
    }
  });
}

async function markJobFailed(
  jobId: string,
  errorCode: string,
  now: Date,
  message?: string
) {
  await prisma.emailAutomationJob.update({
    where: { id: jobId },
    data: {
      status: EmailAutomationJobStatus.FAILED,
      errorCode,
      errorMessage: safeErrorMessage(message),
      leaseUntil: null,
      nextAttemptAt: null,
      processedAt: now
    }
  });
}

async function markJobForRetry(
  jobId: string,
  attempts: number,
  errorCode: string,
  now: Date,
  message?: string
) {
  const transition = getEmailAutomationRetryTransition(attempts, now);
  await prisma.emailAutomationJob.update({
    where: { id: jobId },
    data: {
      ...transition,
      errorCode,
      errorMessage: safeErrorMessage(message),
      leaseUntil: null,
      processedAt:
        transition.status === EmailAutomationJobStatus.FAILED ? now : null
    }
  });
}

async function markQuotaPaused(userId: string | undefined, now: Date) {
  await prisma.emailMonitorConfig.updateMany({
    where: {
      enabled: true,
      ...(userId ? { userId } : {})
    },
    data: {
      lastErrorCode: "AI_DAILY_NEURON_BUDGET",
      lastErrorMessage: `AI処理は${nextUtcDay(now).toISOString()}以降に再開します`
    }
  });
}

async function handleGmailConnectionFailure(
  configId: string,
  status: string,
  message?: string
) {
  const needsReauth = [
    "not_connected",
    "missing_scope",
    "missing_token"
  ].includes(status);
  await prisma.emailMonitorConfig.update({
    where: { id: configId },
    data: {
      enabled: needsReauth ? false : undefined,
      lastErrorCode: needsReauth ? "NEEDS_REAUTH" : "GMAIL_SEARCH_FAILED",
      lastErrorMessage: safeErrorMessage(message),
      ...(!needsReauth
        ? {
            scanUpperBoundAt: null,
            scanPageToken: null
          }
        : {})
    }
  });
}

function safeErrorMessage(message?: string) {
  if (!message) return null;
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

function classifyAiError(message: string) {
  if (message.includes("利用上限") || message.includes("429")) {
    return "RATE_LIMITED";
  }
  if (message.includes("形式") || message.includes("JSON")) {
    return "AI_SCHEMA_INVALID";
  }
  return "AI_EXTRACTION_FAILED";
}

async function extractEmailWithConfiguredAi(
  email: GmailFullMessage,
  timezone: string,
  referenceNow: Date
) {
  const aiExtractionModule = (await import(
    "@/features/email-import/extraction"
  )) as Record<string, unknown>;
  const extractEmailWithAi = aiExtractionModule.extractEmailWithAi;
  if (typeof extractEmailWithAi !== "function") {
    return {
      ok: false as const,
      message: "無料AIプロバイダーが設定されていません"
    };
  }

  const raw = await (
    extractEmailWithAi as (
      message: GmailFullMessage,
      timezone: string,
      referenceNow: Date
    ) => Promise<unknown>
  )(email, timezone, referenceNow);
  return normalizeEmailMonitorAiResult(raw);
}

async function estimateEmailWithConfiguredAiUsageCeiling(
  email: GmailFullMessage,
  timezone: string,
  referenceNow: Date
) {
  const aiExtractionModule = (await import(
    "@/features/email-import/extraction"
  )) as Record<string, unknown>;
  const estimateEmailExtractionUsageCeiling =
    aiExtractionModule.estimateEmailExtractionUsageCeiling;
  if (typeof estimateEmailExtractionUsageCeiling !== "function") {
    return {
      inputTokens: Number.POSITIVE_INFINITY,
      outputTokens: Number.POSITIVE_INFINITY
    };
  }

  return (
    estimateEmailExtractionUsageCeiling as (
      message: GmailFullMessage,
      timezone: string,
      referenceNow: Date
    ) => { inputTokens: number; outputTokens: number }
  )(email, timezone, referenceNow);
}
