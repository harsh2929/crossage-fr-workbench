from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import glob
import importlib.util
import math
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from crossage_fr.config import RuntimeConfig
from crossage_fr.embed.fiqa import effective_quality, find_fiqa_model, load_fiqa_scorer
from crossage_fr.ingest import load_image
from crossage_fr.model_manager import (
    ModelIntegrityError,
    model_pack_ready,
    model_roots_for_engine,
    resolved_model_pack_dir,
    verify_model_files,
)
from crossage_fr.models import EmbeddingResult
from crossage_fr.runtime_env import env_flag
from crossage_fr.platform_detect import build_platform_report, get_providers, provider_label, split_provider_config


class EmbeddingEngine(ABC):
    model_name: str

    def embed_image(self, path: Path) -> list[EmbeddingResult]:
        return self.embed_loaded_image(load_image(path), path)

    @abstractmethod
    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        raise NotImplementedError

    def embed_loaded_image_rescue(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        return []


def _l2_normalize(vector: np.ndarray) -> np.ndarray:
    vector = vector.astype("float32", copy=False)
    norm = float(np.linalg.norm(vector))
    if norm == 0.0 or math.isnan(norm):
        return vector
    return vector / norm


# Conservative, per-model defaults for mapping the raw (pre-normalization) ArcFace
# embedding L2 norm onto a [0,1] quality score. The norm is a MagFace-like
# "recognizability" proxy and for the real engines (glintr100 / w600k_r50) lives on
# a ~10-30 scale -- but every quality gate (quality_min and the readiness floors)
# is validated in [0,1] (config._require_unit_float), so storing the raw norm made
# the gates a silent no-op for the production engines. `lo` is set deliberately low
# so the re-armed gate only rejects clearly-degraded faces and does not start
# dropping legitimate (especially cross-age child) faces. Empirical anchor:
# glintr100 emits norms ~9.4-10.6 for random non-face crops (the model floor) and
# real faces score above that, so lo=8 keeps the floor just below the gate. Replace
# with per-model percentiles measured from real enrolled faces; see
# docs/detection-pipeline-audit.md, Phase 1 (self-tuning quality calibration).
_QUALITY_NORM_BOUNDS_DEFAULT = (8.0, 26.0)
_QUALITY_NORM_BOUNDS = {
    "glintr100": (8.0, 26.0),
    "w600k_r50": (8.0, 26.0),
}


def plan_tiles(width: int, height: int, *, tile_size: int, overlap: float) -> list[tuple[int, int, int, int]]:
    """Overlapping tile rectangles covering a large image (single tile if it fits).

    Tiling turns a tiny face in a multi-megapixel photo into a detector-scale face in
    its tile -- the single biggest recall lever for small/distant faces. Tiles are in
    ORIGINAL image coordinates, so detections translate back by a simple offset.
    """
    width = int(width)
    height = int(height)
    tile = max(32, int(tile_size))
    stride = max(1, int(round(tile * (1.0 - max(0.0, min(0.9, overlap))))))

    def _starts(total: int) -> list[int]:
        if total <= tile:
            return [0]
        points = list(range(0, total - tile + 1, stride))
        if not points or points[-1] != total - tile:
            points.append(total - tile)
        return points

    tiles: list[tuple[int, int, int, int]] = []
    for y0 in _starts(height):
        for x0 in _starts(width):
            tiles.append((x0, y0, min(x0 + tile, width), min(y0 + tile, height)))
    return tiles


def nms_boxes(boxes: np.ndarray, iou_thresh: float = 0.4) -> list[int]:
    """Greedy IoU non-max suppression. `boxes` is (N, >=5) with score in column 4.

    Returns kept row indices, highest score first -- used to merge full-frame and
    per-tile detections into one clean set before recognition.
    """
    if boxes is None or len(boxes) == 0:
        return []
    arr = np.asarray(boxes, dtype="float32")
    x1, y1, x2, y2, scores = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3], arr[:, 4]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1].tolist()
    keep: list[int] = []
    while order:
        current = order.pop(0)
        keep.append(int(current))
        remaining: list[int] = []
        for idx in order:
            xx1 = max(x1[current], x1[idx])
            yy1 = max(y1[current], y1[idx])
            xx2 = min(x2[current], x2[idx])
            yy2 = min(y2[current], y2[idx])
            inter = max(0.0, xx2 - xx1) * max(0.0, yy2 - yy1)
            union = areas[current] + areas[idx] - inter
            iou = inter / union if union > 0 else 0.0
            if iou <= iou_thresh:
                remaining.append(idx)
        order = remaining
    return keep


