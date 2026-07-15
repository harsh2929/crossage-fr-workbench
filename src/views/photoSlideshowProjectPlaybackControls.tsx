import { Clock, Music, X } from "lucide-react";
import type {
  PhotoSlideshowProjectMusic,
  PhotoSlideshowTransitionEffect,
} from "./photoSlideshowProjects";

type PhotoSlideshowProjectPlaybackControlsProps = {
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  music: PhotoSlideshowProjectMusic;
  musicPath: string;
  audioVolume: number;
  audioFadeMs: number;
  audioStartMs: number;
  audioEndMs: number;
  selectedCount: number;
  audioPlacementStartSourcePath: string;
  audioPlacementEndSourcePath: string;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  fileName: (value: string) => string;
  onClearTemplateSelection: () => void;
  onTransitionEffectChange: (value: PhotoSlideshowTransitionEffect) => void;
  onTransitionDurationMsChange: (value: number) => void;
  onMusicChange: (value: PhotoSlideshowProjectMusic) => void;
  onChooseMusicFile: () => void;
  onClearMusicFile: () => void;
  onAudioVolumeChange: (value: number) => void;
  onAudioFadeMsChange: (value: number) => void;
  onAudioStartMsChange: (value: number) => void;
  onAudioEndMsChange: (value: number) => void;
  onSetAudioStartFromSelection: () => void;
  onSetAudioEndFromSelection: () => void;
  onClearAudioPlacement: () => void;
};

function clampNumber(value: string, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

export function PhotoSlideshowProjectPlaybackControls({
  transitionEffect,
  transitionDurationMs,
  music,
  musicPath,
  audioVolume,
  audioFadeMs,
  audioStartMs,
  audioEndMs,
  selectedCount,
  audioPlacementStartSourcePath,
  audioPlacementEndSourcePath,
  busy,
  slideshowLoading,
  uiText,
  fileName,
  onClearTemplateSelection,
  onTransitionEffectChange,
  onTransitionDurationMsChange,
  onMusicChange,
  onChooseMusicFile,
  onClearMusicFile,
  onAudioVolumeChange,
  onAudioFadeMsChange,
  onAudioStartMsChange,
  onAudioEndMsChange,
  onSetAudioStartFromSelection,
  onSetAudioEndFromSelection,
  onClearAudioPlacement,
}: PhotoSlideshowProjectPlaybackControlsProps) {
  const disabled = busy || slideshowLoading;
  return (
    <>
      <label>
        <span>{uiText("Transition")}</span>
        <select
          aria-label={uiText("Transition")}
          value={transitionEffect}
          onChange={(event) => {
            onClearTemplateSelection();
            onTransitionEffectChange(event.currentTarget.value as PhotoSlideshowTransitionEffect);
          }}
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
        <span>{uiText("Transition duration")}</span>
        <input
          aria-label={uiText("Transition duration ms")}
          type="number"
          min="0"
          max="3000"
          step="50"
          value={transitionDurationMs}
          onChange={(event) => {
            onClearTemplateSelection();
            onTransitionDurationMsChange(clampNumber(event.currentTarget.value, 0, 3000));
          }}
          disabled={disabled || transitionEffect === "cut"}
        />
      </label>
      <label>
        <span>{uiText("Music")}</span>
        <select
          value={music}
          onChange={(event) => onMusicChange(event.currentTarget.value as PhotoSlideshowProjectMusic)}
          disabled={disabled}
        >
          <option value="none">{uiText("None")}</option>
          <option value="calm">{uiText("Calm")}</option>
          <option value="bright">{uiText("Bright")}</option>
          <option value="cinematic">{uiText("Cinematic")}</option>
          <option value="custom">{uiText("Custom file")}</option>
        </select>
      </label>
      <button type="button" className="secondary compact-action" onClick={onChooseMusicFile} disabled={disabled}>
        <Music size={14} />
        <span>{uiText("Audio file")}</span>
      </button>
      {musicPath && (
        <button type="button" className="ghost compact-action" onClick={onClearMusicFile} disabled={disabled} title={musicPath}>
          <X size={14} />
          <span>{fileName(musicPath)}</span>
        </button>
      )}
      <label>
        <span>{uiText("Audio volume")}</span>
        <input
          aria-label={uiText("Audio volume")}
          type="number"
          min="0"
          max="100"
          step="5"
          value={audioVolume}
          onChange={(event) => onAudioVolumeChange(clampNumber(event.currentTarget.value, 0, 100))}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Audio fade")}</span>
        <input
          aria-label={uiText("Audio fade ms")}
          type="number"
          min="0"
          max="10000"
          step="250"
          value={audioFadeMs}
          onChange={(event) => onAudioFadeMsChange(clampNumber(event.currentTarget.value, 0, 10000))}
          disabled={disabled}
        />
      </label>
      <label>
        <span>{uiText("Audio start")}</span>
        <input
          aria-label={uiText("Audio start ms")}
          type="number"
          min="0"
          max="3600000"
          step="250"
          value={audioStartMs}
          onChange={(event) => onAudioStartMsChange(clampNumber(event.currentTarget.value, 0, 3_600_000))}
          disabled={disabled || music !== "custom"}
        />
      </label>
      <label>
        <span>{uiText("Audio end")}</span>
        <input
          aria-label={uiText("Audio end ms")}
          type="number"
          min="0"
          max="3600000"
          step="250"
          value={audioEndMs}
          onChange={(event) => onAudioEndMsChange(clampNumber(event.currentTarget.value, 0, 3_600_000))}
          disabled={disabled || music !== "custom"}
        />
      </label>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onSetAudioStartFromSelection}
        disabled={!selectedCount || disabled}
        title={audioPlacementStartSourcePath ? fileName(audioPlacementStartSourcePath) : uiText("Set audio start from selection")}
      >
        <Clock size={14} />
        <span>{uiText("Set audio start")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onSetAudioEndFromSelection}
        disabled={!selectedCount || disabled}
        title={audioPlacementEndSourcePath ? fileName(audioPlacementEndSourcePath) : uiText("Set audio end from selection")}
      >
        <Clock size={14} />
        <span>{uiText("Set audio end")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onClearAudioPlacement} disabled={(!audioPlacementStartSourcePath && !audioPlacementEndSourcePath) || disabled}>
        <X size={14} />
        <span>{uiText("Clear audio range")}</span>
      </button>
    </>
  );
}
