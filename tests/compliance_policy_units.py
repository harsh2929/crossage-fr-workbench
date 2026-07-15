from __future__ import annotations

from datetime import datetime, timedelta, timezone

from crossage_fr.compliance import (
    AI_DISCLOSURE_VERSION,
    RETENTION_POLICY_VERSION,
    build_release_record,
    build_retention_policy,
    canonical_record_hash,
    jurisdiction_preset,
    release_is_complete,
    release_is_expired,
    release_validation_errors,
)


def complete_release() -> dict:
    return {
        "signerName": "Alex Example",
        "signerRole": "self",
        "specificPurpose": "Find family photographs for a private archive.",
        "collectionTermDays": 365,
        "lawfulBasis": "informed-written-release",
        "writtenNoticeAcknowledged": True,
        "electronicSignatureAccepted": True,
        "aiDisclosureAcknowledged": True,
        "note": "Signed electronically in Vintrace.",
    }


def test_bipa_release_is_hashed_bounded_and_expiring() -> None:
    preset = jurisdiction_preset("bipa-il")
    assert preset is not None
    now = datetime(2026, 7, 13, 8, 30, tzinfo=timezone.utc)
    record = build_release_record(
        person_name="Alex Example",
        source="unit-test",
        operator="Privacy Officer",
        lawful_basis="informed-written-release",
        release=complete_release(),
        preset=preset,
        now=now,
    )
    assert record["aiDisclosureVersion"] == AI_DISCLOSURE_VERSION
    assert record["retentionPolicyVersion"] == RETENTION_POLICY_VERSION
    assert record["recordHash"] == canonical_record_hash(record)
    assert release_is_complete(record, preset)
    assert not release_is_expired(record, now=now + timedelta(days=364))
    assert release_is_expired(record, now=now + timedelta(days=366))

    tampered = {**record, "specificPurpose": "A different purpose"}
    assert "valid release record hash" in release_validation_errors(tampered, preset)
    assert not release_is_complete(tampered, preset)


def test_strict_release_rejects_missing_notice_and_excessive_term() -> None:
    preset = jurisdiction_preset("bipa-il")
    assert preset is not None
    missing = complete_release()
    missing["writtenNoticeAcknowledged"] = False
    try:
        build_release_record(
            person_name="Alex Example",
            source="unit-test",
            operator="Privacy Officer",
            lawful_basis="informed-written-release",
            release=missing,
            preset=preset,
        )
    except ValueError as exc:
        assert "written biometric notice" in str(exc)
    else:
        raise AssertionError("A strict preset accepted a release without written notice acknowledgement.")

    excessive = complete_release()
    excessive["collectionTermDays"] = 1096
    try:
        build_release_record(
            person_name="Alex Example",
            source="unit-test",
            operator="Privacy Officer",
            lawful_basis="informed-written-release",
            release=excessive,
            preset=preset,
        )
    except ValueError as exc:
        assert "no more than 1095" in str(exc)
    else:
        raise AssertionError("The BIPA template accepted a term beyond its statutory outer bound.")


def test_policy_distinguishes_operator_template_from_certification() -> None:
    preset = jurisdiction_preset("gdpr")
    assert preset is not None
    policy = build_retention_policy(preset, enforcement_enabled=True)
    assert policy["status"] == "operator-policy-template"
    assert policy["publicPolicyRequired"] is True
    assert policy["schedule"]["subjectTemplates"]["maximumDaysAfterLastInteraction"] is None
    assert policy["schedule"]["reviewedMatches"]["retainDays"] == 30
    assert policy["enforcementEnabled"] is True
    assert len(policy["policyHash"]) == 64
    assert policy["policyHash"] == build_retention_policy(preset, enforcement_enabled=True)["policyHash"]
    assert policy["policyHash"] != build_retention_policy(preset, enforcement_enabled=False)["policyHash"]
    assert "not legal advice" in policy["disclaimer"].lower()
    assert any("eur-lex" in row["url"] for row in policy["sources"])


def main() -> None:
    test_bipa_release_is_hashed_bounded_and_expiring()
    test_strict_release_rejects_missing_notice_and_excessive_term()
    test_policy_distinguishes_operator_template_from_certification()
    print("compliance policy units ok")


if __name__ == "__main__":
    main()
