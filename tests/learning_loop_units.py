"""Unit tests for the self-learning loop persistence foundation.

Run: PYTHONPATH=. .venv/bin/python tests/learning_loop_units.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path

from crossage_fr.enroll.manager import ProjectState
from crossage_fr.ingest.image_io import sha256_file
from crossage_fr.match import adapters as match_adapters
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate
from crossage_fr.store.workspace_db import WorkspaceDb


def _use_temp_registry(base: Path) -> None:
    registry = str(base / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry


def _candidate(workspace: Path, candidate_id: str, person: str = "Alice") -> ReviewCandidate:
    source = workspace / f"{candidate_id}.jpg"
    source.write_bytes(f"candidate:{candidate_id}".encode("utf-8"))
    return ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(source),
        person_name=person,
        best_ref_id="ref1",
        best_ref_path=str(workspace / "ref1.jpg"),
        score=0.66,
        band="likely",
        quality=0.77,
        model_name="modelA",
        risk_flags=["close-runner-up"],
        pose_bucket="frontal",
        raw_cosine=0.61,
        align_error=0.03,
        ied_px=44.0,
    )


def _embedding(vector: list[float] | None = None, model_name: str = "modelA", quality: float = 0.82) -> EmbeddingResult:
    values = vector or [0.8, 0.6] + [0.0] * 510
    return EmbeddingResult(
        vector=values,
        quality=quality,
        bbox=(0, 0, 80, 80),
        model_name=model_name,
        pose_bucket="frontal",
        det_score=0.95,
        ied_px=44.0,
        align_error=0.03,
    )


def _project(tmp: Path) -> ProjectState:
    _use_temp_registry(tmp)
    workspace = tmp / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    ref_path = workspace / "ref1.jpg"
    ref_path.write_bytes(b"reference")
    project = ProjectState(workspace)
    project.references["ref1"] = ReferenceFace(
        ref_id="ref1",
        person_name="Alice",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=0.9,
        model_name="modelA",
        vector=[1.0] + [0.0] * 511,
    )
    project.vector_store.add("ref1", project.references["ref1"].vector)
    return project


def test_review_status_persists_current_training_example() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        candidate = _candidate(project.root, "cand1")
        project.candidates[candidate.candidate_id] = candidate

        project.set_candidate_status("cand1", "accepted")
        rows = project.db.training_example_rows()
        assert len(rows) == 1
        row = rows[0]
        assert row["candidate_id"] == "cand1"
        assert row["source_hash"] == sha256_file(Path(candidate.source_path))
        assert row["expected_person"] == "Alice"
        assert row["actual_person"] == "Alice"
        assert row["is_match"] == 1
        assert row["match_score"] == 0.66
        assert row["raw_cosine"] == 0.61
        assert row["candidate_embedding_key"].startswith("sha256:")
        assert row["reference_model_name"] == "modelA"
        assert row["features"]["riskFlags"] == ["close-runner-up"]
        summary = project.calibration_summary()
        assert summary["trainingExamples"]["totalExamples"] == 1
        assert summary["trainingExamples"]["positiveExamples"] == 1

        project.set_candidate_status("cand1", "rejected")
        rows = project.db.training_example_rows()
        assert len(rows) == 1
        assert rows[0]["candidate_id"] == "cand1"
        assert rows[0]["is_match"] == 0
        assert rows[0]["actual_person"] == ""
        # Calibration keeps the historical reviewed labels; training_examples keeps
        # the current candidate decision for adapter training.
        calibration = project.calibration_summary()
        assert calibration["positivePairs"] == 1
        assert calibration["negativePairs"] == 1
        assert calibration["trainingExamples"]["negativeExamples"] == 1

        project.set_candidate_status("cand1", "uncertain")
        assert project.db.training_example_rows() == []


def test_bulk_review_learning_examples_share_one_db_transaction() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        first = _candidate(project.root, "cand_bulk_1")
        second = _candidate(project.root, "cand_bulk_2")
        first.source_hash = sha256_file(Path(first.source_path))
        second.source_hash = sha256_file(Path(second.source_path))
        project.candidates[first.candidate_id] = first
        project.candidates[second.candidate_id] = second

        calibration_conns: list[sqlite3.Connection | None] = []
        training_conns: list[sqlite3.Connection | None] = []
        original_add_calibration_label = project.db.add_calibration_label
        original_add_training_example = project.db.add_training_example

        def record_calibration_conn(label_id: str, row: dict[str, object], conn: sqlite3.Connection | None = None) -> None:
            calibration_conns.append(conn)
            original_add_calibration_label(label_id, row, conn=conn)

        def record_training_conn(example_id: str, row: dict[str, object], conn: sqlite3.Connection | None = None) -> dict[str, object]:
            training_conns.append(conn)
            return original_add_training_example(example_id, row, conn=conn)

        project.db.add_calibration_label = record_calibration_conn  # type: ignore[method-assign]
        project.db.add_training_example = record_training_conn  # type: ignore[method-assign]

        updated = project.bulk_set_candidate_status([first.candidate_id, second.candidate_id], "accepted")
        assert updated == 2
        assert len(calibration_conns) == 2
        assert len(training_conns) == 2
        assert all(conn is not None for conn in [*calibration_conns, *training_conns])
        assert len({id(conn) for conn in [*calibration_conns, *training_conns]}) == 1
        assert len(project.db.training_example_rows()) == 2


def test_reference_suggestion_stage_and_approval_adds_reference() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        candidate = _candidate(project.root, "cand_ref")
        project.candidates[candidate.candidate_id] = candidate
        project.set_candidate_status(candidate.candidate_id, "accepted")

        staged = project.stage_reference_suggestions({candidate.candidate_id: _embedding()}, limit=5)
        assert staged["staged"] == 1
        artifact_id = staged["suggestions"][0]["artifactId"]
        artifact = project.db.learned_artifact_by_id(artifact_id)
        assert artifact["artifact_type"] == "suggested_reference"
        assert artifact["status"] == "staged"
        assert artifact["payload"]["candidateId"] == candidate.candidate_id
        assert artifact["payload"]["personName"] == "Alice"
        assert "sourcePath" not in artifact["payload"]

        approved = project.approve_reference_suggestion(artifact_id, _embedding(), operator="unit")
        assert approved["approved"] is True
        assert approved["refId"] in project.references
        assert len(project.references) == 2
        assert project.vector_store.size == 2
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "promoted"
        promoted_ref = project.references[approved["refId"]]
        assert promoted_ref.person_name == "Alice"
        assert promoted_ref.source_path == candidate.source_path
        assert promoted_ref.model_name == "modelA"
        audit = project.audit_events(limit=10)
        assert any(event.get("action") == "stage_reference_suggestion" for event in audit["events"])
        assert any(event.get("action") == "approve_reference_suggestion" and event.get("approved") is True for event in audit["events"])


def test_reference_suggestion_rejects_duplicate_outlier_and_model_mismatch() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        rows = {}
        cases = {
            "dup": _embedding([1.0] + [0.0] * 511),
            "outlier": _embedding([0.0, 1.0] + [0.0] * 510),
            "mismatch": _embedding([0.8, 0.6] + [0.0] * 510, model_name="modelB"),
        }
        for candidate_id in cases:
            candidate = _candidate(project.root, candidate_id)
            project.candidates[candidate_id] = candidate
            project.set_candidate_status(candidate_id, "accepted")
            rows[candidate_id] = candidate

        staged = project.stage_reference_suggestions(cases, limit=5)
        assert staged["staged"] == 0
        by_candidate = {row["candidateId"]: set(row["reasons"]) for row in staged["rejected"]}
        assert "duplicate-reference" in by_candidate["dup"]
        assert "embedding-outlier" in by_candidate["outlier"]
        assert "model-mismatch" in by_candidate["mismatch"]
        assert project.db.learned_artifact_rows("suggested_reference") == []


def test_reference_suggestion_delete_person_cleanup() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        candidate = _candidate(project.root, "cand_cleanup")
        project.candidates[candidate.candidate_id] = candidate
        project.set_candidate_status(candidate.candidate_id, "accepted")
        staged = project.stage_reference_suggestions({candidate.candidate_id: _embedding()}, limit=5)
        assert staged["staged"] == 1
        assert len(project.db.learned_artifact_rows("suggested_reference")) == 1

        deleted = project.delete_person("Alice")
        assert deleted["references"] == 1
        assert deleted["candidates"] == 1
        assert deleted["suggestedReferenceArtifacts"] == 1
        assert project.db.learned_artifact_rows("suggested_reference") == []


def test_bulk_review_and_false_match_block_feed_learning_examples() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        for candidate_id in ("cand1", "cand2"):
            candidate = _candidate(project.root, candidate_id)
            project.candidates[candidate_id] = candidate

        assert project.bulk_set_candidate_status(["cand1", "cand2"], "accepted") == 2
        summary = project.db.training_example_summary()
        assert summary["totalExamples"] == 2
        assert summary["positiveExamples"] == 2

        project.block_false_match("cand1")
        rows = {row["candidate_id"]: row for row in project.db.training_example_rows()}
        assert rows["cand1"]["is_match"] == 0
        assert rows["cand2"]["is_match"] == 1
        assert project.db.blocked_pairs_summary()["total"] == 2

        assert project.bulk_set_candidate_status(["cand1", "cand2"], "pending") == 2
        assert project.db.training_example_rows() == []


def test_retention_and_delete_face_data_clear_learning_metadata() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        candidate = _candidate(project.root, "old")
        candidate.created_at = "2020-01-01T00:00:00Z"
        project.candidates[candidate.candidate_id] = candidate
        project.set_candidate_status("old", "accepted")
        assert project.db.training_example_summary()["totalExamples"] == 1

        assert project.purge_old_candidates(1, ["accepted"]) == 1
        assert project.db.training_example_summary()["totalExamples"] == 0

        candidate = _candidate(project.root, "new")
        project.candidates[candidate.candidate_id] = candidate
        project.set_candidate_status("new", "accepted")
        project.db.upsert_learned_artifact(
            "artifact1",
            {
                "artifactType": "calibration",
                "status": "staged",
                "modelName": "modelA",
                "versionKey": "v1",
                "trainingDataHash": "abc",
                "inputCount": 1,
                "positiveCount": 1,
                "payload": {"thresholds": {"likely": 0.4}},
            },
        )
        privacy = project.privacy_report()
        assert privacy["trainingExamples"] == 1
        assert privacy["learnedArtifacts"] == 1
        deleted = project.delete_face_data(confirm=True)
        assert deleted["dbDeleted"]["training_examples"] == 1
        assert deleted["dbDeleted"]["learned_artifacts"] == 1
        assert project.privacy_report()["trainingExamples"] == 0


def test_workspace_db_learning_artifact_round_trip_and_integrity() -> None:
    with tempfile.TemporaryDirectory() as raw:
        db = WorkspaceDb(Path(raw) / "workspace.sqlite3")
        db.add_training_example(
            "example1",
            {
                "candidateId": "cand",
                "sourcePath": "/tmp/cand.jpg",
                "sourceHash": "hash1",
                "expectedPerson": "Alice",
                "actualPerson": "Alice",
                "isMatch": True,
                "matchScore": 0.8,
                "modelName": "modelA",
                "features": {"margin": 0.2},
            },
        )
        artifact = db.upsert_learned_artifact(
            "artifact1",
            {
                "artifactType": "adapter",
                "status": "candidate",
                "modelName": "modelA",
                "versionKey": "features-v1",
                "trainingDataHash": "hash-of-training-set",
                "inputCount": 1,
                "positiveCount": 1,
                "metrics": {"heldOutDelta": 0.03},
                "payload": {"weights": [1.0, -0.5]},
            },
        )
        assert len(artifact["artifactHash"]) == 64
        assert db.training_example_summary()["positiveExamples"] == 1
        rows = db.learned_artifact_rows("adapter")
        assert len(rows) == 1
        assert rows[0]["payload"]["weights"] == [1.0, -0.5]
        assert rows[0]["metrics"]["heldOutDelta"] == 0.03
        integrity = db.integrity_report()
        assert integrity["ok"] is True
        assert integrity["tableCounts"]["training_examples"] == 1
        assert integrity["tableCounts"]["learned_artifacts"] == 1


def test_workspace_db_migrates_legacy_learning_tables() -> None:
    with tempfile.TemporaryDirectory() as raw:
        path = Path(raw) / "legacy.sqlite3"
        with sqlite3.connect(path) as conn:
            conn.executescript(
                """
                CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO meta(key, value) VALUES('schemaVersion', '1');
                CREATE TABLE training_examples (
                    example_id TEXT PRIMARY KEY,
                    natural_key TEXT NOT NULL UNIQUE,
                    label_id TEXT NOT NULL DEFAULT '',
                    candidate_id TEXT NOT NULL DEFAULT '',
                    source_path TEXT NOT NULL DEFAULT '',
                    source_hash TEXT NOT NULL DEFAULT '',
                    expected_person TEXT NOT NULL DEFAULT '',
                    actual_person TEXT NOT NULL DEFAULT '',
                    is_match INTEGER NOT NULL,
                    match_score REAL,
                    raw_cosine REAL,
                    quality REAL,
                    model_name TEXT NOT NULL DEFAULT '',
                    detector_size INTEGER NOT NULL DEFAULT 0,
                    best_ref_id TEXT NOT NULL DEFAULT '',
                    best_ref_path TEXT NOT NULL DEFAULT '',
                    pose_bucket TEXT NOT NULL DEFAULT '',
                    age_gap_years REAL,
                    align_error REAL,
                    ied_px REAL,
                    media_kind TEXT NOT NULL DEFAULT 'image',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE learned_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    artifact_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    model_name TEXT NOT NULL DEFAULT '',
                    version_key TEXT NOT NULL DEFAULT '',
                    training_data_hash TEXT NOT NULL DEFAULT '',
                    input_count INTEGER NOT NULL DEFAULT 0,
                    positive_count INTEGER NOT NULL DEFAULT 0,
                    negative_count INTEGER NOT NULL DEFAULT 0,
                    metrics_json TEXT NOT NULL DEFAULT '{}',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    parent_artifact_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    promoted_at TEXT
                );
                """
            )

        db = WorkspaceDb(path)
        with db.connect() as conn:
            training_columns = {row["name"] for row in conn.execute("PRAGMA table_info(training_examples)").fetchall()}
            artifact_columns = {row["name"] for row in conn.execute("PRAGMA table_info(learned_artifacts)").fetchall()}
            assert {"candidate_embedding_key", "reference_model_name", "features_json"} <= training_columns
            assert "artifact_hash" in artifact_columns

        db.add_training_example(
            "migrated-example",
            {
                "candidateId": "cand",
                "sourceHash": "hash",
                "expectedPerson": "Alice",
                "isMatch": True,
                "candidateEmbeddingKey": "sha256:hash|model:modelA|detector:640",
                "referenceModelName": "modelA",
                "features": {"qualityBand": "good"},
            },
        )
        artifact = db.upsert_learned_artifact(
            "migrated-artifact",
            {
                "artifactType": "suggested_reference",
                "status": "staged",
                "modelName": "modelA",
                "versionKey": "suggested-reference-v1",
                "trainingDataHash": "hash",
                "inputCount": 1,
                "positiveCount": 1,
                "payload": {"candidateId": "cand", "personName": "Alice"},
            },
        )
        assert len(artifact["artifactHash"]) == 64
        row = db.training_example_rows()[0]
        assert row["candidate_embedding_key"].startswith("sha256:")
        assert row["reference_model_name"] == "modelA"
        assert row["features"]["qualityBand"] == "good"


def test_training_example_export_import_is_metadata_only_by_default() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        for candidate_id, status in (("cand1", "accepted"), ("cand2", "rejected")):
            candidate = _candidate(project.root, candidate_id)
            project.candidates[candidate_id] = candidate
            project.set_candidate_status(candidate_id, status)

        exported = project.export_training_examples()
        payload = json.loads(Path(exported["jsonPath"]).read_text(encoding="utf-8"))
        assert payload["counts"]["examples"] == 2
        assert payload["counts"]["matches"] == 1
        assert payload["counts"]["nonMatches"] == 1
        assert payload["counts"]["pathsIncluded"] is False
        assert len(payload["trainingDataHash"]) == 64
        assert "photos" in payload["note"].lower()
        for row in payload["examples"]:
            assert "sourcePath" not in row
            assert "bestRefPath" not in row
            assert "vector" not in json.dumps(row).lower()
            assert row["sourceHash"]
            assert row["candidateEmbeddingKey"].startswith("sha256:")
            assert row["trainingContext"]["version"] == match_adapters.PAIR_CONTEXT_VERSION
            assert row["trainingContext"]["inferenceSafe"] is True
            assert "identity-match" not in json.dumps(row["trainingContext"]).lower()
            assert "non-match" not in json.dumps(row["trainingContext"]).lower()

        exported_with_paths = project.export_training_examples(include_paths=True)
        path_payload = json.loads(Path(exported_with_paths["jsonPath"]).read_text(encoding="utf-8"))
        assert path_payload["counts"]["pathsIncluded"] is True
        assert "sourcePath" in path_payload["examples"][0]

        imported_project = _project(tmp / "imported")
        imported = imported_project.import_training_examples([*payload["examples"], {"expectedPerson": "Missing hash", "isMatch": True}])
        assert imported["imported"] == 2
        assert imported["skipped"] == 1
        rows = imported_project.db.training_example_rows()
        assert len(rows) == 2
        assert {row["is_match"] for row in rows} == {0, 1}
        assert all(row["source_path"] == "" for row in rows)
        assert all(row["best_ref_path"] == "" for row in rows)
        assert rows[0]["features"]["riskFlags"] == ["close-runner-up"]
        assert all(row["trainingContext"]["version"] == match_adapters.PAIR_CONTEXT_VERSION for row in rows)


def _seed_calibration_labels(project: ProjectState, model_name: str = "modelA", start: int = 0, pairs: int = 12) -> None:
    for i in range(start, start + pairs):
        project.db.add_calibration_label(
            f"p{i}",
            {
                "sourcePath": f"/p{i}.jpg",
                "expectedPerson": "Alice",
                "actualPerson": "Alice",
                "matchScore": 0.55 + 0.01 * i,
                "isMatch": True,
                "rawCosine": 0.55 + 0.01 * i,
                "modelName": model_name,
            },
        )
        project.db.add_calibration_label(
            f"n{i}",
            {
                "sourcePath": f"/n{i}.jpg",
                "expectedPerson": "Bob",
                "actualPerson": "",
                "matchScore": 0.12 + 0.01 * i,
                "isMatch": False,
                "rawCosine": 0.12 + 0.01 * i,
                "modelName": model_name,
            },
        )


def _adapter_example_rows(people: int = 8) -> list[dict]:
    rows: list[dict] = []
    for person_index in range(people):
        person = f"Person {person_index}"
        for index, score in enumerate((0.42, 0.52)):
            rows.append(
                {
                    "candidateId": f"cand_p_{person_index}_{index}",
                    "sourceHash": f"hash_p_{person_index}_{index}",
                    "expectedPerson": person,
                    "actualPerson": person,
                    "isMatch": True,
                    "matchScore": score,
                    "rawCosine": score - 0.02,
                    "quality": 0.9,
                    "modelName": "modelA",
                    "poseBucket": "frontal",
                    "ageGapYears": 1.0,
                    "alignError": 0.02,
                    "iedPx": 52.0,
                    "features": {"riskFlags": [], "runnerUpMargin": 0.14, "reviewPriority": 0.8},
                }
            )
        for index, score in enumerate((0.38, 0.48)):
            rows.append(
                {
                    "candidateId": f"cand_n_{person_index}_{index}",
                    "sourceHash": f"hash_n_{person_index}_{index}",
                    "expectedPerson": person,
                    "actualPerson": "",
                    "isMatch": False,
                    "matchScore": score,
                    "rawCosine": score - 0.02,
                    "quality": 0.1,
                    "modelName": "modelA",
                    "poseBucket": "profile",
                    "ageGapYears": 18.0,
                    "alignError": 0.18,
                    "iedPx": 24.0,
                    "mediaKind": "video",
                    "features": {"riskFlags": ["close-runner-up", "single-reference-match"], "runnerUpMargin": 0.01},
                }
            )
    return rows


def _seed_adapter_examples(project: ProjectState, people: int = 8, model_name: str = "modelA") -> None:
    for index, row in enumerate(_adapter_example_rows(people)):
        payload = {**row, "modelName": model_name}
        project.db.add_training_example(f"adapter_{index}_{model_name}", payload)


def test_embedding_adapter_feature_fit_and_serialization() -> None:
    rows = _adapter_example_rows()
    positive = rows[0]
    negative = rows[2]
    features = match_adapters.extract_pair_features(negative)
    assert features["media_video"] == 1.0
    assert features["pose_profile"] == 1.0
    assert features["risk_close_runner_up"] == 1.0
    assert features["risk_single_reference"] == 1.0
    assert features["candidate_quality"] == 0.1
    assert features["score_low_cross_pose"] == 0.0
    missing_margin_context = match_adapters.pair_context({"isMatch": False, "matchScore": 0.2, "poseBucket": "frontal"})
    assert missing_margin_context["closeRunnerUp"] is False
    explicit_margin_context = match_adapters.pair_context(
        {"isMatch": False, "matchScore": 0.2, "poseBucket": "frontal", "features": {"runnerUpMargin": 0.01}}
    )
    assert explicit_margin_context["closeRunnerUp"] is True
    zero_score_hard_pose = {
        **negative,
        "matchScore": 0.0,
        "rawCosine": 0.0,
        "poseBucket": "unknown",
        "ageGapYears": 20.0,
    }
    zero_features = match_adapters.extract_pair_features(zero_score_hard_pose)
    assert zero_features["score_zero"] == 1.0
    assert zero_features["score_low"] == 1.0
    assert zero_features["score_zero_pose_unknown"] == 1.0
    assert zero_features["score_zero_cross_age"] == 1.0
    assert zero_features["low_quality_hard_pose"] == 0.0

    artifact = match_adapters.fit(rows, min_count=24, min_per_class=8)
    artifact_again = match_adapters.fit(rows, min_count=24, min_per_class=8)
    assert artifact is not None
    assert artifact == artifact_again
    encoded = json.dumps(artifact, sort_keys=True)
    decoded = match_adapters.deserialize(json.loads(encoded))
    assert decoded["featureVersion"] == match_adapters.FEATURE_VERSION
    assert decoded["adapterType"] == "logistic_regression"
    assert "score_zero_cross_age" in decoded["featureNames"]
    assert match_adapters.score(positive, decoded) > match_adapters.score(negative, decoded)
    legacy = json.loads(encoded)
    legacy_count = 19
    legacy["featureVersion"] = "pair-adapter-features-v1"
    legacy["featureNames"] = legacy["featureNames"][:legacy_count]
    legacy["featureMeans"] = legacy["featureMeans"][:legacy_count]
    legacy["featureScales"] = legacy["featureScales"][:legacy_count]
    legacy["coef"] = legacy["coef"][:legacy_count]
    decoded_legacy = match_adapters.deserialize(legacy)
    assert decoded_legacy["featureVersion"] == "pair-adapter-features-v1"
    assert 0.0 <= match_adapters.score(positive, decoded_legacy) <= 1.0


def test_embedding_adapter_context_coverage_recommends_hard_reviews() -> None:
    with tempfile.TemporaryDirectory() as raw:
        project = _project(Path(raw))
        rows: list[dict] = []
        for index in range(5):
            rows.append(
                {
                    "candidateId": f"hard_neg_{index}",
                    "sourceHash": f"hard_neg_hash_{index}",
                    "expectedPerson": "Alice",
                    "actualPerson": "",
                    "isMatch": False,
                    "matchScore": 0.12,
                    "rawCosine": 0.1,
                    "quality": 0.8,
                    "poseBucket": "profile",
                    "features": {"riskFlags": ["pose-reranked"]},
                    "modelName": "modelA",
                }
            )
        for index in range(2):
            rows.append(
                {
                    "candidateId": f"age_pos_{index}",
                    "sourceHash": f"age_pos_hash_{index}",
                    "expectedPerson": "Alice",
                    "actualPerson": "Alice",
                    "isMatch": True,
                    "matchScore": 0.62,
                    "rawCosine": 0.6,
                    "quality": 0.9,
                    "poseBucket": "frontal",
                    "ageGapYears": 18.0,
                    "modelName": "modelA",
                }
            )
        for index, row in enumerate(rows):
            project.db.add_training_example(f"coverage_{index}", row)

        direct = project.embedding_adapter_context_coverage(rows)
        by_id = {target["id"]: target for target in direct["targets"]}
        assert direct["contextVersion"] == match_adapters.PAIR_CONTEXT_VERSION
        assert by_id["negative-cross-pose-low-score"]["ready"] is True
        assert by_id["negative-cross-pose-low-score"]["count"] == 5
        assert by_id["positive-cross-age"]["ready"] is False
        assert by_id["positive-cross-age"]["remaining"] == 1
        assert "cross-age" in by_id["positive-cross-age"]["action"]
        status = project.embedding_adapter_learning_status()
        assert status["coverage"]["missingTargets"] >= 1
        assert status["coverage"]["contextCounts"]


def test_embedding_adapter_stage_promote_runtime_fallback_and_rollback() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_adapter_examples(project)

        status = project.embedding_adapter_learning_status()
        assert status["readiness"]["labels"] == 32
        assert status["readiness"]["ready"] is False
        assert status["readiness"]["minimumLabels"] == 100

        staged = project.stage_embedding_adapter(min_count=24, min_per_class=8)
        artifact_id = staged["artifact"]["artifactId"]
        assert staged["status"] == "staged"
        assert staged["promotable"] is True
        artifact = project.db.learned_artifact_by_id(artifact_id)
        assert artifact["artifact_type"] == "embedding_adapter"
        assert artifact["status"] == "staged"
        assert artifact["payload"]["featureVersion"] == match_adapters.FEATURE_VERSION
        assert artifact["payload"]["versionKey"] == match_adapters.ADAPTER_VERSION
        assert "sourcePath" not in artifact["payload"]
        assert "vector" not in json.dumps(artifact["payload"]).lower()

        promoted = project.promote_embedding_adapter(artifact_id)
        assert promoted["promoted"] is True
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "promoted"
        positive = _adapter_example_rows()[0]
        negative = _adapter_example_rows()[2]
        assert project.embedding_adapter_score(positive, "modelA") > project.embedding_adapter_score(negative, "modelA")
        assert project.embedding_adapter_score(positive, "modelB") is None

        rolled_back = project.rollback_embedding_adapter(artifact_id)
        assert rolled_back["rolledBack"] is True
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"
        assert project.embedding_adapter_score(positive, "modelA") is None
        audit = project.audit_events(limit=20)
        assert any(event.get("action") == "stage_embedding_adapter" for event in audit["events"])
        assert any(event.get("action") == "promote_embedding_adapter" for event in audit["events"])
        assert any(event.get("action") == "rollback_embedding_adapter" for event in audit["events"])


def test_embedding_adapter_requires_consent_before_staging() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        _seed_adapter_examples(project)

        status = project.embedding_adapter_learning_status()
        assert status["readiness"]["consentRequired"] is True
        assert status["readiness"]["consentActive"] is False
        assert status["readiness"]["ready"] is False
        try:
            project.stage_embedding_adapter(min_count=24, min_per_class=8)
            raise AssertionError("expected ValueError without consent")
        except ValueError as exc:
            assert "Consent must be active" in str(exc)


def test_learning_jobs_block_when_workspace_locked() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_calibration_labels(project)
        _seed_adapter_examples(project)
        project.lock_path.write_text("busy\n", encoding="utf-8")
        try:
            calibration_status = project.calibration_learning_status()
            assert calibration_status["readiness"]["workspaceLocked"] is True
            assert calibration_status["readiness"]["ready"] is False
            blocked = project.run_learning_jobs()
            assert blocked["artifactCreated"] is False
            assert blocked["readiness"]["workspaceLocked"] is True
            assert "locked" in blocked["reason"].lower()

            adapter_status = project.embedding_adapter_learning_status()
            assert adapter_status["readiness"]["workspaceLocked"] is True
            assert adapter_status["readiness"]["ready"] is False
            try:
                project.stage_embedding_adapter(min_count=24, min_per_class=8)
                raise AssertionError("expected ValueError while workspace is locked")
            except ValueError as exc:
                assert "locked" in str(exc).lower()
        finally:
            project.lock_path.unlink(missing_ok=True)


def test_learning_mode_off_blocks_learning_mutations() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        project.config.learning_mode = "off"
        _seed_calibration_labels(project)
        _seed_adapter_examples(project)
        candidate = _candidate(project.root, "off_ref")
        project.candidates[candidate.candidate_id] = candidate
        candidate.status = "accepted"

        status = project.calibration_learning_status()
        assert status["readiness"]["learningMode"] == "off"
        assert status["readiness"]["ready"] is False
        job = project.run_learning_jobs()
        assert job["artifactCreated"] is False
        assert "Off" in job["reason"]
        try:
            project.stage_embedding_adapter(min_count=24, min_per_class=8)
            raise AssertionError("expected ValueError while learning mode is off")
        except ValueError as exc:
            assert "Learning mode is Off" in str(exc)
        suggestions = project.stage_reference_suggestions({candidate.candidate_id: _embedding()}, limit=5)
        assert suggestions["staged"] == 0
        assert suggestions["skipped"][0]["reason"] == "learning-off"


def test_embedding_adapter_rejects_regressed_validation() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_adapter_examples(project)

        def regressed_validation(*args, **kwargs):  # noqa: ANN002, ANN003 - compact monkeypatch for regression gate.
            return {
                "promote": False,
                "baselineAccuracy": 0.85,
                "candidateAccuracy": 0.72,
                "delta": -0.13,
                "trainN": 16,
                "testN": 16,
                "reason": "synthetic regression",
            }

        project.validate_embedding_adapter_change = regressed_validation  # type: ignore[method-assign]
        staged = project.stage_embedding_adapter(min_count=24, min_per_class=8)
        artifact_id = staged["artifact"]["artifactId"]
        assert staged["status"] == "rejected"
        assert staged["promotable"] is False
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rejected"
        try:
            project.promote_embedding_adapter(artifact_id)
            raise AssertionError("expected ValueError on rejected adapter artifact")
        except ValueError as exc:
            assert "Only staged embedding adapter artifacts can be promoted" in str(exc)


def test_embedding_adapter_keeps_no_gain_candidate_advisory_only() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_adapter_examples(project)

        def parity_validation(*args, **kwargs):  # noqa: ANN002, ANN003 - compact monkeypatch for advisory gate.
            return {
                "promote": False,
                "baselineAccuracy": 0.9,
                "candidateAccuracy": 0.9,
                "delta": 0.0,
                "trainN": 16,
                "testN": 16,
                "reason": "synthetic parity",
            }

        project.validate_embedding_adapter_change = parity_validation  # type: ignore[method-assign]
        staged = project.stage_embedding_adapter(min_count=24, min_per_class=8)
        artifact_id = staged["artifact"]["artifactId"]
        assert staged["status"] == "candidate"
        assert staged["promotable"] is False
        assert staged["advisoryOnly"] is True
        artifact = project.db.learned_artifact_by_id(artifact_id)
        assert artifact["status"] == "candidate"
        assert artifact["metrics"]["promotionEligible"] is False
        assert artifact["metrics"]["advisoryOnly"] is True
        try:
            project.promote_embedding_adapter(artifact_id)
            raise AssertionError("expected ValueError for advisory-only adapter artifact")
        except ValueError as exc:
            assert "Only staged embedding adapter artifacts can be promoted" in str(exc)


def test_run_learning_jobs_honors_consent_and_auto_stages_once() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        _seed_calibration_labels(project)

        blocked = project.run_learning_jobs()
        assert blocked["staged"] is False
        assert blocked["artifactCreated"] is False
        assert blocked["readiness"]["consentRequired"] is True
        assert blocked["readiness"]["consentActive"] is False
        assert "Consent must be active" in blocked["reason"]
        assert project.db.learned_artifact_rows("calibration") == []

        project.set_consent(True, source="unit-test", operator="Learning Loop")
        status = project.calibration_learning_status()
        assert status["readiness"]["ready"] is True
        assert status["readiness"]["newLabelsSinceLastArtifact"] == 24

        job = project.run_learning_jobs()
        assert job["staged"] is True
        assert job["artifactCreated"] is True
        assert job["artifactStatus"] == "staged"
        assert job["calibration"]["status"] == "staged"
        assert job["calibration"]["payload"]["labels"] == 24
        assert project.config.calibration_platt == []
        after = job["status"]["readiness"]
        assert after["ready"] is False
        assert after["newLabelsSinceLastArtifact"] == 0
        assert "already has a calibration artifact" in after["reason"]

        duplicate = project.run_learning_jobs()
        assert duplicate["staged"] is False
        assert duplicate["artifactCreated"] is False
        assert "already has a calibration artifact" in duplicate["reason"]
        assert len(project.db.learned_artifact_rows("calibration")) == 1

        audit = project.audit_events(limit=10)
        job_events = [event for event in audit["events"] if event.get("action") == "run_learning_jobs"]
        assert len(job_events) >= 3
        assert any(event.get("artifact_created") is False and event.get("consent_active") is False for event in job_events)
        assert any(event.get("artifact_created") is True and event.get("staged") is True for event in job_events)


def test_run_learning_jobs_waits_for_enough_new_labels_after_artifact() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_calibration_labels(project)

        first = project.run_learning_jobs()
        assert first["staged"] is True
        first_artifact_id = first["calibration"]["artifact"]["artifactId"]

        _seed_calibration_labels(project, start=12, pairs=4)
        waiting = project.run_learning_jobs()
        assert waiting["staged"] is False
        assert waiting["artifactCreated"] is False
        assert waiting["readiness"]["newLabelsSinceLastArtifact"] == 8
        assert "Review at least 2 more" in waiting["reason"]
        assert len(project.db.learned_artifact_rows("calibration")) == 1

        _seed_calibration_labels(project, start=16, pairs=1)
        second = project.run_learning_jobs()
        assert second["staged"] is True
        assert second["artifactCreated"] is True
        assert second["calibration"]["artifact"]["artifactId"] != first_artifact_id
        assert second["readiness"]["newLabelsSinceLastArtifact"] == 10
        assert len(project.db.learned_artifact_rows("calibration")) == 2


def test_stage_promote_and_rollback_calibration_artifact() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        _seed_calibration_labels(project)
        previous_thresholds = {
            "confident": project.config.thresholds.confident,
            "likely": project.config.thresholds.likely,
            "relaxed_child": project.config.thresholds.relaxed_child,
        }
        assert project.config.calibration_platt == []

        staged = project.stage_calibration_update()
        artifact_id = staged["artifact"]["artifactId"]
        assert staged["status"] == "staged"
        assert staged["promotable"] is True
        assert staged["payload"]["labels"] == 24
        assert staged["payload"]["calibrationModel"] == "modelA"
        assert project.config.thresholds.likely == previous_thresholds["likely"]
        status = project.calibration_learning_status()
        assert status["artifacts"][0]["artifact_id"] == artifact_id
        assert status["artifacts"][0]["status"] == "staged"

        promoted = project.promote_calibration_artifact(artifact_id)
        assert promoted["promoted"] is True
        assert promoted["artifactId"] == artifact_id
        assert project.config.calibration_model == "modelA"
        assert len(project.config.calibration_platt) == 2
        assert project.config.thresholds.likely == staged["payload"]["thresholds"]["likely"]
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "promoted"
        audit = project.audit_events(limit=10)
        promote_events = [event for event in audit["events"] if event.get("action") == "promote_calibration_artifact"]
        assert promote_events
        promote_event = promote_events[0]
        assert promote_event["artifact_id"] == artifact_id
        assert len(promote_event["artifact_hash"]) == 64
        assert promote_event["model_name"] == "modelA"
        assert promote_event["labels"] == 24
        assert promote_event["positive_labels"] == 12
        assert promote_event["negative_labels"] == 12
        assert "likely" in promote_event["old_thresholds"]
        assert "likely" in promote_event["new_thresholds"]
        assert promote_event["promoted_at"]

        rolled_back = project.rollback_calibration_artifact(artifact_id)
        assert rolled_back["rolledBack"] is True
        assert project.config.calibration_platt == []
        assert project.config.calibration_model == ""
        assert project.config.thresholds.confident == previous_thresholds["confident"]
        assert project.config.thresholds.likely == previous_thresholds["likely"]
        assert project.config.thresholds.relaxed_child == previous_thresholds["relaxed_child"]
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rolled_back"


def test_stage_calibration_blocks_insufficient_or_regressed_feedback() -> None:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        project = _project(tmp)
        project.set_consent(True, source="unit-test", operator="Learning Loop")
        try:
            project.stage_calibration_update()
            raise AssertionError("expected ValueError on insufficient labels")
        except ValueError as exc:
            assert "Review more accepted and rejected matches" in str(exc)

        _seed_calibration_labels(project)

        def regressed_validation(rows=None):  # noqa: ANN001 - test monkeypatch keeps the manager surface tiny.
            return {
                "promote": False,
                "baselineAccuracy": 0.95,
                "candidateAccuracy": 0.88,
                "delta": -0.07,
                "trainN": 12,
                "testN": 12,
            }

        project.validate_calibration_change = regressed_validation  # type: ignore[method-assign]
        staged = project.stage_calibration_update()
        artifact_id = staged["artifact"]["artifactId"]
        assert staged["status"] == "rejected"
        assert staged["promotable"] is False
        assert project.db.learned_artifact_by_id(artifact_id)["status"] == "rejected"
        try:
            project.promote_calibration_artifact(artifact_id)
            raise AssertionError("expected ValueError on rejected calibration artifact")
        except ValueError as exc:
            assert "Only staged calibration artifacts can be promoted" in str(exc)

        audit = project.audit_events(limit=5)
        stage_events = [event for event in audit["events"] if event.get("action") == "stage_calibration_update"]
        assert stage_events
        assert stage_events[0]["status"] == "rejected"
        assert stage_events[0]["labels"] == 24
        assert len(stage_events[0]["artifact_hash"]) == 64
        assert stage_events[0]["model_name"] == "modelA"
        assert stage_events[0]["positive_labels"] == 12
        assert stage_events[0]["negative_labels"] == 12
        assert "likely" in stage_events[0]["old_thresholds"]
        assert "likely" in stage_events[0]["new_thresholds"]
        assert stage_events[0]["validation"]["delta"] == -0.07


def main() -> None:
    test_review_status_persists_current_training_example()
    test_bulk_review_learning_examples_share_one_db_transaction()
    test_reference_suggestion_stage_and_approval_adds_reference()
    test_reference_suggestion_rejects_duplicate_outlier_and_model_mismatch()
    test_reference_suggestion_delete_person_cleanup()
    test_bulk_review_and_false_match_block_feed_learning_examples()
    test_retention_and_delete_face_data_clear_learning_metadata()
    test_workspace_db_learning_artifact_round_trip_and_integrity()
    test_workspace_db_migrates_legacy_learning_tables()
    test_training_example_export_import_is_metadata_only_by_default()
    test_embedding_adapter_feature_fit_and_serialization()
    test_embedding_adapter_context_coverage_recommends_hard_reviews()
    test_embedding_adapter_stage_promote_runtime_fallback_and_rollback()
    test_embedding_adapter_requires_consent_before_staging()
    test_learning_jobs_block_when_workspace_locked()
    test_learning_mode_off_blocks_learning_mutations()
    test_embedding_adapter_rejects_regressed_validation()
    test_embedding_adapter_keeps_no_gain_candidate_advisory_only()
    test_run_learning_jobs_honors_consent_and_auto_stages_once()
    test_run_learning_jobs_waits_for_enough_new_labels_after_artifact()
    test_stage_promote_and_rollback_calibration_artifact()
    test_stage_calibration_blocks_insufficient_or_regressed_feedback()
    print("learning loop units ok")


if __name__ == "__main__":
    main()
