import type { ReactNode } from "react";
import { Check, Layers, RefreshCcw, SlidersHorizontal, X } from "lucide-react";
import type { PhotoAlbumPreviewValue, PhotoAlbumRules, PhotoFolder, PhotoSmartQueryGroup } from "../types";
import type { PhotoAlbumKind } from "./photoAlbumEditorState";

type PhotoAlbumEditorPanelText = (value: string) => string;

export type PhotoAlbumEditorPanelProps = {
  busy: boolean;
  saving: boolean;
  albumKind: PhotoAlbumKind;
  name: string;
  description: string;
  folderId: string;
  albumFolders: PhotoFolder[];
  activeAlbum: PhotoFolder | null;
  editingAlbumId: string;
  people: string[];
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  smartQueryDraft: PhotoSmartQueryGroup;
  smartQueryDraftHasConditions: boolean;
  albumCriteriaUsingLegacy: boolean;
  albumRulesUsingSmartQuery: boolean;
  preview: PhotoAlbumPreviewValue | null;
  previewLoading: boolean;
  previewError: string;
  error: string;
  uiText: PhotoAlbumEditorPanelText;
  formatCount: (value: number) => string;
  renderSmartQueryGroup: (group: PhotoSmartQueryGroup) => ReactNode;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAlbumKindChange: (value: PhotoAlbumKind) => void;
  onFolderChange: (value: string) => void;
  onTogglePerson: (list: "include" | "exclude", person: string) => void;
  onRulesChange: (patch: Partial<PhotoAlbumRules>) => void;
  onMigrateActiveSmartAlbum: () => void;
  onApplySmartQuery: () => void;
  onClearSmartQuery: () => void;
  onSave: () => void;
  onCancel: () => void;
};

