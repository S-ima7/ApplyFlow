import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  browserExtensionCaptureSchema,
  browserMessageExtractionRequestSchema,
  browserMessageRegistrationSchema,
  buildBrowserMessageDigest,
  buildBrowserExtensionSourceKey,
  normalizeCapturedUrl,
  validateSourceHost
} from "@/features/browser-extension/contracts";
import {
  createBrowserExtensionTokenValue,
  hashBrowserExtensionToken,
  isBrowserExtensionToken
} from "@/features/browser-extension/token";

describe("browser extension API contract", () => {
  it("normalizes tracking parameters while keeping job identity parameters", () => {
    expect(
      normalizeCapturedUrl("https://doda.jp/job/?jid=123&utm_source=mail&gclid=x#details")
    ).toBe("https://doda.jp/job?jid=123");
  });

  it("generates the same source key for URLs differing only by tracking parameters", () => {
    const first = buildBrowserExtensionSourceKey({
      sourceSite: "GREEN",
      sourceUrl: "https://www.green-japan.com/company/1/job/2?utm_source=a"
    });
    const second = buildBrowserExtensionSourceKey({
      sourceSite: "GREEN",
      sourceUrl: "https://www.green-japan.com/company/1/job/2?utm_source=b"
    });
    expect(first).toBe(second);
  });

  it("rejects a source-site and host mismatch", () => {
    expect(validateSourceHost("GREEN", "https://doda.jp/job/1")).toBe(false);
    expect(validateSourceHost("DODA", "https://sub.doda.jp/job/1")).toBe(true);
  });

  it("validates the complete capture payload", () => {
    const result = browserExtensionCaptureSchema.safeParse({
      sourceSite: "GREEN",
      sourceUrl: "https://www.green-japan.com/company/1/job/2",
      sourceJobId: "2",
      companyName: "Example Inc.",
      position: "Frontend Engineer",
      applicationType: "CAREER_CHANGE",
      capturedAt: "2026-07-15T12:00:00+09:00",
      adapterVersion: "1.0.0"
    });
    expect(result.success).toBe(true);
  });

  it("requires explicit consent before processing a selected message", () => {
    const result = browserMessageExtractionRequestSchema.safeParse({
      sourceSite: "GREEN",
      sourceUrl: "https://www.green-japan.com/messages/123",
      selectedText: "一次面接は7月20日10時からで確定しました。よろしくお願いいたします。",
      capturedAt: "2026-07-15T12:00:00+09:00",
      consentToAiProcessing: false
    });
    expect(result.success).toBe(false);
  });

  it("requires a target interview for reschedule and cancellation", () => {
    const base = {
      sourceSite: "DODA" as const,
      sourceUrl: "https://doda.jp/messages/123",
      messageDigest: "a".repeat(64),
      applicationId: "application_1",
      companyName: "Example株式会社",
      position: "Webエンジニア",
      applicationType: "CAREER_CHANGE" as const,
      stageType: "FIRST_INTERVIEW" as const,
      confirmedSlot: { startAt: null, endAt: null, timezone: null },
      proposedSlots: [],
      meetingUrl: null,
      interviewerName: null,
      replaceCurrentSchedule: true
    };
    expect(browserMessageRegistrationSchema.safeParse({ ...base, eventType: "CANCEL" }).success).toBe(false);
    expect(browserMessageRegistrationSchema.safeParse({ ...base, eventType: "RESCHEDULE" }).success).toBe(false);
    expect(
      browserMessageRegistrationSchema.safeParse({
        ...base,
        eventType: "CANCEL",
        targetInterviewId: "interview_1"
      }).success
    ).toBe(true);
  });

  it("allows a confirmed message to create an application without a prior applicationId", () => {
    const result = browserMessageRegistrationSchema.safeParse({
      sourceSite: "GREEN",
      sourceUrl: "https://www.green-japan.com/messages/123",
      messageDigest: "b".repeat(64),
      companyName: "新規株式会社",
      position: "Webエンジニア",
      applicationType: "CAREER_CHANGE",
      eventType: "CREATE_OR_UPDATE",
      stageType: "FIRST_INTERVIEW",
      confirmedSlot: {
        startAt: "2026-07-20T10:00:00+09:00",
        endAt: "2026-07-20T11:00:00+09:00",
        timezone: "Asia/Tokyo"
      },
      proposedSlots: [],
      meetingUrl: null,
      interviewerName: null,
      replaceCurrentSchedule: true
    });
    expect(result.success).toBe(true);
  });

  it("builds a stable digest without retaining the raw message", () => {
    const first = buildBrowserMessageDigest("GREEN", "  面接は7月20日10時です。  ");
    const second = buildBrowserMessageDigest("GREEN", "面接は7月20日10時です。");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("面接");
    expect(buildBrowserMessageDigest("DODA", "面接は7月20日10時です。")).not.toBe(first);
  });
});

describe("browser extension token", () => {
  it("creates a recognizable token and stores a deterministic digest", () => {
    const token = createBrowserExtensionTokenValue();
    expect(isBrowserExtensionToken(token)).toBe(true);
    expect(hashBrowserExtensionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashBrowserExtensionToken(token)).toBe(hashBrowserExtensionToken(token));
  });
});

describe("browser extension manifest", () => {
  it("uses Manifest V3 without sensitive browser permissions", () => {
    const manifest = JSON.parse(
      readFileSync("browser-extension/public/manifest.json", "utf8")
    ) as { manifest_version: number; permissions?: string[]; host_permissions?: string[] };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage", "scripting", "activeTab"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).not.toEqual(
      expect.arrayContaining(["cookies", "history", "tabs", "webRequest"])
    );
  });
});
