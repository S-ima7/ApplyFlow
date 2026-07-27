import { EmailAutomationJobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  getEmailMonitorConfigTransition,
  resolveEmailMonitorConsent
} from "@/features/email-monitor/config";
import { buildEmailMessageDigest } from "@/features/email-monitor/digest";
import {
  createEmailMonitorWorkerSignature,
  verifyEmailMonitorWorkerSignature
} from "@/features/email-monitor/internal-auth";
import { decideEmailAutomation } from "@/features/email-monitor/policy";
import {
  buildEmailMonitorGmailQuery,
  completeEmailMonitorScanPage,
  isWithinEmailMonitorActivationBoundary,
  startOrResumeEmailMonitorScan
} from "@/features/email-monitor/polling";
import type { EmailMonitorExtraction } from "@/features/email-monitor/schema";
import {
  getEmailAutomationRetryTransition,
  isEmailAutomationJobClaimable,
  nextUtcDay
} from "@/features/email-monitor/state-machine";
import {
  AI_TOKEN_RESERVATION_PER_REQUEST,
  canReserveAiTokens,
  toUtcUsageDate
} from "@/features/email-monitor/token-budget";

const highConfidence = {
  relevant: 0.99,
  eventType: 0.99,
  companyName: 0.99,
  position: 0.99,
  stageType: 0.99,
  stageName: 0.99,
  confirmedSlot: 0.99,
  proposedSlots: 0.99,
  replyDeadline: 0.99,
  offerAcceptanceDeadline: 0.99,
  meetingUrl: 0.99,
  interviewerName: 0.99
};

function extraction(
  overrides: Partial<EmailMonitorExtraction> = {}
): EmailMonitorExtraction {
  return {
    relevant: true,
    eventType: "CREATE_OR_UPDATE",
    companyName: "株式会社ApplyFlow",
    position: "Backend Engineer",
    stageType: "FIRST_INTERVIEW",
    stageName: "一次面接",
    proposedSlots: [],
    confirmedSlot: {
      startAt: "2026-07-28T10:00:00+09:00",
      endAt: "2026-07-28T11:00:00+09:00",
      timezone: "Asia/Tokyo"
    },
    replyDeadline: null,
    offerAcceptanceDeadline: null,
    meetingUrl: null,
    interviewerName: null,
    confidence: 0.99,
    fieldConfidence: highConfidence,
    ...overrides
  };
}

const applications = [
  {
    id: "app-1",
    companyName: "株式会社ApplyFlow",
    position: "Backend Engineer"
  }
];

const safeTarget = {
  matchingStageCount: 1,
  activeInterviewCount: 1,
  activeInterviewId: "interview-1",
  hasManualDataConflict: false,
  hasDeadlineConflict: false
};

describe("email monitor decision policy", () => {
  it("auto-applies only a high-confidence exact existing application", () => {
    expect(decideEmailAutomation(extraction(), applications, safeTarget)).toEqual({
      action: "AUTO_APPLY",
      applicationId: "app-1",
      interviewId: "interview-1"
    });
  });

  it.each([
    {
      name: "new application",
      value: decideEmailAutomation(extraction(), [], null),
      reason: "APPLICATION_NOT_UNIQUE"
    },
    {
      name: "ambiguous application",
      value: decideEmailAutomation(
        extraction(),
        [...applications, { ...applications[0], id: "app-2" }],
        safeTarget
      ),
      reason: "APPLICATION_NOT_UNIQUE"
    },
    {
      name: "cancellation",
      value: decideEmailAutomation(
        extraction({ eventType: "CANCEL" }),
        applications,
        safeTarget
      ),
      reason: "CANCEL_REQUIRES_CONFIRMATION"
    },
    {
      name: "manual conflict",
      value: decideEmailAutomation(extraction(), applications, {
        ...safeTarget,
        hasManualDataConflict: true
      }),
      reason: "MANUAL_DATA_CONFLICT"
    },
    {
      name: "field below threshold",
      value: decideEmailAutomation(
        extraction({
          fieldConfidence: { ...highConfidence, confirmedSlot: 0.89 }
        }),
        applications,
        safeTarget
      ),
      reason: "LOW_CONFIDENCE"
    }
  ])("routes $name to review without a domain mutation", ({ value, reason }) => {
    expect(value).toMatchObject({ action: "REVIEW_REQUIRED", reason });
  });

  it("ignores irrelevant mail", () => {
    expect(
      decideEmailAutomation(
        extraction({ relevant: false }),
        applications,
        safeTarget
      )
    ).toEqual({ action: "IGNORE", reason: "NOT_RELEVANT" });
  });

  it("reviews an irrelevant classification when routing confidence is low", () => {
    expect(
      decideEmailAutomation(
        extraction({
          relevant: false,
          fieldConfidence: { ...highConfidence, relevant: 0.89 }
        }),
        applications,
        safeTarget
      )
    ).toEqual({ action: "REVIEW_REQUIRED", reason: "LOW_CONFIDENCE" });
  });
});

