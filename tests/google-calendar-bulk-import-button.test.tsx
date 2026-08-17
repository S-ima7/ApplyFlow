/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importAll: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/features/calendar/actions", () => ({
  importAllGoogleCalendarEvents: mocks.importAll
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}));

import { GoogleCalendarBulkImportButton } from "@/features/calendar/components/google-calendar-bulk-import-button";

describe("GoogleCalendarBulkImportButton", () => {
  beforeEach(() => {
    mocks.importAll.mockReset();
    mocks.refresh.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks for confirmation before importing", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GoogleCalendarBulkImportButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Google予定を一括取り込み" })
    );

    expect(mocks.importAll).not.toHaveBeenCalled();
  });

  it("shows the imported and updated counts and refreshes the calendar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.importAll.mockResolvedValue({
      ok: true,
      importedCount: 3,
      updatedCount: 2,
      message: "Google Calendar予定を3件取り込み、2件更新しました"
    });
    render(<GoogleCalendarBulkImportButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Google予定を一括取り込み" })
    );

    expect(
      await screen.findByText(
        "Google Calendar予定を3件取り込み、2件更新しました"
      )
    ).toBeTruthy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("shows a fallback error when the server action rejects", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.importAll.mockRejectedValue(new Error("network unavailable"));
    render(<GoogleCalendarBulkImportButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Google予定を一括取り込み" })
    );

    expect(
      await screen.findByText("Google Calendar予定の一括取り込みに失敗しました")
    ).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows a returned failure without refreshing the calendar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.importAll.mockResolvedValue({
      ok: false,
      message: "Google Calendar予定を取得できませんでした"
    });
    render(<GoogleCalendarBulkImportButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Google予定を一括取り込み" })
    );

    expect(
      await screen.findByText("Google Calendar予定を取得できませんでした")
    ).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
