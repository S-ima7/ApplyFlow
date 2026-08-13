import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmailMessageDigest } from "@/features/email-monitor/digest";

const mocks = vi.hoisted(() => ({
  jobUpdateMany: vi.fn(),
  jobFindFirstOrThrow: vi.fn(),
  extractionCreate: vi.fn(),
  getGmailMessage: vi.fn(),
  extractEmailWithAi: vi.fn(),
  decideAndApply: vi.fn(),
  tryAutoCreate: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailAutomationJob: {
      updateMany: mocks.jobUpdateMany,
      findFirstOrThrow: mocks.jobFindFirstOrThrow
    },
    aiExtractionResult: { create: mocks.extractionCreate },
    $transaction: vi.fn(async (callback) =>
      callback({
        emailAutomationJob: { updateMany: mocks.jobUpdateMany },
        aiExtractionResult: { create: mocks.extractionCreate }
      })
    )
  }
}));
vi.mock("@/lib/gmail", () => ({ getGmailMessage: mocks.getGmailMessage }));
vi.mock("@/features/email-import/extraction", () => ({
  extractEmailWithAi: mocks.extractEmailWithAi
}));
vi.mock("@/features/email-monitor/automation", () => ({
  decideAndApplyEmailImportAutomation: mocks.decideAndApply
}));
vi.mock("@/features/email-import/automation", () => ({
  tryAutoCreateEmailImportApplication: mocks.tryAutoCreate
}));

import { runManualEmailImportJob } from "@/features/email-import/manual-worker";

const fieldConfidence = {
  relevant: 0.99,
  eventType: 0.99,
  companyName: 0.99,
  position: 0.99,
  stageType: 0.99,
  stageName: 0.99,
  proposedSlots: 0.99,
  confirmedSlot: 0.99,
  replyDeadline: 0.99,
  offerAcceptanceDeadline: 0.99,
  meetingUrl: 0.99,
  interviewerName: 0.99
};
const evidence = Object.fromEntries(
  Object.keys(fieldConfidence).map((key) => [key, null])
);
const message = {
  id: "gmail-1",
  threadId: "thread-1",
  subject: "一次面接",
  fromAddress: "recruit@example.com",
  sentAt: new Date("2026-08-12T00:00:00.000Z"),
  internalDate: new Date("2026-08-12T00:00:00.000Z"),
  snippet: "面接日時",
  bodyText: "2026年8月20日19時から一次面接です"
};

describe("manual email import background worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobFindFirstOrThrow.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      emailImportId: "import-1",
      gmailMessageId: message.id,
      messageDigest: buildEmailMessageDigest(message),
      user: { timezone: "Asia/Tokyo" }
    });
    mocks.getGmailMessage.mockResolvedValue({
      status: "connected",
      gmailMessage: message
    });
    mocks.extractEmailWithAi.mockResolvedValue({
      ok: true,
      data: {
        relevant: true,
        eventType: "CREATE_OR_UPDATE",
        companyName: "株式会社Example",
        position: "エンジニア",
        stageType: "FIRST_INTERVIEW",
        stageName: "一次面接",
        proposedSlots: [],
        confirmedSlot: {
          startAt: "2026-08-20T19:00:00+09:00",
          endAt: "2026-08-20T20:00:00+09:00",
          timezone: "Asia/Tokyo"
        },
        replyDeadline: null,
        offerAcceptanceDeadline: null,
        meetingUrl: null,
        interviewerName: null,
        confidence: 0.99,
        fieldConfidence,
        evidence
      },
      metadata: {
        model: "@cf/openai/gpt-oss-120b",
        promptVersion: "test",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      }
    });
    mocks.extractionCreate.mockResolvedValue({ id: "extraction-1" });
    mocks.decideAndApply.mockResolvedValue({
      action: "REVIEW_REQUIRED",
      reason: "APPLICATION_NOT_UNIQUE"
    });
    mocks.tryAutoCreate.mockResolvedValue({
      applicationId: "application-1",
      created: true
    });
  });

  it("persists the extraction and finishes the durable job after AI completes", async () => {
    await runManualEmailImportJob({ jobId: "job-1", userId: "user-1" });

    expect(mocks.extractEmailWithAi).toHaveBeenCalledOnce();
    expect(mocks.extractionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailImportId: "import-1",
          extractedJson: expect.objectContaining({
            companyName: "株式会社Example"
          })
        })
      })
    );
    expect(mocks.jobUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: "job-1",
        status: "PROCESSING",
        leaseUntil: expect.any(Date)
      }),
      data: expect.objectContaining({
        status: "AUTO_APPLIED",
        matchedApplicationId: "application-1",
        leaseUntil: null
      })
    });
  });

  it("allows only the current lease owner to finish a job", async () => {
    mocks.getGmailMessage.mockResolvedValue({
      status: "not_connected",
      message: "Gmail connection expired"
    });
    mocks.jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const now = new Date("2026-08-12T00:00:00.000Z");
    await runManualEmailImportJob({
      jobId: "job-1",
      userId: "user-1",
      now
    });

    expect(mocks.jobUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: "job-1",
        status: "PROCESSING",
        leaseUntil: new Date("2026-08-12T00:02:00.000Z")
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "GMAIL_FETCH_FAILED"
      })
    });
  });
});
