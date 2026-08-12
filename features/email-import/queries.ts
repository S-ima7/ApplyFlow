import { prisma } from "@/lib/prisma";
import { resolveBrowserMessageApplicationMatch } from "@/features/browser-extension/application-matching";
import type { EmailExtraction } from "@/features/email-import/schema";

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

export async function getEmailImportApplicationResolution(
  userId: string,
  extraction: Pick<EmailExtraction, "companyName" | "position">
) {
  const applications = await prisma.application.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      position: true,
      sourceSite: true,
      company: { select: { name: true } }
    }
  });

  return resolveBrowserMessageApplicationMatch(
    applications.map((application) => ({
      id: application.id,
      companyId: application.companyId,
      companyName: application.company.name,
      position: application.position,
      sourceSite: application.sourceSite
    })),
    extraction,
    "gmail"
  );
}
