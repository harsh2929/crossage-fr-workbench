import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import type { PhotoItem } from "../types";

type PhotoLightboxSafetyActionsProps = {
  item: PhotoItem;
  savingMetadata: boolean;
  uiText: (value: string) => string;
  onRestore: (item: PhotoItem) => unknown;
  onPermanentlyDelete: (item: PhotoItem) => unknown;
  onHide: (item: PhotoItem, hidden: boolean) => unknown;
  onDelete: (item: PhotoItem) => unknown;
};

export function PhotoLightboxSafetyActions({
  item,
  savingMetadata,
  uiText,
  onRestore,
  onPermanentlyDelete,
  onHide,
  onDelete,
}: PhotoLightboxSafetyActionsProps) {
  return (
    <div className="photos-lightbox-safety-actions">
      {item.deletedAt ? (
        <>
          <button type="button" className="secondary compact-action" onClick={() => void onRestore(item)} disabled={savingMetadata}>
            <RotateCcw size={16} />
            <span>{uiText("Restore")}</span>
          </button>
          <button type="button" className="secondary compact-action danger" onClick={() => void onPermanentlyDelete(item)} disabled={savingMetadata}>
            <Trash2 size={16} />
            <span>{uiText("Delete permanently")}</span>
          </button>
        </>
      ) : (
        <>
          <button type="button" className="secondary compact-action" onClick={() => void onHide(item, !item.hidden)} disabled={savingMetadata}>
            {item.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>{item.hidden ? uiText("Unhide") : uiText("Hide")}</span>
          </button>
          <button type="button" className="secondary compact-action danger" onClick={() => void onDelete(item)} disabled={savingMetadata}>
            <Trash2 size={16} />
            <span>{uiText("Delete")}</span>
          </button>
        </>
      )}
    </div>
  );
}
