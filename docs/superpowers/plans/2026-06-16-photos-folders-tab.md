# Photos Tab (Browse Photos as Folders) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level **Photos** tab that browses the whole collection as folders — *All Photos* (every scanned file), one folder per enrolled person, and auto-clustered *Unknown Person N* folders — with a sidebar + virtualized gallery and a full-size lightbox.

**Architecture:** Backend-grouped, thin frontend. Two new read-only backend commands return the folder list and paginated photos over existing data (`scan_files` manifest + `review_candidates`); the renderer is a virtualized gallery. Images flow over the existing `vintrace-media://` protocol; `main.cjs` `decorateState` already builds `sourceUrl`/`previewUrl` and grants path-trust for any `items[]`, so no new protocol/trust code is needed for items.

**Tech Stack:** Python (api_server dispatch + sqlite `WorkspaceDb`), Electron CJS (allowlist + media-URL decoration), React + TypeScript (Vite), node test runner (`.mjs`) + Python unit tests.

Reference spec: `docs/superpowers/specs/2026-06-16-photos-folders-tab-design.md`.

---

## File structure

- **Modify** `crossage_fr/store/workspace_db.py` — add `count_scan_media()` + `list_scan_media(offset, limit)` (All-Photos manifest queries).
- **Modify** `crossage_fr/api_server.py` — register `list_photo_folders` + `list_photo_folder_items` in `_COMMAND_HANDLERS`; add `_cmd_*` wrappers + the two methods + a shared `_photo_item_row`/folder-tally helper.
- **Modify** `desktop/main.cjs` — allowlist the two commands; add a `value.folders[]` cover-decoration branch in `decorateState`.
- **Modify** `desktop/preload.cjs` — allowlist the two commands.
- **Modify** `src/types.ts` — add `PhotoFolder`, `PhotoItem`, `PhotoFolderList`, `PhotoItemsPage`.
- **Create** `src/views/PhotosView.tsx` — the tab UI (rail + virtualized grid + lightbox).
- **Modify** `src/App.tsx` — `TabKey` union, `tabs` config, `navMeta`, render branch, `listPhotoFolders`/`listPhotoFolderItems` invoke wrappers, lucide `Images` import.
- **Modify** `src/i18n/*` — add `nav.photos` translation key.
- **Modify** `src/styles.css` — `.photos-page` split layout + grid.
- **Create** `tests/photo_folders_units.py` — backend unit tests.
- **Create** `tests/photos_view.test.mjs` — frontend pure-logic tests (folder ordering / paging math).

---

## Task 1: Backend `scan_files` manifest queries (All Photos data)

**Files:**
- Modify: `crossage_fr/store/workspace_db.py` (near the scan_file methods, ~line 749-855)
- Test: `tests/photo_folders_units.py`

A viewable All-Photos row = any `scan_files` row except `status='error'` and `phase='excluded'`, deduped by `path` (a path re-scanned across runs appears once, newest `processed_at` wins).

- [ ] **Step 1: Write failing test** in `tests/photo_folders_units.py`

```python
"""Unit tests for the Photos-tab backend (All Photos manifest + folder grouping)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from crossage_fr.store.workspace_db import WorkspaceDb


def _db(tmp_path: Path) -> WorkspaceDb:
    db = WorkspaceDb(tmp_path / "workspace.db")
    db.ensure_schema()
    return db


def _sig(path: Path, size: int = 10, mtime: int = 1):
    return {"pathKey": f"{path}|{size}|{mtime}", "size": size, "mtimeNs": mtime}


def test_list_scan_media_dedupes_path_and_excludes_error_and_excluded(tmp_path):
    db = _db(tmp_path)
    a, b, c, d = (tmp_path / f"{n}.jpg" for n in "abcd")
    # two runs record the same path `a` -> must collapse to one row
    db.record_scan_file("run1", a, _sig(a, mtime=1), "completed", phase="processed")
    db.record_scan_file("run2", a, _sig(a, mtime=2), "completed", phase="processed")
    db.record_scan_file("run1", b, _sig(b), "skipped", phase="duplicate")     # real file, kept
    db.record_scan_file("run1", c, _sig(c), "error", phase="error")           # dropped
    db.record_scan_file("run1", d, _sig(d), "skipped", phase="excluded")      # dropped
    assert db.count_scan_media() == 2
    paths = [row["path"] for row in db.list_scan_media(offset=0, limit=50)]
    assert sorted(paths) == sorted([str(a), str(b)])
```

