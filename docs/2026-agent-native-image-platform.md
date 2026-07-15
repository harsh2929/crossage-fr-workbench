# Vintrace agent-native image platform

Date: 2026-07-10  
Status: local agent platform, workflow-quality phase, and enterprise interoperability building blocks implemented; operator-owned hosted infrastructure remains separate  
Audience: product, engineering, safety, agent-platform partners, and enterprise buyers

## Executive thesis

Vintrace should not be “a photo app with an MCP server.” It should be the private image operating system that agents use whenever work begins with a visual corpus and ends with a reviewed, reproducible artifact.

The differentiator is the combination competitors rarely hold in one place:

- a local-first image and video library that already works at scale;
- semantic, metadata, OCR, object, location, people, pet, duplicate, burst, and temporal understanding over the same assets;
- non-destructive editing, versioning, albums, memories, slideshows, exports, backup, repair, and audit history;
- consent, Safe Mode, workspace locking, path confinement, review queues, and redacted agent output;
- an agent contract that uses stable asset IDs and bounded operations instead of granting raw filesystem access.

The winning product is a visual system of record plus an execution plane. Codex, Claude Code/Desktop, ChatGPT, internal agents, and direct SDK clients should be able to discover, reason over, transform, organize, and export a library without learning UI coordinates or receiving broad disk access.

## Baseline evidence at the start of this work

The repository already contains a much larger platform than its agent surface suggests:

- `DesktopApi` exposes 264 command handlers.
- 135 handlers are Photos/image-library operations.
- The current MCP server registers 103 tools, primarily around face enrollment, matching, review, benchmarking, diagnostics, and compliance.
- The MCP manifest lists 97 tools and is already missing 6 registered tools.
- No first-class MCP tool currently provides photo-library overview, semantic/filtered photo search, stable asset fetch, multimodal preview, metadata updates, albums, non-destructive edits, indexing jobs, photo export jobs, or library repair.
- The MCP transport already supports stdio and bearer-authenticated Streamable HTTP with rate limiting, concurrency limits, path scoping, consent gates, workspace-lock enforcement, output redaction, and explicit confirmation.

The core gap is therefore not model capability. It is productization: a canonical, discoverable, safe agent contract over the image platform that already exists.

## Implemented platform snapshot

The implemented platform now closes that baseline gap:

- `AgentImageService` is the canonical contract used by both MCP and direct HTTP.
- The live catalog classifies all 163 image-oriented backend actions and publishes category, description, execution lane, required/accepted fields, input schema, deprecation/replacement metadata, confirmation, operator-token, idempotency, destructive, and open-world policy. Packaged bytecode introspection covers accepted inputs for the action catalog; parameterless reads and actions that consume saved project or memory objects do not require additional payload fields.
- MCP exposes 126 runtime tools, and the manifest contains the same 126 tools with no missing or extra entries.
- Purpose-built tools cover capability discovery, compact overview, lexical/semantic/hybrid search, stable-ID fetch, existing local OCR/object/barcode/quality intelligence, bounded preview, plan, separate read/write/destructive execution lanes, and job polling.
- Six MCP prompts plus static and templated resources teach inbound discovery, search-first curation, operations, recipes, and safe execution without flooding the normal tool list.
- The same bearer-authenticated host exposes 26 `/v1` paths and 28 documented operations, including OpenAPI 3.1, inbound connector discovery/import/sync, asset intelligence, binary previews, plans/execution, jobs, unified operations, output manifests/resources, recipes, activity, and an authenticated resumable Server-Sent Events feed.
- Writes reserve an idempotency key durably before execution. A successful retry replays the saved result; changed input conflicts; a crash-window attempt becomes indeterminate and cannot be silently repeated. Capability discovery publishes the retention boundary: 500 replayable results plus 10,000 compact tombstones.
- Hybrid ranking uses deterministic reciprocal-rank fusion. Exact library filters are re-applied to bounded semantic candidates before results are returned.
- The desktop Agents panel produces Codex and Claude configurations, can install the Codex block, can start the localhost HTTP host, and exposes MCP, API, OpenAPI, and token details.
- Eight built-in multi-step recipes cover portfolio curation, OCR review, memory movies, metadata normalization, duplicate review/undo, missing intelligence, semantic contact sheets, and archive health. Custom recipes are allowlisted, typed, plan-only, confirmed, idempotent, and workspace-persistent.
- One normalized operation timeline spans imports, indexing, exports, repairs, reversible library operations, and agent writes. Public operation responses exclude raw backend detail; generated artifacts are represented by opaque, size-bounded resource links and path-free manifests.
- Every canonical agent result/failure records a compact path-free event in the existing tamper-evident audit chain. The desktop Agents panel summarizes reads, writes, destructive calls, pending approvals, confirmations, and pixel disclosures.
- The HTTP trust boundary supports the local operator token, hash-only scoped service accounts with optional per-tool grants, and OAuth JWT resource-server validation for controlled remote deployments. The same authorization mapping is applied to direct routes and MCP JSON-RPC tool/resource calls.
- MCP App-capable hosts can render bounded `search_images` results through a versioned, self-contained review component. The component persists stable-ID selections, requests previews through the existing host-approved tool boundary, and returns the reviewed set to the conversation without gaining filesystem, network, or write authority.
- The desktop now promotes this capability through a first-class AI Agents navigation destination, a first-visit discovery banner, and an eight-step onboarding guide. The page exposes the workflow unlocks, built-in recipes, platform foundations, connection choices, live endpoint state, approval activity, and trust model. Its shared catalog is conformance-tested against live action/tool/API/recipe counts.

