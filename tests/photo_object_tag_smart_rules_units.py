"""APL-META-06: object-tag negative smart-rule coverage.

Object/scene tags feed the smart-album DSL via the model_tags FTS field. This
pins the exact-negative (`detectedItem isNot ...`) path: a negative rule must
exclude exactly the assets whose detected items match the value and keep the
rest, proving the negative predicate is applied to the materialized object-tag
rows rather than ignored or inverted.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_object_tag_smart_rules_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api, _sig


def test_object_tag_negative_smart_rule_excludes_matching_label() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        base = Path(tmp)
        water = str(base / "water.jpg")
        surf = str(base / "surf.jpg")
        api.project.db.create_scan_run("run1", "label", "manual", str(base))
        api.project.db.record_scan_file("run1", Path(water), _sig(Path(water)), "completed", phase="processed", content_hash="hash-water")
        api.project.db.record_scan_file("run1", Path(surf), _sig(Path(surf)), "completed", phase="processed", content_hash="hash-surf")
        api.project.db.update_photo_asset_metadata_json(source_path=water, patch={"objectTags": [{"label": "water", "confidence": 0.90}]})
        api.project.db.update_photo_asset_metadata_json(source_path=surf, patch={"objectTags": [{"label": "surfboard", "confidence": 0.92}]})

        not_water = api.save_photo_album(
            {
                "name": "Not water",
                "albumKind": "smart",
                "rules": {"op": "all", "conditions": [{"field": "detectedItem", "operator": "isNot", "value": "water"}]},
            }
        )
        not_surf = api.save_photo_album(
            {
                "name": "Not surfboard",
                "albumKind": "smart",
                "rules": {"op": "all", "conditions": [{"field": "detectedItem", "operator": "isNot", "value": "surfboard"}]},
            }
        )
        # Each negative rule excludes exactly the matching asset and keeps the other.
        assert not_water["count"] == 1, not_water
        assert not_surf["count"] == 1, not_surf


if __name__ == "__main__":
    test_object_tag_negative_smart_rule_excludes_matching_label()
    print("all photo_object_tag_smart_rules_units tests passed")
