# Vintrace — 10-Item Unlock Build (Design / Plan)

Date: 2026-06-14 · Branch: `feat/2026-unlock-build`
Source: the top-10 implementables from `docs/2026-capability-unlock-audit.md`.

## Goal

Implement the 10 highest-leverage unlocks in one continuous, backward-compatible push.
Legal/licensing/XL items land as **flagged mechanisms** (draft artifacts, default-off flags),
never as certified output or breaking changes.

## Cross-cutting principles

1. **Additive & backward-compatible.** No breaking schema swaps. `consent.json` v1 stays valid;
   new candidate/config fields are nullable with safe defaults; new behavior sits behind
   default-off flags so existing flows are byte-for-byte unchanged until opted in.
2. **TDD.** Extend the existing `assert_*` Python test scripts (run via `npm run test:*`,
   `CROSSAGE_FORCE_FALLBACK=1`, no real models). New commands must pass `tests/command_contract.py`.
3. **Legal honesty enforced in output.** Every generated DPIA/FRIA/Annex-IV/court-ready artifact is
   stamped `DRAFT — requires DPO/qualified-examiner + counsel review; not certification` and carries
   the research-tier weights warning. No artifact asserts positive identification or certification.

## Per-item design (dependency order)

### 1. Tamper-evident hash-chained audit (M)
- `_append_audit` (`enroll/manager.py:5987`) adds `seq` (monotonic int) + `prevHash` + `hash`
  (SHA-256 over canonical JSON of `prevHash` + the row sans hash). Already inside `_state_lock`.
- Track last `(seq, hash)` in memory; initialize by reading the last line on first append.
- New `verify_audit_chain()` method + `audit_chain_status` command + MCP tool: re-reads file,
  recomputes, reports first break index or `ok`. Legacy entries without `hash` are tolerated
  (chain "genesis" reported).
- `export_audit_log` payload gains `chain: {head, tail, length, verified, firstBreak}`.
- Tests (`tests/edge_cases.py`): append N → chain verifies; tamper a middle line → break detected
  at correct index; legacy entries tolerated.

### 5. Candidate-side capture_date plumbing (S–M)
- `ReviewCandidate` (`models.py`) gains nullable: `capture_date`, `reference_capture_date`,
  `age_gap_years`, `age_gap_confidence`.
- Propagate `capture_date` (`ingest/image_io.py:269` via `image_record_for_path`) into
  `embedding_metadata` at the scan/match site (`enroll/manager.py` ~1037–1050 / ~1216–1229);
  set `reference_capture_date` from the matched `ReferenceFace.capture_date`. Video frames use the
  source media date.
- `store/workspace_db.py`: idempotent `ALTER TABLE review_candidates ADD COLUMN` (guarded by a
  column-existence check) for the 4 cols; `payload_json` already auto-carries them.
- Tests (`tests/edge_cases.py` / `pipeline_smoke.py`): scanned candidate carries `capture_date`
  and `reference_capture_date`.

### 7. Age-gap uncertainty surfacing (M)
- New isolated module `crossage_fr/match/age_gap.py`: `compute_age_gap(candidate_date, reference_date)`
  → `(years: float|None, confidence: str, flag: str|None)`. NIST IFPC 2025 bands:
  ≤2y `high`, ≤4y `moderate`, ≤6y `low`, >6y `very-low`; flag `cross-age-gap` when years ≥ 4.
- Computed at candidate build; stored on candidate. `review_insights` gains `ageGapPending` count
  + lane. `match/scoring.py` risk-flag set gains `cross-age-gap`.
- Frontend: `src/types.ts` adds the 4 fields; `src/App.tsx` detail panel (~L8866–8870) renders an
  age-gap badge with confidence and a "NIST: wide-gap recognition is unreliable — human review
  required" caveat; row CSS class `risk-age-gap`.
- Tests: `tests/age_gap_units.py` (band boundaries); candidate carries computed gap.

### 6. Safe Mode zero-admittance toggle (S)
- `config.py` adds `safe_mode_zero_admittance: bool = False` (+ validation). When true,
  `safe_mode_face_crop_allowed()` (`manager.py:1005`) returns False unconditionally — the
  borderline-sensitive face-crop carve-out is disabled.
- Surface the carve-out count: `safeModeFaceCropAllowed` metric already tracked → expose in `state`
  and the `policy` block of `export_safe_mode_audit`.
- `save_settings`: re-enabling admittance (zero-admittance true→false) is a *relaxation* →
  confirm-gated (`mcp_server.py` save_settings relaxation logic).
- Frontend Settings: zero-admittance toggle + carve-out count display.
- Tests: with zero-admittance on, a borderline-sensitive centered-face image is filtered, not matched.

### 3. Per-subject consent (M, additive)
- `consent.json` → `schemaVersion: 2` additively: keep workspace-level `active` + add
  `subjects: { person_key: {active, operator, source, confirmedAt, updatedAt, note, lawfulBasis} }`.
