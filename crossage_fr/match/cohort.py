"""Integrity-checked fixed synthetic cohorts for symmetric AS-Norm."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np


COHORT_ID = "syn-vis-v0-balanced-60"
COHORT_VERSION = "2026-07-12.1"
COHORT_MANIFEST_SHA256 = "857d421d17a2112afacfa870bb05ee5c77a1d3dd482d4eb05ef848399210fb8d"
COHORT_SOURCE_REVISION = "100262732989e77f38cd831d70a376a93735006a"
COHORT_SOURCE_IMAGE_LICENSE = "CC0-1.0"
COHORT_SOURCE_CURATION_LICENSE = "CC-BY-SA-4.0"
COHORT_PACKS: dict[str, dict[str, Any]] = {
    "antelopev2": {
        "filename": "antelopev2.npy",
        "sha256": "97ea6ec7d69d3c18768db2b9939a34510bffa851802677d37d50ffa40f906082",
        "sizeBytes": 123008,
        "recognizerFilename": "glintr100.onnx",
        "recognizerSha256": "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf",
    },
    "buffalo_l": {
        "filename": "buffalo_l.npy",
        "sha256": "80820d68d3729a11ff39f202d35d2ad212d44bf0b2494e6a7a6728a6679166cf",
        "sizeBytes": 123008,
        "recognizerFilename": "w600k_r50.onnx",
        "recognizerSha256": "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
    },
}


class CohortIntegrityError(RuntimeError):
    """Raised when the fixed cohort or its provenance metadata drifts."""


@dataclass(frozen=True, slots=True)
class FixedCohort:
    model_pack: str
    version: str
    vectors: np.ndarray
    path: Path
    report: dict[str, Any]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _unique_paths(paths: list[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        try:
            key = str(path.expanduser().resolve())
        except OSError:
            key = str(path.expanduser())
        if key not in seen:
            seen.add(key)
            result.append(Path(key))
    return result


def cohort_directories(root: Path | None = None) -> list[Path]:
    if root is not None:
        explicit = Path(root).expanduser()
        return _unique_paths([explicit / "models" / "cohort", explicit])
    directories: list[Path] = []
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        directories.append(Path(bundle_root) / "models" / "cohort")
    executable = Path(sys.executable).resolve()
    for parent in (executable.parent, executable.parent.parent):
        directories.append(parent / "models" / "cohort")
    directories.append(Path(__file__).resolve().parents[2] / "models" / "cohort")
    if not _is_packaged():
        directories.append(Path.cwd() / "models" / "cohort")
    return _unique_paths(directories)


def model_pack_for_name(model_name: str) -> str:
    value = str(model_name or "").strip().casefold()
    if "antelopev2" in value or "glintr100" in value:
        return "antelopev2"
    if "buffalo_l" in value or "w600k_r50" in value:
        return "buffalo_l"
    return ""


def _manifest_for(directory: Path) -> tuple[Path, dict[str, Any]]:
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise CohortIntegrityError(f"Fixed-cohort manifest is missing: {manifest_path}")
    if _sha256(manifest_path) != COHORT_MANIFEST_SHA256:
        raise CohortIntegrityError("Fixed-cohort manifest checksum mismatch")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CohortIntegrityError(f"Fixed-cohort manifest is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise CohortIntegrityError("Fixed-cohort manifest must be a JSON object")
    source = manifest.get("source")
    expected = {
        "schemaVersion": 1,
        "cohortId": COHORT_ID,
        "cohortVersion": COHORT_VERSION,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise CohortIntegrityError(f"Fixed-cohort manifest {key} mismatch")
    if not isinstance(source, dict):
        raise CohortIntegrityError("Fixed-cohort source provenance is missing")
    if source.get("revision") != COHORT_SOURCE_REVISION:
        raise CohortIntegrityError("Fixed-cohort source revision mismatch")
    if source.get("imageLicense") != COHORT_SOURCE_IMAGE_LICENSE:
        raise CohortIntegrityError("Fixed-cohort source image license mismatch")
    if source.get("curationLicense") != COHORT_SOURCE_CURATION_LICENSE:
        raise CohortIntegrityError("Fixed-cohort source curation license mismatch")
    return manifest_path, manifest


def verify_fixed_cohort(model_name: str, root: Path | None = None) -> dict[str, Any]:
    model_pack = model_pack_for_name(model_name)
    if not model_pack:
        raise CohortIntegrityError(f"No fixed cohort supports model {model_name!r}")
    expected_pack = COHORT_PACKS[model_pack]
    errors: list[str] = []
    for directory in cohort_directories(root):
        try:
            manifest_path, manifest = _manifest_for(directory)
            packs = manifest.get("packs")
            if not isinstance(packs, list):
                raise CohortIntegrityError("Fixed-cohort pack list is missing")
            pack = next((row for row in packs if isinstance(row, dict) and row.get("modelPack") == model_pack), None)
            if not isinstance(pack, dict):
                raise CohortIntegrityError(f"Fixed-cohort manifest has no {model_pack} pack")
            for key, value in expected_pack.items():
                if pack.get(key) != value:
                    raise CohortIntegrityError(f"Fixed-cohort {model_pack} {key} mismatch")
            if pack.get("count") != 60 or pack.get("dimension") != 512 or pack.get("dtype") != "float32":
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} shape metadata mismatch")
            cohort_path = directory / str(expected_pack["filename"])
            if not cohort_path.is_file():
                raise CohortIntegrityError(f"Fixed-cohort vectors are missing: {cohort_path}")
            if cohort_path.stat().st_size != int(expected_pack["sizeBytes"]):
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} size mismatch")
            if _sha256(cohort_path) != expected_pack["sha256"]:
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} checksum mismatch")
            vectors = np.load(cohort_path, allow_pickle=False, mmap_mode="r")
            if vectors.shape != (60, 512) or vectors.dtype != np.float32:
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} array contract mismatch")
            if not np.isfinite(vectors).all():
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} contains non-finite vectors")
            norms = np.linalg.norm(vectors, axis=1)
            if not np.allclose(norms, 1.0, atol=1e-5, rtol=0.0):
                raise CohortIntegrityError(f"Fixed-cohort {model_pack} vectors are not unit normalized")
            return {
                "ok": True,
                "verified": True,
                "cohortId": COHORT_ID,
                "cohortVersion": COHORT_VERSION,
                "modelPack": model_pack,
                "count": 60,
                "dimension": 512,
                "path": str(cohort_path),
                "manifestPath": str(manifest_path),
                "sha256": str(expected_pack["sha256"]),
                "sourceRevision": COHORT_SOURCE_REVISION,
                "sourceImageLicense": COHORT_SOURCE_IMAGE_LICENSE,
                "sourceCurationLicense": COHORT_SOURCE_CURATION_LICENSE,
            }
        except (CohortIntegrityError, OSError, ValueError) as exc:
            errors.append(str(exc))
    detail = "; ".join(errors[-3:]) if errors else "No fixed-cohort directory was found"
    raise CohortIntegrityError(detail)


def load_fixed_cohort(model_name: str, root: Path | None = None) -> FixedCohort:
    report = verify_fixed_cohort(model_name, root)
    path = Path(str(report["path"]))
    vectors = np.asarray(np.load(path, allow_pickle=False), dtype="float32")
    vectors.setflags(write=False)
    return FixedCohort(
        model_pack=str(report["modelPack"]),
        version=COHORT_VERSION,
        vectors=vectors,
        path=path,
        report=report,
    )


def fixed_cohort_report(model_name: str, root: Path | None = None) -> dict[str, Any]:
    try:
        return verify_fixed_cohort(model_name, root)
    except CohortIntegrityError as exc:
        return {
            "ok": False,
            "verified": False,
            "cohortId": COHORT_ID,
            "cohortVersion": COHORT_VERSION,
            "modelPack": model_pack_for_name(model_name),
            "error": str(exc),
        }
