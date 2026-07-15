import type { ReactNode } from "react";
import { ArrowDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MinusCircle } from "lucide-react";

type PhotoOrderMove = "first" | "earlier" | "later" | "last";

type PhotoSelectionOrderControlsProps = {
  manualVisible: boolean;
  memoryVisible: boolean;
  selectedCount: number;
  total: number;
  busy: boolean;
  albumItemSaving: boolean;
  userMemorySaving: boolean;
  manualCanReorder: boolean;
  memoryCanReorder: boolean;
  albumOrderNotice: string;
  manualAlbumOrderGuardrail: string;
  customOrderPositionDraft: string;
  customOrderTargetPosition: number;
  uiText: (value: string) => string;
  onCustomOrderPositionChange: (value: string) => void;
  onMoveManual: (move: PhotoOrderMove) => void;
  onMoveManualToPosition: () => void;
  onRemoveFromManualAlbum: () => void;
  onMoveMemory: (move: PhotoOrderMove) => void;
  onMoveMemoryToPosition: () => void;
};

function PhotoOrderButton({
  label,
  disabled,
  children,
  onClick,
}: {
  label: string;
  disabled: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="secondary compact-action" onClick={onClick} disabled={disabled}>
      {children}
      <span>{label}</span>
    </button>
  );
}

function PhotoOrderMoveControls({
  canReorder,
  saving,
  busy,
  total,
  customOrderPositionDraft,
  customOrderTargetPosition,
  uiText,
  onCustomOrderPositionChange,
  onMove,
  onMoveToPosition,
}: {
  canReorder: boolean;
  saving: boolean;
  busy: boolean;
  total: number;
  customOrderPositionDraft: string;
  customOrderTargetPosition: number;
  uiText: (value: string) => string;
  onCustomOrderPositionChange: (value: string) => void;
  onMove: (move: PhotoOrderMove) => void;
  onMoveToPosition: () => void;
}) {
  const disabled = !canReorder || busy || saving;
  return (
    <div className="photo-album-order-control">
      <PhotoOrderButton label={uiText("Move first")} disabled={disabled} onClick={() => onMove("first")}>
        <ChevronsLeft size={14} />
      </PhotoOrderButton>
      <PhotoOrderButton label={uiText("Move earlier")} disabled={disabled} onClick={() => onMove("earlier")}>
        <ChevronLeft size={14} />
      </PhotoOrderButton>
      <PhotoOrderButton label={uiText("Move later")} disabled={disabled} onClick={() => onMove("later")}>
        <ChevronRight size={14} />
      </PhotoOrderButton>
      <PhotoOrderButton label={uiText("Move last")} disabled={disabled} onClick={() => onMove("last")}>
        <ChevronsRight size={14} />
      </PhotoOrderButton>
      <span className="photo-album-position-control">
        <input
          aria-label={uiText("Custom order position")}
          type="number"
          min="1"
          max={Math.max(1, total)}
          step="1"
          value={customOrderPositionDraft}
          onChange={(event) => onCustomOrderPositionChange(event.currentTarget.value)}
          placeholder={uiText("Position")}
          disabled={disabled}
        />
        <button
          type="button"
          className="secondary compact-action"
          onClick={onMoveToPosition}
          disabled={disabled || customOrderTargetPosition < 1}
        >
          <ArrowDown size={14} />
          <span>{uiText("Move to")}</span>
        </button>
      </span>
    </div>
  );
}

export function PhotoSelectionOrderControls({
  manualVisible,
  memoryVisible,
  selectedCount,
  total,
  busy,
  albumItemSaving,
  userMemorySaving,
  manualCanReorder,
  memoryCanReorder,
  albumOrderNotice,
  manualAlbumOrderGuardrail,
  customOrderPositionDraft,
  customOrderTargetPosition,
  uiText,
  onCustomOrderPositionChange,
  onMoveManual,
  onMoveManualToPosition,
  onRemoveFromManualAlbum,
  onMoveMemory,
  onMoveMemoryToPosition,
}: PhotoSelectionOrderControlsProps) {
  return (
    <>
      {manualVisible && (
        <>
          {(albumOrderNotice || manualAlbumOrderGuardrail) && (
            <small
              className={albumOrderNotice ? "photo-album-order-notice" : "photo-album-order-hint"}
              role={albumOrderNotice ? "status" : undefined}
              aria-live={albumOrderNotice ? "polite" : undefined}
            >
              {albumOrderNotice || manualAlbumOrderGuardrail}
            </small>
          )}
          <PhotoOrderMoveControls
            canReorder={manualCanReorder}
            saving={albumItemSaving}
            busy={busy}
            total={total}
            customOrderPositionDraft={customOrderPositionDraft}
            customOrderTargetPosition={customOrderTargetPosition}
            uiText={uiText}
            onCustomOrderPositionChange={onCustomOrderPositionChange}
            onMove={onMoveManual}
            onMoveToPosition={onMoveManualToPosition}
          />
          <button
            type="button"
            className="secondary compact-action"
            onClick={onRemoveFromManualAlbum}
            disabled={!selectedCount || busy || albumItemSaving}
          >
            <MinusCircle size={14} />
            <span>{uiText("Remove from album")}</span>
          </button>
        </>
      )}
      {memoryVisible && (
        <>
          <PhotoOrderMoveControls
            canReorder={memoryCanReorder}
            saving={userMemorySaving}
            busy={busy}
            total={total}
            customOrderPositionDraft={customOrderPositionDraft}
            customOrderTargetPosition={customOrderTargetPosition}
            uiText={uiText}
            onCustomOrderPositionChange={onCustomOrderPositionChange}
            onMove={onMoveMemory}
            onMoveToPosition={onMoveMemoryToPosition}
          />
        </>
      )}
    </>
  );
}
