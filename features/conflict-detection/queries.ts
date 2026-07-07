import { InterviewStatus, ProposedSlotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectConflicts } from "@/features/conflict-detection";
import type { ConflictAlert, ScheduleItem } from "@/features/conflict-detection/types";

export async function getScheduleItemsForConflict(userId: string): Promise<ScheduleItem[]> {
  const [slots, interviews] = await Promise.all([
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
    })
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

  return [...slotItems, ...interviewItems];
}

export async function getConflictAlertsForUser(userId: string): Promise<ConflictAlert[]> {
  const items = await getScheduleItemsForConflict(userId);
  return detectConflicts(items);
}

export async function getConflictAlertsForTarget(
  userId: string,
  target: ScheduleItem
): Promise<ConflictAlert[]> {
  const items = await getScheduleItemsForConflict(userId);
  return detectConflicts(items, target);
}
