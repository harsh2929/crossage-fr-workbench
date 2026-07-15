import { FolderInput } from "lucide-react";
import type { PhotoImportSourceKind } from "../types";
import { PhotoImportHistoryList } from "./photoImportHistoryList";
import { PhotoImportHistoryToolbar } from "./photoImportHistoryToolbar";
import { PhotoImportHistoryBulkProvenanceEditor } from "./photoImportProvenanceEditor";
import type {
  PhotoImportHistorySourceOption,
  PhotoImportHistoryStatusFilter,
  PhotoImportHistoryStorageFilter,
  PhotoImportSessionSummary,
} from "./photoImportSessionDetails";

type PhotoImportHistoryPanelText = (value: string) => string;

export type PhotoImportHistoryPanelProps = {
  sessions: PhotoImportSessionSummary[];
  archivableSessions: PhotoImportSessionSummary[];
  sourceOptions: PhotoImportHistorySourceOption[];
  countLabel: string;
  activeLibraryRoot: string;
  query: string;
  statusFilter: PhotoImportHistoryStatusFilter;
  storageFilter: PhotoImportHistoryStorageFilter;
  sourceKindFilter: string;
  showArchived: boolean;
  queryFiltersActive: boolean;
  filtersActive: boolean;
  bulkOpen: boolean;
  busy: boolean;
  archiveSaving: boolean;
  bulkSaving: boolean;
  editSaving: boolean;
  editId: string;
  editKind: PhotoImportSourceKind;
  editLabel: string;
  editDetail: string;
  editError: string;
  editStatus: string;
  uiText: PhotoImportHistoryPanelText;
  formatCount: (value: number) => string;
  formatDateText: (value: string) => string;
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: PhotoImportHistoryStatusFilter) => void;
  onStorageFilterChange: (value: PhotoImportHistoryStorageFilter) => void;
  onSourceKindFilterChange: (value: string) => void;
  onShowArchivedChange: (value: boolean) => void;
  onArchive: (importIds: string[], archive: boolean) => void;
  onToggleBulk: () => void;
  onClearFilters: () => void;
  onApplyBulkProvenance: (importIds: string[]) => void;
  onCloseBulk: () => void;
  onOpenImport: (importId: string) => void;
  onOpenRecovered: () => void;
  onStartEdit: (session: PhotoImportSessionSummary) => void;
  onSaveEdit: (importId: string) => void;
  onCancelEdit: () => void;
  onEditKindChange: (kind: PhotoImportSourceKind) => void;
  onEditLabelChange: (value: string) => void;
  onEditDetailChange: (value: string) => void;
};

function photoImportIds(sessions: PhotoImportSessionSummary[]) {
  return sessions.map((session) => session.importId);
}

export function PhotoImportHistoryPanel(props: PhotoImportHistoryPanelProps) {
  const activeArchivableIds = photoImportIds(props.archivableSessions);
  return (
    <section className="photo-import-history-panel" aria-label={props.uiText("Import history")}>
      <div className="photo-import-session-head">
        <span>
          <FolderInput size={15} />
          <strong>{props.uiText("Import history")}</strong>
        </span>
        <small>{props.countLabel}</small>
      </div>
      <PhotoImportHistoryToolbar
        query={props.query}
        statusFilter={props.statusFilter}
        storageFilter={props.storageFilter}
        sourceKindFilter={props.sourceKindFilter}
        showArchived={props.showArchived}
        sourceOptions={props.sourceOptions}
        queryFiltersActive={props.queryFiltersActive}
        filtersActive={props.filtersActive}
        archivableCount={props.archivableSessions.length}
        bulkOpen={props.bulkOpen}
        busy={props.busy}
        archiveSaving={props.archiveSaving}
        bulkSaving={props.bulkSaving}
        editSaving={props.editSaving}
        uiText={props.uiText}
        onQueryChange={props.onQueryChange}
        onStatusFilterChange={props.onStatusFilterChange}
        onStorageFilterChange={props.onStorageFilterChange}
        onSourceKindFilterChange={props.onSourceKindFilterChange}
        onShowArchivedChange={props.onShowArchivedChange}
        onArchiveMatches={() => props.onArchive(activeArchivableIds, true)}
        onToggleBulk={props.onToggleBulk}
        onClearFilters={props.onClearFilters}
      />
      {props.editError && <small className="warn">{props.editError}</small>}
      {props.editStatus && !props.editError && <small>{props.editStatus}</small>}
      {props.bulkOpen && props.archivableSessions.length > 0 && (
        <PhotoImportHistoryBulkProvenanceEditor
          sourceKind={props.editKind}
          sourceLabel={props.editLabel}
          sourceDetail={props.editDetail}
          targetCount={props.archivableSessions.length}
          busy={props.busy}
          saving={props.bulkSaving}
          uiText={props.uiText}
          formatCount={props.formatCount}
          onApply={() => props.onApplyBulkProvenance(activeArchivableIds)}
          onCancel={props.onCloseBulk}
          onSourceKindChange={props.onEditKindChange}
          onSourceLabelChange={props.onEditLabelChange}
          onSourceDetailChange={props.onEditDetailChange}
        />
      )}
      <PhotoImportHistoryList
        sessions={props.sessions}
        activeLibraryRoot={props.activeLibraryRoot}
        filtersActive={props.filtersActive}
        busy={props.busy}
        archiveSaving={props.archiveSaving}
        editSaving={props.editSaving}
        editId={props.editId}
        editKind={props.editKind}
        editLabel={props.editLabel}
        editDetail={props.editDetail}
        uiText={props.uiText}
        formatCount={props.formatCount}
        formatDateText={props.formatDateText}
        onOpenImport={props.onOpenImport}
        onOpenRecovered={props.onOpenRecovered}
        onArchive={(importId, archive) => props.onArchive([importId], archive)}
        onStartEdit={props.onStartEdit}
        onSaveEdit={props.onSaveEdit}
        onCancelEdit={props.onCancelEdit}
        onEditKindChange={props.onEditKindChange}
        onEditLabelChange={props.onEditLabelChange}
        onEditDetailChange={props.onEditDetailChange}
      />
    </section>
  );
}
