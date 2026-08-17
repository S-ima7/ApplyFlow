import type { GoogleCalendarEvent } from "@/lib/google-calendar";

export function getGoogleCalendarImportKey(calendarId: string, externalEventId: string) {
  return `${calendarId}:${externalEventId}`;
}

export function isApplyFlowInterviewCalendarEvent(
  event: GoogleCalendarEvent,
  exportedInterviewKeys: ReadonlySet<string>
) {
  const key = event.applyFlowInterviewKey;

  return Boolean(
    key && event.externalEventId === key && exportedInterviewKeys.has(key)
  );
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
    description: event.description ?? null,
    location: event.location ?? null,
    meetingUrl: event.meetingUrl ?? null,
    startAt: event.startAt,
    endAt: event.endAt,
    startDate: event.startDate ?? null,
    endDate: event.endDate ?? null,
    allDay: event.allDay,
    timezone: event.timezone ?? fallbackTimezone,
    externalUrl: event.htmlLink ?? null,
    sourceUpdatedAt: event.updatedAt ?? null,
    importedAt: new Date(),
    deletedAt: null
  };
}
