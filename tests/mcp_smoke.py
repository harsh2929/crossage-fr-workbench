from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult
from PIL import Image
from jsonschema import Draft202012Validator

from crossage_fr.agent_telemetry import evaluate_trace_file, read_trace_records


EXPECTED_TOOLS = {
    "list_image_capabilities",
    "get_image_library_overview",
    "list_inbound_visual_sources",
    "discover_inbound_visuals",
    "import_inbound_visuals",
    "sync_inbound_visuals",
    "search_images",
    "fetch_image_assets",
    "elicit_image_asset_choice",
    "analyze_image_assets",
    "get_image_preview",
    "plan_image_action",
    "run_image_read_action",
    "run_image_write_action",
    "run_destructive_image_action",
    "get_image_job",
    "get_agent_activity",
    "list_image_operations",
    "get_image_operation",
    "list_image_recipes",
    "get_image_recipe",
    "plan_image_recipe",
    "save_image_recipe",
    "delete_image_recipe",
    "get_project_state",
    "set_workspace",
    "mark_consent",
    "enroll_reference_folder",
    "enroll_age_reference_set",
    "scan_folder",
    "scan_media_paths",
    "scan_image_paths",
    "cancel_active_scan",
    "pause_active_scan",
    "resume_active_scan",
    "scan_job_status",
    "analyze_folder",
    "probe_video_file",
    "assess_image",
    "review_candidate",
    "bulk_review_candidates",
    "set_candidate_note",
    "block_false_match",
    "reassign_candidate_person",
    "query_candidates",
    "ordered_review_candidates",
    "clear_review_queue",
    "purge_reviewed_candidates",
    "workspace_health",
    "repair_workspace",
    "database_integrity",
    "repair_database_integrity",
    "relink_workspace_paths",
    "duplicate_people",
    "read_audit_events",
    "list_jurisdictions",
    "set_jurisdiction_preset",
    "export_examination_report",
    "list_workspaces",
    "export_compliance_pack",
    "audit_chain_status",
    "purge_duplicate_candidates",
    "purge_old_candidates",
    "delete_reference",
    "delete_person",
    "rename_person",
    "clear_references",
    "save_settings",
    "set_performance_mode",
    "export_review_report",
    "export_workspace_inventory",
    "export_audit_log",
    "export_consent_receipt",
    "retention_policy_report",
    "export_safe_mode_audit",
    "model_drift_report",
    "reference_gap_report",
    "export_review_ledger",
    "export_scan_history",
    "export_workspace_backup",
    "verify_workspace_backup",
    "restore_workspace_backup",
    "prune_workspace_backups",
    "prune_scan_manifests",
    "export_selected_candidates",
    "export_accepted_media_bundle",
    "export_support_bundle",
    "runtime_self_test",
    "runtime_benchmark",
    "benchmark_history",
    "storage_io_benchmark",
    "release_readiness",
    "model_integrity",
    "model_distribution_audit",
    "backfill_model_references",
    "installer_self_diagnostics",
    "public_dataset_catalog",
    "inspect_public_dataset",
    "run_public_dataset_benchmark",
    "compare_public_dataset_models",
    "apply_model_recommendation",
    "apply_review_rules",
    "calibration_summary",
    "accuracy_evaluation",
    "export_accuracy_labels",
    "import_accuracy_labels",
    "export_training_examples",
    "import_training_examples",
    "apply_calibration",
    "apply_personalized_calibration",
    "calibration_learning_status",
    "run_learning_jobs",
    "reference_suggestion_status",
    "stage_reference_suggestions",
    "approve_reference_suggestion",
    "reject_reference_suggestion",
    "synthetic_enrollment_screen_status",
    "approve_synthetic_enrollment_review",
    "reject_synthetic_enrollment_review",
    "stage_calibration",
    "promote_calibration",
    "rollback_calibration",
    "embedding_adapter_status",
    "stage_embedding_adapter",
    "promote_embedding_adapter",
    "rollback_embedding_adapter",
    "privacy_report",
    "delete_face_data",
    "optimize_workspace",
    "enforce_storage_budget",
}

EXPECTED_RESOURCES = {
    "vintrace://state",
    "vintrace://summary",
    "vintrace://references",
    "vintrace://candidates",
    "vintrace://config",
    "vintrace://audit",
    "vintrace://agent-guide",
    "vintrace://report",
    "vintrace://images/capabilities",
    "vintrace://images/library",
    "vintrace://images/inbound-sources",
    "vintrace://agent/activity",
    "vintrace://agent/recipes",
    "ui://vintrace/image-review-v1.html",
}

EXPECTED_RESOURCE_TEMPLATES = {
    "vintrace://images/assets/{asset_id}",
    "vintrace://images/previews/{grant_id}",
    "vintrace://images/jobs/{job_type}/{job_id}",
    "vintrace://agent/operations/{operation_id}",
    "vintrace://agent/manifests/{operation_id}",
    "vintrace://agent/outputs/{operation_id}/{output_id}",
    "vintrace://agent/recipes/{recipe_id}",
}

EXPECTED_PROMPTS = {
    "triage_pending",
    "plan_multi_age_enrollment",
    "safe_mode_policy",
    "plan_image_workflow",
    "curate_image_selection",
    "inbound_visual_workflow",
}


def tool_text(result) -> str:
    return "\n".join(str(getattr(item, "text", "")) for item in getattr(result, "content", [])).strip()


def assert_structured_result(tool_by_name: dict, tool_name: str, result) -> None:
    schema = tool_by_name[tool_name].outputSchema
    assert isinstance(schema, dict), f"{tool_name} does not advertise outputSchema"
    Draft202012Validator.check_schema(schema)
    assert isinstance(result.structuredContent, dict), f"{tool_name} did not return structuredContent"
    Draft202012Validator(schema).validate(result.structuredContent)


