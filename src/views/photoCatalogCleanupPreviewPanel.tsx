import { AlertTriangle, Check, Wrench } from "lucide-react";
import type { PhotoLibraryCatalogCleanupValue } from "../types";

type PhotoCatalogCleanupPreviewPanelText = (value: string) => string;

export type PhotoCatalogCleanupPreviewPanelProps = {
  value: PhotoLibraryCatalogCleanupValue | null;
  busy: boolean;
  cleaning: boolean;
  previewing: boolean;
  uiText: PhotoCatalogCleanupPreviewPanelText;
  formatCount: (value: number) => string;
  onApply: () => void;
};

export function PhotoCatalogCleanupPreviewPanel(props: PhotoCatalogCleanupPreviewPanelProps) {
  if (!props.value) return null;
  const operationRows = props.value.operations.filter((operation) => operation.count > 0 || operation.cleaned > 0);
  return (
    <div className="photo-catalog-cleanup-preview" aria-label={props.uiText("Catalog cleanup preview")}>
      <div className={props.value.counts.cleanupCandidates > 0 ? "photo-catalog-cleanup-summary warn" : "photo-catalog-cleanup-summary ok"}>
        {props.value.counts.cleanupCandidates > 0 ? <AlertTriangle size={14} /> : <Check size={14} />}
        <span>
          <strong>{props.value.applied ? props.uiText("Catalog cleanup applied") : props.uiText("Catalog cleanup preview")}</strong>
          <small>
            {props.formatCount(props.value.counts.cleanupCandidates)} {props.uiText("candidate rows")} · {props.formatCount(props.value.counts.cleanedRows)} {props.uiText("cleaned")} · {props.formatCount(props.value.counts.remainingCandidates)} {props.uiText("remaining")}
          </small>
          <small>{props.uiText("Scope")}: {props.uiText("Workspace catalog")}</small>
        </span>
        {!props.value.applied && props.value.counts.cleanupCandidates > 0 && (
          <button
            type="button"
            className="secondary compact-action"
            onClick={props.onApply}
            disabled={props.busy || props.cleaning || props.previewing}
          >
            <Wrench size={13} />
            <span>{props.cleaning ? props.uiText("Cleaning") : props.uiText("Apply cleanup")}</span>
          </button>
        )}
      </div>
      {operationRows.length > 0 && (
        <div className="photo-catalog-cleanup-operation-list">
          {operationRows.slice(0, 6).map((operation) => (
            <article key={operation.id} className="photo-catalog-cleanup-operation">
              <strong>{props.uiText(operation.label || operation.id)}</strong>
              <small>
                {props.formatCount(operation.count)} {props.uiText("found")} · {props.formatCount(operation.cleaned)} {props.uiText("cleaned")} · {props.formatCount(operation.remaining)} {props.uiText("remaining")}
              </small>
              <small>{operation.reason}</small>
            </article>
          ))}
        </div>
      )}
      {props.value.recommendations.length > 0 && (
        <small className="photo-repair-status">{props.value.recommendations[0]}</small>
      )}
    </div>
  );
}
