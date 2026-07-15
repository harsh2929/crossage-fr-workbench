"""PHOTO-05 local generative editing contracts and acceptance tests.

The default suite is hermetic and uses a tiny fake runtime only for installer and
edit-stack orchestration. Set VINTRACE_GENERATIVE_TEST_ROOT to a verified light
pack to additionally execute real LaMa and Real-ESRGAN inference offline.
"""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import socket
import tempfile
import zipfile

from PIL import Image, ImageChops, ImageDraw

import crossage_fr.api_server as api_server_module
import crossage_fr.photo_generative as generative
from photo_folders_units import _api


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_runtime_zip(path: Path, executable: str) -> bytes:
    with zipfile.ZipFile(path, "w") as archive:
        executable_info = zipfile.ZipInfo(executable)
        # The pinned upstream macOS archive does not preserve an executable bit.
        executable_info.external_attr = 0o600 << 16
        archive.writestr(executable_info, b"#!/bin/sh\nexit 0\n")
        archive.writestr("models/realesrgan-x4plus.param", b"param")
        archive.writestr("models/realesrgan-x4plus.bin", b"weights")
        archive.writestr("LICENSE.txt", b"fixture license")
    return path.read_bytes()


def test_catalog_and_hardware_gate() -> None:
    catalog = generative.load_catalog()
    assert catalog["catalogId"] == "vintrace-photo-generative"
    assert catalog["version"] == generative.CATALOG_VERSION
    assert catalog["offlineInference"] is True
    assert catalog["light"]["cleanup"]["license"] == "Apache-2.0"
    assert catalog["light"]["upscale"]["license"] == "BSD-3-Clause"
    assert catalog["heavy"]["license"] == "Apache-2.0"
    assert sum(item["sizeBytes"] for item in catalog["heavy"]["artifacts"]) == 22_883_235_550
    with tempfile.TemporaryDirectory() as tmp:
        status = generative.photo_generative_status(tmp, total_memory_bytes=24 * 1024**3)
        assert status["offlineInference"] is True
        assert status["light"]["ready"] is False
        assert status["heavy"]["hardwareSupported"] is False
        assert status["heavy"]["available"] is False
        assert status["modes"] == {
            "cleanup": False,
            "upscale": False,
            "expand": False,
            "reframe": False,
            "relight": False,
            "age-progress": False,
        }
        unknown_memory = generative.photo_generative_status(tmp, total_memory_bytes=0)
        assert unknown_memory["heavy"]["hardwareSupported"] is False
        assert "could not verify" in unknown_memory["heavy"]["reason"]


def test_catalog_and_archive_tamper_are_rejected() -> None:
    original_catalog_override = os.environ.get("VINTRACE_GENERATIVE_CATALOG")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tampered = Path(tmp) / "catalog.json"
            tampered.write_text(generative.catalog_path().read_text(encoding="utf-8") + "\n", encoding="utf-8")
            os.environ["VINTRACE_GENERATIVE_CATALOG"] = str(tampered)
            try:
                generative.load_catalog()
                raise AssertionError("tampered catalog was accepted")
            except generative.PhotoGenerativeIntegrityError:
                pass
            unsafe = Path(tmp) / "unsafe.zip"
            with zipfile.ZipFile(unsafe, "w") as archive:
                archive.writestr("../escape", b"no")
            try:
                generative._expected_zip_files(unsafe)  # noqa: SLF001
                raise AssertionError("unsafe archive path was accepted")
            except generative.PhotoGenerativeIntegrityError:
                pass
    finally:
        if original_catalog_override is None:
            os.environ.pop("VINTRACE_GENERATIVE_CATALOG", None)
        else:
            os.environ["VINTRACE_GENERATIVE_CATALOG"] = original_catalog_override


