import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestStructuredAi: vi.fn()
}));

vi.mock("@/lib/ai/responses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/responses")>()),
  requestStructuredAi: mocks.requestStructuredAi
}));

import {
  EMAIL_EXTRACTION_TIMEOUT_MS,
  extractEmailWithAi
} from "@/features/email-import/extraction";

describe("email extraction timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestStructuredAi.mockResolvedValue({
      ok: false,
      message: "timed out",
      error: {
        provider: "cloudflare-workers-ai",
        code: "TIMEOUT",
        retryable: true
      }
    });
  });

  it("uses the background execution window instead of the synchronous default", async () => {
    await extractEmailWithAi({
      id: "gmail-1",
      subject: "一次面接",
      fromAddress: "recruit@example.com",
      bodyText: "2026年8月20日19時から一次面接です"
    });

    expect(EMAIL_EXTRACTION_TIMEOUT_MS).toBe(5 * 60 * 1_000);
    expect(mocks.requestStructuredAi).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: "medium",
        timeoutMs: EMAIL_EXTRACTION_TIMEOUT_MS
      })
    );
  });
});
