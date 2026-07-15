from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import ElicitRequestFormParams, ElicitResult
from PIL import Image


class ElicitationDecisions:
    def __init__(self, decision: str = "approve") -> None:
        self.decision = decision
        self.requests: list[ElicitRequestFormParams] = []
        self.selected_asset_id = ""

    async def __call__(self, _context: Any, params: Any) -> ElicitResult:
        assert isinstance(params, ElicitRequestFormParams)
        properties = set(params.requestedSchema.get("properties", {}))
        assert properties in ({"approved"}, {"selectedAssetId"})
        assert "workspace" not in params.message.lower()
        self.requests.append(params)
        if self.decision == "approve":
            if properties == {"selectedAssetId"}:
                return ElicitResult(action="accept", content={"selectedAssetId": self.selected_asset_id})
            return ElicitResult(action="accept", content={"approved": True})
        if self.decision == "decline":
            return ElicitResult(action="decline")
        return ElicitResult(action="cancel")


def server_parameters(root: Path, workspace: Path, registry: Path, *, mode: str) -> StdioServerParameters:
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(root),
            "CROSSAGE_FORCE_FALLBACK": "1",
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(registry),
            "CROSSAGE_REGISTRY_HOME": str(registry),
            "VINTRACE_MCP_OPERATOR_TOKEN": "elicitation-test-operator",
            "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace.parent),
            "VINTRACE_MCP_DELEGATION_MODE": mode,
            "VINTRACE_MCP_DELEGATION_MIN_CONFIRMED_ACTIONS": "2",
            "VINTRACE_MCP_DELEGATION_MAX_ASSETS": "2",
            "VINTRACE_MCP_DELEGATION_TRUST_TTL_DAYS": "30",
        }
    )
    executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
    if executable:
        env.pop("PYTHONPATH", None)
        return StdioServerParameters(
            command=str(Path(executable).expanduser().resolve()),
            args=["--mcp", "--workspace", str(workspace)],
            env=env,
        )
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", "crossage_fr.mcp_server", "--workspace", str(workspace)],
        env=env,
    )


async def manual_elicitation_flow(params: StdioServerParameters, workspace: Path) -> None:
    decisions = ElicitationDecisions("approve")
    media = workspace.parent / "choice-media"
    media.mkdir(parents=True, exist_ok=True)
    first_path = media / "choice-fixture-one.jpg"
    second_path = media / "choice-fixture-two.jpg"
    Image.new("RGB", (80, 60), (40, 90, 140)).save(first_path)
    Image.new("RGB", (80, 60), (140, 90, 40)).save(second_path)
    choice_ids: list[str] = []
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write, elicitation_callback=decisions) as session:
            await session.initialize()
            consent = await session.call_tool(
                "mark_consent",
                {
                    "confirmed": True,
                    "operator": "MCP elicitation test",
                    "operator_token": "elicitation-test-operator",
                },
            )
            assert not consent.isError
            assert len(decisions.requests) == 1

            elicited_write = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Elicited album", "albumKind": "manual"},
                    "idempotency_key": "elicited-album-v1",
                },
            )
            assert not elicited_write.isError and elicited_write.structuredContent["ok"] is True
            assert len(decisions.requests) == 2

            imported = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "import_photos",
                    "payload": {
                        "sourcePaths": [str(first_path), str(second_path)],
                        "storageMode": "referenced",
                        "sourceLabel": "Elicitation choice fixtures",
                    },
                    "idempotency_key": "elicitation-choice-import-v1",
                },
            )
            assert not imported.isError and imported.structuredContent["ok"] is True
            found = await session.call_tool(
                "search_images",
                {"query": "choice fixture", "mode": "lexical", "limit": 10},
            )
            choice_ids = [str(row["assetId"]) for row in found.structuredContent["data"]["items"]]
            assert len(choice_ids) == 2
            decisions.selected_asset_id = choice_ids[1]
            choice = await session.call_tool(
                "elicit_image_asset_choice",
                {"candidate_asset_ids": choice_ids, "purpose": "duplicate_keeper"},
            )
            assert not choice.isError
            assert choice.structuredContent["ok"] is True
            assert choice.structuredContent["selectedAssetId"] == choice_ids[1]
            assert choice.structuredContent["method"] == "elicitation"

            decisions.decision = "decline"
            declined = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Declined album", "albumKind": "manual"},
                    "idempotency_key": "declined-album-v1",
                },
            )
            assert not declined.isError
            assert declined.structuredContent["error"]["code"] == "confirmation_required"
            activity = await session.call_tool("read_audit_events", {"limit": 100})
            serialized = json.dumps(activity.structuredContent, sort_keys=True)
            assert "mcp_elicitation_requested" in serialized
            assert "mcp_elicitation_resolved" in serialized
            assert str(workspace.resolve()) not in serialized

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            fallback = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Fallback album", "albumKind": "manual"},
                    "idempotency_key": "fallback-album-v1",
                },
            )
            assert not fallback.isError
            assert fallback.structuredContent["error"]["code"] == "confirmation_required"
            explicit_choice = await session.call_tool(
                "elicit_image_asset_choice",
                {
                    "candidate_asset_ids": choice_ids,
                    "purpose": "duplicate_keeper",
                    "selected_asset_id": choice_ids[0],
                },
            )
            assert explicit_choice.structuredContent["ok"] is True
            assert explicit_choice.structuredContent["method"] == "explicit"


