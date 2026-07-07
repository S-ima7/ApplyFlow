import { format, formatDistanceToNowStrict, isAfter, isBefore } from "date-fns";

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export function parseDateTimeLocal(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  return format(new Date(value), "yyyy/MM/dd HH:mm");
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) {
    return "-";
  }

  return format(new Date(value), "yyyy/MM/dd");
}

export function formatTimeRange(
  startAt: Date | string | null | undefined,
  endAt: Date | string | null | undefined
) {
  if (!startAt || !endAt) {
    return "-";
  }

  const start = new Date(startAt);
  const end = new Date(endAt);

  return `${format(start, "yyyy/MM/dd HH:mm")} - ${format(end, "HH:mm")}`;
}

export function daysUntil(value: Date | string) {
  const date = new Date(value);
  const now = new Date();
  const prefix = isBefore(date, now) ? "期限切れ " : "残り ";

  return `${prefix}${formatDistanceToNowStrict(date, { addSuffix: false })}`;
}

export function isWithinNextDays(value: Date | string, days: number) {
  const date = new Date(value);
  const now = new Date();
  const threshold = new Date(now);
  threshold.setDate(now.getDate() + days);

  return isAfter(date, now) && isBefore(date, threshold);
}

export function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  return format(new Date(value), "yyyy-MM-dd");
}

export function toDateTimeLocalValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
}
