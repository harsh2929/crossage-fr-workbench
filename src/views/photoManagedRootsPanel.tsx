import { Check, Eye, Folder, FolderPlus, Images, Layers, Pencil, RefreshCcw, Search, Wrench, X } from "lucide-react";
import type { PhotoLibraryRootProfile, PhotoManagedRootPolicy, PhotoManagedRootProfile } from "../types";
import type { PhotoRootRepairState } from "./photoRepairCenter";
import { photoManagedRootPolicyDefaults, type PhotoLibraryRootProfileRow, type PhotoManagedRootProfileRow } from "./photoSettings";

type PhotoManagedRootsPanelText = (value: string) => string;

export type PhotoManagedRootsPanelProps = {
  managedRows: PhotoManagedRootProfileRow[];
  libraryRows: PhotoLibraryRootProfileRow[];
  managedCoverageByPath: Map<string, { assetCount?: number; externalBackupCovered?: boolean; insideWorkspace?: boolean; issue?: string }>;
  managedRenameDrafts: Record<string, string>;
  libraryRenameDrafts: Record<string, string>;
  rootRepairStates: Record<string, PhotoRootRepairState>;
  rootHealthOpen: Record<string, boolean>;
  busy: boolean;
  importing: boolean;
  saving: boolean;
  uiText: PhotoManagedRootsPanelText;
  formatCount: (value: number) => string;
  rootRepairKey: (rootPath: string) => string;
  isLibraryScopeActive: (rootPath: string, profileId?: string) => boolean;
  onChooseManagedRoot: () => void;
  onChooseLibraryRoot: () => void;
  onManagedRenameDraftChange: (key: string, value: string) => void;
  onLibraryRenameDraftChange: (key: string, value: string) => void;
  onRenameManagedRoot: (profile: PhotoManagedRootProfile, draftName: string) => void;
  onRenameLibraryRoot: (profile: PhotoLibraryRootProfile, draftName: string) => void;
  onManagedPolicyChange: (profile: PhotoManagedRootProfile, patch: Partial<PhotoManagedRootPolicy>) => void;
  onToggleRootHealth: (rootKey: string, open: boolean) => void;
  onSetLibraryScope: (rootPath: string, profileId?: string) => void;
  onUseManagedRoot: (profile: PhotoManagedRootProfile) => void;
  onForgetManagedRoot: (profile: PhotoManagedRootProfile) => void;
  onForgetLibraryRoot: (profile: PhotoLibraryRootProfile) => void;
  onRunManagedRootBackupCheck: (rootPath: string, rootName: string) => void;
  onRunManagedRootPreviewSweep: (rootPath: string, rootName: string) => void;
  onRunManagedRootOrphanScan: (rootPath: string, rootName: string, dryRun: boolean) => void;
};

