from __future__ import annotations

import json
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace

from PIL import Image

from crossage_fr.agent_images import (
    AgentImageService,
    MAX_LEDGER_RESULTS,
    MAX_LEDGER_TOMBSTONES,
    _is_path_key,
    image_action_specs,
)
from crossage_fr.api_server import DesktopApi


class ConcurrentWriteApi:
    _COMMAND_HANDLERS = {"save_photo_keyword": "_cmd_save_photo_keyword"}
    _COMMAND_REQUIRED_PARAMS = {"save_photo_keyword": ("name",)}

    def __init__(self, counter_path: str) -> None:
        self.counter_path = Path(counter_path)
        self.project = SimpleNamespace(workspace_metadata={"workspaceId": "concurrency-test"})

    def _cmd_save_photo_keyword(self, params: dict) -> dict:
        return params

    def handle(self, command: str, params: dict) -> dict:
        assert command == "save_photo_keyword"
        time.sleep(0.35)
        with self.counter_path.open("a", encoding="utf-8") as handle:
            handle.write("executed\n")
            handle.flush()
            os.fsync(handle.fileno())
        return {"keywordId": "keyword-concurrency", "name": str(params.get("name", ""))}


def concurrent_write_worker(workspace: str, counter_path: str, start_event, result_queue) -> None:
    service = AgentImageService(
        ConcurrentWriteApi(counter_path),
        workspace=Path(workspace),
        require_consent=lambda: None,
        validate_path=lambda value: Path(value),
    )
    start_event.wait(10)
    try:
        result = service.run(
            action="save_photo_keyword",
            payload={"name": "Concurrent keyword"},
            lane="write",
            confirm=True,
            idempotency_key="concurrent-keyword-v1",
        )
        result_queue.put(("ok", bool(result.get("replayed", False))))
    except Exception as exc:
        result_queue.put(("error", str(exc)))


def expect_error(callable_value, contains: str) -> None:
    try:
        callable_value()
    except Exception as exc:
        assert contains.lower() in str(exc).lower(), (contains, repr(exc))
        return
    raise AssertionError(f"Expected error containing {contains!r}.")


