const MAX_GMAIL_PAGE_DEPTH = 50;

export function encodeGmailPageTokens(tokens: string[]) {
  if (tokens.length === 0) {
    return undefined;
  }

  return Buffer.from(JSON.stringify(tokens.slice(0, MAX_GMAIL_PAGE_DEPTH))).toString(
    "base64url"
  );
}

export function decodeGmailPageTokens(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((token): token is string => typeof token === "string" && token.length > 0)
      .slice(0, MAX_GMAIL_PAGE_DEPTH);
  } catch {
    return [];
  }
}

export function buildEmailImportSearchHref(query: string, pageTokens: string[]) {
  const params = new URLSearchParams({ q: query });
  const cursor = encodeGmailPageTokens(pageTokens);

  if (cursor) {
    params.set("cursor", cursor);
  }

  return `/email-import?${params.toString()}`;
}
