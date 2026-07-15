export type PhotoPetReviewKind = {
  label?: string;
  count: number;
};

type PhotoPetReviewKindChipsText = (value: string) => string;
type PhotoPetReviewKindChipsCount = (value: number) => string;

export type PhotoPetReviewKindChipsProps = {
  kinds: readonly PhotoPetReviewKind[];
  activeCount: number;
  selectedKind: string;
  uiText: PhotoPetReviewKindChipsText;
  formatCount: PhotoPetReviewKindChipsCount;
  onSelectKind: (kind: string) => void;
};

export function PhotoPetReviewKindChips(props: PhotoPetReviewKindChipsProps) {
  return (
    <div className="photo-pet-review-kind-chips" aria-label={props.uiText("Pet Review kind filters")}>
      <button
        type="button"
        className={!props.selectedKind ? "active" : ""}
        aria-pressed={!props.selectedKind}
        onClick={() => props.onSelectKind("")}
      >
        <span>{props.uiText("All pets")}</span>
        <small>{props.formatCount(props.activeCount)}</small>
      </button>
      {props.kinds.map((kind) => {
        const label = String(kind.label || "").trim() || props.uiText("Pet");
        const selected = props.selectedKind === label;
        return (
          <button
            key={label}
            type="button"
            className={selected ? "active" : ""}
            aria-pressed={selected}
            aria-label={`${props.uiText("Show")} ${props.uiText(label)} ${props.uiText("Pet Review items")}`}
            onClick={() => props.onSelectKind(selected ? "" : label)}
          >
            <span>{props.uiText(label)}</span>
            <small>{props.formatCount(kind.count)}</small>
          </button>
        );
      })}
    </div>
  );
}
