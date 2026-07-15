"""Unit tests for detection planning (Phase 0.3) and rescue suspicion (Phase 1.4).

Run: PYTHONPATH=. .venv/bin/python tests/detection_units.py
"""

from __future__ import annotations

import os
import tempfile
import types

import numpy as np
from PIL import Image

from pathlib import Path

import crossage_fr.embed.engine as engine_module
from crossage_fr.config import RuntimeConfig
from crossage_fr.model_manager import model_status
from crossage_fr.embed.engine import (
    ARCFACE_DST,
    AlignmentRecognitionAttempt,
    InsightFaceEmbeddingEngine,
    alignment_error,
    alignment_recovery_hypotheses,
    apply_recognizer_preference,
    detect_cache_tag,
    flip_average,
    create_embedding_engine,
    inter_eye_distance,
    nms_boxes,
    plan_detect_sizes,
    plan_tiled_detect,
    plan_tiles,
    select_alignment_recovery,
)
from crossage_fr.enroll.manager import ProjectState
from crossage_fr.models import EmbeddingResult, ReferenceFace


class _FakeDetector:
    """Detects one fixed box near each crop's top-left; lets us assert coordinates."""

    def detect(self, crop, max_num=0):
        boxes = np.array([[5, 5, 45, 45, 0.9]], dtype="float32")
        kps = np.array([[[12, 18], [38, 18], [25, 30], [15, 40], [35, 40]]], dtype="float32")
        return boxes, kps


def _tiling_engine() -> InsightFaceEmbeddingEngine:
    eng = InsightFaceEmbeddingEngine.__new__(InsightFaceEmbeddingEngine)
    eng.det_model = _FakeDetector()
    eng.detector_size = 512
    eng.tile_overlap = 0.2
    return eng


def test_plan_detect_sizes_multi_scale() -> None:
    # default detail 512 + rescue 768 on a dynamic model -> two distinct scales
    assert plan_detect_sizes(512, 768, multi_scale=True, dynamic=True) == [(512, 512), (768, 768)]


def test_engine_fallback_preserves_redacted_load_error_detail(tmp_path: Path | None = None) -> None:
    root = tmp_path or Path("/tmp")
    original_find_spec = engine_module.importlib.util.find_spec
    original_roots = engine_module.model_roots_for_engine
    original_ready = engine_module.model_pack_ready
    original_engine_cls = engine_module.InsightFaceEmbeddingEngine
    old_force = {
        "VINTRACE_FORCE_FALLBACK": os.environ.pop("VINTRACE_FORCE_FALLBACK", None),
        "CROSSAGE_FORCE_FALLBACK": os.environ.pop("CROSSAGE_FORCE_FALLBACK", None),
    }

    class FailingInsightFaceEngine:
        def __init__(self, *_args, **_kwargs) -> None:
            raise RuntimeError("ONNX provider failed while opening /Users/alice/private/model.onnx")

    def fake_find_spec(name: str, *args, **kwargs):  # type: ignore[no-untyped-def]
        if name == "insightface":
            return object()
        return original_find_spec(name, *args, **kwargs)

    try:
        engine_module.importlib.util.find_spec = fake_find_spec  # type: ignore[assignment]
        engine_module.model_roots_for_engine = lambda _config: [root]  # type: ignore[assignment]
        engine_module.model_pack_ready = lambda _root, _pack: True  # type: ignore[assignment]
        engine_module.InsightFaceEmbeddingEngine = FailingInsightFaceEngine  # type: ignore[assignment]
        engine = create_embedding_engine(RuntimeConfig())
    finally:
        engine_module.importlib.util.find_spec = original_find_spec  # type: ignore[assignment]
        engine_module.model_roots_for_engine = original_roots  # type: ignore[assignment]
        engine_module.model_pack_ready = original_ready  # type: ignore[assignment]
        engine_module.InsightFaceEmbeddingEngine = original_engine_cls  # type: ignore[assignment]
        for key, value in old_force.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert engine.model_name == "local-image-fingerprint (InsightFace unavailable: RuntimeError)"
    detail = getattr(engine, "engine_detail", "")
    assert "RuntimeError" in detail
    assert "ONNX provider failed" in detail
    assert "/Users/alice" not in detail
    assert "[path]" in detail
    status = model_status(RuntimeConfig(), engine.model_name, getattr(engine, "fallback_reason", ""))
    assert status["fallbackActive"] is True
    assert status["fallbackReason"] == getattr(engine, "fallback_reason", "")
    assert "ONNX provider failed" in status["engineDetail"]


