import type { CandidateStatus, PhotoFolder, ReviewCandidate } from "../types";

export const PHOTO_STATUS_FILTERS: CandidateStatus[] = ["pending", "accepted", "uncertain", "rejected"];

export interface PhotoGroupReviewInput {
  candidates?: ReviewCandidate[] | null;
  memberPeople?: string[] | null;
  excludePeople?: string[] | null;
  statuses?: CandidateStatus[];
  minScore?: number | null;
}

export interface PhotoPersonReviewInput {
  candidates?: ReviewCandidate[] | null;
  personName?: unknown;
  statuses?: CandidateStatus[];
  minScore?: number | null;
}

export interface PhotoPersonMergePreview {
  sourceCount: number;
  targetCount: number;
  sourceReviewCount: number;
  targetReviewCount: number;
}

export interface PhotoPeopleGalleryStateInput {
  people?: PhotoFolder[] | null;
  pets?: PhotoFolder[] | null;
  groups?: PhotoFolder[] | null;
  railFolders?: PhotoFolder[] | null;
  folders?: PhotoFolder[] | null;
  reviewPending?: number | null;
}

export interface PhotoPeopleGalleryState {
  namedPeople: PhotoFolder[];
  pets: PhotoFolder[];
  groups: PhotoFolder[];
  unknownClusters: PhotoFolder[];
  petReviewFolder: PhotoFolder | null;
  favoritePeople: PhotoFolder[];
  favoritePets: PhotoFolder[];
  reviewPending: number;
  hasAny: boolean;
}

export interface PhotoPeopleManagementLists {
  people: PhotoFolder[];
  groups: PhotoFolder[];
  pets: PhotoFolder[];
}

export type PhotoPeopleRailOrderKind = "person" | "group";
export type PhotoPeopleRailDropPlacement = "before" | "after";

export interface PhotoPersonRailOrderPayload extends Record<string, unknown> {
  personName: string;
  manualOrder: number;
}

export interface PhotoSavedGroupRailOrderPayload extends Record<string, unknown> {
  groupId: string;
  name: string;
  memberPeople: string[];
  excludePeople: string[];
  memberPets: string[];
  excludePets: string[];
  manualOrder: number;
}

export interface PhotoPetReviewItemPayload extends Record<string, unknown> {
  assetId: string;
  sourcePath: string;
}

export interface PhotoPetAssignPayload extends PhotoPetReviewItemPayload {
  petName: string;
}

export interface PhotoPetBulkAssignPayload extends Record<string, unknown> {
  petName: string;
  items: PhotoPetReviewItemPayload[];
}

export interface PhotoPetBulkDismissPayload extends Record<string, unknown> {
  petKind: string;
  items: PhotoPetReviewItemPayload[];
}

export interface PhotoPeopleRailDragStateDraft {
  draggedId: string;
  targetId?: string;
  placement?: PhotoPeopleRailDropPlacement;
  kind: PhotoPeopleRailOrderKind;
  valid?: boolean;
}

export interface PhotoReviewMoreCandidateRow {
  candidate: ReviewCandidate;
  candidateId: string;
  personName: string;
  sourceName: string;
  detailText: string;
  reasons: string[];
  status: CandidateStatus;
}

export interface PhotoReviewMoreCandidateRowFormatters {
  fileName?: (value: string) => string;
}

export const PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT = 6;

