from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile

from PIL import Image

from frozen_workspace_encryption import (
    AUDIT_ENCRYPTED_PREFIX,
    FILE_MAGIC,
    process_environment,
    rpc,
    rpc_error,
    start,
    stop,
    wait_startup,
)


SUBJECT = "Frozen Compliance Subject"
OPERATOR = "Frozen Privacy Officer"


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def create_test_image(path: Path) -> None:
    image = Image.new("RGB", (256, 256))
    image.putdata(
        [
            (
                (x * 17 + y * 3) % 256,
                (x * 5 + y * 19) % 256,
                (x * 11 + y * 13) % 256,
            )
            for y in range(256)
            for x in range(256)
        ]
    )
    image.save(path, format="PNG")


def assert_error_contains(error: dict, *needles: str) -> None:
    message = json.dumps(error, sort_keys=True).casefold()
    assert any(needle.casefold() in message for needle in needles), error


def release_payload() -> dict:
    return {
        "signerName": SUBJECT,
        "signerRole": "self",
        "specificPurpose": "Find and review family archive photos.",
        "collectionTermDays": 365,
        "lawfulBasis": "informed-written-release",
        "writtenNoticeAcknowledged": True,
        "electronicSignatureAccepted": True,
        "aiDisclosureAcknowledged": True,
        "note": "Frozen packaged-backend release acceptance.",
    }


