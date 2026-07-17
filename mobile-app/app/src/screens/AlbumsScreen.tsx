/**
 * Albums — the library grouped into months (newest first), the Apple Photos staple. Tapping a month
 * drills into its own grid. Grouping is pure client-side arithmetic over the replica's created_at.
 *
 * Chrome carries the living colour (the gradient drill headers, glowing cover tiles, springy rows);
 * the cover thumbnails themselves sit on neutral cells / a neutral shimmer so photos read cleanly.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform, Modal, ScrollView, TextInput } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { MediaType, type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, EmptyState, Center, palette, assetUri } from '../ui';
import { DuplicatesView } from './DuplicatesView';
import { HiddenView } from './HiddenView';
import { DateScrubber } from '../DateScrubber';
import { loadDeviceAlbums, albumAssetIdSet, filterByAlbum, deleteAlbum, removeAssetsFromAlbum, type DeviceAlbum } from '../albums';
import { ScreenHeader } from '../Header';
import { grad, tint, glow, radius, typography, tintFill, tintBorder, hairline, glowMd } from '../theme';
import { Springy, Shimmer, Loader, Reveal, RollingNumber, LivingGradient } from '../motion';
import { Icon } from '../Icon';
import { toast } from '../Toast';
import { SettingsScreen } from '../SettingsScreen';
import { Chip, Segmented, SearchField } from '../fields';
import { getPref, setPref, searchCaptions, keywordIndex } from '../replica';
import { useInsets } from '../insets';

interface MonthGroup {
  key: string; // "YYYY-MM", or "0000-00" for undated
  label: string;
  items: AssetMetadata[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function groupByMonth(assets: AssetMetadata[]): MonthGroup[] {
  const map = new Map<string, AssetMetadata[]>();
  for (const a of assets) {
    const raw = a.creationTime ?? 0;
    // expo-media-library reports creationTime in ms; tolerate seconds just in case.
    const ms = raw > 0 && raw < 1e11 ? raw * 1000 : raw;
    const d = ms > 0 ? new Date(ms) : null;
    const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '0000-00';
    const bucket = map.get(key);
    if (bucket) bucket.push(a);
    else map.set(key, [a]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest month first
    .map(([key, items]) => {
      let label = 'Undated';
      if (key !== '0000-00') {
        const [y, m] = key.split('-');
        label = `${MONTHS[Number(m) - 1]} ${y}`;
      }
      return { key, label, items };
    });
}

function countLabel(n: number): string {
  return `${n} photo${n === 1 ? '' : 's'}`;
}

// How many photos "Recently Added" surfaces, and how many distinct capture-days the "Recent Days"
// list keeps — both bounded so the client-side arithmetic stays cheap on a huge roll.
const RECENT_ADDED_MAX = 200;
const RECENT_DAYS_MAX = 90;
// Aspect ratio at/above which a still reads as a panorama (pure geometry; we can't query mediaSubtype).
const PANO_RATIO = 2;

/** Normalise expo-media-library's creationTime to ms (it reports ms; tolerate seconds just in case). */
function toMs(raw: number): number {
  return raw > 0 && raw < 1e11 ? raw * 1000 : raw;
}

// --- Search within an album (capture-date / caption / keyword) ---------------------------------
// Apple lets you search inside an open collection. CLIP lives at App level and isn't reachable here, so
// the in-album SearchField scopes to what THIS screen can do without it: a capture-DATE the query names,
// the photo's app-local CAPTION, or an app-local KEYWORD. All three are cheap client-side reads
// (creationTime + the replica's caption/keyword helpers); the drill-in view unions them, in album order.

// Lowercased month names, index-aligned to Date.getMonth() (0 = January). Hardcoded off MONTHS (never
// toLocaleDateString) so month parsing stays locale-independent.
const MONTHS_LC = MONTHS.map((m) => m.toLowerCase());

/** A capture-date reading of a query: a 1900–2099 year and/or a month (0-based, matching getMonth()). */
interface AlbumDateIntent {
  year?: number;
  month?: number;
}

/**
 * Parse a query for a capture-date intent — a 4-digit 1900–2099 year and/or a month name (full or its
 * canonical 3-letter form, case-insensitive). Returns null when the query names no date tokens.
 */
function parseAlbumDate(query: string): AlbumDateIntent | null {
  let year: number | undefined;
  let month: number | undefined;
  for (const tok of query.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (year === undefined && /^\d{4}$/.test(tok)) {
      const n = Number(tok);
      if (n >= 1900 && n <= 2099) {
        year = n;
        continue;
      }
    }
    if (month === undefined) {
      const m = MONTHS_LC.findIndex((name) => name === tok || (tok.length === 3 && name.slice(0, 3) === tok));
      if (m >= 0) month = m;
    }
  }
  if (year === undefined && month === undefined) return null;
  // A bare month word ("may", "march", "august") is a common non-date word, so a month WITHOUT a year
  // only counts as a date when a date preposition ("from march", "in march") is present — mirrors
  // SearchScreen's confidentDateIntent gate. A 4-digit year is always unambiguous. This keeps a caption/
  // keyword query like "may" from flooding the grid with every May photo via the OR union.
  if (year === undefined && month !== undefined && !/(^|\s)(in|on|from|during|taken|shot|of)\s/i.test(query)) {
    return null;
  }
  const out: AlbumDateIntent = {};
  if (year !== undefined) out.year = year;
  if (month !== undefined) out.month = month;
  return out;
}

/** True when an asset's capture date satisfies the parsed year/month intent (toMs-normalized). */
function albumDateMatches(a: AssetMetadata, intent: AlbumDateIntent): boolean {
  const ms = toMs(a.creationTime ?? 0);
  if (!(ms > 0)) return false;
  const d = new Date(ms);
  if (intent.year !== undefined && d.getFullYear() !== intent.year) return false;
  if (intent.month !== undefined && d.getMonth() !== intent.month) return false;
  return true;
}

interface DayGroup {
  key: string; // "YYYY-MM-DD" (local calendar day)
  label: string;
  items: AssetMetadata[];
}

/** "Mon, Jul 13, 2026" — a compact, locale-aware capture-day label. */
function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Group the roll by local calendar day, newest day first, capped to `limit` distinct days. */
function groupByDay(assets: AssetMetadata[], limit: number): DayGroup[] {
  const map = new Map<string, AssetMetadata[]>();
  for (const a of assets) {
    const ms = toMs(a.creationTime ?? 0);
    if (ms <= 0) continue; // undated photos don't belong to a capture-day
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(a);
    else map.set(key, [a]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest day first
    .slice(0, limit)
    .map(([key, items]) => ({ key, label: dayLabel(toMs(items[0].creationTime ?? 0)), items }));
}

// --- Per-album Sort By + custom manual order ---------------------------------------------------
// Apple Photos lets each album pick a Sort By (Newest / Oldest / Title) or a hand-arranged Custom
// order. We persist the choice + the order in the replica's key/value prefs, keyed by the device
// album id, so both survive relaunch. Custom order is app-local — we never reorder the real PhotoKit
// album (PhotoKit exposes no member-order write), so it applies ONLY inside our drill-in grid.

export type SortMode = 'newest' | 'oldest' | 'title' | 'custom';

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'title', label: 'Title' },
  { key: 'custom', label: 'Custom' },
];
// Smart albums (Screenshots/Selfies) can be sorted but not hand-arranged — drop Custom for those.
const SORT_OPTIONS_NOCUSTOM = SORT_OPTIONS.filter((o) => o.key !== 'custom');

function isSortMode(v: string | null): v is SortMode {
  return v === 'newest' || v === 'oldest' || v === 'title' || v === 'custom';
}

/** Case-insensitive filename compare (no Intl — Hermes lacks a reliable localeCompare/collator). */
function byFilename(a: AssetMetadata, b: AssetMetadata): number {
  const an = (a.filename ?? '').toLowerCase();
  const bn = (b.filename ?? '').toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Order an album's photos for a given sort. Newest/Oldest go by capture date (creationTime, seconds
 * tolerated via toMs); Title by filename. Custom applies the saved externalId order and drops any
 * saved id no longer present; photos missing from the saved order fall to the end in newest-first
 * date order (the app-wide default) so freshly-added photos surface predictably.
 */
function applySort(items: AssetMetadata[], mode: SortMode, order: string[]): AssetMetadata[] {
  if (items.length <= 1) return items;
  if (mode === 'oldest') return [...items].sort((a, b) => toMs(a.creationTime ?? 0) - toMs(b.creationTime ?? 0));
  if (mode === 'title') return [...items].sort(byFilename);
  if (mode === 'custom') {
    const rank = new Map<string, number>();
    order.forEach((id, i) => rank.set(id, i));
    const ranked: AssetMetadata[] = [];
    const tail: AssetMetadata[] = [];
    for (const a of items) (rank.has(a.id) ? ranked : tail).push(a);
    ranked.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    tail.sort((a, b) => toMs(b.creationTime ?? 0) - toMs(a.creationTime ?? 0));
    return [...ranked, ...tail];
  }
  // 'newest' (default)
  return [...items].sort((a, b) => toMs(b.creationTime ?? 0) - toMs(a.creationTime ?? 0));
}

// --- Per-album content filter (Photos / Videos / Favorites) ------------------------------------
// Apple Photos lets you filter an open album by media type / favourites. Like Sort By, this is a
// per-album choice persisted in the replica's key/value prefs (keyed by the device album id) and it
// runs INSIDE devItems — after membership, before the sort — so Sort + Custom order operate on the
// already-filtered set. Videos are real (assets carry a mediaType), so Photos/Videos is meaningful.

export type FilterMode = 'all' | 'photos' | 'videos' | 'favorites';

const FILTER_OPTIONS: { key: FilterMode; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'favorites', label: 'Favorites' },
];

function isFilterMode(v: string | null): v is FilterMode {
  return v === 'all' || v === 'photos' || v === 'videos' || v === 'favorites';
}

// Zero-state copy per non-"all" filter (an album with members can only come back empty under a filter).
const FILTER_EMPTY: Record<Exclude<FilterMode, 'all'>, { glyph: string; title: string; subtitle: string }> = {
  photos: { glyph: '🖼️', title: 'No photos', subtitle: 'This album has no still photos here — try Videos or All.' },
  videos: { glyph: '🎬', title: 'No videos', subtitle: 'This album has no videos here — try Photos or All.' },
  favorites: { glyph: '♡', title: 'No favorites', subtitle: 'None of this album’s photos are favorited yet.' },
};

/** Keep only the assets matching a content filter. Photos = anything that isn't a video. */
function applyFilter(items: AssetMetadata[], mode: FilterMode): AssetMetadata[] {
  if (mode === 'videos') return items.filter((a) => a.mediaType === MediaType.VIDEO);
  if (mode === 'photos') return items.filter((a) => a.mediaType !== MediaType.VIDEO);
  if (mode === 'favorites') return items.filter((a) => a.isFavorite);
  return items;
}

// --- App-local folders (grouping user albums) --------------------------------------------------
// Apple Photos lets you gather albums into Folders. PhotoKit exposes no folder API to third-party
// apps, so ours is app-local: named folders, each holding a set of USER-album ids, persisted as ONE
// JSON pref (FOLDERS_PREF). Smart albums (Screenshots/Selfies) are never foldered — they stay in the
// ungrouped list. An album lives in at most one folder. This is app-only metadata; we never touch
// the real PhotoKit hierarchy, so deleting a folder only drops our grouping, never the albums.

const FOLDERS_PREF = 'albums.folders';

// Folders nest: a folder may carry a `parentId` referencing another folder it lives inside. The tree
// is kept shallow — this caps how deep the render walks (root = depth 1) so a pathological or cyclic
// chain can never blow the stack or produce an unreadable wall of indentation.
const MAX_FOLDER_DEPTH = 5;

export interface AlbumFolder {
  id: string;
  name: string;
  albumIds: string[];
  // Optional parent folder id (nested folders). Absent = a root folder. parseFolders guarantees this
  // only ever references another existing folder and never forms a cycle (a folder can't be its own
  // ancestor); a bad / dangling / cyclic parentId is dropped so the folder degrades to a root.
  parentId?: string;
}

/**
 * Parse the folders pref defensively: JSON.parse inside a try/catch, then shape-check every entry
 * (id + name strings, albumIds a string array) and enforce the invariants — unique folder ids, and
 * each album id claimed by at most one folder (first folder wins). A folder may also carry a parentId
 * (nested folders); it's resolved in a second pass and kept ONLY when it references another existing
 * folder without forming a cycle (a folder can't be its own ancestor). Anything malformed — bad shape,
 * a dangling parent, or a parent that would cycle — is dropped, so a corrupt or legacy pref degrades to
 * a smaller-but-valid FOREST (or []) and can never wedge Albums.
 */