async def expect_tool_error(session: ClientSession, tool_name: str, arguments: dict, contains: str) -> None:
    try:
        result = await session.call_tool(tool_name, arguments)
    except Exception as exc:
        assert contains in str(exc), f"{tool_name} error did not contain {contains!r}: {exc!r}"
        return
    assert result.isError, f"{tool_name} should have required an explicit confirmation."
    assert contains in tool_text(result), f"{tool_name} error text did not contain {contains!r}: {tool_text(result)!r}"


async def smoke() -> None:
    root = Path.cwd()
    workspace = Path(tempfile.mkdtemp(prefix="crossage-mcp-smoke-")) / "workspace"
    registry = str(workspace.parent / "registry")
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(root),
            "CROSSAGE_FORCE_FALLBACK": "1",
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": registry,
            "CROSSAGE_REGISTRY_HOME": registry,
            # Security Phase 2: the MCP server now requires an operator token to
            # grant consent (MCP-02) and confines path inputs to approved roots
            # (MCP-03). The smoke test operates under the temp workspace's parent.
            "VINTRACE_MCP_OPERATOR_TOKEN": "mcp-smoke-operator-token",
            "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace.parent),
            "VINTRACE_MCP_OTEL_ENABLED": "1",
            # Keep the explicit cancellation task alive across the get/cancel
            # round trip. The backend hook is capped and defaults to zero.
            "CROSSAGE_TEST_SCAN_ITEM_DELAY_MS": "20",
        }
    )
    packaged_executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
    if packaged_executable:
        env.pop("PYTHONPATH", None)
        server_command = str(Path(packaged_executable).expanduser().resolve())
        server_args = ["--mcp", "--workspace", str(workspace)]
    else:
        server_command = sys.executable
        server_args = ["-m", "crossage_fr.mcp_server", "--workspace", str(workspace)]
    params = StdioServerParameters(command=server_command, args=server_args, env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            assert initialized.capabilities.tasks
            assert initialized.capabilities.tasks.list is not None
            assert initialized.capabilities.tasks.cancel is not None
            assert initialized.capabilities.tasks.requests.tools.call is not None
            tools = await session.list_tools()
            resources = await session.list_resources()
            resource_templates = await session.list_resource_templates()
            prompts = await session.list_prompts()
            tool_names = {tool.name for tool in tools.tools}
            tool_by_name = {tool.name: tool for tool in tools.tools}
            resource_uris = {str(resource.uri) for resource in resources.resources}
            resource_template_uris = {str(template.uriTemplate) for template in resource_templates.resourceTemplates}
            prompt_names = {prompt.name for prompt in prompts.prompts}
            manifest = json.loads((root / "mcp" / "manifest.json").read_text(encoding="utf-8"))
            manifest_tool_names = {tool["name"] for tool in manifest["tools"]}
            manifest_prompt_names = {prompt["name"] for prompt in manifest.get("prompts", [])}
            missing_tools = EXPECTED_TOOLS - tool_names
            missing_resources = EXPECTED_RESOURCES - resource_uris
            missing_resource_templates = EXPECTED_RESOURCE_TEMPLATES - resource_template_uris
            missing_prompts = EXPECTED_PROMPTS - prompt_names
            assert not missing_tools, f"Missing MCP tools: {sorted(missing_tools)}"
            assert not missing_resources, f"Missing MCP resources: {sorted(missing_resources)}"
            assert not missing_resource_templates, f"Missing MCP resource templates: {sorted(missing_resource_templates)}"
            assert not missing_prompts, f"Missing MCP prompts: {sorted(missing_prompts)}"
            assert tool_names == EXPECTED_TOOLS, f"MCP runtime/tool mismatch: missing={sorted(EXPECTED_TOOLS - tool_names)} extra={sorted(tool_names - EXPECTED_TOOLS)}"
            assert manifest_tool_names == EXPECTED_TOOLS, f"MCP manifest/tool mismatch: missing={sorted(EXPECTED_TOOLS - manifest_tool_names)} extra={sorted(manifest_tool_names - EXPECTED_TOOLS)}"
            read_tools = [tool for tool in tools.tools if bool(tool.annotations and tool.annotations.readOnlyHint)]
            missing_read_schemas = [tool.name for tool in read_tools if not isinstance(tool.outputSchema, dict)]
            assert not missing_read_schemas, f"Read tools missing outputSchema: {missing_read_schemas}"
            for tool in read_tools:
                Draft202012Validator.check_schema(tool.outputSchema)
            assert manifest_prompt_names == EXPECTED_PROMPTS, f"MCP manifest/prompt mismatch: missing={sorted(EXPECTED_PROMPTS - manifest_prompt_names)} extra={sorted(manifest_prompt_names - EXPECTED_PROMPTS)}"
            for tool in tools.tools:
                assert tool.annotations is not None, f"{tool.name} is missing MCP impact annotations."
                assert tool.annotations.readOnlyHint is not None, f"{tool.name} is missing readOnlyHint."
                assert tool.annotations.destructiveHint is not None, f"{tool.name} is missing destructiveHint."
                assert tool.annotations.openWorldHint is not None, f"{tool.name} is missing openWorldHint."
            task_optional = {tool.name for tool in tools.tools if tool.execution and tool.execution.taskSupport == "optional"}
            assert task_optional == {
                "import_inbound_visuals",
                "run_image_write_action",
                "scan_folder",
                "scan_image_paths",
                "scan_media_paths",
                "sync_inbound_visuals",
            }

            search_contract = next(tool for tool in tools.tools if tool.name == "search_images")
            assert search_contract.meta
            assert search_contract.meta.get("ui", {}).get("resourceUri") == "ui://vintrace/image-review-v1.html"
            assert search_contract.meta.get("openai/outputTemplate") == "ui://vintrace/image-review-v1.html"
            preview_contract = next(tool for tool in tools.tools if tool.name == "get_image_preview")
            assert preview_contract.meta and preview_contract.meta.get("openai/widgetAccessible") is True
            assert "app" in preview_contract.meta.get("ui", {}).get("visibility", [])
            review_app = await session.read_resource("ui://vintrace/image-review-v1.html")
            review_html = getattr(review_app.contents[0], "text", "") if review_app.contents else ""
            assert getattr(review_app.contents[0], "mimeType", "") == "text/html;profile=mcp-app"
            review_meta = getattr(review_app.contents[0], "meta", None) or {}
            review_csp = review_meta.get("ui", {}).get("csp", {})
            assert review_csp == {"connectDomains": [], "resourceDomains": [], "frameDomains": []}
            assert "window.openai" in review_html and "get_image_preview" in review_html
            assert "ui/initialize" in review_html and "@modelcontextprotocol/ext-apps" not in review_html

            capabilities = await session.call_tool("list_image_capabilities", {"include_actions": True})
            assert not capabilities.isError
            assert capabilities.structuredContent
            assert capabilities.structuredContent["data"]["actionCount"] >= 137
            assert "search_images" in capabilities.structuredContent["data"]["frontDoors"]
            delegation = capabilities.structuredContent["data"]["delegation"]
            assert delegation["mode"] in {"manual", "progressive"}
            assert delegation["destructiveDelegation"] is False
            assert "delete_photo_album" not in delegation["eligibleActions"]

            result = await session.call_tool("get_project_state", {})
            assert not result.isError
            assert_structured_result(tool_by_name, "get_project_state", result)
            assert result.structuredContent
            # MCP-04: tool output redacts the workspace/biometric path.
            assert result.structuredContent["workspace"] == "[hidden]"
            assert str(workspace.resolve()) not in json.dumps(result.structuredContent)
            assert result.structuredContent["workspaceMetadata"]["workspaceId"]
            assert result.structuredContent["safeMode"] is True

            state_resource = await session.read_resource("vintrace://state")
            assert state_resource.contents
            state_text = getattr(state_resource.contents[0], "text", "")
            assert str(workspace.resolve()) not in state_text
            # MCP-04 (resources): paths are redacted AND basenames are now hidden
            # too — filenames frequently encode names/dates, so a basename leak is
            # still a privacy leak. The workspace path collapses to "[hidden]".
            assert '"workspace": "[hidden]"' in state_text
            assert f"[hidden]/{workspace.name}" not in state_text

            audit = await session.call_tool("read_audit_events", {"limit": 10})
            assert not audit.isError
            assert audit.structuredContent
            assert "events" in audit.structuredContent

            workspace_result = await session.call_tool("set_workspace", {"path": str(workspace)})
            assert not workspace_result.isError
            assert workspace_result.structuredContent["consentOnFile"] is False
            # MCP-02: the agent cannot grant consent on its own authority — it
            # needs the operator token. confirm alone is not enough.
            await expect_tool_error(session, "mark_consent", {"confirmed": True}, "confirm=True")
            await expect_tool_error(session, "mark_consent", {"confirmed": True, "confirm": True}, "operator approval token")
            consent = await session.call_tool(
                "mark_consent",
                {"confirmed": True, "operator": "MCP Smoke", "confirm": True, "operator_token": "mcp-smoke-operator-token"},
            )
            assert not consent.isError
            assert consent.structuredContent["consentOnFile"] is True
            await expect_tool_error(
                session,
                "set_jurisdiction_preset",
                {"preset": "standard"},
                "confirm=True",
            )
            await expect_tool_error(
                session,
                "set_jurisdiction_preset",
                {"preset": "standard", "confirm": True},
                "operator approval token",
            )
            preset = await session.call_tool(
                "set_jurisdiction_preset",
                {
                    "preset": "standard",
                    "confirm": True,
                    "operator_token": "mcp-smoke-operator-token",
                },
            )
            assert not preset.isError
            assert preset.structuredContent["applied"]["preset"] == "standard"

            task_created = await session.experimental.call_tool_as_task(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "MCP task-created album", "albumKind": "manual"},
                    "confirm": True,
                    "idempotency_key": "mcp-task-album-v1",
                },
                ttl=60_000,
            )
            task_id = task_created.task.taskId
            assert task_id
            task_status = await session.experimental.get_task(task_id)
            for _ in range(100):
                if task_status.status in {"completed", "failed", "cancelled"}:
                    break
                await asyncio.sleep(0.05)
                task_status = await session.experimental.get_task(task_id)
            assert task_status.status == "completed", task_status
            task_list = await session.experimental.list_tasks()
            assert any(task.taskId == task_id for task in task_list.tasks)
            task_result = await session.experimental.get_task_result(task_id, CallToolResult)
            assert not task_result.isError
            assert task_result.structuredContent["ok"] is True
            assert task_result.meta and task_result.meta.get("io.modelcontextprotocol/related-task", {}).get("taskId") == task_id

            image_overview = await session.call_tool("get_image_library_overview", {})
            assert not image_overview.isError
            assert image_overview.structuredContent
            assert image_overview.structuredContent["data"]["assetCount"] == 0

            recipes = await session.call_tool("list_image_recipes", {"include_steps": True})
            assert not recipes.isError, tool_text(recipes)
            assert recipes.structuredContent["data"]["builtinCount"] == 8
            portfolio_plan = await session.call_tool(
                "plan_image_recipe",
                {"recipe_id": "builtin.portfolio-curation", "inputs": {"query": "family sunset"}},
            )
            assert not portfolio_plan.isError, tool_text(portfolio_plan)
            assert portfolio_plan.structuredContent["data"]["steps"]
            assert portfolio_plan.structuredContent["data"]["approvalPoints"]
            custom_recipe = {
                "name": "Review sunsets",
                "description": "Find a bounded sunset shortlist without executing a mutation.",
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
            unconfirmed_recipe = await session.call_tool(
                "save_image_recipe",
                {"recipe_id": "custom.sunsets", "recipe": custom_recipe},
            )
            assert not unconfirmed_recipe.isError
            assert unconfirmed_recipe.structuredContent["error"]["code"] == "confirmation_required"
            saved_recipe = await session.call_tool(
                "save_image_recipe",
                {
                    "recipe_id": "custom.sunsets",
                    "recipe": custom_recipe,
                    "confirm": True,
                    "idempotency_key": "mcp-recipe-save-v1",
                },
            )
            assert not saved_recipe.isError and saved_recipe.structuredContent["ok"] is True
            replayed_recipe = await session.call_tool(
                "save_image_recipe",
                {
                    "recipe_id": "custom.sunsets",
                    "recipe": custom_recipe,
                    "confirm": True,
                    "idempotency_key": "mcp-recipe-save-v1",
                },
            )
            assert replayed_recipe.structuredContent["replayed"] is True
            recipe_resource = await session.read_resource("vintrace://agent/recipes/custom.sunsets")
            assert "Review sunsets" in str(getattr(recipe_resource.contents[0], "text", ""))
            print("ok MCP built-in and durable custom workflow recipes")

            image_search = await session.call_tool(
                "search_images",
                {"query": "", "mode": "lexical", "scope": "all", "limit": 10},
            )
            assert not image_search.isError
            assert image_search.structuredContent
            assert_structured_result(tool_by_name, "search_images", image_search)
            assert image_search.structuredContent["data"]["items"] == []

            # Prove the complete agent workflow over the real MCP transport:
            # confirmed import -> exactly-once replay -> path-free discovery ->
            # stable-ID fetch/resource -> audited multimodal pixel disclosure.
            fixture_dir = workspace / "agent-media"
            fixture_dir.mkdir(parents=True, exist_ok=True)
            fixture_name = "mcp-agent-private-family-fixture.jpg"
            fixture_path = fixture_dir / fixture_name
            Image.new("RGB", (720, 480), (35, 105, 170)).save(fixture_path, quality=90)
            import_payload = {
                "sourcePaths": [str(fixture_path)],
                "storageMode": "referenced",
                "sourceLabel": "MCP agent fixture",
            }
            import_plan = await session.call_tool(
                "plan_image_action",
                {"action": "import_photos", "payload": import_payload},
            )
            assert not import_plan.isError, tool_text(import_plan)
            assert import_plan.structuredContent["data"]["nextTool"] == "run_image_write_action"
            imported = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "import_photos",
                    "payload": import_payload,
                    "confirm": True,
                    "idempotency_key": "mcp-smoke-import-v1",
                },
            )
            assert not imported.isError and imported.structuredContent["ok"] is True
            imported_text = json.dumps(imported.structuredContent, sort_keys=True)
            assert str(fixture_path.resolve()) not in imported_text and fixture_name not in imported_text
            replayed_import = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "import_photos",
                    "payload": import_payload,
                    "confirm": True,
                    "idempotency_key": "mcp-smoke-import-v1",
                },
            )
            assert not replayed_import.isError
            assert replayed_import.structuredContent["replayed"] is True

            discovered = await session.call_tool(
                "search_images",
                {"query": "mcp agent private family", "mode": "lexical", "limit": 10},
            )
            assert not discovered.isError and discovered.structuredContent["page"]["returned"] == 1
            discovered_text = json.dumps(discovered.structuredContent, sort_keys=True)
            assert str(fixture_path.resolve()) not in discovered_text and fixture_name not in discovered_text
            asset_id = discovered.structuredContent["data"]["items"][0]["assetId"]
            assert asset_id

            indexing_task = await session.experimental.call_tool_as_task(
                "run_image_write_action",
                {
                    "action": "enqueue_photo_indexing_job",
                    "payload": {"jobKind": "search", "scope": {"all": True, "budgetLimit": 10}},
                    "confirm": True,
                    "idempotency_key": "mcp-task-search-index-v1",
                },
                ttl=60_000,
            )
            indexing_task_id = indexing_task.task.taskId
            indexing_status = await session.experimental.get_task(indexing_task_id)
            for _ in range(200):
                if indexing_status.status in {"completed", "failed", "cancelled"}:
                    break
                await asyncio.sleep(0.05)
                indexing_status = await session.experimental.get_task(indexing_task_id)
            assert indexing_status.status == "completed", indexing_status
            indexing_result = await session.experimental.get_task_result(indexing_task_id, CallToolResult)
            assert not indexing_result.isError
            assert indexing_result.structuredContent["ok"] is True
            assert indexing_result.structuredContent["data"]["status"] == "completed"

            task_export_folder = workspace / "task-exports"
            export_task = await session.experimental.call_tool_as_task(
                "run_image_write_action",
                {
                    "action": "start_photo_export_job",
                    "payload": {
                        "command": "export_photo_selection",
                        "params": {"sourcePaths": [str(fixture_path)], "folder": str(task_export_folder)},
                    },
                    "confirm": True,
                    "idempotency_key": "mcp-task-export-v1",
                },
                ttl=60_000,
            )
            export_task_id = export_task.task.taskId
            export_status = await session.experimental.get_task(export_task_id)
            for _ in range(200):
                if export_status.status in {"completed", "failed", "cancelled"}:
                    break
                await asyncio.sleep(0.05)
                export_status = await session.experimental.get_task(export_task_id)
            assert export_status.status == "completed", export_status
            export_result = await session.experimental.get_task_result(export_task_id, CallToolResult)
            assert not export_result.isError
            assert export_result.structuredContent["data"]["job"]["status"] == "completed"
            assert str(fixture_path.resolve()) not in json.dumps(export_result.structuredContent)
            assert any(task_export_folder.rglob("*.jpg"))

            fetched_asset = await session.call_tool("fetch_image_assets", {"asset_ids": [asset_id]})
            assert not fetched_asset.isError
            assert fetched_asset.structuredContent["data"]["items"][0]["assetId"] == asset_id
            analyzed_asset = await session.call_tool(
                "analyze_image_assets",
                {"asset_ids": [asset_id], "capabilities": ["metadata", "text", "objects", "barcodes", "quality"]},
            )
            assert not analyzed_asset.isError
            assert analyzed_asset.structuredContent["data"]["items"][0]["assetId"] == asset_id
            assert analyzed_asset.structuredContent["policy"]["pixelDisclosure"] is False
            saved_album = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "MCP stable-ID selects", "albumKind": "manual"},
                    "confirm": True,
                    "idempotency_key": "mcp-smoke-album-v1",
                },
            )
            assert not saved_album.isError
            album_id = str(saved_album.structuredContent["data"].get("albumId", "") or "")
            assert album_id
            added_to_album = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "add_photo_album_items",
                    "payload": {"albumId": album_id, "assetIds": [asset_id]},
                    "confirm": True,
                    "idempotency_key": "mcp-smoke-album-items-v1",
                },
            )
            assert not added_to_album.isError
            assert added_to_album.structuredContent["data"]["added"] == 1
            assert str(fixture_path.resolve()) not in json.dumps(added_to_album.structuredContent)
            asset_resource = await session.read_resource(f"vintrace://images/assets/{asset_id}")
            assert asset_resource.contents
            resource_text = str(getattr(asset_resource.contents[0], "text", ""))
            assert asset_id in resource_text
            assert str(fixture_path.resolve()) not in resource_text and fixture_name not in resource_text

            preview = await session.call_tool(
                "get_image_preview",
                {"asset_id": asset_id, "max_dimension": 512, "max_bytes": 524288},
            )
            assert not preview.isError and preview.structuredContent
            assert_structured_result(tool_by_name, "get_image_preview", preview)
            assert preview.structuredContent["policy"]["pixelDisclosure"] is True
            assert not [item for item in preview.content if getattr(item, "type", "") == "image"]
            preview_links = [item for item in preview.content if getattr(item, "type", "") == "resource_link"]
            assert len(preview_links) == 1
            preview_uri = str(preview_links[0].uri)
            assert preview_uri.startswith("vintrace://images/previews/")
            assert asset_id not in preview_uri and fixture_name not in preview_uri
            assert preview.structuredContent["data"]["resource"]["uri"] == preview_uri
            preview_resource = await session.read_resource(preview_uri)
            assert preview_resource.contents
            preview_blob = str(getattr(preview_resource.contents[0], "blob", ""))
            assert getattr(preview_resource.contents[0], "mimeType", "") == "image/jpeg"
            assert len(preview_blob) > 100
            print("ok full MCP image import/search/fetch/preview workflow")

            operations = await session.call_tool("list_image_operations", {"limit": 50})
            assert not operations.isError
            operation_items = operations.structuredContent["data"]["items"]
            import_operation = next(item for item in operation_items if item["kind"] == "import")
            operation_id = import_operation["operationId"]
            operation = await session.call_tool("get_image_operation", {"operation_id": operation_id})
            assert not operation.isError and operation.structuredContent["data"]["manifest"]
            assert_structured_result(tool_by_name, "get_image_operation", operation)
            operation_resource = await session.read_resource(f"vintrace://agent/operations/{operation_id}")
            manifest_resource = await session.read_resource(f"vintrace://agent/manifests/{operation_id}")
            combined_resources = str(getattr(operation_resource.contents[0], "text", "")) + str(getattr(manifest_resource.contents[0], "text", ""))
            assert str(fixture_path.resolve()) not in combined_resources and fixture_name not in combined_resources
            activity = await session.call_tool("get_agent_activity", {"limit": 100})
            assert not activity.isError
            assert activity.structuredContent["data"]["summary"]["pixelDisclosures"] >= 1
            assert activity.structuredContent["data"]["summary"]["confirmed"] >= 1
            activity_resource = await session.read_resource("vintrace://agent/activity")
            assert str(fixture_path.resolve()) not in str(getattr(activity_resource.contents[0], "text", ""))
            print("ok MCP unified operations, manifests, and activity approvals")

            image_read = await session.call_tool(
                "run_image_read_action",
                {"action": "photo_library_settings", "payload": {}},
            )
            assert not image_read.isError
            assert image_read.structuredContent["policy"]["readOnly"] is True

            image_write_plan = await session.call_tool(
                "plan_image_action",
                {"action": "update_photo_asset_metadata", "payload": {"assetId": "asset_missing", "title": "Test"}},
            )
            assert not image_write_plan.isError
            assert image_write_plan.structuredContent["data"]["nextTool"] == "run_image_write_action"
            image_write_unconfirmed = await session.call_tool(
                "run_image_write_action",
                {"action": "update_photo_asset_metadata", "payload": {"assetId": "asset_missing", "title": "Test"}},
            )
            assert not image_write_unconfirmed.isError
            assert image_write_unconfirmed.structuredContent["error"]["code"] == "confirmation_required"
            await expect_tool_error(
                session,
                "plan_image_action",
                {"action": "import_photos", "payload": {"sourcePaths": ["/etc/passwd"]}},
                "approved MCP roots",
            )
            await expect_tool_error(
                session,
                "get_image_preview",
                {"asset_id": "asset_missing"},
                "not found",
            )
            # MCP-03: scanning a path outside the approved roots is refused.
            await expect_tool_error(session, "scan_folder", {"folder": "/"}, "approved MCP roots")
            # MCP-06: backup restore/verify destinations are confined too — an
            # out-of-scope source ZIP or restore target is refused (restore writes
            # files, so an unconfined target would be an arbitrary write).
            await expect_tool_error(session, "verify_workspace_backup", {"path": "/etc/passwd"}, "approved MCP roots")
            await expect_tool_error(
                session,
                "restore_workspace_backup",
                {"path": "/tmp/x.zip", "target": "/tmp/out", "confirm": True},
                "approved MCP roots",
            )
            # MCP-06 (completeness): storage_io_benchmark writes a real probe file
            # and leaks fs metadata, so an out-of-scope directory must be refused —
            # not just the backup tools. (Found by adversarial verification.)
            await expect_tool_error(session, "storage_io_benchmark", {"path": "/etc"}, "approved MCP roots")
            await expect_tool_error(session, "inspect_public_dataset", {"dataset_id": "lfw", "folder": "/etc"}, "approved MCP roots")

            private_probe = workspace.parent / "private-probe"
            private_probe.mkdir(parents=True, exist_ok=True)
            private_name = "private_family_trip_probe.jpg"
            Image.new("RGB", (16, 16), (60, 90, 130)).save(private_probe / private_name)
            analyzed = await session.call_tool("analyze_folder", {"folder": str(private_probe)})
            assert not analyzed.isError
            analyzed_text = json.dumps(analyzed.structuredContent, sort_keys=True)
            assert str(private_probe.resolve()) not in analyzed_text
            assert private_name not in analyzed_text
            assert "[hidden]" in analyzed_text

            self_test = await session.call_tool("runtime_self_test", {})
            assert not self_test.isError
            assert self_test.structuredContent
            check_names = {check["name"] for check in self_test.structuredContent["checks"]}
            assert {"Workspace write", "Recognition engine", "AS-Norm cohort", "Image decoder", "Workspace health"} <= check_names
            assert self_test.structuredContent["generatedAt"]

            benchmark_history = await session.call_tool("benchmark_history", {"limit": 2})
            assert not benchmark_history.isError
            assert benchmark_history.structuredContent
            assert "benchmarks" in benchmark_history.structuredContent

            installer = await session.call_tool("installer_self_diagnostics", {})
            assert not installer.isError
            assert installer.structuredContent
            assert "checks" in installer.structuredContent

            duplicate_people = await session.call_tool("duplicate_people", {"threshold": 0.82, "limit": 5})
            assert not duplicate_people.isError
            assert duplicate_people.structuredContent
            assert "suggestions" in duplicate_people.structuredContent

            performance_mode = await session.call_tool("set_performance_mode", {"mode": "fast"})
            assert not performance_mode.isError
            assert performance_mode.structuredContent["performanceMode"] == "fast"
            assert performance_mode.structuredContent["effectivePerformanceMode"] == "fast"

            await expect_tool_error(session, "rename_person", {"old_name": "A", "new_name": "B"}, "confirm=True")
            await expect_tool_error(session, "purge_old_candidates", {"days": 1}, "confirm=True")
            await expect_tool_error(session, "delete_face_data", {}, "confirm=True")
            # Deleting the audit log too needs the human-only operator token (MCP-07).
            await expect_tool_error(
                session,
                "delete_face_data",
                {"confirm": True, "include_audit": True},
                "operator approval token",
            )
            await expect_tool_error(session, "apply_calibration", {}, "confirm=True")
            await expect_tool_error(session, "apply_personalized_calibration", {}, "confirm=True")
            await expect_tool_error(session, "run_learning_jobs", {}, "confirm=True")
            await expect_tool_error(session, "stage_reference_suggestions", {}, "confirm=True")
            await expect_tool_error(session, "approve_reference_suggestion", {"artifact_id": "learn_missing"}, "confirm=True")
            await expect_tool_error(session, "reject_reference_suggestion", {"artifact_id": "learn_missing"}, "confirm=True")
            await expect_tool_error(session, "stage_calibration", {}, "confirm=True")
            await expect_tool_error(session, "promote_calibration", {}, "confirm=True")
            await expect_tool_error(session, "rollback_calibration", {}, "confirm=True")
            await expect_tool_error(session, "stage_embedding_adapter", {}, "confirm=True")
            await expect_tool_error(session, "promote_embedding_adapter", {}, "confirm=True")
            await expect_tool_error(session, "rollback_embedding_adapter", {}, "confirm=True")
            await expect_tool_error(session, "import_accuracy_labels", {"labels": []}, "confirm=True")
            await expect_tool_error(session, "import_training_examples", {"examples": []}, "confirm=True")
            await expect_tool_error(session, "export_accepted_media_bundle", {}, "confirm=True")
            await expect_tool_error(session, "optimize_workspace", {}, "confirm=True")
            await expect_tool_error(session, "enforce_storage_budget", {}, "confirm=True")
            await expect_tool_error(session, "apply_review_rules", {}, "confirm=True")
            await expect_tool_error(session, "block_false_match", {"candidate_id": "cand_missing"}, "confirm=True")
            await expect_tool_error(session, "reassign_candidate_person", {"candidate_id": "cand_missing", "person_name": "Other"}, "confirm=True")
            await expect_tool_error(
                session,
                "save_settings",
                {
                    "confident": 0.4,
                    "likely": 0.28,
                    "relaxed_child": 0.2,
                    "quality_min": 0.15,
                    "cluster_min_size": 2,
                    "face_detector_size": 512,
                    "two_pass_scan": True,
                    "verification_detector_size": 640,
                    "safe_mode": False,
                    "safe_mode_threshold": 0.58,
                },
                "confirm=True",
            )

            purged = await session.call_tool("purge_old_candidates", {"days": 1, "confirm": True})
            assert not purged.isError
            assert purged.structuredContent["purged"] == 0
            assert purged.structuredContent["state"]["workspace"] == "[hidden]"

            accuracy = await session.call_tool("accuracy_evaluation", {})
            assert not accuracy.isError
            assert accuracy.structuredContent
            assert "metrics" in accuracy.structuredContent

            candidates = await session.call_tool("query_candidates", {"limit": 5})
            assert not candidates.isError
            assert candidates.structuredContent["returned"] == 0

            ordered_candidates = await session.call_tool("ordered_review_candidates", {"limit": 5})
            assert not ordered_candidates.isError
            assert ordered_candidates.structuredContent["returned"] == 0

            privacy = await session.call_tool("privacy_report", {})
            assert not privacy.isError
            assert privacy.structuredContent["references"] == 0

            backup = await session.call_tool("export_workspace_backup", {"include_generated": False})
            assert not backup.isError
            assert backup.structuredContent
            backup_value = backup.structuredContent["backup"]
            backup_path = Path(backup_value["zipPath"])
            assert backup_path.exists()
            assert backup_value["fileCount"] >= 1
            assert backup_value["bytes"] > 0
            with zipfile.ZipFile(backup_path) as archive:
                assert "backup-manifest.json" in archive.namelist()
            verified_backup = await session.call_tool("verify_workspace_backup", {"path": str(backup_path)})
            assert not verified_backup.isError
            assert verified_backup.structuredContent
            assert verified_backup.structuredContent["verification"]["ok"] is True
            restore_target = workspace.parent / "mcp-restored-workspace"
            await expect_tool_error(session, "restore_workspace_backup", {"path": str(backup_path), "target": str(restore_target)}, "confirm=True")
            restored_backup = await session.call_tool(
                "restore_workspace_backup",
                {"path": str(backup_path), "target": str(restore_target), "confirm": True},
            )
            assert not restored_backup.isError
            assert restored_backup.structuredContent["restore"]["ok"] is True
            assert (restore_target / "references.json").exists()
            await expect_tool_error(session, "export_workspace_backup", {"include_generated": True}, "confirm=True")

            history = await session.call_tool("export_scan_history", {})
            assert not history.isError
            assert Path(history.structuredContent["export"]["jsonPath"]).exists()

            inventory = await session.call_tool("export_workspace_inventory", {})
            assert not inventory.isError
            assert Path(inventory.structuredContent["export"]["jsonPath"]).exists()

            audit_export = await session.call_tool("export_audit_log", {})
            assert not audit_export.isError
            assert Path(audit_export.structuredContent["export"]["jsonPath"]).exists()

            consent_receipt = await session.call_tool("export_consent_receipt", {})
            assert not consent_receipt.isError
            assert Path(consent_receipt.structuredContent["receipt"]["jsonPath"]).exists()

            retention = await session.call_tool("retention_policy_report", {})
            assert not retention.isError
            assert retention.structuredContent
            assert "reviewedOlderThanDays" in retention.structuredContent

            safe_audit = await session.call_tool("export_safe_mode_audit", {})
            assert not safe_audit.isError
            assert Path(safe_audit.structuredContent["audit"]["jsonPath"]).exists()

            drift = await session.call_tool("model_drift_report", {})
            assert not drift.isError
            assert drift.structuredContent
            assert "currentModel" in drift.structuredContent

            gaps = await session.call_tool("reference_gap_report", {})
            assert not gaps.isError
            assert gaps.structuredContent
            assert "items" in gaps.structuredContent
            assert "recommendations" in gaps.structuredContent

            ledger = await session.call_tool("export_review_ledger", {})
            assert not ledger.isError
            assert Path(ledger.structuredContent["ledger"]["jsonPath"]).exists()

            support = await session.call_tool("export_support_bundle", {"include_paths": False})
            assert not support.isError
            assert Path(support.structuredContent["bundle"]["zipPath"]).exists()

            repair = await session.call_tool("repair_workspace", {})
            assert not repair.isError
            assert repair.structuredContent["repair"]["dryRun"] is True

            database = await session.call_tool("database_integrity", {})
            assert not database.isError
            assert database.structuredContent["ok"] is True

            database_repair = await session.call_tool("repair_database_integrity", {})
            assert not database_repair.isError
            assert database_repair.structuredContent["repair"]["dryRun"] is True

            relink = await session.call_tool("relink_workspace_paths", {"old_root": str(workspace.parent), "new_root": str(workspace.parent)})
            assert not relink.isError
            assert relink.structuredContent["relink"]["dryRun"] is True

            await expect_tool_error(session, "prune_workspace_backups", {}, "confirm=True")
            pruned = await session.call_tool("prune_workspace_backups", {"keep": 1, "confirm": True})
            assert not pruned.isError
            assert "deleted" in pruned.structuredContent["cleanup"]

            await expect_tool_error(session, "prune_scan_manifests", {}, "confirm=True")
            pruned_manifests = await session.call_tool("prune_scan_manifests", {"keep_runs": 1, "confirm": True})
            assert not pruned_manifests.isError
            assert "runsDeleted" in pruned_manifests.structuredContent["cleanup"]

            integrity = await session.call_tool("model_integrity", {})
            assert not integrity.isError
            assert integrity.structuredContent["checks"]

            distribution = await session.call_tool("model_distribution_audit", {})
            assert not distribution.isError
            assert distribution.structuredContent["items"]

            await expect_tool_error(session, "backfill_model_references", {}, "confirm=True")

            dataset_catalog = await session.call_tool("public_dataset_catalog", {})
            assert not dataset_catalog.isError
            assert any(item["datasetId"] == "lfw" for item in dataset_catalog.structuredContent["datasets"])

            await expect_tool_error(session, "compare_public_dataset_models", {"dataset_id": "lfw"}, "confirm=True")
            await expect_tool_error(session, "apply_model_recommendation", {"pack": "antelopev2"}, "confirm=True")

            storage_io = await session.call_tool("storage_io_benchmark", {"path": str(workspace), "size_mb": 1})
            assert not storage_io.isError
            assert storage_io.structuredContent["sizeBytes"] == 1024 * 1024

            denied_delete_recipe = await session.call_tool(
                "delete_image_recipe", {"recipe_id": "custom.sunsets"}
            )
            assert not denied_delete_recipe.isError
            assert denied_delete_recipe.structuredContent["error"]["code"] == "confirmation_required"
            deleted_recipe = await session.call_tool(
                "delete_image_recipe",
                {
                    "recipe_id": "custom.sunsets",
                    "confirm": True,
                    "idempotency_key": "mcp-recipe-delete-v1",
                },
            )
            assert not deleted_recipe.isError and deleted_recipe.structuredContent["data"]["deleted"] is True

            cancellation_folder = workspace.parent / "task-cancellation-images"
            cancellation_folder.mkdir(parents=True, exist_ok=True)
            for index in range(120):
                Image.new("RGB", (320, 240), color=(index % 255, (index * 7) % 255, (index * 13) % 255)).save(
                    cancellation_folder / f"frame-{index:03d}.jpg",
                    quality=86,
                )
            task_reference_folder = workspace.parent / "task-cancellation-reference"
            task_reference_folder.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (320, 240), color=(90, 140, 190)).save(task_reference_folder / "reference.jpg", quality=90)
            task_reference = await session.call_tool(
                "enroll_reference_folder",
                {"person_name": "Task Cancellation Reference", "age_bucket": "adult", "folder": str(task_reference_folder)},
            )
            assert not task_reference.isError and task_reference.structuredContent["added"] == 1
            cancellable = await session.experimental.call_tool_as_task(
                "scan_folder",
                {"folder": str(cancellation_folder)},
                ttl=60_000,
            )
            await asyncio.sleep(0.1)
            pre_cancel_status = await session.experimental.get_task(cancellable.task.taskId)
            assert pre_cancel_status.status == "working", pre_cancel_status
            cancelled = await session.experimental.cancel_task(cancellable.task.taskId)
            assert cancelled.status == "cancelled"
            cancelled_status = await session.experimental.get_task(cancellable.task.taskId)
            assert cancelled_status.status == "cancelled"
            cancelled_result = await session.experimental.get_task_result(cancellable.task.taskId, CallToolResult)
            assert cancelled_result.isError
            assert cancelled_result.structuredContent["error"]["code"] == "task_cancelled"
            print("ok MCP Tasks create/get/list/result/cancel and forbidden-tool negotiation")

            strict_preset = await session.call_tool(
                "set_jurisdiction_preset",
                {
                    "preset": "bipa-il",
                    "confirm": True,
                    "operator_token": "mcp-smoke-operator-token",
                },
            )
            assert not strict_preset.isError
            strict_workspace = await session.call_tool(
                "mark_consent",
                {
                    "confirmed": True,
                    "operator": "MCP Privacy Officer",
                    "ai_disclosure_acknowledged": True,
                    "confirm": True,
                    "operator_token": "mcp-smoke-operator-token",
                },
            )
            assert not strict_workspace.isError
            await expect_tool_error(
                session,
                "mark_consent",
                {
                    "confirmed": True,
                    "person_name": "MCP Release Subject",
                    "lawful_basis": "informed-written-release",
                    "confirm": True,
                    "operator_token": "mcp-smoke-operator-token",
                },
                "complete written biometric release",
            )
            strict_subject = await session.call_tool(
                "mark_consent",
                {
                    "confirmed": True,
                    "operator": "MCP Privacy Officer",
                    "person_name": "MCP Release Subject",
                    "lawful_basis": "informed-written-release",
                    "signer_name": "MCP Release Subject",
                    "signer_role": "self",
                    "specific_purpose": "Review a private family archive.",
                    "collection_term_days": 365,
                    "written_notice_acknowledged": True,
                    "electronic_signature_accepted": True,
                    "ai_disclosure_acknowledged": True,
                    "confirm": True,
                    "operator_token": "mcp-smoke-operator-token",
                },
            )
            assert not strict_subject.isError
            assert strict_subject.structuredContent["consent"]["validSubjectCount"] >= 1
            print("ok MCP strict jurisdiction and written-release parity")

            report = await session.read_resource("vintrace://report")
            assert report.contents
            report_text = getattr(report.contents[0], "text", "")
            assert "report.md is not available" not in report_text
            assert "Vintrace" in report_text or "face" in report_text.lower()

    trace_path = workspace / "agent" / "mcp-traces.jsonl"
    trace_report = evaluate_trace_file(trace_path)
    assert trace_report["ok"], trace_report
    assert trace_report["spans"] >= 50, trace_report
    assert trace_report["uniqueTools"] >= 40, trace_report
    assert all(trace_report["laneCounts"][lane] > 0 for lane in ("read", "write", "destructive"))
    assert trace_report["idempotentSpans"] > 0 and trace_report["taskSpans"] > 0
    trace_records = read_trace_records(trace_path)
    by_tool = {
        str(record.get("attributes", {}).get("gen_ai.tool.name", "")): record
        for record in trace_records
    }
    assert by_tool["get_project_state"]["attributes"]["vintrace.tool.lane"] == "read"
    assert by_tool["run_image_write_action"]["attributes"]["vintrace.tool.lane"] == "write"
    assert by_tool["delete_image_recipe"]["attributes"]["vintrace.tool.lane"] == "destructive"
    assert any(record.get("attributes", {}).get("vintrace.task.present") is True for record in trace_records)
    trace_report_path = str(os.environ.get("VINTRACE_MCP_TRACE_REPORT", "") or "").strip()
    if trace_report_path:
        output = Path(trace_report_path).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(trace_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(smoke())
