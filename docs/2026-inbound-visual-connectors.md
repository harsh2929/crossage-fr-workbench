# Vintrace inbound visual connectors

Status: implemented and verified in source, Electron, and the frozen production backend on 2026-07-11.

## Product loop

Vintrace now connects external visual discovery to the existing stable-ID image platform:

> find externally → import safely → understand at scale → curate/edit → agent-deliver

External systems remain read-only sources. Discovery retrieves bounded metadata first. A reviewed import or sync requires a separate explicit download consent and creates managed copies. Those copies enter the normal Vintrace ingest, provenance, stable-ID, Safe Mode, intelligence, curation, non-destructive editing, export, idempotency, and audit contracts.

## Workflow unlocks

### Slack to finished asset

- Find images shared in one or more channels without manually downloading every attachment.
- Preserve Slack file identity, channel grouping, timestamps, dimensions, comments, likes, and sharing metadata when the corresponding scopes are approved.
- Import only a reviewed set, then search it with local semantic, OCR, object, people, date, album, and quality intelligence.
- Turn stable IDs into an album, edited versions, a contact sheet, or a delivery package without giving the agent Slack credentials or filesystem paths.

### Web research to governed library

- Start from public pages, galleries, or direct media URLs.
- Discover `img`, responsive `srcset`, Open Graph/Twitter images, `video`, and video `source` elements.
- Optionally crawl a bounded number of same-origin links while respecting `robots.txt` by default.
- Block private-network destinations, credential-bearing URLs, unsafe redirects, oversized responses, unsupported formats, and markup disguised as media.
- Preserve page-level provenance while keeping source URLs out of agent responses.

### Cloud review to local intelligence

- Read an approved Google Drive folder, OneDrive folder, Dropbox path, or WebDAV collection.
- Use provider-native pagination and stable item IDs rather than filenames as identity.
- Detect unchanged items incrementally and avoid duplicate stable assets.
- Keep the provider read-only while Vintrace owns the local managed copy and downstream edit history.

### Cross-tool agent collaboration

- A human connects a source once in the desktop app.
- Codex, Claude Code/Desktop, or an authenticated HTTP client can list the authorized source, discover bounded metadata, propose a selection, and start a confirmed import.
- The OS credential vault makes an authorized connection available across local desktop, MCP, and HTTP backend processes; tokens are never returned to the agent.
- Persistent idempotency makes concurrent clients safe: the same key and payload replay one result, while a changed payload conflicts.
- Inbound jobs are pollable through the same agent job surface and resume after restart when the OS credential remains available.

### At-scale content operations

- Source discovery is capped and paginated rather than loaded without limit.
- Imports flow directly into the existing managed library, external-ID mapping, import sessions, albums, metadata, and operation history.
- Stable IDs let later workflows survive filename, folder, and source-location changes.
- The normal local intelligence queue can run after import without sending pixels back to a connector provider.

## Supported providers

| Provider | Discovery API | Download API | Stable remote identity | Important configuration |
| --- | --- | --- | --- | --- |
| Slack | `files.list` | `url_private_download` | Slack file ID | token and optional channel IDs |
| Web | bounded HTML/media fetch | validated media URL | SHA-256 of canonical media URL | one or more URLs, crawl bounds, robots policy |
| Google Drive | Drive v3 `files.list` | `files.get?alt=media` | Drive file ID | OAuth token and folder ID |
| OneDrive | Graph drive-item children | drive-item `/content` | Graph drive-item ID | OAuth token and folder ID |
| Dropbox | v2 `files/list_folder` | v2 `files/download` | Dropbox item ID | OAuth token and folder path |
| WebDAV | `PROPFIND` | `GET` | href plus ETag signature | base URL and bearer or basic credential |

All providers normalize into the existing `PhotoSourceLibrary`, `NormalizedPhotoAsset`, album, scope, preview, job, and external-ID contracts. Adding another provider requires one adapter that emits the same records; it does not require a new ingest or agent platform.

## Human desktop flow

