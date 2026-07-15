import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import type { PhotoSlideshowPathEditorMode } from "./photoSlideshowDisplay";

export type PhotoSlideshowProjectKeyframeControlValueKey =
  | "startX"
  | "startY"
  | "quarterX"
  | "quarterY"
  | "midX"
  | "midY"
  | "threeQuarterX"
  | "threeQuarterY"
  | "endX"
  | "endY"
  | "startZoom"
  | "quarterZoom"
  | "midZoom"
  | "threeQuarterZoom"
  | "endZoom";

export type PhotoSlideshowProjectKeyframeControlValues = Record<PhotoSlideshowProjectKeyframeControlValueKey, number>;

type PhotoSlideshowBezierHandleKey = "bezierControl1" | "bezierControl2";
type PhotoSlideshowBezierAxis = "x" | "y";

type PhotoSlideshowProjectKeyframeControlsProps = {
  pathEditorMode: PhotoSlideshowPathEditorMode;
  values: PhotoSlideshowProjectKeyframeControlValues;
  bezierControl1X: number;
  bezierControl1Y: number;
  bezierControl2X: number;
  bezierControl2Y: number;
  selectedCount: number;
  previewSourceCount: number;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  onBezierHandleAxisChange: (handle: PhotoSlideshowBezierHandleKey, axis: PhotoSlideshowBezierAxis, value: number) => void;
  onValueChange: (key: PhotoSlideshowProjectKeyframeControlValueKey, value: number) => void;
  onApplyKeyframes: () => void;
  onClearKeyframes: () => void;
  onMoveSlideEarlier: () => void;
  onMoveSlideLater: () => void;
};

const coordinateControls: Array<{ key: PhotoSlideshowProjectKeyframeControlValueKey; label: string }> = [
  { key: "startX", label: "Path start X" },
  { key: "startY", label: "Path start Y" },
  { key: "quarterX", label: "Path 25% X" },
  { key: "quarterY", label: "Path 25% Y" },
  { key: "midX", label: "Path mid X" },
  { key: "midY", label: "Path mid Y" },
  { key: "threeQuarterX", label: "Path 75% X" },
  { key: "threeQuarterY", label: "Path 75% Y" },
  { key: "endX", label: "Path end X" },
  { key: "endY", label: "Path end Y" },
];

const zoomControls: Array<{ key: PhotoSlideshowProjectKeyframeControlValueKey; label: string }> = [
  { key: "startZoom", label: "Start zoom" },
  { key: "quarterZoom", label: "25% zoom" },
  { key: "midZoom", label: "Mid zoom" },
  { key: "threeQuarterZoom", label: "75% zoom" },
  { key: "endZoom", label: "End zoom" },
];

function clampPercentInput(value: string) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function clampZoomInput(value: string) {
  return Math.max(1, Math.min(1.5, Number(value) || 1));
}

export function PhotoSlideshowProjectKeyframeControls({
  pathEditorMode,
  values,
  bezierControl1X,
  bezierControl1Y,
  bezierControl2X,
  bezierControl2Y,
  selectedCount,
  previewSourceCount,
  busy,
  slideshowLoading,
  uiText,
  onBezierHandleAxisChange,
  onValueChange,
  onApplyKeyframes,
  onClearKeyframes,
  onMoveSlideEarlier,
  onMoveSlideLater,
}: PhotoSlideshowProjectKeyframeControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      {pathEditorMode === "bezier" ? (
        <>
          <label>
            <span>{uiText("Bezier control 1 X")}</span>
            <input
              aria-label={uiText("Bezier control 1 X")}
              type="number"
              min="0"
              max="100"
              step="1"
              value={bezierControl1X}
              onChange={(event) => onBezierHandleAxisChange("bezierControl1", "x", Number(event.currentTarget.value))}
              disabled={disabled}
            />
          </label>
          <label>
            <span>{uiText("Bezier control 1 Y")}</span>
            <input
              aria-label={uiText("Bezier control 1 Y")}
              type="number"
              min="0"
              max="100"
              step="1"
              value={bezierControl1Y}
              onChange={(event) => onBezierHandleAxisChange("bezierControl1", "y", Number(event.currentTarget.value))}
              disabled={disabled}
            />
          </label>
          <label>
            <span>{uiText("Bezier control 2 X")}</span>
            <input
              aria-label={uiText("Bezier control 2 X")}
              type="number"
              min="0"
              max="100"
              step="1"
              value={bezierControl2X}
              onChange={(event) => onBezierHandleAxisChange("bezierControl2", "x", Number(event.currentTarget.value))}
              disabled={disabled}
            />
          </label>
          <label>
            <span>{uiText("Bezier control 2 Y")}</span>
            <input
              aria-label={uiText("Bezier control 2 Y")}
              type="number"
              min="0"
              max="100"
              step="1"
              value={bezierControl2Y}
              onChange={(event) => onBezierHandleAxisChange("bezierControl2", "y", Number(event.currentTarget.value))}
              disabled={disabled}
            />
          </label>
        </>
      ) : null}
      {coordinateControls.map((control) => (
        <label key={control.key}>
          <span>{uiText(control.label)}</span>
          <input
            aria-label={uiText(control.label)}
            type="number"
            min="0"
            max="100"
            step="1"
            value={values[control.key]}
            onChange={(event) => onValueChange(control.key, clampPercentInput(event.currentTarget.value))}
            disabled={disabled}
          />
        </label>
      ))}
      {zoomControls.map((control) => (
        <label key={control.key}>
          <span>{uiText(control.label)}</span>
          <input
            aria-label={uiText(control.label)}
            type="number"
            min="1"
            max="1.5"
            step="0.01"
            value={values[control.key]}
            onChange={(event) => onValueChange(control.key, clampZoomInput(event.currentTarget.value))}
            disabled={disabled}
          />
        </label>
      ))}
      <button type="button" className="secondary compact-action" onClick={onApplyKeyframes} disabled={!selectedCount || disabled}>
        <SlidersHorizontal size={14} />
        <span>{uiText("Apply keyframes")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onClearKeyframes} disabled={!selectedCount || disabled}>
        <X size={14} />
        <span>{uiText("Clear keyframes")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onMoveSlideEarlier} disabled={!selectedCount || previewSourceCount < 2 || disabled}>
        <ChevronLeft size={14} />
        <span>{uiText("Move slide earlier")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onMoveSlideLater} disabled={!selectedCount || previewSourceCount < 2 || disabled}>
        <ChevronRight size={14} />
        <span>{uiText("Move slide later")}</span>
      </button>
    </>
  );
}
