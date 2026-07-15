import { Archive, ChevronRight, EyeOff, ImageIcon, Lock, MinusCircle, Send, Unlock } from "lucide-react";
import type { PhotoRailDisplayPreferenceKey } from "./photoRailVisibility";

type PhotoRailDisplayControlsText = (value: string) => string;

export type PhotoRailDisplayControlsProps = {
  showUtilityCollections: boolean;
  showSensitiveCollections: boolean;
  showScreenshotCollections: boolean;
  showSharedCollections: boolean;
  showLowValueCollections: boolean;
  sensitiveCollectionsUnlocked: boolean;
  uiText: PhotoRailDisplayControlsText;
  onPreferenceChange: (key: PhotoRailDisplayPreferenceKey, value: boolean) => void;
  onLockSensitiveCollections: () => void;
  onUnlockSensitiveCollections: () => void;
};

export function PhotoRailDisplayControls(props: PhotoRailDisplayControlsProps) {
  return (
    <details className="photo-rail-display-disclosure">
      <summary>
        <Archive size={14} />
        <span>
          <strong>{props.uiText("Customize collections")}</strong>
          <small>{props.uiText("Choose what appears in the sidebar")}</small>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      <div className="photo-rail-display-controls" aria-label={props.uiText("Collection display")}>
        <label>
          <input type="checkbox" checked={props.showUtilityCollections} onChange={(event) => props.onPreferenceChange("showUtilityCollections", event.currentTarget.checked)} />
          <Archive size={14} />
          <span>{props.uiText("Utilities")}</span>
        </label>
        <label>
          <input type="checkbox" checked={props.showSensitiveCollections} onChange={(event) => props.onPreferenceChange("showSensitiveCollections", event.currentTarget.checked)} />
          <EyeOff size={14} />
          <span>{props.uiText("Sensitive")}</span>
        </label>
        <label>
          <input type="checkbox" checked={props.showScreenshotCollections} onChange={(event) => props.onPreferenceChange("showScreenshotCollections", event.currentTarget.checked)} />
          <ImageIcon size={14} />
          <span>{props.uiText("Screenshots")}</span>
        </label>
        <label>
          <input type="checkbox" checked={props.showSharedCollections} onChange={(event) => props.onPreferenceChange("showSharedCollections", event.currentTarget.checked)} />
          <Send size={14} />
          <span>{props.uiText("Shared")}</span>
        </label>
        <label>
          <input type="checkbox" checked={props.showLowValueCollections} onChange={(event) => props.onPreferenceChange("showLowValueCollections", event.currentTarget.checked)} />
          <MinusCircle size={14} />
          <span>{props.uiText("Low-value")}</span>
        </label>
        <button
          type="button"
          className={props.sensitiveCollectionsUnlocked ? "active" : ""}
          onClick={() => props.sensitiveCollectionsUnlocked ? props.onLockSensitiveCollections() : props.onUnlockSensitiveCollections()}
          aria-pressed={props.sensitiveCollectionsUnlocked}
        >
          {props.sensitiveCollectionsUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
          <span>{props.sensitiveCollectionsUnlocked ? props.uiText("Unlocked") : props.uiText("Locked")}</span>
        </button>
      </div>
    </details>
  );
}
