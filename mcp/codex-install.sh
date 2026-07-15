#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
WORKSPACE="${1:-$ROOT/vintrace_project}"
APPROVED_ROOTS="${2:-$WORKSPACE}"
PYTHON="$ROOT/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

codex mcp add vintrace \
  --env "PYTHONPATH=$ROOT" \
  --env "VINTRACE_WORKSPACE=$WORKSPACE" \
  --env "CROSSAGE_WORKSPACE=$WORKSPACE" \
  --env "VINTRACE_MCP_ALLOWED_ROOTS=$APPROVED_ROOTS" \
  --env "VINTRACE_REQUIRE_DB_ENCRYPTION=1" \
  -- "$PYTHON" -m crossage_fr.mcp_server --workspace "$WORKSPACE" --tool-profile images
