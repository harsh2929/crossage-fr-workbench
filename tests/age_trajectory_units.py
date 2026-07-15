from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import crossage_fr.api_server as api_server_module
from crossage_fr.api_server import DesktopApi
from crossage_fr.config import Thresholds
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import sha256_file
from crossage_fr.match.age_gap import review_threshold_for_gap
from crossage_fr.match.age_trajectory import (
    AGE_TRAJECTORY_METHOD_VERSION,
    AGE_TRAJECTORY_REFERENCE_KIND,
    IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
    age_bucket_for_years,
    build_age_trajectory_candidates,
    spherical_interpolate,
)
from crossage_fr.match.scoring import MatchDecision, apply_verified_age_gap_review, valid_reference
from crossage_fr.models import EmbeddingResult, ReferenceFace
from crossage_fr.photo_generative import (
    AGE_PROGRESS_PROMPT_VERSION,
    CATALOG_SHA256,
    CATALOG_VERSION,
    QWEN_IMAGE_EDIT_REVISION,
    STABLE_DIFFUSION_CPP_REVISION,
    age_progress_prompt_sha256,
)


def unit(*values: float) -> list[float]:
    vector = np.zeros(512, dtype=np.float32)
    vector[: len(values)] = values
    vector /= np.linalg.norm(vector)
    return vector.astype(float).tolist()


def real_ref(ref_id: str, bucket: str, vector: list[float], *, person: str = "Ada", model: str = "insightface-antelopev2/glintr100", quality: float = 0.8, source_path: str = "") -> ReferenceFace:
    return ReferenceFace(
        ref_id=ref_id,
        person_name=person,
        age_bucket=bucket,
        source_path=source_path or f"/{ref_id}.jpg",
        capture_date="2000-01-01",
        quality=quality,
        model_name=model,
        vector=vector,
        source_hash=(ref_id.encode("utf-8").hex() * 64)[:64],
        capture_date_provenance="exif",
    )


def registry(root: Path) -> None:
    os.environ["VINTRACE_REGISTRY_HOME"] = str(root / "registry")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")


class FakeAgeEngine:
    model_name = "insightface-antelopev2/glintr100"

    def __init__(self, generated_vector: list[float] | None = None, generated_faces: int = 1):
        self.generated_vector = generated_vector or unit(0.98, 0.20)
        self.generated_faces = generated_faces

    def embed_image(self, path: Path) -> list[EmbeddingResult]:
        generated = "synthetic-age-images" in path.parts
        if generated:
            return [
                EmbeddingResult(
                    vector=self.generated_vector,
                    quality=0.88,
                    bbox=(20 + index, 20, 108, 108),
                    model_name=self.model_name,
                    pose_bucket="frontal",
                    ied_px=48.0,
                    align_error=0.05,
                )
                for index in range(self.generated_faces)
            ]
        return [
            EmbeddingResult(
                vector=unit(1.0, 0.0),
                quality=0.91,
                bbox=(20, 20, 108, 108),
                model_name=self.model_name,
                pose_bucket="frontal",
                ied_px=48.0,
                align_error=0.04,
            )
        ]


