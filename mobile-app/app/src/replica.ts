/**
 * The on-device catalog replica — the offline-first foundation.
 *
 * A SQLCipher-encrypted SQLite database (op-sqlite, JSI) holding the phone's view of the library:
 * the camera-roll assets keyed by a stable `asset_uid`, plus a `sqlite-vec` table ready to hold the
 * SigLIP embeddings the desktop will sync. The grid reads from HERE, not from PhotoKit each launch,
 * so the library renders instantly and works with no network — the whole point of offline-first.
 *
 * The schema is a deliberate subset of the desktop's 34-table portable allowlist
 * (docs/2026-07-14-mobile-architecture-and-spec.md §6): just enough to render a Photos-quality grid
 * and, next, search it. Vectors are stored as raw BLOBs (never JSON — the Ente 1 GB / 19 s trap).
 */
import { open, type DB } from '@op-engineering/op-sqlite';
import { MediaType, type AssetMetadata } from 'expo-media-library';

const DB_NAME = 'vintrace-replica.db';
// A dev key. In production this comes from the iOS Keychain / Android Keystore (spec §6.2);
// the point here is that the replica is SQLCipher-encrypted at rest, not plaintext.
const DEV_KEY = 'vintrace-replica-dev-key-v1';

// Semantic embedding dimension the desktop syncs (SigLIP2 → int8[512] per spec §3.1/§6).
export const EMBED_DIM = 512;
// CLIP ViT-B/32 output dimension for on-device semantic search.
export const CLIP_DIM = 512;

let db: DB | null = null;

