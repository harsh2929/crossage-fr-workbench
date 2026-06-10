from __future__ import annotations

from datetime import datetime
from pathlib import Path
import hashlib
import importlib.util
import os
from typing import Iterable

from PIL import ExifTags, Image, ImageOps

from crossage_fr.models import ImageRecord, new_id


PILLOW_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".jpe",
    ".jfif",
    ".png",
    ".apng",
    ".bmp",
    ".dib",
    ".tif",
    ".tiff",
    ".webp",
    ".gif",
    ".avif",
    ".ico",
    ".icns",
    ".jp2",
    ".j2k",
    ".jpc",
    ".jpf",
    ".jpx",
    ".ppm",
    ".pgm",
    ".pbm",
    ".pnm",
    ".tga",
    ".dds",
    ".psd",
}

HEIF_IMAGE_EXTENSIONS = {
    ".heic",
    ".heif",
    ".hif",
    ".heics",
    ".heifs",
}

RAW_IMAGE_EXTENSIONS = {
    ".dng",
    ".raw",
    ".arw",
    ".cr2",
    ".cr3",
    ".nef",
    ".nrw",
    ".orf",
    ".raf",
    ".rw2",
    ".pef",
    ".srw",
    ".x3f",
    ".3fr",
    ".erf",
    ".kdc",
    ".mos",
    ".mrw",
}

IMAGE_EXTENSIONS = {
    *PILLOW_IMAGE_EXTENSIONS,
    *HEIF_IMAGE_EXTENSIONS,
    *RAW_IMAGE_EXTENSIONS,
}

BROWSER_RENDERABLE_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".jpe",
    ".jfif",
    ".png",
    ".apng",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".ico",
}

_IMAGE_OPENERS_REGISTERED = False


class ImageLoadError(RuntimeError):
    pass


def register_image_openers() -> None:
    global _IMAGE_OPENERS_REGISTERED
    if _IMAGE_OPENERS_REGISTERED:
        return
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
        register_avif_opener = getattr(pillow_heif, "register_avif_opener", None)
        if register_avif_opener:
            register_avif_opener()
    except Exception:
        pass
    Image.init()
    _IMAGE_OPENERS_REGISTERED = True


def register_heif() -> None:
    register_image_openers()


def supported_image_extensions() -> list[str]:
    return sorted(IMAGE_EXTENSIONS)


def image_decoder_report() -> dict[str, object]:
    register_image_openers()
    registered = Image.registered_extensions()
    pillow_decodable = sorted(extension for extension in PILLOW_IMAGE_EXTENSIONS if extension in registered)
    heif_available = importlib.util.find_spec("pillow_heif") is not None
    raw_available = importlib.util.find_spec("rawpy") is not None
    return {
        "extensions": supported_image_extensions(),
        "pillow": pillow_decodable,
        "heif": sorted(HEIF_IMAGE_EXTENSIONS) if heif_available else [],
        "raw": sorted(RAW_IMAGE_EXTENSIONS) if raw_available else [],
        "heifAvailable": heif_available,
        "rawAvailable": raw_available,
    }


def iter_image_paths(root: Path) -> Iterable[Path]:
    root = root.expanduser().resolve()
    if root.is_file() and root.suffix.lower() in IMAGE_EXTENSIONS:
        yield root
        return
    if not root.exists():
        return
    for current, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in sorted(filenames):
            path = Path(current) / filename
            if path.suffix.lower() in IMAGE_EXTENSIONS:
                yield path


def _representative_frame(image: Image.Image) -> Image.Image:
    frame_count = int(getattr(image, "n_frames", 1) or 1)
    target = frame_count // 2 if frame_count > 1 else 0
    try:
        image.seek(target)
    except Exception:
        try:
            image.seek(0)
        except Exception:
            pass
    return image.copy()


def _to_rgb(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    has_alpha = image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info)
    if has_alpha:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def _load_raw_image(path: Path) -> Image.Image:
    try:
        import rawpy
    except Exception as exc:
        raise ImageLoadError(f"RAW/DNG image support requires rawpy: {path}") from exc
    try:
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False, output_bps=8)
        return Image.fromarray(rgb).convert("RGB")
    except Exception as exc:
        raise ImageLoadError(f"Could not load RAW/DNG image {path}: {exc}") from exc


def load_image(path: Path) -> Image.Image:
    register_image_openers()
    if path.suffix.lower() in RAW_IMAGE_EXTENSIONS:
        return _load_raw_image(path)
    try:
        with Image.open(path) as image:
            return _to_rgb(_representative_frame(image))
    except Exception as exc:
        raise ImageLoadError(f"Could not load image {path}: {exc}") from exc


def needs_browser_preview(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS and path.suffix.lower() not in BROWSER_RENDERABLE_IMAGE_EXTENSIONS


def write_preview_image(source: Path, target: Path, max_edge: int = 1024, quality: int = 86) -> Path:
    image = load_image(source)
    image.thumbnail((max(128, max_edge), max(128, max_edge)), Image.Resampling.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    image.save(temp, format="JPEG", quality=quality, optimize=True, progressive=True)
    temp.replace(target)
    return target


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def average_hash(image: Image.Image) -> str:
    gray = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    values = list(gray.getdata())
    mean = sum(values) / len(values)
    bits = 0
    for value in values:
        bits = (bits << 1) | int(value >= mean)
    return f"{bits:016x}"


def capture_date(path: Path, image: Image.Image) -> str | None:
    try:
        exif = image.getexif()
    except Exception:
        exif = {}
    tags = {ExifTags.TAGS.get(k, str(k)): v for k, v in exif.items()}
    for key in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        value = tags.get(key)
        if not value:
            continue
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(str(value), fmt).date().isoformat()
            except ValueError:
                pass
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).date().isoformat()
    except OSError:
        return None


def image_record_for_path(path: Path, image: Image.Image | None = None, sha256: str | None = None) -> ImageRecord:
    image = image or load_image(path)
    return ImageRecord(
        image_id=new_id("img"),
        path=str(path),
        sha256=sha256 or sha256_file(path),
        phash=average_hash(image),
        width=image.width,
        height=image.height,
        capture_date=capture_date(path, image),
    )
