import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviewFindMany: vi.fn(),
  proposedSlotFindMany: vi.fn(),
  deadlineFindMany: vi.fn(),
  scheduleEventFindMany: vi.fn(),
  applicationFindMany: vi.fn(),
  getGoogleCalendarEvents: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    interview: { findMany: mocks.interviewFindMany },
    proposedSlot: { findMany: mocks.proposedSlotFindMany },
    deadline: { findMany: mocks.deadlineFindMany },
    scheduleEvent: { findMany: mocks.scheduleEventFindMany },
    application: { findMany: mocks.applicationFindMany }
  }
}));
vi.mock("@/lib/google-calendar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-calendar")>()),
  getGoogleCalendarEvents: mocks.getGoogleCalendarEvents
}));

import { getCalendarData } from "@/features/calendar/queries";
import { getScheduleItemsForConflict } from "@/features/conflict-detection/queries";
import { getGoogleCalendarInterviewEventId } from "@/lib/google-calendar";

const userId = "user-1";
const interviewId = "interview-1";
const interviewKey = getGoogleCalendarInterviewEventId(userId, interviewId);
const startAt = new Date("2026-08-20T01:00:00.000Z");
const endAt = new Date("2026-08-20T02:00:00.000Z");

describe("exported Google interview filtering", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.interviewFindMany.mockResolvedValue([
      {
        id: interviewId,
        status: "CONFIRMED",
        title: "最終面接",
        location: "東京本社",
        meetingUrl: null,
        confirmedStartAt: startAt,
        confirmedEndAt: endAt,
        selectionStage: {
          name: "最終選考",
          application: {
            id: "application-1",
            position: "Frontend Engineer",
            company: { name: "Example株式会社" }
          }
        }
      }
    ]);
    mocks.proposedSlotFindMany.mockResolvedValue([]);
    mocks.deadlineFindMany.mockResolvedValue([]);
    mocks.applicationFindMany.mockResolvedValue([]);
    mocks.scheduleEventFindMany.mockResolvedValue([
      {
        id: "schedule-imported",
        source: "GOOGLE_CALENDAR",
        externalCalendarId: "primary",
        externalEventId: "imported-live",
        title: "取り込み済み予定",
        startAt,
        endAt,
        startDate: null,
        endDate: null,
        allDay: false,
        applicationId: null,
        application: null,
        externalUrl: null,
        description: null,
        location: null,
        meetingUrl: null
      }
    ]);
    mocks.getGoogleCalendarEvents.mockResolvedValue({
      status: "connected",
      events: [
        googleEvent(interviewKey, interviewKey),
        googleEvent("copied-event", interviewKey),
        googleEvent("unmarked-event"),
        googleEvent("imported-live")
      ]
    });
  });

  it("hides only the exact exported event from the integrated calendar", async () => {
    const data = await getCalendarData(userId);
    const ids = data.events.map((event) => event.id);

    expect(ids).toContain(`interview:${interviewId}`);
    expect(ids).toContain("schedule:schedule-imported");
    expect(ids).not.toContain(`google:primary:${interviewKey}`);
    expect(ids).not.toContain("google:primary:imported-live");
    expect(ids).toContain("google:primary:copied-event");
    expect(ids).toContain("google:primary:unmarked-event");
  });

  it("does not count the exact exported event as a self-conflict", async () => {
    const items = await getScheduleItemsForConflict(userId);
    const ids = items.map((item) => item.id);

    expect(ids).toContain(`interview:${interviewId}`);
    expect(ids).not.toContain(`google:primary:${interviewKey}`);
    expect(ids).not.toContain("google:primary:imported-live");
    expect(ids).toContain("google:primary:copied-event");
    expect(ids).toContain("google:primary:unmarked-event");
  });
});

function googleEvent(id: string, applyFlowInterviewKey?: string) {
  return {
    id: `google:primary:${id}`,
    externalEventId: id,
    calendarId: "primary",
    title: id,
    startAt,
    endAt,
    allDay: false,
    transparency: "opaque" as const,
    applyFlowInterviewKey
  };
}
