from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import socket
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from crossage_fr.photo_sources.contracts import PhotoSourceScopes
from crossage_fr.photo_sources.osxphotos_adapter import ApplePhotosAdapter
from crossage_fr.photo_sources.portable_metadata import read_portable_photo_metadata
from crossage_fr.photo_sources.windows_folder_adapter import WindowsFolderAdapter


class FakeFace:
    def __init__(self, photo: object, person: object):
        self.uuid = "FACE-1"
        self.name = "Ada"
        self.person_info = person
        self.mpri_reg_rect = SimpleNamespace(_asdict=lambda: {"x": 0.3, "y": 0.3, "h": 0.4, "w": 0.4})
        self.mwg_rs_area = SimpleNamespace(_asdict=lambda: {"x": 0.5, "y": 0.5, "h": 0.4, "w": 0.4})
        self.quality = 0.91
        self.roll = 0.1
        self.pitch = 0.2
        self.yaw = 0.3
        self.manual = True
        self.source_width = 1200
        self.source_height = 800
        self.center_x = 0.5
        self.center_y = 0.5
        self.size = 0.4
        self.has_smile = True
        self.face_type = 1
        self.age_type = 2
        self.gender_type = 0
        self.glasses_type = 0
        self.hair_color_type = 1
        self._photo = photo

    def face_rect(self):
        return [(360, 160), (840, 640)]


class FakePhoto:
    def __init__(self, root: Path, *, hidden: bool = False, deleted: bool = False):
        original = root / ("hidden.jpg" if hidden else "IMG_0001.jpg")
        edited = root / ("hidden-edited.jpg" if hidden else "IMG_0001-edited.jpg")
        live = root / ("hidden.mov" if hidden else "IMG_0001.mov")
        raw = root / ("hidden.dng" if hidden else "IMG_0001.dng")
        for path in (original, edited, live, raw):
            path.write_bytes(b"fixture")
        self.uuid = "APPLE-HIDDEN" if hidden else "APPLE-1"
        self.filename = original.name
        self.original_filename = "Original.jpg"
        self.path = str(original)
        self.path_edited = str(edited)
        self.path_raw = str(raw)
        self.path_live_photo = str(live)
        self.path_edited_live_photo = str(live)
        self.ismovie = False
        self.isphoto = True
        self.live_photo = True
        self.israw = False
        self.has_raw = True
        self.raw_original = False
        self.width = 1200
        self.height = 800
        self.date = datetime(2024, 1, 2, 3, 4, tzinfo=timezone.utc)
        self.date_original = self.date
        self.date_modified = self.date
        self.date_added = self.date
        self.tzname = "UTC"
        self.tzoffset = 0
        self.title = "Harbor"
        self.description = "At the harbor"
        self.favorite = True
        self.hidden = hidden
        self.intrash = deleted
        self.date_trashed = self.date if deleted else None
        self.shared = True
        self.ismissing = False
        self.iscloudasset = True
        self.hasadjustments = True
        self.latitude = 37.7
        self.longitude = -122.4
        self.place = {"city": "San Francisco", "country": "United States"}
        self.keywords = ["Harbor", "Trip"]
        self.labels_normalized = ["water", "boat"]
        self.comments = [{"text": "Lovely"}]
        self.likes = [{"name": "Grace"}]
        self.exif_info = {
            "camera": "Example Camera",
            "GPSLatitude": 37.7,
            "GPSLongitude": -122.4,
        }
        self.search_info_normalized = {"labels": ["boat"]}
        self.imported_by = ("Camera", "com.apple.camera")
        self.import_info = {"uuid": "IMPORT-1"}
        self.moment_info = {"uuid": "MOMENT-1", "place": {"city": "San Francisco"}}
        self.fingerprint = "fingerprint"
        self.uti = "public.jpeg"
        self.uti_original = "public.jpeg"
        self.uti_edited = "public.jpeg"
        self.uti_raw = "com.adobe.raw-image"
        self.orientation = 1
        self.original_width = 1200
        self.original_height = 800
        self.original_orientation = 1
        self.original_filesize = 7
        self.ai_caption = "A boat at a harbor"
        self.media_analysis = {"subject": "boat"}
        self.owner = "Owner"
        self.share_participants = ["Grace Hopper"]
        self.live_photo = True
        self.burst = False
        self.burst_selected = False
        self.burst_key = False
        self.hdr = True
        self.portrait = False
        self.panorama = False
        self.selfie = False
        self.screenshot = False
        self.screen_recording = False
        self.slow_mo = False
        self.time_lapse = False
        self.spatial = 0
        self.external_edit = False
        self.isreference = False
        self.shared_library = True
        self.shared_moment = False
        self.syndicated = False
        self.saved_to_library = True
        folder = SimpleNamespace(uuid="FOLDER-1", title="Trips")
        album = SimpleNamespace(
            uuid="ALBUM-1",
            title="Coast",
            folder_list=[folder],
            folder_names=["Trips"],
            shared=False,
            owner=None,
            creation_date=self.date,
            start_date=self.date,
            end_date=self.date,
            sort_order="manual",
        )
        person = SimpleNamespace(
            uuid="PERSON-1",
            name="Ada",
            display_name="Ada Lovelace",
            keyphoto=self,
            facecount=1,
            favorite=True,
            feature_less=False,
            keyface="FACE-1",
            sort_order=0,
        )
        self.album_info = [album]
        self.person_info = [person]
        self.face_info = [FakeFace(self, person)]
        self.export_calls: list[dict[str, object]] = []

    def detected_text(self):
        return [("Pier 39", 0.98)]

    def export(self, destination: str, **kwargs: object):
        self.export_calls.append(kwargs)
        target = Path(destination) / self.original_filename
        target.write_bytes(b"exported")
        return [str(target)]


