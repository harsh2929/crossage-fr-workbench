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
import type { AssetMetadata } from 'expo-media-library';

const DB_NAME = 'vintrace-replica.db';
// A dev key. In production this comes from the iOS Keychain / Android Keystore (spec §6.2);
// the point here is that the replica is SQLCipher-encrypted at rest, not plaintext.
const DEV_KEY = 'vintrace-replica-dev-key-v1';

// Semantic embedding dimension the desktop syncs (SigLIP2 → int8[512] per spec §3.1/§6).
export const EMBED_DIM = 512;
// CLIP ViT-B/32 output dimension for on-device semantic search.
export const CLIP_DIM = 512;

let db: DB | null = null;

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
      source        TEXT NOT NULL DEFAULT 'camera-roll'
    )
  `);
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

  return db;
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
        `INSERT INTO assets (asset_uid, external_id, filename, width, height, created_at, modified_at, is_favorite, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'camera-roll')
         ON CONFLICT(external_id) DO UPDATE SET
           filename = excluded.filename,
           width = excluded.width,
           height = excluded.height,
           created_at = excluded.created_at,
           modified_at = excluded.modified_at,
           is_favorite = excluded.is_favorite`,
        [
          uid,
          externalId,
          a.filename ?? null,
          a.width ?? null,
          a.height ?? null,
          a.creationTime ?? null,
          a.modificationTime ?? null,
          a.isFavorite ? 1 : 0,
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
}

/** Read the library from the replica, newest first — the offline-first grid source. */
export function listAssets(limit = 100_000): ReplicaAsset[] {
  const conn = openReplica();
  const { rows } = conn.executeSync(
    `SELECT asset_uid, external_id, filename, width, height, created_at, is_favorite
     FROM assets ORDER BY created_at DESC, asset_uid LIMIT ?`,
    [limit],
  );
  return (rows ?? []) as unknown as ReplicaAsset[];
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
     WHERE rowid NOT IN (SELECT rowid FROM asset_clip)
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
  const rows = (conn.executeSync('SELECT rowid, embedding FROM asset_clip').rows ?? []) as unknown as {
    rowid: number;
    embedding: ArrayBuffer;
  }[];
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
      if (nid !== rowid && Number(n.distance) <= maxDistance) union(rowid, nid);
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
