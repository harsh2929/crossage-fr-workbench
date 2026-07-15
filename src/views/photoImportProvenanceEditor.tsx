import { Pencil, Save, X } from "lucide-react";
import type { PhotoImportSourceKind } from "../types";
import { PHOTO_IMPORT_SOURCE_OPTIONS } from "./photoImportAccess";
import type { PhotoImportSessionSummary } from "./photoImportSessionDetails";

type PhotoImportProvenanceText = (value: string) => string;

type PhotoImportProvenanceDraftProps = {
  sourceKind: PhotoImportSourceKind;
  sourceLabel: string;
  sourceDetail: string;
  onSourceKindChange: (kind: PhotoImportSourceKind) => void;
  onSourceLabelChange: (value: string) => void;
  onSourceDetailChange: (value: string) => void;
};

export type PhotoImportHistoryProvenanceEditorProps = PhotoImportProvenanceDraftProps & {
  session: PhotoImportSessionSummary;
  editing: boolean;
  busy: boolean;
  saving: boolean;
  uiText: PhotoImportProvenanceText;
  onStartEdit: (session: PhotoImportSessionSummary) => void;
  onSave: (importId: string) => void;
  onCancel: () => void;
};

export type PhotoImportHistoryBulkProvenanceEditorProps = PhotoImportProvenanceDraftProps & {
  targetCount: number;
  busy: boolean;
  saving: boolean;
  uiText: PhotoImportProvenanceText;
  formatCount: (value: number) => string;
  onApply: () => void;
  onCancel: () => void;
};

function PhotoImportSourceFields(props: PhotoImportProvenanceDraftProps & {
  busy: boolean;
  uiText: PhotoImportProvenanceText;
  sourceKindLabel: string;
  sourceLabelLabel: string;
  sourceDetailLabel: string;
  sourceLabelPlaceholder?: string;
}) {
  return (
    <>
      <label>
        <span>{props.uiText("Source")}</span>
        <select
          aria-label={props.uiText(props.sourceKindLabel)}
          value={props.sourceKind}
          onChange={(event) => props.onSourceKindChange(event.currentTarget.value as PhotoImportSourceKind)}
          disabled={props.busy}
        >
          {PHOTO_IMPORT_SOURCE_OPTIONS.map((option) => (
            <option key={option.kind} value={option.kind}>{props.uiText(option.label)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{props.uiText("Label")}</span>
        <input
          aria-label={props.uiText(props.sourceLabelLabel)}
          value={props.sourceLabel}
          onChange={(event) => props.onSourceLabelChange(event.currentTarget.value)}
          placeholder={props.sourceLabelPlaceholder ? props.uiText(props.sourceLabelPlaceholder) : undefined}
          disabled={props.busy}
          maxLength={128}
        />
      </label>
      <label>
        <span>{props.uiText("Detail")}</span>
        <input
          aria-label={props.uiText(props.sourceDetailLabel)}
          value={props.sourceDetail}
          onChange={(event) => props.onSourceDetailChange(event.currentTarget.value)}
          placeholder={props.uiText("Sender, webpage, or note")}
          disabled={props.busy}
          maxLength={240}
        />
      </label>
    </>
  );
}

export function PhotoImportHistoryProvenanceEditor(props: PhotoImportHistoryProvenanceEditorProps) {
  if (!props.editing) {
    return (
      <button
        type="button"
        className="ghost compact-action"
        onClick={() => props.onStartEdit(props.session)}
        disabled={props.busy || props.saving}
        aria-label={`${props.uiText("Edit import source")} ${props.session.sourceLabel}`}
      >
        <Pencil size={14} />
        <span>{props.uiText("Edit source")}</span>
      </button>
    );
  }
  return (
    <div className="photo-import-provenance-editor" role="group" aria-label={props.uiText("Edit import source")}>
      <PhotoImportSourceFields
        sourceKind={props.sourceKind}
        sourceLabel={props.sourceLabel}
        sourceDetail={props.sourceDetail}
        onSourceKindChange={props.onSourceKindChange}
        onSourceLabelChange={props.onSourceLabelChange}
        onSourceDetailChange={props.onSourceDetailChange}
        busy={props.busy || props.saving}
        uiText={props.uiText}
        sourceKindLabel="Edit import source kind"
        sourceLabelLabel="Edit import source label"
        sourceDetailLabel="Edit import source detail"
      />
      <div className="photo-import-provenance-editor-actions">
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => props.onSave(props.session.importId)}
          disabled={props.busy || props.saving || !props.sourceLabel.trim()}
        >
          <Save size={14} />
          <span>{props.saving ? props.uiText("Saving") : props.uiText("Save source")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onCancel}
          disabled={props.saving}
        >
          <X size={14} />
          <span>{props.uiText("Cancel")}</span>
        </button>
      </div>
    </div>
  );
}

export function PhotoImportHistoryBulkProvenanceEditor(props: PhotoImportHistoryBulkProvenanceEditorProps) {
  return (
    <div className="photo-import-provenance-editor" role="group" aria-label={props.uiText("Set source for matches")}>
      <PhotoImportSourceFields
        sourceKind={props.sourceKind}
        sourceLabel={props.sourceLabel}
        sourceDetail={props.sourceDetail}
        onSourceKindChange={props.onSourceKindChange}
        onSourceLabelChange={props.onSourceLabelChange}
        onSourceDetailChange={props.onSourceDetailChange}
        busy={props.busy || props.saving}
        uiText={props.uiText}
        sourceKindLabel="Bulk import source kind"
        sourceLabelLabel="Bulk import source label"
        sourceDetailLabel="Bulk import source detail"
        sourceLabelPlaceholder="Leave blank to keep each label"
      />
      <div className="photo-import-provenance-editor-actions">
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onApply}
          disabled={props.busy || props.saving}
        >
          <Save size={14} />
          <span>{props.saving ? props.uiText("Saving") : `${props.uiText("Apply to")} ${props.formatCount(props.targetCount)}`}</span>
        </button>
        <button type="button" className="ghost compact-action" onClick={props.onCancel} disabled={props.saving}>
          <X size={14} />
          <span>{props.uiText("Cancel")}</span>
        </button>
      </div>
    </div>
  );
}
