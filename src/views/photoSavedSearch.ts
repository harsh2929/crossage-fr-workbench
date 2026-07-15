import type { CandidateStatus, PhotoAlbumRules, PhotoSmartQueryGroup, PhotoSmartQueryNode } from "../types";

export interface PhotoSavedSearchInput {
  searchQuery?: unknown;
  keyword?: unknown;
  mediaKind?: unknown;
  favoriteOnly?: boolean;
  editedOnly?: boolean;
  notInAlbumOnly?: boolean;
  person?: unknown;
  status?: unknown;
  minQuality?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  source?: unknown;
  fileType?: unknown;
  duplicateOnly?: boolean;
  location?: unknown;
  nearbyLatitude?: unknown;
  nearbyLongitude?: unknown;
  nearbyRadiusKm?: unknown;
  nearbyLabel?: unknown;
  camera?: unknown;
  album?: unknown;
  albumLabel?: unknown;
  visibility?: unknown;
}

export interface PhotoSavedSearchDraft {
  name: string;
  description: string;
  rules: PhotoAlbumRules;
}

export interface PhotoSavedFilterState {
  searchQuery: string;
  keyword: string;
  mediaKind: string;
  favoriteOnly: boolean;
  editedOnly: boolean;
  notInAlbumOnly: boolean;
  person: string;
  status: string;
  minQuality: string;
  dateFrom: string;
  dateTo: string;
  source: string;
  fileType: string;
  duplicateOnly: boolean;
  location: string;
  nearbyLatitude: string;
  nearbyLongitude: string;
  nearbyRadiusKm: string;
  nearbyLabel: string;
  camera: string;
  album: string;
  albumLabel: string;
  visibility: string;
}

export type PhotoMediaFilter = "" | "image" | "video" | "screenshot" | "screen_recording" | "panorama" | "portrait" | "burst" | "time_lapse" | "raw" | "live_photo" | "other";
export type PhotoStatusFilter = "" | CandidateStatus;
export type PhotoVisibilityFilter = "" | "all" | "hidden" | "deleted";

export interface PhotoSavedFilter {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  pinned?: boolean;
  position?: number;
  count?: number;
  previewPending?: boolean;
  ruleSummary?: string[];
  previewSamples?: string[];
  filters: PhotoSavedFilterState;
  rules: PhotoAlbumRules;
}

export const SAVED_PHOTO_FILTERS_KEY = "vintrace.photos.savedFilters";
export const EMPTY_PHOTO_ALBUM_RULES: PhotoAlbumRules = {};
export const PHOTO_QUALITY_FILTERS = ["0.6", "0.7", "0.8", "0.9"] as const;
export const PHOTO_FILE_TYPE_FILTERS = ["jpg", "png", "heic", "dng", "mov", "mp4", "tiff", "gif", "webp"] as const;

function isPhotoCandidateStatus(value: unknown): value is CandidateStatus {
  return value === "pending" || value === "accepted" || value === "uncertain" || value === "rejected";
}

export function cleanPhotoAlbumRules(rules: PhotoAlbumRules): PhotoAlbumRules {
  const next: PhotoAlbumRules = {};
  const statuses = [...new Set(rules.statuses || [])].filter(isPhotoCandidateStatus);
  if (statuses.length) next.statuses = statuses;
  if (rules.mediaKind) next.mediaKind = rules.mediaKind;
  if (rules.query?.trim()) next.query = rules.query.trim().slice(0, 200);
  if (rules.keyword?.trim()) next.keyword = rules.keyword.trim().slice(0, 80);
  if (rules.dateFrom) next.dateFrom = rules.dateFrom;
  if (rules.dateTo) next.dateTo = rules.dateTo;
  if (rules.folder?.trim()) next.folder = rules.folder.trim();
  if (typeof rules.minScore === "number" && rules.minScore > 0) next.minScore = Math.max(0, Math.min(1, rules.minScore));
  if (typeof rules.minQuality === "number" && rules.minQuality > 0) next.minQuality = Math.max(0, Math.min(1, rules.minQuality));
  if (rules.favoriteOnly) next.favoriteOnly = true;
  if (rules.editedOnly) next.editedOnly = true;
  if (rules.hasVideoFrames) next.hasVideoFrames = true;
  if (rules.unknownOnly) next.unknownOnly = true;
  if (typeof rules.recentDays === "number" && rules.recentDays > 0) next.recentDays = Math.max(1, Math.min(3650, Math.round(rules.recentDays)));
  if (rules.queryDsl?.op && Array.isArray(rules.queryDsl.conditions)) next.queryDsl = rules.queryDsl;
  if (rules.op && Array.isArray(rules.conditions)) {
    next.op = rules.op;
    next.conditions = rules.conditions;
  }
  return next;
}

