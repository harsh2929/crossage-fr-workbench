import { AlertTriangle, Archive, Check, ChevronRight, RefreshCcw } from "lucide-react";
import type { PhotoBackupPolicyStatus, PhotoLibraryBackupCheckValue } from "../types";

type PhotoBackupCheckPanelText = (value: string) => string;

export type PhotoBackupCheckPanelProps = {
  backupCheck: PhotoLibraryBackupCheckValue | null;
  backupPolicyStatus: PhotoBackupPolicyStatus | null;
  backupPolicyStatusText: string;
  backupCheckError: string;
  checking: boolean;
  busy: boolean;
  repairScopePath: string;
  repairScopeLabel: string;
  uiText: PhotoBackupCheckPanelText;
  formatCount: (value: number) => string;
  onRun: () => void;
};

export function PhotoBackupCheckPanel(props: PhotoBackupCheckPanelProps) {
  const readinessLabel = props.backupCheck
    ? props.backupCheck.ok ? props.uiText("Ready") : props.uiText("Needs attention")
    : props.uiText("Not checked");
  return (
    <details className="photo-backup-check-panel">
      <summary className="photo-backup-check-disclosure">
        <span>
          <Archive size={14} />
          <span>
            <strong>{props.uiText("Backup readiness")}</strong>
            <small>{readinessLabel}</small>
          </span>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      <div className="photo-backup-check-body" role="region" aria-label={props.uiText("Backup readiness")}>
        <div className="photo-backup-check-head">
          <small>{props.uiText("Check that originals, previews and metadata can be restored.")}</small>
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onRun}
          disabled={props.busy || props.checking}
        >
          <RefreshCcw size={14} />
          <span>{props.checking ? props.uiText("Checking") : props.uiText("Backup check")}</span>
        </button>
        </div>
      {props.backupCheck ? (
        <>
          <div className={props.backupCheck.ok ? "photo-backup-check-summary ok" : "photo-backup-check-summary warn"}>
            {props.backupCheck.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
            <span>
              <strong>{props.backupCheck.ok ? props.uiText("Ready") : props.uiText("Needs attention")}</strong>
              <small>
                {props.formatCount(props.backupCheck.counts.assets)} {props.uiText("assets")} · {props.formatCount(props.backupCheck.counts.managedAssets)} {props.uiText("managed")} · {props.formatCount(props.backupCheck.counts.referencedAssets)} {props.uiText("referenced")}
              </small>
              <small className="photo-repair-scope" title={props.repairScopePath || undefined}>{props.repairScopeLabel}</small>
            </span>
          </div>
          <div className="photo-backup-check-metrics">
            <span>
              <strong>{props.formatCount(props.backupCheck.counts.missingOriginals)}</strong>
              <small>{props.uiText("missing originals")}</small>
            </span>
            <span>
              <strong>{props.formatCount(props.backupCheck.counts.cachedPreviews)}</strong>
              <small>{props.uiText("cached previews")}</small>
            </span>
            <span>
              <strong>{props.formatCount(props.backupCheck.counts.metadataRows)}</strong>
              <small>{props.uiText("metadata rows")}</small>
            </span>
            <span>
              <strong>{props.formatCount(props.backupCheck.counts.albumItems)}</strong>
              <small>{props.uiText("album items")}</small>
            </span>
            <span>
              <strong>{props.formatCount(props.backupCheck.counts.editStacks || 0)}</strong>
              <small>{props.uiText("edit stacks")}</small>
            </span>
          </div>
          {props.backupCheck.recommendations.length > 0 && (
            <div className="photo-backup-check-recommendations">
              {props.backupCheck.recommendations.slice(0, 3).map((recommendation, index) => (
                <small key={`${recommendation}:${index}`}>{recommendation}</small>
              ))}
            </div>
          )}
        </>
      ) : (
        <small className="photo-backup-check-empty">{props.uiText("No backup check run yet.")}</small>
      )}
      {props.backupPolicyStatus && (
        <small className={props.backupPolicyStatus.status === "attention" ? "warn" : "photo-repair-status"}>
          {props.uiText("Policy")}: {props.backupPolicyStatusText} · {props.formatCount(props.backupPolicyStatus.counts.assetsRequiringExternalBackup)} {props.uiText("external originals")}
        </small>
      )}
      {props.backupCheckError && <small className="warn">{props.backupCheckError}</small>}
      </div>
    </details>
  );
}
