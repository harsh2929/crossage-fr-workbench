import type { PhotoItem } from "../types";
import { isVideoMediaKind } from "./photoMediaKind";
import { photoPeopleMatchCorrectionCandidateIds } from "./photoPeopleMatchSelection";

export interface PhotoSelectionStateInput {
  items: readonly PhotoItem[];
  selectedSources: Iterable<string>;
  activePersonName?: string;
  activeGroupActive?: boolean;
  activeGroupPeople?: readonly string[];
  activeGroupExcludedPeople?: readonly string[];
}

export interface PhotoSelectionState {
  selectedSourcePaths: string[];
  selectedItems: PhotoItem[];
  selectedImageEditPasteItems: PhotoItem[];
  selectedEditStackItems: PhotoItem[];
  selectedEditStackVersionItems: PhotoItem[];
  selectedFirstItem: PhotoItem | null;
  selectedFirstMissing: boolean;
  selectedConsolidatableSources: string[];
  selectedCandidateIds: string[];
  selectedMatchCandidateIds: string[];
  selectedDuplicateGroupIds: string[];
  selectedPathOnlySources: string[];
}

function uniqueStrings(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

export function buildPhotoSelectionState(input: PhotoSelectionStateInput): PhotoSelectionState {
  const selectedSourcePaths = uniqueStrings(input.selectedSources);
  const selectedSourceSet = new Set(selectedSourcePaths);
  const selectedItems = input.items.filter((item) => selectedSourceSet.has(item.sourcePath));
  const selectedImageEditPasteItems = selectedItems.filter((item) => !item.missingAt && !isVideoMediaKind(item.mediaKind));
  const selectedEditStackItems = selectedItems.filter((item) => !item.missingAt && item.hasEditStack);
  const selectedEditStackVersionItems = selectedItems.filter((item) => (
    !item.missingAt && (item.hasEditStackVersions || Number(item.editStackVersionCount || 0) > 0)
  ));
  const selectedFirstItem = selectedItems[0] || null;
  const selectedConsolidatableSources = selectedItems
    .filter((item) => !item.missingAt && String(item.sourceKind || "").toLowerCase() !== "managed" && !item.deletedAt)
    .map((item) => item.sourcePath);
  const selectedCandidateIds = uniqueStrings(selectedItems.flatMap((item) => item.candidateIds || []));
  const selectedMatchCandidateIds = input.activePersonName
    ? photoPeopleMatchCorrectionCandidateIds(selectedItems, { kind: "person", personName: input.activePersonName })
    : input.activeGroupActive
      ? photoPeopleMatchCorrectionCandidateIds(selectedItems, {
        kind: "group",
        memberPeople: [...(input.activeGroupPeople || [])],
        excludePeople: [...(input.activeGroupExcludedPeople || [])],
      })
      : photoPeopleMatchCorrectionCandidateIds(selectedItems);
  const selectedDuplicateGroupIds = uniqueStrings(selectedItems.map((item) => item.duplicateGroup?.groupId || ""));
  const selectedPathOnlySources = selectedItems
    .filter((item) => !(item.candidateIds || []).length)
    .map((item) => item.sourcePath);
  return {
    selectedSourcePaths,
    selectedItems,
    selectedImageEditPasteItems,
    selectedEditStackItems,
    selectedEditStackVersionItems,
    selectedFirstItem,
    selectedFirstMissing: Boolean(selectedFirstItem?.missingAt),
    selectedConsolidatableSources,
    selectedCandidateIds,
    selectedMatchCandidateIds,
    selectedDuplicateGroupIds,
    selectedPathOnlySources,
  };
}
