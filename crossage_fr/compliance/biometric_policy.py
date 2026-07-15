from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any


CONSENT_SCHEMA_VERSION = 3
AI_DISCLOSURE_VERSION = "2026-07-14.1"
RETENTION_POLICY_VERSION = "2026-07-13.1"
DEFAULT_COLLECTION_PURPOSE = "Local face matching and human review in this Vintrace workspace."
MAX_COLLECTION_TERM_DAYS = 3650
SIGNER_ROLES = {"self", "parent-guardian", "authorized-representative", "operator-attestation"}

AI_DISCLOSURE_NOTICE: dict[str, Any] = {
    "version": AI_DISCLOSURE_VERSION,
    "title": "Vintrace AI and biometric processing notice",
    "summary": (
        "Vintrace uses local AI to detect faces, derive numeric face embeddings, compare similarity, "
        "and suggest possible matches for human review."
    ),
    "decisionBoundary": (
        "Similarity results are probabilistic investigative suggestions, not definitive identity decisions. "
        "A person must review every match before action."
    ),
    "dataFlow": (
        "Face templates and private review state stay in the selected local workspace unless the operator "
        "explicitly exports them. Source photos are not changed by consent or deletion operations."
    ),
    "generatedContent": (
        "Generative photo edits and consent-bound synthetic age references are identified as AI-generated "
        "content in Vintrace provenance. Synthetic age references are review-only aids, not authentic captures "
        "or predictions of future appearance. Signed C2PA credentials are a separate capability."
    ),
    "notUsedFor": [
        "autonomous identity decisions",
        "emotion recognition",
        "sensitive-trait categorization",
        "sale or advertising profiles",
    ],
    "legalBasis": (
        "The workspace operator is responsible for notice, lawful basis, written release where required, "
        "retention, disclosure, and responding to subject requests."
    ),
    "source": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689",
}