def inter_eye_distance(kps: np.ndarray | None) -> float:
    """Native inter-eye distance in pixels from the first two (eye) keypoints.

    IED is the resolution metric that actually predicts FR success (a small
    upscaled-but-sharp face can pass a sharpness gate yet have a tiny IED).
    Returns 0.0 (unknown) when keypoints are missing or malformed.
    """
    if kps is None:
        return 0.0
    try:
        if len(kps) < 2:
            return 0.0
        left = np.asarray(kps[0], dtype="float32")
        right = np.asarray(kps[1], dtype="float32")
        return float(np.linalg.norm(right - left))
    except (TypeError, ValueError, IndexError):
        return 0.0


def apply_recognizer_preference(paths: list[Path], preferred_filename: str) -> list[Path]:
    """Move a configured recognizer file to the front of the priority list.

    Lets a drop-in recognizer (e.g. LVFace ViT-B -- MIT-licensed, ships ONNX, the only
    top-tier commercial-clean option) be selected purely by config, with no code edit.
    An empty or unmatched preference leaves the existing order untouched.
    """
    preferred = str(preferred_filename or "").strip().lower()
    if not preferred:
        return paths
    matches = [path for path in paths if preferred in path.name.lower()]
    if not matches:
        return paths
    rest = [path for path in paths if path not in matches]
    return matches + rest


def flip_average(feat_a: np.ndarray, feat_b: np.ndarray) -> np.ndarray:
    """L2-normalized mean of two embeddings (original + horizontally-flipped crop).

    Horizontal-flip TTA averages the embedding of a face and its mirror -- a free
    ~0.1-0.4% lift on hard/cross-age sets that every SOTA eval uses. Each side is
    normalized before averaging so neither dominates; the result is unit-norm for cosine.
    """
    a = _l2_normalize(np.asarray(feat_a, dtype="float32"))
    b = _l2_normalize(np.asarray(feat_b, dtype="float32"))
    return _l2_normalize(a + b)


def plan_detect_sizes(
    detector_size: int,
    rescue_size: int,
    *,
    multi_scale: bool,
    dynamic: bool,
) -> list[tuple[int, int]]:
    """Plan the SCRFD input sizes for the normal detection pass.

    A second, larger scale recovers medium/distant faces that a single
    resize-to-fit drops. The pinned insightface SCRFD.detect already unions
    multi-size candidates with spatial NMS -- but only when the ONNX model has a
    dynamic input shape (static models ignore the list). Sizes are deduped and
    ascending; an equal detector/rescue size collapses to a single pass.
    """
    if not multi_scale or not dynamic:
        return [(int(detector_size), int(detector_size))]
    sizes = sorted({int(detector_size), int(rescue_size)})
    return [(size, size) for size in sizes]


def detect_cache_tag(sizes: list[tuple[int, int]]) -> str:
    """Cache-key suffix for a multi-scale detection plan (empty for single-scale).

    Tagging only the multi-scale plan means single-scale caches keep working and
    are never silently served stale when multi-scale is enabled.
    """
    if len(sizes) <= 1:
        return ""
    return "ms" + "-".join(str(size[0]) for size in sizes)


def quality_from_norm(norm: float, model_name: str | None = None) -> float:
    """Map a raw embedding L2 norm onto a calibrated [0,1] face-quality score.

    Higher norm == more recognizable. Returns 0.0 for non-finite or non-positive
    norms. `model_name` selects per-model bounds when available; an unknown model
    falls back to the conservative default bounds.
    """
    try:
        value = float(norm)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(value) or value <= 0.0:
        return 0.0
    lo, hi = _QUALITY_NORM_BOUNDS_DEFAULT
    if model_name:
        for key, bounds in _QUALITY_NORM_BOUNDS.items():
            if key in model_name:
                lo, hi = bounds
                break
    if hi <= lo:
        return 0.0
    return max(0.0, min(1.0, (value - lo) / (hi - lo)))