function parseFolders(raw: string | null): AlbumFolder[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // corrupt JSON — start clean
  }
  if (!Array.isArray(parsed)) return [];
  // Pass 1: shape-check every entry (id / name / albumIds), stashing a candidate parentId string to
  // resolve once the full set of valid folder ids is known.
  const staged: { id: string; name: string; albumIds: string[]; parent?: string }[] = [];
  const seenFolders = new Set<string>();
  const claimedAlbums = new Set<string>(); // enforces "an album lives in at most one folder"
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const { id, name, albumIds, parentId } = e as {
      id?: unknown;
      name?: unknown;
      albumIds?: unknown;
      parentId?: unknown;
    };
    if (typeof id !== 'string' || id === '' || seenFolders.has(id)) continue;
    if (typeof name !== 'string') continue;
    if (!Array.isArray(albumIds)) continue;
    const ids: string[] = [];
    for (const a of albumIds) {
      if (typeof a !== 'string' || a === '' || claimedAlbums.has(a)) continue;
      claimedAlbums.add(a);
      ids.push(a);
    }
    seenFolders.add(id);
    const parent = typeof parentId === 'string' && parentId !== '' ? parentId : undefined;
    staged.push({ id, name, albumIds: ids, parent });
  }
  // Pass 2: resolve each candidate parentId against the valid folder set. Accept an edge folder→parent
  // only if the parent exists, isn't the folder itself, and doesn't already reach the folder through a
  // previously-accepted edge (which would close a cycle). Accepting against an acyclic accepted-edge map
  // keeps the result a forest whatever the input order — a rejected parentId degrades to a root folder.
  const acceptedParent = new Map<string, string>();
  for (const f of staged) {
    const p = f.parent;
    if (p === undefined || p === f.id || !seenFolders.has(p)) continue; // no / self / dangling → root
    const chain = new Set<string>([f.id]);
    let cur: string | undefined = p;
    let ok = true;
    while (cur !== undefined) {
      if (chain.has(cur)) {
        ok = false; // the parent already reaches this folder → nesting would cycle
        break;
      }
      chain.add(cur);
      cur = acceptedParent.get(cur);
    }
    if (ok) acceptedParent.set(f.id, p);
  }
  return staged.map((f) => {
    const parent = acceptedParent.get(f.id);
    return parent
      ? { id: f.id, name: f.name, albumIds: f.albumIds, parentId: parent }
      : { id: f.id, name: f.name, albumIds: f.albumIds };
  });
}

// --- App-local smart albums (rule-based dynamic albums) ----------------------------------------
// Apple Photos has Smart Albums on the desktop; PhotoKit exposes none to third-party apps, so ours
// are app-local: a saved set of RULES evaluated LIVE against the loaded roll every render (never a
// frozen membership). All smart albums live in ONE JSON pref (SMART_PREF). An empty rule set matches
// everything. Rules stay deliberately small — media type, favourite-only, and a single capture-year —
// so a match is the same cheap client-side arithmetic (mediaType / isFavorite / creationTime) the
// per-album content filter already runs; nothing here touches the real PhotoKit library.

const SMART_PREF = 'albums.smart';

export type SmartMediaRule = 'photos' | 'videos';

export interface SmartRules {
  mediaType?: SmartMediaRule; // undefined = both photos and videos
  favorite?: boolean; // true = favourites only; undefined = any
  year?: number; // capture year; undefined = any year
}

export interface SmartAlbum {
  id: string;
  name: string;
  rules: SmartRules;
}

// The edit sheet's rule controls (Segmented value keys). 'all' maps to an UNSET rule (undefined), so
// an all/all/Any album carries {} and matches the whole roll.
const SMART_MEDIA_OPTIONS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
];
const SMART_FAV_OPTIONS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fav', label: 'Favorites' },
];

/**
 * Parse the smart-albums pref defensively: JSON.parse inside a try/catch, then shape-check every entry
 * (id + name strings, unique ids) and sanitise its rules field-by-field — mediaType only 'photos'/
 * 'videos', favorite only literal true, year only a finite number. Unknown/legacy rule keys are
 * dropped, so a corrupt or forward-versioned pref degrades to a smaller-but-valid model (or []) and
 * can never wedge Albums.
 */
function parseSmartAlbums(raw: string | null): SmartAlbum[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // corrupt JSON — start clean
  }
  if (!Array.isArray(parsed)) return [];
  const out: SmartAlbum[] = [];
  const seen = new Set<string>(); // enforces unique smart-album ids
  for (const e of parsed) {
    if (!e || typeof e !== 'object') continue;
    const { id, name, rules } = e as { id?: unknown; name?: unknown; rules?: unknown };
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    if (typeof name !== 'string') continue;
    const clean: SmartRules = {};
    if (rules && typeof rules === 'object') {
      const { mediaType, favorite, year } = rules as { mediaType?: unknown; favorite?: unknown; year?: unknown };
      if (mediaType === 'photos' || mediaType === 'videos') clean.mediaType = mediaType;
      if (favorite === true) clean.favorite = true;
      if (typeof year === 'number' && Number.isFinite(year)) clean.year = year;
    }
    seen.add(id);
    out.push({ id, name, rules: clean });
  }
  return out;
}

/** Evaluate a smart album's rules over the roll. Empty rules match everything (the whole roll). */
function matchSmart(items: AssetMetadata[], rules: SmartRules): AssetMetadata[] {
  const { mediaType, favorite, year } = rules;
  if (!mediaType && !favorite && year === undefined) return items; // no rules — the whole roll
  return items.filter((a) => {
    if (mediaType === 'videos' && a.mediaType !== MediaType.VIDEO) return false;
    if (mediaType === 'photos' && a.mediaType === MediaType.VIDEO) return false;
    if (favorite && !a.isFavorite) return false;
    if (year !== undefined) {
      const ms = toMs(a.creationTime ?? 0);
      if (ms <= 0 || new Date(ms).getFullYear() !== year) return false;
    }
    return true;
  });
}

/** A short human rule summary ("Favorite videos · 2026"), or "All photos" when unconstrained. */
function smartRuleSummary(rules: SmartRules): string {
  const { mediaType, favorite, year } = rules;
  const bits: string[] = [];
  if (mediaType === 'videos') bits.push(favorite ? 'Favorite videos' : 'Videos');
  else if (mediaType === 'photos') bits.push(favorite ? 'Favorite photos' : 'Photos');
  else if (favorite) bits.push('Favorites');
  if (year !== undefined) bits.push(String(year));
  return bits.length === 0 ? 'All photos' : bits.join(' · ');
}

/**
 * A compact signature of a smart album's rules — folded into the drill-in gridKey so an edited rule
 * set remounts the grid (FlashList recycles cells by key and won't reliably reposition a re-filtered
 * set in place). The id already keys the album; this keys the *shape* of its live matches.
 */
function smartRuleSig(rules: SmartRules): string {
  return `${rules.mediaType ?? '_'}|${rules.favorite ? 'f' : '_'}|${rules.year ?? '_'}`;
}

// --- Pinned collections (user-curated quick-access) --------------------------------------------
// Apple Photos lets you pin go-to albums / smart albums to a Pinned Collections row at the top of
// Albums. Ours mirrors that: a user-curated ORDER of targets, each an openKey — "dev:<id>" for a
// device album or "smart:<id>" for an app-local smart album — persisted as ONE JSON pref
// (PINNED_PREF). A pin never freezes what it points at; it's resolved LIVE against the current
// device / smart albums every render (resolve-not-prune), so a pinned target that no longer exists
// simply drops from the row and we never rewrite the pref on a transient empty device-album read.

const PINNED_PREF = 'albums.pinned';

/**
 * Parse the pinned pref defensively: JSON.parse inside a try/catch, then keep only non-empty, unique
 * strings (each an openKey; we DON'T validate the target resolves here — that's done on render, so a
 * transient empty read can't wipe a pin). A corrupt or legacy pref degrades to [] and never wedges Albums.
 */
