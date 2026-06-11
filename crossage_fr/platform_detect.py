from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import os
import platform
import re
import struct
import subprocess
import ctypes
import resource
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class PlatformReport:
    platform_key: str
    system: str
    machine: str
    python_arch: str
    rosetta_translated: bool
    onnxruntime_available: bool
    available_providers: list[str]
    selected_providers: list[Any]
    primary_provider: str
    accelerator_status: str
    precision: str
    vector_backend: str
    platform_notes: list[str]
    cpu_logical_count: int
    memory_total_bytes: int
    performance_tier: str
    recommended_performance_mode: str
    performance_notes: list[str]
    insightface_available: bool
    faiss_available: bool
    hdbscan_available: bool


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def logical_cpu_count() -> int:
    return max(1, int(os.cpu_count() or 1))


def memory_total_bytes() -> int:
    system = platform.system().lower()
    if system == "windows":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.ullTotalPhys)
        except Exception:
            return 0
        return 0
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        if isinstance(pages, int) and isinstance(page_size, int):
            return int(pages * page_size)
    except (AttributeError, OSError, ValueError):
        return 0
    return 0


def memory_available_bytes() -> int:
    try:
        import psutil  # type: ignore

        return int(psutil.virtual_memory().available)
    except Exception:
        pass
    system = platform.system().lower()
    if system == "windows":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.ullAvailPhys)
        except Exception:
            return 0
        return 0
    if system == "linux":
        try:
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
        except (OSError, IndexError, ValueError):
            return 0
    if system == "darwin":
        try:
            output = subprocess.check_output(["vm_stat"], text=True, stderr=subprocess.DEVNULL)
            page_size = 4096
            first = output.splitlines()[0] if output else ""
            match = re.search(r"page size of (\d+) bytes", first)
            if match:
                page_size = int(match.group(1))
            pages = 0
            wanted = ("Pages free", "Pages inactive", "Pages speculative")
            for line in output.splitlines():
                if line.startswith(wanted):
                    pages += int(re.sub(r"[^0-9]", "", line.split(":", 1)[1]) or "0")
            return int(pages * page_size)
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            return 0
    return 0


def process_memory_bytes() -> int:
    try:
        import psutil  # type: ignore

        return int(psutil.Process(os.getpid()).memory_info().rss)
    except Exception:
        pass
    try:
        rss = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        return rss if platform.system().lower() == "darwin" else rss * 1024
    except Exception:
        return 0


def available_onnx_providers() -> list[str]:
    if not _module_available("onnxruntime"):
        return []
    import onnxruntime as ort

    return list(ort.get_available_providers())


