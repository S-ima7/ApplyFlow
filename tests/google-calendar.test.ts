import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  buildGoogleCalendarEventsUrl,
  getGoogleCalendarApiErrorMessage,
  hasGoogleCalendarReadonlyScope,
  mapGoogleCalendarEvent,
  mapGoogleCalendarEvents
} from "@/lib/google-calendar";
import { googleCalendarEventsToScheduleItems } from "@/features/conflict-detection/google-calendar";

describe("buildGoogleCalendarEventsUrl", () => {
  it("requests the full page size and forwards the next page token", () => {
    const url = buildGoogleCalendarEventsUrl(
      {
        timeMin: new Date("2026-07-01T00:00:00.000Z"),
        timeMax: new Date("2026-09-01T00:00:00.000Z")
      },
      "next-token"
    );

    expect(url.searchParams.get("maxResults")).toBe("2500");
    expect(url.searchParams.get("pageToken")).toBe("next-token");
    expect(url.searchParams.get("singleEvents")).toBe("true");
  });
});

describe("getGoogleCalendarApiErrorMessage", () => {
  it("explains how to resolve a disabled Calendar API", () => {
    expect(
      getGoogleCalendarApiErrorMessage(403, {
        error: {
          message: "Google Calendar API has not been used in this project or it is disabled."
        }
      })
    ).toContain("Google Calendar APIを有効化");
  });
});

describe("hasGoogleCalendarReadonlyScope", () => {
  it("detects the readonly Calendar scope", () => {
    expect(
      hasGoogleCalendarReadonlyScope(`openid email profile ${GOOGLE_CALENDAR_READONLY_SCOPE}`)
    ).toBe(true);
  });

  it("returns false when the Calendar scope is missing", () => {
    expect(hasGoogleCalendarReadonlyScope("openid email profile")).toBe(false);
  });
});

describe("mapGoogleCalendarEvent", () => {
  it("maps a timed Google Calendar event", () => {
    const event = mapGoogleCalendarEvent({
      id: "event-1",
      summary: "Busy",
      htmlLink: "https://calendar.google.com/event",
      start: {
        dateTime: "2026-07-12T10:00:00+09:00"
      },
      end: {
        dateTime: "2026-07-12T11:00:00+09:00"
      }
    });

    expect(event).toMatchObject({
      id: "google:primary:event-1",
      externalEventId: "event-1",
      title: "Busy",
      allDay: false,
      transparency: "opaque"
    });
    expect(event?.startAt.toISOString()).toBe("2026-07-12T01:00:00.000Z");
    expect(event?.endAt.toISOString()).toBe("2026-07-12T02:00:00.000Z");
  });

  it("maps an all-day Google Calendar event", () => {
    const event = mapGoogleCalendarEvent({
      id: "event-2",
      summary: "All day",
      start: {
        date: "2026-07-12"
      },
      end: {
        date: "2026-07-13"
      }
    });

    expect(event).toMatchObject({
      id: "google:primary:event-2",
      title: "All day",
      allDay: true,
      startDate: "2026-07-12",
      endDate: "2026-07-13"
    });
  });

  it("skips cancelled events", () => {
    const events = mapGoogleCalendarEvents([
      {
        id: "cancelled",
        status: "cancelled",
        start: {
          dateTime: "2026-07-12T10:00:00+09:00"
        },
        end: {
          dateTime: "2026-07-12T11:00:00+09:00"
        }
      }
    ]);

    expect(events).toHaveLength(0);
  });

  it("excludes transparent events from conflict schedule items", () => {
    const event = mapGoogleCalendarEvent({
      id: "free",
      summary: "Free hold",
      transparency: "transparent",
      start: {
        dateTime: "2026-07-12T10:00:00+09:00"
      },
      end: {
        dateTime: "2026-07-12T11:00:00+09:00"
      }
    });

    expect(googleCalendarEventsToScheduleItems(event ? [event] : [])).toHaveLength(0);
  });
});
