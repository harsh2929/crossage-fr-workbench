import { Ban, Flag, Minus, Star, X } from "lucide-react";
import { PHOTO_COLOR_LABELS, type PhotoColorLabel, type PhotoPickStatus } from "./photoProCulling";

type PhotoProCullingControlsProps = {
  rating: number | null;
  colorLabel: PhotoColorLabel | null;
  pickStatus: PhotoPickStatus | null;
  disabled?: boolean;
  compact?: boolean;
  uiText: (value: string) => string;
  onRatingChange: (rating: number) => unknown;
  onColorLabelChange: (label: PhotoColorLabel) => unknown;
  onPickStatusChange: (status: PhotoPickStatus) => unknown;
};

export function PhotoProCullingControls({
  rating,
  colorLabel,
  pickStatus,
  disabled = false,
  compact = false,
  uiText,
  onRatingChange,
  onColorLabelChange,
  onPickStatusChange,
}: PhotoProCullingControlsProps) {
  return (
    <div
      className={compact ? "photo-pro-curation-controls compact" : "photo-pro-curation-controls"}
      data-photo-pro-curation
    >
      <div className="photo-pro-rating" role="group" aria-label={uiText("Rating")}>
        <button
          type="button"
          className="photo-pro-icon-button clear"
          aria-label={uiText("Clear rating")}
          title={uiText("Clear rating")}
          aria-pressed={rating === 0}
          disabled={disabled}
          onClick={() => onRatingChange(0)}
        >
          <Minus size={14} />
        </button>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            type="button"
            key={value}
            className="photo-pro-icon-button star"
            aria-label={uiText(`${value} star${value === 1 ? "" : "s"}`)}
            title={uiText(`${value} star${value === 1 ? "" : "s"}`)}
            aria-pressed={rating === value}
            disabled={disabled}
            onClick={() => onRatingChange(value)}
          >
            <Star size={15} fill={rating !== null && rating >= value ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      <div className="photo-pro-color-labels" role="group" aria-label={uiText("Color label")}>
        {PHOTO_COLOR_LABELS.map((label) => {
          const labelText = label ? `${label[0].toUpperCase()}${label.slice(1)} label` : "Clear color label";
          return (
            <button
              type="button"
              key={label || "none"}
              className={`photo-pro-color-button ${label || "none"}`}
              aria-label={uiText(labelText)}
              title={uiText(labelText)}
              aria-pressed={colorLabel === label}
              disabled={disabled}
              onClick={() => onColorLabelChange(label)}
            >
              {label ? <span aria-hidden="true" /> : <Ban size={13} />}
            </button>
          );
        })}
      </div>
      <div className="photo-pro-pick-status" role="group" aria-label={uiText("Pick status")}>
        <button
          type="button"
          className="photo-pro-icon-button"
          aria-label={uiText("Unflag")}
          title={uiText("Unflag")}
          aria-pressed={pickStatus === ""}
          disabled={disabled}
          onClick={() => onPickStatusChange("")}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="photo-pro-icon-button pick"
          aria-label={uiText("Mark as pick")}
          title={uiText("Mark as pick")}
          aria-pressed={pickStatus === "pick"}
          disabled={disabled}
          onClick={() => onPickStatusChange("pick")}
        >
          <Flag size={14} fill={pickStatus === "pick" ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="photo-pro-icon-button reject"
          aria-label={uiText("Mark as reject")}
          title={uiText("Mark as reject")}
          aria-pressed={pickStatus === "reject"}
          disabled={disabled}
          onClick={() => onPickStatusChange("reject")}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
