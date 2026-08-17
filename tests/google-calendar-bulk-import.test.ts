import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  interviewFindMany: vi.fn(),
  scheduleEventFindMany: vi.fn(),
  scheduleEventUpsert: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  getGoogleCalendarEvents: vi.fn(),
  getDefaultGoogleCalendarRange: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    application: { findFirst: vi.fn() },
    interview: { findFirst: vi.fn(), findMany: mocks.interviewFindMany },
    scheduleEvent: {
      findMany: mocks.scheduleEventFindMany,
      upsert: mocks.scheduleEventUpsert
    },
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction
  }
}));
vi.mock("@/lib/google-calendar", () => ({
  createGoogleCalendarInterviewEvent: vi.fn(),
  getGoogleCalendarEventById: vi.fn(),
  getGoogleCalendarEvents: mocks.getGoogleCalendarEvents,
  getDefaultGoogleCalendarRange: mocks.getDefaultGoogleCalendarRange,
  getGoogleCalendarInterviewEventId: (userId: string, interviewId: string) =>
    `${userId}:${interviewId}`
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { importAllGoogleCalendarEvents } from "@/features/calendar/actions";

describe("importAllGoogleCalendarEvents", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireUser.mockResolvedValue({ id: "user-1", timezone: "Asia/Tokyo" });
    mocks.getDefaultGoogleCalendarRange.mockReturnValue({
      timeMin: new Date("2026-08-01T00:00:00.000Z"),
      timeMax: new Date("2026-10-01T00:00:00.000Z")
    });
    mocks.interviewFindMany.mockResolvedValue([{ id: "interview-1" }]);
    mocks.scheduleEventFindMany.mockResolvedValue([
      {
        externalCalendarId: "primary",
        externalEventId: "event-existing"
      }
    ]);
    mocks.scheduleEventUpsert.mockImplementation(async ({ where }) => ({
      id: where.userId_source_externalCalendarId_externalEventId.externalEventId
    }));
    mocks.executeRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations)
    );
  });

  it("imports new events, updates existing snapshots, and preserves application links", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [
        googleEvent("event-new"),
        googleEvent("event-existing"),
        googleEvent("user-1:interview-1", "user-1:interview-1")
      ]
    });

    const result = await importAllGoogleCalendarEvents();

    expect(result).toMatchObject({
      ok: true,
      importedCount: 1,
      updatedCount: 1
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.getDefaultGoogleCalendarRange).toHaveBeenCalledWith(
      expect.any(Date),
      "Asia/Tokyo"
    );
    const queryText = mocks.executeRaw.mock.calls[0][0].strings.join("");
    const updateClause = queryText.slice(queryText.indexOf("DO UPDATE SET"));
    expect(updateClause).not.toContain("applicationId");
    expect(updateClause).toContain('"deletedAt" = NULL');
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("does not reverse-import an interview exported by ApplyFlow", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [googleEvent("user-1:interview-1", "user-1:interview-1")]
    });

    const result = await importAllGoogleCalendarEvents();

    expect(result).toMatchObject({
      ok: true,
      importedCount: 0,
      updatedCount: 0
    });
    expect(mocks.scheduleEventFindMany).not.toHaveBeenCalled();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the Calendar API failure without writing snapshots", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "error",
      events: [],
      message: "Google Calendar予定を取得できませんでした"
    });

    const result = await importAllGoogleCalendarEvents();

    expect(result).toEqual({
      ok: false,
      message: "Google Calendar予定を取得できませんでした"
    });
    expect(mocks.scheduleEventFindMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reports a transaction failure without revalidating the UI", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [googleEvent("event-new")]
    });
    mocks.transaction.mockRejectedValue(new Error("database unavailable"));

    const result = await importAllGoogleCalendarEvents();

    expect(result).toEqual({
      ok: false,
      message: "Google Calendar予定の一括取り込みに失敗しました"
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports unexpected Calendar and database read failures", async () => {
    mocks.getGoogleCalendarEvents.mockRejectedValueOnce(
      new Error("token refresh unavailable")
    );

    await expect(importAllGoogleCalendarEvents()).resolves.toEqual({
      ok: false,
      message: "Google Calendar予定の一括取り込みに失敗しました"
    });

    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [googleEvent("event-new")]
    });
    mocks.scheduleEventFindMany.mockRejectedValueOnce(
      new Error("database unavailable")
    );

    await expect(importAllGoogleCalendarEvents()).resolves.toEqual({
      ok: false,
      message: "Google Calendar予定の一括取り込みに失敗しました"
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps a committed import successful when cache invalidation fails", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [googleEvent("event-new")]
    });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });

    await expect(importAllGoogleCalendarEvents()).resolves.toMatchObject({
      ok: true,
      importedCount: 1,
      updatedCount: 0
    });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("writes more than one Calendar API page in bounded SQL batches", async () => {
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: Array.from({ length: 2501 }, (_, index) =>
        googleEvent(`event-${index}`)
      )
    });
    mocks.scheduleEventFindMany.mockResolvedValue([]);

    const result = await importAllGoogleCalendarEvents();

    expect(result).toMatchObject({
      ok: true,
      importedCount: 2501,
      updatedCount: 0
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(6);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(6);
  });
});

function googleEvent(id: string, applyFlowInterviewKey?: string) {
  return {
    id: `google:primary:${id}`,
    externalEventId: id,
    calendarId: "primary",
    title: id,
    startAt: new Date("2026-08-20T01:00:00.000Z"),
    endAt: new Date("2026-08-20T02:00:00.000Z"),
    allDay: false,
    transparency: "opaque" as const,
    applyFlowInterviewKey
  };
}