class FallbackEmbeddingEngine(EmbeddingEngine):
    """Deterministic local image features used when FR models are unavailable."""

    model_name = "local-image-fingerprint"

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        vector = self._feature_vector(image)
        quality = self._quality_score(image)
        return [
            EmbeddingResult(
                vector=vector.tolist(),
                quality=quality,
                bbox=(0, 0, image.width, image.height),
                model_name=self.model_name,
                note="Fallback mode compares whole-image fingerprints, not biometric face embeddings.",
                pose_bucket="unknown",
            )
        ]

    def _feature_vector(self, image: Image.Image) -> np.ndarray:
        fitted = ImageOps.fit(image.convert("RGB"), (112, 112), Image.Resampling.LANCZOS)
        arr = np.asarray(fitted).astype("float32") / 255.0
        gray = np.asarray(fitted.convert("L")).astype("float32") / 255.0

        low = np.asarray(fitted.convert("L").resize((16, 16), Image.Resampling.LANCZOS)).astype("float32") / 255.0
        low = low.reshape(-1)

        hist_parts = []
        for channel in range(3):
            hist, _ = np.histogram(arr[:, :, channel], bins=32, range=(0.0, 1.0), density=True)
            hist_parts.append(hist.astype("float32"))
        color_hist = np.concatenate(hist_parts)

        gx = np.diff(gray, axis=1, append=gray[:, -1:])
        gy = np.diff(gray, axis=0, append=gray[-1:, :])
        mag = np.sqrt(gx * gx + gy * gy)
        edge = Image.fromarray(np.uint8(np.clip(mag * 255.0, 0, 255))).resize((12, 12), Image.Resampling.BILINEAR)
        edge_values = np.asarray(edge).astype("float32").reshape(-1) / 255.0

        blur = fitted.filter(ImageFilter.GaussianBlur(radius=1.2))
        detail = np.asarray(ImageChopsSafe.difference(fitted.convert("L"), blur.convert("L"))).astype("float32") / 255.0
        detail_stats = np.array(
            [
                float(gray.mean()),
                float(gray.std()),
                float(np.percentile(gray, 5)),
                float(np.percentile(gray, 25)),
                float(np.percentile(gray, 50)),
                float(np.percentile(gray, 75)),
                float(np.percentile(gray, 95)),
                float(mag.mean()),
                float(mag.std()),
                float(detail.mean()),
                float(detail.std()),
                float(arr[:, :, 0].mean()),
                float(arr[:, :, 1].mean()),
                float(arr[:, :, 2].mean()),
                float(arr[:, :, 0].std()),
                float(arr[:, :, 1].std()),
            ],
            dtype="float32",
        )

        vector = np.concatenate([low, color_hist, edge_values, detail_stats])
        if vector.shape[0] != 512:
            raise RuntimeError(f"Fallback feature vector has unexpected size {vector.shape[0]}")
        return _l2_normalize(vector)

    def _quality_score(self, image: Image.Image) -> float:
        gray = np.asarray(ImageOps.fit(image.convert("L"), (256, 256), Image.Resampling.LANCZOS)).astype("float32") / 255.0
        gx = np.diff(gray, axis=1, append=gray[:, -1:])
        gy = np.diff(gray, axis=0, append=gray[-1:, :])
        sharpness = min(1.0, float(np.sqrt(gx * gx + gy * gy).mean()) * 8.0)
        contrast = min(1.0, float(gray.std()) * 4.0)
        exposure = 1.0 - min(1.0, abs(float(gray.mean()) - 0.5) * 2.0)
        return max(0.0, min(1.0, 0.45 * sharpness + 0.35 * contrast + 0.20 * exposure))


class ImageChopsSafe:
    @staticmethod
    def difference(left: Image.Image, right: Image.Image) -> Image.Image:
        from PIL import ImageChops

        return ImageChops.difference(left, right)