async def train_progressive_trust(params: StdioServerParameters) -> str:
    decisions = ElicitationDecisions("approve")
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write, elicitation_callback=decisions) as session:
            await session.initialize()
            consent = await session.call_tool(
                "mark_consent",
                {
                    "confirmed": True,
                    "operator": "MCP delegation test",
                    "confirm": True,
                    "operator_token": "elicitation-test-operator",
                },
            )
            assert not consent.isError
            first_arguments = {
                "action": "save_photo_album",
                "payload": {"name": "Confirmed album 0", "albumKind": "manual"},
                "confirm": True,
                "idempotency_key": "confirmed-album-0-v1",
            }
            first = await session.call_tool("run_image_write_action", first_arguments)
            assert not first.isError and first.structuredContent["ok"] is True
            replay = await session.call_tool("run_image_write_action", first_arguments)
            assert replay.structuredContent["replayed"] is True
            assert len(decisions.requests) == 3

            decisions.decision = "cancel"
            before_threshold = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Still requires approval", "albumKind": "manual"},
                    "idempotency_key": "before-threshold-v1",
                },
            )
            assert before_threshold.structuredContent["error"]["code"] == "confirmation_required"
            assert len(decisions.requests) == 4
            decisions.requests.clear()

            decisions.decision = "approve"
            second = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Confirmed album 1", "albumKind": "manual"},
                    "confirm": True,
                    "idempotency_key": "confirmed-album-1-v1",
                },
            )
            assert not second.isError and second.structuredContent["ok"] is True
            album_id = str(second.structuredContent["data"].get("albumId", "") or "")
            assert album_id
            assert len(decisions.requests) == 1
            return album_id


async def verify_progressive_trust_after_restart(params: StdioServerParameters, album_id: str) -> None:
    decisions = ElicitationDecisions("decline")
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write, elicitation_callback=decisions) as session:
            await session.initialize()
            delegated = await session.call_tool(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Delegated after restart", "albumKind": "manual"},
                    "idempotency_key": "delegated-album-v1",
                },
            )
            assert not delegated.isError and delegated.structuredContent["ok"] is True
            assert not decisions.requests

            destructive = await session.call_tool(
                "run_destructive_image_action",
                {
                    "action": "delete_photo_album",
                    "payload": {"albumId": album_id},
                    "idempotency_key": "declined-delete-album-v1",
                },
            )
            assert not destructive.isError
            assert destructive.structuredContent["error"]["code"] == "confirmation_required"
            assert len(decisions.requests) == 1


async def exercise() -> None:
    root = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-elicitation-") as tmp:
        base = Path(tmp)
        manual_workspace = base / "manual-workspace"
        manual_params = server_parameters(root, manual_workspace, base / "manual-registry", mode="manual")
        await manual_elicitation_flow(manual_params, manual_workspace)

        progressive_workspace = base / "progressive-workspace"
        progressive_params = server_parameters(
            root,
            progressive_workspace,
            base / "progressive-registry",
            mode="progressive",
        )
        album_id = await train_progressive_trust(progressive_params)
        trust_database = progressive_workspace / "agent" / "mcp_delegation.sqlite3"
        assert trust_database.is_file() and trust_database.stat().st_size > 0
        await verify_progressive_trust_after_restart(progressive_params, album_id)


def main() -> None:
    asyncio.run(exercise())
    print("ok MCP approval/choice elicitation, fallback confirmation, progressive trust, restart, and destructive boundary")


if __name__ == "__main__":
    main()