def test_resumable_installer_contract_with_verified_fixture() -> None:
    original_load_catalog = generative.load_catalog
    original_platform_key = generative.platform_key
    original_download = generative._download_file  # noqa: SLF001
    try:
        with tempfile.TemporaryDirectory() as tmp:
            fixture_root = Path(tmp) / "fixtures"
            fixture_root.mkdir()
            cleanup_payload = b"tiny-lama-fixture"
            cleanup_source = fixture_root / "lama.onnx"
            cleanup_source.write_bytes(cleanup_payload)
            runtime_source = fixture_root / "runtime.zip"
            runtime_payload = _write_runtime_zip(runtime_source, "realesrgan-ncnn-vulkan")
            catalog = deepcopy(original_load_catalog())
            cleanup = catalog["light"]["cleanup"]["artifact"]
            cleanup.update(
                {
                    "filename": "lama.onnx",
                    "sizeBytes": len(cleanup_payload),
                    "sha256": _sha(cleanup_payload),
                    "url": "https://fixtures.invalid/lama.onnx",
                }
            )
            runtime = catalog["light"]["upscale"]["platforms"]["darwin-arm64"]
            runtime.update(
                {
                    "archive": "runtime.zip",
                    "sizeBytes": len(runtime_payload),
                    "sha256": _sha(runtime_payload),
                    "url": "https://fixtures.invalid/runtime.zip",
                    "executable": "realesrgan-ncnn-vulkan",
                }
            )
            sources = {"lama.onnx": cleanup_source, "runtime.zip": runtime_source}

            def fixture_download(spec, destination, *, force, emit):
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = sources[destination.name]
                destination.write_bytes(source.read_bytes())
                if destination.name == "runtime.zip":
                    destination.chmod(0o600)
                generative.clear_verification_cache()
                generative._verify_pinned_file(destination, spec["sizeBytes"], spec["sha256"])  # noqa: SLF001
                emit({"phase": "verified", "file": destination.name, "fileBytes": spec["sizeBytes"]})

            generative.load_catalog = lambda: catalog
            generative.platform_key = lambda: "darwin-arm64"
            generative._download_file = fixture_download  # type: ignore[assignment]  # noqa: SLF001
            install_root = Path(tmp) / "installed"
            events: list[dict] = []
            result = generative.install_photo_generative_pack("light", install_root, on_progress=events.append)
            assert result["installed"] is True
            assert result["status"]["light"]["ready"] is True
            runtime_path = install_root / "runtime" / "realesrgan" / "darwin-arm64" / "realesrgan-ncnn-vulkan"
            assert os.access(runtime_path, os.X_OK)
            assert events[-1]["phase"] == "complete"
            assert events[-1]["percent"] == 100.0
            model_path = install_root / "models" / "light" / "lama.onnx"
            model_path.write_bytes(b"tampered")
            generative.clear_verification_cache()
            status = generative.photo_generative_status(install_root, total_memory_bytes=64 * 1024**3)
            assert status["light"]["cleanup"]["available"] is False
            assert "mismatch" in status["light"]["cleanup"]["error"].lower()
    finally:
        generative.load_catalog = original_load_catalog
        generative.platform_key = original_platform_key
        generative._download_file = original_download  # type: ignore[assignment]  # noqa: SLF001
        generative.clear_verification_cache()


def test_heavy_install_requires_acknowledgement_before_network() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        try:
            generative.install_photo_generative_pack(
                "heavy",
                tmp,
                acknowledge_large_download=False,
                total_memory_bytes=64 * 1024**3,
            )
            raise AssertionError("heavy pack installed without acknowledgement")
        except ValueError as exc:
            assert generative.HEAVY_ACKNOWLEDGEMENT in str(exc)
        try:
            generative.install_photo_generative_pack(
                "heavy",
                tmp,
                acknowledge_large_download=True,
                total_memory_bytes=24 * 1024**3,
            )
            raise AssertionError("heavy pack ignored its hardware gate")
        except generative.PhotoGenerativeUnavailableError as exc:
            assert "48 GiB" in str(exc)


def test_qwen_command_is_pinned_and_shell_free() -> None:
    command = generative.build_qwen_command(
        executable="sd-cli",
        diffusion_model="diffusion.gguf",
        vae="vae.safetensors",
        text_encoder="encoder.safetensors",
        reference="ref.png",
        output="out.png",
        prompt="preserve identity",
        width=1024,
        height=768,
        seed=42,
        steps=20,
    )
    assert command[0] == "sd-cli"
    for required in (
        "--diffusion-model",
        "--vae",
        "--llm",
        "-r",
        "--cfg-scale",
        "--sampling-method",
        "--offload-to-cpu",
        "--diffusion-fa",
        "--vae-tiling",
        "--auto-fit",
        "--model-args",
        "qwen_image_zero_cond_t=true",
    ):
        assert required in command
    assert command[command.index("--cfg-scale") + 1] == "2.5"
    assert command[command.index("--sampling-method") + 1] == "euler"
    assert command[command.index("--flow-shift") + 1] == "3"
    assert all(";" not in item for item in command)