class InsightFaceEmbeddingEngine(EmbeddingEngine):
    model_name = "insightface-antelopev2"

    def __init__(self, config: RuntimeConfig, model_pack: str | None = None):
        import onnxruntime
        from insightface.app.common import Face
        from insightface.model_zoo import model_zoo

        onnxruntime.set_default_logger_severity(3)
        report = build_platform_report()
        selected_providers = get_providers(report.platform_key)
        providers, provider_options = split_provider_config(selected_providers)
        primary_provider = provider_label(selected_providers[0]) if selected_providers else "CPUExecutionProvider"
        ctx_id = -1 if primary_provider == "CPUExecutionProvider" else 0
        pack = model_pack or config.model_pack
        self.model_name = f"insightface-{pack}"
        self.recognizer_filename = str(getattr(config, "recognizer_filename", "") or "")
        self._face_cls = Face
        model_dir = str(resolved_model_pack_dir(model_roots_for_engine(config)[0], pack) or "")
        # USC-04: verify on-disk model integrity before loading and OUTSIDE the
        # try/except below, so a ModelIntegrityError fails closed instead of being
        # swallowed into the CPU-fallback path (which would load the same files).
        if model_dir:
            verify_model_files(Path(model_dir), pack)
        try:
            self.det_model = self._load_model(model_zoo, model_dir, "detection", providers, provider_options)
            self.rec_model = self._load_model(model_zoo, model_dir, "recognition", providers, provider_options)
        except ModelIntegrityError:
            raise
        except Exception:
            self.det_model = self._load_model(model_zoo, model_dir, "detection", ["CPUExecutionProvider"], None)
            self.rec_model = self._load_model(model_zoo, model_dir, "recognition", ["CPUExecutionProvider"], None)
            ctx_id = -1
        detector_size = max(320, min(1024, int(getattr(config, "face_detector_size", 640))))
        detector_size = int(round(detector_size / 32) * 32)
        self.detector_size = detector_size
        self.rescue_detector_size = min(1024, max(detector_size, 768))
        self.det_model.prepare(ctx_id, input_size=(detector_size, detector_size), det_thresh=0.5)
        self.rec_model.prepare(ctx_id)
        # Multi-scale normal pass: a second larger scale recovers medium/distant
        # faces a single resize-to-fit would drop. Only honored on dynamic-shape
        # ONNX detectors (static models ignore the size list).
        detector_dynamic = getattr(self.det_model, "static_input_size", None) is None
        self._normal_input_sizes = plan_detect_sizes(
            detector_size,
            self.rescue_detector_size,
            multi_scale=bool(getattr(config, "multi_scale_detect", True)),
            dynamic=detector_dynamic,
        )
        # Tiling reuses the same recall-vs-compute opt-in as multi-scale.
        self.tiled_detect_enabled = bool(getattr(config, "multi_scale_detect", True)) and detector_dynamic
        self.tile_overlap = 0.2
        # Flip-TTA: off by default (2x recognizer cost); best enabled only on the small
        # verification/candidate set, not a full-library sweep.
        self.flip_tta = bool(getattr(config, "flip_tta", False))
        # Cache tag so multi-scale/tiled rows never collide with / serve stale single-scale rows.
        self.detect_cache_tag = detect_cache_tag(self._normal_input_sizes)
        # FIQA seam (Phase 2.2): use a dropped-in recognition-aware quality model when
        # present, else fall back to the calibrated embedding norm. None by default.
        try:
            self.fiqa = load_fiqa_scorer(find_fiqa_model(Path.cwd()))
        except Exception:
            self.fiqa = None

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        return self._embed_with_detector(image, path=path, rescue=False)

    def embed_loaded_image_rescue(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        return self._embed_with_detector(image, path=path, rescue=True)

    def _embed_with_detector(self, image: Image.Image, path: Path | None = None, *, rescue: bool) -> list[EmbeddingResult]:
        rgb = np.asarray(image)
        bgr = rgb[:, :, ::-1]
        if rescue:
            detections = self._rescue_detections(image)
            if not detections:
                return []
        else:
            sizes = getattr(self, "_normal_input_sizes", None)
            if sizes and len(sizes) > 1:
                bboxes, kpss = self.det_model.detect(bgr, input_size=sizes, max_num=0)
            else:
                bboxes, kpss = self.det_model.detect(bgr, max_num=0)
            if getattr(self, "tiled_detect_enabled", False):
                tboxes, tkpss = self._tiled_detect(bgr)
                if tboxes.shape[0]:
                    bboxes, kpss = self._merge_detections(bboxes, kpss, tboxes, tkpss)
            if bboxes.shape[0] == 0:
                return []
            detections = [(bgr, bboxes, kpss, "normal")]
        results: list[EmbeddingResult] = []
        seen: set[tuple[int, ...]] = set()
        for source_bgr, bboxes, kpss, variant in detections:
            for index in range(bboxes.shape[0]):
                kps_for_index = None if kpss is None else kpss[index]
                face = self._face_cls(bbox=bboxes[index, 0:4], kps=kps_for_index, det_score=bboxes[index, 4])
                vector = self._recognize(source_bgr, face, kps_for_index)
                fingerprint = tuple(int(round(float(value) * 1000)) for value in vector[:16])
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                bbox_values = tuple(int(round(v)) for v in face.bbox.tolist())
                raw_norm = float(np.linalg.norm(face.embedding))
                fiqa_score = self._fiqa_score(source_bgr, kps_for_index)
                quality = effective_quality(quality_from_norm(raw_norm, self.model_name), fiqa_score)
                pose_bucket = self._pose_bucket_for_face(source_bgr, face.bbox, kps_for_index, rescue=rescue)
                det_score = float(getattr(face, "det_score", 0.0) or 0.0)
                ied_px = inter_eye_distance(kps_for_index)
                results.append(
                    EmbeddingResult(
                        vector=vector.tolist(),
                        quality=quality,
                        quality_norm=raw_norm,
                        bbox=bbox_values,
                        model_name=self.model_name,
                        note=f"profile-rescue:{variant}" if rescue else "",
                        pose_bucket=pose_bucket,
                        det_score=det_score,
                        ied_px=ied_px,
                        fiqa_score=float(fiqa_score) if fiqa_score is not None else 0.0,
                    )
                )
                if rescue and len(results) >= 3:
                    return results
        return results

    def _rescue_detections(self, image: Image.Image) -> list[tuple[np.ndarray, np.ndarray, np.ndarray | None, str]]:
        variants = self._rescue_variants(image)
        detections: list[tuple[np.ndarray, np.ndarray, np.ndarray | None, str]] = []
        old_threshold = float(getattr(self.det_model, "det_thresh", 0.5))
        try:
            self.det_model.det_thresh = min(old_threshold, 0.22)
            for name, variant_image in variants:
                bgr = np.asarray(variant_image.convert("RGB"))[:, :, ::-1]
                bboxes, kpss = self.det_model.detect(
                    bgr,
                    input_size=(self.rescue_detector_size, self.rescue_detector_size),
                    max_num=3,
                )
                if bboxes.shape[0] == 0:
                    continue
                order = np.argsort(-bboxes[:, 4])
                detections.append((bgr, bboxes[order[:3]], None if kpss is None else kpss[order[:3]], name))
                if detections:
                    break
        finally:
            self.det_model.det_thresh = old_threshold
        return detections

    def _rescue_variants(self, image: Image.Image) -> list[tuple[str, Image.Image]]:
        rgb = image.convert("RGB")
        padded = ImageOps.pad(rgb, (max(rgb.width, rgb.height), max(rgb.width, rgb.height)), color=(0, 0, 0), method=Image.Resampling.BICUBIC)
        contrast = ImageEnhance.Contrast(ImageOps.autocontrast(rgb)).enhance(1.18)
        context = self._context_pad(rgb, scale=2.3, min_size=384)
        large_context = self._context_pad(rgb, scale=3.0, min_size=512)
        contrast_context = self._context_pad(contrast, scale=2.3, min_size=384)
        return [
            ("low-threshold", rgb),
            ("square-pad", padded),
            ("context-pad", context),
            ("large-context-pad", large_context),
            ("autocontrast", contrast),
            ("autocontrast-context-pad", contrast_context),
        ]

    def _context_pad(self, image: Image.Image, *, scale: float, min_size: int) -> Image.Image:
        rgb = image.convert("RGB")
        side = max(int(round(max(rgb.width, rgb.height) * max(1.0, scale))), int(min_size))
        side = min(1024, max(side, rgb.width, rgb.height))
        try:
            pixels = np.asarray(rgb)
            corners = np.array([pixels[0, 0], pixels[0, -1], pixels[-1, 0], pixels[-1, -1]], dtype=np.float32)
            color = tuple(int(round(float(value))) for value in np.median(corners, axis=0))
        except Exception:
            color = (0, 0, 0)
        canvas = Image.new("RGB", (side, side), color=color)
        canvas.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
        return canvas

    def _recognize(self, source_bgr: np.ndarray, face: object, kps: np.ndarray | None) -> np.ndarray:
        """Set face.embedding (single crop, for the quality norm) and return the
        matching vector -- flip-TTA averaged when enabled, else the plain embedding."""
        if self.flip_tta and kps is not None:
            try:
                from insightface.utils import face_align

                size = int(getattr(self.rec_model, "input_size", (112, 112))[0]) or 112
                aligned = face_align.norm_crop(source_bgr, kps, image_size=size)
                feat1 = np.asarray(self.rec_model.get_feat(aligned), dtype="float32").flatten()
                feat2 = np.asarray(self.rec_model.get_feat(np.ascontiguousarray(aligned[:, ::-1])), dtype="float32").flatten()
                # Quality norm stays the SINGLE-crop norm the gates are calibrated against.
                face.embedding = feat1
                return flip_average(feat1, feat2)
            except Exception:
                pass
        self.rec_model.get(source_bgr, face)
        return _l2_normalize(np.asarray(face.embedding, dtype="float32"))

    def _fiqa_score(self, source_bgr: np.ndarray, kps: np.ndarray | None) -> float | None:
        scorer = getattr(self, "fiqa", None)
        if scorer is None or kps is None:
            return None
        try:
            from insightface.utils import face_align

            aligned = face_align.norm_crop(source_bgr, kps)
            return float(scorer.score_aligned(aligned))
        except Exception:
            return None

    def _tiled_detect(self, bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
        """Detect faces in overlapping tiles of a large image, in GLOBAL coordinates.

        Only runs when the image is large relative to the detector input (otherwise
        the full-frame pass already sees faces at full size). Tile size is enlarged
        for very large images so the number of detector passes stays bounded.
        """
        height, width = bgr.shape[0], bgr.shape[1]
        tile = int(self.detector_size)
        if max(width, height) <= 2 * tile:
            return np.empty((0, 5), dtype="float32"), None
        # Perf guard: keep tile count bounded (<=24 passes) for multi-megapixel photos.
        while len(plan_tiles(width, height, tile_size=tile, overlap=self.tile_overlap)) > 24 and tile < 2048:
            tile += 256
        boxes_list: list[np.ndarray] = []
        kps_list: list[np.ndarray] = []
        kps_complete = True
        for x0, y0, x1, y1 in plan_tiles(width, height, tile_size=tile, overlap=self.tile_overlap):
            crop = bgr[y0:y1, x0:x1]
            if crop.shape[0] < 16 or crop.shape[1] < 16:
                continue
            tile_boxes, tile_kps = self.det_model.detect(crop, max_num=0)
            if tile_boxes.shape[0] == 0:
                continue
            tile_boxes = tile_boxes.copy()
            tile_boxes[:, 0] += x0
            tile_boxes[:, 1] += y0
            tile_boxes[:, 2] += x0
            tile_boxes[:, 3] += y0
            boxes_list.append(tile_boxes)
            if tile_kps is not None:
                tile_kps = tile_kps.copy()
                tile_kps[..., 0] += x0
                tile_kps[..., 1] += y0
                kps_list.append(tile_kps)
            else:
                kps_complete = False
        if not boxes_list:
            return np.empty((0, 5), dtype="float32"), None
        boxes = np.vstack(boxes_list)
        kpss = np.vstack(kps_list) if (kps_complete and len(kps_list) == len(boxes_list)) else None
        return boxes, kpss

    def _merge_detections(
        self,
        boxes_a: np.ndarray,
        kps_a: np.ndarray | None,
        boxes_b: np.ndarray,
        kps_b: np.ndarray | None,
    ) -> tuple[np.ndarray, np.ndarray | None]:
        """Merge two detection sets (e.g. full-frame + tiles) with IoU NMS dedup."""
        boxes = np.vstack([boxes_a, boxes_b])
        if (
            kps_a is not None
            and kps_b is not None
            and kps_a.shape[0] == boxes_a.shape[0]
            and kps_b.shape[0] == boxes_b.shape[0]
        ):
            kpss: np.ndarray | None = np.vstack([kps_a, kps_b])
        else:
            kpss = None
        keep = nms_boxes(boxes, iou_thresh=0.4)
        boxes = boxes[keep]
        if kpss is not None:
            kpss = kpss[keep]
        return boxes, kpss

    def _pose_bucket_for_face(self, image_bgr: np.ndarray, bbox: np.ndarray, kps: np.ndarray | None, *, rescue: bool) -> str:
        # Rescue detections used to be hard-labeled "profile", which routed even a
        # frontal rescued face through the loosest (relaxed_child) threshold band
        # via thresholds_for_pose -- real metric pollution. Run the same keypoint
        # heuristic the normal path uses whenever keypoints are available, keeping
        # "profile" only as the no-keypoints fallback (rescue boxes often lack kps,
        # and a hard-pose prior is the safe default there).
        if rescue and kps is None:
            return "profile"
        return self._pose_bucket_for_detection(image_bgr, bbox, kps)

    def _pose_bucket_for_detection(self, image_bgr: np.ndarray, bbox: np.ndarray, kps: np.ndarray | None) -> str:
        try:
            x1, y1, x2, y2 = [float(value) for value in bbox[:4]]
            width = max(1.0, x2 - x1)
            image_width = max(1.0, float(image_bgr.shape[1]))
            face_center = (x1 + x2) / 2.0 / image_width
            if face_center < 0.08 or face_center > 0.92:
                return "edge-face"
            if kps is None or len(kps) < 3:
                return "unknown"
            left_eye = kps[0]
            right_eye = kps[1]
            nose = kps[2]
            eye_span = abs(float(right_eye[0]) - float(left_eye[0])) / width
            nose_offset = abs(float(nose[0]) - ((x1 + x2) / 2.0)) / width
            if eye_span < 0.18 or nose_offset >= 0.24:
                return "profile"
            if nose_offset >= 0.14:
                return "three-quarter"
            return "frontal"
        except Exception:
            return "unknown"

    def _load_model(
        self,
        model_zoo: object,
        model_dir: str,
        taskname: str,
        providers: list[str],
        provider_options: list[dict[str, object]] | None,
    ) -> object:
        for model_path in self._candidate_model_paths(model_dir, taskname):
            kwargs: dict[str, object] = {"providers": providers}
            if provider_options is not None:
                kwargs["provider_options"] = provider_options
            model = model_zoo.get_model(str(model_path), **kwargs)
            if getattr(model, "taskname", "") == taskname:
                return model
        raise RuntimeError(f"Could not find InsightFace {taskname} model in {model_dir}")

    def _candidate_model_paths(self, model_dir: str, taskname: str) -> list[Path]:
        all_paths = sorted(Path(model_dir).glob("*.onnx"))
        if taskname == "detection":
            priority = [
                "scrfd_10g_bnkps.onnx",
                "det_10g.onnx",
                "*scrfd*.onnx",
                "retinaface*.onnx",
            ]
            excluded = ("2d106", "1k3d", "gender", "w600k", "glint", "r50")
        else:
            priority = [
                "glintr100.onnx",
                "w600k_r50.onnx",
                "*recognition*.onnx",
                "*arcface*.onnx",
                "*glint*.onnx",
                "*r50*.onnx",
            ]
            excluded = ("scrfd", "det", "landmark", "gender")

        selected: list[Path] = []
        seen: set[Path] = set()
        for pattern in priority:
            for value in glob.glob(osp.join(model_dir, pattern)):
                path = Path(value)
                if path in seen:
                    continue
                selected.append(path)
                seen.add(path)
        for path in all_paths:
            lowered = path.name.lower()
            if path not in seen and not any(token in lowered for token in excluded):
                selected.append(path)
                seen.add(path)
        if taskname == "recognition":
            return apply_recognizer_preference(selected, getattr(self, "recognizer_filename", ""))
        return selected


def create_embedding_engine(config: RuntimeConfig) -> EmbeddingEngine:
    # MS-1: honor both VINTRACE_FORCE_FALLBACK and legacy CROSSAGE_FORCE_FALLBACK.
    if env_flag("FORCE_FALLBACK"):
        return FallbackEmbeddingEngine()
    if importlib.util.find_spec("insightface") is not None:
        candidates = [config.model_pack]
        if "buffalo_l" not in candidates:
            candidates.append("buffalo_l")
        last_error: Exception | None = None
        for pack in candidates:
            ready_roots = [root for root in model_roots_for_engine(config) if model_pack_ready(root, pack)]
            if not ready_roots:
                continue
            try:
                config.model_root = str(ready_roots[0])
                return InsightFaceEmbeddingEngine(config, model_pack=pack)
            except Exception as exc:
                last_error = exc
                continue
        fallback = FallbackEmbeddingEngine()
        if last_error is not None:
            fallback.model_name = f"{fallback.model_name} (InsightFace unavailable: {type(last_error).__name__})"
        else:
            fallback.model_name = f"{fallback.model_name} (face model download needed)"
        return fallback
    return FallbackEmbeddingEngine()
