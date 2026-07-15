/**
 * Shared UI primitives for the app shell: the colour palette, the photo cell, and a reusable
 * PhotoGrid that embeds a full-screen detail viewer. Every grid screen (Library, Search results, an
 * Album's month) renders through PhotoGrid so the cell sizing, recycling, and detail-open behaviour
 * stay identical everywhere.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoDetail } from './PhotoDetail';
import { palette } from './theme';
import { Springy } from './motion';

export const COLS = 4;
const { width: SCREEN_W } = Dimensions.get('window');
export const CELL = Math.floor(SCREEN_W / COLS);

export { palette }; // re-exported so existing `import { palette } from '../ui'` keeps working

/** iOS Asset.id is a PHAsset localIdentifier; expo-image renders it via the ph:// scheme. */
export function assetUri(id: string): string {
  return id.startsWith('ph://') ? id : `ph://${id}`;
}

export function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

function Cell({
  item,
  onPress,
  selected,
}: {
  item: AssetMetadata;
  onPress: () => void;
  selected?: boolean; // undefined = not in selection mode
}) {
  return (
    <Springy onPress={onPress} scaleTo={0.9}>
      <Image
        source={{ uri: assetUri(item.id) }}
        style={[styles.cell, selected && styles.cellSelected]}
        recyclingKey={item.id}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={180}
      />
      {selected !== undefined && (
        <View style={[styles.selMark, selected && styles.selMarkOn]}>
          {selected && <Text style={styles.selCheck}>✓</Text>}
        </View>
      )}
    </Springy>
  );
}

/**
 * A reusable photo grid with a built-in full-screen, swipeable detail viewer.
 *
 * `gridKey` forces a remount when the underlying data is reordered in place: FlashList recycles
 * cells by key and does not reliably reposition them when `data` changes order but keeps the same
 * keys (e.g. a relevance re-rank), so a distinct key per result set guarantees a correct render.
 */
export interface GridSelection {
  active: boolean;
  selected: Set<string>;
  onToggle: (externalId: string) => void;
}

export function PhotoGrid({
  data,
  gridKey,
  onFindSimilar,
  onToggleFavorite,
  selection,
}: {
  data: AssetMetadata[];
  gridKey?: string;
  /** When provided, the detail view shows a "Find similar" action (only when the index is ready). */
  onFindSimilar?: (externalId: string) => void;
  /** When provided, the detail view shows a heart toggle that writes through to PhotoKit. */
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  /** When active, a cell tap toggles selection (with a checkmark) instead of opening the detail. */
  selection?: GridSelection;
}) {
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const selecting = selection?.active ?? false;
  return (
    <>
      <FlashList
        key={gridKey}
        data={data}
        // In selection mode, re-render cells when the (new-reference-per-toggle) Set changes.
        extraData={selecting ? selection!.selected : gridKey}
        numColumns={COLS}
        keyExtractor={(it) => it.id}
        renderItem={({ item, index }) => (
          <Cell
            item={item}
            selected={selecting ? selection!.selected.has(item.id) : undefined}
            onPress={() =>
              selecting ? selection!.onToggle(item.id) : setDetailIndex(index)
            }
          />
        )}
        contentContainerStyle={styles.grid}
      />
      <PhotoDetail
        // Remount per open: PhotoDetail seeds `current` from `index` once at mount, and a
        // programmatic initialScrollIndex doesn't fire onMomentumScrollEnd — so without a fresh
        // instance the counter/metadata/"Find similar" would target a stale photo (usually index 0).
        // A key tied to the opened index also resets chrome/info panel on every open.
        key={String(detailIndex)}
        assets={data}
        index={detailIndex}
        onClose={() => setDetailIndex(null)}
        onFindSimilar={onFindSimilar}
        onToggleFavorite={onToggleFavorite}
      />
    </>
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
  cellSelected: { opacity: 0.6 },
  selMark: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selMarkOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  selCheck: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
