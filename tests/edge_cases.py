from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
import hashlib
import math
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi, structured_error
from crossage_fr.config import MAX_CLUSTER_MIN_SIZE, RuntimeConfig, Thresholds, load_config, save_config
from crossage_fr.enroll import manager as manager_module
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import ImageLoadError, load_image, sha256_file
from crossage_fr.ingest.safety import SafetyAssessment
from crossage_fr.ingest.video_io import VideoFrameSample, probe_video, sample_video_frames, video_decoder_report
from crossage_fr.match.scoring import group_hits
from crossage_fr.model_manager import MODEL_PACKAGES, ModelPackageSpec, download_model_pack, model_governance, model_status
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate
from crossage_fr.store import SearchHit, VectorStore
from crossage_fr.store.workspace_db import path_signature


def make_face(path: Path, shirt=(74, 88, 138)) -> None:
    image = Image.new("RGB", (280, 280), (182, 152, 116))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
    draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
    draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
    draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
    draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
    draw.rectangle((116, 168, 164, 246), fill=shirt)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=95)


def make_sensitive(path: Path) -> None:
    image = Image.new("RGB", (280, 280), (232, 198, 168))
    draw = ImageDraw.Draw(image)
    draw.ellipse((20, 10, 260, 290), fill=(236, 198, 164))
    draw.rectangle((0, 0, 280, 28), fill=(34, 34, 42))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=95)


def expect_raises(exc_type: type[BaseException], fn, contains: str = "") -> None:
    try:
        fn()
    except exc_type as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"Expected error to contain {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError(f"Expected {exc_type.__name__}")


def make_api(root: Path) -> DesktopApi:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root.parent / "registry")
    return DesktopApi(root)


def assert_corrupt_workspace_recovery() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-corrupt-"))
    workspace = root / "workspace"
    workspace.mkdir()
    (workspace / "config.json").write_text("[not-a-config]", encoding="utf-8")
    (workspace / "references.json").write_text(json.dumps([{"bad": "row"}, "not-a-row"]), encoding="utf-8")
    (workspace / "review_candidates.json").write_text("{not json", encoding="utf-8")
    (workspace / "scan_history.json").write_text(json.dumps({"bad": "shape"}), encoding="utf-8")

    api = make_api(workspace)
    state = api.state()
    assert state["counts"] == {"references": 0, "pending": 0, "reviewed": 0, "candidates": 0}
    assert state["config"]["requireConsent"] is True
    assert (workspace / "config.corrupt.json").exists()
    assert (workspace / "review_candidates.corrupt.json").exists()
    assert (workspace / "scan_history.corrupt.json").exists()


def assert_corrupt_sqlite_startup_recovery() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-corrupt-db-"))
    workspace = root / "workspace"
    workspace.mkdir()
    (workspace / "workspace.sqlite3").write_text("not a sqlite database", encoding="utf-8")
    api = make_api(workspace)
    database = api.handle("database_integrity", {})
    assert database["ok"] is True
    backups = list((workspace / "db-backups").glob("*-startup-corrupt/workspace.sqlite3"))
    assert backups, "Corrupt startup DB should be snapshotted before rebuild."


def assert_config_round_trip_and_invalid_shape() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-config-"))
    config_path = root / "config.json"
    save_config(RuntimeConfig(safe_mode=False, cluster_min_size=5), config_path)
    loaded = load_config(config_path)
    assert loaded.safe_mode is False
    assert loaded.cluster_min_size == 5

    bad_path = root / "bad-config.json"
    bad_path.write_text(json.dumps({"thresholds": "invalid"}), encoding="utf-8")
    recovered = load_config(bad_path)
    assert recovered.safe_mode is True
    assert (root / "bad-config.corrupt.json").exists()

    unsafe_path = root / "unsafe-config.json"
    unsafe_path.write_text(json.dumps({"safe_mode": "yes", "cluster_min_size": 1}), encoding="utf-8")
    recovered = load_config(unsafe_path)
    assert recovered.safe_mode is True
    assert recovered.cluster_min_size == 2
    assert (root / "unsafe-config.corrupt.json").exists()

    oversized_path = root / "oversized-config.json"
    oversized_path.write_text(json.dumps({"cluster_min_size": MAX_CLUSTER_MIN_SIZE + 1}), encoding="utf-8")
    recovered = load_config(oversized_path)
    assert recovered.cluster_min_size == 2
    assert (root / "oversized-config.corrupt.json").exists()


def assert_invalid_project_rows_are_skipped() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-rows-"))
    workspace = root / "workspace"
    workspace.mkdir()
    Image.new("RGB", (40, 32), (80, 120, 160)).save(root / "ref-good.tiff", format="TIFF")
    Image.new("RGB", (40, 32), (120, 80, 160)).save(root / "candidate-good.tiff", format="TIFF")
    valid_vector = [1.0] + [0.0] * 511
    (workspace / "references.json").write_text(
        json.dumps(
            [
                {
                    "ref_id": "ref_good",
                    "person_name": "Person",
                    "age_bucket": "adult",
                    "source_path": str(root / "ref-good.tiff"),
                    "capture_date": None,
                    "quality": 0.9,
                    "model_name": "test",
                    "vector": valid_vector,
                },
                {
                    "ref_id": "ref_bad_vector",
                    "person_name": "Person",
                    "age_bucket": "adult",
                    "source_path": str(root / "ref-bad.jpg"),
                    "capture_date": None,
                    "quality": 0.9,
                    "model_name": "test",
                    "vector": [1.0, 2.0],
                },
                {
                    "ref_id": "ref_nan",
                    "person_name": "Person",
                    "age_bucket": "adult",
                    "source_path": str(root / "ref-nan.jpg"),
                    "capture_date": None,
                    "quality": 0.9,
                    "model_name": "test",
                    "vector": [float("nan")] + [0.0] * 511,
                },
            ]
        ),
        encoding="utf-8",
    )
    (workspace / "review_candidates.json").write_text(
        json.dumps(
            [
                {
                    "candidate_id": "cand_good",
                    "source_path": str(root / "candidate-good.tiff"),
                    "person_name": "Person",
                    "best_ref_id": "ref_good",
                    "best_ref_path": str(root / "ref-good.tiff"),
                    "score": 0.8,
                    "band": "likely",
                    "quality": 0.8,
                    "model_name": "test",
                    "status": "pending",
                },
                {
                    "candidate_id": "cand_bad_status",
                    "source_path": str(root / "candidate-bad.jpg"),
                    "person_name": "Person",
                    "best_ref_id": "ref_good",
                    "best_ref_path": str(root / "ref-good.jpg"),
                    "score": 0.8,
                    "band": "likely",
                    "quality": 0.8,
                    "model_name": "test",
                    "status": "not-a-status",
                },
                {
                    "candidate_id": "cand_bad_score",
                    "source_path": str(root / "candidate-bad-score.jpg"),
                    "person_name": "Person",
                    "best_ref_id": "ref_good",
                    "best_ref_path": str(root / "ref-good.jpg"),
                    "score": "high",
                    "band": "likely",
                    "quality": 0.8,
                    "model_name": "test",
                    "status": "pending",
                },
            ]
        ),
        encoding="utf-8",
    )

    api = make_api(workspace)
    state = api.state()
    assert [ref["refId"] for ref in state["references"]] == ["ref_good"]
    assert [candidate["candidateId"] for candidate in state["candidates"]] == ["cand_good"]
    assert state["counts"]["references"] == 1
    assert state["counts"]["candidates"] == 1
    assert state["references"][0]["previewPath"]
    assert state["candidates"][0]["previewPath"]
    assert state["candidates"][0]["bestRefPreviewPath"]
    assert Path(state["candidates"][0]["previewPath"]).exists()


def assert_command_validation_and_empty_inputs() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-commands-"))
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person.jpg")
    scan.mkdir()
    (scan / "notes.txt").write_text("ignore me", encoding="utf-8")

    api = make_api(root / "workspace")
    expect_raises(PermissionError, lambda: api.handle("scan", {"folder": str(scan)}), "Consent")
    api.handle("set_consent", {"value": True})
    expect_raises(ValueError, lambda: api.handle("scan", {"folder": str(scan)}), "Enroll")
    expect_raises(ValueError, lambda: api.handle("enroll", {"personName": "", "folder": str(refs)}), "person name")
    expect_raises(ValueError, lambda: api.handle("enroll_age_groups", {"personName": "A", "groups": "bad"}), "list")

    enrolled = api.handle("enroll", {"personName": "Person", "ageBucket": "adult", "folder": str(refs)})
    assert enrolled["added"] == 1
    duplicate = api.handle("enroll", {"personName": "Person", "ageBucket": "adult", "folder": str(refs)})
    assert duplicate["added"] == 0

    expect_raises(ValueError, lambda: api.handle("scan_paths", {"paths": "not-list"}), "list")
    filtered = api.handle("scan_paths", {"paths": [str(scan / "notes.txt")]})
    assert filtered["metrics"]["total"] == 0
    assert filtered["metrics"]["processed"] == 0
    assert filtered["state"]["scanHistory"][0]["metrics"]["total"] == 0

    missing = api.handle("scan", {"folder": str(root / "missing-folder")})
    assert missing["metrics"]["total"] == 1
    assert missing["metrics"]["errors"] == 1
    assert missing["metrics"]["pathErrors"] == 1
    assert missing["state"]["scanHistory"][0]["status"] == "error"


def assert_consent_workspace_registry_and_audit_pagination() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-registry-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    state = api.state()
    assert state["workspaceMetadata"]["workspaceId"]
    assert state["consentOnFile"] is False
    assert (workspace / ".vintrace-workspace.json").exists()
    assert (root / "registry" / "active-workspace.json").exists()

    api.handle("set_consent", {"value": True, "operator": "Edge", "note": "durable consent", "source": "test"})
    reopened = make_api(workspace)
    reopened_state = reopened.state()
    assert reopened_state["consentOnFile"] is True
    assert reopened_state["consent"]["operator"] == "Edge"
    assert (workspace / "consent.json").exists()

    reopened.handle("clear_queue", {})
    audit = reopened.handle("audit_events", {"limit": 2, "offset": 0})
    assert audit["total"] >= 2
    assert len(audit["events"]) == 2
    assert audit["events"][0]["action"] == "clear_candidates"


def assert_broken_and_sensitive_images_do_not_pollute_queue() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-scan-"))
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person.jpg")
    make_sensitive(scan / "private.jpg")
    (scan / "broken.jpg").parent.mkdir(parents=True, exist_ok=True)
    (scan / "broken.jpg").write_bytes(b"not an image")

    api = make_api(root / "workspace")
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person", "folder": str(refs)})["added"] == 1
    result = api.handle("scan", {"folder": str(scan), "source": "edge-sensitive"})
    assert result["metrics"]["processed"] == 2
    assert result["metrics"]["safeFiltered"] == 1
    assert result["metrics"]["errors"] == 1
    assert result["state"]["counts"]["candidates"] == 0
    assert len(result["state"]["scanHistory"][0]["errorSamples"]) == 1


def assert_image_decompression_guard() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-decompression-"))
    path = root / "small.jpg"
    Image.new("RGB", (4, 4), (120, 140, 160)).save(path, quality=95)
    old_limit = Image.MAX_IMAGE_PIXELS
    try:
        Image.MAX_IMAGE_PIXELS = 1
        expect_raises(ImageLoadError, lambda: load_image(path), "decompression bomb")
    finally:
        Image.MAX_IMAGE_PIXELS = old_limit