def test_runtime_provider_failure_reloads_once_on_cpu() -> None:
    engine = InsightFaceEmbeddingEngine.__new__(InsightFaceEmbeddingEngine)
    engine._active_provider_names = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    engine._runtime_provider_fallback_attempted = False
    engine._runtime_provider_fallback_lock = engine_module.threading.Lock()
    engine._model_zoo = object()
    engine._model_dir = "/verified/model"
    engine.detector_size = 640
    loaded: list[tuple[str, tuple[str, ...]]] = []

    class PreparedModel:
        def __init__(self, role: str) -> None:
            self.role = role
            self.prepared: tuple[tuple[object, ...], dict[str, object]] | None = None

        def prepare(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
            self.prepared = (args, kwargs)

    models: dict[str, PreparedModel] = {}

    def fake_load(_self, _zoo, _root, role, providers, _options):  # type: ignore[no-untyped-def]
        loaded.append((role, tuple(providers)))
        model = PreparedModel(role)
        models[role] = model
        return model

    calls: list[tuple[str, ...]] = []

    def fake_active(_self, _image, path=None, *, rescue):  # type: ignore[no-untyped-def]
        calls.append(tuple(engine._active_provider_names))
        if engine._active_provider_names[0] == "CoreMLExecutionProvider":
            raise RuntimeError("dynamic CoreML output shape")
        return [EmbeddingResult([1.0] + [0.0] * 511, 0.9, (0, 0, 10, 10), "test")]

    engine._load_model = types.MethodType(fake_load, engine)  # type: ignore[method-assign]
    engine._embed_with_active_provider = types.MethodType(fake_active, engine)  # type: ignore[method-assign]
    result = engine._embed_with_detector(Image.new("RGB", (16, 16)), rescue=False)
    assert len(result) == 1
    assert calls == [
        ("CoreMLExecutionProvider", "CPUExecutionProvider"),
        ("CPUExecutionProvider",),
    ]
    assert loaded == [
        ("detection", ("CPUExecutionProvider",)),
        ("recognition", ("CPUExecutionProvider",)),
    ]
    assert models["detection"].prepared == ((-1,), {"input_size": (640, 640), "det_thresh": 0.5})
    assert models["recognition"].prepared == ((-1,), {})
    assert engine._runtime_provider_fallback_attempted is True
    assert engine.engine_detail.endswith("CPUExecutionProvider")

    def fail_if_reloaded(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("CPU runtime failures must not trigger another provider reload")

    engine._load_model = fail_if_reloaded  # type: ignore[method-assign]

    def cpu_failure(_self, _image, path=None, *, rescue):  # type: ignore[no-untyped-def]
        raise RuntimeError("cpu inference failure")

    engine._embed_with_active_provider = types.MethodType(cpu_failure, engine)  # type: ignore[method-assign]
    try:
        engine._embed_with_detector(Image.new("RGB", (16, 16)), rescue=False)
    except RuntimeError as exc:
        assert str(exc) == "cpu inference failure"
    else:
        raise AssertionError("CPU inference failure should propagate")


def test_plan_detect_sizes_dedupes_when_equal() -> None:
    # high-detail 768 collapses to a single scale (no benefit, no wasted pass)
    assert plan_detect_sizes(768, 768, multi_scale=True, dynamic=True) == [(768, 768)]


def test_plan_detect_sizes_respects_flag_and_static_model() -> None:
    # multi_scale off -> single scale
    assert plan_detect_sizes(512, 768, multi_scale=False, dynamic=True) == [(512, 512)]
    # static (non-dynamic) model can't honor a size list -> single scale
    assert plan_detect_sizes(512, 768, multi_scale=True, dynamic=False) == [(512, 512)]


def test_detect_cache_tag() -> None:
    # multi-scale gets a tag so its cache rows don't collide with single-scale ones;
    # single-scale stays untagged so existing caches keep working.
    assert detect_cache_tag([(512, 512), (768, 768)]) == "ms512-768"
    assert detect_cache_tag([(512, 512)]) == ""
    assert detect_cache_tag([]) == ""
    assert detect_cache_tag([(512, 512)], tiled=True, tile_size=512) == "tile512"
    assert detect_cache_tag([(512, 512), (768, 768)], tiled=True, tile_size=512) == "ms512-768-tile512"


def test_plan_tiled_detect_is_quality_only() -> None:
    config = RuntimeConfig()
    config.multi_scale_detect = True
    for mode in ("auto", "fast", "balanced"):
        config.performance_mode = mode
        assert plan_tiled_detect(config, detector_dynamic=True) is False
    config.performance_mode = "quality"
    assert plan_tiled_detect(config, detector_dynamic=True) is True
    config.multi_scale_detect = False
    assert plan_tiled_detect(config, detector_dynamic=True) is False
    config.multi_scale_detect = True
    assert plan_tiled_detect(config, detector_dynamic=False) is False


def test_inter_eye_distance() -> None:
    # 5-point kps: left_eye, right_eye, nose, mouth_l, mouth_r
    kps = np.array([[30, 40], [70, 43], [50, 60], [35, 80], [65, 80]], dtype="float32")
    # sqrt(40^2 + 3^2) ~= 40.11
    assert abs(inter_eye_distance(kps) - 40.112) < 0.01
    # Missing / malformed keypoints -> 0.0 (unknown), never a crash.
    assert inter_eye_distance(None) == 0.0
    assert inter_eye_distance(np.array([[30, 40]], dtype="float32")) == 0.0


def test_plan_tiles_small_image_is_single_tile() -> None:
    # An image at/under tile size needs no tiling.
    assert plan_tiles(400, 300, tile_size=512, overlap=0.2) == [(0, 0, 400, 300)]


def test_plan_tiles_covers_large_image_within_bounds() -> None:
    tiles = plan_tiles(1000, 600, tile_size=512, overlap=0.2)
    assert len(tiles) >= 4  # multiple overlapping tiles
    # Every tile is within image bounds and non-empty.
    for x0, y0, x1, y1 in tiles:
        assert 0 <= x0 < x1 <= 1000
        assert 0 <= y0 < y1 <= 600
    # Tiles collectively reach the far edges (coverage).
    assert max(t[2] for t in tiles) == 1000
    assert max(t[3] for t in tiles) == 600


def test_nms_boxes_suppresses_overlaps_keeps_disjoint() -> None:
    boxes = np.array(
        [
            [0, 0, 10, 10, 0.9],     # highest
            [1, 1, 11, 11, 0.8],     # overlaps box 0 heavily -> suppressed
            [100, 100, 110, 110, 0.7],  # disjoint -> kept
        ],
        dtype="float32",
    )
    keep = nms_boxes(boxes, iou_thresh=0.5)
    assert keep == [0, 2]


def test_tiled_detect_translates_boxes_to_global_coords() -> None:
    eng = _tiling_engine()
    bgr = np.zeros((1500, 2000, 3), dtype="uint8")  # large -> tiling engages
    boxes, kpss = eng._tiled_detect(bgr)
    assert boxes.shape[0] >= 2  # several tiles
    # All boxes within the ORIGINAL image bounds...
    assert boxes[:, 0].min() >= 0 and boxes[:, 2].max() <= 2000
    assert boxes[:, 1].min() >= 0 and boxes[:, 3].max() <= 1500
    # ...and at least one box is past the first tile, proving global translation
    # (not stuck in per-tile coordinates).
    assert boxes[:, 0].max() > 512
    assert kpss is not None and kpss.shape[0] == boxes.shape[0]
    # keypoints translated in lockstep with their box
    assert kpss[:, 0, 0].max() > 512


def test_tiled_detect_skips_small_images() -> None:
    eng = _tiling_engine()
    small = np.zeros((400, 400, 3), dtype="uint8")  # <= 2x detector -> no tiling
    boxes, kpss = eng._tiled_detect(small)
    assert boxes.shape[0] == 0


def test_merge_detections_dedupes_full_frame_and_tiles() -> None:
    eng = _tiling_engine()
    full_boxes = np.array([[0, 0, 100, 100, 0.95]], dtype="float32")
    full_kps = np.array([[[20, 30], [80, 30], [50, 55], [25, 80], [75, 80]]], dtype="float32")
    tile_boxes = np.array([[2, 2, 98, 98, 0.7], [500, 500, 560, 560, 0.8]], dtype="float32")
    tile_kps = np.array(
        [
            [[20, 30], [80, 30], [50, 55], [25, 80], [75, 80]],
            [[510, 520], [550, 520], [530, 540], [515, 555], [545, 555]],
        ],
        dtype="float32",
    )
    boxes, kpss = eng._merge_detections(full_boxes, full_kps, tile_boxes, tile_kps)
    # The full-frame box and its near-duplicate tile box collapse to one; the
    # disjoint tile box survives -> 2 total, highest score first.
    assert boxes.shape[0] == 2
    assert boxes[0, 4] == 0.95
    assert kpss is not None and kpss.shape[0] == 2


def test_alignment_error_is_zero_for_canonical_and_similarity_invariant() -> None:
    # Keypoints already in the canonical arrangement -> ~0 error.
    assert alignment_error(ARCFACE_DST) < 1e-4
    # A rotated + scaled + translated copy is the SAME face geometry -> still ~0
    # (a similarity transform must not look like a misalignment).
    theta = 0.3
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], dtype="float64")
    transformed = (1.7 * (ARCFACE_DST @ rot.T)) + np.array([40.0, -15.0])
    assert alignment_error(transformed) < 1e-4


