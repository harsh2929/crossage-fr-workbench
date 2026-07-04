// FLIP shared-element zoom math (Wave P2 detail-open). When the lightbox opens,
// its image should appear to grow out of the tapped tile: measure the tile (First)
// and the lightbox image's final box (Last), apply the inverse transform so the
// image starts looking like the tile, then animate to identity ("Play").
// Pure geometry; useFlipZoom does the measuring + Web Animations. Assumes the
// animated element uses transform-origin: 0 0 (top-left).

export type Rect = { x: number; y: number; width: number; height: number };

export type FlipTransform = { x: number; y: number; scaleX: number; scaleY: number };

/** True if a rect is missing or has no positive area (skip the FLIP, just fade). */
export function isDegenerateRect(rect: Rect | null | undefined): boolean {
  return !rect || !(rect.width > 0) || !(rect.height > 0);
}

/**
 * The transform that maps `last` (the lightbox image's final box) onto `first`
 * (the tile). Applied at transform-origin 0 0: translate the top-left, then
 * scale down. Animating this back to identity plays the zoom-out from the tile.
 */
export function computeFlipTransform(first: Rect, last: Rect): FlipTransform {
  return {
    x: first.x - last.x,
    y: first.y - last.y,
    scaleX: last.width > 0 ? first.width / last.width : 1,
    scaleY: last.height > 0 ? first.height / last.height : 1,
  };
}

/** CSS transform string for a FlipTransform (transform-origin: 0 0). */
export function flipTransformString(t: FlipTransform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scaleX}, ${t.scaleY})`;
}
