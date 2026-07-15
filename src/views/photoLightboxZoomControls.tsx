import { Maximize2, Minimize2, RefreshCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { LightboxFitMode } from "./photoLightboxSession";

type PhotoLightboxZoomControlsProps = {
  zoom: number;
  fitMode: LightboxFitMode;
  fullscreen: boolean;
  uiText: (value: string) => string;
  onZoomOut: () => void;
  onZoomChange: (value: number) => void;
  onZoomIn: () => void;
  onToggleFitMode: () => void;
  onToggleFullscreen: () => void | Promise<void>;
  onReset: () => void;
};

export function PhotoLightboxZoomControls({
  zoom,
  fitMode,
  fullscreen,
  uiText,
  onZoomOut,
  onZoomChange,
  onZoomIn,
  onToggleFitMode,
  onToggleFullscreen,
  onReset,
}: PhotoLightboxZoomControlsProps) {
  return (
    <div className="photos-lightbox-zoom-controls" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="secondary compact-action" onClick={onZoomOut} disabled={zoom <= 1.01} aria-label={uiText("Zoom out")}>
        <ZoomOut size={14} />
      </button>
      <label>
        <span>{Math.round(zoom * 100)}%</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(event) => onZoomChange(Number(event.currentTarget.value))}
          aria-label={uiText("Zoom photos")}
        />
      </label>
      <button type="button" className="secondary compact-action" onClick={onZoomIn} disabled={zoom >= 3.99} aria-label={uiText("Zoom in")}>
        <ZoomIn size={14} />
      </button>
      <button type="button" className="secondary compact-action" onClick={onToggleFitMode}>
        {fitMode === "fit" ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        <span>{fitMode === "fit" ? uiText("Fill") : uiText("Fit")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={() => void onToggleFullscreen()}>
        {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        <span>{fullscreen ? uiText("Exit fullscreen") : uiText("Fullscreen")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onReset}>
        <RefreshCcw size={14} />
        <span>{uiText("Reset zoom")}</span>
      </button>
    </div>
  );
}