- [ ] **Step 2: Run, verify it fails** — `python -m pytest tests/photo_folders_units.py -k scan_media -v` → FAIL (`AttributeError: 'WorkspaceDb' object has no attribute 'count_scan_media'`).

- [ ] **Step 3: Implement** in `crossage_fr/store/workspace_db.py` (add after `record_scan_file`, ~line 855). The shared WHERE clause keeps the two methods consistent.

```python
    _SCAN_MEDIA_WHERE = "status != 'error' AND phase != 'excluded'"

    def count_scan_media(self, conn: sqlite3.Connection | None = None) -> int:
        if conn is None:
            with self.connect() as local_conn:
                return self.count_scan_media(local_conn)
        row = conn.execute(
            f"SELECT COUNT(DISTINCT path) AS n FROM scan_files WHERE {self._SCAN_MEDIA_WHERE}"
        ).fetchone()
        return int(row["n"] if row else 0)

    def list_scan_media(
        self, *, offset: int = 0, limit: int = 100, conn: sqlite3.Connection | None = None
    ) -> list[dict[str, Any]]:
        if conn is None:
            with self.connect() as local_conn:
                return self.list_scan_media(offset=offset, limit=limit, conn=local_conn)
        # One row per distinct path; the row carrying MAX(processed_at) wins, and
        # newest-scanned sorts first. SQLite returns the bare columns from the
        # MAX() row (documented bare-column behaviour).
        rows = conn.execute(
            f"""
            SELECT path, MAX(processed_at) AS processed_at, status, phase, candidate_id
            FROM scan_files
            WHERE {self._SCAN_MEDIA_WHERE}
            GROUP BY path
            ORDER BY processed_at DESC, path ASC
            LIMIT ? OFFSET ?
            """,
            (max(1, int(limit)), max(0, int(offset))),
        ).fetchall()
        return [dict(row) for row in rows]
```

- [ ] **Step 4: Run, verify pass** — `python -m pytest tests/photo_folders_units.py -k scan_media -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add crossage_fr/store/workspace_db.py tests/photo_folders_units.py
git commit -m "feat(photos): scan_files manifest queries for All Photos folder"
```

---

## Task 2: Backend `list_photo_folder_items` (paginated photos per folder)

**Files:**
- Modify: `crossage_fr/api_server.py` (registry ~328-356; new methods near `query_candidates` ~3163)
- Test: `tests/photo_folders_units.py`

Routing by `folderId`: `all` → `scan_files`; `person:<name>` → accepted-or-high-confidence candidates for that person; `unknown:<cluster>` → candidates with that `Unmatched cluster …` name. All deduped by source path. Rows reuse `_candidate_state_row` (candidates) or a parallel `_photo_item_row` (All-Photos manifest) so previews are budgeted (≤64) exactly like `query_candidates`.

- [ ] **Step 1: Write failing test** (append to `tests/photo_folders_units.py`). Uses the real manager via the existing test harness pattern in `tests/enroll_paths_units.py` — construct a `DesktopApi` over a temp workspace, inject candidates, and assert routing/dedup/filter. (Mirror the harness helpers already in `enroll_paths_units.py`; reuse its `make_api(tmp_path)` style.)

