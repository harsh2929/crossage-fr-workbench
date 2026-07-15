from __future__ import annotations

from contextlib import AbstractContextManager
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from PIL import Image

from crossage_fr.photo_sources.contracts import (
    NormalizedAlbum,
    NormalizedFace,
    NormalizedPerson,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourceScopes,
)
from crossage_fr.photo_sources.service import PhotoSourceService
from crossage_fr.photo_sources.osxphotos_adapter import APPLE_PHOTOS_PROVIDER
from crossage_fr.photo_sources.windows_folder_adapter import WINDOWS_FOLDERS_PROVIDER
from crossage_fr.store.workspace_db import WorkspaceDb


class FakeOpenedSource(AbstractContextManager["FakeOpenedSource"]):
    def __init__(self, adapter: "MutableFakeAdapter"):
        self.adapter = adapter
        self.library = adapter.library

    def __exit__(self, exc_type, exc, traceback):
        return None

    def iter_assets(self, scopes: PhotoSourceScopes):
        for source_asset in self.adapter.assets:
            if source_asset.hidden and not scopes.hidden:
                continue
            if source_asset.deleted and not scopes.deleted:
                continue
            asset = deepcopy(source_asset)
            if not scopes.people_faces:
                asset.people = []
                asset.faces = []
            if not scopes.precise_location:
                asset.location = {}
            if not scopes.keywords:
                asset.keywords = []
            if not scopes.labels_ocr:
                asset.labels = []
                asset.ocr_blocks = []
            if not scopes.albums_folders:
                asset.albums = []
            if not scopes.shared:
                asset.shared = False
            if not scopes.comments_likes:
                asset.comments = []
                asset.likes = []
            if not scopes.favorites:
                asset.favorite = False
            yield asset

    def export_asset(self, external_id: str, destination: str, **options):
        return self.adapter.export_asset(external_id, destination, **options)


class MutableFakeAdapter:
    def __init__(
        self,
        root: Path,
        assets: list[NormalizedPhotoAsset],
        *,
        provider: str = WINDOWS_FOLDERS_PROVIDER,
        export_enabled: bool = False,
    ):
        self.library = PhotoSourceLibrary(
            provider=provider,
            library_id="LIBRARY-1",
            path=str(root),
            name="Pictures",
        )
        self.assets = assets
        self.export_enabled = export_enabled
        self.export_calls: list[dict[str, object]] = []
        self.open_calls: list[str] = []

    def status(self):
        return {
            "provider": self.library.provider,
            "supported": True,
            "available": True,
            "capabilities": {
                "preview": True,
                "referencedImport": True,
                "managedImport": True,
                "incrementalSync": True,
                "readOnly": True,
            },
            "error": "",
        }

    def discover_libraries(self):
        return [self.library]

    def open_library(self, root_path: str):
        if str(Path(root_path).resolve()) != str(Path(self.library.path).resolve()):
            raise ValueError("wrong fake library")
        self.open_calls.append(root_path)
        return FakeOpenedSource(self)

    def export_asset(self, external_id: str, destination: str, **options):
        if not self.export_enabled:
            raise RuntimeError("fake source export is disabled")
        self.export_calls.append({"externalId": external_id, "destination": destination, **options})
        target = Path(destination) / f"{external_id}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (20, 16), (45, 85, 125)).save(target)
        return [str(target)]


class PhotoSourceServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.media = self.source / "harbor.png"
        Image.new("RGB", (32, 24), (30, 90, 140)).save(self.media)
        self.asset = NormalizedPhotoAsset(
            provider=WINDOWS_FOLDERS_PROVIDER,
            library_id="LIBRARY-1",
            external_id="ASSET-1",
            filename=self.media.name,
            original_filename=self.media.name,
            original_path=str(self.media),
            media_kind="image",
            mime_type="image/png",
            width=32,
            height=24,
            capture_date="2024-01-02T03:04:05+00:00",
            modified_date="2024-01-02T03:04:05+00:00",
            title="Harbor",
            caption="Coastal trip",
            favorite=True,
            keywords=["Trip", "Harbor"],
            labels=["boat"],
            ocr_blocks=[{"id": "OCR-1", "text": "Pier 39", "confidence": 0.98}],
            albums=[NormalizedAlbum(
                album_id="ALBUM-1",
                name="Coast",
                folder_path=[{"id": "FOLDER-1", "name": "Trips"}],
            )],
            people=[NormalizedPerson(person_id="PERSON-1", name="Ada", display_name="Ada Lovelace")],
            faces=[NormalizedFace(
                face_id="FACE-1",
                person_id="PERSON-1",
                person_name="Ada",
                region={"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.4},
                quality=0.9,
            )],
            location={"latitude": 37.7, "longitude": -122.4, "place": {"city": "San Francisco"}},
        )
        self.adapter = MutableFakeAdapter(self.source, [self.asset])
        self.db = WorkspaceDb(self.root / "workspace.sqlite3")
        self.service = PhotoSourceService(
            self.db,
            self.root,
            adapters={WINDOWS_FOLDERS_PROVIDER: self.adapter},
            platform_name="windows",
        )

    def tearDown(self):
        self.temp.cleanup()

    def enqueue_and_run(self, kind: str, **params):
        job = self.service.enqueue_job(
            WINDOWS_FOLDERS_PROVIDER,
            kind,
            {"libraryPath": str(self.source), **params},
        )
        return self.service.run_job(job["jobId"])

    def scalar(self, query: str, args=()):
        with self.db.connect() as conn:
            row = conn.execute(query, args).fetchone()
            return row[0] if row is not None else None

    def test_import_and_incremental_sync_preserve_user_edits_and_sensitive_hints(self):
        completed = self.enqueue_and_run("import", storageMode="referenced")
        self.assertEqual(completed["status"], "completed", completed)
        self.assertEqual(completed["result"]["counts"]["imported"], 1, completed)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_assets"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_external_ids WHERE state = 'active'"), 1)
        self.assertEqual(self.scalar("SELECT title FROM photo_asset_metadata"), "Harbor")
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_keywords"), 2)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_object_tags WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_ocr_blocks WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_external_people_hints"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_locations"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_album_items"), 1)

        with self.db.connect() as conn:
            asset_id = str(conn.execute("SELECT asset_id FROM photo_assets").fetchone()[0])
            conn.execute("UPDATE photo_asset_metadata SET title = 'Manual title' WHERE asset_id = ?", (asset_id,))
        renamed = self.source / "renamed.png"
        self.media.rename(renamed)
        self.asset.original_path = str(renamed)
        self.asset.filename = renamed.name
        self.asset.original_filename = renamed.name
        self.asset.modified_date = "2024-02-03T04:05:06+00:00"
        self.asset.title = "Provider title"
        self.asset.keywords = ["Trip", "Ocean"]
        self.asset.labels = ["water"]
        self.asset.albums = [NormalizedAlbum(album_id="ALBUM-2", name="Favorites")]

        synced = self.enqueue_and_run(
            "sync",
            storageMode="referenced",
            scopes={"peopleFaces": True, "preciseLocation": True},
            sensitiveConsent=True,
        )
        self.assertEqual(synced["status"], "completed", synced)
        self.assertEqual(synced["result"]["counts"]["updated"], 1, synced)
        self.assertEqual(self.scalar("SELECT asset_id FROM photo_assets"), asset_id)
        self.assertEqual(self.scalar("SELECT source_path FROM photo_assets"), str(renamed.resolve()))
        self.assertEqual(self.scalar("SELECT title FROM photo_asset_metadata"), "Manual title")
        keyword_names = set()
        with self.db.connect() as conn:
            keyword_names = {
                str(row[0])
                for row in conn.execute(
                    """
                    SELECT k.name FROM photo_asset_keywords ak
                    JOIN photo_keywords k ON k.keyword_id = ak.keyword_id
                    """
                ).fetchall()
            }
        self.assertEqual(keyword_names, {"Trip", "Ocean"})
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_album_items"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_external_people_hints WHERE status = 'pending'"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_people WHERE status = 'pending' AND source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_people WHERE status = 'accepted'"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_locations WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 1)

        pending = self.service.list_people_hints({"status": "pending"})
        self.assertEqual(pending["total"], 1)
        reviewed = self.service.review_people_hint({
            "hintId": pending["hints"][0]["hintId"],
            "decision": "accepted",
            "personName": "Ada Lovelace",
        })
        self.assertEqual(reviewed["status"], "accepted")
        self.assertEqual(reviewed["personName"], "Ada Lovelace")

        self.asset.faces[0].person_name = "Ada Lovelace"
        self.asset.modified_date = "2024-02-04T05:06:07+00:00"
        reviewed_sync = self.enqueue_and_run(
            "sync",
            storageMode="referenced",
            scopes={"peopleFaces": True, "preciseLocation": True},
            sensitiveConsent=True,
        )
        self.assertEqual(reviewed_sync["status"], "completed", reviewed_sync)
        self.assertEqual(self.scalar("SELECT status FROM photo_external_people_hints"), "accepted")
        self.assertEqual(self.scalar("SELECT status FROM photo_asset_people WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), "accepted")

        self.asset.modified_date = "2024-03-04T05:06:07+00:00"
        no_sensitive = self.enqueue_and_run("sync", storageMode="referenced")
        self.assertEqual(no_sensitive["status"], "completed", no_sensitive)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_external_people_hints"), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_locations"), 1)

        self.adapter.assets = []
        removed = self.enqueue_and_run("sync", storageMode="referenced", removedPolicy="keep")
        self.assertEqual(removed["status"], "completed", removed)
        self.assertEqual(removed["result"]["counts"]["removed"], 1)
        self.assertEqual(self.scalar("SELECT state FROM photo_asset_external_ids"), "removed")
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_assets"), 1)

    def test_managed_import_and_cancel_before_start(self):
        completed = self.enqueue_and_run("import", storageMode="managed", managedRoot=str(self.root / "managed"))
        self.assertEqual(completed["status"], "completed", completed)
        managed_path = Path(str(self.scalar("SELECT source_path FROM photo_assets")))
        self.assertTrue(managed_path.is_file())
        self.assertNotEqual(managed_path, self.media)
        self.assertEqual(self.scalar("SELECT source_kind FROM photo_assets"), "managed")

        queued = self.service.enqueue_job(
            WINDOWS_FOLDERS_PROVIDER,
            "sync",
            {"libraryPath": str(self.source)},
        )
        cancelled = self.service.catalog.request_cancel(queued["jobId"])
        self.assertEqual(cancelled["status"], "cancelled")
        rerun = self.service.run_job(queued["jobId"])
        self.assertEqual(rerun["status"], "cancelled")

    def test_removed_policy_trash_only_marks_local_catalog(self):
        completed = self.enqueue_and_run("import", storageMode="referenced")
        self.assertEqual(completed["status"], "completed", completed)
        source_bytes = self.media.read_bytes()
        self.adapter.assets = []

        synced = self.enqueue_and_run("sync", storageMode="referenced", removedPolicy="trash")

        self.assertEqual(synced["status"], "completed", synced)
        self.assertEqual(synced["result"]["counts"]["removed"], 1)
        self.assertEqual(synced["result"]["counts"]["trashed"], 1)
        self.assertEqual(self.scalar("SELECT state FROM photo_asset_external_ids"), "removed")
        self.assertTrue(bool(self.scalar("SELECT deleted_at FROM photo_asset_metadata")))
        self.assertTrue(self.media.is_file())
        self.assertEqual(self.media.read_bytes(), source_bytes)

    def test_interrupted_job_and_import_session_are_recovered(self):
        queued = self.service.enqueue_job(
            WINDOWS_FOLDERS_PROVIDER,
            "import",
            {"libraryPath": str(self.source)},
        )
        import_id = "source_import_interrupted"
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO photo_import_sessions(
                    import_id, source_kind, storage_mode, source_label, root_path,
                    status, started_at, completed_at, updated_at,
                    imported_count, failed_count, metadata_json
                ) VALUES(?, 'folder', 'referenced', 'Pictures', ?, 'running',
                    '2026-07-10T00:00:00Z', NULL, '2026-07-10T00:00:00Z', 0, 0, '{}')
                """,
                (import_id, str(self.source)),
            )
        self.service.catalog.update_job(
            queued["jobId"],
            status="running",
            started=True,
            progress={"phase": "importing", "processed": 10, "importId": import_id},
        )

        recovered = self.service.catalog.recover_interrupted_jobs()
        recovered_job = next(job for job in recovered if job["jobId"] == queued["jobId"])
        self.assertEqual(recovered_job["status"], "queued")
        self.assertIn("application restart", recovered_job["error"])
        self.assertEqual(recovered_job["startedAt"], "")
        with self.db.connect() as conn:
            session = conn.execute(
                "SELECT status, metadata_json FROM photo_import_sessions WHERE import_id = ?",
                (import_id,),
            ).fetchone()
        self.assertEqual(session["status"], "interrupted")
        metadata = json.loads(str(session["metadata_json"] or "{}"))
        self.assertEqual(metadata["interruptedJobId"], queued["jobId"])
        self.assertIn("interruptedAt", metadata)

    def test_cloud_only_asset_requires_explicit_export_and_becomes_managed(self):
        cloud_asset = NormalizedPhotoAsset(
            provider=APPLE_PHOTOS_PROVIDER,
            library_id="LIBRARY-1",
            external_id="APPLE-CLOUD-1",
            filename="cloud.jpg",
            original_filename="cloud.jpg",
            media_kind="image",
            mime_type="image/jpeg",
            missing=True,
            cloud_asset=True,
        )
        adapter = MutableFakeAdapter(
            self.source,
            [cloud_asset],
            provider=APPLE_PHOTOS_PROVIDER,
            export_enabled=True,
        )
        service = PhotoSourceService(
            self.db,
            self.root,
            adapters={APPLE_PHOTOS_PROVIDER: adapter},
            platform_name="darwin",
        )

        no_export = service.enqueue_job(
            APPLE_PHOTOS_PROVIDER,
            "import",
            {"libraryPath": str(self.source), "storageMode": "referenced"},
        )
        failed = service.run_job(no_export["jobId"])
        self.assertEqual(failed["status"], "completed", failed)
        self.assertEqual(failed["result"]["counts"]["failed"], 1)
        self.assertEqual(failed["result"]["failureCount"], 1)
        self.assertEqual(failed["result"]["failures"][0]["externalId"], "APPLE-CLOUD-1")
        self.assertEqual(failed["result"]["failures"][0]["filename"], "cloud.jpg")
        self.assertIn("Original is not stored locally", failed["result"]["failures"][0]["reason"])
        self.assertEqual(adapter.export_calls, [])

        with self.assertRaisesRegex(ValueError, "explicitCloudDownloadConsent"):
            service.enqueue_job(
                APPLE_PHOTOS_PROVIDER,
                "import",
                {
                    "libraryPath": str(self.source),
                    "allowPhotosExport": True,
                },
            )

        exported = service.enqueue_job(
            APPLE_PHOTOS_PROVIDER,
            "import",
            {
                "libraryPath": str(self.source),
                "storageMode": "referenced",
                "allowPhotosExport": True,
                "explicitCloudDownloadConsent": True,
            },
        )
        completed = service.run_job(exported["jobId"])
        self.assertEqual(completed["status"], "completed", completed)
        self.assertEqual(completed["result"]["counts"]["imported"], 1)
        self.assertEqual(completed["result"]["counts"]["exportedManaged"], 1)
        self.assertEqual(completed["result"]["warnings"][0]["code"], "cloud-assets-exported-managed")
        self.assertTrue(adapter.export_calls[0]["allow_photos_export"])
        managed_path = Path(str(self.scalar("SELECT source_path FROM photo_assets")))
        self.assertTrue(managed_path.is_file())
        self.assertEqual(self.scalar("SELECT source_kind FROM photo_assets"), "managed")

    def test_sensitive_consent_revocation_removes_only_local_imported_metadata(self):
        self.asset.hidden = True
        self.asset.deleted = True
        self.asset.deleted_at = "2024-04-05T06:07:08+00:00"
        self.asset.shared = True
        self.asset.comments = [{"author": "Private Person", "text": "Private comment"}]
        self.asset.likes = [{"author": "Private Person"}]
        source_bytes = self.media.read_bytes()
        imported = self.enqueue_and_run(
            "import",
            storageMode="referenced",
            scopes={
                "peopleFaces": True,
                "preciseLocation": True,
                "hidden": True,
                "deleted": True,
                "shared": True,
                "commentsLikes": True,
            },
            sensitiveConsent=True,
        )
        self.assertEqual(imported["status"], "completed", imported)
        source_id = imported["result"]["sourceId"]
        open_count = len(self.adapter.open_calls)

        job = self.service.enqueue_job(
            WINDOWS_FOLDERS_PROVIDER,
            "revoke_consent",
            {
                "sourceId": source_id,
                "scopes": [
                    "peopleFaces",
                    "preciseLocation",
                    "hidden",
                    "deleted",
                    "shared",
                    "commentsLikes",
                ],
            },
        )
        revoked = self.service.run_job(job["jobId"])

        self.assertEqual(revoked["status"], "completed", revoked)
        self.assertTrue(revoked["result"]["localCatalogOnly"])
        self.assertFalse(revoked["result"]["sourceLibraryOpened"])
        self.assertEqual(len(self.adapter.open_calls), open_count)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_external_people_hints"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_people WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM photo_asset_locations WHERE source = ?", (WINDOWS_FOLDERS_PROVIDER,)), 0)
        self.assertEqual(self.scalar("SELECT hidden FROM photo_asset_metadata"), 0)
        self.assertIsNone(self.scalar("SELECT deleted_at FROM photo_asset_metadata"))
        with self.db.connect() as conn:
            metadata = json.loads(str(conn.execute("SELECT metadata_json FROM photo_assets").fetchone()[0]))
            consent = json.loads(str(conn.execute(
                "SELECT consent_json FROM photo_external_sources WHERE source_id = ?",
                (source_id,),
            ).fetchone()[0]))
        serialized = json.dumps(metadata, sort_keys=True)
        for sensitive in ("Private Person", "Private comment", "San Francisco", "37.7", "Ada"):
            self.assertNotIn(sensitive, serialized)
        self.assertEqual(consent["sensitiveScopes"], [])
        self.assertTrue(all(not consent["selectedScopes"][scope] for scope in consent["revocationHistory"][-1]["scopes"]))
        self.assertTrue(self.media.is_file())
        self.assertEqual(self.media.read_bytes(), source_bytes)


if __name__ == "__main__":
    unittest.main()
