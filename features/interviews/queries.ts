import { InterviewStatus, ProposedSlotStatus, StageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getWaitingReplyItems(userId: string) {
  return prisma.interview.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [
        {
          status: InterviewStatus.WAITING_REPLY
        },
        {
          selectionStage: {
            status: StageStatus.WAITING_REPLY
          }
        }
      ],
      selectionStage: {
        deletedAt: null,
        application: {
          deletedAt: null
        }
      }
    },
    include: {
      proposedSlots: {
        where: {
          deletedAt: null,
          status: ProposedSlotStatus.PENDING
        },
        orderBy: {
          startAt: "asc"
        }
      },
      selectionStage: {
        include: {
          application: {
            include: {
              company: true,
              deadlines: {
                where: {
                  deletedAt: null
                },
                orderBy: {
                  dueAt: "asc"
                },
                take: 1
              }
            }
          }
        }
      }
    },
    orderBy: {
      updatedAt: "asc"
    }
  });
}
