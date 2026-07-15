export type LightboxFitMode = "fit" | "fill";

export type LightboxGesturePoint = {
  x: number;
  y: number;
};

export type LightboxDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export type LightboxPinchState = {
  startDistance: number;
  startZoom: number;
  startCenterX: number;
  startCenterY: number;
  originX: number;
  originY: number;
};

export type LightboxImageSamplePoint = {
  x: number;
  y: number;
};

export type LightboxStageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type LightboxMediaSize = {
  width: number;
  height: number;
};

export type LightboxImageSampleInput = {
  clientX: number;
  clientY: number;
  stageRect: LightboxStageRect;
  mediaSize: LightboxMediaSize;
  pan: LightboxGesturePoint;
  zoom: number;
  fitMode: LightboxFitMode;
};

export const PHOTO_LIGHTBOX_ZOOM_KEY = "vintrace.photos.session.lightboxZoom";
export const PHOTO_LIGHTBOX_FIT_KEY = "vintrace.photos.session.lightboxFitMode";

export function clampLightboxZoom(value: number): number {
  return Math.round(Math.max(1, Math.min(4, value)) * 100) / 100;
}

export function lightboxGesturePoints(points: Iterable<LightboxGesturePoint>): LightboxGesturePoint[] {
  return [...points];
}

export function lightboxGestureDistance(points: LightboxGesturePoint[]): number {
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

export function lightboxGestureCenter(points: LightboxGesturePoint[]): LightboxGesturePoint {
  if (points.length < 2) return { x: 0, y: 0 };
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
}

export function lightboxPinchState(
  points: LightboxGesturePoint[],
  startZoom: number,
  origin: LightboxGesturePoint,
): LightboxPinchState | null {
  const distance = lightboxGestureDistance(points);
  if (points.length < 2 || distance <= 0) return null;
  const center = lightboxGestureCenter(points);
  return {
    startDistance: distance,
    startZoom: clampLightboxZoom(startZoom),
    startCenterX: center.x,
    startCenterY: center.y,
    originX: origin.x,
    originY: origin.y,
  };
}

export function lightboxPinchTransform(
  pinch: LightboxPinchState,
  points: LightboxGesturePoint[],
): { zoom: number; pan: LightboxGesturePoint } | null {
  const distance = lightboxGestureDistance(points);
  if (points.length < 2 || distance <= 0 || pinch.startDistance <= 0) return null;
  const center = lightboxGestureCenter(points);
  const zoom = clampLightboxZoom(pinch.startZoom * (distance / pinch.startDistance));
  return {
    zoom,
    pan: zoom <= 1 ? { x: 0, y: 0 } : {
      x: pinch.originX + center.x - pinch.startCenterX,
      y: pinch.originY + center.y - pinch.startCenterY,
    },
  };
}

export function lightboxDragPan(drag: LightboxDragState, point: LightboxGesturePoint): LightboxGesturePoint {
  return {
    x: drag.originX + point.x - drag.startX,
    y: drag.originY + point.y - drag.startY,
  };
}

export function lightboxImageSamplePointFromClient(input: LightboxImageSampleInput): LightboxImageSamplePoint | null {
  const mediaWidth = Number(input.mediaSize.width || 0);
  const mediaHeight = Number(input.mediaSize.height || 0);
  const rectWidth = Number(input.stageRect.width || 0);
  const rectHeight = Number(input.stageRect.height || 0);
  if (mediaWidth <= 0 || mediaHeight <= 0 || rectWidth <= 0 || rectHeight <= 0) return null;
  const zoom = clampLightboxZoom(input.zoom || 1);
  const stageX = input.clientX - input.stageRect.left;
  const stageY = input.clientY - input.stageRect.top;
  const centerX = rectWidth / 2;
  const centerY = rectHeight / 2;
  const baseX = centerX + (stageX - input.pan.x - centerX) / zoom;
  const baseY = centerY + (stageY - input.pan.y - centerY) / zoom;
  const scale = input.fitMode === "fill"
    ? Math.max(rectWidth / mediaWidth, rectHeight / mediaHeight)
    : Math.min(rectWidth / mediaWidth, rectHeight / mediaHeight);
  const renderedWidth = mediaWidth * scale;
  const renderedHeight = mediaHeight * scale;
  if (renderedWidth <= 0 || renderedHeight <= 0) return null;
  const renderedLeft = (rectWidth - renderedWidth) / 2;
  const renderedTop = (rectHeight - renderedHeight) / 2;
  const normalizedX = (baseX - renderedLeft) / renderedWidth;
  const normalizedY = (baseY - renderedTop) / renderedHeight;
  if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return null;
  return {
    x: Math.max(0, Math.min(mediaWidth - 1, Math.round(normalizedX * (mediaWidth - 1)))),
    y: Math.max(0, Math.min(mediaHeight - 1, Math.round(normalizedY * (mediaHeight - 1)))),
  };
}

export function readSessionNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clampLightboxZoom(value) : fallback;
  } catch {
    return fallback;
  }
}

export function readSessionLightboxFitMode(key: string, fallback: LightboxFitMode): LightboxFitMode {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.sessionStorage.getItem(key);
    return value === "fill" || value === "fit" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function storeSessionNumber(key: string, value: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, String(clampLightboxZoom(value)));
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}

export function storeSessionString(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage can be unavailable in hardened browser contexts.
  }
}
