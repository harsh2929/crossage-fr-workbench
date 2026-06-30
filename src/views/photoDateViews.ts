export type PhotoDateViewMode = "all" | "years" | "months" | "days" | "recentDays";

export interface PhotoDateItemLike {
  sourcePath?: unknown;
  title?: unknown;
  captureDate?: unknown;
  originalCaptureDate?: unknown;
  dateOverride?: unknown;
  scanDate?: unknown;
  addedAt?: unknown;
  createdAt?: unknown;
  previewUrl?: unknown;
  sourceUrl?: unknown;
  favorite?: unknown;
  edited?: unknown;
  mediaKind?: unknown;
  personCount?: unknown;
  people?: unknown;
  bestQuality?: unknown;
  quality?: unknown;
  locationOverride?: unknown;
  locationHidden?: unknown;
  assetMetadata?: unknown;
  duplicate?: unknown;
  duplicateCount?: unknown;
  duplicateGroup?: unknown;
  duplicateGroupId?: unknown;
  duplicateState?: unknown;
  editStackVersionCount?: unknown;
  hasEditStackVersions?: unknown;
  versionCount?: unknown;
}

export interface PhotoDateBucket<T extends PhotoDateItemLike> {
  key: string;
  label: string;
  count: number;
  coverItem: T;
  items: T[];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_SHORT_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function photoDateText(item: PhotoDateItemLike): string {
  const raw = String(item.dateOverride || item.captureDate || item.originalCaptureDate || item.scanDate || item.addedAt || item.createdAt || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function photoDateBucketKey(item: PhotoDateItemLike, mode: PhotoDateViewMode): string {
  const date = photoDateText(item);
  if (!date) return "";
  if (mode === "years") return date.slice(0, 4);
  if (mode === "months") return date.slice(0, 7);
  if (mode === "days" || mode === "recentDays") return date;
  return "";
}

export function buildPhotoDateBuckets<T extends PhotoDateItemLike>(items: T[], mode: PhotoDateViewMode): PhotoDateBucket<T>[] {
  if (mode === "all") return [];
  const anchor = mode === "recentDays" ? latestPhotoDate(items) : "";
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    const date = photoDateText(item);
    if (!date) return;
    if (anchor && !withinRecentDays(date, anchor, 30)) return;
    const key = photoDateBucketKey(item, mode);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, bucketItems]) => ({
      key,
      label: formatPhotoDateBucketLabel(key, mode),
      count: bucketItems.length,
      coverItem: photoDateBucketCoverItem(bucketItems),
      items: bucketItems,
    }));
}

function truthyPhotoDateValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function numberPhotoDateValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectPhotoDateValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function photoDateItemPersonCount(item: PhotoDateItemLike): number {
  const direct = numberPhotoDateValue(item.personCount);
  if (direct > 0) return direct;
  return Array.isArray(item.people)
    ? new Set(item.people.map((person) => String(objectPhotoDateValue(person).personName || "").trim().toLowerCase()).filter(Boolean)).size
    : 0;
}

function photoDateItemQuality(item: PhotoDateItemLike): number {
  return Math.max(0, Math.min(1, numberPhotoDateValue(item.bestQuality || item.quality)));
}

function photoDateItemHasLocation(item: PhotoDateItemLike): boolean {
  if (truthyPhotoDateValue(item.locationHidden)) return false;
  const override = objectPhotoDateValue(item.locationOverride);
  if (String(override.label || "").trim()) return true;
  if (String(override.latitude || override.lat || "").trim() && String(override.longitude || override.lon || override.lng || "").trim()) return true;
  const metadata = objectPhotoDateValue(item.assetMetadata);
  const exif = objectPhotoDateValue(metadata.exif);
  const gps = objectPhotoDateValue(exif.gps);
  return Boolean(
    String(gps.latitude || gps.lat || "").trim() &&
    String(gps.longitude || gps.lon || gps.lng || "").trim()
  );
}

function photoDateItemIsVideo(item: PhotoDateItemLike): boolean {
  return String(item.mediaKind || "").trim().toLowerCase() === "video";
}

function photoDateItemDuplicateCount(item: PhotoDateItemLike): number {
  const direct = numberPhotoDateValue(item.duplicateCount);
  if (direct > 0) return direct;
  const group = objectPhotoDateValue(item.duplicateGroup);
  if (String(group.groupId || group.id || "").trim()) return 1;
  if (String(item.duplicateGroupId || "").trim()) return 1;
  return truthyPhotoDateValue(item.duplicate) || truthyPhotoDateValue(item.duplicateState) ? 1 : 0;
}