The final synthetic 100,000-asset agent run on the development machine measured 158 ms to build/classify the live service catalog, 65 ms for the compact overview, 623 ms for a filtered path-free page, and 71 ms to hydrate 100 stable IDs. These are contract-level measurements with no preview generation; all remain below the published 1,000/500/1,500/1,000 ms budgets respectively.

## Production verification record

The implementation was reverified from source and from the final PyInstaller sidecar on 2026-07-10:

| Contract or risk | Runtime evidence |
| --- | --- |
| Live reach and model context | 163 classified image actions behind compact purpose-built front doors; 126 total MCP tools and 6 prompts match the manifest exactly |
| Stable-ID workflow | Import, search, fetch, analyze, preview, album membership, export, and media-pair flows pass without disclosing source paths |
| Safety and authority | Consent, Safe Mode, recursive approved-root validation, lane separation, explicit confirmation, operator approval, response redaction, and 1 MB body limits pass |
| Authentication and grants | Local admin token, hash-only service accounts, expiry/disable, scope implication, per-route/per-tool denials, OAuth signature/issuer/audience/expiry validation, RFC 6750 challenges, and live source/frozen OAuth servers pass |
| Retry behavior | Restart replay, changed-input conflict, crash-window indeterminate state, 500-result/10,000-tombstone retention, and concurrent Codex/Claude same-key execution pass |
| Transport parity | MCP stdio and bearer-authenticated `/mcp` plus 26 `/v1` paths/28 OpenAPI operations pass against source and the frozen sidecar |
| Workflow quality | Eight built-in plans, typed input binding, allowlisted custom recipes, confirmation/idempotency, unified operations, path-free manifests, activity summaries, and SSE resume cursors pass conformance |
| Frontend discovery | Primary navigation, first-visit banner, onboarding, capability/recipe/platform galleries, client actions, live server controls, activity, responsive rendering, keyboard navigation, and seven-language layouts pass |
| Scale | Synthetic 10,000- and 100,000-asset suites pass bounded pages, stable-ID hydration, path redaction, and latency budgets |
| Production build | TypeScript, Vite, a from-scratch PyInstaller workpath, backend checksum manifest, frozen MCP/MCP App, frozen HTTP/OpenAPI/SSE, and frozen OAuth checks pass |

The Photos surface's 10,000-asset folder rail was also profiled and reduced from an 18.4 second N+1 path to about 5.1 seconds by bulk-loading object tags and caching pure memory/curation labels. The dedicated photo-folder, photo-scale, golden-fixture, and depth suites pass; depth cases that require unavailable optional model packs remain explicitly skipped rather than silently downgraded.

## The workflow unlocks

### 1. A visual memory layer for every agent

Today, an agent usually sees only files explicitly attached to the conversation or paths discovered by shell access. It cannot ask the user's entire private library a question and receive stable, source-grounded results.

Vintrace unlocks:

- “Find the clearest photos of the prototype with the blue enclosure, excluding screenshots.”
- “Show every image where this serial number appears, grouped by date and location.”
- “Find the photos from the launch where Maya and the product are both visible.”
- “Locate the original RAW and every rendered version behind this JPEG.”
- “Find visually similar images even when filenames and metadata are useless.”