describe("email monitor polling cursor", () => {
  it("uses a ten-minute overlap and advances only after the final page", () => {
    const cursorAt = new Date("2026-07-27T00:30:00.000Z");
    const now = new Date("2026-07-27T00:45:00.000Z");
    const scan = startOrResumeEmailMonitorScan(
      {
        monitoringSince: new Date("2026-07-27T00:00:00.000Z"),
        cursorAt,
        scanUpperBoundAt: null,
        scanPageToken: null
      },
      now
    );

    expect(scan.queryAfter.toISOString()).toBe("2026-07-27T00:20:00.000Z");
    expect(scan.upperBoundAt).toEqual(now);
    expect(
      completeEmailMonitorScanPage(scan.upperBoundAt, "next-page")
    ).toEqual({
      scanUpperBoundAt: now,
      scanPageToken: "next-page"
    });
    expect(completeEmailMonitorScanPage(scan.upperBoundAt)).toEqual({
      cursorAt: now,
      scanUpperBoundAt: null,
      scanPageToken: null
    });
  });

  it("never overlaps into mail received before monitoring was enabled", () => {
    const monitoringSince = new Date("2026-07-27T00:30:00.000Z");
    const scan = startOrResumeEmailMonitorScan(
      {
        monitoringSince,
        cursorAt: monitoringSince,
        scanUpperBoundAt: null,
        scanPageToken: null
      },
      new Date("2026-07-27T00:45:00.000Z")
    );

    expect(scan.queryAfter).toEqual(monitoringSince);
  });

  it("uses Gmail internalDate to reject mail from earlier in the activation second", () => {
    const monitoringSince = new Date("2026-07-27T00:30:00.900Z");

    expect(
      isWithinEmailMonitorActivationBoundary(
        new Date("2026-07-27T00:30:00.899Z"),
        monitoringSince
      )
    ).toBe(false);
    expect(
      isWithinEmailMonitorActivationBoundary(
        new Date("2026-07-27T00:30:00.900Z"),
        monitoringSince
      )
    ).toBe(true);
  });

  it("builds an exact bounded Gmail query", () => {
    expect(
      buildEmailMonitorGmailQuery(
        "in:inbox 面接",
        new Date("2026-07-27T00:20:00.000Z"),
        new Date("2026-07-27T00:45:00.000Z")
      )
    ).toBe("(in:inbox 面接) after:1785111600 before:1785113101");
  });
});

