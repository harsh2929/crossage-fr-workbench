/**
 * Full-screen photo viewer — tap a grid cell to zoom open, swipe horizontally between photos, pinch
 * to zoom, tap to toggle chrome, ⓘ for details, favorite, share, add-to-album, delete, ✦ for similar,
 * ✕ to dismiss. From the details panel, when a desktop is paired, "Recognize people" bridges to the
 * desktop oracle (the phone can't compute faces) and surfaces people + EXIF the local library lacks.
 *
 * Opens by growing from the tapped cell's rect (useZoomStage) and closes back toward it; chrome fades
 * over faked neutral scrims (ViewerChrome). Each page is a zoomable ScrollView (native iOS pinch-zoom
 * — no gesture library, no native rebuild) holding the photo at screen resolution.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  Share,
  Alert,
  Animated,
  StyleSheet,
  Dimensions,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Asset, MediaType, type AssetMetadata } from 'expo-media-library';
import { assetUri, formatDateTime, type CellRect } from './media';
import { palette, tint, radius, typography, tintFill, tintBorder, hairline } from './theme';
import { useInsets } from './insets';
import { Icon } from './Icon';
import { Springy, Reveal, RollingNumber, HeartPop, GradientButton, Loader } from './motion';
import { ViewerTopBar, ScrimPanel, useZoomStage } from './ViewerChrome';
import { toast } from './Toast';
import { loadDesktopConnection, getPhotoMeta, getPhotoText, setCaption, setRating, getPref, setPref, type PhotoMeta } from './replica';
import { AlbumPicker } from './AlbumPicker';
import { PhotoEditor } from './PhotoEditor';
import { Markup } from './Markup';
import { getSession, findDesktopTwin, analyzeDesktop, untrust, type DesktopPerson } from './desktop/client';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// A panorama = a ≥2:1 aspect in EITHER orientation — the same threshold the Albums "Panoramas" utility
// uses, so the viewer badge and that album agree. Guard unknown/zero dims.
const PANO_RATIO = 2;
const isPano = (item: AssetMetadata) => {
  const w = item.width ?? 0;
  const h = item.height ?? 0;
  return w > 0 && h > 0 && (w / h >= PANO_RATIO || h / w >= PANO_RATIO);
};

// Filmstrip scrubber geometry. A uniform per-thumb SLOT width (thumb + gap) keeps getItemLayout and
// the auto-centre scrollToIndex exact even for a 20k-photo library (the list still virtualizes).
const STRIP_THUMB = 46;
const STRIP_GAP = 6;
const STRIP_SLOT = STRIP_THUMB + STRIP_GAP;
const STRIP_H = 62; // strip row height — fits the enlarged active thumb (54pt) with breathing room
// Leading content-inset of the strip. getItemLayout offsets MUST include it (the list's
// contentContainerStyle adds this pad), or scrollToIndex/scrollToOffset centre ~20px off true centre.
const STRIP_PAD = 20;

// App-local alt text (a VoiceOver image description) + freeform keyword tags live in the prefs KV,
// keyed by external_id — Photos blocks third-party alt-text/keyword writes, so these stay app-local.
const altKey = (externalId: string) => `photo.alt.${externalId}`;
const kwKey = (externalId: string) => `photo.keywords.${externalId}`;

/** Parse a comma-separated keyword string into a trimmed, de-duplicated (case-insensitive) list. */
function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const k = part.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/** An image page: a native pinch-zoom ScrollView holding the photo, tap toggles chrome. When the
 *  current photo has an app-local image description, it becomes the Image's VoiceOver label.
 *  (A wide panorama is identified with a PANO badge, but still shown contain + pinch-to-explore: a
 *  horizontally-panning full-bleed pano would nest a horizontal scroller inside the horizontal photo
 *  pager, and reliably arbitrating those two gestures needs react-native-gesture-handler.) */
function ImagePage({
  item,
  altText,
  onToggleChrome,
  onZoomChange,
}: {
  item: AssetMetadata;
  altText?: string;
  onToggleChrome: () => void;
  /** Reports whether the page is pinch-zoomed in (drives the viewer's pinch-to-crop shortcut). */
  onZoomChange?: (zoomedIn: boolean) => void;
}) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      maximumZoomScale={3}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={onZoomChange ? (e) => onZoomChange(e.nativeEvent.zoomScale > 1.15) : undefined}
    >
      <Pressable
        onPress={onToggleChrome}
        accessibilityRole="image"
        accessibilityLabel={altText || (isPano(item) ? 'Panorama' : 'Photo')}
        accessibilityHint="Double tap to toggle controls"
      >
        <Image
          source={{ uri: assetUri(item.id) }}
          style={styles.pageImage}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={120}
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    </ScrollView>
  );
}

/** The video player, once its file uri has resolved. Only the active page plays; the rest pause
 *  (active already excludes the closing animation, so audio stops the instant dismissal begins).
 *  `loop` mirrors the persisted "viewer.loopVideos" toggle — seeded at creation and kept live. */
