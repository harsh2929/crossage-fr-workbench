# Subfolder include/exclude + recurse toggle for folder scanning

**Date:** 2026-06-15
**Status:** Implemented (TDD; backend + frontend + tests green)
**Branch:** feat/2026-unlock-build

## Problem

When the user picks a folder to scan (or to enroll reference faces from), they want:

1. An option to control recursion — scan **this folder only** vs. recurse into every subfolder.
2. The ability to **check off subfolders to skip** when scanning a folder.

### Key finding that reshaped the request

Folder scanning is **already fully recursive**. Both the pre-scan probe
(`analyze_folder`) and the real scan share a stack-based DFS walk that descends
into every subfolder by default:

- Scan walk: `_iter_media_paths` — `crossage_fr/enroll/manager.py:2174` (images **and** video; honors config exclusions via `scan_exclusion_reason`; skips symlinks).
- Analyze walk: `analyze_folder` — `crossage_fr/api_server.py:1357` (same exclusion rules, budgeted to 250k entries / 15s).
- Enroll walk: `iter_image_paths` — `crossage_fr/ingest/image_io.py:149` (recursive `os.walk`, **images only**, honors **no** exclusions).

So "recurse into subfolders" already ships. The genuinely new work is:
- A **recurse on/off toggle** (the *inverse* — let the user turn recursion off).
- A **per-scan subfolder exclusion tree** with a UI front door.

The config-level exclusion plumbing (`excluded_dir_names`, `excluded_path_keywords`,
`excluded_extensions`, `excluded_file_paths`, `max_media_file_bytes`) already exists
but is global/workspace-wide and settings-only — there is no per-pick, pick-from-this-
folder checklist.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Recurse toggle + exclusion checklist | **Both** | User request. |
| Persistence | **Ephemeral (per-scan params)** | No hidden state between runs; defensible for a forensic tool. |
| Checklist depth | **Full nested tree**, lazily rendered | Max control; lazy node rendering keeps big drives responsive. |
| Scope | **Both Scan and Enroll** pickers | Consistency. |
| Architecture | **New Python `folder_tree` command** (Approach A) | Single source of enumeration truth → preview always matches what gets scanned; real per-folder counts; follows repo's dual-allowlist pattern. |
| Enroll vs config exclusions (judgment call a) | **Align enroll to honor config exclusions** | More correct + consistent; done via an opt-in `exclusion_reason` hook at the enroll call site only, so benchmarks (`public_dataset.py`) stay byte-for-byte unchanged. |
| Panel placement (judgment call b) | **Inline collapsible panel** under the folder path | Lighter, always visible, no extra click. |

## Design

### Backend — `folder_tree` command

New handler `_cmd_folder_tree` + method `DesktopApi.folder_tree(folder, max_entries, time_budget_ms)`.
Walks the folder once using the same `os.scandir` stack + `scan_exclusion_reason` +
`follow_symlinks=False` rules as the scan walk, and returns a nested tree.

Node shape:
```jsonc
{
  "name": "Exports",
  "path": "/abs/resolved/path",     // absolute resolved
  "imageCount": 312,                 // media directly in this folder
  "videoCount": 4,
  "totalImages": 980,                // aggregated over the whole subtree (incl. self)
  "totalVideos": 4,
  "childDirCount": 2,
  "children": [ /* FolderTreeNode[] */ ],
  "truncated": false                 // budget cut this branch short
}
```
Response: `{ "root": FolderTreeNode, "truncated": bool, "entriesChecked": int, "entryBudget": int }`.

- **Budgeted** like `analyze_folder` (`ANALYZE_ENTRY_BUDGET` / `ANALYZE_TIME_BUDGET_MS`). On
  cap, the deepest reached node gets `truncated: true`.
- **Truncated = safe**: folders not listed are NOT auto-excluded — they still scan unless a
  visible ancestor is excluded. UI shows a banner so nothing is silently hidden.
- Serves **both** flows: returns image AND video counts per node; the UI shows
  images+videos for scan, images only for enroll. Baseline always applies config
  exclusions (hides `.git`, `node_modules`, etc.) for both flows — which is why enroll is
  being aligned to honor the same exclusions (decision a), so the picker stays truthful.

### IPC plumbing

- Register `"folder_tree": "_cmd_folder_tree"` in `_COMMAND_HANDLERS` (`api_server.py:328`).
- Add `"folder_tree"` to `TRUSTED_BACKEND_COMMANDS` in **both** `desktop/preload.cjs` and
  `desktop/main.cjs` (the `tests/command_contract.py` parity test enforces this).