def assert_static_app_contracts() -> None:
    root = Path(__file__).resolve().parents[1]
    html = (root / "index.html").read_text(encoding="utf-8")
    assert html.startswith("<!doctype html>"), "index.html must not contain stray text before the doctype."
    assert html.count('<div id="root"></div>') == 1
    assert "Content-Security-Policy" in html
    assert "vintrace-media:" in html
    assert "object-src 'none'" in html
    assert "frame-src 'none'" in html

    desktop_main = (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    # EIPC-01: safeRealpath was extracted to desktop/main/util.cjs; main.cjs now
    # imports and uses it for path-trust checks.
    assert 'require("./main/util.cjs")' in desktop_main
    assert "safeRealpath" in desktop_main
    util_cjs = (root / "desktop" / "main" / "util.cjs").read_text(encoding="utf-8")
    assert "function safeRealpath" in util_cjs
    assert "previewsReal" in desktop_main
    assert "!fs.existsSync(target) || !isTrustedMediaPath(target)" in desktop_main

    release_workflow = (root / ".github" / "workflows" / "windows-release.yml").read_text(encoding="utf-8")
    assert "release_tag" in release_workflow
    assert "softprops/action-gh-release@v2" in release_workflow
    assert "dist/latest*.yml" in release_workflow
    assert "contents: write" in release_workflow
    assert "npm run release:verify" in release_workflow
    mac_workflow = (root / ".github" / "workflows" / "macos-release.yml").read_text(encoding="utf-8")
    assert "macOS Unsigned Release" in mac_workflow
    assert "npm run dist:mac:unsigned" in mac_workflow
    assert "Vintrace-macOS-Unsigned" in mac_workflow
    assert "npm run release:verify" in mac_workflow

    i18n = (root / "src" / "i18n.ts").read_text(encoding="utf-8")
    for code in ('"en"', '"zh"', '"es"', '"fr"', '"ar"', '"hi"', '"ja"'):
        assert code in i18n
    assert "localizeDom" in i18n
    assert "हिन्दी" in i18n
    assert "Español" in i18n
    assert "中文" in i18n
    assert "Français" in i18n
    assert "العربية" in i18n
    assert "日本語" in i18n
    assert "translateUiText(language: LanguageCode, source: string" in i18n
    assert "uiPhraseTranslations" in i18n
    assert "export type UiMessageKey" in i18n
    assert "formatUiMessage(language: LanguageCode" in i18n
    assert "formatErrorMessage(language: LanguageCode" in i18n
    assert '"E-WORKSPACE-LOCKED"' in i18n
    assert '"E-BACKEND-TIMEOUT"' in i18n
    assert '"notice.possibleMatchesFound"' in i18n
    assert 'localizeAttribute(element, "alt", language)' in i18n
    assert "isLocalizableAttributeElement" in i18n
    app_tsx = (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "languageStorageKey" in app_tsx
    assert 'document.getElementById("root") || document.body' in app_tsx
    assert "localizeDom(targetRoot, language)" in app_tsx
    assert 'attributeFilter: ["alt", "aria-label", "placeholder", "title"]' in app_tsx
    assert 'className="language-picker"' in app_tsx
    assert 'document.documentElement.dir = language === "ar" ? "rtl" : "ltr"' in app_tsx
    assert "setImperativeLanguage(language)" in app_tsx
    assert "window.crossAge.setAppLanguage" in app_tsx
    assert "setNoticeMessage(" in app_tsx
    assert "setErrorNotice(error" in app_tsx
    assert "formatErrorMessage(language, notice.errorCode" in app_tsx
    assert "notice.messageKey" in app_tsx

    preload = (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "setAppLanguage" in preload
    assert "normalizeIpcError" in preload
    assert "safeInvoke(\"backend:invoke\"" in preload
    assert "app:set-language" in desktop_main
    assert "nativeUiText" in desktop_main
    assert "createAppError(\"E-WORKSPACE-LOCKED\"" in desktop_main
    assert "createAppError(\"E-IPC-BLOCKED-COMMAND\"" in desktop_main
    assert 'lang="${escapeHtml(appLanguage)}"' in desktop_main
    main_tsx = (root / "src" / "main.tsx").read_text(encoding="utf-8")
    assert 'bootT("boot.couldNotLoad")' in main_tsx
    assert "applyBootLanguage(language)" in main_tsx
    assert "StartupRecoveryGate" in main_tsx
    assert "vintrace:startup-recovery:v1" in main_tsx
    assert "Reset UI state" in main_tsx
    assert "Repair app folder" in main_tsx

    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["bench:scale"].endswith("tests/scale_benchmark.py")
    assert package["scripts"]["bench:accuracy"].endswith("tests/accuracy_benchmark.py")
    assert package["scripts"]["release:verify"].endswith("desktop/scripts/verify-release-assets.cjs")
    resources = {entry["from"] for entry in package["build"]["extraResources"]}
    assert {"models/safety", "mcp", "report.md", "crossage_fr"} <= resources
    backend_resource = next(entry for entry in package["build"]["extraResources"] if entry["from"] == "backend-dist")
    assert backend_resource["to"] == "backend"
    assert {"crossage-backend", "crossage-backend.exe", "crossage-backend/**/*"} <= set(backend_resource["filter"])

    associations = package["build"]["fileAssociations"]
    image_exts = set(associations[0]["ext"])
    video_exts = set(associations[1]["ext"])
    assert {"jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "dng", "raw"} <= image_exts
    assert {"mov", "mp4", "m4v", "avi", "mkv", "webm", "hevc"} <= video_exts
    assert "ts" not in video_exts

    mcp_manifest = json.loads((root / "mcp" / "manifest.json").read_text(encoding="utf-8"))
    mcp_server = mcp_manifest["server"]
    assert mcp_server["entry_point"] == "server/crossage-backend/crossage-backend"
    mcp_config = mcp_server["mcp_config"]
    assert mcp_config["command"] == "${__dirname}${/}server${/}crossage-backend${/}crossage-backend"
    assert mcp_config["platform_overrides"]["win32"]["command"] == "${__dirname}${/}server${/}crossage-backend${/}crossage-backend.exe"
    assert mcp_config["env"]["CROSSAGE_SAFE_MODEL_DIR"] == "${__dirname}${/}models${/}safety"
    assert mcp_config["env"]["CROSSAGE_REPORT_PATH"] == "${__dirname}${/}report.md"
    manifest_tools = {tool["name"] for tool in mcp_manifest["tools"]}

    required_commands = {
        "get_state",
        "model_status",
        "set_model_root",
        "download_model",
        "set_workspace",
        "set_consent",
        "enroll",
        "enroll_age_groups",
        "scan",
        "scan_paths",
        "cancel_scan",
        "pause_scan",
        "resume_scan",
        "scan_job_status",
        "analyze_folder",
        "set_status",
        "bulk_set_status",
        "set_candidate_note",
        "block_false_match",
        "reassign_candidate_person",
        "duplicate_people",
        "apply_review_rules",
        "query_candidates",
        "clear_queue",
        "purge_candidates",
        "purge_duplicate_candidates",
        "prepare_previews",
        "delete_reference",
        "delete_person",
        "rename_person",
        "clear_references",
        "purge_old_candidates",
        "database_integrity",
        "repair_database_integrity",
        "export_report",
        "export_workspace_backup",
        "verify_workspace_backup",
        "restore_workspace_backup",
        "prune_workspace_backups",
        "export_candidates",
        "preview_candidate_media_action",
        "manage_candidate_media",
        "media_action_history",
        "restore_media_action",
        "retry_media_action",
        "undo_media_action",
        "media_trash_report",
        "cleanup_media_trash",
        "export_media_bundle",
        "export_consent_receipt",
        "retention_policy_report",
        "export_safe_mode_audit",
        "model_drift_report",
        "reference_gap_report",
        "export_review_ledger",
        "workspace_health",
        "runtime_self_test",
        "runtime_benchmark",
        "storage_io_benchmark",
        "release_readiness",
        "model_distribution_audit",
        "model_switch_dry_run",
        "backfill_model_references",
        "installer_self_diagnostics",
        "public_dataset_catalog",
        "inspect_public_dataset",
        "run_public_dataset_benchmark",
        "compare_public_dataset_models",
        "apply_model_recommendation",
        "calibration_summary",
        "accuracy_evaluation",
        "generate_accuracy_validation_pack",
        "run_accuracy_validation_pack",
        "accuracy_validation_history",
        "apply_calibration",
        "export_accuracy_labels",
        "import_accuracy_labels",
        "privacy_report",
        "delete_face_data",
        "optimize_workspace",
        "enforce_storage_budget",
        "add_calibration_label",
        "set_performance_mode",
        "save_settings",
        "audit_events",
    }
    for rel in ("desktop/main.cjs", "desktop/preload.cjs"):
        text = desktop_main if rel == "desktop/main.cjs" else (root / rel).read_text(encoding="utf-8")
        assert "TRUSTED_BACKEND_COMMANDS" in text
        for command in required_commands:
            assert f'"{command}"' in text, f"{command} is missing from {rel}."
    app_tsx = (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert '"import_accuracy_labels"' in app_tsx
    assert "function parseAccuracyLabelRows" in app_tsx
    assert "Import label JSON" in app_tsx
    assert '"add_calibration_label"' in app_tsx
    assert "Teach accuracy" in app_tsx
    assert "getScanMarkerStatus" in app_tsx
    assert "saveSettingsDraftIfDirty" in app_tsx
    assert "memory-pressure-banner" in app_tsx
    assert "runtimePerformanceProfile" in app_tsx
    assert "repairDatabaseIntegrity" in app_tsx
    assert "Storage write" in app_tsx
    assert "Saving storage limit" in app_tsx
    assert "Undo last" in app_tsx
    assert "Switch destination" in app_tsx
    assert "Check app trash" in app_tsx
    assert "Preview cleanup" in app_tsx
    assert "Clean old app trash" in app_tsx
    assert "media-action-preview-list" in app_tsx
    assert "Saving review rules" in app_tsx
    assert "acceptedMediaAvailable" in app_tsx
    assert "Delete face data and history" in app_tsx
    assert "TesterModePanel" in app_tsx
    assert "Friend test mode" in app_tsx
    assert "Simple setup for a first test" in app_tsx
    mcp_bundle_builder = (root / "desktop" / "scripts" / "build-mcp-bundle.cjs").read_text(encoding="utf-8")
    assert 'path.join(serverDir, "crossage-backend")' in mcp_bundle_builder
    assert 'path.join(fallbackDir, backendName)' in mcp_bundle_builder
    release_verifier = (root / "desktop" / "scripts" / "verify-release-assets.cjs").read_text(encoding="utf-8")
    assert "installer download is public" in release_verifier
    assert "sha256" in release_verifier
    assert "--require-release-metadata" in release_verifier
    release_artifacts = (root / "desktop" / "scripts" / "create-release-artifacts.cjs").read_text(encoding="utf-8")
    assert "SHA256SUMS.txt" in release_artifacts
    assert "vintrace-sbom.json" in release_artifacts
    assert "vintrace-provenance.json" in release_artifacts
    localization_check = (root / "desktop" / "scripts" / "check-localization.cjs").read_text(encoding="utf-8")
    assert "critical literals" in localization_check
    assert "visible literal translation coverage" in localization_check
    releases_doc = (root / "RELEASES.md").read_text(encoding="utf-8")
    assert "Windows installer" in releases_doc
    assert "macOS" in releases_doc
    assert "release:verify" in releases_doc
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    assert "release:artifacts" in package["scripts"]
    assert "test:model-downloader" in package["scripts"]
    assert "test:perf-budget" in package["scripts"]
    assert "test:localization" in package["scripts"]
    assert "test:filesystem-chaos" in package["scripts"]
    assert "test:backup-roundtrip" in package["scripts"]
    assert "test:dataset-benchmark" in package["scripts"]
    assert "test:e2e:buttons" in package["scripts"]
    assert "test:e2e:i18n" in package["scripts"]
    assert "test:e2e:ipc" in package["scripts"]
    assert "test:e2e:a11y" in package["scripts"]
    assert "test:e2e:soak" in package["scripts"]
    qa_workflow = (root / ".github" / "workflows" / "qa.yml").read_text(encoding="utf-8")
    assert "Model downloader failure modes" in qa_workflow
    assert "Filesystem chaos suite" in qa_workflow
    assert "Workspace backup roundtrip" in qa_workflow
    assert "Public dataset benchmark harness" in qa_workflow
    assert "Performance budget" in qa_workflow
    assert "Playwright button regression" in qa_workflow
    assert "Playwright localization layout" in qa_workflow
    assert "Playwright IPC security fuzz" in qa_workflow
    assert "Playwright accessibility keyboard" in qa_workflow
    assert "Playwright memory soak" in qa_workflow
    assert "Localization contract" in qa_workflow
    windows_workflow = (root / ".github" / "workflows" / "windows-release.yml").read_text(encoding="utf-8")
    mac_workflow = (root / ".github" / "workflows" / "macos-release.yml").read_text(encoding="utf-8")
    assert "npm run release:artifacts" in windows_workflow
    assert "npm run release:artifacts" in mac_workflow
    assert "SHA256SUMS.txt" in windows_workflow
    assert "SHA256SUMS.txt" in mac_workflow
    assert "--require-release-metadata" in windows_workflow
    assert "--require-release-metadata" in mac_workflow
    assert {
        "get_project_state",
        "mark_consent",
        "enroll_reference_folder",
        "scan_folder",
        "scan_media_paths",
        "query_candidates",
        "review_candidate",
        "bulk_review_candidates",
        "export_review_report",
        "export_workspace_backup",
        "restore_workspace_backup",
        "delete_face_data",
        "runtime_benchmark",
        "release_readiness",
        "set_performance_mode",
        "public_dataset_catalog",
        "inspect_public_dataset",
        "run_public_dataset_benchmark",
        "compare_public_dataset_models",
        "apply_model_recommendation",
        "reference_gap_report",
    } <= manifest_tools


def assert_model_downloader_integrity_and_safe_extract() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-model-download-"))
    source = root / "source"
    source.mkdir()
    archive = source / "tiny_pack.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("tiny_pack/det_10g.onnx", b"detector")
        handle.writestr("tiny_pack/w600k_r50.onnx", b"recognizer")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    spec = ModelPackageSpec(
        pack="tiny_pack",
        label="Tiny test pack",
        detail="Downloader integrity fixture.",
        filename="tiny_pack.zip",
        url=archive.resolve().as_uri(),
        sha256=digest,
        size_bytes=archive.stat().st_size,
        license="test",
        source="local fixture",
        required_any=(("det_10g.onnx",), ("w600k_r50.onnx",)),
    )
    MODEL_PACKAGES[spec.pack] = spec
    progress_events: list[dict] = []
    try:
        result = download_model_pack(spec.pack, root / "models-root", on_progress=progress_events.append)
        installed = Path(result["path"])
        assert result["verified"] is True
        assert result["sha256"] == digest
        assert (installed / "det_10g.onnx").read_bytes() == b"detector"
        assert (installed / "w600k_r50.onnx").read_bytes() == b"recognizer"
        assert not (root / "models-root" / "models" / ".tiny_pack.extracting").exists()
        assert not (root / "models-root" / "models" / ".tiny_pack.installing").exists()
        assert progress_events[0]["phase"] == "starting"
        assert progress_events[-1]["phase"] == "complete"
        assert any(event["phase"] == "downloading" for event in progress_events)
        assert any(event["phase"] == "verifying" for event in progress_events)
        assert any(event["phase"] == "extracting" for event in progress_events)

        resume_root = root / "resume-root"
        resume_downloads = resume_root / "downloads"
        resume_downloads.mkdir(parents=True)
        (resume_downloads / f"{spec.filename}.part").write_bytes(archive.read_bytes())
        resume_events: list[dict] = []
        resumed = download_model_pack(spec.pack, resume_root, on_progress=resume_events.append)
        assert resumed["verified"] is True
        assert (resume_downloads / spec.filename).exists()
        assert not (resume_downloads / f"{spec.filename}.part").exists()
        assert resume_events[-1]["phase"] == "complete"

        force_root = root / "force-root"
        force_downloads = force_root / "downloads"
        force_downloads.mkdir(parents=True)
        (force_downloads / spec.filename).write_bytes(b"corrupt existing archive")
        (force_downloads / f"{spec.filename}.part").write_bytes(b"stale partial")
        forced = download_model_pack(spec.pack, force_root, force=True)
        assert forced["verified"] is True
        assert (force_downloads / spec.filename).read_bytes() == archive.read_bytes()
        assert not (force_downloads / f"{spec.filename}.part").exists()

        bad_archive = source / "unsafe_pack.zip"
        with zipfile.ZipFile(bad_archive, "w") as handle:
            handle.writestr("../escape.onnx", b"nope")
            handle.writestr("unsafe_pack/det_10g.onnx", b"detector")
            handle.writestr("unsafe_pack/w600k_r50.onnx", b"recognizer")
        bad_spec = ModelPackageSpec(
            pack="unsafe_pack",
            label="Unsafe test pack",
            detail="Downloader unsafe path fixture.",
            filename="unsafe_pack.zip",
            url=bad_archive.resolve().as_uri(),
            sha256=hashlib.sha256(bad_archive.read_bytes()).hexdigest(),
            size_bytes=bad_archive.stat().st_size,
            license="test",
            source="local fixture",
            required_any=(("det_10g.onnx",), ("w600k_r50.onnx",)),
        )
        MODEL_PACKAGES[bad_spec.pack] = bad_spec
        expect_raises(ValueError, lambda: download_model_pack(bad_spec.pack, root / "unsafe-root"), "Unsafe path")
        assert not (root / "escape.onnx").exists()
        assert not (root / "unsafe-root" / "models" / ".unsafe_pack.extracting").exists()
        assert not (root / "unsafe-root" / "models" / ".unsafe_pack.installing").exists()
    finally:
        MODEL_PACKAGES.pop("tiny_pack", None)
        MODEL_PACKAGES.pop("unsafe_pack", None)


def assert_corrupt_installed_models_fail_integrity() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-corrupt-model-"))
    model_root = root / "models-root"
    pack_dir = model_root / "models" / "antelopev2"
    pack_dir.mkdir(parents=True)
    (pack_dir / "det_10g.onnx").write_bytes(b"")
    (pack_dir / "w600k_r50.onnx").write_bytes(b"not an onnx model")
    api = make_api(root / "workspace")
    api.project.config.model_root = str(model_root)
    api.project.config.model_pack = "antelopev2"
    integrity = api.model_integrity()
    installed = next(check for check in integrity["checks"] if check["name"] == "Installed ONNX files")
    assert installed["ok"] is False
    assert integrity["ok"] is False
    assert any(item["ok"] is False for item in installed["value"])


class StaticUnmatchedEngine:
    model_name = "edge-static-unmatched"

    def embed_image(self, path: Path) -> list[EmbeddingResult]:
        with Image.open(path) as image:
            return self.embed_loaded_image(image.convert("RGB"), path)

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        del image, path
        return [
            EmbeddingResult(
                vector=[1.0] + [0.0] * 511,
                quality=1.0,
                bbox=(0, 0, 10, 10),
                model_name=self.model_name,
            )
        ]


class CountingMatchedEngine(StaticUnmatchedEngine):
    model_name = "edge-counting-matched"

    def __init__(self) -> None:
        self.calls = 0

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        self.calls += 1
        return super().embed_loaded_image(image, path)


class NoEmbeddingEngine(StaticUnmatchedEngine):
    model_name = "edge-no-embeddings"

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        del image, path
        return []


def assert_unmatched_clustering_flushes_in_batches() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-cluster-batch-"))
    scan = root / "scan"
    for index in range(4):
        make_face(scan / f"unknown-{index}.jpg", shirt=(60 + index * 38, 80 + index * 22, 120 + index * 11))
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    project.config.cluster_min_size = 2
    original_batch_size = manager_module.UNMATCHED_CLUSTER_BATCH_SIZE
    manager_module.UNMATCHED_CLUSTER_BATCH_SIZE = 2
    try:
        added, errors, metrics = project.scan_paths(sorted(scan.glob("*.jpg")), StaticUnmatchedEngine(), total=4)
    finally:
        manager_module.UNMATCHED_CLUSTER_BATCH_SIZE = original_batch_size
    assert errors == []
    assert added == 4
    assert metrics["unmatched"] == 4
    assert metrics["clustered"] == 4
    assert project.scan_history[0]["metrics"]["clustered"] == 4
    assert {candidate.person_name for candidate in project.candidates.values()} == {"Unmatched cluster 1", "Unmatched cluster 2"}


def assert_embedding_cache_reuses_face_work() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-embedding-cache-"))
    scan = root / "scan"
    ref_path = root / "ref.jpg"
    image_path = scan / "candidate.jpg"
    make_face(ref_path)
    make_face(image_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_cache",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-counting-matched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    first_engine = CountingMatchedEngine()
    _added, errors, metrics = project.scan_paths([image_path], first_engine, total=1, source="cache-a", label="cache-a")
    assert errors == []
    assert first_engine.calls == 1
    assert metrics["embeddingCacheMisses"] == 1
    assert metrics["poseUnknown"] == 1
    second_engine = CountingMatchedEngine()
    _added2, errors2, metrics2 = project.scan_paths([image_path], second_engine, total=1, source="cache-b", label="cache-b")
    assert errors2 == []
    assert second_engine.calls == 0
    assert metrics2["embeddingCacheHits"] == 1
    assert metrics2["poseUnknown"] == 1


def assert_model_spaces_are_isolated_for_matching() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-model-isolation-"))
    ref_path = root / "ref.jpg"
    candidate_path = root / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_other_model",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="other-model-space",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    added, errors, metrics = project.scan_paths([candidate_path], StaticUnmatchedEngine(), total=1, source="model-isolation", label="model-isolation")
    assert errors == []
    assert added == 0
    assert metrics["matched"] == 0
    assert metrics["unmatched"] == 1
    compatibility = project.model_compatibility_report(StaticUnmatchedEngine.model_name)
    assert compatibility["compatibleReferences"] == 0
    assert compatibility["otherModelReferences"] == 1
    assert compatibility["needsBackfill"] is True


def assert_api_scan_requires_backfill_for_mixed_model_spaces() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-api-model-guard-"))
    ref_path = root / "ref.jpg"
    candidate_path = root / "scan" / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    api = make_api(root / "workspace")
    api.handle("set_consent", {"value": True})
    ref = ReferenceFace(
        ref_id="ref_stale_model",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="old-model-space",
        vector=[1.0] + [0.0] * 511,
    )
    api.project.references[ref.ref_id] = ref
    api.project.vector_store.add(ref.ref_id, ref.vector)
    dry_run = api.handle("model_switch_dry_run", {"targetPack": "buffalo_l"})
    assert dry_run["targetPack"] == "buffalo_l"
    assert isinstance(dry_run["safeToSave"], bool)
    assert dry_run["downloadBytes"] >= 0
    assert dry_run["referencesNeedingBackfill"] == 1
    assert dry_run["safeToSave"] or dry_run["blockers"]
    expect_raises(
        ValueError,
        lambda: api.handle("scan_paths", {"paths": [str(candidate_path)], "source": "guard-test"}),
        "E-MODEL-BACKFILL",
    )
    expect_raises(
        ValueError,
        lambda: api.handle("scan", {"folder": str(candidate_path.parent), "source": "guard-test"}),
        "E-MODEL-BACKFILL",
    )
    allowed = api.handle(
        "scan_paths",
        {"paths": [str(candidate_path)], "source": "guard-test", "allowIncompatibleModel": True},
    )
    assert allowed["metrics"]["processed"] == 1
    assert allowed["metrics"]["unmatched"] == 1
    allowed_folder = api.handle(
        "scan",
        {"folder": str(candidate_path.parent), "source": "guard-test", "allowIncompatibleModel": True, "resume": False},
    )
    assert allowed_folder["metrics"]["processed"] == 1


def assert_reference_backfill_creates_active_model_embeddings() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-model-backfill-"))
    ref_path = root / "ref.jpg"
    candidate_path = root / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    old_ref = ReferenceFace(
        ref_id="ref_old_model",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="old-model-space",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[old_ref.ref_id] = old_ref
    project.vector_store.add(old_ref.ref_id, old_ref.vector)
    result = project.backfill_references_for_model(CountingMatchedEngine())
    assert result["added"] == 1
    assert result["compatibility"]["compatibleReferences"] == 1
    assert len(project.references) == 2
    new_ref = next(ref for ref in project.references.values() if ref.ref_id != old_ref.ref_id)
    assert new_ref.person_name == old_ref.person_name
    assert new_ref.age_bucket == old_ref.age_bucket
    assert new_ref.source_hash
    assert new_ref.pose_bucket == "unknown"
    second = project.backfill_references_for_model(CountingMatchedEngine())
    assert second["added"] == 0
    assert second["total"] == 0
    assert second["skipped"] == 0
    assert second["compatibility"]["needsBackfill"] is False
    added, errors, metrics = project.scan_paths([candidate_path], CountingMatchedEngine(), total=1, source="model-backfill", label="model-backfill")
    assert errors == []
    assert added == 1
    assert metrics["matched"] == 1


def assert_pose_bucket_tracking_and_cache_hits() -> None:
    class PoseSequenceEngine:
        model_name = "edge-pose-sequence"

        def __init__(self) -> None:
            self.calls = 0

        def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
            del image
            self.calls += 1
            name = path.name if path else ""
            pose = "unknown"
            if "frontal" in name:
                pose = "frontal"
            elif "three" in name:
                pose = "three-quarter"
            elif "profile" in name:
                pose = "profile"
            return [
                EmbeddingResult(
                    vector=[1.0] + [0.0] * 511,
                    quality=1.0,
                    bbox=(0, 0, 10, 10),
                    model_name=self.model_name,
                    pose_bucket=pose,
                )
            ]

    root = Path(tempfile.mkdtemp(prefix="crossage-edge-pose-buckets-"))
    ref_path = root / "ref.jpg"
    scan = root / "scan"
    make_face(ref_path)
    for index, name in enumerate(["frontal.jpg", "three-quarter.jpg", "profile.jpg", "unknown.jpg"]):
        make_face(scan / name, shirt=(60 + index * 40, 90 + index * 25, 130 + index * 15))
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_pose",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name=PoseSequenceEngine.model_name,
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    engine = PoseSequenceEngine()
    added, errors, metrics = project.scan_paths(sorted(scan.glob("*.jpg")), engine, total=4, source="pose", label="pose")
    assert errors == []
    assert added == 4
    assert metrics["poseFrontal"] == 1
    assert metrics["poseThreeQuarter"] == 1
    assert metrics["poseProfile"] == 1
    assert metrics["poseUnknown"] == 1
    assert {candidate.pose_bucket for candidate in project.candidates.values()} == {"frontal", "three-quarter", "profile", "unknown"}
    second_engine = PoseSequenceEngine()
    _added2, errors2, metrics2 = project.scan_paths([scan / "profile.jpg"], second_engine, total=1, source="pose-cache", label="pose-cache")
    assert errors2 == []
    assert second_engine.calls == 0
    assert metrics2["embeddingCacheHits"] == 1
    assert metrics2["poseProfile"] == 1


def assert_profile_pose_uses_review_threshold_without_accepting_frontal_noise() -> None:
    class LowScorePoseEngine:
        model_name = "edge-low-score-pose"

        def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
            del image
            pose = "profile" if path and "profile" in path.name else "frontal"
            score = 0.16
            return [
                EmbeddingResult(
                    vector=[score, math.sqrt(1.0 - score * score)] + [0.0] * 510,
                    quality=1.0,
                    bbox=(0, 0, 10, 10),
                    model_name=self.model_name,
                    pose_bucket=pose,
                )
            ]

    root = Path(tempfile.mkdtemp(prefix="crossage-edge-pose-threshold-"))
    ref_path = root / "ref.jpg"
    scan = root / "scan"
    profile_path = scan / "candidate-profile.jpg"
    frontal_path = scan / "candidate-frontal.jpg"
    make_face(ref_path)
    make_face(profile_path, shirt=(90, 120, 180))
    make_face(frontal_path, shirt=(180, 120, 90))
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    project.config.two_pass_scan = False
    ref = ReferenceFace(
        ref_id="ref_profile_threshold",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name=LowScorePoseEngine.model_name,
        vector=[1.0] + [0.0] * 511,
    )
    ref_support = ReferenceFace(
        ref_id="ref_profile_threshold_support",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name=LowScorePoseEngine.model_name,
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.references[ref_support.ref_id] = ref_support
    project.vector_store.add(ref.ref_id, ref.vector)
    project.vector_store.add(ref_support.ref_id, ref_support.vector)
    added, errors, metrics = project.scan_paths([profile_path, frontal_path], LowScorePoseEngine(), total=2, source="pose-threshold", label="pose-threshold")
    assert errors == []
    assert added == 1
    assert metrics["matched"] == 1
    assert metrics["unmatched"] == 1
    assert metrics["poseRelaxedReviews"] == 1
    assert metrics["poseRelaxedProfile"] == 1
    assert metrics["poseRelaxedThreeQuarter"] == 0
    assert metrics["poseReranked"] == 1
    assert metrics["poseProfile"] == 1
    assert metrics["poseFrontal"] == 1
    candidate = next(iter(project.candidates.values()))
    assert candidate.pose_bucket == "profile"
    assert "Hard-angle match used pose-aware scoring" in candidate.note or "Hard-pose review threshold" in candidate.note


def assert_match_scoring_flags_close_single_reference_decisions() -> None:
    thresholds = Thresholds(confident=0.40, likely=0.28, relaxed_child=0.20, quality_min=0.10)
    refs = {
        "ref_a": ReferenceFace(
            ref_id="ref_a",
            person_name="Ada",
            age_bucket="adult",
            source_path="/tmp/ada.jpg",
            capture_date=None,
            quality=1.0,
            model_name="test",
            vector=[1.0] + [0.0] * 511,
        ),
        "ref_b": ReferenceFace(
            ref_id="ref_b",
            person_name="Grace",
            age_bucket="adult",
            source_path="/tmp/grace.jpg",
            capture_date=None,
            quality=1.0,
            model_name="test",
            vector=[1.0] + [0.0] * 511,
        ),
    }
    decision = group_hits([SearchHit("ref_a", 0.34), SearchHit("ref_b", 0.32)], refs, thresholds, pose_bucket="frontal")
    assert decision is not None
    assert decision.person_name == "Ada"
    assert "close-runner-up" in decision.flags
    assert "single-reference-close-runner-up" in decision.flags
    assert "single-reference-match" in decision.flags
    assert "ambiguous-person-margin" in decision.flags
    assert decision.runner_up_margin is not None and decision.runner_up_margin < 0.025
    assert decision.score < 0.34


def assert_duplicate_content_is_suppressed_across_paths() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-hash-dedupe-"))
    scan = root / "scan"
    ref_path = root / "ref.jpg"
    first = scan / "candidate-a.jpg"
    second = scan / "candidate-renamed-copy.jpg"
    make_face(ref_path)
    make_face(first)
    second.parent.mkdir(parents=True, exist_ok=True)
    second.write_bytes(first.read_bytes())
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_hash",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    added, errors, metrics = project.scan_paths([first, second], StaticUnmatchedEngine(), total=2, source="hash-dedupe", label="hash-dedupe")
    assert errors == []
    assert added == 1
    assert metrics["matched"] == 1
    assert metrics["skipped"] >= 1
    assert len(project.candidates) == 1
    candidate = next(iter(project.candidates.values()))
    assert candidate.source_hash
    assert project.workspace_health()["duplicateCandidateCount"] == 0


def assert_scan_candidates_survive_without_json_snapshot() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-sqlite-candidates-"))
    workspace = root / "workspace"
    scan = root / "scan"
    ref_path = root / "ref.jpg"
    candidate_path = scan / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    project = ProjectState(workspace)
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_sqlite",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    added, errors, metrics = project.scan_paths([candidate_path], StaticUnmatchedEngine(), total=1, source="sqlite-save", label="sqlite-save")
    assert errors == []
    assert added == 1
    assert metrics["matched"] == 1
    assert not (workspace / "review_candidates.json").exists()
    reloaded = ProjectState(workspace)
    assert len(reloaded.candidates) == 1
    assert next(iter(reloaded.candidates.values())).person_name == "Person"
    api = DesktopApi(workspace)
    api.project.candidates.clear()
    state = api.state(preview_create_budget=0, candidate_limit=10)
    assert state["counts"]["candidates"] == 1
    assert state["candidateWindow"]["index"] == "sqlite"
    assert len(state["candidates"]) == 1


def assert_large_store_dedupe_uses_sqlite_lookup() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-sqlite-dedupe-"))
    scan = root / "scan"
    ref_path = root / "ref.jpg"
    candidate_path = scan / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_sqlite_dedupe",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    added, errors, metrics = project.scan_paths([candidate_path], StaticUnmatchedEngine(), total=1, source="sqlite-dedupe-a", label="sqlite-dedupe-a")
    assert errors == []
    assert added == 1
    original_limit = manager_module.CANDIDATE_MEMORY_DEDUPE_LIMIT
    manager_module.CANDIDATE_MEMORY_DEDUPE_LIMIT = 0
    try:
        added2, errors2, metrics2 = project.scan_paths([candidate_path], StaticUnmatchedEngine(), total=1, source="sqlite-dedupe-b", label="sqlite-dedupe-b")
    finally:
        manager_module.CANDIDATE_MEMORY_DEDUPE_LIMIT = original_limit
    assert errors2 == []
    assert added2 == 0
    assert metrics2["skipped"] >= 1
    assert len(project.candidates) == 1


def assert_heuristic_fallback_safety_is_not_cached() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-safety-cache-"))
    image_path = root / "scan" / "candidate.jpg"
    make_face(image_path)
    image = load_image(image_path)
    project = ProjectState(root / "workspace")
    calls = 0
    original = manager_module.assess_image_safety

    def fake_assess(path: Path, threshold: float, image=None) -> SafetyAssessment:
        nonlocal calls
        del path, threshold, image
        calls += 1
        if calls == 1:
            return SafetyAssessment(
                sensitive=False,
                score=0.1,
                reason="temporary fallback",
                skin_ratio=0.0,
                lower_skin_ratio=0.0,
                largest_region_ratio=0.0,
                engine="heuristic-fallback",
            )
        return SafetyAssessment(
            sensitive=False,
            score=0.02,
            reason="model recovered",
            skin_ratio=0.0,
            lower_skin_ratio=0.0,
            largest_region_ratio=0.0,
            engine="onnx-hybrid",
            model_name="safe-mode-test",
        )

    manager_module.assess_image_safety = fake_assess
    try:
        first, content_hash = project._assess_safety_cached(image_path, image)
        second, _ = project._assess_safety_cached(image_path, image, content_hash=content_hash)
    finally:
        manager_module.assess_image_safety = original
    assert first.engine == "heuristic-fallback"
    assert second.engine == "onnx-hybrid"
    assert calls == 2


def assert_hashing_can_be_cancelled() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-hash-cancel-"))
    payload = root / "large.bin"
    payload.write_bytes(b"x" * (2 * 1024 * 1024))
    expect_raises(InterruptedError, lambda: sha256_file(payload, lambda: True), "cancelled")


def assert_external_drive_discovery_edges() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-storage-"))
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    _added, errors, metrics = project.scan_folder(root / "missing-drive", StaticUnmatchedEngine())
    assert errors
    assert metrics["pathErrors"] >= 1
    assert project.scan_history[0]["status"] == "error"

    scan = root / "scan"
    target = scan / "target.jpg"
    link = scan / "alias.jpg"
    make_face(target)
    try:
        link.symlink_to(target)
    except OSError:
        return
    project2 = ProjectState(root / "workspace-symlink")
    project2.config.safe_mode = False
    _added2, errors2, metrics2 = project2.scan_folder(scan, StaticUnmatchedEngine())
    assert any("Skipped symlink" in error for error in errors2)
    assert metrics2["pathErrors"] >= 1


def assert_mutating_file_is_deferred() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-mutating-file-"))
    workspace = root / "workspace"
    scan = root / "scan"
    ref_path = root / "ref.jpg"
    candidate_path = scan / "candidate.jpg"
    make_face(ref_path)
    make_face(candidate_path)
    project = ProjectState(workspace)
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_mutating",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    original_sha = manager_module.sha256_file
    changed = False

    def mutate_once(path: Path, cancel_requested=None) -> str:
        nonlocal changed
        del cancel_requested
        if not changed:
            changed = True
            with path.open("ab") as handle:
                handle.write(b"changed-during-scan")
        return original_sha(path)

    manager_module.sha256_file = mutate_once
    try:
        added, errors, metrics = project.scan_paths([candidate_path], StaticUnmatchedEngine(), total=1)
    finally:
        manager_module.sha256_file = original_sha
    assert added == 0
    assert errors and "changed while it was being scanned" in errors[0]
    assert metrics["pathErrors"] >= 1
    assert not project.candidates


def assert_scan_exclusions_are_honored() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-exclusions-"))
    refs = root / "refs"
    scan = root / "scan"
    skipped = scan / "skipme"
    make_face(refs / "person.jpg")
    make_face(scan / "candidate.jpg")
    make_face(skipped / "ignored.jpg")
    api = make_api(root / "workspace")
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person", "folder": str(refs)})["added"] == 1
    api.handle("save_settings", {"scanExclusions": {"dirNames": ["skipme"], "pathKeywords": [], "extensions": []}})
    analysis = api.handle("analyze_folder", {"folder": str(scan)})
    assert analysis["imageCount"] == 1
    assert analysis["excludedDirectoryCount"] == 1
    assert analysis["excludedSamples"]
    assert analysis["storage"]["exists"] is True
    assert analysis["storage"]["isDirectory"] is True
    assert "volumeKind" in analysis["storage"]
    assert "storage" in analysis["plan"]
    assert analysis["readiness"]["ready"] is True
    assert any(check["name"] == "Video decoder" for check in analysis["readiness"]["checks"])
    assert analysis["transientErrorCount"] == 0
    bounded_analysis = api.handle("analyze_folder", {"folder": str(scan), "maxEntries": 1, "timeBudgetMs": 1000})
    assert bounded_analysis["truncated"] is True
    assert bounded_analysis["entriesChecked"] >= 1
    assert any("safety limit" in item for item in bounded_analysis["recommendations"])
    direct = api.handle("scan_paths", {"paths": [str(skipped / "ignored.jpg")], "source": "exclusion-test", "resume": False})
    assert direct["metrics"]["excluded"] == 1
    assert direct["added"] == 0
    api.handle("save_settings", {"scanExclusions": {"dirNames": ["skipme"], "pathKeywords": [], "extensions": [], "filePaths": [str(scan / "candidate.jpg")]}})
    exact_analysis = api.handle("analyze_folder", {"folder": str(scan)})
    assert exact_analysis["imageCount"] == 0
    assert exact_analysis["excludedCount"] == 1
    assert exact_analysis["excludedDirectoryCount"] == 1
    size_limited = api.handle(
        "save_settings",
        {
            "maxMediaFileBytes": 1,
            "scanExclusions": {"dirNames": ["skipme"], "pathKeywords": [], "extensions": [], "filePaths": []},
        },
    )
    assert size_limited["config"]["maxMediaFileBytes"] == 1
    size_analysis = api.handle("analyze_folder", {"folder": str(scan)})
    assert size_analysis["imageCount"] == 0
    assert size_analysis["excludedCount"] == 1
    assert any("size limit" in item["reason"] for item in size_analysis["excludedSamples"])
    size_direct = api.handle("scan_paths", {"paths": [str(scan / "candidate.jpg")], "source": "size-limit-test", "resume": False})
    assert size_direct["metrics"]["excluded"] == 1
    assert size_direct["added"] == 0

    missing = scan / "vanished.jpg"
    project = ProjectState(root / "missing-workspace")
    added, errors, metrics = project.scan_paths(
        [missing],
        StaticUnmatchedEngine(),
        total=1,
        source="missing-drive-test",
        label="missing-drive-test",
        resume=False,
    )
    assert added == 0
    assert errors
    assert metrics["errors"] == 1
    assert metrics["pathErrors"] == 1
    assert metrics["processed"] == 1


def assert_scan_folder_reports_discovery_errors() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-discovery-errors-"))
    scan = root / "scan"
    bad = scan / "bad-drive"
    good = scan / "good"
    make_face(good / "candidate.jpg")
    bad.mkdir(parents=True)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    original_scandir = manager_module.os.scandir
    bad_resolved = bad.resolve()

    def flaky_scandir(value):
        if Path(value).resolve() == bad_resolved:
            raise OSError("drive disappeared")
        return original_scandir(value)

    manager_module.os.scandir = flaky_scandir
    try:
        added, errors, metrics = project.scan_folder(scan, StaticUnmatchedEngine(), total=None, resume=False)
    finally:
        manager_module.os.scandir = original_scandir
    assert added >= 0
    assert errors
    assert any("drive disappeared" in error for error in errors)
    assert metrics["pathErrors"] == 1
    assert metrics["errors"] == 1
    assert metrics["processed"] >= 1
    with project.db.connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM scan_files WHERE phase = 'discovery' AND status = 'error'").fetchone()
        assert int(row["n"]) == 1


def assert_video_frame_orphans_are_pruned() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-video-prune-"))
    video = root / "clip.mp4"
    video.write_bytes(b"fake-video")
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    frame_path = project.video_frames_path / "fake-clip" / "frame-00000001-0000001000ms.jpg"
    original_sampler = manager_module.sample_video_frames

    def fake_sampler(path: Path, output_root: Path, *args, **kwargs):
        del path, args, kwargs
        target = output_root / "fake-clip" / "frame-00000001-0000001000ms.jpg"
        make_face(target)
        return [
            VideoFrameSample(
                path=target,
                timestamp_ms=1000,
                frame_index=1,
                width=280,
                height=280,
                duration_ms=2000,
            )
        ]

    manager_module.sample_video_frames = fake_sampler
    try:
        added, errors, metrics = project.scan_paths([video], NoEmbeddingEngine(), total=1, source="video-prune", label="video-prune")
    finally:
        manager_module.sample_video_frames = original_sampler
    assert added == 0
    assert errors == []
    assert metrics["videoFrames"] == 1
    assert not frame_path.exists()


def assert_scan_cancel_and_resume_manifest() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-resume-"))
    scan = root / "scan"
    for index in range(3):
        make_face(scan / f"resume-{index}.jpg", shirt=(80 + index, 90, 120))
    ref_path = root / "ref.jpg"
    make_face(ref_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_resume",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    events: list[dict[str, object]] = []

    def progress(payload: dict[str, object]) -> None:
        events.append(payload)
        if payload.get("phase") == "processed" and int(payload.get("processed", 0) or 0) == 1:
            project.request_scan_cancel(source="test")

    added, errors, metrics = project.scan_paths(
        sorted(scan.glob("*.jpg")),
        StaticUnmatchedEngine(),
        total=3,
        source="manual",
        label="resume-suite",
        resume=True,
        on_progress=progress,
    )
    assert errors == []
    assert metrics["cancelled"] == 1
    assert any(event.get("phase") == "cancelled" for event in events)
    assert added >= 0

    added2, errors2, metrics2 = project.scan_paths(
        sorted(scan.glob("*.jpg")),
        StaticUnmatchedEngine(),
        total=3,
        source="manual",
        label="resume-suite",
        resume=True,
    )
    assert errors2 == []
    assert metrics2["resumed"] == 1
    assert metrics2["manifestSkipped"] >= 1
    assert metrics2["processed"] == 3
    assert added2 >= 0


def assert_vector_store_persists_reference_index() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-vector-store-"))
    index_path = root / "vectors.npz"
    store = VectorStore()
    first = [1.0] + [0.0] * 511
    second = [0.0, 1.0] + [0.0] * 510
    store.add("one", first)
    store.add("two", second)
    saved = store.save(index_path)
    assert saved["ok"] is True
    restored = VectorStore()
    assert restored.load(index_path, expected_ids={"one", "two"}) is True
    hits = restored.search(first, k=1)
    assert hits and hits[0].item_id == "one"
    assert restored.load(index_path, expected_ids={"missing"}) is False


def assert_stale_candidate_manifest_is_reprocessed() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-stale-manifest-"))
    scan = root / "scan"
    candidate_path = scan / "candidate.jpg"
    ref_path = root / "ref.jpg"
    make_face(candidate_path)
    make_face(ref_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    ref = ReferenceFace(
        ref_id="ref_stale",
        person_name="Person",
        age_bucket="adult",
        source_path=str(ref_path),
        capture_date=None,
        quality=1.0,
        model_name="edge-static-unmatched",
        vector=[1.0] + [0.0] * 511,
    )
    project.references[ref.ref_id] = ref
    project.vector_store.add(ref.ref_id, ref.vector)
    added, errors, metrics = project.scan_paths(
        [candidate_path],
        StaticUnmatchedEngine(),
        total=1,
        source="manual",
        label="stale-suite",
        resume=True,
    )
    assert errors == []
    assert added == 1
    assert metrics["matched"] == 1
    assert len(project.candidates) == 1

    project.candidates.clear()
    project.save()
    added2, errors2, metrics2 = project.scan_paths(
        [candidate_path],
        StaticUnmatchedEngine(),
        total=1,
        source="manual",
        label="stale-suite",
        resume=True,
    )
    assert errors2 == []
    assert metrics2["resumed"] == 1
    assert metrics2["manifestSkipped"] == 0
    assert added2 == 1
    assert len(project.candidates) == 1

    stat = candidate_path.stat()
    os.utime(candidate_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    added3, errors3, metrics3 = project.scan_paths(
        [candidate_path],
        StaticUnmatchedEngine(),
        total=1,
        source="manual",
        label="stale-suite",
        resume=True,
    )
    assert errors3 == []
    assert added3 == 0
    assert metrics3["resumed"] == 1
    assert metrics3["manifestSkipped"] == 1
    assert metrics3["hashResumeSkipped"] == 1


def assert_video_decoder_fallback_metadata() -> None:
    report = video_decoder_report()
    assert "opencvAvailable" in report
    assert "ffmpegAvailable" in report
    assert "managedPackageAvailable" in report
    assert "ffmpegSource" in report
    assert "probeLimited" in report
    assert "fallbackOrder" in report
    assert report["backend"] in {"opencv", "ffmpeg", "unavailable"}


def make_tiny_video(path: Path) -> bool:
    try:
        import cv2
        import numpy as np
    except Exception:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    codecs = ["mp4v", "avc1", "MJPG", "XVID"]
    if path.suffix.lower() == ".webm":
        codecs = ["VP80", "VP90", *codecs]
    for codec in codecs:
        try:
            fourcc = cv2.VideoWriter_fourcc(*codec)
            writer = cv2.VideoWriter(str(path), fourcc, 6.0, (64, 64))
            if not writer.isOpened():
                writer.release()
                continue
            for index in range(8):
                frame = np.zeros((64, 64, 3), dtype=np.uint8)
                frame[:, :, 0] = 20 + index * 12
                frame[:, :, 1] = 80
                frame[:, :, 2] = 180 - index * 8
                cv2.putText(frame, str(index), (18, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                writer.write(frame)
            writer.release()
            if path.exists() and path.stat().st_size > 0:
                return True
        except Exception:
            try:
                writer.release()
            except Exception:
                pass
    return False


def assert_synthetic_video_decoder_suite() -> None:
    with tempfile.TemporaryDirectory() as temp_name:
        root = Path(temp_name)
        video_path = root / "fixture.mp4"
        assert make_tiny_video(video_path), "OpenCV could not create a synthetic MP4 fixture."
        output_root = root / "frames"
        probe = probe_video(video_path)
        assert probe["readable"] is True
        samples = sample_video_frames(video_path, output_root, max_frames=3, interval_seconds=0.25)
        assert samples
        assert all(sample.path.exists() for sample in samples)
        alias_successes = 0
        for suffix in (".mov", ".webm"):
            alias = root / f"fixture{suffix}"
            shutil.copy2(video_path, alias)
            try:
                alias_samples = sample_video_frames(alias, output_root, max_frames=1, interval_seconds=0.25)
            except Exception:
                continue
            if alias_samples:
                alias_successes += 1
        assert alias_successes >= 1, "No MOV/WebM-style video alias could be decoded."


def assert_accuracy_validation_pack() -> None:
    with tempfile.TemporaryDirectory() as temp_name:
        project = ProjectState(Path(temp_name) / "workspace")
        result = project.generate_accuracy_validation_pack()
        expected = {"cross-age", "low-light", "video-frame", "side-profile", "occlusion", "family-lookalike"}
        assert set(result["scenarios"]) == expected
        assert result["counts"]["cases"] == 6
        assert Path(result["manifestPath"]).exists()
        assert Path(result["labelsJsonPath"]).exists()
        assert Path(result["labelsCsvPath"]).exists()
        assert result["metrics"]["likely"]["labeled"] == 6
        manifest = json.loads(Path(result["manifestPath"]).read_text(encoding="utf-8"))
        assert len(manifest["labels"]) == 6
        assert set(manifest["segments"]) == expected
        run = project.run_accuracy_validation_pack()
        assert run["status"] == "pass"
        assert run["passed"] == 6
        assert len(run["scenarioResults"]) == 6
        history = project.accuracy_validation_history()
        assert history and history[0]["runId"] == run["runId"]


def assert_model_governance_metadata() -> None:
    config = RuntimeConfig()
    status = model_status(config, "local-image-fingerprint")
    assert status["governance"]["humanReviewRequired"] is True
    assert status["packages"][0]["governance"]["limitations"]
    governance = model_governance(config.model_pack)
    assert governance["redistributionRisk"]


def assert_package_artifact_checker() -> None:
    root = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        ["node", str(root / "desktop" / "scripts" / "check-package-artifacts.cjs")],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout
    payload = json.loads(completed.stdout)
    assert payload["ok"] is True
    assert any(check["name"] == "backend resources configured" for check in payload["checks"])


def assert_operational_use_case_commands() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-usecases-"))
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person.jpg")
    make_face(scan / "candidate.jpg", shirt=(92, 116, 88))
    (scan / "notes.txt").write_text("ignore me", encoding="utf-8")

    api = make_api(root / "workspace")
    preflight = api.handle("analyze_folder", {"folder": str(scan)})
    assert preflight["exists"] is True
    assert preflight["isDirectory"] is True
    assert preflight["imageCount"] == 1
    assert preflight["nonImageCount"] == 1
    assert preflight["recommendations"]
    assert preflight["plan"]["resumable"] is True
    assert preflight["plan"]["mediaCount"] == 1
    assert preflight["plan"]["estimatedWorkspaceBytes"] > 0
    assert preflight["readiness"]["ready"] is False
    assert any("Add at least one person" in item for item in preflight["readiness"]["blockers"])

    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person", "folder": str(refs)})["added"] == 1
    scanned = api.handle("scan", {"folder": str(scan), "source": "edge-usecases"})
    assert scanned["state"]["counts"]["candidates"] == 1
    candidate_id = scanned["state"]["candidates"][0]["candidateId"]

    renamed = api.handle("rename_person", {"oldName": "Person", "newName": "Person Prime"})
    assert renamed["renamed"] == {"references": 1, "candidates": 1}
    assert renamed["state"]["references"][0]["personName"] == "Person Prime"
    assert renamed["state"]["candidates"][0]["personName"] == "Person Prime"

    noted = api.handle("set_candidate_note", {"candidateId": candidate_id, "note": "Operator checked source album."})
    assert noted["candidates"][0]["note"] == "Operator checked source album."
    bulk = api.handle("bulk_set_status", {"candidateIds": [candidate_id], "status": "accepted"})
    assert bulk["updated"] == 1
    assert bulk["state"]["candidates"][0]["status"] == "accepted"

    page = api.handle("query_candidates", {"status": "accepted", "query": "Person Prime", "limit": 10})
    assert page["total"] == 1
    assert page["returned"] == 1
    assert page["index"] == "sqlite"
    assert api.project.db.candidate_count() == len(api.project.candidates)
    assert page["items"][0]["candidateId"] == candidate_id
    assert page["items"][0]["sourceHash"]

    accuracy = api.handle("accuracy_evaluation", {})
    assert accuracy["metrics"]["likely"]["labeled"] == 1
    assert "precision" in accuracy["metrics"]["likely"]
    labels = api.handle("export_accuracy_labels", {})
    label_value = labels["value"]
    assert Path(label_value["jsonPath"]).exists()
    assert Path(label_value["csvPath"]).exists()
    assert label_value["counts"]["labels"] == 1
    imported = api.handle(
        "import_accuracy_labels",
        {
            "rows": [
                {
                    "candidateId": candidate_id,
                    "sourcePath": str(scan / "candidate.jpg"),
                    "sourceHash": page["items"][0]["sourceHash"],
                    "expectedPerson": "Person Prime",
                    "actualPerson": "Person Prime",
                    "matchScore": 0.91,
                    "isMatch": True,
                }
            ]
        },
    )
    assert imported["value"]["imported"] == 1
    api.handle(
        "add_calibration_label",
        {
            "row": {
                "sourcePath": str(scan / "candidate.jpg"),
                "expectedPerson": "Person Prime",
                "actualPerson": "Person Prime",
                "matchScore": 0.9,
                "isMatch": True,
            }
        },
    )
    api.handle(
        "add_calibration_label",
        {
            "row": {
                "sourcePath": str(scan / "notes.txt"),
                "expectedPerson": "Person Prime",
                "actualPerson": "Other",
                "matchScore": 0.12,
                "isMatch": False,
            }
        },
    )
    calibrated = api.handle("apply_calibration", {})
    assert calibrated["state"]["calibration"]["positivePairs"] >= 1
    assert calibrated["state"]["config"]["thresholds"]["likely"] > 0.12

    exported = api.handle("export_report", {})
    export_value = exported["value"]
    assert Path(export_value["jsonPath"]).exists()
    assert Path(export_value["csvPath"]).exists()
    export_json = json.loads(Path(export_value["jsonPath"]).read_text(encoding="utf-8"))
    assert export_json["counts"]["accepted"] == 1
    assert export_json["references"]
    assert "vector" not in export_json["references"][0]
    assert "face vector" not in json.dumps(export_json).lower()
    assert export_value["counts"]["candidates"] == 1

    history = api.handle("export_scan_history", {})
    history_value = history["value"]
    assert Path(history_value["jsonPath"]).exists()
    assert Path(history_value["csvPath"]).exists()
    assert history_value["counts"]["runs"] >= 1
    assert history_value["counts"]["processed"] >= 1

    inventory = api.handle("export_workspace_inventory", {})
    inventory_value = inventory["value"]
    assert Path(inventory_value["jsonPath"]).exists()
    assert Path(inventory_value["csvPath"]).exists()
    assert inventory_value["counts"]["sourceFolders"] >= 1

    activity_export = api.handle("export_audit_log", {})
    activity_value = activity_export["value"]
    assert Path(activity_value["jsonPath"]).exists()
    assert Path(activity_value["csvPath"]).exists()
    assert activity_value["counts"]["events"] >= 1

    consent_receipt = api.handle("export_consent_receipt", {})
    receipt_value = consent_receipt["value"]
    assert Path(receipt_value["jsonPath"]).exists()
    assert Path(receipt_value["csvPath"]).exists()
    receipt_json = json.loads(Path(receipt_value["jsonPath"]).read_text(encoding="utf-8"))
    assert receipt_json["consent"]["active"] is True
    assert receipt_value["counts"]["references"] == 1

    retention = api.handle("retention_policy_report", {})
    assert retention["counts"]["reviewedCandidates"] == 1
    assert retention["policy"]["originalMediaIsNeverDeleted"] is True
    assert "90" in retention["reviewedOlderThanDays"]

    safe_audit = api.handle("export_safe_mode_audit", {})
    safe_value = safe_audit["value"]
    assert Path(safe_value["jsonPath"]).exists()
    assert Path(safe_value["csvPath"]).exists()
    assert "safeFiltered" in safe_value["counts"]

    reference_gaps = api.handle("reference_gap_report", {})
    assert reference_gaps["people"] == 1
    assert reference_gaps["needsAttention"] == 1
    assert reference_gaps["items"][0]["personName"] == "Person Prime"
    assert reference_gaps["items"][0]["referenceCount"] == 1
    assert "needs-more-references" in reference_gaps["items"][0]["gaps"]
    assert "needs-side-reference" in reference_gaps["items"][0]["gaps"]
    assert any("side" in action.lower() or "profile" in action.lower() for action in reference_gaps["items"][0]["actions"])

    drift_clean = api.handle("model_drift_report", {})
    assert drift_clean["counts"]["staleReferences"] == 0
    api.project.references[next(iter(api.project.references))].model_name = "legacy-model"
    api.project.candidates[candidate_id].model_name = "legacy-model"
    api.project.save()
    drift_stale = api.handle("model_drift_report", {})
    assert drift_stale["counts"]["staleReferences"] == 1
    assert drift_stale["counts"]["staleCandidates"] == 1
    stale_reference_gaps = api.handle("reference_gap_report", {})
    assert stale_reference_gaps["items"][0]["status"] == "blocked"
    assert "needs-active-model-backfill" in stale_reference_gaps["items"][0]["gaps"]

    ledger = api.handle("export_review_ledger", {})
    ledger_value = ledger["value"]
    assert Path(ledger_value["jsonPath"]).exists()
    assert Path(ledger_value["csvPath"]).exists()
    assert ledger_value["counts"]["candidates"] == 1
    assert ledger_value["counts"]["decisionEvents"] >= 1

    support = api.handle("export_support_bundle", {"includePaths": False})
    support_value = support["value"]
    support_path = Path(support_value["zipPath"])
    assert support_path.exists()
    assert support_value["fileCount"] >= 8
    with zipfile.ZipFile(support_path) as archive:
        assert "workspace-health.json" in archive.namelist()
        assert "retention-policy-report.json" in archive.namelist()
        assert "model-drift-report.json" in archive.namelist()
        support_text = "\n".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.endswith(".json")
        )
        assert str(root) not in support_text
        assert str(Path.home()) not in support_text

    moved = root / "moved"
    make_face(moved / "refs" / "person.jpg")
    make_face(moved / "scan" / "candidate.jpg")
    relink_preview = api.handle("relink_workspace_paths", {"oldRoot": str(root), "newRoot": str(moved), "dryRun": True})
    assert relink_preview["value"]["dryRun"] is True
    assert relink_preview["value"]["relinkedFields"] >= 2
    relinked = api.handle("relink_workspace_paths", {"oldRoot": str(root), "newRoot": str(moved), "dryRun": False})
    assert relinked["value"]["relinkedFields"] >= 2
    assert relinked["value"]["relinkedScanRuns"] >= 1
    assert relinked["value"]["relinkedScanFiles"] >= 1
    moved_scan = (moved / "scan").resolve()
    moved_candidate = moved_scan / "candidate.jpg"
    resumed_run = api.project.db.latest_scan_run(str(moved_scan), "edge-usecases", str(moved_scan))
    assert resumed_run
    assert api.project.db.scan_file_resume_row(resumed_run, moved_candidate, path_signature(moved_candidate)) is not None
    best_ref_id = api.project.candidates[candidate_id].best_ref_id
    assert best_ref_id is not None
    assert Path(api.project.references[best_ref_id].source_path).resolve().is_relative_to(moved.resolve())

    media_bundle = api.handle("export_media_bundle", {"statuses": ["accepted"]})
    bundle_value = media_bundle["value"]
    assert Path(bundle_value["bundlePath"]).exists()
    assert Path(bundle_value["manifestPath"]).exists()
    assert Path(bundle_value["csvPath"]).exists()
    assert bundle_value["counts"]["selected"] == 1
    assert bundle_value["counts"]["copied"] == 1

    optimized = api.handle("optimize_workspace", {})
    optimize_value = optimized["value"]
    assert optimize_value["totalBytesReclaimed"] >= 0
    assert "previewFilesRemoved" in optimize_value
    assert optimized["state"]["workspace"] == str((root / "workspace").resolve())

    current_config = optimized["state"]["config"]
    budgeted = api.handle(
        "save_settings",
        {
            "thresholds": current_config["thresholds"],
            "clusterMinSize": current_config["clusterMinSize"],
            "faceDetectorSize": current_config["faceDetectorSize"],
            "twoPassScan": current_config["twoPassScan"],
            "verificationDetectorSize": current_config["verificationDetectorSize"],
            "safeMode": current_config["safeMode"],
            "safeModeThreshold": current_config["safeModeThreshold"],
            "storageBudgetBytes": 1,
        },
    )
    assert budgeted["config"]["storageBudgetBytes"] == 1
    storage = api.handle("enforce_storage_budget", {})
    assert "withinBudget" in storage["value"]

    model_integrity = api.handle("model_integrity", {})
    assert model_integrity["checks"]
    assert {check["name"] for check in model_integrity["checks"]} >= {"Face model", "Model folder writable", "Image decoder"}

    installer = api.handle("installer_self_diagnostics", {})
    installer_checks = {check["name"] for check in installer["checks"]}
    assert {"App folder write", "Model downloader", "Photo formats", "Workspace health"} <= installer_checks
    assert installer["generatedAt"]

    duplicates = api.handle("duplicate_people", {"threshold": 0.5, "limit": 5})
    assert duplicates["peopleChecked"] >= 1
    assert "suggestions" in duplicates

    ruled_candidate_id = next(iter(api.project.candidates))
    api.project.candidates[ruled_candidate_id].status = "pending"
    api.project.candidates[ruled_candidate_id].score = 0.01
    api.project.save()
    rules_state = api.handle(
        "save_settings",
        {
            "thresholds": current_config["thresholds"],
            "clusterMinSize": current_config["clusterMinSize"],
            "faceDetectorSize": current_config["faceDetectorSize"],
            "twoPassScan": current_config["twoPassScan"],
            "verificationDetectorSize": current_config["verificationDetectorSize"],
            "safeMode": current_config["safeMode"],
            "safeModeThreshold": current_config["safeModeThreshold"],
            "storageBudgetBytes": 1,
            "reviewRules": {
                "autoRejectBelow": 0.2,
                "autoUncertainLowQuality": True,
                "autoRejectLowQualityVideo": True,
            },
        },
    )
    assert rules_state["config"]["reviewRules"]["autoRejectBelow"] == 0.2
    ruled = api.handle("apply_review_rules", {})
    assert ruled["value"]["updated"] >= 1
    assert ruled["state"]["counts"]["pending"] == 0

    backup = api.handle("export_workspace_backup", {"includeGenerated": False})
    backup_value = backup["value"]
    backup_path = Path(backup_value["zipPath"])
    assert backup_path.exists()
    assert backup_value["fileCount"] >= 4
    assert backup_value["bytes"] > 0
    with zipfile.ZipFile(backup_path) as archive:
        names = set(archive.namelist())
        assert "backup-manifest.json" in names
        assert "references.json" in names
        assert "review_candidates.json" in names
        manifest = json.loads(archive.read("backup-manifest.json").decode("utf-8"))
        assert manifest["counts"]["references"] == 1
        assert manifest["counts"]["candidates"] == 1
    verified_backup = api.handle("verify_workspace_backup", {"path": str(backup_path)})
    assert verified_backup["value"]["ok"] is True
    assert verified_backup["value"]["fileCount"] == backup_value["fileCount"]
    latest_verified = api.handle("verify_workspace_backup", {})
    assert latest_verified["value"]["ok"] is True
    restore_target = root / "restored-workspace"
    restored_backup = api.handle("restore_workspace_backup", {"path": str(backup_path), "target": str(restore_target)})
    assert restored_backup["value"]["ok"] is True
    assert restored_backup["value"]["fileCount"] == backup_value["fileCount"]
    assert restored_backup["value"]["stateSummary"]["references"] == 1
    assert (restore_target / "backup-manifest.json").exists()
    assert (restore_target / "references.json").exists()
    expect_raises(ValueError, lambda: api.project.restore_workspace_backup(backup_path, restore_target), "empty")
    expect_raises(ValueError, lambda: api.project.restore_workspace_backup(backup_path, root / "workspace"), "outside")
    second_backup = api.handle("export_workspace_backup", {"includeGenerated": False})
    second_backup_path = Path(second_backup["value"]["zipPath"])
    pruned_backups = api.handle("prune_workspace_backups", {"keep": 1})
    assert pruned_backups["value"]["deleted"] >= 1
    assert pruned_backups["value"]["deletedBytes"] > 0
    assert any(second_backup_path.parent.glob("vintrace-workspace-backup-*.zip"))
    bad_backup = backup_path.parent / "vintrace-workspace-backup-bad.zip"
    bad_backup.write_text("not a zip", encoding="utf-8")
    bad_verified = api.handle("verify_workspace_backup", {"path": str(bad_backup)})
    assert bad_verified["value"]["ok"] is False
    assert bad_verified["value"]["error"]
    malformed_backup = backup_path.parent / "vintrace-workspace-backup-malformed.zip"
    with zipfile.ZipFile(malformed_backup, "w") as archive:
        archive.writestr("backup-manifest.json", json.dumps({"createdAt": "now"}))
        archive.writestr("config.json", "{not json")
        archive.writestr("references.json", "[]")
        archive.writestr("workspace.sqlite3", b"sqlite placeholder")
        archive.writestr("C:/escape.txt", "nope")
    malformed_verified = api.handle("verify_workspace_backup", {"path": str(malformed_backup)})
    assert malformed_verified["value"]["ok"] is False
    assert "config.json" in malformed_verified["value"]["invalidCoreFiles"]
    assert "C:/escape.txt" in malformed_verified["value"]["dangerousEntries"]
    expect_raises(ValueError, lambda: api.project.restore_workspace_backup(malformed_backup, root / "malformed-restore"), "unsafe")

    api.project.db.create_scan_run("old-run-a", "old A", "test", str(root), total=1)
    api.project.db.create_scan_run("old-run-b", "old B", "test", str(root), total=1)
    pruned_manifests = api.handle("prune_scan_manifests", {"keepRuns": 1})
    assert pruned_manifests["value"]["runsDeleted"] >= 1
    assert pruned_manifests["value"]["runsAfter"] == 1

    blocked = api.handle("block_false_match", {"candidateId": candidate_id})
    assert blocked["value"]["blocked"] == 2
    assert blocked["state"]["calibration"]["falseMatchBlocks"] >= 2
    candidate = api.project.candidates[candidate_id]
    assert api.project.db.blocked_pair_exists(candidate.source_hash, candidate.person_name, "different-ref-id")
    reassigned = api.handle("reassign_candidate_person", {"candidateId": candidate_id, "personName": "Other Person"})
    assert reassigned["value"]["personName"] == "Other Person"
    assert reassigned["state"]["candidates"][0]["personName"] == "Other Person"

    self_test = api.handle("runtime_self_test", {})
    check_names = {check["name"] for check in self_test["checks"]}
    assert {"Workspace write", "Recognition engine", "Image decoder", "Workspace health"} <= check_names
    assert self_test["generatedAt"]
    assert self_test["recommendations"]

    audit = api.handle("audit_events", {"limit": 80, "offset": 0})
    actions = {row.get("action") for row in audit["events"]}
    assert {"export_workspace_backup", "verify_workspace_backup", "restore_workspace_backup", "export_report", "export_scan_history", "export_workspace_inventory", "export_audit_log", "export_consent_receipt", "export_safe_mode_audit", "export_review_ledger", "export_support_bundle", "prune_workspace_backups", "prune_scan_manifests", "relink_workspace_paths", "rename_person"} <= actions

    api.project.candidates[candidate_id].created_at = "2000-01-01T00:00:00Z"
    api.project.save()
    purged = api.handle("purge_old_candidates", {"days": 1})
    assert purged["purged"] == 1
    assert purged["state"]["counts"]["candidates"] == 0

    api.project.references["ref_missing"] = ReferenceFace(
        ref_id="ref_missing",
        person_name="Missing Person",
        age_bucket="unknown",
        source_path=str(root / "missing-reference.jpg"),
        capture_date=None,
        quality=0.9,
        model_name="test",
        vector=[1.0] + [0.0] * 511,
    )
    api.project.candidates["cand_missing"] = ReviewCandidate(
        candidate_id="cand_missing",
        source_path=str(root / "missing-candidate.jpg"),
        person_name="Missing Person",
        best_ref_id="ref_missing",
        best_ref_path=str(root / "missing-reference.jpg"),
        score=0.9,
        band="confident",
        quality=0.9,
        model_name="test",
    )
    api.project.save()
    broken_health = api.handle("workspace_health", {})
    assert broken_health["missingReferences"] == 1
    assert broken_health["missingCandidates"] == 1
    assert broken_health["missingReferenceSamples"]
    repair_preview = api.handle("repair_workspace", {"dryRun": True})
    assert repair_preview["value"]["dryRun"] is True
    assert repair_preview["value"]["removedReferences"] == 1
    repaired = api.handle("repair_workspace", {"dryRun": False})
    assert repaired["value"]["removedReferences"] == 1
    assert repaired["value"]["removedCandidates"] == 1
    assert repaired["value"]["after"]["missingReferences"] == 0
    assert repaired["state"]["counts"]["references"] == 1
    assert "ref_missing" not in api.project.references
    assert "cand_missing" not in api.project.candidates

    deleted = api.handle("delete_person", {"personName": "Person Prime"})
    assert deleted["deleted"]["references"] == 1
    assert deleted["state"]["counts"]["references"] == 0
    expect_raises(KeyError, lambda: api.handle("delete_person", {"personName": "Person Prime"}), "Person")


def assert_candidate_risk_lanes_and_reference_counts() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-risk-lanes-"))
    api = make_api(root / "workspace")
    api.project.candidates["cand_close"] = ReviewCandidate(
        candidate_id="cand_close",
        source_path=str(root / "close.jpg"),
        person_name="Ada",
        best_ref_id="ref_a",
        best_ref_path=str(root / "ref-a.jpg"),
        score=0.34,
        band="likely",
        quality=0.9,
        model_name="test",
        note="Another saved person was close; avoid bulk accepting this row.",
        risk_flags=["close-runner-up"],
    )
    api.project.candidates["cand_single"] = ReviewCandidate(
        candidate_id="cand_single",
        source_path=str(root / "single.jpg"),
        person_name="Grace",
        best_ref_id="ref_g",
        best_ref_path=str(root / "ref-g.jpg"),
        score=0.31,
        band="likely",
        quality=0.8,
        model_name="test",
        note="Only one saved photo supported this match; review before bulk actions.",
        risk_flags=[],
    )
    api.project.save()
    close_page = api.handle("query_candidates", {"lane": "closeRunner", "limit": 10})
    assert close_page["total"] == 1
    assert close_page["items"][0]["candidateId"] == "cand_close"
    assert "close-runner-up" in close_page["items"][0]["riskFlags"]
    single_page = api.handle("query_candidates", {"lane": "singleReference", "limit": 10})
    assert single_page["total"] == 1
    assert single_page["items"][0]["candidateId"] == "cand_single"
    assert "single-reference-match" in single_page["items"][0]["riskFlags"]
    state = api.state(preview_create_budget=0)
    insights = state["reviewInsights"]
    assert insights["laneCounts"]["closeRunner"] == 1
    assert insights["laneCounts"]["singleReference"] == 1
    assert insights["closeRunnerUpPending"] == 1
    assert insights["singleReferencePending"] == 1


def assert_candidate_media_actions() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-media-actions-"))
    workspace = root / "workspace"
    media = root / "media"
    api = make_api(workspace)

    def add_candidate(candidate_id: str, source: Path, person: str = "Person") -> None:
        api.project.candidates[candidate_id] = ReviewCandidate(
            candidate_id=candidate_id,
            source_path=str(source),
            person_name=person,
            best_ref_id=None,
            best_ref_path=None,
            score=0.91,
            band="confident",
            quality=0.86,
            model_name="test",
            source_hash=sha256_file(source),
        )

    copy_source = media / "copy-source.jpg"
    copy_source_b = media / "copy-source-b.jpg"
    make_face(copy_source)
    make_face(copy_source_b, shirt=(70, 100, 140))
    add_candidate("cand_copy", copy_source)
    add_candidate("cand_copy_b", copy_source_b)
    api.project.save()
    preview = api.handle("preview_candidate_media_action", {"candidateIds": ["cand_copy", "cand_copy_b"], "action": "copy", "itemLimit": 1})
    assert preview["counts"]["actionable"] == 2
    assert preview["counts"]["totalBytes"] > 0
    assert preview["itemsLimit"] == 1
    assert preview["itemsTotal"] == 2
    assert preview["truncated"] is True
    second_preview = api.handle("preview_candidate_media_action", {"candidateIds": ["cand_copy", "cand_copy_b"], "action": "copy", "itemLimit": 1, "itemOffset": 1})
    assert second_preview["itemsOffset"] == 1
    assert len(second_preview["items"]) == 1
    assert second_preview["items"][0]["candidateId"] == "cand_copy_b"
    progress_events: list[tuple[str, dict[str, object]]] = []
    copied = api.handle(
        "manage_candidate_media",
        {"candidateIds": ["cand_copy", "cand_copy_b"], "action": "copy"},
        progress=lambda payload, name="scan": progress_events.append((name, payload)),
    )
    copied_value = copied["value"]
    assert copied_value["counts"]["copied"] == 2
    assert copied_value["counts"]["verified"] == 2
    assert copied_value["counts"]["verificationFailed"] == 0
    assert copied_value["counts"]["removedCandidates"] == 0
    assert copy_source.exists()
    copied_targets = [Path(item["targetPath"]) for item in copied_value["items"] if item["result"] == "copied"]
    assert len(copied_targets) == 2
    assert all(target.exists() for target in copied_targets)
    assert all(item["verified"] is True for item in copied_value["items"] if item["result"] == "copied")
    assert "cand_copy" in api.project.candidates
    assert any(name == "media_action" for name, _payload in progress_events)
    undone_copy = api.handle("undo_media_action", {"manifestPath": copied_value["manifestPath"]})
    assert undone_copy["value"]["counts"]["removedCopies"] == 2
    assert all(not target.exists() for target in copied_targets)
    assert Path(undone_copy["value"]["undoManifestPath"]).exists()
    assert copy_source.exists()

    move_source = media / "move-source.jpg"
    make_face(move_source, shirt=(10, 120, 110))
    add_candidate("cand_move_a", move_source)
    add_candidate("cand_move_b", move_source)
    api.project.save()
    move_preview = api.handle("preview_candidate_media_action", {"candidateIds": ["cand_move_a"], "action": "move"})
    assert move_preview["counts"]["removedCandidatesEstimate"] == 2
    moved = api.handle("manage_candidate_media", {"candidateIds": ["cand_move_a"], "action": "move"})
    moved_value = moved["value"]
    assert moved_value["counts"]["moved"] == 1
    assert moved_value["counts"]["removedCandidates"] == 2
    assert not move_source.exists()
    assert "cand_move_a" not in api.project.candidates
    assert "cand_move_b" not in api.project.candidates
    assert Path(moved_value["manifestPath"]).exists()
    undone_move = api.handle("undo_media_action", {"manifestPath": moved_value["manifestPath"]})
    assert undone_move["value"]["counts"]["restored"] == 1
    assert move_source.exists()

    trash_source = media / "trash-source.jpg"
    make_face(trash_source, shirt=(130, 60, 110))
    add_candidate("cand_trash", trash_source)
    api.project.save()
    trashed = api.handle("manage_candidate_media", {"candidateIds": ["cand_trash"], "action": "trash"})
    trashed_value = trashed["value"]
    assert trashed_value["counts"]["trashed"] == 1
    assert trashed_value["counts"]["removedCandidates"] == 1
    assert not trash_source.exists()
    assert "media-trash" in trashed_value["destinationPath"]
    assert Path(trashed_value["items"][0]["targetPath"]).exists()
    assert "cand_trash" not in api.project.candidates
    restored = api.handle("restore_media_action", {"manifestPath": trashed_value["manifestPath"]})
    assert restored["value"]["counts"]["restored"] == 1
    assert trash_source.exists()

    cleanup_source = media / "cleanup-trash-source.jpg"
    make_face(cleanup_source, shirt=(90, 40, 160))
    add_candidate("cand_cleanup_trash", cleanup_source)
    api.project.save()
    cleanup_trash = api.handle("manage_candidate_media", {"candidateIds": ["cand_cleanup_trash"], "action": "trash"})
    cleanup_value = cleanup_trash["value"]
    cleanup_target = Path(cleanup_value["items"][0]["targetPath"])
    assert cleanup_target.exists()
    report = api.handle("media_trash_report", {})
    assert report["counts"]["actions"] >= 1
    assert report["counts"]["recoverableFiles"] >= 1
    cleanup_preview = api.handle("cleanup_media_trash", {"days": 0, "dryRun": True})
    assert cleanup_preview["value"]["previewFiles"] >= 1
    assert cleanup_target.exists()
    cleanup_result = api.handle("cleanup_media_trash", {"days": 0, "dryRun": False})
    assert cleanup_result["value"]["deletedFiles"] >= 1
    assert not cleanup_target.exists()

    reference_source = media / "reference-source.jpg"
    make_face(reference_source, shirt=(150, 80, 40))
    api.project.references["ref_guard"] = ReferenceFace(
        ref_id="ref_guard",
        person_name="Guarded",
        age_bucket="adult",
        source_path=str(reference_source),
        capture_date=None,
        quality=0.92,
        model_name="test",
        vector=[1.0] + [0.0] * 511,
    )
    add_candidate("cand_ref_guard", reference_source, person="Guarded")
    api.project.save()
    guarded = api.handle("manage_candidate_media", {"candidateIds": ["cand_ref_guard"], "action": "trash"})
    assert guarded["value"]["counts"]["skipped"] == 1
    assert guarded["value"]["items"][0]["reason"] == "source_is_also_a_saved_person_photo"
    assert reference_source.exists()
    assert "cand_ref_guard" in api.project.candidates
    history = api.handle("media_action_history", {"limit": 10})
    assert history["items"]
    assert any(item["canRestore"] for item in history["items"])
    guarded_history = next(item for item in history["items"] if item["manifestPath"] == guarded["value"]["manifestPath"])
    assert guarded_history["canRetry"] is True
    retried = api.handle("retry_media_action", {"manifestPath": guarded["value"]["manifestPath"]})
    assert retried["value"]["counts"]["skipped"] == 1

    cancel_a = media / "cancel-a.jpg"
    cancel_b = media / "cancel-b.jpg"
    make_face(cancel_a, shirt=(20, 40, 160))
    make_face(cancel_b, shirt=(40, 20, 160))
    add_candidate("cand_cancel_a", cancel_a)
    add_candidate("cand_cancel_b", cancel_b)
    api.project.save()
    cancel_events: list[dict[str, object]] = []

    def cancel_after_first(payload: dict[str, object], name: str = "scan") -> None:
        if name == "media_action":
            cancel_events.append(payload)
            if payload.get("phase") == "processing" and not api.project.media_action_cancel_path.exists():
                api.project.media_action_cancel_path.write_text("cancel", encoding="utf-8")

    cancelled = api.handle(
        "manage_candidate_media",
        {"candidateIds": ["cand_cancel_a", "cand_cancel_b"], "action": "copy"},
        progress=cancel_after_first,
    )
    assert cancelled["value"]["counts"]["cancelled"] is True
    assert cancelled["value"]["counts"]["copied"] == 1
    assert any(event.get("phase") == "cancelled" for event in cancel_events)


def assert_privacy_controls_delete_face_data() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-privacy-"))
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person.jpg")
    make_face(scan / "candidate.jpg")
    api = make_api(root / "workspace")
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person", "folder": str(refs)})["added"] == 1
    scanned = api.handle("scan", {"folder": str(scan), "source": "privacy"})
    assert scanned["state"]["counts"]["candidates"] == 1
    candidate_id = scanned["state"]["candidates"][0]["candidateId"]
    blocked = api.handle("block_false_match", {"candidateId": candidate_id})
    assert blocked["value"]["summary"]["total"] == 2
    before = api.handle("privacy_report", {})
    assert before["references"] == 1
    assert before["candidates"] == 1
    expect_raises(ValueError, lambda: api.handle("delete_face_data", {"confirm": False}), "confirm=true")
    deleted = api.handle("delete_face_data", {"confirm": True})
    assert deleted["value"]["before"]["references"] == 1
    assert deleted["value"]["dbDeleted"]["blocked_pairs"] == 2
    assert deleted["state"]["counts"]["references"] == 0
    assert deleted["state"]["counts"]["candidates"] == 0
    after = api.handle("privacy_report", {})
    assert after["references"] == 0
    assert after["candidates"] == 0
    assert after["embeddingCacheEntries"] == 0


def assert_repair_blocks_likely_disconnected_roots() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-repair-guard-"))
    missing_root = root / "offline-drive"
    api = make_api(root / "workspace")
    for index in range(3):
        ref_id = f"ref_offline_{index}"
        candidate_id = f"cand_offline_{index}"
        api.project.references[ref_id] = ReferenceFace(
            ref_id=ref_id,
            person_name=f"Offline {index}",
            age_bucket="unknown",
            source_path=str(missing_root / f"ref-{index}.jpg"),
            capture_date=None,
            quality=0.9,
            model_name="test",
            vector=[1.0] + [0.0] * 511,
        )
        api.project.candidates[candidate_id] = ReviewCandidate(
            candidate_id=candidate_id,
            source_path=str(missing_root / f"candidate-{index}.jpg"),
            person_name=f"Offline {index}",
            best_ref_id=ref_id,
            best_ref_path=str(missing_root / f"ref-{index}.jpg"),
            score=0.9,
            band="confident",
            quality=0.9,
            model_name="test",
        )
    api.project.save()
    blocked = api.handle("repair_workspace", {"dryRun": False})
    assert blocked["value"]["destructiveBlocked"] is True
    assert blocked["value"]["unavailableRoots"]
    assert len(api.project.references) == 3
    assert len(api.project.candidates) == 3
    forced = api.handle("repair_workspace", {"dryRun": False, "force": True})
    assert forced["value"]["destructiveBlocked"] is False
    assert forced["value"]["removedReferences"] == 3
    assert forced["value"]["removedCandidates"] == 3
    assert len(api.project.references) == 0
    assert len(api.project.candidates) == 0


def assert_relink_blocks_partial_moves() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-relink-guard-"))
    old_root = root / "old"
    new_root = root / "new"
    make_face(old_root / "a.jpg")
    make_face(old_root / "b.jpg")
    make_face(new_root / "a.jpg")
    api = make_api(root / "workspace")
    for name in ("a", "b"):
        api.project.references[f"ref_{name}"] = ReferenceFace(
            ref_id=f"ref_{name}",
            person_name=f"Person {name.upper()}",
            age_bucket="unknown",
            source_path=str(old_root / f"{name}.jpg"),
            capture_date=None,
            quality=0.9,
            model_name="test",
            vector=[1.0] + [0.0] * 511,
        )
    api.project.save()

    blocked = api.handle("relink_workspace_paths", {"oldRoot": str(old_root), "newRoot": str(new_root), "dryRun": False})
    assert blocked["value"]["partialBlocked"] is True
    assert blocked["value"]["missingTargets"]
    assert api.project.references["ref_a"].source_path == str(old_root / "a.jpg")
    assert api.project.references["ref_b"].source_path == str(old_root / "b.jpg")

    forced = api.handle("relink_workspace_paths", {"oldRoot": str(old_root), "newRoot": str(new_root), "dryRun": False, "forcePartial": True})
    assert forced["value"]["partialBlocked"] is False
    assert api.project.references["ref_a"].source_path == str((new_root / "a.jpg").resolve())
    assert api.project.references["ref_b"].source_path == str(old_root / "b.jpg")


def assert_generated_cache_ownership_guards() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-cache-owner-"))
    api = make_api(root / "workspace")
    source = root / "source.tiff"
    Image.new("RGB", (80, 64), (110, 130, 150)).save(source, format="TIFF")

    external_previews = root / "external-previews"
    external_previews.mkdir()
    preview_marker = external_previews / "keep.txt"
    preview_marker.write_text("keep", encoding="utf-8")
    shutil.rmtree(api.project.previews_path, ignore_errors=True)
    try:
        api.project.previews_path.symlink_to(external_previews, target_is_directory=True)
    except OSError:
        api.project.previews_path.mkdir(parents=True, exist_ok=True)
        preview_marker = api.project.previews_path / "keep.txt"
        preview_marker.write_text("keep", encoding="utf-8")

    assert api.project.preview_path_for(str(source), create=True) is None
    assert preview_marker.exists()

    external_frames = root / "external-frames"
    external_frames.mkdir()
    frame_marker = external_frames / "keep.txt"
    frame_marker.write_text("keep", encoding="utf-8")
    shutil.rmtree(api.project.video_frames_path, ignore_errors=True)
    try:
        api.project.video_frames_path.symlink_to(external_frames, target_is_directory=True)
    except OSError:
        api.project.video_frames_path.mkdir(parents=True, exist_ok=True)
        frame_marker = api.project.video_frames_path / "keep.txt"
        frame_marker.write_text("keep", encoding="utf-8")

    optimized = api.handle("optimize_workspace", {})
    skipped = set(optimized["value"].get("skippedUnownedGeneratedDirs", []))
    assert str(api.project.previews_path) in skipped
    assert str(api.project.video_frames_path) in skipped
    assert preview_marker.exists()
    assert frame_marker.exists()

    deleted = api.handle("delete_face_data", {"confirm": True})
    assert deleted["state"]["counts"]["candidates"] == 0
    assert preview_marker.exists()
    assert frame_marker.exists()

    exports_target = root / "external-exports"
    exports_target.mkdir()
    exports = api.project.root / "exports"
    shutil.rmtree(exports, ignore_errors=True)
    try:
        exports.symlink_to(exports_target, target_is_directory=True)
        pruned = api.handle("prune_workspace_backups", {"keep": 1})
        assert pruned["value"]["blocked"] is True
    except OSError:
        pass


def assert_retention_skips_undated_candidates() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-retention-date-"))
    api = make_api(root / "workspace")
    valid_id = "cand_old"
    invalid_id = "cand_undated"
    for candidate_id, created_at in ((valid_id, "2000-01-01T00:00:00Z"), (invalid_id, "not-a-date")):
        api.project.candidates[candidate_id] = ReviewCandidate(
            candidate_id=candidate_id,
            source_path=str(root / f"{candidate_id}.jpg"),
            person_name="Person",
            best_ref_id="ref",
            best_ref_path=str(root / "ref.jpg"),
            score=0.9,
            band="confident",
            quality=0.9,
            model_name="test",
            status="accepted",
            created_at=created_at,
        )
    api.project.save()
    purged = api.handle("purge_old_candidates", {"days": 1, "statuses": ["accepted"]})
    assert purged["purged"] == 1
    assert valid_id not in api.project.candidates
    assert invalid_id in api.project.candidates


def assert_review_and_settings_guards() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-settings-"))
    api = make_api(root / "workspace")
    expect_raises(ValueError, lambda: api.handle("ping", []), "object")
    expect_raises(PermissionError, lambda: api.handle("enroll", {}), "Consent")
    api.handle("set_consent", {"value": True})
    expect_raises(ValueError, lambda: api.handle("save_settings", {"thresholds": "bad"}), "object")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"thresholds": {"confident": 0.1, "likely": 0.5}}), "descending")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"clusterMinSize": 1}), "at least 2")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"clusterMinSize": MAX_CLUSTER_MIN_SIZE + 1}), "or lower")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"thresholds": {"qualityMin": float("nan")}}), "between 0 and 1")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"safeModeThreshold": 2}), "between 0 and 1")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"safeModeThreshold": float("inf")}), "between 0 and 1")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"reviewRules": "bad"}), "object")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"reviewRules": {"autoRejectBelow": 2}}), "between 0 and 1")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"maxMediaFileBytes": -1}), "zero or higher")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"scanExclusions": "bad"}), "object")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"scanExclusions": {"dirNames": "bad"}}), "list")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"faceDetectorSize": 128}), "at least")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"faceDetectorSize": 2048}), "or lower")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"verificationDetectorSize": 128}), "at least")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"verificationDetectorSize": 2048}), "or lower")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"performanceMode": "turbo"}), "Performance mode")
    expect_raises(ValueError, lambda: api.handle("set_performance_mode", {"mode": "turbo"}), "Performance mode")
    tuned = api.handle("save_settings", {"faceDetectorSize": 500, "verificationDetectorSize": 630, "twoPassScan": True})
    assert tuned["config"]["faceDetectorSize"] == 512
    assert tuned["config"]["verificationDetectorSize"] == 640
    assert tuned["config"]["twoPassScan"] is True
    fast = api.handle("set_performance_mode", {"mode": "fast"})
    assert fast["config"]["performanceMode"] == "fast"
    assert fast["config"]["effectivePerformanceMode"] == "fast"
    assert fast["config"]["effectiveFaceDetectorSize"] <= 384
    assert fast["config"]["effectiveTwoPassScan"] is False
    auto = api.handle("set_performance_mode", {"mode": "auto"})
    assert auto["config"]["performanceMode"] == "auto"
    assert auto["config"]["effectivePerformanceMode"] in {"fast", "balanced", "quality"}
    excluded = api.handle("save_settings", {"scanExclusions": {"dirNames": ["skipme"], "pathKeywords": ["private"], "extensions": ["gif"], "filePaths": [str(root / "ignored.jpg")]}})
    assert excluded["config"]["scanExclusions"]["extensions"] == [".gif"]
    assert excluded["config"]["scanExclusions"]["filePaths"] == [str(root / "ignored.jpg")]
    expect_raises(ValueError, lambda: api.handle("set_status", {"candidateId": "missing", "status": "bad"}), "Unsupported")
    expect_raises(KeyError, lambda: api.handle("delete_reference", {"refId": "missing"}), "Reference")
    expect_raises(ValueError, lambda: api.handle("rename_person", {"oldName": "", "newName": "A"}), "required")
    expect_raises(KeyError, lambda: api.handle("rename_person", {"oldName": "Missing", "newName": "A"}), "Person")
    expect_raises(ValueError, lambda: api.handle("purge_old_candidates", {"statuses": ["bad"]}), "Retention")


