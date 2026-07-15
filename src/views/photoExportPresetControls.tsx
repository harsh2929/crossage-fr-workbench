import type { CSSProperties } from "react";
import { Check, Download, FolderPlus, ImageIcon, Images, Printer, RefreshCcw, Search, Trash2 } from "lucide-react";
import {
  PHOTO_CREATION_EXPORT_PRESETS,
  type PhotoCreationExportPresetKind,
  type PhotoCreationExportSuggestion,
  type PhotoCreationSuggestionLoadingScope,
  type PhotoExportPreset,
} from "./photoExportPresets";

type PhotoExportPresetControlsProps = {
  presets: PhotoExportPreset[];
  selectedPreset: PhotoExportPreset | null;
  presetId: string;
  presetName: string;
  creationSuggestionsCanLoadFullView: boolean;
  creationSuggestionLoading: boolean;
  creationSuggestionLoadingScope: PhotoCreationSuggestionLoadingScope;
  creationSuggestionFullViewDetail: string;
  creationSuggestionLibraryDetail: string;
  creationSuggestionRefreshBlocked: boolean;
  validCreationSuggestionLibraryCache: boolean;
  creationExportSuggestions: PhotoCreationExportSuggestion[];
  creationSuggestionError: string;
  busy: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onPresetSelect: (presetId: string, presetName: string) => void;
  onPresetNameChange: (value: string) => void;
  onSavePreset: () => void;
  onApplyPreset: () => void;
  onApplyProjectBundlePreset: () => void;
  onApplyCreationPreset: (kind: PhotoCreationExportPresetKind) => void;
  onRefreshViewSuggestions: () => void;
  onRefreshLibrarySuggestions: () => void;
  onApplyCreationSuggestion: (suggestion: PhotoCreationExportSuggestion) => void;
  onDeletePreset: () => void;
};

function creationPresetIcon(kind: PhotoCreationExportPresetKind) {
  if (kind === "collage") return <Images size={14} />;
  if (kind === "poster") return <Printer size={14} />;
  return <ImageIcon size={14} />;
}

function creationCropPreviewStyle(suggestion: PhotoCreationExportSuggestion): CSSProperties {
  return {
    aspectRatio: String(suggestion.cropPreview?.targetAspect || 1),
    backgroundImage: suggestion.coverPreviewUrl ? `url(${JSON.stringify(suggestion.coverPreviewUrl)})` : undefined,
  };
}

export function PhotoExportPresetControls({
  presets,
  selectedPreset,
  presetId,
  presetName,
  creationSuggestionsCanLoadFullView,
  creationSuggestionLoading,
  creationSuggestionLoadingScope,
  creationSuggestionFullViewDetail,
  creationSuggestionLibraryDetail,
  creationSuggestionRefreshBlocked,
  validCreationSuggestionLibraryCache,
  creationExportSuggestions,
  creationSuggestionError,
  busy,
  uiText,
  formatCount,
  onPresetSelect,
  onPresetNameChange,
  onSavePreset,
  onApplyPreset,
  onApplyProjectBundlePreset,
  onApplyCreationPreset,
  onRefreshViewSuggestions,
  onRefreshLibrarySuggestions,
  onApplyCreationSuggestion,
  onDeletePreset,
}: PhotoExportPresetControlsProps) {
  return (
    <div className="photo-export-presets">
      <label>
        <span>{uiText("Export preset")}</span>
        <select
          value={presetId}
          onChange={(event) => {
            const nextId = event.currentTarget.value;
            const preset = presets.find((item) => item.id === nextId);
            onPresetSelect(nextId, preset?.name || "");
          }}
        >
          <option value="">{uiText("Custom export")}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{uiText("Preset name")}</span>
        <input
          aria-label={uiText("Export preset name")}
          type="text"
          value={presetName}
          onChange={(event) => onPresetNameChange(event.currentTarget.value)}
          placeholder={uiText("Preset name")}
        />
      </label>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onSavePreset}
        disabled={!presetName.trim() && !selectedPreset}
      >
        <Check size={14} />
        <span>{uiText("Save preset")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onApplyPreset}
        disabled={!selectedPreset}
      >
        <Download size={14} />
        <span>{uiText("Apply preset")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onApplyProjectBundlePreset}
      >
        <FolderPlus size={14} />
        <span>{uiText("Project bundle")}</span>
      </button>
      <div className="photo-creation-presets" aria-label={uiText("Creation presets")}>
        {PHOTO_CREATION_EXPORT_PRESETS.map((preset) => (
          <button
            key={preset.kind}
            type="button"
            className="secondary compact-action"
            onClick={() => onApplyCreationPreset(preset.kind)}
          >
            {creationPresetIcon(preset.kind)}
            <span>{uiText(preset.label)}</span>
          </button>
        ))}
      </div>
      <div className="photo-creation-suggestions" aria-label={uiText("Creation suggestions")}>
        {creationSuggestionsCanLoadFullView && (
          <button
            type="button"
            className="secondary compact-action"
            onClick={onRefreshViewSuggestions}
            disabled={creationSuggestionLoading || busy}
          >
            <RefreshCcw size={14} />
            <span>{creationSuggestionLoadingScope === "view" ? uiText("Loading suggestions") : uiText("Full view suggestions")}</span>
            <small>{creationSuggestionFullViewDetail}</small>
          </button>
        )}
        <button
          type="button"
          className="secondary compact-action"
          onClick={onRefreshLibrarySuggestions}
          disabled={creationSuggestionLoading || busy || (!validCreationSuggestionLibraryCache && creationSuggestionRefreshBlocked)}
        >
          <Search size={14} />
          <span>{creationSuggestionLoadingScope === "library" ? uiText("Loading library") : uiText("Library suggestions")}</span>
          <small>{creationSuggestionLibraryDetail}</small>
        </button>
        {creationExportSuggestions.map((suggestion) => (
          <button
            key={suggestion.kind}
            type="button"
            className="secondary compact-action"
            onClick={() => onApplyCreationSuggestion(suggestion)}
          >
            {creationPresetIcon(suggestion.kind)}
            <span>{uiText(suggestion.label)}</span>
            {suggestion.cropPreview && (
              <span
                aria-hidden="true"
                className={[
                  "photo-creation-crop-preview",
                  suggestion.cropPreview.safe ? "safe" : "warn",
                  suggestion.coverPreviewUrl ? "has-image" : "",
                ].filter(Boolean).join(" ")}
                style={creationCropPreviewStyle(suggestion)}
              >
                <span>{uiText(suggestion.cropPreview.label)}</span>
              </span>
            )}
            <small>
              {formatCount(suggestion.sourcePaths.length)} {uiText(suggestion.sourcePaths.length === 1 ? "photo" : "photos")} · {suggestion.reasons.slice(0, 2).map((reason) => uiText(reason)).join(" · ")}
              {suggestion.cropPreview ? ` · ${suggestion.cropPreview.detail}` : ""}
            </small>
          </button>
        ))}
        {creationSuggestionError && <small className="photo-metadata-error">{creationSuggestionError}</small>}
      </div>
      <button
        type="button"
        className="ghost compact-action danger"
        onClick={onDeletePreset}
        disabled={!selectedPreset}
      >
        <Trash2 size={14} />
        <span>{uiText("Delete preset")}</span>
      </button>
    </div>
  );
}
