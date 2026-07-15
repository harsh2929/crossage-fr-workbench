from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import argparse
import hashlib
import json
import os
import sys
import warnings

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_motion_clip(source: Path, destination: Path, *, seconds: int = 11, fps: int = 8) -> None:
    import cv2

    base = ImageOps.fit(Image.open(source).convert("RGB"), (640, 480), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(destination), cv2.VideoWriter_fourcc(*"MJPG"), float(fps), (640, 480))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not create the deterministic MJPG benchmark clip.")
    try:
        frame_count = max(16, int(seconds * fps))
        for index in range(frame_count):
            progress = index / max(1, frame_count - 1)
            shifted = Image.new("RGB", base.size, (16, 18, 22))
            offset_x = int(round(10.0 * np.sin(progress * np.pi * 2.0)))
            offset_y = int(round(6.0 * np.cos(progress * np.pi * 2.0)))
            shifted.paste(base, (offset_x, offset_y))
            shifted = ImageEnhance.Brightness(shifted).enhance(0.92 + 0.16 * progress)
            if index % 11 == 0:
                shifted = shifted.filter(ImageFilter.GaussianBlur(radius=1.8))
            bgr = cv2.cvtColor(np.asarray(shifted, dtype=np.uint8), cv2.COLOR_RGB2BGR)
            writer.write(bgr)
    finally:
        writer.release()


