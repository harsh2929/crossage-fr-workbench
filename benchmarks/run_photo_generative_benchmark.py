from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import socket
import tempfile
from time import perf_counter
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageStat

from crossage_fr.photo_generative import (
    CATALOG_SHA256,
    hash_file,
    photo_generative_status,
    run_photo_generative_edit,
)


def _fixture(path: Path, variant: int) -> None:
    image = Image.new("RGB", (128, 96), (28 + variant * 9, 62, 104))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 63, 127, 95), fill=(36, 95 + variant * 5, 68))
    draw.ellipse((12, 11, 55, 54), fill=(233, 190, 74), outline=(255, 234, 150), width=2)
    draw.rectangle((73, 18, 112, 57), fill=(172, 62 + variant * 8, 71), outline=(244, 201, 188), width=2)
    draw.line((0, 72, 127, 72), fill=(205, 224, 232), width=2)
    draw.text((7, 78), f"VINTRACE {variant + 1}", fill=(246, 246, 240))
    image.save(path, format="PNG", optimize=False)


def _mask_image(size: tuple[int, int], rect: dict[str, float]) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    left = round(width * rect["left"] / 100)
    top = round(height * rect["top"] / 100)
    right = round(width * (rect["left"] + rect["width"]) / 100)
    bottom = round(height * (rect["top"] + rect["height"]) / 100)
    draw.rounded_rectangle((left, top, right, bottom), radius=max(1, min(right - left, bottom - top) // 5), fill=255)
    return mask


def _mean_difference(original: Image.Image, generated: Image.Image, mask: Image.Image) -> float:
    difference = ImageChops.difference(original.convert("RGB"), generated.convert("RGB"))
    values = ImageStat.Stat(difference, mask=mask).mean
    return round(sum(values) / max(1, len(values)), 6)


def _run_case(
    *,
    case_id: str,
    mode: str,
    source: Path,
    output: Path,
    params: dict[str, Any],
    model_root: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    source_hash_before = hash_file(source)
    started = perf_counter()
    result = run_photo_generative_edit(mode, source, output, params, root=model_root)
    elapsed = round(perf_counter() - started, 6)
    source_hash_after = hash_file(source)
    with Image.open(source) as original_opened, Image.open(output) as output_opened:
        original = original_opened.convert("RGB")
        generated = output_opened.convert("RGB")
        metrics: dict[str, Any] = {
            "sourceWidth": original.width,
            "sourceHeight": original.height,
            "outputWidth": generated.width,
            "outputHeight": generated.height,
        }
        passed = source_hash_before == source_hash_after
        if mode == "cleanup":
            rect = params["maskRects"][0]
            mask = _mask_image(original.size, rect)
            outside = Image.eval(mask, lambda value: 255 - value)
            difference = ImageChops.difference(original, generated)
            outside_changed = Image.composite(difference, Image.new("RGB", original.size), outside).getbbox() is not None
            inside_difference = _mean_difference(original, generated, mask)
            metrics.update({"outsideMaskChanged": outside_changed, "insideMeanAbsoluteDifference": inside_difference})
            passed = passed and not outside_changed and inside_difference > 0
        else:
            scale = int(params["scale"])
            dimensions_match = generated.size == (original.width * scale, original.height * scale)
            metrics.update({"requestedScale": scale, "dimensionsMatch": dimensions_match})
            passed = passed and dimensions_match
    case = {
        "id": case_id,
        "mode": mode,
        "passed": passed,
        "durationSeconds": elapsed,
        "sourceSha256": source_hash_before,
        "outputSha256": str(result["outputSha256"]),
        "offlineInference": bool(result["offlineInference"]),
        "aiGenerated": bool(result["aiGenerated"]),
        "tier": str(result["tier"]),
        "model": result["provenance"]["model"],
        "runtime": result["provenance"]["runtime"],
        "parameters": result["provenance"]["parameters"],
        "metrics": metrics,
    }
    return case, result


def run(model_root: Path) -> dict[str, Any]:
    status = photo_generative_status(model_root)
    if not status["light"]["ready"]:
        raise RuntimeError("The verified LaMa and Real-ESRGAN light pack is required for this benchmark.")
    cases: list[dict[str, Any]] = []
    outbound_attempts: list[str] = []
    original_connect = socket.socket.connect

    def block_outbound(sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise RuntimeError("Outbound network access is forbidden during the local generative benchmark.")

    with tempfile.TemporaryDirectory(prefix="vintrace-generative-benchmark-") as temp_value:
        temp = Path(temp_value)
        source_a = temp / "fixture-a.png"
        source_b = temp / "fixture-b.png"
        _fixture(source_a, 0)
        _fixture(source_b, 1)
        clean_a_params = {"maskRects": [{"left": 56.5, "top": 16.5, "width": 33.0, "height": 45.0, "shape": "rectangle"}]}
        clean_b_params = {"maskRects": [{"left": 9.0, "top": 9.0, "width": 35.0, "height": 48.0, "shape": "rectangle"}]}
        socket.socket.connect = block_outbound
        try:
            clean_a, _ = _run_case(
                case_id="cleanup-object-a",
                mode="cleanup",
                source=source_a,
                output=temp / "cleanup-a.png",
                params=clean_a_params,
                model_root=model_root,
            )
            cases.append(clean_a)
            clean_b, _ = _run_case(
                case_id="cleanup-object-b",
                mode="cleanup",
                source=source_b,
                output=temp / "cleanup-b.png",
                params=clean_b_params,
                model_root=model_root,
            )
            cases.append(clean_b)
            clean_repeat, _ = _run_case(
                case_id="cleanup-object-a-repeat",
                mode="cleanup",
                source=source_a,
                output=temp / "cleanup-a-repeat.png",
                params=clean_a_params,
                model_root=model_root,
            )
            clean_repeat["deterministicWith"] = "cleanup-object-a"
            clean_repeat["deterministic"] = clean_repeat["outputSha256"] == clean_a["outputSha256"]
            clean_repeat["passed"] = bool(clean_repeat["passed"] and clean_repeat["deterministic"])
            cases.append(clean_repeat)
            upscale_2x, _ = _run_case(
                case_id="upscale-2x",
                mode="upscale",
                source=source_a,
                output=temp / "upscale-2x.png",
                params={"scale": 2, "tile": 128},
                model_root=model_root,
            )
            cases.append(upscale_2x)
            upscale_4x, _ = _run_case(
                case_id="upscale-4x",
                mode="upscale",
                source=source_b,
                output=temp / "upscale-4x.png",
                params={"scale": 4, "tile": 128},
                model_root=model_root,
            )
            cases.append(upscale_4x)
        finally:
            socket.socket.connect = original_connect
    return {
        "schemaVersion": 1,
        "benchmarkId": "vintrace-photo-generative-light-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "catalogVersion": status["catalogVersion"],
        "catalogSha256": CATALOG_SHA256,
        "platform": status["platform"],
        "python": platform.python_version(),
        "offlineInference": True,
        "outboundSocketAttempts": outbound_attempts,
        "heavyTier": {
            "available": bool(status["heavy"]["available"]),
            "hardwareSupported": bool(status["heavy"]["hardwareSupported"]),
            "platformSupported": bool(status["heavy"]["platformSupported"]),
            "minimumMemoryBytes": int(status["heavy"]["minimumMemoryBytes"]),
            "executed": False,
        },
        "cases": cases,
        "summary": {
            "passed": sum(1 for case in cases if case["passed"]),
            "failed": sum(1 for case in cases if not case["passed"]),
            "total": len(cases),
            "deterministic": bool(next(case for case in cases if case["id"] == "cleanup-object-a-repeat")["deterministic"]),
            "zeroOutboundSockets": not outbound_attempts,
            "allPassed": all(case["passed"] for case in cases) and not outbound_attempts,
            "totalDurationSeconds": round(sum(float(case["durationSeconds"]) for case in cases), 6),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark verified local LaMa and Real-ESRGAN photo editing.")
    parser.add_argument("--model-root", required=True, help="Installed and verified generative model root.")
    parser.add_argument("--output", default="", help="Optional JSON report path.")
    args = parser.parse_args()
    report = run(Path(args.model_root).expanduser().resolve())
    generated_day = datetime.now(timezone.utc).strftime("%Y%m%d")
    target = Path(args.output).expanduser().resolve() if args.output else Path("benchmarks/results") / f"photo-generative-benchmark-{generated_day}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    payload = {
        "report": str(target),
        "sha256": hash_file(target),
        "summary": report["summary"],
    }
    print(json.dumps(payload, sort_keys=True))
    if not report["summary"]["allPassed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
