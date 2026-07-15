from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import mimetypes
import re
from pathlib import Path
from typing import Any, Iterable
import xml.etree.ElementTree as ET

from .contracts import clean_strings, json_safe


XMP_READ_LIMIT_BYTES = 16 * 1024 * 1024
XMP_EMBEDDED_SCAN_LIMIT_BYTES = 4 * 1024 * 1024


def _local_name(name: str) -> str:
    return str(name or "").rsplit("}", 1)[-1].rsplit(":", 1)[-1]


def _text(element: ET.Element | None) -> str:
    return " ".join("".join(element.itertext()).split()).strip() if element is not None else ""


def _float(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text:
        return None
    if "/" in text and re.fullmatch(r"-?\d+(?:\.\d+)?/-?\d+(?:\.\d+)?", text):
        numerator, denominator = text.split("/", 1)
        try:
            divisor = float(denominator)
            return float(numerator) / divisor if divisor else None
        except ValueError:
            return None
    try:
        return float(text)
    except ValueError:
        return None


def _xmp_sidecar_candidates(path: Path) -> list[Path]:
    candidates = [
        path.with_suffix(path.suffix + ".xmp"),
        path.with_suffix(".xmp"),
        path.with_suffix(".XMP"),
    ]
    output: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        output.append(candidate)
    return output


def _extract_xmp_packet(data: bytes) -> bytes:
    starts = [marker for marker in (b"<x:xmpmeta", b"<xmpmeta", b"<rdf:RDF") if marker in data]
    if not starts:
        return b""
    start = min(data.find(marker) for marker in starts)
    for marker in (b"</x:xmpmeta>", b"</xmpmeta>", b"</rdf:RDF>"):
        end = data.find(marker, start)
        if end >= 0:
            return data[start:end + len(marker)]
    return b""


def _decode_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        encodings = ("utf-16-le", "utf-8", "latin-1") if b"\x00" in value else ("utf-8", "utf-16-le", "latin-1")
        for encoding in encodings:
            try:
                return " ".join(value.decode(encoding).replace("\x00", "").split()).strip()
            except UnicodeDecodeError:
                continue
        return ""
    return " ".join(str(value or "").replace("\x00", "").split()).strip()


def _text_values(value: Any) -> list[str]:
    values = value if isinstance(value, (list, tuple, set)) else [value]
    return clean_strings((_decode_text(item) for item in values), limit=5_000, max_length=2_000)


def _iso_datetime(value: Any) -> str:
    text = _decode_text(value)
    if not text:
        return ""
    for pattern in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(text, pattern).isoformat()
        except ValueError:
            continue
    return text


def _ratio(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    if isinstance(value, (list, tuple)) and len(value) == 2:
        try:
            denominator = float(value[1])
            return float(value[0]) / denominator if denominator else None
        except (TypeError, ValueError, ZeroDivisionError):
            return None
    return None


def _gps_decimal(value: Any, ref: Any) -> float | None:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    parts = [_ratio(item) for item in value[:3]]
    if any(item is None for item in parts):
        return None
    degrees, minutes, seconds = (float(item) for item in parts if item is not None)
    decimal = abs(degrees) + abs(minutes) / 60.0 + abs(seconds) / 3600.0
    if _decode_text(ref).upper() in {"S", "W"}:
        decimal *= -1
    return decimal


def _read_file_metadata(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "width": None,
        "height": None,
        "mimeType": mimetypes.guess_type(str(path))[0] or "",
        "title": "",
        "caption": "",
        "dateCreated": "",
        "rating": 0,
        "keywords": [],
        "latitude": None,
        "longitude": None,
        "xmp": "",
        "exif": {},
        "iptc": {},
        "place": {},
    }
    try:
        from PIL import ExifTags, Image, IptcImagePlugin
    except Exception:
        return result
    try:
        with Image.open(path) as image:
            result["width"] = int(image.width)
            result["height"] = int(image.height)
            result["mimeType"] = str(image.get_format_mimetype() or result["mimeType"])
            for key in ("xmp", "XML:com.adobe.xmp", "XMLPacket"):
                packet = image.info.get(key)
                if packet:
                    result["xmp"] = _decode_text(packet)
                    break
            try:
                exif = image.getexif()
            except Exception:
                exif = {}
            tags = {ExifTags.TAGS.get(key, str(key)): value for key, value in exif.items()} if exif else {}
            for ifd_id in (getattr(ExifTags.IFD, "Exif", 34665),):
                try:
                    nested = exif.get_ifd(ifd_id) if exif else {}
                except Exception:
                    nested = {}
                if nested:
                    tags.update({ExifTags.TAGS.get(key, str(key)): value for key, value in nested.items()})
            exif_meta: dict[str, Any] = {}
            for tag_name, output_name in (
                ("Make", "cameraMake"),
                ("Model", "cameraModel"),
                ("LensModel", "lensModel"),
                ("Software", "software"),
                ("Orientation", "orientation"),
                ("FNumber", "fNumber"),
                ("ExposureTime", "exposureTime"),
                ("PhotographicSensitivity", "isoSpeed"),
                ("ISOSpeedRatings", "isoSpeed"),
                ("FocalLength", "focalLength"),
            ):
                if tag_name in tags and output_name not in exif_meta:
                    exif_meta[output_name] = json_safe(tags[tag_name])
            result["title"] = _decode_text(tags.get("XPTitle")) or _decode_text(tags.get("ImageDescription"))
            result["caption"] = _decode_text(tags.get("XPComment")) or _decode_text(tags.get("UserComment"))
            result["keywords"] = _text_values(tags.get("XPKeywords"))
            for date_key in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
                date_value = _iso_datetime(tags.get(date_key))
                if date_value:
                    result["dateCreated"] = date_value
                    exif_meta["captureDate"] = date_value
                    break
            for rating_key in ("Rating", "RatingPercent"):
                try:
                    rating = int(tags.get(rating_key, 0) or 0)
                except (TypeError, ValueError):
                    continue
                if rating_key == "RatingPercent":
                    rating = int(round(max(0, min(100, rating)) / 20))
                if rating:
                    result["rating"] = max(0, min(5, rating))
                    break
            gps_raw: dict[Any, Any] = {}
            try:
                gps_raw = dict(exif.get_ifd(ExifTags.IFD.GPSInfo)) if exif else {}
            except Exception:
                try:
                    gps_raw = dict(exif.get(34853, {}) or {}) if exif else {}
                except Exception:
                    gps_raw = {}
            gps = {ExifTags.GPSTAGS.get(key, str(key)): value for key, value in gps_raw.items()}
            latitude = _gps_decimal(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
            longitude = _gps_decimal(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
            if latitude is not None and longitude is not None:
                result["latitude"] = latitude
                result["longitude"] = longitude
                exif_meta["gps"] = {"latitude": latitude, "longitude": longitude}
            result["exif"] = exif_meta

            try:
                iptc_raw = IptcImagePlugin.getiptcinfo(image) or {}
            except Exception:
                iptc_raw = {}

            def iptc(*keys: tuple[int, int]) -> Any:
                for key in keys:
                    if key in iptc_raw:
                        return iptc_raw[key]
                return None

            iptc_title = _decode_text(iptc((2, 5)))
            iptc_caption = _decode_text(iptc((2, 120)))
            iptc_keywords = _text_values(iptc((2, 25)))
            iptc_date = _decode_text(iptc((2, 55)))
            iptc_time = _decode_text(iptc((2, 60)))
            iptc_date_created = _iso_datetime(f"{iptc_date}{iptc_time}" if iptc_date else "")
            place = {
                "city": _decode_text(iptc((2, 90))),
                "state": _decode_text(iptc((2, 95))),
                "country": _decode_text(iptc((2, 101))),
            }
            result["iptc"] = {
                key: value
                for key, value in {
                    "title": iptc_title,
                    "caption": iptc_caption,
                    "keywords": iptc_keywords,
                    "dateCreated": iptc_date_created,
                    **place,
                }.items()
                if value
            }
            result["place"] = {key: value for key, value in place.items() if value}
            result["title"] = iptc_title or result["title"]
            result["caption"] = iptc_caption or result["caption"]
            result["keywords"] = clean_strings([*result["keywords"], *iptc_keywords])
            result["dateCreated"] = iptc_date_created or result["dateCreated"]
    except Exception:
        pass
    return result


def _read_xmp(path: Path, embedded: str = "") -> tuple[str, str]:
    for candidate in _xmp_sidecar_candidates(path):
        try:
            if candidate.is_file() and candidate.stat().st_size <= XMP_READ_LIMIT_BYTES:
                return candidate.read_text(encoding="utf-8", errors="replace"), str(candidate)
        except OSError:
            continue
    if embedded:
        return embedded, "embedded"
    try:
        with path.open("rb") as handle:
            packet = _extract_xmp_packet(handle.read(XMP_EMBEDDED_SCAN_LIMIT_BYTES))
        if packet:
            return packet.decode("utf-8", errors="replace"), "embedded"
    except OSError:
        pass
    return "", ""


def _values_by_local_name(root: ET.Element, names: Iterable[str]) -> list[str]:
    wanted = {name.casefold() for name in names}
    output: list[str] = []
    for element in root.iter():
        local_name = _local_name(element.tag).casefold()
        is_rdf_description = (
            local_name == "description"
            and str(element.tag).startswith("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}")
        )
        if local_name in wanted and not is_rdf_description:
            value = _text(element)
            if value:
                output.append(value)
        for key, value in element.attrib.items():
            if _local_name(key).casefold() in wanted and str(value or "").strip():
                output.append(str(value).strip())
    return clean_strings(output, limit=1000, max_length=2000)


def _rdf_list_values(root: ET.Element, parent_names: Iterable[str]) -> list[str]:
    wanted = {name.casefold() for name in parent_names}
    values: list[str] = []
    for parent in root.iter():
        if _local_name(parent.tag).casefold() not in wanted:
            continue
        for child in parent.iter():
            if _local_name(child.tag).casefold() in {"li", "item"}:
                value = _text(child)
                if value:
                    values.append(value)
    return clean_strings(values, limit=5000, max_length=500)


def _first_value(root: ET.Element, names: Iterable[str]) -> str:
    values = _values_by_local_name(root, names)
    return values[0] if values else ""


def _region_map(container: ET.Element) -> dict[str, list[str]]:
    values: dict[str, list[str]] = {}
    for element in container.iter():
        name = _local_name(element.tag).casefold()
        text = _text(element)
        if text:
            values.setdefault(name, []).append(text)
        for key, raw_value in element.attrib.items():
            attr_name = _local_name(key).casefold()
            value = str(raw_value or "").strip()
            if value:
                values.setdefault(attr_name, []).append(value)
    return values


def _first(mapping: dict[str, list[str]], *keys: str) -> str:
    for key in keys:
        values = mapping.get(key.casefold(), [])
        if values:
            return values[0]
    return ""


def _parse_rectangle(value: str) -> dict[str, float]:
    numbers = [_float(part) for part in re.split(r"[,;\s]+", str(value or "").strip()) if part]
    if len(numbers) < 4 or any(number is None for number in numbers[:4]):
        return {}
    x, y, width, height = (float(number) for number in numbers[:4] if number is not None)
    return {"x": x, "y": y, "width": width, "height": height, "unit": "normalized"}


def _parse_people_regions(root: ET.Element) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    candidate_names = {"li", "region", "description"}
    for container in root.iter():
        if _local_name(container.tag).casefold() not in candidate_names:
            continue
        mapping = _region_map(container)
        names = []
        for key in ("persondisplayname", "name", "personname"):
            names.extend(mapping.get(key, []))
        names = clean_strings(names, limit=10, max_length=200)
        if len(names) != 1:
            continue
        person_name = names[0]
        rectangle_text = _first(mapping, "rectangle", "regionrectangle")
        rectangle = _parse_rectangle(rectangle_text)
        area: dict[str, Any] = {}
        if not rectangle:
            x = _float(_first(mapping, "x"))
            y = _float(_first(mapping, "y"))
            width = _float(_first(mapping, "w", "width"))
            height = _float(_first(mapping, "h", "height"))
            if None not in (x, y, width, height):
                area = {
                    "centerX": x,
                    "centerY": y,
                    "width": width,
                    "height": height,
                    "unit": _first(mapping, "unit") or "normalized",
                }
        region = rectangle or area
        if not region:
            continue
        key = (person_name.casefold(), repr(sorted(region.items())))
        if key in seen:
            continue
        seen.add(key)
        output.append({
            "personName": person_name,
            "type": _first(mapping, "type") or "Face",
            "region": region,
            "source": "microsoft" if rectangle else "mwg",
        })
    return output


@dataclass
class PortablePhotoMetadata:
    title: str = ""
    caption: str = ""
    date_created: str = ""
    rating: int = 0
    color_label: str = ""
    pick_status: str = ""
    keywords: list[str] = field(default_factory=list)
    hierarchical_keywords: list[str] = field(default_factory=list)
    people_regions: list[dict[str, Any]] = field(default_factory=list)
    latitude: float | None = None
    longitude: float | None = None
    document_id: str = ""
    instance_id: str = ""
    source: str = ""
    width: int | None = None
    height: int | None = None
    mime_type: str = ""
    exif: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)
    warnings: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "caption": self.caption,
            "dateCreated": self.date_created,
            "rating": self.rating,
            "colorLabel": self.color_label,
            "pickStatus": self.pick_status,
            "keywords": self.keywords,
            "hierarchicalKeywords": self.hierarchical_keywords,
            "peopleRegions": self.people_regions,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "documentId": self.document_id,
            "instanceId": self.instance_id,
            "source": self.source,
            "width": self.width,
            "height": self.height,
            "mimeType": self.mime_type,
            "exif": self.exif,
            "raw": self.raw,
            "warnings": self.warnings,
        }


def read_portable_photo_metadata(path: str | Path) -> PortablePhotoMetadata:
    source_path = Path(path).expanduser()
    file_metadata = _read_file_metadata(source_path)
    text, source = _read_xmp(source_path, str(file_metadata.get("xmp", "") or ""))
    base = {
        "title": str(file_metadata.get("title", "") or ""),
        "caption": str(file_metadata.get("caption", "") or ""),
        "date_created": str(file_metadata.get("dateCreated", "") or ""),
        "rating": int(file_metadata.get("rating", 0) or 0),
        "keywords": clean_strings(file_metadata.get("keywords", [])),
        "latitude": file_metadata.get("latitude"),
        "longitude": file_metadata.get("longitude"),
        "source": source or ("embedded_metadata" if file_metadata.get("exif") or file_metadata.get("iptc") else ""),
        "width": file_metadata.get("width"),
        "height": file_metadata.get("height"),
        "mime_type": str(file_metadata.get("mimeType", "") or ""),
        "exif": file_metadata.get("exif", {}) if isinstance(file_metadata.get("exif"), dict) else {},
        "raw": {
            "exif": file_metadata.get("exif", {}),
            "iptc": file_metadata.get("iptc", {}),
            **(file_metadata.get("place", {}) if isinstance(file_metadata.get("place"), dict) else {}),
        },
    }
    if not text:
        return PortablePhotoMetadata(**base)
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        packet = _extract_xmp_packet(text.encode("utf-8", errors="replace"))
        try:
            root = ET.fromstring(packet) if packet else None
        except ET.ParseError:
            root = None
        if root is None:
            return PortablePhotoMetadata(
                **base,
                warnings=[{"code": "xmp-parse-failed", "message": str(exc)[:300]}],
            )

    xmp_title = _first_value(root, ("title",))
    xmp_caption = _first_value(root, ("description", "caption-abstract", "caption"))
    title = xmp_title or base["title"]
    caption = xmp_caption or base["caption"]
    keywords = _rdf_list_values(root, ("subject", "keywords"))
    if not keywords:
        keywords = _values_by_local_name(root, ("subject", "keywords"))
    keywords = clean_strings([*keywords, *base["keywords"]])
    hierarchical = _rdf_list_values(root, ("hierarchicalsubject",))
    rating_value = _first_value(root, ("catalograting", "rating"))
    try:
        raw_rating = int(round(float(rating_value or 0)))
    except ValueError:
        raw_rating = 0
    rating = max(0, min(5, raw_rating))
    raw_color_label = re.sub(r"[^a-z]+", "", _first_value(root, ("colorlabel", "label")).casefold())
    color_label = {
        "red": "red",
        "yellow": "yellow",
        "green": "green",
        "blue": "blue",
        "purple": "purple",
        "violet": "purple",
    }.get(raw_color_label, "")
    raw_pick_value = _first_value(root, ("pickstatus", "pick", "pickflag", "flag"))
    try:
        numeric_pick = int(round(float(raw_pick_value or 0)))
    except ValueError:
        numeric_pick = 0
    pick_token = re.sub(r"[^a-z]+", "", raw_pick_value.casefold())
    pick_status = (
        "reject" if raw_rating < 0 or numeric_pick < 0 or pick_token in {"reject", "rejected", "discard"}
        else "pick" if numeric_pick > 0 or pick_token in {"pick", "picked", "selected", "keeper"}
        else ""
    )
    latitude = _float(_first_value(root, ("gpslatitude", "latitude")))
    longitude = _float(_first_value(root, ("gpslongitude", "longitude")))
    latitude = latitude if latitude is not None else base["latitude"]
    longitude = longitude if longitude is not None else base["longitude"]
    warnings: list[dict[str, str]] = []
    for field_name, xmp_value, embedded_value in (
        ("title", xmp_title, base["title"]),
        ("caption", xmp_caption, base["caption"]),
    ):
        if xmp_value and embedded_value and xmp_value.casefold() != str(embedded_value).casefold():
            warnings.append({
                "code": "metadata-conflict",
                "message": f"XMP {field_name} overrides a different embedded {field_name}.",
            })
    xmp_place = {
        "city": _first_value(root, ("city",)),
        "state": _first_value(root, ("state", "province-state")),
        "country": _first_value(root, ("country", "countryname")),
    }
    base_place = file_metadata.get("place", {}) if isinstance(file_metadata.get("place"), dict) else {}
    return PortablePhotoMetadata(
        title=title,
        caption=caption,
        date_created=_first_value(root, ("datecreated", "datetimeoriginal", "createdate")) or base["date_created"],
        rating=rating or base["rating"],
        color_label=color_label,
        pick_status=pick_status,
        keywords=keywords,
        hierarchical_keywords=hierarchical,
        people_regions=_parse_people_regions(root),
        latitude=latitude,
        longitude=longitude,
        document_id=_first_value(root, ("documentid",)),
        instance_id=_first_value(root, ("instanceid",)),
        source=source,
        width=base["width"],
        height=base["height"],
        mime_type=base["mime_type"],
        exif=base["exif"],
        raw={
            "creator": _values_by_local_name(root, ("creator",)),
            "rights": _values_by_local_name(root, ("rights", "copyright")),
            "source": _first_value(root, ("source",)),
            "city": xmp_place["city"] or str(base_place.get("city", "") or ""),
            "state": xmp_place["state"] or str(base_place.get("state", "") or ""),
            "country": xmp_place["country"] or str(base_place.get("country", "") or ""),
            "exif": base["exif"],
            "iptc": file_metadata.get("iptc", {}),
        },
        warnings=warnings,
    )
