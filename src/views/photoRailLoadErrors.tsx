import { AlertTriangle, RefreshCcw } from "lucide-react";

type PhotoRailLoadErrorsText = (value: string) => string;

export type PhotoRailLoadErrorItem = {
  key: string;
  label: string;
  message: string;
};

export type PhotoRailLoadErrorsProps = {
  errors: PhotoRailLoadErrorItem[];
  busy: boolean;
  savingAlbum: boolean;
  uiText: PhotoRailLoadErrorsText;
  onRetry: () => void;
};

export function PhotoRailLoadErrors(props: PhotoRailLoadErrorsProps) {
  if (!props.errors.length) return null;
  return (
    <div className="photo-load-error" role="alert">
      <AlertTriangle size={15} />
      <div>
        {props.errors.map((item) => (
          <span key={item.key}>
            <strong>{item.label}</strong>
            <small>{item.message}</small>
          </span>
        ))}
      </div>
      <button type="button" className="secondary compact-action" onClick={props.onRetry} disabled={props.busy || props.savingAlbum}>
        <RefreshCcw size={14} />
        <span>{props.uiText("Retry")}</span>
      </button>
    </div>
  );
}
