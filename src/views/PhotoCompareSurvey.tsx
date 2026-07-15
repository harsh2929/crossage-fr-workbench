import { Columns2, Grid2X2, Image as ImageIcon, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PhotoItem } from "../types";
import { PhotoProCullingControls } from "./PhotoProCullingControls";
import { normalizePhotoColorLabel, normalizePhotoPickStatus, normalizePhotoRating, type PhotoProCurationPatch } from "./photoProCulling";
import "./photoCompareSurvey.css";

export type PhotoCompareMode = "compare" | "survey";

type PhotoCompareSurveyProps = {
  open: boolean;
  items: readonly PhotoItem[];
  mode: PhotoCompareMode;
  activeSourcePath: string;
  saving: boolean;
  uiText: (value: string) => string;
  onModeChange: (mode: PhotoCompareMode) => void;
  onActiveSourcePathChange: (sourcePath: string) => void;
  onCurationChange: (item: PhotoItem, patch: PhotoProCurationPatch) => unknown;
  onClose: () => void;
};

export function PhotoCompareSurvey({
  open,
  items,
  mode,
  activeSourcePath,
  saving,
  uiText,
  onModeChange,
  onActiveSourcePathChange,
  onCurationChange,
  onClose,
}: PhotoCompareSurveyProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const visibleItems = useMemo(() => items.slice(0, mode === "compare" ? 2 : 12), [items, mode]);
  const activeItem = visibleItems.find((item) => item.sourcePath === activeSourcePath) || visibleItems[0] || null;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open && activeItem && activeItem.sourcePath !== activeSourcePath) {
      onActiveSourcePathChange(activeItem.sourcePath);
    }
  }, [activeItem, activeSourcePath, onActiveSourcePathChange, open]);

  if (!open || !activeItem) return null;

  function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    )).filter((node) => node.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (event.shiftKey && (!active || active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="photo-compare-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        ref={dialogRef}
        className="photo-compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-compare-title"
        tabIndex={-1}
        onKeyDown={trapDialogFocus}
      >
        <header className="photo-compare-toolbar">
          <h2 id="photo-compare-title">{uiText(mode === "compare" ? "Compare" : "Survey")}</h2>
          <div className="photo-compare-mode" role="tablist" aria-label={uiText("Culling view")}>
            <button type="button" role="tab" aria-selected={mode === "compare"} onClick={() => onModeChange("compare")}>
              <Columns2 size={16} />
              <span>{uiText("Compare")}</span>
            </button>
            <button type="button" role="tab" aria-selected={mode === "survey"} onClick={() => onModeChange("survey")}>
              <Grid2X2 size={16} />
              <span>{uiText("Survey")}</span>
            </button>
          </div>
          <PhotoProCullingControls
            compact
            rating={normalizePhotoRating(activeItem.rating)}
            colorLabel={normalizePhotoColorLabel(activeItem.colorLabel)}
            pickStatus={normalizePhotoPickStatus(activeItem.pickStatus)}
            disabled={saving}
            uiText={uiText}
            onRatingChange={(rating) => onCurationChange(activeItem, { rating })}
            onColorLabelChange={(colorLabel) => onCurationChange(activeItem, { colorLabel })}
            onPickStatusChange={(pickStatus) => onCurationChange(activeItem, { pickStatus })}
          />
          <button ref={closeRef} type="button" className="photo-compare-close" onClick={onClose} aria-label={uiText("Close")} title={uiText("Close")}>
            <X size={18} />
          </button>
        </header>
        <div className={`photo-compare-grid ${mode}`} data-mode={mode}>
          {visibleItems.map((item, index) => {
            const active = item.sourcePath === activeItem.sourcePath;
            const previewUrl = String(item.previewUrl || item.sourceUrl || "");
            const rating = normalizePhotoRating(item.rating);
            const colorLabel = normalizePhotoColorLabel(item.colorLabel);
            const pickStatus = normalizePhotoPickStatus(item.pickStatus);
            const itemTitle = item.title || item.sourcePath.split(/[\\/]/).pop() || `${uiText("Photo")} ${index + 1}`;
            return (
              <button
                type="button"
                key={item.assetId || item.sourcePath}
                className={`photo-compare-tile${active ? " active" : ""}${pickStatus === "reject" ? " rejected" : ""}`}
                aria-pressed={active}
                onClick={() => onActiveSourcePathChange(item.sourcePath)}
              >
                <span className="photo-compare-media">
                  {previewUrl ? <img src={previewUrl} alt="" draggable={false} /> : <ImageIcon size={36} />}
                </span>
                <span className="photo-compare-meta">
                  <strong title={itemTitle}>{itemTitle}</strong>
                  <span className="photo-compare-badges">
                    {rating > 0 && <span><Star size={13} fill="currentColor" />{rating}</span>}
                    {colorLabel && <i className={`photo-pro-label-dot ${colorLabel}`} aria-label={uiText(`${colorLabel[0].toUpperCase()}${colorLabel.slice(1)} label`)} />}
                    {pickStatus && <span className={pickStatus}>{uiText(pickStatus === "pick" ? "Pick" : "Reject")}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <footer className="photo-compare-footer">
          <span>{visibleItems.length} / {items.length}</span>
        </footer>
      </section>
    </div>
  );
}
