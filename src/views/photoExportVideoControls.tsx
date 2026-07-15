import type {
  PhotoExportVariant,
  PhotoExportVideoFormat,
  PhotoExportVideoQuality,
} from "./photoExportPresets";

type PhotoExportVideoControlsProps = {
  exportVariant: PhotoExportVariant;
  videoRenderQuality: PhotoExportVideoQuality;
  videoRenderFormat: PhotoExportVideoFormat;
  uiText: (value: string) => string;
  onVideoRenderQualityChange: (quality: PhotoExportVideoQuality) => void;
  onVideoRenderFormatChange: (format: PhotoExportVideoFormat) => void;
};

export function PhotoExportVideoControls({
  exportVariant,
  videoRenderQuality,
  videoRenderFormat,
  uiText,
  onVideoRenderQualityChange,
  onVideoRenderFormatChange,
}: PhotoExportVideoControlsProps) {
  const renderedExportDisabled = exportVariant !== "rendered";

  return (
    <>
      <label>
        <span>{uiText("Video quality")}</span>
        <select
          value={videoRenderQuality}
          onChange={(event) => onVideoRenderQualityChange(event.currentTarget.value as PhotoExportVideoQuality)}
          disabled={renderedExportDisabled}
        >
          <option value="small">{uiText("Small")}</option>
          <option value="medium">{uiText("Medium")}</option>
          <option value="high">{uiText("High")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Video format")}</span>
        <select
          value={videoRenderFormat}
          onChange={(event) => onVideoRenderFormatChange(event.currentTarget.value as PhotoExportVideoFormat)}
          disabled={renderedExportDisabled}
        >
          <option value="mp4">{uiText("MP4")}</option>
          <option value="mov">{uiText("MOV")}</option>
          <option value="m4v">{uiText("M4V")}</option>
          <option value="webm">{uiText("WebM")}</option>
          <option value="hevc">{uiText("HEVC MP4")}</option>
          <option value="prores">{uiText("ProRes MOV")}</option>
        </select>
      </label>
    </>
  );
}
