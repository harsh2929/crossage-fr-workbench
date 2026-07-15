import { Folder, FolderInput, Image as ImageIcon, Sparkles } from "lucide-react";

type PhotoEmptyLibraryStateProps = {
  importingPhotos: boolean;
  indexEverythingRunning: boolean;
  busy: boolean;
  uiText: (value: string) => string;
  onIndexEverything: () => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
};

export function PhotoEmptyLibraryState({
  importingPhotos,
  indexEverythingRunning,
  busy,
  uiText,
  onIndexEverything,
  onImportFiles,
  onImportFolder,
}: PhotoEmptyLibraryStateProps) {
  return (
    <div className="empty">
      <ImageIcon size={24} />
      <strong>{uiText("No photos here yet")}</strong>
      <span>{uiText("Add specific photos or a folder. You can also ask Vintrace to find photos across this computer.")}</span>
      <div className="photo-empty-actions">
        <button type="button" className="primary compact-action photo-empty-primary" onClick={onImportFiles} disabled={busy || importingPhotos}>
          <FolderInput size={14} />
          <span>{importingPhotos ? uiText("Importing") : uiText("Import photos")}</span>
        </button>
        <button type="button" className="secondary compact-action" onClick={onImportFolder} disabled={busy || importingPhotos}>
          <Folder size={14} />
          <span>{uiText("Import folder")}</span>
        </button>
      </div>
      <button type="button" className="ghost compact-action photo-empty-index-all" onClick={onIndexEverything} disabled={busy || importingPhotos || indexEverythingRunning}>
        <Sparkles size={16} />
        <span>{indexEverythingRunning ? uiText("Finding photos") : uiText("Find photos on this computer")}</span>
      </button>
    </div>
  );
}
