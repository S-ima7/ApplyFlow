import {
  GOOGLE_GMAIL_READONLY_SCOPE,
  getGoogleAccount,
  getValidGoogleAccessToken,
  hasGoogleScope,
  isGoogleAccessTokenExpired
} from "@/lib/google-auth";

export { GOOGLE_GMAIL_READONLY_SCOPE };

export type GmailConnectionStatus =
  | "connected"
  | "not_connected"
  | "missing_scope"
  | "missing_token"
  | "error";

export type GmailConnection = {
  status: GmailConnectionStatus;
  scope?: string | null;
  message?: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId?: string;
  subject?: string;
  fromAddress?: string;
  snippet?: string;
  sentAt?: Date;
};

export type GmailFullMessage = GmailMessageSummary & {
  bodyText: string;
};

export type GmailMessagesResult = GmailConnection & {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailSearchOptions = {
  maxResults?: number;
  pageToken?: string;
};

export const GMAIL_SEARCH_PAGE_SIZE = 25;

export type GmailMessageResult = GmailConnection & {
  gmailMessage?: GmailFullMessage;
};

export type GmailApiMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPayload;
};

type GmailApiPayload = {
  mimeType?: string;
  filename?: string;
  headers?: GmailApiHeader[];
  body?: GmailApiBody;
  parts?: GmailApiPayload[];
};

type GmailApiHeader = {
  name?: string;
  value?: string;
};

type GmailApiBody = {
  data?: string;
  size?: number;
};

type GmailMessagesListResponse = {
  messages?: Array<{
    id?: string;
    threadId?: string;
  }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
  error?: {
    message?: string;
  };
};

export function hasGmailReadonlyScope(scope?: string | null) {
  return hasGoogleScope(scope, GOOGLE_GMAIL_READONLY_SCOPE);
}

export async function getGmailConnectionStatus(userId: string): Promise<GmailConnection> {
  const account = await getGoogleAccount(userId);

  if (!account) {
    return {
      status: "not_connected",
      message: "Googleアカウントが連携されていません"
    };
  }

  if (!hasGmailReadonlyScope(account.scope)) {
    return {
      status: "missing_scope",
      scope: account.scope,
      message: "Gmail readonly権限が許可されていません"
    };
  }

  if (!account.access_token && !account.refresh_token) {
    return {
      status: "missing_token",
      scope: account.scope,
      message: "Gmailを取得するためのトークンがありません"
    };
  }

  if (isGoogleAccessTokenExpired(account) && !account.refresh_token) {
    return {
      status: "missing_token",
      scope: account.scope,
      message: "Gmailの再認証が必要です"
    };
  }

  return {
    status: "connected",
    scope: account.scope
  };
}

export async function searchGmailMessages(
  userId: string,
  query: string,
  options: GmailSearchOptions = {}
): Promise<GmailMessagesResult> {
  const access = await getGmailAccess(userId);

  if (!access.ok) {
    return {
      ...access.connection,
      messages: []
    };
  }

  try {
    const listResponse = await fetchGmailMessageList(
      access.accessToken,
      query,
      options
    );

    if (!listResponse.ok) {
      return {
        status: "error",
        scope: access.scope,
        messages: [],
        message: "Gmail検索に失敗しました"
      };
    }

    const data = (await listResponse.json()) as GmailMessagesListResponse;
    const messageIds = (data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    const messages = await Promise.all(
      messageIds.map(async (id) => {
        const response = await fetchGmailMessage(access.accessToken, id, "metadata");

        if (!response.ok) {
          return null;
        }

        const message = (await response.json()) as GmailApiMessage;
        return mapGmailMessageSummary(message);
      })
    );

    return {
      status: "connected",
      scope: access.scope,
      messages: messages.filter((message): message is GmailMessageSummary => Boolean(message)),
      nextPageToken: data.nextPageToken,
      resultSizeEstimate: data.resultSizeEstimate
    };
  } catch {
    return {
      status: "error",
      scope: access.scope,
      messages: [],
      message: "Gmail検索に失敗しました"
    };
  }
}

export async function getGmailMessage(
  userId: string,
  gmailMessageId: string
): Promise<GmailMessageResult> {
  const access = await getGmailAccess(userId);

  if (!access.ok) {
    return access.connection;
  }

  try {
    const response = await fetchGmailMessage(access.accessToken, gmailMessageId, "full");

    if (!response.ok) {
      return {
        status: "error",
        scope: access.scope,
        message: "Gmail本文を取得できませんでした"
      };
    }

    const message = (await response.json()) as GmailApiMessage;
    const summary = mapGmailMessageSummary(message);

    if (!summary) {
      return {
        status: "error",
        scope: access.scope,
        message: "Gmail本文を取得できませんでした"
      };
    }

    return {
      status: "connected",
      scope: access.scope,
      gmailMessage: {
        ...summary,
        bodyText: getGmailMessageBodyText(message)
      }
    };
  } catch {
    return {
      status: "error",
      scope: access.scope,
      message: "Gmail本文を取得できませんでした"
    };
  }
}

export function mapGmailMessageSummary(message: GmailApiMessage): GmailMessageSummary | null {
  if (!message.id) {
    return null;
  }

  const subject = getGmailHeader(message.payload, "Subject");
  const fromAddress = getGmailHeader(message.payload, "From");
  const dateHeader = getGmailHeader(message.payload, "Date");

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    fromAddress,
    snippet: message.snippet,
    sentAt: parseGmailDate(message.internalDate, dateHeader)
  };
}