The agent reasons over asset IDs, structured metadata, and bounded previews; it does not need arbitrary filesystem traversal.

### 2. From search result to finished deliverable in one reviewed workflow

Existing tools split discovery, editing, layout, and export across applications. Agents can suggest what to do but cannot execute the whole visual workflow with provenance.

Vintrace unlocks an atomic chain:

1. search semantically and with exact filters;
2. fetch a contact sheet or a bounded set of previews;
3. rank/select with reasons;
4. apply non-destructive edits or metadata changes;
5. create an album, memory, collection, or project;
6. render a delivery preset;
7. export and return a file reference;
8. preserve the operation, source IDs, edit stack, and audit trail.

Examples include campaign selects, incident evidence packs, product catalog batches, family books, research figures, press kits, real-estate listings, and event recaps.

### 3. Image operations at collection scale instead of one file at a time

Most agent image integrations are generator-centric or single-file transforms. They lack a durable library and therefore cannot safely operate on 10,000–1,000,000 assets.

Vintrace unlocks:

- cursor/offset pagination and filters before preview generation;
- asynchronous OCR, barcode, object, semantic, preview, and export jobs;
- selection by saved query or album rather than repeating path lists;
- bounded batch sizes, resumable jobs, progress, cancellation, and retry;
- idempotency keys so agent retries do not duplicate imports, albums, edits, or exports;
- dry-run impact summaries before writes;
- result manifests that connect every output to its source asset and version.

### 4. Private visual intelligence without cloud-library surrender

The normal competitive tradeoff is convenience versus privacy: upload the whole corpus to receive semantic understanding.

Vintrace unlocks:

- local semantic search and indexing;
- local face matching and review;
- local OCR, barcode, object, EXIF, and location intelligence;
- Safe Mode exclusions before thumbnails or agent-visible content;
- per-subject consent, audit events, retention reporting, and data deletion;
- agent access that can be stdio-only, localhost HTTP, or explicitly remote behind bearer/OAuth infrastructure.

An enterprise can let an agent answer questions about sensitive media without granting the model raw source paths or unrestricted storage access.

### 5. A visual data API for coding agents

Codex and Claude Code can build products faster when they can query real visual assets as structured data rather than asking a human to manually curate fixtures.

Vintrace unlocks:

- retrieve approved design/product assets by meaning, color, dimensions, orientation, rights, date, or subject;
- create deterministic test sets and contact sheets from a saved query;
- inspect image dimensions, color profiles, OCR, object regions, and edit history;
- export responsive variants and preserve a machine-readable manifest;
- detect missing assets, duplicate exports, stale previews, or broken paths in CI-like workflows;
- attach visual evidence to bug reports, release notes, documentation, and pull requests.

### 6. Agent-native digital asset management without DAM ceremony

Traditional DAM systems depend on up-front taxonomy and manual metadata. Vintrace can infer structure, then let the human approve it.

Vintrace unlocks:

- “Propose albums for this import and show why each image belongs.”
- “Normalize these 4,000 filenames and titles without touching originals.”
- “Tag every product shot by SKU from OCR/barcodes; queue ambiguous items.”
- “Find assets with no location, copyright, caption, or album membership.”
- “Merge obvious duplicate albums, but preview membership changes first.”
- “Build a rights-expiry queue and exclude expired assets from export.”

### 7. Visual evidence workflows with chain of custody

Agents are useful at triage but dangerous when source lineage disappears.

Vintrace unlocks:

- immutable source identity and hashes kept inside the trusted workspace;
- agent-visible stable asset IDs rather than hashes or paths;
- read-only examination, annotation, and candidate ranking;
- review-gated identity decisions;
- export manifests, audit-chain verification, consent receipts, and examination reports;
- reversible operations and explicit destructive boundaries.

This supports investigative review, insurance claims, field research, compliance, and quality operations without presenting agent output as an autonomous identity claim.

### 8. Accessibility and personal knowledge workflows

The library can become a navigable personal knowledge base for users who cannot efficiently browse a dense grid.

Vintrace unlocks:

- conversational search across objects, people, dates, places, and visible text;
- descriptions grounded in OCR/object/metadata evidence;
- “what changed?” summaries across recurring locations or subjects;
- spoken or text-driven organization without drag-and-drop;
- privacy-respecting family/history timelines and memory creation.

