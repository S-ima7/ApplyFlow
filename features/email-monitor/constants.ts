export const DEFAULT_EMAIL_MONITOR_QUERY =
  "in:inbox {面接 選考 応募 採用 内定 オファー 日程調整 書類選考} -category:promotions";

export const EMAIL_MONITOR_OVERLAP_MS = 10 * 60 * 1_000;
export const EMAIL_MONITOR_BATCH_SIZE = 25;
export const EMAIL_MONITOR_LEASE_MS = 10 * 60 * 1_000;
export const EMAIL_MONITOR_MAX_ATTEMPTS = 3;
export const EMAIL_MONITOR_CONFIDENCE_THRESHOLD = 0.9;
export const EMAIL_MONITOR_DEFAULT_DAILY_NEURON_BUDGET = 10_000;
export const MANUAL_EMAIL_IMPORT_JOB_CODE = "MANUAL_EMAIL_IMPORT";

export function getEmailMonitorDailyNeuronBudget() {
  const configured = Number(process.env.AI_DAILY_NEURON_BUDGET);

  if (!Number.isInteger(configured) || configured <= 0) {
    return EMAIL_MONITOR_DEFAULT_DAILY_NEURON_BUDGET;
  }

  return Math.min(configured, EMAIL_MONITOR_DEFAULT_DAILY_NEURON_BUDGET);
}
