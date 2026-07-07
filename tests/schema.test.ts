import { describe, expect, it } from "vitest";
import {
  applicationSchema,
  deadlineSchema,
  proposedSlotSchema
} from "@/features/applications/schema";

describe("applicationSchema", () => {
  it("accepts a minimal valid application", () => {
    const result = applicationSchema.safeParse({
      companyName: "Example Inc.",
      position: "Frontend Engineer",
      applicationType: "CAREER_CHANGE",
      route: "DIRECT",
      status: "APPLIED",
      priority: "HIGH",
      sourceUrl: "https://example.com/jobs/1"
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = applicationSchema.safeParse({
      companyName: "Example Inc.",
      position: "Frontend Engineer",
      applicationType: "CAREER_CHANGE",
      route: "DIRECT",
      sourceUrl: "not-a-url"
    });

    expect(result.success).toBe(false);
  });
});

describe("proposedSlotSchema", () => {
  it("requires endAt to be after startAt", () => {
    const result = proposedSlotSchema.safeParse({
      startAt: "2026-07-12T11:00",
      endAt: "2026-07-12T10:00",
      timezone: "Asia/Tokyo"
    });

    expect(result.success).toBe(false);
  });

  it("accepts past datetime as warning-only domain behavior", () => {
    const result = proposedSlotSchema.safeParse({
      startAt: "2020-01-01T10:00",
      endAt: "2020-01-01T11:00",
      timezone: "Asia/Tokyo"
    });

    expect(result.success).toBe(true);
  });
});

describe("deadlineSchema", () => {
  it("requires title and dueAt", () => {
    const result = deadlineSchema.safeParse({
      type: "REPLY_DEADLINE",
      title: "",
      dueAt: ""
    });

    expect(result.success).toBe(false);
  });
});
