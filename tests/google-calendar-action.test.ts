import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  interviewFindFirst: vi.fn(),
  createGoogleCalendarInterviewEvent: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    interview: { findFirst: mocks.interviewFindFirst }
  }
}));
vi.mock("@/lib/google-calendar", () => ({
  createGoogleCalendarInterviewEvent: mocks.createGoogleCalendarInterviewEvent,
  getGoogleCalendarEventById: vi.fn()
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { registerConfirmedInterviewInGoogleCalendar } from "@/features/calendar/actions";

describe("registerConfirmedInterviewInGoogleCalendar", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireUser.mockResolvedValue({ id: "user-1", timezone: "Asia/Tokyo" });
  });

  it("queries by the signed-in owner and never exports another user's interview", async () => {
    mocks.interviewFindFirst.mockResolvedValue(null);

    const result = await registerConfirmedInterviewInGoogleCalendar("interview-2");

    expect(result).toMatchObject({ ok: false, status: "not_eligible" });
    expect(mocks.interviewFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "interview-2",
          userId: "user-1",
          deletedAt: null
        })
      })
    );
    expect(mocks.createGoogleCalendarInterviewEvent).not.toHaveBeenCalled();
  });

  it("rejects an interview without a valid confirmed time range", async () => {
    mocks.interviewFindFirst.mockResolvedValue({
      id: "interview-1",
      status: "CONFIRMED",
      confirmedStartAt: new Date("2026-08-20T02:00:00.000Z"),
      confirmedEndAt: new Date("2026-08-20T01:00:00.000Z"),
      selectionStage: {
        application: { id: "application-1", company: { name: "Example株式会社" } }
      }
    });

    const result = await registerConfirmedInterviewInGoogleCalendar("interview-1");

    expect(result).toMatchObject({ ok: false, status: "not_eligible" });
    expect(mocks.createGoogleCalendarInterviewEvent).not.toHaveBeenCalled();
  });

  it("uses only the DB record and reports an existing Google event as success", async () => {
    mocks.interviewFindFirst.mockResolvedValue({
      id: "interview-1",
      status: "CONFIRMED",
      title: "最終面接",
      location: "東京本社",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      note: "採用責任者との面談",
      confirmedStartAt: new Date("2026-08-20T01:00:00.000Z"),
      confirmedEndAt: new Date("2026-08-20T02:00:00.000Z"),
      selectionStage: {
        name: "最終選考",
        application: {
          id: "application-1",
          position: "Frontend Engineer",
          company: { name: "Example株式会社" }
        }
      }
    });
    mocks.createGoogleCalendarInterviewEvent.mockResolvedValue({
      status: "already_exists",
      eventUrl: "https://calendar.google.com/existing",
      message: "Google Calendarに登録済みです"
    });

    const result = await registerConfirmedInterviewInGoogleCalendar("interview-1");

    expect(mocks.createGoogleCalendarInterviewEvent).toHaveBeenCalledWith(
      "user-1",
      {
        interviewId: "interview-1",
        companyName: "Example株式会社",
        position: "Frontend Engineer",
        title: "最終面接",
        location: "東京本社",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        note: "採用責任者との面談",
        startAt: new Date("2026-08-20T01:00:00.000Z"),
        endAt: new Date("2026-08-20T02:00:00.000Z")
      }
    );
    expect(result).toMatchObject({ ok: true, status: "already_exists" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/applications/application-1"
    );
  });
});
