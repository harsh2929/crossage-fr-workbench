/**
 * Vintrace Mobile — the app shell.
 *
 * Reads the phone's own camera roll via expo-media-library's cheap batch Query (exeForMetadata,
 * no per-asset file resolution), ingests it into the SQLCipher-encrypted on-device replica, and
 * drives four tabs off that single durable source: Library, Search (on-device CLIP semantic search),
 * Albums, and Desktop (the paired oracle). Offline-first: the source of truth is the local DB.
 *
 * This shell also owns the app-wide feedback backbone: <ToastHost/> is mounted here, and every batch
 * mutation confirms with a toast (favorite carries Undo; delete is confirmation-only).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Asset,
  Query,
  AssetField,
  MediaType,
  usePermissions,
  addListener,
  type AssetMetadata,
} from 'expo-media-library';
import {
  ingestCameraRoll,
  listAssets,
  setFavoriteLocal,
  deleteAssetsLocal,
  setHiddenLocal,
  searchPhotoText,
} from './src/replica';
import { useSemanticSearch } from './src/useSemanticSearch';
import { useOcrIndex } from './src/useOcrIndex';
import { palette, Center, EmptyState, Skeleton } from './src/ui';
import { Loader, GradientButton } from './src/motion';
import { TabBar, type Tab } from './src/TabBar';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { CollectionsScreen } from './src/screens/CollectionsScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { AlbumsScreen } from './src/screens/AlbumsScreen';
import { DesktopScreen } from './src/screens/DesktopScreen';
import { ToastHost, toast } from './src/Toast';
import { useInsets } from './src/insets';

export default function App() {
  const insets = useInsets();
  const [permission, requestPermission] = usePermissions();
  const [assets, setAssets] = useState<AssetMetadata[] | null>(null);
  // App-local Hidden set (external_ids). Hidden photos are partitioned out of the library everywhere
  // and shown only in the Albums → Hidden view; kept as a Set here so hide/unhide is instant.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('library');
  const search = useSemanticSearch(); // lives here so the index survives tab switches
  // Text-in-photos (OCR / Live-Text) indexing piggybacks on the same opt-in: once the CLIP index is
  // ready, we OCR the library in the background so Search can match words inside photos too. Lives
  // here so it keeps running across tab switches. Degrades to a no-op if the native module isn't built.
  const ocr = useOcrIndex(search.status === 'ready');
  const requested = useRef(false);

  // Synchronous OCR lookup handed to Search; unions text-in-photo hits with CLIP's visual results.
  // Guarded so a replica hiccup degrades to "no OCR matches" rather than throwing into search.
  const onOcrSearch = useCallback((query: string): string[] => {
    try {
      return searchPhotoText(query);
    } catch {
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      // Photos AND videos (two queries — the Query builder filters a single media type at a time).
      const [imgs, vids] = await Promise.all([
        new Query()
          .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
          .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
          .exeForMetadata(),
        new Query()
          .eq(AssetField.MEDIA_TYPE, MediaType.VIDEO)
          .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
          .exeForMetadata(),
      ]);

      // Ingest into the encrypted replica, then render FROM it — offline-first.
      ingestCameraRoll([...imgs, ...vids]);
      const replica = listAssets();
      setLoadMs(Date.now() - t0);
      setHiddenIds(new Set(replica.filter((r) => r.is_hidden).map((r) => r.external_id)));
      setAssets(
        replica.map((r) => ({
          id: r.external_id,
          filename: r.filename,
          mediaType: r.media_type === 'video' ? MediaType.VIDEO : MediaType.IMAGE,
          width: r.width,
          height: r.height,
          duration: r.duration,
          creationTime: r.created_at,
          modificationTime: null,
          isFavorite: !!r.is_favorite,
        })),
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Toggle a single photo's favorite (from the viewer heart): optimistic replica + grid update, then
  // write through to PhotoKit's system album; revert both on failure. No toast — the heart pops.
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

  // The raw batch favorite op (optimistic + best-effort write-through; the next launch's Query
  // re-syncs from PhotoKit, so any per-asset failure self-heals). Toast-free so Undo can reuse it.
  const favoriteAssets = useCallback((ids: string[], next: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setAssets((prev) =>
      prev ? prev.map((a) => (idSet.has(a.id) ? { ...a, isFavorite: next } : a)) : prev,
    );
    ids.forEach((id) => setFavoriteLocal(id, next));
    void Promise.all(ids.map((id) => new Asset(id).setFavorite(next).catch(() => {})));
  }, []);

  // Batch favorite with confirmation + Undo (favorite is reversible).
  const onFavoriteAssets = useCallback(
    (ids: string[], next: boolean) => {
      if (ids.length === 0) return;
      favoriteAssets(ids, next);
      toast({
        text: next
          ? `Added ${ids.length} to Favorites`
          : `Removed ${ids.length} from Favorites`,
        tone: 'favorite',
        action: { label: 'Undo', onPress: () => favoriteAssets(ids, !next) },
      });
    },
    [favoriteAssets],
  );

  // Batch delete from the device library (iOS shows a system confirm; a throw/cancel leaves
  // everything untouched). On success, prune locally + confirm (no undo — PhotoKit delete is final).
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
    // Drop any deleted photos from the Hidden set too, so a freed id can't linger as "hidden".
    setHiddenIds((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    toast({ text: `Deleted ${ids.length} photo${ids.length === 1 ? '' : 's'}`, tone: 'danger' });
    return true;
  }, []);

  // Raw hide/unhide (app-local; optimistic Set + replica write). Toast-free so Undo can reuse it.
  const hideAssets = useCallback((ids: string[], hidden: boolean) => {
    if (ids.length === 0) return;
    setHiddenLocal(ids, hidden);
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (hidden) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  // Batch hide/unhide with confirmation + Undo (hiding is reversible — it never touches PhotoKit).
  const onHideAssets = useCallback(
    (ids: string[], hidden: boolean) => {
      if (ids.length === 0) return;
      hideAssets(ids, hidden);
      toast({
        text: hidden
          ? `Hidden ${ids.length} photo${ids.length === 1 ? '' : 's'}`
          : `Moved ${ids.length} out of Hidden`,
        tone: 'brand',
        action: { label: 'Undo', onPress: () => hideAssets(ids, !hidden) },
      });
    },
    [hideAssets],
  );

  // The library minus hidden photos (what every tab sees), and the hidden set on its own (the Hidden
  // view). Hidden photos are filtered here once, so Library/Search/Albums never have to know about them.
  const visibleAssets = useMemo(
    () => (assets ? assets.filter((a) => !hiddenIds.has(a.id)) : []),
    [assets, hiddenIds],
  );
  const hiddenAssets = useMemo(
    () => (assets ? assets.filter((a) => hiddenIds.has(a.id)) : []),
    [assets, hiddenIds],
  );

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) {
      void load();
    } else if (permission.canAskAgain && !requested.current) {
      requested.current = true;
      void requestPermission();
    }
  }, [permission, load, requestPermission]);

  // Live library-change tracking: when the system Photos library gains/loses assets (a shot taken in
  // Camera, a delete/import in Photos) while we're open, re-sync — no manual pull-to-refresh needed.
  // Debounced (bursts coalesce into one reload) and filtered to STRUCTURAL changes: pure "updated"
  // events (our own favorite/edit write-throughs, already handled optimistically) are ignored so a
  // heart-tap can't trigger a full re-query. A non-incremental event (unknown scope) always re-syncs.
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!permission?.granted) return;
    const sub = addListener((ev) => {
      const structural =
        !ev.hasIncrementalChanges || !!(ev.insertedAssets?.length || ev.deletedAssets?.length);
      if (!structural) return;
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => void load(), 1200);
    });
    return () => {
      sub.remove();
      if (changeTimer.current) clearTimeout(changeTimer.current);
    };
  }, [permission?.granted, load]);

  if (!permission) {
    return (
      <Center>
        <Loader />
      </Center>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          orb
          glyph="✨"
          title="Welcome to Vintrace"
          subtitle="Vintrace needs access to your photos to show and search your library — everything stays on device."
          action={
            <GradientButton
              label="Grant access"
              onPress={() => requestPermission()}
              style={styles.cta}
              accessibilityHint="Opens the iOS photo permission prompt"
            />
          }
        />
        <StatusBar style="light" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <EmptyState
          orb
          orbColor={palette.danger}
          glyph="⚠️"
          title="Couldn’t read your library"
          subtitle={error.slice(0, 200)}
          action={
            <GradientButton
              label="Try again"
              onPress={() => {
                setError(null);
                void load();
              }}
              style={styles.cta}
            />
          }
        />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!assets) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Skeleton />
        <StatusBar style="light" />
      </View>
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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.screen}>
        {tab === 'library' && (
          <LibraryScreen
            assets={visibleAssets}
            loadMs={loadMs}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onFavoriteAssets={onFavoriteAssets}
            onDeleteAssets={onDeleteAssets}
            onHideAssets={onHideAssets}
            onRefresh={load}
            onNavigate={setTab}
          />
        )}
        {tab === 'collections' && (
          <CollectionsScreen
            assets={visibleAssets}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
          />
        )}
        {tab === 'search' && (
          <SearchScreen
            assets={visibleAssets}
            search={search}
            ocrSearch={onOcrSearch}
            ocr={ocr}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
          />
        )}
        {tab === 'albums' && (
          <AlbumsScreen
            assets={visibleAssets}
            hiddenAssets={hiddenAssets}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
            onHideAssets={onHideAssets}
            duplicatesReady={search.status === 'ready'}
          />
        )}
        {tab === 'desktop' && <DesktopScreen />}
      </View>
      <TabBar active={tab} onChange={setTab} />
      <ToastHost />
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  screen: { flex: 1 },
  cta: { minWidth: 220 },
});