def fake_age_generator(mode, source, target, params, *, root=None, timeout=None):
    assert mode == "age-progress"
    source_path = Path(source)
    target_path = Path(target)
    with Image.open(source_path) as opened:
        opened.convert("RGB").save(target_path, format="PNG")
    source_hash = sha256_file(source_path)
    output_hash = sha256_file(target_path)
    target_ages = {"child": 8, "adolescent": 15, "adult": 33, "older-adult": 57, "senior": 72}
    target_bucket = str(params["targetAgeBucket"])
    provenance = {
        "schemaVersion": 1,
        "aiGenerated": True,
        "offlineInference": True,
        "catalogVersion": CATALOG_VERSION,
        "catalogSha256": CATALOG_SHA256,
        "mode": mode,
        "tier": "heavy",
        "sourceSha256": source_hash,
        "outputSha256": output_hash,
        "model": {
            "id": "Qwen/Qwen-Image-Edit-2511",
            "revision": QWEN_IMAGE_EDIT_REVISION,
            "license": "Apache-2.0",
        },
        "runtime": {
            "id": "stable-diffusion.cpp",
            "tag": "master-775-b5d8120",
            "revision": STABLE_DIFFUSION_CPP_REVISION,
            "license": "MIT",
        },
        "parameters": {
            "aspect": "original",
            "prompt": "",
            "seed": int(params.get("seed", 42)),
            "steps": int(params.get("steps", 20)),
            "cfgScale": 2.5,
            "flowShift": 3,
            "targetAgeBucket": target_bucket,
            "targetAgeYears": target_ages[target_bucket],
            "fixedSafetyPrompt": True,
            "promptVersion": AGE_PROGRESS_PROMPT_VERSION,
            "promptSha256": age_progress_prompt_sha256(target_bucket),
        },
    }
    return {
        "mode": mode,
        "tier": "heavy",
        "outputPath": str(target_path),
        "outputSha256": output_hash,
        "sourceSha256": source_hash,
        "width": 128,
        "height": 128,
        "durationSeconds": 0.01,
        "offlineInference": True,
        "aiGenerated": True,
        "provenance": provenance,
    }


def fake_age_generator_with_wrong_revision(mode, source, target, params, *, root=None, timeout=None):
    result = fake_age_generator(mode, source, target, params, root=root, timeout=timeout)
    result["provenance"]["model"]["revision"] = "0" * 40
    return result


def fake_age_generator_with_wrong_prompt_hash(mode, source, target, params, *, root=None, timeout=None):
    result = fake_age_generator(mode, source, target, params, root=root, timeout=timeout)
    result["provenance"]["parameters"]["promptSha256"] = "0" * 64
    return result


def test_pure_trajectory_generation() -> None:
    refs = [
        real_ref("child-a", "child", unit(1.0, 0.0), quality=0.9),
        real_ref("child-b", "child", unit(0.99, 0.1), quality=0.7),
        real_ref("adult-a", "adult", unit(0.60, 0.80), quality=0.8),
    ]
    rows = build_age_trajectory_candidates(refs)
    assert len(rows) == 1, rows
    row = rows[0]
    assert row.target_age_bucket == "adolescent"
    assert row.left_age_bucket == "child" and row.right_age_bucket == "adult"
    assert len(row.parent_ref_ids) == 3
    assert row.ref_id.startswith("ref_age_") and len(row.derivation_hash) == 64
    assert abs(float(np.linalg.norm(np.asarray(row.vector))) - 1.0) < 1e-6
    assert rows == build_age_trajectory_candidates(reversed(refs))
    assert build_age_trajectory_candidates(refs[:2]) == []
    assert build_age_trajectory_candidates([refs[0], real_ref("other-model", "adult", unit(0.6, 0.8), model="other")]) == []


def test_slerp_and_age_bands() -> None:
    midpoint = spherical_interpolate(unit(1.0, 0.0), unit(0.0, 1.0), 0.5)
    assert midpoint is not None
    assert np.allclose(np.asarray(midpoint)[:2], [2 ** -0.5, 2 ** -0.5], atol=1e-6)
    assert spherical_interpolate(unit(1.0, 0.0), unit(-1.0, 0.0), 0.5) is None
    assert spherical_interpolate(unit(1.0, 0.0), unit(0.0, 1.0), 0.0) is None
    assert [age_bucket_for_years(value) for value in (5, 15, 30, 55, 70, 121)] == [
        "child", "adolescent", "adult", "older-adult", "senior", "unknown"
    ]


