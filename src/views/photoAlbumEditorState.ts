import type { PhotoAlbumRules } from "../types";

export type PhotoAlbumKind = "smart" | "manual";

export interface PhotoAlbumEditorDraft {
  albumKind: PhotoAlbumKind;
  name: string;
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
}

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
