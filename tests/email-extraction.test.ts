import { describe, expect, it } from "vitest";
import {
  EMAIL_EXTRACTION_JSON_SCHEMA,
  estimateEmailExtractionUsageCeiling,
  extractTextFromOpenAIResponse,
  normalizeEmailExtraction
} from "@/features/email-import/extraction";
import {
  emailAiExtractionSchema,
  recoverEmailAiExtraction
} from "@/features/email-import/schema";
import { getEmailImportConfirmDefaults } from "@/features/email-import/defaults";
import { autoRegistrationInput } from "@/features/email-import/automation";

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
  it("recovers a useful result conservatively when provider JSON misses metadata", () => {
    const recovered = recoverEmailAiExtraction(validExtraction(), {
      timezone: "Asia/Tokyo"
    });

    expect(recovered).toMatchObject({
      relevant: false,
      eventType: "INFORMATION_ONLY",
      companyName: "Example Inc.",
      confidence: 0,
      fieldConfidence: { companyName: 0 },
      evidence: { companyName: null }
    });
  });

  it("adds the user timezone to otherwise valid local datetimes", () => {
    const value = validExtraction();
    value.proposedSlots[0].startAt = "2026-07-12T19:00:00";
    value.proposedSlots[0].endAt = "2026-07-12T20:00:00";

    const recovered = recoverEmailAiExtraction(value, {
      timezone: "Asia/Tokyo"
    });

    expect(recovered?.proposedSlots[0]).toMatchObject({
      startAt: "2026-07-12T10:00:00.000Z",
      endAt: "2026-07-12T11:00:00.000Z"
    });
  });

  it("unwraps known field envelopes without putting JSON in company fields", () => {
    const wrapped = {
      relevant: { value: true, confidence: 0.99, excerpt: "面接のご案内" },
      eventType: {
        value: "CREATE_OR_UPDATE",
        confidence: 0.99,
        excerpt: "面接のご案内"
      },
      companyName: JSON.stringify({
        value: "株式会社MSOL Digital",
        confidence: 0.99,
        excerpt: "株式会社MSOL Digitalの採用担当"
      }),
      position: { value: "エンジニア", confidence: 0.99, excerpt: "募集職種" },
      stageType: { value: "FIRST_INTERVIEW", confidence: 0.99, excerpt: "一次面接" },
      stageName: { value: "一次面接", confidence: 0.99, excerpt: "一次面接" },
      proposedSlots: { value: [], confidence: 0.99, excerpt: null },
      confirmedSlot: {
        value: {
          startAt: "2026-08-20T19:00:00+09:00",
          endAt: "2026-08-20T20:00:00+09:00",
          timezone: "Asia/Tokyo"
        },
        confidence: 0.99,
        excerpt: "日時 2026/8/20(木) 19:00 - 20:00"
      },
      replyDeadline: { value: null, confidence: 0.99, excerpt: null },
      offerAcceptanceDeadline: { value: null, confidence: 0.99, excerpt: null },
      meetingUrl: { value: null, confidence: 0.99, excerpt: null },
      interviewerName: { value: null, confidence: 0.99, excerpt: null },
      confidence: 0.99
    };

    const recovered = recoverEmailAiExtraction(wrapped, {
      timezone: "Asia/Tokyo"
    });

    expect(recovered).toMatchObject({
      companyName: "株式会社MSOL Digital",
      confirmedSlot: {
        startAt: "2026-08-20T19:00:00+09:00",
        endAt: "2026-08-20T20:00:00+09:00"
      },
      confidence: 0.99,
      fieldConfidence: { companyName: 0.99, confirmedSlot: 0.99 }
    });
    expect(autoRegistrationInput(recovered!, "Asia/Tokyo")).not.toBeNull();
    expect(
      autoRegistrationInput(
        { ...recovered!, fieldConfidence: { ...recovered!.fieldConfidence, confirmedSlot: 0.89 } },
        "Asia/Tokyo"
      )
    ).toBeNull();
    expect(
      autoRegistrationInput(
        { ...recovered!, companyName: '{"value":"株式会社MSOL Digital","extra":true}' },
        "Asia/Tokyo"
      )
    ).toBeNull();
  });

  it("fills an exact Japanese date range for review without inventing confidence", () => {
    const recovered = recoverEmailAiExtraction(
      {
        companyName: "Example Inc.",
        evidence: { confirmedSlot: "日時 2026/8/20(木) 19:00 - 20:00" }
      },
      { timezone: "Asia/Tokyo" }
    );

    expect(recovered?.confirmedSlot).toEqual({
      startAt: "2026-08-20T10:00:00.000Z",
      endAt: "2026-08-20T11:00:00.000Z",
      timezone: "Asia/Tokyo"
    });
    expect(recovered?.fieldConfidence.confirmedSlot).toBe(0);
  });

  it("does not normalize an impossible Japanese date range", () => {
    const recovered = recoverEmailAiExtraction(
      {
        companyName: "Example Inc.",
        evidence: { confirmedSlot: "日時 2026/13/40 19:00 - 20:00" }
      },
      { timezone: "Asia/Tokyo" }
    );

    expect(recovered?.confirmedSlot.startAt).toBeNull();
  });

  it("formats confirmation datetimes in the user's timezone", () => {
    const extraction = emailAiExtractionSchema.parse({
      relevant: true,
      eventType: "CREATE_OR_UPDATE",
      ...validExtraction(),
      confirmedSlot: {
        startAt: "2026-08-20T10:00:00.000Z",
        endAt: "2026-08-20T11:00:00.000Z",
        timezone: "Asia/Tokyo"
      },
      fieldConfidence: Object.fromEntries(
        [
          "relevant", "eventType", "companyName", "position", "stageType",
          "stageName", "proposedSlots", "confirmedSlot", "replyDeadline",
          "offerAcceptanceDeadline", "meetingUrl", "interviewerName"
        ].map((key) => [key, 0.99])
      ),
      evidence: Object.fromEntries(
        [
          "relevant", "eventType", "companyName", "position", "stageType",
          "stageName", "proposedSlots", "confirmedSlot", "replyDeadline",
          "offerAcceptanceDeadline", "meetingUrl", "interviewerName"
        ].map((key) => [key, null])
      )
    });

    const defaults = getEmailImportConfirmDefaults(extraction, "Asia/Tokyo");
    expect(defaults.confirmedStartAt).toBe("2026-08-20T19:00");
    expect(defaults.confirmedEndAt).toBe("2026-08-20T20:00");
  });

  it("does not turn metadata-only JSON into a successful extraction", () => {
    expect(
      recoverEmailAiExtraction(
        { confidence: 0.9, relevant: true, eventType: "CREATE_OR_UPDATE" },
        { timezone: "Asia/Tokyo" }
      )
    ).toBeUndefined();
  });

  it.each([
    { proposedSlots: [{}] },
    { confirmedSlot: { startAt: "garbage" } },
    { replyDeadline: "not-a-date" }
  ])("does not recover malformed core data as an empty success", (value) => {
    expect(
      recoverEmailAiExtraction(value, { timezone: "Asia/Tokyo" })
    ).toBeUndefined();
  });

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
