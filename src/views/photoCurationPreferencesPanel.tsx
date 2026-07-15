import { ExternalLink, EyeOff, RotateCcw, X } from "lucide-react";
import type { ExternalEditorFavorite, PhotoCurationPreferencesValue } from "../types";
import type { PhotoCurationPreferenceKind } from "./photoCurationPreferences";

type PhotoCurationPreferencesPanelText = (value: string) => string;

type PhotoMemoryPreferenceListKey = "favoriteMemories" | "hiddenMemories";

export type PhotoCurationPreferencesPanelProps = {
  externalEditors: ExternalEditorFavorite[];
  preferences: PhotoCurationPreferencesValue;
  featureLessTotal: number;
  memoryFeedbackTotal: number;
  total: number;
  saving: boolean;
  error: string;
  uiText: PhotoCurationPreferencesPanelText;
  formatCount: (value: number) => string;
  memoryPreferenceLabel: (memoryId: string) => string;
  onForgetExternalEditor?: (editorPath?: string | null) => void | Promise<void>;
  onClearFeatureLess: () => void;
  onResetMemoryFeedback: () => void;
  onRemoveFeatureLessPreference: (kind: PhotoCurationPreferenceKind, value: string) => void;
  onRemoveMemoryPreference: (key: PhotoMemoryPreferenceListKey, memoryId: string) => void;
  onClearMemoryRemoved: (memoryId: string) => void;
};

export function PhotoCurationPreferencesPanel(props: PhotoCurationPreferencesPanelProps) {
  const preferenceGroups: Array<{ kind: PhotoCurationPreferenceKind; label: string; values: string[] }> = [
    { kind: "person", label: props.uiText("People"), values: props.preferences.featureLessPeople },
    { kind: "place", label: props.uiText("Places"), values: props.preferences.featureLessPlaces },
    { kind: "date", label: props.uiText("Dates"), values: props.preferences.featureLessDates },
    { kind: "content", label: props.uiText("Content"), values: props.preferences.featureLessContent },
  ];

  return (
    <>
      {props.externalEditors.length > 0 && (
        <div className="photo-curation-preferences" aria-label={props.uiText("External editors")}>
          <div className="photo-curation-preferences-head">
            <span>
              <ExternalLink size={14} />
              <strong>{props.uiText("External editors")}</strong>
              <small>{props.formatCount(props.externalEditors.length)}</small>
            </span>
          </div>
          <div className="photo-curation-preference-list">
            {props.externalEditors.map((editor) => (
              <button
                key={editor.editorPath}
                type="button"
                className="ghost compact-action"
                onClick={() => void props.onForgetExternalEditor?.(editor.editorPath)}
                title={editor.editorPath}
                disabled={!props.onForgetExternalEditor}
              >
                <X size={13} />
                <span>{props.uiText("Forget")} {editor.label || props.uiText("editor")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="photo-curation-preferences" aria-label={props.uiText("Curation preferences")}>
        <div className="photo-curation-preferences-head">
          <span>
            <EyeOff size={14} />
            <strong>{props.uiText("Feature less")}</strong>
            <small>{props.formatCount(props.featureLessTotal)}</small>
          </span>
          <div className="photo-curation-preferences-actions">
            <button
              type="button"
              className="ghost compact-action"
              onClick={props.onClearFeatureLess}
              disabled={props.saving || props.featureLessTotal === 0}
            >
              <RotateCcw size={13} />
              <span>{props.saving ? props.uiText("Saving") : props.uiText("Reset")}</span>
            </button>
            <button
              type="button"
              className="ghost compact-action"
              onClick={props.onResetMemoryFeedback}
              disabled={props.saving || props.memoryFeedbackTotal === 0}
            >
              <RotateCcw size={13} />
              <span>{props.saving ? props.uiText("Saving") : props.uiText("Reset Memory feedback")}</span>
              <small>{props.formatCount(props.memoryFeedbackTotal)}</small>
            </button>
          </div>
        </div>
        {preferenceGroups.map((group) => (
          group.values.length > 0 && (
            <div key={group.kind} className="photo-curation-preference-group">
              <small>{group.label}</small>
              <div>
                {group.values.map((value) => (
                  <button
                    key={`${group.kind}:${value}`}
                    type="button"
                    className="photo-curation-preference-chip"
                    onClick={() => props.onRemoveFeatureLessPreference(group.kind, value)}
                    disabled={props.saving}
                    title={props.uiText("Remove")}
                  >
                    <span>{value}</span>
                    <X size={12} />
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
        {props.preferences.favoriteMemories.length > 0 && (
          <div className="photo-curation-preference-group">
            <small>{props.uiText("Favorite memories")}</small>
            <div>
              {props.preferences.favoriteMemories.map((memoryId) => (
                <button
                  key={`favorite-memory:${memoryId}`}
                  type="button"
                  className="photo-curation-preference-chip"
                  onClick={() => props.onRemoveMemoryPreference("favoriteMemories", memoryId)}
                  disabled={props.saving}
                  title={props.uiText("Remove")}
                >
                  <span>{props.memoryPreferenceLabel(memoryId)}</span>
                  <X size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        {props.preferences.hiddenMemories.length > 0 && (
          <div className="photo-curation-preference-group">
            <small>{props.uiText("Featured less memories")}</small>
            <div>
              {props.preferences.hiddenMemories.map((memoryId) => (
                <button
                  key={`hidden-memory:${memoryId}`}
                  type="button"
                  className="photo-curation-preference-chip"
                  onClick={() => props.onRemoveMemoryPreference("hiddenMemories", memoryId)}
                  disabled={props.saving}
                  title={props.uiText("Remove")}
                >
                  <span>{props.memoryPreferenceLabel(memoryId)}</span>
                  <X size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        {Object.entries(props.preferences.memoryRemovedItems).length > 0 && (
          <div className="photo-curation-preference-group">
            <small>{props.uiText("Removed from memories")}</small>
            <div>
              {Object.entries(props.preferences.memoryRemovedItems).map(([memoryId, sourcePaths]) => (
                <button
                  key={`removed-memory:${memoryId}`}
                  type="button"
                  className="photo-curation-preference-chip"
                  onClick={() => props.onClearMemoryRemoved(memoryId)}
                  disabled={props.saving}
                  title={props.uiText("Reset")}
                >
                  <span>{props.memoryPreferenceLabel(memoryId)} · {props.formatCount(sourcePaths.length)}</span>
                  <RotateCcw size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
        {props.total === 0 && <small>{props.uiText("None")}</small>}
        {props.error && <small className="photo-metadata-error">{props.error}</small>}
      </div>
    </>
  );
}
