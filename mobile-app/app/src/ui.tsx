/**
 * Shared UI primitives for the app shell: the photo cell, a reusable PhotoGrid with an embedded
 * full-screen viewer, and the crafted zero/loading states (EmptyState, Skeleton). Every grid screen
 * renders through PhotoGrid so cell sizing, recycling, staggered entrance, selection affordance, and
 * detail-open behaviour stay identical everywhere.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, Animated, Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType, type AssetMetadata } from 'expo-media-library';
import { PhotoDetail } from './PhotoDetail';
import { palette, space, typography, discScrim } from './theme';
import { Icon } from './Icon';
import { Springy, BreathingOrb, FloatingView, Shimmer, useGridEntrance } from './motion';
import { COLS, CELL, assetUri, type CellRect } from './media';

export { COLS, CELL, assetUri }; // re-exported so existing `import { … } from '../ui'` keeps working
export { palette };

/** Cells past the first screenful skip the entrance stagger (they render at rest — recycle-safe). */
const FIRST_SCREEN = 24;

/** "1:05" from a duration in seconds. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

/**
 * EmptyState — one crafted look for every zero-state and hero pitch: a breathing accent orb behind an
 * optional floating glyph, a bold title, a subtitle, and an optional action. Colour lives in the orb;
 * the rest stays neutral.
 */
export function EmptyState({
  glyph,
  title,
  subtitle,
  orb,
  orbColor = palette.accent,
  action,
}: {
  glyph?: string;
  title?: string;
  subtitle?: string;
  orb?: boolean;
  orbColor?: string;
  action?: React.ReactNode;
}) {
  return (
    <Center>
      {orb ? (
        <View style={styles.orbWrap}>
          <BreathingOrb size={140} color={orbColor} />
          {glyph ? (
            <FloatingView>
              <Text style={styles.emptyGlyph}>{glyph}</Text>
            </FloatingView>
          ) : null}
        </View>
      ) : glyph ? (
        <Text style={styles.emptyGlyph}>{glyph}</Text>
      ) : null}
      {title ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.emptyTitle}>
          {title}
        </Text>
      ) : null}
      {subtitle ? (
        <Text maxFontSizeMultiplier={1.6} style={styles.emptySub}>
          {subtitle}
        </Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </Center>
  );
}

/** A grid of breathing placeholder cells for first-load, so the grid fades in over a scaffold. */
export function Skeleton({ cols = COLS, rows = 6 }: { cols?: number; rows?: number }) {
  return (
    <View style={styles.skeletonGrid}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <Shimmer key={i} style={styles.cell} />
      ))}
    </View>
  );
}

/** Affirmative selection affordance — an accent ring + a filled check disc (not a disabling fade). */
function SelectionRing({ selected }: { selected: boolean }) {
  return (
    <>
      {selected && <View pointerEvents="none" style={styles.selRing} />}
      <View style={[styles.selDisc, selected && styles.selDiscOn]}>
        {selected && <Icon name="check" size={12} color="#ffffff" strokeWidth={2} />}
      </View>
    </>
  );
}

// Short month names for the VoiceOver cell label — a constant array, not Intl (Hermes can ignore
// { month:'long' } and return a locale default, the same reason the screens keep their own arrays).
const CELL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A spoken label for a grid cell: "Photo/Video, favorite, Mon YYYY" — so VoiceOver users can tell
 *  cells apart (every cell previously announced the identical "Photo"). Intl-free + degrades cleanly. */
