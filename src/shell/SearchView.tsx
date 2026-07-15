// Unified Search destination (Phase 1). Combines literal/facet search
// (search_photo_library) with on-device semantic ranking (semantic_search_photos),
// homing the previously-orphaned AI search command into a first-class tab.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, AudioLines, Clock3, ExternalLink, ImageIcon, Loader2, Search, Sparkles, Video, X } from "lucide-react";
import type { TranslationKey } from "../i18n";
import type { PhotoLibrarySearchItem, PhotoLibrarySearchResult, SemanticSearchPhotoItem, SemanticSearchPhotosValue } from "../types";
import { revealDelayStyle } from "../lib/revealStagger";
import { semanticSearchUnavailableMessage } from "../lib/semanticSearchStatus";
import { photoSearchIndexNotice } from "../views/photoIndexingStatus";

interface SearchViewProps {
  active: boolean;
  searchPhotoLibrary: (params: Record<string, unknown>) => Promise<PhotoLibrarySearchResult>;
  semanticSearchPhotos: (params: Record<string, unknown>) => Promise<SemanticSearchPhotosValue | null>;
  onOpenResult?: (item: PhotoLibrarySearchItem) => void;
  t: (key: TranslationKey) => string;
  uiText: (source: string) => string;
}

const SUGGESTION_SEEDS = ["beach", "sunset", "dogs", "birthday", "documents", "mountains", "food", "screenshots"];
const RECENT_SEARCHES_KEY = "vintrace.search.recent.v1";
const RECENT_SEARCHES_LIMIT = 6;

