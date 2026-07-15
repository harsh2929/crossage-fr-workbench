"""PHOTO-01: verified PP-OCRv6 inference, portability, persistence, and packaging."""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
from unittest import mock

from PIL import Image, ImageDraw, ImageFont

from crossage_fr.api_server import DesktopApi
from crossage_fr.photo_ocr import (
    ARTIFACTS,
    MANIFEST_SHA256,
    MODEL_ID,
    MODEL_VERSION,
    RUNTIME_VERSION,
    clear_ppocrv6_caches,
    ppocrv6_model_report,
    run_ppocrv6,
)
from photo_folders_units import _api


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "ocr"
BILINGUAL_FIXTURE = ROOT / "tests" / "fixtures" / "ocr" / "paddleocr-general-ocr-002.jpg"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _write_text_image(path: Path, text: str) -> None:
    image = Image.new("RGB", (800, 240), "white")
    draw = ImageDraw.Draw(image)
    draw.text((35, 70), text, fill="black", font=_font(72))
    image.save(path)


def _copy_model_pack(target: Path) -> Path:
    destination = target / "models" / "ocr"
    shutil.copytree(MODEL_DIR, destination)
    return destination


@contextmanager
def _blocked_network():
    original_socket = socket.socket
    original_connection = socket.create_connection

    def blocked(*_args, **_kwargs):
        raise AssertionError("network access attempted during local PP-OCRv6 inference")

    socket.socket = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        yield
    finally:
        socket.socket = original_socket  # type: ignore[assignment]
        socket.create_connection = original_connection  # type: ignore[assignment]


def test_model_pack_and_dependency_are_exactly_pinned() -> None:
    report = ppocrv6_model_report(validate_runtime=True)
    assert report["available"] is True, report
    assert report["verified"] is True, report
    assert report["runtimeValidated"] is True, report
    assert report["modelId"] == MODEL_ID, report
    assert report["modelVersion"] == MODEL_VERSION, report
    assert report["installedRuntimeVersion"] == RUNTIME_VERSION, report
    assert report["manifestSha256"] == MANIFEST_SHA256, report
    assert _sha256(MODEL_DIR / "manifest.json") == MANIFEST_SHA256
    for role, expected in ARTIFACTS.items():
        artifact = MODEL_DIR / str(expected["filename"])
        assert artifact.stat().st_size == expected["sizeBytes"], (role, artifact.stat().st_size)
        assert _sha256(artifact) == expected["sha256"], role
        assert report["artifacts"][role]["sha256"] == expected["sha256"], report

    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    lock = (ROOT / "requirements-production.lock.txt").read_text(encoding="utf-8")
    assert "rapidocr==3.9.1" in requirements
    assert "rapidocr==3.9.1" in lock
    assert "rapidocr-onnxruntime" not in requirements
    assert "rapidocr-onnxruntime" not in lock
    assert "opencv-python-headless" not in requirements
    assert "opencv-python-headless" not in lock
    print("ok PP-OCRv6 model pack and Python 3.13 runtime are exactly pinned")


def test_ppocrv6_extracts_english_and_cjk_offline() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-offline-") as temp_name:
        english = Path(temp_name) / "ticket.png"
        _write_text_image(english, "BOARDING PASS 12A")
        clear_ppocrv6_caches()
        with _blocked_network():
            english_result = run_ppocrv6(english)
            bilingual_result = run_ppocrv6(BILINGUAL_FIXTURE)

    assert "BOARDING PASS" in english_result["text"].upper(), english_result
    assert "12A" in english_result["text"].upper(), english_result
    assert english_result["lines"], english_result
    assert all(len(line["box"]) >= 4 for line in english_result["lines"]), english_result
    assert english_result["provenance"]["modelId"] == MODEL_ID, english_result
    assert "BOARDING PASS" in bilingual_result["text"].upper(), bilingual_result
    assert "登机牌" in bilingual_result["text"], bilingual_result
    assert "张祺伟" in bilingual_result["text"], bilingual_result
    assert len(bilingual_result["lines"]) >= 20, bilingual_result
    print("ok PP-OCRv6 recognizes Latin and CJK text with sockets blocked")


