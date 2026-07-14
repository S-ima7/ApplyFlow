import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  buildGoogleCalendarEventUrl,
  buildGoogleCalendarEventsUrl,
  getGoogleCalendarApiErrorMessage,
  hasGoogleCalendarReadonlyScope,
  mapGoogleCalendarEvent,
  mapGoogleCalendarEvents
} from "@/lib/google-calendar";
import {
  buildScheduleEventImportData,
  getGoogleCalendarImportKey
} from "@/features/calendar/import";
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

describe("buildGoogleCalendarEventUrl", () => {
  it("encodes calendar and event identifiers", () => {
    expect(buildGoogleCalendarEventUrl("team@example.com", "event/1").pathname).toBe(
      "/calendar/v3/calendars/team%40example.com/events/event%2F1"
    );
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

  it("keeps import metadata and detects a meeting URL in the description", () => {
    const event = mapGoogleCalendarEvent({
      id: "event-import",
      summary: "一次面接",
      description: "参加URL https://meet.google.com/abc-defg-hij",
      location: "オンライン",
      updated: "2026-07-12T01:00:00.000Z",
      start: {
        dateTime: "2026-07-12T10:00:00+09:00",
        timeZone: "Asia/Tokyo"
      },
      end: {
        dateTime: "2026-07-12T11:00:00+09:00",
        timeZone: "Asia/Tokyo"
      }
    });

    expect(event).toMatchObject({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      location: "オンライン",
      timezone: "Asia/Tokyo"
    });
    expect(event?.updatedAt?.toISOString()).toBe("2026-07-12T01:00:00.000Z");
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

describe("Google Calendar import data", () => {
  it("builds an idempotency key and an app-owned schedule snapshot", () => {
    const event = mapGoogleCalendarEvent({
      id: "event-1",
      summary: "面接",
      htmlLink: "https://calendar.google.com/event",
      start: { dateTime: "2026-07-12T10:00:00+09:00" },
      end: { dateTime: "2026-07-12T11:00:00+09:00" }
    });

    expect(getGoogleCalendarImportKey("primary", "event-1")).toBe(
      "primary:event-1"
    );
    expect(event).not.toBeNull();

    const data = buildScheduleEventImportData(
      "user-1",
      event!,
      "application-1"
    );

    expect(data).toMatchObject({
      userId: "user-1",
      applicationId: "application-1",
      source: "GOOGLE_CALENDAR",
      externalCalendarId: "primary",
      externalEventId: "event-1",
      title: "面接"
    });
  });
});
