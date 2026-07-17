/**
 * Library — the whole camera roll, newest first, read from the encrypted on-device replica.
 *
 * Also the management surface: a "Select" mode turns cell taps into multi-select, with a bottom
 * action bar to batch-favorite (write-through to PhotoKit) or delete (via the iOS system prompt).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { View, Text, StyleSheet, FlatList, ScrollView, Animated, Modal, Pressable } from 'react-native';
import { type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType, type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, EmptyState, palette, assetUri } from '../ui';
import { DateScrubber } from '../DateScrubber';
import { ScreenHeader } from '../Header';
import { Springy, Reveal, RollingNumber } from '../motion';
import { Icon } from '../Icon';
import { grad, tint, radius, glow, hairline, tintFill, tintBorder, glowSm, typography } from '../theme';
import { MemoriesCarousel, type MemoryGroup } from '../Memories';
import { Segmented } from '../fields';
import { CoachCard } from '../CoachCard';
import { AlbumPicker } from '../AlbumPicker';
import { loadDeviceAlbums, albumAssetIdSet } from '../albums';
import { getPref, setPref, ratedExternalIds, keywordIndex } from '../replica';

const DENSITIES = [3, 4, 5, 7]; // grid columns the density control cycles through

// The compact toolbar pills sit ~30pt tall; this slop lifts every one to the 44pt touch minimum.
// VERTICAL-ONLY on purpose: the pills sit 8pt apart, so any horizontal slop (6+6 > 8) would make
// neighbouring touch targets overlap and misroute edge taps — the same reason the Segmented segments
// use vertical-only slop. The pills are already ~44pt WIDE (paddingHorizontal:12 + icon + label).
const TB_HITSLOP = { top: 8, bottom: 8 };

// Time-scope pyramid (Apple Photos' Years/Months/All zoom). ALL is the flat grid; MONTHS/YEARS group
// the current filtered/sorted set by calendar period into drill-in rows.
type Scope = 'all' | 'months' | 'years';
const SCOPES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'months', label: 'Months' },
  { key: 'years', label: 'Years' },
];

// Library filter (Apple Photos' All / Photos / Videos / Favorites). Applied to `assets` BEFORE the
// time-scope buckets / density / sort / selection, so every downstream surface sees the same subset.
// Videos are real now (assets carry a mediaType), so Photos/Videos is a meaningful split.
type Filter = 'all' | 'photos' | 'videos' | 'favorites' | 'rated';
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'rated', label: 'Rated' },
];

// Zero-state copy per non-"all" filter (an "all" library that holds any asset is never empty here).
const FILTER_EMPTY: Record<Exclude<Filter, 'all'>, { glyph: string; orbColor: string; title: string; subtitle: string }> = {
  photos: { glyph: '🖼️', orbColor: palette.accent, title: 'No photos', subtitle: 'Photos on this device will appear here.' },
  videos: { glyph: '🎬', orbColor: palette.accent, title: 'No videos', subtitle: 'Videos in your library will show up here.' },
  favorites: { glyph: '♡', orbColor: palette.pink, title: 'No favorites yet', subtitle: 'Tap the heart on a photo to add it to Favorites.' },
  rated: { glyph: '⭐', orbColor: palette.accent, title: 'No rated photos', subtitle: 'Give a photo a star rating in the viewer to see it here.' },
};

// Hermes Intl can ignore { month:'long' } and return a locale-default date; format from a constant
// (the same reason Memories.tsx keeps its own month array).
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** expo-media-library reports creationTime in ms; tolerate seconds just in case. */
function toMs(raw: number | null): number {
  if (!raw) return 0;
  return raw > 0 && raw < 1e11 ? raw * 1000 : raw;
}

/** Strip the `ph://` scheme so ids from the roll compare equal to album membership (mirrors albums.norm). */
function normId(id: string): string {
  return id.replace(/^ph:\/\//, '');
}

/** A calendar bucket (a month or a year) of assets, drilled into as its own scoped grid. */
interface Period {
  key: string;
  title: string; // "July 2026" (months) or "2026" (years)
  items: AssetMetadata[];
  cover?: AssetMetadata;
}

/** A tappable period row: cover thumbnail + "Month Year" / "Year" + photo count → drills into its grid. */
function PeriodRow({ period, onPress }: { period: Period; onPress: () => void }) {
  const n = period.items.length;
  return (
    <Springy
      onPress={onPress}
      scaleTo={0.97}
      pressableStyle={styles.periodRow}
      accessibilityLabel={`${period.title}, ${n} photo${n === 1 ? '' : 's'}`}
      accessibilityHint="Opens this period"
    >
      {period.cover ? (
        <Image
          source={{ uri: assetUri(period.cover.id) }}
          style={styles.periodCover}
          recyclingKey={period.cover.id}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={180}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.periodCover, styles.periodCoverEmpty]} />
      )}
      <View style={styles.periodText}>
        <Text style={styles.periodTitle} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {period.title}
        </Text>
        <Text style={styles.periodMeta} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {n.toLocaleString()} photo{n === 1 ? '' : 's'}
        </Text>
      </View>
      <Icon name="chevron" size={14} color={palette.muted} />
    </Springy>
  );
}