function cellA11yLabel(item: AssetMetadata): string {
  const kind = item.mediaType === MediaType.VIDEO ? 'Video' : 'Photo';
  const fav = item.isFavorite ? ', favorite' : '';
  const raw = item.creationTime ?? 0;
  const ms = raw > 0 && raw < 1e11 ? raw * 1000 : raw;
  if (ms > 0) {
    const d = new Date(ms);
    return `${kind}${fav}, ${CELL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${kind}${fav}`;
}

function Cell({
  item,
  index,
  total,
  selected,
  onOpen,
  onToggle,
  entrance,
  size,
  aspect,
}: {
  item: AssetMetadata;
  index: number;
  total: number; // count in the grid, for the "N of M" VoiceOver position value
  selected?: boolean; // undefined = not in selection mode
  onOpen: (index: number, rect?: CellRect) => void;
  onToggle: (externalId: string) => void;
  entrance: Animated.Value;
  size: number; // column width in px for this density
  aspect?: boolean; // aspect-ratio (masonry) mode → variable height per photo
}) {
  const wrapRef = useRef<View>(null);
  // In aspect mode the cell height follows the photo's ratio (clamped so extremes stay usable);
  // otherwise it's a square. contentFit stays 'cover' so an aspect cell shows the whole photo.
  const w = item.width ?? 0;
  const h = item.height ?? 0;
  const cellH =
    aspect && w > 0 && h > 0
      ? Math.round(Math.max((size - 2) * 0.6, Math.min((size - 2) * 2.4, (size - 2) * (h / w))))
      : size - 2;
  const staggered = index < FIRST_SCREEN;
  const start = staggered ? (index / FIRST_SCREEN) * 0.55 : 0;
  const end = Math.min(1, start + 0.45);
  const animStyle = staggered
    ? {
        opacity: entrance.interpolate({ inputRange: [start, end], outputRange: [0, 1], extrapolate: 'clamp' as const }),
        transform: [
          { translateY: entrance.interpolate({ inputRange: [start, end], outputRange: [14, 0], extrapolate: 'clamp' as const }) },
        ],
      }
    : undefined;
  const press = () => {
    if (selected !== undefined) {
      onToggle(item.id);
      return;
    }
    const node = wrapRef.current;
    if (node) node.measureInWindow((x, y, w, h) => onOpen(index, { x, y, w, h }));
    else onOpen(index);
  };
  return (
    <Animated.View ref={wrapRef} collapsable={false} style={animStyle}>
      <Springy
        onPress={press}
        scaleTo={0.9}
        accessibilityLabel={cellA11yLabel(item)}
        accessibilityValue={{ text: `${index + 1} of ${total}` }}
        accessibilityHint={selected === undefined ? 'Opens the photo' : undefined}
        accessibilityState={selected === undefined ? undefined : { selected: !!selected }}
      >
        <Image
          source={{ uri: assetUri(item.id) }}
          style={[styles.cell, { width: size - 2, height: cellH }]}
          recyclingKey={item.id}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={180}
          accessibilityIgnoresInvertColors
        />
        {item.mediaType === MediaType.VIDEO && (
          <View pointerEvents="none" style={styles.vidBadge}>
            <View style={styles.vidTri} />
            {item.duration ? <Text style={styles.vidDur}>{formatDuration(item.duration / 1000)}</Text> : null}
          </View>
        )}
        {selected !== undefined && <SelectionRing selected={selected} />}
      </Springy>
    </Animated.View>
  );
}

export interface GridSelection {
  active: boolean;
  selected: Set<string>;
  onToggle: (externalId: string) => void;
}

/**
 * A reusable photo grid with a built-in full-screen, swipeable detail viewer.
 *
 * The inner list is keyed by `gridKey` so it remounts when the data is reordered in place (FlashList
 * recycles cells by key and won't reliably reposition them on an in-place re-rank) — remounting also
 * restarts the staggered entrance for each new result set. The viewer persists across those remounts.
 */
export function PhotoGrid({
  data,
  gridKey,
  onFindSimilar,
  onToggleFavorite,
  onDeleteAssets,
  onRated,
  onKeyworded,
  selection,
  onRefresh,
  refreshTint = palette.accent,
  scrollY,
  ListHeaderComponent,
  cols = COLS,
  aspectGrid,
  listRef,
}: {
  data: AssetMetadata[];
  gridKey?: string;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  /** When provided, the viewer offers a Delete action for the current photo. */
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  /** Fired after an in-viewer star-rating change, so a rating-derived grid (Library's "Rated") can refresh. */
  onRated?: () => void;
  /** Fired after an in-viewer keyword edit, so a keyword-derived grid (Library's keyword chips) can refresh. */
  onKeyworded?: () => void;
  selection?: GridSelection;
  /** Pull-to-refresh; the promise resolving ends the spinner. */
  onRefresh?: () => void | Promise<void>;
  refreshTint?: string;
  /** Drives a collapsing header (JS-driven; interpolate transform/opacity only). */
  scrollY?: Animated.Value;
  ListHeaderComponent?: React.ReactElement | null;
  /** Grid density (columns). Default COLS (4). */
  cols?: number;
  /** Aspect-ratio (masonry) grid instead of uniform squares. */
  aspectGrid?: boolean;
  /** Optional ref to the underlying list, so a parent can fast-scrub (scrollToIndex) into the grid. */
  listRef?: React.Ref<FlashListRef<AssetMetadata>>;
}) {
  const [detail, setDetail] = useState<{ index: number; rect?: CellRect } | null>(null);
  return (
    <>
      <GridList
        key={`${gridKey ?? 'g'}:${aspectGrid ? 'asp' : 'sq'}`}
        data={data}
        selection={selection}
        aspectGrid={aspectGrid}
        onOpen={(index, rect) => setDetail({ index, rect })}
        onRefresh={onRefresh}
        refreshTint={refreshTint}
        scrollY={scrollY}
        ListHeaderComponent={ListHeaderComponent}
        cols={cols}
        listRef={listRef}
      />
      <PhotoDetail
        // Remount per open so the viewer seeds `current` from the freshly-opened index.
        key={String(detail?.index ?? 'none')}
        assets={data}
        index={detail ? detail.index : null}
        originRect={detail?.rect}
        onClose={() => setDetail(null)}
        onFindSimilar={onFindSimilar}
        onToggleFavorite={onToggleFavorite}
        onDeleteAssets={onDeleteAssets}
        onRated={onRated}
        onKeyworded={onKeyworded}
        onEdited={onRefresh}
      />
    </>
  );
}

function GridList({
  data,
  selection,
  onOpen,
  onRefresh,
  refreshTint,
  scrollY,
  ListHeaderComponent,
  cols,
  aspectGrid,
  listRef,
}: {
  data: AssetMetadata[];
  selection?: GridSelection;
  onOpen: (index: number, rect?: CellRect) => void;
  onRefresh?: () => void | Promise<void>;
  refreshTint: string;
  scrollY?: Animated.Value;
  ListHeaderComponent?: React.ReactElement | null;
  cols: number;
  aspectGrid?: boolean;
  listRef?: React.Ref<FlashListRef<AssetMetadata>>;
}) {
  const entrance = useGridEntrance();
  const cellSize = Math.floor(Dimensions.get('window').width / cols);
  const selecting = selection?.active ?? false;

  // ── Slide-to-select (Apple's drag-select) ──────────────────────────────────────────────────────
  // A drag maps the finger to a cell and toggles it, painting selection across a row/rows. It's gated
  // to SELECT mode + the SQUARE grid (masonry has variable row heights the cellSize math can't map) +
  // callers that provide `scrollY` (so we know the scroll offset). `activeOffsetX` means the Pan only
  // wins on a HORIZONTAL drag — a vertical drag falls through to the FlashList and still scrolls, so
  // this can never break scrolling. Finger→cell = (e.x, e.y + scrollOffset − headerHeight).
  const offsetRef = useRef(0); // live scroll offset (tracked off scrollY, which uses the JS driver)
  const headerHRef = useRef(0); // measured ListHeaderComponent height
  const lastIdxRef = useRef(-1); // last cell sampled this drag (interpolation fills the gap to it)
  const modeRef = useRef<null | 'add' | 'remove'>(null); // paint mode, anchored on the first cell
  const paintedRef = useRef<Set<string>>(new Set()); // ids already painted this drag (idempotent)
  const selRef = useRef(selection);
  selRef.current = selection;
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!scrollY) return;
    const id = scrollY.addListener(({ value }) => {
      offsetRef.current = value;
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  const slideEnabled = selecting && !aspectGrid && !!scrollY;
  const slidePan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(slideEnabled)
        .activeOffsetX([-14, 14])
        .runOnJS(true)
        .onBegin(() => {
          lastIdxRef.current = -1;
          modeRef.current = null;
          paintedRef.current.clear();
        })
        .onUpdate((e) => {
          const sel = selRef.current;
          const arr = dataRef.current;
          if (!sel) return;
          const contentY = e.y + offsetRef.current - headerHRef.current;
          if (contentY < 0) return; // finger is over the header, not a cell
          const col = Math.floor(e.x / cellSize);
          if (col < 0 || col >= cols) return;
          const idx = Math.floor(contentY / cellSize) * cols + col;
          if (idx < 0 || idx >= arr.length || idx === lastIdxRef.current) return;
          // Anchor a single add/remove MODE from the first cell so a back-drag doesn't reverse it.
          if (modeRef.current === null) modeRef.current = sel.selected.has(arr[idx].id) ? 'remove' : 'add';
          const add = modeRef.current === 'add';
          // Fill the linear-index range from the previous cell to this one so a fast stroke can't skip
          // cells; paint each at most once per drag (paintedRef) so it's idempotent despite the stale
          // selection snapshot between JS-thread frames.
          const prev = lastIdxRef.current;
          const lo = prev < 0 ? idx : Math.min(prev, idx);
          const hi = prev < 0 ? idx : Math.max(prev, idx);
          for (let i = lo; i <= hi; i++) {
            if (i < 0 || i >= arr.length) continue;
            const id = arr[i].id;
            if (paintedRef.current.has(id)) continue;
            paintedRef.current.add(id);
            if (add ? !sel.selected.has(id) : sel.selected.has(id)) sel.onToggle(id);
          }
          lastIdxRef.current = idx;
        })
        .onEnd(() => {
          lastIdxRef.current = -1;
          modeRef.current = null;
          paintedRef.current.clear();
        }),
    [slideEnabled, cellSize, cols],
  );

  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = onRefresh
    ? async () => {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
    : undefined;
  const onScroll = scrollY
    ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })
    : undefined;
  // Measure the header so the drag→cell math can subtract it. Wrapping is a no-op when there's no
  // header. (LibraryScreen already measures it too; this is a local, independent measurement.)
  const header = ListHeaderComponent ? (
    <View onLayout={(e) => (headerHRef.current = e.nativeEvent.layout.height)}>{ListHeaderComponent}</View>
  ) : null;
  return (
    <GestureDetector gesture={slidePan}>
      <FlashList
        ref={listRef}
        data={data}
        extraData={selecting ? selection!.selected : cellSize}
        numColumns={cols}
        masonry={aspectGrid}
        keyExtractor={(it) => it.id}
        renderItem={({ item, index }) => (
          <Cell
            item={item}
            index={index}
            total={data.length}
            entrance={entrance}
            size={cellSize}
            aspect={aspectGrid}
            selected={selecting ? selection!.selected.has(item.id) : undefined}
            onOpen={onOpen}
            onToggle={(id) => selection?.onToggle(id)}
          />
        )}
        ListHeaderComponent={header}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardDismissMode="on-drag"
        refreshControl={
          doRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={refreshTint} colors={[refreshTint]} />
          ) : undefined
        }
        contentContainerStyle={styles.grid}
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
    gap: 12,
    padding: 24,
  },
  grid: { padding: 1 },
  cell: { width: CELL - 2, height: CELL - 2, margin: 1, backgroundColor: palette.cell, borderRadius: 2 },

  vidBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  vidTri: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#ffffff',
  },
  vidDur: { color: '#ffffff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },

  selRing: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 3,
    borderWidth: 3,
    borderColor: palette.accent,
  },
  selDisc: {
    position: 'absolute',
    right: 6, // unify corner inset with vidBadge
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: discScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selDiscOn: { backgroundColor: palette.accent, borderColor: palette.accent },

  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 1 },

  orbWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  emptyGlyph: { fontSize: 46 },
  emptyTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  emptySub: { ...typography.body, color: palette.sub, textAlign: 'center', maxWidth: 300 },
  emptyAction: { marginTop: space.sm, alignSelf: 'stretch', alignItems: 'center' },
});
