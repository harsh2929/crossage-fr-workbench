import { AlertTriangle } from "lucide-react";
import type { PhotoImportFailure, PhotoImportWarning } from "../types";

type PhotoImportStatusAlertsText = (value: string) => string;

export type PhotoImportStatusAlertsProps = {
  warnings: PhotoImportWarning[];
  failures: PhotoImportFailure[];
  uiText: PhotoImportStatusAlertsText;
  formatCount: (value: number) => string;
  fileName: (path: string) => string;
};

export function PhotoImportStatusAlerts(props: PhotoImportStatusAlertsProps) {
  return (
    <>
      {props.warnings.length > 0 && (
        <div className="photo-import-warning" role="status">
          <AlertTriangle size={15} />
          <div>
            {props.warnings.map((warning, index) => (
              <span key={`${warning.code || "import-warning"}:${index}`}>
                <strong>{props.uiText("Import note")}</strong>
                <small>{warning.message}</small>
              </span>
            ))}
          </div>
        </div>
      )}
      {props.failures.length > 0 && (
        <div className="photo-import-warning photo-import-failures" role="alert">
          <AlertTriangle size={15} />
          <div>
            <span>
              <strong>{props.uiText("Import issues")}</strong>
              <small>{props.formatCount(props.failures.length)} {props.failures.length === 1 ? props.uiText("item failed") : props.uiText("items failed")}</small>
            </span>
            {props.failures.slice(0, 6).map((failure, index) => {
              const source = String(failure.sourcePath || "");
              const target = String(failure.targetPath || "");
              return (
                <span key={`${source}:${index}`} className="photo-import-failure-row">
                  <strong title={source}>{failure.sourceName || props.fileName(source) || props.uiText("Unknown source")}</strong>
                  <small>{failure.reason || props.uiText("Import failed.")}</small>
                  {target ? <small title={target}>{props.uiText("Target")}: {props.fileName(target) || target}</small> : null}
                </span>
              );
            })}
            {props.failures.length > 6 && <small>{props.uiText("Open Recovered for the full import issue list.")}</small>}
          </div>
        </div>
      )}
    </>
  );
}