def test_project_lifecycle_and_provenance() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        registry(root)
        project = ProjectState(root / "workspace")
        project.set_consent(True, source="test", operator="operator", scope="unit")
        child = real_ref("child", "child", unit(1.0, 0.0))
        adult = real_ref("adult", "adult", unit(0.6, 0.8))
        for ref in (child, adult):
            project.references[ref.ref_id] = ref
            project.vector_store.add(ref.ref_id, ref.vector)
        real_template = project.person_template("Ada")
        result = project.build_age_trajectory_references(
            "Ada", acknowledge_embedding_derivation=True, source="unit"
        )
        assert result["added"] == 1 and result["syntheticReferences"] == 1, result
        synthetic = next(ref for ref in project.references.values() if ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND)
        assert valid_reference(synthetic)
        assert synthetic.capture_date is None
        assert synthetic.capture_date_provenance == AGE_TRAJECTORY_REFERENCE_KIND
        assert synthetic.synthetic_method_version == AGE_TRAJECTORY_METHOD_VERSION
        assert synthetic.parent_ref_ids == ["child", "adult"]
        provenance = synthetic.derivation_provenance
        assert provenance["generatedImage"] is False and provenance["externalAgingWeights"] is False
        assert provenance["consent"]["explicitEmbeddingDerivationAcknowledged"] is True
        assert "operator" not in json.dumps(provenance).casefold()
        assert np.allclose(project.person_template("Ada"), real_template, atol=1e-7)
        assert "Ada" not in project._person_templates(child.model_name)

        repeated = project.build_age_trajectory_references(
            "Ada", acknowledge_embedding_derivation=True, source="unit"
        )
        assert repeated["added"] == 0 and repeated["retained"] == 1
        project.load()
        restored = next(ref for ref in project.references.values() if ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND)
        assert restored.ref_id == synthetic.ref_id and valid_reference(restored)

        project.delete_reference("child")
        assert not any(ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND for ref in project.references.values())


def test_consent_and_api_gates() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        registry(root)
        api = DesktopApi(root / "workspace")
        for ref in (
            real_ref("child", "child", unit(1.0, 0.0)),
            real_ref("adult", "adult", unit(0.6, 0.8)),
        ):
            api.project.references[ref.ref_id] = ref
            api.project.vector_store.add(ref.ref_id, ref.vector)
        try:
            api.handle("build_age_trajectory_references", {"personName": "Ada", "acknowledgeEmbeddingDerivation": True})
            raise AssertionError("consent gate did not fire")
        except PermissionError:
            pass
        api.handle("set_consent", {"value": True})
        try:
            api.handle("build_age_trajectory_references", {"personName": "Ada"})
            raise AssertionError("explicit acknowledgment gate did not fire")
        except ValueError:
            pass
        result = api.handle(
            "build_age_trajectory_references",
            {"personName": "Ada", "acknowledgeEmbeddingDerivation": True},
        )
        assert result["value"]["added"] == 1
        state_ref = next(ref for ref in result["state"]["references"] if ref["referenceKind"] == AGE_TRAJECTORY_REFERENCE_KIND)
        assert state_ref["parentRefIds"] == ["child", "adult"]
        api.handle("set_consent", {"value": False})
        assert not any(ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND for ref in api.project.references.values())


def test_review_only_age_gap_threshold() -> None:
    thresholds = Thresholds(confident=0.4, likely=0.28, relaxed_child=0.20, quality_min=0.15)
    baseline = MatchDecision("Ada", "ref", "/ref.jpg", 0.17, "below-review")
    reviewed = apply_verified_age_gap_review(baseline, thresholds, 9.0, "very-low")
    assert reviewed.band == "cross-age maybe"
    assert "verified-cross-age-threshold" in reviewed.flags
    assert reviewed.score == baseline.score
    assert apply_verified_age_gap_review(baseline, thresholds, 9.0, "estimated") == baseline
    assert apply_verified_age_gap_review(baseline, thresholds, 3.0, "moderate") == baseline
    assert apply_verified_age_gap_review(MatchDecision("Ada", "ref", "/ref.jpg", 0.30, "likely"), thresholds, 20.0, "very-low").band == "likely"
    assert review_threshold_for_gap(0.20, 9.0, "very-low") == 0.16
    assert review_threshold_for_gap(0.20, 5.0, "low") == 0.18
    assert review_threshold_for_gap(0.20, 9.0, "estimated") == 0.20