function VideoPlayerPage({ uri, active, loop }: { uri: string; active: boolean; loop: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
  });
  // Keep the player's loop flag in sync when the toggle flips while a video is on screen.
  useEffect(() => {
    player.loop = loop;
  }, [loop, player]);
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  return (
    <View style={[styles.page, styles.pageContent]}>
      <VideoView player={player} style={styles.pageImage} contentFit="contain" nativeControls />
    </View>
  );
}

/**
 * A video page: resolves the asset to a playable file uri (getInfo can be slow for iCloud/slow-mo),
 * showing the poster + a spinner meanwhile and an error+retry if it can't be fetched (e.g. an
 * iCloud-offloaded video with no network) — never a silent frozen frame.
 */
function VideoPage({ item, active, loop }: { item: AssetMetadata; active: boolean; loop: boolean }) {
  const [state, setState] = useState<{ status: 'resolving' | 'ready' | 'error'; uri?: string }>({ status: 'resolving' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'resolving' });
    new Asset(item.id)
      .getInfo()
      .then((info) => {
        if (!cancelled) setState(info.uri ? { status: 'ready', uri: info.uri } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, attempt]);

  if (state.status === 'ready' && state.uri) return <VideoPlayerPage uri={state.uri} active={active} loop={loop} />;
  return (
    <View style={[styles.page, styles.pageContent]}>
      <Image source={{ uri: assetUri(item.id) }} style={styles.pageImage} contentFit="contain" accessibilityIgnoresInvertColors />
      <View style={styles.videoOverlay} pointerEvents={state.status === 'error' ? 'auto' : 'none'}>
        {state.status === 'resolving' ? (
          <Loader label="Loading video…" color="#ffffff" />
        ) : (
          <View style={styles.videoErr}>
            <Text style={styles.videoErrText}>Couldn’t load this video — it may be in iCloud.</Text>
            <Springy onPress={() => setAttempt((a) => a + 1)} hitSlop={12} style={styles.videoRetry} accessibilityLabel="Retry loading video">
              <Text style={styles.videoRetryText}>Retry</Text>
            </Springy>
          </View>
        )}
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Compact EXIF/place rows from the desktop oracle's loose metadata (guard + untrust every field). */
function oracleMetaRows(meta: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!meta) return [];
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const s = untrust(v);
    if (s) rows.push({ label, value: s });
  };
  push('Camera', meta.camera ?? meta.cameraModel ?? meta.model);
  push('Place', meta.place ?? meta.location ?? meta.city);
  push('Aperture', meta.aperture ?? meta.fNumber);
  push('ISO', meta.iso ?? meta.isoSpeed);
  return rows;
}

/**
 * The bottom filmstrip scrubber (Apple-Photos style): a thin, virtualized horizontal strip of
 * thumbnails. The active photo is highlighted — an accent ring plus a larger, fully-opaque frame while
 * neighbours dim, so the cue survives colour-blindness / Smart-Invert (shape + opacity, not hue alone).
 * Tapping a thumb jumps the main pager via `onJump`; the strip re-centres on the active thumb whenever
 * the visible photo changes (tap or swipe). It's rendered inside the bottom chrome, so it hides/shows
 * with the chrome and never covers the photo, and is omitted while the info panel is open.
 */
function FilmstripScrubber({
  assets,
  current,
  onJump,
}: {
  assets: AssetMetadata[];
  current: number;
  onJump: (i: number) => void;
}) {
  const ref = useRef<FlatList<AssetMetadata>>(null);
  // Re-centre the active thumb when the visible photo changes (tap, swipe, or a shrinking set). Guarded
  // + deferred a tick so a not-yet-measured index can't throw; a later change re-centres if it does.
  useEffect(() => {
    if (current < 0 || current >= assets.length) return;
    const id = setTimeout(() => {
      try {
        ref.current?.scrollToIndex({ index: current, animated: true, viewPosition: 0.5 });
      } catch {
        /* index off-screen and unmeasured — the next change re-centres it */
      }
    }, 0);
    return () => clearTimeout(id);
  }, [current, assets.length]);

  const renderThumb = useCallback(
    ({ item, index: i }: ListRenderItemInfo<AssetMetadata>) => {
      const active = i === current;
      const isVid = item.mediaType === MediaType.VIDEO;
      return (
        <Springy
          onPress={() => onJump(i)}
          scaleTo={0.9}
          pressableStyle={styles.stripSlot}
          style={[styles.stripThumb, active && styles.stripThumbOn]}
          accessibilityLabel={`Photo ${i + 1}${isVid ? ', video' : ''}`}
          accessibilityState={{ selected: active }}
        >
          <Image
            source={{ uri: assetUri(item.id) }}
            style={styles.stripImg}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={80}
            accessibilityIgnoresInvertColors
          />
          {isVid ? (
            <View pointerEvents="none" style={styles.stripVid}>
              <View style={styles.stripTri} />
            </View>
          ) : null}
        </Springy>
      );
    },
    [current, onJump],
  );

  if (assets.length === 0) return null;
  return (
    <FlatList
      ref={ref}
      data={assets}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyExtractor={(it) => it.id}
      renderItem={renderThumb}
      getItemLayout={(_, i) => ({ length: STRIP_SLOT, offset: STRIP_PAD + STRIP_SLOT * i, index: i })}
      initialScrollIndex={current < assets.length ? current : 0}
      initialNumToRender={12}
      windowSize={5}
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      onScrollToIndexFailed={({ index }) => {
        ref.current?.scrollToOffset({ offset: STRIP_PAD + STRIP_SLOT * index, animated: false });
      }}
    />
  );
}

type Recog =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; people: DesktopPerson[]; meta: Record<string, unknown> | null }
  | { status: 'error'; error: string };

