/**
 * Desktop — the deep uplink to the Vintrace desktop app (the licensed face-recognition oracle).
 *
 * Pairs with the desktop's read-only companion HTTP surface, then browses the DESKTOP catalog:
 * real-resolution previews the desktop renders, full-library search, and per-photo face recognition
 * (people) the phone structurally cannot compute itself. The desktop catalog is its own asset space
 * (separate from the camera roll) — the identity join with camera-roll assets awaits the desktop's
 * canonical asset_uid work, so the two surfaces coexist rather than merge.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Dimensions, Modal, ScrollView, Animated } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { palette, grad, tint } from '../theme';
import { ScreenHeader } from '../Header';
import { Springy, Loader, FloatingView, BreathingOrb, Shimmer, GradientButton, Reveal } from '../motion';
import { SearchField, Chip, Segmented } from '../fields';
import { Center, EmptyState } from '../ui';
import { ViewerTopBar, ScrimPanel, useZoomStage } from '../ViewerChrome';
import { toast } from '../Toast';
import { formatDateTime, type CellRect } from '../media';
import {
  pairDesktop,
  getSession,
  getLibrary,
  searchDesktop,
  analyzeDesktop,
  desktopPreviewUrl,
  untrust,
  type DesktopAsset,
  type DesktopCollection,
  type DesktopDevice,
  type DesktopPerson,
} from '../desktop/client';
import {
  saveDesktopConnection,
  loadDesktopConnection,
  clearDesktopConnection,
} from '../replica';

const COLS = 3;
const { width: SCREEN_W } = Dimensions.get('window');
const DCELL = Math.floor(SCREEN_W / COLS);

// DEV prefill for the local demo desktop (mobile-app/tools/demo-desktop.py). Empty in production.
const DEV_HOST = '127.0.0.1:8765';
const DEV_CODE = 'vintracedemopaircodeaaaaaaaaaaaaaaaaaaaaaaa';

type Status = 'loading' | 'connect' | 'connected';

/** Client-side ordering of the already-fetched desktop results. */
type SortMode = 'relevance' | 'newest';
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'newest', label: 'Newest' },
];

/** Parse a desktop captureDate string to epoch ms, or null when absent/unparseable. */
function captureMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Normalize EXIF-style 'YYYY:MM:DD ...' → ISO before Date.parse (which only handles ISO reliably).
  const t = Date.parse(raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
  return Number.isNaN(t) ? null : t;
}

/** What the tapped grid cell hands the viewer: the asset + its on-screen rect (for the zoom origin). */
interface DetailTarget {
  asset: DesktopAsset;
  rect?: CellRect;
}

