from __future__ import annotations

from contextlib import AbstractContextManager
from pathlib import Path
import json
import math
import os
import re
import threading
from typing import Any
from urllib.parse import urlparse

from opentelemetry import propagate
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExportResult, SpanExporter
from opentelemetry.trace import Span, SpanKind, Status, StatusCode

from crossage_fr import __version__
from crossage_fr.runtime_env import env_flag, env_value


TRACE_FILENAME = "mcp-traces.jsonl"
_SAFE_ATTRIBUTE_KEYS = frozenset(
    {
        "gen_ai.operation.name",
        "gen_ai.tool.name",
        "gen_ai.tool.type",
        "rpc.system",
        "rpc.method",
        "vintrace.action.name",
        "vintrace.delegation.used",
        "vintrace.elicitation.used",
        "vintrace.error.code",
        "vintrace.idempotency.present",
        "vintrace.idempotency.replayed",
        "vintrace.job.present",
        "vintrace.job.status",
        "vintrace.job.type",
        "vintrace.request_id.present",
        "vintrace.result.ok",
        "vintrace.task.present",
        "vintrace.tool.destructive",
        "vintrace.tool.lane",
        "vintrace.tool.open_world",
        "vintrace.tool.read_only",
    }
)
_SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _safe_attribute_value(value: Any) -> str | bool | int | float | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, str) and (value == "tools/call" or _SAFE_TOKEN_RE.fullmatch(value)):
        return value
    return None


class JsonlSpanExporter(SpanExporter):
    def __init__(self, path: Path, *, maximum_bytes: int) -> None:
        self.path = Path(path)
        self.maximum_bytes = maximum_bytes
        self._lock = threading.Lock()

    def _rotate(self, incoming_bytes: int) -> None:
        try:
            current = self.path.stat().st_size
        except OSError:
            current = 0
        if current + incoming_bytes <= self.maximum_bytes:
            return
        previous = self.path.with_suffix(self.path.suffix + ".1")
        try:
            previous.unlink(missing_ok=True)
            self.path.replace(previous)
        except OSError:
            pass

    @staticmethod
    def _record(span: ReadableSpan) -> dict[str, Any]:
        context = span.context
        parent = span.parent
        attributes = {
            key: safe_value
            for key, value in dict(span.attributes or {}).items()
            if key in _SAFE_ATTRIBUTE_KEYS and (safe_value := _safe_attribute_value(value)) is not None
        }
        start_ns = int(span.start_time or 0)
        end_ns = int(span.end_time or start_ns)
        return {
            "schemaVersion": 1,
            "traceId": f"{context.trace_id:032x}" if context is not None else "",
            "spanId": f"{context.span_id:016x}" if context is not None else "",
            "parentSpanId": f"{parent.span_id:016x}" if parent is not None else "",
            "name": str(span.name or "")[:180],
            "kind": str(span.kind.name if span.kind is not None else "INTERNAL"),
            "startTimeUnixNano": start_ns,
            "endTimeUnixNano": end_ns,
            "durationMs": round(max(0, end_ns - start_ns) / 1_000_000, 3),
            "status": str(span.status.status_code.name if span.status is not None else "UNSET"),
            "attributes": attributes,
        }

    def export(self, spans: tuple[ReadableSpan, ...]) -> SpanExportResult:
        if not spans:
            return SpanExportResult.SUCCESS
        lines = [json.dumps(self._record(span), sort_keys=True, separators=(",", ":")) + "\n" for span in spans]
        encoded_bytes = sum(len(line.encode("utf-8")) for line in lines)
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self._rotate(encoded_bytes)
                with self.path.open("a", encoding="utf-8") as handle:
                    for line in lines:
                        handle.write(line)
                if os.name != "nt":
                    os.chmod(self.path, 0o600)
            except OSError:
                return SpanExportResult.FAILURE
        return SpanExportResult.SUCCESS