def test_alignment_error_flags_distorted_geometry() -> None:
    # Eyes collapsed together + nose far off-centre = a non-canonical (bad-landmark
    # / extreme-pose) arrangement the canonical template cannot fit -> high error.
    bad = np.array([[52.0, 51.0], [60.0, 51.0], [90.0, 72.0], [42.0, 92.0], [71.0, 92.0]], dtype="float64")
    assert alignment_error(bad) > alignment_error(ARCFACE_DST) + 0.1
    # Missing / insufficient keypoints -> 0.0 (unknown), never a crash or false flag.
    assert alignment_error(None) == 0.0
    assert alignment_error(np.array([[1.0, 2.0]], dtype="float64")) == 0.0


def _recognition_attempt(
    *,
    strategy: str,
    landmarks: np.ndarray,
    vector: np.ndarray,
    fiqa_score: float | None,
) -> AlignmentRecognitionAttempt:
    normalized = np.asarray(vector, dtype="float32")
    normalized /= max(float(np.linalg.norm(normalized)), 1e-12)
    return AlignmentRecognitionAttempt(
        strategy=strategy,
        landmarks=np.asarray(landmarks, dtype="float32"),
        align_error=alignment_error(landmarks),
        aligned_bgr=np.zeros((112, 112, 3), dtype="uint8"),
        raw_embedding=normalized * 20.0,
        vector=normalized,
        norm_quality=0.5,
        fiqa_score=fiqa_score,
    )


