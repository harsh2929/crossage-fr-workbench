// Unified Search destination (Phase 1). Combines literal/facet search
// (search_photo_library) with on-device semantic ranking (semantic_search_photos),
// homing the previously-orphaned AI search command into a first-class tab.
import { useState } from "react";
import { AlertTriangle, ExternalLink, ImageIcon, Loader2, Search, Sparkles, X } from "lucide-react";
import type { TranslationKey } from "../i18n";
import type { PhotoLibrarySearchResult, SemanticSearchPhotosValue } from "../types";
import { revealDelayStyle } from "../lib/revealStagger";

interface SearchViewProps {
  searchPhotoLibrary: (params: Record<string, unknown>) => Promise<PhotoLibrarySearchResult>;
  semanticSearchPhotos: (params: Record<string, unknown>) => Promise<SemanticSearchPhotosValue | null>;
  t: (key: TranslationKey) => string;
  uiText: (source: string) => string;
}

const SUGGESTION_SEEDS = ["beach", "sunset", "dogs", "birthday", "documents", "mountains", "food", "screenshots"];

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function reveal(path: string) {
  try {
    void window.crossAge?.revealPath?.(path)?.catch?.(() => undefined);
  } catch {
    /* reveal is best-effort */
  }
}

export function SearchView({ searchPhotoLibrary, semanticSearchPhotos, t, uiText }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [aiMode, setAiMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [textResult, setTextResult] = useState<PhotoLibrarySearchResult | null>(null);
  const [semanticResult, setSemanticResult] = useState<SemanticSearchPhotosValue | null>(null);
  const [submitted, setSubmitted] = useState("");
  // Distinguishes a true failure (announce assertively, AlertTriangle) from a
  // benign empty result (announce politely, neutral icon).
  const [errorIsFailure, setErrorIsFailure] = useState(false);

  async function runSearch(raw: string) {
    const value = raw.trim();
    if (value.length < 2) {
      setError(uiText("Type at least 2 characters to search."));
      setErrorIsFailure(false);
      return;
    }
    setBusy(true);
    setError("");
    setErrorIsFailure(false);
    setSubmitted(value);
    try {
      if (aiMode) {
        const result = await semanticSearchPhotos({ query: value, limit: 60 });
        setSemanticResult(result);
        setTextResult(null);
        if (result && !result.available) {
          setError(result.reason || uiText("On-device AI search is not installed."));
          setErrorIsFailure(true);
        } else if (result && result.results.length === 0) {
          setError(uiText("No semantic matches found."));
        }
      } else {
        const result = await searchPhotoLibrary({ query: value, limit: 24, suggestionLimit: 24 });
        setTextResult(result);
        setSemanticResult(null);
        if (result.total === 0) setError(uiText("No matches found."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorIsFailure(true);
      setTextResult(null);
      setSemanticResult(null);
    } finally {
      setBusy(false);
    }
  }

  const semanticBest = semanticResult?.results[0]?.score || 0;
  const hasResults = Boolean(textResult || (semanticResult && semanticResult.results.length > 0));

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
          className="search-hero-input"
          type="search"
          autoFocus
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
              setQuery("");
              setTextResult(null);
              setSemanticResult(null);
              setError("");
              setSubmitted("");
            }}
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          className={`search-ai-toggle${aiMode ? " active" : ""}`}
          aria-pressed={aiMode}
          onClick={() => setAiMode((on) => !on)}
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
        <span className="search-mode-help">{aiMode ? uiText("Finds photos by meaning, on your device.") : uiText("Matches names, dates, tags, and text.")}</span>
      </div>

      {busy && <div className="search-status" role="status" aria-live="polite"><Loader2 size={15} className="spin" /><span>{uiText("Searching")} “{submitted}”…</span></div>}

      {error && !busy && (
        <div className="search-status" role={errorIsFailure ? "alert" : "status"}>
          {errorIsFailure ? <AlertTriangle size={15} /> : <Search size={15} />}
          <span>{error}</span>
        </div>
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
              const url = "previewUrl" in item ? (item as { previewUrl?: string }).previewUrl || "" : "";
              return (
                <button
                  key={item.sourcePath}
                  type="button"
                  className="search-result-card"
                  style={revealDelayStyle(index)}
                  onClick={() => reveal(item.sourcePath)}
                  title={`${basename(item.sourcePath)} · ${pct}%`}
                  aria-label={`${basename(item.sourcePath)}, ${pct}% ${uiText("match")}`}
                >
                  <span className={`search-result-thumb${url ? "" : " placeholder"}`}>
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={20} />}
                  </span>
                  <span className="search-result-name">{basename(item.sourcePath)}</span>
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
              return (
                <button
                  key={item.id}
                  type="button"
                  className="search-result-card"
                  style={revealDelayStyle(index)}
                  onClick={() => item.sourcePath && reveal(item.sourcePath)}
                  title={item.title}
                >
                  <span className="search-result-thumb">
                    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={20} />}
                  </span>
                  <span className="search-result-name">{item.title || (item.sourcePath ? basename(item.sourcePath) : item.id)}</span>
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