def markdown_report(payload: dict[str, object]) -> str:
    metrics = payload.get("metrics", {}) if isinstance(payload.get("metrics"), dict) else {}
    gates = payload.get("gates", {}) if isinstance(payload.get("gates"), dict) else {}
    lines = [
        "# Video Track Template Benchmark",
        "",
        f"- Protocol: `{payload.get('protocolVersion', '')}`",
        f"- Generated: {payload.get('generatedAt', '')}",
        f"- Status: **{payload.get('status', '')}**",
        f"- Engine: `{payload.get('engine', '')}`",
        "",
        "| Enrolled | Videos | Observations | Tracks | Templates | Keyframes | Matches | Correct | Wrong |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        "| {enrolled} | {videos} | {observations} | {tracks} | {templates} | {keyframes} | {matches} | {correct} | {wrong} |".format(
            enrolled=metrics.get("enrolled", 0),
            videos=metrics.get("videos", 0),
            observations=metrics.get("videoTrackObservations", 0),
            tracks=metrics.get("videoTracks", 0),
            templates=metrics.get("videoTrackTemplates", 0),
            keyframes=metrics.get("videoTrackKeyframes", 0),
            matches=metrics.get("videoTrackMatches", 0),
            correct=metrics.get("correctTracks", 0),
            wrong=metrics.get("wrongTracks", 0),
        ),
        "",
        "## Gates",
        "",
    ]
    lines.extend(f"- [{'x' if value else ' '}] {key}" for key, value in gates.items())
    lines.extend(("", "Clips are deterministic local transformations of an authorized AgeDB benchmark slice and are not redistributed."))
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the real-model video track template gate.")
    parser.add_argument("--acknowledge-research-terms", action="store_true")
    parser.add_argument("--dataset", default="benchmarks/public-data/prepared/agedb-40x4")
    parser.add_argument("--identities", type=int, default=4)
    parser.add_argument("--model-pack", choices=["antelopev2", "buffalo_l"], default="antelopev2")
    parser.add_argument("--model-root", default=str(Path.home() / ".insightface"))
    parser.add_argument("--results-dir", default="benchmarks/results")
    parser.add_argument("--workspace-root", default="benchmarks/public-data/workspaces")
    args = parser.parse_args()
    if not args.acknowledge_research_terms:
        raise SystemExit("Pass --acknowledge-research-terms for the authorized local AgeDB benchmark slice.")

    os.environ["VINTRACE_FORCE_FALLBACK"] = "0"
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "0"
    warnings.filterwarnings("ignore", message=r"`estimate` is deprecated.*", category=FutureWarning)

    from crossage_fr.api_server import DesktopApi
    import crossage_fr.embed.engine as engine_module
    from crossage_fr.match.video_tracks import VIDEO_TRACK_TEMPLATE_VERSION

    engine_module.get_providers = lambda _platform_key: ["CPUExecutionProvider"]

    dataset = (REPO_ROOT / args.dataset).resolve() if not Path(args.dataset).is_absolute() else Path(args.dataset).resolve()
    if not dataset.exists() or not dataset.is_dir():
        raise SystemExit(f"Authorized AgeDB slice is missing: {dataset}")
    manifest = dataset.parent / f"{dataset.name}-manifest.json"
    results_dir = (REPO_ROOT / args.results_dir).resolve() if not Path(args.results_dir).is_absolute() else Path(args.results_dir).resolve()
    workspace_root = (REPO_ROOT / args.workspace_root).resolve() if not Path(args.workspace_root).is_absolute() else Path(args.workspace_root).resolve()
    results_dir.mkdir(parents=True, exist_ok=True)
    workspace_root.mkdir(parents=True, exist_ok=True)
    os.environ["CROSSAGE_ORT_CACHE"] = str(workspace_root / "ort-cache")
    registry = workspace_root / "video-track-registry"
    os.environ.setdefault("VINTRACE_REGISTRY_HOME", str(registry))
    os.environ.setdefault("CROSSAGE_REGISTRY_HOME", str(registry))

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    api = DesktopApi(workspace_root / f"video-track-{stamp}", actor="video-track-benchmark")
    api.project.config.model_pack = args.model_pack
    api.project.config.model_root = str(Path(args.model_root).expanduser().resolve())
    api.project.config.safe_mode = False
    api.project.config.two_pass_scan = True
    api.project.save()
    api.project.set_consent(True, source="benchmark", operator="video-track-benchmark", scope="isolated")
    engine = api._engine_instance()

    clips = api.project.root / "clips"
    expected_by_source: dict[str, str] = {}
    enrolled = 0
    enroll_errors: list[str] = []
    identity_folders = [path for path in sorted(dataset.iterdir(), key=lambda item: item.name.casefold()) if path.is_dir()]
    for identity_index, folder in enumerate(identity_folders, start=1):
        images = [path for path in sorted(folder.iterdir(), key=lambda item: item.name.casefold()) if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        if not images:
            continue
        person_name = f"Track Subject {identity_index:03d}"
        added, errors, reviews = api.project.enroll_paths(person_name, "dataset-derived", [images[0]], engine)
        if reviews:
            raise RuntimeError(f"Video benchmark enrollment unexpectedly held {reviews} reference face(s) for review.")
        enroll_errors.extend(errors)
        if added < 1:
            continue
        clip = clips / f"track-{identity_index:03d}.avi"
        write_motion_clip(images[0], clip)
        expected_by_source[str(clip.resolve())] = person_name
        enrolled += 1
        if enrolled >= max(1, min(16, int(args.identities))):
            break

    if not expected_by_source:
        raise SystemExit("No benchmark identities could be enrolled with the full recognizer.")
    added, scan_errors, scan_metrics = api.project.scan_folder(clips, engine, source="video-track-benchmark", resume=False)
    candidates = [
        candidate
        for candidate in api.project._iter_authoritative_candidates(order="created")
        if candidate.media_kind == "video" and candidate.media_source_path in expected_by_source
    ]
    correct = sum(1 for candidate in candidates if candidate.person_name == expected_by_source.get(candidate.media_source_path))
    wrong = sum(1 for candidate in candidates if candidate.person_name != expected_by_source.get(candidate.media_source_path))
    source_counts = {
        source: sum(1 for candidate in candidates if candidate.media_source_path == source)
        for source in expected_by_source
    }
    full_recognizer = bool(engine.model_name) and not str(engine.model_name).startswith("local-image-fingerprint")
    metadata_complete = all(
        candidate.video_track_id
        and candidate.video_track_version == VIDEO_TRACK_TEMPLATE_VERSION
        and candidate.video_track_frame_count >= 2
        and 2 <= len(candidate.video_track_keyframe_indices) <= 5
        and len(candidate.video_track_keyframe_indices) == len(candidate.video_track_keyframe_timestamps_ms)
        and "video-track-template" in candidate.risk_flags
        for candidate in candidates
    )
    gates = {
        "fullFaceRecognizer": full_recognizer,
        "allRequestedIdentitiesEnrolled": enrolled == len(expected_by_source) == max(1, min(16, int(args.identities))),
        "multiFrameTracksBuilt": int(scan_metrics.get("videoTrackTemplates", 0) or 0) >= len(expected_by_source),
        "qualityKeyframesSelected": int(scan_metrics.get("videoTrackKeyframes", 0) or 0) >= len(expected_by_source) * 2,
        "qualityKeyframesReduceTrackFrames": int(scan_metrics.get("videoTrackKeyframes", 0) or 0) < int(scan_metrics.get("videoTrackObservations", 0) or 0),
        "frameRowsCollapsedToTracks": int(scan_metrics.get("videoTrackObservations", 0) or 0) > len(candidates),
        "oneCandidatePerVideoTrack": bool(candidates) and all(count == 1 for count in source_counts.values()),
        "allTrackMatchesCorrect": correct == len(expected_by_source) and wrong == 0,
        "trackMetadataComplete": metadata_complete,
        "noScanErrors": not scan_errors,
    }
    status = "pass" if all(gates.values()) else "fail"
    payload: dict[str, object] = {
        "schemaVersion": 1,
        "protocolVersion": "video-track-template-eval-v1",
        "templateVersion": VIDEO_TRACK_TEMPLATE_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "status": status,
        "engine": str(engine.model_name),
        "executionProvider": "CPUExecutionProvider",
        "datasetEvidence": {
            "dataset": "AgeDB prepared local research slice",
            "folderName": dataset.name,
            "manifestSha256": sha256_file(manifest) if manifest.exists() else "",
            "researchTermsAcknowledged": True,
            "training": False,
            "redistributed": False,
        },
        "metrics": {
            "enrolled": enrolled,
            "videos": len(expected_by_source),
            "scanAdded": added,
            "videoFrames": int(scan_metrics.get("videoFrames", 0) or 0),
            "videoTrackObservations": int(scan_metrics.get("videoTrackObservations", 0) or 0),
            "videoTracks": int(scan_metrics.get("videoTracks", 0) or 0),
            "videoTrackTemplates": int(scan_metrics.get("videoTrackTemplates", 0) or 0),
            "videoTrackSingletons": int(scan_metrics.get("videoTrackSingletons", 0) or 0),
            "videoTrackKeyframes": int(scan_metrics.get("videoTrackKeyframes", 0) or 0),
            "videoTrackMatches": int(scan_metrics.get("videoTrackMatches", 0) or 0),
            "correctTracks": correct,
            "wrongTracks": wrong,
            "candidateRows": len(candidates),
            "compressionRatio": round(int(scan_metrics.get("videoTrackObservations", 0) or 0) / max(1, len(candidates)), 4),
        },
        "gates": gates,
        "errors": {"enrollment": enroll_errors[:20], "scan": scan_errors[:20]},
    }
    json_path = results_dir / f"video-track-template-benchmark-{stamp}.json"
    markdown_path = results_dir / f"video-track-template-benchmark-{stamp}.md"
    latest_json = results_dir / "video-track-template-benchmark-latest.json"
    latest_markdown = results_dir / "video-track-template-benchmark-latest.md"
    encoded = json.dumps(payload, indent=2)
    json_path.write_text(encoded, encoding="utf-8")
    latest_json.write_text(encoded, encoding="utf-8")
    markdown = markdown_report(payload)
    markdown_path.write_text(markdown, encoding="utf-8")
    latest_markdown.write_text(markdown, encoding="utf-8")
    print(json.dumps({"status": status, "json": str(json_path), "markdown": str(markdown_path)}, indent=2))
    if status != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
