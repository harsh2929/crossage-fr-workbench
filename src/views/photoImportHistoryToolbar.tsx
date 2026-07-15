import { Archive, Search, Tag, X } from "lucide-react";
import type { PhotoImportHistorySourceOption, PhotoImportHistoryStatusFilter, PhotoImportHistoryStorageFilter } from "./photoImportSessionDetails";

type PhotoImportHistoryToolbarText = (value: string) => string;

export type PhotoImportHistoryToolbarProps = {
  query: string;
  statusFilter: PhotoImportHistoryStatusFilter;
  storageFilter: PhotoImportHistoryStorageFilter;
  sourceKindFilter: string;
  showArchived: boolean;
  sourceOptions: PhotoImportHistorySourceOption[];
  queryFiltersActive: boolean;
  filtersActive: boolean;
  archivableCount: number;
  bulkOpen: boolean;
  busy: boolean;
  archiveSaving: boolean;
  bulkSaving: boolean;
  editSaving: boolean;
  uiText: PhotoImportHistoryToolbarText;
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: PhotoImportHistoryStatusFilter) => void;
  onStorageFilterChange: (value: PhotoImportHistoryStorageFilter) => void;
  onSourceKindFilterChange: (value: string) => void;
  onShowArchivedChange: (value: boolean) => void;
  onArchiveMatches: () => void;
  onToggleBulk: () => void;
  onClearFilters: () => void;
};

export function PhotoImportHistoryToolbar(props: PhotoImportHistoryToolbarProps) {
  const canActOnMatches = props.queryFiltersActive && props.archivableCount > 0;
  return (
    <div className="photo-import-history-controls" aria-label={props.uiText("Import history filters")}>
      <label className="photo-search-control photo-import-history-search">
        <Search size={14} />
        <input
          type="search"
          aria-label={props.uiText("Search import history")}
          value={props.query}
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          placeholder={props.uiText("Search imports")}
        />
        {props.query && (
          <button type="button" onClick={() => props.onQueryChange("")} aria-label={props.uiText("Clear import history search")}>
            <X size={13} />
          </button>
        )}
      </label>
      <label className="photo-sort-control photo-import-history-filter">
        <span>{props.uiText("Status")}</span>
        <select
          aria-label={props.uiText("Import history status")}
          value={props.statusFilter}
          onChange={(event) => props.onStatusFilterChange(event.currentTarget.value as PhotoImportHistoryStatusFilter)}
        >
          <option value="all">{props.uiText("All statuses")}</option>
          <option value="completed">{props.uiText("Completed")}</option>
          <option value="issues">{props.uiText("Issues")}</option>
          <option value="failed">{props.uiText("Failed")}</option>
          <option value="running">{props.uiText("Importing")}</option>
        </select>
      </label>
      <label className="photo-sort-control photo-import-history-filter">
        <span>{props.uiText("Storage")}</span>
        <select
          aria-label={props.uiText("Import history storage")}
          value={props.storageFilter}
          onChange={(event) => props.onStorageFilterChange(event.currentTarget.value as PhotoImportHistoryStorageFilter)}
        >
          <option value="all">{props.uiText("All storage")}</option>
          <option value="referenced">{props.uiText("Reference originals")}</option>
          <option value="managed">{props.uiText("Copy into library")}</option>
        </select>
      </label>
      <label className="photo-sort-control photo-import-history-filter">
        <span>{props.uiText("Source")}</span>
        <select
          aria-label={props.uiText("Import history source")}
          value={props.sourceKindFilter}
          onChange={(event) => props.onSourceKindFilterChange(event.currentTarget.value)}
        >
          <option value="all">{props.uiText("All sources")}</option>
          {props.sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>{props.uiText(option.label)}</option>
          ))}
        </select>
      </label>
      <label className="photo-rule-toggle photo-import-history-archive-toggle">
        <input
          type="checkbox"
          checked={props.showArchived}
          onChange={(event) => props.onShowArchivedChange(event.currentTarget.checked)}
        />
        <span>{props.uiText("Show archived")}</span>
      </label>
      {canActOnMatches && (
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onArchiveMatches}
          disabled={props.busy || props.archiveSaving || props.editSaving}
        >
          <Archive size={14} />
          <span>{props.archiveSaving ? props.uiText("Archiving") : props.uiText("Archive matches")}</span>
        </button>
      )}
      {canActOnMatches && (
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onToggleBulk}
          disabled={props.busy || props.bulkSaving || props.editSaving}
          aria-expanded={props.bulkOpen}
        >
          <Tag size={14} />
          <span>{props.uiText("Set source for matches")}</span>
        </button>
      )}
      {props.filtersActive && (
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onClearFilters}
        >
          <X size={14} />
          <span>{props.uiText("Clear")}</span>
        </button>
      )}
    </div>
  );
}
