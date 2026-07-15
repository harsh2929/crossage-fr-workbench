import type { PhotoItem, PhotoReverseGeocodeResult } from "../types";
import { formatPhotoLocationCoordinate, parsePhotoLocationCoordinate } from "./photoLocationPicker";
import type { PhotoSavedFilterState } from "./photoSavedSearch";

export interface PhotoNearbyFilterState {
  latitude: string;
  longitude: string;
  radiusKm: string;
  label: string;
}

export const PHOTO_NEARBY_RADIUS_OPTIONS = ["5", "25", "100"] as const;

export interface PhotoReverseGeocodeLocationPayloadInput {
  sourcePath?: unknown;
  sourcePaths?: unknown;
  assetId?: unknown;
  assetIds?: unknown;
  latitude: unknown;
  longitude: unknown;
  apply?: unknown;
}

export type PhotoReverseGeocodeLocationPayload = Record<string, unknown> & {
  latitude: number;
  longitude: number;
  apply: boolean;
  sourcePath?: string;
  sourcePaths?: string[];
  assetId?: string;
  assetIds?: string[];
};

export interface PhotoReverseGeocodeDraftCoordinates {
  latitudeDraft?: unknown;
  longitudeDraft?: unknown;
}

export type PhotoReverseGeocodeScope = "" | "lightbox" | "place";

export interface PhotoReverseGeocodeStatusTextInput {
  scope: Exclude<PhotoReverseGeocodeScope, "">;
  activeScope: PhotoReverseGeocodeScope;
  error?: string;
  result?: PhotoReverseGeocodeResult | null;
  foundLabel: string;
  appliedLabel: string;
}

export interface PhotoReverseGeocodeMetadataPatch {
  sourcePath: string;
  patch: {
    locationOverride: Record<string, unknown>;
    locationHidden: boolean;
  };
}

export interface PhotoReverseGeocodePlaceInput {
  source?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  assetIds?: unknown;
}

export interface PhotoReverseGeocodePlaceLookupState {
  latitude: number | null;
  longitude: number | null;
  assetIds: string[];
  canLookupName: boolean;
}

export interface PhotoReverseGeocodeAppliedLocationDraft {
  label: string;
  latitude: string;
  longitude: string;
  locationHidden: boolean;
}

