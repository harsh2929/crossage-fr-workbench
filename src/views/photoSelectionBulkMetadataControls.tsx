import { CalendarDays, Check, Clock, FolderInput, MinusCircle, Tag, Users, X } from "lucide-react";
import type { PhotoFolder } from "../types";

type KeywordBulkAction = "add" | "remove";

type PhotoSelectionBulkMetadataControlsProps = {
  selectedCount: number;
  busy: boolean;
  savingMetadata: boolean;
  albumItemSaving: boolean;
  petSaving: boolean;
  bulkMatchSaving: boolean;
  people: readonly string[];
  selectedMatchCount: number;
  bulkMatchTarget: string;
  activePersonName: string;
  activeGroupName: string;
  personMatchError: string;
  petReviewActive: boolean;
  petAssignOptions: readonly string[];
  bulkPetAssignDraft: string;
  manualAlbums: readonly PhotoFolder[];
  manualAlbumTargetId: string;
  manualAlbumName: string;
  bulkKeywordsDraft: string;
  canApplyBulkKeywords: boolean;
  bulkDateOffsetDays: string;
  canOffsetDates: boolean;
  bulkTimezoneDraft: string;
  canSetTimezone: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onBulkMatchTargetChange: (value: string) => void;
  onReassignMatches: () => void;
  onRemoveMatches: () => void;
  onBulkPetAssignDraftChange: (value: string) => void;
  onAssignPetReviewItems: () => void;
  onDismissPetReviewItems: () => void;
  onManualAlbumTargetChange: (value: string) => void;
  onManualAlbumNameChange: (value: string) => void;
  onAddToManualAlbum: () => void;
  onBulkKeywordsDraftChange: (value: string) => void;
  onUpdateKeywords: (action: KeywordBulkAction) => void;
  onBulkDateOffsetDaysChange: (value: string) => void;
  onOffsetDates: () => void;
  onBulkTimezoneDraftChange: (value: string) => void;
  onCorrectTimezones: () => void;
};