def test_alignment_recovery_skips_child_scale_frontal_control() -> None:
    # Small child faces still use exactly one recognizer pass when their geometry
    # is sound; scale alone must not trigger expensive or destabilizing recovery.
    child_scale = (ARCFACE_DST * 0.28) + np.asarray([4.0, 7.0])
    assert alignment_error(child_scale) < 1e-4
    assert alignment_recovery_hypotheses(child_scale, (2, 4, 28, 36)) == []


def test_alignment_recovery_generates_profile_and_failed_landmark_hypotheses() -> None:
    profile = ARCFACE_DST.copy()
    profile[1, 0] = profile[0, 0] + 12.0
    profile[2, 0] = profile[0, 0] + 8.4
    profile[4, 0] = profile[3, 0] + 13.2
    profile_hypotheses = alignment_recovery_hypotheses(profile, (20, 20, 95, 112))
    assert profile_hypotheses
    assert min(row.align_error for row in profile_hypotheses) < alignment_error(profile) - 0.03

    swapped = ARCFACE_DST[[1, 0, 2, 4, 3]]
    failed_hypotheses = alignment_recovery_hypotheses(swapped, (20, 20, 95, 112))
    pair_fix = next(row for row in failed_hypotheses if row.strategy == "swap-eye-mouth-pairs")
    assert pair_fix.align_error < 1e-4

    outlier = ARCFACE_DST.copy()
    outlier[2] += np.asarray([35.0, -20.0])
    outlier_hypotheses = alignment_recovery_hypotheses(outlier, (20, 20, 95, 112))
    repaired = next(row for row in outlier_hypotheses if row.strategy == "repair-landmark-2")
    assert repaired.align_error < alignment_error(outlier) - 0.03