export function photoSavedFilterStatesEqual(a: PhotoSavedFilterState, b: PhotoSavedFilterState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function photoMediaFilterValue(value: string): PhotoMediaFilter {
  return value === "image"
    || value === "video"
    || value === "screenshot"
    || value === "screen_recording"
    || value === "panorama"
    || value === "portrait"
    || value === "burst"
    || value === "time_lapse"
    || value === "raw"
    || value === "live_photo"
    || value === "other"
    ? value
    : "";
}

export function photoStatusFilterValue(value: string): PhotoStatusFilter {
  return value === "pending" || value === "accepted" || value === "uncertain" || value === "rejected" ? value : "";
}

export function photoVisibilityFilterValue(value: string): PhotoVisibilityFilter {
  return value === "all" || value === "hidden" || value === "deleted" ? value : "";
}

export interface PhotoAlbumPeopleQueryOptions {
  includePeople?: readonly string[];
  excludePeople?: readonly string[];
}

function cleanPeopleList(values: readonly string[] | undefined): string[] {
  const people: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const person = String(value || "").trim();
    const key = person.toLowerCase();
    if (!person || seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  return people;
}

function cleanNearbyNumberText(value: unknown, minimum: number, maximum: number): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) return "";
  return String(parsed);
}

function cleanNearbyRadiusText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "25";
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return "25";
  return String(Math.max(0.1, Math.min(500, parsed)));
}

function photoNearbyRuleValue(input: Pick<PhotoSavedFilterState, "nearbyLatitude" | "nearbyLongitude" | "nearbyRadiusKm">): string {
  const latitude = cleanNearbyNumberText(input.nearbyLatitude, -90, 90);
  const longitude = cleanNearbyNumberText(input.nearbyLongitude, -180, 180);
  if (!latitude || !longitude) return "";
  return `${latitude},${longitude},${cleanNearbyRadiusText(input.nearbyRadiusKm)}`;
}

function photoAlbumPeopleConditions(options: PhotoAlbumPeopleQueryOptions = {}): PhotoSmartQueryNode[] {
  const excludePeople = cleanPeopleList(options.excludePeople);
  const excludeKeys = new Set(excludePeople.map((person) => person.toLowerCase()));
  const includePeople = cleanPeopleList(options.includePeople).filter((person) => !excludeKeys.has(person.toLowerCase()));
  const conditions: PhotoSmartQueryNode[] = [];
  if (includePeople.length === 1) {
    conditions.push({ field: "person", operator: "is", value: includePeople[0] });
  } else if (includePeople.length > 1) {
    conditions.push({
      op: "any",
      conditions: includePeople.map((person) => ({ field: "person", operator: "is", value: person })),
    });
  }
  for (const person of excludePeople) {
    conditions.push({ field: "person", operator: "isNot", value: person });
  }
  return conditions;
}

export function combineSmartQueryWithPeople(
  group: PhotoSmartQueryGroup | null,
  options: PhotoAlbumPeopleQueryOptions = {}
): PhotoSmartQueryGroup | null {
  const peopleConditions = photoAlbumPeopleConditions(options);
  if (!group) return peopleConditions.length ? { op: "all", conditions: peopleConditions } : null;
  if (!peopleConditions.length) return group;
  if (group.op === "all") return { op: "all", conditions: [...group.conditions, ...peopleConditions] };
  return { op: "all", conditions: [group, ...peopleConditions] };
}

