# Vintrace Open Photo Catalog v1

Status: implemented and tested in Vintrace. This document describes format version `1`; it does not claim adoption by another application.

## Purpose

Vintrace Open Photo Catalog is a directory-based interchange format for moving a library without copying machine-local paths or requiring a Vintrace workspace database. A package uses the `.vintracecatalog` extension and contains ordinary UTF-8 JSON/NDJSON plus, for a full archive, original media bytes.

The stable format identifier is `org.vintrace.open-photo-catalog`; `formatVersion` is `1`. Importers must reject unsupported versions instead of guessing.

## Layout

```text
example.vintracecatalog/
  manifest.json
  schema/open-photo-catalog-v1.schema.json
  catalog/assets.ndjson
  catalog/entities.ndjson
  catalog/preferences.json
  catalog/sidecars.ndjson
  media/originals/<sha256-prefix>/<sha256>.<extension>
  media/sidecars/<sha256-prefix>/<sha256>.<extension>
```

`manifest.json` is the package integrity root. It records the format/version, catalog ID, generation time, media policy, path-free flag, compatibility policy, exact aggregate and per-record-group counts, and every member's relative path, kind, byte length, and SHA-256 digest. The embedded JSON Schema covers the manifest structure and travels with every package. It is not a signature and therefore does not establish publisher identity.

The package is a directory rather than a proprietary database or opaque archive. A third-party implementation can parse records line by line and copy hash-addressed media using standard filesystem and JSON tools.

## Media Policies

- `full`: includes available original bytes and requested sidecars/companions.
- `catalog-only`: includes the complete catalog graph but no original bytes. Imported assets become explicit missing-media records until relinked.

Missing source originals are represented honestly in either mode. Export never invents bytes or treats a generated preview as an original.

## Catalog Records

`assets.ndjson` contains one record per asset. Each record preserves its stable source ID, sanitized original filename, optional archive member, SHA-256, byte length, missing state, source/media kind, MIME type, dimensions/duration, capture and lifecycle dates, file signature, perceptual hash, and path-sanitized metadata.

`sidecars.ndjson` binds an ID and role to an asset, with a sanitized filename, SHA-256, byte length, and optional archive member. Sidecars include adjacent XMP/JSON/XML/AAE and supported RAW/editor companions discovered by the existing sidecar contract.

`entities.ndjson` stores an `entity` name and a database-independent JSON `record`. Version 1 allowlists human-authored or catalog-authority data for:

- asset metadata, locations, OCR, object tags, audio segments, and events;
- edit stacks and saved edit versions;
- people, pet, group, place, utility, and face-assignment authority;
- relationship-name reviews;
- keywords and asset-keyword membership/source authority;
- album folders, albums, saved filters, and ordered album membership;
- media pairs and duplicate groups, membership, reviews, and dismissals;
- sanitized import/tether history;
- sanitized external-source mappings, album membership/order, stable external IDs, and reviewable people hints.

`preferences.json` carries curation preferences, user memories, editable stories, culling results, slideshow theme templates, and slideshow projects when present.

## Path-Free References

Absolute POSIX paths, Windows drive paths, UNC paths, and `file://` values cannot be emitted verbatim. The exporter recursively transforms known paths into references:

```json
{ "$ref": "asset", "id": "asset_..." }
{ "$ref": "sidecar", "id": "sidecar_...", "name": "image.xmp" }
{ "$ref": "redacted-path", "id": "", "name": "unresolved-file.ext" }
```

Asset and sidecar references resolve to imported destinations. Unrecognized absolute paths restore as empty values. Machine-specific root, preview, rendered-preview, managed-root, and destination columns are cleared. Tether sessions import stopped with auto-resume disabled; running imports become interrupted history. The source package therefore cannot restart a watcher, access an old machine path, or silently reconnect an external service.

## Integrity And Safety

Before mutating the destination catalog, import verifies the manifest and every declared member. It requires the manifest counts to equal both the NDJSON row counts and their aggregate totals; requires unique record IDs, known asset/sidecar references, and archive-member metadata that agrees with the corresponding asset or sidecar row; and rejects undeclared files. NDJSON is parsed semantically as a stream while each member's byte length and SHA-256 are independently recomputed. Full import also verifies every media and sidecar member against both the manifest and its catalog row.