def assert_vector_store_edges() -> None:
    store = VectorStore()
    assert store.search([1.0] + [0.0] * 511) == []
    expect_raises(ValueError, lambda: store.add("bad", [1.0, 2.0]), "512")
    expect_raises(ValueError, lambda: store.add("nan", [float("nan")] + [0.0] * 511), "finite")
    store.add("a", [1.0] + [0.0] * 511)
    store.add("b", [0.0, 1.0] + [0.0] * 510)
    assert store.search([1.0] + [0.0] * 511, k=0) == []
    expect_raises(ValueError, lambda: store.search([1.0, 2.0]), "512")
    assert store.search([1.0] + [0.0] * 511, k=10)[0].item_id == "a"
    expect_raises(ValueError, lambda: store.rebuild({"bad": [1.0, 2.0]}), "512")
    store.clear()
    assert store.size == 0


def assert_backend_json_rpc_errors() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-rpc-"))
    env = {
        **os.environ,
        "PYTHONPATH": ".",
        "CROSSAGE_FORCE_FALLBACK": "1",
        "CROSSAGE_REGISTRY_HOME": str(root / "registry"),
    }
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "crossage_fr.api_server",
            "--workspace",
            str(root / "workspace"),
        ],
        input="{not json}\n[\"not an object\"]\n{\"id\":6,\"command\":\"ping\",\"params\":[]}\n{\"id\":7,\"command\":\"unknown\",\"params\":{}}\n",
        text=True,
        capture_output=True,
        env=env,
        cwd=Path(__file__).resolve().parents[1],
        timeout=30,
        check=False,
    )
    lines = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    assert any(line.get("event") == "startup" for line in lines)
    ready_index = next(index for index, line in enumerate(lines) if line.get("ready") is True)
    responses = lines[ready_index + 1:]
    assert responses[0]["ok"] is False
    assert responses[0]["error"]["type"] == "JSONDecodeError"
    assert responses[0]["error"]["code"] == "E-BACKEND-UNKNOWN"
    assert responses[1]["ok"] is False
    assert "request must be an object" in responses[1]["error"]["message"]
    assert responses[1]["error"]["code"] == "E-BACKEND-VALIDATION"
    assert responses[2]["id"] == 6
    assert responses[2]["ok"] is False
    assert "parameters must be an object" in responses[2]["error"]["message"]
    assert responses[2]["error"]["code"] == "E-BACKEND-VALIDATION"
    assert responses[3]["id"] == 7
    assert responses[3]["ok"] is False
    assert "Unknown command" in responses[3]["error"]["message"]
    assert responses[3]["error"]["code"] == "E-BACKEND-VALIDATION"


