from __future__ import annotations

import math
import socket
import sys

import numpy as np

from crossage_fr.dependency_currency import (
    EXPECTED_ONNXRUNTIME_VERSION,
    onnxruntime_runtime_report,
)
from crossage_fr.embed.fiqa import find_fiqa_model, load_fiqa_scorer


def test_onnxruntime_native_runtime_and_cpu_inference() -> None:
    report = onnxruntime_runtime_report()
    assert report["ok"] is True, report
    assert report["packageVersion"] == EXPECTED_ONNXRUNTIME_VERSION, report
    assert report["runtimeVersion"] == EXPECTED_ONNXRUNTIME_VERSION, report
    assert report["conflictingDistributions"] == {}, report
    assert "CPUExecutionProvider" in report["providers"], report
    assert report["nativeModulePresent"] is True, report
    assert report["inferenceOutput"] == [0.25, -1.5], report
    if sys.platform == "darwin" and report["machine"] == "arm64":
        assert "CoreMLExecutionProvider" in report["providers"], report


def test_runtime_contract_fails_closed_on_version_drift() -> None:
    report = onnxruntime_runtime_report(expected_version="0.0.0-test")
    assert report["ok"] is False, report
    assert "pinned runtime contract" in report["error"], report


def test_bundled_fiqa_model_runs_offline_on_current_runtime() -> None:
    model = find_fiqa_model()
    assert model is not None, "The bundled FIQA model is required for the runtime upgrade gate."
    original_socket = socket.socket
    original_connection = socket.create_connection

    def blocked(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("Dependency-currency inference attempted network access.")

    socket.socket = blocked  # type: ignore[assignment]
    socket.create_connection = blocked  # type: ignore[assignment]
    try:
        scorer = load_fiqa_scorer(model)
        assert scorer is not None
        score = scorer.score_aligned(np.zeros((112, 112, 3), dtype=np.uint8))
    finally:
        socket.socket = original_socket  # type: ignore[assignment]
        socket.create_connection = original_connection  # type: ignore[assignment]
    assert math.isfinite(score) and 0.0 <= score <= 1.0, score


def main() -> None:
    test_onnxruntime_native_runtime_and_cpu_inference()
    test_runtime_contract_fails_closed_on_version_drift()
    test_bundled_fiqa_model_runs_offline_on_current_runtime()
    print("dependency currency units ok")


if __name__ == "__main__":
    main()
