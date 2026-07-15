/**
 * The semantic-search controller: load CLIP, index the library on-device, and query it.
 *
 * State machine: idle → loading (download+init CLIP) → indexing (embed each photo) → ready.
 * Once ready, `search(query)` returns the matching photos' external_ids in relevance order, and
 * the grid filters to them. All on-device, offline, no Apple Intelligence — the differentiator.
 */
import { useCallback, useRef, useState } from 'react';
import { Asset } from 'expo-media-library';
import { loadClip, embedImage, embedText } from './semantic';
import {
  assetsForEmbedding,
  putClipEmbedding,
  clipEmbeddingCount,
  searchByEmbedding,
  similarByExternalId,
} from './replica';

export type SearchStatus = 'idle' | 'loading' | 'indexing' | 'ready' | 'error';

export interface SemanticSearch {
  status: SearchStatus;
  progress: number; // 0..1 during load/index
  indexed: number;
  total: number;
  error: string | null;
  results: string[] | null; // external_ids in relevance order, or null when not searching
  lastQuery: string;
  similar: boolean; // true when results came from "find similar" rather than a text query
  searchError: string | null; // a query/find-similar failure (distinct from the index-build `error`)
  enable: () => Promise<void>;
  search: (query: string) => Promise<void>;
  findSimilar: (externalId: string) => void;
  clear: () => void;
}

/**
 * Resolve a CLIP-loadable file:// URI for a PHAsset id. executorch's image reader accepts file
 * paths / URLs / base64, but NOT iOS `ph://` URIs, so we use getInfo(), which on iOS exports the
 * asset to a concrete file:// path (getUri() only returns the ph:// localIdentifier).
 */
async function loadableUri(externalId: string): Promise<string> {
  const asset = new Asset(externalId);
  try {
    const info = await asset.getInfo();
    if (info?.uri && !info.uri.startsWith('ph://')) return info.uri;
  } catch {
    /* fall through */
  }
  return asset.getUri();
}

export function useSemanticSearch(): SemanticSearch {
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<string[] | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [similar, setSimilar] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const busy = useRef(false);
  // Monotonic token so a slow in-flight text search can't clobber a newer search / findSimilar /
  // clear that the user triggered while it was awaiting the CLIP text encoder.
  const reqId = useRef(0);

  const enable = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      // 1. Download + load the CLIP image + text encoders.
      setStatus('loading');
      await loadClip((p) => setProgress(p.stage === 'image' ? p.progress * 0.5 : 0.5 + p.progress * 0.5));

      // 2. Embed every library photo on-device and store in the sqlite-vec replica table. Each image
      //    is transcoded to JPEG first (semantic.ts::toDecodableJpeg), so HEIC — the bulk of a real
      //    iPhone library — now indexes too. The per-image try/catch stays as a defensive guard: a
      //    single unreadable/corrupt asset must never abort the whole index.
      setStatus('indexing');
      const already = clipEmbeddingCount(); // embeddings persist across launches (idempotent)
      const targets = assetsForEmbedding(); // only rows not yet embedded
      setTotal(already + targets.length);
      setIndexed(already);
      let ok = 0;
      let skipped = 0;
      for (let i = 0; i < targets.length; i++) {
        try {
          const uri = await loadableUri(targets[i].external_id);
          const emb = await embedImage(uri);
          putClipEmbedding(targets[i].rowid, emb);
          ok++;
        } catch {
          skipped++;
        }
        setIndexed(already + i + 1);
        setProgress(targets.length === 0 ? 1 : (i + 1) / targets.length);
      }
      // Success if the library already has embeddings from a prior run, or we added some now. Only a
      // truly empty index (nothing persisted AND nothing embeddable this run) is a real failure.
      if (already + ok === 0) throw new Error(`no images could be embedded (${skipped} skipped)`);
      setStatus('ready');
    } catch (e) {
      setError(String(e));
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }, []);

  const search = useCallback(async (query: string) => {
    const my = ++reqId.current;
    const q = query.trim();
    setSimilar(false);
    setLastQuery(q);
    setSearchError(null);
    if (!q) {
      setResults(null);
      return;
    }
    try {
      const emb = await embedText(q);
      if (my !== reqId.current) return; // superseded by a newer search/findSimilar/clear
      setResults(searchByEmbedding(emb, 60));
    } catch (e) {
      if (my !== reqId.current) return;
      setSearchError(String(e)); // surfaced in the ready-state UI
      setResults(null); // don't leave stale results mislabeled with the new query
    }
  }, []);

  const findSimilar = useCallback((externalId: string) => {
    reqId.current++; // invalidate any in-flight text search
    setSimilar(true);
    setLastQuery('');
    setSearchError(null);
    try {
      setResults(similarByExternalId(externalId, 60));
    } catch (e) {
      setSearchError(String(e));
      setResults(null);
    }
  }, []);

  const clear = useCallback(() => {
    reqId.current++; // invalidate any in-flight text search
    setResults(null);
    setLastQuery('');
    setSimilar(false);
    setSearchError(null);
  }, []);

  return {
    status,
    progress,
    indexed,
    total,
    error,
    results,
    lastQuery,
    similar,
    searchError,
    enable,
    search,
    findSimilar,
    clear,
  };
}
