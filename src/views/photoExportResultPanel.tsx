import { ExternalLink, Folder, X } from "lucide-react";
import type { PhotoSelectionExportValue } from "../types";
import {
  photoSelectionExportPanelState,
  photoSelectionExportRowDetailItems,
  photoSelectionExportRowSummary,
} from "./photoSelectionExportResults";

type PhotoExportResultPanelProps = {
  result: PhotoSelectionExportValue;
  uiText: (value: string) => string;
  fileName: (value: string) => string;
  shortText: (value: string) => string;
  formatCount: (value: number) => string;
  formatDuration: (value: number) => string;
  onRevealPath: (path: string) => void;
  onDismiss: () => void;
};

type PhotoExportResultRowProps = {
  row: PhotoSelectionExportValue["items"][number];
  rowKey: string;
  uiText: (value: string) => string;
  fileName: (value: string) => string;
  shortText: (value: string) => string;
  formatCount: (value: number) => string;
  formatDuration: (value: number) => string;
};

function PhotoExportResultRow({
  row,
  rowKey,
  uiText,
  fileName,
  shortText,
  formatCount,
  formatDuration,
}: PhotoExportResultRowProps) {
  const summary = photoSelectionExportRowSummary(row, { uiText, fileName, shortText });
  const detailItems = photoSelectionExportRowDetailItems(row, {
    uiText,
    fileName,
    shortText,
    formatCount,
    formatDuration,
  });

  return (
    <div className="photo-export-result-row" key={rowKey}>
      <strong title={summary.sourceTitle}>{summary.sourceLabel}</strong>
      <span>{summary.resultLabel}</span>
      {summary.hasTarget ? <small title={summary.targetTitle}>{summary.targetLabel}</small> : <small>{summary.targetLabel}</small>}
      <details className="photo-export-result-row-details">
        <summary>{uiText("Export details")}</summary>
        <div>
          {detailItems.map((detail) => (
            <span className="photo-export-result-detail" key={detail.label}>
              <strong>{detail.label}:</strong>
              {" "}
              <span title={detail.title || detail.value}>{detail.value}</span>
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}

export function PhotoExportResultPanel({
  result,
  uiText,
  fileName,
  shortText,
  formatCount,
  formatDuration,
  onRevealPath,
  onDismiss,
}: PhotoExportResultPanelProps) {
  const panel = photoSelectionExportPanelState(result);

  return (
    <div
      className={`photo-export-result ${panel.statusClass}`}
      role={panel.role}
      aria-label={uiText("Last export result")}
    >
      <div className="photo-export-result-head">
        <span>
          <strong>{uiText("Last export")}</strong>
          <small title={result.bundlePath}>{shortText(result.bundlePath || "")}</small>
        </span>
        <div className="photo-export-result-actions">
          <button type="button" className="ghost compact-action" onClick={() => onRevealPath(result.bundlePath || "")} disabled={!result.bundlePath}>
            <Folder size={14} />
            <span>{uiText("Reveal export")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={() => onRevealPath(result.manifestPath || "")} disabled={!result.manifestPath}>
            <ExternalLink size={14} />
            <span>{uiText("Reveal manifest")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={onDismiss} aria-label={uiText("Dismiss export result")}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="photo-export-result-metrics">
        <span>{formatCount(panel.metrics.written)} {uiText("written")}</span>
        {panel.metrics.rendered > 0 && <span>{formatCount(panel.metrics.rendered)} {uiText("rendered")}</span>}
        {panel.metrics.sidecars > 0 && (
          <span>{formatCount(panel.metrics.sidecars)} {uiText("sidecars")}</span>
        )}
        {panel.metrics.credentialsSigned > 0 && <span>{formatCount(panel.metrics.credentialsSigned)} {uiText("credentialed")}</span>}
        {panel.metrics.credentialsPreserved > 0 && <span>{formatCount(panel.metrics.credentialsPreserved)} {uiText("credentials preserved")}</span>}
        {panel.metrics.credentialsFailed > 0 && <span>{formatCount(panel.metrics.credentialsFailed)} {uiText("credential failures")}</span>}
        {panel.metrics.skipped > 0 && <span>{formatCount(panel.metrics.skipped)} {uiText("skipped")}</span>}
        {panel.metrics.needsAttention > 0 && <span>{formatCount(panel.metrics.needsAttention)} {uiText("needs attention")}</span>}
      </div>
      {panel.issueRows.length ? (
        <div className="photo-export-result-issues">
          {panel.visibleIssueRows.map((row, index) => (
            <PhotoExportResultRow
              key={`${row.sourcePath}:${index}`}
              row={row}
              rowKey={`${row.sourcePath}:${index}`}
              uiText={uiText}
              fileName={fileName}
              shortText={shortText}
              formatCount={formatCount}
              formatDuration={formatDuration}
            />
          ))}
          {panel.issueOverflowCount > 0 && <small>{formatCount(panel.issueOverflowCount)} {uiText("more item(s)")}</small>}
        </div>
      ) : (
        <small>{uiText("All selected files were written.")}</small>
      )}
      {panel.successRows.length > 0 && (
        <details className="photo-export-result-success-details">
          <summary>{uiText("Written files")}</summary>
          <div className="photo-export-result-issues">
            {panel.visibleSuccessRows.map((row, index) => (
              <PhotoExportResultRow
                key={`${row.targetPath || row.sourcePath}:${index}`}
                row={row}
                rowKey={`${row.targetPath || row.sourcePath}:${index}`}
                uiText={uiText}
                fileName={fileName}
                shortText={shortText}
                formatCount={formatCount}
                formatDuration={formatDuration}
              />
            ))}
            {panel.successOverflowCount > 0 && <small>{formatCount(panel.successOverflowCount)} {uiText("more item(s)")}</small>}
          </div>
        </details>
      )}
    </div>
  );
}
