import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, RotateCcw, ShieldAlert, X } from "lucide-react";
import { formatDetectionLabel } from "./safetyOverlay";

interface ExplainState {
  loading: boolean;
  available: boolean;
  detections: { label: string; score: number }[];
  reason: string;
}

// One flagged item from the `list_safe_mode_flagged` command. previewUrl/sourceUrl
// are decorated by the Electron main process (granted vintrace-media:// URLs).
export interface SafeModeFlaggedItem {
  assetId: string;
  sourcePath: string;
  previewUrl?: string;
  sourceUrl?: string;
  name?: string;
  storedSensitive: boolean;
  override: boolean | null;
  effectiveSensitive: boolean;
  score: number;
  reason: string;
  modelName: string;
}

interface SafeModeReviewProps {
  open: boolean;
  onClose: () => void;
  invoke: <T>(command: string, params?: Record<string, unknown>) => Promise<T>;
}

// A batch-triage dashboard over every photo Safe Mode flagged, with the classifier's
// score/reason and a per-item keep/override that writes through set_photo_safe_mode_override.
// The flag is otherwise invisible in the UI; this is the only place to correct it.
export default function SafeModeReview({ open, onClose, invoke }: SafeModeReviewProps) {
  const [items, setItems] = useState<SafeModeFlaggedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState("");
  const [explainById, setExplainById] = useState<Record<string, ExplainState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await invoke<{ items?: SafeModeFlaggedItem[]; total?: number }>("list_safe_mode_flagged", { limit: 500, offset: 0 });
      setItems(Array.isArray(res?.items) ? res.items : []);
      setTotal(Number(res?.total) || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => {
    if (!open) return;
    setRevealed(new Set());
    setExplainById({});
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggleReveal = (assetId: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });

  async function setOverride(item: SafeModeFlaggedItem, value: boolean | null) {
    setBusyId(item.assetId);
    try {
      await invoke("set_photo_safe_mode_override", {
        assetId: item.assetId,
        sensitive: value === null ? "clear" : value,
      });
      setItems((prev) =>
        prev.map((it) =>
          it.assetId === item.assetId
            ? { ...it, override: value, effectiveSensitive: value === null ? it.storedSensitive : value }
            : it,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  }

  async function explainItem(item: SafeModeFlaggedItem) {
    setExplainById((prev) => ({ ...prev, [item.assetId]: { loading: true, available: false, detections: [], reason: "" } }));
    try {
      const res = await invoke<{ available?: boolean; detections?: { label: string; score: number }[]; reason?: string }>(
        "explain_safety",
        { path: item.sourcePath },
      );
      setExplainById((prev) => ({
        ...prev,
        [item.assetId]: {
          loading: false,
          available: Boolean(res?.available),
          detections: Array.isArray(res?.detections) ? res.detections : [],
          reason: String(res?.reason || ""),
        },
      }));
    } catch (err) {
      setExplainById((prev) => ({
        ...prev,
        [item.assetId]: { loading: false, available: false, detections: [], reason: err instanceof Error ? err.message : String(err) },
      }));
    }
  }

  if (!open) return null;

  return (
    <div className="safe-review-overlay" role="dialog" aria-modal="true" aria-label="Review flagged photos" onClick={onClose}>
      <div className="safe-review-panel" onClick={(event) => event.stopPropagation()}>
        <header className="safe-review-head">
          <h2>
            <ShieldAlert size={18} aria-hidden="true" /> Review flagged photos
          </h2>
          <span className="safe-review-count">{total} flagged</span>
          <button type="button" className="ghost compact-action safe-review-close" onClick={onClose} aria-label="Close review">
            <X size={18} />
          </button>
        </header>
        <p className="muted safe-review-sub">
          Safe Mode flagged these on-device. Mark a false positive “Not sensitive”, or keep it hidden — your choice overrides the classifier and stays local.
        </p>
        {error && <p className="safe-review-error" role="alert">{error}</p>}
        {loading ? (
          <p className="muted safe-review-empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted safe-review-empty">Nothing flagged — Safe Mode hasn’t marked any indexed photo as sensitive.</p>
        ) : (
          <div className="safe-review-grid">
            {items.map((item) => {
              const isRevealed = revealed.has(item.assetId);
              const busy = busyId === item.assetId;
              return (
                <figure key={item.assetId} className={`safe-review-card ${item.effectiveSensitive ? "is-sensitive" : "is-cleared"}`}>
                  <div className="safe-review-thumb">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" draggable={false} className={isRevealed ? "" : "blurred"} />
                    ) : (
                      <div className="safe-review-noimg" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="safe-review-reveal"
                      onClick={() => toggleReveal(item.assetId)}
                      aria-pressed={isRevealed}
                      title={isRevealed ? "Hide" : "Reveal"}
                    >
                      {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <span className="safe-review-score" title={`Score ${item.score.toFixed(3)} · ${item.modelName || "classifier"}`}>
                      {Math.round(item.score * 100)}%
                    </span>
                    {item.override !== null && (
                      <span className={`safe-review-badge ${item.override ? "kept" : "allowed"}`}>
                        {item.override ? "kept hidden" : "allowed"}
                      </span>
                    )}
                  </div>
                  <figcaption>
                    <span className="safe-review-name" title={item.sourcePath}>{item.name || item.sourcePath}</span>
                    {item.reason && <span className="safe-review-reason">{item.reason}</span>}
                    {(() => {
                      const ex = explainById[item.assetId];
                      if (!ex) {
                        return (
                          <button type="button" className="ghost compact-action safe-review-why" onClick={() => void explainItem(item)}>
                            <ShieldAlert size={13} /> Why flagged?
                          </button>
                        );
                      }
                      if (ex.loading) return <span className="safe-review-explain-note">Analyzing…</span>;
                      if (!ex.available) return <span className="safe-review-explain-note">No explainer model — install one in Settings.</span>;
                      if (ex.detections.length === 0) return <span className="safe-review-explain-note">No specific regions detected.</span>;
                      return (
                        <div className="safe-review-chips">
                          {ex.detections.slice(0, 6).map((detection, i) => (
                            <span key={i} className="safe-review-chip">
                              {formatDetectionLabel(detection.label)} {Math.round((detection.score || 0) * 100)}%
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="safe-review-actions">
                      <button
                        type="button"
                        disabled={busy}
                        className={item.override === false ? "compact-action is-active" : "secondary compact-action"}
                        onClick={() => setOverride(item, false)}
                      >
                        <Check size={14} /> Not sensitive
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={item.override === true ? "compact-action is-active" : "secondary compact-action"}
                        onClick={() => setOverride(item, true)}
                      >
                        <ShieldAlert size={14} /> Keep hidden
                      </button>
                      {item.override !== null && (
                        <button type="button" disabled={busy} className="ghost compact-action" onClick={() => setOverride(item, null)} title="Clear override (use the classifier)">
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
