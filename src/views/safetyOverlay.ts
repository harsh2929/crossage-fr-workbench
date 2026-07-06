// Safe Mode explainer overlay geometry (pure, unit-tested).
//
// The Stage-2 explainer (`explain_safety`) returns body-part detections as boxes
// normalized to [0,1] against the *natural* image. The lightbox renders that image
// object-fit:contain (or cover in "fill" mode) inside a stage, so the image is
// letterboxed/pillarboxed and does not fill the stage. To draw a box that lines up
// with the pixels, we reproduce the same contain/cover fit the browser applies and
// project the normalized box into stage-pixel space. Kept free of React/DOM so the
// math is testable in isolation (tests/safety_overlay.test.mjs).

export interface Size {
  width: number;
  height: number;
}
export interface UnitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface RenderRect extends PixelRect {
  scale: number;
}
export type FitMode = "fit" | "fill";

/** The rect (in display/stage pixels) the image content actually occupies under
 *  object-fit `fit` (contain, min-scale) or `fill` (cover, max-scale), centered. */
export function containRenderRect(natural: Size, display: Size, fit: FitMode = "fit"): RenderRect {
  const nw = natural.width;
  const nh = natural.height;
  if (!(nw > 0) || !(nh > 0) || !(display.width > 0) || !(display.height > 0)) {
    return { left: 0, top: 0, width: 0, height: 0, scale: 0 };
  }
  const sx = display.width / nw;
  const sy = display.height / nh;
  const scale = fit === "fill" ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = nw * scale;
  const height = nh * scale;
  return {
    left: (display.width - width) / 2,
    top: (display.height - height) / 2,
    width,
    height,
    scale,
  };
}

/** Project a normalized detection box onto the rendered image inside `display`. */
export function projectNormalizedBox(box: UnitBox, natural: Size, display: Size, fit: FitMode = "fit"): PixelRect {
  const rect = containRenderRect(natural, display, fit);
  return {
    left: rect.left + box.x * rect.width,
    top: rect.top + box.y * rect.height,
    width: box.w * rect.width,
    height: box.h * rect.height,
  };
}

/** Clamp a box to the unit square, trimming width/height so it never spills past 1. */
export function clampUnitBox(box: UnitBox): UnitBox {
  const x = Math.min(Math.max(box.x, 0), 1);
  const y = Math.min(Math.max(box.y, 0), 1);
  return {
    x,
    y,
    w: Math.min(Math.max(box.w, 0), 1 - x),
    h: Math.min(Math.max(box.h, 0), 1 - y),
  };
}

const ZERO_BOX: UnitBox = { x: 0, y: 0, w: 0, h: 0 };

/** Normalize the backend detection box (a `[x,y,w,h]` array, or an object) into a
 *  UnitBox. Returns a zero box for anything malformed. */
export function toUnitBox(box: unknown): UnitBox {
  if (Array.isArray(box)) {
    if (box.length !== 4 || !box.every((n) => Number.isFinite(n))) return { ...ZERO_BOX };
    return { x: box[0], y: box[1], w: box[2], h: box[3] };
  }
  if (box && typeof box === "object") {
    const b = box as Record<string, unknown>;
    const nums = [b.x, b.y, b.w, b.h];
    if (!nums.every((n) => Number.isFinite(n))) return { ...ZERO_BOX };
    return { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
  }
  return { ...ZERO_BOX };
}

/** Turn a NudeNet class like `FEMALE_BREAST_EXPOSED` into `Female breast exposed`. */
export function formatDetectionLabel(label: string): string {
  const words = String(label || "").replace(/_/g, " ").trim().toLowerCase();
  if (!words) return "Sensitive region";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
