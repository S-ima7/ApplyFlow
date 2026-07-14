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

export function parseDateTimeInTimezone(value: string, timezone = DEFAULT_TIMEZONE) {
  if (!value) {
    return null;
  }

  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const absoluteDate = new Date(value);
    return Number.isNaN(absoluteDate.getTime()) ? null : absoluteDate;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const firstOffset = getTimezoneOffset(new Date(localAsUtc), timezone);
  let result = new Date(localAsUtc - firstOffset);
  const secondOffset = getTimezoneOffset(result, timezone);

  if (secondOffset !== firstOffset) {
    result = new Date(localAsUtc - secondOffset);
  }

  return Number.isNaN(result.getTime()) ? null : result;
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

function getTimezoneOffset(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return (
    Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second
    ) - date.getTime()
  );
}