export function PhotoAlbumEditorPanel(props: PhotoAlbumEditorPanelProps) {
  return (
    <div className="photo-album-editor">
      <input
        aria-label={props.uiText("Album name")}
        value={props.name}
        onChange={(event) => props.onNameChange(event.currentTarget.value)}
        placeholder={props.uiText("Album name")}
      />
      <textarea
        aria-label={props.uiText("Album description")}
        value={props.description}
        onChange={(event) => props.onDescriptionChange(event.currentTarget.value)}
        placeholder={props.uiText("Description")}
        rows={2}
      />
      <label className="photo-album-kind-field">
        <span>{props.uiText("Album type")}</span>
        <select value={props.albumKind} onChange={(event) => props.onAlbumKindChange(event.currentTarget.value as PhotoAlbumKind)}>
          <option value="smart">{props.uiText("Smart")}</option>
          <option value="manual">{props.uiText("Manual")}</option>
        </select>
      </label>
      <label className="photo-album-kind-field">
        <span>{props.uiText("Album folder")}</span>
        <select value={props.folderId} onChange={(event) => props.onFolderChange(event.currentTarget.value)}>
          <option value="">{props.uiText("Top level")}</option>
          {props.albumFolders.map((folder) => (
            <option key={folder.id} value={folder.folderId || folder.id.replace(/^albumFolder:/, "")}>{folder.name}</option>
          ))}
        </select>
      </label>
      {props.activeAlbum && props.editingAlbumId === props.activeAlbum.albumId && (
        <div className="photo-rule-preview">
          <Layers size={14} />
          <span>{props.formatCount(props.activeAlbum.count)} {props.activeAlbum.count === 1 ? props.uiText("photo") : props.uiText("photos")} {props.uiText("match")}</span>
        </div>
      )}
      {props.albumKind === "smart" && (
        <>
          <div className="photo-album-people">
            <strong>{props.uiText("Include people")}</strong>
            {props.people.length ? props.people.map((person) => (
              <label key={`include-${person}`}>
                <input
                  type="checkbox"
                  checked={props.includePeople.includes(person)}
                  onChange={() => props.onTogglePerson("include", person)}
                />
                <span>{person}</span>
              </label>
            )) : <small>{props.uiText("No people yet")}</small>}
          </div>
          <div className="photo-album-people">
            <strong>{props.uiText("Exclude people")}</strong>
            {props.people.length ? props.people.map((person) => (
              <label key={`exclude-${person}`}>
                <input
                  type="checkbox"
                  checked={props.excludePeople.includes(person)}
                  onChange={() => props.onTogglePerson("exclude", person)}
                />
                <span>{person}</span>
              </label>
            )) : <small>{props.uiText("No people yet")}</small>}
          </div>
          <div className="photo-rule-grid">
            <label>{props.uiText("Search text")}
              <input value={props.rules.query || ""} onChange={(event) => props.onRulesChange({ query: event.currentTarget.value || undefined })} placeholder={props.uiText("Title, caption, person, path")} />
            </label>
            <label>{props.uiText("Keyword rule")}
              <input value={props.rules.keyword || ""} onChange={(event) => props.onRulesChange({ keyword: event.currentTarget.value || undefined })} placeholder={props.uiText("Exact keyword")} />
            </label>
            <label>{props.uiText("Status")}
              <select
                multiple
                value={props.rules.statuses || []}
                onChange={(event) => props.onRulesChange({ statuses: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) as PhotoAlbumRules["statuses"] })}
              >
                <option value="pending">{props.uiText("Pending")}</option>
                <option value="accepted">{props.uiText("Accepted")}</option>
                <option value="uncertain">{props.uiText("Not sure")}</option>
                <option value="rejected">{props.uiText("Rejected")}</option>
              </select>
            </label>
            <label>{props.uiText("Media")}
              <select value={props.rules.mediaKind || ""} onChange={(event) => props.onRulesChange({ mediaKind: event.currentTarget.value || undefined })}>
                <option value="">{props.uiText("Any")}</option>
                <option value="image">{props.uiText("Images")}</option>
                <option value="video">{props.uiText("Videos")}</option>
                <option value="screenshot">{props.uiText("Screenshots")}</option>
                <option value="screen_recording">{props.uiText("Screen Recordings")}</option>
                <option value="panorama">{props.uiText("Panoramas")}</option>
                <option value="portrait">{props.uiText("Portraits")}</option>
                <option value="burst">{props.uiText("Bursts")}</option>
                <option value="time_lapse">{props.uiText("Time-lapse")}</option>
                <option value="raw">{props.uiText("RAW")}</option>
                <option value="live_photo">{props.uiText("Live Photos")}</option>
                <option value="other">{props.uiText("Other")}</option>
              </select>
            </label>
            <label>{props.uiText("From")}
              <input type="date" value={props.rules.dateFrom || ""} onChange={(event) => props.onRulesChange({ dateFrom: event.currentTarget.value || undefined })} />
            </label>
            <label>{props.uiText("To")}
              <input type="date" value={props.rules.dateTo || ""} onChange={(event) => props.onRulesChange({ dateTo: event.currentTarget.value || undefined })} />
            </label>
            <label>{props.uiText("Folder")}
              <input value={props.rules.folder || ""} onChange={(event) => props.onRulesChange({ folder: event.currentTarget.value || undefined })} placeholder={props.uiText("Path contains")} />
            </label>
            <label>{props.uiText("Recent days")}
              <input type="number" min={1} max={3650} value={props.rules.recentDays || ""} onChange={(event) => props.onRulesChange({ recentDays: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
            </label>
            <label>{props.uiText("Min score")}
              <input type="number" min={0} max={1} step={0.01} value={props.rules.minScore ?? ""} onChange={(event) => props.onRulesChange({ minScore: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
            </label>
            <label>{props.uiText("Min quality")}
              <input type="number" min={0} max={1} step={0.01} value={props.rules.minQuality ?? ""} onChange={(event) => props.onRulesChange({ minQuality: event.currentTarget.value ? Number(event.currentTarget.value) : undefined })} />
            </label>
            <label className="photo-rule-toggle">
              <input type="checkbox" checked={Boolean(props.rules.hasVideoFrames)} onChange={(event) => props.onRulesChange({ hasVideoFrames: event.currentTarget.checked || undefined })} />
              <span>{props.uiText("Has video frames")}</span>
            </label>
            <label className="photo-rule-toggle">
              <input type="checkbox" checked={Boolean(props.rules.favoriteOnly)} onChange={(event) => props.onRulesChange({ favoriteOnly: event.currentTarget.checked || undefined })} />
              <span>{props.uiText("Favorites only")}</span>
            </label>
            <label className="photo-rule-toggle">
              <input type="checkbox" checked={Boolean(props.rules.editedOnly)} onChange={(event) => props.onRulesChange({ editedOnly: event.currentTarget.checked || undefined })} />
              <span>{props.uiText("Edited only")}</span>
            </label>
            <label className="photo-rule-toggle">
              <input type="checkbox" checked={Boolean(props.rules.unknownOnly)} onChange={(event) => props.onRulesChange({ unknownOnly: event.currentTarget.checked || undefined })} />
              <span>{props.uiText("Unknown only")}</span>
            </label>
          </div>
          <div className="photo-smart-query-builder">
            <div className="photo-smart-query-builder-head">
              <strong>{props.uiText("Visual query")}</strong>
              <div className="photo-smart-query-actions">
                {props.editingAlbumId && props.albumCriteriaUsingLegacy && (
                  <button type="button" className="secondary compact-action" onClick={props.onMigrateActiveSmartAlbum} disabled={props.busy || props.saving}>
                    <RefreshCcw size={14} />
                    <span>{props.uiText("Migrate album")}</span>
                  </button>
                )}
                <button type="button" className="secondary compact-action" onClick={props.onApplySmartQuery} disabled={!props.smartQueryDraftHasConditions}>
                  <SlidersHorizontal size={14} />
                  <span>{props.uiText(props.albumCriteriaUsingLegacy && !props.albumRulesUsingSmartQuery ? "Convert legacy rules" : "Apply query")}</span>
                </button>
                {props.albumRulesUsingSmartQuery && (
                  <button type="button" className="ghost compact-action" onClick={props.onClearSmartQuery}>
                    <X size={14} />
                    <span>{props.uiText("Clear query")}</span>
                  </button>
                )}
              </div>
            </div>
            {(props.previewLoading || props.preview || props.previewError) && (
              <div className="photo-smart-query-preview" role="status">
                <span>
                  {props.previewLoading
                    ? props.uiText("Checking matches...")
                    : props.preview
                      ? `${props.formatCount(props.preview.count)} ${props.preview.count === 1 ? props.uiText("match") : props.uiText("matches")}`
                      : props.uiText("Preview unavailable")}
                </span>
                {props.preview?.previewSamples?.length ? (
                  <small>{props.preview.previewSamples.join(", ")}</small>
                ) : null}
                {props.preview?.validation?.length ? (
                  <small>{props.preview.validation.map((item) => item.message).join(" ")}</small>
                ) : null}
                {props.previewError ? <small>{props.previewError}</small> : null}
              </div>
            )}
            {props.renderSmartQueryGroup(props.smartQueryDraft)}
          </div>
        </>
      )}
      {props.error && <p className="compact warn">{props.error}</p>}
      <div className="photo-album-actions">
        <button type="button" className="secondary compact-action" onClick={props.onSave} disabled={props.busy || props.saving || !props.name.trim()}>
          <Check size={14} />
          <span>{props.uiText("Save")}</span>
        </button>
        <button type="button" className="ghost compact-action" onClick={props.onCancel} disabled={props.saving}>
          <X size={14} />
          <span>{props.uiText("Cancel")}</span>
        </button>
      </div>
    </div>
  );
}
