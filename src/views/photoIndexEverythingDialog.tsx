import { EyeOff, Folder, FolderPlus, HardDrive, Images, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import type { SystemPhotoSource } from "../types";

type PhotoIndexEverythingDialogText = (value: string) => string;

export type PhotoIndexEverythingDialogProps = {
  source: SystemPhotoSource;
  detectedDriveSources: SystemPhotoSource[];
  extraPaths: string[];
  hideNoise: boolean;
  busy: boolean;
  running: boolean;
  importError: string;
  uiText: PhotoIndexEverythingDialogText;
  fileName: (path: string) => string;
  onCancel: () => void;
  onRun: () => void;
  onAddFolder: () => void;
  onAddDrive: (path: string) => void;
  onRemoveExtraPath: (path: string) => void;
  onHideNoiseChange: (value: boolean) => void;
};

export function PhotoIndexEverythingDialog(props: PhotoIndexEverythingDialogProps) {
  const visibleDriveSources = props.detectedDriveSources.filter((drive) => !props.extraPaths.includes(drive.path));
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => { if (!props.running) props.onCancel(); }}
    >
      <div
        className="consent-sheet index-everything-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.uiText("Index all photos on this computer")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="index-everything-hero" aria-hidden="true"><Images size={26} /></div>
        <strong>{props.uiText("Index all photos on this computer")}</strong>
        <p className="compact">{props.uiText("Vintrace will read image files across your Home folder and build one library you can browse, search, and organize. It skips caches, app data, and system files.")}</p>
        <ul className="index-everything-points">
          <li><ShieldCheck size={15} aria-hidden="true" /><span>{props.uiText("Everything stays on your device — nothing is uploaded.")}</span></li>
          <li><Folder size={15} aria-hidden="true" /><span>{props.uiText("Originals are referenced in place — no copies and no moving your files.")}</span></li>
          <li><EyeOff size={15} aria-hidden="true" /><span>{props.uiText("Hide categories like screenshots or utilities, or remove the whole library anytime.")}</span></li>
        </ul>
        <div className="index-everything-scope">
          <span className="index-everything-scope-label">{props.uiText("Where to look")}</span>
          <div className="index-everything-scope-chips">
            <span className="index-everything-scope-chip base" title={props.source.path}>
              <Images size={13} aria-hidden="true" /><span>{props.uiText("Home folder")}</span>
            </span>
            {props.extraPaths.map((extraPath) => (
              <span className="index-everything-scope-chip" key={extraPath}>
                <Folder size={13} aria-hidden="true" />
                <span title={extraPath}>{props.fileName(extraPath) || extraPath}</span>
                <button
                  type="button"
                  className="index-everything-scope-remove"
                  aria-label={`${props.uiText("Remove")} ${extraPath}`}
                  onClick={() => props.onRemoveExtraPath(extraPath)}
                  disabled={props.running}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {visibleDriveSources.map((drive) => (
              <button
                type="button"
                className="index-everything-drive"
                key={drive.path}
                title={drive.path}
                onClick={() => props.onAddDrive(drive.path)}
                disabled={props.running}
              >
                <HardDrive size={13} aria-hidden="true" /><span>{props.uiText(drive.label)}</span>
              </button>
            ))}
            <button type="button" className="index-everything-add" onClick={props.onAddFolder} disabled={props.running}>
              <FolderPlus size={13} aria-hidden="true" /><span>{props.uiText("Add folder or drive")}</span>
            </button>
          </div>
        </div>
        <label className="index-everything-hide">
          <input
            type="checkbox"
            checked={props.hideNoise}
            onChange={(event) => props.onHideNoiseChange(event.currentTarget.checked)}
            disabled={props.running}
          />
          <span>
            <strong>{props.uiText("Hide screenshots and utility images")}</strong>
            <small>{props.uiText("Keeps the Library focused on real photos — show them anytime from the rail.")}</small>
          </span>
        </label>
        {props.importError && <small className="photo-metadata-error" role="alert">{props.importError}</small>}
        <div className="index-everything-actions">
          <button type="button" className="ghost compact-action" onClick={props.onCancel} disabled={props.running}>
            <X size={15} /><span>{props.uiText("Cancel")}</span>
          </button>
          <button type="button" className="primary" onClick={props.onRun} disabled={props.running || props.busy}>
            {props.running ? <RefreshCcw size={16} className="spin" /> : <Sparkles size={16} />}
            <span>{props.running ? props.uiText("Indexing your photos…") : props.uiText("Index my photos")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
