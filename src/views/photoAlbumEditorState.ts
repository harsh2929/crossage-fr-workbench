import type { PhotoAlbumRules, PhotoFolder } from "../types";
import { cleanPhotoAlbumRules } from "./photoSavedSearch";

export type PhotoAlbumKind = "smart" | "manual";

export interface PhotoAlbumEditorDraft {
  albumKind: PhotoAlbumKind;
  name: string;
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
}

export type PhotoManualAlbumCreateDraft = {
  name: string;
  albumKind: "manual";
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  coverSourcePath: string;
};

export type PhotoManualAlbumAddDraft = {
  albumId: string;
  sourcePaths: string[];
  createAlbum: PhotoManualAlbumCreateDraft | null;
};

export type PhotoAlbumCoverSaveDraft = {
  albumId: string;
  name: string;
  albumKind: string;
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  coverSourcePath: string;
  folderId: string;
};

export type PhotoAlbumEditorPayloadDraft = {
  albumId?: string;
  name: string;
  albumKind: PhotoAlbumKind;
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  coverSourcePath: string;
  folderId: string;
};

export type PhotoAlbumDeleteRestoreDraft = {
  albumId: string;
  restoreConfig: Record<string, unknown>;
  restoreName: string;
  shouldLoadManualOrder: boolean;
};

export type PhotoAlbumFolderSaveDraft = {
  folderId?: string;
  name: string;
  parentFolderId: string;
};

export type PhotoAlbumFolderDeleteDraft = {
  folderId: string;
};

export function emptyPhotoAlbumDraft(albumKind: PhotoAlbumKind = "smart"): PhotoAlbumEditorDraft {
  return {
    albumKind,
    name: "",
    description: "",
    includePeople: [],
    excludePeople: [],
    rules: {},
  };
}

function cleanPhotoManualAlbumSourcePaths(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const paths: string[] = [];
  raw.forEach((item) => {
    const path = String(item || "").trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  });
  return paths;
}

function cleanPhotoAlbumPeople(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

export function photoAlbumEditorPayloadDraft(input: {
  albumId?: unknown;
  name?: unknown;
  albumKind?: unknown;
  description?: unknown;
  includePeople?: unknown;
  excludePeople?: unknown;
  rules?: unknown;
  coverSourcePath?: unknown;
  fallbackCoverSourcePath?: unknown;
  folderId?: unknown;
  requireName?: boolean;
  trimName?: boolean;
}): PhotoAlbumEditorPayloadDraft | null {
  const trimName = input.trimName !== false;
  const name = trimName ? String(input.name || "").trim() : String(input.name || "");
  if (input.requireName !== false && !name.trim()) return null;
  const albumKind = input.albumKind === "manual" ? "manual" : "smart";
  const coverSourcePath = input.coverSourcePath ?? input.fallbackCoverSourcePath ?? "";
  const rules = input.rules && typeof input.rules === "object"
    ? cleanPhotoAlbumRules(input.rules as PhotoAlbumRules)
    : {};
  return {
    albumId: String(input.albumId || "").trim() || undefined,
    name,
    albumKind,
    description: String(input.description || ""),
    includePeople: cleanPhotoAlbumPeople(input.includePeople),
    excludePeople: cleanPhotoAlbumPeople(input.excludePeople),
    rules,
    coverSourcePath: String(coverSourcePath || "").trim(),
    folderId: String(input.folderId || "").trim(),
  };
}

export function photoManualAlbumAddDraft(input: {
  sourcePaths: unknown;
  targetAlbumId?: unknown;
  newAlbumName?: unknown;
}): PhotoManualAlbumAddDraft | null {
  const sourcePaths = cleanPhotoManualAlbumSourcePaths(input.sourcePaths);
  if (!sourcePaths.length) return null;
  const albumId = String(input.targetAlbumId || "").trim();
  if (albumId) {
    return {
      albumId,
      sourcePaths,
      createAlbum: null,
    };
  }
  const name = String(input.newAlbumName || "").trim();
  if (!name) return null;
  return {
    albumId: "",
    sourcePaths,
    createAlbum: {
      name,
      albumKind: "manual",
      description: "",
      includePeople: [],
      excludePeople: [],
      rules: {},
      coverSourcePath: sourcePaths[0] || "",
    },
  };
}

export function photoAlbumCoverSaveDraft(
  folder: PhotoFolder | null | undefined,
  coverSourcePath: unknown,
): PhotoAlbumCoverSaveDraft | null {
  const albumId = String(folder?.albumId || "").trim();
  if (!folder || !albumId) return null;
  return {
    albumId,
    name: String(folder.name || ""),
    albumKind: String(folder.albumKind || "smart"),
    description: String(folder.description || ""),
    includePeople: folder.includePeople || [],
    excludePeople: folder.excludePeople || [],
    rules: folder.rules || {},
    coverSourcePath: String(coverSourcePath || "").trim(),
    folderId: String(folder.folderId || ""),
  };
}

export function photoAlbumDeleteRestoreDraft(
  folder: PhotoFolder | null | undefined,
  activeAlbum: PhotoFolder | null | undefined,
): PhotoAlbumDeleteRestoreDraft | null {
  if (!folder) return null;
  const albumId = String(folder.albumId || folder.id.replace(/^album:/, "") || "").trim();
  if (!albumId) return null;
  const isActive = activeAlbum?.albumId === albumId;
  const albumKind = String(folder.albumKind || "smart");
  const restoreConfig: Record<string, unknown> = {
    name: folder.name,
    albumKind,
    description: folder.description || "",
    includePeople: isActive ? (activeAlbum?.includePeople || folder.includePeople || []) : (folder.includePeople || []),
    excludePeople: isActive ? (activeAlbum?.excludePeople || folder.excludePeople || []) : (folder.excludePeople || []),
    rules: folder.rules || {},
    coverSourcePath: folder.coverSourcePath || "",
    folderId: folder.folderId || "",
  };
  return {
    albumId,
    restoreConfig,
    restoreName: String(folder.name || ""),
    shouldLoadManualOrder: albumKind === "manual",
  };
}

export function photoAlbumFolderSaveDraft(input: {
  folderId?: unknown;
  name?: unknown;
  parentFolderId?: unknown;
}): PhotoAlbumFolderSaveDraft | null {
  const name = String(input.name || "").trim();
  if (!name) return null;
  const folderId = String(input.folderId || "").trim();
  return {
    folderId: folderId || undefined,
    name,
    parentFolderId: String(input.parentFolderId || "").trim(),
  };
}

export function photoAlbumFolderDeleteDraft(folder: PhotoFolder | null | undefined): PhotoAlbumFolderDeleteDraft | null {
  if (!folder) return null;
  const folderId = String(folder.folderId || folder.id.replace(/^albumFolder:/, "") || "").trim();
  return folderId ? { folderId } : null;
}
