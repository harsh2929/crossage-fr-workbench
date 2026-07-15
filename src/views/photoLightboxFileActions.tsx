import { ExternalLink, FolderInput, ImageIcon, Printer } from "lucide-react";
import type { PhotoItem } from "../types";

type PhotoLightboxFileActionsProps = {
  item: PhotoItem;
  missing: boolean;
  busy: boolean;
  photoConsolidating: boolean;
  preferredExternalEditorPath: string;
  uiText: (value: string) => string;
  onRevealPath: (path: string) => unknown;
  onOpenPath: (path: string) => unknown;
  onPrintPath: (path: string) => unknown;
  onOpenWithEditor: (path: string, source: string, editorPath?: string) => unknown;
  onConsolidate: (sourcePaths: string[]) => unknown;
};

export function PhotoLightboxFileActions({
  item,
  missing,
  busy,
  photoConsolidating,
  preferredExternalEditorPath,
  uiText,
  onRevealPath,
  onOpenPath,
  onPrintPath,
  onOpenWithEditor,
  onConsolidate,
}: PhotoLightboxFileActionsProps) {
  const canConsolidate = !missing
    && String(item.sourceKind || "").toLowerCase() !== "managed"
    && !item.deletedAt;

  return (
    <div className="photos-lightbox-file-actions">
      <button type="button" className="secondary compact-action" onClick={() => void onRevealPath(item.sourcePath)} disabled={missing}>
        <FolderInput size={16} />
        <span>{uiText("Reveal original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={() => void onOpenPath(item.sourcePath)} disabled={missing}>
        <ImageIcon size={16} />
        <span>{uiText("Open original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={() => void onPrintPath(item.sourcePath)} disabled={missing}>
        <Printer size={16} />
        <span>{uiText("Print original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={() => void onOpenWithEditor(item.sourcePath, "photos-lightbox")} disabled={missing}>
        <ExternalLink size={16} />
        <span>{uiText("Open with...")}</span>
      </button>
      {preferredExternalEditorPath && (
        <button type="button" className="secondary compact-action" onClick={() => void onOpenWithEditor(item.sourcePath, "photos-lightbox", preferredExternalEditorPath)} disabled={missing}>
          <ExternalLink size={16} />
          <span>{uiText("Open with last")}</span>
        </button>
      )}
      {canConsolidate && (
        <button type="button" className="secondary compact-action" onClick={() => void onConsolidate([item.sourcePath])} disabled={photoConsolidating || busy}>
          <FolderInput size={16} />
          <span>{photoConsolidating ? uiText("Consolidating") : uiText("Consolidate")}</span>
        </button>
      )}
    </div>
  );
}
