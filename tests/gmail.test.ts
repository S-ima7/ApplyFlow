import { describe, expect, it } from "vitest";
import {
  GMAIL_SEARCH_PAGE_SIZE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  buildGmailMessageListUrl,
  decodeBase64Url,
  getGmailMessageBodyText,
  hasGmailReadonlyScope,
  mapGmailMessageSummary,
  type GmailApiMessage
} from "@/lib/gmail";
import {
  buildEmailImportSearchHref,
  decodeGmailPageTokens,
  encodeGmailPageTokens
} from "@/features/email-import/pagination";

describe("hasGmailReadonlyScope", () => {
  it("detects the readonly Gmail scope", () => {
    expect(hasGmailReadonlyScope(`openid email ${GOOGLE_GMAIL_READONLY_SCOPE}`)).toBe(
      true
    );
  });

  it("returns false when the Gmail scope is missing", () => {
    expect(hasGmailReadonlyScope("openid email profile")).toBe(false);
  });
});

describe("Gmail search pagination", () => {
  it("forwards the Gmail page token and uses the configured page size", () => {
    const url = buildGmailMessageListUrl("面接", {
      maxResults: GMAIL_SEARCH_PAGE_SIZE,
      pageToken: "next-token"
    });

    expect(url.searchParams.get("q")).toBe("面接");
    expect(url.searchParams.get("maxResults")).toBe("25");
    expect(url.searchParams.get("pageToken")).toBe("next-token");
  });

  it("round-trips the page-token history used by previous navigation", () => {
    const encoded = encodeGmailPageTokens(["page-2", "page-3"]);

    expect(decodeGmailPageTokens(encoded)).toEqual(["page-2", "page-3"]);
    expect(buildEmailImportSearchHref("from:recruit", ["page-2"])).toContain(
      "cursor="
    );
  });

  it("ignores an invalid cursor", () => {
    expect(decodeGmailPageTokens("not-json")).toEqual([]);
  });
});

describe("decodeBase64Url", () => {
  it("decodes base64url text", () => {
    const encoded = Buffer.from("Hello from Gmail").toString("base64url");
    expect(decodeBase64Url(encoded)).toBe("Hello from Gmail");
  });
});

describe("mapGmailMessageSummary", () => {
  it("maps metadata headers and internal date", () => {
    const sentAt = new Date("2026-07-12T19:00:00.000Z");
    const summary = mapGmailMessageSummary({
      id: "msg-1",
      threadId: "thread-1",
      snippet: "interview schedule",
      internalDate: String(sentAt.getTime()),
      payload: {
        headers: [
          { name: "Subject", value: "Interview" },
          { name: "From", value: "recruiter@example.com" }
        ]
      }
    });

    expect(summary).toMatchObject({
      id: "msg-1",
      threadId: "thread-1",
      subject: "Interview",
      fromAddress: "recruiter@example.com",
      snippet: "interview schedule"
    });
    expect(summary?.internalDate?.toISOString()).toBe(sentAt.toISOString());
    expect(summary?.sentAt?.toISOString()).toBe(sentAt.toISOString());
  });
});

describe("getGmailMessageBodyText", () => {
  it("prefers nested text/plain body", () => {
    const message: GmailApiMessage = {
      id: "msg-1",
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<p>HTML</p>").toString("base64url")
            }
          },
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from("Plain text").toString("base64url")
            }
          }
        ]
      }
    };

    expect(getGmailMessageBodyText(message)).toBe("Plain text");
  });

  it("joins multiple plain-text body parts and ignores text attachments", () => {
    const message: GmailApiMessage = {
      id: "msg-1",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Latest message").toString("base64url") }
          },
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Quoted context").toString("base64url") }
          },
          {
            mimeType: "text/plain",
            filename: "notes.txt",
            body: { data: Buffer.from("Attachment text").toString("base64url") }
          }
        ]
      }
    };

    expect(getGmailMessageBodyText(message)).toBe(
      "Latest message\n\nQuoted context"
    );
  });

  it("falls back to stripped HTML body", () => {
    const message: GmailApiMessage = {
      id: "msg-1",
      payload: {
        mimeType: "text/html",
        body: {
          data: Buffer.from("<p>Hello&nbsp;ApplyFlow</p>").toString("base64url")
        }
      }
    };

    expect(getGmailMessageBodyText(message)).toBe("Hello ApplyFlow");
  });
});
