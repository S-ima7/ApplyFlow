import { DEFAULT_TIMEZONE } from "@/lib/date";
import {
  GOOGLE_BASE_AUTH_SCOPES,
  GOOGLE_GMAIL_READONLY_SCOPE,
  getGoogleAccount,
  getValidGoogleAccessToken,
  hasGoogleScope,
  isGoogleAccessTokenExpired
} from "@/lib/google-auth";

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const GOOGLE_AUTH_SCOPES = [
  ...GOOGLE_BASE_AUTH_SCOPES,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE
].join(" ");

export type GoogleCalendarConnectionStatus =
  | "connected"
  | "not_connected"
  | "missing_scope"
  | "missing_token"
  | "error";

export type GoogleCalendarConnection = {
  status: GoogleCalendarConnectionStatus;
  scope?: string | null;
  message?: string;
};

export type GoogleCalendarRange = {
  timeMin: Date;
  timeMax: Date;
};

export type GoogleCalendarEvent = {
  id: string;
  externalEventId: string;
  calendarId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  startDate?: string;
  endDate?: string;
  allDay: boolean;
  transparency: "opaque" | "transparent";
  htmlLink?: string;
};

export type GoogleCalendarEventsResult = GoogleCalendarConnection & {
  events: GoogleCalendarEvent[];
};

export type GoogleCalendarApiEvent = {
  id?: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  transparency?: string;
  start?: GoogleCalendarApiEventDate;
  end?: GoogleCalendarApiEventDate;
};

type GoogleCalendarApiEventDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleCalendarApiEventsResponse = {
  items?: GoogleCalendarApiEvent[];
  nextPageToken?: string;
  error?: {
    message?: string;
  };
};

export function hasGoogleCalendarReadonlyScope(scope?: string | null) {
  return hasGoogleScope(scope, GOOGLE_CALENDAR_READONLY_SCOPE);
}

export function getDefaultGoogleCalendarRange(now = new Date()): GoogleCalendarRange {
  const timeMin = new Date(now.getFullYear(), now.getMonth(), 1);
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 1);

  return { timeMin, timeMax };
}

export async function getGoogleCalendarConnectionStatus(
  userId: string
): Promise<GoogleCalendarConnection> {
  const account = await getGoogleAccount(userId);

  if (!account) {
    return {
      status: "not_connected",
      message: "Googleアカウントが連携されていません"
    };
  }

  if (!hasGoogleCalendarReadonlyScope(account.scope)) {
    return {
      status: "missing_scope",
      scope: account.scope,
      message: "Google Calendar readonly権限が許可されていません"
    };
  }

  if (!account.access_token && !account.refresh_token) {
    return {
      status: "missing_token",
      scope: account.scope,
      message: "Google Calendarを取得するためのトークンがありません"
    };
  }

  if (isGoogleAccessTokenExpired(account) && !account.refresh_token) {
    return {
      status: "missing_token",
      scope: account.scope,
      message: "Google Calendarの再認証が必要です"
    };
  }

  return {
    status: "connected",
    scope: account.scope
  };
}

