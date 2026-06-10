from __future__ import annotations

from contextlib import redirect_stdout
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
import argparse
import json
import os
import sys
import traceback
from time import monotonic
from typing import Any

from crossage_fr import __version__
from crossage_fr.embed import create_embedding_engine
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, image_decoder_report, load_image
from crossage_fr.ingest.safety import safety_model_report
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, iter_video_paths, probe_video, video_decoder_report
from crossage_fr.model_manager import download_model_pack, model_root_for_config, model_status, set_model_root
from crossage_fr.platform_detect import build_platform_report
from crossage_fr.workspace_registry import resolve_workspace


class DesktopApi:
    def __init__(self, workspace: Path, actor: str = "desktop", startup: Any | None = None) -> None:
        self.actor = actor
        self.startup = startup
        self.project = ProjectState(workspace, actor=actor)
        self.consent_on_file = self.project.consent_on_file()
        self._startup("workspace", f"Workspace ready: {self.project.root}")
        self._startup("engine", "Loading recognition engine")
        with redirect_stdout(sys.stderr):
            self.engine = create_embedding_engine(self.project.config)
        self._startup("platform", "Detecting platform acceleration")
        self.platform_report = build_platform_report()
        self._last_progress_state_at = 0.0
        self._last_progress_state_added = 0
        self._startup("ready", "Backend ready")

    def _startup(self, phase: str, message: str) -> None:
        if self.startup:
            self.startup({"phase": phase, "message": message})

    def handle(self, command: str, params: dict[str, Any], progress: Any | None = None) -> Any:
        if not isinstance(params, dict):
            raise ValueError("Command parameters must be an object.")
        if command == "ping":
            return {"pong": True, "version": __version__}
        if command == "get_state":
            return self.state()
        if command == "model_status":
            return model_status(self.project.config, self.engine.model_name)
        if command == "set_model_root":
            root_value = str(params.get("root", "")).strip()
            if not root_value:
                raise ValueError("Choose a model download folder first.")
            root = set_model_root(self.project.config, Path(root_value))
            self.project._append_audit({"action": "set_model_root", "root": str(root), "source": str(params.get("source", "desktop"))})
            self.project.save()
            with redirect_stdout(sys.stderr):
                self.engine = create_embedding_engine(self.project.config)
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
            with redirect_stdout(sys.stderr):
                self.engine = create_embedding_engine(self.project.config)
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
            added, errors = self.project.enroll_folder(
                str(params.get("personName", "")),
                str(params.get("ageBucket", "unknown")),
                Path(str(params.get("folder", ""))).expanduser(),
                self.engine,
            )
            return {"added": added, "errors": errors, "state": self.state()}
        if command == "enroll_age_groups":
            self._require_consent()
            groups_param = params.get("groups", [])
            if not isinstance(groups_param, list):
                raise ValueError("Age-group enrollment expects a list of folders.")
            added, errors, groups = self.project.enroll_age_groups(
                str(params.get("personName", "")),
                groups_param,
                self.engine,
            )
            return {"added": added, "errors": errors, "value": {"groups": groups}, "state": self.state()}
        if command == "scan":
            self._require_consent()
            if not self.project.references:
                raise ValueError("Enroll at least one reference before scanning.")
            source = str(params.get("source", "manual"))
            added, errors, metrics = self.project.scan_folder(
                Path(str(params.get("folder", ""))).expanduser(),
                self.engine,
                on_progress=lambda payload: self._progress(progress, {**payload, "source": source}),
                source=source,
            )
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
            added, errors, metrics = self.project.scan_paths(
                paths,
                self.engine,
                on_progress=lambda payload: self._progress(progress, {**payload, "source": source}),
                source=source,
                label=f"{len(paths)} selected file(s)",
            )
            return {"added": added, "errors": errors, "metrics": metrics, "state": self.state()}
        if command == "analyze_folder":
            return self.analyze_folder(Path(str(params.get("folder", ""))).expanduser())
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
        if command == "export_report":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_report(Path(folder_param).expanduser() if folder_param else None)
            return {"value": result, "state": self.state()}
        if command == "export_workspace_backup":
            folder_param = str(params.get("folder", "")).strip()
            result = self.project.export_workspace_backup(
                Path(folder_param).expanduser() if folder_param else None,
                include_generated=bool(params.get("includeGenerated", True)),
            )
            return {"value": result, "state": self.state()}
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
        if command == "workspace_health":
            return self.project.workspace_health()
        if command == "runtime_self_test":
            return self.runtime_self_test()
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
            if any(value < 0.0 or value > 1.0 for value in values):
                raise ValueError("Thresholds and quality minimum must be between 0 and 1.")
            if not confident >= likely >= relaxed_child:
                raise ValueError("Thresholds must be descending: confident >= likely >= relaxed child.")
            cluster_min_size = int(params.get("clusterMinSize", self.project.config.cluster_min_size))
            if cluster_min_size < 2:
                raise ValueError("Cluster minimum size must be at least 2.")
            safe_mode_threshold = float(params.get("safeModeThreshold", self.project.config.safe_mode_threshold))
            if safe_mode_threshold < 0.0 or safe_mode_threshold > 1.0:
                raise ValueError("Safe Mode threshold must be between 0 and 1.")
            thresholds.confident = confident
            thresholds.likely = likely
            thresholds.relaxed_child = relaxed_child
            thresholds.quality_min = quality_min
            self.project.config.cluster_min_size = cluster_min_size
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
                    "safe_mode": self.project.config.safe_mode,
                    "safe_mode_threshold": safe_mode_threshold,
                    "source": str(params.get("source", "desktop")),
                    "reason": str(params.get("reason", ""))[:800],
                }
            )
            self.project.save()
            return self.state()
        raise ValueError(f"Unknown command: {command}")

    def set_workspace(self, path: Path) -> dict[str, Any]:
        self.project = ProjectState(path.expanduser().resolve(), actor=self.actor)
        self.consent_on_file = self.project.consent_on_file()
        with redirect_stdout(sys.stderr):
            self.engine = create_embedding_engine(self.project.config)
        return self.state()

    def analyze_folder(self, folder: Path) -> dict[str, Any]:
        resolved = folder.expanduser().resolve()
        result: dict[str, Any] = {
            "folder": str(resolved),
            "exists": resolved.exists(),
            "isDirectory": resolved.is_dir(),
            "imageCount": 0,
            "videoCount": 0,
            "nonImageCount": 0,
            "totalBytes": 0,
            "checkedImages": 0,
            "checkedVideos": 0,
            "unreadableSamples": [],
            "unreadableVideoSamples": [],
            "imageSamples": [],
            "videoSamples": [],
            "extensionCounts": {},
            "recommendations": [],
            "decoder": image_decoder_report(),
            "videoDecoder": video_decoder_report(),
        }
        if not result["exists"]:
            result["recommendations"].append("Choose an existing folder before scanning.")
            return result
        if not result["isDirectory"]:
            result["recommendations"].append("Choose a folder rather than a single file.")
            return result
        image_paths: list[Path] = []
        for current, dirnames, filenames in os.walk(resolved):
            dirnames.sort()
            for filename in sorted(filenames):
                path = Path(current) / filename
                if path.suffix.lower() in IMAGE_EXTENSIONS:
                    result["imageCount"] += 1
                    extension_counts = result["extensionCounts"]
                    extension_counts[path.suffix.lower()] = int(extension_counts.get(path.suffix.lower(), 0)) + 1
                    image_paths.append(path)
                    try:
                        result["totalBytes"] += path.stat().st_size
                    except OSError:
                        pass
                    if len(result["imageSamples"]) < 8:
                        result["imageSamples"].append(str(path))
                elif path.suffix.lower() in VIDEO_EXTENSIONS:
                    result["videoCount"] += 1
                    extension_counts = result["extensionCounts"]
                    extension_counts[path.suffix.lower()] = int(extension_counts.get(path.suffix.lower(), 0)) + 1
                    try:
                        result["totalBytes"] += path.stat().st_size
                    except OSError:
                        pass
                    if len(result["videoSamples"]) < 8:
                        result["videoSamples"].append(str(path))
                else:
                    result["nonImageCount"] += 1
        for path in image_paths[:24]:
            result["checkedImages"] += 1
            try:
                load_image(path)
            except Exception as exc:
                if len(result["unreadableSamples"]) < 8:
                    result["unreadableSamples"].append({"path": str(path), "error": str(exc)})
        for path in list(iter_video_paths(resolved))[:12]:
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
        if self.project.config.safe_mode:
            result["recommendations"].append("Safe Mode is on; likely intimate images and videos will be protected from matching and clustering.")
        if not self.project.references:
            result["recommendations"].append("Enroll at least one reference before scanning.")
        if self.project.config.require_consent and not self.consent_on_file:
            result["recommendations"].append("Mark consent before processing images and videos.")
        if not result["recommendations"]:
            result["recommendations"].append("Folder is ready for scanning.")
        return result

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
        add("Recognition engine", bool(self.engine.model_name), self.engine.model_name)
        face_model = model_status(self.project.config, self.engine.model_name)
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

    def state(self, preview_create_budget: int = 8) -> dict[str, Any]:
        pending = sum(1 for candidate in self.project.candidates.values() if candidate.status == "pending")
        reviewed = len(self.project.candidates) - pending
        preview_cache: dict[str, str | None] = {}
        remaining_preview_creates = max(0, int(preview_create_budget))

        def preview_for(source_path: str | None) -> str | None:
            nonlocal remaining_preview_creates
            if not source_path:
                return None
            if source_path not in preview_cache:
                cached_preview = self.project.preview_path_for(source_path, create=False)
                if cached_preview:
                    preview_cache[source_path] = cached_preview
                elif remaining_preview_creates > 0:
                    remaining_preview_creates -= 1
                    preview_cache[source_path] = self.project.preview_path_for(source_path, create=True)
                else:
                    preview_cache[source_path] = None
            return preview_cache[source_path]

        return {
            "version": __version__,
            "workspace": str(self.project.root),
            "consentOnFile": self.consent_on_file,
            "consent": self.project.consent_summary(),
            "workspaceMetadata": self.project.workspace_metadata,
            "engine": self.engine.model_name,
            "vectorStore": self.project.vector_store.backend_name,
            "platform": asdict(self.platform_report),
            "counts": {
                "references": len(self.project.references),
                "pending": pending,
                "reviewed": reviewed,
                "candidates": len(self.project.candidates),
            },
            "scanHistory": self.project.scan_history[:20],
            "scanTotals": self._scan_totals(),
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
                "safeMode": self.project.config.safe_mode,
                "safeModeThreshold": self.project.config.safe_mode_threshold,
                "reviewOnly": self.project.config.review_only,
                "requireConsent": self.project.config.require_consent,
            },
            "safeModeModel": safety_model_report(),
            "modelSetup": model_status(self.project.config, self.engine.model_name),
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
                    "createdAt": candidate.created_at,
                }
                for candidate in sorted(
                    self.project.candidates.values(),
                    key=lambda item: (item.status != "pending", -item.score, item.person_name.lower()),
                )
            ],
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
        if phase == "complete":
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


def serve(workspace: Path | None = None) -> None:
    root = resolve_workspace(workspace or os.environ.get("CROSSAGE_WORKSPACE"))
    json_stream = sys.stdout
    def startup(payload: dict[str, Any]) -> None:
        emit({"event": "startup", "payload": payload}, stream=json_stream)

    api = DesktopApi(root, actor="desktop", startup=startup)
    emit({"ready": True, "state": api.state()}, stream=json_stream)
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
                result = api.handle(str(request.get("command")), params, progress=progress)
            emit({"id": request.get("id"), "ok": True, "result": result}, stream=json_stream)
        except Exception as exc:
            request_id = request.get("id") if isinstance(request, dict) else None
            emit(
                {
                    "id": request_id,
                    "ok": False,
                    "error": {
                        "type": exc.__class__.__name__,
                        "message": str(exc),
                        "traceback": traceback.format_exc(limit=8) if os.environ.get("CROSSAGE_DEBUG") else "",
                    },
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
