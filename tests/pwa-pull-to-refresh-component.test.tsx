/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaPullToRefresh } from "@/components/pwa-pull-to-refresh";

describe("PwaPullToRefresh", () => {
  beforeEach(() => {
    setStandalone(true);
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      writable: true,
      value: 0
    });
  });

  afterEach(() => {
    cleanup();
    setStandalone(undefined);
    vi.restoreAllMocks();
  });

  it("refreshes once after an armed pull ends", () => {
    const onRefresh = vi.fn();
    render(<PwaPullToRefresh onRefresh={onRefresh} />);

    pullFrom(10, 90);
    expect(screen.getByText("指を離して更新")).toBeTruthy();

    fireEvent.touchEnd(window);
    fireEvent.touchEnd(window);

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText("更新しています")).toBeTruthy();
  });

  it("does not refresh below the threshold or away from the page top", () => {
    const onRefresh = vi.fn();
    render(<PwaPullToRefresh onRefresh={onRefresh} />);

    pullFrom(10, 60);
    fireEvent.touchEnd(window);
    expect(onRefresh).not.toHaveBeenCalled();

    window.scrollY = 20;
    pullFrom(10, 100);
    fireEvent.touchEnd(window);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stays disabled outside an iOS standalone app", () => {
    setStandalone(false);
    const onRefresh = vi.fn();
    render(<PwaPullToRefresh onRefresh={onRefresh} />);

    pullFrom(10, 100);
    fireEvent.touchEnd(window);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("cancels multi-touch and touch-cancel gestures", () => {
    const onRefresh = vi.fn();
    render(<PwaPullToRefresh onRefresh={onRefresh} />);

    pullFrom(10, 100);
    fireEvent.touchStart(window, {
      touches: [touch(20, 100), touch(80, 100)]
    });
    fireEvent.touchEnd(window);

    pullFrom(10, 100);
    fireEvent.touchCancel(window);
    fireEvent.touchEnd(window);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores pulls that start inside a nested scroll area", () => {
    const onRefresh = vi.fn();
    render(
      <>
        <PwaPullToRefresh onRefresh={onRefresh} />
        <div data-testid="nested-scroll" data-pull-to-refresh-ignore />
      </>
    );

    fireEvent.touchStart(screen.getByTestId("nested-scroll"), {
      touches: [touch(20, 10)]
    });
    fireEvent.touchMove(window, { touches: [touch(20, 100)] });
    fireEvent.touchEnd(window);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

function setStandalone(value: boolean | undefined) {
  Object.defineProperty(navigator, "standalone", {
    configurable: true,
    value
  });
}

function pullFrom(startY: number, endY: number) {
  fireEvent.touchStart(window, { touches: [touch(20, startY)] });
  fireEvent.touchMove(window, { touches: [touch(20, endY)] });
}

function touch(clientX: number, clientY: number) {
  return { clientX, clientY };
}
