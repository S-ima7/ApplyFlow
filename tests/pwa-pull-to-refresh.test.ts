import { describe, expect, it } from "vitest";
import { calculatePull } from "@/lib/pull-to-refresh";

describe("PWA pull to refresh", () => {
  it("arms only after a downward pull past the threshold", () => {
    expect(calculatePull({ x: 20, y: 10 }, { x: 20, y: 60 })).toMatchObject({
      distance: 50,
      armed: false
    });
    expect(calculatePull({ x: 20, y: 10 }, { x: 20, y: 90 })).toMatchObject({
      distance: 80,
      armed: true
    });
  });

  it("rejects upward and horizontal gestures", () => {
    expect(calculatePull({ x: 20, y: 20 }, { x: 25, y: 18 })).toMatchObject({
      distance: 0,
      armed: false
    });
    expect(calculatePull({ x: 20, y: 90 }, { x: 20, y: 10 })).toBeNull();
    expect(calculatePull({ x: 20, y: 10 }, { x: 100, y: 40 })).toBeNull();
  });
});
