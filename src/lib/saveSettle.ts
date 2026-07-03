// save-settle timing logic (Wave 0 primitive). When an optimistic write resolves
// OK, the affected row/control flashes a success tint + a checkmark pops, then
// drains back to rest. Multiple items can settle at once, so state is a keyed map
// of start times. Pure/testable; useSaveSettle wraps it and the CSS renders the
// gesture (first consumer of the dormant --success-control-* tokens).

// Visible settle window in ms. Matches the CSS `saveSettle` animation
// (composed from --dur-slow); the class is applied for exactly this long.
export const SAVE_SETTLE_MS = 500;

export type SettleState = Record<string, number>;

/** Record (or refresh) a key's settle start time. Immutable. */
export function beginSettle(state: SettleState, key: string, now: number): SettleState {
  return { ...state, [key]: now };
}

/** Is this key currently within its settle window? */
export function isSettling(state: SettleState, key: string, now: number, duration = SAVE_SETTLE_MS): boolean {
  const startedAt = state[key];
  return startedAt !== undefined && now - startedAt < duration;
}

/** Drop keys whose settle window has elapsed. Immutable. */
export function pruneSettles(state: SettleState, now: number, duration = SAVE_SETTLE_MS): SettleState {
  const next: SettleState = {};
  for (const [key, startedAt] of Object.entries(state)) {
    if (now - startedAt < duration) next[key] = startedAt;
  }
  return next;
}

/** Keys still within their settle window. */
export function activeSettleKeys(state: SettleState, now: number, duration = SAVE_SETTLE_MS): string[] {
  return Object.keys(state).filter((key) => isSettling(state, key, now, duration));
}
