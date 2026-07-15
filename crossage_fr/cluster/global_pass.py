"""Connection-local spool for one globally consistent unmatched-face cluster pass."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator

import numpy as np

from .clusterer import cluster_vectors


GLOBAL_CLUSTER_VERSION = "global-cosine-knn-v1"
_TABLE = "unmatched_cluster_spool"
_PAGE_SIZE = 500


@dataclass(frozen=True)
class UnmatchedClusterGroup:
    model_name: str
    vector_dim: int
    rows: int
    unique_rows: int


@dataclass(frozen=True)
class UnmatchedClusterRow:
    path: Path
    quality: float
    model_name: str
    metadata: dict[str, Any]
    stable_key: str


@dataclass(frozen=True)
class ClusteredUnmatchedGroup:
    group: UnmatchedClusterGroup
    assignments: dict[str, str | None]
    components: int
    noise_unique: int


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def stable_unmatched_key(
    path: Path,
    model_name: str,
    vector: np.ndarray,
    metadata: dict[str, Any],
    bbox: tuple[int, int, int, int] | None = None,
) -> str:
    """Return an order-independent identity for one unmatched face observation."""
    values = np.ascontiguousarray(vector, dtype="<f4")
    source_hash = str(metadata.get("source_hash") or "").strip().lower()
    source_identity = f"sha256:{source_hash}" if source_hash else f"path:{path.expanduser()}"
    payload = {
        "bbox": [int(value) for value in (bbox or ())],
        "dimension": int(values.size),
        "mediaKind": str(metadata.get("media_kind") or "image"),
        "model": str(model_name),
        "source": source_identity,
        "trackId": str(metadata.get("video_track_id") or ""),
        "vectorSha256": hashlib.sha256(values.tobytes(order="C")).hexdigest(),
        "version": GLOBAL_CLUSTER_VERSION,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def stable_cluster_name(model_name: str, vector_dim: int, member_keys: list[str]) -> str:
    """Name a component from its model space and members, never an ordinal."""
    payload = {
        "dimension": int(vector_dim),
        "members": sorted(set(member_keys)),
        "model": str(model_name),
        "version": GLOBAL_CLUSTER_VERSION,
    }
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()[:16]
    return f"Unmatched cluster {digest}"


class GlobalUnmatchedSpool:
    """Store unmatched vectors in a SQLite TEMP table until the terminal pass.

    The table belongs to the scan connection and is explicitly dropped on close.
    SQLite's FILE temp-store mode keeps the growing vector set out of Python heap
    while preserving crash cleanup when the connection disappears.
    """

    def __init__(self, conn: sqlite3.Connection, run_id: str):
        self.conn = conn
        self.run_id = str(run_id)
        self.count = 0
        self.peak_count = 0
        self._closed = False
        self.conn.execute("PRAGMA temp_store=FILE")
        self.conn.execute(
            f"""
            CREATE TEMP TABLE IF NOT EXISTS {_TABLE} (
                row_id INTEGER PRIMARY KEY,
                run_id TEXT NOT NULL,
                path TEXT NOT NULL,
                quality REAL NOT NULL,
                model_name TEXT NOT NULL,
                vector_dim INTEGER NOT NULL,
                vector_blob BLOB NOT NULL,
                metadata_json TEXT NOT NULL,
                stable_key TEXT NOT NULL
            )
            """
        )
        self.conn.execute(
            f"CREATE INDEX IF NOT EXISTS temp.idx_{_TABLE}_group "
            f"ON {_TABLE}(run_id, model_name, vector_dim, stable_key, row_id)"
        )

    def add(
        self,
        path: Path,
        quality: float,
        model_name: str,
        vector: list[float] | np.ndarray,
        metadata: dict[str, Any],
        bbox: tuple[int, int, int, int] | None = None,
    ) -> str:
        if self._closed:
            raise RuntimeError("The unmatched clustering spool is closed.")
        values = np.asarray(vector, dtype="float32")
        if values.ndim != 1 or values.size == 0 or not np.all(np.isfinite(values)):
            raise ValueError("Unmatched embeddings must be a finite one-dimensional vector.")
        quality_value = float(quality)
        if not np.isfinite(quality_value):
            raise ValueError("Unmatched embedding quality must be finite.")
        values = np.ascontiguousarray(values, dtype="<f4")
        metadata_json = _canonical_json(metadata)
        stable_key = stable_unmatched_key(path, model_name, values, metadata, bbox)
        self.conn.execute(
            f"""
            INSERT INTO {_TABLE}(
                run_id, path, quality, model_name, vector_dim,
                vector_blob, metadata_json, stable_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.run_id,
                str(path),
                quality_value,
                str(model_name),
                int(values.size),
                sqlite3.Binary(values.tobytes(order="C")),
                metadata_json,
                stable_key,
            ),
        )
        self.count += 1
        self.peak_count = max(self.peak_count, self.count)
        return stable_key

    def groups(self) -> list[UnmatchedClusterGroup]:
        rows = self.conn.execute(
            f"""
            SELECT model_name, vector_dim, COUNT(*) AS rows,
                   COUNT(DISTINCT stable_key) AS unique_rows
            FROM {_TABLE}
            WHERE run_id = ?
            GROUP BY model_name, vector_dim
            ORDER BY model_name, vector_dim
            """,
            (self.run_id,),
        ).fetchall()
        return [
            UnmatchedClusterGroup(
                model_name=str(row[0]),
                vector_dim=int(row[1]),
                rows=int(row[2]),
                unique_rows=int(row[3]),
            )
            for row in rows
        ]

    def cluster_group(self, group: UnmatchedClusterGroup, min_cluster_size: int) -> ClusteredUnmatchedGroup:
        rows = self.conn.execute(
            f"""
            SELECT stable_key, vector_blob
            FROM {_TABLE}
            WHERE run_id = ? AND model_name = ? AND vector_dim = ?
            GROUP BY stable_key
            ORDER BY stable_key
            """,
            (self.run_id, group.model_name, group.vector_dim),
        ).fetchall()
        stable_keys = [str(row[0]) for row in rows]
        vectors = np.empty((len(rows), group.vector_dim), dtype="float32")
        for index, row in enumerate(rows):
            vector = np.frombuffer(row[1], dtype="<f4")
            if vector.size != group.vector_dim:
                raise ValueError("Unmatched clustering spool contains a malformed vector.")
            vectors[index] = vector
        labels = cluster_vectors(vectors, min_cluster_size)
        component_members: dict[int, list[str]] = {}
        for stable_key, label in zip(stable_keys, labels):
            if label >= 0:
                component_members.setdefault(int(label), []).append(stable_key)
        component_names = {
            label: stable_cluster_name(group.model_name, group.vector_dim, members)
            for label, members in component_members.items()
        }
        assignments = {
            stable_key: component_names.get(int(label)) if label >= 0 else None
            for stable_key, label in zip(stable_keys, labels)
        }
        return ClusteredUnmatchedGroup(
            group=group,
            assignments=assignments,
            components=len(component_names),
            noise_unique=sum(1 for label in labels if label < 0),
        )

    def iter_rows(self, group: UnmatchedClusterGroup) -> Iterator[UnmatchedClusterRow]:
        last_key = ""
        last_row_id = 0
        while True:
            rows = self.conn.execute(
                f"""
                SELECT row_id, path, quality, model_name, metadata_json, stable_key
                FROM {_TABLE}
                WHERE run_id = ? AND model_name = ? AND vector_dim = ?
                  AND (stable_key > ? OR (stable_key = ? AND row_id > ?))
                ORDER BY stable_key, row_id
                LIMIT ?
                """,
                (
                    self.run_id,
                    group.model_name,
                    group.vector_dim,
                    last_key,
                    last_key,
                    last_row_id,
                    _PAGE_SIZE,
                ),
            ).fetchall()
            if not rows:
                return
            for row in rows:
                last_row_id = int(row[0])
                last_key = str(row[5])
                metadata = json.loads(str(row[4]))
                if not isinstance(metadata, dict):
                    raise ValueError("Unmatched clustering spool contains malformed metadata.")
                yield UnmatchedClusterRow(
                    path=Path(str(row[1])),
                    quality=float(row[2]),
                    model_name=str(row[3]),
                    metadata=metadata,
                    stable_key=last_key,
                )

    def close(self) -> None:
        if self._closed:
            return
        self.conn.execute(f"DELETE FROM {_TABLE} WHERE run_id = ?", (self.run_id,))
        if self.conn.execute(f"SELECT 1 FROM {_TABLE} LIMIT 1").fetchone() is None:
            self.conn.execute(f"DROP TABLE IF EXISTS temp.{_TABLE}")
        self._closed = True
        self.count = 0

    def __enter__(self) -> GlobalUnmatchedSpool:
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
        self.close()