1. Open **Import images → Online & cloud**.
2. Add a named read-only connection.
3. Vintrace encrypts the desktop copy with Electron `safeStorage` and stores the cross-process backend credential in the workspace-scoped native OS credential vault.
4. Choose **Discover metadata**. No visual bytes are added to the library at this stage.
5. Review bounded sample rows and optionally select specific external IDs.
6. Enable **Download managed copies for this action**.
7. Import the selection or incrementally sync the source.
8. Poll or cancel the job. Imported assets immediately participate in the normal Photos workflows.
9. Removing a connection deletes both credential copies and leaves already imported managed assets intact.

The form includes provider-specific least-privilege guidance. OAuth access tokens are operator-supplied because a distributable Google, Microsoft, Dropbox, or Slack OAuth client registration is deployment-specific. Vintrace does not silently embed shared client secrets.

## Agent flow

Agents cannot configure or forget credentials. Those commands are explicitly excluded from the live action catalog. Agents receive only source display names, opaque connection IDs, provider capabilities, policy, bounded item metadata, job state, and post-import stable asset IDs.

### Purpose-built MCP contract

| MCP capability | Impact |
| --- | --- |
| `list_inbound_visual_sources` | local, read-only, no network |
| `discover_inbound_visuals` | read-only, open-world metadata request |
| `import_inbound_visuals` | confirmed open-world write into managed storage |
| `sync_inbound_visuals` | confirmed open-world incremental write |
| `get_image_job(job_type="inbound")` | local polling |
| `vintrace://images/inbound-sources` | credential-free authorized-source catalog |
| `inbound_visual_workflow` | reusable discovery-to-delivery prompt |

The long-tail action catalog also exposes `inbound_connector_catalog`, `list_inbound_connector_sources`, `preview_inbound_connector`, `import_inbound_connector`, and `sync_inbound_connector`. Configure and forget actions remain human-only.

Example MCP sequence:

1. `list_inbound_visual_sources(provider="slack")`
2. `discover_inbound_visuals(provider="slack", connection_id="design-slack", item_limit=500, sample_limit=40)`
3. Present a reviewed external-ID selection.
4. `import_inbound_visuals(..., external_download_consent=true, confirm=true, idempotency_key="campaign-import-2026-07-11-v1")`
5. `get_image_job(job_type="inbound", job_id="...")`
6. Search/fetch/analyze the new stable asset IDs.
7. Plan and confirm the desired album, edit, or export action.

### Direct HTTP/OpenAPI contract

The authenticated agent host adds:

- `GET /v1/connectors`
- `POST /v1/connectors/{provider}/{connection_id}/discover`
- `POST /v1/connectors/{provider}/{connection_id}/import`
- `POST /v1/connectors/{provider}/{connection_id}/sync`
- `GET /v1/jobs/inbound/{job_id}`

Discovery requires `images:read`. Import and sync require `images:write`, `confirm=true`, `externalDownloadConsent=true`, and a unique idempotency key. The OpenAPI 3.1 schema defines provider enums, bounds, required approvals, and normalized errors.

## Security model

### Credentials

- Renderer code never receives decrypted saved credentials.
- The desktop persists an encrypted connection envelope using OS-backed Electron `safeStorage` with atomic writes and `0600` file permissions.
- The backend stores only secret fields in a workspace-scoped native vault: macOS Keychain, Windows Credential Manager, or the freedesktop Secret Service.
- Non-secret connector configuration is stored in the source catalog so a separately launched MCP/HTTP backend can rehydrate an authorized source.
- Credential values are removed from job parameters, source metadata, action results, audit events, and agent output.
- Connection IDs are hashed in desktop/backend credential audit events.

### Network boundary

- Only HTTP and HTTPS are accepted.
- URL-embedded usernames/passwords are rejected.
- Nonstandard ports are rejected outside the isolated test mode.
- DNS results are checked; private, loopback, link-local, reserved, multicast, and unspecified addresses are blocked.
- Every redirect is revalidated.
- Official provider calls are restricted to expected API/download host suffixes.
- Public web crawling follows same-origin links only and has hard page/item limits.
- Public web discovery respects `robots.txt` unless the operator explicitly disables that option.
- Request bodies, response bodies, downloads, pages, items, and samples are bounded.

