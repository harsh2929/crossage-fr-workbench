"""Unit tests for detection planning (Phase 0.3) and rescue suspicion (Phase 1.4).

Run: PYTHONPATH=. .venv/bin/python tests/detection_units.py
"""

from __future__ import annotations

import numpy as np

from pathlib import Path

from crossage_fr.embed.engine import (
    InsightFaceEmbeddingEngine,
    apply_recognizer_preference,
    detect_cache_tag,
    flip_average,
    inter_eye_distance,
    nms_boxes,
    plan_detect_sizes,
    plan_tiles,
)


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
    test_apply_recognizer_preference_moves_drop_in_to_front()
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
    test_inter_eye_distance()
    print("detection units ok")


if __name__ == "__main__":
    main()
