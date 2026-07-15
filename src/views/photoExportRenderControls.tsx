import { Pipette } from "lucide-react";
import {
  PHOTO_EXPORT_SIZE_PRESETS,
  photoExportSizePresetMaxDimension,
  type PhotoExportColorProfileTarget,
  type PhotoExportColorProfileValidationStatus,
  type PhotoExportRenderFormat,
  type PhotoExportSizePreset,
  type PhotoExportVariant,
} from "./photoExportPresets";
import { photoFileName, shortText } from "./photoDisplayText";

type PhotoExportRenderControlsProps = {
  exportVariant: PhotoExportVariant;
  renderFormat: PhotoExportRenderFormat;
  renderQuality: string;
  renderSizePreset: PhotoExportSizePreset;
  renderMaxDimension: string;
  effectiveRenderMaxDimension: string;
  preserveColorProfile: boolean;
  targetColorProfile: PhotoExportColorProfileTarget;
  targetColorProfilePath: string;
  targetColorProfileValidationStatus: PhotoExportColorProfileValidationStatus | null;
  colorProfileStatusText: string;
  colorProfileStatusTone: string;
  uiText: (value: string) => string;
  onExportVariantChange: (variant: PhotoExportVariant) => void;
  onRenderFormatChange: (format: PhotoExportRenderFormat) => void;
  onRenderQualityChange: (quality: string) => void;
  onRenderSizePresetChange: (preset: PhotoExportSizePreset, nextMaxDimension: string) => void;
  onRenderMaxDimensionChange: (value: string) => void;
  onPreserveColorProfileChange: (checked: boolean) => void;
  onTargetColorProfileChange: (target: PhotoExportColorProfileTarget) => void;
  onChooseColorProfile: () => void;
};

export function PhotoExportRenderControls({
  exportVariant,
  renderFormat,
  renderQuality,
  renderSizePreset,
  renderMaxDimension,
  effectiveRenderMaxDimension,
  preserveColorProfile,
  targetColorProfile,
  targetColorProfilePath,
  targetColorProfileValidationStatus,
  colorProfileStatusText,
  colorProfileStatusTone,
  uiText,
  onExportVariantChange,
  onRenderFormatChange,
  onRenderQualityChange,
  onRenderSizePresetChange,
  onRenderMaxDimensionChange,
  onPreserveColorProfileChange,
  onTargetColorProfileChange,
  onChooseColorProfile,
}: PhotoExportRenderControlsProps) {
  const renderedExportDisabled = exportVariant !== "rendered";

  return (
    <>
      <label>
        <span>{uiText("Export kind")}</span>
        <select value={exportVariant} onChange={(event) => onExportVariantChange(event.currentTarget.value as PhotoExportVariant)}>
          <option value="original">{uiText("Original file")}</option>
          <option value="rendered">{uiText("Rendered file")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Render format")}</span>
        <select value={renderFormat} onChange={(event) => onRenderFormatChange(event.currentTarget.value as PhotoExportRenderFormat)} disabled={renderedExportDisabled}>
          <option value="jpeg">{uiText("JPEG")}</option>
          <option value="png">{uiText("PNG")}</option>
          <option value="tiff">{uiText("TIFF")}</option>
          <option value="heic">{uiText("HEIC")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Quality")}</span>
        <input
          aria-label={uiText("Render quality")}
          type="number"
          min={1}
          max={100}
          step={1}
          value={renderQuality}
          onChange={(event) => onRenderQualityChange(event.currentTarget.value)}
          disabled={renderedExportDisabled || !["jpeg", "heic"].includes(renderFormat)}
        />
      </label>
      <label>
        <span>{uiText("Size")}</span>
        <select
          aria-label={uiText("Render size")}
          value={renderSizePreset}
          onChange={(event) => {
            const preset = event.currentTarget.value as PhotoExportSizePreset;
            onRenderSizePresetChange(preset, preset !== "custom" ? photoExportSizePresetMaxDimension(preset, renderMaxDimension) : renderMaxDimension);
          }}
          disabled={renderedExportDisabled}
        >
          {PHOTO_EXPORT_SIZE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{uiText(preset.label)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{uiText("Max edge")}</span>
        <input
          aria-label={uiText("Render max edge")}
          type="number"
          min={0}
          max={20000}
          step={100}
          value={effectiveRenderMaxDimension}
          onChange={(event) => onRenderMaxDimensionChange(event.currentTarget.value)}
          disabled={renderedExportDisabled || renderSizePreset !== "custom"}
        />
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={preserveColorProfile}
          onChange={(event) => onPreserveColorProfileChange(event.currentTarget.checked)}
          disabled={renderedExportDisabled}
        />
        <span>{uiText("Preserve color profile")}</span>
      </label>
      <label>
        <span>{uiText("Target profile")}</span>
        <select
          value={targetColorProfile}
          onChange={(event) => onTargetColorProfileChange(event.currentTarget.value as PhotoExportColorProfileTarget)}
          disabled={renderedExportDisabled}
        >
          <option value="source">{uiText("Source profile")}</option>
          <option value="srgb">{uiText("sRGB")}</option>
          <option value="display-p3">{uiText("Display P3")}</option>
          <option value="adobe-rgb">{uiText("Adobe RGB")}</option>
          <option value="custom-icc">{uiText("Custom ICC")}</option>
          <option value="none">{uiText("Strip profile")}</option>
        </select>
      </label>
      {targetColorProfile === "custom-icc" ? (
        <label>
          <span>{uiText("ICC profile")}</span>
          <button
            type="button"
            className="secondary"
            onClick={onChooseColorProfile}
            disabled={renderedExportDisabled}
            aria-label={uiText(targetColorProfilePath ? "Change ICC profile" : "Choose ICC profile")}
          >
            <Pipette size={16} />
            <span>{uiText(targetColorProfilePath ? "Change ICC" : "Choose ICC")}</span>
          </button>
          <small title={targetColorProfilePath || undefined}>
            {targetColorProfilePath ? photoFileName(targetColorProfilePath) || shortText(targetColorProfilePath) : uiText("No ICC selected")}
          </small>
          {targetColorProfileValidationStatus ? (
            <small className={`photo-export-profile-status ${targetColorProfileValidationStatus.tone}`}>
              {targetColorProfileValidationStatus.text}
            </small>
          ) : null}
        </label>
      ) : null}
      {exportVariant === "rendered" && colorProfileStatusText ? (
        <div className={`photo-export-profile-preflight ${colorProfileStatusTone}`}>
          {colorProfileStatusText}
        </div>
      ) : null}
    </>
  );
}
