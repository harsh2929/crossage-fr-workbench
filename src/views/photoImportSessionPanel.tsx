import { AlertTriangle, Archive, FolderInput } from "lucide-react";
import type { PhotoImportSourceKind } from "../types";
import { PhotoImportHistoryProvenanceEditor } from "./photoImportProvenanceEditor";
import type { PhotoImportSessionSummary } from "./photoImportSessionDetails";

type PhotoImportSessionPanelText = (value: string) => string;

export type PhotoImportSessionPanelProps = {
  session: PhotoImportSessionSummary;
  activeId: string;
  busy: boolean;
  archiveSaving: boolean;
  editSaving: boolean;
  editId: string;
  editKind: PhotoImportSourceKind;
  editLabel: string;
  editDetail: string;
  editError: string;
  editStatus: string;
  uiText: PhotoImportSessionPanelText;
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

function photoImportSessionHeaderMeta(session: PhotoImportSessionSummary) {
  return [session.sourceKindLabel, session.storageLabel, session.statusLabel].filter(Boolean).join(" \u00b7 ");
}

export function PhotoImportSessionPanel(props: PhotoImportSessionPanelProps) {
  return (
    <section className="photo-import-session-panel" aria-label={props.uiText("Import details")}>
      <div className="photo-import-session-head">
        <span>
          <FolderInput size={15} />
          <strong>{props.uiText("Import details")}</strong>
        </span>
        <small>{photoImportSessionHeaderMeta(props.session)}</small>
      </div>
      <div className="photo-import-session-counts">
        <span>
          <strong>{props.formatCount(props.session.importedCount)}</strong>
          <small>{props.session.importedCount === 1 ? props.uiText("imported item") : props.uiText("imported items")}</small>
        </span>
        <span className={props.session.failedCount ? "warn" : ""}>
          <strong>{props.formatCount(props.session.failedCount)}</strong>
          <small>{props.session.failedCount === 1 ? props.uiText("failed item") : props.uiText("failed items")}</small>
        </span>
        {props.session.completedAt && (
          <span>
            <strong>{props.uiText("Completed")}</strong>
            <small>{props.formatDateText(props.session.completedAt)}</small>
          </span>
        )}
      </div>
      <dl className="photo-import-session-details">
        {props.session.details.map((detail) => (
          <div key={detail.key}>
            <dt>{props.uiText(detail.label)}</dt>
            <dd title={detail.value}>{props.uiText(detail.value)}</dd>
          </div>
        ))}
        {props.session.startedAt && (
          <div>
            <dt>{props.uiText("Started")}</dt>
            <dd>{props.formatDateText(props.session.startedAt)}</dd>
          </div>
        )}
      </dl>
      <div className="photo-import-session-actions">
        {props.activeId !== `import:${props.session.importId}` && (
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => props.onOpenImport(props.session.importId)}
          >
            <FolderInput size={14} />
            <span>{props.uiText("Open import")}</span>
          </button>
        )}
        {props.session.failedCount > 0 && (
          <button type="button" className="secondary compact-action" onClick={props.onOpenRecovered}>
            <AlertTriangle size={14} />
            <span>{props.uiText("Open Recovered")}</span>
          </button>
        )}
        <PhotoImportHistoryProvenanceEditor
          session={props.session}
          editing={props.editId === props.session.importId}
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
          className={props.session.archived ? "secondary compact-action" : "ghost compact-action"}
          onClick={() => props.onArchive(props.session.importId, !props.session.archived)}
          disabled={props.busy || props.archiveSaving || props.editSaving}
        >
          <Archive size={14} />
          <span>{props.session.archived ? props.uiText("Restore import") : props.uiText("Archive import")}</span>
        </button>
      </div>
      {props.editError && <small className="warn">{props.editError}</small>}
      {props.editStatus && !props.editError && <small>{props.editStatus}</small>}
    </section>
  );
}
