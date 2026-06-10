from __future__ import annotations

from dataclasses import asdict
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
import time
import zipfile
from typing import Callable, Any

from crossage_fr.config import archive_corrupt_file, load_config, save_config
from crossage_fr.cluster import cluster_vectors
from crossage_fr.embed import EmbeddingEngine
from crossage_fr.ingest import ImageLoadError, VideoLoadError, image_record_for_path, iter_image_paths, iter_video_paths, load_image, sample_video_frames
from crossage_fr.ingest.image_io import needs_browser_preview, sha256_file, write_preview_image
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS
from crossage_fr.ingest.safety import assess_image_safety
from crossage_fr.match import group_hits
from crossage_fr.models import ReferenceFace, ReviewCandidate, new_id
from crossage_fr.store import VectorStore
from crossage_fr.workspace_registry import ensure_workspace_metadata, now_iso, write_active_workspace


ScanProgress = Callable[[dict[str, Any]], None]


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
        self.previews_path = self.root / "previews"
        self.video_frames_path = self.root / "video-frames"
        self.workspace_metadata = ensure_workspace_metadata(self.root, actor=actor)
        write_active_workspace(self.root, actor=actor, metadata=self.workspace_metadata)
        self.config = load_config(self.config_path)
        self.consent: dict[str, Any] = {}
        self.references: dict[str, ReferenceFace] = {}
        self.candidates: dict[str, ReviewCandidate] = {}
        self.scan_history: list[dict[str, Any]] = []
        self.vector_store = VectorStore()
        self.load()

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
        if self.scan_history_path.exists():
            self.scan_history.extend(self._read_json_array(self.scan_history_path)[:80])
        self.vector_store.rebuild({ref_id: ref.vector for ref_id, ref in self.references.items()})

    def save(self) -> None:
        with self._state_lock():
            self.root.mkdir(parents=True, exist_ok=True)
            save_config(self.config, self.config_path)
            self._write_json_atomic(self.consent_path, self.consent)
            refs = [asdict(ref) for ref in self.references.values()]
            candidates = [asdict(candidate) for candidate in self.candidates.values()]
            self._write_json_atomic(self.refs_path, refs)
            self._write_json_atomic(self.candidates_path, candidates)
            self._write_json_atomic(self.scan_history_path, self.scan_history[:80])

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
    ) -> tuple[int, list[str], dict[str, int]]:
        paths = sorted([*iter_image_paths(folder), *iter_video_paths(folder)], key=lambda item: str(item).lower())
        return self.scan_paths(
            paths,
            engine,
            k=k,
            on_progress=on_progress,
            source=source,
            label=str(folder.expanduser()),
            total=len(paths),
        )

    def scan_paths(
        self,
        paths: Iterable[Path],
        engine: EmbeddingEngine,
        k: int = 20,
        on_progress: ScanProgress | None = None,
        source: str = "manual",
        label: str = "",
        total: int | None = None,
    ) -> tuple[int, list[str], dict[str, int]]:
        started_at = datetime.utcnow()
        if total is None:
            try:
                total = len(paths)
            except TypeError:
                paths = list(paths)
                total = len(paths)
        resolved_paths = [path.expanduser().resolve() for path in paths]
        label = label or f"{total} selected file(s)"
        added = 0
        errors: list[str] = []
        unmatched: list[tuple[Path, float, str, list[float], dict[str, Any]]] = []
        existing = {(candidate.source_path, candidate.best_ref_id, candidate.person_name) for candidate in self.candidates.values()}
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
        }

        def queue_image(
            image_path: Path,
            image: Any | None = None,
            media_metadata: dict[str, Any] | None = None,
            apply_safe_mode: bool = True,
        ) -> int:
            nonlocal added
            metadata = dict(media_metadata or {})
            if apply_safe_mode and self.config.safe_mode:
                image = image or load_image(image_path)
                assessment = assess_image_safety(image_path, self.config.safe_mode_threshold, image=image)
                if assessment.sensitive:
                    metrics["safeFiltered"] += 1
                    metrics["skipped"] += 1
                    self._emit_scan_progress(
                        on_progress,
                        "protected",
                        metrics,
                        current_path=str(image_path),
                        message="Safe Mode protected this image from matching and clustering.",
                        safety_score=round(assessment.score, 3),
                    )
                    return 0
            embeddings = engine.embed_loaded_image(image, image_path) if image is not None else engine.embed_image(image_path)
            accepted = 0
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
                    continue
                key = (str(image_path), decision.best_ref_id, decision.person_name)
                if key in existing:
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
                existing.add(key)
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
            return accepted

        self._emit_scan_progress(on_progress, "started", metrics)
        last_checkpoint_processed = 0
        for path in resolved_paths:
            self._emit_scan_progress(on_progress, "processing", metrics, current_path=str(path))
            try:
                if path.suffix.lower() in VIDEO_EXTENSIONS:
                    metrics["videoFiles"] += 1
                    samples = sample_video_frames(path, self.video_frames_path)
                    metrics["videoFrames"] += len(samples)
                    protected = False
                    if self.config.safe_mode:
                        for sample in samples:
                            image = load_image(sample.path)
                            assessment = assess_image_safety(sample.path, self.config.safe_mode_threshold, image=image)
                            if assessment.sensitive:
                                protected = True
                                metrics["safeFiltered"] += 1
                                metrics["videoProtected"] += 1
                                metrics["skipped"] += 1
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
                        continue
                    for sample in samples:
                        image = load_image(sample.path)
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
                else:
                    queue_image(path)
            except (ImageLoadError, VideoLoadError, OSError, ValueError) as exc:
                errors.append(f"{path.name}: {exc}")
                metrics["errors"] = len(errors)
                self._emit_scan_progress(on_progress, "error", metrics, current_path=str(path), message=str(exc))
            finally:
                metrics["processed"] += 1
                self._emit_scan_progress(on_progress, "processed", metrics, current_path=str(path))
                if metrics["processed"] - last_checkpoint_processed >= 25:
                    last_checkpoint_processed = metrics["processed"]
                    self.save()
        if unmatched:
            self._emit_scan_progress(on_progress, "clustering", metrics)
            labels = cluster_vectors([row[3] for row in unmatched], self.config.cluster_min_size)
            for (path, quality, model_name, _vector, metadata), label in zip(unmatched, labels):
                if label < 0:
                    continue
                person_name = f"Unmatched cluster {label + 1}"
                key = (str(path), None, person_name)
                if key in existing:
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
                existing.add(key)
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
                if metrics["clustered"] % 25 == 0:
                    self.save()
        self._record_scan_run(source, label, started_at, metrics, errors)
        self.save()
        self._emit_scan_progress(on_progress, "complete", metrics)
        return added, errors, metrics

    def set_candidate_status(self, candidate_id: str, status: str) -> None:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        candidate = self.candidates[candidate_id]
        candidate.status = status
        audit_row = {
            "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "candidate_id": candidate_id,
            "status": status,
            "source_path": candidate.source_path,
            "person_name": candidate.person_name,
            "score": candidate.score,
            "band": candidate.band,
        }
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(audit_row) + "\n")
        self.save()

    def set_candidate_note(self, candidate_id: str, note: str) -> None:
        candidate = self.candidates[candidate_id]
        candidate.note = note.strip()[:1200]
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

    def bulk_set_candidate_status(self, candidate_ids: list[str], status: str) -> int:
        if status not in {"pending", "accepted", "rejected", "uncertain"}:
            raise ValueError(f"Unsupported review status: {status}")
        unique_ids = list(dict.fromkeys(candidate_ids))
        missing = [candidate_id for candidate_id in unique_ids if candidate_id not in self.candidates]
        if missing:
            raise KeyError(f"Candidate not found: {missing[0]}")
        for candidate_id in unique_ids:
            self.candidates[candidate_id].status = status
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
        self._append_audit({"action": "clear_candidates", "count": count})
        self.save()

    def purge_candidates(self, statuses: list[str]) -> int:
        allowed = {"pending", "accepted", "rejected", "uncertain"}
        status_set = {str(status) for status in statuses}
        if not status_set or not status_set <= allowed:
            raise ValueError("Purge statuses must be selected from pending, accepted, rejected, and uncertain.")
        to_delete = [candidate_id for candidate_id, candidate in self.candidates.items() if candidate.status in status_set]
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
            key = (candidate.source_path, candidate.person_name.casefold(), candidate.best_ref_id or "")
            groups.setdefault(key, []).append(candidate)
        duplicates: list[dict[str, Any]] = []
        for (source_path, _person_key, best_ref_id), rows in groups.items():
            if len(rows) < 2:
                continue
            ranked = self._rank_duplicate_candidates(rows)
            keep = ranked[0]
            duplicates.append(
                {
                    "sourcePath": source_path,
                    "personName": keep.person_name,
                    "bestRefId": best_ref_id or None,
                    "candidateIds": [candidate.candidate_id for candidate in rows],
                    "keepCandidateId": keep.candidate_id,
                    "count": len(rows),
                    "bestScore": max(candidate.score for candidate in rows),
                }
            )
        return sorted(duplicates, key=lambda row: (-int(row["count"]), str(row["personName"]).lower(), str(row["sourcePath"])))

    def purge_duplicate_candidates(self) -> int:
        to_delete: list[str] = []
        for group in self.duplicate_candidate_groups():
            keep_id = str(group["keepCandidateId"])
            to_delete.extend(candidate_id for candidate_id in group["candidateIds"] if candidate_id != keep_id)
        for candidate_id in to_delete:
            self.candidates.pop(candidate_id, None)
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
        for candidate_id, candidate in self.candidates.items():
            if candidate.status not in status_set:
                continue
            try:
                created = datetime.fromisoformat(candidate.created_at.replace("Z", "+00:00")).timestamp()
            except ValueError:
                created = 0
            if created < cutoff:
                to_delete.append(candidate_id)
        for candidate_id in to_delete:
            self.candidates.pop(candidate_id, None)
        self._append_audit(
            {
                "action": "purge_old_candidates",
                "days": days,
                "statuses": sorted(status_set),
                "count": len(to_delete),
            }
        )
        self.save()
        return len(to_delete)

    def export_workspace_backup(self, folder: Path | None = None, include_generated: bool = True) -> dict[str, Any]:
        export_root = (folder or self.root / "exports").expanduser().resolve()
        export_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        backup_path = export_root / f"crossage-workspace-backup-{stamp}.zip"
        counter = 2
        while backup_path.exists():
            backup_path = export_root / f"crossage-workspace-backup-{stamp}-{counter}.zip"
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
            "note": "Backup contains CrossAge workspace metadata and generated workspace files, not original source media outside the workspace.",
        }
        include_dirs = {"exports"}
        if not include_generated:
            include_dirs.update({"previews", "video-frames"})
        written = 0
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("backup-manifest.json", json.dumps(manifest, indent=2))
            written += 1
            for path in sorted(self.root.rglob("*"), key=lambda item: str(item.relative_to(self.root)).lower()):
                if not path.is_file():
                    continue
                relative = path.relative_to(self.root)
                if relative.parts and relative.parts[0] in include_dirs:
                    continue
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
        json_path = export_root / f"crossage-review-report-{stamp}.json"
        csv_path = export_root / f"crossage-candidates-{stamp}.csv"
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
            "references": [asdict(ref) for ref in sorted(self.references.values(), key=lambda item: (item.person_name.lower(), item.age_bucket, item.source_path))],
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
        json_path = export_root / f"crossage-selected-candidates-{stamp}.json"
        csv_path = export_root / f"crossage-selected-candidates-{stamp}.csv"
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

    def workspace_health(self) -> dict[str, Any]:
        missing_references = [ref for ref in self.references.values() if not Path(ref.source_path).exists()]
        missing_candidates = [candidate for candidate in self.candidates.values() if not Path(candidate.source_path).exists()]
        missing_media_sources = [
            candidate
            for candidate in self.candidates.values()
            if candidate.media_source_path and not Path(candidate.media_source_path).exists()
        ]
        reviewed_ready = sum(1 for candidate in self.candidates.values() if candidate.status in {"accepted", "rejected", "uncertain"})
        duplicate_groups = self.duplicate_candidate_groups()
        storage_bytes = 0
        file_count = 0
        for path in self.root.rglob("*"):
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
        if duplicate_groups:
            recommendations.append("Duplicate review rows can be compacted while keeping the strongest candidate.")
        if reviewed_ready:
            recommendations.append("Reviewed candidates are ready for audit export or queue purge.")
        if not recommendations:
            recommendations.append("Workspace looks healthy.")
        return {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "storageBytes": storage_bytes,
            "workspaceFileCount": file_count,
            "auditEvents": audit_events,
            "missingReferences": len(missing_references),
            "missingCandidates": len(missing_candidates),
            "missingMediaSources": len(missing_media_sources),
            "reviewedReadyToPurge": reviewed_ready,
            "duplicateGroups": duplicate_groups[:20],
            "duplicateCandidateCount": sum(max(0, int(group["count"]) - 1) for group in duplicate_groups),
            "recommendations": recommendations,
        }

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
                write_preview_image(source, preview)
            return str(preview)
        except (ImageLoadError, OSError, ValueError):
            return None

    def prepare_previews(self, limit: int = 32) -> int:
        limit = max(1, min(256, int(limit)))
        prepared = 0
        paths: list[str] = []
        seen: set[str] = set()
        for value in [
            *(ref.source_path for ref in self.references.values()),
            *(candidate.source_path for candidate in self.candidates.values()),
            *(candidate.best_ref_path for candidate in self.candidates.values() if candidate.best_ref_path),
        ]:
            if value and value not in seen:
                seen.add(value)
                paths.append(value)
        for value in paths:
            if prepared >= limit:
                break
            if self.preview_path_for(value, create=False):
                continue
            if self.preview_path_for(value, create=True):
                prepared += 1
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
    ) -> None:
        completed_at = datetime.utcnow()
        run = {
            "runId": new_id("scan"),
            "source": source,
            "label": label,
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
