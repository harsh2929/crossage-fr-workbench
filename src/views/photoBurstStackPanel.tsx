import { Check, ImageIcon, Images, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";

import type { PhotoBurstStack, PhotoBurstStackItem, PhotoCullingReason, PhotoCullingStatus } from "./photoBurstStacks";
import { photoFileName } from "./photoDisplayText";

type PhotoBurstStackPanelText = (value: string) => string;
type PhotoBurstStackPanelCount = (value: number) => string;
type PhotoBurstStackPanelAction = void | Promise<void>;

export type PhotoBurstStackPanelProps = {
  stacks: readonly PhotoBurstStack[];
  loading: boolean;
  error: string;
  busy: boolean;
  savingId: string;
  cullingStatus: PhotoCullingStatus | null;
  cullingAnalyzingId: string;
  cullingApplyingId: string;
  uiText: PhotoBurstStackPanelText;
  formatCount: PhotoBurstStackPanelCount;
  imageUrlForItem: (item: PhotoBurstStackItem) => string;
  onRefresh: () => PhotoBurstStackPanelAction;
  onSelectStack: (stack: PhotoBurstStack) => void;
  onClearKeeper: (stack: PhotoBurstStack) => PhotoBurstStackPanelAction;
  onSetKeeper: (stack: PhotoBurstStack, item: PhotoBurstStackItem) => PhotoBurstStackPanelAction;
  onAnalyzeCulling: (stack: PhotoBurstStack) => PhotoBurstStackPanelAction;
  onApplyCulling: (stack: PhotoBurstStack) => PhotoBurstStackPanelAction;
};

const CULLING_REASON_LABELS: Record<string, string> = {
  "top-overall": "Top overall",
  "sharpest-in-burst": "Sharpest in burst",
  "soft-focus": "Soft focus",
  "usable-sharpness": "Usable sharpness",
  "motion-clear": "Motion clear",
  "motion-blur-risk": "Motion blur risk",
  "moderate-motion-clarity": "Moderate motion clarity",
  "faces-high-quality": "High face quality",
  "faces-low-quality": "Low face quality",
  "eyes-likely-open": "Eyes likely open",
  "eyes-uncertain": "Eye state uncertain",
  "face-signals-consent-required": "Face signals require consent",
  "no-face-signals": "No face signals",
};

const CULLING_CONFIDENCE_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function cullingReasonLabel(reason: PhotoCullingReason, uiText: PhotoBurstStackPanelText): string {
  return uiText(CULLING_REASON_LABELS[reason.code] || reason.code.replace(/-/g, " "));
}

function scorePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`;
}

export function PhotoBurstStackPanel(props: PhotoBurstStackPanelProps) {
  return (
    <section className="photo-burst-stack-panel" aria-label={props.uiText("Burst stacks")}>
      <div className="photo-burst-stack-head">
        <span>
          <Images size={15} />
          <strong>{props.uiText("Burst stacks")}</strong>
          <small>
            {props.loading
              ? props.uiText("Loading")
              : `${props.formatCount(props.stacks.length)} ${props.stacks.length === 1 ? props.uiText("stack") : props.uiText("stacks")}`}
          </small>
          {props.cullingStatus && (
            <small className="photo-culling-status" title={props.cullingStatus.faceSignalsReason || undefined}>
              <ShieldCheck size={11} />
              {props.cullingStatus.available
                ? <>
                    {props.uiText("Review only")} · {props.uiText("Local")} · {props.cullingStatus.faceSignalsAllowed
                      ? props.uiText("Face signals enabled")
                      : props.uiText("Sharpness and motion only")}
                  </>
                : props.uiText("Assisted culling unavailable")}
            </small>
          )}
        </span>
        <button type="button" className="ghost compact-action" onClick={() => void props.onRefresh()} disabled={props.busy || props.loading || Boolean(props.savingId)}>
          <RefreshCcw size={14} />
          <span>{props.uiText("Refresh")}</span>
        </button>
      </div>
      {props.error && <p className="photo-album-item-error">{props.error}</p>}
      {props.loading ? (
        <small>{props.uiText("Loading burst stacks...")}</small>
      ) : props.stacks.length ? (
        <div className="photo-burst-stack-list">
          {props.stacks.map((stack) => {
            const stackBusy = Boolean(props.savingId && props.savingId.startsWith(`${stack.stackId}:`));
            const analyzing = props.cullingAnalyzingId === stack.stackId;
            const applying = props.cullingApplyingId === stack.stackId;
            const cullingByAssetId = new Map((stack.culling?.frames || []).map((frame) => [frame.assetId, frame]));
            const recommended = stack.items.find((item) => item.assetId === stack.culling?.recommendedAssetId);
            const keeperLabel = stack.keeperCount
              ? `${props.formatCount(stack.keeperCount)} ${stack.keeperCount === 1 ? props.uiText("keeper") : props.uiText("keepers")}`
              : props.uiText("No keeper");
            return (
              <article key={stack.stackId} className="photo-burst-stack-card">
                <div className="photo-burst-stack-card-head">
                  <span>
                    <strong>{stack.name || props.uiText("Burst")}</strong>
                    <small>{props.formatCount(stack.count)} {stack.count === 1 ? props.uiText("frame") : props.uiText("frames")} · {keeperLabel}</small>
                  </span>
                  <div className="photo-burst-stack-actions">
                    <button type="button" className="secondary compact-action" onClick={() => props.onSelectStack(stack)} disabled={!stack.sourcePaths.length || props.busy}>
                      <Check size={14} />
                      <span>{props.uiText("Select stack")}</span>
                    </button>
                    <button type="button" className="secondary compact-action" onClick={() => void props.onAnalyzeCulling(stack)} disabled={props.busy || stackBusy || analyzing || applying || !props.cullingStatus?.available}>
                      {analyzing ? <RefreshCcw size={14} className="spin" /> : <Sparkles size={14} />}
                      <span>{analyzing ? props.uiText("Analyzing") : stack.culling ? props.uiText("Reanalyze") : props.uiText("Analyze burst")}</span>
                    </button>
                    {stack.culling && (
                      <button type="button" className="primary compact-action" onClick={() => void props.onApplyCulling(stack)} disabled={props.busy || stackBusy || analyzing || applying}>
                        {applying ? <RefreshCcw size={14} className="spin" /> : <Check size={14} />}
                        <span>{applying ? props.uiText("Applying") : props.uiText("Use recommendation")}</span>
                      </button>
                    )}
                    <button type="button" className="ghost compact-action" onClick={() => void props.onClearKeeper(stack)} disabled={!stack.keeperCount || props.busy || stackBusy}>
                      <X size={14} />
                      <span>{props.savingId === `${stack.stackId}:clear` ? props.uiText("Clearing") : props.uiText("Clear keepers")}</span>
                    </button>
                  </div>
                </div>
                {stack.culling && recommended && (
                  <div className="photo-culling-recommendation">
                    <span><Sparkles size={13} /> <strong>{props.uiText("Recommended")}</strong>: {recommended.title || photoFileName(recommended.sourcePath)}</span>
                    <small>
                      {scorePercent(stack.culling.recommendationScore)} · {props.uiText(CULLING_CONFIDENCE_LABELS[stack.culling.recommendationConfidence])}
                    </small>
                  </div>
                )}
                <div className={`photo-burst-frame-list${stack.culling ? " has-culling" : ""}`}>
                  {stack.items.map((item, index) => {
                    const imageUrl = props.imageUrlForItem(item);
                    const cullingFrame = cullingByAssetId.get(item.assetId);
                    const itemSavingId = `${stack.stackId}:${item.sourcePath}`;
                    const saving = props.savingId === itemSavingId;
                    return (
                      <button
                        key={item.sourcePath}
                        type="button"
                        className={[
                          "photo-burst-frame",
                          item.keeper ? "keeper" : "",
                          cullingFrame?.recommended ? "recommended" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => void props.onSetKeeper(stack, item)}
                        disabled={props.busy || stackBusy}
                        aria-pressed={item.keeper}
                        title={item.sourcePath}
                      >
                        <span className="photo-burst-frame-thumb">
                          {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={18} />}
                          {item.keeper && <small>{props.uiText("Keep")}</small>}
                          {cullingFrame?.recommended && (
                            <small className="photo-culling-recommended-badge" aria-label={props.uiText("Recommended")} title={props.uiText("Recommended")}>
                              <Sparkles size={10} />
                            </small>
                          )}
                        </span>
                        <span className="photo-burst-frame-copy">
                          <strong>{item.title || photoFileName(item.sourcePath)}</strong>
                          <small>
                            {props.uiText("Frame")} {props.formatCount(item.sequence || index + 1)}
                            {cullingFrame ? ` · ${props.uiText("Score")} ${scorePercent(cullingFrame.score)}` : ""}
                            {saving ? ` · ${props.uiText("Saving")}` : ""}
                          </small>
                          {cullingFrame && (
                            <span className="photo-culling-reasons">
                              {cullingFrame.reasons.map((reason) => (
                                <small className={`photo-culling-reason ${reason.impact}`} key={`${reason.code}:${reason.signal}`}>
                                  {cullingReasonLabel(reason, props.uiText)}
                                </small>
                              ))}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <small>{props.uiText("No burst stacks found.")}</small>
      )}
    </section>
  );
}
