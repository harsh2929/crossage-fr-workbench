import { AlertTriangle, Check, ImageIcon, Layers, RotateCcw } from "lucide-react";
import type { PhotoItem } from "../types";
import type { PhotoBurstStack, PhotoBurstStackItem } from "./photoBurstStacks";

export type PhotoLightboxBurstFrameRow = {
  sourcePath: string;
  index: number;
  stackItem: PhotoBurstStackItem;
  item: PhotoItem | null;
  imageUrl: string;
  title: string;
  active: boolean;
  saving: boolean;
};

type PhotoLightboxBurstStripProps = {
  stack: PhotoBurstStack;
  rows: PhotoLightboxBurstFrameRow[];
  activeRow: PhotoLightboxBurstFrameRow | null;
  loading: boolean;
  savingId: string;
  error: string;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onSelectFrame: (sourcePath: string) => void;
  onSetKeeper: (stack: PhotoBurstStack, item: PhotoBurstStackItem) => void | Promise<void>;
  onClearKeeper: (stack: PhotoBurstStack) => void | Promise<void>;
  onSelectStack: (stack: PhotoBurstStack) => void;
};

export function PhotoLightboxBurstStrip({
  stack,
  rows,
  activeRow,
  loading,
  savingId,
  error,
  uiText,
  formatCount,
  onSelectFrame,
  onSetKeeper,
  onClearKeeper,
  onSelectStack,
}: PhotoLightboxBurstStripProps) {
  const clearing = savingId === `${stack.stackId}:clear`;

  return (
    <div className="photos-lightbox-burst-strip" onClick={(event) => event.stopPropagation()}>
      <div className="photos-lightbox-burst-head">
        <span>
          <Layers size={15} />
          <strong>{stack.name || uiText("Burst")}</strong>
        </span>
        <small>
          {formatCount(Math.max(stack.count, rows.length))} {uiText("frames")}
          {stack.keeperCount ? ` · ${formatCount(stack.keeperCount)} ${uiText("keeper")}` : ""}
          {loading ? ` · ${uiText("Loading")}` : ""}
        </small>
      </div>
      <div className="photos-lightbox-burst-frames" aria-label={uiText("Burst frames")}>
        {rows.map((row) => (
          <button
            key={row.sourcePath}
            type="button"
            className={[
              row.active ? "active" : "",
              row.stackItem.keeper ? "keeper" : "",
              row.stackItem.coverHint ? "cover" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onSelectFrame(row.sourcePath)}
            disabled={!row.item}
            aria-pressed={row.active}
            aria-label={`${uiText("Open burst frame")} ${formatCount(row.index + 1)}: ${row.title}`}
            title={row.sourcePath}
          >
            <span>
              {row.imageUrl ? (
                <img src={row.imageUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                row.item?.missingAt ? <AlertTriangle size={18} /> : <ImageIcon size={18} />
              )}
            </span>
            <small>
              {row.stackItem.keeper ? uiText("Keeper") : row.stackItem.coverHint ? uiText("Cover") : `${uiText("Frame")} ${formatCount(row.index + 1)}`}
            </small>
          </button>
        ))}
      </div>
      <div className="photos-lightbox-burst-actions">
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => {
            if (activeRow) void onSetKeeper(stack, activeRow.stackItem);
          }}
          disabled={!activeRow || activeRow.saving || clearing}
          title={uiText("Use current frame as the burst keeper")}
        >
          <Check size={14} />
          <span>{activeRow?.saving ? uiText("Saving") : uiText("Set keeper")}</span>
        </button>
        {stack.keeperCount > 0 && (
          <button
            type="button"
            className="ghost compact-action"
            onClick={() => void onClearKeeper(stack)}
            disabled={clearing}
            title={uiText("Clear burst keeper selection")}
          >
            <RotateCcw size={14} />
            <span>{clearing ? uiText("Clearing") : uiText("Clear keeper")}</span>
          </button>
        )}
        <button
          type="button"
          className="ghost compact-action"
          onClick={() => onSelectStack(stack)}
          title={uiText("Select all frames in this burst")}
        >
          <Layers size={14} />
          <span>{uiText("Select stack")}</span>
        </button>
      </div>
      {error && <small className="photos-lightbox-burst-error">{error}</small>}
    </div>
  );
}
