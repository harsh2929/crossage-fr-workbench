// React hook for the count-roll bump (Wave P0). Pass a changing count; it
// returns a bumpKey that increments on each real change (use as the element
// `key` to replay the CSS bump) and the change direction. Skips the initial
// mount and no-op changes, so the count only bumps when it actually moves.
import { useEffect, useRef, useState } from "react";
import { nextCountRollState, shouldThrottledBump, type CountDirection, type CountRollState } from "../lib/countRoll";

export function useCountRoll(value: number): { bumpKey: number; direction: CountDirection } {
  const stateRef = useRef<CountRollState>({
    bumpKey: 0,
    direction: "none",
    prev: undefined,
  });
  stateRef.current = nextCountRollState(stateRef.current, value);

  return { bumpKey: stateRef.current.bumpKey, direction: stateRef.current.direction };
}

/**
 * Bump variant for a rapidly-updating counter (e.g. a live scan counter): the
 * value still renders every frame (smooth), but the returned bumpKey — used as
 * the count span's `key` to replay the pop — increments at most once per
 * intervalMs, so the capsule bumps at a readable cadence instead of every frame.
 */
export function useThrottledCountRoll(value: number, intervalMs = 300): { bumpKey: number } {
  const [bumpKey, setBumpKey] = useState(0);
  const lastBumpRef = useRef(0);
  const prevRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const now = Date.now();
    if (shouldThrottledBump(prevRef.current, value, lastBumpRef.current, now, intervalMs)) {
      lastBumpRef.current = now;
      setBumpKey((k) => k + 1);
    }
    prevRef.current = value;
  }, [value, intervalMs]);

  return { bumpKey };
}
