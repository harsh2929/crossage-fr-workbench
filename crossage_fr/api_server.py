from __future__ import annotations

from contextlib import redirect_stdout
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
import argparse
import hashlib
import heapq
import importlib.util
import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import traceback
import zipfile
from time import monotonic
from typing import Any

from crossage_fr import __version__
from crossage_fr.config import MAX_CLUSTER_MIN_SIZE, MAX_FACE_DETECTOR_SIZE, MIN_FACE_DETECTOR_SIZE, PERFORMANCE_MODES
from crossage_fr.embed import EmbeddingEngine, create_embedding_engine
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, image_decoder_report, load_image
from crossage_fr.ingest.safety import safety_model_report
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, probe_video, video_decoder_report
from crossage_fr.model_manager import MODEL_PACKAGES, download_model_pack, model_pack_ready, model_root_for_config, model_roots_for_engine, model_status, set_model_root
from crossage_fr.models import ReviewCandidate, new_id
from crossage_fr.platform_detect import build_platform_report, memory_available_bytes, process_memory_bytes
from crossage_fr.storage import inspect_storage_path, safe_resolve
from crossage_fr.store import VectorStore
from crossage_fr.workspace_registry import resolve_workspace


try:
    VERIFY_CANDIDATE_BATCH_LIMIT = max(25, int(os.environ.get("CROSSAGE_VERIFY_CANDIDATE_BATCH_LIMIT", "500")))
except ValueError:
    VERIFY_CANDIDATE_BATCH_LIMIT = 500

try:
    ANALYZE_ENTRY_BUDGET = max(10_000, int(os.environ.get("CROSSAGE_ANALYZE_ENTRY_BUDGET", "250000")))
except ValueError:
    ANALYZE_ENTRY_BUDGET = 250_000

try:
    ANALYZE_TIME_BUDGET_MS = max(1_000, int(os.environ.get("CROSSAGE_ANALYZE_TIME_BUDGET_MS", "15000")))
except ValueError:
    ANALYZE_TIME_BUDGET_MS = 15_000


