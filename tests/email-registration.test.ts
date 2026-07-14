import {
  ApplicationStatus,
  DeadlineType,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildEmailImportRegistrationData } from "@/features/email-import/registration";
import type { EmailImportConfirmInput } from "@/features/email-import/schema";

function baseInput(): EmailImportConfirmInput {
  return {
    companyName: "Example Inc.",
    position: "Frontend Engineer",
    applicationType: "CAREER_CHANGE",
    route: "DIRECT",
    priority: "HIGH",
    stageType: "FIRST_INTERVIEW",
    stageName: "一次面接",
    confirmedStartAt: undefined,
    confirmedEndAt: undefined,
    proposedSlots: [],
    replyDeadlineAt: undefined,
    offerAcceptanceDeadlineAt: undefined,
    meetingUrl: undefined,
    interviewerName: undefined,
    note: undefined
  };
}

describe("buildEmailImportRegistrationData", () => {
  it("prioritizes a confirmed slot and creates a confirmed proposed slot", () => {
    const input = baseInput();
    input.confirmedStartAt = "2026-07-12T19:00";
    input.confirmedEndAt = "2026-07-12T20:00";
    input.replyDeadlineAt = "2026-07-10T12:00";
    input.offerAcceptanceDeadlineAt = "2026-07-20T12:00";

    const result = buildEmailImportRegistrationData(input);

    expect(result.applicationStatus).toBe(ApplicationStatus.INTERVIEWING);
    expect(result.stageStatus).toBe(StageStatus.SCHEDULED);
    expect(result.interviewStatus).toBe(InterviewStatus.CONFIRMED);
    expect(result.proposedSlots[0]?.status).toBe(ProposedSlotStatus.CONFIRMED);
    expect(result.deadlines.map((deadline) => deadline.type)).toEqual([
      DeadlineType.REPLY_DEADLINE,
      DeadlineType.OFFER_ACCEPTANCE
    ]);
    expect(result.confirmedSlot?.startAt.toISOString()).toBe(
      "2026-07-12T10:00:00.000Z"
    );
  });

  it("uses waiting reply statuses when only proposed slots exist", () => {
    const input = baseInput();
    input.proposedSlots = [
      {
        startAt: "2026-07-12T19:00",
        endAt: "2026-07-12T20:00",
        timezone: "Asia/Tokyo",
        note: undefined
      }
    ];

    const result = buildEmailImportRegistrationData(input);

    expect(result.applicationStatus).toBe(ApplicationStatus.INTERVIEWING);
    expect(result.stageStatus).toBe(StageStatus.WAITING_REPLY);
    expect(result.interviewStatus).toBe(InterviewStatus.WAITING_REPLY);
    expect(result.proposedSlots[0]?.status).toBe(ProposedSlotStatus.PENDING);
  });
});
