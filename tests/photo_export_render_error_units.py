"""APL-NAV-09: distinguish render failures from privacy strip-location skips.

A strict (no-fallback) rendered export that cannot render the media was always
labeled `render_skipped_strip_location`, conflating an actual render failure with
a deliberate privacy skip. Now the strip-location label is used only when
`strip_location` drove the skip; genuine render failures are labeled
`render_error` so the export UI can surface them as errors, not policy skips.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_export_render_error_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api


def test_strict_render_failure_is_render_error_when_not_stripping_location() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        corrupt = Path(tmp) / "corrupt.jpg"
        corrupt.write_bytes(b"this is not a valid jpeg payload")
        api.import_photos(
            {"sourcePaths": [str(corrupt)], "storageMode": "referenced", "sourceLabel": "Corrupt"}
        )
        corrupt_path = str(corrupt.resolve())

        result = api.export_photo_selection(
            [corrupt_path],
            export_variant="rendered",
            allow_render_fallback=False,
            strip_location=False,
        )
        row = next(item for item in result["items"] if item["sourcePath"] == corrupt_path)
        assert row["result"].startswith("render_error"), row
        assert not row["result"].startswith("render_skipped_strip_location"), row
        assert row["targetPath"] == "", row


def test_rendered_export_keeps_source_icc_when_target_conversion_fails() -> None:
    from PIL import Image, ImageCms

    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        source = Path(tmp) / "profiled.jpg"
        source_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()
        target_profile = api._photo_export_srgb_profile_bytes()
        Image.new("RGB", (32, 24), (150, 80, 40)).save(source, quality=95, icc_profile=source_profile)
        imported = api.import_photos(
            {"sourcePaths": [str(source)], "storageMode": "referenced", "sourceLabel": "Profiled"}
        )
        imported_path = imported["importedPaths"][0]
        original_profile_to_profile = ImageCms.profileToProfile

        def fail_profile_to_profile(*args, **kwargs):
            raise RuntimeError("simulated color transform failure")

        try:
            ImageCms.profileToProfile = fail_profile_to_profile
            result = api.export_photo_selection(
                [imported_path],
                export_variant="rendered",
                render_format="png",
                target_color_profile="srgb",
                filename_mode="original",
            )
        finally:
            ImageCms.profileToProfile = original_profile_to_profile

        row = result["items"][0]
        assert row["result"] == "rendered", row
        assert row["targetColorProfile"] == "srgb", row
        with Image.open(Path(row["targetPath"])) as output:
            embedded = output.info.get("icc_profile")
        assert embedded == source_profile, "unconverted pixels must keep their source ICC profile"
        assert embedded != target_profile, "failed conversion must not embed the requested target profile"


if __name__ == "__main__":
    test_strict_render_failure_is_render_error_when_not_stripping_location()
    test_rendered_export_keeps_source_icc_when_target_conversion_fails()
    print("all photo_export_render_error_units tests passed")
