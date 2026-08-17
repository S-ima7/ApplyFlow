export const PULL_TO_REFRESH_THRESHOLD = 72;

const GESTURE_SLOP = 10;
const MAX_INDICATOR_OFFSET = 64;

export function calculatePull(
  start: { x: number; y: number },
  current: { x: number; y: number }
) {
  const deltaX = Math.abs(current.x - start.x);
  const distance = current.y - start.y;

  if (Math.max(deltaX, Math.abs(distance)) < GESTURE_SLOP) {
    return { distance: 0, armed: false, indicatorOffset: 0 };
  }

  if (distance <= 0 || deltaX > distance) {
    return null;
  }

  return {
    distance,
    armed: distance >= PULL_TO_REFRESH_THRESHOLD,
    indicatorOffset: Math.min(MAX_INDICATOR_OFFSET, distance * 0.75)
  };
}
