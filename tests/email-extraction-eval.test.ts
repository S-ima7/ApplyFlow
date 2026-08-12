import { describe, expect, it } from "vitest";
import {
  emailExtractionEvaluationCases,
  scoreEmailExtraction
} from "@/features/email-import/evaluation";
import { extractEmailWithAi } from "@/features/email-import/extraction";
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

describe.skipIf(process.env.RUN_CLOUDFLARE_EVALS !== "1")(
  "Cloudflare Workers AI gpt-oss email extraction evaluation",
  () => {
    it.each(emailExtractionEvaluationCases)(
      "keeps critical-field accuracy for $name",
      async ({ bodyText, expected }) => {
      const result = await extractEmailWithAi(
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
        expect(result.metadata.provider).toBe("cloudflare-workers-ai");
        expect(result.metadata.model).toBe("@cf/openai/gpt-oss-120b");
        expect(result.metadata.usage.totalTokens).toBeGreaterThan(0);
        expect(scoreEmailExtraction(result.data, expected).score).toBeGreaterThanOrEqual(
          0.9
        );
      }
      }
    );
  }
);

function baseExtraction(): EmailExtraction {
  return {
    relevant: true,
    eventType: "CREATE_OR_UPDATE",
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
