import type { PhotoHdrViewingMode, PhotoLibraryMediaSettingsOverride, PhotoLocalSettings, PhotoVideoAutoplayMode } from "./photoSettings";

type PhotoMediaPlaybackSettingsPanelText = (value: string) => string;

export type PhotoMediaPlaybackSettings = Pick<PhotoLocalSettings, "videoAutoplay" | "pauseVideoWhenBackgrounded" | "hdrViewing">;

export type PhotoMediaPlaybackSettingsPanelProps = {
  settings: PhotoMediaPlaybackSettings;
  uiText: PhotoMediaPlaybackSettingsPanelText;
  onChange: (patch: PhotoLibraryMediaSettingsOverride) => void;
};

export function PhotoMediaPlaybackSettingsPanel(props: PhotoMediaPlaybackSettingsPanelProps) {
  return (
    <>
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
        <span>{props.uiText("Pause video when backgrounded")}</span>
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
    </>
  );
}
