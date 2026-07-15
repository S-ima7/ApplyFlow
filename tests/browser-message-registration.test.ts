import {
  ApplicationStatus,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getBrowserMessageRegistrationState } from "@/features/browser-extension/message-registration";

const emptyConfirmed = { startAt: null, endAt: null, timezone: null };

describe("browser message registration state", () => {
  it("maps a confirmed time to dashboard-visible interview state", () => {
    const state = getBrowserMessageRegistrationState({
      eventType: "CREATE_OR_UPDATE",
      confirmedSlot: {
        startAt: "2026-07-20T10:00:00+09:00",
        endAt: "2026-07-20T11:00:00+09:00",
        timezone: "Asia/Tokyo"
      },
      proposedSlots: []
    });
    expect(state.applicationStatus).toBe(ApplicationStatus.INTERVIEWING);
    expect(state.stageStatus).toBe(StageStatus.SCHEDULED);
    expect(state.interviewStatus).toBe(InterviewStatus.CONFIRMED);
    expect(state.proposedSlotStatus).toBe(ProposedSlotStatus.CONFIRMED);
  });

  it("maps candidates to waiting reply", () => {
    const state = getBrowserMessageRegistrationState({
      eventType: "CREATE_OR_UPDATE",
      confirmedSlot: emptyConfirmed,
      proposedSlots: [
        {
          startAt: "2026-07-20T10:00:00+09:00",
          endAt: "2026-07-20T11:00:00+09:00",
          timezone: "Asia/Tokyo"
        }
      ]
    });
    expect(state.stageStatus).toBe(StageStatus.WAITING_REPLY);
    expect(state.interviewStatus).toBe(InterviewStatus.WAITING_REPLY);
    expect(state.proposedSlotStatus).toBe(ProposedSlotStatus.PENDING);
  });

  it("clears the schedule when cancellation is confirmed", () => {
    const state = getBrowserMessageRegistrationState({
      eventType: "CANCEL",
      confirmedSlot: emptyConfirmed,
      proposedSlots: []
    });
    expect(state.stageStatus).toBe(StageStatus.CANCELLED);
    expect(state.interviewStatus).toBe(InterviewStatus.CANCELLED);
    expect(state.clearsConfirmedSchedule).toBe(true);
  });
});
