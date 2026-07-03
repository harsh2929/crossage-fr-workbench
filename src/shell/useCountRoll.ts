// React hook for the count-roll bump (Wave P0). Pass a changing count; it
// returns a bumpKey that increments on each real change (use as the element
// `key` to replay the CSS bump) and the change direction. Skips the initial
// mount and no-op changes, so the count only bumps when it actually moves.
import { useEffect, useState } from "react";
import { countChangeDirection, shouldAnimateCount, type CountDirection } from "../lib/countRoll";

export function useCountRoll(value: number): { bumpKey: number; direction: CountDirection } {
  const [state, setState] = useState<{ bumpKey: number; direction: CountDirection; prev: number | undefined }>({
    bumpKey: 0,
    direction: "none",
    prev: undefined,
  });

  useEffect(() => {
    setState((s) => {
      if (!shouldAnimateCount(s.prev, value)) {
        return s.prev === value ? s : { ...s, prev: value };
      }
      return { bumpKey: s.bumpKey + 1, direction: countChangeDirection(s.prev, value), prev: value };
    });
  }, [value]);

  return { bumpKey: state.bumpKey, direction: state.direction };
}
