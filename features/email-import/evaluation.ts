import type { EmailExtraction } from "@/features/email-import/schema";

export type EmailExtractionExpectation = Partial<
  Pick<
    EmailExtraction,
    | "relevant"
    | "eventType"
    | "companyName"
    | "position"
    | "stageType"
    | "stageName"
    | "replyDeadline"
    | "offerAcceptanceDeadline"
    | "meetingUrl"
    | "interviewerName"
  >
> & {
  proposedSlotStarts?: string[];
  confirmedStartAt?: string | null;
};

export function scoreEmailExtraction(
  actual: EmailExtraction,
  expected: EmailExtractionExpectation
) {
  const checks: boolean[] = [];

  for (const key of [
    "relevant",
    "eventType",
    "companyName",
    "position",
    "stageType",
    "stageName",
    "replyDeadline",
    "offerAcceptanceDeadline",
    "meetingUrl",
    "interviewerName"
  ] as const) {
    if (key in expected) {
      checks.push(normalize(actual[key]) === normalize(expected[key]));
    }
  }

  if (expected.confirmedStartAt !== undefined) {
    checks.push(
      normalizeDate(actual.confirmedSlot.startAt) ===
        normalizeDate(expected.confirmedStartAt)
    );
  }

  if (expected.proposedSlotStarts) {
    checks.push(
      JSON.stringify(actual.proposedSlots.map((slot) => normalizeDate(slot.startAt)).sort()) ===
        JSON.stringify(expected.proposedSlotStarts.map(normalizeDate).sort())
    );
  }

  const passed = checks.filter(Boolean).length;

  return {
    passed,
    total: checks.length,
    score: checks.length === 0 ? 1 : passed / checks.length
  };
}

export const emailExtractionEvaluationCases = [
  {
    name: "latest reschedule overrides quoted history",
    bodyText: `Example株式会社 採用担当です。Frontend Engineerの一次面接を7月16日(木) 19:00〜20:00へ変更します。

On previous message wrote:
> 一次面接は7月15日(水) 18:00〜19:00です。`,
    expected: {
      relevant: true,
      eventType: "RESCHEDULE",
      companyName: "Example株式会社",
      position: "Frontend Engineer",
      stageType: "FIRST_INTERVIEW",
      confirmedStartAt: "2026-07-16T19:00:00+09:00"
    }
  },
  {
    name: "multiple proposed slots",
    bodyText: `Example株式会社のFrontend Engineer一次面接について、以下から候補をお知らせください。
7月20日 10:00〜11:00
7月21日 14:00〜15:00`,
    expected: {
      relevant: true,
      eventType: "CREATE_OR_UPDATE",
      companyName: "Example株式会社",
      position: "Frontend Engineer",
      stageType: "FIRST_INTERVIEW",
      proposedSlotStarts: [
        "2026-07-20T10:00:00+09:00",
        "2026-07-21T14:00:00+09:00"
      ]
    }
  },
  {
    name: "explicit cancellation",
    bodyText:
      "Example株式会社のFrontend Engineer一次面接は採用計画変更のため中止となりました。",
    expected: {
      relevant: true,
      eventType: "CANCEL",
      companyName: "Example株式会社",
      position: "Frontend Engineer",
      stageType: "FIRST_INTERVIEW",
      confirmedStartAt: null,
      proposedSlotStarts: []
    }
  },
  {
    name: "irrelevant promotional message",
    bodyText:
      "転職活動に役立つオンラインセミナーのお知らせです。配信停止はフッターから行えます。",
    expected: {
      relevant: false,
      eventType: "INFORMATION_ONLY",
      confirmedStartAt: null,
      proposedSlotStarts: []
    }
  }
] as const satisfies ReadonlyArray<{
  name: string;
  bodyText: string;
  expected: EmailExtractionExpectation;
}>;

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function normalizeDate(value: string | null) {
  if (!value) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
