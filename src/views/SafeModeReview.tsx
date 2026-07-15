import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Lock, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { PhotoLibrarySettingsValue, PhotoSensitiveAuthResult, PhotoSensitiveAuthStatus } from "../types";
import {
  PHOTO_LOCAL_SETTINGS_KEY,
  normalizePhotoLocalSettings,
  photoSensitivePasscodeConfigured,
  verifyPhotoSensitivePasscode,
  type PhotoLocalSettings,
} from "./photoSettings";
import { formatDetectionLabel } from "./safetyOverlay";
import { sensitiveUnlockRequirements } from "./sensitiveCollections";

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
  categoryScores?: Record<string, number>;
}

const SAFE_MODE_CATEGORY_LABELS: Record<string, string> = {
  sexually_explicit: "Sexually explicit",
  violence_gore: "Violence or gore",
  dangerous_activity: "Dangerous activity",
  self_harm: "Self-harm",
};

interface SafeModeReviewProps {
  open: boolean;
  onClose: () => void;
  invoke: <T>(command: string, params?: Record<string, unknown>) => Promise<T>;
  getSensitiveAuthStatus?: () => Promise<PhotoSensitiveAuthStatus | null>;
  authenticateSensitiveAccess?: (reason: string) => Promise<PhotoSensitiveAuthResult | null>;
  uiText?: (source: string) => string;
}

function readStoredPhotoLocalSettings(): PhotoLocalSettings {
  if (typeof window === "undefined") return normalizePhotoLocalSettings({});
  try {
    const raw = window.localStorage.getItem(PHOTO_LOCAL_SETTINGS_KEY);
    return normalizePhotoLocalSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizePhotoLocalSettings({});
  }
}

function settingsFromLibraryValue(value: PhotoLibrarySettingsValue | null | undefined): PhotoLocalSettings {
  if (value?.localSettingsPersisted && value.localSettings && typeof value.localSettings === "object") {
    return normalizePhotoLocalSettings(value.localSettings);
  }
  return readStoredPhotoLocalSettings();
}

const SAFE_REVIEW_PAGE_SIZE = 60;

