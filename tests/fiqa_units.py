"""Production eDifFIQA(T) integrity, preprocessing, and inference tests."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import tempfile
from unittest.mock import patch

import cv2
import numpy as np

from crossage_fr.embed.fiqa import (
    FIQA_LICENSE,
    FIQA_MODEL_ID,
    FIQA_MODEL_SHA256,
    FiqaIntegrityError,
    FiqaScorer,
    _session_for_model,
    effective_quality,
    find_fiqa_model,
    fiqa_model_report,
    load_fiqa_scorer,
    verify_fiqa_model,
)
from crossage_fr.embed.engine import InsightFaceEmbeddingEngine


ROOT = Path(__file__).resolve().parents[1]
FIQA_DIR = ROOT / "models" / "fiq"


def _copy_model_pack(root: Path) -> Path:
    target = root / "models" / "fiq"
    target.mkdir(parents=True)
    for filename in ("ediffiqa_tiny_jun2024.onnx", "manifest.json", "LICENSE"):
        shutil.copy2(FIQA_DIR / filename, target / filename)
    return target / "ediffiqa_tiny_jun2024.onnx"


def _procedural_aligned_face() -> np.ndarray:
    image = np.full((112, 112, 3), (116, 152, 182), dtype=np.uint8)
    cv2.ellipse(image, (56, 55), (34, 43), 0, 0, 360, (168, 198, 232), -1)
    cv2.circle(image, (43, 48), 4, (42, 35, 35), -1)
    cv2.circle(image, (69, 48), 4, (42, 35, 35), -1)
    cv2.ellipse(image, (56, 69), (15, 7), 0, 10, 170, (55, 55, 120), 2)
    return image


def test_bundled_model_is_attributed_verified_and_runtime_ready() -> None:
    model = find_fiqa_model()
    assert model is not None, "bundled eDifFIQA(T) model was not discovered"
    info = verify_fiqa_model(model)
    assert info["verified"] is True, info
    assert info["modelId"] == FIQA_MODEL_ID, info
    assert info["sha256"] == FIQA_MODEL_SHA256, info
    assert info["license"] == FIQA_LICENSE, info
    assert Path(info["licensePath"]).is_file(), info
    report = fiqa_model_report(validate_runtime=True)
    assert report["available"] is True and report["runtimeReady"] is True, report
    assert report["engine"] == "onnxruntime-cpu", report


def test_explicit_empty_root_has_honest_fallback() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-fiqa-empty-") as temp:
        root = Path(temp)
        assert find_fiqa_model(root) is None
        report = fiqa_model_report(root)
        assert report["available"] is False, report
        assert "missing" in report["reason"].lower(), report


def test_model_and_license_tampering_are_rejected() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-fiqa-integrity-") as temp:
        root = Path(temp)
        model = _copy_model_pack(root)
        assert find_fiqa_model(root) == model.resolve()
        model.write_bytes(model.read_bytes() + b"tamper")
        try:
            verify_fiqa_model(model)
        except FiqaIntegrityError as exc:
            assert "size mismatch" in str(exc).lower(), exc
        else:
            raise AssertionError("tampered FIQA model passed integrity verification")
        report = fiqa_model_report(root)
        assert report["available"] is False, report
        assert report["integrityErrors"], report

        model = _copy_model_pack(root / "license-case")
        (model.parent / "LICENSE").write_text("changed", encoding="utf-8")
        try:
            verify_fiqa_model(model)
        except FiqaIntegrityError as exc:
            assert "license" in str(exc).lower(), exc
        else:
            raise AssertionError("FIQA pack with changed attribution license passed")


def test_manifest_pin_matches_repository_metadata() -> None:
    manifest = json.loads((FIQA_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["modelId"] == FIQA_MODEL_ID
    assert manifest["sha256"] == FIQA_MODEL_SHA256
    assert manifest["license"] == FIQA_LICENSE
    assert manifest["licenseSha256"] == "9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94"
    assert manifest["input"] == {
        "name": "input",
        "shape": ["batch_size", 3, 112, 112],
        "color": "RGB",
        "range": [-1.0, 1.0],
        "layout": "NCHW",
    }


def test_preprocessing_matches_opencv_model_contract() -> None:
    class CaptureSession:
        def __init__(self) -> None:
            self.tensor: np.ndarray | None = None

        def run(self, _outputs: object, feed: dict[str, np.ndarray]) -> list[np.ndarray]:
            self.tensor = feed["input"]
            return [np.asarray([[0.75]], dtype=np.float32)]

    session = CaptureSession()
    scorer = FiqaScorer(session, "input")
    bgr = np.zeros((112, 112, 3), dtype=np.uint8)
    bgr[:, :] = (0, 127, 255)
    assert scorer.score_aligned(bgr) == 0.75
    assert session.tensor is not None
    tensor = session.tensor
    assert tensor.shape == (1, 3, 112, 112), tensor.shape
    assert tensor.dtype == np.float32 and tensor.flags.c_contiguous
    assert abs(float(tensor[0, 0, 0, 0]) - 1.0) < 1e-6  # RGB red
    assert abs(float(tensor[0, 1, 0, 0]) - ((127.0 / 127.5) - 1.0)) < 1e-6
    assert abs(float(tensor[0, 2, 0, 0]) + 1.0) < 1e-6  # RGB blue


def test_invalid_runtime_output_is_rejected() -> None:
    class BadSession:
        def __init__(self, output: np.ndarray):
            self.output = output

        def run(self, _outputs: object, _feed: dict[str, np.ndarray]) -> list[np.ndarray]:
            return [self.output]

    image = np.zeros((112, 112, 3), dtype=np.uint8)
    for output in (
        np.asarray([[float("nan")]], dtype=np.float32),
        np.asarray([[0.1, 0.2]], dtype=np.float32),
    ):
        try:
            FiqaScorer(BadSession(output), "input").score_aligned(image)
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid FIQA output was accepted")


def test_real_model_runs_offline_and_demotes_degraded_faces() -> None:
    model = find_fiqa_model()
    assert model is not None
    _session_for_model.cache_clear()
    original_socket = socket.socket
    original_connection = socket.create_connection

    def blocked(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("FIQA attempted network access")

    socket.socket = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        scorer = load_fiqa_scorer(model)
        assert scorer is not None
        face = _procedural_aligned_face()
        blurred = cv2.GaussianBlur(face, (21, 21), 8)
        occluded = face.copy()
        occluded[:, 40:80] = 0
        face_score = scorer.score_aligned(face)
        blur_score = scorer.score_aligned(blurred)
        occluded_score = scorer.score_aligned(occluded)
    finally:
        socket.socket = original_socket  # type: ignore[assignment]
        socket.create_connection = original_connection  # type: ignore[assignment]

    assert abs(face_score - 0.5160775) < 1e-5, face_score
    assert face_score > occluded_score > blur_score, (face_score, occluded_score, blur_score)
    assert scorer.model_info["verified"] is True


def test_live_engine_alignment_path_uses_bundled_fiqa() -> None:
    scorer = load_fiqa_scorer(find_fiqa_model())
    assert scorer is not None
    engine = object.__new__(InsightFaceEmbeddingEngine)
    engine.fiqa = scorer
    landmarks = np.asarray(
        [
            [38.2946, 51.6963],
            [73.5318, 51.5014],
            [56.0252, 71.7366],
            [41.5493, 92.3655],
            [70.7299, 92.2041],
        ],
        dtype=np.float32,
    )
    score = engine._fiqa_score(_procedural_aligned_face(), landmarks)
    assert score is not None and 0.0 < score < 1.0, score
    assert effective_quality(0.99, score) == score


def test_packaged_mode_ignores_environment_model_override() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-fiqa-env-") as temp:
        malicious = Path(temp) / "ediffiqa_tiny_jun2024.onnx"
        malicious.write_bytes(b"not a model")
        with patch.dict(
            os.environ,
            {
                "CROSSAGE_PACKAGED_BACKEND": "1",
                "CROSSAGE_FIQA_MODEL": str(malicious),
                "CROSSAGE_FIQA_ALLOW_UNVERIFIED": "1",
            },
        ):
            discovered = find_fiqa_model()
            assert discovered is not None
            assert discovered.resolve() != malicious.resolve()
            assert verify_fiqa_model(discovered)["verified"] is True


def test_effective_quality_prefers_fiqa_else_norm() -> None:
    assert effective_quality(0.50, 0.80) == 0.80
    assert effective_quality(0.50, None) == 0.50
    assert effective_quality(0.50, 1.5) == 1.0
    assert effective_quality(0.50, -0.2) == 0.0


def main() -> None:
    test_bundled_model_is_attributed_verified_and_runtime_ready()
    test_explicit_empty_root_has_honest_fallback()
    test_model_and_license_tampering_are_rejected()
    test_manifest_pin_matches_repository_metadata()
    test_preprocessing_matches_opencv_model_contract()
    test_invalid_runtime_output_is_rejected()
    test_real_model_runs_offline_and_demotes_degraded_faces()
    test_live_engine_alignment_path_uses_bundled_fiqa()
    test_packaged_mode_ignores_environment_model_override()
    test_effective_quality_prefers_fiqa_else_norm()
    print("fiqa units ok")


if __name__ == "__main__":
    main()
