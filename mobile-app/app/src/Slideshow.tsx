/**
 * Slideshow — a full-screen, auto-advancing viewer for a memory's photos. Each slide holds for a
 * user-chosen dwell (Slow 6s / Medium 4s / Fast 2.5s) with an optional Ken-Burns zoom (scale 1 →
 * 1.08) and cross-dissolves into the next. Tap anywhere to pause/resume; the sliders control (top
 * left) opens a compact settings sheet — speed, Ken-Burns on/off, shuffle — whose choices persist
 * across sessions via getPref/setPref. The corner ✕ closes.
 *
 * Built on plain RN Animated (native driver for scale + opacity — no reanimated/native dep). Two
 * physical layers (a/b) alternate so we get a true cross-fade instead of a fade-through-black. With
 * Ken-Burns off (or Reduce Motion on) the zoom holds still — the gentle cross-fade always stays.
 * Shuffle plays a deterministic permutation of the set (seeded, so no Math.random at module scope).
 * Photos render on pure black so they pop — the living colour stays in the launching chrome (and the
 * settings sheet), never behind the photo (house style).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { type AssetMetadata } from 'expo-media-library';
import { assetUri } from './media';
import { palette, tint, glowLg, tintBorder, discScrim, space, radius, typography } from './theme';
import { Springy, useReducedMotion } from './motion';
import { Segmented, Chip } from './fields';
import { getPref, setPref } from './replica';
import { useInsets } from './insets';
import { Icon } from './Icon';

const FADE = 650; // cross-dissolve length
const ZOOM_TO = 1.08; // Ken-Burns end scale

type Slot = 'a' | 'b';

// --- Persisted playback settings (Apple removed these controls; we bring them back) ----------------
type SpeedKey = 'slow' | 'med' | 'fast';
const HOLD_BY_SPEED: Record<SpeedKey, number> = { slow: 6000, med: 4000, fast: 2500 }; // dwell per slide
const SPEED_OPTIONS: { key: SpeedKey; label: string }[] = [
  { key: 'slow', label: 'Slow' },
  { key: 'med', label: 'Medium' },
  { key: 'fast', label: 'Fast' },
];

/** Read a boolean pref ('1'/'0'), falling back to a default when it was never set. */
function prefBool(key: string, dflt: boolean): boolean {
  const v = getPref(key);
  return v == null ? dflt : v === '1';
}

/**
 * A deterministic permutation of [0..n-1] for shuffle. Seeded Fisher–Yates driven by a tiny LCG so we
 * never call Math.random (unavailable at module scope / in some contexts) — the same seed always
 * yields the same order, and bumping the seed reshuffles.
 */
function shuffledOrder(n: number, seed: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  let s = (seed * 2654435761 + 1013904223) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** One layer of the cross-fade — an expo-image inside an Animated wrapper we drive for zoom + fade. */
function Slide({
  item,
  opacity,
  scale,
}: {
  item?: AssetMetadata;
  opacity: Animated.Value;
  scale: Animated.Value;
}) {
  if (!item) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale }] }]}>
      <Image
        source={{ uri: assetUri(item.id) }}
        style={StyleSheet.absoluteFill}
        recyclingKey={item.id}
        cachePolicy="memory-disk"
        contentFit="contain"
        transition={0}
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
}

