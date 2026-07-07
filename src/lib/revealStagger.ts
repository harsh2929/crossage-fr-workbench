// reveal-stagger delay logic (Wave P0 primitive). Items in a just-loaded
// list/grid fade + rise in sequence; the delay grows per item but caps so a
// long list settles quickly instead of cascading for seconds. Pure/testable;
// the CSS reads --reveal-delay and the consumer spreads revealDelayStyle(i).
import type { CSSProperties } from "react";

export const REVEAL_STEP_MS = 24;
export const REVEAL_CAP = 8;

/** Entrance delay for the item at `index` (clamped to [0, cap] * step). */
export function staggerDelayMs(index: number, step = REVEAL_STEP_MS, cap = REVEAL_CAP): number {
  const clamped = Math.max(0, Math.min(index, cap));
  return clamped * step;
}

/** Inline style carrying the per-item delay for the `.reveal-stagger` CSS. */
export function revealDelayStyle(index: number, step = REVEAL_STEP_MS, cap = REVEAL_CAP): CSSProperties {
  return { "--reveal-delay": `${staggerDelayMs(index, step, cap)}ms` } as CSSProperties;
}