def test_model_switch_and_repair_invalidation() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        registry(root)
        child_path = root / "child.jpg"
        adult_path = root / "adult.jpg"
        child_path.write_bytes(b"child")
        adult_path.write_bytes(b"adult")
        api = DesktopApi(root / "workspace")
        api.handle("set_consent", {"value": True})
        for ref in (
            real_ref("child", "child", unit(1.0, 0.0), source_path=str(child_path)),
            real_ref("adult", "adult", unit(0.6, 0.8), source_path=str(adult_path)),
        ):
            api.project.references[ref.ref_id] = ref
            api.project.vector_store.add(ref.ref_id, ref.vector)
        api.project.build_age_trajectory_references(
            "Ada", acknowledge_embedding_derivation=True, source="unit"
        )
        stale = api.project.model_compatibility_report("insightface-buffalo_l/w600k_r50")
        assert stale["staleSyntheticAgeReferences"] == 1
        assert stale["needsAgeTrajectoryRebuild"] is True
        pending = api.project._pending_backfill_references("insightface-buffalo_l/w600k_r50")
        assert {ref.ref_id for ref in pending} == {"child", "adult"}

        adult_path.unlink()
        preview = api.project.repair_workspace(dry_run=True, force=True)
        assert preview["removedDependentSyntheticAgeReferences"] == 1, preview
        assert preview["removedReferences"] == 2, preview
        applied = api.project.repair_workspace(dry_run=False, force=True)
        assert applied["removedDependentSyntheticAgeReferences"] == 1
        assert "adult" not in api.project.references
        assert not any(ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND for ref in api.project.references.values())

        # Recreate a bridge and prove a recognizer-pack switch removes it rather
        # than leaving an unusable derivative in the gallery.
        adult_path.write_bytes(b"adult")
        adult = real_ref("adult-2", "adult", unit(0.6, 0.8), source_path=str(adult_path))
        api.project.references[adult.ref_id] = adult
        api.project.vector_store.add(adult.ref_id, adult.vector)
        api.project.build_age_trajectory_references(
            "Ada", acknowledge_embedding_derivation=True, source="unit"
        )
        assert any(ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND for ref in api.project.references.values())
        api.handle("save_settings", {"modelPack": "buffalo_l"})
        assert not any(ref.reference_kind == AGE_TRAJECTORY_REFERENCE_KIND for ref in api.project.references.values())


def age_image_project(root: Path) -> tuple[ProjectState, ReferenceFace]:
    registry(root)
    source = root / "ada-adult.png"
    Image.new("RGB", (128, 128), (120, 90, 70)).save(source)
    project = ProjectState(root / "workspace")
    project.set_consent(
        True,
        source="test",
        operator="operator",
        scope="unit",
        release={"aiDisclosureAcknowledged": True},
    )
    parent = real_ref(
        "ada-adult",
        "adult",
        unit(1.0, 0.0),
        source_path=str(source),
        quality=0.92,
    )
    parent.source_hash = sha256_file(source)
    other = real_ref(
        "grace-adult",
        "adult",
        unit(0.0, 1.0),
        person="Grace",
        source_path=str(source),
    )
    other.source_hash = parent.source_hash
    for ref in (parent, other):
        project.references[ref.ref_id] = ref
        project.vector_store.add(ref.ref_id, ref.vector)
    return project, parent