def test_qwen_runner_uses_verified_local_inputs_and_offline_environment() -> None:
    original_memory = generative.total_system_memory_bytes
    original_runtime = generative.verify_runtime
    original_models = generative.verify_heavy_models
    original_run = generative.subprocess.run
    captured: dict = {}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.png"
            target = root / "result.png"
            Image.new("RGB", (80, 60), (40, 80, 120)).save(source)
            original_sha = generative.hash_file(source)
            catalog = generative.load_catalog()
            generative.total_system_memory_bytes = lambda: 64 * 1024**3
            generative.verify_runtime = lambda runtime_id, model_root, payload: {
                "id": "stable-diffusion.cpp",
                "tag": "master-775-b5d8120",
                "revision": "b5d812008eb7082a238fc589444544b3278187ae",
                "license": "MIT",
                "platform": "darwin-arm64",
                "archiveSha256": "1" * 64,
                "executable": "/verified/runtime/sd-cli",
                "runtimeDirectory": "/verified/runtime",
            }
            generative.verify_heavy_models = lambda model_root, payload: {
                "artifacts": [
                    {"role": "diffusion-model", "path": "/verified/models/diffusion.gguf"},
                    {"role": "vae", "path": "/verified/models/vae.safetensors"},
                    {"role": "text-encoder", "path": "/verified/models/encoder.safetensors"},
                ]
            }

            def fake_run(command, **kwargs):
                captured.update({"command": list(command), **kwargs})
                output = Path(command[command.index("-o") + 1])
                width = int(command[command.index("--width") + 1])
                height = int(command[command.index("--height") + 1])
                Image.new("RGB", (width, height), (90, 110, 135)).save(output)
                return type("Completed", (), {"returncode": 0})()

            generative.subprocess.run = fake_run
            result = generative._run_qwen_edit(  # noqa: SLF001
                source,
                target,
                "relight",
                {"aspect": "square", "prompt": "warm window light", "seed": 7, "steps": 16},
                root,
                catalog,
                45.0,
            )
            assert target.is_file() and Image.open(target).size == (512, 512)
            assert result["model"]["id"] == "Qwen/Qwen-Image-Edit-2511"
            assert result["runtime"]["id"] == "stable-diffusion.cpp"
            assert result["parameters"] == {
                "aspect": "square",
                "prompt": "warm window light",
                "seed": 7,
                "steps": 16,
                "cfgScale": 2.5,
                "flowShift": 3,
            }
            assert captured["cwd"] == "/verified/runtime"
            assert captured["check"] is False and captured["capture_output"] is True
            assert captured["timeout"] == 45.0
            assert captured["env"]["HF_HUB_OFFLINE"] == "1"
            assert captured["env"]["HTTPS_PROXY"] == ""
            assert captured["command"][0] == "/verified/runtime/sd-cli"
            assert generative.hash_file(source) == original_sha

            age_target = root / "age-result.png"
            age_result = generative._run_qwen_edit(  # noqa: SLF001
                source,
                age_target,
                "age-progress",
                {"targetAgeBucket": "senior", "seed": 11, "steps": 18},
                root,
                catalog,
                45.0,
            )
            age_prompt = captured["command"][captured["command"].index("-p") + 1]
            assert "approximately 72 years old" in age_prompt
            assert "same consenting person" in age_prompt
            assert "infer sensitive traits" in age_prompt
            assert age_result["parameters"]["targetAgeBucket"] == "senior"
            assert age_result["parameters"]["targetAgeYears"] == 72
            assert age_result["parameters"]["fixedSafetyPrompt"] is True
            assert age_result["parameters"]["promptVersion"] == generative.AGE_PROGRESS_PROMPT_VERSION
            assert age_result["parameters"]["promptSha256"] == generative.age_progress_prompt_sha256("senior")
            assert hashlib.sha256(age_prompt.encode("utf-8")).hexdigest() == age_result["parameters"]["promptSha256"]
            assert age_result["parameters"]["prompt"] == ""
            try:
                generative._run_qwen_edit(  # noqa: SLF001
                    source,
                    root / "unsafe.png",
                    "age-progress",
                    {"targetAgeBucket": "senior", "prompt": "change identity"},
                    root,
                    catalog,
                    45.0,
                )
                raise AssertionError("custom age-generation prompt was accepted")
            except ValueError as exc:
                assert "fixed safety prompt" in str(exc)
            try:
                generative._run_qwen_edit(  # noqa: SLF001
                    source,
                    root / "invalid-age.png",
                    "age-progress",
                    {"targetAgeBucket": "unknown"},
                    root,
                    catalog,
                    45.0,
                )
                raise AssertionError("invalid target age range was accepted")
            except ValueError as exc:
                assert "target age range" in str(exc)
    finally:
        generative.total_system_memory_bytes = original_memory
        generative.verify_runtime = original_runtime
        generative.verify_heavy_models = original_models
        generative.subprocess.run = original_run