```python
from crossage_fr.models import ReviewCandidate


def _candidate(cid, person, src, *, status="pending", score=0.9, band="confident"):
    return ReviewCandidate(
        candidate_id=cid, source_path=src, person_name=person,
        best_ref_id=None, best_ref_path=None, score=score, band=band,
        quality=0.9, model_name="test", status=status, note="",
    )


def test_folder_items_person_filter_and_dedupe(make_api):
    api = make_api()
    confident = api.project.config.thresholds.confident
    # Alice: one accepted (kept), one high-confidence pending (kept, but SAME photo
    # as the accepted one -> dedupes to 1), one low-confidence pending (dropped).
    api.project.candidates = {
        "c1": _candidate("c1", "Alice", "/p/1.jpg", status="accepted", score=0.99),
        "c2": _candidate("c2", "Alice", "/p/1.jpg", status="pending", score=confident + 0.01),
        "c3": _candidate("c3", "Alice", "/p/2.jpg", status="pending", score=0.1),
        "c4": _candidate("c4", "Bob", "/p/3.jpg", status="accepted", score=0.99),
    }
    page = api.list_photo_folder_items({"folderId": "person:Alice", "previewBudget": 0})
    assert page["total"] == 1
    assert [it["sourcePath"] for it in page["items"]] == ["/p/1.jpg"]


def test_folder_items_unknown_cluster(make_api):
    api = make_api()
    api.project.candidates = {
        "u1": _candidate("u1", "Unmatched cluster 1", "/p/9.jpg", score=0.0, band="clustered review"),
        "a1": _candidate("a1", "Alice", "/p/1.jpg", status="accepted"),
    }
    page = api.list_photo_folder_items({"folderId": "unknown:Unmatched cluster 1", "previewBudget": 0})
    assert page["total"] == 1
    assert page["items"][0]["sourcePath"] == "/p/9.jpg"
```

> Add a `make_api` pytest fixture at the top of the file building a `DesktopApi` over `tmp_path` (copy the construction used in `tests/enroll_paths_units.py`; if that file exposes a helper, import it instead of duplicating).

- [ ] **Step 2: Run, verify fail** — `python -m pytest tests/photo_folders_units.py -k folder_items -v` → FAIL (`AttributeError: ... 'list_photo_folder_items'`).

- [ ] **Step 3: Register + implement** in `crossage_fr/api_server.py`.

Registry (add to `_COMMAND_HANDLERS` dict near line 356, beside `query_candidates`):

```python
        "list_photo_folders": "_cmd_list_photo_folders",
        "list_photo_folder_items": "_cmd_list_photo_folder_items",
```

Wrappers (beside `_cmd_query_candidates` ~line 710):

```python
    def _cmd_list_photo_folders(self, params, progress=None):
        return self.list_photo_folders(params)

    def _cmd_list_photo_folder_items(self, params, progress=None):
        return self.list_photo_folder_items(params)
```

Methods (add after `query_candidates`/`_candidate_state_row`, ~line 3344). The person predicate matches `query_candidates`' `lane == "high"` rule (`score >= thresholds.confident`) OR an accepted status:

