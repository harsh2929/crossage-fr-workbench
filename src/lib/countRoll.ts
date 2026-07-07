// count-roll logic (Wave P0 primitive). When a badge/count value changes, the
// capsule bumps (and can slide directionally). This decides *whether* to animate
// (skip the initial mount and no-op changes, including 0→0) and the direction.
// Pure/testable; useCountRoll wraps it, the CSS renders the bump.

/** Animate only on a real change after the first render (prev !== undefined). */
export function shouldAnimateCount(prev: number | undefined, next: number): boolean {
  return prev !== undefined && prev !== next;
}

export type CountDirection = "up" | "down" | "none";

export interface CountRollState {
  bumpKey: number;
  direction: CountDirection;
  prev: number | undefined;
}

/** Direction of the change (for directional digit slide); "none" on init/no-change. */
export function countChangeDirection(prev: number | undefined, next: number): CountDirection {
  if (prev === undefined || prev === next) return "none";
  return next > prev ? "up" : "down";
}

export function nextCountRollState(state: CountRollState, next: number): CountRollState {
  if (!shouldAnimateCount(state.prev, next)) {
    return state.prev === next ? state : { ...state, prev: next };
  }
  return {
    bumpKey: state.bumpKey + 1,
    direction: countChangeDirection(state.prev, next),
    prev: next,
  };
}

/**
 * Bump decision for a rapidly-updating counter (e.g. a live scan counter that
 * changes every animation frame): animate only on a real change AND once at
 * most per intervalMs, so the value can stream smoothly while the capsule pops
 * at a readable cadence instead of on every frame.
 */
export function shouldThrottledBump(
  prev: number | undefined,
  next: number,
  lastBumpMs: number,
  nowMs: number,
  intervalMs: number
): boolean {
  return shouldAnimateCount(prev, next) && nowMs - lastBumpMs >= intervalMs;
}
