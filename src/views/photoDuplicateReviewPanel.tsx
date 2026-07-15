import type { MouseEvent } from "react";
import { Archive, Check, Image as ImageIcon, X } from "lucide-react";
import type { PhotoItem } from "../types";
import {
  photoDuplicateGroupLabel,
  type PhotoDuplicateBrowserReviewGroup,
  type PhotoDuplicateBrowserReviewRow,
} from "./photoDuplicateReview";

type PhotoDuplicateReviewPanelProps = {
  groups: PhotoDuplicateBrowserReviewGroup[];
  totalGroupCount: number;
  actionDisabled: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onMergeDuplicateGroup: (item: PhotoItem, keepAssetId?: string) => void;
  onDismissDuplicateGroup: (item: PhotoItem) => void;
  onToggleSource: (sourcePath: string) => void;
  onOpenRow: (loadedIndex: number, trigger: HTMLButtonElement) => void;
};

type PhotoDuplicateReviewRowProps = {
  group: PhotoDuplicateBrowserReviewGroup;
  row: PhotoDuplicateBrowserReviewRow;
  actionDisabled: boolean;
  uiText: (value: string) => string;
  onMergeDuplicateGroup: (item: PhotoItem, keepAssetId?: string) => void;
  onToggleSource: (sourcePath: string) => void;
  onOpenRow: (loadedIndex: number, trigger: HTMLButtonElement) => void;
};

function PhotoDuplicateReviewRow({
  group,
  row,
  actionDisabled,
  uiText,
  onMergeDuplicateGroup,
  onToggleSource,
  onOpenRow,
}: PhotoDuplicateReviewRowProps) {
  const imageUrl = row.previewUrl || row.sourceUrl;
  const openRow = (event: MouseEvent<HTMLButtonElement>) => {
    if (row.loadedIndex < 0) return;
    onOpenRow(row.loadedIndex, event.currentTarget);
  };

  return (
    <div className={`photos-duplicate-review-row${row.isRecommended ? " is-recommended" : ""}${row.isSelected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="photos-duplicate-review-open"
        onClick={openRow}
        disabled={row.loadedIndex < 0}
        title={row.sourcePath || row.assetId}
      >
        <span className="photos-duplicate-review-thumb">
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <ImageIcon size={18} />
          )}
        </span>
        <span className="photos-duplicate-review-copy">
          <strong>{row.title}</strong>
          <span>
            {row.displayBadges.map((badge) => <small key={badge}>{uiText(badge)}</small>)}
          </span>
        </span>
      </button>
      <div className="photos-duplicate-review-row-actions">
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => onMergeDuplicateGroup(group.representativeItem, row.assetId)}
          disabled={actionDisabled || !row.assetId}
        >
          <Archive size={13} />
          <span>{row.isRecommended ? uiText("Keep recommended") : uiText("Keep this")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={() => onToggleSource(row.sourcePath)}
          disabled={!row.isLoaded || !row.sourcePath}
        >
          <Check size={13} />
          <span>{row.isSelected ? uiText("Selected") : uiText("Select")}</span>
        </button>
      </div>
    </div>
  );
}

export function PhotoDuplicateReviewPanel({
  groups,
  totalGroupCount,
  actionDisabled,
  uiText,
  formatCount,
  onMergeDuplicateGroup,
  onDismissDuplicateGroup,
  onToggleSource,
  onOpenRow,
}: PhotoDuplicateReviewPanelProps) {
  if (!groups.length) return null;

  return (
    <section className="photos-duplicate-review-panel" aria-label={uiText("Duplicate review")}>
      <div className="photos-duplicate-review-head">
        <span>
          <Archive size={15} />
          <strong>{uiText("Duplicate review")}</strong>
        </span>
        <small>
          {formatCount(totalGroupCount)} {totalGroupCount === 1 ? uiText("loaded group") : uiText("loaded groups")}
          {totalGroupCount > groups.length ? ` · ${uiText("showing")} ${formatCount(groups.length)}` : ""}
        </small>
      </div>
      <div className="photos-duplicate-review-list">
        {groups.map((group) => (
          <article key={group.groupId} className="photos-duplicate-review-card">
            <div className="photos-duplicate-review-card-head">
              <div>
                <strong>{photoDuplicateGroupLabel(group.group, uiText)}</strong>
                <small>
                  {formatCount(group.itemCount)} {group.itemCount === 1 ? uiText("item") : uiText("items")}
                  {" · "}
                  {formatCount(group.loadedCount)} {uiText("loaded")}
                  {group.selectedCount ? ` · ${formatCount(group.selectedCount)} ${uiText("selected")}` : ""}
                </small>
                {group.recommendedTitle && (
                  <small>{uiText("Recommended keep")}: {group.recommendedTitle}</small>
                )}
              </div>
              <div className="photos-duplicate-review-actions">
                <button
                  type="button"
                  className="secondary compact-action"
                  onClick={() => onMergeDuplicateGroup(group.representativeItem, group.recommendedAssetId)}
                  disabled={actionDisabled || !group.recommendedAssetId}
                >
                  <Check size={14} />
                  <span>{uiText("Keep recommended")}</span>
                </button>
                <button
                  type="button"
                  className="ghost compact-action"
                  onClick={() => onDismissDuplicateGroup(group.representativeItem)}
                  disabled={actionDisabled}
                >
                  <X size={14} />
                  <span>{uiText("Dismiss")}</span>
                </button>
              </div>
            </div>
            {group.recommendationReasons.length > 0 && (
              <div className="photos-duplicate-review-reasons">
                {group.recommendationReasons.map((reason) => <span key={reason}>{uiText(reason)}</span>)}
              </div>
            )}
            <div className="photos-duplicate-review-rows">
              {group.rows.map((row) => (
                <PhotoDuplicateReviewRow
                  key={row.assetId || row.sourcePath}
                  group={group}
                  row={row}
                  actionDisabled={actionDisabled}
                  uiText={uiText}
                  onMergeDuplicateGroup={onMergeDuplicateGroup}
                  onToggleSource={onToggleSource}
                  onOpenRow={onOpenRow}
                />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
