import { DeadlineStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getDeadlines(userId: string) {
  return prisma.deadline.findMany({
    where: {
      userId,
      deletedAt: null,
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
    },
    orderBy: [
      {
        status: "asc"
      },
      {
        dueAt: "asc"
      }
    ]
  });
}

export async function getOpenDeadlines(userId: string) {
  return prisma.deadline.findMany({
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
    },
    orderBy: {
      dueAt: "asc"
    }
  });
}