export function PhotoSelectionBulkMetadataControls({
  selectedCount,
  busy,
  savingMetadata,
  albumItemSaving,
  petSaving,
  bulkMatchSaving,
  people,
  selectedMatchCount,
  bulkMatchTarget,
  activePersonName,
  activeGroupName,
  personMatchError,
  petReviewActive,
  petAssignOptions,
  bulkPetAssignDraft,
  manualAlbums,
  manualAlbumTargetId,
  manualAlbumName,
  bulkKeywordsDraft,
  canApplyBulkKeywords,
  bulkDateOffsetDays,
  canOffsetDates,
  bulkTimezoneDraft,
  canSetTimezone,
  uiText,
  formatCount,
  onBulkMatchTargetChange,
  onReassignMatches,
  onRemoveMatches,
  onBulkPetAssignDraftChange,
  onAssignPetReviewItems,
  onDismissPetReviewItems,
  onManualAlbumTargetChange,
  onManualAlbumNameChange,
  onAddToManualAlbum,
  onBulkKeywordsDraftChange,
  onUpdateKeywords,
  onBulkDateOffsetDaysChange,
  onOffsetDates,
  onBulkTimezoneDraftChange,
  onCorrectTimezones,
}: PhotoSelectionBulkMetadataControlsProps) {
  return (
    <>
      {selectedMatchCount > 0 && (
        <div className="photo-match-bulk-control">
          <input
            role="combobox"
            aria-autocomplete="none"
            aria-label={uiText("Move selected matches to person")}
            value={bulkMatchTarget}
            onChange={(event) => onBulkMatchTargetChange(event.currentTarget.value)}
            placeholder={uiText("Person name")}

            disabled={busy || bulkMatchSaving}
          />
          <button
            type="button"
            className="secondary compact-action"
            onClick={onReassignMatches}
            disabled={busy || bulkMatchSaving || !bulkMatchTarget.trim()}
          >
            <Users size={14} />
            <span>{bulkMatchSaving ? uiText("Saving matches") : uiText("Move matches")}</span>
          </button>
          <button
            type="button"
            className="ghost compact-action danger"
            onClick={onRemoveMatches}
            disabled={busy || bulkMatchSaving}
          >
            <X size={14} />
            <span>{uiText("Remove matches")}</span>
          </button>
          <small>
            {formatCount(selectedMatchCount)} {selectedMatchCount === 1 ? uiText("match") : uiText("matches")}
            {activePersonName ? ` · ${activePersonName}` : activeGroupName ? ` · ${activeGroupName}` : ""}
          </small>
        </div>
      )}
      {personMatchError && <small className="photo-metadata-error">{personMatchError}</small>}
      {petReviewActive && (
        <div className="photo-pet-bulk-control">
          <input
            role="combobox"
            aria-autocomplete="none"
            aria-label={uiText("Bulk pet name")}
            value={bulkPetAssignDraft}
            onChange={(event) => onBulkPetAssignDraftChange(event.currentTarget.value)}
            placeholder={uiText("Pet name")}

            disabled={busy || petSaving}
          />
          <button
            type="button"
            className="secondary compact-action"
            onClick={onAssignPetReviewItems}
            disabled={!selectedCount || busy || petSaving || !bulkPetAssignDraft.trim()}
          >
            <Check size={14} />
            <span>{petSaving ? uiText("Assigning pets") : uiText("Assign selected pets")}</span>
          </button>
          <button
            type="button"
            className="ghost compact-action"
            onClick={onDismissPetReviewItems}
            disabled={!selectedCount || busy || petSaving}
            aria-label={uiText("Dismiss selected Pet Review items")}
          >
            <X size={14} />
            <span>{petSaving ? uiText("Dismissing") : uiText("Not a pet")}</span>
          </button>
        </div>
      )}
      <div className="photo-add-album-control">
        <select
          aria-label={uiText("Manual album")}
          value={manualAlbumTargetId}
          onChange={(event) => onManualAlbumTargetChange(event.currentTarget.value)}
          disabled={busy || albumItemSaving}
        >
          <option value="">{uiText("New manual album")}</option>
          {manualAlbums.map((folder) => (
            <option key={folder.albumId || folder.id} value={folder.albumId || folder.id.replace(/^album:/, "")}>{folder.name}</option>
          ))}
        </select>
        {!manualAlbumTargetId && (
          <input
            aria-label={uiText("New manual album name")}
            value={manualAlbumName}
            onChange={(event) => onManualAlbumNameChange(event.currentTarget.value)}
            placeholder={uiText("Album name")}
            disabled={busy || albumItemSaving}
          />
        )}
        <button
          type="button"
          className="secondary compact-action"
          onClick={onAddToManualAlbum}
          disabled={!selectedCount || busy || albumItemSaving || (!manualAlbumTargetId && !manualAlbumName.trim())}
        >
          <FolderInput size={14} />
          <span>{uiText("Add to album")}</span>
        </button>
      </div>
      <div className="photo-keyword-bulk-control">
        <input
          aria-label={uiText("Bulk keywords")}
          value={bulkKeywordsDraft}
          onChange={(event) => onBulkKeywordsDraftChange(event.currentTarget.value)}
          placeholder={uiText("Keywords")}

          disabled={busy || savingMetadata}
        />
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => onUpdateKeywords("add")}
          disabled={!selectedCount || busy || savingMetadata || !canApplyBulkKeywords}
        >
          <Tag size={14} />
          <span>{uiText("Add keywords")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => onUpdateKeywords("remove")}
          disabled={!selectedCount || busy || savingMetadata || !canApplyBulkKeywords}
        >
          <MinusCircle size={14} />
          <span>{uiText("Remove keywords")}</span>
        </button>
      </div>
      <div className="photo-date-bulk-control">
        <input
          aria-label={uiText("Date offset days")}
          type="number"
          step="1"
          min="-36500"
          max="36500"
          value={bulkDateOffsetDays}
          onChange={(event) => onBulkDateOffsetDaysChange(event.currentTarget.value)}
          placeholder={uiText("Days")}
          disabled={busy || savingMetadata}
        />
        <button
          type="button"
          className="secondary compact-action"
          onClick={onOffsetDates}
          disabled={!selectedCount || busy || savingMetadata || !canOffsetDates}
        >
          <CalendarDays size={14} />
          <span>{uiText("Shift dates")}</span>
        </button>
      </div>
      <div className="photo-timezone-bulk-control">
        <input
          aria-label={uiText("Bulk timezone offset")}
          value={bulkTimezoneDraft}
          onChange={(event) => onBulkTimezoneDraftChange(event.currentTarget.value)}
          placeholder={uiText("Z or +05:30")}
          disabled={busy || savingMetadata}
        />
        <button
          type="button"
          className="secondary compact-action"
          onClick={onCorrectTimezones}
          disabled={!selectedCount || busy || savingMetadata || !canSetTimezone}
        >
          <Clock size={14} />
          <span>{uiText("Set timezone")}</span>
        </button>
      </div>
    </>
  );
}
