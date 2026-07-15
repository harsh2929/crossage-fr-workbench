"""PHOTO-09 relationship-graph naming suggestion acceptance tests."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from crossage_fr.photo_relationships import rank_relationship_name_suggestions

sys.path.insert(0, str(Path(__file__).resolve().parent))
from photo_folders_units import _api, _candidate, _sig  # noqa: E402


UNKNOWN = "Unmatched cluster graph-a"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _expect_error(fn, text: str) -> None:
    try:
        fn()
    except Exception as exc:
        assert text.lower() in str(exc).lower(), exc
        return
    raise AssertionError(f"Expected an error containing {text!r}")


def _seed_relationship_graph(api, root: Path) -> dict[str, Path]:
    memberships = {
        "u1.jpg": [UNKNOWN, "Alice"],
        "u2.jpg": [UNKNOWN, "Alice", "Bob"],
        "u3.jpg": [UNKNOWN, "Bob"],
        "sam1.jpg": ["Sam", "Alice"],
        "sam2.jpg": ["Sam", "Alice", "Bob"],
        "sam3.jpg": ["Sam", "Bob"],
        "jordan1.jpg": ["Jordan", "Alice"],
        "jordan2.jpg": ["Jordan"],
    }
    api.handle("set_consent", {"value": True, "source": "photo-relationship-test"})
    api.project.db.create_scan_run("relationship-run", "Relationship fixtures", "manual", str(root))
    candidates = {}
    paths: dict[str, Path] = {}
    for file_index, (filename, people) in enumerate(memberships.items(), start=1):
        path = root / filename
        path.write_bytes(f"immutable relationship fixture {filename}".encode("ascii"))
        paths[filename] = path
        api.project.db.record_scan_file(
            "relationship-run",
            path,
            _sig(path, size=path.stat().st_size, mtime=file_index),
            "completed",
            phase="processed",
        )
        for face_index, person in enumerate(people, start=1):
            candidate_id = f"relationship-{file_index}-{face_index}"
            candidates[candidate_id] = _candidate(
                candidate_id,
                person,
                str(path),
                status="pending" if person.startswith("Unmatched cluster") else "accepted",
                score=0.20 if person.startswith("Unmatched cluster") else 0.97,
            )
    api.project.candidates = candidates
    api.project.db.upsert_candidates(candidates.values())
    return paths


def test_pure_relationship_ranker_is_deterministic_explainable_and_conservative() -> None:
    nodes = [
        {"personName": UNKNOWN, "assetCount": 4},
        {"personName": "Sam", "assetCount": 3},
        {"personName": "Alice", "assetCount": 8},
        {"personName": "Bob", "assetCount": 7},
        {"personName": "Taylor", "assetCount": 5},
    ]
    edges = [
        {"personA": UNKNOWN, "personB": "Alice", "cooccurrenceCount": 2},
        {"personA": UNKNOWN, "personB": "Bob", "cooccurrenceCount": 2},
        {"personA": "Sam", "personB": "Alice", "cooccurrenceCount": 3},
        {"personA": "Sam", "personB": "Bob", "cooccurrenceCount": 2},
        {"personA": "Taylor", "personB": "Alice", "cooccurrenceCount": 3},
        {"personA": "Taylor", "personB": "Bob", "cooccurrenceCount": 2},
        {"personA": UNKNOWN, "personB": "Taylor", "cooccurrenceCount": 1},
    ]
    first = rank_relationship_name_suggestions(nodes, edges)
    second = rank_relationship_name_suggestions(reversed(nodes), reversed(edges))
    assert first == second, (first, second)
    assert [row["targetPerson"] for row in first["suggestions"]] == ["Sam"], first
    suggestion = first["suggestions"][0]
    assert suggestion["reviewRequired"] is True and suggestion["autoApply"] is False, suggestion
    assert suggestion["undoAvailable"] is True and suggestion["directCooccurrenceCount"] == 0, suggestion
    assert suggestion["relationshipSupport"] == 4, suggestion
    assert [row["personName"] for row in suggestion["sharedRelationships"]] == ["Alice", "Bob"], suggestion
    assert first["graphStats"]["blockedByDirectCooccurrence"] >= 3, first["graphStats"]
    assert "/" not in json.dumps(first), first


def test_relationship_dismissal_persists_across_restart_and_hidden_people_are_excluded() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        _seed_relationship_graph(api, root)
        found = api.handle("suggest_photo_relationship_names", {"limit": 20})["value"]
        assert found["available"] is True and found["offline"] is True, found
        assert found["reviewRequired"] is True and found["autoApplied"] == 0, found
        assert len(found["suggestions"]) == 1, found
        suggestion = found["suggestions"][0]
        assert suggestion["sourceCluster"] == UNKNOWN and suggestion["targetPerson"] == "Sam", suggestion
        assert str(root) not in json.dumps(found), found

        dismissed = api.handle(
            "review_photo_relationship_name_suggestion",
            {
                "suggestionId": suggestion["suggestionId"],
                "sourceCluster": suggestion["sourceCluster"],
                "targetPerson": suggestion["targetPerson"],
                "decision": "dismissed",
            },
        )["value"]
        assert dismissed["dismissed"] is True and dismissed["applied"] is False, dismissed
        assert api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"] == []

        reopened = _api(tmp)
        persisted = reopened.handle("suggest_photo_relationship_names", {})["value"]
        assert persisted["suggestions"] == [], persisted
        review = reopened.project.db.photo_relationship_name_review(suggestion["suggestionId"])
        assert review and review["decision"] == "dismissed", review

        with reopened.project.db.connect() as conn:
            conn.execute(
                "DELETE FROM photo_relationship_name_reviews WHERE suggestion_id = ?",
                (suggestion["suggestionId"],),
            )
        reopened.save_photo_person_profile({"personName": "Sam", "hidden": True})
        hidden = reopened.handle("suggest_photo_relationship_names", {})["value"]
        assert hidden["suggestions"] == [], hidden
        reopened.save_photo_person_profile({"personName": "Sam", "hidden": False})
        restored_suggestion = reopened.handle("suggest_photo_relationship_names", {})["value"]["suggestions"][0]
        reopened.handle(
            "review_photo_relationship_name_suggestion",
            {
                "suggestionId": restored_suggestion["suggestionId"],
                "sourceCluster": restored_suggestion["sourceCluster"],
                "targetPerson": restored_suggestion["targetPerson"],
                "decision": "dismissed",
            },
        )
        deleted_person = reopened.project.delete_person("Sam")
        assert deleted_person["relationshipNameReviews"] == 1, deleted_person
        assert reopened.project.db.photo_relationship_name_review(restored_suggestion["suggestionId"]) is None


def test_relationship_graph_requires_consent_and_excludes_deleted_or_rejected_evidence() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        denied = api.handle("suggest_photo_relationship_names", {})["value"]
        assert denied["available"] is False and denied["suggestions"] == [], denied

        paths = _seed_relationship_graph(api, root)
        baseline = api.handle("suggest_photo_relationship_names", {})["value"]
        assert baseline["suggestions"][0]["targetPerson"] == "Sam", baseline
        with api.project.db.connect() as conn:
            for filename in ("u2.jpg", "u3.jpg"):
                asset = api.project.db.photo_asset_by_path(str(paths[filename]), conn)
                assert asset
                conn.execute(
                    "UPDATE photo_asset_metadata SET deleted_at = ? WHERE asset_id = ?",
                    ("2026-07-13T00:00:00Z", asset["assetId"]),
                )
        deleted = api.handle("suggest_photo_relationship_names", {})["value"]
        assert deleted["suggestions"] == [], deleted

        with api.project.db.connect() as conn:
            conn.execute("UPDATE photo_asset_metadata SET deleted_at = NULL")
            conn.execute(
                "UPDATE photo_asset_people SET status = 'rejected', band = 'manual assignment' WHERE LOWER(person_name) = 'sam'"
            )
        rejected = api.handle("suggest_photo_relationship_names", {})["value"]
        assert all(row["targetPerson"] != "Sam" for row in rejected["suggestions"]), rejected


def test_relationship_graph_enforces_subject_consent_without_requiring_profile_rows() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        _seed_relationship_graph(api, root)
        api.project.config.per_subject_consent = True
        denied = api.handle("suggest_photo_relationship_names", {})["value"]
        assert denied["suggestions"] == [], denied

        for person_name in ("Sam", "Alice", "Bob"):
            api.handle(
                "set_consent",
                {
                    "value": True,
                    "personName": person_name,
                    "source": "photo-relationship-subject-consent-test",
                },
            )
        allowed = api.handle("suggest_photo_relationship_names", {})["value"]
        assert [row["targetPerson"] for row in allowed["suggestions"]] == ["Sam"], allowed


def test_relationship_apply_rejects_graph_evidence_that_changed_after_display() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        paths = _seed_relationship_graph(api, root)
        suggestion = api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"][0]
        u1_asset = api.project.db.photo_asset_by_path(str(paths["u1.jpg"]))
        assert u1_asset
        with api.project.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
                VALUES(?, 'relationship-direct-conflict', 'Sam', 'accepted', 0.99, 0.95, 'confident', '2026-07-13T00:00:00Z')
                """,
                (u1_asset["assetId"],),
            )
        _expect_error(
            lambda: api.handle(
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": suggestion["targetPerson"],
                    "decision": "applied",
                    "confirm": True,
                    "idempotencyKey": "stale-relationship-evidence",
                },
            ),
            "stale",
        )
        refreshed = api.handle("suggest_photo_relationship_names", {})["value"]
        assert all(row["targetPerson"] != "Sam" for row in refreshed["suggestions"]), refreshed


