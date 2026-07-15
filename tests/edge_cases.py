from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile
import hashlib
import math
from pathlib import Path

from PIL import ExifTags, Image, ImageDraw

import crossage_fr.api_server as api_server_module
from crossage_fr.api_server import DesktopApi, structured_error
from crossage_fr.config import MAX_CLUSTER_MIN_SIZE, RuntimeConfig, Thresholds, load_config, save_config
from crossage_fr.enroll import manager as manager_module
from crossage_fr.enroll import ProjectState
from crossage_fr.enroll.synthetic_screen import SyntheticScreenResult
from crossage_fr.ingest import safety as safety_module
from crossage_fr.ingest.image_io import ImageLoadError, capture_date_with_provenance, load_image, sha256_file
from crossage_fr.ingest.safety import SafetyAssessment
from crossage_fr.ingest.video_io import VideoFrameSample, probe_video, sample_video_frames, video_decoder_report
from crossage_fr.match.scoring import group_hits
from crossage_fr.model_manager import MODEL_PACKAGES, ModelPackageSpec, download_model_pack, model_governance, model_status
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate
from crossage_fr.store import SearchHit, VectorStore
from crossage_fr.store.workspace_db import WorkspaceDb, path_signature

_EDGE_REGISTRY = str(Path(tempfile.mkdtemp(prefix="crossage-edge-registry-")) / "registry")
os.environ["VINTRACE_REGISTRY_HOME"] = _EDGE_REGISTRY
os.environ["CROSSAGE_REGISTRY_HOME"] = _EDGE_REGISTRY


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
    registry = str(root.parent / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
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
    bad_path.write_text("{not json", encoding="utf-8")
    recovered = load_config(bad_path)
    assert recovered.safe_mode is True
    assert (root / "bad-config.corrupt.json").exists()
    assert (root / "bad-config.corrupt.json").read_text(encoding="utf-8") == "{not json"
    bad_path.write_text("{still not json", encoding="utf-8")
    recovered = load_config(bad_path)
    assert recovered.safe_mode is True
    corrupt_archives = sorted(root.glob("bad-config.corrupt*.json"))
    assert len(corrupt_archives) == 2
    assert (root / "bad-config.corrupt.json").read_text(encoding="utf-8") == "{not json"
    assert any(path.name.startswith("bad-config.corrupt-") for path in corrupt_archives)

    unsafe_path = root / "unsafe-config.json"
    unsafe_path.write_text(json.dumps({"safe_mode": False, "cluster_min_size": 1, "unknown_future_field": "kept-out"}), encoding="utf-8")
    recovered = load_config(unsafe_path)
    assert recovered.safe_mode is False
    assert recovered.cluster_min_size == 2
    assert not (root / "unsafe-config.corrupt.json").exists()

    threshold_path = root / "threshold-config.json"
    threshold_path.write_text(json.dumps({
        "safe_mode": False,
        "thresholds": {
            "confident": 0.72,
            "likely": "bad",
            "relaxed_child": 0.24,
            "quality_min": 0.11,
        },
    }), encoding="utf-8")
    recovered = load_config(threshold_path)
    assert recovered.safe_mode is False
    assert recovered.thresholds.confident == 0.72
    assert recovered.thresholds.likely == Thresholds().likely
    assert recovered.thresholds.relaxed_child == 0.24
    assert recovered.thresholds.quality_min == 0.11
    assert not (root / "threshold-config.corrupt.json").exists()

    oversized_path = root / "oversized-config.json"
    oversized_path.write_text(json.dumps({"safe_mode": False, "cluster_min_size": MAX_CLUSTER_MIN_SIZE + 1}), encoding="utf-8")
    recovered = load_config(oversized_path)
    assert recovered.safe_mode is False
    assert recovered.cluster_min_size == 2
    assert not (root / "oversized-config.corrupt.json").exists()

    transient_path = root / "transient-config.json"
    transient_path.write_text(json.dumps({"safe_mode": False}), encoding="utf-8")
    original_read_text = Path.read_text

    def fail_transient_read(self: Path, *args, **kwargs):
        if self == transient_path:
            raise OSError("temporary read failure")
        return original_read_text(self, *args, **kwargs)

    try:
        Path.read_text = fail_transient_read
        recovered = load_config(transient_path)
    finally:
        Path.read_text = original_read_text
    assert recovered.safe_mode is True
    assert transient_path.exists()
    assert not (root / "transient-config.corrupt.json").exists()

    workspace = root / "workspace"
    project_config_path = workspace / "config.json"
    save_config(RuntimeConfig(safe_mode=False, cluster_min_size=5), project_config_path)
    project = ProjectState(workspace)
    external = RuntimeConfig(safe_mode=True, cluster_min_size=7, retention_reviewed_days=123)
    save_config(external, project_config_path)

    original_read_text = Path.read_text

    def fail_project_config_read(self: Path, *args, **kwargs):
        if self == project_config_path:
            raise OSError("temporary read failure")
        return original_read_text(self, *args, **kwargs)

    try:
        Path.read_text = fail_project_config_read
        project.consent["note"] = "save still writes non-config state"
        project.save()
    finally:
        Path.read_text = original_read_text
    preserved = load_config(project_config_path)
    assert preserved.safe_mode is True
    assert preserved.cluster_min_size == 7
    assert preserved.retention_reviewed_days == 123
    assert json.loads((workspace / "consent.json").read_text(encoding="utf-8"))["note"] == "save still writes non-config state"


def assert_safe_mode_override_schema_migrates_and_private_delete_clears() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-safe-mode-overrides-"))
    db_path = root / "workspace.sqlite3"
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE photo_assets (
                asset_id TEXT PRIMARY KEY,
                source_path TEXT NOT NULL,
                content_hash TEXT NOT NULL DEFAULT '',
                added_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO photo_assets(asset_id, source_path, content_hash, added_at, updated_at) VALUES(?, ?, ?, ?, ?)",
            ("legacy-asset-id", str(root / "legacy.jpg"), "legacy-content-hash", "2026-07-07T00:00:00Z", "2026-07-07T00:00:00Z"),
        )
        conn.execute(
            """
            CREATE TABLE safe_mode_overrides (
                asset_id TEXT PRIMARY KEY,
                override_sensitive INTEGER NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO safe_mode_overrides(asset_id, override_sensitive, reason, created_at) VALUES(?, ?, ?, ?)",
            ("legacy-asset-id", 1, "legacy", "2026-07-07T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO safe_mode_overrides(asset_id, override_sensitive, reason, created_at) VALUES(?, ?, ?, ?)",
            ("missing-legacy-asset-id", 0, "unmapped", "2026-07-07T00:00:01Z"),
        )
        conn.commit()
    finally:
        conn.close()
    db = WorkspaceDb(db_path)
    with db.connect() as db_conn:
        columns = {str(row["name"]) for row in db_conn.execute("PRAGMA table_info(safe_mode_overrides)").fetchall()}
        assert "content_hash" in columns
        assert "asset_id" not in columns
        rows = db_conn.execute("SELECT content_hash, override_sensitive, reason FROM safe_mode_overrides").fetchall()
        assert [(str(row["content_hash"]), int(row["override_sensitive"]), str(row["reason"])) for row in rows] == [
            ("legacy-content-hash", 1, "legacy")
        ]
    assert db.safe_mode_override_for("legacy-content-hash") is True
    assert db.safe_mode_override_for("missing-legacy-asset-id") is None
    db.set_safe_mode_override("private-safe-mode-hash", True, reason="operator-confirmed-sensitive")
    event_asset_id = db._photo_asset_id(str(root / "viewed.jpg"))
    with db.connect() as db_conn:
        db_conn.execute(
            """
            INSERT INTO photo_assets(asset_id, source_path, added_at, updated_at)
            VALUES(?, ?, ?, ?)
            """,
            (event_asset_id, str(root / "viewed.jpg"), "2026-07-07T00:00:00Z", "2026-07-07T00:00:00Z"),
        )
        db_conn.execute(
            """
            INSERT INTO photo_asset_events(event_id, asset_id, event_type, event_at, actor, metadata_json)
            VALUES(?, ?, ?, ?, ?, ?)
            """,
            ("evt-private-viewed", event_asset_id, "viewed", "2026-07-07T00:01:00Z", "test", '{"surface":"lightbox"}'),
        )
    deleted = db.clear_private_data()
    assert deleted["safe_mode_overrides"] == 2
    assert deleted["photo_asset_events"] == 1
    assert db.safe_mode_override_for("legacy-content-hash") is None
    assert db.safe_mode_override_for("private-safe-mode-hash") is None
    with db.connect() as db_conn:
        event_count = int(db_conn.execute("SELECT COUNT(*) AS n FROM photo_asset_events").fetchone()["n"])
        asset_count = int(db_conn.execute("SELECT COUNT(*) AS n FROM photo_assets").fetchone()["n"])
    assert event_count == 0
    assert asset_count == 2


def assert_safe_mode_flagged_list_is_paged_and_preview_budgeted() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-safe-review-budget-"))
    api = make_api(root / "workspace")
    captured: dict[str, int] = {}

    def fake_list_safe_mode_flagged(limit: int = 200, offset: int = 0):
        captured["limit"] = limit
        captured["offset"] = offset
        return {
            "total": 3,
            "items": [
                {"assetId": "a1", "sourcePath": str(root / "one.jpg"), "storedSensitive": True, "override": None, "effectiveSensitive": True, "score": 0.9, "reason": "", "modelName": "test"},
                {"assetId": "a2", "sourcePath": str(root / "two.jpg"), "storedSensitive": True, "override": None, "effectiveSensitive": True, "score": 0.8, "reason": "", "modelName": "test"},
                {"assetId": "a3", "sourcePath": str(root / "three.jpg"), "storedSensitive": True, "override": None, "effectiveSensitive": True, "score": 0.7, "reason": "", "modelName": "test"},
            ],
        }

    preview_create_flags: list[bool] = []

    def fake_preview_path_for(path: str, create: bool = False):
        preview_create_flags.append(bool(create))
        return f"/preview/{Path(path).name}" if create else ""

    api.project.db.list_safe_mode_flagged = fake_list_safe_mode_flagged  # type: ignore[method-assign]
    api.project.preview_path_for = fake_preview_path_for  # type: ignore[method-assign]
    result = api._cmd_list_safe_mode_flagged({"limit": 500, "offset": -10, "previewBudget": 1})
    assert captured == {"limit": 100, "offset": 0}
    assert preview_create_flags == [True, False, False]
    assert result["items"][0]["previewPath"].endswith("one.jpg")
    assert result["items"][1]["previewPath"] == ""


def assert_safe_mode_calibration_caps_examples_and_forwards_progress() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-safe-calibration-progress-"))
    api = make_api(root / "workspace")
    original_calibrate = safety_module.calibrate_safety_temperature
    original_iter_image_paths = api_server_module.iter_image_paths
    captured: dict[str, int] = {}
    progress_events: list[dict[str, object]] = []

    def fake_calibrate(labeled, progress=None):
        rows = list(labeled)
        captured["count"] = len(rows)
        if progress:
            progress({"phase": "started", "total": len(rows), "processed": 0})
            progress({"phase": "complete", "total": len(rows), "processed": len(rows), "ok": False})
        return {
            "ok": False,
            "temperature": 1.0,
            "sampleCount": len(rows),
            "positives": 0,
            "negatives": len(rows),
            "reason": "test",
        }

    examples = [{"path": f"/tmp/calibration-{index}.jpg", "sensitive": False} for index in range(4005)]
    safety_module.calibrate_safety_temperature = fake_calibrate
    try:
        queued = api._cmd_calibrate_safe_mode({"examples": examples}, progress=progress_events.append)
        assert queued["queued"] is True
        assert captured == {}
        assert progress_events == []
        result = api._cmd_calibrate_safe_mode({"examples": examples, "runInline": True}, progress=progress_events.append)
    finally:
        safety_module.calibrate_safety_temperature = original_calibrate
    assert result["sampleCount"] == 4000
    assert captured == {"count": 4000}
    assert [event["phase"] for event in progress_events] == ["started", "complete"]
    assert all(event["source"] == "safe_mode_calibration" for event in progress_events)

    balanced: dict[str, int] = {}

    def fake_balanced_calibrate(labeled, progress=None):
        rows = list(labeled)
        positives = sum(1 for _path, sensitive in rows if sensitive)
        negatives = len(rows) - positives
        balanced.update({"count": len(rows), "positives": positives, "negatives": negatives})
        return {
            "ok": False,
            "temperature": 1.0,
            "sampleCount": len(rows),
            "positives": positives,
            "negatives": negatives,
            "reason": "test",
        }

    def fake_iter_image_paths(folder: Path, recursive: bool = True):
        count = 5000 if folder.name == "sensitive" else 3
        for index in range(count):
            yield folder / f"calibration-{index}.jpg"

    safety_module.calibrate_safety_temperature = fake_balanced_calibrate
    api_server_module.iter_image_paths = fake_iter_image_paths
    try:
        result = api._cmd_calibrate_safe_mode(
            {
                "folders": [
                    {"path": "/tmp/sensitive", "sensitive": True},
                    {"path": "/tmp/safe", "sensitive": False},
                ],
                "runInline": True,
            }
        )
    finally:
        safety_module.calibrate_safety_temperature = original_calibrate
        api_server_module.iter_image_paths = original_iter_image_paths
    assert result["sampleCount"] == 4000
    assert balanced == {"count": 4000, "positives": 3997, "negatives": 3}


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
    other_person = api.handle("enroll", {"personName": "Other Person", "ageBucket": "adult", "folder": str(refs)})
    assert other_person["added"] == 1

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
    assert missing["state"]["scanJob"]["canResume"] is False
    assert "still exists and is readable" in missing["state"]["scanJob"]["recommendedAction"]


def assert_consent_workspace_registry_and_audit_pagination() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-registry-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    state = api.state()
    assert state["workspaceMetadata"]["workspaceId"]
    workspace_id = state["workspaceMetadata"]["workspaceId"]
    assert state["consentOnFile"] is False
    assert state["consent"]["scope"] == workspace_id
    assert (workspace / ".vintrace-workspace.json").exists()
    assert (root / "registry" / "active-workspace.json").exists()

    api.handle("set_consent", {"value": True, "operator": "Edge", "note": "durable consent", "source": "test"})
    reopened = make_api(workspace)
    reopened_state = reopened.state()
    assert reopened_state["consentOnFile"] is True
    assert reopened_state["consent"]["operator"] == "Edge"
    assert reopened_state["consent"]["scope"] == workspace_id
    assert (workspace / "consent.json").exists()
    consent_json = json.loads((workspace / "consent.json").read_text(encoding="utf-8"))
    assert consent_json["scope"] == workspace_id
    receipt = reopened.handle("export_consent_receipt", {})["value"]
    receipt_json = json.loads(Path(receipt["jsonPath"]).read_text(encoding="utf-8"))
    assert receipt_json["consent"]["scope"] == workspace_id

    reopened.handle("clear_queue", {})
    audit = reopened.handle("audit_events", {"limit": 5, "offset": 0})
    assert audit["total"] >= 3
    assert audit["events"][0]["action"] == "clear_candidates"
    consent_event = next(event for event in audit["events"] if event.get("action") == "set_consent")
    assert consent_event["scope"] == workspace_id


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
    assert "buildContentSecurityPolicy" in desktop_main
    util_cjs = (root / "desktop" / "main" / "util.cjs").read_text(encoding="utf-8")
    assert "function safeRealpath" in util_cjs
    assert "function buildContentSecurityPolicy" in util_cjs
    assert "`img-src 'self' ${mediaScheme}: data: blob:`" in util_cjs
    assert "`media-src 'self' ${mediaScheme}: blob:`" in util_cjs
    assert "\"object-src 'none'\"" in util_cjs
    assert "previewsReal" in desktop_main
    # EIPC/TOCTOU: the media handler resolves the request to a single canonical
    # real path and fetches THAT path (not the original), so a symlink swapped
    # between the trust check and the fetch cannot escape the trust boundary.
    assert "function resolveTrustedMediaPath" in desktop_main
    assert "await resolveTrustedMediaPath(target)" in desktop_main
    assert "trustedMediaPathCache" in desktop_main
    assert "buildTrustedMediaPathSet(state, queryTrustedMediaPaths)" in desktop_main
    assert "paths.has(pathTrustKeyFromResolved(targetReal))" in desktop_main
    assert "paths.has(target))" not in desktop_main
    assert "pathExistsAsync(realTarget)" not in desktop_main
    media_protocol_block = desktop_main[desktop_main.index("function registerMediaProtocol"):desktop_main.index("function hardenWebContents")]
    assert "fs.existsSync" not in media_protocol_block
    assert "pathToFileURL(realTarget)" in desktop_main
    enroll_manager = (root / "crossage_fr" / "enroll" / "manager.py").read_text(encoding="utf-8")
    assert "unmatched_paths: set[Path]" in enroll_manager
    assert "image_path in unmatched_paths" in enroll_manager
    assert "any(row[0] == image_path for row in unmatched)" not in enroll_manager
    assert "archive_path = backup_path if not encrypted else" in enroll_manager
    assert "encrypt_file(archive_path, encrypted_temp, passphrase)" in enroll_manager
    assert "os.replace(encrypted_temp, backup_path)" in enroll_manager
    assert "write_bytes(encrypt_bytes(backup_path.read_bytes()" not in enroll_manager
    assert "decrypt_file(path, decrypted_path, passphrase)" in enroll_manager
    assert "decrypt_bytes(path.read_bytes()" not in enroll_manager
    assert "io.BytesIO" not in enroll_manager
    assert "ZipFile(self._backup_archive_source(path))" not in enroll_manager
    assert "for row in self._iter_audit_rows_reverse()" in enroll_manager
    assert "recent: deque[dict[str, Any]] = deque(maxlen=offset + limit)" not in enroll_manager

    windows_workflow = (root / ".github" / "workflows" / "windows-release.yml").read_text(encoding="utf-8")
    release_workflow = (root / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "workflow_call:" in windows_workflow
    assert "dist/latest*.yml" in windows_workflow
    assert "contents: read" in windows_workflow
    assert "softprops/action-gh-release" not in windows_workflow
    assert "id-token: write" in windows_workflow
    assert "azure/login@" in windows_workflow
    assert "azureSignOptions" in windows_workflow
    assert "Get-AuthenticodeSignature" in windows_workflow
    assert "TimeStamperCertificate" in windows_workflow
    assert "Build unsigned" not in windows_workflow
    assert "WINDOWS_CERTIFICATE" not in windows_workflow
    mac_workflow = (root / ".github" / "workflows" / "macos-release.yml").read_text(encoding="utf-8")
    assert "Build signed and notarized macOS installer" in mac_workflow
    assert "codesign --verify --deep --strict" in mac_workflow
    assert "xcrun stapler validate" in mac_workflow
    assert "Vintrace-macOS-Signed-Notarized" in mac_workflow
    assert "Build unsigned" not in mac_workflow
    assert "npm run dist:mac:unsigned" not in mac_workflow
    assert "workflow_call:" in mac_workflow
    assert "softprops/action-gh-release" not in mac_workflow
    assert "release_tag" in release_workflow
    assert "softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65" in release_workflow
    assert "contents: write" in release_workflow
    assert "npm run release:assemble" in release_workflow
    assert "npm run release:verify-platform-evidence" in release_workflow
    assert "--platform all" in release_workflow
    assert "--allow-draft" in release_workflow
    assert "Publish the verified release once" in release_workflow

    i18n = (root / "src" / "i18n.ts").read_text(encoding="utf-8")
    locale_sources = "\n".join(
        (root / "src" / "i18n" / "locales" / f"{code}.ts").read_text(encoding="utf-8")
        for code in ("zh", "es", "fr", "ar", "hi", "ja")
    )
    for code in ('"en"', '"zh"', '"es"', '"fr"', '"ar"', '"hi"', '"ja"'):
        assert code in i18n
    assert "localizeDom" in i18n
    assert "हिन्दी" in i18n
    assert "Español" in i18n
    assert "中文" in i18n
    assert "Français" in i18n
    assert "العربية" in i18n
    assert "日本語" in i18n
    assert "preloadLanguage" in i18n
    assert 'import("./i18n/locales/zh")' in i18n
    assert "const translations: Record<LanguageCode, TranslationTable>" not in i18n
    assert "translateUiText(language: LanguageCode, source: string" in i18n
    assert "uiPhrases?: Record<string, string>" in i18n
    assert '"Review flagged photos"' in locale_sources
    assert '"Safe Mode profile"' in locale_sources
    assert "export type UiMessageKey" in i18n
    assert "formatUiMessage(language: LanguageCode" in i18n
    assert "formatErrorMessage(language: LanguageCode" in i18n
    assert '"E-WORKSPACE-LOCKED"' in i18n
    assert '"E-BACKEND-TIMEOUT"' in i18n
    assert '"notice.possibleMatchesFound"' in i18n
    assert 'localizeAttribute(element, "alt", language)' in i18n
    assert "isLocalizableAttributeElement" in i18n
    app_tsx = (root / "src" / "App.tsx").read_text(encoding="utf-8")
    app_preferences_state = (root / "src" / "appPreferencesState.ts").read_text(encoding="utf-8")
    assert "languageStorageKey" in app_preferences_state
    assert "readInitialLanguage" in app_tsx
    assert 'document.getElementById("root") || document.body' in app_tsx
    assert 'if (language === "en") {' in app_tsx
    assert "localizeDom(root, language);" in app_tsx
    assert 'if (language === "en") return;' not in app_tsx
    assert "const addPendingRoot = (target: ParentNode)" in app_tsx
    assert "validTargets.some" not in app_tsx
    assert "localizeDom(targetRoot, language)" in app_tsx
    assert 'attributeFilter: ["alt", "aria-label", "placeholder", "title"]' in app_tsx
    assert 'className="switch-row language-picker"' in app_tsx
    assert 'aria-label="Interface language"' in app_tsx
    assert 'document.documentElement.dir = language === "ar" ? "rtl" : "ltr"' in app_tsx
    assert "setImperativeLanguage(language)" in app_tsx
    assert "window.crossAge.setAppLanguage" in app_tsx
    assert "readInitialLanguage" in app_tsx
    assert "readPhotoImportFlag" in app_tsx
    assert "function PromptHost()" in app_tsx
    assert "<PromptHost />" in app_tsx
    assert 'if (window.crossAge) {\n    return defaultValue;' not in app_tsx
    assert 'const oldRoot = await promptUi("Old folder path to replace", "");' in app_tsx
    assert "setNoticeMessage(" in app_tsx
    assert "setErrorNotice(error" in app_tsx
    assert "formatErrorMessage={formatErrorMessage}" in app_tsx
    assert "errorCode?: string" in app_tsx
    assert "messageKey?: UiMessageKey" in app_tsx
    assert "setNotice({ tone, messageKey, values, text: fallback })" in app_tsx
    assert "Native share is not available here, so I opened the folder containing" in app_tsx
    assert "reviewFocus" in app_tsx
    assert "Show all Review" in app_tsx
    assert "useReviewFocusHistoryState" in app_tsx
    assert "openReviewFocusHistoryItem" in app_tsx
    assert "Recent Review More" in app_tsx
    assert "reviewCandidate={(status, candidate) => review(status, candidate, true)}" in app_tsx

    preload = (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "setAppLanguage" in preload
    assert "normalizeIpcError" in preload
    assert "safeInvoke(\"backend:invoke\"" in preload
    assert "sharePaths:" in preload
    assert "openPathWith:" in preload
    assert "listExternalEditors:" in preload
    assert "forgetExternalEditor:" in preload
    assert "printPath:" in preload
    assert "getPhotosSensitiveAuthStatus:" in preload
    assert "authenticatePhotosSensitiveAccess:" in preload
    assert "writeClipboardImagePath:" in preload
    assert "startFileDrag:" in preload
    assert "chooseColorProfileFile:" in preload
    assert "dialog:choose-color-profile" in desktop_main
    assert "ICC profiles" in desktop_main
    assert "CROSSAGE_USER_MODEL_DIR" in desktop_main
    assert "CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR" in desktop_main
    assert "CROSSAGE_SAFETY_EXPLAIN_DIR" in desktop_main
    assert 'path.join(app.getPath("userData"), "models")' in desktop_main
    assert 'path.join(userModelRoot, "safety-explain")' in desktop_main
    assert "app:set-language" in desktop_main
    assert "nativeUiText" in desktop_main
    assert "createAppError(\"E-WORKSPACE-LOCKED\"" in desktop_main
    assert "createAppError(\"E-IPC-BLOCKED-COMMAND\"" in desktop_main
    assert "ShareMenu" in desktop_main
    assert "shell_share_fallback_reveal" in desktop_main
    assert "Native share is not available on this platform, so the containing folder was opened instead." in desktop_main
    assert "systemPreferences" in desktop_main
    assert "photos:sensitive-auth-status" in desktop_main
    assert "photos:authenticate-sensitive" in desktop_main
    assert "promptTouchID" in desktop_main
    assert "shell:share-paths" in desktop_main
    assert "shell:open-path-with" in desktop_main
    assert "shell:list-external-editors" in desktop_main
    assert "shell:forget-external-editor" in desktop_main
    assert "external-editors.json" in desktop_main
    assert "isTrustedExternalEditorPath" in desktop_main
    assert "isSavedExternalEditorPath" in desktop_main
    assert "shell_open_with" in desktop_main
    assert "clipboard:write-image-path" in desktop_main
    assert "clipboard.writeImage" in desktop_main
    assert "shell:start-drag-file" in desktop_main
    assert "startDrag" in desktop_main
    assert "shell:print-path" in desktop_main
    assert "webContents.print" in desktop_main
    assert "isTrustedShellPath(target)" in desktop_main
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
    backend_builder = (root / "desktop" / "scripts" / "build-backend.cjs").read_text(encoding="utf-8")
    assert "crossage_fr.experiments.self_learning_audit" in backend_builder
    assert "crossage_fr.experiments.onnx_training" in backend_builder
    assert "crossage_fr.experiments.retraining_governance" in backend_builder

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
        "ordered_review_candidates",
        "suggest_photo_review_more_candidates",
        "list_photo_folders",
        "list_photo_folder_items",
        "list_photo_date_buckets",
        "search_photo_library",
        "list_photo_assets",
        "list_photo_burst_stacks",
        "set_photo_burst_selection",
        "list_photo_keywords",
        "save_photo_keyword",
        "delete_photo_keyword",
        "export_photo_keywords",
        "import_photo_keywords",
        "save_photo_person_profile",
        "save_photo_pet_profile",
        "save_photo_place_profile",
        "save_photo_utility_profile",
        "rename_photo_pet",
        "assign_photo_pet",
        "dismiss_photo_pet_review",
        "save_photo_people_group",
        "delete_photo_people_group",
        "update_photo_asset_metadata",
        "update_photo_assets_metadata",
        "reverse_geocode_photo_location",
        "get_photo_edit_stack",
        "save_photo_edit_stack",
        "revert_photo_edit_stack",
        "list_photo_edit_stack_versions",
        "create_photo_edit_stack_version",
        "restore_photo_edit_stack_version",
        "delete_photo_edit_stack_version",
        "duplicate_photo_asset_version",
        "duplicate_photo_asset_rendered_version",
        "record_photo_asset_event",
        "apply_photo_visibility_operation",
        "list_photo_operations",
        "photo_restore_rehearsal",
        "photo_backup_restore_rehearsal",
        "undo_photo_operation",
        "permanently_delete_photos",
        "merge_photo_duplicates",
        "dismiss_photo_duplicate_group",
        "import_photos",
        "update_photo_import_session_provenance",
        "archive_photo_import_sessions",
        "list_photo_import_failures",
        "dismiss_photo_import_failure",
        "retry_photo_import_failure",
        "save_recovered_photo_import_failure",
        "delete_recovered_photo_import_failure",
        "scan_photo_recovered_orphans",
        "photo_recovered_cleanup",
        "rebuild_photo_previews",
        "photo_library_preview_sweep",
        "relink_photo_library_paths",
        "create_photo_media_pair",
        "relink_photo_media_pair",
        "delete_photo_media_pair",
        "consolidate_photo_library_assets",
        "photo_library_backup_check",
        "photo_library_catalog_cleanup",
        "photo_repair_history",
        "photo_library_settings",
        "save_photo_library_settings",
        "index_photo_ocr",
        "photo_ocr_index_status",
        "index_photo_barcodes",
        "photo_barcode_index_status",
        "index_photo_objects",
        "photo_object_index_status",
        "photo_curation_preferences",
        "save_photo_curation_preferences",
        "photo_user_memories",
        "save_photo_user_memory",
        "delete_photo_user_memory",
        "photo_slideshow_theme_templates",
        "save_photo_slideshow_theme_template",
        "delete_photo_slideshow_theme_template",
        "export_photo_slideshow_theme_templates",
        "import_photo_slideshow_theme_templates",
        "photo_slideshow_projects",
        "save_photo_slideshow_project",
        "delete_photo_slideshow_project",
        "export_photo_slideshow",
        "export_photo_memory_movie",
        "list_photo_saved_filters",
        "save_photo_saved_filter",
        "delete_photo_saved_filter",
        "save_photo_album",
        "delete_photo_album",
        "merge_photo_albums",
        "migrate_photo_smart_albums",
        "list_photo_album_folders",
        "save_photo_album_folder",
        "delete_photo_album_folder",
        "move_photo_album_to_folder",
        "reorder_photo_album_folder_children",
        "add_photo_album_items",
        "remove_photo_album_items",
        "reorder_photo_album_items",
        "suggest_photo_albums",
        "photo_color_profile_status",
        "validate_photo_color_profile",
        "export_photo_selection",
        "export_photo_contact_sheet",
        "export_photo_video_frame",
        "export_photo_video_trim",
        "export_photo_live_motion",
        "export_photo_subject_cutout",
        "set_photo_live_key_photo",
        "reset_photo_live_key_photo",
        "set_photo_video_poster",
        "reset_photo_video_poster",
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
        "self_learning_rd_status",
        "calibration_learning_status",
        "run_learning_jobs",
        "reference_suggestion_status",
        "stage_reference_suggestions",
        "approve_reference_suggestion",
        "reject_reference_suggestion",
        "stage_calibration",
        "promote_calibration",
        "rollback_calibration",
        "embedding_adapter_status",
        "stage_embedding_adapter",
        "promote_embedding_adapter",
        "rollback_embedding_adapter",
        "apply_calibration",
        "apply_personalized_calibration",
        "export_accuracy_labels",
        "import_accuracy_labels",
        "export_training_examples",
        "import_training_examples",
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
    assert '"export_training_examples"' in app_tsx
    assert '"import_training_examples"' in app_tsx
    assert "function parseTrainingExampleRows" in app_tsx
    assert "Import training-example JSON" in app_tsx
    assert '"self_learning_rd_status"' in app_tsx
    assert "Self-learning R&D" in app_tsx
    assert "Update R&D status" in app_tsx
    assert "function parseAccuracyLabelRows" in app_tsx
    assert "Import label JSON" in app_tsx
    assert '"add_calibration_label"' in app_tsx
    assert '"calibration_learning_status"' in app_tsx
    assert '"run_learning_jobs"' in app_tsx
    assert '"stage_reference_suggestions"' in app_tsx
    assert '"approve_reference_suggestion"' in app_tsx
    assert '"reject_reference_suggestion"' in app_tsx
    assert '"stage_calibration"' in app_tsx
    assert '"promote_calibration"' in app_tsx
    assert '"rollback_calibration"' in app_tsx
    assert '"embedding_adapter_status"' in app_tsx
    assert '"stage_embedding_adapter"' in app_tsx
    assert '"promote_embedding_adapter"' in app_tsx
    assert '"rollback_embedding_adapter"' in app_tsx
    assert '"apply_personalized_calibration"' in app_tsx
    assert "Personalize people" in app_tsx
    assert '"list_photo_date_buckets"' in app_tsx
    assert '"search_photo_library"' in app_tsx
    assert '"list_photo_burst_stacks"' in app_tsx
    assert '"set_photo_burst_selection"' in app_tsx
    assert '"list_photo_keywords"' in app_tsx
    assert '"save_photo_keyword"' in app_tsx
    assert '"delete_photo_keyword"' in app_tsx
    assert '"export_photo_keywords"' in app_tsx
    assert '"import_photo_keywords"' in app_tsx
    assert '"save_photo_person_profile"' in app_tsx
    assert '"save_photo_pet_profile"' in app_tsx
    assert '"save_photo_place_profile"' in app_tsx
    assert '"save_photo_utility_profile"' in app_tsx
    assert '"rename_photo_pet"' in app_tsx
    assert '"assign_photo_pet"' in app_tsx
    assert '"dismiss_photo_pet_review"' in app_tsx
    assert '"update_photo_assets_metadata"' in app_tsx
    assert '"reverse_geocode_photo_location"' in app_tsx
    assert '"get_photo_edit_stack"' in app_tsx
    assert '"save_photo_edit_stack"' in app_tsx
    assert '"revert_photo_edit_stack"' in app_tsx
    assert '"list_photo_edit_stack_versions"' in app_tsx
    assert '"create_photo_edit_stack_version"' in app_tsx
    assert '"restore_photo_edit_stack_version"' in app_tsx
    assert '"delete_photo_edit_stack_version"' in app_tsx
    assert '"duplicate_photo_asset_version"' in app_tsx
    assert '"duplicate_photo_asset_rendered_version"' in app_tsx
    assert '"record_photo_asset_event"' in app_tsx
    assert '"apply_photo_visibility_operation"' in app_tsx
    assert '"list_photo_operations"' in app_tsx
    assert '"photo_restore_rehearsal"' in app_tsx
    assert '"photo_backup_restore_rehearsal"' in app_tsx
    assert '"undo_photo_operation"' in app_tsx
    assert '"permanently_delete_photos"' in app_tsx
    assert '"merge_photo_duplicates"' in app_tsx
    assert '"dismiss_photo_duplicate_group"' in app_tsx
    assert '"import_photos"' in app_tsx
    assert '"update_photo_import_session_provenance"' in app_tsx
    assert '"archive_photo_import_sessions"' in app_tsx
    assert '"list_photo_import_failures"' in app_tsx
    assert '"dismiss_photo_import_failure"' in app_tsx
    assert '"retry_photo_import_failure"' in app_tsx
    assert '"save_recovered_photo_import_failure"' in app_tsx
    assert '"delete_recovered_photo_import_failure"' in app_tsx
    assert '"scan_photo_recovered_orphans"' in app_tsx
    assert '"photo_recovered_cleanup"' in app_tsx
    assert '"rebuild_photo_previews"' in app_tsx
    assert '"photo_library_preview_sweep"' in app_tsx
    assert '"relink_photo_library_paths"' in app_tsx
    assert '"create_photo_media_pair"' in app_tsx
    assert '"relink_photo_media_pair"' in app_tsx
    assert '"delete_photo_media_pair"' in app_tsx
    assert '"consolidate_photo_library_assets"' in app_tsx
    assert '"photo_library_backup_check"' in app_tsx
    assert '"photo_library_catalog_cleanup"' in app_tsx
    assert '"photo_repair_history"' in app_tsx
    assert '"photo_library_settings"' in app_tsx
    assert '"save_photo_library_settings"' in app_tsx
    assert '"photo_curation_preferences"' in app_tsx
    assert '"save_photo_curation_preferences"' in app_tsx
    assert '"photo_user_memories"' in app_tsx
    assert '"save_photo_user_memory"' in app_tsx
    assert '"delete_photo_user_memory"' in app_tsx
    assert '"photo_slideshow_theme_templates"' in app_tsx
    assert '"save_photo_slideshow_theme_template"' in app_tsx
    assert '"delete_photo_slideshow_theme_template"' in app_tsx
    assert '"export_photo_slideshow_theme_templates"' in app_tsx
    assert '"import_photo_slideshow_theme_templates"' in app_tsx
    assert '"photo_slideshow_projects"' in app_tsx
    assert '"save_photo_slideshow_project"' in app_tsx
    assert '"delete_photo_slideshow_project"' in app_tsx
    assert '"list_photo_saved_filters"' in app_tsx
    assert '"save_photo_saved_filter"' in app_tsx
    assert '"delete_photo_saved_filter"' in app_tsx
    assert '"save_photo_album"' in app_tsx
    assert '"delete_photo_album"' in app_tsx
    assert '"merge_photo_albums"' in app_tsx
    assert '"migrate_photo_smart_albums"' in app_tsx
    assert '"save_photo_album_folder"' in app_tsx
    assert '"delete_photo_album_folder"' in app_tsx
    assert '"move_photo_album_to_folder"' in app_tsx
    assert '"reorder_photo_album_folder_children"' in app_tsx
    assert '"add_photo_album_items"' in app_tsx
    assert '"remove_photo_album_items"' in app_tsx
    assert '"reorder_photo_album_items"' in app_tsx
    assert '"suggest_photo_albums"' in app_tsx
    assert '"photo_color_profile_status"' in app_tsx
    assert '"validate_photo_color_profile"' in app_tsx
    assert '"export_photo_selection"' in app_tsx
    assert '"export_photo_contact_sheet"' in app_tsx
    assert '"export_photo_video_frame"' in app_tsx
    assert '"export_photo_video_trim"' in app_tsx
    assert '"export_photo_live_motion"' in app_tsx
    assert "chooseAudioFile" in app_tsx
    assert "chooseColorProfileFile" in app_tsx
    assert '"export_photo_subject_cutout"' in app_tsx
    assert '"set_photo_live_key_photo"' in app_tsx
    assert '"reset_photo_live_key_photo"' in app_tsx
    assert '"set_photo_video_poster"' in app_tsx
    assert '"reset_photo_video_poster"' in app_tsx
    types_ts = (root / "src" / "types.ts").read_text(encoding="utf-8")
    assert '"photos" | "settings"' in types_ts
    assert "videoRendered" in types_ts
    assert "titleCardIncluded" in types_ts
    assert "titleCard" in types_ts
    assert "fontScale" in types_ts
    assert "showFooter" in types_ts
    assert "audioImported" in types_ts
    assert "customAudio" in types_ts
    assert "audioVolume" in types_ts
    assert "audioFadeMs" in types_ts
    assert "audioStartMs" in types_ts
    assert "audioEndMs" in types_ts
    assert "chooseJsonFile" in types_ts
    assert "chooseColorProfileFile" in types_ts
    assert "timelineDurationMs" in types_ts
    assert "timelineItems" in types_ts
    assert "motionPresets" in types_ts
    assert "motionApplied" in types_ts
    assert "PhotoMemoryMovieSettings" in types_ts
    assert "movieSettings?: PhotoMemoryMovieSettings" in types_ts
    assert "templateStageFrame" in types_ts
    assert "SharePathsResult" in types_ts
    assert 'fallback?: "reveal"' in types_ts
    assert "fallbackDirectory" in types_ts
    assert "ExternalEditorFavorite" in types_ts
    assert "OpenPathWithResult" in types_ts
    assert "listExternalEditors" in types_ts
    assert "forgetExternalEditor" in types_ts
    assert "openPathWith" in types_ts
    assert "PhotoVideoTrimExportValue" in types_ts
    assert "PhotoLiveMotionExportValue" in types_ts
    assert "PhotoSubjectCutoutExportValue" in types_ts
    assert "ClipboardImagePathResult" in types_ts
    assert "writeClipboardImagePath" in types_ts
    assert "FileDragResult" in types_ts
    assert "startFileDrag" in types_ts
    assert "PhotoLiveKeyPhotoValue" in types_ts
    assert "rawPreviewProxyPath" in types_ts
    assert "PhotoBurstStackSummary" in types_ts
    assert "burstStack" in types_ts
    photos_view = (root / "src" / "views" / "PhotosView.tsx").read_text(encoding="utf-8")
    photos_e2e = (root / "tests" / "e2e" / "photos-album-folders.spec.ts").read_text(encoding="utf-8")
    photo_tests = (root / "tests" / "photos_view.test.mjs").read_text(encoding="utf-8")
    photo_curation_preferences = (root / "src" / "views" / "photoCurationPreferences.ts").read_text(encoding="utf-8")
    photo_active_filter_chips = (root / "src" / "views" / "photoActiveFilterChips.tsx").read_text(encoding="utf-8")
    photo_date_bucket_panel = (root / "src" / "views" / "photoDateBucketPanel.tsx").read_text(encoding="utf-8")
    photo_duplicate_review = (root / "src" / "views" / "photoDuplicateReview.ts").read_text(encoding="utf-8")
    photo_duplicate_review_panel = (root / "src" / "views" / "photoDuplicateReviewPanel.tsx").read_text(encoding="utf-8")
    photo_empty_library_state = (root / "src" / "views" / "photoEmptyLibraryState.tsx").read_text(encoding="utf-8")
    photo_group_review = (root / "src" / "views" / "photoGroupReview.ts").read_text(encoding="utf-8")
    photo_image_edit_display = (root / "src" / "views" / "photoImageEditDisplay.ts").read_text(encoding="utf-8")
    photo_image_edits = (root / "src" / "views" / "photoImageEdits.ts").read_text(encoding="utf-8")
    photo_import_album_target = (root / "src" / "views" / "photoImportAlbumTarget.ts").read_text(encoding="utf-8")
    photo_lightbox_stage = (root / "src" / "views" / "photoLightboxStage.tsx").read_text(encoding="utf-8")
    photo_lightbox_edit_stack_history = (root / "src" / "views" / "photoLightboxEditStackHistory.tsx").read_text(encoding="utf-8")
    photo_lightbox_video_action_bar = (root / "src" / "views" / "photoLightboxVideoActionBar.tsx").read_text(encoding="utf-8")
    photo_lightbox_session = (root / "src" / "views" / "photoLightboxSession.ts").read_text(encoding="utf-8")
    photo_selection_export_results = (root / "src" / "views" / "photoSelectionExportResults.ts").read_text(encoding="utf-8")
    photo_selection_primary_actions = (root / "src" / "views" / "photoSelectionPrimaryActions.tsx").read_text(encoding="utf-8")
    photo_selection_original_actions = (root / "src" / "views" / "photoSelectionOriginalActions.tsx").read_text(encoding="utf-8")
    photo_selection_review_actions = (root / "src" / "views" / "photoSelectionReviewActions.tsx").read_text(encoding="utf-8")
    photo_selection_summary_controls = (root / "src" / "views" / "photoSelectionSummaryControls.tsx").read_text(encoding="utf-8")
    photo_selection_edit_controls = (root / "src" / "views" / "photoSelectionEditControls.tsx").read_text(encoding="utf-8")
    photo_selection_bulk_metadata_controls = (root / "src" / "views" / "photoSelectionBulkMetadataControls.tsx").read_text(encoding="utf-8")
    photo_selection_order_controls = (root / "src" / "views" / "photoSelectionOrderControls.tsx").read_text(encoding="utf-8")
    photo_selection_visibility_controls = (root / "src" / "views" / "photoSelectionVisibilityControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_basics_controls = (root / "src" / "views" / "photoSlideshowProjectBasicsControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_framing_controls = (root / "src" / "views" / "photoSlideshowProjectFramingControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_caption_controls = (root / "src" / "views" / "photoSlideshowProjectCaptionControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_caption_action_controls = (root / "src" / "views" / "photoSlideshowProjectCaptionActionControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_keyframe_controls = (root / "src" / "views" / "photoSlideshowProjectKeyframeControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_playback_controls = (root / "src" / "views" / "photoSlideshowProjectPlaybackControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_template_controls = (root / "src" / "views" / "photoSlideshowProjectTemplateControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_project_timeline_controls = (root / "src" / "views" / "photoSlideshowProjectTimelineControls.tsx").read_text(encoding="utf-8")
    photo_slideshow_overlay = (root / "src" / "views" / "photoSlideshowOverlay.tsx").read_text(encoding="utf-8")
    photo_thumbnail_controls = (root / "src" / "views" / "photoThumbnailControls.ts").read_text(encoding="utf-8")
    photo_grid_tile = (root / "src" / "views" / "photoGridTile.tsx").read_text(encoding="utf-8")
    photo_virtual_grid_panel = (root / "src" / "views" / "photoVirtualGridPanel.tsx").read_text(encoding="utf-8")
    photo_burst_stack_panel = (root / "src" / "views" / "photoBurstStackPanel.tsx").read_text(encoding="utf-8")
    photo_lightbox_burst_strip = (root / "src" / "views" / "photoLightboxBurstStrip.tsx").read_text(encoding="utf-8")
    photo_info_draft = (root / "src" / "views" / "photoInfoDraft.ts").read_text(encoding="utf-8")
    photo_lightbox_zoom_controls = (root / "src" / "views" / "photoLightboxZoomControls.tsx").read_text(encoding="utf-8")
    photo_lightbox_file_actions = (root / "src" / "views" / "photoLightboxFileActions.tsx").read_text(encoding="utf-8")
    photo_lightbox_primary_actions = (root / "src" / "views" / "photoLightboxPrimaryActions.tsx").read_text(encoding="utf-8")
    photo_lightbox_curation_actions = (root / "src" / "views" / "photoLightboxCurationActions.tsx").read_text(encoding="utf-8")
    photo_lightbox_safety_actions = (root / "src" / "views" / "photoLightboxSafetyActions.tsx").read_text(encoding="utf-8")
    photo_display_text = (root / "src" / "views" / "photoDisplayText.ts").read_text(encoding="utf-8")
    photo_utility_classifier_review = (root / "src" / "views" / "photoUtilityClassifierReview.ts").read_text(encoding="utf-8")
    photo_people_match_selection = (root / "src" / "views" / "photoPeopleMatchSelection.ts").read_text(encoding="utf-8")
    keyboard_shortcuts = (root / "src" / "views" / "photoKeyboardShortcuts.ts").read_text(encoding="utf-8")
    assert "suppressGenerated" in photos_view
    assert "RAW preview proxy" in photos_view
    assert "rendered_raw_proxy" in photo_selection_export_results
    assert "collapseBursts" in photos_view
    assert "photo-burst-badge" in photo_grid_tile
    assert "PhotoBurstStackPanel" in photos_view
    assert "photo-burst-stack-panel" not in photos_view
    assert "photo-burst-stack-panel" in photo_burst_stack_panel
    assert "Loading burst stacks..." in photo_burst_stack_panel
    assert "Select stack" in photo_burst_stack_panel
    assert "PhotoLightboxBurstStrip" in photos_view
    assert "photos-lightbox-burst-strip" not in photos_view
    assert "photos-lightbox-burst-strip" in photo_lightbox_burst_strip
    assert "stepLightboxSelection" in photos_view
    assert "Set keeper" not in photos_view
    assert "Set keeper" in photo_lightbox_burst_strip
    search_suggestions = (root / "src" / "views" / "photoSearchSuggestions.ts").read_text(encoding="utf-8")
    search_highlights = (root / "src" / "views" / "photoSearchHighlights.ts").read_text(encoding="utf-8")
    rail_visibility = (root / "src" / "views" / "photoRailVisibility.ts").read_text(encoding="utf-8")
    filter_chips = (root / "src" / "views" / "photoFilterChips.ts").read_text(encoding="utf-8")
    keyword_filters = (root / "src" / "views" / "photoKeywordFilters.ts").read_text(encoding="utf-8")
    photo_keyword_manager_panel = (root / "src" / "views" / "photoKeywordManagerPanel.tsx").read_text(encoding="utf-8")
    photo_pet_review_kind_chips = (root / "src" / "views" / "photoPetReviewKindChips.tsx").read_text(encoding="utf-8")
    photo_library_search_panel = (root / "src" / "views" / "photoLibrarySearchPanel.tsx").read_text(encoding="utf-8")
    photo_semantic_search_panel = (root / "src" / "views" / "photoSemanticSearchPanel.tsx").read_text(encoding="utf-8")
    saved_search = (root / "src" / "views" / "photoSavedSearch.ts").read_text(encoding="utf-8")
    date_adjustments = (root / "src" / "views" / "photoDateAdjustments.ts").read_text(encoding="utf-8")
    date_views = (root / "src" / "views" / "photoDateViews.ts").read_text(encoding="utf-8")
    virtual_grid = (root / "src" / "views" / "photoVirtualGrid.ts").read_text(encoding="utf-8")
    location_picker = (root / "src" / "views" / "photoLocationPicker.ts").read_text(encoding="utf-8")
    places_map = (root / "src" / "views" / "photoPlacesMap.ts").read_text(encoding="utf-8")
    place_map_panel = (root / "src" / "views" / "photoPlaceMapPanel.tsx").read_text(encoding="utf-8")
    photo_album_folder_editor = (root / "src" / "views" / "photoAlbumFolderEditor.tsx").read_text(encoding="utf-8")
    photo_album_editor_panel = (root / "src" / "views" / "photoAlbumEditorPanel.tsx").read_text(encoding="utf-8")
    photo_albums_gallery = (root / "src" / "views" / "photoAlbumsGallery.tsx").read_text(encoding="utf-8")
    photo_memories_feed = (root / "src" / "views" / "photoMemoriesFeed.tsx").read_text(encoding="utf-8")
    photo_consolidation_panels = (root / "src" / "views" / "photoConsolidationPanels.tsx").read_text(encoding="utf-8")
    photo_shortcuts_panel = (root / "src" / "views" / "photoShortcutsPanel.tsx").read_text(encoding="utf-8")
    photo_curation_preferences_panel = (root / "src" / "views" / "photoCurationPreferencesPanel.tsx").read_text(encoding="utf-8")
    photo_managed_roots_panel = (root / "src" / "views" / "photoManagedRootsPanel.tsx").read_text(encoding="utf-8")
    photo_local_indexing_status_panel = (root / "src" / "views" / "photoLocalIndexingStatusPanel.tsx").read_text(encoding="utf-8")
    photo_indexing_queue_panel = (root / "src" / "views" / "photoIndexingQueuePanel.tsx").read_text(encoding="utf-8")
    photo_indexing_notice_panel = (root / "src" / "views" / "photoIndexingNoticePanel.tsx").read_text(encoding="utf-8")
    photo_load_status_alerts_panel = (root / "src" / "views" / "photoLoadStatusAlertsPanel.tsx").read_text(encoding="utf-8")
    photo_library_media_defaults_panel = (root / "src" / "views" / "photoLibraryMediaDefaultsPanel.tsx").read_text(encoding="utf-8")
    photo_media_playback_settings_panel = (root / "src" / "views" / "photoMediaPlaybackSettingsPanel.tsx").read_text(encoding="utf-8")
    photo_operation_undo_panel = (root / "src" / "views" / "photoOperationUndoPanel.tsx").read_text(encoding="utf-8")
    photo_intelligence_settings_panel = (root / "src" / "views" / "photoIntelligenceSettingsPanel.tsx").read_text(encoding="utf-8")
    photo_privacy_settings_panel = (root / "src" / "views" / "photoPrivacySettingsPanel.tsx").read_text(encoding="utf-8")
    photo_sensitive_lock_panel = (root / "src" / "views" / "photoSensitiveLockPanel.tsx").read_text(encoding="utf-8")
    photo_people_gallery = (root / "src" / "views" / "photoPeopleGallery.tsx").read_text(encoding="utf-8")
    photo_backup_policy_panel = (root / "src" / "views" / "photoBackupPolicyPanel.tsx").read_text(encoding="utf-8")
    photo_backup_check_panel = (root / "src" / "views" / "photoBackupCheckPanel.tsx").read_text(encoding="utf-8")
    photo_catalog_cleanup_preview_panel = (root / "src" / "views" / "photoCatalogCleanupPreviewPanel.tsx").read_text(encoding="utf-8")
    photo_import_access = (root / "src" / "views" / "photoImportAccess.ts").read_text(encoding="utf-8")
    photo_import_status_alerts = (root / "src" / "views" / "photoImportStatusAlerts.tsx").read_text(encoding="utf-8")
    photo_export_presets = (root / "src" / "views" / "photoExportPresets.ts").read_text(encoding="utf-8")
    photo_index_everything_dialog = (root / "src" / "views" / "photoIndexEverythingDialog.tsx").read_text(encoding="utf-8")
    photo_rail_display_controls = (root / "src" / "views" / "photoRailDisplayControls.tsx").read_text(encoding="utf-8")
    photo_rail_import_controls = (root / "src" / "views" / "photoRailImportControls.tsx").read_text(encoding="utf-8")
    photo_rail_load_errors = (root / "src" / "views" / "photoRailLoadErrors.tsx").read_text(encoding="utf-8")
    photo_repair_center_panel = (root / "src" / "views" / "photoRepairCenterPanel.tsx").read_text(encoding="utf-8")
    photo_repair_center_section = (root / "src" / "views" / "photoRepairCenterSection.tsx").read_text(encoding="utf-8")
    photo_repair_history_list = (root / "src" / "views" / "photoRepairHistoryList.tsx").read_text(encoding="utf-8")
    photo_repair_issue_list = (root / "src" / "views" / "photoRepairIssueList.tsx").read_text(encoding="utf-8")
    photo_restore_rehearsal_panels = (root / "src" / "views" / "photoRestoreRehearsalPanels.tsx").read_text(encoding="utf-8")
    photo_saved_filters_rail_section = (root / "src" / "views" / "photoSavedFiltersRailSection.tsx").read_text(encoding="utf-8")
    photo_export_contact_sheet_controls = (root / "src" / "views" / "photoExportContactSheetControls.tsx").read_text(encoding="utf-8")
    photo_export_destination_controls = (root / "src" / "views" / "photoExportDestinationControls.tsx").read_text(encoding="utf-8")
    photo_export_packaging_controls = (root / "src" / "views" / "photoExportPackagingControls.tsx").read_text(encoding="utf-8")
    photo_export_preset_controls = (root / "src" / "views" / "photoExportPresetControls.tsx").read_text(encoding="utf-8")
    photo_export_render_controls = (root / "src" / "views" / "photoExportRenderControls.tsx").read_text(encoding="utf-8")
    photo_export_result_panel = (root / "src" / "views" / "photoExportResultPanel.tsx").read_text(encoding="utf-8")
    photo_export_video_controls = (root / "src" / "views" / "photoExportVideoControls.tsx").read_text(encoding="utf-8")
    api_server = (root / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
    workspace_db = (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    styles_css = (root / "src" / "styles.css").read_text(encoding="utf-8")
    app_tsx = (root / "src" / "App.tsx").read_text(encoding="utf-8")
    desktop_main = (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    external_open_cjs = (root / "desktop" / "main" / "external-open.cjs").read_text(encoding="utf-8")
    external_open_tests = (root / "tests" / "external_open.test.cjs").read_text(encoding="utf-8")
    photo_sources_cjs = (root / "desktop" / "main" / "photo-sources.cjs").read_text(encoding="utf-8")
    photo_sources_tests = (root / "tests" / "photo_sources.test.cjs").read_text(encoding="utf-8")
    photo_folders = (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "async function buildSystemPhotoSources" in photo_sources_cjs
    assert "DEFAULT_SOURCE_FS_TIMEOUT_MS" in photo_sources_cjs
    assert "withFsTimeout" in photo_sources_cjs
    assert "fsTimeoutMs" in photo_sources_cjs
    assert "fs.promises.readdir" in photo_sources_cjs
    assert "fs.promises.realpath" in photo_sources_cjs
    assert "fs.readdirSync" not in photo_sources_cjs
    assert "fs.statSync" not in photo_sources_cjs
    assert "fs.existsSync" not in photo_sources_cjs
    assert "testSlowMountedRootDoesNotBlockCameraDiscovery" in photo_sources_tests
    assert "testSlowMountedDriveRealpathFallsBackPromptly" in photo_sources_tests
    assert '"export_photo_keywords": "_cmd_export_photo_keywords"' in api_server
    assert '"import_photo_keywords": "_cmd_import_photo_keywords"' in api_server
    assert "COVER_PREVIEW_BUDGET" in photos_view
    assert "coverPreviewBudget" in photos_view
    assert "coverPreviewGenerated" in types_ts
    assert "_apply_photo_folder_cover_previews" in api_server
    assert "coverPreviewAttempts" in api_server
    assert "_photo_raw_preview_proxy_path" in api_server
    assert "_apply_raw_preview_proxy_rebuilds" in api_server
    assert "raw_proxy_previews" in api_server
    assert "rawProxyRendered" in api_server
    assert "rawProxyRendered" in types_ts
    assert "rawRenderProxyPath" in types_ts
    assert "output = load_image(source)" in api_server
    assert "return load_image(resolved).convert(\"RGB\"), \"original\"" in api_server
    assert "base = load_image(source).convert(\"RGBA\")" in api_server
    assert "test_photo_rendered_export_uses_raw_proxy_when_native_decode_unavailable" in photo_folders
    assert "test_photo_native_raw_decoder_feeds_preview_export_edits_contact_sheet_and_cutout" in photo_folders
    assert "collapse_burst_entries" in api_server
    assert "photo_metadata_burst_info" in workspace_db
    assert "burstIdentifier" in workspace_db
    assert "burstSelectionTypes" in workspace_db
    assert "BurstUUID" in photo_folders
    assert "test_photo_burst_stacks_import_xmp_golden_fixture_metadata" in photo_folders
    assert "GOLDEN-XMP-BURST-1" in photo_folders
    assert "New album" in photos_view
    assert "New manual album" in photos_view
    assert "New folder" in photos_view
    assert "PhotoEmptyLibraryState" in photos_view
    assert "Import files" not in photos_view
    assert "Import folder" not in photos_view
    assert "Import photos" in photo_empty_library_state
    assert "Import folder" in photo_empty_library_state
    assert "PhotoIndexEverythingDialog" in photos_view
    assert "index-everything-sheet" not in photos_view
    assert "index-everything-sheet" in photo_index_everything_dialog
    assert "Index my photos" in photo_index_everything_dialog
    assert "Add folder or drive" in photo_index_everything_dialog
    photo_pending_import_review_panel = (root / "src" / "views" / "photoPendingImportReviewPanel.tsx").read_text(encoding="utf-8")
    assert "PhotoPendingImportReviewPanel" in photos_view
    assert "Import review" in photo_pending_import_review_panel
    assert "Import to album" in photo_pending_import_review_panel
    assert "New import album name" in photo_pending_import_review_panel
    assert "Confirm import" in photo_pending_import_review_panel
    assert "Cancel import" in photo_pending_import_review_panel
    assert "pendingImportEntries" in photos_view
    assert "pendingImportAlbumTargetId" in photos_view
    assert "photoImportResultFinalSourcePaths" in photo_import_album_target
    assert "photos-import" in external_open_cjs
    assert "parseProtocolUrl" in external_open_cjs
    assert "getAll(\"file\")" in external_open_cjs
    assert "protocolPhotoImportSourceDetail" in external_open_cjs
    assert "sender" in external_open_cjs
    assert "sourceUrl" in external_open_cjs
    assert "bundleId" in external_open_cjs
    assert "function parseExternalPath" in desktop_main
    assert "type: \"scan-files\"" in desktop_main
    assert "type: \"photos-import\"" in types_ts
    assert "PhotoExternalImportRequest" in types_ts
    assert "photoExternalImportRequest" in app_tsx
    assert "Array.isArray(payload.paths)" in app_tsx
    assert 'legacyNavigate("photos")' in app_tsx
    assert 'case "photos":\n      return { tab: "library" };' in (root / "src" / "shell" / "navModel.ts").read_text(encoding="utf-8")
    assert "externalImportRequest={photoExternalImportRequest}" in app_tsx
    assert "onExternalImportConsumed" in app_tsx
    assert "externalImportRequest" in photos_view
    assert "normalizeExternalPhotoImportSourceKind" in photos_view
    assert "pendingImportSourceLabelExplicit" in photos_view
    assert "photoImportReviewSourceLabel" in photo_pending_import_review_panel
    assert "stagePendingImport(paths, request.sourceLabel || \"External import\"" in photos_view
    assert "Photos external import handoff preserves app attribution after confirm" in photos_e2e
    assert "Spark Mail" in photos_e2e
    assert "spark-message-7" in external_open_tests
    assert "Saved from" in photos_e2e
    assert "mail-message-42" in photos_e2e
    assert "taylor@example.test" in photos_e2e
    assert "Source detail" in photo_rail_import_controls
    assert "Import source detail" in photo_rail_import_controls
    assert "importSourceDetail" in photos_view
    assert "importSource:" in api_server
    assert "_photo_import_source_group_summaries" in api_server
    assert "importSourceKind" in types_ts
    assert "CROSSAGE_E2E_FILE_DROP_PATH_FALLBACK" in photos_e2e
    assert "gallery drop stages dropped files for import review" in photos_e2e
    photo_import_session_panel = (root / "src" / "views" / "photoImportSessionPanel.tsx").read_text(encoding="utf-8")
    assert "PhotoImportSessionPanel" in photos_view
    assert "Import details" in photo_import_session_panel
    assert "Open import" in photo_import_session_panel
    assert "Open Recovered" in photo_import_session_panel
    assert "buildPhotoImportSessionSummary" in photos_view
    assert "pendingImportAccessGuidance" in photos_view
    assert "Access note" in photo_pending_import_review_panel
    assert "shareSelectedOriginals" in photos_view
    assert "native_share" in photo_selection_export_results
    assert "native_share_strip_location" in photo_selection_export_results
    assert "photoSelectionExportRowIsStripLocationShareable" in photo_selection_export_results
    assert "allowRenderFallback: false" in photo_export_presets
    assert "revealAfterExport: false" in photo_export_presets
    assert "render_skipped_strip_location" in api_server
    assert "allowRenderFallback" in api_server
    assert "PhotoExportPackagingControls" in photos_view
    assert "Share after export" in photo_export_packaging_controls
    assert "exportShareAfterExport" in photos_view
    assert "Share" in photos_view
    assert "sharePhotoPaths" in app_tsx
    assert "PhotoExportPresetControls" in photos_view
    assert "Project bundle" in photo_export_preset_controls
    assert "applyPhotoProjectBundlePreset" in photos_view
    assert "photoProjectBundlePresetSettings" in photo_export_presets
    assert "includeExistingSidecars: true" in photo_export_presets
    assert "buildPhotoImportAccessGuidance" in photo_import_access
    assert "buildPhotoImportAttributionSummary" in photo_import_access
    assert "sourceDetail" in photo_import_access
    assert "inferLocalMediaSourceAttribution" in desktop_main
    assert "inferLocalMediaSourceSidecarAttribution" in desktop_main
    assert "attributionFromMailText" in desktop_main
    assert "attributionFromWebText" in desktop_main
    assert "_photo_import_source_attribution_from_paths" in workspace_db
    assert "_photo_import_sidecar_attribution" in workspace_db
    assert "sourceDetail" in types_ts
    assert "apple-photos-library-package" in workspace_db
    assert "os-protected-folder" in workspace_db
    assert "Drop photos or folders to import" in photos_view
    assert "Drop photos to import" in photos_view
    assert "PhotoRailImportControls" in photos_view
    assert "photo-album-toolbar" not in photos_view
    assert "Import storage" in photo_rail_import_controls
    assert "Reference originals" in photo_rail_import_controls
    assert "Copy into library" in photo_rail_import_controls
    assert "Suggested sources" in photo_rail_import_controls
    assert "photoImportSourceKindForSystemSource" in photos_view
    assert "photoSources={photoSources}" in app_tsx
    assert "buildSystemPhotoSources" in desktop_main
    assert "mountedCameraPhotoSources" in photo_sources_cjs
    assert "mountedMediaCandidatesForVolume" in photo_sources_cjs
    assert "CAMERA_MEDIA_ROOT_NAMES" in photo_sources_cjs
    assert "VINTRACE_PHOTO_MOUNT_ROOTS" in photo_sources_cjs
    assert "XDG_RUNTIME_DIR" in photo_sources_cjs
    assert "DCIM" in photo_sources_cjs
    assert "PRIVATE" in photo_sources_cjs
    assert "Internal shared storage" in photo_sources_tests
    assert "testMountedPhoneNestedDcimSources" in photo_sources_tests
    photo_import_session_details = (root / "src" / "views" / "photoImportSessionDetails.ts").read_text(encoding="utf-8")
    photo_import_history_toolbar = (root / "src" / "views" / "photoImportHistoryToolbar.tsx").read_text(encoding="utf-8")
    photo_import_provenance_editor = (root / "src" / "views" / "photoImportProvenanceEditor.tsx").read_text(encoding="utf-8")
    assert "buildPhotoImportHistoryState" in photos_view
    assert "photoActiveImportSessionRecord" in photos_view
    assert "photoImportHistoryCountLabel" in photos_view
    assert "photoImportHistoryProvenancePayload" in photos_view
    assert "photoImportHistoryArchivePayload" in photos_view
    photo_import_history_panel = (root / "src" / "views" / "photoImportHistoryPanel.tsx").read_text(encoding="utf-8")
    photo_import_history_list = (root / "src" / "views" / "photoImportHistoryList.tsx").read_text(encoding="utf-8")
    photo_recovered_import_issues_panel = (root / "src" / "views" / "photoRecoveredImportIssuesPanel.tsx").read_text(encoding="utf-8")
    assert "PhotoImportSessionPanel" in photos_view
    assert "PhotoImportHistoryPanel" in photos_view
    assert "PhotoRecoveredImportIssuesPanel" in photos_view
    assert "renderImportHistoryProvenanceEditor" not in photos_view
    assert "PhotoImportHistoryProvenanceEditor" not in photos_view
    assert "PhotoImportHistoryList" not in photos_view
    assert "PhotoImportHistoryToolbar" not in photos_view
    assert "PhotoImportHistoryBulkProvenanceEditor" not in photos_view
    assert "photo-import-session-panel" not in photos_view
    assert "photo-import-history-panel" not in photos_view
    assert "photo-import-history-list" not in photos_view
    assert "photo-recovered-panel" not in photos_view
    assert "buildPhotoImportSessionSummaries" in photo_import_session_details
    assert "filterPhotoImportSessionSummaries" in photo_import_session_details
    assert "buildPhotoImportHistoryState" in photo_import_session_details
    assert "photoActiveImportSessionRecord" in photo_import_session_details
    assert "photoImportHistoryCountLabel" in photo_import_session_details
    assert "photoImportHistoryProvenanceEditDraft" in photo_import_session_details
    assert "photoImportHistoryProvenancePayload" in photo_import_session_details
    assert "photoImportHistoryBulkProvenancePayload" in photo_import_session_details
    assert "photoImportHistoryArchivePayload" in photo_import_session_details
    assert "Search import history" in photo_import_history_toolbar
    assert "Import history filters" in photo_import_history_toolbar
    assert "activeFolder?.importSessions" in photo_import_session_details
    assert 'activeId.startsWith("import:")' in photo_import_session_details
    assert "Source label is required." in photo_import_session_details
    assert "Archived from import history" in photo_import_session_details
    assert "export function PhotoImportSessionPanel" in photo_import_session_panel
    assert "photo-import-session-panel" in photo_import_session_panel
    assert "PhotoImportHistoryProvenanceEditor" in photo_import_session_panel
    assert "Restore import" in photo_import_session_panel
    assert "export function PhotoImportHistoryPanel" in photo_import_history_panel
    assert "Import history" in photo_import_history_panel
    assert "PhotoImportHistoryList" in photo_import_history_panel
    assert "PhotoImportHistoryToolbar" in photo_import_history_panel
    assert "PhotoImportHistoryBulkProvenanceEditor" in photo_import_history_panel
    assert "photo-import-history-panel" in photo_import_history_panel
    assert "export function PhotoImportHistoryList" in photo_import_history_list
    assert "photo-import-history-list" in photo_import_history_list
    assert "photo-import-history-empty" in photo_import_history_list
    assert "No matching imports" in photo_import_history_list
    assert "PhotoImportHistoryProvenanceEditor" in photo_import_history_list
    assert "export function PhotoRecoveredImportIssuesPanel" in photo_recovered_import_issues_panel
    assert "photo-recovered-panel" in photo_recovered_import_issues_panel
    assert "photo-recovered-list" in photo_recovered_import_issues_panel
    assert "Recovered import issues" in photo_recovered_import_issues_panel
    assert "buildPhotoImportSessionSummary(session" in photo_recovered_import_issues_panel
    assert "photo-import-history-controls" in photo_import_history_toolbar
    assert "Import history filters" in photo_import_history_toolbar
    assert "Archive matches" in photo_import_history_toolbar
    assert "Set source for matches" in photo_import_history_toolbar
    assert "props.sourceOptions.map" in photo_import_history_toolbar
    assert "photo-import-provenance-editor" in photo_import_provenance_editor
    assert "PHOTO_IMPORT_SOURCE_OPTIONS.map" in photo_import_provenance_editor
    assert "Edit import source kind" in photo_import_provenance_editor
    assert "Bulk import source kind" in photo_import_provenance_editor
    assert "importSessions" in types_ts
    assert "Photos settings" in photos_view
    assert "PHOTO_LOCAL_SETTINGS_KEY" in photos_view
    assert "localSettingsPersisted" in photos_view
    assert "applyWorkspacePhotoLocalSettings" in photos_view
    assert "savePhotoLibrarySettings({ localSettings: next })" in photos_view
    assert "railPreferences" in photos_view
    assert "storeLegacyPhotoRailPreferences" in photos_view
    assert "normalizePhotoLocalSettingsWithLegacyRail" in photos_view
    assert "_clean_photo_rail_preferences" in workspace_db
    assert "PhotoPrivacySettingsPanel" in photos_view
    assert "Referenced-file warnings" not in photos_view
    assert "Referenced-file warnings" in photo_privacy_settings_panel
    assert "Strip location by default" not in photos_view
    assert "Strip location by default" in photo_privacy_settings_panel
    assert "Lock sensitive collections" not in photos_view
    assert "Lock sensitive collections" in photo_privacy_settings_panel
    assert "Sensitive session lock" not in photos_view
    assert "Sensitive session lock" in photo_privacy_settings_panel
    assert "sensitiveSessionTimerRef" in photos_view
    assert "sensitiveSessionLockMinutes" in photos_view
    assert "Use device authentication" not in photos_view
    assert "Use device authentication" in photo_privacy_settings_panel
    assert "PhotoSensitiveLockPanel" in photos_view
    assert "photo-sensitive-lock" not in photos_view
    assert "photo-sensitive-lock" in photo_sensitive_lock_panel
    assert "Unlock with" in photo_sensitive_lock_panel
    assert "Hide sensitive" in photo_sensitive_lock_panel
    assert "Sensitive passcode" in photos_view
    assert "Sensitive passcode" in photo_privacy_settings_panel
    assert "Creator / credit" in photos_view
    assert "IPTC location" in photos_view
    assert "Pet model recognition" not in photos_view
    assert "Pet model recognition" in photo_intelligence_settings_panel
    assert "petRecognitionStatus" in types_ts
    assert "Set passcode" not in photos_view
    assert "Set passcode" in photo_privacy_settings_panel
    assert "Passcode did not match" in photos_view
    assert "PhotoMediaPlaybackSettingsPanel" in photos_view
    assert "Video autoplay" not in photos_view
    assert "Video autoplay" in photo_media_playback_settings_panel
    assert "Pause video when backgrounded" not in photos_view
    assert "Pause video when backgrounded" in photo_media_playback_settings_panel
    assert "pauseVideoWhenBackgrounded" in photos_view
    assert "HDR viewing" not in photos_view
    assert "HDR viewing" in photo_media_playback_settings_panel
    assert "PhotoIntelligenceSettingsPanel" in photos_view
    assert "No-network intelligence" in photo_intelligence_settings_panel
    assert "Model/source disclosure" in photo_intelligence_settings_panel
    assert "photoCurationPreferences" in photos_view
    assert "savePhotoCurationPreferences" in photos_view
    assert "Feature less" in photo_curation_preferences_panel
    assert "Feature less" in photo_lightbox_curation_actions
    assert "Reset Memory feedback" not in photos_view
    assert "Reset Memory feedback" in photo_curation_preferences_panel
    assert "resetPhotoMemoryFeedbackPreferences" in photos_view
    assert "clearPhotoMemoryPreferences" in photos_view
    assert "photoMemoryFeedbackTotal" in photos_view
    assert "loadPhotoOperations" in photos_view
    assert "Feature memory less" in photos_view
    assert "Remove from memory" in photos_view
    assert "Reset removed" in photos_view
    assert "userMemorySource" in photos_view
    assert "Create memory from album" in photos_view
    assert "Create memory from search" in photos_view
    assert "Create memory from person" in photos_view
    assert "Create memory from place" in photos_view
    assert "Create memory from date" in photos_view
    assert "Memory details" in photos_view
    assert "Memory title" in photos_view
    assert "Memory subtitle" in photos_view
    assert "Save memory details" in photos_view
    assert "saveActiveUserMemoryDetails" in photos_view
    assert "buildPhotoLiveTextRegions" in photos_view
    assert "PhotoLightboxStage" in photos_view
    assert "photos-live-text-region-layer" not in photos_view
    assert "photos-live-text-region-layer" in photo_lightbox_stage
    assert "photoLiveTextRegionStageBox" in photos_view
    assert "Create memory" in photos_view
    assert "Delete memory" in photos_view
    assert "Export memory movie" in photos_view
    assert "exportPhotoMemoryMovie" in photos_view
    assert "Use as memory cover" in photos_view
    assert "Custom Memory" in photos_view
    assert "setUserMemoryCover" in photos_view
    assert "saveCurrentSortAsUserMemoryOrder" in photos_view
    assert "reorderSelectedUserMemory" in photos_view
    assert "reorderDraggedUserMemory" in photos_view
    assert "userMemoryCanDragReorder" in photos_view
    assert "savePhotoUserMemory" in photos_view
    assert "deletePhotoUserMemory" in photos_view
    assert "photoUserMemories" in photos_view
    assert "PhotoCurationPreferencesPanel" in photos_view
    assert "photo-curation-preferences" not in photos_view
    assert "photo-curation-preferences" in photo_curation_preferences_panel
    assert "Favorite memories" in photo_curation_preferences_panel
    assert "Removed from memories" in photo_curation_preferences_panel
    assert "photo-memory-actions" in photos_view
    assert "buildPhotoFeatureLessSuggestions" in photos_view
    assert "buildPhotoMemoryFeatureLessSuggestions" in photos_view
    assert "toggleMemoryFeatureLessSuggestion" in photos_view
    assert "Feature Birthday less" in photos_view or "suggestion.actionLabel" in photos_view
    assert "addPhotoMemoryRemovedItems" in photo_curation_preferences
    assert "photo_curation_preferences" in api_server
    assert "save_photo_curation_preferences" in api_server
    assert "photo_user_memories" in api_server
    assert "save_photo_user_memory" in api_server
    assert "delete_photo_user_memory" in api_server
    assert "export_photo_memory_movie" in api_server
    assert "photo_curation_preferences" in workspace_db
    assert "photo_user_memories" in workspace_db
    assert '"utility:landmarks"' in api_server
    assert "Landmarks & POI" in api_server
    assert "pointsOfInterest" in api_server
    assert "locationOverride" in api_server
    assert "_photo_xmp_sidecar_metadata" in workspace_db
    assert "gpslatitude" in workspace_db
    assert "hierarchicalsubject" in workspace_db
    assert "sidecarPath" in workspace_db
    assert "_photo_live_photo_pair_metadata" in workspace_db
    assert "_copy_managed_live_photo_pair" in workspace_db
    assert "_copy_managed_photo_related_companions" in workspace_db
    assert "livePhoto" in workspace_db
    assert "pairedMotionCopiedCount" in workspace_db
    assert "relatedMediaCopiedCount" in workspace_db
    assert "managed-related-media-copied" in workspace_db
    assert "managed-live-photo-motion-copied" in workspace_db
    assert "originalPairedVideoPath" in workspace_db
    assert "export_photo_live_motion" in api_server
    assert "export_photo_subject_cutout" in api_server
    assert "edge-background-plus-center-mask-v1" in api_server
    assert "loop_gif" in api_server
    assert "bounce_gif" in api_server
    assert "_photo_live_motion_gif_frames" in api_server
    assert "set_photo_live_key_photo" in api_server
    assert "reset_photo_live_key_photo" in api_server
    assert "keyPhotoPreviewPath" in api_server
    assert "pairedVideoUrl" in desktop_main
    assert "visibleImportWarnings" in photos_view
    assert "data-hdr-viewing" not in photos_view
    assert "data-hdr-viewing" in photo_lightbox_stage
    assert "shouldAutoplayPhotoVideo" in photos_view
    photo_settings = (root / "src" / "views" / "photoSettings.ts").read_text(encoding="utf-8")
    assert "normalizePhotoLocalSettings" in photo_settings
    assert "sensitiveSessionLockMinutes" in photo_settings
    assert "pauseVideoWhenBackgrounded" in photo_settings
    assert "mediaSettingsByLibraryRoot" in photo_settings
    assert "photoEffectiveMediaSettings" in photo_settings
    assert "photoMediaSettingsOverridePatch" in photo_settings
    assert "shouldMuteAutoplayPhotoVideo" in photo_settings
    assert "createPhotoSensitivePasscodeRecord" in photo_settings
    assert "verifyPhotoSensitivePasscode" in photo_settings
    photo_info_metadata = (root / "src" / "views" / "photoInfoMetadata.ts").read_text(encoding="utf-8")
    assert "iptcCreator" in photo_info_metadata
    assert "IPTC_RIGHTS_PATHS" in photo_info_metadata
    styles_css = (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "photo-settings-panel" in styles_css
    assert "photo-settings-library-media" in styles_css
    assert "PhotoLibraryMediaDefaultsPanel" in photos_view
    assert "photo-settings-library-media" not in photos_view
    assert "photo-settings-library-media" in photo_library_media_defaults_panel
    assert "Library media defaults" in photo_library_media_defaults_panel
    assert "Reset media defaults" in photo_library_media_defaults_panel
    assert "resetPhotoLibraryMediaSettings" in photos_view
    assert "managedRootRenameDrafts" in photos_view
    assert "renameManagedPhotoRootProfile" in photos_view
    assert "importFailureDetails" in photos_view
    assert "Import issues" in photo_import_status_alerts
    assert "retryPhotoImportFailure" in photos_view
    assert "Retry import" in photo_recovered_import_issues_panel
    assert "scanPhotoRecoveredOrphans" in photos_view
    assert "photoRecoveredCleanup" in photos_view
    assert "libraryRoot" in photos_view
    assert "PhotoManagedRootsPanel" in photos_view
    assert "Managed root health" not in photos_view
    assert "Check root" not in photos_view
    assert "Managed root health" in photo_managed_roots_panel
    assert "Check root" in photo_managed_roots_panel
    assert "Preview cleanup" in photo_recovered_import_issues_panel
    assert "Clean stale" in photo_recovered_import_issues_panel
    assert "Purge old files" in photo_recovered_import_issues_panel
    assert "deleteRecoveredFiles" in photos_view
    assert "Recovered source" in photo_recovered_import_issues_panel
    assert "Scan orphans" in photo_recovered_import_issues_panel
    assert "Preview orphans" in photo_recovered_import_issues_panel
    assert "Preview found" in photos_view
    assert "dryRun" in photos_view
    assert "Mail from qa@example.test" in photos_e2e
    assert "Photos Recovered previews scans and saves managed-root orphans" in photos_e2e
    assert "rebuildPhotoPreviews" in photos_view
    assert "Rebuild previews" in photo_load_status_alerts_panel
    assert "photoLibraryBackupCheck" in photos_view
    assert "PhotoBackupCheckPanel" in photos_view
    assert "photo-backup-check-panel" not in photos_view
    assert "Backup readiness" in photo_backup_check_panel
    assert "Backup check" in photo_backup_check_panel
    assert "No backup check run yet." in photo_backup_check_panel
    assert "Managed root profiles" in (root / "src" / "views" / "photoRepairCenter.ts").read_text(encoding="utf-8")
    assert "buildPhotoManagedRootProfileRows" in photos_view
    assert "photo-managed-root-profile-details" in styles_css
    assert "managedRootProfileIssues" in api_server
    assert "managedAssetsOutsideProfiles" in api_server
    assert "Needs repair" in photo_repair_center_panel
    assert "buildPhotoRepairIssues" in photos_view
    assert "PhotoRepairCenterSection" in photos_view
    assert "PhotoRepairCenterActions" in photo_repair_center_section
    assert "PhotoRepairCenterSummary" in photo_repair_center_section
    assert "Repair center" in photo_repair_center_panel
    assert "Repair scan" in photo_repair_center_panel
    assert "No repair scan run yet." in photo_repair_center_panel
    assert "photoReviewMoreCandidateReasons" in photo_group_review
    assert "Review More minimum score" in photos_view
    assert "photos-review-more-threshold" in styles_css
    assert "handlePhotoRepairIssueAction" in photos_view
    assert "rebuildMissingPhotoPreviews" in photos_view
    assert "PhotoRepairIssueList" in photo_repair_center_section
    assert "photo-repair-issue-scope" in photo_repair_issue_list
    assert "photoRepairIssueActionLabel" in photo_repair_issue_list
    assert "PhotoCatalogCleanupPreviewPanel" in photo_repair_center_section
    assert "Catalog cleanup preview" in photo_catalog_cleanup_preview_panel
    assert "Apply cleanup" in photo_catalog_cleanup_preview_panel
    assert "photoRepairHistory" in photos_view
    assert "PhotoRepairHistoryList" in photo_repair_center_section
    assert "Recent repair history" in photo_repair_history_list
    assert "photoRepairHistoryEventDetails" in photo_repair_history_list
    assert "buildPhotoConsolidationHistoryRows" in photos_view
    assert "PhotoConsolidationHistoryPanel" in photos_view
    assert "Recent consolidations" not in photos_view
    assert "Recent consolidations" in photo_consolidation_panels
    assert "photo-consolidation-history" in styles_css
    assert "photo-repair-history-details" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "managedRootLabel" in api_server
    assert "photo-repair-center" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "photo-repair-history-row" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "PhotoImportStatusAlerts" in photos_view
    assert "photo-import-failures" not in photos_view
    assert "photo-import-failures" in photo_import_status_alerts
    assert "Not in Album" in photos_view
    assert "photo-import-warning" not in photos_view
    assert "photo-import-warning" in photo_import_status_alerts
    assert "Album folder name" in photo_album_folder_editor
    assert "PhotoAlbumFolderEditor" in photos_view
    assert "Parent folder" in photo_album_folder_editor
    assert "Save folder" in photo_album_folder_editor
    assert "PhotoRailLoadErrors" in photos_view
    assert "props.errors.map" in photo_rail_load_errors
    assert "Merge into album" in photos_view
    assert "Delete folder" in photos_view
    assert "Collapse folder" in photos_view
    assert "Move collection up" in photos_view
    assert "Move collection down" in photos_view
    assert "onDragStart" in photos_view
    assert "planPhotoRailAlbumTreeDrop" in photos_view
    assert "PhotoAlbumsGallery" in photos_view
    assert "albums-gallery" not in photos_view
    assert "albums-gallery" in photo_albums_gallery
    assert "album-folder-card" not in photos_view
    assert "album-folder-card" in photo_albums_gallery
    assert "Album folder path" not in photos_view
    assert "Album folder path" in photo_albums_gallery
    assert "Create your first album" not in photos_view
    assert "Create your first album" in photo_albums_gallery
    assert "PhotoMemoriesFeed" in photos_view
    assert "memories-feed" not in photos_view
    assert "memories-feed" in photo_memories_feed
    assert "Memories appear here" not in photos_view
    assert "Memories appear here" in photo_memories_feed
    assert "Featured memory" not in photos_view
    assert "Featured memory" in photo_memories_feed
    assert "PhotoAlbumEditorPanel" in photos_view
    assert "Album type" not in photos_view
    assert "Album type" in photo_album_editor_panel
    assert "Visual query" in photo_album_editor_panel
    assert "renderSmartQueryGroup" in photo_album_editor_panel
    assert "Could not load folders" in photos_view
    assert "PhotoLoadStatusAlertsPanel" in photos_view
    assert "Could not load photos" in photo_load_status_alerts_panel
    assert "Could not generate every preview" in photo_load_status_alerts_panel
    assert "Retry photos" in photo_load_status_alerts_panel
    assert "Add to album" in photo_selection_bulk_metadata_controls
    assert "Remove from album" in photos_view
    assert "Album membership" in photos_view
    assert "Album membership filter" in photos_view
    assert "Album membership sort" in photos_view
    assert "All albums" in photos_view
    assert "Manual albums" in photos_view
    assert "Smart matches" in photos_view
    assert "Related media" in photos_view
    assert "photoMediaPairKindLabel" in photos_view
    workspace_db = (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    photo_media_pairs = (root / "src" / "views" / "photoMediaPairs.ts").read_text(encoding="utf-8")
    assert "photo_media_pairs_for_assets" in workspace_db
    assert "metadata_sidecar" in workspace_db
    assert "edit_sidecar" in workspace_db
    assert "Metadata sidecar" in photo_media_pairs
    assert "Edit sidecar" in photo_media_pairs
    assert "mediaPairs?: PhotoMediaPair[]" in (root / "src" / "types.ts").read_text(encoding="utf-8")
    assert "Manual first" in photos_view
    assert "No matching memberships" in photos_view
    assert "visiblePhotoAlbumMemberships" in photos_view
    assert "photoAlbumMembershipFilterCounts" in photos_view
    assert "photos-album-membership-controls" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "Smart match" in photos_view
    assert "Read-only" in photos_view
    assert "Not in any album" in photos_view
    assert "Add current photo" in photos_view
    assert "Add current photo to album" in photos_view
    assert "Custom order" in photos_view
    assert "Title" in photos_view
    assert "Media kind" in photos_view
    assert "Search text" not in photos_view
    assert "Keyword rule" not in photos_view
    assert "Title, caption, person, path" not in photos_view
    assert "Exact keyword" not in photos_view
    assert "Favorites only" not in photos_view
    assert "Edited only" not in photos_view
    assert "Search text" in photo_album_editor_panel
    assert "Keyword rule" in photo_album_editor_panel
    assert "Title, caption, person, path" in photo_album_editor_panel
    assert "Exact keyword" in photo_album_editor_panel
    assert "Favorites only" in photo_album_editor_panel
    assert "Edited only" in photo_album_editor_panel
    assert "PhotoSelectionOrderControls" in photos_view
    assert "Move earlier" in photo_selection_order_controls
    assert "Move later" in photo_selection_order_controls
    assert "manualAlbumCanDragReorder" in photos_view
    assert "photoAlbumSourceOrder" in photos_view
    assert "photoUserMemorySourceOrder" in photos_view
    assert "SORTED_SOURCE_ORDER_PAGE_LIMIT" in photos_view
    assert "loadManualAlbumSourceOrder" in photos_view
    assert "Could not load the full album order" in photos_view
    assert "photoTileDropPlacement" in photos_view
    assert "reorderDraggedManualAlbum" in photos_view
    assert "customCollectionCanDragReorder" in photos_view
    assert "canDragReorder={customCollectionCanDragReorder}" in photos_view
    assert "draggable={props.canDragReorder}" in photo_grid_tile
    assert "PhotoVirtualGridPanel" in photos_view
    assert "dropPlacement={dropPlacement}" not in photos_view
    assert "dropPlacement={dropPlacement}" in photo_virtual_grid_panel
    assert "drop-${props.dropPlacement}" in photo_grid_tile
    assert "Adjusted date" in photos_view
    assert "Hide location" in photos_view
    assert "Keyword filter" in photos_view
    assert "Keyword filters" in photos_view
    assert "buildPhotoKeywordFilterOptions" in keyword_filters
    assert "photo-keyword-filter-strip" in styles_css
    assert "Media filter" in photos_view
    assert "Clear filters" in photos_view
    assert "PhotoActiveFilterChips" in photos_view
    assert "photo-active-filter-chips" not in photos_view
    assert "Active filters" in photo_active_filter_chips
    assert "Remove filter" in photo_active_filter_chips
    assert "Clear all" in photo_active_filter_chips
    assert "Save filter" in photo_active_filter_chips
    assert "Save search" in photo_active_filter_chips
    assert "PhotoSavedFiltersRailSection" in photos_view
    assert "Saved Filters" in photo_saved_filters_rail_section
    assert "Delete saved filter" in photo_saved_filters_rail_section
    assert "Pin saved filter" in photo_saved_filters_rail_section
    assert "Unpin saved filter" in photo_saved_filters_rail_section
    assert "Move saved filter up" in photo_saved_filters_rail_section
    assert "Move saved filter down" in photo_saved_filters_rail_section
    assert "photo-saved-filter-actions" in photo_saved_filters_rail_section
    assert "photo-saved-filter-snippet" in photo_saved_filters_rail_section
    assert "previewSamples" in photo_saved_filters_rail_section
    assert "ruleSummary" in photo_saved_filters_rail_section
    assert "Could not sync saved filters" in photos_view
    assert "listPhotoSavedFilters" in photos_view
    assert "savePhotoSavedFilter" in photos_view
    assert "deletePhotoSavedFilter" in photos_view
    assert "buildPhotoSavedSearchDraft" in photos_view
    assert "buildPhotoSavedFilter" in photos_view
    assert "normalizePhotoSavedFilterList" in photos_view
    assert "normalizePhotoSavedFilterRecord" in photos_view
    assert "Delete permanently" in photos_view
    assert "PhotoSelectionVisibilityControls" in photos_view
    assert "photo-retention-control" in photo_selection_visibility_controls
    assert "Retention days" in photo_selection_visibility_controls
    assert "Delete older" in photo_selection_visibility_controls
    assert "Restore" in photo_selection_visibility_controls
    assert "Hide" in photo_selection_visibility_controls
    assert "confirmPhotoAction" in photos_view
    assert "photos-confirm-backdrop" in photos_view
    assert "Delete older photos" in photos_view
    assert "Photos Recently Deleted permanent delete and lightbox restore stay recoverable" in photos_e2e
    assert "catalog_permanent_delete" in photos_e2e
    assert "Permanently deleted 1 photo from catalog" in photos_e2e
    assert "window.confirm" not in photos_view
    assert "photo-context-menu" in photos_view
    assert "handlePhotoGridTileContextMenu" in photos_view
    assert 'setPhotoContextMenu({ kind: "photo"' in photos_view
    assert "Photo actions" in photo_virtual_grid_panel
    assert "Collection actions" in photos_view
    assert "Saved filter actions" in photo_saved_filters_rail_section
    assert "PhotoLightboxZoomControls" in photos_view
    assert "Zoom photos" not in photos_view
    assert "Zoom photos" in photo_lightbox_zoom_controls
    assert "Reset zoom" not in photos_view
    assert "Reset zoom" in photo_lightbox_zoom_controls
    assert "PhotoLightboxPrimaryActions" in photos_view
    assert "photos-subject-cutout-actions" not in photos_view
    assert "photos-subject-cutout-actions" in photo_lightbox_primary_actions
    assert "Export subject cutout PNG" not in photos_view
    assert "Export subject cutout PNG" in photo_lightbox_primary_actions
    assert "Copy subject cutout PNG" not in photos_view
    assert "Copy subject cutout PNG" in photo_lightbox_primary_actions
    assert "PhotoLightboxFileActions" in photos_view
    assert "photos-lightbox-file-actions" not in photos_view
    assert "photos-lightbox-file-actions" in photo_lightbox_file_actions
    assert "PhotoLightboxCurationActions" in photos_view
    assert "photos-lightbox-curation-actions" not in photos_view
    assert "photos-lightbox-curation-actions" in photo_lightbox_curation_actions
    assert "PhotoLightboxSafetyActions" in photos_view
    assert "photos-lightbox-safety-actions" not in photos_view
    assert "photos-lightbox-safety-actions" in photo_lightbox_safety_actions
    assert "lightboxPinchRef" in photos_view
    assert "beginLightboxPinch" in photos_view
    assert "session.lightboxZoom" in photo_lightbox_session
    assert "toggleLightboxFullscreen" in photos_view
    assert "photos-lightbox-video fill" not in photos_view
    assert "photos-lightbox-video fill" in photo_lightbox_stage
    assert 'uiText("Fullscreen")' not in photos_view
    assert 'uiText("Fullscreen")' in photo_lightbox_zoom_controls
    assert "Revert date" in photos_view
    assert "restoredPhotoCaptureDate" in photo_info_draft
    assert "PhotoKeywordManagerPanel" in photos_view
    assert "photos-keyword-panel" not in photos_view
    assert "Keyword manager" in photo_keyword_manager_panel
    assert "photos-keyword-panel" in photo_keyword_manager_panel
    assert "Keyword import JSON" in photo_keyword_manager_panel
    assert "PhotoPetReviewKindChips" in photos_view
    assert "photo-pet-review-kind-chips" not in photos_view
    assert "photo-pet-review-kind-chips" in photo_pet_review_kind_chips
    assert "Pet Review kind filters" in photo_pet_review_kind_chips
    assert "All pets" in photo_pet_review_kind_chips
    assert "Create keyword" in photo_keyword_manager_panel
    assert "Add keywords" in photo_selection_bulk_metadata_controls
    assert "Remove keywords" in photo_selection_bulk_metadata_controls
    assert "Export keywords" in photo_keyword_manager_panel
    assert "Import keywords" in photo_keyword_manager_panel
    assert "Keyword import JSON" in photo_keyword_manager_panel
    assert "PhotoSelectionReviewActions" in photos_view
    assert "Merge groups" in photos_view
    assert "Merge groups" in photo_selection_review_actions
    assert "Dismiss groups" in photo_selection_review_actions
    assert "Keep this" in photos_view
    assert "Recommended keep" in photos_view
    assert "Duplicate group" in photos_view
    assert "PhotoPlaceMapPanel" in photos_view
    assert "Places map" in place_map_panel
    assert "Nearby places" in place_map_panel
    assert "buildPhotoPlaceMapPoints" in photos_view
    assert "buildPhotoPlaceMapClusters" in photos_view
    assert "buildPhotoPlaceMapDensityCells" in photos_view
    assert "photo-place-map-panel" not in photos_view
    assert "photo-place-map-mode-control" in place_map_panel
    assert "photo-place-map-density" in place_map_panel
    assert "photo-place-map-areas" in place_map_panel
    assert "Map areas" in place_map_panel
    assert "photo-place-map-radius-places" in place_map_panel
    assert "Places in radius" in place_map_panel
    assert "nearbyPhotoPlacesWithinRadius" in places_map
    assert "photo places map radius results sort by distance and obey radius" in photo_tests
    assert "Places map supports modes zoom and nearby navigation" in photos_e2e
    assert "Photos compact Places map supports modes radius results and density areas" in photos_e2e
    assert "Density" in place_map_panel
    assert "PHOTO_NEARBY_RADIUS_OPTIONS" in photos_view
    assert "setNearbyRadius" in photos_view
    assert "photoNearbyFilterFromSavedFilterState" in photos_view
    assert "Nearby radius" in photo_active_filter_chips
    assert "photo-nearby-radius-control" in photo_active_filter_chips
    assert "has-cover" in place_map_panel
    assert "clustered" in place_map_panel
    assert "photo-place-map-controls" in place_map_panel
    assert "photo-place-map-zoom" in place_map_panel
    assert "Open clustered places near" in place_map_panel
    assert "Export options" in photo_selection_primary_actions
    assert "PhotoExportPresetControls" in photos_view
    assert "Export preset" in photo_export_preset_controls
    assert "Custom export" in photo_export_preset_controls
    assert "Preset name" in photo_export_preset_controls
    assert "Save preset" in photo_export_preset_controls
    assert "Apply preset" in photo_export_preset_controls
    assert "Project bundle" in photo_export_preset_controls
    assert "Creation presets" in photo_export_preset_controls
    assert "Creation suggestions" in photo_export_preset_controls
    assert "Full view suggestions" in photo_export_preset_controls
    assert "Library suggestions" in photo_export_preset_controls
    assert "Delete preset" in photo_export_preset_controls
    assert "photoExportPresets" in photos_view
    assert "PHOTO_EXPORT_PRESETS_KEY" in photos_view
    assert "photo-export-presets" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    photo_export_presets = (root / "src" / "views" / "photoExportPresets.ts").read_text(encoding="utf-8")
    assert "normalizePhotoExportPresetSettings" in photo_export_presets
    assert "upsertPhotoExportPreset" in photo_export_presets
    assert "deletePhotoExportPreset" in photo_export_presets
    assert "PhotoSelectionPrimaryActions" in photos_view
    assert "PhotoSelectionSummaryControls" in photos_view
    assert "Clear page" in photo_selection_summary_controls
    assert "Select page" in photo_selection_summary_controls
    assert "count-roll" in photo_selection_summary_controls
    assert "Contact sheet" in photo_selection_primary_actions
    assert "Print sheet" in photo_selection_primary_actions
    assert "Export options" in photo_selection_primary_actions
    assert "Remove from memory" in photo_selection_primary_actions
    assert "PhotoSelectionOriginalActions" in photos_view
    assert "Print original" in photos_view
    assert "Print original" in photo_selection_original_actions
    assert "printSelectedOriginal" in photos_view
    assert "printPath(item.sourcePath)" in photos_view
    assert "contactSheetPrintTarget" in photos_view
    assert "PhotoExportContactSheetControls" in photos_view
    assert "Contact format" in photo_export_contact_sheet_controls
    assert "Contact title" in photo_export_contact_sheet_controls
    assert "Page size" in photo_export_contact_sheet_controls
    assert "Print layout" in photo_export_contact_sheet_controls
    assert "contactSheetLayout" in photos_view
    assert "layoutPreset: contactSheetLayout" in photos_view
    assert "Contact captions" in photo_export_contact_sheet_controls
    assert "Caption details" in photo_export_contact_sheet_controls
    assert "Contact sheet columns" in photo_export_contact_sheet_controls
    assert "Contact sheet thumbnail size" in photo_export_contact_sheet_controls
    assert "PhotoContactSheetLayoutPreset" in photo_export_presets
    assert "PhotoExportRenderControls" in photos_view
    assert "Export kind" in photo_export_render_controls
    assert "Rendered file" in photo_export_render_controls
    assert "Render format" in photo_export_render_controls
    assert "Render quality" in photo_export_render_controls
    assert "Render max edge" in photo_export_render_controls
    assert "Target profile" in photo_export_render_controls
    assert '<option value="display-p3">' in photo_export_render_controls
    assert '<option value="adobe-rgb">' in photo_export_render_controls
    assert '<option value="custom-icc">' in photo_export_render_controls
    assert "Choose ICC" in photo_export_render_controls
    assert "photoExportColorProfileValidationStatus" in photos_view
    assert "photoExportColorProfileStatusState" in photos_view
    assert "Profile ready" in photo_export_presets
    assert "Profile check failed" in photo_export_presets
    assert "Profile availability check failed" in photo_export_presets
    assert "Profile available" in photo_export_presets
    assert "Profile unavailable" in photo_export_presets
    assert "photo-export-profile-preflight" in photo_export_render_controls
    assert "photo_color_profile_status" in api_server
    assert "_cmd_photo_color_profile_status" in api_server
    assert '"display-p3", "adobe-rgb", "custom-icc"' in photo_export_presets
    assert '"display-p3": "display-p3"' in api_server
    assert '"adobe-rgb": "adobe-rgb"' in api_server
    assert '"custom-icc": "custom-icc"' in api_server
    assert "targetColorProfilePath" in api_server
    assert "CROSSAGE_PHOTO_COLOR_PROFILE_ROOTS" in api_server
    assert "VINTRACE_PHOTO_COLOR_PROFILE_ROOTS" in api_server
    assert "_photo_export_named_profile_candidates" in api_server
    assert "validate_photo_color_profile" in api_server
    assert "PhotoExportVideoControls" in photos_view
    assert "Video format" in photo_export_video_controls
    assert "videoRenderFormat" in photos_view
    assert '<option value="webm">' in photo_export_video_controls
    assert '<option value="hevc">' in photo_export_video_controls
    assert '<option value="prores">' in photo_export_video_controls
    assert '"mp4" | "mov" | "m4v" | "webm" | "hevc" | "prores"' in photo_export_presets
    assert '["mp4", "mov", "m4v", "webm", "hevc", "prores"]' in photo_export_presets
    assert '"webm"' in types_ts
    assert '"hevc"' in types_ts
    assert '"prores"' in types_ts
    assert "libvpx-vp9" in api_server
    assert "libopus" in api_server
    assert "libx265" in api_server
    assert "prores_ks" in api_server
    assert '"-map_metadata", "-1", "-map_chapters", "-1", "-dn"' in api_server
    assert "strip_metadata=bool(strip_location)" in api_server
    assert "Photo rendered video export format must be mp4, mov, m4v, webm, hevc, or prores." in api_server
    assert 'video_render_format="webm"' in photo_folders
    assert 'video_render_format="hevc"' in photo_folders
    assert 'video_render_format="prores"' in photo_folders
    assert '"videoRenderFormat": "webm"' in photo_folders
    assert '("hevc", "medium", ".mp4", "libx265", "aac")' in photo_folders
    assert '("prores", "high", ".mov", "prores_ks", "pcm_s16le")' in photo_folders
    assert "test_photo_rendered_video_export_real_codec_matrix_when_ffmpeg_available" in photo_folders
    assert "test_photo_rendered_video_export_applies_saved_edit_stack" in photo_folders
    assert "Photos saved video edit stack applies to rendered selection export" in photos_e2e
    assert "Video trim timeline" in photos_e2e
    assert "Video trim start handle" in photos_e2e
    assert "rendered_video_edit" in photo_folders
    assert "privacy_rendered" in photo_folders
    assert '"-map_metadata" in privacy_args' in photo_folders
    assert "videoTrimStartMs" in photo_folders
    assert '"video: hevc"' in photo_folders
    assert '"video: prores"' in photo_folders
    assert "exportPhotoVideoFrame" in photos_view
    assert "PhotoLightboxVideoActionBar" in photos_view
    assert "Export frame" not in photos_view
    assert "Export frame" in photo_lightbox_video_action_bar
    assert "Export poster" not in photos_view
    assert "Export poster" in photo_lightbox_video_action_bar
    assert "Export saved video poster frame" not in photos_view
    assert "Export saved video poster frame" in photo_lightbox_video_action_bar
    assert "exportPhotoVideoTrim" in photos_view
    assert "Export trim" in photo_lightbox_video_action_bar
    assert "Mark start" in photo_lightbox_video_action_bar
    assert "Mark end" in photo_lightbox_video_action_bar
    assert "Rotate video export" not in photos_view
    assert "Rotate video export" in photo_lightbox_video_action_bar
    assert "Video crop aspect" not in photos_view
    assert "Video crop aspect" in photo_lightbox_video_action_bar
    assert "videoRotateDegrees" in photos_view
    assert "videoCropAspect" in photos_view
    assert "rendered_video_edit" in photo_selection_export_results
    assert '"rendered_video", "rendered_video_edit"' in photo_selection_export_results
    assert "Video trim" in photo_lightbox_video_action_bar
    assert "Video transform" in photo_selection_export_results
    assert "videoRotateDegrees" in types_ts
    assert "videoCropAspect" in types_ts
    assert "videoTrimStartMs" in types_ts
    assert "videoTransformApplied" in types_ts
    assert "posterFrameReused" in types_ts
    assert "PhotoEditStackValue" in types_ts
    assert "savePhotoEditStack" in photos_view
    assert "Save video edit stack" in photos_view
    assert "Save image edit stack" in photos_view
    assert "Compare original and edited photo" in photos_view
    assert "Show original" in photos_view
    assert "Show edit" in photos_view
    assert "Image crop aspect" in photos_view
    assert "PHOTO_IMAGE_CROP_ASPECT_OPTIONS" in photos_view
    assert "nextPhotoImageCropAspect" in photos_view
    assert "photoImageCropAspectLabel" in photos_view
    assert "Use manual crop box" in photos_view
    assert "Manual crop left" in photos_view
    assert "Manual crop top" in photos_view
    assert "Manual crop width" in photos_view
    assert "Manual crop height" in photos_view
    assert "photoManualCropBoxActive" in photos_view
    assert "photoManualCropHitTest" in photos_view
    assert "photoManualCropBoxFromDrag" in photos_view
    assert "beginImageManualCropOverlayDrag" in photos_view
    assert "photos-edit-crop-overlay" not in photos_view
    assert "photos-edit-crop-overlay" in photo_lightbox_stage
    assert "photos-edit-crop-overlay-layer" not in photos_view
    assert "photos-edit-crop-overlay-layer" in photo_lightbox_stage
    assert "crop-overlay-active" in styles_css
    assert "photos-edit-crop-handle" in styles_css
    assert "cropRect" in photo_image_edits
    assert "Adjust image" in photos_view
    assert "Image exposure" in photo_image_edits
    assert "Image contrast" in photo_image_edits
    assert "Image highlights" in photo_image_edits
    assert "Image shadows" in photo_image_edits
    assert "Image brilliance" in photo_image_edits
    assert "Image black point" in photo_image_edits
    assert "Image midtones" in photo_image_edits
    assert "Image white point" in photo_image_edits
    assert "Image curve shadows" in photo_image_edits
    assert "Image curve midtones" in photo_image_edits
    assert "Image curve highlights" in photo_image_edits
    assert "Image red curve shadows" in photo_image_edits
    assert "Image red curve midtones" in photo_image_edits
    assert "Image red curve highlights" in photo_image_edits
    assert "Image green curve shadows" in photo_image_edits
    assert "Image green curve midtones" in photo_image_edits
    assert "Image green curve highlights" in photo_image_edits
    assert "Image blue curve shadows" in photo_image_edits
    assert "Image blue curve midtones" in photo_image_edits
    assert "Image blue curve highlights" in photo_image_edits
    assert "Image manual curve black point" in photo_image_edits
    assert "Image manual curve quarter point" in photo_image_edits
    assert "Image manual curve midpoint" in photo_image_edits
    assert "Image manual curve three-quarter point" in photo_image_edits
    assert "Image manual curve white point" in photo_image_edits
    assert "Manual curve graph" in photos_view
    assert "Draw manual tone curve" in photos_view
    assert "beginImageManualCurveGraphDrag" in photos_view
    assert "continueImageManualCurveGraphDrag" in photos_view
    assert "photoImageManualCurveSvgPath" in photos_view
    assert "photoEditStackImageOperationFromValue(stack)" in photos_view
    assert "if (operation) applyImageEditOperationToDraft(operation);" in photos_view
    assert "photos-edit-curve-editor" in styles_css
    assert "Photos manual curve graph saves and reloads image adjustments" in photos_e2e
    assert "Pick white balance neutral point" in photos_view
    assert "White balance sampled" in photos_view
    assert "sampleLightboxWhiteBalance" in photos_view
    assert "lightboxImagePointFromClient" in photos_view
    assert "getImageData" in photos_view
    assert "white-balance-picking" in styles_css
    assert "Image saturation" in photo_image_edits
    assert "Image warmth" in photo_image_edits
    assert "Image tint" in photo_image_edits
    assert "Image sharpness" in photo_image_edits
    assert "Image vignette" in photo_image_edits
    assert "Image noise reduction" in photo_image_edits
    assert "Auto enhance image" in photos_view
    assert "Auto enhance applied." in photos_view
    assert "photoImageAutoEnhanceAdjustments" in photos_view
    assert "sampleLightboxImageAutoEnhanceStats" in photos_view
    assert "photoImageAutoEnhanceStatsFromPixels" in photos_view
    assert "photos-edit-adjustment-toolbar" in styles_css
    assert "PHOTO_IMAGE_ADJUSTMENT_CONTROLS" in photos_view
    assert "photoImageAdjustmentsActive" in photos_view
    assert "normalizePhotoImageAdjustments" in photos_view
    assert "Image filter preset" in photos_view
    assert "Image filter intensity" in photos_view
    assert "Image filter thumbnails" in photos_view
    assert "PHOTO_IMAGE_FILTER_OPTIONS" in photos_view
    assert "photoImageFilterPreviewClassName" in photos_view
    assert "photos-edit-filter-thumbnail" in styles_css
    assert "photos-filter-preview-noir" in styles_css
    assert "photoImageFilterPresetActive" in photos_view
    assert "normalizePhotoImageFilterPreset" in photos_view
    assert "normalizePhotoImageFilterIntensity" in photos_view
    assert "filterPreset" in photos_view
    assert "filterIntensity" in photos_view
    assert "Copy image edits" in photos_view
    assert "Paste image edits" in photos_view
    assert "Paste image adjustments" in photos_view
    assert "PhotoSelectionEditControls" in photos_view
    assert "Paste copied adjustments to selected photos" in photo_selection_edit_controls
    assert "Image edit clipboard history" in photos_view
    assert "Remove copied edit from history" in photos_view
    assert "PHOTO_IMAGE_EDIT_CLIPBOARD_KEY" in photos_view
    assert "readStoredPhotoImageEditClipboardHistory" in photos_view
    assert "storePhotoImageEditClipboardHistory" in photos_view
    assert "Replace existing edits?" in photo_image_edits
    assert "Replace existing adjustments?" in photo_image_edits
    assert "Checking paste conflicts" in photo_image_edits
    assert "photoImageEditOperationsEquivalent" in photo_image_edits
    assert "photoImagePasteConflictDialogDraft" in photo_image_edits
    assert "photoImagePasteProgressMessage" in photo_image_edits
    assert "photoImagePasteResultMessage" in photo_image_edits
    assert "Checking paste conflicts for" in photo_image_edits
    assert "Pasting adjustments" in photo_image_edits
    assert "Copied adjustments" in photo_image_edits
    assert "Paste copied edits to selected photos" in photo_selection_edit_controls
    assert "imageEditClipboard" in photos_view
    assert "imageEditClipboardHistory" in photos_view
    assert "imageEditClipboardHasAdjustments" in photos_view
    assert "mergePhotoImageAdjustmentPasteOperation" in photos_view
    assert "upsertPhotoImageEditClipboardHistory" in photo_image_edits
    assert "selectedEditStackItems" in photos_view
    assert "selectedEditStackVersionItems" in photos_view
    assert "snapshotSelectedPhotoEditStackVersions" in photos_view
    assert "restoreLatestSelectedPhotoEditStackVersions" in photos_view
    assert "deleteSelectedPhotoEditStackVersions" in photos_view
    assert "Snapshot edit versions for selected photos" in photo_selection_edit_controls
    assert "Restore latest edit versions for selected photos" in photo_selection_edit_controls
    assert "Delete saved edit versions for selected photos" in photo_selection_edit_controls
    assert "Restore latest saved versions?" in photo_image_edits
    assert "Delete saved edit versions?" in photo_image_edits
    assert "Snapshotting edit versions" in photo_image_edits
    assert "revertSelectedPhotoEditStacks" in photos_view
    assert "Revert edits for selected photos" in photo_selection_edit_controls
    assert "Revert selected edits?" in photo_image_edits
    assert "hasEditStack" in api_server
    assert "hasEditStack" in types_ts
    assert "editStackVersionCount" in api_server
    assert "editStackVersionCount" in types_ts
    assert "hasEditStackVersions" in api_server
    assert "hasEditStackVersions" in types_ts
    assert "duplicateCount" in api_server
    assert "duplicateCount" in types_ts
    assert "versionCount" in api_server
    assert "versionCount" in types_ts
    assert "photoImageEditOperationHasAdjustments" in photos_view
    assert "normalizePhotoImageEditOperation" in photos_view
    assert "pasteImageEditClipboardToSelected" in photos_view
    assert "photoImageEditOperationLabel" in photo_image_edits
    assert "photoImageEditOperationActive" in photo_image_edits
    assert '"9:16"' in photo_image_edits
    assert '"3:2"' in photo_image_edits
    assert '"2:3"' in photo_image_edits
    assert '"4:3"' in photo_image_edits
    assert '"3:4"' in photo_image_edits
    assert '"5:4"' in photo_image_edits
    assert '"7:5"' in photo_image_edits
    assert '"5:7"' in photo_image_edits
    assert "imageRotateDegrees" in photos_view
    assert "imageStraightenDegrees" in photos_view
    assert "Image straighten angle" in photos_view
    assert "imageCropAspect" in photos_view
    assert "imageFlipHorizontal" in photos_view
    assert "imageFlipVertical" in photos_view
    assert "Flip image horizontally" in photos_view
    assert "Flip image vertically" in photos_view
    assert "cycleImageCropAspectEdit" in photos_view
    assert "photoImageEditShortcutForKeyboardEvent" in photos_view
    assert "photoVideoShortcutForKeyboardEvent" in photos_view
    assert "photoVideoShortcutForKeyboardEvent" in keyboard_shortcuts
    assert '"markTrimStart"' in keyboard_shortcuts
    assert '"markTrimEnd"' in keyboard_shortcuts
    assert '"scrubBackward"' in keyboard_shortcuts
    assert '"scrubForward"' in keyboard_shortcuts
    assert '"rotateVideo"' in keyboard_shortcuts
    assert '"resetVideoTransform"' in keyboard_shortcuts
    assert "BracketLeft" in keyboard_shortcuts
    assert "BracketRight" in keyboard_shortcuts
    assert "pauseLightboxVideoElement" in photos_view
    assert "return () => pauseLightboxVideoElement(video)" in photos_view
    assert "pauseLightboxVideoForBackground" in photos_view
    assert 'window.addEventListener("blur", pauseLightboxVideoForBackground)' in photos_view
    assert 'window.addEventListener("pagehide", pauseLightboxVideoForBackground)' in photos_view
    assert 'document.addEventListener("visibilitychange", onVisibilityChange)' in photos_view
    assert "photos-video-trim-timeline" in photo_lightbox_video_action_bar
    assert "Video trim timeline" in photo_lightbox_video_action_bar
    assert "Video trim start handle" in photo_lightbox_video_action_bar
    assert "Video trim end handle" in photo_lightbox_video_action_bar
    assert "updateVideoTrimStartHandle" in photos_view
    assert "updateVideoTrimEndHandle" in photos_view
    assert "photos-video-trim-selection" in styles_css
    assert '"rotate"' in keyboard_shortcuts
    assert '"cycleCrop"' in keyboard_shortcuts
    assert '"flipHorizontal"' in keyboard_shortcuts
    assert '"flipVertical"' in keyboard_shortcuts
    assert '"save"' in keyboard_shortcuts
    assert "image_crop_rotate" in photo_image_edits
    assert "straightenDegrees" in photos_view
    assert "Revert photo edit stack" in photos_view
    assert "Duplicate edit version" in photos_view
    assert "PhotoLightboxEditStackHistory" in photos_view
    assert "Edit stack versions" not in photos_view
    assert "Edit stack versions" in photo_lightbox_edit_stack_history
    assert "Edit version preview" not in photos_view
    assert "Edit version preview" in photo_lightbox_edit_stack_history
    assert "photoEditStackVersionOperationLabel" in photo_image_edit_display
    assert "compactPhotoEditStackId" not in photos_view
    assert "compactPhotoEditStackId" in photo_lightbox_edit_stack_history
    assert "Source edit" not in photos_view
    assert "Source edit" in photo_lightbox_edit_stack_history
    assert "Restore edit version" not in photos_view
    assert "Restore edit version" in photo_lightbox_edit_stack_history
    assert "Delete edit version" not in photos_view
    assert "Delete edit version" in photo_lightbox_edit_stack_history
    assert "Duplicate photo version" in photos_view
    assert "Duplicate rendered photo" in photos_view
    assert "Add markup annotation" in photos_view
    assert "Add markup annotation row" in photos_view
    assert "Delete markup annotation" in photos_view
    assert "Markup annotations" in photos_view
    assert "Markup annotation" in photos_view
    assert "Markup kind" in photos_view
    assert "Markup note" in photos_view
    assert "Markup opacity" in photos_view
    assert "Ellipse" in photos_view
    assert "Arrow" in photos_view
    assert "Line" in photos_view
    assert "Freehand" in photos_view
    assert "Signature" in photos_view
    assert "Draw markup stroke" in photos_view
    assert "Draw directly on the photo" in photos_view
    assert "Saved signatures" in photos_view
    assert "Save selected signature" in photos_view
    assert "Save signature" in photos_view
    assert "Use signature" in photos_view
    assert "Delete signature" in photos_view
    assert "PHOTO_IMAGE_SIGNATURE_PRESETS_KEY" in photos_view
    assert "Retouch image" in photos_view
    assert "Retouch spots" in photos_view
    assert "Add red-eye correction" in photos_view
    assert "Add blemish retouch" in photos_view
    assert "Add clone retouch" in photos_view
    assert "Brush retouch spots" in photos_view
    assert "Pick clone source" in photos_view
    assert "beginImageRetouchBrushDraw" in photos_view
    assert "pickImageRetouchCloneSource" in photos_view
    assert "photoImageRetouchBrushSpotsFromPoints" in photo_image_edits
    assert "Retouch strength" in photos_view
    assert "Clone source left" in photos_view
    assert "photoImageEditOperationDraft({" in photos_view
    assert "retouchActive: imageRetouchActive" in photos_view
    assert "retouch: imageRetouchSpots" in photos_view
    assert "imageRetouchOpen" in photos_view
    assert "imageRetouchOverlayActive" in photos_view
    assert "retouch-brush-active" in photos_view
    assert "retouch-source-picking" in photos_view
    assert "duplicateCurrentPhotoAssetVersion" in photos_view
    assert "duplicateCurrentPhotoAssetRenderedVersion" in photos_view
    assert "duplicateCurrentPhotoEditStackVersion" in photos_view
    assert "restoreSelectedPhotoEditStackVersion" in photos_view
    assert "deleteSelectedPhotoEditStackVersion" in photos_view
    assert "person.assetOnly" in photos_view
    assert "Edit stack" in photos_view
    assert "photo_edit_stacks" in api_server
    assert "photo_edit_stack_versions" in workspace_db
    assert "duplicate_photo_asset_version" in api_server
    assert "duplicate_photo_asset_rendered_version" in api_server
    assert "duplicate_photo_asset_version" in workspace_db
    assert "create_photo_asset_rendered_version" in workspace_db
    assert "record_photo_asset_create_operation" in workspace_db
    assert "asset_created" in workspace_db
    assert "create_photo_edit_stack_version" in api_server
    assert "restore_photo_edit_stack_version" in api_server
    assert "delete_photo_edit_stack_version" in api_server
    assert "photo-edit-previews" in api_server
    assert "renderedPreviewWidth" in api_server
    assert "image_crop_rotate" in api_server
    assert "flipHorizontal" in api_server
    assert "flipVertical" in api_server
    assert "image_straighten" in api_server
    assert "image_manual_crop" in api_server
    assert "image_adjust" in api_server
    assert "image_filter" in api_server
    assert "image_markup" in api_server
    assert "image_retouch" in api_server
    assert "red_eye" in api_server
    assert "_photo_edit_stack_image_retouch_spots" in api_server
    assert "_photo_edit_stack_apply_image_retouch" in api_server
    assert "_photo_edit_stack_image_adjustments" in api_server
    assert "_photo_edit_stack_apply_image_adjustments" in api_server
    assert "_photo_edit_stack_image_markup_annotations" in api_server
    assert "_photo_edit_stack_apply_image_markup" in api_server
    assert "markupAnnotations" in api_server
    assert '"ellipse"' in api_server
    assert '"arrow"' in api_server
    assert '"freehand"' in api_server
    assert '"signature"' in api_server
    assert "_photo_edit_stack_markup_points" in api_server
    assert "draw.ellipse" in api_server
    assert "draw.line" in api_server
    assert "draw.polygon" in api_server
    assert "ImageDraw" in api_server
    assert "highlightRecovery" in api_server
    assert "shadowLift" in api_server
    assert "localContrast" in api_server
    assert "levelsBlack" in api_server
    assert "levelsMidtone" in api_server
    assert "levelsWhite" in api_server
    assert "toneCurveShadows" in api_server
    assert "toneCurveMidtones" in api_server
    assert "toneCurveHighlights" in api_server
    assert "apply_tone_curve" in api_server
    assert "apply_channel_tone_curves" in api_server
    assert "curveRedMidtones" in api_server
    assert "curveGreenMidtones" in api_server
    assert "curveBlueMidtones" in api_server
    assert "apply_manual_curve" in api_server
    assert "manualCurveMid" in api_server
    assert "curvePoint50" in api_server
    assert "smooth_ratio" in api_server
    assert "magentaGreen" in api_server
    assert "vignetteAmount" in api_server
    assert "noiseReduction" in api_server
    assert "ImageFilter" in api_server
    assert "_photo_edit_stack_image_filter_preset" in api_server
    assert "_photo_edit_stack_filter_intensity" in api_server
    assert "_photo_edit_stack_apply_image_filter" in api_server
    assert "normalizePhotoImageMarkupAnnotations" in photo_image_edits
    assert "normalizePhotoImageMarkupDraftAnnotation" in photo_image_edits
    assert "normalizePhotoImageSignaturePresets" in photo_image_edits
    assert "photoImageSignaturePresetFromAnnotation" in photo_image_edits
    assert "photoImageMarkupSignatureAnnotationFromPreset" in photo_image_edits
    assert "photoImageMarkupActive" in photo_image_edits
    assert "photoImageMarkupLabel" in photo_image_edits
    assert "markupAnnotations" in photo_image_edits
    assert "normalizePhotoImageRetouchSpots" in photo_image_edits
    assert "normalizePhotoImageRetouchSpot" in photo_image_edits
    assert "photoImageRetouchActive" in photo_image_edits
    assert "photoImageRetouchLabel" in photo_image_edits
    assert "red_eye" in photo_image_edits
    assert "imageMarkupAnnotationsDraft" in photos_view
    assert "imageMarkupSelectedIndex" in photos_view
    assert "addImageMarkupAnnotation" in photos_view
    assert "deleteSelectedImageMarkupAnnotation" in photos_view
    assert "markupActive: imageMarkupActive" in photos_view
    assert "markup: imageMarkupAnnotations" in photos_view
    assert "imageMarkupOverlayActive" in photos_view
    assert "imageMarkupDragging" in photos_view
    assert "beginImageMarkupOverlayDrag" in photos_view
    assert "photoImageMarkupHitTest" in photos_view
    assert "photoImageMarkupAnnotationFromDrag" in photos_view
    assert "photos-edit-markup-overlay" not in photos_view
    assert "photos-edit-markup-overlay" in photo_lightbox_stage
    assert "photos-edit-markup-handle" not in photos_view
    assert "photos-edit-markup-handle" in photo_lightbox_stage
    assert "photos-edit-markup-stroke-preview" not in photos_view
    assert "photos-edit-markup-stroke-preview" in photo_lightbox_stage
    assert "photos-edit-signature-library" in photos_view
    assert "photos-edit-signature-preview" in photos_view
    assert "photos-edit-markup-overlay" in styles_css
    assert "photos-edit-retouch-control" in styles_css
    assert "photos-edit-retouch-overlay" in styles_css
    assert "photos-edit-markup-handle" in styles_css
    assert "photos-edit-markup-stroke-preview" in styles_css
    assert "photos-edit-signature-library" in styles_css
    assert "photos-edit-signature-preview" in styles_css
    assert "markup-overlay-active" in styles_css
    assert "Photos Markup and description-region metadata persist from the lightbox" in photos_e2e
    assert "Browser markup note" in photos_e2e
    assert "Browser region handle text" in photos_e2e
    assert "Save selected signature" in photos_e2e
    assert "ImageEnhance" in api_server
    assert "_photo_edit_stack_manual_crop_rect" in api_server
    assert "manualCropRect" in api_server
    assert "_photo_edit_stack_straighten_degrees" in api_server
    assert "_photo_edit_stack_largest_straighten_crop" in api_server
    assert '"3:2": 3 / 2' in api_server
    assert '"2:3": 2 / 3' in api_server
    assert "rendered_edit" in api_server
    assert "editStackRendered" in api_server
    assert "save_photo_edit_stack" in api_server
    assert "revert_photo_edit_stack" in api_server
    assert "originalSourceUrl" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "originalSourceUrl" in types_ts
    assert "export_photo_video_trim" in api_server
    assert "videoRotateDegrees" in api_server
    assert "videoCropAspect" in api_server
    assert "_photo_export_video_edit_stack_settings" in api_server
    assert "rendered_video_edit" in api_server
    assert "videoTrimStartMs" in api_server
    assert "videoTrimDurationMs" in api_server
    assert "videoEditSummary" in api_server
    assert "videoEditTimeline" in photo_selection_export_results
    assert "detailLabels" in (root / "src" / "views" / "photoImageEdits.ts").read_text(encoding="utf-8")
    assert "usePosterFrame" in api_server
    assert "posterFrameReused" in api_server
    assert "exportPhotoLiveMotion" in photos_view
    assert "exportPhotoSubjectCutout" in photos_view
    assert "Cutout PNG" not in photos_view
    assert "Cutout PNG" in photo_lightbox_primary_actions
    assert "Sticker PNG" not in photos_view
    assert "Sticker PNG" in photo_lightbox_primary_actions
    assert "Copy cutout" not in photos_view
    assert "Copy cutout" in photo_lightbox_primary_actions
    assert "Copy sticker" not in photos_view
    assert "Copy sticker" in photo_lightbox_primary_actions
    assert "copyToClipboard" in photos_view
    assert "Drag PNG" not in photos_view
    assert "Drag PNG" in photo_lightbox_primary_actions
    assert "startSubjectCutoutFileDrag" in photos_view
    assert "startFileDrag" in photos_view
    assert "Open with..." in photos_view
    assert "Open with last" in photos_view
    assert "Open with..." in photo_selection_original_actions
    assert "Open with last" in photo_selection_original_actions
    assert "External editors" not in photos_view
    assert "External editors" in photo_curation_preferences_panel
    assert "forgetExternalEditor" in photos_view
    assert "open_with_external_editor" in photos_view
    assert "open_with_last_external_editor" in photos_view
    assert "lastExternalEditorPath" in photos_view
    assert "lastPhotoExternalEditorPath" in app_tsx
    assert "writeClipboardImagePath" in app_tsx
    assert "Export motion" not in photos_view
    assert "Export motion" in photo_lightbox_video_action_bar
    assert "Export GIF" not in photos_view
    assert "Export GIF" in photo_lightbox_video_action_bar
    assert "Bounce GIF" not in photos_view
    assert "Bounce GIF" in photo_lightbox_video_action_bar
    assert "setPhotoLiveKeyPhoto" in photos_view
    assert "Set key photo" not in photos_view
    assert "Set key photo" in photo_lightbox_video_action_bar
    assert "resetPhotoLiveKeyPhoto" in photos_view
    assert "Reset key photo" not in photos_view
    assert "Reset key photo" in photo_lightbox_video_action_bar
    assert "Live Photo motion preview" not in photos_view
    assert "Live Photo motion preview" in photo_lightbox_stage
    assert "setPhotoVideoPoster" in photos_view
    assert "Set poster" not in photos_view
    assert "Set poster" in photo_lightbox_video_action_bar
    assert "Video poster policy" not in photos_view
    assert "Video poster policy" in photo_lightbox_video_action_bar
    assert "Auto poster" not in photos_view
    assert "Auto poster" in photo_lightbox_video_action_bar
    assert "setLightboxVideoPosterPolicy" in photos_view
    assert "resetPhotoVideoPoster" in photos_view
    assert "Reset poster" not in photos_view
    assert "Reset poster" in photo_lightbox_video_action_bar
    assert '"policy": policy' in api_server
    assert 'policy: "auto"' in photos_view
    assert "Metadata JSON" in photo_export_packaging_controls
    assert "XMP sidecars" in photo_export_packaging_controls
    assert "_photo_export_accessibility_fields" in api_server
    assert "Iptc4xmpCore:AltTextAccessibility" in api_server
    assert "Iptc4xmpCore:ExtDescrAccessibility" in api_server
    assert "Iptc4xmpExt:PersonInImage" in api_server
    assert "photoshop:SupplementalCategories" in api_server
    assert "exif:GPSLatitude" in api_server
    assert "tiff:Make" in api_server
    assert "aux:Lens" in api_server
    assert "metadata_payload=rendered_metadata_payload" in api_server
    assert "XML:com.adobe.xmp" in api_server
    assert "_photo_xmp_sidecar_conflicts" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "XMP conflicts" in photos_view
    assert "Use XMP" in photos_view
    photo_folders_units = (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "Rendered source accessible description" in photo_folders_units
    assert "Region 1: Rendered focal region" in photo_folders_units
    assert "Album: Vacation Picks" in photo_folders_units
    assert "Unit Lens 35mm" in photo_folders_units
    assert "Original filenames" in photo_export_packaging_controls
    assert "Favorite person" in photos_view
    assert "Hide person" in photos_view
    assert "Use as key photo" in photos_view
    assert "Keyword quick picks" in photos_view
    assert "Asset ID" in photos_view
    assert "Use as cover" in photos_view
    assert "Date view" in photos_view
    assert "Years" in photos_view
    assert "Months" in photos_view
    assert "Days" in photos_view
    assert "Recent Days" in photos_view
    assert "dateBucketMode" in photos_view
    assert "dateBucketKey" in photos_view
    assert "PhotoDateBucketPanel" in photos_view
    assert "Could not load date buckets" not in photos_view
    assert "Loading date buckets..." not in photos_view
    assert "No dated photos in this view" not in photos_view
    assert "Could not load date buckets" in photo_date_bucket_panel
    assert "Loading date buckets..." in photo_date_bucket_panel
    assert "No dated photos in this view" in photo_date_bucket_panel
    assert "buildPhotoDateBuckets" in photos_view
    assert "buildPhotoDateBucketSummaryBadges" in photos_view
    assert "photoDateBucketCoverReason" in photos_view
    assert "photo-date-bucket-cover-reason" not in photos_view
    assert "photo-date-bucket-badges" not in photos_view
    assert "photo-date-bucket-cover-reason" in photo_date_bucket_panel
    assert "photo-date-bucket-badges" in photo_date_bucket_panel
    assert "slice(0, 7)" in photos_view
    assert "photoShortcutForKeyboardEvent" in photos_view
    assert "isPhotoShortcutTypingTarget" in photos_view
    assert "photoThumbnailAspectRatio" in photo_thumbnail_controls
    assert "buildPhotoVirtualGridLayout" in photos_view
    assert "windowPhotoVirtualGridLayout" in photos_view
    assert "photos-grid virtualized" not in photos_view
    assert "photos-grid virtualized" in photo_virtual_grid_panel
    assert "buildPhotoSlideshowQueue" in photos_view
    assert "startPhotoSlideshow" in photos_view
    assert "PhotoSlideshowOverlay" in photos_view
    assert "photos-slideshow" not in photos_view
    assert "photos-slideshow" in photo_slideshow_overlay
    assert "Close slideshow" in photo_slideshow_overlay
    assert "Previous slide" in photo_slideshow_overlay
    assert "Next slide" in photo_slideshow_overlay
    assert "Memory chapters" in photo_slideshow_overlay
    assert "Start slideshow" not in photos_view
    assert "Start slideshow" in photo_lightbox_primary_actions
    assert "Slideshow selected" in photo_selection_primary_actions
    assert "photoSlideshowProjects" in photos_view
    assert "PHOTO_SLIDESHOW_PROJECTS_KEY" in photos_view
    assert "loadPhotoSlideshowProjects" in photos_view
    assert "savePhotoSlideshowProjectFnRef" in photos_view
    assert "deletePhotoSlideshowProjectFnRef" in photos_view
    assert "PhotoSlideshowProjectTimelineControls" in photos_view
    assert "Save slideshow" in photo_slideshow_project_timeline_controls
    assert "Play project" in photo_slideshow_project_timeline_controls
    assert "Export slideshow" in photo_slideshow_project_timeline_controls
    assert "Export movie" in photo_slideshow_project_timeline_controls
    assert "Delete project" in photo_slideshow_project_timeline_controls
    assert "Slideshow timeline" in photo_slideshow_project_timeline_controls
    assert "Audio starts" in photo_slideshow_project_timeline_controls
    assert "Audio ends" in photo_slideshow_project_timeline_controls
    assert "outputMode" in photos_view
    assert "slideshowAudioMuted" in photos_view
    assert "PHOTO_SLIDESHOW_MUSIC_FREQUENCIES" in photos_view
    assert "AudioContext" in photos_view
    assert "Mute music" not in photos_view
    assert "Unmute music" not in photos_view
    assert "Mute music" in photo_slideshow_overlay
    assert "Unmute music" in photo_slideshow_overlay
    assert "PhotoSlideshowProjectPlaybackControls" in photos_view
    assert "Custom file" in photo_slideshow_project_playback_controls
    assert "Audio file" in photo_slideshow_project_playback_controls
    assert "Audio volume" in photo_slideshow_project_playback_controls
    assert "Audio fade" in photo_slideshow_project_playback_controls
    assert "Audio start" in photo_slideshow_project_playback_controls
    assert "Audio end" in photo_slideshow_project_playback_controls
    assert "PhotoSlideshowProjectBasicsControls" in photos_view
    assert "Slideshow project" in photo_slideshow_project_basics_controls
    assert "Slideshow title" in photo_slideshow_project_basics_controls
    assert "Title-card title" in photo_slideshow_project_basics_controls
    assert "Title-card palette" in photo_slideshow_project_basics_controls
    assert "Title-card layout" in photo_slideshow_project_basics_controls
    assert "Title-card footer" in photo_slideshow_project_basics_controls
    assert "Selected slide duration" in photo_slideshow_project_basics_controls
    assert "Selected slide motion" in photo_slideshow_project_basics_controls
    assert "PhotoSlideshowProjectFramingControls" in photos_view
    assert "Apply motion" in photo_slideshow_project_framing_controls
    assert "Focal X" in photo_slideshow_project_framing_controls
    assert "Focal Y" in photo_slideshow_project_framing_controls
    assert "Crop zoom" in photo_slideshow_project_framing_controls
    assert "PhotoSlideshowProjectCaptionControls" in photos_view
    assert "Selected slide caption" in photo_slideshow_project_caption_controls
    assert "Selected caption layer" in photo_slideshow_project_caption_controls
    assert "Selected caption placement" in photo_slideshow_project_caption_controls
    assert "Selected caption typography" in photo_slideshow_project_caption_controls
    assert "Selected caption wrap" in photo_slideshow_project_caption_controls
    assert "Caption region X" in photo_slideshow_project_caption_controls
    assert "Caption region editor" in photos_view
    assert "Caption region canvas" in photos_view
    assert "Move caption region" in photos_view
    assert "Resize caption region" in photos_view
    assert "resize-southeast" in photos_view
    assert "PhotoSlideshowProjectCaptionActionControls" in photos_view
    assert "Apply caption" in photo_slideshow_project_caption_action_controls
    assert "Apply caption preset" in photo_slideshow_project_caption_action_controls
    assert "Clear caption" in photo_slideshow_project_caption_action_controls
    assert "photos-slideshow-caption" not in photos_view
    assert "photos-slideshow-caption" in photo_slideshow_overlay
    assert "PHOTO_SLIDESHOW_CAPTION_LIMIT" in photo_slideshow_project_caption_controls
    assert "captions" in photos_view
    assert "PhotoSlideshowProjectKeyframeControls" in photos_view
    assert "Path start X" in photo_slideshow_project_keyframe_controls
    assert "Path curve" in photos_view
    assert "Path editor" in photos_view
    assert "Draw path" in photos_view
    assert "Slideshow path canvas" in photos_view
    assert "Path mid X" in photo_slideshow_project_keyframe_controls
    assert "Mid zoom" in photo_slideshow_project_keyframe_controls
    assert "Apply keyframes" in photo_slideshow_project_keyframe_controls
    assert "Clear keyframes" in photo_slideshow_project_keyframe_controls
    assert "Apply selected" in photo_slideshow_project_basics_controls
    assert "Transition" in photo_slideshow_project_playback_controls
    assert "Transition duration" in photo_slideshow_project_playback_controls
    assert "photoSlideshowProjectTransitionEffect" in photos_view
    assert "chooseSlideshowAudioFile" in photos_view
    assert "Slideshow title" in photo_slideshow_project_basics_controls
    assert "PhotoSlideshowProjectTemplateControls" in photos_view
    assert "Theme" in photo_slideshow_project_template_controls
    assert "Music" in photo_slideshow_project_playback_controls
    assert "photo-slideshow-projects" in photos_view
    assert "sourcePaths" in api_server
    assert "source_paths_filter" in api_server
    assert "photo_slideshow_theme_templates" in api_server
    assert "save_photo_slideshow_theme_template" in api_server
    assert "delete_photo_slideshow_theme_template" in api_server
    assert "export_photo_slideshow_theme_templates" in api_server
    assert "import_photo_slideshow_theme_templates" in api_server
    assert "photo_slideshow_projects" in api_server
    assert "save_photo_slideshow_project" in api_server
    assert "delete_photo_slideshow_project" in api_server
    assert "export_photo_slideshow" in api_server
    assert "export_photo_memory_movie" in api_server
    assert "vintrace-memory-movie" in api_server
    assert "includeTitleCard" in api_server
    assert "titleCardPalette" in api_server
    assert "titleCardLayout" in api_server
    assert "titleCardFontScale" in api_server
    assert "titleCardShowFooter" in api_server
    assert "timelineDurationMs" in api_server
    assert "timelineStartMs" in api_server
    assert "transitionEffect" in api_server
    assert "transitionResolvedEffect" in api_server
    assert "themeTimelinePreset" in api_server
    assert "themeTemplateName" in api_server
    assert "themeTemplatePalette" in api_server
    assert "themeTemplateTypography" in api_server
    assert "themeTemplateBackdrop" in api_server
    assert "themeTemplateBackdropIntensity" in api_server
    assert "themeTemplateStageWidth" in api_server
    assert "templateStageFrame" in api_server
    assert "memory_movie_settings" in api_server
    assert "memory_movie_value" in api_server
    assert "themeTemplateFrameStyle" in api_server
    assert "themeTemplateChromeDensity" in api_server
    assert "themeTemplateCaptionPreset" in api_server
    assert "templateCaptionResolvedPreset" in api_server
    assert "themeTemplateRegionMap" in api_server
    assert "templateCaptionResolvedRegionMap" in api_server
    assert "_photo_slideshow_clean_template_region_map" in api_server
    assert "_photo_slideshow_resolved_region_map" in api_server
    assert "templateRegionMap" in api_server
    assert "captionRegionMap" in api_server
    assert "caption_preset_region" in api_server
    assert '"blur"' in api_server
    assert '"spotlight"' in api_server
    assert '"film"' in api_server
    assert "themeTemplateLayout" in api_server
    assert "--template-overlay-opacity" in api_server
    assert "--template-stage-poster-width" in api_server
    assert "--template-frame-border" in api_server
    assert "--template-chrome-padding" in api_server
    assert "templateFrameRendered" in api_server
    assert "templateLayoutChromeRendered" in api_server
    assert "templateLayoutChromeStyle" in api_server
    assert "templateLayoutMediaFrame" in api_server
    assert "templateChromeRendered" in api_server
    assert "templateChromeBarPx" in api_server
    assert "templateChromeColor" in api_server
    assert "templateChromeOverlayRendered" in api_server
    assert "templateChromeOverlayCount" in api_server
    assert "templateChromeOverlayRows" in api_server
    assert "captionText" in api_server
    assert "captionPlacement" in api_server
    assert "captionRegion" in api_server
    assert "captionTypography" in api_server
    assert "captionWrap" in api_server
    assert "row_caption_typography" in api_server
    assert "row_caption_wrap" in api_server
    assert "wrap_caption_lines" in api_server
    assert "typography-cinematic" in api_server
    assert "wrap-two-line" in api_server
    assert "templateCaptionRendered" in api_server
    assert "templateCaptionOverlayCount" in api_server
    assert "caption.style.left" in api_server
    assert "drawbox=x=0:y=0" in api_server
    assert "overlay=0:0:format=auto" in api_server
    assert '"hairline"' in api_server
    assert '"matte"' in api_server
    assert '"accent"' in api_server
    assert '"spacious"' in api_server
    assert '"poster"' in api_server
    assert '"split"' in api_server
    assert '"immersive"' in api_server
    assert "transitionTimeline" in api_server
    assert "transitionApplied" in api_server
    assert "motionPresets" in api_server
    assert "resolvedMotionPresets" in api_server
    assert "resolvedTimelineItems" in api_server
    assert "clean_motion_keyframes" in api_server
    assert "clean_motion_keyframe_curve" in api_server
    assert "--motion-timing" in api_server
    assert "2.5-1.5" in api_server
    assert "quarterZoom" in api_server
    assert "midZoom" in api_server
    assert "threeQuarterZoom" in api_server
    assert "motion-custom" in api_server
    assert "motionCustom" in api_server
    assert "themeTimelinePreset" in api_server
    assert "motionApplied" in api_server
    assert "motionSlowZoom" in api_server
    assert "motionPanLeft" in api_server
    assert "resolvedMotion\", \"custom\"" in api_server or '"custom"' in api_server
    assert "_photo_export_create_title_card" in api_server
    assert '"title_card"' in api_server
    assert "titleCardIncluded" in api_server
    assert "customAudio" in api_server
    assert "audioImported" in api_server
    assert "audioVolume" in api_server
    assert "audioFadeMs" in api_server
    assert "audioStartMs" in api_server
    assert "audioEndMs" in api_server
    assert "atrim=duration" in api_server
    assert "asetpts=PTS-STARTPTS" in api_server
    assert "afade=t=in" in api_server
    assert "volume=" in api_server
    assert "stream_loop" in api_server
    assert "_photo_export_render_slideshow_video" in api_server
    assert "photo_slideshow_projects" in workspace_db
    assert "photo_slideshow_theme_templates" in workspace_db
    assert "themeTimelinePreset" in workspace_db
    assert "themeTemplateName" in workspace_db
    assert "themeTemplatePalette" in workspace_db
    assert "themeTemplateTypography" in workspace_db
    assert "themeTemplateBackdrop" in workspace_db
    assert "themeTemplateBackdropIntensity" in workspace_db
    assert "themeTemplateStageWidth" in workspace_db
    assert "clean_movie_settings" in workspace_db
    assert "clearMovieSettings" in workspace_db
    assert "themeTemplateFrameStyle" in workspace_db
    assert "themeTemplateChromeDensity" in workspace_db
    assert "themeTemplateCaptionPreset" in workspace_db
    assert "themeTemplateRegionMap" in workspace_db
    assert "templateRegionMap" in workspace_db
    assert "captionRegionMap" in workspace_db
    assert "clean_region_map" in workspace_db
    assert "captionText" in workspace_db
    assert "captionPlacement" in workspace_db
    assert "captionRegion" in workspace_db
    assert "captionTypography" in workspace_db
    assert "captionWrap" in workspace_db
    assert '"blur"' in workspace_db
    assert '"spotlight"' in workspace_db
    assert '"film"' in workspace_db
    assert "themeTemplateLayout" in workspace_db
    assert '"poster"' in workspace_db
    assert '"split"' in workspace_db
    assert '"immersive"' in workspace_db
    assert "clean_motion_keyframe_curve" in workspace_db
    assert "Export templates" in photo_slideshow_project_template_controls
    assert "Import templates" in photo_slideshow_project_template_controls
    assert "chooseSlideshowTemplateLibraryFile" in photos_view
    photo_slideshow_projects = (root / "src" / "views" / "photoSlideshowProjects.ts").read_text(encoding="utf-8")
    assert "PhotoSlideshowThemeTemplate" in photo_slideshow_projects
    assert "normalizePhotoSlideshowThemeTemplate" in photo_slideshow_projects
    assert "upsertPhotoSlideshowThemeTemplate" in photo_slideshow_projects
    assert "deletePhotoSlideshowThemeTemplate" in photo_slideshow_projects
    assert "normalizePhotoSlideshowProject" in photo_slideshow_projects
    assert "upsertPhotoSlideshowProject" in photo_slideshow_projects
    assert "deletePhotoSlideshowProject" in photo_slideshow_projects
    assert "photoSlideshowProjectSourcePaths" in photo_slideshow_projects
    assert "PhotoSlideshowTitleCardPalette" in photo_slideshow_projects
    assert "PhotoSlideshowMotionPreset" in photo_slideshow_projects
    assert "PhotoSlideshowMotionKeyframeCurve" in photo_slideshow_projects
    assert "PhotoSlideshowMotionKeyframes" in photo_slideshow_projects
    assert "cleanPhotoSlideshowMotionKeyframes" in photo_slideshow_projects
    assert "photoSlideshowMotionPathPointsFromKeyframes" in photo_slideshow_projects
    assert "samplePhotoSlideshowFreehandPathPoints" in photo_slideshow_projects
    assert "photoSlideshowMotionKeyframesWithPathPoints" in photo_slideshow_projects
    assert "PhotoSlideshowMotionPathMode" in photo_slideshow_projects
    assert "photoSlideshowMotionKeyframesWithBezierControls" in photo_slideshow_projects
    assert "photoSlideshowBezierControlPointsFromKeyframes" in photo_slideshow_projects
    assert "bezierControl1X" in photo_slideshow_projects
    assert "keyframeCurve" in photo_slideshow_projects
    assert "quarterX" in photo_slideshow_projects
    assert "midX" in photo_slideshow_projects
    assert "threeQuarterX" in photo_slideshow_projects
    assert "buildPhotoSlideshowThemeTimeline" in photo_slideshow_projects
    assert "photoSlideshowResolvedMotionPreset" in photo_slideshow_projects
    assert "titleCardDurationMs" in photo_slideshow_projects
    assert "cleanPhotoSlideshowTimelineItems" in photo_slideshow_projects
    assert "PhotoSlideshowTransitionEffect" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTimelineChoice" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplatePalette" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateTypography" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateBackdrop" in photo_slideshow_projects
    assert "themeTemplateBackdropIntensity" in photo_slideshow_projects
    assert "themeTemplateStageWidth" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateFrameStyle" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateChromeDensity" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateCaptionPreset" in photo_slideshow_projects
    assert "photoSlideshowResolvedCaptionPreset" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateRegionMap" in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateRegionSlot" in photo_slideshow_projects
    assert "cleanPhotoSlideshowThemeTemplateRegionMap" in photo_slideshow_projects
    assert "photoSlideshowResolvedRegionMap" in photo_slideshow_projects
    assert "themeTemplateRegionMap" in photo_slideshow_projects
    assert "themeTemplateFrameStyle" in photo_slideshow_projects
    assert "themeTemplateChromeDensity" in photo_slideshow_projects
    assert "themeTemplateCaptionPreset" in photo_slideshow_projects
    assert "focalX" in photo_slideshow_projects
    assert "cropZoom" in photo_slideshow_projects
    assert "PhotoSlideshowCaptionPlacement" in photo_slideshow_projects
    assert "PhotoSlideshowCaptionTypography" in photo_slideshow_projects
    assert "PhotoSlideshowCaptionWrap" in photo_slideshow_projects
    assert "captionText" in photo_slideshow_projects
    assert "captionPlacement" in photo_slideshow_projects
    assert "captionRegion" in photo_slideshow_projects
    assert "captionTypography" in photo_slideshow_projects
    assert "captionWrap" in photo_slideshow_projects
    assert '"blur"' in photo_slideshow_projects
    assert '"spotlight"' in photo_slideshow_projects
    assert '"film"' in photo_slideshow_projects
    assert "PhotoSlideshowThemeTemplateLayout" in photo_slideshow_projects
    assert '"poster"' in photo_slideshow_projects
    assert '"split"' in photo_slideshow_projects
    assert '"immersive"' in photo_slideshow_projects
    assert "transitionOut" in photo_slideshow_projects
    assert "transitionDurationMs" in photo_slideshow_projects
    assert "Selected transition" in photo_slideshow_project_caption_action_controls
    assert "Selected transition duration" in photo_slideshow_project_caption_action_controls
    assert "Apply transition" in photo_slideshow_project_caption_action_controls
    assert "Clear transition" in photo_slideshow_project_caption_action_controls
    assert "currentPhotoMemoryMovieSettingsPayload" in photos_view
    assert "applyPhotoMemoryMovieSettings" in photos_view
    assert "Memory movie style" in photos_view
    assert "Save movie style" in photos_view
    assert "Apply movie style" in photos_view
    assert "Clear movie style" in photos_view
    assert "Use face focal" in photo_slideshow_project_framing_controls
    assert "Apply crop" in photo_slideshow_project_framing_controls
    assert "photoSlideshowCropStyle" in photos_view
    assert "Timeline style" in photo_slideshow_project_template_controls
    assert "Template preset" in photo_slideshow_project_template_controls
    assert "Template name" in photo_slideshow_project_template_controls
    assert "Bezier handles" in photos_view
    assert "Bezier control 1 X" in photo_slideshow_project_keyframe_controls
    assert "clean_motion_path_mode" in workspace_db
    assert "clean_bezier_controls" in workspace_db
    assert "bezierControl1X" in workspace_db
    assert "cropZoom" in workspace_db
    assert "clean_motion_path_mode" in api_server
    assert "clean_bezier_controls" in api_server
    assert "bezierControl1X" in api_server
    assert "cropFocusRendered" in api_server
    assert "Template palette" in photo_slideshow_project_template_controls
    assert "Template typography" in photo_slideshow_project_template_controls
    assert "Template backdrop" in photo_slideshow_project_template_controls
    assert "Template backdrop intensity" in photo_slideshow_project_template_controls
    assert "Template stage width" in photo_slideshow_project_template_controls
    assert "Template region slot" in photo_slideshow_project_template_controls
    assert "Template region X" in photo_slideshow_project_template_controls
    assert "Clear region" in photo_slideshow_project_template_controls
    assert "Reset regions" in photo_slideshow_project_template_controls
    assert "Blur" in photo_slideshow_project_template_controls
    assert "Spotlight" in photo_slideshow_project_template_controls
    assert "Film" in photo_slideshow_project_template_controls
    assert "Template layout" in photo_slideshow_project_template_controls
    assert "Poster" in photo_slideshow_project_template_controls
    assert "Split" in photo_slideshow_project_template_controls
    assert "Immersive" in photo_slideshow_project_template_controls
    assert "Save template" in photo_slideshow_project_template_controls
    assert "Delete template" in photo_slideshow_project_template_controls
    assert "Path 25% X" in photo_slideshow_project_keyframe_controls
    assert "Path 75% X" in photo_slideshow_project_keyframe_controls
    styles_css = (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "photo-slideshow-projects" in styles_css
    assert "transition-dissolve" in styles_css
    assert "motion-pan-left" in styles_css
    assert "motion-custom" in styles_css
    assert "photo-slideshow-motion-custom" in styles_css
    assert "photo-slideshow-path-editor" in styles_css
    assert "photo-slideshow-path-sampled" in styles_css
    assert "photo-slideshow-path-drawn" in styles_css
    assert "photo-slideshow-path-bezier-curve" in styles_css
    assert "photo-slideshow-caption-region-editor" in styles_css
    assert "photo-slideshow-caption-region-box" in styles_css
    assert "photo-slideshow-caption-region-handle" in styles_css
    assert "resize-northeast" in styles_css
    assert "photo-slideshow-template-bg" in styles_css
    assert "photo-slideshow-template-font" in styles_css
    assert "photo-slideshow-template-overlay" in styles_css
    assert "photo-slideshow-template-overlay-opacity" in styles_css
    assert "photo-slideshow-template-stage-poster-width" in styles_css
    assert "template-layout-gallery" in styles_css
    assert "template-layout-poster" in styles_css
    assert "template-layout-split" in styles_css
    assert "template-layout-immersive" in styles_css
    assert "photo-slideshow-keyframe-quarter-x" in styles_css
    assert "photo-slideshow-keyframe-three-quarter-x" in styles_css
    assert "photo-slideshow-keyframe-timing" in styles_css
    assert "photos-slideshow-caption" in styles_css
    assert "placement-upper-right" in styles_css
    assert "typography-cinematic" in styles_css
    assert "wrap-two-line" in styles_css
    assert "theme-ken-burns" in styles_css
    assert "Managed library roots" not in photos_view
    assert "Use managed root profile" not in photos_view
    assert "Forget managed root profile" not in photos_view
    assert "Managed library roots" in photo_managed_roots_panel
    assert "Use managed root profile" in photo_managed_roots_panel
    assert "Forget managed root profile" in photo_managed_roots_panel
    assert "PHOTO_ACTIVE_LIBRARY_ROOT_KEY" in photos_view
    assert "Library view" in photo_rail_import_controls
    assert "All libraries" in photos_view
    assert "View only managed root profile" not in photos_view
    assert "View only managed root profile" in photo_managed_roots_panel
    assert "updateManagedPhotoRootPolicy" in photos_view
    assert "External backup" in photos_view
    assert "External backup" in photo_managed_roots_panel
    assert "managedRootPolicy" in photos_view
    assert "setPhotoLibraryScope" in photos_view
    assert "libraryRoot: activeLibraryRootRef.current" in photos_view
    assert "libraryRoot: activeLibraryRoot" in photos_view
    assert "forgetManagedRoot" in photos_view
    assert "forgetManagedRootProfileId" in api_server
    assert "_photo_library_root_filter_from_params" in api_server
    assert "_filter_photo_entries_by_library_root" in api_server
    assert "source_text_filters=library_root_source_filters" in api_server
    assert '"libraryRoot"' in api_server
    assert '"activeLibraryRoot"' in api_server
    assert "_photo_source_text_filter_sql_parts" in workspace_db
    assert '"folderIs"' in workspace_db
    assert "test_photo_library_root_scope_filters_browse_dates_and_search" in photo_folders
    assert "forget_managed_root" in workspace_db
    assert "photo-managed-root-profile-row" in styles_css
    assert "Photos settings manage managed-root profile history" in photos_e2e
    assert "resolvePhotoKeywordShortcut" in photos_view
    assert "applyKeywordShortcut" in photos_view
    assert "Date offset days" in photo_selection_bulk_metadata_controls
    assert "Shift dates" in photo_selection_bulk_metadata_controls
    assert "offsetSelectedDates" in photos_view
    assert "Adjusted time" in photos_view
    assert "Timezone offset" in photos_view
    assert "Bulk timezone offset" in photo_selection_bulk_metadata_controls
    assert "Set timezone" in photo_selection_bulk_metadata_controls
    assert "correctSelectedTimezones" in photos_view
    assert "Photos bulk date and timezone controls update selected photos" in photos_e2e
    assert "PHOTO_EXPORT_DESTINATIONS_KEY" in photos_view
    assert "PhotoExportDestinationControls" in photos_view
    assert "Export destinations" in photo_export_destination_controls
    assert "Export destination" in photo_export_destination_controls
    assert "Choose on export" in photo_export_destination_controls
    assert "Export to destination" in photo_export_destination_controls
    assert "Copy to destination" in photo_export_destination_controls
    assert "Forget destination" in photo_export_destination_controls
    assert "Photos export options reuse recent destinations" in photos_e2e
    assert "Thumbnail size" in photos_view
    assert "Thumbnail presentation" in photos_view
    assert "Square" in photos_view
    assert "Aspect" in photos_view
    assert "Person filter" in photos_view
    assert "Review status filter" in photos_view
    assert "Minimum quality filter" in photos_view
    assert "From date filter" in photos_view
    assert "Through date filter" in photos_view
    assert "Source filter" in photos_view
    assert "File type filter" in photos_view
    assert "Location filter" in photos_view
    assert "Camera filter" in photos_view
    assert "Album filter" in photos_view
    assert "Visibility filter" in photos_view
    assert "Revert location" in photos_view
    assert "Map picker" in photos_view
    assert "Location map picker" in photos_view
    assert "pickLocationFromPointer" in photos_view
    assert "nudgeLocationPicker" in photos_view
    assert "Strip location" in photo_export_packaging_controls
    assert "Existing sidecars" in photo_export_packaging_controls
    assert '".dop"' in api_server
    assert '".pp3"' in api_server
    assert '".on1"' in api_server
    assert '".cos"' in api_server
    assert "hasPhotoLocationOverride" in photos_view
    assert "Template filenames" in photo_export_packaging_controls
    assert "Filename template" in photo_export_packaging_controls
    assert "Subfolder template" in photo_export_packaging_controls
    assert "Person name" in photos_view
    assert "Rename person" in photos_view
    assert "Merge person" in photos_view
    assert "Person merge preview" in photos_view
    assert "personMergePreview" in photos_view
    assert "renderPersonMergePreview" in photos_view
    assert "photo-person-merge-preview" in styles_css
    assert "People sort" in photos_view
    assert "People & Pets" in photos_view
    assert "PhotoPeopleGallery" in photos_view
    assert "photos-people-gallery" not in photos_view
    assert "photos-people-gallery" in photo_people_gallery
    assert "people-circle-card" not in photos_view
    assert "people-circle-card" in photo_people_gallery
    assert "People & Pets" in photo_people_gallery
    assert "Review matches" in photo_people_gallery
    assert "More people to name" in photo_people_gallery
    assert "People Together" in photo_people_gallery
    assert "Pet profile" in photos_view
    assert "petKindLabel" in photos_view
    assert "savePhotoPetProfile" in photos_view
    assert "renamePhotoPet" in photos_view
    assert "assignPhotoPet" in photos_view
    assert "dismissPhotoPetReview" in photos_view
    assert "Assign pet name" in photos_view
    assert "Assign pet" in photos_view
    assert "PhotoSelectionBulkMetadataControls" in photos_view
    assert "Bulk pet name" in photo_selection_bulk_metadata_controls
    assert "Assign selected pets" in photo_selection_bulk_metadata_controls
    assert "Dismiss selected Pet Review items" in photo_selection_bulk_metadata_controls
    assert "Name this pet" in photos_view
    assert "petReview" in photos_view
    assert "Pet name" in photos_view
    assert "Merge pet" in photos_view
    assert "Rename pet" in photos_view
    assert "includeHiddenPets" in photos_view
    assert "Favorite pet" in photos_view
    assert "Use as pet key photo" in photos_view
    assert "Use as place cover" in photos_view
    assert "Clear place cover" in photos_view
    assert "savePhotoPlaceProfile" in photos_view
    assert "Person cover crop" in photos_view
    assert "keyAssetCrop" in photos_view
    assert "photo-cover-crop-actions" in photos_view
    assert "Use as utility cover" in photos_view
    assert "Clear utility cover" in photos_view
    assert "savePhotoUtilityProfile" in photos_view
    assert "No pets yet" in photos_view
    assert "Manual people sort" in photos_view
    assert "Alphabetical people sort" in photos_view
    assert "People management" in photos_view
    assert "includeHiddenPeople" in photos_view
    assert "toggleManagedPersonHidden" in photos_view
    assert "peopleRailDrag" in photos_view
    assert "applyPeopleRailDrop" in photos_view
    assert "draggablePeopleRailItem" in photos_view
    assert "Review More" in photos_view
    group_review = (root / "src" / "views" / "photoGroupReview.ts").read_text(encoding="utf-8")
    assert "buildPhotoGroupReviewCandidates" in group_review
    review_focus_history = (root / "src" / "views" / "reviewFocusHistory.ts").read_text(encoding="utf-8")
    assert "upsertReviewFocusHistory" in review_focus_history
    assert "removeReviewFocusHistoryItem" in review_focus_history
    review_focus_history_state = (root / "src" / "appReviewFocusHistoryState.ts").read_text(encoding="utf-8")
    assert "reviewFocusHistoryStorageKey" in review_focus_history_state
    assert "useReviewFocusHistoryState" in review_focus_history_state
    app_preferences_state = (root / "src" / "appPreferencesState.ts").read_text(encoding="utf-8")
    assert "photoImportFlagStorageKey" in app_preferences_state
    assert "readOnboardingDismissed" in app_preferences_state
    app_media_destinations_state = (root / "src" / "appMediaDestinationsState.ts").read_text(encoding="utf-8")
    assert "mediaActionDestinationsStorageKey" in app_media_destinations_state
    assert "upsertMediaActionDestination" in app_media_destinations_state
    app_review_session_state = (root / "src" / "appReviewSessionState.ts").read_text(encoding="utf-8")
    assert "reviewPrefStorageKey" in app_review_session_state
    assert "writeReviewPref" in app_review_session_state
    assert "Inline Review More" in photos_view
    assert "reviewInlineCandidate" in photos_view
    assert "reviewCandidate: (status: CandidateStatus, candidate: ReviewCandidate)" in photos_view
    assert "reassignSelectedMatches" in photos_view
    assert "removeSelectedMatches" in photos_view
    assert "Move selected matches to person" in photo_selection_bulk_metadata_controls
    assert "Remove matches" in photo_selection_bulk_metadata_controls
    assert "await loadPhotoOperations();" in photos_view
    assert "reviewMoreForActiveGroup" in photos_view
    assert "activeGroupReviewCandidates" in photos_view
    assert "Find duplicates" in photos_view
    assert "Find duplicates" in photo_people_gallery
    assert "Duplicate people suggestions" in photos_view
    assert "Near duplicate" in photo_duplicate_review
    assert "perceptual_dhash" in photo_duplicate_review
    assert "Dismiss duplicate group" in photos_view
    assert "dismissPhotoDuplicateGroup" in photos_view
    assert "Duplicate comparison" in photos_view
    assert "Visual duplicate comparison" in photos_view
    assert "PhotoDuplicateReviewPanel" in photos_view
    assert "photos-duplicate-review-panel" not in photos_view
    assert "Duplicate review" in photo_duplicate_review_panel
    assert "Keep recommended" in photo_duplicate_review_panel
    assert "Keep this" in photo_duplicate_review_panel
    assert "photos-duplicate-review-panel" in photo_duplicate_review_panel
    assert "buildPhotoDuplicateComparisonRows" in photos_view
    assert "buildPhotoDuplicateBrowserReviewGroups" in photos_view
    assert "photos-duplicate-comparison-panel" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "photos-duplicate-visual-compare" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "photos-duplicate-review-panel" in (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "groupPeople" in photos_view
    assert "groupPets" in photos_view
    assert "Pets in group" in photos_view
    assert "Excluded pets" in photos_view
    assert "savePhotoPeopleGroup" in photos_view
    assert "deletePhotoPeopleGroup" in photos_view
    assert "Create group" in photos_view
    assert "Save group" in photos_view
    assert "Use as group cover" in photos_view
    assert "Best group photos" in photos_view
    assert "groupViewMode" in photos_view
    assert "groupMode" in photos_view
    assert "Move match to" in photos_view
    assert "Move to person" in photos_view
    assert "Remove person from photo" in photos_view
    assert "reviewCandidates" in photos_view
    assert "duplicatePeople" in photos_view
    assert "manualOrder" in photos_view
    assert '"group"' in (root / "src" / "types.ts").read_text(encoding="utf-8")
    api_server = (root / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
    assert "group:" in api_server
    assert "group:saved:" in api_server
    assert "_photo_best_group_entries" in api_server
    assert "member_pets_json" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_people_group_members_from_id" in api_server
    assert "photo_people_groups" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_entry_matches_people_group" in api_server
    assert "PhotoLibrarySearchPanel" in photos_view
    assert "Library search results" in photo_library_search_panel
    assert "Library search" in photo_library_search_panel
    assert "Searching library..." in photo_library_search_panel
    assert "No library matches" in photo_library_search_panel
    assert "searchSuggestions" in photos_view
    assert "buildPhotoSearchSuggestions" in photos_view
    assert "buildPhotoSearchHighlightParts" in search_highlights
    assert "renderSearchHighlight" in photos_view
    assert "photo-search-highlight" in styles_css
    assert "PhotoRailDisplayControls" in photos_view
    assert "photo-rail-display-controls" in photo_rail_display_controls
    assert "Collection display" in photo_rail_display_controls
    assert "Utilities" in photo_rail_display_controls
    assert "Sensitive" in photo_rail_display_controls
    assert "Screenshots" in photo_rail_display_controls
    assert "Shared" in photo_rail_display_controls
    assert "Low-value" in photo_rail_display_controls
    assert "showScreenshotCollections" in photos_view
    assert "showSharedCollections" in photos_view
    assert "showLowValueCollections" in photos_view
    assert "screen_recording" in photos_view
    assert "detectMissingOriginals" in photos_view
    assert "Missing originals" in photo_load_status_alerts_panel
    assert "relinkPhotoLibraryPaths" in photos_view
    assert "Relink folder" in photos_view
    assert "consolidatePhotoLibraryAssets" in photos_view
    assert "Consolidate" in photos_view
    assert "Consolidate" in photo_selection_original_actions
    assert "buildPhotoConsolidationSummary" in photos_view
    assert "PhotoConsolidationResultPanel" in photos_view
    assert "photo-consolidation-result" not in photos_view
    assert "photo-consolidation-result" in photo_consolidation_panels
    assert "Managed folder" in photo_consolidation_panels
    assert "Originals copied" in (root / "src" / "views" / "photoConsolidationResult.ts").read_text(encoding="utf-8")
    assert "photo-missing-badge" in photo_grid_tile
    assert "Original file is missing" not in photos_view
    assert "Original file is missing" in photo_lightbox_primary_actions
    assert "filterPhotoRailFolders" in photos_view
    assert "buildPhotoRailSections" in photos_view
    assert "collapsedRailSections" in photos_view
    assert "railSectionOrder" in photos_view
    assert "railItemOrder" in photos_view
    assert "Move collection up" in photos_view
    assert "Move collection down" in photos_view
    assert "recordPhotoAssetEvent" in photos_view
    assert "PHOTO_IMPORT_SOURCE_OPTIONS" in photo_rail_import_controls
    assert "Import source" in photo_rail_import_controls
    assert "Edit import source" in photo_import_provenance_editor
    assert "updatePhotoImportSessionProvenance" in photos_view
    assert "archivePhotoImportSessions" in photos_view
    assert "photoImportSourceLabel" in photos_view
    assert "prepareImportPaths" in photos_view
    assert "Drop photos or folders to import" in photos_view
    assert "Keep folder organization" in photo_rail_import_controls
    assert "Keep folders" not in photos_view
    assert "Keep folders" in photo_managed_roots_panel
    assert "Inside workspace backup" in photo_managed_roots_panel
    assert "Workspace managed root" in photo_managed_roots_panel
    assert "Managed copy destination" in photo_managed_roots_panel
    assert "importKeepFolderOrganization" in photos_view
    assert "PHOTO_IMPORT_KEEP_FOLDERS_KEY" in photos_view
    assert "keepFolderOrganization" in photos_view
    assert "keepFolderOrganizationDefault" in photos_view
    assert "externalBackupCovered" in photos_view
    assert "relatedMediaCopiedCount" in types_ts
    assert "Reveal original" in photos_view
    assert "Open original" in photos_view
    assert "Reveal original" in photo_selection_original_actions
    assert "Open original" in photo_selection_original_actions
    assert "Saved from" in photos_view
    assert "importSourceKind" in types_ts
    assert "recentlyViewed" in api_server
    assert "recentlyShared" in api_server
    assert "recentlySaved" in api_server
    assert "keep_folder_organization" in api_server
    assert "_photo_managed_root_keep_folder_default" in api_server
    assert "managed_root_policy" in api_server
    assert "externalManagedAssetsRequiringBackup" in api_server
    assert "keepFolderOrganization" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_clean_photo_managed_root_policy" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_managed_import_relative_parent" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "media:screenshot" in api_server
    assert "media:screen_recording" in api_server
    assert "media:panorama" in api_server
    assert "media:portrait" in api_server
    assert "media:burst" in api_server
    assert "media:time_lapse" in api_server
    assert "PHOTO_MEDIA_KINDS" in api_server
    assert '"panorama"' in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "Panoramas" in photos_view
    assert "Portraits" in photos_view
    assert "Bursts" in photos_view
    assert "Time-lapse" in photos_view
    assert "PHOTO_UTILITY_CLASSIFIERS" in api_server
    assert "utility:documents" in api_server
    assert "utility:receipts" in api_server
    assert "utility:qr" in api_server
    assert "utility:handwriting" in api_server
    assert "utility:illustrations" in api_server
    assert "utility:sensitive" in api_server
    assert "sensitiveTags" in api_server
    assert "_photo_utility_classifier_match_evidence" in api_server
    assert "_clean_photo_utility_classifier_review" in api_server
    assert "utilityClassifierReview" in api_server
    assert '"utilityMatch"' in api_server
    assert "utilityClassifier" in types_ts
    assert "_photo_asset_qr_metadata" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "QRCodeDetector" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "barcodeSource" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "qrRegions" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_asset_qr_regions_from_points" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_asset_pyzbar_barcode_results" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_asset_barcode_metadata_from_results" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "pyzbar" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "test_photo_qr_decoder_does_not_open_network_sockets" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_local_barcode_decoder_populates_search_without_qr_collection" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    qr_actions = (root / "src" / "views" / "photoQrActions.ts").read_text(encoding="utf-8")
    assert "buildPhotoQrActions" in qr_actions
    assert "buildPhotoQrRegions" in qr_actions
    assert "Copy URL" in qr_actions
    assert "Copy email" in qr_actions
    assert "Copy phone" in qr_actions
    assert "Copy contact" in qr_actions
    assert "QR code" in photos_view
    assert "lightItemQrActions" in photos_view
    assert "lightItemQrRegions" in photos_view
    assert "Select QR region" not in photos_view
    assert "Select QR region" in photo_lightbox_stage
    assert "QR regions" in photos_view
    assert "photos-qr-region-layer" not in photos_view
    assert "photos-qr-region-layer" in photo_lightbox_stage
    assert "photos-qr-region-summary" in styles_css
    live_text_actions = (root / "src" / "views" / "photoLiveTextActions.ts").read_text(encoding="utf-8")
    assert "buildPhotoLiveTextActions" in live_text_actions
    assert "buildPhotoLiveTextActionsForText" in live_text_actions
    assert "data:text/vcard" in live_text_actions
    assert "downloadName" in live_text_actions
    assert "Copy detected text" in live_text_actions
    assert "Copy selected text" in photos_view
    assert "Index loaded OCR" in photos_view
    assert "Reindex loaded OCR" in photos_view
    assert "Retry failed OCR" in photos_view
    assert "Index pending OCR" in photos_view
    assert "OCR failed jobs" in photos_view
    assert "Retry failed barcodes" in photos_view
    assert "Index pending barcodes" in photos_view
    assert "Barcode failed jobs" in photos_view
    assert "Index detected items" in photos_view
    assert "Reindex detected items" in photos_view
    assert "Retry detected items" in photos_view
    assert "Index pending detected items" in photos_view
    assert "Detected item jobs with no labels" in photos_view
    assert "PhotoIndexingQueuePanel" in photos_view
    assert "PhotoIndexingNoticePanel" in photos_view
    assert "Queue loaded OCR" not in photos_view
    assert "Queue loaded OCR" in photo_indexing_queue_panel
    assert "Queue pending OCR" in photo_indexing_queue_panel
    assert "Queue pending barcodes" in photo_indexing_queue_panel
    assert "Queue loaded detected items" in photo_indexing_queue_panel
    assert "Queue pending detected items" in photo_indexing_queue_panel
    assert "Run next" in photo_indexing_queue_panel
    assert "Run queue" in photo_indexing_queue_panel
    assert "Retry failed queue" in photo_indexing_queue_panel
    assert "Cancel indexing job" in photo_indexing_queue_panel
    assert "Dismiss indexing job" in photo_indexing_queue_panel
    assert "Retry indexing job" in photo_indexing_queue_panel
    assert "attempts" in photo_indexing_queue_panel
    assert "lastHistoryLabel" in photo_indexing_queue_panel
    assert "activeJobId={photoIndexingActiveJobId}" in photos_view
    assert "photo-indexing-job-details" not in photos_view
    assert "photo-indexing-job-details" in photo_indexing_queue_panel
    assert "Job details" in photo_indexing_queue_panel
    assert "photo-search-index-notice" not in photos_view
    assert "photo-search-index-notice" in photo_indexing_notice_panel
    assert "photo-catalog-index-notice" in photo_indexing_notice_panel
    assert "Search index is catching up" in photo_indexing_notice_panel
    assert "Catalog refresh progress" in photo_indexing_notice_panel
    assert "Run next" in photo_indexing_notice_panel
    assert "PhotoExportResultPanel" in photos_view
    assert "photo-export-result-row-details" not in photos_view
    assert "photo-export-result-success-details" not in photos_view
    assert "photo-export-result-row-details" in photo_export_result_panel
    assert "photo-export-result-success-details" in photo_export_result_panel
    assert "Export details" in photo_export_result_panel
    assert "Written files" in photo_export_result_panel
    assert "No target was written." in photo_selection_export_results
    assert "Photos mixed export result shows written files and capped missing issues" in photos_e2e
    assert "panel.successRows.length > 0" in photo_export_result_panel
    assert "PhotoOperationUndoPanel" in photos_view
    assert "photo-operation-details" not in photos_view
    assert "photo-operation-details" in photo_operation_undo_panel
    assert "Action details" in photo_operation_undo_panel
    assert "PhotoRestoreRehearsalSummary" in photo_repair_center_section
    assert "PhotoBackupRestoreRehearsalSummary" in photo_repair_center_section
    assert "photo-restore-rehearsal-details" in photo_restore_rehearsal_panels
    assert "Restore details" in photo_restore_rehearsal_panels
    assert "photo-backup-restore-details" in photo_restore_rehearsal_panels
    assert "Backup details" in photo_restore_rehearsal_panels
    assert "Auto-run indexing queue" not in photos_view
    assert "Auto-run indexing queue" in photo_intelligence_settings_panel
    assert "photo-indexing-job-list" not in photos_view
    assert "photo-indexing-job-list" in photo_indexing_queue_panel
    assert "photo-indexing-job-row" in styles_css
    assert "photo-indexing-job-details" in styles_css
    assert "photo-export-result-row-details" in styles_css
    assert "photo-export-result-success-details" in styles_css
    assert "photo-operation-details" in styles_css
    assert "photo-restore-rehearsal-details" in styles_css
    assert "photo-backup-restore-details" in styles_css
    assert "Photos QR barcode overlays and indexing controls work in browser flows" in photos_e2e
    assert "Select QR region: https://example.test/e2e-pass" in photos_e2e
    assert "History: attempt 1 failed" in photos_e2e
    assert "Result: missing" in photos_e2e
    assert "Render format: jpeg" in photos_e2e
    assert "Type: visibility_delete" in photos_e2e
    assert "Operation: visibility_delete" in photos_e2e
    assert "metadata_only" in photos_e2e
    assert "Catalog: restorable" in photos_e2e
    assert "Check: photos-readiness" in photos_e2e
    assert "Severity: error" in photos_e2e
    assert "Index all pending barcodes" in photos_e2e
    assert "PhotoLocalIndexingStatusPanel" in photos_view
    assert "photoLocalIndexingStatusSections" in photos_view
    assert "photo-ocr-failure-list" not in photos_view
    assert "photo-ocr-failure-list" in photo_local_indexing_status_panel
    assert "failedOnly" in photos_view
    assert "pendingOnly" in photos_view
    assert "Refresh OCR index status" in photos_view
    assert "Pause indexing" not in photos_view
    assert "Pause indexing" in photo_intelligence_settings_panel
    assert "Indexing budget" not in photos_view
    assert "Indexing budget" in photo_intelligence_settings_panel
    assert "backgroundIndexingPaused" in photos_view
    assert "backgroundIndexingAutoRun" in photos_view
    assert "indexingPowerMode" in photos_view
    assert "indexPhotoOcr={indexPhotoOcr}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "photoOcrIndexStatus={photoOcrIndexStatus}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "indexPhotoBarcodes={indexPhotoBarcodes}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "photoBarcodeIndexStatus={photoBarcodeIndexStatus}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "indexPhotoObjects={indexPhotoObjects}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "photoObjectIndexStatus={photoObjectIndexStatus}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "enqueuePhotoIndexingJob={enqueuePhotoIndexingJob}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "photoIndexingJobs={photoIndexingJobs}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "runPhotoIndexingJob={runPhotoIndexingJob}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "runPhotoIndexingQueue={runPhotoIndexingQueue}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "cancelPhotoIndexingJob={cancelPhotoIndexingJob}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "dismissPhotoIndexingJob={dismissPhotoIndexingJob}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "index_photo_ocr" in api_server
    assert "photo_ocr_index_status" in api_server
    assert "remove_keys=ocr_metadata_keys" in api_server
    assert "index_photo_barcodes" in api_server
    assert "photo_barcode_index_status" in api_server
    assert "index_photo_objects" in api_server
    assert "photo_object_index_status" in api_server
    assert "enqueue_photo_indexing_job" in api_server
    assert "photo_indexing_jobs" in api_server
    assert "run_photo_indexing_job" in api_server
    assert "run_photo_indexing_queue" in api_server
    assert "includeFailed" in api_server
    assert "CROSSAGE_PHOTO_INDEXING_JOB_DELAY_MS" in api_server
    assert "cancel_photo_indexing_job" in api_server
    assert "dismiss_photo_indexing_job" in api_server
    assert "increment_attempts" in api_server
    assert "history_entry" in api_server
    assert "photo_indexing_jobs" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "photo_indexing_jobs" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "index_photo_objects" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "index_photo_objects" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photo_object_index_status" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "photo_object_index_status" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "run_photo_indexing_queue" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "run_photo_indexing_queue" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "startPhotoIndexingHeadlessScheduler" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "stopPhotoIndexingHeadlessScheduler" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "CROSSAGE_PHOTO_INDEXING_HEADLESS_INTERVAL_MS" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photoIndexingHeadlessRuntimePolicy" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photoIndexingHeadlessPowerState" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "CROSSAGE_PHOTO_INDEXING_FORCE_BATTERY" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "CROSSAGE_PHOTO_INDEXING_IGNORE_RUNTIME_POLICY" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photo_indexing_headless_runtime_skip" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photo_indexing_headless_scheduler" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "Photos headless local indexing scheduler runs queued jobs outside Photos view" in photos_e2e
    assert "Photos headless local indexing scheduler respects battery runtime policy" in photos_e2e
    assert "cancel_photo_indexing_job" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "cancel_photo_indexing_job" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "dismiss_photo_indexing_job" in (root / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    assert "dismiss_photo_indexing_job" in (root / "desktop" / "main.cjs").read_text(encoding="utf-8")
    assert "photo_indexing_jobs" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "attempts_count" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "history_json" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "backgroundIndexingPaused" in api_server
    assert "backgroundIndexingAutoRun" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "indexingPowerMode" in api_server
    assert "failedOnly" in api_server
    assert "pendingOnly" in api_server
    assert "localBarcode" in api_server
    assert "localObjectTags" in api_server
    assert "test_photo_barcode_index_retry_and_pending_scopes" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_object_index_status_and_queue_materializes_metadata_tags" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_indexing_jobs_persist_and_run_local_ocr_queue" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_ocr_indexing_does_not_open_network_sockets" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_indexing_queue_does_not_open_network_sockets" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "pending_after_failure" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "ZXOCRPAYLOAD8719" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "_photo_ocr_text_from_sidecar" in api_server
    assert "_photo_ocr_regions_from_text" in api_server
    assert "_photo_ocr_parse_tesseract_tsv" in api_server
    assert "_photo_ocr_detect_script" in api_server
    assert "_photo_ocr_apply_script_metadata" in api_server
    assert "detectedScript" in api_server
    assert "detectedLanguageSource" in api_server
    assert "_photo_ocr_text_from_tesseract" in api_server
    assert "tesseract-tsv" in api_server
    assert "test_photo_ocr_tesseract_tsv_regions_are_pixel_accurate" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "test_photo_ocr_script_detection_propagates_to_regions_and_blocks" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "Open detected URL" in live_text_actions
    assert "Email detected address" in live_text_actions
    assert "Call detected phone" in live_text_actions
    assert "Save contact card" in live_text_actions
    assert "Copy contact" in live_text_actions
    assert "BEGIN:VCARD" in live_text_actions
    assert "Live Text" in photos_view
    assert "lightItemLiveTextActions" in photos_view
    assert "selectedLiveTextRegionId" in photos_view
    assert "Live Text regions" in photos_view
    assert "Select Live Text snippet" in photos_view
    assert "Select text region" not in photos_view
    assert "Select text region" in photo_lightbox_stage
    assert "Clear selected text" in photos_view
    assert "OCR metadata" in photos_view
    assert "ocrMetadata" in (root / "src" / "views" / "photoInfoMetadata.ts").read_text(encoding="utf-8")
    assert "copyLightboxLiveTextAction" in photos_view
    assert "download={action.downloadName || undefined}" in photos_view
    assert "copyText={copyText}" in (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "photoEventActivityText" in photos_view
    assert "metadata: photoSelectionShareEventMetadata(shareDraft, result)" in photos_view
    assert "photoSelectionShareEventMetadata" in photo_selection_export_results
    assert "eventMetadata" in photo_display_text
    assert "eventMetadata" in (root / "src" / "types.ts").read_text(encoding="utf-8")
    assert "event_details_by_asset_id" in api_server
    assert "\"eventMetadata\"" in api_server
    assert "session\": \"unit\"" in (root / "tests" / "photo_folders_units.py").read_text(encoding="utf-8")
    assert "_photo_asset_accessibility_description_text" in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "accessibilityDescription" in photos_view
    assert "accessibleDescriptionDraft" in photos_view
    assert "Accessible image description" in photos_view
    assert "photoEditableAccessibleDescription" in photos_view
    assert "descriptionRegionsDraft" in photos_view
    assert "Description regions" in photos_view
    assert "Image description regions" in photos_view
    assert "photos-description-region-layer" not in photos_view
    assert "photos-description-region-layer" in photo_lightbox_stage
    description_regions = (root / "src" / "views" / "photoDescriptionRegions.ts").read_text(encoding="utf-8")
    assert "buildPhotoDescriptionRegions" in description_regions
    assert "serializePhotoDescriptionRegions" in description_regions
    assert "photoDescriptionRegionsEquivalent" in description_regions
    assert '"descriptionRegions"' in description_regions
    assert '"descriptionRegions"' in search_suggestions
    assert '"descriptionRegions"' in api_server
    assert '"descriptionRegions"' in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "photos-description-region-summary" in styles_css
    assert "Image description" in photos_view
    assert "accessibilityDescription" in search_suggestions
    assert "Detected text" in photos_view
    assert "Detected items" in photos_view
    assert "objectTagReview" in photos_view
    assert "photoObjectTagReviewRows" in photos_view
    assert "selectedObjectTagRegionId" in photos_view
    assert "photos-object-tag-region" not in photos_view
    assert "photos-object-tag-region" in photo_lightbox_stage
    assert "visualLookupObjectTagId" in photos_view
    assert "Look up detected item" in photos_view
    assert "Search library" in photos_view
    assert "Confirm detected item" in photos_view
    assert "Hide detected item" in photos_view
    assert "Confirm match" in photos_view
    assert "photoUtilityRejectLabel" in photos_view
    assert "Not sensitive" in photo_utility_classifier_review
    assert "Undo utility review" in photos_view
    assert "utilityClassifierReview" in photos_view
    assert "_clean_photo_object_tag_review" in api_server
    assert '"objectTagReview"' in api_server
    assert '"objectTagReview"' in (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    photo_info_metadata = (root / "src" / "views" / "photoInfoMetadata.ts").read_text(encoding="utf-8")
    assert "buildPhotoTechnicalMetadata" in photos_view
    assert "Camera" in photos_view
    assert "Lens" in photos_view
    assert "Camera settings" in photos_view
    assert "Software" in photos_view
    assert "Codec" in photos_view
    assert "Color profile" in photos_view
    assert "Photographic Style" in photos_view
    assert "Depth / Portrait" in photos_view
    assert "Depth and Portrait controls" in photos_view
    assert "Depth aperture" in photos_view
    assert "Depth focus distance" in photos_view
    assert "Depth portrait effect" in photos_view
    assert "photos-depth-controls" in styles_css
    assert "cameraMake" in photo_info_metadata
    assert "lensModel" in photo_info_metadata
    assert "focalLengthMm" in photo_info_metadata
    assert "exposureTime" in photo_info_metadata
    assert "isoSpeed" in photo_info_metadata
    assert "orientation" in photo_info_metadata
    assert "videoCodec" in photo_info_metadata
    assert "colorProfile" in photo_info_metadata
    assert "photographicStyle" in photo_info_metadata
    assert "depthMetadata" in photo_info_metadata
    assert "localDepthControls" in photo_info_metadata
    assert "photographicStyle" in search_suggestions
    assert "codecName" in search_suggestions
    assert "colorProfile" in search_suggestions
    assert "localDepthControls" in search_suggestions
    assert "cinematicMode" in search_suggestions
    assert "depthMap" in search_suggestions
    assert "_photo_entry_depth_metadata_text" in api_server
    assert "_clean_photo_local_depth_controls" in api_server
    assert '"localDepthControls"' in api_server
    assert "_photo_entry_technical_metadata_text" in api_server
    assert "Technical" in api_server
    workspace_db = (root / "crossage_fr" / "store" / "workspace_db.py").read_text(encoding="utf-8")
    assert "_photo_asset_technical_metadata_text" in workspace_db
    assert "_photo_asset_depth_metadata_text" in workspace_db
    assert '"localDepthControls"' in workspace_db
    assert "xmpConflicts" in photo_info_metadata
    assert "xmpConflicts" in photos_view
    assert "objectTags" in search_suggestions
    assert "sceneTags" in search_suggestions
    assert "detectedEvents" in search_suggestions
    smart_query_builder = (root / "src" / "views" / "photoSmartQueryBuilder.ts").read_text(encoding="utf-8")
    assert '"ocrText"' in smart_query_builder
    assert '"detectedItem"' in smart_query_builder
    assert '"modelTag"' in smart_query_builder
    assert '"sceneTag"' in smart_query_builder
    assert '"detectedEvent"' in smart_query_builder
    assert '"imageDescription"' in smart_query_builder
    assert '"group"' in smart_query_builder
    assert '"personCount"' in smart_query_builder
    assert '"faceCount"' in smart_query_builder
    assert '"matchCount"' in smart_query_builder
    assert '"lens"' in smart_query_builder
    assert '"dimensions"' in smart_query_builder
    assert '"megapixels"' in smart_query_builder
    assert '"duration"' in smart_query_builder
    assert '"durationMs"' in smart_query_builder
    assert '"nearby"' in smart_query_builder
    assert '"ocrConfidence"' in smart_query_builder
    assert '"detectedItemConfidence"' in smart_query_builder
    assert '"detectedEventConfidence"' in smart_query_builder
    assert '"modelConfidence"' in smart_query_builder
    date_operator_block = smart_query_builder.split("const DATE_OPERATORS", 1)[1].split("const NUMBER_OPERATORS", 1)[0]
    number_operator_block = smart_query_builder.split("const NUMBER_OPERATORS", 1)[1].split("const RECENT_OPERATORS", 1)[0]
    assert '{ operator: "isNot", label: "is not" }' in date_operator_block
    assert '{ operator: "isNot", label: "is not" }' in number_operator_block
    assert '"detectedEvent"' in api_server
    assert '"peoplegroup": "group"' in api_server
    assert '"personcount": "personCount"' in api_server
    assert '"matchcount": "matchCount"' in api_server
    assert '"objectconfidence": "detectedItemConfidence"' in api_server
    assert '"ocrconfidence": "ocrConfidence"' in api_server
    assert '"detectedeventconfidence": "detectedEventConfidence"' in api_server
    assert '"lensmodel": "lens"' in api_server
    assert '"pixelwidth": "width"' in api_server
    assert '"durationseconds": "duration"' in api_server
    assert '"nearby": "nearby"' in api_server
    saved_search = (root / "src" / "views" / "photoSavedSearch.ts").read_text(encoding="utf-8")
    assert "combineSmartQueryWithPeople" in saved_search
    assert "includePeople" in saved_search
    assert "isNot" in saved_search
    assert "setIncludePeople([])" in photos_view
    assert "smartQueryGroupFromAlbumRules(albumRules, { includePeople, excludePeople })" in photos_view
    assert "migratePhotoSmartAlbums({ albumId, apply: true })" in photos_view
    assert "Migrate album" not in photos_view
    assert "Migrate album" in photo_album_editor_panel
    assert "Move section up" in photos_view
    assert "Move section down" in photos_view
    assert "Save sort as custom" in photos_view
    assert "saveCurrentSortAsManualAlbumOrder" in photos_view
    assert "Photos manual albums save current filename sort as custom order" in photos_e2e
    assert '"appended": len(appended_asset_ids)' in workspace_db
    assert '"appended": result.get("appended", 0)' in api_server
    assert "Manual stale order" in photo_folders
    assert "missing-order.jpg" in photo_folders
    assert "duplicatingAlbumId" in photos_view
    assert "loadAlbumSourceOrderById" in photos_view
    assert "Photos album editor edits duplicates merges and deletes manual albums" in photos_e2e
    assert "canSavePhotoSortAsAlbumOrder" in (root / "src" / "views" / "photoAlbumOrdering.ts").read_text(encoding="utf-8")
    assert "Pin collection" in photos_view
    assert "Unpin collection" in photos_view
    assert "Smart Albums" in photos_view
    assert "Media Types" in photos_view
    assert "modelTags" in search_suggestions
    assert "ocrText" in search_suggestions
    assert "CREATE TABLE IF NOT EXISTS photo_ocr_blocks" in workspace_db
    assert "replace_photo_ocr_blocks" in workspace_db
    assert "delete_photo_ocr_blocks" in workspace_db
    assert "photo_ocr_blocks_for_asset" in workspace_db
    assert "_photo_ocr_blocks_text_by_asset_ids" in workspace_db
    assert "ocrBlockCount" in api_server
    assert "ocrBlocksRemoved" in api_server
    assert "schema_only_search" in photo_folders
    assert "CREATE TABLE IF NOT EXISTS photo_object_tags" in workspace_db
    assert "replace_photo_object_tags_from_metadata" in workspace_db
    assert "photo_object_tags_from_metadata" in workspace_db
    assert "repair_photo_object_tags_index_batch" in workspace_db
    assert "photo_object_tag_counts" in workspace_db
    assert "_photo_object_tags_text_by_asset_ids" in workspace_db
    assert "photo_object_tags_for_asset" in api_server
    assert "Detected items" in api_server
    assert "schema_object_result" in photo_folders
    assert "Schema object negative exact" in photo_folders
    assert "suggestions: librarySearchResult?.suggestions || []" in photos_view
    assert "suggestionLimit: 32" in photos_view
    assert "item.snippet" in photo_library_search_panel
    assert "Photos global search shows categorized local results snippets and routes" in photos_e2e
    assert "Local semantic search" in photo_library_search_panel
    assert "PhotoSemanticSearchPanel" in photos_view
    assert "photos-semantic-search" not in photos_view
    assert "photos-semantic-search" in photo_semantic_search_panel
    assert "Semantic search results" in photo_semantic_search_panel
    assert "photo-semantic-score" in photo_semantic_search_panel
    assert "semanticQueries" in types_ts
    assert "_photo_semantic_search_queries" in api_server
    assert "PHOTO_SEMANTIC_SEARCH_ALIASES" in api_server
    assert "Semantic match:" in api_server
    assert "search_photo_source_folders" in workspace_db
    assert '"sourceFolders"' in api_server
    assert 'item.kind === "sourceFolder"' in photo_library_search_panel
    assert "_photo_search_folder_candidates" in api_server
    assert "for suggestion in sorted(" in api_server
    assert ")[:suggestion_limit]" in api_server
    assert "recentlyDeleted" in rail_visibility
    assert "showSensitive" in rail_visibility
    assert "showScreenshots" in rail_visibility
    assert "showShared" in rail_visibility
    assert "showLowValueUtilities" in rail_visibility
    assert "LOW_VALUE_UTILITY_PHOTO_FOLDER_IDS" in rail_visibility
    assert "photoRailSectionIdForFolder" in rail_visibility
    assert "movePhotoRailSection" in rail_visibility
    assert "moveVisiblePhotoRailSectionToPosition" in rail_visibility
    assert "movePhotoRailItem" in rail_visibility
    assert "movePhotoRailItemToPosition" in rail_visibility
    assert "photoRailSectionSupportsItemOrder" in rail_visibility
    assert "photoRailAlbumTreeDepth" in rail_visibility
    assert "normalizePhotoRailSectionOrder" in rail_visibility
    assert "PhotoLocalRailItemDragState" in photos_view
    assert "PhotoRailSectionDragState" in photos_view
    assert "updateRailSectionDragTarget" in photos_view
    assert "applyRailSectionDrop" in photos_view
    assert "updateLocalRailItemDragTarget" in photos_view
    assert "applyLocalRailItemDrop" in photos_view
    assert "setLocalRailItemDrag" in photos_view
    assert '"pinned"' in rail_visibility
    assert '"smartAlbums"' in rail_visibility
    assert '"memories"' in rail_visibility
    assert 'folder.kind === "memory"' in rail_visibility
    assert "buildPhotoFilterChips" in filter_chips
    assert "Search:" in filter_chips
    assert "Keyword:" in filter_chips
    assert "Media:" in filter_chips
    assert "Person:" in filter_chips
    assert "Status:" in filter_chips
    assert "Quality >=" in filter_chips
    assert "From:" in filter_chips
    assert "Through:" in filter_chips
    assert "Source:" in filter_chips
    assert "File:" in filter_chips
    assert "Duplicates" in filter_chips
    assert "Location:" in filter_chips
    assert "Camera:" in filter_chips
    assert "Album:" in filter_chips
    assert "All visibility" in filter_chips
    assert "favoriteOnly" in saved_search
    assert "editedOnly" in saved_search
    assert "person" in saved_search
    assert "statuses" in saved_search
    assert "minQuality" in saved_search
    assert "dateFrom" in saved_search
    assert "dateTo" in saved_search
    assert "fileType" in saved_search
    assert "duplicate" in saved_search
    assert "location" in saved_search
    assert "camera" in saved_search
    assert "album" in saved_search
    assert "notInAlbum" in saved_search
    assert "hidden" in saved_search
    assert "deleted" in saved_search
    assert "Created from the active Photos search" in saved_search
    assert '"recentDays"' in date_views
    assert "photoDateText" in date_views
    assert "formatPhotoDateBucketLabel" in date_views
    assert "buildPhotoDateBucketSummaryBadges" in date_views
    assert "photoDateBucketCoverReason" in date_views
    assert "photoDateItemDuplicateCount" in date_views
    assert "photoDateItemVersionCount" in date_views
    assert "duplicateGroup" in date_views
    assert "editStackVersionCount" in date_views
    assert "MONTH_NAMES" in date_views
    assert "MONTH_SHORT_NAMES" in date_views
    assert "estimatePhotoGridColumns" in virtual_grid
    assert "windowPhotoVirtualGridLayout" in virtual_grid
    assert "photoLocationPickerPoint" in location_picker
    assert "photoLocationFromClientPoint" in location_picker
    assert "formatPhotoLocationCoordinate" in location_picker
    assert "Show nearby" in photos_view
    assert "Video quality" in photo_export_video_controls
    assert "_photo_export_render_video" in api_server
    assert '"videoRendered"' in api_server
    assert "activeTrip" in photos_view
    assert "tripCount" in photos_view
    assert 'folder.kind === "trip"' in rail_visibility
    assert "nearbyLabel" in filter_chips
    assert "_photo_place_inferred_location" in workspace_db
    assert "_photo_place_distance_km" in workspace_db
    assert "_photo_nearby_filter_from_params" in api_server
    assert "_photo_entry_matches_nearby_filter" in api_server
    assert "_photo_date_bucket_cover_rank" in api_server
    assert "_photo_date_bucket_summary_badges" in api_server
    assert "_photo_trip_summaries" in api_server
    assert "_photo_trip_by_id" in api_server
    assert "_photo_memory_summaries" in api_server
    assert "_photo_memory_by_id" in api_server
    assert "_photo_memory_removed_sources" in api_server
    assert "userCreated" in api_server
    assert "coverSourcePath" in api_server
    assert '"album_items_remove"' in workspace_db
    assert '"album_items"' in workspace_db
    assert '"metadata_update"' in api_server
    assert "_photo_operation_metadata_payload" in workspace_db
    assert '"person_labels"' in workspace_db
    assert "photo_person_label_undo_snapshot" in workspace_db
    assert "record_photo_person_label_operation" in workspace_db
    assert '"review_candidate_correction"' in workspace_db
    assert "record_review_candidate_correction_operation" in workspace_db
    assert "_restore_review_candidate_correction_operation" in workspace_db
    enroll_manager = (root / "crossage_fr" / "enroll" / "manager.py").read_text(encoding="utf-8")
    photos_view = (root / "src" / "views" / "PhotosView.tsx").read_text(encoding="utf-8")
    assert "restore_person_label_references" in enroll_manager
    assert "review_candidate_correction_undo_snapshot" in enroll_manager
    assert '"sourceFilename"' in enroll_manager
    assert "photoPeopleMatchCorrectionCandidateIds" in photo_people_match_selection
    assert "selectedMatchCandidateIds" in photos_view
    assert "suggest_photo_review_more_candidates" in api_server
    assert "suggest_photo_review_more_candidates" in workspace_db
    assert "nearest_neighbor_review_more" in workspace_db
    assert "suggestPhotoReviewMoreCandidates" in photos_view
    assert '"operation": result.get("operation", {})' in api_server
    assert '"review_candidate_correction"' in api_server
    assert '"file_moves"' in workspace_db
    assert "record_photo_file_move_operation" in workspace_db
    assert '"asset_catalog"' in workspace_db
    assert "record_photo_catalog_delete_operation" in workspace_db
    assert "photo_restore_rehearsal" in workspace_db
    assert "managed_trash_missing" in workspace_db
    assert '"managedOriginalTrash"' in workspace_db
    assert '"managedOriginalsTrashed"' in workspace_db
    assert '"photo_restore_rehearsal"' in api_server
    assert '"photo_backup_restore_rehearsal"' in api_server
    assert '"photo_library_preview_sweep"' in api_server
    assert '"create_photo_media_pair"' in api_server
    assert '"relink_photo_media_pair"' in api_server
    assert '"delete_photo_media_pair"' in api_server
    assert "suppressed_generated_pairs" in api_server
    assert "Photos lightbox related media can add relink remove and ignore generated pairs" in photos_e2e
    assert "Related media added." in photos_e2e
    assert "Related media relinked." in photos_e2e
    assert "Generated related media ignored." in photos_e2e
    assert "photoMediaPairShareEventMetadata" in photos_view
    assert "native_share_related_media" in photo_media_pairs
    assert "photos-related-media" in photos_view
    assert "grantDecoratedMediaPath(mediaPair.relatedSourcePath)" in desktop_main
    assert 'decoratePath(mediaPair, "relatedSourcePath", "relatedSourceUrl")' in desktop_main
    assert "function grantQueryMediaPath(filePath, trustGeneration = pathTrustGeneration)" in desktop_main
    assert "__relatedMediaSharePaths" in photos_e2e
    assert "manual-related.dng" in photos_e2e
    assert "generated-pair.dng" in photos_e2e
    assert "Photos related media missing companion repair clears backup warning" in photos_e2e
    assert "Media pair files" in photos_e2e
    assert "missing-companion-replacement.dng" in photos_e2e
    assert '"photo_library_catalog_cleanup"' in api_server
    assert '"photo_repair_history"' in api_server
    photo_repair_history_body = api_server.split("def photo_repair_history", 1)[1].split("def _photo_pet_recognition_status", 1)[0]
    assert "_iter_audit_rows_reverse()" in photo_repair_history_body
    assert "_read_audit_rows()" not in photo_repair_history_body
    assert "auditScanLimit" in photo_repair_history_body
    assert '"photo_recovered_cleanup"' in api_server
    assert '"library_root"' in api_server
    assert "libraryRootLabel" in api_server
    assert "photoRestoreRehearsal" in app_tsx
    assert "photoBackupRestoreRehearsal" in app_tsx
    assert "photoLibraryPreviewSweep" in app_tsx
    assert "photoLibraryCatalogCleanup" in app_tsx
    assert "photoRepairHistory" in app_tsx
    assert "Restore rehearsal" in photo_repair_center_panel
    assert "Backup rehearsal" in photo_repair_center_panel
    assert "record_photo_backup_policy_check" in workspace_db
    assert "backupPolicyStatus" in api_server
    assert "PhotoBackupPolicyPanel" in photos_view
    assert "Scheduled backup checks" not in photos_view
    assert "Scheduled backup checks" in photo_backup_policy_panel
    assert "Check when due" not in photos_view
    assert "Check when due" in photo_backup_policy_panel
    assert "Backup interval" in photo_backup_policy_panel
    assert "Include generated caches" in photo_backup_policy_panel
    assert "operation_id" in api_server
    assert "favoriteMemories" in api_server
    assert "hiddenMemories" in api_server
    assert "memoryRemovedItems" in api_server
    assert "local_settings_persisted" in api_server
    assert "_clean_photo_local_settings" in workspace_db
    assert "_clean_photo_media_settings_by_library_root" in workspace_db
    assert "_clean_photo_managed_root_name" in workspace_db
    assert '"trips"' in api_server
    assert '"trip"' in api_server
    assert '"memories"' in api_server
    assert '"memory"' in api_server
    assert '"inferred"' in workspace_db
    assert "_photo_place_labels_by_asset_id" in api_server
    assert "place_labels_by_asset_id" in api_server
    assert '"focusSearch"' in keyboard_shortcuts
    assert '"selectPage"' in keyboard_shortcuts
    assert '"openInfo"' in keyboard_shortcuts
    assert '"toggleFavorite"' in keyboard_shortcuts
    assert '"toggleHidden"' in keyboard_shortcuts
    assert '"delete"' in keyboard_shortcuts
    assert '"mergeDuplicateGroups"' in keyboard_shortcuts
    assert '"toggleShortcutDiscovery"' in keyboard_shortcuts
    assert "PHOTO_SHORTCUT_DISCOVERY_GROUPS" in keyboard_shortcuts
    assert "Mark video trim start" in keyboard_shortcuts
    assert "Scrub video forward" in keyboard_shortcuts
    assert "Reset video transform" in keyboard_shortcuts
    assert "photoShortcutPanelOpen" in photos_view
    assert "appShortcutCommand" in photos_view
    assert "recentPhotoShortcutRef" in photos_view
    assert "Photos shortcuts" in photos_view
    assert "PhotoShortcutsPanel" in photos_view
    assert "Press ? to show or hide this panel" not in photos_view
    assert "Press ? to show or hide this panel" in photo_shortcuts_panel
    assert "photos-shortcut-panel" not in photos_view
    assert "photos-shortcut-panel" in photo_shortcuts_panel
    assert "photos-shortcut-panel" in styles_css
    assert '"photos-shortcut"' in types_ts
    assert "photoShortcutFromNativeInput" in desktop_main
    assert "before-input-event" in desktop_main
    assert "photoAppShortcutCommand" in app_tsx
    assert "Photos shortcut discovery panel covers keyboard and restore routes" in photos_e2e
    assert "Photos keyword manager shortcuts chips and bulk apply work" in photos_e2e
    assert "Photos keyword vocabulary import export round trips" in photos_e2e
    assert "normalizePhotoKeywordShortcut" in keyboard_shortcuts
    assert "photoKeywordShortcutForKeyboardEvent" in keyboard_shortcuts
    assert "resolvePhotoKeywordShortcut" in keyboard_shortcuts
    assert "parsePhotoDateOffsetDays" in date_adjustments
    assert "shiftPhotoDateByDays" in date_adjustments
    assert "splitPhotoDateTimeOverride" in date_adjustments
    assert "composePhotoDateTimeOverride" in date_adjustments
    assert "normalizePhotoDateTimeOverride" in date_adjustments
    assert "applyPhotoTimezoneCorrection" in date_adjustments
    assert "Original date" in photos_view
    assert "Original time" in photos_view
    assert "Original timezone offset" in photos_view
    assert "originalDateDraft" in photos_view
    assert "captureDate" in api_server
    assert "capture_date" in workspace_db
    assert "catalogCaptureDateOriginal" in workspace_db
    assert "catalogCaptureDateEditedAt" in workspace_db
    assert "Original timezone offset" in photos_e2e
    assert "Learned calibration" in app_tsx
    assert "Embedding adapter" in app_tsx
    assert "Learning mode" in app_tsx
    assert "Manual suggestions" in app_tsx
    assert "Auto-stage after validation" in app_tsx
    assert "Apply learned calibration" in app_tsx
    assert "Apply adapter" in app_tsx
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
    assert "--verify-signatures" in release_verifier
    assert "verifyCosignBundles" in release_verifier
    assert "verifyGithubAttestations" in release_verifier
    release_artifacts = (root / "desktop" / "scripts" / "create-release-artifacts.cjs").read_text(encoding="utf-8")
    supply_chain = (root / "desktop" / "scripts" / "release-supply-chain.cjs").read_text(encoding="utf-8")
    assert "generateSboms" in release_artifacts
    assert 'const SYFT_VERSION = "1.44.0"' in supply_chain
    assert 'const COSIGN_VERSION = "3.0.6"' in supply_chain
    assert 'const CYCLONEDX_NAME = "vintrace.cdx.json"' in supply_chain
    assert 'const SPDX_NAME = "vintrace.spdx.json"' in supply_chain
    assert 'const CHECKSUM_NAME = "SHA256SUMS.txt"' in supply_chain
    localization_check = (root / "desktop" / "scripts" / "check-localization.cjs").read_text(encoding="utf-8")
    assert "critical literals" in localization_check
    assert "visible literal translation coverage" in localization_check
    assert "LANGUAGE_DIRECTIONS" in localization_check
    assert "reverse-direction language coverage" in localization_check
    assert "reverse-direction literals" in localization_check
    assert "reverse-direction ui message isolation" in localization_check
    releases_doc = (root / "RELEASES.md").read_text(encoding="utf-8")
    assert "Windows installer" in releases_doc
    assert "macOS" in releases_doc
    assert "release:verify" in releases_doc
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    assert "release:artifacts" in package["scripts"]
    assert "release:sign" in package["scripts"]
    assert "release:attest:verify" in package["scripts"]
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
    performance_budget = (root / "tests" / "performance_budget.py").read_text(encoding="utf-8")
    assert "photo_export_budget" in performance_budget
    assert "photo_export_failure_budget" in performance_budget
    assert "photo_preview_budget" in performance_budget
    assert "photo_preview_failure_budget" in performance_budget
    assert "photo_ocr_budget" in performance_budget
    assert "photo_duplicate_budget" in performance_budget
    assert "photoOriginalExportMs" in performance_budget
    assert "photoRenderedExportMs" in performance_budget
    assert "photoRenderedVideoExportMs" in performance_budget
    assert "photoSlideshowMovieExportMs" in performance_budget
    assert "photoContactSheetExportMs" in performance_budget
    assert "photoExportFailureSelectionMs" in performance_budget
    assert "photoExportFailureContactSheetMs" in performance_budget
    assert "photoPreviewRebuildMs" in performance_budget
    assert "photoPreviewSweepMs" in performance_budget
    assert "photoPreviewFailureRebuildMs" in performance_budget
    assert "photoPreviewFailureSweepMs" in performance_budget
    assert "photoOcrFirstBatchMs" in performance_budget
    assert "photoOcrQueueDrainMs" in performance_budget
    assert "photoOcrStatusMs" in performance_budget
    assert "photoDuplicateRebuildMs" in performance_budget
    assert "photoDuplicatePageMs" in performance_budget
    assert "photoDuplicateRailSummaryMs" in performance_budget
    assert "photoDuplicateInvalidMergeMs" in performance_budget
    assert "photoDuplicateMergeMs" in performance_budget
    assert "photoDuplicateMergeUndoMs" in performance_budget
    assert "photoDuplicateDismissMs" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_EXPORT_ASSETS" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_EXPORT_FAILURE_ASSETS" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_PREVIEW_ASSETS" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_PREVIEW_FAILURE_ASSETS" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_OCR_ASSETS" in performance_budget
    assert "VINTRACE_PERF_BUDGET_PHOTO_DUPLICATE_ASSETS" in performance_budget
    assert "photo_original_export" in performance_budget
    assert "photo_rendered_export" in performance_budget
    assert "photo_rendered_video_export" in performance_budget
    assert "photo_slideshow_movie_export" in performance_budget
    assert "photo_contact_sheet_export" in performance_budget
    assert "photo_export_failure_selection" in performance_budget
    assert "photo_export_failure_contact_sheet" in performance_budget
    assert "photo_preview_rebuild" in performance_budget
    assert "photo_preview_sweep" in performance_budget
    assert "photo_preview_failure_rebuild" in performance_budget
    assert "photo_preview_failure_sweep" in performance_budget
    assert "photo_ocr_first_batch" in performance_budget
    assert "photo_ocr_queue_drain" in performance_budget
    assert "photo_ocr_status" in performance_budget
    assert "photo_duplicate_rebuild" in performance_budget
    assert "photo_duplicate_page" in performance_budget
    assert "photo_duplicate_rail_summary" in performance_budget
    assert "photo_duplicate_invalid_merge" in performance_budget
    assert "photo_duplicate_merge" in performance_budget
    assert "photo_duplicate_merge_undo" in performance_budget
    assert "photo_duplicate_dismiss" in performance_budget
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
    release_workflows = [
        (root / ".github" / "workflows" / name).read_text(encoding="utf-8")
        for name in ("windows-release.yml", "macos-release.yml", "linux-release.yml")
    ]
    release_finalizer = (root / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    for platform_workflow in release_workflows:
        assert "npm run release:artifacts" in platform_workflow
        assert "SHA256SUMS.txt" in platform_workflow
        assert "actions/attest@a1948c3f048ba23858d222213b7c278aabede763" in platform_workflow
        assert "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6" in platform_workflow
        assert "softprops/action-gh-release" not in platform_workflow
    assert "--require-release-metadata" in release_finalizer
    assert "--allow-draft" in release_finalizer
    assert "--verify-signatures" in release_finalizer
    assert "--platform all" in release_finalizer
    package_checker = (root / "desktop" / "scripts" / "check-package-artifacts.cjs").read_text(encoding="utf-8")
    assert "packaged backend checksum" in package_checker
    assert {
        "get_project_state",
        "mark_consent",
        "enroll_reference_folder",
        "scan_folder",
        "scan_media_paths",
        "query_candidates",
        "ordered_review_candidates",
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


def assert_high_audit_ui_regressions() -> None:
    root = Path(__file__).resolve().parents[1]
    app_tsx = (root / "src" / "App.tsx").read_text(encoding="utf-8")
    assert "if (!mountedRef.current) {\n        stream.getTracks().forEach((track) => track.stop());\n        return;\n      }" in app_tsx
    assert "if (!mountedRef.current) {\n        stream.getTracks().forEach((track) => track.stop());\n        if (streamRef.current === stream)" in app_tsx

    photos_view = (root / "src" / "views" / "PhotosView.tsx").read_text(encoding="utf-8")
    assert "async function moveSelected() {\n    const folder = await chooseDestinationFolder();\n    if (!folder) return;" in photos_view
    assert 'await manageCandidateMedia(selectedCandidateIds, "move", folder);' in photos_view
    assert 'await exportPhotoSelection(selectedPathOnlySources, "move", folder);' in photos_view


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


def assert_unmatched_clustering_is_global_not_fragmented() -> None:
    # ML-08: four identical embeddings form one stable cluster regardless of discovery
    # order. The old overflow flush and cluster_label_offset path no longer exists.
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-cluster-global-"))
    scan = root / "scan"
    for index in range(4):
        make_face(scan / f"unknown-{index}.jpg", shirt=(60 + index * 38, 80 + index * 22, 120 + index * 11))
    paths = sorted(scan.glob("*.jpg"))

    project = ProjectState(root / "workspace-forward")
    project.config.safe_mode = False
    project.config.cluster_min_size = 2
    added, errors, metrics = project.scan_paths(paths, StaticUnmatchedEngine(), total=4)
    assert errors == []
    assert added == 4
    assert metrics["unmatched"] == 4
    assert metrics["clustered"] == 4
    assert metrics["clusterPasses"] == 1
    assert metrics["clusterModelGroups"] == 1
    assert metrics["clusterComponents"] == 1
    assert metrics["clusterUniqueInputs"] == 4
    assert metrics["clusterDuplicateInputs"] == 0
    assert metrics["clusterNoise"] == 0
    assert metrics["clusterSpoolPeak"] == 4
    assert project.scan_history[0]["metrics"]["clustered"] == 4
    with project.db.connect() as conn:
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'unmatched_cluster_spool'"
        ).fetchone() is None
    forward = {Path(candidate.source_path).name: candidate.person_name for candidate in project.candidates.values()}
    names = set(forward.values())
    assert len(names) == 1
    assert next(iter(names)).startswith("Unmatched cluster ")

    reverse_project = ProjectState(root / "workspace-reverse")
    reverse_project.config.safe_mode = False
    reverse_project.config.cluster_min_size = 2
    reverse_added, reverse_errors, reverse_metrics = reverse_project.scan_paths(
        list(reversed(paths)), StaticUnmatchedEngine(), total=4
    )
    reverse = {
        Path(candidate.source_path).name: candidate.person_name
        for candidate in reverse_project.candidates.values()
    }
    assert reverse_errors == [] and reverse_added == 4
    assert reverse_metrics["clusterPasses"] == 1
    assert reverse == forward

    manager_source = (Path(__file__).resolve().parents[1] / "crossage_fr" / "enroll" / "manager.py").read_text(encoding="utf-8")
    assert "cluster_label_offset" not in manager_source
    assert "UNMATCHED_CLUSTER_GLOBAL_CAP" not in manager_source

    close_counts: list[int] = []
    original_spool = manager_module.GlobalUnmatchedSpool

    class TrackingSpool(original_spool):
        def close(self) -> None:
            close_counts.append(self.count)
            super().close()

    cancelled_project = ProjectState(root / "workspace-cancelled")
    cancelled_project.config.safe_mode = False
    cancelled_project.config.cluster_min_size = 2

    def cancelling_paths():
        yield paths[0]
        cancelled_project.request_scan_cancel(source="edge-test")
        yield paths[1]

    manager_module.GlobalUnmatchedSpool = TrackingSpool
    try:
        cancelled_added, cancelled_errors, cancelled_metrics = cancelled_project.scan_paths(
            cancelling_paths(), StaticUnmatchedEngine(), total=2
        )
    finally:
        manager_module.GlobalUnmatchedSpool = original_spool
    assert cancelled_added == 0
    assert cancelled_errors == []
    assert cancelled_metrics["cancelled"] == 1
    assert cancelled_metrics["unmatched"] == 1
    assert cancelled_metrics["clusterPasses"] == 0
    assert cancelled_project.candidates == {}
    assert close_counts == [1]

    totals_api = DesktopApi.__new__(DesktopApi)
    totals_api.project = type("ScanTotalsProject", (), {})()
    totals_api.project.scan_history = [
        {"durationMs": 10, "completedAt": "2026-07-12T00:00:00Z", "metrics": metrics},
        {
            "durationMs": 20,
            "completedAt": "2026-07-11T00:00:00Z",
            "metrics": {
                "clusterPasses": 1,
                "clusterModelGroups": 2,
                "clusterComponents": 3,
                "clusterUniqueInputs": 7,
                "clusterDuplicateInputs": 1,
                "clusterNoise": 2,
                "clusterSpoolPeak": 7,
            },
        },
    ]
    totals = totals_api._scan_totals()
    assert totals["clusterPasses"] == 2
    assert totals["clusterModelGroups"] == 3
    assert totals["clusterComponents"] == 4
    assert totals["clusterUniqueInputs"] == 11
    assert totals["clusterDuplicateInputs"] == 1
    assert totals["clusterNoise"] == 2
    assert totals["clusterSpoolPeak"] == 7


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


def assert_enrollment_reuses_embedding_cache_across_people() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-enroll-cache-"))
    enroll = root / "enroll"
    image_path = enroll / "shared.jpg"
    make_face(image_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    original_screen = manager_module.screen_enrollment_face
    manager_module.screen_enrollment_face = lambda *_args, **_kwargs: SyntheticScreenResult(
        model_id="unit-screen",
        model_version="1",
        stable_score=0.1,
        original_score=0.1,
        recompressed_score=0.1,
        review_threshold=0.9,
        flagged_for_review=False,
    )
    try:
        first_engine = CountingMatchedEngine()
        added, errors, reviews = project.enroll_folder("Alice", "adult", enroll, first_engine)
        assert reviews == 0
        assert errors == []
        assert added == 1
        assert first_engine.calls == 1
        second_engine = CountingMatchedEngine()
        added_second, errors_second, reviews_second = project.enroll_folder("Bob", "adult", enroll, second_engine)
        assert reviews_second == 0
        assert errors_second == []
        assert added_second == 1
        assert second_engine.calls == 0
    finally:
        manager_module.screen_enrollment_face = original_screen
    assert {ref.person_name for ref in project.references.values()} == {"Alice", "Bob"}


def assert_reference_backfill_reuses_embedding_cache_for_shared_sources() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-backfill-cache-"))
    ref_path = root / "shared-ref.jpg"
    make_face(ref_path)
    project = ProjectState(root / "workspace")
    project.config.safe_mode = False
    for name in ("Alice", "Bob"):
        ref = ReferenceFace(
            ref_id=f"ref_old_model_{name.casefold()}",
            person_name=name,
            age_bucket="adult",
            source_path=str(ref_path),
            capture_date=None,
            quality=1.0,
            model_name="old-model-space",
            vector=[1.0] + [0.0] * 511,
        )
        project.references[ref.ref_id] = ref
        project.vector_store.add(ref.ref_id, ref.vector)
    engine = CountingMatchedEngine()
    result = project.backfill_references_for_model(engine)
    assert result["total"] == 2
    assert result["added"] == 2
    assert engine.calls == 1
    active_refs = [
        ref
        for ref in project.references.values()
        if project._compatible_reference_model_name(engine.model_name, ref.model_name)
    ]
    assert {ref.person_name for ref in active_refs} == {"Alice", "Bob"}


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
    assert reloaded._candidate_index_backed is True  # noqa: SLF001 - verifies lazy boot hydration.
    assert reloaded.candidates == {}
    payload = reloaded.db.candidate_payload_by_id(next(iter(project.candidates)))
    assert payload and payload["person_name"] == "Person"
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

    def fake_assess(path: Path, threshold: float, image=None, temperature: float = 1.0, **_kwargs: object) -> SafetyAssessment:
        nonlocal calls
        del path, threshold, image, temperature
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


def assert_safety_model_integrity_runs_only_on_cache_miss() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-safety-model-cache-"))
    model_path = root / "safe-mode-test.onnx"
    model_path.write_bytes(b"fake onnx payload")
    spec = safety_module._SafetyModelSpec(  # noqa: SLF001 - regression test for loader cache semantics.
        path=model_path,
        model_name="cache-test",
        source="test",
        license="test",
        input_size=224,
        labels=("sfw", "nsfw"),
        nsfw_index=1,
        mean=(0.0, 0.0, 0.0),
        std=(1.0, 1.0, 1.0),
        interpolation="bilinear",
        threshold_hint="test",
        expected_sha256="abc123",
    )
    original_find = safety_module._find_safety_model
    original_verify = safety_module._verify_model_integrity
    original_model_class = safety_module._OnnxSafetyModel
    original_token = safety_module._model_stat_token
    original_cache = dict(safety_module._SAFETY_MODEL_CACHE)
    token = {"value": (len(b"fake onnx payload"), 1)}
    verify_calls = 0
    created: list[object] = []

    class FakeSafetyModel:
        def __init__(self, loaded_spec):
            self.spec = loaded_spec
            created.append(self)

    def fake_find_safety_model():
        return spec

    def fake_verify_model_integrity(loaded_spec):
        nonlocal verify_calls
        assert loaded_spec is spec
        verify_calls += 1
        return None

    def fake_model_stat_token(path):
        assert path == model_path
        return token["value"]

    safety_module._SAFETY_MODEL_CACHE.clear()
    safety_module._find_safety_model = fake_find_safety_model
    safety_module._verify_model_integrity = fake_verify_model_integrity
    safety_module._OnnxSafetyModel = FakeSafetyModel
    safety_module._model_stat_token = fake_model_stat_token
    try:
        first = safety_module._load_safety_model()
        second = safety_module._load_safety_model()
        assert first is second
        assert verify_calls == 1
        assert len(created) == 1

        token["value"] = (len(b"fake onnx payload") + 1, 2)
        third = safety_module._load_safety_model()
        assert third is not first
        assert verify_calls == 2
        assert len(created) == 2
    finally:
        safety_module._find_safety_model = original_find
        safety_module._verify_model_integrity = original_verify
        safety_module._OnnxSafetyModel = original_model_class
        safety_module._model_stat_token = original_token
        safety_module._SAFETY_MODEL_CACHE.clear()
        safety_module._SAFETY_MODEL_CACHE.update(original_cache)


def assert_nested_exif_original_date_wins_over_ifd0_date() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-exif-nested-"))
    try:
        path = root / "nested-exif.jpg"
        image = Image.new("RGB", (8, 8), "navy")
        exif = Image.Exif()
        exif[306] = "2026:07:01 12:00:00"
        exif[ExifTags.IFD.Exif] = {
            36867: "2001:02:03 04:05:06",
            36868: "2002:03:04 05:06:07",
        }
        image.save(path, exif=exif, quality=95)

        with Image.open(path) as loaded:
            captured, provenance = capture_date_with_provenance(path, loaded)
        assert captured == "2001-02-03", captured
        assert provenance == "exif", provenance

        db = WorkspaceDb(root / "workspace.db")
        db.create_scan_run("run1", "Nested EXIF", "manual", str(root))
        db.record_scan_file("run1", path, path_signature(path), "completed", phase="processed")
        asset = db.photo_asset_by_path(str(path))
        assert asset and asset["captureDate"] == "2001-02-03", asset
        assert asset["metadata"]["exif"]["captureDateProvenance"] == "exif", asset
    finally:
        shutil.rmtree(root, ignore_errors=True)
    print("  nested EXIF original date ok")


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


def assert_scan_progress_noisy_phases_are_throttled() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-progress-throttle-"))
    project = ProjectState(root / "workspace")
    events: list[dict[str, object]] = []
    now = [100.0]
    original_monotonic = manager_module.time.monotonic
    manager_module.time.monotonic = lambda: now[0]
    metrics = {"total": 100, "processed": 0, "added": 0, "errors": 0}
    try:
        project._emit_scan_progress(events.append, "started", metrics)
        metrics["processed"] = 1
        project._emit_scan_progress(events.append, "processing", metrics, current_path="/tmp/one.jpg")
        metrics["processed"] = 2
        project._emit_scan_progress(events.append, "processing", metrics, current_path="/tmp/two.jpg")
        project._emit_scan_progress(events.append, "candidate", metrics, current_path="/tmp/two.jpg")

        now[0] += manager_module.SCAN_PROGRESS_THROTTLE_SECONDS + 0.01
        metrics["processed"] = 3
        project._emit_scan_progress(events.append, "processing", metrics, current_path="/tmp/three.jpg")
        metrics["processed"] = 4
        project._emit_scan_progress(events.append, "processed", metrics, current_path="/tmp/four.jpg")
        metrics["processed"] = 5
        project._emit_scan_progress(events.append, "processed", metrics, current_path="/tmp/five.jpg")
        metrics["processed"] = 4 + manager_module.SCAN_PROGRESS_THROTTLE_FILES
        project._emit_scan_progress(events.append, "processed", metrics, current_path="/tmp/chunk.jpg")
        metrics["processed"] = 100
        project._emit_scan_progress(events.append, "processed", metrics, current_path="/tmp/final.jpg")
        project._emit_scan_progress(events.append, "complete", metrics)
    finally:
        manager_module.time.monotonic = original_monotonic
    phases = [event["phase"] for event in events]
    assert phases == ["started", "processing", "candidate", "processing", "processed", "processed", "processed", "complete"], phases
    assert [event.get("current_path") for event in events if event["phase"] == "processing"] == ["/tmp/one.jpg", "/tmp/three.jpg"]
    assert events[-1]["phase"] == "complete"


def assert_verification_engine_is_deferred_and_cached() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-verification-cache-"))
    api = make_api(root / "workspace")
    api.project.config.performance_mode = "quality"
    api.project.config.two_pass_scan = True
    api.project.config.face_detector_size = 512
    api.project.config.verification_detector_size = 640
    calls = {"verification": 0, "factory": 0}

    def forbidden_verification_engine():
        calls["verification"] += 1
        raise AssertionError("verification engine should not load when there are no new candidates")

    original_verification_engine = api._verification_engine
    api._verification_engine = forbidden_verification_engine
    try:
        assert api._maybe_verify_new_candidates(set(), {"processed": 0}, None, "test") == {}
    finally:
        api._verification_engine = original_verification_engine
    assert calls["verification"] == 0

    original_create = api_server_module.create_embedding_engine

    class FakeVerificationEngine:
        model_name = "fake-verification"

        def __init__(self, config):
            self.detector_size = config.face_detector_size

    def fake_create_embedding_engine(config):
        calls["factory"] += 1
        return FakeVerificationEngine(config)

    api_server_module.create_embedding_engine = fake_create_embedding_engine
    try:
        first = api._verification_engine()
        second = api._verification_engine()
        assert first is second
        assert calls["factory"] == 1
        assert getattr(first, "detector_size") == 640
        api._reset_engine()
        third = api._verification_engine()
        assert third is not first
        assert calls["factory"] == 2
    finally:
        api_server_module.create_embedding_engine = original_create


def assert_reference_suggestion_staging_reports_progress_and_defers_engine() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-reference-suggestion-progress-"))
    api = make_api(root / "workspace")
    engine_calls = 0
    staged_payloads: list[dict[str, EmbeddingResult]] = []

    def forbidden_engine():
        raise AssertionError("engine should not load when no reference-suggestion candidates exist")

    def fake_stage(embeddings, limit=20):
        staged_payloads.append(dict(embeddings))
        return {"staged": len(embeddings), "suggestions": [], "rejected": [], "skipped": [], "summary": {}}

    original_candidates = api.project.reference_suggestion_candidates
    original_stage = api.project.stage_reference_suggestions
    original_engine = api._engine_instance
    original_embedding = api._reference_suggestion_embedding
    api.project.reference_suggestion_candidates = lambda limit=80: []  # type: ignore[method-assign]
    api.project.stage_reference_suggestions = fake_stage  # type: ignore[method-assign]
    api._engine_instance = forbidden_engine
    no_work_events: list[dict[str, object]] = []
    try:
        queued = api._cmd_stage_reference_suggestions({"limit": 3}, progress=no_work_events.append)
        assert queued["value"]["queuedJob"]["jobKind"] == "reference_suggestions"
        assert no_work_events == []
        assert staged_payloads == []
        no_work = api._cmd_stage_reference_suggestions({"limit": 3, "runInline": True}, progress=no_work_events.append)
    finally:
        api.project.reference_suggestion_candidates = original_candidates  # type: ignore[method-assign]
        api._engine_instance = original_engine
    assert no_work["value"]["staged"] == 0
    assert [event["phase"] for event in no_work_events] == ["started", "complete"]
    assert staged_payloads[-1] == {}

    candidates = [
        ReviewCandidate(
            candidate_id="cand_ref_progress_a",
            source_path=str(root / "a.jpg"),
            person_name="Person",
            best_ref_id=None,
            best_ref_path=None,
            score=0.9,
            band="likely",
            quality=0.8,
            model_name="test",
            status="accepted",
        ),
        ReviewCandidate(
            candidate_id="cand_ref_progress_b",
            source_path=str(root / "b.jpg"),
            person_name="Person",
            best_ref_id=None,
            best_ref_path=None,
            score=0.8,
            band="likely",
            quality=0.7,
            model_name="test",
            status="accepted",
        ),
    ]

    def fake_engine():
        nonlocal engine_calls
        engine_calls += 1
        return object()

    def fake_embedding(candidate, engine):
        del engine
        if candidate.candidate_id.endswith("_b"):
            raise ValueError("synthetic embedding failure")
        return EmbeddingResult(
            vector=[1.0] + [0.0] * 511,
            quality=0.9,
            bbox=None,
            model_name="test",
        )

    progress_events: list[dict[str, object]] = []
    api.project.reference_suggestion_candidates = lambda limit=80: candidates  # type: ignore[method-assign]
    api._engine_instance = fake_engine
    api._reference_suggestion_embedding = fake_embedding
    try:
        result = api._cmd_stage_reference_suggestions({"limit": 3, "runInline": True}, progress=progress_events.append)
    finally:
        api.project.reference_suggestion_candidates = original_candidates  # type: ignore[method-assign]
        api.project.stage_reference_suggestions = original_stage  # type: ignore[method-assign]
        api._engine_instance = original_engine
        api._reference_suggestion_embedding = original_embedding
    assert engine_calls == 1
    assert result["value"]["staged"] == 1
    assert result["value"]["embeddingErrors"][0]["candidateId"] == "cand_ref_progress_b"
    assert set(staged_payloads[-1]) == {"cand_ref_progress_a"}
    assert [event["phase"] for event in progress_events] == ["started", "processing", "processed", "processing", "processed", "complete"]
    assert progress_events[-1]["embedded"] == 1
    assert progress_events[-1]["failed"] == 1
    assert all(event["source"] == "reference_suggestions" for event in progress_events)


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

    reference_index_version = api.project._reference_index_version
    renamed = api.handle("rename_person", {"oldName": "Person", "newName": "Person Prime"})
    assert renamed["renamed"]["references"] == 1
    assert renamed["renamed"]["candidates"] == 1
    assert renamed["renamed"]["identityMerged"] is False
    assert api.project._reference_index_version > reference_index_version
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
    # Probabilistic calibration (Phase 1.1) needs enough labels with both classes,
    # so seed a small but sufficient accept/reject set (10 positives + 10 negatives).
    for i in range(10):
        api.handle(
            "add_calibration_label",
            {
                "row": {
                    "sourcePath": str(scan / f"candidate{i}.jpg"),
                    "expectedPerson": "Person Prime",
                    "actualPerson": "Person Prime",
                    "matchScore": 0.60 + 0.03 * i,
                    "isMatch": True,
                }
            },
        )
        api.handle(
            "add_calibration_label",
            {
                "row": {
                    "sourcePath": str(scan / f"impostor{i}.jpg"),
                    "expectedPerson": "Person Prime",
                    "actualPerson": "Other",
                    "matchScore": 0.10 + 0.01 * i,
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
    inventory_json = json.loads(Path(inventory_value["jsonPath"]).read_text(encoding="utf-8"))
    assert inventory_json["counts"]["candidates"] == inventory_value["counts"]["candidates"]
    assert inventory_json["candidates"]
    assert inventory_json["candidates"][0]["candidateId"]

    activity_export = api.handle("export_audit_log", {})
    activity_value = activity_export["value"]
    assert Path(activity_value["jsonPath"]).exists()
    assert Path(activity_value["csvPath"]).exists()
    assert activity_value["counts"]["events"] >= 1
    manager_source = (Path(__file__).resolve().parents[1] / "crossage_fr" / "enroll" / "manager.py").read_text(encoding="utf-8")
    report_block = manager_source[
        manager_source.index("    def export_report("):manager_source.index("    def export_candidates(")
    ]
    audit_export_block = manager_source[
        manager_source.index("    def export_audit_log("):manager_source.index("    def _read_audit_rows(")
    ]
    assert "candidates = [" not in report_block
    assert "json_path.write_text(json.dumps(payload, indent=2)" not in report_block
    assert "atomic_write(json_path, stream_report)" in report_block
    assert "rows = self._read_audit_rows()" not in audit_export_block
    assert "_iter_audit_rows_forward()" in audit_export_block
    assert "atomic_write(json_path, stream_audit_log)" in audit_export_block

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

    api.project.db.upsert_learned_artifact(
        "support-sensitive-artifact",
        {
            "artifactType": "embedding_adapter",
            "status": "promoted",
            "modelName": "modelA",
            "versionKey": "logistic-pair-adapter-v1",
            "trainingDataHash": "support-sensitive-training-hash",
            "inputCount": 2,
            "positiveCount": 1,
            "negativeCount": 1,
            "metrics": {"validation": {"delta": 0.1}},
            "payload": {"secretMarker": "do-not-ship-learned-artifact", "weights": [123.456]},
        },
    )
    support = api.handle("export_support_bundle", {"includePaths": False})
    support_value = support["value"]
    support_path = Path(support_value["zipPath"])
    assert support_path.exists()
    assert support_value["fileCount"] >= 8
    with zipfile.ZipFile(support_path) as archive:
        assert "workspace-health.json" in archive.namelist()
        assert "retention-policy-report.json" in archive.namelist()
        assert "model-drift-report.json" in archive.namelist()
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert manifest["learnedArtifactsIncluded"] is False
        assert manifest["trainingExamplesIncluded"] is False
        support_text = "\n".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.endswith(".json")
        )
        assert str(root) not in support_text
        assert str(Path.home()) not in support_text
        assert "support-sensitive-artifact" not in support_text
        assert "do-not-ship-learned-artifact" not in support_text
        assert "123.456" not in support_text

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
    assert {check["name"] for check in model_integrity["checks"]} >= {"Face model", "AS-Norm cohort", "Model folder writable", "Image decoder"}

    installer = api.handle("installer_self_diagnostics", {})
    installer_checks = {check["name"] for check in installer["checks"]}
    assert {"App folder write", "Model downloader", "AS-Norm cohort", "Photo formats", "Workspace health"} <= installer_checks
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
    assert {"Workspace write", "Recognition engine", "AS-Norm cohort", "Image decoder", "Workspace health"} <= check_names
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
    repeated_delete = api.handle("delete_person", {"personName": "Person Prime"})
    assert repeated_delete["deleted"]["references"] == 0
    assert repeated_delete["deleted"]["candidates"] == 0
    assert repeated_delete["deleted"]["receipt"]["originalMediaDeleted"] is False


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
    unrelated_move_source = media / "move-unrelated-source.jpg"
    make_face(unrelated_move_source, shirt=(180, 100, 60))
    add_candidate("cand_move_unrelated", unrelated_move_source)
    unrelated_reference_source = media / "move-unrelated-reference.jpg"
    make_face(unrelated_reference_source, shirt=(40, 150, 90))
    api.project.references["ref_move_unrelated"] = ReferenceFace(
        ref_id="ref_move_unrelated",
        person_name="Move Reference",
        age_bucket="adult",
        source_path=str(unrelated_reference_source),
        capture_date=None,
        quality=0.92,
        model_name="test",
        vector=[1.0] + [0.0] * 511,
    )
    api.project.save()
    original_authoritative_candidates = api.project._iter_authoritative_candidates
    original_safe_resolve = manager_module.safe_resolve
    blocked_resolve_paths = {str(unrelated_move_source.expanduser()), str(unrelated_reference_source.expanduser())}

    def fail_authoritative_candidate_scan(*_args, **_kwargs):
        raise AssertionError("media action preview/manage should estimate removable rows from indexed source keys")

    def fail_unrelated_media_resolve(path: Path) -> Path:
        if str(Path(path).expanduser()) in blocked_resolve_paths:
            raise AssertionError("media action preview/manage should not resolve unrelated candidate or reference paths")
        return original_safe_resolve(path)

    api.project._iter_authoritative_candidates = fail_authoritative_candidate_scan  # type: ignore[method-assign]
    manager_module.safe_resolve = fail_unrelated_media_resolve
    try:
        move_preview = api.handle("preview_candidate_media_action", {"candidateIds": ["cand_move_a"], "action": "move"})
        assert move_preview["counts"]["removedCandidatesEstimate"] == 2
        moved = api.handle("manage_candidate_media", {"candidateIds": ["cand_move_a"], "action": "move"})
    finally:
        api.project._iter_authoritative_candidates = original_authoritative_candidates  # type: ignore[method-assign]
        manager_module.safe_resolve = original_safe_resolve
    moved_value = moved["value"]
    assert moved_value["counts"]["moved"] == 1
    assert moved_value["counts"]["removedCandidates"] == 2
    assert not move_source.exists()
    assert "cand_move_a" not in api.project.candidates
    assert "cand_move_b" not in api.project.candidates
    assert "cand_move_unrelated" in api.project.candidates
    assert Path(moved_value["manifestPath"]).exists()
    undone_move = api.handle("undo_media_action", {"manifestPath": moved_value["manifestPath"]})
    assert undone_move["value"]["counts"]["restored"] == 1
    assert undone_move["value"]["counts"]["restoredCandidates"] == 2
    assert move_source.exists()
    assert "cand_move_a" in api.project.candidates
    assert "cand_move_b" in api.project.candidates
    moved_history = api.handle("media_action_history", {"limit": 10})
    moved_history_row = next(item for item in moved_history["items"] if item["manifestPath"] == moved_value["manifestPath"])
    assert moved_history_row["canUndo"] is False
    assert moved_history_row["undoneAt"]
    assert Path(moved_value["manifestPath"]).with_name("manifest-summary.json").exists()
    original_manifest_reader = api.project._read_media_action_manifest

    def fail_full_media_action_manifest(_manifest_path: Path) -> dict[str, object]:
        raise AssertionError("media action history should read the summary sidecar before the full manifest")

    api.project._read_media_action_manifest = fail_full_media_action_manifest  # type: ignore[method-assign]
    try:
        summary_history = api.handle("media_action_history", {"limit": 10})
    finally:
        api.project._read_media_action_manifest = original_manifest_reader  # type: ignore[method-assign]
    summary_history_row = next(item for item in summary_history["items"] if item["manifestPath"] == moved_value["manifestPath"])
    assert summary_history_row["canUndo"] is False
    assert summary_history_row["undoneAt"]

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
    assert restored["value"]["counts"]["restoredCandidates"] == 1
    assert trash_source.exists()
    assert "cand_trash" in api.project.candidates

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
    original_read_audit_rows = api.project._read_audit_rows

    def fail_full_audit_read() -> list[dict[str, object]]:
        raise AssertionError("media action history should tail recent audit rows, not parse the full audit log")

    api.project._read_audit_rows = fail_full_audit_read  # type: ignore[method-assign]
    try:
        history = api.handle("media_action_history", {"limit": 10})
        assert history["items"]
        assert any(item["canRestore"] for item in history["items"])
        guarded_history = next(item for item in history["items"] if item["manifestPath"] == guarded["value"]["manifestPath"])
        assert guarded_history["canRetry"] is True
        retried = api.handle("retry_media_action", {"manifestPath": guarded["value"]["manifestPath"]})
        assert retried["value"]["counts"]["skipped"] == 1
    finally:
        api.project._read_audit_rows = original_read_audit_rows  # type: ignore[method-assign]

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
    api.project.db.set_safe_mode_override("private-safe-mode-hash", True, reason="operator-confirmed-sensitive")
    assert api.project.db.safe_mode_override_for("private-safe-mode-hash") is True
    event_asset_id = api.project.db._photo_asset_id(str(scan / "candidate.jpg"))
    with api.project.db.connect() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO photo_assets(asset_id, source_path, added_at, updated_at)
            VALUES(?, ?, ?, ?)
            """,
            (event_asset_id, str(scan / "candidate.jpg"), "2026-07-07T00:00:00Z", "2026-07-07T00:00:00Z"),
        )
        conn.execute(
            """
            INSERT INTO photo_asset_events(event_id, asset_id, event_type, event_at, actor, metadata_json)
            VALUES(?, ?, ?, ?, ?, ?)
            """,
            ("evt-delete-face-data-viewed", event_asset_id, "viewed", "2026-07-07T00:01:00Z", "test", "{}"),
        )
    before = api.handle("privacy_report", {})
    assert before["references"] == 1
    assert before["candidates"] == 1
    expect_raises(ValueError, lambda: api.handle("delete_face_data", {"confirm": False}), "confirm=true")
    deleted = api.handle("delete_face_data", {"confirm": True})
    assert deleted["value"]["before"]["references"] == 1
    assert deleted["value"]["dbDeleted"]["blocked_pairs"] == 2
    assert deleted["value"]["dbDeleted"]["safe_mode_overrides"] == 1
    assert deleted["value"]["dbDeleted"]["photo_asset_events"] == 1
    assert api.project.db.safe_mode_override_for("private-safe-mode-hash") is None
    with api.project.db.connect() as conn:
        event_count = int(conn.execute("SELECT COUNT(*) AS n FROM photo_asset_events").fetchone()["n"])
    assert event_count == 0
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
    expect_raises(ValueError, lambda: api.handle("save_settings", {"learningMode": "auto_promote"}), "Learning mode")
    expect_raises(ValueError, lambda: api.handle("set_performance_mode", {"mode": "turbo"}), "Performance mode")
    tuned = api.handle("save_settings", {"faceDetectorSize": 500, "verificationDetectorSize": 630, "twoPassScan": True, "learningMode": "auto_stage"})
    assert tuned["config"]["faceDetectorSize"] == 512
    assert tuned["config"]["verificationDetectorSize"] == 640
    assert tuned["config"]["twoPassScan"] is True
    assert tuned["config"]["learningMode"] == "auto_stage"
    reloaded = make_api(root / "workspace").state()
    assert reloaded["config"]["learningMode"] == "auto_stage"
    fast = api.handle("set_performance_mode", {"mode": "fast"})
    assert fast["config"]["performanceMode"] == "fast"
    assert fast["config"]["effectivePerformanceMode"] == "fast"
    assert fast["config"]["effectiveFaceDetectorSize"] <= 384
    assert fast["config"]["effectiveTwoPassScan"] is False
    fast_engine_config = api._effective_engine_config()
    assert fast_engine_config.performance_mode == "fast"
    assert fast_engine_config.multi_scale_detect is False
    auto = api.handle("set_performance_mode", {"mode": "auto"})
    assert auto["config"]["performanceMode"] == "auto"
    assert auto["config"]["effectivePerformanceMode"] in {"fast", "balanced", "quality"}
    assert api._effective_engine_config().performance_mode == auto["config"]["effectivePerformanceMode"]
    excluded = api.handle("save_settings", {"scanExclusions": {"dirNames": ["skipme"], "pathKeywords": ["private"], "extensions": ["gif"], "filePaths": [str(root / "ignored.jpg")]}})
    assert excluded["config"]["scanExclusions"]["extensions"] == [".gif"]
    assert excluded["config"]["scanExclusions"]["filePaths"] == [str(root / "ignored.jpg")]
    expect_raises(ValueError, lambda: api.handle("set_status", {"candidateId": "missing", "status": "bad"}), "Unsupported")
    expect_raises(ValueError, lambda: api.handle("bulk_set_status", {"status": "accepted"}), "candidateIds")
    expect_raises(ValueError, lambda: api.handle("bulk_set_status", {"candidateIds": "cand", "status": "accepted"}), "list")
    expect_raises(ValueError, lambda: api.handle("bulk_set_status", {"candidateIds": [], "status": "accepted"}), "at least one")
    expect_raises(ValueError, lambda: api.handle("bulk_set_status", {"candidateIds": [" "], "status": "accepted"}), "non-empty")
    expect_raises(ValueError, lambda: api.project.bulk_set_candidate_status([], "accepted"), "at least one")
    expect_raises(KeyError, lambda: api.handle("delete_reference", {"refId": "missing"}), "Reference")
    expect_raises(ValueError, lambda: api.handle("rename_person", {"oldName": "", "newName": "A"}), "required")
    expect_raises(KeyError, lambda: api.handle("rename_person", {"oldName": "Missing", "newName": "A"}), "Person")
    expect_raises(ValueError, lambda: api.handle("rename_photo_pet", {"oldName": "", "newName": "A"}), "required")
    expect_raises(KeyError, lambda: api.handle("rename_photo_pet", {"oldName": "Missing", "newName": "A"}), "Pet")
    expect_raises(ValueError, lambda: api.handle("assign_photo_pet", {"petName": ""}), "petName")
    expect_raises(ValueError, lambda: api.handle("assign_photo_pet", {"petName": "Milo"}), "sourcePath")
    expect_raises(ValueError, lambda: api.handle("dismiss_photo_pet_review", {}), "sourcePath")
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
    registry = str(root / "registry")
    env = {
        **os.environ,
        "PYTHONPATH": ".",
        "CROSSAGE_FORCE_FALLBACK": "1",
        "VINTRACE_REGISTRY_HOME": registry,
        "CROSSAGE_REGISTRY_HOME": registry,
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
    api_source = (Path(__file__).resolve().parents[1] / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
    assert "Current frontal baseline" not in api_source
    assert "Pose-aware candidate" not in api_source
    assert "Noisy candidate" not in api_source

    public_report = root / "public-dataset-benchmark.json"
    public_report.write_text(json.dumps({
        "generatedAt": "2999-01-01T00:00:00Z",
        "baselinePack": "antelopev2",
        "rows": [{
            "datasetId": "cfp",
            "pack": "buffalo_l",
            "status": "complete",
            "evaluated": 80,
            "precision": 0.98,
            "recall": 0.82,
            "accuracy": 0.86,
            "profileRecall": 0.82,
            "wrongIdentity": 1,
            "falsePositives": 1,
            "hardNegativeFalsePositives": 0,
        }],
    }), encoding="utf-8")
    old_report = os.environ.get("VINTRACE_PUBLIC_BENCHMARK_REPORT")
    old_required = os.environ.get("VINTRACE_PUBLIC_BENCHMARK_REQUIRED_DATASETS")
    try:
        os.environ["VINTRACE_PUBLIC_BENCHMARK_REPORT"] = str(public_report)
        os.environ["VINTRACE_PUBLIC_BENCHMARK_REQUIRED_DATASETS"] = "cfp"
        dataset_gate = api._dataset_regression_gate_summary()
        assert dataset_gate["ok"] is True
        assert dataset_gate["source"] == "public-dataset-benchmark-report"
        assert dataset_gate["rowCount"] == 1
        assert dataset_gate["completedDatasets"] == ["cfp"]

        os.environ["VINTRACE_PUBLIC_BENCHMARK_REPORT"] = str(root / "missing-public-benchmark.json")
        readiness = api.handle("release_readiness", {})
    finally:
        if old_report is None:
            os.environ.pop("VINTRACE_PUBLIC_BENCHMARK_REPORT", None)
        else:
            os.environ["VINTRACE_PUBLIC_BENCHMARK_REPORT"] = old_report
        if old_required is None:
            os.environ.pop("VINTRACE_PUBLIC_BENCHMARK_REQUIRED_DATASETS", None)
        else:
            os.environ["VINTRACE_PUBLIC_BENCHMARK_REQUIRED_DATASETS"] = old_required
    check_names = {check["name"] for check in readiness["checks"]}
    assert {"Model license manifest", "Database integrity", "Video decoder", "Accuracy validation pack", "Auto-update", "Self-learning R&D boundary"} <= check_names
    dataset_check = next(check for check in readiness["checks"] if check["name"] == "Dataset regression gates")
    assert dataset_check["ok"] is False
    assert dataset_check["value"]["status"] == "missing"
    assert dataset_check["value"]["source"] == "public-dataset-benchmark-report"
    self_learning = next(check for check in readiness["checks"] if check["name"] == "Self-learning R&D boundary")
    assert self_learning["ok"] is True
    assert self_learning["value"]["auditOk"] is False
    assert self_learning["value"]["auditStatus"] == "blocked"
    assert self_learning["value"]["notProductionAuthorization"] is True
    assert self_learning["value"]["blockedRequirements"]

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


def _write_exif_date(path: Path, date_str: str) -> None:
    # §5.4: a genuinely old photo carries a real EXIF capture date — NOT an old
    # mtime (a digitized historical photo's mtime is the *scan* date). Write the
    # EXIF DateTime tag (306) so capture_date provenance reads as "exif".
    image = Image.open(path)
    exif = image.getexif()
    exif[306] = date_str
    image.save(path, exif=exif, quality=95)


def assert_candidate_age_gap_is_surfaced() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-age-gap-"))
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_a.jpg")
    make_face(scan / "candidate_a.jpg", shirt=(92, 116, 88))
    # A trustworthy wide cross-age gap requires REAL EXIF event dates on both the
    # reference (old) and the candidate (recent) — the reference ~12 years before.
    _write_exif_date(refs / "person_a.jpg", "2014:01:01 00:00:00")
    _write_exif_date(scan / "candidate_a.jpg", "2026:01:01 00:00:00")
    api = make_api(workspace)
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person A", "ageBucket": "adult", "folder": str(refs)})["added"] >= 1
    scanned = api.handle("scan", {"folder": str(scan), "source": "age-gap-test"})
    matched = [c for c in scanned["state"]["candidates"] if c.get("bestRefId")]
    assert matched, "expected a matched candidate"
    cand = matched[0]
    assert cand.get("ageGapYears") is not None, f"missing ageGapYears: {cand}"
    assert cand["ageGapYears"] >= 6, f"expected a wide gap, got {cand['ageGapYears']}"
    # §5.4 governance: both dates are EXIF-verified, so the real NIST band shows.
    assert cand.get("captureDateProvenance") == "exif", f"candidate provenance not exif: {cand.get('captureDateProvenance')}"
    assert cand.get("referenceCaptureDateProvenance") == "exif", f"reference provenance not exif: {cand.get('referenceCaptureDateProvenance')}"
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


def assert_mtime_age_gap_is_estimated_not_nist() -> None:
    # §5.4 governance: when the capture date is the mtime fallback (no EXIF), the
    # age gap must be labeled "estimated" with NO cross-age-gap NIST flag — even
    # for a numerically wide gap — so the reviewer is never shown a false
    # reliability band derived from a scan date.
    from datetime import datetime

    root = Path(tempfile.mkdtemp(prefix="crossage-age-gap-mtime-"))
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_b.jpg")  # no EXIF -> provenance mtime
    make_face(scan / "candidate_b.jpg", shirt=(92, 116, 88))
    old = datetime(2014, 1, 1).timestamp()
    os.utime(refs / "person_b.jpg", (old, old))  # old mtime, but still NOT an event date
    api = make_api(root / "workspace")
    api.handle("set_consent", {"value": True})
    api.handle("enroll", {"personName": "Person B", "ageBucket": "adult", "folder": str(refs)})
    scanned = api.handle("scan", {"folder": str(scan), "source": "age-gap-mtime"})
    matched = [c for c in scanned["state"]["candidates"] if c.get("bestRefId")]
    assert matched, "expected a matched candidate"
    cand = matched[0]
    assert cand.get("referenceCaptureDateProvenance") == "mtime"
    assert cand.get("ageGapConfidence") == "estimated", f"mtime gap must be estimated, got {cand.get('ageGapConfidence')}"
    proj_cand = api.project.candidates[cand["candidateId"]]
    assert "cross-age-gap" not in proj_cand.risk_flags, "an mtime-derived gap must NOT raise the NIST cross-age flag"
    shutil.rmtree(root, ignore_errors=True)
    print("  mtime age-gap estimated (no false NIST band) ok")


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
    assert api.state()["config"].get("safeModeMultimodal") is False
    api.handle(
        "save_settings",
        {"safeMode": True, "safeModeMultimodal": True, "safeModeZeroAdmittance": True},
    )
    reopened = make_api(workspace)
    assert reopened.project.config.safe_mode_zero_admittance is True, "flag should persist across reload"
    assert reopened.project.config.safe_mode_multimodal is True, "multimodal guardrail choice should persist"
    assert reopened.state()["config"].get("safeModeZeroAdmittance") is True
    assert reopened.state()["config"].get("safeModeMultimodal") is True
    audit = reopened.handle("export_safe_mode_audit", {})
    audit_value = audit.get("value", audit)
    import json as _json
    policy = _json.loads(Path(audit_value["jsonPath"]).read_text(encoding="utf-8"))["policy"]
    assert policy["safeModeZeroAdmittance"] is True
    assert policy["safeModeMultimodal"] is True
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
    res = api.handle("set_jurisdiction_preset", {"preset": "gdpr", "confirm": True})
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
        api.handle("set_jurisdiction_preset", {"preset": "atlantis", "confirm": True})
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
    api.handle("set_jurisdiction_preset", {"preset": "gdpr", "confirm": True})
    result = api.handle("export_compliance_pack", {})
    value = result.get("value", result)
    pack_path = Path(value["zipPath"])
    assert pack_path.exists(), "compliance pack zip should exist"
    with zipfile.ZipFile(pack_path) as archive:
        names = set(archive.namelist())
        required = {
            "00-manifest.json",
            "consent-summary.json",
            "subject-release-evidence.json",
            "ai-disclosure-notice.json",
            "biometric-retention-policy.json",
            "destruction-receipts.json",
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
        manifest = json.loads(archive.read("00-manifest.json"))
        assert manifest["schemaVersion"] == 2
        manifest_rows = {row["name"]: row for row in manifest["members"]}
        assert set(manifest_rows) == names - {"00-manifest.json"}
        for name, row in manifest_rows.items():
            content = archive.read(name)
            assert row["bytes"] == len(content)
            assert row["sha256"] == hashlib.sha256(content).hexdigest()
        release_evidence = json.loads(archive.read("subject-release-evidence.json"))
        assert "personName" not in json.dumps(release_evidence)
        assert "signerName" not in json.dumps(release_evidence)
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


def assert_examination_report() -> None:
    import datetime as _dt

    root = Path(tempfile.mkdtemp(prefix="crossage-exam-report-"))
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_a.jpg")
    make_face(scan / "candidate_a.jpg", shirt=(92, 116, 88))
    old = _dt.datetime(2014, 1, 1).timestamp()
    os.utime(refs / "person_a.jpg", (old, old))
    api = make_api(workspace)
    api.handle("set_consent", {"value": True, "operator": "Examiner Q"})
    api.handle("enroll", {"personName": "Person A", "ageBucket": "adult", "folder": str(refs)})
    scanned = api.handle("scan", {"folder": str(scan), "source": "exam"})
    matched = [c for c in scanned["state"]["candidates"] if c.get("bestRefId")]
    assert matched, "expected a matched candidate"
    api.handle("set_status", {"candidateId": matched[0]["candidateId"], "status": "accepted"})
    result = api.handle("export_examination_report", {"personName": "Person A"})
    value = result.get("value", result)
    md_path = Path(value["markdownPath"])
    json_path = Path(value["jsonPath"])
    assert md_path.exists() and json_path.exists(), "report files should exist"
    assert value["candidateCount"] >= 1
    md = md_path.read_text(encoding="utf-8")
    # DRAFT / not-an-identification framing is mandatory.
    assert "DRAFT" in md and "NOT a positive identification" in md, "examiner disclaimer missing"
    assert "Examiner Q" in md, "examiner should be recorded"
    assert "Tamper-evident audit" in md, "audit-chain reference missing"
    assert "Models & provenance" in md, "model provenance section missing"
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["auditChain"]["verified"] is True, "audit chain should verify"
    assert data["candidates"][0]["status"] == "accepted"
    # The cross-age gap evidence is carried into the report. §5.4 governance:
    # "estimated" is a valid band when a capture date is mtime-derived (no EXIF) —
    # the report must show that honestly rather than a false NIST reliability band.
    assert data["candidates"][0]["ageGapConfidence"] in {"very-low", "low", "moderate", "high", "estimated"}
    shutil.rmtree(root, ignore_errors=True)
    print("  examination report ok")


def assert_reverse_geocode_http_is_job_based() -> None:
    root = Path(__file__).resolve().parents[1]
    api_server = (root / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
    photos_view = (root / "src" / "views" / "PhotosView.tsx").read_text(encoding="utf-8")
    provider_block = api_server.split("def _photo_reverse_geocode_provider_lookup", 1)[1].split(
        "def _photo_reverse_geocode_lookup", 1
    )[0]
    assert "urlopen(" not in provider_block
    assert "ThreadPoolExecutor" in api_server
    assert "_photo_reverse_geocode_http_jobs" in api_server
    assert '"lookup-pending"' in api_server
    assert "reverseGeocodePhotoLocationSettled" in photos_view
    print("  reverse geocode HTTP job dispatch ok")


def assert_workspace_state_lock_heartbeats() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-lock-heartbeat-"))
    project = ProjectState(root / "workspace")
    previous = os.environ.get("VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS")
    os.environ["VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS"] = "0.05"
    try:
        with project._state_lock():  # noqa: SLF001 - edge test exercises the lock primitive directly.
            first_mtime = project.lock_path.stat().st_mtime_ns
            time.sleep(0.18)
            second_mtime = project.lock_path.stat().st_mtime_ns
            assert second_mtime > first_mtime
            assert project._workspace_state_lock_active() is True  # noqa: SLF001
        os.environ["VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS"] = "60"
        stolen_project = ProjectState(root / "stolen-workspace")
        with stolen_project._state_lock():  # noqa: SLF001
            stolen_project.lock_path.write_text("other-process-token 2026-07-08T00:00:00Z\n", encoding="utf-8")
        assert stolen_project.lock_path.exists()
        assert stolen_project.lock_path.read_text(encoding="utf-8").startswith("other-process-token ")
        stolen_project.lock_path.unlink()
    finally:
        if previous is None:
            os.environ.pop("VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS", None)
        else:
            os.environ["VINTRACE_STATE_LOCK_HEARTBEAT_SECONDS"] = previous
        shutil.rmtree(root, ignore_errors=True)


def main() -> None:
    assert_corrupt_workspace_recovery()
    assert_corrupt_sqlite_startup_recovery()
    assert_config_round_trip_and_invalid_shape()
    assert_safe_mode_override_schema_migrates_and_private_delete_clears()
    assert_safe_mode_flagged_list_is_paged_and_preview_budgeted()
    assert_safe_mode_calibration_caps_examples_and_forwards_progress()
    assert_invalid_project_rows_are_skipped()
    assert_command_validation_and_empty_inputs()
    assert_consent_workspace_registry_and_audit_pagination()
    assert_broken_and_sensitive_images_do_not_pollute_queue()
    assert_image_decompression_guard()
    assert_static_app_contracts()
    assert_model_downloader_integrity_and_safe_extract()
    assert_corrupt_installed_models_fail_integrity()
    assert_unmatched_clustering_is_global_not_fragmented()
    assert_embedding_cache_reuses_face_work()
    assert_model_spaces_are_isolated_for_matching()
    assert_api_scan_requires_backfill_for_mixed_model_spaces()
    assert_reference_backfill_creates_active_model_embeddings()
    assert_enrollment_reuses_embedding_cache_across_people()
    assert_reference_backfill_reuses_embedding_cache_for_shared_sources()
    assert_pose_bucket_tracking_and_cache_hits()
    assert_profile_pose_uses_review_threshold_without_accepting_frontal_noise()
    assert_match_scoring_flags_close_single_reference_decisions()
    assert_duplicate_content_is_suppressed_across_paths()
    assert_scan_candidates_survive_without_json_snapshot()
    assert_large_store_dedupe_uses_sqlite_lookup()
    assert_heuristic_fallback_safety_is_not_cached()
    assert_safety_model_integrity_runs_only_on_cache_miss()
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
    assert_scan_progress_noisy_phases_are_throttled()
    assert_verification_engine_is_deferred_and_cached()
    assert_reference_suggestion_staging_reports_progress_and_defers_engine()
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
    assert_high_audit_ui_regressions()
    assert_vector_store_edges()
    assert_backend_json_rpc_errors()
    assert_reverse_geocode_http_is_job_based()
    assert_workspace_state_lock_heartbeats()
    assert_structured_backend_error_codes()
    assert_release_hardening_diagnostics()
    assert_support_bundle_redaction_is_strict()
    assert_audit_chain_is_tamper_evident()
    assert_candidate_carries_capture_dates()
    assert_candidate_age_gap_is_surfaced()
    assert_mtime_age_gap_is_estimated_not_nist()
    assert_safe_mode_zero_admittance()
    assert_per_subject_consent()
    assert_jurisdiction_presets()
    assert_compliance_pack()
    assert_multi_workspace_registry()
    assert_nested_exif_original_date_wins_over_ifd0_date()
    assert_examination_report()
    print("edge cases ok")


if __name__ == "__main__":
    main()