// A batch-triage dashboard over every photo Safe Mode flagged, with the classifier's
// score/reason and a per-item keep/override that writes through set_photo_safe_mode_override.
// The flag is otherwise invisible in the UI; this is the only place to correct it.
export default function SafeModeReview({
  open,
  onClose,
  invoke,
  getSensitiveAuthStatus,
  authenticateSensitiveAccess,
  uiText = (source: string) => source,
}: SafeModeReviewProps) {
  const [items, setItems] = useState<SafeModeFlaggedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState("");
  const [explainById, setExplainById] = useState<Record<string, ExplainState>>({});
  const [settings, setSettings] = useState<PhotoLocalSettings>(() => readStoredPhotoLocalSettings());
  const [unlocked, setUnlocked] = useState(false);
  const [unlockPasscode, setUnlockPasscode] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [authStatus, setAuthStatus] = useState<PhotoSensitiveAuthStatus | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const reviewLocked = Boolean(settings.lockSensitiveCollections && !unlocked);
  const passcodeConfigured = photoSensitivePasscodeConfigured(settings);
  const hasMore = items.length < total;

  const loadPage = useCallback(async (offset = 0, append = false) => {
    if (settings.lockSensitiveCollections && !unlocked) return;
    setLoading(true);
    setError("");
    try {
      const res = await invoke<{ items?: SafeModeFlaggedItem[]; total?: number }>("list_safe_mode_flagged", {
        limit: SAFE_REVIEW_PAGE_SIZE,
        offset,
        previewBudget: 24,
      });
      const nextItems = Array.isArray(res?.items) ? res.items : [];
      setItems((prev) => append ? [...prev, ...nextItems] : nextItems);
      setTotal(Number(res?.total) || 0);
      setNextOffset(offset + nextItems.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (!append) {
        setItems([]);
        setTotal(0);
        setNextOffset(0);
      }
    } finally {
      setLoading(false);
    }
  }, [invoke, settings.lockSensitiveCollections, unlocked]);

  const loadSettings = useCallback(async () => {
    const localSettings = readStoredPhotoLocalSettings();
    setSettings(localSettings);
    setUnlocked(false);
    setUnlockPasscode("");
    setUnlockError("");
    try {
      const res = await invoke<{ value?: PhotoLibrarySettingsValue }>("photo_library_settings", {});
      const next = settingsFromLibraryValue(res?.value);
      setSettings(next);
      setUnlocked(!next.lockSensitiveCollections);
      if (res?.value?.localSettingsPersisted && typeof window !== "undefined") {
        window.localStorage.setItem(PHOTO_LOCAL_SETTINGS_KEY, JSON.stringify(next));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [invoke]);

  useEffect(() => {
    if (!open) return;
    setRevealed(new Set());
    setExplainById({});
    setItems([]);
    setTotal(0);
    setNextOffset(0);
    void loadSettings();
  }, [open, loadSettings]);

  useEffect(() => {
    if (!open || reviewLocked) return;
    setItems([]);
    setTotal(0);
    setNextOffset(0);
    void loadPage(0, false);
  }, [open, reviewLocked, loadPage]);

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

  async function unlockReview() {
    setUnlocking(true);
    setUnlockError("");
    try {
      let verifiedWithDevice = false;
      const firstRequirements = sensitiveUnlockRequirements(settings, {
        passcodeProvided: Boolean(unlockPasscode),
        verifiedWithDevice,
        passcodeConfigured,
      });
      if (firstRequirements.deviceAuthRequired) {
        if (!authenticateSensitiveAccess) {
          setUnlockError(uiText("Device authentication is not available in this build."));
          return;
        }
        const status = authStatus?.available ? authStatus : (getSensitiveAuthStatus ? await getSensitiveAuthStatus() : null);
        if (status) setAuthStatus(status);
        if (!status?.available) {
          setUnlockError(status?.reason || uiText("Device authentication is not available on this computer."));
          return;
        }
        const result = await authenticateSensitiveAccess(uiText("Unlock Safe Mode review in Vintrace."));
        setAuthStatus(result || status);
        if (!result?.ok) {
          setUnlockError(result?.error || result?.reason || uiText("Device authentication did not complete."));
          return;
        }
        verifiedWithDevice = true;
      }
      const secondRequirements = sensitiveUnlockRequirements(settings, {
        passcodeProvided: Boolean(unlockPasscode),
        verifiedWithDevice,
        passcodeConfigured,
      });
      if (secondRequirements.passcodeRequired) {
        if (!unlockPasscode) {
          setUnlockError(uiText("Enter the sensitive collection passcode."));
          return;
        }
        const verified = await verifyPhotoSensitivePasscode(settings, unlockPasscode);
        if (!verified) {
          setUnlockError(uiText("Passcode did not match."));
          return;
        }
      }
      setUnlocked(true);
      setUnlockPasscode("");
      setUnlockError("");
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlocking(false);
    }
  }

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
    <div className="safe-review-overlay" role="dialog" aria-modal="true" aria-label={uiText("Review flagged photos")} onClick={onClose}>
      <div className="safe-review-panel" onClick={(event) => event.stopPropagation()}>
        <header className="safe-review-head">
          <h2>
            <ShieldAlert size={18} aria-hidden="true" /> {uiText("Review flagged photos")}
          </h2>
          <span className="safe-review-count">{total} {uiText("flagged")}</span>
          <button type="button" className="ghost compact-action safe-review-close" onClick={onClose} aria-label={uiText("Close review")}>
            <X size={18} />
          </button>
        </header>
        <p className="muted safe-review-sub">
          {uiText("Safe Mode flagged these on-device. Mark a false positive “Not sensitive”, or keep it hidden — your choice overrides the classifier and stays local.")}
        </p>
        {error && <p className="safe-review-error" role="alert">{error}</p>}
        {reviewLocked ? (
          <section className="safe-review-lock" aria-label={uiText("Safe Mode review locked")}>
            <span className="photo-sensitive-lock-icon"><Lock size={20} aria-hidden="true" /></span>
            <div>
              <strong>{uiText("Review is locked")}</strong>
              <p className="muted">
                {uiText("Unlock the sensitive collection session before showing flagged photos or classifier details.")}
              </p>
              {passcodeConfigured && (
                <input
                  type="password"
                  value={unlockPasscode}
                  onChange={(event) => setUnlockPasscode(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void unlockReview();
                  }}
                  placeholder={uiText("Sensitive passcode")}
                  aria-label={uiText("Sensitive collection passcode")}
                />
              )}
              <button type="button" className="secondary compact-action" onClick={() => void unlockReview()} disabled={unlocking}>
                <Lock size={14} />
                <span>{unlocking ? uiText("Unlocking...") : uiText("Unlock review")}</span>
              </button>
              {unlockError && <small className="photo-inline-status" role="alert">{unlockError}</small>}
            </div>
          </section>
        ) : loading && items.length === 0 ? (
          <p className="muted safe-review-empty">{uiText("Loading...")}</p>
        ) : items.length === 0 ? (
          <p className="muted safe-review-empty">{uiText("Nothing flagged — Safe Mode hasn’t marked any indexed photo as sensitive.")}</p>
        ) : (
          <>
            <div className="safe-review-grid">
              {items.map((item) => {
                const isRevealed = revealed.has(item.assetId);
                const busy = busyId === item.assetId;
                return (
                  <figure key={item.assetId} className={`safe-review-card ${item.effectiveSensitive ? "is-sensitive" : "is-cleared"}`}>
                    <div className="safe-review-thumb">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt="" draggable={false} loading="lazy" decoding="async" className={isRevealed ? "" : "blurred"} />
                      ) : (
                        <div className="safe-review-noimg" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="safe-review-reveal"
                        onClick={() => toggleReveal(item.assetId)}
                        aria-pressed={isRevealed}
                        title={isRevealed ? uiText("Hide") : uiText("Reveal")}
                      >
                        {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <span className="safe-review-score" title={`${uiText("Score")} ${item.score.toFixed(3)} · ${item.modelName || uiText("classifier")}`}>
                        {Math.round(item.score * 100)}%
                      </span>
                      {item.override !== null && (
                        <span className={`safe-review-badge ${item.override ? "kept" : "allowed"}`}>
                          {item.override ? uiText("kept hidden") : uiText("allowed")}
                        </span>
                      )}
                    </div>
                    <figcaption>
                      <span className="safe-review-name" title={item.sourcePath}>{item.name || item.sourcePath}</span>
                      {item.reason && <span className="safe-review-reason">{item.reason}</span>}
                      {item.categoryScores && Object.keys(item.categoryScores).length > 0 && (
                        <div className="safe-review-chips" aria-label={uiText("Policy category scores")}>
                          {Object.entries(item.categoryScores)
                            .sort((left, right) => Number(right[1]) - Number(left[1]))
                            .map(([category, score]) => (
                              <span key={category} className="safe-review-chip" title={`${Number(score).toFixed(3)}`}>
                                {uiText(SAFE_MODE_CATEGORY_LABELS[category] || category.replace(/_/g, " "))} {Math.round(Number(score) * 100)}%
                              </span>
                            ))}
                        </div>
                      )}
                      {(() => {
                        const ex = explainById[item.assetId];
                        if (!ex) {
                          return (
                            <button type="button" className="ghost compact-action safe-review-why" onClick={() => void explainItem(item)}>
                              <ShieldAlert size={13} /> {uiText("Why flagged?")}
                            </button>
                          );
                        }
                        if (ex.loading) return <span className="safe-review-explain-note">{uiText("Analyzing...")}</span>;
                        if (!ex.available) return <span className="safe-review-explain-note">{uiText("No explainer model — install one in Settings.")}</span>;
                        if (ex.detections.length === 0) return <span className="safe-review-explain-note">{uiText("No specific regions detected.")}</span>;
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
                          <Check size={14} /> {uiText("Not sensitive")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={item.override === true ? "compact-action is-active" : "secondary compact-action"}
                          onClick={() => setOverride(item, true)}
                        >
                          <ShieldAlert size={14} /> {uiText("Keep hidden")}
                        </button>
                        {item.override !== null && (
                          <button type="button" disabled={busy} className="ghost compact-action" onClick={() => setOverride(item, null)} title={uiText("Clear override (use the classifier)")}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            {hasMore && (
              <div className="safe-review-footer">
                <span className="muted">{items.length} {uiText("of")} {total} {uiText("shown")}</span>
                <button type="button" className="secondary compact-action" disabled={loading} onClick={() => void loadPage(nextOffset, true)}>
                  {loading ? uiText("Loading...") : uiText("Load more")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
