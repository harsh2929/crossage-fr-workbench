from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from crossage_fr.api_server import DesktopApi


class PhotoSourceApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="vintrace-photo-source-api-")
        self.root = Path(self.temp.name)
        os.environ["VINTRACE_REGISTRY_HOME"] = str(self.root / "registry")
        os.environ["CROSSAGE_REGISTRY_HOME"] = str(self.root / "registry")
        os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
        self.source = self.root / "private-source" / "Trips"
        self.source.mkdir(parents=True)
        self.media = self.source / "harbor.png"
        Image.new("RGB", (32, 24), (24, 86, 142)).save(self.media)
        self.api = DesktopApi(self.root / "workspace", actor="photo-source-api-test")

    def tearDown(self) -> None:
        executor = self.api._photo_source_job_executor  # noqa: SLF001
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
        self.temp.cleanup()

    def test_folder_preview_import_jobs_retry_dismiss_and_audit_redaction(self) -> None:
        status = self.api.handle("windows_photo_source_status", {})["value"]
        self.assertTrue(status["available"])
        self.assertTrue(status["capabilities"]["incrementalSync"])

        preview = self.api.handle(
            "preview_windows_photo_folder",
            {
                "libraryPath": str(self.source.parent),
                "itemLimit": 20,
                "sampleLimit": 10,
                "timeBudgetMs": 2_000,
            },
        )["value"]
        self.assertEqual(preview["counts"]["assets"], 1)
        self.assertEqual(preview["scannedCount"], 1)
        external_id = preview["samples"][0]["externalId"]

        preview_job = self.api.handle(
            "preview_windows_photo_folder",
            {
                "libraryPath": str(self.source.parent),
                "itemLimit": 20,
                "sampleLimit": 10,
                "timeBudgetMs": 2_000,
                "runAsJob": True,
                "runInline": True,
            },
        )["value"]["job"]
        self.assertEqual(preview_job["status"], "completed", preview_job)
        self.assertEqual(preview_job["result"]["counts"]["assets"], 1)
        self.assertEqual(preview_job["progress"]["processed"], 1)
        self.assertEqual(preview_job["progress"]["total"], 1)

        progress_events: list[tuple[dict, str]] = []
        imported = self.api.handle(
            "import_windows_photo_folder",
            {
                "libraryPath": str(self.source.parent),
                "externalIds": [external_id],
                "storageMode": "referenced",
                "runInline": True,
            },
            lambda payload, phase: progress_events.append((payload, phase)),
        )["value"]
        job = imported["job"]
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["result"]["counts"]["imported"], 1)
        self.assertTrue(progress_events)
        self.assertTrue(all(phase == "photo_source" for _, phase in progress_events))

        hints = self.api.handle("list_photo_source_people_hints", {"sourceId": job["result"]["sourceId"]})["value"]
        self.assertEqual(hints["total"], 0)
        with self.assertRaisesRegex(ValueError, "Unknown photo-source people hint"):
            self.api.handle(
                "review_photo_source_people_hint",
                {"hintId": "missing", "decision": "accepted", "personName": "Ada"},
            )

        revoked = self.api.handle(
            "revoke_photo_source_consent",
            {
                "sourceId": job["result"]["sourceId"],
                "scopes": ["preciseLocation"],
                "runInline": True,
            },
        )["value"]["job"]
        self.assertEqual(revoked["status"], "completed", revoked)
        self.assertTrue(revoked["result"]["localCatalogOnly"])
        self.assertFalse(revoked["result"]["sourceLibraryOpened"])
        self.assertTrue(self.media.is_file())

        status_value = self.api.handle(
            "photo_source_job_status", {"jobId": job["jobId"]}
        )["value"]
        self.assertTrue(status_value["jobFound"])
        self.assertEqual(status_value["job"]["status"], "completed")
        jobs = self.api.handle("photo_source_jobs", {"limit": 10})["value"]
        self.assertGreaterEqual(jobs["counts"].get("completed", 0), 1)

        retried = self.api.handle(
            "retry_photo_source_job",
            {"jobId": job["jobId"], "runInline": True},
        )["value"]
        self.assertEqual(retried["job"]["status"], "completed", retried)
        self.assertNotEqual(retried["jobId"], job["jobId"])

        dismissed = self.api.handle(
            "dismiss_photo_source_job", {"jobId": job["jobId"]}
        )["value"]
        self.assertTrue(dismissed["deleted"])
        missing = self.api.handle(
            "photo_source_job_status", {"jobId": job["jobId"]}
        )["value"]
        self.assertFalse(missing["jobFound"])

        audit_rows = [
            json.loads(line)
            for line in self.api.project.audit_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        source_actions = [
            row
            for row in audit_rows
            if str(row.get("action", "")) in {"preview_photo_source", "start_photo_source_job"}
        ]
        self.assertGreaterEqual(len(source_actions), 3)
        for row in source_actions:
            serialized = json.dumps(row, sort_keys=True)
            self.assertNotIn(str(self.source.parent), serialized)
            self.assertNotIn(str(self.media), serialized)
            self.assertRegex(str(row.get("library_path_hash", "")), r"^[0-9a-f]{16}$")
            self.assertIn("dependency_version", row)
        preview_audit = next(row for row in source_actions if row["action"] == "preview_photo_source")
        self.assertEqual(preview_audit["warning_count"], 0)
        finished = [row for row in audit_rows if row.get("action") == "photo_source_job_finished"]
        self.assertGreaterEqual(len(finished), 2)
        self.assertEqual(finished[-1]["status"], "completed")
        self.assertIn("counts", finished[-1])
        self.assertIn("warning_count", finished[-1])

    def test_sensitive_and_cloud_export_scopes_require_explicit_consent(self) -> None:
        with self.assertRaisesRegex(ValueError, "sensitiveConsent"):
            self.api.handle(
                "preview_windows_photo_folder",
                {
                    "libraryPath": str(self.source.parent),
                    "scopes": {"peopleFaces": True},
                },
            )
        with self.assertRaisesRegex(ValueError, "explicitCloudDownloadConsent"):
            self.api.handle(
                "import_apple_photos_library",
                {
                    "libraryPath": str(self.source.parent),
                    "allowPhotosExport": True,
                },
            )


if __name__ == "__main__":
    unittest.main()