### Content boundary

- Discovery is metadata-only.
- Download is a second, explicitly consented action and always uses managed storage.
- Declared size and streamed response size are both enforced.
- MIME type, extension, image/video magic, and decodability are checked; HTML/XML/JSON masquerading as media is rejected.
- Downloads use a partial file and atomic replacement; failed partials are removed.
- Imported media then passes the normal ingest validation, content hashing, Safe Mode, metadata, preview, and provenance pipeline.
- Remote sources are never written to, renamed, moved, or deleted.

### Agent authority

- Source authorization and credential removal are human-only desktop actions.
- Discovery is annotated as read-only and open-world.
- Import/sync are annotated as non-destructive writes and open-world.
- Confirmation and external-download consent are independent gates.
- Every confirmed write uses the persistent cross-process idempotency ledger and activity audit.
- Source paths, source URLs, media filenames, and biometric hashes are centrally redacted from MCP and HTTP output.

## Identity, sync, and provenance

Each connector has a deterministic library ID derived from provider plus connection ID. Each provider supplies a stable external ID. `photo_asset_external_ids` maps that pair to one Vintrace asset ID, with update signature and first/last-seen state.

An import records:

- connector provider and source kind;
- external library and item identity;
- original remote metadata and update signature;
- managed local source kind;
- import session and source display label;
- source album/folder mappings;
- counts for seen, imported, unchanged, failed, removed, and managed exports.

Sync compares stable external identity and signature. Unchanged media is skipped. A source-removal policy can keep the managed copy or move it through Vintrace’s reviewable removal workflow; the connector never deletes the upstream item.

## Scale and failure behavior

- Discovery: up to 10,000 items per connection request.
- Web crawl: up to 50 pages and same-origin only.
- Preview samples: up to 100 metadata rows.
- Remote download: 128 MiB default, 512 MiB hard ceiling per item.
- Generic response: 16 MiB hard ceiling.
- Agent external-ID batches: 1,000 items.
- Provider pagination continues only to configured bounds.
- Background source execution is serialized through the existing photo-source executor to control disk and network pressure.
- Interrupted jobs recover on startup. They resume automatically when the native vault can rehydrate the source; otherwise they remain queued with `credentials_required` until the operator reconnects.
- Credential errors, provider rate limits, oversized content, unsafe URLs, unsupported media, and item failures are normalized into job state and audit-safe errors.

## Verification

Deterministic tests cover:

- real Slack, Drive, Graph, Dropbox, and WebDAV request/response shapes through fake transports;
- bounded web extraction, same-origin crawling, robots rules, image/video markup, SSRF rejection, and managed import;
- external-download consent, secret-free jobs, stable external identity, unchanged sync, and cross-process connector restoration;
- native-vault abstraction plus encrypted Electron vault persistence, permissions, decryption, deletion, and unsupported providers;
- source and direct HTTP/OpenAPI agent discovery, confirmation, import, inbound job polling, and path/URL redaction;
- MCP runtime/manifest/resource/prompt parity;
- desktop UI end-to-end connection, discovery, selection, consent, import, and completion;
- TypeScript/Vite, Python compilation, command contract, and test-coverage contract.

Primary commands:

```text
npm run test:inbound-connectors
npm run test:agent-http
npm run test:mcp
playwright test tests/e2e/inbound-connectors.spec.ts
npm run build
npm run build:backend
VINTRACE_MCP_TEST_EXECUTABLE=/path/to/crossage-backend npm run test:frozen-inbound-connector
```

## Deliberate deployment extensions

The connector core is complete for operator-supplied credentials. Hosted multi-tenant OAuth redirect handling, enterprise admin consent, scheduled webhook ingestion, provider change-notification subscriptions, organization-wide service-account policy, and private-network connector gateways are deployment features rather than hidden local behavior. They should reuse this adapter, vault, source, job, stable-ID, consent, and audit contract instead of bypassing it.
