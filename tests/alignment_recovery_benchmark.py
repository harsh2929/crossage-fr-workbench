"""Real-model A/B benchmark for conservative alignment recovery.

Uses locally prepared CALFW/CPLFW slices and an installed antelopev2 pack. The
benchmark never writes to a Vintrace workspace and never mutates the datasets.

Run: npm run bench:alignment-recovery
"""

from __future__ import annotations

from dataclasses import dataclass
import argparse
import json
import math
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageOps

from crossage_fr.embed.engine import (
    ALIGNMENT_RECOVERY_THRESHOLD,
    InsightFaceEmbeddingEngine,
)
from crossage_fr.embed.fiqa import find_fiqa_model, load_fiqa_scorer
from crossage_fr.match.cohort import load_fixed_cohort


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFESTS = (
    ROOT / "benchmarks" / "public-data" / "prepared" / "calfw-40x4-manifest.json",
    ROOT / "benchmarks" / "public-data" / "prepared" / "cplfw-40x3-manifest.json",
)


@dataclass(slots=True)
class EmbeddingPair:
    before: np.ndarray
    after: np.ndarray
    align_error: float
    attempts: int
    rescued: bool
    strategy: str


def _model_root() -> Path:
    configured = os.environ.get("VINTRACE_ALIGNMENT_BENCH_MODEL_ROOT", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".insightface" / "models" / "antelopev2"


def _dataset_folder(manifest_path: Path, manifest: dict[str, object]) -> Path:
    recorded = Path(str(manifest.get("folder", ""))).expanduser()
    if recorded.is_dir():
        return recorded
    sibling = manifest_path.with_name(manifest_path.stem.removesuffix("-manifest"))
    if sibling.is_dir():
        return sibling
    raise FileNotFoundError(f"Prepared dataset folder is missing for {manifest_path.name}")


def _identity_groups(manifest_path: Path, max_identities: int) -> tuple[str, dict[str, tuple[Path, list[Path]]]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    folder = _dataset_folder(manifest_path, manifest)
    rows = [row for row in manifest.get("identities", []) if isinstance(row, dict) and row.get("role") == "positive"]
    groups: dict[str, tuple[Path, list[Path]]] = {}
    for row in rows[:max_identities]:
        identity_folder = folder / str(row.get("folder", ""))
        images = sorted(path for path in identity_folder.iterdir() if path.is_file())
        if len(images) >= 2:
            groups[str(row.get("identity", identity_folder.name))] = (images[0], images[1:])
    dataset_id = str(manifest.get("datasetId", manifest_path.stem)).strip().lower()
    label = "cross-age" if dataset_id == "calfw" else "cross-pose"
    return f"{dataset_id}-{label}", groups


class AlignmentBenchmark:
    def __init__(self, model_root: Path, detector_threshold: float):
        from insightface.app.common import Face
        from insightface.model_zoo import model_zoo

        detector_path = model_root / "scrfd_10g_bnkps.onnx"
        recognizer_path = model_root / "glintr100.onnx"
        for path in (detector_path, recognizer_path):
            if not path.is_file():
                raise FileNotFoundError(f"Required benchmark model is missing: {path}")
        providers = ["CPUExecutionProvider"]
        self.detector = model_zoo.get_model(str(detector_path), providers=providers)
        self.detector.prepare(-1, input_size=(640, 640), det_thresh=detector_threshold)
        recognizer = model_zoo.get_model(str(recognizer_path), providers=providers)
        recognizer.prepare(-1)
        engine = InsightFaceEmbeddingEngine.__new__(InsightFaceEmbeddingEngine)
        engine.rec_model = recognizer
        engine.model_name = "insightface-antelopev2"
        engine.flip_tta = False
        engine.fiqa = load_fiqa_scorer(find_fiqa_model())
        if engine.fiqa is None:
            raise RuntimeError("Bundled FIQA model is unavailable")
        self.engine = engine
        self.face_class = Face
        self.cohort = np.asarray(load_fixed_cohort("insightface-antelopev2").vectors, dtype="float64")
        self.cache: dict[Path, EmbeddingPair | None] = {}

    def embedding_pair(self, path: Path) -> EmbeddingPair | None:
        if path in self.cache:
            return self.cache[path]
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        bgr = np.asarray(image)[:, :, ::-1]
        boxes, landmarks = self.detector.detect(bgr, max_num=1)
        if boxes.shape[0] == 0 or landmarks is None or landmarks.shape[0] == 0:
            self.cache[path] = None
            return None
        points = landmarks[0]
        original = self.engine._recognition_attempt(bgr, points, strategy="original-5pt")
        before = original.vector.copy()
        after = before.copy()
        attempts = 0
        rescued = False
        strategy = ""
        if original.align_error > ALIGNMENT_RECOVERY_THRESHOLD:
            face = self.face_class(bbox=boxes[0, :4], kps=points, det_score=boxes[0, 4])
            after = self.engine._recognize(bgr, face, points)
            metadata = face._vintrace_alignment
            attempts = int(metadata.get("attempts", 0) or 0)
            rescued = bool(metadata.get("rescued", False))
            strategy = str(metadata.get("strategy", "") or "")
        for name, vector in (("before", before), ("after", after)):
            if vector.ndim != 1 or vector.size != 512 or not np.isfinite(vector).all():
                raise AssertionError(f"{path.name} produced an invalid {name} embedding")
            if not math.isclose(float(np.linalg.norm(vector)), 1.0, rel_tol=0.0, abs_tol=1e-5):
                raise AssertionError(f"{path.name} produced a non-unit {name} embedding")
        pair = EmbeddingPair(before, after, original.align_error, attempts, rescued, strategy)
        self.cache[path] = pair
        return pair


def _tar_at_far(genuine: np.ndarray, impostor: np.ndarray, target_far: float) -> dict[str, float]:
    if genuine.size == 0 or impostor.size == 0:
        return {"threshold": 1.0, "tar": 0.0, "far": 0.0}
    threshold = float(np.quantile(impostor, 1.0 - target_far, method="higher"))
    return {
        "threshold": round(threshold, 6),
        "tar": round(float(np.mean(genuine >= threshold)), 6),
        "far": round(float(np.mean(impostor >= threshold)), 6),
    }


def _cohort_stats(scores: np.ndarray, top_k: int = 20) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(scores, dtype="float64")
    if values.ndim == 1:
        values = values.reshape(1, -1)
    k = max(1, min(int(top_k), values.shape[1]))
    top = np.sort(values, axis=1)[:, ::-1][:, :k]
    return top.mean(axis=1), np.maximum(top.std(axis=1), 0.05)


def _symmetric_as_norm_scores(
    probe: np.ndarray,
    references: np.ndarray,
    raw_scores: np.ndarray,
    cohort: np.ndarray,
) -> np.ndarray:
    probe_mu, probe_sigma = _cohort_stats(cohort @ probe)
    reference_mu, reference_sigma = _cohort_stats(references @ cohort.T)
    probe_z = (raw_scores - probe_mu[0]) / probe_sigma[0]
    reference_z = (raw_scores - reference_mu) / reference_sigma
    normalized = 0.5 * (probe_z + reference_z)
    if not np.isfinite(normalized).all():
        raise AssertionError("symmetric AS-Norm produced a non-finite score")
    return normalized


def _score_slice(
    benchmark: AlignmentBenchmark,
    name: str,
    groups: dict[str, tuple[Path, list[Path]]],
    target_far: float,
) -> dict[str, object]:
    valid: dict[str, tuple[Path, list[Path]]] = {}
    for identity, (reference, probes) in groups.items():
        if benchmark.embedding_pair(reference) is None:
            continue
        available = [path for path in probes if benchmark.embedding_pair(path) is not None]
        if available:
            valid[identity] = (reference, available)
    identities = list(valid)
    if not identities:
        return {"slice": name, "identities": 0, "probes": 0}
    refs_before = np.stack([benchmark.embedding_pair(valid[row][0]).before for row in identities])  # type: ignore[union-attr]
    refs_after = np.stack([benchmark.embedding_pair(valid[row][0]).after for row in identities])  # type: ignore[union-attr]
    outcomes: list[tuple[int, int]] = []
    genuine_before: list[float] = []
    genuine_after: list[float] = []
    impostor_before: list[float] = []
    impostor_after: list[float] = []
    genuine_as_norm: list[float] = []
    impostor_as_norm: list[float] = []
    as_norm_outcomes: list[tuple[int, int]] = []
    as_norm_identity_changes = 0
    predicted_changes = 0
    for identity_index, identity in enumerate(identities):
        for path in valid[identity][1]:
            pair = benchmark.embedding_pair(path)
            assert pair is not None
            before_scores = refs_before @ pair.before
            after_scores = refs_after @ pair.after
            as_norm_scores = _symmetric_as_norm_scores(
                pair.after.astype("float64"),
                refs_after.astype("float64"),
                after_scores.astype("float64"),
                benchmark.cohort,
            )
            before_index = int(np.argmax(before_scores))
            after_index = int(np.argmax(after_scores))
            as_norm_index = int(np.argmax(as_norm_scores))
            outcomes.append((int(before_index == identity_index), int(after_index == identity_index)))
            as_norm_outcomes.append((int(after_index == identity_index), int(as_norm_index == identity_index)))
            predicted_changes += int(before_index != after_index)
            as_norm_identity_changes += int(after_index != as_norm_index)
            genuine_before.append(float(before_scores[identity_index]))
            genuine_after.append(float(after_scores[identity_index]))
            impostor_before.extend(float(value) for index, value in enumerate(before_scores) if index != identity_index)
            impostor_after.extend(float(value) for index, value in enumerate(after_scores) if index != identity_index)
            genuine_as_norm.append(float(as_norm_scores[identity_index]))
            impostor_as_norm.extend(float(value) for index, value in enumerate(as_norm_scores) if index != identity_index)
    outcome_array = np.asarray(outcomes, dtype="int32")
    before_genuine = np.asarray(genuine_before, dtype="float32")
    after_genuine = np.asarray(genuine_after, dtype="float32")
    as_norm_outcome_array = np.asarray(as_norm_outcomes, dtype="int32")
    as_norm_genuine = np.asarray(genuine_as_norm, dtype="float32")
    raw_after_operating_point = _tar_at_far(
        after_genuine,
        np.asarray(impostor_after, dtype="float32"),
        target_far,
    )
    as_norm_operating_point = _tar_at_far(
        as_norm_genuine,
        np.asarray(impostor_as_norm, dtype="float32"),
        target_far,
    )
    return {
        "slice": name,
        "identities": len(identities),
        "probes": len(outcomes),
        "top1Before": round(float(outcome_array[:, 0].mean()), 6),
        "top1After": round(float(outcome_array[:, 1].mean()), 6),
        "top1Improved": int(np.sum((outcome_array[:, 0] == 0) & (outcome_array[:, 1] == 1))),
        "top1Regressed": int(np.sum((outcome_array[:, 0] == 1) & (outcome_array[:, 1] == 0))),
        "predictedIdentityChanges": predicted_changes,
        "genuineMeanBefore": round(float(before_genuine.mean()), 6),
        "genuineMeanAfter": round(float(after_genuine.mean()), 6),
        "genuineP10Before": round(float(np.percentile(before_genuine, 10)), 6),
        "genuineP10After": round(float(np.percentile(after_genuine, 10)), 6),
        "tarAtTargetFarBefore": _tar_at_far(
            before_genuine,
            np.asarray(impostor_before, dtype="float32"),
            target_far,
        ),
        "tarAtTargetFarAfter": _tar_at_far(
            after_genuine,
            np.asarray(impostor_after, dtype="float32"),
            target_far,
        ),
        "asNorm": {
            "cohortCount": int(benchmark.cohort.shape[0]),
            "symmetric": True,
            "top1Raw": round(float(as_norm_outcome_array[:, 0].mean()), 6),
            "top1Normalized": round(float(as_norm_outcome_array[:, 1].mean()), 6),
            "top1Improved": int(np.sum((as_norm_outcome_array[:, 0] == 0) & (as_norm_outcome_array[:, 1] == 1))),
            "top1Regressed": int(np.sum((as_norm_outcome_array[:, 0] == 1) & (as_norm_outcome_array[:, 1] == 0))),
            "predictedIdentityChanges": as_norm_identity_changes,
            "tarAtTargetFarRaw": raw_after_operating_point,
            "tarAtTargetFarNormalized": as_norm_operating_point,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-identities", type=int, default=int(os.environ.get("VINTRACE_ALIGNMENT_BENCH_IDENTITIES", "32")))
    parser.add_argument("--target-far", type=float, default=0.001)
    parser.add_argument("--detector-threshold", type=float, default=0.5)
    parser.add_argument("--require-fixtures", action="store_true")
    args = parser.parse_args()
    manifests = [path for path in DEFAULT_MANIFESTS if path.is_file()]
    if len(manifests) != len(DEFAULT_MANIFESTS):
        if args.require_fixtures:
            raise SystemExit("Prepared CALFW and CPLFW benchmark fixtures are required")
        print(json.dumps({"ok": True, "skipped": True, "reason": "prepared fixtures unavailable"}))
        return
    started = time.perf_counter()
    benchmark = AlignmentBenchmark(_model_root(), args.detector_threshold)
    results = []
    for manifest in manifests:
        name, groups = _identity_groups(manifest, max(2, args.max_identities))
        results.append(_score_slice(benchmark, name, groups, args.target_far))
    records = [row for row in benchmark.cache.values() if row is not None]
    normal_changed = sum(
        int(not np.array_equal(row.before, row.after))
        for row in records
        if row.align_error <= ALIGNMENT_RECOVERY_THRESHOLD
    )
    pipeline = {
        "images": len(benchmark.cache),
        "detected": len(records),
        "detectionRate": round(len(records) / max(1, len(benchmark.cache)), 6),
        "suspect": sum(int(row.align_error > ALIGNMENT_RECOVERY_THRESHOLD) for row in records),
        "rescued": sum(int(row.rescued) for row in records),
        "rejected": sum(int(row.align_error > ALIGNMENT_RECOVERY_THRESHOLD and not row.rescued) for row in records),
        "attempts": sum(row.attempts for row in records),
        "maxAttempts": max((row.attempts for row in records), default=0),
        "changed": sum(int(not np.array_equal(row.before, row.after)) for row in records),
        "normalChanged": normal_changed,
        "strategies": sorted({row.strategy for row in records if row.strategy}),
    }
    failures: list[str] = []
    if normal_changed:
        failures.append("normal-alignment embeddings changed")
    if pipeline["maxAttempts"] > 4:
        failures.append("alternate recognition attempts exceeded the bound")
    for row in results:
        if int(row.get("identities", 0)) < max(2, min(24, args.max_identities)):
            failures.append(f"{row['slice']} had insufficient detected identities")
        if float(row.get("top1After", 0.0)) < float(row.get("top1Before", 0.0)):
            failures.append(f"{row['slice']} regressed top-1 accuracy")
        if int(row.get("top1Regressed", 0)) > int(row.get("top1Improved", 0)):
            failures.append(f"{row['slice']} had more regressed than improved probes")
        as_norm = row.get("asNorm", {}) if isinstance(row.get("asNorm"), dict) else {}
        if float(as_norm.get("top1Normalized", 0.0)) < float(as_norm.get("top1Raw", 0.0)):
            failures.append(f"{row['slice']} fixed-cohort AS-Norm regressed top-1 accuracy")
        if int(as_norm.get("top1Regressed", 0)) > int(as_norm.get("top1Improved", 0)):
            failures.append(f"{row['slice']} fixed-cohort AS-Norm regressed more probes than it improved")
        raw_tar = float((as_norm.get("tarAtTargetFarRaw", {}) or {}).get("tar", 0.0))
        normalized_tar = float((as_norm.get("tarAtTargetFarNormalized", {}) or {}).get("tar", 0.0))
        if normalized_tar < raw_tar:
            failures.append(f"{row['slice']} fixed-cohort AS-Norm regressed TAR at target FAR")
    report = {
        "ok": not failures,
        "model": "antelopev2/glintr100 + bundled eDifFIQA(T) + verified Syn-Vis-v0 cohort",
        "targetFar": args.target_far,
        "results": results,
        "pipeline": pipeline,
        "failures": failures,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }
    print(json.dumps(report, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