def test_windows_folder_index_persists_blocks_and_search_across_restart() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-windows-") as temp_name:
        root = Path(temp_name)
        source = root / "Windows Pictures" / "Travel"
        source.mkdir(parents=True)
        photo = source / "boarding-ticket.png"
        _write_text_image(photo, "BOARDING PASS 12A")
        api = _api(temp_name)

        preview = api.handle(
            "preview_windows_photo_folder",
            {"libraryPath": str(source.parent), "itemLimit": 20, "sampleLimit": 10, "timeBudgetMs": 2_000},
        )["value"]
        assert preview["counts"]["assets"] == 1, preview
        imported = api.handle(
            "import_windows_photo_folder",
            {
                "libraryPath": str(source.parent),
                "externalIds": [preview["samples"][0]["externalId"]],
                "storageMode": "referenced",
                "runInline": True,
            },
        )["value"]["job"]
        assert imported["status"] == "completed", imported
        assert imported["result"]["counts"]["imported"] == 1, imported

        asset = api.project.db.photo_asset_by_path(str(photo.resolve()))
        assert asset, "Windows-folder asset was not persisted"
        api.save_photo_library_settings(
            {
                "localSettings": {
                    "localIntelligenceEnabled": True,
                    "noNetworkIntelligence": True,
                    "backgroundIndexingPaused": False,
                    "indexingPowerMode": "balanced",
                }
            }
        )
        indexed = api.index_photo_ocr({"sourcePaths": [asset["sourcePath"]], "force": True, "language": "en"})
        assert indexed["progress"] == {
            "total": 1,
            "processed": 1,
            "updated": 1,
            "skipped": 0,
            "failed": 0,
            "deferred": 0,
        }, indexed
        assert indexed["items"][0]["source"] == "ppocrv6-rapidocr", indexed

        persisted = api.project.db.photo_asset_by_id(asset["assetId"])
        local_ocr = persisted["metadata"]["localOcr"]
        assert local_ocr["engine"] == "ppocrv6-rapidocr", local_ocr
        assert local_ocr["model"]["modelId"] == MODEL_ID, local_ocr
        assert local_ocr["model"]["runtimeVersion"] == RUNTIME_VERSION, local_ocr
        assert local_ocr["regionCount"] >= 1, local_ocr
        blocks = api.project.db.photo_ocr_blocks_for_asset(asset["assetId"])
        assert blocks, persisted
        assert all(block["source"] == "ppocrv6-rapidocr" for block in blocks), blocks
        assert all(block["metadata"]["model"]["modelId"] == MODEL_ID for block in blocks), blocks
        assert all(block["bounds"].get("unit") == "percent" for block in blocks), blocks

        search = api.search_photo_library({"query": "BOARDING 12A"})
        photos = next(group for group in search["groups"] if group["id"] == "photos")
        assert photos["items"][0]["assetId"] == asset["assetId"], search

        restarted = DesktopApi(api.project.root)
        after_restart = restarted.project.db.photo_asset_by_id(asset["assetId"])
        assert after_restart["metadata"]["localOcr"]["model"]["modelVersion"] == MODEL_VERSION, after_restart
        restarted_blocks = restarted.project.db.photo_ocr_blocks_for_asset(asset["assetId"])
        assert restarted_blocks == blocks, (blocks, restarted_blocks)
        restarted_search = restarted.search_photo_library({"query": "BOARDING 12A"})
        restarted_photos = next(group for group in restarted_search["groups"] if group["id"] == "photos")
        assert restarted_photos["items"][0]["assetId"] == asset["assetId"], restarted_search
    print("ok Windows-folder PP-OCRv6 indexing, blocks, FTS, and restart persistence")


