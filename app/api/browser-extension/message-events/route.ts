import {
  ActivityAction,
  ApplicationRoute,
  ApplicationStatus,
  BrowserMessageEventType,
  InterviewStatus,
  Prisma,
  Priority,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import {
  BrowserExtensionRequestError,
  browserExtensionJson,
  browserExtensionOptionsResponse,
  readBrowserExtensionJson
} from "@/features/browser-extension/api";
import { authenticateBrowserExtensionRequest } from "@/features/browser-extension/auth";
import {
  isExactCompanyName,
  isExactMatchText
} from "@/features/browser-extension/application-matching";
import {
  browserMessageRegistrationSchema,
  validateSourceHost,
  type BrowserMessageRegistrationInput
} from "@/features/browser-extension/contracts";
import { getBrowserMessageRegistrationState } from "@/features/browser-extension/message-registration";
import { prisma } from "@/lib/prisma";

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;

export function OPTIONS() {
  return browserExtensionOptionsResponse();
}

export async function POST(request: Request) {
  try {
    const authentication = await authenticateBrowserExtensionRequest(request);
    if (!authentication.ok) {
      return browserExtensionJson(
        { ok: false, code: "AUTH_REQUIRED", message: authentication.message },
        { status: authentication.status }
      );
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_IDEMPOTENCY_KEY", message: "登録要求の識別子が不正です" },
        { status: 400 }
      );
    }

    const parsed = browserMessageRegistrationSchema.safeParse(
      await readBrowserExtensionJson(request)
    );
    if (!parsed.success || !validateSourceHost(parsed.data.sourceSite, parsed.data.sourceUrl)) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_INPUT", message: "面接日時の確認内容が不正です" },
        { status: 400 }
      );
    }

    const duplicate = await findDuplicate(
      authentication.user.id,
      parsed.data.applicationId,
      parsed.data.messageDigest,
      idempotencyKey
    );
    if (duplicate) return duplicateResponse(duplicate, request.url);

    const result = await prisma.$transaction(async (tx) => {
      const idempotencyDuplicate = await tx.browserMessageImport.findFirst({
        where: { userId: authentication.user.id, idempotencyKey },
        select: { applicationId: true, interviewId: true, eventType: true }
      });
      if (idempotencyDuplicate) {
        return {
          applicationId: idempotencyDuplicate.applicationId,
          interviewId: idempotencyDuplicate.interviewId,
          result: "existing"
        };
      }

      const { application, created: applicationCreated } = await resolveTargetApplication(
        tx,
        authentication.user.id,
        parsed.data
      );

      const transactionDuplicate = await tx.browserMessageImport.findFirst({
        where: {
          userId: authentication.user.id,
          applicationId: application.id,
          messageDigest: parsed.data.messageDigest
        },
        select: { applicationId: true, interviewId: true, eventType: true }
      });
      if (transactionDuplicate) {
        return {
          applicationId: transactionDuplicate.applicationId,
          interviewId: transactionDuplicate.interviewId,
          result: "existing"
        };
      }

      const targetInterview = parsed.data.targetInterviewId
        ? await tx.interview.findFirst({
            where: {
              id: parsed.data.targetInterviewId,
              userId: authentication.user.id,
              deletedAt: null,
              selectionStage: { applicationId: application.id, deletedAt: null }
            },
            include: { selectionStage: true }
          })
        : null;
      if (parsed.data.targetInterviewId && !targetInterview) {
        throw new RegistrationError("対象の面接が見つかりません");
      }

      if (parsed.data.eventType === "CANCEL") {
        if (!targetInterview) throw new RegistrationError("取消対象の面接を選択してください");
        await cancelInterviewSchedule(tx, authentication.user.id, targetInterview.id);

        const otherActiveInterviews = await tx.interview.count({
          where: {
            selectionStageId: targetInterview.selectionStageId,
            id: { not: targetInterview.id },
            deletedAt: null,
            status: { notIn: [InterviewStatus.CANCELLED, InterviewStatus.COMPLETED, InterviewStatus.EXPIRED] }
          }
        });
        if (otherActiveInterviews === 0) {
          await tx.selectionStage.update({
            where: { id: targetInterview.selectionStageId },
            data: { status: StageStatus.CANCELLED, scheduledAt: null }
          });
        }

        await tx.activityLog.create({
          data: {
            userId: authentication.user.id,
            applicationId: application.id,
            action: ActivityAction.INTERVIEW_STATUS_CHANGED,
            message: "企業メッセージを確認し、面接予定を取消しました",
            metadata: { sourceSite: parsed.data.sourceSite, eventType: parsed.data.eventType }
          }
        });
        await createImport(
          tx,
          authentication.user.id,
          application.id,
          parsed.data,
          idempotencyKey,
          targetInterview.id
        );
        return { applicationId: application.id, interviewId: targetInterview.id, result: "cancelled" };
      }

      const stage =
        targetInterview?.selectionStage ??
        (await findOrCreateStage(tx, authentication.user.id, application.id, parsed.data));
      let interviewId = targetInterview?.id;
      let createdInterview = false;

      if (!interviewId) {
        const interview = await tx.interview.create({
          data: {
            userId: authentication.user.id,
            selectionStageId: stage.id,
            status: InterviewStatus.DRAFT,
            title: parsed.data.stageName
          }
        });
        interviewId = interview.id;
        createdInterview = true;
      }

      const replaceSchedule = parsed.data.eventType === "RESCHEDULE" || parsed.data.replaceCurrentSchedule;
      if (replaceSchedule) {
        await tx.proposedSlot.updateMany({
          where: {
            interviewId,
            deletedAt: null,
            status: { in: [ProposedSlotStatus.PENDING, ProposedSlotStatus.CONFIRMED] }
          },
          data: { status: ProposedSlotStatus.CANCELLED }
        });
      }

      const state = getBrowserMessageRegistrationState(parsed.data);
      const confirmedStartAt = parsed.data.confirmedSlot.startAt
        ? new Date(parsed.data.confirmedSlot.startAt)
        : null;
      const confirmedEndAt = parsed.data.confirmedSlot.endAt
        ? new Date(parsed.data.confirmedSlot.endAt)
        : null;

      await tx.interview.update({
        where: { id: interviewId },
        data: {
          status: state.interviewStatus,
          title: parsed.data.stageName ?? undefined,
          meetingUrl: parsed.data.meetingUrl,
          interviewerName: parsed.data.interviewerName,
          confirmedStartAt,
          confirmedEndAt
        }
      });
      await tx.selectionStage.update({
        where: { id: stage.id },
        data: {
          status: state.stageStatus,
          name: parsed.data.stageName ?? undefined,
          scheduledAt: confirmedStartAt
        }
      });

      const slots = [
        ...(confirmedStartAt && confirmedEndAt
          ? [{
              startAt: confirmedStartAt,
              endAt: confirmedEndAt,
              timezone: parsed.data.confirmedSlot.timezone ?? authentication.user.timezone,
              status: ProposedSlotStatus.CONFIRMED
            }]
          : []),
        ...parsed.data.proposedSlots.map((slot) => ({
          startAt: new Date(slot.startAt),
          endAt: new Date(slot.endAt),
          timezone: slot.timezone ?? authentication.user.timezone,
          status: ProposedSlotStatus.PENDING
        }))
      ];
      if (slots.length > 0) {
        await tx.proposedSlot.createMany({
          data: slots.map((slot) => ({
            userId: authentication.user.id,
            interviewId,
            startAt: slot.startAt,
            endAt: slot.endAt,
            timezone: slot.timezone,
            status: slot.status,
            source: `browser_extension:${parsed.data.sourceSite.toLowerCase()}`
          }))
        });
      }

      if (state.applicationStatus && canAdvanceApplication(application.status)) {
        await tx.application.update({
          where: { id: application.id },
          data: { status: state.applicationStatus }
        });
      }

      const activityLogs = [
        {
          userId: authentication.user.id,
          applicationId: application.id,
          action: createdInterview ? ActivityAction.INTERVIEW_CREATED : ActivityAction.INTERVIEW_STATUS_CHANGED,
          message: createdInterview
            ? "企業メッセージから面接予定を追加しました"
            : parsed.data.eventType === "RESCHEDULE"
              ? "企業メッセージから面接予定を変更しました"
              : "企業メッセージから面接予定を更新しました"
        },
        ...(slots.length > 0
          ? [{
              userId: authentication.user.id,
              applicationId: application.id,
              action: ActivityAction.PROPOSED_SLOT_CREATED,
              message: `企業メッセージから日時を${slots.length}件登録しました`
            }]
          : [])
      ];
      await tx.activityLog.createMany({ data: activityLogs });
      await createImport(
        tx,
        authentication.user.id,
        application.id,
        parsed.data,
        idempotencyKey,
        interviewId
      );

      return {
        applicationId: application.id,
        interviewId,
        result: applicationCreated || createdInterview ? "created" : "updated"
      };
    });

    return browserExtensionJson(
      {
        ok: true,
        ...result,
        applicationUrl: new URL(`/applications/${result.applicationId}`, request.url).toString()
      },
      { status: result.result === "created" ? 201 : 200 }
    );
  } catch (error) {
    if (error instanceof RegistrationError) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_TARGET", message: error.message },
        { status: 400 }
      );
    }
    if (error instanceof BrowserExtensionRequestError) {
      return browserExtensionJson(
        { ok: false, code: "INVALID_REQUEST", message: error.message },
        { status: error.status }
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return browserExtensionJson(
        { ok: false, code: "DUPLICATE_MESSAGE", message: "このメッセージは登録済みです" },
        { status: 409 }
      );
    }
    return browserExtensionJson(
      { ok: false, code: "SERVER_ERROR", message: "面接日時を登録できませんでした" },
      { status: 500 }
    );
  }
}

