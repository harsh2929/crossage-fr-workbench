import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Folder,
  FolderInput,
  FolderPlus,
  Layers,
  RefreshCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { PhotoImportSourceKind, SystemPhotoSource } from "../types";
import {
  PHOTO_IMPORT_SOURCE_OPTIONS,
  type PhotoImportSystemSourceRow,
} from "./photoImportAccess";
import type { PhotoImportStorageMode } from "./photoImportSessionDetails";
import type { PhotoLibraryViewOption, PhotoManagedRootProfileRow } from "./photoSettings";

type PhotoRailImportControlsText = (value: string) => string;

export type PhotoRailImportControlsProps = {
  catalogEmpty: boolean;
  busy: boolean;
  savingAlbum: boolean;
  savingAlbumFolder: boolean;
  importingPhotos: boolean;
  settingsOpen: boolean;
  libraryProfileSaving: boolean;
  importStorageMode: PhotoImportStorageMode;
  configuredManagedRoot: string;
  managedRootLabel: string;
  managedRootProfileRows: PhotoManagedRootProfileRow[];
  preferredImportManagedRoot: string;
  importKeepFolderOrganization: boolean;
  persistedManagedRoot: boolean;
  libraryProfileError: string;
  activeLibraryRoot: string;
  activeLibraryRootLabel: string;
  activeLibraryScopeValue: string;
  libraryViewOptions: PhotoLibraryViewOption[];
  importSourceKind: PhotoImportSourceKind;
  importSourceDetail: string;
  systemSourceRows: PhotoImportSystemSourceRow[];
  canRefreshPhotoSources: boolean;
  uiText: PhotoRailImportControlsText;
  onNewSmartAlbum: () => void;
  onNewManualAlbum: () => void;
  onNewFolder: () => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onToggleSettings: () => void;
  onRefreshAlbums: () => void;
  onStorageModeChange: (mode: PhotoImportStorageMode) => void;
  onChooseManagedRoot: () => void;
  onImportManagedRootChange: (rootPath: string) => void;
  onKeepFolderOrganizationChange: (value: boolean) => void;
  onClearManagedRoot: () => void;
  onLibraryScopeChange: (rootPath: string, profileId?: string) => void;
  onChooseLibraryViewRoot: () => void;
  onImportSourceKindChange: (kind: PhotoImportSourceKind) => void;
  onImportSourceDetailChange: (value: string) => void;
  onRefreshPhotoSources: () => void;
  onImportSuggestedSource: (source: SystemPhotoSource) => void;
};

