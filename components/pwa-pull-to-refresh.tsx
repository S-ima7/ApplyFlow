"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { calculatePull, PULL_TO_REFRESH_THRESHOLD } from "@/lib/pull-to-refresh";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function PwaPullToRefresh({ onRefresh }: { onRefresh?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [indicatorOffset, setIndicatorOffset] = useState(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!(navigator as NavigatorWithStandalone).standalone) {
      return;
    }

    setEnabled(true);

    let start: { x: number; y: number } | null = null;
    let pullDistance = 0;

    const reset = () => {
      start = null;
      pullDistance = 0;
      setDragging(false);
      setArmed(false);
      setIndicatorOffset(0);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        reset();
        return;
      }

      if (
        refreshingRef.current ||
        window.scrollY > 0 ||
        isRefreshBlocked(event.target)
      ) {
        return;
      }

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY };
      pullDistance = 0;
      setDragging(true);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1 || window.scrollY > 0) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const pull = calculatePull(start, { x: touch.clientX, y: touch.clientY });

      if (!pull) {
        reset();
        return;
      }

      pullDistance = pull.distance;
      setArmed(pull.armed);
      setIndicatorOffset(pull.indicatorOffset);
    };

    const handleTouchEnd = () => {
      if (!start) {
        return;
      }

      const shouldRefresh = pullDistance >= PULL_TO_REFRESH_THRESHOLD;
      start = null;
      pullDistance = 0;
      setDragging(false);
      setArmed(false);

      if (!shouldRefresh) {
        setIndicatorOffset(0);
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      setIndicatorOffset(56);
      (onRefresh ?? (() => window.location.reload()))();
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [onRefresh]);

  if (!enabled) {
    return null;
  }

  const label = refreshing ? "更新しています" : armed ? "指を離して更新" : "引いて更新";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={indicatorOffset === 0}
      className="pointer-events-none fixed inset-x-0 z-[60] h-20 overflow-hidden"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <div
        className={`flex justify-center will-change-transform ${
          dragging
            ? ""
            : "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
        }`}
        style={{
          opacity: indicatorOffset > 0 ? 1 : 0,
          transform: `translate3d(0, ${indicatorOffset - 44}px, 0)`
        }}
      >
        <div className="flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 text-sm font-semibold text-slate-700 shadow-lg backdrop-blur">
          <RefreshCw
            className={`h-4 w-4 text-blue-600 ${
              refreshing ? "animate-spin motion-reduce:animate-none" : ""
            }`}
            style={
              refreshing
                ? undefined
                : { transform: `rotate(${Math.min(180, indicatorOffset * 3)}deg)` }
            }
            aria-hidden="true"
          />
          {label}
        </div>
      </div>
    </div>
  );
}

function isRefreshBlocked(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-pull-to-refresh-ignore]"));
}
