import { EmailAutomationJobStatus, Prisma } from "@prisma/client";
import { tryAutoCreateEmailImportApplication } from "@/features/email-import/automation";
import { decideAndApplyEmailImportAutomation } from "@/features/email-monitor/automation";
import {
  EMAIL_EXTRACTION_TIMEOUT_MS,
  extractEmailWithAi
} from "@/features/email-import/extraction";
import { emailAiExtractionSchema } from "@/features/email-import/schema";
import { MANUAL_EMAIL_IMPORT_JOB_CODE } from "@/features/email-monitor/constants";
import { buildEmailMessageDigest } from "@/features/email-monitor/digest";
import { getGmailMessage } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";

const MANUAL_JOB_LEASE_MS = EMAIL_EXTRACTION_TIMEOUT_MS + 2 * 60 * 1_000;

export async function runManualEmailImportJob(input: {
  jobId: string;
  userId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + MANUAL_JOB_LEASE_MS);
  const claimed = await prisma.emailAutomationJob.updateMany({
    where: {
      id: input.jobId,
      userId: input.userId,
      status: EmailAutomationJobStatus.PENDING,
      errorCode: MANUAL_EMAIL_IMPORT_JOB_CODE
    },
    data: {
      status: EmailAutomationJobStatus.PROCESSING,
      attempts: { increment: 1 },
      leaseUntil
    }
  });
  if (claimed.count !== 1) return;

  try {
    const job = await prisma.emailAutomationJob.findFirstOrThrow({
      where: { id: input.jobId, userId: input.userId },
      include: { user: { select: { timezone: true } } }
    });
    const gmail = await getGmailMessage(input.userId, job.gmailMessageId);
    if (gmail.status !== "connected" || !gmail.gmailMessage) {
      await failManualJob(job.id, leaseUntil, "GMAIL_FETCH_FAILED", gmail.message);
      return;
    }
    if (buildEmailMessageDigest(gmail.gmailMessage) !== job.messageDigest) {
      await failManualJob(
        job.id,
        leaseUntil,
        "MESSAGE_DIGEST_CHANGED",
        "メール内容が変わりました。もう一度自動反映してください"
      );
      return;
    }

    const extractionResult = await extractEmailWithAi(
      gmail.gmailMessage,
      job.user.timezone,
      now
    );
    if (!extractionResult.ok) {
      await failManualJob(
        job.id,
        leaseUntil,
        extractionResult.error.code,
        extractionResult.message
      );
      return;
    }
    const extraction = emailAiExtractionSchema.safeParse(extractionResult.data);
    if (!extraction.success) {
      await failManualJob(
        job.id,
        leaseUntil,
        "SCHEMA_VALIDATION_FAILED",
        "AI抽出結果を検証できませんでした"
      );
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.aiExtractionResult.create({
        data: {
          userId: job.userId,
          emailImportId: job.emailImportId,
          extractedJson: extraction.data as Prisma.InputJsonValue,
          confidence: extraction.data.confidence,
          modelName: extractionResult.metadata.model,
          promptVersion: extractionResult.metadata.promptVersion
        }
      });
      const updated = await tx.emailAutomationJob.updateMany({
        // An id-only update would let an expired worker attach data to a newer run.
        where: {
          id: job.id,
          status: EmailAutomationJobStatus.PROCESSING,
          leaseUntil
        },
        data: {
          extractionResultId: result.id,
          aiInputTokens: extractionResult.metadata.usage.inputTokens,
          aiOutputTokens: extractionResult.metadata.usage.outputTokens,
          aiTotalTokens: extractionResult.metadata.usage.totalTokens,
          aiProcessedAt: now
        }
      });
      if (updated.count !== 1) {
        throw new Error("Manual email import lease was lost");
      }
      return result;
    });

    const existingDecision = await decideAndApplyEmailImportAutomation({
      emailImportId: job.emailImportId,
      extractionResultId: created.id,
      userId: job.userId,
      userTimezone: job.user.timezone,
      extraction: extraction.data
    });
    const existingApplicationId =
      existingDecision.action === "AUTO_APPLY" ||
      existingDecision.action === "UNCHANGED"
        ? existingDecision.applicationId
        : null;
    const createdApplication = existingApplicationId
      ? null
      : await tryAutoCreateEmailImportApplication({
          userId: job.userId,
          timezone: job.user.timezone,
          emailImportId: job.emailImportId,
          extractionResultId: created.id,
          extraction: extraction.data
        });
    const applicationId =
      existingApplicationId ?? createdApplication?.applicationId;

    if (applicationId) {
      await prisma.emailAutomationJob.updateMany({
        where: {
          id: job.id,
          status: EmailAutomationJobStatus.PROCESSING,
          leaseUntil
        },
        data: {
          status: EmailAutomationJobStatus.AUTO_APPLIED,
          matchedApplicationId: applicationId,
          errorCode: null,
          errorMessage: null,
          leaseUntil: null,
          processedAt: new Date()
        }
      });
      return;
    }

    const reviewReason =
      existingDecision.action === "IGNORE" ||
      existingDecision.action === "REVIEW_REQUIRED"
        ? existingDecision.reason
        : "APPLICATION_NOT_UNIQUE";
    await prisma.emailAutomationJob.updateMany({
      where: {
        id: job.id,
        status: EmailAutomationJobStatus.PROCESSING,
        leaseUntil
      },
      data: {
        status: EmailAutomationJobStatus.REVIEW_REQUIRED,
        matchedApplicationId:
          "applicationId" in existingDecision
            ? existingDecision.applicationId
            : null,
        errorCode: reviewReason,
        errorMessage: null,
        leaseUntil: null,
        processedAt: new Date()
      }
    });
  } catch {
    await failManualJob(
      input.jobId,
      leaseUntil,
      "MANUAL_IMPORT_FAILED",
      "メールの自動反映に失敗しました。もう一度お試しください"
    );
  }
}

async function failManualJob(
  jobId: string,
  leaseUntil: Date,
  errorCode: string,
  message?: string
) {
  await prisma.emailAutomationJob.updateMany({
    // A stale worker must not overwrite a newer worker's terminal state.
    where: {
      id: jobId,
      status: EmailAutomationJobStatus.PROCESSING,
      leaseUntil
    },
    data: {
      status: EmailAutomationJobStatus.FAILED,
      errorCode,
      errorMessage: message?.replace(/[\r\n]+/g, " ").slice(0, 300) ?? null,
      leaseUntil: null,
      nextAttemptAt: null,
      processedAt: new Date()
    }
  });
}
