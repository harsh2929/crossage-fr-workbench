from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import tempfile
from time import perf_counter
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from crossage_fr.api_server import DesktopApi
from crossage_fr.embed.fiqa import FIQA_LICENSE, FIQA_MODEL_ID, FIQA_MODEL_SHA256
from crossage_fr.photo_culling import PHOTO_CULLING_VERSION


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "benchmarks" / "public-data" / "prepared" / "cplfw-40x3" / "0001-Aaron_Eckhart" / "001-Aaron_Eckhart_1.jpg"
DEFAULT_DATASET_MANIFEST = ROOT / "benchmarks" / "public-data" / "prepared" / "cplfw-40x3-manifest.json"
DEFAULT_OUTPUT = ROOT / "benchmarks" / "results" / "photo-culling-benchmark-20260713.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _motion_blur(image: Image.Image, size: int = 23) -> Image.Image:
    array = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    kernel = np.zeros((size, size), dtype=np.float32)
    kernel[size // 2, :] = np.float32(1.0 / size)
    blurred = cv2.filter2D(array, -1, kernel)
    return Image.fromarray(cv2.cvtColor(blurred, cv2.COLOR_BGR2RGB))


def prepare_burst(source: Path, destination: Path) -> list[Path]:
    with Image.open(source) as opened:
        base = opened.convert("RGB")
    blink = base.copy()
    draw = ImageDraw.Draw(blink)
    draw.line((76, 99, 104, 100), fill=(55, 35, 30), width=5)
    draw.line((120, 99, 148, 99), fill=(55, 35, 30), width=5)
    variants = [
        ("sharp-open", base),
        ("gaussian-blur", base.filter(ImageFilter.GaussianBlur(radius=3.5))),
        ("directional-motion-blur", _motion_blur(base)),
        ("eye-occlusion-heuristic", blink),
    ]
    paths: list[Path] = []
    for index, (_label, image) in enumerate(variants, start=1):
        enlarged = image.resize((896, 896), Image.Resampling.LANCZOS)
        target = destination / f"Culling Burst {index:04d}.png"
        enlarged.save(target, format="PNG", optimize=False)
        paths.append(target)
    return paths


def public_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "analysisId": result.get("analysisId"),
        "resultSha256": result.get("resultSha256"),
        "recommendedAssetId": result.get("recommendedAssetId"),
        "recommendationScore": result.get("recommendationScore"),
        "recommendationConfidence": result.get("recommendationConfidence"),
        "recommendationMargin": result.get("recommendationMargin"),
        "recommendationOnly": result.get("recommendationOnly"),
        "automaticDeletion": result.get("automaticDeletion"),
        "faceSignalsAllowed": result.get("faceSignalsAllowed"),
        "provenance": result.get("provenance"),
        "frames": [
            {
                key: frame.get(key)
                for key in (
                    "assetId",
                    "sequence",
                    "rank",
                    "recommended",
                    "score",
                    "sharpness",
                    "motionClarity",
                    "faceQuality",
                    "faceQualitySource",
                    "eyesOpen",
                    "eyesConfidence",
                    "facesDetected",
                    "reasons",
                )
            }
            for frame in result.get("frames", [])
            if isinstance(frame, dict)
        ],
    }


