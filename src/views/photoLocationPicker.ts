export interface PhotoLocationPickerPoint {
  latitude: number;
  longitude: number;
  x: number;
  y: number;
}

export interface PhotoLocationPickerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function parsePhotoLocationCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function clampPhotoLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

export function clampPhotoLongitude(value: number): number {
  return Math.max(-180, Math.min(180, value));
}

export function formatPhotoLocationCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

export function photoLocationPickerPoint(latitude: unknown, longitude: unknown): PhotoLocationPickerPoint | null {
  const lat = parsePhotoLocationCoordinate(latitude);
  const lon = parsePhotoLocationCoordinate(longitude);
  if (lat === null || lon === null) return null;
  const cleanLatitude = clampPhotoLatitude(lat);
  const cleanLongitude = clampPhotoLongitude(lon);
  return {
    latitude: cleanLatitude,
    longitude: cleanLongitude,
    x: ((cleanLongitude + 180) / 360) * 100,
    y: ((90 - cleanLatitude) / 180) * 100,
  };
}

export function photoLocationFromPickerPercent(x: unknown, y: unknown): PhotoLocationPickerPoint {
  const px = Math.max(0, Math.min(100, Number(x) || 0));
  const py = Math.max(0, Math.min(100, Number(y) || 0));
  const longitude = clampPhotoLongitude((px / 100) * 360 - 180);
  const latitude = clampPhotoLatitude(90 - (py / 100) * 180);
  return { latitude, longitude, x: px, y: py };
}

export function photoLocationFromClientPoint(clientX: number, clientY: number, rect: PhotoLocationPickerRect): PhotoLocationPickerPoint | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !rect.width || !rect.height) return null;
  return photoLocationFromPickerPercent(
    ((clientX - rect.left) / rect.width) * 100,
    ((clientY - rect.top) / rect.height) * 100
  );
}
