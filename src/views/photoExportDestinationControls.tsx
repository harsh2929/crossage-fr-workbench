import { Copy, Download, X } from "lucide-react";
import { photoFileName, shortText } from "./photoDisplayText";

type PhotoExportDestinationControlsProps = {
  destinations: string[];
  destinationPath: string;
  selectedCount: number;
  busy: boolean;
  uiText: (value: string) => string;
  onDestinationChange: (destinationPath: string) => void;
  onExportToDestination: (destinationPath: string) => void;
  onCopyToDestination: () => void;
  onForgetDestination: (destinationPath: string) => void;
};

export function PhotoExportDestinationControls({
  destinations,
  destinationPath,
  selectedCount,
  busy,
  uiText,
  onDestinationChange,
  onExportToDestination,
  onCopyToDestination,
  onForgetDestination,
}: PhotoExportDestinationControlsProps) {
  return (
    <div className="photo-export-destinations" aria-label={uiText("Export destinations")}>
      <label>
        <span>{uiText("Export destination")}</span>
        <select
          value={destinationPath}
          onChange={(event) => onDestinationChange(event.currentTarget.value)}
          disabled={!destinations.length}
        >
          <option value="">{uiText("Choose on export")}</option>
          {destinations.map((destination) => (
            <option key={destination} value={destination}>{photoFileName(destination) || destination}</option>
          ))}
        </select>
      </label>
      {destinationPath && <small title={destinationPath}>{shortText(destinationPath)}</small>}
      <button
        type="button"
        className="secondary compact-action"
        onClick={() => onExportToDestination(destinationPath)}
        disabled={!selectedCount || !destinationPath || busy}
      >
        <Download size={14} />
        <span>{uiText("Export to destination")}</span>
      </button>
      <button
        type="button"
        className="ghost compact-action"
        onClick={onCopyToDestination}
        disabled={!selectedCount || !destinationPath || busy}
      >
        <Copy size={14} />
        <span>{uiText("Copy to destination")}</span>
      </button>
      <button
        type="button"
        className="ghost compact-action danger"
        onClick={() => onForgetDestination(destinationPath)}
        disabled={!destinationPath}
      >
        <X size={14} />
        <span>{uiText("Forget destination")}</span>
      </button>
    </div>
  );
}