def test_alignment_recovery_ab_gate_accepts_only_consistent_quality_win() -> None:
    bad = ARCFACE_DST.copy()
    bad[2] += np.asarray([35.0, -20.0])
    original_vector = np.asarray([1.0, 0.0, 0.0], dtype="float32")
    original = _recognition_attempt(
        strategy="original-5pt",
        landmarks=bad,
        vector=original_vector,
        fiqa_score=0.30,
    )
    consistent = _recognition_attempt(
        strategy="repair-landmark-2",
        landmarks=ARCFACE_DST,
        vector=np.asarray([0.95, 0.31, 0.0], dtype="float32"),
        fiqa_score=0.62,
    )
    selected, gain = select_alignment_recovery(original, [consistent])
    assert selected is consistent
    assert gain > 0.30

    identity_drift = _recognition_attempt(
        strategy="bbox-canonical-warp",
        landmarks=ARCFACE_DST,
        vector=np.asarray([0.0, 1.0, 0.0], dtype="float32"),
        fiqa_score=0.95,
    )
    selected, gain = select_alignment_recovery(original, [identity_drift])
    assert selected is original and gain == 0.0

    no_quality_gain = _recognition_attempt(
        strategy="repair-landmark-2",
        landmarks=ARCFACE_DST,
        vector=original_vector,
        fiqa_score=0.33,
    )
    selected, gain = select_alignment_recovery(original, [no_quality_gain])
    assert selected is original and gain == 0.0

    mixed_quality_source = _recognition_attempt(
        strategy="repair-landmark-2",
        landmarks=ARCFACE_DST,
        vector=original_vector,
        fiqa_score=None,
    )
    mixed_quality_source.norm_quality = 1.0
    selected, gain = select_alignment_recovery(original, [mixed_quality_source])
    assert selected is original and gain == 0.0


