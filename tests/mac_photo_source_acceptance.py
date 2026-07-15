from __future__ import annotations

import argparse
from contextlib import ExitStack
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import sys
import tempfile
from time import monotonic
from typing import Any, Callable
from unittest.mock import patch

from crossage_fr.photo_sources.contracts import PhotoSourceScopes
from crossage_fr.photo_sources.osxphotos_adapter import APPLE_PHOTOS_PROVIDER, ApplePhotosAdapter
from crossage_fr.photo_sources.service import PhotoSourceService
from crossage_fr.store.workspace_db import WorkspaceDb


FIXTURE_SCENARIOS = (
    ("empty", "Test-Empty-Library-Ventura-13-5.photoslibrary", {}),
    ("edited", "ExternalAdjustments-14.4.1.photoslibrary", {}),
    ("raw", "Test-RAW-10.15.1.photoslibrary", {}),
    ("live-photo", "Test-Live-15.7.2.photoslibrary", {}),
    ("people", "Test-Faces-10.15.7.photoslibrary", {"peopleFaces": True}),
    ("places", "Test-Places-Catalina-10_15_7.photoslibrary", {"preciseLocation": True}),
    ("cloud-only", "Test-Cloud-13.1.photoslibrary", {}),
    ("shared", "Test-Shared-10.15.1.photoslibrary", {"shared": True, "commentsLikes": True}),
    ("media-types", "Test-Media-Types-15.7.2.photoslibrary", {}),
)
IMPORT_SCENARIOS = {"edited", "raw", "live-photo", "people", "places", "media-types"}


def _inside(path: Any, roots: tuple[Path, ...]) -> bool:
    if isinstance(path, int):
        return False
    try:
        target = Path(os.fspath(path)).expanduser().resolve(strict=False)
    except (OSError, TypeError, ValueError):
        return False
    for root in roots:
        try:
            target.relative_to(root)
            return True
        except ValueError:
            continue
    return False


class ReadOnlySourceGuard:
    """Reject Python-level writes inside source packages during acceptance tests."""

    def __init__(self, roots: list[Path]):
        self.roots = tuple(root.expanduser().resolve(strict=False) for root in roots)
        self.stack = ExitStack()

    def _deny(self, operation: str, *paths: Any) -> None:
        if any(_inside(path, self.roots) for path in paths):
            raise AssertionError(f"Blocked {operation} inside a protected photo source.")

    def __enter__(self) -> "ReadOnlySourceGuard":
        original_open = open
        original_os_open = os.open

        def guarded_open(file: Any, mode: str = "r", *args: Any, **kwargs: Any):
            if any(token in str(mode) for token in ("w", "a", "x", "+")):
                self._deny("open for writing", file)
            return original_open(file, mode, *args, **kwargs)

        def guarded_os_open(path: Any, flags: int, *args: Any, **kwargs: Any):
            write_flags = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
            if flags & write_flags:
                self._deny("os.open for writing", path)
            return original_os_open(path, flags, *args, **kwargs)

        def guard_one(name: str, function: Callable[..., Any]) -> Callable[..., Any]:
            def wrapped(path: Any, *args: Any, **kwargs: Any):
                self._deny(name, path)
                return function(path, *args, **kwargs)

            return wrapped

        def guard_two(
            name: str,
            function: Callable[..., Any],
            *,
            source_is_mutated: bool = True,
        ) -> Callable[..., Any]:
            def wrapped(source: Any, destination: Any, *args: Any, **kwargs: Any):
                self._deny(name, *(source, destination) if source_is_mutated else (destination,))
                return function(source, destination, *args, **kwargs)

            return wrapped

        self.stack.enter_context(patch("builtins.open", guarded_open))
        self.stack.enter_context(patch("os.open", guarded_os_open))
        for target, name in (
            ("os.remove", "remove"),
            ("os.unlink", "unlink"),
            ("os.rmdir", "rmdir"),
            ("shutil.rmtree", "rmtree"),
        ):
            original = getattr(os, name) if target.startswith("os.") else getattr(shutil, name)
            self.stack.enter_context(patch(target, guard_one(name, original)))
        for target, name, source_is_mutated in (
            ("os.rename", "rename", True),
            ("os.replace", "replace", True),
            ("shutil.copy", "copy", False),
            ("shutil.copy2", "copy2", False),
            ("shutil.copyfile", "copyfile", False),
            ("shutil.move", "move", True),
        ):
            owner = os if target.startswith("os.") else shutil
            original = getattr(owner, name)
            self.stack.enter_context(patch(target, guard_two(name, original, source_is_mutated=source_is_mutated)))
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.stack.close()


