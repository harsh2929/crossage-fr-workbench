"""The preview API must return the resolution it advertises.

`AgentImageService` advertises `maxPreviewDimension = 2048` (published in the capabilities
report and the OpenAPI schema). But `preview()` opened the 768px cached preview and called
`PIL.thumbnail()`, which never upscales — so a request for 2048 silently returned 768. Even the
default of 1536 returned 768. The mobile viewer cannot zoom on a lie.

The fix: `preview()` generates its base image at the requested edge (bounded by the source's own
resolution — you cannot invent pixels), instead of always downscaling the 768px thumbnail.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/preview_dimension_honesty_units.py
"""

from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.agent_images import AgentImageService
from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _service(root: Path, source_size: tuple[int, int]) -> tuple[AgentImageService, str]:
    api = DesktopApi(root / "ws", actor="mcp")
    api.project.consent = {"active": True}
    api.project.config.safe_mode = False
    photo = root / "big.jpg"
    # A detailed image so the JPEG is not trivially tiny at high resolution.
    img = Image.new("RGB", source_size)
    px = img.load()
    for y in range(source_size[1]):
        for x in range(0, source_size[0], 7):
            px[x, y] = ((x * 3) % 256, (y * 5) % 256, (x + y) % 256)
    img.save(photo, quality=92)
    with api.project.db.connect() as conn:
        asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(photo),
            content_hash="hash-big",
            file_signature=path_signature(photo),
        )
        conn.commit()
    service = AgentImageService(
        api,
        workspace=root,
        require_consent=lambda: None,
        validate_path=lambda path: path,
    )
    return service, asset_id


def _preview_edge(service: AgentImageService, asset_id: str, *, dim: int) -> int:
    result = service.preview(asset_id=asset_id, max_dimension=dim, max_bytes=8 * 1024 * 1024)
    # Cross-check the reported dimensions against the actual decoded bytes.
    raw = result["data"]
    with Image.open(io.BytesIO(raw)) as decoded:
        decoded_edge = max(decoded.size)
    reported_edge = max(int(result["width"]), int(result["height"]))
    assert decoded_edge == reported_edge, f"reported {reported_edge} != decoded {decoded_edge}"
    return decoded_edge


def main() -> None:
    # A large 12MP-class original: a 2048 request must return ~2048, not 768.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        service, asset_id = _service(root, (4000, 3000))

        edge_2048 = _preview_edge(service, asset_id, dim=2048)
        check(f"2048 request returns >768 (got {edge_2048})", edge_2048 > 768)
        check(f"2048 request returns close to 2048 (got {edge_2048})", edge_2048 >= 1800)

        edge_1536 = _preview_edge(service, asset_id, dim=1536)
        check(f"default-ish 1536 request returns >768 (got {edge_1536})", edge_1536 > 768)

        # The small/fast path must be unaffected.
        edge_512 = _preview_edge(service, asset_id, dim=512)
        check(f"512 request stays <=512 (got {edge_512})", edge_512 <= 512)

    # Honesty in the other direction: a small original must NOT be upscaled.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        service, asset_id = _service(root, (400, 300))
        edge = _preview_edge(service, asset_id, dim=2048)
        check(f"small original is not upscaled (got {edge}, source edge 400)", edge <= 400)

    print("\nAll preview-dimension honesty checks passed.")


if __name__ == "__main__":
    main()