def assert_structured_backend_error_codes() -> None:
    validation = structured_error(ValueError("bad folder"), "scan")
    assert validation["code"] == "E-BACKEND-VALIDATION"
    assert validation["category"] == "input"
    assert validation["severity"] == "warn"
    assert validation["recoverable"] is True
    permission = structured_error(PermissionError("locked"), "scan")
    assert permission["code"] == "E-BACKEND-PERMISSION"
    missing = structured_error(FileNotFoundError("gone"), "scan")
    assert missing["code"] == "E-FS-NOT-FOUND"
    unknown = structured_error(RuntimeError("boom"), "scan")
    assert unknown["code"] == "E-BACKEND-UNKNOWN"
    assert unknown["recoverable"] is False


def assert_release_hardening_diagnostics() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-release-hardening-"))
    api = make_api(root / "workspace")
    database = api.handle("database_integrity", {})
    assert database["ok"] is True
    assert "review_candidates" in database["tableCounts"]

    repair_preview = api.handle("repair_database_integrity", {"confirm": False})
    assert repair_preview["value"]["dryRun"] is True
    assert repair_preview["value"]["before"]["ok"] is True

    storage = api.handle("storage_io_benchmark", {"path": str(root / "workspace"), "sizeMb": 1})
    assert storage["sizeBytes"] == 1024 * 1024
    assert "recommendations" in storage

    distribution = api.handle("model_distribution_audit", {})
    assert distribution["items"]
    assert any(item["kind"] == "face" and item["sha256"] for item in distribution["items"])
    assert any(item["kind"] == "safety" for item in distribution["items"])

    readiness = api.handle("release_readiness", {})
    check_names = {check["name"] for check in readiness["checks"]}
    assert {"Model license manifest", "Database integrity", "Video decoder", "Accuracy validation pack", "Auto-update"} <= check_names

    benchmark = api.handle("runtime_benchmark", {})
    assert "storageIo" in benchmark
    assert benchmark["storageIo"]["sizeBytes"] == 8 * 1024 * 1024
    state = api.state(preview_create_budget=0)
    assert state["buildInfo"]["version"]
    assert state["benchmarkHistory"]
    assert state["benchmarkHistory"][0]["runId"] == benchmark["runId"]


