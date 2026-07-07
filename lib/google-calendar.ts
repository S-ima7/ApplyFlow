import type { Account } from "@prisma/client";
import { DEFAULT_TIMEZONE } from "@/lib/date";
import { prisma } from "@/lib/prisma";

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const GOOGLE_AUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  GOOGLE_CALENDAR_READONLY_SCOPE
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
  error?: {
    message?: string;
  };
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export function hasGoogleCalendarReadonlyScope(scope?: string | null) {
  return (scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .includes(GOOGLE_CALENDAR_READONLY_SCOPE);
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

  if (isAccessTokenExpired(account) && !account.refresh_token) {
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

  const accessToken = await getValidAccessToken(account);

  if (!accessToken) {
    return {
      status: "missing_token",
      scope: account.scope,
      events: [],
      message: "Google Calendarの再認証が必要です"
    };
  }

  try {
    const response = await fetchGoogleCalendarEvents(accessToken, range);

    if (!response.ok) {
      return {
        status: "error",
        scope: account.scope,
        events: [],
        message: "Google Calendar予定を取得できませんでした"
      };
    }

    const data = (await response.json()) as GoogleCalendarApiEventsResponse;

    return {
      status: "connected",
      scope: account.scope,
      events: mapGoogleCalendarEvents(data.items ?? [])
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

async function getGoogleAccount(userId: string) {
  return prisma.account.findFirst({
    where: {
      userId,
      provider: "google"
    }
  });
}

function isAccessTokenExpired(account: Account) {
  if (!account.expires_at) {
    return false;
  }

  const nowWithBuffer = Math.floor(Date.now() / 1000) + 60;
  return account.expires_at <= nowWithBuffer;
}

async function getValidAccessToken(account: Account) {
  if (account.access_token && !isAccessTokenExpired(account)) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    return account.access_token;
  }

  return refreshAccessToken(account);
}

async function refreshAccessToken(account: Account) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret || !account.refresh_token) {
    return null;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token
    })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as GoogleTokenResponse;

  if (!data.access_token) {
    return null;
  }

  await prisma.account.update({
    where: {
      id: account.id
    },
    data: {
      access_token: data.access_token,
      expires_at: data.expires_in
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : account.expires_at,
      refresh_token: data.refresh_token ?? account.refresh_token,
      scope: data.scope ?? account.scope,
      token_type: data.token_type ?? account.token_type
    }
  });

  return data.access_token;
}

function fetchGoogleCalendarEvents(accessToken: string, range: GoogleCalendarRange) {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", range.timeMin.toISOString());
  url.searchParams.set("timeMax", range.timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("showDeleted", "false");

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