def test_delete_face_data_clears_relationship_review_ledger_without_touching_originals() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        source_paths = _seed_relationship_graph(api, root)
        before_hashes = {name: _sha256(path) for name, path in source_paths.items()}
        suggestion = api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"][0]
        api.handle(
            "review_photo_relationship_name_suggestion",
            {
                "suggestionId": suggestion["suggestionId"],
                "sourceCluster": suggestion["sourceCluster"],
                "targetPerson": suggestion["targetPerson"],
                "decision": "dismissed",
            },
        )
        assert api.project.privacy_report()["relationshipNameReviews"] == 1
        deleted = api.project.delete_face_data(confirm=True)
        assert deleted["dbDeleted"]["photo_relationship_name_reviews"] == 1, deleted
        assert deleted["after"]["relationshipNameReviews"] == 0, deleted
        assert {name: _sha256(path) for name, path in source_paths.items()} == before_hashes


def test_relationship_review_idempotency_is_preflighted_and_unicode_deletion_is_complete() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        _seed_relationship_graph(api, root)
        suggestion = api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"][0]
        api.project.db.save_photo_relationship_name_review(
            suggestion_id="relationship_name_prior_review",
            source_cluster="Unmatched cluster prior",
            target_person="Straße",
            evidence_hash="0" * 64,
            decision="applied",
            idempotency_key="relationship-key-already-used",
            result={"applied": True},
        )
        _expect_error(
            lambda: api.handle(
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": suggestion["targetPerson"],
                    "decision": "applied",
                    "confirm": True,
                    "idempotencyKey": "relationship-key-already-used",
                },
            ),
            "idempotencykey",
        )
        assert sum(candidate.person_name == UNKNOWN for candidate in api.project.candidates.values()) == 3
        assert api.project.db.delete_photo_relationship_name_reviews_for_people(["STRASSE"]) == 1
        assert api.project.db.photo_relationship_name_review("relationship_name_prior_review") is None


