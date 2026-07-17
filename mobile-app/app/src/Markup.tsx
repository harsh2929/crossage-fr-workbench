/**
 * Markup — a freehand annotation layer over a photo (Apple Photos' Markup). You draw strokes on the
 * image with a finger; Save bakes them into a NEW copy in the library (app-local, non-destructive —
 * the original is untouched, matching how our Duplicate/edit flows keep PhotoKit safe).
 *
 * Two things make this possible now that they weren't before:
 *   • react-native-gesture-handler — a Pan gesture that tracks the finger WITHOUT hijacking the app's
 *     scroll views (a plain PanResponder is screen-global; this was the wall that kept Markup blocked).
 *   • @shopify/react-native-skia — a <Canvas> for the live strokes AND an offscreen surface to bake the
 *     strokes onto the full-resolution image at save.
 *
 * Coordinate model: the canvas is sized to the image's EXACT aspect (no letterbox), so screen strokes
 * map linearly to image pixels. At save we draw the full-res image, then `canvas.scale(imgW/canvasW)`
 * and replay the same stroke paths — so a stroke drawn at display size lands pixel-correct on the
 * original, and its width scales up proportionally.
 *
 * Both native modules need the app rebuilt (they're in this build). If Skia can't decode/allocate, save
 * throws and is surfaced as a toast with the original left intact.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Asset, type AssetMetadata } from 'expo-media-library';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { Canvas, Path, Skia, ImageFormat, PaintStyle, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Springy } from './motion';
import { palette, tint, radius, typography, tintFill, tintBorder, hairline, glowSm, space } from './theme';
import { assetUri } from './media';
import { useInsets } from './insets';
import { toast } from './Toast';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Ink palette (Apple's marker colours) + three nib widths.
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#111111'];
const WIDTHS = [4, 9, 16];

// Human-readable names so VoiceOver announces the ink/nib rather than a raw hex or pixel width.
const COLOR_NAMES: Record<string, string> = {
  '#ff3b30': 'Red',
  '#ffcc00': 'Yellow',
  '#34c759': 'Green',
  '#0a84ff': 'Blue',
  '#ffffff': 'White',
  '#111111': 'Black',
};
const NIB_NAMES: Record<number, string> = { 4: 'Thin', 9: 'Medium', 16: 'Thick' };

type Stroke = { d: string; color: string; width: number };

/** One committed or in-progress stroke as an SVG path string, drawn stroked with round caps/joins. */
function StrokePath({ d, color, width }: Stroke) {
  return <Path path={d} color={color} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" strokeMiter={1} />;
}

/**
 * Offscreen bake: full-res image + the strokes (scaled from canvas space to image space) → JPEG on
 * disk. Mirrors PhotoEditor's bakeTonal dispose discipline (each native buffer freed the moment it's
 * done) so back-to-back saves on a large photo don't spike native memory.
 */
async function bakeMarkup(uri: string, strokes: Stroke[], canvasW: number, canvasH: number, tag: number): Promise<string> {
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
  const canvas = surface.getCanvas();
  canvas.drawImageRect(img, Skia.XYWHRect(0, 0, w, h), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
  img.dispose();
  // Map canvas (display) coordinates → image pixels. The canvas matches the image aspect exactly, so a
  // single uniform scale is correct on both axes; the stroke width scales with it (thicker on the
  // bigger image, proportional to what the user drew).
  canvas.save();
  canvas.scale(w / canvasW, h / canvasH);
  for (const s of strokes) {
    const sk = Skia.Path.MakeFromSVGString(s.d);
    if (!sk) continue;
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(s.color));
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(s.width);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    canvas.drawPath(sk, paint);
    sk.dispose();
  }
  canvas.restore();
  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, 92);
  snapshot.dispose();
  surface.dispose();
  data.dispose();
  const out = new File(Paths.cache, `vintrace-markup-${tag}.jpg`);
  out.write(bytes);
  return out.uri;
}

