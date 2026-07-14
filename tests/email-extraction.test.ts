import { describe, expect, it } from "vitest";
import {
  extractTextFromOpenAIResponse,
  normalizeEmailExtraction
} from "@/features/email-import/extraction";

function validExtraction() {
  return {
    companyName: "Example Inc.",
    position: "Frontend Engineer",
    stageType: "FIRST_INTERVIEW",
    stageName: "一次面接",
    proposedSlots: [
      {
        startAt: "2026-07-12T19:00:00+09:00",
        endAt: "2026-07-12T20:00:00+09:00",
        timezone: "Asia/Tokyo"
      }
    ],
    confirmedSlot: {
      startAt: null,
      endAt: null,
      timezone: null
    },
    replyDeadline: "2026-07-10T12:00:00+09:00",
    offerAcceptanceDeadline: null,
    meetingUrl: "https://meet.google.com/example",
    interviewerName: "Recruiter",
    confidence: 0.86
  };
}

describe("normalizeEmailExtraction", () => {
  it("accepts valid extraction JSON", () => {
    const result = normalizeEmailExtraction(validExtraction());
    expect(result.ok).toBe(true);
  });

  it("rejects datetime without explicit timezone", () => {
    const value = validExtraction();
    value.proposedSlots[0].startAt = "2026-07-12T19:00:00";

    const result = normalizeEmailExtraction(value);
    expect(result.ok).toBe(false);
  });
});

describe("extractTextFromOpenAIResponse", () => {
  it("reads output_text when present", () => {
    expect(extractTextFromOpenAIResponse({ output_text: "{\"ok\":true}" })).toBe(
      "{\"ok\":true}"
    );
  });

  it("falls back to output content text", () => {
    expect(
      extractTextFromOpenAIResponse({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "{\"ok\":true}"
              }
            ]
          }
        ]
      })
    ).toBe("{\"ok\":true}");
  });
});
