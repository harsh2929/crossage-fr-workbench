"""PHOTO-07 assisted burst culling scorer, cache, and review-only contracts."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import json
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from crossage_fr.photo_culling import (
    PHOTO_CULLING_VERSION,
    analyze_culling_frame,
    build_photo_culling_result,
    clean_photo_culling_result,
    image_clarity_metrics,
    photo_culling_runtime_status,
    rank_culling_frames,
)
from photo_folders_units import _api


def checker_image(size: int = 256) -> Image.Image:
    image = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(image)
    cell = 16
    for y in range(0, size, cell):
        for x in range(0, size, cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(18, 28, 38))
    draw.ellipse((76, 60, 180, 190), outline=(210, 55, 68), width=5)
    return image


def test_clarity_and_explainable_ranking() -> None:
    runtime = photo_culling_runtime_status()
    assert runtime["available"] is True, runtime
    assert runtime["offline"] is True and runtime["automaticDeletion"] is False
    assert runtime["motionMethod"] == "directional-gradient-clarity-v1"
    sharp = checker_image()
    blurred = sharp.filter(ImageFilter.GaussianBlur(radius=6.0))
    array = cv2.cvtColor(np.asarray(sharp), cv2.COLOR_RGB2BGR)
    kernel = np.zeros((17, 17), dtype=np.float32)
    kernel[8, :] = 1.0 / 17.0
    motion = Image.fromarray(cv2.cvtColor(cv2.filter2D(array, -1, kernel), cv2.COLOR_BGR2RGB))
    sharp_metrics = image_clarity_metrics(sharp)
    blur_metrics = image_clarity_metrics(blurred)
    motion_metrics = image_clarity_metrics(motion)
    assert sharp_metrics["sharpness"] > blur_metrics["sharpness"] + 0.2, (sharp_metrics, blur_metrics)
    assert sharp_metrics["motionClarity"] > motion_metrics["motionClarity"], (sharp_metrics, motion_metrics)

    ranked = rank_culling_frames([
        {
            "assetId": "open-eyes",
            "sequence": 1,
            "sharpness": 0.90,
            "motionClarity": 0.88,
            "faceQuality": 0.82,
            "eyesOpen": 1.0,
            "faceSignalsAllowed": True,
        },
        {
            "assetId": "uncertain-eyes",
            "sequence": 2,
            "sharpness": 0.96,
            "motionClarity": 0.94,
            "faceQuality": 0.84,
            "eyesOpen": 0.22,
            "faceSignalsAllowed": True,
        },
        {
            "assetId": "blurred",
            "sequence": 3,
            "sharpness": 0.25,
            "motionClarity": 0.30,
            "faceQuality": None,
            "eyesOpen": None,
            "faceSignalsAllowed": False,
        },
    ])
    assert ranked[0]["assetId"] == "open-eyes", ranked
    assert ranked[0]["recommended"] is True and ranked[0]["rank"] == 1
    assert any(reason["code"] == "eyes-likely-open" for reason in ranked[0]["reasons"])
    assert any(reason["code"] == "eyes-uncertain" for reason in ranked[1]["reasons"])
    assert all(len(row["reasons"]) >= 3 for row in ranked)

    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "frame.png"
        sharp.save(source)
        no_consent = analyze_culling_frame(source, face_signals_allowed=False)
        assert no_consent["sharpness"] > 0
        assert no_consent["faceQuality"] is None and no_consent["eyesOpen"] is None
        assert no_consent["eyesConfidence"] == "consent-required"
        quality_fallback = analyze_culling_frame(
            source,
            face_signals_allowed=True,
            face_analyzer=lambda _image, _path: [{
                "bbox": [40, 30, 160, 180],
                "fiqaScore": None,
                "quality": 0.73,
            }],
        )
        assert quality_fallback["faceQuality"] == 0.73, quality_fallback
        assert quality_fallback["faceQualitySource"] == "embedding-quality-fallback"

    manifest = [
        {"assetId": "open-eyes", "contentHash": "1" * 64},
        {"assetId": "uncertain-eyes", "contentHash": "2" * 64},
        {"assetId": "blurred", "contentHash": "3" * 64},
    ]
    result = build_photo_culling_result(
        [deepcopy(row) for row in ranked],
        stack_id="burst_fixture",
        source_manifest=manifest,
        analyzed_at="2026-07-12T00:00:00Z",
        face_signals_allowed=True,
        provenance={
            "faceQualityModelId": "opencv-ediffiqa-tiny-jun2024",
            "faceQualityModelVersion": "fixture",
            "faceQualityLicense": "CC-BY-4.0",
            "faceEngine": "insightface-antelopev2",
        },
    )
    cleaned = clean_photo_culling_result(result)
    assert cleaned is not None
    assert cleaned["recommendationOnly"] is True and cleaned["automaticDeletion"] is False
    assert cleaned["provenance"]["offline"] is True
    assert "sourcePath" not in json.dumps(cleaned)
    tampered = deepcopy(result)
    tampered["recommendedAssetId"] = "uncertain-eyes"
    assert clean_photo_culling_result(tampered) is None
    tampered = deepcopy(result)
    tampered["provenance"]["faceEngine"] = "forged-engine"
    assert clean_photo_culling_result(tampered) is None
    try:
        rank_culling_frames([{"assetId": "valid"}, None])  # type: ignore[list-item]
        raise AssertionError("non-object culling frame accepted")
    except ValueError as exc:
        assert "must be an object" in str(exc)


def _write_burst_frame(path: Path, index: int) -> None:
    image = checker_image(192)
    if index == 2:
        image = image.filter(ImageFilter.GaussianBlur(radius=5.0))
    elif index == 3:
        image = image.filter(ImageFilter.GaussianBlur(radius=2.0))
    image.save(path, format="PNG")


def test_api_cache_consent_apply_idempotency_and_stale_source() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(tmp)
        media = root / "media"
        media.mkdir()
        paths: list[str] = []
        for index in range(1, 4):
            path = media / f"Culling Burst {index:04d}.png"
            _write_burst_frame(path, index)
            paths.append(str(path))
        imported = api.import_photos({
            "sourcePaths": paths,
            "storageMode": "referenced",
            "sourceLabel": "Assisted culling fixture",
        })
        assert imported["importedCount"] == 3, imported
        stack = api.list_photo_burst_stacks({"includeItems": True})["stacks"][0]
        stack_id = stack["stackId"]
        calls: list[str] = []

        def fixture_runner(asset, *, face_signals_allowed, face_analyzer):
            del face_analyzer
            name = Path(str(asset["sourcePath"])).name
            calls.append(name)
            sequence = int(name.split()[-1].split(".")[0])
            base = {
                1: (0.84, 0.82, 0.78, 1.0),
                2: (0.32, 0.35, 0.70, 1.0),
                3: (0.90, 0.88, 0.82, 0.22),
            }[sequence]
            return {
                "sharpness": base[0],
                "motionClarity": base[1],
                "faceQuality": base[2] if face_signals_allowed else None,
                "faceQualitySource": "ediffiqa-t" if face_signals_allowed else "unavailable",
                "eyesOpen": base[3] if face_signals_allowed else None,
                "eyesConfidence": "medium" if face_signals_allowed else "consent-required",
                "facesDetected": 1 if face_signals_allowed else 0,
                "faceSignalsAllowed": face_signals_allowed,
            }

        no_consent = api.analyze_photo_burst_culling(
            {"stackId": stack_id},
            frame_runner=fixture_runner,
        )
        assert no_consent["cached"] is False
        assert no_consent["result"]["faceSignalsAllowed"] is False
        assert no_consent["result"]["automaticDeletion"] is False
        assert all(row["faceQuality"] is None for row in no_consent["result"]["frames"])
        cached = api.analyze_photo_burst_culling(
            {"stackId": stack_id},
            frame_runner=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("cache miss")),
        )
        assert cached["cached"] is True

        api._cmd_set_consent({"value": True, "source": "photo-culling-test"})
        with_consent = api.analyze_photo_burst_culling(
            {"stackId": stack_id},
            frame_runner=fixture_runner,
        )
        result = with_consent["result"]
        assert with_consent["cached"] is False
        assert result["faceSignalsAllowed"] is True
        assert result["recommendedAssetId"] == stack["items"][0]["assetId"], result
        assert result["recommendationOnly"] is True and result["requiresReview"] is True
        assert result["provenance"]["faceQualitySource"] == "ediffiqa-t"
        assert len(calls) == 6, calls

        reopened = _api(tmp)
        listed = reopened.list_photo_burst_stacks({"includeItems": True})["stacks"][0]
        assert listed["culling"]["analysisId"] == result["analysisId"]
        try:
            reopened.apply_photo_culling_recommendation({
                "stackId": stack_id,
                "analysisId": result["analysisId"],
                "confirm": False,
                "idempotencyKey": "culling-apply-1",
            })
            raise AssertionError("culling recommendation applied without confirmation")
        except ValueError as exc:
            assert "explicit confirmation" in str(exc)

        before_hashes = {path: Path(path).read_bytes() for path in paths}
        applied = reopened.apply_photo_culling_recommendation({
            "stackId": stack_id,
            "analysisId": result["analysisId"],
            "resultSha256": result["resultSha256"],
            "confirm": True,
            "idempotencyKey": "culling-apply-1",
        })
        assert applied["idempotentReplay"] is False
        assert applied["automaticDeletion"] is False
        selected = applied["selection"]["stack"]
        keepers = [item for item in selected["items"] if item["keeper"]]
        assert len(keepers) == 1 and keepers[0]["assetId"] == result["recommendedAssetId"]
        assert all(Path(path).read_bytes() == payload for path, payload in before_hashes.items())
        assets = reopened.project.db.photo_assets_by_paths(paths)
        metadata = reopened.project.db.photo_asset_metadata_by_ids(asset["assetId"] for asset in assets)
        assert all(not row.get("hidden") and not row.get("deletedAt") for row in metadata.values())

        replay = reopened.apply_photo_culling_recommendation({
            "stackId": stack_id,
            "analysisId": result["analysisId"],
            "confirm": True,
            "idempotencyKey": "culling-apply-1",
        })
        assert replay["idempotentReplay"] is True

        Path(paths[1]).write_bytes(Path(paths[1]).read_bytes() + b"changed")
        stale_listed = reopened.list_photo_burst_stacks({"includeItems": True})["stacks"][0]
        assert "culling" not in stale_listed, stale_listed
        try:
            reopened.apply_photo_culling_recommendation({
                "stackId": stack_id,
                "analysisId": result["analysisId"],
                "confirm": True,
                "idempotencyKey": "culling-apply-after-change",
            })
            raise AssertionError("stale culling recommendation was applied")
        except ValueError as exc:
            assert "changed after analysis" in str(exc)


def main() -> None:
    test_clarity_and_explainable_ranking()
    test_api_cache_consent_apply_idempotency_and_stale_source()
    print("all photo_culling_units tests passed")


if __name__ == "__main__":
    main()
