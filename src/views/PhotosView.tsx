import { useCallback, useEffect, useRef, useState } from "react";
import { Images, ImageIcon, Video, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoFolder, PhotoFolderList, PhotoItem, PhotoItemsPage } from "../types";
import { hasMorePages, nextOffset } from "./photosPaging";

const PAGE_LIMIT = 100;
// Matches the backend per-call preview-generation cap (api_server clamps to 64).
const PREVIEW_BUDGET = 64;

export function PhotosView(props: {
  listPhotoFolders: () => Promise<PhotoFolderList>;
  listPhotoFolderItems: (params: Record<string, unknown>) => Promise<PhotoItemsPage>;
  busy: boolean;
}) {
  const { listPhotoFolders, listPhotoFolderItems } = props;
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [activeId, setActiveId] = useState<string>("all");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards against a slow page from a previously-selected folder overwriting the
  // newly-selected folder's results (fast rail clicks).
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // Hold the latest invoke wrappers in refs. The parent recreates these
  // functions on every render and re-renders about once a second (a clock), so
  // depending on their identity in effects would refetch every second and reset
  // the grid. Refs decouple the effects from prop identity: they fire only on
  // real state changes (mount, folder switch, scroll).
  const foldersFnRef = useRef(listPhotoFolders);
  foldersFnRef.current = listPhotoFolders;
  const itemsFnRef = useRef(listPhotoFolderItems);
  itemsFnRef.current = listPhotoFolderItems;

  // Load the folder rail once on mount.
  useEffect(() => {
    let alive = true;
    foldersFnRef.current()
      .then((res) => alive && setFolders(res.folders || []))
      .catch(() => alive && setFolders([]));
    return () => {
      alive = false;
    };
  }, []);

  // Stable across renders (reads the live wrapper via ref), so the paging
  // effects below fire only on real changes, never on prop-identity churn.
  const loadPage = useCallback(async (folderId: string, offset: number) => {
    setLoading(true);
    try {
      const page = await itemsFnRef.current({
        folderId,
        offset,
        limit: PAGE_LIMIT,
        previewBudget: PREVIEW_BUDGET,
      });
      if (activeIdRef.current !== folderId) return; // stale folder, drop
      setTotal(page.total);
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
    } catch {
      // A blocked/failed fetch degrades to an empty folder instead of spinning.
      if (activeIdRef.current === folderId && offset === 0) {
        setTotal(0);
        setItems([]);
      }
    } finally {
      if (activeIdRef.current === folderId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    setLightbox(null);
    loadPage(activeId, 0);
  }, [activeId, loadPage]);

  // Lazy paging: load the next page when the sentinel scrolls near the viewport.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading && hasMorePages({ loaded: items.length, total })) {
        loadPage(activeId, nextOffset({ loaded: items.length }));
      }
    });
    io.observe(node);
    return () => io.disconnect();
  }, [activeId, items.length, total, loading, loadPage]);

  // Keyboard navigation for the lightbox (Esc closes, arrows move).
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
      else if (event.key === "ArrowLeft") setLightbox((i) => Math.max(0, (i ?? 0) - 1));
      else if (event.key === "ArrowRight") setLightbox((i) => Math.min(items.length - 1, (i ?? 0) + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, items.length]);

  const active = folders.find((folder) => folder.id === activeId);
  const lightItem = lightbox !== null ? items[lightbox] : null;

  return (
    <section className="photos-page">
      <aside className="photos-rail" aria-label="Photo folders">
        <h2 className="photos-rail-title">
          <Images size={18} /> Photos
        </h2>
        <ul>
          {folders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                className={folder.id === activeId ? "active" : ""}
                onClick={() => setActiveId(folder.id)}
                aria-current={folder.id === activeId ? "true" : undefined}
              >
                <span className="photos-rail-cover">
                  {folder.coverPreviewUrl ? (
                    <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <ImageIcon size={16} />
                  )}
                </span>
                <span className="photos-rail-name" title={folder.name}>
                  {folder.name}
                </span>
                <span className="photos-rail-count">{folder.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="photos-gallery">
        <header className="photos-gallery-head">
          <strong>{active?.name ?? "All Photos"}</strong>
          <span>{total.toLocaleString()} photo{total === 1 ? "" : "s"}</span>
        </header>
        {total === 0 && !loading ? (
          <div className="empty">
            <ImageIcon size={24} />
            <strong>No photos here yet</strong>
            <span>Scan or watch a folder to fill your library.</span>
          </div>
        ) : (
          <div className="photos-grid">
            {items.map((item, index) => {
              const url = item.previewUrl || item.sourceUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="photo-tile"
                  onClick={() => setLightbox(index)}
                  aria-label={`Open photo ${index + 1}`}
                >
                  {url ? (
                    <img loading="lazy" decoding="async" src={url} alt="" />
                  ) : (
                    <span className="photo-tile-fallback">
                      {item.mediaKind === "video" ? <Video size={18} /> : <ImageIcon size={18} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div ref={sentinelRef} className="photos-sentinel" aria-hidden="true" />
        {loading && <p className="compact photos-loading">Loading…</p>}
      </div>

      {lightItem && (
        <div className="photos-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button
            type="button"
            className="photos-lightbox-close"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X size={22} />
          </button>
          <button
            type="button"
            className="photos-lightbox-nav prev"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox((i) => Math.max(0, (i ?? 0) - 1));
            }}
            aria-label="Previous photo"
            disabled={lightbox === 0}
          >
            <ChevronLeft size={28} />
          </button>
          {lightItem.previewUrl || lightItem.sourceUrl ? (
            <img
              className="photos-lightbox-image"
              src={lightItem.previewUrl || lightItem.sourceUrl}
              alt=""
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="photos-lightbox-fallback" onClick={(event) => event.stopPropagation()}>
              <ImageIcon size={48} />
            </div>
          )}
          <button
            type="button"
            className="photos-lightbox-nav next"
            onClick={(event) => {
              event.stopPropagation();
              setLightbox((i) => Math.min(items.length - 1, (i ?? 0) + 1));
            }}
            aria-label="Next photo"
            disabled={lightbox === items.length - 1}
          >
            <ChevronRight size={28} />
          </button>
        </div>
      )}
    </section>
  );
}
