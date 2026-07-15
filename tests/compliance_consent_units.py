from __future__ import annotations

from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile

from crossage_fr.api_server import DesktopApi
from crossage_fr.compliance import canonical_record_hash
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store.workspace_encryption import FILE_MAGIC, encode_workspace_key


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@contextmanager
def encrypted_environment(root: Path):
    names = (
        "VINTRACE_WORKSPACE_DB_KEY",
        "VINTRACE_REQUIRE_DB_ENCRYPTION",
        "VINTRACE_REGISTRY_HOME",
        "CROSSAGE_REGISTRY_HOME",
    )
    previous = {name: os.environ.get(name) for name in names}
    key = os.urandom(32)
    os.environ["VINTRACE_WORKSPACE_DB_KEY"] = encode_workspace_key(key)
    os.environ["VINTRACE_REQUIRE_DB_ENCRYPTION"] = "1"
    os.environ["VINTRACE_REGISTRY_HOME"] = str(root / "registry")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    try:
        yield key
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def release_payload(signer: str = "Alice Example", term_days: int = 365) -> dict:
    return {
        "signerName": signer,
        "signerRole": "self",
        "specificPurpose": "Find and review family archive photos.",
        "collectionTermDays": term_days,
        "lawfulBasis": "informed-written-release",
        "writtenNoticeAcknowledged": True,
        "electronicSignatureAccepted": True,
        "aiDisclosureAcknowledged": True,
        "note": "Electronic release acceptance test.",
    }


def seed_candidate(api: DesktopApi, person: str, candidate_id: str, source: Path, status: str = "accepted") -> None:
    project = api.project
    ref_id = f"ref_{candidate_id}"
    project.references[ref_id] = ReferenceFace(
        ref_id=ref_id,
        person_name=person,
        age_bucket="adult",
        source_path=str(source),
        capture_date="2026-01-01T00:00:00Z",
        quality=0.9,
        model_name="unit-model",
        vector=[0.01] * 512,
        source_hash=sha256(source),
    )
    project._mark_reference_dirty(ref_id)
    project.candidates[candidate_id] = ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(source),
        person_name=person,
        best_ref_id=ref_id,
        best_ref_path=str(source),
        score=0.82,
        band="likely",
        quality=0.85,
        model_name="unit-model",
        status=status,
        source_hash=sha256(source),
        created_at="2020-01-01T00:00:00Z",
    )
    project._mark_candidate_dirty(candidate_id)
    project.save()


