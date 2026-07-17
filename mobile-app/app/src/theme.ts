/**
 * Design tokens. The app leans bold + vivid + alive (the owner's standing preference — not calm
 * minimalism) while keeping photos on a neutral backdrop so they pop: the living colour lives in the
 * CHROME (headers, hero, tab bar, loaders, empty states), never behind a photo grid or the viewer.
 */

export const palette = {
  // Neutral substrate — photos sit on these so they read cleanly. An elevation ladder from bg up.
  bg: '#0b0b12',
  surface: '#14141d', // cards / rows
  surfaceHi: '#1b1b27', // inputs / raised
  popover: '#20202c', // menus / toasts / sheets — one step above surfaceHi
  barBase: '#0e0e17', // opaque fallback under the frosted tab bar
  cell: '#1a1a24',

  // Accent ramp — a vivid multi-stop system, applied with intent per surface. Each hue carries a
  // "soft" sibling for chrome text (kicker/meta) so a cyan/magenta header never renders soft-violet.
  accent: '#8b5cf6', // violet — primary
  accentSoft: '#c4b5fd',
  magenta: '#d946ef', // AI / search energy
  magentaSoft: '#eaa6f5',
  pink: '#f472b6', // favorites
  cyan: '#22d3ee', // semantic / desktop uplink
  cyanSoft: '#8fe8f6',
  indigo: '#6366f1', // desktop uplink gradient tail

  text: '#ffffff',
  sub: '#c7c7d1',
  muted: '#767c8a', // AA on bg (#6b7280 was 4.06:1 → #767c8a is 4.69:1; same cool tint, lifted)
  danger: '#f87171',
  success: '#34d399',
} as const;

/** Gradient stop pairs for the living washes (faked with stacked translucent Views — no native dep). */
export const grad = {
  brand: ['#8b5cf6', '#d946ef'] as const, // violet → magenta
  search: ['#22d3ee', '#8b5cf6'] as const, // cyan → violet
  favorite: ['#f472b6', '#d946ef'] as const, // pink → magenta
  desktop: [palette.cyan, palette.indigo] as const, // cyan → indigo (indigo now a first-class token)
};

/** Per-tab hue legend — the bottom bar and each tab's chrome share one identity colour. */
export const tabHue = {
  library: palette.accent,
  collections: palette.accent,
  search: palette.cyan,
  albums: palette.accent,
  desktop: palette.cyan,
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, input: 14, lg: 16, pill: 999 } as const;

// One harmonious type scale. Every rung pins lineHeight (RN otherwise invents per-site leading) and
// carries the negative tracking bold titles want / positive tracking small-caps want. The heading→
// caption rungs fill the old 34→22→(void)→13 gap that ~10 hand-typed sizes used to cover per-file.
export const typography = {
  largeTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6, lineHeight: 40 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, lineHeight: 27 },
  heading: { fontSize: 20, fontWeight: '800', letterSpacing: -0.35, lineHeight: 25 },
  sheetTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, lineHeight: 23 },
  cardTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, lineHeight: 21 },
  body: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1, lineHeight: 20 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', lineHeight: 14 },
  meta: { fontSize: 13, fontWeight: '600', lineHeight: 17 },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2, lineHeight: 14 },
} as const;

/**
 * Fallback safe-area insets. Prefer the responsive `useInsets()` hook (src/insets.ts); this const is
 * a static baseline for places that can't call a hook (StyleSheet defaults, module scope).
 */
export const inset = { top: 56, bottom: 28 } as const;

/** Hex → {r,g,b}. */
function rgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** A translucent tint of an accent, e.g. `tint(palette.accent, 0.15)`. Hex in → rgba out. */
export function tint(hex: string, alpha: number): string {
  const { r, g, b } = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A soft coloured shadow — the depth cue for glowing chrome (buttons, active tabs, cards). iOS-only
 * shadow props (no native dep); coloured shadows are supported. Spread into a style:
 * `style={[styles.btn, glow(palette.accent)]}`.
 */
export function glow(color: string, radius = 16, opacity = 0.35) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    // Offset scales with radius so a tight glow stays optically centred (not a hard drop-shadow) and a
    // wide one doesn't float as a detached halo: 12→4, 16→5, 22→7.
    shadowOffset: { width: 0, height: Math.round(radius / 3) },
  } as const;
}

/** Glow tiers by elevation — three named strengths instead of ad-hoc radii. Thin wrappers over glow(). */
export const glowSm = (color: string) => glow(color, 12, 0.4); // segments, tab glyphs
export const glowMd = (color: string) => glow(color, 16, 0.45); // buttons, pills, cards, bubbles
export const glowLg = (color: string) => glow(color, 22, 0.4); // toasts, hero CTAs

/**
 * Named spring physics — one motion vocabulary so the "alive" feel is deliberate, not 7 scattered
 * literals. Spread into an Animated.spring config: `Animated.spring(v, { toValue, useNativeDriver: true, ...spring.press })`.
 */
export const spring = {
  press: { speed: 40, bounciness: 9 }, // Springy scale-down on press
  slide: { speed: 20, bounciness: 10 }, // sliding pills (Segmented, TabBar) — one shared inertia
  enter: { speed: 16, bounciness: 8 }, // reveal / settle-in
  pop: { speed: 50, bounciness: 16 }, // punchy activation (HeartPop, tab-pop)
  settle: { speed: 20, bounciness: 8 }, // return-to-rest after a pop
} as const;

/** Named durations (ms) — one enter/fade ladder so timings don't drift 10ms apart per site. */
export const dur = { fast: 140, base: 180, slow: 260, xslow: 460 } as const;

/** Accent tint alphas by role, so every pill/chip/segment fills + outlines at one rest/active depth. */
export const tintFill = { rest: 0.14, active: 0.25 } as const;
export const tintBorder = { rest: 0.42, active: 0.6, faint: 0.3 } as const;

/** Faint neutral guides — one divider alpha + one disc-scrim, used across primitives. */
export const hairline = 'rgba(255, 255, 255, 0.08)';
export const discScrim = 'rgba(0, 0, 0, 0.28)';

/** Pick a legible text colour for a filled accent background (dark ink on bright cyan, white on violet). */
export function readableText(bgHex: string): string {
  const { r, g, b } = rgb(bgHex);
  // Perceived luminance (sRGB-ish). Bright fills (cyan/pink) read best with dark ink.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#08131a' : '#ffffff';
}
