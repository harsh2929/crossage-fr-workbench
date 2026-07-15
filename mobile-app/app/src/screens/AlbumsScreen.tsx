/**
 * Albums — the library grouped into months (newest first), the Apple Photos staple. Tapping a month
 * drills into its own grid. Grouping is pure client-side arithmetic over the replica's created_at.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, Center, palette, assetUri } from '../ui';
import { DuplicatesView } from './DuplicatesView';
import { ScreenHeader } from '../Header';
import { grad } from '../theme';

interface MonthGroup {
  key: string; // "YYYY-MM", or "0000-00" for undated
  label: string;
  items: AssetMetadata[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function groupByMonth(assets: AssetMetadata[]): MonthGroup[] {
  const map = new Map<string, AssetMetadata[]>();
  for (const a of assets) {
    const raw = a.creationTime ?? 0;
    // expo-media-library reports creationTime in ms; tolerate seconds just in case.
    const ms = raw > 0 && raw < 1e11 ? raw * 1000 : raw;
    const d = ms > 0 ? new Date(ms) : null;
    const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '0000-00';
    const bucket = map.get(key);
    if (bucket) bucket.push(a);
    else map.set(key, [a]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest month first
    .map(([key, items]) => {
      let label = 'Undated';
      if (key !== '0000-00') {
        const [y, m] = key.split('-');
        label = `${MONTHS[Number(m) - 1]} ${y}`;
      }
      return { key, label, items };
    });
}

export function AlbumsScreen({
  assets,
  onFindSimilar,
  onToggleFavorite,
  onDeleteAssets,
  duplicatesReady,
}: {
  assets: AssetMetadata[];
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  duplicatesReady?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const groups = useMemo(() => groupByMonth(assets), [assets]);
  const favorites = useMemo(() => assets.filter((a) => a.isFavorite), [assets]);
  const openMonth =
    openKey && openKey !== 'favorites' && openKey !== 'duplicates'
      ? groups.find((g) => g.key === openKey) ?? null
      : null;

  // Duplicates — its own scan/review view (not a photo grid).
  if (openKey === 'duplicates') {
    return <DuplicatesView onDeleteAssets={onDeleteAssets} onBack={() => setOpenKey(null)} />;
  }

  // A drilled-in album (Favorites, or a month) — its own grid with a back button.
  if (openKey === 'favorites' || openMonth) {
    const title = openKey === 'favorites' ? 'Favorites' : openMonth!.label;
    const items = openKey === 'favorites' ? favorites : openMonth!.items;
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => setOpenKey(null)} hitSlop={10}>
            <Text style={styles.back}>‹ Albums</Text>
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{`${items.length} photo${items.length === 1 ? '' : 's'}`}</Text>
        </View>
        {items.length === 0 ? (
          <Center>
            <Text style={styles.body}>No photos here.</Text>
          </Center>
        ) : (
          <PhotoGrid
            data={items}
            gridKey={openKey!}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
          />
        )}
      </View>
    );
  }

  const hasContent = favorites.length > 0 || groups.length > 0;
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Albums"
        kicker="Collections"
        gradient={grad.brand}
        meta={`${groups.length} month${groups.length === 1 ? '' : 's'}`}
      />
      {!hasContent ? (
        <Center>
          <Text style={styles.body}>No photos to organize yet.</Text>
        </Center>
      ) : (
        <FlashList
          data={groups}
          keyExtractor={(g) => g.key}
          ListHeaderComponent={
            <>
              {favorites.length > 0 && (
                <Pressable style={styles.row} onPress={() => setOpenKey('favorites')}>
                  <View style={[styles.cover, styles.favCover]}>
                    <Text style={styles.favHeart}>♥</Text>
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.albumTitle}>Favorites</Text>
                    <Text style={styles.albumCount}>
                      {`${favorites.length} photo${favorites.length === 1 ? '' : 's'}`}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
              {duplicatesReady && (
                <Pressable style={styles.row} onPress={() => setOpenKey('duplicates')}>
                  <View style={[styles.cover, styles.dupCover]}>
                    <Text style={styles.dupGlyph}>⧉</Text>
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.albumTitle}>Duplicates</Text>
                    <Text style={styles.albumCount}>Find near-identical photos</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
            </>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => setOpenKey(item.key)}>
              <Image
                source={{ uri: assetUri(item.items[0].id) }}
                style={styles.cover}
                recyclingKey={item.items[0].id}
                cachePolicy="memory-disk"
                contentFit="cover"
                transition={0}
              />
              <View style={styles.info}>
                <Text style={styles.albumTitle}>{item.label}</Text>
                <Text style={styles.albumCount}>
                  {`${item.items.length} photo${item.items.length === 1 ? '' : 's'}`}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: palette.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  meta: { color: palette.accent, fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
  back: { color: palette.accent, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },

  list: { paddingHorizontal: 12, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14141d',
    borderRadius: 16,
    padding: 10,
    marginBottom: 10,
  },
  cover: { width: 64, height: 64, borderRadius: 12, backgroundColor: palette.cell },
  favCover: { backgroundColor: 'rgba(244,114,182,0.9)', alignItems: 'center', justifyContent: 'center' },
  favHeart: { color: '#fff', fontSize: 30 },
  dupCover: { backgroundColor: 'rgba(139,92,246,0.9)', alignItems: 'center', justifyContent: 'center' },
  dupGlyph: { color: '#fff', fontSize: 30, fontWeight: '700' },
  info: { flex: 1, marginLeft: 14 },
  albumTitle: { color: palette.text, fontSize: 17, fontWeight: '700' },
  albumCount: { color: palette.muted, fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
  chevron: { color: palette.muted, fontSize: 22, paddingRight: 6 },
});
