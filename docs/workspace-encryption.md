# Workspace Encryption

Vintrace production desktop workspaces encrypt biometric and private review
state at rest by default. Electron must unlock the database key before the
Python backend starts; startup fails closed when that key cannot be recovered.

## Protected data

- `workspace.sqlite3`, its WAL, and consistent backup snapshots use SQLCipher
  4 with a random 256-bit raw key.
- `references.json`, `review_candidates.json`, and `consent.json` use
  authenticated AES-256-GCM envelopes with role-bound associated data.
- `audit_log.jsonl` uses one authenticated, line-framed AES-256-GCM envelope
  per event. Reverse pagination, retention rewrites, and chain verification do
  not require decrypting the whole file at once.
- The plaintext `reference-vectors.npz` and FAISS sidecar are removed. Their
  in-memory index is rebuilt from the encrypted reference records.
- Workspace database temporary storage is forced to memory and SQLite mmap is
  disabled while encryption is active.

Original source photos and videos outside the workspace are not copied or
encrypted by this feature. Exported reports are intentionally readable files;
store or transmit them according to the operator's privacy policy.

## Key custody

Each workspace has a mode-`0600` `.vintrace-db-key.json` record. It contains a
key identifier and ciphertext, never the database key. Electron `safeStorage`
wraps the key through the signed-in OS account's credential facility: Keychain
on macOS, DPAPI-backed protection on Windows, and Secret Service or KWallet on
Linux. Linux fails closed when Electron reports `basic_text`, `unknown`, or no
protected backend; the hard-coded plaintext fallback is never accepted for a
biometric workspace key.

The key record is workspace-specific. Switching app folders restarts the
backend and unwraps the destination workspace's own key. Generated MCP/Codex
configuration never contains raw database keys.

## Migration

The first production open of an existing plaintext workspace performs an
atomic SQLCipher export, verifies both SQLite and cipher integrity, swaps the
encrypted database into place, and removes the retired plaintext database and
journals. Sensitive JSON files are then authenticated and encrypted, and
plaintext vector indexes are removed.

An interrupted migration is restart-safe: Vintrace either restores the intact
plaintext source or promotes the already-verified encrypted replacement. A
wrong or missing key is never treated as database corruption and never causes
an empty rebuild.

Overwriting a retired file is best effort on copy-on-write filesystems, SSDs,
snapshots, and cloud backup clients. For forensic-grade retirement, keep the
workspace on FileVault/BitLocker-protected storage and delete pre-migration
snapshots and old plaintext backup archives under the organization's media
destruction policy.

## Recovery and agents

Open **Settings > Privacy > Data encryption** and choose **Create agent code**.
Vintrace displays a random recovery code for the current session. The code is
not stored in plaintext; its scrypt-derived AES-256-GCM envelope is added to the
workspace key record, while Electron separately wraps the code for crash-safe
future key rotations.

Treat the recovery code like a password. It can decrypt the workspace on
another OS account when paired with the key record.

- The desktop-managed HTTP agent server receives an ephemeral OS-unwrapped key
  directly from Electron and requires no extra setup.
- The Vintrace MCPB asks for the agent recovery code as sensitive user config;
  compatible hosts store that value in their OS keychain.
- Source-based Codex, Claude, and generic stdio hosts should inject
  `VINTRACE_DB_RECOVERY_PASSPHRASE` through the host's secret environment. Do
  not paste it into a committed JSON/TOML file.
- Deployment owners may instead inject a 32-byte hex or URL-safe base64 key as
  `VINTRACE_WORKSPACE_DB_KEY`. This bypasses the desktop key record and makes
  key custody and rotation the deployment owner's responsibility.

Headless startup sets `VINTRACE_REQUIRE_DB_ENCRYPTION=1` and fails when neither
a direct key nor a valid recovery envelope is available.

## Rotation

Choose **Rotate key** in the same Privacy panel. Electron stages a new
OS-wrapped key, SQLCipher rekeys the live database, sensitive files are
rewrapped, and only then is the new key committed. A staged record retains both
keys until startup reconciliation, so interruption before or after the database
rekey cannot strand the workspace. Audit entries contain key identifiers only.

Restart standalone agent processes after rotation. Existing recovery codes
remain valid unless **Replace agent code** is used.

## Backups

Workspace ZIP backups contain an encrypted SQLCipher snapshot plus encrypted
biometric, consent, and audit entries. Optional whole-archive encryption with
`VINTRACE_BACKUP_PASSPHRASE` remains available for configuration, generated
media, and other non-workspace-key entries.
Backups made before migration are not retroactively protected; replace or
destroy them explicitly.

Restoring on the original OS account uses its wrapped key. Cross-account or
cross-machine restore requires the agent recovery code. Keep the recovery code
separate from exported backups.

## Verification

Run:

```bash
npm run test:workspace-encryption
npm run test:backup-roundtrip
VINTRACE_ENCRYPTION_TEST_EXECUTABLE=/path/to/crossage-backend npm run test:frozen-workspace-encryption
```

The focused suite covers plaintext migration, marker absence, stdlib SQLite
denial, missing/wrong-key refusal, WAL handling, consent/audit migration and
authentication, sensitive sidecars, backup and restore, cross-language recovery
envelopes, interrupted migration, and crash-safe rotation.
