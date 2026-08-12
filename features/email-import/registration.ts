import {
  ActivityAction,
  ApplicationStatus,
  DeadlineStatus,
  DeadlineType,
  InterviewStatus,
  Prisma,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import type { EmailImportConfirmInput } from "@/features/email-import/schema";
import { isExactCompanyName } from "@/features/browser-extension/application-matching";
import { parseDateTimeInTimezone } from "@/lib/date";

export type EmailImportRegistrationData = {
  applicationStatus: ApplicationStatus;
  stageStatus: StageStatus;
  interviewStatus: InterviewStatus;
  confirmedSlot?: {
    startAt: Date;
    endAt: Date;
    timezone: string;
  };
  proposedSlots: Array<{
    startAt: Date;
    endAt: Date;
    timezone: string;
    note?: string;
    status: ProposedSlotStatus;
  }>;
  deadlines: Array<{
    type: DeadlineType;
    title: string;
    dueAt: Date;
  }>;
};

export function buildEmailImportRegistrationData(
  input: EmailImportConfirmInput,
  userTimezone = "Asia/Tokyo"
): EmailImportRegistrationData {
  const confirmedSlot =
    input.confirmedStartAt && input.confirmedEndAt
      ? {
          startAt: requireDate(input.confirmedStartAt, userTimezone),
          endAt: requireDate(input.confirmedEndAt, userTimezone),
          timezone: userTimezone
        }
      : undefined;

  const proposedSlots = input.proposedSlots.map((slot) => {
    const timezone = slot.timezone || userTimezone;

    return {
      startAt: requireDate(slot.startAt, timezone),
      endAt: requireDate(slot.endAt, timezone),
      timezone,
      note: slot.note,
      status: ProposedSlotStatus.PENDING
    };
  });

  const deadlines = [
    input.replyDeadlineAt
      ? {
          type: DeadlineType.REPLY_DEADLINE,
          title: "返信期限",
          dueAt: requireDate(input.replyDeadlineAt, userTimezone)
        }
      : null,
    input.offerAcceptanceDeadlineAt
      ? {
          type: DeadlineType.OFFER_ACCEPTANCE,
          title: "承諾期限",
          dueAt: requireDate(input.offerAcceptanceDeadlineAt, userTimezone)
        }
      : null
  ].filter((deadline): deadline is NonNullable<typeof deadline> => Boolean(deadline));

  if (confirmedSlot) {
    return {
      applicationStatus: ApplicationStatus.INTERVIEWING,
      stageStatus: StageStatus.SCHEDULED,
      interviewStatus: InterviewStatus.CONFIRMED,
      confirmedSlot,
      proposedSlots: [
        {
          ...confirmedSlot,
          status: ProposedSlotStatus.CONFIRMED
        },
        ...proposedSlots
      ],
      deadlines
    };
  }

  if (proposedSlots.length > 0) {
    return {
      applicationStatus: ApplicationStatus.INTERVIEWING,
      stageStatus: StageStatus.WAITING_REPLY,
      interviewStatus: InterviewStatus.WAITING_REPLY,
      proposedSlots,
      deadlines
    };
  }

  return {
    applicationStatus: ApplicationStatus.APPLIED,
    stageStatus: StageStatus.IN_PROGRESS,
    interviewStatus: InterviewStatus.DRAFT,
    proposedSlots: [],
    deadlines
  };
}

export async function createEmailImportApplication(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    timezone: string;
    data: EmailImportConfirmInput;
    slotSource?: string;
  }
) {
  const registration = buildEmailImportRegistrationData(
    input.data,
    input.timezone
  );
  const companies = await tx.company.findMany({
    where: { userId: input.userId },
    orderBy: { createdAt: "asc" }
  });
  const company =
    companies.find((candidate) =>
      isExactCompanyName(candidate.name, input.data.companyName)
    ) ??
    (await tx.company.create({
      data: { userId: input.userId, name: input.data.companyName }
    }));
  const application = await tx.application.create({
    data: {
      userId: input.userId,
      companyId: company.id,
      position: input.data.position,
      applicationType: input.data.applicationType,
      route: input.data.route,
      status: registration.applicationStatus,
      priority: input.data.priority,
      note: input.data.note
    }
  });
  const stage = await tx.selectionStage.create({
    data: {
      userId: input.userId,
      applicationId: application.id,
      type: input.data.stageType,
      name: input.data.stageName,
      status: registration.stageStatus,
      order: 1,
      scheduledAt: registration.confirmedSlot?.startAt
    }
  });
  const interview = await tx.interview.create({
    data: {
      userId: input.userId,
      selectionStageId: stage.id,
      status: registration.interviewStatus,
      title: input.data.stageName,
      meetingUrl: input.data.meetingUrl,
      interviewerName: input.data.interviewerName,
      confirmedStartAt: registration.confirmedSlot?.startAt,
      confirmedEndAt: registration.confirmedSlot?.endAt
    }
  });

  if (registration.proposedSlots.length > 0) {
    await tx.proposedSlot.createMany({
      data: registration.proposedSlots.map((slot) => ({
        userId: input.userId,
        interviewId: interview.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: slot.timezone,
        status: slot.status,
        source: input.slotSource ?? "gmail",
        note: slot.note
      }))
    });
  }
  if (registration.deadlines.length > 0) {
    await tx.deadline.createMany({
      data: registration.deadlines.map((deadline) => ({
        userId: input.userId,
        applicationId: application.id,
        type: deadline.type,
        status: DeadlineStatus.OPEN,
        title: deadline.title,
        dueAt: deadline.dueAt
      }))
    });
  }

  const logs = [
    {
      userId: input.userId,
      applicationId: application.id,
      action: ActivityAction.APPLICATION_CREATED,
      message: `Gmailから ${input.data.companyName} / ${input.data.position} を登録しました`
    },
    {
      userId: input.userId,
      applicationId: application.id,
      action: ActivityAction.STAGE_CREATED,
      message: "メール抽出から選考フェーズを追加しました"
    },
    {
      userId: input.userId,
      applicationId: application.id,
      action: ActivityAction.INTERVIEW_CREATED,
      message: "メール抽出から面談を追加しました"
    },
    ...(registration.proposedSlots.length > 0
      ? [{
          userId: input.userId,
          applicationId: application.id,
          action: ActivityAction.PROPOSED_SLOT_CREATED,
          message: `メール抽出から候補日時を${registration.proposedSlots.length}件追加しました`
        }]
      : []),
    ...(registration.deadlines.length > 0
      ? [{
          userId: input.userId,
          applicationId: application.id,
          action: ActivityAction.DEADLINE_CREATED,
          message: `メール抽出から期限を${registration.deadlines.length}件追加しました`
        }]
      : [])
  ];
  await tx.activityLog.createMany({ data: logs });
  return application;
}

function requireDate(value: string, timezone: string) {
  const date = parseDateTimeInTimezone(value, timezone);

  if (!date) {
    throw new Error("Invalid local datetime");
  }

  return date;
}
