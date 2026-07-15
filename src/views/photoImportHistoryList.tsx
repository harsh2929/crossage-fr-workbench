import { AlertTriangle, Archive, FolderInput, Search } from "lucide-react";
import type { PhotoImportSourceKind } from "../types";
import { PhotoImportHistoryProvenanceEditor } from "./photoImportProvenanceEditor";
import type { PhotoImportSessionSummary } from "./photoImportSessionDetails";

type PhotoImportHistoryListText = (value: string) => string;

export type PhotoImportHistoryListProps = {
  sessions: PhotoImportSessionSummary[];
  activeLibraryRoot: string;
  filtersActive: boolean;
  busy: boolean;
  archiveSaving: boolean;
  editSaving: boolean;
  editId: string;
  editKind: PhotoImportSourceKind;
  editLabel: string;
  editDetail: string;
  uiText: PhotoImportHistoryListText;
  formatCount: (value: number) => string;
  formatDateText: (value: string) => string;
  onOpenImport: (importId: string) => void;
  onOpenRecovered: () => void;
  onArchive: (importId: string, archive: boolean) => void;
  onStartEdit: (session: PhotoImportSessionSummary) => void;
  onSaveEdit: (importId: string) => void;
  onCancelEdit: () => void;
  onEditKindChange: (kind: PhotoImportSourceKind) => void;
  onEditLabelChange: (value: string) => void;
  onEditDetailChange: (value: string) => void;
};

function photoImportHistoryRowMeta(session: PhotoImportSessionSummary, uiText: PhotoImportHistoryListText) {
  return [
    session.sourceKindLabel,
    session.storageLabel,
    session.statusLabel,
    session.sourceDetail ? uiText(session.sourceDetail) : "",
    session.archived ? uiText("Archived") : "",
  ].filter(Boolean).join(" \u00b7 ");
}

export function PhotoImportHistoryList(props: PhotoImportHistoryListProps) {
  if (!props.sessions.length) {
    const libraryEmpty = Boolean(props.activeLibraryRoot) && !props.filtersActive;
    return (
      <div className="photo-import-history-empty">
        <Search size={15} />
        <span>
          <strong>{props.uiText(libraryEmpty ? "No imports in this library" : "No matching imports")}</strong>
          <small>{props.uiText(libraryEmpty ? "Choose All libraries or another Library view." : "Try a different source, status, storage, or search.")}</small>
        </span>
      </div>
    );
  }

  return (
    <div className="photo-import-history-list">
      {props.sessions.map((session) => {
        const sessionDate = session.completedAt || session.updatedAt || session.startedAt;
        return (
          <div className="photo-import-history-row" key={session.importId}>
            <button
              type="button"
              className="photo-import-history-main"
              onClick={() => props.onOpenImport(session.importId)}
            >
              <FolderInput size={14} />
              <span>
                <strong>{props.uiText(session.sourceLabel)}</strong>
                <small>{photoImportHistoryRowMeta(session, props.uiText)}</small>
              </span>
            </button>
            <span className="photo-import-history-count">
              <strong>{props.formatCount(session.importedCount)}</strong>
              <small>{props.uiText("imported")}</small>
            </span>
            <span className={session.failedCount ? "photo-import-history-count warn" : "photo-import-history-count"}>
              <strong>{props.formatCount(session.failedCount)}</strong>
              <small>{props.uiText("failed")}</small>
            </span>
            {sessionDate && <small className="photo-import-history-date">{props.formatDateText(sessionDate)}</small>}
            {session.archived && session.archivedAt && (
              <small className="photo-import-history-date">
                {props.uiText("Archived")} {props.formatDateText(session.archivedAt)}
              </small>
            )}
            {session.failedCount > 0 && (
              <button type="button" className="ghost compact-action" onClick={props.onOpenRecovered}>
                <AlertTriangle size={14} />
                <span>{props.uiText("Open Recovered")}</span>
              </button>
            )}
            <PhotoImportHistoryProvenanceEditor
              session={session}
              editing={props.editId === session.importId}
              sourceKind={props.editKind}
              sourceLabel={props.editLabel}
              sourceDetail={props.editDetail}
              busy={props.busy}
              saving={props.editSaving}
              uiText={props.uiText}
              onStartEdit={props.onStartEdit}
              onSave={props.onSaveEdit}
              onCancel={props.onCancelEdit}
              onSourceKindChange={props.onEditKindChange}
              onSourceLabelChange={props.onEditLabelChange}
              onSourceDetailChange={props.onEditDetailChange}
            />
            <button
              type="button"
              className={session.archived ? "secondary compact-action" : "ghost compact-action"}
              onClick={() => props.onArchive(session.importId, !session.archived)}
              disabled={props.busy || props.archiveSaving || props.editSaving}
            >
              <Archive size={14} />
              <span>{session.archived ? props.uiText("Restore") : props.uiText("Archive")}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
