from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
import hashlib
import json
import os
import tempfile
import zipfile

import crossage_fr.api_server as api_server_module
import crossage_fr.photo_vlm as photo_vlm
from crossage_fr.api_server import DesktopApi


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def fake_catalog(base: Path) -> dict:
    runtime_bytes = b"#!/bin/sh\nexit 0\n"
    runtime_archive = base / "runtime.zip"
    with zipfile.ZipFile(runtime_archive, "w") as archive:
        server = zipfile.ZipInfo("llama-server")
        server.external_attr = 0o755 << 16
        archive.writestr(server, runtime_bytes)
        archive.writestr("LICENSE", "MIT test fixture\n")
    models: dict[str, dict] = {}
    for tier, label in (("quality", "Quality fixture"), ("low-memory", "Low-memory fixture")):
        language = f"{tier}-model".encode("ascii")
        projector = f"{tier}-projector".encode("ascii")
        language_path = base / f"{tier}-model.gguf"
        projector_path = base / f"{tier}-projector.gguf"
        language_path.write_bytes(language)
        projector_path.write_bytes(projector)
        models[tier] = {
            "tier": tier,
            "label": label,
            "modelId": f"fixture/{tier}",
            "revision": f"{tier}-revision",
            "upstreamModel": f"fixture/{tier}-upstream",
            "upstreamRevision": f"{tier}-upstream-revision",
            "license": "Apache-2.0",
            "source": "https://example.invalid/model",
            "minimumMemoryBytes": 4 * 1024**3 if tier == "low-memory" else 8 * 1024**3,
            "recommendedMemoryBytes": 8 * 1024**3 if tier == "low-memory" else 16 * 1024**3,
            "maxImageDimension": 64,
            "artifacts": [
                {
                    "role": "language-model",
                    "filename": language_path.name,
                    "url": language_path.as_uri(),
                    "sizeBytes": len(language),
                    "sha256": sha256_bytes(language),
                },
                {
                    "role": "vision-projector",
                    "filename": projector_path.name,
                    "url": projector_path.as_uri(),
                    "sizeBytes": len(projector),
                    "sha256": sha256_bytes(projector),
                },
            ],
        }
    archive_bytes = runtime_archive.read_bytes()
    return {
        "schemaVersion": 1,
        "catalogId": "fixture",
        "version": "fixture-v1",
        "promptVersion": "fixture-prompt",
        "offlineInference": True,
        "runtime": {
            "id": "llama.cpp",
            "tag": "fixture",
            "revision": "fixture-runtime-revision",
            "license": "MIT",
            "platforms": {
                "darwin-arm64": {
                    "archive": runtime_archive.name,
                    "url": runtime_archive.as_uri(),
                    "sizeBytes": len(archive_bytes),
                    "sha256": sha256_bytes(archive_bytes),
                    "format": "zip",
                    "executable": "llama-server",
                }
            },
        },
        "models": models,
    }


def test_catalog_and_license_contract() -> None:
    catalog = photo_vlm.load_catalog()
    assert catalog["offlineInference"] is True
    assert set(catalog["models"]) == {"quality", "low-memory"}
    assert catalog["models"]["quality"]["modelId"] == "Qwen/Qwen3-VL-4B-Instruct-GGUF"
    assert catalog["models"]["quality"]["license"] == "Apache-2.0"
    assert catalog["models"]["low-memory"]["upstreamModel"] == "HuggingFaceTB/SmolVLM2-2.2B-Instruct"
    assert catalog["models"]["low-memory"]["license"] == "Apache-2.0"
    assert catalog["runtime"]["tag"] == "b9969"
    assert catalog["runtime"]["license"] == "MIT"
    catalog_file = photo_vlm.catalog_path()
    assert hashlib.sha256(catalog_file.read_bytes()).hexdigest() == photo_vlm.CATALOG_SHA256
    license_root = catalog_file.parent
    assert "END OF TERMS AND CONDITIONS" in (license_root / "LICENSE-APACHE-2.0.txt").read_text(encoding="utf-8")
    assert "MIT License" in (license_root / "LICENSE-LLAMA-CPP-MIT.txt").read_text(encoding="utf-8")
    benchmark = json.loads((Path(__file__).resolve().parents[1] / "benchmarks" / "results" / "photo-vlm-benchmark-20260712.json").read_text(encoding="utf-8"))
    assert benchmark["passed"] is True
    assert benchmark["network"]["outboundAttempts"] == []
    assert {item["tier"] for item in benchmark["results"]} == {"quality", "low-memory"}
    assert all(item["deterministic"] and item["boardingPassRecovered"] for item in benchmark["results"])
    module_source = Path(photo_vlm.__file__).read_text(encoding="utf-8")
    assert '"--offline"' in module_source
    assert '"--api-key"' in module_source
    assert '"--no-ui-mcp-proxy"' in module_source


