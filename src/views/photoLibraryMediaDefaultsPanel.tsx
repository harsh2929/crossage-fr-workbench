import { RefreshCcw } from "lucide-react";
import type { PhotoHdrViewingMode, PhotoLibraryMediaSettingsOverride, PhotoVideoAutoplayMode } from "./photoSettings";

type PhotoLibraryMediaDefaultsPanelText = (value: string) => string;

export type PhotoLibraryMediaDefaultsSettings = {
  videoAutoplay: PhotoVideoAutoplayMode;
  pauseVideoWhenBackgrounded: boolean;
  hdrViewing: PhotoHdrViewingMode;
};

export type PhotoLibraryMediaDefaultsPanelProps = {
  rootPath: string;
  rootLabel: string;
  hasCustomDefaults: boolean;
  settings: PhotoLibraryMediaDefaultsSettings;
  uiText: PhotoLibraryMediaDefaultsPanelText;
  onChange: (patch: PhotoLibraryMediaSettingsOverride) => void;
  onReset: () => void;
};

export function PhotoLibraryMediaDefaultsPanel(props: PhotoLibraryMediaDefaultsPanelProps) {
  if (!props.rootPath) return null;
  return (
    <div className="photo-settings-library-media" aria-label={props.uiText("Library media defaults")}>
      <span className="photo-settings-library-media-head">
        <strong>{props.uiText("Library media defaults")}</strong>
        <small title={props.rootPath}>
          {props.hasCustomDefaults
            ? `${props.uiText("Custom")} · ${props.rootLabel}`
            : `${props.uiText("Global")} · ${props.rootLabel}`}
        </small>
      </span>
      <label>
        <span>{props.uiText("Video autoplay")}</span>
        <select
          value={props.settings.videoAutoplay}
          onChange={(event) => props.onChange({ videoAutoplay: event.currentTarget.value as PhotoVideoAutoplayMode })}
        >
          <option value="off">{props.uiText("Off")}</option>
          <option value="muted">{props.uiText("Muted")}</option>
          <option value="sound">{props.uiText("With sound")}</option>
        </select>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.pauseVideoWhenBackgrounded}
          onChange={(event) => props.onChange({ pauseVideoWhenBackgrounded: event.currentTarget.checked })}
        />
        <span>{props.uiText("Pause when backgrounded")}</span>
      </label>
      <label>
        <span>{props.uiText("HDR viewing")}</span>
        <select
          value={props.settings.hdrViewing}
          onChange={(event) => props.onChange({ hdrViewing: event.currentTarget.value as PhotoHdrViewingMode })}
        >
          <option value="auto">{props.uiText("Auto")}</option>
          <option value="standard">{props.uiText("Standard")}</option>
          <option value="hdr">{props.uiText("HDR")}</option>
        </select>
      </label>
      <button
        type="button"
        className="ghost compact-action"
        onClick={props.onReset}
        disabled={!props.hasCustomDefaults}
      >
        <RefreshCcw size={13} />
        <span>{props.uiText("Reset media defaults")}</span>
      </button>
    </div>
  );
}
