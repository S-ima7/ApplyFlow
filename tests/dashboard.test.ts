import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  applicationCount: vi.fn(),
  interviewFindMany: vi.fn(),
  deadlineFindMany: vi.fn(),
  proposedSlotFindMany: vi.fn(),
  scheduleEventFindMany: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    application: {
      count: db.applicationCount
    },
    interview: {
      findMany: db.interviewFindMany
    },
    deadline: {
      findMany: db.deadlineFindMany
    },
    proposedSlot: {
      findMany: db.proposedSlotFindMany
    },
    scheduleEvent: {
      findMany: db.scheduleEventFindMany
    }
  }
}));

import { getDashboardData } from "@/features/applications/queries";

describe("getDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.applicationCount.mockResolvedValue(0);
    db.interviewFindMany.mockResolvedValue([]);
    db.deadlineFindMany.mockResolvedValue([]);
    db.proposedSlotFindMany.mockResolvedValue([]);
    db.scheduleEventFindMany.mockResolvedValue([]);
  });

  it("returns imported schedule events for the current dashboard week", async () => {
    const importedEvent = {
      id: "schedule-1",
      userId: "user-1",
      title: "採用面談",
      startAt: new Date("2099-07-15T10:00:00.000Z"),
      endAt: new Date("2099-07-15T11:00:00.000Z"),
      allDay: false,
      startDate: null,
      application: null
    };
    db.scheduleEventFindMany.mockResolvedValue([importedEvent]);

    const result = await getDashboardData("user-1");

    expect(result.weeklyScheduleEvents).toEqual([importedEvent]);
    expect(db.scheduleEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          deletedAt: null,
          startAt: expect.objectContaining({ lte: expect.any(Date) }),
          endAt: expect.objectContaining({ gte: expect.any(Date) })
        })
      })
    );
  });
});
