from __future__ import annotations

from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw


CATALOG_SHA256 = "ec8cbb1bb77b749be39a545836f0394b70efd4053b557e6e4e56442f982d1406"
AGE_IMAGE_METHOD_VERSION = "qwen-image-edit-2511-age-v1"


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update(
        {
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(registry),
            "CROSSAGE_REGISTRY_HOME": str(registry),
            "CROSSAGE_FORCE_FALLBACK": "1",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "NO_PROXY": "*",
            "no_proxy": "*",
            "HTTP_PROXY": "",
            "HTTPS_PROXY": "",
            "ALL_PROXY": "",
            "http_proxy": "",
            "https_proxy": "",
            "all_proxy": "",
        }
    )
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    wait_ready(process)
    return process


def stop_backend(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def make_fixture(path: Path) -> None:
    image = Image.new("RGB", (96, 64), (36, 72, 112))
    draw = ImageDraw.Draw(image)
    for x in range(image.width):
        color = (36 + x, 72 + x // 2, 112 + x // 3)
        draw.line((x, 0, x, image.height - 1), fill=color)
    draw.rectangle((37, 22, 58, 42), fill=(238, 61, 72))
    draw.line((0, 8, 95, 54), fill=(244, 210, 90), width=2)
    image.save(path, format="PNG")


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_GENERATIVE_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    installed_root = Path(str(os.environ.get("VINTRACE_GENERATIVE_TEST_MODEL_ROOT", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_GENERATIVE_TEST_EXECUTABLE must point to the frozen backend.")
    if not installed_root.is_dir():
        raise SystemExit("VINTRACE_GENERATIVE_TEST_MODEL_ROOT must point to a verified installed generative root.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-generative-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        registry_model_root = registry / "models" / "generative"
        registry_model_root.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(installed_root, registry_model_root, copy_function=shutil.copy2)
        runtime_executables = list(registry_model_root.rglob("realesrgan-ncnn-vulkan"))
        if os.name != "nt":
            assert len(runtime_executables) == 1, runtime_executables
            runtime_executables[0].chmod(0o600)

        source = root / "source.png"
        make_fixture(source)
        original_sha256 = hash_file(source)

        process = start_backend(executable, workspace, registry)
        try:
            installed = rpc(
                process,
                "install-light",
                "install_photo_generative_pack",
                {"tier": "light"},
            ).get("value", {})
            assert installed.get("installed") is True, installed
            assert installed.get("status", {}).get("light", {}).get("ready") is True, installed
            if os.name != "nt":
                assert os.access(runtime_executables[0], os.X_OK), runtime_executables[0]
            status = rpc(process, "status", "photo_generative_status", {}).get("value", {})
            assert status.get("catalogSha256") == CATALOG_SHA256, status
            assert Path(str(status.get("modelRoot", ""))).resolve() == registry_model_root.resolve(), status
            assert status.get("offlineInference") is True, status
            assert status.get("light", {}).get("ready") is True, status
            assert status.get("light", {}).get("cleanup", {}).get("id") == "opencv/inpainting_lama", status
            assert status.get("light", {}).get("upscale", {}).get("id") == "xinntao/Real-ESRGAN", status
            assert status.get("modes", {}).get("cleanup") is True, status
            assert status.get("modes", {}).get("upscale") is True, status

            age_review = rpc(
                process,
                "age-review-status",
                "synthetic_age_image_review_status",
                {},
            )
            assert age_review.get("methodVersion") == AGE_IMAGE_METHOD_VERSION, age_review
            assert age_review.get("reviewOnly") is True, age_review
            assert age_review.get("autoEnrollment") is False, age_review
            assert age_review.get("counts", {}).get("staged") == 0, age_review
            assert age_review.get("artifacts") == [], age_review

            imported = rpc(
                process,
                "import",
                "import_photos",
                {"sourcePaths": [str(source)], "storageMode": "referenced", "sourceLabel": "Frozen generative acceptance"},
            ).get("value", {})
            assert imported.get("importedCount") == 1, imported
            assets = rpc(process, "assets", "list_photo_assets", {"limit": 10})
            items = assets.get("items", [])
            assert len(items) == 1, assets
            asset = items[0]
            asset_id = str(asset["assetId"])

            ordinary_stack = rpc(
                process,
                "ordinary-edit",
                "save_photo_edit_stack",
                {"assetId": asset_id, "operations": [{"kind": "image_crop_rotate", "rotateDegrees": 90}]},
            ).get("value", {})
            assert ordinary_stack.get("operations"), ordinary_stack

            cleanup = rpc(
                process,
                "cleanup-preview",
                "render_photo_generative_preview",
                {
                    "assetId": asset_id,
                    "mode": "cleanup",
                    "maskRects": [{"left": 35, "top": 25, "width": 30, "height": 45, "shape": "rectangle"}],
                },
            ).get("value", {})
            assert cleanup.get("requiresConfirmation") is True, cleanup
            assert cleanup.get("offlineInference") is True and cleanup.get("aiGenerated") is True, cleanup
            assert cleanup.get("sourceChanged") is False, cleanup
            assert (cleanup.get("width"), cleanup.get("height")) == (64, 96), cleanup
            assert cleanup.get("provenance", {}).get("catalogSha256") == CATALOG_SHA256, cleanup
            assert cleanup.get("provenance", {}).get("model", {}).get("id") == "opencv/inpainting_lama", cleanup
            assert hash_file(source) == original_sha256

            applied = rpc(
                process,
                "cleanup-apply",
                "apply_photo_generative_edit",
                {
                    "previewId": cleanup["previewId"],
                    "assetId": asset_id,
                    "confirm": True,
                    "idempotencyKey": "frozen-generative-cleanup-v1",
                },
            ).get("value", {})
            assert applied.get("applied") is True and applied.get("versionCreated") is True, applied
            operation = applied.get("stack", {}).get("operations", [{}])[0]
            assert operation.get("kind") == "local_generative_edit", operation
            assert operation.get("schemaVersion") == 2, operation
            assert operation.get("offlineInference") is True and operation.get("aiGenerated") is True, operation
            assert operation.get("modelOutputSha256") == cleanup.get("generativePreviewSha256"), operation
            assert operation.get("artifactSha256") != operation.get("modelOutputSha256"), operation
            credentials = operation.get("contentCredentials", {})
            assert credentials.get("present") is True and credentials.get("embedded") is True, credentials
            assert credentials.get("cryptographicallyValid") is True and credentials.get("locallyTrusted") is True, credentials
            assert credentials.get("globallyTrusted") is False and credentials.get("topLevelAiEdit") is True, credentials
            actions = credentials.get("actions", [])
            assert [row.get("action") for row in actions] == ["c2pa.opened", "c2pa.edited", "c2pa.edited"], actions
            assert not actions[1].get("digitalSourceType"), actions
            assert str(actions[2].get("digitalSourceType", "")).endswith(
                "compositeWithTrainedAlgorithmicMedia"
            ), actions
            artifact = Path(str(operation.get("artifactPath", ""))).resolve()
            artifact.relative_to((workspace / "photo-generative-artifacts").resolve())
            assert artifact.is_file() and hash_file(artifact) == operation.get("artifactSha256"), operation
            assert hash_file(source) == original_sha256

            replay = rpc(
                process,
                "cleanup-replay",
                "apply_photo_generative_edit",
                {
                    "previewId": cleanup["previewId"],
                    "confirm": True,
                    "idempotencyKey": "frozen-generative-cleanup-v1",
                },
            ).get("value", {})
            assert replay.get("idempotentReplay") is True, replay
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            persisted = rpc(reopened, "stack", "get_photo_edit_stack", {"assetId": asset_id}).get("value", {})
            assert persisted.get("hasStack") is True, persisted
            stack = persisted.get("stack", {})
            operation = stack.get("operations", [{}])[0]
            assert operation.get("kind") == "local_generative_edit", operation
            assert hash_file(Path(operation["artifactPath"])) == operation.get("artifactSha256"), operation
            rendered = Path(str(stack.get("renderedPreviewPath", "")))
            assert rendered.is_file(), stack
            with Image.open(rendered) as image:
                assert image.size == (64, 96), image.size

            versions = rpc(
                reopened,
                "versions",
                "list_photo_edit_stack_versions",
                {"assetId": asset_id},
            ).get("value", {})
            assert len(versions.get("versions", [])) == 1, versions
            assert versions["versions"][0].get("label") == "Before AI Clean Up", versions

            upscale = rpc(
                reopened,
                "upscale-preview",
                "render_photo_generative_preview",
                {"assetId": asset_id, "mode": "upscale", "scale": 2, "tile": 128},
            ).get("value", {})
            assert (upscale.get("width"), upscale.get("height")) == (128, 192), upscale
            assert upscale.get("offlineInference") is True and upscale.get("sourceChanged") is False, upscale
            assert upscale.get("provenance", {}).get("runtime", {}).get("id") == "xinntao/Real-ESRGAN", upscale
            discarded = rpc(
                reopened,
                "upscale-discard",
                "discard_photo_generative_preview",
                {"previewId": upscale["previewId"], "assetId": asset_id},
            ).get("value", {})
            assert discarded.get("discarded") is True and discarded.get("removed") is True, discarded
            assert hash_file(source) == original_sha256
        finally:
            stop_backend(reopened)

        print(
            json.dumps(
                {
                    "frozen": True,
                    "catalogSha256": CATALOG_SHA256,
                    "cleanupInference": True,
                    "upscaleInference": True,
                    "confirmationApplied": True,
                    "idempotentReplay": True,
                    "editHistoryPersisted": True,
                    "restartRender": True,
                    "originalUnchanged": True,
                    "offlineInference": True,
                    "contentCredentialsEmbedded": True,
                    "contentCredentialsVerified": True,
                    "syntheticAgeImageReviewContract": True,
                    "installerPermissionRepair": True,
                    "globallyTrusted": False,
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
