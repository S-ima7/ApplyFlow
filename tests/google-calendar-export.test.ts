import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGoogleAccount: vi.fn(),
  getValidGoogleAccessToken: vi.fn()
}));

vi.mock("@/lib/google-auth", () => ({
  GOOGLE_BASE_AUTH_SCOPES: ["openid", "email", "profile"],
  GOOGLE_GMAIL_READONLY_SCOPE:
    "https://www.googleapis.com/auth/gmail.readonly",
  getGoogleAccount: mocks.getGoogleAccount,
  getValidGoogleAccessToken: mocks.getValidGoogleAccessToken,
  hasGoogleScope: (scope: string | null | undefined, requiredScope: string) =>
    (scope ?? "").split(/\s+/).includes(requiredScope),
  isGoogleAccessTokenExpired: vi.fn(() => false)
}));

import {
  GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE,
  createGoogleCalendarInterviewEvent,
  getGoogleCalendarInterviewEventId
} from "@/lib/google-calendar";

const input = {
  interviewId: "interview-1",
  companyName: "Example株式会社",
  position: "Frontend Engineer",
  title: "一次面接",
  location: "オンライン",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  note: "技術面接",
  startAt: new Date("2026-08-20T01:00:00.000Z"),
  endAt: new Date("2026-08-20T02:00:00.000Z")
};

describe("createGoogleCalendarInterviewEvent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getGoogleAccount.mockReset();
    mocks.getValidGoogleAccessToken.mockReset();
  });

  it("requires the owned-events scope before calling Google", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: "https://www.googleapis.com/auth/calendar.readonly"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result.status).toBe("missing_scope");
    expect(mocks.getValidGoogleAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inserts into Primary Calendar without notifications", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: getGoogleCalendarInterviewEventId("user-1", input.interviewId),
          htmlLink: "https://calendar.google.com/event"
        }),
        { status: 200 }
      )
    );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result).toMatchObject({
      status: "created",
      eventUrl: "https://calendar.google.com/event"
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/calendars/primary/events?sendUpdates=none");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json"
    });
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      summary: "Example株式会社｜一次面接",
      start: { dateTime: "2026-08-20T01:00:00.000Z" },
      end: { dateTime: "2026-08-20T02:00:00.000Z" }
    });
  });

  it("treats a verified 409 duplicate as already registered", async () => {
    const eventId = getGoogleCalendarInterviewEventId("user-1", input.interviewId);
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "duplicate" } }), {
          status: 409
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: eventId,
            htmlLink: "https://calendar.google.com/existing",
            extendedProperties: {
              private: { applyFlowInterviewKey: eventId }
            }
          }),
          { status: 200 }
        )
      );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result).toMatchObject({
      status: "already_exists",
      eventUrl: "https://calendar.google.com/existing"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `/calendars/primary/events/${eventId}`
    );
  });

  it("does not accept an unrelated event after a 409 collision", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: getGoogleCalendarInterviewEventId("user-1", input.interviewId),
            extendedProperties: {
              private: { applyFlowInterviewKey: "different-event" }
            }
          }),
          { status: 200 }
        )
      );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result.status).toBe("error");
    expect(result.message).toContain("競合");
  });

  it("reports a 403 quota response as an API failure instead of missing scope", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "User Rate Limit Exceeded",
            errors: [{ reason: "userRateLimitExceeded" }]
          }
        }),
        { status: 403 }
      )
    );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result.status).toBe("error");
    expect(result.message).toContain("利用上限");
  });

  it("requests reauthentication when the duplicate verification token is invalid", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
          status: 401
        })
      );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result.status).toBe("reauth_required");
  });

  it("reports missing scope while verifying a duplicate", async () => {
    mocks.getGoogleAccount.mockResolvedValue({
      scope: GOOGLE_CALENDAR_EVENTS_OWNED_SCOPE
    });
    mocks.getValidGoogleAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Request had insufficient authentication scopes.",
              errors: [{ reason: "insufficientPermissions" }]
            }
          }),
          { status: 403 }
        )
      );

    const result = await createGoogleCalendarInterviewEvent("user-1", input);

    expect(result.status).toBe("missing_scope");
  });
});