def test_model_pack_tampering_fails_closed() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-integrity-") as temp_name:
        root = Path(temp_name)
        model_dir = _copy_model_pack(root)
        assert ppocrv6_model_report(root=root)["verified"] is True

        detector = model_dir / str(ARTIFACTS["detector"]["filename"])
        original = detector.read_bytes()
        detector.write_bytes(bytes([original[0] ^ 0x01]) + original[1:])
        clear_ppocrv6_caches()
        detector_report = ppocrv6_model_report(root=root)
        assert detector_report["available"] is False, detector_report
        assert detector_report["verified"] is False, detector_report
        assert "checksum" in detector_report["reason"].lower(), detector_report
        detector.write_bytes(original)

        license_path = model_dir / "LICENSE"
        license_path.write_text("tampered\n", encoding="utf-8")
        clear_ppocrv6_caches()
        license_report = ppocrv6_model_report(root=root)
        assert license_report["verified"] is False, license_report
        assert "license" in license_report["reason"].lower(), license_report
        shutil.copy2(MODEL_DIR / "LICENSE", license_path)

        manifest_path = model_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["version"] = "tampered"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        clear_ppocrv6_caches()
        manifest_report = ppocrv6_model_report(root=root)
        assert manifest_report["verified"] is False, manifest_report
        assert "manifest checksum" in manifest_report["reason"].lower(), manifest_report
    clear_ppocrv6_caches()
    print("ok PP-OCRv6 model and license tampering fail closed")


def test_packaged_mode_ignores_environment_and_current_directory_overrides() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-packaged-") as temp_name:
        root = Path(temp_name)
        bundle = root / "bundle"
        bundled_model_dir = _copy_model_pack(bundle)
        override = root / "override"
        override.mkdir()
        (override / "manifest.json").write_text("{}\n", encoding="utf-8")
        cwd = root / "cwd"
        (cwd / "models" / "ocr").mkdir(parents=True)
        (cwd / "models" / "ocr" / "manifest.json").write_text("{}\n", encoding="utf-8")
        original_cwd = Path.cwd()
        clear_ppocrv6_caches()
        try:
            os.chdir(cwd)
            with (
                mock.patch.object(sys, "frozen", True, create=True),
                mock.patch.object(sys, "_MEIPASS", str(bundle), create=True),
                mock.patch.dict(os.environ, {"CROSSAGE_PP_OCRV6_MODEL_DIR": str(override)}),
            ):
                report = ppocrv6_model_report(validate_runtime=True)
        finally:
            os.chdir(original_cwd)
            clear_ppocrv6_caches()
        assert report["verified"] is True, report
        assert Path(report["path"]) == bundled_model_dir.resolve(), report
    print("ok packaged PP-OCRv6 ignores environment and cwd model overrides")


def test_runtime_and_distribution_surfaces_report_ppocrv6() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-status-") as temp_name:
        api = _api(temp_name)
        runtime = api.runtime_self_test()
        runtime_check = next(check for check in runtime["checks"] if check["name"] == "Photo OCR model")
        assert runtime_check["ok"] is True, runtime_check
        assert runtime_check["value"]["modelId"] == MODEL_ID, runtime_check
        integrity = api.model_integrity()
        integrity_check = next(check for check in integrity["checks"] if check["name"] == "Photo OCR model")
        assert integrity_check["ok"] is True, integrity_check
        distribution = api.model_distribution_audit()
        item = next(item for item in distribution["items"] if item["kind"] == "photo-ocr")
        assert item["redistributionReady"] is True, item
        assert item["sha256"] == MANIFEST_SHA256, item
        assert item["sizeBytes"] == sum(int(spec["sizeBytes"]) for spec in ARTIFACTS.values()), item
    print("ok runtime, integrity, and distribution surfaces report verified PP-OCRv6")


def test_fixture_provenance_is_pinned() -> None:
    assert BILINGUAL_FIXTURE.stat().st_size == 128_713
    assert _sha256(BILINGUAL_FIXTURE) == "4425af33dd163cf73bdff502bd35ee527e9bdd5725501db1da78bfdae9f538f4"
    fixture_notice = BILINGUAL_FIXTURE.with_name("README.md").read_text(encoding="utf-8")
    assert "b03f46425e8ff4442b268ce449e3eef758146cd4" in fixture_notice
    assert "Apache-2.0" in fixture_notice


if __name__ == "__main__":
    test_model_pack_and_dependency_are_exactly_pinned()
    test_ppocrv6_extracts_english_and_cjk_offline()
    test_windows_folder_index_persists_blocks_and_search_across_restart()
    test_model_pack_tampering_fails_closed()
    test_packaged_mode_ignores_environment_and_current_directory_overrides()
    test_runtime_and_distribution_surfaces_report_ppocrv6()
    test_fixture_provenance_is_pinned()
    print("all photo_rapidocr_units tests passed")