### 9. Commerce and catalog operations

An agent can connect visual inventory to operational systems without exporting the entire corpus to a vendor.

Vintrace unlocks:

- match product photos to SKUs via barcode/OCR;
- detect missing angles, duplicate products, low-quality shots, and inconsistent backgrounds;
- create marketplace-specific renditions from approved originals;
- generate contact sheets for buyer review;
- maintain source-to-output provenance and avoid reprocessing unchanged assets.

### 10. Research and field-data workflows

Images become a queryable dataset rather than an opaque folder tree.

Vintrace unlocks:

- filter observations by date, GPS radius, camera, visible text, and object class;
- create reproducible subsets with saved filters;
- annotate metadata without modifying originals;
- export manifests alongside media;
- rerun the same workflow after incremental imports;
- keep sensitive subjects local and excluded from downstream outputs.

### 11. Continuous library stewardship

Agents can maintain image infrastructure, not merely consume it.

Vintrace unlocks:

- scheduled backup-readiness and catalog-integrity checks;
- preview/index repair only where drift exists;
- duplicate detection and reviewed consolidation;
- orphan and broken-link triage;
- storage budget enforcement over regenerable data;
- health reports with a safe proposed action before execution.

### 12. Multi-agent visual workflows

Stable IDs and a shared operation ledger let specialized agents collaborate without passing raw binaries through every context window.

Example:

- a research agent defines a saved query;
- a visual-review agent inspects bounded previews and scores candidates;
- a copy agent writes captions from approved evidence;
- a production agent creates renditions and a contact sheet;
- a compliance agent checks rights and the export manifest;
- a human approves the write/export plan once.

## Competitive moat

| Dimension | Typical image generator/API | Typical cloud photo app | Typical DAM | Vintrace agent-native target |
| --- | --- | --- | --- | --- |
| Durable private library | No | Yes | Yes | Yes, local-first |
| Semantic + OCR + object + people + metadata graph | Partial | Partial | Taxonomy-heavy | Unified |
| Agent can execute end-to-end workflows | Usually single image | Limited | API-specific | Search → review → edit → organize → export |
| Non-destructive edit/version history | Rare | UI-centric | Partial | Agent-addressable |
| Stable opaque asset identity | Request-scoped | Internal | Yes | Yes |
| At-scale jobs and resumability | Vendor-specific | Hidden | Often | First-class |
| Consent/review/Safe Mode | Generic moderation | Consumer settings | Policy add-ons | Native execution boundary |
| Path and biometric redaction | Not applicable | Cloud custody | Varies | Default |
| Reversible agent writes | Rare | Rare | Varies | Required |
| Local stdio agent mode | No | No | No | Yes |
| Auditable source-to-output lineage | Weak | Weak | Strong but manual | Automatic |

The moat is the execution substrate and trust model, not a single vision model. Models can be swapped; a durable, safe, fully operable visual system of record is much harder to reproduce.

## Product principles

1. **Stable IDs over paths.** Agents work with `assetId`, `albumId`, `memoryId`, `jobId`, and `operationId`. Paths stay inside the trusted service. Desktop-era handlers that consume paths are adapted at this boundary: agent-supplied stable IDs are resolved to trusted internal paths only immediately before execution.
2. **Search before pixels.** Structured search narrows the corpus before previews enter model context.
3. **Bound every response.** Pagination, preview caps, size caps, field selection, and aggregation are mandatory.
4. **Read broadly; write deliberately.** Reads can be auto-approved when policy allows. Writes provide a plan and require explicit confirmation.
5. **Non-destructive by default.** Metadata, edit stacks, albums, versions, and visibility changes precede physical deletion or overwrite.
6. **Jobs over timeouts.** Long indexing, import, export, render, and repair work returns a job with progress and cancellation.
7. **Idempotent writes.** Every agent write accepts an idempotency key and safely returns the prior result on retry.
8. **Provenance is output.** Every export returns a manifest and source/version references.
9. **Capabilities are discoverable.** Agents query the live server catalog rather than relying on stale prompt knowledge.
10. **Human decisions stay human.** Identity assertions, consent grants, sensitive overrides, irreversible deletes, and audit-log deletion retain explicit human authority.

## Target architecture

