from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw


CATALOG_SHA256 = "63a31351f11b68fdeb9f739061df5e1fc85fae6dd25914bb589eabe8af19cc75"


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update({
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
        "CROSSAGE_FORCE_FALLBACK": "1",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "NO_PROXY": "*",
        "no_proxy": "*",
        "HTTP_PROXY": "",
        "HTTPS_PROXY": "",
        "ALL_PROXY": "",
        "http_proxy": "",
        "https_proxy": "",
        "all_proxy": "",
    })
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    wait_ready(process)
    return process


def stop_backend(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def make_fixture(path: Path, index: int) -> None:
    image = Image.new("RGB", (128, 88), (38 + index * 24, 76 + index * 12, 118))
    draw = ImageDraw.Draw(image)
    draw.rectangle((18 + index * 4, 20, 58 + index * 5, 58), fill=(212, 72 + index * 15, 68))
    draw.line((0, 70 - index * 5, 127, 24 + index * 6), fill=(238, 206, 96), width=3)
    image.save(path, format="PNG")


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_STORY_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    installed_root = Path(str(os.environ.get("VINTRACE_STORY_TEST_MODEL_ROOT", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_STORY_TEST_EXECUTABLE must point to the frozen backend.")
    if not installed_root.is_dir():
        raise SystemExit("VINTRACE_STORY_TEST_MODEL_ROOT must point to a verified installed VLM root.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-story-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        registry_model_root = registry / "models" / "vlm"
        registry_model_root.parent.mkdir(parents=True, exist_ok=True)
        try:
            registry_model_root.symlink_to(installed_root, target_is_directory=True)
        except OSError:
            shutil.copytree(installed_root, registry_model_root, copy_function=shutil.copy2)

        media_root = root / "story-media"
        media_root.mkdir()
        source_paths: list[str] = []
        source_hashes: dict[str, str] = {}
        for index in range(4):
            source = media_root / f"chapter-{index + 1}.png"
            make_fixture(source, index)
            source_paths.append(str(source))
            source_hashes[str(source)] = hashlib.sha256(source.read_bytes()).hexdigest()

        process = start_backend(executable, workspace, registry)
        try:
            status = rpc(
                process,
                "story-status",
                "photo_story_status",
                {"modelTier": "quality", "powerMode": "performance"},
            ).get("value", {})
            assert status.get("available") is True and status.get("offline") is True, status
            assert status.get("privacyDefault") == "path-free-local", status
            assert status.get("route", {}).get("tier") == "quality", status
            assert "modelStatus" not in status, status

            imported = rpc(
                process,
                "import",
                "import_photos",
                {"sourcePaths": source_paths, "storageMode": "referenced", "sourceLabel": "Frozen story acceptance"},
            ).get("value", {})
            assert imported.get("importedCount") == 4, imported
            source_paths = [str(path) for path in imported.get("importedPaths", [])]
            assert len(source_paths) == 4, imported
            assets = rpc(process, "assets", "list_photo_assets", {"limit": 10}).get("items", [])
            assert len(assets) == 4, assets
            assets.sort(key=lambda item: str(item.get("sourcePath", "")))
            for index, asset in enumerate(assets):
                rpc(
                    process,
                    f"metadata-{index}",
                    "update_photo_asset_metadata",
                    {
                        "assetId": asset["assetId"],
                        "title": f"Hill day {index + 1}",
                        "caption": f"A factual hill journey photo number {index + 1}.",
                        "captureDate": f"2026-05-{index + 1:02d}T10:00:00Z",
                    },
                )
            memory = rpc(
                process,
                "memory",
                "save_photo_user_memory",
                {"name": "Frozen Hills Story", "subtitle": "Four local photos", "sourcePaths": source_paths},
            ).get("value", {})
            memory_id = str(memory.get("memoryId", ""))
            assert memory_id, memory

            generated = rpc(
                process,
                "generate",
                "generate_photo_story",
                {
                    "memoryId": memory_id,
                    "confirm": True,
                    "idempotencyKey": "frozen-photo-story-v1",
                    "style": "journal",
                    "chapterCount": 2,
                    "modelTier": "quality",
                    "powerMode": "performance",
                    "generateMissingCaptions": False,
                },
            ).get("value", {})
            story = generated.get("story", {})
            assert generated.get("idempotentReplay") is False, generated
            assert len(story.get("chapters", [])) == 2, story
            assert story.get("generation", {}).get("route", {}).get("tier") == "quality", story
            assert story.get("generation", {}).get("offline") is True, story
            assert story.get("generation", {}).get("humanReviewRequired") is True, story
            assert story.get("revision") == 1 and story.get("humanEdited") is False, story
            story_json = json.dumps(story, ensure_ascii=False)
            assert str(media_root) not in story_json and "sourcePath" not in story_json, story
            assert all(source.read_bytes() for source in map(Path, source_paths))
            assert all(hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest for path, digest in source_hashes.items())

            replay = rpc(
                process,
                "replay",
                "generate_photo_story",
                {
                    "memoryId": memory_id,
                    "confirm": True,
                    "idempotencyKey": "frozen-photo-story-v1",
                },
            ).get("value", {})
            assert replay.get("idempotentReplay") is True, replay
            assert replay.get("story", {}).get("id") == story.get("id"), replay
            story_id = str(story["id"])
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            listed = rpc(reopened, "list", "photo_stories", {"memoryId": memory_id}).get("value", {})
            assert listed.get("total") == 1, listed
            persisted = listed.get("stories", [{}])[0]
            assert persisted.get("id") == story_id and persisted.get("revision") == 1, persisted
            assert str(media_root) not in json.dumps(persisted), persisted

            chapters = deepcopy(persisted["chapters"])
            chapters.reverse()
            chapters[0]["title"] = "Edited closing chapter"
            chapters[0]["narrative"] = "A human reviewed and edited this local narrative."
            chapters[0]["captions"][0]["text"] = "A reviewed local caption."
            edited = rpc(
                reopened,
                "edit",
                "save_photo_story",
                {
                    "storyId": story_id,
                    "expectedRevision": 1,
                    "title": "Edited Frozen Hills Story",
                    "subtitle": persisted.get("subtitle", ""),
                    "style": persisted.get("style", "journal"),
                    "chapters": chapters,
                },
            ).get("value", {})
            saved_story = edited.get("story", {})
            assert edited.get("saved") is True, edited
            assert saved_story.get("revision") == 2 and saved_story.get("humanEdited") is True, saved_story
            assert len(saved_story.get("history", [])) == 1, saved_story

            exported = rpc(reopened, "export", "export_photo_story", {"storyId": story_id}).get("value", {})
            markdown_path = Path(str(exported.get("markdownPath", "")))
            json_path = Path(str(exported.get("jsonPath", "")))
            assert markdown_path.is_file() and json_path.is_file(), exported
            markdown = markdown_path.read_text(encoding="utf-8")
            payload = json_path.read_text(encoding="utf-8")
            assert str(media_root) not in markdown and str(media_root) not in payload
            assert json.loads(payload).get("pathFree") is True

            movie = rpc(
                reopened,
                "movie-project",
                "create_photo_story_slideshow",
                {"storyId": story_id},
            ).get("value", {})
            project = movie.get("project", {})
            assert project.get("storyId") == story_id, project
            assert project.get("storyContentSha256") == saved_story.get("currentContentSha256"), project
            assert len(project.get("timelineItems", [])) == 4, project
            assert all(item.get("chapterId") for item in project.get("timelineItems", [])), project

            slideshow = rpc(
                reopened,
                "slideshow-export",
                "export_photo_slideshow",
                {**project, "outputMode": "html"},
            ).get("value", {})
            manifest_path = Path(str(slideshow.get("manifestPath", "")))
            assert manifest_path.is_file(), slideshow
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            assert manifest.get("storyId") == story_id, manifest
            assert manifest.get("storyContentSha256") == saved_story.get("currentContentSha256"), manifest
            assert len(manifest.get("chapters", [])) == 3, manifest
        finally:
            stop_backend(reopened)

        print(json.dumps({
            "frozen": True,
            "catalogSha256": CATALOG_SHA256,
            "realLocalStory": True,
            "idempotentReplay": True,
            "restartPersistence": True,
            "editableHistory": True,
            "pathFreeExport": True,
            "slideshowIntegration": True,
            "originalsUnchanged": True,
            "offline": True,
        }, sort_keys=True))


if __name__ == "__main__":
    main()
