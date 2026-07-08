"""Regression tests for MCP output redaction and model-integrity gating.

These lock in three bypasses found by adversarial verification of the Security
Phase-1/3 residual fixes (Wave 1):

- USC-04: model integrity must reject an ADDED unrecorded .onnx, not only an
  edited recorded one (the engine loads by priority filename, so an added
  higher-priority file would otherwise be loaded ahead of the genuine weights).
- MCP-04 basename leak: path redaction must mask absolute paths AND media
  filenames embedded *inside* free-text fields (error/audit messages), not only
  strings that start with a path separator.
- MCP video probing must require consent before path probing or decoder work,
  matching the image assessment tool.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/mcp_redaction.py
"""

from __future__ import annotations

import anyio
import inspect
import json
import tempfile
from pathlib import Path

import crossage_fr.model_manager as mm
import crossage_fr.mcp_server as mcp


LEAK_PATH = "/Users/jane/Pictures/evidence/minors-2024/jane_doe_2009-04-12.jpg"
LEAK_NAME = "jane_doe_2009-04-12.jpg"


def test_usc04_rejects_added_unrecorded_model() -> None:
    spec = mm.MODEL_PACKAGES["antelopev2"]
    with tempfile.TemporaryDirectory() as d:
        pack = Path(d)
        (pack / "det_10g.onnx").write_bytes(b"genuine-detector")
        (pack / "w600k_r50.onnx").write_bytes(b"genuine-recognizer")
        mm.write_model_integrity_manifest(pack, spec)
        mm.verify_model_files(pack, "antelopev2")  # clean set passes

        # Editing a recorded file is caught.
        (pack / "det_10g.onnx").write_bytes(b"tampered")
        try:
            mm.verify_model_files(pack, "antelopev2")
            raise AssertionError("edited recorded file not detected")
        except mm.ModelIntegrityError:
            pass
        (pack / "det_10g.onnx").write_bytes(b"genuine-detector")

        # Adding an unrecorded higher-priority file is ALSO caught (close-the-set).
        (pack / "scrfd_10g_bnkps.onnx").write_bytes(b"attacker-weights")
        try:
            mm.verify_model_files(pack, "antelopev2")
            raise AssertionError("added unrecorded .onnx not detected (USC-04 bypass)")
        except mm.ModelIntegrityError as exc:
            assert "not covered by the integrity manifest" in str(exc)


def test_absent_manifest_is_skipped() -> None:
    # Dev / pre-bundled packs without a manifest must not hard-fail.
    with tempfile.TemporaryDirectory() as d:
        mm.verify_model_files(Path(d), "antelopev2")


def test_packaged_build_requires_model_integrity_manifest() -> None:
    original_is_packaged = mm._is_packaged
    mm._is_packaged = lambda: True  # type: ignore[assignment]
    try:
        with tempfile.TemporaryDirectory() as d:
            try:
                mm.verify_model_files(Path(d), "antelopev2")
                raise AssertionError("packaged build accepted a model pack without an integrity manifest")
            except mm.ModelIntegrityError as exc:
                assert "required in packaged builds" in str(exc)
    finally:
        mm._is_packaged = original_is_packaged  # type: ignore[assignment]


def test_embedded_path_redacted_in_resource_freetext() -> None:
    frag = {"scanHistory": [{"errorSamples": [f"{LEAK_NAME}: [Errno 13] Permission denied: '{LEAK_PATH}'"]}]}
    out = json.dumps(mcp._agent_safe_value(frag, keep_path_names=False))
    assert LEAK_PATH not in out, "absolute path leaked in resource free-text"
    assert LEAK_NAME not in out, "biometric filename leaked in resource free-text"


def test_embedded_path_redacted_in_audit_message() -> None:
    row = {"message": f"Could not decode image at {LEAK_PATH} (corrupt JPEG)", "detail": f"skipped {LEAK_NAME}"}
    out = json.dumps(mcp._agent_safe_value(row, keep_path_names=False))
    assert LEAK_PATH not in out and LEAK_NAME not in out


def test_embedded_path_redacted_in_tool_output() -> None:
    out = json.dumps(mcp._redact_tool_output({"errorSamples": [f"x.jpg failed near {LEAK_PATH}"]}))
    assert LEAK_PATH not in out


def test_hash_fields_redacted_in_tool_output() -> None:
    # MCP-04 regression: image hashes are biometric fingerprints and must be
    # hidden in tool output, matching resource redaction. A raw SHA-256 in a
    # candidate row (query_candidates) previously leaked to agents.
    leak_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    payload = {
        "items": [
            {"candidateId": "x", "sourceHash": leak_hash, "sha256": leak_hash, "phash": "ff00ff00", "customHash": leak_hash},
        ]
    }
    out = json.dumps(mcp._redact_tool_output(payload))
    assert leak_hash not in out, "biometric hash leaked in tool output"
    assert "ff00ff00" not in out, "perceptual hash leaked in tool output"
    # And resources must stay redacted too.
    assert leak_hash not in json.dumps(mcp._agent_safe_value(payload, keep_path_names=False))


