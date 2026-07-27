import { prisma } from "@/lib/prisma";

export async function getEmailExtractionForConfirmation(
  userId: string,
  extractionResultId: string
) {
  return prisma.aiExtractionResult.findFirst({
    where: {
      id: extractionResultId,
      userId
    },
    include: {
      emailImport: true,
      createdApplication: {
        select: {
          id: true,
          company: {
            select: {
              name: true
            }
          },
          position: true
        }
      },
      automationJob: {
        select: {
          status: true,
          errorCode: true,
          matchedApplication: {
            select: {
              id: true,
              position: true,
              company: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }
    }
  });
}
