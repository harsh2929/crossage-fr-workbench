"""Integrity-pinned, review-only synthetic enrollment screening.

The screen is deliberately separate from face recognition. It uses a bundled
Apache-2.0 SigLIP 2 vision encoder and a tiny provenance-controlled linear head
to decide only whether enrollment needs explicit human review.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from io import BytesIO
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image


MODEL_ID = "vintrace-siglip2-linear-synthetic-screen"
MODEL_VERSION = "2026-07-12.1"
CLASSIFIER_FILENAME = "classifier.npz"
MANIFEST_FILENAME = "manifest.json"
PROVENANCE_FILENAME = "training-provenance.json"
VISION_FILENAME = "vision_model_uint8.onnx"
CLASSIFIER_SHA256 = "32c8bb112b662e4b46f8d89aa908a9d217699e1b65091cd74009a9e49812e189"
MANIFEST_SHA256 = "8b1f2115e1f633b024d6ef84f818db5b9859abba4323474a29ed01c10eb183a0"
PROVENANCE_SHA256 = "bc9f618cb6b586d618c05c29423c567e4373e5b6bf85f8277bf358a6fcaa9cfa"
VISION_SHA256 = "f2eb8ccfa3dc0b3761d9ea9a39554fe0f2be71b247ad7f68a80720ec88895650"
VISION_SIZE_BYTES = 94_737_653
IMAGE_SIZE = 256
JPEG_QUALITY = 78
EMBEDDING_DIMENSION = 768


class SyntheticScreenError(RuntimeError):
    """Base error for an unavailable or invalid screening model."""


class SyntheticScreenIntegrityError(SyntheticScreenError):
    """Raised when a bundled artifact does not match its release pin."""


class SyntheticScreenUnavailableError(SyntheticScreenError):
    """Raised when no complete local model pack can be found."""


@dataclass(frozen=True, slots=True)
class SyntheticScreenResult:
    model_id: str
    model_version: str
    stable_score: float
    original_score: float
    recompressed_score: float
    review_threshold: float
    flagged_for_review: bool
    stability_view: str = "jpeg-quality-78"
    action: str = "stage-for-human-review"

    def payload(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class _ModelSpec:
    manifest_path: Path
    classifier_path: Path
    provenance_path: Path
    vision_path: Path


class _SyntheticScreenModel:
    def __init__(self, spec: _ModelSpec, manifest: dict[str, Any]):
        import onnxruntime as ort

        self.spec = spec
        self.manifest = manifest
        decision = manifest.get("decision") if isinstance(manifest.get("decision"), dict) else {}
        self.threshold = float(decision.get("reviewThreshold", 0.0) or 0.0)
        if not 0.0 < self.threshold < 1.0:
            raise SyntheticScreenIntegrityError("Synthetic-screen threshold is outside (0, 1).")
        try:
            with np.load(spec.classifier_path, allow_pickle=False) as artifact:
                if set(artifact.files) != {"mean", "scale", "coef", "bias"}:
                    raise SyntheticScreenIntegrityError("Synthetic-screen classifier has unexpected arrays.")
                self.mean = self._vector(artifact["mean"], "mean")
                self.scale = self._vector(artifact["scale"], "scale")
                self.coef = self._vector(artifact["coef"], "coef")
                bias = np.asarray(artifact["bias"], dtype=np.float32)
                if bias.shape not in {(), (1,)} or not np.isfinite(bias).all():
                    raise SyntheticScreenIntegrityError("Synthetic-screen classifier bias is invalid.")
                self.bias = float(bias.reshape(-1)[0])
        except (OSError, ValueError) as exc:
            if isinstance(exc, SyntheticScreenIntegrityError):
                raise
            raise SyntheticScreenIntegrityError(f"Synthetic-screen classifier could not be loaded: {exc}") from exc
        if np.any(self.scale <= 0.0):
            raise SyntheticScreenIntegrityError("Synthetic-screen classifier scale must be positive.")

        options = ort.SessionOptions()
        options.log_severity_level = 3
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        try:
            self.session = ort.InferenceSession(
                str(spec.vision_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as exc:
            raise SyntheticScreenUnavailableError(f"Synthetic-screen vision model could not start: {exc}") from exc
        inputs = self.session.get_inputs()
        if len(inputs) != 1:
            raise SyntheticScreenIntegrityError("Synthetic-screen vision model has an unexpected input contract.")
        self.input_name = inputs[0].name
        outputs = [item.name for item in self.session.get_outputs()]
        self.output_name = "pooler_output" if "pooler_output" in outputs else outputs[-1]

    @staticmethod
    def _vector(value: np.ndarray, name: str) -> np.ndarray:
        vector = np.asarray(value, dtype=np.float32)
        if vector.shape != (EMBEDDING_DIMENSION,) or not np.isfinite(vector).all():
            raise SyntheticScreenIntegrityError(f"Synthetic-screen classifier {name} has an invalid shape or value.")
        return vector.copy()

    def score(self, image: Image.Image, bbox: tuple[int, int, int, int] | None) -> SyntheticScreenResult:
        face = crop_enrollment_face(image, bbox)
        stable_view = jpeg_stability_view(face)
        batch = np.stack((_preprocess(face), _preprocess(stable_view))).astype(np.float32)
        try:
            pooled = np.asarray(
                self.session.run([self.output_name], {self.input_name: batch})[0],
                dtype=np.float32,
            )
        except Exception as exc:
            raise SyntheticScreenUnavailableError(f"Synthetic-screen inference failed: {exc}") from exc
        if pooled.shape != (2, EMBEDDING_DIMENSION) or not np.isfinite(pooled).all():
            raise SyntheticScreenIntegrityError("Synthetic-screen vision output has an invalid shape or value.")
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if not np.isfinite(norms).all() or np.any(norms <= 1e-12):
            raise SyntheticScreenIntegrityError("Synthetic-screen vision output has an invalid norm.")
        embeddings = pooled / norms
        logits = ((embeddings - self.mean) / self.scale) @ self.coef + self.bias
        if not np.isfinite(logits).all():
            raise SyntheticScreenIntegrityError("Synthetic-screen classifier produced a non-finite score.")
        scores = [_sigmoid(float(value)) for value in logits]
        stable_score = min(scores)
        return SyntheticScreenResult(
            model_id=MODEL_ID,
            model_version=MODEL_VERSION,
            stable_score=stable_score,
            original_score=scores[0],
            recompressed_score=scores[1],
            review_threshold=self.threshold,
            flagged_for_review=stable_score >= self.threshold,
        )


def _sigmoid(value: float) -> float:
    if value >= 0.0:
        inverse = math.exp(-min(value, 30.0))
        return 1.0 / (1.0 + inverse)
    exp_value = math.exp(max(value, -30.0))
    return exp_value / (1.0 + exp_value)


def crop_enrollment_face(
    image: Image.Image,
    bbox: tuple[int, int, int, int] | None,
    margin_ratio: float = 0.25,
) -> Image.Image:
    rgb = image.convert("RGB")
    if bbox is None or len(bbox) != 4:
        return rgb
    try:
        left, top, right, bottom = (int(value) for value in bbox)
    except (TypeError, ValueError):
        return rgb
    width = max(0, right - left)
    height = max(0, bottom - top)
    if width < 2 or height < 2:
        return rgb
    margin_x = int(round(width * max(0.0, float(margin_ratio))))
    margin_y = int(round(height * max(0.0, float(margin_ratio))))
    crop_box = (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(rgb.width, right + margin_x),
        min(rgb.height, bottom + margin_y),
    )
    if crop_box[2] - crop_box[0] < 2 or crop_box[3] - crop_box[1] < 2:
        return rgb
    return rgb.crop(crop_box)


def jpeg_stability_view(image: Image.Image) -> Image.Image:
    buffer = BytesIO()
    image.convert("RGB").save(
        buffer,
        format="JPEG",
        quality=JPEG_QUALITY,
        optimize=False,
        progressive=False,
    )
    buffer.seek(0)
    with Image.open(buffer) as decoded:
        return decoded.convert("RGB")


def _preprocess(image: Image.Image) -> np.ndarray:
    rgb = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    array = (array - 0.5) / 0.5
    return np.transpose(array, (2, 0, 1)).astype(np.float32)


def screen_enrollment_face(
    image: Image.Image,
    bbox: tuple[int, int, int, int] | None,
) -> SyntheticScreenResult:
    model = _load_model()
    if model is None:
        report = synthetic_enrollment_screen_report()
        raise SyntheticScreenUnavailableError(str(report.get("reason") or "Synthetic enrollment screen is unavailable."))
    return model.score(image, bbox)


def synthetic_enrollment_screen_report(validate_runtime: bool = False) -> dict[str, Any]:
    spec = _find_model_spec()
    if spec is None:
        return {
            "available": False,
            "verified": False,
            "engine": "unavailable",
            "modelId": MODEL_ID,
            "version": MODEL_VERSION,
            "reason": "No complete local synthetic-enrollment screen was found.",
            "action": "stage-for-human-review",
        }
    try:
        manifest = _validated_manifest_for_spec(spec, _spec_token(spec))
        if validate_runtime:
            _model_for_spec(spec, _spec_token(spec))
    except SyntheticScreenError as exc:
        return {
            "available": False,
            "verified": False,
            "engine": "unavailable",
            "modelId": MODEL_ID,
            "version": MODEL_VERSION,
            "reason": str(exc),
            "action": "stage-for-human-review",
        }
    decision = manifest.get("decision") if isinstance(manifest.get("decision"), dict) else {}
    classifier_license = manifest.get("classifierLicense") if isinstance(manifest.get("classifierLicense"), dict) else {}
    return {
        "available": True,
        "verified": True,
        "engine": "onnx-cpu-linear",
        "modelId": MODEL_ID,
        "version": MODEL_VERSION,
        "reviewThreshold": float(decision.get("reviewThreshold", 0.0) or 0.0),
        "stableScore": str(decision.get("stableScore", "")),
        "action": "stage-for-human-review",
        "license": f"Apache-2.0 encoder; {classifier_license.get('spdx', 'unknown')} classifier/provenance",
        "purpose": str(manifest.get("purpose", "")),
        "limitations": list(manifest.get("limitations", [])) if isinstance(manifest.get("limitations"), list) else [],
        "runtimeValidated": bool(validate_runtime),
        "provenanceVerified": True,
    }


def _load_model() -> _SyntheticScreenModel | None:
    spec = _find_model_spec()
    if spec is None:
        return None
    return _model_for_spec(spec, _spec_token(spec))


@lru_cache(maxsize=2)
def _model_for_spec(spec: _ModelSpec, token: tuple[tuple[int, int, int], ...]) -> _SyntheticScreenModel:
    manifest = _validated_manifest_for_spec(spec, token)
    return _SyntheticScreenModel(spec, manifest)


@lru_cache(maxsize=4)
def _validated_manifest_for_spec(spec: _ModelSpec, token: tuple[tuple[int, int, int], ...]) -> dict[str, Any]:
    del token
    return _validate_spec(spec)


def _validate_spec(spec: _ModelSpec) -> dict[str, Any]:
    if _sha256(spec.manifest_path) != MANIFEST_SHA256:
        raise SyntheticScreenIntegrityError("Synthetic-screen manifest checksum does not match the release pin.")
    try:
        manifest = json.loads(spec.manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyntheticScreenIntegrityError(f"Synthetic-screen manifest could not be read: {exc}") from exc
    if not isinstance(manifest, dict):
        raise SyntheticScreenIntegrityError("Synthetic-screen manifest is not an object.")
    artifact = manifest.get("artifact") if isinstance(manifest.get("artifact"), dict) else {}
    provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
    classifier_license = manifest.get("classifierLicense") if isinstance(manifest.get("classifierLicense"), dict) else {}
    vision = manifest.get("visionEncoder") if isinstance(manifest.get("visionEncoder"), dict) else {}
    sources = manifest.get("sources") if isinstance(manifest.get("sources"), list) else []
    source_licenses = {
        str(item.get("license", item.get("imageLicense", "")))
        for item in sources
        if isinstance(item, dict)
    }
    if (
        int(manifest.get("schemaVersion", 0) or 0) != 1
        or manifest.get("modelId") != MODEL_ID
        or manifest.get("version") != MODEL_VERSION
        or artifact.get("filename") != CLASSIFIER_FILENAME
        or artifact.get("sha256") != CLASSIFIER_SHA256
        or int(artifact.get("dimension", 0) or 0) != EMBEDDING_DIMENSION
        or artifact.get("format") != "numpy-npz-no-pickle"
        or classifier_license.get("spdx") != "CC-BY-SA-4.0"
        or provenance.get("filename") != PROVENANCE_FILENAME
        or provenance.get("sha256") != PROVENANCE_SHA256
        or int(provenance.get("schemaVersion", 0) or 0) != 1
        or vision.get("filename") != VISION_FILENAME
        or vision.get("sha256") != VISION_SHA256
        or vision.get("license") != "Apache-2.0"
        or "MIT" not in source_licenses
        or "CC0-1.0" not in source_licenses
    ):
        raise SyntheticScreenIntegrityError("Synthetic-screen manifest metadata does not match the release policy.")
    if spec.classifier_path.stat().st_size != int(artifact.get("sizeBytes", -1) or -1):
        raise SyntheticScreenIntegrityError("Synthetic-screen classifier size does not match its manifest.")
    if _sha256(spec.classifier_path) != CLASSIFIER_SHA256:
        raise SyntheticScreenIntegrityError("Synthetic-screen classifier checksum does not match the release pin.")
    if spec.provenance_path.stat().st_size != int(provenance.get("sizeBytes", -1) or -1):
        raise SyntheticScreenIntegrityError("Synthetic-screen training provenance size does not match its manifest.")
    if _sha256(spec.provenance_path) != PROVENANCE_SHA256:
        raise SyntheticScreenIntegrityError("Synthetic-screen training provenance checksum does not match the release pin.")
    try:
        provenance_payload = json.loads(spec.provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyntheticScreenIntegrityError(f"Synthetic-screen training provenance could not be read: {exc}") from exc
    provenance_sources = provenance_payload.get("sources") if isinstance(provenance_payload, dict) else {}
    provenance_privacy = provenance_payload.get("privacy") if isinstance(provenance_payload, dict) else {}
    training = manifest.get("training") if isinstance(manifest.get("training"), dict) else {}
    if (
        not isinstance(provenance_payload, dict)
        or int(provenance_payload.get("schemaVersion", 0) or 0) != 1
        or provenance_payload.get("modelId") != MODEL_ID
        or provenance_payload.get("version") != MODEL_VERSION
        or provenance_payload.get("trainingDataHash") != training.get("trainingDataHash")
        or not isinstance(provenance_sources, dict)
        or len((provenance_sources.get("wikimediaCongressPublicDomain") or {}).get("items", [])) != 262
        or len((provenance_sources.get("synVisV0") or {}).get("items", [])) != 480
        or len((provenance_sources.get("sfhqT2i") or {}).get("items", [])) != 120
        or provenance_privacy.get("sourceImagesBundled") is not False
        or provenance_privacy.get("faceEmbeddingsBundled") is not False
        or provenance_privacy.get("userWorkspaceMediaUsed") is not False
    ):
        raise SyntheticScreenIntegrityError("Synthetic-screen training provenance does not match the release policy.")
    if spec.vision_path.stat().st_size != VISION_SIZE_BYTES or _sha256(spec.vision_path) != VISION_SHA256:
        raise SyntheticScreenIntegrityError("Synthetic-screen vision model size or checksum does not match the release pin.")
    return manifest


def _find_model_spec() -> _ModelSpec | None:
    for root in _model_roots():
        synthetic_dir = root / "synthetic-screen"
        semantic_dir = root / "semantic"
        manifest = synthetic_dir / MANIFEST_FILENAME
        classifier = synthetic_dir / CLASSIFIER_FILENAME
        provenance = synthetic_dir / PROVENANCE_FILENAME
        vision = semantic_dir / VISION_FILENAME
        if manifest.is_file() and classifier.is_file() and provenance.is_file() and vision.is_file():
            return _ModelSpec(manifest.resolve(), classifier.resolve(), provenance.resolve(), vision.resolve())
    return None


def _model_roots() -> list[Path]:
    roots: list[Path] = []
    if not _is_packaged():
        configured = str(os.environ.get("CROSSAGE_SYNTHETIC_SCREEN_MODELS_ROOT", "") or "").strip()
        if configured:
            roots.append(Path(configured).expanduser())
    source_root = Path(__file__).resolve().parents[2]
    roots.append(source_root / "models")
    if not _is_packaged():
        roots.append(Path.cwd() / "models")
    executable = Path(sys.executable).resolve()
    roots.extend((executable.parent / "models", executable.parent.parent / "models"))
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        roots.append(Path(bundle_root) / "models")
    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        resolved = root.resolve()
        if str(resolved) not in seen:
            seen.add(str(resolved))
            unique.append(resolved)
    return unique


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _stat_token(path: Path) -> tuple[int, int, int]:
    try:
        stat = path.stat()
        return stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns
    except OSError:
        return -1, -1, -1


def _spec_token(spec: _ModelSpec) -> tuple[tuple[int, int, int], ...]:
    return tuple(_stat_token(path) for path in (spec.manifest_path, spec.classifier_path, spec.provenance_path, spec.vision_path))


@lru_cache(maxsize=8)
def _sha256_cached(path: str, token: tuple[int, int, int]) -> str:
    del token
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256(path: Path) -> str:
    try:
        return _sha256_cached(str(path), _stat_token(path))
    except OSError as exc:
        raise SyntheticScreenIntegrityError(f"Synthetic-screen artifact could not be hashed: {exc}") from exc


def _reset_caches_for_test() -> None:
    _model_for_spec.cache_clear()
    _validated_manifest_for_spec.cache_clear()
    _sha256_cached.cache_clear()
