import type { PhotoDateViewMode } from "./photoDateViews";
import type { PhotoNearbyFilterState } from "./photoNearbyFilters";
import type { PhotoMediaFilter, PhotoStatusFilter, PhotoVisibilityFilter } from "./photoSavedSearch";

export type PhotoSort = "manual" | "newest" | "oldest" | "scanDate" | "matchStrength" | "personCount" | "quality" | "title" | "filename" | "mediaKind";
export type PhotoGroupViewMode = "all" | "best";

export type PhotoPageLoadRequest = {
  folderId: string;
  offset?: number;
  sort?: PhotoSort;
  search?: string;
  keyword?: string;
  mediaKind?: PhotoMediaFilter;
  favoriteOnly?: boolean;
  editedOnly?: boolean;
  notInAlbumOnly?: boolean;
  person?: string;
  status?: PhotoStatusFilter;
  minQuality?: string;
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  fileType?: string;
  duplicateOnly?: boolean;
  location?: string;
  camera?: string;
  albumId?: string;
  visibility?: PhotoVisibilityFilter;
  dateBucketMode?: PhotoDateViewMode;
  dateBucketKey?: string;
  groupMode?: PhotoGroupViewMode;
  nearby?: PhotoNearbyFilterState | null;
};
