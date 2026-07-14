import {
  ApplicationStatus,
  DeadlineType,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import type { EmailImportConfirmInput } from "@/features/email-import/schema";
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

function requireDate(value: string, timezone: string) {
  const date = parseDateTimeInTimezone(value, timezone);

  if (!date) {
    throw new Error("Invalid local datetime");
  }

  return date;
}