def _validated_otlp_endpoint() -> str:
    value = str(env_value("MCP_OTLP_ENDPOINT") or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if not parsed.hostname or parsed.scheme not in ({"https"} | ({"http"} if local else set())):
        raise ValueError("VINTRACE_MCP_OTLP_ENDPOINT must be HTTPS or localhost HTTP.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("VINTRACE_MCP_OTLP_ENDPOINT cannot contain credentials, a query, or a fragment.")
    return value


def _trace_carrier(meta: Any) -> dict[str, str]:
    if meta is None:
        return {}
    if hasattr(meta, "model_dump"):
        raw = meta.model_dump(by_alias=True)
    elif isinstance(meta, dict):
        raw = meta
    else:
        return {}
    return {
        key: str(raw[key])[:1024]
        for key in ("traceparent", "tracestate", "baggage")
        if isinstance(raw.get(key), str)
    }


class McpToolSpan(AbstractContextManager["McpToolSpan"]):
    def __init__(
        self,
        telemetry: "McpTelemetry",
        *,
        tool_name: str,
        lane: str,
        arguments: dict[str, Any],
        request_meta: Any,
        task_present: bool,
        read_only: bool,
        destructive: bool,
        open_world: bool,
    ) -> None:
        self.telemetry = telemetry
        self.tool_name = str(tool_name or "unknown")
        self._span: Span | None = None
        self._context_manager: Any = None
        self._attributes = {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": self.tool_name,
            "gen_ai.tool.type": "extension",
            "rpc.system": "mcp",
            "rpc.method": "tools/call",
            "vintrace.idempotency.present": bool(str(arguments.get("idempotency_key", "") or "").strip()),
            "vintrace.task.present": bool(task_present),
            "vintrace.tool.destructive": bool(destructive),
            "vintrace.tool.lane": lane,
            "vintrace.tool.open_world": bool(open_world),
            "vintrace.tool.read_only": bool(read_only),
        }
        self._parent_context = propagate.extract(_trace_carrier(request_meta))

    def __enter__(self) -> "McpToolSpan":
        if not self.telemetry.enabled:
            return self
        self._context_manager = self.telemetry.tracer.start_as_current_span(
            f"execute_tool {self.tool_name}",
            context=self._parent_context,
            kind=SpanKind.INTERNAL,
            attributes=self._attributes,
            record_exception=False,
            set_status_on_exception=False,
        )
        self._span = self._context_manager.__enter__()
        return self

    def _set(self, key: str, value: Any) -> None:
        safe = _safe_attribute_value(value)
        if self._span is not None and key in _SAFE_ATTRIBUTE_KEYS and safe is not None:
            self._span.set_attribute(key, safe)

    @staticmethod
    def _nested(value: Any, key: str) -> Any:
        if isinstance(value, dict):
            if key in value and value[key] not in (None, ""):
                return value[key]
            for child in value.values():
                found = McpToolSpan._nested(child, key)
                if found not in (None, ""):
                    return found
        elif isinstance(value, list):
            for child in value:
                found = McpToolSpan._nested(child, key)
                if found not in (None, ""):
                    return found
        return None

    def observe_result(self, result: Any) -> None:
        structured = getattr(result, "structuredContent", None)
        is_error = bool(getattr(result, "isError", False))
        if structured is None and isinstance(result, tuple) and len(result) == 2:
            structured = result[1]
        if structured is None and isinstance(result, dict):
            structured = result
        structured = structured if isinstance(structured, dict) else {}
        ok = not is_error and structured.get("ok") is not False and not bool(structured.get("error"))
        self._set("vintrace.result.ok", ok)
        self._set("vintrace.request_id.present", bool(structured.get("requestId")))
        self._set("vintrace.idempotency.replayed", bool(structured.get("replayed")))
        action = str(structured.get("action", "") or "")
        if re.fullmatch(r"[a-z][a-z0-9_]{1,100}", action):
            self._set("vintrace.action.name", action)
        error = structured.get("error") if isinstance(structured.get("error"), dict) else {}
        error_code = str(error.get("code", "") or "")
        if error_code:
            self._set("vintrace.error.code", error_code)
        job_id = self._nested(structured, "jobId")
        self._set("vintrace.job.present", bool(job_id))
        job_type = str(self._nested(structured, "jobType") or "")
        if job_type:
            self._set("vintrace.job.type", job_type)
        job_status = str(self._nested(structured, "status") or "")
        if job_status:
            self._set("vintrace.job.status", job_status)
        self._set("vintrace.delegation.used", bool(self._nested(structured, "delegated")))
        self._set("vintrace.elicitation.used", bool(self._nested(structured, "elicited")))
        if self._span is not None:
            self._span.set_status(Status(StatusCode.UNSET if ok else StatusCode.ERROR))

    def __exit__(self, exc_type, exc, traceback) -> bool | None:
        if self._span is not None and exc_type is not None:
            self._span.set_status(Status(StatusCode.ERROR))
            self._set("vintrace.result.ok", False)
            self._set("vintrace.error.code", "tool_exception")
        if self._context_manager is not None:
            self._context_manager.__exit__(exc_type, exc, traceback)
        return None


class McpTelemetry:
    def __init__(self, workspace: Path) -> None:
        self.workspace = Path(workspace)
        # Opt-IN, not opt-out. This product's posture is "genuinely no telemetry"
        # (docs/security-audit.md), and its legal footing for on-device biometric
        # processing rests on biometric-adjacent data never being collected. A trace
        # log that appears by default — written in plaintext inside an otherwise
        # encrypted workspace — undermines both. Operators who want tracing set
        # VINTRACE_MCP_OTEL_ENABLED=1.
        self.enabled = env_flag("MCP_OTEL_ENABLED", default=False)
        self.trace_path = self.workspace / "agent" / TRACE_FILENAME
        self.provider: TracerProvider | None = None
        self.tracer: Any = None
        if not self.enabled:
            return
        maximum_bytes = _bounded_int(
            env_value("MCP_OTEL_MAX_BYTES"),
            default=20 * 1024 * 1024,
            minimum=1 * 1024 * 1024,
            maximum=200 * 1024 * 1024,
        )
        self.provider = TracerProvider(
            resource=Resource.create(
                {
                    "service.name": "vintrace-mcp",
                    "service.version": __version__,
                }
            )
        )
        self.provider.add_span_processor(
            SimpleSpanProcessor(JsonlSpanExporter(self.trace_path, maximum_bytes=maximum_bytes))
        )
        endpoint = _validated_otlp_endpoint()
        if endpoint:
            self.provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, timeout=3))
            )
        self.tracer = self.provider.get_tracer("vintrace.mcp", __version__)

    def tool_span(
        self,
        *,
        tool_name: str,
        lane: str,
        arguments: dict[str, Any],
        request_meta: Any = None,
        task_present: bool = False,
        read_only: bool = False,
        destructive: bool = False,
        open_world: bool = False,
    ) -> McpToolSpan:
        return McpToolSpan(
            self,
            tool_name=tool_name,
            lane=lane,
            arguments=arguments,
            request_meta=request_meta,
            task_present=task_present,
            read_only=read_only,
            destructive=destructive,
            open_world=open_world,
        )

    def shutdown(self) -> None:
        if self.provider is not None:
            self.provider.shutdown()


