-- PostgreSQL truncates the previous generated identifier to 63 bytes.
-- Use an explicit short name so Prisma's datamodel and the database stay in sync.
ALTER INDEX "ScheduleEvent_userId_source_externalCalendarId_externalEventId_"
RENAME TO "ScheduleEvent_external_event_key";