def assert_support_bundle_redaction_is_strict() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-support-redaction-"))
    workspace = root / "workspace"
    private_media = root / "private-media" / "family archive"
    make_face(private_media / "reference-secret.jpg")
    make_face(private_media / "candidate-secret.png")
    api = make_api(workspace)
    api.project.scan_history.append(
        {
            "runId": "scan-private",
            "source": str(private_media),
            "label": "private-media",
            "completedAt": "2026-01-01T00:00:00Z",
            "durationMs": 1,
            "metrics": {"processed": 2, "added": 0, "safeFiltered": 0},
        }
    )
    api.project.save()
    support = api.handle("export_support_bundle", {"includePaths": False})
    support_path = Path(support["value"]["zipPath"])
    with zipfile.ZipFile(support_path) as archive:
        names = archive.namelist()
        forbidden_suffixes = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".onnx", ".npy", ".npz", ".sqlite3")
        assert not any(name.lower().endswith(forbidden_suffixes) for name in names)
        support_text = "\n".join(
            archive.read(name).decode("utf-8")
            for name in names
            if name.endswith(".json")
        )
    assert str(private_media.resolve()) not in support_text
    assert str(workspace.resolve()) not in support_text
    assert str(Path.home()) not in support_text


def assert_audit_chain_is_tamper_evident() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-audit-chain-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    # Generate several audited actions.
    api.handle("set_consent", {"value": True, "operator": "tester", "source": "test"})
    api.handle("clear_queue", {"confirm": True})
    api.handle("set_consent", {"value": False, "operator": "tester", "source": "test"})
    project = api.project
    audit_path = project.audit_path
    assert audit_path.exists(), "audit log should exist after audited actions"
    lines = [json.loads(l) for l in audit_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) >= 3, f"expected >=3 audit rows, got {len(lines)}"
    # Every entry is chained.
    for idx, row in enumerate(lines, start=1):
        assert isinstance(row.get("hash"), str) and row["hash"], f"row {idx} missing hash"
        assert isinstance(row.get("seq"), int), f"row {idx} missing seq"
        assert "prevHash" in row, f"row {idx} missing prevHash"
    seqs = [row["seq"] for row in lines]
    assert seqs == list(range(1, len(lines) + 1)), f"seqs not monotonic from 1: {seqs}"
    assert lines[0]["prevHash"] == "", "genesis prevHash must be empty"
    for prev, cur in zip(lines, lines[1:]):
        assert cur["prevHash"] == prev["hash"], "prevHash must chain to prior hash"
    # Verify command reports a sound chain.
    chain = api.handle("audit_chain_status", {})
    chain = chain.get("value", chain) if isinstance(chain, dict) else chain
    assert chain["verified"] is True, f"chain should verify clean: {chain}"
    assert chain["chained"] == len(lines), f"chained count mismatch: {chain}"
    assert chain["tail"] == lines[-1]["hash"], "tail must be last hash"
    # Tamper a middle line -> chain must fail at the right index.
    target = 1
    raw_lines = audit_path.read_text(encoding="utf-8").splitlines()
    mutated = dict(lines[target])
    mutated["action"] = str(mutated.get("action", "")) + "_TAMPERED"
    raw_lines[target] = json.dumps(mutated)
    audit_path.write_text("\n".join(raw_lines) + "\n", encoding="utf-8")
    chain2 = api.handle("audit_chain_status", {})
    chain2 = chain2.get("value", chain2) if isinstance(chain2, dict) else chain2
    assert chain2["verified"] is False, "tampered chain must fail verification"
    assert chain2["firstBreak"] is not None, "tampered chain must report a break"
    assert chain2["firstBreak"]["index"] == target + 1, f"break at wrong index: {chain2['firstBreak']}"
    # Legacy (unchained) entries are tolerated, chained portion still verifies.
    legacy = json.dumps({"at": "2020-01-01T00:00:00Z", "action": "legacy_event"})
    audit_path.write_text(
        legacy + "\n" + "\n".join(json.dumps(r) for r in lines) + "\n", encoding="utf-8"
    )
    chain3 = api.handle("audit_chain_status", {})
    chain3 = chain3.get("value", chain3) if isinstance(chain3, dict) else chain3
    assert chain3["legacy"] == 1, f"expected 1 legacy entry: {chain3}"
    assert chain3["chained"] == len(lines), f"chained count mismatch with legacy: {chain3}"
    assert chain3["verified"] is True, f"legacy-prefixed chain should verify: {chain3}"
    shutil.rmtree(root, ignore_errors=True)
    print("  audit chain tamper-evidence ok")


