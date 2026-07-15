"""Integrity, inference, review-flow, and persistence tests for ML-07."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import tempfile
from typing import Iterator
import zipfile

import numpy as np
from PIL import Image, ImageDraw

import crossage_fr.enroll.manager as manager_module
from crossage_fr.api_server import DesktopApi
from crossage_fr.enroll import ProjectState
from crossage_fr.enroll.synthetic_screen import (
    CLASSIFIER_SHA256,
    MANIFEST_SHA256,
    MODEL_ID,
    MODEL_VERSION,
    PROVENANCE_SHA256,
    SyntheticScreenResult,
    _preprocess,
    _reset_caches_for_test,
    crop_enrollment_face,
    jpeg_stability_view,
    screen_enrollment_face,
    synthetic_enrollment_screen_report,
)
from crossage_fr.models import EmbeddingResult


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "synthetic-screen"
VISION_MODEL = ROOT / "models" / "semantic" / "vision_model_uint8.onnx"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unit_vector(index: int = 0) -> list[float]:
    vector = np.zeros(512, dtype=np.float32)
    vector[index] = 1.0
    return vector.tolist()


def make_face(path: Path, color: tuple[int, int, int] = (190, 155, 125)) -> None:
    image = Image.new("RGB", (256, 256), (38, 64, 92))
    draw = ImageDraw.Draw(image)
    draw.ellipse((55, 28, 201, 210), fill=color)
    draw.ellipse((94, 91, 110, 108), fill=(24, 25, 30))
    draw.ellipse((146, 91, 162, 108), fill=(24, 25, 30))
    draw.arc((92, 120, 164, 170), 15, 165, fill=(105, 45, 58), width=5)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="JPEG", quality=94)


class FakeEngine:
    model_name = "unit-face-model"
    detector_size = 640

    def __init__(self, bbox: tuple[int, int, int, int] = (55, 28, 201, 210)) -> None:
        self.bbox = bbox
        self.calls = 0

    def embed_loaded_image(self, _image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        self.calls += 1
        return [
            EmbeddingResult(
                vector=unit_vector(),
                quality=0.94,
                bbox=self.bbox,
                model_name=self.model_name,
                pose_bucket="frontal",
                det_score=0.99,
                ied_px=48.0,
                fiqa_score=0.94,
            )
        ]

    def embed_image(self, path: Path) -> list[EmbeddingResult]:
        with Image.open(path) as image:
            return self.embed_loaded_image(image, path)


def screen_result(flagged: bool, score: float | None = None) -> SyntheticScreenResult:
    stable = float(score if score is not None else (0.98 if flagged else 0.08))
    return SyntheticScreenResult(
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
        stable_score=stable,
        original_score=min(0.999, stable + 0.01),
        recompressed_score=stable,
        review_threshold=0.95,
        flagged_for_review=flagged,
    )


@contextmanager
def patched_screen(value: SyntheticScreenResult | Exception) -> Iterator[None]:
    original = manager_module.screen_enrollment_face

    def replacement(*_args: object, **_kwargs: object) -> SyntheticScreenResult:
        if isinstance(value, Exception):
            raise value
        return value

    manager_module.screen_enrollment_face = replacement
    try:
        yield
    finally:
        manager_module.screen_enrollment_face = original


def make_project(root: Path) -> ProjectState:
    registry = root / "registry"
    os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    project.config.two_pass_scan = False
    project.set_consent(True, source="unit", operator="unit", scope="synthetic-screen-unit")
    return project


def test_release_artifacts_are_verified_deterministic_and_runtime_ready() -> None:
    assert sha256_file(MODEL_DIR / "classifier.npz") == CLASSIFIER_SHA256
    assert sha256_file(MODEL_DIR / "manifest.json") == MANIFEST_SHA256
    assert sha256_file(MODEL_DIR / "training-provenance.json") == PROVENANCE_SHA256
    manifest = json.loads((MODEL_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["modelId"] == MODEL_ID and manifest["version"] == MODEL_VERSION
    assert manifest["artifact"]["format"] == "numpy-npz-no-pickle"
    assert manifest["excludedModel"]["id"] == "Wolowolo/fsfm-3c"
    assert "CC-BY-NC-4.0" in manifest["excludedModel"]["reason"]
    provenance = json.loads((MODEL_DIR / "training-provenance.json").read_text(encoding="utf-8"))
    assert len(provenance["sources"]["wikimediaCongressPublicDomain"]["items"]) == 262
    assert len(provenance["sources"]["synVisV0"]["items"]) == 480
    assert len(provenance["sources"]["sfhqT2i"]["items"]) == 120
    assert provenance["privacy"] == {
        "faceEmbeddingsBundled": False,
        "sourceImagesBundled": False,
        "userWorkspaceMediaUsed": False,
    }
    with zipfile.ZipFile(MODEL_DIR / "classifier.npz") as archive:
        assert {item.date_time for item in archive.infolist()} == {(1980, 1, 1, 0, 0, 0)}
        assert {item.filename for item in archive.infolist()} == {"bias.npy", "coef.npy", "mean.npy", "scale.npy"}
    report = synthetic_enrollment_screen_report(validate_runtime=True)
    assert report["available"] is True and report["verified"] is True, report
    assert report["engine"] == "onnx-cpu-linear", report
    assert report["action"] == "stage-for-human-review", report


def test_real_model_runs_offline_and_uses_stable_minimum_score() -> None:
    image = Image.new("RGB", (320, 240), (70, 110, 150))
    draw = ImageDraw.Draw(image)
    draw.ellipse((80, 25, 240, 220), fill=(210, 170, 135))
    original_socket = socket.socket
    original_connection = socket.create_connection

    def blocked(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("Synthetic enrollment screen attempted network access")

    socket.socket = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        result = screen_enrollment_face(image, (80, 25, 240, 220))
    finally:
        socket.socket = original_socket  # type: ignore[assignment]
        socket.create_connection = original_connection  # type: ignore[assignment]
    assert 0.0 <= result.stable_score <= 1.0
    assert result.stable_score == min(result.original_score, result.recompressed_score)
    assert result.flagged_for_review == (result.stable_score >= result.review_threshold)
    assert result.model_id == MODEL_ID and result.model_version == MODEL_VERSION


def test_crop_recompression_and_preprocessing_are_bounded_and_deterministic() -> None:
    image = Image.new("RGBA", (200, 120), (10, 20, 30, 200))
    crop = crop_enrollment_face(image, (-20, 10, 90, 110))
    assert crop.mode == "RGB" and crop.size == (118, 120), crop.size
    first = jpeg_stability_view(crop)
    second = jpeg_stability_view(crop)
    assert first.tobytes() == second.tobytes()
    tensor = _preprocess(first)
    assert tensor.shape == (3, 256, 256) and tensor.dtype == np.float32
    assert np.isfinite(tensor).all() and float(tensor.min()) >= -1.0 and float(tensor.max()) <= 1.0


def _copy_model_root(target: Path) -> None:
    synthetic = target / "synthetic-screen"
    semantic = target / "semantic"
    synthetic.mkdir(parents=True)
    semantic.mkdir(parents=True)
    for filename in ("classifier.npz", "manifest.json", "training-provenance.json", "README.md", "LICENSES.md"):
        shutil.copy2(MODEL_DIR / filename, synthetic / filename)
    try:
        (semantic / VISION_MODEL.name).symlink_to(VISION_MODEL)
    except OSError:
        shutil.copy2(VISION_MODEL, semantic / VISION_MODEL.name)


def test_tampering_fails_closed_and_packaged_mode_ignores_override() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-synthetic-integrity-") as temp_name:
        models_root = Path(temp_name) / "models"
        _copy_model_root(models_root)
        classifier = models_root / "synthetic-screen" / "classifier.npz"
        classifier.write_bytes(classifier.read_bytes() + b"tamper")
        with _environment(CROSSAGE_SYNTHETIC_SCREEN_MODELS_ROOT=str(models_root)):
            _reset_caches_for_test()
            report = synthetic_enrollment_screen_report()
            assert report["available"] is False and report["verified"] is False, report
            assert "classifier" in report["reason"].lower(), report

        clean_root = Path(temp_name) / "clean-models"
        _copy_model_root(clean_root)
        manifest = clean_root / "synthetic-screen" / "manifest.json"
        manifest.write_text(manifest.read_text(encoding="utf-8") + " ", encoding="utf-8")
        with _environment(CROSSAGE_SYNTHETIC_SCREEN_MODELS_ROOT=str(clean_root)):
            _reset_caches_for_test()
            report = synthetic_enrollment_screen_report()
            assert report["available"] is False and "manifest" in report["reason"].lower(), report

        with _environment(
            CROSSAGE_SYNTHETIC_SCREEN_MODELS_ROOT=str(models_root),
            CROSSAGE_PACKAGED_BACKEND="1",
        ):
            _reset_caches_for_test()
            report = synthetic_enrollment_screen_report()
            assert report["available"] is True and report["verified"] is True, report
    _reset_caches_for_test()


@contextmanager
def _environment(**values: str) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_enrollment_passes_or_stages_without_conflating_review_with_error() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-synthetic-enroll-") as temp_name:
        root = Path(temp_name)
        source = root / "real.jpg"
        make_face(source)
        project = make_project(root)
        with patched_screen(screen_result(False)):
            added, errors, reviews = project.enroll_paths("Alice", "adult", [source], FakeEngine())
        assert (added, errors, reviews) == (1, [], 0)
        reference = next(iter(project.references.values()))
        assert reference.synthetic_screen_score == 0.08
        assert reference.synthetic_screen_model_id == MODEL_ID
        assert reference.synthetic_screen_reviewed is False

        staged_source = root / "synthetic.jpg"
        make_face(staged_source, (205, 170, 145))
        with patched_screen(screen_result(True)):
            added, errors, reviews = project.enroll_paths("Bob", "adult", [staged_source], FakeEngine())
            duplicate_added, duplicate_errors, duplicate_reviews = project.enroll_paths("Bob", "adult", [staged_source], FakeEngine())
        assert (added, errors, reviews) == (0, [], 1)
        assert (duplicate_added, duplicate_errors, duplicate_reviews) == (0, [], 1)
        status = project.synthetic_enrollment_review_status()
        staged = [item for item in status["artifacts"] if item["status"] == "staged"]
        assert len(staged) == 1, status
        payload_json = json.dumps(staged[0]["payload"], sort_keys=True)
        assert "vector" not in payload_json.lower() and "embedding" not in payload_json.lower()
        assert staged[0]["payload"]["reviewReason"] == "score-threshold"
        assert staged[0]["metrics"]["stableScore"] == 0.98

        unavailable_source = root / "unavailable.jpg"
        make_face(unavailable_source, (175, 150, 130))
        with patched_screen(RuntimeError("unit screen unavailable")):
            unavailable_added, unavailable_errors, unavailable_reviews = project.enroll_paths(
                "Carol", "adult", [unavailable_source], FakeEngine()
            )
        assert (unavailable_added, unavailable_errors, unavailable_reviews) == (0, [], 1)
        status = project.synthetic_enrollment_review_status()
        unavailable = next(item for item in status["artifacts"] if item["payload"]["personName"] == "Carol")
        assert unavailable["payload"]["reviewReason"] == "screen-unavailable"
        assert unavailable["metrics"]["stableScore"] is None

        api = DesktopApi(project.root)
        state = api.state(preview_create_budget=0)
        assert len(state["syntheticEnrollmentReviews"]) == 2
        assert state["syntheticEnrollmentScreen"]["verified"] is True
        assert state["references"][0]["syntheticScreenModelId"] == MODEL_ID
        command_status = api.handle("synthetic_enrollment_screen_status", {})
        assert command_status["model"]["verified"] is True
        runtime = api.runtime_self_test()
        runtime_check = next(item for item in runtime["checks"] if item["name"] == "Synthetic enrollment screen")
        assert runtime_check["ok"] is True, runtime_check


def test_approval_rechecks_hash_consent_face_and_score_then_persists_override() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-synthetic-approve-") as temp_name:
        root = Path(temp_name)
        source = root / "held.jpg"
        make_face(source)
        project = make_project(root)
        with patched_screen(screen_result(True)):
            assert project.enroll_paths("Dana", "adult", [source], FakeEngine()) == (0, [], 1)
        artifact = project.synthetic_enrollment_review_status()["artifacts"][0]
        artifact_id = artifact["artifactId"]

        source.write_bytes(source.read_bytes() + b"changed")
        with patched_screen(screen_result(True)):
            try:
                project.approve_synthetic_enrollment_review(
                    artifact_id,
                    FakeEngine(),
                    allow_synthetic_override=True,
                    operator="unit",
                )
            except ValueError as exc:
                assert "changed" in str(exc).lower(), exc
            else:
                raise AssertionError("Changed enrollment source was approved")
        make_face(source)
        # Re-stage against the restored source hash because the original artifact
        # correctly remains bound to the changed hash.
        project.reject_synthetic_enrollment_review(artifact_id, reason="source changed in unit test")
        with patched_screen(screen_result(True)):
            assert project.enroll_paths("Dana", "adult", [source], FakeEngine()) == (0, [], 1)
        artifact_id = next(
            item["artifactId"]
            for item in project.synthetic_enrollment_review_status()["artifacts"]
            if item["status"] == "staged"
        )

        project.set_consent(False, source="unit", operator="unit")
        with patched_screen(screen_result(True)):
            try:
                project.approve_synthetic_enrollment_review(
                    artifact_id,
                    FakeEngine(),
                    allow_synthetic_override=True,
                )
            except PermissionError:
                pass
            else:
                raise AssertionError("Enrollment review was approved after consent withdrawal")
        project.set_consent(True, source="unit", operator="unit", scope="synthetic-screen-unit")

        with patched_screen(screen_result(True, 0.97)):
            try:
                project.approve_synthetic_enrollment_review(artifact_id, FakeEngine())
            except ValueError as exc:
                assert "override" in str(exc).lower(), exc
            else:
                raise AssertionError("Flagged enrollment was approved without explicit override")
            result = project.approve_synthetic_enrollment_review(
                artifact_id,
                FakeEngine(),
                allow_synthetic_override=True,
                operator="unit-reviewer",
            )
        assert result["approved"] is True and result["humanOverride"] is True
        reference = project.references[result["refId"]]
        assert reference.synthetic_screen_reviewed is True
        assert reference.synthetic_screen_human_override is True
        assert reference.synthetic_screen_score == 0.97
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "promoted"
        project.save()
        reloaded = ProjectState(project.root)
        persisted = reloaded.references[result["refId"]]
        assert persisted.synthetic_screen_human_override is True
        assert persisted.synthetic_screen_model_version == MODEL_VERSION


def test_rejection_and_backup_round_trip_preserve_review_state() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-synthetic-backup-") as temp_name:
        root = Path(temp_name)
        project = make_project(root)
        first = root / "first.jpg"
        second = root / "second.jpg"
        make_face(first)
        make_face(second, (180, 145, 120))
        with patched_screen(screen_result(True)):
            project.enroll_paths("Erin", "adult", [first], FakeEngine())
            project.enroll_paths("Frank", "adult", [second], FakeEngine())
        rows = project.synthetic_enrollment_review_status()["artifacts"]
        reject_id = next(item["artifactId"] for item in rows if item["payload"]["personName"] == "Erin")
        pending_id = next(item["artifactId"] for item in rows if item["payload"]["personName"] == "Frank")
        api = DesktopApi(project.root)
        rejected_command = api.handle(
            "reject_synthetic_enrollment_review",
            {"artifactId": reject_id, "reason": "unit rejection"},
        )
        assert rejected_command["value"]["rejected"] is True
        assert project.db.learned_artifact_by_id(reject_id)["status"] == "rejected"

        backup = project.export_workspace_backup(root / "backups")
        assert backup["zipPath"]
        restore_root = root / "restored"
        restored = project.restore_workspace_backup(Path(backup["zipPath"]), restore_root)
        assert restored["ok"] is True, restored
        restored_project = ProjectState(restore_root)
        assert restored_project.db.learned_artifact_by_id(reject_id)["status"] == "rejected"
        assert restored_project.db.learned_artifact_by_id(pending_id)["status"] == "staged"


def test_benchmark_report_records_claim_boundary_and_required_gates() -> None:
    report_path = ROOT / "benchmarks" / "results" / "synthetic-enrollment-screen-benchmark-20260712.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["artifactSha256"] == CLASSIFIER_SHA256
    assert report["manifestSha256"] == MANIFEST_SHA256
    assert report["provenanceSha256"] == PROVENANCE_SHA256
    assert report["combinedRealOod"]["count"] == 1680
    assert report["combinedRealOod"]["rate"] <= 0.006
    assert report["heldOutReal"]["count"] == 43
    assert report["heldOutReal"]["rate"] == 0.0
    assert report["synthetic"]["syn-vis-test"]["rate"] >= 0.98
    assert report["synthetic"]["sfhq-test"]["rate"] >= 0.80
    assert report["synthetic"]["wikimedia-ai-ood"]["rate"] < 0.50
    assert "never identity proof" in report["claimBoundary"]
    assert report["reproducibility"]["splitHashes"]


def main() -> None:
    test_release_artifacts_are_verified_deterministic_and_runtime_ready()
    test_real_model_runs_offline_and_uses_stable_minimum_score()
    test_crop_recompression_and_preprocessing_are_bounded_and_deterministic()
    test_tampering_fails_closed_and_packaged_mode_ignores_override()
    test_enrollment_passes_or_stages_without_conflating_review_with_error()
    test_approval_rechecks_hash_consent_face_and_score_then_persists_override()
    test_rejection_and_backup_round_trip_preserve_review_state()
    test_benchmark_report_records_claim_boundary_and_required_gates()
    print("synthetic enrollment screen units ok")


if __name__ == "__main__":
    main()
