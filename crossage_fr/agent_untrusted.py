"""Isolation boundary for third-party (ingested) text on the agent surface.

The MCP/HTTP agent tools echo text that originated from *outside* the trust
boundary — OCR results, EXIF/IPTC/XMP captions, object-tag labels, barcode
payloads, filenames, and connector-sourced content. Path/hash redaction
(``mcp_server._redact_tool_output``) hides *where media lives* but does nothing
to stop that text from carrying **instructions** aimed at the agent's model
(prompt injection / tool-poisoning via content).

This module makes such text inert-as-instructions while keeping it faithful as
*data*:

* ``normalize_untrusted`` removes obfuscation (zero-width, control, and bidi
  characters) and escapes the boundary delimiters so content cannot forge one.
* ``detect_injection`` heuristically flags override/role/tool/exfiltration spans.
* ``wrap_untrusted`` boxes a string as ``{"_type": "untrusted_ingested_text",
  "value": ⟪UNTRUSTED⟫…⟪/UNTRUSTED⟫, "injectionFlags": [...]}``. In neutralize
  mode the flagged spans are removed; by default they are preserved (search
  fidelity) but clearly delimited and typed as data.
* ``isolate_untrusted_output`` walks a redacted tool result and boxes the known
  untrusted-origin fields, returning the value plus a per-category detection
  summary for audit.

The module is pure and standalone (no import of ``mcp_server``) so it can run at
both transport boundaries. If isolation itself fails, it returns a generic
withheld-output error rather than the original unisolated value.
"""

from __future__ import annotations

import re
from typing import Any

from mcp.types import CallToolResult, TextContent

# Boundary delimiters. Guillemets are used because they do not occur in path or
# hash redaction output and are trivial to strip from attacker content.
OPEN = "⟪UNTRUSTED⟫"
CLOSE = "⟪/UNTRUSTED⟫"

_WRAP_TYPE = "untrusted_ingested_text"
ISOLATION_FAILURE_CODE = "untrusted_content_isolation_failed"
ISOLATION_FAILURE_MESSAGE = (
    "Agent output was withheld because untrusted content isolation failed."
)

# Keys whose value is ingested free-text and should be boxed directly (a string,
# or a list of strings).
UNTRUSTED_LEAF_KEYS = frozenset({
    "title", "caption", "captions", "description", "text", "legacytext",
    "detectedtext", "livetext", "ocrtext", "label", "keyword", "keywords",
    "note", "notes", "comment", "comments", "subject", "headline", "personname",
    "foldername", "filename", "displayname", "annotation", "message",
})

# Keys whose *entire nested content* is ingested (every string leaf is boxed).
# NB: the asset ``metadata`` object is NOT here — it also holds trusted enums
# (mediaKind/mimeType); only its free-form ``values`` sub-dict is untrusted.
UNTRUSTED_SUBTREE_KEYS = frozenset({
    "values", "metadatavalues", "exif", "iptc", "xmp", "rawmetadata",
})

# Characters that hide or spoof content and have no place in searchable text.
_ZERO_WIDTH = "​‌‍⁠﻿"
_BIDI = "‪‫‬‭‮⁦⁧⁨⁩‎‏"
_STRIP_CHARS = _ZERO_WIDTH + _BIDI
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")

_INJECTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "imperative_override",
        re.compile(
            r"(?is)\b(ignore|disregard|forget|override|bypass|skip)\b.{0,40}?"
            r"\b(instruction|instructions|prompt|prompts|rule|rules|direction|"
            r"directions|command|commands|context|guardrail|guardrails)\b"
        ),
    ),
    (
        "role_marker",
        re.compile(
            r"(?im)(^\s*(system|assistant|user|developer)\s*:)|(<\|[^|]*\|>)|"
            r"(\[/?INST\])|(###\s*(system|instruction))"
        ),
    ),
    (
        "tool_syntax",
        re.compile(
            r"(?i)(tool_call|function_call|</?tool_call>|<function\b|<invoke\b|"
            r"\"role\"\s*:\s*\"(system|assistant)\")"
        ),
    ),
    (
        "exfiltration",
        re.compile(
            r"(?is)\b(send|upload|exfiltrate|post|leak|email|transmit|share)\b.{0,40}?"
            r"\b(password|passwords|secret|secrets|token|tokens|api[\s_-]?key|"
            r"credential|credentials|private[\s_-]?key|\.env)\b"
        ),
    ),
)


def normalize_untrusted(text: str) -> str:
    """Strip obfuscation/control characters and defang the boundary delimiters."""
    if not text:
        return text
    # Escape the guillemet brackets so no OPEN/CLOSE token can survive in content.
    cleaned = text.replace("⟪", "[").replace("⟫", "]")
    cleaned = _CONTROL_RE.sub("", cleaned)
    if any(ch in cleaned for ch in _STRIP_CHARS):
        cleaned = cleaned.translate({ord(ch): None for ch in _STRIP_CHARS})
    return cleaned


