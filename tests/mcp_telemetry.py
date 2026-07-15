from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import tempfile

from mcp.types import CallToolResult, TextContent

from crossage_fr.agent_telemetry import McpTelemetry, evaluate_trace_file, read_trace_records


def main() -> None:
    original = {
        key: os.environ.get(key)
        for key in (
            "VINTRACE_MCP_OTEL_ENABLED",
            "VINTRACE_MCP_OTLP_ENDPOINT",
        )
    }
    try:
        os.environ["VINTRACE_MCP_OTEL_ENABLED"] = "1"
        os.environ.pop("VINTRACE_MCP_OTLP_ENDPOINT", None)
        with tempfile.TemporaryDirectory(prefix="vintrace-mcp-telemetry-") as tmp:
            workspace = Path(tmp) / "workspace"
            telemetry = McpTelemetry(workspace)
            traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
            with telemetry.tool_span(
                tool_name="get_project_state",
                lane="read",
                arguments={},
                request_meta={"traceparent": traceparent, "baggage": "private=value"},
                read_only=True,
            ) as span:
                span.observe_result({"state": "ready"})

            with telemetry.tool_span(
                tool_name="run_image_write_action",
                lane="write",
                arguments={"idempotency_key": "must-never-appear", "sourcePath": "/private/photo.jpg"},
                request_meta=None,
                open_world=True,
            ) as span:
                span.observe_result(
                    CallToolResult(
                        content=[TextContent(type="text", text="not exported")],
                        structuredContent={
                            "ok": True,
                            "requestId": "request_opaque",
                            "action": "enqueue_photo_indexing_job",
                            "replayed": True,
                            "data": {
                                "job": {
                                    "jobId": "job_secret",
                                    "jobType": "indexing",
                                    "status": "completed",
                                }
                            },
                        },
                    )
                )

            try:
                with telemetry.tool_span(
                    tool_name="run_destructive_image_action",
                    lane="destructive",
                    arguments={"idempotency_key": "another-secret"},
                    request_meta=None,
                    destructive=True,
                ):
                    raise ValueError("/private/path and secret payload")
            except ValueError:
                pass
            telemetry.shutdown()

            trace_path = workspace / "agent" / "mcp-traces.jsonl"
            report = evaluate_trace_file(trace_path)
            assert report["ok"], report
            assert report["spans"] == 3 and report["failedSpans"] == 1
            records = read_trace_records(trace_path)
            assert records[0]["traceId"] == "0af7651916cd43dd8448eb211c80319c"
            assert records[0]["parentSpanId"] == "b7ad6b7169203331"
            write_attributes = records[1]["attributes"]
            assert write_attributes["vintrace.idempotency.present"] is True
            assert write_attributes["vintrace.idempotency.replayed"] is True
            assert write_attributes["vintrace.job.present"] is True
            assert write_attributes["vintrace.job.type"] == "indexing"
            serialized = json.dumps(records, sort_keys=True)
            for secret in ("must-never-appear", "another-secret", "/private", "job_secret", "private=value"):
                assert secret not in serialized
            if os.name != "nt":
                assert stat.S_IMODE(trace_path.stat().st_mode) == 0o600

            unsafe_path = workspace / "agent" / "unsafe-traces.jsonl"
            unsafe = dict(records[0])
            unsafe["attributes"] = {**unsafe["attributes"], "source.path": "/private/photo.jpg"}
            unsafe_path.write_text(json.dumps(unsafe) + "\n", encoding="utf-8")
            unsafe_report = evaluate_trace_file(unsafe_path)
            assert not unsafe_report["ok"] and not unsafe_report["privacySafe"]

        os.environ["VINTRACE_MCP_OTEL_ENABLED"] = "0"
        with tempfile.TemporaryDirectory(prefix="vintrace-mcp-telemetry-disabled-") as tmp:
            disabled = McpTelemetry(Path(tmp))
            with disabled.tool_span(tool_name="get_project_state", lane="read", arguments={}):
                pass
            assert not disabled.trace_path.exists()

        os.environ["VINTRACE_MCP_OTEL_ENABLED"] = "1"
        os.environ["VINTRACE_MCP_OTLP_ENDPOINT"] = "http://telemetry.example.test/v1/traces"
        try:
            McpTelemetry(Path(tempfile.mkdtemp(prefix="vintrace-mcp-telemetry-endpoint-")))
        except ValueError as exc:
            assert "HTTPS or localhost" in str(exc)
        else:
            raise AssertionError("Remote plaintext OTLP endpoints must be rejected.")
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    print("ok privacy-safe MCP OpenTelemetry spans, propagation, local evals, and endpoint policy")


if __name__ == "__main__":
    main()
