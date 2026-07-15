import { Check } from "lucide-react";

type PhotoSelectionSummaryControlsProps = {
  selectedCount: number;
  hasItems: boolean;
  busy: boolean;
  allPageSelected: boolean;
  bumpKey: number;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onTogglePageSelection: () => void;
};

export function PhotoSelectionSummaryControls({
  selectedCount,
  hasItems,
  busy,
  allPageSelected,
  bumpKey,
  uiText,
  formatCount,
  onTogglePageSelection,
}: PhotoSelectionSummaryControlsProps) {
  return (
    <>
      <button type="button" className="ghost compact-action" onClick={onTogglePageSelection} disabled={!hasItems || busy}>
        <Check size={14} />
        <span>{allPageSelected ? uiText("Clear page") : uiText("Select page")}</span>
      </button>
      <span>
        <span key={bumpKey} className={bumpKey > 0 ? "count-roll bump" : "count-roll"}>
          {formatCount(selectedCount)}
        </span>{" "}
        {uiText("selected")}
      </span>
    </>
  );
}
