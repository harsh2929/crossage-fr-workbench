"""Read-only adapters for external photo libraries and folder catalogs."""

from .contracts import (
    NormalizedAlbum,
    NormalizedFace,
    NormalizedPhotoAsset,
    NormalizedPerson,
    PhotoSourceLibrary,
    PhotoSourcePreview,
    PhotoSourceScopes,
)

__all__ = [
    "NormalizedAlbum",
    "NormalizedFace",
    "NormalizedPhotoAsset",
    "NormalizedPerson",
    "PhotoSourceLibrary",
    "PhotoSourcePreview",
    "PhotoSourceScopes",
]