```python
    def _photo_person_match(self, candidate: Any) -> bool:
        if candidate.person_name.startswith("Unmatched cluster"):
            return False
        if candidate.status == "accepted":
            return True
        return float(candidate.score) >= float(self.project.config.thresholds.confident)

    def _photo_item_row(self, *, source_path: str, media_kind: str, preview_create: bool,
                        candidate: Any | None = None) -> dict[str, Any]:
        preview_path = self.project.preview_path_for(source_path, create=False)
        if not preview_path and preview_create:
            preview_path = self.project.preview_path_for(source_path, create=True)
        return {
            "id": candidate.candidate_id if candidate is not None else source_path,
            "sourcePath": source_path,
            "previewPath": preview_path,
            "personName": candidate.person_name if candidate is not None else None,
            "mediaKind": media_kind,
            "captureDate": candidate.capture_date if candidate is not None else None,
        }

    def list_photo_folder_items(self, params: dict[str, Any]) -> dict[str, Any]:
        folder_id = str(params.get("folderId", "")).strip()
        offset = max(0, int(params.get("offset", 0) or 0))
        limit = max(1, min(500, int(params.get("limit", 100) or 100)))
        preview_budget = max(0, min(64, int(params.get("previewBudget", 0) or 0)))

        if folder_id == "all":
            from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS
            total = self.project.db.count_scan_media()
            rows = self.project.db.list_scan_media(offset=offset, limit=limit)
            items = []
            remaining = preview_budget
            for row in rows:
                src = row["path"]
                from pathlib import Path as _P
                kind = "video" if _P(src).suffix.lower() in VIDEO_EXTENSIONS else "image"
                before = self.project.preview_path_for(src, create=False)
                item = self._photo_item_row(source_path=src, media_kind=kind, preview_create=remaining > 0)
                if remaining > 0 and not before and item.get("previewPath"):
                    remaining -= 1
                items.append(item)
            return {"total": total, "offset": offset, "limit": limit, "returned": len(items), "items": items}

        # person:<name> | unknown:<cluster>
        if folder_id.startswith("person:"):
            name = folder_id[len("person:"):]
            match = lambda c: c.person_name == name and self._photo_person_match(c)
        elif folder_id.startswith("unknown:"):
            name = folder_id[len("unknown:"):]
            match = lambda c: c.person_name == name and c.person_name.startswith("Unmatched cluster")
        else:
            raise ValueError("Unknown photo folder id.")

        seen: set[str] = set()
        matched: list[Any] = []
        for candidate in self.project.candidates.values():
            if not match(candidate):
                continue
            if candidate.source_path in seen:
                continue
            seen.add(candidate.source_path)
            matched.append(candidate)
        matched.sort(key=lambda c: (c.capture_date or "", c.created_at, c.candidate_id), reverse=True)
        total = len(matched)
        page = matched[offset:offset + limit]
        items = []
        remaining = preview_budget
        for candidate in page:
            before = self.project.preview_path_for(candidate.source_path, create=False)
            item = self._photo_item_row(
                source_path=candidate.source_path,
                media_kind=candidate.media_kind or "image",
                preview_create=remaining > 0,
                candidate=candidate,
            )
            if remaining > 0 and not before and item.get("previewPath"):
                remaining -= 1
            items.append(item)
        return {"total": total, "offset": offset, "limit": limit, "returned": len(page), "items": items}
```

- [ ] **Step 4: Run, verify pass** — `python -m pytest tests/photo_folders_units.py -k folder_items -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add crossage_fr/api_server.py tests/photo_folders_units.py
git commit -m "feat(photos): list_photo_folder_items backend command"
```

---

## Task 3: Backend `list_photo_folders` (the rail)

**Files:**
- Modify: `crossage_fr/api_server.py`
- Test: `tests/photo_folders_units.py`

Order: All Photos first, then people by count desc, then Unknown clusters by count desc. People/clusters with 0 qualifying photos are hidden. Covers use existing previews only (`create=False`) — never force-generate in the rail.

- [ ] **Step 1: Write failing test**

```python
def test_list_photo_folders_orders_and_counts(make_api):
    api = make_api()
    confident = api.project.config.thresholds.confident
    api.project.candidates = {
        "a1": _candidate("a1", "Alice", "/p/1.jpg", status="accepted"),
        "a2": _candidate("a2", "Alice", "/p/2.jpg", status="pending", score=confident + 0.01),
        "b1": _candidate("b1", "Bob", "/p/3.jpg", status="accepted"),
        "z1": _candidate("z1", "Zoe", "/p/4.jpg", status="pending", score=0.0),   # 0 qualifying -> hidden
        "u1": _candidate("u1", "Unmatched cluster 1", "/p/9.jpg", score=0.0, band="clustered review"),
    }
    out = api.list_photo_folders({})
    folders = out["folders"]
    assert folders[0]["id"] == "all" and folders[0]["kind"] == "all"
    people = [f for f in folders if f["kind"] == "person"]
    assert [f["name"] for f in people] == ["Alice", "Bob"]      # Zoe hidden, Alice(2) before Bob(1)
    assert people[0]["count"] == 2
    assert any(f["kind"] == "unknown" and f["name"] == "Unmatched cluster 1" for f in folders)
```

- [ ] **Step 2: Run, verify fail** — `python -m pytest tests/photo_folders_units.py -k list_photo_folders -v` → FAIL.

- [ ] **Step 3: Implement** in `crossage_fr/api_server.py` (after `list_photo_folder_items`):

