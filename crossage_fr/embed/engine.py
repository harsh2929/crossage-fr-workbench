from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import glob
import importlib.util
import math
import os
import os.path as osp

import numpy as np
from PIL import Image, ImageFilter, ImageOps

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
        self.det_model.prepare(ctx_id, input_size=(640, 640), det_thresh=0.5)
        self.rec_model.prepare(ctx_id)

    def embed_loaded_image(self, image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        rgb = np.asarray(image)
        bgr = rgb[:, :, ::-1]
        bboxes, kpss = self.det_model.detect(bgr, max_num=0)
        if bboxes.shape[0] == 0:
            return []
        results: list[EmbeddingResult] = []
        for index in range(bboxes.shape[0]):
            face = self._face_cls(bbox=bboxes[index, 0:4], kps=None if kpss is None else kpss[index], det_score=bboxes[index, 4])
            self.rec_model.get(bgr, face)
            vector = _l2_normalize(np.asarray(face.embedding, dtype="float32"))
            bbox_values = tuple(int(round(v)) for v in face.bbox.tolist())
            quality = float(np.linalg.norm(face.embedding))
            results.append(
                EmbeddingResult(
                    vector=vector.tolist(),
                    quality=quality,
                    bbox=bbox_values,
                    model_name=self.model_name,
                )
            )
        return results

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
