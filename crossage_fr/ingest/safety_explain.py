"""Optional "explain why flagged" detector framework for Safe Mode (res.md Stage 2).

The first-stage classifier (safety.py) answers *whether* an image is sensitive.
This second, optional stage answers *why* — body-part localization with labels +
boxes — for the review UI. The detector model is NOT bundled: NudeNet v3 640m is
AGPL-3.0 and download-only (a licensing decision), and Freepik is MIT but ships no
ONNX (needs a self-export). So this module is a pluggable framework:

  * a stable ``ExplainDetection`` schema (label, score, normalized [0,1] box),
  * model discovery + integrity (mirrors the first-stage model),
  * graceful degradation — with no model installed it returns ``available: False``
    and an empty list, never raising, so the pipeline is unaffected,
  * pure, unit-tested helpers (box normalization, confidence filtering).

Provisioning: drop a detector ONNX + sidecar manifest into ``models/safety-explain/``
(see ``explain_model_report``). NudeNet requires an AGPL source-offer; Freepik (MIT)
is the recommended substitute once exported.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
import json
import logging
import os
import re
import sys
from typing import Any

_LOG = logging.getLogger(__name__)

# Detector classes worth surfacing (NudeNet-style). Kept here so the schema is
# stable regardless of which model is provisioned; unknown classes pass through.
SENSITIVE_EXPLAIN_CLASSES = (
    "exposed_breast",
    "exposed_genitalia",
    "exposed_buttocks",
    "exposed_anus",
    "covered_breast",
    "covered_genitalia",
    "belly_exposed",
)

# NudeNet v3 detector classes, IN THE MODEL'S OUTPUT ORDER (its YOLOv8 head). This
# order is the ground truth for mapping a class index → label; a different export
# overrides it via the manifest "classes" list.
NUDENET_CLASSES = (
    "female_genitalia_covered",
    "face_female",
    "buttocks_exposed",
    "female_breast_exposed",
    "female_genitalia_exposed",
    "male_breast_exposed",
    "anus_exposed",
    "feet_exposed",
    "belly_covered",
    "feet_covered",
    "armpits_covered",
    "armpits_exposed",
    "face_male",
    "belly_exposed",
    "male_genitalia_exposed",
    "anus_covered",
    "female_breast_covered",
    "buttocks_covered",
)

# The subset that actually indicates sensitive/explicit content (drives the second
# stage's "why"); face/feet/armpits detections are ignored for the sensitivity note.
NUDENET_SENSITIVE_CLASSES = frozenset({
    "buttocks_exposed",
    "female_breast_exposed",
    "female_genitalia_exposed",
    "male_breast_exposed",
    "anus_exposed",
    "male_genitalia_exposed",
    "female_genitalia_covered",
    "female_breast_covered",
    "buttocks_covered",
    "anus_covered",
    "belly_exposed",
})


@dataclass(slots=True)
class ExplainDetection:
    label: str
    score: float
    box: tuple[float, float, float, float]  # normalized x, y, w, h in [0, 1]


def normalize_detection_box(box_xywh_pixels: Any, input_size: float) -> tuple[float, float, float, float]:
    """Pixel (x, y, w, h) with a top-left origin → [0, 1] fractions, clamped to frame."""
    try:
        x, y, w, h = (float(v) for v in box_xywh_pixels)
        size = float(input_size)
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 0.0)
    if not size > 0:
        return (0.0, 0.0, 0.0, 0.0)
    nx = min(max(x / size, 0.0), 1.0)
    ny = min(max(y / size, 0.0), 1.0)
    nw = min(max(w / size, 0.0), 1.0 - nx)
    nh = min(max(h / size, 0.0), 1.0 - ny)
    return (nx, ny, nw, nh)


def filter_and_cap_detections(detections: list[ExplainDetection], min_conf: float, max_count: int) -> list[ExplainDetection]:
    """Drop detections below ``min_conf``, sort by score desc, cap to ``max_count``."""
    kept = [d for d in detections if d.score >= min_conf]
    kept.sort(key=lambda d: d.score, reverse=True)
    return kept[: max(0, int(max_count))]


def letterbox_params(orig_w: float, orig_h: float, size: float) -> tuple[float, float, float]:
    """(scale, pad_x, pad_y) for a YOLO letterbox: scale the longest side to ``size``,
    centre the result in a size×size square with symmetric padding (NudeNet-style)."""
    try:
        w, h, s = float(orig_w), float(orig_h), float(size)
    except (TypeError, ValueError):
        return (1.0, 0.0, 0.0)
    if w <= 0 or h <= 0 or s <= 0:
        return (1.0, 0.0, 0.0)
    scale = s / max(w, h)
    return (scale, (s - w * scale) / 2.0, (s - h * scale) / 2.0)


def unletterbox_box(box_pixels_xywh: Any, scale: float, pad_x: float, pad_y: float, orig_w: float, orig_h: float) -> tuple[float, float, float, float]:
    """Map a box in letterboxed pixel space (top-left x,y,w,h) back to normalized
    [0,1] fractions of the ORIGINAL image, clamped to frame."""
    try:
        x, y, w, h = (float(v) for v in box_pixels_xywh)
        scale, pad_x, pad_y, ow, oh = float(scale), float(pad_x), float(pad_y), float(orig_w), float(orig_h)
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 0.0)
    if scale <= 0 or ow <= 0 or oh <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    nx = min(max((x - pad_x) / scale / ow, 0.0), 1.0)
    ny = min(max((y - pad_y) / scale / oh, 0.0), 1.0)
    nw = min(max(w / scale / ow, 0.0), 1.0 - nx)
    nh = min(max(h / scale / oh, 0.0), 1.0 - ny)
    return (nx, ny, nw, nh)


def box_iou(a: Any, b: Any) -> float:
    """Intersection-over-union of two normalized (x, y, w, h) boxes."""
    ax, ay, aw, ah = (float(v) for v in a)
    bx, by, bw, bh = (float(v) for v in b)
    ix, iy = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, ix2 - ix) * max(0.0, iy2 - iy)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def non_max_suppression(detections: list[ExplainDetection], iou_threshold: float = 0.5) -> list[ExplainDetection]:
    """Greedy per-label NMS: keep the highest-scored box, drop lower-scored boxes of
    the same label that overlap it beyond ``iou_threshold``."""
    result: list[ExplainDetection] = []
    by_label: dict[str, list[ExplainDetection]] = {}
    for det in detections:
        by_label.setdefault(det.label, []).append(det)
    for group in by_label.values():
        kept: list[ExplainDetection] = []
        for det in sorted(group, key=lambda d: d.score, reverse=True):
            if all(box_iou(det.box, k.box) <= iou_threshold for k in kept):
                kept.append(det)
        result.extend(kept)
    return result


def _is_packaged_backend() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _unique_dirs(paths: list[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        try:
            resolved = path.expanduser().resolve()
        except (OSError, RuntimeError):
            resolved = path.expanduser()
        key = str(resolved)
        if key and key not in seen:
            result.append(resolved)
            seen.add(key)
    return result


def _safe_explainer_model_stem(value: str, fallback: str = "nudenet-explainer") -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip(".-_")
    return (stem or fallback)[:120]


def _explainer_install_dir() -> Path:
    override = (
        os.environ.get("CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR", "").strip()
        or os.environ.get("CROSSAGE_SAFETY_EXPLAIN_DIR", "").strip()
    )
    if override:
        return Path(override)
    user_model_root = os.environ.get("CROSSAGE_USER_MODEL_DIR", "").strip()
    if user_model_root:
        return Path(user_model_root) / "safety-explain"
    if _is_packaged_backend():
        return Path.home() / ".vintrace" / "models" / "safety-explain"
    return Path(__file__).resolve().parents[2] / "models" / "safety-explain"


def _explainer_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_dir = os.environ.get("CROSSAGE_SAFETY_EXPLAIN_DIR", "").strip()
    if env_dir:
        dirs.append(Path(env_dir))
    dirs.append(_explainer_install_dir())
    here = Path(__file__).resolve()
    # repo/models/safety-explain and, in packaged apps, bundled resource layouts.
    dirs.append(here.parents[2] / "models" / "safety-explain")
    dirs.append(Path.cwd() / "models" / "safety-explain")
    try:
        executable = Path(sys.executable).resolve()
        dirs.append(executable.parent / "models" / "safety-explain")
        dirs.append(executable.parent.parent / "models" / "safety-explain")
    except (OSError, ValueError):
        pass
    meipass = getattr(sys, "_MEIPASS", "")
    if meipass:
        dirs.append(Path(meipass) / "models" / "safety-explain")
    return _unique_dirs([d for d in dirs if d])


@lru_cache(maxsize=1)
def find_explainer_model() -> Path | None:
    for directory in _explainer_model_dirs():
        try:
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.onnx")):
                if path.is_file():
                    return path
        except OSError:
            continue
    return None


def explain_model_report() -> dict[str, Any]:
    path = find_explainer_model()
    if path is None:
        return {
            "available": False,
            "modelName": None,
            "path": None,
            "reason": "No explainer model installed. Add a NudeNet/Freepik ONNX to models/safety-explain/ to enable body-part explanations.",
            "classes": list(SENSITIVE_EXPLAIN_CLASSES),
        }
    manifest = _read_manifest(path)
    return {
        "available": True,
        "modelName": manifest.get("modelName", path.stem),
        "path": str(path),
        "license": manifest.get("license", "unknown"),
        "source": manifest.get("source", ""),
        "reason": "Explainer model available.",
        "classes": list(manifest.get("classes", SENSITIVE_EXPLAIN_CLASSES)),
    }

def install_explainer_model(
    *,
    source_path: str | None = None,
    url: str | None = None,
    model_name: str = "nudenet-explainer",
    input_size: int = 640,
    license: str = "",
    classes: Any = None,
    expected_sha256: str = "",
    confirm_agpl: bool = False,
    fmt: str = "nudenet",
) -> dict[str, Any]:
    """Install a second-stage explainer ONNX from a user-downloaded file
    (``source_path``) or a ``url``, writing a sidecar manifest. AGPL models
    (NudeNet) require ``confirm_agpl`` — the user's acknowledgment of the AGPL
    source-offer obligation. Nothing is auto-downloaded without an explicit call."""
    import hashlib

    if "agpl" in (license or "").lower() and not confirm_agpl:
        return {"ok": False, "reason": "This model is AGPL-3.0 — acknowledge the AGPL source-offer obligation (confirmAgpl) to install it."}
    try:
        if source_path:
            data = Path(source_path).read_bytes()
        elif url:
            import urllib.request

            with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 - user-initiated, explicit URL
                data = response.read()
        else:
            return {"ok": False, "reason": "Provide a downloaded ONNX (sourcePath) or a url."}
    except Exception as exc:
        return {"ok": False, "reason": f"Could not read the model ({type(exc).__name__})."}
    if len(data) < 1024:
        return {"ok": False, "reason": "That file is too small to be a valid ONNX model."}
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 and digest.lower() != expected_sha256.strip().lower():
        return {"ok": False, "reason": "The model's SHA-256 did not match the expected value; refusing to install."}
    try:
        dest_dir = _explainer_install_dir()
        dest_dir.mkdir(parents=True, exist_ok=True)
        clean_model_name = _safe_explainer_model_stem(model_name)
        onnx_path = dest_dir / f"{clean_model_name}.onnx"
        onnx_path.write_bytes(data)
        manifest = {
            "modelName": clean_model_name,
            "format": fmt,
            "inputSize": int(input_size),
            "license": license or "unknown",
            "classes": list(classes or NUDENET_CLASSES),
            "sha256": digest,
            "source": url or "local-file",
        }
        onnx_path.with_suffix(".json").write_text(json.dumps(manifest, indent=2), "utf-8")
    except Exception as exc:
        return {"ok": False, "reason": f"Could not install the model ({type(exc).__name__})."}
    find_explainer_model.cache_clear() if hasattr(find_explainer_model, "cache_clear") else None
    return {"ok": True, **explain_model_report()}


def explain_sensitivity(image: Any, min_conf: float = 0.35, max_count: int = 8) -> dict[str, Any]:
    """Localize sensitive regions in ``image`` (a PIL image), if an explainer model
    is installed. Always safe to call: with no model, or on any failure, returns
    ``available: False`` and an empty detection list."""
    path = find_explainer_model()
    if path is None or image is None:
        return {"available": False, "detections": [], "reason": explain_model_report()["reason"]}
    try:
        detections = _run_explainer(path, image, min_conf=min_conf, max_count=max_count)
        return {
            "available": True,
            "modelName": _read_manifest(path).get("modelName", path.stem),
            "detections": [{"label": d.label, "score": d.score, "box": list(d.box)} for d in detections],
            "reason": "Explainer detections.",
        }
    except Exception as exc:  # never let the optional stage break the pipeline
        _LOG.warning("Safe Mode explainer failed: %s", exc)
        return {"available": False, "detections": [], "reason": f"Explainer unavailable ({type(exc).__name__})."}


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        sidecar = path.with_suffix(".json")
        if sidecar.is_file():
            return json.loads(sidecar.read_text("utf-8"))
    except (OSError, ValueError):
        pass
    return {}


def _run_explainer(path: Path, image: Any, *, min_conf: float, max_count: int) -> list[ExplainDetection]:
    """NudeNet-style YOLOv8 inference: letterbox → run → parse → NMS → un-letterbox.

    Defaults match NudeNet v3 (letterbox pad-resize, 18-class YOLOv8 head, boxes in
    input-pixel space). ``inputSize``/``classes``/``iou``/``format`` in the sidecar
    manifest override the defaults for a different export (e.g. a Freepik ONNX)."""
    import numpy as np  # local imports: only needed when a model is actually installed
    from PIL import Image

    from crossage_fr.ingest.safety import _session_for_model, _model_stat_token  # reuse ORT session cache

    manifest = _read_manifest(path)
    input_size = int(manifest.get("inputSize", 640))
    class_names = list(manifest.get("classes") or NUDENET_CLASSES)
    iou_threshold = float(manifest.get("iou", 0.45))

    rgb = image.convert("RGB")
    orig_w, orig_h = rgb.size
    scale, pad_x, pad_y = letterbox_params(orig_w, orig_h, input_size)
    # Letterbox: scale keeping aspect, paste onto a 114-grey square (YOLO convention).
    resized = rgb.resize((max(1, round(orig_w * scale)), max(1, round(orig_h * scale))))
    canvas = Image.new("RGB", (input_size, input_size), (114, 114, 114))
    canvas.paste(resized, (int(round(pad_x)), int(round(pad_y))))
    tensor = np.asarray(canvas, dtype=np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[None, ...].astype(np.float32)

    session = _session_for_model(str(path), _model_stat_token(path))
    input_name = session.get_inputs()[0].name
    raw = np.asarray(session.run(None, {input_name: tensor})[0])

    detections = _parse_yolo(raw, class_names, scale, pad_x, pad_y, orig_w, orig_h, min_conf)
    detections = non_max_suppression(detections, iou_threshold)
    return filter_and_cap_detections(detections, min_conf, max_count)


def _parse_yolo(
    raw: Any,
    class_names: list[str],
    scale: float,
    pad_x: float,
    pad_y: float,
    orig_w: float,
    orig_h: float,
    min_conf: float,
) -> list[ExplainDetection]:
    import numpy as np

    arr = np.asarray(raw, dtype=np.float32)
    arr = arr[0] if arr.ndim == 3 else arr
    # YOLOv8 head is [4+C, num_preds]; transpose to per-prediction rows [num_preds, 4+C].
    if arr.ndim == 2 and arr.shape[0] < arr.shape[1]:
        arr = arr.T
    out: list[ExplainDetection] = []
    for row in arr:
        if row.shape[0] < 5:
            continue
        cx, cy, w, h = float(row[0]), float(row[1]), float(row[2]), float(row[3])
        scores = row[4:]
        cls = int(np.argmax(scores))
        score = float(scores[cls])
        if score < min_conf:
            continue
        label = class_names[cls] if cls < len(class_names) else f"class_{cls}"
        # Box is in letterboxed input pixels (top-left); un-letterbox to original fractions.
        box = unletterbox_box((cx - w / 2.0, cy - h / 2.0, w, h), scale, pad_x, pad_y, orig_w, orig_h)
        out.append(ExplainDetection(label=label, score=score, box=box))
    return out
