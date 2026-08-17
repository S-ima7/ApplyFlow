/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ register: vi.fn() }));

vi.mock("@/features/calendar/actions", () => ({
  registerConfirmedInterviewInGoogleCalendar: mocks.register
}));

import { GoogleCalendarRegisterButton } from "@/features/interviews/components/google-calendar-register-button";

describe("GoogleCalendarRegisterButton", () => {
  beforeEach(() => mocks.register.mockReset());
  afterEach(cleanup);

  it("guides an existing user with missing scope to reauthentication", async () => {
    mocks.register.mockResolvedValue({
      ok: false,
      status: "missing_scope",
      message: "Google Calendarへの予定登録権限がありません"
    });
    render(<GoogleCalendarRegisterButton interviewId="interview-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Google Calendarに登録" }));

    expect(
      await screen.findByText("Google Calendarへの予定登録権限がありません")
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "設定で再ログイン" }).getAttribute("href")
    ).toBe("/settings");
  });

  it("shows already-registered success and the Google event link", async () => {
    mocks.register.mockResolvedValue({
      ok: true,
      status: "already_exists",
      message: "Google Calendarに登録済みです",
      eventUrl: "https://calendar.google.com/existing"
    });
    render(<GoogleCalendarRegisterButton interviewId="interview-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Google Calendarに登録" }));

    expect(await screen.findByText("Google Calendarに登録済みです")).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Google Calendar登録済み"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "Googleで開く" }).getAttribute("href")
    ).toBe("https://calendar.google.com/existing");
  });
});
