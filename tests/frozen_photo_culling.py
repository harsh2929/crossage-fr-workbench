from __future__ import annotations

from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rpc_row(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") == request_id and "ok" in row:
            return row


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    row = rpc_row(process, request_id, command, params)
    if not row.get("ok"):
        raise AssertionError(row)
    result = row.get("result", {})
    return result if isinstance(result, dict) else {}


def rpc_error(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> str:
    row = rpc_row(process, request_id, command, params)
    if row.get("ok"):
        raise AssertionError(f"Expected {command} to fail: {row}")
    return json.dumps(row.get("error", row), ensure_ascii=False).casefold()


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
    env.update({
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
    })
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


def checker_image(size: int = 256) -> Image.Image:
    image = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(image)
    for y in range(0, size, 16):
        for x in range(0, size, 16):
            if (x // 16 + y // 16) % 2:
                draw.rectangle((x, y, x + 15, y + 15), fill=(18, 28, 38))
    draw.ellipse((76, 58, 180, 192), outline=(210, 55, 68), width=6)
    return image


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_CULLING_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_CULLING_TEST_EXECUTABLE must point to the frozen backend.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-photo-culling-") as tmp_value:
        root = Path(tmp_value)
        workspace = root / "workspace"
        registry = root / "registry"
        media = root / "burst-media"
        media.mkdir()
        sharp = checker_image()
        variants = [
            sharp,
            sharp.filter(ImageFilter.GaussianBlur(radius=6.0)),
            sharp.filter(ImageFilter.GaussianBlur(radius=2.5)),
        ]
        paths: list[Path] = []
        original_payloads: dict[str, bytes] = {}
        for index, image in enumerate(variants, start=1):
            path = media / f"Frozen Culling Burst {index:04d}.png"
            image.save(path, format="PNG", optimize=False)
            paths.append(path)
            original_payloads[str(path)] = path.read_bytes()

        process = start_backend(executable, workspace, registry)
        try:
            status = rpc(process, "status", "photo_culling_status", {}).get("value", {})
            assert status.get("available") is True and status.get("offline") is True, status
            assert status.get("version") == "vintrace-assisted-culling-v1", status
            assert status.get("recommendationOnly") is True and status.get("automaticDeletion") is False, status
            assert status.get("eyes", {}).get("available") is True, status
            assert status.get("eyes", {}).get("heuristic") is True, status
            assert status.get("fiqa", {}).get("available") is True, status
            assert status.get("fiqa", {}).get("modelId") == "opencv-ediffiqa-tiny-jun2024", status
            assert status.get("fiqa", {}).get("license") == "CC-BY-4.0", status
            assert str(media) not in json.dumps(status) and "path" not in json.dumps(status).casefold(), status

            imported = rpc(
                process,
                "import",
                "import_photos",
                {
                    "sourcePaths": [str(path) for path in paths],
                    "storageMode": "referenced",
                    "sourceLabel": "Frozen assisted-culling acceptance",
                },
            ).get("value", {})
            assert imported.get("importedCount") == 3, imported
            stacks = rpc(
                process,
                "stacks",
                "list_photo_burst_stacks",
                {"includeItems": True},
            ).get("value", {}).get("stacks", [])
            assert len(stacks) == 1 and stacks[0].get("keeperCount") == 0, stacks
            stack = stacks[0]
            result = rpc(
                process,
                "analyze",
                "analyze_photo_burst_culling",
                {"stackId": stack["stackId"]},
            ).get("value", {}).get("result", {})
            assert result.get("faceSignalsAllowed") is False, result
            assert result.get("recommendationOnly") is True and result.get("automaticDeletion") is False, result
            assert result.get("recommendedAssetId") == stack["items"][0]["assetId"], result
            assert len(result.get("frames", [])) == 3, result
            assert all(frame.get("reasons") for frame in result["frames"]), result
            assert all(
                any(reason.get("code") == "face-signals-consent-required" for reason in frame["reasons"])
                for frame in result["frames"]
            ), result
            result_json = json.dumps(result, ensure_ascii=False)
            assert str(media) not in result_json and "sourcePath" not in result_json, result
            assert all(path.read_bytes() == original_payloads[str(path)] for path in paths)
            analyzed_stack = rpc(
                process,
                "stacks-after-analysis",
                "list_photo_burst_stacks",
                {"includeItems": True},
            ).get("value", {}).get("stacks", [])[0]
            assert analyzed_stack.get("keeperCount") == 0, analyzed_stack
            analysis_id = str(result["analysisId"])
            result_sha256 = str(result["resultSha256"])
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            cached_stack = rpc(
                reopened,
                "restart-stack",
                "list_photo_burst_stacks",
                {"includeItems": True},
            ).get("value", {}).get("stacks", [])[0]
            assert cached_stack.get("culling", {}).get("analysisId") == analysis_id, cached_stack
            error = rpc_error(
                reopened,
                "unconfirmed",
                "apply_photo_culling_recommendation",
                {
                    "stackId": stack["stackId"],
                    "analysisId": analysis_id,
                    "confirm": False,
                    "idempotencyKey": "frozen-culling-apply-v1",
                },
            )
            assert "explicit confirmation" in error, error
            applied = rpc(
                reopened,
                "apply",
                "apply_photo_culling_recommendation",
                {
                    "stackId": stack["stackId"],
                    "analysisId": analysis_id,
                    "resultSha256": result_sha256,
                    "confirm": True,
                    "idempotencyKey": "frozen-culling-apply-v1",
                },
            ).get("value", {})
            assert applied.get("idempotentReplay") is False and applied.get("automaticDeletion") is False, applied
            selected_stack = applied.get("selection", {}).get("stack", {})
            keepers = [item for item in selected_stack.get("items", []) if item.get("keeper")]
            assert len(keepers) == 1 and keepers[0].get("assetId") == result.get("recommendedAssetId"), selected_stack
            replay = rpc(
                reopened,
                "replay",
                "apply_photo_culling_recommendation",
                {
                    "stackId": stack["stackId"],
                    "analysisId": analysis_id,
                    "confirm": True,
                    "idempotencyKey": "frozen-culling-apply-v1",
                },
            ).get("value", {})
            assert replay.get("idempotentReplay") is True, replay

            manual_path = str(cached_stack["items"][2]["sourcePath"])
            manual = rpc(
                reopened,
                "manual-override",
                "set_photo_burst_selection",
                {"stackId": stack["stackId"], "keepSourcePaths": [manual_path]},
            ).get("value", {})
            manual_keepers = [item for item in manual.get("stack", {}).get("items", []) if item.get("keeper")]
            assert len(manual_keepers) == 1 and manual_keepers[0].get("sourcePath") == manual_path, manual
            assert all(path.read_bytes() == original_payloads[str(path)] for path in paths)

            assets = rpc(reopened, "assets", "list_photo_assets", {"limit": 10}).get("items", [])
            assert len(assets) == 3, assets
            assert all(not asset.get("hidden") and not asset.get("deletedAt") for asset in assets), assets

            changed_path = paths[1]
            changed_path.write_bytes(original_payloads[str(changed_path)] + b"changed")
            stale_stack = rpc(
                reopened,
                "stale-stack",
                "list_photo_burst_stacks",
                {"includeItems": True},
            ).get("value", {}).get("stacks", [])[0]
            assert "culling" not in stale_stack, stale_stack
            stale_error = rpc_error(
                reopened,
                "stale-apply",
                "apply_photo_culling_recommendation",
                {
                    "stackId": stack["stackId"],
                    "analysisId": analysis_id,
                    "confirm": True,
                    "idempotencyKey": "frozen-culling-stale-v1",
                },
            )
            assert "changed after analysis" in stale_error, stale_error
            changed_path.write_bytes(original_payloads[str(changed_path)])
            assert all(sha256_file(path) == hashlib.sha256(original_payloads[str(path)]).hexdigest() for path in paths)
        finally:
            stop_backend(reopened)

        print(json.dumps({
            "frozen": True,
            "runtimeScorer": True,
            "haarResources": True,
            "fiqaPackVisible": True,
            "pathFreeResult": True,
            "restartCache": True,
            "explicitConfirmation": True,
            "idempotentReplay": True,
            "manualOverride": True,
            "staleSourceRejected": True,
            "originalsUnchanged": True,
            "noDeletionOrVisibilityChange": True,
            "offline": True,
        }, sort_keys=True))


if __name__ == "__main__":
    main()
