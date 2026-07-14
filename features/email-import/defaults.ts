import { toDateTimeLocalValue } from "@/lib/date";
import type {
  EmailExtraction,
  EmailImportConfirmInput
} from "@/features/email-import/schema";

export function getEmailImportConfirmDefaults(
  extraction: EmailExtraction
): EmailImportConfirmInput {
  return {
    companyName: extraction.companyName ?? "",
    position: extraction.position ?? "",
    applicationType: "CAREER_CHANGE",
    route: "DIRECT",
    priority: "MEDIUM",
    stageType: extraction.stageType ?? "OTHER",
    stageName: extraction.stageName ?? "",
    confirmedStartAt: toDateTimeLocalValue(extraction.confirmedSlot.startAt),
    confirmedEndAt: toDateTimeLocalValue(extraction.confirmedSlot.endAt),
    proposedSlots: extraction.proposedSlots.map((slot) => ({
      startAt: toDateTimeLocalValue(slot.startAt),
      endAt: toDateTimeLocalValue(slot.endAt),
      timezone: slot.timezone ?? "Asia/Tokyo",
      note: ""
    })),
    replyDeadlineAt: toDateTimeLocalValue(extraction.replyDeadline),
    offerAcceptanceDeadlineAt: toDateTimeLocalValue(extraction.offerAcceptanceDeadline),
    meetingUrl: extraction.meetingUrl ?? "",
    interviewerName: extraction.interviewerName ?? "",
    note: ""
  };
}
