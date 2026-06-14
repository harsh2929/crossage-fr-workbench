"""Public-dataset benchmark logic extracted from DesktopApi (MA-3).

These ~1.2k lines were a cohesive but file-bloating slice of ``api_server.py``.
They are moved verbatim into ``PublicDatasetBenchmarkMixin`` — a mixin so the
``self`` / MRO semantics are identical to when they lived on ``DesktopApi``
(``self.project``, ``self._engine_instance()``, ``self.actor`` etc. resolve the
same way). This is a pure relocation: no behavior change, shrinking the RPC
god-file ~28% and isolating the benchmark surface for future testing.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import Any
import csv
import importlib.util
import json
import os
import re

from crossage_fr.benchmark_quality import calibrate_public_labels
from crossage_fr.dataset_benchmarks import (
    identity_media_index,
    inspect_identity_dataset,
    materialize_file,
    prepare_cfp_dataset,
    prepare_lfw_subset,
)
from crossage_fr.embed import EmbeddingEngine
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import (
    IMAGE_EXTENSIONS,
    image_record_for_path,
    iter_image_paths,
    load_image,
    sha256_file,
)
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, VideoLoadError, sample_video_frames
from crossage_fr.model_manager import MODEL_PACKAGES, model_pack_ready, model_roots_for_engine
from crossage_fr.models import ReferenceFace, ReviewCandidate, new_id
from crossage_fr.storage import safe_resolve
from crossage_fr.workspace_registry import write_active_workspace


PROFILE_COMPONENTS = {
    "angled",
    "left",
    "profile",
    "profile-left",
    "profile-right",
    "profile_left",
    "profile_right",
    "right",
    "side",
    "side-profile",
    "side_profile",
}
FRONTAL_COMPONENTS = {"center", "centre", "front", "frontal"}
YOUNG_AGE_COMPONENTS = {"child", "children", "kid", "kids", "teen", "young", "younger", "youth"}
OLDER_AGE_COMPONENTS = {"adult", "aged", "elder", "older", "old", "senior"}
CROSS_AGE_DATASETS = {"agedb", "calfw"}
CROSS_POSE_DATASETS = {"cfp", "cplfw"}
LARGE_DISTRACTOR_DATASETS = {"megaface"}
MIXED_MEDIA_DATASETS = {"ijbc", "ytf"}


class PublicDatasetBenchmarkMixin:
    def public_dataset_benchmark(self, params: dict[str, Any]) -> dict[str, Any]:
        dataset_id = str(params.get("datasetId", "lfw") or "lfw").strip().lower()
        folder_param = str(params.get("folder", "")).strip()
        max_identities = max(2, min(250, int(params.get("maxIdentities", 12) or 12)))
        reference_images = max(1, min(5, int(params.get("referenceImages", 1) or 1)))
        candidate_images = max(1, min(20, int(params.get("candidateImages", 3) or 3)))
        include_videos = bool(params.get("includeVideos", False))
        benchmark_safe_mode = bool(params.get("safeMode", False))
        video_frame_samples = max(1, min(12, int(params.get("videoFrameSamples", 3) or 3)))
        video_frame_interval_seconds = max(0.25, min(30.0, float(params.get("videoFrameIntervalSeconds", 2.0) or 2.0)))
        include_distractors = bool(params.get("includeDistractors", True))
        negative_identities = max(1, min(100, int(params.get("negativeIdentities", max(1, max_identities // 4)) or 1))) if include_distractors else 0
        import_labels = bool(params.get("importLabels", False))
        started = monotonic()
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        run_root = self.project.validation_packs_path / "public-dataset-runs" / f"{dataset_id}-{stamp}"
        preparation: dict[str, Any] = {}
        if folder_param:
            dataset_root = Path(folder_param).expanduser()
        elif dataset_id == "lfw":
            preparation = prepare_lfw_subset(
                self.project.validation_packs_path / "public-datasets" / "lfw",
                max_identities=max_identities + negative_identities,
                images_per_identity=reference_images + candidate_images,
                min_faces_per_person=reference_images + 1,
                download_if_missing=bool(params.get("downloadIfMissing", True)),
            )
            dataset_root = Path(str(preparation["folder"]))
        elif dataset_id == "cfp":
            preparation = prepare_cfp_dataset(
                self.project.validation_packs_path / "public-datasets" / "cfp",
                download_if_missing=bool(params.get("downloadIfMissing", True)),
            )
            dataset_root = Path(str(preparation["folder"]))
        else:
            raise ValueError("Choose a local dataset folder for this benchmark.")

        entry_budget = max(10_000, int(params.get("entryBudget", 500_000) or 500_000))
        inspection = inspect_identity_dataset(
            dataset_root,
            dataset_id=dataset_id,
            max_identities=max(250, max_identities + negative_identities + 50),
            entry_budget=entry_budget,
            include_videos=include_videos,
        )
        identities, truncated, entries_checked = identity_media_index(
            dataset_root,
            max_identities=max(250, max_identities + negative_identities + 50),
            entry_budget=entry_budget,
            include_videos=include_videos,
        )
        def identity_has_benchmark_media(identity: IdentityMedia) -> bool:
            if len(identity.images) >= reference_images + 1:
                return True
            if include_videos and identity.videos and len(identity.images) >= reference_images:
                return True
            return False

        usable = [item for item in identities if identity_has_benchmark_media(item)]
        positives = usable[:max_identities]
        if dataset_id == "fiw":
            positive_folders = {str(identity.folder) for identity in positives}
            family_first: list[IdentityMedia] = []
            fallback_distractors: list[IdentityMedia] = []
            positive_families = {self._public_dataset_family_key(identity) for identity in positives}
            for identity in usable:
                if str(identity.folder) in positive_folders:
                    continue
                if self._public_dataset_family_key(identity) in positive_families:
                    family_first.append(identity)
                else:
                    fallback_distractors.append(identity)
            distractors = (family_first + fallback_distractors)[:negative_identities]
        else:
            distractors = usable[max_identities : max_identities + negative_identities]
        if len(positives) < 2:
            raise ValueError("Dataset benchmark needs at least two identity folders with enough images.")

        refs_root = run_root / "references"
        scan_root = run_root / "scan"
        video_frame_cache_root = run_root / "video-frame-cache"
        report_path = run_root / "public-dataset-benchmark.json"
        labels_json_path = run_root / "public-dataset-labels.json"
        labels_csv_path = run_root / "public-dataset-labels.csv"
        refs_root.mkdir(parents=True, exist_ok=True)
        scan_root.mkdir(parents=True, exist_ok=True)

        ground_truth: dict[str, dict[str, Any]] = {}
        video_decode_failures: list[dict[str, Any]] = []
        selected_references = 0
        selected_candidates = 0
        selected_video_files = 0
        selected_video_frames = 0

        def safe_identity_name(value: str) -> str:
            return re.sub(r"[^A-Za-z0-9_. -]+", "_", value).strip(" ._-")[:100] or "identity"

        positive_folder_names = {
            str(identity.folder): f"{index:04d}-{safe_identity_name(identity.identity)}"
            for index, identity in enumerate(positives, start=1)
        }
        positive_person_names = {
            str(identity.folder): f"{index:04d} {identity.identity}".strip()
            for index, identity in enumerate(positives, start=1)
        }
        distractor_folder_names = {
            str(identity.folder): f"distractor-{index:04d}-{safe_identity_name(identity.identity)}"
            for index, identity in enumerate(distractors, start=1)
        }

        def materialize_selected(source: Path, destination_root: Path, folder_name: str, prefix: str) -> Path:
            destination = destination_root / folder_name / f"{prefix}-{source.name}"
            materialize_file(safe_resolve(source), destination)
            return destination.resolve()

        def materialize_video_frames(source: Path, destination_root: Path, folder_name: str, prefix: str) -> list[dict[str, Any]]:
            nonlocal selected_video_files, selected_video_frames
            selected_video_files += 1
            try:
                samples = sample_video_frames(
                    safe_resolve(source),
                    video_frame_cache_root,
                    max_frames=video_frame_samples,
                    interval_seconds=video_frame_interval_seconds,
                    jpeg_quality=90,
                )
            except (VideoLoadError, OSError, ValueError) as exc:
                video_decode_failures.append(
                    {
                        "sourcePath": str(source),
                        "error": str(exc)[:500],
                        "datasetId": dataset_id,
                    }
                )
                return []
            materialized: list[dict[str, Any]] = []
            for sample_index, sample in enumerate(samples[:video_frame_samples], start=1):
                frame_name = f"{prefix}-frame-{sample_index:02d}-{sample.timestamp_ms:010d}ms-{source.stem}.jpg"
                destination = destination_root / folder_name / frame_name
                materialize_file(safe_resolve(sample.path), destination)
                selected_video_frames += 1
                materialized.append(
                    {
                        "path": destination.resolve(),
                        "timestampMs": sample.timestamp_ms,
                        "frameIndex": sample.frame_index,
                        "durationMs": sample.duration_ms,
                        "sourcePath": str(source),
                    }
                )
            return materialized

        def path_has_any(path: Path, components: set[str]) -> bool:
            return self._public_dataset_has_any_component(path, components)

        def cross_age_order(paths: list[Path], *, prefer: str) -> list[Path]:
            young = [path for path in paths if path_has_any(path, YOUNG_AGE_COMPONENTS)]
            older = [path for path in paths if path_has_any(path, OLDER_AGE_COMPONENTS)]
            if prefer == "young" and young:
                return young + [path for path in paths if path not in young]
            if prefer == "older" and older:
                return older + [path for path in paths if path not in older]
            age_scored: list[tuple[int, str, Path]] = []
            for path in paths:
                age = self._public_dataset_age_value(path)
                if age is not None:
                    age_scored.append((age, str(path).casefold(), path))
            if len(age_scored) >= 2:
                age_scored.sort(key=lambda item: (item[0], item[1]))
                ordered = [item[2] for item in age_scored]
                if prefer == "older":
                    ordered = list(reversed(ordered))
                remainder = [path for path in paths if path not in set(ordered)]
                return ordered + remainder
            return paths

        def cross_age_balanced_order(paths: list[Path]) -> list[Path]:
            age_scored: list[tuple[int, str, Path]] = []
            for path in paths:
                age = self._public_dataset_age_value(path)
                if age is not None:
                    age_scored.append((age, str(path).casefold(), path))
            if len(age_scored) >= 2:
                age_scored.sort(key=lambda item: (item[0], item[1]))
                selected: list[Path] = []
                left = 0
                right = len(age_scored) - 1
                while left <= right:
                    selected.append(age_scored[left][2])
                    if right == left:
                        break
                    selected.append(age_scored[right][2])
                    left += 1
                    right -= 1
                remainder = [path for path in paths if path not in set(selected)]
                return selected + remainder
            young = [path for path in paths if path_has_any(path, YOUNG_AGE_COMPONENTS)]
            older = [path for path in paths if path_has_any(path, OLDER_AGE_COMPONENTS)]
            remainder = [path for path in paths if path not in set(young + older)]
            if young and older:
                balanced: list[Path] = []
                for index in range(max(len(young), len(older))):
                    if index < len(young):
                        balanced.append(young[index])
                    if index < len(older):
                        balanced.append(older[index])
                return balanced + remainder
            return cross_age_order(paths, prefer="young")

        def select_reference_sources(identity: IdentityMedia) -> list[Path]:
            if dataset_id in CROSS_POSE_DATASETS:
                frontal = [path for path in identity.images if path_has_any(path, FRONTAL_COMPONENTS)]
                if len(frontal) >= reference_images:
                    return frontal[:reference_images]
            if dataset_id in CROSS_AGE_DATASETS:
                ordered = cross_age_balanced_order(list(identity.images)) if reference_images > 1 else cross_age_order(list(identity.images), prefer="young")
                return ordered[:reference_images]
            return list(identity.images[:reference_images])

        def select_candidate_sources(identity: IdentityMedia, excluded: set[Path]) -> list[Path]:
            available = [path for path in identity.images if path not in excluded]
            if dataset_id in CROSS_POSE_DATASETS:
                profile = [path for path in available if path_has_any(path, PROFILE_COMPONENTS)]
                fallback = [path for path in available if path not in profile]
                available = profile + fallback
            elif dataset_id in CROSS_AGE_DATASETS:
                available = cross_age_order(available, prefer="older")
            if include_videos and dataset_id == "ytf" and identity.videos:
                selected = list(identity.videos[:candidate_images])
                remaining = max(0, candidate_images - len(selected))
                selected.extend(available[:remaining])
            else:
                selected = list(available[:candidate_images])
            if include_videos and dataset_id in MIXED_MEDIA_DATASETS and dataset_id != "ytf":
                remaining = max(0, candidate_images - len(selected))
                selected.extend(identity.videos[:remaining])
            elif include_videos and dataset_id != "ytf":
                remaining = max(0, candidate_images - len(selected))
                selected.extend(identity.videos[:remaining])
            return selected

        for identity in positives:
            folder_name = positive_folder_names[str(identity.folder)]
            person_name = positive_person_names[str(identity.folder)]
            reference_sources = select_reference_sources(identity)
            excluded_sources = {source.resolve() for source in reference_sources}
            for index, source in enumerate(reference_sources, start=1):
                materialize_selected(source, refs_root, folder_name, f"ref-{index:02d}")
                selected_references += 1
            candidate_sources = select_candidate_sources(identity, excluded_sources)
            for index, source in enumerate(candidate_sources, start=1):
                if source.suffix.lower() in VIDEO_EXTENSIONS:
                    for frame in materialize_video_frames(source, scan_root, folder_name, f"pos-{index:02d}"):
                        destination = frame["path"]
                        ground_truth[str(destination)] = {
                            "identity": person_name,
                            "sourceIdentity": identity.identity,
                            "sourceDatasetPath": str(source),
                            "expectedMatch": True,
                            "mediaKind": "video",
                            "videoFramePath": str(destination),
                            "videoTimestampMs": int(frame["timestampMs"]),
                            "videoFrameIndex": int(frame["frameIndex"]),
                            "videoDurationMs": int(frame["durationMs"]),
                        }
                        selected_candidates += 1
                    continue
                destination = materialize_selected(source, scan_root, folder_name, f"pos-{index:02d}")
                media_kind = "video-frame" if dataset_id == "ytf" else "image"
                ground_truth[str(destination)] = {
                    "identity": person_name,
                    "sourceIdentity": identity.identity,
                    "sourceDatasetPath": str(source),
                    "expectedMatch": True,
                    "mediaKind": media_kind,
                }
                selected_candidates += 1

        for identity in distractors:
            folder_name = distractor_folder_names[str(identity.folder)]
            candidate_sources = select_candidate_sources(identity, set())
            family_hard_negative = dataset_id == "fiw" and any(
                self._public_dataset_family_key(identity) == self._public_dataset_family_key(positive)
                for positive in positives
            )
            for index, source in enumerate(candidate_sources, start=1):
                if source.suffix.lower() in VIDEO_EXTENSIONS:
                    for frame in materialize_video_frames(source, scan_root, folder_name, f"neg-{index:02d}"):
                        destination = frame["path"]
                        ground_truth[str(destination)] = {
                            "identity": identity.identity,
                            "sourceIdentity": identity.identity,
                            "sourceDatasetPath": str(source),
                            "expectedMatch": False,
                            "mediaKind": "video",
                            "validationBucket": "hard-negative:family-lookalike" if family_hard_negative else "",
                            "videoFramePath": str(destination),
                            "videoTimestampMs": int(frame["timestampMs"]),
                            "videoFrameIndex": int(frame["frameIndex"]),
                            "videoDurationMs": int(frame["durationMs"]),
                        }
                        selected_candidates += 1
                    continue
                destination = materialize_selected(source, scan_root, folder_name, f"neg-{index:02d}")
                media_kind = "video-frame" if dataset_id == "ytf" else "image"
                ground_truth[str(destination)] = {
                    "identity": identity.identity,
                    "sourceIdentity": identity.identity,
                    "sourceDatasetPath": str(source),
                    "expectedMatch": False,
                    "mediaKind": media_kind,
                    "validationBucket": "hard-negative:family-lookalike" if family_hard_negative else "",
                }
                selected_candidates += 1

        scratch = ProjectState(run_root / "workspace", actor="dataset-benchmark")
        try:
            scratch.config = deepcopy(self.project.config)
            scratch.config.safe_mode = benchmark_safe_mode
            scratch.apply_video_decoder_config()
            scratch.set_consent(True, source="dataset-benchmark", operator=self.actor, note=f"{dataset_id} isolated benchmark", scope=str(run_root))
            engine = self._engine_instance()
            enrolled, enroll_errors = self._batch_enroll_public_dataset_references(
                scratch,
                engine,
                [
                    (positive_person_names[str(identity.folder)], refs_root / positive_folder_names[str(identity.folder)])
                    for identity in positives
                ],
            )
            added, scan_errors, scan_metrics = scratch.scan_folder(scan_root, engine, source=f"public-dataset-{dataset_id}", resume=False)
            scratch.save()
        finally:
            write_active_workspace(self.project.root, actor=self.actor, metadata=self.project.workspace_metadata)

        best_by_source: dict[str, ReviewCandidate] = {}
        for candidate in scratch.candidates.values():
            if not candidate.best_ref_id:
                continue
            source_text = str(getattr(candidate, "media_source_path", "") or candidate.source_path)
            source = str(Path(source_text).expanduser().resolve())
            current = best_by_source.get(source)
            if current is None or candidate.score > current.score:
                best_by_source[source] = candidate

        true_positives = false_positives = true_negatives = false_negatives = wrong_identity = 0
        labels: list[dict[str, Any]] = []
        for source_path, truth in sorted(ground_truth.items()):
            best = best_by_source.get(source_path)
            expected_match = bool(truth["expectedMatch"])
            expected_identity = str(truth["identity"])
            actual_identity = best.person_name if best else ""
            score = float(best.score) if best else 0.0
            predicted = best is not None
            correct_identity = predicted and actual_identity == expected_identity
            pose_bucket = self._public_dataset_pose_bucket(str(truth.get("sourceDatasetPath") or source_path), best)
            age_bucket = self._public_dataset_age_bucket(str(truth.get("sourceDatasetPath") or source_path))
            validation_bucket = str(truth.get("validationBucket") or "").strip() or self._public_dataset_validation_bucket(
                dataset_id,
                pose_bucket=pose_bucket,
                age_bucket=age_bucket,
                media_kind=str(truth.get("mediaKind", "image") or "image"),
                expected_match=expected_match,
                source_identity=str(truth.get("sourceIdentity", expected_identity)),
                expected_identity=expected_identity,
            )
            difficulty = self._public_dataset_difficulty(dataset_id, validation_bucket, expected_match=expected_match)
            if expected_match and correct_identity:
                true_positives += 1
                outcome = "true-positive"
            elif expected_match and predicted:
                wrong_identity += 1
                false_positives += 1
                false_negatives += 1
                outcome = "wrong-identity"
            elif expected_match:
                false_negatives += 1
                outcome = "false-negative"
            elif predicted:
                false_positives += 1
                outcome = "false-positive"
            else:
                true_negatives += 1
                outcome = "true-negative"
            source_hash = ""
            if Path(source_path).suffix.lower() in IMAGE_EXTENSIONS:
                try:
                    source_hash = sha256_file(Path(source_path))
                except OSError:
                    source_hash = ""
            labels.append(
                {
                    "sourcePath": source_path,
                    "sourceDatasetPath": str(truth.get("sourceDatasetPath", "")),
                    "sourceHash": source_hash,
                    "expectedPerson": expected_identity,
                    "sourcePerson": str(truth.get("sourceIdentity", expected_identity)),
                    "actualPerson": actual_identity,
                    "matchScore": score,
                    "quality": float(best.quality) if best else 0.0,
                    "isMatch": expected_match,
                    "status": "accepted" if expected_match else "rejected",
                    "mediaKind": truth.get("mediaKind", "image"),
                    "poseBucket": pose_bucket,
                    "ageBucket": age_bucket,
                    "videoFramePath": str(truth.get("videoFramePath", "")),
                    "videoTimestampMs": truth.get("videoTimestampMs"),
                    "videoFrameIndex": truth.get("videoFrameIndex"),
                    "videoDurationMs": truth.get("videoDurationMs"),
                    "safeLabel": dataset_id,
                    "scenario": f"{dataset_id}-{validation_bucket.replace(':', '-')}",
                    "validationBucket": validation_bucket,
                    "difficulty": difficulty,
                    "outcome": outcome,
                }
            )
        precision = true_positives / max(1, true_positives + false_positives)
        recall = true_positives / max(1, true_positives + false_negatives)
        specificity = true_negatives / max(1, true_negatives + false_positives)
        accuracy = (true_positives + true_negatives) / max(1, len(ground_truth))
        metrics_by_threshold = self._public_dataset_threshold_metrics(labels, scratch.config.thresholds)
        threshold_calibration = calibrate_public_labels(labels, scratch.config.thresholds)
        validation_matrix = self._public_dataset_validation_matrix(labels)
        import_result = self.project.import_accuracy_labels(labels) if import_labels else None
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "datasetId": dataset_id,
            "datasetFolder": str(safe_resolve(dataset_root)),
            "runRoot": str(run_root),
            "workspace": str(scratch.root),
            "engine": self.engine_name,
            "durationMs": round((monotonic() - started) * 1000, 2),
            "preparation": preparation,
            "inspection": inspection,
            "truncated": bool(truncated or inspection.get("truncated")),
            "entriesChecked": entries_checked,
            "selected": {
                "identities": len(positives),
                "distractorIdentities": len(distractors),
                "references": selected_references,
                "candidates": selected_candidates,
                "videoFiles": selected_video_files,
                "videoFrames": selected_video_frames,
            },
            "pipeline": {
                "enrolled": enrolled,
                "scanAdded": added,
                "scanMetrics": scan_metrics,
                "enrollErrors": enroll_errors[:20],
                "scanErrors": scan_errors[:20],
                "videoDecodeFailures": video_decode_failures[:50],
            },
            "metrics": {
                "evaluated": len(ground_truth),
                "truePositives": true_positives,
                "falsePositives": false_positives,
                "trueNegatives": true_negatives,
                "falseNegatives": false_negatives,
                "wrongIdentity": wrong_identity,
                "precision": round(precision, 6),
                "recall": round(recall, 6),
                "specificity": round(specificity, 6),
                "accuracy": round(accuracy, 6),
            },
            "metricsByThreshold": metrics_by_threshold,
            "thresholdCalibration": threshold_calibration,
            "validationMatrix": validation_matrix,
            "labelsJsonPath": str(labels_json_path),
            "labelsCsvPath": str(labels_csv_path),
            "reportPath": str(report_path),
            "recommendations": self._public_dataset_recommendations(dataset_id, precision, recall, false_positives, false_negatives, wrong_identity, scan_errors, metrics_by_threshold, video_decode_failures=video_decode_failures),
            "importResult": import_result,
        }
        labels_json_path.write_text(json.dumps({"generatedAt": payload["generatedAt"], "datasetId": dataset_id, "labels": labels}, indent=2), encoding="utf-8")
        with labels_csv_path.open("w", encoding="utf-8", newline="") as handle:
            fieldnames = list(labels[0].keys()) if labels else ["sourcePath"]
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in labels:
                writer.writerow(row)
        report_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.project._append_audit(
            {
                "action": "run_public_dataset_benchmark",
                "dataset_id": dataset_id,
                "run_root": str(run_root),
                "evaluated": len(ground_truth),
                "precision": payload["metrics"]["precision"],
                "recall": payload["metrics"]["recall"],
            }
        )
        return payload

    def public_dataset_model_comparison(self, params: dict[str, Any]) -> dict[str, Any]:
        packs_param = params.get("packs")
        if isinstance(packs_param, list) and packs_param:
            requested = [str(item).strip() for item in packs_param if str(item).strip()]
        else:
            requested = [str(self.project.config.model_pack or "").strip(), "buffalo_l"]
        packs: list[str] = []
        for pack in requested:
            if pack in MODEL_PACKAGES and pack not in packs:
                packs.append(pack)
        if not packs:
            raise ValueError("Choose at least one known model package to compare.")

        dataset_id = str(params.get("datasetId", "lfw") or "lfw").strip().lower()
        folder_param = str(params.get("folder", "")).strip()
        compare_params: dict[str, Any] = {
            "datasetId": dataset_id,
            "folder": folder_param,
            "maxIdentities": params.get("maxIdentities", 12),
            "referenceImages": params.get("referenceImages", 1),
            "candidateImages": params.get("candidateImages", 3),
            "includeVideos": bool(params.get("includeVideos", False)),
            "videoFrameSamples": params.get("videoFrameSamples", 3),
            "videoFrameIntervalSeconds": params.get("videoFrameIntervalSeconds", 2.0),
            "safeMode": bool(params.get("safeMode", False)),
            "includeDistractors": bool(params.get("includeDistractors", True)),
            "downloadIfMissing": bool(params.get("downloadIfMissing", False)),
            "importLabels": False,
            "entryBudget": params.get("entryBudget", 500_000),
        }
        if params.get("negativeIdentities") not in (None, ""):
            compare_params["negativeIdentities"] = params.get("negativeIdentities")

        started = monotonic()
        original_config = deepcopy(self.project.config)
        original_engine = self._engine
        original_engine_name = self._engine_model_name
        rows: list[dict[str, Any]] = []
        try:
            for pack in packs:
                spec = MODEL_PACKAGES[pack]
                trial_config = deepcopy(original_config)
                trial_config.model_pack = pack
                runtime_unavailable = os.environ.get("CROSSAGE_FORCE_FALLBACK") == "1" or importlib.util.find_spec("insightface") is None
                ready_roots = [root for root in model_roots_for_engine(trial_config) if model_pack_ready(root, pack)]
                if runtime_unavailable or not ready_roots:
                    rows.append(
                        {
                            "pack": pack,
                            "label": spec.label,
                            "available": False,
                            "status": "missing",
                            "engine": "",
                            "error": "InsightFace runtime is unavailable." if runtime_unavailable else "Model pack is not installed. Download it before running comparison.",
                            "metrics": None,
                            "metricsByThreshold": None,
                            "thresholdCalibration": None,
                            "validationMatrix": None,
                            "pipeline": None,
                            "reportPath": "",
                            "runRoot": "",
                            "recommendations": ["Install the full face-recognition runtime, then rerun model comparison."] if runtime_unavailable else ["Download this model pack, then rerun model comparison."],
                        }
                    )
                    continue
                trial_config.model_root = str(ready_roots[0])
                self.project.config = trial_config
                self._reset_engine()
                try:
                    benchmark = self.public_dataset_benchmark(compare_params)
                    rows.append(
                        {
                            "pack": pack,
                            "label": spec.label,
                            "available": True,
                            "status": "complete",
                            "engine": benchmark.get("engine", ""),
                            "error": "",
                            "metrics": benchmark.get("metrics"),
                            "metricsByThreshold": benchmark.get("metricsByThreshold"),
                            "thresholdCalibration": benchmark.get("thresholdCalibration"),
                            "validationMatrix": benchmark.get("validationMatrix"),
                            "pipeline": benchmark.get("pipeline"),
                            "reportPath": benchmark.get("reportPath", ""),
                            "runRoot": benchmark.get("runRoot", ""),
                            "recommendations": benchmark.get("recommendations", []),
                        }
                    )
                except Exception as exc:
                    rows.append(
                        {
                            "pack": pack,
                            "label": spec.label,
                            "available": True,
                            "status": "error",
                            "engine": self.engine_name,
                            "error": str(exc),
                            "metrics": None,
                            "metricsByThreshold": None,
                            "thresholdCalibration": None,
                            "validationMatrix": None,
                            "pipeline": None,
                            "reportPath": "",
                            "runRoot": "",
                            "recommendations": ["This model comparison run failed; inspect diagnostics and model integrity."],
                        }
                    )
        finally:
            self.project.config = original_config
            self._engine = original_engine
            self._engine_model_name = original_engine.model_name if original_engine is not None else original_engine_name

        complete_rows = [row for row in rows if row.get("status") == "complete" and isinstance(row.get("metrics"), dict)]
        for row in complete_rows:
            recommendation = self._model_pack_recommendation_score(row)
            row["recommendationScore"] = recommendation["score"]
            row["recommendationReasons"] = recommendation["reasons"]
        best_precision = None
        best_recall = None
        if complete_rows:
            best_precision = max(complete_rows, key=lambda row: float(row["metrics"].get("precision", 0) or 0))["pack"]
            best_recall = max(complete_rows, key=lambda row: float(row["metrics"].get("recall", 0) or 0))["pack"]
        recommendation = self._model_comparison_recommendation(complete_rows, current_pack=original_config.model_pack)
        recommendations: list[str] = []
        if recommendation.get("recommendedPack"):
            recommendations.append(str(recommendation.get("summary") or "Recommended model selected from benchmark metrics."))
            recommendations.extend(str(item) for item in recommendation.get("actions", [])[:2])
        elif best_recall:
            recommendations.append(f"{best_recall} had the highest recall on this benchmark slice.")
        if best_precision and best_precision != best_recall:
            recommendations.append(f"{best_precision} had the highest precision on this benchmark slice.")
        if any(row.get("status") == "missing" for row in rows):
            recommendations.append("Missing packs were skipped; use the model downloader before relying on the comparison.")
        if not complete_rows:
            recommendations.append("No installed model packs could be benchmarked.")
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        report_root = self.project.validation_packs_path / "public-dataset-runs"
        report_root.mkdir(parents=True, exist_ok=True)
        report_path = report_root / f"model-comparison-{dataset_id}-{stamp}.json"
        payload = {
            "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "datasetId": dataset_id,
            "datasetFolder": str(Path(folder_param).expanduser()) if folder_param else "",
            "durationMs": round((monotonic() - started) * 1000, 2),
            "packs": rows,
            "bestPrecisionPack": best_precision,
            "bestRecallPack": best_recall,
            "recommendedPack": recommendation.get("recommendedPack"),
            "recommendation": recommendation,
            "reportPath": str(report_path),
            "recommendations": recommendations[:8],
        }
        report_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.project._append_audit(
            {
                "action": "compare_public_dataset_models",
                "dataset_id": dataset_id,
                "packs": packs,
                "complete": len(complete_rows),
                "report_path": str(report_path),
            }
        )
        return payload

    def _model_pack_recommendation_score(self, row: dict[str, Any]) -> dict[str, Any]:
        metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
        likely = row.get("metricsByThreshold", {}).get("likely", {}) if isinstance(row.get("metricsByThreshold"), dict) else {}
        matrix = row.get("validationMatrix") if isinstance(row.get("validationMatrix"), dict) else {}
        profile = matrix.get("pose:profile", {}) if isinstance(matrix.get("pose:profile"), dict) else {}
        cross_age = matrix.get("age:cross-age", {}) if isinstance(matrix.get("age:cross-age"), dict) else {}
        hard_negative = matrix.get("hard-negative:family-lookalike", {}) if isinstance(matrix.get("hard-negative:family-lookalike"), dict) else {}
        precision = float(metrics.get("precision", 0.0) or 0.0)
        recall = float(metrics.get("recall", 0.0) or 0.0)
        likely_precision = float(likely.get("precision", precision) or precision)
        likely_recall = float(likely.get("recall", recall) or recall)
        profile_recall = float(profile.get("recall", recall) or recall)
        cross_age_recall = float(cross_age.get("recall", recall) or recall)
        wrong_identity = int(metrics.get("wrongIdentity", 0) or 0)
        false_positive = int(metrics.get("falsePositives", 0) or 0)
        hard_negative_fp = int(hard_negative.get("falsePositives", 0) or 0)
        hard_negative_wrong = int(hard_negative.get("wrongIdentity", 0) or 0)
        hard_pose_reviews = int(((row.get("pipeline") or {}).get("scanMetrics") or {}).get("poseRelaxedReviews", 0) or 0) if isinstance(row.get("pipeline"), dict) else 0
        score = (
            precision * 0.32
            + recall * 0.24
            + profile_recall * 0.18
            + cross_age_recall * 0.12
            + likely_precision * 0.08
            + likely_recall * 0.06
        )
        score -= min(0.45, wrong_identity * 0.08 + false_positive * 0.035 + hard_negative_fp * 0.09 + hard_negative_wrong * 0.12)
        score -= min(0.08, hard_pose_reviews * 0.01)
        reasons: list[str] = [
            f"precision {precision:.3f}",
            f"recall {recall:.3f}",
            f"profile recall {profile_recall:.3f}",
            f"cross-age recall {cross_age_recall:.3f}",
        ]
        if wrong_identity:
            reasons.append(f"{wrong_identity} wrong-identity match{'es' if wrong_identity != 1 else ''}")
        if hard_negative_fp:
            reasons.append(f"{hard_negative_fp} family/lookalike false positive{'s' if hard_negative_fp != 1 else ''}")
        if hard_pose_reviews:
            reasons.append(f"{hard_pose_reviews} hard-pose review candidate{'s' if hard_pose_reviews != 1 else ''}")
        return {"score": round(max(0.0, score), 6), "reasons": reasons}

    def _model_comparison_recommendation(self, rows: list[dict[str, Any]], *, current_pack: str) -> dict[str, Any]:
        if not rows:
            return {
                "status": "unavailable",
                "recommendedPack": None,
                "currentPack": current_pack,
                "confidence": "none",
                "summary": "No installed model packs completed the benchmark.",
                "actions": ["Install a full face model pack and rerun model comparison."],
            }
        ranked = sorted(rows, key=lambda row: float(row.get("recommendationScore", 0.0) or 0.0), reverse=True)
        best = ranked[0]
        current = next((row for row in rows if row.get("pack") == current_pack), None)
        best_metrics = best.get("metrics") if isinstance(best.get("metrics"), dict) else {}
        best_matrix = best.get("validationMatrix") if isinstance(best.get("validationMatrix"), dict) else {}
        best_profile = best_matrix.get("pose:profile", {}) if isinstance(best_matrix.get("pose:profile"), dict) else {}
        best_cross_age = best_matrix.get("age:cross-age", {}) if isinstance(best_matrix.get("age:cross-age"), dict) else {}
        best_hard_negative = best_matrix.get("hard-negative:family-lookalike", {}) if isinstance(best_matrix.get("hard-negative:family-lookalike"), dict) else {}
        best_score = float(best.get("recommendationScore", 0.0) or 0.0)
        current_score = float(current.get("recommendationScore", 0.0) or 0.0) if current else -1.0
        margin = best_score - current_score
        wrong_identity = int(best_metrics.get("wrongIdentity", 0) or 0)
        hard_negative_false_positives = int(best_hard_negative.get("falsePositives", 0) or 0)
        precision = float(best_metrics.get("precision", 0.0) or 0.0)
        recall = float(best_metrics.get("recall", 0.0) or 0.0)
        profile_recall = float(best_profile.get("recall", recall) or recall)
        cross_age_recall = float(best_cross_age.get("recall", recall) or recall)
        status = "keep" if best.get("pack") == current_pack or margin < 0.015 else "switch"
        confidence = (
            "high"
            if precision >= 0.98 and wrong_identity == 0 and hard_negative_false_positives == 0 and margin >= 0.03
            else "medium"
            if precision >= 0.95 and wrong_identity == 0 and hard_negative_false_positives == 0
            else "low"
        )
        actions: list[str] = []
        if status == "switch":
            actions.append("Apply this pack, then backfill saved person photos before scanning.")
        else:
            actions.append("Keep the current model pack for this benchmark slice.")
        if profile_recall < 0.7:
            actions.append("Add side/profile reference photos for important people; this dataset still shows profile misses.")
        if cross_age_recall < 0.75:
            actions.append("Add multiple age-range references before applying this pack to old family archives.")
        if wrong_identity:
            actions.append("Review false positives before applying this pack broadly.")
        if hard_negative_false_positives:
            actions.append("Keep family/lookalike matches in review; this pack produced hard-negative false positives.")
        return {
            "status": status,
            "recommendedPack": str(best.get("pack") or ""),
            "recommendedLabel": str(best.get("label") or best.get("pack") or ""),
            "currentPack": current_pack,
            "confidence": confidence,
            "score": round(best_score, 6),
            "currentScore": round(current_score, 6) if current_score >= 0 else None,
            "margin": round(max(0.0, margin), 6),
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "profileRecall": round(profile_recall, 6),
            "crossAgeRecall": round(cross_age_recall, 6),
            "wrongIdentity": wrong_identity,
            "hardNegativeFalsePositives": hard_negative_false_positives,
            "summary": f"{best.get('pack')} is the recommended pack for this benchmark slice: {precision:.1%} precision, {recall:.1%} recall, {profile_recall:.1%} profile recall.",
            "reasons": best.get("recommendationReasons", []),
            "actions": actions[:4],
        }

    def apply_model_recommendation(self, params: dict[str, Any], progress: Any | None = None) -> dict[str, Any]:
        pack = str(params.get("pack") or params.get("recommendedPack") or "").strip()
        if not pack:
            raise ValueError("Choose a recommended model pack to apply.")
        if pack not in MODEL_PACKAGES:
            raise ValueError("Choose a known face model package.")
        roots = [root for root in model_roots_for_engine(self.project.config) if model_pack_ready(root, pack)]
        if not roots:
            raise ValueError("Recommended model pack is not installed. Download it before applying.")
        old_pack = self.project.config.model_pack
        self.project.config.model_pack = pack
        self.project.config.model_root = str(roots[0])
        self.project.save()
        self._reset_engine()
        backfill_result: dict[str, Any] | None = None
        if bool(params.get("backfill", True)) and self.project.references:
            backfill_result = self.project.backfill_references_for_model(
                self._engine_instance(),
                on_progress=(lambda payload: self._progress(progress, {**payload, "source": "model_backfill"})) if progress else None,
                limit=int(params.get("limit", 0) or 0),
            )
        self.project._append_audit(
            {
                "action": "apply_model_recommendation",
                "old_pack": old_pack,
                "new_pack": pack,
                "backfill_added": int((backfill_result or {}).get("added", 0) or 0),
            }
        )
        return {
            "oldPack": old_pack,
            "newPack": pack,
            "modelRoot": str(roots[0]),
            "changed": old_pack != pack,
            "backfill": backfill_result,
        }

    def _batch_enroll_public_dataset_references(
        self,
        project: ProjectState,
        engine: EmbeddingEngine,
        identities: list[tuple[str, Path]],
    ) -> tuple[int, list[str]]:
        added = 0
        errors: list[str] = []
        known_hashes = {ref.source_hash or ref.source_path for ref in project.references.values()}
        for person_name, folder in identities:
            person_name = str(person_name).strip()
            if not person_name:
                continue
            folder_added = 0
            folder_errors = 0
            for path in iter_image_paths(folder):
                try:
                    source_hash = sha256_file(path)
                    if source_hash in known_hashes:
                        continue
                    image = load_image(path)
                    record = image_record_for_path(path, image=image, sha256=source_hash)
                    embeddings = engine.embed_loaded_image(image, path)
                    if not embeddings and project.config.two_pass_scan:
                        rescue_method = getattr(engine, "embed_loaded_image_rescue", None)
                        embeddings = rescue_method(image, path) if callable(rescue_method) else []
                    for embedding in embeddings:
                        if embedding.quality < project.config.thresholds.quality_min:
                            continue
                        ref = ReferenceFace(
                            ref_id=new_id("ref"),
                            person_name=person_name,
                            age_bucket="dataset",
                            source_path=str(path),
                            capture_date=record.capture_date,
                            quality=embedding.quality,
                            model_name=embedding.model_name,
                            vector=embedding.vector,
                            source_hash=record.sha256,
                            pose_bucket=embedding.pose_bucket,
                        )
                        project.references[ref.ref_id] = ref
                        project.vector_store.add(ref.ref_id, ref.vector)
                        added += 1
                        folder_added += 1
                    known_hashes.add(record.sha256)
                except (OSError, ValueError, RuntimeError) as exc:
                    folder_errors += 1
                    if len(errors) < 50:
                        errors.append(f"{person_name}/{path.name}: {exc}")
            project._append_audit(
                {
                    "action": "enroll_folder",
                    "person_name": person_name,
                    "age_bucket": "dataset",
                    "folder": str(folder.expanduser()),
                    "added": folder_added,
                    "errors": folder_errors,
                    "source": "public_dataset_benchmark_batch",
                }
            )
        if added:
            project._invalidate_reference_indexes()
        project.save()
        return added, errors

    def _public_dataset_family_key(self, identity: Any) -> str:
        label = str(getattr(identity, "identity", identity) or "").strip()
        if "__" in label:
            return label.split("__", 1)[0].casefold()
        folder = getattr(identity, "folder", None)
        try:
            path = Path(str(folder))
            parent = path.parent.name
            if parent and parent.casefold() not in {"data", "dataset", "images", "photos", "train", "test", "validation"}:
                return parent.casefold()
        except (OSError, ValueError, TypeError):
            pass
        return label.casefold()

    def _public_dataset_path_tokens(self, path_text: str | Path) -> list[str]:
        try:
            raw_parts = [str(part) for part in Path(str(path_text)).parts]
        except (OSError, ValueError, TypeError):
            raw_parts = [part for part in re.split(r"[/\\]+", str(path_text))]
        tokens: list[str] = []
        for part in raw_parts:
            part = part.casefold().strip()
            if not part:
                continue
            stem = Path(part).stem if "." in part else part
            tokens.append(part)
            tokens.append(stem)
            tokens.extend(piece for piece in re.split(r"[\s_.-]+", stem) if piece)
        return tokens

    def _public_dataset_has_any_component(self, path_text: str | Path, components: set[str]) -> bool:
        normalized = {component.casefold().replace("_", "-") for component in components}
        for token in self._public_dataset_path_tokens(path_text):
            compact = token.casefold().replace("_", "-")
            if compact in normalized:
                return True
        return False

    def _public_dataset_age_value(self, path_text: str | Path) -> int | None:
        try:
            stem = Path(str(path_text)).stem
        except (OSError, ValueError):
            stem = str(path_text)
        numbers: list[int] = []
        for token in re.split(r"[\s_.-]+", stem):
            if not token.isdigit():
                continue
            value = int(token)
            if 1 <= value <= 99:
                numbers.append(value)
        if len(numbers) >= 2:
            return numbers[-2]
        if numbers:
            return numbers[-1]
        for token in self._public_dataset_path_tokens(path_text):
            match = re.fullmatch(r"age(?:d)?(\d{1,2})", token)
            if match:
                value = int(match.group(1))
                if 1 <= value <= 99:
                    return value
        return None

    def _public_dataset_age_bucket(self, path_text: str | Path) -> str:
        if self._public_dataset_has_any_component(path_text, YOUNG_AGE_COMPONENTS):
            return "young"
        if self._public_dataset_has_any_component(path_text, OLDER_AGE_COMPONENTS):
            return "older"
        age = self._public_dataset_age_value(path_text)
        if age is None:
            return "unknown"
        if age <= 25:
            return "young"
        if age >= 45:
            return "older"
        return "adult"

    def _public_dataset_validation_bucket(
        self,
        dataset_id: str,
        *,
        pose_bucket: str,
        age_bucket: str,
        media_kind: str,
        expected_match: bool,
        source_identity: str,
        expected_identity: str,
    ) -> str:
        dataset_key = dataset_id.casefold()
        media = media_kind.casefold()
        pose = pose_bucket.casefold() or "unknown"
        age = age_bucket.casefold() or "unknown"
        if dataset_key in CROSS_AGE_DATASETS and expected_match:
            return "age:cross-age" if age in {"young", "older", "adult", "unknown"} else f"age:{age}"
        if dataset_key in CROSS_POSE_DATASETS and expected_match:
            return "pose:profile" if pose == "profile" else f"pose:{pose}"
        if dataset_key == "ytf" and media in {"video", "video-frame"}:
            return "media:video"
        if dataset_key == "ijbc":
            if media == "video":
                return "media:video"
            if pose != "unknown":
                return f"pose:{pose}"
            return "dataset:ijbc-template"
        if dataset_key == "fiw" and not expected_match:
            return "expected:non-match"
        if dataset_key in LARGE_DISTRACTOR_DATASETS and not expected_match:
            return "scale:distractor"
        if media == "video":
            return "media:video"
        if pose != "unknown":
            return f"pose:{pose}"
        if not expected_match:
            return "expected:non-match"
        return "expected:match"

    def _public_dataset_difficulty(self, dataset_id: str, validation_bucket: str, *, expected_match: bool) -> str:
        if validation_bucket.startswith("age:"):
            return "cross-age"
        if validation_bucket == "pose:profile":
            return "cross-pose"
        if validation_bucket == "media:video":
            return "video-frame"
        if validation_bucket == "hard-negative:family-lookalike":
            return "family-lookalike"
        if validation_bucket == "scale:distractor":
            return "large-scale-distractor"
        if dataset_id == "ijbc":
            return "mixed-media-template"
        return "identity-match" if expected_match else "non-match"

    def _public_dataset_pose_bucket(self, path_text: str, candidate: ReviewCandidate | None = None) -> str:
        candidate_pose = str(getattr(candidate, "pose_bucket", "") or "").strip().lower().replace("_", "-") if candidate else ""
        if candidate_pose in {"frontal", "three-quarter", "profile"}:
            return candidate_pose
        tokens = self._public_dataset_path_tokens(path_text)
        joined = " ".join(tokens)
        if self._public_dataset_has_any_component(path_text, PROFILE_COMPONENTS) or "side-face" in joined:
            return "profile"
        if self._public_dataset_has_any_component(path_text, FRONTAL_COMPONENTS):
            return "frontal"
        if any(token in {"three-quarter", "three_quarter", "quarter"} for token in tokens):
            return "three-quarter"
        return "unknown"

    def _public_dataset_label_metrics(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        tp = fp = tn = fn = wrong = 0
        for row in rows:
            expected_match = bool(row.get("isMatch"))
            actual_person = str(row.get("actualPerson") or "")
            expected_person = str(row.get("expectedPerson") or "")
            predicted = bool(actual_person)
            correct_identity = predicted and actual_person == expected_person
            if expected_match and correct_identity:
                tp += 1
            elif expected_match and predicted:
                wrong += 1
                fp += 1
                fn += 1
            elif expected_match:
                fn += 1
            elif predicted:
                fp += 1
            else:
                tn += 1
        evaluated = len(rows)
        return {
            "evaluated": evaluated,
            "truePositives": tp,
            "falsePositives": fp,
            "trueNegatives": tn,
            "falseNegatives": fn,
            "wrongIdentity": wrong,
            "precision": round(tp / max(1, tp + fp), 6),
            "recall": round(tp / max(1, tp + fn), 6),
            "specificity": round(tn / max(1, tn + fp), 6),
            "accuracy": round((tp + tn) / max(1, evaluated), 6),
        }

    def _public_dataset_validation_matrix(self, labels: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        bucket_specs: list[tuple[str, str, str, list[dict[str, Any]]]] = [
            ("all", "All cases", "all", labels),
        ]
        for pose in ("frontal", "profile", "three-quarter", "unknown"):
            rows = [row for row in labels if str(row.get("poseBucket") or "unknown") == pose]
            if rows:
                bucket_specs.append((f"pose:{pose}", f"{pose.replace('-', ' ').title()} pose", "pose", rows))
        for media_kind in ("image", "video", "video-frame"):
            rows = [row for row in labels if str(row.get("mediaKind") or "image") == media_kind]
            if rows:
                bucket_specs.append((f"media:{media_kind}", f"{media_kind.title()} media", "media", rows))
        expected_rows = [row for row in labels if bool(row.get("isMatch"))]
        negative_rows = [row for row in labels if not bool(row.get("isMatch"))]
        if expected_rows:
            bucket_specs.append(("expected:match", "Expected matches", "expected", expected_rows))
        if negative_rows:
            bucket_specs.append(("expected:non-match", "Expected non-matches", "expected", negative_rows))
        existing_keys = {key for key, _, _, _ in bucket_specs}
        for bucket in sorted({str(row.get("validationBucket") or "").strip() for row in labels} - {""}):
            if bucket in existing_keys:
                continue
            rows = [row for row in labels if str(row.get("validationBucket") or "").strip() == bucket]
            if rows:
                bucket_specs.append((bucket, self._public_dataset_bucket_label(bucket), bucket.split(":", 1)[0], rows))
                existing_keys.add(bucket)

        matrix: dict[str, dict[str, Any]] = {}
        for key, label, group, rows in bucket_specs:
            metrics = self._public_dataset_label_metrics(rows)
            recommendations: list[str] = []
            if int(metrics["falseNegatives"]):
                recommendations.append("Review detector and embedding coverage for missed expected matches in this bucket.")
            if int(metrics["falsePositives"]):
                recommendations.append("Review thresholds and hard-negative handling for this bucket.")
            if int(metrics["wrongIdentity"]):
                recommendations.append("Wrong-identity matches appeared here; add lookalike and family-negative validation cases.")
            matrix[key] = {
                "key": key,
                "label": label,
                "group": group,
                "count": len(rows),
                **metrics,
                "recommendations": recommendations[:3],
            }
        return matrix

    def _public_dataset_bucket_label(self, bucket: str) -> str:
        labels = {
            "age:cross-age": "Cross-age cases",
            "dataset:ijbc-template": "IJB-C template cases",
            "hard-negative:family-lookalike": "Family-lookalike negatives",
            "scale:distractor": "Large-scale distractors",
        }
        if bucket in labels:
            return labels[bucket]
        if ":" in bucket:
            group, value = bucket.split(":", 1)
            return f"{value.replace('-', ' ').title()} {group.replace('-', ' ')}"
        return bucket.replace("-", " ").title()

    def _public_dataset_threshold_metrics(self, labels: list[dict[str, Any]], thresholds: Any) -> dict[str, dict[str, Any]]:
        values = {
            "reviewMore": float(getattr(thresholds, "relaxed_child", 0.20)),
            "likely": float(getattr(thresholds, "likely", 0.28)),
            "strong": float(getattr(thresholds, "confident", 0.40)),
        }
        result: dict[str, dict[str, Any]] = {}
        for name, threshold in values.items():
            tp = fp = tn = fn = wrong = 0
            for row in labels:
                expected_match = bool(row.get("isMatch"))
                actual_person = str(row.get("actualPerson") or "")
                expected_person = str(row.get("expectedPerson") or "")
                score = float(row.get("matchScore") or 0.0)
                predicted = bool(actual_person) and score >= threshold
                correct_identity = predicted and actual_person == expected_person
                if expected_match and correct_identity:
                    tp += 1
                elif expected_match and predicted:
                    wrong += 1
                    fp += 1
                    fn += 1
                elif expected_match:
                    fn += 1
                elif predicted:
                    fp += 1
                else:
                    tn += 1
            result[name] = {
                "threshold": round(threshold, 6),
                "evaluated": len(labels),
                "truePositives": tp,
                "falsePositives": fp,
                "trueNegatives": tn,
                "falseNegatives": fn,
                "wrongIdentity": wrong,
                "precision": round(tp / max(1, tp + fp), 6),
                "recall": round(tp / max(1, tp + fn), 6),
                "specificity": round(tn / max(1, tn + fp), 6),
                "accuracy": round((tp + tn) / max(1, len(labels)), 6),
            }
        return result

    def _public_dataset_recommendations(
        self,
        dataset_id: str,
        precision: float,
        recall: float,
        false_positives: int,
        false_negatives: int,
        wrong_identity: int,
        scan_errors: list[str],
        metrics_by_threshold: dict[str, dict[str, Any]] | None = None,
        video_decode_failures: list[dict[str, Any]] | None = None,
    ) -> list[str]:
        recommendations: list[str] = []
        likely_metrics = (metrics_by_threshold or {}).get("likely", {})
        video_decode_failure_count = len(video_decode_failures or [])
        if false_positives:
            if int(likely_metrics.get("falsePositives", 0) or 0) == 0:
                recommendations.append("False positives appeared only in the broad review queue; the Likely threshold separated this sample.")
            else:
                recommendations.append("False positives appeared at the Likely threshold; raise matching thresholds or review hard-negative handling.")
        if false_negatives:
            recommendations.append("False negatives appeared in the public dataset run; check detector size, image quality, and cross-age/profile coverage.")
        if dataset_id in CROSS_AGE_DATASETS and recall < 0.85:
            recommendations.append("Cross-age recall is below target; add multi-age references and compare pose-aware model packs before lowering thresholds.")
        if dataset_id in CROSS_POSE_DATASETS and recall < 0.80:
            recommendations.append("Cross-pose recall is below target; compare the stronger profile-aware model pack and keep side-profile references for key people.")
        if dataset_id in LARGE_DISTRACTOR_DATASETS:
            recommendations.append("Use this run to stress distractor false positives, review pagination, and million-file indexing before release.")
        if dataset_id == "ijbc":
            recommendations.append("IJB-C-style runs mix stills and videos; inspect video-frame errors separately from still-image misses.")
        if wrong_identity:
            recommendations.append("Some images matched the wrong identity; inspect family-lookalike and similar-celebrity cases before bulk actions.")
        if scan_errors:
            recommendations.append("Some dataset files could not be decoded; inspect the report and confirm dataset layout/format support.")
        if video_decode_failure_count:
            recommendations.append(f"{video_decode_failure_count} video file(s) could not be decoded into benchmark frames; fix decoder coverage before judging video recall.")
        if dataset_id == "ytf":
            recommendations.append("For video-only datasets, include still-image references per identity or benchmark video frame extraction separately.")
        if dataset_id == "fiw" and false_positives:
            recommendations.append("Family-lookalike false positives appeared; keep bulk actions behind review and raise the Likely threshold if needed.")
        if precision >= 0.9 and recall >= 0.8 and not recommendations:
            recommendations.append("Public dataset benchmark is within the expected range for this sample.")
        if not recommendations:
            recommendations.append("Public dataset benchmark completed; increase max identities for a stronger estimate.")
        return recommendations[:8]
