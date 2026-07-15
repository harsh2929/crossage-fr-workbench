import { Clock } from "lucide-react";
import type {
  PhotoSlideshowMotionPreset,
  PhotoSlideshowProject,
  PhotoSlideshowTitleCardFontScale,
  PhotoSlideshowTitleCardLayout,
  PhotoSlideshowTitleCardPalette,
} from "./photoSlideshowProjects";

type PhotoSlideshowProjectBasicsControlsProps = {
  projects: PhotoSlideshowProject[];
  projectId: string;
  projectName: string;
  projectTitle: string;
  activeName: string;
  includeTitleCard: boolean;
  titleCardTitle: string;
  titleCardSubtitle: string;
  titleCardDurationMs: number;
  titleCardPalette: PhotoSlideshowTitleCardPalette;
  titleCardLayout: PhotoSlideshowTitleCardLayout;
  titleCardFontScale: PhotoSlideshowTitleCardFontScale;
  titleCardShowFooter: boolean;
  slideDurationMs: number;
  slideMotion: PhotoSlideshowMotionPreset;
  slideshowIntervalMs: number;
  selectedCount: number;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onProjectChange: (projectId: string) => void;
  onProjectNameChange: (value: string) => void;
  onProjectTitleChange: (value: string) => void;
  onIncludeTitleCardChange: (value: boolean) => void;
  onTitleCardTitleChange: (value: string) => void;
  onTitleCardSubtitleChange: (value: string) => void;
  onTitleCardDurationMsChange: (value: number) => void;
  onTitleCardPaletteChange: (value: PhotoSlideshowTitleCardPalette) => void;
  onTitleCardLayoutChange: (value: PhotoSlideshowTitleCardLayout) => void;
  onTitleCardFontScaleChange: (value: PhotoSlideshowTitleCardFontScale) => void;
  onTitleCardShowFooterChange: (value: boolean) => void;
  onSlideDurationMsChange: (value: number) => void;
  onApplySelectedSlideDuration: () => void;
  onSlideMotionChange: (value: PhotoSlideshowMotionPreset) => void;
};

export function PhotoSlideshowProjectBasicsControls({
  projects,
  projectId,
  projectName,
  projectTitle,
  activeName,
  includeTitleCard,
  titleCardTitle,
  titleCardSubtitle,
  titleCardDurationMs,
  titleCardPalette,
  titleCardLayout,
  titleCardFontScale,
  titleCardShowFooter,
  slideDurationMs,
  slideMotion,
  slideshowIntervalMs,
  selectedCount,
  busy,
  slideshowLoading,
  uiText,
  formatCount,
  onProjectChange,
  onProjectNameChange,
  onProjectTitleChange,
  onIncludeTitleCardChange,
  onTitleCardTitleChange,
  onTitleCardSubtitleChange,
  onTitleCardDurationMsChange,
  onTitleCardPaletteChange,
  onTitleCardLayoutChange,
  onTitleCardFontScaleChange,
  onTitleCardShowFooterChange,
  onSlideDurationMsChange,
  onApplySelectedSlideDuration,
  onSlideMotionChange,
}: PhotoSlideshowProjectBasicsControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      <label>
        <span>{uiText("Slideshow project")}</span>
        <select value={projectId} onChange={(event) => onProjectChange(event.currentTarget.value)}>
          <option value="">{uiText("New slideshow")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {formatCount(project.sourcePaths.length)}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label={uiText("Slideshow project name")}
        value={projectName}
        onChange={(event) => onProjectNameChange(event.currentTarget.value)}
        placeholder={uiText("Project name")}
        disabled={disabled}
      />
      <input
        aria-label={uiText("Slideshow title")}
        value={projectTitle}
        onChange={(event) => onProjectTitleChange(event.currentTarget.value)}
        placeholder={uiText("Slideshow title")}
        disabled={disabled}
      />
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={includeTitleCard} onChange={(event) => onIncludeTitleCardChange(event.currentTarget.checked)} disabled={disabled} />
        <span>{uiText("Title card")}</span>
      </label>
      <input
        aria-label={uiText("Title-card title")}
        value={titleCardTitle}
        onChange={(event) => onTitleCardTitleChange(event.currentTarget.value)}
        placeholder={projectTitle || uiText("Title-card title")}
        disabled={disabled}
      />
      <input
        aria-label={uiText("Title-card subtitle")}
        value={titleCardSubtitle}
        onChange={(event) => onTitleCardSubtitleChange(event.currentTarget.value)}
        placeholder={activeName || uiText("Title-card subtitle")}
        disabled={disabled}
      />
      <label>
        <span>{uiText("Title-card duration")}</span>
        <input
          aria-label={uiText("Title-card duration ms")}
          type="number"
          min="1500"
          max="15000"
          step="250"
          value={titleCardDurationMs}
          onChange={(event) => onTitleCardDurationMsChange(Math.max(1500, Math.min(15000, Number(event.currentTarget.value) || 3000)))}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Title-card palette")}</span>
        <select value={titleCardPalette} onChange={(event) => onTitleCardPaletteChange(event.currentTarget.value as PhotoSlideshowTitleCardPalette)} disabled={disabled}>
          <option value="auto">{uiText("Auto")}</option>
          <option value="midnight">{uiText("Midnight")}</option>
          <option value="paper">{uiText("Paper")}</option>
          <option value="sunset">{uiText("Sunset")}</option>
          <option value="forest">{uiText("Forest")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Title-card layout")}</span>
        <select value={titleCardLayout} onChange={(event) => onTitleCardLayoutChange(event.currentTarget.value as PhotoSlideshowTitleCardLayout)} disabled={disabled}>
          <option value="center">{uiText("Center")}</option>
          <option value="lower-third">{uiText("Lower third")}</option>
          <option value="left">{uiText("Left")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Title-card type")}</span>
        <select value={titleCardFontScale} onChange={(event) => onTitleCardFontScaleChange(event.currentTarget.value as PhotoSlideshowTitleCardFontScale)} disabled={disabled}>
          <option value="compact">{uiText("Compact")}</option>
          <option value="regular">{uiText("Regular")}</option>
          <option value="large">{uiText("Large")}</option>
        </select>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={titleCardShowFooter} onChange={(event) => onTitleCardShowFooterChange(event.currentTarget.checked)} disabled={disabled} />
        <span>{uiText("Title-card footer")}</span>
      </label>
      <label>
        <span>{uiText("Selected slide duration")}</span>
        <input
          aria-label={uiText("Selected slide duration ms")}
          type="number"
          min="500"
          max="60000"
          step="250"
          value={slideDurationMs}
          onChange={(event) => onSlideDurationMsChange(Math.max(500, Math.min(60000, Number(event.currentTarget.value) || slideshowIntervalMs)))}
          disabled={disabled}
        />
      </label>
      <button type="button" className="secondary compact-action" onClick={onApplySelectedSlideDuration} disabled={!selectedCount || disabled}>
        <Clock size={14} />
        <span>{uiText("Apply selected")}</span>
      </button>
      <label>
        <span>{uiText("Selected motion")}</span>
        <select
          aria-label={uiText("Selected slide motion")}
          value={slideMotion}
          onChange={(event) => onSlideMotionChange(event.currentTarget.value as PhotoSlideshowMotionPreset)}
          disabled={disabled}
        >
          <option value="auto">{uiText("Auto")}</option>
          <option value="still">{uiText("Still")}</option>
          <option value="slow-zoom">{uiText("Slow zoom")}</option>
          <option value="pan-left">{uiText("Pan left")}</option>
          <option value="pan-right">{uiText("Pan right")}</option>
        </select>
      </label>
    </>
  );
}
