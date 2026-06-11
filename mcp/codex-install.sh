#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
WORKSPACE="${1:-$ROOT/vintrace_project}"
PYTHON="$ROOT/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

codex mcp add vintrace \
  --env "PYTHONPATH=$ROOT" \
  --env "VINTRACE_WORKSPACE=$WORKSPACE" \
  --env "CROSSAGE_WORKSPACE=$WORKSPACE" \
  -- "$PYTHON" -m crossage_fr.mcp_server --workspace "$WORKSPACE"
