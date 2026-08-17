import {
  InterviewStatus,
  ProposedSlotStatus,
  ScheduleEventSource
} from "@prisma/client";
import {
  getGoogleCalendarImportKey,
  isApplyFlowInterviewCalendarEvent
} from "@/features/calendar/import";
import { prisma } from "@/lib/prisma";
import { detectConflicts } from "@/features/conflict-detection";
import { googleCalendarEventsToScheduleItems } from "@/features/conflict-detection/google-calendar";
import type { ConflictAlert, ScheduleItem } from "@/features/conflict-detection/types";
import {
  getGoogleCalendarEvents,
  getGoogleCalendarInterviewEventId,
  type GoogleCalendarRange
} from "@/lib/google-calendar";

export async function getScheduleItemsForConflict(
  userId: string,
  googleRange?: GoogleCalendarRange
): Promise<ScheduleItem[]> {
  const [slots, interviews, scheduleEvents, googleCalendar] = await Promise.all([
    prisma.proposedSlot.findMany({
      where: {
        userId,
        deletedAt: null,
        status: {
          in: [ProposedSlotStatus.PENDING, ProposedSlotStatus.CONFIRMED]
        },
        interview: {
          deletedAt: null,
          selectionStage: {
            deletedAt: null,
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
          deletedAt: null,
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
    prisma.scheduleEvent.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(googleRange
          ? {
              startAt: { lt: googleRange.timeMax },
              endAt: { gt: googleRange.timeMin }
            }
          : {})
      },
      include: {
        application: {
          include: {
            company: true
          }
        }
      }
    }),
    getGoogleCalendarEvents(userId, googleRange)
  ]);

  const slotItems: ScheduleItem[] = slots.map((slot) => {
    const application = slot.interview.selectionStage.application;

    return {
      id: `slot:${slot.id}`,
      eventGroupId: `interview:${slot.interviewId}`,
      kind: "proposed_slot",
      status: slot.status === ProposedSlotStatus.CONFIRMED ? "confirmed" : "pending",
      startAt: slot.startAt,
      endAt: slot.endAt,
      title: slot.interview.title ?? slot.interview.selectionStage.name ?? "候補日時",
      companyName: application.company.name,
      position: application.position,
      applicationId: application.id
    };
  });

  const interviewItems: ScheduleItem[] = interviews
    .filter((interview) => interview.confirmedStartAt && interview.confirmedEndAt)
    .map((interview) => {
      const application = interview.selectionStage.application;

      return {
        id: `interview:${interview.id}`,
        eventGroupId: `interview:${interview.id}`,
        kind: "confirmed_interview",
        status: "confirmed",
        startAt: interview.confirmedStartAt as Date,
        endAt: interview.confirmedEndAt as Date,
        title: interview.title ?? interview.selectionStage.name ?? "確定面談",
        companyName: application.company.name,
        position: application.position,
        applicationId: application.id
      };
    });

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
  const exportedInterviewKeys = new Set(
    interviews.map((interview) =>
      getGoogleCalendarInterviewEventId(userId, interview.id)
    )
  );

  const scheduleItems: ScheduleItem[] = scheduleEvents.map((event) => ({
    id: `schedule:${event.id}`,
    kind: "google_calendar_event" as const,
    status: "confirmed" as const,
    startAt: event.startAt,
    endAt: event.endAt,
    title: event.title,
    companyName: event.application?.company.name ?? "ApplyFlow予定",
    position: event.application?.position ?? "Google Calendarから取込済み",
    applicationId: event.applicationId ?? undefined
  }));

  const googleItems = googleCalendarEventsToScheduleItems(
    googleCalendar.events.filter(
      (event) =>
        !importedGoogleKeys.has(
          getGoogleCalendarImportKey(event.calendarId, event.externalEventId)
        ) &&
        !isApplyFlowInterviewCalendarEvent(event, exportedInterviewKeys)
    )
  );

  return [...slotItems, ...interviewItems, ...scheduleItems, ...googleItems];
}

export async function getConflictAlertsForUser(userId: string): Promise<ConflictAlert[]> {
  const items = await getScheduleItemsForConflict(userId);
  return detectConflicts(items);
}

export async function getConflictAlertsForTarget(
  userId: string,
  target: ScheduleItem
): Promise<ConflictAlert[]> {
  const items = await getScheduleItemsForConflict(userId, {
    timeMin: target.startAt,
    timeMax: target.endAt
  });
  return detectConflicts(items, target);
}
