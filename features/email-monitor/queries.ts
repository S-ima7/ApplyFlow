import { prisma } from "@/lib/prisma";

export function getRecentEmailAutomationJobs(userId: string, limit = 25) {
  const take = Math.min(Math.max(Math.trunc(limit), 1), 100);

  return prisma.emailAutomationJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      processedAt: true,
      createdAt: true,
      extractionResultId: true,
      emailImport: {
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          sentAt: true
        }
      },
      matchedApplication: {
        select: {
          id: true,
          position: true,
          company: { select: { name: true } }
        }
      }
    }
  });
}
