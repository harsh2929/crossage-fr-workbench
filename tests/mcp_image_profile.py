from __future__ import annotations

import asyncio
import os
from pathlib import Path
import sys
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from crossage_fr.mcp_server import IMAGE_AGENT_TOOL_NAMES


async def verify() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-image-profile-") as tmp:
        root = Path(tmp).resolve()
        workspace = root / "workspace"
        env = dict(os.environ)
        env.update({
            "PYTHONPATH": str(Path(__file__).resolve().parent.parent),
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_MCP_ALLOWED_ROOTS": str(root),
        })
        frozen = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
        command = frozen or sys.executable
        args = (
            ["--mcp", "--workspace", str(workspace), "--mcp-tool-profile", "images"]
            if frozen
            else ["-m", "crossage_fr.mcp_server", "--workspace", str(workspace), "--tool-profile", "images"]
        )
        params = StdioServerParameters(
            command=command,
            args=args,
            env=env,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                assert initialized.serverInfo.name == "Vintrace"
                listed = await session.list_tools()
                names = {tool.name for tool in listed.tools}
                assert names == set(IMAGE_AGENT_TOOL_NAMES), (names - set(IMAGE_AGENT_TOOL_NAMES), set(IMAGE_AGENT_TOOL_NAMES) - names)
                capability_tool = next(tool for tool in listed.tools if tool.name == "list_image_capabilities")
                assert capability_tool.inputSchema["properties"]["include_actions"]["default"] is False
                search_tool = next(tool for tool in listed.tools if tool.name == "search_images")
                assert "filters" in search_tool.inputSchema["properties"]
                assert "do not repeat identical calls" in str(search_tool.description).lower()
    print("compact MCP image profile ok")


if __name__ == "__main__":
    asyncio.run(verify())
