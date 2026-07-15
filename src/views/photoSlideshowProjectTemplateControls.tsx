import { Check, ClipboardPaste, Download, RotateCcw, Trash2 } from "lucide-react";
import {
  photoSlideshowTemplateRegionForSlot,
} from "./photoSlideshowDisplay";
import type {
  PhotoSlideshowCaptionRegion,
  PhotoSlideshowProjectTheme,
  PhotoSlideshowThemeTemplate,
  PhotoSlideshowThemeTemplateBackdrop,
  PhotoSlideshowThemeTemplateCaptionPreset,
  PhotoSlideshowThemeTemplateChromeDensity,
  PhotoSlideshowThemeTemplateFrameStyle,
  PhotoSlideshowThemeTemplateLayout,
  PhotoSlideshowThemeTemplatePalette,
  PhotoSlideshowThemeTemplateRegionMap,
  PhotoSlideshowThemeTemplateRegionSlot,
  PhotoSlideshowThemeTemplateTypography,
  PhotoSlideshowThemeTimelineChoice,
} from "./photoSlideshowProjects";

type PhotoSlideshowProjectTemplateControlsProps = {
  theme: PhotoSlideshowProjectTheme;
  timelinePreset: PhotoSlideshowThemeTimelineChoice;
  templates: PhotoSlideshowThemeTemplate[];
  templateId: string;
  templateName: string;
  templatePalette: PhotoSlideshowThemeTemplatePalette;
  templateTypography: PhotoSlideshowThemeTemplateTypography;
  templateBackdrop: PhotoSlideshowThemeTemplateBackdrop;
  templateLayout: PhotoSlideshowThemeTemplateLayout;
  templateBackdropIntensity: number;
  templateStageWidth: number;
  templateFrameStyle: PhotoSlideshowThemeTemplateFrameStyle;
  templateChromeDensity: PhotoSlideshowThemeTemplateChromeDensity;
  templateCaptionPreset: PhotoSlideshowThemeTemplateCaptionPreset;
  templateRegionMap: PhotoSlideshowThemeTemplateRegionMap;
  templateRegionSlot: PhotoSlideshowThemeTemplateRegionSlot;
  selectedTemplate: PhotoSlideshowThemeTemplate | null;
  transferMessage: string;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  onClearTemplateSelection: () => void;
  onApplyTemplate: (template: PhotoSlideshowThemeTemplate) => void;
  onThemeChange: (value: PhotoSlideshowProjectTheme) => void;
  onTimelinePresetChange: (value: PhotoSlideshowThemeTimelineChoice) => void;
  onTemplateNameChange: (value: string) => void;
  onTemplatePaletteChange: (value: PhotoSlideshowThemeTemplatePalette) => void;
  onTemplateTypographyChange: (value: PhotoSlideshowThemeTemplateTypography) => void;
  onTemplateBackdropChange: (value: PhotoSlideshowThemeTemplateBackdrop) => void;
  onTemplateLayoutChange: (value: PhotoSlideshowThemeTemplateLayout) => void;
  onTemplateBackdropIntensityChange: (value: number) => void;
  onTemplateStageWidthChange: (value: number) => void;
  onTemplateFrameStyleChange: (value: PhotoSlideshowThemeTemplateFrameStyle) => void;
  onTemplateChromeDensityChange: (value: PhotoSlideshowThemeTemplateChromeDensity) => void;
  onTemplateCaptionPresetChange: (value: PhotoSlideshowThemeTemplateCaptionPreset) => void;
  onTemplateRegionSlotChange: (value: PhotoSlideshowThemeTemplateRegionSlot) => void;
  onTemplateRegionPatch: (slot: PhotoSlideshowThemeTemplateRegionSlot, patch: Partial<PhotoSlideshowCaptionRegion>) => void;
  onClearTemplateRegionSlot: (slot: PhotoSlideshowThemeTemplateRegionSlot) => void;
  onResetTemplateRegions: () => void;
  onSaveTemplate: () => void;
  onDeleteTemplate: () => void;
  onExportTemplates: () => void;
  onImportTemplates: () => void;
};

function clampTemplateBackdropIntensity(value: string) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function clampTemplateStageWidth(value: string) {
  return Math.max(50, Math.min(100, Number(value) || 50));
}