export function DesktopScreen() {
  const [status, setStatus] = useState<Status>('loading');
  const [base, setBase] = useState<string | null>(null);
  const [device, setDevice] = useState<DesktopDevice | null>(null);
  const [host, setHost] = useState(DEV_HOST);
  const [code, setCode] = useState(DEV_CODE);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [assets, setAssets] = useState<DesktopAsset[]>([]);
  const [count, setCount] = useState(0);
  const [collections, setCollections] = useState<DesktopCollection[]>([]);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');

  // Purely client-side reorder of the already-fetched results; 'relevance' keeps the server's order,
  // 'newest' sorts by captureDate desc (undated items sink to the end, keeping their relative order).
  const sortedAssets = useMemo(() => {
    if (sortMode !== 'newest') return assets;
    return [...assets].sort((a, b) => {
      const ta = captureMs(a.captureDate);
      const tb = captureMs(b.captureDate);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return tb - ta;
    });
  }, [assets, sortMode]);

  const loadCatalog = useCallback(async (b: string, q: string) => {
    const [lib, items] = await Promise.all([getLibrary(b), searchDesktop(b, q, q.trim() ? 'hybrid' : 'lexical', 60)]);
    setCount(lib.assetCount);
    setCollections(lib.collections);
    setAssets(items);
  }, []);

  // Resume a saved connection (the OS cookie may still be valid); otherwise show the connect form.
  useEffect(() => {
    const saved = loadDesktopConnection();
    if (!saved) {
      setStatus('connect');
      return;
    }
    (async () => {
      try {
        const dev = await getSession(saved.base);
        setBase(saved.base);
        setDevice(dev);
        setStatus('connected');
        await loadCatalog(saved.base, '');
      } catch {
        setStatus('connect');
      }
    })();
  }, [loadCatalog]);

  const connect = async () => {
    setPairing(true);
    setErr(null);
    try {
      const { base: b, device: dev } = await pairDesktop(host, code);
      saveDesktopConnection(b, dev.label, dev.expiresAt);
      setBase(b);
      setDevice(dev);
      setStatus('connected');
      toast({ text: `Connected to ${dev.label}`, tone: 'desktop' });
      await loadCatalog(b, '');
    } catch (e) {
      setErr(String(e).replace('Error: ', ''));
    } finally {
      setPairing(false);
    }
  };

  const disconnect = () => {
    clearDesktopConnection();
    setBase(null);
    setDevice(null);
    setAssets([]);
    setCollections([]);
    setQuery('');
    setSortMode('relevance');
    setErr(null);
    setStatus('connect');
    toast({ text: 'Disconnected from desktop', tone: 'desktop' });
  };

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!base) return;
    setSearching(true);
    setErr(null);
    try {
      setAssets(await searchDesktop(base, q, q.trim() ? 'hybrid' : 'lexical', 60));
    } catch (e) {
      setErr(String(e).replace('Error: ', ''));
    } finally {
      setSearching(false);
    }
  };

  if (status === 'loading') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Desktop" kicker="Uplink" gradient={grad.desktop} accent={palette.cyan} />
        <Center>
          <Loader label="Reconnecting…" color={palette.cyan} />
        </Center>
      </View>
    );
  }

  if (status === 'connect') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Desktop" kicker="Uplink" gradient={grad.desktop} accent={palette.cyan} />
        <ScrollView contentContainerStyle={styles.connectWrap} keyboardShouldPersistTaps="handled">
          <View style={styles.heroWrap}>
            <BreathingOrb size={130} color={palette.cyan} />
            <FloatingView>
              <Text style={styles.hero}>🖥️</Text>
            </FloatingView>
          </View>
          <Text style={styles.pitch}>Connect to your Vintrace desktop</Text>
          <Text style={styles.pitchSub}>
            Pull real-resolution previews, your full catalog, and face recognition — the desktop is the
            licensed oracle the phone can’t replace.
          </Text>
          <Text style={styles.fieldLabel}>Desktop address</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="192.168.1.20:8765"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldLabel}>Pairing code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="From the desktop’s Mobile companion screen"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <GradientButton
            label="Connect"
            tone="desktop"
            busy={pairing}
            onPress={connect}
            style={styles.cta}
            accessibilityHint="Pairs this phone with the desktop companion"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  // Connected — browse the desktop catalog.
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Desktop"
        kicker={device?.label ?? 'Connected'}
        gradient={grad.desktop}
        accent={palette.cyan}
        meta={`${count.toLocaleString()} photos · live from desktop`}
        right={
          <Springy onPress={disconnect} hitSlop={10} accessibilityLabel="Disconnect from desktop">
            <Text style={styles.disconnect}>Disconnect</Text>
          </Springy>
        }
      />
      <View style={styles.controls}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSubmit={() => runSearch(query)}
          onClear={() => runSearch('')}
          placeholder="Search the desktop catalog…"
          accent={palette.cyan}
          pending={searching}
        />
        {assets.length > 1 ? (
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort</Text>
            <View style={styles.sortSeg}>
              <Segmented
                options={SORT_OPTIONS}
                value={sortMode}
                onChange={(k) => setSortMode(k as SortMode)}
                accent={palette.cyan}
              />
            </View>
          </View>
        ) : null}
        {err ? <Text style={styles.searchErr}>{err}</Text> : null}
      </View>
      {collections.length > 0 ? (
        <View style={styles.collectionsWrap}>
          <Text style={styles.collectionsLabel}>Desktop albums</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.collectionsRow}
          >
            {collections.map((c) => (
              <Chip
                key={c.id}
                label={c.title}
                sub={c.count != null ? c.count.toLocaleString() : undefined}
                accent={palette.cyan}
                onPress={() => runSearch(c.title)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {searching && assets.length === 0 ? (
        <Center>
          <Loader label="Searching the desktop…" color={palette.cyan} />
        </Center>
      ) : assets.length === 0 ? (
        <EmptyState
          orb
          orbColor={palette.cyan}
          glyph={query ? '🔍' : '🖥️'}
          title={query ? 'No matches on the desktop' : 'Desktop catalog is empty'}
          subtitle={
            query
              ? 'Try a different word — search runs across the entire desktop library.'
              : 'No photos in the desktop catalog yet.'
          }
        />
      ) : (
        <FlashList
          // Remount on sort change so recycled cells don't paint the pre-sort order.
          key={`grid-${sortMode}-${query}`}
          data={sortedAssets}
          numColumns={COLS}
          keyExtractor={(a) => a.assetId}
          renderItem={({ item }) => (
            <DesktopCell base={base!} asset={item} onOpen={(asset, rect) => setDetail({ asset, rect })} />
          )}
          contentContainerStyle={styles.grid}
        />
      )}
      <DesktopDetail
        // Remount per open so the zoom stage seeds a fresh origin rect and replays its entrance.
        key={detail?.asset.assetId ?? 'closed'}
        base={base}
        target={detail}
        onClose={() => setDetail(null)}
      />
    </View>
  );
}

/** One desktop preview tile: a Shimmer breathes behind it until the desktop-rendered image paints. */
function DesktopCell({
  base,
  asset,
  onOpen,
}: {
  base: string;
  asset: DesktopAsset;
  onOpen: (asset: DesktopAsset, rect?: CellRect) => void;
}) {
  const ref = useRef<View>(null);
  const press = () => {
    const node = ref.current;
    if (node) node.measureInWindow((x, y, w, h) => onOpen(asset, { x, y, w, h }));
    else onOpen(asset);
  };
  return (
    <View ref={ref} collapsable={false}>
      <Springy onPress={press} scaleTo={0.92} accessibilityLabel="Desktop photo" accessibilityHint="Opens the photo">
        <View style={styles.cell}>
          <Shimmer style={StyleSheet.absoluteFill} />
          <Image
            source={{ uri: desktopPreviewUrl(base, asset.assetId, 480) }}
            style={StyleSheet.absoluteFill}
            cachePolicy="memory-disk"
            contentFit="cover"
            transition={200}
            accessibilityIgnoresInvertColors
          />
        </View>
      </Springy>
    </View>
  );
}

/** Extract the human-readable EXIF/place rows the oracle returns (shape is loose; guard every field). */
function metaRows(meta: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!meta) return [];
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const s = untrust(v);
    if (s) rows.push({ label, value: s });
  };
  push('Camera', meta.camera ?? meta.cameraModel ?? meta.model);
  push('Lens', meta.lens ?? meta.lensModel);
  push('Place', meta.place ?? meta.location ?? meta.city);
  push('Exposure', meta.exposure ?? meta.shutterSpeed);
  push('Aperture', meta.aperture ?? meta.fNumber);
  push('ISO', meta.iso ?? meta.isoSpeed);
  push('Focal length', meta.focalLength);
  return rows;
}

/**
 * Full-screen desktop-photo detail: the large preview zooms open from the tapped cell (shared viewer
 * chrome), then the oracle's face recognition (people) + any EXIF/place metadata surface beneath it.
 */
function DesktopDetail({
  base,
  target,
  onClose,
}: {
  base: string | null;
  target: DetailTarget | null;
  onClose: () => void;
}) {
  const asset = target?.asset ?? null;
  const [people, setPeople] = useState<DesktopPerson[] | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [closing, setClosing] = useState(false);
  const { stageStyle, backdropOpacity, requestClose } = useZoomStage(target?.rect);

  useEffect(() => {
    let cancelled = false;
    if (!asset || !base) return;
    setPeople(null);
    setMeta(null);
    analyzeDesktop(base, asset.assetId)
      .then((r) => {
        if (cancelled) return;
        setPeople(r.people);
        setMeta(r.meta);
      })
      .catch(() => {
        if (cancelled) return;
        setPeople([]);
        setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [asset?.assetId, base]);

  const close = useCallback(() => {
    setClosing(true);
    requestClose(onClose);
  }, [requestClose, onClose]);

  if (!asset || !base) return null;
  const rows = metaRows(meta);
  const capturedMs = captureMs(asset.captureDate);
  const captured = capturedMs != null ? formatDateTime(capturedMs) : '';
  const dims = asset.width && asset.height ? `${asset.width} × ${asset.height}` : '';
  const scrimHeight = 210 + (captured ? 22 : 0) + (people && people.length > 0 ? 56 : 0) + rows.length * 26;

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.detailRoot} accessibilityViewIsModal>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Animated.View style={[styles.stage, stageStyle]}>
          <Image
            source={{ uri: desktopPreviewUrl(base, asset.assetId, 1280) }}
            style={styles.detailImage}
            contentFit="contain"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        <Reveal visible={!closing} style={styles.chromeTop}>
          <ViewerTopBar onClose={close} />
        </Reveal>

        <Reveal visible={!closing} style={styles.chromeBottom}>
          <ScrimPanel height={scrimHeight}>
            <Text style={styles.detailTitle} numberOfLines={1}>
              {asset.title || 'Photo'}
            </Text>
            {captured ? (
              <Text style={styles.detailDate} numberOfLines={1}>
                {captured}
              </Text>
            ) : null}
            <Text style={styles.detailMeta} numberOfLines={1}>
              {dims ? `${dims} · ` : ''}from desktop
            </Text>

            <Text style={styles.sectionLabel}>
              People {people == null ? '· recognizing…' : `· ${people.length}`}
            </Text>
            {people != null && people.length === 0 ? (
              <Text style={styles.detailBody}>No recognized faces yet (desktop found none / not yet named).</Text>
            ) : null}
            {people != null && people.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {people.map((p, i) => (
                  <Chip
                    key={`${p.candidateId}-${i}`}
                    label={p.personName || 'Unnamed'}
                    sub={p.band || undefined}
                    accent={palette.cyan}
                  />
                ))}
              </ScrollView>
            ) : null}

            {rows.length > 0 ? (
              <View style={styles.metaBlock}>
                {rows.map((r) => (
                  <View key={r.label} style={styles.metaRow}>
                    <Text style={styles.metaKey}>{r.label}</Text>
                    <Text style={styles.metaVal} numberOfLines={1}>
                      {r.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrimPanel>
        </Reveal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grid: { padding: 1 },
  cell: {
    width: DCELL - 2,
    height: DCELL - 2,
    margin: 1,
    backgroundColor: palette.cell,
    borderRadius: 2,
    overflow: 'hidden',
  },

  connectWrap: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 12, gap: 10 },
  heroWrap: { width: 130, height: 130, alignItems: 'center', justifyContent: 'center' },
  hero: { fontSize: 46 },
  pitch: { color: palette.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  pitchSub: { color: palette.sub, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  fieldLabel: { color: palette.cyan, fontSize: 12, fontWeight: '700', alignSelf: 'flex-start', marginTop: 8, letterSpacing: 0.5 },
  input: {
    alignSelf: 'stretch',
    backgroundColor: palette.surfaceHi,
    borderColor: tint(palette.cyan, 0.4),
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.text,
    fontSize: 15,
    marginTop: 6,
  },
  cta: { alignSelf: 'stretch', marginTop: 18 },
  err: { color: palette.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },

  controls: { paddingHorizontal: 16, paddingBottom: 10 },
  searchErr: { color: palette.danger, fontSize: 13, marginTop: 8, marginLeft: 4 },
  disconnect: { color: palette.cyan, fontSize: 14, fontWeight: '700' },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  sortLabel: { color: palette.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  sortSeg: { flex: 1 },

  collectionsWrap: { paddingBottom: 12 },
  collectionsLabel: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  collectionsRow: { gap: 8, paddingHorizontal: 16 },

  detailRoot: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  stage: { flex: 1 },
  detailImage: { flex: 1, width: '100%' },
  chromeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  chromeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  detailTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  detailDate: { color: '#ffffff', fontSize: 14, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  detailMeta: { color: palette.accentSoft, fontSize: 13, marginTop: 3, fontVariant: ['tabular-nums'] },
  detailBody: { color: palette.sub, fontSize: 14, marginTop: 6 },
  sectionLabel: { color: palette.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: 14 },
  chips: { gap: 8, paddingTop: 10 },
  metaBlock: { marginTop: 12, gap: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaKey: { color: palette.muted, fontSize: 13 },
  metaVal: { color: '#ffffff', fontSize: 13, fontWeight: '600', marginLeft: 16, flexShrink: 1 },
});
