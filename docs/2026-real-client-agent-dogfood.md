# Real-client Vintrace agent dogfood — 2026-07-11

## Purpose and status

This program runs 18 identical golden image workflows through real authenticated Codex, Claude Code, and Claude Desktop clients against an isolated 1,000-asset Vintrace library. It measures the model/client experience rather than treating protocol conformance as agent evidence.

Current status:

- Codex: complete, post-fix 18/18 matrix with wire traces.
- Claude Code: complete, post-fix 18/18 matrix with wire traces after the authenticated account's five-hour usage window reset at 22:50 IST.
- Claude Desktop: version 1.20186.1 installed, image-only MCP configuration safely merged with a restorable backup, but the Desktop app has no session cookie and is logged out. Protocol calls are not counted as Desktop sessions.

The goal is not complete until the remaining Claude Desktop real-client row is run. This document records the completed evidence and the exact remaining external prerequisite without inflating coverage.

## Test contract

The fixture contains 1,000 unique 48×36 PNG assets in ten deterministic 100-asset cohorts. Five assets carry the exact `golden needle amber lighthouse SN-1042` target, and 20 red-bicycle product assets are favorites. Every client receives a private copy of the workspace; no user photo library is touched.

The 18 workflows cover:

1. Connection and compact capability discovery.
2. Library overview and active work.
3. Exact lexical search.
4. Typed favorite/metadata filtering.
5. Search then stable-ID metadata fetch.
6. Existing OCR/object/barcode/quality intelligence.
7. One bounded, audited preview.
8. Recipe discovery.
9. Plan-only recipe binding.
10. Metadata write planning.
11. Confirmed idempotent metadata execution and verification.
12. Confirmed album creation.
13. Confirmed contact-sheet artifact generation.
14. Unified operation and path-free manifest inspection.
15. Authorized inbound-source listing without network discovery.
16. Missing-intelligence batch planning without execution.
17. Library health and dry-run cleanup planning.
18. Approval/failure/replay/pixel-disclosure activity audit.

The source of truth is [workflows.json](../tests/agent_dogfood/workflows.json). `mcp_trace_proxy.py` transparently proxies stdio JSON-RPC and records request/response timestamps. Tool selection is scored from `tools/call` messages, not inferred from final prose.

## Metric definitions

- **Connection success:** a completed workflow made at least one real Vintrace `tools/call` through an initialized client connection.
- **First-tool accuracy:** the first call is in the workflow's accepted first-tool set.
- **Tool-selection precision:** accepted calls divided by all Vintrace calls.
- **Ideal-workflow accuracy:** correct first tool, only accepted tools, and no more than the declared call budget.
- **Calls-to-artifact:** one-indexed tool call on which a successful `export_photo_contact_sheet` result first exists.
- **Approval friction:** service `confirmation_required` denials, confirmed write calls, and Desktop host approval clicks. CLI hosts are intentionally pre-approved so service policy is measured independently from interactive host chrome.
- **Search acceptance:** all seeded expected stable IDs are present in the actual search response.
- **Service time:** sum of MCP request→response durations. **Model/client time** is end-to-end elapsed time minus service time.
- **Time saved per 1,000 assets:** a transparent modeled operator-review benchmark, not a fabricated human observation. It assumes two seconds to visually inspect/classify one asset (2,000 seconds per 1,000) and compares that with the mean end-to-end duration of nine asset-intensive agent workflows. A future human study can replace the assumption without changing the measured agent timings.

## Codex final results

Real client: `codex-cli 0.144.0-alpha.4`, authenticated with ChatGPT, ephemeral isolated sessions, Vintrace-only required MCP config, read-only shell sandbox, and service-confirmed write lanes.

| Metric | Final result |
| --- | ---: |
| Workflows completed | 18 / 18 |
| Connection success | 100% |
| First-tool accuracy | 100% |
| Tool-selection precision | 100% |
| Ideal-workflow accuracy | 100% |
| Seeded-search acceptance | 100% |
| Service approval denials | 0 |
| Confirmed writes | 3 |
| Calls to verified contact-sheet artifact | 3 |
| Total end-to-end time | 422.154 s |
| MCP service time | 54.549 s |
| Model/client time | 367.605 s |
| Mean asset-intensive workflow | 28.548 s |
| Modeled time saved per 1,000 assets | 1,971.452 s / 32.86 min (98.57%) |

