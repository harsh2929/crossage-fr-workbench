from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import tempfile

from benchmarks.run_synthetic_age_image_benchmark import _secure_purge_tree

from crossage_fr.benchmarks.synthetic_age_image import (
    SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION,
    benchmark_case_id,
    compare_galleries,
    evaluate_gallery,
    review_manifest_template,
    validate_review_manifest,
)


def test_gallery_comparison() -> None:
    cases = [
        {"caseId": "positive-a", "expectedMatch": True, "expectedPerson": "A", "candidateVector": [0.7, 0.714]},
        {"caseId": "negative-x", "expectedMatch": False, "expectedPerson": "", "candidateVector": [0.0, -1.0]},
    ]
    real = [
        {"refId": "real-a", "personName": "A", "vector": [1.0, 0.0], "generated": False},
        {"refId": "real-b", "personName": "B", "vector": [0.0, 1.0], "generated": False},
    ]
    generated = {"refId": "age-a", "personName": "A", "vector": [0.72, 0.694], "generated": True}
    baseline = evaluate_gallery(cases, real, threshold=0.71)
    augmented = evaluate_gallery(cases, [*real, generated], threshold=0.71)
    comparison = compare_galleries(baseline, augmented)
    assert baseline["falseNegatives"] == 1
    assert augmented["truePositives"] == 1
    assert augmented["generatedBestTruePositives"] == 1
    assert comparison["improvements"] == 1 and comparison["regressions"] == 0
    assert comparison["recallDelta"] > 0


def test_review_manifest_binding() -> None:
    staged = [
        {
            "caseId": benchmark_case_id("agedb", "a" * 64, "b" * 64, "senior"),
            "artifactId": "artifact-1",
            "generatedHash": "c" * 64,
            "targetAgeBucket": "senior",
        }
    ]
    template = review_manifest_template(staged)
    assert template["benchmarkVersion"] == SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION
    review = deepcopy(template)
    review["reviewer"] = "Review Operator"
    review["reviewedAt"] = "2026-07-14T12:00:00Z"
    review["decisions"][0].update(
        {
            "decision": "approve",
            "singlePerson": True,
            "identityPreserved": True,
            "targetAgePlausible": True,
            "perceivedAgeBucket": "senior",
            "visualArtifactsAcceptable": True,
        }
    )
    decisions = validate_review_manifest(review, staged)
    assert decisions[staged[0]["caseId"]]["decision"] == "approve"

    bad_hash = deepcopy(review)
    bad_hash["decisions"][0]["generatedSha256"] = "d" * 64
    try:
        validate_review_manifest(bad_hash, staged)
        raise AssertionError("tampered review hash was accepted")
    except ValueError as exc:
        assert "hash" in str(exc)

    unchecked = deepcopy(review)
    unchecked["decisions"][0]["identityPreserved"] = False
    try:
        validate_review_manifest(unchecked, staged)
        raise AssertionError("unchecked visual approval was accepted")
    except ValueError as exc:
        assert "visual check" in str(exc)

    rejected = deepcopy(review)
    rejected["decisions"][0] = {
        "caseId": staged[0]["caseId"],
        "artifactId": staged[0]["artifactId"],
        "generatedSha256": staged[0]["generatedHash"],
        "decision": "reject",
        "reason": "Identity changed.",
    }
    assert validate_review_manifest(rejected, staged)[staged[0]["caseId"]]["decision"] == "reject"


def test_private_asset_purge() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        private = root / "private-benchmark"
        (private / "nested").mkdir(parents=True)
        (private / "one.jpg").write_bytes(b"one")
        (private / "nested" / "two.jpg").write_bytes(b"two-two")
        report = _secure_purge_tree(private)
        assert report == {"files": 2, "bytes": 10}
        assert not private.exists()

        external = root / "external"
        external.mkdir()
        protected = external / "protected.jpg"
        protected.write_bytes(b"keep")
        link = root / "private-link"
        link.symlink_to(external, target_is_directory=True)
        try:
            _secure_purge_tree(link)
            raise AssertionError("a symlinked private purge root was followed")
        except ValueError as exc:
            assert "symbolic link" in str(exc)
        assert protected.read_bytes() == b"keep"


def main() -> None:
    test_gallery_comparison()
    test_review_manifest_binding()
    test_private_asset_purge()
    print("synthetic age-image benchmark units ok")


if __name__ == "__main__":
    main()
