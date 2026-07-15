# Vintrace real-client dogfood

This suite runs the same golden image workflows through authenticated Codex,
Claude Code, and Claude Desktop sessions. It never uses the user's normal photo
library. `prepare_fixture.py` creates an isolated 1,000-asset workspace and the
stdio trace proxy records MCP JSON-RPC messages without changing them.

```bash
.venv/bin/python tests/agent_dogfood/dogfood.py prepare
.venv/bin/python tests/agent_dogfood/dogfood.py run --client codex
.venv/bin/python tests/agent_dogfood/dogfood.py run --client claude-code
.venv/bin/python tests/agent_dogfood/dogfood.py score
```

Desktop runs use the generated Claude configuration and the same per-workflow
trace files. They must be submitted in the actual Claude app; protocol-only
calls are deliberately not accepted as Desktop evidence.

All retained evidence is path-redacted. Raw client stdout can contain model
prose and stable asset IDs but is not committed.
