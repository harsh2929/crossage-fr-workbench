import { recordAppStorageIssue } from "./appStorageDiagnostics";

export const MAX_MEDIA_ACTION_DESTINATIONS = 6;

export function mediaActionDestinationsStorageKey(workspace: string | null | undefined) {
  return `vintrace:media-destinations:${workspace || "default"}`;
}

export function normalizeMediaActionDestinations(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((item): item is string => typeof item === "string").slice(0, MAX_MEDIA_ACTION_DESTINATIONS);
}

export function readMediaActionDestinations(workspace: string | null | undefined) {
  const key = mediaActionDestinationsStorageKey(workspace);
  try {
    return normalizeMediaActionDestinations(JSON.parse(window.localStorage.getItem(key) || "[]"));
  } catch (error) {
    recordAppStorageIssue("mediaDestinations", "read", key, error);
    return [];
  }
}

export function writeMediaActionDestinations(workspace: string | null | undefined, destinations: unknown) {
  const key = mediaActionDestinationsStorageKey(workspace);
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizeMediaActionDestinations(destinations)));
  } catch (error) {
    recordAppStorageIssue("mediaDestinations", "write", key, error);
  }
}

export function upsertMediaActionDestination(current: unknown, folder: string) {
  const clean = folder.trim();
  if (!clean) return normalizeMediaActionDestinations(current);
  return [
    clean,
    ...normalizeMediaActionDestinations(current).filter((item) => item !== clean)
  ].slice(0, MAX_MEDIA_ACTION_DESTINATIONS);
}
