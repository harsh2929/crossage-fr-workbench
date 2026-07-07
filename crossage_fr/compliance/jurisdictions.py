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
        "notes": "Conservative local-first defaults suitable for personal/research use.",
    },
    "gdpr": {
        "label": "EU — GDPR / EU AI Act",
        "retentionReviewedDays": 30,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "notes": "GDPR Art 9 special-category + DPIA; EU AI Act high-risk logging. Tighter retention, per-subject consent.",
    },
    "bipa-il": {
        "label": "US — Illinois BIPA",
        "retentionReviewedDays": 30,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "notes": "BIPA written release + a public destruction schedule (destroy when purpose is met or within 3 years).",
    },
    "ccpa-cpra": {
        "label": "US — California CCPA/CPRA",
        "retentionReviewedDays": 60,
        "requireExplicitConsent": True,
        "perSubjectConsent": False,
        "dataMinimization": True,
        "auditRetentionDays": 730,
        "notes": "CPRA sensitive-personal-information limits and data minimization.",
    },
    "colorado": {
        "label": "US — Colorado CPA (HB24-1130)",
        "retentionReviewedDays": 45,
        "requireExplicitConsent": True,
        "perSubjectConsent": True,
        "dataMinimization": True,
        "auditRetentionDays": 1095,
        "notes": "Colorado biometric consent + a written retention/deletion policy.",
    },
}

DEFAULT_PRESET = "standard"


def list_jurisdictions() -> list[dict[str, Any]]:
    return [{"id": key, **value} for key, value in JURISDICTION_PRESETS.items()]


def jurisdiction_preset(preset_id: str) -> dict[str, Any] | None:
    preset = JURISDICTION_PRESETS.get(str(preset_id or "").strip().lower())
    return {"id": str(preset_id or "").strip().lower(), **preset} if preset else None