def _fake_local_edit(mode, source, target, params, *, root=None, timeout=None):
    source_path = Path(source)
    target_path = Path(target)
    with Image.open(source_path) as opened:
        image = opened.convert("RGB")
        if mode == "upscale":
            scale = int(params.get("scale", 2))
            image = image.resize((image.width * scale, image.height * scale))
        image.save(target_path, format="PNG")
    source_sha = generative.hash_file(source_path)
    output_sha = generative.hash_file(target_path)
    provenance = {
        "schemaVersion": 1,
        "aiGenerated": True,
        "offlineInference": True,
        "catalogVersion": generative.CATALOG_VERSION,
        "catalogSha256": generative.CATALOG_SHA256,
        "mode": mode,
        "tier": "light",
        "sourceSha256": source_sha,
        "outputSha256": output_sha,
        "model": {"id": "fixture", "revision": "fixture", "license": "Apache-2.0"},
        "runtime": {"id": "fixture", "revision": "fixture", "license": "MIT"},
        "parameters": {"scale": int(params.get("scale", 2))},
    }
    return {
        "mode": mode,
        "tier": "light",
        "outputPath": str(target_path),
        "outputSha256": output_sha,
        "sourceSha256": source_sha,
        "width": image.width,
        "height": image.height,
        "durationSeconds": 0.001,
        "offlineInference": True,
        "aiGenerated": True,
        "provenance": provenance,
    }


