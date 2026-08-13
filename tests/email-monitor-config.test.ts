import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANUAL_EMAIL_IMPORT_JOB_CODE } from "@/features/email-monitor/constants";

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) =>
      callback({
        emailMonitorConfig: {
          findUnique: mocks.configFindUnique,
          upsert: mocks.configUpsert
        },
        emailAutomationJob: {
          findMany: mocks.jobFindMany,
          updateMany: mocks.jobUpdateMany
        }
      })
    )
  }
}));

import { saveEmailMonitorConfig } from "@/features/email-monitor/config";

describe("email monitor config job transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configFindUnique.mockResolvedValue({
      enabled: true,
      consentedAt: new Date("2026-08-01T00:00:00.000Z"),
      gmailQuery: "面接"
    });
    mocks.configUpsert.mockResolvedValue({ id: "config-1" });
    mocks.jobFindMany.mockResolvedValue([]);
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("leaves manual imports running when monitoring is disabled", async () => {
    await saveEmailMonitorConfig(
      "user-1",
      {
        enabled: false,
        query: "面接",
        consentToAiProcessing: false
      },
      new Date("2026-08-12T00:00:00.000Z")
    );

    expect(mocks.jobUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "user-1",
        OR: [
          { errorCode: null },
          { errorCode: { not: MANUAL_EMAIL_IMPORT_JOB_CODE } }
        ]
      }),
      data: expect.objectContaining({ status: "REVIEW_REQUIRED" })
    });
  });
});
