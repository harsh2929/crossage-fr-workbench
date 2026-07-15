import { FolderPlus, MapPin, SlidersHorizontal, X } from "lucide-react";

import type { PhotoFilterChip, PhotoFilterChipKind } from "./photoFilterChips";
import { PHOTO_NEARBY_RADIUS_OPTIONS, type PhotoNearbyFilterState } from "./photoNearbyFilters";

type PhotoActiveFilterChipsText = (value: string) => string;

export type PhotoActiveFilterChipsProps = {
  chips: readonly PhotoFilterChip[];
  activeDateBucketKey: string;
  activeDateBucketLabel: string;
  nearbyFilter: PhotoNearbyFilterState | null;
  canSaveFilter: boolean;
  canSaveSearch: boolean;
  busy: boolean;
  savingSavedFilter: boolean;
  savingAlbum: boolean;
  uiText: PhotoActiveFilterChipsText;
  onClearDateBucket: () => void;
  onClearChip: (kind: PhotoFilterChipKind) => void;
  onSetNearbyRadius: (radiusKm: string) => void;
  onClearAll: () => void;
  onSaveFilter: () => void | Promise<void>;
  onSaveSearch: () => void | Promise<void>;
};

export function PhotoActiveFilterChips(props: PhotoActiveFilterChipsProps) {
  const removableCount = props.chips.length + (props.activeDateBucketKey ? 1 : 0);

  return (
    <div className="photo-active-filter-chips" aria-label={props.uiText("Active filters")}>
      {props.activeDateBucketKey && (
        <button type="button" onClick={props.onClearDateBucket} title={props.uiText("Remove filter")}>
          <span>{props.uiText("Date")}: {props.activeDateBucketLabel}</span>
          <X size={12} />
        </button>
      )}
      {props.chips.map((chip) => (
        <button key={chip.kind} type="button" onClick={() => props.onClearChip(chip.kind)} title={props.uiText("Remove filter")}>
          <span>{chip.label}</span>
          <X size={12} />
        </button>
      ))}
      {props.nearbyFilter && (
        <div className="photo-nearby-radius-control" aria-label={props.uiText("Nearby radius")}>
          <MapPin size={12} />
          <span>{props.uiText("Radius")}</span>
          {PHOTO_NEARBY_RADIUS_OPTIONS.map((radius) => (
            <button
              key={radius}
              type="button"
              className={props.nearbyFilter?.radiusKm === radius ? "active" : ""}
              aria-pressed={props.nearbyFilter?.radiusKm === radius}
              onClick={() => props.onSetNearbyRadius(radius)}
              title={`${props.uiText("Nearby radius")} ${radius} km`}
            >
              <span>{radius} km</span>
            </button>
          ))}
        </div>
      )}
      {removableCount > 1 && (
        <button type="button" className="clear-all" onClick={props.onClearAll}>
          <span>{props.uiText("Clear all")}</span>
          <X size={12} />
        </button>
      )}
      {props.canSaveFilter && (
        <button type="button" className="save-search" onClick={() => void props.onSaveFilter()} disabled={props.busy || props.savingSavedFilter}>
          <SlidersHorizontal size={12} />
          <span>{props.uiText("Save filter")}</span>
        </button>
      )}
      {props.canSaveSearch && (
        <button type="button" className="save-search" onClick={() => void props.onSaveSearch()} disabled={props.busy || props.savingAlbum}>
          <FolderPlus size={12} />
          <span>{props.uiText("Save search")}</span>
        </button>
      )}
    </div>
  );
}
