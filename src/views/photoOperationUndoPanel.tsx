import { RotateCcw } from "lucide-react";
import type { PhotoOperation } from "../types";
import { photoOperationDetailItems } from "./photoOperationDetails";

type PhotoOperationUndoPanelProps = {
  operation: PhotoOperation | null;
  error: string;
  undoDisabled: boolean;
  uiText: (value: string) => string;
  fileName: (value: string) => string;
  shortText: (value: string) => string;
  formatCount: (value: number) => string;
  formatDateText: (value: unknown) => string;
  onUndo: (operationId: string) => void;
};

export function PhotoOperationUndoPanel({
  operation,
  error,
  undoDisabled,
  uiText,
  fileName,
  shortText,
  formatCount,
  formatDateText,
  onUndo,
}: PhotoOperationUndoPanelProps) {
  if (!operation && !error) return null;
  const detailItems = operation
    ? photoOperationDetailItems(operation, {
      uiText,
      fileName,
      shortText,
      formatCount,
      formatDateText,
    })
    : [];

  return (
    <div className="photo-operation-undo" role={error ? "alert" : "status"}>
      {operation ? (
        <>
          <span>
            <strong>{operation.label || uiText("Photo action recorded")}</strong>
            <small>{uiText("This safety action can be undone.")}</small>
            <details className="photo-operation-details">
              <summary>{uiText("Action details")}</summary>
              <div>
                {detailItems.map((detail) => (
                  <span className="photo-operation-detail" key={detail.label}>
                    <strong>{detail.label}:</strong>
                    {" "}
                    <span title={detail.title || detail.value}>{detail.value}</span>
                  </span>
                ))}
              </div>
            </details>
          </span>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => onUndo(operation.operationId)}
            disabled={undoDisabled}
          >
            <RotateCcw size={14} />
            <span>{uiText("Undo")}</span>
          </button>
        </>
      ) : (
        <span>
          <strong>{uiText("Could not load photo undo history")}</strong>
          <small>{error}</small>
        </span>
      )}
    </div>
  );
}
