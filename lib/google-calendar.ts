import { createHash } from "node:crypto";
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

export const GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

export const GOOGLE_AUTH_SCOPES = [
  ...GOOGLE_BASE_AUTH_SCOPES,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE,
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
  description?: string;
  location?: string;
  meetingUrl?: string;
  timezone?: string;
  updatedAt?: Date;
  applyFlowInterviewKey?: string;
};

export type GoogleCalendarInterviewEventInput = {
  interviewId: string;
  companyName: string;
  position: string;
  title?: string | null;
  location?: string | null;
  meetingUrl?: string | null;
  note?: string | null;
  startAt: Date;
  endAt: Date;
};

export type GoogleCalendarInterviewExportResult =
  | {
      status: "created" | "already_exists";
      eventUrl?: string;
      message: string;
    }
  | {
      status: "missing_scope" | "reauth_required" | "error";
      message: string;
    };

export type GoogleCalendarInterviewApiEvent = {
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  extendedProperties: {
    private: {
      applyFlowInterviewKey: string;
    };
  };
};

export type GoogleCalendarEventsResult = GoogleCalendarConnection & {
  events: GoogleCalendarEvent[];
};

export type GoogleCalendarEventResult = GoogleCalendarConnection & {
  event?: GoogleCalendarEvent;
};

export type GoogleCalendarApiEvent = {
  id?: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  updated?: string;
  transparency?: string;
  start?: GoogleCalendarApiEventDate;
  end?: GoogleCalendarApiEventDate;
  extendedProperties?: {
    private?: Record<string, string>;
  };
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
    errors?: Array<{
      reason?: string;
    }>;
  };
};

export function hasGoogleCalendarReadonlyScope(scope?: string | null) {
  return hasGoogleScope(scope, GOOGLE_CALENDAR_READONLY_SCOPE);
}