export function PhotoSlideshowProjectTemplateControls({
  theme,
  timelinePreset,
  templates,
  templateId,
  templateName,
  templatePalette,
  templateTypography,
  templateBackdrop,
  templateLayout,
  templateBackdropIntensity,
  templateStageWidth,
  templateFrameStyle,
  templateChromeDensity,
  templateCaptionPreset,
  templateRegionMap,
  templateRegionSlot,
  selectedTemplate,
  transferMessage,
  busy,
  slideshowLoading,
  uiText,
  onClearTemplateSelection,
  onApplyTemplate,
  onThemeChange,
  onTimelinePresetChange,
  onTemplateNameChange,
  onTemplatePaletteChange,
  onTemplateTypographyChange,
  onTemplateBackdropChange,
  onTemplateLayoutChange,
  onTemplateBackdropIntensityChange,
  onTemplateStageWidthChange,
  onTemplateFrameStyleChange,
  onTemplateChromeDensityChange,
  onTemplateCaptionPresetChange,
  onTemplateRegionSlotChange,
  onTemplateRegionPatch,
  onClearTemplateRegionSlot,
  onResetTemplateRegions,
  onSaveTemplate,
  onDeleteTemplate,
  onExportTemplates,
  onImportTemplates,
}: PhotoSlideshowProjectTemplateControlsProps) {
  const disabled = busy || slideshowLoading;
  const currentRegion = photoSlideshowTemplateRegionForSlot(templateCaptionPreset, templateLayout, templateRegionMap, templateRegionSlot);
  const regionIsCustom = Boolean(templateRegionMap[templateRegionSlot]);
  const hasCustomRegions = Object.keys(templateRegionMap).length > 0;

  const markCustom = () => {
    onClearTemplateSelection();
  };

  return (
    <>
      <label>
        <span>{uiText("Theme")}</span>
        <select
          value={theme}
          onChange={(event) => {
            markCustom();
            onThemeChange(event.currentTarget.value as PhotoSlideshowProjectTheme);
          }}
          disabled={disabled}
        >
          <option value="classic">{uiText("Classic")}</option>
          <option value="fade">{uiText("Fade")}</option>
          <option value="ken-burns">{uiText("Ken Burns")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Timeline style")}</span>
        <select
          aria-label={uiText("Timeline style")}
          value={timelinePreset}
          onChange={(event) => {
            markCustom();
            onTimelinePresetChange(event.currentTarget.value as PhotoSlideshowThemeTimelineChoice);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="classic-hold">{uiText("Classic hold")}</option>
          <option value="fade-hold">{uiText("Fade hold")}</option>
          <option value="ken-burns-drift">{uiText("Ken Burns drift")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template preset")}</span>
        <select
          aria-label={uiText("Template preset")}
          value={templateId}
          onChange={(event) => {
            const template = templates.find((item) => item.id === event.currentTarget.value) || null;
            if (template) onApplyTemplate(template);
            else onClearTemplateSelection();
          }}
          disabled={disabled}
        >
          <option value="">{uiText("Custom")}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </label>
      <input
        aria-label={uiText("Template name")}
        value={templateName}
        onChange={(event) => {
          markCustom();
          onTemplateNameChange(event.currentTarget.value);
        }}
        placeholder={uiText("Template name")}
        disabled={disabled}
      />
      <label>
        <span>{uiText("Template palette")}</span>
        <select
          aria-label={uiText("Template palette")}
          value={templatePalette}
          onChange={(event) => {
            markCustom();
            onTemplatePaletteChange(event.currentTarget.value as PhotoSlideshowThemeTemplatePalette);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="midnight">{uiText("Midnight")}</option>
          <option value="paper">{uiText("Paper")}</option>
          <option value="sunset">{uiText("Sunset")}</option>
          <option value="forest">{uiText("Forest")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template typography")}</span>
        <select
          aria-label={uiText("Template typography")}
          value={templateTypography}
          onChange={(event) => {
            markCustom();
            onTemplateTypographyChange(event.currentTarget.value as PhotoSlideshowThemeTemplateTypography);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="clean">{uiText("Clean")}</option>
          <option value="editorial">{uiText("Editorial")}</option>
          <option value="cinematic">{uiText("Cinematic")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template backdrop")}</span>
        <select
          aria-label={uiText("Template backdrop")}
          value={templateBackdrop}
          onChange={(event) => {
            markCustom();
            onTemplateBackdropChange(event.currentTarget.value as PhotoSlideshowThemeTemplateBackdrop);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="solid">{uiText("Solid")}</option>
          <option value="vignette">{uiText("Vignette")}</option>
          <option value="glass">{uiText("Glass")}</option>
          <option value="blur">{uiText("Blur")}</option>
          <option value="spotlight">{uiText("Spotlight")}</option>
          <option value="film">{uiText("Film")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template layout")}</span>
        <select
          aria-label={uiText("Template layout")}
          value={templateLayout}
          onChange={(event) => {
            markCustom();
            onTemplateLayoutChange(event.currentTarget.value as PhotoSlideshowThemeTemplateLayout);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="standard">{uiText("Standard")}</option>
          <option value="gallery">{uiText("Gallery")}</option>
          <option value="cinema">{uiText("Cinema")}</option>
          <option value="minimal">{uiText("Minimal")}</option>
          <option value="poster">{uiText("Poster")}</option>
          <option value="split">{uiText("Split")}</option>
          <option value="immersive">{uiText("Immersive")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template backdrop intensity")}</span>
        <input
          aria-label={uiText("Template backdrop intensity")}
          type="number"
          min="0"
          max="100"
          step="5"
          value={templateBackdropIntensity}
          onChange={(event) => {
            markCustom();
            onTemplateBackdropIntensityChange(clampTemplateBackdropIntensity(event.currentTarget.value));
          }}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Template stage width")}</span>
        <input
          aria-label={uiText("Template stage width")}
          type="number"
          min="50"
          max="100"
          step="5"
          value={templateStageWidth}
          onChange={(event) => {
            markCustom();
            onTemplateStageWidthChange(clampTemplateStageWidth(event.currentTarget.value));
          }}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Template frame")}</span>
        <select
          aria-label={uiText("Template frame")}
          value={templateFrameStyle}
          onChange={(event) => {
            markCustom();
            onTemplateFrameStyleChange(event.currentTarget.value as PhotoSlideshowThemeTemplateFrameStyle);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="none">{uiText("None")}</option>
          <option value="hairline">{uiText("Hairline")}</option>
          <option value="matte">{uiText("Matte")}</option>
          <option value="accent">{uiText("Accent")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template chrome")}</span>
        <select
          aria-label={uiText("Template chrome")}
          value={templateChromeDensity}
          onChange={(event) => {
            markCustom();
            onTemplateChromeDensityChange(event.currentTarget.value as PhotoSlideshowThemeTemplateChromeDensity);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="compact">{uiText("Compact")}</option>
          <option value="regular">{uiText("Regular")}</option>
          <option value="spacious">{uiText("Spacious")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template captions")}</span>
        <select
          aria-label={uiText("Template caption preset")}
          value={templateCaptionPreset}
          onChange={(event) => {
            markCustom();
            onTemplateCaptionPresetChange(event.currentTarget.value as PhotoSlideshowThemeTemplateCaptionPreset);
          }}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto from layout")}</option>
          <option value="lower-third">{uiText("Lower third")}</option>
          <option value="title-subtitle">{uiText("Title and subtitle")}</option>
          <option value="split-story">{uiText("Split story")}</option>
          <option value="gallery-labels">{uiText("Gallery labels")}</option>
          <option value="cinema-bars">{uiText("Cinema bars")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Template region slot")}</span>
        <select
          aria-label={uiText("Template region slot")}
          value={templateRegionSlot}
          onChange={(event) => onTemplateRegionSlotChange(event.currentTarget.value as PhotoSlideshowThemeTemplateRegionSlot)}
          disabled={disabled}
        >
          <option value="primary">{uiText("Primary caption")}</option>
          <option value="context">{uiText("Context caption")}</option>
          <option value="counter">{uiText("Counter")}</option>
          <option value="title">{uiText("Title")}</option>
          <option value="source">{uiText("Source")}</option>
          <option value="chapter">{uiText("Chapter")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Region X")}</span>
        <input
          aria-label={uiText("Template region X")}
          type="number"
          min="0"
          max="99"
          step="1"
          value={currentRegion.x}
          onChange={(event) => onTemplateRegionPatch(templateRegionSlot, { x: Number(event.currentTarget.value) })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Region Y")}</span>
        <input
          aria-label={uiText("Template region Y")}
          type="number"
          min="0"
          max="99"
          step="1"
          value={currentRegion.y}
          onChange={(event) => onTemplateRegionPatch(templateRegionSlot, { y: Number(event.currentTarget.value) })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Region width")}</span>
        <input
          aria-label={uiText("Template region width")}
          type="number"
          min="1"
          max="100"
          step="1"
          value={currentRegion.width}
          onChange={(event) => onTemplateRegionPatch(templateRegionSlot, { width: Number(event.currentTarget.value) })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Region height")}</span>
        <input
          aria-label={uiText("Template region height")}
          type="number"
          min="1"
          max="100"
          step="1"
          value={currentRegion.height}
          onChange={(event) => onTemplateRegionPatch(templateRegionSlot, { height: Number(event.currentTarget.value) })}
          disabled={disabled}
        />
      </label>
      <button type="button" className="ghost compact-action" onClick={() => onClearTemplateRegionSlot(templateRegionSlot)} disabled={!regionIsCustom || disabled}>
        <RotateCcw size={14} />
        <span>{uiText("Clear region")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onResetTemplateRegions} disabled={!hasCustomRegions || disabled}>
        <RotateCcw size={14} />
        <span>{uiText("Reset regions")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onSaveTemplate} disabled={disabled}>
        <Check size={14} />
        <span>{slideshowLoading ? uiText("Saving") : uiText("Save template")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onDeleteTemplate} disabled={!selectedTemplate || disabled}>
        <Trash2 size={14} />
        <span>{uiText("Delete template")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onExportTemplates} disabled={disabled}>
        <Download size={14} />
        <span>{uiText("Export templates")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onImportTemplates} disabled={disabled}>
        <ClipboardPaste size={14} />
        <span>{uiText("Import templates")}</span>
      </button>
      {transferMessage && (
        <small>{transferMessage}</small>
      )}
    </>
  );
}
