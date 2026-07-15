import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Grid2X2,
  Image as ImageIcon,
  ImageOff,
  Images,
  Library,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Tags,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { mobileDirection, mobileLocale, mobileText, type MobileTextKey } from "./i18n";
import "./styles.css";

type Tab = "library" | "search" | "session";
type SearchMode = "lexical" | "hybrid" | "semantic";
type BootState = "loading" | "pairing" | "ready" | "disconnected" | "error";

interface ApiErrorPayload {
  code?: string;
  message?: string;
}

interface Envelope<T> {
  ok: boolean;
  data: T;
  page?: {
    offset?: number;
    returned?: number;
    total?: number;
    hasMore?: boolean;
  } | null;
  warnings?: string[];
  error?: ApiErrorPayload;
}

interface MobileDevice {
  accountId: string;
  label: string;
  readOnly: true;
  allowPreviews: boolean;
  expiresAt: number | null;
  expiresInSeconds: number;
}

interface SessionData {
  device: MobileDevice;
  platformVersion: string;
}

interface Collection {
  id: string;
  kind: string;
  name: string;
  count: number | null;
}

interface LibraryData {
  assetCount: number;
  albumCount: number;
  keywordCount: number;
  duplicateGroupCount: number;
  collections: Collection[];
}

interface Asset {
  assetId: string;
  title: string;
  mediaKind: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  captureDate?: string;
  missing?: boolean;
  metadata?: Record<string, unknown>;
  matchReasons?: string[];
}

interface SearchData {
  items: Asset[];
  mode: SearchMode;
  query: string;
}

interface IntelligenceItem {
  assetId?: string;
  intelligence?: Record<string, unknown>;
  availability?: Record<string, string>;
}

class MobileApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  let payload: Envelope<T> | null = null;
  try {
    payload = await response.json() as Envelope<T>;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    throw new MobileApiError(
      response.status,
      String(payload?.error?.code || "request_failed"),
      String(payload?.error?.message || `Request failed (${response.status}).`),
    );
  }
  return payload;
}

function pairingCodeFromFragment() {
  const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const code = new URLSearchParams(fragment).get("pair") || "";
  if (fragment) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return code;
}

function loopbackOrigin() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function formatCount(locale: string, value: number | null | undefined) {
  return new Intl.NumberFormat(locale).format(Math.max(0, Number(value || 0)));
}

function formatDate(locale: string, value: string | number | null | undefined) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: typeof value === "number" ? "short" : undefined }).format(date);
}

function safeDisplayText(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value).trim().slice(0, 500);
  if (value && typeof value === "object") {
    const wrapped = value as Record<string, unknown>;
    if (wrapped._type === "untrusted_ingested_text" && typeof wrapped.value === "string") {
      const open = "⟪UNTRUSTED⟫";
      const close = "⟪/UNTRUSTED⟫";
      const bounded = wrapped.value.startsWith(open) && wrapped.value.endsWith(close)
        ? wrapped.value.slice(open.length, -close.length)
        : wrapped.value;
      return bounded.trim().slice(0, 500);
    }
  }
  return fallback;
}

function normalizeAsset(value: Asset): Asset {
  return {
    ...value,
    assetId: safeDisplayText(value.assetId),
    title: safeDisplayText(value.title, "Image"),
    mediaKind: safeDisplayText(value.mediaKind, "image"),
    mimeType: safeDisplayText(value.mimeType),
    captureDate: safeDisplayText(value.captureDate),
  };
}

function labelList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const row of value) {
    const direct = safeDisplayText(row);
    if (direct) labels.push(direct);
    else if (row && typeof row === "object") {
      const item = row as Record<string, unknown>;
      const candidate = safeDisplayText(item.label || item.name || item.text || item.displayName);
      if (candidate) labels.push(candidate);
    }
    if (labels.length >= limit) break;
  }
  return labels;
}

