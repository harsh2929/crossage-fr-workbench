// React hook for the save-settle gesture (Wave 0). Call settle(key) when an
// optimistic write resolves OK; the key is "settling" for SAVE_SETTLE_MS, during
// which the consumer applies the `save-settle` class to flash the success tint +
// pop a checkmark. Keyed so many rows can settle concurrently.
import { useCallback, useEffect, useRef, useState } from "react";
import { beginSettle, SAVE_SETTLE_MS, type SettleState } from "../lib/saveSettle";

export function useSaveSettle(duration = SAVE_SETTLE_MS) {
  const [state, setState] = useState<SettleState>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const settle = useCallback(
    (key: string) => {
      setState((prev) => beginSettle(prev, key, Date.now()));
      const existing = timersRef.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timersRef.current.delete(key);
        setState((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, duration);
      timersRef.current.set(key, timer);
    },
    [duration]
  );

  // The timer maintains the invariant "key present ⇔ within window", so
  // membership is the settle signal — no per-render clock read needed.
  const settling = useCallback((key: string) => key in state, [state]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { settle, settling };
}
