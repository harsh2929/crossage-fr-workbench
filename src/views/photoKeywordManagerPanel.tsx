import { Check, ClipboardPaste, Download, ExternalLink, Trash2, X } from "lucide-react";

import type { PhotoKeyword } from "../types";

export type PhotoKeywordDraft = {
  name: string;
  shortcut: string;
};

type PhotoKeywordManagerPanelText = (value: string) => string;
type PhotoKeywordManagerPanelCount = (value: number) => string;
type PhotoKeywordManagerPanelAction = void | Promise<void>;

export type PhotoKeywordManagerPanelProps = {
  keywords: readonly PhotoKeyword[];
  drafts: Record<string, PhotoKeywordDraft>;
  saving: boolean;
  error: string;
  newKeywordName: string;
  newKeywordShortcut: string;
  importJson: string;
  transferMessage: string;
  exportPath: string;
  uiText: PhotoKeywordManagerPanelText;
  formatCount: PhotoKeywordManagerPanelCount;
  onClose: () => void;
  onNewKeywordNameChange: (value: string) => void;
  onNewKeywordShortcutChange: (value: string) => void;
  onImportJsonChange: (value: string) => void;
  onDraftChange: (keywordId: string, draft: PhotoKeywordDraft) => void;
  onCreateKeyword: () => PhotoKeywordManagerPanelAction;
  onSaveKeyword: (keyword: PhotoKeyword) => PhotoKeywordManagerPanelAction;
  onDeleteKeyword: (keyword: PhotoKeyword) => PhotoKeywordManagerPanelAction;
  onExportKeywords: () => PhotoKeywordManagerPanelAction;
  onImportKeywords: () => PhotoKeywordManagerPanelAction;
  onRevealExport: (path: string) => PhotoKeywordManagerPanelAction;
};

export function PhotoKeywordManagerPanel(props: PhotoKeywordManagerPanelProps) {
  return (
    <div className="photos-keyword-panel">
      <div className="photos-keyword-panel-head">
        <strong>{props.uiText("Keyword manager")}</strong>
        <button type="button" className="ghost compact-action" onClick={props.onClose} disabled={props.saving}>
          <X size={14} />
          <span>{props.uiText("Close")}</span>
        </button>
      </div>
      <div className="photos-keyword-row new">
        <input
          aria-label={props.uiText("New keyword name")}
          value={props.newKeywordName}
          onChange={(event) => props.onNewKeywordNameChange(event.currentTarget.value)}
          placeholder={props.uiText("Keyword")}
          disabled={props.saving}
        />
        <input
          aria-label={props.uiText("New keyword shortcut")}
          value={props.newKeywordShortcut}
          onChange={(event) => props.onNewKeywordShortcutChange(event.currentTarget.value)}
          placeholder={props.uiText("Shortcut")}
          disabled={props.saving}
        />
        <button type="button" className="secondary compact-action" onClick={() => void props.onCreateKeyword()} disabled={props.saving || !props.newKeywordName.trim()}>
          <Check size={14} />
          <span>{props.uiText("Create keyword")}</span>
        </button>
      </div>
      <div className="photos-keyword-transfer">
        <div className="photos-keyword-transfer-actions">
          <button type="button" className="secondary compact-action" onClick={() => void props.onExportKeywords()} disabled={props.saving}>
            <Download size={14} />
            <span>{props.uiText("Export keywords")}</span>
          </button>
          <button type="button" className="secondary compact-action" onClick={() => void props.onImportKeywords()} disabled={props.saving || !props.importJson.trim()}>
            <ClipboardPaste size={14} />
            <span>{props.uiText("Import keywords")}</span>
          </button>
          {props.exportPath && (
            <button type="button" className="ghost compact-action" onClick={() => void props.onRevealExport(props.exportPath)} disabled={props.saving}>
              <ExternalLink size={14} />
              <span>{props.uiText("Reveal export")}</span>
            </button>
          )}
        </div>
        <textarea
          aria-label={props.uiText("Keyword import JSON")}
          value={props.importJson}
          onChange={(event) => props.onImportJsonChange(event.currentTarget.value)}
          placeholder={props.uiText("Paste exported keyword JSON")}
          rows={3}
          disabled={props.saving}
        />
        {props.transferMessage && (
          <small className="photos-keyword-transfer-status">
            {props.transferMessage}
            {props.exportPath ? ` · ${props.exportPath}` : ""}
          </small>
        )}
      </div>
      {props.keywords.length ? (
        <div className="photos-keyword-list">
          {props.keywords.map((keyword) => {
            const draft = props.drafts[keyword.keywordId] || { name: keyword.name, shortcut: keyword.shortcut || "" };
            const changed = draft.name !== keyword.name || draft.shortcut !== (keyword.shortcut || "");
            return (
              <div className="photos-keyword-row" key={keyword.keywordId || keyword.name}>
                <input
                  aria-label={`${props.uiText("Keyword")} ${keyword.name}`}
                  value={draft.name}
                  onChange={(event) => props.onDraftChange(keyword.keywordId, { ...draft, name: event.currentTarget.value })}
                  disabled={props.saving}
                />
                <input
                  aria-label={`${props.uiText("Shortcut")} ${keyword.name}`}
                  value={draft.shortcut}
                  onChange={(event) => props.onDraftChange(keyword.keywordId, { ...draft, shortcut: event.currentTarget.value })}
                  placeholder={props.uiText("Shortcut")}
                  disabled={props.saving}
                />
                <span className="photos-keyword-count">{props.formatCount(keyword.count)}</span>
                <button type="button" className="secondary compact-action" onClick={() => void props.onSaveKeyword(keyword)} disabled={props.saving || !changed || !draft.name.trim()}>
                  <Check size={14} />
                  <span>{props.uiText("Save")}</span>
                </button>
                <button type="button" className="ghost compact-action danger" onClick={() => void props.onDeleteKeyword(keyword)} disabled={props.saving}>
                  <Trash2 size={14} />
                  <span>{props.uiText("Delete")}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="compact">{props.uiText("No keywords yet")}</p>
      )}
      {props.error && <p className="photo-album-item-error">{props.error}</p>}
    </div>
  );
}
