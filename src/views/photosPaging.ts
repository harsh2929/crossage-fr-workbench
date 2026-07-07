// Pure paging helpers for the Photos tab's virtualized gallery. Kept free of
// React/DOM so they can be unit-tested in plain node (see
// tests/photos_view.test.mjs) and reused by PhotosView.

export function hasMorePages(state: { loaded: number; total: number }): boolean {
  return state.loaded < state.total;
}

export function nextOffset(state: { loaded: number }): number {
  return Math.max(0, state.loaded);
}