def test_exception_text_redacted_before_mcp_framework_sees_it() -> None:
    message = mcp._redacted_exception_message(ValueError(f"failed to open {LEAK_PATH}; thumbnail {LEAK_NAME} unavailable"))
    assert LEAK_PATH not in message, "absolute path leaked in exception text"
    assert LEAK_NAME not in message, "biometric filename leaked in exception text"


def test_safe_tool_redacts_exceptions_at_the_central_wrapper() -> None:
    source = Path(mcp.__file__).read_text(encoding="utf-8")
    block = source[source.index("def safe_tool("):source.index("def _agent_state(")]
    assert "async def wrapper" in block
    assert "anyio.to_thread.run_sync" in block
    assert "except Exception as exc" in block
    assert "raise ValueError(_redacted_exception_message(exc)) from None" in block


def test_scan_tools_are_async_and_report_progress_from_worker_thread() -> None:
    assert inspect.iscoroutinefunction(mcp.scan_folder), "scan_folder must not block the MCP event loop"
    source = Path(mcp.__file__).read_text(encoding="utf-8")
    block = source[source.index("def _progress_reporter("):source.index("@mcp.resource")]
    assert "anyio.from_thread.run" in block
    assert "ctx.report_progress(" not in block.replace("lambda: ctx.report_progress(", "")

    events: list[tuple[float, float | None, str | None]] = []

    class FakeContext:
        async def report_progress(self, progress: float, total: float | None = None, message: str | None = None) -> None:
            events.append((progress, total, message))

    async def exercise() -> None:
        reporter = mcp._progress_reporter(FakeContext())
        await anyio.to_thread.run_sync(
            lambda: reporter(
                {
                    "total": 4,
                    "processed": 2,
                    "phase": "processing",
                    "current_path": LEAK_PATH,
                }
            )
        )

    anyio.run(exercise)
    assert events == [(2.0, 4.0, "processing: [hidden]")]
    assert LEAK_NAME not in str(events)


def test_probe_video_requires_consent_before_path_or_decoder_work() -> None:
    original_api = mcp._api
    original_assert_allowed_path = mcp._assert_allowed_path
    original_probe_video = mcp.probe_video

    class FakeApi:
        consent_on_file = False

    def fail_path_check(_path: str) -> Path:
        raise AssertionError("path was checked before consent")

    def fail_probe_video(_path: Path) -> dict:
        raise AssertionError("video decoder ran before consent")

    mcp._api = lambda: FakeApi()  # type: ignore[assignment]
    mcp._assert_allowed_path = fail_path_check  # type: ignore[assignment]
    mcp.probe_video = fail_probe_video  # type: ignore[assignment]
    try:
        async def exercise() -> None:
            await mcp.probe_video_file("/private/family-trip.mov")

        try:
            anyio.run(exercise)
            raise AssertionError("probe_video_file should require consent")
        except ValueError as exc:
            message = str(exc)
            assert "Consent is required" in message, message
            assert "path was checked" not in message, message
            assert "video decoder ran" not in message, message
    finally:
        mcp._api = original_api  # type: ignore[assignment]
        mcp._assert_allowed_path = original_assert_allowed_path  # type: ignore[assignment]
        mcp.probe_video = original_probe_video  # type: ignore[assignment]


def test_rate_limiter_token_bucket() -> None:
    # Burst of 3, refilling 1 token/sec, with a deterministic injected clock.
    limiter = mcp._RateLimiter(capacity=3, refill_per_sec=1.0)
    assert limiter.allow(100.0) is True
    assert limiter.allow(100.0) is True
    assert limiter.allow(100.0) is True
    assert limiter.allow(100.0) is False, "bucket should be empty after the burst"
    assert limiter.allow(101.0) is True, "one token should refill after 1 second"
    assert limiter.allow(101.0) is False, "only one token refilled"
    # Capacity caps accumulation: a long idle never grants more than `capacity` tokens.
    assert limiter.allow(200.0) is True
    assert limiter.allow(200.0) is True
    assert limiter.allow(200.0) is True
    assert limiter.allow(200.0) is False


def main() -> None:
    test_usc04_rejects_added_unrecorded_model()
    test_absent_manifest_is_skipped()
    test_packaged_build_requires_model_integrity_manifest()
    test_embedded_path_redacted_in_resource_freetext()
    test_embedded_path_redacted_in_audit_message()
    test_embedded_path_redacted_in_tool_output()
    test_hash_fields_redacted_in_tool_output()
    test_exception_text_redacted_before_mcp_framework_sees_it()
    test_safe_tool_redacts_exceptions_at_the_central_wrapper()
    test_scan_tools_are_async_and_report_progress_from_worker_thread()
    test_probe_video_requires_consent_before_path_or_decoder_work()
    test_rate_limiter_token_bucket()
    print("mcp redaction + model integrity ok")


if __name__ == "__main__":
    main()