def assert_candidate_carries_capture_dates() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-capture-date-"))
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_a.jpg")
    make_face(scan / "candidate_a.jpg", shirt=(92, 116, 88))
    api = make_api(workspace)
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person A", "ageBucket": "adult", "folder": str(refs)})["added"] >= 1
    scanned = api.handle("scan", {"folder": str(scan), "source": "capture-date-test"})
    candidates = scanned["state"]["candidates"]
    assert candidates, "expected at least one candidate"
    matched = [c for c in candidates if c.get("bestRefId")]
    assert matched, f"expected a matched candidate, bands={[c.get('band') for c in candidates]}"
    cand = matched[0]
    assert cand.get("captureDate"), f"candidate missing captureDate: {cand}"
    assert cand.get("referenceCaptureDate"), f"candidate missing referenceCaptureDate: {cand}"
    # Capture dates must survive a workspace reload (round-trip through persistence).
    reopened = make_api(workspace)
    reloaded = reopened.state()["candidates"]
    rematched = [c for c in reloaded if c.get("candidateId") == cand["candidateId"]]
    assert rematched, "candidate should persist across reload"
    assert rematched[0].get("captureDate"), f"captureDate lost on reload: {rematched[0]}"
    assert rematched[0].get("referenceCaptureDate"), f"referenceCaptureDate lost on reload: {rematched[0]}"
    shutil.rmtree(root, ignore_errors=True)
    print("  candidate capture dates ok")


