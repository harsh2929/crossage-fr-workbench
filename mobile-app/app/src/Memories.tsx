/**
 * MemoriesCarousel — the "For You" lead surface on Library: a horizontally-paging strip of memory
 * cards (a photo cover under a living-gradient chrome band with a title). Groups are computed
 * client-side from the already-loaded camera roll — "On This Day" (this calendar day in past years)
 * and "Recent favorites" — so it needs no new backend data.
 *
 * Tapping a card calls onOpen(group) so the host (Library) can show that set as a scoped grid.
 *
 * Each card also carries an Edit affordance (Apple Photos' memory edit): a sheet to rename the memory
 * (title + optional subtitle) and pick its key photo. Those overrides persist per memory key in the
 * prefs key/value store (no schema change) and are overlaid on the computed memory at build time.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import { Image } from 'expo-image';
import { type AssetMetadata } from 'expo-media-library';
import { assetUri } from './media';
import { palette, grad, glowMd, glowSm, radius, tint, typography, tintBorder, hairline, dur } from './theme';
import { Springy, LivingGradient, GradientButton, Scrim } from './motion';
import { Chip } from './fields';
import { Icon } from './Icon';
import { getPref, setPref } from './replica';
import { toast } from './Toast';
import { Slideshow } from './Slideshow';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.round(SCREEN_W - 56);
// Height only (NOT width — snapToInterval pages on CARD_W+GAP): trimmed from 172 so the first grid
// row peeks into the first viewport on Library. The living gradient + title band are unaffected.
const CARD_H = 150;
const GAP = 12;

export interface MemoryGroup {
  key: string;
  title: string;
  subtitle: string;
  items: AssetMetadata[];
  gradient: readonly [string, string];
}

/** expo-media-library reports creationTime in ms; tolerate seconds just in case. */
function toMs(raw: number | null): number {
  if (!raw) return 0;
  return raw > 0 && raw < 1e11 ? raw * 1000 : raw;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Year in Review — a year needs at least this many photos to earn a recap (skip a thin year rather
// than show a 2-photo "year in review"); the curated highlight set is capped at RECAP_MAX members.
const RECAP_MIN = 24;
const RECAP_MAX = 40;

/**
 * Curate a Year-in-Review highlight set for one calendar year: favour favorited photos and spread the
 * picks across the months so the recap reads like the whole year, not one busy week. Deterministic —
 * a round-robin over the 12 month buckets (each with its favorites front-loaded), no randomness — so
 * the same library always yields the same recap. `months` is the year's 12 buckets in month order
 * (each newest-first, some possibly empty). Returns up to RECAP_MAX members, led by a favorited cover
 * when the year has one (else the first pick already leads), so items[0] is a valid card cover.
 */
function selectRecapItems(months: AssetMetadata[][]): AssetMetadata[] {
  // Per-month queue: favorites first (stable, so newest-first survives within each partition), rest after.
  const queues = months.map((list) => list.filter((a) => a.isFavorite).concat(list.filter((a) => !a.isFavorite)));
  const selected: AssetMetadata[] = [];
  const ptr = new Array(12).fill(0);
  let advanced = true;
  while (selected.length < RECAP_MAX && advanced) {
    advanced = false;
    for (let m = 0; m < 12 && selected.length < RECAP_MAX; m++) {
      const q = queues[m];
      if (ptr[m] < q.length) {
        selected.push(q[ptr[m]++]);
        advanced = true; // took a photo from month m — keep looping the round-robin
      }
    }
  }
  // Lead with a favorited cover when the year has one (round-robin already front-loads them, but a busy
  // January could push a later month's favorite behind Jan's non-favorites — promote the first favorite).
  const fi = selected.findIndex((a) => a.isFavorite);
  if (fi > 0) selected.unshift(selected.splice(fi, 1)[0]);
  return selected;
}

export function buildMemories(assets: AssetMetadata[]): MemoryGroup[] {
  const now = new Date();
  const mm = now.getMonth();
  const dd = now.getDate();
  const thisYear = now.getFullYear();

  const onThisDay = assets.filter((a) => {
    const ms = toMs(a.creationTime);
    if (!ms) return false;
    const d = new Date(ms);
    return d.getMonth() === mm && d.getDate() === dd && d.getFullYear() !== thisYear;
  });

  // One Year Ago — captured within ±3 calendar days of exactly 365 days before now. Deduplicated
  // against On This Day so a photo from ~365 days ago never appears in two cards at once.
  const onThisDayIds = new Set(onThisDay.map((a) => a.id));
  const oneYearAgoMs = now.getTime() - 365 * DAY_MS;
  const oneYearAgo = assets.filter((a) => {
    if (onThisDayIds.has(a.id)) return false;
    const ms = toMs(a.creationTime);
    if (!ms) return false;
    return Math.abs(Math.round((ms - oneYearAgoMs) / DAY_MS)) <= 3;
  });

  // Best of <month> — the most recent calendar month with ≥12 photos, up to 100 newest from it.
  // assets arrive newest-first, so buckets and their slices stay newest-first too.
  const buckets = new Map<number, AssetMetadata[]>(); // key = year*12 + month (sortable, recent = larger)
  for (const a of assets) {
    const ms = toMs(a.creationTime);
    if (!ms) continue;
    const d = new Date(ms);
    const key = d.getFullYear() * 12 + d.getMonth();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(a);
    else buckets.set(key, [a]);
  }
  const currentKey = thisYear * 12 + mm; // exclude the still-in-progress current month from "Best of"
  let bestKey = -1;
  let bestItems: AssetMetadata[] = [];
  for (const [key, list] of buckets) {
    if (key !== currentKey && list.length >= 12 && key > bestKey) {
      bestKey = key;
      bestItems = list;
    }
  }

  const favorites = assets.filter((a) => a.isFavorite); // assets arrive newest-first

  const groups: MemoryGroup[] = [];
  if (onThisDay.length >= 1) {
    groups.push({
      key: 'onthisday',
      title: 'On This Day',
      subtitle: `${onThisDay.length} from past years`,
      items: onThisDay,
      gradient: grad.brand,
    });
  }
  if (oneYearAgo.length >= 1) {
    groups.push({
      key: 'oneyearago',
      title: 'One Year Ago',
      subtitle: `${oneYearAgo.length} from last year`,
      items: oneYearAgo,
      gradient: grad.search,
    });
  }
  if (bestItems.length >= 12) {
    const items = bestItems.slice(0, 100);
    groups.push({
      key: `bestof:${bestKey}`,
      title: `Best of ${MONTH_NAMES[bestKey % 12]}`,
      subtitle: `${items.length} photo${items.length === 1 ? '' : 's'}`,
      items,
      gradient: grad.desktop,
    });
  }
  if (favorites.length >= 3) {
    groups.push({
      key: 'favorites',
      title: 'Recent Favorites',
      subtitle: `${favorites.length} photo${favorites.length === 1 ? '' : 's'}`,
      items: favorites,
      gradient: grad.favorite,
    });
  }

  // Year in Review — an annual highlight recap (Apple Photos' year recap) for the current year and,
  // when it also qualifies, the prior year. Curated from the same month buckets built above. Unlike
  // the cards above, a recap is intentionally NOT deduped against them: it's a best-of overview of the
  // whole year, so re-showing a photo that also appears in On This Day / Best of is expected and fine.
  for (const year of [thisYear, thisYear - 1]) {
    const months: AssetMetadata[][] = [];
    let count = 0;
    for (let m = 0; m < 12; m++) {
      const list = buckets.get(year * 12 + m) ?? [];
      months.push(list);
      count += list.length;
    }
    if (count < RECAP_MIN) continue; // guard: too thin a year to make a real recap
    const items = selectRecapItems(months);
    groups.push({
      key: `recap-${year}`,
      title: `${year} in Review`,
      subtitle: `${items.length} highlight${items.length === 1 ? '' : 's'}`,
      items,
      gradient: year === thisYear ? grad.brand : grad.search,
    });
  }
  return groups;
}

// --- User overrides: rename + choose key photo + reorder (Apple-Photos-style) -----------------
// Persisted in the prefs key/value store (no schema change) under five keys per memory, keyed by
// the memory's STABLE key (`onthisday`, `oneyearago`, `bestof:<n>`, `favorites`). A blank stored
// value means "unset" — that is how Reset clears an override without needing a delete helper.
const titleKey = (key: string) => 'memory.title.' + key;
const subtitleKey = (key: string) => 'memory.subtitle.' + key;
const coverKey = (key: string) => 'memory.cover.' + key;
const removedKey = (key: string) => 'memory.removed.' + key;
const orderKey = (key: string) => 'memory.order.' + key;

/** Read a pref, tolerating a store failure (treated as unset), mirroring CoachCard's guard. */
function readPref(k: string): string {
  try {
    return getPref(k) ?? '';
  } catch {
    return '';
  }
}

/** The set of member ids the user has removed from a memory (app-local; JSON-stored, guard-parsed). */
function readRemoved(key: string): Set<string> {
  try {
    const raw = getPref(removedKey(key));
    if (!raw) return new Set<string>();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/** The user's custom order of member ids for a memory (app-local; JSON-stored, guard-parsed like readRemoved). */
function readOrder(key: string): string[] {
  try {
    const raw = getPref(orderKey(key));
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Reorder `items` so the ids named in `order` lead (in that saved order); any not named fall to the end
 * keeping their original relative order. Ids in `order` no longer present are ignored. Every element gets
 * a distinct rank (member ids are unique and `order` is de-duped), so the sort never ties. Shared by
 * applyMemoryOverrides (over the computed items) and the edit sheet's session-order seed (over member ids).
 */
function applyOrder<T>(items: T[], idOf: (t: T) => string, order: string[]): T[] {
  if (order.length === 0) return items;
  const pos = new Map<string, number>();
  order.forEach((id, i) => {
    if (!pos.has(id)) pos.set(id, i);
  });
  return items
    .map((it, i) => ({ it, rank: pos.has(idOf(it)) ? (pos.get(idOf(it)) as number) : order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.it);
}

/**
 * Overlay the user's saved title/subtitle/order/cover/removals on a computed memory. Order of ops:
 * (1) apply the user's custom order, (2) drop removed members, (3) float the chosen cover to the front
 * so it leads the card AND the slideshow's first frame regardless of its slot in the order — but ONLY
 * if it's still a member; a deleted/absent cover silently falls back to the first ordered item.
 * Cheap: ≤4 point reads per memory, ≤4 memories. Kept out of buildMemories so that stays pure.
 */
function applyMemoryOverrides(group: MemoryGroup): MemoryGroup {
  const title = readPref(titleKey(group.key)).trim();
  const subtitle = readPref(subtitleKey(group.key)).trim();
  const cover = readPref(coverKey(group.key));
  const removed = readRemoved(group.key);
  const order = readOrder(group.key);
  // (1) Apply the user's custom order to the full computed set (no-op when none saved).
  const ordered = order.length ? applyOrder(group.items, (a) => a.id, order) : group.items;
  // (2) Drop user-removed members, but never let removal empty a memory (fall back to the ordered set).
  let items = removed.size ? ordered.filter((a) => !removed.has(a.id)) : ordered;
  if (items.length === 0) items = ordered;
  // (3) Float the chosen cover to the front so it still leads even when the custom order placed it later.
  if (cover) {
    const i = items.findIndex((a) => a.id === cover);
    if (i > 0) items = [items[i], ...items.slice(0, i), ...items.slice(i + 1)];
    // i === 0: already the cover. i < 0: no longer a member (deleted/removed) → keep the ordered lead.
  }
  return {
    ...group,
    title: title || group.title,
    // Every computed subtitle is count-led ("12 photos", "8 from past years", "10 highlights"), so when
    // removal shrinks the set and there's no custom subtitle, refresh the leading number to match.
    subtitle: subtitle || (removed.size ? group.subtitle.replace(/^\d+/, String(items.length)) : group.subtitle),
    items,
  };
}

// --- Memory Mixes: curated LOOK + PACING bundles you pick before a memory plays -------------------
// Apple Photos' "Memory Mixes", minus the music we don't have: each Mix is a small pacing bundle the
// Slideshow already knows how to honour — a dwell speed + Ken-Burns on/off. Picking one WRITES the two
// prefs the Slideshow reads on mount (slideshow.speed / slideshow.kenburns) and is remembered as
// `memory.mix` so the same feel sticks. "Default" is the original one-tap Play: it leaves your saved
// slideshow settings untouched (speed/kenburns null → not written). Shuffle is intentionally left as-is
// (a Mix is a look+pacing choice, not a reordering). Look/colour is out of scope — the Slideshow plays
// photos on pure black with no filter input, so a Mix only carries the pacing the player actually reads.
type MixSpeed = 'slow' | 'med' | 'fast';
interface MemoryMix {
  key: string;
  name: string;
  sub: string;
  speed: MixSpeed | null; // null = Default → keep the stored slideshow.speed
  kenburns: boolean | null; // null = Default → keep the stored slideshow.kenburns
  gradient: readonly [string, string]; // chip accent (reuses a `grad` tone, matching the card washes)
}

const MIXES: readonly MemoryMix[] = [
  { key: 'default', name: 'Default', sub: 'Your settings', speed: null, kenburns: null, gradient: grad.desktop },
  { key: 'gentle', name: 'Gentle', sub: 'Slow · Ken Burns', speed: 'slow', kenburns: true, gradient: grad.search },
  { key: 'classic', name: 'Classic', sub: 'Medium · Still', speed: 'med', kenburns: false, gradient: grad.brand },
  { key: 'upbeat', name: 'Upbeat', sub: 'Fast · Ken Burns', speed: 'fast', kenburns: true, gradient: grad.favorite },
];

const mixPrefKey = 'memory.mix';

/** The key of the Mix the user played last (persisted); 'default' until they pick another. Guard-read like readPref. */
function readMixKey(): string {
  const k = readPref(mixPrefKey);
  return MIXES.some((m) => m.key === k) ? k : 'default';
}

/**
 * Remember which Mix was picked (so the choice sticks). The Mix's PACING is passed to the Slideshow as
 * override props (mixSpeed/mixKenburns) — NOT written to the global slideshow.* prefs — so choosing a
 * Mix never clobbers the user's own saved slideshow settings. Default carries null pacing → the
 * Slideshow plays with the user's saved settings. Tolerates a store failure (the pick just isn't remembered).
 */
function rememberMix(mix: MemoryMix): void {
  try {
    setPref(mixPrefKey, mix.key);
  } catch {
    // ignore — a failed write just means the last-picked Mix isn't remembered across launches.
  }
}

function MemoryCard({
  group,
  onPress,
  onPlay,
  onEdit,
}: {
  group: MemoryGroup;
  onPress: () => void;
  onPlay: () => void;
  onEdit: () => void;
}) {
  const cover = group.items[0];
  return (
    <Springy
      onPress={onPress}
      scaleTo={0.97}
      style={[styles.card, glowMd(group.gradient[0])]}
      accessibilityLabel={`${group.title}, ${group.subtitle}`}
      accessibilityHint="Opens this memory as a grid"
      accessibilityActions={[
        { name: 'activate', label: 'Open memory' },
        { name: 'play', label: 'Play slideshow' },
        { name: 'edit', label: 'Edit memory' },
      ]}
      onAccessibilityAction={(e) => {
        const a = e.nativeEvent.actionName;
        a === 'play' ? onPlay() : a === 'edit' ? onEdit() : onPress();
      }}
    >
      {cover ? (
        <Image
          source={{ uri: assetUri(cover.id) }}
          style={styles.cover}
          recyclingKey={cover.id}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={dur.slow}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.cover, { backgroundColor: palette.cell }]} />
      )}
      <View style={styles.band}>
        <Scrim edge="bottom" height={92} maxOpacity={0.5} />
        <LivingGradient colors={group.gradient} height={72} style={styles.bandGradient} />
        <Text style={styles.cardTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {group.title}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {group.subtitle}
        </Text>
      </View>
      {/* Play — opens the Mix chooser, then this group plays as a slideshow. Own press target (not the grid). */}
      <Springy
        onPress={onPlay}
        scaleTo={0.84}
        hitSlop={8}
        style={[styles.playBtn, glowSm(group.gradient[1])]}
        accessibilityLabel={`Play ${group.title} slideshow`}
        accessibilityHint="Choose a Mix, then play this memory full screen"
      >
        <View style={styles.playTri} />
      </Springy>
      {/* Edit — rename this memory / pick its key photo. Its own press target, so it doesn't open the grid. */}
      <Springy
        onPress={onEdit}
        scaleTo={0.9}
        hitSlop={8}
        style={styles.editBtn}
        accessibilityLabel={`Edit ${group.title}`}
        accessibilityHint="Rename this memory or change its key photo"
      >
        <Icon name="sliders" size={15} color="#ffffff" />
        <Text style={styles.editText} maxFontSizeMultiplier={1.2}>
          Edit
        </Text>
      </Springy>
    </Springy>
  );
}

/**
 * MemoryEditSheet — the memory edit panel (Apple Photos' memory edit): rename (title/subtitle), choose
 * the key photo, reorder members (up/down), and remove/restore members. A bottom sheet
 * with a title field, an optional subtitle field, and a horizontal strip of the memory's OWN members
 * to pick the cover from (so the cover is always a valid member). Save persists the three prefs;
 * Reset clears them. `group` is already the overridden group, so the fields open pre-filled with the
 * current (possibly customized) values and the strip leads with the current cover.
 */
function MemoryEditSheet({
  group,
  members,
  onClose,
  onSaved,
}: {
  group: MemoryGroup;
  /** The RAW (unfiltered) member list, so previously-removed photos still show (dimmed) + restorable. */
  members: AssetMetadata[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(group.title);
  const [subtitle, setSubtitle] = useState(group.subtitle);
  // The chosen cover is always one of the memory's own members (the strip only offers members).
  const [coverId, setCoverId] = useState(group.items[0]?.id ?? '');
  // Session set of members marked for removal (seeded from the persisted set). Toggle in the strip.
  const [removed, setRemoved] = useState<Set<string>>(() => readRemoved(group.key));
  // Session order of member ids (seeded from the persisted order applied to the raw members, so a
  // re-opened sheet shows the last-saved sequence). Moved with the ◀/▶ controls; persisted on Save.
  const [order, setOrder] = useState<string[]>(() =>
    applyOrder(members, (a) => a.id, readOrder(group.key)).map((a) => a.id),
  );
  // Members keyed by id so the strip (which iterates `order`) can look each thumbnail up. Stable per sheet.
  const byId = useMemo(() => new Map(members.map((a) => [a.id, a] as const)), [members]);
  // Single-member memories have nothing to reorder — hide the move controls (and skip persisting an order).
  const canReorder = members.length > 1;
  const accent = group.gradient[0];
  // The card's gradient IS one of the `grad` presets (by reference), so recover its tone for the CTA.
  const tone = (Object.keys(grad) as (keyof typeof grad)[]).find((k) => grad[k] === group.gradient) ?? 'brand';
  // Trap VoiceOver in the sheet: move focus to the header on mount (after the fade settles) so it can't
  // land on / escape into the dimmed Library behind. onRequestClose already handles the back-gesture.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      const node = findNodeHandle(titleRef.current);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(h);
  }, []);

  const toggleRemove = (id: string) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id); // restore
        return next;
      }
      // Keep at least one photo in the memory — refuse to remove the last remaining member.
      const remaining = members.filter((a) => !prev.has(a.id)).length;
      if (remaining <= 1) return prev;
      next.add(id);
      return next;
    });

  // Swap a member one slot earlier (dir -1) or later (dir +1) in the session order. Clamped at the ends.
  const move = (id: string, dir: -1 | 1) =>
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () => {
    try {
      setPref(titleKey(group.key), title.trim());
      setPref(subtitleKey(group.key), subtitle.trim());
      // If the chosen cover got removed, fall back to the first still-present member.
      const cover = removed.has(coverId) ? members.find((a) => !removed.has(a.id))?.id ?? '' : coverId;
      setPref(coverKey(group.key), cover);
      setPref(removedKey(group.key), removed.size ? JSON.stringify([...removed]) : '');
      // Persist the strip's current sequence (ids in order); single-member memories store nothing.
      setPref(orderKey(group.key), canReorder ? JSON.stringify(order) : '');
      toast({ text: 'Memory updated', tone });
    } catch {
      toast({ text: 'Couldn’t save changes', tone: 'danger' });
    }
    onSaved();
  };

  const reset = () => {
    // Blank the prefs — applyMemoryOverrides reads a blank value as "unset" and re-derives.
    try {
      setPref(titleKey(group.key), '');
      setPref(subtitleKey(group.key), '');
      setPref(coverKey(group.key), '');
      setPref(removedKey(group.key), '');
      setPref(orderKey(group.key), '');
      toast({ text: 'Reset to default', tone });
    } catch {
      toast({ text: 'Couldn’t reset', tone: 'danger' });
    }
    onSaved();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <Text
            ref={titleRef}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            style={styles.sheetTitle}
          >
            Edit Memory
          </Text>

          <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>Title</Text>
          <TextInput
            style={[styles.input, { borderColor: tint(accent, tintBorder.rest) }]}
            value={title}
            onChangeText={setTitle}
            placeholder={group.title}
            placeholderTextColor={palette.muted}
            selectionColor={accent}
            maxLength={60}
            returnKeyType="done"
            accessibilityLabel="Memory title"
          />

          <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>Subtitle</Text>
          <TextInput
            style={[styles.input, { borderColor: tint(accent, tintBorder.rest) }]}
            value={subtitle}
            onChangeText={setSubtitle}
            placeholder={group.subtitle}
            placeholderTextColor={palette.muted}
            selectionColor={accent}
            maxLength={80}
            returnKeyType="done"
            accessibilityLabel="Memory subtitle"
          />

          <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
            {canReorder ? 'Key Photo · ✕ remove · ◀ ▶ reorder' : 'Key Photo · tap ✕ to remove'}
          </Text>
          <FlatList
            data={order}
            horizontal
            keyExtractor={(id) => id}
            // Rows also depend on cover + removals (order changes flow through `data`); fold both into a
            // string so a select/remove toggle re-renders the affected thumbs.
            extraData={coverId + '|' + [...removed].join(',')}
            showsHorizontalScrollIndicator={false}
            style={styles.thumbList}
            contentContainerStyle={styles.thumbRow}
            renderItem={({ item: id, index }) => {
              const item = byId.get(id);
              if (!item) return null;
              const isRemoved = removed.has(id);
              const selected = id === coverId && !isRemoved;
              return (
                <View style={styles.thumbWrap}>
                  <Springy
                    onPress={() => !isRemoved && setCoverId(id)}
                    scaleTo={0.9}
                    disabled={isRemoved}
                    style={[styles.thumb, selected && { borderColor: accent }, isRemoved && styles.thumbRemoved]}
                    accessibilityLabel={isRemoved ? 'Removed from memory' : 'Use as key photo'}
                    accessibilityState={{ selected, disabled: isRemoved }}
                  >
                    <Image
                      source={{ uri: assetUri(id) }}
                      style={styles.thumbImg}
                      recyclingKey={id}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      transition={dur.base}
                      accessibilityIgnoresInvertColors
                    />
                    {selected ? (
                      <View style={[styles.thumbCheck, { backgroundColor: accent }]}>
                        <Icon name="check" size={12} color="#ffffff" />
                      </View>
                    ) : null}
                  </Springy>
                  <Pressable
                    onPress={() => toggleRemove(id)}
                    hitSlop={{ top: 12, left: 12, bottom: 8, right: 8 }}
                    style={[styles.thumbRemoveBtn, isRemoved && { backgroundColor: accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={isRemoved ? 'Restore to memory' : 'Remove from memory'}
                  >
                    <Text allowFontScaling={false} style={styles.thumbRemoveGlyph}>
                      {isRemoved ? '↺' : '✕'}
                    </Text>
                  </Pressable>
                  {/* Reorder controls — buttons, not a drag gesture (no list-arbitration). Removed thumbs
                      keep their slot (dimmed above) and can still be moved. Ends disable the outward arrow. */}
                  {canReorder ? (
                    <View style={styles.moveRow}>
                      <Pressable
                        onPress={() => move(id, -1)}
                        disabled={index === 0}
                        hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
                        style={[styles.moveBtn, index === 0 && styles.moveBtnOff]}
                        accessibilityRole="button"
                        accessibilityLabel="Move earlier"
                        accessibilityState={{ disabled: index === 0 }}
                      >
                        <Text allowFontScaling={false} style={styles.moveGlyph}>
                          ◀
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => move(id, 1)}
                        disabled={index === order.length - 1}
                        hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
                        style={[styles.moveBtn, index === order.length - 1 && styles.moveBtnOff]}
                        accessibilityRole="button"
                        accessibilityLabel="Move later"
                        accessibilityState={{ disabled: index === order.length - 1 }}
                      >
                        <Text allowFontScaling={false} style={styles.moveGlyph}>
                          ▶
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            }}
          />

          <View style={styles.actions}>
            <Springy onPress={reset} pressableStyle={styles.reset} accessibilityLabel="Reset to default">
              <Text style={styles.resetText} maxFontSizeMultiplier={1.3}>Reset</Text>
            </Springy>
            <GradientButton
              label="Save"
              tone={tone}
              onPress={save}
              style={styles.save}
              accessibilityHint="Saves this memory’s title, subtitle, key photo, order, and removed photos"
            />
          </View>
          <Springy onPress={onClose} pressableStyle={styles.cancel} accessibilityLabel="Cancel">
            <Text style={styles.cancelText} maxFontSizeMultiplier={1.3}>Cancel</Text>
          </Springy>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * MemoryMixSheet — the compact Mix chooser shown when you tap Play on a memory card. A bottom sheet of
 * Mix chips (reusing the shared Chip primitive); the last-played Mix is pre-highlighted. Tapping a chip
 * applies that Mix's pacing prefs, remembers it, and launches this memory as a slideshow (onPick) — the
 * Slideshow then reads the freshly-written prefs on mount. "Default" keeps your saved slideshow settings
 * (the original one-tap Play). Cancel / backdrop dismiss without playing.
 */
function MemoryMixSheet({
  group,
  onPick,
  onClose,
}: {
  group: MemoryGroup;
  /** Apply the chosen Mix's prefs, remember it, and launch this memory as a slideshow. */
  onPick: (mix: MemoryMix) => void;
  onClose: () => void;
}) {
  // Which Mix to pre-highlight — the one the user played last (persisted, defaults to Default).
  const current = readMixKey();
  // Trap VoiceOver in the sheet: focus the header on mount so it can't escape into the dimmed grid behind.
  const titleRef = useRef<Text>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      const node = findNodeHandle(titleRef.current);
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(h);
  }, []);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.kav}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <Text ref={titleRef} accessibilityRole="header" style={styles.sheetTitle}>
            Choose a Mix
          </Text>
          <Text style={styles.mixCaption} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {group.title}
          </Text>
          <View style={styles.mixRow}>
            {MIXES.map((mix) => (
              <Chip
                key={mix.key}
                label={mix.name}
                sub={mix.sub}
                accent={mix.gradient[0]}
                selected={mix.key === current}
                onPress={() => onPick(mix)}
              />
            ))}
          </View>
          <Springy onPress={onClose} pressableStyle={styles.cancel} accessibilityLabel="Cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Springy>
        </View>
      </View>
    </Modal>
  );
}

export function MemoriesCarousel({
  assets,
  onOpen,
}: {
  assets: AssetMetadata[];
  onOpen: (group: MemoryGroup) => void;
}) {
  // Items currently playing as a full-screen slideshow (null = closed). Local to the carousel.
  const [playItems, setPlayItems] = useState<AssetMetadata[] | null>(null);
  // The Mix chosen for the current playback — its pacing is passed to the Slideshow as override props
  // (never persisted), so a Mix can't clobber the user's own saved slideshow settings.
  const [activeMix, setActiveMix] = useState<MemoryMix | null>(null);
  // The memory whose Mix chooser is open (null = closed), shown when the user taps Play on a card.
  const [mixing, setMixing] = useState<MemoryGroup | null>(null);
  // Bumped on each launch so the (always-mounted) Slideshow REMOUNTS and re-applies the Mix's pacing on
  // mount — its speed/Ken-Burns state seeds once per mount, so a fresh key is how a new Mix takes.
  const [playNonce, setPlayNonce] = useState(0);
  // The memory whose edit sheet is open (null = closed), and a revision counter bumped on save so the
  // override-aware memo re-reads prefs and the cards refresh without waiting on `assets` to change.
  const [editing, setEditing] = useState<MemoryGroup | null>(null);
  const [rev, setRev] = useState(0);
  // Keep the RAW groups (unfiltered members) alongside the overlaid ones: the cards/slideshow/grid use
  // the overlaid (removal-applied) groups, but the edit sheet needs the raw members so a previously-
  // removed photo still shows (dimmed) and is restorable across sessions.
  const rawGroups = useMemo(() => buildMemories(assets), [assets]);
  const groups = useMemo(() => rawGroups.map(applyMemoryOverrides), [rawGroups, rev]);
  // Master "Show Featured Content" kill switch (Settings ▸ Featured Content, gap 148). Read in render so
  // toggling it reflects on this carousel's next render / remount. When off, the whole Memories strip is
  // suppressed wherever it's mounted (Library + the For You tab). No hooks below, so an early return here
  // is safe (every hook above has already run).
  if (getPref('features.featuredContent') === '0') return null;
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>For you</Text>
      <FlatList
        data={groups}
        horizontal
        keyExtractor={(g) => g.key}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <MemoryCard
            group={item}
            onPress={() => onOpen(item)}
            onPlay={() => item.items.length > 0 && setMixing(item)}
            onEdit={() => setEditing(item)}
          />
        )}
      />
      {/* Keyed by the launch nonce so the always-mounted Slideshow remounts per play and reads the Mix's
          freshly-written pacing prefs on mount (its speed/Ken-Burns state seeds once, at mount). */}
      <Slideshow
        key={playNonce}
        visible={playItems != null}
        items={playItems ?? []}
        mixSpeed={activeMix?.speed ?? undefined}
        mixKenburns={activeMix?.kenburns ?? undefined}
        onClose={() => setPlayItems(null)}
      />
      {/* Mix chooser — tap Play → pick a look+pacing Mix → it writes the slideshow prefs and launches. */}
      {mixing ? (
        <MemoryMixSheet
          key={mixing.key}
          group={mixing}
          onClose={() => setMixing(null)}
          onPick={(mix) => {
            const items = mixing.items; // captured before we clear `mixing`
            rememberMix(mix); // persist only the CHOICE (memory.mix); pacing goes via props, not prefs
            setActiveMix(mix);
            setMixing(null);
            setPlayNonce((n) => n + 1); // fresh Slideshow mount so the new Mix's pacing seeds on mount
            setPlayItems(items);
          }}
        />
      ) : null}
      {/* Keyed by the memory so the sheet remounts (and its fields re-initialize) per memory. */}
      {editing ? (
        <MemoryEditSheet
          key={editing.key}
          group={editing}
          members={rawGroups.find((g) => g.key === editing.key)?.items ?? editing.items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setRev((r) => r + 1);
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 2, paddingBottom: 10 },
  kicker: {
    ...typography.kicker,
    color: palette.accentSoft,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  row: { paddingHorizontal: 16, gap: GAP },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.cell,
  },
  cover: { width: '100%', height: '100%' },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 24 },
  bandGradient: { top: undefined, bottom: 0, height: 72 },
  cardTitle: { color: palette.text, ...typography.heading },
  cardSub: { ...typography.meta, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  playBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  // Right-pointing play triangle drawn from borders (no icon dep for "play").
  playTri: {
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#ffffff',
    marginLeft: 3,
  },
  // Edit pill — mirrors the play button's chrome, anchored top-left so the two never overlap.
  editBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  editText: { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },

  // --- Edit sheet (rename + key photo) ---
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: palette.popover,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: hairline,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: '88%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  sheetTitle: { color: palette.text, ...typography.sheetTitle, marginBottom: 4 },
  fieldLabel: {
    ...typography.kicker,
    letterSpacing: 0.6,
    color: palette.accentSoft,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: palette.surfaceHi,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.text,
    fontSize: 16,
  },
  thumbList: { marginTop: 2 },
  thumbRow: { gap: 10, paddingVertical: 6, paddingRight: 4 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: palette.cell,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbWrap: { width: 64 },
  thumbRemoved: { opacity: 0.4 },
  // Reorder controls sit in a row under each 64px thumb (◀ earlier · ▶ later).
  moveRow: { flexDirection: 'row', justifyContent: 'space-between', width: 64, marginTop: 6 },
  moveBtn: {
    width: 28,
    height: 22,
    borderRadius: 8,
    backgroundColor: hairline,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOff: { opacity: 0.3 },
  moveGlyph: { color: palette.text, fontSize: 12, fontWeight: '800', lineHeight: 14 },
  thumbRemoveBtn: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveGlyph: { color: '#ffffff', fontSize: 12, fontWeight: '800', lineHeight: 14 },
  thumbCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  reset: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: { color: palette.sub, fontSize: 15, fontWeight: '800' },
  save: { flex: 1 },
  cancel: { marginTop: 6, alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: palette.sub, fontSize: 15, fontWeight: '700' },

  // --- Mix chooser sheet (tap Play → pick a look+pacing Mix) ---
  mixCaption: { ...typography.meta, color: palette.sub, marginTop: 2, marginBottom: 16 },
  mixRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
