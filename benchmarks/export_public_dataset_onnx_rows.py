from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence
import argparse
import hashlib
import json
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from crossage_fr.experiments import onnx_training
from crossage_fr.match import adapters as match_adapters


EXAMPLES_FILENAME = "public-dataset-onnx-examples.json"
SUMMARY_FILENAME = "public-dataset-onnx-row-export.json"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export public benchmark labels into Phase 5 ONNX train/validation rows."
    )
    parser.add_argument(
        "sources",
        nargs="+",
        help="public-dataset-labels.json, public-dataset-benchmark.json, model comparison JSON, or latest public benchmark JSON.",
    )
    parser.add_argument("--output", required=True, help="Directory for examples, split rows, and summary.")
    parser.add_argument("--datasets", nargs="*", default=[], help="Optional dataset ids to keep, for example calfw cplfw.")
    parser.add_argument("--pack", default="", help="Model pack to pick from comparison/latest reports.")
    parser.add_argument("--model-name", default="", help="Model name recorded on exported rows. Defaults to selected pack.")
    parser.add_argument("--validation-fraction", type=float, default=0.25)
    parser.add_argument("--min-training-count", type=int, default=20)
    parser.add_argument("--min-validation-count", type=int, default=20)
    parser.add_argument("--min-per-class", type=int, default=5)
    args = parser.parse_args(list(argv if argv is not None else sys.argv[1:]))
    try:
        result = export_public_dataset_onnx_rows(
            args.sources,
            args.output,
            datasets=args.datasets,
            pack=args.pack,
            model_name=args.model_name,
            validation_fraction=args.validation_fraction,
            min_training_count=args.min_training_count,
            min_validation_count=args.min_validation_count,
            min_per_class=args.min_per_class,
        )
    except (FileNotFoundError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 2
    print(json.dumps(_summary_for_stdout(result), indent=2, sort_keys=True))
    return 0


def export_public_dataset_onnx_rows(
    sources: Sequence[str | Path],
    output_dir: str | Path,
    *,
    datasets: Sequence[str] | None = None,
    pack: str = "",
    model_name: str = "",
    validation_fraction: float = 0.25,
    min_training_count: int = 20,
    min_validation_count: int = 20,
    min_per_class: int = 5,
) -> dict[str, Any]:
    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    dataset_filter = {str(item).strip().casefold() for item in datasets or [] if str(item).strip()}
    selected_pack = str(pack or "").strip()
    label_sources = _collect_label_sources(sources, datasets=dataset_filter, pack=selected_pack)
    if not label_sources:
        raise ValueError("No public dataset label sources were found.")
    rows, row_sources = _rows_from_label_sources(label_sources, model_name=model_name or selected_pack)
    if not rows:
        raise ValueError("No usable public dataset labels were found.")
    effective_model = str(model_name or selected_pack or _dominant_pack(label_sources) or "public-benchmark")
    examples_path = output / EXAMPLES_FILENAME
    examples_payload = {
        "schemaVersion": 1,
        "scope": "phase5-onnx-training-public-benchmark-examples",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "notProductionTrainingData": True,
        "publicBenchmarkOnly": True,
        "trainingUseAllowed": False,
        "modelName": effective_model,
        "sourceKind": "public-dataset-benchmark-labels",
        "sourceReports": row_sources,
        "examples": rows,
    }
    examples_path.write_text(json.dumps(examples_payload, indent=2, sort_keys=True), encoding="utf-8")
    split = onnx_training.split_reviewed_training_examples(
        examples_path,
        output / "split",
        validation_fraction=validation_fraction,
        model_name=effective_model,
        min_training_count=min_training_count,
        min_validation_count=min_validation_count,
        min_per_class=min_per_class,
        split_salt="phase5-onnx-training-public-benchmark-split-v1",
    )
    manifest = split.get("manifest") if isinstance(split.get("manifest"), dict) else {}
    summary = {
        "schemaVersion": 1,
        "scope": "phase5-onnx-training-public-benchmark-export",
        "generatedAt": examples_payload["generatedAt"],
        "notProductionTrainingData": True,
        "publicBenchmarkOnly": True,
        "trainingUseAllowed": False,
        "sourceCount": len(label_sources),
        "rowCount": len(rows),
        "classCounts": _label_counts(rows),
        "datasets": sorted({str(source["datasetId"]) for source in label_sources if source.get("datasetId")}),
        "packs": sorted({str(source["pack"]) for source in label_sources if source.get("pack")}),
        "examplesPath": str(examples_path),
        "split": {
            "outputDir": split["outputDir"],
            "trainingRowsPath": split["trainingRowsPath"],
            "validationRowsPath": split["validationRowsPath"],
            "manifestPath": split["manifestPath"],
            "reportHash": manifest.get("reportHash", ""),
            "training": manifest.get("training", {}).get("classCounts", {}) if isinstance(manifest.get("training"), dict) else {},
            "validation": manifest.get("validation", {}).get("classCounts", {}) if isinstance(manifest.get("validation"), dict) else {},
            "privacy": manifest.get("privacy", {}) if isinstance(manifest.get("privacy"), dict) else {},
        },
        "sourceReports": row_sources,
    }
    summary_path = output / SUMMARY_FILENAME
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    return {
        "ok": True,
        "outputDir": str(output),
        "examplesPath": str(examples_path),
        "summaryPath": str(summary_path),
        "split": split,
        "summary": summary,
    }


def _collect_label_sources(
    sources: Sequence[str | Path],
    *,
    datasets: set[str],
    pack: str,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in sources:
        path = Path(source).expanduser().resolve()
        payload = _read_json_object(path)
        for record in _label_sources_from_payload(path, payload, datasets=datasets, pack=pack):
            key = str(Path(str(record["labelsPath"])).expanduser().resolve())
            if key in seen:
                continue
            seen.add(key)
            collected.append(record)
    return collected


def _label_sources_from_payload(
    path: Path,
    payload: dict[str, Any],
    *,
    datasets: set[str],
    pack: str,
) -> list[dict[str, Any]]:
    if isinstance(payload.get("labels"), list):
        dataset_id = str(payload.get("datasetId") or _dataset_id_from_path(path) or "").strip()
        if datasets and dataset_id.casefold() not in datasets:
            return []
        return [
            {
                "datasetId": dataset_id,
                "pack": pack,
                "labelsPath": str(path),
                "reportPath": "",
                "sourcePath": str(path),
            }
        ]
    labels_path = str(payload.get("labelsJsonPath") or "").strip()
    if labels_path:
        dataset_id = str(payload.get("datasetId") or _dataset_id_from_path(path) or "").strip()
        if datasets and dataset_id.casefold() not in datasets:
            return []
        return [
            {
                "datasetId": dataset_id,
                "pack": pack,
                "labelsPath": str(_resolve_related_path(labels_path, path)),
                "reportPath": str(path),
                "sourcePath": str(path),
            }
        ]
    raw_datasets = payload.get("datasets")
    if isinstance(raw_datasets, list):
        result: list[dict[str, Any]] = []
        for dataset in raw_datasets:
            if not isinstance(dataset, dict):
                continue
            result.extend(_label_sources_from_comparison(path, dataset, datasets=datasets, pack=pack))
        return result
    if isinstance(payload.get("packs"), list):
        return _label_sources_from_comparison(path, payload, datasets=datasets, pack=pack)
    return []


def _label_sources_from_comparison(
    path: Path,
    payload: dict[str, Any],
    *,
    datasets: set[str],
    pack: str,
) -> list[dict[str, Any]]:
    dataset_id = str(payload.get("datasetId") or _dataset_id_from_path(path) or "").strip()
    if datasets and dataset_id.casefold() not in datasets:
        return []
    packs = payload.get("packs") if isinstance(payload.get("packs"), list) else []
    selected = _choose_pack_row(packs, requested_pack=pack, recommended_pack=str(payload.get("recommendedPack") or ""))
    if not selected:
        raise ValueError(f"No complete pack row found for dataset {dataset_id or path.name}.")
    report_path_raw = str(selected.get("reportPath") or "").strip()
    if not report_path_raw:
        raise ValueError(f"Selected pack for dataset {dataset_id or path.name} has no reportPath.")
    report_path = _resolve_related_path(report_path_raw, path)
    report_payload = _read_json_object(report_path)
    labels_path = str(report_payload.get("labelsJsonPath") or "").strip()
    if not labels_path:
        raise ValueError(f"Public dataset report has no labelsJsonPath: {report_path}")
    return [
        {
            "datasetId": str(report_payload.get("datasetId") or dataset_id),
            "pack": str(selected.get("pack") or pack),
            "labelsPath": str(_resolve_related_path(labels_path, report_path)),
            "reportPath": str(report_path),
            "sourcePath": str(path),
        }
    ]


def _choose_pack_row(packs: Sequence[Any], *, requested_pack: str, recommended_pack: str) -> dict[str, Any] | None:
    complete = [row for row in packs if isinstance(row, dict) and str(row.get("status") or "") == "complete"]
    if requested_pack:
        return next((row for row in complete if str(row.get("pack") or "") == requested_pack), None)
    if recommended_pack:
        found = next((row for row in complete if str(row.get("pack") or "") == recommended_pack), None)
        if found:
            return found
    return complete[0] if complete else None


def _rows_from_label_sources(
    label_sources: Sequence[dict[str, Any]],
    *,
    model_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    source_summaries: list[dict[str, Any]] = []
    for source in label_sources:
        labels_path = Path(str(source["labelsPath"])).expanduser().resolve()
        payload = _read_json_object(labels_path)
        labels = payload.get("labels") if isinstance(payload.get("labels"), list) else []
        dataset_id = str(source.get("datasetId") or payload.get("datasetId") or _dataset_id_from_path(labels_path) or "").strip()
        pack = str(source.get("pack") or model_name or "").strip()
        converted = [
            _public_label_to_row(label, index, dataset_id=dataset_id, pack=pack, model_name=model_name or pack)
            for index, label in enumerate(labels)
            if isinstance(label, dict)
        ]
        rows.extend(converted)
        source_summaries.append(
            {
                "datasetId": dataset_id,
                "pack": pack,
                "labelsPath": str(labels_path),
                "reportPath": str(source.get("reportPath") or ""),
                "sourcePath": str(source.get("sourcePath") or ""),
                "rowCount": len(converted),
                "classCounts": _label_counts(converted),
            }
        )
    return rows, source_summaries


def _public_label_to_row(
    label: dict[str, Any],
    index: int,
    *,
    dataset_id: str,
    pack: str,
    model_name: str,
) -> dict[str, Any]:
    is_match = _bool_value(label.get("isMatch"))
    source_hash = str(label.get("sourceHash") or "").strip()
    if not source_hash:
        source_hash = hashlib.sha256(
            json.dumps(label, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
    score = _float_value(label.get("matchScore"), 1.0 if is_match else 0.0)
    raw_cosine = _float_value(label.get("rawCosine"), score)
    row_id = f"{dataset_id or 'public'}:{pack or model_name or 'pack'}:{source_hash[:24]}:{index}"
    validation_bucket = str(label.get("validationBucket") or "")
    difficulty = str(label.get("difficulty") or "")
    row = {
        "exampleId": row_id,
        "naturalKey": f"public-dataset:{row_id}",
        "candidateId": f"public:{row_id}",
        "sourceHash": source_hash,
        "expectedPerson": str(label.get("expectedPerson") or label.get("sourcePerson") or ""),
        "actualPerson": str(label.get("actualPerson") or ""),
        "isMatch": bool(is_match),
        "matchScore": max(0.0, min(1.0, score)),
        "rawCosine": max(-1.0, min(1.0, raw_cosine)),
        "quality": _float_value(label.get("quality"), 0.0),
        "modelName": model_name or pack,
        "mediaKind": str(label.get("mediaKind") or "image"),
        "poseBucket": str(label.get("poseBucket") or "unknown"),
        "ageBucket": str(label.get("ageBucket") or ""),
        "ageGapYears": 20.0 if "cross-age" in f"{validation_bucket} {difficulty}" else None,
        "validationBucket": str(label.get("validationBucket") or ""),
        "scenario": str(label.get("scenario") or ""),
        "difficulty": str(label.get("difficulty") or ""),
        "outcome": str(label.get("outcome") or ""),
        "datasetId": dataset_id,
        "pack": pack,
        "publicBenchmarkOnly": True,
        "notProductionTrainingData": True,
        "trainingUseAllowed": False,
        "features": _public_label_features(label),
    }
    row["trainingContext"] = match_adapters.pair_context(row)
    return row


def _public_label_features(label: dict[str, Any]) -> dict[str, Any]:
    features: dict[str, Any] = {}
    if label.get("validationBucket") == "pose:profile":
        features["riskFlags"] = ["single-reference-hard-pose"]
    if label.get("validationBucket") in {"pose:three-quarter", "pose:unknown"}:
        features["riskFlags"] = sorted(set(features.get("riskFlags", [])) | {"pose-reranked"})
    return features


def _label_counts(rows: Sequence[dict[str, Any]]) -> dict[str, int]:
    positive = sum(1 for row in rows if bool(row.get("isMatch")))
    negative = sum(1 for row in rows if not bool(row.get("isMatch")))
    return {"total": len(rows), "positive": positive, "negative": negative}


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError(f"JSON source is missing: {path}") from None
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"JSON source is invalid: {path}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON source must be an object: {path}")
    return payload


def _resolve_related_path(raw_path: str, base: Path) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (base.parent / path).resolve()


def _dataset_id_from_path(path: Path) -> str:
    for part in path.parts:
        lowered = part.casefold()
        for dataset_id in ("calfw", "cplfw", "agedb", "cfp", "fiw", "ytf", "lfw"):
            if lowered.startswith(dataset_id):
                return dataset_id
    return ""


def _dominant_pack(label_sources: Sequence[dict[str, Any]]) -> str:
    counts: dict[str, int] = {}
    for source in label_sources:
        pack = str(source.get("pack") or "").strip()
        if pack:
            counts[pack] = counts.get(pack, 0) + 1
    if not counts:
        return ""
    return sorted(counts, key=lambda key: (-counts[key], key))[0]


def _bool_value(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "match", "accepted"}
    return bool(value)


def _float_value(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _summary_for_stdout(result: dict[str, Any]) -> dict[str, Any]:
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    split = summary.get("split") if isinstance(summary.get("split"), dict) else {}
    return {
        "ok": bool(result.get("ok")),
        "outputDir": result.get("outputDir", ""),
        "examplesPath": result.get("examplesPath", ""),
        "summaryPath": result.get("summaryPath", ""),
        "rowCount": summary.get("rowCount", 0),
        "classCounts": summary.get("classCounts", {}),
        "datasets": summary.get("datasets", []),
        "packs": summary.get("packs", []),
        "trainingRowsPath": split.get("trainingRowsPath", ""),
        "validationRowsPath": split.get("validationRowsPath", ""),
        "manifestPath": split.get("manifestPath", ""),
        "training": split.get("training", {}),
        "validation": split.get("validation", {}),
    }


if __name__ == "__main__":
    raise SystemExit(main())