function LoadingScreen({ state, message }: { state: BootState; message?: string }) {
  const locale = mobileLocale();
  const t = (key: MobileTextKey) => mobileText(locale, key);
  const disconnected = state === "disconnected";
  const Icon = disconnected ? WifiOff : state === "error" ? LockKeyhole : ShieldCheck;
  return (
    <main className="mobile-gate" aria-live="polite">
      <img src="/mobile/icon.png" alt="" width="88" height="88" />
      <h1>Vintrace</h1>
      <Icon size={24} aria-hidden="true" />
      <strong>{state === "pairing" ? t("pairing") : state === "loading" ? t("loading") : disconnected ? t("disconnected") : t("pairingFailed")}</strong>
      <p>{message || (disconnected ? t("disconnectedDetail") : "")}</p>
      {(state === "loading" || state === "pairing") && <LoaderCircle className="spin" size={22} aria-hidden="true" />}
    </main>
  );
}

function PreviewImage({
  asset,
  allowPreviews,
  dimension = 640,
  onUnauthorized,
}: {
  asset: Asset;
  allowPreviews: boolean;
  dimension?: number;
  onUnauthorized(): void;
}) {
  const locale = mobileLocale();
  const t = (key: MobileTextKey) => mobileText(locale, key);
  const holder = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState("");
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "180px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!allowPreviews || !visible || !asset.assetId) return;
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`/v1/assets/${encodeURIComponent(asset.assetId)}/preview?maxDimension=${dimension}&maxBytes=786432`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error("preview unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      setSrc(objectUrl);
    }).catch((error) => {
      if (error?.name !== "AbortError") setFailed(true);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [allowPreviews, asset.assetId, dimension, onUnauthorized, visible]);

  return (
    <div className="asset-preview" ref={holder}>
      {src ? <img src={src} alt="" /> : (
        <span className={failed ? "preview-failed" : "preview-loading"}>
          {failed || !allowPreviews ? <ImageOff size={24} /> : <ImageIcon size={24} />}
          <small>{!allowPreviews ? t("metadataOnly") : failed ? t("previewUnavailable") : ""}</small>
        </span>
      )}
      {asset.mediaKind === "video" && <em>{t("video")}</em>}
    </div>
  );
}

