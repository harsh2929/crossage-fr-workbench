"""Reproducible offline correctness and latency benchmark for PHOTO-01."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import platform
from pathlib import Path
import socket
import statistics
import tempfile
from time import perf_counter
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from crossage_fr.photo_ocr import ARTIFACTS, clear_ppocrv6_caches, ppocrv6_model_report, run_ppocrv6


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "ocr" / "paddleocr-general-ocr-002.jpg"
DEFAULT_OUTPUT = ROOT / "benchmarks" / "results" / "ppocrv6-benchmark-20260712.json"
COUNT = 16


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_fixture(path: Path, index: int) -> str:
    token = f"VINTRACE OCR {index:03d}"
    image = Image.new("RGB", (800, 240), "white")
    ImageDraw.Draw(image).text((35, 70), token, fill="black", font=font(72))
    image.save(path)
    return token


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * fraction))))
    return ordered[position]


def run(output_path: Path) -> dict[str, Any]:
    model = ppocrv6_model_report(validate_runtime=False)
    # Load Python modules before replacing socket.socket; ssl defines a socket
    # subclass at import time. Model construction and every inference remain
    # inside the no-network guard below.
    import rapidocr  # noqa: F401

    with tempfile.TemporaryDirectory(prefix="vintrace-ppocrv6-benchmark-") as temp_name:
        temp = Path(temp_name)
        fixtures: list[tuple[Path, str]] = []
        for index in range(COUNT):
            path = temp / f"ticket-{index:03d}.png"
            fixtures.append((path, render_fixture(path, index)))

        original_socket = socket.socket
        original_connection = socket.create_connection

        def blocked(*_args, **_kwargs):
            raise AssertionError("network access attempted during PP-OCRv6 benchmark")

        socket.socket = blocked  # type: ignore[assignment]
        socket.create_connection = blocked  # type: ignore[assignment]
        try:
            clear_ppocrv6_caches()
            startup_started = perf_counter()
            first = run_ppocrv6(fixtures[0][0])
            startup_ms = (perf_counter() - startup_started) * 1000.0

            outputs: list[str] = [str(first["text"])]
            wall_times: list[float] = []
            for path, _token in fixtures[1:]:
                started = perf_counter()
                result = run_ppocrv6(path)
                wall_times.append((perf_counter() - started) * 1000.0)
                outputs.append(str(result["text"]))

            repeat_outputs = [str(run_ppocrv6(path)["text"]) for path, _token in fixtures]
            bilingual = run_ppocrv6(FIXTURE)
        finally:
            socket.socket = original_socket  # type: ignore[assignment]
            socket.create_connection = original_connection  # type: ignore[assignment]
            clear_ppocrv6_caches()

    expected_tokens = [token for _path, token in fixtures]
    normalized_outputs = [text.upper().replace("-", " ") for text in outputs]
    token_gates = [
        all(part in normalized_outputs[index] for part in token.split())
        for index, token in enumerate(expected_tokens)
    ]
    p50_ms = statistics.median(wall_times)
    p95_ms = percentile(wall_times, 0.95)
    gates = {
        "verifiedModelPack": bool(model.get("available") and model.get("verified")),
        "allRenderedTokensRecognized": all(token_gates),
        "deterministicSecondPass": outputs == repeat_outputs,
        "bilingualEnglishRecognized": "BOARDING PASS" in str(bilingual["text"]).upper(),
        "bilingualCjkRecognized": "登机牌" in str(bilingual["text"]) and "张祺伟" in str(bilingual["text"]),
        "offlineSocketGuard": True,
        "warmP95Under1500Ms": p95_ms < 1500.0,
        "fixtureCount": len(fixtures) == COUNT,
    }
    report = {
        "schemaVersion": 1,
        "benchmarkId": "vintrace-ppocrv6-offline-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "machine": platform.machine(),
        },
        "model": {
            "modelId": model.get("modelId"),
            "modelVersion": model.get("modelVersion"),
            "runtimeVersion": model.get("runtimeVersion"),
            "manifestSha256": model.get("manifestSha256"),
            "artifacts": model.get("artifacts"),
            "license": model.get("license"),
            "offline": model.get("offline"),
        },
        "fixtures": {
            "renderedCount": len(fixtures),
            "bilingualFilename": FIXTURE.name,
            "bilingualSha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
            "bilingualLines": len(bilingual["lines"]),
        },
        "correctness": {
            "renderedPassed": sum(1 for gate in token_gates if gate),
            "renderedTotal": len(token_gates),
            "outputDigest": hashlib.sha256("\n".join(outputs).encode("utf-8")).hexdigest(),
            "bilingualContains": ["BOARDING PASS", "登机牌", "张祺伟"],
        },
        "performance": {
            "coldStartAndFirstImageMs": round(startup_ms, 3),
            "warmImages": len(wall_times),
            "warmP50Ms": round(p50_ms, 3),
            "warmP95Ms": round(p95_ms, 3),
            "warmMeanMs": round(statistics.mean(wall_times), 3),
            "bilingualModelElapsedMs": bilingual["elapsedMs"],
        },
        "gates": gates,
        "ok": all(gates.values()),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = run(args.output)
    print(json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
