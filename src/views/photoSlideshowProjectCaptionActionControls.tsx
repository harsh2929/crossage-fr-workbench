import { Layers, SlidersHorizontal, TextCursorInput, X } from "lucide-react";
import type { PhotoSlideshowTransitionEffect } from "./photoSlideshowProjects";

type PhotoSlideshowProjectCaptionActionControlsProps = {
  selectedCount: number;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  onApplyCaption: () => void;
  onApplyCaptionPreset: () => void;
  onClearCaption: () => void;
  onTransitionEffectChange: (value: PhotoSlideshowTransitionEffect) => void;
  onTransitionDurationMsChange: (value: number) => void;
  onApplyTransition: () => void;
  onClearTransition: () => void;
};

export function PhotoSlideshowProjectCaptionActionControls({
  selectedCount,
  transitionEffect,
  transitionDurationMs,
  busy,
  slideshowLoading,
  uiText,
  onApplyCaption,
  onApplyCaptionPreset,
  onClearCaption,
  onTransitionEffectChange,
  onTransitionDurationMsChange,
  onApplyTransition,
  onClearTransition,
}: PhotoSlideshowProjectCaptionActionControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      <button type="button" className="secondary compact-action" onClick={onApplyCaption} disabled={!selectedCount || disabled}>
        <TextCursorInput size={14} />
        <span>{uiText("Apply caption")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onApplyCaptionPreset} disabled={!selectedCount || disabled}>
        <Layers size={14} />
        <span>{uiText("Apply caption preset")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onClearCaption} disabled={!selectedCount || disabled}>
        <X size={14} />
        <span>{uiText("Clear caption")}</span>
      </button>
      <label>
        <span>{uiText("Selected transition")}</span>
        <select
          aria-label={uiText("Selected transition")}
          value={transitionEffect}
          onChange={(event) => onTransitionEffectChange(event.currentTarget.value as PhotoSlideshowTransitionEffect)}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="cut">{uiText("Cut")}</option>
          <option value="fade">{uiText("Fade")}</option>
          <option value="dissolve">{uiText("Dissolve")}</option>
          <option value="zoom">{uiText("Zoom")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Selected transition duration")}</span>
        <input
          aria-label={uiText("Selected transition duration ms")}
          type="number"
          min="0"
          max="3000"
          step="50"
          value={transitionDurationMs}
          onChange={(event) => onTransitionDurationMsChange(Math.max(0, Math.min(3000, Number(event.currentTarget.value) || 0)))}
          disabled={disabled || transitionEffect === "cut"}
        />
      </label>
      <button type="button" className="secondary compact-action" onClick={onApplyTransition} disabled={!selectedCount || disabled}>
        <SlidersHorizontal size={14} />
        <span>{uiText("Apply transition")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onClearTransition} disabled={!selectedCount || disabled}>
        <X size={14} />
        <span>{uiText("Clear transition")}</span>
      </button>
    </>
  );
}