export function LibraryScreen({
  assets,
  loadMs,
  onFindSimilar,
  onToggleFavorite,
  onFavoriteAssets,
  onDeleteAssets,
  onHideAssets,
  onRefresh,
  onNavigate,
}: {
  assets: AssetMetadata[];
  loadMs: number | null;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onFavoriteAssets?: (ids: string[], next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  onHideAssets?: (ids: string[], hidden: boolean) => void;
  onRefresh?: () => void | Promise<void>;
  onNavigate?: (tab: 'library' | 'search' | 'albums' | 'desktop') => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState<MemoryGroup | null>(null);
  // Grid view controls (density / sort / filter) — the Apple Photos View-Options analogue.
  const [cols, setCols] = useState(4);
  // Bumped whenever a star rating changes in the viewer (ratings are app-local — no PhotoKit event — so
  // this is the only signal the rating-derived "Rated" filter gets). Folded into the rated set + gridKey.
  const [ratingsVersion, setRatingsVersion] = useState(0);
  // Same idea for app-local keyword edits (also prefs-only, no PhotoKit event) — bumped from the viewer
  // so the keyword index + chips + filtered grid re-resolve after a keyword is added/removed in-app.
  const [keywordsVersion, setKeywordsVersion] = useState(0);
  const [sortDesc, setSortDesc] = useState(true); // true = newest first (date captured)
  // Library filter (All / Photos / Videos / Favorites) — restored from prefs, persisted on change.
  const [filter, setFilter] = useState<Filter>(() => {
    const v = getPref('library.filter');
    return v === 'photos' || v === 'videos' || v === 'favorites' || v === 'rated' ? v : 'all';
  });
  // Library exclusion (Apple's View Options): hide the device "Screenshots" smart-album from the whole
  // Library. Restored from prefs; the members are loaded lazily below into `screenshotIds`.
  const [hideScreenshots, setHideScreenshots] = useState<boolean>(() => getPref('library.hideScreenshots') === '1');
  // Normalized PHAsset ids of the Screenshots smart album, or null until the native lookup resolves.
  // While null we exclude NOTHING (show all) rather than flash the grid as members load.
  const [screenshotIds, setScreenshotIds] = useState<Set<string> | null>(null);
  const [aspectGrid, setAspectGrid] = useState(false); // square grid vs aspect-ratio (masonry) grid
  const [picker, setPicker] = useState(false);
  // "More" overflow menu (Apple's grid "···"): a compact sheet that gathers the view controls we
  // already own (layout / sort / hide-screenshots) plus Select. Transient UI state, no persistence.
  const [moreOpen, setMoreOpen] = useState(false);
  // Time-scope pyramid: ALL (flat grid) / MONTHS / YEARS, plus the drilled-in period (mirrors `memory`).
  const [scope, setScope] = useState<Scope>('all');
  // Store only the drilled period's KEY; the items are derived live from `periods` so a delete/edit
  // upstream keeps the drilled grid + viewer in sync (a captured snapshot would go stale).
  const [openPeriodKey, setOpenPeriodKey] = useState<string | null>(null);
  // Keyword browse (Apple Photos): the chosen app-local keyword LABEL, or null = off. Only selectable in
  // the flat 'all' scope; cleared when leaving it (changeScope) so Months/Years never filter invisibly.
  const [keywordFilter, setKeywordFilter] = useState<string | null>(null);

  // The rated set (app-local star ratings from the replica), resolved only when the Rated filter is
  // active. Keyed on ratingsVersion so an in-viewer rating change re-resolves it — ratings write only to
  // the replica (no PhotoKit event), so `assets` alone would never signal the change.
  const ratedIds = useMemo(
    () => (filter === 'rated' ? ratedExternalIds() : null),
    [filter, assets, ratingsVersion],
  );

  // The app-local keyword index (Apple Photos keyword browse), recomputed when the library reloads.
  // `keywords` are display labels (most-used first); `byKeyword` maps a lowercased label -> external_ids.
  const keywordIdx = useMemo(() => keywordIndex(), [assets, keywordsVersion]);

  // Apply the media-type/favorites filter + sort. `assets` arrive newest-first (created_at desc), so
  // desc is a no-op copy. The filter runs FIRST, so the scope buckets, density, and selection all see
  // exactly the same subset that feeds the grid.
  const view = useMemo(() => {
    let base: AssetMetadata[];
    if (filter === 'videos') base = assets.filter((a) => a.mediaType === MediaType.VIDEO);
    else if (filter === 'photos') base = assets.filter((a) => a.mediaType !== MediaType.VIDEO);
    else if (filter === 'favorites') base = assets.filter((a) => a.isFavorite);
    else if (filter === 'rated') base = assets.filter((a) => !!ratedIds && ratedIds.has(a.id));
    else base = assets;
    // View Options: drop Screenshots smart-album members (normalized ph:// match), but only once the
    // membership has loaded — until then `screenshotIds` is null and we leave the library untouched.
    if (hideScreenshots && screenshotIds && screenshotIds.size > 0) {
      base = base.filter((a) => !screenshotIds.has(normId(a.id)));
    }
    // Keyword browse (Apple Photos): narrow to photos carrying the chosen app-local keyword. Composed
    // AFTER the media/favorites/rated filter + the screenshot exclusion, so it intersects them. The
    // index holds external_ids, which equal `a.id` (same convention as the rated filter above).
    if (keywordFilter) {
      const ids = keywordIdx.byKeyword.get(keywordFilter.toLowerCase());
      base = ids ? base.filter((a) => ids.has(a.id)) : [];
    }
    return sortDesc ? base : [...base].reverse();
  }, [assets, filter, ratedIds, sortDesc, hideScreenshots, screenshotIds, keywordFilter, keywordIdx]);

  // Load the Screenshots smart-album membership the first time we need it (native, guarded, cancelled
  // on unmount). Fetched once and cached; toggling the exclusion off/on afterwards is instant.
  useEffect(() => {
    if (!hideScreenshots || screenshotIds) return;
    let alive = true;
    (async () => {
      const albums = await loadDeviceAlbums();
      const shot =
        albums.find((a) => a.title === 'Screenshots') ??
        albums.find((a) => a.smart && /screenshot/i.test(a.title));
      const set = shot ? await albumAssetIdSet(shot.id) : new Set<string>();
      if (alive) setScreenshotIds(set);
    })();
    return () => {
      alive = false;
    };
  }, [hideScreenshots, screenshotIds]);
  const cycleDensity = () => setCols((c) => DENSITIES[(DENSITIES.indexOf(c) + 1) % DENSITIES.length]);
  // Pinch-to-zoom grid density (Apple's Zoom In/Out). A two-finger pinch steps through DENSITIES: a
  // SPREAD (scale > 1) zooms IN to bigger tiles (fewer columns, index down); a PINCH (scale < 1) zooms
  // OUT (more columns, index up). Two-finger gesture-handler Pinch coexists with the FlashList's
  // one-finger scroll without arbitration — the plain PanResponder that made this un-shippable before
  // hijacked scroll; this doesn't. Snaps once on END so density changes by at most one step per pinch.
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onEnd((e) => {
          if (e.scale > 1.2) setCols((c) => (DENSITIES.indexOf(c) > 0 ? DENSITIES[DENSITIES.indexOf(c) - 1] : c));
          else if (e.scale < 0.83) setCols((c) => (DENSITIES.indexOf(c) < DENSITIES.length - 1 ? DENSITIES[DENSITIES.indexOf(c) + 1] : c));
        }),
    [],
  );

  // Fast-scrub month index for the flat grid: the first `view` index of each distinct capture-month,
  // in the view's order. The DateScrubber maps a drag position to one of these and jumps the grid there.
  const gridRef = useRef<FlashListRef<AssetMetadata>>(null);
  // The scrubber only becomes touchable once the grid ROWS (not the header's Coach/Memories carousels)
  // are under the right edge — otherwise its full-height overlay would hijack taps/swipes on the
  // peeking Memories card at the top of the tab. We drive that off the grid's scroll offset.
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerHRef = useRef(0);
  const [scrubActive, setScrubActive] = useState(false);
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const active = value > Math.max(60, headerHRef.current - 40);
      setScrubActive((prev) => (prev === active ? prev : active));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);
  const scrubMonths = useMemo(() => {
    const out: { label: string; firstIndex: number }[] = [];
    let lastKey = '';
    for (let i = 0; i < view.length; i++) {
      const ms = toMs(view[i].creationTime);
      const key = ms ? `${new Date(ms).getFullYear()}-${new Date(ms).getMonth()}` : 'undated';
      if (key !== lastKey) {
        lastKey = key;
        const d = ms ? new Date(ms) : null;
        out.push({ label: d ? `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` : 'Undated', firstIndex: i });
      }
    }
    return out;
  }, [view]);

  // Group the (already filtered/sorted) view into month or year buckets, preserving the view's order.
  // Undated photos fall into a single "Undated" bucket so period counts always reconcile with the grid.
  const periods = useMemo<Period[]>(() => {
    if (scope === 'all') return [];
    const map = new Map<string, Period>();
    for (const a of view) {
      const ms = toMs(a.creationTime);
      let key: string;
      let title: string;
      if (!ms) {
        key = 'undated';
        title = 'Undated';
      } else {
        const d = new Date(ms);
        if (scope === 'years') {
          key = `y${d.getFullYear()}`;
          title = String(d.getFullYear());
        } else {
          key = `m${d.getFullYear()}-${d.getMonth()}`;
          title = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        }
      }
      const bucket = map.get(key);
      if (bucket) bucket.items.push(a);
      else map.set(key, { key, title, items: [a], cover: a });
    }
    return [...map.values()];
  }, [view, scope]);

  // Live drilled period (derived, not snapshotted) — undefined once its photos are all gone.
  const openPeriod = openPeriodKey ? periods.find((p) => p.key === openPeriodKey) ?? null : null;

  const changeScope = (k: string) => {
    setScope(k as Scope);
    setOpenPeriodKey(null);
    if (k !== 'all') setKeywordFilter(null); // keyword browse is an 'all'-scope-only dimension
  };
  // The time-scope "zoom" is now a single cycling pill (All → Months → Years → All) instead of a
  // full-width Segmented that read as a confusing twin of the filter row. Reuses changeScope so the
  // openPeriodKey / keywordFilter resets still fire.
  const cycleScope = () => changeScope(SCOPES[(SCOPES.findIndex((s) => s.key === scope) + 1) % SCOPES.length].key);
  const scopeLabel = SCOPES.find((s) => s.key === scope)?.label ?? 'All';
  const changeFilter = (k: string) => {
    const f = k as Filter;
    setFilter(f);
    setOpenPeriodKey(null); // the underlying set changed — drop any drilled-in period
    setPref('library.filter', f);
  };
  // Pull-to-refresh also drops the Screenshots membership cache so a newly-taken/deleted screenshot is
  // re-resolved (the lazy load fires once per mount otherwise, going stale as the library changes).
  const handleRefresh = useCallback(async () => {
    setScreenshotIds(null);
    await onRefresh?.();
  }, [onRefresh]);

  const changeHideScreenshots = (next: boolean) => {
    setHideScreenshots(next);
    setOpenPeriodKey(null); // the underlying set changed — drop any drilled-in period
    setPref('library.hideScreenshots', next ? '1' : '0');
  };
  // The one gesture the empty-state offers to escape a filtered-to-nothing view: undo every exclusion.
  const clearFilters = () => {
    if (hideScreenshots) changeHideScreenshots(false);
    if (filter !== 'all') changeFilter('all');
    if (keywordFilter) setKeywordFilter(null);
  };

  // True only while the exclusion is genuinely removing photos (toggle on AND members loaded). Folded
  // into the grid key so the grid remounts when exclusion flips, and used to pick the empty-state copy.
  const excluding = hideScreenshots && !!screenshotIds && screenshotIds.size > 0;

  // Every input below composes the grid's key, and a key change fully remounts the FlashList to
  // scroll-offset 0 (pinch-to-zoom density is the natural mid-scroll trigger). A remount emits no
  // scroll event, and scrollY is parent-owned, so without this it keeps its stale pre-remount value —
  // leaving `scrubActive` true and stranding the fast-scrub overlay (visible + touchable) over the
  // header carousels. setValue notifies the scrollY listener, so scrubActive recomputes to false to
  // match the fresh top-of-list position.
  useEffect(() => {
    scrollY.setValue(0);
  }, [cols, aspectGrid, filter, sortDesc, excluding, ratingsVersion, keywordFilter, keywordsVersion, scrollY]);

  const canSelect = !!(onFavoriteAssets || onDeleteAssets || onHideAssets);
  const count = selected.size;
  const allSelected = view.length > 0 && count === view.length;

  const exit = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(view.map((a) => a.id)));
  // Invert the selection over the CURRENTLY VISIBLE set (Apple's Invert Selection): every unselected
  // visible photo becomes selected and vice-versa.
  const invert = () => setSelected(new Set(view.filter((a) => !selected.has(a.id)).map((a) => a.id)));
  const ids = [...selected];

  // Reveal keeps the bar mounted; it fades + settles in only once something is picked.
  const barVisible = selecting && count > 0;
  // Zero-state copy for the active filter (only rendered when the filtered view comes back empty; an
  // "all" library with any assets never does, so the "all" branch is just a type-safe fallback).
  const emptyMeta = filter === 'all' ? FILTER_EMPTY.photos : FILTER_EMPTY[filter];

  // A drilled-in memory ("On This Day" / "Recent favorites") — its own grid under a gradient header.
  if (memory) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={memory.title}
          meta={memory.subtitle}
          gradient={memory.gradient}
          back={{ label: 'Library', onPress: () => setMemory(null) }}
        />
        {memory.items.length === 0 ? (
          <EmptyState orb glyph="✨" title="Nothing here" subtitle="This memory has no photos." />
        ) : (
          <PhotoGrid
            data={memory.items}
            gridKey={`memory:${memory.key}`}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
          />
        )}
      </View>
    );
  }

  // A drilled-in time period (a Month or a Year) — its own grid under a gradient header (mirrors memory).
  if (openPeriod) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={openPeriod.title}
          meta={`${openPeriod.items.length.toLocaleString()} photo${openPeriod.items.length === 1 ? '' : 's'}`}
          gradient={grad.brand}
          back={{ label: 'Library', onPress: () => setOpenPeriodKey(null) }}
        />
        <PhotoGrid
          data={openPeriod.items}
          // Fold `excluding` in like the flat grid: openPeriod derives from the filtered `periods`, so
          // its items shrink when Screenshots membership resolves — the key must remount FlashList then.
          gridKey={`period:${openPeriod.key}:${excluding ? 'nos' : 'all'}`}
          cols={cols}
          onFindSimilar={onFindSimilar}
          onToggleFavorite={onToggleFavorite}
          onDeleteAssets={onDeleteAssets}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={selecting ? 'Select photos' : 'Library'}
        // Kicker carries identity instead of echoing the title ("Your library" over "Library"): a
        // privacy signal that also folds in the old "encrypted replica" meaning without the jargon.
        kicker={selecting ? undefined : 'Private · on device'}
        gradient={grad.brand}
        // scrollY drives ScreenHeader's built-in collapse-large-title (title dims/shrinks + gradient
        // parallax as the grid scrolls up) — the component supported it all along; Library just never
        // passed the value. Photos-first, with the vivid gradient fully intact.
        scrollY={scrollY}
        meta={
          selecting
            ? undefined
            : // Just the count — the load-timer "· 49 ms" was leaked instrumentation (it changed every
              // reload, making the header look janky) and is now DEV-only.
              `${assets.length.toLocaleString()} photos${__DEV__ && loadMs != null ? ` · ${loadMs} ms` : ''}`
        }
        right={
          canSelect && view.length > 0 && scope === 'all' ? (
            selecting ? (
              <View style={styles.hdrRight}>
                {count > 0 ? (
                  <View style={styles.countChip} accessible accessibilityLabel={`${count} selected`}>
                    <Icon name="check" size={11} color={palette.accentSoft} strokeWidth={2} />
                    {/* RollingNumber for the live selected count — ScreenHeader's title/meta are
                        string-only, so the animated readout lives here in the ReactNode right slot. */}
                    <RollingNumber value={count} fontSize={14} style={styles.countText} />
                  </View>
                ) : null}
                <Springy
                  onPress={toggleAll}
                  hitSlop={8}
                  accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}
                  accessibilityState={{ selected: allSelected }}
                >
                  <View style={[styles.hdrDisc, allSelected && styles.hdrDiscOn]}>
                    <Icon name="check" size={15} color={allSelected ? '#ffffff' : palette.accentSoft} strokeWidth={2} />
                  </View>
                </Springy>
                {count > 0 && !allSelected ? (
                  <Springy onPress={invert} hitSlop={{ top: 12, bottom: 12 }} accessibilityLabel="Invert selection">
                    <Text style={styles.selectBtn}>Invert</Text>
                  </Springy>
                ) : null}
                <Springy onPress={exit} hitSlop={{ top: 12, bottom: 12 }} accessibilityLabel="Cancel selection">
                  <Text style={styles.selectBtn}>Cancel</Text>
                </Springy>
              </View>
            ) : (
              <Springy
                onPress={() => setSelecting(true)}
                hitSlop={{ top: 12, bottom: 12 }}
                accessibilityLabel="Select photos"
                accessibilityHint="Turns on multi-select"
              >
                <Text style={styles.selectBtn}>Select</Text>
              </Springy>
            )
          ) : null
        }
      />

      {!selecting && assets.length > 0 ? (
        <>
          <View style={styles.filterRow}>
            {/* Primary content filter (media/favorites/rated). When Favorites is active the whole
                control glows PINK — the favorites hue — so the bar carries the meaning of its selection. */}
            <Segmented
              options={FILTERS}
              value={filter}
              onChange={changeFilter}
              accent={filter === 'favorites' ? palette.pink : palette.accent}
            />
          </View>
          {/* Row 2 — one tight, left-aligned cluster of view controls, down from THREE separate rows
              (scope Segmented + sort/aspect/density toolbar + hide-screenshots). Scope-zoom + Sort
              always show; Density is flat-grid-only; the ••• overflow is ALWAYS present so the
              library-wide Hide-Screenshots (which now lives only in its sheet) stays reachable in the
              Months/Years scopes too. */}
          <View style={styles.toolbar}>
            <Springy
              onPress={cycleScope}
              pressableStyle={[styles.tbtn, scope !== 'all' && styles.tbtnOnAccent]}
              hitSlop={TB_HITSLOP}
              accessibilityLabel={`Time scope, ${scopeLabel}`}
              accessibilityHint="Cycles the grid between all photos, months, and years"
              accessibilityState={{ selected: scope !== 'all' }}
            >
              <Icon name="stack" size={14} color={scope !== 'all' ? palette.text : palette.accentSoft} />
              <Text style={[styles.tbtnText, scope !== 'all' && { color: palette.text }]} maxFontSizeMultiplier={1.3}>{scopeLabel}</Text>
            </Springy>
            <Springy
              onPress={() => setSortDesc((s) => !s)}
              pressableStyle={styles.tbtn}
              hitSlop={TB_HITSLOP}
              accessibilityLabel={sortDesc ? 'Sorted newest first' : 'Sorted oldest first'}
              accessibilityHint="Switches sort order"
            >
              <Icon name="chevron" size={12} color={palette.accentSoft} style={{ transform: [{ rotate: sortDesc ? '90deg' : '-90deg' }] }} />
              <Text style={styles.tbtnText} maxFontSizeMultiplier={1.3}>{sortDesc ? 'Newest' : 'Oldest'}</Text>
            </Springy>
            {scope === 'all' ? (
              <Springy
                onPress={cycleDensity}
                pressableStyle={styles.tbtn}
                hitSlop={TB_HITSLOP}
                accessibilityLabel={`Grid density, ${cols} columns`}
                accessibilityHint="Cycles the number of columns"
              >
                <Icon name="grid" size={14} color={palette.accentSoft} />
                <Text style={styles.tbtnText} maxFontSizeMultiplier={1.3}>{cols}</Text>
              </Springy>
            ) : null}
            {/* Overflow "···" — grid layout / hide screenshots / density / select. ALWAYS present. */}
            <Springy
              onPress={() => setMoreOpen(true)}
              pressableStyle={styles.tbtn}
              hitSlop={TB_HITSLOP}
              accessibilityLabel="More options"
              accessibilityHint="Opens layout, hide-screenshots, density, and select options"
            >
              <Text allowFontScaling={false} style={styles.moreDots}>•••</Text>
            </Springy>
          </View>
          {/* Keyword browse (Apple Photos): a horizontal chip row of the library's app-local keywords,
              most-used first. Only in the flat scope and only when the library actually carries keywords
              (most don't, so this renders nothing then). Tapping a chip filters; tapping it again clears. */}
          {scope === 'all' && keywordIdx.keywords.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.keywordChips}
            >
              {keywordIdx.keywords.map((kw) => {
                const on = keywordFilter === kw;
                return (
                  <Springy
                    key={kw}
                    onPress={() => setKeywordFilter((c) => (c === kw ? null : kw))}
                    pressableStyle={[styles.tbtn, on && styles.keywordChipOn]}
                    hitSlop={TB_HITSLOP}
                    accessibilityLabel={on ? `Clear keyword ${kw}` : `Filter by keyword ${kw}`}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.tbtnText, on && styles.keywordChipTextOn]} maxFontSizeMultiplier={1.3}>{kw}</Text>
                  </Springy>
                );
              })}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {assets.length === 0 ? (
        <EmptyState
          orb
          glyph="🖼️"
          orbColor={palette.accent}
          title="Your library is empty"
          subtitle="Photos on this device will appear here, newest first."
        />
      ) : view.length === 0 ? (
        keywordFilter ? (
          // The chosen keyword matched nothing under the current filters — offer a one-tap way back.
          <EmptyState
            orb
            glyph="🔖"
            orbColor={palette.accent}
            title={`No photos for “${keywordFilter}”`}
            subtitle="No photos match this keyword with your current filters."
            action={
              <Springy onPress={() => setKeywordFilter(null)} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }} accessibilityLabel="Clear keyword">
                <Text style={styles.selectBtn}>Clear keyword</Text>
              </Springy>
            }
          />
        ) : hideScreenshots && filter === 'all' ? (
          // Every photo here is a screenshot and the exclusion swallowed them all — offer the way back.
          <EmptyState
            orb
            glyph="🖼️"
            orbColor={palette.accent}
            title="Screenshots hidden"
            subtitle="Your library is only screenshots right now, and they're hidden from view."
            action={
              <Springy onPress={() => changeHideScreenshots(false)} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }} accessibilityLabel="Show screenshots">
                <Text style={styles.selectBtn}>Show screenshots</Text>
              </Springy>
            }
          />
        ) : (
          <EmptyState
            orb
            glyph={emptyMeta.glyph}
            orbColor={emptyMeta.orbColor}
            title={emptyMeta.title}
            subtitle={emptyMeta.subtitle}
            action={
              <Springy onPress={clearFilters} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }} accessibilityLabel="Show all photos">
                <Text style={styles.selectBtn}>Show all</Text>
              </Springy>
            }
          />
        )
      ) : scope !== 'all' ? (
        <FlatList
          // Remount per scope/filter/result-set so rows re-enter cleanly and don't recycle stale covers.
          key={`periods:${scope}:${sortDesc ? 'd' : 'a'}:${filter}:${excluding ? 'nos' : 'all'}`}
          data={periods}
          keyExtractor={(p) => p.key}
          renderItem={({ item }) => <PeriodRow period={item} onPress={() => setOpenPeriodKey(item.key)} />}
          contentContainerStyle={styles.periodList}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <GestureDetector gesture={pinch}>
        <View style={styles.gridWrap}>
          <PhotoGrid
            data={view}
            gridKey={`library:${cols}:${sortDesc ? 'd' : 'a'}:${filter}:${aspectGrid ? 'asp' : 'sq'}:${excluding ? 'nos' : 'all'}:r${ratingsVersion}:k${keywordFilter ?? ''}:kv${keywordsVersion}`}
            cols={cols}
            aspectGrid={aspectGrid}
            listRef={gridRef}
            scrollY={scrollY}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
            onRated={() => setRatingsVersion((v) => v + 1)}
            onKeyworded={() => setKeywordsVersion((v) => v + 1)}
            onRefresh={handleRefresh}
            ListHeaderComponent={
              !selecting ? (
                <View onLayout={(e) => (headerHRef.current = e.nativeEvent.layout.height)}>
                  <CoachCard onNavigate={onNavigate ?? (() => {})} />
                  <MemoriesCarousel assets={assets} onOpen={setMemory} />
                </View>
              ) : null
            }
            selection={canSelect ? { active: selecting, selected, onToggle: toggle } : undefined}
          />
          {/* Fast-scrub handle — only when there are enough months to fly through, not while selecting.
              Wrapper is box-none/none-gated so it captures ONLY once scrolled into the grid rows (never
              over the header carousels), and fades out when inactive so the handle isn't stranded on the
              Memories card at the top. */}
          {!selecting && scrubMonths.length > 3 && (
            <View
              pointerEvents={scrubActive ? 'box-none' : 'none'}
              // opacity:0 alone leaves the scrubber focusable by VoiceOver — remove it from the a11y
              // tree while inactive (scrolling is a redundant path, so no capability is lost).
              accessibilityElementsHidden={!scrubActive}
              importantForAccessibility={scrubActive ? 'auto' : 'no-hide-descendants'}
              style={[styles.scrubGate, { opacity: scrubActive ? 1 : 0 }]}
            >
              <DateScrubber
                count={scrubMonths.length}
                labelAt={(i) => scrubMonths[i]?.label ?? ''}
                onScrubTo={(i) => {
                  const target = scrubMonths[i];
                  if (target) gridRef.current?.scrollToIndex({ index: target.firstIndex, animated: false });
                }}
              />
            </View>
          )}
        </View>
        </GestureDetector>
      )}

      <Reveal visible={barVisible} style={styles.actionBar}>
        <View style={styles.actionRow}>
          {onFavoriteAssets ? (
            <Springy
              pressableStyle={styles.action}
              onPress={() => {
                onFavoriteAssets(ids, true);
                exit();
              }}
              accessibilityLabel={`Favorite ${count} photo${count === 1 ? '' : 's'}`}
            >
              <View style={styles.actionInner}>
                <Icon name="heartFill" size={18} color={palette.pink} />
                <Text style={[styles.actionText, styles.favTint]}>Favorite</Text>
                <RollingNumber value={count} fontSize={15} style={[styles.actionText, styles.favTint]} />
              </View>
            </Springy>
          ) : null}
          {onFavoriteAssets ? <View style={styles.divider} /> : null}
          <Springy
            pressableStyle={styles.action}
            onPress={() => setPicker(true)}
            accessibilityLabel={`Add ${count} photo${count === 1 ? '' : 's'} to album`}
          >
            <View style={styles.actionInner}>
              <Icon name="stack" size={18} color={palette.accentSoft} />
              <Text style={[styles.actionText, styles.addTint]}>Add</Text>
              <RollingNumber value={count} fontSize={15} style={[styles.actionText, styles.addTint]} />
            </View>
          </Springy>
          {onHideAssets ? <View style={styles.divider} /> : null}
          {onHideAssets ? (
            <Springy
              pressableStyle={styles.action}
              onPress={() => {
                onHideAssets(ids, true);
                exit();
              }}
              accessibilityLabel={`Hide ${count} photo${count === 1 ? '' : 's'}`}
              accessibilityHint="Moves them to the Hidden album; they leave your library"
            >
              <View style={styles.actionInner}>
                <Icon name="eyeOff" size={18} color={palette.sub} />
                <Text style={styles.actionText}>Hide</Text>
                <RollingNumber value={count} fontSize={15} style={styles.actionText} />
              </View>
            </Springy>
          ) : null}
          {onDeleteAssets ? <View style={styles.divider} /> : null}
          {onDeleteAssets ? (
            <Springy
              pressableStyle={styles.action}
              onPress={async () => {
                const ok = await onDeleteAssets(ids);
                if (ok) exit();
              }}
              accessibilityLabel={`Delete ${count} photo${count === 1 ? '' : 's'}`}
            >
              <View style={styles.actionInner}>
                <Icon name="trash" size={18} color={palette.danger} />
                <Text style={[styles.actionText, styles.deleteTint]}>Delete</Text>
                <RollingNumber value={count} fontSize={15} style={[styles.actionText, styles.deleteTint]} />
              </View>
            </Springy>
          ) : null}
        </View>
      </Reveal>

      <AlbumPicker visible={picker} assetIds={ids} onClose={() => setPicker(false)} onAdded={exit} />

      {/* "More" overflow (Apple's grid "···") — a compact bottom sheet gathering the existing view
          controls into one menu. Every row just flips state we already own + closes; it introduces no
          new behavior. Mirrors the AlbumPicker Modal (transparent fade + tap-out backdrop + a11y-modal
          card with onAccessibilityEscape). Anchored to the bottom so it reads as an action menu. */}
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMoreOpen(false)} accessibilityLabel="Close menu">
          <Pressable style={styles.sheet} onPress={() => {}} accessibilityViewIsModal onAccessibilityEscape={() => setMoreOpen(false)}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle} accessibilityRole="header">Options</Text>
            {/* Grid layout (Square/Aspect) is meaningful only for the flat grid — the Months/Years
                period LIST doesn't tile — so this row is gated to the 'all' scope. */}
            {scope === 'all' ? (
              <Springy
                onPress={() => {
                  setAspectGrid((a) => !a);
                  setMoreOpen(false);
                }}
                pressableStyle={styles.menuRow}
                // Label the CURRENT state (agrees with accessibilityState.selected + the visible value);
                // the ACTION goes in the hint. Previously it announced the inverse of what was shown.
                accessibilityLabel={aspectGrid ? 'Aspect-ratio grid' : 'Square grid'}
                accessibilityHint="Switches the grid layout"
                accessibilityState={{ selected: aspectGrid }}
              >
                <Icon name="stack" size={18} color={aspectGrid ? palette.accent : palette.sub} />
                <Text style={styles.menuLabel}>Grid layout</Text>
                <Text style={[styles.menuValue, aspectGrid && { color: palette.accent }]}>{aspectGrid ? 'Aspect' : 'Square'}</Text>
              </Springy>
            ) : null}
            <Springy
              onPress={() => {
                cycleDensity();
                setMoreOpen(false);
              }}
              pressableStyle={styles.menuRow}
              accessibilityLabel={`Grid density, ${cols} columns`}
              accessibilityHint="Cycles the number of columns"
            >
              <Icon name="grid" size={18} color={palette.sub} />
              <Text style={styles.menuLabel}>Grid density</Text>
              <Text style={styles.menuValue}>{cols}</Text>
            </Springy>
            <Springy
              onPress={() => {
                setSortDesc((s) => !s);
                setMoreOpen(false);
              }}
              pressableStyle={styles.menuRow}
              accessibilityLabel={sortDesc ? 'Sorted newest first' : 'Sorted oldest first'}
              accessibilityHint="Switches sort order"
            >
              <Icon name="chevron" size={16} color={palette.sub} style={{ transform: [{ rotate: sortDesc ? '90deg' : '-90deg' }] }} />
              <Text style={styles.menuLabel}>Sort by date</Text>
              <Text style={styles.menuValue}>{sortDesc ? 'Newest' : 'Oldest'}</Text>
            </Springy>
            <Springy
              onPress={() => {
                changeHideScreenshots(!hideScreenshots);
                setMoreOpen(false);
              }}
              pressableStyle={styles.menuRow}
              // Label the current state (agrees with accessibilityState.selected); action is the hint.
              accessibilityLabel={hideScreenshots ? 'Screenshots hidden' : 'Hide screenshots'}
              accessibilityHint="Hides screenshots from your library"
              accessibilityState={{ selected: hideScreenshots }}
            >
              {/* Violet "on" state — pink is reserved for Favorites, so no other control borrows that hue. */}
              <Icon name="eyeOff" size={18} color={hideScreenshots ? palette.accent : palette.sub} />
              <Text style={styles.menuLabel}>Hide screenshots</Text>
              {hideScreenshots ? <Icon name="check" size={14} color={palette.accent} strokeWidth={2} /> : null}
            </Springy>
            {/* Select is gated to the flat 'all' scope, exactly like the header's Select cluster —
                the Months/Years period LIST has no per-row selection and its header shows no Cancel,
                so offering Select there would strand the user in select mode with no way out. */}
            {canSelect && view.length > 0 && scope === 'all' ? (
              <Springy
                onPress={() => {
                  setSelecting(true);
                  setMoreOpen(false);
                }}
                pressableStyle={styles.menuRow}
                accessibilityLabel="Select photos"
                accessibilityHint="Turns on multi-select"
              >
                <Icon name="check" size={18} color={palette.sub} />
                <Text style={styles.menuLabel}>Select photos</Text>
              </Springy>
            ) : null}
            <Springy onPress={() => setMoreOpen(false)} pressableStyle={styles.sheetCancel} accessibilityLabel="Close">
              <Text style={styles.sheetCancelText}>Done</Text>
            </Springy>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  gridWrap: { flex: 1 },
  scrubGate: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  selectBtn: { color: palette.accent, fontSize: 16, fontWeight: '700' },

  // Library filter (All / Photos / Videos / Favorites / Rated) — the primary content control, row 1.
  filterRow: { paddingHorizontal: 16, paddingBottom: 8 },

  // Row 2 — the single view-controls cluster (scope-zoom / sort / density / •••), left-aligned so
  // the pills read as one group (the old flex spacer that split them to opposite ends is gone).
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },

  // Keyword browse chip row (Apple Photos) — horizontal scroller of app-local keyword pills. Selected
  // chip flips to a solid accent fill with a matching glow so it reads as its own (active) axis.
  keywordChips: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  keywordChipOn: { backgroundColor: palette.accent, borderColor: palette.accent, ...glowSm(palette.accent) },
  keywordChipTextOn: { color: '#ffffff' },

  // Months/Years drill-in rows: cover thumb + "Month Year" / "Year" + photo count.
  periodList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  periodCover: { width: 66, height: 66, borderRadius: radius.md, backgroundColor: palette.cell },
  periodCoverEmpty: { backgroundColor: palette.cell },
  periodText: { flex: 1 },
  periodTitle: { color: palette.text, ...typography.cardTitle },
  periodMeta: { color: palette.sub, ...typography.meta, marginTop: 4, fontVariant: ['tabular-nums'] },
  tbtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // "On" state for a view-control pill (currently only the scope-zoom when grouped) — violet, since
  // pink is reserved for Favorites. A soft glow gives the active control the brand's alive depth.
  tbtnOnAccent: { backgroundColor: tint(palette.accent, tintFill.active), borderColor: tint(palette.accent, tintBorder.active), ...glowSm(palette.accent) },
  tbtnText: { color: palette.accentSoft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  addTint: { color: palette.accentSoft },

  // Header right cluster while selecting: live count chip + select-all toggle + Cancel.
  hdrRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: tint(palette.accent, tintFill.rest),
  },
  countText: { color: palette.accentSoft, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hdrDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: tint(palette.accent, tintBorder.active),
    backgroundColor: tint(palette.accent, tintFill.rest),
  },
  hdrDiscOn: { backgroundColor: palette.accent, borderColor: palette.accent },

  // Bottom batch-action bar — chrome, so accent colour is welcome (never behind a photo).
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.surface,
    borderTopColor: tint(palette.accent, tintBorder.faint),
    borderTopWidth: 1,
    paddingVertical: 16,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  action: { flex: 1, alignItems: 'center' },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionText: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  favTint: { color: palette.pink },
  deleteTint: { color: palette.danger },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 6,
    backgroundColor: tint(palette.accent, 0.2),
  },

  // "More" overflow pill glyph (the "···" affordance) — sized to sit level with the icon+text pills.
  moreDots: { color: palette.accentSoft, fontSize: 15, lineHeight: 15, fontWeight: '900', letterSpacing: 1.5 },

  // "More" overflow sheet — mirrors AlbumPicker's Modal card, anchored to the bottom as an action menu.
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.popover,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: tint(palette.accent, tintBorder.faint),
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
  },
  sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: tint(palette.accent, tintBorder.faint), marginBottom: 12 },
  sheetTitle: { color: palette.text, ...typography.sheetTitle, marginBottom: 4 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomColor: hairline,
    borderBottomWidth: 1,
  },
  menuLabel: { color: palette.text, fontSize: 16, fontWeight: '700', flex: 1 },
  menuValue: { color: palette.accentSoft, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheetCancel: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  sheetCancelText: { color: palette.sub, fontSize: 16, fontWeight: '700' },
});
