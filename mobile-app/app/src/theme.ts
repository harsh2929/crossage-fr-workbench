/**
 * Design tokens. The app leans bold + vivid + alive (the owner's standing preference — not calm
 * minimalism) while keeping photos on a neutral backdrop so they pop: the living colour lives in the
 * CHROME (headers, hero, tab bar, loaders, empty states), never behind a photo grid or the viewer.
 */

export const palette = {
  // Neutral substrate — photos sit on these so they read cleanly.
  bg: '#0b0b12',
  surface: '#14141d', // cards / rows
  surfaceHi: '#1b1b27', // inputs / raised
  cell: '#1a1a24',

  // Accent ramp — a vivid multi-stop system, applied with intent per surface.
  accent: '#8b5cf6', // violet — primary
  accentSoft: '#c4b5fd',
  magenta: '#d946ef', // AI / search energy
  pink: '#f472b6', // favorites
  cyan: '#22d3ee', // semantic / desktop uplink

  text: '#ffffff',
  sub: '#c7c7d1',
  muted: '#6b7280',
  danger: '#f87171',
  success: '#34d399',
} as const;

/** Gradient stop pairs for the living washes (faked with stacked translucent Views — no native dep). */
export const grad = {
  brand: ['#8b5cf6', '#d946ef'] as const, // violet → magenta
  search: ['#22d3ee', '#8b5cf6'] as const, // cyan → violet
  favorite: ['#f472b6', '#d946ef'] as const, // pink → magenta
  desktop: ['#22d3ee', '#6366f1'] as const, // cyan → indigo
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const typography = {
  largeTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  meta: { fontSize: 13, fontWeight: '600' },
} as const;

/** A translucent tint of an accent, e.g. `tint(palette.accent, 0.15)`. Hex in → rgba out. */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
