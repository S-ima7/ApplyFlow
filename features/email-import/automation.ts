import { Prisma } from "@prisma/client";
import { resolveBrowserMessageApplicationMatch } from "@/features/browser-extension/application-matching";
import { EMAIL_MONITOR_CONFIDENCE_THRESHOLD } from "@/features/email-monitor/constants";
import { requiredConfidenceFields } from "@/features/email-monitor/policy";
import { getEmailImportConfirmDefaults } from "@/features/email-import/defaults";
import { createEmailImportApplication } from "@/features/email-import/registration";
import {
  emailImportConfirmSchema,
  type EmailAiExtraction
} from "@/features/email-import/schema";
import { prisma } from "@/lib/prisma";

export async function tryAutoCreateEmailImportApplication(input: {
  userId: string;
  timezone: string;
  emailImportId: string;
  extractionResultId: string;
  extraction: EmailAiExtraction;
}) {
  const data = autoRegistrationInput(input.extraction, input.timezone);
  if (!data) return null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "EmailImport"
      WHERE "id" = ${input.emailImportId} AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    const duplicate = await tx.aiExtractionResult.findFirst({
      where: {
        emailImportId: input.emailImportId,
        createdApplicationId: { not: null }
      },
      select: { createdApplicationId: true }
    });
    if (duplicate?.createdApplicationId) {
      return { applicationId: duplicate.createdApplicationId, created: false };
    }

    const applications = await tx.application.findMany({
      where: { userId: input.userId, deletedAt: null },
      select: {
        id: true,
        companyId: true,
        position: true,
        sourceSite: true,
        company: { select: { name: true } }
      }
    });
    const match = resolveBrowserMessageApplicationMatch(
      applications.map((application) => ({
        id: application.id,
        companyId: application.companyId,
        companyName: application.company.name,
        position: application.position,
        sourceSite: application.sourceSite
      })),
      { companyName: data.companyName, position: data.position },
      "gmail"
    );
    if (
      match.resolution === "EXACT_APPLICATION" ||
      match.resolution === "CONFIRM_APPLICATION" ||
      match.resolution === "CONFIRM_COMPANY"
    ) {
      return null;
    }

    const application = await createEmailImportApplication(tx, {
      userId: input.userId,
      timezone: input.timezone,
      data,
      slotSource: `email_import:${input.extractionResultId}`
    });
    await tx.aiExtractionResult.update({
      where: { id: input.extractionResultId },
      data: {
        reviewedJson: data as Prisma.InputJsonValue,
        confirmedAt: new Date(),
        createdApplicationId: application.id
      }
    });
    return { applicationId: application.id, created: true };
  });
}

export function autoRegistrationInput(
  extraction: EmailAiExtraction,
  timezone: string
) {
  if (!extraction.relevant || extraction.eventType !== "CREATE_OR_UPDATE") {
    return null;
  }
  if (!extraction.companyName?.trim() || !extraction.position?.trim()) return null;
  if (
    looksLikeJsonObject(extraction.companyName) ||
    looksLikeJsonObject(extraction.position)
  ) {
    return null;
  }
  if (extraction.confidence < EMAIL_MONITOR_CONFIDENCE_THRESHOLD) return null;
  if (
    requiredConfidenceFields(extraction).some(
      (field) =>
        extraction.fieldConfidence[
          field as keyof typeof extraction.fieldConfidence
        ] < EMAIL_MONITOR_CONFIDENCE_THRESHOLD
    )
  ) {
    return null;
  }
  const hasSchedule =
    Boolean(extraction.confirmedSlot.startAt) || extraction.proposedSlots.length > 0;
  if (hasSchedule && !extraction.stageType) return null;

  const parsed = emailImportConfirmSchema.safeParse(
    getEmailImportConfirmDefaults(extraction, timezone)
  );
  return parsed.success ? parsed.data : null;
}

function looksLikeJsonObject(value: string) {
  const normalized = value.trim();
  return normalized.startsWith("{") && normalized.endsWith("}");
}