def test_preview_confirmation_history_restart_and_tamper_contract() -> None:
    original_runner = api_server_module.run_photo_generative_edit
    api_server_module.run_photo_generative_edit = _fake_local_edit
    try:
        with tempfile.TemporaryDirectory() as tmp:
            api = _api(tmp)
            source = Path(tmp) / "source.jpg"
            Image.new("RGB", (48, 32), (70, 110, 150)).save(source, quality=95)
            imported = api.import_photos(
                {"sourcePaths": [str(source)], "storageMode": "referenced", "sourceLabel": "Fixture"}
            )
            asset = api.project.db.photo_asset_by_path(imported["importedPaths"][0])
            assert asset
            original_bytes = source.read_bytes()
            api.save_photo_edit_stack(
                {
                    "assetId": asset["assetId"],
                    "operations": [{"kind": "image_crop_rotate", "rotateDegrees": 90}],
                }
            )
            before = deepcopy(api.project.db.photo_edit_stack_by_asset(asset_id=asset["assetId"]))
            preview = api.render_photo_generative_preview(
                {"assetId": asset["assetId"], "mode": "upscale", "scale": 2}
            )
            assert (preview["width"], preview["height"]) == (64, 96)
            assert preview["sourceChanged"] is False
            assert source.read_bytes() == original_bytes
            assert api.project.db.photo_edit_stack_by_asset(asset_id=asset["assetId"]) == before
            try:
                api.apply_photo_generative_edit(
                    {"previewId": preview["previewId"], "confirm": False, "idempotencyKey": "apply-1"}
                )
                raise AssertionError("apply bypassed confirmation")
            except ValueError:
                pass
            applied = api.apply_photo_generative_edit(
                {
                    "previewId": preview["previewId"],
                    "assetId": asset["assetId"],
                    "confirm": True,
                    "idempotencyKey": "apply-1",
                }
            )
            replay = api.apply_photo_generative_edit(
                {"previewId": preview["previewId"], "confirm": True, "idempotencyKey": "apply-1"}
            )
            assert applied["applied"] is True and applied["versionCreated"] is True
            assert replay["idempotentReplay"] is True
            assert source.read_bytes() == original_bytes
            generated = applied["stack"]["operations"][0]
            assert generated["kind"] == "local_generative_edit"
            assert generated["aiGenerated"] is True
            assert generated["provenance"]["offlineInference"] is True
            versions = api.list_photo_edit_stack_versions({"assetId": asset["assetId"]})["versions"]
            assert len(versions) == 1 and versions[0]["label"] == "Before AI Upscale"

            client_tampered = deepcopy(generated)
            client_tampered["provenance"]["model"]["id"] = "client-forgery"
            stack = api.save_photo_edit_stack(
                {
                    "assetId": asset["assetId"],
                    "operations": [
                        client_tampered,
                        {"kind": "image_crop_rotate", "adjustments": {"contrast": 5}},
                    ],
                }
            )
            assert stack["operations"][0]["provenance"]["model"]["id"] == "fixture"
            try:
                api.save_photo_edit_stack(
                    {
                        "assetId": asset["assetId"],
                        "operations": [{"kind": "image_crop_rotate", "rotateDegrees": 180}],
                    }
                )
                raise AssertionError("generic save silently dropped a protected generated base")
            except ValueError as exc:
                assert "Revert" in str(exc)
            generated_version = api.create_photo_edit_stack_version(
                {"assetId": asset["assetId"], "label": "Generated base"}
            )

            reopened = _api(tmp)
            reopened_stack = reopened.project.db.photo_edit_stack_by_asset(asset_id=asset["assetId"])
            assert reopened_stack
            rendered = Path(tmp) / "restart-render.png"
            dimensions = reopened._photo_edit_stack_render_image_operations(  # noqa: SLF001
                source,
                rendered,
                reopened_stack["operations"],
                render_format="png",
                quality=100,
                max_dimension=0,
            )
            assert dimensions == (64, 96) and rendered.is_file()
            restored = reopened.restore_photo_edit_stack_version(
                {"assetId": asset["assetId"], "versionId": generated_version["versionId"]}
            )
            assert restored["stack"]["operations"][0]["kind"] == "local_generative_edit"

            forged = deepcopy(generated)
            forged["artifactPath"] = str(Path(tmp) / "forged.png")
            forged["artifactSha256"] = "0" * 64
            try:
                reopened.save_photo_edit_stack({"assetId": asset["assetId"], "operations": [forged]})
                raise AssertionError("generic edit-stack save accepted a forged generated artifact")
            except generative.PhotoGenerativeIntegrityError:
                pass

            stale_preview = api.render_photo_generative_preview(
                {"assetId": asset["assetId"], "mode": "upscale", "scale": 2}
            )
            photo_operations = [
                deepcopy(reopened_stack["operations"][0]),
                {"kind": "image_crop_rotate", "rotateDegrees": 180},
            ]
            changed_stack = api.save_photo_edit_stack(
                {
                    "assetId": asset["assetId"],
                    "operations": photo_operations,
                }
            )
            assert changed_stack["operations"] == photo_operations
            try:
                api.apply_photo_generative_edit(
                    {
                        "previewId": stale_preview["previewId"],
                        "confirm": True,
                        "idempotencyKey": "stale-stack",
                    }
                )
                raise AssertionError("stale preview overwrote a newer edit stack")
            except ValueError as exc:
                assert "changed after this preview" in str(exc)
            discard_path = Path(stale_preview["generativePreviewPath"])
            discarded = api.discard_photo_generative_preview(
                {"previewId": stale_preview["previewId"], "assetId": asset["assetId"]}
            )
            assert discarded["discarded"] is True and not discard_path.exists()

            stale_source_preview = api.render_photo_generative_preview(
                {"assetId": asset["assetId"], "mode": "upscale", "scale": 2}
            )
            source.write_bytes(original_bytes + b"changed-after-preview")
            try:
                api.apply_photo_generative_edit(
                    {
                        "previewId": stale_source_preview["previewId"],
                        "confirm": True,
                        "idempotencyKey": "stale-source",
                    }
                )
                raise AssertionError("stale preview overwrote a changed original")
            except ValueError as exc:
                assert "source changed after this preview" in str(exc)
            finally:
                source.write_bytes(original_bytes)
            source_discarded = api.discard_photo_generative_preview(
                {"previewId": stale_source_preview["previewId"], "assetId": asset["assetId"]}
            )
            assert source_discarded["discarded"] is True

            artifact = Path(generated["artifactPath"])
            artifact.write_bytes(artifact.read_bytes() + b"tamper")
            generative.clear_verification_cache()
            try:
                reopened._photo_edit_stack_render_image_operations(  # noqa: SLF001
                    source,
                    Path(tmp) / "tampered-render.png",
                    reopened_stack["operations"],
                    render_format="png",
                    quality=100,
                    max_dimension=0,
                )
                raise AssertionError("tampered generated artifact rendered")
            except generative.PhotoGenerativeIntegrityError:
                pass
    finally:
        api_server_module.run_photo_generative_edit = original_runner


