from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import argparse
import json
import os
import sys
import warnings


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


DATASETS: dict[str, dict[str, Any]] = {
    "agedb": {
        "folder": REPO_ROOT / "benchmarks/public-data/prepared/agedb-40x4",
        "terms": "Authorized local research benchmark copy; no training or redistribution.",
    },
    "calfw": {
        "folder": REPO_ROOT / "benchmarks/public-data/prepared/calfw-40x4",
        "terms": "Authorized local CALFW/LFW-derived research benchmark copy; no training or redistribution.",
    },
    "fgnet": {
        "folder": None,
        "terms": "Maintainer-supplied academic-research copy only; Vintrace never downloads or redistributes FG-NET.",
    },
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run versioned baseline-vs-age-trajectory recognition benchmarks.")
    parser.add_argument("--datasets", nargs="*", choices=sorted(DATASETS), default=sorted(DATASETS))
    parser.add_argument("--fgnet-folder", default=os.environ.get("VINTRACE_FGNET_FOLDER", ""))
    parser.add_argument("--acknowledge-research-terms", action="store_true")
    parser.add_argument("--require-all", action="store_true")
    parser.add_argument("--max-identities", type=int, default=32)
    parser.add_argument("--candidate-images", type=int, default=2)
    parser.add_argument("--negative-identities", type=int, default=8)
    parser.add_argument("--model-pack", choices=["antelopev2", "buffalo_l"], default="antelopev2")
    parser.add_argument("--model-root", default=str(Path.home() / ".insightface"))
    parser.add_argument("--results-dir", default="benchmarks/results")
    parser.add_argument("--workspace-root", default="benchmarks/public-data/workspaces")
    args = parser.parse_args()
    if not args.acknowledge_research_terms:
        raise SystemExit("Pass --acknowledge-research-terms after confirming authorization for every selected local dataset.")

    # The generic test runner defaults to the deterministic fallback. This is an
    # accuracy evidence command, so explicitly require the installed recognizer.
    os.environ["VINTRACE_FORCE_FALLBACK"] = "0"
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "0"

    from crossage_fr.api_server import DesktopApi
    from crossage_fr.benchmarks.public_dataset import CROSS_AGE_TRAJECTORY_PROTOCOL_VERSION
    from crossage_fr.match.age_trajectory import AGE_TRAJECTORY_METHOD_VERSION

    results_dir = (REPO_ROOT / args.results_dir).resolve() if not Path(args.results_dir).is_absolute() else Path(args.results_dir).resolve()
    workspace_root = (REPO_ROOT / args.workspace_root).resolve() if not Path(args.workspace_root).is_absolute() else Path(args.workspace_root).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    os.environ["CROSSAGE_ORT_CACHE"] = str(workspace_root / "ort-cache")
    warnings.filterwarnings(
        "ignore",
        message=r"`estimate` is deprecated.*",
        category=FutureWarning,
        module=r"insightface\.utils\.face_align",
    )
    registry = workspace_root / "cross-age-registry"
    os.environ.setdefault("VINTRACE_REGISTRY_HOME", str(registry))
    os.environ.setdefault("CROSSAGE_REGISTRY_HOME", str(registry))
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    api = DesktopApi(workspace_root / f"cross-age-{stamp}", actor="cross-age-benchmark")
    api.project.config.model_pack = args.model_pack
    api.project.config.model_root = str(Path(args.model_root).expanduser().resolve())
    api.project.save()

    rows: list[dict[str, Any]] = []
    for dataset_id in args.datasets:
        spec = DATASETS[dataset_id]
        folder = Path(args.fgnet_folder).expanduser().resolve() if dataset_id == "fgnet" and args.fgnet_folder else spec["folder"]
        if folder is None or not Path(folder).exists():
            rows.append(
                {
                    "datasetId": dataset_id,
                    "status": "authorized-data-missing",
                    "terms": spec["terms"],
                    "action": "Set VINTRACE_FGNET_FOLDER to a maintainer-supplied copy." if dataset_id == "fgnet" else "Prepare the authorized dataset slice.",
                }
            )
            continue
        try:
            result = api.cross_age_trajectory_benchmark(
                {
                    "datasetId": dataset_id,
                    "folder": str(folder),
                    "maxIdentities": max(2, int(args.max_identities)),
                    "referenceImages": 2,
                    "candidateImages": max(1, int(args.candidate_images)),
                    "negativeIdentities": max(0, int(args.negative_identities)),
                    "includeDistractors": int(args.negative_identities) > 0,
                    "acknowledgeDatasetTerms": True,
                    "requireFullRecognizer": True,
                }
            )
            rows.append(result)
        except Exception as exc:
            rows.append({"datasetId": dataset_id, "status": "error", "error": str(exc), "terms": spec["terms"]})

    complete = [row for row in rows if row.get("status") in {"pass", "fail"}]
    missing = [row for row in rows if row.get("status") == "authorized-data-missing"]
    failed = [row for row in rows if row.get("status") in {"fail", "error"}]
    overall = "fail" if failed else "incomplete" if missing else "pass"
    payload = {
        "schemaVersion": 1,
        "protocolVersion": CROSS_AGE_TRAJECTORY_PROTOCOL_VERSION,
        "methodVersion": AGE_TRAJECTORY_METHOD_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "status": overall,
        "requestedDatasets": list(args.datasets),
        "completedDatasets": len(complete),
        "missingDatasets": len(missing),
        "failedDatasets": len(failed),
        "researchTermsAcknowledged": True,
        "modelPack": args.model_pack,
        "modelRoot": str(Path(args.model_root).expanduser().resolve()),
        "rows": rows,
    }
    json_path = results_dir / f"cross-age-trajectory-benchmark-{stamp}.json"
    latest_json = results_dir / "cross-age-trajectory-benchmark-latest.json"
    md_path = results_dir / f"cross-age-trajectory-benchmark-{stamp}.md"
    latest_md = results_dir / "cross-age-trajectory-benchmark-latest.md"
    encoded = json.dumps(payload, indent=2)
    json_path.write_text(encoded, encoding="utf-8")
    latest_json.write_text(encoded, encoding="utf-8")
    markdown = markdown_report(payload)
    md_path.write_text(markdown, encoding="utf-8")
    latest_md.write_text(markdown, encoding="utf-8")
    print(json.dumps({"status": overall, "json": str(json_path), "markdown": str(md_path)}, indent=2))
    if failed or (args.require_all and missing):
        raise SystemExit(1)


def markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# Cross-Age Trajectory Benchmark",
        "",
        f"- Protocol: `{payload['protocolVersion']}`",
        f"- Method: `{payload['methodVersion']}`",
        f"- Generated: {payload['generatedAt']}",
        f"- Status: **{payload['status']}**",
        "",
        "| Dataset | Status | Evaluated | Generated refs | Strong synth TP | Genuine scores up | Improvements | Regressions | Precision delta | Recall delta |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in payload.get("rows", []):
        comparison = row.get("comparison", {}) if isinstance(row.get("comparison"), dict) else {}
        lines.append(
            "| {dataset} | {status} | {evaluated} | {generated} | {supported} | {scores_up} | {improved} | {regressed} | {precision} | {recall} |".format(
                dataset=row.get("datasetId", ""),
                status=row.get("status", ""),
                evaluated=comparison.get("evaluated", "-"),
                generated=comparison.get("generatedReferences", "-"),
                supported=comparison.get("syntheticTruePositiveEvidence", "-"),
                scores_up=comparison.get("genuineScoreImproved", "-"),
                improved=comparison.get("improvements", "-"),
                regressed=comparison.get("regressions", "-"),
                precision=comparison.get("precisionDelta", "-"),
                recall=comparison.get("recallDelta", "-"),
            )
        )
    lines.extend(
        [
            "",
            "FG-NET is never downloaded by this runner. A missing row is an explicit evidence gap, not a passing result.",
            "This runner evaluates the embedding-space bridge only. AI-generated portrait augmentation has a separate two-phase, human-review-bound runner.",
            "",
        ]
    )
    return "\n".join(lines)


if __name__ == "__main__":
    main()
