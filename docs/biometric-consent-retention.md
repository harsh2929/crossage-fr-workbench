# Biometric Consent, Disclosure, and Retention

Vintrace provides local controls and evidence for biometric processing. It does
not decide which law applies, establish a lawful basis, replace counsel or a
DPO, or certify compliance. An operator must review the policy and workflow for
the actual organization, subjects, jurisdiction, and use.

## Strict workflow

1. Open **Settings > Privacy & Safety** and choose the jurisdiction preset.
   Changing a preset requires explicit confirmation. MCP changes also require
   the independent operator token.
2. Review and acknowledge the full AI and biometric processing notice. Strict
   presets keep workspace processing paused until the current notice version is
   acknowledged.
3. Before processing a subject, record the signer, signer role, specific
   purpose, lawful basis, collection term, written-notice acknowledgement, and
   electronic signature. The record is versioned, expiry-bound, and hashed.
4. Export the retention policy, obtain the required legal approval, publish the
   approved version over HTTPS where required, and record its exact URL,
   approver, and publication date. Vintrace validates the URL and policy/hash
   binding; it does not verify the page's legal sufficiency or availability.
5. Check **Stored subject coverage**. A strict workspace is not evidence-ready
   while any saved biometric subject lacks a complete current release.
6. Use **Enforce now** for an operator-triggered run. Strict presets also enforce
   expiry and retention during startup.

## Subject deletion

**Revoke release and delete subject data** requires confirmation and removes the
subject's references, candidate contexts, person/profile/hint links,
calibration and training rows, blocked pairs, relationship review state,
learned artifacts, derived metadata/search text, and regenerable private
caches. It removes release PII and writes a pseudonymous destruction receipt.

Vintrace does not delete original photos or videos during biometric subject
erasure. Originals can contain personal data and must be handled under the
operator's separate source-media policy. The receipt states that originals were
preserved.

New audit events pseudonymize person and operator fields. If an older or
free-text event still contains the subject name, deletion replaces it,
re-chains the retained events, and records an erasure checkpoint. Audit
retention similarly re-chains retained events behind a retention checkpoint.

## Evidence and encryption

The workspace key protects the SQLCipher database, `consent.json`, and each
line of `audit_log.jsonl`. Consent receipts are path-free. Shareable compliance
packs contain pseudonymous release, disclosure, policy/publication, destruction,
and audit evidence with a SHA-256 manifest.

Policy, receipt, and compliance-pack exports are intentionally readable. Store,
transmit, expire, and destroy them under the approved policy. Workspace
encryption does not retroactively protect old exports, backups, filesystem
snapshots, or source media.

## Legal-source snapshot

As reviewed on 2026-07-13:

- [Illinois BIPA Section 15](https://www.ilga.gov/ftp/ILCS/Ch%200740/Act%200014/074000140K15.html)
  calls for a public written retention/destruction policy, destruction when the
  purpose is satisfied or within three years of last interaction (whichever is
  first), written collection/purpose/term notice, and an executed written
  release.
- [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en)
  contains Article 50 transparency obligations whose applicability depends on
  the system, role, and use.
- The [Council's 29 June 2026 final-adoption notice](https://www.consilium.europa.eu/en/press/press-releases/2026/06/29/artificial-intelligence-council-gives-final-green-light-to-simplify-and-streamline-rules/)
  reported a 2 December 2026 transition deadline for affected generated-content
  transparency measures and 2 December 2027/2 August 2028 high-risk dates; it
  described Official Journal publication as the next step.

The presets are conservative operator defaults, not a legal conclusion. Recheck
the current official text and obtain qualified review before production use.