class FakePhotosDb:
    def __init__(self, *, dbfile: str, photos: list[FakePhoto]):
        self.library_path = dbfile
        self.photos_version = 10
        self.db_version = 7000
        self._photos = photos
        self._tempdir = SimpleNamespace(cleanup=lambda: None)

    def photos(self, *, intrash: bool = False):
        return [photo for photo in self._photos if bool(photo.intrash) is bool(intrash)]

    def get_photo(self, uuid: str):
        return next((photo for photo in self._photos if photo.uuid == uuid), None)


class PhotoSourceAdapterTests(unittest.TestCase):
    def test_apple_adapter_reads_from_temporary_database_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "Photos Library.photoslibrary"
            database_root = root / "database"
            analysis_root = root / "private/com.apple.mediaanalysisd/MediaAnalysis"
            database_root.mkdir(parents=True)
            analysis_root.mkdir(parents=True)
            (database_root / "Photos.sqlite").write_bytes(b"catalog")
            (database_root / "Photos.sqlite-wal").write_bytes(b"catalog-wal")
            (analysis_root / "mediaanalysis.db").write_bytes(b"analysis")
            calls: list[dict[str, str]] = []

            class SnapshotDb:
                photos_version = 15
                db_version = 7000
                _tempdir = SimpleNamespace(cleanup=lambda: None)

                def __init__(self, **kwargs):
                    calls.append({key: str(value) for key, value in kwargs.items()})

            module = SimpleNamespace(__version__="0.76.1", PhotosDB=SnapshotDb)
            adapter = ApplePhotosAdapter(
                module_loader=lambda name: module,
                platform_name="darwin",
                home=Path(temp),
                snapshot_databases=True,
            )

            with adapter.open_library(str(root)):
                snapshot_root = Path(calls[0]["dbfile"])
                self.assertNotEqual(snapshot_root, root)
                self.assertEqual(calls[0]["library_path"], str(root))
                self.assertEqual((snapshot_root / "database/Photos.sqlite").read_bytes(), b"catalog")
                self.assertEqual(
                    (snapshot_root / "private/com.apple.mediaanalysisd/MediaAnalysis/mediaanalysis.db").read_bytes(),
                    b"analysis",
                )

            self.assertFalse(snapshot_root.exists())
            self.assertEqual((database_root / "Photos.sqlite-wal").read_bytes(), b"catalog-wal")

    def test_default_apple_status_defers_osxphotos_import(self):
        adapter = ApplePhotosAdapter(platform_name="darwin")
        with patch.object(adapter, "_module", side_effect=AssertionError("status imported osxphotos")):
            status = adapter.status()
        self.assertTrue(status["supported"])
        self.assertEqual(status["available"], not bool(status["error"]))
        self.assertEqual(status["dependencyLoadState"], "deferred")

    def test_apple_discovery_hides_incidental_temp_and_simulator_libraries(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            pictures = home / "Pictures"
            pictures.mkdir()
            primary = pictures / "Photos Library.photoslibrary"
            primary.mkdir()
            incidental = [
                "/private/tmp/vintrace-osxphotos-audit/tests/Test.photoslibrary",
                str(home / "Library/Developer/CoreSimulator/Devices/demo/Photos.photoslibrary"),
            ]
            module = SimpleNamespace(__version__="0.76.1")
            utils = SimpleNamespace(
                get_system_library_path=lambda: str(primary),
                get_last_library_path=lambda: "Photos Library.photoslibrary",
                list_photo_libraries=lambda: [str(primary), *incidental],
            )
            adapter = ApplePhotosAdapter(
                module_loader=lambda name: utils if name == "osxphotos.utils" else module,
                platform_name="darwin",
                home=home,
                env={},
            )

            libraries = adapter.discover_libraries()

            self.assertEqual([item.path for item in libraries], [str(primary)])
            self.assertTrue(libraries[0].system_library)
            self.assertTrue(libraries[0].last_used)

    def test_apple_discovery_can_include_fixture_libraries_explicitly(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            pictures = home / "Pictures"
            pictures.mkdir()
            primary = pictures / "Photos Library.photoslibrary"
            primary.mkdir()
            fixture = "/private/tmp/vintrace-osxphotos-audit/tests/Test.photoslibrary"
            module = SimpleNamespace(__version__="0.76.1")
            utils = SimpleNamespace(
                get_system_library_path=lambda: str(primary),
                get_last_library_path=lambda: str(primary),
                list_photo_libraries=lambda: [fixture],
            )
            adapter = ApplePhotosAdapter(
                module_loader=lambda name: utils if name == "osxphotos.utils" else module,
                platform_name="darwin",
                home=home,
                env={"VINTRACE_INCLUDE_PHOTOS_TEST_LIBRARIES": "1"},
            )

            paths = {item.path for item in adapter.discover_libraries()}

            self.assertEqual(paths, {str(primary), fixture})

    def test_local_adapters_do_not_open_network_connections(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "Photos Library.photoslibrary"
            root.mkdir()
            photo = FakePhoto(root)
            database = FakePhotosDb(dbfile=str(root), photos=[photo])
            module = SimpleNamespace(__version__="0.76.1", PhotosDB=lambda dbfile: database)
            utils = SimpleNamespace(
                get_system_library_path=lambda: str(root),
                get_last_library_path=lambda: str(root),
                list_photo_libraries=lambda: [str(root)],
            )
            apple = ApplePhotosAdapter(
                module_loader=lambda name: utils if name == "osxphotos.utils" else module,
                platform_name="darwin",
                home=Path(temp),
            )
            folder = Path(temp) / "Pictures"
            folder.mkdir()
            Image.new("RGB", (16, 12), (30, 60, 90)).save(folder / "local.jpg")
            windows = WindowsFolderAdapter(platform_name="windows", home=Path(temp))

            def blocked(*args, **kwargs):
                raise AssertionError("Local photo-source operations attempted network access.")

            with patch.object(socket.socket, "connect", blocked), patch.object(socket, "create_connection", blocked):
                self.assertTrue(apple.status()["available"])
                self.assertEqual(len(apple.discover_libraries()), 1)
                with apple.open_library(str(root)) as opened:
                    self.assertEqual(len(list(opened.iter_assets(PhotoSourceScopes.from_params({})))), 1)
                preview = windows.preview(str(folder), PhotoSourceScopes.from_params({}))
                self.assertEqual(preview.counts["assets"], 1)

    def test_windows_folder_adapter_reads_embedded_exif_dimensions_and_camera(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "Pictures"
            root.mkdir()
            image_path = root / "camera.jpg"
            exif = Image.Exif()
            exif[270] = "Embedded title"
            exif[271] = "Vintrace Camera Co."
            exif[272] = "ScaleCam 1"
            exif[306] = "2024:05:06 07:08:09"
            Image.new("RGB", (48, 32), (22, 70, 120)).save(image_path, exif=exif)

            portable = read_portable_photo_metadata(image_path)
            self.assertEqual(portable.title, "Embedded title")
            self.assertEqual(portable.width, 48)
            self.assertEqual(portable.height, 32)
            self.assertEqual(portable.date_created, "2024-05-06T07:08:09")
            self.assertEqual(portable.exif["cameraMake"], "Vintrace Camera Co.")
            self.assertEqual(portable.exif["cameraModel"], "ScaleCam 1")

            adapter = WindowsFolderAdapter(platform_name="windows", home=Path(temp))
            with adapter.open_library(str(root)) as opened:
                asset = next(opened.iter_assets(PhotoSourceScopes.from_params({})))
            self.assertEqual((asset.width, asset.height), (48, 32))
            self.assertEqual(asset.exif["cameraModel"], "ScaleCam 1")

    def test_sensitive_scopes_require_explicit_consent(self):
        with self.assertRaisesRegex(ValueError, "sensitiveConsent"):
            PhotoSourceScopes.from_params({"scopes": {"peopleFaces": True}})
        scopes = PhotoSourceScopes.from_params({
            "scopes": {"peopleFaces": True, "preciseLocation": True},
            "sensitiveConsent": True,
        })
        self.assertTrue(scopes.people_faces)
        self.assertTrue(scopes.precise_location)

    def test_apple_adapter_is_lazy_and_maps_sensitive_data_only_with_consent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "Photos Library.photoslibrary"
            root.mkdir()
            visible = FakePhoto(root)
            hidden = FakePhoto(root, hidden=True)
            database = FakePhotosDb(dbfile=str(root), photos=[visible, hidden])
            module = SimpleNamespace(__version__="0.76.1", PhotosDB=lambda dbfile: database)
            utils = SimpleNamespace(
                get_system_library_path=lambda: str(root),
                get_last_library_path=lambda: str(root),
                list_photo_libraries=lambda: [str(root)],
            )
            loads: list[str] = []

            def loader(name: str):
                loads.append(name)
                return utils if name == "osxphotos.utils" else module

            adapter = ApplePhotosAdapter(module_loader=loader, platform_name="darwin", home=Path(temp))
            self.assertEqual(loads, [])
            self.assertTrue(adapter.status()["available"])
            self.assertEqual(loads, ["osxphotos"])
            libraries = adapter.discover_libraries()
            self.assertEqual(len(libraries), 1)
            self.assertTrue(libraries[0].system_library)
            default_scopes = PhotoSourceScopes.from_params({})
            with adapter.open_library(str(root)) as opened:
                assets = list(opened.iter_assets(default_scopes))
            self.assertEqual([asset.external_id for asset in assets], ["APPLE-1"])
            self.assertEqual(assets[0].people, [])
            self.assertEqual(assets[0].location, {})
            self.assertFalse(assets[0].shared)
            default_payload = json.dumps(assets[0].to_dict(), sort_keys=True)
            for sensitive_value in ("Ada Lovelace", "Grace Hopper", "San Francisco", "37.7"):
                self.assertNotIn(sensitive_value, default_payload)

            no_labels = PhotoSourceScopes.from_params({"scopes": {"labelsOcr": False}})
            with adapter.open_library(str(root)) as opened:
                no_label_asset = next(opened.iter_assets(no_labels))
            self.assertEqual(no_label_asset.metadata["aiCaption"], "")
            self.assertEqual(no_label_asset.metadata["mediaAnalysis"], {})

            sensitive_scopes = PhotoSourceScopes.from_params({
                "scopes": {
                    "peopleFaces": True,
                    "preciseLocation": True,
                    "hidden": True,
                    "shared": True,
                    "commentsLikes": True,
                    "extractDetectedText": True,
                },
                "sensitiveConsent": True,
            })
            with adapter.open_library(str(root)) as opened:
                assets = list(opened.iter_assets(sensitive_scopes))
                exported = opened.export_asset("APPLE-1", str(Path(temp) / "export"))
            self.assertEqual(len(assets), 2)
            asset = next(item for item in assets if item.external_id == "APPLE-1")
            self.assertEqual(asset.people[0].name, "Ada")
            self.assertEqual(asset.faces[0].region["microsoft"]["x"], 0.3)
            self.assertEqual(asset.location["latitude"], 37.7)
            self.assertEqual(asset.exif["GPSLatitude"], 37.7)
            self.assertEqual(asset.provenance["moment"]["place"]["city"], "San Francisco")
            self.assertEqual(asset.metadata["owner"], "Owner")
            self.assertEqual(asset.ocr_blocks[0]["text"], "Pier 39")
            self.assertEqual(asset.albums[0].folder_path[0]["name"], "Trips")
            self.assertTrue(Path(exported[0]).is_file())
            self.assertFalse(visible.export_calls[0]["use_photos_export"])

    def test_windows_folder_adapter_reads_mwg_and_microsoft_regions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "Pictures"
            album = root / "Trips" / "Coast"
            album.mkdir(parents=True)
            image = album / "harbor.jpg"
            image.write_bytes(b"jpeg-fixture")
            image.with_suffix(".xmp").write_text(
                """<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
    xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:MP="http://ns.microsoft.com/photo/1.2/"
    xmlns:MPReg="http://ns.microsoft.com/photo/1.2/t/Region#">
    <rdf:Description xmp:Rating="5" xmp:CreateDate="2024-04-05T06:07:08Z"
      exif:GPSLatitude="37.7" exif:GPSLongitude="-122.4">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP Harbor</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Coastal trip</rdf:li></rdf:Alt></dc:description>
      <dc:subject><rdf:Bag><rdf:li>Trip</rdf:li><rdf:li>Harbor</rdf:li></rdf:Bag></dc:subject>
      <mwg-rs:RegionInfo><mwg-rs:RegionList><rdf:Bag>
        <rdf:li><mwg-rs:Name>Ada</mwg-rs:Name><mwg-rs:Type>Face</mwg-rs:Type>
          <mwg-rs:Area stArea:x="0.5" stArea:y="0.5" stArea:w="0.3" stArea:h="0.4" stArea:unit="normalized" />
        </rdf:li>
      </rdf:Bag></mwg-rs:RegionList></mwg-rs:RegionInfo>
      <MP:RegionInfo><rdf:Bag><rdf:li>
        <MPReg:PersonDisplayName>Grace</MPReg:PersonDisplayName>
        <MPReg:Rectangle>0.1, 0.2, 0.3, 0.4</MPReg:Rectangle>
      </rdf:li></rdf:Bag></MP:RegionInfo>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
""",
                encoding="utf-8",
            )
            portable = read_portable_photo_metadata(image)
            self.assertEqual(portable.title, "XMP Harbor")
            self.assertEqual(portable.caption, "Coastal trip")
            self.assertEqual(portable.rating, 5)
            self.assertEqual(set(portable.keywords), {"Trip", "Harbor"})
            self.assertEqual({item["personName"] for item in portable.people_regions}, {"Ada", "Grace"})

            adapter = WindowsFolderAdapter(platform_name="windows", home=Path(temp))
            with adapter.open_library(str(root)) as opened:
                private_asset = next(opened.iter_assets(PhotoSourceScopes.from_params({})))
            private_payload = json.dumps(private_asset.to_dict(), sort_keys=True)
            for sensitive_value in ("Ada", "Grace", "37.7", "-122.4"):
                self.assertNotIn(sensitive_value, private_payload)
            scopes = PhotoSourceScopes.from_params({
                "scopes": {"peopleFaces": True, "preciseLocation": True},
                "sensitiveConsent": True,
            })
            with adapter.open_library(str(root)) as opened:
                first = list(opened.iter_assets(scopes))
            self.assertEqual(len(first), 1)
            asset = first[0]
            self.assertEqual(asset.title, "XMP Harbor")
            self.assertEqual(asset.albums[0].name, "Coast")
            self.assertEqual([folder["name"] for folder in asset.albums[0].folder_path], ["Trips"])
            self.assertEqual({person.name for person in asset.people}, {"Ada", "Grace"})
            self.assertEqual(asset.location["latitude"], 37.7)
            self.assertTrue(asset.favorite)

            renamed = album / "renamed.jpg"
            image.rename(renamed)
            image.with_suffix(".xmp").rename(renamed.with_suffix(".xmp"))
            with adapter.open_library(str(root)) as opened:
                second = list(opened.iter_assets(scopes))
            self.assertEqual(first[0].external_id, second[0].external_id)


if __name__ == "__main__":
    unittest.main()
