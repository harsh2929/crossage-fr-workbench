# Open-Gates Owner Runbook

**Companion to:** `docs/2026-07-12-cutting-edge-expansion-implementation-ledger.md`
**Written:** 2026-07-15
**Purpose:** The ledger's six open items are complete in local engineering but each is blocked on an
**external, human, legal, or credential-backed** action that cannot be performed or simulated in a
development environment. Per the ledger's own rule, *no checkbox is closed by local simulation*. This
runbook is the concrete path an owner follows to close each gate, and how to verify closure.

## Local readiness re-verified (2026-07-15)

Independently re-ran, all green — the engineering side of every locally-verifiable open item passes:

| Command | Covers | Result |
|---|---|---|
| `node tests/cutting_edge_audit_contract.test.cjs` | ledger integrity (44 rows, 6 gates, 85 links) | ✅ ok |
| `node tests/mcp_registry.test.cjs` | MCP-07 descriptor + platform gates | ✅ ok |
| `node tests/release_signing_policy.test.cjs` + `tests/release_readiness_units.py` | SEC-01 fail-closed signing policy | ✅ ok |
| `node tests/supply_chain_release.test.cjs` | SEC-06 CycloneDX/SPDX SBOM, SLSA, cosign, attestations | ✅ ok |
| `npm run test:e2e:a11y` (4 Electron suites) | FRONTIER-04 Axe WCAG A/AA, keyboard/focus, reduced-motion/forced-colors, captions | ✅ 4/4 passed |

ML-05 and FRONTIER-07 have no runnable local component (hardware/dataset/human and legal-decision
respectively).

## Shared prerequisites (block MCP-07, SEC-01, SEC-06 together)

These are one-time setup steps the release-gated items share.

1. **Provision GitHub Actions secrets/variables/environments.** The public repo currently has *zero* of
   each. Add the exact production secret names the workflows require (see SEC-01 for Apple/Azure names)
   in a protected `release` environment.
2. **Bump the version.** `package.json` is still `0.1.0`, and a `v0.1.0` tag/release already exists, so
   the finalizer correctly refuses to reuse it. Choose a new version, curate a commit, and create one
   **new immutable tag** `v<package version>`.
3. **Land the workflows on the default branch.** The local central-release, Linux, and Registry
   workflows are not yet on the remote default branch (`main`); merge the curated commit so a real CI
   run can execute them.

---

## SEC-01 — Signed releases by default

- **Blocker:** real Developer ID (macOS) + Azure Trusted Signing (Windows) certificates; there is no
  unsigned release path by design.
- **Owner actions:**
  1. Provision the exact Apple secrets the macOS workflow reads: the Developer ID **certificate** and
     its **password**, plus **App Store Connect API** credentials for notarization. (Legacy `CSC_LINK`
     / Apple-ID fallbacks are intentionally rejected.)
  2. Provision Azure Trusted Signing: an **absolute, credential-free HTTPS** signing endpoint plus the
     account/profile/publisher, authenticated via SHA-pinned `azure/login` and GitHub OIDC
     (`id-token: write`). Confirm the publishing account's **region/type** is Azure Public Trust
     eligible.
  3. Run the macOS release workflow → produce a signed, **notarized, stapled**, Gatekeeper-accepted
     DMG/ZIP. Run the Windows release workflow → produce Azure-signed + RFC-3161-timestamped installer,
     app `.exe`, and bundled backend.
- **Verify closure:** independently download both installers; `codesign`/Gatekeeper + `spctl` on
  macOS, expected-publisher signature + timestamp on Windows. Operator guide: `docs/release-signing.md`.

## SEC-06 — Supply-chain provenance

- **Blocker:** a real GitHub-hosted release run — local execution cannot mint an Actions OIDC
  certificate or prove SLSA Build L2.
- **Owner actions:**
  1. With the workflows on the default branch and the new tag pushed, let all three platform jobs +
     the central finalizer run. They install pinned **Syft 1.44.0** + **cosign 3.0.6**, emit CycloneDX
     1.6 + SPDX 2.3 SBOMs, one SLSA attestation, GitHub attestations over each checksum set, and v0.3
     **keyless cosign** bundles.
  2. Let the finalizer verify transferred → draft → public artifacts at each trust boundary.
