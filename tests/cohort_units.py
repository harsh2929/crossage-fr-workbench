"""Integrity and offline tests for the fixed synthetic AS-Norm cohort."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import socket
import tempfile

import numpy as np

from crossage_fr.match.cohort import (
    COHORT_MANIFEST_SHA256,
    CohortIntegrityError,
    fixed_cohort_report,
    load_fixed_cohort,
    model_pack_for_name,
    verify_fixed_cohort,
)


ROOT = Path(__file__).resolve().parents[1]
COHORT_DIR = ROOT / "models" / "cohort"


def _copy_pack(target: Path) -> Path:
    destination = target / "models" / "cohort"
    shutil.copytree(COHORT_DIR, destination)
    return destination


def test_real_cohort_packs_verify_and_load_offline() -> None:
    original_socket = socket.socket
    original_connection = socket.create_connection

    def blocked(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("fixed cohort attempted network access")

    socket.socket = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        antelope = load_fixed_cohort("insightface-antelopev2")
        buffalo = load_fixed_cohort("insightface-buffalo_l")
    finally:
        socket.socket = original_socket  # type: ignore[assignment]
        socket.create_connection = original_connection  # type: ignore[assignment]
    for cohort, model_pack in ((antelope, "antelopev2"), (buffalo, "buffalo_l")):
        assert cohort.model_pack == model_pack
        assert cohort.vectors.shape == (60, 512)
        assert cohort.vectors.dtype == np.float32
        assert np.allclose(np.linalg.norm(cohort.vectors, axis=1), 1.0, atol=1e-5)
        assert cohort.vectors.flags.writeable is False
        assert cohort.report["verified"] is True


def test_model_space_routing_is_explicit() -> None:
    assert model_pack_for_name("insightface-antelopev2") == "antelopev2"
    assert model_pack_for_name("glintr100") == "antelopev2"
    assert model_pack_for_name("insightface-buffalo_l") == "buffalo_l"
    assert model_pack_for_name("w600k_r50") == "buffalo_l"
    assert model_pack_for_name("unknown") == ""
    try:
        load_fixed_cohort("unknown-model")
        raise AssertionError("unsupported model should fail closed")
    except CohortIntegrityError:
        pass


def test_manifest_and_vector_tampering_fail_closed() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-cohort-tamper-") as temp:
        root = Path(temp)
        directory = _copy_pack(root)
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        manifest["source"]["imageLicense"] = "unknown"
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        try:
            verify_fixed_cohort("antelopev2", root)
            raise AssertionError("tampered manifest should fail")
        except CohortIntegrityError as exc:
            assert "manifest" in str(exc).lower() or "checksum" in str(exc).lower()

    with tempfile.TemporaryDirectory(prefix="vintrace-cohort-vector-") as temp:
        root = Path(temp)
        directory = _copy_pack(root)
        path = directory / "antelopev2.npy"
        payload = bytearray(path.read_bytes())
        payload[-1] ^= 0x01
        path.write_bytes(payload)
        try:
            verify_fixed_cohort("antelopev2", root)
            raise AssertionError("tampered vectors should fail")
        except CohortIntegrityError as exc:
            assert "checksum" in str(exc).lower()


def test_report_is_bounded_and_manifest_pin_matches() -> None:
    import hashlib

    actual = hashlib.sha256((COHORT_DIR / "manifest.json").read_bytes()).hexdigest()
    assert actual == COHORT_MANIFEST_SHA256
    report = fixed_cohort_report("insightface-antelopev2")
    assert report["ok"] is True
    assert report["count"] == 60 and report["dimension"] == 512
    missing = fixed_cohort_report("unsupported")
    assert missing["ok"] is False
    assert len(str(missing["error"])) < 1000


def test_project_pair_context_uses_verified_symmetric_cohort() -> None:
    import os

    from crossage_fr.enroll.manager import ProjectState
    from crossage_fr.match.scoring import MatchDecision
    from crossage_fr.models import EmbeddingResult, ReferenceFace

    fixed = load_fixed_cohort("insightface-antelopev2")
    probe = fixed.vectors[0].astype("float64")
    reference_vector = fixed.vectors[1].astype("float64")
    raw_cosine = float(np.dot(probe, reference_vector))
    with tempfile.TemporaryDirectory(prefix="vintrace-cohort-project-") as raw:
        root = Path(raw)
        registry = str(root / "registry")
        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        project = ProjectState(root / "workspace")
        project.references["ref-1"] = ReferenceFace(
            ref_id="ref-1",
            person_name="Alice",
            age_bucket="adult",
            source_path="/reference.jpg",
            capture_date=None,
            quality=0.9,
            model_name="insightface-antelopev2",
            vector=[float(value) for value in reference_vector],
        )
        embedding = EmbeddingResult(
            vector=[float(value) for value in probe],
            quality=0.9,
            bbox=(0, 0, 112, 112),
            model_name="insightface-antelopev2",
        )
        decision = MatchDecision(
            person_name="Alice",
            best_ref_id="ref-1",
            best_ref_path="/reference.jpg",
            score=raw_cosine,
            band="likely",
            raw_cosine=raw_cosine,
        )
        context = project._pair_calibration_context(embedding, decision)
        assert len(context["pairCenter"]) == 512
        assert np.isfinite(float(context["cohortZ"]))
        assert context["cohortVersion"].startswith("antelopev2:")
        assert context["contextVersion"].startswith("adaptive-pair-v1|antelopev2:")


def main() -> None:
    test_real_cohort_packs_verify_and_load_offline()
    test_model_space_routing_is_explicit()
    test_manifest_and_vector_tampering_fail_closed()
    test_report_is_bounded_and_manifest_pin_matches()
    test_project_pair_context_uses_verified_symmetric_cohort()
    print("cohort units ok")


if __name__ == "__main__":
    main()