class DesktopApi:
    def __init__(self, workspace: Path, actor: str = "desktop", startup: Any | None = None) -> None:
        self.actor = actor
        self.startup = startup
        self.project = ProjectState(workspace, actor=actor)
        self.consent_on_file = self.project.consent_on_file()
        self._engine: EmbeddingEngine | None = None
        self._engine_model_name = self._infer_engine_name()
        self._startup("workspace", f"Workspace ready: {self.project.root}")
        self._startup("engine", "Recognition engine will load when needed")
        self._startup("platform", "Detecting platform acceleration")
        self.platform_report = build_platform_report()
        self._last_progress_state_at = 0.0
        self._last_progress_state_added = 0
        self._last_resource_status_at = 0.0
        self._last_resource_status: dict[str, Any] = {}
        self._startup("ready", "Backend ready")

    def _startup(self, phase: str, message: str) -> None:
        if self.startup:
            self.startup({"phase": phase, "message": message})

    @property
    def engine_name(self) -> str:
        return self._engine.model_name if self._engine is not None else self._engine_model_name

    def _engine_instance(self) -> EmbeddingEngine:
        if self._engine is None:
            self._startup("engine", "Loading recognition engine")
            with redirect_stdout(sys.stderr):
                self._engine = create_embedding_engine(self._effective_engine_config())
            self._engine_model_name = self._engine.model_name
            self._startup("engine", f"Recognition engine ready: {self._engine_model_name}")
        return self._engine

    def _reset_engine(self) -> None:
        self._engine = None
        self._engine_model_name = self._infer_engine_name()

    def _build_info(self) -> dict[str, Any]:
        commit = (
            os.environ.get("VINTRACE_BUILD_SHA")
            or os.environ.get("GITHUB_SHA")
            or self._git_value(["rev-parse", "--short=12", "HEAD"])
        )
        branch = (
            os.environ.get("VINTRACE_BUILD_REF")
            or os.environ.get("GITHUB_REF_NAME")
            or self._git_value(["rev-parse", "--abbrev-ref", "HEAD"])
        )
        return {
            "name": "Vintrace",
            "version": __version__,
            "commit": commit or "local",
            "branch": branch or "",
            "buildDate": os.environ.get("VINTRACE_BUILD_DATE", ""),
            "channel": os.environ.get("VINTRACE_UPDATE_CHANNEL", os.environ.get("CROSSAGE_UPDATE_CHANNEL", "stable")),
            "packaged": bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1"),
            "python": sys.version.split()[0],
        }

    def _git_value(self, args: list[str]) -> str:
        try:
            repo_root = Path(__file__).resolve().parents[1]
            completed = subprocess.run(
                ["git", *args],
                cwd=repo_root,
                check=False,
                capture_output=True,
                text=True,
                timeout=1.5,
            )
            if completed.returncode == 0:
                return completed.stdout.strip()
        except Exception:
            pass
        return ""

    def _infer_engine_name(self) -> str:
        if os.environ.get("CROSSAGE_FORCE_FALLBACK") == "1":
            return "local-image-fingerprint"
        if importlib.util.find_spec("insightface") is None:
            return "local-image-fingerprint"
        candidates = [self.project.config.model_pack]
        if "buffalo_l" not in candidates:
            candidates.append("buffalo_l")
        for pack in candidates:
            if any(model_pack_ready(root, pack) for root in model_roots_for_engine(self.project.config)):
                return f"insightface-{pack}"
        return "local-image-fingerprint (face model download needed)"

    def _effective_performance_mode(self) -> str:
        mode = str(getattr(self.project.config, "performance_mode", "auto") or "auto").lower()
        if mode == "auto":
            mode = str(getattr(self.platform_report, "recommended_performance_mode", "balanced") or "balanced").lower()
        return mode if mode in {"fast", "balanced", "quality"} else "balanced"

    def _effective_engine_config(self) -> Any:
        config = deepcopy(self.project.config)
        mode = self._effective_performance_mode()
        if mode == "fast":
            config.face_detector_size = min(int(config.face_detector_size), 384)
            config.two_pass_scan = False
            config.verification_detector_size = config.face_detector_size
        elif mode == "balanced":
            config.face_detector_size = min(int(config.face_detector_size), 512)
            config.verification_detector_size = min(max(int(config.verification_detector_size), int(config.face_detector_size)), 640)
        return config

    def handle(self, command: str, params: dict[str, Any], progress: Any | None = None) -> Any:
        if not isinstance(params, dict):
            raise ValueError("Command parameters must be an object.")
        if command == "ping":
            return {"pong": True, "version": __version__}
        if command == "get_state":
            return self.state(
                preview_create_budget=int(params.get("previewBudget", 8) or 0),
                candidate_limit=int(params.get("candidateLimit", 500) or 500),
            )
        if command == "model_status":
            return model_status(self.project.config, self.engine_name)
        if command == "set_performance_mode":
            mode = str(params.get("mode", "auto")).strip().lower()
            if mode not in PERFORMANCE_MODES:
                raise ValueError("Performance mode must be auto, fast, balanced, or quality.")
            previous_effective = self._effective_performance_mode()
            self.project.config.performance_mode = mode
            self.project._append_audit({"action": "set_performance_mode", "mode": mode, "source": str(params.get("source", "desktop"))})
            self.project.save()
            if self._effective_performance_mode() != previous_effective:
                self._reset_engine()
            return self.state()
        if command == "set_model_root":
            root_value = str(params.get("root", "")).strip()
            if not root_value:
                raise ValueError("Choose a model download folder first.")
            root = set_model_root(self.project.config, Path(root_value))
            self.project._append_audit({"action": "set_model_root", "root": str(root), "source": str(params.get("source", "desktop"))})
            self.project.save()
            self._reset_engine()
            return self.state()
        if command == "download_model":
            pack = str(params.get("pack", self.project.config.model_pack or "antelopev2"))
            root_param = str(params.get("root", "")).strip()
            root = set_model_root(self.project.config, Path(root_param)) if root_param else set_model_root(self.project.config, model_root_for_config(self.project.config, prefer_ready=False))
            result = download_model_pack(
                pack,
                root,
                on_progress=(lambda payload: progress(payload, "model_download")) if progress else None,
                force=bool(params.get("force", False)),
            )
            self.project.config.model_pack = pack
            self.project.config.model_root = str(root)
            self.project._append_audit(
                {
                    "action": "download_model",
                    "pack": pack,
                    "root": str(root),
                    "sha256": result.get("sha256"),
                    "bytes": result.get("bytes"),
                    "source": str(params.get("source", "desktop")),
                }
            )
            self.project.save()
            self._reset_engine()
            return {"value": result, "state": self.state()}
        if command == "set_workspace":
            return self.set_workspace(Path(str(params["path"])))
        if command == "set_consent":
            self.consent_on_file = bool(params.get("value"))
            self.project.set_consent(
                self.consent_on_file,
                source=str(params.get("source", self.actor)),
                operator=str(params.get("operator", "")),
                note=str(params.get("note", "")),
                scope=str(params.get("scope", self.project.root)),
            )
            return self.state()
        if command == "enroll":
            self._require_consent()
            engine = self._engine_instance()
            added, errors = self.project.enroll_folder(
                str(params.get("personName", "")),
                str(params.get("ageBucket", "unknown")),
                Path(str(params.get("folder", ""))).expanduser(),
                engine,
            )
            return {"added": added, "errors": errors, "state": self.state()}
        if command == "enroll_age_groups":
            self._require_consent()
            groups_param = params.get("groups", [])
            if not isinstance(groups_param, list):
                raise ValueError("Age-group enrollment expects a list of folders.")
            engine = self._engine_instance()
            added, errors, groups = self.project.enroll_age_groups(
                str(params.get("personName", "")),
                groups_param,
                engine,
            )
            return {"added": added, "errors": errors, "value": {"groups": groups}, "state": self.state()}
        if command == "scan":
            self._require_consent()
            if not self.project.references:
                raise ValueError("Enroll at least one reference before scanning.")
            source = str(params.get("source", "manual"))
            existing_candidate_ids = set(self.project.candidates)
            engine = self._engine_instance()
            added, errors, metrics = self.project.scan_folder(
                Path(str(params.get("folder", ""))).expanduser(),
                engine,
                on_progress=lambda payload: self._progress(progress, {**payload, "source": source}),
                source=source,
                resume=bool(params.get("resume", True)),
                total=int(params.get("total", 0) or 0) or None,
            )
            verification = self._maybe_verify_new_candidates(existing_candidate_ids, metrics, progress, source)
            metrics.update({
                "twoPassVerified": int(verification.get("verified", 0)),
                "twoPassChanged": int(verification.get("changed", 0)),
                "twoPassDeferred": int(verification.get("deferred", 0)),
            })
            return {"added": added, "errors": errors, "metrics": metrics, "state": self.state()}
        if command == "scan_paths":
            self._require_consent()
            if not self.project.references:
                raise ValueError("Enroll at least one reference before scanning.")
            paths_param = params.get("paths", [])
            if not isinstance(paths_param, list):
                raise ValueError("scan_paths expects a list of image or video paths.")
            source = str(params.get("source", "manual"))
            paths = [
                Path(str(item)).expanduser()
                for item in paths_param
                if Path(str(item)).suffix.lower() in IMAGE_EXTENSIONS or Path(str(item)).suffix.lower() in VIDEO_EXTENSIONS
            ]
            existing_candidate_ids = set(self.project.candidates)
            engine = self._engine_instance()
            added, errors, metrics = self.project.scan_paths(
                paths,
                engine,
                on_progress=lambda payload: self._progress(progress, {**payload, "source": source}),
                source=source,
                label=f"{len(paths)} selected file(s)",
                resume=bool(params.get("resume", False)),
            )
            verification = self._maybe_verify_new_candidates(existing_candidate_ids, metrics, progress, source)
            metrics.update({
                "twoPassVerified": int(verification.get("verified", 0)),
                "twoPassChanged": int(verification.get("changed", 0)),
                "twoPassDeferred": int(verification.get("deferred", 0)),
            })
            return {"added": added, "errors": errors, "metrics": metrics, "state": self.state()}
        if command == "analyze_folder":
            return self.analyze_folder(
                Path(str(params.get("folder", ""))).expanduser(),
                max_entries=int(params.get("maxEntries", ANALYZE_ENTRY_BUDGET) or ANALYZE_ENTRY_BUDGET),
                time_budget_ms=int(params.get("timeBudgetMs", ANALYZE_TIME_BUDGET_MS) or ANALYZE_TIME_BUDGET_MS),
            )
        if command == "cancel_scan":
            return self.project.request_scan_cancel(source=str(params.get("source", self.actor)))
        if command == "pause_scan":
            return self.project.request_scan_pause(source=str(params.get("source", self.actor)))
        if command == "resume_scan":
            return self.project.request_scan_resume(source=str(params.get("source", self.actor)))
        if command == "scan_job_status":
            return self.project.scan_job_status()
        if command == "set_status":
            self.project.set_candidate_status(str(params["candidateId"]), str(params["status"]))
            return self.state()
        if command == "bulk_set_status":
            candidate_ids = params.get("candidateIds", [])
            if not isinstance(candidate_ids, list):
                raise ValueError("candidateIds must be a list.")
            count = self.project.bulk_set_candidate_status([str(candidate_id) for candidate_id in candidate_ids], str(params["status"]))
            return {"updated": count, "state": self.state()}
        if command == "set_candidate_note":
            self.project.set_candidate_note(str(params["candidateId"]), str(params.get("note", "")))
            return self.state()
        if command == "block_false_match":
            result = self.project.block_false_match(str(params["candidateId"]), str(params.get("note", "")))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "reassign_candidate_person":
            result = self.project.reassign_candidate_person(
                str(params["candidateId"]),
                str(params["personName"]),
                clear_reference=bool(params.get("clearReference", True)),
            )
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "duplicate_people":
            return self.project.duplicate_people(
                threshold=float(params.get("threshold", 0.82)),
                limit=int(params.get("limit", 20)),
            )
        if command == "apply_review_rules":
            result = self.project.apply_review_rules()
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "query_candidates":
            return self.query_candidates(params)
        if command == "clear_queue":
            self.project.clear_candidates()
            return self.state()
        if command == "purge_candidates":
            statuses = params.get("statuses", ["accepted", "rejected", "uncertain"])
            if not isinstance(statuses, list):
                raise ValueError("statuses must be a list.")
            count = self.project.purge_candidates([str(status) for status in statuses])
            return {"purged": count, "state": self.state()}
        if command == "purge_duplicate_candidates":
            count = self.project.purge_duplicate_candidates()
            return {"purged": count, "state": self.state(), "value": self.project.workspace_health()}
        if command == "prepare_previews":
            prepared = self.project.prepare_previews(int(params.get("limit", 32)))
            return {"prepared": prepared, "state": self.state(preview_create_budget=0)}
        if command == "delete_reference":
            self.project.delete_reference(str(params["refId"]))
            return self.state()
        if command == "delete_person":
            result = self.project.delete_person(str(params["personName"]))
            return {"deleted": result, "state": self.state()}
        if command == "rename_person":
            result = self.project.rename_person(str(params["oldName"]), str(params["newName"]))
            return {"renamed": result, "state": self.state()}
        if command == "clear_references":
            count = self.project.clear_references()
            return {"cleared": count, "state": self.state()}
        if command == "purge_old_candidates":
            statuses = params.get("statuses", ["accepted", "rejected", "uncertain"])
            if not isinstance(statuses, list):
                raise ValueError("statuses must be a list.")
            count = self.project.purge_old_candidates(int(params.get("days", 90)), [str(status) for status in statuses])
            return {"purged": count, "state": self.state()}
        if command == "repair_workspace":
            result = self.project.repair_workspace(dry_run=bool(params.get("dryRun", True)), force=bool(params.get("force", False)))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "database_integrity":
            return self.project.database_integrity()
        if command == "repair_database_integrity":
            result = self.project.repair_database_integrity(confirm=bool(params.get("confirm", False)))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "relink_workspace_paths":
            result = self.project.relink_workspace_paths(
                Path(str(params.get("oldRoot", ""))).expanduser(),
                Path(str(params.get("newRoot", ""))).expanduser(),
                dry_run=bool(params.get("dryRun", True)),
                force_partial=bool(params.get("forcePartial", False)),
            )
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_report":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_report(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state()}
        if command == "export_workspace_inventory":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_workspace_inventory(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_audit_log":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_audit_log(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_consent_receipt":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_consent_receipt(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "retention_policy_report":
            return self.project.retention_policy_report()
        if command == "export_safe_mode_audit":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_safe_mode_audit(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "model_drift_report":
            return self.project.model_drift_report(self.engine_name)
        if command == "export_review_ledger":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_review_ledger(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_scan_history":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_scan_history(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_workspace_backup":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_workspace_backup(
                Path(folder_param).expanduser() if folder_param else None,
                include_generated=bool(params.get("includeGenerated", True)),
            )
            return {"value": result, "state": self.state()}
        if command == "verify_workspace_backup":
            path_param = str(params.get("path", "")).strip()
            result = self.project.verify_workspace_backup(Path(path_param).expanduser() if path_param else None)
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "prune_workspace_backups":
            result = self.project.prune_workspace_backups(int(params.get("keep", 5) or 5))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "prune_scan_manifests":
            result = self.project.prune_scan_manifests(int(params.get("keepRuns", 20) or 20))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "export_candidates":
            candidate_ids = params.get("candidateIds", [])
            if not isinstance(candidate_ids, list):
                raise ValueError("candidateIds must be a list.")
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_candidates(
                [str(candidate_id) for candidate_id in candidate_ids],
                Path(folder_param).expanduser() if folder_param else None,
            )
            return {"value": result, "state": self.state()}
        if command == "export_media_bundle":
            candidate_ids = params.get("candidateIds")
            if candidate_ids is not None and not isinstance(candidate_ids, list):
                raise ValueError("candidateIds must be a list.")
            statuses = params.get("statuses", ["accepted"])
            if not isinstance(statuses, list):
                raise ValueError("statuses must be a list.")
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_media_bundle(
                [str(candidate_id) for candidate_id in candidate_ids] if isinstance(candidate_ids, list) else None,
                Path(folder_param).expanduser() if folder_param else None,
                [str(status) for status in statuses],
                include_original_media=bool(params.get("includeOriginalMedia", True)),
            )
            return {"value": result, "state": self.state()}
        if command == "workspace_health":
            return self.project.workspace_health()
        if command == "runtime_self_test":
            return self.runtime_self_test()
        if command == "runtime_benchmark":
            return self.runtime_benchmark()
        if command == "benchmark_history":
            return self.project.benchmark_history(limit=int(params.get("limit", 8) or 8))
        if command == "storage_io_benchmark":
            return self.storage_io_benchmark(params)
        if command == "release_readiness":
            return self.release_readiness()
        if command == "model_integrity":
            return self.model_integrity()
        if command == "model_distribution_audit":
            return self.model_distribution_audit()
        if command == "export_support_bundle":
            result = self.export_support_bundle(include_paths=bool(params.get("includePaths", False)))
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "installer_self_diagnostics":
            return self.installer_self_diagnostics()
        if command == "calibration_summary":
            return self.project.calibration_summary()
        if command == "accuracy_evaluation":
            return self.project.accuracy_evaluation()
        if command == "apply_calibration":
            result = self.project.apply_calibration_to_config()
            self._reset_engine()
            return {"value": result, "state": self.state()}
        if command == "export_accuracy_labels":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_accuracy_labels(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state()}
        if command == "import_accuracy_labels":
            rows = params.get("rows", [])
            if not isinstance(rows, list):
                raise ValueError("Accuracy labels must be a list of rows.")
            result = self.project.import_accuracy_labels([row for row in rows if isinstance(row, dict)])
            return {"value": result, "state": self.state()}
        if command == "privacy_report":
            return self.project.privacy_report()
        if command == "delete_face_data":
            result = self.project.delete_face_data(
                confirm=bool(params.get("confirm", False)),
                include_audit=bool(params.get("includeAudit", False)),
            )
            return {"value": result, "state": self.state()}
        if command == "optimize_workspace":
            result = self.project.optimize_workspace()
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "enforce_storage_budget":
            result = self.project.enforce_storage_budget()
            return {"value": result, "state": self.state(preview_create_budget=0)}
        if command == "add_calibration_label":
            row = params.get("row", {})
            if not isinstance(row, dict):
                raise ValueError("Calibration label must be an object.")
            return self.project.add_calibration_label({str(key): value for key, value in row.items()})
        if command == "audit_events":
            return self.project.audit_events(int(params.get("limit", 100)), int(params.get("offset", 0)))
        if command == "record_audit":
            row = params.get("row", {})
            if not isinstance(row, dict):
                raise ValueError("Audit row must be an object.")
            self.project._append_audit({str(key): value for key, value in row.items()})
            return {"ok": True}
        if command == "save_settings":
            thresholds = self.project.config.thresholds
            incoming = params.get("thresholds", {})
            if not isinstance(incoming, dict):
                raise ValueError("Threshold settings must be an object.")
            confident = float(incoming.get("confident", thresholds.confident))
            likely = float(incoming.get("likely", thresholds.likely))
            relaxed_child = float(incoming.get("relaxedChild", thresholds.relaxed_child))
            quality_min = float(incoming.get("qualityMin", thresholds.quality_min))
            values = [confident, likely, relaxed_child, quality_min]
            if any(not math.isfinite(value) or value < 0.0 or value > 1.0 for value in values):
                raise ValueError("Thresholds and quality minimum must be between 0 and 1.")
            if not confident >= likely >= relaxed_child:
                raise ValueError("Thresholds must be descending: confident >= likely >= relaxed child.")
            cluster_min_size = int(params.get("clusterMinSize", self.project.config.cluster_min_size))
            if cluster_min_size < 2:
                raise ValueError("Cluster minimum size must be at least 2.")
            if cluster_min_size > MAX_CLUSTER_MIN_SIZE:
                raise ValueError(f"Cluster minimum size must be {MAX_CLUSTER_MIN_SIZE} or lower.")
            face_detector_size = int(params.get("faceDetectorSize", self.project.config.face_detector_size))
            if face_detector_size < MIN_FACE_DETECTOR_SIZE:
                raise ValueError(f"Face scan detail must be at least {MIN_FACE_DETECTOR_SIZE}.")
            if face_detector_size > MAX_FACE_DETECTOR_SIZE:
                raise ValueError(f"Face scan detail must be {MAX_FACE_DETECTOR_SIZE} or lower.")
            face_detector_size = int(round(face_detector_size / 32) * 32)
            two_pass_scan = bool(params.get("twoPassScan", self.project.config.two_pass_scan))
            verification_detector_size = int(params.get("verificationDetectorSize", self.project.config.verification_detector_size))
            if verification_detector_size < MIN_FACE_DETECTOR_SIZE:
                raise ValueError(f"High-detail recheck must be at least {MIN_FACE_DETECTOR_SIZE}.")
            if verification_detector_size > MAX_FACE_DETECTOR_SIZE:
                raise ValueError(f"High-detail recheck must be {MAX_FACE_DETECTOR_SIZE} or lower.")
            verification_detector_size = int(round(verification_detector_size / 32) * 32)
            if verification_detector_size < face_detector_size:
                verification_detector_size = face_detector_size
            performance_mode = str(params.get("performanceMode", self.project.config.performance_mode)).strip().lower()
            if performance_mode not in PERFORMANCE_MODES:
                raise ValueError("Performance mode must be auto, fast, balanced, or quality.")
            storage_budget_bytes = int(params.get("storageBudgetBytes", self.project.config.storage_budget_bytes))
            if storage_budget_bytes < 0:
                raise ValueError("Storage limit must be zero or higher.")
            storage_budget_bytes = min(storage_budget_bytes, 10 * 1024 * 1024 * 1024 * 1024)
            max_media_file_bytes = int(params.get("maxMediaFileBytes", self.project.config.max_media_file_bytes))
            if max_media_file_bytes < 0:
                raise ValueError("Maximum media file size must be zero or higher.")
            max_media_file_bytes = min(max_media_file_bytes, 10 * 1024 * 1024 * 1024 * 1024)
            review_rules = params.get("reviewRules", {})
            if not isinstance(review_rules, dict):
                raise ValueError("Review rules must be an object.")
            auto_reject_below = float(review_rules.get("autoRejectBelow", self.project.config.auto_reject_below))
            if not math.isfinite(auto_reject_below) or auto_reject_below < 0.0 or auto_reject_below > 1.0:
                raise ValueError("Auto-reject level must be between 0 and 1.")
            auto_uncertain_low_quality = bool(review_rules.get("autoUncertainLowQuality", self.project.config.auto_uncertain_low_quality))
            auto_reject_low_quality_video = bool(review_rules.get("autoRejectLowQualityVideo", self.project.config.auto_reject_low_quality_video))
            scan_exclusions = params.get("scanExclusions", {})
            if not isinstance(scan_exclusions, dict):
                raise ValueError("Scan exclusions must be an object.")
            excluded_dir_names = self._string_list(scan_exclusions.get("dirNames", self.project.config.excluded_dir_names), "Excluded folder names")
            excluded_path_keywords = self._string_list(scan_exclusions.get("pathKeywords", self.project.config.excluded_path_keywords), "Excluded path words")
            excluded_extensions = self._extension_list(scan_exclusions.get("extensions", self.project.config.excluded_extensions))
            excluded_file_paths = self._string_list(scan_exclusions.get("filePaths", self.project.config.excluded_file_paths), "Excluded files", limit=400)
            safe_mode_threshold = float(params.get("safeModeThreshold", self.project.config.safe_mode_threshold))
            if not math.isfinite(safe_mode_threshold) or safe_mode_threshold < 0.0 or safe_mode_threshold > 1.0:
                raise ValueError("Safe Mode threshold must be between 0 and 1.")
            thresholds.confident = confident
            thresholds.likely = likely
            thresholds.relaxed_child = relaxed_child
            thresholds.quality_min = quality_min
            self.project.config.cluster_min_size = cluster_min_size
            self.project.config.face_detector_size = face_detector_size
            self.project.config.two_pass_scan = two_pass_scan
            self.project.config.verification_detector_size = verification_detector_size
            self.project.config.performance_mode = performance_mode
            self.project.config.storage_budget_bytes = storage_budget_bytes
            self.project.config.max_media_file_bytes = max_media_file_bytes
            self.project.config.auto_reject_below = auto_reject_below
            self.project.config.auto_uncertain_low_quality = auto_uncertain_low_quality
            self.project.config.auto_reject_low_quality_video = auto_reject_low_quality_video
            self.project.config.excluded_dir_names = excluded_dir_names
            self.project.config.excluded_path_keywords = excluded_path_keywords
            self.project.config.excluded_extensions = excluded_extensions
            self.project.config.excluded_file_paths = excluded_file_paths
            self.project.config.safe_mode = bool(params.get("safeMode", self.project.config.safe_mode))
            self.project.config.safe_mode_threshold = safe_mode_threshold
            self.project._append_audit(
                {
                    "action": "save_settings",
                    "thresholds": {
                        "confident": confident,
                        "likely": likely,
                        "relaxed_child": relaxed_child,
                        "quality_min": quality_min,
                    },
                    "cluster_min_size": cluster_min_size,
                    "face_detector_size": face_detector_size,
                    "two_pass_scan": two_pass_scan,
                    "verification_detector_size": verification_detector_size,
                    "performance_mode": performance_mode,
                    "storage_budget_bytes": storage_budget_bytes,
                    "max_media_file_bytes": max_media_file_bytes,
                    "review_rules": {
                        "auto_reject_below": auto_reject_below,
                        "auto_uncertain_low_quality": auto_uncertain_low_quality,
                        "auto_reject_low_quality_video": auto_reject_low_quality_video,
                    },
                    "scan_exclusions": {
                        "dir_names": excluded_dir_names,
                        "path_keywords": excluded_path_keywords,
                        "extensions": excluded_extensions,
                        "file_paths": excluded_file_paths,
                    },
                    "safe_mode": self.project.config.safe_mode,
                    "safe_mode_threshold": safe_mode_threshold,
                    "source": str(params.get("source", "desktop")),
                    "reason": str(params.get("reason", ""))[:800],
                }
            )
            self.project.save()
            self._reset_engine()
            return self.state()
        raise ValueError(f"Unknown command: {command}")

    def _verification_engine(self) -> Any | None:
        config = self._effective_engine_config()
        if not config.two_pass_scan:
            return None
        if config.verification_detector_size <= config.face_detector_size:
            return None
        config.face_detector_size = config.verification_detector_size
        with redirect_stdout(sys.stderr):
            return create_embedding_engine(config)

    def _maybe_verify_new_candidates(
        self,
        existing_candidate_ids: set[str],
        scan_metrics: dict[str, Any],
        progress: Any | None,
        source: str,
    ) -> dict[str, int]:
        if int(scan_metrics.get("cancelled", 0) or 0):
            return {}
        verification_engine = self._verification_engine()
        if verification_engine is None:
            return {}
        candidate_ids = [
            candidate_id
            for candidate_id in self.project.candidates
            if candidate_id not in existing_candidate_ids
        ]
        if not candidate_ids:
            return {}
        deferred = max(0, len(candidate_ids) - VERIFY_CANDIDATE_BATCH_LIMIT)
        result = self.project.verify_candidates(
            candidate_ids[:VERIFY_CANDIDATE_BATCH_LIMIT],
            verification_engine,
            on_progress=lambda payload: self._progress(progress, {**payload, "source": source}) if progress else None,
        )
        result["deferred"] = deferred
        return result

    def _string_list(self, value: Any, label: str, limit: int = 80) -> list[str]:
        if not isinstance(value, list):
            raise ValueError(f"{label} must be a list.")
        result: list[str] = []
        seen: set[str] = set()
        for item in value[:limit]:
            text = str(item).strip()
            if not text:
                continue
            key = text.casefold()
            if key in seen:
                continue
            seen.add(key)
            result.append(text[:160])
        return result

    def _extension_list(self, value: Any) -> list[str]:
        result: list[str] = []
        for item in self._string_list(value, "Excluded file types", limit=80):
            extension = item.strip().lower()
            if not extension:
                continue
            if not extension.startswith("."):
                extension = f".{extension}"
            result.append(extension[:32])
        return result

    def set_workspace(self, path: Path) -> dict[str, Any]:
        self.project = ProjectState(path.expanduser().resolve(), actor=self.actor)
        self.consent_on_file = self.project.consent_on_file()
        self._reset_engine()
        return self.state()

    def analyze_folder(self, folder: Path, max_entries: int = ANALYZE_ENTRY_BUDGET, time_budget_ms: int = ANALYZE_TIME_BUDGET_MS) -> dict[str, Any]:
        resolved = safe_resolve(folder)
        storage = inspect_storage_path(resolved, self.project.root)
        entry_budget = max(1, int(max_entries or ANALYZE_ENTRY_BUDGET))
        time_budget_ms = max(1_000, int(time_budget_ms or ANALYZE_TIME_BUDGET_MS))
        deadline = monotonic() + (time_budget_ms / 1000)
        result: dict[str, Any] = {
            "folder": str(resolved),
            "exists": bool(storage.get("exists")),
            "isDirectory": bool(storage.get("isDirectory")),
            "entriesChecked": 0,
            "entryBudget": entry_budget,
            "timeBudgetMs": time_budget_ms,
            "truncated": False,
            "imageCount": 0,
            "videoCount": 0,
            "nonImageCount": 0,
            "excludedCount": 0,
            "excludedDirectoryCount": 0,
            "statErrorCount": 0,
            "walkErrorCount": 0,
            "transientErrorCount": 0,
            "excludedSamples": [],
            "totalBytes": 0,
            "checkedImages": 0,
            "checkedVideos": 0,
            "unreadableSamples": [],
            "unreadableVideoSamples": [],
            "imageSamples": [],
            "videoSamples": [],
            "extensionCounts": {},
            "recommendations": [],
            "estimate": {},
            "plan": {},
            "decoder": image_decoder_report(),
            "videoDecoder": video_decoder_report(),
            "storage": storage,
        }
        if not result["exists"]:
            result["recommendations"].append("Choose an existing folder before scanning.")
            return result
        if not result["isDirectory"]:
            result["recommendations"].append("Choose a folder rather than a single file.")
            return result
        image_samples_for_decode: list[Path] = []
        video_samples_for_decode: list[Path] = []
        stack = [resolved]
        while stack:
            if result["entriesChecked"] >= entry_budget or monotonic() >= deadline:
                result["truncated"] = True
                break
            current = stack.pop()
            try:
                entries_context = os.scandir(current)
            except OSError as exc:
                result["walkErrorCount"] += 1
                result["transientErrorCount"] += 1
                if len(result["unreadableSamples"]) < 8:
                    result["unreadableSamples"].append({"path": str(current), "error": str(exc)})
                continue
            with entries_context as entries:
                for entry in entries:
                    result["entriesChecked"] += 1
                    if result["entriesChecked"] > entry_budget or monotonic() >= deadline:
                        result["truncated"] = True
                        break
                    path = Path(entry.path)
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                        is_file = entry.is_file(follow_symlinks=False)
                    except OSError as exc:
                        result["walkErrorCount"] += 1
                        result["transientErrorCount"] += 1
                        if len(result["unreadableSamples"]) < 8:
                            result["unreadableSamples"].append({"path": str(path), "error": str(exc)})
                        continue
                    if is_dir:
                        reason = self.project.scan_exclusion_reason(path, is_dir=True)
                        if reason:
                            result["excludedDirectoryCount"] += 1
                            if len(result["excludedSamples"]) < 8:
                                result["excludedSamples"].append({"path": str(path), "reason": reason})
                        else:
                            stack.append(path)
                        continue
                    if not is_file:
                        continue
                    suffix = path.suffix.lower()
                    exclusion_reason = self.project.scan_exclusion_reason(path, is_dir=False)
                    if exclusion_reason:
                        result["excludedCount"] += 1
                        if len(result["excludedSamples"]) < 8:
                            result["excludedSamples"].append({"path": str(path), "reason": exclusion_reason})
                        continue
                    if suffix in IMAGE_EXTENSIONS:
                        result["imageCount"] += 1
                        extension_counts = result["extensionCounts"]
                        extension_counts[suffix] = int(extension_counts.get(suffix, 0)) + 1
                        if len(image_samples_for_decode) < 24:
                            image_samples_for_decode.append(path)
                        try:
                            result["totalBytes"] += path.stat().st_size
                        except OSError:
                            result["statErrorCount"] += 1
                            result["transientErrorCount"] += 1
                        if len(result["imageSamples"]) < 8:
                            result["imageSamples"].append(str(path))
                    elif suffix in VIDEO_EXTENSIONS:
                        result["videoCount"] += 1
                        extension_counts = result["extensionCounts"]
                        extension_counts[suffix] = int(extension_counts.get(suffix, 0)) + 1
                        try:
                            result["totalBytes"] += path.stat().st_size
                        except OSError:
                            result["statErrorCount"] += 1
                            result["transientErrorCount"] += 1
                        if len(result["videoSamples"]) < 8:
                            result["videoSamples"].append(str(path))
                        if len(video_samples_for_decode) < 12:
                            video_samples_for_decode.append(path)
                    else:
                        result["nonImageCount"] += 1
            if result["truncated"]:
                break
        decode_budget_exhausted = False
        for path in image_samples_for_decode:
            if monotonic() >= deadline:
                decode_budget_exhausted = True
                break
            result["checkedImages"] += 1
            try:
                load_image(path)
            except Exception as exc:
                if len(result["unreadableSamples"]) < 8:
                    result["unreadableSamples"].append({"path": str(path), "error": str(exc)})
        for path in video_samples_for_decode:
            if monotonic() >= deadline:
                decode_budget_exhausted = True
                break
            result["checkedVideos"] += 1
            try:
                probe_video(path)
            except Exception as exc:
                if len(result["unreadableVideoSamples"]) < 8:
                    result["unreadableVideoSamples"].append({"path": str(path), "error": str(exc)})
        if result["imageCount"] == 0 and result["videoCount"] == 0:
            result["recommendations"].append("No supported image or video files were found in this folder.")
        extension_counts = result["extensionCounts"]
        decoder = result["decoder"]
        if isinstance(extension_counts, dict) and isinstance(decoder, dict):
            heif_exts = {".heic", ".heif", ".hif", ".heics", ".heifs"}
            raw_exts = {".dng", ".raw", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".orf", ".raf", ".rw2", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".kdc", ".mos", ".mrw"}
            if any(ext in extension_counts for ext in heif_exts) and not decoder.get("heifAvailable"):
                result["recommendations"].append("HEIC/HEIF files were found, but pillow-heif is not installed.")
            if any(ext in extension_counts for ext in raw_exts) and not decoder.get("rawAvailable"):
                result["recommendations"].append("RAW camera files were found, but rawpy is not installed.")
        if result["unreadableSamples"]:
            result["recommendations"].append("Some sampled images could not be opened and will be counted as scan errors.")
        if result["unreadableVideoSamples"]:
            result["recommendations"].append("Some sampled videos could not be opened and will be counted as scan errors.")
        if result["transientErrorCount"]:
            result["recommendations"].append("Some files or folders changed while checking. If this is a USB drive, keep it connected and retry.")
        if result["truncated"]:
            result["recommendations"].append("Folder check stopped at the safety limit. The scan itself will continue streaming all files with resume support.")
        if decode_budget_exhausted:
            result["recommendations"].append("Folder check skipped some sample decoding because the time limit was reached.")
        for warning in storage.get("warnings", []):
            if warning not in result["recommendations"]:
                result["recommendations"].append(str(warning))
        if result["excludedCount"] or result["excludedDirectoryCount"]:
            result["recommendations"].append("Scan exclusions are active; skipped folders and file types will not be processed.")
        if self.project.config.max_media_file_bytes > 0:
            result["recommendations"].append("Large-file guard is active; media above the selected size limit will be skipped.")
        if self.project.config.safe_mode:
            result["recommendations"].append("Safe Mode is on; likely intimate images and videos will be protected from matching and clustering.")
        if not self.project.references:
            result["recommendations"].append("Enroll at least one reference before scanning.")
        if self.project.config.require_consent and not self.consent_on_file:
            result["recommendations"].append("Mark consent before processing images and videos.")
        if not result["recommendations"]:
            result["recommendations"].append("Folder is ready for scanning.")
        result["estimate"] = self._estimate_scan_duration(result)
        result["plan"] = self._build_scan_plan(result)
        return result

    def _estimate_scan_duration(self, analysis: dict[str, Any]) -> dict[str, Any]:
        image_count = int(analysis.get("imageCount", 0) or 0)
        video_count = int(analysis.get("videoCount", 0) or 0)
        extension_counts = analysis.get("extensionCounts", {})
        heic_count = int(extension_counts.get(".heic", 0) + extension_counts.get(".heif", 0)) if isinstance(extension_counts, dict) else 0
        config = self._effective_engine_config()
        detector_size = max(MIN_FACE_DETECTOR_SIZE, min(MAX_FACE_DETECTOR_SIZE, config.face_detector_size))
        base_rate = 3.6 if detector_size <= 512 else 3.1
        if detector_size <= 384:
            base_rate = 4.2
        heic_penalty_seconds = heic_count * 0.12
        image_seconds = image_count / max(base_rate, 0.1) + heic_penalty_seconds
        sampled_video_frames = video_count * 9
        video_seconds = sampled_video_frames / 2.8
        two_pass_seconds = image_count * 0.04 if config.two_pass_scan and config.verification_detector_size > detector_size else 0.0
        total_seconds = image_seconds + video_seconds + two_pass_seconds
        return {
            "detectorSize": detector_size,
            "performanceMode": self.project.config.performance_mode,
            "effectivePerformanceMode": self._effective_performance_mode(),
            "imagesPerSecond": round(base_rate, 2),
            "imageSeconds": int(image_seconds),
            "videoSeconds": int(video_seconds),
            "twoPassSeconds": int(two_pass_seconds),
            "totalSeconds": int(total_seconds),
            "label": self._duration_label(total_seconds),
            "assumptions": [
                "Estimate uses recent local benchmarks and media counts.",
                "Large HEIC files and long videos can vary substantially.",
                "Resume skips and embedding cache can reduce repeated scan time.",
            ],
        }

    def _build_scan_plan(self, analysis: dict[str, Any]) -> dict[str, Any]:
        image_count = int(analysis.get("imageCount", 0) or 0)
        video_count = int(analysis.get("videoCount", 0) or 0)
        media_count = image_count + video_count
        total_bytes = int(analysis.get("totalBytes", 0) or 0)
        extension_counts = analysis.get("extensionCounts", {})
        estimate = analysis.get("estimate", {}) if isinstance(analysis.get("estimate"), dict) else {}
        storage = analysis.get("storage", {}) if isinstance(analysis.get("storage"), dict) else {}
        scale = self.project.scale_summary()
        config = self._effective_engine_config()
        effective_mode = self._effective_performance_mode()
        mode = "Balanced"
        if media_count >= 250_000:
            mode = "Large library"
        elif storage.get("externalLikely") or storage.get("networkLikely"):
            mode = "External drive"
        elif video_count > image_count * 0.1 and video_count > 50:
            mode = "Video aware"
        elif config.face_detector_size <= 384:
            mode = "Fast discovery"
        warnings: list[str] = []
        if media_count >= 1_000_000:
            warnings.append("Use an external or SSD-backed app folder; this is a million-file scale job.")
        elif media_count >= 100_000:
            warnings.append("Keep the app open and use pause/resume rather than restarting the scan.")
        if isinstance(extension_counts, dict) and any(ext in extension_counts for ext in (".heic", ".heif", ".dng", ".raw", ".cr3", ".nef")):
            warnings.append("Apple/RAW formats are supported but can scan slower than JPEG/PNG.")
        if video_count:
            warnings.append("Videos are sampled into review moments; export bundles may copy original video files.")
        for warning in storage.get("warnings", []):
            if str(warning) not in warnings:
                warnings.append(str(warning))
        if storage.get("externalLikely"):
            warnings.append("Avoid unplugging or sleeping the computer during this scan; resume can continue after interruptions.")
        if storage.get("networkLikely"):
            warnings.append("Prefer scanning from a local copy when possible; network latency can make face extraction uneven.")
        if not self.project.references:
            warnings.append("Add at least one person before starting the scan.")
        if self.project.config.require_consent and not self.consent_on_file:
            warnings.append("Confirm permission before scanning.")
        estimated_db_bytes = media_count * 620
        estimated_preview_bytes = max(1, min(media_count, 50_000)) * 36_000 if media_count else 0
        return {
            "mode": mode,
            "mediaCount": media_count,
            "estimatedTotalSeconds": int(estimate.get("totalSeconds", 0) or 0),
            "estimatedWorkspaceBytes": estimated_db_bytes + estimated_preview_bytes,
            "sourceBytes": total_bytes,
            "storage": {
                "volumeKind": storage.get("volumeKind", "unknown"),
                "mountRoot": storage.get("mountRoot", ""),
                "externalLikely": bool(storage.get("externalLikely")),
                "networkLikely": bool(storage.get("networkLikely")),
                "sameVolumeAsWorkspace": bool(storage.get("sameVolumeAsWorkspace")),
                "freeBytes": int(storage.get("freeBytes", 0) or 0),
            },
            "resumable": True,
            "safeMode": bool(self.project.config.safe_mode),
            "performanceMode": self.project.config.performance_mode,
            "effectivePerformanceMode": effective_mode,
            "effectiveFaceDetectorSize": config.face_detector_size,
            "twoPass": bool(config.two_pass_scan),
            "effectiveVerificationDetectorSize": config.verification_detector_size,
            "cache": {
                "safetyEntries": int(scale.get("safetyCacheEntries", 0) or 0),
                "embeddingEntries": int(scale.get("embeddingCacheEntries", 0) or 0),
                "manifestFiles": int(scale.get("manifestFiles", 0) or 0),
            },
            "stages": [
                "Stream folder paths from disk",
                "Skip completed files from previous manifest",
                "Run Safe Mode before matching",
                "Cache face detections by file hash",
                "Recheck likely matches at higher detail" if config.two_pass_scan else "Use one-pass matching",
                "Show review results while scanning continues",
            ],
            "warnings": warnings,
            "recommendedAction": warnings[0] if warnings else "Folder is ready for a resumable scan.",
        }

    def _duration_label(self, seconds: float) -> str:
        seconds = max(0, int(seconds))
        hours, remainder = divmod(seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        if hours:
            return f"About {hours}h {minutes}m"
        return f"About {max(1, minutes)}m" if minutes else "Under 1m"

    def runtime_self_test(self) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []

        def add(name: str, ok: bool, detail: str, value: Any = None) -> None:
            row: dict[str, Any] = {"name": name, "ok": bool(ok), "detail": detail}
            if value is not None:
                row["value"] = value
            checks.append(row)

        platform = asdict(self.platform_report)
        safe_model = safety_model_report()
        image_decoder = image_decoder_report()
        video_decoder = video_decoder_report()
        workspace_ok = False
        workspace_detail = "Workspace write check failed."
        probe_path = self.project.root / ".self-test-write"
        try:
            probe_path.write_text("ok", encoding="utf-8")
            workspace_ok = probe_path.read_text(encoding="utf-8") == "ok"
            workspace_detail = "Workspace is writable."
        except OSError as exc:
            workspace_detail = str(exc)
        finally:
            try:
                probe_path.unlink()
            except OSError:
                pass
        add("Workspace write", workspace_ok, workspace_detail)
        add("Recognition engine", bool(self.engine_name), self.engine_name)
        face_model = model_status(self.project.config, self.engine_name)
        add("Face model", bool(face_model.get("ready")), str(face_model.get("recommendation") or face_model.get("engine")), face_model)
        add("Safe Mode model", bool(safe_model.get("available")), str(safe_model.get("modelName") or safe_model.get("reason") or safe_model.get("engine")), safe_model)
        add("Image decoder", bool(image_decoder.get("extensions")), f"{len(image_decoder.get('extensions', []))} supported extension(s).", image_decoder)
        add("Video decoder", bool(video_decoder.get("opencvAvailable")), str(video_decoder.get("backend") or "Unavailable"), video_decoder)
        add("Acceleration", bool(platform.get("primary_provider")), str(platform.get("accelerator_status") or platform.get("primary_provider")), platform)
        health = self.project.workspace_health()
        add("Workspace health", not any(health.get(key, 0) for key in ("missingReferences", "missingCandidates", "missingMediaSources")), "Missing-file checks complete.", health)
        recommendations = []
        if not safe_model.get("available"):
            recommendations.append("Install or bundle an ONNX Safe Mode model before production use.")
        if not face_model.get("ready"):
            recommendations.append("Download a face model before sharing production installers.")
        if not video_decoder.get("opencvAvailable"):
            recommendations.append("Install OpenCV video support to scan video files.")
        if health.get("duplicateCandidateCount"):
            recommendations.append("Run duplicate cleanup before final export.")
        if not recommendations:
            recommendations.append("Runtime checks passed.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": all(check["ok"] for check in checks),
            "checks": checks,
            "recommendations": recommendations,
        }

    def runtime_benchmark(self) -> dict[str, Any]:
        started = monotonic()
        vector_store = VectorStore()
        base_vector = [1.0] + [0.0] * 511
        add_count = 2048
        search_count = 256
        add_started = monotonic()
        for index in range(add_count):
            vector = base_vector.copy()
            vector[index % 512] = 1.0
            vector_store.add(f"bench-{index}", vector)
        add_ms = max(0.0, (monotonic() - add_started) * 1000)
        search_started = monotonic()
        for _ in range(search_count):
            vector_store.search(base_vector, k=20)
        search_ms = max(0.0, (monotonic() - search_started) * 1000)
        state_started = monotonic()
        state = self.state(preview_create_budget=0)
        state_ms = max(0.0, (monotonic() - state_started) * 1000)
        scale = self.project.scale_summary()
        storage_io = self.storage_io_benchmark({"path": str(self.project.root), "sizeMb": 8, "source": "runtime_benchmark"})
        recommendations = self._benchmark_recommendations(state_ms, scale)
        recommendations.extend(str(item) for item in storage_io.get("recommendations", []) if str(item) not in recommendations)
        result = {
            "runId": new_id("bench"),
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "durationMs": int((monotonic() - started) * 1000),
            "vectorBackend": vector_store.backend_name,
            "performanceTier": self.platform_report.performance_tier,
            "performanceMode": self.project.config.performance_mode,
            "effectivePerformanceMode": self._effective_performance_mode(),
            "resourceStatus": self._resource_status(force=True),
            "vectorAddPerSecond": round(add_count / max(add_ms / 1000, 0.001), 2),
            "vectorSearchP50MsEstimate": round(search_ms / max(search_count, 1), 4),
            "stateSerializeMs": round(state_ms, 2),
            "stateCandidateWindow": state.get("candidateWindow", {}),
            "scale": scale,
            "storageIo": storage_io,
            "recommendations": recommendations,
        }
        self.project.db.add_benchmark_run(str(result["runId"]), result)
        return result

    def storage_io_benchmark(self, params: dict[str, Any]) -> dict[str, Any]:
        path_param = str(params.get("path", "") or "").strip()
        target = Path(path_param).expanduser() if path_param else self.project.root
        if target.exists() and target.is_file():
            target = target.parent
        size_mb = max(1, min(128, int(params.get("sizeMb", 8) or 8)))
        total_bytes = size_mb * 1024 * 1024
        storage = inspect_storage_path(target, self.project.root)
        result: dict[str, Any] = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "path": str(target),
            "sizeBytes": total_bytes,
            "ok": False,
            "writeMs": 0.0,
            "readMs": 0.0,
            "writeMBps": 0.0,
            "readMBps": 0.0,
            "fsyncMs": 0.0,
            "storage": storage,
            "error": "",
            "recommendations": [],
        }
        if not storage.get("exists") or not storage.get("isDirectory"):
            result["error"] = "Target folder does not exist."
            result["recommendations"] = ["Choose an existing writable folder for the I/O benchmark."]
            return result
        if not os.access(target, os.W_OK):
            result["error"] = "Target folder is not writable."
            result["recommendations"] = ["Choose a writable app folder or grant drive permissions before scanning."]
            return result

        chunk = b"vintrace-io-benchmark\n" * 32768
        chunk = chunk[: min(len(chunk), 1024 * 1024)]
        temp_path = target / f".vintrace-io-bench-{os.getpid()}-{new_id('io')}.bin"
        try:
            written = 0
            write_started = monotonic()
            with temp_path.open("wb") as handle:
                while written < total_bytes:
                    piece = chunk[: min(len(chunk), total_bytes - written)]
                    handle.write(piece)
                    written += len(piece)
                fsync_started = monotonic()
                handle.flush()
                os.fsync(handle.fileno())
                result["fsyncMs"] = round((monotonic() - fsync_started) * 1000, 2)
            result["writeMs"] = round((monotonic() - write_started) * 1000, 2)
            read_started = monotonic()
            read_bytes = 0
            with temp_path.open("rb") as handle:
                for piece in iter(lambda: handle.read(1024 * 1024), b""):
                    read_bytes += len(piece)
            result["readMs"] = round((monotonic() - read_started) * 1000, 2)
            if read_bytes != total_bytes:
                raise OSError(f"Read {read_bytes} bytes after writing {total_bytes}.")
            result["writeMBps"] = round((total_bytes / 1024 / 1024) / max(result["writeMs"] / 1000, 0.001), 2)
            result["readMBps"] = round((total_bytes / 1024 / 1024) / max(result["readMs"] / 1000, 0.001), 2)
            result["ok"] = True
        except OSError as exc:
            result["error"] = str(exc)
        finally:
            try:
                temp_path.unlink()
            except OSError:
                pass

        recommendations: list[str] = []
        volume_kind = str(storage.get("volumeKind", "unknown"))
        if storage.get("networkLikely"):
            recommendations.append("Network drives can stall; keep scans resumable and expect lower throughput.")
        if storage.get("externalLikely"):
            recommendations.append("External/removable drives are supported; keep the drive connected until scan completion.")
        if result["ok"] and (result["writeMBps"] < 20 or result["readMBps"] < 30):
            recommendations.append("This drive is slow for large scans. Use Fast mode and keep the app folder on an internal SSD if possible.")
        if result["ok"] and not recommendations:
            recommendations.append(f"{volume_kind.title()} storage is responsive enough for resumable scan metadata.")
        if not result["ok"] and not recommendations:
            recommendations.append("I/O benchmark failed; choose another app folder or check permissions.")
        result["recommendations"] = recommendations
        return result

    def _resource_status(self, force: bool = False) -> dict[str, Any]:
        now = monotonic()
        if not force and self._last_resource_status and now - self._last_resource_status_at < 1.0:
            return self._last_resource_status
        total = int(getattr(self.platform_report, "memory_total_bytes", 0) or 0)
        available = int(memory_available_bytes() or 0)
        process_bytes = int(process_memory_bytes() or 0)
        available_ratio = available / total if total and available else 0.0
        process_ratio = process_bytes / total if total and process_bytes else 0.0
        pressure = "normal"
        message = "Memory is within the expected range."
        if total and available:
            if available < 512 * 1024 * 1024 or available_ratio < 0.06:
                pressure = "critical"
                message = "Memory is critically low; preview work is reduced until the scan settles."
            elif available < 1024 * 1024 * 1024 or available_ratio < 0.12:
                pressure = "high"
                message = "Memory is tight; preview work is reduced during the scan."
            elif available_ratio < 0.2:
                pressure = "elevated"
                message = "Memory is lower than ideal; the app is monitoring scan workload."
        elif total and process_ratio > 0.7:
            pressure = "high"
            message = "The app is using a large share of system memory; preview work is reduced."
        status = {
            "memoryPressure": pressure,
            "memoryMessage": message,
            "memoryAvailableBytes": available,
            "memoryTotalBytes": total,
            "processMemoryBytes": process_bytes,
        }
        self._last_resource_status_at = now
        self._last_resource_status = status
        return status

    def _with_resource_status(self, payload: dict[str, Any], force: bool = False) -> dict[str, Any]:
        return {**payload, **self._resource_status(force=force)}

    def _benchmark_recommendations(self, state_ms: float, scale: dict[str, Any]) -> list[str]:
        recommendations: list[str] = []
        if state_ms > 500:
            recommendations.append("State serialization is getting heavy; keep candidate windows small and use review filters.")
        if int(scale.get("manifestFiles", 0)) >= 100_000:
            recommendations.append("Large scan manifest active; resumable scans and cached Safe Mode scores are enabled.")
        resource_status = self._resource_status()
        if resource_status.get("memoryPressure") in {"high", "critical"}:
            recommendations.append(str(resource_status.get("memoryMessage") or "Memory pressure is high; keep Fast mode enabled during large scans."))
        if self._effective_performance_mode() == "fast":
            recommendations.append("Fast mode is active; scan detail and preview workload are already reduced for responsiveness.")
        if not recommendations:
            recommendations.append("Local benchmark is within the expected range for this workspace.")
        return recommendations

    def model_distribution_audit(self) -> dict[str, Any]:
        face_model = model_status(self.project.config, self.engine_name)
        safe_model = safety_model_report()
        items: list[dict[str, Any]] = []

        def license_state(text: str) -> str:
            value = text.strip().lower()
            if not value:
                return "missing"
            if "confirm" in value or "suitability" in value or "unknown" in value:
                return "needs-review"
            return "declared"

        for spec in MODEL_PACKAGES.values():
            package = next((item for item in face_model.get("packages", []) if isinstance(item, dict) and item.get("pack") == spec.pack), {})
            items.append(
                {
                    "kind": "face",
                    "id": spec.pack,
                    "name": spec.label,
                    "source": spec.source,
                    "url": spec.url,
                    "filename": spec.filename,
                    "sha256": spec.sha256,
                    "sizeBytes": spec.size_bytes,
                    "license": spec.license,
                    "licenseState": license_state(spec.license),
                    "installed": bool(package.get("available")),
                    "archivePath": str(package.get("archivePath", "")),
                    "installedPath": str(package.get("path", "")),
                    "redistributionReady": license_state(spec.license) == "declared",
                }
            )
        safe_license = str(safe_model.get("license") or "")
        items.append(
            {
                "kind": "safety",
                "id": "safe-mode",
                "name": str(safe_model.get("modelName") or "exposed-skin-heuristic"),
                "source": str(safe_model.get("source") or "local heuristic"),
                "url": str(safe_model.get("source") or ""),
                "filename": Path(str(safe_model.get("path") or "")).name,
                "sha256": "",
                "sizeBytes": 0,
                "license": safe_license or "local heuristic",
                "licenseState": license_state(safe_license) if safe_license else "declared",
                "installed": bool(safe_model.get("available")),
                "archivePath": "",
                "installedPath": str(safe_model.get("path") or ""),
                "redistributionReady": bool(safe_model.get("available")) and (not safe_license or license_state(safe_license) == "declared"),
            }
        )
        blockers = [item for item in items if item["licenseState"] in {"missing", "needs-review"}]
        recommendations = []
        if blockers:
            recommendations.append("Resolve model license/redistribution review before publishing public installers.")
        if not face_model.get("ready"):
            recommendations.append("Install at least one face model or rely on the in-app first-run downloader.")
        if not safe_model.get("available"):
            recommendations.append("Bundle or configure a Safe Mode ONNX model before broad distribution.")
        if not recommendations:
            recommendations.append("Model manifest is complete for the installed local models.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": not blockers and bool(safe_model.get("available")),
            "items": items,
            "blockers": blockers,
            "recommendations": recommendations,
        }

    def release_readiness(self) -> dict[str, Any]:
        face_model = model_status(self.project.config, self.engine_name)
        safe_model = safety_model_report()
        distribution = self.model_distribution_audit()
        db_integrity = self.project.database_integrity()
        update_feed_ready = bool(
            os.environ.get("VINTRACE_UPDATE_URL")
            or os.environ.get("CROSSAGE_UPDATE_URL")
            or os.environ.get("CROSSAGE_RELEASE_FEED_READY") == "1"
            or os.environ.get("GH_TOKEN")
            or os.environ.get("GITHUB_TOKEN")
        )
        checks = [
            {
                "name": "Face model",
                "ok": bool(face_model.get("ready")),
                "detail": "Full face model is installed." if face_model.get("ready") else str(face_model.get("recommendation") or "Download a face model."),
            },
            {
                "name": "Safe Mode model",
                "ok": bool(safe_model.get("available")),
                "detail": str(safe_model.get("modelName") or safe_model.get("reason") or "Safe Mode model unavailable."),
            },
            {
                "name": "Model license manifest",
                "ok": bool(distribution.get("ok")),
                "detail": "Model sources, checksums, and licenses are complete." if distribution.get("ok") else "; ".join(distribution.get("recommendations", [])[:2]),
                "value": distribution,
            },
            {
                "name": "Database integrity",
                "ok": bool(db_integrity.get("ok")),
                "detail": "SQLite workspace index passed integrity checks." if db_integrity.get("ok") else str(db_integrity.get("error") or "SQLite workspace index needs repair."),
                "value": db_integrity,
            },
            {
                "name": "Consent policy",
                "ok": bool(self.project.config.require_consent),
                "detail": "Processing requires permission." if self.project.config.require_consent else "Permission requirement is disabled.",
            },
            {
                "name": "macOS signing",
                "ok": bool(os.environ.get("CSC_LINK") or os.environ.get("APPLE_ID")),
                "detail": "Signing environment detected." if os.environ.get("CSC_LINK") or os.environ.get("APPLE_ID") else "Configure Apple Developer signing and notarization before public DMGs.",
            },
            {
                "name": "Windows signing",
                "ok": bool(os.environ.get("WIN_CSC_LINK") or os.environ.get("CSC_LINK")),
                "detail": "Windows signing environment detected." if os.environ.get("WIN_CSC_LINK") or os.environ.get("CSC_LINK") else "Configure a Windows code-signing certificate to reduce SmartScreen friction.",
            },
            {
                "name": "Auto-update",
                "ok": update_feed_ready,
                "detail": "Update feed credentials/configuration detected." if update_feed_ready else "Configure a signed release feed before sharing production DMGs/EXEs.",
            },
            {
                "name": "Crash reporting",
                "ok": True,
                "detail": "Local consent-first diagnostics export is available; network sending remains opt-in/manual.",
            },
        ]
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": all(check["ok"] for check in checks),
            "checks": checks,
            "recommendations": [check["detail"] for check in checks if not check["ok"]][:5] or ["Release checklist passed."],
        }

    def model_integrity(self) -> dict[str, Any]:
        face_model = model_status(self.project.config, self.engine_name)
        safe_model = safety_model_report()
        image_decoder = image_decoder_report()
        video_decoder = video_decoder_report()
        distribution = self.model_distribution_audit()
        db_integrity = self.project.database_integrity()
        checks: list[dict[str, Any]] = []

        def add(name: str, ok: bool, detail: str, value: Any | None = None) -> None:
            row: dict[str, Any] = {"name": name, "ok": bool(ok), "detail": detail}
            if value is not None:
                row["value"] = value
            checks.append(row)

        model_root = Path(str(face_model.get("modelRoot", ""))).expanduser()
        root_writable = False
        try:
            model_root.mkdir(parents=True, exist_ok=True)
            probe = model_root / ".vintrace-integrity-write"
            probe.write_text("ok", encoding="utf-8")
            root_writable = probe.read_text(encoding="utf-8") == "ok"
            probe.unlink(missing_ok=True)
        except OSError:
            root_writable = False

        add("Face model", bool(face_model.get("ready")), str(face_model.get("recommendation") or face_model.get("engine") or "Face model checked."), face_model)
        add("Model folder writable", root_writable, str(model_root) if root_writable else "Choose a writable model download folder.")
        installed_checks = []
        current_pack = str(face_model.get("currentPack", ""))
        for package in face_model.get("packages", []):
            if not isinstance(package, dict) or str(package.get("pack", "")) != current_pack:
                continue
            pack_dir = Path(str(package.get("path", ""))).expanduser()
            for group in package.get("required_any", []):
                if not isinstance(group, (list, tuple)):
                    continue
                candidates = [pack_dir / str(filename) for filename in group]
                selected = next((candidate for candidate in candidates if candidate.exists()), candidates[0] if candidates else pack_dir)
                installed_checks.append(self._onnx_integrity_check(selected))
        installed_ok = bool(installed_checks) and all(bool(item.get("ok")) for item in installed_checks)
        add(
            "Installed ONNX files",
            installed_ok if face_model.get("ready") else False,
            "Installed face model files passed structural checks." if installed_ok else "Installed face model files are missing, empty, or unreadable.",
            installed_checks,
        )
        archive_checks = []
        for package in face_model.get("packages", []):
            if not isinstance(package, dict):
                continue
            archive_path = Path(str(package.get("archivePath", ""))).expanduser()
            if not archive_path.exists():
                archive_checks.append({"pack": package.get("pack"), "status": "missing", "ok": bool(package.get("available"))})
                continue
            expected = str(package.get("sha256", ""))
            digest = self._sha256_path(archive_path)
            ok = bool(expected and digest == expected)
            archive_checks.append({"pack": package.get("pack"), "status": "verified" if ok else "mismatch", "ok": ok, "sha256": digest})
        archive_ok = all(bool(item.get("ok")) for item in archive_checks if item.get("status") != "missing")
        add("Downloaded archives", archive_ok, "Downloaded model archives pass checksum checks." if archive_ok else "One or more downloaded model archives failed checksum verification.", archive_checks)
        add("Safe Mode model", bool(safe_model.get("available")), str(safe_model.get("modelName") or safe_model.get("reason") or "Safe Mode model checked."), safe_model)
        add("Model license manifest", bool(distribution.get("ok")), "Model manifest is ready for redistribution review." if distribution.get("ok") else "; ".join(distribution.get("recommendations", [])[:2]), distribution)
        add("Workspace database", bool(db_integrity.get("ok")), "SQLite workspace index passed integrity checks." if db_integrity.get("ok") else str(db_integrity.get("error") or "SQLite workspace index needs repair."), db_integrity)
        add("Image decoder", bool(image_decoder.get("extensions")), f"{len(image_decoder.get('extensions', []))} image extension(s) supported.", image_decoder)
        add("Video decoder", bool(video_decoder.get("opencvAvailable")), str(video_decoder.get("backend") or "Video decoder unavailable."), video_decoder)
        recommendations = [check["detail"] for check in checks if not check["ok"]]
        if not recommendations:
            recommendations.append("Model and runtime integrity checks passed.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": all(check["ok"] for check in checks),
            "checks": checks,
            "recommendations": recommendations,
        }

    def _sha256_path(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _onnx_integrity_check(self, path: Path) -> dict[str, Any]:
        result: dict[str, Any] = {"path": str(path), "ok": False, "bytes": 0, "checkedWith": "filesystem", "error": ""}
        try:
            stat = path.stat()
            result["bytes"] = int(stat.st_size)
            if not path.is_file() or stat.st_size <= 0:
                result["error"] = "Model file is missing or empty."
                return result
        except OSError as exc:
            result["error"] = str(exc)
            return result
        try:
            import onnxruntime as ort  # type: ignore

            session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            result["checkedWith"] = "onnxruntime"
            result["inputs"] = len(session.get_inputs())
            result["outputs"] = len(session.get_outputs())
        except ImportError:
            result["checkedWith"] = "filesystem"
        except Exception as exc:
            result["checkedWith"] = "onnxruntime"
            result["error"] = str(exc)
            return result
        result["ok"] = True
        return result

    def export_support_bundle(self, include_paths: bool = False) -> dict[str, Any]:
        export_root = self.project.root / "exports"
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        bundle_path = export_root / f"vintrace-support-bundle-{stamp}.zip"
        counter = 2
        while bundle_path.exists():
            bundle_path = export_root / f"vintrace-support-bundle-{stamp}-{counter}.zip"
            counter += 1
        payloads = {
            "manifest.json": {
                "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "appVersion": __version__,
                "workspaceId": self.project.workspace_metadata.get("workspaceId"),
                "includePaths": bool(include_paths),
                "note": "Diagnostics only. This ZIP does not include original photos, videos, thumbnails, face vectors, or model files.",
            },
            "workspace-health.json": self.project.workspace_health(),
            "privacy-report.json": self.project.privacy_report(),
            "retention-policy-report.json": self.project.retention_policy_report(),
            "model-drift-report.json": self.project.model_drift_report(self.engine_name),
            "runtime-self-test.json": self.runtime_self_test(),
            "model-integrity.json": self.model_integrity(),
            "release-readiness.json": self.release_readiness(),
            "model-status.json": model_status(self.project.config, self.engine_name),
            "safe-mode-model.json": safety_model_report(),
            "image-decoder.json": image_decoder_report(),
            "video-decoder.json": video_decoder_report(),
            "scale-summary.json": self.project.scale_summary(),
            "audit-events.json": self.project.audit_events(limit=80, offset=0),
        }
        serializable = self._redact_paths(payloads, include_paths=include_paths)
        with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in serializable.items():
                archive.writestr(name, json.dumps(payload, indent=2))
        size = bundle_path.stat().st_size
        self.project._append_audit(
            {
                "action": "export_support_bundle",
                "zip_path": str(bundle_path),
                "include_paths": bool(include_paths),
                "bytes": size,
            }
        )
        return {
            "zipPath": str(bundle_path),
            "bytes": size,
            "fileCount": len(serializable),
            "includePaths": bool(include_paths),
        }

    def _redact_paths(self, value: Any, include_paths: bool = False) -> Any:
        if include_paths:
            return value
        path_keys = {
            "path",
            "workspace",
            "workspacePath",
            "dbPath",
            "sourcePath",
            "source_path",
            "folder",
            "mediaSourcePath",
            "media_source_path",
            "bestRefPath",
            "modelRoot",
            "defaultRoot",
            "root",
            "zipPath",
            "jsonPath",
            "csvPath",
            "bundlePath",
            "manifestPath",
            "archivePath",
            "removedPaths",
            "scope",
            "oldRoot",
            "newRoot",
            "old_root",
            "new_root",
            "directory",
            "folder",
            "from",
            "to",
        }
        path_key_suffixes = ("path", "paths", "root", "roots", "directory", "directories", "folder", "folders")
        if isinstance(value, dict):
            redacted: dict[str, Any] = {}
            for key, item in value.items():
                key_text = str(key)
                key_lower = key_text.lower()
                if key_text in path_keys or key_lower.endswith(path_key_suffixes):
                    if isinstance(item, list):
                        redacted[key_text] = [self._redacted_path(str(path)) for path in item[:20]]
                    elif item is None:
                        redacted[key_text] = None
                    else:
                        redacted[key_text] = self._redacted_path(str(item))
                else:
                    redacted[key_text] = self._redact_paths(item, include_paths=False)
            return redacted
        if isinstance(value, (list, tuple)):
            return [self._redact_paths(item, include_paths=False) for item in value]
        if isinstance(value, str):
            return self._redact_string(value)
        return value

    def _redact_string(self, value: str) -> str:
        if not value:
            return value
        text = value
        prefixes = {
            str(self.project.root),
            os.path.realpath(str(self.project.root)),
            str(self.project.root.parent),
            os.path.realpath(str(self.project.root.parent)),
            str(Path.home()),
            os.path.realpath(str(Path.home())),
        }
        for prefix in sorted((item for item in prefixes if item), key=len, reverse=True):
            if text == prefix or text.startswith(f"{prefix}/") or text.startswith(f"{prefix}\\"):
                return self._redacted_path(text)
            text = text.replace(prefix, "[hidden]")
        if text.startswith(("/", "~")) or re.match(r"^[A-Za-z]:[\\/]", text) or text.startswith("\\\\"):
            return self._redacted_path(text)
        return text

    def _redacted_path(self, value: str) -> str:
        if not value:
            return ""
        try:
            name = Path(value).name or value
        except (OSError, ValueError):
            name = ""
        return f"[hidden]/{name}" if name else "[hidden]"

    def installer_self_diagnostics(self) -> dict[str, Any]:
        runtime = self.runtime_self_test()
        face_model = model_status(self.project.config, self.engine_name)
        safe_model = safety_model_report()
        image_decoder = image_decoder_report()
        video_decoder = video_decoder_report()
        workspace_health = self.project.workspace_health()
        distribution = self.model_distribution_audit()
        db_integrity = self.project.database_integrity()
        storage = inspect_storage_path(self.project.root, self.project.root)
        packaged = bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")
        model_packages = face_model.get("packages", []) if isinstance(face_model.get("packages"), list) else []
        downloadable = any(str(package.get("url", "")).startswith(("http://", "https://")) and str(package.get("sha256", "")) for package in model_packages if isinstance(package, dict))
        checks = [
            {
                "name": "App folder write",
                "ok": any(check.get("name") == "Workspace write" and check.get("ok") for check in runtime.get("checks", [])),
                "detail": "The app can save settings, results, and generated previews.",
            },
            {
                "name": "Face model",
                "ok": bool(face_model.get("ready")),
                "detail": str(face_model.get("recommendation") or face_model.get("engine") or "Face model status checked."),
            },
            {
                "name": "Model downloader",
                "ok": downloadable or bool(face_model.get("ready")),
                "detail": "Download URL and checksum are configured." if downloadable else "Face model is already ready or no downloadable pack is configured.",
            },
            {
                "name": "Model manifest",
                "ok": bool(distribution.get("items")),
                "detail": "Model package URLs, checksums, and license fields are visible for review.",
            },
            {
                "name": "Safe Mode",
                "ok": bool(self.project.config.safe_mode and safe_model.get("available")),
                "detail": str(safe_model.get("modelName") or safe_model.get("reason") or "Safe Mode model checked."),
            },
            {
                "name": "Photo formats",
                "ok": bool(image_decoder.get("extensions")),
                "detail": f"{len(image_decoder.get('extensions', []))} image extension(s) available.",
            },
            {
                "name": "Video support",
                "ok": bool(video_decoder.get("opencvAvailable")),
                "detail": str(video_decoder.get("backend") or "Video decoder unavailable."),
            },
            {
                "name": "Packaged backend",
                "ok": packaged,
                "detail": "Packaged backend detected." if packaged else "Running from source; installer builds should include the frozen backend.",
            },
            {
                "name": "Database integrity",
                "ok": bool(db_integrity.get("ok")),
                "detail": "SQLite workspace index passed integrity checks." if db_integrity.get("ok") else str(db_integrity.get("error") or "SQLite workspace index needs repair."),
            },
            {
                "name": "Storage location",
                "ok": bool(storage.get("readable") and storage.get("traversable") and not storage.get("networkLikely")),
                "detail": "App folder is on readable local storage." if not storage.get("warnings") else str(storage.get("warnings", ["Storage checked."])[0]),
            },
            {
                "name": "Workspace health",
                "ok": not any(workspace_health.get(key, 0) for key in ("missingReferences", "missingCandidates", "missingMediaSources")),
                "detail": "No missing workspace files found." if not any(workspace_health.get(key, 0) for key in ("missingReferences", "missingCandidates", "missingMediaSources")) else "Some saved files or media links are missing.",
            },
        ]
        recommendations = [check["detail"] for check in checks if not check["ok"]]
        recommendations.extend(str(item) for item in runtime.get("recommendations", []) if str(item) not in recommendations)
        if not recommendations:
            recommendations.append("Installer diagnostics passed for this machine.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ok": all(check["ok"] for check in checks),
            "packagedBackend": packaged,
            "checks": checks,
            "recommendations": recommendations[:8],
        }

    def query_candidates(self, params: dict[str, Any]) -> dict[str, Any]:
        status = str(params.get("status", "all")).strip().lower()
        if status not in {"all", "pending", "accepted", "rejected", "uncertain"}:
            raise ValueError("Candidate status filter must be all, pending, accepted, rejected, or uncertain.")
        lane = str(params.get("lane", "all")).strip()
        if lane not in {"all", "high", "lowQuality", "groups", "video", "notes"}:
            raise ValueError("Candidate lane must be all, high, lowQuality, groups, video, or notes.")
        query = str(params.get("query", "")).strip().lower()
        sort = str(params.get("sort", "score")).strip()
        offset = max(0, int(params.get("offset", 0) or 0))
        limit = max(1, min(1000, int(params.get("limit", 100) or 100)))
        preview_budget = max(0, min(64, int(params.get("previewBudget", 0) or 0)))
        low_quality_threshold = max(0.2, float(self.project.config.thresholds.quality_min))
        try:
            db_candidate_count = self.project.db.candidate_count()
            if db_candidate_count >= len(self.project.candidates):
                db_page = self.project.db.query_candidates(
                    status=status,
                    lane=lane,
                    query=query,
                    sort=sort,
                    offset=offset,
                    limit=limit,
                    confident_threshold=self.project.config.thresholds.confident,
                    low_quality_threshold=low_quality_threshold,
                )
                page = []
                for payload in db_page.get("items", []):
                    if not isinstance(payload, dict):
                        continue
                    try:
                        candidate = ReviewCandidate(**payload)
                    except (TypeError, ValueError):
                        continue
                    page.append(candidate)
                items = []
                remaining_preview_budget = preview_budget
                for candidate in page:
                    before_preview = self.project.preview_path_for(candidate.source_path, create=False)
                    row = self._candidate_state_row(candidate, remaining_preview_budget)
                    if remaining_preview_budget > 0 and not before_preview and row.get("previewPath"):
                        remaining_preview_budget -= 1
                    items.append(row)
                return {
                    "total": int(db_page.get("total", 0) or 0),
                    "offset": offset,
                    "limit": limit,
                    "returned": len(items),
                    "items": items,
                    "index": "sqlite",
                }
        except Exception:
            pass
        grouped_candidate_ids: set[str] = set()
        if lane == "groups":
            by_media_path: dict[str, dict[str, Any]] = {}
            for candidate in self.project.candidates.values():
                media_path = candidate.media_source_path or candidate.source_path
                row = by_media_path.setdefault(media_path, {"ids": [], "people": set()})
                row["ids"].append(candidate.candidate_id)
                if candidate.person_name.strip() and not candidate.person_name.startswith("Unmatched cluster"):
                    row["people"].add(candidate.person_name)
            for row in by_media_path.values():
                if len(row["people"]) >= 2:
                    grouped_candidate_ids.update(row["ids"])

        def matches(candidate: Any) -> bool:
            if status != "all" and candidate.status != status:
                return False
            if lane == "high" and candidate.score < self.project.config.thresholds.confident:
                return False
            if lane == "lowQuality" and candidate.quality >= low_quality_threshold:
                return False
            if lane == "groups" and candidate.candidate_id not in grouped_candidate_ids:
                return False
            if lane == "video" and candidate.media_kind != "video":
                return False
            if lane == "notes" and not candidate.note.strip():
                return False
            if query:
                haystack = "\n".join(
                    [
                        candidate.person_name,
                        candidate.band,
                        candidate.source_path,
                        candidate.media_source_path,
                        candidate.note,
                        candidate.source_hash,
                    ]
                ).lower()
                if query not in haystack:
                    return False
            return True

        total = 0

        def iter_matches() -> Any:
            nonlocal total
            for candidate in self.project.candidates.values():
                if matches(candidate):
                    total += 1
                    yield candidate

        bound = offset + limit
        heap_bound_limit = 20_000
        if bound <= heap_bound_limit:
            if sort == "newest":
                ranked = heapq.nlargest(bound, iter_matches(), key=lambda item: (item.created_at, item.candidate_id))
            elif sort == "quality":
                ranked = heapq.nlargest(bound, iter_matches(), key=lambda item: (float(item.quality), item.created_at, item.candidate_id))
            elif sort == "status":
                ranked = heapq.nsmallest(bound, iter_matches(), key=lambda item: (item.status, item.person_name.lower(), -float(item.score), item.candidate_id))
            else:
                ranked = heapq.nlargest(bound, iter_matches(), key=lambda item: (float(item.score), item.quality, item.created_at, item.candidate_id))
        else:
            matched = list(iter_matches())
            if sort == "newest":
                ranked = sorted(matched, key=lambda item: (item.created_at, item.candidate_id), reverse=True)
            elif sort == "quality":
                ranked = sorted(matched, key=lambda item: (float(item.quality), item.created_at, item.candidate_id), reverse=True)
            elif sort == "status":
                ranked = sorted(matched, key=lambda item: (item.status, item.person_name.lower(), -float(item.score), item.candidate_id))
            else:
                ranked = sorted(matched, key=lambda item: (float(item.score), item.quality, item.created_at, item.candidate_id), reverse=True)
        page = ranked[offset:offset + limit]
        items = []
        remaining_preview_budget = preview_budget
        for candidate in page:
            before_preview = self.project.preview_path_for(candidate.source_path, create=False)
            row = self._candidate_state_row(candidate, remaining_preview_budget)
            if remaining_preview_budget > 0 and not before_preview and row.get("previewPath"):
                remaining_preview_budget -= 1
            items.append(row)
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "returned": len(page),
            "items": items,
            "index": "memory",
        }

    def _candidate_state_row(self, candidate: Any, preview_budget: int = 0) -> dict[str, Any]:
        preview_path = self.project.preview_path_for(candidate.source_path, create=False)
        if not preview_path and preview_budget > 0:
            preview_path = self.project.preview_path_for(candidate.source_path, create=True)
        best_preview_path = self.project.preview_path_for(candidate.best_ref_path, create=False)
        return {
            "candidateId": candidate.candidate_id,
            "sourcePath": candidate.source_path,
            "personName": candidate.person_name,
            "bestRefId": candidate.best_ref_id,
            "bestRefPath": candidate.best_ref_path,
            "previewPath": preview_path,
            "bestRefPreviewPath": best_preview_path,
            "score": candidate.score,
            "band": candidate.band,
            "quality": candidate.quality,
            "modelName": candidate.model_name,
            "status": candidate.status,
            "note": candidate.note,
            "mediaKind": candidate.media_kind,
            "mediaSourcePath": candidate.media_source_path,
            "videoTimestampMs": candidate.video_timestamp_ms,
            "videoFrameIndex": candidate.video_frame_index,
            "videoDurationMs": candidate.video_duration_ms,
            "sourceHash": candidate.source_hash,
            "createdAt": candidate.created_at,
        }

    def state(self, preview_create_budget: int = 8, candidate_limit: int = 500) -> dict[str, Any]:
        candidate_limit = max(250, min(10_000, int(candidate_limit)))
        scale = self.project.scale_summary()
        try:
            indexed_candidates = int(scale.get("reviewCandidateRows", -1)) if isinstance(scale, dict) else self.project.db.candidate_count()
        except (TypeError, ValueError, sqlite3.Error):
            indexed_candidates = -1
        index_ready = indexed_candidates >= len(self.project.candidates) and indexed_candidates >= 0
        candidate_total = indexed_candidates if index_ready else len(self.project.candidates)
        if index_ready:
            try:
                status_counts = self.project.db.candidate_status_counts()
                pending = int(status_counts.get("pending", 0) or 0)
                reviewed = int(status_counts.get("reviewed", 0) or 0)
            except Exception:
                pending = sum(1 for candidate in self.project.candidates.values() if candidate.status == "pending")
                reviewed = len(self.project.candidates) - pending
                index_ready = False
        else:
            pending = sum(1 for candidate in self.project.candidates.values() if candidate.status == "pending")
            reviewed = len(self.project.candidates) - pending
        preview_cache: dict[str, str | None] = {}
        remaining_preview_creates = max(0, int(preview_create_budget))

        def preview_for(source_path: str | None) -> str | None:
            nonlocal remaining_preview_creates
            if not source_path:
                return None
            try:
                cache_key = str(Path(source_path).expanduser().resolve())
            except OSError:
                cache_key = source_path
            if cache_key not in preview_cache:
                cached_preview = self.project.preview_path_for(source_path, create=False)
                if cached_preview:
                    preview_cache[cache_key] = cached_preview
                elif remaining_preview_creates > 0:
                    remaining_preview_creates -= 1
                    preview_cache[cache_key] = self.project.preview_path_for(source_path, create=True)
                else:
                    preview_cache[cache_key] = None
            return preview_cache[cache_key]

        def candidate_sort_key(item: Any) -> tuple[bool, float, str]:
            return (item.status != "pending", -float(item.score), item.person_name.lower())

        if index_ready:
            try:
                db_page = self.project.db.query_candidates(
                    sort="state",
                    offset=0,
                    limit=candidate_limit,
                    confident_threshold=self.project.config.thresholds.confident,
                    low_quality_threshold=max(0.2, float(self.project.config.thresholds.quality_min)),
                )
                top_candidates = [
                    ReviewCandidate(**payload)
                    for payload in db_page.get("items", [])
                    if isinstance(payload, dict)
                ]
            except Exception:
                top_candidates = heapq.nsmallest(candidate_limit, self.project.candidates.values(), key=candidate_sort_key)
                index_ready = False
        else:
            top_candidates = heapq.nsmallest(candidate_limit, self.project.candidates.values(), key=candidate_sort_key)
        if index_ready:
            try:
                video_moments = self.project.db.video_moments(limit=80)
                review_insights = self.project.db.review_insights(self.project.config.thresholds.confident)
            except Exception:
                video_moments = self.project.video_moments(limit=80)
                review_insights = self.project.review_insights()
        else:
            video_moments = self.project.video_moments(limit=80)
            review_insights = self.project.review_insights()
        effective_config = self._effective_engine_config()
        effective_performance_mode = self._effective_performance_mode()

        return {
            "version": __version__,
            "buildInfo": self._build_info(),
            "workspace": str(self.project.root),
            "consentOnFile": self.consent_on_file,
            "consent": self.project.consent_summary(),
            "workspaceMetadata": self.project.workspace_metadata,
            "engine": self.engine_name,
            "vectorStore": self.project.vector_store.backend_name,
            "platform": asdict(self.platform_report),
            "counts": {
                "references": len(self.project.references),
                "pending": pending,
                "reviewed": reviewed,
                "candidates": candidate_total,
            },
            "scanHistory": self.project.scan_history[:20],
            "scanTotals": self._scan_totals(),
            "benchmarkHistory": self.project.benchmark_history(limit=8),
            "scale": scale,
            "calibration": self.project.calibration_summary(),
            "scanJob": self.project.scan_job_status(scale.get("latestScan") if isinstance(scale, dict) else None),
            "videoMoments": video_moments,
            "reviewInsights": review_insights,
            "config": {
                "modelPack": self.project.config.model_pack,
                "modelRoot": self.project.config.model_root,
                "thresholds": {
                    "confident": self.project.config.thresholds.confident,
                    "likely": self.project.config.thresholds.likely,
                    "relaxedChild": self.project.config.thresholds.relaxed_child,
                    "qualityMin": self.project.config.thresholds.quality_min,
                },
                "clusterMinSize": self.project.config.cluster_min_size,
                "faceDetectorSize": self.project.config.face_detector_size,
                "twoPassScan": self.project.config.two_pass_scan,
                "verificationDetectorSize": self.project.config.verification_detector_size,
                "performanceMode": self.project.config.performance_mode,
                "effectivePerformanceMode": effective_performance_mode,
                "effectiveFaceDetectorSize": effective_config.face_detector_size,
                "effectiveTwoPassScan": effective_config.two_pass_scan,
                "effectiveVerificationDetectorSize": effective_config.verification_detector_size,
                "safeMode": self.project.config.safe_mode,
                "safeModeThreshold": self.project.config.safe_mode_threshold,
                "storageBudgetBytes": self.project.config.storage_budget_bytes,
                "maxMediaFileBytes": self.project.config.max_media_file_bytes,
                "reviewRules": {
                    "autoRejectBelow": self.project.config.auto_reject_below,
                    "autoUncertainLowQuality": self.project.config.auto_uncertain_low_quality,
                    "autoRejectLowQualityVideo": self.project.config.auto_reject_low_quality_video,
                },
                "scanExclusions": {
                    "dirNames": self.project.config.excluded_dir_names,
                    "pathKeywords": self.project.config.excluded_path_keywords,
                    "extensions": self.project.config.excluded_extensions,
                    "filePaths": self.project.config.excluded_file_paths,
                },
                "reviewOnly": self.project.config.review_only,
                "requireConsent": self.project.config.require_consent,
            },
            "safeModeModel": safety_model_report(),
            "modelSetup": model_status(self.project.config, self.engine_name),
            "references": [
                {
                    "refId": ref.ref_id,
                    "personName": ref.person_name,
                    "ageBucket": ref.age_bucket,
                    "sourcePath": ref.source_path,
                    "previewPath": preview_for(ref.source_path),
                    "captureDate": ref.capture_date,
                    "quality": ref.quality,
                    "modelName": ref.model_name,
                    "createdAt": ref.created_at,
                }
                for ref in sorted(self.project.references.values(), key=lambda item: (item.person_name.lower(), item.source_path))
            ],
            "candidates": [
                {
                    "candidateId": candidate.candidate_id,
                    "sourcePath": candidate.source_path,
                    "personName": candidate.person_name,
                    "bestRefId": candidate.best_ref_id,
                    "bestRefPath": candidate.best_ref_path,
                    "previewPath": preview_for(candidate.source_path),
                    "bestRefPreviewPath": preview_for(candidate.best_ref_path),
                    "score": candidate.score,
                    "band": candidate.band,
                    "quality": candidate.quality,
                    "modelName": candidate.model_name,
                    "status": candidate.status,
                    "note": candidate.note,
                    "mediaKind": candidate.media_kind,
                    "mediaSourcePath": candidate.media_source_path,
                    "videoTimestampMs": candidate.video_timestamp_ms,
                    "videoFrameIndex": candidate.video_frame_index,
                    "videoDurationMs": candidate.video_duration_ms,
                    "sourceHash": candidate.source_hash,
                    "createdAt": candidate.created_at,
                }
                for candidate in top_candidates
            ],
            "candidateWindow": {
                "limit": candidate_limit,
                "returned": len(top_candidates),
                "total": candidate_total,
                "truncated": candidate_total > candidate_limit,
                "index": "sqlite" if index_ready else "memory",
            },
        }

    def _scan_totals(self) -> dict[str, Any]:
        totals = {
            "runs": len(self.project.scan_history),
            "total": 0,
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
            "excluded": 0,
            "durationMs": 0,
        }
        for run in self.project.scan_history:
            metrics = run.get("metrics", {}) if isinstance(run, dict) else {}
            for key in (
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
            ):
                totals[key] += int(metrics.get(key, 0)) if isinstance(metrics, dict) else 0
            totals["durationMs"] += int(run.get("durationMs", 0)) if isinstance(run, dict) else 0
        totals["lastCompletedAt"] = self.project.scan_history[0].get("completedAt") if self.project.scan_history else None
        return totals

    def _require_consent(self) -> None:
        if self.project.config.require_consent and not self.consent_on_file:
            raise PermissionError("Consent must be marked before processing images and videos.")

    def _progress(self, progress: Any | None, payload: dict[str, Any]) -> None:
        if progress is None:
            return
        phase = str(payload.get("phase", ""))
        payload = self._with_resource_status(payload, force=phase in {"started", "complete", "cancelled", "error"})
        if phase in {"complete", "cancelled"}:
            self._last_progress_state_at = 0.0
            self._last_progress_state_added = 0
            progress({**payload, "state": self.state(preview_create_budget=0)})
            return
        if phase == "candidate":
            added = int(payload.get("added", 0) or 0)
            total = int(payload.get("total", 0) or 0)
            now = monotonic()
            should_send_state = (
                added <= 3
                or total <= 25
                or added - self._last_progress_state_added >= 5
                or now - self._last_progress_state_at >= 0.75
            )
            if should_send_state:
                self._last_progress_state_at = now
                self._last_progress_state_added = added
                progress({**payload, "state": self.state(preview_create_budget=0)})
                return
            progress(payload)
            return
        progress(payload)


def emit(message: dict[str, Any], stream: Any | None = None) -> None:
    target = stream or sys.stdout
    target.write(json.dumps(message, separators=(",", ":")) + "\n")
    target.flush()


ERROR_CODE_BY_EXCEPTION = {
    "PermissionError": ("E-BACKEND-PERMISSION", "privacy", "warn", True),
    "ValueError": ("E-BACKEND-VALIDATION", "input", "warn", True),
    "KeyError": ("E-BACKEND-NOT-FOUND", "data", "warn", True),
    "FileNotFoundError": ("E-FS-NOT-FOUND", "filesystem", "warn", True),
    "IsADirectoryError": ("E-FS-DIRECTORY", "filesystem", "warn", True),
    "NotADirectoryError": ("E-FS-NOT-DIRECTORY", "filesystem", "warn", True),
    "TimeoutError": ("E-BACKEND-TIMEOUT", "backend", "error", True),
    "ImageLoadError": ("E-MEDIA-IMAGE-DECODE", "media", "warn", True),
    "VideoLoadError": ("E-MEDIA-VIDEO-DECODE", "media", "warn", True),
    "FileChangedDuringScanError": ("E-SCAN-FILE-CHANGED", "scan", "warn", True),
    "InterruptedError": ("E-SCAN-CANCELLED", "scan", "info", True),
    "OperationalError": ("E-DB-SQLITE", "database", "error", False),
    "DatabaseError": ("E-DB-SQLITE", "database", "error", False),
}


def structured_error(exc: Exception, command: str = "") -> dict[str, Any]:
    exc_type = exc.__class__.__name__
    code, category, severity, recoverable = ERROR_CODE_BY_EXCEPTION.get(
        exc_type,
        ("E-BACKEND-UNKNOWN", "backend", "error", False),
    )
    if isinstance(exc, OSError) and code == "E-BACKEND-UNKNOWN":
        code, category, severity, recoverable = ("E-FS-IO", "filesystem", "error", True)
    return {
        "type": exc_type,
        "code": code,
        "category": category,
        "severity": severity,
        "recoverable": recoverable,
        "command": command,
        "message": str(exc),
        "traceback": traceback.format_exc(limit=8) if os.environ.get("CROSSAGE_DEBUG") else "",
    }


def serve(workspace: Path | None = None) -> None:
    root = resolve_workspace(workspace or os.environ.get("VINTRACE_WORKSPACE") or os.environ.get("CROSSAGE_WORKSPACE"))
    json_stream = sys.stdout
    def startup(payload: dict[str, Any]) -> None:
        emit({"event": "startup", "payload": payload}, stream=json_stream)

    api = DesktopApi(root, actor="desktop", startup=startup)
    emit({"ready": True, "state": api.state(preview_create_budget=2, candidate_limit=250)}, stream=json_stream)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request: dict[str, Any] | None = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("JSON-RPC request must be an object.")
            with redirect_stdout(sys.stderr):
                request_id = request.get("id")

                def progress(payload: dict[str, Any], name: str = "scan") -> None:
                    emit({"id": request_id, "event": "progress", "name": name, "payload": payload}, stream=json_stream)

                params = request.get("params", {})
                if params is None:
                    params = {}
                if not isinstance(params, dict):
                    raise ValueError("Command parameters must be an object.")
                command = str(request.get("command"))
                result = api.handle(command, params, progress=progress)
            emit({"id": request.get("id"), "ok": True, "result": result}, stream=json_stream)
        except Exception as exc:
            request_id = request.get("id") if isinstance(request, dict) else None
            command = str(request.get("command", "")) if isinstance(request, dict) else ""
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": structured_error(exc, command),
                },
                stream=json_stream,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Cross-age FR desktop backend")
    parser.add_argument("--workspace", default=None)
    parser.add_argument("--mcp", action="store_true", help="Run the MCP server instead of the Electron JSON-RPC backend")
    parser.add_argument("--mcp-transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--mcp-host", default="127.0.0.1")
    parser.add_argument("--mcp-port", type=int, default=8765)
    parser.add_argument("--allow-remote-mcp-http", action="store_true")
    args = parser.parse_args()
    workspace = Path(args.workspace).expanduser().resolve() if args.workspace else None
    if args.mcp:
        from crossage_fr.mcp_server import run_mcp_server

        run_mcp_server(
            workspace=workspace,
            transport=args.mcp_transport,
            host=args.mcp_host,
            port=args.mcp_port,
            allow_remote_http=args.allow_remote_mcp_http,
        )
        return
    serve(workspace)


if __name__ == "__main__":
    main()
