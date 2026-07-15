from __future__ import annotations

import json
from pathlib import Path
import tempfile

from PIL import Image

from crossage_fr.agent_images import AgentImageService
from crossage_fr.agent_recipes import ALLOWED_RECIPE_TOOLS
from crossage_fr.api_server import DesktopApi


GOLDEN_RECIPES = {
    "builtin.portfolio-curation": {"query": "blue prototype", "maxCandidates": 20},
    "builtin.ocr-to-reviewed-album": {"text": "SN-1042", "albumName": "Serial 1042"},
    "builtin.trip-memory-movie": {"query": "Lisbon trip", "memoryName": "Lisbon favorites"},
    "builtin.batch-metadata-normalization": {"query": "untitled product photos"},
    "builtin.duplicate-review-and-undo": {},
    "builtin.missing-intelligence-index": {"query": "documents"},
    "builtin.semantic-contact-sheet": {"query": "sunset launch", "title": "Launch selects"},
    "builtin.archive-health-and-repair": {},
}


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-agent-workflows-") as tmp:
        root = Path(tmp).resolve()
        workspace = root / "workspace"
        media = root / "media"
        media.mkdir()
        fixture = media / "private-workflow-fixture.jpg"
        Image.new("RGB", (640, 480), (50, 110, 180)).save(fixture, quality=90)

        api = DesktopApi(workspace, actor="agent-workflow-conformance")
        api.handle("set_consent", {"value": True, "operator": "Workflow test", "source": "test"})
        imported = api.import_photos({"sourcePaths": [str(fixture)], "storageMode": "referenced"})
        assert imported["importedCount"] == 1, imported

        def validate_path(value: str) -> Path:
            path = Path(value).expanduser().resolve()
            if not path.is_relative_to(root):
                raise ValueError("Path is outside the test root.")
            return path

        service = AgentImageService(
            api,
            workspace=workspace,
            require_consent=lambda: None,
            validate_path=validate_path,
        )

        catalog = service.recipes(include_steps=True)
        assert catalog["data"]["builtinCount"] == len(GOLDEN_RECIPES), catalog
        assert catalog["data"]["customCount"] == 0, catalog
        catalog_ids = {item["recipeId"] for item in catalog["data"]["items"]}
        assert catalog_ids == set(GOLDEN_RECIPES), catalog_ids

        for recipe_id, inputs in GOLDEN_RECIPES.items():
            plan = service.plan_recipe(recipe_id, inputs)
            serialized = json.dumps(plan, sort_keys=True)
            assert plan["action"] == "plan_image_recipe"
            assert plan["data"]["execution"].startswith("plan-only")
            assert "{{input." not in serialized
            assert plan["data"]["steps"]
            assert all(step["tool"] in ALLOWED_RECIPE_TOOLS for step in plan["data"]["steps"])
            assert all(
                point["approval"] in {"pixel-disclosure", "write", "destructive", "operator"}
                for point in plan["data"]["approvalPoints"]
            )
        print("ok eight golden multi-step workflow plans")

        try:
            service.plan_recipe("builtin.portfolio-curation", {"query": "x", "maxCandidates": 1000})
        except ValueError as exc:
            assert "maximum" in str(exc)
        else:
            raise AssertionError("Typed recipe input maximum was not enforced.")

        custom = {
            "name": "Reviewed red shortlist",
            "description": "Find a small red shortlist and stop before writes.",
            "inputSchema": {
                "type": "object",
                "required": ["query"],
                "properties": {"query": {"type": "string"}},
            },
            "steps": [
                {
                    "id": "search-step",
                    "tool": "search_images",
                    "arguments": {"query": "{{input.query}}", "limit": 20},
                    "approval": "none",
                }
            ],
        }
        denied = service.save_recipe("custom.red-shortlist", custom)
        assert denied["ok"] is False and denied["error"]["code"] == "confirmation_required"
        saved = service.save_recipe(
            "custom.red-shortlist",
            custom,
            confirm=True,
            idempotency_key="workflow-save-v1",
        )
        replayed = service.save_recipe(
            "custom.red-shortlist",
            custom,
            confirm=True,
            idempotency_key="workflow-save-v1",
        )
        assert saved["ok"] and replayed["replayed"] is True
        assert service.plan_recipe("custom.red-shortlist", {"query": "red bicycle"})["data"]["steps"][0]["arguments"]["query"] == "red bicycle"
        print("ok confirmed durable custom recipe and exact replay")

        searched = service.search(query="workflow fixture", mode="lexical", limit=10)
        assert searched["page"]["returned"] == 1, searched
        asset_id = searched["data"]["items"][0]["assetId"]
        write_payload = {"assetId": asset_id, "title": "Reviewed workflow fixture"}
        unconfirmed = service.run(action="update_photo_asset_metadata", payload=write_payload, lane="write")
        assert unconfirmed["error"]["code"] == "confirmation_required"
        written = service.run(
            action="update_photo_asset_metadata",
            payload=write_payload,
            lane="write",
            confirm=True,
            idempotency_key="workflow-metadata-v1",
        )
        assert written["ok"]

        operations = service.operations(limit=100)
        operation_kinds = {item["kind"] for item in operations["data"]["items"]}
        assert {"import", "library", "agent-write"} <= operation_kinds, operation_kinds
        write_operation = next(
            item for item in operations["data"]["items"]
            if item["kind"] == "agent-write" and item["action"] == "update_photo_asset_metadata"
        )
        operation = service.operation(write_operation["operationId"])
        operation_text = json.dumps(operation, sort_keys=True)
        assert str(fixture.resolve()) not in operation_text and fixture.name not in operation_text
        assert operation["data"]["manifest"]["privacy"] == {
            "sourcePathsIncluded": False,
            "sourceHashesIncluded": False,
            "outputPathsIncluded": False,
            "pixelDisclosure": False,
        }
        print("ok unified import/library/agent-write operation timeline")

        activity = service.activity(limit=200)
        assert activity["data"]["summary"]["confirmed"] >= 2
        assert activity["data"]["summary"]["approvalRequired"] >= 2
        activity_text = json.dumps(activity, sort_keys=True)
        assert str(fixture.resolve()) not in activity_text and fixture.name not in activity_text

        deleted = service.delete_recipe(
            "custom.red-shortlist",
            confirm=True,
            idempotency_key="workflow-delete-v1",
        )
        assert deleted["data"]["deleted"] is True
        print("ok path-free activity/approval trace and destructive recipe deletion")

    print("all agent workflow conformance tests passed")


if __name__ == "__main__":
    main()