def test_installer_integrity_and_capability_routing() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        catalog = fake_catalog(base)
        root = base / "installed"
        events: list[dict] = []
        with patch.object(photo_vlm, "load_catalog", return_value=catalog), patch.object(photo_vlm, "platform_key", return_value="darwin-arm64"):
            installed = photo_vlm.install_photo_vlm("all", root, on_progress=events.append)
            assert installed["installed"] is True
            assert installed["offlineInference"] is True
            assert photo_vlm.verify_runtime(root, catalog)["verified"] is True
            assert photo_vlm.verify_model_pack(root, "quality", catalog)["verified"] is True
            assert photo_vlm.verify_model_pack(root, "low-memory", catalog)["verified"] is True
            assert events[-1]["phase"] == "complete"

            status = photo_vlm.photo_vlm_status(root, total_memory_bytes=16 * 1024**3)
            assert status["route"]["tier"] == "quality", status
            low_status = photo_vlm.photo_vlm_status(root, preference="quality", total_memory_bytes=6 * 1024**3)
            assert low_status["route"]["tier"] == "low-memory", low_status
            power_status = photo_vlm.photo_vlm_status(root, power_mode="low", total_memory_bytes=32 * 1024**3)
            assert power_status["route"]["tier"] == "low-memory", power_status

            quality_path = root / "models" / "quality" / catalog["models"]["quality"]["artifacts"][0]["filename"]
            quality_path.write_bytes(b"tampered")
            photo_vlm.clear_photo_vlm_verification_cache()
            tampered = photo_vlm.photo_vlm_status(root, preference="quality", total_memory_bytes=32 * 1024**3)
            quality = next(item for item in tampered["packs"] if item["tier"] == "quality")
            assert quality["modelReady"] is False
            assert "mismatch" in quality["error"].lower()

            extra = root / "runtime" / "darwin-arm64" / "unrecorded-library.dylib"
            extra.write_bytes(b"unexpected")
            photo_vlm.clear_photo_vlm_verification_cache()
            runtime, error = photo_vlm._status_error(lambda: photo_vlm.verify_runtime(root, catalog))
            assert not runtime
            assert "file set" in error.lower()


def test_output_validation_and_packaged_override_isolation() -> None:
    caption, tags = photo_vlm._parse_generated_payload(
        "```json\n{\"caption\":\"A sailboat crosses a calm harbor.\",\"tags\":[\"Sailboat\",\"harbor\",\"race\",\"sailboat\",\"https://bad.invalid\"]}\n```"
    )
    assert caption == "A sailboat crosses a calm harbor."
    assert tags == ["sailboat", "harbor"]
    with tempfile.TemporaryDirectory() as tmp:
        configured = Path(tmp) / "override"
        previous = os.environ.get("VINTRACE_VLM_ROOT")
        os.environ["VINTRACE_VLM_ROOT"] = str(configured)
        try:
            with patch.object(photo_vlm, "_is_packaged", return_value=True):
                assert photo_vlm.default_vlm_root() != configured.resolve()
        finally:
            if previous is None:
                os.environ.pop("VINTRACE_VLM_ROOT", None)
            else:
                os.environ["VINTRACE_VLM_ROOT"] = previous


def test_schema_constrained_text_chat_reuses_verified_runtime() -> None:
    catalog = photo_vlm.load_catalog()
    runtime_platform = dict(catalog["runtime"]["platforms"]["darwin-arm64"])
    runtime = {
        "id": catalog["runtime"]["id"],
        "tag": catalog["runtime"]["tag"],
        "revision": catalog["runtime"]["revision"],
        "license": catalog["runtime"]["license"],
        "platform": "darwin-arm64",
        "archiveSha256": runtime_platform["sha256"],
    }
    route = photo_vlm.PhotoVlmRoute(
        requested="quality",
        tier="quality",
        reason="unit fixture",
        total_memory_bytes=16 * 1024**3,
        model=catalog["models"]["quality"],
        runtime=runtime,
    )
    captured: dict = {}

    def complete(_route, _root, payload, *, timeout=photo_vlm.INFERENCE_TIMEOUT_SECONDS):
        captured.update(payload)
        assert timeout == photo_vlm.INFERENCE_TIMEOUT_SECONDS
        return {
            "choices": [{"message": {"content": "<think>private</think>{\"answer\":\"grounded\"}"}}],
            "usage": {"total_tokens": 19},
        }

    schema = {
        "type": "object",
        "properties": {"answer": {"type": "string"}},
        "required": ["answer"],
        "additionalProperties": False,
    }
    with patch.object(photo_vlm, "load_catalog", return_value=catalog), patch.object(
        photo_vlm, "select_photo_vlm_route", return_value=route
    ), patch.object(photo_vlm, "_chat_completion", side_effect=complete):
        result = photo_vlm.run_photo_vlm_chat(
            [
                {"role": "system", "content": "Return local JSON."},
                {"role": "user", "content": "Plan a library query."},
            ],
            schema,
            schema_name="vintrace_test_plan",
            preference="quality",
            max_tokens=128,
        )
    assert result["result"] == {"answer": "grounded"}
    assert result["route"]["tier"] == "quality"
    assert result["model"]["offline"] is True
    assert result["usage"]["total_tokens"] == 19
    assert captured["temperature"] == 0
    assert captured["response_format"]["json_schema"]["strict"] is True
    assert captured["response_format"]["json_schema"]["schema"] == schema
    assert "image_url" not in json.dumps(captured)


