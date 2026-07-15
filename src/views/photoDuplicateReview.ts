import type { DuplicatePersonSuggestion, PhotoDuplicateGroup, PhotoItem } from "../types";

export type CandidateFileAction = "copy" | "move" | "trash";

export interface PhotoDuplicateComparisonRow {
  assetId: string;
  sourcePath: string;
  title: string;
  position: number;
  reason: string;
  isCurrent: boolean;
  isRecommended: boolean;
  badges: string[];
}

export interface PhotoDuplicateBrowserReviewRow extends PhotoDuplicateComparisonRow {
  previewUrl: string;
  sourceUrl: string;
  mediaKind: string;
  isLoaded: boolean;
  isSelected: boolean;
  loadedIndex: number;
  displayBadges: string[];
}

export interface PhotoDuplicateBrowserReviewGroup {
  group: PhotoDuplicateGroup;
  groupId: string;
  algorithm: string;
  itemCount: number;
  representativeItem: PhotoItem;
  recommendedAssetId: string;
  recommendedTitle: string;
  recommendationReasons: string[];
  rows: PhotoDuplicateBrowserReviewRow[];
  loadedCount: number;
  selectedCount: number;
}

export interface PhotoDuplicatePersonSuggestionRow {
  key: string;
  activeName: string;
  otherName: string;
  summaryText: string;
  scorePercent: number;
  countA: number;
  countB: number;
  suggestion: DuplicatePersonSuggestion;
}

export interface PhotoDuplicatePersonSuggestionFormatters {
  formatCount?: (value: number) => string;
  uiText?: (source: string) => string;
}

function fallbackFileName(sourcePath: string): string {
  return String(sourcePath || "").split(/[\\/]/).filter(Boolean).pop() || sourcePath || "Photo";
}

function cleanPersonName(value: unknown): string {
  return String(value || "").trim();
}

function personKey(value: unknown): string {
  return cleanPersonName(value).toLowerCase();
}

function formatNumber(formatters: PhotoDuplicatePersonSuggestionFormatters, value: unknown): string {
  const number = Number(value) || 0;
  return formatters.formatCount?.(number) || String(number);
}

function duplicatePersonText(formatters: PhotoDuplicatePersonSuggestionFormatters, value: string): string {
  return formatters.uiText?.(value) || value;
}

export function photoDuplicatePersonSuggestionRows(
  suggestions: readonly DuplicatePersonSuggestion[] | null | undefined,
  activePersonName: unknown,
  formatters: PhotoDuplicatePersonSuggestionFormatters = {},
): PhotoDuplicatePersonSuggestionRow[] {
  const activeName = String(activePersonName || "");
  const activeKey = personKey(activeName);
  if (!activeKey) return [];
  return [...(suggestions || [])]
    .filter((suggestion) => personKey(suggestion.personA) === activeKey || personKey(suggestion.personB) === activeKey)
    .sort((a, b) => b.score - a.score)
    .map((suggestion) => {
      const otherName = personKey(suggestion.personA) === activeKey ? suggestion.personB : suggestion.personA;
      const scorePercent = Math.round(Number(suggestion.score || 0) * 100);
      const countA = Number(suggestion.countA) || 0;
      const countB = Number(suggestion.countB) || 0;
      return {
        key: `${suggestion.personA}-${suggestion.personB}-${suggestion.score}`,
        activeName,
        otherName,
        summaryText: `${scorePercent}% ${duplicatePersonText(formatters, "similar across saved face photos")} · ${formatNumber(formatters, countA)} / ${formatNumber(formatters, countB)}`,
        scorePercent,
        countA,
        countB,
        suggestion,
      };
	    });
}

export function photoDuplicateSuggestionCountsByPerson(
  suggestions: readonly DuplicatePersonSuggestion[] | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  (suggestions || []).forEach((suggestion) => {
    const left = personKey(suggestion.personA);
    const right = personKey(suggestion.personB);
    if (left) counts.set(left, (counts.get(left) || 0) + 1);
    if (right) counts.set(right, (counts.get(right) || 0) + 1);
  });
  return counts;
}

export function buildPhotoDuplicateComparisonRows(
  group: PhotoDuplicateGroup | null | undefined,
  currentAssetId: string,
  fileName: (sourcePath: string) => string = fallbackFileName,
): PhotoDuplicateComparisonRow[] {
  if (!group?.items?.length) return [];
  return group.items.map((item) => {
    const sourcePath = String(item.sourcePath || "");
    const assetId = String(item.assetId || "");
    const isCurrent = Boolean(currentAssetId && assetId === currentAssetId);
    const isRecommended = Boolean(group.recommendedAssetId && assetId === group.recommendedAssetId);
    const badges = [
      isCurrent ? "Current" : "",
      isRecommended ? "Recommended keep" : "",
      String(item.reason || "").trim(),
    ].filter(Boolean);
    return {
      assetId,
      sourcePath,
      title: fileName(sourcePath || assetId),
      position: Number(item.position) || 0,
      reason: String(item.reason || ""),
      isCurrent,
      isRecommended,
      badges,
    };
  });
}