export function Slideshow({
  visible,
  items,
  onClose,
  mixSpeed,
  mixKenburns,
}: {
  visible: boolean;
  items: AssetMetadata[];
  onClose: () => void;
  // A Memory Mix's pacing OVERRIDE for this playback: seeds speed/Ken-Burns without persisting, so the
  // user's own saved slideshow prefs are never clobbered. Re-applied on each open (effect below).
  mixSpeed?: SpeedKey;
  mixKenburns?: boolean;
}) {
  const insets = useInsets();
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Persisted playback prefs — read once on mount, written on every change (see handlers below). A Mix
  // override (if passed) wins for the initial value, but is NOT written back to the pref store.
  const [speed, setSpeed] = useState<SpeedKey>(() => {
    if (mixSpeed) return mixSpeed;
    const v = getPref('slideshow.speed');
    return v === 'slow' || v === 'med' || v === 'fast' ? v : 'med';
  });
  const [kbEnabled, setKbEnabled] = useState<boolean>(() => mixKenburns ?? prefBool('slideshow.kenburns', true));
  const [shuffle, setShuffle] = useState<boolean>(() => prefBool('slideshow.shuffle', false));

  // Re-apply the Mix override every time the slideshow opens — useState init runs once per mount, but
  // the player may reopen with a different Mix. State-only (never setPref), so global prefs stay intact.
  useEffect(() => {
    if (!visible) return;
    if (mixSpeed) setSpeed(mixSpeed);
    if (mixKenburns !== undefined) setKbEnabled(mixKenburns);
  }, [visible, mixSpeed, mixKenburns]);

  // The play order: a permutation of item indices (identity when shuffle is off). Slots below index
  // into THIS array, not directly into `items`, so shuffle is a pure reordering of the same photos.
  const shuffleNonce = useRef(0); // bumped on each toggle so re-enabling shuffle reshuffles
  const [order, setOrder] = useState<number[]>(() =>
    shuffle ? shuffledOrder(items.length, 0) : items.map((_, i) => i),
  );

  // Which order-position each physical layer currently shows. Visibility is driven purely by the layer
  // opacities below, so we don't track "which is active" in render state — only in activeRef (logic).
  const [slots, setSlots] = useState<{ a: number; b: number }>({ a: 0, b: 0 });

  const opA = useRef(new Animated.Value(1)).current;
  const opB = useRef(new Animated.Value(0)).current;
  const scA = useRef(new Animated.Value(1)).current;
  const scB = useRef(new Animated.Value(1)).current;

  // Logic mirrors of the render state, so the self-scheduling loop reads fresh values in its closure.
  const activeRef = useRef<Slot>('a');
  const curRef = useRef(0); // order-position currently displayed by the active layer

  const opacityOf = (s: Slot) => (s === 'a' ? opA : opB);
  const scaleOf = (s: Slot) => (s === 'a' ? scA : scB);

  // Reset to the first frame whenever we (re)open or the item set changes. useLayoutEffect (before
  // paint) so a reopen never shows the previous session's stale slot/opacity for a frame. The play
  // order is rebuilt here too from the current shuffle pref so shuffle is honoured from frame one.
  useLayoutEffect(() => {
    if (!visible) return;
    curRef.current = 0;
    activeRef.current = 'a';
    setSlots({ a: 0, b: 0 });
    opA.setValue(1);
    opB.setValue(0);
    scA.setValue(1);
    scB.setValue(1);
    setPaused(false);
    setSettingsOpen(false);
    setOrder(shuffle ? shuffledOrder(items.length, shuffleNonce.current) : items.map((_, i) => i));
  }, [visible, items, opA, opB, scA, scB]); // eslint-disable-line react-hooks/exhaustive-deps

  // On pause, snap to a single clean layer so pausing mid cross-fade doesn't freeze a blended
  // double-exposure on screen (the advance effect's cleanup has already stopped the animations).
  useEffect(() => {
    if (!visible || !paused) return;
    const active = activeRef.current;
    const other: Slot = active === 'a' ? 'b' : 'a';
    opacityOf(active).setValue(1);
    opacityOf(other).setValue(0);
  }, [paused, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The advance loop + Ken-Burns runner. Re-arms on play/pause and whenever a setting (speed, Ken-Burns,
  // shuffle order) changes, so edits take effect live; cleans up its timer + animations.
  useEffect(() => {
    if (!visible || items.length === 0 || paused) return;
    const seq = order.length === items.length ? order : items.map((_, i) => i);
    const hold = HOLD_BY_SPEED[speed];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Recover a clean state in case we were paused mid cross-fade.
    opacityOf(activeRef.current).setValue(1);
    opacityOf(activeRef.current === 'a' ? 'b' : 'a').setValue(0);

    const kenBurns = (slot: Slot) => {
      const s = scaleOf(slot);
      if (reduced || !kbEnabled) {
        s.setValue(1); // off means off — no pan/zoom (also honours Reduce Motion)
        return;
      }
      Animated.timing(s, {
        toValue: ZOOM_TO,
        duration: hold + FADE,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };

    const schedule = () => {
      timer = setTimeout(advance, hold);
    };

    const advance = () => {
      if (cancelled || seq.length <= 1) return;
      const from = activeRef.current;
      const to: Slot = from === 'a' ? 'b' : 'a';
      const nextIdx = (curRef.current + 1) % seq.length;

      // Load the incoming photo into the idle layer, hidden + un-zoomed, then dissolve it in.
      setSlots((prev) => ({ ...prev, [to]: nextIdx }));
      const inOp = opacityOf(to);
      const outOp = opacityOf(from);
      inOp.setValue(0);
      scaleOf(to).setValue(1);
      Animated.parallel([
        Animated.timing(inOp, { toValue: 1, duration: FADE, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(outOp, { toValue: 0, duration: FADE, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start();
      kenBurns(to);

      curRef.current = nextIdx;
      activeRef.current = to;
      schedule();
    };

    kenBurns(activeRef.current); // keep zooming the frame that's already up
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      opA.stopAnimation();
      opB.stopAnimation();
      scA.stopAnimation();
      scB.stopAnimation();
    };
  }, [visible, paused, items, reduced, speed, kbEnabled, order, opA, opB, scA, scB]);

  // --- Setting handlers: update state, persist, and (for shuffle) reorder the show live -------------
  const changeSpeed = (key: string) => {
    setSpeed(key as SpeedKey);
    setPref('slideshow.speed', key);
  };

  const toggleKenBurns = () => {
    const next = !kbEnabled;
    setKbEnabled(next);
    setPref('slideshow.kenburns', next ? '1' : '0');
    if (!next) {
      // Freeze any in-flight pan/zoom immediately (even while paused, before the loop re-arms).
      scA.setValue(1);
      scB.setValue(1);
    }
  };

  const toggleShuffle = () => {
    const next = !shuffle;
    shuffleNonce.current += 1;
    setShuffle(next);
    setPref('slideshow.shuffle', next ? '1' : '0');
    // Rebuild the play order and restart cleanly from its first slide, without leaving the settings
    // sheet or changing the pause state. setOrder re-arms the advance loop with the new sequence.
    const nextOrder = next ? shuffledOrder(items.length, shuffleNonce.current) : items.map((_, i) => i);
    curRef.current = 0;
    activeRef.current = 'a';
    opA.setValue(1);
    opB.setValue(0);
    scA.setValue(1);
    scB.setValue(1);
    setSlots({ a: 0, b: 0 });
    setOrder(nextOrder);
  };

  if (items.length === 0) return null; // guard: nothing to show

  // Slots index into the play order; fall back to identity during the transient render after the item
  // set changes but before the layout effect rebuilds `order` (guards against a length mismatch).
  const seq = order.length === items.length ? order : items.map((_, i) => i);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume slideshow' : 'Pause slideshow'}
          accessibilityHint="Double tap to pause or resume the slideshow"
        >
          <Slide item={items[seq[slots.a]]} opacity={opA} scale={scA} />
          <Slide item={items[seq[slots.b]]} opacity={opB} scale={scB} />
        </Pressable>

        {paused ? (
          <View pointerEvents="none" style={styles.pausedWrap}>
            <View style={styles.pausedPill}>
              <View style={styles.playTri} />
              <Text style={styles.pausedText} allowFontScaling={false}>
                Paused
              </Text>
            </View>
          </View>
        ) : null}

        {settingsOpen ? (
          <>
            {/* Tapping outside the sheet dismisses it (and intercepts the underlying pause Pressable). */}
            <Pressable
              style={[StyleSheet.absoluteFill, styles.scrim]}
              onPress={() => setSettingsOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close slideshow settings"
            />
            <View style={[styles.sheet, { bottom: insets.bottom + space.lg }]}>
              <Text style={styles.sheetTitle} maxFontSizeMultiplier={1.3}>
                Slideshow
              </Text>

              <Text style={styles.sheetLabel} maxFontSizeMultiplier={1.3}>
                Speed
              </Text>
              <Segmented options={SPEED_OPTIONS} value={speed} onChange={changeSpeed} accent={palette.accent} />

              <Text style={styles.sheetLabel} maxFontSizeMultiplier={1.3}>
                Effects
              </Text>
              <View style={styles.chipRow}>
                <Chip label="Ken Burns" onPress={toggleKenBurns} selected={kbEnabled} accent={palette.accent} />
                <Chip label="Shuffle" onPress={toggleShuffle} selected={shuffle} accent={palette.magenta} />
              </View>
            </View>
          </>
        ) : null}

        <Springy
          onPress={() => setSettingsOpen((o) => !o)}
          scaleTo={0.86}
          hitSlop={10}
          style={[styles.gear, { top: insets.top + space.sm }]}
          accessibilityLabel="Slideshow settings"
          accessibilityHint="Adjust speed, Ken Burns, and shuffle"
          accessibilityState={{ expanded: settingsOpen }}
        >
          <Icon name="sliders" size={22} color="#ffffff" />
        </Springy>

        <Springy
          onPress={onClose}
          scaleTo={0.86}
          hitSlop={10}
          style={[styles.close, { top: insets.top + space.sm }]}
          accessibilityLabel="Close slideshow"
          accessibilityHint="Returns to the memory"
        >
          <Icon name="close" size={22} color="#ffffff" />
        </Springy>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  // Over-photo corner control — neutral-on-dark disc (house style: no accent over a photo). 44pt tap.
  close: {
    position: 'absolute',
    right: space.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  // Sibling of `close`, mirrored to the left — opens the settings sheet.
  gear: {
    position: 'absolute',
    left: space.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pausedWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pausedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)', // neutral over-photo — accent stays in the settings sheet
  },
  // A right-pointing play triangle drawn from borders (no icon dep for "play").
  playTri: {
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#ffffff',
    marginLeft: 2,
  },
  pausedText: { ...typography.cardTitle, color: '#ffffff' },

  // Settings sheet — a bottom-anchored card of restored playback controls, on-brand accent glow.
  scrim: { backgroundColor: discScrim },
  sheet: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tint(palette.accent, tintBorder.rest),
    padding: space.lg,
    gap: space.md,
    ...glowLg(palette.accent),
  },
  sheetTitle: { ...typography.sheetTitle, color: palette.text },
  sheetLabel: { ...typography.kicker, color: palette.sub, marginTop: space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