export function PhotoManagedRootsPanel(props: PhotoManagedRootsPanelProps) {
  return (
    <>
      {props.managedRows.length > 0 && (
        <div className="photo-managed-root-profiles" aria-label={props.uiText("Managed library roots")}>
          <div className="photo-managed-root-profiles-head">
            <span>
              <Folder size={14} />
              <strong>{props.uiText("Managed library roots")}</strong>
              <small>{props.formatCount(props.managedRows.length)}</small>
            </span>
            <button
              type="button"
              className="ghost compact-action"
              onClick={props.onChooseManagedRoot}
              disabled={props.busy || props.importing || props.saving}
            >
              <FolderPlus size={13} />
              <span>{props.uiText("Add root")}</span>
            </button>
          </div>
          <div className="photo-managed-root-profile-list">
            {props.managedRows.map((row) => {
              const coverage = props.managedCoverageByPath.get(row.path);
              const policy = photoManagedRootPolicyDefaults(row.profile);
              const externalBackupCovered = Boolean(coverage?.externalBackupCovered || policy.externalBackupCovered);
              const externalBackupDisabled = Boolean(coverage?.insideWorkspace);
              const renameDraft = props.managedRenameDrafts[row.key] ?? row.name;
              const cleanRenameDraft = renameDraft.replace(/\s+/g, " ").trim();
              const renameChanged = Boolean(cleanRenameDraft && cleanRenameDraft !== row.name);
              const rootKey = props.rootRepairKey(row.path);
              const rootRepair = props.rootRepairStates[rootKey] || {};
              const rootHealthExpanded = Boolean(props.rootHealthOpen[rootKey]);
              const rootBusyAction = rootRepair.busyAction || "";
              const rootBackupCounts = rootRepair.backupCheck?.counts || null;
              const rootPreviewCounts = rootRepair.previewSweep?.counts || null;
              const rootOrphanScan = rootRepair.orphanScan || null;
              const rootAssetCount = Number(rootBackupCounts?.assets ?? coverage?.assetCount ?? 0) || 0;
              return (
                <div key={row.key} className={row.isDefault ? "photo-managed-root-profile-row active" : "photo-managed-root-profile-row"}>
                  <span className="photo-managed-root-profile-meta">
                    <strong>{row.name}</strong>
                    <small title={row.path}>{row.path}</small>
                    <span className="photo-managed-root-profile-badges">
                      {row.badges.map((badge) => (
                        <small key={badge.key} className={badge.tone === "warn" ? "warn" : badge.tone === "ok" ? "ok" : ""} title={badge.title || ""}>
                          {props.uiText(badge.label)}
                        </small>
                      ))}
                    </span>
                    {row.details.length > 0 && (
                      <span className="photo-managed-root-profile-details">
                        {row.details.map((detail, index) => (
                          <small key={`${row.key}:detail:${index}`}>{detail}</small>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="photo-managed-root-profile-actions">
                    <label className="photo-managed-root-profile-rename">
                      <span>{props.uiText("Profile name")}</span>
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(event) => props.onManagedRenameDraftChange(row.key, event.currentTarget.value)}
                        disabled={props.busy || props.importing || props.saving || row.builtIn}
                        aria-label={`${props.uiText("Managed root name")} ${row.name}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onRenameManagedRoot(row.profile, renameDraft)}
                      disabled={props.busy || props.importing || props.saving || row.builtIn || !renameChanged}
                      aria-label={`${props.uiText("Rename managed root profile")} ${row.name}`}
                    >
                      <Pencil size={13} />
                      <span>{props.uiText("Rename")}</span>
                    </button>
                    <label className="photo-rule-toggle photo-managed-root-policy-toggle">
                      <input
                        type="checkbox"
                        checked={policy.keepFolderOrganizationDefault}
                        onChange={(event) => props.onManagedPolicyChange(row.profile, { keepFolderOrganizationDefault: event.currentTarget.checked })}
                        disabled={props.busy || props.importing || props.saving}
                        aria-label={`${props.uiText("Keep folders")} ${row.name}`}
                      />
                      <span>{props.uiText("Keep folders")}</span>
                    </label>
                    <label className="photo-rule-toggle photo-managed-root-policy-toggle" title={externalBackupDisabled ? props.uiText("Inside workspace backup") : ""}>
                      <input
                        type="checkbox"
                        checked={externalBackupCovered}
                        onChange={(event) => props.onManagedPolicyChange(row.profile, { externalBackupCovered: event.currentTarget.checked })}
                        disabled={props.busy || props.importing || props.saving || externalBackupDisabled}
                        aria-label={`${props.uiText("External backup")} ${row.name}`}
                      />
                      <span>{props.uiText("External backup")}</span>
                    </label>
                    <button
                      type="button"
                      className={rootHealthExpanded ? "secondary compact-action active" : "ghost compact-action"}
                      onClick={() => props.onToggleRootHealth(rootKey, !rootHealthExpanded)}
                      disabled={props.busy || props.importing}
                      aria-label={`${rootHealthExpanded ? props.uiText("Hide managed root health") : props.uiText("Show managed root health")} ${row.name}`}
                    >
                      <Wrench size={13} />
                      <span>{rootHealthExpanded ? props.uiText("Health open") : props.uiText("Health")}</span>
                    </button>
                    <button
                      type="button"
                      className={props.isLibraryScopeActive(row.path, row.profile.profileId || row.key) ? "secondary compact-action active" : "ghost compact-action"}
                      onClick={() => {
                        const profileId = String(row.profile.profileId || row.key || "").trim();
                        props.onSetLibraryScope(
                          props.isLibraryScopeActive(row.path, profileId) ? "" : row.path,
                          props.isLibraryScopeActive(row.path, profileId) ? "" : profileId,
                        );
                      }}
                      disabled={props.busy || props.importing}
                      aria-label={`${props.uiText("View only managed root profile")} ${row.name}`}
                    >
                      <Layers size={13} />
                      <span>{props.isLibraryScopeActive(row.path, row.profile.profileId || row.key) ? props.uiText("Viewing") : props.uiText("View only")}</span>
                    </button>
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onUseManagedRoot(row.profile)}
                      disabled={props.busy || props.importing || props.saving || Boolean(row.isDefault)}
                      aria-label={`${props.uiText("Use managed root profile")} ${row.name}`}
                    >
                      <Check size={13} />
                      <span>{row.isDefault ? props.uiText("Current") : props.uiText("Use profile")}</span>
                    </button>
                    {!row.builtIn && (
                      <button
                        type="button"
                        className="ghost compact-action"
                        onClick={() => props.onForgetManagedRoot(row.profile)}
                        disabled={props.busy || props.importing || props.saving}
                        aria-label={`${props.uiText("Forget managed root profile")} ${row.name}`}
                      >
                        <X size={13} />
                        <span>{props.uiText("Forget")}</span>
                      </button>
                    )}
                  </span>
                  {rootHealthExpanded && (
                    <div className="photo-managed-root-health-panel" aria-label={`${props.uiText("Managed root health")} ${row.name}`}>
                      <div className="photo-managed-root-health-grid">
                        <span>
                          <strong>{props.formatCount(rootAssetCount)}</strong>
                          <small>{props.uiText(rootAssetCount === 1 ? "photo in root" : "photos in root")}</small>
                        </span>
                        <span>
                          <strong>{props.formatCount(Number(rootBackupCounts?.missingOriginals || 0))}</strong>
                          <small>{props.uiText("missing originals")}</small>
                        </span>
                        <span>
                          <strong>{props.formatCount(Number(rootBackupCounts?.missingCachedPreviews ?? rootPreviewCounts?.remainingMissingCachedPreviews ?? 0))}</strong>
                          <small>{props.uiText("missing previews")}</small>
                        </span>
                        <span>
                          <strong>{props.formatCount(Number(rootOrphanScan?.orphanCandidates || 0))}</strong>
                          <small>{props.uiText("orphan candidates")}</small>
                        </span>
                      </div>
                      <div className="photo-managed-root-health-notes">
                        <small>{props.uiText("Type")}: {row.builtIn ? props.uiText("Workspace managed root") : props.uiText("Managed copy destination")}</small>
                        <small>{props.uiText("Backup")}: {externalBackupDisabled ? props.uiText("inside workspace backup") : externalBackupCovered ? props.uiText("external coverage recorded") : props.uiText("external coverage needed if outside workspace")}</small>
                        {coverage?.issue && <small className="warn">{coverage.issue}</small>}
                        {rootRepair.message && <small>{rootRepair.message}</small>}
                        {rootRepair.error && <small className="warn">{rootRepair.error}</small>}
                      </div>
                      <div className="photo-managed-root-health-actions">
                        <button
                          type="button"
                          className="secondary compact-action"
                          onClick={() => props.onRunManagedRootBackupCheck(row.path, row.name)}
                          disabled={props.busy || props.importing || Boolean(rootBusyAction)}
                          aria-label={`${props.uiText("Check managed root")} ${row.name}`}
                        >
                          <RefreshCcw size={13} />
                          <span>{rootBusyAction === "backup" ? props.uiText("Checking") : props.uiText("Check root")}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost compact-action"
                          onClick={() => props.onRunManagedRootPreviewSweep(row.path, row.name)}
                          disabled={props.busy || props.importing || Boolean(rootBusyAction)}
                          aria-label={`${props.uiText("Sweep managed root previews")} ${row.name}`}
                        >
                          <Images size={13} />
                          <span>{rootBusyAction === "previewSweep" ? props.uiText("Sweeping") : props.uiText("Sweep previews")}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost compact-action"
                          onClick={() => props.onRunManagedRootOrphanScan(row.path, row.name, true)}
                          disabled={props.busy || props.importing || Boolean(rootBusyAction)}
                          aria-label={`${props.uiText("Preview managed root orphans")} ${row.name}`}
                        >
                          <Eye size={13} />
                          <span>{rootBusyAction === "orphanPreview" ? props.uiText("Previewing") : props.uiText("Preview orphans")}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost compact-action"
                          onClick={() => props.onRunManagedRootOrphanScan(row.path, row.name, false)}
                          disabled={props.busy || props.importing || Boolean(rootBusyAction)}
                          aria-label={`${props.uiText("Scan managed root orphans")} ${row.name}`}
                        >
                          <Search size={13} />
                          <span>{rootBusyAction === "orphanScan" ? props.uiText("Scanning") : props.uiText("Scan orphans")}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="photo-managed-root-profiles" aria-label={props.uiText("Library view roots")}>
        <div className="photo-managed-root-profiles-head">
          <span>
            <Layers size={14} />
            <strong>{props.uiText("Library view roots")}</strong>
            <small>{props.formatCount(props.libraryRows.length)}</small>
          </span>
          <button
            type="button"
            className="ghost compact-action"
            onClick={props.onChooseLibraryRoot}
            disabled={props.busy || props.importing || props.saving}
          >
            <FolderPlus size={13} />
            <span>{props.uiText("Add view root")}</span>
          </button>
        </div>
        {props.libraryRows.length > 0 ? (
          <div className="photo-managed-root-profile-list">
            {props.libraryRows.map((row) => {
              const renameDraft = props.libraryRenameDrafts[row.key] ?? row.name;
              const cleanRenameDraft = renameDraft.replace(/\s+/g, " ").trim();
              const renameChanged = Boolean(cleanRenameDraft && cleanRenameDraft !== row.name);
              return (
                <div key={row.key} className={props.isLibraryScopeActive(row.path, row.profileId || row.key) ? "photo-managed-root-profile-row active" : "photo-managed-root-profile-row"}>
                  <span className="photo-managed-root-profile-meta">
                    <strong>{row.name}</strong>
                    <small title={row.path}>{row.path}</small>
                    <span className="photo-managed-root-profile-badges">
                      {row.badges.map((badge) => (
                        <small key={badge.key} className={badge.tone === "warn" ? "warn" : badge.tone === "ok" ? "ok" : ""} title={badge.title || ""}>
                          {badge.label}
                        </small>
                      ))}
                    </span>
                    {row.details.length > 0 && (
                      <span className="photo-managed-root-profile-details">
                        {row.details.map((detail, index) => (
                          <small key={`${row.key}:detail:${index}`}>{detail}</small>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="photo-managed-root-profile-actions">
                    <label className="photo-managed-root-profile-rename">
                      <span>{props.uiText("Profile name")}</span>
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(event) => props.onLibraryRenameDraftChange(row.key, event.currentTarget.value)}
                        disabled={props.busy || props.importing || props.saving || Boolean(row.profile.builtIn)}
                        aria-label={`${props.uiText("Library root name")} ${row.name}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onRenameLibraryRoot(row.profile, renameDraft)}
                      disabled={props.busy || props.importing || props.saving || Boolean(row.profile.builtIn) || !renameChanged}
                      aria-label={`${props.uiText("Rename library view root")} ${row.name}`}
                    >
                      <Pencil size={13} />
                      <span>{props.uiText("Rename")}</span>
                    </button>
                    <button
                      type="button"
                      className={props.isLibraryScopeActive(row.path, row.profileId || row.key) ? "secondary compact-action active" : "ghost compact-action"}
                      onClick={() => {
                        const profileId = String(row.profileId || row.key || "").trim();
                        props.onSetLibraryScope(
                          props.isLibraryScopeActive(row.path, profileId) ? "" : row.path,
                          props.isLibraryScopeActive(row.path, profileId) ? "" : profileId,
                        );
                      }}
                      disabled={props.busy || props.importing}
                      aria-label={`${props.uiText("View library root")} ${row.name}`}
                    >
                      <Layers size={13} />
                      <span>{props.isLibraryScopeActive(row.path, row.profileId || row.key) ? props.uiText("Viewing") : props.uiText("View only")}</span>
                    </button>
                    {!row.profile.builtIn && (
                      <button
                        type="button"
                        className="ghost compact-action"
                        onClick={() => props.onForgetLibraryRoot(row.profile)}
                        disabled={props.busy || props.importing || props.saving}
                        aria-label={`${props.uiText("Forget library view root")} ${row.name}`}
                      >
                        <X size={13} />
                        <span>{props.uiText("Forget")}</span>
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <small className="photo-inline-status">{props.uiText("No saved view-only library roots.")}</small>
        )}
      </div>
    </>
  );
}
