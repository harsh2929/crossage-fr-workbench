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


if __name__ == "__main__":
    test_strict_render_failure_is_render_error_when_not_stripping_location()
    print("all photo_export_render_error_units tests passed")