async function cancelInterviewSchedule(
  tx: Prisma.TransactionClient,
  userId: string,
  interviewId: string
) {
  await tx.proposedSlot.updateMany({
    where: {
      userId,
      interviewId,
      deletedAt: null,
      status: { in: [ProposedSlotStatus.PENDING, ProposedSlotStatus.CONFIRMED] }
    },
    data: { status: ProposedSlotStatus.CANCELLED }
  });
  await tx.interview.update({
    where: { id: interviewId },
    data: {
      status: InterviewStatus.CANCELLED,
      confirmedStartAt: null,
      confirmedEndAt: null
    }
  });
}

async function findOrCreateStage(
  tx: Prisma.TransactionClient,
  userId: string,
  applicationId: string,
  input: BrowserMessageRegistrationInput
) {
  const existing = await tx.selectionStage.findFirst({
    where: {
      userId,
      applicationId,
      type: input.stageType,
      deletedAt: null,
      status: { not: StageStatus.CANCELLED }
    },
    orderBy: { order: "desc" }
  });
  if (existing) return existing;

  const lastStage = await tx.selectionStage.findFirst({
    where: { applicationId, deletedAt: null },
    orderBy: { order: "desc" },
    select: { order: true }
  });
  const stage = await tx.selectionStage.create({
    data: {
      userId,
      applicationId,
      type: input.stageType,
      name: input.stageName,
      status: StageStatus.IN_PROGRESS,
      order: (lastStage?.order ?? 0) + 1
    }
  });
  await tx.activityLog.create({
    data: {
      userId,
      applicationId,
      action: ActivityAction.STAGE_CREATED,
      message: "企業メッセージから選考フェーズを追加しました"
    }
  });
  return stage;
}