/** Add a column if the table doesn't already have it (idempotent schema migration). */
function ensureColumn(conn: DB, table: string, col: string, decl: string): void {
  const { rows } = conn.executeSync(`PRAGMA table_info(${table})`);
  const has = (rows ?? []).some((r) => (r as { name: string }).name === col);
  if (!has) conn.executeSync(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

/** Open (and migrate) the encrypted replica. Idempotent. */
export function openReplica(): DB {
  if (db) return db;
  db = open({ name: DB_NAME, encryptionKey: DEV_KEY });

  db.executeSync('PRAGMA journal_mode = WAL');
  db.executeSync('PRAGMA synchronous = NORMAL');
  db.executeSync('PRAGMA foreign_keys = ON');
  // Keep temp tables (used by the ingest reconciliation below) in RAM, not spilled to an
  // unencrypted temp file next to the SQLCipher database.
  db.executeSync('PRAGMA temp_store = MEMORY');

  // The human-catalog subset. asset_uid is the canonical key (spec §4); external_id maps to the
  // phone's PHAsset localIdentifier so a synced desktop asset and its on-device original converge.
  db.executeSync(`
    CREATE TABLE IF NOT EXISTS assets (
      asset_uid     TEXT PRIMARY KEY,
      external_id   TEXT UNIQUE,
      filename      TEXT,
      width         INTEGER,
      height        INTEGER,
      created_at    INTEGER,
      modified_at   INTEGER,
      is_favorite   INTEGER NOT NULL DEFAULT 0,
      source        TEXT NOT NULL DEFAULT 'camera-roll',
      media_type    TEXT NOT NULL DEFAULT 'image',
      duration      INTEGER
    )
  `);
  // Migrate DBs created before media_type/duration/is_hidden existed (CREATE TABLE IF NOT EXISTS won't add columns).
  ensureColumn(db, 'assets', 'media_type', "TEXT NOT NULL DEFAULT 'image'");
  ensureColumn(db, 'assets', 'duration', 'INTEGER');
  // App-local "Hidden" flag (Apple Photos' Hidden album). PhotoKit gives third parties no access to the
  // system Hidden album, so this is our own: a hidden photo is filtered out of Library/Search/Albums
  // and shown only in our Hidden view. It never leaves the device and is never written to PhotoKit.
  ensureColumn(db, 'assets', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  // A materialized sort key + index so the timeline never does a full sort (spec §4.2 note).
  db.executeSync(`CREATE INDEX IF NOT EXISTS assets_timeline ON assets(created_at DESC, asset_uid)`);

  // sqlite-vec table for the SigLIP embeddings the desktop will sync. int8[512] ≈ 512 B/photo.
  // Present now so the search substrate is real; population comes with the sync tier.
  db.executeSync(`CREATE VIRTUAL TABLE IF NOT EXISTS asset_vectors USING vec0(embedding int8[${EMBED_DIM}])`);

  // CLIP embeddings computed on-device for semantic search. float[512], keyed by the asset's
  // implicit rowid so a KNN result maps straight back to a row in `assets`. L2-normalized vectors
  // in → L2 distance orders identically to cosine, which is what CLIP retrieval needs.
  db.executeSync(`CREATE VIRTUAL TABLE IF NOT EXISTS asset_clip USING vec0(embedding float[${CLIP_DIM}])`);

  // The paired desktop uplink (single row). No secret is stored — the session lives in the OS cookie
  // jar; this just remembers which desktop to reconnect to and its label/expiry for the UI.
  db.executeSync(`
    CREATE TABLE IF NOT EXISTS desktop_connection (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      base       TEXT NOT NULL,
      label      TEXT,
      expires_at INTEGER
    )
  `);

  // Tiny key/value store for durable UI preferences (e.g. which first-run coach cards were dismissed).
  db.executeSync(`CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT)`);

  // Recent semantic-search queries, most-recent-first via ts. Lets Search offer "recent" chips.
  db.executeSync(`CREATE TABLE IF NOT EXISTS search_history (query TEXT PRIMARY KEY, ts INTEGER NOT NULL)`);

  // App-local caption + star rating per photo, keyed by external_id (the PHAsset localIdentifier).
  // These live ONLY in our replica: PhotoKit blocks third-party apps from writing captions/ratings
  // back to the system library, so we never write these to PhotoKit — they are app-local metadata.
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS photo_meta (external_id TEXT PRIMARY KEY, caption TEXT, rating INTEGER)`,
  );

  // On-device OCR / Live-Text index: the text recognized inside each photo, keyed by external_id.
  // A row exists once a photo has been through OCR (even if it held no text — stored as '' — so the
  // indexer never revisits a text-free photo). Populated by the on-device ML Kit recognizer (opt-in,
  // gated behind the same enable as CLIP); searched by Search so "boarding pass", a receipt total, a
  // whiteboard note, a street sign etc. become findable — Apple Photos' Live Text search, on-device.
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS photo_text (external_id TEXT PRIMARY KEY, text TEXT, text_lc TEXT, indexed_at INTEGER)`,
  );
  // `text` holds the ORIGINAL-case recognized text (for display in the viewer); `text_lc` is its
  // Unicode-lowercase (for case-insensitive search — SQLite LIKE only folds ASCII). Migrate DBs that
  // predate the split.
  ensureColumn(db, 'photo_text', 'text_lc', 'TEXT');

  return db;
}

// --- UI preferences (durable key/value) -------------------------------------------------------

export function getPref(key: string): string | null {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT value FROM prefs WHERE key = ?', [key]);
  return (rows?.[0] as { value: string } | undefined)?.value ?? null;
}

export function setPref(key: string, value: string): void {
  const conn = openReplica();
  conn.executeSync(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/**
 * Delete every pref whose key starts with `prefix` (e.g. "memory." to reset all memory customizations),
 * returning how many were removed. The prefix is escaped so a literal % / _ can't turn into a wildcard.
 */
export function clearPrefsByPrefix(prefix: string): number {
  const conn = openReplica();
  const escaped = prefix.replace(/[\\%_]/g, (c) => '\\' + c);
  const res = conn.executeSync(`DELETE FROM prefs WHERE key LIKE ? ESCAPE '\\'`, [`${escaped}%`]);
  return Number((res as { rowsAffected?: number }).rowsAffected ?? 0);
}

// --- Recent search history --------------------------------------------------------------------

/** Record a query as the most-recent search (bumps its timestamp if seen before), keeping the newest 50. */
export function addSearchHistory(query: string): void {
  const q = query.trim();
  if (!q) return;
  const conn = openReplica();
  conn.executeSync(
    `INSERT INTO search_history (query, ts) VALUES (?, ?)
     ON CONFLICT(query) DO UPDATE SET ts = excluded.ts`,
    [q, Date.now()],
  );
  // Prune to the 50 most recent so the table can't grow unbounded.
  conn.executeSync(
    `DELETE FROM search_history WHERE query NOT IN (
       SELECT query FROM search_history ORDER BY ts DESC LIMIT 50
     )`,
  );
}

export function recentSearches(limit = 8): string[] {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT query FROM search_history ORDER BY ts DESC LIMIT ?', [limit]);
  return (rows ?? []).map((r) => (r as { query: string }).query);
}

export function clearSearchHistory(): void {
  const conn = openReplica();
  conn.executeSync('DELETE FROM search_history');
}

// --- Saved searches (durable, user-curated) ---------------------------------------------------
// Apple Photos lets you SAVE a search so it's one tap to re-run later. Unlike Recent (an automatic,
// pruned MRU of the last 50 queries), saved searches are a small hand-curated list the user manages
// explicitly (star to save, long-press a chip to remove). Backed by a JSON array in the prefs KV
// store — no schema migration, and the list is tiny (capped at 24), so a whole-array rewrite is fine.
const SAVED_SEARCH_KEY = 'saved.searches';

/** The user's saved search queries, newest-first. Tolerates a malformed/absent value → empty list. */
export function savedSearches(): string[] {
  try {
    const raw = getPref(SAVED_SEARCH_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Save a query to the TOP of the list (case-insensitively de-duplicated), keeping the newest 24. */
export function addSavedSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  const lc = q.toLowerCase();
  const next = [q, ...savedSearches().filter((s) => s.toLowerCase() !== lc)].slice(0, 24);
  setPref(SAVED_SEARCH_KEY, JSON.stringify(next));
}

/** Remove a saved query (case-insensitive match). No-op if it wasn't saved. */
export function removeSavedSearch(query: string): void {
  const lc = query.trim().toLowerCase();
  const next = savedSearches().filter((s) => s.toLowerCase() !== lc);
  setPref(SAVED_SEARCH_KEY, JSON.stringify(next));
}

/** True when this exact query (case-insensitive) is already saved — drives the star's filled state. */
export function isSearchSaved(query: string): boolean {
  const lc = query.trim().toLowerCase();
  if (!lc) return false;
  return savedSearches().some((s) => s.toLowerCase() === lc);
}

// --- App-local caption + star rating (per photo) ----------------------------------------------
// Keyed by external_id (the PHAsset localIdentifier). NOT written to PhotoKit — Photos blocks
// third-party caption/rating writes, so these are app-local only and stored in the replica.

export interface PhotoMeta {
  caption: string | null;
  rating: number;
}

/** The stored caption + rating for a photo, defaulting to {caption:null, rating:0} if unset. */
export function getPhotoMeta(externalId: string): PhotoMeta {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    'SELECT caption, rating FROM photo_meta WHERE external_id = ?',
    [externalId],
  );
  const row = rows?.[0] as { caption: string | null; rating: number | null } | undefined;
  return { caption: row?.caption ?? null, rating: Number(row?.rating ?? 0) };
}

/** Set (or, on empty string, clear) a photo's app-local caption without touching its rating. */
export function setCaption(externalId: string, caption: string): void {
  const conn = openReplica();
  const value = caption.trim() === '' ? null : caption;
  conn.executeSync(
    `INSERT INTO photo_meta (external_id, caption, rating) VALUES (?, ?, 0)
     ON CONFLICT(external_id) DO UPDATE SET caption = excluded.caption`,
    [externalId, value],
  );
}

/** Set a photo's app-local star rating (clamped 0..5; 0 clears) without touching its caption. */
export function setRating(externalId: string, rating: number): void {
  const conn = openReplica();
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  conn.executeSync(
    `INSERT INTO photo_meta (external_id, caption, rating) VALUES (?, NULL, ?)
     ON CONFLICT(external_id) DO UPDATE SET rating = excluded.rating`,
    [externalId, r],
  );
}

/**
 * external_ids of photos rated at or above `min` stars (default 1 = "any rating"). Powers the Library
 * "Rated" filter — a bulk membership set the grid intersects against, mirroring how screenshot-hiding
 * resolves a Set once and folds it into the gridKey.
 */
export function ratedExternalIds(min = 1): Set<string> {
  const conn = openReplica();
  const m = Math.max(1, Math.min(5, Math.round(min)));
  const { rows } = conn.executeSync('SELECT external_id FROM photo_meta WHERE rating >= ?', [m]);
  const out = new Set<string>();
  for (const r of rows ?? []) {
    const id = (r as { external_id?: string }).external_id;
    if (id) out.add(id);
  }
  return out;
}

/**
 * The app-local keyword index, scanned out of the prefs KV (keywords are stored per-photo under
 * `photo.keywords.<external_id>` as a JSON string array — PhotoKit blocks 3rd-party keyword writes).
 * Returns the distinct keyword LABELS (most-used first) plus a lowercased-keyword -> external_id-set
 * map, so Library can offer a "browse/filter by keyword" chip row. Case-insensitive: "Beach" and
 * "beach" fold together under the first-seen label.
 */
export function keywordIndex(): { keywords: string[]; byKeyword: Map<string, Set<string>> } {
  const conn = openReplica();
  const { rows } = conn.executeSync("SELECT key, value FROM prefs WHERE key LIKE 'photo.keywords.%'", []);
  const byKeyword = new Map<string, Set<string>>(); // lowercased keyword -> external_ids
  const labelFor = new Map<string, string>(); // lowercased -> first-seen display casing
  const PREFIX = 'photo.keywords.';
  for (const r of rows ?? []) {
    const row = r as { key?: string; value?: string };
    if (!row.key || !row.value || !row.key.startsWith(PREFIX)) continue;
    const externalId = row.key.slice(PREFIX.length);
    let list: unknown;
    try {
      list = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const kw of list) {
      if (typeof kw !== 'string') continue;
      const label = kw.trim();
      if (!label) continue;
      const lc = label.toLowerCase();
      if (!labelFor.has(lc)) labelFor.set(lc, label);
      let set = byKeyword.get(lc);
      if (!set) {
        set = new Set<string>();
        byKeyword.set(lc, set);
      }
      set.add(externalId);
    }
  }
  const keywords = [...byKeyword.keys()]
    .sort((a, b) => byKeyword.get(b)!.size - byKeyword.get(a)!.size || a.localeCompare(b))
    .map((lc) => labelFor.get(lc) as string);
  return { keywords, byKeyword };
}

/**
 * external_ids whose app-local CAPTION contains ALL query terms (case-insensitive), newest first —
 * for wiring the per-photo caption field into Search. Captions are app-local (PhotoKit blocks writes),
 * so this reads the replica's photo_meta.caption. Mirrors searchPhotoText's term-AND LIKE approach.
 */
export function searchCaptions(query: string, limit = 300): string[] {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  const conn = openReplica();
  const where = terms.map(() => `LOWER(m.caption) LIKE ? ESCAPE '\\'`).join(' AND ');
  const params = terms.map((t) => `%${likeEscape(t)}%`);
  const { rows } = conn.executeSync(
    `SELECT m.external_id FROM photo_meta m
     JOIN assets a ON a.external_id = m.external_id
     WHERE m.caption IS NOT NULL AND m.caption <> '' AND ${where}
     ORDER BY a.created_at DESC, a.asset_uid LIMIT ?`,
    [...params, limit],
  );
  const out: string[] = [];
  for (const r of rows ?? []) {
    const id = (r as { external_id?: string }).external_id;
    if (id) out.push(id);
  }
  return out;
}

export interface DesktopConnection {
  base: string;
  label: string | null;
  expires_at: number | null;
}

export function saveDesktopConnection(base: string, label: string, expiresAt: number): void {
  const conn = openReplica();
  conn.executeSync(
    `INSERT INTO desktop_connection (id, base, label, expires_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET base = excluded.base, label = excluded.label, expires_at = excluded.expires_at`,
    [base, label, expiresAt],
  );
}

export function loadDesktopConnection(): DesktopConnection | null {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT base, label, expires_at FROM desktop_connection WHERE id = 1');
  return (rows?.[0] as unknown as DesktopConnection | undefined) ?? null;
}

export function clearDesktopConnection(): void {
  const conn = openReplica();
  conn.executeSync('DELETE FROM desktop_connection WHERE id = 1');
}

/** A stable asset_uid derived from the phone's PHAsset id (deterministic, no crypto import needed). */
function assetUidForExternal(externalId: string): string {
  // FNV-1a 64-bit over the id → hex. Stable across launches; the desktop's UUIDv7 supersedes it
  // once sync assigns a canonical uid, mapped via external_id.
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < externalId.length; i++) {
    h ^= BigInt(externalId.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return 'ph_' + h.toString(16).padStart(16, '0');
}

/**
 * Ingest camera-roll metadata into the replica and reconcile it with the live library. Upserts every
 * incoming asset, then PRUNES any replica row whose external_id is no longer present (a photo deleted
 * in the iOS Photos app) and cascade-deletes its CLIP embedding — otherwise the grid would show dead
 * `ph://` cells, Albums counts would inflate, search would surface ghosts, and a freed rowid reused
 * by a future photo would inherit the deleted photo's embedding.
 *
 * Reconciliation is skipped when `assets` is empty: an empty read is far more likely a transient
 * PhotoKit/permission hiccup than the user deleting their entire library, and pruning-to-zero would
 * wipe the durable replica (and every embedding) on that hiccup. The live set goes through an
 * in-memory temp table so the NOT IN prune never hits SQLite's bound-parameter limit on big libraries.
 */
export function ingestCameraRoll(assets: AssetMetadata[]): number {
  const conn = openReplica();
  conn.executeSync('BEGIN');
  try {
    conn.executeSync('CREATE TEMP TABLE IF NOT EXISTS _ingest_live (external_id TEXT PRIMARY KEY)');
    conn.executeSync('DELETE FROM _ingest_live');
    for (const a of assets) {
      const externalId = a.id;
      const uid = assetUidForExternal(externalId);
      conn.executeSync(
        `INSERT INTO assets (asset_uid, external_id, filename, width, height, created_at, modified_at, is_favorite, source, media_type, duration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'camera-roll', ?, ?)
         ON CONFLICT(external_id) DO UPDATE SET
           filename = excluded.filename,
           width = excluded.width,
           height = excluded.height,
           created_at = excluded.created_at,
           modified_at = excluded.modified_at,
           is_favorite = excluded.is_favorite,
           media_type = excluded.media_type,
           duration = excluded.duration`,
        [
          uid,
          externalId,
          a.filename ?? null,
          a.width ?? null,
          a.height ?? null,
          a.creationTime ?? null,
          a.modificationTime ?? null,
          a.isFavorite ? 1 : 0,
          a.mediaType === MediaType.VIDEO ? 'video' : 'image',
          a.duration ?? null,
        ],
      );
      conn.executeSync('INSERT OR IGNORE INTO _ingest_live(external_id) VALUES (?)', [externalId]);
    }

    if (assets.length > 0) {
      // Cascade embeddings first (asset_clip is keyed by the asset's rowid), then prune the assets.
      conn.executeSync(
        `DELETE FROM asset_clip WHERE rowid IN (
           SELECT rowid FROM assets WHERE external_id NOT IN (SELECT external_id FROM _ingest_live)
         )`,
      );
      conn.executeSync(
        'DELETE FROM photo_meta WHERE external_id NOT IN (SELECT external_id FROM _ingest_live)',
      );
      conn.executeSync(
        'DELETE FROM photo_text WHERE external_id NOT IN (SELECT external_id FROM _ingest_live)',
      );
      conn.executeSync(
        'DELETE FROM assets WHERE external_id NOT IN (SELECT external_id FROM _ingest_live)',
      );
    }
    conn.executeSync('COMMIT');
  } catch (e) {
    conn.executeSync('ROLLBACK');
    throw e;
  }
  return assets.length;
}

export interface ReplicaAsset {
  asset_uid: string;
  external_id: string;
  filename: string | null;
  width: number | null;
  height: number | null;
  created_at: number | null;
  is_favorite: number;
  media_type: string; // 'image' | 'video'
  duration: number | null;
  is_hidden: number;
}

/** Read the library from the replica, newest first — the offline-first grid source. */
export function listAssets(limit = 100_000): ReplicaAsset[] {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    `SELECT asset_uid, external_id, filename, width, height, created_at, is_favorite, media_type, duration, is_hidden
     FROM assets ORDER BY created_at DESC, asset_uid LIMIT ?`,
    [limit],
  );
  return (rows ?? []) as unknown as ReplicaAsset[];
}

/** Set (or clear) the app-local Hidden flag for a set of photos. App-local only — never touches PhotoKit. */
export function setHiddenLocal(externalIds: string[], hidden: boolean): void {
  if (externalIds.length === 0) return;
  const conn = openReplica();
  const placeholders = externalIds.map(() => '?').join(',');
  conn.executeSync(
    `UPDATE assets SET is_hidden = ? WHERE external_id IN (${placeholders})`,
    [hidden ? 1 : 0, ...externalIds],
  );
}

/**
 * Update the replica's cached favorite flag so the offline-first grid reflects it immediately. The
 * caller also writes through to PhotoKit (Asset.setFavorite), which is the system source of truth;
 * this keeps the durable replica in sync so the flag survives relaunch without waiting on a re-read.
 */
export function setFavoriteLocal(externalId: string, favorite: boolean): void {
  const conn = openReplica();
  conn.executeSync('UPDATE assets SET is_favorite = ? WHERE external_id = ?', [
    favorite ? 1 : 0,
    externalId,
  ]);
}

/**
 * Remove assets (and their CLIP embeddings) from the replica after they've been deleted from the
 * device library. Mirrors the ingest prune, but immediate so the grid updates without waiting for
 * the next launch's reconciliation. A selection is small, so binding the ids directly is fine.
 */
export function deleteAssetsLocal(externalIds: string[]): void {
  if (externalIds.length === 0) return;
  const conn = openReplica();
  const placeholders = externalIds.map(() => '?').join(',');
  conn.executeSync('BEGIN');
  try {
    conn.executeSync(
      `DELETE FROM asset_clip WHERE rowid IN (SELECT rowid FROM assets WHERE external_id IN (${placeholders}))`,
      externalIds,
    );
    conn.executeSync(`DELETE FROM photo_meta WHERE external_id IN (${placeholders})`, externalIds);
    conn.executeSync(`DELETE FROM photo_text WHERE external_id IN (${placeholders})`, externalIds);
    conn.executeSync(`DELETE FROM assets WHERE external_id IN (${placeholders})`, externalIds);
    conn.executeSync('COMMIT');
  } catch (e) {
    conn.executeSync('ROLLBACK');
    throw e;
  }
}

// --- On-device semantic search (CLIP) ---------------------------------------------------------

export interface EmbeddingTarget {
  rowid: number;
  external_id: string;
}

/**
 * The assets still needing a CLIP embedding, with the rowid the vector is keyed by. Incremental by
 * construction: rows already present in `asset_clip` are skipped, so re-running enable() after a
 * reload only embeds NEW photos (the phone-indexes-incrementally half of the spec's hybrid) instead
 * of re-embedding the whole library. Embeddings persist in the encrypted replica across launches.
 */
export function assetsForEmbedding(): EmbeddingTarget[] {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    `SELECT rowid, external_id FROM assets
     WHERE media_type = 'image' AND rowid NOT IN (SELECT rowid FROM asset_clip)
     ORDER BY rowid`,
  );
  return (rows ?? []) as unknown as EmbeddingTarget[];
}

/** Store one asset's CLIP embedding (replace-on-conflict via delete+insert; vec0 has no UPSERT). */
export function putClipEmbedding(rowid: number, embedding: Float32Array): void {
  const conn = openReplica();
  conn.executeSync('DELETE FROM asset_clip WHERE rowid = ?', [rowid]);
  conn.executeSync('INSERT INTO asset_clip(rowid, embedding) VALUES (?, ?)', [rowid, embedding.buffer as ArrayBuffer]);
}

export function clipEmbeddingCount(): number {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT COUNT(*) AS n FROM asset_clip');
  return Number((rows?.[0] as { n: number } | undefined)?.n ?? 0);
}

/**
 * Semantic KNN: given a query embedding, return the matching assets' external_ids in relevance
 * order. This is the search path — the query embedding comes from the CLIP text encoder.
 *
 * `k` is clamped to the number of stored vectors. sqlite-vec requires `k <= row count`; asking for
 * more neighbours than exist is at best wasteful and at worst undefined behaviour across versions.
 * Clamping keeps the query well-defined regardless of library size.
 */
export function searchByEmbedding(query: Float32Array, k = 60): string[] {
  const conn = openReplica();
  const available = clipEmbeddingCount();
  if (available === 0) return [];
  const kk = Math.min(k, available);
  const knn = conn.executeSync(
    'SELECT rowid, distance FROM asset_clip WHERE embedding MATCH ? AND k = ? ORDER BY distance',
    [query.buffer as ArrayBuffer, kk],
  );
  const rowids = (knn.rows ?? []).map((r) => Number((r as { rowid: number }).rowid));
  return remapRowidsToExternalIds(conn, rowids);
}

/**
 * "Find similar" — KNN over a photo's OWN CLIP image embedding, so tapping any photo surfaces the
 * visually/semantically closest others. Reuses the image embeddings already computed for text search;
 * the source photo is dropped from the result (it is trivially its own nearest neighbour at distance
 * 0). Returns [] if the photo isn't indexed yet (search not enabled).
 */
export function similarByExternalId(externalId: string, k = 60): string[] {
  const conn = openReplica();
  const src = conn.executeSync('SELECT rowid FROM assets WHERE external_id = ?', [externalId]);
  const sourceRowid = Number((src.rows?.[0] as { rowid: number } | undefined)?.rowid ?? -1);
  if (sourceRowid < 0) return [];
  const emb = conn.executeSync('SELECT embedding FROM asset_clip WHERE rowid = ?', [sourceRowid]);
  const blob = (emb.rows?.[0] as { embedding: ArrayBuffer } | undefined)?.embedding;
  if (!blob) return []; // photo not embedded yet
  const available = clipEmbeddingCount();
  const kk = Math.min(k + 1, available); // +1: the source itself comes back first
  const knn = conn.executeSync(
    'SELECT rowid, distance FROM asset_clip WHERE embedding MATCH ? AND k = ? ORDER BY distance',
    [blob, kk],
  );
  const rowids = (knn.rows ?? [])
    .map((r) => Number((r as { rowid: number }).rowid))
    .filter((id) => id !== sourceRowid);
  return remapRowidsToExternalIds(conn, rowids);
}

/**
 * Find near-duplicate groups by clustering the CLIP image embeddings: for each embedded photo, KNN
 * its closest neighbours and union any within `maxDistance` (L2 on L2-normalized vectors ≈ cosine —
 * a tight threshold so only near-identical photos group, e.g. the same shot re-saved as JPEG + HEIC,
 * or burst frames — not merely "similar" ones). Returns groups (≥2 members) of external_ids, the
 * first being a stable "keep" candidate. O(N) KNN queries; fine for a phone library, run on demand.
 */
export function findDuplicateGroups(maxDistance = 0.2, capGroups = 200): string[][] {
  const conn = openReplica();
  // Hidden photos must never surface in the Duplicates review (they'd resurface next to their visible
  // twin, and be deletable — defeating "hidden"). asset_clip is keyed by the asset's rowid, so we build
  // the hidden-rowid set once and exclude it from BOTH the candidate rows AND every KNN neighbour.
  const hiddenRowids = new Set(
    ((conn.executeSync('SELECT rowid FROM assets WHERE is_hidden = 1').rows ?? []) as unknown as {
      rowid: number;
    }[]).map((r) => Number(r.rowid)),
  );
  const rows = (
    (conn.executeSync('SELECT rowid, embedding FROM asset_clip').rows ?? []) as unknown as {
      rowid: number;
      embedding: ArrayBuffer;
    }[]
  ).filter((r) => !hiddenRowids.has(Number(r.rowid)));
  if (rows.length < 2) return [];

  const ids = rows.map((r) => Number(r.rowid));
  const parent = new Map<number, number>(ids.map((id) => [id, id]));
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    while (parent.get(x) !== root) {
      const next = parent.get(x) as number;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const k = Math.min(8, rows.length);
  for (const r of rows) {
    const rowid = Number(r.rowid);
    const knn = conn.executeSync(
      'SELECT rowid, distance FROM asset_clip WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      [r.embedding, k],
    );
    for (const n of (knn.rows ?? []) as unknown as { rowid: number; distance: number }[]) {
      const nid = Number(n.rowid);
      // Skip hidden neighbours — a KNN match can return a hidden photo's embedding even though it's
      // not in our candidate `rows`; unioning it would pull a hidden photo into a visible group.
      if (nid !== rowid && !hiddenRowids.has(nid) && Number(n.distance) <= maxDistance) union(rowid, nid);
    }
  }

  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const root = find(id);
    const g = groups.get(root);
    if (g) g.push(id);
    else groups.set(root, [id]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length >= 2).slice(0, capGroups);
  if (dupGroups.length === 0) return [];

  const allRowids = dupGroups.flat();
  const map = conn.executeSync(
    `SELECT rowid, external_id FROM assets WHERE rowid IN (${allRowids.map(() => '?').join(',')})`,
    allRowids,
  );
  const byRow = new Map<number, string>();
  for (const r of (map.rows ?? []) as unknown as { rowid: number; external_id: string }[]) {
    byRow.set(Number(r.rowid), r.external_id);
  }
  return dupGroups
    .map((g) => g.map((id) => byRow.get(id)).filter((v): v is string => typeof v === 'string'))
    .filter((g) => g.length >= 2);
}

// --- On-device OCR / Live-Text (text recognized inside photos) --------------------------------

export interface OcrTarget {
  external_id: string;
  width: number | null;
  height: number | null;
}

/**
 * Images still needing OCR, newest-first (recent photos are the likeliest search targets, so they
 * index first). Incremental like the CLIP path: a row in `photo_text` — even an empty-string one —
 * marks a photo as already recognized, so a re-run only OCRs NEW photos. Videos are excluded (we OCR
 * stills only). Width/height come along so the recognizer can downscale huge images before OCR.
 */
export function assetsForOcr(limit = 12): OcrTarget[] {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    `SELECT external_id, width, height FROM assets
     WHERE media_type = 'image' AND external_id NOT IN (SELECT external_id FROM photo_text)
     ORDER BY created_at DESC, asset_uid LIMIT ?`,
    [limit],
  );
  return (rows ?? []) as unknown as OcrTarget[];
}

/**
 * Store a photo's recognized text — original case in `text` (for display) plus a Unicode-lowercased
 * `text_lc` (for search). Marks the photo OCR'd even when `text` is empty, so it's not revisited.
 */
export function putPhotoText(externalId: string, text: string): void {
  const conn = openReplica();
  conn.executeSync(
    `INSERT INTO photo_text (external_id, text, text_lc, indexed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(external_id) DO UPDATE SET
       text = excluded.text, text_lc = excluded.text_lc, indexed_at = excluded.indexed_at`,
    [externalId, text, text.toLowerCase(), Date.now()],
  );
}

/** The original-case recognized text for a photo, or null when it has none / isn't OCR'd yet. */
export function getPhotoText(externalId: string): string | null {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT text FROM photo_text WHERE external_id = ?', [externalId]);
  const t = (rows?.[0] as { text: string | null } | undefined)?.text ?? null;
  return t && t.trim() !== '' ? t : null;
}

/** How many photos have been OCR'd (rows in photo_text), for the index-progress UI. */
export function ocrIndexedCount(): number {
  const conn = openReplica();
  const { rows } = conn.executeSync('SELECT COUNT(*) AS n FROM photo_text');
  return Number((rows?.[0] as { n: number } | undefined)?.n ?? 0);
}

/** How many image assets still await OCR. */
export function ocrPendingCount(): number {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    `SELECT COUNT(*) AS n FROM assets
     WHERE media_type = 'image' AND external_id NOT IN (SELECT external_id FROM photo_text)`,
  );
  return Number((rows?.[0] as { n: number } | undefined)?.n ?? 0);
}

/** Escape LIKE wildcards so a user typing % or _ searches for the literal character. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Search the OCR index: return external_ids of photos whose recognized text contains ALL of the
 * query's words (each as a substring), newest-first. Case-insensitive across ALL scripts: the stored
 * text is Unicode-lowercased at index time (useOcrIndex) and the query is lowercased here, so matching
 * never depends on SQLite LIKE's ASCII-only case folding (which would miss e.g. "MUSÉE" vs "musée").
 * This is the text-in-photos search that complements CLIP's visual search; the caller unions the two.
 * Returns [] for an empty/too-short query so a stray keystroke can't scan-match the whole index.
 */
export function searchPhotoText(query: string, limit = 300): string[] {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  const conn = openReplica();
  // Match against text_lc (Unicode-lowercased at index time); the query terms are lowercased above, so
  // matching folds case across ALL scripts, not just SQLite LIKE's ASCII range.
  const where = terms.map(() => `p.text_lc LIKE ? ESCAPE '\\'`).join(' AND ');
  const params = terms.map((t) => `%${likeEscape(t)}%`);
  const { rows } = conn.executeSync(
    `SELECT p.external_id FROM photo_text p
     JOIN assets a ON a.external_id = p.external_id
     WHERE p.text_lc IS NOT NULL AND p.text_lc <> '' AND ${where}
     ORDER BY a.created_at DESC, a.asset_uid LIMIT ?`,
    [...params, limit],
  );
  return (rows ?? []).map((r) => (r as { external_id: string }).external_id);
}

/** Map sqlite-vec KNN rowids back to assets.external_id, preserving the input (relevance) order. */
function remapRowidsToExternalIds(conn: DB, rowids: number[]): string[] {
  if (rowids.length === 0) return [];
  const map = conn.executeSync(
    `SELECT rowid, external_id FROM assets WHERE rowid IN (${rowids.map(() => '?').join(',')})`,
    rowids,
  );
  const byRow = new Map<number, string>();
  for (const r of map.rows ?? []) {
    const row = r as { rowid: number; external_id: string };
    byRow.set(Number(row.rowid), row.external_id);
  }
  return rowids.map((id) => byRow.get(id)).filter((v): v is string => typeof v === 'string');
}
