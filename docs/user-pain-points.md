# CrossAge FR User Pain Points And Implementation Backlog

This backlog was generated from three focused agent reviews: UI workflow, backend/image pipeline, and desktop/MCP production integration. The product stance remains consent-gated, review-first, and local-first.

## Top Pain Points

1. **Consent is too easy to miss.**
   Users can mark consent from a small topbar toggle without enough context. Consent should be explicit, scoped to the active workspace, and auditable.

2. **Review decisions are easy to make accidentally.**
   Single-key and button decisions persist immediately. Review needs undo, clearer batch scope, and confirmation for bulk changes.

3. **Match evidence needs to support human judgment.**
   Reviewers need thresholds, score bands, quality context, reference context, and a reminder that cross-age results require human review.

4. **Scan failures need recovery actions.**
   Broken images, unsupported decoder families, and unreadable files should be copyable/revealable from the scan surface.

5. **External-open and protocol actions can leave users stranded.**
   If files arrive from Finder/Explorer before consent or enrollment, the app should preserve the intent and let users resume once setup is complete.

6. **Settings need guardrails for non-technical users.**
   Invalid threshold ordering and Safe Mode relaxation should be blocked or confirmed before the backend rejects the change.

7. **Large scans need resilience.**
   The backend should avoid double-walking folders, checkpoint progress during long scans, and write audit entries for scan/enrollment/cleanup actions.

## Production Backlog

- **Implemented now:** consent confirmation sheet, durable consent records, consent audit entries, undoable review decisions, bulk review confirmation, select-all-filtered review scope, expanded match evidence panel, scan issue copy/reveal/open actions, pending external-file resume banner, inline settings validation, Safe Mode relaxation confirmation, single-walk folder scan setup, scan checkpoints, shared workspace registry for desktop/MCP, lightweight workspace write lock, structured backend startup phases, persistent watched-folder resume, paginated MCP audit access, and added audit entries for scans/enrollment/clear/settings/shell/external-open actions.
- **Next architecture pass:** cancellable scan runs, durable per-file scan manifests/resume by hash, SQLite/WAL storage, generated MCP manifest inventory, and persisted user preferences separate from workspace recognition policy.

## Acceptance Criteria

- A new user can understand what consent means before processing images.
- A reviewer can undo accidental single-candidate decisions.
- Bulk review actions state exactly how many candidates will change.
- Scan issue rows provide a path-level recovery action when the path is known.
- External file opens are not lost when setup is incomplete.
- Invalid threshold settings are caught before a backend round trip.
- Long scans preserve useful progress if interrupted.