function createImport(
  tx: Prisma.TransactionClient,
  userId: string,
  applicationId: string,
  input: BrowserMessageRegistrationInput,
  idempotencyKey: string,
  interviewId: string
) {
  return tx.browserMessageImport.create({
    data: {
      userId,
      applicationId,
      interviewId,
      sourceSite: input.sourceSite,
      eventType: input.eventType as BrowserMessageEventType,
      messageDigest: input.messageDigest,
      idempotencyKey
    }
  });
}

function findDuplicate(
  userId: string,
  applicationId: string | undefined,
  messageDigest: string,
  idempotencyKey: string
) {
  return prisma.browserMessageImport.findFirst({
    where: {
      userId,
      OR: [
        { idempotencyKey },
        ...(applicationId ? [{ applicationId, messageDigest }] : [])
      ]
    },
    select: { applicationId: true, interviewId: true, eventType: true }
  });
}

function duplicateResponse(
  duplicate: { applicationId: string; interviewId: string | null; eventType: BrowserMessageEventType },
  requestUrl: string
) {
  return browserExtensionJson({
    ok: true,
    result: "existing",
    applicationId: duplicate.applicationId,
    interviewId: duplicate.interviewId,
    eventType: duplicate.eventType,
    applicationUrl: new URL(`/applications/${duplicate.applicationId}`, requestUrl).toString()
  });
}

function canAdvanceApplication(status: ApplicationStatus) {
  const statuses = new Set<ApplicationStatus>([
    ApplicationStatus.DRAFT,
    ApplicationStatus.APPLIED,
    ApplicationStatus.DOCUMENT_SCREENING,
    ApplicationStatus.INTERVIEWING
  ]);
  return statuses.has(status);
}

async function resolveTargetApplication(
  tx: Prisma.TransactionClient,
  userId: string,
  input: BrowserMessageRegistrationInput
) {
  if (input.applicationId) {
    const application = await tx.application.findFirst({
      where: { id: input.applicationId, userId, deletedAt: null }
    });
    if (!application) throw new RegistrationError("応募先が見つかりません");
    return { application, created: false };
  }

  let company = input.companyId
    ? await tx.company.findFirst({
        where: { id: input.companyId, userId }
      })
    : null;
  if (input.companyId && !company) {
    throw new RegistrationError("統合先の企業が見つかりません");
  }

  if (!company) {
    const companies = await tx.company.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" }
    });
    company = companies.find((candidate) =>
      isExactCompanyName(candidate.name, input.companyName)
    ) ?? null;
  }

  if (!company) {
    company = await tx.company.create({
      data: { userId, name: input.companyName }
    });
  }

  const companyApplications = await tx.application.findMany({
    where: { userId, companyId: company.id, deletedAt: null },
    orderBy: { createdAt: "asc" }
  });
  const exactApplication = companyApplications.find((application) =>
    isExactMatchText(application.position, input.position)
  );
  if (exactApplication) {
    return { application: exactApplication, created: false };
  }

  const application = await tx.application.create({
    data: {
      userId,
      companyId: company.id,
      position: input.position,
      applicationType: input.applicationType,
      route: ApplicationRoute.JOB_BOARD,
      status: ApplicationStatus.DRAFT,
      priority: Priority.MEDIUM,
      sourceSite: input.sourceSite
    }
  });
  await tx.activityLog.create({
    data: {
      userId,
      applicationId: application.id,
      action: ActivityAction.APPLICATION_CREATED,
      message: `企業メッセージから ${company.name} / ${application.position} を登録しました`,
      metadata: { sourceSite: input.sourceSite }
    }
  });
  return { application, created: true };
}

class RegistrationError extends Error {}