def test_recognize_selects_recovery_and_preserves_control_on_rejection() -> None:
    bad = ARCFACE_DST.copy()
    bad[2] += np.asarray([35.0, -20.0])

    class FakeFace:
        bbox = np.asarray([20.0, 20.0, 95.0, 112.0], dtype="float32")
        embedding: np.ndarray

    def run(*, allow_recovery: bool) -> tuple[np.ndarray, FakeFace, list[str]]:
        engine = InsightFaceEmbeddingEngine.__new__(InsightFaceEmbeddingEngine)
        engine.flip_tta = False
        calls: list[str] = []

        def fake_attempt(
            _self: InsightFaceEmbeddingEngine,
            _source: np.ndarray,
            landmarks: np.ndarray,
            *,
            strategy: str,
        ) -> AlignmentRecognitionAttempt:
            calls.append(strategy)
            if strategy == "original-5pt":
                vector = np.asarray([1.0, 0.0, 0.0], dtype="float32")
                score = 0.30
            elif strategy == "repair-landmark-2" and allow_recovery:
                vector = np.asarray([0.97, 0.24, 0.0], dtype="float32")
                score = 0.70
            else:
                vector = np.asarray([0.0, 1.0, 0.0], dtype="float32")
                score = 0.90
            return _recognition_attempt(
                strategy=strategy,
                landmarks=landmarks,
                vector=vector,
                fiqa_score=score,
            )

        engine._recognition_attempt = types.MethodType(fake_attempt, engine)  # type: ignore[method-assign]
        face = FakeFace()
        vector = engine._recognize(np.zeros((128, 128, 3), dtype="uint8"), face, bad)
        return vector, face, calls

    rescued_vector, rescued_face, rescued_calls = run(allow_recovery=True)
    assert "original-5pt" in rescued_calls and len(rescued_calls) > 1
    assert rescued_face._vintrace_alignment["rescued"] is True
    assert rescued_face._vintrace_alignment["strategy"] == "repair-landmark-2"
    assert rescued_vector[0] > 0.9

    control_vector, control_face, control_calls = run(allow_recovery=False)
    assert len(control_calls) > 1
    assert control_face._vintrace_alignment["rescued"] is False
    assert np.allclose(control_vector, np.asarray([1.0, 0.0, 0.0], dtype="float32"))