- **Verify closure:** `node desktop/scripts/verify-github-attestations.cjs` against the released
  subjects; `cosign verify-blob` returns `Verified OK`; retain the run/release URLs as evidence.
  Operator guide: `docs/release-supply-chain.md`.

## MCP-07 — Registry publication + host compatibility

- **Blocker:** the official Registry query for `io.github.harsh2929/vintrace` returns zero servers; a
  public record requires a real signed release with **both** macOS and Windows MCPB assets.
- **Owner actions:**
  1. After SEC-01/SEC-06 produce a signed release from the new tag (with both-platform MCPBs), run the
     manual Registry workflow (dry-run by default) authenticated with the pinned
     `mcp-publisher 1.8.0`, publishing the `io.github.harsh2929/vintrace` descriptor.
  2. Test the review UI (`ui://vintrace/image-review-v1.html`) under **MCP Apps** and the **ChatGPT
     Apps** bridge on a real host.
- **Verify closure:** the Registry returns the server record and it installs; the review UI renders and
  proxies tool/resource calls in both host bridges.

## ML-05 — Cross-age enrollment (image-space route)

- **Blocker:** needs ≥48 GiB RAM (this machine has 24), an **authorized** dataset (user-supplied
  FG-NET, never a mirror; AgeDB/CALFW authorization), the heavy Qwen-Image-Edit runtime pack, and
  **hash-bound human visual review** — none of which can be asserted locally.
- **Owner actions (on a capable, authorized machine):**
  1. Install the checksum-pinned `Qwen/Qwen-Image-Edit-2511` runtime pack; confirm ≥48 GiB memory.
  2. Supply an authorized FG-NET copy (flat-filename protocol) and attest dataset-term +
     synthetic-processing authorization to the two-phase `synthetic-age-image-eval-v1` runner.
  3. Perform the hash-bound human review — all four visual assertions per staged artifact — and pass
     the full-recognizer no-regression gates (AgeDB/CALFW/FG-NET).
- **Verify closure:** the `synthetic-age-image-benchmark` report is `complete` (not `incomplete`) with
  real generated portraits, zero false-positive/wrong-identity/precision/recall regression, and a
  recorded human-review decision.

## FRONTIER-04 — Accessibility sign-off

- **Blocker:** automated suites pass, but WCAG conformance requires **human** assistive-tech review
  against the exact signed release candidate.
- **Owner actions:** once a signed release candidate exists (SEC-01), conduct representative human
  review — macOS **VoiceOver**, a **Windows screen reader**, **Voice Control/Voice Access**, keyboard
  editor/media/slideshow, zoom/magnifier, and generated-caption usefulness.
- **Verify closure:** record the outcome in `docs/accessibility-manual-signoff.md` (currently
  `NOT SIGNED`).

## FRONTIER-07 — Distribution / business decision

- **Blocker:** a licensing/pricing/business-model decision — cannot honestly be completed by code or
  inferred policy.
- **Owner + counsel actions:** decide and record source/product licensing, commercial-use scope,
  edition/pricing/funding, account-free/offline behavior, update/support windows, telemetry promises,
  release channels, and commercial rights for every shipped face weight/training lineage.
- **Verify closure:** `docs/distribution-business-decision-record.md` moves from
  `PENDING OWNER AND LEGAL APPROVAL` to a signed decision.

---

## Dependency order

```
Shared prerequisites (secrets, version bump, merge workflows)
        │
        ▼
   SEC-01 (signed macOS + Windows release)
        │
        ├──► SEC-06 (attestations/SBOM/cosign from the same run)
        │
        └──► MCP-07 (both-platform MCPBs → Registry publish → host test)
                     │
                     ▼
             FRONTIER-04 (human a11y review vs the signed candidate)

ML-05        — independent; capable+authorized machine + human review
FRONTIER-07  — independent; owner + legal decision
```

Nothing above is closed by me: each remaining step is an external credential-backed run, a licensed
dataset on capable hardware, a human assistive-tech review, or an owner/legal decision.
