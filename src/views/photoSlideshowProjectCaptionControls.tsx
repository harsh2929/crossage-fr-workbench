import type { PhotoSlideshowCaptionLayerChoice } from "./photoSlideshowDisplay";
import {
  PHOTO_SLIDESHOW_CAPTION_LIMIT,
  type PhotoSlideshowCaptionPlacement,
  type PhotoSlideshowCaptionTypography,
  type PhotoSlideshowCaptionWrap,
} from "./photoSlideshowProjects";

type PhotoSlideshowProjectCaptionControlsProps = {
  captionText: string;
  captionLayer: PhotoSlideshowCaptionLayerChoice;
  captionPlacement: PhotoSlideshowCaptionPlacement;
  captionTypography: PhotoSlideshowCaptionTypography;
  captionWrap: PhotoSlideshowCaptionWrap;
  captionRegionX: number;
  captionRegionY: number;
  captionRegionWidth: number;
  captionRegionHeight: number;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  onCaptionTextChange: (value: string) => void;
  onCaptionLayerChange: (value: PhotoSlideshowCaptionLayerChoice) => void;
  onCaptionPlacementChange: (value: PhotoSlideshowCaptionPlacement) => void;
  onCaptionTypographyChange: (value: PhotoSlideshowCaptionTypography) => void;
  onCaptionWrapChange: (value: PhotoSlideshowCaptionWrap) => void;
  onCaptionRegionXChange: (value: string) => void;
  onCaptionRegionYChange: (value: string) => void;
  onCaptionRegionWidthChange: (value: string) => void;
  onCaptionRegionHeightChange: (value: string) => void;
};

export function PhotoSlideshowProjectCaptionControls({
  captionText,
  captionLayer,
  captionPlacement,
  captionTypography,
  captionWrap,
  captionRegionX,
  captionRegionY,
  captionRegionWidth,
  captionRegionHeight,
  busy,
  slideshowLoading,
  uiText,
  onCaptionTextChange,
  onCaptionLayerChange,
  onCaptionPlacementChange,
  onCaptionTypographyChange,
  onCaptionWrapChange,
  onCaptionRegionXChange,
  onCaptionRegionYChange,
  onCaptionRegionWidthChange,
  onCaptionRegionHeightChange,
}: PhotoSlideshowProjectCaptionControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      <label>
        <span>{uiText("Selected caption")}</span>
        <input
          aria-label={uiText("Selected slide caption")}
          value={captionText}
          onChange={(event) => onCaptionTextChange(event.currentTarget.value)}
          placeholder={uiText("Caption")}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Caption layer")}</span>
        <select
          aria-label={uiText("Selected caption layer")}
          value={captionLayer}
          onChange={(event) => onCaptionLayerChange(event.currentTarget.value as PhotoSlideshowCaptionLayerChoice)}
          disabled={disabled}
        >
          <option value="primary">{uiText("Primary caption")}</option>
          {Array.from({ length: PHOTO_SLIDESHOW_CAPTION_LIMIT }, (_, index) => (
            <option key={`block-${index}`} value={`block-${index}`}>
              {`${uiText("Caption")} ${index + 2}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{uiText("Caption placement")}</span>
        <select
          aria-label={uiText("Selected caption placement")}
          value={captionPlacement}
          onChange={(event) => onCaptionPlacementChange(event.currentTarget.value as PhotoSlideshowCaptionPlacement)}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="lower-left">{uiText("Lower left")}</option>
          <option value="lower-center">{uiText("Lower center")}</option>
          <option value="lower-right">{uiText("Lower right")}</option>
          <option value="upper-left">{uiText("Upper left")}</option>
          <option value="upper-center">{uiText("Upper center")}</option>
          <option value="upper-right">{uiText("Upper right")}</option>
          <option value="center">{uiText("Center")}</option>
          <option value="hidden">{uiText("Hidden")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Caption type")}</span>
        <select
          aria-label={uiText("Selected caption typography")}
          value={captionTypography}
          onChange={(event) => onCaptionTypographyChange(event.currentTarget.value as PhotoSlideshowCaptionTypography)}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="clean">{uiText("Clean")}</option>
          <option value="editorial">{uiText("Editorial")}</option>
          <option value="cinematic">{uiText("Cinematic")}</option>
          <option value="bold">{uiText("Bold")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Caption wrap")}</span>
        <select
          aria-label={uiText("Selected caption wrap")}
          value={captionWrap}
          onChange={(event) => onCaptionWrapChange(event.currentTarget.value as PhotoSlideshowCaptionWrap)}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="single-line">{uiText("Single line")}</option>
          <option value="two-line">{uiText("Two lines")}</option>
          <option value="multi-line">{uiText("Multi-line")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Caption X")}</span>
        <input
          aria-label={uiText("Caption region X")}
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={captionRegionX}
          onChange={(event) => onCaptionRegionXChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Caption Y")}</span>
        <input
          aria-label={uiText("Caption region Y")}
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={captionRegionY}
          onChange={(event) => onCaptionRegionYChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Caption W")}</span>
        <input
          aria-label={uiText("Caption region width")}
          type="number"
          min="1"
          max="100"
          step="0.5"
          value={captionRegionWidth}
          onChange={(event) => onCaptionRegionWidthChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Caption H")}</span>
        <input
          aria-label={uiText("Caption region height")}
          type="number"
          min="1"
          max="100"
          step="0.5"
          value={captionRegionHeight}
          onChange={(event) => onCaptionRegionHeightChange(event.currentTarget.value)}
          disabled={disabled}
        />
      </label>
    </>
  );
}
