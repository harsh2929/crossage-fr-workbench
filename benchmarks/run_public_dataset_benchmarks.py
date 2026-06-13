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


DATASET_RUNS = {
    "calfw": {
        "folder": Path("benchmarks/public-data/prepared/calfw-40x4"),
        "sliceImages": 4,
        "maxIdentities": 32,
        "referenceImages": 1,
        "candidateImages": 2,
        "negativeIdentities": 8,
        "includeVideos": False,
        "note": "Official CALFW archive slice prepared from aligned images.",
    },
    "cplfw": {
        "folder": Path("benchmarks/public-data/prepared/cplfw-40x3"),
        "sliceImages": 3,
        "maxIdentities": 32,
        "referenceImages": 1,
        "candidateImages": 2,
        "negativeIdentities": 8,
        "includeVideos": False,
        "note": "Official CPLFW archive slice prepared from aligned images. Pose protocol labels are not inferred from landmarks.",
    },
    "agedb": {
        "folder": Path("benchmarks/public-data/prepared/agedb-40x4"),
        "sliceImages": 4,
        "maxIdentities": 32,
        "referenceImages": 2,
        "candidateImages": 2,
        "negativeIdentities": 8,
        "includeVideos": False,
        "note": "Official AgeDB ZIP slice prepared from identity/age filenames.",
    },
    "cfp": {
        "folder": Path("benchmarks/public-data/prepared/cfp/cfp-dataset/Data/Images"),
        "maxIdentities": 32,
        "referenceImages": 1,
        "candidateImages": 2,
        "negativeIdentities": 8,
        "includeVideos": False,
        "note": "Official CFP frontal/profile benchmark prepared from Data/Images.",
    },
    "fiw": {
        "folder": Path("benchmarks/public-data/prepared/fiw-40x4"),
        "sliceImages": 4,
        "maxIdentities": 32,
        "referenceImages": 1,
        "candidateImages": 2,
        "negativeIdentities": 8,
        "includeVideos": False,
        "note": "FIW Kaggle archive slice prepared from train-faces.zip person folders.",
    },
    "ytf": {
        "folder": Path("benchmarks/public-data/prepared/ytf"),
        "manual": True,
        "includeVideos": True,
        "videoFrameSamples": 4,
        "videoFrameIntervalSeconds": 2.0,
        "note": "YTF requires the official form/password and a local video copy before a full video benchmark can run.",
    },
}


