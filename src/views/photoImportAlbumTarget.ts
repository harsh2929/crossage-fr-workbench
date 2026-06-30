import type { PhotoAsset, PhotoImportResult } from "../types";

export const PHOTO_IMPORT_NEW_ALBUM_TARGET = "__new_import_album__";

export type PhotoImportAlbumOption = {
  albumId?: string;
  id?: string;
  name?: string;
};

export function photoImportAlbumOptionId(album: PhotoImportAlbumOption): string {
  const directId = String(album.albumId || "").trim();
  if (directId) return directId;
  return String(album.id || "").replace(/^album:/, "").trim();
}

export function photoImportAlbumTargetNeedsName(targetId: string): boolean {
  return targetId === PHOTO_IMPORT_NEW_ALBUM_TARGET;
}

export function photoImportAlbumTargetLabel(
  targetId: string,
  newAlbumName: string,
  albums: PhotoImportAlbumOption[],
): string {
  const cleanTarget = String(targetId || "").trim();
  if (!cleanTarget) return "No album";
  if (photoImportAlbumTargetNeedsName(cleanTarget)) {
    return String(newAlbumName || "").trim() || "New manual album";
  }
  const match = albums.find((album) => photoImportAlbumOptionId(album) === cleanTarget);
  return String(match?.name || "").trim() || "Selected album";
}

function photoAssetSourcePath(asset: PhotoAsset | Record<string, unknown>): string {
  return String((asset as PhotoAsset).sourcePath || "").trim();
}

export function photoImportResultFinalSourcePaths(result: PhotoImportResult | null | undefined): string[] {
  if (!result) return [];
  const importedPaths = Array.isArray(result.importedPaths)
    ? result.importedPaths.map((path) => String(path || "").trim()).filter(Boolean)
    : [];
  const assetPaths = Array.isArray(result.assets)
    ? result.assets.map(photoAssetSourcePath).filter(Boolean)
    : [];
  return [...new Set(importedPaths.length ? importedPaths : assetPaths)];
}
