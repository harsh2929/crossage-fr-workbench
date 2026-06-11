from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, image_decoder_report, iter_image_paths, load_image
from crossage_fr.ingest.safety import safety_model_report
from crossage_fr.model_manager import MODEL_PACKAGES
from crossage_fr.platform_detect import detect_platform, get_providers, split_provider_config


def make_face_frame(shirt=(74, 88, 138)) -> Image.Image:
    image = Image.new("RGB", (280, 280), (182, 152, 116))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
    draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
    draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
    draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
    draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
    draw.rectangle((116, 168, 164, 246), fill=shirt)
    return image


def make_face(path: Path, shirt=(74, 88, 138)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    make_face_frame(shirt).save(path, quality=95)


def make_face_video(path: Path) -> None:
    import cv2

    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 6.0, (280, 280))
    if not writer.isOpened():
        raise AssertionError("OpenCV could not create the synthetic video fixture.")
    try:
        for index in range(18):
            image = make_face_frame(shirt=(92 + index % 4, 116, 88))
            frame = np.asarray(image)[:, :, ::-1]
            writer.write(frame)
    finally:
        writer.release()


def make_sensitive(path: Path) -> None:
    image = Image.new("RGB", (280, 280), (232, 198, 168))
    draw = ImageDraw.Draw(image)
    draw.ellipse((20, 10, 260, 290), fill=(236, 198, 164))
    draw.rectangle((0, 0, 280, 28), fill=(34, 34, 42))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=95)


