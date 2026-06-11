from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from collections import deque
from collections.abc import Iterable
from contextlib import contextmanager
import csv
import hashlib
import json
import math
import os
import shutil
import sqlite3
import time
import zipfile
from typing import Callable, Any

from crossage_fr.config import archive_corrupt_file, load_config, save_config
from crossage_fr.cluster import cluster_vectors
from crossage_fr.embed import EmbeddingEngine
from crossage_fr.ingest import ImageLoadError, VideoLoadError, image_record_for_path, iter_image_paths, load_image, sample_video_frames
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, needs_browser_preview, sha256_file, write_preview_image
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS
from crossage_fr.ingest.safety import SafetyAssessment, assess_image_safety, safety_model_report
from crossage_fr.match import group_hits
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate, new_id
from crossage_fr.storage import safe_is_mount, safe_resolve
from crossage_fr.store import VectorStore
from crossage_fr.store.workspace_db import WorkspaceDb, path_signature
from crossage_fr.workspace_registry import ensure_workspace_metadata, now_iso, write_active_workspace


ScanProgress = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class ScanDiscoveryError:
    path: Path
    error: str
    fatal: bool = False


class FileChangedDuringScanError(OSError):
    pass

try:
    UNMATCHED_CLUSTER_BATCH_SIZE = max(100, int(os.environ.get("CROSSAGE_UNMATCHED_CLUSTER_BATCH_SIZE", "1000")))
except ValueError:
    UNMATCHED_CLUSTER_BATCH_SIZE = 1000

try:
    SCAN_DB_COMMIT_INTERVAL = max(25, int(os.environ.get("CROSSAGE_SCAN_DB_COMMIT_INTERVAL", "250")))
except ValueError:
    SCAN_DB_COMMIT_INTERVAL = 250

try:
    SCAN_RUN_UPDATE_INTERVAL = max(10, int(os.environ.get("CROSSAGE_SCAN_RUN_UPDATE_INTERVAL", "50")))
except ValueError:
    SCAN_RUN_UPDATE_INTERVAL = 50

try:
    SCAN_STATE_CHECKPOINT_INTERVAL = max(100, int(os.environ.get("CROSSAGE_SCAN_STATE_CHECKPOINT_INTERVAL", "1000")))
except ValueError:
    SCAN_STATE_CHECKPOINT_INTERVAL = 1000

try:
    SCAN_STATE_CHECKPOINT_SECONDS = max(5.0, float(os.environ.get("CROSSAGE_SCAN_STATE_CHECKPOINT_SECONDS", "20")))
except ValueError:
    SCAN_STATE_CHECKPOINT_SECONDS = 20.0

try:
    CANDIDATE_JSON_SNAPSHOT_LIMIT = max(0, int(os.environ.get("CROSSAGE_CANDIDATE_JSON_SNAPSHOT_LIMIT", "50000")))
except ValueError:
    CANDIDATE_JSON_SNAPSHOT_LIMIT = 50_000

try:
    CANDIDATE_MEMORY_DEDUPE_LIMIT = max(1000, int(os.environ.get("CROSSAGE_CANDIDATE_MEMORY_DEDUPE_LIMIT", "100000")))
except ValueError:
    CANDIDATE_MEMORY_DEDUPE_LIMIT = 100_000

try:
    VIDEO_REVIEW_CANDIDATES_PER_SOURCE = max(1, int(os.environ.get("CROSSAGE_VIDEO_REVIEW_CANDIDATES_PER_SOURCE", "12")))
except ValueError:
    VIDEO_REVIEW_CANDIDATES_PER_SOURCE = 12


def _format_ms(value: int | None) -> str:
    total = max(0, int(value or 0)) // 1000
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def _video_note(metadata: dict[str, Any]) -> str:
    if metadata.get("media_kind") != "video":
        return ""
    timestamp = _format_ms(metadata.get("video_timestamp_ms"))
    duration = _format_ms(metadata.get("video_duration_ms"))
    return f"Video moment at {timestamp}" + (f" of {duration}." if duration != "00:00" else ".")