def main() -> None:
    executable_value = str(os.environ.get("VINTRACE_ENCRYPTION_TEST_EXECUTABLE", "") or "").strip()
    if not executable_value:
        raise SystemExit("VINTRACE_ENCRYPTION_TEST_EXECUTABLE is required.")
    executable = Path(executable_value).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit(f"Frozen backend executable does not exist: {executable}")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-compliance-") as temp:
        root = Path(temp)
        workspace = root / "workspace"
        original = root / "subject-original.png"
        create_test_image(original)
        original_hash = file_hash(original)
        key = os.urandom(32)
        env = process_environment(root, workspace, key=key)

        process = start(executable, workspace, env)
        try:
            assert wait_startup(process).get("ready") is True
            assert_error_contains(
                rpc_error(process, "preset-no-confirm", "set_jurisdiction_preset", {"preset": "bipa-il"}),
                "confirm=true",
            )
            rpc(
                process,
                "preset",
                "set_jurisdiction_preset",
                {"preset": "bipa-il", "confirm": True},
            )
            assert_error_contains(
                rpc_error(
                    process,
                    "global-no-disclosure",
                    "set_consent",
                    {"value": True, "operator": OPERATOR},
                ),
                "ai and biometric",
                "disclosure",
            )
            rpc(
                process,
                "global-consent",
                "set_consent",
                {
                    "value": True,
                    "operator": OPERATOR,
                    "release": {"aiDisclosureAcknowledged": True},
                },
            )
            assert_error_contains(
                rpc_error(
                    process,
                    "enroll-no-release",
                    "enroll_paths",
                    {"personName": SUBJECT, "ageBucket": "adult", "paths": [str(original)]},
                ),
                "consent",
                "release",
            )
            assert_error_contains(
                rpc_error(
                    process,
                    "incomplete-release",
                    "set_consent",
                    {
                        "value": True,
                        "personName": SUBJECT,
                        "operator": OPERATOR,
                        "lawfulBasis": "informed-written-release",
                    },
                ),
                "complete written biometric release",
            )
            rpc(
                process,
                "subject-release",
                "set_consent",
                {
                    "value": True,
                    "personName": SUBJECT,
                    "operator": OPERATOR,
                    "lawfulBasis": "informed-written-release",
                    "release": release_payload(),
                },
            )
            enrolled = rpc(
                process,
                "enroll",
                "enroll_paths",
                {"personName": SUBJECT, "ageBucket": "adult", "paths": [str(original)]},
            )
            assert not enrolled.get("errors"), enrolled
            if int(enrolled.get("reviews", 0) or 0):
                review_status = rpc(process, "review-status", "synthetic_enrollment_screen_status", {})
                staged = [row for row in review_status.get("artifacts", []) if row.get("status") == "staged"]
                assert len(staged) == 1, review_status
                approval = rpc(
                    process,
                    "approve-review",
                    "approve_synthetic_enrollment_review",
                    {
                        "artifactId": staged[0]["artifactId"],
                        "allowSyntheticOverride": True,
                        "operator": OPERATOR,
                    },
                ).get("value", {})
                assert approval.get("approved") is True, approval
            else:
                assert int(enrolled.get("added", 0) or 0) == 1, enrolled

            unpublished = rpc(process, "unpublished", "compliance_status", {})
            assert unpublished.get("evidenceReady") is False, unpublished
            assert unpublished.get("subjects", {}).get("biometric") == 1, unpublished
            assert unpublished.get("subjects", {}).get("covered") == 1, unpublished
            assert_error_contains(
                rpc_error(
                    process,
                    "bad-publication",
                    "record_biometric_policy_publication",
                    {
                        "publicUrl": "http://example.test/biometric-retention",
                        "approvedBy": OPERATOR,
                        "confirm": True,
                    },
                ),
                "https url",
            )
            publication = rpc(
                process,
                "publication",
                "record_biometric_policy_publication",
                {
                    "publicUrl": "https://example.test/biometric-retention",
                    "approvedBy": OPERATOR,
                    "source": "frozen-compliance",
                    "confirm": True,
                },
            ).get("value", {})
            assert publication.get("current") is True, publication
            ready = rpc(process, "ready", "compliance_status", {})
            assert ready.get("evidenceReady") is True, ready
            assert ready.get("subjects", {}).get("missing") == 0, ready

            policy = rpc(
                process,
                "policy-export",
                "export_biometric_retention_policy",
                {"folder": str(root / "policy")},
            ).get("value", {})
            for field in ("jsonPath", "markdownPath", "htmlPath"):
                assert Path(str(policy.get(field, ""))).is_file(), policy
            policy_payload = json.loads(Path(policy["jsonPath"]).read_text(encoding="utf-8"))
            assert policy_payload.get("policyHash") == policy.get("policyHash"), policy
            assert policy_payload.get("documentHash") == policy.get("documentHash"), policy
        finally:
            stop(process)

        assert file_hash(original) == original_hash
        assert (workspace / "consent.json").read_bytes().startswith(FILE_MAGIC)
        assert (workspace / "audit_log.jsonl").read_bytes().startswith(AUDIT_ENCRYPTED_PREFIX)
        assert SUBJECT.encode() not in (workspace / "consent.json").read_bytes()
        assert SUBJECT.encode() not in (workspace / "audit_log.jsonl").read_bytes()

        reopened = start(executable, workspace, env)
        try:
            assert wait_startup(reopened).get("ready") is True
            persisted = rpc(reopened, "persisted", "compliance_status", {})
            assert persisted.get("evidenceReady") is True, persisted
            assert persisted.get("subjects", {}).get("biometric") == 1, persisted
            assert persisted.get("subjects", {}).get("covered") == 1, persisted
            assert_error_contains(
                rpc_error(
                    reopened,
                    "delete-no-confirm",
                    "delete_subject_data",
                    {"personName": SUBJECT, "confirm": False},
                ),
                "confirm=true",
            )
            deleted = rpc(
                reopened,
                "delete",
                "delete_subject_data",
                {
                    "personName": SUBJECT,
                    "confirm": True,
                    "reason": f"verified request from {SUBJECT}",
                    "source": "frozen-compliance",
                },
            ).get("deleted", {})
            assert deleted.get("references") == 1, deleted
            assert deleted.get("receipt", {}).get("originalMediaDeleted") is False, deleted
            assert SUBJECT not in json.dumps(deleted.get("receipt", {})), deleted
            assert Path(str(deleted.get("receiptPath", ""))).is_file(), deleted
            assert file_hash(original) == original_hash

            after_delete = rpc(reopened, "after-delete", "compliance_status", {})
            assert after_delete.get("subjects", {}).get("biometric") == 0, after_delete
            assert after_delete.get("subjects", {}).get("active") == 0, after_delete
            receipt_export = rpc(reopened, "receipt", "export_consent_receipt", {}).get("value", {})
            receipt_payload = json.loads(Path(receipt_export["jsonPath"]).read_text(encoding="utf-8"))
            assert receipt_payload.get("counts", {}).get("destructionReceipts") == 1, receipt_payload
            assert SUBJECT not in json.dumps(receipt_payload), receipt_payload
            audit = rpc(reopened, "audit", "audit_events", {"limit": 500})
            assert SUBJECT not in json.dumps(audit), audit
            assert any(
                row.get("action") == "enroll_paths"
                and str(row.get("person_name", "")).startswith("sha256:")
                for row in audit.get("events", [])
            ), audit
            delete_event = next(
                row for row in audit.get("events", [])
                if row.get("action") == "delete_subject_data"
            )
            pseudonymized = int(delete_event.get("counts", {}).get("auditEventsPseudonymized", 0) or 0)
            if pseudonymized:
                assert any(
                    row.get("action") == "audit_subject_erasure_checkpoint"
                    for row in audit.get("events", [])
                ), audit
            assert rpc(reopened, "chain", "audit_chain_status", {}).get("verified") is True
        finally:
            stop(reopened)

        assert (workspace / "consent.json").read_bytes().startswith(FILE_MAGIC)
        assert (workspace / "audit_log.jsonl").read_bytes().startswith(AUDIT_ENCRYPTED_PREFIX)
        assert SUBJECT.encode() not in (workspace / "consent.json").read_bytes()
        assert SUBJECT.encode() not in (workspace / "audit_log.jsonl").read_bytes()
        print(
            json.dumps(
                {
                    "frozen": True,
                    "strictConsent": True,
                    "publishedPolicy": True,
                    "restartPersistence": True,
                    "subjectErasure": True,
                    "originalPreserved": True,
                    "executableSha256": file_hash(executable),
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