```text
Codex / Claude / ChatGPT / custom agents
                   │
        ┌──────────┴──────────┐
        │                     │
  MCP stdio / HTTP       Agent HTTP /v1
        │                     │
        └──────────┬──────────┘
                   │
         AgentImageService
  capability catalog · policy · IDs
  pagination · redaction · idempotency
  write previews · result normalization
                   │
             DesktopApi.handle
                   │
  workspace DB · indexes · edit stacks
  imports · jobs · exports · audit trail
```

`AgentImageService` is the canonical contract. MCP functions and HTTP routes are adapters, not separate implementations.

## Agent surface

### Purpose-built front doors

These tools should solve the most common prompts with one obvious choice:

| Tool | Purpose | Side effect |
| --- | --- | --- |
| `list_image_capabilities` | Discover categories, actions, schemas, limits, and policy | Read-only |
| `get_image_library_overview` | Counts, index readiness, recent imports, repair/backup state | Read-only |
| `list_inbound_visual_sources` | Authorized Slack, web, cloud-drive, Dropbox, and WebDAV sources without credentials | Read-only |
| `discover_inbound_visuals` | Bounded remote metadata discovery without importing pixels | Read-only, open world |
| `import_inbound_visuals` | Reviewed managed import with stable IDs, explicit download consent, and idempotency | Write, open world |
| `sync_inbound_visuals` | Incremental managed sync from an authorized source | Write, open world |
| `search_images` | Lexical or semantic search with exact filters and pagination | Read-only |
| `fetch_image_assets` | Structured metadata/context for stable asset IDs | Read-only |
| `get_image_preview` | Return one policy-approved bounded image preview to a multimodal agent | Read-only, pixel disclosure |
| `analyze_image_assets` | Read existing OCR/object/barcode/quality intelligence and report indexes that must be queued | Read-only |
| `plan_image_action` | Validate and describe any long-tail action without executing it | Read-only |
| `run_image_read_action` | Execute an allowlisted long-tail read | Read-only |
| `run_image_write_action` | Execute a confirmed non-destructive action with persistent idempotency | Write |
| `run_destructive_image_action` | Execute an explicitly approved destructive action with persistent idempotency | Destructive |
| `get_image_job` | Normalize scan, indexing, export, and inbound job status | Read-only |
| `get_agent_activity` | Review the path-free approval, failure, replay, and pixel-disclosure timeline | Read-only |
| `list_image_operations` | One paginated feed across imports, indexing, exports, repairs, library operations, and agent writes | Read-only |
| `get_image_operation` | Read normalized operation state plus a path-free manifest and generated-output resource links | Read-only |
| `list_image_recipes` / `get_image_recipe` | Discover built-in and custom multi-step workflows and their typed input contracts | Read-only |
| `plan_image_recipe` | Bind typed inputs and return ordered tool calls with explicit approval points; never execute them | Read-only |
| `save_image_recipe` | Persist an allowlisted custom recipe with confirmation and idempotency | Write |
| `delete_image_recipe` | Remove a custom recipe with destructive approval and idempotency | Destructive |

### Why not 163 individual MCP tools

Tool selection degrades when a model must choose among many similarly named operations. The platform should expose excellent front doors for frequent outcomes and keep the long tail behind a discoverable action catalog. The action catalog still exposes every supported Photos and inbound-connector command, but it does not flood each model turn with 163 tool definitions.

### Long-tail action families

- `discover`: folders, date buckets, assets, bursts, keywords, saved filters, albums, memories, projects, jobs, settings, operations.
- `import`: import media, provenance, failures, recovery, consolidation.
- `index`: OCR, barcode, object, semantic/previews, queues, cancellation.
- `metadata`: favorite, title, description, keywords, dates, location, people/pet/place/utility profiles, media pairs.
- `organize`: saved filters, smart/manual albums, album folders, groups, memories, curation preferences, ordering.
- `edit`: edit stacks, batch edits, version creation/restore/delete, duplicate rendered versions, Live Photo/video key frames.
- `export`: selection, contact sheet, video frame/trim, Live motion, cutout, portrait blur, slideshow, memory movie, color-profile validation, async export jobs.
- `visibility`: hide, unhide, recently deleted, restore rehearsal, undo, permanent deletion.
- `deduplicate`: discover, dismiss, merge, and preserve best versions.
- `maintain`: preview rebuild, backup readiness, catalog cleanup, repair history, orphan recovery, relink, consolidation, library settings.

