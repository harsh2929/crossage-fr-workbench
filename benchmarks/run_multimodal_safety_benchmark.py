from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import socket
import time
from typing import Any

from crossage_fr.ingest.multimodal_safety import (
    CATEGORY_IDS,
    POLICY_VERSION,
    multimodal_guardrail_status,
    run_multimodal_guardrail,
)
from crossage_fr.photo_vlm import shutdown_photo_vlm_runtime
from crossage_fr.photo_vlm import photo_vlm_status


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_case(value: str) -> tuple[str, Path, str]:
    parts = value.split("=", 2)
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("Cases use label=/absolute/or/relative/path=none|category_id.")
    label, path_text, expected = (part.strip() for part in parts)
    path = Path(path_text).expanduser().resolve()
    if not label or not path.is_file():
        raise argparse.ArgumentTypeError("Each case needs a label and readable image path.")
    if expected != "none" and expected not in CATEGORY_IDS:
        raise argparse.ArgumentTypeError(f"Expected category must be none or one of: {', '.join(CATEGORY_IDS)}")
    return label, path, expected


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the real offline multimodal Safe Mode acceptance.")
    parser.add_argument("--case", action="append", type=parse_case, required=True)
    parser.add_argument("--threshold", type=float, default=0.58)
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--tier", choices=("quality", "low-memory"), default="quality")
    parser.add_argument("--candidate-tier", action="store_true", help="Evaluate an unapproved exact tier without marking production readiness.")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    threshold = max(0.0, min(1.0, float(args.threshold)))
    outbound_attempts: list[str] = []
    original_connect = socket.socket.connect

    def guarded_connect(sock: socket.socket, address: Any) -> Any:
        host = str(address[0]) if isinstance(address, tuple) and address else ""
        if host not in {"127.0.0.1", "localhost", "::1"}:
            outbound_attempts.append(host or repr(address))
            raise OSError("Benchmark blocked a non-loopback network attempt.")
        return original_connect(sock, address)

    socket.socket.connect = guarded_connect
    started = time.perf_counter()
    if args.candidate_tier:
        candidate_status = photo_vlm_status(preference=args.tier)
        route = candidate_status.get("route") if isinstance(candidate_status.get("route"), dict) else {}
        status = {
            "available": bool(route.get("available")) and str(route.get("tier", "")) == args.tier,
            "candidateOnly": True,
            "tier": args.tier,
            "route": route,
            "productionApproved": False,
        }
    else:
        status = multimodal_guardrail_status(preference=args.tier, refresh=True)
    results: list[dict[str, Any]] = []
    try:
        if not status.get("available"):
            raise RuntimeError(str(status.get("reason", "The multimodal guardrail is unavailable.")))
        for label, path, expected in args.case:
            case_started = time.perf_counter()
            verdict = run_multimodal_guardrail(
                path,
                threshold,
                temperature=args.temperature,
                preference=args.tier,
            )
            categories = verdict["categories"]
            if expected == "none":
                passed = not verdict["sensitive"] and all(float(value["score"]) < threshold for value in categories.values())
            else:
                category = categories[expected]
                passed = float(category["score"]) >= threshold and str(category["evidence"]) != "none"
            results.append(
                {
                    "case": label,
                    "sourceFile": path.name,
                    "sourceSha256": sha256_file(path),
                    "expected": expected,
                    "passed": passed,
                    "sensitive": bool(verdict["sensitive"]),
                    "score": float(verdict["score"]),
                    "level": str(verdict["level"]),
                    "reason": str(verdict["reason"]),
                    "categories": categories,
                    "inferenceElapsedMs": float(verdict["elapsedMs"]),
                    "wallElapsedMs": round((time.perf_counter() - case_started) * 1000.0, 3),
                    "model": verdict["model"],
                    "route": verdict["route"],
                }
            )
    finally:
        socket.socket.connect = original_connect
        shutdown_photo_vlm_runtime()
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "benchmark": "vintrace-multimodal-safety-acceptance-v1",
        "policyVersion": POLICY_VERSION,
        "threshold": threshold,
        "temperature": float(args.temperature),
        "tier": args.tier,
        "candidateTier": bool(args.candidate_tier),
        "status": status,
        "network": {"loopbackOnly": True, "outboundAttempts": outbound_attempts},
        "results": results,
        "elapsedMs": round((time.perf_counter() - started) * 1000.0, 3),
    }
    payload["passed"] = bool(results) and all(item["passed"] for item in results) and not outbound_attempts
    rendered = json.dumps(payload, indent=2) + "\n"
    if args.output:
        output = args.output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    if not payload["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
