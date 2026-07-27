import { EMAIL_MONITOR_OVERLAP_MS } from "@/features/email-monitor/constants";

export type EmailMonitorScanState = {
  monitoringSince: Date;
  cursorAt: Date;
  scanUpperBoundAt: Date | null;
  scanPageToken: string | null;
};

export function startOrResumeEmailMonitorScan(
  state: EmailMonitorScanState,
  now: Date
) {
  const upperBoundAt = state.scanUpperBoundAt ?? now;

  return {
    queryAfter: new Date(
      Math.max(
        state.monitoringSince.getTime(),
        state.cursorAt.getTime() - EMAIL_MONITOR_OVERLAP_MS
      )
    ),
    queryBefore: upperBoundAt,
    pageToken: state.scanPageToken ?? undefined,
    upperBoundAt
  };
}

export function buildEmailMonitorGmailQuery(
  configuredQuery: string,
  queryAfter: Date,
  queryBefore: Date
) {
  const afterSeconds = Math.floor(queryAfter.getTime() / 1_000);
  const beforeSeconds = Math.floor(queryBefore.getTime() / 1_000) + 1;
  return `(${configuredQuery.trim()}) after:${afterSeconds} before:${beforeSeconds}`;
}

export function completeEmailMonitorScanPage(
  upperBoundAt: Date,
  nextPageToken?: string
) {
  return nextPageToken
    ? {
        scanUpperBoundAt: upperBoundAt,
        scanPageToken: nextPageToken
      }
    : {
        cursorAt: upperBoundAt,
        scanUpperBoundAt: null,
        scanPageToken: null
      };
}

export function isWithinEmailMonitorActivationBoundary(
  internalDate: Date | undefined,
  monitoringSince: Date
) {
  return Boolean(internalDate && internalDate >= monitoringSince);
}
