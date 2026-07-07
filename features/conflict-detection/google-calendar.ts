import type { GoogleCalendarEvent } from "@/lib/google-calendar";
import type { ScheduleItem } from "@/features/conflict-detection/types";

export function googleCalendarEventsToScheduleItems(
  events: GoogleCalendarEvent[]
): ScheduleItem[] {
  return events
    .filter((event) => event.transparency !== "transparent")
    .map((event) => ({
      id: event.id,
      kind: "google_calendar_event" as const,
      status: "confirmed" as const,
      startAt: event.startAt,
      endAt: event.endAt,
      title: event.title,
      companyName: "Google Calendar",
      position: event.calendarId
    }));
}
