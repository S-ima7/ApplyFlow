import { describe, expect, it } from "vitest";
import { scoreEmailExtraction } from "@/features/email-import/evaluation";
import { extractEmailWithOpenAI } from "@/features/email-import/extraction";
import type { EmailExtraction } from "@/features/email-import/schema";

describe("scoreEmailExtraction", () => {
  it("scores scalar and datetime fields using normalized values", () => {
    const actual = baseExtraction();
    const result = scoreEmailExtraction(actual, {
      companyName: "example株式会社",
      stageType: "FIRST_INTERVIEW",
      confirmedStartAt: "2026-07-15T19:00:00+09:00"
    });

    expect(result).toEqual({ passed: 3, total: 3, score: 1 });
  });
});

describe.skipIf(process.env.RUN_OPENAI_EVALS !== "1")(
  "OpenAI email extraction evaluation",
  () => {
    it.each([
      {
        name: "latest reschedule overrides quoted history",
        bodyText: `Example株式会社 採用担当です。一次面接を7月16日(木) 19:00〜20:00へ変更します。

On previous message wrote:
> 一次面接は7月15日(水) 18:00〜19:00です。`,
        expected: {
          companyName: "Example株式会社",
          stageType: "FIRST_INTERVIEW" as const,
          confirmedStartAt: "2026-07-16T19:00:00+09:00"
        }
      },
      {
        name: "multiple proposed slots",
        bodyText: `Example株式会社の一次面接について、以下から候補をお知らせください。
7月20日 10:00〜11:00
7月21日 14:00〜15:00`,
        expected: {
          companyName: "Example株式会社",
          stageType: "FIRST_INTERVIEW" as const,
          proposedSlotStarts: [
            "2026-07-20T10:00:00+09:00",
            "2026-07-21T14:00:00+09:00"
          ]
        }
      },
      {
        name: "offer acceptance deadline",
        bodyText: `Example株式会社です。内定承諾期限は7月31日 17:00です。`,
        expected: {
          companyName: "Example株式会社",
          offerAcceptanceDeadline: "2026-07-31T17:00:00+09:00"
        }
      }
    ])("keeps critical-field accuracy for $name", async ({ bodyText, expected }) => {
      const result = await extractEmailWithOpenAI(
        {
          id: "evaluation-message",
          subject: "選考のご案内",
          fromAddress: "recruit@example.com",
          sentAt: new Date("2026-07-14T03:00:00.000Z"),
          bodyText
        },
        "Asia/Tokyo",
        new Date("2026-07-14T03:00:00.000Z")
      );

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(scoreEmailExtraction(result.data, expected).score).toBeGreaterThanOrEqual(
          0.9
        );
      }
    });
  }
);

function baseExtraction(): EmailExtraction {
  return {
    companyName: "Example株式会社",
    position: "Frontend Engineer",
    stageType: "FIRST_INTERVIEW",
    stageName: "一次面接",
    proposedSlots: [],
    confirmedSlot: {
      startAt: "2026-07-15T19:00:00+09:00",
      endAt: "2026-07-15T20:00:00+09:00",
      timezone: "Asia/Tokyo"
    },
    replyDeadline: null,
    offerAcceptanceDeadline: null,
    meetingUrl: null,
    interviewerName: null,
    confidence: 0.9
  };
}
