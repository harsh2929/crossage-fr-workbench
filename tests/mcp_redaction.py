"""Regression tests for MCP output redaction and model-integrity gating.

These lock in three bypasses found by adversarial verification of the Security
Phase-1/3 residual fixes (Wave 1):

- USC-04: model integrity must reject an ADDED unrecorded .onnx, not only an
  edited recorded one (the engine loads by priority filename, so an added
  higher-priority file would otherwise be loaded ahead of the genuine weights).
- MCP-04 basename leak: path redaction must mask absolute paths AND media
  filenames embedded *inside* free-text fields (error/audit messages), not only
  strings that start with a path separator.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/mcp_redaction.py
"""

from __future__ import annotations

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
    test_embedded_path_redacted_in_resource_freetext()
    test_embedded_path_redacted_in_audit_message()
    test_embedded_path_redacted_in_tool_output()
    test_rate_limiter_token_bucket()
    print("mcp redaction + model integrity ok")


if __name__ == "__main__":
    main()
