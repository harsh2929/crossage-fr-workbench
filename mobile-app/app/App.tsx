/**
 * Vintrace Mobile — the app shell.
 *
 * Reads the phone's own camera roll via expo-media-library's cheap batch Query (exeForMetadata,
 * no per-asset file resolution), ingests it into the SQLCipher-encrypted on-device replica, and
 * drives three tabs off that single durable source: Library (everything), Search (on-device CLIP
 * semantic search), and Albums (grouped by month). Offline-first: the source of truth is the local
 * DB, not a live PhotoKit call.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Asset,
  Query,
  AssetField,
  MediaType,
  usePermissions,
  type AssetMetadata,
} from 'expo-media-library';
import { ingestCameraRoll, listAssets, setFavoriteLocal, deleteAssetsLocal } from './src/replica';
import { useSemanticSearch } from './src/useSemanticSearch';
import { palette, Center } from './src/ui';
import { Loader, Springy } from './src/motion';
import { TabBar, type Tab } from './src/TabBar';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { AlbumsScreen } from './src/screens/AlbumsScreen';
import { DesktopScreen } from './src/screens/DesktopScreen';

export default function App() {
  const [permission, requestPermission] = usePermissions();
  const [assets, setAssets] = useState<AssetMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('library');
  const search = useSemanticSearch(); // lives here so the index survives tab switches
  const requested = useRef(false);

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const rows = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .exeForMetadata();

      // Ingest into the encrypted replica, then render FROM it — offline-first.
      ingestCameraRoll(rows);
      const replica = listAssets();
      setLoadMs(Date.now() - t0);
      setAssets(
        replica.map((r) => ({
          id: r.external_id,
          filename: r.filename,
          mediaType: MediaType.IMAGE,
          width: r.width,
          height: r.height,
          duration: null,
          creationTime: r.created_at,
          modificationTime: null,
          isFavorite: !!r.is_favorite,
        })),
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Toggle a photo's favorite state: update the replica + in-memory grid optimistically for instant
  // feedback, then write through to PhotoKit's system "Favorites" album. Revert both on failure so
  // the UI never claims a favorite the system didn't accept.
  const onToggleFavorite = useCallback(async (externalId: string, next: boolean) => {
    const flip = (fav: boolean) =>
      setAssets((prev) =>
        prev ? prev.map((a) => (a.id === externalId ? { ...a, isFavorite: fav } : a)) : prev,
      );
    flip(next);
    setFavoriteLocal(externalId, next);
    try {
      await new Asset(externalId).setFavorite(next);
    } catch {
      flip(!next);
      setFavoriteLocal(externalId, !next);
    }
  }, []);

  // Batch favorite a selection (optimistic + best-effort write-through; the next launch's Query
  // re-syncs from PhotoKit, the source of truth, so any per-asset failure self-heals).
  const onFavoriteAssets = useCallback(async (ids: string[], next: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setAssets((prev) =>
      prev ? prev.map((a) => (idSet.has(a.id) ? { ...a, isFavorite: next } : a)) : prev,
    );
    ids.forEach((id) => setFavoriteLocal(id, next));
    await Promise.all(ids.map((id) => new Asset(id).setFavorite(next).catch(() => {})));
  }, []);

  // Batch delete a selection from the device library (iOS shows a system confirm; a throw/cancel
  // leaves everything untouched). On success, remove locally so the grid updates immediately.
  const onDeleteAssets = useCallback(async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    try {
      await Asset.delete(ids.map((id) => new Asset(id)));
    } catch {
      return false;
    }
    deleteAssetsLocal(ids);
    const idSet = new Set(ids);
    setAssets((prev) => (prev ? prev.filter((a) => !idSet.has(a.id)) : prev));
    return true;
  }, []);

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) {
      void load();
    } else if (permission.canAskAgain && !requested.current) {
      requested.current = true;
      void requestPermission();
    }
  }, [permission, load, requestPermission]);

  if (!permission) {
    return (
      <Center>
        <Loader />
      </Center>
    );
  }

  if (!permission.granted) {
    return (
      <Center>
        <Text style={styles.hero}>✨</Text>
        <Text style={styles.title}>Vintrace</Text>
        <Text style={styles.body}>Vintrace needs access to your photos to show your library.</Text>
        <Springy style={styles.button} onPress={() => requestPermission()}>
          <Text style={styles.buttonText}>Grant access</Text>
        </Springy>
        <StatusBar style="light" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center>
        <Text style={styles.title}>Couldn’t read your library</Text>
        <Text style={styles.err}>{error}</Text>
        <Springy
          style={styles.button}
          onPress={() => {
            setError(null);
            void load();
          }}
        >
          <Text style={styles.buttonText}>Retry</Text>
        </Springy>
        <StatusBar style="light" />
      </Center>
    );
  }

  if (!assets) {
    return (
      <Center>
        <Loader label="Reading your library…" />
      </Center>
    );
  }

  // "Find similar" is only meaningful once photos are embedded; when ready, it runs the KNN and
  // surfaces the matches on the Search tab.
  const onFindSimilar =
    search.status === 'ready'
      ? (externalId: string) => {
          search.findSimilar(externalId);
          setTab('search');
        }
      : undefined;

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {tab === 'library' && (
          <LibraryScreen
            assets={assets}
            loadMs={loadMs}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onFavoriteAssets={onFavoriteAssets}
            onDeleteAssets={onDeleteAssets}
          />
        )}
        {tab === 'search' && (
          <SearchScreen
            assets={assets}
            search={search}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
          />
        )}
        {tab === 'albums' && (
          <AlbumsScreen
            assets={assets}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
            duplicatesReady={search.status === 'ready'}
          />
        )}
        {tab === 'desktop' && <DesktopScreen />}
      </View>
      <TabBar active={tab} onChange={setTab} />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, paddingTop: 60 },
  screen: { flex: 1 },
  hero: { fontSize: 52, marginBottom: 4 },
  title: { color: palette.text, fontSize: 26, fontWeight: '800' },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },
  err: { color: palette.danger, fontSize: 12, textAlign: 'center' },
  button: {
    backgroundColor: palette.accent,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonText: { color: palette.text, fontSize: 15, fontWeight: '700' },
});
