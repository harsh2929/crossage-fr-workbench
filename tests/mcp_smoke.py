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
from PIL import Image


EXPECTED_TOOLS = {
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
    "clear_review_queue",
    "purge_reviewed_candidates",
    "workspace_health",
    "repair_workspace",
    "database_integrity",
    "repair_database_integrity",
    "relink_workspace_paths",
    "duplicate_people",
    "read_audit_events",
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
    "apply_calibration",
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
}

EXPECTED_PROMPTS = {
    "triage_pending",
    "plan_multi_age_enrollment",
    "safe_mode_policy",
}


def tool_text(result) -> str:
    return "\n".join(str(getattr(item, "text", "")) for item in getattr(result, "content", [])).strip()


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
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(root),
            "CROSSAGE_FORCE_FALLBACK": "1",
            "CROSSAGE_WORKSPACE": str(workspace),
            "CROSSAGE_REGISTRY_HOME": str(workspace.parent / "registry"),
        }
    )
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "crossage_fr.mcp_server", "--workspace", str(workspace)],
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            resources = await session.list_resources()
            prompts = await session.list_prompts()
            tool_names = {tool.name for tool in tools.tools}
            resource_uris = {str(resource.uri) for resource in resources.resources}
            prompt_names = {prompt.name for prompt in prompts.prompts}
            manifest = json.loads((root / "mcp" / "manifest.json").read_text(encoding="utf-8"))
            manifest_tool_names = {tool["name"] for tool in manifest["tools"]}
            missing_tools = EXPECTED_TOOLS - tool_names
            missing_resources = EXPECTED_RESOURCES - resource_uris
            missing_prompts = EXPECTED_PROMPTS - prompt_names
            assert not missing_tools, f"Missing MCP tools: {sorted(missing_tools)}"
            assert not missing_resources, f"Missing MCP resources: {sorted(missing_resources)}"
            assert not missing_prompts, f"Missing MCP prompts: {sorted(missing_prompts)}"
            assert manifest_tool_names == EXPECTED_TOOLS, f"MCP manifest/tool mismatch: missing={sorted(EXPECTED_TOOLS - manifest_tool_names)} extra={sorted(manifest_tool_names - EXPECTED_TOOLS)}"

            result = await session.call_tool("get_project_state", {})
            assert not result.isError
            assert result.structuredContent
            assert result.structuredContent["workspace"] == str(workspace.resolve())
            assert result.structuredContent["workspaceMetadata"]["workspaceId"]
            assert result.structuredContent["safeMode"] is True

            state_resource = await session.read_resource("vintrace://state")
            assert state_resource.contents
            state_text = getattr(state_resource.contents[0], "text", "")
            assert str(workspace.resolve()) not in state_text
            assert "[hidden]/workspace" in state_text

            audit = await session.call_tool("read_audit_events", {"limit": 10})
            assert not audit.isError
            assert audit.structuredContent
            assert "events" in audit.structuredContent

            workspace_result = await session.call_tool("set_workspace", {"path": str(workspace)})
            assert not workspace_result.isError
            assert workspace_result.structuredContent["consentOnFile"] is False
            await expect_tool_error(session, "mark_consent", {"confirmed": True}, "confirm=True")
            consent = await session.call_tool("mark_consent", {"confirmed": True, "operator": "MCP Smoke", "confirm": True})
            assert not consent.isError
            assert consent.structuredContent["consentOnFile"] is True

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
            assert {"Workspace write", "Recognition engine", "Image decoder", "Workspace health"} <= check_names
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
            await expect_tool_error(session, "apply_calibration", {}, "confirm=True")
            await expect_tool_error(session, "import_accuracy_labels", {"labels": []}, "confirm=True")
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
            assert purged.structuredContent["state"]["workspace"] == str(workspace.resolve())

            accuracy = await session.call_tool("accuracy_evaluation", {})
            assert not accuracy.isError
            assert accuracy.structuredContent
            assert "metrics" in accuracy.structuredContent

            candidates = await session.call_tool("query_candidates", {"limit": 5})
            assert not candidates.isError
            assert candidates.structuredContent["returned"] == 0

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

            report = await session.read_resource("vintrace://report")
            assert report.contents
            report_text = getattr(report.contents[0], "text", "")
            assert "report.md is not available" not in report_text
            assert "Vintrace" in report_text or "face" in report_text.lower()


if __name__ == "__main__":
    asyncio.run(smoke())