def is_rosetta_translated() -> bool:
    if platform.system().lower() != "darwin":
        return False
    try:
        result = subprocess.run(
            ["sysctl", "-in", "sysctl.proc_translated"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except Exception:
        return False
    return result.stdout.strip() == "1"


def detect_platform() -> str:
    machine = platform.machine().lower()
    system = platform.system().lower()
    providers = available_onnx_providers()
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "apple_silicon"
    if system == "darwin" and is_rosetta_translated():
        return "apple_silicon_rosetta"
    if "TensorrtExecutionProvider" in providers or "CUDAExecutionProvider" in providers:
        return "nvidia"
    if system == "windows" and "DmlExecutionProvider" in providers:
        return "windows_directml"
    if "OpenVINOExecutionProvider" in providers:
        return "cpu_openvino"
    return "cpu"


def _cache_dir(name: str) -> str:
    configured = os.environ.get("CROSSAGE_ORT_CACHE")
    root = Path(configured).expanduser() if configured else Path.home() / ".cache" / "vintrace" / "onnxruntime"
    path = root / name
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return ""
    return str(path)


def get_providers(platform_key: str) -> list[Any]:
    providers = available_onnx_providers()
    if platform_key in {"apple_silicon", "apple_silicon_rosetta"}:
        coreml_options = {
            "ModelFormat": "MLProgram",
            "MLComputeUnits": "ALL",
            "RequireStaticInputShapes": "1",
            "EnableOnSubgraphs": "0",
        }
        cache_dir = _cache_dir("coreml")
        if cache_dir:
            coreml_options["ModelCacheDirectory"] = cache_dir
        coreml = ("CoreMLExecutionProvider", coreml_options)
        if "CoreMLExecutionProvider" in providers:
            return [coreml, "CPUExecutionProvider"]
        return ["CPUExecutionProvider"]
    if platform_key == "nvidia":
        selected: list[Any] = []
        if "TensorrtExecutionProvider" in providers:
            trt_options: dict[str, Any] = {
                "trt_fp16_enable": True,
                "trt_engine_cache_enable": True,
                "trt_timing_cache_enable": True,
            }
            cache_dir = _cache_dir("tensorrt")
            if cache_dir:
                trt_options["trt_engine_cache_path"] = cache_dir
                trt_options["trt_timing_cache_path"] = cache_dir
            selected.append(("TensorrtExecutionProvider", trt_options))
        if "CUDAExecutionProvider" in providers:
            selected.append(("CUDAExecutionProvider", {}))
        selected.append("CPUExecutionProvider")
        return selected
    if platform_key == "windows_directml":
        return ["DmlExecutionProvider", "CPUExecutionProvider"]
    if platform_key == "cpu_openvino":
        device_type = os.environ.get("CROSSAGE_OPENVINO_DEVICE", "AUTO:GPU,NPU,CPU")
        return [("OpenVINOExecutionProvider", {"device_type": device_type}), "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def split_provider_config(selected: list[Any]) -> tuple[list[str], list[dict[str, Any]] | None]:
    names: list[str] = []
    options: list[dict[str, Any]] = []
    has_options = False
    for value in selected:
        if isinstance(value, (tuple, list)) and value:
            names.append(str(value[0]))
            provider_options = dict(value[1]) if len(value) > 1 and isinstance(value[1], dict) else {}
            options.append(provider_options)
            has_options = has_options or bool(provider_options)
        else:
            names.append(str(value))
            options.append({})
    return names, options if has_options else None


def provider_label(value: Any) -> str:
    if isinstance(value, (tuple, list)) and value:
        return str(value[0])
    return str(value)


def expected_precision(platform_key: str) -> str:
    if platform_key == "nvidia":
        return "fp16-preferred"
    if platform_key in {"apple_silicon", "apple_silicon_rosetta"}:
        return "fp32-coreml-managed"
    if platform_key == "cpu_openvino":
        return "int8-openvino-capable"
    if platform_key == "windows_directml":
        return "fp32-directml"
    return "fp32-cpu"


def expected_vector_backend(platform_key: str) -> str:
    if platform_key == "nvidia" and _module_available("faiss"):
        return "faiss-gpu-if-installed-else-flat-ip"
    if _module_available("faiss"):
        return "faiss-cpu-flat-ip"
    return "numpy-flat-ip"


def platform_notes(platform_key: str, providers: list[str], selected: list[Any]) -> list[str]:
    notes: list[str] = []
    system = platform.system().lower()
    machine = platform.machine().lower()
    python_bits = struct.calcsize("P") * 8
    if platform_key == "apple_silicon_rosetta":
        notes.append("Apple Silicon is running under Rosetta; use native arm64 Python for CoreML/MPS reliability.")
    if system == "darwin" and machine not in {"arm64", "aarch64"} and not is_rosetta_translated():
        notes.append("Intel macOS detected; CoreML may be available but CPU fallback is the safe default.")
    if system == "windows" and platform_key == "cpu" and "DmlExecutionProvider" not in providers:
        notes.append("Windows CPU path selected; install a DirectML-enabled ONNX Runtime build only if GPU acceleration is required.")
    if platform_key == "cpu" and "OpenVINOExecutionProvider" not in providers:
        notes.append("CPU fallback selected; OpenVINO EP can accelerate supported Intel CPUs.")
    if platform_key == "nvidia" and "TensorrtExecutionProvider" not in providers:
        notes.append("CUDA EP selected without TensorRT; TensorRT FP16 can improve production throughput on NVIDIA.")
    if selected and provider_label(selected[0]) == "CPUExecutionProvider" and platform_key not in {"cpu"}:
        notes.append("Requested accelerator did not bind; pipeline remains functional on CPU.")
    if python_bits != 64:
        notes.append("64-bit Python is required for production model packs and vector search scale.")
    if os.environ.get("CROSSAGE_FORCE_FALLBACK") == "1":
        notes.append("Forced local fallback engine is enabled for deterministic tests.")
    return notes


def performance_profile(platform_key: str, providers: list[str], selected: list[Any]) -> tuple[str, str, list[str]]:
    cpu_count = logical_cpu_count()
    memory_bytes = memory_total_bytes()
    memory_gb = memory_bytes / (1024 ** 3) if memory_bytes else 0.0
    primary = provider_label(selected[0]) if selected else ""
    accelerated = primary and primary != "CPUExecutionProvider" and platform_key != "cpu"
    notes: list[str] = []
    if memory_bytes and memory_gb < 8:
        notes.append("Less than 8 GB RAM detected; Fast mode reduces thumbnails, page sizes, and scan detail.")
    if cpu_count <= 4:
        notes.append("4 or fewer logical CPU cores detected; Fast mode keeps scans responsive on lower-end PCs.")
    if not accelerated:
        notes.append("No active accelerator provider detected; CPU-friendly defaults are recommended.")
    if platform_key == "apple_silicon_rosetta":
        notes.append("Rosetta translation detected; use Fast or Balanced until native acceleration is available.")
    if not providers:
        notes.append("ONNX Runtime providers are unavailable; fallback matching should keep UI work conservative.")
    if (memory_bytes and memory_gb < 8) or (cpu_count <= 4 and not accelerated) or platform_key == "apple_silicon_rosetta":
        return "low", "fast", notes
    if accelerated and (not memory_bytes or memory_gb >= 16) and cpu_count >= 8:
        notes.append("Accelerated hardware with comfortable memory detected; Quality mode is available for maximum detail.")
        return "high", "quality", notes
    notes.append("Balanced performance profile selected for this machine.")
    return "standard", "balanced", notes


def build_platform_report() -> PlatformReport:
    key = detect_platform()
    providers = available_onnx_providers()
    selected = get_providers(key)
    primary = provider_label(selected[0]) if selected else "none"
    tier, recommended_mode, perf_notes = performance_profile(key, providers, selected)
    if not providers:
        status = "ONNX Runtime not installed; using local review/demo engine."
    elif key in {"apple_silicon", "apple_silicon_rosetta"} and "CoreMLExecutionProvider" not in providers:
        status = "Apple Silicon detected, but CoreML EP is unavailable; CPU fallback selected."
    elif key == "nvidia" and not any(p in providers for p in ("TensorrtExecutionProvider", "CUDAExecutionProvider")):
        status = "NVIDIA provider unavailable; CPU fallback selected."
    elif key == "windows_directml" and "DmlExecutionProvider" not in providers:
        status = "Windows DirectML provider unavailable; CPU fallback selected."
    elif key == "cpu_openvino" and "OpenVINOExecutionProvider" not in providers:
        status = "OpenVINO provider unavailable; CPU fallback selected."
    elif selected and primary == "CPUExecutionProvider" and key not in {"cpu"}:
        status = "Accelerator provider did not bind; CPU fallback selected."
    else:
        status = f"Selected {primary}."
    return PlatformReport(
        platform_key=key,
        system=platform.system(),
        machine=platform.machine(),
        python_arch=platform.machine() or f"{struct.calcsize('P') * 8}-bit",
        rosetta_translated=is_rosetta_translated(),
        onnxruntime_available=_module_available("onnxruntime"),
        available_providers=providers,
        selected_providers=selected,
        primary_provider=primary,
        accelerator_status=status,
        precision=expected_precision(key),
        vector_backend=expected_vector_backend(key),
        platform_notes=platform_notes(key, providers, selected),
        cpu_logical_count=logical_cpu_count(),
        memory_total_bytes=memory_total_bytes(),
        performance_tier=tier,
        recommended_performance_mode=recommended_mode,
        performance_notes=perf_notes,
        insightface_available=_module_available("insightface"),
        faiss_available=_module_available("faiss"),
        hdbscan_available=_module_available("hdbscan"),
    )
