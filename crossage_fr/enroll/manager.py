from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Iterable
from contextlib import contextmanager
import base64
import binascii
import csv
import hashlib
import html
import json
import math
import os
import re
import shutil
import tempfile
import threading
import time
import zipfile
from typing import Callable, Any
from urllib.parse import urlsplit

from crossage_fr.compliance import (
    AI_DISCLOSURE_NOTICE,
    AI_DISCLOSURE_VERSION,
    CONSENT_SCHEMA_VERSION,
    build_release_record,
    build_retention_policy,
    jurisdiction_preset,
    parse_iso,
    release_is_complete,
    release_is_expired,
)
from crossage_fr.agent_telemetry import TRACE_FILENAME
from crossage_fr.config import ConfigReadError, RuntimeConfig, Thresholds, archive_corrupt_file, load_config, save_config
from crossage_fr.cluster import GlobalUnmatchedSpool
from crossage_fr.crypto import DecryptionError, backup_passphrase, decrypt_file, encrypt_file, is_encrypted
from crossage_fr.embed import EmbeddingEngine
from crossage_fr.enroll.synthetic_screen import (
    MODEL_ID as SYNTHETIC_SCREEN_MODEL_ID,
    MODEL_VERSION as SYNTHETIC_SCREEN_MODEL_VERSION,
    SyntheticScreenResult,
    screen_enrollment_face,
    synthetic_enrollment_screen_report,
)
from crossage_fr.ingest import ImageLoadError, VideoLoadError, image_record_for_path, iter_image_paths, load_image, sample_video_frames
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, RAW_IMAGE_EXTENSIONS, sha256_file, write_preview_image
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, configure_video_decoder_paths
from crossage_fr.ingest.safety import SafetyAssessment, apply_safe_mode_override, assess_image_safety, safety_model_report
from crossage_fr.match import (
    accuracy_at_threshold,
    accuracy_from_label_rows,
    apply_cohort_separation,
    apply_verified_age_gap_review,
    band_for_score,
    group_hits,
    pose_review_supported,
    thresholds_for_pose,
    valid_candidate,
    valid_reference,
)
from crossage_fr.match import adapters as match_adapters
from crossage_fr.match.age_gap import compute_age_gap, confidence_for_gap
from crossage_fr.match.age_trajectory import (
    AGE_BUCKET_CENTERS,
    AGE_BUCKET_ORDER,
    AGE_TRAJECTORY_METHOD_VERSION,
    AGE_TRAJECTORY_REFERENCE_KIND,
    IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
    build_age_trajectory_candidates,
    is_generated_age_image_reference,
    is_synthetic_age_reference,
    normalize_age_bucket,
)
from crossage_fr.match.review_order import review_lane, review_priority
from crossage_fr.match.calibration import (
    AdaptiveLinearCalibrator,
    CohortNormalizer,
    PlattCalibrator,
    fit_adaptive_linear,
    fit_per_identity_calibrators,
    fit_score_calibrator,
    normalized_pair_center,
    threshold_for_fmr,
    validate_adaptive_calibration,
)
from crossage_fr.match.cohort import CohortIntegrityError, load_fixed_cohort, model_pack_for_name
from crossage_fr.match.pooling import pool_template, template_cosine
from crossage_fr.match.video_tracks import (
    VIDEO_TRACK_TEMPLATE_VERSION,
    VideoFaceObservation,
    build_video_track_templates,
    face_crop_sharpness,
)
from crossage_fr.match.validation import held_out_gate
from crossage_fr.benchmark_quality import BENCHMARK_DISCLAIMER
from crossage_fr.benchmarks.det_eval import det_report, det_report_by_cohort
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate, new_id, normalize_risk_flags
from crossage_fr.photo_generative import (
    AGE_PROGRESS_PROMPT_VERSION,
    CATALOG_SHA256 as PHOTO_GENERATIVE_CATALOG_SHA256,
    CATALOG_VERSION as PHOTO_GENERATIVE_CATALOG_VERSION,
    QWEN_IMAGE_EDIT_MODEL_ID,
    QWEN_IMAGE_EDIT_REVISION,
    STABLE_DIFFUSION_CPP_REVISION,
    STABLE_DIFFUSION_CPP_RUNTIME_ID,
    STABLE_DIFFUSION_CPP_TAG,
    age_progress_prompt_sha256,
)
from crossage_fr.storage import safe_is_mount, safe_resolve
from crossage_fr.store import VectorStore
from crossage_fr.store.workspace_db import WorkspaceDb, path_signature, sqlite3
from crossage_fr.store.workspace_encryption import WorkspaceEncryption, WorkspaceEncryptionError, secure_remove_file
from crossage_fr.workspace_registry import atomic_write, atomic_write_text, ensure_workspace_metadata, now_iso, restrict_file_mode, write_active_workspace
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
    # Deterministic UI-state testing only. The zero default has no production
    # cost; the hard cap prevents accidental environment misuse from hanging a scan.
    SCAN_TEST_ITEM_DELAY_SECONDS = min(0.25, max(0.0, float(os.environ.get("CROSSAGE_TEST_SCAN_ITEM_DELAY_MS", "0")) / 1000.0))
except ValueError:
    SCAN_TEST_ITEM_DELAY_SECONDS = 0.0

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
    SCAN_PROGRESS_THROTTLE_SECONDS = max(0.05, float(os.environ.get("CROSSAGE_SCAN_PROGRESS_THROTTLE_SECONDS", "0.10")))
except ValueError:
    SCAN_PROGRESS_THROTTLE_SECONDS = 0.10

try:
    SCAN_PROGRESS_THROTTLE_FILES = max(1, int(os.environ.get("CROSSAGE_SCAN_PROGRESS_THROTTLE_FILES", "25")))
except ValueError:
    SCAN_PROGRESS_THROTTLE_FILES = 25

try:
    CANDIDATE_JSON_SNAPSHOT_LIMIT = max(0, int(os.environ.get("CROSSAGE_CANDIDATE_JSON_SNAPSHOT_LIMIT", "50000")))
except ValueError:
    CANDIDATE_JSON_SNAPSHOT_LIMIT = 50_000

try:
    CANDIDATE_BOOT_HYDRATE_LIMIT = max(0, int(os.environ.get("CROSSAGE_CANDIDATE_BOOT_HYDRATE_LIMIT", "0")))
except ValueError:
    CANDIDATE_BOOT_HYDRATE_LIMIT = 0

try:
    CANDIDATE_MEMORY_DEDUPE_LIMIT = max(1000, int(os.environ.get("CROSSAGE_CANDIDATE_MEMORY_DEDUPE_LIMIT", "100000")))
except ValueError:
    CANDIDATE_MEMORY_DEDUPE_LIMIT = 100_000

AUDIT_ENCRYPTED_PREFIX = b"VINTRACE-AUDIT-AESGCM1:"
AUDIT_ENCRYPTION_ROLE = "audit-event-v1"
SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE = "synthetic_age_image_review"
SYNTHETIC_AGE_IDENTITY_MINIMUM = 0.20
SYNTHETIC_AGE_PARENT_MINIMUM = 0.20
SYNTHETIC_AGE_IMPOSTOR_MARGIN_MINIMUM = 0.08
SYNTHETIC_AGE_MINIMUM_QUALITY = 0.35
SYNTHETIC_AGE_MAX_TARGETS_PER_RUN = 3

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
    if metadata.get("video_track_id"):
        start = _format_ms(metadata.get("video_track_start_ms"))
        end = _format_ms(metadata.get("video_track_end_ms"))
        frames = max(1, int(metadata.get("video_track_frame_count", 0) or 0))
        keyframes = max(1, len(metadata.get("video_track_keyframe_indices", []) or []))
        return f"Video face track {start} to {end}; pooled {keyframes} quality keyframe(s) from {frames} sampled face observation(s)."
    timestamp = _format_ms(metadata.get("video_timestamp_ms"))
    duration = _format_ms(metadata.get("video_duration_ms"))
    return f"Video moment at {timestamp}" + (f" of {duration}." if duration != "00:00" else ".")


class ProjectState:
    def __init__(self, root: Path, actor: str = "backend"):
        self.actor = actor
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
        self.content_credentials_identity_path = self.root / "content-credentials" / "signing-identity.json"
        self.cancel_scan_path = self.root / ".scan-cancel"
        self.pause_scan_path = self.root / ".scan-pause"
        self.media_action_cancel_path = self.root / ".media-action-cancel"
        self.vector_index_path = self.root / "reference-vectors.npz"
        self.previews_path = self.root / "previews"
        self.video_frames_path = self.root / "video-frames"
        self.synthetic_age_images_path = self.root / "synthetic-age-images"
        self.validation_packs_path = self.root / "validation-packs"
        self.workspace_encryption = WorkspaceEncryption.from_environment(self.root)
        self.db = WorkspaceDb(self.root / "workspace.sqlite3", encryption=self.workspace_encryption)
        self.workspace_metadata = ensure_workspace_metadata(self.root, actor=actor)
        write_active_workspace(self.root, actor=actor, metadata=self.workspace_metadata)
        self.config = load_config(self.config_path)
        self._config_signature = self._config_disk_signature()
        self.apply_video_decoder_config()
        self.consent: dict[str, Any] = {}
        self.references: dict[str, ReferenceFace] = {}
        self.candidates: dict[str, ReviewCandidate] = {}
        self.scan_history: list[dict[str, Any]] = []
        self.vector_store = VectorStore()
        self._reference_index_version = 0
        self._model_vector_store_cache: dict[str, tuple[int, VectorStore, dict[str, ReferenceFace]]] = {}
        self._person_template_cache: tuple[tuple[int, str], dict[str, list[float]]] | None = None
        self._fixed_cohort_cache: dict[str, tuple[CohortNormalizer | None, str]] = {}
        self._excluded_file_paths_cache_key: tuple[str, ...] = ()
        self._excluded_file_paths_cache: set[str] = set()
        self._exclusion_cache_key: tuple[Any, ...] = ()
        self._excluded_dir_names_cache: set[str] = set()
        self._excluded_extensions_cache: set[str] = set()
        self._excluded_keywords_cache: tuple[tuple[str, str], ...] = ()
        self._loaded_config_payload: dict[str, Any] = {}
        self._loaded_consent: dict[str, Any] = {}
        self._loaded_reference_ids: set[str] = set()
        self._loaded_reference_payloads: dict[str, dict[str, Any]] = {}
        self._reference_dirty_ids: set[str] = set()
        self._reference_deleted_ids: set[str] = set()
        self._loaded_candidate_ids: set[str] = set()
        self._loaded_candidate_payloads: dict[str, dict[str, Any]] = {}
        self._candidate_dirty_ids: set[str] = set()
        self._candidate_deleted_ids: set[str] = set()
        self._candidate_index_backed = False
        self._last_scan_progress_emit_at: dict[str, float] = {}
        self._last_scan_progress_processed: dict[str, int] = {}
        self.load()
        self._ensure_generated_dir_sentinel(self.previews_path)
        self._ensure_generated_dir_sentinel(self.video_frames_path)
        self._ensure_generated_dir_sentinel(self.synthetic_age_images_path)
        self._synthetic_age_startup_result = self._reconcile_synthetic_age_image_storage()
        self._retention_startup_result = self.enforce_retention_policy(source="startup")

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
        self._candidate_index_backed = False
        self._loaded_config_payload = asdict(self.config)
        self.consent = self._read_json_object(self.consent_path)
        self._loaded_consent = dict(self.consent)
        if self.refs_path.exists():
            for row in self._read_json_array(self.refs_path):
                try:
                    ref = ReferenceFace(**row)
                except TypeError:
                    continue
                if not valid_reference(ref):
                    continue
                self.references[ref.ref_id] = ref
        try:
            indexed_candidates = self.db.candidate_count()
        except sqlite3.Error:
            indexed_candidates = 0
        if indexed_candidates > CANDIDATE_BOOT_HYDRATE_LIMIT:
            self._candidate_index_backed = True
        if self.candidates_path.exists():
            if not self._candidate_index_backed:
                for row in self._read_json_array(self.candidates_path):
                    try:
                        candidate = ReviewCandidate(**row)
                    except TypeError:
                        continue
                    if not valid_candidate(candidate):
                        continue
                    self.candidates[candidate.candidate_id] = candidate
        if indexed_candidates > len(self.candidates):
            if indexed_candidates <= CANDIDATE_BOOT_HYDRATE_LIMIT:
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
            else:
                self.candidates.clear()
                self._candidate_index_backed = True
        if self.scan_history_path.exists():
            self.scan_history.extend(self._read_json_array(self.scan_history_path)[:80])
        ref_vectors = {ref_id: ref.vector for ref_id, ref in self.references.items()}
        if self.workspace_encryption.enabled:
            self.vector_store.rebuild(ref_vectors)
            self._remove_plaintext_reference_vector_store()
        elif not self.vector_store.load(self.vector_index_path, expected_ids=set(ref_vectors)):
            self.vector_store.rebuild(ref_vectors)
            if ref_vectors:
                self.vector_store.save(self.vector_index_path)
        self._migrate_sensitive_state_files()
        self._migrate_audit_log_encryption()
        self._loaded_reference_ids = set(self.references.keys())
        self._loaded_reference_payloads = {ref_id: asdict(ref) for ref_id, ref in self.references.items()}
        self._reference_dirty_ids.clear()
        self._reference_deleted_ids.clear()
        self._loaded_candidate_ids = set(self.candidates.keys())
        self._loaded_candidate_payloads = {candidate_id: asdict(candidate) for candidate_id, candidate in self.candidates.items()}
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        if not self._candidate_index_backed:
            self._ensure_candidate_index()
        self._invalidate_reference_indexes()

    def _invalidate_reference_indexes(self) -> None:
        self._reference_index_version += 1
        self._model_vector_store_cache.clear()
        self._person_template_cache = None

    def _config_from_payload(self, payload: dict[str, Any], fallback: RuntimeConfig | None = None) -> RuntimeConfig:
        try:
            raw_thresholds = payload.get("thresholds", {}) if isinstance(payload.get("thresholds", {}), dict) else {}
            body = {key: value for key, value in payload.items() if key != "thresholds"}
            return RuntimeConfig(**body, thresholds=Thresholds(**raw_thresholds))
        except (TypeError, ValueError):
            return fallback or self.config

    def _three_way_dict_merge(
        self,
        baseline: dict[str, Any],
        disk: dict[str, Any],
        local: dict[str, Any],
    ) -> dict[str, Any]:
        merged = dict(local)
        for key, disk_value in disk.items():
            baseline_has = key in baseline
            local_has = key in local
            baseline_value = baseline.get(key)
            local_value = local.get(key)
            if isinstance(baseline_value, dict) and isinstance(disk_value, dict) and isinstance(local_value, dict):
                merged[key] = self._three_way_dict_merge(baseline_value, disk_value, local_value)
            elif (local_has and local_value == baseline_value) or (not local_has and not baseline_has):
                merged[key] = disk_value
        return merged

    def _merged_config_for_save(self) -> RuntimeConfig:
        local_payload = asdict(self.config)
        disk_payload = asdict(load_config(self.config_path, strict_read=True)) if self.config_path.exists() else {}
        merged_payload = self._three_way_dict_merge(self._loaded_config_payload, disk_payload, local_payload)
        return self._config_from_payload(merged_payload, self.config)

    def _merged_consent_for_save(self) -> dict[str, Any]:
        disk_consent = self._read_json_object(self.consent_path)
        return self._three_way_dict_merge(self._loaded_consent, disk_consent, self.consent)

    def _reference_rows_from_disk(self) -> dict[str, ReferenceFace]:
        rows: dict[str, ReferenceFace] = {}
        if not self.refs_path.exists():
            return rows
        for row in self._read_json_array(self.refs_path):
            try:
                ref = ReferenceFace(**row)
            except TypeError:
                continue
            if valid_reference(ref):
                rows[ref.ref_id] = ref
        return rows

    def _merged_references_for_save(
        self,
        *,
        dirty_ids: set[str],
        deleted_ids: set[str],
    ) -> dict[str, ReferenceFace]:
        merged = self._reference_rows_from_disk()
        for ref_id in self._loaded_reference_ids | deleted_ids:
            if ref_id in self.references and ref_id not in deleted_ids:
                continue
            disk_ref = merged.get(ref_id)
            disk_payload = asdict(disk_ref) if disk_ref is not None else None
            if ref_id in deleted_ids or disk_payload == self._loaded_reference_payloads.get(ref_id):
                merged.pop(ref_id, None)
        for ref_id, ref in self.references.items():
            if ref_id in deleted_ids:
                continue
            payload = asdict(ref)
            if (
                ref_id in dirty_ids
                or ref_id not in self._loaded_reference_ids
                or payload != self._loaded_reference_payloads.get(ref_id)
            ):
                merged[ref_id] = ref
        return merged

    def _candidate_rows_from_disk(self) -> dict[str, ReviewCandidate]:
        rows: dict[str, ReviewCandidate] = {}
        if not self.candidates_path.exists():
            return rows
        for row in self._read_json_array(self.candidates_path):
            try:
                candidate = ReviewCandidate(**row)
            except TypeError:
                continue
            if valid_candidate(candidate):
                rows[candidate.candidate_id] = candidate
        return rows

    def _merged_candidates_for_snapshot(
        self,
        *,
        dirty_ids: set[str],
        deleted_ids: set[str],
    ) -> dict[str, ReviewCandidate]:
        merged = self._candidate_rows_from_disk()
        for candidate_id in self._loaded_candidate_ids | deleted_ids:
            if candidate_id in self.candidates and candidate_id not in deleted_ids:
                continue
            disk_candidate = merged.get(candidate_id)
            disk_payload = asdict(disk_candidate) if disk_candidate is not None else None
            if candidate_id in deleted_ids or disk_payload == self._loaded_candidate_payloads.get(candidate_id):
                merged.pop(candidate_id, None)
        for candidate_id, candidate in self.candidates.items():
            if candidate_id in deleted_ids:
                continue
            payload = asdict(candidate)
            if (
                candidate_id in dirty_ids
                or candidate_id not in self._loaded_candidate_ids
                or payload != self._loaded_candidate_payloads.get(candidate_id)
            ):
                merged[candidate_id] = candidate
        return merged

    def _merged_scan_history_for_save(self) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in [*self.scan_history, *self._read_json_array(self.scan_history_path)]:
            if not isinstance(row, dict):
                continue
            key = str(row.get("runId", "") or "") or json.dumps(row, sort_keys=True, default=str)
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)
            if len(merged) >= 80:
                break
        return merged

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
        if (
            len(references) == len(self.references)
            and set(references) == set(self.vector_store.ids)
        ):
            store = self.vector_store
        else:
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
            if not is_synthetic_age_reference(ref)
            if not self._compatible_reference_model_name(active, ref.model_name)
            and self._reference_active_key(ref, active) not in active_keys
        ]

    def _search_matching_references(self, embedding: EmbeddingResult, k: int = 20) -> tuple[list[Any], dict[str, ReferenceFace]]:
        store, references = self._reference_search_context(embedding.model_name)
        if not references:
            return [], references
        return store.search(embedding.vector, k=k), references

    def _fixed_cohort_normalizer(self, model_name: str) -> tuple[CohortNormalizer | None, str]:
        model_pack = model_pack_for_name(model_name)
        if not model_pack:
            return None, ""
        cached = self._fixed_cohort_cache.get(model_pack)
        if cached is not None:
            return cached
        try:
            fixed = load_fixed_cohort(model_name)
            result = (CohortNormalizer(fixed.vectors), f"{fixed.model_pack}:{fixed.version}")
        except (CohortIntegrityError, OSError, ValueError):
            result = (None, "")
        self._fixed_cohort_cache[model_pack] = result
        return result

    def _pair_calibration_context(self, embedding: EmbeddingResult, decision: Any) -> dict[str, Any]:
        reference_id = str(getattr(decision, "best_ref_id", "") or "")
        reference = self.references.get(reference_id)
        if reference is None or not self._compatible_reference_model_name(embedding.model_name, reference.model_name):
            return {}
        center = normalized_pair_center(embedding.vector, reference.vector)
        if center is None or center.size != 512:
            return {}
        normalizer, cohort_version = self._fixed_cohort_normalizer(embedding.model_name)
        raw_cosine = getattr(decision, "raw_cosine", None)
        cohort_z: float | None = None
        if normalizer is not None and raw_cosine is not None:
            cohort_z = normalizer.normalize_pair(
                embedding.vector,
                reference.vector,
                float(raw_cosine),
            )
        return {
            "bestRefId": reference_id,
            "modelName": embedding.model_name,
            "pairCenter": [float(value) for value in center],
            "cohortZ": cohort_z,
            "cohortVersion": cohort_version,
            "contextVersion": f"adaptive-pair-v1|{cohort_version or 'cohort-unavailable'}",
        }

    def save(self, snapshot_candidates: bool = True, flush_candidate_index: bool = True) -> None:
        dirty_reference_ids = set(self._reference_dirty_ids)
        deleted_reference_ids = set(self._reference_deleted_ids)
        dirty_candidate_ids = set(self._candidate_dirty_ids)
        deleted_candidate_ids = set(self._candidate_deleted_ids)
        with self._state_lock():
            self.root.mkdir(parents=True, exist_ok=True)
            try:
                config_for_save = self._merged_config_for_save()
            except ConfigReadError:
                config_for_save = None
            if config_for_save is not None:
                self.config = config_for_save
                save_config(self.config, self.config_path)
                self._loaded_config_payload = asdict(self.config)
            self.consent = self._merged_consent_for_save()
            self._write_json_atomic(self.consent_path, self.consent)
            self._loaded_consent = dict(self.consent)
            self.references = self._merged_references_for_save(
                dirty_ids=dirty_reference_ids,
                deleted_ids=deleted_reference_ids,
            )
            refs = [asdict(ref) for ref in self.references.values()]
            self._write_json_atomic(self.refs_path, refs)
            self.vector_store.rebuild({ref_id: ref.vector for ref_id, ref in self.references.items()})
            if self.workspace_encryption.enabled:
                self._remove_plaintext_reference_vector_store()
            else:
                self.vector_store.save(self.vector_index_path)
            self._loaded_reference_ids = set(self.references.keys())
            self._loaded_reference_payloads = {ref_id: asdict(ref) for ref_id, ref in self.references.items()}
            self._reference_dirty_ids.clear()
            self._reference_deleted_ids.clear()
            self._invalidate_reference_indexes()
            if flush_candidate_index:
                self._flush_candidate_index()
            if snapshot_candidates and not self._candidate_index_backed and len(self.candidates) <= CANDIDATE_JSON_SNAPSHOT_LIMIT:
                self.candidates = self._merged_candidates_for_snapshot(
                    dirty_ids=dirty_candidate_ids,
                    deleted_ids=deleted_candidate_ids,
                )
                self._write_json_array_atomic(self.candidates_path, (asdict(candidate) for candidate in self.candidates.values()))
                self._loaded_candidate_ids = set(self.candidates.keys())
                self._loaded_candidate_payloads = {candidate_id: asdict(candidate) for candidate_id, candidate in self.candidates.items()}
            self.scan_history = self._merged_scan_history_for_save()
            self._write_json_atomic(self.scan_history_path, self.scan_history[:80])

    def _ensure_candidate_index(self) -> None:
        if self._candidate_index_backed and not self._candidate_dirty_ids and not self._candidate_deleted_ids:
            return
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
        if self._candidate_index_backed:
            return indexed >= len(self.candidates)
        return indexed == len(self.candidates)

    def _mark_reference_dirty(self, ref_id: str | None) -> None:
        if not ref_id:
            return
        self._reference_deleted_ids.discard(ref_id)
        self._reference_dirty_ids.add(ref_id)

    def _mark_references_dirty(self, ref_ids: Iterable[str]) -> None:
        for ref_id in ref_ids:
            self._mark_reference_dirty(ref_id)

    def _mark_reference_deleted(self, ref_id: str | None) -> None:
        if not ref_id:
            return
        self._reference_dirty_ids.discard(ref_id)
        self._reference_deleted_ids.add(ref_id)

    def _mark_references_deleted(self, ref_ids: Iterable[str]) -> None:
        for ref_id in ref_ids:
            self._mark_reference_deleted(ref_id)

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

    def _candidate_from_payload(self, payload: dict[str, Any] | None) -> ReviewCandidate | None:
        if not isinstance(payload, dict):
            return None
        try:
            candidate = ReviewCandidate(**payload)
        except TypeError:
            return None
        return candidate if valid_candidate(candidate) else None

    def _load_candidate_from_index(self, candidate_id: str) -> ReviewCandidate | None:
        clean_id = str(candidate_id or "").strip()
        if not clean_id:
            return None
        candidate = self.candidates.get(clean_id)
        if candidate is not None:
            return candidate
        try:
            payload = self.db.candidate_payload_by_id(clean_id)
        except sqlite3.Error:
            return None
        candidate = self._candidate_from_payload(payload)
        if candidate is None:
            return None
        self.candidates[candidate.candidate_id] = candidate
        self._loaded_candidate_ids.add(candidate.candidate_id)
        self._loaded_candidate_payloads[candidate.candidate_id] = asdict(candidate)
        return candidate

    def _candidate_or_raise(self, candidate_id: str) -> ReviewCandidate:
        candidate = self._load_candidate_from_index(candidate_id)
        if candidate is None:
            raise KeyError(f"Candidate not found: {candidate_id}")
        return candidate

    def candidate_by_id(self, candidate_id: str) -> ReviewCandidate | None:
        return self._load_candidate_from_index(candidate_id)

    def _ensure_candidates_loaded(self, candidate_ids: Iterable[str]) -> list[str]:
        unique_ids = list(dict.fromkeys(str(value or "").strip() for value in candidate_ids if str(value or "").strip()))
        loaded: list[str] = []
        if self._candidate_index_backed:
            missing_ids = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
            if missing_ids:
                try:
                    payloads = self.db.candidate_payloads_by_ids(missing_ids)
                except sqlite3.Error:
                    payloads = {}
                for candidate_id, payload in payloads.items():
                    candidate = self._candidate_from_payload(payload)
                    if candidate is None:
                        continue
                    self.candidates[candidate.candidate_id] = candidate
                    self._loaded_candidate_ids.add(candidate.candidate_id)
                    self._loaded_candidate_payloads[candidate.candidate_id] = asdict(candidate)
        for candidate_id in unique_ids:
            if self._load_candidate_from_index(candidate_id) is not None:
                loaded.append(candidate_id)
        return loaded

    def _iter_authoritative_candidates(
        self,
        *,
        statuses: Iterable[str] | None = None,
        person_name: str = "",
        order: str = "created",
    ) -> Iterable[ReviewCandidate]:
        if self._candidate_index_backed:
            self._flush_candidate_index()
            try:
                for payload in self.db.iter_candidate_payloads_filtered(statuses=statuses, person_name=person_name, order=order):
                    candidate = self._candidate_from_payload(payload)
                    if candidate is not None:
                        yield candidate
                return
            except sqlite3.Error:
                pass
        status_set = {str(status or "").strip() for status in (statuses or []) if str(status or "").strip()}
        person_key = str(person_name or "").strip().casefold()
        rows = list(self.candidates.values())
        if status_set:
            rows = [candidate for candidate in rows if candidate.status in status_set]
        if person_key:
            rows = [candidate for candidate in rows if candidate.person_name.casefold() == person_key]
        if order == "status":
            rows.sort(key=lambda item: (item.status, item.person_name.lower(), -item.score, item.candidate_id))
        elif order in {"review", "score"}:
            rows.sort(key=lambda item: (-float(item.score), -float(item.quality), item.created_at, item.candidate_id))
        else:
            rows.sort(key=lambda item: (item.created_at, item.candidate_id))
        yield from rows

    def _authoritative_candidate_ids(
        self,
        *,
        statuses: Iterable[str] | None = None,
        person_name: str = "",
        created_before: str = "",
    ) -> list[str]:
        if self._candidate_index_backed:
            self._flush_candidate_index()
            try:
                return self.db.candidate_ids_filtered(statuses=statuses, person_name=person_name, created_before=created_before)
            except sqlite3.Error:
                pass
        status_set = {str(status or "").strip() for status in (statuses or []) if str(status or "").strip()}
        person_key = str(person_name or "").strip().casefold()
        cutoff = str(created_before or "").strip()
        ids: list[str] = []
        for candidate in self.candidates.values():
            if status_set and candidate.status not in status_set:
                continue
            if person_key and candidate.person_name.casefold() != person_key:
                continue
            if cutoff and str(candidate.created_at or "") >= cutoff:
                continue
            ids.append(candidate.candidate_id)
        return ids

    def _forget_candidates(self, candidate_ids: Iterable[str]) -> None:
        for candidate_id in candidate_ids:
            self.candidates.pop(candidate_id, None)
            self._loaded_candidate_ids.discard(candidate_id)
            self._loaded_candidate_payloads.pop(candidate_id, None)
            self._candidate_dirty_ids.discard(candidate_id)

    def _flush_candidate_index(self) -> None:
        try:
            if self._candidate_deleted_ids:
                deleted_ids = set(self._candidate_deleted_ids)
                self.db.delete_candidates(deleted_ids)
                for candidate_id in deleted_ids:
                    self._loaded_candidate_ids.discard(candidate_id)
                    self._loaded_candidate_payloads.pop(candidate_id, None)
                self._candidate_deleted_ids.clear()
            if self._candidate_dirty_ids:
                rows = [
                    self.candidates[candidate_id]
                    for candidate_id in self._candidate_dirty_ids
                    if candidate_id in self.candidates
                ]
                self.db.upsert_candidates(rows)
                for candidate in rows:
                    self._loaded_candidate_ids.add(candidate.candidate_id)
                    self._loaded_candidate_payloads[candidate.candidate_id] = asdict(candidate)
                self._candidate_dirty_ids.clear()
            elif not self._candidate_index_backed and (
                self.db.candidate_count() != len(self.candidates)
                or set(self.candidates.keys()) != self._loaded_candidate_ids
                or any(
                    asdict(candidate) != self._loaded_candidate_payloads.get(candidate_id)
                    for candidate_id, candidate in self.candidates.items()
                )
            ):
                merged = self._merged_candidates_for_snapshot(dirty_ids=set(), deleted_ids=set())
                self.db.replace_candidates(merged.values())
                self.candidates = merged
        except sqlite3.Error:
            pass

    def consent_on_file(self) -> bool:
        if not bool(self.consent.get("active")):
            return False
        preset = jurisdiction_preset(self.config.jurisdiction_preset) or {}
        if preset.get("writtenReleaseRequired"):
            return bool(self.ai_disclosure_status()["acknowledged"])
        return True

    def _backup_workspace_key_id(self) -> str:
        try:
            return self.workspace_encryption.key_id
        except Exception:
            return ""

    def refresh_consent_from_disk(self) -> bool:
        """Refresh the cross-process consent gate without reloading the library."""
        consent = self._read_json_object(self.consent_path)
        self.consent = consent
        self._loaded_consent = dict(consent)
        return self.consent_on_file()

    def _config_disk_signature(self) -> tuple[int, int] | None:
        try:
            stat = self.config_path.stat()
        except OSError:
            return None
        return (stat.st_size, stat.st_mtime_ns)

    def refresh_config_from_disk(self) -> RuntimeConfig:
        """Re-read config.json when it changed on disk, without reloading the library.

        The desktop and the MCP/HTTP server that serves paired mobile devices are
        separate processes, and the MCP process caches this project for its lifetime.
        Safe Mode is read straight off ``self.config``, so without this an operator who
        ENABLES or TIGHTENS Safe Mode on the desktop would not affect the mobile preview
        path until the sidecar restarted — a fail-open staleness bug. Consent already
        had the same problem and the same remedy (``refresh_consent_from_disk``).

        Guarded on (size, mtime_ns) so it is a single ``stat`` on the hot path and only
        re-parses when the file actually changed.
        """
        signature = self._config_disk_signature()
        if signature is not None and signature == getattr(self, "_config_signature", None):
            return self.config
        self.config = load_config(self.config_path)
        self._config_signature = signature
        return self.config

    @staticmethod
    def _person_key(name: str) -> str:
        return str(name or "").strip().casefold()

    def subject_consents(self) -> dict[str, dict[str, Any]]:
        subjects = self.consent.get("subjects")
        return dict(subjects) if isinstance(subjects, dict) else {}

    def consent_for_person(self, person_name: str) -> bool:
        # Baseline is always the workspace-level gate. With per-subject consent enabled, the
        # named subject must also carry an active consent record. Additive: with the flag off
        # this is exactly the workspace gate, so existing flows are unchanged.
        if not self.consent_on_file():
            return False
        if not getattr(self.config, "per_subject_consent", False):
            return True
        record = self.subject_consents().get(self._person_key(person_name))
        if not record or not record.get("active") or release_is_expired(record):
            return False
        preset = jurisdiction_preset(self.config.jurisdiction_preset) or {}
        return release_is_complete(record, preset)

    def ai_disclosure_status(self) -> dict[str, Any]:
        acknowledgement = self.consent.get("aiDisclosure")
        if not isinstance(acknowledgement, dict):
            acknowledgement = {}
        return {
            "version": AI_DISCLOSURE_VERSION,
            "acknowledged": bool(
                acknowledgement.get("acknowledged")
                and acknowledgement.get("version") == AI_DISCLOSURE_VERSION
            ),
            "acknowledgedAt": acknowledgement.get("acknowledgedAt"),
            "operator": str(acknowledgement.get("operator", "")),
            "notice": AI_DISCLOSURE_NOTICE,
        }

    def biometric_retention_policy(self) -> dict[str, Any]:
        preset = dict(jurisdiction_preset(self.config.jurisdiction_preset) or jurisdiction_preset("standard") or {})
        preset["retentionReviewedDays"] = int(self.config.retention_reviewed_days)
        preset["retentionPendingDays"] = int(self.config.retention_pending_days)
        preset["auditRetentionDays"] = int(self.config.retention_audit_days)
        policy = build_retention_policy(
            preset,
            enforcement_enabled=bool(self.config.retention_enforcement_enabled),
        )
        publication = self.consent.get("policyPublication")
        if not isinstance(publication, dict):
            publication = {}
        current = bool(
            publication.get("policyVersion") == policy["policyVersion"]
            and publication.get("policyHash") == policy["policyHash"]
            and publication.get("publicUrl")
            and publication.get("publishedAt")
        )
        return {
            **policy,
            "status": "publication-recorded" if current else "operator-policy-template",
            "publication": {
                "required": bool(policy.get("publicPolicyRequired")),
                "recorded": bool(publication),
                "current": current,
                "publicUrl": str(publication.get("publicUrl", "")) if current else "",
                "approvedBy": str(publication.get("approvedBy", "")) if current else "",
                "publishedAt": publication.get("publishedAt") if current else None,
                "recordedAt": publication.get("recordedAt") if current else None,
            },
        }

    def compliance_status(self) -> dict[str, Any]:
        subjects = self.subject_consents()
        preset = jurisdiction_preset(self.config.jurisdiction_preset) or {}
        active = 0
        complete = 0
        expired = 0
        complete_subject_keys: set[str] = set()
        subject_rows: list[dict[str, Any]] = []
        for record in subjects.values():
            if not isinstance(record, dict) or not record.get("active"):
                continue
            active += 1
            is_expired = release_is_expired(record)
            is_complete = not is_expired and release_is_complete(record, preset)
            if is_expired:
                expired += 1
            elif is_complete:
                complete += 1
                complete_subject_keys.add(self._person_key(str(record.get("personName", ""))))
            subject_rows.append(
                {
                    "personName": str(record.get("personName", "")),
                    "releaseId": str(record.get("releaseId", "")),
                    "recordHash": str(record.get("recordHash", "")),
                    "active": True,
                    "complete": is_complete,
                    "expired": is_expired,
                    "signerName": str(record.get("signerName", "")),
                    "signerRole": str(record.get("signerRole", "")),
                    "specificPurpose": str(record.get("specificPurpose", "")),
                    "collectionTermDays": int(record.get("collectionTermDays", 0) or 0),
                    "lawfulBasis": str(record.get("lawfulBasis", "")),
                    "confirmedAt": record.get("confirmedAt"),
                    "expiresAt": record.get("expiresAt"),
                }
            )
        subject_rows.sort(key=lambda row: str(row.get("personName", "")).casefold())
        private_subjects: dict[str, str] = {
            self._person_key(ref.person_name): ref.person_name.strip()
            for ref in self.references.values()
            if ref.person_name.strip()
        }
        try:
            for person_name in self.db.subject_private_person_names():
                private_subjects.setdefault(self._person_key(person_name), person_name)
        except sqlite3.Error:
            pass
        missing_release_names = sorted(
            (
                display_name
                for person_key, display_name in private_subjects.items()
                if person_key not in complete_subject_keys
            ),
            key=str.casefold,
        )
        retention_policy = self.biometric_retention_policy()
        publication = retention_policy.get("publication") if isinstance(retention_policy.get("publication"), dict) else {}
        publication_ready = bool(
            not retention_policy.get("publicPolicyRequired") or publication.get("current")
        )
        return {
            "jurisdiction": preset,
            "aiDisclosure": self.ai_disclosure_status(),
            "retentionPolicy": retention_policy,
            "subjects": {
                "total": len(subjects),
                "active": active,
                "complete": complete,
                "expired": expired,
                "records": subject_rows,
                "biometric": len(private_subjects),
                "covered": len(private_subjects) - len(missing_release_names),
                "missing": len(missing_release_names),
                "missingNames": missing_release_names,
            },
            "processingAllowed": self.consent_on_file(),
            "evidenceReady": bool(
                self.ai_disclosure_status()["acknowledged"]
                and publication_ready
                and (
                    not preset.get("perSubjectConsent")
                    or (active == complete and not missing_release_names)
                )
            ),
            "startupEnforcement": getattr(self, "_retention_startup_result", None),
        }

    def record_policy_publication(
        self,
        *,
        public_url: str,
        approved_by: str,
        published_at: str = "",
        source: str = "desktop",
    ) -> dict[str, Any]:
        url = str(public_url or "").strip()
        approver = " ".join(str(approved_by or "").strip().split())
        if not approver:
            raise ValueError("The policy approver is required.")
        if len(url) > 1200:
            raise ValueError("The public policy URL is too long.")
        parsed = urlsplit(url)
        if (
            parsed.scheme.lower() != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
        ):
            raise ValueError("The public policy URL must be a credential-free HTTPS URL without a fragment.")
        published = parse_iso(published_at) if published_at else datetime.now(timezone.utc)
        if published is None:
            raise ValueError("The policy publication timestamp must be a valid ISO-8601 value.")
        if published > datetime.now(timezone.utc):
            raise ValueError("The policy publication timestamp cannot be in the future.")
        policy = build_retention_policy(
            {
                **dict(jurisdiction_preset(self.config.jurisdiction_preset) or jurisdiction_preset("standard") or {}),
                "retentionReviewedDays": int(self.config.retention_reviewed_days),
                "retentionPendingDays": int(self.config.retention_pending_days),
                "auditRetentionDays": int(self.config.retention_audit_days),
            },
            enforcement_enabled=bool(self.config.retention_enforcement_enabled),
        )
        publication = {
            "schemaVersion": 1,
            "policyVersion": policy["policyVersion"],
            "policyHash": policy["policyHash"],
            "publicUrl": url,
            "approvedBy": approver[:200],
            "publishedAt": published.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "recordedAt": now_iso(),
            "source": str(source or "desktop")[:80],
        }
        self.consent = {
            **self.consent,
            "schemaVersion": CONSENT_SCHEMA_VERSION,
            "policyPublication": publication,
        }
        self._append_audit(
            {
                "action": "record_biometric_policy_publication",
                "policyVersion": policy["policyVersion"],
                "policyHash": policy["policyHash"],
                "publicUrlHash": hashlib.sha256(url.encode("utf-8")).hexdigest(),
                "approverRef": self._audit_person_ref(approver),
                "publishedAt": publication["publishedAt"],
                "source": publication["source"],
            }
        )
        self.save()
        return self.biometric_retention_policy()["publication"]

    def acknowledge_ai_disclosure(self, *, operator: str = "", source: str = "desktop") -> dict[str, Any]:
        timestamp = now_iso()
        self.consent = {
            **self.consent,
            "schemaVersion": CONSENT_SCHEMA_VERSION,
            "aiDisclosure": {
                "version": AI_DISCLOSURE_VERSION,
                "acknowledged": True,
                "acknowledgedAt": timestamp,
                "operator": str(operator or "")[:120],
                "source": str(source or "desktop")[:80],
            },
        }
        self._append_audit(
            {
                "action": "acknowledge_ai_disclosure",
                "version": AI_DISCLOSURE_VERSION,
                "operatorRef": self._audit_person_ref(operator) if operator else "",
                "source": str(source or "desktop")[:80],
            }
        )
        self.save()
        return self.ai_disclosure_status()

    def _synthetic_age_image_candidate(self, raw_path: str | Path) -> Path:
        if not self._generated_dir_is_owned(self.synthetic_age_images_path):
            raise ValueError("The private synthetic age-image directory is not owned by this workspace.")
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            parts = candidate.parts
            if len(parts) == 1:
                candidate = self.synthetic_age_images_path / candidate
            elif len(parts) == 2 and parts[0] == self.synthetic_age_images_path.name:
                candidate = self.root / candidate
            else:
                raise ValueError("The synthetic age-image path is outside this workspace.")
        try:
            root = self.synthetic_age_images_path.resolve()
            if candidate.parent.resolve() != root or candidate.name in {"", ".", ".."}:
                raise ValueError("The synthetic age-image path is outside this workspace.")
        except (OSError, RuntimeError) as exc:
            raise ValueError("The synthetic age-image path is unavailable.") from exc
        return candidate

    def _synthetic_age_image_path(self, raw_path: str | Path, *, require_file: bool = True) -> Path:
        try:
            root = self.synthetic_age_images_path.resolve()
            candidate = self._synthetic_age_image_candidate(raw_path)
            if candidate.is_symlink():
                raise ValueError("Symbolic links are not accepted as synthetic age images.")
            resolved = candidate.resolve()
        except (OSError, RuntimeError) as exc:
            raise ValueError("The synthetic age-image path is unavailable.") from exc
        if resolved.parent != root:
            raise ValueError("The synthetic age-image path is outside this workspace.")
        if require_file and not resolved.is_file():
            raise FileNotFoundError("The staged synthetic age image is unavailable.")
        return resolved

    def _remove_synthetic_age_image_file(self, raw_path: str | Path) -> bool:
        try:
            candidate = self._synthetic_age_image_candidate(raw_path)
            if candidate.is_symlink():
                candidate.unlink(missing_ok=True)
            elif candidate.is_file():
                secure_remove_file(candidate)
            return not candidate.exists() and not candidate.is_symlink()
        except (OSError, RuntimeError, ValueError):
            return False

    def _synthetic_age_image_storage_key(self, path: Path) -> str:
        resolved = self._synthetic_age_image_path(path)
        return (Path(self.synthetic_age_images_path.name) / resolved.name).as_posix()

    def _reconcile_synthetic_age_image_storage(self) -> dict[str, int]:
        rehomed_references = 0
        removed_references = 0
        removed_files = 0
        rejected_artifacts = 0
        rolled_back_artifacts = 0
        changed = False
        valid_promoted_ref_ids: set[str] = set()
        for artifact in self._synthetic_age_image_artifacts():
            status = str(artifact.get("status", "") or "")
            if status not in {"staged", "promoted"}:
                continue
            artifact_id = str(artifact.get("artifact_id", "") or "")
            payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
            expected_hash = str(payload.get("generatedHash", "") or "")
            generated_path: Path | None = None
            try:
                candidate = self._synthetic_age_image_path(str(payload.get("generatedPath", "") or ""))
                if expected_hash and sha256_file(candidate) == expected_hash:
                    generated_path = candidate
            except (FileNotFoundError, OSError, RuntimeError, ValueError):
                generated_path = None
            matching_ref_ids = [
                ref_id
                for ref_id, ref in self.references.items()
                if is_generated_age_image_reference(ref)
                and str(ref.derivation_provenance.get("reviewArtifactId", "") or "") == artifact_id
            ]
            if status == "staged":
                if generated_path is None:
                    self.db.update_learned_artifact_status(artifact_id, "rejected")
                    rejected_artifacts += 1
                    changed = True
                continue
            payload_person = str(payload.get("personName", "") or "")
            payload_target = normalize_age_bucket(str(payload.get("targetAgeBucket", "") or ""))
            payload_parent_id = str(payload.get("parentRefId", "") or "")
            payload_parent_hash = str(payload.get("parentSourceHash", "") or "")
            artifact_hash = str(artifact.get("artifact_hash", "") or "")
            ref_contract_ok = False
            if generated_path is not None and len(matching_ref_ids) == 1:
                candidate_ref = self.references[matching_ref_ids[0]]
                provenance = candidate_ref.derivation_provenance
                parent_ref = self.references.get(payload_parent_id)
                ref_contract_ok = bool(
                    self._person_key(candidate_ref.person_name) == self._person_key(payload_person)
                    and normalize_age_bucket(candidate_ref.synthetic_target_age_bucket) == payload_target
                    and candidate_ref.parent_ref_ids == [payload_parent_id]
                    and str(candidate_ref.source_hash or "") == expected_hash
                    and str(provenance.get("reviewArtifactHash", "") or "") == artifact_hash
                    and str(provenance.get("outputHash", "") or "") == expected_hash
                    and str(provenance.get("parentSourceHash", "") or "") == payload_parent_hash
                    and parent_ref is not None
                    and not is_synthetic_age_reference(parent_ref)
                    and self._person_key(parent_ref.person_name) == self._person_key(payload_person)
                    and str(parent_ref.source_hash or "") == payload_parent_hash
                )
            if not ref_contract_ok:
                if generated_path is not None and self._remove_synthetic_age_image_file(generated_path):
                    removed_files += 1
                for ref_id in matching_ref_ids:
                    self.references.pop(ref_id, None)
                    self._mark_reference_deleted(ref_id)
                    removed_references += 1
                self.db.update_learned_artifact_status(artifact_id, "rolled_back")
                rolled_back_artifacts += 1
                changed = True
                continue
            for ref_id in matching_ref_ids:
                ref = self.references[ref_id]
                valid_promoted_ref_ids.add(ref_id)
                next_path = str(generated_path)
                if ref.source_path != next_path:
                    ref.source_path = next_path
                    self._mark_reference_dirty(ref_id)
                    rehomed_references += 1
                    changed = True
        valid_generated_paths: set[str] = set()
        for ref_id in valid_promoted_ref_ids:
            ref = self.references.get(ref_id)
            if ref is None:
                continue
            try:
                valid_generated_paths.add(str(Path(ref.source_path).expanduser().resolve()))
            except (OSError, RuntimeError):
                continue
        orphan_ref_ids = [
            ref_id
            for ref_id, ref in self.references.items()
            if is_generated_age_image_reference(ref) and ref_id not in valid_promoted_ref_ids
        ]
        for ref_id in orphan_ref_ids:
            ref = self.references.pop(ref_id, None)
            if ref is not None:
                try:
                    orphan_path = self._synthetic_age_image_path(ref.source_path, require_file=False)
                except (OSError, RuntimeError, ValueError):
                    orphan_path = None
                if orphan_path is not None and str(orphan_path) not in valid_generated_paths:
                    if self._remove_synthetic_age_image_file(orphan_path):
                        removed_files += 1
            self._mark_reference_deleted(ref_id)
            removed_references += 1
            changed = True
        if removed_references:
            self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
            self._invalidate_reference_indexes()
        if changed:
            self._append_audit(
                {
                    "action": "reconcile_synthetic_age_image_storage",
                    "rehomedReferences": rehomed_references,
                    "removedReferences": removed_references,
                    "removedFiles": removed_files,
                    "rejectedArtifacts": rejected_artifacts,
                    "rolledBackArtifacts": rolled_back_artifacts,
                }
            )
            self.save()
        return {
            "rehomedReferences": rehomed_references,
            "removedReferences": removed_references,
            "removedFiles": removed_files,
            "rejectedArtifacts": rejected_artifacts,
            "rolledBackArtifacts": rolled_back_artifacts,
        }

    def _synthetic_age_image_artifacts(self) -> list[dict[str, Any]]:
        return self.db.all_learned_artifact_rows(SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE)

    def _invalidate_synthetic_age_image_artifacts(
        self,
        *,
        person_name: str = "",
        parent_ref_id: str = "",
        reason: str,
    ) -> list[str]:
        person_key = self._person_key(person_name)
        invalidated: list[str] = []
        for artifact in self._synthetic_age_image_artifacts():
            status = str(artifact.get("status", "") or "")
            if status not in {"candidate", "staged", "promoted"}:
                continue
            payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
            if person_key and self._person_key(str(payload.get("personName", "") or "")) != person_key:
                continue
            parent_ids = [
                str(item)
                for item in payload.get("parentRefIds", [])
                if isinstance(item, str) and item
            ]
            single_parent = str(payload.get("parentRefId", "") or "")
            if single_parent and single_parent not in parent_ids:
                parent_ids.append(single_parent)
            if parent_ref_id and parent_ref_id not in parent_ids:
                continue
            generated_path = str(payload.get("generatedPath", "") or "")
            if generated_path and not self._remove_synthetic_age_image_file(generated_path):
                raise OSError("A private synthetic age image could not be removed safely.")
            next_status = "rolled_back" if status == "promoted" else "rejected"
            self.db.update_learned_artifact_status(str(artifact["artifact_id"]), next_status)
            invalidated.append(str(artifact["artifact_id"]))
        if invalidated:
            self._append_audit(
                {
                    "action": "invalidate_synthetic_age_image_artifacts",
                    "personRef": self._audit_person_ref(person_name) if person_name else "",
                    "parentRefId": parent_ref_id,
                    "artifactIds": invalidated[:50],
                    "count": len(invalidated),
                    "reason": str(reason or "lifecycle-change")[:120],
                }
            )
        return invalidated

    def _erase_synthetic_age_image_artifacts_for_person(self, person_name: str) -> dict[str, int]:
        person_key = self._person_key(person_name)
        artifact_ids: list[str] = []
        files = 0
        bytes_removed = 0
        for artifact in self._synthetic_age_image_artifacts():
            payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
            if self._person_key(str(payload.get("personName", "") or "")) != person_key:
                continue
            generated_path = str(payload.get("generatedPath", "") or "")
            try:
                generated_size = self._synthetic_age_image_path(generated_path).stat().st_size if generated_path else 0
            except (FileNotFoundError, OSError, RuntimeError, ValueError):
                generated_size = 0
            if generated_path and not self._remove_synthetic_age_image_file(generated_path):
                raise OSError("A private synthetic age image could not be erased safely.")
            if generated_size:
                files += 1
                bytes_removed += generated_size
            artifact_ids.append(str(artifact["artifact_id"]))
        return {
            "artifacts": self.db.delete_learned_artifacts(artifact_ids),
            "files": files,
            "bytes": bytes_removed,
        }

    def _remove_age_trajectory_references(
        self,
        *,
        person_name: str = "",
        parent_ref_id: str = "",
    ) -> list[str]:
        person_key = self._person_key(person_name)
        removed = [
            ref_id
            for ref_id, ref in self.references.items()
            if is_synthetic_age_reference(ref)
            and (not person_key or self._person_key(ref.person_name) == person_key)
            and (not parent_ref_id or parent_ref_id in ref.parent_ref_ids)
        ]
        invalidated_artifacts = self._invalidate_synthetic_age_image_artifacts(
            person_name=person_name,
            parent_ref_id=parent_ref_id,
            reason="synthetic-reference-removal",
        )
        if not removed:
            return []
        for ref_id in removed:
            self.references.pop(ref_id, None)
        self._mark_references_deleted(removed)
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        self._invalidate_reference_indexes()
        if invalidated_artifacts:
            self._append_audit(
                {
                    "action": "remove_generated_age_reference_files",
                    "references": len(removed),
                    "artifacts": len(invalidated_artifacts),
                }
            )
        return removed

    def age_trajectory_status(self, person_name: str = "") -> dict[str, Any]:
        person_key = self._person_key(person_name)
        refs = [
            ref
            for ref in self.references.values()
            if not person_key or self._person_key(ref.person_name) == person_key
        ]
        real_refs = [ref for ref in refs if not is_synthetic_age_reference(ref)]
        synthetic_refs = [ref for ref in refs if is_synthetic_age_reference(ref)]
        generated_image_refs = [ref for ref in synthetic_refs if is_generated_age_image_reference(ref)]
        embedding_refs = [ref for ref in synthetic_refs if not is_generated_age_image_reference(ref)]
        real_buckets = sorted(
            {
                normalize_age_bucket(ref.age_bucket)
                for ref in real_refs
                if normalize_age_bucket(ref.age_bucket) != "unknown"
            }
        )
        return {
            "personName": person_name.strip(),
            "methodVersion": AGE_TRAJECTORY_METHOD_VERSION,
            "imageMethodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
            "realReferences": len(real_refs),
            "syntheticReferences": len(synthetic_refs),
            "embeddingReferences": len(embedding_refs),
            "generatedImageReferences": len(generated_image_refs),
            "realAgeBuckets": real_buckets,
            "targetAgeBuckets": sorted({ref.synthetic_target_age_bucket for ref in synthetic_refs if ref.synthetic_target_age_bucket}),
            "eligible": len(real_buckets) >= 2,
            "consentActive": self.consent_for_person(person_name) if person_name.strip() else self.consent_on_file(),
            "generatedImages": bool(generated_image_refs),
            "externalAgingWeights": bool(generated_image_refs),
        }

    def build_age_trajectory_references(
        self,
        person_name: str,
        *,
        acknowledge_embedding_derivation: bool,
        source: str = "desktop",
    ) -> dict[str, Any]:
        person = str(person_name or "").strip()
        if not person:
            raise ValueError("A person name is required.")
        if not acknowledge_embedding_derivation:
            raise ValueError("Confirm the local synthetic embedding derivation before building an age bridge.")
        if not self.consent_for_person(person):
            raise PermissionError("Active workspace and subject consent are required for age-trajectory augmentation.")
        person_key = self._person_key(person)
        real_refs = [
            ref
            for ref in self.references.values()
            if self._person_key(ref.person_name) == person_key and not is_synthetic_age_reference(ref)
        ]
        candidates = build_age_trajectory_candidates(real_refs)
        desired_ids = {candidate.ref_id for candidate in candidates}
        existing = {
            ref_id: ref
            for ref_id, ref in self.references.items()
            if self._person_key(ref.person_name) == person_key
            and is_synthetic_age_reference(ref)
            and ref.synthetic_method_version == AGE_TRAJECTORY_METHOD_VERSION
        }
        stale_ids = sorted(set(existing) - desired_ids)
        if stale_ids:
            for ref_id in stale_ids:
                self.references.pop(ref_id, None)
            self._mark_references_deleted(stale_ids)

        consent_record = self.subject_consents().get(person_key, {})
        consent_snapshot = {
            "workspaceId": str(self.workspace_metadata.get("workspaceId") or ""),
            "workspaceConfirmedAt": self.consent.get("confirmedAt"),
            "workspaceUpdatedAt": self.consent.get("updatedAt"),
            "subjectConfirmedAt": consent_record.get("confirmedAt"),
            "subjectUpdatedAt": consent_record.get("updatedAt"),
            "perSubjectRequired": bool(getattr(self.config, "per_subject_consent", False)),
            "explicitEmbeddingDerivationAcknowledged": True,
        }
        added_ids: list[str] = []
        retained_ids: list[str] = []
        generated_at = now_iso()
        for candidate in candidates:
            current = existing.get(candidate.ref_id)
            if (
                current is not None
                and current.synthetic_method_version == AGE_TRAJECTORY_METHOD_VERSION
                and current.derivation_provenance.get("derivationHash") == candidate.derivation_hash
            ):
                retained_ids.append(current.ref_id)
                continue
            anchor = self.references.get(candidate.anchor_ref_id)
            if anchor is None or is_synthetic_age_reference(anchor):
                continue
            ref = ReferenceFace(
                ref_id=candidate.ref_id,
                person_name=anchor.person_name,
                age_bucket=candidate.target_age_bucket,
                source_path=anchor.source_path,
                capture_date=None,
                quality=candidate.quality,
                model_name=candidate.model_name,
                vector=candidate.vector,
                source_hash=candidate.derivation_hash,
                pose_bucket="unknown",
                capture_date_provenance=AGE_TRAJECTORY_REFERENCE_KIND,
                reference_kind=AGE_TRAJECTORY_REFERENCE_KIND,
                synthetic_method_version=AGE_TRAJECTORY_METHOD_VERSION,
                synthetic_target_age_bucket=candidate.target_age_bucket,
                parent_ref_ids=list(candidate.parent_ref_ids),
                derivation_provenance={
                    "schemaVersion": 1,
                    "kind": "embedding-space-age-trajectory",
                    "methodVersion": AGE_TRAJECTORY_METHOD_VERSION,
                    "derivationHash": candidate.derivation_hash,
                    "generatedAt": generated_at,
                    "targetAgeBucket": candidate.target_age_bucket,
                    "leftAgeBucket": candidate.left_age_bucket,
                    "rightAgeBucket": candidate.right_age_bucket,
                    "interpolation": candidate.interpolation,
                    "parentReferenceIds": list(candidate.parent_ref_ids),
                    "generatedImage": False,
                    "externalAgingWeights": False,
                    "licenseBasis": "first-party deterministic code over consented local reference embeddings",
                    "consent": consent_snapshot,
                },
            )
            self.references[ref.ref_id] = ref
            self._mark_reference_dirty(ref.ref_id)
            added_ids.append(ref.ref_id)
        if stale_ids or added_ids:
            self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
            self._invalidate_reference_indexes()
        result = {
            **self.age_trajectory_status(person),
            "added": len(added_ids),
            "retained": len(retained_ids),
            "removed": len(stale_ids),
            "addedReferenceIds": added_ids,
            "removedReferenceIds": stale_ids,
            "source": str(source or "desktop")[:80],
        }
        self._append_audit(
            {
                "action": "build_age_trajectory_references",
                "personRef": self._audit_person_ref(person),
                "methodVersion": AGE_TRAJECTORY_METHOD_VERSION,
                "realReferences": len(real_refs),
                "added": len(added_ids),
                "retained": len(retained_ids),
                "removed": len(stale_ids),
                "source": str(source or "desktop")[:80],
                "explicitAcknowledgement": True,
                "generatedImages": False,
                "externalAgingWeights": False,
            }
        )
        self.save()
        return result

    def remove_age_trajectory_references(self, person_name: str, *, source: str = "desktop") -> dict[str, Any]:
        person = str(person_name or "").strip()
        if not person:
            raise ValueError("A person name is required.")
        removed = self._remove_age_trajectory_references(person_name=person)
        self._append_audit(
            {
                "action": "remove_age_trajectory_references",
                "personRef": self._audit_person_ref(person),
                "removed": len(removed),
                "source": str(source or "desktop")[:80],
            }
        )
        self.save()
        return {**self.age_trajectory_status(person), "removed": len(removed), "removedReferenceIds": removed}

    @staticmethod
    def _synthetic_age_artifact_base_id(
        person_name: str,
        parent: ReferenceFace,
        target_age_bucket: str,
        recognizer_model: str,
    ) -> str:
        body = json.dumps(
            {
                "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                "person": ProjectState._person_key(person_name),
                "parentRefId": parent.ref_id,
                "parentSourceHash": str(parent.source_hash or ""),
                "targetAgeBucket": target_age_bucket,
                "recognizerModel": recognizer_model,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "syn_age_img_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]

    def _next_synthetic_age_artifact_id(self, base_artifact_id: str) -> tuple[str, dict[str, Any] | None]:
        for attempt in range(1000):
            artifact_id = base_artifact_id if attempt == 0 else f"{base_artifact_id}_{attempt + 1}"
            existing = self.db.learned_artifact_by_id(artifact_id)
            if existing is None:
                return artifact_id, None
            if str(existing.get("status", "") or "") in {"candidate", "staged", "promoted"}:
                return artifact_id, existing
        raise ValueError("Too many finalized synthetic age-image attempts exist for this source and target range.")

    def _active_synthetic_age_artifact_is_valid(self, artifact: dict[str, Any]) -> bool:
        status = str(artifact.get("status", "") or "")
        if status not in {"staged", "promoted"}:
            return False
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        try:
            generated_path = self._synthetic_age_image_path(str(payload.get("generatedPath", "") or ""))
            if sha256_file(generated_path) != str(payload.get("generatedHash", "") or ""):
                return False
        except (FileNotFoundError, OSError, ValueError):
            return False
        if status == "staged":
            return True
        artifact_id = str(artifact.get("artifact_id", "") or "")
        return any(
            is_generated_age_image_reference(ref)
            and str(ref.derivation_provenance.get("reviewArtifactId", "") or "") == artifact_id
            and Path(ref.source_path).expanduser().is_file()
            for ref in self.references.values()
        )

    def _synthetic_age_parent_reference(
        self,
        references: list[ReferenceFace],
        target_age_bucket: str,
    ) -> ReferenceFace:
        target_age = float(AGE_BUCKET_CENTERS[target_age_bucket])

        def rank(ref: ReferenceFace) -> tuple[float, float, str]:
            bucket = normalize_age_bucket(ref.age_bucket)
            age = float(AGE_BUCKET_CENTERS.get(bucket, target_age))
            return (abs(age - target_age), -float(ref.quality), ref.ref_id)

        available = [ref for ref in references if Path(ref.source_path).expanduser().is_file()]
        if not available:
            raise FileNotFoundError("No compatible real source photo is available for local age-reference generation.")
        return min(available, key=rank)

    def _prepare_synthetic_age_source(
        self,
        parent: ReferenceFace,
        engine: EmbeddingEngine,
        destination: Path,
    ) -> dict[str, Any]:
        source = safe_resolve(Path(parent.source_path).expanduser())
        if not source.is_file():
            raise FileNotFoundError("The selected real source photo is unavailable.")
        source_hash = sha256_file(source)
        if parent.source_hash and source_hash != parent.source_hash:
            raise ValueError("The selected real source photo changed after enrollment.")
        embeddings = [
            item
            for item in engine.embed_image(source)
            if self._compatible_reference_model_name(str(getattr(engine, "model_name", "") or ""), item.model_name)
        ]
        if not embeddings:
            raise ValueError("The active recognizer could not re-detect the enrolled face in its source photo.")
        ranked = sorted(
            ((self._vector_cosine(item.vector, parent.vector), item) for item in embeddings),
            key=lambda row: (-row[0], -float(row[1].quality)),
        )
        parent_score, selected = ranked[0]
        if parent_score < SYNTHETIC_AGE_PARENT_MINIMUM:
            raise ValueError("The source face no longer matches its enrolled reference reliably.")
        if len(ranked) > 1 and parent_score - ranked[1][0] < SYNTHETIC_AGE_IMPOSTOR_MARGIN_MINIMUM:
            raise ValueError("The source photo contains multiple faces too close to the enrolled reference; use a single-person photo.")
        image = load_image(source)
        if selected.bbox is not None:
            left, top, right, bottom = (int(value) for value in selected.bbox)
            left = max(0, min(image.width, left))
            top = max(0, min(image.height, top))
            right = max(0, min(image.width, right))
            bottom = max(0, min(image.height, bottom))
            if right <= left or bottom <= top:
                raise ValueError("The enrolled face has an invalid source crop.")
            face_width = right - left
            face_height = bottom - top
            side = max(face_width, face_height)
            center_x = (left + right) / 2.0
            center_y = (top + bottom) / 2.0
            crop_side = max(128, int(round(side * 2.30)))
            crop_left = max(0, int(round(center_x - crop_side / 2.0)))
            crop_top = max(0, int(round(center_y - crop_side / 2.0)))
            crop_right = min(image.width, crop_left + crop_side)
            crop_bottom = min(image.height, crop_top + crop_side)
            crop_left = max(0, crop_right - crop_side)
            crop_top = max(0, crop_bottom - crop_side)
            image = image.crop((crop_left, crop_top, crop_right, crop_bottom))
            source_bbox: list[int] = [left, top, right, bottom]
            crop_bbox: list[int] = [crop_left, crop_top, crop_right, crop_bottom]
        elif len(embeddings) == 1:
            source_bbox = []
            crop_bbox = [0, 0, image.width, image.height]
        else:
            raise ValueError("The enrolled face could not be isolated from its source photo.")
        image.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, format="PNG", optimize=False)
        restrict_file_mode(destination, 0o600)
        return {
            "sourcePath": str(source),
            "sourceHash": source_hash,
            "sourceFaceHash": sha256_file(destination),
            "sourceFaceCosine": round(float(parent_score), 8),
            "sourceBbox": source_bbox,
            "cropBbox": crop_bbox,
        }

    def _evaluate_synthetic_age_image(
        self,
        generated_path: Path,
        *,
        person_name: str,
        parent: ReferenceFace,
        target_age_bucket: str,
        engine: EmbeddingEngine,
    ) -> tuple[EmbeddingResult | None, dict[str, Any]]:
        engine_model = str(getattr(engine, "model_name", "") or "").strip()
        embeddings = [
            item
            for item in engine.embed_image(generated_path)
            if self._compatible_reference_model_name(engine_model, item.model_name)
        ]
        reasons: list[str] = []
        if len(embeddings) != 1:
            reasons.append("face-count-not-one")
        if not embeddings:
            return None, {
                "targetAgeBucket": target_age_bucket,
                "faceCount": 0,
                "recognizerModel": engine_model,
                "reasons": reasons,
            }
        selected = max(
            embeddings,
            key=lambda item: (self._vector_cosine(item.vector, parent.vector), float(item.quality)),
        )
        real_refs = [
            ref
            for ref in self.references.values()
            if not is_synthetic_age_reference(ref)
            and self._compatible_reference_model_name(selected.model_name, ref.model_name)
        ]
        same_person = [ref for ref in real_refs if self._person_key(ref.person_name) == self._person_key(person_name)]
        other_people = [ref for ref in real_refs if self._person_key(ref.person_name) != self._person_key(person_name)]
        same_scores = [(self._vector_cosine(selected.vector, ref.vector), ref.ref_id) for ref in same_person]
        other_scores = [(self._vector_cosine(selected.vector, ref.vector), ref.ref_id) for ref in other_people]
        target_score, best_same_ref_id = max(same_scores, default=(0.0, ""))
        parent_score = self._vector_cosine(selected.vector, parent.vector)
        nearest_other_score, nearest_other_ref_id = max(other_scores, default=(0.0, ""))
        identity_margin = target_score - nearest_other_score if other_scores else None
        identity_minimum = max(SYNTHETIC_AGE_IDENTITY_MINIMUM, float(self.config.thresholds.likely))
        quality_minimum = max(SYNTHETIC_AGE_MINIMUM_QUALITY, float(self.config.thresholds.quality_min))
        if not same_person:
            reasons.append("no-compatible-real-reference")
        if target_score < identity_minimum:
            reasons.append("identity-score-too-low")
        if parent_score < SYNTHETIC_AGE_PARENT_MINIMUM:
            reasons.append("parent-score-too-low")
        if identity_margin is not None and identity_margin < SYNTHETIC_AGE_IMPOSTOR_MARGIN_MINIMUM:
            reasons.append("impostor-margin-too-small")
        if float(selected.quality) < quality_minimum:
            reasons.append("quality-too-low")
        if selected.align_error and float(selected.align_error) > self.REFERENCE_SUGGESTION_MAX_ALIGN_ERROR:
            reasons.append("alignment-too-high")
        if selected.ied_px and float(selected.ied_px) < self.REFERENCE_SUGGESTION_MIN_IED_PX:
            reasons.append("face-too-small")
        metrics = {
            "targetAgeBucket": target_age_bucket,
            "faceCount": len(embeddings),
            "recognizerModel": selected.model_name,
            "quality": round(float(selected.quality), 8),
            "qualityMinimum": quality_minimum,
            "targetIdentityCosine": round(float(target_score), 8),
            "identityMinimum": identity_minimum,
            "parentCosine": round(float(parent_score), 8),
            "parentMinimum": SYNTHETIC_AGE_PARENT_MINIMUM,
            "nearestOtherCosine": round(float(nearest_other_score), 8) if other_scores else None,
            "identityMargin": round(float(identity_margin), 8) if identity_margin is not None else None,
            "marginMinimum": SYNTHETIC_AGE_IMPOSTOR_MARGIN_MINIMUM,
            "bestSameReferenceId": best_same_ref_id,
            "nearestOtherReferenceId": nearest_other_ref_id,
            "bbox": list(selected.bbox or ()),
            "poseBucket": str(selected.pose_bucket or "unknown"),
            "iedPx": round(float(selected.ied_px or 0.0), 8),
            "alignError": round(float(selected.align_error or 0.0), 8),
            "reasons": sorted(set(reasons)),
        }
        return selected, metrics

    def synthetic_age_image_review_status(self, limit: int = 20) -> dict[str, Any]:
        safe_limit = max(1, min(100, int(limit or 20)))
        rows = self.db.learned_artifact_rows(SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE, limit=safe_limit)
        all_rows = self._synthetic_age_image_artifacts()
        counts = {"staged": 0, "promoted": 0, "rejected": 0, "candidate": 0, "rolled_back": 0}
        for row in all_rows:
            status = str(row.get("status", "") or "")
            if status in counts:
                counts[status] += 1
        return {
            "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
            "artifactType": SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE,
            "reviewOnly": True,
            "autoEnrollment": False,
            "counts": counts,
            "artifacts": self._learned_artifact_status_payloads(rows),
        }

    def generate_synthetic_age_image_reviews(
        self,
        person_name: str,
        target_age_buckets: Iterable[str],
        engine: EmbeddingEngine,
        generator: Callable[..., dict[str, Any]],
        *,
        acknowledge_ai_age_generation: bool,
        source: str = "desktop",
        generative_root: str | Path | None = None,
        seed: int = 42,
        steps: int = 20,
        on_progress: ScanProgress | None = None,
    ) -> dict[str, Any]:
        person = str(person_name or "").strip()
        if not person:
            raise ValueError("A person name is required.")
        if acknowledge_ai_age_generation is not True:
            raise ValueError("Confirm that synthetic age portraits are AI-generated review aids, not authentic captures or predictions.")
        if not self.consent_for_person(person):
            raise PermissionError("Active workspace and subject consent are required for synthetic age-reference generation.")
        if not self.ai_disclosure_status()["acknowledged"]:
            raise PermissionError("Acknowledge the current Vintrace AI and biometric processing notice before generating an age reference.")
        engine_model = str(getattr(engine, "model_name", "") or "").strip()
        if not engine_model or engine_model.startswith("local-image-fingerprint"):
            raise ValueError("A full face recognition model is required for synthetic age-reference safety checks.")
        targets: list[str] = []
        for value in target_age_buckets:
            bucket = normalize_age_bucket(str(value or ""))
            if bucket == "unknown":
                raise ValueError("Choose a supported target age range.")
            if bucket not in targets:
                targets.append(bucket)
        if not targets:
            raise ValueError("Choose at least one target age range.")
        if len(targets) > SYNTHETIC_AGE_MAX_TARGETS_PER_RUN:
            raise ValueError(f"Generate at most {SYNTHETIC_AGE_MAX_TARGETS_PER_RUN} target age ranges at a time.")
        person_key = self._person_key(person)
        real_refs = [
            ref
            for ref in self.references.values()
            if self._person_key(ref.person_name) == person_key
            and not is_synthetic_age_reference(ref)
            and self._compatible_reference_model_name(engine_model, ref.model_name)
        ]
        if not real_refs:
            raise ValueError("No real saved photo is compatible with the active face recognition model.")
        real_buckets = {normalize_age_bucket(ref.age_bucket) for ref in real_refs}
        if any(target in real_buckets for target in targets):
            raise ValueError("Synthetic augmentation is only available for an age range without a real saved photo.")
        try:
            safe_seed = max(0, min(2_147_483_647, int(seed)))
            safe_steps = max(8, min(40, int(steps)))
        except (TypeError, ValueError) as exc:
            raise ValueError("Seed and step count must be integers.") from exc
        self._ensure_generated_dir_sentinel(self.synthetic_age_images_path)
        if not self._generated_dir_is_owned(self.synthetic_age_images_path):
            raise ValueError("The private synthetic age-image directory could not be prepared safely.")
        restrict_file_mode(self.synthetic_age_images_path, 0o700)
        staged: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for index, target in enumerate(targets, start=1):
            parent = self._synthetic_age_parent_reference(real_refs, target)
            base_id = self._synthetic_age_artifact_base_id(person, parent, target, engine_model)
            artifact_id, existing = self._next_synthetic_age_artifact_id(base_id)
            if existing is not None:
                if self._active_synthetic_age_artifact_is_valid(existing):
                    skipped.append({"artifactId": artifact_id, "targetAgeBucket": target, "status": str(existing.get("status", ""))})
                    continue
                stale_payload = existing.get("payload") if isinstance(existing.get("payload"), dict) else {}
                stale_path = str(stale_payload.get("generatedPath", "") or "")
                if stale_path and not self._remove_synthetic_age_image_file(stale_path):
                    raise OSError("A stale synthetic age-image artifact could not be removed safely.")
                stale_status = "rolled_back" if existing.get("status") == "promoted" else "rejected"
                self.db.update_learned_artifact_status(str(existing["artifact_id"]), stale_status)
                artifact_id, existing = self._next_synthetic_age_artifact_id(base_id)
                if existing is not None:
                    raise ValueError("A stale synthetic age-image artifact could not be superseded safely.")
            generated_path = self.synthetic_age_images_path / f"{artifact_id}.png"
            if generated_path.exists() or generated_path.is_symlink():
                if not self._remove_synthetic_age_image_file(generated_path):
                    raise OSError("A stale synthetic age-image output could not be removed safely.")
            if on_progress:
                on_progress(
                    {
                        "phase": "synthetic_age_generation",
                        "processed": index - 1,
                        "total": len(targets),
                        "targetAgeBucket": target,
                        "message": f"Preparing the {target} synthetic age reference.",
                    }
                )
            try:
                with tempfile.TemporaryDirectory(prefix="vintrace-age-source-") as temp_value:
                    prepared_path = Path(temp_value) / "consented-face.png"
                    source_detail = self._prepare_synthetic_age_source(parent, engine, prepared_path)
                    result = generator(
                        "age-progress",
                        prepared_path,
                        generated_path,
                        {
                            "targetAgeBucket": target,
                            "aspect": "original",
                            "seed": safe_seed,
                            "steps": safe_steps,
                        },
                        root=generative_root,
                    )
                restrict_file_mode(generated_path, 0o600)
                actual_output_hash = sha256_file(self._synthetic_age_image_path(generated_path))
                provenance = result.get("provenance") if isinstance(result.get("provenance"), dict) else {}
                parameters = provenance.get("parameters") if isinstance(provenance.get("parameters"), dict) else {}
                model = provenance.get("model") if isinstance(provenance.get("model"), dict) else {}
                runtime = provenance.get("runtime") if isinstance(provenance.get("runtime"), dict) else {}
                contract_ok = bool(
                    result.get("mode") == "age-progress"
                    and result.get("aiGenerated") is True
                    and result.get("offlineInference") is True
                    and str(result.get("outputSha256", "")) == actual_output_hash
                    and str(result.get("sourceSha256", "")) == source_detail["sourceFaceHash"]
                    and Path(str(result.get("outputPath", "") or "")).expanduser().resolve() == generated_path.resolve()
                    and provenance.get("mode") == "age-progress"
                    and str(provenance.get("sourceSha256", "")) == source_detail["sourceFaceHash"]
                    and str(provenance.get("outputSha256", "")) == actual_output_hash
                    and provenance.get("catalogVersion") == PHOTO_GENERATIVE_CATALOG_VERSION
                    and provenance.get("catalogSha256") == PHOTO_GENERATIVE_CATALOG_SHA256
                    and parameters.get("targetAgeBucket") == target
                    and float(parameters.get("targetAgeYears", -1)) == float(AGE_BUCKET_CENTERS[target])
                    and parameters.get("fixedSafetyPrompt") is True
                    and parameters.get("promptVersion") == AGE_PROGRESS_PROMPT_VERSION
                    and parameters.get("promptSha256") == age_progress_prompt_sha256(target)
                    and not str(parameters.get("prompt", "") or "")
                    and int(parameters.get("seed", -1)) == safe_seed
                    and int(parameters.get("steps", -1)) == safe_steps
                    and model.get("id") == QWEN_IMAGE_EDIT_MODEL_ID
                    and model.get("revision") == QWEN_IMAGE_EDIT_REVISION
                    and model.get("license") == "Apache-2.0"
                    and runtime.get("id") == STABLE_DIFFUSION_CPP_RUNTIME_ID
                    and runtime.get("tag") == STABLE_DIFFUSION_CPP_TAG
                    and runtime.get("revision") == STABLE_DIFFUSION_CPP_REVISION
                    and runtime.get("license") == "MIT"
                )
                if not contract_ok:
                    raise ValueError("The local age-generation runtime returned incomplete or mismatched provenance.")
                embedding, metrics = self._evaluate_synthetic_age_image(
                    generated_path,
                    person_name=person,
                    parent=parent,
                    target_age_bucket=target,
                    engine=engine,
                )
                consent_record = self.subject_consents().get(person_key, {})
                payload = {
                    "schemaVersion": 1,
                    "personName": person[:200],
                    "targetAgeBucket": target,
                    "generatedPath": self._synthetic_age_image_storage_key(generated_path),
                    "generatedHash": actual_output_hash,
                    "parentRefId": parent.ref_id,
                    "parentRefIds": [parent.ref_id],
                    "parentSourceHash": source_detail["sourceHash"],
                    "sourceFaceHash": source_detail["sourceFaceHash"],
                    "sourceFaceCosine": source_detail["sourceFaceCosine"],
                    "sourceBbox": source_detail["sourceBbox"],
                    "cropBbox": source_detail["cropBbox"],
                    "recognizerModel": engine_model,
                    "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                    "generationProvenance": provenance,
                    "reviewOnly": True,
                    "authenticCapture": False,
                    "futureAppearancePrediction": False,
                    "consent": {
                        "workspaceId": str(self.workspace_metadata.get("workspaceId") or ""),
                        "workspaceConfirmedAt": self.consent.get("confirmedAt"),
                        "workspaceUpdatedAt": self.consent.get("updatedAt"),
                        "subjectConfirmedAt": consent_record.get("confirmedAt"),
                        "subjectUpdatedAt": consent_record.get("updatedAt"),
                        "aiDisclosureVersion": self.ai_disclosure_status()["version"],
                        "explicitAgeGenerationAcknowledged": True,
                    },
                }
                reasons = list(metrics.get("reasons", []))
                status = "staged" if embedding is not None and not reasons else "rejected"
                artifact = self.db.upsert_learned_artifact(
                    artifact_id,
                    {
                        "artifactType": SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE,
                        "status": status,
                        "modelName": str(model.get("id", "")),
                        "versionKey": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                        "trainingDataHash": source_detail["sourceHash"],
                        "inputCount": 1,
                        "positiveCount": 1 if status == "staged" else 0,
                        "negativeCount": 1 if status == "rejected" else 0,
                        "metrics": metrics,
                        "payload": payload,
                        "createdAt": now_iso(),
                    },
                )
                item = {
                    **artifact,
                    "targetAgeBucket": target,
                    "metrics": metrics,
                    "payload": payload,
                }
                if status == "staged":
                    staged.append(item)
                else:
                    if not self._remove_synthetic_age_image_file(generated_path):
                        raise OSError("A rejected synthetic age image could not be removed safely.")
                    rejected.append(item)
                self._append_audit(
                    {
                        "action": "stage_synthetic_age_image_review" if status == "staged" else "reject_synthetic_age_image_generation",
                        "artifactId": artifact_id,
                        "artifactHash": artifact.get("artifactHash", ""),
                        "personRef": self._audit_person_ref(person),
                        "parentRefId": parent.ref_id,
                        "targetAgeBucket": target,
                        "generatedHash": actual_output_hash,
                        "recognizerModel": engine_model,
                        "targetIdentityCosine": metrics.get("targetIdentityCosine"),
                        "identityMargin": metrics.get("identityMargin"),
                        "quality": metrics.get("quality"),
                        "reasons": reasons,
                        "source": str(source or "desktop")[:80],
                    }
                )
            except Exception as exc:
                if (generated_path.exists() or generated_path.is_symlink()) and not self._remove_synthetic_age_image_file(generated_path):
                    raise OSError("A failed synthetic age-image output could not be removed safely.") from exc
                errors.append(
                    {
                        "targetAgeBucket": target,
                        "error": re.sub(r"\s+", " ", str(exc).strip() or exc.__class__.__name__)[:600],
                    }
                )
            if on_progress:
                on_progress(
                    {
                        "phase": "synthetic_age_generation",
                        "processed": index,
                        "total": len(targets),
                        "targetAgeBucket": target,
                        "message": f"Finished the {target} synthetic age-reference attempt.",
                    }
                )
        self.save()
        return {
            "personName": person,
            "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
            "reviewOnly": True,
            "autoEnrollment": False,
            "staged": len(staged),
            "rejected": len(rejected),
            "skipped": len(skipped),
            "errors": errors,
            "artifacts": staged,
            "rejectedArtifacts": rejected,
            "skippedArtifacts": skipped,
            "summary": self.synthetic_age_image_review_status(),
        }

    def approve_synthetic_age_image_review(
        self,
        artifact_id: str,
        engine: EmbeddingEngine,
        *,
        operator: str = "",
        acknowledge_visual_review: bool = False,
    ) -> dict[str, Any]:
        if acknowledge_visual_review is not True:
            raise ValueError("Confirm that you visually reviewed the AI-generated portrait before approving it.")
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE:
            raise ValueError("No synthetic age-image review is available for approval.")
        if artifact.get("status") != "staged":
            raise ValueError("Only staged synthetic age-image reviews can be approved.")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        person = str(payload.get("personName", "") or "").strip()
        target = normalize_age_bucket(str(payload.get("targetAgeBucket", "") or ""))
        if not person or target == "unknown":
            raise ValueError("The staged synthetic age-image metadata is incomplete.")
        if not self.consent_for_person(person) or not self.ai_disclosure_status()["acknowledged"]:
            raise PermissionError("Current workspace, subject, and AI-disclosure consent are required for approval.")
        parent_id = str(payload.get("parentRefId", "") or "")
        parent = self.references.get(parent_id)
        if parent is None or is_synthetic_age_reference(parent) or self._person_key(parent.person_name) != self._person_key(person):
            raise ValueError("The real parent reference is no longer available for approval.")
        if str(parent.source_hash or "") != str(payload.get("parentSourceHash", "") or ""):
            raise ValueError("The parent reference changed after generation.")
        parent_source = safe_resolve(Path(parent.source_path).expanduser())
        if not parent_source.is_file() or sha256_file(parent_source) != str(payload.get("parentSourceHash", "") or ""):
            raise ValueError("The real parent source photo changed after generation.")
        generated_path = self._synthetic_age_image_path(str(payload.get("generatedPath", "") or ""))
        generated_hash = sha256_file(generated_path)
        if generated_hash != str(payload.get("generatedHash", "") or ""):
            raise ValueError("The staged synthetic age image changed after generation.")
        if str(getattr(engine, "model_name", "") or "") != str(payload.get("recognizerModel", "") or ""):
            raise ValueError("The active face recognition model changed; regenerate the synthetic age reference.")
        existing_target = [
            ref
            for ref in self.references.values()
            if is_generated_age_image_reference(ref)
            and self._person_key(ref.person_name) == self._person_key(person)
            and normalize_age_bucket(ref.synthetic_target_age_bucket) == target
        ]
        if existing_target:
            raise ValueError("A reviewed synthetic image already covers this person's target age range.")
        embedding, metrics = self._evaluate_synthetic_age_image(
            generated_path,
            person_name=person,
            parent=parent,
            target_age_bucket=target,
            engine=engine,
        )
        reasons = list(metrics.get("reasons", []))
        if embedding is None or reasons:
            raise ValueError("The synthetic age image no longer passes identity safety checks: " + ", ".join(reasons or ["no face detected"]))
        redundant_bridge_ids = [
            ref_id
            for ref_id, ref in self.references.items()
            if self._person_key(ref.person_name) == self._person_key(person)
            and ref.synthetic_method_version == AGE_TRAJECTORY_METHOD_VERSION
            and normalize_age_bucket(ref.synthetic_target_age_bucket) == target
        ]
        for ref_id in redundant_bridge_ids:
            self.references.pop(ref_id, None)
        if redundant_bridge_ids:
            self._mark_references_deleted(redundant_bridge_ids)
        artifact_hash = str(artifact.get("artifact_hash", "") or "")
        ref = ReferenceFace(
            ref_id="ref_ageimg_" + artifact_hash[:16],
            person_name=person,
            age_bucket=target,
            source_path=str(generated_path),
            capture_date=None,
            quality=round(float(embedding.quality) * 0.75, 6),
            model_name=str(embedding.model_name),
            vector=list(embedding.vector),
            source_hash=generated_hash,
            pose_bucket=str(embedding.pose_bucket or "unknown"),
            capture_date_provenance=AGE_TRAJECTORY_REFERENCE_KIND,
            reference_kind=AGE_TRAJECTORY_REFERENCE_KIND,
            synthetic_method_version=IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
            synthetic_target_age_bucket=target,
            parent_ref_ids=[parent.ref_id],
            derivation_provenance={
                "schemaVersion": 1,
                "kind": "reviewed-ai-generated-age-image",
                "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                "reviewArtifactId": str(artifact["artifact_id"]),
                "reviewArtifactHash": artifact_hash,
                "generatedImage": True,
                "aiGenerated": True,
                "authenticCapture": False,
                "futureAppearancePrediction": False,
                "offlineInference": True,
                "targetAgeBucket": target,
                "parentReferenceIds": [parent.ref_id],
                "parentSourceHash": str(payload.get("parentSourceHash", "") or ""),
                "sourceFaceHash": str(payload.get("sourceFaceHash", "") or ""),
                "outputHash": generated_hash,
                "generation": dict(payload.get("generationProvenance", {})) if isinstance(payload.get("generationProvenance"), dict) else {},
                "approvalMetrics": metrics,
                "humanReviewed": True,
                "visualReviewAcknowledged": True,
                "reviewerRef": self._audit_person_ref(operator or self.actor),
                "approvedAt": now_iso(),
                "consent": dict(payload.get("consent", {})) if isinstance(payload.get("consent"), dict) else {},
            },
        )
        if not valid_reference(ref):
            raise ValueError("The reviewed synthetic age reference failed the saved-reference contract.")
        self.references[ref.ref_id] = ref
        self._mark_reference_dirty(ref.ref_id)
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        self._invalidate_reference_indexes()
        promoted_at = now_iso()
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "promoted", promoted_at=promoted_at)
        self._append_audit(
            {
                "action": "approve_synthetic_age_image_review",
                "artifactId": str(artifact["artifact_id"]),
                "artifactHash": artifact_hash,
                "refId": ref.ref_id,
                "personRef": self._audit_person_ref(person),
                "parentRefId": parent.ref_id,
                "targetAgeBucket": target,
                "generatedHash": generated_hash,
                "targetIdentityCosine": metrics.get("targetIdentityCosine"),
                "identityMargin": metrics.get("identityMargin"),
                "quality": metrics.get("quality"),
                "operatorRef": self._audit_person_ref(operator or self.actor),
                "removedEmbeddingBridgeReferences": len(redundant_bridge_ids),
            }
        )
        self.save()
        return {
            "approved": True,
            "artifactId": str(artifact["artifact_id"]),
            "artifactHash": artifact_hash,
            "refId": ref.ref_id,
            "reference": asdict(ref),
            "promotedAt": promoted_at,
            "metrics": metrics,
            "summary": self.synthetic_age_image_review_status(),
        }

    def reject_synthetic_age_image_review(self, artifact_id: str, *, reason: str = "") -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != SYNTHETIC_AGE_IMAGE_ARTIFACT_TYPE:
            raise ValueError("No synthetic age-image review is available for rejection.")
        if artifact.get("status") not in {"candidate", "staged"}:
            raise ValueError("Only candidate or staged synthetic age-image reviews can be rejected.")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        generated_path = str(payload.get("generatedPath", "") or "")
        if generated_path and not self._remove_synthetic_age_image_file(generated_path):
            raise OSError("The private synthetic age image could not be removed safely.")
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
        self._append_audit(
            {
                "action": "reject_synthetic_age_image_review",
                "artifactId": str(artifact["artifact_id"]),
                "artifactHash": str(artifact.get("artifact_hash", "") or ""),
                "personRef": self._audit_person_ref(str(payload.get("personName", "") or "")),
                "parentRefId": str(payload.get("parentRefId", "") or ""),
                "targetAgeBucket": str(payload.get("targetAgeBucket", "") or ""),
                "generatedHash": str(payload.get("generatedHash", "") or ""),
                "reason": str(reason or "")[:300],
            }
        )
        return {
            "rejected": True,
            "artifactId": str(artifact["artifact_id"]),
            "fileRemoved": not bool(generated_path and Path(generated_path).exists()),
            "summary": self.synthetic_age_image_review_status(),
        }

    def consent_summary(self) -> dict[str, Any]:
        subjects = self.subject_consents()
        preset = jurisdiction_preset(self.config.jurisdiction_preset) or {}
        valid_subjects = [
            record
            for record in subjects.values()
            if isinstance(record, dict)
            and record.get("active")
            and not release_is_expired(record)
            and release_is_complete(record, preset)
        ]
        return {
            "active": self.consent_on_file(),
            "recorded": bool(self.consent.get("active")),
            "operator": str(self.consent.get("operator", "")),
            "source": str(self.consent.get("source", "")),
            "scope": str(
                self.consent.get("scope")
                or self.workspace_metadata.get("workspaceId")
                or "workspace"
            ),
            "confirmedAt": self.consent.get("confirmedAt"),
            "updatedAt": self.consent.get("updatedAt"),
            "perSubjectConsent": bool(getattr(self.config, "per_subject_consent", False)),
            "subjectCount": len(subjects),
            "activeSubjectCount": sum(1 for record in subjects.values() if record.get("active")),
            "validSubjectCount": len(valid_subjects),
            "jurisdictionPreset": str(self.config.jurisdiction_preset),
            "aiDisclosure": self.ai_disclosure_status(),
        }

    def set_jurisdiction_preset(self, preset_id: str) -> dict[str, Any]:
        # Apply a per-jurisdiction CONSENT/RETENTION preset. Operator-configurable defaults
        # only; not legal advice (see crossage_fr.compliance.jurisdictions).
        from crossage_fr.compliance import jurisdiction_preset

        preset = jurisdiction_preset(preset_id)
        if preset is None:
            raise ValueError(f"Unknown jurisdiction preset: {preset_id!r}.")
        self.config.jurisdiction_preset = preset["id"]
        self.config.retention_reviewed_days = int(preset["retentionReviewedDays"])
        self.config.retention_pending_days = int(preset["retentionPendingDays"])
        self.config.retention_audit_days = int(preset["auditRetentionDays"])
        self.config.retention_enforcement_enabled = bool(preset["enforceByDefault"])
        self.config.require_consent = bool(preset["requireExplicitConsent"])
        self.config.per_subject_consent = bool(preset["perSubjectConsent"])
        self._append_audit(
            {
                "action": "set_jurisdiction_preset",
                "preset": preset["id"],
                "retentionReviewedDays": int(preset["retentionReviewedDays"]),
                "retentionPendingDays": int(preset["retentionPendingDays"]),
                "retentionAuditDays": int(preset["auditRetentionDays"]),
                "retentionEnforcementEnabled": bool(preset["enforceByDefault"]),
                "perSubjectConsent": bool(preset["perSubjectConsent"]),
            }
        )
        self.save()
        return {
            "preset": preset["id"],
            "label": preset["label"],
            "retentionReviewedDays": int(preset["retentionReviewedDays"]),
            "retentionPendingDays": int(preset["retentionPendingDays"]),
            "retentionAuditDays": int(preset["auditRetentionDays"]),
            "retentionEnforcementEnabled": bool(preset["enforceByDefault"]),
            "requireConsent": bool(preset["requireExplicitConsent"]),
            "perSubjectConsent": bool(preset["perSubjectConsent"]),
            "notes": preset["notes"],
        }

    def model_compatibility_report(self, active_model_name: str) -> dict[str, Any]:
        active = str(active_model_name or "").strip()
        counts: dict[str, int] = {}
        compatible = 0
        synthetic_total = 0
        stale_synthetic = 0
        for ref in self.references.values():
            model_name = str(ref.model_name or "").strip() or "unknown"
            counts[model_name] = counts.get(model_name, 0) + 1
            if self._compatible_reference_model_name(active, model_name):
                compatible += 1
            if is_synthetic_age_reference(ref):
                synthetic_total += 1
                if active and not self._compatible_reference_model_name(active, model_name):
                    stale_synthetic += 1
        pending = len(self._pending_backfill_references(active))
        return {
            "activeModelName": active,
            "compatibleReferences": compatible,
            "otherModelReferences": pending + stale_synthetic,
            "totalReferences": len(self.references),
            "syntheticAgeReferences": synthetic_total,
            "staleSyntheticAgeReferences": stale_synthetic,
            "modelCounts": counts,
            "needsBackfill": pending > 0 and bool(active),
            "needsAgeTrajectoryRebuild": stale_synthetic > 0 and bool(active),
            "message": (
                "Synthetic age references belong to another recognizer; rebuild them after refreshing the real saved photos."
                if stale_synthetic > 0
                else
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
        person_name: str = "",
        lawful_basis: str = "",
        release: dict[str, Any] | None = None,
    ) -> None:
        timestamp = now_iso()
        subjects = self.subject_consents()
        person = self._person_key(person_name)
        release_payload = dict(release or {}) if isinstance(release, dict) else {}
        preset = jurisdiction_preset(self.config.jurisdiction_preset) or jurisdiction_preset("standard") or {}
        if person:
            previous = bool(subjects.get(person, {}).get("active"))
            existing = dict(subjects.get(person, {}))
            if value and (preset.get("writtenReleaseRequired") or release_payload):
                release_payload.setdefault("note", note)
                record = build_release_record(
                    person_name=person_name,
                    source=source,
                    operator=operator,
                    lawful_basis=lawful_basis,
                    release=release_payload,
                    preset=preset,
                    existing=existing,
                )
            elif value:
                record = {
                    **existing,
                    "schemaVersion": CONSENT_SCHEMA_VERSION,
                    "active": True,
                    "personName": str(person_name).strip()[:200],
                    "source": str(source or "desktop")[:80],
                    "operator": operator[:120],
                    "note": note[:800],
                    "lawfulBasis": str(lawful_basis)[:200],
                    "jurisdictionPreset": str(preset.get("id", "standard")),
                    "confirmedAt": existing.get("confirmedAt") or timestamp,
                    "updatedAt": timestamp,
                    "releaseComplete": False,
                }
            else:
                record = {
                    **existing,
                    "schemaVersion": CONSENT_SCHEMA_VERSION,
                    "active": False,
                    "updatedAt": timestamp,
                    "revokedAt": timestamp,
                    "destructionRequired": True,
                }
            subjects[person] = record
            self.consent = {**self.consent, "schemaVersion": CONSENT_SCHEMA_VERSION, "subjects": subjects}
            audit_action = "set_subject_consent"
        elif value:
            disclosure_acknowledged = bool(release_payload.get("aiDisclosureAcknowledged"))
            if preset.get("writtenReleaseRequired") and not disclosure_acknowledged:
                raise ValueError("Acknowledge the current Vintrace AI and biometric processing notice before granting permission.")
            ai_disclosure = self.consent.get("aiDisclosure") if isinstance(self.consent.get("aiDisclosure"), dict) else {}
            if disclosure_acknowledged:
                ai_disclosure = {
                    "version": AI_DISCLOSURE_VERSION,
                    "acknowledged": True,
                    "acknowledgedAt": timestamp,
                    "operator": operator[:120],
                }
            self.consent = {
                **self.consent,
                "schemaVersion": CONSENT_SCHEMA_VERSION,
                "active": True,
                "workspaceId": self.workspace_metadata.get("workspaceId"),
                "source": source,
                "operator": operator[:120],
                "scope": (scope or str(self.workspace_metadata.get("workspaceId") or "workspace"))[:600],
                "note": note[:800],
                "confirmedAt": self.consent.get("confirmedAt") or timestamp,
                "updatedAt": timestamp,
                "subjects": subjects,
                "aiDisclosure": ai_disclosure,
            }
            previous = False
            audit_action = "set_consent"
        else:
            previous = self.consent_on_file()
            self.consent = {
                **self.consent,
                "schemaVersion": CONSENT_SCHEMA_VERSION,
                "active": False,
                "source": source,
                "operator": operator[:120],
                "scope": (scope or str(self.workspace_metadata.get("workspaceId") or "workspace"))[:600],
                "note": note[:800],
                "updatedAt": timestamp,
                "subjects": subjects,
            }
            audit_action = "set_consent"
        removed_age_trajectory_ids: list[str] = []
        if not value:
            removed_age_trajectory_ids = self._remove_age_trajectory_references(person_name=person_name)
        self._append_audit(
            {
                "action": audit_action,
                "value": bool(value),
                "previous": previous,
                "source": source,
                "scope": str(self.workspace_metadata.get("workspaceId") or "workspace"),
                "operatorRef": self._audit_person_ref(operator) if operator else "",
                "noteRecorded": bool(note or release_payload.get("note")),
                **(
                    {
                        "personRef": self._audit_person_ref(person_name),
                        "lawfulBasis": str(lawful_basis)[:200],
                        "releaseId": str(subjects.get(person, {}).get("releaseId", "")),
                        "releaseHash": str(subjects.get(person, {}).get("recordHash", "")),
                    }
                    if person
                    else {"aiDisclosureVersion": AI_DISCLOSURE_VERSION if release_payload.get("aiDisclosureAcknowledged") else ""}
                ),
                "removedSyntheticAgeReferences": len(removed_age_trajectory_ids),
            }
        )
        self.save()
        if person and not value:
            self.delete_subject_data(
                person_name,
                confirm=True,
                reason="subject-consent-revoked",
                source=source,
            )

    def enroll_folder(
        self,
        person_name: str,
        age_bucket: str,
        folder: Path,
        engine: EmbeddingEngine,
        recursive: bool = True,
        excluded_dirs: set[Path] | None = None,
    ) -> tuple[int, list[str], int]:
        person_name = person_name.strip()
        if not person_name:
            raise ValueError("A person name is required for enrollment.")
        added = 0
        reviews = 0
        errors: list[str] = []
        known_hashes = {
            (ref.source_hash or self._path_key(ref.source_path), self._person_key(ref.person_name))
            for ref in self.references.values()
        }
        # Enroll now honours the workspace exclusion rules (`.git`, `node_modules`,
        # size limits, ...) via the same hook the scan walk uses, so the subfolder
        # picker stays truthful for both flows. Benchmarks call iter_image_paths
        # without the hook and are unaffected.
        for path in iter_image_paths(
            folder,
            recursive=recursive,
            excluded_dirs=excluded_dirs,
            exclusion_reason=self.scan_exclusion_reason,
        ):
            count, held, error = self._enroll_one(path, person_name, age_bucket, engine, known_hashes)
            added += count
            reviews += held
            if error:
                errors.append(error)
        if added:
            removed = self._remove_age_trajectory_references(person_name=person_name)
            self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "enroll_folder",
                "person_name": person_name,
                "age_bucket": age_bucket,
                "folder": str(folder.expanduser()),
                "added": added,
                "synthetic_screen_reviews": reviews,
                "errors": len(errors),
                "invalidatedSyntheticAgeReferences": len(removed) if added else 0,
            }
        )
        self.save()
        return added, errors, reviews

    def _enroll_one(
        self,
        path: Path,
        person_name: str,
        age_bucket: str,
        engine: EmbeddingEngine,
        known_hashes: set[tuple[str, str]],
    ) -> tuple[int, int, str | None]:
        """Embed one image and store any qualifying faces as references.

        Shared by enroll_folder and enroll_paths. Returns
        (faces_added, faces_held_for_authenticity_review, error_or_None).
        De-duplicates by source hash and person via the caller-owned ``known_hashes`` set.
        """
        try:
            source_hash = sha256_file(path)
            known_key = (source_hash or self._path_key(path), self._person_key(person_name))
            if known_key in known_hashes:
                return 0, 0, None
            image = load_image(path)
            record = image_record_for_path(path, image=image, sha256=source_hash)
            embeddings, _cache_hit = self._embed_image_cached(path, engine, image=image, content_hash=source_hash)
            if not embeddings and self.config.two_pass_scan:
                embeddings, _rescue_cache_hit = self._embed_image_cached(
                    path,
                    engine,
                    image=image,
                    content_hash=source_hash,
                    cache_variant="rescue",
                )
            added = 0
            held = 0
            for face_index, embedding in enumerate(embeddings):
                if embedding.quality < self.config.thresholds.quality_min:
                    continue
                screen_result: SyntheticScreenResult | None = None
                screen_error = ""
                try:
                    screen_result = screen_enrollment_face(image, embedding.bbox)
                except Exception as exc:
                    # Fail closed into review. Enrollment remains usable when a
                    # model pack is missing, corrupt, or temporarily unable to
                    # run, but no face is silently described as screened.
                    screen_error = str(exc)[:600] or exc.__class__.__name__
                if screen_result is None or screen_result.flagged_for_review:
                    self._stage_synthetic_enrollment_review(
                        path=path,
                        person_name=person_name,
                        age_bucket=age_bucket,
                        record=record,
                        embedding=embedding,
                        face_index=face_index,
                        screen_result=screen_result,
                        screen_error=screen_error,
                    )
                    held += 1
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
                    capture_date_provenance=record.capture_date_provenance,
                    synthetic_screen_score=screen_result.stable_score,
                    synthetic_screen_original_score=screen_result.original_score,
                    synthetic_screen_recompressed_score=screen_result.recompressed_score,
                    synthetic_screen_threshold=screen_result.review_threshold,
                    synthetic_screen_model_id=screen_result.model_id,
                    synthetic_screen_model_version=screen_result.model_version,
                )
                self.references[ref.ref_id] = ref
                self._mark_reference_dirty(ref.ref_id)
                self.vector_store.add(ref.ref_id, ref.vector)
                added += 1
            known_hashes.add((record.sha256 or self._path_key(path), self._person_key(person_name)))
            return added, held, None
        except (ImageLoadError, OSError, ValueError) as exc:
            return 0, 0, f"{path.name}: {exc}"

    @staticmethod
    def _synthetic_enrollment_artifact_id(
        person_name: str,
        source_hash: str,
        bbox: tuple[int, int, int, int] | None,
        recognizer_model: str,
    ) -> str:
        body = json.dumps(
            {
                "person": ProjectState._person_key(person_name),
                "sourceHash": str(source_hash or ""),
                "bbox": list(bbox or ()),
                "recognizerModel": str(recognizer_model or ""),
                "screenVersion": SYNTHETIC_SCREEN_MODEL_VERSION,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "syn_enroll_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]

    def _stage_synthetic_enrollment_review(
        self,
        *,
        path: Path,
        person_name: str,
        age_bucket: str,
        record: Any,
        embedding: EmbeddingResult,
        face_index: int,
        screen_result: SyntheticScreenResult | None,
        screen_error: str = "",
    ) -> dict[str, Any]:
        base_artifact_id = self._synthetic_enrollment_artifact_id(
            person_name,
            str(record.sha256 or ""),
            embedding.bbox,
            embedding.model_name,
        )
        artifact_id = base_artifact_id
        for attempt in range(1, 1000):
            existing = self.db.learned_artifact_by_id(artifact_id)
            if existing is None:
                break
            if str(existing.get("status", "") or "") in {"candidate", "staged"}:
                return self._learned_artifact_status_payload(existing) or {}
            artifact_id = f"{base_artifact_id}_{attempt + 1}"
        else:
            raise ValueError("Too many finalized review attempts exist for this enrollment source.")
        reason = "score-threshold" if screen_result is not None else "screen-unavailable"
        payload: dict[str, Any] = {
            "personName": str(person_name)[:200],
            "ageBucket": str(age_bucket or "unknown")[:80],
            "sourcePath": str(path)[:4096],
            "sourceHash": str(record.sha256 or ""),
            "captureDate": record.capture_date,
            "captureDateProvenance": str(record.capture_date_provenance or "unknown"),
            "bbox": list(embedding.bbox or ()),
            "faceIndex": max(0, int(face_index)),
            "quality": round(float(embedding.quality or 0.0), 8),
            "poseBucket": str(embedding.pose_bucket or "unknown"),
            "recognizerModel": str(embedding.model_name or ""),
            "screenModelId": screen_result.model_id if screen_result else SYNTHETIC_SCREEN_MODEL_ID,
            "screenModelVersion": screen_result.model_version if screen_result else SYNTHETIC_SCREEN_MODEL_VERSION,
            "screenAvailable": screen_result is not None,
            "reviewReason": reason,
        }
        metrics: dict[str, Any] = {
            "quality": round(float(embedding.quality or 0.0), 8),
            "stableScore": round(float(screen_result.stable_score), 8) if screen_result else None,
            "originalScore": round(float(screen_result.original_score), 8) if screen_result else None,
            "recompressedScore": round(float(screen_result.recompressed_score), 8) if screen_result else None,
            "reviewThreshold": round(float(screen_result.review_threshold), 8) if screen_result else None,
            "screenAvailable": screen_result is not None,
        }
        artifact = self.db.upsert_learned_artifact(
            artifact_id,
            {
                "artifactType": "synthetic_enrollment_review",
                "status": "staged",
                "modelName": payload["screenModelId"],
                "versionKey": payload["screenModelVersion"],
                "trainingDataHash": str(record.sha256 or ""),
                "inputCount": 1,
                "positiveCount": 1 if reason == "score-threshold" else 0,
                "negativeCount": 0,
                "metrics": metrics,
                "payload": payload,
                "createdAt": now_iso(),
            },
        )
        self._append_audit(
            {
                "action": "stage_synthetic_enrollment_review",
                "artifact_id": artifact_id,
                "artifact_hash": artifact.get("artifactHash", ""),
                "person_ref": self._audit_person_ref(person_name),
                "source_hash": str(record.sha256 or ""),
                "recognizer_model": str(embedding.model_name or ""),
                "screen_model": payload["screenModelId"],
                "screen_version": payload["screenModelVersion"],
                "screen_available": screen_result is not None,
                "stable_score": metrics["stableScore"],
                "review_threshold": metrics["reviewThreshold"],
                "reason": reason,
                "screen_error_class": "unavailable" if screen_error else "",
            }
        )
        return {
            **artifact,
            "artifactType": "synthetic_enrollment_review",
            "metrics": metrics,
            "payload": payload,
        }

    def synthetic_enrollment_review_status(self, limit: int = 20) -> dict[str, Any]:
        safe_limit = max(1, min(100, int(limit or 20)))
        rows = self.db.learned_artifact_rows("synthetic_enrollment_review", limit=safe_limit)
        count_rows = self.db.learned_artifact_rows("synthetic_enrollment_review", limit=200)
        counts = {"staged": 0, "promoted": 0, "rejected": 0, "candidate": 0, "rolled_back": 0}
        for row in count_rows:
            status = str(row.get("status", "") or "")
            if status in counts:
                counts[status] += 1
        return {
            "model": synthetic_enrollment_screen_report(),
            "counts": counts,
            "artifacts": self._learned_artifact_status_payloads(rows),
            "truncated": len(count_rows) >= 200,
        }

    @staticmethod
    def _bbox_iou(
        first: tuple[int, int, int, int] | None,
        second: tuple[int, int, int, int] | None,
    ) -> float:
        if first is None or second is None:
            return 1.0 if first is None and second is None else 0.0
        left = max(int(first[0]), int(second[0]))
        top = max(int(first[1]), int(second[1]))
        right = min(int(first[2]), int(second[2]))
        bottom = min(int(first[3]), int(second[3]))
        intersection = max(0, right - left) * max(0, bottom - top)
        first_area = max(0, int(first[2]) - int(first[0])) * max(0, int(first[3]) - int(first[1]))
        second_area = max(0, int(second[2]) - int(second[0])) * max(0, int(second[3]) - int(second[1]))
        union = first_area + second_area - intersection
        return float(intersection / union) if union > 0 else 0.0

    def approve_synthetic_enrollment_review(
        self,
        artifact_id: str,
        engine: EmbeddingEngine,
        *,
        allow_synthetic_override: bool = False,
        operator: str = "",
    ) -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != "synthetic_enrollment_review":
            raise ValueError("No synthetic enrollment review is available for approval.")
        if artifact.get("status") != "staged":
            raise ValueError("Only staged synthetic enrollment reviews can be approved.")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        person_name = str(payload.get("personName", "") or "").strip()
        if not person_name:
            raise ValueError("Synthetic enrollment review is missing the person name.")
        if self.config.require_consent and not self.consent_for_person(person_name):
            raise PermissionError("Consent must remain active before an enrollment review can be approved.")
        source_path = Path(str(payload.get("sourcePath", "") or "")).expanduser()
        expected_hash = str(payload.get("sourceHash", "") or "")
        if not source_path.is_file() or not expected_hash:
            raise ValueError("The enrollment review source is no longer available.")
        actual_hash = sha256_file(source_path)
        if actual_hash != expected_hash:
            raise ValueError("The enrollment review source changed after staging; enroll it again.")
        if any(
            self._person_key(ref.person_name) == self._person_key(person_name)
            and str(ref.source_hash or "") == expected_hash
            for ref in self.references.values()
        ):
            raise ValueError("This source is already a saved reference for the person.")

        image = load_image(source_path)
        record = image_record_for_path(source_path, image=image, sha256=actual_hash)
        embeddings, _cache_hit = self._embed_image_cached(
            source_path,
            engine,
            image=image,
            content_hash=actual_hash,
        )
        eligible = [item for item in embeddings if item.quality >= self.config.thresholds.quality_min]
        if not eligible and self.config.two_pass_scan:
            rescued, _rescue_hit = self._embed_image_cached(
                source_path,
                engine,
                image=image,
                content_hash=actual_hash,
                cache_variant="rescue",
            )
            eligible = [item for item in rescued if item.quality >= self.config.thresholds.quality_min]
        if not eligible:
            raise ValueError("The staged face no longer passes enrollment quality checks.")
        raw_bbox = payload.get("bbox")
        expected_bbox = (
            tuple(int(value) for value in raw_bbox)
            if isinstance(raw_bbox, list) and len(raw_bbox) == 4
            else None
        )
        embedding = max(eligible, key=lambda item: (self._bbox_iou(item.bbox, expected_bbox), item.quality))
        bbox_overlap = self._bbox_iou(embedding.bbox, expected_bbox)
        if expected_bbox is not None and bbox_overlap < 0.20:
            raise ValueError("The staged face could not be matched reliably after re-detection.")

        screen_result: SyntheticScreenResult | None = None
        screen_error = ""
        try:
            screen_result = screen_enrollment_face(image, embedding.bbox)
        except Exception as exc:
            screen_error = str(exc)[:600] or exc.__class__.__name__
        needs_override = screen_result is None or screen_result.flagged_for_review
        if needs_override and not allow_synthetic_override:
            reason = "screen is unavailable" if screen_result is None else "score remains above the review threshold"
            raise ValueError(f"Explicit human override is required because the {reason}.")

        ref = ReferenceFace(
            ref_id=new_id("ref"),
            person_name=person_name,
            age_bucket=str(payload.get("ageBucket", "unknown") or "unknown"),
            source_path=str(source_path),
            capture_date=record.capture_date,
            quality=float(embedding.quality or 0.0),
            model_name=str(embedding.model_name or payload.get("recognizerModel", "") or ""),
            vector=list(embedding.vector),
            source_hash=actual_hash,
            pose_bucket=str(embedding.pose_bucket or payload.get("poseBucket", "unknown") or "unknown"),
            capture_date_provenance=record.capture_date_provenance,
            synthetic_screen_score=screen_result.stable_score if screen_result else None,
            synthetic_screen_original_score=screen_result.original_score if screen_result else None,
            synthetic_screen_recompressed_score=screen_result.recompressed_score if screen_result else None,
            synthetic_screen_threshold=(
                screen_result.review_threshold
                if screen_result
                else float((artifact.get("metrics") or {}).get("reviewThreshold") or 0.0) or None
            ),
            synthetic_screen_model_id=screen_result.model_id if screen_result else str(payload.get("screenModelId", SYNTHETIC_SCREEN_MODEL_ID)),
            synthetic_screen_model_version=screen_result.model_version if screen_result else str(payload.get("screenModelVersion", SYNTHETIC_SCREEN_MODEL_VERSION)),
            synthetic_screen_reviewed=True,
            synthetic_screen_human_override=needs_override,
        )
        self.references[ref.ref_id] = ref
        self._mark_reference_dirty(ref.ref_id)
        self.vector_store.add(ref.ref_id, ref.vector)
        invalidated_synthetic = len(self._remove_age_trajectory_references(person_name=person_name))
        self._invalidate_reference_indexes()
        promoted_at = now_iso()
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "promoted", promoted_at=promoted_at)
        self._append_audit(
            {
                "action": "approve_synthetic_enrollment_review",
                "artifact_id": str(artifact["artifact_id"]),
                "artifact_hash": str(artifact.get("artifact_hash", "") or ""),
                "ref_id": ref.ref_id,
                "person_ref": self._audit_person_ref(person_name),
                "source_hash": actual_hash,
                "recognizer_model": ref.model_name,
                "screen_model": ref.synthetic_screen_model_id,
                "screen_version": ref.synthetic_screen_model_version,
                "stable_score": ref.synthetic_screen_score,
                "review_threshold": ref.synthetic_screen_threshold,
                "human_override": needs_override,
                "screen_error_class": "unavailable" if screen_error else "",
                "bbox_iou": round(bbox_overlap, 6),
                "operator": str(operator or self.actor)[:120],
                "invalidated_synthetic_age_references": invalidated_synthetic,
            }
        )
        self.save()
        return {
            "approved": True,
            "artifactId": str(artifact["artifact_id"]),
            "artifactHash": str(artifact.get("artifact_hash", "") or ""),
            "refId": ref.ref_id,
            "reference": asdict(ref),
            "humanOverride": needs_override,
            "promotedAt": promoted_at,
            "summary": self.synthetic_enrollment_review_status(),
        }

    def reject_synthetic_enrollment_review(self, artifact_id: str, reason: str = "") -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != "synthetic_enrollment_review":
            raise ValueError("No synthetic enrollment review is available for rejection.")
        if artifact.get("status") not in {"candidate", "staged"}:
            raise ValueError("Only candidate or staged synthetic enrollment reviews can be rejected.")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
        self._append_audit(
            {
                "action": "reject_synthetic_enrollment_review",
                "artifact_id": str(artifact["artifact_id"]),
                "artifact_hash": str(artifact.get("artifact_hash", "") or ""),
                "person_ref": self._audit_person_ref(str(payload.get("personName", "") or "")),
                "source_hash": str(payload.get("sourceHash", "") or ""),
                "reason": str(reason or "")[:300],
            }
        )
        return {
            "rejected": True,
            "artifactId": str(artifact["artifact_id"]),
            "summary": self.synthetic_enrollment_review_status(),
        }

    def _expand_enroll_paths(self, paths: Iterable[str | Path], recursive: bool = True) -> list[Path]:
        """Turn a mixed list of file/folder paths into an ordered, de-duplicated
        list of image paths to enroll. Explicit image files are taken as-is;
        directories are walked (honoring the workspace exclusion rules, so junk
        dirs like ``.git`` are skipped); non-image files are dropped.
        """
        seen: set[str] = set()
        result: list[Path] = []

        def add(candidate: Path) -> None:
            key = str(safe_resolve(candidate))
            if key in seen:
                return
            seen.add(key)
            result.append(candidate)

        for raw in paths:
            path = Path(str(raw)).expanduser()
            try:
                is_dir = path.is_dir()
                is_file = path.is_file()
            except OSError:
                continue
            if is_dir:
                for image in iter_image_paths(path, recursive=recursive, exclusion_reason=self.scan_exclusion_reason):
                    add(image)
            elif is_file and path.suffix.lower() in IMAGE_EXTENSIONS:
                add(path)
        return result

    def enroll_paths(
        self,
        person_name: str,
        age_bucket: str,
        paths: Iterable[str | Path],
        engine: EmbeddingEngine,
        recursive: bool = True,
    ) -> tuple[int, list[str], int]:
        """Enroll reference faces from a list of individual files and/or folders.

        Powers the redesigned 'Add a person' flow (pick photos / drop / folder).
        """
        person_name = person_name.strip()
        if not person_name:
            raise ValueError("A person name is required for enrollment.")
        paths = list(paths)
        added = 0
        reviews = 0
        errors: list[str] = []
        known_hashes = {
            (ref.source_hash or self._path_key(ref.source_path), self._person_key(ref.person_name))
            for ref in self.references.values()
        }
        for path in self._expand_enroll_paths(paths, recursive=recursive):
            count, held, error = self._enroll_one(path, person_name, age_bucket, engine, known_hashes)
            added += count
            reviews += held
            if error:
                errors.append(error)
        if added:
            removed = self._remove_age_trajectory_references(person_name=person_name)
            self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "enroll_paths",
                "person_name": person_name,
                "age_bucket": age_bucket,
                "paths": len(paths),
                "added": added,
                "synthetic_screen_reviews": reviews,
                "errors": len(errors),
                "invalidatedSyntheticAgeReferences": len(removed) if added else 0,
            }
        )
        self.save()
        return added, errors, reviews

    def enroll_age_groups(
        self,
        person_name: str,
        groups: list[dict[str, str]],
        engine: EmbeddingEngine,
    ) -> tuple[int, list[str], int, int]:
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
        total_reviews = 0
        errors: list[str] = []
        enrolled_groups = 0
        for age_bucket, folder in selected:
            added, group_errors, reviews = self.enroll_folder(person_name, age_bucket, folder, engine)
            total_added += added
            total_reviews += reviews
            if added or reviews:
                enrolled_groups += 1
            errors.extend(f"{age_bucket}: {error}" for error in group_errors)
        self._append_audit(
            {
                "action": "enroll_age_groups",
                "person_name": person_name,
                "groups": enrolled_groups,
                "added": total_added,
                "synthetic_screen_reviews": total_reviews,
                "errors": len(errors),
            }
        )
        return total_added, errors, enrolled_groups, total_reviews

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
        changed_people: set[str] = set()
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
                # Normalize target_model through the same model-family key the
                # existing_keys set was built with (_reference_active_key ->
                # _model_family_key). Comparing a raw model string here against
                # normalized existing keys let the same source/person pair be
                # re-added as a duplicate reference.
                key = (source_hash or self._path_key(path), ref.person_name.casefold(), self._model_family_key(target_model))
                if key in existing_keys:
                    skipped += 1
                    processed += 1
                    continue
                record = image_record_for_path(path, image=image, sha256=source_hash)
                embeddings, _cache_hit = self._embed_image_cached(path, engine, image=image, content_hash=source_hash)
                if not embeddings and self.config.two_pass_scan:
                    embeddings, _rescue_cache_hit = self._embed_image_cached(
                        path,
                        engine,
                        image=image,
                        content_hash=source_hash,
                        cache_variant="rescue",
                    )
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
                        capture_date_provenance=(
                            record.capture_date_provenance if record.capture_date else ref.capture_date_provenance
                        ),
                    )
                    self.references[new_ref.ref_id] = new_ref
                    self._mark_reference_dirty(new_ref.ref_id)
                    self.vector_store.add(new_ref.ref_id, new_ref.vector)
                    # Normalize the model here too, so an intra-run duplicate is
                    # caught by the (now normalized) lookup key at the top of the
                    # loop — the initial set is built with _model_family_key.
                    existing_keys.add((record.sha256 or self._path_key(path), new_ref.person_name.casefold(), self._model_family_key(new_ref.model_name)))
                    added += 1
                    accepted += 1
                    changed_people.add(new_ref.person_name)
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
        invalidated_synthetic = 0
        for person_name in sorted(changed_people, key=str.casefold):
            invalidated_synthetic += len(self._remove_age_trajectory_references(person_name=person_name))
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
                "invalidated_synthetic_age_references": invalidated_synthetic,
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
            "invalidatedSyntheticAgeReferences": invalidated_synthetic,
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
        recursive: bool = True,
        excluded_dirs: set[Path] | None = None,
    ) -> tuple[int, list[str], dict[str, int]]:
        return self.scan_paths(
            self._iter_media_paths(folder, recursive=recursive, excluded_dirs=excluded_dirs),
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
        unmatched_spool: GlobalUnmatchedSpool | None = None
        unmatched_paths: set[Path] = set()
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
        metrics = {
            "total": int(total or 0),
            "processed": 0,
            "added": 0,
            "matched": 0,
            "clustered": 0,
            "skipped": 0,
            "errors": 0,
            "unmatched": 0,
            "clusterPasses": 0,
            "clusterModelGroups": 0,
            "clusterComponents": 0,
            "clusterUniqueInputs": 0,
            "clusterDuplicateInputs": 0,
            "clusterNoise": 0,
            "clusterSpoolPeak": 0,
            "safeFiltered": 0,
            "videoFiles": 0,
            "videoFrames": 0,
            "videoTrackObservations": 0,
            "videoTracks": 0,
            "videoTrackTemplates": 0,
            "videoTrackSingletons": 0,
            "videoTrackKeyframes": 0,
            "videoTrackMatches": 0,
            "videoTrackUnmatched": 0,
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
            "alignmentRecoveryAttempted": 0,
            "alignmentRecoverySucceeded": 0,
            "alignmentRecoveryRejected": 0,
            "fixedCohortPairs": 0,
            "fixedCohortFallbacks": 0,
            "fixedCohortDemotions": 0,
            "ageGapRelaxedReviews": 0,
            "syntheticAgeEvidence": 0,
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
            nonlocal added
            # There is deliberately no periodic path. Vectors live in SQLite until the
            # terminal flush, so changing discovery batch size cannot split identities.
            spool = unmatched_spool
            if not force or spool is None or spool.count == 0:
                return
            self._emit_scan_progress(on_progress, "clustering", metrics)
            groups = spool.groups()
            metrics["clusterPasses"] = 1
            metrics["clusterModelGroups"] = len(groups)
            metrics["clusterSpoolPeak"] = max(metrics["clusterSpoolPeak"], spool.peak_count)
            manifest_outcomes: dict[Path, tuple[int, str, str, str, str]] = {}

            def remember_manifest(
                path: Path,
                priority: int,
                status: str,
                phase: str,
                candidate_id: str,
                content_hash: str,
            ) -> None:
                previous = manifest_outcomes.get(path)
                if previous is None or priority >= previous[0]:
                    manifest_outcomes[path] = (priority, status, phase, candidate_id, content_hash)

            for group in groups:
                clustered_group = spool.cluster_group(group, self.config.cluster_min_size)
                metrics["clusterComponents"] += clustered_group.components
                metrics["clusterUniqueInputs"] += group.unique_rows
                metrics["clusterDuplicateInputs"] += group.rows - group.unique_rows
                for row in spool.iter_rows(group):
                    path = row.path
                    metadata = row.metadata
                    manifest_hash = str(metadata.get("source_hash") or "")
                    person_name = clustered_group.assignments.get(row.stable_key)
                    if person_name is None:
                        metrics["clusterNoise"] += 1
                        remember_manifest(path, 0, "completed", "unmatched", "", manifest_hash)
                        continue
                    key = (self._candidate_dedupe_source(path, metadata), None, person_name)
                    if candidate_key_exists(key):
                        metrics["duplicateCandidates"] += 1
                        remember_manifest(path, 1, "completed", "duplicate", "", manifest_hash)
                        continue
                    if not video_candidate_allowed(metadata):
                        metrics["skipped"] += 1
                        metrics["videoCandidateCap"] += 1
                        remember_manifest(path, 2, "completed", "video_candidate_cap", "", manifest_hash)
                        continue
                    candidate = ReviewCandidate(
                        candidate_id=new_id("cand"),
                        source_path=str(path),
                        person_name=person_name,
                        best_ref_id=None,
                        best_ref_path=None,
                        score=0.0,
                        band="clustered review",
                        quality=row.quality,
                        model_name=row.model_name,
                        note=_video_note(metadata) or "Grouped with visually similar unmatched media for manual triage.",
                        risk_flags=["video-track-template"] if metadata.get("video_track_id") else [],
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
                    remember_manifest(path, 3, "clustered", "candidate", candidate.candidate_id, manifest_hash)

            for path, (_priority, status, phase, candidate_id, content_hash) in manifest_outcomes.items():
                self._record_manifest_file(
                    run_id,
                    path,
                    status,
                    phase,
                    candidate_id,
                    scan_conn,
                    content_hash=content_hash,
                )
            unmatched_paths.clear()

        def prune_generated_video_frames(paths: Iterable[Path] | None = None) -> None:
            targets = {safe_resolve(path) for path in (paths or generated_video_frame_paths)}
            if not targets:
                return
            pending_frames = set()
            for pending_path in unmatched_paths:
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
                refresh_import_session=False,
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
            precomputed_embeddings: list[EmbeddingResult] | None = None,
            video_observations: list[VideoFaceObservation] | None = None,
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
            if "capture_date" not in metadata:
                _cap_date, _cap_prov = self._safe_capture_date_with_provenance(image_path, image=image, sha256=content_hash)
                metadata["capture_date"] = _cap_date
                metadata["capture_date_provenance"] = _cap_prov
            embeddings: list[EmbeddingResult] | None = (
                list(precomputed_embeddings) if precomputed_embeddings is not None else None
            )
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
                            refresh_import_session=False,
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
            if precomputed_embeddings is None:
                if cache_hit:
                    metrics["embeddingCacheHits"] += 1
                else:
                    metrics["embeddingCacheMisses"] += 1
            rescue_used = False
            if precomputed_embeddings is None and not embeddings and self.config.two_pass_scan:
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
                if precomputed_embeddings is None and embedding.alignment_attempts > 0:
                    metrics["alignmentRecoveryAttempted"] += 1
                    if embedding.alignment_rescued:
                        metrics["alignmentRecoverySucceeded"] += 1
                    else:
                        metrics["alignmentRecoveryRejected"] += 1
                if embedding.quality < self.config.thresholds.quality_min:
                    metrics["skipped"] += 1
                    metrics["lowQualityFaces"] += 1
                    low_quality_seen = True
                    continue
                pose_bucket = self._normalized_pose_bucket(embedding.pose_bucket)
                if precomputed_embeddings is None:
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
                if video_observations is not None:
                    try:
                        sharpness = face_crop_sharpness(image, embedding.bbox)
                    except (OSError, TypeError, ValueError):
                        sharpness = 0.0
                    video_observations.append(
                        VideoFaceObservation(
                            frame_path=image_path,
                            timestamp_ms=max(0, int(metadata.get("video_timestamp_ms", 0) or 0)),
                            frame_index=max(0, int(metadata.get("video_frame_index", 0) or 0)),
                            duration_ms=max(0, int(metadata.get("video_duration_ms", 0) or 0)),
                            frame_width=max(1, int(metadata.get("video_frame_width", getattr(image, "width", 1)) or 1)),
                            frame_height=max(1, int(metadata.get("video_frame_height", getattr(image, "height", 1)) or 1)),
                            embedding=embedding,
                            sharpness=max(0.0, float(sharpness)),
                        )
                    )
                    metrics["videoTrackObservations"] += 1
                    continue
                hits, compatible_refs = self._search_matching_references(embedding, k=k)
                pose_thresholds = thresholds_for_pose(self.config.thresholds, pose_bucket) if pose_review_supported(hits, compatible_refs, self.config.thresholds, pose_bucket) else self.config.thresholds
                # §5.3: per-person pooled-template cosines so a "confident" match that leaned
                # on one outlier reference (low template agreement) is demoted (precision-only).
                _templates = self._person_templates(embedding.model_name)
                _template_cosines = {p: template_cosine(embedding.vector, t) for p, t in _templates.items()} if _templates else None
                decision = group_hits(hits, compatible_refs, pose_thresholds, pose_bucket=pose_bucket, candidate_quality=embedding.quality, candidate_capture_date=embedding_metadata.get("capture_date"), candidate_align_error=embedding.align_error, candidate_template_cosines=_template_cosines)
                reference_capture_date = self._reference_capture_date(decision.best_ref_id) if decision is not None else None
                reference_capture_date_provenance = self._reference_capture_date_provenance(decision.best_ref_id) if decision is not None else None
                age_gap_years, age_gap_confidence, age_gap_flag = compute_age_gap(
                    embedding_metadata.get("capture_date"),
                    reference_capture_date,
                    candidate_provenance=embedding_metadata.get("capture_date_provenance", "unknown"),
                    reference_provenance=reference_capture_date_provenance,
                ) if decision is not None else (None, None, "")
                if decision is not None:
                    decision = self._apply_embedding_adapter_to_decision(
                        decision,
                        embedding,
                        pose_thresholds,
                        pose_bucket,
                        age_gap_years,
                        embedding_metadata,
                    )
                    decision = apply_verified_age_gap_review(
                        decision,
                        pose_thresholds,
                        age_gap_years,
                        age_gap_confidence,
                    )
                    if "verified-cross-age-threshold" in decision.flags:
                        metrics["ageGapRelaxedReviews"] += 1
                pair_context: dict[str, Any] = {}
                if decision is not None:
                    pair_context = self._pair_calibration_context(embedding, decision)
                    cohort_z = pair_context.get("cohortZ")
                    if cohort_z is None:
                        metrics["fixedCohortFallbacks"] += 1
                    else:
                        metrics["fixedCohortPairs"] += 1
                        previous_band = decision.band
                        decision = apply_cohort_separation(decision, pose_thresholds, float(cohort_z))
                        if decision.band != previous_band:
                            metrics["fixedCohortDemotions"] += 1
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
                if "synthetic-age-evidence" in decision_flags:
                    metrics["syntheticAgeEvidence"] += 1
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
                    if unmatched_spool is None:
                        raise RuntimeError("The global unmatched clustering spool is unavailable.")
                    unmatched_spool.add(
                        image_path,
                        embedding.quality,
                        embedding.model_name,
                        embedding.vector,
                        embedding_metadata,
                        embedding.bbox,
                    )
                    unmatched_paths.add(image_path)
                    metrics["unmatched"] += 1
                    metrics["clusterSpoolPeak"] = max(metrics["clusterSpoolPeak"], unmatched_spool.peak_count)
                    if rescue_used:
                        metrics["profileRescueUnmatched"] += 1
                    queued_unmatched = True
                    if metadata.get("video_track_id"):
                        metrics["videoTrackUnmatched"] += 1
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
                        refresh_import_session=False,
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
                    ("verified-cross-age-threshold", "Verified wide capture-date gap used the review-only cross-age threshold; verify carefully."),
                    ("synthetic-age-evidence", "A strong local synthetic age reference supported this result; compare the real parent photos."),
                ):
                    if flag in decision_flags:
                        candidate_note = self._append_candidate_note(candidate_note, message)
                        candidate_risk_flags = normalize_risk_flags(candidate_risk_flags, candidate_note)
                if pose_relaxed:
                    candidate_note = self._append_candidate_note(candidate_note, "Hard-pose review threshold used; verify carefully.")
                if rescue_used:
                    candidate_note = self._append_candidate_note(candidate_note, "Recovered by the side-face detector; review before accepting.")
                if embedding.alignment_rescued:
                    candidate_note = self._append_candidate_note(
                        candidate_note,
                        f"Face alignment was recovered using {embedding.alignment_strategy}; compare carefully.",
                    )
                    candidate_risk_flags = normalize_risk_flags(
                        [*candidate_risk_flags, "alignment-recovered"],
                        candidate_note,
                    )
                candidate_risk_flags = normalize_risk_flags(candidate_risk_flags, candidate_note)
                if age_gap_flag:
                    candidate_risk_flags = normalize_risk_flags(
                        [*candidate_risk_flags, age_gap_flag], candidate_note
                    )
                best_reference = self.references.get(decision.best_ref_id or "")
                if best_reference is not None and is_synthetic_age_reference(best_reference):
                    evidence_label = (
                        "A reviewed AI-generated age reference supported this result"
                        if is_generated_age_image_reference(best_reference)
                        else "A local synthetic age-trajectory embedding supported this result"
                    )
                    candidate_note = self._append_candidate_note(
                        candidate_note,
                        f"{evidence_label}; compare the real parent photos.",
                    )
                    candidate_risk_flags = normalize_risk_flags(
                        [*candidate_risk_flags, "synthetic-age-reference"], candidate_note
                    )
                if metadata.get("video_track_id"):
                    candidate_risk_flags = normalize_risk_flags(
                        [*candidate_risk_flags, "video-track-template"], candidate_note
                    )
                candidate_review_lane = review_lane(
                    band=decision.band,
                    align_error=embedding.align_error,
                    ied_px=embedding.ied_px,
                    quality=embedding.quality,
                )
                probability_detail = self.match_probability_detail(
                    decision.score,
                    embedding.model_name,
                    decision.person_name,
                    pair_center=pair_context.get("pairCenter"),
                    raw_cosine=decision.raw_cosine,
                )
                candidate_review_priority = review_priority(
                    lane=candidate_review_lane,
                    probability=probability_detail["probability"],
                    score=decision.score,
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
                    reference_capture_date_provenance=reference_capture_date_provenance,
                    age_gap_years=age_gap_years,
                    age_gap_confidence=age_gap_confidence,
                    raw_cosine=decision.raw_cosine,
                    align_error=embedding.align_error,
                    ied_px=embedding.ied_px,
                    review_lane=candidate_review_lane,
                    review_priority=candidate_review_priority,
                    calibrated_probability=probability_detail["probability"],
                    calibration_source=str(probability_detail["source"]),
                    calibration_version=str(probability_detail["version"]),
                    **embedding_metadata,
                )
                self.candidates[candidate.candidate_id] = candidate
                self._mark_candidate_dirty(candidate.candidate_id)
                if pair_context.get("pairCenter") and candidate.best_ref_id:
                    try:
                        self.db.upsert_candidate_match_context(
                            candidate.candidate_id,
                            candidate.best_ref_id,
                            candidate.model_name,
                            pair_context["pairCenter"],
                            pair_context.get("cohortZ"),
                            str(pair_context.get("cohortVersion", "")),
                            conn=scan_conn,
                        )
                    except (sqlite3.Error, TypeError, ValueError):
                        metrics["fixedCohortFallbacks"] += 1
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
                    refresh_import_session=False,
                )
                recorded_any = True
                added += 1
                metrics["added"] = added
                metrics["matched"] += 1
                if metadata.get("video_track_id"):
                    metrics["videoTrackMatches"] += 1
                if rescue_used:
                    metrics["profileRescueMatched"] += 1
                self._emit_scan_progress(
                    on_progress,
                    "candidate",
                    metrics,
                    current_path=str(image_path),
                    candidate_id=candidate.candidate_id,
                )
            if video_observations is not None and accepted:
                self.db.record_scan_file(
                    run_id,
                    image_path,
                    signature,
                    "completed",
                    phase="video_track_observation",
                    content_hash=content_hash,
                    conn=scan_conn,
                    refresh_import_session=False,
                )
                recorded_any = True
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
                if image_path in unmatched_paths:
                    self.db.record_scan_file(run_id, image_path, signature, "unmatched", phase="pending_cluster", content_hash=content_hash, conn=scan_conn, refresh_import_session=False)
            elif not recorded_any:
                self.db.record_scan_file(run_id, image_path, signature, "completed", phase="processed", content_hash=content_hash, conn=scan_conn, refresh_import_session=False)
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
            unmatched_spool = GlobalUnmatchedSpool(connection, run_id)
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
                        refresh_import_session=False,
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
                        self.db.record_scan_file(run_id, path, path_signature(path), "skipped", phase="excluded", message=exclusion_reason, conn=scan_conn, refresh_import_session=False)
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
                if SCAN_TEST_ITEM_DELAY_SECONDS:
                    time.sleep(SCAN_TEST_ITEM_DELAY_SECONDS)
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
                            refresh_import_session=False,
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
                                        refresh_import_session=False,
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
                        track_observations: list[VideoFaceObservation] = []
                        video_capture_date = self._media_mtime_date(path)
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
                                    "video_frame_width": sample.width,
                                    "video_frame_height": sample.height,
                                    "capture_date": video_capture_date,
                                    # §5.4: a video frame's date is the file mtime, not an EXIF
                                    # event date, so the age gap is always "estimated".
                                    "capture_date_provenance": "mtime",
                                },
                                apply_safe_mode=False,
                                video_observations=track_observations,
                            )
                        tracks = build_video_track_templates(track_observations, source_key=str(path))
                        metrics["videoTracks"] += len(tracks)
                        metrics["videoTrackTemplates"] += sum(1 for track in tracks if len(track.observations) >= 2)
                        metrics["videoTrackSingletons"] += sum(1 for track in tracks if len(track.observations) == 1)
                        metrics["videoTrackKeyframes"] += sum(len(track.keyframes) for track in tracks)
                        for track in tracks:
                            ensure_not_cancelled()
                            representative = track.representative
                            keyframes = list(track.keyframes)
                            total_weight = sum(max(0.05, float(item.embedding.quality)) for item in keyframes)

                            def weighted(field: str) -> float:
                                return sum(
                                    float(getattr(item.embedding, field, 0.0) or 0.0)
                                    * max(0.05, float(item.embedding.quality))
                                    for item in keyframes
                                ) / max(1e-9, total_weight)

                            pooled_embedding = EmbeddingResult(
                                vector=track.vector,
                                quality=track.quality,
                                bbox=representative.embedding.bbox,
                                model_name=track.model_name,
                                note=f"{VIDEO_TRACK_TEMPLATE_VERSION}:{track.track_id}",
                                pose_bucket=representative.embedding.pose_bucket,
                                quality_norm=weighted("quality_norm"),
                                det_score=weighted("det_score"),
                                ied_px=weighted("ied_px"),
                                fiqa_score=weighted("fiqa_score"),
                                align_error=weighted("align_error"),
                                alignment_rescued=any(item.embedding.alignment_rescued for item in keyframes),
                                alignment_strategy="track-keyframe-pool",
                                alignment_original_error=weighted("alignment_original_error"),
                                alignment_quality_gain=weighted("alignment_quality_gain"),
                                alignment_attempts=sum(int(item.embedding.alignment_attempts) for item in keyframes),
                            )
                            queue_image(
                                representative.frame_path,
                                image=load_image(representative.frame_path),
                                media_metadata={
                                    "media_kind": "video",
                                    "media_source_path": str(path),
                                    "video_timestamp_ms": representative.timestamp_ms,
                                    "video_frame_index": representative.frame_index,
                                    "video_duration_ms": representative.duration_ms,
                                    "video_track_id": track.track_id,
                                    "video_track_version": track.template_version,
                                    "video_track_start_ms": track.start_ms,
                                    "video_track_end_ms": track.end_ms,
                                    "video_track_frame_count": len(track.observations),
                                    "video_track_keyframe_timestamps_ms": [item.timestamp_ms for item in keyframes],
                                    "video_track_keyframe_indices": [item.frame_index for item in keyframes],
                                    "capture_date": video_capture_date,
                                    "capture_date_provenance": "mtime",
                                },
                                apply_safe_mode=False,
                                precomputed_embeddings=[pooled_embedding],
                            )
                        self.db.record_scan_file(run_id, path, signature, "completed", phase="video", content_hash=video_content_hash, conn=scan_conn, refresh_import_session=False)
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
                        self.db.record_scan_file(run_id, path, path_signature(path), "error", phase="error", message=str(exc), conn=scan_conn, refresh_import_session=False)
                    except OSError:
                        pass
                    self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=str(exc))
                finally:
                    metrics["processed"] += 1
                    self._emit_scan_progress(on_progress, "processed", metrics, current_path=str(path))
                    checkpoint(path)
            try:
                if final_status == "complete":
                    flush_unmatched(force=True)
                else:
                    unmatched_paths.clear()
                prune_generated_video_frames()
                checkpoint(Path(root_path or self.root), force=True)
            finally:
                unmatched_paths.clear()
                unmatched_spool.close()
                scan_conn = None
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
        processed = int(latest.get("processed", 0) or 0) if isinstance(latest, dict) else 0
        total = int(latest.get("total", 0) or 0) if isinstance(latest, dict) else 0
        errors = int(latest.get("errors", 0) or 0) if isinstance(latest, dict) else 0
        # A fatal discovery failure (for example, a missing root folder) has no
        # successful manifest work to resume. Offering Resume in that state only
        # repeats the same failure; partial error runs can still skip completed work.
        can_resume = bool(
            isinstance(latest, dict)
            and (
                latest_status in {"running", "cancelled"}
                or (latest_status == "error" and processed > errors)
            )
        )
        if self.pause_scan_path.exists():
            action = "Resume scan when ready."
        elif self.cancel_scan_path.exists():
            action = "Waiting for the current file to finish cancelling."
        elif active:
            action = "Scan is running."
        elif can_resume and processed:
            action = "Resume will skip completed files from the manifest."
        elif latest_status == "error":
            action = "Check that the scan source still exists and is readable before trying again."
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
            "referenceKind": ref.reference_kind,
            "syntheticMethodVersion": ref.synthetic_method_version,
            "syntheticTargetAgeBucket": ref.synthetic_target_age_bucket,
            "parentRefIds": list(ref.parent_ref_ids),
            "derivationProvenance": dict(ref.derivation_provenance),
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
        updated_candidates: list[ReviewCandidate] = []
        for candidate in self._iter_authoritative_candidates(statuses={"pending"}, order="review"):
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
            if self._candidate_index_backed:
                updated_candidates.append(candidate)
            else:
                self._mark_candidate_dirty(candidate.candidate_id)
            result["updated"] += 1
        if result["updated"]:
            if self._candidate_index_backed and updated_candidates:
                try:
                    self.db.upsert_candidates(updated_candidates)
                except sqlite3.Error:
                    for candidate in updated_candidates:
                        self.candidates[candidate.candidate_id] = candidate
                        self._mark_candidate_dirty(candidate.candidate_id)
                else:
                    for candidate in updated_candidates:
                        if candidate.candidate_id in self.candidates:
                            self.candidates[candidate.candidate_id] = candidate
                            self._loaded_candidate_payloads[candidate.candidate_id] = asdict(candidate)
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
        unique_ids = self._ensure_candidates_loaded(candidate_ids)
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
        # M11: capture per-candidate identity reassignments (PII-safe refs) so
        # the audit trail records WHICH candidates were moved between people, not
        # just an aggregate count.
        reassignments: list[dict[str, Any]] = []
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
                        best_pair_context: dict[str, Any] = {}
                        for embedding in embeddings:
                            if embedding.quality < self.config.thresholds.quality_min:
                                continue
                            hits, compatible_refs = self._search_matching_references(embedding, k=k)
                            decision = group_hits(hits, compatible_refs, self.config.thresholds)
                            if decision is None or decision.band == "below-review":
                                continue
                            pair_context = self._pair_calibration_context(embedding, decision)
                            if pair_context.get("cohortZ") is not None:
                                decision = apply_cohort_separation(
                                    decision,
                                    self.config.thresholds,
                                    float(pair_context["cohortZ"]),
                                )
                            if best_decision is None or decision.score > best_decision.score:
                                best_decision = decision
                                best_embedding = embedding
                                best_pair_context = pair_context
                        if best_decision is None or best_embedding is None:
                            metrics["downgraded"] += 1
                            candidate.note = self._append_candidate_note(candidate.note, "High-detail recheck could not confirm this match.")
                            self._mark_candidate_dirty(candidate.candidate_id)
                        elif (
                            best_decision.person_name != candidate.person_name
                            and self.config.require_consent
                            and not self.consent_for_person(best_decision.person_name)
                        ):
                            # M10: re-verification must not reassign a candidate to a
                            # person who lacks consent — that would bypass the same
                            # consent gate enforced on approval.
                            metrics["downgraded"] += 1
                            candidate.note = self._append_candidate_note(candidate.note, "High-detail recheck matched a person without recorded consent; not reassigned.")
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
                            candidate.raw_cosine = best_decision.raw_cosine
                            candidate.align_error = best_embedding.align_error
                            candidate.ied_px = best_embedding.ied_px
                            probability_detail = self.match_probability_detail(
                                candidate.score,
                                candidate.model_name,
                                candidate.person_name,
                                pair_center=best_pair_context.get("pairCenter"),
                                raw_cosine=candidate.raw_cosine,
                            )
                            candidate.calibrated_probability = probability_detail["probability"]
                            candidate.calibration_source = str(probability_detail["source"])
                            candidate.calibration_version = str(probability_detail["version"])
                            candidate.review_lane = review_lane(
                                band=candidate.band,
                                align_error=candidate.align_error,
                                ied_px=candidate.ied_px,
                                quality=candidate.quality,
                            )
                            candidate.review_priority = review_priority(
                                lane=candidate.review_lane,
                                probability=candidate.calibrated_probability,
                                score=candidate.score,
                            )
                            if best_pair_context.get("pairCenter") and candidate.best_ref_id:
                                self.db.upsert_candidate_match_context(
                                    candidate.candidate_id,
                                    candidate.best_ref_id,
                                    candidate.model_name,
                                    best_pair_context["pairCenter"],
                                    best_pair_context.get("cohortZ"),
                                    str(best_pair_context.get("cohortVersion", "")),
                                    conn=conn,
                                )
                            else:
                                self.db.delete_candidate_match_context(candidate.candidate_id, conn=conn)
                            self._mark_candidate_dirty(candidate.candidate_id)
                            current = (candidate.person_name, candidate.best_ref_id, round(candidate.score, 6), candidate.band)
                            if current != previous:
                                metrics["changed"] += 1
                                if previous[0] != candidate.person_name and len(reassignments) < 100:
                                    reassignments.append({
                                        "candidateId": candidate.candidate_id,
                                        "fromRef": self._audit_person_ref(previous[0]),
                                        "toRef": self._audit_person_ref(candidate.person_name),
                                        "band": candidate.band,
                                    })
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
        self._append_audit({
            "action": "verify_candidates",
            "count": metrics["verified"],
            "changed": metrics["changed"],
            "errors": metrics["errors"],
            "reassignments": reassignments,
        })
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
        version = str(getattr(engine, "model_name", "unknown"))
        detect_tag = str(getattr(engine, "detect_cache_tag", "") or "")
        alignment_tag = str(getattr(engine, "alignment_recovery_version", "") or "")
        return "|".join(part for part in (version, detect_tag, alignment_tag) if part)

    def _embedding_detector_size(self, engine: EmbeddingEngine) -> int:
        return int(getattr(engine, "detector_size", self.config.face_detector_size))

    def _embedding_cache_row(self, embedding: EmbeddingResult) -> dict[str, Any]:
        return {
            "vector": embedding.vector,
            "quality": embedding.quality,
            "qualityNorm": embedding.quality_norm,
            "detScore": embedding.det_score,
            "iedPx": embedding.ied_px,
            "fiqaScore": embedding.fiqa_score,
            "alignError": embedding.align_error,
            "alignmentRescued": embedding.alignment_rescued,
            "alignmentStrategy": embedding.alignment_strategy,
            "alignmentOriginalError": embedding.alignment_original_error,
            "alignmentQualityGain": embedding.alignment_quality_gain,
            "alignmentAttempts": embedding.alignment_attempts,
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
            quality_norm=float(row.get("qualityNorm", 0.0) or 0.0),
            det_score=float(row.get("detScore", 0.0) or 0.0),
            ied_px=float(row.get("iedPx", 0.0) or 0.0),
            fiqa_score=float(row.get("fiqaScore", 0.0) or 0.0),
            align_error=float(row.get("alignError", 0.0) or 0.0),
            alignment_rescued=bool(row.get("alignmentRescued", False)),
            alignment_strategy=str(row.get("alignmentStrategy", "") or ""),
            alignment_original_error=float(row.get("alignmentOriginalError", 0.0) or 0.0),
            alignment_quality_gain=float(row.get("alignmentQualityGain", 0.0) or 0.0),
            alignment_attempts=int(row.get("alignmentAttempts", 0) or 0),
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
            if metadata.get("video_track_id"):
                return str(path)
            return str(metadata["media_source_path"])
        source_hash = str(metadata.get("source_hash", "")).strip()
        if source_hash:
            return f"sha256:{source_hash}"
        return str(path)

    def _candidate_existing_key(self, candidate: ReviewCandidate) -> tuple[str, str | None, str]:
        if candidate.media_kind == "video" and candidate.media_source_path:
            source_path = candidate.source_path if candidate.video_track_id else candidate.media_source_path
        elif candidate.source_hash:
            source_path = f"sha256:{candidate.source_hash}"
        else:
            source_path = candidate.source_path
        return (source_path, candidate.best_ref_id, candidate.person_name)

    def _iter_media_paths(
        self,
        folder: Path,
        recursive: bool = True,
        excluded_dirs: set[Path] | None = None,
    ) -> Iterable[Path | ScanDiscoveryError]:
        root = safe_resolve(folder)
        media_extensions = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
        excluded = excluded_dirs or set()
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
                                if not recursive:
                                    continue
                                if excluded and safe_resolve(path) in excluded:
                                    continue
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
                refresh_import_session=False,
            )
        except OSError:
            pass

    def _safety_cache_version(self) -> str:
        report = safety_model_report(multimodal_enabled=self.config.safe_mode_multimodal)
        path_text = str(report.get("path") or "").strip()
        path = Path(path_text) if path_text else None
        parts = [str(report.get("engine", "heuristic")), str(report.get("modelName", "unknown"))]
        if report.get("cacheVersion"):
            parts.append(str(report["cacheVersion"]))
        try:
            temperature = float(self.config.safe_mode_temperature)
        except (TypeError, ValueError):
            temperature = 1.0
        parts.append(f"temperature:{temperature:.6g}")
        parts.append(f"multimodal:{int(bool(self.config.safe_mode_multimodal))}")
        try:
            if path is not None and path.exists():
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
            assessment = SafetyAssessment(
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
                category_scores={
                    str(key).removeprefix("policy:"): float(value)
                    for key, value in dict(cached.get("labels", {})).items()
                    if str(key).startswith("policy:")
                },
            )
        else:
            assessment = assess_image_safety(
                path,
                self.config.safe_mode_threshold,
                image=image,
                temperature=self.config.safe_mode_temperature,
                multimodal=self.config.safe_mode_multimodal,
            )
            if not assessment.engine.endswith("fallback"):
                self.db.safety_store(content_hash, model_version, self.config.safe_mode_threshold, assessment, conn)
        # A per-item user override from the review dashboard wins over the classifier's
        # verdict, so a corrected false positive stays corrected across re-scans.
        override = self.db.safe_mode_override_for(content_hash, conn)
        effective = apply_safe_mode_override(assessment.sensitive, override)
        if effective != assessment.sensitive:
            assessment = replace(assessment, sensitive=effective)
        return assessment, content_hash

    def _candidate_file_hash(self, candidate: ReviewCandidate) -> str:
        file_hash = str(candidate.source_hash or "").strip()
        if file_hash:
            return file_hash
        try:
            return sha256_file(Path(candidate.source_path))
        except Exception:
            return ""

    def _candidate_embedding_key(self, candidate: ReviewCandidate, file_hash: str) -> str:
        model_name = str(candidate.model_name or "").strip()
        if not file_hash or not model_name:
            return ""
        return f"sha256:{file_hash}|model:{model_name}|detector:{int(self.config.face_detector_size)}"

    def _record_review_learning_example(
        self,
        candidate: ReviewCandidate,
        status: str,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, str]:
        """Persist the current accepted/rejected review as calibration + adapter input."""
        if status not in {"accepted", "rejected"}:
            try:
                self.db.delete_training_examples_for_candidates([candidate.candidate_id], conn=conn)
            except sqlite3.Error:
                pass
            return {"labelId": "", "exampleId": ""}
        file_hash = self._candidate_file_hash(candidate)
        is_match = status == "accepted"
        label_id = new_id("label")
        pair_context = self.db.candidate_match_context(
            candidate.candidate_id,
            best_ref_id=str(candidate.best_ref_id or ""),
            model_name=str(candidate.model_name or ""),
            conn=conn,
        )
        cohort_version = str(pair_context.get("cohortVersion", "") or "") if pair_context else ""
        self.db.add_calibration_label(
            label_id,
            {
                "sourcePath": candidate.source_path,
                "fileHash": file_hash,
                "expectedPerson": candidate.person_name,
                "actualPerson": candidate.person_name if is_match else "",
                "matchScore": candidate.score,
                "isMatch": is_match,
                "poseBucket": candidate.pose_bucket,
                "mediaKind": candidate.media_kind,
                "ageGapYears": candidate.age_gap_years,
                "rawCosine": candidate.raw_cosine,
                "modelName": candidate.model_name,
                "bestRefId": candidate.best_ref_id or "",
                "pairCenter": pair_context.get("pairCenter") if pair_context else None,
                "cohortZ": pair_context.get("cohortZ") if pair_context else None,
                "contextVersion": f"adaptive-pair-v1|{cohort_version or 'cohort-unavailable'}" if pair_context else "",
            },
            conn=conn,
        )
        reference = self.references.get(str(candidate.best_ref_id or ""))
        features = {
            "band": candidate.band,
            "matchScore": candidate.score,
            "rawCosine": candidate.raw_cosine,
            "quality": candidate.quality,
            "poseBucket": candidate.pose_bucket,
            "ageGapYears": candidate.age_gap_years,
            "alignError": candidate.align_error,
            "iedPx": candidate.ied_px,
            "reviewPriority": candidate.review_priority,
            "reviewLane": candidate.review_lane,
            "calibratedProbability": candidate.calibrated_probability,
            "calibrationSource": candidate.calibration_source,
            "calibrationVersion": candidate.calibration_version,
            "cohortZ": pair_context.get("cohortZ") if pair_context else None,
            "cohortVersion": cohort_version,
            "riskFlags": list(candidate.risk_flags),
            "videoTimestampMs": candidate.video_timestamp_ms,
        }
        example_id = new_id("train")
        self.db.add_training_example(
            example_id,
            {
                "labelId": label_id,
                "candidateId": candidate.candidate_id,
                "sourcePath": candidate.source_path,
                "sourceHash": file_hash,
                "expectedPerson": candidate.person_name,
                "actualPerson": candidate.person_name if is_match else "",
                "isMatch": is_match,
                "matchScore": candidate.score,
                "rawCosine": candidate.raw_cosine,
                "quality": candidate.quality,
                "modelName": candidate.model_name,
                "detectorSize": int(self.config.face_detector_size),
                "candidateEmbeddingKey": self._candidate_embedding_key(candidate, file_hash),
                "bestRefId": candidate.best_ref_id or "",
                "bestRefPath": candidate.best_ref_path or "",
                "referenceModelName": reference.model_name if reference else "",
                "poseBucket": candidate.pose_bucket,
                "ageGapYears": candidate.age_gap_years,
                "alignError": candidate.align_error,
                "iedPx": candidate.ied_px,
                "mediaKind": candidate.media_kind,
                "features": features,
            },
            conn=conn,
        )
        return {"labelId": label_id, "exampleId": example_id}

    def set_candidate_status(self, candidate_id: str, status: str) -> dict[str, Any] | None:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        candidate = self._candidate_or_raise(candidate_id)
        previous = {
            "status": candidate.status,
            "personName": candidate.person_name,
            "score": candidate.score,
            "quality": candidate.quality,
            "band": candidate.band,
            "bestRefId": candidate.best_ref_id or "",
            "bestRefPath": candidate.best_ref_path or "",
            "note": candidate.note,
        }
        operation_snapshot = self.db.review_candidate_correction_undo_snapshot(candidate=candidate)
        candidate.status = status
        self._mark_candidate_dirty(candidate_id)
        learning = self._record_review_learning_example(candidate, status)
        self._append_audit(
            {
                "action": "set_candidate_status",
                "candidate_id": candidate_id,
                "status": status,
                "source_path": candidate.source_path,
                "person_name": candidate.person_name,
                "score": candidate.score,
                "band": candidate.band,
                "label_id": learning.get("labelId", ""),
                "training_example_id": learning.get("exampleId", ""),
            }
        )
        self.save()
        if previous["status"] == status:
            return None
        status_label = {
            "pending": "Needs review",
            "accepted": "Accepted",
            "rejected": "Rejected",
            "uncertain": "Not sure",
        }.get(status, status)
        operation = self.db.record_review_candidate_correction_operation(
            operation_type="review_candidate_decision",
            label=f"Marked {candidate.person_name} review as {status_label}",
            candidate_id=candidate_id,
            snapshot=operation_snapshot,
            affected_count=1,
            payload={
                "action": "set_candidate_status",
                "personName": previous["personName"],
                "sourcePath": candidate.source_path,
                "sourceFilename": Path(candidate.source_path).name,
                "statusBefore": previous["status"],
                "statusAfter": candidate.status,
                "scoreBefore": previous["score"],
                "scoreAfter": candidate.score,
                "qualityBefore": previous["quality"],
                "qualityAfter": candidate.quality,
                "bandBefore": previous["band"],
                "bandAfter": candidate.band,
                "bestRefIdBefore": previous["bestRefId"],
                "bestRefIdAfter": candidate.best_ref_id or "",
                "bestRefPathBefore": previous["bestRefPath"],
                "bestRefPathAfter": candidate.best_ref_path or "",
                "noteBefore": previous["note"],
                "noteAfter": candidate.note,
                "labelId": learning.get("labelId", ""),
                "trainingExampleId": learning.get("exampleId", ""),
            },
        )
        return operation

    def set_candidate_note(self, candidate_id: str, note: str) -> None:
        candidate = self._candidate_or_raise(candidate_id)
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

    def _unique_candidate_ids_or_raise(self, candidate_ids: Iterable[str], field_name: str = "candidate_ids") -> list[str]:
        unique_ids = list(dict.fromkeys(str(candidate_id or "").strip() for candidate_id in candidate_ids if str(candidate_id or "").strip()))
        if not unique_ids:
            raise ValueError(f"{field_name} must contain at least one candidate id.")
        self._ensure_candidates_loaded(unique_ids)
        missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
        if missing:
            raise KeyError(f"Candidate not found: {missing[0]}")
        return unique_ids

    def _block_false_match(
        self,
        candidate_id: str,
        note: str = "",
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        candidate = self._candidate_or_raise(candidate_id)
        file_hash = candidate.source_hash
        if not file_hash:
            try:
                file_hash = sha256_file(Path(candidate.source_path))
            except Exception:
                file_hash = ""
        if not file_hash:
            raise ValueError("This match cannot be blocked because its file hash is unavailable.")
        best_ref_id = candidate.best_ref_id or ""
        blocked_pair_rows = [
            {
                "fileHash": file_hash,
                "personName": candidate.person_name,
                "bestRefId": best_ref_id,
            }
        ]
        if best_ref_id:
            blocked_pair_rows.append(
                {
                    "fileHash": file_hash,
                    "personName": candidate.person_name,
                    "bestRefId": "",
                }
            )
        operation_snapshot = self.db.review_candidate_correction_undo_snapshot(
            candidate=candidate,
            blocked_pairs=blocked_pair_rows,
            conn=conn,
        )
        self.db.add_blocked_pair(
            {
                "fileHash": file_hash,
                "personName": candidate.person_name,
                "bestRefId": best_ref_id,
                "sourcePath": candidate.source_path,
                "note": note or "Rejected from review as a repeated false match.",
            },
            conn=conn,
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
                },
                conn=conn,
            )
            blocked_count += 1
        candidate.status = "rejected"
        candidate.note = self._append_candidate_note(candidate.note, "Do not suggest this image/person pair again.")
        self._mark_candidate_dirty(candidate_id)
        learning = self._record_review_learning_example(candidate, "rejected", conn=conn)
        self._append_audit(
            {
                "action": "block_false_match",
                "candidate_id": candidate_id,
                "source_path": candidate.source_path,
                "personRef": self._audit_person_ref(candidate.person_name),
                "best_ref_id": best_ref_id,
                "blocked_rows": blocked_count,
                "label_id": learning.get("labelId", ""),
                "training_example_id": learning.get("exampleId", ""),
            }
        )
        operation = self.db.record_review_candidate_correction_operation(
            operation_type="person_match_remove",
            label=f"Removed {operation_snapshot.get('candidate', {}).get('person_name', candidate.person_name)} from photo match",
            candidate_id=candidate_id,
            snapshot=operation_snapshot,
            affected_count=1 + blocked_count,
            payload={
                "action": "block_false_match",
                "personName": operation_snapshot.get("candidate", {}).get("person_name", candidate.person_name),
                "sourcePath": candidate.source_path,
                "sourceFilename": Path(candidate.source_path).name,
                "statusBefore": operation_snapshot.get("candidate", {}).get("status", ""),
                "statusAfter": candidate.status,
                "scoreBefore": operation_snapshot.get("candidate", {}).get("score", 0.0),
                "qualityBefore": operation_snapshot.get("candidate", {}).get("quality", 0.0),
                "bandBefore": operation_snapshot.get("candidate", {}).get("band", ""),
                "bandAfter": candidate.band,
                "bestRefIdBefore": operation_snapshot.get("candidate", {}).get("best_ref_id", "") or "",
                "bestRefPathBefore": operation_snapshot.get("candidate", {}).get("best_ref_path", "") or "",
                "noteBefore": operation_snapshot.get("candidate", {}).get("note", ""),
                "noteAfter": candidate.note,
                "blockedRows": blocked_count,
            },
            conn=conn,
        )
        return {"candidateId": candidate_id, "blocked": blocked_count, "operation": operation}

    def block_false_match(self, candidate_id: str, note: str = "") -> dict[str, Any]:
        with self.db.connect() as conn:
            result = self._block_false_match(candidate_id, note, conn=conn)
        self.save()
        result["summary"] = self.db.blocked_pairs_summary(limit=5)
        return result

    def bulk_block_false_matches(self, candidate_ids: list[str], note: str = "") -> dict[str, Any]:
        unique_ids = self._unique_candidate_ids_or_raise(candidate_ids)
        with self.db.connect() as conn:
            results = [self._block_false_match(candidate_id, note, conn=conn) for candidate_id in unique_ids]
        self.save()
        return {
            "updated": len(results),
            "blocked": sum(int(result.get("blocked", 0) or 0) for result in results),
            "results": results,
            "summary": self.db.blocked_pairs_summary(limit=5),
        }

    def _reassign_candidate_person(
        self,
        candidate_id: str,
        person_name: str,
        clear_reference: bool = True,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        target = person_name.strip()
        if not target:
            raise ValueError("Choose the person this match belongs to.")
        candidate = self._candidate_or_raise(candidate_id)
        operation_snapshot = self.db.review_candidate_correction_undo_snapshot(candidate=candidate, conn=conn)
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
        candidate.calibrated_probability = None
        candidate.calibration_source = ""
        candidate.calibration_version = ""
        candidate.review_lane = review_lane(
            band=candidate.band,
            align_error=candidate.align_error,
            ied_px=candidate.ied_px,
            quality=candidate.quality,
        )
        candidate.review_priority = review_priority(
            lane=candidate.review_lane,
            probability=None,
            score=candidate.score,
        )
        self.db.delete_candidate_match_context(candidate_id, conn=conn)
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
        operation = self.db.record_review_candidate_correction_operation(
            operation_type="person_match_reassign",
            label=f"Moved match from {previous['personName']} to {target}",
            candidate_id=candidate_id,
            snapshot=operation_snapshot,
            affected_count=1,
            payload={
                "action": "reassign_candidate_person",
                "sourcePath": candidate.source_path,
                "sourceFilename": Path(candidate.source_path).name,
                "oldPersonName": previous["personName"],
                "newPersonName": target,
                "oldStatus": previous["status"],
                "newStatus": candidate.status,
                "oldScore": previous["score"],
                "newScore": candidate.score,
                "oldBand": previous["band"],
                "newBand": candidate.band,
                "oldBestRefId": previous["bestRefId"] or "",
                "newBestRefId": candidate.best_ref_id or "",
                "oldBestRefPath": previous["bestRefPath"] or "",
                "newBestRefPath": candidate.best_ref_path or "",
                "clearReference": bool(clear_reference),
            },
            conn=conn,
        )
        return {"candidateId": candidate_id, "previous": previous, "personName": target, "operation": operation}

    def reassign_candidate_person(self, candidate_id: str, person_name: str, clear_reference: bool = True) -> dict[str, Any]:
        with self.db.connect() as conn:
            result = self._reassign_candidate_person(
                candidate_id,
                person_name,
                clear_reference=clear_reference,
                conn=conn,
            )
        self.save()
        return result

    def bulk_reassign_candidate_person(
        self,
        candidate_ids: list[str],
        person_name: str,
        clear_reference: bool = True,
    ) -> dict[str, Any]:
        target = person_name.strip()
        if not target:
            raise ValueError("Choose the person this match belongs to.")
        unique_ids = self._unique_candidate_ids_or_raise(candidate_ids)
        with self.db.connect() as conn:
            results = [
                self._reassign_candidate_person(
                    candidate_id,
                    target,
                    clear_reference=clear_reference,
                    conn=conn,
                )
                for candidate_id in unique_ids
            ]
        self.save()
        return {"updated": len(results), "personName": target, "results": results}

    def bulk_set_candidate_status(self, candidate_ids: list[str], status: str) -> int:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        unique_ids = self._unique_candidate_ids_or_raise(candidate_ids)
        learning_examples = 0
        with self.db.connect() as conn:
            for candidate_id in unique_ids:
                candidate = self.candidates[candidate_id]
                candidate.status = status
                learning = self._record_review_learning_example(candidate, status, conn=conn)
                if learning.get("exampleId"):
                    learning_examples += 1
        self._mark_candidates_dirty(unique_ids)
        self._append_audit(
            {
                "action": "bulk_set_candidate_status",
                "status": status,
                "count": len(unique_ids),
                "candidate_ids": unique_ids[:40],
                "training_examples": learning_examples,
            }
        )
        self.save()
        return len(unique_ids)

    def _vector_cosine(self, left: list[float], right: list[float]) -> float:
        if not left or not right or len(left) != len(right):
            return 0.0
        dot = 0.0
        left_norm = 0.0
        right_norm = 0.0
        for left_value, right_value in zip(left, right):
            try:
                a = float(left_value)
                b = float(right_value)
            except (TypeError, ValueError):
                return 0.0
            dot += a * b
            left_norm += a * a
            right_norm += b * b
        if left_norm <= 0.0 or right_norm <= 0.0:
            return 0.0
        return dot / math.sqrt(left_norm * right_norm)

    def _reference_suggestion_training_hash(self, payload: dict[str, Any]) -> str:
        body = {
            "candidateId": str(payload.get("candidateId", "") or ""),
            "personName": str(payload.get("personName", "") or ""),
            "sourceHash": str(payload.get("sourceHash", "") or ""),
            "modelName": str(payload.get("modelName", "") or ""),
            "versionKey": "suggested-reference-v1",
        }
        return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _suggested_reference_artifact_candidate_ids(self) -> set[str]:
        result: set[str] = set()
        for artifact in self.db.learned_artifact_rows("suggested_reference", limit=200):
            if str(artifact.get("status", "")) not in {"staged", "promoted"}:
                continue
            payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
            candidate_id = str(payload.get("candidateId", payload.get("candidate_id", "")) or "")
            if candidate_id:
                result.add(candidate_id)
        return result

    def reference_suggestion_candidates(self, limit: int = 80) -> list[ReviewCandidate]:
        existing = self._suggested_reference_artifact_candidate_ids()
        candidates = [
            candidate
            for candidate in self._iter_authoritative_candidates(statuses={"accepted"}, order="score")
            if candidate.candidate_id not in existing
        ]
        candidates.sort(key=lambda item: (-float(item.score), -float(item.quality), str(item.created_at), item.candidate_id))
        return candidates[: max(1, min(500, int(limit or 80)))]

    def _evaluate_reference_suggestion(
        self,
        candidate: ReviewCandidate,
        embedding: EmbeddingResult,
        expected_source_hash: str = "",
    ) -> dict[str, Any]:
        reasons: list[str] = []
        source = Path(candidate.source_path).expanduser()
        file_hash = candidate.source_hash or ""
        if source.exists() and not file_hash:
            try:
                file_hash = sha256_file(source)
            except Exception:
                file_hash = ""
        if not source.exists():
            reasons.append("missing-source")
        if expected_source_hash and file_hash and file_hash != expected_source_hash:
            reasons.append("source-changed")
        if candidate.status != "accepted":
            reasons.append("not-accepted")
        if self.config.require_consent and not self.consent_for_person(candidate.person_name):
            reasons.append("consent-required")
        embedding_model = str(embedding.model_name or candidate.model_name or "").strip()
        if candidate.model_name and embedding_model and not self._compatible_reference_model_name(candidate.model_name, embedding_model):
            reasons.append("model-mismatch")
        score_min = float(self.config.thresholds.likely)
        if float(candidate.score) < score_min:
            reasons.append("score-too-low")
        quality = max(float(candidate.quality or 0.0), float(embedding.quality or 0.0))
        if quality < self.REFERENCE_SUGGESTION_MIN_QUALITY:
            reasons.append("quality-too-low")
        align_error = float(embedding.align_error or candidate.align_error or 0.0)
        if align_error and align_error > self.REFERENCE_SUGGESTION_MAX_ALIGN_ERROR:
            reasons.append("alignment-too-high")
        ied_px = float(embedding.ied_px or candidate.ied_px or 0.0)
        if ied_px and ied_px < self.REFERENCE_SUGGESTION_MIN_IED_PX:
            reasons.append("face-too-small")
        same_person_refs = [
            ref
            for ref in self.references.values()
            if ref.person_name.casefold() == candidate.person_name.casefold()
            and self._compatible_reference_model_name(embedding_model, ref.model_name)
        ]
        if not same_person_refs:
            reasons.append("no-compatible-reference")
        duplicate_source = bool(file_hash and any(ref.source_hash == file_hash for ref in same_person_refs))
        if duplicate_source:
            reasons.append("duplicate-source")
        best_ref_id = ""
        best_ref_cosine = 0.0
        for ref in same_person_refs:
            cosine = self._vector_cosine(embedding.vector, ref.vector)
            if cosine > best_ref_cosine:
                best_ref_cosine = cosine
                best_ref_id = ref.ref_id
        if same_person_refs and best_ref_cosine >= self.REFERENCE_SUGGESTION_DUPLICATE_COSINE:
            reasons.append("duplicate-reference")
        if same_person_refs and best_ref_cosine < self.REFERENCE_SUGGESTION_OUTLIER_MIN_COSINE:
            reasons.append("embedding-outlier")
        pose_bucket = self._normalized_pose_bucket(embedding.pose_bucket or candidate.pose_bucket)
        metrics = {
            "score": float(candidate.score),
            "scoreMinimum": score_min,
            "candidateQuality": float(candidate.quality or 0.0),
            "embeddingQuality": float(embedding.quality or 0.0),
            "quality": quality,
            "qualityMinimum": self.REFERENCE_SUGGESTION_MIN_QUALITY,
            "alignError": align_error,
            "alignErrorMaximum": self.REFERENCE_SUGGESTION_MAX_ALIGN_ERROR,
            "iedPx": ied_px,
            "iedPxMinimum": self.REFERENCE_SUGGESTION_MIN_IED_PX,
            "bestReferenceCosine": best_ref_cosine,
            "duplicateCosine": self.REFERENCE_SUGGESTION_DUPLICATE_COSINE,
            "outlierMinimumCosine": self.REFERENCE_SUGGESTION_OUTLIER_MIN_COSINE,
            "bestReferenceId": best_ref_id,
            "reasons": sorted(set(reasons)),
        }
        payload = {
            "candidateId": candidate.candidate_id,
            "personName": candidate.person_name,
            "ageBucket": "unknown",
            "sourceHash": file_hash,
            "modelName": embedding_model,
            "candidateModelName": candidate.model_name,
            "bestRefId": candidate.best_ref_id or best_ref_id,
            "bestReferenceId": best_ref_id,
            "score": float(candidate.score),
            "quality": quality,
            "poseBucket": pose_bucket,
            "mediaKind": candidate.media_kind,
            "captureDate": candidate.capture_date,
            "captureDateProvenance": candidate.capture_date_provenance or "unknown",
            "acceptedAt": candidate.created_at,
            "versionKey": "suggested-reference-v1",
        }
        return {
            "eligible": not reasons,
            "reasons": sorted(set(reasons)),
            "metrics": metrics,
            "payload": payload,
            "trainingDataHash": self._reference_suggestion_training_hash(payload),
        }

    def stage_reference_suggestions(
        self,
        embeddings_by_candidate_id: dict[str, EmbeddingResult],
        limit: int = 20,
    ) -> dict[str, Any]:
        limit = max(1, min(50, int(limit or 20)))
        if str(getattr(self.config, "learning_mode", "manual") or "manual") == "off":
            return {
                "staged": 0,
                "suggestions": [],
                "rejected": [],
                "skipped": [{"reason": "learning-off"}],
                "summary": self.reference_suggestion_status(),
            }
        if self.config.require_consent and not self.consent_on_file():
            return {
                "staged": 0,
                "suggestions": [],
                "rejected": [],
                "skipped": [{"reason": "consent-required"}],
                "summary": self.reference_suggestion_status(),
            }
        existing = self._suggested_reference_artifact_candidate_ids()
        suggestions: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        for candidate in self.reference_suggestion_candidates(limit=limit * 4):
            if len(suggestions) >= limit:
                break
            if candidate.candidate_id in existing:
                skipped.append({"candidateId": candidate.candidate_id, "reason": "already-suggested"})
                continue
            embedding = embeddings_by_candidate_id.get(candidate.candidate_id)
            if embedding is None:
                skipped.append({"candidateId": candidate.candidate_id, "reason": "missing-embedding"})
                continue
            evaluation = self._evaluate_reference_suggestion(candidate, embedding)
            if not evaluation["eligible"]:
                rejected.append({"candidateId": candidate.candidate_id, "personName": candidate.person_name, "reasons": evaluation["reasons"], "metrics": evaluation["metrics"]})
                continue
            payload = evaluation["payload"]
            metrics = evaluation["metrics"]
            artifact_id = new_id("learn")
            artifact = self.db.upsert_learned_artifact(
                artifact_id,
                {
                    "artifactType": "suggested_reference",
                    "status": "staged",
                    "modelName": payload["modelName"],
                    "versionKey": "suggested-reference-v1",
                    "trainingDataHash": evaluation["trainingDataHash"],
                    "inputCount": 1,
                    "positiveCount": 1,
                    "negativeCount": 0,
                    "metrics": metrics,
                    "payload": payload,
                },
            )
            row = {**artifact, "artifactType": "suggested_reference", "metrics": metrics, "payload": payload}
            suggestions.append(row)
            existing.add(candidate.candidate_id)
            self._append_audit(
                {
                    "action": "stage_reference_suggestion",
                    "artifact_id": artifact_id,
                    "artifact_hash": artifact.get("artifactHash", ""),
                    "candidate_id": candidate.candidate_id,
                    "person_name": candidate.person_name,
                    "source_hash": payload["sourceHash"],
                    "model_name": payload["modelName"],
                    "score": payload["score"],
                    "quality": payload["quality"],
                    "best_reference_cosine": metrics["bestReferenceCosine"],
                }
            )
        return {
            "staged": len(suggestions),
            "suggestions": suggestions,
            "rejected": rejected,
            "skipped": skipped,
            "summary": self.reference_suggestion_status(),
        }

    def reference_suggestion_status(self, limit: int = 20) -> dict[str, Any]:
        artifacts = self.db.learned_artifact_rows("suggested_reference", limit=max(1, min(100, int(limit or 20))))
        counts: dict[str, int] = {}
        for artifact in artifacts:
            status = str(artifact.get("status", ""))
            counts[status] = counts.get(status, 0) + 1
        return {
            "artifacts": self._learned_artifact_status_payloads(artifacts),
            "counts": counts,
            "staged": counts.get("staged", 0),
            "promoted": counts.get("promoted", 0),
            "rejected": counts.get("rejected", 0),
        }

    @staticmethod
    def _learned_artifact_status_payload(artifact: dict[str, Any] | None) -> dict[str, Any] | None:
        if not artifact:
            return None

        def field(camel: str, snake: str | None = None) -> Any:
            return artifact.get(camel, artifact.get(snake or camel))

        def string_field(camel: str, snake: str | None = None) -> str:
            value = field(camel, snake)
            return "" if value is None else str(value)

        def int_field(camel: str, snake: str | None = None) -> int:
            try:
                return int(field(camel, snake) or 0)
            except (TypeError, ValueError):
                return 0

        def optional_time(camel: str, snake: str | None = None) -> str | None:
            value = field(camel, snake)
            if value is None or value == "":
                return None
            return str(value)

        metrics = artifact.get("metrics") if isinstance(artifact.get("metrics"), dict) else {}
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        return {
            "artifactId": string_field("artifactId", "artifact_id"),
            "artifactType": string_field("artifactType", "artifact_type"),
            "status": string_field("status") or "candidate",
            "modelName": string_field("modelName", "model_name"),
            "versionKey": string_field("versionKey", "version_key"),
            "trainingDataHash": string_field("trainingDataHash", "training_data_hash"),
            "inputCount": int_field("inputCount", "input_count"),
            "positiveCount": int_field("positiveCount", "positive_count"),
            "negativeCount": int_field("negativeCount", "negative_count"),
            "metrics": dict(metrics),
            "payload": dict(payload),
            "artifactHash": string_field("artifactHash", "artifact_hash"),
            "parentArtifactId": string_field("parentArtifactId", "parent_artifact_id"),
            "createdAt": string_field("createdAt", "created_at"),
            "promotedAt": optional_time("promotedAt", "promoted_at"),
        }

    def _learned_artifact_status_payloads(self, artifacts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            payload
            for artifact in artifacts
            for payload in [self._learned_artifact_status_payload(artifact)]
            if payload is not None
        ]

    def approve_reference_suggestion(
        self,
        artifact_id: str,
        embedding: EmbeddingResult,
        operator: str = "",
    ) -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != "suggested_reference":
            raise ValueError("No suggested reference artifact is available for approval.")
        if artifact.get("status") != "staged":
            raise ValueError("Only staged suggested references can be approved.")
        self._require_learning_consent("approving a suggested reference")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        candidate_id = str(payload.get("candidateId", payload.get("candidate_id", "")) or "")
        candidate = self.candidates.get(candidate_id)
        if candidate is None:
            raise ValueError("The source candidate for this reference suggestion is no longer available.")
        evaluation = self._evaluate_reference_suggestion(candidate, embedding, expected_source_hash=str(payload.get("sourceHash", "") or ""))
        if not evaluation["eligible"]:
            self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
            self._append_audit(
                {
                    "action": "approve_reference_suggestion",
                    "artifact_id": artifact["artifact_id"],
                    "approved": False,
                    "candidate_id": candidate_id,
                    "reasons": evaluation["reasons"],
                }
            )
            raise ValueError(f"Suggested reference failed final validation: {', '.join(evaluation['reasons'])}")
        source_hash = str(evaluation["payload"].get("sourceHash", "") or "")
        ref = ReferenceFace(
            ref_id=new_id("ref"),
            person_name=candidate.person_name,
            age_bucket=str(payload.get("ageBucket", "unknown") or "unknown"),
            source_path=candidate.source_path,
            capture_date=candidate.capture_date,
            quality=float(embedding.quality or candidate.quality or 0.0),
            model_name=str(embedding.model_name or candidate.model_name or ""),
            vector=list(embedding.vector),
            source_hash=source_hash,
            pose_bucket=self._normalized_pose_bucket(embedding.pose_bucket or candidate.pose_bucket),
            capture_date_provenance=candidate.capture_date_provenance or "unknown",
        )
        self.references[ref.ref_id] = ref
        self._mark_reference_dirty(ref.ref_id)
        self.vector_store.add(ref.ref_id, ref.vector)
        invalidated_synthetic = len(self._remove_age_trajectory_references(person_name=ref.person_name))
        self._invalidate_reference_indexes()
        promoted_at = now_iso()
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "promoted", promoted_at=promoted_at)
        self._append_audit(
            {
                "action": "approve_reference_suggestion",
                "approved": True,
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
                "ref_id": ref.ref_id,
                "candidate_id": candidate_id,
                "person_name": ref.person_name,
                "source_hash": source_hash,
                "model_name": ref.model_name,
                "quality": ref.quality,
                "operator": str(operator or self.actor)[:120],
                "invalidated_synthetic_age_references": invalidated_synthetic,
            }
        )
        self.save()
        return {
            "approved": True,
            "artifactId": artifact["artifact_id"],
            "artifactHash": artifact.get("artifact_hash", ""),
            "refId": ref.ref_id,
            "reference": asdict(ref),
            "promotedAt": promoted_at,
            "summary": self.reference_suggestion_status(),
        }

    def reject_reference_suggestion(self, artifact_id: str, reason: str = "") -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id)
        if not artifact or artifact.get("artifact_type") != "suggested_reference":
            raise ValueError("No suggested reference artifact is available for rejection.")
        if artifact.get("status") not in {"candidate", "staged"}:
            raise ValueError("Only candidate or staged suggested references can be rejected.")
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
        self._append_audit(
            {
                "action": "reject_reference_suggestion",
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
                "reason": str(reason or "")[:300],
            }
        )
        return {"rejected": True, "artifactId": artifact["artifact_id"], "summary": self.reference_suggestion_status()}

    def clear_candidates(self) -> None:
        try:
            count = self.db.candidate_count() if self._candidate_index_backed else len(self.candidates)
        except sqlite3.Error:
            count = len(self.candidates)
        candidate_ids = [] if self._candidate_index_backed else list(self.candidates.keys())
        self.candidates.clear()
        self._loaded_candidate_ids.clear()
        self._loaded_candidate_payloads.clear()
        self._candidate_dirty_ids.clear()
        self._candidate_deleted_ids.clear()
        self._candidate_index_backed = False
        self._mark_candidates_deleted(candidate_ids)
        try:
            self.db.clear_candidates()
        except sqlite3.Error:
            pass
        deleted_suggestions = self.db.delete_suggested_reference_artifacts(
            candidate_ids=candidate_ids,
            statuses={"staged", "candidate"},
            all_candidates=True,
        )
        self._append_audit({"action": "clear_candidates", "count": count, "suggested_reference_artifacts_deleted": deleted_suggestions})
        self.save(snapshot_candidates=False)
        self._write_json_array_atomic(self.candidates_path, [])

    def purge_candidates(self, statuses: list[str]) -> int:
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        status_set = {str(status) for status in statuses}
        if not status_set or not status_set <= allowed:
            raise ValueError("Purge statuses must be selected from pending, accepted, rejected, and uncertain.")
        to_delete = self._authoritative_candidate_ids(statuses=status_set)
        deleted_suggestions = self.db.delete_suggested_reference_artifacts(candidate_ids=to_delete, statuses={"staged", "candidate"})
        self._mark_candidates_deleted(to_delete)
        self._forget_candidates(to_delete)
        self._append_audit(
            {
                "action": "purge_candidates",
                "statuses": sorted(status_set),
                "count": len(to_delete),
                "suggested_reference_artifacts_deleted": deleted_suggestions,
            }
        )
        self.save()
        return len(to_delete)

    def duplicate_candidate_groups(self) -> list[dict[str, Any]]:
        groups: dict[tuple[str, str, str], list[ReviewCandidate]] = {}
        for candidate in self._iter_authoritative_candidates(order="created"):
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
        for candidate in self._iter_authoritative_candidates(order="created"):
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
        self._mark_candidates_deleted(to_delete)
        self._forget_candidates(to_delete)
        self._append_audit({"action": "purge_duplicate_candidates", "count": len(to_delete)})
        self.save()
        return len(to_delete)

    def delete_reference(self, ref_id: str) -> None:
        if ref_id not in self.references:
            raise KeyError(f"Reference not found: {ref_id}")
        ref = self.references.pop(ref_id)
        dependent_ids = self._remove_age_trajectory_references(parent_ref_id=ref_id)
        self._mark_references_deleted([ref_id, *dependent_ids])
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "delete_reference",
                "ref_id": ref_id,
                "source_path": ref.source_path,
                "person_name": ref.person_name,
                "dependentSyntheticAgeReferences": len(dependent_ids),
            }
        )
        self.save()

    def clear_references(self) -> int:
        count = len(self.references)
        self._remove_age_trajectory_references()
        self._mark_references_deleted(list(self.references.keys()))
        self.references.clear()
        self.vector_store.clear()
        self._invalidate_reference_indexes()
        self._append_audit({"action": "clear_references", "count": count})
        self.save()
        return count

    def delete_subject_data(
        self,
        person_name: str,
        *,
        confirm: bool = False,
        reason: str = "subject-request",
        source: str = "desktop",
    ) -> dict[str, Any]:
        if not confirm:
            raise ValueError("Subject data deletion requires confirm=true.")
        normalized = person_name.strip().casefold()
        if not normalized:
            raise ValueError("A person name is required.")
        ref_ids = [ref_id for ref_id, ref in self.references.items() if ref.person_name.casefold() == normalized]
        candidate_ids = self._authoritative_candidate_ids(person_name=person_name)
        self._ensure_candidates_loaded(candidate_ids)
        candidate_rows = [self.candidates[candidate_id] for candidate_id in candidate_ids if candidate_id in self.candidates]
        source_paths = {candidate.source_path for candidate in candidate_rows if candidate.source_path}
        release_record = self.subject_consents().get(normalized, {})
        person_ref = self._audit_person_ref(person_name)
        erased_synthetic_age = self._erase_synthetic_age_image_artifacts_for_person(person_name)
        for ref_id in ref_ids:
            self.references.pop(ref_id, None)
        self._mark_references_deleted(ref_ids)
        self._mark_candidates_deleted(candidate_ids)
        self._forget_candidates(candidate_ids)
        deleted_suggestions = self.db.delete_suggested_reference_artifacts(person_names=[person_name.strip()])
        db_deleted = self.db.delete_subject_private_data(person_name, candidate_ids=candidate_ids)
        audit_erasure = self._pseudonymize_subject_audit(person_name)
        self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
        if ref_ids:
            self._invalidate_reference_indexes()

        self.config.calibration_platt = []
        self.config.calibration_platt_by_person = {
            key: value
            for key, value in self.config.calibration_platt_by_person.items()
            if str(key).strip().casefold() != normalized
        }
        self.config.calibration_adaptive = {}
        self.config.calibration_model = ""

        generated_removed = int(erased_synthetic_age["files"])
        generated_bytes = int(erased_synthetic_age["bytes"])
        paths_still_in_use = self.db.review_candidate_source_paths_in_use(source_paths)
        for raw_path in source_paths:
            source_path = Path(raw_path).expanduser()
            try:
                if source_path.exists():
                    preview_path = self._preview_cache_path(source_path)
                    if preview_path.exists() and self._generated_dir_is_owned(self.previews_path):
                        generated_bytes += preview_path.stat().st_size
                        preview_path.unlink()
                        generated_removed += 1
                resolved = source_path.resolve()
                if (
                    raw_path not in paths_still_in_use
                    and self._generated_dir_is_owned(self.video_frames_path)
                    and self.video_frames_path.resolve() in resolved.parents
                    and resolved.is_file()
                ):
                    generated_bytes += resolved.stat().st_size
                    resolved.unlink()
                    generated_removed += 1
            except OSError:
                continue

        subjects = self.subject_consents()
        subjects.pop(normalized, None)
        destroyed_at = now_iso()
        receipt_reason = re.sub(
            re.escape(person_name.strip()),
            "[redacted subject]",
            str(reason or "subject-request")[:160],
            flags=re.IGNORECASE,
        )
        receipt = {
            "schemaVersion": 1,
            "receiptId": "destruction_" + hashlib.sha256(
                f"{person_ref}\0{destroyed_at}\0{reason}\0{source}".encode("utf-8")
            ).hexdigest()[:24],
            "subjectRef": person_ref,
            "releaseId": str(release_record.get("releaseId", "")),
            "releaseHash": str(release_record.get("recordHash", "")),
            "destroyedAt": destroyed_at,
            "reason": receipt_reason,
            "source": str(source or "desktop")[:80],
            "originalMediaDeleted": False,
            "auditErasureCheckpointHash": str(audit_erasure.get("checkpointHash", "")),
            "counts": {
                "references": len(ref_ids),
                "candidates": len(candidate_ids),
                "generatedFiles": generated_removed,
                "generatedBytes": generated_bytes,
                "suggestedReferenceArtifacts": deleted_suggestions,
                "syntheticAgeImageArtifacts": int(erased_synthetic_age["artifacts"]),
                "auditEventsPseudonymized": int(audit_erasure.get("redacted", 0) or 0),
                **db_deleted,
            },
        }
        receipt["receiptHash"] = hashlib.sha256(
            json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        receipt_rows = self.consent.get("destructionReceipts")
        if not isinstance(receipt_rows, list):
            receipt_rows = []
        self.consent = {
            **self.consent,
            "schemaVersion": CONSENT_SCHEMA_VERSION,
            "subjects": subjects,
            "destructionReceipts": [*receipt_rows[-499:], receipt],
        }
        self._append_audit(
            {
                "action": "delete_subject_data",
                "personRef": person_ref,
                "receiptId": receipt["receiptId"],
                "receiptHash": receipt["receiptHash"],
                "reason": receipt["reason"],
                "source": receipt["source"],
                "originalMediaDeleted": False,
                "counts": receipt["counts"],
            }
        )
        self.save()

        receipt_root = self.root / "exports" / "destruction-receipts"
        receipt_root.mkdir(parents=True, exist_ok=True)
        receipt_path = receipt_root / f"vintrace-{receipt['receiptId']}.json"
        atomic_write_text(receipt_path, json.dumps(receipt, indent=2, sort_keys=True))
        return {
            "references": len(ref_ids),
            "candidates": len(candidate_ids),
            "suggestedReferenceArtifacts": deleted_suggestions,
            "syntheticAgeImageArtifacts": int(erased_synthetic_age["artifacts"]),
            "relationshipNameReviews": int(db_deleted.get("relationshipNameReviews", 0)),
            "dbDeleted": db_deleted,
            "generatedFiles": generated_removed,
            "generatedBytes": generated_bytes,
            "receipt": receipt,
            "receiptPath": str(receipt_path),
        }

    def delete_person(self, person_name: str) -> dict[str, Any]:
        return self.delete_subject_data(
            person_name,
            confirm=True,
            reason="operator-delete-person",
            source=self.actor,
        )

    def rename_person(self, old_name: str, new_name: str) -> dict[str, Any]:
        old_clean = old_name.strip()
        new_clean = new_name.strip()
        if not old_clean or not new_clean:
            raise ValueError("Both current and new person names are required.")
        old_key = old_clean.casefold()
        if old_key == new_clean.casefold():
            return {"references": 0, "candidates": 0}
        removed_synthetic_age_references = self._remove_age_trajectory_references(person_name=old_clean)
        target_reference_exists = any(
            ref.person_name.casefold() == new_clean.casefold()
            for ref in self.references.values()
        )
        target_candidate_exists = bool(self._authoritative_candidate_ids(person_name=new_clean))
        target_photo_presence_exists = self.db.photo_person_presence_count(new_clean) > 0
        reference_undo_rows: list[dict[str, str]] = []
        for ref in self.references.values():
            if ref.person_name.casefold() == old_key:
                reference_undo_rows.append({"refId": ref.ref_id, "personName": ref.person_name, "sourcePath": ref.source_path})
        candidate_ids = self._authoritative_candidate_ids(person_name=old_clean)
        self._flush_candidate_index()
        operation_snapshot = self.db.photo_person_label_undo_snapshot(
            old_name=old_clean,
            new_name=new_clean,
            candidate_ids=candidate_ids,
        )
        references = 0
        candidates = 0
        for ref in self.references.values():
            if ref.person_name.casefold() == old_key:
                ref.person_name = new_clean
                self._mark_reference_dirty(ref.ref_id)
                references += 1
        if self._candidate_index_backed:
            renamed_ids = self.db.rename_review_candidate_person(old_clean, new_clean)
            candidates = len(renamed_ids)
            for candidate_id in renamed_ids:
                candidate = self.candidates.get(candidate_id)
                if candidate is None:
                    continue
                candidate.person_name = new_clean
                self._loaded_candidate_payloads[candidate_id] = asdict(candidate)
        else:
            for candidate in self.candidates.values():
                if candidate.person_name.casefold() == old_key:
                    candidate.person_name = new_clean
                    candidates += 1
                    self._mark_candidate_dirty(candidate.candidate_id)
        if references == 0 and candidates == 0:
            raise KeyError(f"Person not found: {old_name}")
        if references:
            self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "rename_person",
                "oldPersonRef": self._audit_person_ref(old_clean),
                "newPersonRef": self._audit_person_ref(new_clean),
                "references": references,
                "candidates": candidates,
                "removedSyntheticAgeReferences": len(removed_synthetic_age_references),
            }
        )
        self.save()
        photo_profile = self.db.rename_photo_person_profile(old_clean, new_clean)
        photo_people_rows = operation_snapshot.get("photoPeopleRows", []) if isinstance(operation_snapshot, dict) else []
        target_profile_snapshot = operation_snapshot.get("targetProfile", {}) if isinstance(operation_snapshot, dict) else {}
        identity_merged = bool(
            target_reference_exists
            or target_candidate_exists
            or target_photo_presence_exists
            or (isinstance(target_profile_snapshot, dict) and target_profile_snapshot.get("exists"))
            or photo_profile.get("profileMerged")
        )
        operation = self.db.record_photo_person_label_operation(
            operation_type="person_label_merge" if identity_merged else "person_label_rename",
            label=(
                f"Merged person {old_clean} into {new_clean}"
                if identity_merged
                else f"Renamed person {old_clean} to {new_clean}"
            ),
            old_name=old_clean,
            new_name=new_clean,
            references=reference_undo_rows,
            snapshot=operation_snapshot if isinstance(operation_snapshot, dict) else {},
            affected_count=references + candidates + len(photo_people_rows) + int(photo_profile.get("groupRows", 0) or 0),
            merged_into_existing=identity_merged,
        )
        return {
            "references": references,
            "candidates": candidates,
            "removedSyntheticAgeReferences": len(removed_synthetic_age_references),
            **photo_profile,
            "identityMerged": identity_merged,
            "operation": operation,
        }

    def restore_person_label_references(self, undo_payload: dict[str, Any]) -> int:
        if not isinstance(undo_payload, dict):
            return 0
        old_person = str(undo_payload.get("oldPersonName", "") or "").strip()
        rows = undo_payload.get("references", [])
        restored = 0
        for row in (rows if isinstance(rows, list) else []):
            if not isinstance(row, dict):
                continue
            ref_id = str(row.get("refId", "") or "").strip()
            person_name = str(row.get("personName", "") or old_person).strip() or old_person
            ref = self.references.get(ref_id)
            if ref is None or not person_name:
                continue
            ref.person_name = person_name
            self._mark_reference_dirty(ref.ref_id)
            restored += 1
        if restored:
            self._invalidate_reference_indexes()
            self.save(snapshot_candidates=True, flush_candidate_index=False)
        return restored

    def purge_old_candidates(self, days: int, statuses: list[str] | None = None) -> int:
        days = max(1, min(3650, int(days)))
        status_set = set(statuses or ["accepted", "rejected", "uncertain"])
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        if not status_set or not status_set <= allowed:
            raise ValueError("Retention statuses must be selected from pending, accepted, rejected, and uncertain.")
        cutoff = datetime.now(timezone.utc).timestamp() - days * 24 * 60 * 60
        to_delete: list[str] = []
        skipped_undated = 0
        for candidate in self._iter_authoritative_candidates(statuses=status_set, order="created"):
            if candidate.status not in status_set:
                continue
            try:
                created = datetime.fromisoformat(candidate.created_at.replace("Z", "+00:00")).timestamp()
            except (AttributeError, ValueError):
                skipped_undated += 1
                continue
            if created < cutoff:
                to_delete.append(candidate.candidate_id)
        deleted_examples = 0
        deleted_suggestions = 0
        if to_delete:
            try:
                deleted_examples = self.db.delete_training_examples_for_candidates(to_delete)
            except sqlite3.Error:
                deleted_examples = 0
            deleted_suggestions = self.db.delete_suggested_reference_artifacts(candidate_ids=to_delete, statuses={"staged", "candidate"})
        self._mark_candidates_deleted(to_delete)
        self._forget_candidates(to_delete)
        self._append_audit(
            {
                "action": "purge_old_candidates",
                "days": days,
                "statuses": sorted(status_set),
                "count": len(to_delete),
                "skipped_undated": skipped_undated,
                "training_examples_deleted": deleted_examples,
                "suggested_reference_artifacts_deleted": deleted_suggestions,
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
        missing_parent_ids = set(missing_ref_ids)
        dependent_synthetic_ids = [
            ref_id
            for ref_id, ref in self.references.items()
            if is_synthetic_age_reference(ref)
            and any(parent_ref_id in missing_parent_ids for parent_ref_id in ref.parent_ref_ids)
        ]
        missing_ref_ids = list(dict.fromkeys([*missing_ref_ids, *dependent_synthetic_ids]))
        affected_age_artifact_ids = {
            str(ref.derivation_provenance.get("reviewArtifactId", "") or "")
            for ref_id in missing_ref_ids
            for ref in [self.references.get(ref_id)]
            if ref is not None and is_generated_age_image_reference(ref)
            if str(ref.derivation_provenance.get("reviewArtifactId", "") or "")
        }
        missing_candidates = [
            candidate
            for candidate in self._iter_authoritative_candidates(order="created")
            if not Path(candidate.source_path).exists()
            or (candidate.media_source_path and not Path(candidate.media_source_path).exists())
        ]
        missing_candidate_ids = [candidate.candidate_id for candidate in missing_candidates]
        missing_values: list[str] = []
        for ref_id in missing_ref_ids:
            missing_values.append(self.references[ref_id].source_path)
        for candidate in missing_candidates:
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
            "removedDependentSyntheticAgeReferences": len(dependent_synthetic_ids),
            "rolledBackSyntheticAgeArtifacts": len(affected_age_artifact_ids),
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
        invalidated_age_artifacts: set[str] = set()
        for parent_ref_id in missing_parent_ids:
            parent = self.references.get(parent_ref_id)
            if parent is not None and not is_synthetic_age_reference(parent):
                invalidated_age_artifacts.update(
                    self._invalidate_synthetic_age_image_artifacts(
                        parent_ref_id=parent_ref_id,
                        reason="workspace-repair-missing-parent",
                    )
                )
        for artifact_id in affected_age_artifact_ids:
            artifact = self.db.learned_artifact_by_id(artifact_id)
            if artifact and str(artifact.get("status", "") or "") == "promoted":
                self.db.update_learned_artifact_status(artifact_id, "rolled_back")
                invalidated_age_artifacts.add(artifact_id)
        for ref_id in missing_ref_ids:
            self.references.pop(ref_id, None)
        self._mark_references_deleted(missing_ref_ids)
        self._mark_candidates_deleted(missing_candidate_ids)
        self._forget_candidates(missing_candidate_ids)
        if missing_ref_ids:
            self.vector_store.rebuild({item_id: item.vector for item_id, item in self.references.items()})
            self._invalidate_reference_indexes()
        self._append_audit(
            {
                "action": "repair_workspace",
                "removed_references": len(missing_ref_ids),
                "removed_candidates": len(missing_candidate_ids),
                "removed_dependent_synthetic_age_references": len(dependent_synthetic_ids),
                "rolled_back_synthetic_age_artifacts": len(invalidated_age_artifacts),
            }
        )
        self.save()
        result["after"] = self.workspace_health()
        result["rolledBackSyntheticAgeArtifacts"] = len(invalidated_age_artifacts)
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
        changed_candidates: list[ReviewCandidate] = []

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
                    self._mark_reference_dirty(ref.ref_id)
                relinked_references += 1
                relinked_fields += 1
        for candidate in self._iter_authoritative_candidates(order="created"):
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
                    if self._candidate_index_backed:
                        changed_candidates.append(candidate)
                    else:
                        self._mark_candidate_dirty(candidate.candidate_id)
        if not dry_run and changed_candidates:
            self.db.upsert_candidates(changed_candidates)
            for candidate in changed_candidates:
                loaded = self.candidates.get(candidate.candidate_id)
                if loaded is not None:
                    loaded.source_path = candidate.source_path
                    loaded.best_ref_path = candidate.best_ref_path
                    loaded.media_source_path = candidate.media_source_path
                    self._loaded_candidate_payloads[candidate.candidate_id] = asdict(loaded)
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

    def _path_inside_workspace(self, value: str) -> bool:
        try:
            path = Path(str(value or "")).expanduser().resolve()
            root = self.root.resolve()
            return path == root or root in path.parents
        except (OSError, RuntimeError):
            return False

    def _sql_like_path_prefix(self, root_path: Path) -> tuple[str, str, str]:
        root_text = str(root_path).rstrip("/\\")
        escaped = root_text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        return root_text, f"{escaped}/%", f"{escaped}\\\\%"

    def _photo_asset_count_under_root(
        self,
        conn: sqlite3.Connection,
        root_path: Path,
        *,
        managed_only: bool = False,
    ) -> int:
        root_text, slash_prefix, backslash_prefix = self._sql_like_path_prefix(root_path)
        filters = [
            "(source_path = ? OR source_path LIKE ? ESCAPE '\\' OR source_path LIKE ? ESCAPE '\\')"
        ]
        params: list[Any] = [root_text, slash_prefix, backslash_prefix]
        if managed_only:
            filters.append("LOWER(COALESCE(source_kind, '')) = 'managed'")
        row = conn.execute(
            f"SELECT COUNT(*) AS n FROM photo_assets WHERE {' AND '.join(filters)}",
            params,
        ).fetchone()
        return int(row["n"] if row else 0)

    def _photos_manifest_root_profiles(self, settings: dict[str, Any], conn: sqlite3.Connection) -> list[dict[str, Any]]:
        workspace_default = str((self.root / "photo-library" / "managed").expanduser().resolve())
        roots = [dict(root) for root in settings.get("managedRoots", []) if isinstance(root, dict)]
        if not any(str(root.get("path", "") or "") == workspace_default for root in roots):
            roots.append({
                "profileId": "workspaceDefaultManagedRoot",
                "name": "Workspace managed library",
                "path": workspace_default,
                "isDefault": not bool(str(settings.get("defaultManagedRoot", "") or "").strip()),
                "builtIn": True,
            })
        profiles: list[dict[str, Any]] = []
        for root in roots:
            root_path_text = str(root.get("path", "") or "").strip()
            if not root_path_text:
                continue
            try:
                root_path = Path(root_path_text).expanduser().resolve()
                inside_workspace = self._path_inside_workspace(str(root_path))
            except (OSError, RuntimeError):
                root_path = Path(root_path_text)
                inside_workspace = False
            asset_count = self._photo_asset_count_under_root(conn, root_path, managed_only=True)
            profiles.append({
                "profileId": str(root.get("profileId", "") or ""),
                "name": str(root.get("name", "") or Path(root_path_text).name or "Managed library"),
                "path": root_path_text,
                "isDefault": bool(root.get("isDefault", False)),
                "builtIn": bool(root.get("builtIn", False)),
                "insideWorkspace": inside_workspace,
                "assetCount": asset_count,
                "includedInWorkspaceBackup": bool(inside_workspace),
                "requiresExternalBackup": bool(asset_count and not inside_workspace),
            })
        return profiles

    def _photos_backup_manifest(self, include_generated: bool) -> dict[str, Any]:
        counts: dict[str, int] = {
            "assets": 0,
            "managedAssets": 0,
            "referencedAssets": 0,
            "missingOriginals": 0,
            "missingManagedOriginals": 0,
            "missingReferencedOriginals": 0,
            "workspaceBackedOriginals": 0,
            "externalOriginals": 0,
            "referencedOriginalsOutsideWorkspace": 0,
            "managedOriginalsOutsideWorkspace": 0,
            "albums": 0,
            "albumFolders": 0,
            "albumItems": 0,
            "metadataRows": 0,
            "keywordAssignments": 0,
            "peopleLinks": 0,
            "peopleProfiles": 0,
            "relationshipNameReviews": 0,
            "savedFilters": 0,
            "editStacks": 0,
            "editVersions": 0,
            "mediaPairRows": 0,
            "curationPreferences": 0,
            "externalSources": 0,
            "externalAssetLinks": 0,
            "externalAlbumLinks": 0,
            "externalAlbumItems": 0,
            "tetherSessions": 0,
            "tetherCaptures": 0,
        }
        media_pairs = {
            "livePhotoAssets": 0,
            "pairedMotionFiles": 0,
            "pairedMotionMissing": 0,
            "pairedMotionIncludedInWorkspaceBackup": 0,
            "pairedMotionExternal": 0,
            "catalogRows": 0,
            "nonLivePairRows": 0,
            "kinds": {},
            "relatedFiles": 0,
            "relatedFilesMissing": 0,
            "relatedFilesIncludedInWorkspaceBackup": 0,
            "relatedFilesExternal": 0,
            "samples": [],
            "nonLiveSamples": [],
        }
        live_asset_rows: list[dict[str, Any]] = []
        media_pair_rows: list[dict[str, Any]] = []
        settings: dict[str, Any] = {}
        root_profiles: list[dict[str, Any]] = []
        try:
            settings = self.db.photo_library_settings()
            with self.db.connect() as conn:
                workspace_root = self.root.expanduser().resolve()
                workspace_root_text, workspace_slash_prefix, workspace_backslash_prefix = self._sql_like_path_prefix(workspace_root)
                count_row = conn.execute(
                    """
                    SELECT
                        COUNT(*) AS assets,
                        SUM(CASE WHEN LOWER(COALESCE(source_kind, '')) = 'managed' THEN 1 ELSE 0 END) AS managed_assets,
                        SUM(CASE WHEN LOWER(COALESCE(source_kind, '')) = 'managed' THEN 0 ELSE 1 END) AS referenced_assets,
                        SUM(CASE WHEN COALESCE(missing_at, '') != '' THEN 1 ELSE 0 END) AS missing_originals,
                        SUM(CASE WHEN COALESCE(missing_at, '') != '' AND LOWER(COALESCE(source_kind, '')) = 'managed' THEN 1 ELSE 0 END) AS missing_managed_originals,
                        SUM(CASE WHEN COALESCE(missing_at, '') != '' AND LOWER(COALESCE(source_kind, '')) != 'managed' THEN 1 ELSE 0 END) AS missing_referenced_originals,
                        SUM(CASE WHEN source_path = ? OR source_path LIKE ? ESCAPE '\\' OR source_path LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS workspace_backed_originals
                    FROM photo_assets
                    """,
                    (workspace_root_text, workspace_slash_prefix, workspace_backslash_prefix),
                ).fetchone()
                if count_row:
                    counts["assets"] = int(count_row["assets"] or 0)
                    counts["managedAssets"] = int(count_row["managed_assets"] or 0)
                    counts["referencedAssets"] = int(count_row["referenced_assets"] or 0)
                    counts["missingOriginals"] = int(count_row["missing_originals"] or 0)
                    counts["missingManagedOriginals"] = int(count_row["missing_managed_originals"] or 0)
                    counts["missingReferencedOriginals"] = int(count_row["missing_referenced_originals"] or 0)
                    counts["workspaceBackedOriginals"] = int(count_row["workspace_backed_originals"] or 0)
                    counts["externalOriginals"] = max(0, counts["assets"] - counts["workspaceBackedOriginals"])
                    counts["managedOriginalsOutsideWorkspace"] = max(0, counts["managedAssets"] - self._photo_asset_count_under_root(conn, workspace_root, managed_only=True))
                    counts["referencedOriginalsOutsideWorkspace"] = max(0, counts["externalOriginals"] - counts["managedOriginalsOutsideWorkspace"])
                for key, sql in {
                    "metadataRows": "SELECT COUNT(*) AS n FROM photo_asset_metadata",
                    "keywordAssignments": "SELECT COUNT(*) AS n FROM photo_asset_keywords",
                    "peopleLinks": "SELECT COUNT(*) AS n FROM photo_asset_people",
                    "peopleProfiles": "SELECT COUNT(*) AS n FROM photo_people_profiles",
                    "relationshipNameReviews": "SELECT COUNT(*) AS n FROM photo_relationship_name_reviews",
                    "albums": "SELECT COUNT(*) AS n FROM photo_albums",
                    "albumFolders": "SELECT COUNT(*) AS n FROM photo_album_folders",
                    "albumItems": "SELECT COUNT(*) AS n FROM photo_album_items",
                    "savedFilters": "SELECT COUNT(*) AS n FROM photo_saved_filters",
                    "editStacks": "SELECT COUNT(*) AS n FROM photo_edit_stacks",
                    "editVersions": "SELECT COUNT(*) AS n FROM photo_edit_stack_versions",
                    "mediaPairRows": "SELECT COUNT(*) AS n FROM photo_media_pairs",
                    "curationPreferences": "SELECT COUNT(*) AS n FROM meta WHERE key = 'photo_curation_preferences'",
                    "externalSources": "SELECT COUNT(*) AS n FROM photo_external_sources",
                    "externalAssetLinks": "SELECT COUNT(*) AS n FROM photo_asset_external_ids",
                    "externalAlbumLinks": "SELECT COUNT(*) AS n FROM photo_external_album_links",
                    "externalAlbumItems": "SELECT COUNT(*) AS n FROM photo_external_album_items",
                    "tetherSessions": "SELECT COUNT(*) AS n FROM photo_tether_sessions",
                    "tetherCaptures": "SELECT COUNT(*) AS n FROM photo_tether_captures",
                }.items():
                    row = conn.execute(sql).fetchone()
                    counts[key] = int(row["n"] if row else 0)
                rows = conn.execute(
                    """
                    SELECT asset_id, source_path, media_kind, metadata_json
                    FROM photo_assets
                    WHERE media_kind = 'live_photo' OR metadata_json LIKE '%pairedVideoPath%'
                    ORDER BY added_at ASC, asset_id ASC
                    """
                ).fetchall()
                live_asset_rows = [
                    {
                        "assetId": str(row["asset_id"] or ""),
                        "sourcePath": str(row["source_path"] or ""),
                        "mediaKind": str(row["media_kind"] or "image"),
                        "metadataJson": str(row["metadata_json"] or "{}"),
                    }
                    for row in rows
                ]
                try:
                    pair_rows = conn.execute(
                        """
                        SELECT p.pair_id, p.asset_id, p.related_asset_id, p.pair_kind,
                               p.source_path, p.related_source_path, p.metadata_json,
                               related.source_path AS related_asset_source_path
                        FROM photo_media_pairs AS p
                        LEFT JOIN photo_assets AS related ON related.asset_id = p.related_asset_id
                        ORDER BY p.updated_at ASC, p.pair_id ASC
                        """
                    ).fetchall()
                    media_pair_rows = [
                        {
                            "pairId": str(row["pair_id"] or ""),
                            "assetId": str(row["asset_id"] or ""),
                            "relatedAssetId": str(row["related_asset_id"] or ""),
                            "pairKind": str(row["pair_kind"] or ""),
                            "sourcePath": str(row["source_path"] or ""),
                            "relatedSourcePath": str(row["related_source_path"] or ""),
                            "relatedAssetSourcePath": str(row["related_asset_source_path"] or ""),
                            "metadataJson": str(row["metadata_json"] or "{}"),
                        }
                        for row in pair_rows
                    ]
                except sqlite3.DatabaseError:
                    media_pair_rows = []
                root_profiles = self._photos_manifest_root_profiles(settings, conn)
        except sqlite3.DatabaseError as exc:
            return {
                "schemaVersion": 1,
                "includeGenerated": bool(include_generated),
                "error": str(exc),
                "counts": counts,
            }

        for asset in live_asset_rows:
            source_path = str(asset.get("sourcePath", "") or "")
            metadata: dict[str, Any] = {}
            try:
                parsed = json.loads(str(asset.get("metadataJson", "{}") or "{}"))
                metadata = parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError):
                metadata = {}
            live_photo = metadata.get("livePhoto") if isinstance(metadata.get("livePhoto"), dict) else {}
            paired_path = str(live_photo.get("pairedVideoPath", "") or "").strip()
            if str(asset.get("mediaKind", "") or "") == "live_photo" or paired_path:
                media_pairs["livePhotoAssets"] += 1
            if paired_path:
                pair_exists = False
                try:
                    pair_exists = Path(paired_path).expanduser().is_file()
                except (OSError, RuntimeError):
                    pair_exists = False
                if pair_exists:
                    media_pairs["pairedMotionFiles"] += 1
                else:
                    media_pairs["pairedMotionMissing"] += 1
                if self._path_inside_workspace(paired_path):
                    media_pairs["pairedMotionIncludedInWorkspaceBackup"] += 1
                else:
                    media_pairs["pairedMotionExternal"] += 1
                samples = media_pairs["samples"]
                if isinstance(samples, list) and len(samples) < 12:
                    samples.append({
                        "assetId": str(asset.get("assetId", "") or ""),
                        "sourcePath": source_path,
                        "pairedVideoPath": paired_path,
                        "exists": pair_exists,
                        "includedInWorkspaceBackup": self._path_inside_workspace(paired_path),
                    })

        for pair in media_pair_rows:
            kind = str(pair.get("pairKind", "") or "unknown").strip().lower() or "unknown"
            media_pairs["catalogRows"] += 1
            kinds = media_pairs["kinds"]
            if isinstance(kinds, dict):
                kinds[kind] = int(kinds.get(kind, 0)) + 1
            if kind != "live_photo":
                media_pairs["nonLivePairRows"] += 1

            metadata: dict[str, Any] = {}
            try:
                parsed = json.loads(str(pair.get("metadataJson", "{}") or "{}"))
                metadata = parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError):
                metadata = {}
            related_path = (
                str(pair.get("relatedAssetSourcePath", "") or "").strip()
                or str(pair.get("relatedSourcePath", "") or "").strip()
                or str(metadata.get("relatedSourcePath", "") or "").strip()
                or str(metadata.get("path", "") or "").strip()
            )
            if not related_path:
                continue
            related_exists = False
            try:
                related_exists = Path(related_path).expanduser().is_file()
            except (OSError, RuntimeError):
                related_exists = False
            if related_exists:
                media_pairs["relatedFiles"] += 1
            else:
                media_pairs["relatedFilesMissing"] += 1
            included_in_workspace = self._path_inside_workspace(related_path)
            if included_in_workspace:
                media_pairs["relatedFilesIncludedInWorkspaceBackup"] += 1
            else:
                media_pairs["relatedFilesExternal"] += 1
            if kind != "live_photo":
                non_live_samples = media_pairs["nonLiveSamples"]
                if isinstance(non_live_samples, list) and len(non_live_samples) < 12:
                    non_live_samples.append({
                        "pairId": str(pair.get("pairId", "") or ""),
                        "assetId": str(pair.get("assetId", "") or ""),
                        "relatedAssetId": str(pair.get("relatedAssetId", "") or ""),
                        "pairKind": kind,
                        "sourcePath": str(pair.get("sourcePath", "") or ""),
                        "relatedSourcePath": related_path,
                        "exists": related_exists,
                        "includedInWorkspaceBackup": included_in_workspace,
                    })

        backup_policy = settings.get("backupPolicy", {}) if isinstance(settings.get("backupPolicy"), dict) else {}
        return {
            "schemaVersion": 1,
            "includeGenerated": bool(include_generated),
            "settings": {
                "defaultStorageMode": settings.get("defaultStorageMode", "referenced"),
                "defaultManagedRoot": settings.get("defaultManagedRoot", ""),
                "managedRoots": root_profiles,
                "backupPolicy": backup_policy,
            },
            "counts": counts,
            "coverage": {
                "workspaceBackedOriginals": counts["workspaceBackedOriginals"],
                "externalOriginals": counts["externalOriginals"],
                "referencedOriginalsOutsideWorkspace": counts["referencedOriginalsOutsideWorkspace"],
                "managedOriginalsOutsideWorkspace": counts["managedOriginalsOutsideWorkspace"],
                "missingOriginals": counts["missingOriginals"],
                "rootProfilesRequiringExternalBackup": sum(1 for root in root_profiles if root.get("requiresExternalBackup")),
            },
            "mediaPairs": media_pairs,
            "note": "Photos originals and paired motion files outside the active workspace require external backup coverage.",
        }

    def export_workspace_backup(self, folder: Path | None = None, include_generated: bool = True) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        # Ensure DB-first / Photos-only workspaces still produce the legacy core
        # JSON files that backup verification and restore summaries require.
        self.save(snapshot_candidates=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        backup_path = export_root / f"vintrace-workspace-backup-{stamp}.zip"
        counter = 2
        while backup_path.exists():
            backup_path = export_root / f"vintrace-workspace-backup-{stamp}-{counter}.zip"
            counter += 1
        try:
            candidate_count = self.db.candidate_count() if self._candidate_index_backed else len(self.candidates)
        except sqlite3.Error:
            candidate_count = len(self.candidates)
        manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "workspaceMetadata": self.workspace_metadata,
            "includeGenerated": bool(include_generated),
            # The id (not the key) of the workspace key this backup's SQLCipher DB and
            # AES-GCM sidecars are encrypted under. On restore it lets us tell a genuine
            # cross-machine KEY MISMATCH (host key id differs -> recoverable with the code)
            # apart from CORRUPTION (key id matches but the bytes still won't open -> fail).
            "workspaceKeyId": self._backup_workspace_key_id(),
            "counts": {
                "references": len(self.references),
                "candidates": candidate_count,
                "scanRuns": len(self.scan_history),
            },
            "photos": self._photos_backup_manifest(include_generated=bool(include_generated)),
            "note": "Backup contains Vintrace workspace metadata and generated workspace files, not original source media outside the workspace.",
        }
        include_dirs = {"exports"}
        if not include_generated:
            include_dirs.update({"previews", "video-frames", "synthetic-age-images"})
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
        passphrase = backup_passphrase()
        encrypted = bool(passphrase)
        archive_path = backup_path if not encrypted else export_root / f".{backup_path.name}.plain.tmp"
        try:
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
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
                        # Never archive the OpenTelemetry trace log. It is plaintext, it
                        # sits inside an otherwise SQLCipher-encrypted workspace, and a
                        # backup is the easiest way for it to leave the machine. Telemetry
                        # is opt-in (agent_telemetry.py), but even an operator who opts in
                        # has not consented to shipping spans inside a restore archive.
                        if path.name == TRACE_FILENAME:
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
            if encrypted:
                encrypted_temp = export_root / f".{backup_path.name}.enc.tmp"
                try:
                    encrypt_file(archive_path, encrypted_temp, passphrase)
                    os.replace(encrypted_temp, backup_path)
                finally:
                    try:
                        encrypted_temp.unlink()
                    except OSError:
                        pass
        finally:
            try:
                db_snapshot.unlink()
            except OSError:
                pass
            try:
                if archive_path != backup_path:
                    archive_path.unlink()
            except OSError:
                pass
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

    @contextmanager
    def _backup_archive_source(self, path: Path):
        # PC-03: transparently open an (optionally) encrypted backup. Returns the
        # path itself for a plain ZIP (unchanged behavior) or a temporary
        # decrypted ZIP path. Raises ValueError if encrypted but the passphrase
        # is missing/wrong.
        with path.open("rb") as handle:
            head = handle.read(16)
        if not is_encrypted(head):
            yield path
            return
        passphrase = backup_passphrase()
        if not passphrase:
            raise ValueError("This backup is encrypted; set VINTRACE_BACKUP_PASSPHRASE to verify or restore it.")
        try:
            with tempfile.TemporaryDirectory(prefix="vintrace-backup-decrypt-") as tmp:
                decrypted_path = Path(tmp) / "backup.zip"
                decrypt_file(path, decrypted_path, passphrase)
                yield decrypted_path
        except DecryptionError as exc:
            raise ValueError(str(exc)) from exc

    def _verify_backup_database_entry(
        self, archive: zipfile.ZipFile, *, archived_key_id: str = ""
    ) -> dict[str, Any]:
        report: dict[str, Any] = {
            "checked": False,
            "ok": True,
            "integrity": [],
            "foreignKeyErrors": [],
            "tables": [],
            "missingTables": [],
            "error": "",
        }
        if "workspace.sqlite3" not in set(archive.namelist()):
            return report
        report["checked"] = True
        report["ok"] = False
        try:
            with tempfile.TemporaryDirectory(prefix="vintrace-backup-db-") as tmp:
                database_path = Path(tmp) / "workspace.sqlite3"
                with archive.open("workspace.sqlite3") as source:
                    with database_path.open("wb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)
                if database_path.stat().st_size <= 0:
                    report["error"] = "workspace.sqlite3 is empty."
                    return report
                try:
                    conn = self.db._open_connection(database_path)
                except WorkspaceEncryptionError as exc:
                    # A failed open means one of two very different things, and SQLCipher cannot
                    # itself tell them apart (a wrong key and corrupt bytes both just fail to
                    # decrypt). We disambiguate with the archived workspace key id:
                    #   * host key id != archived key id -> genuine CROSS-MACHINE KEY MISMATCH.
                    #     The bytes are intact; the DB opens with the user's recovery code after
                    #     restore. Let restore proceed (without it, no disaster recovery is
                    #     possible at all — restore aborts before extracting a single file).
                    #   * host key id == archived key id -> the key is right but the open failed,
                    #     so the DB is CORRUPT. This must remain a hard failure.
                    report["error"] = str(exc)
                    header = database_path.read_bytes()[:16]
                    if header.startswith(b"SQLite format 3\x00"):
                        # Plaintext SQLite is malformed for this product (the workspace DB is
                        # always SQLCipher), regardless of key id.
                        report["error"] = "workspace.sqlite3 is not encrypted as expected."
                        report["ok"] = False
                        return report
                    host_key_id = self._backup_workspace_key_id()
                    genuine_mismatch = bool(archived_key_id) and archived_key_id != host_key_id
                    if genuine_mismatch:
                        report["keyMismatch"] = True
                        report["ok"] = True
                    else:
                        # Same key id (or unknown) but the DB will not open -> treat as corrupt.
                        report["ok"] = False
                    return report
                try:
                    conn.execute("PRAGMA query_only=ON")
                    integrity_rows = conn.execute("PRAGMA integrity_check").fetchall()
                    integrity = [str(row[0]) for row in integrity_rows]
                    foreign_key_errors = []
                    for row in conn.execute("PRAGMA foreign_key_check").fetchall():
                        values = list(row)
                        foreign_key_errors.append(
                            {
                                "table": str(values[0]) if len(values) > 0 else "",
                                "rowid": values[1] if len(values) > 1 else None,
                                "parent": str(values[2]) if len(values) > 2 else "",
                                "fkid": values[3] if len(values) > 3 else None,
                            }
                        )
                    table_rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
                    tables = sorted(str(row[0]) for row in table_rows)
                finally:
                    conn.close()
            expected_tables = {"scan_runs", "photo_assets", "review_candidates"}
            missing_tables = sorted(expected_tables - set(tables))
            report["integrity"] = integrity
            report["foreignKeyErrors"] = foreign_key_errors[:20]
            report["tables"] = tables
            report["missingTables"] = missing_tables
            if missing_tables:
                report["error"] = "workspace.sqlite3 is not a complete Vintrace workspace database."
            elif integrity != ["ok"]:
                report["error"] = "workspace.sqlite3 failed SQLite integrity_check."
            elif foreign_key_errors:
                report["error"] = "workspace.sqlite3 failed SQLite foreign_key_check."
            report["ok"] = integrity == ["ok"] and not foreign_key_errors and not missing_tables
        except (OSError, sqlite3.DatabaseError, zipfile.BadZipFile) as exc:
            report["error"] = str(exc)
        return report

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
            "databaseIntegrity": {},
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
            with self._backup_archive_source(path) as archive_source:
                with zipfile.ZipFile(archive_source) as archive:
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
                    # Read the manifest's workspace key id up front so the sensitive-file loop
                    # can tell a genuine cross-machine key mismatch from corruption, the same way
                    # the DB check does. A "key mismatch" that isn't a real mismatch is corruption.
                    archived_key_id = ""
                    if "backup-manifest.json" in name_set:
                        try:
                            manifest_probe = json.loads(archive.read("backup-manifest.json").decode("utf-8"))
                            if isinstance(manifest_probe, dict):
                                archived_key_id = str(manifest_probe.get("workspaceKeyId") or "")
                        except (json.JSONDecodeError, UnicodeDecodeError):
                            archived_key_id = ""
                    host_key_id = self._backup_workspace_key_id()
                    genuine_key_mismatch = bool(archived_key_id) and archived_key_id != host_key_id

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
                            raw = archive.read(name)
                            role = self._sensitive_file_role(Path(name))
                            if role:
                                raw = self.workspace_encryption.decrypt_bytes(raw, role=role)
                            payload = json.loads(raw.decode("utf-8"))
                        except WorkspaceEncryptionError as exc:
                            # Cross-machine disaster recovery: a sensitive core file that is
                            # genuinely AES-GCM-encrypted (correct magic) and whose archived key
                            # id differs from this host's is a KEY MISMATCH, not corruption. The
                            # bytes are intact and decrypt under the recovery code after restore.
                            # If the key id MATCHES but decryption still fails, the file is
                            # corrupt and must be rejected.
                            if (
                                role
                                and genuine_key_mismatch
                                and self.workspace_encryption.is_encrypted_bytes(archive.read(name))
                            ):
                                result["keyMismatch"] = True
                                continue
                            result["invalidCoreFiles"].append(name)
                            result["invalidCoreErrors"][name] = str(exc)
                            continue
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
                    archived_key_id = ""
                    if isinstance(result.get("manifest"), dict):
                        archived_key_id = str(result["manifest"].get("workspaceKeyId") or "")
                    database_integrity = self._verify_backup_database_entry(
                        archive, archived_key_id=archived_key_id
                    )
                    result["databaseIntegrity"] = database_integrity
                    if database_integrity.get("checked") and not database_integrity.get("ok"):
                        result["invalidCoreFiles"].append("workspace.sqlite3")
                        message = database_integrity.get("error") or "workspace.sqlite3 failed integrity verification."
                        result["invalidCoreErrors"]["workspace.sqlite3"] = str(message)
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
        except (
            OSError,
            zipfile.BadZipFile,
            json.JSONDecodeError,
            UnicodeDecodeError,
            ValueError,
            WorkspaceEncryptionError,
        ) as exc:
            # WorkspaceEncryptionError must degrade to a graceful ok=False here, never propagate
            # as an uncaught RuntimeError into restore_workspace_backup and abort the whole run.
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
        with self._backup_archive_source(path) as archive_source:
            with zipfile.ZipFile(archive_source) as archive:
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
            refs = self.workspace_encryption.read_json(target / "references.json", role="face-references-v1")
            if isinstance(refs, list):
                state_summary["references"] = len(refs)
            candidates_path = target / "review_candidates.json"
            if candidates_path.exists():
                candidates = self.workspace_encryption.read_json(candidates_path, role="review-candidates-v1")
                if isinstance(candidates, list):
                    state_summary["candidates"] = len(candidates)
            scan_history_path = target / "scan_history.json"
            if scan_history_path.exists():
                scan_runs = json.loads(scan_history_path.read_text(encoding="utf-8"))
                if isinstance(scan_runs, list):
                    state_summary["scanRuns"] = len(scan_runs)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError, WorkspaceEncryptionError):
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
                with self.db._open_connection(database_path) as connection:
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
            except WorkspaceEncryptionError:
                # Cross-machine disaster recovery: the restored DB is encrypted under the key
                # of the machine that made the backup and opens only with the user's recovery
                # code, which is applied when the workspace is next unlocked — not here. The
                # files ARE restored; only this optional count cross-check is deferred.
                summary_warnings.append(
                    "Restored database is encrypted under a different key; enter your recovery "
                    "code to unlock it. Counts could not be cross-checked during restore."
                )

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
            "video_track_id",
            "video_track_version",
            "video_track_start_ms",
            "video_track_end_ms",
            "video_track_frame_count",
            "video_track_keyframe_timestamps_ms",
            "video_track_keyframe_indices",
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
            "video_track_id": candidate.get("video_track_id", ""),
            "video_track_version": candidate.get("video_track_version", ""),
            "video_track_start_ms": candidate.get("video_track_start_ms"),
            "video_track_end_ms": candidate.get("video_track_end_ms"),
            "video_track_frame_count": candidate.get("video_track_frame_count", 0),
            "video_track_keyframe_timestamps_ms": json.dumps(candidate.get("video_track_keyframe_timestamps_ms", [])),
            "video_track_keyframe_indices": json.dumps(candidate.get("video_track_keyframe_indices", [])),
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
        candidate_total = 0
        try:
            if self._candidate_index_backed:
                self._flush_candidate_index()
                indexed_counts = self.db.candidate_status_counts()
                for key in status_counts:
                    status_counts[key] = int(indexed_counts.get(key, 0) or 0)
                candidate_total = int(indexed_counts.get("total", 0) or 0)
        except sqlite3.Error:
            candidate_total = 0
        if not candidate_total:
            for candidate in self._iter_authoritative_candidates(order="status"):
                status = str(candidate.status or "")
                if status in status_counts:
                    status_counts[status] += 1
                candidate_total += 1
        counts = {
            "references": len(self.references),
            "candidates": candidate_total,
            **status_counts,
        }
        header_payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": counts,
            "config": asdict(self.config),
            "scanHistory": self.scan_history[:80],
            "references": [self._reference_summary(ref) for ref in sorted(self.references.values(), key=lambda item: (item.person_name.lower(), item.age_bucket, item.source_path))],
        }

        def candidate_payloads() -> Iterable[dict[str, Any]]:
            for candidate in self._iter_authoritative_candidates(order="status"):
                yield asdict(candidate)

        def stream_report(handle) -> None:
            handle.write("{")
            first_field = True
            for key, value in header_payload.items():
                if first_field:
                    first_field = False
                else:
                    handle.write(",")
                handle.write(json.dumps(str(key), separators=(",", ":")))
                handle.write(":")
                handle.write(json.dumps(value, separators=(",", ":")))
            handle.write(",\"candidates\":[")
            first_candidate = True
            for candidate in candidate_payloads():
                if first_candidate:
                    first_candidate = False
                else:
                    handle.write(",")
                handle.write(json.dumps(candidate, separators=(",", ":")))
            handle.write("]}")

        atomic_write(json_path, stream_report)
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=self._candidate_csv_fieldnames(),
            )
            writer.writeheader()
            for candidate in candidate_payloads():
                writer.writerow(self._candidate_csv_row(candidate))
        self._append_audit({"action": "export_report", "json_path": str(json_path), "csv_path": str(csv_path)})
        return {
            "jsonPath": str(json_path),
            "csvPath": str(csv_path),
            "counts": counts,
        }

    def export_candidates(self, candidate_ids: list[str], folder: Path | None = None) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(str(candidate_id) for candidate_id in candidate_ids if str(candidate_id).strip()))
        if not unique_ids:
            raise ValueError("Select at least one candidate to export.")
        self._ensure_candidates_loaded(unique_ids)
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

    def _media_path_lookup_values(self, path: Path, resolved: Path | None = None) -> set[str]:
        raw = path.expanduser()
        values = {str(raw)}
        if not raw.is_absolute():
            try:
                values.add(str(raw.absolute()))
            except OSError:
                pass
        if resolved is not None:
            values.add(str(resolved))
        return {value for value in values if value}

    def _candidate_media_source_lookup_values(self, candidate: ReviewCandidate) -> set[str]:
        return self._media_path_lookup_values(self._candidate_media_source(candidate))

    def _candidate_media_source_matches(self, source_paths: Iterable[str]) -> list[ReviewCandidate]:
        lookup_values = {str(path or "").strip() for path in source_paths if str(path or "").strip()}
        if not lookup_values:
            return []
        candidates_by_id: dict[str, ReviewCandidate] = {}
        if self._candidate_index_backed:
            self._flush_candidate_index()
            try:
                for payload in self.db.iter_candidate_payloads_for_source_paths(lookup_values):
                    candidate = self._candidate_from_payload(payload)
                    if candidate is not None:
                        candidates_by_id[candidate.candidate_id] = candidate
                return list(candidates_by_id.values())
            except sqlite3.Error:
                pass
        for candidate in self.candidates.values():
            if self._candidate_media_source_lookup_values(candidate) & lookup_values:
                candidates_by_id[candidate.candidate_id] = candidate
        return list(candidates_by_id.values())

    def _candidate_media_source_match_count(self, source_paths: Iterable[str]) -> int:
        return len(self._candidate_media_source_matches(source_paths))

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
        self._ensure_candidates_loaded(unique_ids)
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
        reference_lookup_values: set[str] = set()
        for ref in self.references.values():
            if ref.source_path:
                reference_lookup_values.update(self._media_path_lookup_values(Path(ref.source_path)))
        generated_roots = [safe_resolve(self.previews_path), safe_resolve(self.video_frames_path)]
        seen_sources: dict[str, dict[str, Any]] = {}
        actionable_source_lookup_values: set[str] = set()
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
            source_lookup_values = self._media_path_lookup_values(source, resolved_source)
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
                    elif action in {"move", "trash"} and source_lookup_values & reference_lookup_values:
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
                    actionable_source_lookup_values.update(source_lookup_values)
                else:
                    counts["skipped"] += 1
                    result = "skipped"
                seen_sources[source_key] = {"actionable": actionable, "reason": reason, "sizeBytes": size_bytes}
            if action in {"move", "trash"} and actionable:
                actionable_source_lookup_values.update(source_lookup_values)
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

        if action in {"move", "trash"} and actionable_source_lookup_values:
            counts["removedCandidatesEstimate"] = self._candidate_media_source_match_count(actionable_source_lookup_values)

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

        reference_lookup_values: set[str] = set()
        for ref in self.references.values():
            if ref.source_path:
                reference_lookup_values.update(self._media_path_lookup_values(Path(ref.source_path)))
        copied_or_moved_sources: dict[str, dict[str, Any]] = {}
        affected_source_lookup_values: set[str] = set()
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
            source_lookup_values = self._media_path_lookup_values(source, resolved_source)
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
                    affected_source_lookup_values.update(source_lookup_values)
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
            if action in {"move", "trash"} and source_lookup_values & reference_lookup_values:
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
                    affected_source_lookup_values.update(source_lookup_values)
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

        if action in {"move", "trash"} and affected_source_lookup_values:
            removed_candidate_payloads = []
            for candidate in self._candidate_media_source_matches(affected_source_lookup_values):
                removable_candidate_ids.add(candidate.candidate_id)
                removed_candidate_payloads.append(asdict(candidate))
            self._mark_candidates_deleted(removable_candidate_ids)
            self._forget_candidates(removable_candidate_ids)
            counts["removedCandidates"] = len(removable_candidate_ids)
        else:
            removed_candidate_payloads = []

        manifest = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "action": action,
            "destinationPath": str(action_root),
            "mediaPath": str(media_root),
            "counts": counts,
            "items": items,
            "removedCandidates": removed_candidate_payloads,
            "note": (
                "Trash is app-managed: recover files from this folder if needed."
                if action == "trash"
                else "Copy and move actions operate on original source media, not face vectors."
            ),
        }
        manifest_path = action_root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        self._write_media_action_manifest_summary(manifest, manifest_path)
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

    def _media_action_summary_path(self, manifest_path: Path) -> Path:
        return manifest_path.expanduser().resolve().with_name("manifest-summary.json")

    def _media_action_manifest_summary(self, manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
        counts = manifest.get("counts") if isinstance(manifest.get("counts"), dict) else {}
        items = manifest.get("items") if isinstance(manifest.get("items"), list) else []
        skipped_items = [
            item
            for item in items
            if isinstance(item, dict) and str(item.get("result", "")) == "skipped"
        ][:8]
        return {
            "manifestPath": str(manifest_path.expanduser().resolve()),
            "generatedAt": manifest.get("generatedAt", ""),
            "workspace": str(manifest.get("workspace", "") or ""),
            "action": manifest.get("action", ""),
            "destinationPath": manifest.get("destinationPath", ""),
            "mediaPath": manifest.get("mediaPath", ""),
            "undoneAt": str(manifest.get("undoneAt", "") or ""),
            "undoManifestPath": str(manifest.get("undoManifestPath", "") or ""),
            "counts": counts,
            "skippedItems": skipped_items,
        }

    def _write_media_action_manifest_summary(self, manifest: dict[str, Any], manifest_path: Path) -> None:
        summary = self._media_action_manifest_summary(manifest, manifest_path)
        self._write_json_atomic(self._media_action_summary_path(manifest_path), summary)

    def _read_media_action_summary(self, manifest_path: Path) -> dict[str, Any]:
        path = self._media_action_summary_path(manifest_path)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        if str(payload.get("workspace", "")) != str(self.root):
            return {}
        return payload

    def media_action_history(self, limit: int = 20) -> dict[str, Any]:
        limit = max(1, min(100, int(limit)))
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for event in self._iter_audit_rows_reverse():
            if event.get("action") != "manage_candidate_media":
                continue
            manifest_value = str(event.get("manifest_path", "")).strip()
            if not manifest_value or manifest_value in seen:
                continue
            seen.add(manifest_value)
            manifest_path = Path(manifest_value)
            manifest: dict[str, Any] = {}
            if manifest_path.exists():
                manifest = self._read_media_action_summary(manifest_path)
                if not manifest:
                    try:
                        full_manifest = self._read_media_action_manifest(manifest_path)
                        manifest = self._media_action_manifest_summary(full_manifest, manifest_path)
                        self._write_media_action_manifest_summary(full_manifest, manifest_path)
                    except Exception:
                        manifest = {}
            counts = manifest.get("counts") if isinstance(manifest.get("counts"), dict) else {}
            skipped_items = manifest.get("skippedItems") if isinstance(manifest.get("skippedItems"), list) else []
            undone_at = str(manifest.get("undoneAt", "") or "")
            row = {
                "manifestPath": manifest_value,
                "generatedAt": manifest.get("generatedAt") or event.get("at", ""),
                "action": manifest.get("action") or event.get("media_action", ""),
                "destinationPath": manifest.get("destinationPath") or "",
                "mediaPath": manifest.get("mediaPath") or "",
                "undoneAt": undone_at,
                "undoManifestPath": str(manifest.get("undoManifestPath", "") or ""),
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
                "canRestore": bool(not undone_at and (manifest.get("action") or event.get("media_action")) == "trash" and int(counts.get("trashed", event.get("trashed", 0)) or 0) > 0),
                "canUndo": bool(not undone_at and manifest_path.exists() and (int(counts.get("copied", 0) or 0) + int(counts.get("moved", 0) or 0) + int(counts.get("trashed", 0) or 0)) > 0),
                "canRetry": bool(skipped_items),
                "skippedItems": skipped_items[:8],
            }
            rows.append(row)
            if len(rows) >= limit:
                break
        return {"items": rows, "total": len(rows)}

    def _encode_audit_line(self, row: dict[str, Any]) -> bytes:
        plaintext = json.dumps(row, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if not self.workspace_encryption.enabled:
            return plaintext + b"\n"
        envelope = self.workspace_encryption.encrypt_bytes(plaintext, role=AUDIT_ENCRYPTION_ROLE)
        return AUDIT_ENCRYPTED_PREFIX + base64.b64encode(envelope) + b"\n"

    def _decode_audit_line(self, raw: bytes) -> dict[str, Any] | None:
        stripped = raw.strip()
        if not stripped:
            return None
        if stripped.startswith(AUDIT_ENCRYPTED_PREFIX):
            try:
                envelope = base64.b64decode(stripped[len(AUDIT_ENCRYPTED_PREFIX):], validate=True)
                plaintext = self.workspace_encryption.decrypt_bytes(envelope, role=AUDIT_ENCRYPTION_ROLE)
                value = json.loads(plaintext.decode("utf-8"))
            except WorkspaceEncryptionError:
                raise
            except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                raise WorkspaceEncryptionError("Encrypted audit event failed authentication or decoding.") from exc
        else:
            try:
                value = json.loads(stripped.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
        return value if isinstance(value, dict) else None

    def _iter_audit_rows_reverse(self, chunk_size: int = 65536) -> Iterable[dict[str, Any]]:
        if not self.audit_path.exists():
            return
        try:
            with self.audit_path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                position = handle.tell()
                pending = b""
                while position > 0:
                    read_size = min(max(1024, int(chunk_size)), position)
                    position -= read_size
                    handle.seek(position)
                    chunk = handle.read(read_size)
                    lines = (chunk + pending).splitlines()
                    if position > 0:
                        pending = lines[0] if lines else chunk + pending
                        lines = lines[1:]
                    else:
                        pending = b""
                    for raw in reversed(lines):
                        stripped = raw.strip()
                        if not stripped:
                            continue
                        value = self._decode_audit_line(stripped)
                        if value is not None:
                            yield value
        except OSError:
            return

    def restore_media_action(self, manifest_path: Path) -> dict[str, Any]:
        manifest = self._read_media_action_manifest(manifest_path)
        if str(manifest.get("action", "")) != "trash":
            raise ValueError("Only app trash actions can be restored.")
        restored = skipped = missing = existing = 0
        restored_candidates = 0
        candidate_restore_skipped = 0
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
        for payload in manifest.get("removedCandidates", []):
            if not isinstance(payload, dict):
                candidate_restore_skipped += 1
                continue
            try:
                candidate = ReviewCandidate(**payload)
            except TypeError:
                candidate_restore_skipped += 1
                continue
            if not valid_candidate(candidate):
                candidate_restore_skipped += 1
                continue
            if candidate.candidate_id in self.candidates:
                candidate_restore_skipped += 1
                continue
            try:
                media_source = self._candidate_media_source(candidate).expanduser()
                media_exists = media_source.exists() and media_source.is_file()
            except OSError:
                media_exists = False
            if not media_exists:
                candidate_restore_skipped += 1
                continue
            self.candidates[candidate.candidate_id] = candidate
            self._mark_candidate_dirty(candidate.candidate_id)
            restored_candidates += 1
        if restored_candidates:
            self.save()
        result = {
            "manifestPath": str(manifest_path.expanduser().resolve()),
            "counts": {
                "restored": restored,
                "missing": missing,
                "existing": existing,
                "skipped": skipped,
                "restoredCandidates": restored_candidates,
                "candidateRestoreSkipped": candidate_restore_skipped,
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
            "restoredCandidates": 0,
            "candidateRestoreSkipped": 0,
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
        if action in {"move", "trash"}:
            for payload in manifest.get("removedCandidates", []):
                if not isinstance(payload, dict):
                    counts["candidateRestoreSkipped"] += 1
                    continue
                try:
                    candidate = ReviewCandidate(**payload)
                except TypeError:
                    counts["candidateRestoreSkipped"] += 1
                    continue
                if not valid_candidate(candidate):
                    counts["candidateRestoreSkipped"] += 1
                    continue
                if candidate.candidate_id in self.candidates:
                    counts["candidateRestoreSkipped"] += 1
                    continue
                try:
                    media_source = self._candidate_media_source(candidate).expanduser()
                    media_exists = media_source.exists() and media_source.is_file()
                except OSError:
                    media_exists = False
                if not media_exists:
                    counts["candidateRestoreSkipped"] += 1
                    continue
                self.candidates[candidate.candidate_id] = candidate
                self._mark_candidate_dirty(candidate.candidate_id)
                counts["restoredCandidates"] += 1
            if counts["restoredCandidates"]:
                self.save()
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
        manifest["undoneAt"] = undo_manifest["generatedAt"]
        manifest["undoManifestPath"] = str(undo_manifest_path)
        manifest["undoCounts"] = counts
        target_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        self._write_media_action_manifest_summary(manifest, target_manifest)
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
            "videoTrackObservations",
            "videoTracks",
            "videoTrackTemplates",
            "videoTrackSingletons",
            "videoTrackKeyframes",
            "videoTrackMatches",
            "videoTrackUnmatched",
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
            "ageGapRelaxedReviews",
            "syntheticAgeEvidence",
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
        try:
            indexed_candidates = self.db.candidate_count()
        except sqlite3.Error:
            indexed_candidates = 0
        use_candidate_index = (
            indexed_candidates >= len(self.candidates)
            and indexed_candidates > 0
            and not self._candidate_dirty_ids
            and not self._candidate_deleted_ids
        )
        candidate_count = indexed_candidates if indexed_candidates >= len(self.candidates) else len(self.candidates)
        header_payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root),
            "counts": {
                "references": len(self.references),
                "candidates": candidate_count,
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
        }

        def candidate_rows() -> Iterable[ReviewCandidate]:
            if use_candidate_index:
                try:
                    for row in self.db.iter_candidate_payloads():
                        try:
                            candidate = ReviewCandidate(**row)
                        except TypeError:
                            continue
                        if valid_candidate(candidate):
                            yield candidate
                    return
                except sqlite3.Error:
                    pass
            yield from sorted(self.candidates.values(), key=lambda item: (item.status, item.person_name.lower(), -item.score))

        def candidate_payload(candidate: ReviewCandidate) -> dict[str, Any]:
            return {
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

        def stream_inventory(handle) -> None:
            handle.write("{")
            first_field = True
            for key, value in header_payload.items():
                if not first_field:
                    handle.write(",")
                first_field = False
                handle.write(json.dumps(str(key), separators=(",", ":")))
                handle.write(":")
                handle.write(json.dumps(value, separators=(",", ":")))
            handle.write(",\"candidates\":[")
            first_candidate = True
            for candidate in candidate_rows():
                if first_candidate:
                    first_candidate = False
                else:
                    handle.write(",")
                handle.write(json.dumps(candidate_payload(candidate), separators=(",", ":")))
            handle.write("]}")

        atomic_write(json_path, stream_inventory)
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["folder", "references", "candidates", "videos", "missing", "bytes"],
            )
            writer.writeheader()
            for row in folder_rows:
                writer.writerow(row)
        self._append_audit({"action": "export_workspace_inventory", "json_path": str(json_path), "csv_path": str(csv_path), "folders": len(folder_rows)})
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": header_payload["counts"]}

    def export_audit_log(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-activity-log-{stamp}.json"
        csv_path = export_root / f"vintrace-activity-log-{stamp}.csv"
        event_count = sum(1 for _row in self._iter_audit_rows_forward())
        chain = self.verify_audit_chain()
        header_payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspaceId": str(self.workspace_metadata.get("workspaceId", "")),
            "counts": {"events": event_count},
            "chain": chain,
        }

        def stream_audit_log(handle) -> None:
            handle.write("{")
            first_field = True
            for key, value in header_payload.items():
                if first_field:
                    first_field = False
                else:
                    handle.write(",")
                handle.write(json.dumps(str(key), separators=(",", ":")))
                handle.write(":")
                handle.write(json.dumps(value, separators=(",", ":")))
            handle.write(",\"events\":[")
            first_event = True
            for row in self._iter_audit_rows_forward():
                if first_event:
                    first_event = False
                else:
                    handle.write(",")
                handle.write(json.dumps(row, separators=(",", ":")))
            handle.write("]}")

        atomic_write(json_path, stream_audit_log)
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["at", "action", "summary", "json"])
            writer.writeheader()
            for row in self._iter_audit_rows_forward():
                action = str(row.get("action") or row.get("status") or "event")
                summary = " • ".join(str(row.get(key)) for key in ("personRef", "source", "status", "count") if row.get(key) not in (None, ""))
                writer.writerow({"at": row.get("at", ""), "action": action, "summary": summary, "json": json.dumps(row, separators=(",", ":"))})
        self._append_audit(
            {
                "action": "export_audit_log",
                "jsonSha256": sha256_file(json_path),
                "csvSha256": sha256_file(csv_path),
                "events": event_count,
            }
        )
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": header_payload["counts"]}

    def _iter_audit_rows_forward(self) -> Iterable[dict[str, Any]]:
        if not self.audit_path.exists():
            return
        try:
            with self.audit_path.open("rb") as handle:
                for raw in handle:
                    value = self._decode_audit_line(raw)
                    if value is not None:
                        yield value
        except OSError:
            return

    def _read_audit_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not self.audit_path.exists():
            return rows
        try:
            rows.extend(self._iter_audit_rows_forward())
        except OSError:
            return []
        return rows

    def _audit_event_count(self) -> int:
        if not self.audit_path.exists():
            return 0
        try:
            return sum(1 for _ in self._iter_audit_rows_forward())
        except OSError:
            return 0

    def export_biometric_retention_policy(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-biometric-retention-policy-{stamp}.json"
        markdown_path = export_root / f"vintrace-biometric-retention-policy-{stamp}.md"
        html_path = export_root / f"vintrace-biometric-retention-policy-{stamp}.html"
        base_policy = self.biometric_retention_policy()
        publication = base_policy.get("publication") if isinstance(base_policy.get("publication"), dict) else {}
        policy = {
            **base_policy,
            "generatedAt": now_iso(),
            "workspaceId": str(self.workspace_metadata.get("workspaceId", "")),
            "aiDisclosure": AI_DISCLOSURE_NOTICE,
            "operatorApproval": {
                "organization": "",
                "approvedBy": str(publication.get("approvedBy", "")),
                "approvedAt": publication.get("recordedAt") or "",
                "publishedAt": publication.get("publishedAt") or "",
                "publicUrl": str(publication.get("publicUrl", "")),
            },
        }
        policy_hash = str(base_policy["policyHash"])
        document_hash = hashlib.sha256(
            json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        policy["documentHash"] = document_hash
        atomic_write_text(json_path, json.dumps(policy, indent=2, sort_keys=True, ensure_ascii=False))

        schedule = policy["schedule"]
        sources = policy.get("sources", []) if isinstance(policy.get("sources"), list) else []
        source_markdown = "\n".join(
            f"- [{str(row.get('label', 'Source'))}]({str(row.get('url', ''))})"
            for row in sources
            if isinstance(row, dict) and str(row.get("url", "")).startswith("https://")
        ) or "- No jurisdiction-specific source is attached to the standard template."
        markdown = (
            f"# {policy['title']}\n\n"
            f"**Policy version:** `{policy['policyVersion']}`  \n"
            f"**Policy hash:** `{policy_hash}`  \n"
            f"**Jurisdiction template:** `{policy['jurisdictionPreset']}`  \n"
            f"**Automatic enforcement:** `{policy['enforcementEnabled']}`\n\n"
            "## Scope\n\n"
            "Vintrace stores local numeric face templates and human-review records. This schedule does not authorize collection, "
            "does not change source photos, and is not a substitute for a jurisdiction-specific legal review.\n\n"
            "## Destruction schedule\n\n"
            f"- Subject templates: destroy on {', '.join(schedule['subjectTemplates']['destroyOn'])}.\n"
            f"- Maximum after last interaction: {schedule['subjectTemplates']['maximumDaysAfterLastInteraction'] or 'operator/counsel-defined; no fixed term is asserted by this template'}.\n"
            f"- Reviewed match rows: {schedule['reviewedMatches']['retainDays']} days.\n"
            f"- Pending match rows: {schedule['pendingMatches']['retainDays']} days.\n"
            f"- Pseudonymous audit evidence: {schedule['auditEvidence']['retainDays']} days.\n"
            "- Source photos and videos are outside biometric erasure and remain under the operator's media policy.\n\n"
            "## Method\n\n"
            f"{policy['destructionMethod']}\n\n"
            "## AI notice\n\n"
            f"{AI_DISCLOSURE_NOTICE['summary']} {AI_DISCLOSURE_NOTICE['decisionBoundary']}\n\n"
            "## Official sources\n\n"
            f"{source_markdown}\n\n"
            "## Approval and publication\n\n"
            f"Organization: ____________________  \nApproved by: {publication.get('approvedBy') or '____________________'}  \n"
            f"Recorded at: {publication.get('recordedAt') or '____________________'}  \n"
            f"Published at: {publication.get('publishedAt') or '____________________'}  \n"
            f"Public URL: {publication.get('publicUrl') or '____________________'}\n\n"
            f"> {policy['disclaimer']}\n"
        )
        atomic_write_text(markdown_path, markdown)
        html_sources = "".join(
            f'<li><a href="{html.escape(str(row.get("url", "")), quote=True)}">{html.escape(str(row.get("label", "Source")))}</a></li>'
            for row in sources
            if isinstance(row, dict) and str(row.get("url", "")).startswith("https://")
        ) or "<li>No jurisdiction-specific source is attached to the standard template.</li>"
        html_document = f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(str(policy['title']))}</title>
<style>body{{font:16px/1.55 system-ui,sans-serif;max-width:52rem;margin:3rem auto;padding:0 1.25rem;color:#17191c}}h1,h2{{line-height:1.2}}code{{overflow-wrap:anywhere}}.notice{{border-left:4px solid #355c7d;padding:.75rem 1rem;background:#f4f7fa}}@media(max-width:600px){{body{{margin:1.5rem auto}}}}</style></head>
<body><main><h1>{html.escape(str(policy['title']))}</h1>
<p><strong>Policy version:</strong> <code>{html.escape(str(policy['policyVersion']))}</code><br><strong>Policy hash:</strong> <code>{policy_hash}</code><br><strong>Jurisdiction template:</strong> {html.escape(str(policy['jurisdictionPreset']))}<br><strong>Automatic enforcement:</strong> {str(bool(policy['enforcementEnabled'])).lower()}</p>
<h2>Scope</h2><p>Vintrace stores local numeric face templates and human-review records. This schedule does not authorize collection, alter source media, or replace legal review.</p>
<h2>Destruction schedule</h2><ul><li>Subject templates: destroy on {html.escape(', '.join(schedule['subjectTemplates']['destroyOn']))}.</li><li>Maximum after last interaction: {html.escape(str(schedule['subjectTemplates']['maximumDaysAfterLastInteraction'] or 'operator/counsel-defined'))}.</li><li>Reviewed match rows: {schedule['reviewedMatches']['retainDays']} days.</li><li>Pending match rows: {schedule['pendingMatches']['retainDays']} days.</li><li>Pseudonymous audit evidence: {schedule['auditEvidence']['retainDays']} days.</li><li>Source photos and videos remain under the operator's media policy.</li></ul>
<h2>Method</h2><p>{html.escape(str(policy['destructionMethod']))}</p><h2>AI notice</h2><p>{html.escape(str(AI_DISCLOSURE_NOTICE['summary']))} {html.escape(str(AI_DISCLOSURE_NOTICE['decisionBoundary']))}</p>
<h2>Official sources</h2><ul>{html_sources}</ul><h2>Approval and publication</h2><p>Organization: ____________________<br>Approved by: {html.escape(str(publication.get('approvedBy') or '____________________'))}<br>Recorded at: {html.escape(str(publication.get('recordedAt') or '____________________'))}<br>Published at: {html.escape(str(publication.get('publishedAt') or '____________________'))}<br>Public URL: {html.escape(str(publication.get('publicUrl') or '____________________'))}</p><p class="notice">{html.escape(str(policy['disclaimer']))}</p></main></body></html>"""
        atomic_write_text(html_path, html_document)
        self._append_audit(
            {
                "action": "export_biometric_retention_policy",
                "policyVersion": policy["policyVersion"],
                "policyHash": policy_hash,
                "jurisdictionPreset": policy["jurisdictionPreset"],
            }
        )
        return {
            "jsonPath": str(json_path),
            "markdownPath": str(markdown_path),
            "htmlPath": str(html_path),
            "policyHash": policy_hash,
            "documentHash": document_hash,
            "policyVersion": policy["policyVersion"],
        }

    def export_consent_receipt(self, folder: Path | None = None) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-consent-receipt-{stamp}.json"
        csv_path = export_root / f"vintrace-consent-receipt-{stamp}.csv"
        consent_events = [
            row
            for row in self._read_audit_rows()
            if row.get("action") in {
                "set_consent",
                "set_subject_consent",
                "acknowledge_ai_disclosure",
                "record_biometric_policy_publication",
                "delete_subject_data",
            }
        ]
        try:
            candidate_counts = self.db.candidate_status_counts() if self._candidate_index_backed else {}
        except sqlite3.Error:
            candidate_counts = {}
        if not candidate_counts:
            pending_count = sum(1 for candidate in self.candidates.values() if candidate.status == "pending")
            reviewed_count = sum(1 for candidate in self.candidates.values() if candidate.status != "pending")
            candidate_total = len(self.candidates)
        else:
            pending_count = int(candidate_counts.get("pending", 0) or 0)
            reviewed_count = int(candidate_counts.get("reviewed", 0) or 0)
            candidate_total = int(candidate_counts.get("total", 0) or 0)
        counts = {
            "references": len(self.references),
            "candidates": candidate_total,
            "people": len({ref.person_name.casefold() for ref in self.references.values()}),
            "pending": pending_count,
            "reviewed": reviewed_count,
            "scanRuns": len(self.scan_history),
            "consentEvents": len(consent_events),
            "subjectReleases": len(self.subject_consents()),
            "destructionReceipts": len(
                self.consent.get("destructionReceipts", [])
                if isinstance(self.consent.get("destructionReceipts"), list)
                else []
            ),
        }
        compliance = self.compliance_status()
        destruction_receipts = self.consent.get("destructionReceipts")
        if not isinstance(destruction_receipts, list):
            destruction_receipts = []
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "schemaVersion": 2,
            "workspaceId": str(self.workspace_metadata.get("workspaceId", "")),
            "consent": {
                **self.consent_summary(),
                "note": str(self.consent.get("note", "")),
                "workspaceId": self.consent.get("workspaceId"),
                "subjects": self.subject_consents(),
            },
            "policy": {
                "requireConsent": bool(self.config.require_consent),
                "perSubjectConsent": bool(self.config.per_subject_consent),
                "reviewOnly": bool(self.config.review_only),
                "safeMode": bool(self.config.safe_mode),
                "safeModeThreshold": float(self.config.safe_mode_threshold),
                "jurisdictionPreset": str(self.config.jurisdiction_preset),
                "retention": compliance["retentionPolicy"],
            },
            "aiDisclosure": compliance["aiDisclosure"],
            "evidenceReady": bool(compliance["evidenceReady"]),
            "destructionReceipts": destruction_receipts,
            "counts": counts,
            "latestConsentEvent": consent_events[-1] if consent_events else None,
            "consentEvents": consent_events,
            "note": "Receipt only. It does not include photos, videos, thumbnails, face vectors, or model files.",
        }
        atomic_write_text(json_path, json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False))
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow([
                "recordType", "subject", "active", "complete", "expired", "releaseId", "recordHash",
                "signer", "signerRole", "purpose", "collectionTermDays", "lawfulBasis", "confirmedAt", "expiresAt",
            ])
            writer.writerow([
                "workspace", "", payload["consent"]["active"], "", "", "", "", payload["consent"]["operator"],
                "operator", payload["consent"].get("scope", ""), "", "", payload["consent"].get("confirmedAt", ""), "",
            ])
            for record in compliance["subjects"]["records"]:
                writer.writerow([
                    "subject-release", record.get("personName", ""), record.get("active", False),
                    record.get("complete", False), record.get("expired", False), record.get("releaseId", ""),
                    record.get("recordHash", ""), record.get("signerName", ""), record.get("signerRole", ""),
                    record.get("specificPurpose", ""), record.get("collectionTermDays", ""), record.get("lawfulBasis", ""),
                    record.get("confirmedAt", ""), record.get("expiresAt", ""),
                ])
            for receipt in destruction_receipts:
                if not isinstance(receipt, dict):
                    continue
                writer.writerow([
                    "destruction-receipt", receipt.get("subjectRef", ""), False, "", "", receipt.get("receiptId", ""),
                    receipt.get("receiptHash", ""), "", "", receipt.get("reason", ""), "", "",
                    receipt.get("destroyedAt", ""), "",
                ])
        self._append_audit(
            {
                "action": "export_consent_receipt",
                "jsonSha256": sha256_file(json_path),
                "csvSha256": sha256_file(csv_path),
                "active": self.consent_on_file(),
            }
        )
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": counts}

    def retention_policy_report(self, *, now: datetime | None = None) -> dict[str, Any]:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        now_ts = current.astimezone(timezone.utc).timestamp()
        reviewed_window = int(self.config.retention_reviewed_days)
        pending_window = int(self.config.retention_pending_days)
        windows = sorted({30, 90, 180, 365, reviewed_window, pending_window})
        by_status = {"pending": 0, "accepted": 0, "rejected": 0, "uncertain": 0}
        reviewed = 0
        invalid_dates = 0
        oldest_reviewed_days = 0
        older_than = {str(days): 0 for days in windows}
        due_reviewed = 0
        due_pending = 0
        due_audit = self.audit_events_due_for_retention(int(self.config.retention_audit_days), now=current)
        for candidate in self._iter_authoritative_candidates(order="created"):
            by_status[candidate.status] = by_status.get(candidate.status, 0) + 1
            try:
                created_ts = datetime.fromisoformat(candidate.created_at.replace("Z", "+00:00")).timestamp()
            except (TypeError, ValueError):
                created_ts = 0.0
                invalid_dates += 1
            age_days = max(0, int((now_ts - created_ts) // (24 * 60 * 60))) if created_ts else 3650
            if candidate.status == "pending":
                if created_ts and age_days >= pending_window:
                    due_pending += 1
                continue
            reviewed += 1
            oldest_reviewed_days = max(oldest_reviewed_days, age_days)
            if created_ts and age_days >= reviewed_window:
                due_reviewed += 1
            for days in windows:
                if age_days >= days:
                    older_than[str(days)] += 1
        privacy = self.privacy_report()
        recommendations: list[str] = []
        if reviewed:
            recommendations.append("Export the review ledger before purging old reviewed matches.")
        if due_reviewed:
            recommendations.append(f"{due_reviewed} reviewed match row(s) have reached the configured {reviewed_window}-day destruction window.")
        if due_pending:
            recommendations.append(f"{due_pending} pending match row(s) have reached the configured {pending_window}-day destruction window.")
        if due_audit:
            recommendations.append(
                f"{due_audit} audit event(s) have reached the configured {int(self.config.retention_audit_days)}-day evidence window."
            )
        if privacy["generatedBytes"] > 512 * 1024 * 1024:
            recommendations.append("Generated previews and video frames are sizable; run Optimize app folder after exports.")
        if invalid_dates:
            recommendations.append("Some review rows have missing dates; export the ledger before cleanup.")
        if not recommendations:
            recommendations.append("No immediate retention cleanup is needed.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "counts": {
                "candidates": sum(by_status.values()),
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
                **self.biometric_retention_policy(),
                "recommendedReviewedRetentionDays": int(self.config.retention_reviewed_days),
                "jurisdictionPreset": str(self.config.jurisdiction_preset),
                "reviewedStatuses": ["accepted", "rejected", "uncertain"],
                "pendingRowsAreKept": not bool(self.config.retention_enforcement_enabled),
                "originalMediaIsNeverDeleted": True,
            },
            "due": {
                "reviewedCandidates": due_reviewed,
                "pendingCandidates": due_pending,
                "expiredSubjects": self.compliance_status()["subjects"]["expired"],
                "auditEvents": due_audit,
            },
            "recommendations": recommendations,
        }

    def enforce_retention_policy(
        self,
        *,
        source: str = "manual",
        now: datetime | None = None,
    ) -> dict[str, Any]:
        enabled = bool(self.config.retention_enforcement_enabled)
        result: dict[str, Any] = {
            "enabled": enabled,
            "source": str(source or "manual")[:80],
            "jurisdictionPreset": str(self.config.jurisdiction_preset),
            "expiredSubjectsDeleted": 0,
            "reviewedCandidatesDeleted": 0,
            "pendingCandidatesDeleted": 0,
            "auditEventsDeleted": 0,
            "destructionReceipts": [],
        }
        if not enabled:
            return result

        for record in list(self.subject_consents().values()):
            if not isinstance(record, dict) or not record.get("active"):
                continue
            if not release_is_expired(record, now=now):
                continue
            person_name = str(record.get("personName", "")).strip()
            if not person_name:
                continue
            deleted = self.delete_subject_data(
                person_name,
                confirm=True,
                reason="retention-release-expired",
                source=source,
            )
            result["expiredSubjectsDeleted"] += 1
            result["destructionReceipts"].append(deleted["receipt"])

        report = self.retention_policy_report(now=now)
        due = report.get("due") if isinstance(report.get("due"), dict) else {}
        if int(due.get("reviewedCandidates", 0) or 0) > 0:
            result["reviewedCandidatesDeleted"] = self.purge_old_candidates(
                int(self.config.retention_reviewed_days),
                statuses=["accepted", "rejected", "uncertain"],
            )
        if int(due.get("pendingCandidates", 0) or 0) > 0:
            result["pendingCandidatesDeleted"] = self.purge_old_candidates(
                int(self.config.retention_pending_days),
                statuses=["pending"],
            )
        if int(due.get("auditEvents", 0) or 0) > 0:
            audit_result = self.enforce_audit_retention(
                int(self.config.retention_audit_days),
                source=source,
                now=now,
            )
            result["auditEventsDeleted"] = int(audit_result.get("deleted", 0) or 0)
            result["auditCheckpointHash"] = str(audit_result.get("checkpointHash", ""))
        if (
            result["expiredSubjectsDeleted"]
            or result["reviewedCandidatesDeleted"]
            or result["pendingCandidatesDeleted"]
            or result["auditEventsDeleted"]
        ):
            self._append_audit(
                {
                    "action": "enforce_retention_policy",
                    "source": result["source"],
                    "jurisdictionPreset": result["jurisdictionPreset"],
                    "expiredSubjectsDeleted": result["expiredSubjectsDeleted"],
                    "reviewedCandidatesDeleted": result["reviewedCandidatesDeleted"],
                    "pendingCandidatesDeleted": result["pendingCandidatesDeleted"],
                    "auditEventsDeleted": result["auditEventsDeleted"],
                    "auditCheckpointHash": result.get("auditCheckpointHash", ""),
                    "receiptIds": [row.get("receiptId", "") for row in result["destructionReceipts"]],
                }
            )
        return result

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
                "safeModeMultimodal": bool(self.config.safe_mode_multimodal),
                "safeModeZeroAdmittance": bool(self.config.safe_mode_zero_admittance),
                "faceCropCarveOutActive": not bool(self.config.safe_mode_zero_admittance),
                "protectedMediaExcludedFromMatching": True,
                "protectedMediaExcludedFromClustering": True,
                "originalMediaIsNeverModified": True,
            },
            "model": safety_model_report(multimodal_enabled=self.config.safe_mode_multimodal),
            "counts": {
                "scanRuns": len(self.scan_history),
                "safetyCacheEntries": int(scale.get("safetyCacheEntries", 0) or 0),
                "safeLabels": calibration.get("safeLabels", {}),
                **totals,
            },
            "runs": run_rows,
            "recommendations": [
                "Keep Safe Mode on for shared libraries.",
                "Enable category-aware Safe Mode only when the validated quality model and longer scan time are acceptable.",
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
        candidate_total = 0
        for candidate in self._iter_authoritative_candidates(order="status"):
            candidate_total += 1
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
                "candidates": candidate_total,
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
            if is_synthetic_age_reference(ref):
                bucket["syntheticReferenceCount"] = int(bucket.get("syntheticReferenceCount", 0)) + 1
            else:
                bucket["realReferenceCount"] = int(bucket.get("realReferenceCount", 0)) + 1
            if self._compatible_reference_model_name(current, ref.model_name):
                bucket["compatibleReferences"] += 1
            else:
                bucket["otherModelReferences"] += 1
            pose = self._normalized_pose_bucket(ref.pose_bucket)
            pose_key = {"three-quarter": "threeQuarter", "edge-face": "edgeFace"}.get(pose, pose)
            bucket["poseCounts"][pose_key] = int(bucket["poseCounts"].get(pose_key, 0)) + 1
            age = str(ref.age_bucket or "unknown").strip() or "unknown"
            age_key = f"synthetic:{age}" if is_synthetic_age_reference(ref) else age
            bucket["ageBuckets"][age_key] = int(bucket["ageBuckets"].get(age_key, 0)) + 1
            quality = max(0.0, min(1.0, float(ref.quality or 0.0)))
            quality_sums[person_key] = quality_sums.get(person_key, 0.0) + quality
            bucket["bestQuality"] = max(float(bucket["bestQuality"]), quality)
            if len(bucket["sampleReferenceNames"]) < 3:
                bucket["sampleReferenceNames"].append(Path(ref.source_path).name)

        for candidate in self._iter_authoritative_candidates(order="status"):
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
            age_bucket_count = sum(
                1
                for age, count in bucket["ageBuckets"].items()
                if not str(age).startswith("synthetic:") and int(count) > 0
            )
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
            for candidate in sorted(
                self._iter_authoritative_candidates(order="status"),
                key=lambda item: (item.status, item.person_name.lower(), -item.score),
            )
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
            self._ensure_candidates_loaded(unique_ids)
            selected = [self.candidates[candidate_id] for candidate_id in unique_ids if candidate_id in self.candidates]
            missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
            if missing:
                raise KeyError(f"Candidate not found: {missing[0]}")
        else:
            selected = list(self._iter_authoritative_candidates(statuses=status_set, order="status"))
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
            for candidate in self._iter_authoritative_candidates(statuses={"accepted", "rejected"}, order="status")
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
            # This pack uses synthetic fixtures with predetermined scores to self-test
            # the gate/label plumbing -- it is NOT a measurement of recognition accuracy.
            "fixture": True,
            "disclaimer": "Self-test fixture with synthetic scores; not a measurement of recognition accuracy. " + BENCHMARK_DISCLAIMER,
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

    # Minimum labels (and per-class minimum) before fitting a calibrator. The legacy
    # writer fired at 8 labels off a min-positive/max-negative midpoint, which a single
    # overlapping hard negative could push the wrong way; this is the documented fix.
    CALIBRATION_MIN_LABELS = 20
    CALIBRATION_MIN_PER_CLASS = 5
    ADAPTIVE_CALIBRATION_MIN_LABELS = 80
    ADAPTIVE_CALIBRATION_MIN_PER_CLASS = 20
    CALIBRATION_AUTO_STAGE_MIN_NEW_LABELS = 10
    ADAPTER_MIN_LABELS = 100
    ADAPTER_MIN_PER_CLASS = 25
    ADAPTER_CONTEXT_TARGETS = (
        {
            "id": "negative-cross-pose-low-score",
            "label": "Rejected low-score hard-pose matches",
            "desiredLabel": "negative",
            "minCount": 5,
            "action": "Review and reject low-score profile or three-quarter possible matches.",
        },
        {
            "id": "positive-cross-pose-hard",
            "label": "Accepted hard-pose matches",
            "desiredLabel": "positive",
            "minCount": 5,
            "action": "Review and accept real profile or three-quarter matches.",
        },
        {
            "id": "negative-video-low-score",
            "label": "Rejected low-score video-frame matches",
            "desiredLabel": "negative",
            "minCount": 3,
            "action": "Review and reject low-score video-frame possible matches.",
        },
        {
            "id": "positive-video",
            "label": "Accepted video-frame matches",
            "desiredLabel": "positive",
            "minCount": 3,
            "action": "Review and accept real video-frame matches.",
        },
        {
            "id": "negative-cross-age-low-score",
            "label": "Rejected low-score cross-age matches",
            "desiredLabel": "negative",
            "minCount": 3,
            "action": "Review and reject low-score cross-age possible matches.",
        },
        {
            "id": "positive-cross-age",
            "label": "Accepted cross-age matches",
            "desiredLabel": "positive",
            "minCount": 3,
            "action": "Review and accept real cross-age matches.",
        },
        {
            "id": "negative-unknown-or-zero-score",
            "label": "Rejected unknown-pose or zero-score matches",
            "desiredLabel": "negative",
            "minCount": 5,
            "action": "Review and reject unknown-pose or zero-score possible matches.",
        },
    )
    REFERENCE_SUGGESTION_MIN_QUALITY = 0.55
    REFERENCE_SUGGESTION_MIN_IED_PX = 24.0
    REFERENCE_SUGGESTION_MAX_ALIGN_ERROR = 0.18
    REFERENCE_SUGGESTION_DUPLICATE_COSINE = 0.995
    REFERENCE_SUGGESTION_OUTLIER_MIN_COSINE = 0.20
    # Target false-match rates that define each band's operating point on the user's
    # own labeled impostors (recall-first cross-age band tolerates more false matches).
    CALIBRATION_TARGET_FMR = {"confident": 0.01, "likely": 0.10, "relaxed_child": 0.30}

    def _workspace_state_lock_active(self) -> bool:
        try:
            if not self.lock_path.exists():
                return False
            return time.time() - self.lock_path.stat().st_mtime <= 45
        except OSError:
            return False

    def _require_learning_consent(self, action: str = "running learning jobs") -> None:
        if self._workspace_state_lock_active():
            raise ValueError("Workspace state is locked; try again after the current operation finishes.")
        if str(getattr(self.config, "learning_mode", "manual") or "manual") == "off":
            raise ValueError("Learning mode is Off; choose Manual suggestions or Auto-stage before running learning.")
        if self.config.require_consent and not self.consent_on_file():
            raise ValueError(f"Consent must be active before {action}.")

    def _calibration_scoped_rows(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, int]:
        all_rows = self.db.calibration_label_rows()
        # Phase 3.4: cosines from different recognizers live in different embedding
        # spaces, so fit on the dominant model's labels and TAG the result with it.
        # Legacy/imported labels may be untagged; keep them with the dominant scope
        # instead of discarding a useful local validation set after the first tagged
        # review decision lands.
        models = [str(row.get("modelName") or "") for row in all_rows if row.get("modelName")]
        dominant_model = max(set(models), key=models.count) if models else ""
        rows = [
            row for row in all_rows
            if str(row.get("modelName") or "") in {"", dominant_model}
        ] if dominant_model else all_rows
        dropped = sum(
            1 for row in all_rows
            if str(row.get("modelName") or "") not in {"", dominant_model}
        ) if dominant_model else 0
        return all_rows, rows, dominant_model, dropped

    def _calibration_training_hash(self, rows: list[dict[str, Any]]) -> str:
        payload = json.dumps(rows, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _calibration_validation_regressed(self, validation: dict[str, Any]) -> bool:
        return "baselineAccuracy" in validation and float(validation.get("delta", 0.0)) < -0.02

    def _calibration_learning_readiness(
        self,
        rows: list[dict[str, Any]] | None = None,
        dominant_model: str = "",
        dropped: int = 0,
    ) -> dict[str, Any]:
        if rows is None:
            _, rows, dominant_model, dropped = self._calibration_scoped_rows()
        current_hash = self._calibration_training_hash(rows)
        latest = self.db.latest_learned_artifact("calibration")
        latest_hash = str(latest.get("training_data_hash", "") or "") if latest else ""
        latest_count = int(latest.get("input_count", 0) or 0) if latest else 0
        if latest_hash and latest_hash == current_hash:
            new_labels = 0
        elif latest:
            new_labels = max(0, len(rows) - latest_count)
        else:
            new_labels = len(rows)
        positives = sum(1 for row in rows if row.get("isMatch"))
        negatives = len(rows) - positives
        consent_required = bool(getattr(self.config, "require_consent", True))
        consent_active = bool(self.consent_on_file())
        learning_mode = str(getattr(self.config, "learning_mode", "manual") or "manual")
        ready = True
        reason = "Ready to stage a learned calibration artifact."
        if self._workspace_state_lock_active():
            ready = False
            reason = "Workspace state is locked; wait for the current operation to finish before running learning jobs."
        elif learning_mode == "off":
            ready = False
            reason = "Learning mode is Off."
        elif consent_required and not consent_active:
            ready = False
            reason = "Consent must be active before running learning jobs."
        elif len(rows) < self.CALIBRATION_MIN_LABELS or positives < self.CALIBRATION_MIN_PER_CLASS or negatives < self.CALIBRATION_MIN_PER_CLASS:
            ready = False
            reason = (
                "Review more accepted and rejected matches before staging calibration "
                f"(need {self.CALIBRATION_MIN_LABELS} labels with {self.CALIBRATION_MIN_PER_CLASS}+ of each)."
            )
        elif latest_hash and latest_hash == current_hash:
            ready = False
            reason = "Current reviewed feedback already has a calibration artifact."
        elif latest and new_labels < self.CALIBRATION_AUTO_STAGE_MIN_NEW_LABELS:
            ready = False
            remaining = self.CALIBRATION_AUTO_STAGE_MIN_NEW_LABELS - new_labels
            reason = f"Review at least {remaining} more accepted/rejected match{'' if remaining == 1 else 'es'} before auto-staging again."
        return {
            "ready": ready,
            "reason": reason,
            "labels": len(rows),
            "positiveLabels": positives,
            "negativeLabels": negatives,
            "labelsDroppedOtherModel": int(dropped),
            "dominantModel": dominant_model,
            "minimumLabels": self.CALIBRATION_MIN_LABELS,
            "minimumPerClass": self.CALIBRATION_MIN_PER_CLASS,
            "autoStageMinNewLabels": self.CALIBRATION_AUTO_STAGE_MIN_NEW_LABELS,
            "newLabelsSinceLastArtifact": new_labels,
            "currentTrainingDataHash": current_hash,
            "latestArtifactId": str(latest.get("artifact_id", "") or "") if latest else "",
            "latestArtifactStatus": str(latest.get("status", "") or "") if latest else "",
            "latestTrainingDataHash": latest_hash,
            "latestInputCount": latest_count,
            "consentRequired": consent_required,
            "consentActive": consent_active,
            "workspaceLocked": self._workspace_state_lock_active(),
            "learningMode": learning_mode,
        }

    def _build_calibration_candidate(self) -> dict[str, Any]:
        all_rows, rows, dominant_model, dropped = self._calibration_scoped_rows()
        calibrator = fit_score_calibrator(
            rows,
            min_count=self.CALIBRATION_MIN_LABELS,
            min_per_class=self.CALIBRATION_MIN_PER_CLASS,
            score_key="matchScore",
        )
        if calibrator is None:
            raise ValueError(
                "Review more accepted and rejected matches before applying calibration "
                f"(need at least {self.CALIBRATION_MIN_LABELS} labels with "
                f"{self.CALIBRATION_MIN_PER_CLASS}+ of each)."
            )
        scores = [float(row["matchScore"]) for row in rows]
        labels = [1.0 if row["isMatch"] else 0.0 for row in rows]

        def _band_threshold(target_fmr: float) -> float:
            return max(0.02, min(0.98, threshold_for_fmr(scores, labels, target_fmr)))

        confident = _band_threshold(self.CALIBRATION_TARGET_FMR["confident"])
        likely = _band_threshold(self.CALIBRATION_TARGET_FMR["likely"])
        relaxed = _band_threshold(self.CALIBRATION_TARGET_FMR["relaxed_child"])
        # Enforce strictly-descending bands (config validation requires it).
        likely = min(likely, confident)
        relaxed = min(relaxed, likely)
        validation = self.validate_calibration_change(rows=rows)
        adaptive_validation = validate_adaptive_calibration(
            rows,
            min_count=self.ADAPTIVE_CALIBRATION_MIN_LABELS,
            min_per_class=self.ADAPTIVE_CALIBRATION_MIN_PER_CLASS,
        )
        adaptive_calibrator = None
        if adaptive_validation.get("promote") is True:
            adaptive_calibrator = fit_adaptive_linear(
                rows,
                min_count=self.ADAPTIVE_CALIBRATION_MIN_LABELS,
                min_per_class=self.ADAPTIVE_CALIBRATION_MIN_PER_CLASS,
                model_name=dominant_model,
            )
            if adaptive_calibrator is None:
                adaptive_validation = {
                    **adaptive_validation,
                    "promote": False,
                    "reason": "adaptive full-data fit failed; retaining Platt fallback",
                    "finalFit": False,
                }
            else:
                adaptive_validation = {**adaptive_validation, "finalFit": True}
        adaptive_payload = adaptive_calibrator.to_payload() if adaptive_calibrator is not None else {}
        positives = int(sum(labels))
        negatives = len(labels) - positives
        previous = {
            "thresholds": asdict(self.config.thresholds),
            "calibrationPlatt": list(self.config.calibration_platt),
            "calibrationAdaptive": dict(self.config.calibration_adaptive),
            "calibrationModel": str(self.config.calibration_model or ""),
        }
        payload = {
            "thresholds": {
                "confident": confident,
                "likely": likely,
                "relaxedChild": relaxed,
                "relaxed_child": relaxed,
            },
            "platt": calibrator.to_list(),
            "adaptive": adaptive_payload,
            "adaptiveFallback": {
                "active": not bool(adaptive_payload),
                "reason": str(adaptive_validation.get("reason", "adaptive context unavailable")),
                "contextRows": int(adaptive_validation.get("contextRows", 0) or 0),
                "minimumRows": self.ADAPTIVE_CALIBRATION_MIN_LABELS,
                "minimumPerClass": self.ADAPTIVE_CALIBRATION_MIN_PER_CLASS,
                "fallbackOrder": ["person-platt", "global-platt", "raw-score-ordering"],
            },
            "calibrationModel": dominant_model,
            "previousConfig": previous,
            "targetFmr": dict(self.CALIBRATION_TARGET_FMR),
            "labels": len(rows),
            "positiveLabels": positives,
            "negativeLabels": negatives,
            "labelsDroppedOtherModel": dropped,
            "trainingDataHash": self._calibration_training_hash(rows),
        }
        metrics = {
            "validation": validation,
            "labels": len(rows),
            "positiveLabels": positives,
            "negativeLabels": negatives,
            "labelsDroppedOtherModel": dropped,
            "thresholds": payload["thresholds"],
            "adaptiveValidation": adaptive_validation,
            "adaptiveActive": bool(adaptive_payload),
        }
        return {
            "payload": payload,
            "metrics": metrics,
            "validation": validation,
            "rows": rows,
            "allRows": all_rows,
            "dominantModel": dominant_model,
            "trainingDataHash": payload["trainingDataHash"],
            "promotable": not self._calibration_validation_regressed(validation),
        }

    def _threshold_payload_value(self, thresholds: dict[str, Any], snake: str, camel: str) -> float:
        value = thresholds.get(snake)
        if value is None:
            value = thresholds.get(camel)
        return float(value)

    def _apply_calibration_payload(self, payload: dict[str, Any]) -> None:
        thresholds = payload.get("thresholds")
        if not isinstance(thresholds, dict):
            raise ValueError("Calibration artifact is missing thresholds.")
        platt = payload.get("platt", payload.get("calibrationPlatt", []))
        if not isinstance(platt, list):
            raise ValueError("Calibration artifact is missing Platt parameters.")
        if platt and len(platt) != 2:
            raise ValueError("Calibration artifact has invalid Platt parameters.")
        adaptive_payload = payload.get("adaptive", payload.get("calibrationAdaptive", {}))
        if not isinstance(adaptive_payload, dict):
            raise ValueError("Calibration artifact has invalid adaptive parameters.")
        normalized_adaptive: dict[str, Any] = {}
        calibration_model = str(payload.get("calibrationModel", payload.get("calibration_model", "")) or "")
        if adaptive_payload:
            adaptive = AdaptiveLinearCalibrator.from_payload(adaptive_payload)
            if adaptive.dimension != 512:
                raise ValueError("Calibration artifact adaptive dimension must be 512.")
            if adaptive.model_name and calibration_model and adaptive.model_name != calibration_model:
                raise ValueError("Calibration artifact adaptive model does not match its calibration scope.")
            normalized_adaptive = adaptive.to_payload()
        self.config.thresholds.confident = self._threshold_payload_value(thresholds, "confident", "confident")
        self.config.thresholds.likely = self._threshold_payload_value(thresholds, "likely", "likely")
        self.config.thresholds.relaxed_child = self._threshold_payload_value(thresholds, "relaxed_child", "relaxedChild")
        self.config.calibration_platt = [float(platt[0]), float(platt[1])] if platt else []
        self.config.calibration_adaptive = normalized_adaptive
        self.config.calibration_model = calibration_model

    def apply_calibration_to_config(self) -> dict[str, Any]:
        # Replaces the (min_positive + max_negative)/2 midpoint with a probabilistic
        # fit + FMR-targeted thresholds on the user's accept/reject labels. Fits on the
        # fused match score (what band_for_score actually bands), keeping the operating
        # point self-consistent with the live decision path. NOTE: this is a regularized
        # GLOBAL fit; a held-out split is preferable once enough labels accumulate.
        self._require_learning_consent("applying learned calibration")
        candidate = self._build_calibration_candidate()
        validation = candidate["validation"]
        if not candidate["promotable"]:
            self._append_audit(
                {"action": "apply_calibration_to_config", "promoted": False, "reason": validation.get("reason", "held-out regression")}
            )
            return {"promoted": False, "validation": validation, "summary": self.calibration_summary(), "config": asdict(self.config)}
        payload = candidate["payload"]
        self._apply_calibration_payload(payload)
        self._append_audit(
            {
                "action": "apply_calibration_to_config",
                "likely": self.config.thresholds.likely,
                "confident": self.config.thresholds.confident,
                "relaxed_child": self.config.thresholds.relaxed_child,
                "platt": self.config.calibration_platt,
                "adaptive": bool(self.config.calibration_adaptive),
                "calibration_model": self.config.calibration_model,
                "labels": payload["labels"],
                "labels_dropped_other_model": payload["labelsDroppedOtherModel"],
            }
        )
        refreshed = self.refresh_review_candidate_priorities(statuses={"pending", "uncertain"})
        self.save()
        return {
            "promoted": True,
            "validation": validation,
            "summary": self.calibration_summary(),
            "config": asdict(self.config),
            "reviewPrioritiesRefreshed": refreshed,
        }

    def calibration_learning_status(self) -> dict[str, Any]:
        _, rows, dominant_model, dropped = self._calibration_scoped_rows()
        artifacts = self.db.learned_artifact_rows(artifact_type="calibration", limit=10)
        return {
            "summary": self.calibration_summary(),
            "current": {
                "thresholds": asdict(self.config.thresholds),
                "calibrationPlatt": list(self.config.calibration_platt),
                "calibrationAdaptive": dict(self.config.calibration_adaptive),
                "calibrationModel": str(self.config.calibration_model or ""),
            },
            "artifacts": self._learned_artifact_status_payloads(artifacts),
            "readiness": self._calibration_learning_readiness(rows, dominant_model, dropped),
        }

    def stage_calibration_update(self) -> dict[str, Any]:
        self._require_learning_consent("staging learned calibration")
        candidate = self._build_calibration_candidate()
        payload = candidate["payload"]
        metrics = candidate["metrics"]
        status = "staged" if candidate["promotable"] else "rejected"
        artifact_id = new_id("learn")
        artifact = self.db.upsert_learned_artifact(
            artifact_id,
            {
                "artifactType": "calibration",
                "status": status,
                "modelName": payload["calibrationModel"],
                "versionKey": "calibration-adaptive-fmr-v2",
                "trainingDataHash": payload["trainingDataHash"],
                "inputCount": payload["labels"],
                "positiveCount": payload["positiveLabels"],
                "negativeCount": payload["negativeLabels"],
                "metrics": metrics,
                "payload": payload,
            },
        )
        self._append_audit(
            {
                "action": "stage_calibration_update",
                "artifact_id": artifact_id,
                "artifact_hash": artifact.get("artifactHash", ""),
                "status": status,
                "labels": payload["labels"],
                "positive_labels": payload["positiveLabels"],
                "negative_labels": payload["negativeLabels"],
                "model_name": payload["calibrationModel"],
                "old_thresholds": payload["previousConfig"].get("thresholds", {}),
                "new_thresholds": payload["thresholds"],
                "training_data_hash": payload["trainingDataHash"],
                "labels_dropped_other_model": payload["labelsDroppedOtherModel"],
                "validation": candidate["validation"],
            }
        )
        return {
            "artifact": {**artifact, "artifactType": "calibration"},
            "status": status,
            "promotable": candidate["promotable"],
            "payload": payload,
            "metrics": metrics,
            "summary": self.calibration_summary(),
        }

    def run_learning_jobs(self) -> dict[str, Any]:
        readiness = self._calibration_learning_readiness()
        if not readiness["ready"]:
            if readiness.get("workspaceLocked"):
                return {
                    "staged": False,
                    "artifactCreated": False,
                    "reason": readiness["reason"],
                    "readiness": readiness,
                    "summary": self.calibration_summary(),
                }
            self._append_audit(
                {
                    "action": "run_learning_jobs",
                    "staged": False,
                    "artifact_created": False,
                    "reason": readiness["reason"],
                    "labels": readiness["labels"],
                    "new_labels": readiness["newLabelsSinceLastArtifact"],
                    "consent_active": readiness["consentActive"],
                }
            )
            return {
                "staged": False,
                "artifactCreated": False,
                "reason": readiness["reason"],
                "readiness": readiness,
                "summary": self.calibration_summary(),
            }
        result = self.stage_calibration_update()
        artifact = result.get("artifact") if isinstance(result.get("artifact"), dict) else {}
        artifact_id = str(artifact.get("artifactId") or artifact.get("artifact_id") or "")
        artifact_hash = str(artifact.get("artifactHash") or artifact.get("artifact_hash") or "")
        artifact_status = str(result.get("status") or artifact.get("status") or "")
        staged = artifact_status == "staged"
        reason = (
            "Learned calibration artifact staged for review."
            if staged
            else "Calibration feedback was evaluated and kept advisory because validation did not pass."
        )
        self._append_audit(
            {
                "action": "run_learning_jobs",
                "staged": staged,
                "artifact_created": True,
                "artifact_id": artifact_id,
                "artifact_hash": artifact_hash,
                "artifact_status": artifact_status,
                "reason": reason,
                "labels": readiness["labels"],
                "new_labels": readiness["newLabelsSinceLastArtifact"],
                "training_data_hash": readiness["currentTrainingDataHash"],
                "consent_active": readiness["consentActive"],
            }
        )
        summary = result.get("summary") if isinstance(result.get("summary"), dict) else self.calibration_summary()
        return {
            "staged": staged,
            "artifactCreated": True,
            "artifactStatus": artifact_status,
            "reason": reason,
            "calibration": result,
            "readiness": readiness,
            "status": self.calibration_learning_status(),
            "summary": summary,
        }

    def _calibration_artifact_for_action(self, artifact_id: str = "", status: str = "staged") -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id) if artifact_id else self.db.latest_learned_artifact("calibration", status=status)
        if not artifact:
            raise ValueError("No calibration artifact is available for this action.")
        if artifact.get("artifact_type") != "calibration":
            raise ValueError("The selected artifact is not a calibration artifact.")
        return artifact

    def promote_calibration_artifact(self, artifact_id: str = "") -> dict[str, Any]:
        self._require_learning_consent("promoting learned calibration")
        artifact = self._calibration_artifact_for_action(artifact_id, status="staged")
        if artifact.get("status") != "staged":
            raise ValueError("Only staged calibration artifacts can be promoted.")
        payload = artifact.get("payload")
        metrics = artifact.get("metrics") if isinstance(artifact.get("metrics"), dict) else {}
        if not isinstance(payload, dict):
            raise ValueError("Calibration artifact payload is unreadable.")
        validation = metrics.get("validation", {})
        if isinstance(validation, dict) and self._calibration_validation_regressed(validation):
            self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
            raise ValueError("Calibration artifact failed held-out validation and was rejected.")
        self._apply_calibration_payload(payload)
        promoted_at = now_iso()
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "promoted", promoted_at=promoted_at)
        refreshed = self.refresh_review_candidate_priorities(statuses={"pending", "uncertain"})
        self._append_audit(
            {
                "action": "promote_calibration_artifact",
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
                "training_data_hash": artifact.get("training_data_hash", ""),
                "labels": artifact.get("input_count", 0),
                "positive_labels": artifact.get("positive_count", 0),
                "negative_labels": artifact.get("negative_count", 0),
                "model_name": artifact.get("model_name", ""),
                "old_thresholds": (payload.get("previousConfig", {}) if isinstance(payload.get("previousConfig"), dict) else {}).get("thresholds", {}),
                "new_thresholds": payload.get("thresholds", {}),
                "promoted_at": promoted_at,
                "validation": validation,
                "adaptive": bool(self.config.calibration_adaptive),
                "review_priorities_refreshed": refreshed,
            }
        )
        self.save()
        return {
            "promoted": True,
            "artifactId": artifact["artifact_id"],
            "artifactHash": artifact.get("artifact_hash", ""),
            "promotedAt": promoted_at,
            "validation": validation,
            "reviewPrioritiesRefreshed": refreshed,
            "summary": self.calibration_summary(),
            "config": asdict(self.config),
        }

    def rollback_calibration_artifact(self, artifact_id: str = "") -> dict[str, Any]:
        artifact = self._calibration_artifact_for_action(artifact_id, status="promoted")
        if artifact.get("status") != "promoted":
            raise ValueError("Only promoted calibration artifacts can be rolled back.")
        payload = artifact.get("payload")
        if not isinstance(payload, dict) or not isinstance(payload.get("previousConfig"), dict):
            raise ValueError("Calibration artifact does not include rollback metadata.")
        previous = payload["previousConfig"]
        rollback_payload = {
            "thresholds": previous.get("thresholds", {}),
            "platt": previous.get("calibrationPlatt", []),
            "adaptive": previous.get("calibrationAdaptive", {}),
            "calibrationModel": previous.get("calibrationModel", ""),
        }
        self._apply_calibration_payload(rollback_payload)
        refreshed = self.refresh_review_candidate_priorities(statuses={"pending", "uncertain"})
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rolled_back")
        self._append_audit(
            {
                "action": "rollback_calibration_artifact",
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
            }
        )
        self.save()
        return {
            "rolledBack": True,
            "artifactId": artifact["artifact_id"],
            "summary": self.calibration_summary(),
            "config": asdict(self.config),
            "reviewPrioritiesRefreshed": refreshed,
        }

    def _adapter_scoped_rows(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, int]:
        all_rows = self.db.training_example_rows()
        rows, dominant_model, dropped = match_adapters.scoped_training_rows(all_rows)
        return all_rows, rows, dominant_model, dropped

    def _adapter_training_hash(self, rows: list[dict[str, Any]]) -> str:
        body: list[dict[str, Any]] = []
        for row in rows:
            body.append(
                {
                    "candidateId": str(row.get("candidate_id", row.get("candidateId", "")) or ""),
                    "sourceHash": str(row.get("source_hash", row.get("sourceHash", "")) or ""),
                    "expectedPerson": str(row.get("expectedPerson", row.get("expected_person", "")) or ""),
                    "isMatch": bool(row.get("isMatch")),
                    "matchScore": float(row.get("matchScore", row.get("match_score", 0.0)) or 0.0),
                    "rawCosine": float(row.get("rawCosine", row.get("raw_cosine", 0.0)) or 0.0),
                    "modelName": str(row.get("modelName", row.get("model_name", "")) or ""),
                    "features": match_adapters.extract_pair_features(row),
                }
            )
        return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _adapter_validation_regressed(self, validation: dict[str, Any]) -> bool:
        try:
            return float(validation.get("delta")) < -1e-9
        except (TypeError, ValueError):
            return True

    def _adapter_validation_improved(self, validation: dict[str, Any]) -> bool:
        return validation.get("promote") is True and not self._adapter_validation_regressed(validation)

    def _adapter_candidate_status(self, validation: dict[str, Any]) -> str:
        if self._adapter_validation_improved(validation):
            return "staged"
        if self._adapter_validation_regressed(validation):
            return "rejected"
        return "candidate"

    def _adapter_learning_readiness(
        self,
        rows: list[dict[str, Any]] | None = None,
        dominant_model: str = "",
        dropped: int = 0,
    ) -> dict[str, Any]:
        if rows is None:
            _, rows, dominant_model, dropped = self._adapter_scoped_rows()
        current_hash = self._adapter_training_hash(rows)
        latest = self.db.latest_learned_artifact("embedding_adapter")
        latest_hash = str(latest.get("training_data_hash", "") or "") if latest else ""
        latest_count = int(latest.get("input_count", 0) or 0) if latest else 0
        positives = sum(1 for row in rows if row.get("isMatch"))
        negatives = len(rows) - positives
        consent_required = bool(getattr(self.config, "require_consent", True))
        consent_active = bool(self.consent_on_file())
        learning_mode = str(getattr(self.config, "learning_mode", "manual") or "manual")
        ready = True
        reason = "Ready to stage an embedding adapter artifact."
        if self._workspace_state_lock_active():
            ready = False
            reason = "Workspace state is locked; wait for the current operation to finish before running adapter learning."
        elif learning_mode == "off":
            ready = False
            reason = "Learning mode is Off."
        elif consent_required and not consent_active:
            ready = False
            reason = "Consent must be active before running adapter learning."
        elif len(rows) < self.ADAPTER_MIN_LABELS or positives < self.ADAPTER_MIN_PER_CLASS or negatives < self.ADAPTER_MIN_PER_CLASS:
            ready = False
            reason = (
                "Review more accepted and rejected matches before staging an adapter "
                f"(need {self.ADAPTER_MIN_LABELS} examples with {self.ADAPTER_MIN_PER_CLASS}+ of each)."
            )
        elif latest_hash and latest_hash == current_hash:
            ready = False
            reason = "Current reviewed examples already have an embedding adapter artifact."
        return {
            "ready": ready,
            "reason": reason,
            "labels": len(rows),
            "positiveLabels": positives,
            "negativeLabels": negatives,
            "labelsDroppedOtherModel": int(dropped),
            "dominantModel": dominant_model,
            "minimumLabels": self.ADAPTER_MIN_LABELS,
            "minimumPerClass": self.ADAPTER_MIN_PER_CLASS,
            "currentTrainingDataHash": current_hash,
            "latestArtifactId": str(latest.get("artifact_id", "") or "") if latest else "",
            "latestArtifactStatus": str(latest.get("status", "") or "") if latest else "",
            "latestTrainingDataHash": latest_hash,
            "latestInputCount": latest_count,
            "consentRequired": consent_required,
            "consentActive": consent_active,
            "workspaceLocked": self._workspace_state_lock_active(),
            "learningMode": learning_mode,
            "featureVersion": match_adapters.FEATURE_VERSION,
            "adapterVersion": match_adapters.ADAPTER_VERSION,
        }

    def _adapter_context_matches_target(self, target_id: str, context: dict[str, Any]) -> bool:
        if target_id == "negative-cross-pose-low-score":
            return bool(context.get("crossPose")) and bool(context.get("hardPose")) and bool(context.get("scoreLow"))
        if target_id == "positive-cross-pose-hard":
            return bool(context.get("crossPose")) and bool(context.get("hardPose"))
        if target_id == "negative-video-low-score":
            return bool(context.get("mediaVideo")) and bool(context.get("scoreLow"))
        if target_id == "positive-video":
            return bool(context.get("mediaVideo"))
        if target_id == "negative-cross-age-low-score":
            return bool(context.get("crossAge")) and bool(context.get("scoreLow"))
        if target_id == "positive-cross-age":
            return bool(context.get("crossAge"))
        if target_id == "negative-unknown-or-zero-score":
            return bool(context.get("poseUnknown")) or bool(context.get("scoreZero"))
        return False

    def embedding_adapter_context_coverage(self, rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if rows is None:
            rows = self._adapter_scoped_rows()[1]
        canonical_rows = [item for row in rows if (item := match_adapters.canonical_row(dict(row))) is not None]
        context_counts: dict[str, dict[str, Any]] = {}
        target_counts: dict[str, int] = {str(target["id"]): 0 for target in self.ADAPTER_CONTEXT_TARGETS}
        target_context_keys: dict[str, set[str]] = {str(target["id"]): set() for target in self.ADAPTER_CONTEXT_TARGETS}
        for row in canonical_rows:
            label = "positive" if bool(row.get("isMatch")) else "negative"
            context = match_adapters.pair_context(row)
            key = match_adapters.pair_context_key(row)
            bucket = context_counts.setdefault(
                key,
                {
                    "contextKey": key,
                    "positive": 0,
                    "negative": 0,
                    "total": 0,
                    "context": {
                        "poseBucket": context.get("poseBucket", "unknown"),
                        "mediaKind": context.get("mediaKind", "image"),
                        "scoreZero": bool(context.get("scoreZero")),
                        "scoreLow": bool(context.get("scoreLow")),
                        "crossAge": bool(context.get("crossAge")),
                        "crossPose": bool(context.get("crossPose")),
                        "poseUnknown": bool(context.get("poseUnknown")),
                        "hardPose": bool(context.get("hardPose")),
                        "closeRunnerUp": bool(context.get("closeRunnerUp")),
                        "singleReference": bool(context.get("singleReference")),
                        "lowQuality": bool(context.get("lowQuality")),
                    },
                },
            )
            bucket[label] += 1
            bucket["total"] += 1
            for target in self.ADAPTER_CONTEXT_TARGETS:
                target_id = str(target["id"])
                if str(target.get("desiredLabel", "")) == label and self._adapter_context_matches_target(target_id, context):
                    target_counts[target_id] += 1
                    target_context_keys[target_id].add(key)
        targets: list[dict[str, Any]] = []
        for target in self.ADAPTER_CONTEXT_TARGETS:
            target_id = str(target["id"])
            count = int(target_counts.get(target_id, 0))
            min_count = int(target.get("minCount", 1) or 1)
            ready = count >= min_count
            targets.append(
                {
                    "id": target_id,
                    "label": str(target.get("label", "")),
                    "desiredLabel": str(target.get("desiredLabel", "")),
                    "count": count,
                    "minCount": min_count,
                    "ready": ready,
                    "remaining": max(0, min_count - count),
                    "action": str(target.get("action", "")),
                    "contextKeys": sorted(target_context_keys.get(target_id, set()))[:10],
                }
            )
        missing_targets = [target for target in targets if not bool(target.get("ready"))]
        return {
            "featureVersion": match_adapters.FEATURE_VERSION,
            "contextVersion": match_adapters.PAIR_CONTEXT_VERSION,
            "labels": len(canonical_rows),
            "targetCount": len(targets),
            "coveredTargets": len(targets) - len(missing_targets),
            "missingTargets": len(missing_targets),
            "ready": not missing_targets,
            "targets": targets,
            "nextActions": [target["action"] for target in missing_targets[:3] if target.get("action")],
            "contextCounts": sorted(
                context_counts.values(),
                key=lambda item: (-int(item.get("total", 0)), str(item.get("contextKey", ""))),
            )[:20],
        }

    def validate_embedding_adapter_change(
        self,
        rows: list[dict[str, Any]] | None = None,
        *,
        min_labels: int | None = None,
        min_per_class: int | None = None,
        model_name: str = "",
    ) -> dict[str, Any]:
        scoped = list(rows) if rows is not None else self._adapter_scoped_rows()[1]
        minimum_labels = int(min_labels or self.ADAPTER_MIN_LABELS)
        minimum_per_class = int(min_per_class or self.ADAPTER_MIN_PER_CLASS)
        if not model_name:
            _, model_name, _ = match_adapters.scoped_training_rows(scoped)

        def fit_transform(train: list[dict[str, Any]]):
            positives = sum(1 for row in train if row.get("isMatch"))
            negatives = len(train) - positives
            adapter = match_adapters.fit(
                train,
                min_count=max(2, len(train)),
                min_per_class=max(1, min(positives, negatives)),
                model_name=model_name,
            )
            if adapter is None:
                return lambda row: float(row.get("matchScore", row.get("match_score", 0.0)) or 0.0)
            return lambda row: match_adapters.score(row, adapter)

        return held_out_gate(
            scoped,
            fit_transform,
            score_key="matchScore",
            min_labels=minimum_labels,
            min_per_class=minimum_per_class,
        )

    def _build_embedding_adapter_candidate(
        self,
        *,
        min_count: int | None = None,
        min_per_class: int | None = None,
    ) -> dict[str, Any]:
        all_rows, rows, dominant_model, dropped = self._adapter_scoped_rows()
        minimum_count = int(min_count or self.ADAPTER_MIN_LABELS)
        minimum_per_class = int(min_per_class or self.ADAPTER_MIN_PER_CLASS)
        adapter = match_adapters.fit(
            rows,
            min_count=minimum_count,
            min_per_class=minimum_per_class,
            model_name=dominant_model,
        )
        if adapter is None:
            raise ValueError(
                "Review more accepted and rejected matches before staging an adapter "
                f"(need at least {minimum_count} examples with {minimum_per_class}+ of each)."
            )
        training_hash = self._adapter_training_hash(rows)
        validation = self.validate_embedding_adapter_change(
            rows,
            min_labels=minimum_count,
            min_per_class=minimum_per_class,
            model_name=dominant_model,
        )
        positives = int(sum(1 for row in rows if row.get("isMatch")))
        negatives = len(rows) - positives
        coverage = self.embedding_adapter_context_coverage(rows)
        payload = {
            **adapter,
            "trainingDataHash": training_hash,
        }
        metrics = {
            "validation": validation,
            "labels": len(rows),
            "positiveLabels": positives,
            "negativeLabels": negatives,
            "labelsDroppedOtherModel": dropped,
            "featureVersion": match_adapters.FEATURE_VERSION,
            "adapterVersion": match_adapters.ADAPTER_VERSION,
            "scoreKey": "matchScore",
            "coverage": coverage,
            "promotionEligible": self._adapter_validation_improved(validation),
            "advisoryOnly": not self._adapter_validation_regressed(validation) and not self._adapter_validation_improved(validation),
        }
        return {
            "payload": payload,
            "metrics": metrics,
            "validation": validation,
            "rows": rows,
            "allRows": all_rows,
            "dominantModel": dominant_model,
            "trainingDataHash": training_hash,
            "promotable": self._adapter_validation_improved(validation),
            "advisoryOnly": not self._adapter_validation_regressed(validation) and not self._adapter_validation_improved(validation),
        }

    def embedding_adapter_learning_status(self) -> dict[str, Any]:
        _, rows, dominant_model, dropped = self._adapter_scoped_rows()
        artifacts = self.db.learned_artifact_rows(artifact_type="embedding_adapter", limit=10)
        active_artifact = self.db.latest_learned_artifact("embedding_adapter", status="promoted")
        return {
            "summary": self.db.training_example_summary(),
            "artifacts": self._learned_artifact_status_payloads(artifacts),
            "activeArtifact": self._learned_artifact_status_payload(active_artifact),
            "readiness": self._adapter_learning_readiness(rows, dominant_model, dropped),
            "coverage": self.embedding_adapter_context_coverage(rows),
        }

    def stage_embedding_adapter(self, *, min_count: int | None = None, min_per_class: int | None = None) -> dict[str, Any]:
        self._require_learning_consent("running adapter learning")
        candidate = self._build_embedding_adapter_candidate(min_count=min_count, min_per_class=min_per_class)
        payload = candidate["payload"]
        metrics = candidate["metrics"]
        status = self._adapter_candidate_status(candidate["validation"])
        artifact_id = new_id("learn")
        artifact = self.db.upsert_learned_artifact(
            artifact_id,
            {
                "artifactType": "embedding_adapter",
                "status": status,
                "modelName": payload["modelName"],
                "versionKey": payload["versionKey"],
                "trainingDataHash": payload["trainingDataHash"],
                "inputCount": payload["inputCount"],
                "positiveCount": payload["positiveCount"],
                "negativeCount": payload["negativeCount"],
                "metrics": metrics,
                "payload": payload,
            },
        )
        self._append_audit(
            {
                "action": "stage_embedding_adapter",
                "artifact_id": artifact_id,
                "artifact_hash": artifact.get("artifactHash", ""),
                "status": status,
                "labels": payload["inputCount"],
                "positive_labels": payload["positiveCount"],
                "negative_labels": payload["negativeCount"],
                "labels_dropped_other_model": payload.get("labelsDroppedOtherModel", 0),
                "model_name": payload["modelName"],
                "feature_version": payload["featureVersion"],
                "adapter_version": payload["versionKey"],
                "training_data_hash": payload["trainingDataHash"],
                "validation": candidate["validation"],
            }
        )
        return {
            "artifact": {**artifact, "artifactType": "embedding_adapter"},
            "status": status,
            "promotable": candidate["promotable"],
            "advisoryOnly": candidate["advisoryOnly"],
            "payload": payload,
            "metrics": metrics,
            "summary": self.db.training_example_summary(),
        }

    def _embedding_adapter_artifact_for_action(self, artifact_id: str = "", status: str = "staged") -> dict[str, Any]:
        artifact = self.db.learned_artifact_by_id(artifact_id) if artifact_id else self.db.latest_learned_artifact("embedding_adapter", status=status)
        if not artifact:
            raise ValueError("No embedding adapter artifact is available for this action.")
        if artifact.get("artifact_type") != "embedding_adapter":
            raise ValueError("The selected artifact is not an embedding adapter artifact.")
        return artifact

    def promote_embedding_adapter(self, artifact_id: str = "") -> dict[str, Any]:
        self._require_learning_consent("promoting an embedding adapter")
        artifact = self._embedding_adapter_artifact_for_action(artifact_id, status="staged")
        if artifact.get("status") != "staged":
            raise ValueError("Only staged embedding adapter artifacts can be promoted.")
        payload = artifact.get("payload")
        metrics = artifact.get("metrics") if isinstance(artifact.get("metrics"), dict) else {}
        if not isinstance(payload, dict):
            raise ValueError("Embedding adapter payload is unreadable.")
        match_adapters.deserialize(payload)
        validation = metrics.get("validation", {})
        if not isinstance(validation, dict) or not self._adapter_validation_improved(validation):
            self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rejected")
            raise ValueError("Embedding adapter did not show a held-out improvement and was rejected.")
        promoted_at = now_iso()
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "promoted", promoted_at=promoted_at)
        self._append_audit(
            {
                "action": "promote_embedding_adapter",
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
                "training_data_hash": artifact.get("training_data_hash", ""),
                "labels": artifact.get("input_count", 0),
                "positive_labels": artifact.get("positive_count", 0),
                "negative_labels": artifact.get("negative_count", 0),
                "model_name": artifact.get("model_name", ""),
                "feature_version": payload.get("featureVersion", ""),
                "promoted_at": promoted_at,
                "validation": validation,
            }
        )
        return {
            "promoted": True,
            "artifactId": artifact["artifact_id"],
            "artifactHash": artifact.get("artifact_hash", ""),
            "promotedAt": promoted_at,
            "validation": validation,
            "summary": self.db.training_example_summary(),
        }

    def rollback_embedding_adapter(self, artifact_id: str = "") -> dict[str, Any]:
        artifact = self._embedding_adapter_artifact_for_action(artifact_id, status="promoted")
        if artifact.get("status") != "promoted":
            raise ValueError("Only promoted embedding adapter artifacts can be rolled back.")
        self.db.update_learned_artifact_status(str(artifact["artifact_id"]), "rolled_back")
        self._append_audit(
            {
                "action": "rollback_embedding_adapter",
                "artifact_id": artifact["artifact_id"],
                "artifact_hash": artifact.get("artifact_hash", ""),
            }
        )
        return {
            "rolledBack": True,
            "artifactId": artifact["artifact_id"],
            "summary": self.db.training_example_summary(),
        }

    def embedding_adapter_score(self, row: dict[str, Any], model_name: str | None = None) -> float | None:
        artifact = self.db.latest_learned_artifact("embedding_adapter", status="promoted")
        if not artifact:
            return None
        payload = artifact.get("payload")
        if not isinstance(payload, dict):
            return None
        artifact_model = str(payload.get("modelName", artifact.get("model_name", "")) or "")
        active_model = str(model_name or row.get("modelName") or row.get("model_name") or "")
        if artifact_model and active_model and artifact_model != active_model:
            return None
        try:
            return match_adapters.score(row, payload)
        except (TypeError, ValueError, OverflowError):
            return None

    def _adapter_row_from_decision(
        self,
        decision: Any,
        embedding: EmbeddingResult,
        pose_bucket: str,
        age_gap_years: float | None,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "expectedPerson": decision.person_name,
            "modelName": embedding.model_name,
            "matchScore": decision.score,
            "rawCosine": decision.raw_cosine,
            "quality": embedding.quality,
            "poseBucket": pose_bucket,
            "ageGapYears": age_gap_years,
            "alignError": embedding.align_error,
            "iedPx": embedding.ied_px,
            "mediaKind": metadata.get("media_kind", "image"),
            "features": {
                "runnerUpMargin": decision.runner_up_margin,
                "riskFlags": list(decision.flags),
            },
        }

    def _apply_embedding_adapter_to_decision(
        self,
        decision: Any,
        embedding: EmbeddingResult,
        thresholds: Any,
        pose_bucket: str,
        age_gap_years: float | None,
        metadata: dict[str, Any],
    ) -> Any:
        row = self._adapter_row_from_decision(decision, embedding, pose_bucket, age_gap_years, metadata)
        adapter_score = self.embedding_adapter_score(row, embedding.model_name)
        if adapter_score is None:
            return decision
        return replace(
            decision,
            score=float(adapter_score),
            band=band_for_score(float(adapter_score), thresholds),
            flags=tuple(dict.fromkeys((*decision.flags, "embedding-adapter"))),
        )

    def _calibration_probability_version(self, source: str, payload: Any) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
        return f"{source}:{hashlib.sha256(encoded).hexdigest()[:16]}"

    def match_probability_detail(
        self,
        score: float,
        model_name: str | None = None,
        person_name: str | None = None,
        *,
        pair_center: Any = None,
        raw_cosine: float | None = None,
    ) -> dict[str, Any]:
        """Resolve adaptive, personalized, then global calibration with provenance."""
        if model_name and self.config.calibration_model and model_name != self.config.calibration_model:
            return {"probability": None, "source": "", "version": ""}
        adaptive_payload = self.config.calibration_adaptive
        if adaptive_payload and pair_center is not None and raw_cosine is not None:
            try:
                adaptive = AdaptiveLinearCalibrator.from_payload(adaptive_payload)
                if not adaptive.model_name or not model_name or adaptive.model_name == model_name:
                    probability = adaptive.probability(pair_center, float(raw_cosine))
                    return {
                        "probability": probability,
                        "source": "adaptive-linear",
                        "version": self._calibration_probability_version("adaptive-linear", adaptive_payload),
                    }
            except (TypeError, ValueError):
                pass
        if person_name:
            per = self.config.calibration_platt_by_person.get(person_name)
            if per and len(per) == 2:
                try:
                    return {
                        "probability": PlattCalibrator.from_list(per).probability(float(score)),
                        "source": "person-platt",
                        "version": self._calibration_probability_version(
                            "person-platt",
                            {"person": person_name, "params": per, "model": self.config.calibration_model},
                        ),
                    }
                except (TypeError, ValueError):
                    pass
        params = self.config.calibration_platt
        if not params or len(params) != 2:
            return {"probability": None, "source": "", "version": ""}
        try:
            return {
                "probability": PlattCalibrator.from_list(params).probability(float(score)),
                "source": "global-platt",
                "version": self._calibration_probability_version(
                    "global-platt",
                    {"params": params, "model": self.config.calibration_model},
                ),
            }
        except (TypeError, ValueError):
            return {"probability": None, "source": "", "version": ""}

    def match_probability(
        self,
        score: float,
        model_name: str | None = None,
        person_name: str | None = None,
        *,
        pair_center: Any = None,
        raw_cosine: float | None = None,
    ) -> float | None:
        """Calibrated P(same identity), with explicit adaptive-to-Platt fallback."""
        return self.match_probability_detail(
            score,
            model_name,
            person_name,
            pair_center=pair_center,
            raw_cosine=raw_cosine,
        )["probability"]

    # Per-identity calibration needs MANY labels for ONE person, so the guard against
    # overfitting is a conservative per-identity label count (NOT the across-identity §6
    # gate, which holds out whole identities -- the wrong split for personalizing to a
    # person who must appear in both folds).
    PERSONALIZE_MIN_PER_IDENTITY = 16
    PERSONALIZE_MIN_PER_CLASS = 6

    def apply_personalized_calibration(self) -> dict[str, Any]:
        """§5.6: fit per-identity Platt calibrators (only for identities with enough of
        the user's own accept/reject labels) and persist them; match_probability then
        prefers a person's own calibrator over the global one. Same-embedding-space only
        (dominant recognizer). Returns which identities were personalized."""
        self._require_learning_consent("applying personalized calibration")
        rows = self.db.calibration_label_rows()
        models = [str(r.get("modelName") or "") for r in rows if r.get("modelName")]
        dominant = max(set(models), key=models.count) if models else ""
        scoped = [r for r in rows if str(r.get("modelName") or "") in {"", dominant}] if dominant else list(rows)
        per = fit_per_identity_calibrators(
            scoped,
            min_per_identity=self.PERSONALIZE_MIN_PER_IDENTITY,
            min_per_class=self.PERSONALIZE_MIN_PER_CLASS,
            score_key="matchScore",
        )
        self.config.calibration_platt_by_person = {person: cal.to_list() for person, cal in per.items()}
        refreshed = self.refresh_review_candidate_priorities(statuses={"pending", "uncertain"})
        self._append_audit({"action": "apply_personalized_calibration", "identities": len(per), "review_priorities_refreshed": refreshed})
        self.save()
        return {"identities": sorted(per.keys()), "count": len(per), "reviewPrioritiesRefreshed": refreshed}

    def validate_calibration_change(self, rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """§6: held-out (by-identity) check that the GLOBAL Platt calibrator actually
        improves separability on THIS user's labels before it is trusted -- the guardrail
        that converts a benchmarked gain into a real one (a paper +2pp can vanish locally)."""
        rows = list(rows) if rows is not None else self.db.calibration_label_rows()

        def fit_transform(train: list[dict[str, Any]]):
            calibrator = fit_score_calibrator(
                train, min_count=self.CALIBRATION_MIN_LABELS, min_per_class=self.CALIBRATION_MIN_PER_CLASS, score_key="matchScore"
            )
            if calibrator is None:
                return lambda row: float(row.get("matchScore", 0.0))
            return lambda row: calibrator.probability(float(row.get("matchScore", 0.0)))

        return held_out_gate(
            rows, fit_transform, score_key="matchScore",
            min_labels=self.CALIBRATION_MIN_LABELS, min_per_class=self.CALIBRATION_MIN_PER_CLASS,
        )

    def validate_drop_in_recognizer(self, path: Path | str) -> dict[str, Any]:
        """§5.1: validate a candidate recognizer ONNX before activating it via the seam,
        so a mis-exported model is rejected with an actionable reason instead of silently
        producing garbage embeddings."""
        from crossage_fr.embed.model_validation import validate_recognizer_onnx

        return validate_recognizer_onnx(Path(path).expanduser())

    def _person_templates(self, model_name: str) -> dict[str, list[float]]:
        """Cached self-consistency-pooled template per enrolled person (model-compatible,
        >=3 references), for the live weak-pooled-support precision demotion (§5.3).
        Invalidated when references change. Persons with <3 refs are omitted (a pooled
        template ~= the single ref, so it adds no signal and must not flag)."""
        key = (self._reference_index_version, str(model_name or ""))
        cached = getattr(self, "_person_template_cache", None)
        if cached is not None and cached[0] == key:
            return cached[1]
        by_person: dict[str, list[list[float]]] = {}
        quals: dict[str, list[float]] = {}
        for ref in self.references.values():
            if is_synthetic_age_reference(ref):
                continue
            if not self._compatible_reference_model_name(str(model_name or ""), ref.model_name):
                continue
            if isinstance(ref.vector, list) and ref.vector:
                by_person.setdefault(ref.person_name, []).append(ref.vector)
                quals.setdefault(ref.person_name, []).append(float(getattr(ref, "quality", 0.0) or 0.0))
        templates = {p: pool_template(v, quals[p]) for p, v in by_person.items() if len(v) >= 3}
        self._person_template_cache = (key, templates)
        return templates

    def person_template(self, person_name: str) -> list[float]:
        """Self-consistency-pooled template embedding for a person's references (§5.3),
        robust to outlier reference crops (weighted by set-agreement x quality). Returns
        an empty list when the person has no usable references."""
        vectors: list[list[float]] = []
        qualities: list[float] = []
        for ref in self.references.values():
            if (
                ref.person_name == person_name
                and not is_synthetic_age_reference(ref)
                and isinstance(ref.vector, list)
                and ref.vector
            ):
                vectors.append(ref.vector)
                qualities.append(float(getattr(ref, "quality", 0.0) or 0.0))
        if not vectors:
            return []
        return pool_template(vectors, qualities)

    def accuracy_det_report(self) -> dict[str, Any]:
        """DET / TAR@FAR / EER report on the user's accept-reject labels (Phase 2.3).

        Uses raw cosine (decoupled from heuristic banding) so the numbers are honest
        and comparable; carries a resolvable-FAR floor, bootstrap CIs, and a disclaimer
        that these are not standard FR verification numbers.
        """
        return det_report(self.db.calibration_label_rows(), score_key="rawCosine")

    def accuracy_det_report_by_age_gap(self) -> dict[str, Any]:
        """Per-age-gap-band DET reports (Phase 2.1) so the cross-age headline becomes
        falsifiable per gap instead of hidden inside one pooled number. Bands are the
        NIST-grounded confidence bands; the gap is a photo-date gap (capture_date diff),
        which is a noisy proxy for true subject-age gap -- reported honestly as such.
        """
        buckets: dict[str, list[dict[str, Any]]] = {}
        for row in self.db.calibration_label_rows():
            years = row.get("ageGapYears")
            band = "unknown" if years is None else confidence_for_gap(float(years))
            buckets.setdefault(band, []).append(row)
        return {
            "note": "Age gap is a photo-capture-date gap (proxy for subject-age gap); small per-band samples have wide CIs.",
            "byBand": {band: det_report(rows, score_key="rawCosine") for band, rows in buckets.items()},
        }

    def _candidate_probability_detail(
        self,
        candidate: ReviewCandidate,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolver = self.match_probability
        if getattr(resolver, "__func__", None) is not ProjectState.match_probability:
            try:
                probability = resolver(candidate.score, candidate.model_name, candidate.person_name)
            except (TypeError, ValueError):
                probability = None
            return {"probability": probability, "source": "runtime-calibrator", "version": ""}
        stored_probability = candidate.calibrated_probability
        stored_source = str(candidate.calibration_source or "")
        stored_version = str(candidate.calibration_version or "")
        if (
            stored_probability is not None
            and math.isfinite(float(stored_probability))
            and 0.0 <= float(stored_probability) <= 1.0
            and stored_source
            and stored_version
        ):
            if stored_source == "adaptive-linear" and self.config.calibration_adaptive:
                expected = self._calibration_probability_version("adaptive-linear", self.config.calibration_adaptive)
                try:
                    adaptive = AdaptiveLinearCalibrator.from_payload(self.config.calibration_adaptive)
                except (TypeError, ValueError):
                    adaptive = None
                model_current = not (
                    candidate.model_name
                    and self.config.calibration_model
                    and candidate.model_name != self.config.calibration_model
                )
                adaptive_model_current = bool(
                    adaptive is not None
                    and (
                        not adaptive.model_name
                        or not candidate.model_name
                        or adaptive.model_name == candidate.model_name
                    )
                )
                if model_current and adaptive_model_current and stored_version == expected:
                    return {
                        "probability": float(stored_probability),
                        "source": stored_source,
                        "version": stored_version,
                    }
            elif stored_source in {"person-platt", "global-platt"}:
                current = self.match_probability_detail(candidate.score, candidate.model_name, candidate.person_name)
                if current["source"] == stored_source and current["version"] == stored_version:
                    return {
                        "probability": float(stored_probability),
                        "source": stored_source,
                        "version": stored_version,
                    }
        valid_context = context
        if valid_context is not None and (
            str(valid_context.get("bestRefId", "")) != str(candidate.best_ref_id or "")
            or str(valid_context.get("modelName", "")) != str(candidate.model_name or "")
        ):
            valid_context = None
        if valid_context is None and candidate.best_ref_id:
            valid_context = self.db.candidate_match_context(
                candidate.candidate_id,
                best_ref_id=str(candidate.best_ref_id),
                model_name=str(candidate.model_name),
            )
        return self.match_probability_detail(
            candidate.score,
            candidate.model_name,
            candidate.person_name,
            pair_center=valid_context.get("pairCenter") if valid_context else None,
            raw_cosine=candidate.raw_cosine,
        )

    def _review_order_state(
        self,
        candidate: ReviewCandidate,
        context: dict[str, Any] | None = None,
    ) -> tuple[float, str, dict[str, Any]]:
        lane = review_lane(
            band=candidate.band,
            align_error=candidate.align_error,
            ied_px=candidate.ied_px,
            quality=candidate.quality,
        )
        probability_detail = self._candidate_probability_detail(candidate, context)
        priority = review_priority(
            lane=lane,
            probability=probability_detail["probability"],
            score=candidate.score,
        )
        return priority, lane, probability_detail

    def _review_order_for_candidate(
        self,
        candidate: ReviewCandidate,
        context: dict[str, Any] | None = None,
    ) -> tuple[float, str]:
        priority, lane, _detail = self._review_order_state(candidate, context)
        return priority, lane

    def refresh_review_candidate_priorities(self, statuses: Iterable[str] | None = None) -> int:
        """Recompute persisted review ordering against the current calibrators."""
        status_set = {str(status or "").strip() for status in (statuses or []) if str(status or "").strip()} or None
        refreshed: list[ReviewCandidate] = []
        candidates = list(self._iter_authoritative_candidates(statuses=status_set, order="review"))
        contexts = self.db.candidate_match_contexts(candidate.candidate_id for candidate in candidates)
        for candidate in candidates:
            priority, lane, detail = self._review_order_state(candidate, contexts.get(candidate.candidate_id))
            probability = detail["probability"]
            probability_unchanged = (
                candidate.calibrated_probability is None and probability is None
            ) or (
                candidate.calibrated_probability is not None
                and probability is not None
                and abs(float(candidate.calibrated_probability) - float(probability)) <= 1e-12
            )
            if (
                abs(float(candidate.review_priority or 0.0) - priority) <= 1e-9
                and str(candidate.review_lane or "") == lane
                and probability_unchanged
                and str(candidate.calibration_source or "") == str(detail["source"])
                and str(candidate.calibration_version or "") == str(detail["version"])
            ):
                continue
            updated = replace(
                candidate,
                review_priority=priority,
                review_lane=lane,
                calibrated_probability=probability,
                calibration_source=str(detail["source"]),
                calibration_version=str(detail["version"]),
            )
            refreshed.append(updated)
            if candidate.candidate_id in self.candidates:
                self.candidates[candidate.candidate_id] = updated
                self._mark_candidate_dirty(candidate.candidate_id)
        if refreshed:
            try:
                self.db.upsert_candidates(refreshed)
            except sqlite3.Error:
                pass
        return len(refreshed)

    def ordered_review_candidates(self, status: str = "pending", limit: int = 0) -> list[ReviewCandidate]:
        """Candidates ordered for minimum reviewer-clicks-to-find-the-match (Phase-4):
        likely-true matches first, information-limited (badly-aligned + sub-resolution,
        or near-zero quality) faces abstained to the bottom. Recomputed against the
        CURRENT calibrator so a re-calibration re-ranks the queue."""
        items = list(self._iter_authoritative_candidates(statuses={status}, order="review"))
        contexts = self.db.candidate_match_contexts(candidate.candidate_id for candidate in items)
        items.sort(
            key=lambda candidate: self._review_order_for_candidate(candidate, contexts.get(candidate.candidate_id))[0],
            reverse=True,
        )
        return items[: int(limit)] if limit and limit > 0 else items

    def accuracy_fairness_report(self, cohort: str = "poseBucket") -> dict[str, Any]:
        """Per-cohort DET + fairness gap on the user's labels (Phase 3.3). Defaults to
        the pose cohort; the app slices only non-protected operational cohorts."""
        return det_report_by_cohort(self.db.calibration_label_rows(), cohort, score_key="rawCosine")

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
            for candidate in sorted(
                self._iter_authoritative_candidates(statuses={"accepted", "rejected"}, order="status"),
                key=lambda item: (item.status, item.person_name.lower(), -item.score),
            )
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
        pending: list[tuple[str, dict[str, Any]]] = []
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
            pending.append(
                (
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
            )
        if pending:
            with self.db.connect() as conn:
                for label_id, payload in pending:
                    self.db.add_calibration_label(label_id, payload, conn=conn)
        imported = len(pending)
        summary = self.calibration_summary()
        self._append_audit({"action": "import_accuracy_labels", "imported": imported, "skipped": skipped})
        return {"imported": imported, "skipped": skipped, "summary": summary}

    def _training_example_export_row(self, row: dict[str, Any], include_paths: bool = False) -> dict[str, Any]:
        features = row.get("features") if isinstance(row.get("features"), dict) else {}
        result = {
            "exampleId": str(row.get("example_id", "") or ""),
            "naturalKey": str(row.get("natural_key", "") or ""),
            "labelId": str(row.get("label_id", "") or ""),
            "candidateId": str(row.get("candidate_id", "") or ""),
            "sourceHash": str(row.get("source_hash", "") or ""),
            "expectedPerson": str(row.get("expected_person", "") or ""),
            "actualPerson": str(row.get("actual_person", "") or ""),
            "isMatch": bool(row.get("is_match")),
            "matchScore": row.get("match_score"),
            "rawCosine": row.get("raw_cosine"),
            "quality": row.get("quality"),
            "modelName": str(row.get("model_name", "") or ""),
            "detectorSize": int(row.get("detector_size", 0) or 0),
            "candidateEmbeddingKey": str(row.get("candidate_embedding_key", "") or ""),
            "bestRefId": str(row.get("best_ref_id", "") or ""),
            "referenceModelName": str(row.get("reference_model_name", "") or ""),
            "poseBucket": str(row.get("pose_bucket", "") or ""),
            "ageGapYears": row.get("age_gap_years"),
            "alignError": row.get("align_error"),
            "iedPx": row.get("ied_px"),
            "mediaKind": str(row.get("media_kind", "image") or "image"),
            "features": features,
            "createdAt": str(row.get("created_at", "") or ""),
        }
        result["trainingContext"] = match_adapters.pair_context(result)
        if include_paths:
            result["sourcePath"] = str(row.get("source_path", "") or "")
            result["bestRefPath"] = str(row.get("best_ref_path", "") or "")
        return result

    def export_training_examples(self, folder: Path | None = None, include_paths: bool = False) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        json_path = export_root / f"vintrace-training-examples-{stamp}.json"
        csv_path = export_root / f"vintrace-training-examples-{stamp}.csv"
        rows = [self._training_example_export_row(row, include_paths=include_paths) for row in self.db.training_example_rows()]
        counts = {
            "examples": len(rows),
            "matches": sum(1 for row in rows if row["isMatch"]),
            "nonMatches": sum(1 for row in rows if not row["isMatch"]),
            "people": len({row["expectedPerson"] for row in rows if row["expectedPerson"]}),
            "models": len({row["modelName"] for row in rows if row["modelName"]}),
            "pathsIncluded": bool(include_paths),
        }
        training_data_hash = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "workspace": str(self.root) if include_paths else "",
            "counts": counts,
            "trainingDataHash": training_data_hash,
            "examples": rows,
            "note": "Training-example export contains reviewed learning metadata only. It does not include photos, thumbnails, face vectors, or model files. Local file paths are excluded unless includePaths is true.",
        }
        json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        fieldnames = [
            "exampleId",
            "naturalKey",
            "labelId",
            "candidateId",
            "sourceHash",
            "expectedPerson",
            "actualPerson",
            "isMatch",
            "matchScore",
            "rawCosine",
            "quality",
            "modelName",
            "detectorSize",
            "candidateEmbeddingKey",
            "bestRefId",
            "referenceModelName",
            "poseBucket",
            "ageGapYears",
            "alignError",
            "iedPx",
            "mediaKind",
            "features",
            "trainingContext",
            "createdAt",
        ]
        if include_paths:
            fieldnames.extend(["sourcePath", "bestRefPath"])
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                csv_row = dict(row)
                csv_row["features"] = json.dumps(csv_row.get("features") if isinstance(csv_row.get("features"), dict) else {}, separators=(",", ":"), sort_keys=True)
                csv_row["trainingContext"] = json.dumps(csv_row.get("trainingContext") if isinstance(csv_row.get("trainingContext"), dict) else {}, separators=(",", ":"), sort_keys=True)
                writer.writerow({key: csv_row.get(key, "") for key in fieldnames})
        self._append_audit(
            {
                "action": "export_training_examples",
                "json_path": str(json_path),
                "csv_path": str(csv_path),
                "count": len(rows),
                "include_paths": bool(include_paths),
                "training_data_hash": training_data_hash,
            }
        )
        return {"jsonPath": str(json_path), "csvPath": str(csv_path), "counts": counts, "trainingDataHash": training_data_hash}

    def import_training_examples(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        def _value(row: dict[str, Any], *keys: str, default: Any = "") -> Any:
            for key in keys:
                if key in row and row.get(key) not in (None, ""):
                    return row.get(key)
            return default

        def _bool(value: Any) -> bool:
            if isinstance(value, str):
                return value.strip().lower() in {"1", "true", "yes", "match", "accepted"}
            return bool(value)

        def _int(value: Any, fallback: int = 0) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return fallback

        pending: list[tuple[str, dict[str, Any]]] = []
        skipped = 0
        for row in rows:
            if not isinstance(row, dict):
                skipped += 1
                continue
            source_hash = str(_value(row, "sourceHash", "source_hash", "fileHash", "file_hash")).strip()
            expected_person = str(_value(row, "expectedPerson", "expected_person")).strip()
            if not source_hash or not expected_person:
                skipped += 1
                continue
            raw_features = _value(row, "features", "features_json", default={})
            if isinstance(raw_features, str):
                try:
                    features = json.loads(raw_features) if raw_features.strip() else {}
                except json.JSONDecodeError:
                    features = {}
            else:
                features = raw_features if isinstance(raw_features, dict) else {}
            context_source = dict(row)
            context_source["features"] = features
            context_source.pop("trainingContext", None)
            context_source.pop("training_context", None)
            training_context = match_adapters.pair_context(context_source)
            pending.append(
                (
                    str(_value(row, "exampleId", "example_id", default="")).strip() or new_id("train"),
                    {
                        "naturalKey": str(_value(row, "naturalKey", "natural_key")).strip(),
                        "labelId": str(_value(row, "labelId", "label_id")).strip(),
                        "candidateId": str(_value(row, "candidateId", "candidate_id")).strip(),
                        "sourcePath": str(_value(row, "sourcePath", "source_path")).strip(),
                        "sourceHash": source_hash,
                        "expectedPerson": expected_person,
                        "actualPerson": str(_value(row, "actualPerson", "actual_person")).strip(),
                        "isMatch": _bool(_value(row, "isMatch", "is_match")),
                        "matchScore": _value(row, "matchScore", "match_score", default=None),
                        "rawCosine": _value(row, "rawCosine", "raw_cosine", default=None),
                        "quality": _value(row, "quality", default=None),
                        "modelName": str(_value(row, "modelName", "model_name")).strip(),
                        "detectorSize": _int(_value(row, "detectorSize", "detector_size", default=0), 0),
                        "candidateEmbeddingKey": str(_value(row, "candidateEmbeddingKey", "candidate_embedding_key")).strip(),
                        "bestRefId": str(_value(row, "bestRefId", "best_ref_id")).strip(),
                        "bestRefPath": str(_value(row, "bestRefPath", "best_ref_path")).strip(),
                        "referenceModelName": str(_value(row, "referenceModelName", "reference_model_name")).strip(),
                        "poseBucket": str(_value(row, "poseBucket", "pose_bucket")).strip(),
                        "ageGapYears": _value(row, "ageGapYears", "age_gap_years", default=None),
                        "alignError": _value(row, "alignError", "align_error", default=None),
                        "iedPx": _value(row, "iedPx", "ied_px", default=None),
                        "mediaKind": str(_value(row, "mediaKind", "media_kind", default="image") or "image"),
                        "features": features,
                        "trainingContext": training_context,
                        "createdAt": str(_value(row, "createdAt", "created_at")).strip(),
                    },
                )
            )
        if pending:
            with self.db.connect() as conn:
                for example_id, payload in pending:
                    self.db.add_training_example(example_id, payload, conn=conn)
        imported = len(pending)
        summary = self.db.training_example_summary()
        self._append_audit({"action": "import_training_examples", "imported": imported, "skipped": skipped})
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
        candidate_count = int(scale.get("reviewCandidateRows", 0) or 0)
        if candidate_count < len(self.candidates):
            candidate_count = len(self.candidates)
        encryption = self.workspace_encryption_status()
        database_encryption = encryption.get("database") if isinstance(encryption.get("database"), dict) else {}
        encryption_active = bool(
            encryption.get("enabled")
            and encryption.get("migrationComplete")
            and database_encryption.get("encryptedHeader")
        )
        recommendations = [
            "Use Delete face data before handing this app folder to someone else.",
            "Export what you need first; deleted face data cannot be restored unless you have a backup.",
            "Keep source photos, generated previews, and old backups on an OS-encrypted volume.",
        ]
        if encryption_active:
            recommendations.append("Keep the workspace recovery code separate from encrypted backups.")
        else:
            recommendations.append("Require workspace encryption before storing biometric templates in production.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "references": len(self.references),
            "candidates": candidate_count,
            "scanHistory": len(self.scan_history),
            "generatedFiles": generated_files,
            "generatedBytes": generated_bytes,
            "safetyCacheEntries": int(scale.get("safetyCacheEntries", 0) or 0),
            "embeddingCacheEntries": int(scale.get("embeddingCacheEntries", 0) or 0),
            "calibrationLabels": int(scale.get("calibrationLabels", 0) or 0),
            "trainingExamples": int(scale.get("trainingExamples", 0) or 0),
            "learnedArtifacts": int(scale.get("learnedArtifacts", 0) or 0),
            "relationshipNameReviews": int(scale.get("relationshipNameReviews", 0) or 0),
            "auditEvents": self._audit_event_count(),
            "dataAtRest": {
                "encrypted": encryption_active,
                "keyId": str(database_encryption.get("keyId") or encryption.get("keyId") or ""),
                "cipherVersion": str(database_encryption.get("cipherVersion") or ""),
                "migrationComplete": bool(encryption.get("migrationComplete")),
                "biometricStorage": (
                    "Face embeddings, private review state, consent releases, audit events, training examples, and learned artifacts are protected by SQLCipher or authenticated workspace envelopes."
                    if encryption_active
                    else "Biometric workspace encryption is not active; production startup must fail closed before private templates are stored."
                ),
                "generatedMedia": "Source photos, generated preview/video-frame files, and operator-created evidence exports are ordinary media files outside the workspace-key encryption boundary.",
                "workspaceLock": "Workspace Lock gates access inside the app; SQLCipher workspace encryption is a separate at-rest control.",
                "backupEncryption": (
                    "Workspace backups retain the SQLCipher database and authenticated biometric envelopes. The optional backup passphrase also encrypts the complete archive."
                    if encryption_active and backup_passphrase()
                    else "Workspace backups retain the SQLCipher database and authenticated biometric envelopes; keep the recovery code separate from the archive."
                    if encryption_active
                    else "Set VINTRACE_BACKUP_PASSPHRASE to encrypt complete exported backup archives with AES-256-GCM."
                ),
                "note": "Full-disk encryption remains necessary for source media, generated previews, evidence exports, snapshots, and retired plaintext remnants on SSD/copy-on-write storage.",
            },
            "recommendations": recommendations,
        }

    def delete_face_data(self, confirm: bool = False, include_audit: bool = False) -> dict[str, Any]:
        if not confirm:
            raise ValueError("Face data deletion requires confirm=true.")
        before = self.privacy_report()
        self._mark_references_deleted(list(self.references.keys()))
        self._mark_candidates_deleted(self._authoritative_candidate_ids())
        self.references.clear()
        self.candidates.clear()
        self._loaded_candidate_ids.clear()
        self._loaded_candidate_payloads.clear()
        self._candidate_dirty_ids.clear()
        self._candidate_index_backed = False
        self.scan_history.clear()
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
        for candidate in self._iter_authoritative_candidates(order="created"):
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
        for candidate in self._iter_authoritative_candidates(order="created"):
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
                audit_events = self._audit_event_count()
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
        for candidate in self._iter_authoritative_candidates(order="created"):
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

    def preview_path_for(self, value: str | None, create: bool = True, max_edge: int = 768) -> str | None:
        if not value:
            return None
        source = Path(value).expanduser()
        # H2: generate a downscaled preview for ALL image formats (not just the
        # non-browser-renderable ones). Previously jpg/png/webp fell through to
        # here returning None, so the renderer used the full-resolution original
        # as the list thumbnail. Any image we can load gets a small cached preview.
        # max_edge lets a caller (e.g. the mobile viewer) request a larger preview than
        # the 768px list thumbnail; it is generated from the original, so it is honest up
        # to the source's own resolution and never upscaled.
        edge = max(128, int(max_edge or 768))
        suffix = source.suffix.lower()
        if not source.exists() or not source.is_file() or suffix not in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
            return None
        try:
            preview = self._preview_cache_path(source, edge)
            if not create and not preview.exists():
                return None
            if not preview.exists() or preview.stat().st_size <= 0:
                self._ensure_generated_dir_sentinel(self.previews_path)
                if not self._generated_dir_is_owned(self.previews_path):
                    return None
                if suffix in VIDEO_EXTENSIONS:
                    self._ensure_generated_dir_sentinel(self.video_frames_path)
                    if not self._generated_dir_is_owned(self.video_frames_path):
                        return None
                    samples = sample_video_frames(source, self.video_frames_path, max_frames=1, interval_seconds=0.5, jpeg_quality=84)
                    if not samples:
                        return None
                    temp = preview.with_suffix(preview.suffix + ".tmp")
                    shutil.copy2(samples[0].path, temp)
                    temp.replace(preview)
                else:
                    write_preview_image(source, preview, max_edge=edge)
            return str(preview)
        except (ImageLoadError, VideoLoadError, OSError, ValueError):
            return None

    def preview_path_for_proxy(self, value: str | None, proxy_value: str | None, create: bool = True) -> str | None:
        if not value or not proxy_value:
            return None
        source = Path(value).expanduser()
        proxy = Path(proxy_value).expanduser()
        try:
            if not source.exists() or not source.is_file():
                return None
            if not proxy.exists() or not proxy.is_file():
                return None
            proxy_suffix = proxy.suffix.lower()
            if proxy_suffix not in IMAGE_EXTENSIONS or proxy_suffix in RAW_IMAGE_EXTENSIONS:
                return None
            preview = self._preview_cache_path(source)
            if not create and not preview.exists():
                return None
            if not preview.exists() or preview.stat().st_size <= 0:
                self._ensure_generated_dir_sentinel(self.previews_path)
                if not self._generated_dir_is_owned(self.previews_path):
                    return None
                write_preview_image(proxy, preview)
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
        for candidate in self._iter_authoritative_candidates(order="created"):
            if maybe_prepare(candidate.source_path):
                return prepared
            if maybe_prepare(candidate.best_ref_path):
                return prepared
        return prepared

    def rebuild_previews_for_paths(
        self,
        values: Iterable[str | Path],
        *,
        limit: int = 64,
        force: bool = True,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        max_items = max(1, min(1000, int(limit)))
        generated_at = now_iso()
        seen: set[str] = set()
        rows: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        failed: list[dict[str, str]] = []
        removed_files = 0
        removed_bytes = 0
        generated = 0
        considered = 0
        clean_values = [str(value or "").strip() for value in values if str(value or "").strip()]
        for raw in clean_values:
            if considered >= max_items:
                break
            source = Path(raw).expanduser()
            try:
                resolved = source.resolve()
            except OSError:
                resolved = source
            key = str(resolved)
            if not key or key in seen:
                continue
            seen.add(key)
            considered += 1
            if not resolved.exists() or not resolved.is_file():
                skipped.append({"sourcePath": str(resolved), "reason": "Source file is missing."})
                continue
            if resolved.suffix.lower() not in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
                skipped.append({"sourcePath": str(resolved), "reason": "Preview rebuild only supports image and video files."})
                continue
            try:
                preview = self._preview_cache_path(resolved)
            except OSError as exc:
                failed.append({"sourcePath": str(resolved), "reason": f"Could not inspect preview cache path: {exc}"})
                continue
            existing = preview.exists()
            existing_size = 0
            if existing:
                try:
                    existing_size = preview.stat().st_size
                except OSError:
                    existing_size = 0
            if dry_run:
                rows.append({
                    "sourcePath": str(resolved),
                    "previewPath": str(preview),
                    "existingPreview": existing,
                    "wouldRemove": bool(force and existing),
                    "wouldGenerate": True,
                })
                continue
            try:
                self._ensure_generated_dir_sentinel(self.previews_path)
                if not self._generated_dir_is_owned(self.previews_path):
                    skipped.append({"sourcePath": str(resolved), "reason": "Preview cache folder is not owned by this workspace."})
                    continue
                if force and existing:
                    preview.unlink()
                    removed_files += 1
                    removed_bytes += existing_size
                next_preview = self.preview_path_for(str(resolved), create=True)
                if not next_preview:
                    failed.append({"sourcePath": str(resolved), "reason": "Preview could not be generated."})
                    continue
                generated += 1
                rows.append({
                    "sourcePath": str(resolved),
                    "previewPath": str(next_preview),
                    "existingPreview": existing,
                    "removedPreview": bool(force and existing),
                    "generated": True,
                })
            except (ImageLoadError, VideoLoadError, OSError, ValueError) as exc:
                failed.append({"sourcePath": str(resolved), "reason": str(exc) or "Preview rebuild failed."})
        return {
            "generatedAt": generated_at,
            "dryRun": bool(dry_run),
            "force": bool(force),
            "requested": len(clean_values),
            "considered": considered,
            "limit": max_items,
            "removedPreviewFiles": removed_files,
            "removedPreviewBytes": removed_bytes,
            "generatedPreviews": generated,
            "skipped": skipped[:50],
            "failed": failed[:50],
            "rebuilt": rows[:200],
            "truncated": len(seen) < len(dict.fromkeys(clean_values)),
        }

    def _preview_cache_path(self, source: Path, max_edge: int = 768) -> Path:
        stat = source.stat()
        # The default 768 edge keeps the historical cache key byte-for-byte, so existing
        # previews are not mass-regenerated. Larger edges (requested by the mobile viewer,
        # which needs to zoom) cache under their own key alongside the small thumbnail.
        edge_suffix = "" if int(max_edge) == 768 else f"|edge{int(max_edge)}"
        cache_key = hashlib.sha256(
            f"{source.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|preview-v3{edge_suffix}".encode("utf-8")
        ).hexdigest()[:32]
        return self.previews_path / f"{cache_key}.jpg"

    def _path_key(self, value: str) -> str:
        try:
            return image_record_for_path(Path(value)).sha256
        except Exception:
            return value

    def _candidate_duplicate_source(self, candidate: ReviewCandidate) -> str:
        if candidate.media_kind == "video" and candidate.media_source_path:
            if candidate.video_track_id:
                return f"video:{candidate.media_source_path}:track:{candidate.video_track_id}"
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
        return self._safe_capture_date_with_provenance(path, image=image, sha256=sha256)[0]

    def _safe_capture_date_with_provenance(self, path: Path, image: Any | None = None, sha256: str = "") -> tuple[str | None, str]:
        # §5.4: source-media capture date + provenance — EXIF event date when present,
        # else the mtime fallback (which downstream suppresses the age-gap NIST band).
        try:
            record = image_record_for_path(path, image=image, sha256=sha256)
            return record.capture_date, record.capture_date_provenance
        except Exception:
            mtime = self._media_mtime_date(path)
            return mtime, ("mtime" if mtime else "none")

    def _reference_capture_date_provenance(self, ref_id: str | None) -> str:
        if not ref_id:
            return "unknown"
        ref = self.references.get(ref_id)
        return getattr(ref, "capture_date_provenance", "unknown") if ref else "unknown"

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
        for value in self._iter_audit_rows_reverse():
            if isinstance(value.get("hash"), str) and value.get("hash"):
                return (int(value.get("seq", 0) or 0), str(value["hash"]))
        return (0, "")

    @staticmethod
    def _audit_person_ref(name: str) -> str:
        # PC/GDPR: store a stable, non-reversible reference to a person name in
        # the tamper-evident audit log instead of the plaintext PII, so a
        # delete_person (erasure) does not leave the name behind. An investigator
        # can still confirm "was <name> affected?" by hashing the same name.
        cleaned = str(name or "").strip().casefold()
        if not cleaned:
            return ""
        return "sha256:" + hashlib.sha256(cleaned.encode("utf-8")).hexdigest()[:16]

    @classmethod
    def _minimize_audit_payload(cls, value: Any, field: str = "") -> Any:
        normalized_field = field.casefold().replace("_", "").replace("-", "")
        person_fields = {
            "person",
            "personname",
            "expectedperson",
            "actualperson",
            "oldpersonname",
            "newpersonname",
            "signername",
            "approvedby",
            "operator",
        }
        people_fields = {
            "people",
            "memberpeople",
            "includepeople",
            "excludepeople",
        }
        if normalized_field in person_fields:
            if isinstance(value, str):
                return value if value.startswith("sha256:") else cls._audit_person_ref(value)
            if isinstance(value, list):
                return [cls._audit_person_ref(str(item)) for item in value if str(item).strip()]
        if normalized_field in people_fields and isinstance(value, list):
            return [cls._audit_person_ref(str(item)) for item in value if str(item).strip()]
        if isinstance(value, dict):
            return {
                str(key): cls._minimize_audit_payload(item, str(key))
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [cls._minimize_audit_payload(item) for item in value]
        return value

    def _pseudonymize_subject_audit(self, person_name: str) -> dict[str, Any]:
        clean_name = str(person_name or "").strip()
        if not clean_name or not self.audit_path.exists():
            return {"redacted": 0, "checkpointHash": ""}
        person_ref = self._audit_person_ref(clean_name)
        pattern = re.compile(re.escape(clean_name), re.IGNORECASE)

        def scrub(value: Any) -> tuple[Any, bool]:
            if isinstance(value, str):
                cleaned, count = pattern.subn(person_ref, value)
                return cleaned, count > 0
            if isinstance(value, list):
                changed = False
                cleaned_items: list[Any] = []
                for item in value:
                    cleaned, item_changed = scrub(item)
                    cleaned_items.append(cleaned)
                    changed = changed or item_changed
                return cleaned_items, changed
            if isinstance(value, dict):
                changed = False
                cleaned_row: dict[str, Any] = {}
                for key, item in value.items():
                    cleaned, item_changed = scrub(item)
                    cleaned_row[str(key)] = cleaned
                    changed = changed or item_changed
                return cleaned_row, changed
            return value, False

        with self._state_lock():
            rows = list(self._iter_audit_rows_forward())
            if not rows:
                return {"redacted": 0, "checkpointHash": ""}
            prior_tail = next(
                (str(row.get("hash", "")) for row in reversed(rows) if row.get("hash")),
                "",
            )
            cleaned_rows: list[tuple[dict[str, Any], bool]] = []
            affected_rows: list[dict[str, Any]] = []
            for row in rows:
                cleaned, changed = scrub(row)
                assert isinstance(cleaned, dict)
                cleaned_rows.append((cleaned, changed))
                if changed:
                    affected_rows.append(row)
            if not affected_rows:
                return {"redacted": 0, "checkpointHash": ""}

            previous_hash = ""
            rechained: list[dict[str, Any]] = []
            for index, (row, changed) in enumerate(cleaned_rows, start=1):
                next_row = {
                    key: value
                    for key, value in row.items()
                    if key not in {"seq", "prevHash", "hash", "erasurePriorHash"}
                }
                if row.get("hash"):
                    next_row["erasurePriorHash"] = str(row["hash"])
                if changed:
                    next_row["subjectErasureRedacted"] = True
                    next_row["subjectRef"] = person_ref
                next_row["seq"] = index
                next_row["prevHash"] = previous_hash
                next_row["hash"] = hashlib.sha256(
                    self._audit_canonical(next_row).encode("utf-8")
                ).hexdigest()
                previous_hash = next_row["hash"]
                rechained.append(next_row)

            affected_digest = hashlib.sha256(
                "\n".join(self._audit_canonical(row) for row in affected_rows).encode("utf-8")
            ).hexdigest()
            checkpoint: dict[str, Any] = {
                "at": now_iso(),
                "action": "audit_subject_erasure_checkpoint",
                "subjectRef": person_ref,
                "redactedEvents": len(affected_rows),
                "priorChainTail": prior_tail,
                "redactedEventsDigest": affected_digest,
                "seq": len(rechained) + 1,
                "prevHash": previous_hash,
            }
            checkpoint["hash"] = hashlib.sha256(
                self._audit_canonical(checkpoint).encode("utf-8")
            ).hexdigest()
            rechained.append(checkpoint)

            def rewrite(handle) -> None:
                for row in rechained:
                    encoded = self._encode_audit_line(row)
                    handle.write(
                        encoded.decode("ascii")
                        if self.workspace_encryption.enabled
                        else encoded.decode("utf-8")
                    )

            atomic_write(self.audit_path, rewrite)
        return {"redacted": len(affected_rows), "checkpointHash": checkpoint["hash"]}

    def _append_audit(self, row: dict[str, object]) -> None:
        with self._state_lock():
            last_seq, last_hash = self._audit_tail_tip()
            audit_row: dict[str, Any] = {
                "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                **self._minimize_audit_payload(row),
            }
            # Chain fields are authoritative and cannot be overridden by the caller-supplied row.
            audit_row["seq"] = last_seq + 1
            audit_row["prevHash"] = last_hash
            audit_row["hash"] = hashlib.sha256(
                self._audit_canonical(audit_row).encode("utf-8")
            ).hexdigest()
            with self.audit_path.open("ab") as handle:
                handle.write(self._encode_audit_line(audit_row))
                # Durably flush the tamper-evident chain entry to disk. A plain
                # close() only flushes to the kernel page cache; a crash/power
                # loss in that window would drop the newest entry and break the
                # SHA-256 hash chain the audit log promises.
                handle.flush()
                os.fsync(handle.fileno())

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
            with self.audit_path.open("rb") as handle:
                for raw in handle:
                    stripped = raw.strip()
                    if not stripped:
                        continue
                    index += 1
                    try:
                        value = self._decode_audit_line(stripped)
                    except WorkspaceEncryptionError:
                        if result["firstBreak"] is None:
                            result["firstBreak"] = {"index": index, "reason": "encrypted-line-authentication"}
                        continue
                    if value is None:
                        if result["firstBreak"] is None:
                            result["firstBreak"] = {"index": index, "reason": "unparseable-line"}
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
        rows: list[dict[str, Any]] = []
        for row in self._iter_audit_rows_reverse():
            rows.append(row)
            if len(rows) >= offset + limit:
                break
        return {
            "events": rows[offset:offset + limit],
            "limit": limit,
            "offset": offset,
            "total": self._audit_event_count(),
        }

    @staticmethod
    def _audit_event_timestamp(row: dict[str, Any]) -> datetime | None:
        raw = str(row.get("at", "") or "").strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def audit_events_due_for_retention(self, days: int, *, now: datetime | None = None) -> int:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        cutoff = current.astimezone(timezone.utc).timestamp() - max(1, int(days)) * 86400
        return sum(
            1
            for row in self._iter_audit_rows_forward()
            if (timestamp := self._audit_event_timestamp(row)) is not None and timestamp.timestamp() < cutoff
        )

    def enforce_audit_retention(
        self,
        days: int,
        *,
        source: str = "retention-policy",
        now: datetime | None = None,
    ) -> dict[str, Any]:
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        current = current.astimezone(timezone.utc)
        retention_days = max(1, int(days))
        cutoff = current.timestamp() - retention_days * 86400
        with self._state_lock():
            rows = list(self._iter_audit_rows_forward())
            removed: list[dict[str, Any]] = []
            retained: list[dict[str, Any]] = []
            for row in rows:
                timestamp = self._audit_event_timestamp(row)
                (removed if timestamp is not None and timestamp.timestamp() < cutoff else retained).append(row)
            if not removed:
                return {"deleted": 0, "retained": len(rows), "checkpointHash": ""}
            previous_tail = next(
                (str(row.get("hash", "")) for row in reversed(rows) if row.get("hash")),
                "",
            )
            removed_digest = hashlib.sha256(
                "\n".join(self._audit_canonical(row) for row in removed).encode("utf-8")
            ).hexdigest()
            rechained: list[dict[str, Any]] = []
            previous_hash = ""
            for index, row in enumerate(retained, start=1):
                next_row = {
                    key: value
                    for key, value in row.items()
                    if key not in {"seq", "prevHash", "hash", "retentionPriorHash"}
                }
                if row.get("hash"):
                    next_row["retentionPriorHash"] = str(row["hash"])
                next_row["seq"] = index
                next_row["prevHash"] = previous_hash
                next_row["hash"] = hashlib.sha256(self._audit_canonical(next_row).encode("utf-8")).hexdigest()
                previous_hash = next_row["hash"]
                rechained.append(next_row)
            checkpoint: dict[str, Any] = {
                "at": current.isoformat(timespec="seconds").replace("+00:00", "Z"),
                "action": "audit_retention_checkpoint",
                "source": str(source or "retention-policy")[:80],
                "retentionDays": retention_days,
                "deletedEvents": len(removed),
                "retainedEvents": len(retained),
                "priorChainTail": previous_tail,
                "deletedEventsDigest": removed_digest,
                "deletedThrough": max(
                    str(row.get("at", "")) for row in removed if str(row.get("at", ""))
                ),
                "seq": len(rechained) + 1,
                "prevHash": previous_hash,
            }
            checkpoint["hash"] = hashlib.sha256(self._audit_canonical(checkpoint).encode("utf-8")).hexdigest()
            rechained.append(checkpoint)

            def rewrite(handle) -> None:
                for row in rechained:
                    encoded = self._encode_audit_line(row)
                    handle.write(encoded.decode("ascii") if self.workspace_encryption.enabled else encoded.decode("utf-8"))

            atomic_write(self.audit_path, rewrite)
        return {
            "deleted": len(removed),
            "retained": len(retained),
            "checkpointHash": checkpoint["hash"],
            "deletedEventsDigest": removed_digest,
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
        if phase in {"started", "complete", "cancelled", "error"}:
            self._last_scan_progress_emit_at.clear()
            self._last_scan_progress_processed.clear()
        if phase in {"processing", "processed"}:
            processed = int(metrics.get("processed", 0) or 0)
            total = int(metrics.get("total", 0) or 0)
            now = time.monotonic()
            last_at = self._last_scan_progress_emit_at.get(phase, 0.0)
            last_processed = self._last_scan_progress_processed.get(phase, -SCAN_PROGRESS_THROTTLE_FILES)
            should_emit = (
                processed <= 1
                or (total > 0 and processed >= total)
                or processed - last_processed >= SCAN_PROGRESS_THROTTLE_FILES
                or now - last_at >= SCAN_PROGRESS_THROTTLE_SECONDS
            )
            if not should_emit:
                return
            self._last_scan_progress_emit_at[phase] = now
            self._last_scan_progress_processed[phase] = processed
        on_progress({"phase": phase, **metrics, **extra})

    def _read_json_array(self, path: Path) -> list[dict[str, object]]:
        try:
            role = self._sensitive_file_role(path)
            value = self.workspace_encryption.read_json(path, role=role) if role else json.loads(path.read_text(encoding="utf-8"))
        except WorkspaceEncryptionError:
            raise
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
            role = self._sensitive_file_role(path)
            value = self.workspace_encryption.read_json(path, role=role) if role else json.loads(path.read_text(encoding="utf-8"))
        except WorkspaceEncryptionError:
            raise
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
        role = self._sensitive_file_role(path)
        if role:
            self.workspace_encryption.write_json_atomic(path, value, role=role)
        else:
            atomic_write_text(path, json.dumps(value, separators=(",", ":")))

    def _write_json_array_atomic(self, path: Path, rows: Iterable[object]) -> None:
        # Streams the array so a large candidate list never materializes as one
        # string; the shared mechanism adds durability (fsync) + atomic replace.
        role = self._sensitive_file_role(path)
        if role:
            self.workspace_encryption.write_json_atomic(path, list(rows), role=role)
            return

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

    def _sensitive_file_role(self, path: Path) -> str:
        try:
            if path.expanduser().resolve() == self.content_credentials_identity_path.expanduser().resolve():
                return "c2pa-signing-identity-v1"
        except OSError:
            pass
        return {
            self.consent_path.name: "consent-records-v1",
            self.refs_path.name: "face-references-v1",
            self.candidates_path.name: "review-candidates-v1",
        }.get(path.name, "")

    def _remove_plaintext_reference_vector_store(self) -> None:
        secure_remove_file(self.vector_index_path)
        secure_remove_file(Path(str(self.vector_index_path) + ".faiss"))
        secure_remove_file(self.vector_index_path.with_suffix(self.vector_index_path.suffix + ".tmp"))
        secure_remove_file(Path(str(self.vector_index_path) + ".faiss.tmp"))

    def _migrate_sensitive_state_files(self) -> None:
        if not self.workspace_encryption.enabled:
            return
        for path in (
            self.consent_path,
            self.refs_path,
            self.candidates_path,
            self.content_credentials_identity_path,
        ):
            if not path.exists():
                continue
            role = self._sensitive_file_role(path)
            raw = path.read_bytes()
            if self.workspace_encryption.is_encrypted_bytes(raw):
                if len(self.workspace_encryption.key_candidates) <= 1:
                    continue
                plaintext = self.workspace_encryption.decrypt_bytes(raw, role=role)
                self.workspace_encryption.write_bytes_atomic(path, plaintext, role=role)
                continue
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise WorkspaceEncryptionError(f"Cannot migrate malformed sensitive workspace file: {path.name}") from exc
            expected_type = dict if path in {self.consent_path, self.content_credentials_identity_path} else list
            if not isinstance(parsed, expected_type):
                raise WorkspaceEncryptionError(f"Cannot migrate unexpected sensitive workspace file: {path.name}")
            self.workspace_encryption.write_bytes_atomic(path, raw, role=role)
        self._remove_plaintext_reference_vector_store()

    def _audit_log_encryption_state(self) -> tuple[bool, bool, bool]:
        if not self.audit_path.exists():
            return False, False, False
        has_rows = False
        has_encrypted = False
        has_plaintext = False
        with self.audit_path.open("rb") as handle:
            for raw in handle:
                stripped = raw.strip()
                if not stripped:
                    continue
                has_rows = True
                if stripped.startswith(AUDIT_ENCRYPTED_PREFIX):
                    has_encrypted = True
                else:
                    has_plaintext = True
        return has_rows, has_encrypted, has_plaintext

    def _migrate_audit_log_encryption(self, *, force: bool = False) -> None:
        has_rows, has_encrypted, has_plaintext = self._audit_log_encryption_state()
        if not has_rows:
            return
        if not self.workspace_encryption.enabled:
            if has_encrypted:
                raise WorkspaceEncryptionError(
                    "The audit log is encrypted, but its OS-backed workspace key is unavailable."
                )
            return
        if not force and not has_plaintext and len(self.workspace_encryption.key_candidates) <= 1:
            return
        with self._state_lock():
            def rewrite(handle) -> None:
                with self.audit_path.open("rb") as source:
                    for index, raw in enumerate(source, start=1):
                        if not raw.strip():
                            continue
                        value = self._decode_audit_line(raw)
                        if value is None:
                            raise WorkspaceEncryptionError(
                                f"Cannot migrate malformed audit event at line {index}."
                            )
                        handle.write(self._encode_audit_line(value).decode("ascii"))

            atomic_write(self.audit_path, rewrite)

    def workspace_encryption_status(self) -> dict[str, Any]:
        sensitive_files: list[dict[str, Any]] = []
        for path in (
            self.consent_path,
            self.refs_path,
            self.candidates_path,
            self.content_credentials_identity_path,
        ):
            exists = path.exists()
            encrypted = False
            if exists:
                try:
                    with path.open("rb") as handle:
                        encrypted = self.workspace_encryption.is_encrypted_bytes(handle.read(32))
                except OSError:
                    encrypted = False
            sensitive_files.append({"name": path.name, "exists": exists, "encrypted": encrypted})
        audit_has_rows, audit_has_encrypted, audit_has_plaintext = self._audit_log_encryption_state()
        sensitive_files.append(
            {
                "name": self.audit_path.name,
                "exists": self.audit_path.exists(),
                "encrypted": bool((not audit_has_rows) or (audit_has_encrypted and not audit_has_plaintext)),
                "format": "line-aes-256-gcm" if audit_has_rows and audit_has_encrypted and not audit_has_plaintext else "empty" if not audit_has_rows else "plaintext",
            }
        )
        vector_paths = (self.vector_index_path, Path(str(self.vector_index_path) + ".faiss"))
        status = self.db.encryption_status()
        return {
            **self.workspace_encryption.status(),
            "database": status,
            "sensitiveFiles": sensitive_files,
            "plaintextVectorSidecars": [path.name for path in vector_paths if path.exists()],
            "migrationComplete": bool(
                (not self.workspace_encryption.enabled)
                or (
                    status.get("encryptedHeader")
                    and all((not row["exists"]) or row["encrypted"] for row in sensitive_files)
                    and not any(path.exists() for path in vector_paths)
                )
            ),
        }

    def rotate_workspace_database_key(self, new_key: bytes, *, source: str = "desktop-internal") -> dict[str, Any]:
        if not self.workspace_encryption.enabled:
            raise WorkspaceEncryptionError("Workspace database encryption is not active.")
        plaintext_files: dict[Path, tuple[str, bytes]] = {}
        for path in (
            self.consent_path,
            self.refs_path,
            self.candidates_path,
            self.content_credentials_identity_path,
        ):
            if not path.exists():
                continue
            role = self._sensitive_file_role(path)
            plaintext_files[path] = (role, self.workspace_encryption.read_bytes(path, role=role))
        old_key_id = self.workspace_encryption.key_id
        self.db.rekey(new_key)
        for path, (role, plaintext) in plaintext_files.items():
            self.workspace_encryption.write_bytes_atomic(path, plaintext, role=role)
        self._migrate_audit_log_encryption(force=True)
        self._remove_plaintext_reference_vector_store()
        result = self.workspace_encryption_status()
        self._append_audit(
            {
                "action": "rotate_workspace_database_key",
                "oldKeyId": old_key_id,
                "newKeyId": self.workspace_encryption.key_id,
                "source": str(source or "desktop-internal")[:80],
                "migrationComplete": bool(result.get("migrationComplete")),
            }
        )
        return result

    @contextmanager
    def _state_lock(self):
        self.root.mkdir(parents=True, exist_ok=True)
        start = time.monotonic()
        lock_token = f"{os.getpid()}:{time.monotonic_ns()}:{os.urandom(8).hex()}"
        fd: int | None = None
        stop_heartbeat = threading.Event()
        heartbeat_thread: threading.Thread | None = None

        def lock_payload() -> bytes:
            return f"{lock_token} {now_iso()}\n".encode("utf-8")

        while True:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, lock_payload())
                os.fsync(fd)
                break
            except FileExistsError:
                try:
                    stale_stat = self.lock_path.stat()
                    if time.time() - stale_stat.st_mtime > 45:
                        confirmed_stat = self.lock_path.stat()
                        if confirmed_stat.st_mtime_ns != stale_stat.st_mtime_ns:
                            continue
                        self.lock_path.unlink()
                        continue
                except OSError:
                    pass
                if time.monotonic() - start > 20:
                    raise TimeoutError("Workspace state is locked by another process.")
                time.sleep(0.05)
        try:
            heartbeat_interval = float(os.environ.get("VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS", "15") or 15)
        except ValueError:
            heartbeat_interval = 15.0
        heartbeat_interval = max(0.05, min(15.0, heartbeat_interval))

        def heartbeat() -> None:
            while not stop_heartbeat.wait(heartbeat_interval):
                if fd is None:
                    continue
                try:
                    os.lseek(fd, 0, os.SEEK_SET)
                    os.ftruncate(fd, 0)
                    os.write(fd, lock_payload())
                    os.fsync(fd)
                except OSError:
                    continue

        heartbeat_thread = threading.Thread(target=heartbeat, name="vintrace-state-lock-heartbeat", daemon=True)
        heartbeat_thread.start()
        try:
            yield
        finally:
            stop_heartbeat.set()
            if heartbeat_thread is not None:
                heartbeat_thread.join(timeout=1)
            if fd is not None:
                os.close(fd)
            try:
                current = self.lock_path.read_text(encoding="utf-8")
                if current.startswith(f"{lock_token} "):
                    self.lock_path.unlink()
            except OSError:
                pass