export function Markup({
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
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [saving, setSaving] = useState(false);

  // Refs the (stable) gesture reads so drawing never re-creates the Pan handler on colour/width change.
  const currentRef = useRef('');
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  colorRef.current = color;
  widthRef.current = width;

  // Reset the annotation whenever the sheet opens on a (possibly new) photo.
  useEffect(() => {
    if (visible) {
      setStrokes([]);
      setCurrent('');
      currentRef.current = '';
    }
  }, [visible, asset?.id]);

  // Canvas sized to the image's exact aspect within the available area → strokes map 1:1 to pixels.
  const { cw, ch } = useMemo(() => {
    const iw = asset?.width && asset.width > 0 ? asset.width : 1;
    const ih = asset?.height && asset.height > 0 ? asset.height : 1;
    const availW = SCREEN_W - 24;
    const availH = SCREEN_H - insets.top - insets.bottom - 190; // header + toolbar reserve
    const scale = Math.min(availW / iw, availH / ih);
    return { cw: Math.max(1, Math.round(iw * scale)), ch: Math.max(1, Math.round(ih * scale)) };
  }, [asset?.width, asset?.height, insets.top, insets.bottom]);

  // A single Pan handler, forced onto the JS thread (runOnJS) so its callbacks can setState directly
  // without reanimated worklet plumbing. minDistance(0) starts the stroke on the very first touch.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => {
          currentRef.current = `M ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
          setCurrent(currentRef.current);
        })
        .onUpdate((e) => {
          currentRef.current += ` L ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
          setCurrent(currentRef.current);
        })
        .onEnd(() => {
          const d = currentRef.current;
          currentRef.current = '';
          setCurrent('');
          // Ignore a stray tap that never moved (needs at least one line segment to be a stroke).
          if (d.includes('L')) setStrokes((prev) => [...prev, { d, color: colorRef.current, width: widthRef.current }]);
        }),
    [],
  );

  const undo = useCallback(() => setStrokes((prev) => prev.slice(0, -1)), []);
  const clear = useCallback(() => {
    setStrokes([]);
    setCurrent('');
    currentRef.current = '';
  }, []);

  const save = useCallback(async () => {
    if (!asset || strokes.length === 0 || saving) return;
    setSaving(true);
    try {
      const info = await new Asset(asset.id).getInfo();
      if (!info?.uri || info.uri.startsWith('ph://')) {
        // iCloud-only original not downloaded locally — Skia can't read a ph:// identifier (matches
        // PhotoEditor's guard rather than silently failing the bake).
        toast({ text: 'Download this photo from iCloud first', tone: 'danger' });
        return;
      }
      // Normalize the original to an upright, Skia-decodable JPEG BEFORE baking — exactly what
      // PhotoEditor.bakeTonal / semantic.toDecodableJpeg / useOcrIndex all do. This: (a) transcodes
      // HEIC (the bulk of a real library, which Skia's codec can't decode) to JPEG, and (b) bakes EXIF
      // orientation into the pixels, so the JPEG's dims equal asset.width/height and the cw/ch stroke
      // scale is a single correct uniform mapping (a rotated original otherwise saves rotated + with
      // strokes misplaced/stretched).
      const ref = await ImageManipulator.manipulate(info.uri).renderAsync();
      const jpeg = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      const baked = await bakeMarkup(jpeg.uri, strokes, cw, ch, Date.now());
      await Asset.create(baked);
      toast({ text: 'Markup saved as a copy', tone: 'brand' });
      onSaved?.();
      onClose();
    } catch {
      toast({ text: 'Couldn’t save markup', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [asset, strokes, saving, cw, ch, onSaved, onClose]);

  const hasInk = strokes.length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.sm }]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <View style={styles.header}>
          <Springy onPress={onClose} hitSlop={12} accessibilityLabel="Cancel markup">
            <Text style={styles.headBtn} maxFontSizeMultiplier={1.3}>Cancel</Text>
          </Springy>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.3}>Markup</Text>
          <Springy
            onPress={save}
            disabled={!hasInk || saving}
            hitSlop={12}
            accessibilityLabel={saving ? 'Saving markup' : 'Save markup'}
            accessibilityState={{ disabled: !hasInk || saving, busy: saving }}
          >
            <Text style={[styles.headBtn, styles.save, (!hasInk || saving) && styles.disabled]} maxFontSizeMultiplier={1.3}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Springy>
        </View>

        <View style={styles.stage}>
          {/* expo-image renders the ph:// base reliably (Skia's useImage is flaky on ph://); a
              transparent Skia <Canvas> overlays the live strokes. The GestureDetector wraps the whole
              exact-aspect box, so touch (e.x,e.y) maps 1:1 to canvas — and to image pixels at bake. */}
          <GestureDetector gesture={pan}>
            <View
              style={{ width: cw, height: ch }}
              accessible
              accessibilityLabel="Drawing canvas over the photo"
              accessibilityHint="Drag with one finger to draw a stroke"
            >
              <Image
                source={{ uri: asset ? assetUri(asset.id) : undefined }}
                style={{ width: cw, height: ch }}
                contentFit="fill"
                accessibilityIgnoresInvertColors
              />
              <Canvas style={[styles.overlay, { width: cw, height: ch }]} pointerEvents="none">
                {strokes.map((s, i) => (
                  <StrokePath key={i} {...s} />
                ))}
                {current !== '' ? <StrokePath d={current} color={color} width={width} /> : null}
              </Canvas>
            </View>
          </GestureDetector>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.swatches}>
            {COLORS.map((c) => (
              <Springy
                key={c}
                onPress={() => setColor(c)}
                hitSlop={7}
                accessibilityLabel={`${COLOR_NAMES[c] ?? c} ink`}
                accessibilityState={{ selected: c === color }}
              >
                <View style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchOn, c === color && glowSm(c)]} />
              </Springy>
            ))}
          </View>
          <View style={styles.nibs}>
            {WIDTHS.map((w) => (
              <Springy
                key={w}
                onPress={() => setWidth(w)}
                hitSlop={6}
                accessibilityLabel={`${NIB_NAMES[w]} nib`}
                accessibilityState={{ selected: w === width }}
              >
                <View style={[styles.nib, w === width && styles.nibOn]}>
                  <View style={{ width: w + 2, height: w + 2, borderRadius: (w + 2) / 2, backgroundColor: palette.text }} />
                </View>
              </Springy>
            ))}
            <View style={styles.spacer} />
            <Springy onPress={undo} disabled={!hasInk} hitSlop={{ top: 13, bottom: 13, left: 10, right: 10 }} accessibilityLabel="Undo last stroke">
              <Text style={[styles.toolText, !hasInk && styles.disabledText]} maxFontSizeMultiplier={1.3}>Undo</Text>
            </Springy>
            <Springy onPress={clear} disabled={!hasInk} hitSlop={{ top: 13, bottom: 13, left: 10, right: 10 }} accessibilityLabel="Clear all strokes">
              <Text style={[styles.toolText, !hasInk && styles.disabledText]} maxFontSizeMultiplier={1.3}>Clear</Text>
            </Springy>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 8 },
  title: { color: palette.text, ...typography.sheetTitle },
  headBtn: { color: palette.sub, ...typography.body },
  save: { color: palette.cyan },
  disabled: { opacity: 0.35 },
  disabledText: { color: palette.muted },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0 },
  toolbar: { gap: space.lg, paddingHorizontal: 4, paddingTop: space.md },
  swatches: { flexDirection: 'row', gap: space.md, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2, borderColor: hairline },
  swatchOn: { borderColor: palette.text, transform: [{ scale: 1.12 }] },
  nibs: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  nib: {
    width: 40,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceHi,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nibOn: { borderColor: tint(palette.cyan, tintBorder.active), backgroundColor: tint(palette.cyan, tintFill.active), ...glowSm(palette.cyan) },
  spacer: { flex: 1 },
  toolText: { color: palette.cyanSoft, ...typography.body },
});
