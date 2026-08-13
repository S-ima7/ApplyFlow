"use server";

import { EmailAutomationJobStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getGmailMessage } from "@/lib/gmail";
import { buildEmailMessageDigest } from "@/features/email-monitor/digest";
import {
  dispatchEmailMonitorBackground,
  getInternalSiteOrigin
} from "@/features/email-monitor/internal-auth";
import { MANUAL_EMAIL_IMPORT_JOB_CODE } from "@/features/email-monitor/constants";
import {
  emailExtractionSchema,
  emailImportConfirmSchema,
  type EmailImportConfirmInput
} from "@/features/email-import/schema";
import { createEmailImportApplication } from "@/features/email-import/registration";
import { getEmailImportApplicationResolution } from "@/features/email-import/queries";

export type EmailImportActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

function failFromZod(error: z.ZodError): EmailImportActionResult<never> {
  return {
    ok: false,
    message: "入力内容を確認してください",
    fieldErrors: error.flatten().fieldErrors
  };
}

export async function importAndExtractEmail(
  gmailMessageId: string
): Promise<EmailImportActionResult<{ jobId: string }>> {
  const user = await requireUser();
  const origin = getInternalSiteOrigin();
  if (!origin) {
    return {
      ok: false,
      message: "Background Functionの送信先URLが設定されていません"
    };
  }
  const gmail = await getGmailMessage(user.id, gmailMessageId);

  if (gmail.status !== "connected" || !gmail.gmailMessage) {
    return {
      ok: false,
      message: gmail.message ?? "Gmail本文を取得できませんでした"
    };
  }
  const message = gmail.gmailMessage;

  const digest = buildEmailMessageDigest(message);
  const queued = await prisma.$transaction(async (tx) => {
    const emailImport = await tx.emailImport.upsert({
      where: {
        userId_gmailMessageId: {
          userId: user.id,
          gmailMessageId: message.id
        }
      },
      update: {
        gmailThreadId: message.threadId,
        subject: message.subject,
        fromAddress: message.fromAddress,
        snippet: message.snippet,
        sentAt: message.sentAt,
        importedAt: new Date()
      },
      create: {
        userId: user.id,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        subject: message.subject,
        fromAddress: message.fromAddress,
        snippet: message.snippet,
        sentAt: message.sentAt
      }
    });
    const existing = await tx.emailAutomationJob.findUnique({
      where: { emailImportId: emailImport.id }
    });
    if (
      existing &&
      existing.messageDigest === digest &&
      (existing.status === EmailAutomationJobStatus.AUTO_APPLIED ||
        existing.status === EmailAutomationJobStatus.REVIEW_REQUIRED)
    ) {
      return { jobId: existing.id, dispatch: false };
    }
    if (
      existing &&
      existing.messageDigest === digest &&
      existing.status === EmailAutomationJobStatus.PROCESSING &&
      (!existing.leaseUntil || existing.leaseUntil > new Date())
    ) {
      return { jobId: existing.id, dispatch: false };
    }

    const job = existing
      ? await tx.emailAutomationJob.update({
          where: { id: existing.id },
          data: {
            messageDigest: digest,
            status: EmailAutomationJobStatus.PENDING,
            attempts: 0,
            leaseUntil: null,
            nextAttemptAt: null,
            errorCode: MANUAL_EMAIL_IMPORT_JOB_CODE,
            errorMessage: null,
            extractionResultId: null,
            matchedApplicationId: null,
            processedAt: null
          }
        })
      : await tx.emailAutomationJob.create({
          data: {
            userId: user.id,
            emailImportId: emailImport.id,
            gmailMessageId: message.id,
            messageDigest: digest,
            errorCode: MANUAL_EMAIL_IMPORT_JOB_CODE
          }
        });
    return { jobId: job.id, dispatch: true };
  });

  if (queued.dispatch) {
    try {
      await dispatchEmailMonitorBackground({
        origin,
        userId: user.id,
        manualJobId: queued.jobId
      });
    } catch {
      await prisma.emailAutomationJob.update({
        where: { id: queued.jobId },
        data: {
          status: EmailAutomationJobStatus.FAILED,
          errorCode: "BACKGROUND_DISPATCH_FAILED",
          errorMessage: "バックグラウンド処理を開始できませんでした",
          processedAt: new Date()
        }
      });
      return {
        ok: false,
        message: "バックグラウンド処理を開始できませんでした"
      };
    }
  }

  revalidatePath("/email-import");

  return {
    ok: true,
    data: { jobId: queued.jobId },
    message: queued.dispatch
      ? "自動反映を受け付けました"
      : "このメールは処理済みです"
  };
}

