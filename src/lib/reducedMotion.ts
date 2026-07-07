// Animation-settings source (Wave 0 substrate). CSS honours reduced-motion for
// free via the master @media block; this module gives JS-driven motion (rAF
// count-ups, FLIP/shared-element zoom) the same awareness. Renderer-native:
// reads window.matchMedia, so no IPC round-trip. Pure/testable; the
// useReducedMotion hook wraps it and subscribes to changes.

export type AnimationSettings = {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  highContrast: boolean;
};

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  reducedMotion: false,
  reducedTransparency: false,
  highContrast: false,
};

// The media queries backing each accessibility preference.
export const MOTION_QUERIES = {
  reducedMotion: "(prefers-reduced-motion: reduce)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  highContrast: "(prefers-contrast: more)",
} as const;

function bool(value: unknown): boolean {
  return value === true;
}

/** Coerce an arbitrary payload (e.g. from IPC) into valid settings with defaults. */
export function normalizeAnimationSettings(raw: unknown): AnimationSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ANIMATION_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    reducedMotion: bool(r.reducedMotion),
    reducedTransparency: bool(r.reducedTransparency),
    highContrast: bool(r.highContrast),
  };
}

type MatchMediaLike = (query: string) => { matches: boolean };

/** Read current settings from a matchMedia function; tolerant of absence/throws. */
export function readAnimationSettings(matchMedia: MatchMediaLike | undefined): AnimationSettings {
  if (typeof matchMedia !== "function") return { ...DEFAULT_ANIMATION_SETTINGS };
  try {
    return {
      reducedMotion: matchMedia(MOTION_QUERIES.reducedMotion).matches,
      reducedTransparency: matchMedia(MOTION_QUERIES.reducedTransparency).matches,
      highContrast: matchMedia(MOTION_QUERIES.highContrast).matches,
    };
  } catch {
    return { ...DEFAULT_ANIMATION_SETTINGS };
  }
}

/** JS-driven motion should play only when the user hasn't asked to reduce it. */
export function shouldAnimate(settings: AnimationSettings): boolean {
  return !settings.reducedMotion;
}