export function PhotoRailImportControls(props: PhotoRailImportControlsProps) {
  const albumControlsDisabled = props.busy || props.savingAlbum || props.savingAlbumFolder;
  const importProfileControlsDisabled = props.busy || props.importingPhotos || props.libraryProfileSaving;
  return (
    <>
      {!props.catalogEmpty && <div className="photo-library-quick-actions" aria-label={props.uiText("Library actions")}>
        <button type="button" className="primary compact-action" onClick={props.onImportFiles} disabled={props.busy || props.importingPhotos}>
          <FolderInput size={15} />
          <span>{props.importingPhotos ? props.uiText("Importing") : props.uiText("Import photos")}</span>
        </button>
        <button type="button" className="secondary compact-action" onClick={props.onNewManualAlbum} disabled={albumControlsDisabled}>
          <FolderPlus size={15} />
          <span>{props.uiText("New album")}</span>
        </button>
        <button type="button" className="ghost compact-action photo-import-folder-action" onClick={props.onImportFolder} disabled={props.busy || props.importingPhotos} title={props.uiText("Import folder")} aria-label={props.uiText("Import folder")}>
          <Folder size={15} />
        </button>
      </div>}

      <details className="photo-library-management">
        <summary>
          <SlidersHorizontal size={15} />
          <span>
            <strong>{props.uiText("Library options")}</strong>
            <small>{props.uiText("Import behavior and sources")}</small>
          </span>
          <ChevronRight className="photo-library-management-chevron" size={15} aria-hidden="true" />
        </summary>
        <div className="photo-library-management-body">
          <div className="photo-library-management-actions">
            <button type="button" className="secondary compact-action" onClick={props.onNewSmartAlbum} disabled={albumControlsDisabled}>
              <FolderPlus size={15} />
              <span>{props.uiText("New smart album")}</span>
            </button>
            <button type="button" className="secondary compact-action" onClick={props.onNewFolder} disabled={albumControlsDisabled}>
              <Folder size={15} />
              <span>{props.uiText("New folder")}</span>
            </button>
            <button
              type="button"
              className={props.settingsOpen ? "secondary compact-action active" : "secondary compact-action"}
              onClick={props.onToggleSettings}
              aria-expanded={props.settingsOpen}
              aria-controls="photos-local-settings"
            >
              <SlidersHorizontal size={15} />
              <span>{props.uiText("Settings")}</span>
            </button>
            <button type="button" className="ghost compact-action" onClick={props.onRefreshAlbums} disabled={albumControlsDisabled} aria-label={props.uiText("Refresh albums")}>
              <RefreshCcw size={14} />
            </button>
          </div>

          <div className="photo-import-controls" aria-label={props.uiText("Import storage")}>
        <span>{props.uiText("Import storage")}</span>
        <div className="photo-segmented-control photo-import-storage-control">
          <button
            type="button"
            className={props.importStorageMode === "referenced" ? "active" : ""}
            onClick={() => props.onStorageModeChange("referenced")}
            disabled={importProfileControlsDisabled}
            aria-pressed={props.importStorageMode === "referenced"}
          >
            <FolderInput size={14} />
            <span>{props.uiText("Reference originals")}</span>
          </button>
          <button
            type="button"
            className={props.importStorageMode === "managed" ? "active" : ""}
            onClick={() => props.onStorageModeChange("managed")}
            disabled={importProfileControlsDisabled}
            aria-pressed={props.importStorageMode === "managed"}
          >
            <Copy size={14} />
            <span>{props.uiText("Copy into library")}</span>
          </button>
        </div>
        <button type="button" className="ghost compact-action" onClick={props.onChooseManagedRoot} disabled={importProfileControlsDisabled} title={props.configuredManagedRoot}>
          <FolderPlus size={14} />
          <span>{props.libraryProfileSaving ? props.uiText("Saving root") : props.managedRootLabel}</span>
        </button>
        {props.managedRootProfileRows.length > 0 && (
          <label className="photo-import-managed-root-select">
            <span>{props.uiText("Copy destination")}</span>
            <select
              aria-label={props.uiText("Copy destination")}
              value={props.preferredImportManagedRoot}
              onChange={(event) => props.onImportManagedRootChange(event.currentTarget.value)}
              disabled={importProfileControlsDisabled || props.importStorageMode !== "managed"}
            >
              {props.managedRootProfileRows.map((row) => (
                <option key={row.key} value={row.path}>{row.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="photo-rule-toggle photo-import-keep-folders">
          <input
            type="checkbox"
            checked={props.importKeepFolderOrganization}
            onChange={(event) => props.onKeepFolderOrganizationChange(event.currentTarget.checked)}
            disabled={props.busy || props.importingPhotos || props.importStorageMode !== "managed"}
          />
          <span>{props.uiText("Keep folder organization")}</span>
        </label>
        {props.persistedManagedRoot && (
          <button type="button" className="ghost compact-action" onClick={props.onClearManagedRoot} disabled={importProfileControlsDisabled}>
            <X size={14} />
            <span>{props.uiText("Use workspace default")}</span>
          </button>
        )}
        {props.libraryProfileError && <small className="warn">{props.libraryProfileError}</small>}
          </div>

          <div className="photo-import-controls" aria-label={props.uiText("Library view")}>
        <span>{props.uiText("Library view")}</span>
        <span className="photo-inline-status" title={props.activeLibraryRoot || props.uiText("All libraries")}>
          <Layers size={14} />
          <span>{props.activeLibraryRootLabel}</span>
        </span>
        <label className="photo-import-managed-root-select">
          <span>{props.uiText("Scope")}</span>
          <select
            aria-label={props.uiText("Library view scope")}
            value={props.activeLibraryScopeValue}
            onChange={(event) => {
              const selected = props.libraryViewOptions.find((option) => option.value === event.currentTarget.value);
              props.onLibraryScopeChange(selected?.path || "", selected?.profileId || "");
            }}
            disabled={importProfileControlsDisabled}
          >
            {props.libraryViewOptions.map((option) => (
              <option key={option.key} value={option.value}>{option.label} · {option.detail}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost compact-action" onClick={props.onChooseLibraryViewRoot} disabled={importProfileControlsDisabled}>
          <FolderPlus size={14} />
          <span>{props.uiText("Add view root")}</span>
        </button>
        {props.activeLibraryRoot && (
          <button type="button" className="ghost compact-action" onClick={() => props.onLibraryScopeChange("")}>
            <X size={14} />
            <span>{props.uiText("All libraries")}</span>
          </button>
        )}
          </div>

          <div className="photo-import-controls" aria-label={props.uiText("Import source")}>
        <label className="photo-import-source-select">
          <span>{props.uiText("Import source")}</span>
          <select
            aria-label={props.uiText("Import source")}
            value={props.importSourceKind}
            onChange={(event) => props.onImportSourceKindChange(event.currentTarget.value as PhotoImportSourceKind)}
            disabled={props.busy || props.importingPhotos}
          >
            {PHOTO_IMPORT_SOURCE_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>{props.uiText(option.label)}</option>
            ))}
          </select>
        </label>
        <label className="photo-import-source-detail">
          <span>{props.uiText("Source detail")}</span>
          <input
            aria-label={props.uiText("Import source detail")}
            value={props.importSourceDetail}
            onChange={(event) => props.onImportSourceDetailChange(event.currentTarget.value)}
            placeholder={props.uiText("Sender, webpage, or note")}
            disabled={props.busy || props.importingPhotos}
          />
        </label>
          </div>

          {(props.systemSourceRows.length > 0 || props.canRefreshPhotoSources) && (
            <div className="photo-import-system-sources" aria-label={props.uiText("Suggested import sources")}>
          <div className="photo-import-system-sources-head">
            <span>{props.uiText("Suggested sources")}</span>
            {props.canRefreshPhotoSources && (
              <button type="button" className="ghost compact-action" onClick={props.onRefreshPhotoSources} disabled={props.busy || props.importingPhotos}>
                <RefreshCcw size={13} />
                <span>{props.uiText("Refresh")}</span>
              </button>
            )}
          </div>
          {props.systemSourceRows.length > 0 ? (
            <div className="photo-import-system-source-list">
              {props.systemSourceRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className={row.available ? "photo-import-system-source" : "photo-import-system-source unavailable"}
                  onClick={() => props.onImportSuggestedSource(row.source as SystemPhotoSource)}
                  disabled={props.busy || props.importingPhotos || !row.available}
                  title={row.detail}
                >
                  <span>
                    <strong>{props.uiText(row.label)}</strong>
                    <span className="photo-import-system-source-badges">
                      {row.badges.map((badge) => <small key={badge}>{props.uiText(badge)}</small>)}
                    </span>
                    <small>{props.uiText(row.detail)}</small>
                    {row.safetyDetail && <small>{props.uiText(row.safetyDetail)}</small>}
                    <em>{row.available ? props.uiText("Available on this computer") : props.uiText("Not found on this computer")}</em>
                  </span>
                  {row.available ? <ChevronRight size={14} /> : <AlertTriangle size={14} />}
                </button>
              ))}
            </div>
          ) : (
            <small>{props.uiText("Refresh to detect local photo locations.")}</small>
          )}
            </div>
          )}
        </div>
      </details>
    </>
  );
}
