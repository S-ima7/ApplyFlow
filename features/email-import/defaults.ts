import { toDateTimeLocalValueInTimezone } from "@/lib/date";
import type {
  EmailExtraction,
  EmailImportConfirmInput
} from "@/features/email-import/schema";

export function getEmailImportConfirmDefaults(
  extraction: EmailExtraction,
  timezone: string
): EmailImportConfirmInput {
  return {
    companyName: extraction.companyName ?? "",
    position: extraction.position ?? "",
    applicationType: "CAREER_CHANGE",
    route: "DIRECT",
    priority: "MEDIUM",
    stageType: extraction.stageType ?? "OTHER",
    stageName: extraction.stageName ?? "",
    confirmedStartAt: toDateTimeLocalValueInTimezone(
      extraction.confirmedSlot.startAt,
      timezone
    ),
    confirmedEndAt: toDateTimeLocalValueInTimezone(
      extraction.confirmedSlot.endAt,
      timezone
    ),
    proposedSlots: extraction.proposedSlots.map((slot) => ({
      startAt: toDateTimeLocalValueInTimezone(slot.startAt, slot.timezone ?? timezone),
      endAt: toDateTimeLocalValueInTimezone(slot.endAt, slot.timezone ?? timezone),
      timezone: slot.timezone ?? timezone,
      note: ""
    })),
    replyDeadlineAt: toDateTimeLocalValueInTimezone(extraction.replyDeadline, timezone),
    offerAcceptanceDeadlineAt: toDateTimeLocalValueInTimezone(
      extraction.offerAcceptanceDeadline,
      timezone
    ),
    meetingUrl: extraction.meetingUrl ?? "",
    interviewerName: extraction.interviewerName ?? "",
    note: ""
  };
}
