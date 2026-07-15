import { AlertTriangle, Check, Clock } from "lucide-react";

import type { PhotoConsolidationSummary } from "./photoConsolidationResult";
import type { PhotoConsolidationHistoryRow } from "./photoRepairCenter";

type PhotoConsolidationPanelText = (value: string) => string;

export type PhotoConsolidationResultPanelProps = {
  summary: PhotoConsolidationSummary | null;
  error: string;
  status: string;
  uiText: PhotoConsolidationPanelText;
  formatCount: (count: number) => string;
};

export type PhotoConsolidationHistoryPanelProps = {
  rows: PhotoConsolidationHistoryRow[];
  uiText: PhotoConsolidationPanelText;
  formatCount: (count: number) => string;
  formatDateText: (value: string) => string;
};

export function PhotoConsolidationResultPanel(props: PhotoConsolidationResultPanelProps) {
  if (props.error) {
    return (
      <section className="photo-consolidation-result warning" aria-label={props.uiText("Consolidation result")} aria-live="polite">
        <div className="photo-consolidation-result-head">
          <span>
            <strong>{props.uiText("Consolidation failed")}</strong>
            <small>{props.error}</small>
          </span>
        </div>
      </section>
    );
  }
  if (!props.summary) return props.status ? <small>{props.status}</small> : null;

  const resultClass = props.summary.status === "warning" ? "warning" : props.summary.status === "ok" ? "ok" : "empty";
  return (
    <section className={`photo-consolidation-result ${resultClass}`} aria-label={props.uiText("Consolidation result")} aria-live="polite">
      <div className="photo-consolidation-result-head">
        <span>
          <strong>{props.uiText(props.summary.title)}</strong>
          <small>{props.uiText(props.summary.detail)}</small>
        </span>
        {props.summary.status === "warning" ? <AlertTriangle size={15} /> : <Check size={15} />}
      </div>
      <div className="photo-consolidation-result-metrics">
        {props.summary.metrics.map((metric) => (
          <span key={metric.key}>{props.uiText(metric.label)}: {metric.value}</span>
        ))}
      </div>
      {props.summary.managedRootLabel && (
        <small>
          {props.uiText("Managed folder")}: <span title={props.summary.managedRootPath}>{props.summary.managedRootLabel}</span>
        </small>
      )}
      {props.summary.rows.length > 0 && (
        <div className="photo-consolidation-result-rows">
          {props.summary.rows.map((row) => (
            <div className="photo-consolidation-result-row" key={row.key}>
              <strong>{props.uiText(row.label)}</strong>
              <span>{row.sourceName}</span>
              <small>{row.detail}</small>
            </div>
          ))}
        </div>
      )}
      {props.summary.hiddenRowCount > 0 && (
        <small>{props.formatCount(props.summary.hiddenRowCount)} {props.summary.hiddenRowCount === 1 ? props.uiText("more item") : props.uiText("more items")}</small>
      )}
    </section>
  );
}

export function PhotoConsolidationHistoryPanel(props: PhotoConsolidationHistoryPanelProps) {
  if (!props.rows.length) return null;

  return (
    <section className="photo-consolidation-history" aria-label={props.uiText("Recent consolidations")}>
      <div className="photo-consolidation-history-head">
        <Clock size={14} />
        <strong>{props.uiText("Recent consolidations")}</strong>
        <small>{props.formatCount(props.rows.length)}</small>
      </div>
      <div className="photo-consolidation-history-list">
        {props.rows.map((row) => (
          <article key={row.key} className={row.status === "warning" ? "photo-consolidation-history-row warn" : "photo-consolidation-history-row"}>
            <span>
              <strong>{props.uiText(row.title)}</strong>
              <small>{row.summary}</small>
            </span>
            <div className="photo-consolidation-history-metrics">
              <span>{props.uiText("Copied")}: {props.formatCount(row.originalsCopied)}</span>
              {row.stillReferenced > 0 && <span>{props.uiText("Still referenced")}: {props.formatCount(row.stillReferenced)}</span>}
              {row.companionsCopied > 0 && <span>{props.uiText("Companions")}: {props.formatCount(row.companionsCopied)}</span>}
              {row.undoAvailable && <span>{props.uiText("Undo available")}</span>}
            </div>
            {row.managedRootLabel && (
              <small>
                {props.uiText("Managed folder")}: <span title={row.managedRootPath || row.managedRootLabel}>{row.managedRootLabel}</span>
              </small>
            )}
            {(row.copiedSamples || row.companionSamples || row.skippedSamples) && (
              <div className="photo-consolidation-history-samples">
                {row.copiedSamples && <small>{props.uiText("Copied samples")}: {row.copiedSamples}</small>}
                {row.companionSamples && <small>{props.uiText("Companion samples")}: {row.companionSamples}</small>}
                {row.skippedSamples && <small>{props.uiText("Skipped samples")}: {row.skippedSamples}</small>}
              </div>
            )}
            {row.at && <small className="photo-consolidation-history-date">{props.formatDateText(row.at)}</small>}
          </article>
        ))}
      </div>
    </section>
  );
}
