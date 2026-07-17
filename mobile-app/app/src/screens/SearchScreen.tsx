/**
 * Search — the differentiator. Natural-language photo search powered by on-device CLIP, fully
 * offline, with no Apple Intelligence gate. Search-as-you-type (debounced) once the index is built.
 *
 * The index is opt-in behind one tap (it downloads the CLIP encoders once, then embeds the library
 * on-device); after that, every keystroke re-ranks the grid by relevance.
 *
 * This tab's identity colour is cyan (palette.cyan) — every accent here (glyphs, borders, meta,
 * orbs, the CTA, the scope control) routes through it so Search never drifts back to the violet
 * brand hue. Colour lives in the chrome; the result grid stays on neutral cells.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { MediaType, type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, EmptyState, Center, palette } from '../ui';
import { ScreenHeader } from '../Header';
import { Springy, FloatingView, BreathingOrb, ProgressBar, GradientButton, Reveal, RollingNumber } from '../motion';
import { SearchField, Chip, Segmented } from '../fields';
import { Icon } from '../Icon';
import { grad, tint, radius, typography, tintFill, tintBorder } from '../theme';
import { useInsets } from '../insets';
import { AskSheet } from '../AskSheet';
import { toast } from '../Toast';
import { type SemanticSearch } from '../useSemanticSearch';
import { type OcrIndex } from '../useOcrIndex';
import {
  addSearchHistory,
  recentSearches,
  clearSearchHistory,
  searchCaptions,
  savedSearches,
  addSavedSearch,
  removeSavedSearch,
} from '../replica';

const EXAMPLES = ['dog', 'beach', 'sunset', 'flowers', 'mountains', 'food', 'a red car', 'city at night'];

// Browsable content CATEGORIES — Apple Photos surfaces curated groups (Receipts, Documents, Food, …)
// backed by dedicated on-device classifiers. We have no such classifiers, so each category is just a
// natural-language CLIP phrase the on-device encoder retrieves against — tapping one runs an ordinary
// semantic search via runNow(query). Distinct from the single-word EXAMPLES: these are content
// *categories* you browse, and they only render once the CLIP index is ready (see the Browse row).
const CATEGORIES: { label: string; query: string }[] = [
  { label: 'Receipts', query: 'a receipt' },
  { label: 'Documents', query: 'a document or paper' },
  { label: 'Food', query: 'food or a meal' },
  { label: 'Nature', query: 'nature landscape' },
  { label: 'Screenshots', query: 'a phone screenshot' },
  { label: 'Pets', query: 'a pet dog or cat' },
  { label: 'Cars', query: 'a car' },
];

const DEBOUNCE_MS = 250;

type Scope = 'all' | 'favorites';
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favorites' },
];

// Result SORT (Apple Photos' Sort by Relevance / Newest / Oldest). Relevance = the CLIP/OCR order as
// delivered (no re-sort); Newest/Oldest re-order a COPY by capture date (assetMs). This only touches
// the mapped result set — never the search itself, so relevance stays the pure retrieval ranking.
type Sort = 'relevance' | 'newest' | 'oldest';
const SORTS: { key: string; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

// Media-type FILTER over the results (Apple Photos' All / Photos / Videos), composed on top of the
// Favorites scope. CLIP/OCR only ever surface images, so "Videos" bites mainly in date-only mode
// (whose library is built from every asset), but it composes cleanly on every result path.
type MType = 'all' | 'photos' | 'videos';
const MTYPES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
];

// ── Inline search operators ─────────────────────────────────────────────────────────────────────
// Apple-Photos-style power-user shorthand typed straight into the box: `is:favorite` (or `is:fav`),
// `is:video`, `is:photo`. The recognized tokens are STRIPPED from the text before it reaches the
// CLIP / date / OCR search path, and re-applied as an extra narrowing pass over the results (favorite
// → keep favorites; a media op → force that media type). Multiple ops compose; an unrecognized
// `is:x` is left in the text (harmless — CLIP just sees the literal words). Pure: no library or
// component-state dependency, mirroring the date parsers below.
type SearchOps = { cleaned: string; favorite: boolean; mtype: MType };

function parseSearchOps(query: string): SearchOps {
  let favorite = false;
  let mtype: MType = 'all';
  // A whitespace-delimited `is:<word>` token, case-insensitive. The leading (^|\s) anchor keeps us
  // off substrings like "this:foo"; the trailing lookahead keeps the token whole (won't eat the "."
  // in "is:video."). Unrecognized ops fall through the switch and are returned verbatim.
  const cleaned = query
    .replace(/(^|\s)is:([a-z]+)(?=\s|$)/gi, (whole, lead: string, word: string) => {
      switch (word.toLowerCase()) {
        case 'favorite':
        case 'favourite':
        case 'fav':
          favorite = true;
          return lead ? ' ' : '';
        case 'video':
        case 'videos':
          mtype = 'videos';
          return lead ? ' ' : '';
        case 'photo':
        case 'photos':
        case 'image':
        case 'images':
          mtype = 'photos';
          return lead ? ' ' : '';
        default:
          return whole; // unknown op — leave it in the query
      }
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { cleaned, favorite, mtype };
}

/** Count-aware noun for an operator-only filter, e.g. "12 videos", "1 favorite", "3 favorite photos". */
function describeOps(favorite: boolean, mtype: MType, n: number): string {
  const base = mtype === 'videos' ? 'video' : mtype === 'photos' ? 'photo' : 'favorite';
  const noun = favorite && mtype !== 'all' ? `favorite ${base}` : base;
  return `${noun}${n === 1 ? '' : 's'}`;
}

// ── Date search ───────────────────────────────────────────────────────────────────────────────
// Apple Photos indexes capture-date as a search dimension; so do we. A query that names a month
// and/or a 19xx–20xx year filters the library by when the photo was taken — and, because it needs
// only the local `assets`, it works even before the (opt-in) CLIP index is built.

/**
 * Parsed date intent. `month` is 0-based (0 = January) to match `Date.getMonth()`. `year2`, when
 * present, turns `year` into an inclusive RANGE endpoint ("2019 to 2021") — the single-year path is
 * exactly the old behaviour whenever `year2` is undefined.
 */
export type DateIntent = { year?: number; year2?: number; month?: number };

// An explicit year RANGE — two 1900–2099 years joined by a connector: a hyphen / en- / em-dash, or
// one of to / through / thru / until / til. Requires a connector, so a bare "2019 2021" is NOT a
// range (too ambiguous) — it falls through to the single-year scan. Matched on the raw query before
// tokenizing (the tokenizer drops the dash), so both endpoints survive.
const YEAR_RANGE_RE = /\b(19\d{2}|20\d{2})\s*(?:-|–|—|to|through|thru|until|til)\s*(19\d{2}|20\d{2})\b/i;

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES = MONTH_LABELS.map((m) => m.toLowerCase());

