/**
 * Full-screen photo viewer — tap a grid cell to open, swipe horizontally between photos, pinch to
 * zoom, tap to toggle chrome, ⓘ for details, ✨ for similar, ✕ to dismiss.
 *
 * Each page is a zoomable ScrollView (native iOS pinch-zoom — no gesture library, no native rebuild)
 * holding the photo at screen resolution (expo-image downscales the ph:// source to device size —
 * never a full 12 MP decode). At zoom 1 the page fills the viewport so horizontal swipes fall through
 * to the outer paging FlatList; zoomed in, the inner ScrollView pans.
 *
 * (Location/EXIF aren't shown: the current expo-media-library class API's AssetInfo doesn't expose
 * them — that richer metadata will come from the desktop sync tier.)
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import type { AssetMetadata } from 'expo-media-library';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function assetUri(id: string): string {
  return id.startsWith('ph://') ? id : `ph://${id}`;
}

function formatDateTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function PhotoDetail({
  assets,
  index,
  onClose,
  onFindSimilar,
  onToggleFavorite,
}: {
  assets: AssetMetadata[];
  index: number | null;
  onClose: () => void;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
}) {
  const [current, setCurrent] = useState(index ?? 0);
  const [chrome, setChrome] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const listRef = useRef<FlatList<AssetMetadata>>(null);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setCurrent(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<AssetMetadata>) => (
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        maximumZoomScale={3}
        minimumZoomScale={1}
        bouncesZoom
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => setChrome((c) => !c)}>
          <Image
            source={{ uri: assetUri(item.id) }}
            style={styles.pageImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
          />
        </Pressable>
      </ScrollView>
    ),
    [],
  );

  if (index === null) return null;
  const asset = assets[current];
  const megapixels =
    asset?.width && asset?.height ? (asset.width * asset.height) / 1_000_000 : null;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={assets}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          onMomentumScrollEnd={onMomentumEnd}
        />

        {chrome && (
          <>
            <View style={styles.topBar}>
              <Pressable onPress={onClose} hitSlop={16} style={styles.iconButton}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
              <Text style={styles.counter}>
                {current + 1} / {assets.length}
              </Text>
              <View style={styles.topRight}>
                {onToggleFavorite && asset && (
                  <Pressable
                    onPress={() => onToggleFavorite(asset.id, !asset.isFavorite)}
                    hitSlop={16}
                    style={styles.iconButton}
                  >
                    <Text style={[styles.heart, asset.isFavorite && styles.heartOn]}>
                      {asset.isFavorite ? '♥' : '♡'}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setShowInfo((s) => !s)}
                  hitSlop={16}
                  style={styles.iconButton}
                >
                  <Text style={[styles.infoGlyph, showInfo && styles.infoGlyphOn]}>ⓘ</Text>
                </Pressable>
              </View>
            </View>

            {asset && !showInfo && (
              <View style={styles.bottomBar}>
                <View style={styles.bottomInfo}>
                  <Text style={styles.filename} numberOfLines={1}>
                    {asset.filename ?? 'Photo'}
                  </Text>
                  <Text style={styles.meta}>
                    {asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''}
                    {asset.creationTime ? `  ·  ${formatDateTime(asset.creationTime)}` : ''}
                  </Text>
                </View>
                {onFindSimilar && (
                  <Pressable
                    style={styles.similarButton}
                    onPress={() => {
                      onFindSimilar(asset.id);
                      onClose();
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.similarText}>✨ Similar</Text>
                  </Pressable>
                )}
              </View>
            )}

            {asset && showInfo && (
              <View style={styles.infoPanel}>
                <Text style={styles.infoTitle} numberOfLines={1}>
                  {asset.filename ?? 'Photo'}
                </Text>
                {asset.creationTime ? (
                  <InfoRow label="Taken" value={formatDateTime(asset.creationTime)} />
                ) : null}
                {asset.width && asset.height ? (
                  <InfoRow
                    label="Dimensions"
                    value={`${asset.width} × ${asset.height}${
                      megapixels ? `  ·  ${megapixels.toFixed(1)} MP` : ''
                    }`}
                  />
                ) : null}
                <InfoRow label="Favorite" value={asset.isFavorite ? 'Yes' : 'No'} />
                {onFindSimilar && (
                  <Pressable
                    style={[styles.similarButton, styles.similarInPanel]}
                    onPress={() => {
                      onFindSimilar(asset.id);
                      onClose();
                    }}
                  >
                    <Text style={styles.similarText}>✨ Find similar photos</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  page: { width: SCREEN_W, height: SCREEN_H },
  pageContent: { width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center' },
  pageImage: { width: SCREEN_W, height: SCREEN_H },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topRight: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  heart: { color: '#fff', fontSize: 24, fontWeight: '600' },
  heartOn: { color: '#f472b6' },
  infoGlyph: { color: '#fff', fontSize: 22, fontWeight: '600' },
  infoGlyphOn: { color: '#c4b5fd' },
  counter: { color: '#fff', fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 14,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomInfo: { flex: 1 },
  filename: { color: '#fff', fontSize: 16, fontWeight: '700' },
  meta: { color: '#c4b5fd', fontSize: 13, marginTop: 3, fontVariant: ['tabular-nums'] },
  similarButton: {
    marginLeft: 12,
    backgroundColor: 'rgba(139,92,246,0.9)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  similarInPanel: { marginLeft: 0, marginTop: 16, alignItems: 'center' },
  similarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  infoPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 18,
    paddingHorizontal: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  infoTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  infoLabel: { color: '#9ca3af', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
