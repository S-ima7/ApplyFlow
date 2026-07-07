import { describe, expect, it } from "vitest";
import {
  detectConflicts,
  getConflictSeverity,
  rangesOverlap
} from "@/features/conflict-detection";
import type { ScheduleItem } from "@/features/conflict-detection/types";

function item(
  id: string,
  start: string,
  end: string,
  status: "pending" | "confirmed" = "pending",
  eventGroupId?: string
): ScheduleItem {
  return {
    id,
    eventGroupId,
    kind: status === "confirmed" ? "confirmed_interview" : "proposed_slot",
    status,
    startAt: new Date(start),
    endAt: new Date(end),
    title: id,
    companyName: id,
    position: "Engineer",
    applicationId: id
  };
}

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(
      rangesOverlap(
        item("a", "2026-07-12T10:00:00.000Z", "2026-07-12T11:00:00.000Z"),
        item("b", "2026-07-12T10:30:00.000Z", "2026-07-12T11:30:00.000Z")
      )
    ).toBe(true);
  });

  it("does not detect adjacent ranges as overlap", () => {
    expect(
      rangesOverlap(
        item("a", "2026-07-12T10:00:00.000Z", "2026-07-12T11:00:00.000Z"),
        item("b", "2026-07-12T11:00:00.000Z", "2026-07-12T12:00:00.000Z")
      )
    ).toBe(false);
  });
});

describe("getConflictSeverity", () => {
  it("marks confirmed vs confirmed as high", () => {
    expect(getConflictSeverity({ status: "confirmed" }, { status: "confirmed" })).toBe(
      "high"
    );
  });

  it("marks pending vs confirmed as medium", () => {
    expect(getConflictSeverity({ status: "pending" }, { status: "confirmed" })).toBe(
      "medium"
    );
  });

  it("marks pending vs pending as low", () => {
    expect(getConflictSeverity({ status: "pending" }, { status: "pending" })).toBe(
      "low"
    );
  });
});

describe("detectConflicts", () => {
  it("detects conflicts and sorts by severity", () => {
    const conflicts = detectConflicts([
      item("a", "2026-07-12T10:00:00.000Z", "2026-07-12T11:00:00.000Z"),
      item("b", "2026-07-12T10:30:00.000Z", "2026-07-12T11:30:00.000Z"),
      item("c", "2026-07-12T10:15:00.000Z", "2026-07-12T10:45:00.000Z", "confirmed")
    ]);

    expect(conflicts).toHaveLength(3);
    expect(conflicts[0]?.severity).toBe("medium");
    expect(conflicts[2]?.severity).toBe("low");
  });

  it("ignores duplicated representations of the same interview", () => {
    const conflicts = detectConflicts([
      item(
        "slot:1",
        "2026-07-12T10:00:00.000Z",
        "2026-07-12T11:00:00.000Z",
        "confirmed",
        "interview:1"
      ),
      item(
        "interview:1",
        "2026-07-12T10:00:00.000Z",
        "2026-07-12T11:00:00.000Z",
        "confirmed",
        "interview:1"
      )
    ]);

    expect(conflicts).toHaveLength(0);
  });
});