```python
    def list_photo_folders(self, params: dict[str, Any]) -> dict[str, Any]:
        # Tally distinct source photos per person / unknown cluster.
        people: dict[str, set[str]] = {}
        unknown: dict[str, set[str]] = {}
        people_cover: dict[str, str] = {}
        unknown_cover: dict[str, str] = {}
        for candidate in self.project.candidates.values():
            name = candidate.person_name
            if name.startswith("Unmatched cluster"):
                unknown.setdefault(name, set()).add(candidate.source_path)
                unknown_cover.setdefault(name, candidate.source_path)
            elif self._photo_person_match(candidate):
                people.setdefault(name, set()).add(candidate.source_path)
                people_cover.setdefault(name, candidate.source_path)

        def cover(path: str | None) -> str | None:
            return self.project.preview_path_for(path, create=False) if path else None

        folders: list[dict[str, Any]] = [{
            "id": "all", "kind": "all", "name": "All Photos",
            "count": int(self.project.db.count_scan_media()),
            "coverPreviewPath": None,
        }]
        for name, paths in sorted(people.items(), key=lambda kv: (-len(kv[1]), kv[0].lower())):
            folders.append({
                "id": f"person:{name}", "kind": "person", "name": name,
                "count": len(paths), "coverPreviewPath": cover(people_cover.get(name)),
            })
        for name, paths in sorted(unknown.items(), key=lambda kv: (-len(kv[1]), kv[0].lower())):
            folders.append({
                "id": f"unknown:{name}", "kind": "unknown", "name": name,
                "count": len(paths), "coverPreviewPath": cover(unknown_cover.get(name)),
            })
        return {"folders": folders}
```

- [ ] **Step 4: Run, verify pass** — `python -m pytest tests/photo_folders_units.py -v` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add crossage_fr/api_server.py tests/photo_folders_units.py
git commit -m "feat(photos): list_photo_folders backend command"
```

---

## Task 4: IPC allowlists + cover decoration + contract test

**Files:**
- Modify: `desktop/main.cjs` (allowlist ~397; `decorateState` ~1830)
- Modify: `desktop/preload.cjs` (allowlist ~28)
- Verify: `tests/command_contract.py` (no edit needed — introspects the registry)

- [ ] **Step 1** — `desktop/main.cjs`: add after the `"query_candidates",` line (~397) inside `TRUSTED_BACKEND_COMMANDS`:

```javascript
  "list_photo_folders",
  "list_photo_folder_items",
```

- [ ] **Step 2** — `desktop/preload.cjs`: add the same two lines after its `"query_candidates",` entry (~28).

- [ ] **Step 3** — `desktop/main.cjs`: in `decorateState`, add a `folders` branch so rail covers get a URL + path-trust. Replace the tail of the if/else chain (the `} else if (Array.isArray(value.items)) {` block at ~1829-1831) with:

```javascript
  } else if (Array.isArray(value.items)) {
    value.items = value.items.map(decorateCandidate);
  } else if (Array.isArray(value.folders)) {
    value.folders = value.folders.map((folder) => {
      const next = { ...folder };
      grantQueryMediaPath(next.coverPreviewPath);
      decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
      return next;
    });
  }
```

- [ ] **Step 4: Run contract test** — `python tests/command_contract.py` → prints `command contract ok (...)` with the two new commands counted. (If it fails with "missing from allowlist", a step above was missed.)

- [ ] **Step 5: Commit**

```bash
git add desktop/main.cjs desktop/preload.cjs
git commit -m "feat(photos): allowlist photo-folder commands + decorate rail covers"
```

---

## Task 5: TypeScript types

**Files:**
- Modify: `src/types.ts` (after `ReviewCandidate`, ~line 330)

- [ ] **Step 1: Add types** (no test — compile-checked by `tsc` in Task 8):

```typescript
export interface PhotoFolder {
  id: string;                       // "all" | "person:<name>" | "unknown:<cluster>"
  kind: "all" | "person" | "unknown";
  name: string;
  count: number;
  coverPreviewPath?: string | null;
  coverPreviewUrl?: string;         // added by main.cjs decorateState
}