class ProjectState:
    def __init__(self, root: Path, actor: str = "backend"):
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock_path = self.root / ".state.lock"
        self.config_path = self.root / "config.json"
        self.consent_path = self.root / "consent.json"
        self.refs_path = self.root / "references.json"
        self.candidates_path = self.root / "review_candidates.json"
        self.scan_history_path = self.root / "scan_history.json"
        self.audit_path = self.root / "audit_log.jsonl"
        self.cancel_scan_path = self.root / ".scan-cancel"
        self.pause_scan_path = self.root / ".scan-pause"
        self.previews_path = self.root / "previews"
        self.video_frames_path = self.root / "video-frames"
        self.db = WorkspaceDb(self.root / "workspace.sqlite3")
        self.workspace_metadata = ensure_workspace_metadata(self.root, actor=actor)
        write_active_workspace(self.root, actor=actor, metadata=self.workspace_metadata)
        self.config = load_config(self.config_path)
        self.consent: dict[str, Any] = {}
        self.references: dict[str, ReferenceFace] = {}
        self.candidates: dict[str, ReviewCandidate] = {}
        self.scan_history: list[dict[str, Any]] = []
        self.vector_store = VectorStore()
        self._excluded_file_paths_cache_key: tuple[str, ...] = ()
        self._excluded_file_paths_cache: set[str] = set()
        self._exclusion_cache_key: tuple[Any, ...] = ()
        self._excluded_dir_names_cache: set[str] = set()
        self._excluded_extensions_cache: set[str] = set()
        self._excluded_keywords_cache: tuple[tuple[str, str], ...] = ()
        self._candidate_dirty_ids: set[str] = set()
        self._candidate_deleted_ids: set[str] = set()
        self.load()
        self._ensure_generated_dir_sentinel(self.previews_path)
        self._ensure_generated_dir_sentinel(self.video_frames_path)

    def _generated_dir_sentinel(self, path: Path) -> Path:
        return path / ".vintrace-generated.json"

    def _ensure_generated_dir_sentinel(self, path: Path) -> None:
        try:
            if path.exists() and (path.is_symlink() or safe_is_mount(path)):
                return
            path.mkdir(parents=True, exist_ok=True)
            sentinel = self._generated_dir_sentinel(path)
            if not sentinel.exists():
                sentinel.write_text(
                    json.dumps(
                        {
                            "schemaVersion": 1,
                            "workspaceId": self.workspace_metadata.get("workspaceId", ""),
                            "kind": path.name,
                            "createdAt": now_iso(),
                        },
                        indent=2,
                        sort_keys=True,
                    ),
                    encoding="utf-8",
                )
        except OSError:
            return

    def _generated_dir_is_owned(self, path: Path) -> bool:
        try:
            if path.is_symlink() or safe_is_mount(path):
                return False
            sentinel = self._generated_dir_sentinel(path)
            payload = json.loads(sentinel.read_text(encoding="utf-8"))
            return (
                isinstance(payload, dict)
                and str(payload.get("workspaceId", "")) == str(self.workspace_metadata.get("workspaceId", ""))
                and str(payload.get("kind", "")) == path.name
            )
        except (OSError, json.JSONDecodeError):
            return False

    def load(self) -> None:
        self.references.clear()
        self.candidates.clear()
        self.scan_history.clear()
        self.consent = self._read_json_object(self.consent_path)
        if self.refs_path.exists():
            for row in self._read_json_array(self.refs_path):
                try:
                    ref = ReferenceFace(**row)
                except TypeError:
                    continue
                if not self._valid_reference(ref):
                    continue
                self.references[ref.ref_id] = ref
        if self.candidates_path.exists():
            for row in self._read_json_array(self.candidates_path):
                try:
                    candidate = ReviewCandidate(**row)
                except TypeError:
                    continue
                if not self._valid_candidate(candidate):
                    continue
                self.candidates[candidate.candidate_id] = candidate
        try:
            indexed_candidates = self.db.candidate_count()
        except sqlite3.Error:
            indexed_candidates = 0
        if indexed_candidates > len(self.candidates):
            loaded_from_index: dict[str, ReviewCandidate] = {}
            try:
                for row in self.db.iter_candidate_payloads():
                    try:
                        candidate = ReviewCandidate(**row)
                    except TypeError:
                        continue
                    if not self._valid_candidate(candidate):
                        continue
                    loaded_from_index[candidate.candidate_id] = candidate
            except sqlite3.Error:
                loaded_from_index = {}
            if len(loaded_from_index) > len(self.candidates):
                self.candidates = loaded_from_index
        if self.scan_history_path.exists():
            self.scan_history.extend(self._read_json_array(self.scan_history_path)[:80])
        self.vector_store.rebuild({ref_id: ref.vector for ref_id, ref in self.references.items()})
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        self._ensure_candidate_index()

    def save(self, snapshot_candidates: bool = True) -> None:
        with self._state_lock():
            self.root.mkdir(parents=True, exist_ok=True)
            save_config(self.config, self.config_path)
            self._write_json_atomic(self.consent_path, self.consent)
            refs = [asdict(ref) for ref in self.references.values()]
            self._write_json_atomic(self.refs_path, refs)
            self._flush_candidate_index()
            if snapshot_candidates and len(self.candidates) <= CANDIDATE_JSON_SNAPSHOT_LIMIT:
                self._write_json_array_atomic(self.candidates_path, (asdict(candidate) for candidate in self.candidates.values()))
            self._write_json_atomic(self.scan_history_path, self.scan_history[:80])

    def _ensure_candidate_index(self) -> None:
        try:
            if self.db.candidate_count() != len(self.candidates):
                self.db.replace_candidates(self.candidates.values())
        except sqlite3.Error:
            pass

    def candidate_index_ready(self, scale: dict[str, Any] | None = None) -> bool:
        try:
            indexed = int((scale or {}).get("reviewCandidateRows", -1)) if scale is not None else self.db.candidate_count()
        except (sqlite3.Error, TypeError, ValueError):
            return False
        return indexed == len(self.candidates)

    def _mark_candidate_dirty(self, candidate_id: str | None) -> None:
        if not candidate_id:
            return
        self._candidate_deleted_ids.discard(candidate_id)
        self._candidate_dirty_ids.add(candidate_id)

    def _mark_candidates_dirty(self, candidate_ids: Iterable[str]) -> None:
        for candidate_id in candidate_ids:
            self._mark_candidate_dirty(candidate_id)

    def _mark_candidate_deleted(self, candidate_id: str | None) -> None:
        if not candidate_id:
            return
        self._candidate_dirty_ids.discard(candidate_id)
        self._candidate_deleted_ids.add(candidate_id)

    def _mark_candidates_deleted(self, candidate_ids: Iterable[str]) -> None:
        for candidate_id in candidate_ids:
            self._mark_candidate_deleted(candidate_id)

    def _mark_all_candidates_dirty(self) -> None:
        self._mark_candidates_dirty(self.candidates.keys())

    def _flush_candidate_index(self) -> None:
        try:
            if self._candidate_deleted_ids:
                self.db.delete_candidates(self._candidate_deleted_ids)
                self._candidate_deleted_ids.clear()
            if self._candidate_dirty_ids:
                rows = [
                    self.candidates[candidate_id]
                    for candidate_id in self._candidate_dirty_ids
                    if candidate_id in self.candidates
                ]
                self.db.upsert_candidates(rows)
                self._candidate_dirty_ids.clear()
            elif self.db.candidate_count() != len(self.candidates):
                self.db.replace_candidates(self.candidates.values())
        except sqlite3.Error:
            pass

    def consent_on_file(self) -> bool:
        return bool(self.consent.get("active"))

    def consent_summary(self) -> dict[str, Any]:
        return {
            "active": self.consent_on_file(),
            "operator": str(self.consent.get("operator", "")),
            "source": str(self.consent.get("source", "")),
            "scope": str(self.consent.get("scope", self.root)),
            "confirmedAt": self.consent.get("confirmedAt"),
            "updatedAt": self.consent.get("updatedAt"),
        }

    def set_consent(
        self,
        value: bool,
        source: str = "desktop",
        operator: str = "",
        note: str = "",
        scope: str = "",
    ) -> None:
        timestamp = now_iso()
        previous = self.consent_on_file()
        if value:
            self.consent = {
                "schemaVersion": 1,
                "active": True,
                "workspaceId": self.workspace_metadata.get("workspaceId"),
                "source": source,
                "operator": operator[:120],
                "scope": (scope or str(self.root))[:600],
                "note": note[:800],
                "confirmedAt": self.consent.get("confirmedAt") or timestamp,
                "updatedAt": timestamp,
            }
        else:
            self.consent = {
                **self.consent,
                "schemaVersion": 1,
                "active": False,
                "source": source,
                "operator": operator[:120],
                "scope": (scope or str(self.root))[:600],
                "note": note[:800],
                "updatedAt": timestamp,
            }
        self._append_audit(
            {
                "action": "set_consent",
                "value": bool(value),
                "previous": previous,
                "source": source,
                "operator": operator[:120],
                "scope": (scope or str(self.root))[:600],
                "note": note[:800],
            }
        )
        self.save()

    def enroll_folder(
        self,
        person_name: str,
        age_bucket: str,
        folder: Path,
        engine: EmbeddingEngine,
    ) -> tuple[int, list[str]]:
        person_name = person_name.strip()
        if not person_name:
            raise ValueError("A person name is required for enrollment.")
        added = 0
        errors: list[str] = []
        known_hashes = {ref.source_hash or self._path_key(ref.source_path) for ref in self.references.values()}
        for path in iter_image_paths(folder):
            try:
                source_hash = sha256_file(path)
                if source_hash in known_hashes:
                    continue
                image = load_image(path)
                record = image_record_for_path(path, image=image, sha256=source_hash)
                embeddings = engine.embed_loaded_image(image, path)
                for embedding in embeddings:
                    if embedding.quality < self.config.thresholds.quality_min:
                        continue
                    ref = ReferenceFace(
                        ref_id=new_id("ref"),
                        person_name=person_name,
                        age_bucket=age_bucket,
                        source_path=str(path),
                        capture_date=record.capture_date,
                        quality=embedding.quality,
                        model_name=embedding.model_name,
                        vector=embedding.vector,
                        source_hash=record.sha256,
                    )
                    self.references[ref.ref_id] = ref
                    self.vector_store.add(ref.ref_id, ref.vector)
                    added += 1
                known_hashes.add(record.sha256)
            except (ImageLoadError, OSError, ValueError) as exc:
                errors.append(f"{path.name}: {exc}")
        self._append_audit(
            {
                "action": "enroll_folder",
                "person_name": person_name,
                "age_bucket": age_bucket,
                "folder": str(folder.expanduser()),
                "added": added,
                "errors": len(errors),
            }
        )
        self.save()
        return added, errors

    def enroll_age_groups(
        self,
        person_name: str,
        groups: list[dict[str, str]],
        engine: EmbeddingEngine,
    ) -> tuple[int, list[str], int]:
        person_name = person_name.strip()
        if not person_name:
            raise ValueError("A person name is required for enrollment.")
        selected = [
            (str(group.get("ageBucket", "unknown")), Path(str(group.get("folder", ""))).expanduser())
            for group in groups
            if isinstance(group, dict)
            if str(group.get("folder", "")).strip()
        ]
        if not selected:
            raise ValueError("Add at least one age-group folder.")
        total_added = 0
        errors: list[str] = []
        enrolled_groups = 0
        for age_bucket, folder in selected:
            added, group_errors = self.enroll_folder(person_name, age_bucket, folder, engine)
            total_added += added
            if added:
                enrolled_groups += 1
            errors.extend(f"{age_bucket}: {error}" for error in group_errors)
        self._append_audit(
            {
                "action": "enroll_age_groups",
                "person_name": person_name,
                "groups": enrolled_groups,
                "added": total_added,
                "errors": len(errors),
            }
        )
        return total_added, errors, enrolled_groups

    def scan_folder(
        self,
        folder: Path,
        engine: EmbeddingEngine,
        k: int = 20,
        on_progress: ScanProgress | None = None,
        source: str = "manual",
        resume: bool = True,
        total: int | None = None,
    ) -> tuple[int, list[str], dict[str, int]]:
        return self.scan_paths(
            self._iter_media_paths(folder),
            engine,
            k=k,
            on_progress=on_progress,
            source=source,
            label=str(safe_resolve(folder)),
            total=total,
            resume=resume,
            root_path=str(safe_resolve(folder)),
        )

    def scan_paths(
        self,
        paths: Iterable[Path | ScanDiscoveryError],
        engine: EmbeddingEngine,
        k: int = 20,
        on_progress: ScanProgress | None = None,
        source: str = "manual",
        label: str = "",
        total: int | None = None,
        resume: bool = False,
        root_path: str = "",
    ) -> tuple[int, list[str], dict[str, int]]:
        started_at = datetime.utcnow()
        paths_len_known = False
        if total is None:
            try:
                total = len(paths)
                paths_len_known = True
            except TypeError:
                total = 0
        else:
            paths_len_known = True
        label = label or f"{total} selected file(s)"
        root_path = root_path or label
        run_id = new_id("scan")
        resume_run_id = self.db.latest_scan_run(label, source, root_path) if resume else None
        self.clear_scan_cancel()
        self.clear_scan_pause()
        self.db.create_scan_run(run_id, label, source, root_path, int(total or 0))
        added = 0
        errors: list[str] = []
        unmatched: list[tuple[Path, float, str, list[float], dict[str, Any]]] = []
        large_candidate_store = len(self.candidates) > CANDIDATE_MEMORY_DEDUPE_LIMIT and self.candidate_index_ready()
        existing = set() if large_candidate_store else {self._candidate_existing_key(candidate) for candidate in self.candidates.values()}
        retained_video_frame_paths: set[Path] = set()
        video_candidate_counts: dict[str, int] = {}
        for candidate in self.candidates.values():
            if candidate.media_kind == "video" and candidate.media_source_path:
                video_candidate_counts[candidate.media_source_path] = video_candidate_counts.get(candidate.media_source_path, 0) + 1
                try:
                    frame_path = safe_resolve(Path(candidate.source_path))
                    if self.video_frames_path in frame_path.parents:
                        retained_video_frame_paths.add(frame_path)
                except (OSError, RuntimeError):
                    pass
        generated_video_frame_paths: set[Path] = set()
        cluster_label_offset = 0
        metrics = {
            "total": int(total or 0),
            "processed": 0,
            "added": 0,
            "matched": 0,
            "clustered": 0,
            "skipped": 0,
            "errors": 0,
            "unmatched": 0,
            "safeFiltered": 0,
            "videoFiles": 0,
            "videoFrames": 0,
            "videoProtected": 0,
            "cancelled": 0,
            "pausedSeconds": 0,
            "resumed": 1 if resume_run_id else 0,
            "manifestSkipped": 0,
            "embeddingCacheHits": 0,
            "embeddingCacheMisses": 0,
            "twoPassVerified": 0,
            "twoPassChanged": 0,
            "excluded": 0,
            "pathErrors": 0,
        }
        scan_conn: sqlite3.Connection | None = None

        def candidate_key_exists(key: tuple[str, str | None, str]) -> bool:
            if key in existing:
                return True
            if not large_candidate_store:
                return False
            try:
                return self.db.candidate_key_exists(key[0], key[1], key[2], scan_conn)
            except sqlite3.Error:
                return False

        def remember_candidate_key(key: tuple[str, str | None, str]) -> None:
            existing.add(key)

        def ensure_stable_signature(path: Path, before: dict[str, Any]) -> None:
            after = path_signature(path)
            if int(after.get("size", -1)) != int(before.get("size", -2)) or int(after.get("mtimeNs", -1)) != int(before.get("mtimeNs", -2)):
                raise FileChangedDuringScanError("File changed while it was being scanned; it will be retried on the next scan.")

        def ensure_not_cancelled() -> None:
            if self.scan_cancel_requested():
                raise InterruptedError("Scan cancelled. Resume will skip completed files.")

        def flush_unmatched(force: bool = False) -> None:
            nonlocal added, cluster_label_offset, unmatched
            flush_size = max(UNMATCHED_CLUSTER_BATCH_SIZE, int(self.config.cluster_min_size))
            if not unmatched or (not force and len(unmatched) < flush_size):
                return
            self._emit_scan_progress(on_progress, "clustering", metrics)
            batch = unmatched
            unmatched = []
            labels = cluster_vectors([row[3] for row in batch], self.config.cluster_min_size)
            max_label = max(labels, default=-1)
            for (path, quality, model_name, _vector, metadata), label in zip(batch, labels):
                if label < 0:
                    self._record_manifest_file(run_id, path, "completed", "unmatched", "", scan_conn)
                    continue
                person_name = f"Unmatched cluster {cluster_label_offset + label + 1}"
                key = (self._candidate_dedupe_source(path, metadata), None, person_name)
                if candidate_key_exists(key):
                    self._record_manifest_file(run_id, path, "completed", "duplicate", "", scan_conn)
                    continue
                if not video_candidate_allowed(metadata):
                    metrics["skipped"] += 1
                    self._record_manifest_file(run_id, path, "completed", "video_candidate_cap", "", scan_conn)
                    continue
                candidate = ReviewCandidate(
                    candidate_id=new_id("cand"),
                    source_path=str(path),
                    person_name=person_name,
                    best_ref_id=None,
                    best_ref_path=None,
                    score=0.0,
                    band="clustered review",
                    quality=quality,
                    model_name=model_name,
                    note=_video_note(metadata) or "Grouped with visually similar unmatched media for manual triage.",
                    **metadata,
                )
                self.candidates[candidate.candidate_id] = candidate
                self._mark_candidate_dirty(candidate.candidate_id)
                try:
                    frame_path = safe_resolve(path)
                    if self.video_frames_path in frame_path.parents:
                        retained_video_frame_paths.add(frame_path)
                except (OSError, RuntimeError):
                    pass
                remember_candidate_key(key)
                note_video_candidate(metadata)
                added += 1
                metrics["added"] = added
                metrics["clustered"] += 1
                self._emit_scan_progress(
                    on_progress,
                    "candidate",
                    metrics,
                    current_path=str(path),
                    candidate_id=candidate.candidate_id,
                )
                self._record_manifest_file(run_id, path, "clustered", "candidate", candidate.candidate_id, scan_conn)
                if metrics["clustered"] % 25 == 0 and scan_conn is not None:
                    scan_conn.commit()
            if max_label >= 0:
                cluster_label_offset += max_label + 1

        def prune_generated_video_frames(paths: Iterable[Path] | None = None) -> None:
            targets = {safe_resolve(path) for path in (paths or generated_video_frame_paths)}
            if not targets:
                return
            pending_frames = set()
            for pending_path, *_rest in unmatched:
                try:
                    pending_frame = safe_resolve(pending_path)
                except (OSError, RuntimeError):
                    continue
                if self.video_frames_path in pending_frame.parents:
                    pending_frames.add(pending_frame)
            retained = retained_video_frame_paths | pending_frames
            for frame_path in list(targets):
                if frame_path in retained:
                    continue
                try:
                    if self.video_frames_path in frame_path.parents:
                        frame_path.unlink(missing_ok=True)
                        generated_video_frame_paths.discard(frame_path)
                        try:
                            frame_path.parent.rmdir()
                        except OSError:
                            pass
                except OSError:
                    pass

        def video_candidate_allowed(metadata: dict[str, Any]) -> bool:
            if metadata.get("media_kind") != "video":
                return True
            source_path = str(metadata.get("media_source_path", ""))
            if not source_path:
                return True
            return video_candidate_counts.get(source_path, 0) < VIDEO_REVIEW_CANDIDATES_PER_SOURCE

        def note_video_candidate(metadata: dict[str, Any]) -> None:
            if metadata.get("media_kind") != "video":
                return
            source_path = str(metadata.get("media_source_path", ""))
            if source_path:
                video_candidate_counts[source_path] = video_candidate_counts.get(source_path, 0) + 1

        def queue_image(
            image_path: Path,
            image: Any | None = None,
            media_metadata: dict[str, Any] | None = None,
            apply_safe_mode: bool = True,
        ) -> int:
            nonlocal added
            ensure_not_cancelled()
            metadata = dict(media_metadata or {})
            signature = path_signature(image_path)
            content_hash = sha256_file(image_path, self.scan_cancel_requested)
            ensure_not_cancelled()
            if image is None:
                image = load_image(image_path)
            ensure_not_cancelled()
            ensure_stable_signature(image_path, signature)
            metadata.setdefault("source_hash", content_hash)
            if apply_safe_mode and self.config.safe_mode:
                assessment, content_hash = self._assess_safety_cached(image_path, image, scan_conn, content_hash=content_hash)
                ensure_not_cancelled()
                metadata["source_hash"] = content_hash
                if assessment.sensitive:
                    metrics["safeFiltered"] += 1
                    metrics["skipped"] += 1
                    self.db.record_scan_file(
                        run_id,
                        image_path,
                        signature,
                        "protected",
                        phase="protected",
                        message=assessment.reason,
                        safety_score=round(assessment.score, 6),
                        content_hash=content_hash,
                        conn=scan_conn,
                    )
                    self._emit_scan_progress(
                        on_progress,
                        "protected",
                        metrics,
                        current_path=str(image_path),
                        message="Safe Mode protected this image from matching and clustering.",
                        safety_score=round(assessment.score, 3),
                    )
                    return 0
            embeddings, cache_hit = self._embed_image_cached(image_path, engine, image=image, content_hash=content_hash, conn=scan_conn)
            ensure_not_cancelled()
            if cache_hit:
                metrics["embeddingCacheHits"] += 1
            else:
                metrics["embeddingCacheMisses"] += 1
            accepted = 0
            recorded_any = False
            queued_unmatched = False
            for embedding in embeddings:
                if embedding.quality < self.config.thresholds.quality_min:
                    metrics["skipped"] += 1
                    continue
                accepted += 1
                hits = self.vector_store.search(embedding.vector, k=k)
                decision = group_hits(hits, self.references, self.config.thresholds)
                if decision is None or decision.band == "below-review":
                    unmatched.append((image_path, embedding.quality, embedding.model_name, embedding.vector, metadata))
                    metrics["unmatched"] += 1
                    queued_unmatched = True
                    flush_unmatched()
                    continue
                if self.db.blocked_pair_exists(content_hash, decision.person_name, decision.best_ref_id, scan_conn):
                    metrics["skipped"] += 1
                    self.db.record_scan_file(
                        run_id,
                        image_path,
                        signature,
                        "skipped",
                        phase="blocked_pair",
                        message="Skipped by false-match feedback.",
                        candidate_id="",
                        content_hash=content_hash,
                        conn=scan_conn,
                    )
                    recorded_any = True
                    continue
                key = (self._candidate_dedupe_source(image_path, metadata), decision.best_ref_id, decision.person_name)
                if candidate_key_exists(key):
                    metrics["skipped"] += 1
                    continue
                if not video_candidate_allowed(metadata):
                    metrics["skipped"] += 1
                    continue
                candidate = ReviewCandidate(
                    candidate_id=new_id("cand"),
                    source_path=str(image_path),
                    person_name=decision.person_name,
                    best_ref_id=decision.best_ref_id,
                    best_ref_path=decision.best_ref_path,
                    score=decision.score,
                    band=decision.band,
                    quality=embedding.quality,
                    model_name=embedding.model_name,
                    note=_video_note(metadata),
                    **metadata,
                )
                self.candidates[candidate.candidate_id] = candidate
                self._mark_candidate_dirty(candidate.candidate_id)
                if metadata.get("media_kind") == "video":
                    try:
                        frame_path = safe_resolve(image_path)
                        if self.video_frames_path in frame_path.parents:
                            retained_video_frame_paths.add(frame_path)
                    except (OSError, RuntimeError):
                        pass
                remember_candidate_key(key)
                note_video_candidate(metadata)
                self.db.record_scan_file(
                    run_id,
                    image_path,
                    signature,
                    "candidate",
                    phase="candidate",
                    candidate_id=candidate.candidate_id,
                    conn=scan_conn,
                )
                recorded_any = True
                added += 1
                metrics["added"] = added
                metrics["matched"] += 1
                self._emit_scan_progress(
                    on_progress,
                    "candidate",
                    metrics,
                    current_path=str(image_path),
                    candidate_id=candidate.candidate_id,
                )
            if not accepted:
                metrics["skipped"] += 1
                self.db.record_scan_file(run_id, image_path, signature, "skipped", phase="skipped", conn=scan_conn)
            elif queued_unmatched:
                if any(row[0] == image_path for row in unmatched):
                    self.db.record_scan_file(run_id, image_path, signature, "unmatched", phase="pending_cluster", conn=scan_conn)
            elif not recorded_any:
                self.db.record_scan_file(run_id, image_path, signature, "completed", phase="processed", conn=scan_conn)
            return accepted

        self._emit_scan_progress(on_progress, "started", metrics)
        last_checkpoint_processed = 0
        last_db_update_processed = 0
        last_db_commit_processed = 0
        last_state_checkpoint_at = time.monotonic()
        final_status = "complete"

        def checkpoint(path: Path, force: bool = False) -> None:
            nonlocal last_checkpoint_processed, last_db_update_processed, last_db_commit_processed, last_state_checkpoint_at
            processed_delta = metrics["processed"] - last_db_update_processed
            if force or processed_delta >= SCAN_RUN_UPDATE_INTERVAL:
                last_db_update_processed = metrics["processed"]
                self.db.update_scan_run(run_id, metrics, final_status if final_status == "cancelled" else "running", str(path), scan_conn)
            commit_delta = metrics["processed"] - last_db_commit_processed
            if scan_conn is not None and (force or commit_delta >= SCAN_DB_COMMIT_INTERVAL):
                last_db_commit_processed = metrics["processed"]
                scan_conn.commit()
            state_delta = metrics["processed"] - last_checkpoint_processed
            now = time.monotonic()
            if force or state_delta >= SCAN_STATE_CHECKPOINT_INTERVAL or now - last_state_checkpoint_at >= SCAN_STATE_CHECKPOINT_SECONDS:
                last_checkpoint_processed = metrics["processed"]
                last_state_checkpoint_at = now
                self.save(snapshot_candidates=False)

        with self.db.connect() as connection:
            scan_conn = connection
            for raw_path in paths:
                if isinstance(raw_path, ScanDiscoveryError):
                    path = safe_resolve(raw_path.path)
                    if not paths_len_known:
                        metrics["total"] += 1
                    errors.append(f"{path.name or path}: {raw_path.error}")
                    metrics["errors"] = len(errors)
                    metrics["pathErrors"] += 1
                    metrics["processed"] += 1
                    if raw_path.fatal:
                        final_status = "error"
                    self.db.record_scan_file(
                        run_id,
                        path,
                        {"path": str(path), "pathKey": str(path), "size": 0, "mtimeNs": 0},
                        "error",
                        phase="discovery",
                        message=raw_path.error,
                        conn=scan_conn,
                    )
                    self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=raw_path.error)
                    checkpoint(path)
                    continue
                path = safe_resolve(raw_path)
                if not paths_len_known:
                    metrics["total"] += 1
                try:
                    exclusion_reason = self.scan_exclusion_reason(path)
                except OSError as exc:
                    errors.append(f"{path.name}: {exc}")
                    metrics["errors"] = len(errors)
                    metrics["pathErrors"] += 1
                    metrics["processed"] += 1
                    self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=str(exc))
                    checkpoint(path)
                    continue
                if exclusion_reason:
                    metrics["excluded"] += 1
                    metrics["skipped"] += 1
                    metrics["processed"] += 1
                    try:
                        self.db.record_scan_file(run_id, path, path_signature(path), "skipped", phase="excluded", message=exclusion_reason, conn=scan_conn)
                    except OSError:
                        pass
                    self._emit_scan_progress(on_progress, "processed", metrics, current_path=str(path), message=exclusion_reason)
                    checkpoint(path)
                    continue
                pause_started: float | None = None
                while self.scan_pause_requested() and not self.scan_cancel_requested():
                    if pause_started is None:
                        pause_started = time.monotonic()
                        self._emit_scan_progress(on_progress, "paused", metrics, current_path=str(path), message="Scan paused.")
                    time.sleep(0.35)
                if pause_started is not None:
                    metrics["pausedSeconds"] += int(max(0.0, time.monotonic() - pause_started))
                    self._emit_scan_progress(on_progress, "processing", metrics, current_path=str(path), message="Scan resumed.")
                if self.scan_cancel_requested():
                    metrics["cancelled"] = 1
                    final_status = "cancelled"
                    self._emit_scan_progress(on_progress, "cancelled", metrics, current_path=str(path), message="Scan cancelled. Resume will skip completed files.")
                    checkpoint(path, force=True)
                    break
                try:
                    signature = path_signature(path)
                    resume_row = self.db.scan_file_resume_row(resume_run_id, path, signature, scan_conn) if resume_run_id else None
                    if resume_row and resume_row.get("status") in {"candidate", "clustered"}:
                        candidate_id = str(resume_row.get("candidate_id") or "")
                        if candidate_id and candidate_id not in self.candidates:
                            resume_row = None
                    if resume_row:
                        metrics["manifestSkipped"] += 1
                        metrics["skipped"] += 1
                        self.db.record_scan_file(
                            run_id,
                            path,
                            signature,
                            "skipped",
                            phase="manifest",
                            message="Skipped from previous completed manifest.",
                            conn=scan_conn,
                        )
                        metrics["processed"] += 1
                        self._emit_scan_progress(on_progress, "processed", metrics, current_path=str(path))
                        checkpoint(path)
                        continue
                except OSError as exc:
                    errors.append(f"{path.name}: {exc}")
                    metrics["errors"] = len(errors)
                    metrics["pathErrors"] += 1
                    metrics["processed"] += 1
                    self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=str(exc))
                    checkpoint(path)
                    continue
                self._emit_scan_progress(on_progress, "processing", metrics, current_path=str(path))
                try:
                    if path.suffix.lower() in VIDEO_EXTENSIONS:
                        metrics["videoFiles"] += 1
                        self._ensure_generated_dir_sentinel(self.video_frames_path)
                        if not self._generated_dir_is_owned(self.video_frames_path):
                            raise VideoLoadError("Video frame cache is not an app-owned folder.")
                        samples = sample_video_frames(path, self.video_frames_path)
                        ensure_not_cancelled()
                        sample_paths = [safe_resolve(sample.path) for sample in samples]
                        generated_video_frame_paths.update(sample_paths)
                        ensure_stable_signature(path, signature)
                        metrics["videoFrames"] += len(samples)
                        protected = False
                        if self.config.safe_mode:
                            for sample in samples:
                                image = load_image(sample.path)
                                ensure_not_cancelled()
                                assessment, _content_hash = self._assess_safety_cached(sample.path, image, scan_conn)
                                ensure_not_cancelled()
                                if assessment.sensitive:
                                    protected = True
                                    metrics["safeFiltered"] += 1
                                    metrics["videoProtected"] += 1
                                    metrics["skipped"] += 1
                                    self.db.record_scan_file(
                                        run_id,
                                        path,
                                        path_signature(path),
                                        "protected",
                                        phase="protected",
                                        message=assessment.reason,
                                        safety_score=round(assessment.score, 6),
                                        conn=scan_conn,
                                    )
                                    self._emit_scan_progress(
                                        on_progress,
                                        "protected",
                                        metrics,
                                        current_path=str(path),
                                        message="Safe Mode protected this video from matching and clustering.",
                                        safety_score=round(assessment.score, 3),
                                    )
                                    break
                        if protected:
                            prune_generated_video_frames(sample_paths)
                            continue
                        for sample in samples:
                            image = load_image(sample.path)
                            ensure_not_cancelled()
                            queue_image(
                                sample.path,
                                image=image,
                                media_metadata={
                                    "media_kind": "video",
                                    "media_source_path": str(path),
                                    "video_timestamp_ms": sample.timestamp_ms,
                                    "video_frame_index": sample.frame_index,
                                    "video_duration_ms": sample.duration_ms,
                                },
                                apply_safe_mode=False,
                            )
                        self.db.record_scan_file(run_id, path, signature, "completed", phase="video", conn=scan_conn)
                        prune_generated_video_frames(sample_paths)
                    else:
                        queue_image(path)
                except InterruptedError as exc:
                    metrics["cancelled"] = 1
                    final_status = "cancelled"
                    errors.append(str(exc))
                    self._emit_scan_progress(on_progress, "cancelled", metrics, current_path=str(path), message=str(exc))
                    break
                except (ImageLoadError, VideoLoadError, OSError, ValueError) as exc:
                    errors.append(f"{path.name}: {exc}")
                    metrics["errors"] = len(errors)
                    if isinstance(exc, OSError):
                        metrics["pathErrors"] += 1
                    try:
                        self.db.record_scan_file(run_id, path, path_signature(path), "error", phase="error", message=str(exc), conn=scan_conn)
                    except OSError:
                        pass
                    self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=str(exc))
                finally:
                    metrics["processed"] += 1
                    self._emit_scan_progress(on_progress, "processed", metrics, current_path=str(path))
                    checkpoint(path)
            if final_status == "complete":
                flush_unmatched(force=True)
                prune_generated_video_frames()
            checkpoint(Path(root_path or self.root), force=True)
            scan_conn = None
        if final_status == "cancelled":
            unmatched = []
        self._record_scan_run(source, label, started_at, metrics, errors, status=final_status)
        self.save(snapshot_candidates=False)
        self.db.update_scan_run(run_id, metrics, final_status, "")
        self.clear_scan_cancel()
        self._emit_scan_progress(on_progress, final_status, metrics)
        return added, errors, metrics

    def request_scan_cancel(self, source: str = "desktop") -> dict[str, Any]:
        self.cancel_scan_path.write_text(now_iso(), encoding="utf-8")
        self._append_audit({"action": "request_scan_cancel", "source": source})
        return {"cancelled": True, "path": str(self.cancel_scan_path)}

    def request_scan_pause(self, source: str = "desktop") -> dict[str, Any]:
        self.pause_scan_path.write_text(now_iso(), encoding="utf-8")
        self._append_audit({"action": "request_scan_pause", "source": source})
        return {"paused": True, "path": str(self.pause_scan_path)}

    def request_scan_resume(self, source: str = "desktop") -> dict[str, Any]:
        self.clear_scan_pause()
        self._append_audit({"action": "request_scan_resume", "source": source})
        return {"paused": False, "path": str(self.pause_scan_path)}

    def scan_job_status(self, latest: dict[str, Any] | None = None) -> dict[str, Any]:
        latest = latest if latest is not None else self.scale_summary().get("latestScan")
        latest_status = str(latest.get("status", "")) if isinstance(latest, dict) else ""
        active = latest_status == "running" and not self.cancel_scan_path.exists()
        can_resume = bool(isinstance(latest, dict) and latest_status in {"running", "cancelled", "error"})
        processed = int(latest.get("processed", 0) or 0) if isinstance(latest, dict) else 0
        total = int(latest.get("total", 0) or 0) if isinstance(latest, dict) else 0
        if self.pause_scan_path.exists():
            action = "Resume scan when ready."
        elif self.cancel_scan_path.exists():
            action = "Waiting for the current file to finish cancelling."
        elif active:
            action = "Scan is running."
        elif can_resume and processed:
            action = "Resume will skip completed files from the manifest."
        else:
            action = "No active scan."
        return {
            "cancelRequested": self.cancel_scan_path.exists(),
            "paused": self.pause_scan_path.exists(),
            "cancelPath": str(self.cancel_scan_path),
            "pausePath": str(self.pause_scan_path),
            "latestScan": latest,
            "active": active,
            "canResume": can_resume,
            "progressLabel": f"{processed}/{total}" if total else f"{processed} processed",
            "recommendedAction": action,
        }

    def video_moments(self, limit: int = 80) -> list[dict[str, Any]]:
        if self.candidate_index_ready():
            try:
                return self.db.video_moments(limit)
            except sqlite3.Error:
                pass
        grouped: dict[str, dict[str, Any]] = {}
        for candidate in self.candidates.values():
            if candidate.media_kind != "video" or not candidate.media_source_path:
                continue
            row = grouped.setdefault(
                candidate.media_source_path,
                {
                    "mediaSourcePath": candidate.media_source_path,
                    "candidateIds": [],
                    "people": set(),
                    "statuses": set(),
                    "count": 0,
                    "bestScore": 0.0,
                    "firstTimestampMs": candidate.video_timestamp_ms,
                    "lastTimestampMs": candidate.video_timestamp_ms,
                    "previewPath": candidate.source_path,
                },
            )
            row["count"] += 1
            if len(row["candidateIds"]) < 60:
                row["candidateIds"].append(candidate.candidate_id)
            if candidate.person_name and not candidate.person_name.startswith("Unmatched cluster"):
                row["people"].add(candidate.person_name)
            row["statuses"].add(candidate.status)
            if candidate.score >= float(row["bestScore"]):
                row["bestScore"] = candidate.score
                row["previewPath"] = candidate.source_path
            if candidate.video_timestamp_ms is not None:
                current_first = row["firstTimestampMs"]
                current_last = row["lastTimestampMs"]
                row["firstTimestampMs"] = candidate.video_timestamp_ms if current_first is None else min(current_first, candidate.video_timestamp_ms)
                row["lastTimestampMs"] = candidate.video_timestamp_ms if current_last is None else max(current_last, candidate.video_timestamp_ms)
        rows = []
        for row in grouped.values():
            rows.append(
                {
                    **row,
                    "people": sorted(row["people"]),
                    "statuses": sorted(row["statuses"]),
                }
            )
        return sorted(rows, key=lambda item: (-float(item["bestScore"]), -int(item["count"]), str(item["mediaSourcePath"])))[: max(1, int(limit))]

    def review_insights(self) -> dict[str, Any]:
        if self.candidate_index_ready():
            try:
                return self.db.review_insights(self.config.thresholds.confident)
            except sqlite3.Error:
                pass
        pending = 0
        confident = 0
        video_pending = 0
        folders: dict[str, int] = {}
        for candidate in self.candidates.values():
            if candidate.status != "pending":
                continue
            pending += 1
            if candidate.score >= self.config.thresholds.confident:
                confident += 1
            if candidate.media_kind == "video":
                video_pending += 1
            try:
                folder = str(Path(candidate.media_source_path or candidate.source_path).expanduser().parent)
            except OSError:
                folder = ""
            if folder:
                folders[folder] = folders.get(folder, 0) + 1
        folder_rows = sorted(folders.items(), key=lambda item: (-item[1], item[0]))[:8]
        return {
            "pending": pending,
            "confidentPending": confident,
            "videoPending": video_pending,
            "imagePending": pending - video_pending,
            "topFolders": [{"folder": folder, "count": count} for folder, count in folder_rows],
            "recommendedOrder": "strongest-first" if confident else "newest-first",
        }

    def duplicate_people(self, threshold: float = 0.82, limit: int = 20) -> dict[str, Any]:
        threshold = max(0.0, min(1.0, float(threshold)))
        limit = max(1, min(100, int(limit)))
        grouped: dict[str, dict[str, Any]] = {}
        for ref in self.references.values():
            person_name = ref.person_name.strip()
            if not person_name:
                continue
            row = grouped.setdefault(person_name.casefold(), {"personName": person_name, "references": []})
            row["references"].append(ref)
        ref_people = {ref.ref_id: person_key for person_key, row in grouped.items() for ref in row["references"]}
        max_person_refs = max((len(row["references"]) for row in grouped.values()), default=0)
        search_k = min(self.vector_store.size, max(64, limit * 8, max_person_refs + 16))
        suggestions_by_pair: dict[tuple[str, str], dict[str, Any]] = {}
        for ref in self.references.values():
            person_key = ref_people.get(ref.ref_id)
            if not person_key:
                continue
            for hit in self.vector_store.search(ref.vector, k=search_k):
                if hit.item_id == ref.ref_id:
                    continue
                if hit.score < threshold:
                    break
                other_ref = self.references.get(hit.item_id)
                if other_ref is None:
                    continue
                other_key = ref_people.get(other_ref.ref_id)
                if not other_key or other_key == person_key:
                    continue
                pair_key = tuple(sorted((person_key, other_key)))
                if person_key == pair_key[0]:
                    left_ref, right_ref = ref, other_ref
                else:
                    left_ref, right_ref = other_ref, ref
                existing = suggestions_by_pair.get(pair_key)
                if existing is not None and float(existing["score"]) >= hit.score:
                    continue
                left = grouped[pair_key[0]]
                right = grouped[pair_key[1]]
                suggestions_by_pair[pair_key] = {
                    "personA": str(left["personName"]),
                    "personB": str(right["personName"]),
                    "score": round(float(hit.score), 6),
                    "countA": len(left["references"]),
                    "countB": len(right["references"]),
                    "referenceA": self._reference_summary(left_ref),
                    "referenceB": self._reference_summary(right_ref),
                    "reason": "Saved face photos are very similar; review whether these person labels should be merged.",
                }
        suggestions = list(suggestions_by_pair.values())
        suggestions.sort(key=lambda item: (-float(item["score"]), str(item["personA"]).lower(), str(item["personB"]).lower()))
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "threshold": threshold,
            "peopleChecked": len(grouped),
            "suggestions": suggestions[:limit],
        }

    def _reference_summary(self, ref: ReferenceFace) -> dict[str, Any]:
        return {
            "refId": ref.ref_id,
            "personName": ref.person_name,
            "ageBucket": ref.age_bucket,
            "sourcePath": ref.source_path,
            "quality": ref.quality,
            "modelName": ref.model_name,
        }

    def _cosine_similarity(self, left: list[float], right: list[float]) -> float:
        if not left or len(left) != len(right):
            return 0.0
        dot = 0.0
        left_norm = 0.0
        right_norm = 0.0
        for left_value, right_value in zip(left, right):
            left_float = float(left_value)
            right_float = float(right_value)
            if not math.isfinite(left_float) or not math.isfinite(right_float):
                return 0.0
            dot += left_float * right_float
            left_norm += left_float * left_float
            right_norm += right_float * right_float
        denom = math.sqrt(left_norm) * math.sqrt(right_norm)
        if denom <= 0.0:
            return 0.0
        return max(0.0, min(1.0, dot / denom))

    def apply_review_rules(self) -> dict[str, Any]:
        rules = {
            "autoRejectBelow": float(self.config.auto_reject_below),
            "autoUncertainLowQuality": bool(self.config.auto_uncertain_low_quality),
            "autoRejectLowQualityVideo": bool(self.config.auto_reject_low_quality_video),
            "qualityMinimum": float(self.config.thresholds.quality_min),
        }
        result = {
            "checked": 0,
            "updated": 0,
            "rejectedLowScore": 0,
            "uncertainLowQuality": 0,
            "rejectedLowQualityVideo": 0,
            "unchanged": 0,
            "rules": rules,
        }
        for candidate in self.candidates.values():
            if candidate.status != "pending":
                continue
            result["checked"] += 1
            next_status = ""
            reason = ""
            if self.config.auto_reject_low_quality_video and candidate.media_kind == "video" and candidate.quality < self.config.thresholds.quality_min:
                next_status = "rejected"
                reason = "Auto-triage rejected this low-quality video moment."
                result["rejectedLowQualityVideo"] += 1
            elif self.config.auto_reject_below > 0.0 and candidate.score < self.config.auto_reject_below and candidate.best_ref_id is not None:
                next_status = "rejected"
                reason = f"Auto-triage rejected this below {self.config.auto_reject_below:.2f} strength."
                result["rejectedLowScore"] += 1
            elif self.config.auto_uncertain_low_quality and candidate.quality < self.config.thresholds.quality_min:
                next_status = "uncertain"
                reason = "Auto-triage marked this as not sure because image quality is low."
                result["uncertainLowQuality"] += 1
            if not next_status:
                result["unchanged"] += 1
                continue
            candidate.status = next_status
            candidate.note = self._append_candidate_note(candidate.note, reason)
            self._mark_candidate_dirty(candidate.candidate_id)
            result["updated"] += 1
        if result["updated"]:
            self._append_audit(
                {
                    "action": "apply_review_rules",
                    "updated": result["updated"],
                    "checked": result["checked"],
                    "rules": rules,
                }
            )
            self.save()
        return result

    def verify_candidates(
        self,
        candidate_ids: list[str],
        engine: EmbeddingEngine,
        k: int = 20,
        on_progress: ScanProgress | None = None,
    ) -> dict[str, int]:
        unique_ids = [candidate_id for candidate_id in dict.fromkeys(candidate_ids) if candidate_id in self.candidates]
        metrics = {
            "total": len(unique_ids),
            "processed": 0,
            "verified": 0,
            "confirmed": 0,
            "changed": 0,
            "downgraded": 0,
            "errors": 0,
            "cancelled": 0,
            "pausedSeconds": 0,
            "embeddingCacheHits": 0,
            "embeddingCacheMisses": 0,
        }
        if not unique_ids:
            return metrics
        self._emit_scan_progress(on_progress, "verifying", metrics, message="Running high-detail recheck.")
        with self.db.connect() as conn:
            for candidate_id in unique_ids:
                pause_started: float | None = None
                while self.scan_pause_requested() and not self.scan_cancel_requested():
                    if pause_started is None:
                        pause_started = time.monotonic()
                        self._emit_scan_progress(on_progress, "paused", metrics, message="High-detail recheck paused.")
                    time.sleep(0.35)
                if pause_started is not None:
                    metrics["pausedSeconds"] += int(max(0.0, time.monotonic() - pause_started))
                    self._emit_scan_progress(on_progress, "verifying", metrics, message="High-detail recheck resumed.")
                if self.scan_cancel_requested():
                    metrics["cancelled"] = 1
                    self._emit_scan_progress(on_progress, "cancelled", metrics, message="High-detail recheck cancelled.")
                    break
                candidate = self.candidates.get(candidate_id)
                if candidate is None or candidate.best_ref_id is None:
                    metrics["processed"] += 1
                    continue
                path = Path(candidate.source_path).expanduser()
                try:
                    embeddings, cache_hit = self._embed_image_cached(path, engine, conn=conn)
                    if cache_hit:
                        metrics["embeddingCacheHits"] += 1
                    else:
                        metrics["embeddingCacheMisses"] += 1
                    if not embeddings:
                        metrics["downgraded"] += 1
                        candidate.note = self._append_candidate_note(candidate.note, "High-detail recheck did not find a face; keep only if it looks right.")
                        self._mark_candidate_dirty(candidate.candidate_id)
                    else:
                        best_decision = None
                        best_embedding = None
                        for embedding in embeddings:
                            if embedding.quality < self.config.thresholds.quality_min:
                                continue
                            decision = group_hits(self.vector_store.search(embedding.vector, k=k), self.references, self.config.thresholds)
                            if decision is None or decision.band == "below-review":
                                continue
                            if best_decision is None or decision.score > best_decision.score:
                                best_decision = decision
                                best_embedding = embedding
                        if best_decision is None or best_embedding is None:
                            metrics["downgraded"] += 1
                            candidate.note = self._append_candidate_note(candidate.note, "High-detail recheck could not confirm this match.")
                            self._mark_candidate_dirty(candidate.candidate_id)
                        else:
                            previous = (candidate.person_name, candidate.best_ref_id, round(candidate.score, 6), candidate.band)
                            candidate.person_name = best_decision.person_name
                            candidate.best_ref_id = best_decision.best_ref_id
                            candidate.best_ref_path = best_decision.best_ref_path
                            candidate.score = best_decision.score
                            candidate.band = best_decision.band
                            candidate.quality = best_embedding.quality
                            candidate.model_name = best_embedding.model_name
                            self._mark_candidate_dirty(candidate.candidate_id)
                            current = (candidate.person_name, candidate.best_ref_id, round(candidate.score, 6), candidate.band)
                            if current != previous:
                                metrics["changed"] += 1
                            metrics["confirmed"] += 1
                    metrics["verified"] += 1
                except (ImageLoadError, OSError, ValueError) as exc:
                    metrics["errors"] += 1
                    candidate.note = self._append_candidate_note(candidate.note if candidate else "", f"High-detail recheck failed: {exc}")
                    if candidate is not None:
                        self._mark_candidate_dirty(candidate.candidate_id)
                finally:
                    metrics["processed"] += 1
                    self._emit_scan_progress(on_progress, "verifying", metrics, candidate_id=candidate_id)
        self._append_audit({"action": "verify_candidates", "count": metrics["verified"], "changed": metrics["changed"], "errors": metrics["errors"]})
        self.save()
        self._emit_scan_progress(on_progress, "verified", metrics, message="High-detail recheck complete.")
        return metrics

    def add_calibration_label(self, row: dict[str, Any]) -> dict[str, Any]:
        label_id = new_id("label")
        self.db.add_calibration_label(label_id, row)
        self._append_audit(
            {
                "action": "add_calibration_label",
                "label_id": label_id,
                "source_path": str(row.get("sourcePath", ""))[:600],
                "expected_person": str(row.get("expectedPerson", ""))[:120],
                "actual_person": str(row.get("actualPerson", ""))[:120],
            }
        )
        return {"labelId": label_id, "summary": self.calibration_summary()}

    def calibration_summary(self) -> dict[str, Any]:
        return self.db.calibration_summary()

    def scale_summary(self) -> dict[str, Any]:
        return self.db.scale_summary()

    def clear_scan_cancel(self) -> None:
        try:
            self.cancel_scan_path.unlink()
        except OSError:
            pass

    def clear_scan_pause(self) -> None:
        try:
            self.pause_scan_path.unlink()
        except OSError:
            pass

    def scan_cancel_requested(self) -> bool:
        return self.cancel_scan_path.exists()

    def scan_pause_requested(self) -> bool:
        return self.pause_scan_path.exists()

    def _append_candidate_note(self, note: str, addition: str) -> str:
        value = note.strip()
        if addition in value:
            return value
        return (f"{value}\n{addition}" if value else addition)[:1200]

    def _embedding_cache_version(self, engine: EmbeddingEngine) -> str:
        return str(getattr(engine, "model_name", "unknown"))

    def _embedding_detector_size(self, engine: EmbeddingEngine) -> int:
        return int(getattr(engine, "detector_size", self.config.face_detector_size))

    def _embedding_cache_row(self, embedding: EmbeddingResult) -> dict[str, Any]:
        return {
            "vector": embedding.vector,
            "quality": embedding.quality,
            "bbox": list(embedding.bbox) if embedding.bbox else None,
            "modelName": embedding.model_name,
            "note": embedding.note,
        }

    def _embedding_from_cache_row(self, row: dict[str, Any]) -> EmbeddingResult:
        bbox_value = row.get("bbox")
        bbox = tuple(int(value) for value in bbox_value) if isinstance(bbox_value, list) and len(bbox_value) == 4 else None
        vector = row.get("vector") if isinstance(row.get("vector"), list) else []
        return EmbeddingResult(
            vector=[float(value) for value in vector],
            quality=float(row.get("quality", 0.0)),
            bbox=bbox,
            model_name=str(row.get("modelName", "")),
            note=str(row.get("note", "")),
        )

    def _embed_image_cached(
        self,
        path: Path,
        engine: EmbeddingEngine,
        image: Any | None = None,
        content_hash: str = "",
        conn: sqlite3.Connection | None = None,
    ) -> tuple[list[EmbeddingResult], bool]:
        content_hash = content_hash or sha256_file(path)
        model_version = self._embedding_cache_version(engine)
        detector_size = self._embedding_detector_size(engine)
        cached = self.db.embedding_lookup(content_hash, model_version, detector_size, conn)
        if cached is not None:
            return [self._embedding_from_cache_row(row) for row in cached], True
        embeddings = engine.embed_loaded_image(image, path) if image is not None else engine.embed_image(path)
        self.db.embedding_store(
            content_hash,
            model_version,
            detector_size,
            [self._embedding_cache_row(embedding) for embedding in embeddings],
            conn,
        )
        return embeddings, False

    def _candidate_dedupe_source(self, path: Path, metadata: dict[str, Any]) -> str:
        if metadata.get("media_kind") == "video" and metadata.get("media_source_path"):
            return str(metadata["media_source_path"])
        source_hash = str(metadata.get("source_hash", "")).strip()
        if source_hash:
            return f"sha256:{source_hash}"
        return str(path)

    def _candidate_existing_key(self, candidate: ReviewCandidate) -> tuple[str, str | None, str]:
        if candidate.media_kind == "video" and candidate.media_source_path:
            source_path = candidate.media_source_path
        elif candidate.source_hash:
            source_path = f"sha256:{candidate.source_hash}"
        else:
            source_path = candidate.source_path
        return (source_path, candidate.best_ref_id, candidate.person_name)

    def _iter_media_paths(self, folder: Path) -> Iterable[Path | ScanDiscoveryError]:
        root = safe_resolve(folder)
        media_extensions = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
        try:
            is_file = root.is_file()
            exists = root.exists()
        except OSError as exc:
            yield ScanDiscoveryError(root, str(exc), fatal=True)
            return
        if is_file:
            if root.suffix.lower() in media_extensions and not self.scan_exclusion_reason(root):
                yield root
            return
        if not exists:
            yield ScanDiscoveryError(root, "Folder is no longer available. Check that the drive is connected.", fatal=True)
            return
        stack = [root]
        while stack:
            current = stack.pop()
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        path = Path(entry.path)
                        try:
                            if entry.is_dir(follow_symlinks=False):
                                if not self.scan_exclusion_reason(path, is_dir=True):
                                    stack.append(path)
                            elif entry.is_file(follow_symlinks=False) and path.suffix.lower() in media_extensions:
                                if not self.scan_exclusion_reason(path, is_dir=False):
                                    yield path
                            elif entry.is_symlink():
                                yield ScanDiscoveryError(path, "Skipped symlink. Add the real folder or file path to scan it.")
                        except OSError as exc:
                            yield ScanDiscoveryError(path, str(exc))
                            continue
            except OSError as exc:
                yield ScanDiscoveryError(current, str(exc))
                continue

    def scan_exclusion_reason(self, path: Path, is_dir: bool | None = None) -> str:
        try:
            resolved = safe_resolve(path)
            parts = [part.casefold() for part in resolved.parts]
            path_text = str(resolved).casefold()
        except (OSError, RuntimeError):
            resolved = path
            parts = [part.casefold() for part in path.parts]
            path_text = str(path).casefold()
        excluded_dirs, excluded_extensions, excluded_keywords = self._exclusion_sets()
        matched_dir = next((part for part in parts if part in excluded_dirs), "")
        if matched_dir:
            return f"Skipped by folder exclusion: {matched_dir}"
        for original, text in excluded_keywords:
            if text and text in path_text:
                return f"Skipped by path exclusion: {original}"
        if not is_dir and path.suffix.lower() in excluded_extensions:
            return f"Skipped by file-type exclusion: {path.suffix.lower()}"
        max_media_file_bytes = int(self.config.max_media_file_bytes or 0)
        if not is_dir and max_media_file_bytes > 0 and path.suffix.lower() in (IMAGE_EXTENSIONS | VIDEO_EXTENSIONS):
            try:
                size = resolved.stat().st_size
            except OSError:
                size = 0
            if size > max_media_file_bytes:
                return f"Skipped by size limit: {size} bytes exceeds {max_media_file_bytes} bytes."
        if not is_dir and self.config.excluded_file_paths:
            if str(resolved).casefold() in self._excluded_file_path_set():
                return "Skipped by exact-file exclusion."
        return ""

    def _exclusion_sets(self) -> tuple[set[str], set[str], tuple[tuple[str, str], ...]]:
        cache_key = (
            tuple(self.config.excluded_dir_names),
            tuple(self.config.excluded_extensions),
            tuple(self.config.excluded_path_keywords),
        )
        if cache_key != self._exclusion_cache_key:
            self._excluded_dir_names_cache = {
                item.strip().casefold()
                for item in self.config.excluded_dir_names
                if item.strip()
            }
            self._excluded_extensions_cache = {
                item.strip().lower() if item.strip().startswith(".") else f".{item.strip().lower()}"
                for item in self.config.excluded_extensions
                if item.strip()
            }
            self._excluded_keywords_cache = tuple(
                (item, item.strip().casefold())
                for item in self.config.excluded_path_keywords
                if item.strip()
            )
            self._exclusion_cache_key = cache_key
        return self._excluded_dir_names_cache, self._excluded_extensions_cache, self._excluded_keywords_cache

    def _excluded_file_path_set(self) -> set[str]:
        cache_key = tuple(self.config.excluded_file_paths)
        if cache_key == self._excluded_file_paths_cache_key:
            return self._excluded_file_paths_cache
        excluded_files: set[str] = set()
        for item in self.config.excluded_file_paths:
            try:
                excluded_files.add(str(Path(item).expanduser().resolve()).casefold())
            except OSError:
                excluded_files.add(str(Path(item)).casefold())
        self._excluded_file_paths_cache_key = cache_key
        self._excluded_file_paths_cache = excluded_files
        return excluded_files

    def _record_manifest_file(
        self,
        run_id: str,
        path: Path,
        status: str,
        phase: str = "",
        candidate_id: str = "",
        conn: sqlite3.Connection | None = None,
    ) -> None:
        try:
            self.db.record_scan_file(
                run_id,
                path,
                path_signature(path),
                status,
                phase=phase,
                candidate_id=candidate_id,
                conn=conn,
            )
        except OSError:
            pass

    def _safety_cache_version(self) -> str:
        report = safety_model_report()
        path = Path(str(report.get("path") or ""))
        parts = [str(report.get("engine", "heuristic")), str(report.get("modelName", "unknown"))]
        try:
            if path.exists():
                stat = path.stat()
                parts.extend([str(stat.st_size), str(stat.st_mtime_ns)])
        except OSError:
            pass
        return "|".join(parts)

    def _assess_safety_cached(
        self,
        path: Path,
        image: Any,
        conn: sqlite3.Connection | None = None,
        content_hash: str = "",
    ) -> tuple[SafetyAssessment, str]:
        content_hash = content_hash or sha256_file(path)
        model_version = self._safety_cache_version()
        cached = self.db.safety_lookup(content_hash, model_version, self.config.safe_mode_threshold, conn)
        if cached:
            return (
                SafetyAssessment(
                    sensitive=bool(cached["sensitive"]),
                    score=float(cached["score"]),
                    reason=str(cached["reason"]),
                    skin_ratio=0.0,
                    lower_skin_ratio=0.0,
                    largest_region_ratio=0.0,
                    engine=str(cached["engine"]),
                    model_name=str(cached["model_name"]),
                    model_score=None,
                    heuristic_score=None,
                    threshold=self.config.safe_mode_threshold,
                    labels=dict(cached.get("labels", {})),
                ),
                content_hash,
            )
        assessment = assess_image_safety(path, self.config.safe_mode_threshold, image=image)
        if assessment.engine != "heuristic-fallback":
            self.db.safety_store(content_hash, model_version, self.config.safe_mode_threshold, assessment, conn)
        return assessment, content_hash

    def set_candidate_status(self, candidate_id: str, status: str) -> None:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        candidate = self.candidates[candidate_id]
        candidate.status = status
        self._mark_candidate_dirty(candidate_id)
        self._append_audit(
            {
                "action": "set_candidate_status",
                "candidate_id": candidate_id,
                "status": status,
                "source_path": candidate.source_path,
                "person_name": candidate.person_name,
                "score": candidate.score,
                "band": candidate.band,
            }
        )
        if status in {"accepted", "rejected"}:
            file_hash = ""
            try:
                file_hash = sha256_file(Path(candidate.source_path))
            except Exception:
                file_hash = ""
            self.db.add_calibration_label(
                new_id("label"),
                {
                    "sourcePath": candidate.source_path,
                    "fileHash": file_hash,
                    "expectedPerson": candidate.person_name,
                    "actualPerson": candidate.person_name if status == "accepted" else "",
                    "matchScore": candidate.score,
                    "isMatch": status == "accepted",
                },
            )
        self.save()

    def set_candidate_note(self, candidate_id: str, note: str) -> None:
        candidate = self.candidates[candidate_id]
        candidate.note = note.strip()[:1200]
        self._mark_candidate_dirty(candidate_id)
        self._append_audit(
            {
                "action": "set_candidate_note",
                "candidate_id": candidate_id,
                "source_path": candidate.source_path,
                "person_name": candidate.person_name,
                "note_length": len(candidate.note),
            }
        )
        self.save()

    def block_false_match(self, candidate_id: str, note: str = "") -> dict[str, Any]:
        candidate = self.candidates[candidate_id]
        file_hash = candidate.source_hash
        if not file_hash:
            try:
                file_hash = sha256_file(Path(candidate.source_path))
            except Exception:
                file_hash = ""
        if not file_hash:
            raise ValueError("This match cannot be blocked because its file hash is unavailable.")
        self.db.add_blocked_pair(
            {
                "fileHash": file_hash,
                "personName": candidate.person_name,
                "bestRefId": candidate.best_ref_id or "",
                "sourcePath": candidate.source_path,
                "note": note or "Rejected from review as a repeated false match.",
            }
        )
        candidate.status = "rejected"
        candidate.note = self._append_candidate_note(candidate.note, "Do not suggest this image/person pair again.")
        self._mark_candidate_dirty(candidate_id)
        self.db.add_calibration_label(
            new_id("label"),
            {
                "sourcePath": candidate.source_path,
                "fileHash": file_hash,
                "expectedPerson": candidate.person_name,
                "actualPerson": "",
                "matchScore": candidate.score,
                "isMatch": False,
            },
        )
        self._append_audit(
            {
                "action": "block_false_match",
                "candidate_id": candidate_id,
                "source_path": candidate.source_path,
                "person_name": candidate.person_name,
                "best_ref_id": candidate.best_ref_id or "",
            }
        )
        self.save()
        return {"blocked": 1, "summary": self.db.blocked_pairs_summary(limit=5)}

    def reassign_candidate_person(self, candidate_id: str, person_name: str, clear_reference: bool = True) -> dict[str, Any]:
        target = person_name.strip()
        if not target:
            raise ValueError("Choose the person this match belongs to.")
        candidate = self.candidates[candidate_id]
        previous = {
            "personName": candidate.person_name,
            "bestRefId": candidate.best_ref_id,
            "bestRefPath": candidate.best_ref_path,
            "score": candidate.score,
            "band": candidate.band,
            "status": candidate.status,
        }
        candidate.person_name = target
        if clear_reference:
            candidate.best_ref_id = None
            candidate.best_ref_path = None
            candidate.score = 0.0
            candidate.band = "manual assignment"
        candidate.status = "uncertain"
        candidate.note = self._append_candidate_note(candidate.note, f"Moved to {target} for manual identity cleanup.")
        self._mark_candidate_dirty(candidate_id)
        self._append_audit(
            {
                "action": "reassign_candidate_person",
                "candidate_id": candidate_id,
                "old_person_name": previous["personName"],
                "new_person_name": target,
                "clear_reference": bool(clear_reference),
            }
        )
        self.save()
        return {"candidateId": candidate_id, "previous": previous, "personName": target}

    def bulk_set_candidate_status(self, candidate_ids: list[str], status: str) -> int:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        unique_ids = list(dict.fromkeys(candidate_ids))
        missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
        if missing:
            raise KeyError(f"Candidate not found: {missing[0]}")
        for candidate_id in unique_ids:
            self.candidates[candidate_id].status = status
        self._mark_candidates_dirty(unique_ids)
        self._append_audit(
            {
                "action": "bulk_set_candidate_status",
                "status": status,
                "count": len(unique_ids),
                "candidate_ids": unique_ids[:40],
            }
        )
        self.save()
        return len(unique_ids)

    def clear_candidates(self) -> None:
        count = len(self.candidates)
        self.candidates.clear()
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        try:
            self.db.clear_candidates()
        except sqlite3.Error:
            pass
        self._append_audit({"action": "clear_candidates", "count": count})
        self.save()

    def purge_candidates(self, statuses: list[str]) -> int:
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        status_set = {str(status) for status in statuses}
        if not status_set or not status_set <= allowed:
            raise ValueError("Purge statuses must be selected from pending, accepted, rejected, and uncertain.")
        to_delete = [candidate_id for candidate_id, candidate in self.candidates.items() if candidate.status in status_set]
        self._mark_candidates_deleted(to_delete)
        for candidate_id in to_delete:
            self.candidates.pop(candidate_id, None)
        self._append_audit(
            {
                "action": "purge_candidates",
                "statuses": sorted(status_set),
                "count": len(to_delete),
            }
        )
        self.save()
        return len(to_delete)

    def duplicate_candidate_groups(self) -> list[dict[str, Any]]:
        groups: dict[tuple[str, str, str], list[ReviewCandidate]] = {}
        for candidate in self.candidates.values():
            key = (self._candidate_duplicate_source(candidate), candidate.person_name.casefold(), candidate.best_ref_id or "")
            groups.setdefault(key, []).append(candidate)
        duplicates: list[dict[str, Any]] = []
        for (source_key, _person_key, best_ref_id), rows in groups.items():
            if len(rows) < 2:
                continue
            ranked = self._rank_duplicate_candidates(rows)
            keep = ranked[0]
            duplicates.append(
                {
                    "sourcePath": keep.media_source_path if keep.media_kind == "video" and keep.media_source_path else keep.source_path,
                    "sourceKey": source_key,
                    "personName": keep.person_name,
                    "bestRefId": best_ref_id or None,
                    "candidateIds": [candidate.candidate_id for candidate in rows],
                    "keepCandidateId": keep.candidate_id,
                    "count": len(rows),
                    "bestScore": max(candidate.score for candidate in rows),
                }
            )
        return sorted(duplicates, key=lambda row: (-int(row["count"]), str(row["personName"]).lower(), str(row["sourcePath"])))

    def _duplicate_candidate_summary(self, limit: int = 20) -> dict[str, Any]:
        groups: dict[tuple[str, str, str], dict[str, Any]] = {}
        for candidate in self.candidates.values():
            key = (self._candidate_duplicate_source(candidate), candidate.person_name.casefold(), candidate.best_ref_id or "")
            row = groups.get(key)
            if row is None:
                groups[key] = {
                    "sourcePath": candidate.source_path,
                    "sourceKey": key[0],
                    "personName": candidate.person_name,
                    "bestRefId": candidate.best_ref_id,
                    "candidateIds": [candidate.candidate_id],
                    "keepCandidateId": candidate.candidate_id,
                    "count": 1,
                    "bestScore": candidate.score,
                    "bestQuality": candidate.quality,
                    "bestStatus": candidate.status,
                    "bestCreatedAt": candidate.created_at,
                }
                continue
            row["count"] = int(row["count"]) + 1
            if len(row["candidateIds"]) < 40:
                row["candidateIds"].append(candidate.candidate_id)
            challenger = (candidate.status in {"accepted", "pending"}, candidate.score, candidate.quality, candidate.created_at)
            current = (str(row["bestStatus"]) in {"accepted", "pending"}, float(row["bestScore"]), float(row["bestQuality"]), str(row["bestCreatedAt"]))
            if challenger > current:
                row["personName"] = candidate.person_name
                row["keepCandidateId"] = candidate.candidate_id
                row["bestScore"] = candidate.score
                row["bestQuality"] = candidate.quality
                row["bestStatus"] = candidate.status
                row["bestCreatedAt"] = candidate.created_at
        duplicates = [
            {
                "sourcePath": str(row["sourcePath"]),
                "sourceKey": str(row.get("sourceKey", row["sourcePath"])),
                "personName": str(row["personName"]),
                "bestRefId": row["bestRefId"],
                "candidateIds": list(row["candidateIds"]),
                "keepCandidateId": str(row["keepCandidateId"]),
                "count": int(row["count"]),
                "bestScore": float(row["bestScore"]),
            }
            for row in groups.values()
            if int(row["count"]) > 1
        ]
        duplicates.sort(key=lambda row: (-int(row["count"]), str(row["personName"]).lower(), str(row["sourcePath"])))
        return {
            "groups": duplicates[:max(0, int(limit))],
            "duplicateCandidateCount": sum(max(0, int(row["count"]) - 1) for row in duplicates),
        }

    def purge_duplicate_candidates(self) -> int:
        to_delete: list[str] = []
        for group in self.duplicate_candidate_groups():
            keep_id = str(group["keepCandidateId"])
            to_delete.extend(candidate_id for candidate_id in group["candidateIds"] if candidate_id != keep_id)
        for candidate_id in to_delete:
            self.candidates.pop(candidate_id, None)
        self._mark_candidates_deleted(to_delete)
        self._append_audit({"action": "purge_duplicate_candidates", "count": len(to_delete)})
        self.save()
        return len(to_delete)

    def delete_reference(self, ref_id: str) -> None:
        if ref_id not in self.references:
            raise KeyError(f"Reference not found: {ref_id}")
        ref = self.references.pop(ref_id)
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        self._append_audit(
            {
                "action": "delete_reference",
                "ref_id": ref_id,
                "source_path": ref.source_path,
                "person_name": ref.person_name,
            }
        )
        self.save()

    def clear_references(self) -> int:
        count = len(self.references)
        self.references.clear()
        self.vector_store.clear()
        self._append_audit({"action": "clear_references", "count": count})
        self.save()
        return count

    def delete_person(self, person_name: str) -> dict[str, int]:
        normalized = person_name.strip().casefold()
        if not normalized:
            raise ValueError("A person name is required.")
        ref_ids = [ref_id for ref_id, ref in self.references.items() if ref.person_name.casefold() == normalized]
        candidate_ids = [
            candidate_id
            for candidate_id, candidate in self.candidates.items()
            if candidate.person_name.casefold() == normalized
        ]
        if not ref_ids and not candidate_ids:
            raise KeyError(f"Person not found: {person_name}")
        for ref_id in ref_ids:
            self.references.pop(ref_id, None)
        for candidate_id in candidate_ids:
            self.candidates.pop(candidate_id, None)
        self._mark_candidates_deleted(candidate_ids)
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        result = {"references": len(ref_ids), "candidates": len(candidate_ids)}
        self._append_audit({"action": "delete_person", "person_name": person_name.strip(), **result})
        self.save()
        return result

    def rename_person(self, old_name: str, new_name: str) -> dict[str, int]:
        old_clean = old_name.strip()
        new_clean = new_name.strip()
        if not old_clean or not new_clean:
            raise ValueError("Both current and new person names are required.")
        old_key = old_clean.casefold()
        if old_key == new_clean.casefold():
            return {"references": 0, "candidates": 0}
        references = 0
        candidates = 0
        for ref in self.references.values():
            if ref.person_name.casefold() == old_key:
                ref.person_name = new_clean
                references += 1
        for candidate in self.candidates.values():
            if candidate.person_name.casefold() == old_key:
                candidate.person_name = new_clean
                candidates += 1
                self._mark_candidate_dirty(candidate.candidate_id)
        if references == 0 and candidates == 0:
            raise KeyError(f"Person not found: {old_name}")
        self._append_audit(
            {
                "action": "rename_person",
                "old_person_name": old_clean,
                "new_person_name": new_clean,
                "references": references,
                "candidates": candidates,
            }
        )
        self.save()
        return {"references": references, "candidates": candidates}

    def purge_old_candidates(self, days: int, statuses: list[str] | None = None) -> int:
        days = max(1, min(3650, int(days)))
        status_set = set(statuses or ["accepted", "rejected", "uncertain"])
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        if not status_set or not status_set <= allowed:
            raise ValueError("Retention statuses must be selected from pending, accepted, rejected, and uncertain.")
        cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60
        to_delete: list[str] = []
        skipped_undated = 0
        for candidate_id, candidate in self.candidates.items():
            if candidate.status not in status_set:
                continue
            try:
                created = datetime.fromisoformat(candidate.created_at.replace("Z", "+00:00")).timestamp()
            except (AttributeError, ValueError):
                skipped_undated += 1
                continue
            if created < cutoff:
                to_delete.append(candidate_id)
        for candidate_id in to_delete:
            self.candidates.pop(candidate_id, None)
        self._mark_candidates_deleted(to_delete)
        self._append_audit(
            {
                "action": "purge_old_candidates",
                "days": days,
                "statuses": sorted(status_set),
                "count": len(to_delete),
                "skipped_undated": skipped_undated,
            }
        )
        self.save()
        return len(to_delete)

    def repair_workspace(self, dry_run: bool = True, force: bool = False) -> dict[str, Any]:
        missing_ref_ids = [
            ref_id
            for ref_id, ref in self.references.items()
            if not Path(ref.source_path).exists()
        ]
        missing_candidate_ids = [
            candidate_id
            for candidate_id, candidate in self.candidates.items()
            if not Path(candidate.source_path).exists()
            or (candidate.media_source_path and not Path(candidate.media_source_path).exists())
        ]
        missing_values: list[str] = []
        for ref_id in missing_ref_ids:
            missing_values.append(self.references[ref_id].source_path)
        for candidate_id in missing_candidate_ids:
            candidate = self.candidates[candidate_id]
            missing_values.append(candidate.source_path)
            if candidate.media_source_path:
                missing_values.append(candidate.media_source_path)

        def missing_root_candidates(paths: list[str]) -> list[str]:
            roots: dict[str, int] = {}
            for value in paths:
                try:
                    path = Path(value).expanduser()
                except (OSError, RuntimeError):
                    continue
                parts = path.parts
                candidates: list[Path] = []
                if path.is_absolute() and len(parts) >= 3:
                    candidates.append(Path(*parts[:3]))
                if len(parts) >= 2:
                    candidates.append(Path(*parts[:2]))
                if path.parent != path:
                    candidates.append(path.parent)
                for candidate_root in candidates:
                    if not candidate_root.exists():
                        key = str(candidate_root)
                        roots[key] = roots.get(key, 0) + 1
                        break
            return [root for root, count in sorted(roots.items(), key=lambda item: item[1], reverse=True) if count >= 3][:8]

        unavailable_roots = missing_root_candidates(missing_values)
        destructive_blocked = bool(unavailable_roots and (len(missing_ref_ids) + len(missing_candidate_ids)) >= 3 and not force)
        result = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "dryRun": bool(dry_run),
            "force": bool(force),
            "destructiveBlocked": destructive_blocked,
            "unavailableRoots": unavailable_roots,
            "removedReferences": len(missing_ref_ids),
            "removedCandidates": len(missing_candidate_ids),
            "referenceIds": missing_ref_ids[:50],
            "candidateIds": missing_candidate_ids[:50],
            "before": self.workspace_health(),
            "after": None,
        }
        if dry_run:
            result["after"] = result["before"]
            return result
        if destructive_blocked:
            result["after"] = result["before"]
            self._append_audit(
                {
                    "action": "repair_workspace_blocked",
                    "missing_references": len(missing_ref_ids),
                    "missing_candidates": len(missing_candidate_ids),
                    "unavailable_roots": unavailable_roots,
                }
            )
            return result
        for ref_id in missing_ref_ids:
            self.references.pop(ref_id, None)
        for candidate_id in missing_candidate_ids:
            self.candidates.pop(candidate_id, None)
        self._mark_candidates_deleted(missing_candidate_ids)
        if missing_ref_ids:
            self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        self._append_audit(
            {
                "action": "repair_workspace",
                "removed_references": len(missing_ref_ids),
                "removed_candidates": len(missing_candidate_ids),
            }
        )
        self.save()
        result["after"] = self.workspace_health()
        return result

    def relink_workspace_paths(self, old_root: Path, new_root: Path, dry_run: bool = True, force_partial: bool = False) -> dict[str, Any]:
        old_base = old_root.expanduser().resolve()
        new_base = new_root.expanduser().resolve()
        if not new_base.exists() or not new_base.is_dir():
            raise ValueError("Choose the new folder that contains the moved photos.")
        if not dry_run and not force_partial:
            preview = self.relink_workspace_paths(old_base, new_base, dry_run=True, force_partial=True)
            if preview.get("missingTargets"):
                preview["dryRun"] = False
                preview["forcePartial"] = False
                preview["partialBlocked"] = True
                self._append_audit(
                    {
                        "action": "relink_workspace_paths_blocked",
                        "old_root": str(old_base),
                        "new_root": str(new_base),
                        "missing_targets": len(preview.get("missingTargets", [])),
                    }
                )
                return preview
        samples: list[dict[str, str]] = []
        missing_targets: list[dict[str, str]] = []
        relinked_references = 0
        relinked_candidates = 0
        relinked_fields = 0

        def remap(value: str) -> tuple[str, bool, bool]:
            if not value:
                return value, False, False
            try:
                original = Path(value).expanduser().resolve()
                relative = original.relative_to(old_base)
            except (OSError, ValueError):
                return value, False, False
            target = new_base / relative
            if not target.exists():
                missing_targets.append({"from": value, "to": str(target)})
                return value, True, False
            return str(target.resolve()), True, True

        for ref in self.references.values():
            next_path, matched, exists = remap(ref.source_path)
            if matched and exists and next_path != ref.source_path:
                samples.append({"kind": "reference", "from": ref.source_path, "to": next_path, "personName": ref.person_name})
                if not dry_run:
                    ref.source_path = next_path
                relinked_references += 1
                relinked_fields += 1
        for candidate in self.candidates.values():
            candidate_changed = False
            for field_name in ("source_path", "best_ref_path", "media_source_path"):
                current = str(getattr(candidate, field_name) or "")
                next_path, matched, exists = remap(current)
                if matched and exists and next_path != current:
                    samples.append({"kind": field_name, "from": current, "to": next_path, "personName": candidate.person_name})
                    if not dry_run:
                        setattr(candidate, field_name, next_path)
                    candidate_changed = True
                    relinked_fields += 1
            if candidate_changed:
                relinked_candidates += 1
                if not dry_run:
                    self._mark_candidate_dirty(candidate.candidate_id)
        result = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "dryRun": bool(dry_run),
            "forcePartial": bool(force_partial),
            "partialBlocked": False,
            "oldRoot": str(old_base),
            "newRoot": str(new_base),
            "relinkedReferences": relinked_references,
            "relinkedCandidates": relinked_candidates,
            "relinkedFields": relinked_fields,
            "relinkedScanRuns": 0,
            "relinkedScanFiles": 0,
            "missingTargets": missing_targets[:50],
            "samples": samples[:50],
        }
        if not dry_run:
            manifest_relink = self.db.relink_scan_paths(old_base, new_base)
            result["relinkedScanRuns"] = int(manifest_relink.get("scanRuns", 0))
            result["relinkedScanFiles"] = int(manifest_relink.get("scanFiles", 0))
        if not dry_run and (relinked_fields or result["relinkedScanRuns"] or result["relinkedScanFiles"]):
            self._append_audit(
                {
                    "action": "relink_workspace_paths",
                    "old_root": str(old_base),
                    "new_root": str(new_base),
                    "references": relinked_references,
                    "candidates": relinked_candidates,
                    "fields": relinked_fields,
                    "scan_runs": result["relinkedScanRuns"],
                    "scan_files": result["relinkedScanFiles"],
                }
            )
            self.save()
        return result

    def export_workspace_backup(self, folder: Path | None = None, include_generated: bool = True) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        backup_path = export_root / f"vintrace-workspace-backup-{stamp}.zip"
        counter = 2
        while backup_path.exists():
            backup_path = export_root / f"vintrace-workspace-backup-{stamp}-{counter}.zip"
            counter += 1
        manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "workspaceMetadata": self.workspace_metadata,
            "includeGenerated": bool(include_generated),
            "counts": {
                "references": len(self.references),
                "candidates": len(self.candidates),
                "scanRuns": len(self.scan_history),
            },
            "note": "Backup contains Vintrace workspace metadata and generated workspace files, not original source media outside the workspace.",
        }
        include_dirs = {"exports"}
        if not include_generated:
            include_dirs.update({"previews", "video-frames"})
        written = 0
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("backup-manifest.json", json.dumps(manifest, indent=2))
            written += 1
            for current, dirnames, filenames in os.walk(self.root):
                dirnames[:] = sorted(dirname for dirname in dirnames if dirname not in include_dirs)
                for filename in sorted(filenames):
                    path = Path(current) / filename
                    if not path.is_file():
                        continue
                    relative = path.relative_to(self.root)
                    if path == backup_path or path.name == ".state.lock":
                        continue
                    archive.write(path, relative.as_posix())
                    written += 1
        self._append_audit(
            {
                "action": "export_workspace_backup",
                "zip_path": str(backup_path),
                "file_count": written,
                "include_generated": bool(include_generated),
            }
        )
        return {
            "zipPath": str(backup_path),
            "fileCount": written,
            "bytes": backup_path.stat().st_size,
            "includeGenerated": bool(include_generated),
        }

    def verify_workspace_backup(self, backup_path: Path | None = None) -> dict[str, Any]:
        path = backup_path.expanduser().resolve() if backup_path else self._latest_workspace_backup()
        result: dict[str, Any] = {
            "ok": False,
            "zipPath": str(path) if path else "",
            "exists": bool(path and path.exists()),
            "bytes": 0,
            "fileCount": 0,
            "manifest": {},
            "missingCoreFiles": [],
            "dangerousEntries": [],
            "invalidCoreFiles": [],
            "invalidCoreErrors": {},
            "corruptEntry": "",
            "error": "",
        }
        if not path:
            result["error"] = "No backup zip was found in the exports folder."
            return result
        if not path.exists():
            result["error"] = "Backup zip does not exist."
            return result
        result["bytes"] = path.stat().st_size
        required = {"backup-manifest.json", "config.json", "references.json"}
        try:
            with zipfile.ZipFile(path) as archive:
                corrupt = archive.testzip()
                names = archive.namelist()
                result["fileCount"] = len(names)
                result["corruptEntry"] = corrupt or ""
                name_set = set(names)
                result["missingCoreFiles"] = sorted(required - name_set)
                if "review_candidates.json" not in name_set and "workspace.sqlite3" not in name_set:
                    result["missingCoreFiles"].append("review_candidates.json or workspace.sqlite3")
                result["dangerousEntries"] = [
                    name
                    for name in names
                    if (
                        name.startswith(("/", "\\\\", "//"))
                        or (len(name) >= 3 and name[1] == ":" and name[2] in {"/", "\\"})
                        or Path(name).is_absolute()
                        or ".." in Path(name).parts
                    )
                ][:20]
                expected_shapes = {
                    "backup-manifest.json": dict,
                    "config.json": dict,
                    "references.json": list,
                    "review_candidates.json": list,
                }
                for name, expected_type in expected_shapes.items():
                    if name not in name_set:
                        continue
                    try:
                        payload = json.loads(archive.read(name).decode("utf-8"))
                    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                        result["invalidCoreFiles"].append(name)
                        result["invalidCoreErrors"][name] = str(exc)
                        continue
                    if not isinstance(payload, expected_type):
                        result["invalidCoreFiles"].append(name)
                        result["invalidCoreErrors"][name] = f"Expected {expected_type.__name__}."
                        continue
                    if name == "backup-manifest.json":
                        result["manifest"] = payload
                if "backup-manifest.json" not in name_set:
                    result["error"] = "Backup manifest is missing."
                result["ok"] = (
                    not corrupt
                    and not result["missingCoreFiles"]
                    and not result["dangerousEntries"]
                    and not result["invalidCoreFiles"]
                    and isinstance(result["manifest"], dict)
                    and bool(result["manifest"])
                )
        except (OSError, zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
            result["error"] = str(exc)
        self._append_audit(
            {
                "action": "verify_workspace_backup",
                "zip_path": str(path),
                "ok": bool(result["ok"]),
                "file_count": int(result["fileCount"]),
                "missing_core_files": result["missingCoreFiles"],
            }
        )
        return result

    def _latest_workspace_backup(self) -> Path | None:
        export_root = self.root / "exports"
        try:
            backups = sorted(export_root.glob("vintrace-workspace-backup-*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)
        except OSError:
            return None
        return backups[0] if backups else None

    def prune_workspace_backups(self, keep: int = 5) -> dict[str, Any]:
        keep = max(1, min(100, int(keep)))
        export_root = self.root / "exports"
        if export_root.exists() and (export_root.is_symlink() or safe_is_mount(export_root)):
            return {
                "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "keep": keep,
                "kept": 0,
                "deleted": 0,
                "deletedBytes": 0,
                "removedPaths": [],
                "blocked": True,
                "message": "Backup pruning skipped because exports is not an app-owned folder.",
            }
        backups = []
        if export_root.exists():
            try:
                backups = sorted(export_root.glob("vintrace-workspace-backup-*.zip"), key=lambda item: item.stat().st_mtime, reverse=True)
            except OSError:
                backups = []
        deleted = 0
        deleted_bytes = 0
        kept = backups[:keep]
        removed_paths: list[str] = []
        for path in backups[keep:]:
            try:
                deleted_bytes += path.stat().st_size
                path.unlink()
                deleted += 1
                removed_paths.append(str(path))
            except OSError:
                continue
        self._append_audit(
            {
                "action": "prune_workspace_backups",
                "keep": keep,
                "deleted": deleted,
                "deleted_bytes": deleted_bytes,
            }
        )
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "keep": keep,
            "kept": len(kept),
            "deleted": deleted,
            "deletedBytes": deleted_bytes,
            "removedPaths": removed_paths[:50],
        }

    def prune_scan_manifests(self, keep_runs: int = 20) -> dict[str, Any]:
        keep_runs = max(1, min(1000, int(keep_runs)))
        before = self.scale_summary()
        db_result = self.db.prune_scan_manifests(keep_runs)
        history_before = len(self.scan_history)
        if len(self.scan_history) > keep_runs:
            self.scan_history = self.scan_history[:keep_runs]
            self.save()
        after = self.scale_summary()
        result = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            **db_result,
            "scanHistoryBefore": history_before,
            "scanHistoryAfter": len(self.scan_history),
            "scanHistoryDeleted": max(0, history_before - len(self.scan_history)),
            "before": before,
            "after": after,
        }
        self._append_audit(
            {
                "action": "prune_scan_manifests",
                "keep_runs": keep_runs,
                "runs_deleted": db_result.get("runsDeleted", 0),
                "files_deleted": db_result.get("filesDeleted", 0),
            }
        )
        return result

    def _candidate_csv_fieldnames(self) -> list[str]:
        return [
            "candidate_id",
            "person_name",
            "status",
            "band",
            "score",
            "quality",
            "source_path",
            "media_kind",
            "media_source_path",
            "video_timestamp_ms",
            "video_frame_index",
            "video_duration_ms",
            "source_hash",
            "best_ref_id",
            "best_ref_path",
            "model_name",
            "note",
            "created_at",
        ]

    def _candidate_csv_row(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return {
            "candidate_id": candidate["candidate_id"],
            "person_name": candidate["person_name"],
            "status": candidate["status"],
            "band": candidate["band"],
            "score": candidate["score"],
            "quality": candidate["quality"],
            "source_path": candidate["source_path"],
            "media_kind": candidate.get("media_kind", "image"),
            "media_source_path": candidate.get("media_source_path", ""),
            "video_timestamp_ms": candidate.get("video_timestamp_ms"),
            "video_frame_index": candidate.get("video_frame_index"),
            "video_duration_ms": candidate.get("video_duration_ms"),
            "source_hash": candidate.get("source_hash", ""),
            "best_ref_id": candidate["best_ref_id"],
            "best_ref_path": candidate["best_ref_path"],
            "model_name": candidate["model_name"],
            "note": candidate["note"],
            "created_at": candidate["created_at"],
        }

    def export_report(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-review-report-{stamp}.json"
        csv_path = export_root / f"vintrace-candidates-{stamp}.csv"
        status_counts = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for candidate in self.candidates.values():
            if candidate.status in status_counts:
                status_counts[candidate.status] += 1
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "references": len(self.references),
                "candidates": len(self.candidates),
                **status_counts,
            },
            "config": asdict(self.config),
            "scanHistory": self.scan_history[:80],
            "references": [self._reference_summary(ref) for ref in sorted(self.references.values(), key=lambda item: (item.person_name.lower(), item.age_bucket, item.source_path))],
            "candidates": [asdict(candidate) for candidate in sorted(self.candidates.values(), key=lambda item: (item.status, item.person_name.lower(), -item.score))],
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=self._candidate_csv_fieldnames(),
            )
            writer.writeheader()
            for candidate in payload["candidates"]:
                writer.writerow(self._candidate_csv_row(candidate))
        self._append_audit({"action": "export_report", "json_path": str(json_path), "csv_path": str(csv_path)})
        return {
            "jsonPath": str(json_path),
            "csvPath": str(csv_path),
            "counts": payload["counts"],
        }

    def export_candidates(self, candidate_ids: list[str], folder: Path | None = None) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(str(candidate_id) for candidate_id in candidate_ids if str(candidate_id).strip()))
        if not unique_ids:
            raise ValueError("Select at least one candidate to export.")
        missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
        if missing:
            raise KeyError(f"Candidate not found: {missing[0]}")
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-selected-candidates-{stamp}.json"
        csv_path = export_root / f"vintrace-selected-candidates-{stamp}.csv"
        selected = [self.candidates[candidate_id] for candidate_id in unique_ids]
        status_counts = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for candidate in selected:
            if candidate.status in status_counts:
                status_counts[candidate.status] += 1
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "references": len(self.references),
                "candidates": len(selected),
                **status_counts,
            },
            "candidates": [asdict(candidate) for candidate in selected],
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=self._candidate_csv_fieldnames(),
            )
            writer.writeheader()
            for candidate in payload["candidates"]:
                writer.writerow(self._candidate_csv_row(candidate))
        self._append_audit({"action": "export_candidates", "count": len(selected), "json_path": str(json_path), "csv_path": str(csv_path)})
        return {
            "jsonPath": str(json_path),
            "csvPath": str(csv_path),
            "counts": payload["counts"],
        }

    def export_scan_history(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-scan-history-{stamp}.json"
        csv_path = export_root / f"vintrace-scan-history-{stamp}.csv"
        metric_keys = [
            "total",
            "processed",
            "added",
            "matched",
            "clustered",
            "skipped",
            "errors",
            "unmatched",
            "safeFiltered",
            "videoFiles",
            "videoFrames",
            "videoProtected",
            "excluded",
            "cancelled",
            "manifestSkipped",
            "embeddingCacheHits",
            "embeddingCacheMisses",
            "twoPassVerified",
            "twoPassChanged",
        ]
        history = list(self.scan_history)
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "runs": len(history),
                "processed": sum(int((row.get("metrics") or {}).get("processed", 0) or 0) for row in history),
                "added": sum(int((row.get("metrics") or {}).get("added", 0) or 0) for row in history),
                "errors": sum(int((row.get("metrics") or {}).get("errors", 0) or 0) for row in history),
            },
            "runs": history,
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            fieldnames = ["runId", "source", "label", "startedAt", "completedAt", "durationMs", *metric_keys, "errorSamples"]
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in history:
                metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
                writer.writerow(
                    {
                        "runId": row.get("runId", ""),
                        "source": row.get("source", ""),
                        "label": row.get("label", ""),
                        "startedAt": row.get("startedAt", ""),
                        "completedAt": row.get("completedAt", ""),
                        "durationMs": row.get("durationMs", 0),
                        **{key: metrics.get(key, 0) for key in metric_keys},
                        "errorSamples": " | ".join(str(item) for item in row.get("errorSamples", [])[:10]) if isinstance(row.get("errorSamples"), list) else "",
                    }
                )
        self._append_audit({"action": "export_scan_history", "json_path": str(json_path), "csv_path": str(csv_path), "runs": len(history)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def export_workspace_inventory(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-workspace-inventory-{stamp}.json"
        csv_path = export_root / f"vintrace-workspace-inventory-{stamp}.csv"
        folder_rows = self.source_folder_summary(limit=500)
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "references": len(self.references),
                "candidates": len(self.candidates),
                "sourceFolders": len(folder_rows),
            },
            "sourceFolders": folder_rows,
            "references": [
                {
                    "refId": ref.ref_id,
                    "personName": ref.person_name,
                    "ageBucket": ref.age_bucket,
                    "sourcePath": ref.source_path,
                    "quality": ref.quality,
                    "modelName": ref.model_name,
                    "createdAt": ref.created_at,
                    "exists": Path(ref.source_path).exists(),
                }
                for ref in sorted(self.references.values(), key=lambda item: (item.person_name.lower(), item.source_path))
            ],
            "candidates": [
                {
                    "candidateId": candidate.candidate_id,
                    "personName": candidate.person_name,
                    "status": candidate.status,
                    "sourcePath": candidate.source_path,
                    "mediaSourcePath": candidate.media_source_path,
                    "mediaKind": candidate.media_kind,
                    "score": candidate.score,
                    "quality": candidate.quality,
                    "createdAt": candidate.created_at,
                    "exists": Path(candidate.source_path).exists(),
                }
                for candidate in sorted(self.candidates.values(), key=lambda item: (item.status, item.person_name.lower(), -item.score))
            ],
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["folder", "references", "candidates", "videos", "missing", "bytes"],
            )
            writer.writeheader()
            for row in folder_rows:
                writer.writerow(row)
        self._append_audit({"action": "export_workspace_inventory", "json_path": str(json_path), "csv_path": str(csv_path), "folders": len(folder_rows)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def export_audit_log(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-activity-log-{stamp}.json"
        csv_path = export_root / f"vintrace-activity-log-{stamp}.csv"
        rows = self._read_audit_rows()
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {"events": len(rows)},
            "events": rows,
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["at", "action", "summary", "json"])
            writer.writeheader()
            for row in rows:
                action = str(row.get("action") or row.get("status") or "event")
                summary = " • ".join(str(row.get(key)) for key in ("person_name", "source", "status", "count") if row.get(key) not in (None, ""))
                writer.writerow({"at": row.get("at", ""), "action": action, "summary": summary, "json": json.dumps(row, separators=(",", ":"))})
        self._append_audit({"action": "export_audit_log", "json_path": str(json_path), "csv_path": str(csv_path), "events": len(rows)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def _read_audit_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not self.audit_path.exists():
            return rows
        try:
            with self.audit_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(value, dict):
                        rows.append(value)
        except OSError:
            return []
        return rows

    def _audit_event_count(self) -> int:
        if not self.audit_path.exists():
            return 0
        try:
            with self.audit_path.open("r", encoding="utf-8") as handle:
                return sum(1 for _ in handle)
        except OSError:
            return 0

    def export_consent_receipt(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-consent-receipt-{stamp}.json"
        csv_path = export_root / f"vintrace-consent-receipt-{stamp}.csv"
        consent_events = [
            row
            for row in self._read_audit_rows()
            if row.get("action") == "set_consent"
        ]
        counts = {
            "references": len(self.references),
            "candidates": len(self.candidates),
            "people": len({ref.person_name.casefold() for ref in self.references.values()}),
            "pending": sum(1 for candidate in self.candidates.values() if candidate.status == "pending"),
            "reviewed": sum(1 for candidate in self.candidates.values() if candidate.status != "pending"),
            "scanRuns": len(self.scan_history),
            "consentEvents": len(consent_events),
        }
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "workspaceMetadata": self.workspace_metadata,
            "consent": {
                **self.consent_summary(),
                "note": str(self.consent.get("note", "")),
                "workspaceId": self.consent.get("workspaceId"),
            },
            "policy": {
                "requireConsent": bool(self.config.require_consent),
                "reviewOnly": bool(self.config.review_only),
                "safeMode": bool(self.config.safe_mode),
                "safeModeThreshold": float(self.config.safe_mode_threshold),
            },
            "counts": counts,
            "latestConsentEvent": consent_events[-1] if consent_events else None,
            "note": "Receipt only. It does not include photos, videos, thumbnails, face vectors, or model files.",
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["field", "value"])
            writer.writerow(["generatedAt", payload["generatedAt"]])
            writer.writerow(["workspaceId", self.workspace_metadata.get("workspaceId", "")])
            writer.writerow(["consentActive", payload["consent"]["active"]])
            writer.writerow(["operator", payload["consent"]["operator"]])
            writer.writerow(["source", payload["consent"]["source"]])
            writer.writerow(["scope", payload["consent"]["scope"]])
            writer.writerow(["confirmedAt", payload["consent"]["confirmedAt"]])
            writer.writerow(["updatedAt", payload["consent"]["updatedAt"]])
            writer.writerow(["requireConsent", payload["policy"]["requireConsent"]])
            writer.writerow(["reviewOnly", payload["policy"]["reviewOnly"]])
            writer.writerow(["safeMode", payload["policy"]["safeMode"]])
            for key, value in counts.items():
                writer.writerow([key, value])
        self._append_audit({"action": "export_consent_receipt", "json_path": str(json_path), "csv_path": str(csv_path), "active": self.consent_on_file()})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": counts}

    def retention_policy_report(self) -> dict[str, Any]:
        now_ts = datetime.now(timezone.utc).timestamp()
        windows = [30, 90, 180, 365]
        by_status = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        reviewed = 0
        invalid_dates = 0
        oldest_reviewed_days = 0
        older_than = {str(days): 0 for days in windows}
        for candidate in self.candidates.values():
            by_status[candidate.status] = by_status.get(candidate.status, 0) + 1
            if candidate.status == "pending":
                continue
            reviewed += 1
            try:
                created_ts = datetime.fromisoformat(candidate.created_at.replace("Z", "+00:00")).timestamp()
            except (TypeError, ValueError):
                created_ts = 0.0
                invalid_dates += 1
            age_days = max(0, int((now_ts - created_ts) // (24 * 60 * 60))) if created_ts else 3650
            oldest_reviewed_days = max(oldest_reviewed_days, age_days)
            for days in windows:
                if age_days >= days:
                    older_than[str(days)] += 1
        privacy = self.privacy_report()
        recommendations: list[str] = []
        if reviewed:
            recommendations.append("Export the review ledger before purging old reviewed matches.")
        if older_than["90"]:
            recommendations.append(f"{older_than['90']} reviewed match row(s) are older than 90 days and can be purged if no longer needed.")
        if privacy["generatedBytes"] > 512 * 1024 * 1024:
            recommendations.append("Generated previews and video frames are sizable; run Optimize app folder after exports.")
        if invalid_dates:
            recommendations.append("Some review rows have missing dates; export the ledger before cleanup.")
        if not recommendations:
            recommendations.append("No immediate retention cleanup is needed.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "counts": {
                "candidates": len(self.candidates),
                "reviewedCandidates": reviewed,
                "pendingCandidates": by_status.get("pending", 0),
                "invalidDates": invalid_dates,
                "scanHistory": len(self.scan_history),
                "auditEvents": self._audit_event_count(),
                "generatedFiles": privacy["generatedFiles"],
                "generatedBytes": privacy["generatedBytes"],
            },
            "byStatus": by_status,
            "reviewedOlderThanDays": older_than,
            "oldestReviewedAgeDays": oldest_reviewed_days,
            "policy": {
                "recommendedReviewedRetentionDays": 90,
                "reviewedStatuses": ["accepted", "rejected", "uncertain"],
                "pendingRowsAreKept": True,
                "originalMediaIsNeverDeleted": True,
            },
            "recommendations": recommendations,
        }

    def export_safe_mode_audit(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-safe-mode-audit-{stamp}.json"
        csv_path = export_root / f"vintrace-safe-mode-runs-{stamp}.csv"
        metric_keys = ["processed", "safeFiltered", "videoProtected", "videoFrames", "errors", "added"]
        totals = {key: 0 for key in metric_keys}
        run_rows: list[dict[str, Any]] = []
        for run in self.scan_history:
            metrics = run.get("metrics") if isinstance(run.get("metrics"), dict) else {}
            for key in metric_keys:
                totals[key] += int(metrics.get(key, 0) or 0)
            run_rows.append(
                {
                    "runId": run.get("runId", ""),
                    "label": run.get("label", ""),
                    "source": run.get("source", ""),
                    "startedAt": run.get("startedAt", ""),
                    "completedAt": run.get("completedAt", ""),
                    **{key: int(metrics.get(key, 0) or 0) for key in metric_keys},
                }
            )
        calibration = self.calibration_summary()
        scale = self.scale_summary()
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "policy": {
                "safeMode": bool(self.config.safe_mode),
                "safeModeThreshold": float(self.config.safe_mode_threshold),
                "protectedMediaExcludedFromMatching": True,
                "protectedMediaExcludedFromClustering": True,
                "originalMediaIsNeverModified": True,
            },
            "model": safety_model_report(),
            "counts": {
                "scanRuns": len(self.scan_history),
                "safetyCacheEntries": int(scale.get("safetyCacheEntries", 0) or 0),
                "safeLabels": calibration.get("safeLabels", {}),
                **totals,
            },
            "runs": run_rows,
            "recommendations": [
                "Keep Safe Mode on for shared libraries.",
                "Review Safe Mode audit counts after every large scan.",
            ],
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            fieldnames = ["runId", "label", "source", "startedAt", "completedAt", *metric_keys]
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in run_rows:
                writer.writerow(row)
        self._append_audit({"action": "export_safe_mode_audit", "json_path": str(json_path), "csv_path": str(csv_path), "protected": totals["safeFiltered"] + totals["videoProtected"]})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def model_drift_report(self, current_model: str) -> dict[str, Any]:
        current = str(current_model or "unknown")
        reference_models: dict[str, int] = {}
        candidate_models: dict[str, int] = {}
        stale_references = []
        stale_candidates = []
        stale_by_status = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for ref in self.references.values():
            model = ref.model_name or "unknown"
            reference_models[model] = reference_models.get(model, 0) + 1
            if model != current:
                stale_references.append(
                    {
                        "refId": ref.ref_id,
                        "personName": ref.person_name,
                        "ageBucket": ref.age_bucket,
                        "modelName": model,
                        "createdAt": ref.created_at,
                    }
                )
        for candidate in self.candidates.values():
            model = candidate.model_name or "unknown"
            candidate_models[model] = candidate_models.get(model, 0) + 1
            if model != current:
                stale_by_status[candidate.status] = stale_by_status.get(candidate.status, 0) + 1
                stale_candidates.append(
                    {
                        "candidateId": candidate.candidate_id,
                        "personName": candidate.person_name,
                        "status": candidate.status,
                        "score": candidate.score,
                        "modelName": model,
                        "createdAt": candidate.created_at,
                    }
                )
        recommendations: list[str] = []
        if stale_references:
            recommendations.append("Some saved person photos were embedded with a different model; re-enroll those references for consistent scoring.")
        if stale_candidates:
            recommendations.append("Some review rows were scored with a different model; rescan or recheck those rows before bulk decisions.")
        if not stale_references and not stale_candidates:
            recommendations.append("Saved references and review rows match the active recognition model.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "currentModel": current,
            "modelPack": self.config.model_pack,
            "counts": {
                "references": len(self.references),
                "candidates": len(self.candidates),
                "staleReferences": len(stale_references),
                "staleCandidates": len(stale_candidates),
            },
            "referenceModels": dict(sorted(reference_models.items())),
            "candidateModels": dict(sorted(candidate_models.items())),
            "staleByStatus": stale_by_status,
            "samples": {
                "references": stale_references[:20],
                "candidates": stale_candidates[:20],
            },
            "recommendations": recommendations,
        }

    def export_review_ledger(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-review-ledger-{stamp}.json"
        csv_path = export_root / f"vintrace-review-ledger-{stamp}.csv"
        decision_actions = {
            "set_candidate_status",
            "bulk_set_candidate_status",
            "block_false_match",
            "reassign_candidate_person",
            "apply_review_rules",
            "set_candidate_note",
        }
        decision_events = []
        for row in self._read_audit_rows():
            action = str(row.get("action") or "")
            if action in decision_actions or (row.get("candidate_id") and row.get("status")):
                decision_events.append(row)
        candidates = [
            {
                "candidateId": candidate.candidate_id,
                "personName": candidate.person_name,
                "status": candidate.status,
                "score": round(float(candidate.score), 6),
                "band": candidate.band,
                "quality": round(float(candidate.quality), 6),
                "mediaKind": candidate.media_kind,
                "sourcePath": candidate.source_path,
                "mediaSourcePath": candidate.media_source_path,
                "videoTimestampMs": candidate.video_timestamp_ms,
                "bestRefId": candidate.best_ref_id,
                "bestRefPath": candidate.best_ref_path,
                "modelName": candidate.model_name,
                "sourceHash": candidate.source_hash,
                "note": candidate.note,
                "createdAt": candidate.created_at,
            }
            for candidate in sorted(self.candidates.values(), key=lambda item: (item.status, item.person_name.lower(), -item.score))
        ]
        status_counts = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for row in candidates:
            status = str(row["status"])
            status_counts[status] = status_counts.get(status, 0) + 1
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "candidates": len(candidates),
                "decisionEvents": len(decision_events),
                **status_counts,
            },
            "candidates": candidates,
            "decisionEvents": decision_events,
            "note": "Ledger contains review decisions and metadata only. It does not include photos, thumbnails, face vectors, or model files.",
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            fieldnames = [
                "candidateId",
                "personName",
                "status",
                "score",
                "band",
                "quality",
                "mediaKind",
                "sourcePath",
                "mediaSourcePath",
                "videoTimestampMs",
                "bestRefId",
                "bestRefPath",
                "modelName",
                "sourceHash",
                "note",
                "createdAt",
            ]
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in candidates:
                writer.writerow(row)
        self._append_audit({"action": "export_review_ledger", "json_path": str(json_path), "csv_path": str(csv_path), "candidates": len(candidates), "decision_events": len(decision_events)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def export_media_bundle(
        self,
        candidate_ids: list[str] | None = None,
        folder: Path | None = None,
        statuses: list[str] | None = None,
        include_original_media: bool = True,
    ) -> dict[str, Any]:
        status_set = set(statuses or ["accepted"])
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        if not status_set or not status_set <= allowed:
            raise ValueError("Export statuses must be selected from pending, accepted, rejected, and uncertain.")
        if candidate_ids:
            unique_ids = list(dict.fromkeys(str(candidate_id) for candidate_id in candidate_ids if str(candidate_id).strip()))
            selected = [self.candidates[candidate_id] for candidate_id in unique_ids if candidate_id in self.candidates]
            missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
            if missing:
                raise KeyError(f"Candidate not found: {missing[0]}")
        else:
            selected = [candidate for candidate in self.candidates.values() if candidate.status in status_set]
        if not selected:
            raise ValueError("No matching review items are ready to export.")

        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        bundle_root = export_root / f"vintrace-media-bundle-{stamp}"
        counter = 2
        while bundle_root.exists():
            bundle_root = export_root / f"vintrace-media-bundle-{stamp}-{counter}"
            counter += 1
        media_root = bundle_root / "media"
        media_root.mkdir(parents=True, exist_ok=True)
        manifest_rows: list[dict[str, Any]] = []
        copied_sources: dict[str, str] = {}
        copied = 0
        missing_files = 0
        for index, candidate in enumerate(sorted(selected, key=lambda item: (item.person_name.lower(), item.status, -item.score)), start=1):
            source = Path(candidate.media_source_path if include_original_media and candidate.media_source_path else candidate.source_path)
            if not source.exists() or not source.is_file():
                missing_files += 1
                manifest_rows.append(self._export_bundle_row(candidate, "", "missing"))
                continue
            source_key = str(source.resolve())
            person_dir = media_root / self._safe_filename(candidate.person_name or "Unlabeled")
            status_dir = person_dir / self._safe_filename(candidate.status)
            status_dir.mkdir(parents=True, exist_ok=True)
            suffix = source.suffix.lower() or ".bin"
            target_name = f"{index:05d}-{self._safe_filename(source.stem)[:80]}{suffix}"
            target = status_dir / target_name
            if source_key not in copied_sources:
                try:
                    shutil.copy2(source, target)
                    copied_sources[source_key] = str(target)
                    copied += 1
                    copied_path = str(target)
                    copy_status = "copied"
                except OSError as exc:
                    missing_files += 1
                    copied_path = ""
                    copy_status = f"copy_error: {exc}"
            else:
                copied_path = copied_sources[source_key]
                copy_status = "duplicate_source"
            manifest_rows.append(self._export_bundle_row(candidate, copied_path, copy_status))

        manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "bundlePath": str(bundle_root),
            "includeOriginalMedia": bool(include_original_media),
            "counts": {
                "selected": len(selected),
                "copied": copied,
                "missing": missing_files,
            },
            "items": manifest_rows,
            "note": "Vintrace exports reviewed media for sharing; possible matches still require human judgment.",
        }
        manifest_path = bundle_root / "manifest.json"
        csv_path = bundle_root / "manifest.csv"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "candidate_id",
                    "person_name",
                    "status",
                    "score",
                    "source_path",
                    "exported_path",
                    "media_kind",
                    "video_timestamp_ms",
                    "source_hash",
                    "copy_status",
                ],
            )
            writer.writeheader()
            for row in manifest_rows:
                writer.writerow(row)
        self._append_audit(
            {
                "action": "export_media_bundle",
                "bundle_path": str(bundle_root),
                "selected": len(selected),
                "copied": copied,
                "missing": missing_files,
                "statuses": sorted(status_set),
            }
        )
        return {
            "bundlePath": str(bundle_root),
            "manifestPath": str(manifest_path),
            "csvPath": str(csv_path),
            "counts": manifest["counts"],
        }

    def accuracy_evaluation(self) -> dict[str, Any]:
        labeled = [
            candidate
            for candidate in self.candidates.values()
            if candidate.status in {"accepted", "rejected"}
        ]
        thresholds = {
            "reviewMore": float(self.config.thresholds.relaxed_child),
            "likely": float(self.config.thresholds.likely),
            "strong": float(self.config.thresholds.confident),
        }
        metrics = {name: self._accuracy_at_threshold(labeled, threshold) for name, threshold in thresholds.items()}
        segments = {
            "images": self._accuracy_at_threshold([item for item in labeled if item.media_kind != "video"], thresholds["likely"]),
            "videos": self._accuracy_at_threshold([item for item in labeled if item.media_kind == "video"], thresholds["likely"]),
            "lowQuality": self._accuracy_at_threshold([item for item in labeled if item.quality < self.config.thresholds.quality_min], thresholds["likely"]),
        }
        recommendations: list[str] = []
        likely = metrics["likely"]
        if likely["labeled"] < 20:
            recommendations.append("Review and accept/reject at least 20 items before trusting calibration numbers.")
        if likely["falsePositives"] > likely["truePositives"]:
            recommendations.append("Likely match level may be too low; raise it or use High confidence mode.")
        if likely["falseNegatives"] > 0 and likely["precision"] >= 0.85:
            recommendations.append("Likely match level may be conservative; lower it slightly if you want more recall.")
        if segments["videos"]["labeled"] and segments["videos"]["precision"] < likely["precision"]:
            recommendations.append("Video frames are noisier than photos; review video moments before bulk accepting.")
        if not recommendations:
            recommendations.append("Accuracy labels are within the expected local review range.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "thresholds": thresholds,
            "metrics": metrics,
            "segments": segments,
            "recommendations": recommendations,
        }

    def apply_calibration_to_config(self) -> dict[str, Any]:
        summary = self.calibration_summary()
        recommended = summary.get("recommendedLikelyThreshold")
        if recommended is None:
            evaluation = self.accuracy_evaluation()
            likely_metrics = evaluation["metrics"]["likely"]
            if likely_metrics["labeled"] < 8:
                raise ValueError("Review more accepted and rejected matches before applying calibration.")
            recommended = self.config.thresholds.likely
            if likely_metrics["falsePositives"] > likely_metrics["falseNegatives"]:
                recommended = min(0.92, recommended + 0.04)
            elif likely_metrics["falseNegatives"] > 0:
                recommended = max(0.08, recommended - 0.03)
        likely = max(0.05, min(0.9, float(recommended)))
        self.config.thresholds.likely = likely
        self.config.thresholds.confident = max(likely, min(0.98, likely + 0.12))
        self.config.thresholds.relaxed_child = max(0.02, min(likely, likely - 0.08))
        self._append_audit(
            {
                "action": "apply_calibration_to_config",
                "likely": self.config.thresholds.likely,
                "confident": self.config.thresholds.confident,
                "relaxed_child": self.config.thresholds.relaxed_child,
                "labels": summary.get("totalLabels", 0),
            }
        )
        self.save()
        return {"summary": self.calibration_summary(), "config": asdict(self.config)}

    def export_accuracy_labels(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-accuracy-labels-{stamp}.json"
        csv_path = export_root / f"vintrace-accuracy-labels-{stamp}.csv"
        rows = [
            {
                "candidateId": candidate.candidate_id,
                "sourcePath": candidate.source_path,
                "sourceHash": candidate.source_hash,
                "expectedPerson": candidate.person_name,
                "actualPerson": candidate.person_name if candidate.status == "accepted" else "",
                "matchScore": candidate.score,
                "quality": candidate.quality,
                "isMatch": candidate.status == "accepted",
                "status": candidate.status,
                "mediaKind": candidate.media_kind,
                "createdAt": candidate.created_at,
            }
            for candidate in sorted(self.candidates.values(), key=lambda item: (item.status, item.person_name.lower(), -item.score))
            if candidate.status in {"accepted", "rejected"}
        ]
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "labels": len(rows),
                "matches": sum(1 for row in rows if row["isMatch"]),
                "nonMatches": sum(1 for row in rows if not row["isMatch"]),
            },
            "labels": rows,
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "candidateId",
                    "sourcePath",
                    "sourceHash",
                    "expectedPerson",
                    "actualPerson",
                    "matchScore",
                    "quality",
                    "isMatch",
                    "status",
                    "mediaKind",
                    "createdAt",
                ],
            )
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        self._append_audit({"action": "export_accuracy_labels", "json_path": str(json_path), "csv_path": str(csv_path), "count": len(rows)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": payload["counts"]}

    def import_accuracy_labels(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        imported = 0
        skipped = 0
        for row in rows:
            if not isinstance(row, dict):
                skipped += 1
                continue
            candidate_id = str(row.get("candidateId", "")).strip()
            candidate = self.candidates.get(candidate_id) if candidate_id else None
            score = row.get("matchScore", candidate.score if candidate else None)
            try:
                match_score = None if score is None or score == "" else float(score)
            except (TypeError, ValueError):
                skipped += 1
                continue
            raw_match = row.get("isMatch")
            if isinstance(raw_match, str):
                is_match = raw_match.strip().lower() in {"1", "true", "yes", "match", "accepted"}
            else:
                is_match = bool(raw_match)
            source_path = str(row.get("sourcePath") or (candidate.source_path if candidate else "")).strip()
            if not source_path:
                skipped += 1
                continue
            self.db.add_calibration_label(
                new_id("label"),
                {
                    "sourcePath": source_path,
                    "fileHash": str(row.get("sourceHash") or (candidate.source_hash if candidate else "")),
                    "expectedPerson": str(row.get("expectedPerson") or (candidate.person_name if candidate else "")),
                    "actualPerson": str(row.get("actualPerson") or ((candidate.person_name if candidate else "") if is_match else "")),
                    "matchScore": match_score,
                    "isMatch": is_match,
                    "safeLabel": str(row.get("safeLabel", "")),
                },
            )
            imported += 1
        summary = self.calibration_summary()
        self._append_audit({"action": "import_accuracy_labels", "imported": imported, "skipped": skipped})
        return {"imported": imported, "skipped": skipped, "summary": summary}

    def privacy_report(self) -> dict[str, Any]:
        generated_bytes = 0
        generated_files = 0
        for root in (self.previews_path, self.video_frames_path):
            if not root.exists() or not self._generated_dir_is_owned(root):
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                try:
                    generated_bytes += path.stat().st_size
                    generated_files += 1
                except OSError:
                    continue
        scale = self.scale_summary()
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "references": len(self.references),
            "candidates": len(self.candidates),
            "scanHistory": len(self.scan_history),
            "generatedFiles": generated_files,
            "generatedBytes": generated_bytes,
            "safetyCacheEntries": int(scale.get("safetyCacheEntries", 0) or 0),
            "embeddingCacheEntries": int(scale.get("embeddingCacheEntries", 0) or 0),
            "calibrationLabels": int(scale.get("calibrationLabels", 0) or 0),
            "auditEvents": self._audit_event_count(),
            "recommendations": [
                "Use Delete face data before handing this app folder to someone else.",
                "Export what you need first; deleted face data cannot be restored unless you have a backup.",
            ],
        }

    def delete_face_data(self, confirm: bool = False, include_audit: bool = False) -> dict[str, Any]:
        if not confirm:
            raise ValueError("Face data deletion requires confirm=true.")
        before = self.privacy_report()
        self.references.clear()
        self.candidates.clear()
        self.scan_history.clear()
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        self.vector_store.rebuild({})
        for generated_path in (self.previews_path, self.video_frames_path):
            if self._generated_dir_is_owned(generated_path):
                shutil.rmtree(generated_path, ignore_errors=True)
        self.clear_scan_pause()
        try:
            self.cancel_scan_path.unlink()
        except OSError:
            pass
        db_deleted = self.db.clear_private_data(include_scan_history=True)
        self._append_audit(
            {
                "action": "delete_face_data",
                "references": before["references"],
                "candidates": before["candidates"],
                "generated_files": before["generatedFiles"],
                "include_audit": bool(include_audit),
            }
        )
        self.save()
        if include_audit:
            try:
                self.audit_path.unlink()
            except OSError:
                pass
        return {
            "before": before,
            "dbDeleted": db_deleted,
            "after": self.privacy_report(),
        }

    def optimize_workspace(self) -> dict[str, Any]:
        preview_files = 0
        preview_bytes = 0
        skipped_unowned: list[str] = []
        if self.previews_path.exists() and self._generated_dir_is_owned(self.previews_path):
            for path in sorted(self.previews_path.rglob("*"), reverse=True):
                if path.is_file():
                    try:
                        preview_bytes += path.stat().st_size
                        path.unlink()
                        preview_files += 1
                    except OSError:
                        continue
            shutil.rmtree(self.previews_path, ignore_errors=True)
        elif self.previews_path.exists():
            skipped_unowned.append(str(self.previews_path))

        keep_video_frames: set[str] = set()
        for candidate in self.candidates.values():
            try:
                source = Path(candidate.source_path).expanduser().resolve()
                if self.video_frames_path in source.parents:
                    keep_video_frames.add(str(source))
            except OSError:
                continue
        orphan_frames = 0
        orphan_frame_bytes = 0
        if self.video_frames_path.exists() and self._generated_dir_is_owned(self.video_frames_path):
            for path in sorted(self.video_frames_path.rglob("*"), reverse=True):
                if path.is_file():
                    try:
                        resolved = str(path.expanduser().resolve())
                        if resolved in keep_video_frames:
                            continue
                        orphan_frame_bytes += path.stat().st_size
                        path.unlink()
                        orphan_frames += 1
                    except OSError:
                        continue
                elif path.is_dir():
                    try:
                        path.rmdir()
                    except OSError:
                        pass
        elif self.video_frames_path.exists():
            skipped_unowned.append(str(self.video_frames_path))

        db_result = self.db.optimize()
        total_reclaimed = preview_bytes + orphan_frame_bytes + int(db_result.get("dbBytesReclaimed", 0))
        result = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "previewFilesRemoved": preview_files,
            "previewBytesRemoved": preview_bytes,
            "orphanVideoFramesRemoved": orphan_frames,
            "orphanVideoFrameBytesRemoved": orphan_frame_bytes,
            **db_result,
            "totalBytesReclaimed": total_reclaimed,
            "skippedUnownedGeneratedDirs": skipped_unowned,
        }
        self._append_audit({"action": "optimize_workspace", **result})
        return result

    def enforce_storage_budget(self) -> dict[str, Any]:
        before = self.workspace_health()
        budget = int(before.get("storageBudgetBytes", 0) or 0)
        if budget <= 0:
            return {
                "before": before,
                "optimized": None,
                "after": before,
                "withinBudget": True,
                "message": "No storage limit is set.",
            }
        optimized = self.optimize_workspace()
        after = self.workspace_health()
        return {
            "before": before,
            "optimized": optimized,
            "after": after,
            "withinBudget": int(after.get("storageOverBudgetBytes", 0) or 0) <= 0,
            "message": "Generated cache cleaned. Original photos and videos were not touched.",
        }

    def _export_bundle_row(self, candidate: ReviewCandidate, exported_path: str, copy_status: str) -> dict[str, Any]:
        return {
            "candidate_id": candidate.candidate_id,
            "person_name": candidate.person_name,
            "status": candidate.status,
            "score": round(float(candidate.score), 6),
            "source_path": candidate.source_path,
            "exported_path": exported_path,
            "media_kind": candidate.media_kind,
            "video_timestamp_ms": candidate.video_timestamp_ms,
            "source_hash": candidate.source_hash,
            "copy_status": copy_status,
        }

    def _accuracy_at_threshold(self, candidates: list[ReviewCandidate], threshold: float) -> dict[str, Any]:
        true_positive = false_positive = true_negative = false_negative = 0
        for candidate in candidates:
            expected_match = candidate.status == "accepted"
            predicted_match = float(candidate.score) >= threshold
            if expected_match and predicted_match:
                true_positive += 1
            elif not expected_match and predicted_match:
                false_positive += 1
            elif not expected_match and not predicted_match:
                true_negative += 1
            else:
                false_negative += 1
        precision = true_positive / max(1, true_positive + false_positive)
        recall = true_positive / max(1, true_positive + false_negative)
        specificity = true_negative / max(1, true_negative + false_positive)
        return {
            "threshold": round(float(threshold), 4),
            "labeled": len(candidates),
            "truePositives": true_positive,
            "falsePositives": false_positive,
            "trueNegatives": true_negative,
            "falseNegatives": false_negative,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "specificity": round(specificity, 4),
        }

    def _safe_filename(self, value: str) -> str:
        cleaned = "".join(character if character.isalnum() or character in {"-", "_", ".", " "} else "_" for character in value.strip())
        cleaned = "-".join(cleaned.split())
        return cleaned[:120] or "item"

    def workspace_health(self) -> dict[str, Any]:
        folders: dict[str, dict[str, Any]] = {}
        path_status_cache: dict[str, tuple[bool, int]] = {}

        def path_status(path_value: str) -> tuple[bool, int]:
            key = str(path_value or "")
            if not key:
                return False, 0
            cached = path_status_cache.get(key)
            if cached is not None:
                return cached
            try:
                path = Path(key).expanduser()
                result = (True, path.stat().st_size)
            except (OSError, ValueError):
                result = (False, 0)
            if len(path_status_cache) < 200_000:
                path_status_cache[key] = result
            return result

        def folder_row(path_value: str) -> dict[str, Any]:
            try:
                folder = str(Path(path_value).expanduser().parent)
            except (OSError, ValueError):
                folder = ""
            return folders.setdefault(
                folder,
                {
                    "folder": folder,
                    "references": 0,
                    "candidates": 0,
                    "videos": 0,
                    "missing": 0,
                    "bytes": 0,
                },
            )

        missing_reference_samples: list[dict[str, Any]] = []
        missing_candidate_samples: list[dict[str, Any]] = []
        missing_media_source_samples: list[dict[str, Any]] = []
        missing_references = 0
        missing_candidates = 0
        missing_media_sources = 0
        reviewed_ready = 0
        for ref in self.references.values():
            row = folder_row(ref.source_path)
            row["references"] += 1
            exists, size = path_status(ref.source_path)
            if exists:
                row["bytes"] += size
            else:
                row["missing"] += 1
                missing_references += 1
                if len(missing_reference_samples) < 20:
                    missing_reference_samples.append(
                        {
                            "refId": ref.ref_id,
                            "personName": ref.person_name,
                            "sourcePath": ref.source_path,
                            "ageBucket": ref.age_bucket,
                        }
                    )
        for candidate in self.candidates.values():
            source = candidate.media_source_path or candidate.source_path
            row = folder_row(source)
            row["candidates"] += 1
            if candidate.media_kind == "video":
                row["videos"] += 1
            source_exists, source_size = path_status(source)
            if source_exists:
                row["bytes"] += source_size
            else:
                row["missing"] += 1
            candidate_exists, _candidate_size = path_status(candidate.source_path)
            if not candidate_exists:
                missing_candidates += 1
                if len(missing_candidate_samples) < 20:
                    missing_candidate_samples.append(
                        {
                            "candidateId": candidate.candidate_id,
                            "personName": candidate.person_name,
                            "sourcePath": candidate.source_path,
                            "status": candidate.status,
                            "score": candidate.score,
                        }
                    )
            if candidate.media_source_path:
                media_exists, _media_size = path_status(candidate.media_source_path)
                if not media_exists:
                    missing_media_sources += 1
                    if len(missing_media_source_samples) < 20:
                        missing_media_source_samples.append(
                            {
                                "candidateId": candidate.candidate_id,
                                "personName": candidate.person_name,
                                "mediaSourcePath": candidate.media_source_path,
                                "sourcePath": candidate.source_path,
                            }
                        )
            if candidate.status in {"accepted", "rejected", "uncertain"}:
                reviewed_ready += 1
        source_folders = sorted(
            folders.values(),
            key=lambda item: (int(item["references"]) + int(item["candidates"]), int(item["bytes"])),
            reverse=True,
        )[:12]
        duplicate_summary = self._duplicate_candidate_summary(limit=20)
        storage_bytes = 0
        file_count = 0
        for current, _dirnames, filenames in os.walk(self.root):
            for filename in filenames:
                path = Path(current) / filename
                try:
                    if path.is_file():
                        storage_bytes += path.stat().st_size
                        file_count += 1
                except OSError:
                    continue
        audit_events = 0
        if self.audit_path.exists():
            try:
                with self.audit_path.open("r", encoding="utf-8") as handle:
                    audit_events = sum(1 for _ in handle)
            except OSError:
                audit_events = 0
        recommendations: list[str] = []
        if missing_references:
            recommendations.append("Some enrolled reference files are missing from disk.")
        if missing_candidates:
            recommendations.append("Some review candidates point to files that are no longer on disk.")
        if missing_media_sources:
            recommendations.append("Some video candidates point to original media files that are no longer on disk.")
        if duplicate_summary["duplicateCandidateCount"]:
            recommendations.append("Duplicate review rows can be compacted while keeping the strongest candidate.")
        if reviewed_ready:
            recommendations.append("Reviewed candidates are ready for audit export or queue purge.")
        budget = max(0, int(self.config.storage_budget_bytes or 0))
        over_budget = max(0, storage_bytes - budget) if budget else 0
        if budget and over_budget:
            recommendations.append("App folder is above the selected storage limit. Clean generated cache or raise the limit.")
        if not recommendations:
            recommendations.append("Workspace looks healthy.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "storageBytes": storage_bytes,
            "storageBudgetBytes": budget,
            "storageOverBudgetBytes": over_budget,
            "storageBudgetPercent": min(999.0, storage_bytes / budget) if budget else 0.0,
            "workspaceFileCount": file_count,
            "auditEvents": audit_events,
            "missingReferences": missing_references,
            "missingCandidates": missing_candidates,
            "missingMediaSources": missing_media_sources,
            "missingReferenceSamples": missing_reference_samples,
            "missingCandidateSamples": missing_candidate_samples,
            "missingMediaSourceSamples": missing_media_source_samples,
            "sourceFolders": source_folders,
            "reviewedReadyToPurge": reviewed_ready,
            "duplicateGroups": duplicate_summary["groups"],
            "duplicateCandidateCount": duplicate_summary["duplicateCandidateCount"],
            "recommendations": recommendations,
        }

    def source_folder_summary(self, limit: int = 12) -> list[dict[str, Any]]:
        folders: dict[str, dict[str, Any]] = {}
        path_status_cache: dict[str, tuple[bool, int]] = {}

        def path_status(path_value: str) -> tuple[bool, int]:
            key = str(path_value or "")
            if not key:
                return False, 0
            cached = path_status_cache.get(key)
            if cached is not None:
                return cached
            try:
                path = Path(key).expanduser()
                result = (True, path.stat().st_size)
            except (OSError, ValueError):
                result = (False, 0)
            if len(path_status_cache) < 200_000:
                path_status_cache[key] = result
            return result

        def row_for(path_value: str) -> dict[str, Any]:
            try:
                folder = str(Path(path_value).expanduser().parent)
            except (OSError, ValueError):
                folder = ""
            row = folders.setdefault(
                folder,
                {
                    "folder": folder,
                    "references": 0,
                    "candidates": 0,
                    "videos": 0,
                    "missing": 0,
                    "bytes": 0,
                },
            )
            return row

        for ref in self.references.values():
            row = row_for(ref.source_path)
            row["references"] += 1
            exists, size = path_status(ref.source_path)
            if not exists:
                row["missing"] += 1
            else:
                row["bytes"] += size
        for candidate in self.candidates.values():
            source = candidate.media_source_path or candidate.source_path
            row = row_for(source)
            row["candidates"] += 1
            if candidate.media_kind == "video":
                row["videos"] += 1
            exists, size = path_status(source)
            if not exists:
                row["missing"] += 1
            else:
                row["bytes"] += size
        return sorted(
            folders.values(),
            key=lambda item: (int(item["references"]) + int(item["candidates"]), int(item["bytes"])),
            reverse=True,
        )[:max(1, min(1000, int(limit)))]

    def preview_path_for(self, value: str | None, create: bool = True) -> str | None:
        if not value:
            return None
        source = Path(value).expanduser()
        if not source.exists() or not source.is_file() or not needs_browser_preview(source):
            return None
        try:
            preview = self._preview_cache_path(source)
            if not create and not preview.exists():
                return None
            if not preview.exists() or preview.stat().st_size <= 0:
                self._ensure_generated_dir_sentinel(self.previews_path)
                if not self._generated_dir_is_owned(self.previews_path):
                    return None
                write_preview_image(source, preview)
            return str(preview)
        except (ImageLoadError, OSError, ValueError):
            return None

    def prepare_previews(self, limit: int = 32) -> int:
        limit = max(1, min(256, int(limit)))
        prepared = 0
        seen: set[str] = set()

        def maybe_prepare(value: str | None) -> bool:
            nonlocal prepared
            if prepared >= limit or not value or value in seen:
                return prepared >= limit
            seen.add(value)
            if self.preview_path_for(value, create=False):
                return False
            if self.preview_path_for(value, create=True):
                prepared += 1
            return prepared >= limit

        for ref in self.references.values():
            if maybe_prepare(ref.source_path):
                return prepared
        for candidate in self.candidates.values():
            if maybe_prepare(candidate.source_path):
                return prepared
            if maybe_prepare(candidate.best_ref_path):
                return prepared
        return prepared

    def _preview_cache_path(self, source: Path) -> Path:
        stat = source.stat()
        cache_key = hashlib.sha256(
            f"{source.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|preview-v2".encode("utf-8")
        ).hexdigest()[:32]
        return self.previews_path / f"{cache_key}.jpg"

    def _path_key(self, value: str) -> str:
        try:
            return image_record_for_path(Path(value)).sha256
        except Exception:
            return value

    def _candidate_duplicate_source(self, candidate: ReviewCandidate) -> str:
        if candidate.media_kind == "video" and candidate.media_source_path:
            return f"video:{candidate.media_source_path}"
        if candidate.source_hash:
            return f"sha256:{candidate.source_hash}"
        return candidate.source_path

    def _rank_duplicate_candidates(self, candidates: list[ReviewCandidate]) -> list[ReviewCandidate]:
        status_weight = {"accepted": 4, "pending": 3, "uncertain": 2, "rejected": 1}
        return sorted(
            candidates,
            key=lambda candidate: (
                status_weight.get(candidate.status, 0),
                candidate.score,
                candidate.quality,
                candidate.created_at,
            ),
            reverse=True,
        )

    def _append_audit(self, row: dict[str, object]) -> None:
        audit_row = {"at": datetime.utcnow().isoformat(timespec="seconds") + "Z", **row}
        with self._state_lock():
            with self.audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(audit_row) + "\n")

    def audit_events(self, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        limit = max(1, min(500, int(limit)))
        offset = max(0, min(100_000, int(offset)))
        if not self.audit_path.exists():
            return {"events": [], "limit": limit, "offset": offset, "total": 0}
        recent: deque[dict[str, Any]] = deque(maxlen=offset + limit)
        total = 0
        try:
            with self.audit_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(value, dict):
                        total += 1
                        recent.append(value)
        except OSError:
            return {"events": [], "limit": limit, "offset": offset, "total": 0}
        rows = list(reversed(recent))
        return {
            "events": rows[offset:offset + limit],
            "limit": limit,
            "offset": offset,
            "total": total,
        }

    def _record_scan_run(
        self,
        source: str,
        label: str,
        started_at: datetime,
        metrics: dict[str, int],
        errors: list[str],
        status: str = "complete",
    ) -> None:
        completed_at = datetime.utcnow()
        run = {
            "runId": new_id("scan"),
            "source": source,
            "label": label,
            "status": status,
            "startedAt": started_at.isoformat(timespec="seconds") + "Z",
            "completedAt": completed_at.isoformat(timespec="seconds") + "Z",
            "durationMs": max(0, int((completed_at - started_at).total_seconds() * 1000)),
            "metrics": {key: int(value) for key, value in metrics.items()},
            "errorSamples": errors[:8],
        }
        self.scan_history = [run, *self.scan_history[:79]]
        self._append_audit(
            {
                "action": "scan_run",
                "run_id": run["runId"],
                "source": source,
                "label": label,
                "duration_ms": run["durationMs"],
                "metrics": run["metrics"],
                "errors": len(errors),
            }
        )

    def _emit_scan_progress(
        self,
        on_progress: ScanProgress | None,
        phase: str,
        metrics: dict[str, int],
        **extra: object,
    ) -> None:
        if on_progress is None:
            return
        on_progress({"phase": phase, **metrics, **extra})

    def _read_json_array(self, path: Path) -> list[dict[str, object]]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            archive_corrupt_file(path)
            return []
        if not isinstance(value, list):
            archive_corrupt_file(path)
            return []
        return [row for row in value if isinstance(row, dict)]

    def _read_json_object(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            archive_corrupt_file(path)
            return {}
        if not isinstance(value, dict):
            archive_corrupt_file(path)
            return {}
        return value

    def _write_json_atomic(self, path: Path, value: object) -> None:
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
        temp.replace(path)

    def _write_json_array_atomic(self, path: Path, rows: Iterable[object]) -> None:
        temp = path.with_suffix(path.suffix + ".tmp")
        with temp.open("w", encoding="utf-8") as handle:
            handle.write("[")
            first = True
            for row in rows:
                if first:
                    first = False
                else:
                    handle.write(",")
                handle.write(json.dumps(row, separators=(",", ":")))
            handle.write("]")
        temp.replace(path)

    @contextmanager
    def _state_lock(self):
        self.root.mkdir(parents=True, exist_ok=True)
        start = time.monotonic()
        fd: int | None = None
        while True:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, f"{os.getpid()} {now_iso()}\n".encode("utf-8"))
                break
            except FileExistsError:
                try:
                    if time.time() - self.lock_path.stat().st_mtime > 45:
                        self.lock_path.unlink()
                        continue
                except OSError:
                    pass
                if time.monotonic() - start > 20:
                    raise TimeoutError("Workspace state is locked by another process.")
                time.sleep(0.05)
        try:
            yield
        finally:
            if fd is not None:
                os.close(fd)
            try:
                self.lock_path.unlink()
            except OSError:
                pass

    def _valid_reference(self, ref: ReferenceFace) -> bool:
        return (
            isinstance(ref.ref_id, str)
            and bool(ref.ref_id)
            and isinstance(ref.person_name, str)
            and bool(ref.person_name.strip())
            and isinstance(ref.age_bucket, str)
            and isinstance(ref.source_path, str)
            and isinstance(ref.model_name, str)
            and self._finite_number(ref.quality)
            and self._valid_vector(ref.vector)
        )

    def _valid_candidate(self, candidate: ReviewCandidate) -> bool:
        return (
            isinstance(candidate.candidate_id, str)
            and bool(candidate.candidate_id)
            and isinstance(candidate.source_path, str)
            and isinstance(candidate.person_name, str)
            and isinstance(candidate.band, str)
            and isinstance(candidate.model_name, str)
            and candidate.status in {"pending", "accepted", "rejected", "uncertain"}
            and self._finite_number(candidate.score)
            and self._finite_number(candidate.quality)
        )

    def _valid_vector(self, vector: object) -> bool:
        if not isinstance(vector, list) or len(vector) != 512:
            return False
        return all(self._finite_number(value) for value in vector)

    def _finite_number(self, value: object) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))