export async function getGoogleCalendarEvents(
  userId: string,
  range: GoogleCalendarRange = getDefaultGoogleCalendarRange()
): Promise<GoogleCalendarEventsResult> {
  const account = await getGoogleAccount(userId);

  if (!account) {
    return {
      status: "not_connected",
      events: [],
      message: "Googleアカウントが連携されていません"
    };
  }

  if (!hasGoogleCalendarReadonlyScope(account.scope)) {
    return {
      status: "missing_scope",
      scope: account.scope,
      events: [],
      message: "Google Calendar readonly権限が許可されていません"
    };
  }

  const accessToken = await getValidGoogleAccessToken(account);

  if (!accessToken) {
    return {
      status: "missing_token",
      scope: account.scope,
      events: [],
      message: "Google Calendarの再認証が必要です"
    };
  }

  try {
    const apiEvents: GoogleCalendarApiEvent[] = [];
    let pageToken: string | undefined;

    do {
      const response = await fetchGoogleCalendarEvents(accessToken, range, pageToken);
      const data = (await response.json()) as GoogleCalendarApiEventsResponse;

      if (!response.ok) {
        return {
          status: "error",
          scope: account.scope,
          events: [],
          message: getGoogleCalendarApiErrorMessage(response.status, data)
        };
      }

      apiEvents.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return {
      status: "connected",
      scope: account.scope,
      events: mapGoogleCalendarEvents(apiEvents)
    };
  } catch {
    return {
      status: "error",
      scope: account.scope,
      events: [],
      message: "Google Calendar予定を取得できませんでした"
    };
  }
}

export function mapGoogleCalendarEvents(
  events: GoogleCalendarApiEvent[],
  calendarId = "primary"
) {
  return events
    .map((event) => mapGoogleCalendarEvent(event, calendarId))
    .filter((event): event is GoogleCalendarEvent => Boolean(event));
}

export function mapGoogleCalendarEvent(
  event: GoogleCalendarApiEvent,
  calendarId = "primary"
): GoogleCalendarEvent | null {
  if (event.status === "cancelled") {
    return null;
  }

  const start = parseGoogleEventDate(event.start);
  const end = parseGoogleEventDate(event.end);

  if (!start || !end || start.date.getTime() >= end.date.getTime()) {
    return null;
  }

  const externalEventId =
    event.id ?? event.iCalUID ?? `${start.date.toISOString()}:${end.date.toISOString()}`;

  return {
    id: `google:${calendarId}:${externalEventId}`,
    externalEventId,
    calendarId,
    title: event.summary?.trim() || "Google Calendar",
    startAt: start.date,
    endAt: end.date,
    startDate: start.dateText,
    endDate: end.dateText,
    allDay: start.allDay && end.allDay,
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
    htmlLink: event.htmlLink
  };
}

export function buildGoogleCalendarEventsUrl(
  range: GoogleCalendarRange,
  pageToken?: string
) {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", range.timeMin.toISOString());
  url.searchParams.set("timeMax", range.timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("showDeleted", "false");
  url.searchParams.set("maxResults", "2500");

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  return url;
}

export function getGoogleCalendarApiErrorMessage(
  status: number,
  data: GoogleCalendarApiEventsResponse
) {
  const apiMessage = data.error?.message ?? "";

  if (
    status === 403 &&
    /calendar api has not been used|calendar api.*disabled/i.test(apiMessage)
  ) {
    return "Google Cloud ConsoleでGoogle Calendar APIを有効化してください。反映後に再読み込みしてください。";
  }

  if (status === 401) {
    return "Google Calendarの認証期限が切れています。設定画面から再ログインしてください。";
  }

  if (status === 403) {
    return "Google Calendarの予定を読み取る権限がありません。連携権限を確認してください。";
  }

  if (status === 429) {
    return "Google Calendar APIの利用上限に達しました。時間をおいて再読み込みしてください。";
  }

  return "Google Calendar予定を取得できませんでした";
}

function fetchGoogleCalendarEvents(
  accessToken: string,
  range: GoogleCalendarRange,
  pageToken?: string
) {
  const url = buildGoogleCalendarEventsUrl(range, pageToken);

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

function parseGoogleEventDate(value?: GoogleCalendarApiEventDate) {
  if (!value) {
    return null;
  }

  if (value.dateTime) {
    const date = new Date(value.dateTime);

    return Number.isNaN(date.getTime())
      ? null
      : {
          date,
          allDay: false,
          dateText: undefined
        };
  }

  if (value.date) {
    const date = new Date(`${value.date}T00:00:00${getAllDayOffset()}`);

    return Number.isNaN(date.getTime())
      ? null
      : {
          date,
          allDay: true,
          dateText: value.date
        };
  }

  return null;
}

function getAllDayOffset() {
  return DEFAULT_TIMEZONE === "Asia/Tokyo" ? "+09:00" : "Z";
}
