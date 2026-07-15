import { X } from "lucide-react";

import type { PhotoKeyword } from "../types";
import { PHOTO_SHORTCUT_DISCOVERY_GROUPS } from "./photoKeyboardShortcuts";

type PhotoShortcutsPanelText = (value: string) => string;

export type PhotoShortcutsPanelProps = {
  keywordShortcuts: PhotoKeyword[];
  uiText: PhotoShortcutsPanelText;
  onClose: () => void;
};

export function PhotoShortcutsPanel(props: PhotoShortcutsPanelProps) {
  return (
    <section className="photos-shortcut-panel" aria-label={props.uiText("Photos shortcuts")}>
      <header>
        <div>
          <strong>{props.uiText("Photos shortcuts")}</strong>
          <small>{props.uiText("Press ? to show or hide this panel")}</small>
        </div>
        <button type="button" className="ghost compact-action" onClick={props.onClose} aria-label={props.uiText("Close shortcuts")}>
          <X size={14} />
          <span>{props.uiText("Close")}</span>
        </button>
      </header>
      <div className="photos-shortcut-groups">
        {PHOTO_SHORTCUT_DISCOVERY_GROUPS.map((group) => (
          <div key={group.id} className="photos-shortcut-group">
            <strong>{props.uiText(group.label)}</strong>
            <dl>
              {group.items.map((item) => (
                <div key={`${group.id}:${item.command || item.action}`} className="photos-shortcut-row">
                  <dt>{props.uiText(item.action)}</dt>
                  <dd>
                    {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        {props.keywordShortcuts.length > 0 && (
          <div className="photos-shortcut-group">
            <strong>{props.uiText("Keywords")}</strong>
            <dl>
              {props.keywordShortcuts.map((keyword) => (
                <div key={keyword.keywordId || keyword.name} className="photos-shortcut-row">
                  <dt>{keyword.name}</dt>
                  <dd><kbd>{String(keyword.shortcut || "").trim()}</kbd></dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