- Add `folder_tree` to the path-grant list alongside `analyze_folder` (`main.cjs:~1974`).
- Renderer invokes it through the existing generic `invoke(...)` path (same as
  `analyze_folder`) — **no new preload method**.

### Ephemeral params threaded into the 3 walks

`scan`, `enroll`, `analyze_folder` each accept two optional params parsed in their
`_cmd_*` handlers:
- `recursive: bool` (default `true`)
- `excludedDirs: string[]` → resolved to a `set[Path]`, validated to be **inside** the
  chosen folder (reject otherwise), capped at a sane length.

Threaded with **defaulted** signatures so all existing callers are untouched:
- `_iter_media_paths(folder, recursive=True, excluded_dirs=None)` — skip a dir whose
  resolved path ∈ `excluded_dirs`; if `recursive=False`, never push subdirs (only yield
  the root's direct files).
- `iter_image_paths(root, recursive=True, excluded_dirs=None, exclusion_reason=None)` —
  prune `dirnames` in the `os.walk` loop; defaults keep benchmark behavior identical.
- `analyze_folder(..., recursive=True, excluded_dirs=None)` — same handling so the
  readiness/count preview reflects the choices.

`enroll_folder` passes `self.scan_exclusion_reason` as the `exclusion_reason` hook
(decision a). `_cmd_enroll`/`_cmd_scan`/`_cmd_analyze_folder` parse & validate the params.

### Frontend — state + UI (`src/App.tsx`, `src/styles.css`, `src/types.ts`)

Ephemeral state per flow (reset on folder change / workspace switch):
`scanRecursive`/`enrollRecursive` (bool, default true), `scanExcludedDirs`/`enrollExcludedDirs`
(`Set<string>`), `scanFolderTree`/`enrollFolderTree` (`FolderTree | null`), plus
loading/truncation/error flags.

On folder choose → fire `folder_tree` → render an inline collapsible **"Subfolders"** panel
under the path:
```
 Folder: /Volumes/Evidence/CaseA            [Choose folder]
 ┌─ Subfolders ──────────────────────────────────────────┐
 │ [✓] Recurse into subfolders                            │
 │ ───────────────────────────────────────────────────── │
 │ [✓] ▸ Photos              1,240 images                 │
 │ [✓] ▾ Exports               312 images · 4 videos      │
 │       [ ] ▸ thumbnails       980 images   ← excluded   │
 │       [✓] ▸ originals        312 images                │
 │ [ ] ▸ Backups             8,002 images   ← excluded    │
 │ ───────────────────────────────────────────────────── │
 │ 2 folders excluded · will scan ~1,552 images           │
 └────────────────────────────────────────────────────────┘
```
- Reuses existing patterns: `.switch-row` for the toggle, accent-color checkboxes,
  `.settings-toggle-row` containers.
- **Lazy rendering**: a node's children render only when expanded.
- **Subtree exclusion**: unchecking a parent excludes its whole subtree; the excluded set
  stores only the **top-most** unchecked paths (descendants auto-disable visually). Backend
  skips any folder whose resolved path is in the set — descendants are skipped because the
  walk never descends into an excluded dir.
- **Live count, no round-trip**: "will scan ~N" is computed client-side from the tree's
  `totalImages`/`totalVideos` minus excluded subtrees. The actual `excludedDirs` + `recursive`
  still go to the backend at analyze/scan/enroll time for ground truth.
- Recurse off ⇒ tree greys out (no subfolders scanned anyway).
- Scan column shows images+videos; enroll shows images only.

### Types

`src/types.ts`: add `FolderTreeNode` and `FolderTree` interfaces.

## Testing

New `tests/folder_tree_units.py` (standalone, `.venv/bin/python`, no model engine needed):
- `folder_tree` returns correct nested per-folder and subtree counts.
- `recursive=False` ⇒ only top-level media enumerated.
- `excluded_dirs` prunes a whole subtree (scan + enroll + analyze paths).
- Config-excluded dirs (`.git`, `node_modules`) and symlinks absent from the tree.
- Enroll now honors config exclusions (decision a) but `iter_image_paths` defaults
  (no exclusion hook) remain unchanged → benchmark path untouched.
- `excludedDirs` outside the chosen folder is rejected.

Existing `tests/command_contract.py` parity check covers the new allowlist entry. Wire a
`test:folder-tree` script into `package.json`.

## Out of scope (v1)

- Persisting exclusions across runs / writing to workspace config.
- MCP `scan_folder` gaining the tree (agent surface unchanged).
- Virtualized rendering beyond lazy children expansion (only matters at >~10k visible nodes).
