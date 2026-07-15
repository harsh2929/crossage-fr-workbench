// Keep browse pages within the backend per-call preview-generation cap so the
// initial grid cannot leave a guaranteed tail of full-original fallbacks.
export const PAGE_LIMIT = 64;
export const PREVIEW_BUDGET = PAGE_LIMIT;
export const COVER_PREVIEW_BUDGET = 32;

export const PHOTO_GRID_GAP = 8;
export const PHOTO_GRID_HEADER_HEIGHT = 28;
export const PHOTO_GRID_OVERSCAN = 720;
export const PHOTO_GRID_SEARCH_DEBOUNCE_MS = 220;

export const SORTED_SOURCE_ORDER_PAGE_LIMIT = 500;
export const PHOTO_CREATION_LIBRARY_CANDIDATE_LIMIT = 500;