class OfflineGuard:
    def __enter__(self) -> "OfflineGuard":
        self.stack = ExitStack()

        def blocked(*args: Any, **kwargs: Any) -> None:
            raise AssertionError("Photo-source acceptance attempted network access.")

        self.stack.enter_context(patch.object(socket.socket, "connect", blocked))
        self.stack.enter_context(patch.object(socket, "create_connection", blocked))
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.stack.close()


def package_signature(root: Path, *, shallow: bool = False) -> dict[str, Any]:
    entries: list[tuple[str, str, int, int]] = []
    errors: list[str] = []
    candidates: list[Path]
    if shallow:
        candidates = [
            root,
            root / "database/Photos.sqlite",
            root / "database/Photos.sqlite-wal",
            root / "database/Photos.sqlite-shm",
        ]
    else:
        candidates = []
        try:
            for current, directories, filenames in os.walk(root, followlinks=False):
                directories.sort()
                filenames.sort()
                candidates.append(Path(current))
                candidates.extend(Path(current) / name for name in filenames)
        except OSError as exc:
            errors.append(f"{exc.__class__.__name__}: {exc}")
    for path in candidates:
        try:
            stat = path.lstat()
            kind = "link" if path.is_symlink() else "dir" if path.is_dir() else "file"
            relative = "." if path == root else str(path.relative_to(root))
            entries.append((relative, kind, int(stat.st_size), int(stat.st_mtime_ns)))
        except (OSError, ValueError) as exc:
            if shallow and not path.exists():
                continue
            errors.append(f"{path.name}: {exc.__class__.__name__}")
    encoded = json.dumps(entries, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return {
        "digest": sha256(encoded).hexdigest(),
        "entries": len(entries),
        "errors": errors[:20],
    }


def fixture_root_from(args: argparse.Namespace) -> Path:
    if args.fixtures:
        return Path(args.fixtures).expanduser().resolve()
    configured = os.environ.get("VINTRACE_OSXPHOTOS_FIXTURES", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path("/private/tmp/vintrace-osxphotos-audit/tests")


def real_library_check(adapter: ApplePhotosAdapter) -> dict[str, Any]:
    real_libraries = adapter.discover_libraries()
    result: dict[str, Any] = {
        "discovered": len(real_libraries),
        "libraries": [
            {
                "name": library.name,
                "path": library.path,
                "status": library.status,
                "systemLibrary": library.system_library,
                "lastUsed": library.last_used,
            }
            for library in real_libraries
        ],
        "sourceMutation": False,
    }
    if not real_libraries:
        result.update({"outcome": "not-found", "message": "No user Photos library was discovered."})
        return result
    library = real_libraries[0]
    source = Path(library.path)
    before = package_signature(source, shallow=True)
    try:
        with ReadOnlySourceGuard([source]), OfflineGuard(), adapter.open_library(str(source)):
            pass
        outcome = "opened-read-only"
        message = "The catalog opened read-only; no asset export or source mutation was requested."
    except Exception as exc:
        outcome = "permission-recovery-verified" if library.status == "permission_denied" else "open-failed"
        message = f"{exc.__class__.__name__}: {str(exc)[:700]}"
    after = package_signature(source, shallow=True)
    result.update({
        "outcome": outcome,
        "message": message,
        "signatureBefore": before,
        "signatureAfter": after,
        "sourceMutation": before["digest"] != after["digest"],
    })
    return result


def run_fixture_scenario(
    adapter: ApplePhotosAdapter,
    workspace: Path,
    name: str,
    library_path: Path,
    selected_scopes: dict[str, bool],
) -> dict[str, Any]:
    sensitive = bool(selected_scopes)
    scope_params = {"scopes": selected_scopes, "sensitiveConsent": sensitive}
    scopes = PhotoSourceScopes.from_params(scope_params)
    before = package_signature(library_path)
    started = monotonic()
    result: dict[str, Any] = {
        "name": name,
        "fixture": library_path.name,
        "sourceMutation": False,
        "status": "failed",
    }
    try:
        with ReadOnlySourceGuard([library_path]), OfflineGuard():
            preview = adapter.preview(
                str(library_path),
                scopes,
                item_limit=500,
                sample_limit=8,
                time_budget_ms=10_000,
            )
            result["preview"] = {
                "counts": preview.counts,
                "complete": preview.complete,
                "scannedCount": preview.scanned_count,
                "warnings": preview.warnings,
            }
            import_candidate = None
            if name in IMPORT_SCENARIOS:
                with adapter.open_library(str(library_path)) as opened:
                    for asset in opened.iter_assets(scopes, limit=200):
                        primary = Path(asset.primary_path()).expanduser() if asset.primary_path() else None
                        if primary is None or not primary.is_file():
                            continue
                        if name == "people" and not asset.faces:
                            continue
                        if name == "places" and not asset.location:
                            continue
                        import_candidate = asset
                        break
            if import_candidate is not None:
                scenario_root = workspace / name
                scenario_root.mkdir(parents=True, exist_ok=True)
                database = WorkspaceDb(scenario_root / "workspace.sqlite3")
                service = PhotoSourceService(
                    database,
                    scenario_root,
                    adapters={APPLE_PHOTOS_PROVIDER: adapter},
                    platform_name="darwin",
                )
                params = {
                    "libraryPath": str(library_path),
                    "storageMode": "referenced",
                    "externalIds": [import_candidate.external_id],
                    "allowPhotosExport": False,
                    **scope_params,
                }
                job = service.enqueue_job(APPLE_PHOTOS_PROVIDER, "import", params)
                completed = service.run_job(job["jobId"])
                result["import"] = {
                    "status": completed.get("status"),
                    "counts": completed.get("result", {}).get("counts", {}),
                    "error": completed.get("error", ""),
                    "storageMode": completed.get("result", {}).get("storageMode", ""),
                    "allowPhotosExport": False,
                }
                if completed.get("status") != "completed":
                    raise AssertionError(f"Referenced import did not complete: {completed.get('error', '')}")
                if completed.get("result", {}).get("storageMode") != "referenced":
                    raise AssertionError("Acceptance import unexpectedly changed storage mode.")
            else:
                result["import"] = {"status": "not-applicable", "reason": "No local readable candidate selected."}
        result["status"] = "passed"
    except Exception as exc:
        result["error"] = f"{exc.__class__.__name__}: {str(exc)[:1000]}"
    after = package_signature(library_path)
    result.update({
        "elapsedMs": int((monotonic() - started) * 1000),
        "signatureBefore": before,
        "signatureAfter": after,
        "sourceMutation": before["digest"] != after["digest"],
    })
    if result["sourceMutation"]:
        result["status"] = "failed"
        result["error"] = "The source package metadata signature changed during the scenario."
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run read-only Apple Photos acceptance checks on macOS.")
    parser.add_argument("--fixtures", default="", help="Path to the upstream osxphotos tests directory.")
    parser.add_argument("--report", default="build/qa/photo-source-mac-acceptance.json")
    parser.add_argument("--require-fixtures", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "safety": {
            "sourceMode": "read-only",
            "storageMode": "referenced",
            "networkBlocked": True,
            "photosExportAllowed": False,
            "sourceDeletionAllowed": False,
        },
        "status": "failed",
    }
    if platform.system().lower() != "darwin":
        report.update({"status": "skipped", "reason": "This acceptance runner requires macOS."})
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps({"status": report["status"], "reason": report["reason"], "report": str(report_path)}))
        return 0

    adapter = ApplePhotosAdapter(platform_name="darwin", env={})
    report["provider"] = adapter.status()
    report["realLibrary"] = real_library_check(adapter)
    fixtures = fixture_root_from(args)
    report["fixtureRoot"] = str(fixtures)
    scenarios: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="vintrace-photo-source-acceptance-") as temp:
        workspace = Path(temp)
        for name, fixture_name, scopes in FIXTURE_SCENARIOS:
            library_path = fixtures / fixture_name
            if not library_path.is_dir():
                scenarios.append({
                    "name": name,
                    "fixture": fixture_name,
                    "status": "missing",
                    "sourceMutation": False,
                })
                continue
            scenarios.append(run_fixture_scenario(adapter, workspace, name, library_path, scopes))
    report["scenarios"] = scenarios
    fixture_failures = [item for item in scenarios if item.get("status") == "failed"]
    missing = [item for item in scenarios if item.get("status") == "missing"]
    mutations = [item for item in scenarios if item.get("sourceMutation")]
    real_mutation = bool(report["realLibrary"].get("sourceMutation"))
    passed = not fixture_failures and not mutations and not real_mutation and (not args.require_fixtures or not missing)
    report["summary"] = {
        "passed": sum(item.get("status") == "passed" for item in scenarios),
        "failed": len(fixture_failures),
        "missing": len(missing),
        "sourceMutations": len(mutations) + int(real_mutation),
    }
    report["status"] = "passed" if passed else "failed"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "realLibrary": report["realLibrary"].get("outcome", ""),
        "summary": report["summary"],
        "report": str(report_path),
    }, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
