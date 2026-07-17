/**
 * Ask Photos — the on-device natural-language query planner.
 *
 * Apple's "Ask Photos" leans on a cloud LLM. Ours is fully offline. It PLANS a query by decomposing
 * the text into structured intents — a capture-date WINDOW, a favorites flag, a media-type filter —
 * plus a residual SEMANTIC phrase, then executes each as a set and INTERSECTS them (AND). The semantic
 * phrase is answered by CLIP (visual) ∪ OCR text (Live-Text) — the very same on-device signals the
 * Search tab already uses — so there is no cloud, no Apple Intelligence, and no network.
 *
 * This module splits cleanly into a PURE parser and a thin async executor:
 *   • parseAsk(text, now?)  — no library/DB/state dependency. Relative dates ("last week", "3 days
 *     ago") are computed against `now`, which defaults to Date.now() at CALL time (never module scope),
 *     so the parser is fully deterministic and unit-testable by passing a fixed `now`.
 *   • executeAsk(plan, …)   — runs CLIP + reads the replica sets, applies the hard filters, ranks.
 *
 * Design choices worth knowing:
 *   • "videos / movies / clips" set a hard media filter; "photos / pictures / images" are treated as
 *     NEUTRAL filler (stripped from the phrase but NOT a filter) so "beach photos" doesn't silently
 *     exclude beach videos — only an explicit video word narrows media.
 *   • The FIRST date reading wins (a relative phrase beats a bare month), mirroring how a person reads
 *     "photos from last March" — the nearer, more specific window.
 *   • Content categories like receipts/documents/menus are NOT special-cased: they flow into the
 *     semantic phrase, where CLIP ("a receipt") ∪ OCR ("receipt") retrieve them. This keeps the planner
 *     small and lets both signals contribute.
 */
import { MediaType, type AssetMetadata } from 'expo-media-library';
import { embedText } from './semantic';
import { searchByEmbedding, searchPhotoText } from './replica';

export type MediaFilter = 'all' | 'photos' | 'videos';

/** A concrete half-open capture-date window [start, end) in epoch-ms, with a human label. */
export interface DateWindow {
  start: number;
  end: number;
  label: string;
}

export interface AskPlan {
  raw: string;
  /** Residual CLIP/OCR phrase, or null when the query was pure filters (e.g. "videos from last week"). */
  semantic: string | null;
  date: DateWindow | null;
  favorite: boolean;
  media: MediaFilter;
  /** Human-readable understood constraints, for the transparent "here's what I heard" plan surface. */
  chips: string[];
}

export interface AskResult {
  plan: AskPlan;
  assets: AssetMetadata[];
  usedClip: boolean; // a CLIP retrieval actually ran (index ready + a semantic phrase)
  usedOcr: boolean; // OCR text matches contributed
  /** True when the query needed CLIP for its semantic phrase but the index isn't built yet. */
  needsIndex: boolean;
}

const DAY = 86_400_000;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Filler words stripped from the residual before it becomes the semantic phrase. These are the
// connective/scaffolding words of a spoken request ("show me my photos of …"); a token that survives
// this set is a real content word CLIP/OCR should retrieve against.
const STOPWORDS = new Set([
  'show', 'me', 'my', 'find', 'get', 'all', 'of', 'the', 'a', 'an', 'with', 'and', 'to', 'for',
  'photo', 'photos', 'pic', 'pics', 'picture', 'pictures', 'image', 'images', 'still', 'stills',
  'taken', 'shot', 'shots', 'from', 'in', 'on', 'during', 'that', 'i', 'have', 'has', 'are', 'is',
  'some', 'any', 'at', 'was', 'were', 'please', 'showing', 'containing', 'where', "there's", 'there',
]);

const FAVORITE_WORDS = new Set(['favorite', 'favorites', 'favourite', 'favourites', 'fav', 'favs', 'faved', 'loved', 'starred', 'hearted']);
const VIDEO_WORDS = new Set(['video', 'videos', 'movie', 'movies', 'clip', 'clips']);
// Photo words are recognized only to STRIP them from the phrase — they never set a media filter.
const PHOTO_WORDS = new Set(['photo', 'photos', 'pic', 'pics', 'picture', 'pictures', 'image', 'images', 'still', 'stills']);

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

