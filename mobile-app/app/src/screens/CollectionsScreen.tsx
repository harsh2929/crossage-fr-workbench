/**
 * Collections — the "For You" discovery tab (Apple Photos' For-You / Collections hub). Where Albums is
 * organization (by album, folder, media type) and Library is the full roll, For You is CURATION: the
 * auto-built Memories carousel up top, then a Featured-Photos grid of the library's highlights. Tapping
 * a memory drills into its own grid (mirrors the Library memory flow); everything reuses the shared
 * PhotoGrid (grid + viewer) and MemoriesCarousel, so this tab adds a surface, not a parallel engine.
 *
 * Identity hue is violet (palette.accent) — For You is a curation sibling of Library, not a cool-toned
 * utility, so it shares the Library/Albums family in the tab-bar legend.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, EmptyState, palette } from '../ui';
import { ScreenHeader } from '../Header';
import { MemoriesCarousel, type MemoryGroup } from '../Memories';
import { Springy } from '../motion';
import { Icon } from '../Icon';
import { grad, tint, radius, typography, space, tintFill, tintBorder, glowSm } from '../theme';
import { getPref, setPref } from '../replica';

// Below this many favorites, pad the Featured grid with recent photos so a light-favorites library
// still has a rich highlights surface; above it, favorites alone carry the grid.
const FEATURED_FAV_FLOOR = 30;
const FEATURED_MAX = 240;

// Featured-grid density (Apple Collections' Large/Medium/Small tiles) — the columns the density pill
// cycles through, plus a human label per column count. 4 columns is the default (PhotoGrid's own COLS).
const DENSITIES = [3, 4, 5];
const DENSITY_LABEL: Record<number, string> = { 3: 'Large', 4: 'Medium', 5: 'Small' };

// Shared hit-slop for the compact toolbar pills so their tap targets exceed the visible chip.
const TB_HITSLOP = { top: 8, bottom: 8 };

export function CollectionsScreen({
  assets,
  onFindSimilar,
  onToggleFavorite,
  onDeleteAssets,
}: {
  assets: AssetMetadata[];
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
}) {
  const [memory, setMemory] = useState<MemoryGroup | null>(null);
  // Layout controls (Apple Collections' tile-size + per-section show/hide). Density sizes the Featured
  // grid; the two visibility toggles independently show/hide the Memories carousel and the Featured
  // grid (Apple lets you hide For You sections). All are restored from prefs on mount and persisted on
  // change (no schema change — the prefs kv store).
  const [cols, setCols] = useState<number>(() => {
    const stored = Number(getPref('collections.cols'));
    return DENSITIES.includes(stored) ? stored : 4;
  });
  // Memories visibility reuses the prior collapse pref (collapseMemories='1' ⇒ hidden) so an earlier
  // collapse choice carries over unchanged; Featured has its own pref. Both default to shown.
  const [showMemories, setShowMemories] = useState<boolean>(
    () => getPref('collections.collapseMemories') !== '1',
  );
  const [showFeatured, setShowFeatured] = useState<boolean>(
    () => getPref('collections.showFeatured') !== '0',
  );
  // Featured rotation (Apple's Featured Photos reshuffles which highlights lead over time). We rotate
  // the *leading favorites* by an offset = a DATE-derived day number + a manual "Shuffle" bump, so the
  // selection shifts day-to-day yet is stable within a day, and the user can re-roll on demand. The day
  // number is captured once here (Date.now() read at runtime in the initializer, never at module scope);
  // the manual bump persists so a shuffle sticks across launches. Rotation only reorders — never drops.
  const [dayNumber] = useState<number>(() => Math.floor(Date.now() / 86_400_000));
  const [shuffleBump, setShuffleBump] = useState<number>(() => {
    const stored = Number(getPref('collections.featuredShuffle'));
    return Number.isFinite(stored) ? stored : 0;
  });

  // Cycle Large → Medium → Small → Large (3 → 4 → 5 → 3 columns), persisting the pick. cols is folded
  // into the grid key below so FlashList remounts on a density change (the codebase's re-layout rule).
  const cycleDensity = () => {
    const next = DENSITIES[(DENSITIES.indexOf(cols) + 1) % DENSITIES.length];
    setCols(next);
    setPref('collections.cols', String(next));
    AccessibilityInfo.announceForAccessibility(
      DENSITY_LABEL[next] ? `${DENSITY_LABEL[next]} grid` : 'Grid density changed',
    );
  };
  const toggleMemories = () => {
    const next = !showMemories;
    setShowMemories(next);
    setPref('collections.collapseMemories', next ? '0' : '1');
  };
  const toggleFeatured = () => {
    const next = !showFeatured;
    setShowFeatured(next);
    setPref('collections.showFeatured', next ? '1' : '0');
  };
  // Re-roll the Featured order on demand: bump the manual offset (persisted) so the leading favorites
  // rotate to a fresh subset. The bump flows into rotationOffset → highlights order → gridKey, so the
  // list remounts and the grid visibly re-ranks.
  const reshuffle = () => {
    const next = shuffleBump + 1;
    setShuffleBump(next);
    setPref('collections.featuredShuffle', String(next));
    AccessibilityInfo.announceForAccessibility('Featured photos shuffled');
  };

  // Featured / highlights: favorites first (they arrive newest-first from the replica), padded with
  // recent photos when favorites are thin, deduped and capped. Curated, not organizational.
  const favCount = useMemo(() => assets.reduce((n, a) => n + (a.isFavorite ? 1 : 0), 0), [assets]);
  // How far to rotate the leading favorites — normalized into [0, favCount) so it maps 1:1 to a slice
  // point. A no-op (0) unless there are ≥2 favorites to reorder. Folded into the gridKey below.
  const rotationOffset = useMemo(
    () => (favCount > 1 ? (((dayNumber + shuffleBump) % favCount) + favCount) % favCount : 0),
    [favCount, dayNumber, shuffleBump],
  );
  const highlights = useMemo(() => {
    const favs = assets.filter((a) => a.isFavorite);
    // Rotate WITHIN the leading favorites (favorites-first intent preserved; every favorite still
    // present, just a different one leading each day/shuffle). No photo dropped or duplicated.
    const leadFavs =
      rotationOffset === 0 ? favs : [...favs.slice(rotationOffset), ...favs.slice(0, rotationOffset)];
    if (favs.length >= FEATURED_FAV_FLOOR) return leadFavs;
    const seen = new Set(favs.map((a) => a.id));
    // Padded-recent tail is untouched by rotation — only the favorites prefix reshuffles.
    return [...leadFavs, ...assets.filter((a) => !seen.has(a.id))].slice(0, FEATURED_MAX);
  }, [assets, rotationOffset]);

  // Master "Show Featured Content" switch (Settings ▸ Featured Content, gap 148). When off, the entire
  // For You surface — Memories carousel AND the Featured grid — is suppressed. Read in render (not a
  // one-time initializer) so flipping it in the Settings modal reflects as soon as this screen renders
  // (it also remounts on tab switch). Placed after every hook, so this conditional return is safe.
  const featuredOn = getPref('features.featuredContent') !== '0';
  if (!featuredOn) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="For You" kicker="Memories & highlights" gradient={grad.brand} />
        <EmptyState
          orb
          glyph="🌙"
          title="Featured Content is off"
          subtitle="Memories and Featured Photos are turned off. Turn on Show Featured Content in Settings to bring them back."
        />
      </View>
    );
  }

  // A drilled-in memory → its own grid, mirroring the Library memory flow. Items are read live off the
  // MemoryGroup passed by the carousel (already override-applied), so it stays in sync.
  if (memory) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={memory.title}
          meta={memory.subtitle}
          gradient={memory.gradient}
          back={{ label: 'For You', onPress: () => setMemory(null) }}
        />
        {memory.items.length === 0 ? (
          <EmptyState orb glyph="✨" title="Empty memory" subtitle="There aren’t any photos in this memory." />
        ) : (
          <PhotoGrid
            data={memory.items}
            gridKey={`cmem:${memory.key}`}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="For You" kicker="Memories & highlights" gradient={grad.brand} />
      {assets.length === 0 ? (
        <EmptyState
          orb
          glyph="✨"
          title="Nothing here yet"
          subtitle="Your memories and featured photos appear here as your library grows."
        />
      ) : (
        <>
          {/* Layout toolbar — per-section SHOW/HIDE for Memories + Featured (Apple lets you hide For You
              sections), plus the Featured Shuffle + tile-size density (shown only while Featured is on).
              Mirrors Library's sort/density pill row; stays fixed above the grid so it never scrolls off. */}
          <View style={styles.toolbar}>
            <Springy
              onPress={toggleMemories}
              pressableStyle={[styles.tbtn, showMemories && styles.tbtnOn]}
              hitSlop={TB_HITSLOP}
              accessibilityLabel={showMemories ? 'Hide Memories' : 'Show Memories'}
              accessibilityHint="Shows or hides the Memories carousel"
              accessibilityState={{ selected: showMemories }}
            >
              <Icon
                name={showMemories ? 'check' : 'eyeOff'}
                size={14}
                color={showMemories ? palette.accent : palette.accentSoft}
              />
              <Text style={styles.tbtnText} maxFontSizeMultiplier={1.4}>Memories</Text>
            </Springy>
            <Springy
              onPress={toggleFeatured}
              pressableStyle={[styles.tbtn, showFeatured && styles.tbtnOn]}
              hitSlop={TB_HITSLOP}
              accessibilityLabel={showFeatured ? 'Hide Featured Photos' : 'Show Featured Photos'}
              accessibilityHint="Shows or hides the Featured Photos grid"
              accessibilityState={{ selected: showFeatured }}
            >
              <Icon
                name={showFeatured ? 'check' : 'eyeOff'}
                size={14}
                color={showFeatured ? palette.accent : palette.accentSoft}
              />
              <Text style={styles.tbtnText} maxFontSizeMultiplier={1.4}>Featured</Text>
            </Springy>
            <View style={styles.spacer} />
            {/* Shuffle + density steer the Featured grid, so they only appear while Featured is shown.
                Shuffle also needs ≥2 favorites to reorder (rotation is a no-op below that). */}
            {showFeatured ? (
              <>
                {favCount > 1 ? (
                  <Springy
                    onPress={reshuffle}
                    pressableStyle={styles.tbtn}
                    hitSlop={TB_HITSLOP}
                    accessibilityLabel="Shuffle featured photos"
                    accessibilityHint="Re-rolls which highlights lead the Featured grid"
                  >
                    <Icon name="spark" size={14} color={palette.accentSoft} />
                    <Text style={styles.tbtnText} maxFontSizeMultiplier={1.4}>Shuffle</Text>
                  </Springy>
                ) : null}
                <Springy
                  onPress={cycleDensity}
                  pressableStyle={styles.tbtn}
                  hitSlop={TB_HITSLOP}
                  accessibilityLabel={`Grid density, ${DENSITY_LABEL[cols]}`}
                  accessibilityHint="Cycles the Featured grid between Large, Medium, and Small tiles"
                >
                  <Icon name="grid" size={14} color={palette.accentSoft} />
                  <Text style={styles.tbtnText} maxFontSizeMultiplier={1.4}>{DENSITY_LABEL[cols]}</Text>
                </Springy>
              </>
            ) : null}
          </View>
          {showFeatured ? (
            <PhotoGrid
              data={highlights}
              // Favoriting from within this grid reorders `highlights` (favs move to/from the prefix), so
              // fold the fav count into the key to remount FlashList — the codebase's convention for an
              // in-place re-rank (a recycled cell would otherwise show a stale photo). Density (`cols`) is
              // folded in too so a tile-size change remounts the list (numColumns can't change in place).
              // rotationOffset is folded in as well so a daily rotation or manual Shuffle re-ranks too.
              // (The show/hide toggles never reorder or refilter this data, so they stay out of the key.)
              gridKey={`collections:${favCount}:${cols}:${rotationOffset}`}
              cols={cols}
              onFindSimilar={onFindSimilar}
              onToggleFavorite={onToggleFavorite}
              onDeleteAssets={onDeleteAssets}
              ListHeaderComponent={
                <>
                  {/* Memories hidden → grid-only: the carousel is omitted, leaving just the Featured grid. */}
                  {showMemories ? <MemoriesCarousel assets={assets} onOpen={setMemory} /> : null}
                  <Text style={styles.sectionLabel} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                    Featured Photos
                  </Text>
                </>
              }
            />
          ) : showMemories ? (
            // Featured hidden but Memories shown → the carousel stands alone (no grid beneath it).
            <MemoriesCarousel assets={assets} onOpen={setMemory} />
          ) : (
            // Both sections hidden → a gentle hint; the toolbar above still un-hides either one.
            <EmptyState
              orb
              glyph="🙈"
              title="Both sections hidden"
              subtitle="Memories and Featured Photos are hidden. Tap Memories or Featured above to bring a section back."
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sectionLabel: {
    ...typography.kicker,
    color: palette.sub,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },

  // Layout toolbar (show/hide Memories · show/hide Featured · Shuffle · grid density) — persistent chrome
  // above the grid, mirroring Library's view-controls pill row so the two tabs share one toolbar language.
  // Violet identity (For You's hue), so a toggled-on section deepens the accent tint rather than another colour.
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, paddingBottom: space.sm },
  spacer: { flex: 1 },
  tbtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tbtnOn: {
    backgroundColor: tint(palette.accent, tintFill.active),
    borderColor: tint(palette.accent, tintBorder.active),
    ...glowSm(palette.accent),
  },
  tbtnText: { ...typography.meta, fontWeight: '700', color: palette.accentSoft },
});