def test_synthetic_age_image_review_lifecycle() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, parent = age_image_project(root)
        engine = FakeAgeEngine()
        generated = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
            source="unit",
        )
        assert generated["staged"] == 1 and generated["rejected"] == 0, generated
        assert not any(ref.synthetic_method_version == IMAGE_AGE_AUGMENTATION_METHOD_VERSION for ref in project.references.values())
        artifact_id = generated["artifacts"][0]["artifactId"]
        artifact = project.db.learned_artifact_by_id(artifact_id)
        assert artifact and artifact["status"] == "staged"
        payload = artifact["payload"]
        assert payload["generatedPath"].startswith("synthetic-age-images/")
        assert not Path(payload["generatedPath"]).is_absolute()
        output = project._synthetic_age_image_path(payload["generatedPath"])
        assert output.is_file() and output.parent == project.synthetic_age_images_path
        assert payload["authenticCapture"] is False
        assert payload["futureAppearancePrediction"] is False
        assert payload["consent"]["explicitAgeGenerationAcknowledged"] is True
        assert artifact["metrics"]["reasons"] == []
        assert artifact["metrics"]["targetIdentityCosine"] > 0.9
        assert artifact["metrics"]["identityMargin"] > 0.7

        replay = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        assert replay["staged"] == 0 and replay["skipped"] == 1

        try:
            project.approve_synthetic_age_image_review(artifact_id, engine, operator="reviewer")
            raise AssertionError("explicit visual-review acknowledgement was not required")
        except ValueError as exc:
            assert "visually reviewed" in str(exc)
        approved = project.approve_synthetic_age_image_review(
            artifact_id,
            engine,
            operator="reviewer",
            acknowledge_visual_review=True,
        )
        ref = project.references[approved["refId"]]
        assert ref.synthetic_method_version == IMAGE_AGE_AUGMENTATION_METHOD_VERSION
        assert ref.parent_ref_ids == [parent.ref_id]
        assert ref.derivation_provenance["generatedImage"] is True
        assert ref.derivation_provenance["authenticCapture"] is False
        assert ref.derivation_provenance["humanReviewed"] is True
        assert ref.derivation_provenance["visualReviewAcknowledged"] is True
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "promoted"
        assert project.age_trajectory_status("Ada")["generatedImageReferences"] == 1

        project.set_consent(False, source="test", operator="operator", scope="unit")
        assert approved["refId"] not in project.references
        assert not output.exists()
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"