The contact-sheet workflow is now the intended three-call sequence: `search_images` → `plan_image_action` → confirmed `run_image_write_action`. The result contains a stable agent operation ID and `vintrace://` operation resource; filesystem paths are hidden.

## Claude Code final results

Real client: Claude Code 2.1.111, authenticated Max subscription, Sonnet, non-persistent print sessions, project/user settings and hooks excluded, strict Vintrace-only MCP configuration, and explicit allowlisting of the 23 compact image tools.

| Metric | Final result |
| --- | ---: |
| Workflows completed | 18 / 18 |
| Connection success | 100% |
| First-tool accuracy | 100% |
| Tool-selection precision | 100% |
| Ideal-workflow accuracy | 100% |
| Seeded-search acceptance | 100% |
| Service approval denials | 0 |
| Confirmed writes | 3 |
| Host approval clicks | 0 (CLI pre-approved) |
| Calls to verified contact-sheet artifact | 3 |
| Total end-to-end time | 480.782 s |
| MCP service time | 123.002 s |
| Model/client time | 357.780 s |
| Mean asset-intensive workflow | 37.054 s |
| Modeled time saved per 1,000 assets | 1,962.946 s / 32.72 min (98.15%) |

The final result is a composite of the complete sequential run plus verified targeted reruns on the same workspace after each trace-driven fix. Replaced traces are removed before reruns, so metrics do not double-count calls. The time-saved figure uses the same declared 2-second-per-asset modeled baseline as Codex; it is not an observed human timing study.

## Friction found and fixed

### 1. Tool-surface and capability payload overload

Before the fix, a one-line capability question exposed 126 MCP tools and caused a full 163-action response. The trace was 526,320 bytes and the real Codex turn took 25.5 seconds.

The recommended `--tool-profile images` now exposes 23 stable-ID image front doors while preserving every one of the 163 image actions behind the plan/read/write/destructive lanes. `include_actions` defaults to false and its description tells models to request a category only when an exact long-tail action is unknown.

Validated result: 23 visible tools, a 24,764-byte trace (95.3% smaller), and 12.3 seconds for the same real session.

### 2. Free-form schemas caused retries

Models supplied `ocr` where the service expects `text`, invented filter keys, used invalid sort values, and guessed action names. The MCP schema now publishes enums for intelligence capabilities, capability categories, sort modes, and typed search filters. Natural aliases such as `favorite`, `media_type`, `mediaType`, `tags`, `objects`, `dominantColor`, and nested metadata are normalized into exact search semantics instead of being silently ignored.

Existing-intelligence dogfood fell from four calls / 63.3 seconds to two calls / 23.1–33.9 seconds.

### 3. Routine action-name discovery was too expensive

The planner required backend action names but did not teach common mappings. It now advertises exact common names and accepts bounded aliases (`create_manual_album`, `create_contact_sheet`, metadata aliases, catalog cleanup). Snake-case payload fields normalize to canonical camelCase, and plans return `normalizedPayload` for exact execution.

Album creation fell from seven calls / 49.6 seconds to two calls / 16.4 seconds in the targeted rerun.

### 4. Artifact delivery lacked a direct operation identity

Confirmed writes now return `agentOperationId` plus `operationResourceUri`. The model no longer needs a follow-up operation scan to deliver an artifact. Contact-sheet calls-to-artifact fell from six to three.

### 5. Multi-index planning caused repeated search and planning

`enqueue_photo_indexing_job` now accepts a plan-only `capabilities` intent and returns separate OCR/object/barcode `batchPlans` in one response. Execution rejects an unexpanded batch so each real job retains its own approval and idempotency key. The targeted workflow fell from 16 calls / 67.5 seconds to four calls / 44.0 seconds.

### 6. Redaction mixed up paths, MIME types, and stable resources

Dogfood found that generated `targetPath`/`manifestPath` could be preserved while `image/png` and `vintrace://...` were partially masked. Compact image-agent tools now always hide source and generated filesystem paths while retaining MIME types and stable resource URIs. Full-profile legacy backup tools keep only operator-requested destination paths so export→verify→restore chaining remains compatible.

### 7. Operation-kind spelling caused an unnecessary retry