def test_real_light_models_when_configured() -> None:
    root_value = str(os.environ.get("VINTRACE_GENERATIVE_TEST_ROOT", "") or "").strip()
    if not root_value:
        print("skipped real generative inference; VINTRACE_GENERATIVE_TEST_ROOT is not set")
        return
    root = Path(root_value).expanduser().resolve()
    status = generative.photo_generative_status(root)
    assert status["light"]["ready"] is True, status
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source.png"
        image = Image.new("RGB", (96, 64), (30, 70, 120))
        draw = ImageDraw.Draw(image)
        draw.rectangle((32, 20, 62, 44), fill=(230, 190, 70))
        image.save(source)
        source_sha = generative.hash_file(source)
        cleanup = Path(tmp) / "cleanup.png"
        upscale = Path(tmp) / "upscale.png"
        original_connect = socket.socket.connect

        def block_outbound(self, address):
            raise AssertionError(f"unexpected outbound socket: {address}")

        socket.socket.connect = block_outbound
        try:
            clean_result = generative.run_photo_generative_edit(
                "cleanup",
                source,
                cleanup,
                {"maskRects": [{"left": 33, "top": 30, "width": 32, "height": 40, "shape": "rectangle"}]},
                root=root,
            )
            upscale_result = generative.run_photo_generative_edit(
                "upscale",
                source,
                upscale,
                {"scale": 2, "tile": 128},
                root=root,
            )
        finally:
            socket.socket.connect = original_connect
        assert clean_result["offlineInference"] is True
        assert upscale_result["offlineInference"] is True
        assert (upscale_result["width"], upscale_result["height"]) == (192, 128)
        assert generative.hash_file(source) == source_sha
        with Image.open(source) as original_opened, Image.open(cleanup) as cleanup_opened:
            original = original_opened.convert("RGB")
            cleaned = cleanup_opened.convert("RGB")
            outside = Image.new("L", original.size, 255)
            outside_draw = ImageDraw.Draw(outside)
            outside_draw.rounded_rectangle((32, 19, 62, 45), radius=5, fill=0)
            difference = ImageChops.difference(original, cleaned)
            assert Image.composite(difference, Image.new("RGB", original.size), outside).getbbox() is None
            assert difference.getbbox() is not None


def main() -> None:
    test_catalog_and_hardware_gate()
    test_catalog_and_archive_tamper_are_rejected()
    test_resumable_installer_contract_with_verified_fixture()
    test_heavy_install_requires_acknowledgement_before_network()
    test_qwen_command_is_pinned_and_shell_free()
    test_qwen_runner_uses_verified_local_inputs_and_offline_environment()
    test_preview_confirmation_history_restart_and_tamper_contract()
    test_real_light_models_when_configured()
    print("all photo_generative_units tests passed")


if __name__ == "__main__":
    main()