def test_synthetic_age_image_adversarial_gates() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, parent = age_image_project(root)
        engine = FakeAgeEngine()
        try:
            project.generate_synthetic_age_image_reviews(
                "Ada",
                ["senior"],
                engine,
                fake_age_generator,
                acknowledge_ai_age_generation=False,
            )
            raise AssertionError("explicit AI-age acknowledgement was not required")
        except ValueError as exc:
            assert "AI-generated" in str(exc)

        collision = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["senior"],
            FakeAgeEngine(generated_vector=unit(0.71, 0.70)),
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        assert collision["staged"] == 0 and collision["rejected"] == 1, collision
        rejected_payload = collision["rejectedArtifacts"][0]["payload"]
        assert "impostor-margin-too-small" in collision["rejectedArtifacts"][0]["metrics"]["reasons"]
        assert not project._synthetic_age_image_path(rejected_payload["generatedPath"], require_file=False).exists()

        multiple = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["child"],
            FakeAgeEngine(generated_faces=2),
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        assert multiple["rejected"] == 1
        assert "face-count-not-one" in multiple["rejectedArtifacts"][0]["metrics"]["reasons"]

        staged = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["adolescent"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        artifact_id = staged["artifacts"][0]["artifactId"]
        artifact = project.db.learned_artifact_by_id(artifact_id)
        output = project._synthetic_age_image_path(artifact["payload"]["generatedPath"])
        output.write_bytes(b"tampered")
        try:
            project.approve_synthetic_age_image_review(
                artifact_id,
                engine,
                acknowledge_visual_review=True,
            )
            raise AssertionError("tampered generated image was approved")
        except ValueError as exc:
            assert "changed after generation" in str(exc)
        rejected = project.reject_synthetic_age_image_review(artifact_id, reason="tamper-test")
        assert rejected["fileRemoved"] is True and not output.exists()

        staged_parent = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        parent_artifact_id = staged_parent["artifacts"][0]["artifactId"]
        parent_output = project._synthetic_age_image_path(
            project.db.learned_artifact_by_id(parent_artifact_id)["payload"]["generatedPath"]
        )
        project.delete_reference(parent.ref_id)
        assert not parent_output.exists()
        assert project.db.learned_artifact_by_id(parent_artifact_id)["status"] == "rejected"

        outside = root / "must-remain.png"
        Image.new("RGB", (8, 8), (1, 2, 3)).save(outside)
        malicious_id = "syn_age_img_path_escape"
        project.db.upsert_learned_artifact(
            malicious_id,
            {
                "artifactType": "synthetic_age_image_review",
                "status": "staged",
                "modelName": "fixture",
                "versionKey": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                "metrics": {},
                "payload": {"personName": "Ada", "generatedPath": str(outside)},
            },
        )
        try:
            project.reject_synthetic_age_image_review(malicious_id)
            raise AssertionError("out-of-workspace generated path was accepted")
        except OSError:
            pass
        assert outside.is_file()


def test_synthetic_age_image_recovery_and_erasure() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, parent = age_image_project(root)
        engine = FakeAgeEngine()

        first = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        first_id = first["artifacts"][0]["artifactId"]
        first_path = project._synthetic_age_image_path(first["artifacts"][0]["payload"]["generatedPath"])
        first_path.unlink()
        replacement = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        replacement_id = replacement["artifacts"][0]["artifactId"]
        assert replacement_id != first_id
        assert project.db.learned_artifact_by_id(first_id)["status"] == "rejected"
        assert project.db.learned_artifact_by_id(replacement_id)["status"] == "staged"
        project.reject_synthetic_age_image_review(replacement_id, reason="recovery-test")

        staged = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["child"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        staged_id = staged["artifacts"][0]["artifactId"]
        parent_path = Path(parent.source_path)
        parent_path.write_bytes(b"changed after generation")
        try:
            project.approve_synthetic_age_image_review(
                staged_id,
                engine,
                acknowledge_visual_review=True,
            )
            raise AssertionError("changed parent source was approved")
        except ValueError as exc:
            assert "source photo changed" in str(exc)
        project.reject_synthetic_age_image_review(staged_id, reason="changed-parent")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, _ = age_image_project(root)
        engine = FakeAgeEngine()
        staged = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["senior"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        artifact_id = staged["artifacts"][0]["artifactId"]
        approved = project.approve_synthetic_age_image_review(
            artifact_id,
            engine,
            operator="reviewer",
            acknowledge_visual_review=True,
        )
        generated_path = Path(approved["reference"]["source_path"])
        generated_path.unlink()
        preview = project.repair_workspace(dry_run=True, force=True)
        assert preview["removedReferences"] == 1
        assert preview["rolledBackSyntheticAgeArtifacts"] == 1
        applied = project.repair_workspace(dry_run=False, force=True)
        assert applied["rolledBackSyntheticAgeArtifacts"] == 1
        assert approved["refId"] not in project.references
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, _ = age_image_project(root)
        engine = FakeAgeEngine()
        ada = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["older-adult"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        ada_id = ada["artifacts"][0]["artifactId"]
        project._ensure_generated_dir_sentinel(project.synthetic_age_images_path)
        grace_path = project.synthetic_age_images_path / "grace-review.png"
        Image.new("RGB", (24, 24), (40, 50, 60)).save(grace_path)
        grace_id = "syn_age_img_grace_subject_scope"
        project.db.upsert_learned_artifact(
            grace_id,
            {
                "artifactType": "synthetic_age_image_review",
                "status": "staged",
                "modelName": "fixture",
                "versionKey": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
                "metrics": {},
                "payload": {
                    "personName": "Grace",
                    "generatedPath": str(grace_path),
                    "generatedHash": sha256_file(grace_path),
                },
            },
        )
        erased = project.delete_subject_data("Ada", confirm=True, source="unit")
        assert erased["syntheticAgeImageArtifacts"] == 1
        assert project.db.learned_artifact_by_id(ada_id) is None
        assert project.db.learned_artifact_by_id(grace_id) is not None
        assert grace_path.is_file()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, _ = age_image_project(root)
        engine = FakeAgeEngine()
        staged = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["senior"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        artifact_id = staged["artifacts"][0]["artifactId"]
        approved = project.approve_synthetic_age_image_review(
            artifact_id,
            engine,
            acknowledge_visual_review=True,
        )
        generated_path = Path(approved["reference"]["source_path"])
        project.references[approved["refId"]].derivation_provenance["reviewArtifactHash"] = "0" * 64
        project._mark_reference_dirty(approved["refId"])
        project.save()

        restarted = ProjectState(root / "workspace")
        assert approved["refId"] not in restarted.references
        assert restarted.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"
        assert restarted._synthetic_age_startup_result["removedReferences"] == 1
        assert restarted._synthetic_age_startup_result["removedFiles"] == 1
        assert not generated_path.exists()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project, parent = age_image_project(root)
        engine = FakeAgeEngine()
        staged = project.generate_synthetic_age_image_reviews(
            "Ada",
            ["senior"],
            engine,
            fake_age_generator,
            acknowledge_ai_age_generation=True,
        )
        artifact_id = staged["artifacts"][0]["artifactId"]
        approved = project.approve_synthetic_age_image_review(
            artifact_id,
            engine,
            acknowledge_visual_review=True,
        )
        generated_path = Path(approved["reference"]["source_path"])
        project.references[parent.ref_id].source_hash = "0" * 64
        project._mark_reference_dirty(parent.ref_id)
        project.save()

        restarted = ProjectState(root / "workspace")
        assert approved["refId"] not in restarted.references
        assert restarted.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"
        assert restarted._synthetic_age_startup_result["removedReferences"] == 1
        assert restarted._synthetic_age_startup_result["removedFiles"] == 1
        assert not generated_path.exists()


def test_synthetic_age_image_pinned_provenance() -> None:
    for generator in (fake_age_generator_with_wrong_revision, fake_age_generator_with_wrong_prompt_hash):
        with tempfile.TemporaryDirectory() as tmp:
            project, _ = age_image_project(Path(tmp))
            result = project.generate_synthetic_age_image_reviews(
                "Ada",
                ["senior"],
                FakeAgeEngine(),
                generator,
                acknowledge_ai_age_generation=True,
            )
            assert result["staged"] == 0 and result["rejected"] == 0
            assert len(result["errors"]) == 1
            assert "provenance" in result["errors"][0]["error"]
            assert not list(project.synthetic_age_images_path.glob("*.png"))


def test_synthetic_age_image_api_contract() -> None:
    original_runner = api_server_module.run_photo_generative_edit
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project, _ = age_image_project(root)
            api = DesktopApi(project.root)
            api.project = project
            api._engine = FakeAgeEngine()  # noqa: SLF001
            api_server_module.run_photo_generative_edit = fake_age_generator
            result = api.handle(
                "generate_synthetic_age_image_reviews",
                {
                    "personName": "Ada",
                    "targetAgeBuckets": ["older-adult"],
                    "acknowledgeAiAgeGeneration": True,
                },
            )
            assert result["value"]["staged"] == 1
            reviews = result["state"]["syntheticAgeImageReviews"]
            assert len(reviews) == 1 and reviews[0]["generatedAvailable"] is True
            assert reviews[0]["authenticCapture"] is False
            artifact_id = reviews[0]["artifactId"]
            try:
                api.handle("approve_synthetic_age_image_review", {"artifactId": artifact_id})
                raise AssertionError("API visual-review acknowledgement was not required")
            except ValueError as exc:
                assert "acknowledgeVisualReview" in str(exc)
            try:
                api.handle(
                    "approve_synthetic_age_image_review",
                    {"artifactId": artifact_id, "acknowledgeVisualReview": "false"},
                )
                raise AssertionError("string visual-review acknowledgement was accepted")
            except ValueError as exc:
                assert "visually reviewed" in str(exc)
            approved = api.handle(
                "approve_synthetic_age_image_review",
                {"artifactId": artifact_id, "acknowledgeVisualReview": True},
            )
            assert approved["value"]["approved"] is True
            assert approved["state"]["syntheticAgeImageReviewStatus"]["autoEnrollment"] is False
    finally:
        api_server_module.run_photo_generative_edit = original_runner


def main() -> None:
    test_pure_trajectory_generation()
    test_slerp_and_age_bands()
    test_project_lifecycle_and_provenance()
    test_consent_and_api_gates()
    test_review_only_age_gap_threshold()
    test_model_switch_and_repair_invalidation()
    test_synthetic_age_image_review_lifecycle()
    test_synthetic_age_image_adversarial_gates()
    test_synthetic_age_image_recovery_and_erasure()
    test_synthetic_age_image_pinned_provenance()
    test_synthetic_age_image_api_contract()
    print("age trajectory units ok")


if __name__ == "__main__":
    main()