def frame_is_explained(frame: dict[str, Any]) -> bool:
    explained = {
        str(reason.get("signal", "") or "")
        for reason in frame.get("reasons", [])
        if isinstance(reason, dict)
    }
    expected = {"sharpness", "motionClarity"}
    if frame.get("faceQuality") is not None:
        expected.add("faceQuality")
    if frame.get("eyesOpen") is not None:
        expected.add("eyesOpen")
    if bool(frame.get("recommended")):
        expected.add("overall")
    return expected.issubset(explained)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the real offline assisted burst-culling benchmark.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--dataset-manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    parser.add_argument("--model-root", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    dataset_manifest = args.dataset_manifest.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.is_file() or not dataset_manifest.is_file():
        raise SystemExit("The prepared local CPLFW benchmark fixture and manifest are required.")

    original_socket_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def block_connect(_sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Outbound network access is forbidden during assisted-culling evaluation.")

    def block_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Outbound network access is forbidden during assisted-culling evaluation.")

    previous_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
    previous_crossage_registry = os.environ.get("CROSSAGE_REGISTRY_HOME")
    previous_force_fallback = os.environ.get("CROSSAGE_FORCE_FALLBACK")
    try:
        with tempfile.TemporaryDirectory(prefix="vintrace-photo-culling-benchmark-") as tmp_value:
            temp = Path(tmp_value)
            media = temp / "media"
            media.mkdir()
            paths = prepare_burst(source, media)
            before_hashes = {str(path): sha256_file(path) for path in paths}
            registry = temp / "registry"
            os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
            os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
            os.environ["CROSSAGE_FORCE_FALLBACK"] = "0"
            api = DesktopApi(temp / "workspace")
            if args.model_root is not None:
                api.project.config.model_root = str(args.model_root.expanduser().resolve())
            api.project.config.model_pack = "antelopev2"

            socket.socket.connect = block_connect
            socket.create_connection = block_create_connection
            imported = api.import_photos({
                "sourcePaths": [str(path) for path in paths],
                "storageMode": "referenced",
                "sourceLabel": "CPLFW transformed burst benchmark",
            })
            api._cmd_set_consent({"value": True, "source": "photo-culling-benchmark"})
            status = api.photo_culling_status({})
            stacks = api.list_photo_burst_stacks({"includeItems": True})["stacks"]
            if len(stacks) != 1:
                raise RuntimeError(f"Expected one four-frame benchmark burst, found {len(stacks)}.")
            stack = stacks[0]
            asset_by_sequence = {
                int(item.get("sequence", 0) or 0): str(item.get("assetId", "") or "")
                for item in stack.get("items", [])
            }

            started = perf_counter()
            first_response = api.analyze_photo_burst_culling({"stackId": stack["stackId"], "force": True})
            first_wall_ms = round((perf_counter() - started) * 1000.0, 3)
            first = first_response["result"]
            started = perf_counter()
            repeat_response = api.analyze_photo_burst_culling({"stackId": stack["stackId"], "force": True})
            repeat_wall_ms = round((perf_counter() - started) * 1000.0, 3)
            repeat = repeat_response["result"]
            started = perf_counter()
            cached_response = api.analyze_photo_burst_culling({"stackId": stack["stackId"]})
            cache_wall_ms = round((perf_counter() - started) * 1000.0, 3)

            reopened = DesktopApi(temp / "workspace")
            restarted_stack = reopened.list_photo_burst_stacks({"includeItems": True})["stacks"][0]
            applied = reopened.apply_photo_culling_recommendation({
                "stackId": stack["stackId"],
                "analysisId": first["analysisId"],
                "resultSha256": first["resultSha256"],
                "confirm": True,
                "idempotencyKey": "photo-culling-benchmark-apply-v1",
            })
            replay = reopened.apply_photo_culling_recommendation({
                "stackId": stack["stackId"],
                "analysisId": first["analysisId"],
                "resultSha256": first["resultSha256"],
                "confirm": True,
                "idempotencyKey": "photo-culling-benchmark-apply-v1",
            })
            after_hashes = {str(path): sha256_file(path) for path in paths}
            selected_stack = applied.get("selection", {}).get("stack", {})
            keepers = [item for item in selected_stack.get("items", []) if bool(item.get("keeper"))]
            assets = reopened.project.db.photo_assets_by_paths([str(path) for path in paths])
            metadata = reopened.project.db.photo_asset_metadata_by_ids(asset.get("assetId", "") for asset in assets)
            socket.socket.connect = original_socket_connect
            socket.create_connection = original_create_connection

            first_by_sequence = {int(frame["sequence"]): frame for frame in first["frames"]}
            public = public_result(first)
            serialized_public = json.dumps(public, ensure_ascii=True, sort_keys=True)
            checks = {
                "runtimeAvailable": status.get("available") is True,
                "offline": status.get("offline") is True and first.get("provenance", {}).get("offline") is True,
                "faceConsentBound": first.get("faceSignalsAllowed") is True,
                "realFaceEngine": str(first.get("provenance", {}).get("faceEngine", "")).startswith("insightface-antelopev2"),
                "realFiqa": (
                    first.get("provenance", {}).get("faceQualityModelId") == FIQA_MODEL_ID
                    and first.get("provenance", {}).get("faceQualityLicense") == FIQA_LICENSE
                    and any(frame.get("faceQualitySource") == "ediffiqa-t" for frame in first.get("frames", []))
                ),
                "everyFrameExplained": len(first.get("frames", [])) == 4 and all(frame_is_explained(frame) for frame in first.get("frames", [])),
                "sharpnessDetectsBlur": (
                    float(first_by_sequence[1]["sharpness"]) > float(first_by_sequence[2]["sharpness"])
                    and float(first_by_sequence[1]["sharpness"]) > float(first_by_sequence[3]["sharpness"])
                ),
                "motionBlurDetected": float(first_by_sequence[1]["motionClarity"]) > float(first_by_sequence[3]["motionClarity"]),
                "eyeHeuristicEvaluated": any(frame.get("eyesOpen") is not None for frame in first.get("frames", [])),
                "sharpOpenRecommended": first.get("recommendedAssetId") == asset_by_sequence[1],
                "deterministicForcedRepeat": (
                    first.get("analysisId") == repeat.get("analysisId")
                    and first.get("resultSha256") == repeat.get("resultSha256")
                    and public_result(first) == public_result(repeat)
                ),
                "cacheHit": cached_response.get("cached") is True and cached_response.get("result", {}).get("analysisId") == first.get("analysisId"),
                "restartCache": restarted_stack.get("culling", {}).get("analysisId") == first.get("analysisId"),
                "explicitApply": len(keepers) == 1 and keepers[0].get("assetId") == first.get("recommendedAssetId"),
                "idempotentApply": replay.get("idempotentReplay") is True,
                "noSourceMutation": before_hashes == after_hashes,
                "noVisibilityOrDeletion": all(not row.get("hidden") and not row.get("deletedAt") for row in metadata.values()),
                "recommendationOnly": first.get("recommendationOnly") is True and first.get("automaticDeletion") is False,
                "pathFreeResult": str(temp) not in serialized_public and "sourcePath" not in serialized_public,
                "zeroOutbound": not outbound_attempts,
            }
            report = {
                "schemaVersion": 1,
                "benchmarkId": "vintrace-photo-assisted-culling-v1",
                "version": PHOTO_CULLING_VERSION,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "platform": platform.platform(),
                "python": platform.python_version(),
                "fixture": {
                    "datasetId": "cplfw",
                    "datasetName": "Cross-Pose LFW",
                    "datasetSource": "http://whdeng.cn/CPLFW/",
                    "preparedManifestSha256": sha256_file(dataset_manifest),
                    "sourceSha256": sha256_file(source),
                    "sourceUse": "One local prepared portrait transformed into a controlled four-frame burst; no identity-accuracy claim.",
                    "variants": ["sharp-open", "gaussian-blur", "directional-motion-blur", "eye-occlusion-heuristic"],
                },
                "model": {
                    "faceEngine": first.get("provenance", {}).get("faceEngine"),
                    "fiqaModelId": FIQA_MODEL_ID,
                    "fiqaModelSha256": FIQA_MODEL_SHA256,
                    "fiqaLicense": FIQA_LICENSE,
                    "fiqaSource": first.get("provenance", {}).get("faceQualitySource"),
                },
                "network": {"socketGuard": True, "outboundAttempts": outbound_attempts},
                "timing": {
                    "firstWallMs": first_wall_ms,
                    "forcedRepeatWallMs": repeat_wall_ms,
                    "cacheWallMs": cache_wall_ms,
                },
                "import": {
                    "importedCount": imported.get("importedCount"),
                    "storageMode": "referenced",
                    "frameCount": len(paths),
                },
                "result": public,
                "checks": checks,
                "passed": all(checks.values()),
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({
                "report": str(output),
                "sha256": sha256_file(output),
                "timing": report["timing"],
                "checks": checks,
                "passed": report["passed"],
            }, indent=2, sort_keys=True))
            if not report["passed"]:
                raise SystemExit(1)
    finally:
        socket.socket.connect = original_socket_connect
        socket.create_connection = original_create_connection
        if previous_registry is None:
            os.environ.pop("VINTRACE_REGISTRY_HOME", None)
        else:
            os.environ["VINTRACE_REGISTRY_HOME"] = previous_registry
        if previous_crossage_registry is None:
            os.environ.pop("CROSSAGE_REGISTRY_HOME", None)
        else:
            os.environ["CROSSAGE_REGISTRY_HOME"] = previous_crossage_registry
        if previous_force_fallback is None:
            os.environ.pop("CROSSAGE_FORCE_FALLBACK", None)
        else:
            os.environ["CROSSAGE_FORCE_FALLBACK"] = previous_force_fallback


if __name__ == "__main__":
    main()