// Filler words that, next to a month/year, still read as a pure date query (Apple-Photos-style
// "photos from march 2019"). A token that is neither a date token nor a stopword is a real CLIP
// search word — its presence flips a query out of the date-only path and into CLIP (∩ date).
const DATE_STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'me', 'of', 'in', 'on', 'from', 'at', 'during', 'taken', 'shot',
  'photo', 'photos', 'pic', 'pics', 'picture', 'pictures', 'image', 'images', 'all', 'back',
  // Year-range connectors — so a pure range like "2019 to 2021" stays a date-ONLY query (no CLIP).
  'to', 'through', 'thru', 'until', 'til',
]);

const tokenize = (query: string): string[] => query.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** A 4-digit token in the 1900–2099 window. */
function isYearToken(tok: string): boolean {
  if (!/^\d{4}$/.test(tok)) return false;
  const n = Number(tok);
  return n >= 1900 && n <= 2099;
}

/** Month index (0-11) for a full name or its canonical 3-letter form (jan…dec), else -1. */
function monthIndexOf(tok: string): number {
  return MONTH_NAMES.findIndex((n) => n === tok || (tok.length === 3 && n.slice(0, 3) === tok));
}

/**
 * Parse a free-text query for a capture-date intent: a 19xx–20xx year and/or a month name (full or
 * 3-letter, case-insensitive). Returns `{year?, month?}`, or `null` when no date tokens are found.
 * Pure — no dependency on the library or component state.
 */
function parseDateIntent(query: string): DateIntent | null {
  let year: number | undefined;
  let year2: number | undefined;
  let month: number | undefined;
  // Explicit year RANGE first ("2019 to 2021", "2018-2020") — captured up front so the single-token
  // scan below (which keeps only the FIRST year) doesn't collapse a range down to one endpoint.
  const range = query.match(YEAR_RANGE_RE);
  if (range) {
    year = Number(range[1]);
    year2 = Number(range[2]);
  }
  for (const tok of tokenize(query)) {
    if (year === undefined && isYearToken(tok)) {
      year = Number(tok);
      continue;
    }
    if (month === undefined) {
      const m = monthIndexOf(tok);
      if (m >= 0) month = m;
    }
  }
  if (year === undefined && month === undefined) return null;
  const out: DateIntent = {};
  if (year !== undefined) out.year = year;
  // Drop a degenerate range ("2019 to 2019") back to a single year.
  if (year2 !== undefined && year2 !== year) out.year2 = year2;
  if (month !== undefined) out.month = month;
  return out;
}

/** True when the query carries a real (non-date, non-filler) word — i.e. CLIP should run. */
function queryHasNonDateWords(query: string): boolean {
  for (const tok of tokenize(query)) {
    if (isYearToken(tok) || monthIndexOf(tok) >= 0 || DATE_STOPWORDS.has(tok)) continue;
    return true;
  }
  return false;
}

/** `creationTime` is ms; tolerate seconds exactly like the Albums screen. */
function assetMs(a: AssetMetadata): number {
  const raw = a.creationTime ?? 0;
  return raw > 0 && raw < 1e11 ? raw * 1000 : raw;
}

/** Test an asset's capture date against the parsed year/month intent (year may be an inclusive range). */
function dateMatches(a: AssetMetadata, intent: DateIntent): boolean {
  const ms = assetMs(a);
  if (!(ms > 0)) return false;
  const d = new Date(ms);
  if (intent.year !== undefined) {
    const y = d.getFullYear();
    if (intent.year2 !== undefined) {
      const lo = Math.min(intent.year, intent.year2);
      const hi = Math.max(intent.year, intent.year2);
      if (y < lo || y > hi) return false;
    } else if (y !== intent.year) {
      return false;
    }
  }
  if (intent.month !== undefined && d.getMonth() !== intent.month) return false;
  return true;
}

/** Human label for the active-filter chip / meta, e.g. "March 2026", "2019", "March", "2019–2021". */
function formatDateIntent(intent: DateIntent): string {
  const parts: string[] = [];
  if (intent.month !== undefined) parts.push(MONTH_LABELS[intent.month]);
  if (intent.year !== undefined) {
    if (intent.year2 !== undefined) {
      const lo = Math.min(intent.year, intent.year2);
      const hi = Math.max(intent.year, intent.year2);
      parts.push(`${lo}–${hi}`);
    } else {
      parts.push(String(intent.year));
    }
  }
  return parts.join(' ');
}

/** Words that corroborate a date reading ("photos FROM march", "IN march"). */
const DATE_PREPS = new Set(['in', 'on', 'from', 'during', 'taken', 'shot', 'of', 'back']);
const hasDatePrep = (query: string): boolean => tokenize(query).some((t) => DATE_PREPS.has(t));

/**
 * A date intent we're CONFIDENT about. A 4-digit year is unambiguous; a BARE month word is not — "may"
 * and "march" are common non-date words, so a month with no year requires a date preposition ("from
 * march", "in march") before we treat it as a date. This keeps ordinary CLIP queries out of date mode.
 */
function confidentDateIntent(query: string): DateIntent | null {
  const intent = parseDateIntent(query);
  if (!intent) return null;
  if (intent.year !== undefined) return intent;
  return hasDatePrep(query) ? intent : null;
}

/** A date query with no other meaningful words → filter the library locally, no CLIP required. */
function dateOnlyIntent(query: string): DateIntent | null {
  const intent = confidentDateIntent(query);
  return intent && !queryHasNonDateWords(query) ? intent : null;
}

// Module-scoped memory of the last committed DATE query so a date-only search (which bypasses the
// CLIP hook's lastQuery) is restored into the box after a tab-switch remount. CLIP searches clear it.
let lastDateQuery = '';
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pre-typed suggestion chips surfaced from the user's OWN library. Apple Photos offers real
 * capture-date scopes before you type; so do we. Rendered only in the idle state (empty box, no
 * results) as a labelled "Try" row above the generic examples. Each chip's text is phrasing the date
 * parser reads back verbatim ("March 2026", "2025"), so a tap round-trips through runNow → runDateOnly.
 */
function TrySuggestions({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (query: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.tryWrap}>
      <Text style={styles.tryLabel} accessibilityRole="header">Try</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {suggestions.map((s) => (
          <Chip key={s} label={s} accent={palette.cyan} onPress={() => onPick(s)} />
        ))}
      </ScrollView>
    </View>
  );
}

