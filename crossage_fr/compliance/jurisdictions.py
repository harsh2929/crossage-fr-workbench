"""Per-jurisdiction consent/retention PRESETS.

These are operator-configurable DEFAULTS that nudge the workspace toward a jurisdiction's
posture (consent strictness, reviewed-match retention window, data minimization). They are
NOT legal advice and NOT a compliance certification. The applicability dates and statutory
details are forward-looking and must be confirmed with qualified counsel/DPO before any
customer-facing use (see docs/2026-capability-unlock-audit.md §10.2).
"""

from __future__ import annotations

from typing import Any

JURISDICTION_DISCLAIMER = (
    "Operator-configurable defaults only. NOT legal advice and NOT a compliance "
    "certification — confirm retention, consent, and lawful basis with qualified counsel/DPO."
)

JURISDICTION_PRESETS: dict[str, dict[str, Any]] = {
    "standard": {
        "label": "Standard (local-first default)",
        "retentionReviewedDays": 90,
        "requireExplicitConsent": True,
        "perSubjectConsent": False,
        "dataMinimization": True,
        "auditRetentionDays": 365,
        "retentionPendingDays": 365,
        "biometricMaxRetentionDays": 0,
        "defaultCollectionTermDays": 365,
        "writtenReleaseRequired": False,
        "publicPolicyRequired": False,
        "enforceByDefault": False,
        "sources": [],
        "notes": "Conservative local-first defaults suitable for personal/research use.",
    },
    "gdpr": {
        "label": "EU — GDPR / EU AI Act",
        "retentionReviewedDays": 30,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "retentionPendingDays": 90,
        "biometricMaxRetentionDays": 0,
        "defaultCollectionTermDays": 365,
        "writtenReleaseRequired": True,
        "publicPolicyRequired": True,
        "enforceByDefault": True,
        "sources": [
            {"label": "GDPR", "url": "https://eur-lex.europa.eu/eli/reg/2016/679/oj"},
            {"label": "EU AI Act Article 50", "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689"},
        ],
        "notes": "GDPR special-category/storage-limitation review plus EU AI Act transparency. No fixed GDPR retention term is implied by this preset.",
    },
    "bipa-il": {
        "label": "US — Illinois BIPA",
        "retentionReviewedDays": 30,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "retentionPendingDays": 90,
        "biometricMaxRetentionDays": 1095,
        "defaultCollectionTermDays": 365,
        "writtenReleaseRequired": True,
        "publicPolicyRequired": True,
        "enforceByDefault": True,
        "sources": [
            {"label": "Illinois BIPA 740 ILCS 14/15", "url": "https://www.ilga.gov/ftp/ILCS/Ch%200740/Act%200014/074000140K15.html"},
        ],
        "notes": "BIPA written release + a public destruction schedule (destroy when purpose is met or within 3 years).",
    },
    "ccpa-cpra": {
        "label": "US — California CCPA/CPRA",
        "retentionReviewedDays": 60,
        "requireExplicitConsent": True,
        "perSubjectConsent": False,
        "dataMinimization": True,
        "auditRetentionDays": 730,
        "retentionPendingDays": 180,
        "biometricMaxRetentionDays": 0,
        "defaultCollectionTermDays": 365,
        "writtenReleaseRequired": False,
        "publicPolicyRequired": True,
        "enforceByDefault": True,
        "sources": [
            {"label": "California Consumer Privacy Act", "url": "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?division=3.&chapter=1.&part=4.&lawCode=CIV&title=1.81.5"},
        ],
        "notes": "CPRA sensitive-personal-information limits and data minimization.",
    },
    "colorado": {
        "label": "US — Colorado CPA (HB24-1130)",
        "retentionReviewedDays": 45,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "retentionPendingDays": 120,
        "biometricMaxRetentionDays": 365,
        "defaultCollectionTermDays": 365,
        "writtenReleaseRequired": True,
        "publicPolicyRequired": True,
        "enforceByDefault": True,
        "sources": [
            {"label": "Colorado HB24-1130", "url": "https://leg.colorado.gov/bills/hb24-1130"},
        ],
        "notes": "Colorado biometric consent + a written retention/deletion policy.",
    },
}

DEFAULT_PRESET = "standard"


def list_jurisdictions() -> list[dict[str, Any]]:
    return [{"id": key, **value} for key, value in JURISDICTION_PRESETS.items()]


def jurisdiction_preset(preset_id: str) -> dict[str, Any] | None:
    preset = JURISDICTION_PRESETS.get(str(preset_id or "").strip().lower())
    return {"id": str(preset_id or "").strip().lower(), **preset} if preset else None
