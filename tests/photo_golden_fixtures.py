"""Deterministic Photos golden fixture pack.

Run:
  PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_golden_fixtures.py
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from crossage_fr.api_server import DesktopApi


GOLDEN_SCHEMA_VERSION = 1
GOLDEN_GENERATED_AT = "2026-06-27T00:00:00Z"
REQUIRED_CATEGORIES = {
    "duplicate-exact",
    "duplicate-near",
    "exif-gps-camera",
    "heic-optional",
    "live-photo-pair",
    "local-document",
    "local-qr",
    "local-receipt",
    "raw-placeholder",
    "screenshot",
    "short-video",
}
GOLDEN_QR_PAYLOAD = "https://example.invalid/vintrace/golden"


def _api(tmp: Path) -> DesktopApi:
    os.environ["VINTRACE_REGISTRY_HOME"] = str(tmp / "registry")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(tmp / "registry")
    return DesktopApi(tmp / "workspace")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_exif_jpeg(path: Path, *, color: tuple[int, int, int] = (42, 99, 175), marker: str = "") -> None:
    from PIL import ExifTags, Image, ImageDraw, TiffImagePlugin

    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (40, 28), color)
    if marker:
        ImageDraw.Draw(image).text((3, 10), marker[:8], fill=(255, 255, 255))
    exif = Image.Exif()
    exif[306] = "2026:06:20 09:08:07"
    exif[271] = "VintraceFixtureMake"
    exif[272] = "VintraceFixtureCam"
    rational = TiffImagePlugin.IFDRational
    exif[ExifTags.IFD.GPSInfo] = {
        1: "N",
        2: (rational(36, 1), rational(58, 1), rational(2664, 100)),
        3: "W",
        4: (rational(122, 1), rational(1, 1), rational(508, 100)),
    }
    image.save(path, exif=exif, quality=92)


def _write_labelled_png(path: Path, label: str, *, color: tuple[int, int, int]) -> None:
    from PIL import Image, ImageDraw

    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (96, 64), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((6, 6, 90, 58), outline=(255, 255, 255), width=2)
    draw.text((12, 25), label[:16], fill=(255, 255, 255))
    image.save(path)


def _write_pattern_jpeg(path: Path, variant: str) -> None:
    from PIL import Image

    image = Image.new("RGB", (48, 48), (0, 0, 0))
    pixels = image.load()
    for y in range(48):
        for x in range(48):
            base = 220 if (x // 3 + y // 3) % 2 else 35
            if variant == "near" and 20 <= x < 25 and 20 <= y < 25:
                base = 255 - base
            if variant == "different":
                base = (x * 5 + y * 3) % 255
            pixels[x, y] = (base, max(0, base - 24), min(255, base + 16))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=92)


def _write_near_duplicate_jpegs(first: Path, second: Path) -> None:
    from PIL import Image

    image = Image.new("RGB", (48, 48), (0, 0, 0))
    pixels = image.load()
    for y in range(48):
        for x in range(48):
            value = 210 if (x // 4 + y // 4) % 2 else 45
            pixels[x, y] = (value, value, max(0, value - 10))
    first.parent.mkdir(parents=True, exist_ok=True)
    image.save(first, quality=92, comment=b"near duplicate A")
    image.save(second, quality=92, comment=b"near duplicate B")


def _write_qr_png(path: Path, payload: str) -> dict[str, Any]:
    try:
        import cv2

        create_encoder = getattr(cv2, "QRCodeEncoder_create", None)
        if callable(create_encoder):
            image = create_encoder().encode(payload)
            image = cv2.copyMakeBorder(image, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
            image = cv2.resize(image, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
            path.parent.mkdir(parents=True, exist_ok=True)
            if cv2.imwrite(str(path), image):
                decoded = ""
                try:
                    decoded = str(cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(path)))[0] or "")
                except Exception:
                    decoded = ""
                if decoded == payload:
                    return {"realQr": True, "source": "opencv-encoder", "decoded": decoded}
    except Exception:
        pass

    from PIL import Image, ImageDraw

    scale = 6
    cells = 21
    image = Image.new("RGB", (cells * scale, cells * scale), "white")
    draw = ImageDraw.Draw(image)

    def finder(x0: int, y0: int) -> None:
        draw.rectangle((x0, y0, x0 + 6, y0 + 6), fill="black")
        draw.rectangle((x0 + 1, y0 + 1, x0 + 5, y0 + 5), fill="white")
        draw.rectangle((x0 + 2, y0 + 2, x0 + 4, y0 + 4), fill="black")

    finder(1, 1)
    finder(13, 1)
    finder(1, 13)
    for y in range(cells):
        for x in range(cells):
            if (x < 8 and y < 8) or (x > 12 and y < 8) or (x < 8 and y > 12):
                continue
            if (x * 3 + y * 5) % 7 in {0, 1, 4}:
                draw.rectangle((x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1), fill="black")
    image.save(path)
    return {"realQr": False, "source": "deterministic-fallback", "decoded": ""}


def _write_tiny_video(path: Path) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import cv2
        import numpy as np

        for codec in ("mp4v", "avc1", "MJPG", "XVID"):
            writer = None
            try:
                writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), 6.0, (64, 64))
                if not writer.isOpened():
                    writer.release()
                    continue
                for index in range(8):
                    frame = np.zeros((64, 64, 3), dtype=np.uint8)
                    frame[:, :, 0] = 40 + index * 12
                    frame[:, :, 1] = 120
                    frame[:, :, 2] = 220 - index * 9
                    cv2.putText(frame, str(index), (18, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                    writer.write(frame)
                writer.release()
                if path.exists() and path.stat().st_size > 0:
                    return {"available": True, "source": "opencv", "placeholder": False}
            except Exception:
                if writer is not None:
                    try:
                        writer.release()
                    except Exception:
                        pass
    except Exception:
        pass

    ffmpeg = shutil.which("ffmpeg") or ""
    if not ffmpeg:
        try:
            import imageio_ffmpeg

            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg = ""
    if ffmpeg:
        completed = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=64x64:rate=6",
                "-t",
                "1.2",
                "-pix_fmt",
                "yuv420p",
                "-y",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if completed.returncode == 0 and path.exists() and path.stat().st_size > 0:
            return {"available": True, "source": "ffmpeg", "placeholder": False}

    path.write_bytes(b"vintrace placeholder video fixture\n")
    return {"available": True, "source": "placeholder", "placeholder": True}


def _write_optional_heic(path: Path) -> dict[str, Any]:
    try:
        import pillow_heif
        from PIL import Image

        pillow_heif.register_heif_opener()
        image = Image.new("RGB", (40, 30), (88, 120, 190))
        path.parent.mkdir(parents=True, exist_ok=True)
        pillow_heif.from_pillow(image).save(path)
        return {"available": True, "reason": ""}
    except Exception as exc:
        return {"available": False, "reason": f"pillow-heif unavailable: {exc}"}


def _entry(path: Path, *, category: str, role: str, import_primary: bool, expected: dict[str, Any] | None = None, optional: bool = False, available: bool = True, note: str = "") -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": path.stem,
        "path": str(path),
        "filename": path.name,
        "category": category,
        "role": role,
        "importPrimary": import_primary and available,
        "optional": optional,
        "available": available,
        "expected": expected or {},
        "note": note,
    }
    if available and path.exists():
        item["bytes"] = path.stat().st_size
        item["sha256"] = _sha256(path)
    return item


def build_photo_golden_fixture_pack(root: Path) -> dict[str, Any]:
    media = root / "media"
    media.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []

    exif = media / "exif-gps-camera.jpg"
    _write_exif_jpeg(exif)
    entries.append(_entry(
        exif,
        category="exif-gps-camera",
        role="primary",
        import_primary=True,
        expected={
            "captureDate": "2026-06-20",
            "cameraMake": "VintraceFixtureMake",
            "cameraModel": "VintraceFixtureCam",
            "gps": {"latitude": "36.974067", "longitude": "-122.018078"},
        },
    ))

    screenshot = media / "Screen Shot 2026-06-20 at 9.08.07 AM.png"
    _write_labelled_png(screenshot, "SCREEN", color=(41, 86, 128))
    entries.append(_entry(screenshot, category="screenshot", role="primary", import_primary=True, expected={"mediaKind": "screenshot"}))

    document = media / "document-note.png"
    _write_labelled_png(document, "DOC", color=(60, 60, 60))
    document.with_suffix(".txt").write_text("Synthetic document OCR text: invoice reference DOC-42\n", encoding="utf-8")
    entries.append(_entry(document, category="local-document", role="primary", import_primary=True, expected={"ocrSidecar": "document-note.txt"}))
    entries.append(_entry(document.with_suffix(".txt"), category="local-document", role="ocr-sidecar", import_primary=False))

    receipt = media / "receipt-cafe.png"
    _write_labelled_png(receipt, "RECEIPT", color=(100, 75, 45))
    receipt.with_suffix(".txt").write_text("Cafe receipt total $18.50 paid locally\n", encoding="utf-8")
    entries.append(_entry(receipt, category="local-receipt", role="primary", import_primary=True, expected={"ocrSidecar": "receipt-cafe.txt"}))
    entries.append(_entry(receipt.with_suffix(".txt"), category="local-receipt", role="ocr-sidecar", import_primary=False))

    qr = media / "qr-ticket.png"
    qr_status = _write_qr_png(qr, GOLDEN_QR_PAYLOAD)
    qr.with_suffix(".txt").write_text(f"QR payload: {GOLDEN_QR_PAYLOAD}\n", encoding="utf-8")
    entries.append(_entry(qr, category="local-qr", role="primary", import_primary=True, expected={"qrPayload": GOLDEN_QR_PAYLOAD, **qr_status}))
    entries.append(_entry(qr.with_suffix(".txt"), category="local-qr", role="ocr-sidecar", import_primary=False))

    video = media / "short-clip.mp4"
    video_status = _write_tiny_video(video)
    entries.append(_entry(video, category="short-video", role="primary", import_primary=True, expected={"mediaKind": "video", **video_status}, note="Uses a real tiny video when OpenCV/FFmpeg is available, otherwise a local placeholder."))

    duplicate_a = media / "duplicate-exact-a.jpg"
    duplicate_b = media / "duplicate-exact-b.jpg"
    _write_pattern_jpeg(duplicate_a, "different")
    duplicate_b.write_bytes(duplicate_a.read_bytes())
    entries.append(_entry(duplicate_a, category="duplicate-exact", role="primary", import_primary=True, expected={"duplicateGroup": "exact"}))
    entries.append(_entry(duplicate_b, category="duplicate-exact", role="primary", import_primary=True, expected={"duplicateGroup": "exact"}))

    near_a = media / "duplicate-near-a.jpg"
    near_b = media / "duplicate-near-b.jpg"
    _write_near_duplicate_jpegs(near_a, near_b)
    entries.append(_entry(near_a, category="duplicate-near", role="primary", import_primary=True, expected={"duplicateGroup": "near"}))
    entries.append(_entry(near_b, category="duplicate-near", role="primary", import_primary=True, expected={"duplicateGroup": "near"}))

    raw_primary = media / "raw-placeholder-primary.jpg"
    raw_sidecar = media / "raw-placeholder-primary.dng"
    _write_exif_jpeg(raw_primary, color=(120, 80, 40), marker="RAW")
    raw_sidecar.write_bytes(b"synthetic raw placeholder bytes; not a licensed camera RAW\n")
    entries.append(_entry(raw_primary, category="raw-placeholder", role="primary", import_primary=True, expected={"pairedRaw": raw_sidecar.name}))
    entries.append(_entry(raw_sidecar, category="raw-placeholder", role="raw-sidecar", import_primary=False, expected={"mediaKind": "raw"}))

    raw_standalone = media / "raw-placeholder-standalone.dng"
    raw_standalone.write_bytes(b"synthetic standalone raw placeholder bytes\n")
    entries.append(_entry(raw_standalone, category="raw-placeholder", role="primary", import_primary=True, expected={"mediaKind": "raw"}))

    heic = media / "optional-heic.heic"
    heic_status = _write_optional_heic(heic)
    entries.append(_entry(
        heic,
        category="heic-optional",
        role="primary",
        import_primary=heic_status["available"],
        expected={"mediaKind": "image"},
        optional=True,
        available=heic_status["available"],
        note=heic_status["reason"],
    ))

    live_still = media / "live-photo-pair.jpg"
    live_motion = media / "live-photo-pair.MOV"
    _write_exif_jpeg(live_still, color=(48, 125, 84), marker="LIVE")
    motion_status = _write_tiny_video(live_motion)
    entries.append(_entry(live_still, category="live-photo-pair", role="primary", import_primary=True, expected={"mediaKind": "live_photo", "pairedMotion": live_motion.name, **motion_status}))
    entries.append(_entry(live_motion, category="live-photo-pair", role="paired-motion", import_primary=False, expected={"mediaKind": "video"}))

    import_paths = [entry["path"] for entry in entries if entry["importPrimary"]]
    manifest = {
        "schemaVersion": GOLDEN_SCHEMA_VERSION,
        "generatedAt": GOLDEN_GENERATED_AT,
        "root": str(root),
        "categories": sorted({entry["category"] for entry in entries}),
        "requiredCategories": sorted(REQUIRED_CATEGORIES),
        "importPaths": import_paths,
        "entries": entries,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def _entry_by_filename(manifest: dict[str, Any], filename: str) -> dict[str, Any]:
    for entry in manifest["entries"]:
        if entry["filename"] == filename:
            return entry
    raise AssertionError(f"Missing fixture entry: {filename}")


def test_photo_golden_fixture_pack_manifest_and_import() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        manifest = build_photo_golden_fixture_pack(base / "golden-photos")
        saved_manifest = json.loads((base / "golden-photos" / "manifest.json").read_text(encoding="utf-8"))
        assert saved_manifest["schemaVersion"] == GOLDEN_SCHEMA_VERSION, saved_manifest
        assert REQUIRED_CATEGORIES <= set(saved_manifest["categories"]), saved_manifest["categories"]
        assert all(Path(entry["path"]).exists() for entry in saved_manifest["entries"] if entry["available"]), saved_manifest
        assert all(entry.get("sha256") == _sha256(Path(entry["path"])) for entry in saved_manifest["entries"] if entry["available"]), saved_manifest

        api = _api(base)
        imported = api.import_photos({
            "sourcePaths": manifest["importPaths"],
            "storageMode": "referenced",
            "sourceLabel": "Photos golden fixture pack",
        })
        assert imported["importedCount"] == len(manifest["importPaths"]), imported
        imported_by_name = {Path(source_path).name: source_path for source_path in imported["importedPaths"]}

        def asset(filename: str) -> dict[str, Any]:
            entry = _entry_by_filename(manifest, filename)
            row = api.project.db.photo_asset_by_path(imported_by_name.get(filename, entry["path"]))
            assert row is not None, entry
            return row

        exif_asset = asset("exif-gps-camera.jpg")
        assert exif_asset["captureDate"] == "2026-06-20", exif_asset
        exif = exif_asset["metadata"]["exif"]
        assert exif["cameraMake"] == "VintraceFixtureMake", exif
        assert exif["cameraModel"] == "VintraceFixtureCam", exif
        assert exif["gps"]["latitude"] == "36.974067", exif
        assert exif["gps"]["longitude"] == "-122.018078", exif

        screenshot_asset = asset("Screen Shot 2026-06-20 at 9.08.07 AM.png")
        assert screenshot_asset["mediaKind"] == "screenshot", screenshot_asset
        qr_entry = _entry_by_filename(manifest, "qr-ticket.png")
        qr_asset = asset("qr-ticket.png")
        if qr_entry["expected"].get("realQr"):
            # Local intelligence is intentionally indexed out of band rather
            # than making every import pay decoder cost. Exercise the durable
            # barcode path before asserting the golden QR metadata.
            barcode_result = api.index_photo_barcodes(
                {"assetIds": [qr_asset["assetId"]], "ignoreSettings": True, "force": True}
            )
            assert barcode_result["progress"]["updated"] == 1, barcode_result
            qr_asset = api.project.db.photo_asset_by_id(qr_asset["assetId"]) or qr_asset
            qr_metadata = qr_asset["metadata"]
            assert qr_metadata["barcodeType"] == "QR Code", qr_metadata
            assert qr_metadata["barcodeText"] == GOLDEN_QR_PAYLOAD, qr_metadata
            assert qr_metadata["qrText"] == GOLDEN_QR_PAYLOAD, qr_metadata
            assert qr_metadata["barcodeSource"] == "opencv", qr_metadata
        else:
            assert qr_entry["expected"].get("source") == "deterministic-fallback", qr_entry
        assert asset("short-clip.mp4")["mediaKind"] == "video"
        assert asset("raw-placeholder-standalone.dng")["mediaKind"] == "raw"

        live_asset = asset("live-photo-pair.jpg")
        assert live_asset["mediaKind"] == "live_photo", live_asset
        live = live_asset["metadata"]["livePhoto"]
        assert Path(live["pairedVideoPath"]).name.lower() == "live-photo-pair.mov", live

        raw_primary = asset("raw-placeholder-primary.jpg")
        raw_pairs = api.project.db.photo_media_pairs_for_asset(raw_primary["assetId"])
        raw_pair = next((pair for pair in raw_pairs if pair["pairKind"] == "raw_sidecar"), None)
        assert raw_pair is not None, raw_pairs
        assert Path(raw_pair["relatedSourcePath"]).name == "raw-placeholder-primary.dng", raw_pair
        assert raw_pair["relatedExists"] is True, raw_pair

        api.project.db.rebuild_photo_duplicate_groups()
        duplicate_groups = api.project.db.list_photo_duplicate_groups()
        exact_group = next((group for group in duplicate_groups if group["algorithm"] == "exact_hash"), None)
        assert exact_group is not None, duplicate_groups
        exact_names = {Path(item["sourcePath"]).name for item in exact_group["items"]}
        assert {"duplicate-exact-a.jpg", "duplicate-exact-b.jpg"} <= exact_names, exact_group
        near_group = next((group for group in duplicate_groups if group["algorithm"] == "perceptual_dhash"), None)
        assert near_group is not None, duplicate_groups
        near_names = {Path(item["sourcePath"]).name for item in near_group["items"]}
        assert {"duplicate-near-a.jpg", "duplicate-near-b.jpg"} <= near_names, near_group

        optional_heic = _entry_by_filename(manifest, "optional-heic.heic")
        if optional_heic["available"]:
            assert asset("optional-heic.heic")["mimeType"] in {"image/heic", "image/heif", "image/heif-sequence", ""}, asset("optional-heic.heic")
        else:
            assert optional_heic["optional"] is True and optional_heic["note"], optional_heic
    print("ok photo golden fixtures manifest and import")


if __name__ == "__main__":
    test_photo_golden_fixture_pack_manifest_and_import()
