"""Build the fixed synthetic AS-Norm cohort distributed with Vintrace.

The source images are downloaded into a temporary/cache directory and are never
copied into the application. Only normalized embeddings and an integrity/provenance
manifest are emitted.

Run:
  PYTHONPATH=. build/venv-production-3.11/bin/python tools/build_face_cohort.py
"""

from __future__ import annotations

import argparse
import csv
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

from crossage_fr.vector_math import l2_normalize


SOURCE_REPOSITORY = "retowyss/Syn-Vis-v0"
SOURCE_REVISION = "100262732989e77f38cd831d70a376a93735006a"
SOURCE_URL = f"https://huggingface.co/datasets/{SOURCE_REPOSITORY}"
SOURCE_IMAGE_LICENSE = "CC0-1.0"
SOURCE_CURATION_LICENSE = "CC-BY-SA-4.0"
PER_CATEGORY = 10
EXPECTED_CATEGORIES = (
    "asian",
    "black",
    "indian",
    "latino hispanic",
    "middle eastern",
    "white",
)
MODEL_SPECS = (
    ("antelopev2", "glintr100.onnx", "antelopev2.npy"),
    ("buffalo_l", "w600k_r50.onnx", "buffalo_l.npy"),
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(relative_path: str, target: Path) -> Path:
    if target.is_file() and target.stat().st_size > 0:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded = "/".join(urllib.parse.quote(part) for part in relative_path.split("/"))
    url = f"{SOURCE_URL}/resolve/{SOURCE_REVISION}/{encoded}"
    with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError(f"Source download was empty: {relative_path}")
    return target


def _selected_sources(cache: Path) -> list[dict[str, str]]:
    metadata_path = _download("metadata.csv", cache / "metadata.csv")
    by_category: dict[str, list[dict[str, str]]] = {}
    with metadata_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            category = str(row.get("dominant_race", "")).strip().casefold()
            filename = Path(str(row.get("file_name", ""))).name
            if category and filename:
                by_category.setdefault(category, []).append({"category": category, "filename": filename})
    selected: list[dict[str, str]] = []
    for category in EXPECTED_CATEGORIES:
        rows = sorted(by_category.get(category, []), key=lambda row: row["filename"])
        if len(rows) < PER_CATEGORY:
            raise RuntimeError(f"Syn-Vis source has only {len(rows)} rows for {category!r}")
        selected.extend(rows[:PER_CATEGORY])
    return selected


def _download_sources(cache: Path, selected: list[dict[str, str]]) -> list[Path]:
    def fetch(row: dict[str, str]) -> Path:
        filename = row["filename"]
        return _download(f"images/headshot/{filename}", cache / "headshots" / filename)

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(fetch, selected))


def _aligned_crops(paths: list[Path], detector_path: Path) -> list[np.ndarray]:
    from insightface.model_zoo import model_zoo
    from insightface.utils import face_align

    detector = model_zoo.get_model(str(detector_path), providers=["CPUExecutionProvider"])
    detector.prepare(-1, input_size=(640, 640), det_thresh=0.5)
    crops: list[np.ndarray] = []
    for path in paths:
        with Image.open(path) as source:
            bgr = np.asarray(source.convert("RGB"))[:, :, ::-1]
        boxes, landmarks = detector.detect(bgr, max_num=0)
        if boxes.shape[0] != 1 or landmarks is None or landmarks.shape[0] != 1:
            raise RuntimeError(f"Expected exactly one face in {path.name}, found {boxes.shape[0]}")
        crop = face_align.norm_crop(bgr, landmarks[0])
        if crop.shape != (112, 112, 3) or not np.isfinite(crop).all():
            raise RuntimeError(f"Invalid aligned crop for {path.name}")
        crops.append(crop)
    return crops


def _recognizer_vectors(crops: list[np.ndarray], recognizer_path: Path) -> np.ndarray:
    from insightface.model_zoo import model_zoo

    recognizer = model_zoo.get_model(str(recognizer_path), providers=["CPUExecutionProvider"])
    recognizer.prepare(-1)
    vectors = []
    for crop in crops:
        vector = np.asarray(recognizer.get_feat(crop), dtype="float32").reshape(-1)
        if vector.size != 512 or not np.isfinite(vector).all():
            raise RuntimeError(f"Recognizer {recognizer_path.name} returned an invalid vector")
        vectors.append(l2_normalize(vector, dtype=np.float32))
    result = np.stack(vectors).astype("float32", copy=False)
    if np.linalg.matrix_rank(result) < min(result.shape):
        raise RuntimeError(f"Recognizer {recognizer_path.name} produced a rank-deficient cohort")
    return result


def _write_npy(path: Path, vectors: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        np.lib.format.write_array(handle, vectors, version=(1, 0), allow_pickle=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("models/cohort"))
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "vintrace-syn-vis-v0")
    parser.add_argument("--insightface-root", type=Path, default=Path.home() / ".insightface" / "models")
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    cache = args.cache.expanduser().resolve()
    model_root = args.insightface_root.expanduser().resolve()
    selected = _selected_sources(cache)
    source_paths = _download_sources(cache, selected)
    detector_path = model_root / "antelopev2" / "scrfd_10g_bnkps.onnx"
    if not detector_path.is_file():
        raise FileNotFoundError(detector_path)
    crops = _aligned_crops(source_paths, detector_path)
    packs: list[dict[str, object]] = []
    for model_pack, recognizer_filename, cohort_filename in MODEL_SPECS:
        recognizer_path = model_root / model_pack / recognizer_filename
        if not recognizer_path.is_file():
            raise FileNotFoundError(recognizer_path)
        vectors = _recognizer_vectors(crops, recognizer_path)
        cohort_path = output / cohort_filename
        _write_npy(cohort_path, vectors)
        packs.append(
            {
                "modelPack": model_pack,
                "recognizerFilename": recognizer_filename,
                "recognizerSha256": _sha256(recognizer_path),
                "filename": cohort_filename,
                "sha256": _sha256(cohort_path),
                "sizeBytes": cohort_path.stat().st_size,
                "count": int(vectors.shape[0]),
                "dimension": int(vectors.shape[1]),
                "dtype": "float32",
            }
        )
    source_rows = [
        {"filename": row["filename"], "sha256": _sha256(path)}
        for row, path in zip(selected, source_paths)
    ]
    manifest = {
        "schemaVersion": 1,
        "cohortId": "syn-vis-v0-balanced-60",
        "cohortVersion": "2026-07-12.1",
        "source": {
            "dataset": "Syn-Vis-v0",
            "repository": SOURCE_REPOSITORY,
            "url": SOURCE_URL,
            "revision": SOURCE_REVISION,
            "imageLicense": SOURCE_IMAGE_LICENSE,
            "curationLicense": SOURCE_CURATION_LICENSE,
            "selection": "First 10 filenames in each automated dominant-feature bucket; labels are not shipped or used at runtime.",
            "selectionCounts": {category: PER_CATEGORY for category in EXPECTED_CATEGORIES},
            "knownLimitations": [
                "Source portraits are female-presenting and concentrated around age 30.",
                "Source portraits have beauty and symmetry bias.",
                "Automated source categories are coverage heuristics, not demographic ground truth.",
            ],
            "items": source_rows,
        },
        "detector": {
            "filename": detector_path.name,
            "sha256": _sha256(detector_path),
            "threshold": 0.5,
            "alignment": "InsightFace five-point norm_crop 112x112",
        },
        "packs": packs,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "packs": packs, "sourceCount": len(source_rows)}, indent=2))


if __name__ == "__main__":
    main()
