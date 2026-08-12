"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getGmailMessage } from "@/lib/gmail";
import { extractEmailWithAi } from "@/features/email-import/extraction";
import { tryAutoCreateEmailImportApplication } from "@/features/email-import/automation";
import { decideAndApplyEmailImportAutomation } from "@/features/email-monitor/automation";
import {
  emailAiExtractionSchema,
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
): Promise<
  EmailImportActionResult<{ extractionId: string; applicationId?: string }>
> {
  const user = await requireUser();
  const gmail = await getGmailMessage(user.id, gmailMessageId);

  if (gmail.status !== "connected" || !gmail.gmailMessage) {
    return {
      ok: false,
      message: gmail.message ?? "Gmail本文を取得できませんでした"
    };
  }

  const emailImport = await prisma.emailImport.upsert({
    where: {
      userId_gmailMessageId: {
        userId: user.id,
        gmailMessageId: gmail.gmailMessage.id
      }
    },
    update: {
      gmailThreadId: gmail.gmailMessage.threadId,
      subject: gmail.gmailMessage.subject,
      fromAddress: gmail.gmailMessage.fromAddress,
      snippet: gmail.gmailMessage.snippet,
      sentAt: gmail.gmailMessage.sentAt,
      importedAt: new Date()
    },
    create: {
      userId: user.id,
      gmailMessageId: gmail.gmailMessage.id,
      gmailThreadId: gmail.gmailMessage.threadId,
      subject: gmail.gmailMessage.subject,
      fromAddress: gmail.gmailMessage.fromAddress,
      snippet: gmail.gmailMessage.snippet,
      sentAt: gmail.gmailMessage.sentAt
    }
  });

  const extraction = await extractEmailWithAi(
    gmail.gmailMessage,
    user.timezone ?? "Asia/Tokyo"
  );

  if (!extraction.ok) {
    return extraction;
  }

  const created = await prisma.aiExtractionResult.create({
    data: {
      userId: user.id,
      emailImportId: emailImport.id,
      extractedJson: extraction.data as Prisma.InputJsonValue,
      confidence: extraction.data.confidence,
      modelName: extraction.metadata.model,
      promptVersion: extraction.metadata.promptVersion
    }
  });

  const timezone = user.timezone ?? "Asia/Tokyo";
  const automationExtraction = emailAiExtractionSchema.safeParse(
    extraction.data
  );
  const existingApplicationDecision = automationExtraction.success
    ? await decideAndApplyEmailImportAutomation({
        emailImportId: emailImport.id,
        extractionResultId: created.id,
        userId: user.id,
        userTimezone: timezone,
        extraction: automationExtraction.data
      })
    : null;
  const existingApplicationId =
    existingApplicationDecision?.action === "AUTO_APPLY"
      ? existingApplicationDecision.applicationId
      : existingApplicationDecision?.action === "UNCHANGED"
        ? existingApplicationDecision.applicationId
        : null;
  const createdApplication = existingApplicationId || !automationExtraction.success
    ? null
    : await tryAutoCreateEmailImportApplication({
        userId: user.id,
        timezone,
        emailImportId: emailImport.id,
        extractionResultId: created.id,
        extraction: automationExtraction.data
      });
  const applicationId =
    existingApplicationId ?? createdApplication?.applicationId;

  revalidatePath("/email-import");
  if (applicationId) {
    revalidatePath("/dashboard");
    revalidatePath("/applications");
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath("/calendar");
    revalidatePath("/waiting");
    revalidatePath("/deadlines");
  }

  return {
    ok: true,
    data: {
      extractionId: created.id,
      ...(applicationId ? { applicationId } : {})
    },
    message: applicationId
      ? "メールから応募情報を自動反映しました"
      : "メールから情報を抽出しました"
  };
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
