from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from crossage_fr import __version__
from crossage_fr.api_server import serve
from crossage_fr.embed import create_embedding_engine
from crossage_fr.enroll import ProjectState
from crossage_fr.platform_detect import build_platform_report
from crossage_fr.workspace_registry import resolve_workspace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cross-age face review desktop app")
    parser.add_argument("--workspace", default=None, help="Project workspace directory. Defaults to active desktop workspace when available.")
    parser.add_argument("--check", action="store_true", help="Run startup checks without opening the desktop UI")
    parser.add_argument("--backend", action="store_true", help="Run the JSON-RPC backend used by Electron")
    parser.add_argument("--mcp", action="store_true", help="Run the MCP server for Codex, Claude, and other agents")
    parser.add_argument("--mcp-transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--mcp-host", default="127.0.0.1")
    parser.add_argument("--mcp-port", type=int, default=8765)
    parser.add_argument("--allow-remote-mcp-http", action="store_true", help="Allow MCP HTTP to bind beyond localhost")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    workspace = resolve_workspace(args.workspace)
    if args.backend:
        os.environ["CROSSAGE_WORKSPACE"] = str(workspace)
        serve(workspace)
        return
    if args.mcp:
        from crossage_fr.mcp_server import run_mcp_server

        os.environ["CROSSAGE_WORKSPACE"] = str(workspace)
        run_mcp_server(
            workspace=workspace,
            transport=args.mcp_transport,
            host=args.mcp_host,
            port=args.mcp_port,
            allow_remote_http=args.allow_remote_mcp_http,
        )
        return
    if args.check:
        project = ProjectState(workspace, actor="check")
        engine = create_embedding_engine(project.config)
        report = build_platform_report()
        print(
            json.dumps(
                {
                    "version": __version__,
                    "workspace": str(project.root),
                    "engine": engine.model_name,
                    "platform": report.platform_key,
                    "providers": [str(provider) for provider in report.selected_providers],
                    "references": len(project.references),
                    "candidates": len(project.candidates),
                    "vector_store": project.vector_store.backend_name,
                    "accelerator_status": report.accelerator_status,
                },
                indent=2,
            )
        )
        return
    package_json = Path(__file__).resolve().parent / "package.json"
    if not package_json.exists():
        raise SystemExit("Electron desktop files are missing. Run python3 main.py --check for backend checks.")
    env = {**os.environ, "CROSSAGE_WORKSPACE": str(workspace)}
    raise SystemExit(subprocess.call(["npm", "run", "start"], cwd=package_json.parent, env=env))


if __name__ == "__main__":
    main()