function cleanPhotoPetPayloadText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function defaultFileName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function normalizedPersonName(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function photoPetDisplayName(folder: PhotoFolder): string {
  return folder.petName || folder.name;
}

function photoSortedUniqueNames(values: Iterable<unknown>): string[] {
  const names = new Set<string>();
  for (const value of values) {
    const name = String(value || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function photoPetReviewItemPayload(item: {
  assetId?: unknown;
  sourcePath?: unknown;
} | null | undefined): PhotoPetReviewItemPayload {
  return {
    assetId: cleanPhotoPetPayloadText(item?.assetId),
    sourcePath: cleanPhotoPetPayloadText(item?.sourcePath),
  };
}

export function photoPetAssignPayload(
  item: { assetId?: unknown; sourcePath?: unknown } | null | undefined,
  petName: unknown,
): PhotoPetAssignPayload {
  return {
    ...photoPetReviewItemPayload(item),
    petName: cleanPhotoPetPayloadText(petName),
  };
}

export function photoPetBulkAssignPayload(
  items: Array<{ assetId?: unknown; sourcePath?: unknown }> | null | undefined,
  petName: unknown,
): PhotoPetBulkAssignPayload {
  return {
    petName: cleanPhotoPetPayloadText(petName),
    items: (items || []).map(photoPetReviewItemPayload),
  };
}

export function photoPetBulkDismissPayload(
  items: Array<{ assetId?: unknown; sourcePath?: unknown }> | null | undefined,
  petKind: unknown,
): PhotoPetBulkDismissPayload {
  return {
    petKind: cleanPhotoPetPayloadText(petKind),
    items: (items || []).map(photoPetReviewItemPayload),
  };
}

function normalizedNameSet(values: string[] | null | undefined): Set<string> {
  return new Set(
    (values || [])
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .filter(Boolean)
  );
}

export function parsePhotoPeopleDraft(value: string): string[] {
  const people: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[,;\n]/)) {
    const person = raw.trim().replace(/\s+/g, " ");
    const key = person.toLowerCase();
    if (!person || seen.has(key)) continue;
    seen.add(key);
    people.push(person);
  }
  return people;
}

export function photoPeopleDraftValue(values?: string[]): string {
  return (values || []).filter(Boolean).join(", ");
}

export function savedPeopleGroupId(folder: PhotoFolder): string {
  if (folder.kind !== "group") return "";
  return folder.groupId || (folder.id.startsWith("group:saved:") ? folder.id.slice("group:saved:".length) : "");
}

export function photoPeopleRailItemKind(folder: PhotoFolder): PhotoPeopleRailOrderKind | "" {
  if (folder.kind === "person") return "person";
  if (savedPeopleGroupId(folder)) return "group";
  return "";
}

export function photoPeopleRailMoveOrder(
  sectionFolders: PhotoFolder[],
  folder: PhotoFolder | null | undefined,
  direction: "up" | "down",
): PhotoFolder[] | null {
  const kind = folder ? photoPeopleRailItemKind(folder) : "";
  if (!folder || !kind) return null;
  const candidates = sectionFolders.filter((item) => photoPeopleRailItemKind(item) === kind);
  const currentIndex = candidates.findIndex((item) => item.id === folder.id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= candidates.length) return null;
  const next = [...candidates];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function photoPeopleRailDropOrder(
  sectionFolders: PhotoFolder[],
  draggedId: string,
  targetId: string,
  placement: PhotoPeopleRailDropPlacement,
  kind: PhotoPeopleRailOrderKind | "",
): PhotoFolder[] | null {
  if (!draggedId || !targetId || !kind || draggedId === targetId) return null;
  const candidates = sectionFolders.filter((folder) => photoPeopleRailItemKind(folder) === kind);
  const draggedIndex = candidates.findIndex((folder) => folder.id === draggedId);
  const targetIndex = candidates.findIndex((folder) => folder.id === targetId);
  if (draggedIndex < 0 || targetIndex < 0) return null;
  const next = [...candidates];
  const [moved] = next.splice(draggedIndex, 1);
  const adjustedTargetIndex = next.findIndex((folder) => folder.id === targetId);
  if (adjustedTargetIndex < 0) return null;
  const insertIndex = placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(Math.max(0, insertIndex), 0, moved);
  return next;
}

export function photoPeopleRailDropPlacementFromRatio(ratio: number): PhotoPeopleRailDropPlacement {
  return Number.isFinite(ratio) && ratio < 0.5 ? "before" : "after";
}

export function photoPeopleRailDropPlacementFromBounds(clientY: number, top: number, height: number): PhotoPeopleRailDropPlacement {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  return photoPeopleRailDropPlacementFromRatio(ratio);
}

export function photoPeopleRailDragTargetState(
  current: PhotoPeopleRailDragStateDraft | null | undefined,
  folder: PhotoFolder,
  draggedId: string,
  draggedKind: PhotoPeopleRailOrderKind | "",
  placement: PhotoPeopleRailDropPlacement,
): PhotoPeopleRailDragStateDraft | null {
  if (!draggedId || !draggedKind) return null;
  const targetKind = photoPeopleRailItemKind(folder);
  const valid = Boolean(targetKind && targetKind === draggedKind && folder.id !== draggedId);
  const base = current || { draggedId, kind: draggedKind };
  if (current && current.targetId === folder.id && current.placement === placement && current.valid === valid) return current;
  return { ...base, targetId: folder.id, placement, valid };
}

export function photoPersonRailOrderPayloads(folders: PhotoFolder[]): PhotoPersonRailOrderPayload[] {
  return folders
    .filter((folder) => folder.kind === "person")
    .map((personFolder, index) => ({
      personName: personFolder.name,
      manualOrder: index,
    }));
}

export function photoSavedGroupRailOrderPayloads(folders: PhotoFolder[]): PhotoSavedGroupRailOrderPayload[] {
  return folders
    .map((groupFolder, index) => {
      const groupId = savedPeopleGroupId(groupFolder);
      if (!groupId) return null;
      return {
        groupId,
        name: groupFolder.name,
        memberPeople: groupFolder.groupProfile?.memberPeople || groupFolder.groupPeople || [],
        excludePeople: groupFolder.groupProfile?.excludePeople || groupFolder.excludePeople || [],
        memberPets: groupFolder.groupProfile?.memberPets || groupFolder.groupPets || [],
        excludePets: groupFolder.groupProfile?.excludePets || groupFolder.excludePets || [],
        manualOrder: index,
      };
    })
    .filter((payload): payload is PhotoSavedGroupRailOrderPayload => Boolean(payload));
}

export function photoStatusFilterLabel(status: CandidateStatus): string {
  if (status === "pending") return "Needs review";
  if (status === "accepted") return "Accepted";
  if (status === "uncertain") return "Not sure";
  return "Rejected";
}

export function buildPhotoPeopleManagementLists(folders: readonly PhotoFolder[] | null | undefined): PhotoPeopleManagementLists {
  const source = [...(folders || [])];
  const people = source
    .filter((folder) => folder.kind === "person")
    .sort((a, b) => {
      const aOrder = a.personProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.personProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      return (
        Number(Boolean(b.personProfile?.favorite)) - Number(Boolean(a.personProfile?.favorite)) ||
        Number(Boolean(a.personProfile?.hidden)) - Number(Boolean(b.personProfile?.hidden)) ||
        aOrder - bOrder ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
      );
    });
  const groups = source
    .filter((folder) => folder.kind === "group")
    .sort((a, b) => {
      const aProfile = a.groupProfile;
      const bProfile = b.groupProfile;
      const aOrder = aProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = bProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      return (
        Number(Boolean(bProfile?.favorite)) - Number(Boolean(aProfile?.favorite)) ||
        Number(Boolean(aProfile?.hidden)) - Number(Boolean(bProfile?.hidden)) ||
        Number(a.groupSource !== "saved") - Number(b.groupSource !== "saved") ||
        aOrder - bOrder ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
      );
    });
  const pets = source
    .filter((folder) => folder.kind === "pet")
    .sort((a, b) => {
      const aProfile = a.petProfile;
      const bProfile = b.petProfile;
      const aOrder = aProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = bProfile?.manualOrder ?? Number.MAX_SAFE_INTEGER;
      return (
        Number(Boolean(bProfile?.favorite)) - Number(Boolean(aProfile?.favorite)) ||
        Number(Boolean(aProfile?.hidden)) - Number(Boolean(bProfile?.hidden)) ||
        aOrder - bOrder ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
      );
    });
  return { people, groups, pets };
}

export function photoPersonFilterOptions(people: readonly unknown[] | null | undefined): string[] {
  return photoSortedUniqueNames(people || []);
}

export function photoPetGroupOptions(folders: readonly PhotoFolder[] | null | undefined): string[] {
  return photoSortedUniqueNames((folders || [])
    .filter((folder) => folder.kind === "pet")
    .map((folder) => photoPetDisplayName(folder)));
}

export function photoPetAssignOptions(
  petGroupOptions: readonly unknown[] | null | undefined,
  peopleManagementFolders: readonly PhotoFolder[] | null | undefined,
): string[] {
  return photoSortedUniqueNames([
    ...(petGroupOptions || []),
    ...(peopleManagementFolders || [])
      .filter((folder) => folder.kind === "pet")
      .map((folder) => photoPetDisplayName(folder)),
  ]);
}

export function photoPetRenameOptions(
  peopleManagementPets: readonly PhotoFolder[] | null | undefined,
  folders: readonly PhotoFolder[] | null | undefined,
): PhotoFolder[] {
  const byKey = new Map<string, PhotoFolder>();
  for (const folder of [...(peopleManagementPets || []), ...(folders || []).filter((candidate) => candidate.kind === "pet")]) {
    const name = photoPetDisplayName(folder).trim();
    if (name) byKey.set(name.toLowerCase(), folder);
  }
  return Array.from(byKey.values()).sort((a, b) => photoPetDisplayName(a).localeCompare(photoPetDisplayName(b)));
}

export function photoPetRenameTargetExists(
  activePet: PhotoFolder | null | undefined,
  draftName: unknown,
  options: readonly PhotoFolder[] | null | undefined,
): boolean {
  const draft = String(draftName || "").trim().toLowerCase();
  const activeName = String(activePet?.name || "").trim().toLowerCase();
  return Boolean(activePet && draft && (options || []).some((pet) => {
    const optionName = photoPetDisplayName(pet).trim().toLowerCase();
    return optionName === draft && optionName !== activeName;
  }));
}

export function buildPhotoPeopleGalleryState(input: PhotoPeopleGalleryStateInput): PhotoPeopleGalleryState {
  const namedPeople = (input.people || []).filter((folder) => !folder.personProfile?.hidden);
  const pets = (input.pets || []).filter((folder) => !folder.petProfile?.hidden);
  const groups = (input.groups || []).filter((folder) => !folder.groupProfile?.hidden);
  const unknownClusters = (input.railFolders || []).filter((folder) => folder.kind === "unknown");
  const petReviewFolder = (input.folders || []).find((folder) => folder.id === "petReview") || null;
  const petReviewVisible = Boolean(petReviewFolder && (Number(petReviewFolder.count) || 0) > 0);
  const reviewPending = Math.max(0, Math.floor(Number(input.reviewPending) || 0));
  return {
    namedPeople,
    pets,
    groups,
    unknownClusters,
    petReviewFolder,
    favoritePeople: namedPeople.filter((folder) => folder.personProfile?.favorite),
    favoritePets: pets.filter((folder) => folder.petProfile?.favorite),
    reviewPending,
    hasAny: namedPeople.length > 0 || pets.length > 0 || groups.length > 0 || unknownClusters.length > 0 || petReviewVisible,
  };
}

function cleanNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scorePercent(value: unknown): string {
  return `${Math.round(Math.max(0, Math.min(1, cleanNumber(value))) * 100)}%`;
}

export function photoReviewMoreMinScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function photoReviewMoreCandidateMatchesThreshold(candidate: ReviewCandidate, minScore: unknown): boolean {
  const threshold = photoReviewMoreMinScore(minScore);
  return threshold <= 0 || cleanNumber(candidate.score) >= threshold;
}

export function photoReviewMoreCandidateReasons(candidate: ReviewCandidate): string[] {
  const provenance = candidate.reviewMoreProvenance && typeof candidate.reviewMoreProvenance === "object"
    ? candidate.reviewMoreProvenance
    : {};
  const kind = String(provenance.kind || "").trim();
  const band = String(provenance.band || candidate.band || "").trim();
  const status = String(provenance.status || candidate.status || "").trim();
  const bestRefId = String(provenance.bestRefId || candidate.bestRefId || "").trim();
  const bestRefPath = String(provenance.bestRefPath || candidate.bestRefPath || "").trim();
  return [
    kind === "nearest_neighbor_review_more" ? "Nearest match" : "",
    `score ${scorePercent(provenance.score ?? candidate.score)}`,
    `quality ${scorePercent(provenance.quality ?? candidate.quality)}`,
    band,
    status,
    bestRefId || bestRefPath ? "best reference" : "",
  ].filter(Boolean).slice(0, 6);
}

export function photoReviewMoreCandidateRow(
  candidate: ReviewCandidate,
  formatters: PhotoReviewMoreCandidateRowFormatters = {},
): PhotoReviewMoreCandidateRow {
  const sourceName = formatters.fileName?.(candidate.sourcePath) || defaultFileName(candidate.sourcePath);
  return {
    candidate,
    candidateId: candidate.candidateId,
    personName: candidate.personName,
    sourceName,
    detailText: `${sourceName} · ${photoStatusFilterLabel(candidate.status)} · ${scorePercent(candidate.score)}`,
    reasons: photoReviewMoreCandidateReasons(candidate),
    status: candidate.status,
  };
}

export function photoReviewMoreCandidateRows(
  candidates: readonly ReviewCandidate[],
  formatters: PhotoReviewMoreCandidateRowFormatters = {},
  limit = PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT,
): PhotoReviewMoreCandidateRow[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT;
  return candidates.slice(0, cappedLimit).map((candidate) => photoReviewMoreCandidateRow(candidate, formatters));
}

export function photoReviewMoreCandidateOverflowCount(
  candidates: readonly ReviewCandidate[],
  limit = PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT,
): number {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT;
  return Math.max(0, candidates.length - cappedLimit);
}

export function buildPhotoPersonReviewCandidates(input: PhotoPersonReviewInput): ReviewCandidate[] {
  const personName = normalizedPersonName(input.personName);
  if (!personName) return [];
  const statuses = new Set<CandidateStatus>(input.statuses?.length ? input.statuses : ["pending", "uncertain"]);
  const minScore = photoReviewMoreMinScore(input.minScore);
  return (input.candidates || [])
    .filter((candidate) => normalizedPersonName(candidate.personName) === personName)
    .filter((candidate) => statuses.has(candidate.status))
    .filter((candidate) => minScore <= 0 || cleanNumber(candidate.score) >= minScore)
    .sort((a, b) => b.score - a.score || b.quality - a.quality || a.candidateId.localeCompare(b.candidateId));
}

export function photoReviewCandidateCountsByPerson(
  candidates: readonly ReviewCandidate[] | null | undefined,
  statuses: readonly CandidateStatus[] = ["pending", "uncertain"],
): Map<string, number> {
  const allowedStatuses = new Set(statuses);
  const counts = new Map<string, number>();
  (candidates || []).forEach((candidate) => {
    if (!allowedStatuses.has(candidate.status)) return;
    const key = normalizedPersonName(candidate.personName);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

export function photoPersonFolderLookup(folders: readonly PhotoFolder[] | null | undefined): Map<string, PhotoFolder> {
  const byName = new Map<string, PhotoFolder>();
  for (const folder of folders || []) {
    if (folder.kind !== "person") continue;
    const key = normalizedPersonName(folder.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, folder);
  }
  return byName;
}

export function photoPersonMergePreview(
  sourceName: unknown,
  targetName: unknown,
  personLookup: ReadonlyMap<string, PhotoFolder>,
  reviewCounts: ReadonlyMap<string, number>,
): PhotoPersonMergePreview | null {
  const sourceKey = normalizedPersonName(sourceName);
  const targetKey = normalizedPersonName(targetName);
  if (!sourceKey || !targetKey || sourceKey === targetKey) return null;
  const target = personLookup.get(targetKey);
  if (!target) return null;
  const source = personLookup.get(sourceKey);
  return {
    sourceCount: source?.count ?? 0,
    targetCount: target.count,
    sourceReviewCount: reviewCounts.get(sourceKey) || 0,
    targetReviewCount: reviewCounts.get(targetKey) || 0,
  };
}

export function buildPhotoGroupReviewCandidates(input: PhotoGroupReviewInput): ReviewCandidate[] {
  const includePeople = normalizedNameSet(input.memberPeople);
  if (!includePeople.size) return [];
  const excludePeople = normalizedNameSet(input.excludePeople);
  const statuses = new Set<CandidateStatus>(input.statuses?.length ? input.statuses : ["pending", "uncertain"]);
  const minScore = photoReviewMoreMinScore(input.minScore);
  const seen = new Set<string>();
  return (input.candidates || [])
    .filter((candidate) => {
      const candidateId = String(candidate.candidateId || "").trim();
      const personName = String(candidate.personName || "").trim().toLocaleLowerCase();
      if (!candidateId || seen.has(candidateId)) return false;
      if (!statuses.has(candidate.status)) return false;
      if (!photoReviewMoreCandidateMatchesThreshold(candidate, minScore)) return false;
      if (!includePeople.has(personName) || excludePeople.has(personName)) return false;
      seen.add(candidateId);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.quality - a.quality || a.candidateId.localeCompare(b.candidateId));
}