describe("email monitor job state machine", () => {
  const now = new Date("2026-07-27T00:00:00.000Z");

  it("reclaims only pending, due retry, or expired lease jobs", () => {
    expect(
      isEmailAutomationJobClaimable(
        {
          status: EmailAutomationJobStatus.PROCESSING,
          leaseUntil: new Date("2026-07-26T23:59:59.000Z"),
          nextAttemptAt: null
        },
        now
      )
    ).toBe(true);
    expect(
      isEmailAutomationJobClaimable(
        {
          status: EmailAutomationJobStatus.PROCESSING,
          leaseUntil: new Date("2026-07-27T00:01:00.000Z"),
          nextAttemptAt: null
        },
        now
      )
    ).toBe(false);
  });

  it("retries twice and fails on the third claimed attempt", () => {
    expect(getEmailAutomationRetryTransition(2, now)).toEqual({
      status: EmailAutomationJobStatus.RETRY_WAIT,
      nextAttemptAt: new Date("2026-07-27T00:30:00.000Z")
    });
    expect(getEmailAutomationRetryTransition(3, now)).toEqual({
      status: EmailAutomationJobStatus.FAILED,
      nextAttemptAt: null
    });
  });

  it("rolls quota work to the next UTC day", () => {
    expect(nextUtcDay(new Date("2026-07-27T23:59:00.000Z")).toISOString()).toBe(
      "2026-07-28T00:00:00.000Z"
    );
  });
});

describe("email monitor privacy and internal authentication", () => {
  it("binds the digest to both Gmail message id and transient body", () => {
    const first = buildEmailMessageDigest({
      id: "gmail-1",
      bodyText: "private body"
    });
    const second = buildEmailMessageDigest({
      id: "gmail-1",
      bodyText: "changed body"
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it("accepts only a fresh HMAC over the exact worker body", () => {
    const body = JSON.stringify({ userId: "user-1" });
    const secret = "a".repeat(32);
    const now = new Date("2026-07-27T00:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000);
    const signature = createEmailMonitorWorkerSignature(
      body,
      timestamp,
      secret
    );

    expect(
      verifyEmailMonitorWorkerSignature({
        body,
        timestampHeader: String(timestamp),
        signatureHeader: signature,
        now,
        secret
      })
    ).toBe(true);
    expect(
      verifyEmailMonitorWorkerSignature({
        body: `${body} `,
        timestampHeader: String(timestamp),
        signatureHeader: signature,
        now,
        secret
      })
    ).toBe(false);
  });
});

describe("email monitor consent", () => {
  const now = new Date("2026-07-27T00:00:00.000Z");

  it("requires current explicit consent when enabling", () => {
    expect(() =>
      resolveEmailMonitorConsent(
        new Date("2026-07-20T00:00:00.000Z"),
        { enabled: true, consentToAiProcessing: false },
        now
      )
    ).toThrow("AI処理への同意が必要です");
  });

  it("clears consent when a disabled monitor revokes it", () => {
    expect(
      resolveEmailMonitorConsent(
        new Date("2026-07-20T00:00:00.000Z"),
        { enabled: false, consentToAiProcessing: false },
        now
      )
    ).toBeNull();
  });
});

describe("email monitor config transitions", () => {
  it("resets pagination and reviews queued work when the Gmail query changes", () => {
    expect(
      getEmailMonitorConfigTransition(
        { enabled: true, gmailQuery: "面接" },
        true,
        "内定"
      )
    ).toEqual({
      resetScan: true,
      reviewPendingJobs: true,
      reviewReason: "MONITOR_QUERY_CHANGED"
    });
  });

  it("reviews queued work when monitoring is disabled", () => {
    expect(
      getEmailMonitorConfigTransition(
        { enabled: true, gmailQuery: "面接" },
        false,
        "面接"
      )
    ).toEqual({
      resetScan: false,
      reviewPendingJobs: true,
      reviewReason: "MONITOR_DISABLED"
    });
  });
});

describe("email monitor daily AI budget", () => {
  it("counts in-flight reservations before allowing another AI request", () => {
    expect(canReserveAiTokens(140_000, 20_000, 180_000)).toBe(true);
    expect(canReserveAiTokens(140_001, 20_000, 180_000)).toBe(false);
    expect(canReserveAiTokens(140_000, 20_000, 180_000, 20_001)).toBe(false);
    expect(AI_TOKEN_RESERVATION_PER_REQUEST).toBe(20_000);
  });

  it("uses a UTC date key for the shared provider ledger", () => {
    expect(toUtcUsageDate(new Date("2026-07-27T23:59:59.000-07:00"))).toBe(
      "2026-07-28"
    );
  });
});