def read_trace_records(path: Path) -> list[dict[str, Any]]:
    if not Path(path).is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except ValueError:
            records.append({"_malformed": True})
            continue
        records.append(value if isinstance(value, dict) else {"_malformed": True})
    return records


def evaluate_trace_file(path: Path) -> dict[str, Any]:
    records = read_trace_records(path)
    errors: list[str] = []
    durations: list[float] = []
    failed_spans = 0
    idempotent_spans = 0
    job_spans = 0
    task_spans = 0
    lane_counts = {"read": 0, "write": 0, "destructive": 0}
    tools: set[str] = set()
    required = {
        "gen_ai.operation.name",
        "gen_ai.tool.name",
        "gen_ai.tool.type",
        "rpc.method",
        "rpc.system",
        "vintrace.idempotency.present",
        "vintrace.tool.lane",
    }
    for index, record in enumerate(records):
        if record.get("_malformed"):
            errors.append(f"span {index} is malformed")
            continue
        attributes = record.get("attributes") if isinstance(record.get("attributes"), dict) else {}
        missing = sorted(required - set(attributes))
        if missing:
            errors.append(f"span {index} missing attributes: {', '.join(missing)}")
        extra = sorted(set(attributes) - _SAFE_ATTRIBUTE_KEYS)
        if extra:
            errors.append(f"span {index} contains unapproved attributes: {', '.join(extra)}")
        for key, value in attributes.items():
            if _safe_attribute_value(value) is None:
                errors.append(f"span {index} contains unsafe value for {key}")
        tool = str(attributes.get("gen_ai.tool.name", "") or "")
        lane = str(attributes.get("vintrace.tool.lane", "") or "")
        if tool:
            tools.add(tool)
        if lane not in {"read", "write", "destructive"}:
            errors.append(f"span {index} has invalid lane")
        else:
            lane_counts[lane] += 1
        idempotent_spans += int(attributes.get("vintrace.idempotency.present") is True)
        job_spans += int(attributes.get("vintrace.job.present") is True)
        task_spans += int(attributes.get("vintrace.task.present") is True)
        if tool == "run_image_write_action" and lane != "write":
            errors.append(f"span {index} misclassifies the write lane")
        if tool == "run_destructive_image_action" and lane != "destructive":
            errors.append(f"span {index} misclassifies the destructive lane")
        duration = record.get("durationMs")
        if not isinstance(duration, (int, float)) or duration < 0:
            errors.append(f"span {index} has invalid duration")
        else:
            durations.append(float(duration))
        if str(record.get("status", "")) == "ERROR":
            failed_spans += 1
        if not re.fullmatch(r"[a-f0-9]{32}", str(record.get("traceId", ""))):
            errors.append(f"span {index} has invalid trace id")
        if not re.fullmatch(r"[a-f0-9]{16}", str(record.get("spanId", ""))):
            errors.append(f"span {index} has invalid span id")
    ordered = sorted(durations)
    p95 = ordered[min(len(ordered) - 1, max(0, math.ceil(len(ordered) * 0.95) - 1))] if ordered else 0.0
    return {
        "ok": bool(records) and not errors,
        "traceFile": str(Path(path).name),
        "spans": len(records),
        "uniqueTools": len(tools),
        "laneCounts": lane_counts,
        "idempotentSpans": idempotent_spans,
        "jobSpans": job_spans,
        "taskSpans": task_spans,
        "failedSpans": failed_spans,
        "p95DurationMs": round(p95, 3),
        "privacySafe": not any("unsafe value" in error or "unapproved attributes" in error for error in errors),
        "errors": errors[:100],
    }