Operation filters now normalize `agent_write` to `agent-write` and common singular/plural aliases. The operation workflow is two calls on a populated sequential workspace.

### 8. Cross-model count semantics were ambiguous

Claude Code initially called library overview before capability discovery because both tools said they returned “counts.” The schemas now state that capability discovery is the sole source for action/category counts and batch/fetch limits, while overview reports asset/media counts. The capability workflow moved from two calls to one.

### 9. Overview and operation follow-ups were underspecified

Claude Code polled scan and indexing jobs after overview, then used activity audit and repeated filtered/unfiltered operation feeds to find one durable export. Overview now states that its bounded indexing/export summaries are sufficient unless detailed job state was explicitly requested. The durable-operation tool has a typed kind enum, explains that write-lane contact sheets are `agent-write` operations, and directs agents away from the activity audit feed. Overview moved from three calls to one; operation trace moved from five calls to two.

### 10. Successful search results did not end discovery decisively

Missing-index planning repeated a reformulated search after the first search had already returned 50 matching document assets. Search guidance now tells agents to use a successful bounded shortlist rather than broadening merely to seek more. The workflow moved from four calls to the intended three. Its final 78.851-second elapsed time was still dominated by 64.490 seconds of model/client reasoning plus 14.361 seconds of service work, not extra tool calls.

### 11. Dry-run cleanup planning encouraged self-correction

Health planning first discovered the maintenance catalog, then a natural `dry_run: true` plan was accepted without becoming canonical because the action schema incorrectly advertised `commit` and `apply` as strings. Health overview now returns an exact path-free cleanup planning hint, `dry_run` normalizes to `commit: false`, and the action catalog types those flags as booleans. The final workflow is `get_image_library_overview` → `plan_image_action`, with no discovery or duplicate plan call.

### 12. Claude Code's variadic tool flag swallowed the prompt

The first post-reset client smoke initialized Vintrace and listed all 23 tools, then exited before a model turn because Claude Code's variadic `--tools` flag consumed the trailing positional prompt. The harness now sends Claude prompts over stdin. This was a runner defect, not a product, authentication, quota, or MCP connection failure, and the failed smoke is not included in final metrics.

## Reproduction and evidence

```bash
npm run agent:dogfood:prepare
.venv/bin/python tests/agent_dogfood/dogfood.py run --client codex
.venv/bin/python tests/agent_dogfood/dogfood.py run --client claude-code
.venv/bin/python tests/agent_dogfood/dogfood.py desktop-bundle
.venv/bin/python tests/agent_dogfood/dogfood.py desktop-install
node tests/agent_dogfood/desktop_runner.cjs --endpoint http://127.0.0.1:9333 --prompts .artifacts/agent-dogfood/runs/claude-desktop/desktop-prompts.json --output .artifacts/agent-dogfood/runs/claude-desktop
.venv/bin/python tests/agent_dogfood/dogfood.py desktop-split
.venv/bin/python tests/agent_dogfood/dogfood.py score
```

Generated, uncommitted evidence lives under `.artifacts/agent-dogfood/`:

- `runs/<client>/runs.json`: exit and wall-clock records.
- `runs/<client>/traces/<workflow>.jsonl`: MCP wire evidence.
- `score.json`: computed client and workflow metrics.
- `pre-fix/`, `pre-action-fixes/`, and `final-selected/`: retained before/after evidence.

## Verification

The following source suites pass after the fixes:

- `npm run test:agent-images`
- `npm run test:agent-workflows`
- `npm run test:agent-dogfood-contract`
- `npm run test:mcp-image-profile`
- `npm run test:mcp`
- `npm run test:mcp-redaction`
- `npm run test:mcp-connection`
- `npm run test:e2e:agents`

The freshly rebuilt frozen backend also passes the full MCP smoke suite, the compact 23-tool image-profile suite,
and the direct HTTP/OpenAPI suite. Its SHA-256 is
`da422eff31201d10f04cf1053e4367ce314ded4da5ba15d92d29e38a2223b8bd`.

The production TypeScript/Vite build passes. The dogfood harness also compiles cleanly, and the generated Claude Desktop runner passes Node syntax validation. If remaining client dogfood reveals another source change, the frozen-backend checks must be rerun so final evidence refers to one source snapshot.
