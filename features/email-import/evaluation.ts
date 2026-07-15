import type { EmailExtraction } from "@/features/email-import/schema";

export type EmailExtractionExpectation = Partial<
  Pick<
    EmailExtraction,
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