function photoDateItemVersionCount(item: PhotoDateItemLike): number {
  const direct = Math.max(
    numberPhotoDateValue(item.editStackVersionCount),
    numberPhotoDateValue(item.versionCount)
  );
  if (direct > 0) return direct;
  return truthyPhotoDateValue(item.hasEditStackVersions) ? 1 : 0;
}

function photoDateBucketCoverRank(item: PhotoDateItemLike): [number, number, number, number, number, string, string] {
  return [
    truthyPhotoDateValue(item.favorite) ? 1 : 0,
    photoDateItemQuality(item),
    photoDateItemPersonCount(item),
    photoDateItemHasLocation(item) ? 1 : 0,
    truthyPhotoDateValue(item.edited) ? 1 : 0,
    photoDateText(item),
    String(item.sourcePath || "").toLowerCase(),
  ];
}

function photoDateBucketCoverItem<T extends PhotoDateItemLike>(items: T[]): T {
  return [...items].sort((left, right) => {
    const leftRank = photoDateBucketCoverRank(left);
    const rightRank = photoDateBucketCoverRank(right);
    for (let index = 0; index < leftRank.length; index += 1) {
      const leftValue = leftRank[index];
      const rightValue = rightRank[index];
      if (leftValue === rightValue) continue;
      return leftValue > rightValue ? -1 : 1;
    }
    return 0;
  })[0] || items[0];
}

function photoDateSummaryCount(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export function buildPhotoDateBucketSummaryBadges(items: PhotoDateItemLike[]): string[] {
  const favoriteCount = items.filter((item) => truthyPhotoDateValue(item.favorite)).length;
  const peoplePhotoCount = items.filter((item) => photoDateItemPersonCount(item) > 0).length;
  const locationCount = items.filter(photoDateItemHasLocation).length;
  const videoCount = items.filter(photoDateItemIsVideo).length;
  const editedCount = items.filter((item) => truthyPhotoDateValue(item.edited)).length;
  const duplicateCount = items.filter((item) => photoDateItemDuplicateCount(item) > 0).length;
  const versionCount = items.filter((item) => photoDateItemVersionCount(item) > 0).length;
  return [
    favoriteCount ? photoDateSummaryCount(favoriteCount, "favorite") : "",
    peoplePhotoCount ? `${peoplePhotoCount} with people` : "",
    locationCount ? photoDateSummaryCount(locationCount, "place") : "",
    videoCount ? photoDateSummaryCount(videoCount, "video") : "",
    editedCount ? `${editedCount} edited` : "",
    duplicateCount ? photoDateSummaryCount(duplicateCount, "duplicate") : "",
    versionCount ? photoDateSummaryCount(versionCount, "version") : "",
  ].filter(Boolean);
}

export function photoDateBucketCoverReason(item: PhotoDateItemLike): string {
  if (truthyPhotoDateValue(item.favorite)) return "Favorite";
  if (photoDateItemPersonCount(item) > 0) return "People";
  if (photoDateItemHasLocation(item)) return "Place";
  if (truthyPhotoDateValue(item.edited)) return "Edited";
  if (photoDateItemIsVideo(item)) return "Video";
  if (photoDateItemDuplicateCount(item) > 0) return "Duplicate";
  if (photoDateItemVersionCount(item) > 0) return "Version";
  if (photoDateItemQuality(item) > 0) return "Best quality";
  return "Newest";
}

function latestPhotoDate(items: PhotoDateItemLike[]): string {
  return items.map(photoDateText).filter(Boolean).sort().at(-1) || "";
}

function withinRecentDays(date: string, anchor: string, days: number): boolean {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  const anchorDate = Date.parse(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(parsed) || !Number.isFinite(anchorDate)) return false;
  return parsed >= anchorDate - days * 24 * 60 * 60 * 1000 && parsed <= anchorDate;
}

export function formatPhotoDateBucketLabel(key: string, mode: PhotoDateViewMode): string {
  if (mode === "years") return key;
  const monthMatch = key.match(/^(\d{4})-(\d{2})$/);
  if (mode === "months" && monthMatch) {
    const monthIndex = Number(monthMatch[2]) - 1;
    const month = MONTH_NAMES[monthIndex];
    return month ? `${month} ${monthMatch[1]}` : key;
  }
  const dayMatch = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if ((mode === "days" || mode === "recentDays") && dayMatch) {
    const monthIndex = Number(dayMatch[2]) - 1;
    const month = MONTH_SHORT_NAMES[monthIndex];
    const day = Number(dayMatch[3]);
    return month && day >= 1 && day <= 31 ? `${month} ${day}, ${dayMatch[1]}` : key;
  }
  return key;
}