BENCHMARK_PROFILES: dict[str, dict[str, int]] = {
    "standard": {"maxIdentities": 32, "negativeIdentities": 8, "candidateImages": 2},
    "large": {"maxIdentities": 128, "negativeIdentities": 32, "candidateImages": 2},
    "stress": {"maxIdentities": 256, "negativeIdentities": 64, "candidateImages": 2},
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run reproducible public dataset benchmark slices through Vintrace.")
    parser.add_argument("--datasets", nargs="*", default=["calfw", "cplfw", "agedb", "fiw", "cfp", "ytf"], choices=sorted(DATASET_RUNS))
    parser.add_argument("--packs", nargs="*", default=["antelopev2", "buffalo_l"])
    parser.add_argument("--baseline-pack", default="antelopev2")
    parser.add_argument("--candidate-pack", default="buffalo_l")
    parser.add_argument("--profile", choices=sorted(BENCHMARK_PROFILES), default="standard", help="Prepared slice size profile.")
    parser.add_argument("--max-identities", type=int, default=None, help="Override profile positive identity count.")
    parser.add_argument("--negative-identities", type=int, default=None, help="Override profile distractor identity count.")
    parser.add_argument("--reference-images", type=int, default=None, help="Override references enrolled per identity.")
    parser.add_argument("--candidate-images", type=int, default=None, help="Override held-out candidate images per identity.")
    parser.add_argument("--images-per-identity", type=int, default=None, help="Prepared folder image count suffix for folder-based datasets.")
    parser.add_argument("--require-real-data", action="store_true", help="Fail immediately when a requested prepared dataset folder is missing.")
    parser.add_argument("--results-dir", default="benchmarks/results")
    parser.add_argument("--workspace-root", default="benchmarks/public-data/workspaces")
    parser.add_argument("--entry-budget", type=int, default=500_000)
    args = parser.parse_args()

    results_dir = Path(args.results_dir).expanduser().resolve()
    workspace_root = Path(args.workspace_root).expanduser().resolve()
    registry_root = workspace_root / "registry"
    results_dir.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    registry_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("VINTRACE_REGISTRY_HOME", str(registry_root))
    warnings.filterwarnings(
        "ignore",
        message=r"`estimate` is deprecated.*",
        category=FutureWarning,
        module=r"insightface\.utils\.face_align",
    )

    from crossage_fr.benchmark_quality import calibrate_public_labels, evaluate_dataset_gates, labels_from_benchmark_rows, model_pack_quality_matrix
    from crossage_fr.api_server import DesktopApi

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    api = DesktopApi(workspace_root / f"public-benchmark-{stamp}", actor="public-dataset-benchmark")
    dataset_payloads: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for dataset_id in args.datasets:
        spec = _resolve_dataset_spec(dataset_id, DATASET_RUNS[dataset_id], args)
        folder = Path(spec["folder"]).expanduser().resolve()
        if spec.get("manual") and not folder.exists():
            if args.require_real_data:
                raise SystemExit(f"Required prepared dataset is missing: {folder}")
            skipped = {
                "datasetId": dataset_id,
                "status": "manual-data-missing",
                "folder": str(folder),
                "note": spec.get("note", ""),
                "packs": [],
            }
            dataset_payloads.append(skipped)
            rows.append(_skipped_row(dataset_id, str(folder), str(spec.get("note", ""))))
            continue
        if not folder.exists():
            if args.require_real_data:
                raise SystemExit(f"Required prepared dataset is missing: {folder}")
            skipped = {
                "datasetId": dataset_id,
                "status": "prepared-folder-missing",
                "folder": str(folder),
                "note": spec.get("note", ""),
                "packs": [],
            }
            dataset_payloads.append(skipped)
            rows.append(_skipped_row(dataset_id, str(folder), f"Prepared folder missing. {spec.get('note', '')}".strip()))
            continue
        params = {
            "datasetId": dataset_id,
            "folder": str(folder),
            "packs": args.packs,
            "maxIdentities": int(spec.get("maxIdentities", 32)),
            "referenceImages": int(spec.get("referenceImages", 1)),
            "candidateImages": int(spec.get("candidateImages", 2)),
            "negativeIdentities": int(spec.get("negativeIdentities", 8)),
            "includeDistractors": True,
            "includeVideos": bool(spec.get("includeVideos", False)),
            "videoFrameSamples": int(spec.get("videoFrameSamples", 4)),
            "videoFrameIntervalSeconds": float(spec.get("videoFrameIntervalSeconds", 2.0)),
            "downloadIfMissing": False,
            "entryBudget": int(args.entry_budget),
        }
        result = api.public_dataset_model_comparison(params)
        result["benchmarkNote"] = spec.get("note", "")
        dataset_payloads.append(result)
        rows.extend(_rows_from_model_comparison(result))

    before_after = _before_after_rows(rows, baseline_pack=args.baseline_pack, candidate_pack=args.candidate_pack)
    gates = evaluate_dataset_gates(rows)
    model_matrix = model_pack_quality_matrix(rows, current_pack=args.baseline_pack)
    calibration_pack = str(model_matrix.get("recommendedPack") or args.candidate_pack or args.baseline_pack)
    calibration_rows = [row for row in rows if row.get("pack") == calibration_pack] or rows
    labels = labels_from_benchmark_rows(calibration_rows)
    calibration = calibrate_public_labels(labels) if labels else None
    if calibration is not None:
        calibration["pack"] = calibration_pack
    payload = {
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "workspace": str(api.project.root),
        "registry": str(registry_root),
        "profile": args.profile,
        "profileConfig": _profile_config(args),
        "packs": args.packs,
        "baselinePack": args.baseline_pack,
        "candidatePack": args.candidate_pack,
        "datasets": dataset_payloads,
        "rows": rows,
        "beforeAfter": before_after,
        "regressionGates": gates,
        "modelPackMatrix": model_matrix,
        "thresholdCalibration": calibration,
    }
    json_path = results_dir / f"public-dataset-benchmark-{stamp}.json"
    md_path = results_dir / f"public-dataset-benchmark-{stamp}.md"
    latest_json = results_dir / "public-dataset-benchmark-latest.json"
    latest_md = results_dir / "public-dataset-benchmark-latest.md"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    latest_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    markdown = _markdown_report(payload)
    md_path.write_text(markdown, encoding="utf-8")
    latest_md.write_text(markdown, encoding="utf-8")
    print(json.dumps({"json": str(json_path), "markdown": str(md_path), "rows": len(rows), "beforeAfter": len(before_after)}, indent=2))


def _profile_config(args: argparse.Namespace) -> dict[str, int | str]:
    profile = BENCHMARK_PROFILES.get(str(args.profile), BENCHMARK_PROFILES["standard"])
    return {
        "profile": str(args.profile),
        "maxIdentities": max(2, int(args.max_identities if args.max_identities is not None else profile["maxIdentities"])),
        "negativeIdentities": max(0, int(args.negative_identities if args.negative_identities is not None else profile["negativeIdentities"])),
        "candidateImages": max(1, int(args.candidate_images if args.candidate_images is not None else profile["candidateImages"])),
    }


def _resolve_dataset_spec(dataset_id: str, spec: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    resolved = dict(spec)
    profile = _profile_config(args)
    max_identities = int(profile["maxIdentities"])
    negative_identities = int(profile["negativeIdentities"])
    if not resolved.get("manual"):
        resolved["maxIdentities"] = max_identities
        resolved["negativeIdentities"] = negative_identities
    else:
        resolved["maxIdentities"] = int(args.max_identities if args.max_identities is not None else resolved.get("maxIdentities", max_identities))
        resolved["negativeIdentities"] = int(args.negative_identities if args.negative_identities is not None else resolved.get("negativeIdentities", negative_identities))
    if args.reference_images is not None:
        resolved["referenceImages"] = max(1, int(args.reference_images))
    if args.candidate_images is not None:
        resolved["candidateImages"] = max(1, int(args.candidate_images))
    elif not resolved.get("manual"):
        resolved["candidateImages"] = int(profile["candidateImages"])
    if "sliceImages" in resolved:
        image_count = max(2, int(args.images_per_identity if args.images_per_identity is not None else resolved["sliceImages"]))
        total_identities = int(resolved["maxIdentities"]) + int(resolved["negativeIdentities"])
        resolved["folder"] = Path(f"benchmarks/public-data/prepared/{dataset_id}-{total_identities}x{image_count}")
        resolved["sliceImages"] = image_count
    return resolved


def _rows_from_model_comparison(result: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    dataset_id = str(result.get("datasetId") or "")
    dataset_folder = str(result.get("datasetFolder") or "")
    for pack in result.get("packs", []):
        if not isinstance(pack, dict):
            continue
        metrics = pack.get("metrics") if isinstance(pack.get("metrics"), dict) else {}
        likely = pack.get("metricsByThreshold", {}).get("likely", {}) if isinstance(pack.get("metricsByThreshold"), dict) else {}
        matrix = pack.get("validationMatrix") if isinstance(pack.get("validationMatrix"), dict) else {}
        pipeline = pack.get("pipeline") if isinstance(pack.get("pipeline"), dict) else {}
        hard_negative = matrix.get("hard-negative:family-lookalike", {}) if isinstance(matrix.get("hard-negative:family-lookalike"), dict) else {}
        rows.append(
            {
                "datasetId": dataset_id,
                "folder": dataset_folder,
                "pack": pack.get("pack", ""),
                "label": pack.get("label", ""),
                "status": pack.get("status", ""),
                "engine": pack.get("engine", ""),
                "evaluated": int(metrics.get("evaluated", 0) or 0),
                "precision": _metric(metrics, "precision"),
                "recall": _metric(metrics, "recall"),
                "specificity": _metric(metrics, "specificity"),
                "accuracy": _metric(metrics, "accuracy"),
                "likelyPrecision": _metric(likely, "precision"),
                "likelyRecall": _metric(likely, "recall"),
                "falsePositives": int(metrics.get("falsePositives", 0) or 0),
                "falseNegatives": int(metrics.get("falseNegatives", 0) or 0),
                "wrongIdentity": int(metrics.get("wrongIdentity", 0) or 0),
                "expectedMatchRecall": _matrix_metric(matrix, "expected:match", "recall"),
                "crossAgeRecall": _matrix_metric(matrix, "age:cross-age", "recall"),
                "profileRecall": _matrix_metric(matrix, "pose:profile", "recall"),
                "videoRecall": _matrix_metric(matrix, "media:video", "recall"),
                "hardNegativeFalsePositives": int(hard_negative.get("falsePositives", 0) or 0),
                "hardNegativeWrongIdentity": int(hard_negative.get("wrongIdentity", 0) or 0),
                "videoDecodeFailures": len(pipeline.get("videoDecodeFailures") or []),
                "reportPath": pack.get("reportPath", ""),
                "error": pack.get("error", ""),
            }
        )
    return rows


def _before_after_rows(rows: list[dict[str, Any]], *, baseline_pack: str, candidate_pack: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    datasets = sorted({str(row.get("datasetId") or "") for row in rows if row.get("datasetId")})
    for dataset_id in datasets:
        baseline = _find_row(rows, dataset_id, baseline_pack)
        candidate = _find_row(rows, dataset_id, candidate_pack)
        if not baseline or not candidate:
            continue
        result.append(
            {
                "datasetId": dataset_id,
                "beforePack": baseline_pack,
                "afterPack": candidate_pack,
                "beforeStatus": baseline.get("status", ""),
                "afterStatus": candidate.get("status", ""),
                "beforeEvaluated": baseline.get("evaluated", 0),
                "afterEvaluated": candidate.get("evaluated", 0),
                "precisionBefore": baseline.get("precision"),
                "precisionAfter": candidate.get("precision"),
                "precisionDelta": _delta(candidate.get("precision"), baseline.get("precision")),
                "recallBefore": baseline.get("recall"),
                "recallAfter": candidate.get("recall"),
                "recallDelta": _delta(candidate.get("recall"), baseline.get("recall")),
                "accuracyBefore": baseline.get("accuracy"),
                "accuracyAfter": candidate.get("accuracy"),
                "accuracyDelta": _delta(candidate.get("accuracy"), baseline.get("accuracy")),
            }
        )
    return result


def _find_row(rows: list[dict[str, Any]], dataset_id: str, pack: str) -> dict[str, Any] | None:
    for row in rows:
        if row.get("datasetId") == dataset_id and row.get("pack") == pack:
            return row
    return None


def _skipped_row(dataset_id: str, folder: str, note: str) -> dict[str, Any]:
    return {
        "datasetId": dataset_id,
        "folder": folder,
        "pack": "",
        "label": "",
        "status": "skipped",
        "engine": "",
        "evaluated": 0,
        "precision": None,
        "recall": None,
        "specificity": None,
        "accuracy": None,
        "likelyPrecision": None,
        "likelyRecall": None,
        "falsePositives": 0,
        "falseNegatives": 0,
        "wrongIdentity": 0,
        "expectedMatchRecall": None,
        "crossAgeRecall": None,
        "profileRecall": None,
        "videoRecall": None,
        "hardNegativeFalsePositives": 0,
        "hardNegativeWrongIdentity": 0,
        "videoDecodeFailures": 0,
        "reportPath": "",
        "error": note,
    }


def _metric(metrics: dict[str, Any], key: str) -> float | None:
    value = metrics.get(key)
    return round(float(value), 6) if isinstance(value, (int, float)) else None


def _matrix_metric(matrix: dict[str, Any], bucket: str, key: str) -> float | None:
    row = matrix.get(bucket) if isinstance(matrix, dict) else None
    if not isinstance(row, dict):
        return None
    value = row.get(key)
    return round(float(value), 6) if isinstance(value, (int, float)) else None


def _delta(after: Any, before: Any) -> float | None:
    if not isinstance(after, (int, float)) or not isinstance(before, (int, float)):
        return None
    return round(float(after) - float(before), 6)


def _markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# Public Dataset Benchmark",
        "",
        f"Generated: {payload.get('generatedAt', '')}",
        f"Workspace: `{payload.get('workspace', '')}`",
        f"Profile: `{payload.get('profile', 'standard')}`",
        f"Model packs: `{', '.join(str(item) for item in payload.get('packs', []))}`",
        "",
        "## Before vs After",
        "",
        _markdown_table(
            ["Dataset", "Before", "After", "Eval", "Precision", "Recall", "Accuracy"],
            [
                [
                    row["datasetId"],
                    f"{row['beforePack']} ({row['beforeStatus']})",
                    f"{row['afterPack']} ({row['afterStatus']})",
                    f"{row['beforeEvaluated']} -> {row['afterEvaluated']}",
                    _format_delta(row["precisionBefore"], row["precisionAfter"], row["precisionDelta"]),
                    _format_delta(row["recallBefore"], row["recallAfter"], row["recallDelta"]),
                    _format_delta(row["accuracyBefore"], row["accuracyAfter"], row["accuracyDelta"]),
                ]
                for row in payload.get("beforeAfter", [])
            ],
        ),
        "",
        "## Dataset x Model Pack",
        "",
        _markdown_table(
            [
                "Dataset",
                "Pack",
                "Status",
                "Eval",
                "Precision",
                "Recall",
                "Cross-age",
                "Profile",
                "Video",
                "FP",
                "FN",
                "Wrong ID",
                "Lookalike FP",
                "Video decode fail",
            ],
            [
                [
                    row.get("datasetId", ""),
                    row.get("pack", "") or "-",
                    row.get("status", ""),
                    row.get("evaluated", 0),
                    _fmt(row.get("precision")),
                    _fmt(row.get("recall")),
                    _fmt(row.get("crossAgeRecall")),
                    _fmt(row.get("profileRecall")),
                    _fmt(row.get("videoRecall")),
                    row.get("falsePositives", 0),
                    row.get("falseNegatives", 0),
                    row.get("wrongIdentity", 0),
                    row.get("hardNegativeFalsePositives", 0),
                    row.get("videoDecodeFailures", 0),
                ]
                for row in payload.get("rows", [])
            ],
        ),
        "",
        "## Regression Gates",
        "",
        _markdown_table(
            ["Dataset", "Status", "Pack", "Summary"],
            [
                [
                    row.get("datasetId", ""),
                    row.get("status", ""),
                    row.get("pack", "") or "-",
                    row.get("summary", ""),
                ]
                for row in ((payload.get("regressionGates") or {}).get("gates", []) if isinstance(payload.get("regressionGates"), dict) else [])
            ],
        ),
        "",
        "## Threshold Calibration",
        "",
        _threshold_calibration_markdown(payload.get("thresholdCalibration")),
        "",
        "## Model Pack Matrix",
        "",
        _model_matrix_markdown(payload.get("modelPackMatrix")),
        "",
        "## Report Paths",
        "",
    ]
    for row in payload.get("rows", []):
        report = str(row.get("reportPath") or "")
        if report:
            lines.append(f"- {row.get('datasetId')} / {row.get('pack')}: `{report}`")
        elif row.get("error"):
            lines.append(f"- {row.get('datasetId')}: {row.get('error')}")
    lines.append("")
    return "\n".join(lines)


def _threshold_calibration_markdown(calibration: Any) -> str:
    if not isinstance(calibration, dict):
        return "No labels were available for threshold calibration."
    recommended = calibration.get("recommendedThresholds", {}) if isinstance(calibration.get("recommendedThresholds"), dict) else {}
    overall = calibration.get("overall", {}) if isinstance(calibration.get("overall"), dict) else {}
    likely = overall.get("recommendedLikely", {}) if isinstance(overall.get("recommendedLikely"), dict) else {}
    lines = [
        f"Pack: `{calibration.get('pack') or '-'}`",
        f"Labels: {calibration.get('labelCount', 0)} ({calibration.get('positiveCount', 0)} match / {calibration.get('negativeCount', 0)} non-match)",
        "",
        _markdown_table(
            ["Threshold", "Value", "Precision", "Recall", "FP", "FN", "Wrong ID"],
            [
                [
                    "Review more",
                    _fmt(recommended.get("reviewMore")),
                    _fmt((overall.get("recommendedReviewMore") or {}).get("precision") if isinstance(overall.get("recommendedReviewMore"), dict) else None),
                    _fmt((overall.get("recommendedReviewMore") or {}).get("recall") if isinstance(overall.get("recommendedReviewMore"), dict) else None),
                    (overall.get("recommendedReviewMore") or {}).get("falsePositives", "-") if isinstance(overall.get("recommendedReviewMore"), dict) else "-",
                    (overall.get("recommendedReviewMore") or {}).get("falseNegatives", "-") if isinstance(overall.get("recommendedReviewMore"), dict) else "-",
                    (overall.get("recommendedReviewMore") or {}).get("wrongIdentity", "-") if isinstance(overall.get("recommendedReviewMore"), dict) else "-",
                ],
                [
                    "Likely",
                    _fmt(recommended.get("likely")),
                    _fmt(likely.get("precision")),
                    _fmt(likely.get("recall")),
                    likely.get("falsePositives", "-"),
                    likely.get("falseNegatives", "-"),
                    likely.get("wrongIdentity", "-"),
                ],
                [
                    "Strong",
                    _fmt(recommended.get("strong")),
                    _fmt((overall.get("recommendedStrong") or {}).get("precision") if isinstance(overall.get("recommendedStrong"), dict) else None),
                    _fmt((overall.get("recommendedStrong") or {}).get("recall") if isinstance(overall.get("recommendedStrong"), dict) else None),
                    (overall.get("recommendedStrong") or {}).get("falsePositives", "-") if isinstance(overall.get("recommendedStrong"), dict) else "-",
                    (overall.get("recommendedStrong") or {}).get("falseNegatives", "-") if isinstance(overall.get("recommendedStrong"), dict) else "-",
                    (overall.get("recommendedStrong") or {}).get("wrongIdentity", "-") if isinstance(overall.get("recommendedStrong"), dict) else "-",
                ],
            ],
        ),
        "",
        "Recommendations:",
    ]
    for item in calibration.get("recommendations", [])[:6]:
        lines.append(f"- {item}")
    return "\n".join(lines)


def _model_matrix_markdown(matrix: Any) -> str:
    if not isinstance(matrix, dict):
        return "No completed model comparison rows were available."
    lines = [
        f"Recommended: `{matrix.get('recommendedPack') or '-'}` ({matrix.get('status', 'unknown')})",
        "",
        _markdown_table(
            ["Pack", "Datasets", "Eval", "Score", "Precision", "Recall", "Profile", "Cross-age", "Wrong ID", "Lookalike FP"],
            [
                [
                    row.get("pack", ""),
                    row.get("datasets", 0),
                    row.get("evaluated", 0),
                    _fmt(row.get("score")),
                    _fmt(row.get("precision")),
                    _fmt(row.get("recall")),
                    _fmt(row.get("profileRecall")),
                    _fmt(row.get("crossAgeRecall")),
                    row.get("wrongIdentity", 0),
                    row.get("hardNegativeFalsePositives", 0),
                ]
                for row in matrix.get("packs", [])
            ],
        ),
    ]
    for item in matrix.get("recommendations", [])[:4]:
        lines.append(f"- {item}")
    return "\n".join(lines)


def _markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    if not rows:
        rows = [["-" for _ in headers]]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return "\n".join(lines)


def _format_delta(before: Any, after: Any, delta: Any) -> str:
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)) or not isinstance(delta, (int, float)):
        return "-"
    sign = "+" if delta >= 0 else ""
    return f"{before:.3f} -> {after:.3f} ({sign}{delta:.3f})"


def _fmt(value: Any) -> str:
    return f"{float(value):.3f}" if isinstance(value, (int, float)) else "-"


if __name__ == "__main__":
    main()
