import { Crop, SlidersHorizontal, Sparkles, X } from "lucide-react";

type PhotoSlideshowProjectFramingControlsProps = {
  selectedCount: number;
  focalX: number;
  focalY: number;
  cropZoom: number;
  faceFocalAvailable: boolean;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  onApplyMotion: () => void;
  onFocalXChange: (value: string) => void;
  onFocalYChange: (value: string) => void;
  onCropZoomChange: (value: string) => void;
  onApplyCrop: () => void;
  onUseFaceFocal: () => void;
  onClearCrop: () => void;
};

export function PhotoSlideshowProjectFramingControls({
  selectedCount,
  focalX,
  focalY,
  cropZoom,
  faceFocalAvailable,
  busy,
  slideshowLoading,
  uiText,
  onApplyMotion,
  onFocalXChange,
  onFocalYChange,
  onCropZoomChange,
  onApplyCrop,
  onUseFaceFocal,
  onClearCrop,
}: PhotoSlideshowProjectFramingControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      <button type="button" className="secondary compact-action" onClick={onApplyMotion} disabled={!selectedCount || disabled}>
        <SlidersHorizontal size={14} />
        <span>{uiText("Apply motion")}</span>
      </button>
      <label>
        <span>{uiText("Focal X")}</span>
        <input
          aria-label={uiText("Slideshow focal X")}
          type="number"
          min="0"
          max="100"
          step="1"
          value={focalX}
          onChange={(event) => onFocalXChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Focal Y")}</span>
        <input
          aria-label={uiText("Slideshow focal Y")}
          type="number"
          min="0"
          max="100"
          step="1"
          value={focalY}
          onChange={(event) => onFocalYChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Crop zoom")}</span>
        <input
          aria-label={uiText("Slideshow crop zoom")}
          type="number"
          min="1"
          max="3"
          step="0.05"
          value={cropZoom}
          onChange={(event) => onCropZoomChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <button type="button" className="secondary compact-action" onClick={onApplyCrop} disabled={!selectedCount || disabled}>
        <Crop size={14} />
        <span>{uiText("Apply crop")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onUseFaceFocal} disabled={!selectedCount || !faceFocalAvailable || disabled}>
        <Sparkles size={14} />
        <span>{uiText("Use face focal")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onClearCrop} disabled={!selectedCount || disabled}>
        <X size={14} />
        <span>{uiText("Clear crop")}</span>
      </button>
    </>
  );
}
