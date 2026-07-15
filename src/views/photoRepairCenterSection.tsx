import { ChevronRight, Wrench } from "lucide-react";
import type {
  PhotoBackupRestoreRehearsalValue,
  PhotoLibraryCatalogCleanupValue,
  PhotoRepairHistoryValue,
  PhotoRestoreRehearsalValue,
} from "../types";
import { PhotoCatalogCleanupPreviewPanel } from "./photoCatalogCleanupPreviewPanel";
import { PhotoRepairCenterActions, PhotoRepairCenterSummary, type PhotoRepairCenterOrphanScanMode } from "./photoRepairCenterPanel";
import { PhotoRepairHistoryList } from "./photoRepairHistoryList";
import { PhotoRepairIssueList } from "./photoRepairIssueList";
import type { PhotoRepairIssue, PhotoRestoreRehearsalDetailRow } from "./photoRepairCenter";
import { PhotoBackupRestoreRehearsalSummary, PhotoRestoreRehearsalSummary } from "./photoRestoreRehearsalPanels";

type PhotoRepairCenterSectionText = (value: string) => string;

export type PhotoRepairCenterSectionProps = {
  busy: boolean;
  repairScanning: boolean;
  restoreRehearsing: boolean;
  backupRestoreRehearsing: boolean;
  recoveredFailuresLoading: boolean;
  recoveredOrphanScanning: boolean;
  recoveredOrphanScanMode: PhotoRepairCenterOrphanScanMode;
  catalogCleanupPreviewing: boolean;
  catalogCleaning: boolean;
  hasScan: boolean;
  repairScopePath: string;
  repairScopeLabel: string;
  issues: PhotoRepairIssue[];
  cleanupPreview: PhotoLibraryCatalogCleanupValue | null;
  repairHistory: PhotoRepairHistoryValue | null;
  restoreRehearsal: PhotoRestoreRehearsalValue | null;
  restoreRehearsalDetailRows: PhotoRestoreRehearsalDetailRow[];
  backupRestoreRehearsal: PhotoBackupRestoreRehearsalValue | null;
  backupRestoreCheckRows: PhotoBackupRestoreRehearsalValue["checks"];
  activeRecoveredCollection: boolean;
  repairStatus: string;
  recoveredOrphanScanStatus: string;
  recoveredFailuresError: string;
  restoreRehearsalError: string;
  backupRestoreRehearsalError: string;
  repairHistoryError: string;
  repairError: string;
  uiText: PhotoRepairCenterSectionText;
  formatCount: (value: number) => string;
  isIssueActionDisabled: (issue: PhotoRepairIssue) => boolean;
  onIssueAction: (issue: PhotoRepairIssue) => void;
  onRepairScan: () => void;
  onRestoreRehearsal: () => void;
  onBackupRestoreRehearsal: () => void;
  onPreviewOrphans: () => void;
  onScanOrphans: () => void;
  onPreviewCleanup: () => void;
  onApplyCatalogCleanup: () => void;
};

export function PhotoRepairCenterSection(props: PhotoRepairCenterSectionProps) {
  return (
    <details className="photo-repair-center">
      <summary className="photo-repair-center-disclosure">
        <span>
          <Wrench size={14} />
          <span>
            <strong>{props.uiText("Library health")}</strong>
            <small>
              {props.issues.length
                ? `${props.formatCount(props.issues.length)} ${props.uiText(props.issues.length === 1 ? "issue" : "issues")}`
                : props.uiText("Repair, recovery and restore checks")}
            </small>
          </span>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </summary>
      <div className="photo-repair-center-body" role="region" aria-label={props.uiText("Photos repair center")}>
      <PhotoRepairCenterActions
        busy={props.busy}
        repairScanning={props.repairScanning}
        restoreRehearsing={props.restoreRehearsing}
        backupRestoreRehearsing={props.backupRestoreRehearsing}
        recoveredFailuresLoading={props.recoveredFailuresLoading}
        recoveredOrphanScanning={props.recoveredOrphanScanning}
        recoveredOrphanScanMode={props.recoveredOrphanScanMode}
        catalogCleanupPreviewing={props.catalogCleanupPreviewing}
        catalogCleaning={props.catalogCleaning}
        uiText={props.uiText}
        onRepairScan={props.onRepairScan}
        onRestoreRehearsal={props.onRestoreRehearsal}
        onBackupRestoreRehearsal={props.onBackupRestoreRehearsal}
        onPreviewOrphans={props.onPreviewOrphans}
        onScanOrphans={props.onScanOrphans}
        onPreviewCleanup={props.onPreviewCleanup}
      />
      <PhotoRepairCenterSummary
        issueCount={props.issues.length}
        hasScan={props.hasScan}
        repairScopePath={props.repairScopePath}
        repairScopeLabel={props.repairScopeLabel}
        uiText={props.uiText}
        formatCount={props.formatCount}
      />
      <PhotoRepairIssueList
        issues={props.issues}
        uiText={props.uiText}
        formatCount={props.formatCount}
        isActionDisabled={props.isIssueActionDisabled}
        onAction={props.onIssueAction}
      />
      <PhotoCatalogCleanupPreviewPanel
        value={props.cleanupPreview}
        busy={props.busy}
        cleaning={props.catalogCleaning}
        previewing={props.catalogCleanupPreviewing}
        uiText={props.uiText}
        formatCount={props.formatCount}
        onApply={props.onApplyCatalogCleanup}
      />
      <PhotoRepairHistoryList value={props.repairHistory} uiText={props.uiText} />
      <PhotoRestoreRehearsalSummary
        value={props.restoreRehearsal}
        detailRows={props.restoreRehearsalDetailRows}
        uiText={props.uiText}
        formatCount={props.formatCount}
      />
      <PhotoBackupRestoreRehearsalSummary
        value={props.backupRestoreRehearsal}
        checkRows={props.backupRestoreCheckRows}
        uiText={props.uiText}
        formatCount={props.formatCount}
      />
      {props.repairStatus && <small className="photo-repair-status">{props.repairStatus}</small>}
      {props.recoveredOrphanScanStatus && !props.activeRecoveredCollection && <small className="photo-repair-status">{props.recoveredOrphanScanStatus}</small>}
      {props.recoveredFailuresError && !props.activeRecoveredCollection && <small className="warn">{props.recoveredFailuresError}</small>}
      {props.restoreRehearsalError && <small className="warn">{props.restoreRehearsalError}</small>}
      {props.backupRestoreRehearsalError && <small className="warn">{props.backupRestoreRehearsalError}</small>}
      {props.repairHistoryError && <small className="warn">{props.repairHistoryError}</small>}
      {props.repairError && <small className="warn">{props.repairError}</small>}
      </div>
    </details>
  );
}
