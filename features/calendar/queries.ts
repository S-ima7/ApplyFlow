import { DeadlineStatus, InterviewStatus, ProposedSlotStatus } from "@prisma/client";
import {
  getGoogleCalendarEvents,
  type GoogleCalendarConnection
} from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  className?: string;
  extendedProps: {
    kind: "confirmed_interview" | "proposed_slot" | "deadline" | "google_calendar";
    applicationId?: string;
    companyName: string;
    position: string;
    status: string;
    externalUrl?: string;
    calendarId?: string;
  };
};

export type CalendarData = {
  events: CalendarEvent[];
  googleCalendar: GoogleCalendarConnection;
};

export async function getCalendarData(userId: string): Promise<CalendarData> {
  const [interviews, slots, deadlines, googleCalendar] = await Promise.all([
    prisma.interview.findMany({
      where: {
        userId,
        deletedAt: null,
        status: InterviewStatus.CONFIRMED,
        confirmedStartAt: {
          not: null
        },
        confirmedEndAt: {
          not: null
        },
        selectionStage: {
          application: {
            deletedAt: null
          }
        }
      },
      include: {
        selectionStage: {
          include: {
            application: {
              include: {
                company: true
              }
            }
          }
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
          selectionStage: {
            application: {
              deletedAt: null
            }
          }
        }
      },
      include: {
        interview: {
          include: {
            selectionStage: {
              include: {
                application: {
                  include: {
                    company: true
                  }
                }
              }
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
        application: {
          deletedAt: null
        }
      },
      include: {
        application: {
          include: {
            company: true
          }
        }
      }
    }),
    getGoogleCalendarEvents(userId)
  ]);

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
            status: interview.status
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
          status: slot.status
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
        status: deadline.status
      }
    })),
    ...googleCalendar.events.map((event) => ({
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
        calendarId: event.calendarId
      }
    }))
  ];

  return {
    events,
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
