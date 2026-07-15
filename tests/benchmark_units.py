"""Unit tests for benchmark honesty helpers (Phase 0.5).

Run: PYTHONPATH=. .venv/bin/python tests/benchmark_units.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import os
import tempfile

from crossage_fr.benchmark_quality import BENCHMARK_DISCLAIMER, wilson_interval


def _load_public_dataset_runner():
    root = Path(__file__).resolve().parents[1]
    module_path = root / "benchmarks" / "run_public_dataset_benchmarks.py"
    spec = importlib.util.spec_from_file_location("run_public_dataset_benchmarks_for_test", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_wilson_interval_brackets_point_estimate() -> None:
    lo, hi = wilson_interval(8, 10)
    assert 0.0 <= lo <= 0.8 <= hi <= 1.0


def test_wilson_interval_no_data_is_maximally_uncertain() -> None:
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_wilson_interval_tightens_with_sample_size() -> None:
    small = wilson_interval(8, 10)
    large = wilson_interval(800, 1000)
    assert (large[1] - large[0]) < (small[1] - small[0])


def test_wilson_interval_is_clamped() -> None:
    lo, hi = wilson_interval(10, 10)
    assert 0.0 <= lo <= hi <= 1.0


def test_disclaimer_is_honest() -> None:
    assert isinstance(BENCHMARK_DISCLAIMER, str)
    assert "closed-set" in BENCHMARK_DISCLAIMER.lower()


def test_public_dataset_runner_resolves_prepared_folders_from_repo_root() -> None:
    runner = _load_public_dataset_runner()
    args = SimpleNamespace(
        profile="standard",
        max_identities=None,
        negative_identities=None,
        reference_images=None,
        candidate_images=None,
        images_per_identity=None,
    )
    previous_cwd = Path.cwd()
    with tempfile.TemporaryDirectory() as tmp:
        try:
            os.chdir(tmp)
            resolved = runner._resolve_dataset_spec("calfw", runner.DATASET_RUNS["calfw"], args)
            folder = runner._resolve_repo_path(resolved["folder"]).resolve()
        finally:
            os.chdir(previous_cwd)
    assert folder == (runner.REPO_ROOT / "benchmarks/public-data/prepared/calfw-40x4").resolve()


def test_public_dataset_latest_pointer_matches_newest_run() -> None:
    root = Path(__file__).resolve().parents[1]
    results_dir = root / "benchmarks" / "results"
    dated_json_reports = []
    for report in results_dir.glob("public-dataset-benchmark-*.json"):
        match = re.fullmatch(r"public-dataset-benchmark-(\d{8}-\d{6})\.json", report.name)
        if match:
            dated_json_reports.append((match.group(1), report))
    assert dated_json_reports, "expected at least one dated public-dataset benchmark report"

    newest_json = max(dated_json_reports, key=lambda item: item[0])[1]
    newest_md = newest_json.with_suffix(".md")
    latest_json = results_dir / "public-dataset-benchmark-latest.json"
    latest_md = results_dir / "public-dataset-benchmark-latest.md"

    assert latest_md.read_text(encoding="utf-8") == newest_md.read_text(encoding="utf-8")
    assert json.loads(latest_json.read_text(encoding="utf-8"))["generatedAt"] == json.loads(newest_json.read_text(encoding="utf-8"))["generatedAt"]


def main() -> None:
    test_wilson_interval_brackets_point_estimate()
    test_wilson_interval_no_data_is_maximally_uncertain()
    test_wilson_interval_tightens_with_sample_size()
    test_wilson_interval_is_clamped()
    test_disclaimer_is_honest()
    test_public_dataset_runner_resolves_prepared_folders_from_repo_root()
    test_public_dataset_latest_pointer_matches_newest_run()
    print("benchmark units ok")


if __name__ == "__main__":
    main()
