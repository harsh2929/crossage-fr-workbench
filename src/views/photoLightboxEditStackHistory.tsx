import { useMemo } from "react";
import { Clock, RotateCcw, Trash2 } from "lucide-react";
import type { PhotoEditStackValue, PhotoEditStackVersionValue, PhotoItem } from "../types";
import { compactPhotoEditStackId, photoEditStackVersionOperationLabel, photoRecordValue } from "./photoImageEditDisplay";
import { photoEditStackOperationHistoryRows, photoEditStackVersionHistoryRows } from "./photoImageEdits";

type PhotoLightboxEditStackHistoryProps = {
  item: PhotoItem | null;
  editStack: PhotoEditStackValue | null;
  versions: PhotoEditStackVersionValue[];
  versionId: string;
  selectedVersion: PhotoEditStackVersionValue | null;
  saving: boolean;
  missing: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  formatDate: (value: unknown) => string;
  onVersionChange: (versionId: string) => void;
  onRestoreVersion: (item: PhotoItem | null) => void | Promise<void>;
  onDeleteVersion: (item: PhotoItem | null) => void | Promise<void>;
};

export function PhotoLightboxEditStackHistory({
  item,
  editStack,
  versions,
  versionId,
  selectedVersion,
  saving,
  missing,
  uiText,
  formatCount,
  formatDate,
  onVersionChange,
  onRestoreVersion,
  onDeleteVersion,
}: PhotoLightboxEditStackHistoryProps) {
  const operationRows = useMemo(
    () => photoEditStackOperationHistoryRows(editStack),
    [editStack]
  );
  const selectedVersionOperations = useMemo(
    () => (Array.isArray(selectedVersion?.operations)
      ? selectedVersion.operations.filter(photoRecordValue)
      : []),
    [selectedVersion]
  );
  const selectedVersionOperationCount = selectedVersionOperations.length;
  const selectedVersionOperationLabel = useMemo(
    () => photoEditStackVersionOperationLabel(selectedVersionOperations),
    [selectedVersionOperations]
  );
  const selectedVersionSavedRaw = String(selectedVersion?.updatedAt || selectedVersion?.createdAt || "").trim();
  const selectedVersionSavedAt = formatDate(selectedVersionSavedRaw);
  const selectedVersionSourceEditId = String(selectedVersion?.sourceEditId || "").trim();
  const selectedVersionSourceLabel = selectedVersionSourceEditId
    ? selectedVersionSourceEditId === String(editStack?.editId || "")
      ? uiText("Current stack")
      : compactPhotoEditStackId(selectedVersionSourceEditId)
    : "";
  const selectedVersionId = String(selectedVersion?.versionId || versionId || "");
  const versionRows = useMemo(
    () => photoEditStackVersionHistoryRows(versions, {
      formatDate,
      selectedVersionId,
    }),
    [formatDate, selectedVersionId, versions]
  );
  const selectedVersionHistoryRow = useMemo(
    () => versionRows.find((row) => row.id === selectedVersionId) || null,
    [selectedVersionId, versionRows]
  );

  if (!operationRows.length && !versions.length) return null;

  return (
    <>
      {operationRows.length > 0 && (
        <div className="photos-edit-operation-history" role="group" aria-label={uiText("Current edit operations")}>
          <strong>{uiText("Current edit operations")}</strong>
          <div>
            {operationRows.map((row) => (
              <span key={row.id} className="photos-edit-operation-history-row" title={row.operationLabel}>
                <small>{row.stepLabel}</small>
                <span>{row.kindLabel}</span>
                <em>{row.operationLabel || uiText("Original")}</em>
                {row.detailLabels.map((label) => (
                  <small key={label}>{label}</small>
                ))}
                {row.source && <small>{row.source}</small>}
              </span>
            ))}
          </div>
        </div>
      )}
      {versions.length > 0 && (
        <>
          <label className="photos-edit-clipboard-history">
            <Clock size={14} />
            <select
              value={versionId}
              onChange={(event) => onVersionChange(event.currentTarget.value)}
              aria-label={uiText("Edit stack versions")}
            >
              {versions.map((version) => (
                <option key={version.versionId} value={version.versionId}>{version.label || uiText("Version")}</option>
              ))}
            </select>
          </label>
          {selectedVersion && (
            <div className="photos-edit-version-preview" role="group" aria-label={uiText("Edit version preview")}>
              <span className="photos-edit-version-chip">
                <strong>{uiText("Operations")}</strong>
                <span>
                  {selectedVersionOperationCount
                    ? `${formatCount(selectedVersionOperationCount)} ${selectedVersionOperationCount === 1 ? uiText("operation") : uiText("operations")}`
                    : uiText("Original")}
                </span>
              </span>
              {selectedVersionOperationLabel && (
                <span className="photos-edit-version-chip photos-edit-version-chip-wide" title={selectedVersionOperationLabel}>
                  <strong>{uiText("Preview")}</strong>
                  <span>{selectedVersionOperationLabel}</span>
                </span>
              )}
              {selectedVersionSavedAt && (
                <span className="photos-edit-version-chip" title={selectedVersionSavedRaw}>
                  <strong>{uiText("Saved")}</strong>
                  <span>{selectedVersionSavedAt}</span>
                </span>
              )}
              {selectedVersionSourceLabel && (
                <span className="photos-edit-version-chip" title={selectedVersionSourceEditId}>
                  <strong>{uiText("Source edit")}</strong>
                  <span>{selectedVersionSourceLabel}</span>
                </span>
              )}
              {selectedVersionHistoryRow?.detailLabels.map((label) => (
                <span key={label} className="photos-edit-version-chip photos-edit-version-chip-wide" title={label}>
                  <strong>{uiText("Detail")}</strong>
                  <span>{label}</span>
                </span>
              ))}
            </div>
          )}
          {versionRows.length > 0 && (
            <div className="photos-edit-version-history" role="group" aria-label={uiText("Edit version history")}>
              {versionRows.map((row) => {
                const sourceLabel = row.sourceEditId
                  ? row.sourceEditId === String(editStack?.editId || "")
                    ? uiText("Current stack")
                    : compactPhotoEditStackId(row.sourceEditId)
                  : "";
                const operationCountLabel = row.operationCount
                  ? `${formatCount(row.operationCount)} ${row.operationCount === 1 ? uiText("operation") : uiText("operations")}`
                  : uiText("Original");
                const detailText = [
                  operationCountLabel,
                  row.operationLabel || "",
                  ...row.detailLabels,
                  row.savedAt ? `${uiText("Saved")} ${row.savedAt}` : "",
                  sourceLabel ? `${uiText("Source edit")} ${sourceLabel}` : "",
                ].filter(Boolean).join(" · ");
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`photos-edit-version-history-row${row.selected ? " active" : ""}`}
                    onClick={() => onVersionChange(row.id)}
                    aria-pressed={row.selected}
                    title={detailText}
                  >
                    <span>
                      <strong>{row.label}</strong>
                      <small>{operationCountLabel}</small>
                    </span>
                    <small>{row.operationLabel || uiText("Original")}</small>
                    {row.detailLabels.length > 0 && (
                      <small>{row.detailLabels.join(" · ")}</small>
                    )}
                    {(row.savedAt || sourceLabel) && (
                      <small>
                        {[
                          row.savedAt ? `${uiText("Saved")} ${row.savedAt}` : "",
                          sourceLabel ? `${uiText("Source edit")} ${sourceLabel}` : "",
                        ].filter(Boolean).join(" · ")}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onRestoreVersion(item)}
            disabled={!selectedVersion || saving || missing}
            aria-label={uiText("Restore edit version")}
          >
            <RotateCcw size={14} />
            <span>{uiText("Restore version")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action danger"
            onClick={() => void onDeleteVersion(item)}
            disabled={!selectedVersion || saving || missing}
            aria-label={uiText("Delete edit version")}
          >
            <Trash2 size={14} />
            <span>{uiText("Delete version")}</span>
          </button>
        </>
      )}
    </>
  );
}
