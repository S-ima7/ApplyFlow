import {
  ApplicationStatus,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import type { BrowserMessageRegistrationInput } from "@/features/browser-extension/contracts";

export type BrowserMessageRegistrationState = {
  applicationStatus?: ApplicationStatus;
  stageStatus: StageStatus;
  interviewStatus: InterviewStatus;
  proposedSlotStatus?: ProposedSlotStatus;
  clearsConfirmedSchedule: boolean;
};

export function getBrowserMessageRegistrationState(
  input: Pick<BrowserMessageRegistrationInput, "eventType" | "confirmedSlot" | "proposedSlots">
): BrowserMessageRegistrationState {
  if (input.eventType === "CANCEL") {
    return {
      stageStatus: StageStatus.CANCELLED,
      interviewStatus: InterviewStatus.CANCELLED,
      clearsConfirmedSchedule: true
    };
  }

  if (input.confirmedSlot.startAt && input.confirmedSlot.endAt) {
    return {
      applicationStatus: ApplicationStatus.INTERVIEWING,
      stageStatus: StageStatus.SCHEDULED,
      interviewStatus: InterviewStatus.CONFIRMED,
      proposedSlotStatus: ProposedSlotStatus.CONFIRMED,
      clearsConfirmedSchedule: false
    };
  }

  return {
    applicationStatus: ApplicationStatus.INTERVIEWING,
    stageStatus: StageStatus.WAITING_REPLY,
    interviewStatus: InterviewStatus.WAITING_REPLY,
    proposedSlotStatus: ProposedSlotStatus.PENDING,
    clearsConfirmedSchedule: true
  };
}