export function photoDuplicateRecommendationReasons(group: PhotoDuplicateGroup | null | undefined): string[] {
  return (group?.recommendationReasons || [])
    .map((reason) => String(reason || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function photoDuplicateGroupLabel(group: PhotoDuplicateGroup | null | undefined, uiText: (source: string) => string): string {
  if (!group) return uiText("None");
  if (group.algorithm === "exact_hash") return uiText("Exact duplicate");
  if (group.algorithm === "perceptual_dhash") return uiText("Near duplicate");
  return uiText("Duplicate group");
}

export function photoDuplicateRecommendationText(
  group: PhotoDuplicateGroup | null | undefined,
  currentAssetId: string,
  fileName: (sourcePath: string) => string,
  uiText: (source: string) => string,
): string {
  if (!group?.recommendedAssetId) return uiText("None");
  const target = group.recommendedAssetId === currentAssetId
    ? uiText("This photo")
    : fileName(group.recommendedSourcePath || group.recommendedAssetId);
  const reasons = (group.recommendationReasons || []).map((reason) => uiText(reason)).filter(Boolean).slice(0, 3);
  return reasons.length ? `${target} · ${reasons.join(", ")}` : target;
}

export function buildPhotoDuplicateBrowserReviewGroups(
  items: PhotoItem[] | null | undefined,
  selectedSourcePaths: Iterable<string> | null | undefined = [],
  fileName: (sourcePath: string) => string = fallbackFileName,
): PhotoDuplicateBrowserReviewGroup[] {
  if (!items?.length) return [];
  const selected = new Set([...(selectedSourcePaths || [])].map((sourcePath) => String(sourcePath || "")));
  const loadedByAssetId = new Map<string, { item: PhotoItem; index: number }>();
  const loadedBySourcePath = new Map<string, { item: PhotoItem; index: number }>();
  items.forEach((item, index) => {
    const assetId = String(item.assetId || "");
    const sourcePath = String(item.sourcePath || "");
    if (assetId && !loadedByAssetId.has(assetId)) loadedByAssetId.set(assetId, { item, index });
    if (sourcePath && !loadedBySourcePath.has(sourcePath)) loadedBySourcePath.set(sourcePath, { item, index });
  });

  const groups: PhotoDuplicateBrowserReviewGroup[] = [];
  const seenGroupIds = new Set<string>();
  items.forEach((item) => {
    const group = item.duplicateGroup;
    const groupId = String(group?.groupId || "");
    if (!group || !groupId || seenGroupIds.has(groupId)) return;
    seenGroupIds.add(groupId);
    const currentAssetId = String(item.assetId || group.primaryAssetId || group.items?.[0]?.assetId || "");
    const rows = buildPhotoDuplicateComparisonRows(group, currentAssetId, fileName).map((row) => {
      const loaded = (row.assetId && loadedByAssetId.get(row.assetId)) || (row.sourcePath && loadedBySourcePath.get(row.sourcePath)) || null;
      const loadedItem = loaded?.item || null;
      const sourcePath = String(loadedItem?.sourcePath || row.sourcePath || "");
      const isLoaded = Boolean(loadedItem);
      const isSelected = Boolean(sourcePath && selected.has(sourcePath));
      const title = String(loadedItem?.title || "").trim() || row.title || fileName(sourcePath || row.assetId);
      const displayBadges = [
        row.isRecommended ? "Recommended keep" : "",
        isSelected ? "Selected" : "",
        isLoaded ? "Loaded" : "",
        String(row.reason || "").trim(),
      ].filter(Boolean);
      return {
        ...row,
        sourcePath,
        title,
        previewUrl: String(loadedItem?.previewUrl || ""),
        sourceUrl: String(loadedItem?.sourceUrl || ""),
        mediaKind: String(loadedItem?.mediaKind || ""),
        isLoaded,
        isSelected,
        loadedIndex: loaded ? loaded.index : -1,
        displayBadges,
      };
    });
    const recommendedAssetId = String(group.recommendedAssetId || group.primaryAssetId || rows[0]?.assetId || "");
    const recommendedRow = rows.find((row) => row.assetId === recommendedAssetId) || rows.find((row) => row.isRecommended) || null;
    groups.push({
      group,
      groupId,
      algorithm: String(group.algorithm || ""),
      itemCount: Number(group.itemCount) || rows.length,
      representativeItem: item,
      recommendedAssetId,
      recommendedTitle: recommendedRow?.title || (group.recommendedSourcePath ? fileName(group.recommendedSourcePath) : recommendedAssetId),
      recommendationReasons: photoDuplicateRecommendationReasons(group),
      rows,
      loadedCount: rows.filter((row) => row.isLoaded).length,
      selectedCount: rows.filter((row) => row.isSelected).length,
    });
  });
  return groups;
}