def test_caption_tags_persist_search_and_do_not_replace_user_caption() -> None:
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        registry = base / "registry"
        previous_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
        os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
        try:
            workspace = base / "workspace"
            source = base / "harbor.png"
            Image.new("RGB", (96, 64), (20, 90, 150)).save(source)
            api = DesktopApi(workspace)
            imported = api.import_photos({"sourcePaths": [str(source)], "storageMode": "referenced", "sourceLabel": "VLM fixture"})
            source_path = imported["importedPaths"][0]
            asset = api.project.db.photo_asset_by_path(source_path)
            assert asset
            api.project.db.update_photo_asset_metadata(asset_id=asset["assetId"], caption="My manual caption")
            api.save_photo_library_settings(
                {
                    "localSettings": {
                        "localIntelligenceEnabled": True,
                        "noNetworkIntelligence": True,
                        "backgroundIndexingPaused": False,
                        "indexingPowerMode": "balanced",
                        "visionModelTier": "quality",
                    }
                }
            )
            status = {
                "route": {"available": True, "tier": "quality", "modelId": "Qwen/Qwen3-VL-4B-Instruct-GGUF", "reason": "fixture"},
                "packs": [],
                "runtime": {"available": True},
            }
            inference = {
                "ok": True,
                "status": "indexed",
                "source": "vlm-qwen3-vl",
                "caption": "A white sailboat crosses a calm blue harbor at sunset.",
                "tags": ["sailboat", "harbor", "sunset", "water"],
                "imageWidth": 96,
                "imageHeight": 64,
                "elapsedMs": 42.5,
                "route": {"requested": "quality", "tier": "quality", "reason": "fixture", "totalMemoryBytes": 16 * 1024**3},
                "model": {
                    "modelId": "Qwen/Qwen3-VL-4B-Instruct-GGUF",
                    "modelRevision": "1cd86afb9a95c410a6038ab3b40d8b578c892266",
                    "modelLicense": "Apache-2.0",
                    "runtime": {"id": "llama.cpp", "tag": "b9969", "revision": "76f2798059575a96a12e4d34342165a4b6a6a312"},
                    "offline": True,
                },
            }
            with patch.object(api_server_module, "portable_photo_vlm_status", return_value=status), patch.object(api_server_module, "run_photo_vlm", return_value=inference):
                result = api.index_photo_objects({"sourcePaths": [source_path], "force": True, "modelTier": "quality"})
            assert result["progress"]["modelUpdated"] == 1, result
            assert result["progress"]["captionUpdated"] == 1, result
            persisted = api.project.db.photo_asset_by_path(source_path)
            assert persisted
            local_vision = persisted["metadata"]["localVision"]
            assert local_vision["caption"].startswith("A white sailboat")
            assert local_vision["model"]["modelLicense"] == "Apache-2.0"
            tags = api.project.db.photo_object_tags_for_asset(asset["assetId"])
            assert {item["label"] for item in tags} == {"sailboat", "harbor", "sunset", "water"}
            assert {item["source"] for item in tags} == {"vlm-qwen3-vl"}
            metadata = api.project.db.photo_asset_metadata_by_id(asset["assetId"])
            assert metadata["caption"] == "My manual caption"
            assert api.search_photo_library({"query": "sailboat"})["total"] == 1
            assert api.search_photo_library({"query": "calm blue harbor"})["total"] == 1

            reopened = DesktopApi(workspace)
            assert reopened.search_photo_library({"query": "sailboat sunset"})["total"] == 1
            reopened_asset = reopened.project.db.photo_asset_by_path(source_path)
            assert reopened_asset["metadata"]["localVision"]["model"]["offline"] is True
        finally:
            if previous_registry is None:
                os.environ.pop("VINTRACE_REGISTRY_HOME", None)
            else:
                os.environ["VINTRACE_REGISTRY_HOME"] = previous_registry


def main() -> None:
    test_catalog_and_license_contract()
    test_installer_integrity_and_capability_routing()
    test_output_validation_and_packaged_override_isolation()
    test_schema_constrained_text_chat_reuses_verified_runtime()
    test_caption_tags_persist_search_and_do_not_replace_user_caption()
    print("photo VLM unit tests ok")


if __name__ == "__main__":
    main()