// ── date helpers (all local, no toLocale*; computed from an explicit ms so they stay pure) ──────────
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Sunday-anchored start of the calendar week containing `ms` (US default, matching iOS's default). */
function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  // Calendar arithmetic (not fixed-ms subtraction) so a DST-transition week still lands on local
  // midnight — the Date(y,m,day) constructor normalizes and rolls month/year.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
}
function startOfMonth(year: number, month: number): number {
  return new Date(year, month, 1, 0, 0, 0, 0).getTime();
}
function startOfYear(year: number): number {
  return new Date(year, 0, 1, 0, 0, 0, 0).getTime();
}
/** Local-midnight `n` calendar days from the day containing `ms` (DST-safe; +n future, -n past). */
function dayPlus(ms: number, n: number): number {
  const d = new Date(startOfDay(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}
/** Local-midnight of the week-start `n` calendar weeks from the week containing `ms` (DST-safe). */
function weekPlus(ms: number, n: number): number {
  const d = new Date(startOfWeek(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7).getTime();
}

/**
 * Parse the FIRST recognizable capture-date intent out of `text` and return both the concrete window
 * and the exact substring matched (so the caller can strip it before reading the semantic phrase).
 * Relative phrases are matched first (they're the more specific reading), then absolute month/year.
 */
function parseDate(text: string, now: number): { window: DateWindow; matched: string } | null {
  const lc = text.toLowerCase();

  // today / yesterday (calendar-based so the window sits on local midnight even across a DST day)
  let m = lc.match(/\btoday\b/);
  if (m) {
    return { window: { start: dayPlus(now, 0), end: dayPlus(now, 1), label: 'Today' }, matched: m[0] };
  }
  m = lc.match(/\byesterday\b/);
  if (m) {
    return { window: { start: dayPlus(now, -1), end: dayPlus(now, 0), label: 'Yesterday' }, matched: m[0] };
  }

  // "<n> <unit> ago" → the calendar unit that many units back (a single day/week/month/year window)
  m = lc.match(/\b(\d{1,3})\s+(day|days|week|weeks|month|months|year|years)\s+ago\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit.startsWith('day')) {
      return { window: { start: dayPlus(now, -n), end: dayPlus(now, -n + 1), label: n === 1 ? 'Yesterday' : `${n} days ago` }, matched: m[0] };
    }
    if (unit.startsWith('week')) {
      return { window: { start: weekPlus(now, -n), end: weekPlus(now, -n + 1), label: n === 1 ? 'Last week' : `${n} weeks ago` }, matched: m[0] };
    }
    if (unit.startsWith('month')) {
      const d = new Date(now);
      const s = startOfMonth(d.getFullYear(), d.getMonth() - n);
      const e = startOfMonth(d.getFullYear(), d.getMonth() - n + 1);
      const sd = new Date(s);
      return { window: { start: s, end: e, label: `${MONTH_LABELS[sd.getMonth()]} ${sd.getFullYear()}` }, matched: m[0] };
    }
    // years
    const y = new Date(now).getFullYear() - n;
    return { window: { start: startOfYear(y), end: startOfYear(y + 1), label: String(y) }, matched: m[0] };
  }

  // "past/last <n> days|weeks|months|years" → a ROLLING window ending now (distinct from the calendar
  // "last week"/"last month", which take no number). Days/weeks use a fixed span; months/years roll
  // back by CALENDAR so "past 6 months" is a real six-month span, not 6×30 days. Without the month/
  // year units these phrasings matched no branch — the date was silently dropped and "last 6 months"
  // leaked into the CLIP phrase.
  m = lc.match(/\b(?:past|last)\s+(\d{1,3})\s+(day|days|week|weeks|month|months|year|years)\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const d = new Date(now);
    if (unit.startsWith('day')) return { window: { start: now - n * DAY, end: now, label: `Past ${n} days` }, matched: m[0] };
    if (unit.startsWith('week')) return { window: { start: now - n * 7 * DAY, end: now, label: `Past ${n} weeks` }, matched: m[0] };
    if (unit.startsWith('month')) {
      return { window: { start: new Date(d.getFullYear(), d.getMonth() - n, d.getDate()).getTime(), end: now, label: `Past ${n} months` }, matched: m[0] };
    }
    return { window: { start: new Date(d.getFullYear() - n, d.getMonth(), d.getDate()).getTime(), end: now, label: `Past ${n} years` }, matched: m[0] };
  }

  // this/last week|month|year → calendar-aligned windows
  m = lc.match(/\b(this|last)\s+(week|month|year)\b/);
  if (m) {
    const rel = m[1];
    const unit = m[2];
    const d = new Date(now);
    if (unit === 'week') {
      return rel === 'this'
        ? { window: { start: weekPlus(now, 0), end: weekPlus(now, 1), label: 'This week' }, matched: m[0] }
        : { window: { start: weekPlus(now, -1), end: weekPlus(now, 0), label: 'Last week' }, matched: m[0] };
    }

    if (unit === 'month') {
      return rel === 'this'
        ? { window: { start: startOfMonth(d.getFullYear(), d.getMonth()), end: startOfMonth(d.getFullYear(), d.getMonth() + 1), label: 'This month' }, matched: m[0] }
        : { window: { start: startOfMonth(d.getFullYear(), d.getMonth() - 1), end: startOfMonth(d.getFullYear(), d.getMonth()), label: 'Last month' }, matched: m[0] };
    }
    // year
    return rel === 'this'
      ? { window: { start: startOfYear(d.getFullYear()), end: startOfYear(d.getFullYear() + 1), label: 'This year' }, matched: m[0] }
      : { window: { start: startOfYear(d.getFullYear() - 1), end: startOfYear(d.getFullYear()), label: 'Last year' }, matched: m[0] };
  }

  // Absolute month name (+ optional 19xx–20xx year) and/or a bare year.
  const toks = tokenize(text);
  let monthIdx = -1;
  let year = -1;
  for (const t of toks) {
    if (monthIdx < 0) {
      const mi = MONTH_NAMES.findIndex((n) => n === t || (t.length === 3 && n.slice(0, 3) === t));
      if (mi >= 0) { monthIdx = mi; continue; }
    }
    if (year < 0 && /^\d{4}$/.test(t)) {
      const n = Number(t);
      if (n >= 1900 && n <= 2099) year = n;
    }
  }
  if (monthIdx >= 0) {
    // A bare month with no year resolves to its MOST RECENT past occurrence (this year if that month
    // has already started, else last year) — a concrete, useful window rather than "any March ever".
    const nowD = new Date(now);
    const y = year >= 0 ? year : (monthIdx <= nowD.getMonth() ? nowD.getFullYear() : nowD.getFullYear() - 1);
    const label = year >= 0 ? `${MONTH_LABELS[monthIdx]} ${y}` : MONTH_LABELS[monthIdx];
    // matched string is a rough reconstruction just for stripping — the token scan below re-strips.
    return { window: { start: startOfMonth(y, monthIdx), end: startOfMonth(y, monthIdx + 1), label }, matched: MONTH_NAMES[monthIdx] };
  }
  if (year >= 0) {
    return { window: { start: startOfYear(year), end: startOfYear(year + 1), label: String(year) }, matched: String(year) };
  }
  return null;
}

/**
 * Decompose a natural-language query into an executable plan. Pure: dates resolve against `now`
 * (default Date.now() at call time), everything else is string work — safe to unit-test with a fixed
 * `now` and no DB.
 */
export function parseAsk(text: string, now: number = Date.now()): AskPlan {
  const raw = text.trim();
  const chips: string[] = [];

  // 1) Date — strip its matched substring so its tokens don't leak into the phrase. Bare month/year
  //    is stripped token-wise below (matched is only the month/year word itself).
  const dateHit = raw ? parseDate(raw, now) : null;
  let residual = raw;
  if (dateHit) {
    // Strip ONLY standalone occurrences of the matched date text. Every `matched` value (relative
    // phrase, month name, 4-digit year) begins and ends with a word char, so \b is safe — and it
    // stops a bare month from eating a substring of another word ("march" out of "marching", "may"
    // out of "mayor"), which would otherwise leak a mangled fragment into the semantic phrase.
    residual = residual.replace(new RegExp(`\\b${escapeRe(dateHit.matched)}\\b`, 'ig'), ' ');
    chips.push(`📅 ${dateHit.window.label}`);
  }

  // 2) Filters + semantic phrase from the residual tokens.
  let favorite = false;
  let media: MediaFilter = 'all';
  const phraseWords: string[] = [];
  for (const t of tokenize(residual)) {
    // Skip any leftover bare year that a month-only date match left behind.
    if (/^\d{4}$/.test(t) && Number(t) >= 1900 && Number(t) <= 2099) continue;
    if (FAVORITE_WORDS.has(t)) { favorite = true; continue; }
    if (VIDEO_WORDS.has(t)) { media = 'videos'; continue; }
    if (PHOTO_WORDS.has(t)) continue; // neutral filler — strip but don't filter
    if (STOPWORDS.has(t)) continue;
    // A leftover month word (from a bare-month date match) shouldn't re-enter the phrase.
    if (MONTH_NAMES.some((n) => n === t || (t.length === 3 && n.slice(0, 3) === t))) continue;
    phraseWords.push(t);
  }
  if (favorite) chips.push('★ Favorites');
  if (media === 'videos') chips.push('🎬 Videos');

  const semantic = phraseWords.length ? phraseWords.join(' ') : null;
  if (semantic) chips.push(`“${semantic}”`);

  return { raw, semantic, date: dateHit ? dateHit.window : null, favorite, media, chips };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nothing to run: an empty box, or a query that parsed to no phrase and no filters. */
export function planIsEmpty(p: AskPlan): boolean {
  return !p.semantic && !p.date && !p.favorite && p.media === 'all';
}

/**
 * Execute a plan against the library. `assets` is the caller's VISIBLE set (already hidden-filtered);
 * we intersect every retrieval with it so hidden/deleted photos can never surface. CLIP runs only when
 * the index is ready AND there's a semantic phrase; OCR always contributes (it's a cheap LIKE and is
 * simply empty when un-indexed, e.g. on a simulator build without the native recognizer).
 */
export async function executeAsk(
  plan: AskPlan,
  opts: { assets: AssetMetadata[]; clipReady: boolean; clipK?: number },
): Promise<AskResult> {
  const { assets, clipReady } = opts;
  const byId = new Map(assets.map((a) => [a.id, a] as const));

  let ordered: AssetMetadata[];
  let usedClip = false;
  let usedOcr = false;
  let needsIndex = false;

  if (plan.semantic) {
    // Semantic phrase → CLIP (visual) ∪ OCR (text), CLIP-ranked first, OCR-only matches appended.
    const seen = new Set<string>();
    ordered = [];
    if (clipReady) {
      try {
        const emb = await embedText(plan.semantic);
        for (const id of searchByEmbedding(emb, opts.clipK ?? 300)) {
          const a = byId.get(id);
          if (a && !seen.has(id)) { seen.add(id); ordered.push(a); usedClip = true; }
        }
      } catch {
        /* a transient encoder failure just means no CLIP contribution this run */
      }
    } else {
      needsIndex = true;
    }
    for (const id of searchPhotoText(plan.semantic, 300)) {
      const a = byId.get(id);
      if (a && !seen.has(id)) { seen.add(id); ordered.push(a); usedOcr = true; }
    }
  } else {
    // Pure-filter query (date/favorite/media) → the whole library, newest first.
    ordered = [...assets].sort((a, b) => assetMs(b) - assetMs(a));
  }

  // Apply the hard filters as an AND pass over the ordered candidates (order preserved = ranking).
  const out = ordered.filter((a) => {
    if (plan.favorite && !a.isFavorite) return false;
    if (plan.media === 'videos' && a.mediaType !== MediaType.VIDEO) return false;
    if (plan.date) {
      const ms = assetMs(a);
      if (!(ms >= plan.date.start && ms < plan.date.end)) return false;
    }
    return true;
  });

  return { plan, assets: out, usedClip, usedOcr, needsIndex };
}

/** `creationTime` is ms; tolerate second-precision like the rest of the app. */
function assetMs(a: AssetMetadata): number {
  const raw = a.creationTime ?? 0;
  return raw > 0 && raw < 1e11 ? raw * 1000 : raw;
}