def assert_candidate_age_gap_is_surfaced() -> None:
    import datetime as _dt

    root = Path(tempfile.mkdtemp(prefix="crossage-age-gap-"))
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_a.jpg")
    make_face(scan / "candidate_a.jpg", shirt=(92, 116, 88))
    # Age the reference photo ~12 years so a real wide cross-age gap exists.
    old = _dt.datetime(2014, 1, 1).timestamp()
    os.utime(refs / "person_a.jpg", (old, old))
    api = make_api(workspace)
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person A", "ageBucket": "adult", "folder": str(refs)})["added"] >= 1
    scanned = api.handle("scan", {"folder": str(scan), "source": "age-gap-test"})
    matched = [c for c in scanned["state"]["candidates"] if c.get("bestRefId")]
    assert matched, "expected a matched candidate"
    cand = matched[0]
    assert cand.get("ageGapYears") is not None, f"missing ageGapYears: {cand}"
    assert cand["ageGapYears"] >= 6, f"expected a wide gap, got {cand['ageGapYears']}"
    assert cand.get("ageGapConfidence") == "very-low", f"expected very-low: {cand.get('ageGapConfidence')}"
    # The cross-age-gap review flag is carried on the candidate (surfaced in the detailed view).
    proj_cand = api.project.candidates[cand["candidateId"]]
    assert "cross-age-gap" in proj_cand.risk_flags, f"missing cross-age-gap flag: {proj_cand.risk_flags}"
    detailed = api.handle("query_candidates", {"status": "pending", "limit": 50})
    detailed_rows = detailed.get("items", [])
    match = [c for c in detailed_rows if c.get("candidateId") == cand["candidateId"]]
    assert match, "candidate should appear in query_candidates"
    assert "cross-age-gap" in (match[0].get("riskFlags") or []), "detailed view should expose the flag"
    assert match[0].get("ageGapConfidence") == "very-low", "detailed view should expose age-gap confidence"
    shutil.rmtree(root, ignore_errors=True)
    print("  candidate age-gap surfacing ok")