## Canonical result model

Every agent response should follow the same envelope:

```json
{
  "ok": true,
  "requestId": "agentreq_...",
  "action": "search_images",
  "data": {},
  "page": { "offset": 0, "limit": 50, "total": 1250, "hasMore": true },
  "job": null,
  "warnings": [],
  "provenance": {
    "workspaceId": "...",
    "generatedAt": "...",
    "sourceAssetIds": []
  },
  "policy": {
    "readOnly": true,
    "destructive": false,
    "openWorld": false,
    "pixelDisclosure": false,
    "confirmationRequired": false
  }
}
```

Errors use stable codes such as `consent_required`, `workspace_locked`, `path_out_of_scope`, `confirmation_required`, `idempotency_required`, `idempotency_conflict`, `operation_indeterminate`, `invalid_action`, `safe_mode_protected`, and `not_found`; HTTP rate limiting returns status 429.

## Search contract

`search_images` supports:

- `query` and `mode=lexical|semantic|hybrid`;
- folder/album/memory/saved-filter scope;
- people, pets, keywords, OCR text, object, barcode, place, GPS radius, camera, file type, media kind, quality, score, date range, favorite, edited, duplicate, visibility, and album-membership filters;
- `sort`, `offset`, `limit`, and optional compact field selection;
- no preview generation by default;
- stable asset IDs in every result;
- evidence explaining why an item matched.

Preview calls are separate and capped so a broad search never silently puts hundreds of private images into an agent context.

## Multimodal preview contract

- Requires consent on file and an unlocked workspace.
- Accepts one stable asset ID, never an arbitrary path.
- Resolves the best non-destructive rendered preview when available.
- Refuses Safe Mode-protected content.
- Enforces maximum dimensions and encoded byte size.
- Returns `ImageContent` plus a small structured record containing asset ID, MIME type, dimensions, version, and disclosure reason.
- Records a pixel-disclosure audit event without revealing source paths.

## Write protocol

1. The agent calls `plan_image_action(action, payload)`.
2. The server validates the live action catalog, paths, IDs, bounds, and consent.
3. The server returns normalized impact, side-effect annotations, warnings, and whether confirmation is required.
4. The host uses MCP annotations/approval policy to obtain approval for writes.
5. The agent calls the matching `run_image_write_action` or `run_destructive_image_action` with `confirm=true` and an idempotency key.
6. The server executes once, stores the request fingerprint/result, redacts sensitive fields, and returns operation/job IDs.
7. Repeating the same key and payload returns the prior result; reusing the key with different input is rejected.

Destructive or irreversible actions remain explicitly marked and can additionally require the existing operator token where the action affects consent, sensitive overrides, or the audit trail.

## MCP requirements

- Support stdio for the strongest local boundary.
- Support bearer-authenticated Streamable HTTP for local SDKs and controlled remote tunnels.
- Include server-wide `instructions` whose first 512 characters explain search-first behavior, pixel disclosure, confirmation, and rate limits.
- Add accurate `readOnlyHint`, `openWorldHint`, and `destructiveHint` annotations to every tool.
- Return concise `structuredContent`; never put secrets, source paths, hashes, or unlimited result arrays in model-visible payloads.
- Use image content blocks for bounded previews and resource links/file references for generated outputs when supported.
- Expose resource templates for asset metadata and job state.
- Keep raw UI rendering separate from data tools. The implemented MCP App consumes bounded `search_images` structured content, and any preview remains a separate `get_image_preview` tool call subject to host approval and server policy.