Export hashes source files while streaming, writes to a unique partial directory, and runs the same complete package verifier over that directory before atomically publishing it. A package that the importer would reject is never renamed into place.

Import rejects:

- absolute, empty, dot, parent-traversal, duplicate, or package-escaping member paths;
- symlinks and non-regular members;
- files not declared by the manifest, or manifest/catalog rows that disagree about an archive member;
- invalid UTF-8, JSON, or NDJSON records;
- missing required member groups, duplicate IDs, unknown references, or count mismatches;
- unsupported format versions, malformed IDs, size drift, checksum drift, or excessively complex JSON values;
- more than 2,000,000 manifest members, 20,000,000 total catalog records, manifests over 8 MiB, NDJSON lines over 16 MiB, or JSON values over 1,000,000 nodes.

Export/import cancellation is token-bound to the active workspace operation. Cancellation removes partial packages and any newly copied import files before returning.

## Import And Merge Semantics

Import verifies the whole package before opening a write transaction and re-verifies every member when staging it, so a package changed after inspection cannot be imported. Full archives copy originals and sidecars through verified temporary files under the selected managed root using catalog-scoped, hash-aware destinations; only a complete, matching copy is atomically promoted. Catalog-only imports create missing-media assets without pretending that bytes exist.

The importer stores `(provider, catalogId, externalId)` mappings under provider `vintrace_open_catalog`. Re-importing the same package updates the mapped graph instead of duplicating it. With hash merge enabled, one imported record may reuse one pre-existing matching original; distinct duplicate records in the package remain distinct rather than collapsing into one asset. Sidecars for a merged original are placed under Vintrace's managed open-catalog area and never beside or over a user's pre-existing source file.

Entity asset IDs and nested `$ref` values are remapped to destination IDs. Ordered album membership, folder hierarchy, edit history, sidecar relationships, authority profiles, and preferences are restored after assets exist. Unknown future entity names are skipped with a warning according to `unknownEntityPolicy: ignore-with-warning`; known malformed records fail the import. Derived duplicate/search/index state is marked stale or rebuilt locally. Any database failure rolls back the transaction, and cancellation or failure removes newly staged/promoted files that are not owned by a pre-existing destination record.

## Deliberate Exclusions

Version 1 does not transfer biometric templates or face embeddings; semantic vectors; generated preview caches; FTS/ANN indexes; model artifacts; indexing/source job queues; sync transport keys, signatures, operation logs, or peer secrets; machine-specific workspace/backup/root settings; or undo payloads that can reveal trash paths. These are private machine state, derived data, or unsafe authority and must be regenerated or reconfigured.

The package is **not encrypted**. SHA-256 detects corruption or tampering but does not provide confidentiality or publisher identity. Store or transport sensitive packages using an independently encrypted medium. Encrypted Vintrace workspace backups remain the disaster-recovery format; this open catalog is the no-lock-in interchange format.

## DAM Migration Boundary

Lightroom Classic (`.lrcat`) and Capture One (`.cocatalogdb` or supported catalog directory) migration is separate from this format. Vintrace opens recognized SQLite catalog profiles read-only and imports originals, stable source identity, titles/captions/dates, ratings, color labels, pick/reject state, hierarchical keywords, and collection hierarchy/order. Relocated roots can be mapped to OS-picked media folders.

Vintrace does not claim proprietary Lightroom develop rendering, Capture One adjustments, publish/session state, or face-region fidelity where the source schema does not expose a supported profile. Unsupported schemas fail with an explicit error, source catalog bytes are never modified, and no network access is used.

## Validation

Run:

```bash
npm run test:photo-portability
npm run test:photo-portability:e2e
npm run test:frozen-photo-portability
npm run test:photo-scale:100k
npm run test:command-contract
npm run test:localization
npm run package:check
```

The acceptance suites cover full and catalog-only graph round trips, repeated-import idempotency, hash merge without duplicate collapse, exact original/sidecar bytes, path redaction, count/reference/member mismatch, undeclared-member, tamper/traversal/symlink rejection, cancellation and transaction cleanup, no-network DAM migration, read-only source catalogs, local-authority conflict handling, ratings/labels/pick-reject state, hierarchical keywords, collection order, frozen-runtime round trips, real Electron workflows, and 10,000-record plus 100,000-photo scale gates.
