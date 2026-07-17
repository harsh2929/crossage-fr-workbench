/**
 * Colour-matrix maths for the tonal editor. Each matrix is a 4×5 row-major array of 20 numbers,
 * operating on RGBA in [0,1] — exactly the shape Skia's ColorMatrix / ColorFilter.MakeMatrix expects,
 * so the SAME matrix drives the live <ColorMatrix> preview and the offscreen bake at save.
 *
 * A matrix M maps a pixel p (as a column [r,g,b,a,1]) to M·p. Composition treats each 4×5 as a 5×5
 * with an implicit last row [0,0,0,0,1], so translate (the 5th column) composes correctly.
 */
export type CMatrix = number[]; // length 20

export const IDENTITY: CMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Compose two colour matrices so `after` is applied AFTER `before` (result·p = after·(before·p)). */
export function compose(after: CMatrix, before: CMatrix): CMatrix {
  const a = after;
  const b = before;
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 5 + k] * b[k * 5 + c];
      if (c === 4) sum += a[r * 5 + 4]; // after's translate × before's implicit [.,.,.,.,1] row
      out[r * 5 + c] = sum;
    }
  }
  return out;
}

// Luma weights (Rec. 709) for luminance-preserving saturation.
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/** Brightness: additive lift, v in [-1,1] → offset ±0.4 on RGB. */
export function brightnessMatrix(v: number): CMatrix {
  const o = v * 0.4;
  return [1, 0, 0, 0, o, 0, 1, 0, 0, o, 0, 0, 1, 0, o, 0, 0, 0, 1, 0];
}

/** Contrast about mid-grey: v in [-1,1] → gain 0..2, pivoted at 0.5. */
export function contrastMatrix(v: number): CMatrix {
  const f = 1 + v;
  const t = 0.5 * (1 - f);
  return [f, 0, 0, 0, t, 0, f, 0, 0, t, 0, 0, f, 0, t, 0, 0, 0, 1, 0];
}

/** Saturation: v in [-1,1] → scale 0..2 (v=-1 fully desaturates to luma). */
export function saturationMatrix(v: number): CMatrix {
  const s = 1 + v;
  const sr = (1 - s) * LR;
  const sg = (1 - s) * LG;
  const sb = (1 - s) * LB;
  return [
    sr + s, sg, sb, 0, 0,
    sr, sg + s, sb, 0, 0,
    sr, sg, sb + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Warmth / temperature: v in [-1,1], positive = warmer (lift R, cut B). */
export function warmthMatrix(v: number): CMatrix {
  const rs = 1 + v * 0.2;
  const bs = 1 - v * 0.2;
  return [rs, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, bs, 0, 0, 0, 0, 0, 1, 0];
}

/** Filter presets — a fixed "look" the user's Adjust sliders then layer on top of. */
export const PRESETS: { key: string; label: string; matrix: CMatrix }[] = [
  { key: 'none', label: 'Original', matrix: IDENTITY },
  { key: 'vivid', label: 'Vivid', matrix: compose(contrastMatrix(0.12), saturationMatrix(0.45)) },
  {
    key: 'dramatic',
    label: 'Dramatic',
    matrix: compose(warmthMatrix(-0.22), compose(contrastMatrix(0.34), saturationMatrix(-0.18))),
  },
  { key: 'mono', label: 'Mono', matrix: saturationMatrix(-1) },
  { key: 'noir', label: 'Noir', matrix: compose(contrastMatrix(0.4), saturationMatrix(-1)) },
  { key: 'silvertone', label: 'Silver', matrix: compose(warmthMatrix(0.16), saturationMatrix(-0.85)) },
  { key: 'warm', label: 'Warm', matrix: compose(warmthMatrix(0.35), contrastMatrix(-0.05)) },
  { key: 'cool', label: 'Cool', matrix: compose(warmthMatrix(-0.32), saturationMatrix(0.1)) },
];

export interface Tonal {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  filter: string;
}

export const NEUTRAL_TONAL: Tonal = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, filter: 'none' };

/** True when any tonal control departs from neutral — i.e. Skia is needed for preview + bake. */
export function isTonalActive(t: Tonal): boolean {
  return (
    t.brightness !== 0 ||
    t.contrast !== 0 ||
    t.saturation !== 0 ||
    t.warmth !== 0 ||
    t.filter !== 'none'
  );
}

/** The single colour matrix for the current tonal state: preset first (the look), adjustments on top. */
export function buildMatrix(t: Tonal): CMatrix {
  const preset = PRESETS.find((p) => p.key === t.filter)?.matrix ?? IDENTITY;
  let m = brightnessMatrix(t.brightness);
  m = compose(contrastMatrix(t.contrast), m);
  m = compose(saturationMatrix(t.saturation), m);
  m = compose(warmthMatrix(t.warmth), m);
  return compose(m, preset);
}