export function PhotoDetail({
  assets,
  index,
  originRect,
  onClose,
  onFindSimilar,
  onToggleFavorite,
  onDeleteAssets,
  onRated,
  onKeyworded,
  onEdited,
}: {
  assets: AssetMetadata[];
  index: number | null;
  originRect?: CellRect | null;
  onClose: () => void;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  /** Called after an app-local star-rating change (rating is not written to PhotoKit, so this is the
      only signal a rating-derived grid gets to refresh its membership). */
  onRated?: () => void;
  /** Called after an app-local keyword edit, so a keyword-derived grid (Library's chips) can refresh. */
  onKeyworded?: () => void;
  /** Called after the editor saves a new copy, so the host can re-ingest the library. */
  onEdited?: () => void;
}) {
  const [current, setCurrent] = useState(index ?? 0);
  const [chrome, setChrome] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [closing, setClosing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [markup, setMarkup] = useState(false);
  // Pinch-to-crop shortcut: true while the current page is pinch-zoomed in, which surfaces a "Crop this
  // view" pill that jumps straight into the editor's crop mode. Reset on every page change (each page's
  // zoom resets when you swipe away).
  const [zoomed, setZoomed] = useState(false);
  // Persisted "loop videos" preference — restored on mount, threaded into every VideoPlayerPage.
  const [loopVideos, setLoopVideos] = useState(false);
  const [recog, setRecog] = useState<Recog>({ status: 'idle' });
  // App-local caption + star rating for the visible photo (kept in sync with the replica below).
  const [meta, setMeta] = useState<PhotoMeta>({ caption: null, rating: 0 });
  // The on-device OCR / Live-Text recognized inside the visible photo (null when none / not indexed).
  const [ocrText, setOcrText] = useState<string | null>(null);
  // App-local alt text (VoiceOver image description) + freeform keyword tags for the visible photo.
  // The alt text also feeds the live image's accessibilityLabel, so it's kept current on every swipe.
  const [altText, setAltText] = useState<string>('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const listRef = useRef<FlatList<AssetMetadata>>(null);
  const insets = useInsets();
  const { stageStyle, backdropOpacity, requestClose } = useZoomStage(originRect);
  // Whether a desktop is paired (sync replica read, once) — gates the "Recognize people" bridge.
  const [conn] = useState(() => {
    try {
      return loadDesktopConnection();
    } catch {
      return null;
    }
  });

  // Restore the persisted loop-videos toggle once on mount ('1' = on, anything else = off).
  useEffect(() => {
    try {
      setLoopVideos(getPref('viewer.loopVideos') === '1');
    } catch {
      /* default off */
    }
  }, []);

  // Flip + persist the loop-videos toggle (a live VideoPlayerPage picks the change up at once).
  const toggleLoop = () => {
    const next = !loopVideos;
    setLoopVideos(next);
    try {
      setPref('viewer.loopVideos', next ? '1' : '0');
    } catch {
      /* best-effort local write */
    }
  };

  const close = useCallback(() => {
    setClosing(true);
    requestClose(onClose);
  }, [requestClose, onClose]);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setCurrent(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
  }, []);

  // Jump the main pager to a filmstrip thumb. Set `current` up front so the counter/strip follow at
  // once; the pager's momentum-end lands on the same i, so there's no desync. getItemLayout on the
  // pager makes scrollToIndex reliable (the try/catch just swallows a rare pre-measure throw).
  const jumpTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= assets.length) return;
      setCurrent(i);
      try {
        listRef.current?.scrollToIndex({ index: i, animated: true });
      } catch {
        /* getItemLayout keeps this from failing; ignore if it ever does */
      }
    },
    [assets.length],
  );

  // Recognition is per-photo — reset it when the visible photo changes. Videos keep chrome visible
  // (their native controls capture taps, so the tap-to-toggle affordance isn't reachable on them).
  useEffect(() => {
    setRecog({ status: 'idle' });
    if (assets[current]?.mediaType === MediaType.VIDEO) setChrome(true);
  }, [current, assets]);

  // Load the app-local meta for the visible photo whenever the info panel is shown or the current
  // photo changes. useLayoutEffect (before paint) so the previous photo's stars/caption/description
  // never flash on the new photo when swiping.
  useLayoutEffect(() => {
    const id = assets[current]?.id;
    if (!id) return;
    // Alt text stays current on EVERY swipe (not gated on the panel): it drives the live image's
    // accessibilityLabel, so a stale description must never read onto the next photo.
    try {
      setAltText(getPref(altKey(id)) ?? '');
    } catch {
      setAltText('');
    }
    // Caption/rating/OCR + keywords only feed the info panel, so load them lazily when it's shown.
    if (!showInfo) return;
    try {
      setMeta(getPhotoMeta(id));
    } catch {
      setMeta({ caption: null, rating: 0 });
    }
    try {
      setOcrText(getPhotoText(id));
    } catch {
      setOcrText(null);
    }
    try {
      const raw = getPref(kwKey(id));
      const parsed = raw ? JSON.parse(raw) : [];
      setKeywords(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      setKeywords([]);
    }
  }, [showInfo, current, assets]);

  // If the underlying set shrinks while open (un-favorite under a Favorites filter, delete, etc.),
  // keep `current` in range so the counter/chrome don't desync; dismiss if nothing remains.
  useEffect(() => {
    if (index === null) return;
    if (assets.length === 0) {
      onClose();
      return;
    }
    setCurrent((c) => (c > assets.length - 1 ? assets.length - 1 : c));
  }, [assets.length, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderItem = useCallback(
    ({ item, index: i }: ListRenderItemInfo<AssetMetadata>) =>
      item.mediaType === MediaType.VIDEO ? (
        <VideoPage item={item} active={i === current && !closing} loop={loopVideos} />
      ) : (
        <ImagePage
          item={item}
          altText={i === current ? altText : undefined}
          onToggleChrome={() => setChrome((c) => !c)}
          onZoomChange={i === current ? setZoomed : undefined}
        />
      ),
    [current, closing, altText, loopVideos],
  );

  // Each page's pinch-zoom resets when you swipe away, so drop the pinch-to-crop pill on page change.
  useEffect(() => {
    setZoomed(false);
  }, [current]);

  if (index === null) return null;
  const asset = assets[current];
  const isVideo = asset?.mediaType === MediaType.VIDEO;
  const megapixels = asset?.width && asset?.height ? (asset.width * asset.height) / 1_000_000 : null;

  const share = async () => {
    if (!asset) return;
    try {
      const info = await (new Asset(asset.id) as unknown as { getInfo: () => Promise<{ uri?: string; localUri?: string }> }).getInfo();
      const url = info?.localUri || info?.uri;
      if (url) await Share.share({ url });
    } catch {
      /* sharing is best-effort */
    }
  };

  const del = async () => {
    if (!onDeleteAssets || !asset) return;
    const ok = await onDeleteAssets([asset.id]); // iOS system confirm; App fires the toast
    if (ok) close();
  };

  // Duplicate the current photo: re-import its underlying file as a brand-new library asset (a copy).
  // Images only (hidden for videos). Guarded like the editor — an iCloud-only asset has no readable
  // local file path, so ask to download it first. The copy gets a fresh capture date (PhotoKit doesn't
  // preserve capture metadata on re-import) — acceptable for a quick duplicate. The grid refreshes via
  // the same onEdited bridge the editor uses (re-ingests the library).
  const duplicate = async () => {
    if (!asset) return;
    const src = new Asset(asset.id);
    try {
      // getInfo() THROWS for an iCloud-only asset (no local file to export), so ask up front — this is
      // the actionable case that would otherwise fall to the generic "Couldn't duplicate" below.
      if (await src.getIsInCloud()) {
        toast({ text: 'Download from iCloud first', tone: 'danger' });
        return;
      }
      const info = await src.getInfo();
      if (!info.uri) return;
      await Asset.create(info.uri); // creates a NEW library asset (copy) from the original's file
      toast({ text: 'Duplicated — pull to refresh', tone: 'brand' });
      onEdited?.();
    } catch {
      toast({ text: 'Couldn’t duplicate', tone: 'danger' });
    }
  };

  // --- Recognize people (desktop oracle bridge) -----------------------------------------------
  const recognize = async () => {
    if (!conn || !asset) return;
    setRecog({ status: 'loading' });
    try {
      const base = conn.base;
      await getSession(base); // confirm the saved session cookie still authorizes
      const twin = await findDesktopTwin(base, { filename: asset.filename, width: asset.width, height: asset.height });
      if (!twin) {
        setRecog({ status: 'done', people: [], meta: null });
        return;
      }
      const r = await analyzeDesktop(base, twin.assetId);
      setRecog({ status: 'done', people: r.people, meta: r.meta });
    } catch (e) {
      setRecog({ status: 'error', error: String(e).replace('Error: ', '').slice(0, 140) });
    }
  };

  const metaRows = recog.status === 'done' ? oracleMetaRows(recog.meta) : [];

  // --- App-local rating + caption (stored in the replica, keyed by external_id) ----------------
  // Set the rating directly (no toggle). Persist + reflect locally. Used by both the tap path (via
  // onRate) and the VoiceOver increment/decrement path — the latter MUST NOT toggle, or an "increment"
  // at 5 (which clamps back to 5) would look like a re-tap and wipe the rating to 0.
  const setRatingTo = (next: number) => {
    if (!asset || next === meta.rating) return;
    setMeta((m) => ({ ...m, rating: next }));
    try {
      setRating(asset.id, next);
      onRated?.(); // let a rating-derived grid (Library's "Rated") re-resolve its membership
    } catch {
      /* best-effort local write */
    }
  };
  // Tapping a star sets that rating; tapping the current rating clears it (toggle-off).
  const onRate = (star: number) => setRatingTo(meta.rating === star ? 0 : star);

  // Edit the caption via the iOS text prompt (guarded — Alert.prompt is iOS-only), seeded with the
  // current caption. On submit, persist to the replica and update local state.
  const editCaption = () => {
    if (!asset) return;
    const id = asset.id;
    Alert.prompt?.(
      'Caption',
      'Stored in this app only (Photos blocks third-party caption writes).',
      (text: string) => {
        const value = text ?? '';
        setMeta((m) => ({ ...m, caption: value.trim() === '' ? null : value }));
        try {
          setCaption(id, value);
        } catch {
          /* best-effort local write */
        }
      },
      'plain-text',
      meta.caption ?? '',
    );
  };

  // Edit the app-local alt text / image description via the iOS text prompt (guarded — Alert.prompt is
  // iOS-only), seeded with the current value. On submit, persist to the prefs KV and update local state;
  // the new value flows straight into the live image's accessibilityLabel for VoiceOver.
  const editAlt = () => {
    if (!asset) return;
    const id = asset.id;
    Alert.prompt?.(
      'Image Description',
      'Read aloud by VoiceOver. Stored in this app only.',
      (text: string) => {
        const value = (text ?? '').trim();
        setAltText(value);
        try {
          setPref(altKey(id), value);
        } catch {
          /* best-effort local write */
        }
      },
      'plain-text',
      altText,
    );
  };

  // Edit the app-local keywords via the iOS text prompt (guarded), seeded with the current comma-joined
  // list. On submit, parse into a trimmed/de-duped list, persist as a JSON array, and update local state.
  const editKeywords = () => {
    if (!asset) return;
    const id = asset.id;
    Alert.prompt?.(
      'Keywords',
      'Comma-separated tags, stored in this app only.',
      (text: string) => {
        const list = parseKeywords(text ?? '');
        setKeywords(list);
        try {
          setPref(kwKey(id), JSON.stringify(list));
          onKeyworded?.(); // let a keyword-derived grid (Library's chips) re-resolve its index
        } catch {
          /* best-effort local write */
        }
      },
      'plain-text',
      keywords.join(', '),
    );
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root} accessibilityViewIsModal onAccessibilityEscape={close}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: backdropOpacity }]} />
        <Animated.View style={[styles.stage, stageStyle]}>
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
        </Animated.View>

        <Reveal visible={chrome && !closing} style={styles.chromeTop}>
          <ViewerTopBar
            onClose={close}
            center={
              <View style={styles.counterRow} accessible accessibilityRole="header" accessibilityLabel={`Photo ${current + 1} of ${assets.length}`}>
                <RollingNumber value={current + 1} fontSize={15} style={styles.counterText} />
                <Text style={styles.counterText} allowFontScaling={false}> / {assets.length}</Text>
              </View>
            }
            right={
              <>
                {onToggleFavorite && asset ? (
                  <Springy
                    onPress={() => onToggleFavorite(asset.id, !asset.isFavorite)}
                    hitSlop={12}
                    style={styles.iconBtn}
                    accessibilityLabel={asset.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    accessibilityState={{ selected: !!asset.isFavorite }}
                  >
                    <HeartPop active={!!asset.isFavorite} size={24} />
                  </Springy>
                ) : null}
                {!isVideo ? (
                  <Springy onPress={() => setEditing(true)} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Edit photo">
                    <Icon name="sliders" size={20} color="#ffffff" />
                  </Springy>
                ) : null}
                {!isVideo ? (
                  <Springy onPress={() => setMarkup(true)} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Markup photo">
                    <Text style={styles.markupGlyph} allowFontScaling={false}>✏️</Text>
                  </Springy>
                ) : null}
                {isVideo ? (
                  <Springy
                    onPress={toggleLoop}
                    hitSlop={12}
                    style={styles.iconBtn}
                    accessibilityLabel={loopVideos ? 'Turn off video looping' : 'Loop video'}
                    accessibilityState={{ selected: loopVideos }}
                  >
                    <Text style={[styles.loopGlyph, loopVideos && styles.loopGlyphOn]} allowFontScaling={false}>↻</Text>
                  </Springy>
                ) : null}
                <Springy
                  onPress={() => setShowInfo((s) => !s)}
                  hitSlop={12}
                  style={styles.iconBtn}
                  accessibilityLabel="Details"
                  accessibilityState={{ expanded: showInfo }}
                >
                  <Icon name="info" size={22} color={showInfo ? palette.accentSoft : '#ffffff'} />
                </Springy>
              </>
            }
          />
        </Reveal>

        {asset && !isVideo && isPano(asset) ? (
          <Reveal visible={chrome && !closing} style={[styles.panoBadgeWrap, { top: insets.top + 60 }]}>
            <View style={styles.panoBadge} accessible accessibilityLabel="Panorama">
              <View style={styles.panoGlyph} />
              <Text style={styles.panoBadgeText}>PANO</Text>
            </View>
          </Reveal>
        ) : null}

        {asset ? (
          <Reveal visible={chrome && !closing} style={styles.chromeBottom}>
            <ScrimPanel height={showInfo ? 360 : assets.length > 1 ? 300 : 200}>
              {!showInfo && assets.length > 1 ? (
                <FilmstripScrubber assets={assets} current={current} onJump={jumpTo} />
              ) : null}
              {showInfo ? (
                <ScrollView style={styles.infoScroll} showsVerticalScrollIndicator={false}>
                  <Text style={styles.infoTitle} numberOfLines={1}>
                    {asset.filename ?? 'Photo'}
                  </Text>
                  {asset.creationTime ? <InfoRow label="Taken" value={formatDateTime(asset.creationTime)} /> : null}
                  {asset.width && asset.height ? (
                    <InfoRow
                      label="Dimensions"
                      value={`${asset.width} × ${asset.height}${megapixels ? `  ·  ${megapixels.toFixed(1)} MP` : ''}`}
                    />
                  ) : null}
                  {isVideo && asset.duration ? (
                    <InfoRow
                      label="Duration"
                      value={(() => {
                        const s = Math.round(asset.duration / 1000); // AssetMetadata.duration is milliseconds
                        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                      })()}
                    />
                  ) : null}
                  <InfoRow label="Favorite" value={asset.isFavorite ? 'Yes' : 'No'} />

                  <View style={styles.appMetaBlock}>
                    <View style={styles.ratingRow}>
                      <Text style={styles.infoLabel}>Rating</Text>
                      <View
                        style={styles.stars}
                        // `accessible` is REQUIRED on a plain View for VoiceOver to focus it — unlike
                        // Pressable/Springy, a View does NOT imply it from the other a11y props, so
                        // without this the adjustable role + actions below are unreachable.
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel="Rating"
                        accessibilityValue={{ text: meta.rating ? `${meta.rating} of 5 stars` : 'Not rated' }}
                        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                        // Route through setRatingTo (NOT onRate) so a clamped "increment" at 5 doesn't
                        // read as a re-tap on the set star and toggle the rating off to 0.
                        onAccessibilityAction={(e) => {
                          if (e.nativeEvent.actionName === 'increment') setRatingTo(Math.min(5, meta.rating + 1));
                          else if (e.nativeEvent.actionName === 'decrement') setRatingTo(Math.max(0, meta.rating - 1));
                        }}
                      >
                        {[1, 2, 3, 4, 5].map((n) => {
                          const on = meta.rating >= n;
                          return (
                            <Pressable key={n} onPress={() => onRate(n)} hitSlop={12}>
                              <Text style={[styles.star, on ? styles.starOn : styles.starOff]} maxFontSizeMultiplier={1.3}>
                                {on ? '★' : '☆'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.captionHeader}>
                      <Text style={styles.infoLabel}>Caption</Text>
                      <Pressable
                        onPress={editCaption}
                        hitSlop={14}
                        accessibilityRole="button"
                        accessibilityLabel={meta.caption ? 'Edit caption' : 'Add caption'}
                      >
                        <Text style={styles.captionAction}>{meta.caption ? 'Edit' : 'Add'}</Text>
                      </Pressable>
                    </View>
                    {meta.caption ? (
                      <Text style={styles.captionText}>{meta.caption}</Text>
                    ) : (
                      <Text style={styles.captionEmpty}>No caption</Text>
                    )}

                    <View style={styles.captionHeader}>
                      <Text style={styles.infoLabel}>Image Description</Text>
                      <Pressable
                        onPress={editAlt}
                        hitSlop={14}
                        accessibilityRole="button"
                        accessibilityLabel={altText ? 'Edit image description' : 'Add image description'}
                      >
                        <Text style={styles.captionAction}>{altText ? 'Edit' : 'Add'}</Text>
                      </Pressable>
                    </View>
                    {altText ? (
                      <Text style={styles.captionText}>{altText}</Text>
                    ) : (
                      <Text style={styles.captionEmpty}>No description</Text>
                    )}

                    <View style={styles.captionHeader}>
                      <Text style={styles.infoLabel}>Keywords</Text>
                      <Pressable
                        onPress={editKeywords}
                        hitSlop={14}
                        accessibilityRole="button"
                        accessibilityLabel={keywords.length ? 'Edit keywords' : 'Add keywords'}
                      >
                        <Text style={styles.captionAction}>{keywords.length ? 'Edit' : 'Add'}</Text>
                      </Pressable>
                    </View>
                    {keywords.length ? (
                      <View style={styles.kwChips}>
                        {keywords.map((k, i) => (
                          <View key={`${k}-${i}`} style={styles.kwChip}>
                            <Text style={styles.kwChipText}>{k}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.captionEmpty}>No keywords</Text>
                    )}
                  </View>

                  {ocrText ? (
                    <View style={styles.ocrBlock}>
                      <Text style={styles.infoLabel}>Text in this photo</Text>
                      <Text style={styles.ocrText} selectable>
                        {ocrText}
                      </Text>
                    </View>
                  ) : null}

                  {conn ? (
                    <View style={styles.recogBlock}>
                      {recog.status === 'idle' ? (
                        <GradientButton
                          label="✦ Recognize people"
                          tone="desktop"
                          onPress={recognize}
                          style={styles.recogBtn}
                          accessibilityHint="Uses your paired desktop to find faces in this photo"
                        />
                      ) : null}
                      {recog.status === 'loading' ? <Loader label="Asking the desktop…" color={palette.cyan} /> : null}
                      {recog.status === 'error' ? <Text style={styles.recogErr}>Couldn’t reach the desktop — {recog.error}</Text> : null}
                      {recog.status === 'done' ? (
                        <>
                          <Text style={styles.sectionLabel}>People · {recog.people.length}</Text>
                          {recog.people.length === 0 ? (
                            <Text style={styles.recogNote}>No desktop match found for this photo.</Text>
                          ) : (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                              {recog.people.map((p, i) => (
                                <View key={`${p.candidateId}-${i}`} style={styles.personChip}>
                                  <Text style={styles.personName}>{p.personName || 'Unnamed'}</Text>
                                  {p.band ? <Text style={styles.personBand}>{p.band}</Text> : null}
                                </View>
                              ))}
                            </ScrollView>
                          )}
                          {metaRows.map((r) => (
                            <InfoRow key={r.label} label={r.label} value={r.value} />
                          ))}
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </ScrollView>
              ) : (
                <View style={styles.bottomBar}>
                  <View style={styles.bottomInfo}>
                    <Text style={styles.filename} numberOfLines={1}>
                      {asset.filename ?? 'Photo'}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {asset.width && asset.height ? `${asset.width} × ${asset.height}` : ''}
                      {asset.creationTime ? `  ·  ${formatDateTime(asset.creationTime)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.actions}>
                    {onFindSimilar && !isVideo ? (
                      <Springy
                        style={styles.similarPill}
                        onPress={() => {
                          onFindSimilar(asset.id);
                          close();
                        }}
                        hitSlop={6}
                        accessibilityLabel="Find similar photos"
                      >
                        <Icon name="spark" size={15} color="#ffffff" />
                        <Text style={styles.similarText}>Similar</Text>
                      </Springy>
                    ) : null}
                    <Springy onPress={() => setPicker(true)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Add to album">
                      <Icon name="stack" size={18} color="#ffffff" />
                    </Springy>
                    {!isVideo ? (
                      <Springy onPress={duplicate} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Duplicate photo">
                        {/* Copy glyph — two offset outlined squares, built from Views like the Icon vocabulary. */}
                        <View style={styles.dupGlyph}>
                          <View style={[styles.dupSq, styles.dupSqBack]} />
                          <View style={[styles.dupSq, styles.dupSqFront]} />
                        </View>
                      </Springy>
                    ) : null}
                    <Springy onPress={share} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Share">
                      <Icon name="share" size={18} color="#ffffff" />
                    </Springy>
                    {onDeleteAssets ? (
                      <Springy onPress={del} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Delete photo">
                        <Icon name="trash" size={18} color={palette.danger} />
                      </Springy>
                    ) : null}
                  </View>
                </View>
              )}
            </ScrimPanel>
          </Reveal>
        ) : null}

        <AlbumPicker visible={picker} assetIds={asset ? [asset.id] : []} onClose={() => setPicker(false)} />
        {/* Pinch-to-crop shortcut: appears while the photo is pinch-zoomed in, jumping straight into the
            editor's crop mode (which opens on 'crop'). Hidden for video and while a sheet is already up. */}
        {zoomed && !isVideo && !editing && !markup && !closing && !showInfo ? (
          <View pointerEvents="box-none" style={styles.cropHintWrap}>
            <Springy
              onPress={() => {
                setZoomed(false);
                setEditing(true);
              }}
              pressableStyle={styles.cropHint}
              accessibilityLabel="Crop this view"
              accessibilityHint="Opens the editor's crop mode"
            >
              <View style={styles.cropHintInner}>
                <Icon name="sliders" size={15} color="#ffffff" />
                <Text style={styles.cropHintText}>Crop this view</Text>
              </View>
            </Springy>
          </View>
        ) : null}

        <PhotoEditor visible={editing} asset={asset ?? null} onClose={() => setEditing(false)} onSaved={onEdited} />
        <Markup visible={markup} asset={asset ?? null} onClose={() => setMarkup(false)} onSaved={onEdited} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  stage: { flex: 1 },
  page: { width: SCREEN_W, height: SCREEN_H },
  pageContent: { width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center' },
  pageImage: { width: SCREEN_W, height: SCREEN_H },
  // Panorama page: height-filled image (dynamic width added inline) inside a horizontal scroller.
  videoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  videoErr: { alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  videoErrText: { ...typography.body, color: '#ffffff', textAlign: 'center' },
  videoRetry: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 10 },
  videoRetryText: { ...typography.body, color: '#ffffff' },

  chromeTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  chromeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  markupGlyph: { fontSize: 19 },
  cropHintWrap: { position: 'absolute', left: 0, right: 0, bottom: 140, alignItems: 'center' },
  cropHint: {
    backgroundColor: tint(palette.surface, 0.92),
    borderColor: tint(palette.accent, 0.45),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cropHintInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cropHintText: { ...typography.cardTitle, color: palette.text },
  // Loop-videos toggle glyph (top bar, video pages only) — tintable Unicode, accent-tinted when on.
  loopGlyph: { color: '#ffffff', fontSize: 23, fontWeight: '600', lineHeight: 27 },
  loopGlyphOn: { color: palette.accentSoft },
  counterRow: { flexDirection: 'row', alignItems: 'center' },
  counterText: { ...typography.body, color: '#ffffff', fontVariant: ['tabular-nums'] },

  // "PANO" badge — a small pill just below the top bar, shown only on a panorama page and hidden with
  // the chrome (content-sized so only the pill, not the full-width strip, intercepts a chrome-toggle tap).
  panoBadgeWrap: { position: 'absolute', left: 12 },
  panoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderColor: tint(palette.accent, 0.55),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  panoGlyph: { width: 18, height: 9, borderRadius: 2, borderWidth: 1.5, borderColor: '#ffffff' },
  panoBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },

  // Filmstrip scrubber — bleeds edge-to-edge (cancels the panel's 20pt inset) while the content keeps
  // that inset so the first/last thumb aligns with the bar above it. Sits just over the action bar.
  strip: { height: STRIP_H, marginHorizontal: -20, marginBottom: 12 },
  stripContent: { alignItems: 'center', paddingHorizontal: STRIP_PAD },
  stripSlot: { width: STRIP_SLOT, height: STRIP_H, alignItems: 'center', justifyContent: 'center' },
  stripThumb: {
    width: STRIP_THUMB,
    height: STRIP_THUMB,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent', // reserves the ring space so activating a thumb doesn't shift the image
    opacity: 0.5,
    backgroundColor: palette.cell,
  },
  // Active cue = accent ring + a larger, opaque frame (shape + opacity, legible without colour).
  stripThumbOn: { width: STRIP_THUMB + 4, height: STRIP_THUMB + 8, borderColor: palette.accent, opacity: 1 },
  stripImg: { width: '100%', height: '100%' },
  stripVid: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stripTri: {
    width: 0,
    height: 0,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderLeftWidth: 5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#ffffff',
    marginLeft: 1,
  },

  bottomBar: { flexDirection: 'row', alignItems: 'center' },
  bottomInfo: { flex: 1, marginRight: 10 },
  filename: { ...typography.cardTitle, color: '#ffffff' },
  meta: { color: palette.accentSoft, fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  similarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: tint(palette.accent, 0.92),
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  similarText: { ...typography.body, color: '#ffffff' },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  // "Duplicate" copy glyph — two offset outlined rounded squares (front faintly filled for depth).
  dupGlyph: { width: 18, height: 18 },
  dupSq: { position: 'absolute', width: 11, height: 11, borderWidth: 2, borderColor: '#ffffff', borderRadius: 3 },
  dupSqBack: { top: 0, left: 0 },
  dupSqFront: { right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.16)' },

  infoScroll: { maxHeight: 300 },
  infoTitle: { ...typography.sheetTitle, color: '#ffffff', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 16 },
  infoLabel: { ...typography.meta, color: palette.muted },
  infoValue: { ...typography.body, color: '#ffffff', fontVariant: ['tabular-nums'], flexShrink: 1 },

  appMetaBlock: { marginTop: 12, paddingTop: 12, borderTopColor: hairline, borderTopWidth: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 16 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  star: { fontSize: 22, lineHeight: 26 },
  starOn: { color: '#fbbf24' },
  starOff: { color: palette.muted },
  captionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, marginTop: 2 },
  captionAction: { ...typography.body, color: palette.accentSoft },
  captionText: { ...typography.body, color: '#ffffff', marginTop: 2, marginBottom: 4 },
  captionEmpty: { ...typography.body, color: palette.sub, marginTop: 2, marginBottom: 4, fontStyle: 'italic' },
  kwChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 4 },
  kwChip: {
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kwChipText: { ...typography.meta, color: palette.text, fontWeight: '700' },

  ocrBlock: { marginTop: 14, paddingTop: 12, borderTopColor: hairline, borderTopWidth: 1 },
  ocrText: { ...typography.body, color: '#e5e7eb', marginTop: 6 },
  recogBlock: { marginTop: 14, paddingTop: 12, borderTopColor: hairline, borderTopWidth: 1 },
  recogBtn: { alignSelf: 'flex-start', minWidth: 200 },
  recogErr: { color: palette.danger, fontSize: 13 },
  recogNote: { color: palette.sub, fontSize: 13, marginTop: 4 },
  sectionLabel: { ...typography.kicker, color: palette.cyan, marginBottom: 8 },
  chips: { gap: 8, paddingBottom: 10 },
  personChip: {
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  personName: { ...typography.body, color: palette.text },
  personBand: { ...typography.caption, color: palette.cyan, marginTop: 2 },
});
