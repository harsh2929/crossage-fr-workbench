from __future__ import annotations

from pathlib import Path
import tempfile

from PIL import Image

from crossage_fr.agent_images import AgentImageService
from crossage_fr.api_server import DesktopApi
from crossage_fr import mcp_server


def main() -> None:
    tools = mcp_server.mcp._tool_manager._tools
    capability_schema = tools["list_image_capabilities"].fn_metadata.arg_model.model_json_schema()
    assert capability_schema["properties"]["include_actions"]["default"] is False
    assert set(capability_schema["properties"]["category"]["enum"]) == {
        "", "organize", "discover", "visibility", "import", "metadata", "export", "index", "edit", "deduplicate", "maintain",
    }
    analyze_schema = tools["analyze_image_assets"].fn_metadata.arg_model.model_json_schema()
    capability_items = analyze_schema["properties"]["capabilities"]["anyOf"][0]["items"]
    assert set(capability_items["enum"]) == {"metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"}
    search_schema = tools["search_images"].fn_metadata.arg_model.model_json_schema()
    filters_ref = search_schema["properties"]["filters"]["anyOf"][0]["$ref"].split("/")[-1]
    filter_properties = search_schema["$defs"][filters_ref]["properties"]
    assert {"favoriteOnly", "favorite", "mediaKind", "media_type", "mediaType", "tags", "objects", "metadata", "dominantColor", "dateFrom", "albumId", "minQuality"} <= set(filter_properties)
    operations_schema = tools["list_image_operations"].fn_metadata.arg_model.model_json_schema()
    operation_kinds = operations_schema["properties"]["kinds"]["anyOf"][0]["items"]["enum"]
    assert set(operation_kinds) == {"import", "indexing", "export", "repair", "library", "agent-write"}
    assert len(mcp_server.IMAGE_AGENT_TOOL_NAMES) == 24

    with tempfile.TemporaryDirectory(prefix="vintrace-agent-dogfood-contract-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        media = root / "media"
        media.mkdir()
        image = media / "contract.png"
        Image.new("RGB", (20, 16), (30, 80, 150)).save(image)
        api = DesktopApi(workspace, actor="dogfood-contract")
        api.handle("set_consent", {"value": True, "operator": "test", "source": "test"})
        api.import_photos({"sourcePaths": [str(image)], "storageMode": "referenced"})
        asset_id = api.project.db.list_photo_assets(limit=1)[0]["assetId"]
        service = AgentImageService(
            api,
            workspace=workspace,
            require_consent=lambda: None,
            validate_path=lambda value: Path(value),
        )
        health = service.library_overview(include_health=True)
        cleanup_hint = health["data"]["planningHints"]["dryRunCatalogCleanup"]
        assert cleanup_hint == {
            "tool": "plan_image_action",
            "action": "photo_library_catalog_cleanup",
            "payload": {"commit": False},
        }
        cleanup_plan = service.plan("photo_library_catalog_cleanup", {"dry_run": True})
        assert cleanup_plan["data"]["normalizedPayload"] == {"commit": False}
        assert cleanup_plan["data"]["action"]["inputSchema"]["properties"]["commit"]["type"] == "boolean"
        album_plan = service.plan("create_manual_album", {"name": "Alias album", "album_kind": "manual"})
        assert album_plan["data"]["action"]["name"] == "save_photo_album"
        assert album_plan["data"]["normalizedPayload"]["albumKind"] == "manual"
        sheet_plan = service.plan(
            "create_contact_sheet",
            {"asset_ids": [asset_id], "format": "png", "columns": 1, "include_captions": False},
        )
        assert sheet_plan["data"]["estimatedAffectedItems"] == 1
        assert sheet_plan["data"]["normalizedPayload"]["assetIds"] == [asset_id]
        caption_plan = service.plan(
            "export_photo_contact_sheet",
            {"assetIds": [asset_id], "format": "png", "captions": False},
        )
        assert caption_plan["data"]["normalizedPayload"]["includeCaptions"] is False
        index_plan = service.plan(
            "enqueue_photo_indexing_job",
            {"capabilities": ["text", "objects", "barcodes"], "scope": {"assetIds": [asset_id]}},
        )
        assert [item["payload"]["jobKind"] for item in index_plan["data"]["batchPlans"]] == ["ocr", "objects", "barcodes"]
        written = service.run(
            action="save_photo_album",
            payload={"name": "Operation resource", "albumKind": "manual"},
            lane="write",
            confirm=True,
            idempotency_key="dogfood-contract-album-v1",
        )
        assert written["data"]["agentOperationId"] == "agent-write:dogfood-contract-album-v1"
        assert written["data"]["operationResourceUri"].startswith("vintrace://agent/operations/")
    print("agent dogfood product contracts ok")


if __name__ == "__main__":
    main()
