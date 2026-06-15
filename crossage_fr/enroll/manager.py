from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from collections import deque
from collections.abc import Iterable
from contextlib import contextmanager
import csv
import hashlib
import io
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
from crossage_fr.crypto import DecryptionError, backup_passphrase, decrypt_bytes, encrypt_bytes, is_encrypted
from crossage_fr.embed import EmbeddingEngine
from crossage_fr.ingest import ImageLoadError, VideoLoadError, image_record_for_path, iter_image_paths, load_image, sample_video_frames
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, sha256_file, write_preview_image
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, configure_video_decoder_paths
from crossage_fr.ingest.safety import SafetyAssessment, assess_image_safety, safety_model_report
from crossage_fr.match import (
    accuracy_at_threshold,
    accuracy_from_label_rows,
    group_hits,
    pose_review_supported,
    thresholds_for_pose,
    valid_candidate,
    valid_reference,
)
from crossage_fr.match.age_gap import compute_age_gap
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate, new_id, normalize_risk_flags
from crossage_fr.storage import safe_is_mount, safe_resolve
from crossage_fr.store import VectorStore
from crossage_fr.store.workspace_db import WorkspaceDb, path_signature
from crossage_fr.workspace_registry import atomic_write, atomic_write_text, ensure_workspace_metadata, now_iso, write_active_workspace
from PIL import Image, ImageDraw, ImageEnhance


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
        self.accuracy_validation_history_path = self.root / "accuracy_validation_history.json"
        self.audit_path = self.root / "audit_log.jsonl"
        self.cancel_scan_path = self.root / ".scan-cancel"
        self.pause_scan_path = self.root / ".scan-pause"
        self.media_action_cancel_path = self.root / ".media-action-cancel"
        self.vector_index_path = self.root / "reference-vectors.npz"
        self.previews_path = self.root / "previews"
        self.video_frames_path = self.root / "video-frames"
        self.validation_packs_path = self.root / "validation-packs"
        self.db = WorkspaceDb(self.root / "workspace.sqlite3")
        self.workspace_metadata = ensure_workspace_metadata(self.root, actor=actor)
        write_active_workspace(self.root, actor=actor, metadata=self.workspace_metadata)
        self.config = load_config(self.config_path)
        self.apply_video_decoder_config()
        self.consent: dict[str, Any] = {}
        self.references: dict[str, ReferenceFace] = {}
        self.candidates: dict[str, ReviewCandidate] = {}
        self.scan_history: list[dict[str, Any]] = []
        self.vector_store = VectorStore()
        self._reference_index_version = 0
        self._model_vector_store_cache: dict[str, tuple[int, VectorStore, dict[str, ReferenceFace]]] = {}
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

    def apply_video_decoder_config(self) -> None:
        configure_video_decoder_paths(self.config.ffmpeg_path, self.config.ffprobe_path)

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
                if not valid_reference(ref):
                    continue
                self.references[ref.ref_id] = ref
        if self.candidates_path.exists():
            for row in self._read_json_array(self.candidates_path):
                try:
                    candidate = ReviewCandidate(**row)
                except TypeError:
                    continue
                if not valid_candidate(candidate):
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
                    if not valid_candidate(candidate):
                        continue
                    loaded_from_index[candidate.candidate_id] = candidate
            except sqlite3.Error:
                loaded_from_index = {}
            if len(loaded_from_index) > len(self.candidates):
                self.candidates = loaded_from_index
        if self.scan_history_path.exists():
            self.scan_history.extend(self._read_json_array(self.scan_history_path)[:80])
        ref_vectors = {ref_id: ref.vector for ref_id, ref in self.references.items()}
        if not self.vector_store.load(self.vector_index_path, expected_ids=set(ref_vectors)):
            self.vector_store.rebuild(ref_vectors)
            if ref_vectors:
                self.vector_store.save(self.vector_index_path)
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        self._ensure_candidate_index()
        self._invalidate_reference_indexes()

    def _invalidate_reference_indexes(self) -> None:
        self._reference_index_version += 1
        self._model_vector_store_cache.clear()

    def _model_family_key(self, model_name: str) -> str:
        value = str(model_name or "").strip().lower()
        if not value:
            return ""
        value = value.split("(", 1)[0].strip()
        if value.startswith("local-image-fingerprint"):
            return "local-image-fingerprint"
        if value.startswith("insightface-"):
            pack = value.removeprefix("insightface-").split("/", 1)[0].strip()
            return f"insightface-{pack}" if pack else value
        return value

    def _compatible_reference_model_name(self, candidate_model_name: str, reference_model_name: str) -> bool:
        candidate = self._model_family_key(candidate_model_name)
        reference = self._model_family_key(reference_model_name)
        if not candidate or not reference:
            return False
        return candidate == reference

    def _normalized_pose_bucket(self, value: str | None) -> str:
        pose = str(value or "unknown").strip().lower().replace("_", "-")
        if pose in {"frontal", "front", "center"}:
            return "frontal"
        if pose in {"three-quarter", "threequarter", "3q", "three quarter"}:
            return "three-quarter"
        if pose in {"profile", "side", "side-face"}:
            return "profile"
        if pose in {"edge-face", "edge"}:
            return "edge-face"
        return "unknown"

    def _reference_search_context(self, model_name: str) -> tuple[VectorStore, dict[str, ReferenceFace]]:
        model_key = str(model_name or "").strip()
        cached = self._model_vector_store_cache.get(model_key)
        if cached is not None and cached[0] == self._reference_index_version:
            return cached[1], cached[2]
        references = {
            ref_id: ref
            for ref_id, ref in self.references.items()
            if self._compatible_reference_model_name(model_key, ref.model_name)
        }
        store = VectorStore()
        store.rebuild({ref_id: ref.vector for ref_id, ref in references.items()})
        self._model_vector_store_cache[model_key] = (self._reference_index_version, store, references)
        return store, references

    def _reference_active_key(self, ref: ReferenceFace, active_model: str) -> tuple[str, str, str]:
        return (ref.source_hash or self._path_key(ref.source_path), ref.person_name.casefold(), self._model_family_key(active_model))

    def _pending_backfill_references(self, active_model_name: str) -> list[ReferenceFace]:
        active = str(active_model_name or "").strip()
        if not active:
            return []
        active_keys = {
            self._reference_active_key(ref, active)
            for ref in self.references.values()
            if self._compatible_reference_model_name(active, ref.model_name)
        }
        return [
            ref
            for ref in self.references.values()
            if not self._compatible_reference_model_name(active, ref.model_name)
            and self._reference_active_key(ref, active) not in active_keys
        ]

    def _search_matching_references(self, embedding: EmbeddingResult, k: int = 20) -> tuple[list[Any], dict[str, ReferenceFace]]:
        store, references = self._reference_search_context(embedding.model_name)
        if not references:
            return [], references
        return store.search(embedding.vector, k=k), references

    def save(self, snapshot_candidates: bool = True, flush_candidate_index: bool = True) -> None:
        with self._state_lock():
            self.root.mkdir(parents=True, exist_ok=True)
            save_config(self.config, self.config_path)
            self._write_json_atomic(self.consent_path, self.consent)
            refs = [asdict(ref) for ref in self.references.values()]
            self._write_json_atomic(self.refs_path, refs)
            self.vector_store.save(self.vector_index_path)
            if flush_candidate_index:
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

    def model_compatibility_report(self, active_model_name: str) -> dict[str, Any]:
        active = str(active_model_name or "").strip()
        counts: dict[str, int] = {}
        compatible = 0
        for ref in self.references.values():
            model_name = str(ref.model_name or "").strip() or "unknown"
            counts[model_name] = counts.get(model_name, 0) + 1
            if self._compatible_reference_model_name(active, model_name):
                compatible += 1
        pending = len(self._pending_backfill_references(active))
        return {
            "activeModelName": active,
            "compatibleReferences": compatible,
            "otherModelReferences": pending,
            "totalReferences": len(self.references),
            "modelCounts": counts,
            "needsBackfill": pending > 0 and bool(active),
            "message": (
                "Some saved person photos were embedded with another model pack. Re-enroll or backfill before judging recall."
                if pending > 0
                else "Saved person photos are compatible with the active recognizer."
            ),
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
                if not embeddings and self.config.two_pass_scan:
                    rescue_method = getattr(engine, "embed_loaded_image_rescue", None)
                    embeddings = rescue_method(image, path) if callable(rescue_method) else []
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
                        pose_bucket=embedding.pose_bucket,
                    )
                    self.references[ref.ref_id] = ref
                    self.vector_store.add(ref.ref_id, ref.vector)
                    added += 1
                known_hashes.add(record.sha256)
            except (ImageLoadError, OSError, ValueError) as exc:
                errors.append(f"{path.name}: {exc}")
        if added:
            self._invalidate_reference_indexes()
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

    def backfill_references_for_model(
        self,
        engine: EmbeddingEngine,
        on_progress: ScanProgress | None = None,
        limit: int = 0,
    ) -> dict[str, Any]:
        target_model = str(getattr(engine, "model_name", "") or "").strip()
        if not target_model or target_model.startswith("local-image-fingerprint"):
            raise ValueError("A full face model is required before backfilling references.")
        self.clear_scan_cancel()
        self.clear_scan_pause()
        existing_keys = {
            self._reference_active_key(ref, ref.model_name)
            for ref in self.references.values()
        }
        source_refs = self._pending_backfill_references(target_model)
        if limit > 0:
            source_refs = source_refs[: max(0, int(limit))]
        total = len(source_refs)
        added = skipped = errors = low_quality = missing = processed = paused_seconds = 0
        cancelled = False
        error_rows: list[str] = []
        if on_progress:
            on_progress(
                {
                    "phase": "model_backfill",
                    "processed": 0,
                    "total": total,
                    "added": 0,
                    "skipped": 0,
                    "errors": 0,
                    "message": "Model backfill started.",
                }
            )
        for index, ref in enumerate(source_refs, start=1):
            path = Path(ref.source_path).expanduser()
            pause_started: float | None = None
            while self.scan_pause_requested() and not self.scan_cancel_requested():
                if pause_started is None:
                    pause_started = time.monotonic()
                    if on_progress:
                        on_progress(
                            {
                                "phase": "paused",
                                "processed": processed,
                                "total": total,
                                "added": added,
                                "skipped": skipped,
                                "errors": errors,
                                "message": "Model backfill paused.",
                            }
                        )
                time.sleep(0.35)
            if pause_started is not None:
                paused_seconds += int(max(0.0, time.monotonic() - pause_started))
            if self.scan_cancel_requested():
                cancelled = True
                break
            try:
                if not path.exists():
                    missing += 1
                    skipped += 1
                    processed += 1
                    continue
                image = load_image(path)
                source_hash = ref.source_hash or sha256_file(path)
                key = (source_hash or self._path_key(path), ref.person_name.casefold(), target_model)
                if key in existing_keys:
                    skipped += 1
                    processed += 1
                    continue
                record = image_record_for_path(path, image=image, sha256=source_hash)
                embeddings = engine.embed_loaded_image(image, path)
                if not embeddings and self.config.two_pass_scan:
                    rescue_method = getattr(engine, "embed_loaded_image_rescue", None)
                    embeddings = rescue_method(image, path) if callable(rescue_method) else []
                accepted = 0
                for embedding in embeddings:
                    if embedding.quality < self.config.thresholds.quality_min:
                        low_quality += 1
                        continue
                    new_ref = ReferenceFace(
                        ref_id=new_id("ref"),
                        person_name=ref.person_name,
                        age_bucket=ref.age_bucket,
                        source_path=str(path),
                        capture_date=record.capture_date or ref.capture_date,
                        quality=embedding.quality,
                        model_name=embedding.model_name,
                        vector=embedding.vector,
                        source_hash=record.sha256,
                        pose_bucket=embedding.pose_bucket,
                    )
                    self.references[new_ref.ref_id] = new_ref
                    self.vector_store.add(new_ref.ref_id, new_ref.vector)
                    existing_keys.add((record.sha256 or self._path_key(path), new_ref.person_name.casefold(), new_ref.model_name))
                    added += 1
                    accepted += 1
                if not accepted:
                    skipped += 1
                processed += 1
            except (ImageLoadError, OSError, ValueError, RuntimeError) as exc:
                errors += 1
                processed += 1
                if len(error_rows) < 50:
                    error_rows.append(f"{path.name}: {exc}")
            if added and (processed % 25 == 0 or index == total):
                self._invalidate_reference_indexes()
                self.save(snapshot_candidates=False)
            if on_progress and (index == total or index % 10 == 0):
                on_progress(
                    {
                        "phase": "model_backfill",
                        "processed": processed,
                        "total": total,
                        "added": added,
                        "skipped": skipped,
                        "errors": errors,
                        "currentPath": str(path),
                    }
                )
        if added:
            self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "backfill_references_for_model",
                "target_model": target_model,
                "total": total,
                "processed": processed,
                "added": added,
                "skipped": skipped,
                "missing": missing,
                "low_quality": low_quality,
                "errors": errors,
                "cancelled": cancelled,
            }
        )
        self.save()
        if on_progress:
            on_progress(
                {
                    "phase": "cancelled" if cancelled else "complete",
                    "processed": processed,
                    "total": total,
                    "added": added,
                    "skipped": skipped,
                    "errors": errors,
                    "message": "Model backfill cancelled." if cancelled else "Model backfill complete.",
                }
            )
        return {
            "targetModel": target_model,
            "total": total,
            "processed": processed,
            "added": added,
            "skipped": skipped,
            "missing": missing,
            "lowQuality": low_quality,
            "errors": errors,
            "cancelled": cancelled,
            "pausedSeconds": paused_seconds,
            "errorRows": error_rows,
            "compatibility": self.model_compatibility_report(target_model),
        }

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
            "hashResumeSkipped": 0,
            "embeddingCacheHits": 0,
            "embeddingCacheMisses": 0,
            "twoPassVerified": 0,
            "twoPassChanged": 0,
            "noFaceDetected": 0,
            "lowQualityFaces": 0,
            "blockedPairs": 0,
            "duplicateCandidates": 0,
            "videoCandidateCap": 0,
            "profileRescueAttempted": 0,
            "profileRescueFound": 0,
            "profileRescueMatched": 0,
            "profileRescueUnmatched": 0,
            "safeModeFaceCropAllowed": 0,
            "poseFrontal": 0,
            "poseThreeQuarter": 0,
            "poseProfile": 0,
            "poseUnknown": 0,
            "poseRelaxedReviews": 0,
            "poseRelaxedProfile": 0,
            "poseRelaxedThreeQuarter": 0,
            "poseReranked": 0,
            "poseAmbiguous": 0,
            "closeRunnerUp": 0,
            "singleReferenceMatches": 0,
            "hardPoseUnsupported": 0,
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
                manifest_hash = str(metadata.get("source_hash") or "")
                if label < 0:
                    self._record_manifest_file(run_id, path, "completed", "unmatched", "", scan_conn, content_hash=manifest_hash)
                    continue
                person_name = f"Unmatched cluster {cluster_label_offset + label + 1}"
                key = (self._candidate_dedupe_source(path, metadata), None, person_name)
                if candidate_key_exists(key):
                    self._record_manifest_file(run_id, path, "completed", "duplicate", "", scan_conn, content_hash=manifest_hash)
                    continue
                if not video_candidate_allowed(metadata):
                    metrics["skipped"] += 1
                    self._record_manifest_file(run_id, path, "completed", "video_candidate_cap", "", scan_conn, content_hash=manifest_hash)
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
                self._record_manifest_file(run_id, path, "clustered", "candidate", candidate.candidate_id, scan_conn, content_hash=manifest_hash)
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

        def record_skip_reason(
            image_path: Path,
            signature: dict[str, Any],
            phase: str,
            message: str = "",
            content_hash: str = "",
        ) -> None:
            self.db.record_scan_file(
                run_id,
                image_path,
                signature,
                "skipped",
                phase=phase,
                message=message,
                content_hash=content_hash,
                conn=scan_conn,
            )

        def safe_mode_face_crop_allowed(
            assessment: SafetyAssessment,
            embeddings: list[EmbeddingResult],
            image: Any,
        ) -> bool:
            image_width = max(1, int(getattr(image, "width", 0) or 0))
            image_height = max(1, int(getattr(image, "height", 0) or 0))
            return self._face_crop_admittable(
                assessment.model_score,
                self.config.safe_mode_threshold,
                image_width,
                image_height,
                [embedding.bbox for embedding in embeddings],
                self.config.safe_mode_zero_admittance,
            )

        def queue_image(
            image_path: Path,
            image: Any | None = None,
            media_metadata: dict[str, Any] | None = None,
            apply_safe_mode: bool = True,
            precomputed_signature: dict[str, Any] | None = None,
            precomputed_content_hash: str = "",
        ) -> int:
            nonlocal added
            ensure_not_cancelled()
            metadata = dict(media_metadata or {})
            signature = precomputed_signature or path_signature(image_path)
            content_hash = precomputed_content_hash or sha256_file(image_path, self.scan_cancel_requested)
            ensure_not_cancelled()
            if image is None:
                image = load_image(image_path)
            ensure_not_cancelled()
            ensure_stable_signature(image_path, signature)
            metadata.setdefault("source_hash", content_hash)
            metadata.setdefault("capture_date", self._safe_capture_date(image_path, image=image, sha256=content_hash))
            embeddings: list[EmbeddingResult] | None = None
            cache_hit = False
            if apply_safe_mode and self.config.safe_mode:
                assessment, content_hash = self._assess_safety_cached(image_path, image, scan_conn, content_hash=content_hash)
                ensure_not_cancelled()
                metadata["source_hash"] = content_hash
                if assessment.sensitive:
                    embeddings, cache_hit = self._embed_image_cached(image_path, engine, image=image, content_hash=content_hash, conn=scan_conn)
                    ensure_not_cancelled()
                    if safe_mode_face_crop_allowed(assessment, embeddings, image):
                        metrics["safeModeFaceCropAllowed"] += 1
                    else:
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
            if embeddings is None:
                embeddings, cache_hit = self._embed_image_cached(image_path, engine, image=image, content_hash=content_hash, conn=scan_conn)
            ensure_not_cancelled()
            if cache_hit:
                metrics["embeddingCacheHits"] += 1
            else:
                metrics["embeddingCacheMisses"] += 1
            rescue_used = False
            if not embeddings and self.config.two_pass_scan:
                metrics["profileRescueAttempted"] += 1
                metrics["twoPassVerified"] += 1
                rescue_embeddings, rescue_cache_hit = self._embed_image_cached(
                    image_path,
                    engine,
                    image=image,
                    content_hash=content_hash,
                    conn=scan_conn,
                    cache_variant="profile-rescue-v1",
                )
                if rescue_cache_hit:
                    metrics["embeddingCacheHits"] += 1
                else:
                    metrics["embeddingCacheMisses"] += 1
                if rescue_embeddings:
                    metrics["profileRescueFound"] += 1
                    metrics["twoPassChanged"] += 1
                    embeddings = rescue_embeddings
                    rescue_used = True
            accepted = 0
            recorded_any = False
            queued_unmatched = False
            low_quality_seen = False
            for embedding in embeddings:
                if embedding.quality < self.config.thresholds.quality_min:
                    metrics["skipped"] += 1
                    metrics["lowQualityFaces"] += 1
                    low_quality_seen = True
                    continue
                pose_bucket = self._normalized_pose_bucket(embedding.pose_bucket)
                if pose_bucket == "frontal":
                    metrics["poseFrontal"] += 1
                elif pose_bucket == "three-quarter":
                    metrics["poseThreeQuarter"] += 1
                elif pose_bucket == "profile":
                    metrics["poseProfile"] += 1
                else:
                    metrics["poseUnknown"] += 1
                embedding_metadata = {**metadata, "pose_bucket": pose_bucket}
                accepted += 1
                hits, compatible_refs = self._search_matching_references(embedding, k=k)
                pose_thresholds = thresholds_for_pose(self.config.thresholds, pose_bucket) if pose_review_supported(hits, compatible_refs, self.config.thresholds, pose_bucket) else self.config.thresholds
                decision = group_hits(hits, compatible_refs, pose_thresholds, pose_bucket=pose_bucket)
                decision_flags = set(decision.flags) if decision is not None else set()
                if "pose-reranked" in decision_flags:
                    metrics["poseReranked"] += 1
                if "ambiguous-person-margin" in decision_flags:
                    metrics["poseAmbiguous"] += 1
                if "close-runner-up" in decision_flags:
                    metrics["closeRunnerUp"] += 1
                if "single-reference-match" in decision_flags or "single-reference-close-runner-up" in decision_flags:
                    metrics["singleReferenceMatches"] += 1
                if "single-reference-hard-pose" in decision_flags:
                    metrics["hardPoseUnsupported"] += 1
                pose_relaxed = (
                    decision is not None
                    and pose_thresholds.relaxed_child < self.config.thresholds.relaxed_child
                    and decision.score < self.config.thresholds.relaxed_child
                    and decision.score >= pose_thresholds.relaxed_child
                )
                if pose_relaxed:
                    metrics["poseRelaxedReviews"] += 1
                    if pose_bucket == "profile" or pose_bucket == "edge-face":
                        metrics["poseRelaxedProfile"] += 1
                    elif pose_bucket == "three-quarter":
                        metrics["poseRelaxedThreeQuarter"] += 1
                if decision is None or decision.band == "below-review":
                    unmatched.append((image_path, embedding.quality, embedding.model_name, embedding.vector, embedding_metadata))
                    metrics["unmatched"] += 1
                    if rescue_used:
                        metrics["profileRescueUnmatched"] += 1
                    queued_unmatched = True
                    flush_unmatched()
                    continue
                if self.db.blocked_pair_exists(content_hash, decision.person_name, decision.best_ref_id, scan_conn):
                    metrics["skipped"] += 1
                    metrics["blockedPairs"] += 1
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
                    metrics["duplicateCandidates"] += 1
                    continue
                if not video_candidate_allowed(metadata):
                    metrics["skipped"] += 1
                    metrics["videoCandidateCap"] += 1
                    continue
                candidate_note = _video_note(metadata)
                candidate_risk_flags = normalize_risk_flags(decision_flags)
                for flag, message in (
                    ("ambiguous-person-margin", "Close identity scores; review this match carefully."),
                    ("close-runner-up", "Another saved person was close; avoid bulk accepting this row."),
                    ("single-reference-close-runner-up", "Only one saved photo separates close identities; add more saved photos before trusting this match."),
                    ("single-reference-hard-pose", "Only one hard-angle signal matched; add a side/angled saved photo if this is wrong."),
                    ("single-reference-match", "Only one saved photo supported this match; review before bulk actions."),
                    ("pose-reranked", "Hard-angle match used pose-aware scoring; compare against saved photos."),
                ):
                    if flag in decision_flags:
                        candidate_note = self._append_candidate_note(candidate_note, message)
                        candidate_risk_flags = normalize_risk_flags(candidate_risk_flags, candidate_note)
                if pose_relaxed:
                    candidate_note = self._append_candidate_note(candidate_note, "Hard-pose review threshold used; verify carefully.")
                if rescue_used:
                    candidate_note = self._append_candidate_note(candidate_note, "Recovered by the side-face detector; review before accepting.")
                candidate_risk_flags = normalize_risk_flags(candidate_risk_flags, candidate_note)
                reference_capture_date = self._reference_capture_date(decision.best_ref_id)
                age_gap_years, age_gap_confidence, age_gap_flag = compute_age_gap(
                    embedding_metadata.get("capture_date"), reference_capture_date
                )
                if age_gap_flag:
                    candidate_risk_flags = normalize_risk_flags(
                        [*candidate_risk_flags, age_gap_flag], candidate_note
                    )
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
                    note=candidate_note,
                    risk_flags=candidate_risk_flags,
                    reference_capture_date=reference_capture_date,
                    age_gap_years=age_gap_years,
                    age_gap_confidence=age_gap_confidence,
                    **embedding_metadata,
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
                    content_hash=content_hash,
                    conn=scan_conn,
                )
                recorded_any = True
                added += 1
                metrics["added"] = added
                metrics["matched"] += 1
                if rescue_used:
                    metrics["profileRescueMatched"] += 1
                self._emit_scan_progress(
                    on_progress,
                    "candidate",
                    metrics,
                    current_path=str(image_path),
                    candidate_id=candidate.candidate_id,
                )
            if not accepted:
                metrics["skipped"] += 1
                if not embeddings:
                    metrics["noFaceDetected"] += 1
                    record_skip_reason(image_path, signature, "no_face_detected", "No face was detected after the normal detector and profile rescue pass.", content_hash)
                elif low_quality_seen:
                    record_skip_reason(image_path, signature, "low_quality_face", "Detected face quality was below the review threshold.", content_hash)
                else:
                    record_skip_reason(image_path, signature, "skipped", "", content_hash)
            elif queued_unmatched:
                if any(row[0] == image_path for row in unmatched):
                    self.db.record_scan_file(run_id, image_path, signature, "unmatched", phase="pending_cluster", content_hash=content_hash, conn=scan_conn)
            elif not recorded_any:
                self.db.record_scan_file(run_id, image_path, signature, "completed", phase="processed", content_hash=content_hash, conn=scan_conn)
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
                self.save(snapshot_candidates=False, flush_candidate_index=False)

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
                    resume_content_hash = ""
                    if not resume_row and resume_run_id:
                        resume_content_hash = sha256_file(path, self.scan_cancel_requested)
                        resume_row = self.db.scan_file_resume_hash_row(resume_run_id, resume_content_hash, scan_conn)
                        if resume_row and resume_row.get("status") in {"candidate", "clustered"}:
                            candidate_id = str(resume_row.get("candidate_id") or "")
                            if candidate_id and candidate_id not in self.candidates:
                                resume_row = None
                    if resume_row:
                        metrics["manifestSkipped"] += 1
                        if resume_content_hash:
                            metrics["hashResumeSkipped"] += 1
                        metrics["skipped"] += 1
                        self.db.record_scan_file(
                            run_id,
                            path,
                            signature,
                            "skipped",
                            phase="manifest_hash" if resume_content_hash else "manifest",
                            message="Skipped from previous completed content hash." if resume_content_hash else "Skipped from previous completed manifest.",
                            content_hash=resume_content_hash,
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
                        video_content_hash = resume_content_hash or sha256_file(path, self.scan_cancel_requested)
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
                                        content_hash=video_content_hash,
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
                                    "capture_date": self._media_mtime_date(path),
                                },
                                apply_safe_mode=False,
                            )
                        self.db.record_scan_file(run_id, path, signature, "completed", phase="video", content_hash=video_content_hash, conn=scan_conn)
                        prune_generated_video_frames(sample_paths)
                    else:
                        queue_image(path, precomputed_signature=signature, precomputed_content_hash=resume_content_hash)
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
                return self.db.review_insights(self.config.thresholds.confident, max(0.2, float(self.config.thresholds.quality_min)))
            except sqlite3.Error:
                pass
        pending = 0
        confident = 0
        video_pending = 0
        close_runner_pending = 0
        single_reference_pending = 0
        lane_counts = {"all": 0, "high": 0, "lowQuality": 0, "groups": 0, "video": 0, "notes": 0, "closeRunner": 0, "singleReference": 0}
        folders: dict[str, int] = {}
        grouped_media: dict[str, set[str]] = {}
        low_quality_threshold = max(0.2, float(self.config.thresholds.quality_min))
        for candidate in self.candidates.values():
            lane_counts["all"] += 1
            if candidate.score >= self.config.thresholds.confident:
                lane_counts["high"] += 1
            if candidate.quality < low_quality_threshold:
                lane_counts["lowQuality"] += 1
            if candidate.media_kind == "video":
                lane_counts["video"] += 1
            if candidate.note.strip():
                lane_counts["notes"] += 1
            risk_flags = set(normalize_risk_flags(getattr(candidate, "risk_flags", []), candidate.note))
            if {"close-runner-up", "ambiguous-person-margin"} & risk_flags:
                lane_counts["closeRunner"] += 1
            if {"single-reference-match", "single-reference-close-runner-up", "single-reference-hard-pose"} & risk_flags:
                lane_counts["singleReference"] += 1
            media_path = candidate.media_source_path or candidate.source_path
            if candidate.person_name.strip() and not candidate.person_name.startswith("Unmatched cluster"):
                grouped_media.setdefault(media_path, set()).add(candidate.person_name)
            if candidate.status != "pending":
                continue
            pending += 1
            if candidate.score >= self.config.thresholds.confident:
                confident += 1
            if candidate.media_kind == "video":
                video_pending += 1
            if {"close-runner-up", "ambiguous-person-margin"} & risk_flags:
                close_runner_pending += 1
            if {"single-reference-match", "single-reference-close-runner-up", "single-reference-hard-pose"} & risk_flags:
                single_reference_pending += 1
            try:
                folder = str(Path(candidate.media_source_path or candidate.source_path).expanduser().parent)
            except OSError:
                folder = ""
            if folder:
                folders[folder] = folders.get(folder, 0) + 1
        grouped_paths = {media_path for media_path, people in grouped_media.items() if len(people) >= 2}
        lane_counts["groups"] = sum(1 for candidate in self.candidates.values() if (candidate.media_source_path or candidate.source_path) in grouped_paths)
        folder_rows = sorted(folders.items(), key=lambda item: (-item[1], item[0]))[:8]
        return {
            "pending": pending,
            "confidentPending": confident,
            "videoPending": video_pending,
            "imagePending": pending - video_pending,
            "closeRunnerUpPending": close_runner_pending,
            "singleReferencePending": single_reference_pending,
            "laneCounts": lane_counts,
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
        search_k = max(64, limit * 8, max_person_refs + 16)
        suggestions_by_pair: dict[tuple[str, str], dict[str, Any]] = {}
        for ref in self.references.values():
            person_key = ref_people.get(ref.ref_id)
            if not person_key:
                continue
            model_store, model_refs = self._reference_search_context(ref.model_name)
            for hit in model_store.search(ref.vector, k=min(model_store.size, search_k)):
                if hit.item_id == ref.ref_id:
                    continue
                if hit.score < threshold:
                    break
                other_ref = model_refs.get(hit.item_id)
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
                            hits, compatible_refs = self._search_matching_references(embedding, k=k)
                            decision = group_hits(hits, compatible_refs, self.config.thresholds)
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

    def benchmark_history(self, limit: int = 8) -> list[dict[str, Any]]:
        return self.db.recent_benchmark_runs(limit=limit)

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

    def clear_media_action_cancel(self) -> None:
        try:
            self.media_action_cancel_path.unlink()
        except OSError:
            pass

    def scan_cancel_requested(self) -> bool:
        return self.cancel_scan_path.exists()

    def scan_pause_requested(self) -> bool:
        return self.pause_scan_path.exists()

    def media_action_cancel_requested(self) -> bool:
        return self.media_action_cancel_path.exists()

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
            "poseBucket": self._normalized_pose_bucket(embedding.pose_bucket),
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
            pose_bucket=self._normalized_pose_bucket(str(row.get("poseBucket", "unknown"))),
        )

    def _embed_image_cached(
        self,
        path: Path,
        engine: EmbeddingEngine,
        image: Any | None = None,
        content_hash: str = "",
        conn: sqlite3.Connection | None = None,
        cache_variant: str = "",
    ) -> tuple[list[EmbeddingResult], bool]:
        content_hash = content_hash or sha256_file(path)
        model_version = self._embedding_cache_version(engine)
        if cache_variant:
            model_version = f"{model_version}|{cache_variant}"
        detector_size = self._embedding_detector_size(engine)
        cached = self.db.embedding_lookup(content_hash, model_version, detector_size, conn)
        if cached is not None:
            return [self._embedding_from_cache_row(row) for row in cached], True
        if cache_variant:
            if image is None:
                image = load_image(path)
            rescue_method = getattr(engine, "embed_loaded_image_rescue", None)
            embeddings = rescue_method(image, path) if callable(rescue_method) else []
        else:
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
        content_hash: str = "",
    ) -> None:
        try:
            self.db.record_scan_file(
                run_id,
                path,
                path_signature(path),
                status,
                phase=phase,
                candidate_id=candidate_id,
                content_hash=content_hash,
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
        best_ref_id = candidate.best_ref_id or ""
        self.db.add_blocked_pair(
            {
                "fileHash": file_hash,
                "personName": candidate.person_name,
                "bestRefId": best_ref_id,
                "sourcePath": candidate.source_path,
                "note": note or "Rejected from review as a repeated false match.",
            }
        )
        blocked_count = 1
        if best_ref_id:
            self.db.add_blocked_pair(
                {
                    "fileHash": file_hash,
                    "personName": candidate.person_name,
                    "bestRefId": "",
                    "sourcePath": candidate.source_path,
                    "note": note or "Rejected from review as a repeated same-image/person false match.",
                }
            )
            blocked_count += 1
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
                "best_ref_id": best_ref_id,
                "blocked_rows": blocked_count,
            }
        )
        self.save()
        return {"blocked": blocked_count, "summary": self.db.blocked_pairs_summary(limit=5)}

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
        self._invalidate_reference_indexes()
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
        self._invalidate_reference_indexes()
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
        if ref_ids:
            self._invalidate_reference_indexes()
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
            self._invalidate_reference_indexes()
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

    def database_integrity(self) -> dict[str, Any]:
        return self.db.integrity_report()

    def repair_database_integrity(self, confirm: bool = False) -> dict[str, Any]:
        before = self.db.integrity_report()
        result: dict[str, Any] = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "dryRun": not bool(confirm),
            "confirmed": bool(confirm),
            "rebuilt": False,
            "optimized": None,
            "snapshot": None,
            "before": before,
            "after": before,
            "recommendations": [],
        }
        if not confirm:
            result["recommendations"] = [
                "Database is healthy; run optimize if the app folder is large."
                if before.get("ok")
                else "Database integrity failed. Repair will snapshot the current DB and rebuild the local index from saved JSON state."
            ]
            return result

        snapshot = self.db.snapshot_files("integrity-repair")
        result["snapshot"] = snapshot
        if before.get("ok"):
            optimized = self.db.optimize()
            result["optimized"] = optimized
            result["after"] = self.db.integrity_report()
            result["recommendations"] = ["Database passed integrity checks and was optimized."]
        else:
            self.db.rebuild_empty()
            self.db.replace_candidates(self.candidates.values())
            self._candidate_dirty_ids.clear()
            self._candidate_deleted_ids.clear()
            result["rebuilt"] = True
            result["after"] = self.db.integrity_report()
            result["recommendations"] = [
                "Database was rebuilt from saved app state. Scan manifests and caches can be regenerated by scanning again.",
                "A snapshot of the previous SQLite files was saved before repair.",
            ]
        self._append_audit(
            {
                "action": "repair_database_integrity",
                "before_ok": bool(before.get("ok")),
                "after_ok": bool(result["after"].get("ok")),
                "rebuilt": bool(result["rebuilt"]),
                "snapshot": (result["snapshot"] or {}).get("backupDir"),
            }
        )
        self.save(snapshot_candidates=True)
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
        # data-persistence-3: archive a transactionally-consistent DB snapshot
        # (VACUUM INTO) instead of byte-copying the live workspace.sqlite3 + its
        # -wal/-shm, which can be torn if a writer (scan / MCP process) is active
        # during the backup. The live DB triplet is skipped in the walk below.
        db_name = self.db.path.name
        db_wal = db_name + "-wal"
        db_shm = db_name + "-shm"
        db_snapshot = export_root / f".db-snapshot-{stamp}.sqlite3"
        snapshot_ok = False
        try:
            self.db.snapshot_to(db_snapshot)
            snapshot_ok = db_snapshot.exists() and db_snapshot.stat().st_size > 0
        except Exception:
            snapshot_ok = False
        written = 0
        try:
            with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("backup-manifest.json", json.dumps(manifest, indent=2))
                written += 1
                if snapshot_ok:
                    archive.write(db_snapshot, db_name)
                    written += 1
                for current, dirnames, filenames in os.walk(self.root):
                    dirnames[:] = sorted(dirname for dirname in dirnames if dirname not in include_dirs)
                    for filename in sorted(filenames):
                        path = Path(current) / filename
                        if not path.is_file():
                            continue
                        relative = path.relative_to(self.root)
                        if path == backup_path or path == db_snapshot or path.name == ".state.lock":
                            continue
                        # Never archive the live WAL/SHM (process-private, can be
                        # inconsistent with the main file); skip the live main DB
                        # too when the consistent snapshot was written.
                        if path.name in {db_wal, db_shm}:
                            continue
                        if snapshot_ok and path.name == db_name:
                            continue
                        archive.write(path, relative.as_posix())
                        written += 1
        finally:
            try:
                db_snapshot.unlink()
            except OSError:
                pass
        # PC-03: optionally encrypt the finished backup at rest (AES-256-GCM via
        # an operator passphrase). The file keeps its .zip name; verify/restore
        # detect the encryption from the content header. Default (no passphrase)
        # path is unchanged.
        encrypted = False
        passphrase = backup_passphrase()
        if passphrase:
            backup_path.write_bytes(encrypt_bytes(backup_path.read_bytes(), passphrase))
            encrypted = True
        self._append_audit(
            {
                "action": "export_workspace_backup",
                "zip_path": str(backup_path),
                "file_count": written,
                "include_generated": bool(include_generated),
                "encrypted": encrypted,
            }
        )
        return {
            "zipPath": str(backup_path),
            "fileCount": written,
            "bytes": backup_path.stat().st_size,
            "includeGenerated": bool(include_generated),
            "encrypted": encrypted,
        }

    def _backup_archive_source(self, path: Path):
        # PC-03: transparently open an (optionally) encrypted backup. Returns the
        # path itself for a plain ZIP (unchanged behavior) or an in-memory
        # decrypted ZIP. Raises ValueError if encrypted but the passphrase is
        # missing/wrong.
        with path.open("rb") as handle:
            head = handle.read(16)
        if not is_encrypted(head):
            return path
        passphrase = backup_passphrase()
        if not passphrase:
            raise ValueError("This backup is encrypted; set VINTRACE_BACKUP_PASSPHRASE to verify or restore it.")
        try:
            return io.BytesIO(decrypt_bytes(path.read_bytes(), passphrase))
        except DecryptionError as exc:
            raise ValueError(str(exc)) from exc

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
            with zipfile.ZipFile(self._backup_archive_source(path)) as archive:
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
        except (OSError, zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
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

    def restore_workspace_backup(self, backup_path: Path | None, target_root: Path) -> dict[str, Any]:
        path = backup_path.expanduser().resolve() if backup_path else self._latest_workspace_backup()
        if not path:
            raise ValueError("No backup zip was found in the exports folder.")
        target = target_root.expanduser().resolve()
        current = self.root.resolve()
        if target == current or current in target.parents:
            raise ValueError("Restore target must be outside the active app folder.")
        if target.exists():
            if not target.is_dir():
                raise ValueError("Restore target must be a folder.")
            if target.is_symlink() or safe_is_mount(target):
                raise ValueError("Restore target must be an app-owned local folder.")
            allowed_system_files = {".DS_Store", "Thumbs.db", "desktop.ini"}
            try:
                existing = [item.name for item in target.iterdir() if item.name not in allowed_system_files]
            except OSError as exc:
                raise ValueError(f"Cannot inspect restore target: {exc}") from exc
            if existing:
                raise ValueError("Restore target must be empty.")

        verification = self.verify_workspace_backup(path)
        if not verification.get("ok"):
            reason = verification.get("error") or "Backup verification failed."
            missing = verification.get("missingCoreFiles") or []
            dangerous = verification.get("dangerousEntries") or []
            invalid = verification.get("invalidCoreFiles") or []
            details = []
            if missing:
                details.append(f"missing {', '.join(str(item) for item in missing[:3])}")
            if dangerous:
                details.append(f"unsafe entries {len(dangerous)}")
            if invalid:
                details.append(f"invalid core files {', '.join(str(item) for item in invalid[:3])}")
            raise ValueError(f"{reason} {'; '.join(details)}".strip())

        if target.exists():
            if not target.is_dir():
                raise ValueError("Restore target must be a folder.")
            if target.is_symlink() or safe_is_mount(target):
                raise ValueError("Restore target must be an app-owned local folder.")
            allowed_system_files = {".DS_Store", "Thumbs.db", "desktop.ini"}
            try:
                existing = [item.name for item in target.iterdir() if item.name not in allowed_system_files]
            except OSError as exc:
                raise ValueError(f"Cannot inspect restore target: {exc}") from exc
            if existing:
                raise ValueError("Restore target must be empty.")
        else:
            target.mkdir(parents=True, exist_ok=True)

        file_count = 0
        bytes_written = 0
        with zipfile.ZipFile(self._backup_archive_source(path)) as archive:
            for member in archive.infolist():
                name = member.filename
                if not name or name.endswith("/"):
                    continue
                if (
                    name.startswith(("/", "\\\\", "//"))
                    or (len(name) >= 3 and name[1] == ":" and name[2] in {"/", "\\"})
                    or Path(name).is_absolute()
                    or ".." in Path(name).parts
                ):
                    raise ValueError(f"Unsafe path in backup: {name}")
                destination = (target / name).resolve()
                try:
                    destination.relative_to(target)
                except ValueError as exc:
                    raise ValueError(f"Unsafe path in backup: {name}") from exc
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                file_count += 1
                bytes_written += destination.stat().st_size

        state_summary = {
            "references": 0,
            "candidates": 0,
            "scanRuns": 0,
            "workspaceId": "",
        }
        try:
            metadata_path = target / ".vintrace-workspace.json"
            if metadata_path.exists():
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if isinstance(metadata, dict):
                    state_summary["workspaceId"] = str(metadata.get("workspaceId", ""))
            refs = json.loads((target / "references.json").read_text(encoding="utf-8"))
            if isinstance(refs, list):
                state_summary["references"] = len(refs)
            candidates_path = target / "review_candidates.json"
            if candidates_path.exists():
                candidates = json.loads(candidates_path.read_text(encoding="utf-8"))
                if isinstance(candidates, list):
                    state_summary["candidates"] = len(candidates)
            scan_history_path = target / "scan_history.json"
            if scan_history_path.exists():
                scan_runs = json.loads(scan_history_path.read_text(encoding="utf-8"))
                if isinstance(scan_runs, list):
                    state_summary["scanRuns"] = len(scan_runs)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass
        database_path = target / "workspace.sqlite3"
        summary_warnings: list[str] = []
        if database_path.exists():
            # data-persistence-2: the DB is authoritative for the restored
            # workspace. Query each count independently (so one bad table can't
            # skip the others) and use the real table name (review_candidates,
            # not the never-existent "candidates" the prior code queried, which
            # always raised and was silently swallowed). Warn on disagreement
            # with the manifest/JSON-derived counts.
            try:
                with sqlite3.connect(database_path) as connection:
                    for key, table in (("candidates", "review_candidates"), ("scanRuns", "scan_runs")):
                        try:
                            db_count = int(connection.execute(f"select count(*) from {table}").fetchone()[0])
                        except sqlite3.DatabaseError:
                            summary_warnings.append(f"Could not read {table} from the restored database.")
                            continue
                        json_count = state_summary.get(key)
                        if isinstance(json_count, int) and json_count != db_count:
                            summary_warnings.append(
                                f"Restored {table} count from the database ({db_count}) differs from the manifest ({json_count})."
                            )
                        state_summary[key] = db_count
            except sqlite3.DatabaseError:
                summary_warnings.append("Could not open the restored database to verify counts.")

        self._append_audit(
            {
                "action": "restore_workspace_backup",
                "zip_path": str(path),
                "target_root": str(target),
                "file_count": file_count,
                "bytes": bytes_written,
            }
        )
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": True,
            "zipPath": str(path),
            "targetRoot": str(target),
            "fileCount": file_count,
            "bytes": bytes_written,
            "manifest": verification.get("manifest") or {},
            "stateSummary": state_summary,
            "warnings": summary_warnings,
        }

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

    def _normalize_candidate_media_action(self, action: str) -> str:
        action = str(action or "").strip().lower()
        if action == "delete":
            action = "trash"
        if action not in {"copy", "move", "trash"}:
            raise ValueError("Media action must be copy, move, or trash.")
        return action

    def _candidate_media_source(self, candidate: ReviewCandidate) -> Path:
        if candidate.media_kind == "video" and candidate.media_source_path:
            return Path(candidate.media_source_path)
        return Path(candidate.source_path)

    def _candidate_media_destination_root(self, action: str, folder: Path | None = None) -> Path:
        if folder is not None:
            return folder.expanduser().resolve()
        if action == "trash":
            return self.root / "media-trash"
        return self.root / "exports" / "media-actions"

    def _unique_candidate_ids_or_raise(self, candidate_ids: list[str]) -> list[str]:
        unique_ids = list(dict.fromkeys(str(candidate_id) for candidate_id in candidate_ids if str(candidate_id).strip()))
        if not unique_ids:
            raise ValueError("Select at least one possible match first.")
        missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
        if missing:
            raise KeyError(f"Candidate not found: {missing[0]}")
        return unique_ids

    def _destination_storage_report(self, destination_root: Path) -> dict[str, Any]:
        probe = destination_root
        while not probe.exists() and probe.parent != probe:
            probe = probe.parent
        try:
            usage = shutil.disk_usage(probe)
            return {
                "path": str(destination_root),
                "freeBytes": int(usage.free),
                "totalBytes": int(usage.total),
            }
        except OSError:
            return {"path": str(destination_root), "freeBytes": 0, "totalBytes": 0}

    def preview_candidate_media_action(self, candidate_ids: list[str], action: str, folder: Path | None = None, item_limit: int = 120, item_offset: int = 0) -> dict[str, Any]:
        action = self._normalize_candidate_media_action(action)
        unique_ids = self._unique_candidate_ids_or_raise(candidate_ids)
        item_limit = max(1, min(250, int(item_limit)))
        item_offset = max(0, int(item_offset))
        destination_root = self._candidate_media_destination_root(action, folder)
        reference_paths = {
            str(safe_resolve(Path(ref.source_path)))
            for ref in self.references.values()
            if ref.source_path
        }
        generated_roots = [safe_resolve(self.previews_path), safe_resolve(self.video_frames_path)]
        seen_sources: dict[str, dict[str, Any]] = {}
        actionable_source_keys: set[str] = set()
        items: list[dict[str, Any]] = []
        counts = {
            "selected": len(unique_ids),
            "actionable": 0,
            "uniqueSources": 0,
            "duplicateSources": 0,
            "missing": 0,
            "symlinks": 0,
            "protectedReferences": 0,
            "generatedFiles": 0,
            "skipped": 0,
            "removedCandidatesEstimate": 0,
            "totalBytes": 0,
        }

        for preview_index, candidate_id in enumerate(unique_ids):
            candidate = self.candidates[candidate_id]
            source = self._candidate_media_source(candidate).expanduser()
            resolved_source = safe_resolve(source)
            source_key = str(resolved_source)
            size_bytes = 0
            reason = ""
            result = "ready"
            actionable = False
            duplicate = source_key in seen_sources
            if duplicate:
                counts["duplicateSources"] += 1
                previous = seen_sources[source_key]
                actionable = bool(previous.get("actionable"))
                size_bytes = int(previous.get("sizeBytes", 0) or 0)
                result = "duplicate_source" if actionable else "skipped"
                reason = "duplicate_source" if actionable else str(previous.get("reason", "duplicate_source"))
            else:
                try:
                    exists = resolved_source.exists()
                    is_file = resolved_source.is_file()
                    is_symlink = resolved_source.is_symlink()
                    size_bytes = int(resolved_source.stat().st_size) if exists and is_file else 0
                except OSError as exc:
                    exists = False
                    is_file = False
                    is_symlink = False
                    reason = f"stat_error: {exc}"
                if not reason:
                    if not exists or not is_file:
                        reason = "missing"
                        counts["missing"] += 1
                    elif is_symlink:
                        reason = "symbolic_links_are_not_managed"
                        counts["symlinks"] += 1
                    elif action in {"move", "trash"} and source_key in reference_paths:
                        reason = "source_is_also_a_saved_person_photo"
                        counts["protectedReferences"] += 1
                    elif action in {"move", "trash"} and any(root == resolved_source or root in resolved_source.parents for root in generated_roots):
                        reason = "generated_app_file"
                        counts["generatedFiles"] += 1
                actionable = not reason
                if actionable:
                    counts["actionable"] += 1
                    counts["uniqueSources"] += 1
                    counts["totalBytes"] += size_bytes
                    actionable_source_keys.add(source_key)
                else:
                    counts["skipped"] += 1
                    result = "skipped"
                seen_sources[source_key] = {"actionable": actionable, "reason": reason, "sizeBytes": size_bytes}
            if action in {"move", "trash"} and actionable:
                actionable_source_keys.add(source_key)
            if preview_index >= item_offset and len(items) < item_limit:
                items.append(
                    {
                        "candidateId": candidate.candidate_id,
                        "personName": candidate.person_name,
                        "sourcePath": str(source),
                        "mediaKind": candidate.media_kind,
                        "sizeBytes": size_bytes,
                        "duplicate": duplicate,
                        "result": result,
                        "reason": reason,
                    }
                )

        if action in {"move", "trash"} and actionable_source_keys:
            for candidate in self.candidates.values():
                try:
                    if str(safe_resolve(self._candidate_media_source(candidate))) in actionable_source_keys:
                        counts["removedCandidatesEstimate"] += 1
                except Exception:
                    continue

        storage = self._destination_storage_report(destination_root)
        warnings: list[str] = []
        if counts["skipped"]:
            warnings.append(f"{counts['skipped']} selected item(s) cannot be changed and will be skipped.")
        if action in {"move", "trash"} and counts["removedCandidatesEstimate"]:
            warnings.append(f"{counts['removedCandidatesEstimate']} review row(s) will be removed after files are moved.")
        if storage["freeBytes"] and counts["totalBytes"] and action in {"copy", "move"} and storage["freeBytes"] < counts["totalBytes"]:
            warnings.append("The destination may not have enough free space.")
        return {
            "action": action,
            "destinationRoot": str(destination_root),
            "counts": counts,
            "storage": storage,
            "warnings": warnings,
            "items": items,
            "itemsOffset": item_offset,
            "itemsLimit": item_limit,
            "itemsTotal": len(unique_ids),
            "truncated": item_offset + len(items) < len(unique_ids),
        }

    def manage_candidate_media(self, candidate_ids: list[str], action: str, folder: Path | None = None, on_progress: ScanProgress | None = None) -> dict[str, Any]:
        action = self._normalize_candidate_media_action(action)
        unique_ids = self._unique_candidate_ids_or_raise(candidate_ids)

        destination_root = self._candidate_media_destination_root(action, folder)
        destination_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        action_root = destination_root / f"vintrace-{action}-{stamp}"
        counter = 2
        while action_root.exists():
            action_root = destination_root / f"vintrace-{action}-{stamp}-{counter}"
            counter += 1
        media_root = action_root / "media"
        media_root.mkdir(parents=True, exist_ok=True)

        reference_paths = {
            str(safe_resolve(Path(ref.source_path)))
            for ref in self.references.values()
            if ref.source_path
        }
        copied_or_moved_sources: dict[str, dict[str, Any]] = {}
        affected_source_keys: set[str] = set()
        removable_candidate_ids: set[str] = set()
        items: list[dict[str, Any]] = []
        counts = {
            "selected": len(unique_ids),
            "copied": 0,
            "moved": 0,
            "trashed": 0,
            "skipped": 0,
            "removedCandidates": 0,
            "cancelled": False,
            "verified": 0,
            "verificationFailed": 0,
        }

        def safe_source_key(path: Path) -> str:
            return str(safe_resolve(path))

        def unique_target(source: Path, candidate: ReviewCandidate, index: int) -> Path:
            person_dir = media_root / self._safe_filename(candidate.person_name or "Unlabeled")
            person_dir.mkdir(parents=True, exist_ok=True)
            suffix = source.suffix.lower() or ".bin"
            stem = self._safe_filename(source.stem)[:80]
            target = person_dir / f"{index:05d}-{self._safe_filename(candidate.candidate_id)}-{stem}{suffix}"
            target_counter = 2
            while target.exists():
                target = person_dir / f"{index:05d}-{self._safe_filename(candidate.candidate_id)}-{stem}-{target_counter}{suffix}"
                target_counter += 1
            return target

        def append_item(
            candidate: ReviewCandidate,
            source: Path,
            target: str,
            status: str,
            reason: str = "",
            source_size_bytes: int = 0,
            target_size_bytes: int = 0,
            verified: bool = False,
            verify_status: str = "",
        ) -> None:
            items.append(
                {
                    "candidateId": candidate.candidate_id,
                    "personName": candidate.person_name,
                    "status": candidate.status,
                    "score": round(float(candidate.score), 6),
                    "mediaKind": candidate.media_kind,
                    "sourcePath": str(source),
                    "targetPath": target,
                    "action": action,
                    "result": status,
                    "reason": reason,
                    "sourceSizeBytes": source_size_bytes,
                    "targetSizeBytes": target_size_bytes,
                    "verified": verified,
                    "verifyStatus": verify_status,
                }
            )

        started = time.monotonic()
        total = len(unique_ids)

        def emit(phase: str, current_path: str = "", message: str = "") -> None:
            if not on_progress:
                return
            processed = len(items)
            elapsed_ms = max(1, int((time.monotonic() - started) * 1000))
            remaining = max(0, total - processed)
            eta_ms = int((elapsed_ms / max(1, processed)) * remaining) if processed else None
            on_progress(
                {
                    "phase": phase,
                    "action": action,
                    "processed": processed,
                    "total": total,
                    "currentPath": current_path,
                    "message": message,
                    "destinationPath": str(action_root),
                    "elapsedMs": elapsed_ms,
                    "etaMs": eta_ms,
                    **counts,
                }
            )

        self.clear_media_action_cancel()
        emit("started", message="Preparing source files.")
        generated_roots = [safe_resolve(self.previews_path), safe_resolve(self.video_frames_path)]
        for index, candidate_id in enumerate(unique_ids, start=1):
            if self.media_action_cancel_requested():
                counts["cancelled"] = True
                emit("cancelled", message="Media action cancelled.")
                break
            candidate = self.candidates[candidate_id]
            source = self._candidate_media_source(candidate).expanduser()
            resolved_source = safe_resolve(source)
            source_key = str(resolved_source)
            emit("processing", str(source), f"{action.title()} source media.")
            if source_key in copied_or_moved_sources:
                previous = copied_or_moved_sources[source_key]
                append_item(
                    candidate,
                    source,
                    str(previous.get("targetPath", "")),
                    "duplicate_source",
                    source_size_bytes=int(previous.get("sourceSizeBytes", 0) or 0),
                    target_size_bytes=int(previous.get("targetSizeBytes", 0) or 0),
                    verified=bool(previous.get("verified", False)),
                    verify_status=str(previous.get("verifyStatus", "duplicate_source")),
                )
                if action in {"move", "trash"}:
                    affected_source_keys.add(source_key)
                    removable_candidate_ids.add(candidate.candidate_id)
                continue
            try:
                exists = resolved_source.exists()
                is_file = resolved_source.is_file()
                is_symlink = resolved_source.is_symlink()
            except OSError as exc:
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", f"stat_error: {exc}")
                continue
            if not exists or not is_file:
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", "missing")
                continue
            if is_symlink:
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", "symbolic_links_are_not_managed")
                continue
            if action in {"move", "trash"} and source_key in reference_paths:
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", "source_is_also_a_saved_person_photo")
                continue
            if action in {"move", "trash"} and any(root == resolved_source or root in resolved_source.parents for root in generated_roots):
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", "generated_app_file")
                continue

            target = unique_target(resolved_source, candidate, index)
            source_size_bytes = 0
            try:
                source_size_bytes = int(resolved_source.stat().st_size)
            except OSError:
                source_size_bytes = 0
            try:
                if action == "copy":
                    shutil.copy2(resolved_source, target)
                    counts["copied"] += 1
                    result_status = "copied"
                else:
                    shutil.move(str(resolved_source), str(target))
                    if action == "move":
                        counts["moved"] += 1
                        result_status = "moved"
                    else:
                        counts["trashed"] += 1
                        result_status = "trashed"
                    affected_source_keys.add(source_key)
                    removable_candidate_ids.add(candidate.candidate_id)
                try:
                    target_size_bytes = int(target.stat().st_size)
                except OSError:
                    target_size_bytes = 0
                verified = bool(source_size_bytes and target_size_bytes == source_size_bytes)
                verify_status = "size_match" if verified else "size_mismatch_or_unavailable"
                if verified:
                    counts["verified"] += 1
                else:
                    counts["verificationFailed"] += 1
                copied_or_moved_sources[source_key] = {
                    "targetPath": str(target),
                    "sourceSizeBytes": source_size_bytes,
                    "targetSizeBytes": target_size_bytes,
                    "verified": verified,
                    "verifyStatus": verify_status,
                }
                append_item(candidate, source, str(target), result_status, source_size_bytes=source_size_bytes, target_size_bytes=target_size_bytes, verified=verified, verify_status=verify_status)
            except OSError as exc:
                counts["skipped"] += 1
                append_item(candidate, source, "", "skipped", f"io_error: {exc}", source_size_bytes=source_size_bytes)

        if action in {"move", "trash"} and affected_source_keys:
            for candidate_id, candidate in list(self.candidates.items()):
                try:
                    if safe_source_key(self._candidate_media_source(candidate)) in affected_source_keys:
                        removable_candidate_ids.add(candidate_id)
                except Exception:
                    continue
            self._mark_candidates_deleted(removable_candidate_ids)
            for candidate_id in removable_candidate_ids:
                self.candidates.pop(candidate_id, None)
            counts["removedCandidates"] = len(removable_candidate_ids)

        manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "action": action,
            "destinationPath": str(action_root),
            "mediaPath": str(media_root),
            "counts": counts,
            "items": items,
            "note": (
                "Trash is app-managed: recover files from this folder if needed."
                if action == "trash"
                else "Copy and move actions operate on original source media, not face vectors."
            ),
        }
        manifest_path = action_root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        self._append_audit(
            {
                "action": "manage_candidate_media",
                "media_action": action,
                "selected": len(unique_ids),
                "copied": counts["copied"],
                "moved": counts["moved"],
                "trashed": counts["trashed"],
                "skipped": counts["skipped"],
                "removed_candidates": counts["removedCandidates"],
                "cancelled": counts["cancelled"],
                "manifest_path": str(manifest_path),
            }
        )
        if action in {"move", "trash"} and removable_candidate_ids:
            self.save()
        result = {
            "action": action,
            "destinationPath": str(action_root),
            "mediaPath": str(media_root),
            "manifestPath": str(manifest_path),
            "counts": counts,
            "items": items,
        }
        emit("cancelled" if counts["cancelled"] else "complete", message="Media action cancelled." if counts["cancelled"] else "Media action complete.")
        self.clear_media_action_cancel()
        return result

    def _read_media_action_manifest(self, manifest_path: Path) -> dict[str, Any]:
        path = manifest_path.expanduser().resolve()
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Media action manifest is invalid.")
        if str(payload.get("workspace", "")) != str(self.root):
            raise ValueError("This media action manifest belongs to another app folder.")
        return payload

    def media_action_history(self, limit: int = 20) -> dict[str, Any]:
        limit = max(1, min(100, int(limit)))
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for event in reversed(self._read_audit_rows()):
            if event.get("action") != "manage_candidate_media":
                continue
            manifest_value = str(event.get("manifest_path", "")).strip()
            if not manifest_value or manifest_value in seen:
                continue
            seen.add(manifest_value)
            manifest_path = Path(manifest_value)
            manifest: dict[str, Any] = {}
            if manifest_path.exists():
                try:
                    manifest = self._read_media_action_manifest(manifest_path)
                except Exception:
                    manifest = {}
            counts = manifest.get("counts") if isinstance(manifest.get("counts"), dict) else {}
            items = manifest.get("items") if isinstance(manifest.get("items"), list) else []
            skipped_items = [item for item in items if isinstance(item, dict) and str(item.get("result")) == "skipped"]
            row = {
                "manifestPath": manifest_value,
                "generatedAt": manifest.get("generatedAt") or event.get("at", ""),
                "action": manifest.get("action") or event.get("media_action", ""),
                "destinationPath": manifest.get("destinationPath") or "",
                "mediaPath": manifest.get("mediaPath") or "",
                "counts": {
                    "selected": int(counts.get("selected", event.get("selected", 0)) or 0),
                    "copied": int(counts.get("copied", event.get("copied", 0)) or 0),
                    "moved": int(counts.get("moved", event.get("moved", 0)) or 0),
                    "trashed": int(counts.get("trashed", event.get("trashed", 0)) or 0),
                    "skipped": int(counts.get("skipped", event.get("skipped", 0)) or 0),
                    "removedCandidates": int(counts.get("removedCandidates", event.get("removed_candidates", 0)) or 0),
                    "verified": int(counts.get("verified", 0) or 0),
                    "verificationFailed": int(counts.get("verificationFailed", 0) or 0),
                    "cancelled": bool(counts.get("cancelled", event.get("cancelled", False))),
                },
                "exists": manifest_path.exists(),
                "canRestore": bool((manifest.get("action") or event.get("media_action")) == "trash" and int(counts.get("trashed", event.get("trashed", 0)) or 0) > 0),
                "canUndo": bool(manifest_path.exists() and (int(counts.get("copied", 0) or 0) + int(counts.get("moved", 0) or 0) + int(counts.get("trashed", 0) or 0)) > 0),
                "canRetry": bool(skipped_items),
                "skippedItems": skipped_items[:8],
            }
            rows.append(row)
            if len(rows) >= limit:
                break
        return {"items": rows, "total": len(rows)}

    def restore_media_action(self, manifest_path: Path) -> dict[str, Any]:
        manifest = self._read_media_action_manifest(manifest_path)
        if str(manifest.get("action", "")) != "trash":
            raise ValueError("Only app trash actions can be restored.")
        restored = skipped = missing = existing = 0
        rows: list[dict[str, Any]] = []
        for item in manifest.get("items", []):
            if not isinstance(item, dict) or str(item.get("result")) != "trashed":
                continue
            source = Path(str(item.get("sourcePath", ""))).expanduser()
            target = Path(str(item.get("targetPath", ""))).expanduser()
            if not target.exists() or not target.is_file():
                missing += 1
                rows.append({**item, "restoreResult": "missing_trash_file"})
                continue
            if source.exists():
                existing += 1
                rows.append({**item, "restoreResult": "source_already_exists"})
                continue
            try:
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(source))
                restored += 1
                rows.append({**item, "restoreResult": "restored"})
            except OSError as exc:
                skipped += 1
                rows.append({**item, "restoreResult": f"io_error: {exc}"})
        result = {
            "manifestPath": str(manifest_path.expanduser().resolve()),
            "counts": {
                "restored": restored,
                "missing": missing,
                "existing": existing,
                "skipped": skipped,
            },
            "items": rows,
        }
        self._append_audit({"action": "restore_media_action", "manifest_path": result["manifestPath"], **result["counts"]})
        return result

    def retry_media_action(self, manifest_path: Path, folder: Path | None = None, on_progress: ScanProgress | None = None) -> dict[str, Any]:
        manifest = self._read_media_action_manifest(manifest_path)
        action = self._normalize_candidate_media_action(str(manifest.get("action", "")))
        candidate_ids = [
            str(item.get("candidateId"))
            for item in manifest.get("items", [])
            if isinstance(item, dict) and str(item.get("result")) == "skipped" and str(item.get("candidateId")) in self.candidates
        ]
        if not candidate_ids:
            return {
                "action": action,
                "destinationPath": str(manifest.get("destinationPath", "")),
                "mediaPath": str(manifest.get("mediaPath", "")),
                "manifestPath": str(manifest_path.expanduser().resolve()),
                "counts": {"selected": 0, "copied": 0, "moved": 0, "trashed": 0, "skipped": 0, "removedCandidates": 0},
                "items": [],
            }
        destination = folder.expanduser().resolve() if folder is not None else Path(str(manifest.get("destinationPath", ""))).expanduser().parent
        return self.manage_candidate_media(candidate_ids, action, destination, on_progress=on_progress)

    def _latest_media_action_manifest(self) -> Path:
        for row in self.media_action_history(limit=50).get("items", []):
            if row.get("exists") and row.get("canUndo"):
                return Path(str(row.get("manifestPath", "")))
        raise ValueError("No undoable file action was found.")

    def undo_media_action(self, manifest_path: Path | None = None) -> dict[str, Any]:
        target_manifest = manifest_path.expanduser().resolve() if manifest_path else self._latest_media_action_manifest()
        manifest = self._read_media_action_manifest(target_manifest)
        action = self._normalize_candidate_media_action(str(manifest.get("action", "")))
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        undo_root = self.root / "media-action-undo" / f"vintrace-undo-{stamp}"
        undo_root.mkdir(parents=True, exist_ok=True)
        counts = {
            "restored": 0,
            "removedCopies": 0,
            "missing": 0,
            "existing": 0,
            "skipped": 0,
        }
        rows: list[dict[str, Any]] = []
        for index, item in enumerate(manifest.get("items", []), start=1):
            if not isinstance(item, dict):
                continue
            result = str(item.get("result", ""))
            if action == "copy" and result != "copied":
                continue
            if action in {"move", "trash"} and result not in {"moved", "trashed"}:
                continue
            source = Path(str(item.get("sourcePath", ""))).expanduser()
            moved_target = Path(str(item.get("targetPath", ""))).expanduser()
            if not moved_target.exists() or not moved_target.is_file():
                counts["missing"] += 1
                rows.append({**item, "undoResult": "target_missing"})
                continue
            try:
                if action == "copy":
                    person_dir = undo_root / self._safe_filename(str(item.get("personName", "Unlabeled")))
                    person_dir.mkdir(parents=True, exist_ok=True)
                    suffix = moved_target.suffix or ".bin"
                    undo_target = person_dir / f"{index:05d}-{self._safe_filename(moved_target.stem)}{suffix}"
                    counter = 2
                    while undo_target.exists():
                        undo_target = person_dir / f"{index:05d}-{self._safe_filename(moved_target.stem)}-{counter}{suffix}"
                        counter += 1
                    shutil.move(str(moved_target), str(undo_target))
                    counts["removedCopies"] += 1
                    rows.append({**item, "undoResult": "copy_removed", "undoPath": str(undo_target)})
                else:
                    if source.exists():
                        counts["existing"] += 1
                        rows.append({**item, "undoResult": "source_already_exists"})
                        continue
                    source.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(moved_target), str(source))
                    counts["restored"] += 1
                    rows.append({**item, "undoResult": "restored"})
            except OSError as exc:
                counts["skipped"] += 1
                rows.append({**item, "undoResult": f"io_error: {exc}"})
        undo_manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "action": "undo_media_action",
            "originalManifestPath": str(target_manifest),
            "undoPath": str(undo_root),
            "counts": counts,
            "items": rows,
            "note": "Copy undo moves generated copies into this undo folder. Move/trash undo restores files to original paths when available.",
        }
        undo_manifest_path = undo_root / "manifest.json"
        undo_manifest_path.write_text(json.dumps(undo_manifest, indent=2), encoding="utf-8")
        self._append_audit({"action": "undo_media_action", "manifest_path": str(target_manifest), "undo_manifest_path": str(undo_manifest_path), **counts})
        return {"manifestPath": str(target_manifest), "undoManifestPath": str(undo_manifest_path), "undoPath": str(undo_root), "counts": counts, "items": rows}

    def _media_action_generated_ts(self, manifest: dict[str, Any], manifest_path: Path) -> float:
        value = str(manifest.get("generatedAt", "")).strip()
        if value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
        try:
            return manifest_path.stat().st_mtime
        except OSError:
            return 0.0

    def media_trash_report(self) -> dict[str, Any]:
        trash_root = self.root / "media-trash"
        now_ts = time.time()
        actions: list[dict[str, Any]] = []
        total_bytes = total_files = recoverable_files = 0
        older_than = {"7": 0, "30": 0, "90": 0}
        if trash_root.exists():
            for manifest_path in sorted(trash_root.glob("vintrace-trash-*/manifest.json"), reverse=True):
                try:
                    manifest = self._read_media_action_manifest(manifest_path)
                except Exception:
                    continue
                if str(manifest.get("action", "")) != "trash":
                    continue
                generated_ts = self._media_action_generated_ts(manifest, manifest_path)
                age_days = int(max(0, (now_ts - generated_ts) // (24 * 60 * 60))) if generated_ts else 0
                bytes_for_action = files_for_action = recoverable_for_action = 0
                for item in manifest.get("items", []):
                    if not isinstance(item, dict) or str(item.get("result")) != "trashed":
                        continue
                    target = Path(str(item.get("targetPath", ""))).expanduser()
                    if target.exists() and target.is_file():
                        files_for_action += 1
                        recoverable_for_action += 1
                        try:
                            bytes_for_action += int(target.stat().st_size)
                        except OSError:
                            pass
                for days in (7, 30, 90):
                    if age_days >= days:
                        older_than[str(days)] += files_for_action
                total_files += files_for_action
                recoverable_files += recoverable_for_action
                total_bytes += bytes_for_action
                actions.append(
                    {
                        "manifestPath": str(manifest_path),
                        "destinationPath": str(manifest.get("destinationPath", manifest_path.parent)),
                        "generatedAt": manifest.get("generatedAt", ""),
                        "ageDays": age_days,
                        "files": files_for_action,
                        "recoverableFiles": recoverable_for_action,
                        "bytes": bytes_for_action,
                    }
                )
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "trashPath": str(trash_root),
            "counts": {
                "actions": len(actions),
                "files": total_files,
                "recoverableFiles": recoverable_files,
                "bytes": total_bytes,
                "olderThanDays": older_than,
            },
            "actions": actions[:50],
        }

    def cleanup_media_trash(self, days: int = 30, dry_run: bool = True) -> dict[str, Any]:
        days = max(0, int(days))
        cutoff = time.time() - (days * 24 * 60 * 60)
        trash_root = self.root / "media-trash"
        deleted_dirs = deleted_files = deleted_bytes = 0
        targets: list[dict[str, Any]] = []
        if trash_root.exists():
            for manifest_path in sorted(trash_root.glob("vintrace-trash-*/manifest.json")):
                try:
                    manifest = self._read_media_action_manifest(manifest_path)
                except Exception:
                    continue
                if str(manifest.get("action", "")) != "trash":
                    continue
                generated_ts = self._media_action_generated_ts(manifest, manifest_path)
                if days > 0 and generated_ts and generated_ts > cutoff:
                    continue
                action_dir = manifest_path.parent
                bytes_for_dir = files_for_dir = 0
                for file_path in action_dir.rglob("*"):
                    if file_path.is_file():
                        files_for_dir += 1
                        try:
                            bytes_for_dir += int(file_path.stat().st_size)
                        except OSError:
                            pass
                targets.append({"path": str(action_dir), "files": files_for_dir, "bytes": bytes_for_dir})
                deleted_dirs += 1
                deleted_files += files_for_dir
                deleted_bytes += bytes_for_dir
                if not dry_run:
                    shutil.rmtree(action_dir, ignore_errors=True)
        result = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "dryRun": bool(dry_run),
            "days": days,
            "deletedDirs": deleted_dirs if not dry_run else 0,
            "deletedFiles": deleted_files if not dry_run else 0,
            "deletedBytes": deleted_bytes if not dry_run else 0,
            "previewDirs": deleted_dirs if dry_run else 0,
            "previewFiles": deleted_files if dry_run else 0,
            "previewBytes": deleted_bytes if dry_run else 0,
            "targets": targets[:50],
        }
        self._append_audit({"action": "cleanup_media_trash", "dry_run": bool(dry_run), "days": days, "files": deleted_files, "bytes": deleted_bytes})
        return result

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
            "noFaceDetected",
            "lowQualityFaces",
            "blockedPairs",
            "duplicateCandidates",
            "videoCandidateCap",
            "profileRescueAttempted",
            "profileRescueFound",
            "profileRescueMatched",
            "profileRescueUnmatched",
            "safeModeFaceCropAllowed",
            "poseFrontal",
            "poseThreeQuarter",
            "poseProfile",
            "poseUnknown",
            "poseRelaxedReviews",
            "poseRelaxedProfile",
            "poseRelaxedThreeQuarter",
            "poseReranked",
            "poseAmbiguous",
            "hardPoseUnsupported",
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
        chain = self.verify_audit_chain()
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {"events": len(rows)},
            "chain": chain,
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
        metric_keys = ["processed", "safeFiltered", "safeModeFaceCropAllowed", "videoProtected", "videoFrames", "errors", "added"]
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
                "safeModeZeroAdmittance": bool(self.config.safe_mode_zero_admittance),
                "faceCropCarveOutActive": not bool(self.config.safe_mode_zero_admittance),
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
        current_key = self._model_family_key(current)
        reference_models: dict[str, int] = {}
        candidate_models: dict[str, int] = {}
        stale_references = []
        stale_candidates = []
        stale_by_status = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        for ref in self.references.values():
            model = ref.model_name or "unknown"
            reference_models[model] = reference_models.get(model, 0) + 1
            if self._model_family_key(model) != current_key:
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
            if self._model_family_key(model) != current_key:
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

    def reference_gap_report(self, current_model: str | None = None) -> dict[str, Any]:
        current = str(current_model or "unknown").strip() or "unknown"
        confident = float(self.config.thresholds.confident)
        likely = float(self.config.thresholds.likely)
        people: dict[str, dict[str, Any]] = {}

        def person_bucket(name: str) -> dict[str, Any]:
            key = str(name or "").strip() or "Unnamed person"
            return people.setdefault(
                key.lower(),
                {
                    "personName": key,
                    "referenceCount": 0,
                    "compatibleReferences": 0,
                    "otherModelReferences": 0,
                    "poseCounts": {"frontal": 0, "threeQuarter": 0, "profile": 0, "edgeFace": 0, "unknown": 0},
                    "ageBuckets": {},
                    "averageQuality": 0.0,
                    "bestQuality": 0.0,
                    "pendingCandidates": 0,
                    "acceptedCandidates": 0,
                    "rejectedCandidates": 0,
                    "uncertainCandidates": 0,
                    "strongPending": 0,
                    "lowConfidencePending": 0,
                    "sampleReferenceNames": [],
                    "gaps": [],
                    "actions": [],
                    "score": 0,
                    "status": "weak",
                },
            )

        quality_sums: dict[str, float] = {}
        for ref in self.references.values():
            bucket = person_bucket(ref.person_name)
            person_key = str(ref.person_name or "").strip().lower() or "unnamed person"
            bucket["referenceCount"] += 1
            if self._compatible_reference_model_name(current, ref.model_name):
                bucket["compatibleReferences"] += 1
            else:
                bucket["otherModelReferences"] += 1
            pose = self._normalized_pose_bucket(ref.pose_bucket)
            pose_key = {"three-quarter": "threeQuarter", "edge-face": "edgeFace"}.get(pose, pose)
            bucket["poseCounts"][pose_key] = int(bucket["poseCounts"].get(pose_key, 0)) + 1
            age = str(ref.age_bucket or "unknown").strip() or "unknown"
            bucket["ageBuckets"][age] = int(bucket["ageBuckets"].get(age, 0)) + 1
            quality = max(0.0, min(1.0, float(ref.quality or 0.0)))
            quality_sums[person_key] = quality_sums.get(person_key, 0.0) + quality
            bucket["bestQuality"] = max(float(bucket["bestQuality"]), quality)
            if len(bucket["sampleReferenceNames"]) < 3:
                bucket["sampleReferenceNames"].append(Path(ref.source_path).name)

        for candidate in self.candidates.values():
            person_name = str(candidate.person_name or "").strip()
            if not person_name:
                continue
            person_key = person_name.lower()
            if person_key not in people:
                continue
            bucket = people[person_key]
            status = str(candidate.status or "pending")
            if status == "accepted":
                bucket["acceptedCandidates"] += 1
            elif status == "rejected":
                bucket["rejectedCandidates"] += 1
            elif status == "uncertain":
                bucket["uncertainCandidates"] += 1
            else:
                bucket["pendingCandidates"] += 1
                score = float(candidate.score or 0.0)
                if score >= confident:
                    bucket["strongPending"] += 1
                if score < likely:
                    bucket["lowConfidencePending"] += 1

        gap_counts: dict[str, int] = {}
        items: list[dict[str, Any]] = []
        for person_key, bucket in people.items():
            reference_count = int(bucket["referenceCount"])
            compatible_references = int(bucket["compatibleReferences"])
            other_model_references = int(bucket["otherModelReferences"])
            pose_counts = bucket["poseCounts"]
            age_bucket_count = sum(1 for count in bucket["ageBuckets"].values() if int(count) > 0)
            avg_quality = quality_sums.get(person_key, 0.0) / max(reference_count, 1)
            bucket["averageQuality"] = round(avg_quality, 4)
            bucket["bestQuality"] = round(float(bucket["bestQuality"]), 4)

            gaps: list[str] = []
            actions: list[str] = []
            if compatible_references == 0:
                gaps.append("needs-active-model-backfill")
                actions.append("Refresh saved photos for the active face model.")
            if reference_count < 2:
                gaps.append("needs-more-references")
                actions.append("Add at least one more clear photo for this person.")
            if int(pose_counts.get("profile", 0)) + int(pose_counts.get("edgeFace", 0)) == 0:
                gaps.append("needs-side-reference")
                actions.append("Add a side or profile photo to improve hard-angle matches.")
            if int(pose_counts.get("threeQuarter", 0)) == 0:
                gaps.append("needs-angled-reference")
                actions.append("Add a slightly angled photo if you have one.")
            if age_bucket_count < 2:
                gaps.append("needs-age-coverage")
                actions.append("Add photos from another age range when available.")
            if avg_quality < 0.35 or float(bucket["bestQuality"]) < 0.45:
                gaps.append("needs-clearer-reference")
                actions.append("Add a brighter, sharper face photo.")
            if int(bucket["pendingCandidates"]) >= 20 and int(bucket["acceptedCandidates"]) + int(bucket["rejectedCandidates"]) == 0:
                gaps.append("needs-review-feedback")
                actions.append("Accept or reject a few matches so the queue reflects your decisions.")
            if other_model_references > 0 and compatible_references > 0:
                gaps.append("mixed-model-references")
                actions.append("Refresh older saved photos when convenient.")

            score = 100
            if compatible_references == 0:
                score -= 34
            if reference_count == 1:
                score -= 24
            elif reference_count == 2:
                score -= 8
            if int(pose_counts.get("profile", 0)) + int(pose_counts.get("edgeFace", 0)) == 0:
                score -= 18
            if int(pose_counts.get("threeQuarter", 0)) == 0:
                score -= 8
            if age_bucket_count < 2:
                score -= 10
            if avg_quality < 0.35:
                score -= 16
            if float(bucket["bestQuality"]) < 0.45:
                score -= 8
            if other_model_references > 0:
                score -= 8 if compatible_references else 0
            if int(bucket["pendingCandidates"]) >= 20 and int(bucket["acceptedCandidates"]) + int(bucket["rejectedCandidates"]) == 0:
                score -= 8
            score = max(0, min(100, score))
            status = "strong" if score >= 78 else "usable" if score >= 55 else "weak"
            if compatible_references == 0:
                status = "blocked"

            for gap in gaps:
                gap_counts[gap] = gap_counts.get(gap, 0) + 1
            bucket["gaps"] = gaps
            bucket["actions"] = actions[:4]
            bucket["score"] = score
            bucket["status"] = status
            items.append(bucket)

        items.sort(key=lambda row: (int(row["score"]), -int(row["pendingCandidates"]), row["personName"].lower()))
        needs_attention = sum(1 for row in items if row["status"] in {"weak", "blocked"})
        average_score = round(sum(int(row["score"]) for row in items) / max(len(items), 1), 1) if items else 0.0
        top_gaps = [
            {"gap": gap, "count": count}
            for gap, count in sorted(gap_counts.items(), key=lambda row: (-row[1], row[0]))[:6]
        ]
        recommendations: list[str] = []
        if not items:
            recommendations.append("Add saved photos for at least one person before scanning.")
        elif needs_attention:
            recommendations.append("Start with the people marked weak or blocked; they create the most review noise.")
        if any(row["poseCounts"].get("profile", 0) + row["poseCounts"].get("edgeFace", 0) == 0 for row in items):
            recommendations.append("Side/profile references improve hard-angle discovery and reduce missed review rows.")
        if any(len(row["ageBuckets"]) < 2 for row in items):
            recommendations.append("Multi-age references help when scanning old family libraries.")
        if any(row["otherModelReferences"] for row in items):
            recommendations.append("Refresh saved photos after model changes so all people use the same embedding space.")
        if not recommendations:
            recommendations.append("Reference coverage looks ready for normal scanning.")

        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "currentModel": current,
            "people": len(items),
            "needsAttention": needs_attention,
            "strongPeople": sum(1 for row in items if row["status"] == "strong"),
            "averageScore": average_score,
            "topGaps": top_gaps,
            "items": items,
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
        metrics = {name: accuracy_at_threshold(labeled, threshold) for name, threshold in thresholds.items()}
        segments = {
            "images": accuracy_at_threshold([item for item in labeled if item.media_kind != "video"], thresholds["likely"]),
            "videos": accuracy_at_threshold([item for item in labeled if item.media_kind == "video"], thresholds["likely"]),
            "lowQuality": accuracy_at_threshold([item for item in labeled if item.quality < self.config.thresholds.quality_min], thresholds["likely"]),
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

    def generate_accuracy_validation_pack(self, folder: Path | None = None, import_labels: bool = False) -> dict[str, Any]:
        export_root = (folder or self.validation_packs_path).expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        pack_root = export_root / "vintrace-accuracy-validation-pack-v1"
        if pack_root.exists():
            if pack_root.is_symlink() or safe_is_mount(pack_root):
                raise ValueError("Validation pack folder is not safe to overwrite.")
            shutil.rmtree(pack_root)
        refs_dir = pack_root / "references"
        cases_dir = pack_root / "cases"
        refs_dir.mkdir(parents=True, exist_ok=True)
        cases_dir.mkdir(parents=True, exist_ok=True)

        scenario_specs = [
            {
                "scenario": "cross-age",
                "person": "Validation Person A",
                "variant": "cross_age",
                "is_match": True,
                "score": 0.62,
                "quality": 0.88,
                "media_kind": "image",
                "difficulty": "medium",
                "description": "Same synthetic identity with age-shape and texture changes.",
            },
            {
                "scenario": "low-light",
                "person": "Validation Person A",
                "variant": "low_light",
                "is_match": True,
                "score": 0.36,
                "quality": 0.42,
                "media_kind": "image",
                "difficulty": "hard",
                "description": "Same identity under low brightness and reduced contrast.",
            },
            {
                "scenario": "video-frame",
                "person": "Validation Person A",
                "variant": "video_frame",
                "is_match": True,
                "score": 0.39,
                "quality": 0.52,
                "media_kind": "video",
                "difficulty": "medium",
                "description": "Same identity as a compressed video-frame style sample.",
            },
            {
                "scenario": "side-profile",
                "person": "Validation Person A",
                "variant": "side_profile",
                "is_match": True,
                "score": 0.34,
                "quality": 0.48,
                "media_kind": "image",
                "difficulty": "hard",
                "description": "Same identity with one-sided facial evidence.",
            },
            {
                "scenario": "occlusion",
                "person": "Validation Person A",
                "variant": "occlusion",
                "is_match": True,
                "score": 0.31,
                "quality": 0.45,
                "media_kind": "image",
                "difficulty": "hard",
                "description": "Same identity with the lower face partially covered.",
            },
            {
                "scenario": "family-lookalike",
                "person": "Validation Person B",
                "variant": "family_lookalike",
                "is_match": False,
                "score": 0.18,
                "quality": 0.84,
                "media_kind": "image",
                "difficulty": "hard-negative",
                "description": "Similar synthetic face that should stay below match threshold.",
            },
        ]
        reference_path = refs_dir / "validation-person-a-reference.jpg"
        self._write_validation_face(reference_path, "reference", person_seed=11)
        labels: list[dict[str, Any]] = []
        cases: list[dict[str, Any]] = []
        for index, spec in enumerate(scenario_specs, start=1):
            scenario = str(spec["scenario"])
            case_dir = cases_dir / scenario
            case_dir.mkdir(parents=True, exist_ok=True)
            candidate_path = case_dir / f"{index:02d}-{scenario}.jpg"
            self._write_validation_face(candidate_path, str(spec["variant"]), person_seed=19 if not spec["is_match"] else 11)
            source_hash = sha256_file(candidate_path)
            label = {
                "candidateId": f"validation-{scenario}",
                "sourcePath": str(candidate_path),
                "sourceHash": source_hash,
                "expectedPerson": "Validation Person A",
                "actualPerson": "Validation Person A" if spec["is_match"] else "",
                "matchScore": float(spec["score"]),
                "quality": float(spec["quality"]),
                "isMatch": bool(spec["is_match"]),
                "status": "accepted" if spec["is_match"] else "rejected",
                "mediaKind": str(spec["media_kind"]),
                "safeLabel": scenario,
                "scenario": scenario,
                "difficulty": str(spec["difficulty"]),
                "createdAt": now_iso(),
            }
            labels.append(label)
            cases.append(
                {
                    "scenario": scenario,
                    "description": str(spec["description"]),
                    "difficulty": str(spec["difficulty"]),
                    "referencePath": str(reference_path),
                    "candidatePath": str(candidate_path),
                    "expectedMatch": bool(spec["is_match"]),
                    "score": float(spec["score"]),
                    "quality": float(spec["quality"]),
                    "mediaKind": str(spec["media_kind"]),
                    "sourceHash": source_hash,
                }
            )

        thresholds = {
            "reviewMore": float(self.config.thresholds.relaxed_child),
            "likely": float(self.config.thresholds.likely),
            "strong": float(self.config.thresholds.confident),
        }
        metrics = {name: accuracy_from_label_rows(labels, threshold) for name, threshold in thresholds.items()}
        segments = {
            scenario: accuracy_from_label_rows([row for row in labels if row.get("scenario") == scenario], thresholds["likely"])
            for scenario in sorted({str(row.get("scenario")) for row in labels})
        }
        manifest = {
            "schemaVersion": 1,
            "name": "Vintrace Accuracy Validation Pack",
            "packVersion": "2026.06",
            "generatedAt": now_iso(),
            "workspace": str(self.root),
            "referencePath": str(reference_path),
            "scenarios": [case["scenario"] for case in cases],
            "thresholds": thresholds,
            "metrics": metrics,
            "segments": segments,
            "cases": cases,
            "labels": labels,
            "notes": [
                "Synthetic validation images are generated locally and are not training data.",
                "Use this pack to verify threshold behavior for cross-age, low-light, video-frame, side-profile, occlusion, and family-lookalike cases.",
            ],
        }
        manifest_path = pack_root / "manifest.json"
        labels_json_path = pack_root / "labels.json"
        labels_csv_path = pack_root / "labels.csv"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        labels_json_path.write_text(json.dumps({"labels": labels, "generatedAt": manifest["generatedAt"]}, indent=2), encoding="utf-8")
        with labels_csv_path.open("w", encoding="utf-8", newline="") as handle:
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
                    "safeLabel",
                    "scenario",
                    "difficulty",
                    "createdAt",
                ],
            )
            writer.writeheader()
            for row in labels:
                writer.writerow(row)
        import_result = self.import_accuracy_labels(labels) if import_labels else None
        self._append_audit(
            {
                "action": "generate_accuracy_validation_pack",
                "pack_path": str(pack_root),
                "cases": len(cases),
                "imported": int(import_result.get("imported", 0)) if isinstance(import_result, dict) else 0,
            }
        )
        return {
            "packPath": str(pack_root),
            "manifestPath": str(manifest_path),
            "labelsJsonPath": str(labels_json_path),
            "labelsCsvPath": str(labels_csv_path),
            "counts": {
                "cases": len(cases),
                "matches": sum(1 for row in labels if row["isMatch"]),
                "nonMatches": sum(1 for row in labels if not row["isMatch"]),
            },
            "scenarios": [case["scenario"] for case in cases],
            "metrics": metrics,
            "segments": segments,
            "recommendations": self._validation_pack_recommendations(metrics, segments),
            "importResult": import_result,
        }

    def run_accuracy_validation_pack(self, folder: Path | None = None, import_labels: bool = False, store: bool = True) -> dict[str, Any]:
        pack = self.generate_accuracy_validation_pack(folder=folder, import_labels=import_labels)
        thresholds = {
            "reviewMore": float(self.config.thresholds.relaxed_child),
            "likely": float(self.config.thresholds.likely),
            "strong": float(self.config.thresholds.confident),
        }
        labels_payload = self._read_json_object(Path(str(pack["labelsJsonPath"])))
        labels = labels_payload.get("labels", []) if isinstance(labels_payload, dict) else []
        rows = [row for row in labels if isinstance(row, dict)]
        scenario_results = [self._validation_scenario_result(row, thresholds) for row in rows]
        failed = sum(1 for row in scenario_results if row["status"] == "fail")
        warned = sum(1 for row in scenario_results if row["status"] == "warn")
        status = "fail" if failed else "warn" if warned else "pass"
        run = {
            "runId": new_id("validation"),
            "generatedAt": now_iso(),
            "status": status,
            "passed": sum(1 for row in scenario_results if row["status"] == "pass"),
            "warned": warned,
            "failed": failed,
            "scenarioResults": scenario_results,
            "thresholds": thresholds,
            "metrics": pack.get("metrics", {}),
            "segments": pack.get("segments", {}),
            "counts": pack.get("counts", {}),
            "packPath": pack.get("packPath", ""),
            "manifestPath": pack.get("manifestPath", ""),
            "labelsJsonPath": pack.get("labelsJsonPath", ""),
            "labelsCsvPath": pack.get("labelsCsvPath", ""),
            "recommendations": self._validation_run_recommendations(status, scenario_results),
        }
        if store:
            history = [run, *self.accuracy_validation_history(limit=49)]
            self._write_json_atomic(self.accuracy_validation_history_path, history[:50])
            self._append_audit(
                {
                    "action": "run_accuracy_validation_pack",
                    "run_id": run["runId"],
                    "status": status,
                    "passed": run["passed"],
                    "warned": warned,
                    "failed": failed,
                }
            )
        else:
            history = self.accuracy_validation_history(limit=50)
        return {
            **pack,
            "runId": run["runId"],
            "status": status,
            "passed": run["passed"],
            "warned": warned,
            "failed": failed,
            "scenarioResults": scenario_results,
            "validation": run,
            "history": [run, *history[:19]] if store else history[:20],
        }

    def accuracy_validation_history(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._read_json_array(self.accuracy_validation_history_path)
        result = [row for row in rows if isinstance(row, dict)]
        return result[: max(1, min(100, int(limit or 20)))]

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
            # PC-03: be explicit that face embeddings and previews are stored
            # unencrypted at rest and that Workspace Lock is an in-app access
            # control, not on-disk encryption.
            "dataAtRest": {
                "encrypted": False,
                "biometricStorage": "Face embeddings and generated previews are stored unencrypted in the app folder.",
                "workspaceLock": "Workspace Lock gates access inside the app; it does not encrypt files on disk.",
                "backupEncryption": (
                    "Available now: set VINTRACE_BACKUP_PASSPHRASE and workspace backups are encrypted at rest "
                    "(AES-256-GCM, scrypt-derived key); verify/restore require the same passphrase."
                    if backup_passphrase()
                    else "Optional: set VINTRACE_BACKUP_PASSPHRASE to encrypt exported workspace backups at rest "
                    "(AES-256-GCM). The live workspace itself is still unencrypted on disk."
                ),
                "note": "Protect the app folder with OS full-disk/account encryption; another local user or process can read the raw files.",
            },
            "recommendations": [
                "Use Delete face data before handing this app folder to someone else.",
                "Export what you need first; deleted face data cannot be restored unless you have a backup.",
                "Keep the app folder on an OS-encrypted volume — files at rest are not encrypted by Vintrace.",
                "For portable backups, set VINTRACE_BACKUP_PASSPHRASE so exported backup ZIPs are encrypted at rest.",
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
        self._invalidate_reference_indexes()
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

    def _validation_pack_recommendations(self, metrics: dict[str, dict[str, Any]], segments: dict[str, dict[str, Any]]) -> list[str]:
        recommendations: list[str] = []
        likely = metrics.get("likely", {})
        if int(likely.get("falsePositives", 0) or 0):
            recommendations.append("Raise Likely match or require High confidence when family-lookalike negatives trigger matches.")
        if int(likely.get("falseNegatives", 0) or 0):
            recommendations.append("Review low-light, side-profile, and occlusion examples before lowering thresholds.")
        weak_segments = [
            name
            for name, row in segments.items()
            if int(row.get("labeled", 0) or 0) and (int(row.get("falsePositives", 0) or 0) or int(row.get("falseNegatives", 0) or 0))
        ]
        if weak_segments:
            recommendations.append(f"Scenario threshold attention needed: {', '.join(sorted(weak_segments))}.")
        if not recommendations:
            recommendations.append("Validation pack thresholds pass the generated scenario suite.")
        recommendations.append("Replace or extend this synthetic pack with consented labeled photos before making demographic accuracy claims.")
        return recommendations

    def _validation_scenario_result(self, row: dict[str, Any], thresholds: dict[str, float]) -> dict[str, Any]:
        try:
            score = float(row.get("matchScore", 0.0) or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        is_match = bool(row.get("isMatch"))
        scenario = str(row.get("scenario") or row.get("safeLabel") or "unknown")
        likely = float(thresholds.get("likely", self.config.thresholds.likely))
        review_more = float(thresholds.get("reviewMore", self.config.thresholds.relaxed_child))
        predicted_likely = score >= likely
        predicted_review = score >= review_more
        if is_match and predicted_likely:
            status = "pass"
            detail = "Expected match remains above the Likely threshold."
        elif is_match and predicted_review:
            status = "warn"
            detail = "Expected match only passes the broader Review more threshold."
        elif is_match:
            status = "fail"
            detail = "Expected match falls below the Review more threshold."
        elif predicted_likely:
            status = "fail"
            detail = "Expected non-match crosses the Likely threshold."
        elif predicted_review:
            status = "warn"
            detail = "Expected non-match enters Review more and needs human attention."
        else:
            status = "pass"
            detail = "Expected non-match stays below matching thresholds."
        return {
            "scenario": scenario,
            "status": status,
            "expectedMatch": is_match,
            "score": round(score, 4),
            "likelyThreshold": round(likely, 4),
            "reviewMoreThreshold": round(review_more, 4),
            "difficulty": str(row.get("difficulty", "")),
            "mediaKind": str(row.get("mediaKind", "image")),
            "detail": detail,
        }

    def _validation_run_recommendations(self, status: str, scenario_results: list[dict[str, Any]]) -> list[str]:
        weak = [str(row.get("scenario", "")) for row in scenario_results if row.get("status") != "pass"]
        if status == "pass":
            return [
                "Validation pack passed the synthetic scenario suite.",
                "Use consented real-world labels before publishing demographic or production accuracy claims.",
            ]
        if status == "warn":
            return [
                f"Review threshold behavior for: {', '.join(weak)}.",
                "Warnings mean human review catches the case, but automatic confidence should not be raised yet.",
            ]
        return [
            f"Validation failed for: {', '.join(weak)}.",
            "Do not ship new matching thresholds until failed validation scenarios are resolved.",
        ]

    def _write_validation_face(self, path: Path, variant: str, person_seed: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new("RGB", (360, 360), (226, 231, 239))
        draw = ImageDraw.Draw(image)
        accent = (120 + person_seed * 3 % 80, 82 + person_seed * 5 % 80, 146 + person_seed * 7 % 70)
        draw.rectangle((0, 0, 360, 360), fill=(230, 233, 239))
        draw.ellipse((-80, -80, 180, 180), fill=(237, 209, 219))
        draw.ellipse((205, 225, 430, 430), fill=(203, 225, 232))
        face_box = (112, 72, 248, 254)
        if variant == "side_profile":
            face_box = (124, 76, 270, 254)
        if variant == "cross_age":
            face_box = (108, 66, 252, 262)
        draw.ellipse(face_box, fill=(209, 172, 142), outline=(91, 68, 83), width=3)
        hair_offset = 8 if person_seed % 2 else -4
        draw.pieslice((93 + hair_offset, 46, 263 + hair_offset, 168), 180, 360, fill=(42, 43, 55))
        draw.arc((116, 96, 244, 266), 18, 162, fill=(95, 63, 80), width=4)
        if variant == "side_profile":
            draw.ellipse((166, 139, 179, 152), fill=(35, 37, 45))
            draw.line((214, 145, 245, 166, 213, 178), fill=(86, 58, 55), width=4)
        else:
            eye_shift = 4 if person_seed % 2 else 0
            draw.ellipse((139 + eye_shift, 136, 153 + eye_shift, 150), fill=(34, 36, 43))
            draw.ellipse((204 - eye_shift, 136, 218 - eye_shift, 150), fill=(34, 36, 43))
            draw.line((180, 151, 174, 177, 188, 177), fill=(105, 74, 66), width=4)
        draw.arc((154, 192, 210, 220), 12, 168, fill=(115, 58, 74), width=5)
        draw.rounded_rectangle((132, 252, 228, 334), radius=28, fill=accent)
        draw.rectangle((0, 318, 360, 360), fill=(38, 44, 54))
        if variant == "cross_age":
            draw.arc((137, 124, 169, 160), 215, 320, fill=(130, 96, 90), width=2)
            draw.arc((194, 124, 226, 160), 220, 325, fill=(130, 96, 90), width=2)
            draw.line((148, 114, 162, 108), fill=(238, 238, 238), width=2)
            draw.line((200, 108, 214, 114), fill=(238, 238, 238), width=2)
        elif variant == "low_light":
            image = ImageEnhance.Brightness(image).enhance(0.34)
            image = ImageEnhance.Contrast(image).enhance(0.78)
        elif variant == "video_frame":
            draw.rectangle((12, 12, 348, 348), outline=(246, 248, 250), width=2)
            draw.text((24, 24), "00:02:12", fill=(246, 248, 250))
            image = ImageEnhance.Sharpness(image).enhance(0.55)
        elif variant == "occlusion":
            draw.rounded_rectangle((120, 170, 240, 221), radius=16, fill=(34, 42, 51))
            draw.line((126, 177, 236, 214), fill=(112, 124, 142), width=3)
        elif variant == "family_lookalike":
            draw.line((138, 126, 160, 120), fill=(38, 38, 48), width=5)
            draw.line((200, 120, 222, 126), fill=(38, 38, 48), width=5)
            draw.arc((148, 190, 214, 224), 0, 155, fill=(120, 50, 62), width=5)
        temp = path.with_suffix(path.suffix + ".tmp")
        image.save(temp, format="JPEG", quality=92, optimize=True)
        temp.replace(path)

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
        db_integrity = self.database_integrity()
        recommendations: list[str] = []
        if not db_integrity.get("ok"):
            recommendations.append("The local SQLite index needs repair before large scans continue.")
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
            "databaseIntegrity": db_integrity,
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
        # H2: generate a downscaled preview for ALL image formats (not just the
        # non-browser-renderable ones). Previously jpg/png/webp fell through to
        # here returning None, so the renderer used the full-resolution original
        # as the list thumbnail. Any image we can load gets a small cached preview.
        if not source.exists() or not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
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
            f"{source.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|preview-v3".encode("utf-8")
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

    @staticmethod
    def _face_crop_admittable(
        model_score: float | None,
        safe_mode_threshold: float,
        image_width: int,
        image_height: int,
        bboxes: list[Any],
        zero_admittance: bool,
    ) -> bool:
        # Decide whether a Safe-Mode-flagged image may still enter matching because it is a
        # benign, centered, single-face portrait. With zero-admittance on (e.g. the CSAM
        # vertical) this carve-out is fully disabled: no borderline-sensitive media is admitted.
        if zero_admittance:
            return False
        if model_score is None:
            return False
        if model_score >= max(0.32, safe_mode_threshold * 0.55):
            return False
        if image_width < 64 or image_height < 64:
            return False
        aspect = image_width / max(1, image_height)
        if aspect < 0.55 or aspect > 1.75:
            return False
        for bbox in bboxes:
            if not bbox:
                continue
            x1, y1, x2, y2 = bbox
            width = max(0, min(image_width, x2) - max(0, x1))
            height = max(0, min(image_height, y2) - max(0, y1))
            if not width or not height:
                continue
            coverage = (width * height) / max(1, image_width * image_height)
            center_x = (max(0, x1) + min(image_width, x2)) / 2 / image_width
            center_y = (max(0, y1) + min(image_height, y2)) / 2 / image_height
            if coverage >= 0.12 and 0.18 <= center_x <= 0.82 and 0.12 <= center_y <= 0.72:
                return True
        return False

    @staticmethod
    def _media_mtime_date(path: Path) -> str | None:
        try:
            return datetime.fromtimestamp(os.path.getmtime(path)).date().isoformat()
        except OSError:
            return None

    def _safe_capture_date(self, path: Path, image: Any | None = None, sha256: str = "") -> str | None:
        # Source-media capture date: EXIF DateTimeOriginal when present, else file mtime.
        try:
            return image_record_for_path(path, image=image, sha256=sha256).capture_date
        except Exception:
            return self._media_mtime_date(path)

    def _reference_capture_date(self, ref_id: str | None) -> str | None:
        if not ref_id:
            return None
        ref = self.references.get(ref_id)
        return ref.capture_date if ref else None

    @staticmethod
    def _audit_canonical(payload: dict[str, Any]) -> str:
        # Deterministic serialization for hashing; the hash field is never part of its own digest.
        return json.dumps(
            {key: value for key, value in payload.items() if key != "hash"},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    def _audit_tail_tip(self) -> tuple[int, str]:
        # Return (last_seq, last_hash) for the most recent chained entry, read from disk so the
        # chain stays sound even when a second process (e.g. the MCP server) appended last.
        # Callers must already hold self._state_lock(). Reads only the file tail for speed.
        if not self.audit_path.exists():
            return (0, "")
        try:
            size = self.audit_path.stat().st_size
            with self.audit_path.open("rb") as handle:
                window = 65536
                if size > window:
                    handle.seek(size - window)
                    handle.readline()  # discard the partial first line
                chunk = handle.read()
        except OSError:
            return (0, "")
        tip = (0, "")
        for raw in chunk.split(b"\n"):
            stripped = raw.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if isinstance(value, dict) and isinstance(value.get("hash"), str) and value.get("hash"):
                tip = (int(value.get("seq", 0) or 0), value["hash"])
        return tip

    def _append_audit(self, row: dict[str, object]) -> None:
        with self._state_lock():
            last_seq, last_hash = self._audit_tail_tip()
            audit_row: dict[str, Any] = {
                "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                **row,
            }
            # Chain fields are authoritative and cannot be overridden by the caller-supplied row.
            audit_row["seq"] = last_seq + 1
            audit_row["prevHash"] = last_hash
            audit_row["hash"] = hashlib.sha256(
                self._audit_canonical(audit_row).encode("utf-8")
            ).hexdigest()
            with self.audit_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(audit_row) + "\n")

    def verify_audit_chain(self) -> dict[str, Any]:
        # Re-read the audit log and verify the SHA-256 hash chain. Entries that predate chaining
        # (no "hash" field) are tolerated as legacy and counted, not treated as breaks.
        result: dict[str, Any] = {
            "verified": True,
            "length": 0,
            "chained": 0,
            "legacy": 0,
            "head": "",
            "tail": "",
            "firstBreak": None,
        }
        if not self.audit_path.exists():
            return result
        prev_hash = ""
        index = 0
        try:
            with self.audit_path.open("r", encoding="utf-8") as handle:
                for raw in handle:
                    stripped = raw.strip()
                    if not stripped:
                        continue
                    index += 1
                    try:
                        value = json.loads(stripped)
                    except json.JSONDecodeError:
                        if result["firstBreak"] is None:
                            result["firstBreak"] = {"index": index, "reason": "unparseable-line"}
                        continue
                    if not isinstance(value, dict):
                        continue
                    stored_hash = value.get("hash")
                    if not isinstance(stored_hash, str) or not stored_hash:
                        result["legacy"] += 1
                        continue
                    result["chained"] += 1
                    recomputed = hashlib.sha256(
                        self._audit_canonical(value).encode("utf-8")
                    ).hexdigest()
                    stored_prev = value.get("prevHash", "")
                    if result["firstBreak"] is None:
                        if recomputed != stored_hash:
                            result["firstBreak"] = {
                                "index": index,
                                "reason": "hash-mismatch",
                                "seq": value.get("seq"),
                            }
                        elif stored_prev != prev_hash:
                            result["firstBreak"] = {
                                "index": index,
                                "reason": "prev-hash-mismatch",
                                "seq": value.get("seq"),
                            }
                    if not result["head"]:
                        result["head"] = stored_hash
                    result["tail"] = stored_hash
                    prev_hash = stored_hash
        except OSError as exc:
            result["firstBreak"] = {"index": index, "reason": f"read-error:{exc.__class__.__name__}"}
        result["length"] = index
        result["verified"] = result["firstBreak"] is None
        return result

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
        # ER-02/MA-6: route through the shared atomic-write-with-fsync mechanism
        # while keeping the compact on-disk format.
        atomic_write_text(path, json.dumps(value, separators=(",", ":")))

    def _write_json_array_atomic(self, path: Path, rows: Iterable[object]) -> None:
        # Streams the array so a large candidate list never materializes as one
        # string; the shared mechanism adds durability (fsync) + atomic replace.
        def _stream(handle) -> None:
            handle.write("[")
            first = True
            for row in rows:
                if first:
                    first = False
                else:
                    handle.write(",")
                handle.write(json.dumps(row, separators=(",", ":")))
            handle.write("]")

        atomic_write(path, _stream)

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

