from __future__ import annotations

import base64
from importlib import metadata
from pathlib import Path
import platform
import sys
from typing import Any

import numpy as np


EXPECTED_ONNXRUNTIME_VERSION = "1.27.0"
_PROBE_MODEL = base64.b64decode(
    "CAgSCHZpbnRyYWNlOkgKEAoBeBIBeSIISWRlbnRpdHkSEnZpbnRyYWNlLW9ydC1wcm9iZVoPCgF4EgoKCAgBEgQKAggCYg8KAXkSCgoICAESBAoCCAJCBAoAEA0="
)
_CONFLICTING_DISTRIBUTIONS = (
    "onnxruntime-gpu",
    "onnxruntime-openvino",
    "onnxruntime-training",
    "onnxruntime-training-cpu",
)


def _installed_version(distribution: str) -> str:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return ""


def onnxruntime_runtime_report(
    *, expected_version: str = EXPECTED_ONNXRUNTIME_VERSION
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "expectedVersion": expected_version,
        "packageVersion": "",
        "runtimeVersion": "",
        "providers": [],
        "requiredProviders": ["CPUExecutionProvider"],
        "conflictingDistributions": {},
        "nativeModule": "",
        "nativeModulePresent": False,
        "inferenceOutput": [],
        "platform": sys.platform,
        "machine": platform.machine().lower(),
        "python": platform.python_version(),
        "frozen": bool(getattr(sys, "frozen", False)),
        "ok": False,
        "error": "",
    }
    if sys.platform == "darwin" and report["machine"] == "arm64":
        report["requiredProviders"].append("CoreMLExecutionProvider")

    try:
        import onnxruntime as ort  # type: ignore
        from onnxruntime.capi import onnxruntime_pybind11_state  # type: ignore

        report["packageVersion"] = _installed_version("onnxruntime")
        report["runtimeVersion"] = str(getattr(ort, "__version__", ""))
        report["providers"] = list(ort.get_available_providers())
        report["conflictingDistributions"] = {
            name: version
            for name in _CONFLICTING_DISTRIBUTIONS
            if (version := _installed_version(name))
        }

        native_module = Path(str(getattr(onnxruntime_pybind11_state, "__file__", "")))
        report["nativeModule"] = str(native_module)
        report["nativeModulePresent"] = (
            native_module.is_file()
            and native_module.name.lower().endswith((".so", ".pyd", ".dylib"))
        )

        session_options = ort.SessionOptions()
        session_options.log_severity_level = 3
        session = ort.InferenceSession(
            _PROBE_MODEL,
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )
        expected = np.asarray([0.25, -1.5], dtype=np.float32)
        output = np.asarray(session.run(["y"], {"x": expected})[0], dtype=np.float32)
        report["inferenceOutput"] = [float(value) for value in output.tolist()]
        providers_ready = all(
            provider in report["providers"] for provider in report["requiredProviders"]
        )
        report["ok"] = bool(
            report["packageVersion"] == expected_version
            and report["runtimeVersion"] == expected_version
            and not report["conflictingDistributions"]
            and report["nativeModulePresent"]
            and providers_ready
            and output.shape == expected.shape
            and np.array_equal(output, expected)
        )
        if not report["ok"]:
            report["error"] = "ONNX Runtime did not satisfy the pinned runtime contract."
    except Exception as exc:  # pragma: no cover - exercised by frozen/CI failure paths
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report
