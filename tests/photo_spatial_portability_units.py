"""Acceptance coverage for explicit depth and stereo photo companions."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.api_server import DesktopApi


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_image(path: Path, mode: str, color: object) -> None:
    Image.new(mode, (24, 16), color).save(path)


def _api(base: Path) -> DesktopApi:
    registry = str(base / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
    return DesktopApi(base / "workspace")


def _pairs_by_kind(api: DesktopApi, source_path: Path) -> dict[str, dict[str, object]]:
    asset = api.project.db.photo_asset_by_path(str(source_path.resolve()))
    assert asset, source_path
    return {
        str(pair["pairKind"]): pair
        for pair in api.project.db.photo_media_pairs_for_asset(str(asset["assetId"]))
    }


def test_referenced_spatial_import_and_export() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        api = _api(base)
        source = base / "portrait.jpg"
        depth = base / "portrait.depth.png"
        right = base / "portrait.right.jpg"
        _write_image(source, "RGB", (24, 96, 180))
        _write_image(depth, "L", 128)
        _write_image(right, "RGB", (180, 96, 24))
        source_hash = _sha256(source)

        imported = api.import_photos({
            "sourcePaths": [str(source)],
            "storageMode": "referenced",
            "sourceLabel": "Spatial fixture",
        })
        assert imported["importedCount"] == 1, imported
        pairs = _pairs_by_kind(api, source)
        assert set(pairs) == {"depth_sidecar", "stereo_pair"}, pairs
        assert Path(str(pairs["depth_sidecar"]["relatedSourcePath"])).samefile(depth), pairs
        assert Path(str(pairs["stereo_pair"]["relatedSourcePath"])).samefile(right), pairs
        assert pairs["depth_sidecar"]["metadata"]["spatialRole"] == "depth", pairs
        assert pairs["stereo_pair"]["metadata"]["spatialRole"] == "right-eye", pairs
        assert all(pair["metadata"]["preservesOriginal"] is True for pair in pairs.values()), pairs

        folder_page = api.list_photo_folder_items({"folderId": "all", "previewBudget": 0})
        item = next(value for value in folder_page["items"] if value["sourcePath"] == str(source.resolve()))
        assert {pair["pairKind"] for pair in item["mediaPairs"]} == set(pairs), item

        exported = api.export_photo_selection(
            [str(source)],
            folder=base / "exports",
            include_metadata=True,
            include_xmp=True,
            include_existing_sidecars=True,
            filename_mode="original",
        )
        assert exported["counts"]["spatialAssets"] == 1, exported
        assert exported["counts"]["spatialCompanions"] == 2, exported
        row = exported["items"][0]
        assert _sha256(Path(row["targetPath"])) == source_hash, row
        assert row["spatialPortability"]["kind"] == "stereo", row
        assert row["spatialPortability"]["originalPreserved"] is True, row
        assert row["spatialPortability"]["exportDisposition"] == "original-byte-preserved", row
        assert {Path(path).suffix.lower() for path in row["existingSidecarPaths"]} == {".png", ".jpg"}, row

        xmp = Path(row["xmpPath"]).read_text(encoding="utf-8")
        assert "<vintrace:SpatialMediaKind>stereo</vintrace:SpatialMediaKind>" in xmp, xmp
        assert "<vintrace:OriginalPreserved>true</vintrace:OriginalPreserved>" in xmp, xmp
        assert "<vintrace:DepthSidecar>portrait.depth.png</vintrace:DepthSidecar>" in xmp, xmp
        assert "<vintrace:StereoRightEye>portrait.right.jpg</vintrace:StereoRightEye>" in xmp, xmp
        assert "<GDepth:Mime>image/png</GDepth:Mime>" in xmp, xmp

        manifest = json.loads(Path(exported["manifestPath"]).read_text(encoding="utf-8"))
        assert manifest["counts"]["spatialAssets"] == 1, manifest
        assert manifest["counts"]["spatialCompanions"] == 2, manifest
        assert "rendered exports flatten spatial media" in manifest["note"], manifest["note"]

        payload = api._photo_export_sidecar_payload(str(source))  # noqa: SLF001
        flattened = api._photo_export_spatial_fields(  # noqa: SLF001
            payload,
            original_preserved=False,
            export_disposition="flattened-2d",
        )
        assert flattened["originalPreserved"] is False, flattened
        assert flattened["exportDisposition"] == "flattened-2d", flattened
        flattened_xmp = api._photo_export_xmp(payload, spatial_original_preserved=False)  # noqa: SLF001
        assert "<vintrace:OriginalPreserved>false</vintrace:OriginalPreserved>" in flattened_xmp, flattened_xmp

        text_only = api._photo_export_spatial_fields({  # noqa: SLF001
            "assetMetadata": {
                "ocr": {"text": "Depth map tutorial"},
                "caption": "A deep stereo cabinet",
                "localDepthControls": {"mode": "portrait", "aperture": 4},
            }
        })
        assert text_only["kind"] == "", text_only
        assert text_only["metadataDetected"] is False, text_only
        embedded = api._photo_export_spatial_fields({"assetMetadata": {"xmp": {"depthMap": "embedded"}}})  # noqa: SLF001
        assert embedded["kind"] == "portrait-depth", embedded
        assert embedded["metadataDetected"] is True, embedded


def test_managed_import_copies_spatial_companions() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        api = _api(base)
        source = base / "managed.jpg"
        depth = base / "managed.disparity.tiff"
        right = base / "managed.right-eye.jpg"
        _write_image(source, "RGB", (40, 80, 120))
        _write_image(depth, "L", 90)
        _write_image(right, "RGB", (120, 80, 40))

        imported = api.import_photos({
            "sourcePaths": [str(source)],
            "storageMode": "managed",
            "managedRoot": str(base / "managed-library"),
            "sourceLabel": "Managed spatial fixture",
        })
        assert imported["importedCount"] == 1, imported
        assert imported["relatedMediaCopiedCount"] == 2, imported
        managed_source = Path(imported["importedPaths"][0])
        pairs = _pairs_by_kind(api, managed_source)
        assert set(pairs) == {"depth_sidecar", "stereo_pair"}, pairs
        managed_depth = Path(str(pairs["depth_sidecar"]["relatedSourcePath"]))
        managed_right = Path(str(pairs["stereo_pair"]["relatedSourcePath"]))
        assert managed_depth.parent == managed_source.parent, pairs
        assert managed_right.parent == managed_source.parent, pairs
        assert _sha256(managed_depth) == _sha256(depth), pairs
        assert _sha256(managed_right) == _sha256(right), pairs
        assert _sha256(managed_source) == _sha256(source), pairs


def test_unrelated_adjacent_images_are_not_spatial_pairs() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        api = _api(base)
        source = base / "plain.jpg"
        unrelated = base / "plain-mask.png"
        _write_image(source, "RGB", (1, 2, 3))
        _write_image(unrelated, "L", 4)
        imported = api.import_photos({
            "sourcePaths": [str(source)],
            "storageMode": "referenced",
            "sourceLabel": "Flat fixture",
        })
        assert imported["importedCount"] == 1, imported
        pairs = _pairs_by_kind(api, source)
        assert "depth_sidecar" not in pairs, pairs
        assert "stereo_pair" not in pairs, pairs


if __name__ == "__main__":
    test_referenced_spatial_import_and_export()
    test_managed_import_copies_spatial_companions()
    test_unrelated_adjacent_images_are_not_spatial_pairs()
    print("photo spatial portability units ok")
