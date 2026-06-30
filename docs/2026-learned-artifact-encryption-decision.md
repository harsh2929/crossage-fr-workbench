# Learned Artifact Encryption Decision

Status: recorded decision for the 2026 self-learning rollout.

## Decision

Do not add a separate ad hoc encryption layer only around `learned_artifacts`
payloads in the current self-learning implementation.

Learned artifacts and training examples inherit the workspace storage security
model today. When workspace encryption at rest is added, it must cover the
SQLite workspace database as a storage boundary, including:

- `learned_artifacts`
- `training_examples`
- `calibration_labels`
- embedding-cache metadata
- candidate/review rows that can identify people or media

Backups already support optional encrypted ZIP output through
`VINTRACE_BACKUP_PASSPHRASE`; that is backup encryption, not live workspace
database encryption.

## Rationale

Encrypting only learned artifact JSON would be incomplete. The same sensitive
facts are also present in training examples, calibration labels, candidate rows,
source hashes, model names, review decisions, and audit context. A payload-only
scheme would leave side channels in adjacent tables while adding key lifecycle
complexity and migration risk.

The correct boundary is the workspace database or workspace storage layer, with
one documented key-management story and one recovery/restore path.

## Current Controls

- Learned artifacts do not store raw media.
- Suggested-reference artifacts omit source paths from payloads.
- Adapter artifacts store JSON coefficients/features, not retrained recognizer
  weights or raw vectors.
- Artifact hashes are deterministic and tamper-evident.
- Learning mutations require consent and are audit-logged.
- Support bundles exclude learned artifact payloads and training examples.
- Delete/retention/person cleanup removes learned rows where appropriate.
- Workspace backup ZIPs can be encrypted with the existing backup passphrase
  path and are tested in `tests/workspace_backup_roundtrip.py`.

## Required Before Claiming Live At-Rest Encryption

- Threat model for local disk compromise, backups, crash dumps, and support
  exports.
- Key source and rotation plan, preferably OS keychain-backed with a documented
  recovery story.
- Migration path for existing plaintext workspace databases.
- Integrity story that composes with the existing artifact hashes and audit
  chain.
- Tests proving encrypted open, wrong-key failure, backup/restore, delete, and
  support-bundle redaction.
- Clear UI language distinguishing encrypted backups from encrypted live
  workspace storage.

## Plan Impact

The self-learning loop may ship with the current controls, but documentation and
release notes must not claim learned artifacts are encrypted at rest until the
workspace storage layer actually provides that property.
