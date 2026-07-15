import type { GoogleCalendarEvent } from "@/lib/google-calendar";

export function getGoogleCalendarImportKey(calendarId: string, externalEventId: string) {
  return `${calendarId}:${externalEventId}`;
}

export function buildScheduleEventImportData(
  userId: string,
  event: GoogleCalendarEvent,
  applicationId: string | null,
  fallbackTimezone = "Asia/Tokyo"
) {
  return {
    userId,
    applicationId,
    source: "GOOGLE_CALENDAR" as const,
    externalCalendarId: event.calendarId,
    externalEventId: event.externalEventId,
    title: event.title,
    description: event.description,
    location: event.location,
    meetingUrl: event.meetingUrl,
    startAt: event.startAt,
    endAt: event.endAt,
    startDate: event.startDate,
    endDate: event.endDate,
    allDay: event.allDay,
    timezone: event.timezone ?? fallbackTimezone,
    externalUrl: event.htmlLink,
    sourceUpdatedAt: event.updatedAt,
    importedAt: new Date(),
    deletedAt: null
  };
}