def detect_injection(text: str) -> list[str]:
    """Return the sorted, de-duplicated injection categories matched in ``text``."""
    if not text:
        return []
    found = {name for name, pattern in _INJECTION_PATTERNS if pattern.search(text)}
    return sorted(found)


def _is_wrapped(value: Any) -> bool:
    return isinstance(value, dict) and value.get("_type") == _WRAP_TYPE


def wrap_untrusted(value: Any, *, neutralize: bool = False) -> dict[str, Any]:
    """Box a value as typed, delimited untrusted data. Idempotent on wrapped input."""
    if _is_wrapped(value):
        return value  # already boxed — do not double-delimit
    text = value if isinstance(value, str) else str(value)
    normalized = normalize_untrusted(text)
    flags = detect_injection(normalized)
    if neutralize and flags:
        for name, pattern in _INJECTION_PATTERNS:
            if name in flags:
                normalized = pattern.sub(f"[removed:{name}]", normalized)
    return {
        "_type": _WRAP_TYPE,
        "value": f"{OPEN}{normalized}{CLOSE}",
        "injectionFlags": flags,
    }


def _count(summary: dict[str, int], flags: list[str]) -> None:
    for flag in flags:
        summary[flag] = summary.get(flag, 0) + 1


def _wrap_leaf(value: Any, *, neutralize: bool, summary: dict[str, int]) -> Any:
    """Box a leaf-key value: a string, or the strings inside a list."""
    if _is_wrapped(value):
        return value
    if isinstance(value, str):
        node = wrap_untrusted(value, neutralize=neutralize)
        _count(summary, node["injectionFlags"])
        return node
    if isinstance(value, list):
        return [_wrap_leaf(item, neutralize=neutralize, summary=summary) for item in value]
    if isinstance(value, dict):
        return _walk(value, neutralize=neutralize, summary=summary)
    return value


def _wrap_subtree(value: Any, *, neutralize: bool, summary: dict[str, int]) -> Any:
    """Box every string leaf inside an entirely-untrusted subtree."""
    if _is_wrapped(value):
        return value
    if isinstance(value, str):
        node = wrap_untrusted(value, neutralize=neutralize)
        _count(summary, node["injectionFlags"])
        return node
    if isinstance(value, dict):
        return {key: _wrap_subtree(child, neutralize=neutralize, summary=summary)
                for key, child in value.items()}
    if isinstance(value, list):
        return [_wrap_subtree(item, neutralize=neutralize, summary=summary) for item in value]
    return value


def _walk(value: Any, *, neutralize: bool, summary: dict[str, int]) -> Any:
    if _is_wrapped(value):
        return value  # idempotent: leave already-boxed nodes untouched
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_lower = str(key).lower()
            if key_lower in UNTRUSTED_SUBTREE_KEYS:
                result[key] = _wrap_subtree(child, neutralize=neutralize, summary=summary)
            elif key_lower in UNTRUSTED_LEAF_KEYS:
                result[key] = _wrap_leaf(child, neutralize=neutralize, summary=summary)
            else:
                result[key] = _walk(child, neutralize=neutralize, summary=summary)
        return result
    if isinstance(value, list):
        return [_walk(item, neutralize=neutralize, summary=summary) for item in value]
    return value


def isolate_untrusted_output(
    value: Any, *, neutralize: bool = False
) -> tuple[Any, dict[str, int]]:
    """Isolate ingested text in a (redacted) tool result.

    Returns the transformed value plus a ``{category: count}`` detection summary.
    Fail closed: on any internal error, return a generic serializable error and
    never return the original unisolated value.
    """
    summary: dict[str, int] = {}
    try:
        if isinstance(value, CallToolResult):
            structured = value.structuredContent
            if isinstance(structured, (dict, list)):
                structured = _walk(structured, neutralize=neutralize, summary=summary)
                return value.model_copy(update={"structuredContent": structured}), summary
            return value, summary
        return _walk(value, neutralize=neutralize, summary=summary), summary
    except Exception:
        failure = {
            "ok": False,
            "error": {
                "code": ISOLATION_FAILURE_CODE,
                "message": ISOLATION_FAILURE_MESSAGE,
            },
        }
        summary["isolation_failure"] = 1
        if isinstance(value, CallToolResult):
            return (
                CallToolResult(
                    content=[TextContent(type="text", text=ISOLATION_FAILURE_MESSAGE)],
                    structuredContent=failure,
                    isError=True,
                ),
                summary,
            )
        return failure, summary
