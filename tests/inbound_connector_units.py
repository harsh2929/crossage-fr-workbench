from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlparse

from PIL import Image

from crossage_fr.photo_sources.contracts import PhotoSourceScopes
from crossage_fr.photo_sources.remote_connectors import (
    DROPBOX_PROVIDER,
    GOOGLE_DRIVE_PROVIDER,
    ONEDRIVE_PROVIDER,
    SLACK_PROVIDER,
    WEBDAV_PROVIDER,
    WEB_PROVIDER,
    ConnectorNetworkError,
    HttpResponse,
    RemoteConnectorAdapter,
    connector_uri,
    validate_remote_url,
)
from crossage_fr.photo_sources.credential_vault import ConnectorCredentialVault, MemoryCredentialBackend
from crossage_fr.photo_sources.service import PhotoSourceService
from crossage_fr.store.workspace_db import WorkspaceDb


def png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (24, 18), (32, 96, 160)).save(output, format="PNG")
    return output.getvalue()


class FakeConnectorTransport:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, method, url, *, headers=None, body=None, max_bytes=0, allowed_hosts=None):
        self.calls.append({
            "method": method,
            "url": url,
            "headers": dict(headers or {}),
            "body": body,
            "maxBytes": max_bytes,
            "allowedHosts": list(allowed_hosts or []),
        })
        if "slack.com/api/files.list" in url:
            return self.json({
                "ok": True,
                "files": [{
                    "id": "F-SLACK-1",
                    "name": "launch.png",
                    "title": "Launch artwork",
                    "mimetype": "image/png",
                    "size": len(png_bytes()),
                    "timestamp": 1_720_000_000,
                    "updated": 1_720_000_100,
                    "original_w": 24,
                    "original_h": 18,
                    "channels": ["C-DESIGN"],
                    "url_private_download": "https://files.slack.com/files-pri/T/F/launch.png",
                }],
                "paging": {"page": 1, "pages": 1},
            }, url)
        if "googleapis.com/drive/v3/files?" in url:
            return self.json({"files": [{
                "id": "G-1",
                "name": "drive.png",
                "mimeType": "image/png",
                "size": str(len(png_bytes())),
                "createdTime": "2026-07-01T10:00:00Z",
                "modifiedTime": "2026-07-02T10:00:00Z",
                "parents": ["root"],
                "capabilities": {"canDownload": True},
                "imageMediaMetadata": {"width": 24, "height": 18},
            }]}, url)
        if "graph.microsoft.com" in url and "/children" in url:
            return self.json({"value": [{
                "id": "O-1",
                "name": "onedrive.png",
                "size": len(png_bytes()),
                "createdDateTime": "2026-07-01T10:00:00Z",
                "lastModifiedDateTime": "2026-07-02T10:00:00Z",
                "file": {"mimeType": "image/png", "hashes": {"sha1Hash": "abc"}},
                "photo": {"width": 24, "height": 18},
                "parentReference": {"id": "root", "driveId": "drive"},
            }]}, url)
        if url.endswith("/2/files/list_folder"):
            return self.json({"entries": [{
                ".tag": "file",
                "id": "id:D-1",
                "name": "dropbox.png",
                "path_lower": "/photos/dropbox.png",
                "path_display": "/Photos/dropbox.png",
                "size": len(png_bytes()),
                "client_modified": "2026-07-01T10:00:00Z",
                "server_modified": "2026-07-02T10:00:00Z",
                "content_hash": "hash",
                "rev": "1",
                "media_info": {"metadata": {"dimensions": {"width": 24, "height": 18}}},
            }], "has_more": False}, url)
        if method == "PROPFIND":
            return HttpResponse(207, {"content-type": "application/xml"}, b'''<?xml version="1.0"?>
              <d:multistatus xmlns:d="DAV:"><d:response><d:href>/photos/dav.png</d:href>
              <d:propstat><d:prop><d:displayname>dav.png</d:displayname><d:getcontenttype>image/png</d:getcontenttype>
              <d:getcontentlength>91</d:getcontentlength><d:getlastmodified>Wed, 01 Jul 2026 10:00:00 GMT</d:getlastmodified>
              <d:getetag>etag-1</d:getetag><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>''', url)
        if url == "https://example.test/gallery":
            return HttpResponse(200, {"content-type": "text/html"}, b'''<html><head><title>Campaign Gallery</title>
              <meta property="og:image" content="/hero.png"></head><body>
              <img src="/detail.png" alt="Detail photograph"><a href="/more">More</a></body></html>''', url)
        if url == "https://example.test/more":
            return HttpResponse(200, {"content-type": "text/html"}, b'<img src="/second.png" alt="Second">', url)
        if url == "https://example.test/robots.txt":
            return HttpResponse(200, {"content-type": "text/plain"}, b"User-agent: *\nAllow: /\n", url)
        if url.endswith((".png", "/content")) or "alt=media" in url or "files-pri" in url or "content.dropboxapi.com" in url:
            return HttpResponse(200, {"content-type": "image/png"}, png_bytes(), url)
        raise AssertionError(f"Unexpected fake connector request: {method} {url}")

    @staticmethod
    def json(payload: dict, url: str) -> HttpResponse:
        return HttpResponse(200, {"content-type": "application/json"}, json.dumps(payload).encode("utf-8"), url)


class InboundConnectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="vintrace-inbound-connectors-")
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.db = WorkspaceDb(self.workspace / "workspace.sqlite3")
        self.transport = FakeConnectorTransport()
        self.credential_backend = MemoryCredentialBackend()
        self.adapters = {
            provider: RemoteConnectorAdapter(provider, transport=self.transport, allow_private_test=True)
            for provider in (SLACK_PROVIDER, WEB_PROVIDER, GOOGLE_DRIVE_PROVIDER, ONEDRIVE_PROVIDER, DROPBOX_PROVIDER, WEBDAV_PROVIDER)
        }
        self.service = PhotoSourceService(
            self.db,
            self.workspace,
            adapters=self.adapters,
            platform_name="test",
            credential_vault=ConnectorCredentialVault(self.workspace, backend=self.credential_backend),
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def configure(self, provider: str, **params):
        return self.service.configure_connector(provider, {
            "connectionId": f"{provider}-primary",
            "displayName": f"Test {provider}",
            "accessToken": "secret-token",
            **params,
        })

    def test_url_policy_blocks_credentials_private_and_unexpected_hosts(self) -> None:
        with self.assertRaisesRegex(ConnectorNetworkError, "credentials"):
            validate_remote_url("https://user:pass@example.com/image.png", resolve_dns=False)
        with self.assertRaisesRegex(ConnectorNetworkError, "Private"):
            validate_remote_url("http://127.0.0.1/image.png", resolve_dns=False)
        with self.assertRaisesRegex(ConnectorNetworkError, "unexpected host"):
            validate_remote_url("https://example.com/image.png", allowed_hosts=["slack.com"], resolve_dns=False)
        self.assertEqual(
            validate_remote_url("https://127.0.0.1/image.png#fragment", allow_private_test=True, resolve_dns=False),
            "https://127.0.0.1/image.png",
        )

    def test_slack_preview_and_import_are_managed_stable_and_secret_free(self) -> None:
        configured = self.configure(SLACK_PROVIDER, channelIds=["C-DESIGN"])
        path = configured["library"]["path"]
        preview = self.service.preview(SLACK_PROVIDER, {"libraryPath": path})
        self.assertEqual(preview["counts"]["assets"], 1)
        self.assertEqual(preview["samples"][0]["title"], "Launch artwork")

        with self.assertRaisesRegex(ValueError, "explicitExternalDownloadConsent"):
            self.service.enqueue_job(SLACK_PROVIDER, "import", {"libraryPath": path})
        job = self.service.enqueue_job(SLACK_PROVIDER, "import", {
            "libraryPath": path,
            "storageMode": "referenced",
            "explicitExternalDownloadConsent": True,
        })
        serialized = json.dumps(job["params"], sort_keys=True)
        self.assertNotIn("secret-token", serialized)
        self.assertEqual(job["params"]["storageMode"], "managed")
        completed = self.service.run_job(job["jobId"])
        self.assertEqual(completed["status"], "completed", completed)
        self.assertEqual(completed["result"]["counts"]["imported"], 1, completed)
        self.assertEqual(completed["result"]["counts"]["exportedManaged"], 1, completed)
        with self.db.connect() as conn:
            asset = conn.execute("SELECT asset_id, source_path, source_kind FROM photo_assets LIMIT 1").fetchone()
            external = conn.execute("SELECT provider, external_id, asset_id FROM photo_asset_external_ids LIMIT 1").fetchone()
        self.assertTrue(Path(asset["source_path"]).is_file())
        self.assertEqual(asset["source_kind"], "managed")
        self.assertEqual(external["provider"], SLACK_PROVIDER)
        self.assertEqual(external["asset_id"], asset["asset_id"])

        restarted_adapters = {
            provider: RemoteConnectorAdapter(provider, transport=self.transport, allow_private_test=True)
            for provider in (SLACK_PROVIDER, WEB_PROVIDER, GOOGLE_DRIVE_PROVIDER, ONEDRIVE_PROVIDER, DROPBOX_PROVIDER, WEBDAV_PROVIDER)
        }
        restarted = PhotoSourceService(
            self.db,
            self.workspace,
            adapters=restarted_adapters,
            platform_name="test",
            credential_vault=ConnectorCredentialVault(self.workspace, backend=self.credential_backend),
        )
        restored = restarted.discover_libraries(SLACK_PROVIDER)
        self.assertEqual(restored["libraries"][0]["path"], path)
        self.assertNotIn("secret-token", json.dumps(restored, sort_keys=True))

        synced = restarted.enqueue_job(SLACK_PROVIDER, "sync", {
            "libraryPath": path,
            "explicitExternalDownloadConsent": True,
        })
        synced_result = restarted.run_job(synced["jobId"])
        self.assertEqual(synced_result["result"]["counts"]["unchanged"], 1, synced_result)

    def test_web_connector_extracts_bounded_pages_and_imports(self) -> None:
        configured = self.service.configure_connector(WEB_PROVIDER, {
            "connectionId": "web-campaign",
            "displayName": "Campaign site",
            "urls": ["https://example.test/gallery"],
            "recursive": True,
            "maxPages": 2,
            "maxItems": 3,
        })
        preview = self.service.preview(WEB_PROVIDER, {"libraryPath": configured["library"]["path"]})
        self.assertEqual(preview["counts"]["assets"], 3, preview)
        self.assertEqual({row["filename"] for row in preview["samples"]}, {"hero.png", "detail.png", "second.png"})
        job = self.service.enqueue_job(WEB_PROVIDER, "import", {
            "libraryPath": configured["library"]["path"],
            "externalIds": [preview["samples"][0]["externalId"]],
            "explicitExternalDownloadConsent": True,
        })
        completed = self.service.run_job(job["jobId"])
        self.assertEqual(completed["result"]["counts"]["imported"], 1, completed)
        self.assertEqual(completed["result"]["counts"]["seen"], 3, completed)

    def test_web_connector_respects_robots_and_finds_video_sources(self) -> None:
        class RobotsTransport(FakeConnectorTransport):
            def __call__(self, method, url, **kwargs):
                if url == "https://robots.example/robots.txt":
                    return HttpResponse(200, {"content-type": "text/plain"}, b"User-agent: *\nDisallow: /private\n", url)
                if url == "https://robots.example/gallery":
                    return HttpResponse(200, {"content-type": "text/html"}, b'<video><source src="/clip.mp4" type="video/mp4"></video><img src="/private/secret.png">', url)
                return super().__call__(method, url, **kwargs)

        adapter = RemoteConnectorAdapter(WEB_PROVIDER, transport=RobotsTransport(), allow_private_test=True)
        adapter.configure({
            "connectionId": "robots-web",
            "urls": ["https://robots.example/gallery"],
            "respectRobots": True,
        })
        records = adapter.fetch_records(connector_uri(WEB_PROVIDER, "robots-web"))
        self.assertEqual([record.filename for record in records], ["clip.mp4"])

    def test_cloud_and_webdav_providers_normalize_real_api_contracts(self) -> None:
        providers = [
            (GOOGLE_DRIVE_PROVIDER, {}),
            (ONEDRIVE_PROVIDER, {}),
            (DROPBOX_PROVIDER, {"folderPath": "/Photos"}),
            (WEBDAV_PROVIDER, {"baseUrl": "https://dav.example.test/photos/", "username": "user", "password": "password"}),
        ]
        for provider, params in providers:
            with self.subTest(provider=provider):
                configured = self.configure(provider, **params)
                self.assertEqual(configured["library"]["path"], connector_uri(provider, f"{provider}-primary"))
                preview = self.service.preview(provider, {"libraryPath": configured["library"]["path"]})
                self.assertEqual(preview["counts"]["assets"], 1, preview)
                self.assertEqual(preview["counts"]["images"], 1, preview)

    def test_slack_discovery_scales_to_ten_thousand_bounded_records(self) -> None:
        class ScaleTransport:
            def __call__(self, method, url, **_kwargs):
                del method
                query = parse_qs(urlparse(url).query)
                page = int(query.get("page", ["1"])[0])
                count = int(query.get("count", ["1000"])[0])
                start = (page - 1) * count
                files = [
                    {
                        "id": f"F-{index}",
                        "name": f"asset-{index}.png",
                        "mimetype": "image/png",
                        "size": 91,
                        "timestamp": 1_720_000_000 + index,
                        "url_private_download": f"https://files.slack.com/files-pri/T/F-{index}/asset.png",
                    }
                    for index in range(start, min(10_000, start + count))
                ]
                return HttpResponse(
                    200,
                    {"content-type": "application/json"},
                    json.dumps({"ok": True, "files": files, "paging": {"page": page, "pages": 10}}).encode(),
                    url,
                )

        adapter = RemoteConnectorAdapter(SLACK_PROVIDER, transport=ScaleTransport(), allow_private_test=True)
        library = adapter.configure({
            "connectionId": "scale-slack",
            "accessToken": "scale-token",
            "maxItems": 10_000,
            "maxPages": 10,
        })
        started = time.perf_counter()
        preview = adapter.preview(library.path, PhotoSourceScopes(), item_limit=10_000, sample_limit=40, time_budget_ms=5_000)
        elapsed_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(preview.counts["assets"], 10_000)
        self.assertEqual(len(preview.samples), 40)
        self.assertLess(elapsed_ms, 2_500, elapsed_ms)

    def test_remote_preview_reports_time_budget_truncation(self) -> None:
        class SlowTransport:
            def __call__(self, method, url, **_kwargs):
                del method
                time.sleep(0.06)
                page = int(parse_qs(urlparse(url).query).get("page", ["1"])[0])
                payload = {
                    "ok": True,
                    "files": [{
                        "id": f"slow-{page}",
                        "name": f"slow-{page}.png",
                        "mimetype": "image/png",
                        "url_private_download": f"https://files.slack.com/slow-{page}.png",
                    }],
                    "paging": {"page": page, "pages": 10},
                }
                return HttpResponse(200, {"content-type": "application/json"}, json.dumps(payload).encode(), url)

        adapter = RemoteConnectorAdapter(SLACK_PROVIDER, transport=SlowTransport(), allow_private_test=True)
        library = adapter.configure({
            "connectionId": "slow-slack",
            "accessToken": "slow-token",
            "maxItems": 10,
            "maxPages": 10,
        })
        preview = adapter.preview(library.path, PhotoSourceScopes(), item_limit=10, sample_limit=10, time_budget_ms=100)
        self.assertFalse(preview.complete)
        self.assertLess(preview.counts["assets"], 10)
        self.assertTrue(preview.warnings)


if __name__ == "__main__":
    unittest.main()
