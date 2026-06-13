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
from crossage_fr.ingest import load_image
from crossage_fr.model_manager import model_pack_ready, model_roots_for_engine, resolved_model_pack_dir
from crossage_fr.models import EmbeddingResult
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
        self._face_cls = Face
        try:
            model_dir = str(resolved_model_pack_dir(model_roots_for_engine(config)[0], pack) or "")
            self.det_model = self._load_model(model_zoo, model_dir, "detection", providers, provider_options)
            self.rec_model = self._load_model(model_zoo, model_dir, "recognition", providers, provider_options)
        except Exception:
            model_dir = str(resolved_model_pack_dir(model_roots_for_engine(config)[0], pack) or "")
            self.det_model = self._load_model(model_zoo, model_dir, "detection", ["CPUExecutionProvider"], None)
            self.rec_model = self._load_model(model_zoo, model_dir, "recognition", ["CPUExecutionProvider"], None)
            ctx_id = -1
        detector_size = max(320, min(1024, int(getattr(config, "face_detector_size", 640))))
        detector_size = int(round(detector_size / 32) * 32)
        self.detector_size = detector_size
        self.rescue_detector_size = min(1024, max(detector_size, 768))
        self.det_model.prepare(ctx_id, input_size=(detector_size, detector_size), det_thresh=0.5)
        self.rec_model.prepare(ctx_id)

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
            bboxes, kpss = self.det_model.detect(bgr, max_num=0)
            if bboxes.shape[0] == 0:
                return []
            detections = [(bgr, bboxes, kpss, "normal")]
        results: list[EmbeddingResult] = []
        seen: set[tuple[int, ...]] = set()
        for source_bgr, bboxes, kpss, variant in detections:
            for index in range(bboxes.shape[0]):
                face = self._face_cls(bbox=bboxes[index, 0:4], kps=None if kpss is None else kpss[index], det_score=bboxes[index, 4])
                self.rec_model.get(source_bgr, face)
                vector = _l2_normalize(np.asarray(face.embedding, dtype="float32"))
                fingerprint = tuple(int(round(float(value) * 1000)) for value in vector[:16])
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                bbox_values = tuple(int(round(v)) for v in face.bbox.tolist())
                quality = float(np.linalg.norm(face.embedding))
                pose_bucket = "profile" if rescue else self._pose_bucket_for_detection(source_bgr, face.bbox, None if kpss is None else kpss[index])
                results.append(
                    EmbeddingResult(
                        vector=vector.tolist(),
                        quality=quality,
                        bbox=bbox_values,
                        model_name=self.model_name,
                        note=f"profile-rescue:{variant}" if rescue else "",
                        pose_bucket=pose_bucket,
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
        return selected


def create_embedding_engine(config: RuntimeConfig) -> EmbeddingEngine:
    if os.environ.get("CROSSAGE_FORCE_FALLBACK") == "1":
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
