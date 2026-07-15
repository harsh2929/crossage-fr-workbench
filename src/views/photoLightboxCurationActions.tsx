import { EyeOff, MinusCircle } from "lucide-react";
import type { PhotoFeatureLessSuggestion } from "./photoCurationPreferences";

type PhotoLightboxCurationActionsProps = {
  sourcePath: string;
  activeMemory: boolean;
  busy: boolean;
  photoCurationSaving: boolean;
  suggestions: PhotoFeatureLessSuggestion[];
  error: string;
  uiText: (value: string) => string;
  onRemoveFromMemory: (sourcePaths: string[]) => unknown;
  onToggleFeatureLessSuggestion: (suggestion: PhotoFeatureLessSuggestion) => unknown;
};

export function PhotoLightboxCurationActions({
  sourcePath,
  activeMemory,
  busy,
  photoCurationSaving,
  suggestions,
  error,
  uiText,
  onRemoveFromMemory,
  onToggleFeatureLessSuggestion,
}: PhotoLightboxCurationActionsProps) {
  return (
    <>
      {activeMemory && (
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => void onRemoveFromMemory([sourcePath])}
          disabled={busy || photoCurationSaving}
        >
          <MinusCircle size={16} />
          <span>{uiText("Remove from memory")}</span>
        </button>
      )}
      {suggestions.length > 0 && (
        <div className="photos-lightbox-curation-actions" aria-label={uiText("Feature less")}>
          <span>
            <EyeOff size={14} />
            <strong>{uiText("Feature less")}</strong>
          </span>
          <div>
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.kind}:${suggestion.value}`}
                type="button"
                className={suggestion.active ? "secondary compact-action active" : "secondary compact-action"}
                onClick={() => void onToggleFeatureLessSuggestion(suggestion)}
                disabled={photoCurationSaving}
                title={suggestion.targetLabel}
              >
                <EyeOff size={14} />
                <span>{suggestion.active ? uiText("Featured less") : uiText(suggestion.actionLabel)}</span>
              </button>
            ))}
          </div>
          {error && <small className="photo-metadata-error">{error}</small>}
        </div>
      )}
    </>
  );
}