export function photoAlbumRulesToSmartQuery(
  rules: PhotoAlbumRules,
  options: PhotoAlbumPeopleQueryOptions = {}
): PhotoSmartQueryGroup | null {
  const conditions: PhotoSmartQueryNode[] = [];
  const add = (field: string, operator: string, value: string | number | boolean | string[] | number[] | boolean[] | undefined) => {
    if (value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && value.length === 0) return;
    conditions.push({ field, operator, value });
  };
  if (rules.statuses?.length) {
    const statuses = [...new Set(rules.statuses)].filter(Boolean) as CandidateStatus[];
    if (statuses.length === 1) {
      add("status", "is", statuses[0]);
    } else if (statuses.length > 1) {
      conditions.push({
        op: "any",
        conditions: statuses.map((status) => ({ field: "status", operator: "is", value: status })),
      });
    }
  }
  add("query", "contains", rules.query?.trim().slice(0, 200));
  add("keyword", "is", rules.keyword?.trim().slice(0, 80));
  add("mediaKind", "is", rules.mediaKind);
  add("date", "onOrAfter", rules.dateFrom);
  add("date", "onOrBefore", rules.dateTo);
  add("folder", "contains", rules.folder?.trim());
  if (typeof rules.minScore === "number" && rules.minScore > 0) add("score", "atLeast", Math.max(0, Math.min(1, rules.minScore)));
  if (typeof rules.minQuality === "number" && rules.minQuality > 0) add("quality", "atLeast", Math.max(0, Math.min(1, rules.minQuality)));
  if (rules.favoriteOnly) add("favorite", "is", true);
  if (rules.editedOnly) add("edited", "is", true);
  if (rules.hasVideoFrames) add("hasVideoFrames", "is", true);
  if (rules.unknownOnly) add("unknown", "is", true);
  if (typeof rules.recentDays === "number" && rules.recentDays > 0) add("recentDays", "withinLast", Math.max(1, Math.min(3650, Math.round(rules.recentDays))));
  return combineSmartQueryWithPeople(conditions.length ? { op: "all", conditions } : null, options);
}

