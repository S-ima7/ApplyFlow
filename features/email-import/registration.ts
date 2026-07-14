import {
  ApplicationStatus,
  DeadlineType,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import type { EmailImportConfirmInput } from "@/features/email-import/schema";

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
  input: EmailImportConfirmInput
): EmailImportRegistrationData {
  const confirmedSlot =
    input.confirmedStartAt && input.confirmedEndAt
      ? {
          startAt: new Date(input.confirmedStartAt),
          endAt: new Date(input.confirmedEndAt),
          timezone: "Asia/Tokyo"
        }
      : undefined;

  const proposedSlots = input.proposedSlots.map((slot) => ({
    startAt: new Date(slot.startAt),
    endAt: new Date(slot.endAt),
    timezone: slot.timezone || "Asia/Tokyo",
    note: slot.note,
    status: ProposedSlotStatus.PENDING
  }));

  const deadlines = [
    input.replyDeadlineAt
      ? {
          type: DeadlineType.REPLY_DEADLINE,
          title: "返信期限",
          dueAt: new Date(input.replyDeadlineAt)
        }
      : null,
    input.offerAcceptanceDeadlineAt
      ? {
          type: DeadlineType.OFFER_ACCEPTANCE,
          title: "承諾期限",
          dueAt: new Date(input.offerAcceptanceDeadlineAt)
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
