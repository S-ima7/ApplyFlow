import { EmailAutomationJobStatus } from "@prisma/client";
import { EMAIL_MONITOR_MAX_ATTEMPTS } from "@/features/email-monitor/constants";

export function isEmailAutomationJobClaimable(
  job: {
    status: EmailAutomationJobStatus;
    nextAttemptAt: Date | null;
    leaseUntil: Date | null;
  },
  now: Date
) {
  if (job.status === EmailAutomationJobStatus.PENDING) return true;
  if (job.status === EmailAutomationJobStatus.RETRY_WAIT) {
    return !job.nextAttemptAt || job.nextAttemptAt <= now;
  }
  if (job.status === EmailAutomationJobStatus.PROCESSING) {
    return Boolean(job.leaseUntil && job.leaseUntil < now);
  }
  return false;
}

export function getEmailAutomationRetryTransition(
  attempts: number,
  now: Date
) {
  if (attempts >= EMAIL_MONITOR_MAX_ATTEMPTS) {
    return {
      status: EmailAutomationJobStatus.FAILED,
      nextAttemptAt: null
    };
  }

  return {
    status: EmailAutomationJobStatus.RETRY_WAIT,
    nextAttemptAt: new Date(now.getTime() + attempts * 15 * 60 * 1_000)
  };
}

export function nextUtcDay(now: Date) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )
  );
}

export function utcDayStart(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}
