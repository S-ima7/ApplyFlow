"use server";

import {
  ActivityAction,
  DeadlineStatus,
  Prisma
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getGmailMessage } from "@/lib/gmail";
import { extractEmailWithOpenAI } from "@/features/email-import/extraction";
import {
  emailImportConfirmSchema,
  type EmailImportConfirmInput
} from "@/features/email-import/schema";
import { buildEmailImportRegistrationData } from "@/features/email-import/registration";

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
): Promise<EmailImportActionResult<{ extractionId: string }>> {
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

  const extraction = await extractEmailWithOpenAI(
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

  revalidatePath("/email-import");

  return {
    ok: true,
    data: {
      extractionId: created.id
    },
    message: "メールから情報を抽出しました"
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

  const data = parsed.data;
  const registration = buildEmailImportRegistrationData(
    data,
    user.timezone ?? "Asia/Tokyo"
  );

  const application = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        userId: user.id,
        name: data.companyName
      }
    });

    const createdApplication = await tx.application.create({
      data: {
        userId: user.id,
        companyId: company.id,
        position: data.position,
        applicationType: data.applicationType,
        route: data.route,
        status: registration.applicationStatus,
        priority: data.priority,
        note: data.note
      }
    });

    const stage = await tx.selectionStage.create({
      data: {
        userId: user.id,
        applicationId: createdApplication.id,
        type: data.stageType,
        name: data.stageName,
        status: registration.stageStatus,
        order: 1,
        scheduledAt: registration.confirmedSlot?.startAt
      }
    });

    const interview = await tx.interview.create({
      data: {
        userId: user.id,
        selectionStageId: stage.id,
        status: registration.interviewStatus,
        title: data.stageName,
        meetingUrl: data.meetingUrl,
        interviewerName: data.interviewerName,
        confirmedStartAt: registration.confirmedSlot?.startAt,
        confirmedEndAt: registration.confirmedSlot?.endAt
      }
    });

    if (registration.proposedSlots.length > 0) {
      await tx.proposedSlot.createMany({
        data: registration.proposedSlots.map((slot) => ({
          userId: user.id,
          interviewId: interview.id,
          startAt: slot.startAt,
          endAt: slot.endAt,
          timezone: slot.timezone,
          status: slot.status,
          source: "gmail",
          note: slot.note
        }))
      });
    }

    if (registration.deadlines.length > 0) {
      await tx.deadline.createMany({
        data: registration.deadlines.map((deadline) => ({
          userId: user.id,
          applicationId: createdApplication.id,
          type: deadline.type,
          status: DeadlineStatus.OPEN,
          title: deadline.title,
          dueAt: deadline.dueAt
        }))
      });
    }

    await tx.activityLog.createMany({
      data: buildActivityLogs(
        user.id,
        createdApplication.id,
        data.companyName,
        data.position,
        registration.proposedSlots.length,
        registration.deadlines.length
      )
    });

    await tx.aiExtractionResult.update({
      where: {
        id: existing.id
      },
      data: {
        reviewedJson: data as Prisma.InputJsonValue,
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

function buildActivityLogs(
  userId: string,
  applicationId: string,
  companyName: string,
  position: string,
  proposedSlotCount: number,
  deadlineCount: number
) {
  const logs: Array<{
    userId: string;
    applicationId: string;
    action: ActivityAction;
    message: string;
  }> = [
    {
      userId,
      applicationId,
      action: ActivityAction.APPLICATION_CREATED,
      message: `Gmailから ${companyName} / ${position} を登録しました`
    },
    {
      userId,
      applicationId,
      action: ActivityAction.STAGE_CREATED,
      message: "メール抽出から選考フェーズを追加しました"
    },
    {
      userId,
      applicationId,
      action: ActivityAction.INTERVIEW_CREATED,
      message: "メール抽出から面談を追加しました"
    }
  ];

  if (proposedSlotCount > 0) {
    logs.push({
      userId,
      applicationId,
      action: ActivityAction.PROPOSED_SLOT_CREATED,
      message: `メール抽出から候補日時を${proposedSlotCount}件追加しました`
    });
  }

  if (deadlineCount > 0) {
    logs.push({
      userId,
      applicationId,
      action: ActivityAction.DEADLINE_CREATED,
      message: `メール抽出から期限を${deadlineCount}件追加しました`
    });
  }

  return logs;
}
