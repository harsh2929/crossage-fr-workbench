from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.ingest.video_io import sample_video_frames
from crossage_fr.workspace_registry import read_active_workspace


def make_identity_image(path: Path, seed: int, variant: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    base = ((seed * 37) % 180 + 35, (seed * 53) % 160 + 45, (seed * 71) % 150 + 55)
    image = Image.new("RGB", (280, 280), base)
    draw = ImageDraw.Draw(image)
    skin = (210 + seed % 20, 172 + seed % 25, 138 + seed % 30)
    x_shift = (variant % 3) * 4
    draw.ellipse((78 + x_shift, 54, 202 + x_shift, 184), fill=skin)
    draw.ellipse((110 + x_shift, 96, 124 + x_shift, 110), fill=(28, 28, 35))
    draw.ellipse((156 + x_shift, 96, 170 + x_shift, 110), fill=(28, 28, 35))
    draw.arc((112 + x_shift, 116, 170 + x_shift, 156), 12, 168, fill=(110, 52, 52), width=4)
    draw.rectangle((106, 170, 174, 260), fill=((seed * 19) % 180 + 40, (seed * 23) % 150 + 50, (seed * 29) % 120 + 60))
    image.save(path, quality=94)


def make_identity_video(path: Path, seed: int) -> bool:
    try:
        import cv2
        import numpy as np
    except Exception:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 4.0, (160, 160))
    if not writer.isOpened():
        return False
    try:
        for variant in range(8):
            frame = np.zeros((160, 160, 3), dtype=np.uint8)
            frame[:, :, 0] = (seed * 29 + variant * 7) % 180 + 40
            frame[:, :, 1] = (seed * 17 + variant * 11) % 160 + 50
            frame[:, :, 2] = (seed * 13 + variant * 5) % 150 + 60
            cv2.circle(frame, (82 + (variant % 2) * 4, 64), 34, (138, 172, 210), -1)
            cv2.circle(frame, (72, 58), 4, (20, 20, 20), -1)
            cv2.circle(frame, (94, 58), 4, (20, 20, 20), -1)
            cv2.putText(frame, str(seed), (56, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            writer.write(frame)
    finally:
        writer.release()
    return path.exists() and path.stat().st_size > 0


def main() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="vintrace-public-dataset-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    workspace = root / "workspace"
    dataset = root / "dataset"
    for identity_index, identity in enumerate(["Ada", "Grace", "Katherine", "Distractor"], start=1):
        for variant in range(4):
            make_identity_image(dataset / identity / f"{variant + 1:03d}.jpg", identity_index, variant)

    api = DesktopApi(workspace)
    catalog = api.handle("public_dataset_catalog", {})
    assert any(row["datasetId"] == "lfw" for row in catalog["datasets"])
    catalog_ids = {row["datasetId"] for row in catalog["datasets"]}
    assert {"calfw", "cplfw", "megaface", "ijbc", "agedb", "ytf", "fiw"}.issubset(catalog_ids)
    original_pack = api.project.config.model_pack
    original_root = api.project.config.model_root
    comparison = api.handle(
        "compare_public_dataset_models",
        {
            "datasetId": "custom",
            "folder": str(dataset),
            "maxIdentities": 2,
            "candidateImages": 1,
            "packs": ["antelopev2"],
        },
    )["value"]
    assert comparison["packs"][0]["pack"] == "antelopev2"
    assert comparison["packs"][0]["status"] in {"missing", "complete", "error"}
    assert "validationMatrix" in comparison["packs"][0]
    assert comparison["recommendation"]["status"] in {"unavailable", "keep", "switch"}
    assert Path(comparison["reportPath"]).exists()
    assert api.project.config.model_pack == original_pack
    assert api.project.config.model_root == original_root
    scored_rows = []
    for row in [
        {
            "pack": "antelopev2",
            "label": "Current",
            "metrics": {"precision": 1.0, "recall": 0.50, "wrongIdentity": 0, "falsePositives": 0},
            "metricsByThreshold": {"likely": {"precision": 1.0, "recall": 0.50}},
            "validationMatrix": {"pose:profile": {"recall": 0.30}},
            "pipeline": {"scanMetrics": {"poseRelaxedReviews": 0}},
        },
        {
            "pack": "buffalo_l",
            "label": "Pose",
            "metrics": {"precision": 1.0, "recall": 0.80, "wrongIdentity": 0, "falsePositives": 0},
            "metricsByThreshold": {"likely": {"precision": 1.0, "recall": 0.78}},
            "validationMatrix": {"pose:profile": {"recall": 0.72}},
            "pipeline": {"scanMetrics": {"poseRelaxedReviews": 0}},
        },
    ]:
        score = api._model_pack_recommendation_score(row)
        row["recommendationScore"] = score["score"]
        row["recommendationReasons"] = score["reasons"]
        scored_rows.append(row)
    recommendation = api._model_comparison_recommendation(scored_rows, current_pack="antelopev2")
    assert recommendation["status"] == "switch"
    assert recommendation["recommendedPack"] == "buffalo_l"
    assert recommendation["confidence"] in {"high", "medium"}
    inspection = api.handle("inspect_public_dataset", {"datasetId": "custom", "folder": str(dataset)})
    assert inspection["usableIdentityCount"] == 4
    assert inspection["imageCount"] == 16

    split_dataset = root / "split-dataset"
    for identity_index, identity in enumerate(["SplitAda", "SplitGrace"], start=10):
        for variant in range(3):
            make_identity_image(split_dataset / "train" / identity / f"{variant + 1:03d}.jpg", identity_index, variant)
    split_inspection = api.handle("inspect_public_dataset", {"datasetId": "custom", "folder": str(split_dataset)})
    assert split_inspection["identityCount"] == 2
    assert split_inspection["usableIdentityCount"] == 2
    assert split_inspection["imageCount"] == 6

    cfp_like = root / "cfp-like" / "Data" / "Images"
    for identity_index, identity in enumerate(["001", "002"], start=20):
        for pose in ["frontal", "profile"]:
            for variant in range(2):
                make_identity_image(cfp_like / identity / pose / f"{variant + 1:03d}.jpg", identity_index, variant)
    cfp_inspection = api.handle("inspect_public_dataset", {"datasetId": "cfp", "folder": str(root / "cfp-like")})
    assert cfp_inspection["identityCount"] == 2
    assert cfp_inspection["usableIdentityCount"] == 2
    assert cfp_inspection["imageCount"] == 8
    assert {sample["identity"] for sample in cfp_inspection["samples"]} == {"001", "002"}
    cfp_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "cfp",
            "folder": str(root / "cfp-like"),
            "maxIdentities": 2,
            "candidateImages": 2,
            "includeDistractors": False,
        },
    )["value"]
    cfp_labels = json.loads(Path(cfp_result["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert len(cfp_labels) == 4
    assert all("profile" in Path(row["sourceDatasetPath"]).parts for row in cfp_labels)
    assert all(row["poseBucket"] == "profile" for row in cfp_labels)
    assert cfp_result["validationMatrix"]["pose:profile"]["count"] == 4
    assert cfp_result["validationMatrix"]["all"]["evaluated"] == 4

    cplfw_like = root / "cplfw-like"
    for identity_index, identity in enumerate(["PoseAda", "PoseGrace"], start=30):
        for pose in ["frontal", "profile"]:
            for variant in range(2):
                make_identity_image(cplfw_like / identity / pose / f"{variant + 1:03d}.jpg", identity_index, variant)
    cplfw_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "cplfw",
            "folder": str(cplfw_like),
            "maxIdentities": 2,
            "candidateImages": 2,
            "includeDistractors": False,
        },
    )["value"]
    cplfw_labels = json.loads(Path(cplfw_result["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert len(cplfw_labels) == 4
    assert all("profile" in Path(row["sourceDatasetPath"]).parts for row in cplfw_labels)
    assert cplfw_result["validationMatrix"]["pose:profile"]["count"] == 4

    calfw_like = root / "calfw-like"
    for identity_index, identity in enumerate(["AgeAda", "AgeGrace"], start=40):
        for age_bucket in ["young", "old"]:
            for variant in range(2):
                make_identity_image(calfw_like / identity / age_bucket / f"{variant + 1:03d}.jpg", identity_index, variant)
    calfw_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "calfw",
            "folder": str(calfw_like),
            "maxIdentities": 2,
            "candidateImages": 2,
            "includeDistractors": False,
        },
    )["value"]
    calfw_labels = json.loads(Path(calfw_result["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert len(calfw_labels) == 4
    assert all("old" in Path(row["sourceDatasetPath"]).parts for row in calfw_labels)
    assert all(row["validationBucket"] == "age:cross-age" for row in calfw_labels)
    assert calfw_result["validationMatrix"]["age:cross-age"]["count"] == 4

    agedb_like = root / "agedb-like"
    for identity_index, identity in enumerate(["AgedAda", "AgedGrace"], start=50):
        for age in [18, 64, 66]:
            make_identity_image(agedb_like / identity / f"{identity}_{age}_1.jpg", identity_index, age)
    agedb_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "agedb",
            "folder": str(agedb_like),
            "maxIdentities": 2,
            "candidateImages": 1,
            "includeDistractors": False,
        },
    )["value"]
    agedb_labels = json.loads(Path(agedb_result["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert all(row["ageBucket"] == "older" for row in agedb_labels)
    assert agedb_result["validationMatrix"]["age:cross-age"]["count"] == 2

    ytf_like = root / "ytf-like"
    valid_videos = True
    for identity_index, identity in enumerate(["VideoAda", "VideoGrace"], start=60):
        make_identity_image(ytf_like / identity / "reference_01.jpg", identity_index, 1)
        make_identity_image(ytf_like / identity / "reference_02.jpg", identity_index, 2)
        valid_videos = make_identity_video(ytf_like / identity / "clip_01.mp4", identity_index) and valid_videos
    ytf_inspection = api.handle("inspect_public_dataset", {"datasetId": "ytf", "folder": str(ytf_like), "includeVideos": True})
    assert ytf_inspection["usableIdentityCount"] == 2
    assert ytf_inspection["videoCount"] == 2
    if valid_videos:
        video_cache = root / "ytf-frame-cache-check"
        first_samples = sample_video_frames(ytf_like / "VideoAda" / "clip_01.mp4", video_cache, max_frames=2, interval_seconds=0.5)
        second_samples = sample_video_frames(ytf_like / "VideoAda" / "clip_01.mp4", video_cache, max_frames=2, interval_seconds=0.5)
        assert [sample.path for sample in second_samples] == [sample.path for sample in first_samples]
        assert all(sample.path.exists() for sample in second_samples)
        assert any((video_cache / item).is_dir() and (video_cache / item / "manifest.json").exists() for item in os.listdir(video_cache))
        ytf_result = api.handle(
            "run_public_dataset_benchmark",
            {
                "datasetId": "ytf",
                "folder": str(ytf_like),
                "maxIdentities": 2,
                "candidateImages": 1,
                "includeVideos": True,
                "includeDistractors": False,
                "videoFrameSamples": 2,
                "videoFrameIntervalSeconds": 0.5,
            },
        )["value"]
        assert ytf_result["selected"]["videoFiles"] == 2
        assert ytf_result["selected"]["videoFrames"] == 4
        assert ytf_result["pipeline"]["videoDecodeFailures"] == []
        assert ytf_result["validationMatrix"]["media:video"]["count"] == 4

    ytf_bad = root / "ytf-bad"
    for identity_index, identity in enumerate(["BrokenAda", "BrokenGrace"], start=65):
        make_identity_image(ytf_bad / identity / "reference_01.jpg", identity_index, 1)
        make_identity_image(ytf_bad / identity / "reference_02.jpg", identity_index, 2)
        (ytf_bad / identity / "broken.mp4").write_bytes(b"not-a-real-video")
    ytf_bad_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "ytf",
            "folder": str(ytf_bad),
            "maxIdentities": 2,
            "candidateImages": 1,
            "includeVideos": True,
            "includeDistractors": False,
            "videoFrameSamples": 2,
        },
    )["value"]
    assert ytf_bad_result["selected"]["videoFiles"] == 2
    assert ytf_bad_result["selected"]["videoFrames"] == 0
    assert len(ytf_bad_result["pipeline"]["videoDecodeFailures"]) == 2
    assert ytf_bad_result["metrics"]["evaluated"] == 0

    fiw_like = root / "fiw-like"
    for identity_index, identity in enumerate(["P1", "P2", "P3"], start=70):
        for variant in range(3):
            make_identity_image(fiw_like / "F0001" / identity / f"{variant + 1:03d}.jpg", identity_index, variant)
    fiw_result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "fiw",
            "folder": str(fiw_like),
            "maxIdentities": 2,
            "candidateImages": 1,
            "includeDistractors": True,
            "negativeIdentities": 1,
        },
    )["value"]
    fiw_labels = json.loads(Path(fiw_result["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert any(row["validationBucket"] == "hard-negative:family-lookalike" for row in fiw_labels)
    assert fiw_result["validationMatrix"]["hard-negative:family-lookalike"]["count"] == 1

    result = api.handle(
        "run_public_dataset_benchmark",
        {
            "datasetId": "custom",
            "folder": str(dataset),
            "maxIdentities": 3,
            "candidateImages": 2,
            "includeDistractors": True,
            "negativeIdentities": 1,
        },
    )
    value = result["value"]
    assert value["selected"]["identities"] == 3
    assert value["selected"]["distractorIdentities"] == 1
    assert value["metrics"]["evaluated"] == 8
    assert value["validationMatrix"]["all"]["count"] == 8
    assert value["validationMatrix"]["media:image"]["count"] == 8
    assert Path(value["reportPath"]).exists()
    assert Path(value["labelsJsonPath"]).exists()
    assert Path(value["labelsCsvPath"]).exists()
    labels = json.loads(Path(value["labelsJsonPath"]).read_text(encoding="utf-8"))["labels"]
    assert len(labels) == 8
    assert read_active_workspace() == workspace.resolve()
    print(json.dumps({"ok": True, "metrics": value["metrics"], "reportPath": value["reportPath"]}, indent=2))


if __name__ == "__main__":
    main()