def now_iso(now: datetime | None = None) -> str:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def canonical_record_hash(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "recordHash"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(("vintrace-consent-release-v1\0" + canonical).encode("utf-8")).hexdigest()


def normalize_collection_term(value: Any, *, maximum_days: int = 0) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("The biometric collection term must be a whole number of days.") from exc
    upper = min(MAX_COLLECTION_TERM_DAYS, maximum_days) if maximum_days > 0 else MAX_COLLECTION_TERM_DAYS
    if days < 1 or days > upper:
        suffix = f" and no more than {upper}" if upper < MAX_COLLECTION_TERM_DAYS else ""
        raise ValueError(f"The biometric collection term must be at least 1 day{suffix}.")
    return days


def release_validation_errors(record: dict[str, Any], preset: dict[str, Any]) -> list[str]:
    if not bool(record.get("active")):
        return []
    errors: list[str] = []
    if not str(record.get("personName", "")).strip():
        errors.append("subject name")
    if not bool(preset.get("writtenReleaseRequired")):
        return errors
    if not str(record.get("signerName", "")).strip():
        errors.append("signer name")
    if str(record.get("signerRole", "")) not in SIGNER_ROLES:
        errors.append("signer role")
    if not str(record.get("specificPurpose", "")).strip():
        errors.append("specific purpose")
    try:
        normalize_collection_term(
            record.get("collectionTermDays"),
            maximum_days=int(preset.get("biometricMaxRetentionDays", 0) or 0),
        )
    except ValueError:
        errors.append("valid collection term")
    if not bool(record.get("writtenNoticeAcknowledged")):
        errors.append("written biometric notice acknowledgement")
    if not bool(record.get("electronicSignatureAccepted")):
        errors.append("electronic signature")
    if str(record.get("aiDisclosureVersion", "")) != AI_DISCLOSURE_VERSION:
        errors.append("current AI disclosure acknowledgement")
    if not str(record.get("lawfulBasis", "")).strip():
        errors.append("lawful basis")
    if parse_iso(record.get("expiresAt")) is None:
        errors.append("release expiry")
    expected_hash = canonical_record_hash(record)
    if not str(record.get("recordHash", "")) or str(record.get("recordHash")) != expected_hash:
        errors.append("valid release record hash")
    return errors


def release_is_complete(record: dict[str, Any], preset: dict[str, Any]) -> bool:
    return not release_validation_errors(record, preset)


def release_is_expired(record: dict[str, Any], *, now: datetime | None = None) -> bool:
    if not bool(record.get("active")):
        return True
    deadline = parse_iso(record.get("destructionDueAt") or record.get("expiresAt"))
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return deadline is not None and deadline <= current.astimezone(timezone.utc)


def build_release_record(
    *,
    person_name: str,
    source: str,
    operator: str,
    lawful_basis: str,
    release: dict[str, Any],
    preset: dict[str, Any],
    existing: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    previous = dict(existing or {})
    maximum_days = int(preset.get("biometricMaxRetentionDays", 0) or 0)
    default_term = int(preset.get("defaultCollectionTermDays", 365) or 365)
    term_days = normalize_collection_term(release.get("collectionTermDays", default_term), maximum_days=maximum_days)
    confirmed_at = str(previous.get("confirmedAt") or now_iso(current))
    expires_at = now_iso(current + timedelta(days=term_days))
    release_id = str(release.get("releaseId") or previous.get("releaseId") or "").strip()
    if not release_id:
        seed = f"{person_name.casefold()}\0{confirmed_at}\0{operator}\0{source}"
        release_id = "release_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
    record: dict[str, Any] = {
        "schemaVersion": CONSENT_SCHEMA_VERSION,
        "releaseId": release_id[:80],
        "active": True,
        "personName": str(person_name).strip()[:200],
        "source": str(source or "desktop")[:80],
        "operator": str(operator or "")[:120],
        "signerName": str(release.get("signerName", "")).strip()[:200],
        "signerRole": str(release.get("signerRole", "")).strip()[:40],
        "specificPurpose": str(release.get("specificPurpose") or DEFAULT_COLLECTION_PURPOSE).strip()[:1200],
        "collectionTermDays": term_days,
        "lawfulBasis": str(lawful_basis or release.get("lawfulBasis", "")).strip()[:200],
        "jurisdictionPreset": str(preset.get("id", "standard"))[:40],
        "retentionPolicyVersion": RETENTION_POLICY_VERSION,
        "writtenNoticeAcknowledged": bool(release.get("writtenNoticeAcknowledged")),
        "electronicSignatureAccepted": bool(release.get("electronicSignatureAccepted")),
        "aiDisclosureVersion": AI_DISCLOSURE_VERSION if release.get("aiDisclosureAcknowledged") else "",
        "confirmedAt": confirmed_at,
        "updatedAt": now_iso(current),
        "lastInteractionAt": str(previous.get("lastInteractionAt") or now_iso(current)),
        "expiresAt": expires_at,
        "destructionDueAt": expires_at,
        "note": str(release.get("note", "")).strip()[:800],
    }
    record["recordHash"] = canonical_record_hash(record)
    errors = release_validation_errors(record, preset)
    if errors:
        raise ValueError("A complete written biometric release requires: " + ", ".join(errors) + ".")
    return record


def build_retention_policy(preset: dict[str, Any], *, enforcement_enabled: bool) -> dict[str, Any]:
    reviewed_days = int(preset.get("retentionReviewedDays", 90) or 90)
    pending_days = int(preset.get("retentionPendingDays", max(180, reviewed_days)) or max(180, reviewed_days))
    audit_days = int(preset.get("auditRetentionDays", 365) or 365)
    max_biometric_days = int(preset.get("biometricMaxRetentionDays", 0) or 0)
    policy: dict[str, Any] = {
        "schemaVersion": 1,
        "policyVersion": RETENTION_POLICY_VERSION,
        "jurisdictionPreset": str(preset.get("id", "standard")),
        "title": "Vintrace biometric retention and destruction schedule",
        "status": "operator-policy-template",
        "publicPolicyRequired": bool(preset.get("publicPolicyRequired")),
        "enforcementEnabled": bool(enforcement_enabled),
        "schedule": {
            "subjectTemplates": {
                "destroyOn": ["release revoked", "stated purpose completed", "release expired"],
                "maximumDaysAfterLastInteraction": max_biometric_days or None,
            },
            "reviewedMatches": {"retainDays": reviewed_days},
            "pendingMatches": {"retainDays": pending_days},
            "auditEvidence": {"retainDays": audit_days, "subjectNamesPseudonymized": True},
            "originalMedia": {"managedByPolicy": False, "reason": "Vintrace does not delete source media during biometric erasure."},
        },
        "destructionMethod": (
            "Delete subject references, candidate rows, derived face/person links, consent PII, model-learning rows, "
            "and regenerable private caches; retain only a pseudonymous destruction receipt and audit event."
        ),
        "operatorAction": (
            "Review with qualified counsel, publish the approved policy where required, configure the intended term, "
            "and preserve evidence that the approved version was available before collection."
        ),
        "sources": list(preset.get("sources", [])) if isinstance(preset.get("sources"), list) else [],
        "disclaimer": (
            "Template only; not legal advice or a compliance certification. Applicability, lawful basis, exceptions, "
            "and final retention periods must be approved by the workspace operator's counsel or DPO."
        ),
    }
    canonical = json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    policy["policyHash"] = hashlib.sha256(
        ("vintrace-biometric-retention-policy-v1\0" + canonical).encode("utf-8")
    ).hexdigest()
    return policy
