import { describe, expect, it, vi } from "vitest";
import { watchResponsiveCalendarView } from "@/features/calendar/responsive-view";

describe("responsive calendar view", () => {
  it("uses day view on narrow screens and follows orientation changes", () => {
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const viewport = {
      matches: true,
      addEventListener: vi.fn(
        (_type: "change", listener: (event: MediaQueryListEvent) => void) => {
          changeListener = listener;
        }
      ),
      removeEventListener: vi.fn()
    };
    const changeView = vi.fn();

    const stopWatching = watchResponsiveCalendarView(viewport, changeView);
    expect(changeView).toHaveBeenLastCalledWith("timeGridDay");

    changeListener?.({ matches: false } as MediaQueryListEvent);
    expect(changeView).toHaveBeenLastCalledWith("timeGridWeek");

    stopWatching();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("change", changeListener);
  });
});