function parsePinned(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // corrupt JSON — start clean
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>(); // enforces unique pins
  for (const e of parsed) {
    if (typeof e !== 'string' || e === '' || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** A pin resolved against the live albums — a device album, or a smart album with its live matches. */
type ResolvedPin =
  | { key: string; kind: 'dev'; album: DeviceAlbum }
  | { key: string; kind: 'smart'; album: SmartAlbum; items: AssetMetadata[] };

/** One living album row: a glowing cover tile + title/count + chevron, wrapped in a springy press. */
function AlbumRow({
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint = 'Opens the album',
  cover,
  title,
  sub,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  cover: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Springy
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={0.97}
      pressableStyle={styles.rowOuter}
      style={styles.row}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {cover}
      <View style={styles.info}>
        <Text style={styles.albumTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.albumCount} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Icon name="chevron" size={16} color={palette.muted} style={styles.chevron} />
    </Springy>
  );
}

/** A solid, glowing accent cover tile with a glyph (Favorites / Duplicates / device albums). */
function GlyphCover({ tone, icon }: { tone: string; icon: 'heartFill' | 'stack' | 'grid' | 'eyeOff' | 'spark' }) {
  return (
    <View style={[styles.coverWrap, glowMd(tone)]}>
      <View style={[styles.coverClip, { backgroundColor: tint(tone, 0.9) }]}>
        <Icon name={icon} size={28} color="#ffffff" />
        <View pointerEvents="none" style={styles.coverRim} />
      </View>
    </View>
  );
}

/** A photo cover tile: a neutral shimmer that breathes while the image fades in over it. */
function PhotoCover({ id }: { id: string }) {
  return (
    <View style={[styles.coverWrap, glow(palette.accent, 14, 0.22)]}>
      <View style={styles.coverClip}>
        <Shimmer style={styles.coverFill} />
        <Image
          source={{ uri: assetUri(id) }}
          style={styles.coverFill}
          recyclingKey={id}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={180}
          accessibilityIgnoresInvertColors
        />
        <View pointerEvents="none" style={styles.coverRim} />
      </View>
    </View>
  );
}

/** How many albums a folder holds, pluralised. */
function folderCountLabel(n: number): string {
  return `${n} album${n === 1 ? '' : 's'}`;
}

/** A folder's one-line summary — "N albums", or "M folders · N albums" when it also nests folders. */
function folderSummary(albums: number, subfolders: number): string {
  if (subfolders === 0) return folderCountLabel(albums);
  return `${subfolders} folder${subfolders === 1 ? '' : 's'} · ${folderCountLabel(albums)}`;
}

/**
 * A folder row — mirrors AlbumRow's shell (glowing cover + title/sub + chevron, springy press) but
 * TOGGLES expand instead of drilling in: tap toggles, the chevron rotates to point down when open,
 * and long-press opens the manage sheet. Its cover is a distinct magenta "stack" so folders read
 * apart from the accent "grid" albums beneath them.
 */
function FolderRow({
  name,
  sub,
  expanded,
  onToggle,
  onManage,
}: {
  name: string;
  sub: string;
  expanded: boolean;
  onToggle: () => void;
  onManage: () => void;
}) {
  return (
    <Springy
      onPress={onToggle}
      onLongPress={onManage}
      scaleTo={0.97}
      pressableStyle={styles.rowOuter}
      style={styles.row}
      accessibilityLabel={`${name}, folder, ${sub}`}
      accessibilityHint={
        expanded ? 'Collapses the folder. Long press to manage it.' : 'Expands the folder. Long press to manage it.'
      }
      accessibilityState={{ expanded }}
    >
      <GlyphCover tone={palette.magenta} icon="stack" />
      <View style={styles.info}>
        <Text style={styles.albumTitle} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.albumCount} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Icon name="chevron" size={16} color={palette.muted} style={expanded ? styles.chevronOpen : styles.chevron} />
    </Springy>
  );
}

/**
 * FolderManager — the manage sheet for one app-local folder: rename it, tick which USER albums belong
 * to it (ticking an album already in another folder MOVES it here — an album lives in one folder), nest
 * it under another folder ("Move to Folder", excluding itself + its own descendants so it can't cycle),
 * and delete it. Mirrors the SettingsScreen modal chrome (a living-gradient header + cards of rows).
 * Every edit persists through the parent's handlers the instant it happens, so the sheet is durable even
 * if dismissed abruptly; the name commits on blur/submit/Done so a typed-but-not-submitted name isn't lost.
 */
function FolderManager({
  folder,
  userAlbums,
  folders,
  onRename,
  onToggleAlbum,
  onSetParent,
  onDelete,
  onClose,
}: {
  folder: AlbumFolder | null;
  userAlbums: DeviceAlbum[];
  folders: AlbumFolder[];
  onRename: (id: string, name: string) => void;
  onToggleAlbum: (folderId: string, albumId: string) => void;
  onSetParent: (folderId: string, parentId: string | null) => void;
  onDelete: (folder: AlbumFolder) => void;
  onClose: () => void;
}) {
  const insets = useInsets();
  const [name, setName] = useState('');
  // Re-seed the editable name whenever a different folder opens (or its stored name changes). Toggling
  // an album re-renders this with the same id+name, so an in-progress (uncommitted) edit is preserved.
  useEffect(() => {
    if (folder) setName(folder.name);
  }, [folder?.id, folder?.name]);

  // Which folder (if any) currently owns each album — drives the checkmark + the "In <folder>" hint.
  const ownerOf = useMemo(() => {
    const m = new Map<string, AlbumFolder>();
    for (const f of folders) for (const id of f.albumIds) m.set(id, f);
    return m;
  }, [folders]);

  // Eligible "Move to Folder" targets: every OTHER folder that isn't one of THIS folder's descendants
  // (nesting under itself or a descendant would create a cycle). Recomputes as folders change so it
  // tracks edits made while the sheet is open; empty when there's nowhere to nest (the section hides).
  const eligibleParents = useMemo(() => {
    if (!folder) return [] as AlbumFolder[];
    const ids = new Set(folders.map((f) => f.id));
    const childMap = new Map<string, string[]>();
    for (const f of folders) {
      const p = f.parentId;
      if (p && p !== f.id && ids.has(p)) {
        const arr = childMap.get(p);
        if (arr) arr.push(f.id);
        else childMap.set(p, [f.id]);
      }
    }
    const banned = new Set<string>([folder.id]); // the folder itself + all of its descendants
    const stack = [folder.id];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const c of childMap.get(cur) ?? []) {
        if (!banned.has(c)) {
          banned.add(c);
          stack.push(c);
        }
      }
    }
    return folders.filter((f) => !banned.has(f.id));
  }, [folder?.id, folders]);

  const commitName = () => {
    if (folder) onRename(folder.id, name);
  };
  const close = () => {
    commitName(); // persist a typed-but-unsubmitted rename before the sheet closes
    onClose();
  };

  return (
    <Modal visible={!!folder} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.mgrRoot} accessibilityViewIsModal onAccessibilityEscape={close}>
        <View style={styles.mgrHeader}>
          <LivingGradient colors={grad.brand} height={130} />
          <View style={[styles.mgrHeaderRow, { paddingTop: insets.top + 6 }]}>
            <Springy onPress={close} hitSlop={12} pressableStyle={styles.mgrBack} accessibilityLabel="Done">
              <Icon name="chevron" size={16} color={palette.accentSoft} style={styles.mgrBackChevron} />
              <Text style={styles.mgrBackText}>Done</Text>
            </Springy>
          </View>
          <Text style={styles.mgrTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            Folder
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={[styles.mgrScroll, { paddingBottom: insets.bottom + 24 }]}
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Name</Text>
          <View style={styles.mgrNameCard}>
            <TextInput
              style={styles.mgrNameInput}
              value={name}
              onChangeText={setName}
              onEndEditing={commitName}
              onSubmitEditing={commitName}
              placeholder="Folder name"
              placeholderTextColor={palette.muted}
              returnKeyType="done"
              maxLength={60}
              selectionColor={palette.accent}
              accessibilityLabel="Folder name"
            />
          </View>

          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Albums</Text>
          {userAlbums.length === 0 ? (
            <Text style={styles.mgrNote}>
              You don’t have any albums to add yet. Create an album (from a photo’s share sheet), then it’ll show up
              here to file into a folder.
            </Text>
          ) : (
            <View style={styles.mgrCard}>
              {userAlbums.map((a, i) => {
                const owner = ownerOf.get(a.id);
                const here = !!folder && owner?.id === folder.id;
                const elsewhere = owner && !here ? owner.name : null;
                return (
                  <Springy
                    key={a.id}
                    onPress={() => folder && onToggleAlbum(folder.id, a.id)}
                    pressableStyle={[styles.mgrRow, i > 0 && styles.mgrRowDivider]}
                    accessibilityLabel={a.title}
                    accessibilityHint={
                      here
                        ? 'In this folder. Tap to remove.'
                        : elsewhere
                          ? `In ${elsewhere}. Tap to move here.`
                          : 'Tap to add to this folder.'
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: here }}
                  >
                    <View style={[styles.mgrCheck, here && styles.mgrCheckOn]}>
                      {here && <Icon name="check" size={12} color="#ffffff" strokeWidth={2} />}
                    </View>
                    <View style={styles.mgrRowInfo}>
                      <Text style={styles.mgrRowTitle} numberOfLines={1}>
                        {a.title}
                      </Text>
                      {elsewhere ? (
                        <Text style={styles.mgrRowSub} numberOfLines={1}>
                          {`In ${elsewhere}`}
                        </Text>
                      ) : null}
                    </View>
                  </Springy>
                );
              })}
            </View>
          )}

          {folder && eligibleParents.length > 0 ? (
            <>
              <Text style={styles.mgrSectionTitle} accessibilityRole="header">Move to Folder</Text>
              <View style={styles.mgrCard}>
                <Springy
                  onPress={() => onSetParent(folder.id, null)}
                  pressableStyle={styles.mgrRow}
                  accessibilityLabel="None, Top Level"
                  accessibilityHint="Keeps this folder at the top level"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: !folder.parentId }}
                >
                  <View style={[styles.mgrCheck, !folder.parentId && styles.mgrCheckOn]}>
                    {!folder.parentId && <Icon name="check" size={12} color="#ffffff" strokeWidth={2} />}
                  </View>
                  <View style={styles.mgrRowInfo}>
                    <Text style={styles.mgrRowTitle} numberOfLines={1}>
                      None (Top Level)
                    </Text>
                  </View>
                </Springy>
                {eligibleParents.map((p) => {
                  const sel = folder.parentId === p.id;
                  return (
                    <Springy
                      key={p.id}
                      onPress={() => onSetParent(folder.id, p.id)}
                      pressableStyle={[styles.mgrRow, styles.mgrRowDivider]}
                      accessibilityLabel={p.name}
                      accessibilityHint={sel ? 'Current parent folder. Tap to keep.' : `Nests this folder inside ${p.name}.`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: sel }}
                    >
                      <View style={[styles.mgrCheck, sel && styles.mgrCheckOn]}>
                        {sel && <Icon name="check" size={12} color="#ffffff" strokeWidth={2} />}
                      </View>
                      <View style={styles.mgrRowInfo}>
                        <Text style={styles.mgrRowTitle} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </View>
                    </Springy>
                  );
                })}
              </View>
            </>
          ) : null}

          {folder ? (
            <Springy
              onPress={() => onDelete(folder)}
              pressableStyle={styles.mgrDelete}
              accessibilityLabel="Delete folder"
              accessibilityHint="Removes the folder; its albums return to My Albums"
            >
              <Icon name="trash" size={16} color={palette.danger} />
              <Text style={styles.mgrDeleteText}>Delete Folder</Text>
            </Springy>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * SmartAlbumEditor — the edit sheet for one app-local smart album: rename it, pick its rules (media
 * type / favourites-only / an optional capture-year drawn from the years present in the library), see
 * a LIVE match count, and delete it. Mirrors FolderManager's modal chrome. Every rule change persists
 * through the parent the instant it happens (so the sheet is durable even if dismissed abruptly); the
 * name commits on blur/submit/Done so a typed-but-unsubmitted name isn't lost. Rules are edited as
 * whole objects — 'all'/'Any' selections drop the field (undefined) so a ruleless album stays {}.
 */
function SmartAlbumEditor({
  album,
  years,
  matchCount,
  onRename,
  onSetRules,
  onDelete,
  onClose,
}: {
  album: SmartAlbum | null;
  years: number[];
  matchCount: number;
  onRename: (id: string, name: string) => void;
  onSetRules: (id: string, rules: SmartRules) => void;
  onDelete: (album: SmartAlbum) => void;
  onClose: () => void;
}) {
  const insets = useInsets();
  const [name, setName] = useState('');
  // Re-seed the editable name whenever a different album opens (or its stored name changes). Changing a
  // rule re-renders this with the same id+name, so an in-progress (uncommitted) name edit is preserved.
  useEffect(() => {
    if (album) setName(album.name);
  }, [album?.id, album?.name]);

  const rules: SmartRules = album?.rules ?? {};
  const commitName = () => {
    if (album) onRename(album.id, name);
  };
  const close = () => {
    commitName(); // persist a typed-but-unsubmitted rename before the sheet closes
    onClose();
  };
  const setRules = (next: SmartRules) => {
    if (album) onSetRules(album.id, next);
  };

  return (
    <Modal visible={!!album} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.mgrRoot} accessibilityViewIsModal onAccessibilityEscape={close}>
        <View style={styles.mgrHeader}>
          <LivingGradient colors={grad.brand} height={130} />
          <View style={[styles.mgrHeaderRow, { paddingTop: insets.top + 6 }]}>
            <Springy onPress={close} hitSlop={12} pressableStyle={styles.mgrBack} accessibilityLabel="Done">
              <Icon name="chevron" size={16} color={palette.accentSoft} style={styles.mgrBackChevron} />
              <Text style={styles.mgrBackText}>Done</Text>
            </Springy>
          </View>
          <Text style={styles.mgrTitle} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
            Smart Album
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={[styles.mgrScroll, { paddingBottom: insets.bottom + 24 }]}
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Name</Text>
          <View style={styles.mgrNameCard}>
            <TextInput
              style={styles.mgrNameInput}
              value={name}
              onChangeText={setName}
              onEndEditing={commitName}
              onSubmitEditing={commitName}
              placeholder="Smart album name"
              placeholderTextColor={palette.muted}
              returnKeyType="done"
              maxLength={60}
              selectionColor={palette.accent}
              accessibilityLabel="Smart album name"
            />
          </View>

          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Media Type</Text>
          <Segmented
            options={SMART_MEDIA_OPTIONS}
            value={rules.mediaType ?? 'all'}
            onChange={(k) => setRules({ ...rules, mediaType: k === 'all' ? undefined : (k as SmartMediaRule) })}
          />

          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Favorites</Text>
          <Segmented
            options={SMART_FAV_OPTIONS}
            value={rules.favorite ? 'fav' : 'all'}
            onChange={(k) => setRules({ ...rules, favorite: k === 'fav' ? true : undefined })}
          />

          <Text style={styles.mgrSectionTitle} accessibilityRole="header">Year</Text>
          {years.length === 0 ? (
            <Text style={styles.mgrNote}>No dated photos yet — add photos with a capture date to filter by year.</Text>
          ) : (
            <View style={styles.smartYearWrap}>
              <Chip label="Any" selected={rules.year === undefined} onPress={() => setRules({ ...rules, year: undefined })} />
              {years.map((y) => (
                <Chip
                  key={y}
                  label={String(y)}
                  selected={rules.year === y}
                  onPress={() => setRules({ ...rules, year: rules.year === y ? undefined : y })}
                />
              ))}
            </View>
          )}

          <Text style={styles.smartPreview}>{`Matches ${countLabel(matchCount)} now`}</Text>

          {album ? (
            <Springy
              onPress={() => onDelete(album)}
              pressableStyle={styles.mgrDelete}
              accessibilityLabel="Delete smart album"
              accessibilityHint="Removes this smart album; your photos are untouched"
            >
              <Icon name="trash" size={16} color={palette.danger} />
              <Text style={styles.mgrDeleteText}>Delete Smart Album</Text>
            </Springy>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function AlbumsScreen({
  assets,
  hiddenAssets = [],
  onFindSimilar,
  onToggleFavorite,
  onDeleteAssets,
  onHideAssets,
  duplicatesReady,
}: {
  assets: AssetMetadata[];
  hiddenAssets?: AssetMetadata[];
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  onHideAssets?: (ids: string[], hidden: boolean) => void;
  duplicatesReady?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [deviceAlbums, setDeviceAlbums] = useState<DeviceAlbum[]>([]);
  const [devIdSet, setDevIdSet] = useState<Set<string> | null>(null);
  const [devLoading, setDevLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devSelecting, setDevSelecting] = useState(false);
  const [devSelected, setDevSelected] = useState<Set<string>>(new Set());
  // Per-album Sort By + custom manual order (restored on open, persisted per device-album id). A
  // bump-counter (orderRev) forces the PhotoGrid to remount when the order changes so FlashList
  // repositions cells rather than recycling them in place.
  const [albumSort, setAlbumSort] = useState<SortMode>('newest');
  const [albumOrder, setAlbumOrder] = useState<string[]>([]);
  // Per-album content filter (All / Photos / Videos / Favorites) — restored on open, persisted per id.
  const [albumFilter, setAlbumFilter] = useState<FilterMode>('all');
  const [reordering, setReordering] = useState(false);
  const [orderRev, setOrderRev] = useState(0);
  // In-album search (Apple's search-within-a-collection): a CLIP-free query over the OPEN device album,
  // matching capture-date / app-local caption / keyword. UI-only, reset on navigation, never persisted;
  // folded into the drill-in gridKey so the grid remounts on each query change.
  const [albumQuery, setAlbumQuery] = useState('');
  // Debounced copy that actually drives the filter + the grid remount, so typing doesn't run the
  // caption/keyword DB queries AND remount the whole FlashList on every keystroke (the input itself
  // stays instant on `albumQuery`). Mirrors SearchScreen's commit-not-per-keystroke discipline.
  const [albumQueryDebounced, setAlbumQueryDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAlbumQueryDebounced(albumQuery), 250);
    return () => clearTimeout(id);
  }, [albumQuery]);
  // App-local folders grouping user albums. Loaded once from the single JSON pref (defensively parsed),
  // then persisted on every change. `expandedFolders` is UI-only; `manageFolderId` drives the manage
  // sheet. `folderSeq` gives fresh folder ids a monotonic tail so two created in the same ms can't collide.
  const [folders, setFolders] = useState<AlbumFolder[]>(() => {
    try {
      return parseFolders(getPref(FOLDERS_PREF));
    } catch {
      return [];
    }
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [manageFolderId, setManageFolderId] = useState<string | null>(null);
  const folderSeq = useRef(0);
  // App-local smart albums (rule-based dynamic albums). Loaded once from the single JSON pref
  // (defensively parsed), then persisted on every change. `editSmartId` drives the edit sheet;
  // `smartSeq` gives fresh ids a monotonic tail so two created in the same ms can't collide.
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>(() => {
    try {
      return parseSmartAlbums(getPref(SMART_PREF));
    } catch {
      return [];
    }
  });
  const [editSmartId, setEditSmartId] = useState<string | null>(null);
  const smartSeq = useRef(0);
  // App-local pinned collections — a user-curated quick-access row of go-to albums / smart albums,
  // each stored as an openKey ("dev:<id>" / "smart:<id>") in one JSON pref (defensively parsed),
  // persisted on every change and resolved LIVE against the current albums on render.
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      return parsePinned(getPref(PINNED_PREF));
    } catch {
      return [];
    }
  });
  const listRef = useRef<FlashListRef<MonthGroup>>(null);
  const groups = useMemo(() => groupByMonth(assets), [assets]);
  const favorites = useMemo(() => assets.filter((a) => a.isFavorite), [assets]);
  // Smart albums resolved against the live roll — each carries its live match set (drives the row count
  // + cover AND the drill-in grid). Recomputes only when the roll or a smart album's rules change.
  const smartResolved = useMemo(
    () => smartAlbums.map((s) => ({ album: s, items: matchSmart(assets, s.rules) })),
    [smartAlbums, assets],
  );
  // Distinct capture-years present in the roll, newest first — the smart-album year picker's source.
  const libraryYears = useMemo(() => {
    const set = new Set<number>();
    for (const a of assets) {
      const ms = toMs(a.creationTime ?? 0);
      if (ms > 0) set.add(new Date(ms).getFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }, [assets]);
  // Utilities — all pure client-side derivations over the loaded roll.
  // `assets` already arrive newest-first, so slice rather than re-sort the whole roll.
  const recentlyAdded = useMemo(() => assets.slice(0, RECENT_ADDED_MAX), [assets]);
  const recentDays = useMemo(() => groupByDay(assets, RECENT_DAYS_MAX), [assets]);
  // "Saved Today" — photos whose capture day is TODAY (same local Y/M/D as now). `now` is read at
  // RUNTIME inside the memo (never module scope), recomputing with the roll. Most days this is empty,
  // so the utility row below only appears when ≥1 photo matches.
  const savedToday = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const day = now.getDate();
    return assets.filter((a) => {
      const ms = toMs(a.creationTime ?? 0);
      if (ms <= 0) return false; // undated photos have no capture-day
      const d = new Date(ms);
      return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day;
    });
  }, [assets]);
  // Pure-geometry pano proxy — catch both horizontal AND vertical panoramas (guard null dims).
  const panoramas = useMemo(
    () =>
      assets.filter((a) => {
        const w = a.width ?? 0;
        const h = a.height ?? 0;
        return w > 0 && h > 0 && (w / h >= PANO_RATIO || h / w >= PANO_RATIO);
      }),
    [assets],
  );
  // --- App-local folders, resolved against the live device albums --------------------------------
  const albumById = useMemo(() => {
    const m = new Map<string, DeviceAlbum>();
    for (const a of deviceAlbums) m.set(a.id, a);
    return m;
  }, [deviceAlbums]);
  // Only USER (non-smart) albums are foldering-eligible — the New Folder / manage checklist source.
  const userAlbums = useMemo(() => deviceAlbums.filter((a) => !a.smart), [deviceAlbums]);
  // Resolve each pin ("dev:<id>" / "smart:<id>") against the live device / smart albums, DROPPING any
  // that no longer resolve (deleted album / removed smart album). Resolve-not-prune: we never rewrite
  // the pref here, so a transient empty device-album read can't silently wipe a pin. Each survivor
  // carries what its AlbumRow needs (its openKey + the resolved album, plus a smart album's live matches).
  const resolvedPins = useMemo<ResolvedPin[]>(() => {
    const smartById = new Map(smartResolved.map((s) => [s.album.id, s] as const));
    const out: ResolvedPin[] = [];
    for (const key of pinned) {
      if (key.startsWith('dev:')) {
        const album = albumById.get(key.slice(4));
        if (album) out.push({ key, kind: 'dev', album });
      } else if (key.startsWith('smart:')) {
        const s = smartById.get(key.slice(6));
        if (s) out.push({ key, kind: 'smart', album: s.album, items: s.items });
      }
    }
    return out;
  }, [pinned, albumById, smartResolved]);

  // "Not in an Album" — photos in no USER album. Computed lazily on open (union each user album's
  // membership, one PhotoKit query per album), with a loading state; recomputes if the album set
  // changes while open. Operates over `assets` (already hidden-partitioned), so hidden photos never leak.
  const [unfiled, setUnfiled] = useState<{ ids: Set<string>; loading: boolean }>({ ids: new Set(), loading: false });
  useEffect(() => {
    if (openKey !== 'unfiled') return;
    let alive = true;
    setUnfiled({ ids: new Set(), loading: true });
    (async () => {
      const sets = await Promise.all(
        userAlbums.map((a) => albumAssetIdSet(a.id).catch(() => new Set<string>())),
      );
      if (!alive) return;
      const union = new Set<string>();
      for (const s of sets) for (const id of s) union.add(id);
      setUnfiled({ ids: union, loading: false });
    })();
    return () => {
      alive = false;
    };
  }, [openKey, userAlbums]);
  const unfiledItems = useMemo(() => {
    if (unfiled.loading) return [];
    // albumAssetIdSet returns ph://-normalized ids; `assets[].id` may carry the scheme. Route the
    // membership test through filterByAlbum (which normalizes both sides, like the rest of this file)
    // so the complement is correct — a raw `unfiled.ids.has(a.id)` would mis-flag filed photos.
    const filed = new Set(filterByAlbum(assets, unfiled.ids).map((a) => a.id));
    return assets.filter((a) => !filed.has(a.id));
  }, [assets, unfiled]);

  // Resolve each folder's stored album ids against the CURRENT device albums, dropping any that no
  // longer resolve (deleted, or somehow smart), keyed by folder id for the tree walk. Ignore-on-render:
  // we never persist-prune here, so a transient empty device-album read (a PhotoKit hiccup) can't
  // silently wipe a folder's members.
  const albumsByFolder = useMemo(() => {
    const m = new Map<string, DeviceAlbum[]>();
    for (const f of folders) {
      m.set(
        f.id,
        f.albumIds.map((id) => albumById.get(id)).filter((a): a is DeviceAlbum => !!a && !a.smart),
      );
    }
    return m;
  }, [folders, albumById]);
  // Folder id → its resolved parent, kept ONLY when the parentId points at a real, different folder.
  // parseFolders already guarantees an acyclic forest at load; re-guarding here means a live edit can't
  // wedge the render (a dangling / self parentId is simply treated as a root).
  const parentOfFolder = useMemo(() => {
    const ids = new Set(folders.map((f) => f.id));
    const m = new Map<string, string>();
    for (const f of folders) if (f.parentId && f.parentId !== f.id && ids.has(f.parentId)) m.set(f.id, f.parentId);
    return m;
  }, [folders]);
  // Parent id → its child folders, in model order — drives the expandable hierarchy.
  const childFolders = useMemo(() => {
    const m = new Map<string, AlbumFolder[]>();
    for (const f of folders) {
      const p = parentOfFolder.get(f.id);
      if (p) {
        const arr = m.get(p);
        if (arr) arr.push(f);
        else m.set(p, [f]);
      }
    }
    return m;
  }, [folders, parentOfFolder]);
  // Root folders (no resolved parent) — the top level rendered first.
  const rootFolders = useMemo(() => folders.filter((f) => !parentOfFolder.has(f.id)), [folders, parentOfFolder]);
  // Every album id filed in ANY folder (at any nesting depth) — removed from the ungrouped list below.
  const groupedIds = useMemo(() => {
    const s = new Set<string>();
    for (const albums of albumsByFolder.values()) for (const a of albums) s.add(a.id);
    return s;
  }, [albumsByFolder]);
  // The ungrouped list: every device album not in a folder, in original PhotoKit order — this keeps ALL
  // smart albums (never folderable) plus any unfiled user album exactly where they were.
  const ungroupedAlbums = useMemo(() => deviceAlbums.filter((a) => !groupedIds.has(a.id)), [deviceAlbums, groupedIds]);
  const managedFolder = manageFolderId ? folders.find((f) => f.id === manageFolderId) ?? null : null;
  // The open device album's members within the roll (roll ∩ membership), UNFILTERED. Kept separate so
  // we can tell a genuinely empty album from one a content filter has emptied, and so reorder (which
  // rewrites the full order) always sees every member. Empty until a device album's membership loads.
  const devMembers = useMemo(() => {
    if (!openKey || !openKey.startsWith('dev:') || !devIdSet) return [];
    return filterByAlbum(assets, devIdSet);
  }, [openKey, devIdSet, assets]);
  // …then the content filter (Photos / Videos / Favorites) and the album's Sort By / custom order.
  const devItems = useMemo(
    () => applySort(applyFilter(devMembers, albumFilter), albumSort, albumOrder),
    [devMembers, albumFilter, albumSort, albumOrder],
  );
  // Apply the in-album search query, if any, over the already-ordered devItems (so the album's Sort By /
  // custom order is preserved). Union of three cheap, CLIP-free dimensions: a capture-DATE the query names
  // (month and/or year), an app-local CAPTION match, and an app-local KEYWORD match. Both replica reads
  // are guarded so a DB hiccup degrades to "no hits" for that dimension rather than throwing into render.
  // An empty query is a no-op (the whole album). external_ids equal `a.id` here (same convention as
  // Library's keyword browse / the rated filter), so membership is a direct id test.
  const devFiltered = useMemo(() => {
    const q = albumQueryDebounced.trim();
    if (!q) return devItems;
    const dateIntent = parseAlbumDate(q);
    let captionIds: Set<string> | null = null;
    try {
      captionIds = new Set(searchCaptions(q));
    } catch {
      captionIds = null;
    }
    let keywordIds: Set<string> | null = null;
    try {
      const ql = q.toLowerCase();
      const hits = new Set<string>();
      for (const [label, ids] of keywordIndex().byKeyword) {
        if (label.includes(ql)) for (const id of ids) hits.add(id);
      }
      keywordIds = hits;
    } catch {
      keywordIds = null;
    }
    return devItems.filter(
      (a) =>
        (dateIntent != null && albumDateMatches(a, dateIntent)) ||
        (captionIds != null && captionIds.has(a.id)) ||
        (keywordIds != null && keywordIds.has(a.id)),
    );
  }, [devItems, albumQueryDebounced]);
  const openDay = openKey && openKey.startsWith('day:') ? recentDays.find((d) => d.key === openKey.slice(4)) ?? null : null;
  const openMonth =
    openKey &&
    openKey !== 'favorites' &&
    openKey !== 'duplicates' &&
    openKey !== 'recent' &&
    openKey !== 'panoramas' &&
    openKey !== 'days' &&
    !openKey.startsWith('dev:') &&
    !openKey.startsWith('day:') &&
    !openKey.startsWith('smart:')
      ? groups.find((g) => g.key === openKey) ?? null
      : null;
  // A drilled-in smart album resolved against the live roll (rules re-evaluated every render), plus the
  // album currently under the edit sheet + its live match count (the sheet's preview). All memo-free —
  // cheap finds over the already-computed smartResolved / smartAlbums.
  const openSmart =
    openKey && openKey.startsWith('smart:')
      ? smartResolved.find((s) => s.album.id === openKey.slice(6)) ?? null
      : null;
  const editingSmart = editSmartId ? smartAlbums.find((s) => s.id === editSmartId) ?? null : null;
  const editSmartCount = editingSmart
    ? smartResolved.find((s) => s.album.id === editingSmart.id)?.items.length ?? 0
    : 0;

  // Load the phone's real albums once (guarded — native call; degrades to none on failure).
  useEffect(() => {
    let alive = true;
    loadDeviceAlbums()
      .then((a) => alive && setDeviceAlbums(a))
      .catch(() => alive && setDeviceAlbums([]));
    return () => {
      alive = false;
    };
  }, []);

  // When a device album drills open, read its membership (async, guarded) and intersect with the roll.
  useEffect(() => {
    if (!openKey || !openKey.startsWith('dev:')) return;
    const albumId = openKey.slice(4);
    let alive = true;
    setDevLoading(true);
    setDevIdSet(null);
    albumAssetIdSet(albumId)
      .then((set) => {
        if (!alive) return;
        setDevIdSet(set);
        setDevLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setDevIdSet(new Set());
        setDevLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [openKey]);

  // Restore the per-album Sort By + any saved custom order when a device album drills open (synchronous
  // key/value reads; both keyed by the album id). Falls back to Newest / empty order on anything missing
  // or corrupt so a bad pref can never wedge the grid.
  useEffect(() => {
    if (!openKey || !openKey.startsWith('dev:')) return;
    const albumId = openKey.slice(4);
    const savedSort = getPref('album.sort.' + albumId);
    setAlbumSort(isSortMode(savedSort) ? savedSort : 'newest');
    const savedFilter = getPref('album.filter.' + albumId);
    setAlbumFilter(isFilterMode(savedFilter) ? savedFilter : 'all');
    let ids: string[] = [];
    const savedOrder = getPref('album.order.' + albumId);
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
      } catch {
        /* corrupt pref — ignore, fall back to date order */
      }
    }
    setAlbumOrder(ids);
  }, [openKey]);

  const removingRef = useRef(false);

  // Leave selection / reorder mode and clear any in-album search whenever we navigate between albums.
  useEffect(() => {
    setDevSelecting(false);
    setDevSelected(new Set());
    setReordering(false);
    setAlbumQuery('');
    setAlbumQueryDebounced('');
  }, [openKey]);

  // Prune the selection to whatever is still in the album if the membership shrinks underneath us
  // (a background ingest, or our own optimistic remove), so we never pass stale ids to PhotoKit.
  useEffect(() => {
    if (!devIdSet) return;
    setDevSelected((prev) => {
      const next = new Set([...prev].filter((id) => devIdSet.has(id.replace(/^ph:\/\//, ''))));
      return next.size === prev.size ? prev : next;
    });
  }, [devIdSet]);

  const devToggle = (id: string) =>
    setDevSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Remove the selected photos from THIS album (they stay in the library; iOS only). Optimistically
  // prune the membership set so the grid updates without a re-read.
  const removeSelected = async (albumId: string) => {
    const ids = [...devSelected];
    if (ids.length === 0 || removingRef.current) return;
    removingRef.current = true;
    try {
      await removeAssetsFromAlbum(albumId, ids);
      setDevIdSet((prev) => {
        if (!prev) return prev;
        const n = new Set(prev);
        ids.forEach((id) => n.delete(id.replace(/^ph:\/\//, '')));
        return n;
      });
      setDevSelecting(false);
      setDevSelected(new Set());
      toast({ text: `Removed ${ids.length} from album`, tone: 'brand' });
    } catch {
      toast({ text: 'Couldn’t remove from album', tone: 'danger' });
    } finally {
      removingRef.current = false;
    }
  };

  // Change (and persist) the open album's Sort By. Leaving Custom also exits any in-progress reorder.
  const changeAlbumSort = (albumId: string, mode: SortMode) => {
    if (mode !== 'custom') setReordering(false);
    setAlbumSort(mode);
    setPref('album.sort.' + albumId, mode);
  };

  // Change (and persist) the open album's content filter (All / Photos / Videos / Favorites). The
  // gridKey folds albumFilter in, so refiltering can't leave FlashList showing recycled wrong photos.
  const changeAlbumFilter = (albumId: string, mode: FilterMode) => {
    setAlbumFilter(mode);
    setPref('album.filter.' + albumId, mode);
  };

  // Persist a full externalId order (all currently-visible ids in their new order) and bump orderRev so
  // the grid remounts to the new arrangement. Writing the FULL list also "promotes" every visible photo
  // into an explicit rank, so subsequent moves are stable.
  const persistAlbumOrder = (albumId: string, ids: string[]) => {
    setAlbumOrder(ids);
    setOrderRev((r) => r + 1);
    setPref('album.order.' + albumId, JSON.stringify(ids));
  };

  // Swap the photo at `index` with its neighbour `delta` steps away (−1 up, +1 down) in the current order.
  const moveInAlbum = (albumId: string, index: number, delta: number) => {
    const ids = devItems.map((a) => a.id);
    const j = index + delta;
    if (index < 0 || index >= ids.length || j < 0 || j >= ids.length) return;
    const tmp = ids[index];
    ids[index] = ids[j];
    ids[j] = tmp;
    persistAlbumOrder(albumId, ids);
  };

  // Lift the photo at `index` to the front of the album (its new cover / first tile).
  const moveToFront = (albumId: string, index: number) => {
    if (index <= 0) return;
    const ids = devItems.map((a) => a.id);
    if (index >= ids.length) return;
    const [id] = ids.splice(index, 1);
    ids.unshift(id);
    persistAlbumOrder(albumId, ids);
  };

  // Delete a user album (photos stay in the library) — confirmed, guarded.
  const confirmDeleteAlbum = (album: DeviceAlbum) => {
    Alert.alert('Delete Album', `“${album.title}” will be removed. Your photos stay in your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAlbum(album.id);
            setDeviceAlbums((prev) => prev.filter((a) => a.id !== album.id));
            persistPinned(pinned.filter((k) => k !== 'dev:' + album.id)); // a real delete is permanent → prune the pin
            if (openKey === 'dev:' + album.id) setOpenKey(null);
            toast({ text: `Deleted “${album.title}”`, tone: 'brand' });
          } catch {
            toast({ text: 'Couldn’t delete album', tone: 'danger' });
          }
        },
      },
    ]);
  };

  // --- Folder mutations — each persists the whole model to the single pref immediately -----------
  const persistFolders = (next: AlbumFolder[]) => {
    setFolders(next);
    try {
      setPref(FOLDERS_PREF, JSON.stringify(next));
    } catch {
      /* prefs write failed — keep the in-memory copy so this session stays consistent */
    }
  };

  // Create a folder (id derived from the wall clock + a monotonic counter INSIDE this handler — never
  // at module scope — so two folders made in the same millisecond still get distinct ids). Returns the id.
  const createFolder = (rawName: string): string => {
    const name = rawName.trim() || 'New Folder';
    const id = 'fld_' + Date.now().toString(36) + '_' + (folderSeq.current++).toString(36);
    persistFolders([...folders, { id, name, albumIds: [] }]);
    return id;
  };

  // New Folder affordance. Alert.prompt is iOS-only, so guard Platform.OS and fall back to a
  // default-named folder (renamable in the sheet) elsewhere. Either way we open the manage sheet so a
  // fresh, empty folder isn't a confusing bare row — the user names/fills it right away.
  const promptNewFolder = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'New Folder',
        'Name this folder, then choose albums to add.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: (text?: string) => setManageFolderId(createFolder(text ?? '')),
          },
        ],
        'plain-text',
        '',
      );
    } else {
      setManageFolderId(createFolder('New Folder'));
    }
  };

  const toggleFolderExpanded = (id: string) =>
    setExpandedFolders((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Rename a folder; an empty/whitespace name is ignored so the old name is never clobbered by a blur.
  const renameFolder = (id: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (folders.every((f) => f.id !== id || f.name === name)) return; // no folder, or unchanged — skip a write
    persistFolders(folders.map((f) => (f.id === id ? { ...f, name } : f)));
  };

  // Assign/unassign a user album to a folder. An album lives in at most one folder, so assigning it
  // here also strips it from any other folder (the "move" Apple does when you file an album elsewhere).
  const toggleAlbumInFolder = (folderId: string, albumId: string) => {
    persistFolders(
      folders.map((f) => {
        if (f.id === folderId) {
          const has = f.albumIds.includes(albumId);
          return { ...f, albumIds: has ? f.albumIds.filter((x) => x !== albumId) : [...f.albumIds, albumId] };
        }
        return f.albumIds.includes(albumId) ? { ...f, albumIds: f.albumIds.filter((x) => x !== albumId) } : f;
      }),
    );
  };

  // Nest a folder under `parentId` (or detach to root with null). Guards cycles: a folder can't nest
  // under itself or one of its own descendants, and the parent must resolve — anything invalid detaches
  // to root instead. Persists the whole model like the other folder mutations.
  const moveFolderToParent = (folderId: string, parentId: string | null) => {
    const byId = new Map(folders.map((f) => [f.id, f] as const));
    let valid = parentId !== null && parentId !== folderId && byId.has(parentId);
    if (valid) {
      // Walk up from parentId; if the chain reaches folderId, parentId is a descendant → would cycle.
      const seen = new Set<string>();
      let cur: string | undefined = parentId as string;
      while (cur !== undefined) {
        if (cur === folderId) {
          valid = false;
          break;
        }
        if (seen.has(cur)) break; // pre-existing cycle (shouldn't happen) — stop walking
        seen.add(cur);
        const f = byId.get(cur);
        cur = f && f.parentId && f.parentId !== f.id && byId.has(f.parentId) ? f.parentId : undefined;
      }
    }
    persistFolders(
      folders.map((f) => {
        if (f.id !== folderId) return f;
        if (valid) return { ...f, parentId: parentId as string };
        if (f.parentId === undefined) return f; // already a root — nothing to change
        const detached = { ...f };
        delete detached.parentId;
        return detached;
      }),
    );
  };

  // Delete a folder — its albums simply return to the ungrouped list (we only drop OUR grouping, never
  // the real PhotoKit albums). Confirmed, then persisted; also closes the sheet / collapses if open.
  const confirmDeleteFolder = (folder: AlbumFolder) => {
    Alert.alert(
      'Delete Folder',
      `“${folder.name}” will be removed. Its albums stay in your library, back under My Albums.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Re-home any child folders onto the deleted folder's OWN parent (its grandparent) so the
            // hierarchy stays intact and the stored model never carries a dangling parentId. If the
            // deleted folder was itself a root, its children cleanly become roots (drop the key).
            persistFolders(
              folders
                .filter((f) => f.id !== folder.id)
                .map((f) => {
                  if (f.parentId !== folder.id) return f;
                  if (folder.parentId === undefined) {
                    const rehomed = { ...f };
                    delete rehomed.parentId;
                    return rehomed;
                  }
                  return { ...f, parentId: folder.parentId };
                }),
            );
            setManageFolderId((cur) => (cur === folder.id ? null : cur));
            setExpandedFolders((prev) => {
              if (!prev.has(folder.id)) return prev;
              const n = new Set(prev);
              n.delete(folder.id);
              return n;
            });
            toast({ text: `Deleted “${folder.name}”`, tone: 'brand' });
          },
        },
      ],
    );
  };

  // --- Smart-album mutations — each persists the whole model to the single pref immediately ---------
  const persistSmart = (next: SmartAlbum[]) => {
    setSmartAlbums(next);
    try {
      setPref(SMART_PREF, JSON.stringify(next));
    } catch {
      /* prefs write failed — keep the in-memory copy so this session stays consistent */
    }
  };

  // Create a smart album (id from the wall clock + a monotonic counter INSIDE this handler — never at
  // module scope — so two made in the same millisecond still get distinct ids). Ruleless by default
  // (matches the whole roll), then shaped in the sheet. Returns the id.
  const createSmart = (rawName: string): string => {
    const name = rawName.trim() || 'Smart Album';
    const id = 'smt_' + Date.now().toString(36) + '_' + (smartSeq.current++).toString(36);
    persistSmart([...smartAlbums, { id, name, rules: {} }]);
    return id;
  };

  // New Smart Album affordance. Alert.prompt is iOS-only, so guard Platform.OS and fall back to a
  // default-named album (renamable in the sheet) elsewhere. Either way we open the edit sheet so the
  // fresh, ruleless album isn't a confusing "matches everything" row — the user names/shapes it now.
  const promptNewSmart = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'New Smart Album',
        'Name it, then choose rules to match your photos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Create', onPress: (text?: string) => setEditSmartId(createSmart(text ?? '')) },
        ],
        'plain-text',
        '',
      );
    } else {
      setEditSmartId(createSmart('Smart Album'));
    }
  };

  // Rename a smart album; an empty/whitespace name is ignored so a blur can't clobber the old name.
  const renameSmart = (id: string, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    if (smartAlbums.every((s) => s.id !== id || s.name === name)) return; // no album, or unchanged — skip a write
    persistSmart(smartAlbums.map((s) => (s.id === id ? { ...s, name } : s)));
  };

  // Replace a smart album's rules with the whole (parent-sanitised) rule object, then persist.
  const setSmartRules = (id: string, rules: SmartRules) => {
    persistSmart(smartAlbums.map((s) => (s.id === id ? { ...s, rules } : s)));
  };

  // Delete a smart album — confirmed, then persisted; also closes the sheet and the drill-in if open.
  const confirmDeleteSmart = (album: SmartAlbum) => {
    Alert.alert('Delete Smart Album', `“${album.name}” will be removed. Your photos are untouched.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          persistSmart(smartAlbums.filter((s) => s.id !== album.id));
          persistPinned(pinned.filter((k) => k !== 'smart:' + album.id)); // a real delete is permanent → prune the pin
          setEditSmartId((cur) => (cur === album.id ? null : cur));
          if (openKey === 'smart:' + album.id) setOpenKey(null);
          toast({ text: `Deleted “${album.name}”`, tone: 'brand' });
        },
      },
    ]);
  };

  // --- Pinned mutations — each persists the whole list to the single pref immediately --------------
  const persistPinned = (next: string[]) => {
    setPinned(next);
    try {
      setPref(PINNED_PREF, JSON.stringify(next));
    } catch {
      /* prefs write failed — keep the in-memory copy so this session stays consistent */
    }
  };

  // Toggle a target's pin (openKey form "dev:<id>" / "smart:<id>"): pinning appends (newest last),
  // unpinning drops it. Toasts so the tap has feedback even after the row scrolls out of view.
  const togglePinned = (key: string, name: string) => {
    if (pinned.includes(key)) {
      persistPinned(pinned.filter((k) => k !== key));
      toast({ text: `Unpinned “${name}”`, tone: 'brand' });
    } else {
      persistPinned([...pinned, key]);
      toast({ text: `Pinned “${name}”`, tone: 'brand' });
    }
  };

  // Long-press menu for a device album row: pin/unpin + (user albums only) delete. Smart device albums
  // (Screenshots/Selfies) can't be deleted, so they only get pin/unpin.
  const deviceAlbumMenu = (album: DeviceAlbum) => {
    const key = 'dev:' + album.id;
    const pin = { text: pinned.includes(key) ? 'Unpin' : 'Pin', onPress: () => togglePinned(key, album.title) };
    if (album.smart) {
      Alert.alert(album.title, undefined, [pin, { text: 'Cancel', style: 'cancel' }]);
    } else {
      Alert.alert(album.title, undefined, [
        pin,
        { text: 'Delete Album', style: 'destructive', onPress: () => confirmDeleteAlbum(album) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  // Long-press menu for an app-local smart album row: pin/unpin + edit its rules (delete lives inside
  // the editor). Preserves the previous long-press-to-edit reach, one tap deeper.
  const smartAlbumMenu = (album: SmartAlbum) => {
    const key = 'smart:' + album.id;
    Alert.alert(album.name, undefined, [
      { text: pinned.includes(key) ? 'Unpin' : 'Pin', onPress: () => togglePinned(key, album.name) },
      { text: 'Edit', onPress: () => setEditSmartId(album.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Hidden — the app-local Hidden album (select → Unhide back into the library).
  if (openKey === 'hidden') {
    return (
      <HiddenView
        assets={hiddenAssets}
        onUnhide={(idsToShow) => onHideAssets?.(idsToShow, false)}
        onBack={() => setOpenKey(null)}
        onToggleFavorite={onToggleFavorite}
        onFindSimilar={onFindSimilar}
      />
    );
  }

  // Duplicates — its own scan/review view (not a photo grid).
  if (openKey === 'duplicates') {
    return <DuplicatesView onDeleteAssets={onDeleteAssets} onBack={() => setOpenKey(null)} />;
  }

  // A drilled-in real device album — intersect its members with the loaded roll, then a living grid.
  if (openKey && openKey.startsWith('dev:')) {
    const albumId = openKey.slice(4);
    const album = deviceAlbums.find((a) => a.id === albumId);
    const title = album?.title ?? 'Album';
    const items = devItems; // roll ∩ membership, already ordered by the album's Sort By / custom order
    const trimmedQuery = albumQueryDebounced.trim();
    const searchActive = trimmedQuery.length > 0;
    // The query narrows the GRID only; Select / Sort By / reorder still operate on the full `items`.
    // gridData depends only on the (gridKey-folded) query, so toggling Select never desyncs the grid.
    const gridData = searchActive ? devFiltered : items;
    // The in-album SearchField shares the sort bar's browse-mode gating (hidden while loading /
    // selecting / reordering) so it never crowds those modes.
    const showSearch = !devLoading && items.length > 0 && !devSelecting && !reordering;
    const canRemove = !!album && !album.smart; // smart albums (Screenshots/Selfies) can't have members removed
    const canCustom = canRemove; // …and custom hand-ordering only makes sense for a reorderable user album
    const sortOptions = canCustom ? SORT_OPTIONS : SORT_OPTIONS_NOCUSTOM;
    // A stale 'custom' pref can restore on an album that can't offer Custom (e.g. one that no longer
    // resolves in deviceAlbums). Custom isn't in that album's options, so show Newest instead of an
    // orphaned highlight — devItems already degrades a memberless custom order to newest-first anyway.
    const shownSort: SortMode = canCustom ? albumSort : albumSort === 'custom' ? 'newest' : albumSort;
    const devCount = devSelected.size;
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={devSelecting ? `${devCount} selected` : title}
          meta={reordering ? 'Tap the arrows to reorder' : devLoading ? 'Loading…' : countLabel(items.length)}
          gradient={grad.brand}
          back={{ label: 'Albums', onPress: () => setOpenKey(null) }}
          right={
            reordering ? (
              <Springy onPress={() => setReordering(false)} hitSlop={12} accessibilityLabel="Done reordering">
                <Text style={styles.selectBtn} maxFontSizeMultiplier={1.3}>
                  Done
                </Text>
              </Springy>
            ) : canRemove && (items.length > 0 || devSelecting) ? (
              <Springy
                onPress={() => {
                  // Entering select: clear any active search so the grid isn't silently filtered while
                  // the (now-hidden) search field can't show/clear it.
                  if (!devSelecting) {
                    setAlbumQuery('');
                    setAlbumQueryDebounced('');
                  }
                  setDevSelecting((s) => !s);
                  setDevSelected(new Set());
                }}
                hitSlop={12}
                accessibilityLabel={devSelecting ? 'Cancel selection' : 'Select photos to remove'}
              >
                <Text style={styles.selectBtn} maxFontSizeMultiplier={1.3}>
                  {devSelecting ? 'Cancel' : 'Select'}
                </Text>
              </Springy>
            ) : null
          }
        />
        {/* Content filter — Photos / Videos / Favorites within the album. Stays visible even when a
            filter empties the grid so there's always a way back to All. Hidden while loading /
            selecting / reordering (reorder rewrites the full order, so it needs the unfiltered set). */}
        {!devLoading && devMembers.length > 0 && !devSelecting && !reordering && (
          <View style={styles.filterBar}>
            <Segmented
              options={FILTER_OPTIONS}
              value={albumFilter}
              onChange={(k) => changeAlbumFilter(albumId, k as FilterMode)}
            />
          </View>
        )}
        {/* Sort By — one control per album, restored on open; hidden while loading / selecting / reordering. */}
        {!devLoading && items.length > 0 && !devSelecting && !reordering && (
          <View style={styles.sortBar}>
            <View style={styles.sortSeg}>
              <Segmented
                options={sortOptions}
                value={shownSort}
                onChange={(k) => changeAlbumSort(albumId, k as SortMode)}
              />
            </View>
            {/* Reorder persists the FULL album order, so only offer it on the unfiltered set. */}
            {canCustom && albumSort === 'custom' && albumFilter === 'all' && (
              <Springy
                onPress={() => setReordering(true)}
                pressableStyle={styles.reorderBtn}
                scaleTo={0.95}
                accessibilityLabel="Reorder photos"
                accessibilityHint="Arrange the album's photos by hand"
              >
                <Text style={styles.reorderText}>Reorder</Text>
              </Springy>
            )}
          </View>
        )}
        {/* Search within this album — a CLIP-free query (capture-date / app-local caption / keyword)
            over the open album's photos, unioned and kept in album order. Shares the sort bar's
            browse-mode gating and folds into the grid's gridKey so it remounts on each query change. */}
        {showSearch && (
          <View style={styles.searchBar}>
            <SearchField
              value={albumQuery}
              onChangeText={setAlbumQuery}
              onClear={() => setAlbumQuery('')}
              placeholder="Search this album"
            />
          </View>
        )}
        {devLoading ? (
          <Center>
            <Loader label="Reading album…" color={palette.accent} />
          </Center>
        ) : items.length === 0 ? (
          // Distinguish a truly empty album from one a content filter has emptied — the latter keeps a
          // one-tap route back to All (on top of the still-visible filter bar above).
          albumFilter !== 'all' && devMembers.length > 0 ? (
            <EmptyState
              orb
              glyph={FILTER_EMPTY[albumFilter].glyph}
              title={FILTER_EMPTY[albumFilter].title}
              subtitle={FILTER_EMPTY[albumFilter].subtitle}
              orbColor={albumFilter === 'favorites' ? palette.pink : palette.accent}
              action={
                <Springy onPress={() => changeAlbumFilter(albumId, 'all')} hitSlop={12} accessibilityLabel="Show all photos">
                  <Text style={styles.selectBtn}>Show all</Text>
                </Springy>
              }
            />
          ) : (
            <EmptyState
              orb
              glyph="🖼️"
              title="No photos here"
              subtitle="This album has no photos in your library (it may hold only videos, or you removed them all)."
              orbColor={palette.accent}
            />
          )
        ) : reordering ? (
          // A dedicated reorder mode: one row per photo with move-to-top / up / down controls (no DnD
          // native dep). Each move persists the full order immediately, so it's durable mid-arrange.
          <FlashList
            data={items}
            keyExtractor={(a) => a.id}
            // A Top/Up/Down move keeps the item COUNT constant, so keying extraData on length would
            // never fire on the very operation it guards. orderRev bumps on every persisted move,
            // forcing recycled cells to re-render with a fresh index (position label, boundary
            // disable, and the move handlers all close over index) — no stale wrong-photo mis-target.
            extraData={orderRev}
            renderItem={({ item, index }) => {
              const first = index === 0;
              const last = index === items.length - 1;
              return (
                <View style={styles.reorderRow}>
                  <Image
                    source={{ uri: assetUri(item.id) }}
                    style={styles.reorderThumb}
                    recyclingKey={item.id}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    transition={120}
                    accessibilityIgnoresInvertColors
                  />
                  <View style={styles.reorderInfo}>
                    <Text style={styles.reorderName} numberOfLines={1}>
                      {item.filename ?? 'Photo'}
                    </Text>
                    <Text style={styles.reorderPos}>{`#${index + 1}`}</Text>
                  </View>
                  <View style={styles.reorderCtrls}>
                    <Springy
                      onPress={() => moveToFront(albumId, index)}
                      disabled={first}
                      hitSlop={6}
                      pressableStyle={[styles.reorderCtrl, first && styles.reorderCtrlOff]}
                      accessibilityLabel="Move to top"
                    >
                      <Text style={styles.reorderTopText}>Top</Text>
                    </Springy>
                    <Springy
                      onPress={() => moveInAlbum(albumId, index, -1)}
                      disabled={first}
                      hitSlop={6}
                      pressableStyle={[styles.reorderCtrl, first && styles.reorderCtrlOff]}
                      accessibilityLabel="Move up"
                    >
                      <Icon name="chevron" size={15} color={palette.accentSoft} style={styles.upChevron} />
                    </Springy>
                    <Springy
                      onPress={() => moveInAlbum(albumId, index, 1)}
                      disabled={last}
                      hitSlop={6}
                      pressableStyle={[styles.reorderCtrl, last && styles.reorderCtrlOff]}
                      accessibilityLabel="Move down"
                    >
                      <Icon name="chevron" size={15} color={palette.accentSoft} style={styles.downChevron} />
                    </Springy>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.list}
          />
        ) : searchActive && gridData.length === 0 ? (
          // A query that matches nothing in this album — a compact empty state with a one-tap clear.
          <EmptyState
            glyph="🔍"
            title="No matches"
            subtitle={`Nothing in this album matches “${trimmedQuery}”. Try a month, year, caption, or keyword.`}
            orbColor={palette.accent}
            action={
              <Springy onPress={() => setAlbumQuery('')} hitSlop={12} accessibilityLabel="Clear search">
                <Text style={styles.selectBtn}>Clear search</Text>
              </Springy>
            }
          />
        ) : (
          <PhotoGrid
            data={gridData}
            gridKey={`${openKey}:${albumSort}:${orderRev}:${albumFilter}:${trimmedQuery}`}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            selection={canRemove ? { active: devSelecting, selected: devSelected, onToggle: devToggle } : undefined}
          />
        )}
        <Reveal visible={devSelecting && devCount > 0} style={styles.removeBar}>
          <Springy
            pressableStyle={styles.removeAction}
            onPress={() => removeSelected(albumId)}
            accessibilityLabel={`Remove ${devCount} photo${devCount === 1 ? '' : 's'} from album`}
          >
            <View style={styles.removeInner}>
              <Icon name="close" size={16} color={palette.danger} strokeWidth={2} />
              <Text style={styles.removeText}>Remove from album</Text>
              <RollingNumber value={devCount} fontSize={15} style={styles.removeText} />
            </View>
          </Springy>
        </Reveal>
      </View>
    );
  }

  // The "Recent Days" list — one living row per distinct capture-day, each drilling into its own grid.
  if (openKey === 'days') {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Recent Days"
          meta={`${recentDays.length} day${recentDays.length === 1 ? '' : 's'}`}
          gradient={grad.search}
          accent={palette.cyan}
          back={{ label: 'Albums', onPress: () => setOpenKey(null) }}
        />
        {recentDays.length === 0 ? (
          <EmptyState
            orb
            glyph="📅"
            title="No dated photos"
            subtitle="Photos with a capture date show up here, grouped by the day you took them."
            orbColor={palette.cyan}
          />
        ) : (
          <FlashList
            data={recentDays}
            keyExtractor={(d) => d.key}
            renderItem={({ item }) => (
              <AlbumRow
                onPress={() => setOpenKey('day:' + item.key)}
                accessibilityLabel={`${item.label}, ${countLabel(item.items.length)}`}
                cover={<PhotoCover id={item.items[0].id} />}
                title={item.label}
                sub={countLabel(item.items.length)}
              />
            )}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    );
  }

  // "Not in an Album" — the unfiled inbox (async membership union → complement of `assets`).
  if (openKey === 'unfiled') {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Not in an Album"
          meta={unfiled.loading ? 'Scanning…' : countLabel(unfiledItems.length)}
          gradient={grad.brand}
          back={{ label: 'Albums', onPress: () => setOpenKey(null) }}
        />
        {unfiled.loading ? (
          <Center>
            <Loader />
          </Center>
        ) : unfiledItems.length === 0 ? (
          <EmptyState
            orb
            glyph="🗂️"
            title="Everything’s filed"
            subtitle="Every photo is in at least one album."
            orbColor={palette.accent}
          />
        ) : (
          <PhotoGrid
            data={unfiledItems}
            gridKey="unfiled"
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            onDeleteAssets={onDeleteAssets}
          />
        )}
      </View>
    );
  }

  // Recently Added / Saved Today / Panoramas / a single Recent Day — a utility photo grid with a living header.
  if (openKey && (openKey === 'recent' || openKey === 'today' || openKey === 'panoramas' || openKey.startsWith('day:'))) {
    let title = 'Photos';
    let items: AssetMetadata[] = [];
    let gradient: readonly [string, string] = grad.brand;
    let accent: string | undefined;
    let back = { label: 'Albums', onPress: () => setOpenKey(null) };
    let glyph = '🖼️';
    if (openKey === 'recent') {
      title = 'Recently Added';
      items = recentlyAdded;
      gradient = grad.brand;
      glyph = '🆕';
    } else if (openKey === 'today') {
      title = 'Saved Today';
      items = savedToday;
      gradient = grad.favorite;
      accent = palette.pink;
      glyph = '📸';
    } else if (openKey === 'panoramas') {
      title = 'Panoramas';
      items = panoramas;
      gradient = grad.desktop;
      accent = palette.cyan;
      glyph = '🌄';
    } else {
      title = openDay?.label ?? 'Day';
      items = openDay?.items ?? [];
      gradient = grad.search;
      accent = palette.cyan;
      glyph = '📅';
      back = { label: 'Recent Days', onPress: () => setOpenKey('days') };
    }
    return (
      <View style={styles.root}>
        <ScreenHeader title={title} meta={countLabel(items.length)} gradient={gradient} accent={accent} back={back} />
        {items.length === 0 ? (
          <EmptyState
            orb
            glyph={glyph}
            title="Nothing here yet"
            subtitle="There aren’t any photos in this view."
            orbColor={accent ?? palette.accent}
          />
        ) : (
          <PhotoGrid data={items} gridKey={openKey} onFindSimilar={onFindSimilar} onToggleFavorite={onToggleFavorite} />
        )}
      </View>
    );
  }

  // A drilled-in smart album — its rules evaluated live over the roll, then a living grid. The rule
  // signature is folded into gridKey so an edited rule set remounts the grid (no recycled stale cells).
  // The edit sheet is mounted here too, so Edit works while viewing the album (delete navigates back).
  if (openSmart) {
    const { album, items } = openSmart;
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={album.name}
          meta={countLabel(items.length)}
          gradient={grad.brand}
          accent={palette.magenta}
          back={{ label: 'Albums', onPress: () => setOpenKey(null) }}
          right={
            <Springy onPress={() => setEditSmartId(album.id)} hitSlop={12} accessibilityLabel="Edit smart album">
              <Text style={styles.selectBtn} maxFontSizeMultiplier={1.3}>
                Edit
              </Text>
            </Springy>
          }
        />
        {items.length === 0 ? (
          <EmptyState
            orb
            glyph="✨"
            title="No matches"
            subtitle={`Nothing in your library matches ${smartRuleSummary(album.rules).toLowerCase()} right now.`}
            orbColor={palette.magenta}
            action={
              <Springy onPress={() => setEditSmartId(album.id)} hitSlop={12} accessibilityLabel="Edit rules">
                <Text style={styles.selectBtn}>Edit rules</Text>
              </Springy>
            }
          />
        ) : (
          <PhotoGrid
            data={items}
            gridKey={`${openKey}:${smartRuleSig(album.rules)}`}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
          />
        )}
        <SmartAlbumEditor
          album={editingSmart}
          years={libraryYears}
          matchCount={editSmartCount}
          onRename={renameSmart}
          onSetRules={setSmartRules}
          onDelete={confirmDeleteSmart}
          onClose={() => setEditSmartId(null)}
        />
      </View>
    );
  }

  // A drilled-in album (Favorites, or a month) — its own grid with a living gradient header.
  if (openKey === 'favorites' || openMonth) {
    const isFav = openKey === 'favorites';
    const title = isFav ? 'Favorites' : openMonth!.label;
    const items = isFav ? favorites : openMonth!.items;
    return (
      <View style={styles.root}>
        <ScreenHeader
          title={title}
          meta={countLabel(items.length)}
          gradient={isFav ? grad.favorite : grad.brand}
          accent={isFav ? palette.pink : undefined}
          back={{ label: 'Albums', onPress: () => setOpenKey(null) }}
        />
        {items.length === 0 ? (
          <EmptyState
            orb
            glyph="🖼️"
            title="Nothing here yet"
            subtitle="This album doesn’t have any photos yet."
            orbColor={isFav ? palette.pink : palette.accent}
          />
        ) : (
          <PhotoGrid
            data={items}
            gridKey={openKey!}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
          />
        )}
      </View>
    );
  }

  // Render one folder and (when expanded) its child folders + member albums, recursing down the tree.
  // The per-level `visited` set is what guarantees termination: parseFolders yields an acyclic forest
  // and each level clones+adds its own id, so recursion always bottoms out even against a pathological
  // live edit — we NEVER drop a folder for being "too deep" (that would strand its albums with no row
  // to reach them). MAX_FOLDER_DEPTH is a VISUAL clamp only: past it we stop adding indentation rails
  // so deep trees don't march off-screen, but every folder + album still renders and stays reachable.
  // Nested nodes carry `folderChild` on their own root View, so indentation accumulates through the
  // physical JSX nesting (a child folder's members sit one rail deeper than the child folder itself).
  const renderFolderNode = (folder: AlbumFolder, depth: number, visited: Set<string>): React.ReactNode => {
    if (visited.has(folder.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(folder.id);
    const albums = albumsByFolder.get(folder.id) ?? [];
    const kids = childFolders.get(folder.id) ?? [];
    const expanded = expandedFolders.has(folder.id);
    return (
      <View key={folder.id} style={depth > 1 && depth <= MAX_FOLDER_DEPTH ? styles.folderChild : undefined}>
        <FolderRow
          name={folder.name}
          sub={folderSummary(albums.length, kids.length)}
          expanded={expanded}
          onToggle={() => toggleFolderExpanded(folder.id)}
          onManage={() => setManageFolderId(folder.id)}
        />
        {expanded && (
          <>
            {kids.map((c) => renderFolderNode(c, depth + 1, nextVisited))}
            {albums.map((a) => (
              <View key={a.id} style={styles.folderChild}>
                <AlbumRow
                  onPress={() => setOpenKey('dev:' + a.id)}
                  onLongPress={() => deviceAlbumMenu(a)}
                  accessibilityLabel={`${a.title}, album in folder ${folder.name}`}
                  accessibilityHint="Opens the album. Long press for options."
                  cover={<GlyphCover tone={palette.accent} icon="grid" />}
                  title={a.title}
                  sub="Album"
                />
              </View>
            ))}
            {albums.length === 0 && kids.length === 0 && (
              <Text style={styles.folderEmpty}>Empty — long-press the folder to add albums.</Text>
            )}
          </>
        )}
      </View>
    );
  };

  const hasContent = favorites.length > 0 || groups.length > 0 || deviceAlbums.length > 0;
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Albums"
        kicker="Collections"
        gradient={grad.brand}
        meta={`${groups.length} month${groups.length === 1 ? '' : 's'}`}
        right={
          <Springy onPress={() => setSettingsOpen(true)} hitSlop={12} accessibilityLabel="Settings">
            <Icon name="sliders" size={20} color={palette.accentSoft} />
          </Springy>
        }
      />
      {!hasContent ? (
        <EmptyState
          orb
          glyph="🗂️"
          title="No albums yet"
          subtitle="Photos you add are grouped into months automatically."
        />
      ) : (
        <View style={styles.listWrap}>
          <FlashList
            ref={listRef}
            data={groups}
            keyExtractor={(g) => g.key}
            ListHeaderComponent={
              <>
                {/* Pinned — a user-curated quick-access row of go-to albums / smart albums, resolved
                    live against the current library. Only shown when ≥1 pin still resolves; tap opens
                    it via the existing openKey path, long-press reveals the same menu as its home row. */}
                {resolvedPins.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel} accessibilityRole="header">Pinned</Text>
                    {resolvedPins.map((p) =>
                      p.kind === 'dev' ? (
                        <AlbumRow
                          key={p.key}
                          onPress={() => setOpenKey(p.key)}
                          onLongPress={() => deviceAlbumMenu(p.album)}
                          accessibilityLabel={`${p.album.title}, pinned ${p.album.smart ? 'smart album' : 'album'}`}
                          accessibilityHint="Opens the album. Long press for options."
                          cover={<GlyphCover tone={palette.accent} icon="grid" />}
                          title={p.album.title}
                          sub={p.album.smart ? 'Smart album' : 'Device album'}
                        />
                      ) : (
                        <AlbumRow
                          key={p.key}
                          onPress={() => setOpenKey(p.key)}
                          onLongPress={() => smartAlbumMenu(p.album)}
                          accessibilityLabel={`${p.album.name}, pinned smart album, ${countLabel(p.items.length)}`}
                          accessibilityHint="Opens the smart album. Long press for options."
                          cover={
                            p.items.length > 0 ? (
                              <PhotoCover id={p.items[0].id} />
                            ) : (
                              <GlyphCover tone={palette.magenta} icon="spark" />
                            )
                          }
                          title={p.album.name}
                          sub={countLabel(p.items.length)}
                        />
                      ),
                    )}
                  </>
                )}
                {favorites.length > 0 && (
                  <AlbumRow
                    onPress={() => setOpenKey('favorites')}
                    accessibilityLabel={`Favorites, ${countLabel(favorites.length)}`}
                    cover={<GlyphCover tone={palette.pink} icon="heartFill" />}
                    title="Favorites"
                    sub={countLabel(favorites.length)}
                  />
                )}
                {duplicatesReady && (
                  <AlbumRow
                    onPress={() => setOpenKey('duplicates')}
                    accessibilityLabel="Duplicates, find near-identical photos"
                    cover={<GlyphCover tone={palette.accent} icon="stack" />}
                    title="Duplicates"
                    sub="Find near-identical photos"
                  />
                )}
                {onHideAssets && (
                  <AlbumRow
                    onPress={() => setOpenKey('hidden')}
                    accessibilityLabel={`Hidden, ${countLabel(hiddenAssets.length)}`}
                    accessibilityHint="Photos you've hidden from the library, on-device only"
                    cover={<GlyphCover tone={palette.sub} icon="eyeOff" />}
                    title="Hidden"
                    sub={hiddenAssets.length > 0 ? countLabel(hiddenAssets.length) : 'On-device only'}
                  />
                )}
                {recentlyAdded.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel} accessibilityRole="header">Utilities</Text>
                    <AlbumRow
                      onPress={() => setOpenKey('recent')}
                      accessibilityLabel={`Recently Added, ${countLabel(recentlyAdded.length)}`}
                      cover={<PhotoCover id={recentlyAdded[0].id} />}
                      title="Recently Added"
                      sub={countLabel(recentlyAdded.length)}
                    />
                    {savedToday.length > 0 && (
                      <AlbumRow
                        onPress={() => setOpenKey('today')}
                        accessibilityLabel={`Saved Today, ${countLabel(savedToday.length)}`}
                        accessibilityHint="Opens the photos you captured today"
                        cover={<PhotoCover id={savedToday[0].id} />}
                        title="Saved Today"
                        sub={countLabel(savedToday.length)}
                      />
                    )}
                    {recentDays.length > 0 && (
                      <AlbumRow
                        onPress={() => setOpenKey('days')}
                        accessibilityLabel={`Recent Days, ${recentDays.length} day${recentDays.length === 1 ? '' : 's'}`}
                        accessibilityHint="Opens a list of your recent capture days"
                        cover={<GlyphCover tone={palette.cyan} icon="grid" />}
                        title="Recent Days"
                        sub={`${recentDays.length} day${recentDays.length === 1 ? '' : 's'}`}
                      />
                    )}
                    {panoramas.length > 0 && (
                      <AlbumRow
                        onPress={() => setOpenKey('panoramas')}
                        accessibilityLabel={`Panoramas, ${countLabel(panoramas.length)}`}
                        cover={<PhotoCover id={panoramas[0].id} />}
                        title="Panoramas"
                        sub={countLabel(panoramas.length)}
                      />
                    )}
                    {userAlbums.length > 0 && (
                      <AlbumRow
                        onPress={() => {
                          // Reset to loading in the SAME batch as navigation so the first render shows
                          // the spinner, never a one-frame flash of the whole (un-complemented) library.
                          setUnfiled({ ids: new Set(), loading: true });
                          setOpenKey('unfiled');
                        }}
                        accessibilityLabel="Not in an Album, photos filed in no album"
                        accessibilityHint="Shows photos that aren't in any of your albums"
                        cover={<GlyphCover tone={palette.cyan} icon="stack" />}
                        title="Not in an Album"
                        sub="Unfiled photos"
                      />
                    )}
                  </>
                )}
                {/* Smart Albums — app-local rule-based dynamic albums, evaluated live over the roll.
                    Always shown (even with none) so the New Smart Album entry point is reachable; tap
                    a row to drill into its live matches, long-press to edit its rules / delete it. */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionLabel} accessibilityRole="header">Smart Albums</Text>
                  <Springy
                    onPress={promptNewSmart}
                    hitSlop={8}
                    pressableStyle={styles.newFolderBtn}
                    scaleTo={0.95}
                    accessibilityLabel="New smart album"
                    accessibilityHint="Save a set of rules as a live album"
                  >
                    <Text style={styles.newFolderPlus}>+</Text>
                    <Text style={styles.newFolderText}>New Smart Album</Text>
                  </Springy>
                </View>
                {smartResolved.length === 0 ? (
                  <Text style={styles.smartHint}>
                    Save rules — like Favorite videos from 2026 — as a live album that keeps itself up to date.
                  </Text>
                ) : (
                  smartResolved.map(({ album, items }) => (
                    <AlbumRow
                      key={album.id}
                      onPress={() => setOpenKey('smart:' + album.id)}
                      onLongPress={() => smartAlbumMenu(album)}
                      accessibilityLabel={`${album.name}, smart album, ${countLabel(items.length)}`}
                      accessibilityHint="Opens the smart album. Long press for options."
                      cover={
                        items.length > 0 ? (
                          <PhotoCover id={items[0].id} />
                        ) : (
                          <GlyphCover tone={palette.magenta} icon="spark" />
                        )
                      }
                      title={album.name}
                      sub={countLabel(items.length)}
                    />
                  ))
                )}
                {deviceAlbums.length > 0 && (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.sectionLabel} accessibilityRole="header">My Albums</Text>
                      {userAlbums.length > 0 && (
                        <Springy
                          onPress={promptNewFolder}
                          hitSlop={8}
                          pressableStyle={styles.newFolderBtn}
                          scaleTo={0.95}
                          accessibilityLabel="New folder"
                          accessibilityHint="Create a folder to group your albums"
                        >
                          <Text style={styles.newFolderPlus}>+</Text>
                          <Text style={styles.newFolderText}>New Folder</Text>
                        </Springy>
                      )}
                    </View>
                    {/* App-local folders, rendered as a hierarchy (root folders first). Tap a folder to
                        expand its child folders (indented) AND its member albums; long-press to manage.
                        Member rows drill in exactly like ungrouped albums. renderFolderNode recurses,
                        guarded by a visited set + MAX_FOLDER_DEPTH so no cyclic / deep nesting wedges it. */}
                    {rootFolders.map((f) => renderFolderNode(f, 1, new Set<string>()))}
                    {/* Ungrouped: every album not filed in a folder (all smart albums + unfiled user albums). */}
                    {ungroupedAlbums.map((a) => (
                      <AlbumRow
                        key={a.id}
                        onPress={() => setOpenKey('dev:' + a.id)}
                        onLongPress={() => deviceAlbumMenu(a)}
                        accessibilityLabel={`${a.title}, device album`}
                        accessibilityHint="Opens the album. Long press for options."
                        cover={<GlyphCover tone={palette.accent} icon="grid" />}
                        title={a.title}
                        sub={a.smart ? 'Smart album' : 'Device album'}
                      />
                    ))}
                  </>
                )}
                {groups.length > 0 && <Text style={styles.sectionLabel} accessibilityRole="header">Months</Text>}
              </>
            }
            renderItem={({ item }) => (
              <AlbumRow
                onPress={() => setOpenKey(item.key)}
                accessibilityLabel={`${item.label}, ${countLabel(item.items.length)}`}
                cover={<PhotoCover id={item.items[0].id} />}
                title={item.label}
                sub={countLabel(item.items.length)}
              />
            )}
            contentContainerStyle={styles.list}
          />
          {groups.length > 12 && (
            <DateScrubber
              count={groups.length}
              labelAt={(i) => groups[i]?.label ?? ''}
              onScrubTo={(i) => {
                try {
                  listRef.current?.scrollToIndex({ index: i, animated: false });
                } catch {
                  /* list not measured yet — ignore */
                }
              }}
            />
          )}
        </View>
      )}
      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <FolderManager
        folder={managedFolder}
        userAlbums={userAlbums}
        folders={folders}
        onRename={renameFolder}
        onToggleAlbum={toggleAlbumInFolder}
        onSetParent={moveFolderToParent}
        onDelete={confirmDeleteFolder}
        onClose={() => setManageFolderId(null)}
      />
      <SmartAlbumEditor
        album={editingSmart}
        years={libraryYears}
        matchCount={editSmartCount}
        onRename={renameSmart}
        onSetRules={setSmartRules}
        onDelete={confirmDeleteSmart}
        onClose={() => setEditSmartId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listWrap: { flex: 1 },
  sectionLabel: {
    ...typography.kicker,
    color: palette.sub,
    marginLeft: 8,
    marginTop: 12,
    marginBottom: 8,
  },

  list: { paddingHorizontal: 12, paddingTop: 4 },
  rowOuter: { marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: hairline,
  },

  coverWrap: { width: 64, height: 64, borderRadius: radius.md },
  coverClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: palette.cell,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  coverRim: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: tint('#ffffff', 0.22) },

  info: { flex: 1, marginLeft: 14 },
  albumTitle: { color: palette.text, ...typography.cardTitle },
  albumCount: { color: palette.muted, ...typography.meta, marginTop: 2, fontVariant: ['tabular-nums'] },
  chevron: { marginRight: 8 },
  // The disclosure chevron rotated to point down when a folder is expanded (collapsed reuses `chevron`).
  chevronOpen: { marginRight: 8, transform: [{ rotate: '90deg' }] },

  // "My Albums" header row carrying the label + the New Folder pill on the right.
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newFolderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: tint(palette.magenta, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.magenta, tintBorder.rest),
  },
  newFolderPlus: { color: palette.magenta, fontSize: 16, fontWeight: '800', marginTop: -1 },
  newFolderText: { color: palette.magenta, fontSize: 13, fontWeight: '700' },
  // A folder's expanded member albums, indented under a magenta rail that ties them to the folder cover.
  folderChild: { marginLeft: 16, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: tint(palette.magenta, 0.4) },
  folderEmpty: {
    color: palette.muted,
    fontSize: 13,
    marginLeft: 16,
    paddingLeft: 10,
    marginBottom: 10,
    borderLeftWidth: 2,
    borderLeftColor: tint(palette.magenta, 0.4),
    paddingVertical: 6,
  },

  selectBtn: { color: palette.accent, fontSize: 16, fontWeight: '700' },
  removeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.popover,
    borderTopColor: tint(palette.danger, tintBorder.faint),
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  removeAction: { alignItems: 'center' },
  removeInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeText: { color: palette.danger, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Content-filter bar (the All / Photos / Videos / Favorites Segmented) sitting above the Sort By bar.
  filterBar: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 2 },
  // In-album search bar (the SearchField) sitting just above the drill-in grid.
  searchBar: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6 },
  // Sort By bar (the Segmented + optional Reorder button) sitting under the drill-in header.
  sortBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  sortSeg: { flex: 1 },
  reorderBtn: {
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  reorderText: { color: palette.accent, fontSize: 13, fontWeight: '700' },

  // Reorder mode — a vertical list of thumbnail rows with move-to-top / up / down controls.
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.input,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: hairline,
  },
  reorderThumb: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: palette.cell },
  reorderInfo: { flex: 1, marginLeft: 12 },
  reorderName: { color: palette.text, ...typography.body },
  reorderPos: { color: palette.muted, ...typography.caption, marginTop: 2, fontVariant: ['tabular-nums'] },
  reorderCtrls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reorderCtrl: {
    minWidth: 38,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceHi,
    borderWidth: 1,
    borderColor: hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderCtrlOff: { opacity: 0.32 },
  reorderTopText: { color: palette.accentSoft, fontSize: 12, fontWeight: '800' },
  upChevron: { transform: [{ rotate: '-90deg' }] },
  downChevron: { transform: [{ rotate: '90deg' }] },

  // --- FolderManager sheet (mirrors the SettingsScreen modal chrome) ----------------------------
  mgrRoot: { flex: 1, backgroundColor: palette.bg },
  mgrHeader: { paddingHorizontal: 16, paddingBottom: 12, overflow: 'hidden' },
  mgrHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  mgrBack: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  mgrBackChevron: { transform: [{ rotate: '180deg' }] },
  mgrBackText: { color: palette.accentSoft, fontSize: 15, fontWeight: '700' },
  mgrTitle: { color: palette.text, ...typography.largeTitle },

  mgrScroll: { padding: 16, gap: 4 },
  mgrSectionTitle: {
    ...typography.kicker,
    color: palette.sub,
    marginLeft: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  mgrNameCard: {
    backgroundColor: palette.popover,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: hairline,
    paddingHorizontal: 14,
  },
  mgrNameInput: { color: palette.text, fontSize: 16, fontWeight: '600', paddingVertical: 14 },
  mgrCard: {
    backgroundColor: palette.popover,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: hairline,
    overflow: 'hidden',
  },
  mgrRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  mgrRowDivider: { borderTopColor: hairline, borderTopWidth: StyleSheet.hairlineWidth },
  mgrRowInfo: { flex: 1, marginLeft: 12 },
  mgrRowTitle: { color: palette.text, ...typography.body },
  mgrRowSub: { color: palette.muted, ...typography.caption, marginTop: 2 },
  mgrCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: tint('#ffffff', 0.25),
    alignItems: 'center',
    justifyContent: 'center',
  },
  mgrCheckOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  mgrDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: tint(palette.danger, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.danger, tintBorder.rest),
  },
  mgrDeleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  mgrNote: { color: palette.muted, fontSize: 13, lineHeight: 19, paddingHorizontal: 6, paddingVertical: 4 },

  // --- Smart albums (section hint + edit-sheet year picker / live preview) -----------------------
  // Section-level hint shown when there are no smart albums yet (sits under the Smart Albums header).
  smartHint: { color: palette.muted, fontSize: 13, lineHeight: 19, marginLeft: 8, marginBottom: 10, paddingVertical: 2 },
  // The edit sheet's wrapping year-chip row (Any + one chip per capture-year present in the library).
  smartYearWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The live "Matches N photos now" line under the rule builder.
  smartPreview: { color: palette.accentSoft, fontSize: 13, fontWeight: '700', marginTop: 20, marginLeft: 6, fontVariant: ['tabular-nums'] },
});
