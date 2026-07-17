/**
 * PhotoEditor — a real editor across three modes (Crop / Adjust / Filters):
 *  • Crop: rotate 90°, flip, fine straighten (±15°), and a preset-aspect crop, applied with
 *    expo-image-manipulator (geometry) and previewed live via an RN transform.
 *  • Adjust: brightness / contrast / saturation / warmth sliders.
 *  • Filters: preset "looks" (Vivid, Dramatic, Mono, Noir, …).
 * Tonal (Adjust + Filters) is a single Skia colour matrix — the SAME matrix drives the live
 * <ColorMatrix> preview and the offscreen bake at save. Save order matches the pipeline: geometry via
 * the manipulator produces a JPEG, then Skia applies the colour matrix to it; the result is saved as a
 * NEW edited copy (PhotoKit gives third parties no in-place edit, so the original is always preserved).
 *
 * Skia is a native module, so this editor needs `npx expo prebuild` + a native rebuild — the same
 * rebuild the app already requires for expo-video / the OCR module, so in a shipped build Skia is
 * always present. The Skia decode is gated on `visible` (PhotoEditor is always mounted by the viewer):
 * we only decode when the editor is actually open, so browsing photos never pays a Skia cost and any
 * missing-native-module failure is scoped to opening the editor, not core viewing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, Pressable, PanResponder, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import { Asset, type AssetMetadata } from 'expo-media-library';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Canvas, Image as SkiaImage, ColorMatrix, useImage, Skia, ImageFormat } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { assetUri } from './media';
import { buildMatrix, isTonalActive, compose, IDENTITY, PRESETS, NEUTRAL_TONAL, type CMatrix, type Tonal } from './colorMatrix';
import { palette, tint, radius, tintFill, tintBorder, glowSm, typography, space } from './theme';
import { Springy } from './motion';
import { Segmented } from './fields';
import { toast } from './Toast';
import { useInsets } from './insets';
import { getPref, setPref } from './replica';

const { width: SCREEN_W } = Dimensions.get('window');

const ASPECTS: { key: string; label: string; ar: number | null }[] = [
  { key: 'orig', label: 'Original', ar: null },
  { key: 'sq', label: '1:1', ar: 1 },
  { key: 'p43', label: '4:3', ar: 4 / 3 },
  { key: 'p169', label: '16:9', ar: 16 / 9 },
];

// Fine straighten: ±15° around level, layered on top of the coarse 90° rotation and applied to the
// same rotate() call at save (arbitrary degrees are supported by expo-image-manipulator).
const STRAIGHTEN_MAX = 15;
const STRAIGHTEN_RANGE = STRAIGHTEN_MAX * 2;
const THUMB = 26; // slider knob diameter (also used to inset the thumb inside the track)

/** The full set of transforms (geometry + tonal) the editor can copy/paste between photos. */
type EditRecipe = { rotation: number; flipH: boolean; flipV: boolean; aspect: string; straighten: number } & Tonal;
// Session-scoped copy buffer for "Copy edits" / "Paste edits". Module-level so a copied recipe
// survives closing and reopening the editor within a run — it is NOT persisted across app launches.
let copiedRecipe: EditRecipe | null = null;

/** A full snapshot of the editor's discrete edit state — one entry in the undo/redo history. */
type EditSnapshot = EditRecipe & { canvasLight: boolean };
const HISTORY_CAP = 30; // cap undo/redo depth so a long session can't grow the stacks unbounded

type Mode = 'crop' | 'adjust' | 'filters';
const MODES: { key: Mode; label: string }[] = [
  { key: 'crop', label: 'Crop' },
  { key: 'adjust', label: 'Adjust' },
  { key: 'filters', label: 'Filters' },
];
const ADJ_THUMB = 22; // adjust-slider knob diameter

/**
 * Bake a tonal colour matrix into a JPEG on disk (Skia offscreen) and return its file:// uri, for
 * Asset.create. Runs AFTER the manipulator geometry so it colours the already-cropped/rotated image.
 * Throws if Skia can't decode/allocate (caught by save() → surfaced as a save failure, original kept).
 */
async function bakeTonal(uri: string, matrix: number[], tag: number): Promise<string> {
  // Each of these is a full-resolution native buffer (~48MB for a 12MP photo). Skia host objects are
  // GC-finalized nondeterministically, so we dispose() each explicitly the moment it's no longer
  // needed — otherwise back-to-back saves on a large photo can spike native memory / OOM.
  const data = await Skia.Data.fromURI(uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) {
    data.dispose();
    throw new Error('skia decode failed');
  }
  const w = img.width();
  const h = img.height();
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) {
    img.dispose();
    data.dispose();
    throw new Error('skia surface alloc failed');
  }
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));
  surface.getCanvas().drawImageRect(img, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(0, 0, w, h), paint);
  img.dispose(); // drawn — no longer needed
  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, 92);
  snapshot.dispose();
  surface.dispose();
  data.dispose();
  const out = new File(Paths.cache, `vintrace-edit-${tag}.jpg`);
  out.write(bytes);
  return out.uri;
}

