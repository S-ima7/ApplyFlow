import { describe, expect, it } from "vitest";
import { formatDateTimeInTimezone } from "@/lib/date";

describe("formatDateTimeInTimezone", () => {
  it("uses the requested timezone instead of the server or browser timezone", () => {
    const date = new Date("2026-08-10T06:40:00.000Z");

    expect(formatDateTimeInTimezone(date, "Asia/Tokyo")).toBe("2026/08/10 15:40");
    expect(formatDateTimeInTimezone(date, "UTC")).toBe("2026/08/10 06:40");
  });
});
