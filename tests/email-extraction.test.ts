import { describe, expect, it } from "vitest";
import {
  EMAIL_EXTRACTION_JSON_SCHEMA,
  estimateEmailExtractionUsageCeiling,
  extractTextFromOpenAIResponse,
  normalizeEmailExtraction
} from "@/features/email-import/extraction";
import { emailAiExtractionSchema } from "@/features/email-import/schema";

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

    if (result.ok) {
      expect(result.data).toMatchObject({
        relevant: true,
        eventType: "CREATE_OR_UPDATE"
      });
      expect(result.metadata.usage.totalTokens).toBe(0);
    }
  });

  it("rejects datetime without explicit timezone", () => {
    const value = validExtraction();
    value.proposedSlots[0].startAt = "2026-07-12T19:00:00";

    const result = normalizeEmailExtraction(value);
    expect(result.ok).toBe(false);
  });
});

describe("strict AI extraction contract", () => {
  it("includes large multibyte email input in the preflight usage ceiling", () => {
    const email = {
      id: "message-1",
      threadId: "thread-1",
      subject: "選考日程",
      fromAddress: "recruiter@example.com",
      sentAt: new Date("2026-07-27T00:00:00.000Z"),
      internalDate: new Date("2026-07-27T00:00:00.000Z"),
      snippet: "一次面接の日程です",
      bodyText: "面接候補日時です。".repeat(1_000)
    };

    expect(
      estimateEmailExtractionUsageCeiling(
        email,
        "Asia/Tokyo",
        new Date("2026-07-27T00:00:00.000Z")
      ).inputTokens
    ).toBeGreaterThan(20_000);
  });

  it("requires relevance, event type, field confidences, and evidence", () => {
    expect(EMAIL_EXTRACTION_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining([
        "relevant",
        "eventType",
        "fieldConfidence",
        "evidence"
      ])
    );
    expect(EMAIL_EXTRACTION_JSON_SCHEMA.properties.eventType.enum).toEqual([
      "CREATE_OR_UPDATE",
      "RESCHEDULE",
      "CANCEL",
      "INFORMATION_ONLY"
    ]);
    expect(
      emailAiExtractionSchema.safeParse(validExtraction()).success
    ).toBe(false);
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
