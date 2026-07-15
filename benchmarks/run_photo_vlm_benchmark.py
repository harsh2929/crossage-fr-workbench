from __future__ import annotations

from pathlib import Path
import argparse
import hashlib
import json
import socket
import time

from crossage_fr.photo_vlm import (
    CATALOG_SHA256,
    load_catalog,
    photo_vlm_status,
    run_photo_vlm,
    shutdown_photo_vlm_runtime,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "ocr" / "paddleocr-general-ocr-002.jpg"
DEFAULT_OUTPUT = ROOT / "benchmarks" / "results" / "photo-vlm-benchmark-20260712.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def searchable_terms(result: dict) -> set[str]:
    values = [str(result.get("caption", "") or ""), *[str(value or "") for value in result.get("tags", [])]]
    return {token.casefold() for value in values for token in value.replace(",", " ").replace(".", " ").split() if token}


def run_tier(fixture: Path, tier: str, model_root: Path) -> dict:
    started = time.perf_counter()
    first = run_photo_vlm(fixture, preference=tier, root=model_root, total_memory_bytes=24 * 1024**3)
    cold_wall_ms = round((time.perf_counter() - started) * 1000.0, 3)
    started = time.perf_counter()
    second = run_photo_vlm(fixture, preference=tier, root=model_root, total_memory_bytes=24 * 1024**3)
    warm_wall_ms = round((time.perf_counter() - started) * 1000.0, 3)
    expected = {"boarding", "pass"}
    terms = searchable_terms(second)
    return {
        "tier": tier,
        "source": second["source"],
        "model": second["model"],
        "route": second["route"],
        "coldWallMs": cold_wall_ms,
        "warmWallMs": warm_wall_ms,
        "reportedWarmInferenceMs": second["elapsedMs"],
        "caption": second["caption"],
        "tags": second["tags"],
        "deterministic": first["caption"] == second["caption"] and first["tags"] == second["tags"],
        "boardingPassRecovered": expected.issubset(terms),
        "offline": second["model"]["offline"] is True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the pinned offline Qwen3-VL and SmolVLM2 photo benchmark.")
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    model_root = args.model_root.expanduser().resolve()
    fixture = args.fixture.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not fixture.is_file():
        raise SystemExit(f"Missing benchmark fixture: {fixture}")
    catalog = load_catalog()
    status = photo_vlm_status(model_root, total_memory_bytes=24 * 1024**3)
    if not all(bool(item.get("available")) for item in status["packs"]):
        raise SystemExit("Both verified photo VLM tiers must be installed before benchmarking.")

    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def loopback_only(address, *call_args, **call_kwargs):
        host = str(address[0]).strip().casefold()
        if host not in {"127.0.0.1", "::1", "localhost"}:
            outbound_attempts.append(host)
            raise AssertionError(f"Unexpected outbound connection during offline VLM inference: {host}")
        return original_create_connection(address, *call_args, **call_kwargs)

    socket.create_connection = loopback_only
    try:
        results = []
        for tier in ("low-memory", "quality"):
            shutdown_photo_vlm_runtime()
            results.append(run_tier(fixture, tier, model_root))
    finally:
        shutdown_photo_vlm_runtime()
        socket.create_connection = original_create_connection

    report = {
        "schemaVersion": 1,
        "benchmarkId": "vintrace-photo-vlm-offline-v1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fixture": {
            "name": fixture.name,
            "sizeBytes": fixture.stat().st_size,
            "sha256": sha256_file(fixture),
        },
        "catalog": {
            "version": catalog["version"],
            "sha256": CATALOG_SHA256,
            "runtimeTag": catalog["runtime"]["tag"],
            "runtimeRevision": catalog["runtime"]["revision"],
        },
        "network": {
            "llamaOfflineFlagRequired": True,
            "loopbackOnlyGuard": True,
            "outboundAttempts": outbound_attempts,
        },
        "results": results,
        "passed": (
            not outbound_attempts
            and len(results) == 2
            and all(item["offline"] and item["deterministic"] and item["boardingPassRecovered"] for item in results)
        ),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
