import { ArrowRight, Check, Network, RefreshCcw, Search, X } from "lucide-react";

import type { PhotoFolder, PhotoRelationshipNameSuggestion, PhotoRelationshipNameSuggestionResult } from "../types";
import { photoCoverCropStyle } from "./photoCoverCrops";
import "./photoRelationshipSuggestionsPanel.css";

type Props = {
  result: PhotoRelationshipNameSuggestionResult | null;
  folders: PhotoFolder[];
  loading: boolean;
  reviewingId: string;
  error: string;
  busy: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onLoad: () => void | Promise<void>;
  onApply: (suggestion: PhotoRelationshipNameSuggestion) => void | Promise<void>;
  onDismiss: (suggestion: PhotoRelationshipNameSuggestion) => void | Promise<void>;
};

function folderForName(folders: PhotoFolder[], name: string, kind: "person" | "unknown"): PhotoFolder | null {
  const key = String(name || "").trim().toLocaleLowerCase();
  return folders.find((folder) => folder.kind === kind && folder.name.trim().toLocaleLowerCase() === key) || null;
}

function identityCover(folder: PhotoFolder | null, label: string) {
  return (
    <span className="photo-relationship-identity-cover">
      {folder?.coverPreviewUrl
        ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} />
        : <span aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

export function PhotoRelationshipSuggestionsPanel(props: Props) {
  const suggestions = props.result?.suggestions || [];
  return (
    <section className="photo-relationship-suggestions" aria-label={props.uiText("Who is this?")}>
      <header className="photo-relationship-suggestions-head">
        <div>
          <Network size={16} />
          <span>
            <strong>{props.uiText("Who is this?")}</strong>
            <small>{props.uiText("Relationship clues")}</small>
          </span>
        </div>
        <button type="button" className="ghost compact-action" onClick={() => void props.onLoad()} disabled={props.loading || props.busy}>
          {props.result ? <RefreshCcw size={14} /> : <Search size={14} />}
          <span>{props.loading ? props.uiText("Finding suggestions") : props.result ? props.uiText("Refresh suggestions") : props.uiText("Find suggestions")}</span>
        </button>
      </header>

      {props.error ? <p className="photo-metadata-error">{props.error}</p> : null}
      {props.result && !props.result.available ? <p className="photo-relationship-empty">{props.uiText(props.result.reason || "Relationship suggestions are unavailable.")}</p> : null}
      {props.result?.available && suggestions.length === 0 ? <p className="photo-relationship-empty">{props.uiText("No relationship suggestions found.")}</p> : null}

      {suggestions.length > 0 ? (
        <div className="photo-relationship-suggestion-list">
          {suggestions.map((suggestion) => {
            const sourceFolder = folderForName(props.folders, suggestion.sourceCluster, "unknown");
            const targetFolder = folderForName(props.folders, suggestion.targetPerson, "person");
            const reviewing = props.reviewingId === suggestion.suggestionId;
            return (
              <article className="photo-relationship-suggestion-row" key={suggestion.suggestionId}>
                <div className="photo-relationship-identities" aria-label={`${props.uiText("Unnamed person")} ${props.uiText("May be")} ${suggestion.targetPerson}`}>
                  <span>
                    {identityCover(sourceFolder, "?")}
                    <small>{props.uiText("Unnamed person")}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                  <span>
                    {identityCover(targetFolder, suggestion.targetPerson)}
                    <strong>{suggestion.targetPerson}</strong>
                  </span>
                </div>
                <div className="photo-relationship-evidence">
                  <strong>{props.uiText("May be")} {suggestion.targetPerson}</strong>
                  <small>
                    {props.formatCount(suggestion.sharedRelationshipCount)} {props.uiText("shared relationships")}
                    {" · "}
                    {props.formatCount(suggestion.relationshipSupport)} {props.uiText("supporting appearances")}
                  </small>
                  <span className="photo-relationship-neighbors">
                    <small>{props.uiText("Seen around")}</small>
                    {suggestion.sharedRelationships.slice(0, 4).map((relationship) => (
                      <span key={`${suggestion.suggestionId}:${relationship.personName}`}>{relationship.personName} · {props.formatCount(relationship.support)}</span>
                    ))}
                  </span>
                  <small className="photo-relationship-caution">{props.uiText("Relationship context is not proof of identity. Review before merging.")}</small>
                </div>
                <div className="photo-relationship-actions">
                  <button type="button" className="secondary compact-action" onClick={() => void props.onApply(suggestion)} disabled={props.busy || reviewing}>
                    <Check size={14} />
                    <span>{props.uiText("Review and merge")}</span>
                  </button>
                  <button type="button" className="ghost compact-action" onClick={() => void props.onDismiss(suggestion)} disabled={props.busy || reviewing}>
                    <X size={14} />
                    <span>{props.uiText("Not this person")}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