def no_sensitive_paths(value) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key).lower()
            if key_text.endswith(("path", "paths", "hash")) or key_text in {"workspace", "root"}:
                return False
            if not no_sensitive_paths(child):
                return False
    elif isinstance(value, list):
        return all(no_sensitive_paths(child) for child in value)
    return True


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-agent-images-") as tmp:
        base = Path(tmp)
        workspace = base / "workspace"
        media = base / "media"
        media.mkdir()
        first = media / "private-family-blue-product.jpg"
        second = media / "private-family-red-product.jpg"
        Image.new("RGB", (640, 480), (30, 80, 170)).save(first, quality=90)
        Image.new("RGB", (480, 640), (180, 45, 55)).save(second, quality=90)

        api = DesktopApi(workspace, actor="agent-test")
        imported = api.import_photos(
            {
                "sourcePaths": [str(first), str(second)],
                "storageMode": "referenced",
                "sourceLabel": "Agent image fixture",
            }
        )
        assert imported["importedCount"] == 2, imported

        allowed = base.resolve()

        def validate_path(value: str) -> Path:
            resolved = Path(value).expanduser().resolve()
            try:
                resolved.relative_to(allowed)
            except ValueError:
                raise ValueError("Path is outside the approved roots.") from None
            return resolved

        operator_calls: list[tuple[str, str]] = []

        def validate_operator(action: str, token: str) -> None:
            operator_calls.append((action, token))
            if token != "operator-ok":
                raise ValueError("Invalid operator approval token.")

        service = AgentImageService(
            api,
            workspace=workspace,
            require_consent=lambda: None,
            validate_path=validate_path,
            validate_operator_token=validate_operator,
        )

        # Every live image-oriented backend handler is classified. New commands
        # cannot silently appear outside the capability audit.
        expected_image_actions = {
            name
            for name in api._COMMAND_HANDLERS
            if "photo" in name or "album" in name or "memory" in name or "slideshow" in name or name in {"list_safe_mode_flagged", "prepare_previews"}
        }
        expected_image_actions.update({
            "inbound_connector_catalog",
            "list_inbound_connector_sources",
            "preview_inbound_connector",
            "import_inbound_connector",
            "sync_inbound_connector",
        })
        recursive_agent_actions = {
            "photo_library_agent_status",
            "query_photo_library_agent",
            "execute_photo_library_agent_plan",
        }
        expected_image_actions.difference_update(recursive_agent_actions)
        specs = image_action_specs(api)
        assert set(specs) == expected_image_actions, sorted(expected_image_actions - set(specs))
        assert "configure_inbound_connector" not in specs and "forget_inbound_connector" not in specs
        assert not recursive_agent_actions.intersection(specs)
        assert len(specs) >= 137, len(specs)
        assert all(spec.read_only is not None and spec.destructive is not None and spec.open_world is not None for spec in specs.values())
        assert sum(bool(spec.accepted) for spec in specs.values()) >= 115
        assert {"sourcePaths", "storageMode", "sourceLabel"} <= set(specs["import_photos"].accepted)
        print("ok complete live image action catalog")

        capabilities = service.capabilities()
        assert capabilities["ok"] is True
        assert capabilities["data"]["actionCount"] == len(specs)
        assert capabilities["data"]["deprecations"] == []
        assert capabilities["data"]["limits"]["maxIdempotencyReplayResults"] == MAX_LEDGER_RESULTS
        assert capabilities["data"]["limits"]["maxIdempotencyTombstones"] == MAX_LEDGER_TOMBSTONES
        import_contract = next(
            action for action in capabilities["data"]["actions"] if action["name"] == "import_photos"
        )
        assert "sourcePaths" in import_contract["inputSchema"]["properties"], import_contract
        assert "accepted" not in import_contract, import_contract
        assert import_contract["deprecated"] is False and import_contract["replacementAction"] == ""
        assert {"discover", "import", "index", "metadata", "organize", "edit", "export", "maintain"} <= set(capabilities["data"]["categories"])
        action_catalog = {item["name"]: item for item in capabilities["data"]["actions"]}
        assert action_catalog["update_photo_asset_metadata"]["executionLane"] == "write"
        assert action_catalog["delete_photo_album"]["executionLane"] == "destructive"
        assert action_catalog["import_photos"]["openWorld"] is True
        assert action_catalog["import_photos"]["inputSchema"]["type"] == "object"
        assert action_catalog["preview_inbound_connector"]["executionLane"] == "read"
        assert action_catalog["preview_inbound_connector"]["openWorld"] is True
        assert action_catalog["import_inbound_connector"]["executionLane"] == "write"
        assert action_catalog["import_inbound_connector"]["confirmationRequired"] is True
        for contract in capabilities["data"]["actions"]:
            example_payload = dict(contract.get("examplePayload", {}))
            property_schemas = contract["inputSchema"]["properties"]
            for field in contract["required"]:
                if not _is_path_key(field):
                    continue
                approved_example = str(base / "agent-action-examples" / field)
                example_payload[field] = (
                    [approved_example]
                    if property_schemas[field].get("type") == "array"
                    else approved_example
                )
            planned = service.plan(contract["name"], example_payload)
            expected_lane = contract["executionLane"]
            expected_tool = {
                "read": "run_image_read_action",
                "write": "run_image_write_action",
                "destructive": "run_destructive_image_action",
            }[expected_lane]
            assert planned["data"]["nextTool"] == expected_tool, (contract, planned)
            assert planned["policy"]["destructive"] is (expected_lane == "destructive"), planned
        print("ok every live image action is plannable in its enforced lane")
        print("ok capability envelope and categories")

        overview = service.library_overview()
        assert overview["data"]["assetCount"] == 2, overview
        assert overview["policy"]["readOnly"] is True
        print("ok image library overview")

        search = service.search(query="product", mode="lexical", limit=10)
        assert search["page"]["returned"] == 2, search
        asset_ids = [item["assetId"] for item in search["data"]["items"]]
        assert len(asset_ids) == 2 and all(asset_ids), search
        assert str(first) not in json.dumps(search)
        assert first.name not in json.dumps(search)
        print("ok path-free paginated image search")

        fetched = service.fetch_assets(asset_ids)
        assert len(fetched["data"]["items"]) == 2, fetched
        assert no_sensitive_paths(fetched["data"]["items"]), fetched
        print("ok stable asset metadata fetch")

        analyzed = service.analyze_assets(
            asset_ids,
            ["metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"],
        )
        assert len(analyzed["data"]["items"]) == 2, analyzed
        assert analyzed["policy"]["pixelDisclosure"] is False, analyzed
        assert set(analyzed["data"]["items"][0]["availability"]) == {
            "metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"
        }
        expect_error(lambda: service.analyze_assets(asset_ids, ["remote_captioning"]), "unsupported")
        print("ok path-free on-device intelligence analysis")

        # Hybrid search fuses lexical and semantic ranks, while exact metadata
        # filters are re-applied to semantic candidates. A semantic provider
        # must never smuggle an out-of-filter asset into an agent result.
        api.update_photo_asset_metadata({"assetId": asset_ids[0], "favorite": True})
        assets_by_id = {value["assetId"]: value for value in api.project.db.photo_assets_by_ids(asset_ids)}
        original_handle = api.handle

        def semantic_handle(command: str, params: dict):
            if command == "semantic_search_photos":
                rows = [
                    {
                        "sourcePath": str(assets_by_id[asset_id]["sourcePath"]),
                        "score": score,
                    }
                    for asset_id, score in ((asset_ids[1], 0.97), (asset_ids[0], 0.91))
                ]
                return {
                    "available": True,
                    "query": str(params.get("query", "")),
                    "scored": len(rows),
                    "items": rows[: int(params.get("limit", 30) or 30)],
                    "queuedJob": {},
                }
            return original_handle(command, params)

        api.handle = semantic_handle  # type: ignore[method-assign]
        try:
            hybrid = service.search(query="product", mode="hybrid", limit=10)
            assert hybrid["data"]["ranking"]["strategy"] == "reciprocal-rank-fusion", hybrid
            assert len(hybrid["data"]["items"]) == 2, hybrid
            assert all(item.get("hybridScore", 0) > 0 for item in hybrid["data"]["items"]), hybrid
            filtered_semantic = service.search(
                query="product",
                mode="semantic",
                filters={"favoriteOnly": True},
                limit=10,
            )
            assert [item["assetId"] for item in filtered_semantic["data"]["items"]] == [asset_ids[0]], filtered_semantic
        finally:
            api.handle = original_handle  # type: ignore[method-assign]
        print("ok deterministic hybrid fusion and semantic filter enforcement")

        preview = service.preview(asset_ids[0], max_dimension=512, max_bytes=512 * 1024)
        assert preview["mimeType"] == "image/jpeg"
        assert max(preview["width"], preview["height"]) <= 512
        assert len(preview["data"]) <= 512 * 1024
        assert any(event.get("action") == "agent_image_preview_disclosed" for event in api.project.audit_events(limit=20)["events"])
        print("ok bounded audited multimodal preview")

        write_plan = service.plan(
            "update_photo_asset_metadata",
            {"assetId": asset_ids[0], "title": "Approved hero image"},
        )
        assert write_plan["data"]["nextTool"] == "run_image_write_action", write_plan
        expect_error(
            lambda: service.run(
                action="update_photo_asset_metadata",
                payload={"assetId": asset_ids[0], "title": "Wrong lane"},
                lane="read",
            ),
            "write",
        )
        confirmation = service.run(
            action="update_photo_asset_metadata",
            payload={"assetId": asset_ids[0], "title": "Approved hero image"},
            lane="write",
        )
        assert confirmation["ok"] is False
        assert confirmation["error"]["code"] == "confirmation_required"
        print("ok write planning and lane separation")

        first_write = service.run(
            action="update_photo_asset_metadata",
            payload={"assetId": asset_ids[0], "title": "Approved hero image"},
            lane="write",
            confirm=True,
            idempotency_key="metadata-hero-v1",
        )
        restarted_service = AgentImageService(
            api,
            workspace=workspace,
            require_consent=lambda: None,
            validate_path=validate_path,
            validate_operator_token=validate_operator,
        )
        replay = restarted_service.run(
            action="update_photo_asset_metadata",
            payload={"assetId": asset_ids[0], "title": "Approved hero image"},
            lane="write",
            confirm=True,
            idempotency_key="metadata-hero-v1",
        )
        assert first_write["ok"] is True
        assert replay["replayed"] is True
        expect_error(
            lambda: service.run(
                action="update_photo_asset_metadata",
                payload={"assetId": asset_ids[0], "title": "Different input"},
                lane="write",
                confirm=True,
                idempotency_key="metadata-hero-v1",
            ),
            "different action input",
        )
        interrupted_payload = {"assetId": asset_ids[1], "title": "Interrupted title"}
        interrupted_ledger = service._read_ledger()
        interrupted_ledger.setdefault("operations", {})["metadata-interrupted-v1"] = {
            "action": "update_photo_asset_metadata",
            "fingerprint": service._fingerprint("update_photo_asset_metadata", interrupted_payload),
            "createdAt": "2026-07-10T00:00:00Z",
            "state": "running",
        }
        service._write_ledger(interrupted_ledger)
        expect_error(
            lambda: restarted_service.run(
                action="update_photo_asset_metadata",
                payload=interrupted_payload,
                lane="write",
                confirm=True,
                idempotency_key="metadata-interrupted-v1",
            ),
            "indeterminate outcome",
        )
        old_payload = {"assetId": asset_ids[1], "title": "Old completed title"}
        capped_ledger = service._read_ledger()
        capped_ledger.setdefault("operations", {})["metadata-old-v1"] = {
            "action": "update_photo_asset_metadata",
            "fingerprint": service._fingerprint("update_photo_asset_metadata", old_payload),
            "createdAt": "2000-01-01T00:00:00Z",
            "updatedAt": "2000-01-01T00:00:00Z",
            "state": "complete",
            "envelope": {"ok": True},
        }
        for index in range(MAX_LEDGER_RESULTS + 5):
            capped_ledger["operations"][f"newer-{index:04d}"] = {
                "action": "test",
                "fingerprint": f"fingerprint-{index}",
                "createdAt": f"2025-01-01T00:{index // 60:02d}:{index % 60:02d}Z",
                "updatedAt": f"2025-01-01T00:{index // 60:02d}:{index % 60:02d}Z",
                "state": "complete",
                "envelope": {"ok": True},
            }
        service._write_ledger(capped_ledger)
        compacted_ledger = service._read_ledger()
        assert len(compacted_ledger["operations"]) == MAX_LEDGER_RESULTS
        assert "metadata-old-v1" in compacted_ledger["tombstones"]
        expect_error(
            lambda: restarted_service.run(
                action="update_photo_asset_metadata",
                payload=old_payload,
                lane="write",
                confirm=True,
                idempotency_key="metadata-old-v1",
            ),
            "full result has expired",
        )
        assert (workspace / ".vintrace-agent-operations.json").exists()
        print("ok restart-persistent idempotent writes and crash-window protection")

        concurrency_workspace = base / "concurrency-workspace"
        concurrency_counter = base / "concurrency-counter.txt"
        context = multiprocessing.get_context("spawn")
        start_event = context.Event()
        result_queue = context.Queue()
        workers = [
            context.Process(
                target=concurrent_write_worker,
                args=(str(concurrency_workspace), str(concurrency_counter), start_event, result_queue),
            )
            for _index in range(2)
        ]
        for worker in workers:
            worker.start()
        start_event.set()
        results = [result_queue.get(timeout=20) for _worker in workers]
        for worker in workers:
            worker.join(timeout=20)
            assert worker.exitcode == 0, worker.exitcode
        executions = concurrency_counter.read_text(encoding="utf-8").splitlines()
        assert executions == ["executed"], (executions, results)
        assert any(status == "ok" for status, _detail in results), results
        print("ok cross-process idempotency prevents duplicate Codex/Claude execution")

        album_write = service.run(
            action="save_photo_album",
            payload={"name": "Agent stable-ID selects", "albumKind": "manual", "coverAssetId": asset_ids[0]},
            lane="write",
            confirm=True,
            idempotency_key="stable-album-v1",
        )
        album_id = str(album_write["data"].get("albumId", "") or "")
        assert album_id, album_write
        album_add = service.run(
            action="add_photo_album_items",
            payload={"albumId": album_id, "assetIds": asset_ids},
            lane="write",
            confirm=True,
            idempotency_key="stable-album-items-v1",
        )
        assert album_add["data"]["added"] == 2, album_add
        assert "assetIds" in service.specs["add_photo_album_items"].accepted
        assert "coverAssetId" in service.specs["save_photo_album"].accepted
        album_fetch = service.fetch_assets(asset_ids)
        assert all(
            any(str(album.get("albumId", "") or "") == album_id for album in item.get("albums", []))
            for item in album_fetch["data"]["items"]
        ), album_fetch
        stable_export_plan = service.plan(
            "export_photo_selection",
            {"assetIds": asset_ids, "folder": str(base / "exports"), "includeMetadata": True},
        )
        assert stable_export_plan["data"]["estimatedAffectedItems"] == 2, stable_export_plan
        assert "sourcePaths" not in stable_export_plan["data"]["payloadKeys"], stable_export_plan
        stable_export = service.run(
            action="export_photo_selection",
            payload={"assetIds": asset_ids, "folder": str(base / "exports"), "includeMetadata": True},
            lane="write",
            confirm=True,
            idempotency_key="stable-export-v1",
        )
        assert stable_export["data"]["counts"]["copied"] == 2, stable_export
        media_pair = service.run(
            action="create_photo_media_pair",
            payload={"assetId": asset_ids[0], "relatedAssetId": asset_ids[1], "pairKind": "related_media"},
            lane="write",
            confirm=True,
            idempotency_key="stable-media-pair-v1",
        )
        assert media_pair["data"]["assetId"] == asset_ids[0], media_pair
        assert "relatedAssetId" in service.specs["create_photo_media_pair"].accepted
        print("ok hidden-path album and export workflows operate entirely on stable asset IDs")

        operations = service.operations(limit=200)
        operation_items = operations["data"]["items"]
        assert {"import", "library", "agent-write"} <= set(operations["data"]["kinds"]), operations["data"]["kinds"]
        export_operation_id = "agent-write:stable-export-v1"
        export_operation = service.operation(export_operation_id)
        manifest = export_operation["data"]["manifest"]
        assert manifest["operation"]["operationId"] == export_operation_id, manifest
        assert manifest["outputs"] and manifest["outputCount"] == len(manifest["outputs"]), manifest
        assert str(base.resolve()) not in json.dumps(manifest), manifest
        available_output = next(item for item in manifest["outputs"] if item["resourceAvailable"])
        output = service.operation_output(export_operation_id, available_output["outputId"])
        assert output["data"] and len(output["data"]) == available_output["bytes"], output["descriptor"]
        manifest_resource = service.operation_manifest(export_operation_id)
        assert manifest_resource["data"]["manifest"]["privacy"]["outputPathsIncluded"] is False
        print("ok unified operations, path-free manifests, and bounded output resources")

        literal_path_recipe = lambda: service.save_recipe(
            "custom.unsafe-literal-export",
            {
                "name": "Unsafe literal export",
                "inputSchema": {"type": "object", "properties": {}},
                "steps": [{
                    "id": "plan-export",
                    "tool": "plan_image_action",
                    "arguments": {"action": "export_photo_selection", "payload": {"assetIds": [], "folder": str(base / "exports")}},
                    "approval": "write",
                }],
            },
            confirm=True,
            idempotency_key="unsafe-recipe-v1",
        )
        expect_error(literal_path_recipe, "path fields")
        recipe_id = "custom.apply-reviewed-title"
        recipe_definition = {
            "name": "Apply reviewed title",
            "description": "Plan one operator-reviewed title update for one stable asset.",
            "inputSchema": {
                "type": "object",
                "required": ["asset_id", "title"],
                "properties": {"asset_id": {"type": "string"}, "title": {"type": "string"}},
            },
            "steps": [{
                "id": "plan-title",
                "tool": "plan_image_action",
                "arguments": {
                    "action": "update_photo_asset_metadata",
                    "payload": {"assetId": "{{input.asset_id}}", "title": "{{input.title}}"},
                },
                "approval": "write",
            }],
        }
        unconfirmed_recipe = service.save_recipe(
            recipe_id,
            recipe_definition,
            idempotency_key="save-title-recipe-v1",
        )
        assert unconfirmed_recipe["ok"] is False and unconfirmed_recipe["error"]["code"] == "confirmation_required"
        saved_recipe = service.save_recipe(
            recipe_id,
            recipe_definition,
            confirm=True,
            idempotency_key="save-title-recipe-v1",
        )
        assert saved_recipe["data"]["recipe"]["recipeId"] == recipe_id, saved_recipe
        recipe_replay = service.save_recipe(
            recipe_id,
            recipe_definition,
            confirm=True,
            idempotency_key="save-title-recipe-v1",
        )
        assert recipe_replay["replayed"] is True and recipe_replay["data"]["recipe"]["recipeId"] == recipe_id
        planned_recipe = service.plan_recipe(recipe_id, {"asset_id": asset_ids[0], "title": "Recipe title"})
        assert planned_recipe["data"]["steps"][0]["tool"] == "plan_image_action", planned_recipe
        assert planned_recipe["data"]["steps"][0]["arguments"]["payload"] == {"assetId": asset_ids[0], "title": "Recipe title"}
        assert service.recipe(recipe_id)["data"]["recipe"]["steps"][0]["approval"] == "write"
        recipe_list = service.recipes()
        assert recipe_list["data"]["customCount"] == 1 and recipe_list["data"]["builtinCount"] >= 8
        deleted_recipe = service.delete_recipe(
            recipe_id,
            confirm=True,
            idempotency_key="delete-title-recipe-v1",
        )
        assert deleted_recipe["data"]["deleted"] is True
        deleted_recipe_replay = service.delete_recipe(
            recipe_id,
            confirm=True,
            idempotency_key="delete-title-recipe-v1",
        )
        assert deleted_recipe_replay["replayed"] is True
        expect_error(lambda: service.recipe(recipe_id), "not found")
        print("ok persistent multi-step recipes are plan-only, idempotent, and auditable")

        service._envelope("get_image_preview", {"assetId": asset_ids[0]}, pixel_disclosure=True)
        activity = service.activity(limit=200)
        assert activity["data"]["summary"]["writes"] >= 1, activity
        assert activity["data"]["summary"]["confirmed"] >= 1, activity
        assert activity["data"]["summary"]["pixelDisclosures"] >= 1, activity
        assert all(str(base.resolve()) not in json.dumps(item) for item in activity["data"]["items"])
        assert any(item.get("principalId") == "local-stdio" and item.get("authType") == "stdio" for item in activity["data"]["items"])
        print("ok agent activity and approval telemetry")

        delete_plan = service.plan("delete_photo_album", {"albumId": "album_missing"})
        assert delete_plan["policy"]["destructive"] is True, delete_plan
        expect_error(
            lambda: service.run(
                action="delete_photo_album",
                payload={"albumId": "album_missing"},
                lane="write",
                confirm=True,
                idempotency_key="wrong-delete-lane",
            ),
            "non-destructive write lane",
        )
        print("ok destructive actions isolated from normal writes")

        expect_error(
            lambda: service.plan("import_photos", {"sourcePaths": ["/etc/passwd"]}),
            "outside the approved roots",
        )
        expect_error(
            lambda: service.plan("import_photo_keywords", {"sourceFile": "/etc/passwd"}),
            "outside the approved roots",
        )
        expect_error(
            lambda: service.plan("save_photo_library_settings", {"managedRoots": [{"path": "/etc"}]}),
            "outside the approved roots",
        )
        source_label_plan = service.plan(
            "import_photos",
            {"sourcePaths": [str(first)], "sourceLabel": "Private family archive", "sourceKind": "folder"},
        )
        assert source_label_plan["data"]["valid"] is True
        timestamp_source_plan = service.plan(
            "export_photo_video_frame",
            {"assetId": asset_ids[0], "timestampSource": "poster", "folder": str(base / "exports")},
        )
        assert timestamp_source_plan["data"]["valid"] is True
        expect_error(
            lambda: service.plan("not_a_real_action", {}),
            "catalog",
        )
        print("ok recursive path confinement and action allowlist")

        first_asset = api.project.db.photo_asset_by_id(asset_ids[0])
        assert first_asset
        api.project.db.set_safe_mode_override(str(first_asset.get("contentHash", "")), True, reason="test")
        expect_error(lambda: service.preview(asset_ids[0]), "Safe Mode protects")
        print("ok safe mode blocks pixel disclosure")

        expect_error(
            lambda: service.run(
                action="set_photo_safe_mode_override",
                payload={"assetId": asset_ids[1], "sensitive": False},
                lane="destructive",
                confirm=True,
                idempotency_key="override-without-operator",
            ),
            "operator approval token",
        )
        assert operator_calls
        print("ok sensitive override retains operator authority")

    print("all agent image unit tests passed")


if __name__ == "__main__":
    main()
