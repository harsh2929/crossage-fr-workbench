// Shared-element FLIP zoom for the lightbox (Wave P2 detail-open). Capture the
// tapped tile's rect, then when the lightbox image mounts, animate it from
// looking-like-the-tile to its full size ("zoom out of the tile"). JS-driven
// (real-DOM measurement + Web Animations), so it honours the reduced-motion
// preference explicitly; the pure geometry lives in ../lib/flipZoom.
import { useCallback } from "react";
import { computeFlipTransform, flipTransformString, isDegenerateRect, type Rect } from "../lib/flipZoom";
import { useReducedMotion } from "./useReducedMotion";

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function useFlipZoom(durationMs = 340) {
  const reducedMotion = useReducedMotion();

  // Zoom `target` (the lightbox image) out of `origin` (the tapped tile). Both are
  // measured now — the tile stays in place behind the lightbox overlay. No-op
  // (plain appearance) when either is missing/off-screen or reduced motion is on.
  const playZoom = useCallback(
    (origin: Element | null | undefined, target: HTMLElement | null | undefined) => {
      if (!origin || !target || reducedMotion || typeof target.animate !== "function") return;
      const first = rectOf(origin);
      const last = rectOf(target);
      if (isDegenerateRect(first) || isDegenerateRect(last)) return;
      const invert = flipTransformString(computeFlipTransform(first, last));
      target.animate(
        [
          { transformOrigin: "0 0", transform: invert, opacity: 0.55 },
          { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
        ],
        { duration: durationMs, easing: "cubic-bezier(0.2, 0, 0, 1)" } // --ease-emphasized
      );
    },
    [reducedMotion, durationMs]
  );

  return { playZoom };
}