- `set_consent` gains optional `person_name`; empty = workspace-level (unchanged). New
  `consent_for_person(person_name)` resolves subject record else workspace-level.
- Enforcement behind default-off `config.per_subject_consent`; when on, enroll/scan for a person
  also requires that subject's consent. Default off → zero behavior change.
- `export_consent_receipt` gains a per-subject breakdown. v1 files migrate lazily on load.
- Tests: set per-subject consent → receipt reflects it; flag on + missing subject consent blocks
  that person; v1 file still loads.

### 4. MCP hardening (S)
- Extract `_validate_operator_token(token)` helper in `mcp_server.py` (reuse the `mark_consent`
  operator-token pattern at :465). Gate `delete_face_data(include_audit=True)` over MCP behind the
  operator token (param `operator_token`, required only when `include_audit`).
- Add ASGI middleware in `_build_bearer_auth_app` (`mcp_server.py:1322`): token-bucket rate limit +
  concurrency semaphore, env-configurable (`VINTRACE_MCP_RATE_LIMIT`, `VINTRACE_MCP_MAX_CONCURRENCY`).
  Returns 429 on exhaustion. Outer of the bearer middleware.
- Tests (`tests/mcp_smoke.py` / `mcp_redaction.py`): `delete_face_data(include_audit=True)` without
  operator token raises; with token works. Rate-limiter unit test for the token-bucket logic.

### 9. Per-jurisdiction consent/retention presets (M, mechanism)
- New `crossage_fr/compliance/jurisdictions.py`: presets `standard | gdpr | bipa-il | ccpa-cpra |
  colorado` → `{retention_reviewed_days, require_explicit_consent, data_minimization,
  audit_retention_days, notes}`. Header: "operator-configurable defaults, not legal advice."
- `config.py` adds `jurisdiction_preset: str = "standard"` + `retention_reviewed_days: int = 90`.
- `set_jurisdiction_preset` command/MCP tool applies a preset to config. `retention_policy_report`
  reads `config.retention_reviewed_days` instead of the hardcoded 90.
- Frontend Settings: preset selector.
- Tests: applying `gdpr` sets retention/consent knobs; report reflects them.

### 2. Compliance / governance-evidence pack (M, mechanism)
- `export_compliance_pack` command/MCP tool zips: consent receipt, audit log (+ chain status),
  retention report, safe-mode audit, `model_distribution_audit`, build/provenance, accuracy
  evaluation — **plus** generated `DPIA-DRAFT.md`, `FRIA-DRAFT.md`, `annex-iv-technical-documentation.md`
  from templates filled with real workspace/model data. Reuses the `export_support_bundle` zip path.
  Every generated doc carries the DRAFT/non-certification + research-weights stamp.
- Tests: pack zip contains the expected members + the draft docs carry the disclaimer string.

### 8. Multi-workspace switcher (M)
- `workspace_registry.py`: new `workspace-list.json` ({known workspaces[], activeWorkspaceId}),
  migrated from `active-workspace.json` (kept in sync for back-compat). Functions:
  `list_workspaces`, `add_workspace`, `remove_workspace`, `set_active_workspace`.
- Backend `list_workspaces` / `add_workspace` commands. `set_workspace` adds to the registry on
  success.
- Desktop `main.cjs`: "Open Recent" menu from registry + `app.addRecentDocument`.
- Frontend `App.tsx`: workspace switcher dropdown near the workspace-path (~L4416); `types.ts` list type.
- Pre-existing MCP global-workspace race is out of scope (noted).
- Tests (`tests/edge_cases.py`): add 2 workspaces → list returns both; switch active persists; v1
  registry migrates.

### 10. Court-ready examination report (L, mechanism)
- `export_examination_report` command/MCP tool (per person or accepted set) → markdown + JSON
  documenting: examiner (operator), method (model id/version/checksum/license tier, thresholds,
  bands), each decision with score+band+age-gap+risk-flags+uncertainty statement, consent basis,
  safe-mode handling, audit-chain reference, explicit limitations (NIST ceiling, "investigative
  lead, not identification", research-weights stamp). Depends on items 1/5/7.
- Stamped `DRAFT examination report — requires qualified examiner review; not a positive identification`.
- Tests: report contains required sections + disclaimers.

## Out of scope (honest)
- Commercial-weights licensing (non-code), at-rest encryption (XL, separate), ER-02 fsync durability
  (separate predecessor — referenced in the court-ready report caveats).
- Per-subject consent ships schema + enforcement mechanism (default-off), not a per-vertical UX rewrite.

## Sequencing
1 → 5 → 7 → 6 → 3 → 4 → 9 → 2 → 8 → 10. Backend + tests first per item, then frontend, then MCP tools.
Final gate: backend slice of `npm run test` + `npm run build` (tsc).
