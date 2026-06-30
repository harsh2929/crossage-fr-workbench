export type PhotoVirtualAspectMode = "square" | "aspect";

export type PhotoVirtualTimelineRow<T> =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; item: T; index: number };

export type PhotoVirtualGridBand<T> =
  | { kind: "header"; key: string; row: Extract<PhotoVirtualTimelineRow<T>, { kind: "header" }>; top: number; height: number }
  | { kind: "items"; key: string; rows: Array<Extract<PhotoVirtualTimelineRow<T>, { kind: "item" }>>; top: number; height: number };

export interface PhotoVirtualGridLayout<T> {
  bands: PhotoVirtualGridBand<T>[];
  columns: number;
  columnWidth: number;
  totalHeight: number;
}

export interface PhotoVirtualGridWindow<T> extends PhotoVirtualGridLayout<T> {
  visibleBands: PhotoVirtualGridBand<T>[];
}

export function estimatePhotoGridColumns(containerWidth: number, minTileSize: number, gap = 8): number {
  const width = Number(containerWidth);
  const tile = Math.max(1, Number(minTileSize) || 1);
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (tile + gap)));
}

export function buildPhotoVirtualGridLayout<T extends { width?: unknown; height?: unknown }>(
  rows: Array<PhotoVirtualTimelineRow<T>>,
  options: {
    containerWidth: number;
    minTileSize: number;
    aspectMode: PhotoVirtualAspectMode;
    gap?: number;
    headerHeight?: number;
  }
): PhotoVirtualGridLayout<T> {
  const gap = Math.max(0, Number(options.gap ?? 8) || 0);
  const headerHeight = Math.max(1, Number(options.headerHeight ?? 28) || 28);
  const columns = estimatePhotoGridColumns(options.containerWidth, options.minTileSize, gap);
  const width = Math.max(columns, Number(options.containerWidth) || Number(options.minTileSize) || 1);
  const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
  const bands: PhotoVirtualGridBand<T>[] = [];
  let top = 0;
  let pendingItems: Array<Extract<PhotoVirtualTimelineRow<T>, { kind: "item" }>> = [];

  const pushBand = (band: PhotoVirtualGridBand<T>) => {
    bands.push(band);
    top += band.height + gap;
  };

  const flushItems = () => {
    for (let offset = 0; offset < pendingItems.length; offset += columns) {
      const chunk = pendingItems.slice(offset, offset + columns);
      const height = Math.max(...chunk.map((row) => estimatePhotoGridItemHeight(row.item, columnWidth, options.aspectMode)), columnWidth);
      pushBand({
        kind: "items",
        key: `items:${chunk[0]?.key || offset}:${chunk.at(-1)?.key || offset}`,
        rows: chunk,
        top,
        height,
      });
    }
    pendingItems = [];
  };

  rows.forEach((row) => {
    if (row.kind === "header") {
      flushItems();
      pushBand({ kind: "header", key: row.key, row, top, height: headerHeight });
      return;
    }
    pendingItems.push(row);
  });
  flushItems();

  return {
    bands,
    columns,
    columnWidth,
    totalHeight: bands.length ? Math.max(0, top - gap) : 0,
  };
}

export function windowPhotoVirtualGridLayout<T>(
  layout: PhotoVirtualGridLayout<T>,
  options: { scrollTop: number; viewportHeight: number; overscan?: number }
): PhotoVirtualGridWindow<T> {
  const overscan = Math.max(0, Number(options.overscan ?? 720) || 0);
  const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
  const start = Math.max(0, Number(options.scrollTop) || 0) - overscan;
  const end = Math.max(0, Number(options.scrollTop) || 0) + viewportHeight + overscan;
  const firstVisible = firstPhotoVirtualGridBandAtOrAfter(layout.bands, start);
  const visibleBands: PhotoVirtualGridBand<T>[] = [];
  for (let index = firstVisible; index < layout.bands.length; index += 1) {
    const band = layout.bands[index];
    if (band.top > end) break;
    visibleBands.push(band);
  }
  return {
    ...layout,
    visibleBands,
  };
}

function estimatePhotoGridItemHeight(item: { width?: unknown; height?: unknown }, columnWidth: number, aspectMode: PhotoVirtualAspectMode): number {
  if (aspectMode === "square") return columnWidth;
  const width = Number(item.width);
  const height = Number(item.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return columnWidth;
  const ratio = Math.min(2, Math.max(0.667, width / height));
  return columnWidth / ratio;
}

function firstPhotoVirtualGridBandAtOrAfter<T>(bands: PhotoVirtualGridBand<T>[], start: number): number {
  let low = 0;
  let high = bands.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const band = bands[mid];
    if (band.top + band.height < start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