export function SearchScreen({
  assets,
  search,
  ocrSearch,
  ocr,
  onFindSimilar,
  onToggleFavorite,
}: {
  assets: AssetMetadata[];
  search: SemanticSearch;
  /** Text-in-photos (OCR) lookup: external_ids whose recognized text matches the query. */
  ocrSearch?: (query: string) => string[];
  /** Background OCR index status, for a subtle "reading text…" progress caption. */
  ocr?: OcrIndex;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
}) {
  // Seed from the last text query so the box matches the results after a tab-switch remount (this
  // screen unmounts on tab change but the search state lives in the App-level hook and persists).
  const [q, setQ] = useState(search.similar ? '' : search.lastQuery || lastDateQuery);
  // The hook exposes no in-flight flag, so we track "a query is on its way" locally: set true when a
  // search is dispatched, cleared by the effect below once results or an error land.
  const [pending, setPending] = useState(false);
  // Scope lens over the results (All / Favorites) — self-contained, filters the mapped assets.
  const [scope, setScope] = useState<Scope>('all');
  // Result-chrome: sort order + media-type filter (Apple Photos). Relevance keeps the CLIP/OCR order;
  // the media-type filter composes with the Favorites scope. Both fold into the gridKey below so the
  // FlashList remounts when they change (recycled cells would otherwise show the pre-sort/-filter set).
  const [sort, setSort] = useState<Sort>('relevance');
  const [mtype, setMtype] = useState<MType>('all');
  // Ask Photos — the conversational planner surface (a modal over Search). Reachable in both the
  // pre-index and ready states, since date/favorite/media questions answer with no CLIP index.
  const [askOpen, setAskOpen] = useState(false);
  // Select mode over the results (Apple Photos surfaces "Select" in search results). Mirrors
  // LibraryScreen: a `selecting` flag + a `selected` id set drive PhotoGrid's selection affordance,
  // with a bottom action bar to batch-favorite. Any change to the query exits it (see the effect below).
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useInsets();

  // Clear any pending debounce when the screen unmounts (e.g. tab switch) so an abandoned query
  // doesn't fire against the still-alive hook after the user has left.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A result set or a search error landing means the in-flight query resolved — drop the spinner.
  useEffect(() => {
    setPending(false);
  }, [search.results, search.searchError]);

  // Confirm the one-time index build finished (fires only on the transition into ready, not on the
  // tab-switch remount that lands already-ready).
  const prevStatus = useRef(search.status);
  useEffect(() => {
    if (prevStatus.current !== 'ready' && search.status === 'ready') {
      toast({ text: 'Semantic search ready', tone: 'search' });
    }
    prevStatus.current = search.status;
  }, [search.status]);

  // Recent searches — a local mirror of the persisted history so the "Recent" row re-renders when
  // it changes. Every replica call is guarded: the native SQLite replica may be unreachable in some
  // contexts, and a failed read/write must degrade to "no recents", never throw into render.
  const [recents, setRecents] = useState<string[]>([]);

  const loadRecents = useCallback(() => {
    try {
      setRecents(recentSearches(8));
    } catch {
      setRecents([]);
    }
  }, []);

  // Load once on mount (survives the tab-switch remount since history is durable).
  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  // Persist a committed query and refresh the local mirror. Best-effort: history is a convenience,
  // so a replica failure silently skips persisting rather than surfacing an error.
  const recordSearch = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      addSearchHistory(t);
      setRecents(recentSearches(8));
    } catch {
      /* replica unavailable — skip persisting this query */
    }
  }, []);

  const clearRecents = useCallback(() => {
    try {
      clearSearchHistory();
      setRecents(recentSearches(8));
    } catch {
      setRecents([]);
    }
  }, []);

  // Saved searches — a small, hand-curated list the user manages explicitly (star a result to save,
  // long-press a saved chip to remove), distinct from the automatic Recent MRU. Mirrored locally so
  // the "Saved" row + the star's filled state re-render on change; every replica call is guarded so a
  // DB hiccup degrades to "nothing saved" rather than throwing into render (mirrors the recents mirror).
  const [saved, setSaved] = useState<string[]>([]);

  const loadSaved = useCallback(() => {
    try {
      setSaved(savedSearches());
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Toggle the CURRENT query in/out of the saved list (the star on a result set). Case-insensitive
  // membership mirrors the replica's own de-dup, so the star and the stored list never disagree.
  const toggleSaved = useCallback(
    (query: string) => {
      const t = query.trim();
      if (!t) return;
      try {
        if (saved.some((s) => s.toLowerCase() === t.toLowerCase())) {
          removeSavedSearch(t);
          toast({ text: 'Removed from Saved', tone: 'search' });
        } else {
          addSavedSearch(t);
          toast({ text: 'Search saved', tone: 'search' });
        }
        setSaved(savedSearches());
      } catch {
        /* replica unavailable — leave the mirror as-is */
      }
    },
    [saved],
  );

  // Remove a saved query from the idle "Saved" row (long-press). Best-effort like the toggle above.
  const removeSaved = useCallback((query: string) => {
    try {
      removeSavedSearch(query);
      setSaved(savedSearches());
      toast({ text: 'Removed from Saved', tone: 'search' });
    } catch {
      /* replica unavailable — leave the mirror as-is */
    }
  }, []);

  // `cleaned` is the operator-stripped text that CLIP actually searches; `raw` is what the user typed
  // (ops included) and is what we persist to Recent so a tapped recent re-applies the same operators.
  const debouncedSearch = useCallback(
    (cleaned: string, raw: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (!cleaned.trim()) {
        setPending(false);
        search.clear();
        return;
      }
      setPending(true);
      lastDateQuery = '';
      timer.current = setTimeout(() => {
        search.search(cleaned);
        recordSearch(raw);
      }, DEBOUNCE_MS);
    },
    [search, recordSearch],
  );

  // A date-only query never touches CLIP — cancel any pending CLIP search, drop stale CLIP results
  // so the date grid isn't shadowed, and (debounced) remember the query. Results render locally.
  const runDateOnly = useCallback(
    (text: string, debouncedRecord: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      setPending(false);
      lastDateQuery = text; // so a tab-switch remount reseeds the box
      if (search.results != null || search.lastQuery) search.clear();
      if (debouncedRecord) {
        timer.current = setTimeout(() => recordSearch(text), DEBOUNCE_MS);
      } else {
        recordSearch(text);
      }
    },
    [search, recordSearch],
  );

  const onChangeText = (text: string) => {
    setQ(text);
    // Inline operators (`is:favorite`/`is:video`/…) are stripped before search; the CLEANED text is
    // what feeds CLIP / date / OCR, while the ops narrow the result set (see the `scoped` memo below).
    const cleaned = parseSearchOps(text).cleaned;
    if (dateOnlyIntent(cleaned)) {
      runDateOnly(text, true); // raw text keeps the ops visible in the box + Recent
      return;
    }
    // Nothing left to search (empty box, or an operator-only query like "is:video"): drop any prior
    // CLIP results so the op-filtered library — or the idle state — shows. The op filter renders off `q`.
    if (!cleaned.trim()) {
      if (timer.current) clearTimeout(timer.current);
      setPending(false);
      lastDateQuery = '';
      if (search.results != null || search.lastQuery) search.clear();
      return;
    }
    if (search.status === 'ready') debouncedSearch(cleaned, text);
  };

  const runNow = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (!text.trim()) {
      setPending(false);
      search.clear();
      return;
    }
    const cleaned = parseSearchOps(text).cleaned;
    if (dateOnlyIntent(cleaned)) {
      runDateOnly(text, false);
      return;
    }
    // Operator-only query (e.g. "is:video"): no CLIP needed — clear any prior search and let the op
    // filter the whole library at render. Record the raw text so the op round-trips through Recent.
    if (!cleaned.trim()) {
      setPending(false);
      lastDateQuery = '';
      if (search.results != null || search.lastQuery) search.clear();
      recordSearch(text);
      return;
    }
    // CLIP path — only runnable once the index is ready; date-only search reached this screen's
    // input in the not-ready state, so guard against firing a text query with no encoder loaded.
    if (search.status !== 'ready') return;
    lastDateQuery = '';
    setPending(true);
    search.search(cleaned);
    recordSearch(text);
  };

  const clearQuery = useCallback(() => {
    setQ('');
    setPending(false);
    lastDateQuery = '';
    search.clear();
  }, [search]);

  // Reset every result filter (media-type + Favorites scope) back to "show everything" — the recovery
  // action a filtered-empty state offers. Sort is left alone: it never empties a set, so a "Show all"
  // fix doesn't need to touch the ordering the user chose.
  const resetFilters = useCallback(() => {
    setScope('all');
    setMtype('all');
  }, []);

  // Inline search operators parsed from the live box. `cleaned` (ops stripped) is what actually feeds
  // CLIP / date / OCR; `effMtype` / `effFav` fold the ops onto the UI controls (a media op OVERRIDES
  // the media-type toggle, `is:favorite` ORs into the Favorites scope); both controls still drive when
  // no op is present. `opChipText` surfaces the active op(s), mirroring the date chip.
  const ops = useMemo(() => parseSearchOps(q), [q]);
  const cleaned = ops.cleaned;
  const hasOp = ops.favorite || ops.mtype !== 'all';
  const effMtype: MType = ops.mtype !== 'all' ? ops.mtype : mtype;
  const effFav = scope === 'favorites' || ops.favorite;

  // Recovery for a filtered-empty state: reset the UI filters AND strip any inline operator from the
  // box (re-running on the cleaned text — an empty cleaned clears the search). Because an operator
  // OVERRIDES the UI controls, resetting scope/mtype alone can't clear an op-driven filter, so "Show
  // all" must also remove the operator token from the query.
  const showEverything = () => {
    resetFilters();
    if (hasOp) {
      setQ(cleaned);
      runNow(cleaned);
    }
  };
  const opChipText = [
    ops.mtype === 'videos' ? '🎬 Videos' : ops.mtype === 'photos' ? '🖼️ Photos' : null,
    ops.favorite ? '♡ Favorites' : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  // Parse the live query box for a capture-date intent. The date filter only applies to text search,
  // never to find-similar (whose results are their own thing and shouldn't be date-filtered by a
  // stale text box). `dateActive` = a date filter is in effect; `dateOnly` = a date with no CLIP word.
  const dateIntent = useMemo(() => confidentDateIntent(cleaned), [cleaned]);
  const dateActive = dateIntent != null && !search.similar;
  const dateOnly = useMemo(
    () => dateActive && !queryHasNonDateWords(cleaned),
    [dateActive, cleaned],
  );
  const dateText = dateIntent ? formatDateIntent(dateIntent) : '';

  // Operator-only mode: the box holds ONLY recognized ops (cleaned text empty) — a valid filter-only
  // query that needs neither CLIP nor a date. It renders the whole library filtered by the op(s),
  // exactly like the date-only local path.
  const opOnly = hasOp && cleaned.trim() === '' && !search.similar;

  // Date-only mode: the library filtered by capture date, newest first — no CLIP index required.
  const dateLibrary = useMemo<AssetMetadata[]>(() => {
    if (!dateIntent) return [];
    return assets.filter((a) => dateMatches(a, dateIntent)).sort((a, b) => assetMs(b) - assetMs(a));
  }, [assets, dateIntent]);

  // Operator-only mode: the whole library, newest first, ready for the op filter to narrow in `scoped`.
  const opLibrary = useMemo<AssetMetadata[]>(() => {
    if (!opOnly) return [];
    return [...assets].sort((a, b) => assetMs(b) - assetMs(a));
  }, [opOnly, assets]);

  // The rendered set, in precedence order:
  //   1. date-only          → local date-filtered library (works with or without CLIP)
  //   2. CLIP results (+date) → external_ids mapped to assets, relevance-ordered; if the query also
  //                             names a date (and isn't find-similar), intersect with it (keeping order)
  //   3. otherwise           → null (idle: suggestions / recents / hero)
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const results = useMemo<AssetMetadata[] | null>(() => {
    if (opOnly) return opLibrary; // filter-only query: whole library, op narrows it in `scoped`
    if (dateOnly) return dateLibrary;
    if (search.results == null) return null;
    // 1. CLIP visual matches, relevance-ordered.
    const clip = search.results
      .map((id) => byId.get(id))
      .filter((a): a is AssetMetadata => !!a);
    // 2. OCR / Live-Text matches for the SAME committed query — words found INSIDE photos (receipts,
    //    signs, screenshots). Appended after the visual matches, de-duplicated. Only on the text path
    //    (a real query, not find-similar); this is what makes "boarding pass" or a phone number
    //    findable even when CLIP ranks the photo low or misses it entirely.
    let merged = clip;
    if (!search.similar && search.lastQuery && ocrSearch) {
      const seen = new Set(clip.map((a) => a.id));
      const extra = ocrSearch(search.lastQuery)
        .filter((id) => !seen.has(id))
        .map((id) => byId.get(id))
        .filter((a): a is AssetMetadata => !!a);
      if (extra.length) merged = [...clip, ...extra];
    }
    // 3. CAPTION matches for the SAME committed query — words in the user's OWN per-photo captions
    //    (Apple indexes captions too). Exact/text like OCR, so caption-only hits are appended after the
    //    visual + OCR matches, de-duplicated against BOTH. Text path only (not find-similar). Guarded:
    //    searchCaptions reads the replica directly, so a DB hiccup degrades to "no caption hits" here
    //    rather than throwing into render (mirroring ocrSearch's own guard at its source).
    if (!search.similar && search.lastQuery) {
      const seen = new Set(merged.map((a) => a.id));
      let hits: string[] = [];
      try {
        hits = searchCaptions(search.lastQuery);
      } catch {
        hits = [];
      }
      const extra = hits
        .filter((id) => !seen.has(id))
        .map((id) => byId.get(id))
        .filter((a): a is AssetMetadata => !!a);
      if (extra.length) merged = [...merged, ...extra];
    }
    return dateActive ? merged.filter((a) => dateMatches(a, dateIntent!)) : merged;
  }, [opOnly, opLibrary, dateOnly, dateActive, dateIntent, dateLibrary, search.results, search.similar, search.lastQuery, byId, ocrSearch]);

  // Result chrome — media-type filter + Favorites scope, then the chosen sort, all layered on top of
  // the date filter. Narrowing runs first (Photos/Videos, then Favorites), ordering last. Relevance
  // returns the merged set as-is (the pure CLIP/OCR/date order); Newest/Oldest sort a COPY by capture
  // date so the memo input (`results`) is never mutated.
  const scoped = useMemo<AssetMetadata[] | null>(() => {
    if (results == null) return null;
    let out = results;
    // `effMtype` / `effFav` fold the inline operators onto the UI controls (a media op overrides the
    // toggle, `is:favorite` ORs into the Favorites scope). Narrowing first, then the chosen sort.
    if (effMtype !== 'all') {
      out = out.filter((a) => (effMtype === 'videos' ? a.mediaType === MediaType.VIDEO : a.mediaType !== MediaType.VIDEO));
    }
    if (effFav) out = out.filter((a) => a.isFavorite);
    if (sort !== 'relevance') {
      out = [...out].sort((a, b) => (sort === 'newest' ? assetMs(b) - assetMs(a) : assetMs(a) - assetMs(b)));
    }
    return out;
  }, [results, effFav, effMtype, sort]);

  // When the scoped set is empty, which control actually emptied it? If the media-type filter still
  // leaves items but Favorites removes them all, the "no <media type>" copy would be wrong — the real
  // cause is Favorites. This picks the honest empty-state message.
  const emptyFromFavorites = useMemo(() => {
    if (results == null || !effFav) return false;
    const typed =
      effMtype === 'all'
        ? results
        : results.filter((a) => (effMtype === 'videos' ? a.mediaType === MediaType.VIDEO : a.mediaType !== MediaType.VIDEO));
    return typed.length > 0; // items of this media type exist; only the Favorites filter emptied it
  }, [results, effFav, effMtype]);

  // Pre-typed DATE suggestions drawn from the library itself — the few most recent "Month Year"
  // buckets, then the current and prior calendar year (only when photos from them exist). Bucketed
  // in ONE pass: a Map of (year*12+month) → newest capture ms, plus the set of years present. Capped
  // at 8; empty for a tiny/undated library (the caller then renders just the generic examples).
  const dateSuggestions = useMemo<string[]>(() => {
    if (assets.length === 0) return [];
    const bucketMs = new Map<number, number>(); // year*12+month → newest capture ms in that month
    const years = new Set<number>();
    for (const a of assets) {
      const ms = assetMs(a);
      if (!(ms > 0)) continue;
      const d = new Date(ms);
      const y = d.getFullYear();
      years.add(y);
      const key = y * 12 + d.getMonth();
      const prev = bucketMs.get(key);
      if (prev === undefined || ms > prev) bucketMs.set(key, ms);
    }
    if (bucketMs.size === 0) return [];
    // Most-recent "Month Year" buckets first (by newest capture in each), capped at 4.
    const months = [...bucketMs.keys()]
      .sort((a, b) => bucketMs.get(b)! - bucketMs.get(a)!)
      .slice(0, 4)
      .map((key) => `${MONTH_LABELS[key % 12]} ${Math.floor(key / 12)}`);
    // Current + prior calendar year, but only when the library actually holds photos from them.
    const nowY = new Date().getFullYear();
    const yearChips = [nowY, nowY - 1].filter((y) => years.has(y)).map(String);
    return [...months, ...yearChips].slice(0, 8);
  }, [assets]);

  // FlashList inside PhotoGrid remounts on gridKey change, so the key must encode every dimension
  // that reorders/refilters the grid: the query/similar base, the scope lens, the date filter, AND
  // the result-chrome sort + media-type filter (a recycled cell would otherwise keep a stale photo).
  const dateSig = dateActive
    ? `date:${dateIntent!.year ?? '_'}-${dateIntent!.year2 ?? '_'}-${dateIntent!.month ?? '_'}`
    : 'date:none';
  const gridKey = `${
    opOnly ? 'op-only' : dateOnly ? 'date-only' : search.similar ? `sim:${results?.[0]?.id ?? ''}` : `q:${search.lastQuery}`
  }:${scope}:${dateSig}:${sort}:${mtype}:op${ops.favorite ? 1 : 0}-${ops.mtype}`;

  // The query the star saves: exactly what's in the box, whenever a (non-find-similar) result set is
  // showing — so a saved CLIP / date / operator query round-trips through runNow() verbatim. Empty
  // (star hidden) for find-similar (no query text to save) and the idle state. Also gated on !pending:
  // while a CLIP search is debouncing/in-flight the box already holds the NEW text but the grid still
  // shows the PREVIOUS results, so saving `q` then would capture a query the user hasn't run yet.
  // (`pending` is always false on the synchronous date-only / operator-only paths, so those keep it.)
  const saveableQuery = results != null && !search.similar && !pending ? q.trim() : '';
  const currentSaved =
    saveableQuery !== '' && saved.some((s) => s.toLowerCase() === saveableQuery.toLowerCase());

  // ── Select mode over results (Apple Photos' "Select" in search results) ─────────────────────────
  // Bulk actions over the CURRENTLY mapped/filtered grid (`scoped`), by asset id — exactly the id
  // space PhotoGrid's selection + onToggleFavorite already use. Only offered when there are results.
  const canSelectResults = !!onToggleFavorite && scoped != null && scoped.length > 0;
  const selCount = selected.size;
  const selAll = (scoped?.length ?? 0) > 0 && selCount === scoped!.length;
  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);
  const toggleSel = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const toggleSelAll = useCallback(() => {
    const cur = scoped ?? [];
    setSelected((prev) => (cur.length > 0 && prev.size === cur.length ? new Set() : new Set(cur.map((a) => a.id))));
  }, [scoped]);
  // Bulk Favorite — SearchScreen only has a per-id onToggleFavorite, so fan it out over the picks
  // (guarded against the undefined prop), then clear + exit. No delete/add-to-album handler exists here.
  const favoriteSelected = useCallback(() => {
    if (onToggleFavorite) for (const id of selected) onToggleFavorite(id, true);
    exitSelect();
  }, [onToggleFavorite, selected, exitSelect]);

  // A change to the QUERY (not the sort/scope/media chrome) drops out of select mode and clears the
  // picks — a stale selection is meaningless against a new result set. The signature deliberately
  // EXCLUDES sort/scope/mtype so toggling those (or favoriting) never resets an in-progress selection.
  const querySig =
    (results == null
      ? 'idle'
      : opOnly
        ? `op-only:${ops.mtype}-${ops.favorite ? 1 : 0}`
        : dateOnly
          ? `date-only:${dateSig}`
          : search.similar
            ? `sim:${results[0]?.id ?? ''}`
            : `q:${search.lastQuery}`) +
    // Fold the library size so a delete/change of the underlying library also exits select mode (the
    // selected set could otherwise reference photos that are gone).
    `:n${assets.length}`;
  useEffect(() => {
    exitSelect();
  }, [querySig, exitSelect]);

  // Ask Photos entry + modal — defined once and rendered in BOTH the pre-index and ready returns.
  const askSheet = (
    <AskSheet
      visible={askOpen}
      onClose={() => setAskOpen(false)}
      assets={assets}
      clipReady={search.status === 'ready'}
      indexing={search.status === 'loading' || search.status === 'indexing'}
      onEnableIndex={() => void search.enable()}
      // Close the sheet before running find-similar so its results land on the (now visible) Search
      // tab — otherwise the opaque modal hides them. Preserve the undefined pass-through (undefined
      // correctly hides the viewer's "Similar" pill before the index is ready).
      onFindSimilar={
        onFindSimilar
          ? (id: string) => {
              setAskOpen(false);
              onFindSimilar(id);
            }
          : undefined
      }
      onToggleFavorite={onToggleFavorite}
    />
  );
  const askEntry = (
    <Springy
      onPress={() => setAskOpen(true)}
      pressableStyle={styles.askEntry}
      accessibilityLabel="Ask Photos"
      accessibilityHint="Ask a plain-language question about your photos"
    >
      {/* Springy wraps children in an Animated.View, so the row layout must live on an inner View
          (the pressableStyle only lays out that single wrapper) — matches the HiddenView pattern. */}
      <View style={styles.askEntryInner}>
        <View style={styles.askIcon}>
          <Icon name="spark" size={16} color={palette.cyan} />
        </View>
        <View style={styles.askEntryBody}>
          <Text style={styles.askEntryTitle} maxFontSizeMultiplier={1.4}>Ask Photos</Text>
          <Text style={styles.askEntrySub} numberOfLines={1}>
            receipts from March · beach photos · videos last week
          </Text>
        </View>
        <Icon name="chevron" size={14} color={palette.muted} />
      </View>
    </Springy>
  );

  // Before the index exists: the opt-in enable / progress flow (kept as its crafted hero, now cyan).
  if (search.status !== 'ready') {
    const busy = search.status === 'loading' || search.status === 'indexing';
    const pct = search.status === 'loading' ? search.progress : search.total ? search.indexed / search.total : 0;
    return (
      <View style={styles.root}>
        <ScreenHeader title="Search" kicker="On-device intelligence" gradient={grad.search} accent={palette.cyan} />
        {askEntry}
        {askSheet}
        {/* The date box needs no CLIP index, so it lives here too — search by date before enabling. */}
        <View style={styles.controls}>
          <SearchField
            value={q}
            onChangeText={onChangeText}
            onSubmit={() => runNow(q)}
            onClear={clearQuery}
            placeholder="Search by date — March 2026, 2019…"
            accent={palette.cyan}
            pending={pending}
          />
          {q.trim() === '' && <TrySuggestions suggestions={dateSuggestions} onPick={runNow} />}
          {dateActive && (
            <View style={styles.dateChipRow}>
              <View style={styles.dateChip} accessible accessibilityLabel={`Date filter: ${dateText}`}>
                <Text style={styles.dateChipText}>{`📅 ${dateText}`}</Text>
              </View>
            </View>
          )}
          {hasOp && !search.similar && (
            <View style={styles.dateChipRow}>
              <View style={styles.dateChip} accessible accessibilityLabel={`Filter: ${opChipText}`}>
                <Text style={styles.dateChipText}>{opChipText}</Text>
              </View>
            </View>
          )}
          {(dateOnly || opOnly) && results && results.length > 0 && (
            <View style={styles.scopeWrap}>
              <Segmented options={SCOPES} value={scope} onChange={(k) => setScope(k as Scope)} accent={palette.cyan} />
            </View>
          )}
        </View>
        {(dateOnly || opOnly) && results ? (
          scoped!.length === 0 ? (
            <EmptyState
              orb
              orbColor={palette.cyan}
              glyph={dateOnly ? '📅' : effMtype === 'videos' ? '🎬' : effMtype === 'photos' ? '🖼️' : '♡'}
              title={
                dateOnly
                  ? effFav
                    ? 'No favorites here'
                    : 'No photos then'
                  : effMtype === 'videos'
                    ? 'No videos here'
                    : effMtype === 'photos'
                      ? 'No photos here'
                      : 'No favorites here'
              }
              subtitle={
                dateOnly
                  ? effFav
                    ? 'None of these are favorited yet.'
                    : `No photos from ${dateText} in your library.`
                  : effMtype === 'videos'
                    ? 'No videos in your library.'
                    : effMtype === 'photos'
                      ? 'No photos in your library.'
                      : 'Nothing favorited yet.'
              }
              action={
                scope === 'favorites' || hasOp ? (
                  <Chip label="Show all" accent={palette.cyan} onPress={showEverything} />
                ) : undefined
              }
            />
          ) : (
            <PhotoGrid
              data={scoped!}
              gridKey={gridKey}
              onFindSimilar={onFindSimilar}
              onToggleFavorite={onToggleFavorite}
            />
          )
        ) : (
          <Center>
            <View style={styles.heroWrap}>
              <BreathingOrb size={150} color={palette.cyan} />
              <FloatingView>
                <Text style={styles.hero}>✨</Text>
              </FloatingView>
            </View>
            <Text style={styles.pitch}>
              Search your photos by what’s in them — “a dog on a beach”, “sunset”, “my red car”.
            </Text>
            <Text style={styles.pitchSub}>On-device · offline · no Apple Intelligence</Text>
            <GradientButton
              label={search.status === 'error' ? 'Try again' : '✨ Enable semantic search'}
              tone="search"
              busy={busy}
              onPress={search.enable}
              style={styles.enable}
              accessibilityLabel={search.status === 'error' ? 'Try enabling semantic search again' : 'Enable semantic search'}
              accessibilityHint="Downloads the on-device model once, then indexes your library"
            />
            {busy && (
              <>
                <Text style={styles.statusCaption} accessibilityLiveRegion="polite">
                  {search.status === 'loading'
                    ? `Loading models…  ${Math.round(search.progress * 100)}%`
                    : `Indexing  ${search.indexed}/${search.total}…`}
                </Text>
                <View style={styles.progressWrap}>
                  <ProgressBar progress={pct} color={palette.cyan} />
                </View>
              </>
            )}
            {search.status === 'error' && (
              <Text style={styles.err}>{(search.error ?? '').slice(0, 200)}</Text>
            )}
          </Center>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Search" kicker="On-device intelligence" gradient={grad.search} accent={palette.cyan} />
      {askEntry}
      {askSheet}
      <View style={styles.controls}>
        <SearchField
          value={q}
          onChangeText={onChangeText}
          onSubmit={() => runNow(q)}
          onClear={clearQuery}
          placeholder="a dog on a beach, sunset, red car…"
          accent={palette.cyan}
          pending={pending}
        />

        {search.searchError && (
          <Text style={styles.searchErr}>Search failed — {search.searchError.slice(0, 140)}</Text>
        )}

        {ocr?.status === 'indexing' && ocr.total > ocr.done && (
          <Text style={styles.ocrCaption} numberOfLines={1}>
            {`🔤 Reading text in your photos · ${ocr.done}/${ocr.total}`}
          </Text>
        )}

        {dateActive && (
          <View style={styles.dateChipRow}>
            <View style={styles.dateChip} accessible accessibilityLabel={`Date filter: ${dateText}`}>
              <Text style={styles.dateChipText}>{`📅 ${dateText}`}</Text>
            </View>
          </View>
        )}

        {hasOp && !search.similar && (
          <View style={styles.dateChipRow}>
            <View style={styles.dateChip} accessible accessibilityLabel={`Filter: ${opChipText}`}>
              <Text style={styles.dateChipText}>{opChipText}</Text>
            </View>
          </View>
        )}

        {results == null ? (
          <>
            {q.trim() === '' && <TrySuggestions suggestions={dateSuggestions} onPick={runNow} />}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {EXAMPLES.map((ex) => (
                <Chip key={ex} label={ex} accent={palette.cyan} onPress={() => runNow(ex)} />
              ))}
            </ScrollView>
            {/* Saved searches — the user's curated one-tap queries (Apple Photos' saved searches). Tap
                re-runs via runNow (so a saved date/operator/CLIP query round-trips); long-press removes.
                Ready-idle only: every saved query is runnable here (the CLIP index is built), so no tap
                dead-ends on a not-yet-ready encoder. */}
            {q.trim() === '' && saved.length > 0 && (
              <View style={styles.savedWrap}>
                <Text style={styles.savedLabel} accessibilityRole="header">Saved</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {saved.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      accent={palette.cyan}
                      onPress={() => runNow(s)}
                      onLongPress={() => removeSaved(s)}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
            {/* Browse — Apple-Photos-style content categories, each a CLIP phrase (see CATEGORIES).
                Reached only in the ready return, so it's inherently gated on the index being built;
                shown on an empty box like the Try/Recent discovery rows. Tapping runs runNow(query). */}
            {q.trim() === '' && (
              <View style={styles.browseWrap}>
                <Text style={styles.browseLabel} accessibilityRole="header">Browse</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  {CATEGORIES.map((c) => (
                    <Chip key={c.label} label={c.label} accent={palette.cyan} onPress={() => runNow(c.query)} />
                  ))}
                </ScrollView>
              </View>
            )}
            {q.trim() === '' && recents.length > 0 && (
              <View style={styles.recentWrap}>
                <View style={styles.recentHead}>
                  <Text style={styles.recentLabel} accessibilityRole="header">Recent</Text>
                  <Springy
                    onPress={clearRecents}
                    hitSlop={8}
                    style={styles.recentClear}
                    accessibilityLabel="Clear recent searches"
                    accessibilityRole="button"
                  >
                    <Text style={styles.recentClearText}>Clear</Text>
                  </Springy>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}
                >
                  {recents.map((r) => (
                    <Chip key={r} label={r} accent={palette.cyan} onPress={() => runNow(r)} />
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        ) : (
          <>
            {search.similar ? (
              <View style={styles.crumb}>
                <View style={styles.crumbLeft}>
                  <Icon name="spark" size={14} color={palette.cyan} />
                  <Text style={styles.crumbText}>Similar to this</Text>
                </View>
                <Springy
                  onPress={clearQuery}
                  hitSlop={8}
                  style={styles.crumbClear}
                  accessibilityLabel="Clear similar search"
                >
                  <Text style={styles.crumbClearText}>Clear</Text>
                </Springy>
              </View>
            ) : dateOnly ? (
              <Text style={styles.meta} numberOfLines={1} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
                {`${scoped?.length ?? results.length} ${effMtype === 'videos' ? 'video' : 'photo'}${
                  (scoped?.length ?? results.length) === 1 ? '' : 's'
                } from ${dateText}`}
              </Text>
            ) : opOnly ? (
              <Text style={styles.meta} numberOfLines={1} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
                {`${scoped?.length ?? results.length} ${describeOps(effFav, effMtype, scoped?.length ?? results.length)}`}
              </Text>
            ) : (
              <Text style={styles.meta} numberOfLines={1} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3}>
                {`${scoped?.length ?? results.length} result${(scoped?.length ?? results.length) === 1 ? '' : 's'} for “${search.lastQuery}”`}
              </Text>
            )}
            {/* Save-this-search star (Apple Photos saves a search for one-tap re-run). Shown alongside
                any committed result set that isn't find-similar; hidden while selecting so the
                action row stays uncluttered. Toggles the raw box text in/out of the Saved list. */}
            {saveableQuery !== '' && !selecting && (
              <View style={styles.saveRow}>
                <Springy
                  onPress={() => toggleSaved(saveableQuery)}
                  hitSlop={8}
                  style={[styles.savePill, currentSaved && styles.savePillOn]}
                  accessibilityLabel={currentSaved ? 'Remove this search from Saved' : 'Save this search'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: currentSaved }}
                >
                  <Text style={[styles.savePillText, currentSaved && styles.savePillTextOn]} maxFontSizeMultiplier={1.3}>
                    {currentSaved ? '★ Saved' : '☆ Save'}
                  </Text>
                </Springy>
              </View>
            )}
            {/* Select affordance — enters multi-select over the current results; in select mode it
                becomes the live count + Select-all/None toggle on the left and Cancel on the right.
                Kept mounted while selecting (not just when results exist) so Cancel is always reachable. */}
            {(canSelectResults || selecting) && (
              <View style={styles.selectRow}>
                {selecting ? (
                  <View style={styles.selectLeft}>
                    <View style={styles.countChip} accessible accessibilityLabel={`${selCount} selected`}>
                      <Icon name="check" size={11} color={palette.cyan} strokeWidth={2} />
                      <RollingNumber value={selCount} fontSize={14} style={styles.countText} />
                    </View>
                    <Springy
                      onPress={toggleSelAll}
                      hitSlop={{ top: 13, bottom: 13, left: 8, right: 8 }}
                      accessibilityLabel={selAll ? 'Deselect all' : 'Select all'}
                      accessibilityState={{ selected: selAll }}
                    >
                      <Text style={styles.selectAll} maxFontSizeMultiplier={1.3}>{selAll ? 'None' : 'Select all'}</Text>
                    </Springy>
                  </View>
                ) : (
                  <View />
                )}
                <Springy
                  onPress={selecting ? exitSelect : () => setSelecting(true)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
                  accessibilityLabel={selecting ? 'Cancel selection' : 'Select photos'}
                  accessibilityHint={selecting ? undefined : 'Turns on multi-select for these results'}
                >
                  <Text style={styles.selectBtn} maxFontSizeMultiplier={1.3}>{selecting ? 'Cancel' : 'Select'}</Text>
                </Springy>
              </View>
            )}
            {/* Filter/sort chrome hides while selecting (mirrors Library) so the picked set can't shift
                out from under the selection; the scope/media/sort state is preserved, just not editable. */}
            {!selecting && (
              <>
                <View style={styles.scopeWrap}>
                  <Segmented options={SCOPES} value={scope} onChange={(k) => setScope(k as Scope)} accent={palette.cyan} />
                </View>
                {/* Result chrome — media-type filter + sort, shown only alongside a result set. */}
                <View style={styles.scopeWrap}>
                  <Segmented options={MTYPES} value={mtype} onChange={(k) => setMtype(k as MType)} accent={palette.cyan} />
                </View>
                <View style={styles.scopeWrap}>
                  <Segmented options={SORTS} value={sort} onChange={(k) => setSort(k as Sort)} accent={palette.cyan} />
                </View>
              </>
            )}
          </>
        )}
      </View>

      {results == null ? (
        <EmptyState
          orb
          orbColor={palette.cyan}
          glyph="✨"
          title="Search your photos"
          subtitle="Type a phrase, or tap a suggestion above."
        />
      ) : results.length === 0 ? (
        <EmptyState
          orb
          orbColor={palette.cyan}
          glyph={dateOnly ? '📅' : opOnly ? '🖼️' : search.similar ? '✨' : '🔍'}
          title={dateOnly ? 'No photos then' : opOnly ? 'Nothing here' : search.similar ? 'Nothing similar' : 'No matches'}
          subtitle={
            dateOnly
              ? `No photos from ${dateText} in your library.`
              : opOnly
                ? 'Your library is empty.'
                : search.similar
                  ? 'No lookalikes turned up in your library.'
                  : `Nothing for “${search.lastQuery}”. Try another phrase.`
          }
        />
      ) : scoped!.length === 0 ? (
        <EmptyState
          orb
          orbColor={palette.cyan}
          glyph={emptyFromFavorites ? '♡' : effMtype === 'videos' ? '🎬' : effMtype === 'photos' ? '🖼️' : '♡'}
          title={
            emptyFromFavorites
              ? 'No favorites here'
              : effMtype === 'videos'
                ? 'No videos here'
                : effMtype === 'photos'
                  ? 'No photos here'
                  : 'No favorites here'
          }
          subtitle={
            emptyFromFavorites
              ? 'None of these matches are favorited yet.'
              : effMtype === 'videos'
                ? 'No videos among these matches.'
                : effMtype === 'photos'
                  ? 'No photos among these matches.'
                  : 'None of these matches are favorited yet.'
          }
          action={<Chip label="Show all" accent={palette.cyan} onPress={showEverything} />}
        />
      ) : (
        <PhotoGrid
          data={scoped!}
          gridKey={gridKey}
          onFindSimilar={onFindSimilar}
          onToggleFavorite={onToggleFavorite}
          selection={selecting ? { active: true, selected, onToggle: toggleSel } : undefined}
        />
      )}

      {/* Bulk-action bar — chrome, so the cyan accent is welcome (it never sits over a photo). Reveal
          keeps it mounted and slides it in once at least one result is picked; Favorite fans the picks
          through onToggleFavorite, then clears + exits (see favoriteSelected). */}
      <Reveal visible={selecting && selCount > 0} style={[styles.actionBar, { paddingBottom: 14 + insets.bottom }]}>
        <View style={styles.actionRow}>
          <Springy
            pressableStyle={styles.action}
            onPress={favoriteSelected}
            accessibilityLabel={`Favorite ${selCount} photo${selCount === 1 ? '' : 's'}`}
          >
            <View style={styles.actionInner}>
              <Icon name="heartFill" size={18} color={palette.pink} />
              <Text style={[styles.actionText, styles.favTint]} maxFontSizeMultiplier={1.3}>Favorite</Text>
              <RollingNumber value={selCount} fontSize={15} style={[styles.actionText, styles.favTint]} />
            </View>
          </Springy>
        </View>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 0 },
  askEntry: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.faint),
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  askEntryInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  askIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: tint(palette.cyan, tintFill.rest),
    alignItems: 'center',
    justifyContent: 'center',
  },
  askEntryBody: { flex: 1 },
  askEntryTitle: { ...typography.cardTitle, color: palette.text },
  askEntrySub: { ...typography.caption, color: palette.muted, marginTop: 2 },
  meta: { ...typography.meta, color: palette.cyan, marginTop: 12, fontVariant: ['tabular-nums'] },
  searchErr: { color: palette.danger, fontSize: 13, marginTop: 12 },
  ocrCaption: {
    color: palette.sub,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },

  dateChipRow: { flexDirection: 'row', marginTop: 12 },
  dateChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dateChipText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },

  chips: { gap: 8, paddingTop: 12, paddingRight: 16 },

  tryWrap: { marginTop: 2 },
  tryLabel: { ...typography.kicker, color: palette.sub, marginTop: 16 },

  browseWrap: { marginTop: 2 },
  browseLabel: { ...typography.kicker, color: palette.sub, marginTop: 16 },

  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  crumbLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  crumbText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },
  crumbClear: {
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  crumbClearText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },
  scopeWrap: { marginTop: 12 },

  // Save-this-search pill (over a result set) + the idle "Saved" row. Both route through the cyan
  // Search accent, matching the date/operator chips.
  saveRow: { flexDirection: 'row', marginTop: 12 },
  savePill: {
    alignSelf: 'flex-start',
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.faint),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  savePillOn: {
    backgroundColor: tint(palette.cyan, tintFill.active),
    borderColor: tint(palette.cyan, tintBorder.active),
  },
  savePillText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },
  savePillTextOn: { color: palette.text },

  savedWrap: { marginTop: 2 },
  savedLabel: { ...typography.kicker, color: palette.sub, marginTop: 16 },

  recentWrap: { marginTop: 2 },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  recentLabel: { ...typography.kicker, color: palette.sub },
  recentClear: {
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recentClearText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },

  heroWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  hero: { fontSize: 48 },
  pitch: { color: palette.text, fontSize: 17, textAlign: 'center', lineHeight: 24, fontWeight: '600' },
  pitchSub: { color: palette.muted, fontSize: 13, textAlign: 'center', letterSpacing: 0.3 },
  enable: { marginTop: 16, minWidth: 250, alignSelf: 'center' },
  statusCaption: {
    color: palette.sub,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  progressWrap: { width: 220, marginTop: 12 },
  err: { color: palette.danger, fontSize: 12, textAlign: 'center', marginTop: 12 },

  // Select-mode chrome (over results): the enter/Cancel button + live count chip + Select-all toggle.
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  selectLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectBtn: { ...typography.body, color: palette.cyan, fontWeight: '700' },
  selectAll: { ...typography.body, color: palette.cyan, fontWeight: '700' },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: tint(palette.cyan, tintFill.rest),
  },
  countText: { color: palette.cyan, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Bottom batch-action bar — chrome (never behind a photo), so the cyan-tinted top border is welcome.
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.popover,
    borderTopColor: tint(palette.cyan, tintBorder.faint),
    borderTopWidth: 1,
    paddingTop: 14,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  action: { flex: 1, alignItems: 'center' },
  actionInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionText: { ...typography.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  favTint: { color: palette.pink },
});
