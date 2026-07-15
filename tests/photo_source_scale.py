from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import os
import tempfile
import time
import tracemalloc
import unittest
from unittest.mock import patch

from crossage_fr.photo_sources.contracts import NormalizedPhotoAsset, PhotoSourceScopes
from crossage_fr.photo_sources.osxphotos_adapter import ApplePhotosAdapter
from crossage_fr.photo_sources.portable_metadata import PortablePhotoMetadata
from crossage_fr.photo_sources.windows_folder_adapter import WindowsFolderAdapter


class SyntheticPhoto:
    __slots__ = ("uuid", "hidden")

    def __init__(self, index: int) -> None:
        self.uuid = f"SYNTHETIC-{index:08d}"
        self.hidden = False


class SyntheticPhotosDb:
    photos_version = 15
    db_version = 9_000

    def __init__(self, rows: list[SyntheticPhoto]) -> None:
        self.rows = rows
        self._tempdir = SimpleNamespace(cleanup=lambda: None)

    def photos(self, *, intrash: bool = False):
        return [] if intrash else self.rows


class PhotoSourceScaleTests(unittest.TestCase):
    def test_mocked_apple_adapter_is_linear_through_100k_assets(self) -> None:
        max_seconds = float(os.environ.get("VINTRACE_PHOTO_SOURCE_SCALE_MAX_SECONDS", "10"))
        max_peak_mb = float(os.environ.get("VINTRACE_PHOTO_SOURCE_SCALE_MAX_PEAK_MB", "192"))
        all_rows = [SyntheticPhoto(index) for index in range(100_000)]
        measurements: list[tuple[int, float, float]] = []

        with tempfile.TemporaryDirectory(prefix="vintrace-photo-source-scale-") as temp:
            library_path = Path(temp) / "Scale.photoslibrary"
            library_path.mkdir()
            database = SyntheticPhotosDb(all_rows)
            module = SimpleNamespace(
                __version__="0.76.1",
                PhotosDB=lambda dbfile: database,
            )
            adapter = ApplePhotosAdapter(
                module_loader=lambda name: module,
                platform_name="darwin",
                home=Path(temp),
            )
            adapter.normalize_asset = lambda photo, library, scopes: NormalizedPhotoAsset(  # type: ignore[method-assign]
                provider="apple_photos",
                library_id=library.library_id,
                external_id=photo.uuid,
                filename=f"{photo.uuid}.jpg",
            )

            for count in (10_000, 50_000, 100_000):
                database.rows = all_rows[:count]
                tracemalloc.start()
                started = time.perf_counter()
                with adapter.open_library(str(library_path)) as opened:
                    emitted = sum(1 for _ in opened.iter_assets(PhotoSourceScopes()))
                elapsed = time.perf_counter() - started
                peak_mb = tracemalloc.get_traced_memory()[1] / (1024 * 1024)
                tracemalloc.stop()
                self.assertEqual(emitted, count)
                self.assertLess(elapsed, max_seconds, (count, elapsed, measurements))
                self.assertLess(peak_mb, max_peak_mb, (count, peak_mb, measurements))
                measurements.append((count, elapsed, peak_mb))

        ten_k, fifty_k, hundred_k = measurements
        self.assertLess(fifty_k[1], ten_k[1] * 8 + 0.25, measurements)
        self.assertLess(hundred_k[1], fifty_k[1] * 3 + 0.25, measurements)

    def test_folder_iterator_yields_before_scanning_the_remaining_tree(self) -> None:
        with tempfile.TemporaryDirectory(prefix="vintrace-folder-stream-") as temp:
            root = Path(temp) / "Pictures"
            root.mkdir()
            adapter = WindowsFolderAdapter(platform_name="windows", home=Path(temp))
            metadata_reads = 0

            def read_metadata(path: Path) -> PortablePhotoMetadata:
                nonlocal metadata_reads
                metadata_reads += 1
                return PortablePhotoMetadata()

            adapter.normalize_asset = lambda path, portable, library, scopes, external_id="": NormalizedPhotoAsset(  # type: ignore[method-assign]
                provider="windows_folders",
                library_id=library.library_id,
                external_id=external_id,
                filename=path.name,
                original_path=str(path),
            )
            with adapter.open_library(str(root)) as opened:
                opened._paths = lambda: (root / f"photo-{index:08d}.jpg" for index in range(100_000))  # type: ignore[method-assign]
                with patch(
                    "crossage_fr.photo_sources.windows_folder_adapter.read_portable_photo_metadata",
                    side_effect=read_metadata,
                ):
                    first = next(opened.iter_assets(PhotoSourceScopes()))
            self.assertEqual(metadata_reads, 1)
            self.assertTrue(first.external_id)


if __name__ == "__main__":
    unittest.main()
