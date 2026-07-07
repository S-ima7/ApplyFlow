import { DeadlineStatus, InterviewStatus, ProposedSlotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  className?: string;
  extendedProps: {
    kind: "confirmed_interview" | "proposed_slot" | "deadline";
    applicationId: string;
    companyName: string;
    position: string;
    status: string;
  };
};

export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const [interviews, slots, deadlines] = await Promise.all([
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
    })
  ]);

  return [
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
    }))
  ];
}