export interface PhotoReverseGeocodeSettledOptions {
  params: Record<string, unknown>;
  reverseGeocodePhotoLocation: (params: Record<string, unknown>) => Promise<{ value?: PhotoReverseGeocodeResult | null }>;
  pendingMessage: string;
  attempts?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export function parsePhotoNearbyCoordinate(value: unknown, min: number, max: number): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

// A blank coordinate string parses to 0 via Number(""), which would otherwise be
// treated as the valid coordinate 0. Saved filters store "" for an unset location,
// so reject blanks here to avoid materialising a spurious "near (0, 0)" filter.
export function hasPhotoNearbyCoordinateText(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function compactPhotoReverseGeocodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  value.forEach((entry) => {
    const text = String(entry ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    items.push(text);
  });
  return items;
}

function photoReverseGeocodeGpsCoordinate(item: PhotoItem | null, key: "latitude" | "longitude"): number | null {
  const assetMetadata = item?.assetMetadata && typeof item.assetMetadata === "object" ? item.assetMetadata : {};
  const exif = assetMetadata.exif && typeof assetMetadata.exif === "object" ? assetMetadata.exif as Record<string, unknown> : {};
  const exifGps = exif.gps && typeof exif.gps === "object" ? exif.gps as Record<string, unknown> : {};
  const assetGps = assetMetadata.gps && typeof assetMetadata.gps === "object" ? assetMetadata.gps as Record<string, unknown> : {};
  return parsePhotoLocationCoordinate(exifGps[key] ?? assetGps[key]);
}

export function photoReverseGeocodeItemCoordinates(
  item: PhotoItem | null,
  drafts: PhotoReverseGeocodeDraftCoordinates = {}
): { latitude: number; longitude: number } | null {
  const latitude = parsePhotoLocationCoordinate(drafts.latitudeDraft) ?? photoReverseGeocodeGpsCoordinate(item, "latitude");
  const longitude = parsePhotoLocationCoordinate(drafts.longitudeDraft) ?? photoReverseGeocodeGpsCoordinate(item, "longitude");
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

export function photoReverseGeocodeStatusText(input: PhotoReverseGeocodeStatusTextInput): string {
  if (input.activeScope !== input.scope) return "";
  const error = String(input.error || "");
  if (error) return error;
  if (!input.result) return "";
  if (input.result.message) return input.result.message;
  const label = String(input.result.label || "").trim();
  if (!label) return "";
  return `${input.result.applied ? input.appliedLabel : input.foundLabel} ${label}`;
}

export function photoReverseGeocodeMetadataPatches(
  rows: Array<Partial<PhotoItem> & Record<string, unknown>> | null | undefined
): PhotoReverseGeocodeMetadataPatch[] {
  return (rows || []).reduce<PhotoReverseGeocodeMetadataPatch[]>((patches, row) => {
    const sourcePath = String(row.sourcePath || "");
    if (!sourcePath) return patches;
    patches.push({
      sourcePath,
      patch: {
        locationOverride: (row.locationOverride && typeof row.locationOverride === "object" ? row.locationOverride : {}) as Record<string, unknown>,
        locationHidden: Boolean(row.locationHidden),
      },
    });
    return patches;
  }, []);
}

export function photoReverseGeocodePlaceLookupState(
  place: PhotoReverseGeocodePlaceInput | null | undefined
): PhotoReverseGeocodePlaceLookupState {
  const latitude = parsePhotoLocationCoordinate(place?.latitude);
  const longitude = parsePhotoLocationCoordinate(place?.longitude);
  return {
    latitude,
    longitude,
    assetIds: compactPhotoReverseGeocodeList(place?.assetIds),
    canLookupName: Boolean(
      place
        && String(place.source || "") !== "user"
        && latitude !== null
        && longitude !== null
    ),
  };
}

export function photoReverseGeocodeAppliedLocationDraft(
  result: Pick<PhotoReverseGeocodeResult, "label" | "latitude" | "longitude"> | null | undefined,
  fallbackCoordinates: { latitude: unknown; longitude: unknown }
): PhotoReverseGeocodeAppliedLocationDraft {
  return {
    label: String(result?.label || ""),
    latitude: String(result?.latitude || fallbackCoordinates.latitude),
    longitude: String(result?.longitude || fallbackCoordinates.longitude),
    locationHidden: false,
  };
}

export function photoReverseGeocodeRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(200 + safeAttempt * 150, 1000);
}

export async function photoReverseGeocodeSettledResult(
  options: PhotoReverseGeocodeSettledOptions
): Promise<PhotoReverseGeocodeResult> {
  let value: PhotoReverseGeocodeResult = {
    ok: false,
    pending: true,
    message: options.pendingMessage,
  };
  const attempts = Number.isFinite(options.attempts) && Number(options.attempts) > 0
    ? Math.floor(Number(options.attempts))
    : 18;
  const wait = options.wait || ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await options.reverseGeocodePhotoLocation(options.params);
    value = result.value || { ok: false };
    if (!value.pending) return value;
    await wait(photoReverseGeocodeRetryDelayMs(attempt));
  }
  return value;
}

export function photoReverseGeocodeLocationPayload(
  input: PhotoReverseGeocodeLocationPayloadInput
): PhotoReverseGeocodeLocationPayload | null {
  const latitude = parsePhotoLocationCoordinate(input.latitude);
  const longitude = parsePhotoLocationCoordinate(input.longitude);
  if (latitude === null || longitude === null) return null;
  const payload: PhotoReverseGeocodeLocationPayload = {
    latitude,
    longitude,
    apply: Boolean(input.apply),
  };
  const sourcePath = String(input.sourcePath ?? "").trim();
  if (sourcePath) payload.sourcePath = sourcePath;
  const assetId = String(input.assetId ?? "").trim();
  if (assetId) payload.assetId = assetId;
  const sourcePaths = compactPhotoReverseGeocodeList(input.sourcePaths);
  if (sourcePaths.length) payload.sourcePaths = sourcePaths;
  const assetIds = compactPhotoReverseGeocodeList(input.assetIds);
  if (assetIds.length) payload.assetIds = assetIds;
  return payload;
}

export function photoItemCoordinates(item: PhotoItem | null): { latitude: number; longitude: number } | null {
  if (!item || item.locationHidden) return null;
  const override = item.locationOverride || {};
  const overrideLatitude = parsePhotoNearbyCoordinate(override.latitude ?? override.lat, -90, 90);
  const overrideLongitude = parsePhotoNearbyCoordinate(override.longitude ?? override.lon ?? override.lng, -180, 180);
  if (overrideLatitude !== null && overrideLongitude !== null) {
    return { latitude: overrideLatitude, longitude: overrideLongitude };
  }
  const exif = (item.assetMetadata?.exif || {}) as Record<string, unknown>;
  const gps = (exif.gps || {}) as Record<string, unknown>;
  const gpsLatitude = parsePhotoNearbyCoordinate(gps.latitude ?? gps.lat, -90, 90);
  const gpsLongitude = parsePhotoNearbyCoordinate(gps.longitude ?? gps.lon ?? gps.lng, -180, 180);
  return gpsLatitude !== null && gpsLongitude !== null ? { latitude: gpsLatitude, longitude: gpsLongitude } : null;
}

export function photoNearbyFilterKey(filter: PhotoNearbyFilterState | null): string {
  return filter ? `${filter.latitude}|${filter.longitude}|${filter.radiusKm}` : "";
}

export function photoNearbyFilterLabel(filter: PhotoNearbyFilterState | null): string {
  if (!filter) return "";
  const label = filter.label.trim();
  const radius = filter.radiusKm.trim() || "25";
  return label ? `${label} (${radius} km)` : `${filter.latitude}, ${filter.longitude} (${radius} km)`;
}

export function photoNearbyFilterParams(filter: PhotoNearbyFilterState | null): Record<string, string> {
  return filter
    ? {
      nearbyLatitude: filter.latitude,
      nearbyLongitude: filter.longitude,
      nearbyRadiusKm: filter.radiusKm,
    }
    : {};
}

export function photoNearbyFilterFromItem(item: PhotoItem, label: string): PhotoNearbyFilterState | null {
  const coordinates = photoItemCoordinates(item);
  if (!coordinates) return null;
  return {
    latitude: formatPhotoLocationCoordinate(coordinates.latitude),
    longitude: formatPhotoLocationCoordinate(coordinates.longitude),
    radiusKm: "25",
    label,
  };
}

export function photoNearbyFilterFromSavedFilterState(filters: PhotoSavedFilterState): PhotoNearbyFilterState | null {
  if (!hasPhotoNearbyCoordinateText(filters.nearbyLatitude) || !hasPhotoNearbyCoordinateText(filters.nearbyLongitude)) {
    return null;
  }
  const latitude = parsePhotoNearbyCoordinate(filters.nearbyLatitude, -90, 90);
  const longitude = parsePhotoNearbyCoordinate(filters.nearbyLongitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  const radius = PHOTO_NEARBY_RADIUS_OPTIONS.includes(filters.nearbyRadiusKm as typeof PHOTO_NEARBY_RADIUS_OPTIONS[number])
    ? filters.nearbyRadiusKm
    : "25";
  return {
    latitude: formatPhotoLocationCoordinate(latitude),
    longitude: formatPhotoLocationCoordinate(longitude),
    radiusKm: radius,
    label: filters.nearbyLabel || "Saved nearby",
  };
}