function readRecentSearches(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || "").trim())
      .filter((value, index, rows) => value.length >= 2 && rows.findIndex((row) => row.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
      .slice(0, RECENT_SEARCHES_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentSearches(values: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(values.slice(0, RECENT_SEARCHES_LIMIT)));
  } catch {
    /* Search remains fully usable when browser storage is unavailable. */
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatVideoTimestamp(value: number | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function reveal(path: string) {
  try {
    void window.crossAge?.revealPath?.(path)?.catch?.(() => undefined);
  } catch {
    /* reveal is best-effort */
  }
}

export function SearchView({ active, searchPhotoLibrary, semanticSearchPhotos, onOpenResult, t, uiText }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [aiMode, setAiMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [textResult, setTextResult] = useState<PhotoLibrarySearchResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticSearchPhotosValue | null>(null);
  const [submitted, setSubmitted] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  // Distinguishes a true failure (announce assertively, AlertTriangle) from a
  // benign empty result (announce politely, neutral icon).
  const [errorIsFailure, setErrorIsFailure] = useState(false);
  const searchRequestSeqRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  function invalidateSearchResults() {
    searchRequestSeqRef.current += 1;
  }

  async function runSearch(raw: string) {
    const value = raw.trim();
    if (value.length < 2) {
      invalidateSearchResults();
      setError(uiText("Type at least 2 characters to search."));
      setErrorIsFailure(false);
      return;
    }
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;
    const isCurrentSearch = () => searchRequestSeqRef.current === requestSeq;
    setBusy(true);
    setError("");
    setErrorIsFailure(false);
    setSubmitted(value);
    setRecentSearches((current) => {
      const folded = value.toLocaleLowerCase();
      const next = [value, ...current.filter((item) => item.toLocaleLowerCase() !== folded)].slice(0, RECENT_SEARCHES_LIMIT);
      writeRecentSearches(next);
      return next;
    });
    try {
      if (aiMode) {
        const result = await semanticSearchPhotos({ query: value, limit: 60 });
        if (!isCurrentSearch()) return;
        setSemanticResult(result);
        setTextResult(null);
        const semanticResultCount = result ? Math.max(result.results.length, result.items?.length || 0) : 0;
        if (!result || !result.available || (semanticResultCount === 0 && (result.missingEmbeddings || 0) > 0)) {
          const fallback = await searchPhotoLibrary({ query: value, limit: 24, suggestionLimit: 24, previewBudget: 12 });
          if (!isCurrentSearch()) return;
          setTextResult(fallback);
          const availability = result
            ? semanticSearchUnavailableMessage(result.reason, uiText)
            : uiText("On-device AI search could not start.");
          const indexing = result && result.available && (result.missingEmbeddings || 0) > 0
            ? result.queued
              ? uiText("Semantic indexing is queued.")
              : uiText("Semantic indexing has not finished for this library yet.")
            : availability;
          setError(`${indexing} ${fallback.total > 0 ? uiText("Showing keyword matches instead.") : uiText("Keyword search found no matches.")}`);
          setErrorIsFailure(!result || !result.available);
        } else if ((result.missingEmbeddings || 0) > 0) {
          setError(uiText("Some photos and video moments are still being indexed. Showing the AI matches available now."));
        } else if (semanticResultCount === 0) {
          setError(uiText("No semantic matches found."));
        }
      } else {
        const result = await searchPhotoLibrary({ query: value, limit: 24, suggestionLimit: 24, previewBudget: 12 });
        if (!isCurrentSearch()) return;
        setTextResult(result);
        setSemanticResult(null);
        if (result.total === 0) setError(uiText("No matches found."));
      }
    } catch (err) {
      if (!isCurrentSearch()) return;
      if (aiMode) {
        try {
          const fallback = await searchPhotoLibrary({ query: value, limit: 24, suggestionLimit: 24, previewBudget: 12 });
          if (!isCurrentSearch()) return;
          setTextResult(fallback);
          setSemanticResult(null);
          setError(`${uiText("AI search could not finish.")} ${fallback.total > 0 ? uiText("Showing keyword matches instead.") : uiText("Keyword search found no matches.")}`);
          setErrorIsFailure(true);
          return;
        } catch {
          if (!isCurrentSearch()) return;
        }
      }
      setError(uiText("Search could not finish. Try again."));
      setErrorIsFailure(true);
      setTextResult(null);
      setSemanticResult(null);
    } finally {
      if (isCurrentSearch()) setBusy(false);
    }
  }

  const semanticBest = semanticResult?.results[0]?.score || 0;
  const hasResults = Boolean((textResult && textResult.total > 0) || (semanticResult && semanticResult.results.length > 0));
  const lexicalIndexNotice = photoSearchIndexNotice(textResult?.searchIndex, null, {
    uiText,
    formatCount: (value) => value.toLocaleString(),
  });

  function openPhotoResult(sourcePath: string, title = "", semanticItem?: SemanticSearchPhotoItem) {
    if (onOpenResult) {
      onOpenResult({
        id: semanticItem?.segmentId ? `video-segment:${semanticItem.segmentId}` : `photo:${sourcePath}`,
        kind: "photo",
        title: title || basename(sourcePath),
        sourcePath,
        searchText: title || basename(sourcePath),
        mediaKind: semanticItem?.mediaKind,
        resultKind: semanticItem?.resultKind,
        segmentId: semanticItem?.segmentId,
        timestampMs: semanticItem?.timestampMs,
        startMs: semanticItem?.startMs,
        endMs: semanticItem?.endMs,
        durationMs: semanticItem?.durationMs,
      });
      return;
    }
    reveal(sourcePath);
  }

  return (
    <div className="search-view">
      <form
        className="search-hero"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query);
        }}
      >
        <Search size={22} className="search-hero-icon" />
        <input
          ref={searchInputRef}
          className="search-hero-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={uiText("Search photos, people, places, things")}
          aria-label={uiText("Search photos")}
        />
        {query && (
          <button
            type="button"
            className="search-hero-clear"
            aria-label={uiText("Clear search")}
            onClick={() => {
              invalidateSearchResults();
              setQuery("");
              setTextResult(null);
              setSemanticResult(null);
              setError("");
              setErrorIsFailure(false);
              setSubmitted("");
              setBusy(false);
            }}
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          className={`search-ai-toggle${aiMode ? " active" : ""}`}
          aria-pressed={aiMode}
          onClick={() => {
            invalidateSearchResults();
            setAiMode((on) => !on);
            setBusy(false);
          }}
          title={uiText("Search by meaning with on-device AI")}
        >
          <Sparkles size={15} />
          <span>{uiText("AI")}</span>
        </button>
        <button type="submit" className="search-hero-submit" disabled={busy || query.trim().length < 2}>
          {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
          <span>{busy ? uiText("Searching") : uiText("Search")}</span>
        </button>
      </form>

      <div className="search-scope-chips" role="note">
        <span className={aiMode ? "search-scope-hint ai" : "search-scope-hint"}>{aiMode ? uiText("On-device AI ranking") : uiText("Keyword & facet search")}</span>
        <span className="search-mode-help">{aiMode ? uiText("Finds photos and video moments by meaning, on your device.") : uiText("Matches names, dates, tags, and text.")}</span>
      </div>

      {busy && <div className="search-status" role="status" aria-live="polite"><Loader2 size={15} className="spin" /><span>{uiText("Searching")} “{submitted}”…</span></div>}

      {error && !busy && (
        <div className="search-status" role={errorIsFailure ? "alert" : "status"}>
          {errorIsFailure ? <AlertTriangle size={15} /> : <Search size={15} />}
          <span>{error}</span>
          {errorIsFailure && submitted && (
            <button type="button" className="search-status-retry" onClick={() => void runSearch(submitted)}>
              {uiText("Try again")}
            </button>
          )}
        </div>
      )}

      {lexicalIndexNotice.pending && !busy && (
        <div className="search-index-status" role="status" aria-label={uiText("Search indexing status")}>
          <Clock3 size={15} />
          <span>
            <strong>{uiText("Search results may be incomplete")}</strong>
            <small>{lexicalIndexNotice.detail} {lexicalIndexNotice.queueDetail}</small>
          </span>
        </div>
      )}

      {!hasResults && !busy && !submitted && !error && (
        <section className="search-start" aria-label={uiText("Search guidance")}>
          <div className="search-start-intro">
            <span className="search-start-icon"><Search size={19} /></span>
            <div>
              <strong>{uiText("Search your photo library")}</strong>
              <p>{uiText("Describe a scene or use names, dates, tags, and text. Your library stays on this device.")}</p>
            </div>
          </div>
          <div className="search-start-modes">
            <div>
              <Sparkles size={15} />
              <span>
                <strong>{uiText("AI search")}</strong>
                <small>{uiText("Finds ideas and scenes after local indexing is ready.")}</small>
              </span>
            </div>
            <div>
              <Search size={15} />
              <span>
                <strong>{uiText("Keyword search")}</strong>
                <small>{uiText("Matches library details immediately.")}</small>
              </span>
            </div>
          </div>
        </section>
      )}

      {!hasResults && !busy && recentSearches.length > 0 && (
        <section className="search-recents" aria-label={uiText("Recent searches")}>
          <header>
            <span><Clock3 size={14} /><strong>{uiText("Recent searches")}</strong></span>
            <button
              type="button"
              onClick={() => {
                setRecentSearches([]);
                writeRecentSearches([]);
              }}
            >
              {uiText("Clear")}
            </button>
          </header>
          <div>
            {recentSearches.map((recent) => (
              <button
                key={recent.toLocaleLowerCase()}
                type="button"
                className="search-recent-chip"
                onClick={() => {
                  setQuery(recent);
                  void runSearch(recent);
                }}
              >
                <Clock3 size={13} />
                <span>{recent}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!hasResults && !busy && (
        <div className="search-suggestions">
          <p className="search-suggestions-title">{submitted ? uiText("Try another search") : uiText("Try searching for")}</p>
          <div className="search-suggestion-chips">
            {SUGGESTION_SEEDS.map((seed) => (
              <button
                key={seed}
                type="button"
                className="search-suggestion-chip"
                onClick={() => {
                  setQuery(seed);
                  void runSearch(seed);
                }}
              >
                {seed}
              </button>
            ))}
          </div>
        </div>
      )}

      {semanticResult && (semanticResult.items?.length || semanticResult.results.length) > 0 && (
        <section className="search-results content-crossfade" aria-label={uiText("Semantic search results")}>
          <header className="search-results-head">
            <strong>{uiText("Best matches")}</strong>
            <span>{semanticResult.scored} {uiText("ranked")}</span>
          </header>
          <div className="search-results-grid reveal-stagger">
            {(semanticResult.items && semanticResult.items.length
              ? semanticResult.items
              : semanticResult.results.map((r) => ({ ...r }))
            ).map((item, index) => {
              const pct = semanticBest > 0 ? Math.max(1, Math.round((item.score / semanticBest) * 100)) : 0;
              const semanticItem = item as SemanticSearchPhotoItem;
              const url = semanticItem.previewUrl || "";
              const isVideoSegment = semanticItem.resultKind === "videoSegment";
              const timestampLabel = isVideoSegment ? formatVideoTimestamp(semanticItem.timestampMs) : "";
              return (
                <button
                  key={semanticItem.segmentId || semanticItem.sourcePath}
                  type="button"
                  className="search-result-card"
                  style={revealDelayStyle(index)}
                  onClick={() => openPhotoResult(semanticItem.sourcePath, basename(semanticItem.sourcePath), semanticItem)}
                  title={`${uiText("Open in Library")}: ${basename(semanticItem.sourcePath)} · ${pct}%${timestampLabel ? ` · ${timestampLabel}` : ""}`}
                  aria-label={`${uiText("Open in Library")}: ${basename(semanticItem.sourcePath)}, ${pct}% ${uiText("match")}${timestampLabel ? `, ${uiText("video moment")} ${timestampLabel}` : ""}`}
                >
                  <span className={`search-result-thumb${url ? "" : " placeholder"}`}>
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : isVideoSegment ? <Video size={20} /> : <ImageIcon size={20} />}
                  </span>
                  <span className="search-result-name">{basename(semanticItem.sourcePath)}</span>
                  {timestampLabel && <span className="search-result-moment"><Video size={12} />{timestampLabel}</span>}
                  <span className="search-result-score">{pct}%</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {textResult?.groups.map((group) => (
        <section key={group.id} className="search-results content-crossfade" aria-label={group.label}>
          <header className="search-results-head">
            <strong>{group.label}</strong>
            <span>{group.total}</span>
          </header>
          <div className="search-results-grid reveal-stagger">
            {group.items.map((item, index) => {
              const url = item.previewUrl || item.coverPreviewUrl || "";
              const isAudioSegment = item.resultKind === "audioSegment";
              const timestampLabel = isAudioSegment ? formatVideoTimestamp(item.timestampMs) : "";
              return (
                <button
                  key={item.id}
                  type="button"
                  className="search-result-card"
                  style={revealDelayStyle(index)}
                  onClick={() => {
                    if (onOpenResult) onOpenResult(item);
                    else if (item.sourcePath) reveal(item.sourcePath);
                  }}
                  title={`${item.title}${timestampLabel ? ` · ${timestampLabel}` : ""}`}
                >
                  <span className="search-result-thumb">
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : isAudioSegment ? <AudioLines size={20} /> : <ImageIcon size={20} />}
                  </span>
                  <span className="search-result-name">{item.title || (item.sourcePath ? basename(item.sourcePath) : item.id)}</span>
                  {timestampLabel && <span className="search-result-moment"><AudioLines size={12} />{timestampLabel}</span>}
                  {item.sourcePath && <ExternalLink size={13} className="search-result-open" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