function AssetGrid({
  assets,
  allowPreviews,
  onSelect,
  onUnauthorized,
}: {
  assets: Asset[];
  allowPreviews: boolean;
  onSelect(asset: Asset): void;
  onUnauthorized(): void;
}) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => (
        <button className="asset-card" key={asset.assetId} onClick={() => onSelect(asset)} type="button">
          <PreviewImage asset={asset} allowPreviews={allowPreviews} onUnauthorized={onUnauthorized} />
          <span>
            <strong title={asset.title}>{asset.title}</strong>
            <small>{asset.captureDate ? formatDate(mobileLocale(), asset.captureDate) : asset.mediaKind}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function EmptyResults() {
  const locale = mobileLocale();
  return (
    <div className="empty-results">
      <ImageOff size={30} />
      <strong>{mobileText(locale, "noResults")}</strong>
      <p>{mobileText(locale, "noResultsDetail")}</p>
    </div>
  );
}

function AssetDetails({
  asset,
  analysis,
  loading,
  allowPreviews,
  onClose,
  onUnauthorized,
}: {
  asset: Asset;
  analysis: IntelligenceItem | null;
  loading: boolean;
  allowPreviews: boolean;
  onClose(): void;
  onUnauthorized(): void;
}) {
  const locale = mobileLocale();
  const t = (key: MobileTextKey) => mobileText(locale, key);
  const intelligence = analysis?.intelligence || {};
  const objectValue = intelligence.objects as Record<string, unknown> | undefined;
  const textValue = intelligence.text as Record<string, unknown> | undefined;
  const peopleValue = intelligence.people as Record<string, unknown> | unknown[] | undefined;
  const objects = labelList(objectValue?.tags);
  const textBlocks = labelList(textValue?.blocks, 5);
  const people = Array.isArray(peopleValue) ? labelList(peopleValue) : labelList(peopleValue?.items);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-sheet" role="dialog" aria-modal="true" aria-labelledby="asset-detail-title">
        <header>
          <div><span>{t("details")}</span><h2 id="asset-detail-title">{asset.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}><X size={20} /></button>
        </header>
        <PreviewImage asset={asset} allowPreviews={allowPreviews} dimension={1280} onUnauthorized={onUnauthorized} />
        <dl className="detail-facts">
          <div><dt><CalendarDays size={16} /> {t("captured")}</dt><dd>{formatDate(locale, asset.captureDate)}</dd></div>
          <div><dt><Grid2X2 size={16} /> {t("dimensions")}</dt><dd>{asset.width && asset.height ? `${asset.width} x ${asset.height}` : "-"}</dd></div>
          <div><dt><ImageIcon size={16} /> {asset.mediaKind === "video" ? t("video") : t("image")}</dt><dd>{asset.mimeType || "-"}</dd></div>
        </dl>
        {loading && <div className="analysis-loading"><LoaderCircle className="spin" size={18} /> {t("loading")}</div>}
        {!loading && (people.length > 0 || objects.length > 0 || textBlocks.length > 0) && (
          <div className="intelligence-sections">
            {people.length > 0 && <section><h3><UserRound size={17} /> {t("people")}</h3><div className="tag-list">{people.map((value) => <span key={value}>{value}</span>)}</div></section>}
            {objects.length > 0 && <section><h3><Tags size={17} /> {t("objects")}</h3><div className="tag-list">{objects.map((value) => <span key={value}>{value}</span>)}</div></section>}
            {textBlocks.length > 0 && <section><h3><Search size={17} /> {t("text")}</h3><div className="text-blocks">{textBlocks.map((value, index) => <p key={`${value}-${index}`}>{value}</p>)}</div></section>}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const locale = useMemo(mobileLocale, []);
  const t = useCallback((key: MobileTextKey) => mobileText(locale, key), [locale]);
  const [boot, setBoot] = useState<BootState>("loading");
  const [bootMessage, setBootMessage] = useState("");
  const [session, setSession] = useState<SessionData | null>(null);
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [tab, setTab] = useState<Tab>("library");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [searchPage, setSearchPage] = useState<Envelope<SearchData>["page"]>(null);
  const [searching, setSearching] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [analysis, setAnalysis] = useState<IntelligenceItem | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const disconnect = useCallback(() => {
    setSession(null);
    setLibrary(null);
    setAssets([]);
    setBoot("disconnected");
  }, []);

  const handleFailure = useCallback((error: unknown, fallback: string) => {
    if (error instanceof MobileApiError && error.status === 401) {
      disconnect();
      return;
    }
    setLibraryError(!navigator.onLine ? t("offline") : error instanceof Error ? error.message : fallback);
  }, [disconnect, t]);

  const runSearch = useCallback(async (
    searchQuery: string,
    offset = 0,
    append = false,
    requestedMode: SearchMode = mode,
  ) => {
    setSearching(true);
    setLibraryError("");
    try {
      const effectiveMode = searchQuery.trim() ? requestedMode : "lexical";
      const result = await requestJson<SearchData>("/v1/search", {
        method: "POST",
        body: JSON.stringify({
          query: searchQuery.trim().slice(0, 500),
          mode: effectiveMode,
          scope: "all",
          sort: "newest",
          offset,
          limit: 24,
        }),
      });
      const nextAssets = (result.data.items || []).map(normalizeAsset);
      setAssets((current) => append ? [...current, ...nextAssets] : nextAssets);
      setSearchPage(result.page || null);
    } catch (error) {
      handleFailure(error, t("libraryUnavailable"));
    } finally {
      setSearching(false);
    }
  }, [handleFailure, mode, t]);

  const refreshLibrary = useCallback(async () => {
    setLibraryError("");
    try {
      const result = await requestJson<LibraryData>("/v1/library?includeHealth=false");
      setLibrary({
        ...result.data,
        collections: (result.data.collections || []).map((collection) => ({
          ...collection,
          id: safeDisplayText(collection.id),
          kind: safeDisplayText(collection.kind),
          name: safeDisplayText(collection.name, "Collection"),
        })),
      });
      await runSearch("", 0, false, "lexical");
    } catch (error) {
      handleFailure(error, t("libraryUnavailable"));
    }
  }, [handleFailure, runSearch, t]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const pairingCode = pairingCodeFromFragment();
      if (pairingCode) {
        if (!window.isSecureContext && !loopbackOrigin()) {
          setBoot("error");
          setBootMessage(t("secureOriginRequired"));
          return;
        }
        setBoot("pairing");
        try {
          await requestJson<{ device: MobileDevice }>("/v1/mobile/pair", {
            method: "POST",
            body: JSON.stringify({ pairingCode }),
          });
        } catch (error) {
          if (!cancelled) {
            setBoot("error");
            setBootMessage(error instanceof Error ? error.message : t("pairingFailed"));
          }
          return;
        }
      }
      try {
        const result = await requestJson<SessionData>("/v1/mobile/session");
        if (!cancelled) {
          setSession(result.data);
          setBoot("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setBoot(error instanceof MobileApiError && [401, 403].includes(error.status) ? "disconnected" : "error");
          setBootMessage(error instanceof Error ? error.message : "");
        }
      }
    };
    void start();
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    if (boot === "ready" && session) void refreshLibrary();
  }, [boot, refreshLibrary, session]);

  useEffect(() => {
    if (!selected) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setAnalysisLoading(true);
    requestJson<{ items: IntelligenceItem[] }>("/v1/assets/analyze", {
      method: "POST",
      body: JSON.stringify({
        assetIds: [selected.assetId],
        capabilities: ["metadata", "text", "objects", "quality", "people", "albums"],
      }),
    }).then((result) => {
      if (!cancelled) setAnalysis(result.data.items?.[0] || null);
    }).catch((error) => {
      if (!cancelled) handleFailure(error, t("libraryUnavailable"));
    }).finally(() => {
      if (!cancelled) setAnalysisLoading(false);
    });
    return () => { cancelled = true; };
  }, [handleFailure, selected, t]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = mobileDirection(locale);
  }, [locale]);

  if (boot !== "ready" || !session) return <LoadingScreen state={boot} message={bootMessage} />;

  const allowPreviews = session.device.allowPreviews;
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setTab("search");
    void runSearch(query, 0, false, mode);
  };

  const logout = async () => {
    try {
      await fetch("/v1/mobile/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    } finally {
      disconnect();
    }
  };

  const collections = library?.collections?.slice(0, 12) || [];
  const navigation: Array<{ id: Tab; label: MobileTextKey; icon: typeof Library }> = [
    { id: "library", label: "library", icon: Library },
    { id: "search", label: "search", icon: Search },
    { id: "session", label: "session", icon: Smartphone },
  ];

  return (
    <div className="mobile-app">
      <header className="app-header">
        <button className="brand-button" onClick={() => setTab("library")} type="button" aria-label="Vintrace">
          <img src="/mobile/icon.png" alt="" width="40" height="40" />
          <span><strong>Vintrace</strong><small><ShieldCheck size={13} /> {t("readOnly")}</small></span>
        </button>
        <button className="icon-button header-refresh" onClick={() => void refreshLibrary()} disabled={searching} aria-label={t("refresh")} title={t("refresh")}>
          <RefreshCw className={searching ? "spin" : ""} size={19} />
        </button>
      </header>

      <main className="app-content">
        {libraryError && <div className="inline-error" role="alert"><WifiOff size={17} /><span>{libraryError}</span></div>}

        {tab === "library" && (
          <div className="view-stack">
            <section className="overview-band" aria-label={t("library")}>
              <div><strong>{formatCount(locale, library?.assetCount)}</strong><span>{t("photos")}</span></div>
              <div><strong>{formatCount(locale, library?.albumCount)}</strong><span>{t("albums")}</span></div>
              <div><strong>{formatCount(locale, library?.keywordCount)}</strong><span>{t("keywords")}</span></div>
              <div><strong>{formatCount(locale, library?.duplicateGroupCount)}</strong><span>{t("duplicates")}</span></div>
            </section>

            <section className="content-section">
              <div className="section-heading"><div><span>{t("library")}</span><h1>{t("recentPhotos")}</h1></div></div>
              {assets.length ? (
                <AssetGrid assets={assets.slice(0, 12)} allowPreviews={allowPreviews} onSelect={setSelected} onUnauthorized={disconnect} />
              ) : searching ? <div className="grid-loading"><LoaderCircle className="spin" size={22} /></div> : <EmptyResults />}
            </section>

            {collections.length > 0 && (
              <section className="content-section collection-section">
                <div className="section-heading"><div><span>{t("library")}</span><h2>{t("collections")}</h2></div></div>
                <div className="collection-list">
                  {collections.map((collection) => (
                    <div key={collection.id}>
                      <span className="collection-icon"><Images size={18} /></span>
                      <span><strong>{collection.name}</strong><small>{collection.kind.replaceAll("-", " ")}</small></span>
                      {collection.count !== null && <em>{formatCount(locale, collection.count)}</em>}
                      <ChevronRight size={17} aria-hidden="true" />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "search" && (
          <div className="view-stack search-view">
            <form className="search-form" onSubmit={submitSearch}>
              <label htmlFor="mobile-search"><Search size={18} /><span className="sr-only">{t("search")}</span></label>
              <input id="mobile-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} maxLength={500} enterKeyHint="search" autoComplete="off" />
              <button className="search-submit" type="submit" disabled={searching} aria-label={t("searchAction")} title={t("searchAction")}>
                {searching ? <LoaderCircle className="spin" size={19} /> : <Search size={19} />}
              </button>
            </form>
            <div className="mode-control" aria-label={t("search")}>
              {(["hybrid", "lexical", "semantic"] as SearchMode[]).map((value) => (
                <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)} type="button">{value}</button>
              ))}
            </div>
            <section className="content-section search-results">
              <div className="section-heading">
                <div><span>{t("search")}</span><h1>{query.trim() || t("allPhotos")}</h1></div>
                <small>{formatCount(locale, searchPage?.total)} {t("photos").toLowerCase()}</small>
              </div>
              {assets.length ? (
                <>
                  <AssetGrid assets={assets} allowPreviews={allowPreviews} onSelect={setSelected} onUnauthorized={disconnect} />
                  {searchPage?.hasMore && (
                    <button className="load-more" type="button" onClick={() => void runSearch(query, assets.length, true, mode)} disabled={searching}>
                      {searching ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} {t("loadMore")}
                    </button>
                  )}
                </>
              ) : searching ? <div className="grid-loading"><LoaderCircle className="spin" size={22} /></div> : <EmptyResults />}
            </section>
          </div>
        )}

        {tab === "session" && (
          <div className="view-stack session-view">
            <section className="session-identity">
              <span className="device-icon"><Smartphone size={30} /></span>
              <span><small>{t("pairedDevice")}</small><h1>{session.device.label}</h1><em><ShieldCheck size={15} /> {t("readOnly")}</em></span>
            </section>
            <section className="session-facts">
              <div><ImageIcon size={19} /><span><strong>{allowPreviews ? t("previewsOn") : t("previewsOff")}</strong><small>{allowPreviews ? t("safeMode") : t("metadataOnly")}</small></span></div>
              <div><Clock3 size={19} /><span><strong>{t("expires")}</strong><small>{formatDate(locale, session.device.expiresAt)}</small></span></div>
              <div><LockKeyhole size={19} /><span><strong>Vintrace {session.platformVersion}</strong><small>{session.device.accountId}</small></span></div>
            </section>
            <button className="disconnect-button" onClick={() => void logout()} type="button"><LogOut size={18} /> {t("disconnect")}</button>
          </div>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Vintrace">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} type="button" aria-current={tab === id ? "page" : undefined}>
            <Icon size={21} /><span>{t(label)}</span>
          </button>
        ))}
      </nav>

      {selected && (
        <AssetDetails
          asset={selected}
          analysis={analysis}
          loading={analysisLoading}
          allowPreviews={allowPreviews}
          onClose={() => setSelected(null)}
          onUnauthorized={disconnect}
        />
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Vintrace mobile root is missing.");
createRoot(root).render(<App />);