These requirements follow current official OpenAI guidance for [connecting Codex to MCP](https://learn.chatgpt.com/docs/extend/mcp), [building an MCP server for apps](https://developers.openai.com/apps-sdk/build/mcp-server), and [planning tool contracts](https://developers.openai.com/apps-sdk/plan/tools): Codex supports stdio and Streamable HTTP, while agent/app tools should publish accurate impact metadata and concise structured results.

## Direct HTTP API

The existing Streamable HTTP process also serves:

- `GET /v1/openapi.json`
- `GET /v1/capabilities`
- `GET /v1/library`
- `GET /v1/connectors`
- `POST /v1/connectors/{provider}/{connection_id}/discover`
- `POST /v1/connectors/{provider}/{connection_id}/import`
- `POST /v1/connectors/{provider}/{connection_id}/sync`
- `POST /v1/search`
- `POST /v1/assets/fetch`
- `POST /v1/assets/analyze`
- `GET /v1/assets/{asset_id}`
- `GET /v1/assets/{asset_id}/preview`
- `POST /v1/actions/plan`
- `POST /v1/actions/run`
- `GET /v1/jobs/{job_type}`
- `GET /v1/jobs/{job_type}/{job_id}`
- `GET /v1/activity`
- `GET /v1/events` (authenticated resumable Server-Sent Events)
- `GET /v1/operations`
- `GET /v1/operations/{operation_id}`
- `GET /v1/operations/{operation_id}/manifest`
- `GET /v1/operations/{operation_id}/outputs/{output_id}`
- `GET|POST /v1/recipes`
- `POST /v1/recipes/plan`
- `GET|DELETE /v1/recipes/{recipe_id}`
- `GET /v1/health`

All routes inherit bearer auth, rate limiting, concurrency control, consent, workspace lock, redaction, and action policy from the MCP process. This is a local/private API, not a second trust boundary.

## Safety and trust model

### Authentication

- Stdio inherits local process authority and configured environment.
- HTTP fails closed unless at least one local token, scoped service-account file, or OAuth resource-server configuration is valid.
- Local operator tokens receive `images:admin`. Service-account files retain only SHA-256 token hashes, require owner-only permissions, and support expiry, disable flags, scopes, and per-tool allowlists.
- OAuth JWTs validate signature/JWKS, issuer, audience/resource, issued/expiry claims, algorithm allowlist, and supported scopes; invalid identities never fall through to local authority.
- Remote HTTP requires the explicit `--allow-remote-http` flag and operator-owned TLS/network ingress.
- Host hints and user-agent strings never authorize an action.

### Authorization

- The approved-root allowlist applies recursively to every path-bearing payload field.
- Agents cannot switch to an arbitrary workspace outside approved roots.
- Stable asset IDs resolve only inside the active workspace.
- Workspace Lock disables MCP/API access because a separate process cannot inherit an in-app unlock.
- `images:read`, `images:preview`, `images:write`, `images:destructive`, `events:read`, and `images:admin` are enforced per `/v1` route and per MCP `tools/call`/resource read. Optional `allowedTools` grants narrow a service account further.
- Denials return RFC 6750-compatible `WWW-Authenticate` challenges with `insufficient_scope` or `tool_not_granted`; the authenticated principal and scopes are recorded without token material.

### Privacy

- Source paths, filenames, hashes, face vectors, and hidden biometric identifiers stay redacted.
- Pixel disclosure is a separate audited permission from metadata search.
- Safe Mode-protected media never returns a preview, thumbnail, embedding, candidate, or export through the agent surface.
- Responses remain bounded and never include unrequested full-library metadata.

### Human authority

- Consent cannot be invented by an agent.
- Identity review remains an operator decision.
- Writes and destructive actions are annotated distinctly.
- Permanent delete, sensitive override, audit deletion, and other irreversible actions require explicit confirmation and, where configured, an operator token.

## Scale and reliability requirements

- Search p95 under 1.5 seconds for indexed 100k-asset libraries on reference hardware.
- Default page size 50; hard maximum 200.
- Preview access is one explicitly selected asset per disclosure; each preview is capped at 2048 px and 8 MB encoded.
- Job status polling includes progress, phase, processed/total, warnings, resumability, cancellation, and terminal result.
- Idempotency records survive process restart and are capped/expired.
- Tool results carry request IDs for audit correlation.
- Every action has deterministic parameter normalization before fingerprinting.
- Capability schema includes version, deprecations, replacement actions, and server limits.

## Golden workflows for conformance

1. Find ten landscape photos of a named product, return metadata only, then show previews for the top three.
2. Find every image containing a serial number from OCR and create a reviewed album without duplicating it on retry.
3. Select favorites from a trip, create a memory, render a movie asynchronously, and return the output manifest.
4. Update titles/keywords on 500 assets using a saved query and a confirmed batch operation.
5. Find duplicate groups, preview the proposed keeper, merge only after confirmation, and undo the operation.
6. Run missing OCR/object jobs, poll progress, cancel one job, and resume the queue.
7. Export a color-managed contact sheet from a semantic query without exposing source paths.
8. Refuse a preview for Safe Mode-protected media.
9. Refuse any path outside approved roots, including nested payloads and export targets.
10. Retry the same write with one idempotency key and prove it executed once.
11. Reuse an idempotency key with a different payload and reject it.
12. Verify every advertised action maps to a live backend handler and every mutating action has impact annotations.

## Delivery status

### Phase A — contract and complete reach (implemented)

- live capability catalog over all Photos handlers;
- purpose-built overview/search/fetch/preview tools;
- plan/run long-tail action tools;
- annotations for all MCP tools;
- MCP resources/templates and `/v1` routes;
- manifest/config/onboarding updates;
- conformance, safety, and parity tests.

### Phase B — workflow quality (implemented)

- richer action-specific schemas and examples;
- unified job model across import/index/export/repair;
- output resource links and manifests;
- saved agent recipes;
- agent activity and approval UI in Vintrace.

Runtime proof lives in `tests/agent_workflow_conformance.py`, `tests/mcp_smoke.py`, and `tests/agent_http_api.py`. Recipes are deliberately plan-only: neither saving nor planning a recipe can execute a library operation. Each resolved step names an existing allowlisted MCP tool and declares any pixel, write, destructive, or operator approval boundary.

### Phase C — interoperability and enterprise

- Implemented: stdio and authenticated Streamable HTTP, direct OpenAPI, resumable SSE subscriptions, impact annotations, bounded MCP resource links, Codex/Claude onboarding, source/packaged parity tests, synthetic scale budgets, and deterministic workflow conformance.
- Implemented authentication building blocks for controlled remote/private deployment: standards-based OAuth JWT resource-server validation (issuer, audience, expiry, algorithm allowlist, and JWKS), protected-resource metadata through the MCP SDK, hash-only service-account tokens, expiry/disable controls, six scopes, per-tool grants, RFC 6750 challenges, and principal attribution in the audit chain. Remote binding still requires the explicit `--allow-remote-http` flag.
- Implemented visual review for compatible hosts: a versioned MCP App resource attached to `search_images`, bounded stable-ID selection, host-approved preview requests, persisted widget state, and conversation handoff without direct filesystem/network/write access.
- Authenticated resumable SSE is the built-in subscription surface. Arbitrary outbound webhooks are deliberately outside the local trust boundary because they require operator-owned destination allowlists, egress policy, retry operations, and secret management.
- External deployment work not fabricated by this repository: provisioning an identity provider, issuing organization accounts/tokens, network ingress/TLS, and running/monitoring hosted infrastructure. The server-side enforcement points exist; an operator must supply and own that infrastructure.

## Completion criteria for the local agent platform — met

The local/private-network platform meets the following runtime criteria:

- all live Photos handlers are classified or explicitly denied with a reason;
- the capability catalog and manifest match runtime;
- every tool has all three impact annotations;
- Codex and Claude configs launch the same server successfully;
- stdio and authenticated HTTP conformance pass;
- search, fetch, preview, plan, run, idempotency, path confinement, Safe Mode, and confirmation are tested end to end;
- direct `/v1` routes return the same normalized data/policy as MCP;
- docs include tested commands and golden prompts;
- no tool response leaks absolute paths, source hashes, or protected media.
- built-in/custom workflows, typed input validation, approval points, save/delete confirmation, and persistent idempotency pass;
- import/index/export/repair/library/agent-write operations share one normalized timeline;
- public operation detail is normalized, manifests omit source/output paths, and bounded generated outputs use opaque resource IDs;
- activity/approval events are written to the tamper-evident chain, shown in the desktop Agents panel, readable as an MCP resource, and subscribable through authenticated SSE.
- local admin, scoped service-account, and OAuth JWT principals are verified before route/tool execution; scope/per-tool denials and principal audit attribution are tested.
- the versioned MCP App resource and `search_images` UI metadata match; the component is self-contained, bounded, path-free, and can request only the separately authorized preview tool.

## Product north-star metrics

- percentage of visual workflows completed without manual file browsing;
- median number of tool calls from intent to approved artifact;
- search-to-preview precision and human selection acceptance;
- duplicate work prevented by idempotency and source manifests;
- time saved per 1,000 assets processed;
- percentage of writes previewed, confirmed, reversible, and successfully audited;
- zero protected-media disclosure and zero out-of-scope path access;
- agent tool-selection accuracy on the golden prompt suite.

The long-term category is not “AI photo management.” It is trusted visual operations infrastructure for agents.
