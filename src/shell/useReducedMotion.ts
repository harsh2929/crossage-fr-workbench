// React hook over the reduced-motion source (Wave 0). JS-driven motion (rAF
// count-ups, FLIP/shared-element zoom) reads this so it degrades in lockstep
// with the CSS @media (prefers-reduced-motion) block. Subscribes to live OS
// changes, so toggling the setting mid-session takes effect without a reload.
import { useEffect, useState } from "react";
import {
  DEFAULT_ANIMATION_SETTINGS,
  MOTION_QUERIES,
  readAnimationSettings,
  shouldAnimate,
  type AnimationSettings,
} from "../lib/reducedMotion";

function currentMatchMedia(): ((query: string) => MediaQueryList) | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return (query: string) => window.matchMedia(query);
}

export function useAnimationSettings(): AnimationSettings {
  const [settings, setSettings] = useState<AnimationSettings>(() => {
    const mm = currentMatchMedia();
    return mm ? readAnimationSettings(mm) : DEFAULT_ANIMATION_SETTINGS;
  });

  useEffect(() => {
    const mm = currentMatchMedia();
    if (!mm) return;
    const lists = Object.values(MOTION_QUERIES).map((query) => mm(query));
    const update = () => setSettings(readAnimationSettings(mm));
    for (const list of lists) list.addEventListener("change", update);
    update(); // reconcile in case a pref changed before this effect ran
    return () => {
      for (const list of lists) list.removeEventListener("change", update);
    };
  }, []);

  return settings;
}

/** True when the user has asked to reduce motion (gate JS-driven animation on this). */
export function useReducedMotion(): boolean {
  return !shouldAnimate(useAnimationSettings());
}