def assert_safe_mode_zero_admittance() -> None:
    from crossage_fr.enroll import ProjectState as _PS

    good_bbox = [(40, 40, 240, 240)]  # centered, ~51% coverage in a 280x280 image
    # Normal carve-out: benign centered face with a low NSFW score is admitted.
    assert _PS._face_crop_admittable(0.10, 0.58, 280, 280, good_bbox, False) is True
    # Zero-admittance disables the carve-out entirely, even for a perfect centered face.
    assert _PS._face_crop_admittable(0.10, 0.58, 280, 280, good_bbox, True) is False
    # A high NSFW score is never admitted regardless of geometry.
    assert _PS._face_crop_admittable(0.90, 0.58, 280, 280, good_bbox, False) is False
    # The flag round-trips through save_settings + reload and surfaces in state config.
    root = Path(tempfile.mkdtemp(prefix="crossage-zero-admit-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    assert api.state()["config"].get("safeModeZeroAdmittance") is False
    api.handle("save_settings", {"safeMode": True, "safeModeZeroAdmittance": True})
    reopened = make_api(workspace)
    assert reopened.project.config.safe_mode_zero_admittance is True, "flag should persist across reload"
    assert reopened.state()["config"].get("safeModeZeroAdmittance") is True
    audit = reopened.handle("export_safe_mode_audit", {})
    audit_value = audit.get("value", audit)
    import json as _json
    policy = _json.loads(Path(audit_value["jsonPath"]).read_text(encoding="utf-8"))["policy"]
    assert policy["safeModeZeroAdmittance"] is True
    assert policy["faceCropCarveOutActive"] is False
    shutil.rmtree(root, ignore_errors=True)
    print("  safe mode zero-admittance ok")


def assert_per_subject_consent() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-subject-consent-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    # Workspace-level consent unchanged by default.
    api.handle("set_consent", {"value": True})
    assert api.project.consent_on_file() is True
    # A per-subject grant must NOT flip workspace-level consent, and is preserved.
    api.handle("set_consent", {"value": True, "personName": "Alice", "lawfulBasis": "guardian"})
    assert api.project.consent_on_file() is True, "workspace consent must be preserved"
    assert api.consent_on_file is True, "api workspace flag must be preserved on subject grant"
    subjects = api.project.subject_consents()
    assert subjects.get("alice", {}).get("active") is True
    assert subjects["alice"]["lawfulBasis"] == "guardian"
    # Subjects survive a workspace-level consent toggle.
    api.handle("set_consent", {"value": False})
    api.handle("set_consent", {"value": True})
    assert api.project.subject_consents().get("alice", {}).get("active") is True, "subjects preserved across toggle"
    # Receipt exposes the per-subject breakdown.
    receipt = api.handle("export_consent_receipt", {})
    rv = receipt.get("value", receipt)
    import json as _json
    payload = _json.loads(Path(rv["jsonPath"]).read_text(encoding="utf-8"))
    rsubjects = payload["consent"].get("subjects") or {}
    assert any(s.get("personName") == "Alice" for s in rsubjects.values()), f"receipt missing subject: {rsubjects}"
    # With the flag ON, enrolling an unconsented subject is blocked; a consented one is allowed.
    api.handle("save_settings", {"perSubjectConsent": True})
    bobrefs = root / "bobrefs"
    make_face(bobrefs / "bob.jpg")
    try:
        api.handle("enroll", {"personName": "Bob", "ageBucket": "adult", "folder": str(bobrefs)})
        raise AssertionError("enroll should be blocked without per-subject consent")
    except PermissionError:
        pass
    alicerefs = root / "alicerefs"
    make_face(alicerefs / "alice.jpg")
    res = api.handle("enroll", {"personName": "Alice", "ageBucket": "adult", "folder": str(alicerefs)})
    assert res["added"] >= 1, "Alice enroll should be allowed with per-subject consent"
    # Backward compat: a v1 consent.json (no subjects) still loads.
    (workspace / "consent.json").write_text(
        _json.dumps({"schemaVersion": 1, "active": True, "confirmedAt": "2020-01-01T00:00:00Z"}),
        encoding="utf-8",
    )
    reopened = make_api(workspace)
    assert reopened.project.consent_on_file() is True
    assert reopened.project.subject_consents() == {}
    shutil.rmtree(root, ignore_errors=True)
    print("  per-subject consent ok")


def assert_jurisdiction_presets() -> None:
    from crossage_fr.compliance.jurisdictions import jurisdiction_preset, list_jurisdictions

    ids = {j["id"] for j in list_jurisdictions()}
    assert {"standard", "gdpr", "bipa-il", "ccpa-cpra", "colorado"} <= ids, ids
    assert jurisdiction_preset("does-not-exist") is None
    root = Path(tempfile.mkdtemp(prefix="crossage-jurisdiction-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    assert api.state()["config"]["jurisdictionPreset"] == "standard"
    gdpr = jurisdiction_preset("gdpr")
    res = api.handle("set_jurisdiction_preset", {"preset": "gdpr"})
    assert res["value"]["preset"] == "gdpr"
    cfg = api.state()["config"]
    assert cfg["jurisdictionPreset"] == "gdpr"
    assert cfg["retentionReviewedDays"] == gdpr["retentionReviewedDays"]
    assert api.project.config.per_subject_consent is True, "gdpr preset should enable per-subject consent"
    # The retention report reflects the configured window.
    report = api.handle("retention_policy_report", {})
    report = report.get("value", report) if isinstance(report, dict) else report
    assert report["policy"]["recommendedReviewedRetentionDays"] == gdpr["retentionReviewedDays"]
    assert report["policy"]["jurisdictionPreset"] == "gdpr"
    # Unknown preset is rejected.
    try:
        api.handle("set_jurisdiction_preset", {"preset": "atlantis"})
        raise AssertionError("unknown preset should raise")
    except ValueError:
        pass
    # Persists across reload.
    reopened = make_api(workspace)
    assert reopened.project.config.jurisdiction_preset == "gdpr"
    assert reopened.project.config.retention_reviewed_days == gdpr["retentionReviewedDays"]
    shutil.rmtree(root, ignore_errors=True)
    print("  jurisdiction presets ok")


def assert_compliance_pack() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-compliance-pack-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    api.handle("set_consent", {"value": True, "operator": "tester"})
    api.handle("set_jurisdiction_preset", {"preset": "gdpr"})
    result = api.handle("export_compliance_pack", {})
    value = result.get("value", result)
    pack_path = Path(value["zipPath"])
    assert pack_path.exists(), "compliance pack zip should exist"
    with zipfile.ZipFile(pack_path) as archive:
        names = set(archive.namelist())
        required = {
            "00-manifest.json",
            "consent-summary.json",
            "audit-chain-status.json",
            "retention-policy.json",
            "model-distribution-audit.json",
            "policy.json",
            "DPIA-DRAFT.md",
            "FRIA-DRAFT.md",
            "annex-iv-technical-documentation-DRAFT.md",
            "README.md",
        }
        assert required <= names, f"missing members: {required - names}"
        # No biometric/media artifacts leak into the pack.
        forbidden = (".jpg", ".jpeg", ".png", ".webp", ".onnx", ".npy", ".sqlite3", ".mp4")
        assert not any(n.lower().endswith(forbidden) for n in names), names
        # Every generated legal draft carries the DRAFT / not-certification disclaimer.
        for doc in ("DPIA-DRAFT.md", "FRIA-DRAFT.md", "annex-iv-technical-documentation-DRAFT.md"):
            text = archive.read(doc).decode("utf-8")
            assert "DRAFT" in text and "NOT legal advice" in text, f"{doc} missing disclaimer"
        # The retention window reflects the applied jurisdiction.
        retention = json.loads(archive.read("retention-policy.json").decode("utf-8"))
        assert retention["policy"]["recommendedReviewedRetentionDays"] == 30, retention["policy"]
    shutil.rmtree(root, ignore_errors=True)
    print("  compliance pack ok")


def assert_multi_workspace_registry() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-multi-ws-"))
    ws_a = root / "workspace-a"
    ws_b = root / "workspace-b"
    api_a = make_api(ws_a)
    listed = api_a.handle("list_workspaces", {})
    paths = {w["path"] for w in listed["workspaces"]}
    assert str(ws_a.resolve()) in paths, f"workspace A should be listed: {paths}"
    assert any(w["active"] for w in listed["workspaces"] if w["path"] == str(ws_a.resolve()))
    # Opening a second workspace registers it and switches active.
    api_b = make_api(ws_b)
    listed_b = api_b.handle("list_workspaces", {})
    paths_b = {w["path"] for w in listed_b["workspaces"]}
    assert {str(ws_a.resolve()), str(ws_b.resolve())} <= paths_b, f"both workspaces listed: {paths_b}"
    active_b = [w for w in listed_b["workspaces"] if w["active"]]
    assert active_b and active_b[0]["path"] == str(ws_b.resolve()), "B should be active after opening it"
    # Switching back via set_workspace re-activates A and keeps both listed.
    api_b.handle("set_workspace", {"path": str(ws_a)})
    listed_again = api_b.handle("list_workspaces", {})
    assert len({w["path"] for w in listed_again["workspaces"]}) >= 2
    active_again = [w for w in listed_again["workspaces"] if w["active"]]
    assert active_again and active_again[0]["path"] == str(ws_a.resolve()), "A should be active again"
    # add_workspace registers a third workspace without switching.
    ws_c = root / "workspace-c"
    res = api_b.handle("add_workspace", {"path": str(ws_c)})
    assert str(ws_c.resolve()) in {w["path"] for w in res["workspaces"]}
    still_active = [w for w in res["workspaces"] if w["active"]]
    assert still_active and still_active[0]["path"] == str(ws_a.resolve()), "add_workspace must not switch active"
    shutil.rmtree(root, ignore_errors=True)
    print("  multi-workspace registry ok")


def main() -> None:
    assert_corrupt_workspace_recovery()
    assert_corrupt_sqlite_startup_recovery()
    assert_config_round_trip_and_invalid_shape()
    assert_invalid_project_rows_are_skipped()
    assert_command_validation_and_empty_inputs()
    assert_consent_workspace_registry_and_audit_pagination()
    assert_broken_and_sensitive_images_do_not_pollute_queue()
    assert_image_decompression_guard()
    assert_static_app_contracts()
    assert_model_downloader_integrity_and_safe_extract()
    assert_corrupt_installed_models_fail_integrity()
    assert_unmatched_clustering_flushes_in_batches()
    assert_embedding_cache_reuses_face_work()
    assert_model_spaces_are_isolated_for_matching()
    assert_api_scan_requires_backfill_for_mixed_model_spaces()
    assert_reference_backfill_creates_active_model_embeddings()
    assert_pose_bucket_tracking_and_cache_hits()
    assert_profile_pose_uses_review_threshold_without_accepting_frontal_noise()
    assert_match_scoring_flags_close_single_reference_decisions()
    assert_duplicate_content_is_suppressed_across_paths()
    assert_scan_candidates_survive_without_json_snapshot()
    assert_large_store_dedupe_uses_sqlite_lookup()
    assert_heuristic_fallback_safety_is_not_cached()
    assert_hashing_can_be_cancelled()
    assert_external_drive_discovery_edges()
    assert_mutating_file_is_deferred()
    assert_scan_exclusions_are_honored()
    assert_scan_folder_reports_discovery_errors()
    assert_video_frame_orphans_are_pruned()
    assert_video_decoder_fallback_metadata()
    assert_synthetic_video_decoder_suite()
    assert_accuracy_validation_pack()
    assert_scan_cancel_and_resume_manifest()
    assert_vector_store_persists_reference_index()
    assert_stale_candidate_manifest_is_reprocessed()
    assert_model_governance_metadata()
    assert_package_artifact_checker()
    assert_operational_use_case_commands()
    assert_candidate_risk_lanes_and_reference_counts()
    assert_candidate_media_actions()
    assert_privacy_controls_delete_face_data()
    assert_repair_blocks_likely_disconnected_roots()
    assert_relink_blocks_partial_moves()
    assert_generated_cache_ownership_guards()
    assert_retention_skips_undated_candidates()
    assert_review_and_settings_guards()
    assert_vector_store_edges()
    assert_backend_json_rpc_errors()
    assert_structured_backend_error_codes()
    assert_release_hardening_diagnostics()
    assert_support_bundle_redaction_is_strict()
    assert_audit_chain_is_tamper_evident()
    assert_candidate_carries_capture_dates()
    assert_candidate_age_gap_is_surfaced()
    assert_safe_mode_zero_admittance()
    assert_per_subject_consent()
    assert_jurisdiction_presets()
    assert_compliance_pack()
    assert_multi_workspace_registry()
    print("edge cases ok")


if __name__ == "__main__":
    main()
