import type { PhotoBackupRestoreRehearsalValue, PhotoRestoreRehearsalValue } from "../types";
import { photoFileName, shortText } from "./photoDisplayText";
import type { PhotoRestoreRehearsalDetailRow } from "./photoRepairCenter";

type PhotoRestoreRehearsalPanelsText = (value: string) => string;

type PhotoRestoreRehearsalPanelsCountFormatter = (value: number) => string;

export type PhotoRestoreRehearsalSummaryProps = {
  value: PhotoRestoreRehearsalValue | null;
  detailRows: PhotoRestoreRehearsalDetailRow[];
  uiText: PhotoRestoreRehearsalPanelsText;
  formatCount: PhotoRestoreRehearsalPanelsCountFormatter;
};

export function PhotoRestoreRehearsalSummary(props: PhotoRestoreRehearsalSummaryProps) {
  if (!props.value) return null;
  return (
    <div className="photo-restore-rehearsal-summary">
      <small className="photo-repair-status">
        {props.uiText("Restore rehearsal")}: {props.formatCount(props.value.counts.operations)} {props.value.counts.operations === 1 ? props.uiText("operation") : props.uiText("operations")} · {props.formatCount(props.value.counts.blockedItems)} {props.uiText("blocked")} · {props.formatCount(props.value.counts.missingOriginalItems)} {props.uiText("missing originals")}
      </small>
      {props.detailRows.length > 0 && (
        <details className="photo-restore-rehearsal-details">
          <summary>{props.uiText("Restore details")}</summary>
          <div>
            {props.detailRows.slice(0, 6).map((row, index) => {
              const item = row.item;
              const status = String(item.status || "ready");
              const issue = String(item.issue || "");
              const sourcePath = String(item.sourcePath || "");
              const targetPath = String(item.targetPath || "");
              const trashPath = String(item.trashPath || "");
              const rowClass = status === "blocked" ? "blocked" : status === "warning" || item.canRestoreOriginal === false || item.canRestoreCatalog === false ? "warning" : "ready";
              return (
                <article className={`photo-restore-rehearsal-row ${rowClass}`} key={`${row.operationType}:${sourcePath}:${targetPath}:${index}`}>
                  <strong>{photoFileName(sourcePath) || row.operationLabel}</strong>
                  <small>{status}: {issue || props.uiText("ready")} · {item.detail || props.uiText("Restore item is ready.")}</small>
                  <div>
                    <span>{props.uiText("Operation")}: {row.operationType || row.operationLabel}</span>
                    {row.undoKind && <span>{props.uiText("Undo kind")}: {row.undoKind}</span>}
                    {sourcePath && <span title={sourcePath}>{props.uiText("Source")}: {photoFileName(sourcePath) || shortText(sourcePath)}</span>}
                    {targetPath && <span title={targetPath}>{props.uiText("Target")}: {photoFileName(targetPath) || shortText(targetPath)}</span>}
                    {trashPath && <span title={trashPath}>{props.uiText("Trash")}: {photoFileName(trashPath) || shortText(trashPath)}</span>}
                    <span>{props.uiText("Catalog")}: {item.canRestoreCatalog ? props.uiText("restorable") : props.uiText("blocked")}</span>
                    <span>{props.uiText("Original")}: {item.canRestoreOriginal ? props.uiText("restorable") : props.uiText("missing")}</span>
                  </div>
                </article>
              );
            })}
            {props.detailRows.length > 6 && <small>{props.formatCount(props.detailRows.length - 6)} {props.uiText("more item(s)")}</small>}
          </div>
        </details>
      )}
    </div>
  );
}

export type PhotoBackupRestoreRehearsalSummaryProps = {
  value: PhotoBackupRestoreRehearsalValue | null;
  checkRows: PhotoBackupRestoreRehearsalValue["checks"];
  uiText: PhotoRestoreRehearsalPanelsText;
  formatCount: PhotoRestoreRehearsalPanelsCountFormatter;
};

export function PhotoBackupRestoreRehearsalSummary(props: PhotoBackupRestoreRehearsalSummaryProps) {
  if (!props.value) return null;
  return (
    <div className="photo-backup-restore-summary">
      <small className="photo-repair-status">
        {props.uiText("Backup rehearsal")}: {props.formatCount(props.value.counts.restoredFiles)} {props.uiText("files")} · {props.formatCount(props.value.counts.restoredAssets)} {props.uiText("assets")} · {props.formatCount(props.value.counts.blockers)} {props.uiText("blockers")}
      </small>
      {props.checkRows.length > 0 && (
        <details className="photo-backup-restore-details">
          <summary>{props.uiText("Backup details")}</summary>
          <div>
            {props.checkRows.slice(0, 7).map((check, index) => {
              const status = String(check.status || (check.ok ? "ready" : check.severity || "attention"));
              const severity = String(check.severity || "");
              const rowClass = check.ok ? "ready" : severity === "warning" ? "warning" : "blocked";
              return (
                <article className={`photo-backup-restore-row ${rowClass}`} key={`${check.id}:${index}`}>
                  <strong>{props.uiText(check.label || check.id)}</strong>
                  <small>{status}: {check.detail || props.uiText("Backup rehearsal check recorded.")}</small>
                  <div>
                    <span>{props.uiText("Check")}: {check.id}</span>
                    <span>{props.uiText("Severity")}: {severity || props.uiText("info")}</span>
                    <span>{props.uiText("Count")}: {props.formatCount(check.count || 0)}</span>
                  </div>
                </article>
              );
            })}
            {props.checkRows.length > 7 && <small>{props.formatCount(props.checkRows.length - 7)} {props.uiText("more item(s)")}</small>}
          </div>
        </details>
      )}
    </div>
  );
}
