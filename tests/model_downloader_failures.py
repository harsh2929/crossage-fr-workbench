from __future__ import annotations

import hashlib
import json
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from crossage_fr.model_manager import MODEL_PACKAGES, ModelPackageSpec, download_model_pack


def make_archive(root: Path, pack: str, detector: bytes = b"detector", recognizer: bytes = b"recognizer") -> Path:
    archive = root / f"{pack}.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr(f"{pack}/det_10g.onnx", detector)
        handle.writestr(f"{pack}/w600k_r50.onnx", recognizer)
    return archive


def spec_for(pack: str, archive: Path, url: str | None = None, sha256: str | None = None) -> ModelPackageSpec:
    return ModelPackageSpec(
        pack=pack,
        label=f"{pack} fixture",
        detail="Downloader failure-mode fixture.",
        filename=archive.name,
        url=url or archive.resolve().as_uri(),
        sha256=sha256 or hashlib.sha256(archive.read_bytes()).hexdigest(),
        size_bytes=archive.stat().st_size,
        license="test",
        source="local fixture",
        required_any=(("det_10g.onnx",), ("w600k_r50.onnx",)),
    )


class RangeArchiveHandler(BaseHTTPRequestHandler):
    payload = b""
    filename = "model.zip"
    requests: list[str] = []

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib API
        type(self).requests.append(self.headers.get("Range", ""))
        data = type(self).payload
        if self.path.strip("/") != type(self).filename:
            self.send_error(404)
            return
        range_header = self.headers.get("Range", "")
        start = 0
        if range_header.startswith("bytes="):
            start_text = range_header.split("=", 1)[1].split("-", 1)[0]
            start = int(start_text or "0")
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        else:
            self.send_response(200)
        body = data[start:]
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve_archive(archive: Path) -> tuple[ThreadingHTTPServer, str]:
    RangeArchiveHandler.payload = archive.read_bytes()
    RangeArchiveHandler.filename = archive.name
    RangeArchiveHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), RangeArchiveHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}/{archive.name}"


def expect_raises(expected: type[BaseException], fn: Any, contains: str) -> BaseException:
    try:
        fn()
    except expected as exc:
        assert contains in str(exc), str(exc)
        return exc
    raise AssertionError(f"Expected {expected.__name__}: {contains}")


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="vintrace-model-downloader-failures-"))
    archive = make_archive(root, "qa_pack")
    specs_to_remove: set[str] = set()

    try:
        offline = spec_for("offline_pack", archive, url="http://127.0.0.1:9/offline.zip")
        MODEL_PACKAGES[offline.pack] = offline
        specs_to_remove.add(offline.pack)
        offline_events: list[dict[str, Any]] = []
        expect_raises(ConnectionError, lambda: download_model_pack(offline.pack, root / "offline-root", on_progress=offline_events.append), "Retry can resume")
        assert offline_events[0]["phase"] == "starting"
        assert any("Retrying" in event.get("message", "") for event in offline_events), offline_events
        assert not (root / "offline-root" / "models" / ".offline_pack.installing").exists()

        bad_archive = make_archive(root, "bad_checksum_pack")
        bad = spec_for("bad_checksum_pack", bad_archive, sha256="0" * 64)
        MODEL_PACKAGES[bad.pack] = bad
        specs_to_remove.add(bad.pack)
        expect_raises(ValueError, lambda: download_model_pack(bad.pack, root / "bad-root"), "Checksum mismatch")
        MODEL_PACKAGES[bad.pack] = spec_for("bad_checksum_pack", bad_archive)
        recovered = download_model_pack(bad.pack, root / "bad-root", force=True)
        assert recovered["verified"] is True

        resume_archive = make_archive(root, "resume_pack")
        server, url = serve_archive(resume_archive)
        try:
            resume = spec_for("resume_pack", resume_archive, url=url)
            MODEL_PACKAGES[resume.pack] = resume
            specs_to_remove.add(resume.pack)
            resume_root = root / "resume-root"
            downloads = resume_root / "downloads"
            downloads.mkdir(parents=True)
            payload = resume_archive.read_bytes()
            (downloads / f"{resume.filename}.part").write_bytes(payload[: len(payload) // 2])
            resume_events: list[dict[str, Any]] = []
            resumed = download_model_pack(resume.pack, resume_root, on_progress=resume_events.append)
            assert resumed["verified"] is True
            assert (downloads / resume.filename).exists()
            assert not (downloads / f"{resume.filename}.part").exists()
            assert any(request.startswith("bytes=") for request in RangeArchiveHandler.requests), RangeArchiveHandler.requests
            assert any("Resuming" in event.get("message", "") for event in resume_events), resume_events
        finally:
            server.shutdown()

        changed = spec_for("changed_destination_pack", make_archive(root, "changed_destination_pack"))
        MODEL_PACKAGES[changed.pack] = changed
        specs_to_remove.add(changed.pack)
        first = download_model_pack(changed.pack, root / "first-model-root")
        second = download_model_pack(changed.pack, root / "second-model-root")
        assert first["root"] != second["root"]
        assert Path(first["path"]).exists()
        assert Path(second["path"]).exists()
        assert Path(second["archivePath"]).parent.resolve() == (root / "second-model-root" / "downloads").resolve()

        print(json.dumps({
            "ok": True,
            "offlineProgressEvents": len(offline_events),
            "resumeRequests": RangeArchiveHandler.requests,
            "changedDestinationRoots": [first["root"], second["root"]],
        }, indent=2))
    finally:
        for pack in specs_to_remove:
            MODEL_PACKAGES.pop(pack, None)


if __name__ == "__main__":
    main()
