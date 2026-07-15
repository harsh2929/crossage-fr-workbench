#!/usr/bin/env python3
"""Train and audit the review-only synthetic enrollment screen.

This tool never downloads data. It consumes locally authorized embedding packs
whose ``vectors`` and ``paths`` arrays were produced with the pinned SigLIP 2
vision encoder. Source images are needed only to measure the deterministic JPEG
stability gate used by the runtime.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import platform
import sys
from time import monotonic
from typing import Any
import zipfile

import numpy as np
from PIL import Image


MODEL_ID = "vintrace-siglip2-linear-synthetic-screen"
MODEL_VERSION = "2026-07-12.1"
VISION_MODEL_ID = "google/siglip2-base-patch16-256"
VISION_SHA256 = "f2eb8ccfa3dc0b3761d9ea9a39554fe0f2be71b247ad7f68a80720ec88895650"
SYN_VIS_REVISION = "100262732989e77f38cd831d70a376a93735006a"
SFHQ_VERSION = 1
IMAGE_SIZE = 256
JPEG_QUALITY = 78
FALSE_REVIEW_QUANTILE = 0.995
LOGISTIC_C = 0.003


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def write_deterministic_npz(path: Path, arrays: dict[str, np.ndarray]) -> None:
    """Write an NPZ without wall-clock ZIP metadata so release hashes reproduce."""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(arrays):
            buffer = io.BytesIO()
            np.save(buffer, np.asarray(arrays[name]), allow_pickle=False)
            info = zipfile.ZipInfo(f"{name}.npy", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, buffer.getvalue(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def load_pack(path: Path) -> tuple[np.ndarray, list[str]]:
    with np.load(path, allow_pickle=False) as pack:
        vectors = np.asarray(pack["vectors"], dtype=np.float32)
        paths = [str(item) for item in np.asarray(pack["paths"]).tolist()]
    if vectors.ndim != 2 or vectors.shape[1] != 768 or len(paths) != len(vectors):
        raise ValueError(f"Invalid embedding pack shape: {path} -> {vectors.shape}, {len(paths)} paths")
    if not np.isfinite(vectors).all():
        raise ValueError(f"Embedding pack contains non-finite values: {path}")
    return vectors, paths


def pack_digest(vectors: np.ndarray, paths: list[str]) -> str:
    digest = hashlib.sha256()
    digest.update(np.ascontiguousarray(vectors, dtype=np.float32).tobytes())
    for value in paths:
        digest.update(Path(value).name.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def split_digest(paths: list[str], labels: list[str]) -> str:
    return canonical_hash([{"file": Path(path).name, "split": label} for path, label in zip(paths, labels)])


def read_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def manifest_items_by_filename(value: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in value.get("items", []):
        if not isinstance(item, dict):
            continue
        raw_path = str(item.get("path", item.get("datasetFile", "")) or "")
        if raw_path:
            result[Path(raw_path).name] = item
    return result


def modulo_splits(count: int, modulus: int, train_values: set[int], validation_value: int, test_value: int) -> list[str]:
    result: list[str] = []
    for index in range(count):
        remainder = index % modulus
        if remainder in train_values:
            result.append("train")
        elif remainder == validation_value:
            result.append("validation")
        elif remainder == test_value:
            result.append("test")
        else:
            raise ValueError(f"Split configuration did not assign index {index}.")
    return result


def sfhq_generator(path: str) -> str:
    name = Path(path).name
    return name.split("_image_", 1)[0] if "_image_" in name else "unknown"


def sfhq_splits(paths: list[str]) -> list[str]:
    offsets: dict[str, int] = defaultdict(int)
    result: list[str] = []
    for path in paths:
        generator = sfhq_generator(path)
        index = offsets[generator]
        offsets[generator] += 1
        remainder = index % 4
        result.append("train" if remainder < 2 else "validation" if remainder == 2 else "test")
    return result


def preprocess(image: Image.Image) -> np.ndarray:
    rgb = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    array = (array - 0.5) / 0.5
    return np.transpose(array, (2, 0, 1)).astype(np.float32)


def jpeg_stability_view(image: Image.Image) -> Image.Image:
    from io import BytesIO

    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=False, progressive=False)
    buffer.seek(0)
    with Image.open(buffer) as decoded:
        return decoded.convert("RGB")


class VisionEncoder:
    def __init__(self, model_path: Path):
        import onnxruntime as ort

        if sha256_file(model_path) != VISION_SHA256:
            raise ValueError("SigLIP 2 vision model checksum does not match the release pin.")
        options = ort.SessionOptions()
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        outputs = [item.name for item in self.session.get_outputs()]
        self.output_name = "pooler_output" if "pooler_output" in outputs else outputs[-1]

    def encode_paths(self, paths: list[str], batch_size: int = 16) -> tuple[np.ndarray, float]:
        rows: list[np.ndarray] = []
        started = monotonic()
        for start in range(0, len(paths), batch_size):
            images: list[np.ndarray] = []
            for value in paths[start:start + batch_size]:
                with Image.open(value) as image:
                    images.append(preprocess(jpeg_stability_view(image)))
            batch = np.stack(images).astype(np.float32)
            pooled = np.asarray(
                self.session.run([self.output_name], {self.input_name: batch})[0],
                dtype=np.float32,
            )
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            rows.append(pooled / np.maximum(norms, 1e-12))
        elapsed_ms = (monotonic() - started) * 1000.0
        return np.concatenate(rows, axis=0), elapsed_ms


def probabilities(vectors: np.ndarray, mean: np.ndarray, scale: np.ndarray, coef: np.ndarray, bias: float) -> np.ndarray:
    logits = ((vectors - mean) / scale) @ coef + bias
    logits = np.clip(logits, -30.0, 30.0)
    return (1.0 / (1.0 + np.exp(-logits))).astype(np.float32)


def metric(scores: np.ndarray, threshold: float, expected_positive: bool) -> dict[str, Any]:
    flagged = int(np.count_nonzero(scores >= threshold))
    count = int(len(scores))
    return {
        "count": count,
        "flagged": flagged,
        "rate": round(flagged / max(1, count), 6),
        "expectedPositive": expected_positive,
        "medianScore": round(float(np.median(scores)), 6) if count else 0.0,
        "maxScore": round(float(np.max(scores)), 6) if count else 0.0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", type=Path, required=True)
    parser.add_argument("--syn-vis", type=Path, required=True)
    parser.add_argument("--sfhq", type=Path, required=True)
    parser.add_argument("--real-ood", type=Path, action="append", default=[], required=True)
    parser.add_argument("--wikimedia-ai", type=Path, required=True)
    parser.add_argument("--vision-model", type=Path, required=True)
    parser.add_argument("--real-manifest", type=Path, required=True)
    parser.add_argument("--sfhq-manifest", type=Path, required=True)
    parser.add_argument("--syn-vis-root", type=Path, required=True)
    parser.add_argument("--wikimedia-manifest", type=Path, required=True)
    parser.add_argument("--artifact-out", type=Path, required=True)
    parser.add_argument("--manifest-out", type=Path, required=True)
    parser.add_argument("--provenance-out", type=Path, required=True)
    parser.add_argument("--report-out", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from sklearn import __version__ as sklearn_version
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    import onnxruntime as ort

    real, real_paths = load_pack(args.real)
    syn_vis, syn_vis_paths = load_pack(args.syn_vis)
    sfhq, sfhq_paths = load_pack(args.sfhq)
    wikimedia, wikimedia_paths = load_pack(args.wikimedia_ai)
    real_splits = modulo_splits(len(real), 6, {0, 1, 2, 3}, 4, 5)
    syn_vis_splits = modulo_splits(len(syn_vis), 6, {0, 1, 2, 3}, 4, 5)
    sfhq_split_labels = sfhq_splits(sfhq_paths)

    real_train = np.asarray([value == "train" for value in real_splits])
    syn_vis_train = np.asarray([value == "train" for value in syn_vis_splits])
    sfhq_train = np.asarray([value == "train" for value in sfhq_split_labels])
    train_x = np.concatenate((real[real_train], syn_vis[syn_vis_train], sfhq[sfhq_train]), axis=0)
    train_y = np.concatenate(
        (
            np.zeros(int(real_train.sum()), dtype=np.int32),
            np.ones(int(syn_vis_train.sum() + sfhq_train.sum()), dtype=np.int32),
        )
    )
    scaler = StandardScaler().fit(train_x)
    classifier = LogisticRegression(C=LOGISTIC_C, max_iter=10_000, random_state=0, solver="lbfgs")
    classifier.fit(scaler.transform(train_x), train_y)
    mean = np.asarray(scaler.mean_, dtype=np.float32)
    scale = np.asarray(scaler.scale_, dtype=np.float32)
    coef = np.asarray(classifier.coef_[0], dtype=np.float32)
    bias = float(classifier.intercept_[0])
    if not all(np.isfinite(value).all() for value in (mean, scale, coef)) or not np.isfinite(bias):
        raise ValueError("Classifier contains non-finite values.")
    if np.any(scale <= 0):
        raise ValueError("Classifier scaler contains a non-positive scale.")

    encoder = VisionEncoder(args.vision_model)
    ood_rows: list[tuple[str, np.ndarray, list[str]]] = []
    for path in args.real_ood:
        vectors, paths = load_pack(path)
        ood_rows.append((path.stem.removeprefix("vintrace-synthetic-screen-real-ood-"), vectors, paths))

    compressed_latency_ms = 0.0
    stable_real_scores: list[np.ndarray] = []
    real_metrics: dict[str, Any] = {}
    for name, vectors, paths in ood_rows:
        compressed, elapsed_ms = encoder.encode_paths(paths)
        compressed_latency_ms += elapsed_ms
        original_scores = probabilities(vectors, mean, scale, coef, bias)
        compressed_scores = probabilities(compressed, mean, scale, coef, bias)
        stable = np.minimum(original_scores, compressed_scores)
        stable_real_scores.append(stable)
        real_metrics[name] = {
            "packDigest": pack_digest(vectors, paths),
            "originalScores": original_scores,
            "stableScores": stable,
        }
    all_stable_real = np.concatenate(stable_real_scores)
    threshold = float(max(0.90, np.quantile(all_stable_real, FALSE_REVIEW_QUANTILE)))

    real_test_mask = np.asarray([value == "test" for value in real_splits])
    real_test_vectors = real[real_test_mask]
    real_test_paths = [path for path, split in zip(real_paths, real_splits) if split == "test"]
    real_test_compressed, elapsed_ms = encoder.encode_paths(real_test_paths)
    compressed_latency_ms += elapsed_ms
    real_test_original = probabilities(real_test_vectors, mean, scale, coef, bias)
    real_test_stable = np.minimum(
        real_test_original,
        probabilities(real_test_compressed, mean, scale, coef, bias),
    )
    held_out_real = {
        **metric(real_test_stable, threshold, False),
        "original": metric(real_test_original, threshold, False),
        "packDigest": pack_digest(real_test_vectors, real_test_paths),
        "source": "Wikimedia Commons Public Domain U.S. Congress portrait test split",
    }

    synthetic_metrics: dict[str, Any] = {}
    synthetic_eval_sets = [
        ("syn-vis-test", syn_vis[np.asarray([value == "test" for value in syn_vis_splits])], [path for path, split in zip(syn_vis_paths, syn_vis_splits) if split == "test"]),
        ("sfhq-test", sfhq[np.asarray([value == "test" for value in sfhq_split_labels])], [path for path, split in zip(sfhq_paths, sfhq_split_labels) if split == "test"]),
        ("wikimedia-ai-ood", wikimedia, wikimedia_paths),
    ]
    for name, vectors, paths in synthetic_eval_sets:
        compressed, elapsed_ms = encoder.encode_paths(paths)
        compressed_latency_ms += elapsed_ms
        original_scores = probabilities(vectors, mean, scale, coef, bias)
        compressed_scores = probabilities(compressed, mean, scale, coef, bias)
        stable = np.minimum(original_scores, compressed_scores)
        synthetic_metrics[name] = {
            **metric(stable, threshold, True),
            "original": metric(original_scores, threshold, True),
            "packDigest": pack_digest(vectors, paths),
        }
        if name == "sfhq-test":
            synthetic_metrics[name]["byGenerator"] = {
                generator: metric(
                    stable[np.asarray([sfhq_generator(path) == generator for path in paths])],
                    threshold,
                    True,
                )
                for generator in sorted({sfhq_generator(path) for path in paths})
            }

    for name, values in real_metrics.items():
        values["stable"] = metric(values.pop("stableScores"), threshold, False)
        values["original"] = metric(values.pop("originalScores"), threshold, False)

    args.artifact_out.parent.mkdir(parents=True, exist_ok=True)
    write_deterministic_npz(
        args.artifact_out,
        {
            "mean": mean,
            "scale": scale,
            "coef": coef,
            "bias": np.asarray(bias, dtype=np.float32),
        },
    )
    artifact_sha256 = sha256_file(args.artifact_out)
    artifact_size = args.artifact_out.stat().st_size
    split_hashes = {
        "realCongress": split_digest(real_paths, real_splits),
        "synVis": split_digest(syn_vis_paths, syn_vis_splits),
        "sfhq": split_digest(sfhq_paths, sfhq_split_labels),
    }
    training_data_hash = canonical_hash(
        {
            "real": pack_digest(real, real_paths),
            "synVis": pack_digest(syn_vis, syn_vis_paths),
            "sfhq": pack_digest(sfhq, sfhq_paths),
            "splits": split_hashes,
        }
    )
    real_source_items = manifest_items_by_filename(read_json_object(args.real_manifest))
    sfhq_source_items = manifest_items_by_filename(read_json_object(args.sfhq_manifest))
    wikimedia_source_items = manifest_items_by_filename(read_json_object(args.wikimedia_manifest))

    congress_provenance: list[dict[str, Any]] = []
    for path_value, split in zip(real_paths, real_splits):
        path = Path(path_value)
        source = real_source_items.get(path.name)
        if source is None:
            raise ValueError(f"Congress provenance is missing {path.name}.")
        actual_hash = sha256_file(path)
        expected_hash = str(source.get("cropSha256", "") or "")
        if actual_hash != expected_hash or str(source.get("license", "")) not in {"Public domain", "CC0", "CC0-1.0"}:
            raise ValueError(f"Congress allowlist hash or license failed for {path.name}.")
        congress_provenance.append(
            {
                "file": path.name,
                "split": split,
                "title": str(source.get("title", "")),
                "sourceUrl": str(source.get("sourceUrl", "")),
                "downloadUrl": str(source.get("downloadUrl", "")),
                "license": str(source.get("license", "")),
                "licenseUrl": str(source.get("licenseUrl", "")),
                "artist": str(source.get("artist", "")),
                "credit": str(source.get("credit", "")),
                "sourceSha256": str(source.get("sha256", "")),
                "cropSha256": expected_hash,
                "cropBox": list(source.get("cropBox", [])),
            }
        )

    syn_vis_provenance: list[dict[str, Any]] = []
    syn_vis_root = args.syn_vis_root.resolve()
    for path_value, split in zip(syn_vis_paths, syn_vis_splits):
        path = Path(path_value).resolve()
        try:
            relative = path.relative_to(syn_vis_root).as_posix()
        except ValueError as exc:
            raise ValueError(f"Syn-Vis path is outside the authorized root: {path}") from exc
        syn_vis_provenance.append(
            {
                "file": relative,
                "split": split,
                "sha256": sha256_file(path),
                "imageLicense": "CC0-1.0",
            }
        )

    sfhq_provenance: list[dict[str, Any]] = []
    for path_value, split in zip(sfhq_paths, sfhq_split_labels):
        path = Path(path_value)
        source = sfhq_source_items.get(path.name)
        if source is None or sha256_file(path) != str(source.get("sha256", "") or ""):
            raise ValueError(f"SFHQ provenance hash failed for {path.name}.")
        sfhq_provenance.append(
            {
                "file": path.name,
                "datasetFile": str(source.get("datasetFile", "")),
                "generator": sfhq_generator(path.name),
                "split": split,
                "sha256": str(source.get("sha256", "")),
                "sizeBytes": int(source.get("bytes", 0) or 0),
                "license": "MIT",
            }
        )

    wikimedia_provenance: list[dict[str, Any]] = []
    for path_value in wikimedia_paths:
        path = Path(path_value)
        source = wikimedia_source_items.get(path.name)
        if source is None or sha256_file(path) != str(source.get("sha256", "") or ""):
            raise ValueError(f"Wikimedia AI-face provenance hash failed for {path.name}.")
        wikimedia_provenance.append(
            {
                "file": path.name,
                "role": "out-of-distribution-evaluation",
                "title": str(source.get("title", "")),
                "sourceUrl": str(source.get("url", "")),
                "sha256": str(source.get("sha256", "")),
                "license": str(source.get("license", "")),
            }
        )

    provenance = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "version": MODEL_VERSION,
        "trainingDataHash": training_data_hash,
        "splitHashes": split_hashes,
        "sources": {
            "wikimediaCongressPublicDomain": {
                "role": "real-training-validation-test",
                "items": congress_provenance,
            },
            "synVisV0": {
                "role": "synthetic-training-validation-test",
                "revision": SYN_VIS_REVISION,
                "imageLicense": "CC0-1.0",
                "curationLicense": "CC-BY-SA-4.0",
                "items": syn_vis_provenance,
            },
            "sfhqT2i": {
                "role": "synthetic-training-validation-test",
                "datasetVersion": SFHQ_VERSION,
                "license": "MIT",
                "items": sfhq_provenance,
            },
            "wikimediaAiFaces": {
                "role": "synthetic-out-of-distribution-evaluation",
                "items": wikimedia_provenance,
            },
        },
        "realOodGates": [
            {
                "id": name,
                "count": len(vectors),
                "packDigest": pack_digest(vectors, paths),
                "role": "threshold-calibration-and-false-review-gate-only",
                "bundled": False,
                "classifierWeightTraining": False,
            }
            for name, vectors, paths in ood_rows
        ],
        "privacy": {
            "sourceImagesBundled": False,
            "faceEmbeddingsBundled": False,
            "userWorkspaceMediaUsed": False,
        },
    }
    args.provenance_out.parent.mkdir(parents=True, exist_ok=True)
    args.provenance_out.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    provenance_sha256 = sha256_file(args.provenance_out)
    manifest = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "version": MODEL_VERSION,
        "purpose": "Review-only enrollment authenticity triage; never identity proof, liveness, PAD, or automatic rejection.",
        "classifierLicense": {
            "spdx": "CC-BY-SA-4.0",
            "attribution": "Vintrace synthetic-enrollment classifier; Syn-Vis-v0 curation by Reto Wyss.",
            "url": "https://creativecommons.org/licenses/by-sa/4.0/",
        },
        "artifact": {
            "filename": args.artifact_out.name,
            "sha256": artifact_sha256,
            "sizeBytes": artifact_size,
            "format": "numpy-npz-no-pickle",
            "dimension": 768,
            "dtype": "float32",
        },
        "provenance": {
            "filename": args.provenance_out.name,
            "sha256": provenance_sha256,
            "sizeBytes": args.provenance_out.stat().st_size,
            "schemaVersion": 1,
        },
        "visionEncoder": {
            "modelId": VISION_MODEL_ID,
            "filename": args.vision_model.name,
            "sha256": VISION_SHA256,
            "sizeBytes": args.vision_model.stat().st_size,
            "license": "Apache-2.0",
            "source": "https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX",
        },
        "decision": {
            "stableScore": "min(original, jpeg-quality-78)",
            "reviewThreshold": round(threshold, 9),
            "calibrationQuantile": FALSE_REVIEW_QUANTILE,
            "calibrationPopulation": "AgeDB, CPLFW, YTF, and FIW local OOD real-face gates; no rows used to fit classifier weights.",
            "action": "stage-for-human-review",
        },
        "training": {
            "algorithm": "StandardScaler + LogisticRegression",
            "C": LOGISTIC_C,
            "solver": "lbfgs",
            "trainingDataHash": training_data_hash,
            "splitHashes": split_hashes,
            "counts": {
                "realCongressTotal": len(real),
                "realCongressTrain": int(real_train.sum()),
                "synVisTotal": len(syn_vis),
                "synVisTrain": int(syn_vis_train.sum()),
                "sfhqTotal": len(sfhq),
                "sfhqTrain": int(sfhq_train.sum()),
            },
        },
        "sources": [
            {
                "id": "wikimedia-commons-us-congress-portraits",
                "role": "real training",
                "license": "Public domain / CC0 per-image allowlist",
                "provenance": "Per-image source URL, author, license, and SHA-256 retained by the training manifest.",
            },
            {
                "id": "retowyss/Syn-Vis-v0",
                "revision": SYN_VIS_REVISION,
                "role": "synthetic training and held-out evaluation",
                "imageLicense": "CC0-1.0",
                "curationLicense": "CC-BY-SA-4.0",
                "source": "https://huggingface.co/datasets/retowyss/Syn-Vis-v0",
            },
            {
                "id": "selfishgene/sfhq-t2i-synthetic-faces-from-text-2-image-models",
                "version": SFHQ_VERSION,
                "role": "synthetic training and generator-stratified held-out evaluation",
                "license": "MIT",
                "source": "https://www.kaggle.com/datasets/selfishgene/sfhq-t2i-synthetic-faces-from-text-2-image-models",
            },
        ],
        "excludedModel": {
            "id": "Wolowolo/fsfm-3c",
            "reason": "Official weights are CC-BY-NC-4.0 and therefore are not bundled in a distributable product.",
            "source": "https://huggingface.co/Wolowolo/fsfm-3c",
        },
        "limitations": [
            "A high score is only a review signal and can be wrong.",
            "The benchmark covers specific generators and portrait datasets, not all edits, cameras, demographics, or future generators.",
            "The model does not establish liveness, presentation-attack resistance, provenance, consent, or identity.",
            "Unavailable or integrity-failed screening must stage enrollment for review instead of silently passing it.",
        ],
    }
    args.manifest_out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    manifest_sha256 = sha256_file(args.manifest_out)

    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "modelId": MODEL_ID,
        "version": MODEL_VERSION,
        "artifactSha256": artifact_sha256,
        "manifestSha256": manifest_sha256,
        "provenanceSha256": provenance_sha256,
        "visionSha256": VISION_SHA256,
        "trainingDataHash": training_data_hash,
        "threshold": round(threshold, 9),
        "stableView": {"jpegQuality": JPEG_QUALITY},
        "realOod": real_metrics,
        "synthetic": synthetic_metrics,
        "combinedRealOod": metric(all_stable_real, threshold, False),
        "heldOutReal": held_out_real,
        "performance": {
            "compressedViewEmbeddingMs": round(compressed_latency_ms, 3),
            "compressedViewImages": int(len(real_test_paths) + sum(len(paths) for _, _, paths in ood_rows) + sum(len(paths) for _, _, paths in synthetic_eval_sets)),
            "meanCompressedViewEmbeddingMs": round(compressed_latency_ms / max(1, len(real_test_paths) + sum(len(paths) for _, _, paths in ood_rows) + sum(len(paths) for _, _, paths in synthetic_eval_sets)), 3),
        },
        "reproducibility": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "numpy": np.__version__,
            "scikitLearn": sklearn_version,
            "onnxruntime": ort.__version__,
            "splitHashes": split_hashes,
        },
        "claimBoundary": manifest["purpose"],
        "limitations": manifest["limitations"],
    }
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "artifact": str(args.artifact_out),
        "artifactSha256": artifact_sha256,
        "manifestSha256": manifest_sha256,
        "provenanceSha256": provenance_sha256,
        "threshold": threshold,
        "combinedRealOod": report["combinedRealOod"],
        "synthetic": synthetic_metrics,
        "report": str(args.report_out),
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
