"""Run the hash-pinned cross-model lifecycle and candidate regression gate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import json

from crossage_fr.model_lifecycle import evaluate_model_lifecycle, load_policy


def _candidate(value: str) -> tuple[str, Path]:
    component_id, separator, path = str(value or "").partition("=")
    if not separator or not component_id.strip() or not path.strip():
        raise argparse.ArgumentTypeError("Candidate reports use component-id=/path/to/report.json.")
    return component_id.strip(), Path(path).expanduser().resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", action="append", default=[], type=_candidate)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    candidates = dict(args.candidate)
    if len(candidates) != len(args.candidate):
        parser.error("Each candidate component id may be supplied only once.")
    policy = load_policy()
    root = Path(__file__).resolve().parents[1]
    report = evaluate_model_lifecycle(
        policy=policy,
        resource_root=root,
        candidate_reports=candidates,
    )
    candidate_failures = [
        row["id"]
        for row in report["components"]
        if row.get("candidate") is not None and not row["candidate"]["passed"]
    ]
    report["candidateComponents"] = sorted(candidates)
    report["candidateFailures"] = candidate_failures
    output = args.output
    if output is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        output = root / "benchmarks" / "results" / f"model-lifecycle-{stamp}.json"
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({
        "ok": bool(report["ready"] and not candidate_failures),
        "output": str(output),
        "policyVersion": report["policyVersion"],
        "counts": report["counts"],
        "candidateFailures": candidate_failures,
    }, sort_keys=True))
    return 0 if report["ready"] and not candidate_failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
