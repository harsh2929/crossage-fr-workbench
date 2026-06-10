from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import zipfile
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.config import RuntimeConfig, load_config, save_config
from crossage_fr.model_manager import MODEL_PACKAGES, ModelPackageSpec, download_model_pack
from crossage_fr.store import VectorStore


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
    assert missing["metrics"]["total"] == 0
    assert missing["metrics"]["errors"] == 0


def assert_consent_workspace_registry_and_audit_pagination() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-registry-"))
    workspace = root / "workspace"
    api = make_api(workspace)
    state = api.state()
    assert state["workspaceMetadata"]["workspaceId"]
    assert state["consentOnFile"] is False
    assert (workspace / ".crossage-workspace.json").exists()
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


def assert_static_app_contracts() -> None:
    root = Path(__file__).resolve().parents[1]
    html = (root / "index.html").read_text(encoding="utf-8")
    assert html.startswith("<!doctype html>"), "index.html must not contain stray text before the doctype."
    assert html.count('<div id="root"></div>') == 1
    assert "Content-Security-Policy" in html
    assert "crossage-media:" in html
    assert "object-src 'none'" in html
    assert "frame-src 'none'" in html

    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    resources = {entry["from"] for entry in package["build"]["extraResources"]}
    assert {"models/safety", "mcp", "report.md", "crossage_fr"} <= resources

    associations = package["build"]["fileAssociations"]
    image_exts = set(associations[0]["ext"])
    video_exts = set(associations[1]["ext"])
    assert {"jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "dng", "raw"} <= image_exts
    assert {"mov", "mp4", "m4v", "avi", "mkv", "webm", "hevc"} <= video_exts

    required_commands = {
        "get_state",
        "set_workspace",
        "set_consent",
        "enroll",
        "enroll_age_groups",
        "scan",
        "scan_paths",
        "analyze_folder",
        "set_status",
        "bulk_set_status",
        "set_candidate_note",
        "clear_queue",
        "purge_candidates",
        "purge_duplicate_candidates",
        "prepare_previews",
        "delete_reference",
        "delete_person",
        "rename_person",
        "clear_references",
        "purge_old_candidates",
        "export_report",
        "export_workspace_backup",
        "export_candidates",
        "workspace_health",
        "runtime_self_test",
        "save_settings",
        "audit_events",
    }
    for rel in ("desktop/main.cjs", "desktop/preload.cjs"):
        text = (root / rel).read_text(encoding="utf-8")
        assert "TRUSTED_BACKEND_COMMANDS" in text
        for command in required_commands:
            assert f'"{command}"' in text, f"{command} is missing from {rel}."


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
        assert progress_events[0]["phase"] == "starting"
        assert progress_events[-1]["phase"] == "complete"
        assert any(event["phase"] == "downloading" for event in progress_events)
        assert any(event["phase"] == "verifying" for event in progress_events)
        assert any(event["phase"] == "extracting" for event in progress_events)

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
    finally:
        MODEL_PACKAGES.pop("tiny_pack", None)
        MODEL_PACKAGES.pop("unsafe_pack", None)


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

    exported = api.handle("export_report", {})
    export_value = exported["value"]
    assert Path(export_value["jsonPath"]).exists()
    assert Path(export_value["csvPath"]).exists()
    export_json = json.loads(Path(export_value["jsonPath"]).read_text(encoding="utf-8"))
    assert export_json["counts"]["accepted"] == 1
    assert export_value["counts"]["candidates"] == 1

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

    self_test = api.handle("runtime_self_test", {})
    check_names = {check["name"] for check in self_test["checks"]}
    assert {"Workspace write", "Recognition engine", "Image decoder", "Workspace health"} <= check_names
    assert self_test["generatedAt"]
    assert self_test["recommendations"]

    audit = api.handle("audit_events", {"limit": 8, "offset": 0})
    actions = {row.get("action") for row in audit["events"]}
    assert {"export_workspace_backup", "export_report", "rename_person"} <= actions

    api.project.candidates[candidate_id].created_at = "2000-01-01T00:00:00Z"
    api.project.save()
    purged = api.handle("purge_old_candidates", {"days": 1})
    assert purged["purged"] == 1
    assert purged["state"]["counts"]["candidates"] == 0

    deleted = api.handle("delete_person", {"personName": "Person Prime"})
    assert deleted["deleted"]["references"] == 1
    assert deleted["state"]["counts"]["references"] == 0
    expect_raises(KeyError, lambda: api.handle("delete_person", {"personName": "Person Prime"}), "Person")


def assert_review_and_settings_guards() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-edge-settings-"))
    api = make_api(root / "workspace")
    expect_raises(ValueError, lambda: api.handle("ping", []), "object")
    expect_raises(PermissionError, lambda: api.handle("enroll", {}), "Consent")
    api.handle("set_consent", {"value": True})
    expect_raises(ValueError, lambda: api.handle("save_settings", {"thresholds": "bad"}), "object")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"thresholds": {"confident": 0.1, "likely": 0.5}}), "descending")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"clusterMinSize": 1}), "at least 2")
    expect_raises(ValueError, lambda: api.handle("save_settings", {"safeModeThreshold": 2}), "between 0 and 1")
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
    assert responses[1]["ok"] is False
    assert "request must be an object" in responses[1]["error"]["message"]
    assert responses[2]["id"] == 6
    assert responses[2]["ok"] is False
    assert "parameters must be an object" in responses[2]["error"]["message"]
    assert responses[3]["id"] == 7
    assert responses[3]["ok"] is False
    assert "Unknown command" in responses[3]["error"]["message"]


def main() -> None:
    assert_corrupt_workspace_recovery()
    assert_config_round_trip_and_invalid_shape()
    assert_invalid_project_rows_are_skipped()
    assert_command_validation_and_empty_inputs()
    assert_consent_workspace_registry_and_audit_pagination()
    assert_broken_and_sensitive_images_do_not_pollute_queue()
    assert_static_app_contracts()
    assert_model_downloader_integrity_and_safe_extract()
    assert_operational_use_case_commands()
    assert_review_and_settings_guards()
    assert_vector_store_edges()
    assert_backend_json_rpc_errors()
    print("edge cases ok")


if __name__ == "__main__":
    main()
