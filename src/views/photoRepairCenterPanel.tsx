import { AlertTriangle, Archive, Check, Eye, RefreshCcw, RotateCcw, Search, Wrench } from "lucide-react";

type PhotoRepairCenterPanelText = (value: string) => string;

export type PhotoRepairCenterOrphanScanMode = "preview" | "record" | "";

export type PhotoRepairCenterActionsProps = {
  busy: boolean;
  repairScanning: boolean;
  restoreRehearsing: boolean;
  backupRestoreRehearsing: boolean;
  recoveredFailuresLoading: boolean;
  recoveredOrphanScanning: boolean;
  recoveredOrphanScanMode: PhotoRepairCenterOrphanScanMode;
  catalogCleanupPreviewing: boolean;
  catalogCleaning: boolean;
  uiText: PhotoRepairCenterPanelText;
  onRepairScan: () => void;
  onRestoreRehearsal: () => void;
  onBackupRestoreRehearsal: () => void;
  onPreviewOrphans: () => void;
  onScanOrphans: () => void;
  onPreviewCleanup: () => void;
};

export function PhotoRepairCenterActions(props: PhotoRepairCenterActionsProps) {
  return (
    <div className="photo-repair-center-head">
      <span>
        <Wrench size={14} />
        <strong>{props.uiText("Repair center")}</strong>
      </span>
      <div className="photo-repair-center-actions">
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onRepairScan}
          disabled={props.busy || props.repairScanning}
        >
          <RefreshCcw size={14} />
          <span>{props.repairScanning ? props.uiText("Scanning") : props.uiText("Repair scan")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onRestoreRehearsal}
          disabled={props.busy || props.restoreRehearsing}
        >
          <RotateCcw size={14} />
          <span>{props.restoreRehearsing ? props.uiText("Rehearsing") : props.uiText("Restore rehearsal")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onBackupRestoreRehearsal}
          disabled={props.busy || props.backupRestoreRehearsing}
        >
          <Archive size={14} />
          <span>{props.backupRestoreRehearsing ? props.uiText("Rehearsing") : props.uiText("Backup rehearsal")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onPreviewOrphans}
          disabled={props.busy || props.recoveredFailuresLoading || props.recoveredOrphanScanning}
        >
          <Eye size={14} />
          <span>{props.recoveredOrphanScanMode === "preview" ? props.uiText("Previewing") : props.uiText("Preview orphans")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onScanOrphans}
          disabled={props.busy || props.recoveredFailuresLoading || props.recoveredOrphanScanning}
        >
          <Search size={14} />
          <span>{props.recoveredOrphanScanMode === "record" ? props.uiText("Scanning") : props.uiText("Scan orphans")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onPreviewCleanup}
          disabled={props.busy || props.catalogCleanupPreviewing || props.catalogCleaning}
        >
          <Eye size={14} />
          <span>{props.catalogCleanupPreviewing ? props.uiText("Previewing") : props.uiText("Preview cleanup")}</span>
        </button>
      </div>
    </div>
  );
}

export type PhotoRepairCenterSummaryProps = {
  issueCount: number;
  hasScan: boolean;
  repairScopePath: string;
  repairScopeLabel: string;
  uiText: PhotoRepairCenterPanelText;
  formatCount: (value: number) => string;
};

export function PhotoRepairCenterSummary(props: PhotoRepairCenterSummaryProps) {
  return (
    <div className={props.issueCount ? "photo-repair-center-summary warn" : "photo-repair-center-summary ok"}>
      {props.issueCount ? <AlertTriangle size={15} /> : <Check size={15} />}
      <span>
        <strong>{props.issueCount ? props.uiText("Needs repair") : props.uiText("Ready")}</strong>
        <small>
          {props.issueCount
            ? `${props.formatCount(props.issueCount)} ${props.issueCount === 1 ? props.uiText("issue") : props.uiText("issues")}`
            : props.hasScan
              ? props.uiText("No repair issues from latest scan.")
              : props.uiText("No repair scan run yet.")}
        </small>
        <small className="photo-repair-scope" title={props.repairScopePath || undefined}>{props.repairScopeLabel}</small>
      </span>
    </div>
  );
}
