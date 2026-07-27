import {
  isExactCompanyName,
  isExactMatchText
} from "@/features/browser-extension/application-matching";
import { EMAIL_MONITOR_CONFIDENCE_THRESHOLD } from "@/features/email-monitor/constants";
import type { EmailMonitorExtraction } from "@/features/email-monitor/schema";

export type EmailAutomationApplicationCandidate = {
  id: string;
  companyName: string;
  position: string;
};

export type EmailAutomationTargetContext = {
  matchingStageCount: number;
  activeInterviewCount: number;
  activeInterviewId: string | null;
  hasManualDataConflict: boolean;
  hasDeadlineConflict: boolean;
};

export type EmailAutomationDecision =
  | {
      action: "IGNORE";
      reason: "NOT_RELEVANT" | "INFORMATION_ONLY";
    }
  | {
      action: "REVIEW_REQUIRED";
      reason:
        | "CANCEL_REQUIRES_CONFIRMATION"
        | "MISSING_TARGET_IDENTITY"
        | "APPLICATION_NOT_UNIQUE"
        | "MISSING_STAGE"
        | "LOW_CONFIDENCE"
        | "NO_ACTIONABLE_CHANGE"
        | "STAGE_NOT_UNIQUE"
        | "INTERVIEW_NOT_UNIQUE"
        | "MANUAL_DATA_CONFLICT"
        | "DEADLINE_CONFLICT";
      applicationId?: string;
    }
  | {
      action: "AUTO_APPLY";
      applicationId: string;
      interviewId: string | null;
    };

export function decideEmailAutomation(
  extraction: EmailMonitorExtraction,
  applications: EmailAutomationApplicationCandidate[],
  target: EmailAutomationTargetContext | null
): EmailAutomationDecision {
  if (
    extraction.confidence < EMAIL_MONITOR_CONFIDENCE_THRESHOLD ||
    (extraction.fieldConfidence.relevant ?? -1) <
      EMAIL_MONITOR_CONFIDENCE_THRESHOLD ||
    (extraction.fieldConfidence.eventType ?? -1) <
      EMAIL_MONITOR_CONFIDENCE_THRESHOLD
  ) {
    return { action: "REVIEW_REQUIRED", reason: "LOW_CONFIDENCE" };
  }

  if (!extraction.relevant) {
    return { action: "IGNORE", reason: "NOT_RELEVANT" };
  }

  if (extraction.eventType === "INFORMATION_ONLY") {
    return { action: "IGNORE", reason: "INFORMATION_ONLY" };
  }

  if (extraction.eventType === "CANCEL") {
    return {
      action: "REVIEW_REQUIRED",
      reason: "CANCEL_REQUIRES_CONFIRMATION"
    };
  }

  if (!extraction.companyName?.trim() || !extraction.position?.trim()) {
    return { action: "REVIEW_REQUIRED", reason: "MISSING_TARGET_IDENTITY" };
  }

  const exactApplications = applications.filter(
    (application) =>
      isExactCompanyName(application.companyName, extraction.companyName ?? "") &&
      isExactMatchText(application.position, extraction.position ?? "")
  );
  if (exactApplications.length !== 1) {
    return { action: "REVIEW_REQUIRED", reason: "APPLICATION_NOT_UNIQUE" };
  }

  const applicationId = exactApplications[0].id;
  if (!hasSufficientConfidence(extraction)) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "LOW_CONFIDENCE",
      applicationId
    };
  }

  if (!hasActionableChange(extraction)) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "NO_ACTIONABLE_CHANGE",
      applicationId
    };
  }

  if (
    (extraction.confirmedSlot.startAt || extraction.proposedSlots.length > 0) &&
    !extraction.stageType
  ) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "MISSING_STAGE",
      applicationId
    };
  }

  if (!target || target.matchingStageCount > 1) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "STAGE_NOT_UNIQUE",
      applicationId
    };
  }

  if (
    target.activeInterviewCount > 1 ||
    (extraction.eventType === "RESCHEDULE" &&
      (target.matchingStageCount !== 1 ||
        target.activeInterviewCount !== 1 ||
        !target.activeInterviewId))
  ) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "INTERVIEW_NOT_UNIQUE",
      applicationId
    };
  }

  if (target.hasManualDataConflict) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "MANUAL_DATA_CONFLICT",
      applicationId
    };
  }

  if (target.hasDeadlineConflict) {
    return {
      action: "REVIEW_REQUIRED",
      reason: "DEADLINE_CONFLICT",
      applicationId
    };
  }

  return {
    action: "AUTO_APPLY",
    applicationId,
    interviewId: target.activeInterviewId
  };
}

export function requiredConfidenceFields(extraction: EmailMonitorExtraction) {
  const fields = new Set(["relevant", "eventType", "companyName", "position"]);
  const hasSchedule =
    Boolean(extraction.confirmedSlot.startAt) || extraction.proposedSlots.length > 0;

  if (hasSchedule) fields.add("stageType");
  if (extraction.stageName) fields.add("stageName");
  if (extraction.confirmedSlot.startAt) fields.add("confirmedSlot");
  if (extraction.proposedSlots.length > 0) fields.add("proposedSlots");
  if (extraction.replyDeadline) fields.add("replyDeadline");
  if (extraction.offerAcceptanceDeadline) fields.add("offerAcceptanceDeadline");
  if (extraction.meetingUrl) fields.add("meetingUrl");
  if (extraction.interviewerName) fields.add("interviewerName");

  return [...fields];
}

function hasSufficientConfidence(extraction: EmailMonitorExtraction) {
  if (extraction.confidence < EMAIL_MONITOR_CONFIDENCE_THRESHOLD) {
    return false;
  }

  return requiredConfidenceFields(extraction).every(
    (field) =>
      (extraction.fieldConfidence[field] ?? -1) >=
      EMAIL_MONITOR_CONFIDENCE_THRESHOLD
  );
}

function hasActionableChange(extraction: EmailMonitorExtraction) {
  return Boolean(
    extraction.confirmedSlot.startAt ||
      extraction.proposedSlots.length > 0 ||
      extraction.replyDeadline ||
      extraction.offerAcceptanceDeadline
  );
}