def seed_subject_tables(api: DesktopApi, person: str, candidate_id: str, source: Path) -> str:
    project = api.project
    now = "2026-07-13T08:30:00Z"
    asset_id = "asset_subject"
    with project.db.connect() as conn:
        existing = conn.execute(
            "SELECT asset_id FROM photo_assets WHERE source_path = ? LIMIT 1",
            (str(source),),
        ).fetchone()
        if existing:
            asset_id = str(existing["asset_id"])
            conn.execute(
                "UPDATE photo_assets SET metadata_json = ?, updated_at = ? WHERE asset_id = ?",
                (json.dumps({"caption": "Alice Example portrait"}), now, asset_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO photo_assets(asset_id, source_path, added_at, updated_at, metadata_json)
                VALUES(?, ?, ?, ?, ?)
                """,
                (asset_id, str(source), now, now, json.dumps({"caption": "Alice Example portrait"})),
            )
        conn.execute(
            """
            INSERT OR REPLACE INTO photo_asset_people(
                asset_id, candidate_id, person_name, status, score, quality, band, updated_at
            )
            VALUES(?, ?, ?, 'accepted', 0.82, 0.85, 'likely', ?)
            """,
            (asset_id, candidate_id, person, now),
        )
        conn.execute(
            """
            INSERT INTO photo_people_profiles(person_name, created_at, updated_at)
            VALUES(?, ?, ?)
            """,
            (person, now, now),
        )
        conn.execute(
            """
            INSERT INTO photo_external_people_hints(
                hint_id, asset_id, provider, library_id, external_asset_id,
                person_name, status, created_at, updated_at
            ) VALUES('hint_subject', ?, 'photos', 'library', 'external', ?, 'accepted', ?, ?)
            """,
            (asset_id, person, now, now),
        )
        conn.execute(
            """
            INSERT INTO photo_people_groups(
                group_id, name, member_people_json, excluded_people_json, member_pets_json,
                excluded_pets_json, created_at, updated_at
            ) VALUES('group_subject', 'Family', ?, '[]', '["Milo"]', '[]', ?, ?)
            """,
            (json.dumps([person, "Bob Example"]), now, now),
        )
        conn.execute(
            """
            INSERT INTO photo_albums(
                album_id, name, include_people_json, exclude_people_json, rules_json, created_at, updated_at
            ) VALUES('album_subject', 'Subject album', ?, '[]', ?, ?, ?)
            """,
            (json.dumps([person]), json.dumps({"field": "person", "value": person}), now, now),
        )
        conn.execute(
            """
            INSERT INTO photo_saved_filters(filter_id, name, filters_json, rules_json, created_at, updated_at)
            VALUES('filter_subject', 'Subject filter', ?, ?, ?, ?)
            """,
            (json.dumps({"people": [person]}), json.dumps({"field": "person", "value": person}), now, now),
        )
        conn.execute(
            """
            INSERT INTO blocked_pairs(file_hash, person_name, best_ref_id, source_path, created_at)
            VALUES(?, ?, 'ref_subject', ?, ?)
            """,
            (sha256(source), person, str(source), now),
        )
        conn.execute(
            """
            INSERT INTO safety_cache(file_hash, model_version, threshold, sensitive, score, reason, engine, model_name, labels_json, created_at)
            VALUES(?, 'safe-v1', 0.5, 0, 0.1, 'unit', 'unit', 'unit', '{}', ?)
            """,
            (sha256(source), now),
        )
        conn.execute(
            """
            INSERT INTO embedding_cache(file_hash, model_version, detector_size, embeddings_json, created_at)
            VALUES(?, 'unit-model', 512, '[]', ?)
            """,
            (sha256(source), now),
        )
    project.db.add_calibration_label(
        "label_subject",
        {
            "sourcePath": str(source),
            "fileHash": sha256(source),
            "expectedPerson": person,
            "actualPerson": person,
            "matchScore": 0.8,
            "isMatch": True,
            "modelName": "unit-model",
        },
    )
    project.db.add_training_example(
        "training_subject",
        {
            "naturalKey": "training-subject",
            "candidateId": candidate_id,
            "sourcePath": str(source),
            "sourceHash": sha256(source),
            "expectedPerson": person,
            "actualPerson": person,
            "isMatch": True,
            "modelName": "unit-model",
        },
    )
    project.db.upsert_learned_artifact(
        "learned_subject",
        {
            "artifactType": "calibration",
            "status": "promoted",
            "modelName": "unit-model",
            "payload": {"people": [person]},
        },
    )
    project.config.calibration_platt = [1.0, 0.0]
    project.config.calibration_platt_by_person = {person: [1.0, 0.0]}
    project.config.calibration_adaptive = {
        "version": "adaptive-linear-v1",
        "weights": [0.0] * 512,
        "bias": 0.0,
        "dimension": 512,
        "modelName": "unit-model",
        "inputCount": 1,
        "positiveCount": 1,
        "negativeCount": 0,
    }
    project.config.calibration_model = "unit-model"
    project.save()
    return asset_id


def test_written_release_encrypted_and_subject_erasure_complete() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-compliance-consent-") as raw:
        root = Path(raw)
        workspace = root / "workspace"
        source = root / "alice-original.jpg"
        source.write_bytes(b"original-media-must-not-change\x00alice")
        original_hash = sha256(source)
        with encrypted_environment(root):
            api = DesktopApi(workspace, actor="compliance-unit")
            try:
                api.handle("set_jurisdiction_preset", {"preset": "bipa-il"})
            except ValueError as exc:
                assert "confirm=true" in str(exc)
            else:
                raise AssertionError("The jurisdiction preset changed without explicit confirmation.")
            api.handle("set_jurisdiction_preset", {"preset": "bipa-il", "confirm": True})
            try:
                api.handle("set_consent", {"value": True, "operator": "Privacy Officer"})
            except ValueError as exc:
                assert "AI and biometric" in str(exc)
            else:
                raise AssertionError("A strict preset granted workspace consent without the AI notice.")
            api.handle(
                "set_consent",
                {
                    "value": True,
                    "operator": "Privacy Officer",
                    "release": {"aiDisclosureAcknowledged": True},
                },
            )
            try:
                api.handle(
                    "set_consent",
                    {"value": True, "personName": "Alice Example", "lawfulBasis": "informed-written-release"},
                )
            except ValueError as exc:
                assert "complete written biometric release" in str(exc)
            else:
                raise AssertionError("BIPA accepted an incomplete subject release.")
            api.handle(
                "set_consent",
                {
                    "value": True,
                    "personName": "Alice Example",
                    "operator": "Privacy Officer",
                    "lawfulBasis": "informed-written-release",
                    "release": release_payload(),
                },
            )
            assert api.project.consent_for_person("Alice Example") is True
            consent_bytes = (workspace / "consent.json").read_bytes()
            assert consent_bytes.startswith(FILE_MAGIC)
            assert b"Alice Example" not in consent_bytes and b"Privacy Officer" not in consent_bytes
            try:
                api.handle(
                    "record_biometric_policy_publication",
                    {
                        "publicUrl": "http://example.test/privacy#retention",
                        "approvedBy": "Privacy Officer",
                        "confirm": True,
                    },
                )
            except ValueError as exc:
                assert "HTTPS URL" in str(exc)
            else:
                raise AssertionError("An insecure policy publication URL was accepted.")
            publication = api.handle(
                "record_biometric_policy_publication",
                {
                    "publicUrl": "https://example.test/privacy/biometric-retention",
                    "approvedBy": "Privacy Officer",
                    "source": "compliance-unit",
                    "confirm": True,
                },
            )["value"]
            assert publication["current"] is True
            status = api.handle("compliance_status", {})
            assert status["evidenceReady"] is True
            assert status["subjects"]["records"][0]["personName"] == "Alice Example"
            receipt_export = api.handle("export_consent_receipt", {})["value"]
            receipt_payload = json.loads(Path(receipt_export["jsonPath"]).read_text(encoding="utf-8"))
            assert "workspace" not in receipt_payload
            assert str(workspace) not in json.dumps(receipt_payload)
            assert receipt_payload["schemaVersion"] == 2
            assert receipt_payload["consent"]["subjects"]["alice example"]["recordHash"]
            assert receipt_payload["policy"]["retention"]["publication"]["current"] is True

            seed_candidate(api, "Alice Example", "candidate_subject", source)
            asset_id = seed_subject_tables(api, "Alice Example", "candidate_subject", source)
            api.project._append_audit(
                {
                    "action": "legacy_free_text_subject_evidence",
                    "detail": "Verified enrollment for Alice Example.",
                    "person_name": "Alice Example",
                }
            )
            pre_delete_audit = api.project._read_audit_rows()
            assert any("Alice Example" in json.dumps(row) for row in pre_delete_audit)
            minimized_event = pre_delete_audit[-1]
            assert minimized_event["person_name"].startswith("sha256:")
            covered_status = api.handle("compliance_status", {})
            assert covered_status["evidenceReady"] is True
            assert covered_status["subjects"]["biometric"] == 1
            assert covered_status["subjects"]["covered"] == 1
            assert covered_status["subjects"]["missing"] == 0
            assert covered_status["subjects"]["missingNames"] == []
            try:
                api.handle("delete_subject_data", {"personName": "Alice Example", "confirm": False})
            except ValueError as exc:
                assert "confirm=true" in str(exc)
            else:
                raise AssertionError("Subject deletion ran without confirmation.")
            deleted = api.handle(
                "delete_subject_data",
                {
                    "personName": "Alice Example",
                    "confirm": True,
                    "reason": "verified request from Alice Example",
                    "source": "compliance-unit",
                },
            )["deleted"]
            assert sha256(source) == original_hash
            assert deleted["references"] == 1 and deleted["candidates"] == 1
            assert deleted["dbDeleted"]["photoPeopleRows"] == 1
            assert deleted["dbDeleted"]["externalPeopleHints"] == 1
            assert deleted["dbDeleted"]["calibrationLabels"] == 1
            assert deleted["dbDeleted"]["learnedArtifacts"] >= 1
            assert deleted["receipt"]["counts"]["auditEventsPseudonymized"] >= 1
            assert deleted["receipt"]["auditErasureCheckpointHash"]
            receipt_text = Path(deleted["receiptPath"]).read_text(encoding="utf-8")
            assert "Alice Example" not in receipt_text and "Privacy Officer" not in receipt_text
            assert deleted["receipt"]["originalMediaDeleted"] is False
            assert deleted["receipt"]["receiptHash"]
            assert "alice example" not in json.dumps(api.project.consent).casefold()
            assert api.project.config.calibration_platt == []
            assert api.project.config.calibration_adaptive == {}
            post_delete_audit = api.project._read_audit_rows()
            assert "Alice Example" not in json.dumps(post_delete_audit)
            assert any(row.get("action") == "audit_subject_erasure_checkpoint" for row in post_delete_audit)
            assert api.project.verify_audit_chain()["verified"] is True

            with api.project.db.connect() as conn:
                for table in (
                    "review_candidates",
                    "photo_asset_people",
                    "photo_people_profiles",
                    "photo_external_people_hints",
                    "calibration_labels",
                    "training_examples",
                    "blocked_pairs",
                    "learned_artifacts",
                    "embedding_cache",
                    "safety_cache",
                ):
                    assert int(conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]) == 0, table
                assert int(conn.execute("SELECT COUNT(*) AS n FROM photo_assets").fetchone()["n"]) == 1
                group = conn.execute("SELECT member_people_json FROM photo_people_groups").fetchone()
                assert group is not None and "Alice Example" not in str(group["member_people_json"])
                album = conn.execute("SELECT include_people_json, rules_json FROM photo_albums").fetchone()
                assert album is not None and "Alice Example" not in str(dict(album))
                saved = conn.execute("SELECT filters_json, rules_json FROM photo_saved_filters").fetchone()
                assert saved is not None and "Alice Example" not in str(dict(saved))
                asset = conn.execute("SELECT metadata_json FROM photo_assets WHERE asset_id = ?", (asset_id,)).fetchone()
                assert asset is not None and "Alice Example" not in str(asset["metadata_json"])
                fts = conn.execute("SELECT * FROM photo_search_fts WHERE asset_id = ?", (asset_id,)).fetchone()
                assert fts is not None and "Alice Example" not in str(dict(fts))

            policy = api.handle("export_biometric_retention_policy", {})["value"]
            for key in ("jsonPath", "markdownPath", "htmlPath"):
                assert Path(policy[key]).is_file(), policy
            html_text = Path(policy["htmlPath"]).read_text(encoding="utf-8")
            markdown_text = Path(policy["markdownPath"]).read_text(encoding="utf-8")
            json_payload = json.loads(Path(policy["jsonPath"]).read_text(encoding="utf-8"))
            public_url = "https://example.test/privacy/biometric-retention"
            assert "Illinois BIPA" in html_text and "not legal advice" in html_text
            assert public_url in html_text and public_url in markdown_text
            assert json_payload["operatorApproval"]["publicUrl"] == public_url
            assert json_payload["policyHash"] == policy["policyHash"]
            assert json_payload["documentHash"] == policy["documentHash"]
            destruction_export = api.handle("export_consent_receipt", {})["value"]
            destruction_payload = json.loads(Path(destruction_export["jsonPath"]).read_text(encoding="utf-8"))
            assert destruction_payload["counts"]["destructionReceipts"] == 1
            assert destruction_payload["destructionReceipts"][0]["receiptHash"]
            assert "Alice Example" not in json.dumps(destruction_payload["destructionReceipts"])


def test_startup_enforces_expiry_and_candidate_windows() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-compliance-retention-") as raw:
        root = Path(raw)
        workspace = root / "workspace"
        source = root / "subject.jpg"
        source.write_bytes(b"retention-original")
        with encrypted_environment(root):
            api = DesktopApi(workspace, actor="retention-unit")
            api.handle("set_jurisdiction_preset", {"preset": "bipa-il", "confirm": True})
            api.handle(
                "set_consent",
                {"value": True, "operator": "Privacy Officer", "release": {"aiDisclosureAcknowledged": True}},
            )
            api.handle(
                "set_consent",
                {
                    "value": True,
                    "personName": "Expired Subject",
                    "operator": "Privacy Officer",
                    "lawfulBasis": "informed-written-release",
                    "release": release_payload("Expired Subject", term_days=1),
                },
            )
            seed_candidate(api, "Expired Subject", "expired_subject_candidate", source)
            seed_candidate(api, "Other Subject", "old_reviewed_candidate", source, status="accepted")
            seed_candidate(api, "Other Subject", "old_pending_candidate", source, status="pending")
            consent = copy.deepcopy(api.project.consent)
            record = consent["subjects"]["expired subject"]
            record["expiresAt"] = "2020-01-02T00:00:00Z"
            record["destructionDueAt"] = "2020-01-02T00:00:00Z"
            record["recordHash"] = canonical_record_hash(record)
            api.project.consent = consent
            api.project._append_audit(
                {
                    "at": "2020-01-01T00:00:00Z",
                    "action": "old_subject_audit_evidence",
                    "person_name": "Expired Subject",
                }
            )
            api.project.save()

            reopened = DesktopApi(workspace, actor="retention-reopen")
            startup = reopened.project._retention_startup_result
            assert startup["enabled"] is True
            assert startup["expiredSubjectsDeleted"] == 1, startup
            assert startup["reviewedCandidatesDeleted"] >= 1, startup
            assert startup["pendingCandidatesDeleted"] >= 1, startup
            assert startup["auditEventsDeleted"] >= 1, startup
            assert all(
                ref.person_name != "Expired Subject"
                for ref in reopened.project.references.values()
            )
            assert any(
                ref.person_name == "Other Subject"
                for ref in reopened.project.references.values()
            )
            assert reopened.project.db.candidate_count() == 0
            assert sha256(source) == hashlib.sha256(b"retention-original").hexdigest()
            assert reopened.project.subject_consents() == {}
            assert reopened.project.verify_audit_chain()["verified"] is True
            compliance = reopened.project.compliance_status()
            assert compliance["evidenceReady"] is False
            assert compliance["subjects"]["biometric"] == 1
            assert compliance["subjects"]["covered"] == 0
            assert compliance["subjects"]["missing"] == 1
            assert compliance["subjects"]["missingNames"] == ["Other Subject"]
            audit_rows = reopened.project._read_audit_rows()
            assert not any(row.get("action") == "old_subject_audit_evidence" for row in audit_rows)
            assert any(row.get("action") == "audit_retention_checkpoint" for row in audit_rows)
            assert "Expired Subject" not in json.dumps(audit_rows)


def main() -> None:
    test_written_release_encrypted_and_subject_erasure_complete()
    test_startup_enforces_expiry_and_candidate_windows()
    print("compliance consent and retention units ok")


if __name__ == "__main__":
    main()