export async function getEmailImportJobResult(
  jobId: string
): Promise<
  EmailImportActionResult<
    | { status: "PROCESSING" }
    | { status: "AUTO_APPLIED"; applicationId: string }
    | { status: "REVIEW_REQUIRED"; extractionId: string }
  >
> {
  const user = await requireUser();
  const job = await prisma.emailAutomationJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: {
      status: true,
      errorMessage: true,
      extractionResultId: true,
      matchedApplicationId: true,
      extractionResult: { select: { createdApplicationId: true } }
    }
  });
  if (!job) return { ok: false, message: "処理状況が見つかりません" };

  const applicationId =
    job.matchedApplicationId ?? job.extractionResult?.createdApplicationId;
  if (job.status === EmailAutomationJobStatus.AUTO_APPLIED && applicationId) {
    return {
      ok: true,
      data: { status: "AUTO_APPLIED", applicationId }
    };
  }
  if (
    (job.status === EmailAutomationJobStatus.REVIEW_REQUIRED ||
      job.status === EmailAutomationJobStatus.IGNORED) &&
    job.extractionResultId
  ) {
    return {
      ok: true,
      data: {
        status: "REVIEW_REQUIRED",
        extractionId: job.extractionResultId
      }
    };
  }
  if (job.status === EmailAutomationJobStatus.FAILED) {
    return {
      ok: false,
      message: job.errorMessage ?? "メールの自動反映に失敗しました"
    };
  }
  return { ok: true, data: { status: "PROCESSING" } };
}

export async function confirmEmailImportRegistration(
  extractionResultId: string,
  input: EmailImportConfirmInput
): Promise<EmailImportActionResult<{ applicationId: string }>> {
  const user = await requireUser();
  const parsed = emailImportConfirmSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const existing = await prisma.aiExtractionResult.findFirst({
    where: {
      id: extractionResultId,
      userId: user.id
    },
    include: {
      emailImport: true
    }
  });

  if (!existing) {
    return {
      ok: false,
      message: "抽出結果が見つかりません"
    };
  }

  if (existing.confirmedAt && existing.createdApplicationId) {
    return {
      ok: true,
      data: {
        applicationId: existing.createdApplicationId
      },
      message: "この抽出結果は登録済みです"
    };
  }

  const sourceExtraction = emailExtractionSchema.safeParse(existing.extractedJson);
  if (!sourceExtraction.success) {
    return {
      ok: false,
      message: "保存済みの抽出結果を検証できません。メールを再抽出してください"
    };
  }
  if (sourceExtraction.data.eventType !== "CREATE_OR_UPDATE") {
    return {
      ok: false,
      message: "日程変更・取消は新しい応募として登録できません"
    };
  }
  const sourceResolution = await getEmailImportApplicationResolution(
    user.id,
    sourceExtraction.data
  );
  if (
    sourceResolution.resolution !== "CREATE_NEW" &&
    sourceResolution.resolution !== "CREATE_WITH_EXISTING_COMPANY"
  ) {
    return {
      ok: false,
      message: "抽出結果に既存応募の候補があります。応募詳細から確認してください"
    };
  }
  const applicationResolution = await getEmailImportApplicationResolution(
    user.id,
    parsed.data
  );
  if (
    applicationResolution.resolution !== "CREATE_NEW" &&
    applicationResolution.resolution !== "CREATE_WITH_EXISTING_COMPANY"
  ) {
    return {
      ok: false,
      message: "既存応募の候補があります。応募詳細から確認してください"
    };
  }

  const application = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "EmailImport"
      WHERE "id" = ${existing.emailImportId} AND "userId" = ${user.id}
      FOR UPDATE
    `;
    const duplicate = await tx.aiExtractionResult.findFirst({
      where: {
        emailImportId: existing.emailImportId,
        createdApplicationId: { not: null }
      },
      select: {
        createdApplication: true
      }
    });
    if (duplicate?.createdApplication) return duplicate.createdApplication;

    const createdApplication = await createEmailImportApplication(tx, {
      userId: user.id,
      timezone: user.timezone ?? "Asia/Tokyo",
      data: parsed.data
    });

    await tx.aiExtractionResult.update({
      where: {
        id: existing.id
      },
      data: {
        reviewedJson: parsed.data as Prisma.InputJsonValue,
        confirmedAt: new Date(),
        createdApplicationId: createdApplication.id
      }
    });

    return createdApplication;
  });

  revalidatePath("/dashboard");
  revalidatePath("/applications");
  revalidatePath(`/applications/${application.id}`);
  revalidatePath("/calendar");
  revalidatePath("/waiting");
  revalidatePath("/deadlines");
  revalidatePath("/email-import");

  return {
    ok: true,
    data: {
      applicationId: application.id
    },
    message: "メールから応募情報を登録しました"
  };
}