def assert_platform_edges() -> None:
    with patch("crossage_fr.platform_detect.available_onnx_providers", return_value=["CoreMLExecutionProvider", "CPUExecutionProvider"]):
        with patch("crossage_fr.platform_detect.platform.system", return_value="Darwin"):
            with patch("crossage_fr.platform_detect.platform.machine", return_value="arm64"):
                assert detect_platform() == "apple_silicon"
                selected = get_providers("apple_silicon")
                assert selected[0][0] == "CoreMLExecutionProvider"
                provider_names, provider_options = split_provider_config(selected)
                assert provider_names[0] == "CoreMLExecutionProvider"
                assert provider_options is not None
                assert provider_options[0]["RequireStaticInputShapes"] == "1"
                assert provider_options[0]["ModelCacheDirectory"]

    with patch("crossage_fr.platform_detect.available_onnx_providers", return_value=["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]):
        with patch("crossage_fr.platform_detect.platform.system", return_value="Linux"):
            with patch("crossage_fr.platform_detect.platform.machine", return_value="x86_64"):
                assert detect_platform() == "nvidia"
                selected = get_providers("nvidia")
                assert selected[0][0] == "TensorrtExecutionProvider"
                assert selected[0][1]["trt_fp16_enable"] is True
                assert selected[0][1]["trt_engine_cache_enable"] is True
                assert selected[0][1]["trt_timing_cache_enable"] is True

    with patch("crossage_fr.platform_detect.available_onnx_providers", return_value=["DmlExecutionProvider", "CPUExecutionProvider"]):
        with patch("crossage_fr.platform_detect.platform.system", return_value="Windows"):
            assert detect_platform() == "windows_directml"
            assert get_providers("windows_directml")[0] == "DmlExecutionProvider"

    with patch("crossage_fr.platform_detect.available_onnx_providers", return_value=["OpenVINOExecutionProvider", "CPUExecutionProvider"]):
        with patch("crossage_fr.platform_detect.platform.system", return_value="Linux"):
            with patch("crossage_fr.platform_detect.platform.machine", return_value="x86_64"):
                assert detect_platform() == "cpu_openvino"
                selected = get_providers("cpu_openvino")
                assert selected[0][0] == "OpenVINOExecutionProvider"
                assert selected[0][1]["device_type"] == "AUTO:GPU,NPU,CPU"


def assert_exif_orientation() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-exif-"))
    path = root / "rotated.jpg"
    image = Image.new("RGB", (48, 24), (255, 255, 255))
    exif = Image.Exif()
    exif[274] = 6
    image.save(path, exif=exif)
    loaded = load_image(path)
    assert loaded.size == (24, 48), f"EXIF orientation was not applied: {loaded.size}"


def assert_extended_image_formats() -> None:
    root = Path(tempfile.mkdtemp(prefix="crossage-formats-"))
    base = Image.new("RGB", (64, 48), (84, 132, 188))
    alpha = Image.new("RGBA", (64, 48), (84, 132, 188, 128))
    alpha.save(root / "alpha.png")
    base.save(root / "photo.jfif", format="JPEG")
    frames = [Image.new("RGB", (64, 48), (220, 40, 40)), Image.new("RGB", (64, 48), (40, 180, 90))]
    frames[0].save(root / "animated.gif", save_all=True, append_images=[frames[1]], duration=30, loop=0)

    optional_formats = [
        ("sample.webp", "WEBP"),
        ("sample.avif", "AVIF"),
        ("sample.jp2", "JPEG2000"),
        ("sample.tga", "TGA"),
    ]
    for filename, image_format in optional_formats:
        try:
            base.save(root / filename, format=image_format)
        except Exception:
            pass
    try:
        import pillow_heif

        pillow_heif.from_pillow(base).save(root / "sample.heic")
    except Exception:
        pass

    loaded = []
    for path in iter_image_paths(root):
        image = load_image(path)
        assert image.mode == "RGB", f"{path.name} did not load as RGB"
        assert image.width > 0 and image.height > 0
        loaded.append(path.suffix.lower())
    assert ".gif" in loaded
    assert ".png" in loaded
    assert ".jfif" in loaded
    assert {".gif", ".avif", ".heic", ".dng", ".icns"} <= IMAGE_EXTENSIONS
    report = image_decoder_report()
    assert report["heifAvailable"] is True
    assert report["rawAvailable"] is True
    assert ".gif" in report["extensions"]


def assert_safe_mode_model_bundle() -> None:
    root = Path(__file__).resolve().parents[1]
    model_path = root / "models" / "safety" / "adamcodd_vit_base_nsfw_int8.onnx"
    manifest_path = model_path.with_suffix(".json")
    old_force = os.environ.pop("CROSSAGE_FORCE_FALLBACK", None)
    old_engine = os.environ.pop("CROSSAGE_SAFE_MODE_ENGINE", None)
    old_model = os.environ.pop("CROSSAGE_SAFE_MODEL", None)
    old_model_dir = os.environ.pop("CROSSAGE_SAFE_MODEL_DIR", None)
    try:
        report = safety_model_report()
    finally:
        if old_force is not None:
            os.environ["CROSSAGE_FORCE_FALLBACK"] = old_force
        if old_engine is not None:
            os.environ["CROSSAGE_SAFE_MODE_ENGINE"] = old_engine
        if old_model is not None:
            os.environ["CROSSAGE_SAFE_MODEL"] = old_model
        if old_model_dir is not None:
            os.environ["CROSSAGE_SAFE_MODEL_DIR"] = old_model_dir

    assert model_path.exists(), "Bundled Safe Mode ONNX model is missing."
    assert manifest_path.exists(), "Bundled Safe Mode model manifest is missing."
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert report["available"] is True
    assert report["engine"] == "onnx-hybrid"
    assert Path(report["path"]).samefile(model_path)
    assert report["modelName"] == manifest["modelName"]
    assert report["source"] == manifest["source"]
    assert report["license"] == manifest["license"]
    assert report["inputSize"] == manifest["inputSize"]
    assert report["labels"] == manifest["labels"]
    assert report["nsfwIndex"] == manifest["labels"].index(manifest["nsfwLabel"])


def assert_face_model_setup_status() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="crossage-model-setup-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(root / "workspace")
    model_root = root / "downloaded-models"
    state = api.handle("set_model_root", {"root": str(model_root)})
    setup = state["modelSetup"]
    assert setup["ready"] is False
    assert setup["fallbackActive"] is True
    assert setup["currentPack"] == "antelopev2"
    assert {item["pack"] for item in setup["packages"]} >= {"antelopev2", "buffalo_l"}
    for pack in setup["packages"]:
        spec = MODEL_PACKAGES[pack["pack"]]
        assert pack["sha256"] == spec.sha256
        assert pack["size_bytes"] == spec.size_bytes
        assert pack["available"] is False
    assert state["config"]["modelRoot"] == str(model_root.resolve())
    assert state["modelSetup"]["modelRoot"] == str(model_root.resolve())


def assert_pipeline_state() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="crossage-pipeline-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    refs = root / "refs"
    scan = root / "scan"
    make_face(refs / "person_a.jpg")
    make_face(scan / "candidate_a.jpg", shirt=(92, 116, 88))
    make_sensitive(scan / "protected.jpg")

    api = DesktopApi(root / "workspace")
    try:
        api.handle("enroll", {"personName": "Person A", "ageBucket": "child", "folder": str(refs)})
        raise AssertionError("Enrollment should require consent.")
    except PermissionError:
        pass

    api.handle("set_consent", {"value": True})
    enrolled = api.handle("enroll", {"personName": "Person A", "ageBucket": "child", "folder": str(refs)})
    assert enrolled["added"] >= 1
    progress_events: list[dict] = []
    scanned = api.handle("scan", {"folder": str(scan), "source": "pipeline-smoke"}, progress=progress_events.append)
    assert scanned["metrics"]["processed"] == 2
    assert scanned["metrics"]["safeFiltered"] == 1
    state = scanned["state"]
    assert state["scanTotals"]["runs"] == 1
    assert state["scanTotals"]["processed"] == 2
    assert state["scanHistory"][0]["source"] == "pipeline-smoke"
    assert state["config"]["reviewOnly"] is True
    assert state["config"]["safeMode"] is True
    assert all("memoryPressure" in event for event in progress_events)
    assert all("processMemoryBytes" in event for event in progress_events)
    assert any(event["phase"] == "candidate" and "state" in event for event in progress_events)
    assert any(event["phase"] == "complete" and "state" in event for event in progress_events)
    assert all("state" not in event for event in progress_events if event["phase"] in {"started", "processing", "processed", "protected"})


def assert_memory_pressure_progress() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="crossage-memory-pressure-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(root / "workspace")
    events: list[dict] = []
    with patch("crossage_fr.api_server.memory_available_bytes", return_value=320 * 1024 * 1024):
        with patch("crossage_fr.api_server.process_memory_bytes", return_value=700 * 1024 * 1024):
            api._progress(events.append, {"phase": "processing", "total": 10, "processed": 1})
    assert events, "Memory pressure progress should emit an event."
    assert events[-1]["memoryPressure"] in {"high", "critical"}
    assert events[-1]["memoryAvailableBytes"] == 320 * 1024 * 1024
    assert events[-1]["processMemoryBytes"] == 700 * 1024 * 1024


def assert_video_pipeline_state() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="crossage-video-pipeline-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    refs = root / "refs"
    scan = root / "scan"
    video_path = scan / "candidate_clip.avi"
    make_face(refs / "person_a.jpg")
    make_face_video(video_path)

    api = DesktopApi(root / "workspace")
    api.handle("set_consent", {"value": True})
    assert api.handle("enroll", {"personName": "Person A", "ageBucket": "adult", "folder": str(refs)})["added"] >= 1
    preflight = api.handle("analyze_folder", {"folder": str(scan)})
    assert preflight["imageCount"] == 0
    assert preflight["videoCount"] == 1
    assert preflight["checkedVideos"] == 1
    assert preflight["videoDecoder"]["opencvAvailable"] is True

    scanned = api.handle("scan", {"folder": str(scan), "source": "video-smoke"})
    assert scanned["metrics"]["processed"] == 1
    assert scanned["metrics"]["videoFiles"] == 1
    assert scanned["metrics"]["videoFrames"] >= 2
    assert scanned["state"]["scanTotals"]["videoFiles"] == 1
    assert scanned["state"]["scanTotals"]["videoFrames"] >= 2
    video_candidates = [
        candidate
        for candidate in scanned["state"]["candidates"]
        if candidate["mediaKind"] == "video" and candidate["mediaSourcePath"] == str(video_path.resolve())
    ]
    assert video_candidates, "Video scan should queue at least one candidate with video metadata."
    assert all(candidate["videoTimestampMs"] is not None for candidate in video_candidates)
    assert all(Path(candidate["sourcePath"]).exists() for candidate in video_candidates)


def main() -> None:
    assert_platform_edges()
    assert_exif_orientation()
    assert_extended_image_formats()
    assert_safe_mode_model_bundle()
    assert_face_model_setup_status()
    assert_pipeline_state()
    assert_memory_pressure_progress()
    assert_video_pipeline_state()
    print("pipeline smoke ok")


if __name__ == "__main__":
    main()