export interface PhotoFolderList {
  folders: PhotoFolder[];
}

export interface PhotoItem {
  id: string;
  sourcePath: string;
  sourceUrl?: string;               // added by main.cjs decorateState
  previewPath?: string | null;
  previewUrl?: string;              // added by main.cjs decorateState
  personName?: string | null;
  mediaKind?: "image" | "video" | string;
  captureDate?: string | null;
}

export interface PhotoItemsPage {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  items: PhotoItem[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(photos): PhotoFolder/PhotoItem types"
```

---

## Task 6: `PhotosView` component (rail + virtualized grid + lightbox)

**Files:**
- Create: `src/views/PhotosView.tsx`
- Create: `tests/photos_view.test.mjs` (pure-logic: folder ordering + page math)
- Modify: `src/styles.css`

Pure helpers live at module top so they're testable without a DOM. Virtualization: a simple windowed grid is acceptable for v1 — render only rows near the scroll position, request the next page when the sentinel nears the viewport (IntersectionObserver), `limit=100`, `previewBudget=64`.

- [ ] **Step 1: Write failing test** `tests/photos_view.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasMorePages, nextOffset } from "../src/views/photosPaging.mjs";

test("hasMorePages: loaded < total means more", () => {
  assert.equal(hasMorePages({ loaded: 100, total: 250 }), true);
  assert.equal(hasMorePages({ loaded: 250, total: 250 }), false);
});

test("nextOffset advances by loaded count", () => {
  assert.equal(nextOffset({ loaded: 100 }), 100);
});
```

- [ ] **Step 2: Run, verify fail** — `node --test tests/photos_view.test.mjs` → FAIL (module missing).

- [ ] **Step 3a: Create** `src/views/photosPaging.mjs` (tiny, shared with the component):

```javascript
export function hasMorePages({ loaded, total }) {
  return loaded < total;
}
export function nextOffset({ loaded }) {
  return loaded;
}
```

- [ ] **Step 3b: Create** `src/views/PhotosView.tsx`. It imports the helpers (via the `.mjs` for tests, re-declared in TS as needed) and renders the rail + grid + lightbox. Props are the two invoke wrappers + `workspaceLocked`/`busy` flags.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Images, ImageIcon, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoFolder, PhotoFolderList, PhotoItem, PhotoItemsPage } from "../types";

const PAGE_LIMIT = 100;
const PREVIEW_BUDGET = 64;

export function PhotosView(props: {
  listPhotoFolders: () => Promise<PhotoFolderList>;
  listPhotoFolderItems: (params: Record<string, unknown>) => Promise<PhotoItemsPage>;
  busy: boolean;
}) {
  const [folders, setFolders] = useState<PhotoFolder[]>([]);
  const [activeId, setActiveId] = useState<string>("all");
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    props.listPhotoFolders().then((res) => setFolders(res.folders || [])).catch(() => setFolders([]));
  }, [props.listPhotoFolders]);

  const loadPage = useCallback(async (folderId: string, offset: number) => {
    setLoading(true);
    try {
      const page = await props.listPhotoFolderItems({ folderId, offset, limit: PAGE_LIMIT, previewBudget: PREVIEW_BUDGET });
      setTotal(page.total);
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
    } finally {
      setLoading(false);
    }
  }, [props.listPhotoFolderItems]);

  useEffect(() => { setItems([]); setTotal(0); loadPage(activeId, 0); }, [activeId, loadPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading && items.length < total) {
        loadPage(activeId, items.length);
      }
    });
    io.observe(node);
    return () => io.disconnect();
  }, [activeId, items.length, total, loading, loadPage]);

  const active = folders.find((f) => f.id === activeId);
  return (
    <section className="photos-page">
      <aside className="photos-rail">
        <h2><Images size={18} /> Photos</h2>
        <ul>
          {folders.map((folder) => (
            <li key={folder.id}>
              <button className={folder.id === activeId ? "active" : ""} onClick={() => setActiveId(folder.id)}>
                <span className="photos-rail-cover">
                  {folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" /> : <ImageIcon size={16} />}
                </span>
                <span className="photos-rail-name">{folder.name}</span>
                <span className="photos-rail-count">{folder.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="photos-gallery">
        <header><strong>{active?.name ?? "All Photos"}</strong><span>{total.toLocaleString()} photos</span></header>
        <div className="photos-grid">
          {items.map((item, index) => (
            <button key={item.id} className="photo-tile" onClick={() => setLightbox(index)}>
              {item.previewUrl || item.sourceUrl
                ? <img loading="lazy" decoding="async" src={item.previewUrl || item.sourceUrl} alt="" />
                : <span className="photo-tile-fallback"><ImageIcon size={18} /></span>}
            </button>
          ))}
        </div>
        <div ref={sentinelRef} className="photos-sentinel" aria-hidden="true" />
        {loading && <p className="compact">Loading…</p>}
      </div>
      {lightbox !== null && items[lightbox] && (
        <div className="photos-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button className="photos-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close"><X size={22} /></button>
          <button className="photos-lightbox-nav prev" onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.max(0, (i ?? 0) - 1)); }} aria-label="Previous"><ChevronLeft size={28} /></button>
          <img src={items[lightbox].previewUrl || items[lightbox].sourceUrl} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="photos-lightbox-nav next" onClick={(e) => { e.stopPropagation(); setLightbox((i) => Math.min(items.length - 1, (i ?? 0) + 1)); }} aria-label="Next"><ChevronRight size={28} /></button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `node --test tests/photos_view.test.mjs` → PASS.

- [ ] **Step 5: Add CSS** to `src/styles.css` (clone `.review-page` split, ~line 1567). Add a `.photos-page` two-column grid, `.photos-rail` scroll list, `.photos-grid` (`display:grid; grid-template-columns: repeat(auto-fill, minmax(140px,1fr)); gap:8px`), square `.photo-tile` with `object-fit:cover`, and a fixed-overlay `.photos-lightbox`.

```css
.photos-page { display: grid; grid-template-columns: 260px 1fr; gap: 16px; height: 100%; min-height: 0; }
.photos-rail { overflow-y: auto; border-right: 1px solid var(--border, #2a2f3a); padding-right: 8px; }
.photos-rail ul { list-style: none; margin: 0; padding: 0; }
.photos-rail button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; background: none; border: 0; border-radius: 8px; cursor: pointer; }
.photos-rail button.active { background: var(--surface-2, #232838); }
.photos-rail-cover { width: 28px; height: 28px; border-radius: 6px; overflow: hidden; display: grid; place-items: center; flex: none; }
.photos-rail-cover img { width: 100%; height: 100%; object-fit: cover; }
.photos-rail-name { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.photos-rail-count { opacity: 0.6; font-variant-numeric: tabular-nums; }
.photos-gallery { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.photos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.photo-tile { aspect-ratio: 1; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: var(--surface-2, #232838); cursor: pointer; }
.photo-tile img { width: 100%; height: 100%; object-fit: cover; }
.photos-sentinel { height: 1px; }
.photos-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.86); display: grid; place-items: center; z-index: 1000; }
.photos-lightbox img { max-width: 92vw; max-height: 92vh; object-fit: contain; }
.photos-lightbox-close { position: absolute; top: 16px; right: 16px; }
.photos-lightbox-nav { position: absolute; top: 50%; transform: translateY(-50%); }
.photos-lightbox-nav.prev { left: 16px; } .photos-lightbox-nav.next { right: 16px; }
```

- [ ] **Step 6: Commit**

```bash
git add src/views/PhotosView.tsx src/views/photosPaging.mjs src/styles.css tests/photos_view.test.mjs
git commit -m "feat(photos): PhotosView component + gallery/lightbox styles"
```

---

## Task 7: Wire the tab into `App.tsx` + i18n

**Files:**
- Modify: `src/App.tsx` (union ~148; import; tabs ~245; invoke wrappers ~2288; navMeta ~4695; render branch ~4986)
- Modify: `src/i18n/*` (add `nav.photos`)

- [ ] **Step 1** — `src/App.tsx:148`: extend the union:

```typescript
type TabKey = "dashboard" | "enroll" | "scan" | "review" | "photos" | "settings";
```

- [ ] **Step 2** — add `Images` to the existing `lucide-react` import and `PhotosView` import near the other view imports:

```typescript
import { PhotosView } from "./views/PhotosView";
```

- [ ] **Step 3** — `src/App.tsx:245` tabs array, insert before `settings`:

```typescript
  { key: "photos", labelKey: "nav.photos", icon: Images },
```

- [ ] **Step 4** — add invoke wrappers near `queryCandidates` (~2288):

```typescript
  async function listPhotoFolders() {
    return window.crossAge.invoke<PhotoFolderList>("list_photo_folders", {});
  }
  async function listPhotoFolderItems(params: Record<string, unknown>) {
    return window.crossAge.invoke<PhotoItemsPage>("list_photo_folder_items", params);
  }
```

(import `PhotoFolderList`, `PhotoItemsPage` from `./types`).

- [ ] **Step 5** — `navMeta` (~4695): add a count badge:

```typescript
    photos: { label: `${state.counts.references ? "" : ""}${state.scanTotals.processed || 0}`, tone: "blue" },
```

(Use the All-Photos count once loaded; a simple `scanTotals.processed` proxy is fine for the badge.)

- [ ] **Step 6** — render branch after the `review` block (after ~4986, before `settings`):

```tsx
        {!workspaceLocked && activeTab === "photos" && (
          <PhotosView
            listPhotoFolders={listPhotoFolders}
            listPhotoFolderItems={listPhotoFolderItems}
            busy={Boolean(busy)}
          />
        )}
```

- [ ] **Step 7** — add `nav.photos` to each locale in `src/i18n` (English `"Photos"`, others translated/copied). Find the file with `grep -rn '"nav.dashboard"' src/i18n`.

- [ ] **Step 8: Typecheck + build** — `npm run build` (or `npx tsc --noEmit`) → no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/i18n
git commit -m "feat(photos): wire Photos tab into app shell + i18n"
```

---

## Task 8: Full verification

- [ ] **Step 1** — `python -m pytest tests/photo_folders_units.py -v` → all PASS.
- [ ] **Step 2** — `python tests/command_contract.py` → ok, includes the 2 new commands.
- [ ] **Step 3** — `node --test tests/photos_view.test.mjs` → PASS.
- [ ] **Step 4** — `npm run build` → succeeds, no TS errors.
- [ ] **Step 5** — run the app, open the Photos tab: All Photos shows the manifest; person folders show accepted+high-confidence; Unknown clusters appear; scrolling pages in more thumbnails; clicking opens the lightbox with prev/next. Confirm a HEIC/RAW file shows a thumbnail (served via the generated preview, not the raw original).
- [ ] **Step 6: Commit** any verification fixups.

---

## Self-review notes (spec coverage)

- All-Photos = full manifest incl. protected (user decision): Task 1 filter excludes only `error`/`excluded`. ✔
- Person folders = accepted OR high-confidence: `_photo_person_match` (Task 2/3). ✔
- Unknown clusters: `person_name LIKE 'Unmatched cluster%'` routing + rail (Task 2/3). ✔
- Dedup by source path within a folder: Task 1 (`GROUP BY path`), Task 2 (`seen` set). ✔
- Budgeted lazy thumbnails (≤64): `_photo_item_row` + page budget mirrors `query_candidates`. ✔
- Sidebar + virtualized gallery + lightbox: Task 6. ✔
- Both allowlists + contract: Task 4. ✔
- URL/trust for items free via `decorateState`; covers via new `folders` branch: Task 4. ✔
- Empty people hidden: Task 3. ✔
- Deferred (export/open/reassign/video playback): not implemented, by design. ✔

**Open confirmations carried from spec §14** (resolve while implementing, none change the design): exact `status` strings already confirmed (`accepted`/`pending`/`rejected`/`uncertain`); high-confidence == `score >= thresholds.confident` (matches `query_candidates` lane `high`); `scan_files` viewable filter = not `error`/`excluded` (confirmed from `record_scan_file` call sites).
