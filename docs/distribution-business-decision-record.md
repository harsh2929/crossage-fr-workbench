# Distribution and Business Decision Record

**Status:** PENDING OWNER AND LEGAL APPROVAL

This record closes FRONTIER-07 only after every required decision is explicit, internally consistent, dated, and signed. Blank fields are not defaults.

## Current Technical Facts

- The GitHub source repository is public.
- `package.json` marks the npm package `private: true`, version `0.1.0`, and license `UNLICENSED`.
- The app currently has no billing, checkout, account, activation, trial, subscription, edition-entitlement, or price contract.
- Core processing is local-first. Optional model packs are capability/download boundaries, not commercial entitlements.
- Commercial face-recognition distribution remains prohibited until counsel accepts documented commercial rights for the exact shipped weights and their training-data lineage.
- Signing, notarization, updates, release channels, SBOMs, and provenance machinery exist technically, but do not define a business policy.

## Required Decisions

Use one decision per row and attach the controlling policy, contract, or counsel note. `TBD` leaves the gate open.

| ID | Decision | Approved choice | Owner | Legal reviewer | Date | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Source-code license and contribution policy | | | | | |
| D02 | End-user/product license and permitted commercial uses | | | | | |
| D03 | Funding model: free, donation, one-time purchase, subscription, organization license, or other | | | | | |
| D04 | Editions and the exact feature/entitlement matrix | | | | | |
| D05 | Prices, currencies, taxes, regional availability, refunds, and transfers | | | | | |
| D06 | Account requirement, activation method, device limit, and recovery | | | | | |
| D07 | Offline guarantee, entitlement cache/grace period, and behavior when the service is unreachable or ends | | | | | |
| D08 | Which optional model packs are free/paid and who may download or redistribute each pack | | | | | |
| D09 | Commercial clearance for each face model/weight and its training-data lineage | | | | | |
| D10 | Stable/Beta/Internal channel eligibility and update/support lifetime per edition | | | | | |
| D11 | Security-update commitment and end-of-support notice period | | | | | |
| D12 | Telemetry/crash-report promise, retention, subprocessors, and opt-in/opt-out policy | | | | | |
| D13 | Privacy, biometric-consent, deletion, and jurisdiction/customer exclusions | | | | | |
| D14 | Customer support/SLA, warranty, liability, export-control, and acceptable-use terms | | | | | |
| D15 | App-store/direct-download distribution channels and publisher entities | | | | | |

## Conservative Baseline for Decision

The repository's technical recommendation is to keep privacy controls, catalog portability, security updates, and light local intelligence available without a paywall; keep heavy packs as explicit downloads; require no online account for the core local library; and introduce no entitlement server until D03-D07 define durable offline and service-termination behavior. Face recognition should remain non-commercial/research-only unless D09 is supported by rights evidence for the exact artifact.

This is an engineering recommendation, not an adopted policy.

## Implementation Consequences

After approval, create a traceable implementation issue for every affected surface: `LICENSE`/notices, `package.json`, installer EULA, About/Settings disclosures, website/store copy, entitlement and offline behavior, model manifests/download gates, update channels, telemetry defaults, support docs, tests, and release verification. If the approved model requires no entitlement system, record that explicit decision and test the account-free path.

## Approval

| Role | Name | Approve / reject | Date | Signature/evidence |
| --- | --- | --- | --- | --- |
| Product owner | | | | |
| Legal/counsel | | | | |
| Security/privacy owner | | | | |
| Release/engineering owner | | | | |

FRONTIER-07 remains open until this record is approved and all policy-driven implementation changes have passed their repository and release audits.
