import { Check, X } from "lucide-react";
import type { PhotoFolder } from "../types";

type PhotoAlbumFolderEditorText = (value: string) => string;

export type PhotoAlbumFolderEditorProps = {
  name: string;
  parentId: string;
  parentFolders: PhotoFolder[];
  error: string;
  busy: boolean;
  saving: boolean;
  uiText: PhotoAlbumFolderEditorText;
  onNameChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function PhotoAlbumFolderEditor(props: PhotoAlbumFolderEditorProps) {
  return (
    <div className="photo-album-editor">
      <input
        aria-label={props.uiText("Album folder name")}
        value={props.name}
        onChange={(event) => props.onNameChange(event.currentTarget.value)}
        placeholder={props.uiText("Folder name")}
      />
      <label className="photo-album-kind-field">
        <span>{props.uiText("Parent folder")}</span>
        <select value={props.parentId} onChange={(event) => props.onParentChange(event.currentTarget.value)}>
          <option value="">{props.uiText("Top level")}</option>
          {props.parentFolders.map((folder) => (
            <option key={folder.id} value={folder.folderId || folder.id.replace(/^albumFolder:/, "")}>{folder.name}</option>
          ))}
        </select>
      </label>
      {props.error && <p className="compact warn">{props.error}</p>}
      <div className="photo-album-actions">
        <button type="button" className="secondary compact-action" onClick={props.onSave} disabled={props.busy || props.saving || !props.name.trim()}>
          <Check size={14} />
          <span>{props.uiText("Save folder")}</span>
        </button>
        <button type="button" className="ghost compact-action" onClick={props.onCancel} disabled={props.saving}>
          <X size={14} />
          <span>{props.uiText("Cancel")}</span>
        </button>
      </div>
    </div>
  );
}
