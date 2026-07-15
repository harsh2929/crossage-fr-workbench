/**
 * Desktop — the deep uplink to the Vintrace desktop app (the licensed face-recognition oracle).
 *
 * Pairs with the desktop's read-only companion HTTP surface, then browses the DESKTOP catalog:
 * real-resolution previews the desktop renders, full-library search, and per-photo face recognition
 * (people) the phone structurally cannot compute itself. The desktop catalog is its own asset space
 * (separate from the camera roll) — the identity join with camera-roll assets awaits the desktop's
 * canonical asset_uid work, so the two surfaces coexist rather than merge.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Dimensions, Modal, ScrollView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { palette, grad, tint } from '../theme';
import { ScreenHeader } from '../Header';
import { Springy, Loader, FloatingView, BreathingOrb } from '../motion';
import { Center } from '../ui';
import {
  pairDesktop,
  getSession,
  getLibrary,
  searchDesktop,
  analyzeDesktop,
  desktopPreviewUrl,
  type DesktopAsset,
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

export function DesktopScreen() {
  const [status, setStatus] = useState<Status>('loading');
  const [base, setBase] = useState<string | null>(null);
  const [device, setDevice] = useState<DesktopDevice | null>(null);
  const [host, setHost] = useState(DEV_HOST);
  const [code, setCode] = useState(DEV_CODE);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [assets, setAssets] = useState<DesktopAsset[]>([]);
  const [count, setCount] = useState(0);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<DesktopAsset | null>(null);

  const loadCatalog = useCallback(async (b: string, q: string) => {
    const [lib, items] = await Promise.all([getLibrary(b), searchDesktop(b, q, q.trim() ? 'hybrid' : 'lexical', 60)]);
    setCount(lib.assetCount);
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
    setQuery('');
    setStatus('connect');
  };

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!base) return;
    try {
      setAssets(await searchDesktop(base, q, q.trim() ? 'hybrid' : 'lexical', 60));
    } catch (e) {
      setErr(String(e));
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
          <Springy
            style={[styles.connectBtn, pairing && styles.connectBtnBusy]}
            onPress={pairing ? undefined : connect}
            disabled={pairing}
          >
            <Text style={styles.connectText}>{pairing ? 'Pairing…' : 'Connect'}</Text>
          </Springy>
          {err && <Text style={styles.err}>{err}</Text>}
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
          <Springy onPress={disconnect} hitSlop={10}>
            <Text style={styles.disconnect}>Disconnect</Text>
          </Springy>
        }
      />
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search the desktop catalog…"
            placeholderTextColor={palette.muted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query)}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Springy onPress={() => runSearch('')} hitSlop={12} style={styles.clear}>
              <Text style={styles.clearX}>✕</Text>
            </Springy>
          )}
        </View>
      </View>
      {assets.length === 0 ? (
        <Center>
          <Text style={styles.body}>{query ? 'No matches on the desktop.' : 'No photos in the desktop catalog.'}</Text>
        </Center>
      ) : (
        <FlashList
          data={assets}
          numColumns={COLS}
          keyExtractor={(a) => a.assetId}
          renderItem={({ item }) => (
            <Springy onPress={() => setDetail(item)} scaleTo={0.92}>
              <Image
                source={{ uri: desktopPreviewUrl(base!, item.assetId, 480) }}
                style={styles.cell}
                cachePolicy="memory-disk"
                contentFit="cover"
                transition={200}
              />
            </Springy>
          )}
          contentContainerStyle={styles.grid}
        />
      )}
      <DesktopDetail base={base} asset={detail} onClose={() => setDetail(null)} />
    </View>
  );
}

/** Full-screen desktop-photo detail: the large preview + metadata + face recognition (the oracle). */
function DesktopDetail({
  base,
  asset,
  onClose,
}: {
  base: string | null;
  asset: DesktopAsset | null;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<DesktopPerson[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!asset || !base) return;
    setPeople(null);
    analyzeDesktop(base, asset.assetId)
      .then((r) => !cancelled && setPeople(r.people))
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [asset?.assetId, base]);

  if (!asset || !base) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.detailRoot}>
        <Image
          source={{ uri: desktopPreviewUrl(base, asset.assetId, 1280) }}
          style={styles.detailImage}
          contentFit="contain"
          transition={150}
        />
        <View style={styles.detailTop}>
          <Springy onPress={onClose} hitSlop={16} style={styles.close}>
            <Text style={styles.closeX}>✕</Text>
          </Springy>
        </View>
        <View style={styles.detailPanel}>
          <Text style={styles.detailTitle} numberOfLines={1}>
            {asset.title || 'Photo'}
          </Text>
          <Text style={styles.detailMeta}>
            {asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''} · from desktop
          </Text>
          <Text style={styles.peopleLabel}>People {people == null ? '· recognizing…' : `· ${people.length}`}</Text>
          {people != null && people.length === 0 && (
            <Text style={styles.body}>No recognized faces (desktop found none / not yet named).</Text>
          )}
          {people != null && people.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {people.map((p, i) => (
                <View key={`${p.candidateId}-${i}`} style={styles.personChip}>
                  <Text style={styles.personName}>{p.personName || 'Unnamed'}</Text>
                  {p.band ? <Text style={styles.personBand}>{p.band}</Text> : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },
  grid: { padding: 1 },
  cell: { width: DCELL - 2, height: DCELL - 2, margin: 1, backgroundColor: palette.cell, borderRadius: 2 },

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
  connectBtn: {
    alignSelf: 'stretch',
    backgroundColor: palette.cyan,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  connectBtnBusy: { backgroundColor: tint(palette.cyan, 0.4) },
  connectText: { color: '#062a30', fontSize: 16, fontWeight: '800' },
  err: { color: palette.danger, fontSize: 13, textAlign: 'center', marginTop: 12 },

  controls: { paddingHorizontal: 16, paddingBottom: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceHi,
    borderColor: tint(palette.cyan, 0.4),
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  searchGlyph: { color: palette.cyan, fontSize: 20, marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: 11, color: palette.text, fontSize: 16 },
  clear: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  clearX: { color: palette.muted, fontSize: 15 },
  disconnect: { color: palette.cyan, fontSize: 14, fontWeight: '700' },

  detailRoot: { flex: 1, backgroundColor: '#000' },
  detailImage: { flex: 1, width: '100%' },
  detailTop: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeX: { color: '#fff', fontSize: 22, fontWeight: '600' },
  detailPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  detailTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  detailMeta: { color: palette.accentSoft, fontSize: 13, marginTop: 3 },
  peopleLabel: { color: palette.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: 14 },
  chips: { gap: 8, paddingTop: 10 },
  personChip: {
    backgroundColor: tint(palette.cyan, 0.16),
    borderColor: tint(palette.cyan, 0.5),
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  personName: { color: palette.text, fontSize: 14, fontWeight: '700' },
  personBand: { color: palette.cyan, fontSize: 10, fontWeight: '700', marginTop: 1 },
});