def test_relationship_apply_requires_fresh_confirmed_review_is_idempotent_and_undoable() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        source_paths = _seed_relationship_graph(api, root)
        before_hashes = {name: _sha256(path) for name, path in source_paths.items()}
        suggestion = api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"][0]
        base_params: dict[str, Any] = {
            "suggestionId": suggestion["suggestionId"],
            "sourceCluster": suggestion["sourceCluster"],
            "targetPerson": suggestion["targetPerson"],
            "decision": "applied",
            "idempotencyKey": "relationship-apply-1",
        }
        _expect_error(
            lambda: api.handle("review_photo_relationship_name_suggestion", base_params),
            "confirm=true",
        )
        _expect_error(
            lambda: api.handle(
                "review_photo_relationship_name_suggestion",
                {**base_params, "confirm": True, "targetPerson": "Jordan"},
            ),
            "stale",
        )
        _expect_error(
            lambda: api.handle(
                "review_photo_relationship_name_suggestion",
                {**base_params, "confirm": True, "targetPerson": "sam"},
            ),
            "stale",
        )

        applied = api.handle(
            "review_photo_relationship_name_suggestion",
            {**base_params, "confirm": True},
        )["value"]
        assert applied["applied"] is True and applied["idempotentReplay"] is False, applied
        assert applied["renamed"]["candidates"] == 3, applied
        assert applied["operation"]["operationType"] == "person_label_merge", applied
        assert applied["operation"]["canUndo"] is True and applied["operationId"], applied
        assert api.handle("suggest_photo_relationship_names", {})["value"]["suggestions"] == []

        replay = api.handle(
            "review_photo_relationship_name_suggestion",
            {**base_params, "confirm": True},
        )["value"]
        assert replay["applied"] is True and replay["idempotentReplay"] is True, replay
        assert replay["operationId"] == applied["operationId"], replay
        assert {name: _sha256(path) for name, path in source_paths.items()} == before_hashes

        undo = api.undo_photo_operation({"operationId": applied["operationId"]})
        assert undo["undone"] is True and undo["restored"] >= 6, undo
        restored = [candidate for candidate in api.project.candidates.values() if candidate.person_name == UNKNOWN]
        assert len(restored) == 3, restored
        assert {name: _sha256(path) for name, path in source_paths.items()} == before_hashes


if __name__ == "__main__":
    test_pure_relationship_ranker_is_deterministic_explainable_and_conservative()
    test_relationship_dismissal_persists_across_restart_and_hidden_people_are_excluded()
    test_relationship_graph_requires_consent_and_excludes_deleted_or_rejected_evidence()
    test_relationship_graph_enforces_subject_consent_without_requiring_profile_rows()
    test_relationship_apply_rejects_graph_evidence_that_changed_after_display()
    test_delete_face_data_clears_relationship_review_ledger_without_touching_originals()
    test_relationship_review_idempotency_is_preflighted_and_unicode_deletion_is_complete()
    test_relationship_apply_requires_fresh_confirmed_review_is_idempotent_and_undoable()
    print("all photo_relationship_suggestions_units tests passed")
