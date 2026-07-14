import {
  DeadlineStatus,
  InterviewStatus,
  ProposedSlotStatus,
  ScheduleEventSource
} from "@prisma/client";
import { getGoogleCalendarImportKey } from "@/features/calendar/import";
import {
  getGoogleCalendarEvents,
  type GoogleCalendarConnection
} from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export type CalendarEventKind =
  | "confirmed_interview"
  | "proposed_slot"
  | "deadline"
  | "google_calendar"
  | "schedule_event";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  className?: string;
  extendedProps: {
    kind: CalendarEventKind;
    applicationId?: string;
    scheduleEventId?: string;
    companyName: string;
    position: string;
    status: string;
    externalUrl?: string;
    calendarId?: string;
    externalEventId?: string;
    description?: string;
    location?: string;
    meetingUrl?: string;
  };
};

export type CalendarApplicationOption = {
  id: string;
  label: string;
};

export type CalendarData = {
  events: CalendarEvent[];
  applicationOptions: CalendarApplicationOption[];
  googleCalendar: GoogleCalendarConnection;
};

export async function getCalendarData(userId: string): Promise<CalendarData> {
  const [interviews, slots, deadlines, scheduleEvents, applications, googleCalendar] =
    await Promise.all([
      prisma.interview.findMany({
        where: {
          userId,
          deletedAt: null,
          status: InterviewStatus.CONFIRMED,
          confirmedStartAt: { not: null },
          confirmedEndAt: { not: null },
          selectionStage: { application: { deletedAt: null } }
        },
        include: {
          selectionStage: {
            include: { application: { include: { company: true } } }
          }
        }
      }),
      prisma.proposedSlot.findMany({
        where: {
          userId,
          deletedAt: null,
          status: ProposedSlotStatus.PENDING,
          interview: {
            deletedAt: null,
            selectionStage: { application: { deletedAt: null } }
          }
        },
        include: {
          interview: {
            include: {
              selectionStage: {
                include: { application: { include: { company: true } } }
              }
            }
          }
        }
      }),
      prisma.deadline.findMany({
        where: {
          userId,
          deletedAt: null,
          status: DeadlineStatus.OPEN,
          application: { deletedAt: null }
        },
        include: { application: { include: { company: true } } }
      }),
      prisma.scheduleEvent.findMany({
        where: { userId, deletedAt: null },
        include: {
          application: { include: { company: true } }
        },
        orderBy: { startAt: "asc" }
      }),
      prisma.application.findMany({
        where: { userId, deletedAt: null },
        include: { company: true },
        orderBy: { updatedAt: "desc" }
      }),
      getGoogleCalendarEvents(userId)
    ]);

  const importedGoogleKeys = new Set(
    scheduleEvents
      .filter(
        (event) =>
          event.source === ScheduleEventSource.GOOGLE_CALENDAR &&
          event.externalCalendarId &&
          event.externalEventId
      )
      .map((event) =>
        getGoogleCalendarImportKey(
          event.externalCalendarId as string,
          event.externalEventId as string
        )
      )
  );

  const events: CalendarEvent[] = [
    ...interviews
      .filter((interview) => interview.confirmedStartAt && interview.confirmedEndAt)
      .map((interview) => {
        const application = interview.selectionStage.application;

        return {
          id: `interview:${interview.id}`,
          title: `${application.company.name} 確定面談`,
          start: (interview.confirmedStartAt as Date).toISOString(),
          end: (interview.confirmedEndAt as Date).toISOString(),
          className: "applyflow-event-confirmed",
          extendedProps: {
            kind: "confirmed_interview" as const,
            applicationId: application.id,
            companyName: application.company.name,
            position: application.position,
            status: interview.status,
            location: interview.location ?? undefined,
            meetingUrl: interview.meetingUrl ?? undefined
          }
        };
      }),
    ...slots.map((slot) => {
      const application = slot.interview.selectionStage.application;

      return {
        id: `slot:${slot.id}`,
        title: `${application.company.name} 候補`,
        start: slot.startAt.toISOString(),
        end: slot.endAt.toISOString(),
        className: "applyflow-event-proposed",
        extendedProps: {
          kind: "proposed_slot" as const,
          applicationId: application.id,
          companyName: application.company.name,
          position: application.position,
          status: slot.status,
          meetingUrl: slot.interview.meetingUrl ?? undefined
        }
      };
    }),
    ...deadlines.map((deadline) => ({
      id: `deadline:${deadline.id}`,
      title: `${deadline.application.company.name} ${deadline.title}`,
      start: deadline.dueAt.toISOString(),
      className:
        deadline.type === "OFFER_ACCEPTANCE"
          ? "applyflow-event-offer-deadline"
          : "applyflow-event-deadline",
      extendedProps: {
        kind: "deadline" as const,
        applicationId: deadline.applicationId,
        companyName: deadline.application.company.name,
        position: deadline.application.position,
        status: deadline.status,
        description: deadline.note ?? undefined
      }
    })),
    ...scheduleEvents.map((event) => ({
      id: `schedule:${event.id}`,
      title: event.title,
      start: event.allDay
        ? event.startDate ?? event.startAt.toISOString()
        : event.startAt.toISOString(),
      end: event.allDay
        ? event.endDate ?? event.endAt.toISOString()
        : event.endAt.toISOString(),
      allDay: event.allDay,
      className: "applyflow-event-imported",
      extendedProps: {
        kind: "schedule_event" as const,
        scheduleEventId: event.id,
        applicationId: event.applicationId ?? undefined,
        companyName: event.application?.company.name ?? "ApplyFlow予定",
        position: event.application?.position ?? "Google Calendarから取込済み",
        status: "imported",
        externalUrl: event.externalUrl ?? undefined,
        calendarId: event.externalCalendarId ?? undefined,
        externalEventId: event.externalEventId ?? undefined,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        meetingUrl: event.meetingUrl ?? undefined
      }
    })),
    ...googleCalendar.events
      .filter(
        (event) =>
          !importedGoogleKeys.has(
            getGoogleCalendarImportKey(event.calendarId, event.externalEventId)
          )
      )
      .map((event) => ({
        id: event.id,
        title: event.title,
        start: event.allDay
          ? event.startDate ?? event.startAt.toISOString()
          : event.startAt.toISOString(),
        end: event.allDay
          ? event.endDate ?? event.endAt.toISOString()
          : event.endAt.toISOString(),
        allDay: event.allDay,
        className:
          event.transparency === "transparent"
            ? "applyflow-event-google-transparent"
            : "applyflow-event-google",
        extendedProps: {
          kind: "google_calendar" as const,
          companyName: "Google Calendar",
          position: event.calendarId,
          status: event.transparency,
          externalUrl: event.htmlLink,
          calendarId: event.calendarId,
          externalEventId: event.externalEventId,
          description: event.description,
          location: event.location,
          meetingUrl: event.meetingUrl
        }
      }))
  ];

  return {
    events,
    applicationOptions: applications.map((application) => ({
      id: application.id,
      label: `${application.company.name} / ${application.position}`
    })),
    googleCalendar: {
      status: googleCalendar.status,
      scope: googleCalendar.scope,
      message: googleCalendar.message
    }
  };
}

export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  return (await getCalendarData(userId)).events;
}