export function hasGoogleCalendarEventsOwnedScope(scope?: string | null) {
  return hasGoogleScope(scope, GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE);
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

  if (!hasGoogleCalendarEventsOwnedScope(account.scope)) {
    return {
      status: "missing_scope",
      scope: account.scope,
      message:
        "Google Calendarへの予定登録権限がありません。再ログインして権限を許可してください"
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

export async function getGoogleCalendarEventById(
  userId: string,
  calendarId: string,
  eventId: string
): Promise<GoogleCalendarEventResult> {
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

  const accessToken = await getValidGoogleAccessToken(account);

  if (!accessToken) {
    return {
      status: "missing_token",
      scope: account.scope,
      message: "Google Calendarの再認証が必要です"
    };
  }

  try {
    const response = await fetch(buildGoogleCalendarEventUrl(calendarId, eventId), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const data = (await response.json()) as GoogleCalendarApiEvent &
      GoogleCalendarApiEventsResponse;

    if (!response.ok) {
      return {
        status: "error",
        scope: account.scope,
        message: getGoogleCalendarApiErrorMessage(response.status, data)
      };
    }

    const event = mapGoogleCalendarEvent(data, calendarId);

    if (!event) {
      return {
        status: "error",
        scope: account.scope,
        message: "対象のGoogle Calendar予定は削除済みか、日時が不正です"
      };
    }

    return {
      status: "connected",
      scope: account.scope,
      event
    };
  } catch {
    return {
      status: "error",
      scope: account.scope,
      message: "Google Calendar予定を取得できませんでした"
    };
  }
}

export function getGoogleCalendarInterviewEventId(
  userId: string,
  interviewId: string
) {
  return createHash("sha256")
    .update(`applyflow:interview:${userId}:${interviewId}`)
    .digest("hex");
}

export function buildGoogleCalendarInterviewEvent(
  userId: string,
  input: GoogleCalendarInterviewEventInput
): GoogleCalendarInterviewApiEvent {
  const eventId = getGoogleCalendarInterviewEventId(userId, input.interviewId);
  const title = input.title?.trim() || "面接";
  const description = [
    `会社: ${input.companyName}`,
    `ポジション: ${input.position}`,
    input.meetingUrl?.trim() ? `面談URL: ${input.meetingUrl.trim()}` : null,
    input.note?.trim() ? `説明: ${input.note.trim()}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    id: eventId,
    summary: `${input.companyName}｜${title}`,
    description,
    location: input.location?.trim() || undefined,
    start: { dateTime: input.startAt.toISOString() },
    end: { dateTime: input.endAt.toISOString() },
    extendedProperties: {
      private: {
        applyFlowInterviewKey: eventId
      }
    }
  };
}

export async function createGoogleCalendarInterviewEvent(
  userId: string,
  input: GoogleCalendarInterviewEventInput
): Promise<GoogleCalendarInterviewExportResult> {
  const account = await getGoogleAccount(userId);

  if (!account || !hasGoogleCalendarEventsOwnedScope(account.scope)) {
    return {
      status: "missing_scope",
      message:
        "Google Calendarへの予定登録権限がありません。設定画面から再ログインしてください"
    };
  }

  const accessToken = await getValidGoogleAccessToken(account);

  if (!accessToken) {
    return {
      status: "reauth_required",
      message: "Google Calendarの再認証が必要です"
    };
  }

  const event = buildGoogleCalendarInterviewEvent(userId, input);
  const url = buildGoogleCalendarEventCollectionUrl("primary");
  url.searchParams.set("sendUpdates", "none");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event)
    });

    if (response.ok) {
      const created = (await response.json()) as GoogleCalendarApiEvent;

      return {
        status: "created",
        eventUrl: created.htmlLink,
        message: "Google Calendarに登録しました"
      };
    }

    if (response.status === 409) {
      return verifyExistingGoogleCalendarInterviewEvent(
        accessToken,
        event.id
      );
    }

    const data = (await response.json()) as GoogleCalendarApiEventsResponse;

    return getGoogleCalendarWriteError(
      response.status,
      data,
      "Google Calendarへの登録に失敗しました"
    );
  } catch {
    return {
      status: "error",
      message:
        "Google Calendarへの登録結果を確認できませんでした。再度実行しても重複は作成されません"
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
    htmlLink: event.htmlLink,
    description: event.description?.trim() || undefined,
    location: event.location?.trim() || undefined,
    meetingUrl: event.hangoutLink?.trim() || findMeetingUrl(event.description),
    timezone: event.start?.timeZone ?? DEFAULT_TIMEZONE,
    updatedAt: parseOptionalDate(event.updated),
    applyFlowInterviewKey:
      event.extendedProperties?.private?.applyFlowInterviewKey
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

export function buildGoogleCalendarEventUrl(calendarId: string, eventId: string) {
  return new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  );
}

export function buildGoogleCalendarEventCollectionUrl(calendarId: string) {
  return new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
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

  if (status === 404) {
    return "対象のGoogle Calendar予定が見つかりません";
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

async function verifyExistingGoogleCalendarInterviewEvent(
  accessToken: string,
  eventId: string
): Promise<GoogleCalendarInterviewExportResult> {
  const response = await fetch(buildGoogleCalendarEventUrl("primary", eventId), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const data = (await response.json()) as GoogleCalendarApiEventsResponse;

    return getGoogleCalendarWriteError(
      response.status,
      data,
      "Google Calendarの既存予定を確認できませんでした"
    );
  }

  const existing = (await response.json()) as GoogleCalendarApiEvent;

  if (
    existing.status === "cancelled" ||
    existing.id !== eventId ||
    existing.extendedProperties?.private?.applyFlowInterviewKey !== eventId
  ) {
    return {
      status: "error",
      message: "Google Calendar上で予定IDが競合しているため登録できませんでした"
    };
  }

  return {
    status: "already_exists",
    eventUrl: existing.htmlLink,
    message: "Google Calendarに登録済みです"
  };
}

function getGoogleCalendarWriteError(
  status: number,
  data: GoogleCalendarApiEventsResponse,
  fallbackMessage: string
): GoogleCalendarInterviewExportResult {
  if (status === 401) {
    return {
      status: "reauth_required",
      message: "Google Calendarの再認証が必要です"
    };
  }

  const apiMessage = data.error?.message ?? "";
  const reasons = new Set(
    (data.error?.errors ?? [])
      .map((error) => error.reason)
      .filter((reason): reason is string => Boolean(reason))
  );

  if (
    status === 429 ||
    reasons.has("rateLimitExceeded") ||
    reasons.has("userRateLimitExceeded") ||
    reasons.has("quotaExceeded")
  ) {
    return {
      status: "error",
      message:
        "Google Calendar APIの利用上限に達しました。時間をおいて再度お試しください"
    };
  }

  if (
    status === 403 &&
    /calendar api has not been used|calendar api.*disabled/i.test(apiMessage)
  ) {
    return {
      status: "error",
      message: getGoogleCalendarApiErrorMessage(status, data)
    };
  }

  if (
    status === 403 &&
    (reasons.has("insufficientPermissions") ||
      /insufficient.*(?:permission|scope)|permission.*denied/i.test(apiMessage))
  ) {
    return {
      status: "missing_scope",
      message:
        "Google Calendarへ登録する権限がありません。設定画面から再ログインしてください"
    };
  }

  return {
    status: "error",
    message: fallbackMessage
  };
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

function parseOptionalDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function findMeetingUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  return value.match(/https?:\/\/[^\s<>]*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)[^\s<>]*/i)?.[0];
}