export function getGmailMessageBodyText(message: GmailApiMessage) {
  const plainText = findPayloadText(message.payload, "text/plain");

  if (plainText) {
    return plainText;
  }

  const htmlText = findPayloadText(message.payload, "text/html");
  return htmlText ? stripHtml(htmlText) : "";
}

export function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getGmailHeader(payload: GmailApiPayload | undefined, name: string) {
  const header = payload?.headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value?.trim() || undefined;
}

function parseGmailDate(internalDate?: string, dateHeader?: string) {
  if (internalDate) {
    const fromInternalDate = new Date(Number(internalDate));

    if (!Number.isNaN(fromInternalDate.getTime())) {
      return fromInternalDate;
    }
  }

  if (!dateHeader) {
    return undefined;
  }

  const fromHeader = new Date(dateHeader);
  return Number.isNaN(fromHeader.getTime()) ? undefined : fromHeader;
}

function findPayloadText(payload: GmailApiPayload | undefined, mimeType: string): string | null {
  if (!payload) {
    return null;
  }

  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const found = findPayloadText(part, mimeType);

    if (found) {
      return found;
    }
  }

  return null;
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function getGmailAccess(userId: string) {
  const account = await getGoogleAccount(userId);

  if (!account) {
    return {
      ok: false as const,
      connection: {
        status: "not_connected" as const,
        message: "Googleアカウントが連携されていません"
      }
    };
  }

  if (!hasGmailReadonlyScope(account.scope)) {
    return {
      ok: false as const,
      connection: {
        status: "missing_scope" as const,
        scope: account.scope,
        message: "Gmail readonly権限が許可されていません"
      }
    };
  }

  const accessToken = await getValidGoogleAccessToken(account);

  if (!accessToken) {
    return {
      ok: false as const,
      connection: {
        status: "missing_token" as const,
        scope: account.scope,
        message: "Gmailの再認証が必要です"
      }
    };
  }

  return {
    ok: true as const,
    accessToken,
    scope: account.scope
  };
}

export function buildGmailMessageListUrl(
  query: string,
  options: GmailSearchOptions = {}
) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  const maxResults = Math.min(Math.max(options.maxResults ?? GMAIL_SEARCH_PAGE_SIZE, 1), 500);

  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("includeSpamTrash", "false");

  if (options.pageToken) {
    url.searchParams.set("pageToken", options.pageToken);
  }

  return url;
}

function fetchGmailMessageList(
  accessToken: string,
  query: string,
  options: GmailSearchOptions
) {
  const url = buildGmailMessageListUrl(query, options);

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

function fetchGmailMessage(
  accessToken: string,
  gmailMessageId: string,
  format: "metadata" | "full"
) {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMessageId}`
  );
  url.searchParams.set("format", format);

  if (format === "metadata") {
    for (const header of ["Subject", "From", "Date"]) {
      url.searchParams.append("metadataHeaders", header);
    }
  }

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}
