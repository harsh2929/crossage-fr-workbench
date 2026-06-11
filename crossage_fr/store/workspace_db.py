from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, is_dataclass
from pathlib import Path
import json
import os
import shutil
import sqlite3
from typing import Any, Iterable, Iterator

from crossage_fr.workspace_registry import now_iso


SCHEMA_VERSION = 1


def path_signature(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "path": str(path.expanduser().resolve()),
        "size": int(stat.st_size),
        "mtimeNs": int(stat.st_mtime_ns),
        "pathKey": f"{path.expanduser().resolve()}|{int(stat.st_size)}|{int(stat.st_mtime_ns)}",
    }


class WorkspaceDb:
    def __init__(self, path: Path):
        self.path = path.expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._init_schema()
        except sqlite3.DatabaseError as exc:
            if not self._looks_corrupt(exc):
                raise
            self.snapshot_files("startup-corrupt")
            self.rebuild_empty()

    def _looks_corrupt(self, exc: sqlite3.DatabaseError) -> bool:
        message = str(exc).lower()
        return any(
            marker in message
            for marker in (
                "file is not a database",
                "database disk image is malformed",
                "malformed database",
                "schema is corrupt",
            )
        )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA busy_timeout=30000")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS scan_runs (
                    run_id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    source TEXT NOT NULL,
                    root_path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL,
                    total INTEGER NOT NULL DEFAULT 0,
                    processed INTEGER NOT NULL DEFAULT 0,
                    added INTEGER NOT NULL DEFAULT 0,
                    matched INTEGER NOT NULL DEFAULT 0,
                    clustered INTEGER NOT NULL DEFAULT 0,
                    skipped INTEGER NOT NULL DEFAULT 0,
                    errors INTEGER NOT NULL DEFAULT 0,
                    unmatched INTEGER NOT NULL DEFAULT 0,
                    safe_filtered INTEGER NOT NULL DEFAULT 0,
                    video_files INTEGER NOT NULL DEFAULT 0,
                    video_frames INTEGER NOT NULL DEFAULT 0,
                    video_protected INTEGER NOT NULL DEFAULT 0,
                    cancelled INTEGER NOT NULL DEFAULT 0,
                    last_path TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_scan_runs_lookup
                    ON scan_runs(source, label, root_path, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_scan_runs_updated
                    ON scan_runs(updated_at DESC);
                CREATE TABLE IF NOT EXISTS scan_files (
                    run_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    path_key TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    mtime_ns INTEGER NOT NULL DEFAULT 0,
                    content_hash TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    phase TEXT NOT NULL DEFAULT '',
                    message TEXT NOT NULL DEFAULT '',
                    candidate_id TEXT NOT NULL DEFAULT '',
                    safety_score REAL,
                    processed_at TEXT NOT NULL,
                    PRIMARY KEY (run_id, path),
                    FOREIGN KEY (run_id) REFERENCES scan_runs(run_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_scan_files_resume
                    ON scan_files(run_id, path, path_key, status);
                CREATE INDEX IF NOT EXISTS idx_scan_files_hash
                    ON scan_files(content_hash);
                CREATE TABLE IF NOT EXISTS safety_cache (
                    file_hash TEXT NOT NULL,
                    model_version TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    sensitive INTEGER NOT NULL,
                    score REAL NOT NULL,
                    reason TEXT NOT NULL,
                    engine TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    labels_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (file_hash, model_version, threshold)
                );
                CREATE TABLE IF NOT EXISTS embedding_cache (
                    file_hash TEXT NOT NULL,
                    model_version TEXT NOT NULL,
                    detector_size INTEGER NOT NULL,
                    embeddings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (file_hash, model_version, detector_size)
                );
                CREATE TABLE IF NOT EXISTS calibration_labels (
                    label_id TEXT PRIMARY KEY,
                    source_path TEXT NOT NULL,
                    file_hash TEXT NOT NULL DEFAULT '',
                    expected_person TEXT NOT NULL DEFAULT '',
                    actual_person TEXT NOT NULL DEFAULT '',
                    match_score REAL,
                    is_match INTEGER,
                    safe_label TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_calibration_labels_created
                    ON calibration_labels(created_at DESC);
                CREATE TABLE IF NOT EXISTS blocked_pairs (
                    file_hash TEXT NOT NULL,
                    person_name TEXT NOT NULL,
                    best_ref_id TEXT NOT NULL DEFAULT '',
                    source_path TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (file_hash, person_name, best_ref_id)
                );
                CREATE INDEX IF NOT EXISTS idx_blocked_pairs_created
                    ON blocked_pairs(created_at DESC);
                CREATE TABLE IF NOT EXISTS benchmark_runs (
                    run_id TEXT PRIMARY KEY,
                    generated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_benchmark_runs_generated
                    ON benchmark_runs(generated_at DESC);
                CREATE TABLE IF NOT EXISTS review_candidates (
                    candidate_id TEXT PRIMARY KEY,
                    source_path TEXT NOT NULL,
                    person_name TEXT NOT NULL,
                    person_key TEXT NOT NULL,
                    best_ref_id TEXT NOT NULL DEFAULT '',
                    best_ref_path TEXT NOT NULL DEFAULT '',
                    score REAL NOT NULL DEFAULT 0,
                    band TEXT NOT NULL DEFAULT '',
                    quality REAL NOT NULL DEFAULT 0,
                    model_name TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    note TEXT NOT NULL DEFAULT '',
                    media_kind TEXT NOT NULL DEFAULT 'image',
                    media_source_path TEXT NOT NULL DEFAULT '',
                    media_path TEXT NOT NULL DEFAULT '',
                    folder_path TEXT NOT NULL DEFAULT '',
                    video_timestamp_ms INTEGER,
                    video_frame_index INTEGER,
                    video_duration_ms INTEGER,
                    source_hash TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_review_candidates_status_score
                    ON review_candidates(status, score DESC, quality DESC, created_at DESC, candidate_id);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_score
                    ON review_candidates(score DESC, quality DESC, created_at DESC, candidate_id);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_created
                    ON review_candidates(created_at DESC, candidate_id);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_quality
                    ON review_candidates(quality DESC, created_at DESC, candidate_id);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_person
                    ON review_candidates(person_key, status, score DESC);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_media_path
                    ON review_candidates(media_path);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_media_kind
                    ON review_candidates(media_kind, status, score DESC);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_video_source_score
                    ON review_candidates(media_kind, media_source_path, score DESC, created_at DESC, candidate_id);
                CREATE INDEX IF NOT EXISTS idx_review_candidates_source_hash
                    ON review_candidates(source_hash);
                """
            )
            self._ensure_column(conn, "review_candidates", "folder_path", "TEXT NOT NULL DEFAULT ''")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_review_candidates_folder
                    ON review_candidates(folder_path, status, score DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_review_candidates_status_folder
                    ON review_candidates(status, folder_path)
                """
            )
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES('schemaVersion', ?)",
                (str(SCHEMA_VERSION),),
            )

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, declaration: str) -> None:
        columns = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def _candidate_payload(self, candidate: Any) -> dict[str, Any]:
        if is_dataclass(candidate):
            payload = asdict(candidate)
        elif isinstance(candidate, dict):
            payload = dict(candidate)
        else:
            payload = {
                "candidate_id": getattr(candidate, "candidate_id", ""),
                "source_path": getattr(candidate, "source_path", ""),
                "person_name": getattr(candidate, "person_name", ""),
                "best_ref_id": getattr(candidate, "best_ref_id", None),
                "best_ref_path": getattr(candidate, "best_ref_path", None),
                "score": getattr(candidate, "score", 0.0),
                "band": getattr(candidate, "band", ""),
                "quality": getattr(candidate, "quality", 0.0),
                "model_name": getattr(candidate, "model_name", ""),
                "status": getattr(candidate, "status", "pending"),
                "note": getattr(candidate, "note", ""),
                "media_kind": getattr(candidate, "media_kind", "image"),
                "media_source_path": getattr(candidate, "media_source_path", ""),
                "video_timestamp_ms": getattr(candidate, "video_timestamp_ms", None),
                "video_frame_index": getattr(candidate, "video_frame_index", None),
                "video_duration_ms": getattr(candidate, "video_duration_ms", None),
                "source_hash": getattr(candidate, "source_hash", ""),
                "created_at": getattr(candidate, "created_at", now_iso()),
            }
        return payload

    def _candidate_params(self, candidate: Any) -> tuple[Any, ...]:
        payload = self._candidate_payload(candidate)
        source_path = str(payload.get("source_path", ""))
        media_source_path = str(payload.get("media_source_path", "") or "")
        media_path = media_source_path or source_path
        try:
            folder_path = str(Path(media_path).expanduser().parent) if media_path else ""
        except (OSError, ValueError):
            folder_path = ""
        person_name = str(payload.get("person_name", ""))
        return (
            str(payload.get("candidate_id", "")),
            source_path,
            person_name,
            person_name.casefold(),
            str(payload.get("best_ref_id") or ""),
            str(payload.get("best_ref_path") or ""),
            float(payload.get("score", 0.0) or 0.0),
            str(payload.get("band", "")),
            float(payload.get("quality", 0.0) or 0.0),
            str(payload.get("model_name", "")),
            str(payload.get("status", "pending")),
            str(payload.get("note", "")),
            str(payload.get("media_kind", "image") or "image"),
            media_source_path,
            media_path,
            folder_path,
            payload.get("video_timestamp_ms"),
            payload.get("video_frame_index"),
            payload.get("video_duration_ms"),
            str(payload.get("source_hash", "")),
            str(payload.get("created_at", "") or now_iso()),
            json.dumps(payload, separators=(",", ":")),
        )

    def _upsert_candidate_sql(self) -> str:
        return """
            INSERT OR REPLACE INTO review_candidates(
                candidate_id, source_path, person_name, person_key, best_ref_id, best_ref_path,
                score, band, quality, model_name, status, note, media_kind, media_source_path,
                media_path, folder_path, video_timestamp_ms, video_frame_index, video_duration_ms, source_hash,
                created_at, payload_json
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    def _candidate_param_batches(self, candidates: Iterable[Any], batch_size: int = 1000) -> Iterator[list[tuple[Any, ...]]]:
        batch: list[tuple[Any, ...]] = []
        for candidate in candidates:
            batch.append(self._candidate_params(candidate))
            if len(batch) >= batch_size:
                yield batch
                batch = []
        if batch:
            yield batch

    def replace_candidates(self, candidates: Iterable[Any], conn: sqlite3.Connection | None = None) -> int:
        if conn is None:
            with self.connect() as local_conn:
                return self.replace_candidates(candidates, local_conn)
        conn.execute("DELETE FROM review_candidates")
        total = 0
        for rows in self._candidate_param_batches(candidates):
            conn.executemany(self._upsert_candidate_sql(), rows)
            total += len(rows)
        return total

    def upsert_candidates(self, candidates: Iterable[Any], conn: sqlite3.Connection | None = None) -> int:
        if conn is None:
            with self.connect() as local_conn:
                return self.upsert_candidates(candidates, local_conn)
        total = 0
        for rows in self._candidate_param_batches(candidates):
            conn.executemany(self._upsert_candidate_sql(), rows)
            total += len(rows)
        return total

    def iter_candidate_payloads(self, conn: sqlite3.Connection | None = None) -> Iterator[dict[str, Any]]:
        if conn is None:
            with self.connect() as local_conn:
                yield from self.iter_candidate_payloads(local_conn)
            return
        rows = conn.execute("SELECT payload_json FROM review_candidates ORDER BY created_at ASC, candidate_id ASC")
        for row in rows:
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict):
                yield payload

    def candidate_key_exists(
        self,
        dedupe_source: str,
        best_ref_id: str | None,
        person_name: str,
        conn: sqlite3.Connection | None = None,
    ) -> bool:
        if conn is None:
            with self.connect() as local_conn:
                return self.candidate_key_exists(dedupe_source, best_ref_id, person_name, local_conn)
        source = str(dedupe_source or "")
        ref_id = str(best_ref_id or "")
        person = str(person_name or "")
        if source.startswith("sha256:"):
            row = conn.execute(
                """
                SELECT 1 FROM review_candidates
                WHERE source_hash = ? AND best_ref_id = ? AND person_name = ?
                LIMIT 1
                """,
                (source.removeprefix("sha256:"), ref_id, person),
            ).fetchone()
            return row is not None
        row = conn.execute(
            """
            SELECT 1 FROM review_candidates
            WHERE (media_path = ? OR source_path = ? OR media_source_path = ?)
                AND best_ref_id = ?
                AND person_name = ?
            LIMIT 1
            """,
            (source, source, source, ref_id, person),
        ).fetchone()
        return row is not None

    def delete_candidates(self, candidate_ids: Iterable[str], conn: sqlite3.Connection | None = None) -> int:
        ids = [str(candidate_id) for candidate_id in candidate_ids if str(candidate_id)]
        if conn is None:
            with self.connect() as local_conn:
                return self.delete_candidates(ids, local_conn)
        if not ids:
            return 0
        conn.executemany("DELETE FROM review_candidates WHERE candidate_id = ?", [(candidate_id,) for candidate_id in ids])
        return len(ids)

    def clear_candidates(self, conn: sqlite3.Connection | None = None) -> int:
        if conn is None:
            with self.connect() as local_conn:
                return self.clear_candidates(local_conn)
        row = conn.execute("SELECT COUNT(*) AS n FROM review_candidates").fetchone()
        conn.execute("DELETE FROM review_candidates")
        return int(row["n"] if row else 0)

    def candidate_count(self, conn: sqlite3.Connection | None = None) -> int:
        if conn is None:
            with self.connect() as local_conn:
                return self.candidate_count(local_conn)
        row = conn.execute("SELECT COUNT(*) AS n FROM review_candidates").fetchone()
        return int(row["n"] if row else 0)

    def candidate_status_counts(self, conn: sqlite3.Connection | None = None) -> dict[str, int]:
        if conn is None:
            with self.connect() as local_conn:
                return self.candidate_status_counts(local_conn)
        rows = conn.execute("SELECT status, COUNT(*) AS n FROM review_candidates GROUP BY status").fetchall()
        counts = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for row in rows:
            counts[str(row["status"])] = int(row["n"] or 0)
        counts["total"] = sum(counts.values())
        counts["reviewed"] = counts["total"] - counts.get("pending", 0)
        return counts

    def review_insights(self, confident_threshold: float, limit: int = 8, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        if conn is None:
            with self.connect() as local_conn:
                return self.review_insights(confident_threshold, limit, local_conn)
        stats = conn.execute(
            """
            SELECT
                COUNT(*) AS pending,
                SUM(CASE WHEN score >= ? THEN 1 ELSE 0 END) AS confident_pending,
                SUM(CASE WHEN media_kind = 'video' THEN 1 ELSE 0 END) AS video_pending
            FROM review_candidates
            WHERE status = 'pending'
            """,
            (float(confident_threshold),),
        ).fetchone()
        folder_rows = conn.execute(
            """
            SELECT folder_path AS folder, COUNT(*) AS n
            FROM review_candidates
            WHERE status = 'pending' AND folder_path != ''
            GROUP BY folder_path
            ORDER BY n DESC, folder ASC
            LIMIT ?
            """,
            (max(1, min(100, int(limit))),),
        ).fetchall()
        pending = int(stats["pending"] or 0) if stats else 0
        confident = int(stats["confident_pending"] or 0) if stats else 0
        video_pending = int(stats["video_pending"] or 0) if stats else 0
        return {
            "pending": pending,
            "confidentPending": confident,
            "videoPending": video_pending,
            "imagePending": pending - video_pending,
            "topFolders": [{"folder": str(row["folder"] or ""), "count": int(row["n"] or 0)} for row in folder_rows],
            "recommendedOrder": "strongest-first" if confident else "newest-first",
            "index": "sqlite",
        }

    def video_moments(self, limit: int = 80, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        if conn is None:
            with self.connect() as local_conn:
                return self.video_moments(limit, local_conn)
        groups = conn.execute(
            """
            SELECT
                media_source_path,
                COUNT(*) AS count,
                MAX(score) AS best_score,
                MIN(video_timestamp_ms) AS first_timestamp_ms,
                MAX(video_timestamp_ms) AS last_timestamp_ms
            FROM review_candidates
            WHERE media_kind = 'video' AND media_source_path != ''
            GROUP BY media_source_path
            ORDER BY best_score DESC, count DESC, media_source_path ASC
            LIMIT ?
            """,
            (max(1, min(1000, int(limit))),),
        ).fetchall()
        rows: list[dict[str, Any]] = []
        for group in groups:
            media_source_path = str(group["media_source_path"])
            samples = conn.execute(
                """
                SELECT candidate_id, person_name, status, source_path, score
                FROM review_candidates
                WHERE media_kind = 'video' AND media_source_path = ?
                ORDER BY score DESC, created_at DESC, candidate_id ASC
                LIMIT 60
                """,
                (media_source_path,),
            ).fetchall()
            people = sorted(
                {
                    str(row["person_name"])
                    for row in samples
                    if str(row["person_name"]).strip() and not str(row["person_name"]).startswith("Unmatched cluster")
                }
            )
            statuses = sorted({str(row["status"]) for row in samples})
            best_preview = str(samples[0]["source_path"]) if samples else ""
            rows.append(
                {
                    "mediaSourcePath": media_source_path,
                    "candidateIds": [str(row["candidate_id"]) for row in samples],
                    "people": people,
                    "statuses": statuses,
                    "count": int(group["count"] or 0),
                    "bestScore": float(group["best_score"] or 0.0),
                    "firstTimestampMs": group["first_timestamp_ms"],
                    "lastTimestampMs": group["last_timestamp_ms"],
                    "previewPath": best_preview,
                }
            )
        return rows

    def query_candidates(
        self,
        *,
        status: str = "all",
        lane: str = "all",
        query: str = "",
        sort: str = "score",
        offset: int = 0,
        limit: int = 100,
        confident_threshold: float = 0.4,
        low_quality_threshold: float = 0.15,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.connect() as local_conn:
                return self.query_candidates(
                    status=status,
                    lane=lane,
                    query=query,
                    sort=sort,
                    offset=offset,
                    limit=limit,
                    confident_threshold=confident_threshold,
                    low_quality_threshold=low_quality_threshold,
                    conn=local_conn,
                )
        where: list[str] = []
        args: list[Any] = []
        if status != "all":
            where.append("status = ?")
            args.append(status)
        if lane == "high":
            where.append("score >= ?")
            args.append(float(confident_threshold))
        elif lane == "lowQuality":
            where.append("quality < ?")
            args.append(float(low_quality_threshold))
        elif lane == "groups":
            where.append(
                """
                media_path IN (
                    SELECT media_path FROM review_candidates
                    WHERE TRIM(person_name) != '' AND person_name NOT LIKE 'Unmatched cluster%'
                    GROUP BY media_path
                    HAVING COUNT(DISTINCT person_name) >= 2
                )
                """
            )
        elif lane == "video":
            where.append("media_kind = 'video'")
        elif lane == "notes":
            where.append("TRIM(note) != ''")
        query_text = query.strip().lower()
        if query_text:
            like = f"%{query_text}%"
            where.append(
                """
                (
                    LOWER(person_name) LIKE ?
                    OR LOWER(band) LIKE ?
                    OR LOWER(source_path) LIKE ?
                    OR LOWER(media_source_path) LIKE ?
                    OR LOWER(note) LIKE ?
                    OR LOWER(source_hash) LIKE ?
                )
                """
            )
            args.extend([like, like, like, like, like, like])
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        total_row = conn.execute(f"SELECT COUNT(*) AS n FROM review_candidates {where_sql}", args).fetchone()
        total = int(total_row["n"] if total_row else 0)
        order_sql = {
            "newest": "created_at DESC, candidate_id DESC",
            "quality": "quality DESC, created_at DESC, candidate_id DESC",
            "status": "status ASC, person_key ASC, score DESC, candidate_id ASC",
            "state": "CASE WHEN status = 'pending' THEN 0 ELSE 1 END ASC, score DESC, person_key ASC, candidate_id ASC",
        }.get(sort, "score DESC, quality DESC, created_at DESC, candidate_id DESC")
        rows = conn.execute(
            f"""
            SELECT payload_json FROM review_candidates
            {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*args, int(limit), int(offset)],
        ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict):
                items.append(payload)
        return {"total": total, "items": items}

    def create_scan_run(self, run_id: str, label: str, source: str, root_path: str, total: int = 0) -> None:
        timestamp = now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO scan_runs(
                    run_id, label, source, root_path, status, started_at, updated_at, total
                ) VALUES(?, ?, ?, ?, 'running', ?, ?, ?)
                """,
                (run_id, label, source, root_path, timestamp, timestamp, int(total or 0)),
            )

    def latest_scan_run(self, label: str, source: str, root_path: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT run_id FROM scan_runs
                WHERE label = ? AND source = ? AND root_path = ?
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (label, source, root_path),
            ).fetchone()
            return str(row["run_id"]) if row else None

    def scan_file_completed(
        self,
        run_id: str | None,
        path: Path,
        signature: dict[str, Any],
        conn: sqlite3.Connection | None = None,
    ) -> bool:
        return self.scan_file_resume_row(run_id, path, signature, conn) is not None

    def scan_file_resume_row(
        self,
        run_id: str | None,
        path: Path,
        signature: dict[str, Any],
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if not run_id:
            return None
        if conn is None:
            with self.connect() as local_conn:
                return self.scan_file_resume_row(run_id, path, signature, local_conn)
        row = conn.execute(
            """
            SELECT status, phase, candidate_id FROM scan_files
            WHERE run_id = ? AND path = ? AND path_key = ?
            LIMIT 1
            """,
            (run_id, str(path), str(signature["pathKey"])),
        ).fetchone()
        if row and row["status"] in {"candidate", "clustered", "protected", "skipped", "completed"}:
            return dict(row)
        return None

    def record_scan_file(
        self,
        run_id: str,
        path: Path,
        signature: dict[str, Any],
        status: str,
        phase: str = "",
        message: str = "",
        candidate_id: str = "",
        safety_score: float | None = None,
        content_hash: str = "",
        conn: sqlite3.Connection | None = None,
    ) -> None:
        if conn is None:
            with self.connect() as local_conn:
                self.record_scan_file(
                    run_id,
                    path,
                    signature,
                    status,
                    phase=phase,
                    message=message,
                    candidate_id=candidate_id,
                    safety_score=safety_score,
                    content_hash=content_hash,
                    conn=local_conn,
                )
            return
        conn.execute(
            """
            INSERT OR REPLACE INTO scan_files(
                run_id, path, path_key, size, mtime_ns, content_hash, status, phase,
                message, candidate_id, safety_score, processed_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                str(path),
                str(signature["pathKey"]),
                int(signature["size"]),
                int(signature["mtimeNs"]),
                content_hash,
                status,
                phase,
                message[:1200],
                candidate_id,
                safety_score,
                now_iso(),
            ),
        )

    def update_scan_run(
        self,
        run_id: str,
        metrics: dict[str, int],
        status: str = "running",
        last_path: str = "",
        conn: sqlite3.Connection | None = None,
    ) -> None:
        completed_at = now_iso() if status in {"complete", "cancelled", "error"} else None
        if conn is None:
            with self.connect() as local_conn:
                self.update_scan_run(run_id, metrics, status, last_path, local_conn)
            return
        conn.execute(
            """
            UPDATE scan_runs SET
                status = ?,
                completed_at = COALESCE(?, completed_at),
                updated_at = ?,
                total = ?,
                processed = ?,
                added = ?,
                matched = ?,
                clustered = ?,
                skipped = ?,
                errors = ?,
                unmatched = ?,
                safe_filtered = ?,
                video_files = ?,
                video_frames = ?,
                video_protected = ?,
                cancelled = ?,
                last_path = ?
            WHERE run_id = ?
            """,
            (
                status,
                completed_at,
                now_iso(),
                int(metrics.get("total", 0)),
                int(metrics.get("processed", 0)),
                int(metrics.get("added", 0)),
                int(metrics.get("matched", 0)),
                int(metrics.get("clustered", 0)),
                int(metrics.get("skipped", 0)),
                int(metrics.get("errors", 0)),
                int(metrics.get("unmatched", 0)),
                int(metrics.get("safeFiltered", 0)),
                int(metrics.get("videoFiles", 0)),
                int(metrics.get("videoFrames", 0)),
                int(metrics.get("videoProtected", 0)),
                int(metrics.get("cancelled", 0)),
                last_path,
                run_id,
            ),
        )

    def relink_scan_paths(self, old_root: Path, new_root: Path) -> dict[str, int]:
        old_base = old_root.expanduser().resolve()
        new_base = new_root.expanduser().resolve()

        def remap(value: str, require_exists: bool = False) -> str:
            if not value:
                return value
            try:
                original = Path(value).expanduser().resolve()
                relative = original.relative_to(old_base)
            except (OSError, ValueError):
                return value
            target = new_base / relative
            if require_exists and not target.exists():
                return value
            try:
                return str(target.resolve())
            except OSError:
                return str(target)

        runs_updated = 0
        files_updated = 0
        with self.connect() as conn:
            runs = conn.execute("SELECT run_id, label, root_path, last_path FROM scan_runs").fetchall()
            for row in runs:
                next_label = remap(str(row["label"]))
                next_root = remap(str(row["root_path"]))
                next_last = remap(str(row["last_path"]), require_exists=True)
                if next_label != row["label"] or next_root != row["root_path"] or next_last != row["last_path"]:
                    conn.execute(
                        "UPDATE scan_runs SET label = ?, root_path = ?, last_path = ?, updated_at = ? WHERE run_id = ?",
                        (next_label, next_root, next_last, now_iso(), row["run_id"]),
                    )
                    runs_updated += 1
            rows = conn.execute("SELECT * FROM scan_files").fetchall()
            for row in rows:
                old_path = Path(str(row["path"]))
                new_path = Path(remap(str(row["path"]), require_exists=True))
                if str(new_path) == str(row["path"]):
                    continue
                try:
                    signature = path_signature(new_path)
                except OSError:
                    continue
                conn.execute(
                    "DELETE FROM scan_files WHERE run_id = ? AND path = ? AND path_key = ?",
                    (row["run_id"], row["path"], row["path_key"]),
                )
                conn.execute(
                    """
                    INSERT OR REPLACE INTO scan_files(
                        run_id, path, path_key, size, mtime_ns, content_hash, status, phase,
                        message, candidate_id, safety_score, processed_at
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["run_id"],
                        str(new_path),
                        str(signature["pathKey"]),
                        int(signature["size"]),
                        int(signature["mtimeNs"]),
                        row["content_hash"],
                        row["status"],
                        row["phase"],
                        row["message"],
                        row["candidate_id"],
                        row["safety_score"],
                        row["processed_at"],
                    ),
                )
                del old_path
                files_updated += 1
        return {"scanRuns": runs_updated, "scanFiles": files_updated}

    def safety_lookup(
        self,
        file_hash: str,
        model_version: str,
        threshold: float,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if conn is None:
            with self.connect() as local_conn:
                return self.safety_lookup(file_hash, model_version, threshold, local_conn)
        row = conn.execute(
            """
            SELECT * FROM safety_cache
            WHERE file_hash = ? AND model_version = ? AND threshold = ?
            LIMIT 1
            """,
            (file_hash, model_version, float(threshold)),
        ).fetchone()
        if not row:
            return None
        return {
            "sensitive": bool(row["sensitive"]),
            "score": float(row["score"]),
            "reason": str(row["reason"]),
            "engine": str(row["engine"]),
            "model_name": str(row["model_name"]),
            "labels": json.loads(row["labels_json"] or "{}"),
        }

    def safety_store(
        self,
        file_hash: str,
        model_version: str,
        threshold: float,
        assessment: Any,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        labels = getattr(assessment, "labels", {}) or {}
        if conn is None:
            with self.connect() as local_conn:
                self.safety_store(file_hash, model_version, threshold, assessment, local_conn)
            return
        conn.execute(
            """
            INSERT OR REPLACE INTO safety_cache(
                file_hash, model_version, threshold, sensitive, score, reason,
                engine, model_name, labels_json, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_hash,
                model_version,
                float(threshold),
                1 if bool(getattr(assessment, "sensitive", False)) else 0,
                float(getattr(assessment, "score", 0.0)),
                str(getattr(assessment, "reason", ""))[:1200],
                str(getattr(assessment, "engine", "")),
                str(getattr(assessment, "model_name", "")),
                json.dumps(labels, separators=(",", ":")),
                now_iso(),
            ),
        )

    def embedding_lookup(
        self,
        file_hash: str,
        model_version: str,
        detector_size: int,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]] | None:
        if conn is None:
            with self.connect() as local_conn:
                return self.embedding_lookup(file_hash, model_version, detector_size, local_conn)
        row = conn.execute(
            """
            SELECT embeddings_json FROM embedding_cache
            WHERE file_hash = ? AND model_version = ? AND detector_size = ?
            LIMIT 1
            """,
            (file_hash, model_version, int(detector_size)),
        ).fetchone()
        if not row:
            return None
        value = json.loads(row["embeddings_json"] or "[]")
        return value if isinstance(value, list) else []

    def embedding_store(
        self,
        file_hash: str,
        model_version: str,
        detector_size: int,
        embeddings: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        if conn is None:
            with self.connect() as local_conn:
                self.embedding_store(file_hash, model_version, detector_size, embeddings, local_conn)
            return
        conn.execute(
            """
            INSERT OR REPLACE INTO embedding_cache(
                file_hash, model_version, detector_size, embeddings_json, created_at
            ) VALUES(?, ?, ?, ?, ?)
            """,
            (
                file_hash,
                model_version,
                int(detector_size),
                json.dumps(embeddings, separators=(",", ":")),
                now_iso(),
            ),
        )

    def add_calibration_label(self, label_id: str, row: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO calibration_labels(
                    label_id, source_path, file_hash, expected_person, actual_person,
                    match_score, is_match, safe_label, created_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    label_id,
                    str(row.get("sourcePath", "")),
                    str(row.get("fileHash", "")),
                    str(row.get("expectedPerson", "")),
                    str(row.get("actualPerson", "")),
                    row.get("matchScore"),
                    None if row.get("isMatch") is None else (1 if bool(row.get("isMatch")) else 0),
                    str(row.get("safeLabel", "")),
                    now_iso(),
                ),
            )

    def calibration_summary(self) -> dict[str, Any]:
        with self.connect() as conn:
            total = int(conn.execute("SELECT COUNT(*) AS n FROM calibration_labels").fetchone()["n"])
            blocked = int(conn.execute("SELECT COUNT(*) AS n FROM blocked_pairs").fetchone()["n"])
            stats = conn.execute(
                """
                SELECT
                    COUNT(*) AS match_labels,
                    SUM(CASE WHEN is_match = 1 THEN 1 ELSE 0 END) AS positive_pairs,
                    SUM(CASE WHEN is_match = 0 THEN 1 ELSE 0 END) AS negative_pairs,
                    MIN(CASE WHEN is_match = 1 THEN match_score END) AS min_positive_score,
                    MAX(CASE WHEN is_match = 0 THEN match_score END) AS max_negative_score
                FROM calibration_labels
                WHERE is_match IS NOT NULL AND match_score IS NOT NULL
                """
            ).fetchone()
            safe_rows = conn.execute(
                "SELECT safe_label, COUNT(*) AS n FROM calibration_labels WHERE safe_label != '' GROUP BY safe_label"
            ).fetchall()
        match_labels = int(stats["match_labels"] or 0)
        positive_pairs = int(stats["positive_pairs"] or 0)
        negative_pairs = int(stats["negative_pairs"] or 0)
        min_pos = None if stats["min_positive_score"] is None else float(stats["min_positive_score"])
        max_neg = None if stats["max_negative_score"] is None else float(stats["max_negative_score"])
        recommended = None
        if min_pos is not None and max_neg is not None:
            recommended = max(0.0, min(1.0, (min_pos + max_neg) / 2.0))
        return {
            "totalLabels": total,
            "matchLabels": match_labels,
            "positivePairs": positive_pairs,
            "negativePairs": negative_pairs,
            "minPositiveScore": min_pos,
            "maxNegativeScore": max_neg,
            "recommendedLikelyThreshold": recommended,
            "safeLabels": {str(row["safe_label"]): int(row["n"]) for row in safe_rows},
            "falseMatchBlocks": blocked,
        }

    def add_blocked_pair(self, row: dict[str, Any]) -> None:
        file_hash = str(row.get("fileHash", "")).strip()
        person_name = str(row.get("personName", "")).strip()
        if not file_hash or not person_name:
            raise ValueError("Blocked false-match pairs require a file hash and person name.")
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO blocked_pairs(
                    file_hash, person_name, best_ref_id, source_path, note, created_at
                ) VALUES(?, ?, ?, ?, ?, ?)
                """,
                (
                    file_hash,
                    person_name.casefold(),
                    str(row.get("bestRefId", "") or ""),
                    str(row.get("sourcePath", "")),
                    str(row.get("note", ""))[:600],
                    now_iso(),
                ),
            )

    def blocked_pair_exists(
        self,
        file_hash: str,
        person_name: str,
        best_ref_id: str | None = "",
        conn: sqlite3.Connection | None = None,
    ) -> bool:
        file_hash = str(file_hash or "").strip()
        person_key = str(person_name or "").strip().casefold()
        ref_id = str(best_ref_id or "")
        if not file_hash or not person_key:
            return False
        if conn is None:
            with self.connect() as local_conn:
                return self.blocked_pair_exists(file_hash, person_key, ref_id, local_conn)
        row = conn.execute(
            """
            SELECT 1 FROM blocked_pairs
            WHERE file_hash = ? AND person_name = ? AND best_ref_id = ?
            LIMIT 1
            """,
            (file_hash, person_key, ref_id),
        ).fetchone()
        return bool(row)

    def blocked_pairs_summary(self, limit: int = 20) -> dict[str, Any]:
        with self.connect() as conn:
            total = int(conn.execute("SELECT COUNT(*) AS n FROM blocked_pairs").fetchone()["n"])
            rows = conn.execute(
                """
                SELECT file_hash, person_name, best_ref_id, source_path, note, created_at
                FROM blocked_pairs
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max(0, int(limit)),),
            ).fetchall()
        return {
            "total": total,
            "recent": [dict(row) for row in rows],
        }

    def add_benchmark_run(self, run_id: str, payload: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO benchmark_runs(run_id, generated_at, payload_json) VALUES(?, ?, ?)",
                (run_id, now_iso(), json.dumps(payload, separators=(",", ":"))),
            )

    def recent_benchmark_runs(self, limit: int = 8) -> list[dict[str, Any]]:
        limit = max(1, min(50, int(limit)))
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT run_id, generated_at, payload_json
                FROM benchmark_runs
                ORDER BY generated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        history: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except json.JSONDecodeError:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            payload.setdefault("runId", row["run_id"])
            payload.setdefault("generatedAt", row["generated_at"])
            history.append(payload)
        return history

    def clear_private_data(self, include_scan_history: bool = True) -> dict[str, int]:
        tables = ["safety_cache", "embedding_cache", "calibration_labels", "blocked_pairs", "review_candidates"]
        if include_scan_history:
            tables.extend(["scan_files", "scan_runs"])
        deleted: dict[str, int] = {}
        with self.connect() as conn:
            for table in tables:
                cursor = conn.execute(f"DELETE FROM {table}")
                deleted[table] = int(cursor.rowcount if cursor.rowcount is not None else 0)
        return deleted

    def prune_scan_manifests(self, keep_runs: int = 20) -> dict[str, int]:
        keep_runs = max(1, min(1000, int(keep_runs)))
        with self.connect() as conn:
            before_runs = int(conn.execute("SELECT COUNT(*) AS n FROM scan_runs").fetchone()["n"])
            before_files = int(conn.execute("SELECT COUNT(*) AS n FROM scan_files").fetchone()["n"])
            rows = conn.execute(
                """
                SELECT run_id FROM scan_runs
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
                """,
                (keep_runs,),
            ).fetchall()
            run_ids = [str(row["run_id"]) for row in rows]
            deleted_files = 0
            deleted_runs = 0
            for run_id in run_ids:
                file_cursor = conn.execute("DELETE FROM scan_files WHERE run_id = ?", (run_id,))
                deleted_files += int(file_cursor.rowcount if file_cursor.rowcount is not None else 0)
                run_cursor = conn.execute("DELETE FROM scan_runs WHERE run_id = ?", (run_id,))
                deleted_runs += int(run_cursor.rowcount if run_cursor.rowcount is not None else 0)
            after_runs = int(conn.execute("SELECT COUNT(*) AS n FROM scan_runs").fetchone()["n"])
            after_files = int(conn.execute("SELECT COUNT(*) AS n FROM scan_files").fetchone()["n"])
        return {
            "keepRuns": keep_runs,
            "runsBefore": before_runs,
            "filesBefore": before_files,
            "runsDeleted": deleted_runs,
            "filesDeleted": deleted_files,
            "runsAfter": after_runs,
            "filesAfter": after_files,
        }

    def optimize(self) -> dict[str, int]:
        before = os.path.getsize(self.path) if self.path.exists() else 0
        wal_path = Path(str(self.path) + "-wal")
        shm_path = Path(str(self.path) + "-shm")
        before_wal = os.path.getsize(wal_path) if wal_path.exists() else 0
        before_shm = os.path.getsize(shm_path) if shm_path.exists() else 0
        with self.connect() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.execute("VACUUM")
        after = os.path.getsize(self.path) if self.path.exists() else 0
        after_wal = os.path.getsize(wal_path) if wal_path.exists() else 0
        after_shm = os.path.getsize(shm_path) if shm_path.exists() else 0
        return {
            "dbBytesBefore": before + before_wal + before_shm,
            "dbBytesAfter": after + after_wal + after_shm,
            "dbBytesReclaimed": max(0, before + before_wal + before_shm - after - after_wal - after_shm),
        }

    def integrity_report(self) -> dict[str, Any]:
        wal_path = Path(str(self.path) + "-wal")
        shm_path = Path(str(self.path) + "-shm")
        result: dict[str, Any] = {
            "generatedAt": now_iso(),
            "path": str(self.path),
            "exists": self.path.exists(),
            "ok": False,
            "integrity": [],
            "foreignKeyErrors": [],
            "tableCounts": {},
            "dbBytes": os.path.getsize(self.path) if self.path.exists() else 0,
            "walBytes": os.path.getsize(wal_path) if wal_path.exists() else 0,
            "shmBytes": os.path.getsize(shm_path) if shm_path.exists() else 0,
            "error": "",
        }
        try:
            with self.connect() as conn:
                integrity_rows = [str(row[0]) for row in conn.execute("PRAGMA integrity_check").fetchall()]
                fk_rows = [dict(row) for row in conn.execute("PRAGMA foreign_key_check").fetchall()]
                counts: dict[str, int] = {}
                for table in (
                    "scan_runs",
                    "scan_files",
                    "safety_cache",
                    "embedding_cache",
                    "calibration_labels",
                    "blocked_pairs",
                    "benchmark_runs",
                    "review_candidates",
                ):
                    try:
                        counts[table] = int(conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"])
                    except sqlite3.Error:
                        counts[table] = -1
                result["integrity"] = integrity_rows
                result["foreignKeyErrors"] = fk_rows[:50]
                result["tableCounts"] = counts
                result["ok"] = integrity_rows == ["ok"] and not fk_rows and all(value >= 0 for value in counts.values())
        except sqlite3.Error as exc:
            result["error"] = str(exc)
        return result

    def snapshot_files(self, reason: str = "repair") -> dict[str, Any]:
        stamp = now_iso().replace(":", "").replace("-", "").replace("Z", "")
        safe_reason = "".join(character if character.isalnum() or character in {"-", "_"} else "-" for character in reason)[:48] or "snapshot"
        backup_dir = self.path.parent / "db-backups" / f"{stamp}-{safe_reason}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        copied: list[dict[str, Any]] = []
        for source in (self.path, Path(str(self.path) + "-wal"), Path(str(self.path) + "-shm")):
            if not source.exists():
                continue
            target = backup_dir / source.name
            shutil.copy2(source, target)
            copied.append({"from": str(source), "to": str(target), "bytes": target.stat().st_size})
        return {
            "generatedAt": now_iso(),
            "backupDir": str(backup_dir),
            "files": copied,
            "bytes": sum(int(item["bytes"]) for item in copied),
        }

    def rebuild_empty(self) -> None:
        for source in (self.path, Path(str(self.path) + "-wal"), Path(str(self.path) + "-shm")):
            try:
                source.unlink()
            except OSError:
                pass
        self._init_schema()

    def scale_summary(self) -> dict[str, Any]:
        with self.connect() as conn:
            scan_files = int(conn.execute("SELECT COUNT(*) AS n FROM scan_files").fetchone()["n"])
            scan_runs = int(conn.execute("SELECT COUNT(*) AS n FROM scan_runs").fetchone()["n"])
            safety_cache = int(conn.execute("SELECT COUNT(*) AS n FROM safety_cache").fetchone()["n"])
            embedding_cache = int(conn.execute("SELECT COUNT(*) AS n FROM embedding_cache").fetchone()["n"])
            calibration = int(conn.execute("SELECT COUNT(*) AS n FROM calibration_labels").fetchone()["n"])
            review_candidates = int(conn.execute("SELECT COUNT(*) AS n FROM review_candidates").fetchone()["n"])
            latest = conn.execute(
                "SELECT * FROM scan_runs ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
        try:
            db_bytes = os.path.getsize(self.path)
        except OSError:
            db_bytes = 0
        return {
            "dbPath": str(self.path),
            "dbBytes": db_bytes,
            "scanRuns": scan_runs,
            "manifestFiles": scan_files,
            "safetyCacheEntries": safety_cache,
            "embeddingCacheEntries": embedding_cache,
            "calibrationLabels": calibration,
            "reviewCandidateRows": review_candidates,
            "latestScan": dict(latest) if latest else None,
        }