export function buildPhotoSavedSearchDraft(input: PhotoSavedSearchInput): PhotoSavedSearchDraft | null {
  const rules: PhotoAlbumRules = {};
  const extraConditions: PhotoSmartQueryNode[] = [];
  const parts: string[] = [];
  const searchQuery = String(input.searchQuery || "").trim();
  const keyword = String(input.keyword || "").trim();
  const mediaKind = String(input.mediaKind || "").trim();
  const person = String(input.person || "").trim();
  const status = String(input.status || "").trim();
  const minQuality = Number(input.minQuality || 0);
  const dateFrom = String(input.dateFrom || "").trim().slice(0, 10);
  const dateTo = String(input.dateTo || "").trim().slice(0, 10);
  const source = String(input.source || "").trim();
  const fileType = String(input.fileType || "").trim().toLowerCase().replace(/^\./, "");
  const location = String(input.location || "").trim();
  const camera = String(input.camera || "").trim();
  const album = String(input.album || "").trim();
  const albumLabel = String(input.albumLabel || album).trim();
  const visibility = String(input.visibility || "").trim();
  const savedFilterState = normalizePhotoSavedFilterState(input);
  const nearbyRuleValue = photoNearbyRuleValue(savedFilterState);
  const nearbyLabel = photoSavedFilterNearbyLabel(savedFilterState);
  if (searchQuery) {
    rules.query = searchQuery.slice(0, 200);
    parts.push(searchQuery);
  }
  if (keyword) {
    rules.keyword = keyword.slice(0, 80);
    parts.push(keyword);
  }
  if (mediaKind) {
    rules.mediaKind = mediaKind;
    parts.push(mediaKindLabel(mediaKind));
  }
  if (input.favoriteOnly) {
    rules.favoriteOnly = true;
    parts.push("Favorites");
  }
  if (input.editedOnly) {
    rules.editedOnly = true;
    parts.push("Edited");
  }
  if (input.notInAlbumOnly) {
    extraConditions.push({ field: "notInAlbum", operator: "is", value: true });
    parts.push("Not in Album");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    rules.dateFrom = dateFrom;
    parts.push(`From ${dateFrom}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    rules.dateTo = dateTo;
    parts.push(`Through ${dateTo}`);
  }
  if (source) {
    rules.folder = source.slice(0, 240);
    parts.push(source);
  }
  if (fileType) {
    extraConditions.push({ field: "fileType", operator: "is", value: fileType });
    parts.push(fileType.toUpperCase());
  }
  if (input.duplicateOnly) {
    extraConditions.push({ field: "duplicate", operator: "is", value: true });
    parts.push("Duplicates");
  }
  if (location) {
    extraConditions.push({ field: "location", operator: "contains", value: location.slice(0, 160) });
    parts.push(location);
  }
  if (nearbyRuleValue) {
    extraConditions.push({ field: "nearby", operator: "is", value: nearbyRuleValue });
    parts.push(nearbyLabel || "Nearby radius");
  }
  if (camera) {
    extraConditions.push({ field: "camera", operator: "contains", value: camera.slice(0, 160) });
    parts.push(camera);
  }
  if (album) {
    extraConditions.push({ field: "album", operator: "is", value: album });
    parts.push(albumLabel || album);
  }
  if (visibility === "hidden") {
    extraConditions.push({ field: "hidden", operator: "is", value: true });
    parts.push("Hidden");
  } else if (visibility === "deleted") {
    extraConditions.push({ field: "deleted", operator: "is", value: true });
    parts.push("Recently Deleted");
  } else if (visibility === "all") {
    extraConditions.push({
      op: "any",
      conditions: [
        { field: "hidden", operator: "is", value: true },
        { field: "hidden", operator: "is", value: false },
      ],
    });
    parts.push("All visibility");
  }
  if (person) {
    extraConditions.push({ field: "person", operator: "is", value: person });
    parts.push(person);
  }
  if (status) {
    rules.statuses = [status as CandidateStatus];
    parts.push(statusLabel(status));
  }
  if (Number.isFinite(minQuality) && minQuality > 0) {
    rules.minQuality = Math.max(0, Math.min(1, minQuality));
    parts.push(`Quality ${Math.round(rules.minQuality * 100)}%`);
  }
  if (!Object.keys(rules).length && !extraConditions.length) return null;
  const queryDsl = photoAlbumRulesToSmartQuery(rules);
  const conditions = [...(queryDsl?.conditions || []), ...extraConditions];
  if (conditions.length) {
    rules.op = "all";
    rules.conditions = conditions;
  }
  const name = `Saved search: ${parts.slice(0, 3).join(" + ")}`.slice(0, 80);
  return {
    name,
    description: "Created from the active Photos search and filter chips.",
    rules,
  };
}

export function buildPhotoSavedFilter(input: PhotoSavedSearchInput, options: { id: string; createdAt: string }): PhotoSavedFilter | null {
  const draft = buildPhotoSavedSearchDraft(input);
  const filters = normalizePhotoSavedFilterState(input);
  const nearbyLabel = photoSavedFilterNearbyLabel(filters);
  if (!draft && !nearbyLabel) return null;
  const baseName = draft?.name.replace(/^Saved search:/, "Saved filter:") || `Saved filter: ${nearbyLabel}`;
  const name = nearbyLabel && draft && !baseName.includes(nearbyLabel)
    ? `${baseName} + ${nearbyLabel}`.slice(0, 80)
    : baseName.slice(0, 80);
  return {
    id: options.id,
    name,
    description: draft?.description || "Created from the active Photos search and filter chips.",
    createdAt: options.createdAt,
    filters,
    rules: draft?.rules || {},
  };
}

export function normalizePhotoSavedFilterRecord(value: unknown): PhotoSavedFilter | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PhotoSavedFilter> & {
    filterId?: unknown;
    id?: unknown;
    name?: unknown;
    description?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    pinned?: unknown;
    position?: unknown;
    count?: unknown;
    previewPending?: unknown;
    ruleSummary?: unknown;
    previewSamples?: unknown;
    filters?: unknown;
    rules?: unknown;
  };
  const id = String(item.id || item.filterId || "").trim();
  const name = String(item.name || "").trim();
  if (!id || !name) return null;
  const position = Number(item.position);
  const count = Number(item.count);
  return {
    id,
    name,
    description: String(item.description || ""),
    createdAt: String(item.createdAt || ""),
    updatedAt: String(item.updatedAt || ""),
    pinned: Boolean(item.pinned),
    position: Number.isFinite(position) ? position : undefined,
    count: Number.isFinite(count) ? Math.max(0, count) : undefined,
    previewPending: Boolean(item.previewPending),
    ruleSummary: Array.isArray(item.ruleSummary) ? item.ruleSummary.map(String).filter(Boolean).slice(0, 8) : [],
    previewSamples: Array.isArray(item.previewSamples) ? item.previewSamples.map(String).filter(Boolean).slice(0, 3) : [],
    filters: normalizePhotoSavedFilterState(item.filters || {}),
    rules: item.rules && typeof item.rules === "object" ? item.rules as PhotoAlbumRules : {},
  };
}

export function orderPhotoSavedFilters(values: PhotoSavedFilter[]): PhotoSavedFilter[] {
  const originalIndex = new Map(values.map((filter, index) => [filter.id, index]));
  return [...values].sort((a, b) => {
    const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinned) return pinned;
    const leftPosition = typeof a.position === "number" && Number.isFinite(a.position) ? a.position : originalIndex.get(a.id) ?? 0;
    const rightPosition = typeof b.position === "number" && Number.isFinite(b.position) ? b.position : originalIndex.get(b.id) ?? 0;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    const updated = String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    if (updated) return updated;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function normalizePhotoSavedFilterList(
  values: PhotoSavedFilter[],
  options: { limit?: number; preserveOrder?: boolean } = {}
): PhotoSavedFilter[] {
  const rows = options.preserveOrder ? [...values] : orderPhotoSavedFilters(values);
  const limit = Math.max(1, Math.min(200, options.limit ?? 30));
  return rows.slice(0, limit).map((filter, index) => ({
    ...filter,
    pinned: Boolean(filter.pinned),
    position: index,
  }));
}

export function readStoredPhotoSavedFilters(key: string): PhotoSavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return normalizePhotoSavedFilterList(parsed
      .map((item) => normalizePhotoSavedFilterRecord(item))
      .filter((item): item is PhotoSavedFilter => Boolean(item))
    );
  } catch {
    return [];
  }
}

export function storePhotoSavedFilters(key: string, values: PhotoSavedFilter[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(values.slice(0, 30)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function photoSavedFilterWorkspacePayload(filter: PhotoSavedFilter, position: number): Record<string, unknown> {
  return {
    filterId: filter.id,
    name: filter.name,
    description: filter.description,
    filters: filter.filters,
    rules: filter.rules,
    pinned: Boolean(filter.pinned),
    position,
  };
}

export function normalizePhotoSavedFilterState(input: PhotoSavedSearchInput): PhotoSavedFilterState {
  return {
    searchQuery: String(input.searchQuery || "").trim(),
    keyword: String(input.keyword || "").trim(),
    mediaKind: String(input.mediaKind || "").trim(),
    favoriteOnly: Boolean(input.favoriteOnly),
    editedOnly: Boolean(input.editedOnly),
    notInAlbumOnly: Boolean(input.notInAlbumOnly),
    person: String(input.person || "").trim(),
    status: String(input.status || "").trim(),
    minQuality: String(input.minQuality || "").trim(),
    dateFrom: String(input.dateFrom || "").trim().slice(0, 10),
    dateTo: String(input.dateTo || "").trim().slice(0, 10),
    source: String(input.source || "").trim(),
    fileType: String(input.fileType || "").trim().toLowerCase().replace(/^\./, ""),
    duplicateOnly: Boolean(input.duplicateOnly),
    location: String(input.location || "").trim(),
    nearbyLatitude: String(input.nearbyLatitude || "").trim().slice(0, 32),
    nearbyLongitude: String(input.nearbyLongitude || "").trim().slice(0, 32),
    nearbyRadiusKm: String(input.nearbyRadiusKm || "").trim().slice(0, 16),
    nearbyLabel: String(input.nearbyLabel || "").trim().slice(0, 120),
    camera: String(input.camera || "").trim(),
    album: String(input.album || "").trim(),
    albumLabel: String(input.albumLabel || input.album || "").trim(),
    visibility: String(input.visibility || "").trim(),
  };
}

function photoSavedFilterNearbyLabel(input: PhotoSavedFilterState): string {
  const nearbyRule = photoNearbyRuleValue(input);
  if (!nearbyRule) return "";
  const [latitude, longitude, radius] = nearbyRule.split(",");
  const label = input.nearbyLabel.trim();
  return label ? `Nearby ${label} (${radius} km)` : `Nearby ${latitude}, ${longitude} (${radius} km)`;
}

function statusLabel(value: string): string {
  switch (value) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "uncertain":
      return "Not sure";
    case "rejected":
      return "Rejected";
    default:
      return value;
  }
}

function mediaKindLabel(value: string): string {
  switch (value) {
    case "image":
      return "Images";
    case "video":
      return "Videos";
    case "raw":
      return "RAW";
    case "live_photo":
      return "Live Photos";
    case "panorama":
      return "Panoramas";
    case "portrait":
      return "Portraits";
    case "burst":
      return "Bursts";
    case "time_lapse":
      return "Time-lapse";
    case "other":
      return "Other";
    default:
      return value;
  }
}