def test_alignment_recovery_cache_and_scan_telemetry() -> None:
    class RecoveryEngine:
        model_name = "alignment-recovery-test"
        detect_cache_tag = "detector-test"
        alignment_recovery_version = "align-recovery-v1"

        def __init__(self) -> None:
            self.calls = 0

        def embed_loaded_image(self, _image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
            self.calls += 1
            rescued = bool(path and "rescued" in path.name)
            return [
                EmbeddingResult(
                    vector=[1.0] + [0.0] * 511,
                    quality=0.82,
                    bbox=(0, 0, 32, 32),
                    model_name=self.model_name,
                    pose_bucket="profile",
                    fiqa_score=0.82,
                    align_error=0.02 if rescued else 0.31,
                    alignment_rescued=rescued,
                    alignment_strategy="repair-landmark-2" if rescued else "",
                    alignment_original_error=0.38,
                    alignment_quality_gain=0.27 if rescued else 0.0,
                    alignment_attempts=3,
                )
            ]

    with tempfile.TemporaryDirectory(prefix="vintrace-alignment-recovery-") as temp:
        root = Path(temp)
        registry = root / "registry"
        old_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
        old_crossage_registry = os.environ.get("CROSSAGE_REGISTRY_HOME")
        os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
        os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
        try:
            rescued_path = root / "rescued.jpg"
            rejected_path = root / "rejected.jpg"
            reference_path = root / "reference.jpg"
            Image.new("RGB", (48, 48), color=(90, 120, 150)).save(rescued_path)
            Image.new("RGB", (48, 48), color=(120, 90, 150)).save(rejected_path)
            Image.new("RGB", (48, 48), color=(150, 120, 90)).save(reference_path)
            project = ProjectState(root / "workspace")
            project.config.safe_mode = False
            reference = ReferenceFace(
                ref_id="ref_alignment",
                person_name="Alignment Person",
                age_bucket="adult",
                source_path=str(reference_path),
                capture_date=None,
                quality=1.0,
                model_name=RecoveryEngine.model_name,
                vector=[1.0] + [0.0] * 511,
            )
            project.references[reference.ref_id] = reference
            project.vector_store.add(reference.ref_id, reference.vector)

            engine = RecoveryEngine()
            added, errors, metrics = project.scan_paths(
                [rescued_path, rejected_path],
                engine,
                total=2,
                source="alignment-first",
                label="alignment-first",
            )
            assert errors == [] and added == 2
            assert engine.calls == 2
            assert metrics["alignmentRecoveryAttempted"] == 2
            assert metrics["alignmentRecoverySucceeded"] == 1
            assert metrics["alignmentRecoveryRejected"] == 1
            rescued_candidate = next(
                row for row in project.candidates.values() if Path(row.source_path).name == rescued_path.name
            )
            assert "alignment-recovered" in rescued_candidate.risk_flags
            assert "repair-landmark-2" in rescued_candidate.note

            cached_engine = RecoveryEngine()
            _added, cached_errors, cached_metrics = project.scan_paths(
                [rescued_path, rejected_path],
                cached_engine,
                total=2,
                source="alignment-cached",
                label="alignment-cached",
            )
            assert cached_errors == [] and cached_engine.calls == 0
            assert cached_metrics["embeddingCacheHits"] == 2
            assert cached_metrics["alignmentRecoverySucceeded"] == 1
            assert cached_metrics["alignmentRecoveryRejected"] == 1
            assert project._embedding_cache_version(cached_engine).endswith("align-recovery-v1")
        finally:
            if old_registry is None:
                os.environ.pop("VINTRACE_REGISTRY_HOME", None)
            else:
                os.environ["VINTRACE_REGISTRY_HOME"] = old_registry
            if old_crossage_registry is None:
                os.environ.pop("CROSSAGE_REGISTRY_HOME", None)
            else:
                os.environ["CROSSAGE_REGISTRY_HOME"] = old_crossage_registry


def test_flip_average_is_unit_norm_and_idempotent() -> None:
    # Averaging an embedding with itself is a no-op (still the normalized direction).
    same = flip_average([3.0, 4.0] + [0.0] * 510, [3.0, 4.0] + [0.0] * 510)
    assert abs(float(np.linalg.norm(same)) - 1.0) < 1e-6
    assert abs(same[0] - 0.6) < 1e-6 and abs(same[1] - 0.8) < 1e-6
    # Averaging two different embeddings still yields a unit vector (safe for cosine).
    mixed = flip_average([1.0, 0.0] + [0.0] * 510, [0.0, 1.0] + [0.0] * 510)
    assert abs(float(np.linalg.norm(mixed)) - 1.0) < 1e-6


def test_apply_recognizer_preference_moves_drop_in_to_front() -> None:
    paths = [Path("glintr100.onnx"), Path("lvface_vit_b.onnx"), Path("w600k_r50.onnx")]
    # A configured drop-in recognizer (e.g. LVFace) is preferred without code edits.
    out = apply_recognizer_preference(paths, "lvface_vit_b.onnx")
    assert out[0].name == "lvface_vit_b.onnx"
    # Empty / unknown preference leaves the existing priority order untouched.
    assert apply_recognizer_preference(paths, "") == paths
    assert apply_recognizer_preference(paths, "nonexistent.onnx") == paths


def main() -> None:
    test_engine_fallback_preserves_redacted_load_error_detail()
    test_runtime_provider_failure_reloads_once_on_cpu()
    test_apply_recognizer_preference_moves_drop_in_to_front()
    test_alignment_error_is_zero_for_canonical_and_similarity_invariant()
    test_alignment_error_flags_distorted_geometry()
    test_alignment_recovery_skips_child_scale_frontal_control()
    test_alignment_recovery_generates_profile_and_failed_landmark_hypotheses()
    test_alignment_recovery_ab_gate_accepts_only_consistent_quality_win()
    test_recognize_selects_recovery_and_preserves_control_on_rejection()
    test_alignment_recovery_cache_and_scan_telemetry()
    test_flip_average_is_unit_norm_and_idempotent()
    test_tiled_detect_translates_boxes_to_global_coords()
    test_tiled_detect_skips_small_images()
    test_merge_detections_dedupes_full_frame_and_tiles()
    test_plan_tiles_small_image_is_single_tile()
    test_plan_tiles_covers_large_image_within_bounds()
    test_nms_boxes_suppresses_overlaps_keeps_disjoint()
    test_plan_detect_sizes_multi_scale()
    test_plan_detect_sizes_dedupes_when_equal()
    test_plan_detect_sizes_respects_flag_and_static_model()
    test_detect_cache_tag()
    test_plan_tiled_detect_is_quality_only()
    test_inter_eye_distance()
    print("detection units ok")


if __name__ == "__main__":
    main()