/**
 * Interpolate a preset colour matrix toward IDENTITY at strength t∈[0,1] for the per-filter Intensity
 * dial: effective[i] = IDENTITY[i] + t·(preset[i] − IDENTITY[i]). t=1 returns the preset unchanged.
 */
function lerpToIdentity(preset: CMatrix, t: number): CMatrix {
  return IDENTITY.map((id, i) => id + t * (preset[i] - id));
}

/** A bipolar (-1…+1) adjust slider with a centre detent; tap the value to reset to 0. */
function AdjustSlider({ label, value, onChange, onBegin }: { label: string; value: number; onChange: (v: number) => void; onBegin?: () => void }) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  // The PanResponder is created once and closes over stale props, so it fires the history commit
  // through this always-current ref (mirrors cbRef above).
  const beginRef = useRef(onBegin);
  beginRef.current = onBegin;
  // Current value mirror, so the grant handler can tell a real change from a tap on the existing thumb.
  const valueRef = useRef(value);
  valueRef.current = value;
  const valueFromX = (x: number): number | null => {
    const width = wRef.current;
    if (width <= 0) return null;
    const frac = Math.max(0, Math.min(1, x / width));
    const v = Math.round((frac * 2 - 1) * 100) / 100; // -1..1, 2-dp
    return Math.abs(v) < 0.05 ? 0 : v; // snap to the centre detent
  };
  const setFromX = (x: number) => {
    const v = valueFromX(x);
    if (v !== null) cbRef.current(v);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      // Commit ONCE at the gesture start (captures the pre-drag state); the live move frames only
      // update the value, so a continuous drag is a single reversible history step — never one-per-frame.
      onPanResponderGrant: (e) => {
        // Commit the pre-drag snapshot ONLY when the touch actually moves the value — a bare tap on the
        // current thumb position must not push a no-op history step.
        const v = valueFromX(e.nativeEvent.locationX);
        if (v !== null && v !== valueRef.current) beginRef.current?.();
        setFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current;
  const pct = (value + 1) / 2; // 0..1
  const thumbLeft = Math.max(0, Math.min(w - ADJ_THUMB, pct * w - ADJ_THUMB / 2));
  // Fill from the centre tick out to the thumb, so the departure from neutral reads at a glance.
  const centre = w / 2;
  const fillLeft = value >= 0 ? centre : centre + (pct * w - centre);
  const fillW = Math.abs(pct * w - centre);
  return (
    <View style={styles.adjRow}>
      <View style={styles.adjHead}>
        <Text maxFontSizeMultiplier={1.3} style={styles.adjLabel}>{label}</Text>
        <Springy
          onPress={() => {
            if (value !== 0) onBegin?.(); // discrete reset → one history step (skip when already 0)
            onChange(0);
          }}
          hitSlop={8}
          pressableStyle={styles.adjValBadge}
          accessibilityLabel={`${label} ${value === 0 ? '0' : Math.round(value * 100)}. Tap to reset`}
        >
          <Text allowFontScaling={false} style={styles.adjVal}>
            {value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}`}
          </Text>
        </Springy>
      </View>
      <View
        style={styles.adjTrack}
        onLayout={(e: LayoutChangeEvent) => {
          const width = e.nativeEvent.layout.width;
          wRef.current = width;
          setW(width);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{
          min: -100,
          max: 100,
          now: Math.round(value * 100),
          text: value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const nv = Math.round(Math.max(-1, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))) * 100) / 100;
          if (nv !== value) {
            onBegin?.();
            onChange(nv);
          }
        }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={styles.adjLine} />
        {w > 0 ? <View pointerEvents="none" style={[styles.adjFill, { left: fillLeft, width: fillW }]} /> : null}
        <View pointerEvents="none" style={styles.adjTick} />
        <View pointerEvents="none" style={[styles.adjThumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

/**
 * A unipolar (0…1) strength slider styled like AdjustSlider (fill from the left, no centre detent);
 * tap the value badge to reset to full (100%). Session-only, so it drives no undo/redo history.
 */
function IntensitySlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const valueFromX = (x: number): number | null => {
    const width = wRef.current;
    if (width <= 0) return null;
    return Math.round(Math.max(0, Math.min(1, x / width)) * 100) / 100; // 0..1, 2-dp
  };
  const setFromX = (x: number) => {
    const v = valueFromX(x);
    if (v !== null) cbRef.current(v);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
    }),
  ).current;
  const thumbLeft = Math.max(0, Math.min(w - ADJ_THUMB, value * w - ADJ_THUMB / 2));
  const fillW = Math.max(0, value * w);
  return (
    <View style={styles.adjRow}>
      <View style={styles.adjHead}>
        <Text maxFontSizeMultiplier={1.3} style={styles.adjLabel}>{label}</Text>
        <Springy
          onPress={() => onChange(1)}
          hitSlop={8}
          pressableStyle={styles.adjValBadge}
          accessibilityLabel={`${label} ${Math.round(value * 100)} percent. Tap to reset to full`}
        >
          <Text allowFontScaling={false} style={styles.adjVal}>{`${Math.round(value * 100)}%`}</Text>
        </Springy>
      </View>
      <View
        style={styles.adjTrack}
        onLayout={(e: LayoutChangeEvent) => {
          const width = e.nativeEvent.layout.width;
          wRef.current = width;
          setW(width);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100), text: `${Math.round(value * 100)}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const nv = Math.round(Math.max(0, Math.min(1, value + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))) * 100) / 100;
          if (nv !== value) onChange(nv);
        }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={styles.adjLine} />
        {w > 0 ? <View pointerEvents="none" style={[styles.adjFill, { left: 0, width: fillW }]} /> : null}
        <View pointerEvents="none" style={[styles.adjThumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

/** Clamp to the straighten range and quantise to 0.5° so drag/step land on tidy values. */
const clampAngle = (v: number) => Math.max(-STRAIGHTEN_MAX, Math.min(STRAIGHTEN_MAX, Math.round(v * 2) / 2));
/** Signed degree readout, e.g. "0°", "+3.5°", "−12°". */
const fmtDeg = (d: number) => {
  const r = Math.round(d * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}°`;
};

/**
 * Largest axis-aligned rectangle (of the source w:h aspect) that fits ENTIRELY inside a w×h image
 * rotated by `rad` radians — i.e. excluding the transparent/black wedges an arbitrary rotate adds.
 * (Standard "rotate-and-crop" result.) Generalizes cleanly to 0/90/180/270 (returns the full/swapped
 * image) so one crop path handles both the coarse rotation and the fine straighten.
 */
function rotatedRectWithMaxArea(w: number, h: number, rad: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const sinA = Math.abs(Math.sin(rad));
  const cosA = Math.abs(Math.cos(rad));
  const widthIsLonger = w >= h;
  const longSide = widthIsLonger ? w : h;
  const shortSide = widthIsLonger ? h : w;
  if (shortSide <= 2 * sinA * cosA * longSide || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * shortSide;
    return widthIsLonger ? { w: x / sinA, h: x / cosA } : { w: x / cosA, h: x / sinA };
  }
  const cos2a = cosA * cosA - sinA * sinA;
  return { w: (w * cosA - h * sinA) / cos2a, h: (h * cosA - w * sinA) / cos2a };
}

function Tool({ glyph, label, onPress, on }: { glyph: string; label: string; onPress: () => void; on?: boolean }) {
  return (
    <Springy onPress={onPress} pressableStyle={[styles.tool, on && styles.toolOn]} accessibilityLabel={label} accessibilityState={{ selected: !!on }}>
      <Text allowFontScaling={false} style={[styles.toolGlyph, on && { color: palette.cyan }]}>
        {glyph}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={[styles.toolLabel, on && { color: palette.cyan }]}>{label}</Text>
    </Springy>
  );
}

export function PhotoEditor({
  visible,
  asset,
  onClose,
  onSaved,
}: {
  visible: boolean;
  asset: AssetMetadata | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const insets = useInsets();
  const [mode, setMode] = useState<Mode>('crop');
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState('orig');
  const [straighten, setStraighten] = useState(0); // -15 .. +15
  const [brightness, setBrightness] = useState(0); // tonal, each -1 .. +1
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [warmth, setWarmth] = useState(0);
  const [filter, setFilter] = useState('none');
  // Per-filter strength, 0..1 (1 = full). Session-only: not persisted, not in the undo/redo snapshot or
  // the copy/paste recipe. Resets to 1 whenever the editor opens or a different filter is selected.
  const [intensity, setIntensity] = useState(1);
  const [comparing, setComparing] = useState(false); // true only while the compare control is held
  const [trackW, setTrackW] = useState(0); // measured straighten-slider track width
  const [hasCopy, setHasCopy] = useState(copiedRecipe != null);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  // Editing-canvas appearance (dark ⇆ light) so edits can be judged against either backdrop — like
  // Apple's editor. Read once on mount and written on every toggle so it sticks across sessions. This
  // is purely the preview letterbox behind the contain-fit photo (+ the minimal chrome that must stay
  // legible over it); the photo, the Skia matrix, and the exported copy are all unchanged.
  const [canvasLight, setCanvasLight] = useState<boolean>(() => getPref('editor.canvasLight') === '1');
  const savingRef = useRef(false);

  // ── Undo / Redo history ────────────────────────────────────────────────────────────────────────
  // A multi-step history of edit-state snapshots (like Apple's editor). Every DISCRETE action — a
  // button press, the START of a slider gesture, a paste, a canvas toggle — pushes the PRIOR snapshot
  // onto `past` and clears `future`; Undo walks back (current → future), Redo walks forward. Depth is
  // capped so a long session can't grow the stacks unbounded. A continuous slider drag commits ONCE at
  // gesture start (commitRef in the straighten PanResponder / AdjustSlider `onBegin`), so a drag is a
  // single reversible step — never one-per-frame.
  const [past, setPast] = useState<EditSnapshot[]>([]);
  const [future, setFuture] = useState<EditSnapshot[]>([]);
  const currentSnapshot = (): EditSnapshot => ({
    rotation, flipH, flipV, aspect, straighten, brightness, contrast, saturation, warmth, filter, canvasLight,
  });
  // Push the current state as the prior snapshot and start a fresh redo branch. Call BEFORE mutating.
  const commit = () => {
    const snap = currentSnapshot();
    setPast((p) => {
      const next = [...p, snap];
      return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    });
    setFuture([]);
  };
  // The straighten PanResponder is created once and closes over stale state, so it commits through
  // this always-current ref (mirrors the trackWRef pattern below).
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const applySnapshot = (s: EditSnapshot) => {
    setRotation(s.rotation);
    setFlipH(s.flipH);
    setFlipV(s.flipV);
    setAspect(s.aspect);
    setStraighten(s.straighten);
    setBrightness(s.brightness);
    setContrast(s.contrast);
    setSaturation(s.saturation);
    setWarmth(s.warmth);
    setFilter(s.filter);
    // canvasLight is persisted (sticks across sessions), so keep the pref in sync when history moves it.
    if (s.canvasLight !== canvasLight) {
      setCanvasLight(s.canvasLight);
      setPref('editor.canvasLight', s.canvasLight ? '1' : '0');
    }
  };
  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const cur = currentSnapshot();
    setPast((p) => p.slice(0, -1));
    setFuture((f) => {
      const next = [...f, cur];
      return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    });
    applySnapshot(prev);
  };
  const redo = () => {
    if (future.length === 0) return;
    const nxt = future[future.length - 1];
    const cur = currentSnapshot();
    setFuture((f) => f.slice(0, -1));
    setPast((p) => {
      const next = [...p, cur];
      return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
    });
    applySnapshot(nxt);
  };

  // Discrete tap → safe to persist immediately (no rapid-toggle churn).
  const toggleCanvas = () => {
    commit();
    const next = !canvasLight;
    setCanvasLight(next);
    setPref('editor.canvasLight', next ? '1' : '0');
  };

  // The decoded Skia image for the tonal preview (null while decoding, or if Skia isn't in the build);
  // we fall back to the plain expo-image until it's ready, so the editor always shows the photo. Gated
  // on `visible`: PhotoEditor is always mounted by the viewer, so decoding only when the editor is
  // actually open avoids a full-res Skia decode on every photo swipe AND scopes any "Skia not linked"
  // failure to the editor sheet rather than core photo viewing.
  const skImage = useImage(visible ? assetUri(asset?.id ?? '') : null);
  const tonal: Tonal = { brightness, contrast, saturation, warmth, filter };
  const tonalActive = isTonalActive(tonal);
  // Per-filter Intensity dials the SELECTED preset's strength: interpolate it toward IDENTITY at
  // `intensity`, then re-layer the Adjust sliders on top (buildMatrix's own preset+adjustments order),
  // and feed the result into BOTH the live <ColorMatrix> preview and the save bake. At full strength (or
  // with no filter) we return buildMatrix(tonal) verbatim, so 100% is byte-identical to prior behaviour.
  const matrix = useMemo(() => {
    if (filter === 'none' || intensity >= 1) return buildMatrix(tonal);
    const preset = PRESETS.find((p) => p.key === filter)?.matrix ?? IDENTITY;
    const scaledPreset = lerpToIdentity(preset, intensity);
    const adjustments = buildMatrix({ brightness, contrast, saturation, warmth, filter: 'none' });
    return compose(adjustments, scaledPreset);
  }, [brightness, contrast, saturation, warmth, filter, intensity]);

  // Mirrors the measured track width into the once-created PanResponder (which closes over stale state).
  const trackWRef = useRef(0);
  // Current angle mirror, so grant can tell a real change from a tap on the existing thumb.
  const straightenRef = useRef(straighten);
  straightenRef.current = straighten;

  // Map an x within the track to a straighten angle (left edge = −15°, centre = 0°, right edge = +15°).
  const angleFromX = (x: number): number | null => {
    const w = trackWRef.current;
    if (w <= 0) return null;
    return clampAngle(-STRAIGHTEN_MAX + Math.max(0, Math.min(1, x / w)) * STRAIGHTEN_RANGE);
  };
  const setAngleFromX = (x: number) => {
    const a = angleFromX(x);
    if (a !== null) setStraighten(a);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      // Commit the pre-drag snapshot ONLY when the touch actually changes the angle (a bare tap on the
      // current thumb must not push a no-op history step); the drag then stays a single reversible step.
      onPanResponderGrant: (e) => {
        const a = angleFromX(e.nativeEvent.locationX);
        if (a !== null && a !== straightenRef.current) commitRef.current();
        setAngleFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => setAngleFromX(e.nativeEvent.locationX),
    }),
  ).current;

  // Reset the edit session whenever the editor opens (or the photo changes) so no transform leaks
  // from a previous edit into the next photo.
  useEffect(() => {
    if (visible) {
      setMode('crop');
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setAspect('orig');
      setStraighten(0);
      setBrightness(0);
      setContrast(0);
      setSaturation(0);
      setWarmth(0);
      setFilter('none');
      setIntensity(1);
      setComparing(false);
      setHasCopy(copiedRecipe != null); // re-sync in case a recipe was copied while closed
      setPast([]); // fresh undo/redo history per photo, alongside the edit-state reset above
      setFuture([]);
    }
  }, [visible, asset?.id]);

  if (!visible || !asset) return null;
  const dirty =
    rotation !== 0 || flipH || flipV || aspect !== 'orig' || straighten !== 0 || tonalActive;

  const save = async () => {
    if (!dirty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const info = await new Asset(asset.id).getInfo();
      if (!info.uri || info.uri.startsWith('ph://')) {
        // getInfo().uri isn't a readable file path (e.g. an iCloud-only asset not downloaded locally).
        toast({ text: 'Can’t edit — download this photo from iCloud first', tone: 'danger' });
        return;
      }
      const origW = asset.width ?? 0;
      const origH = asset.height ?? 0;
      const totalDeg = rotation + straighten;
      const ctx = ImageManipulator.manipulate(info.uri);
      if (totalDeg) ctx.rotate(totalDeg);
      const ar = ASPECTS.find((a) => a.key === aspect)?.ar ?? null;
      // Crop when there's a target aspect OR any straighten: an arbitrary rotate expands the canvas
      // and JPEG-fills the corners black, so we crop to the largest margin-free centered rectangle.
      if ((ar != null || straighten !== 0) && origW > 0 && origH > 0) {
        const rad = (Math.abs(totalDeg) * Math.PI) / 180;
        const sinA = Math.abs(Math.sin(rad));
        const cosA = Math.abs(Math.cos(rad));
        const outW = origW * cosA + origH * sinA; // the expanded canvas the rotate produces
        const outH = origW * sinA + origH * cosA;
        const insc = rotatedRectWithMaxArea(origW, origH, rad); // largest margin-free rect (source aspect)
        let cw = insc.w;
        let ch = insc.h;
        if (ar) {
          if (cw / ch > ar) cw = ch * ar;
          else ch = cw / ar;
        }
        cw = Math.max(1, Math.round(cw));
        ch = Math.max(1, Math.round(ch));
        const x = Math.max(0, Math.round((outW - cw) / 2));
        const y = Math.max(0, Math.round((outH - ch) / 2));
        ctx.crop({ originX: x, originY: y, width: cw, height: ch });
      }
      if (flipH) ctx.flip('horizontal');
      if (flipV) ctx.flip('vertical');
      const ref = await ctx.renderAsync();
      const result = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      // Tonal pass: colour the geometry-baked JPEG through the SAME Skia matrix the preview used.
      // Only when tonal is active — a pure crop/rotate never pays the Skia round-trip.
      const finalUri = tonalActive ? await bakeTonal(result.uri, matrix, Date.now()) : result.uri;
      await Asset.create(finalUri);
      toast({ text: 'Saved to Photos — pull to refresh to see it', tone: 'brand' });
      onSaved?.();
      onClose();
    } catch {
      toast({ text: 'Couldn’t save the edit', tone: 'danger' });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const onStageLayout = (e: LayoutChangeEvent) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWRef.current = w;
    setTrackW(w);
  };

  const copyEdits = () => {
    copiedRecipe = { rotation, flipH, flipV, aspect, straighten, brightness, contrast, saturation, warmth, filter };
    setHasCopy(true);
    toast({ text: 'Edits copied', tone: 'brand' });
  };
  const pasteEdits = () => {
    if (!copiedRecipe) return;
    commit(); // paste is one discrete edit → one reversible history step
    setRotation(copiedRecipe.rotation);
    setFlipH(copiedRecipe.flipH);
    setFlipV(copiedRecipe.flipV);
    setAspect(copiedRecipe.aspect);
    setStraighten(clampAngle(copiedRecipe.straighten));
    setBrightness(copiedRecipe.brightness);
    setContrast(copiedRecipe.contrast);
    setSaturation(copiedRecipe.saturation);
    setWarmth(copiedRecipe.warmth);
    setFilter(copiedRecipe.filter);
    setIntensity(1); // the recipe stores no strength → paste the copied filter at full, then dial if wanted
    toast({ text: 'Edits pasted', tone: 'brand' });
  };

  // Straighten-slider knob position: fraction of range → pixels, inset so the knob stays on the track.
  const straightenEw = Math.max(1, trackW - THUMB);
  const thumbLeft = Math.max(
    0,
    Math.min(straightenEw, ((straighten + STRAIGHTEN_MAX) / STRAIGHTEN_RANGE) * trackW - THUMB / 2),
  );

  // Crop frame (output aspect, centered) drawn over the preview so the crop isn't invisible.
  const ar = ASPECTS.find((a) => a.key === aspect)?.ar ?? null;
  let frame: { width: number; height: number } | null = null;
  if (ar && stage.w > 0 && stage.h > 0) {
    let fw = stage.w;
    let fh = stage.w / ar;
    if (fh > stage.h) {
      fh = stage.h;
      fw = stage.h * ar;
    }
    frame = { width: Math.round(fw), height: Math.round(fh) };
  }

  // Geometry preview transform (flip + rotate + straighten), shared by the plain-image and Skia-canvas
  // preview paths; dropped entirely while comparing to reveal the untouched original.
  const geoTransform = comparing
    ? []
    : [{ scaleX: flipH ? -1 : 1 }, { scaleY: flipV ? -1 : 1 }, { rotate: `${rotation + straighten}deg` }];
  // Tonal preview runs through Skia with the SAME colour matrix the bake uses. Until the Skia image is
  // decoded (or if Skia isn't in the build → skImage stays null), fall back to the plain image so the
  // photo always shows and the Crop tools still work.
  const useSkiaPreview = !comparing && tonalActive && !!skImage && stage.w > 0 && stage.h > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
          <Springy onPress={onClose} hitSlop={12} accessibilityLabel="Cancel edit">
            <Text maxFontSizeMultiplier={1.3} style={styles.cancel}>Cancel</Text>
          </Springy>
          <View style={styles.titleGroup}>
            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>Edit</Text>
            <Springy
              onPress={toggleCanvas}
              hitSlop={10}
              pressableStyle={[styles.canvasBtn, canvasLight && styles.canvasBtnOn]}
              accessibilityLabel={canvasLight ? 'Canvas: light' : 'Canvas: dark'}
              accessibilityHint="Switches the editing canvas background between dark and light"
              accessibilityState={{ selected: canvasLight }}
            >
              <Text allowFontScaling={false} style={styles.canvasGlyph}>
                ◐
              </Text>
            </Springy>
          </View>
          <Springy onPress={save} disabled={!dirty || saving} hitSlop={12} accessibilityLabel={saving ? 'Saving edited copy' : 'Save edited copy'} accessibilityState={{ disabled: !dirty || saving, busy: saving }}>
            {saving ? <ActivityIndicator color={palette.cyan} accessibilityLabel="Saving" /> : <Text style={[styles.done, !dirty && styles.doneOff]}>Done</Text>}
          </Springy>
        </View>

        <View style={[styles.stage, canvasLight && styles.stageLight]} onLayout={onStageLayout}>
          {/* While the compare control is held, drop every transform + the tonal matrix + the crop
              frame to reveal the untouched original; releasing restores the edited preview. When tonal
              is active we render a Skia canvas (colour matrix) under the same geometry transform; the
              plain expo-image handles the geometry-only and loading/fallback cases. */}
          {useSkiaPreview ? (
            <Canvas style={[styles.skiaPreview, { width: stage.w, height: stage.h }, { transform: geoTransform }]}>
              <SkiaImage image={skImage} x={0} y={0} width={stage.w} height={stage.h} fit="contain">
                <ColorMatrix matrix={matrix} />
              </SkiaImage>
            </Canvas>
          ) : (
            <Image
              source={{ uri: assetUri(asset.id) }}
              style={[styles.preview, { transform: geoTransform }]}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
          )}
          {!comparing && frame ? (
            <View pointerEvents="none" style={[styles.frame, frame, canvasLight && styles.frameLight]}>
              <View style={styles.frameLabelWrap}>
                <Text style={styles.frameLabel}>Crop {ASPECTS.find((a) => a.key === aspect)?.label}</Text>
              </View>
            </View>
          ) : null}
          {comparing ? (
            <View pointerEvents="none" style={styles.compareBadge}>
              <Text style={styles.compareBadgeText}>Original</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
          <Segmented options={MODES} value={mode} onChange={(k) => setMode(k as Mode)} accent={palette.cyan} />

          <View style={styles.historyRow}>
            <Springy
              onPress={undo}
              disabled={past.length === 0}
              hitSlop={{ top: 6, bottom: 6 }}
              pressableStyle={[styles.histBtn, past.length === 0 && styles.histBtnOff]}
              accessibilityLabel="Undo"
              accessibilityHint="Reverts the last edit"
              accessibilityState={{ disabled: past.length === 0 }}
            >
              <Text allowFontScaling={false} style={styles.histGlyph}>
                ↶
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.histLabel}>Undo</Text>
            </Springy>
            <Springy
              onPress={redo}
              disabled={future.length === 0}
              hitSlop={{ top: 6, bottom: 6 }}
              pressableStyle={[styles.histBtn, future.length === 0 && styles.histBtnOff]}
              accessibilityLabel="Redo"
              accessibilityHint="Reapplies the last undone edit"
              accessibilityState={{ disabled: future.length === 0 }}
            >
              <Text allowFontScaling={false} style={styles.histGlyph}>
                ↷
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.histLabel}>Redo</Text>
            </Springy>
          </View>

          {mode === 'crop' && (
            <>
              <View style={styles.tools}>
                <Tool glyph="↺" label="Left" onPress={() => { commit(); setRotation((r) => (r + 270) % 360); }} />
                <Tool glyph="↻" label="Right" onPress={() => { commit(); setRotation((r) => (r + 90) % 360); }} />
                <Tool glyph="⇋" label="Flip H" on={flipH} onPress={() => { commit(); setFlipH((f) => !f); }} />
                <Tool glyph="⇵" label="Flip V" on={flipV} onPress={() => { commit(); setFlipV((f) => !f); }} />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>Straighten</Text>
              <View style={styles.straightenRow}>
                <Springy
                  onPress={() => {
                    if (straighten > -STRAIGHTEN_MAX) commit(); // skip a no-op step at the boundary
                    setStraighten((s) => clampAngle(s - 1));
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  pressableStyle={styles.stepBtn}
                  accessibilityLabel="Straighten one degree counter-clockwise"
                >
                  <Text allowFontScaling={false} style={styles.stepGlyph}>
                    −
                  </Text>
                </Springy>
                <View
                  style={styles.track}
                  onLayout={onTrackLayout}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel="Straighten angle"
                  accessibilityValue={{ min: -STRAIGHTEN_MAX, max: STRAIGHTEN_MAX, now: straighten, text: fmtDeg(straighten) }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(e) => {
                    const nv = clampAngle(straighten + (e.nativeEvent.actionName === 'increment' ? 0.5 : -0.5));
                    if (nv !== straighten) {
                      commit();
                      setStraighten(nv);
                    }
                  }}
                  {...pan.panHandlers}
                >
                  <View pointerEvents="none" style={styles.trackLine} />
                  <View pointerEvents="none" style={styles.trackTick} />
                  <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft }]} />
                </View>
                <Springy
                  onPress={() => {
                    if (straighten < STRAIGHTEN_MAX) commit(); // skip a no-op step at the boundary
                    setStraighten((s) => clampAngle(s + 1));
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  pressableStyle={styles.stepBtn}
                  accessibilityLabel="Straighten one degree clockwise"
                >
                  <Text allowFontScaling={false} style={styles.stepGlyph}>
                    +
                  </Text>
                </Springy>
                <Springy
                  onPress={() => {
                    if (straighten !== 0) commit(); // skip a no-op step when already level
                    setStraighten(0);
                  }}
                  hitSlop={{ top: 6, bottom: 6 }}
                  pressableStyle={styles.degBadge}
                  accessibilityLabel="Reset straighten angle"
                  accessibilityHint="Sets the straighten angle back to level"
                >
                  <Text allowFontScaling={false} style={styles.degText}>
                    {fmtDeg(straighten)}
                  </Text>
                </Springy>
              </View>

              <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>Aspect</Text>
              <Segmented options={ASPECTS.map((a) => ({ key: a.key, label: a.label }))} value={aspect} onChange={(k) => { if (k !== aspect) commit(); setAspect(k); }} accent={palette.cyan} />
            </>
          )}

          {mode === 'adjust' && (
            <View style={styles.adjustPanel}>
              <AdjustSlider label="Brightness" value={brightness} onChange={setBrightness} onBegin={commit} />
              <AdjustSlider label="Contrast" value={contrast} onChange={setContrast} onBegin={commit} />
              <AdjustSlider label="Saturation" value={saturation} onChange={setSaturation} onBegin={commit} />
              <AdjustSlider label="Warmth" value={warmth} onChange={setWarmth} onBegin={commit} />
            </View>
          )}

          {mode === 'filters' && (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {PRESETS.map((p) => {
                  const on = filter === p.key;
                  return (
                    <Springy
                      key={p.key}
                      onPress={() => { if (p.key !== filter) { commit(); setIntensity(1); } setFilter(p.key); }}
                      hitSlop={{ top: 6, bottom: 6 }}
                      pressableStyle={[styles.filterChip, on && styles.filterChipOn]}
                      accessibilityLabel={`${p.label} filter`}
                      accessibilityState={{ selected: on }}
                    >
                      <Text maxFontSizeMultiplier={1.3} style={[styles.filterText, on && styles.filterTextOn]}>{p.label}</Text>
                    </Springy>
                  );
                })}
              </ScrollView>
              {/* Per-filter strength dial (Apple-style): only meaningful once a real filter is picked. */}
              {filter !== 'none' ? (
                <IntensitySlider label="Intensity" value={intensity} onChange={setIntensity} />
              ) : null}
            </>
          )}

          <View style={styles.actionsRow}>
            <Pressable
              onPressIn={() => setComparing(true)}
              onPressOut={() => setComparing(false)}
              onAccessibilityTap={() => {
                if (!dirty) return;
                setComparing(true);
                setTimeout(() => setComparing(false), 1400);
              }}
              disabled={!dirty}
              style={[styles.action, comparing && styles.actionActive, !dirty && styles.actionOff]}
              accessibilityRole="button"
              accessibilityLabel="Compare with original"
              accessibilityState={{ disabled: !dirty }}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.actionText, comparing && { color: palette.cyan }]}>{comparing ? 'Original' : 'Compare'}</Text>
            </Pressable>
            <Springy
              onPress={copyEdits}
              disabled={!dirty}
              pressableStyle={[styles.action, !dirty && styles.actionOff]}
              accessibilityLabel="Copy edits"
              accessibilityState={{ disabled: !dirty }}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>Copy</Text>
            </Springy>
            <Springy
              onPress={pasteEdits}
              disabled={!hasCopy}
              pressableStyle={[styles.action, !hasCopy && styles.actionOff]}
              accessibilityLabel="Paste edits"
              accessibilityState={{ disabled: !hasCopy }}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>Paste</Text>
            </Springy>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 18,
  },
  cancel: { color: palette.sub, ...typography.body },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: palette.text, ...typography.sheetTitle },
  done: { color: palette.cyan, ...typography.cardTitle },
  doneOff: { color: palette.muted },

  // Light/dark editing-canvas toggle (a split-circle "appearance" glyph next to the title)
  canvasBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  canvasBtnOn: { backgroundColor: tint(palette.cyan, tintFill.active), borderColor: tint(palette.cyan, tintBorder.active), ...glowSm(palette.cyan) },
  canvasGlyph: { color: palette.cyan, fontSize: 16, lineHeight: 19, fontWeight: '800' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // Light editing canvas — a soft neutral letterbox to judge edits against a bright backdrop. The
  // photo (contain-fit) is unchanged; only the surrounding stage flips to this soft light.
  stageLight: { backgroundColor: '#ecebf0' },
  preview: { width: SCREEN_W, height: '100%' },
  skiaPreview: { backgroundColor: 'transparent' },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  // On a light canvas the default white crop outline vanishes into the letterbox — darken it so the
  // crop frame stays visible (the dark label pill + white text below already read on both).
  frameLight: { borderColor: 'rgba(20,20,28,0.82)' },
  frameLabelWrap: { marginTop: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  frameLabel: { color: '#ffffff', fontSize: 12, fontWeight: '700' },

  controls: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: palette.bg, gap: 10 },
  tools: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  tool: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  toolOn: { backgroundColor: tint(palette.cyan, tintFill.active), borderColor: tint(palette.cyan, tintBorder.active), ...glowSm(palette.cyan) },
  toolGlyph: { color: palette.text, fontSize: 22, lineHeight: 26 },
  toolLabel: { color: palette.sub, fontSize: 11, fontWeight: '700' },
  sectionLabel: { color: palette.cyan, ...typography.kicker, marginTop: space.xs },

  // Straighten slider
  straightenRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  stepGlyph: { color: palette.text, fontSize: 22, lineHeight: 24 },
  track: { flex: 1, height: 40, justifyContent: 'center' },
  trackLine: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: tint(palette.cyan, 0.2) },
  trackTick: { position: 'absolute', left: '50%', width: 2, height: 14, marginLeft: -1, borderRadius: 1, backgroundColor: tint(palette.cyan, 0.5) },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: palette.cyan,
    borderWidth: 3,
    borderColor: palette.bg,
  },
  degBadge: {
    minWidth: 58,
    height: 40,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, 0.14),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  degText: { color: palette.cyan, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // Compare / Copy / Paste
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  action: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  actionActive: { backgroundColor: tint(palette.cyan, tintFill.active), borderColor: tint(palette.cyan, 0.6), ...glowSm(palette.cyan) },
  actionOff: { opacity: 0.4 },
  actionText: { color: palette.sub, fontSize: 13, fontWeight: '800' },

  // Undo / Redo (multi-step edit history), sitting just under the mode row.
  historyRow: { flexDirection: 'row', gap: 8 },
  histBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 40,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  histBtnOff: { opacity: 0.4 },
  histGlyph: { color: palette.cyan, fontSize: 18, lineHeight: 20, fontWeight: '800' },
  histLabel: { color: palette.sub, fontSize: 13, fontWeight: '800' },

  // Adjust panel (brightness / contrast / saturation / warmth sliders)
  adjustPanel: { gap: 6, paddingTop: 2 },
  adjRow: { gap: 6 },
  adjHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  adjLabel: { color: palette.sub, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  adjValBadge: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: tint(palette.cyan, tintFill.rest),
  },
  adjVal: { color: palette.cyan, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  adjTrack: { height: 36, justifyContent: 'center' },
  adjLine: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: tint(palette.cyan, 0.2) },
  adjFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: palette.cyan },
  adjTick: { position: 'absolute', left: '50%', width: 2, height: 12, marginLeft: -1, borderRadius: 1, backgroundColor: tint(palette.cyan, 0.5) },
  adjThumb: {
    position: 'absolute',
    width: ADJ_THUMB,
    height: ADJ_THUMB,
    borderRadius: ADJ_THUMB / 2,
    backgroundColor: palette.cyan,
    borderWidth: 3,
    borderColor: palette.bg,
  },

  // Filters panel (preset chips)
  filterRow: { gap: 8, paddingVertical: 4, paddingRight: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.cyan, tintBorder.rest),
  },
  filterChipOn: { backgroundColor: tint(palette.cyan, tintFill.active), borderColor: palette.cyan, ...glowSm(palette.cyan) },
  filterText: { color: palette.sub, fontSize: 13, fontWeight: '800' },
  filterTextOn: { color: palette.cyan },

  // Compare overlay badge on the stage
  compareBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  compareBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
});
