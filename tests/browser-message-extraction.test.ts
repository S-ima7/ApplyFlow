import { describe, expect, it } from "vitest";
import {
  BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA,
  browserMessageExtractionSchema,
  buildBrowserMessagePrompt
} from "@/features/browser-extension/message-extraction";

describe("browser message extraction", () => {
  it("normalizes a reschedule with an explicit timezone", () => {
    const result = browserMessageExtractionSchema.safeParse({
      eventType: "RESCHEDULE",
      companyName: "Example株式会社",
      position: "Webエンジニア",
      stageType: "FIRST_INTERVIEW",
      stageName: "一次面接",
      proposedSlots: [],
      confirmedSlot: {
        startAt: "2026-07-20T10:00:00+09:00",
        endAt: "2026-07-20T11:00:00+09:00",
        timezone: "Asia/Tokyo"
      },
      replyDeadline: null,
      offerAcceptanceDeadline: null,
      meetingUrl: "https://meet.google.com/example",
      interviewerName: null,
      confidence: 0.92
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.relevant).toBe(true);
    }
  });

  it("requires eventType in the strict AI response contract", () => {
    expect(BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA.required).toContain("eventType");
    expect(BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA.required).toContain("relevant");
    expect(BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA.required).toContain("fieldConfidence");
    expect(BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA.properties.eventType.enum).toEqual([
      "CREATE_OR_UPDATE",
      "RESCHEDULE",
      "CANCEL"
    ]);
  });

  it("sends the selected text and reference time, not the page body", () => {
    const prompt = buildBrowserMessagePrompt(
      {
        sourceSite: "GREEN",
        sourceUrl: "https://www.green-japan.com/messages/123",
        selectedText: "選択したメッセージ本文",
        pageTitle: "メッセージ",
        capturedAt: "2026-07-15T12:00:00+09:00",
        consentToAiProcessing: true
      },
      "Asia/Tokyo",
      new Date("2026-07-15T03:00:00Z")
    );
    expect(prompt).toContain("選択したメッセージ本文");
    expect(prompt).toContain("Asia/Tokyo");
    expect(prompt).not.toContain("https://www.green-japan.com/messages/123");
  });
});
