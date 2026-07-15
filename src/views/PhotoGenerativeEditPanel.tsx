import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  Eye,
  Loader2,
  Paintbrush,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

import type {
  PhotoEditStackValue,
  PhotoGenerativeApplyValue,
  PhotoGenerativeMode,
  PhotoGenerativePreviewValue,
  PhotoGenerativeStatus,
} from "../types";
import type { PhotoImageRetouchSpot } from "./photoImageEdits";


const MODES: Array<{ value: PhotoGenerativeMode; label: string }> = [
  { value: "cleanup", label: "Clean Up" },
  { value: "upscale", label: "Upscale" },
  { value: "expand", label: "Expand" },
  { value: "reframe", label: "Reframe" },
  { value: "relight", label: "Relight" },
];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Local generative edit failed.");
}

function idempotencyKey(previewId: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `photo-generative:${previewId}:${random}`;
}

export function PhotoGenerativeEditPanel({
  assetId,
  disabled,
  retouchSpots,
  photoGenerativeStatus,
  installPhotoGenerativePack,
  renderPhotoGenerativePreview,
  applyPhotoGenerativeEdit,
  discardPhotoGenerativePreview,
  onPreviewChange,
  onApplied,
  onError,
  onEditMask,
  uiText,
}: {
  assetId: string;
  disabled: boolean;
  retouchSpots: PhotoImageRetouchSpot[];
  photoGenerativeStatus: (params?: Record<string, unknown>) => Promise<{ value: PhotoGenerativeStatus }>;
  installPhotoGenerativePack: (params: Record<string, unknown>) => Promise<{ value: { installed: boolean; status: PhotoGenerativeStatus } }>;
  renderPhotoGenerativePreview: (params: Record<string, unknown>) => Promise<{ value: PhotoGenerativePreviewValue }>;
  applyPhotoGenerativeEdit: (params: Record<string, unknown>) => Promise<{ value: PhotoGenerativeApplyValue }>;
  discardPhotoGenerativePreview: (params: Record<string, unknown>) => Promise<{ value: { previewId: string; discarded: boolean } }>;
  onPreviewChange: (preview: PhotoGenerativePreviewValue | null) => void;
  onApplied: (stack: PhotoEditStackValue) => void | Promise<void>;
  onError: (message: string) => void;
  onEditMask: () => void;
  uiText: (source: string) => string;
}) {
  const [status, setStatus] = useState<PhotoGenerativeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [mode, setMode] = useState<PhotoGenerativeMode>("cleanup");
  const [scale, setScale] = useState<2 | 4>(2);
  const [aspect, setAspect] = useState("original");
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<PhotoGenerativePreviewValue | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  const [running, setRunning] = useState(false);
  const [installingTier, setInstallingTier] = useState<"" | "light" | "heavy">("");
  const [heavyAcknowledged, setHeavyAcknowledged] = useState(false);
  const previewRef = useRef<PhotoGenerativePreviewValue | null>(null);
  const applyKeyRef = useRef("");

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await photoGenerativeStatus();
      setStatus(result.value);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setStatusLoading(false);
    }
  }, [onError, photoGenerativeStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const stale = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    setShowAfter(true);
    applyKeyRef.current = "";
    onPreviewChange(null);
    if (stale) {
      void discardPhotoGenerativePreview({ previewId: stale.previewId, assetId: stale.assetId });
    }
  }, [assetId, discardPhotoGenerativePreview, onPreviewChange]);

  useEffect(() => () => {
    const stale = previewRef.current;
    if (stale) {
      void discardPhotoGenerativePreview({ previewId: stale.previewId, assetId: stale.assetId });
    }
  }, [discardPhotoGenerativePreview]);

  const modeAvailable = Boolean(status?.modes?.[mode]);
  const contentCredentialsAvailable = status?.contentCredentials?.available !== false;
  const heavyMode = mode === "expand" || mode === "reframe" || mode === "relight";
  const maskRects = retouchSpots.map((spot) => ({
    left: spot.left,
    top: spot.top,
    width: spot.width,
    height: spot.height,
    shape: "ellipse",
  }));
  const canRender = Boolean(
    assetId
    && !disabled
    && !running
    && modeAvailable
    && (mode !== "cleanup" || maskRects.length > 0)
  );

  async function installTier(tier: "light" | "heavy") {
    setInstallingTier(tier);
    onError("");
    try {
      const result = await installPhotoGenerativePack({
        tier,
        acknowledgeLargeDownload: tier === "heavy" ? heavyAcknowledged : false,
      });
      setStatus(result.value.status);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setInstallingTier("");
    }
  }

  async function discardPreview() {
    const current = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    onPreviewChange(null);
    applyKeyRef.current = "";
    if (!current) return;
    try {
      await discardPhotoGenerativePreview({ previewId: current.previewId, assetId: current.assetId });
    } catch (error) {
      onError(errorText(error));
    }
  }

  async function chooseMode(nextMode: PhotoGenerativeMode) {
    if (nextMode === mode) return;
    await discardPreview();
    setMode(nextMode);
  }

  async function generatePreview() {
    if (!canRender) return;
    await discardPreview();
    setRunning(true);
    onError("");
    try {
      const result = await renderPhotoGenerativePreview({
        assetId,
        mode,
        maskRects,
        scale,
        aspect,
        prompt,
        seed: 42,
        steps: 20,
      });
      previewRef.current = result.value;
      setPreview(result.value);
      setShowAfter(true);
      applyKeyRef.current = idempotencyKey(result.value.previewId);
      onPreviewChange(result.value);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setRunning(false);
    }
  }

  async function applyPreview() {
    const current = previewRef.current;
    if (!current || running) return;
    setRunning(true);
    onError("");
    try {
      const result = await applyPhotoGenerativeEdit({
        previewId: current.previewId,
        assetId,
        confirm: true,
        idempotencyKey: applyKeyRef.current || idempotencyKey(current.previewId),
      });
      previewRef.current = null;
      setPreview(null);
      onPreviewChange(null);
      await onApplied(result.value.stack);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="photo-generative-editor" aria-label={uiText("Local AI edits")}>
      <div className="photo-generative-heading">
        <span>
          <WandSparkles size={15} />
          <strong>{uiText("Local AI edits")}</strong>
        </span>
        <span className="photo-generative-local-badge" title={uiText("Runs offline on this computer")}>
          <ShieldCheck size={13} />
          {uiText("Local")}
        </span>
        <span
          className={`photo-generative-local-badge ${contentCredentialsAvailable ? "is-ready" : "is-error"}`}
          title={uiText(contentCredentialsAvailable ? "Workspace-local Content Credentials ready" : "Content Credentials unavailable")}
        >
          {contentCredentialsAvailable ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
          {uiText("Credentials")}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => void refreshStatus()}
          disabled={statusLoading || running}
          aria-label={uiText("Refresh local AI status")}
          title={uiText("Refresh local AI status")}
        >
          <RefreshCcw size={14} />
        </button>
      </div>

      <div className="photo-generative-modes" role="tablist" aria-label={uiText("AI edit mode")}>
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={mode === option.value}
            className={mode === option.value ? "active" : ""}
            onClick={() => void chooseMode(option.value)}
            disabled={running}
          >
            {uiText(option.label)}
          </button>
        ))}
      </div>

      {!statusLoading && !modeAvailable && !heavyMode && (
        <div className="photo-generative-setup-row">
          <span>{uiText("Light AI pack")}</span>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void installTier("light")}
            disabled={Boolean(installingTier) || disabled}
          >
            {installingTier === "light" ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
            <span>{installingTier === "light" ? uiText("Installing") : uiText("Install")}</span>
          </button>
        </div>
      )}

      {!statusLoading && !modeAvailable && heavyMode && (
        <div className="photo-generative-heavy-setup">
          <div className="photo-generative-setup-row">
            <span>{uiText("Heavy AI pack")}</span>
            <button
              type="button"
              className="secondary compact-action"
              onClick={() => void installTier("heavy")}
              disabled={
                Boolean(installingTier)
                || disabled
                || !heavyAcknowledged
                || status?.heavy?.hardwareSupported === false
                || status?.heavy?.platformSupported === false
              }
            >
              {installingTier === "heavy" ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
              <span>{installingTier === "heavy" ? uiText("Installing") : uiText("Install")}</span>
            </button>
          </div>
          <label className="photo-generative-acknowledgement">
            <input
              type="checkbox"
              checked={heavyAcknowledged}
              onChange={(event) => setHeavyAcknowledged(event.currentTarget.checked)}
              disabled={status?.heavy?.hardwareSupported === false || status?.heavy?.platformSupported === false}
            />
            <span>{uiText("I understand this downloads about 23 GB")}</span>
          </label>
          {status?.heavy?.reason && <small role="status">{uiText(status.heavy.reason)}</small>}
        </div>
      )}

      {mode === "cleanup" && modeAvailable && (
        <div className="photo-generative-option-row">
          <button type="button" className="secondary compact-action" onClick={onEditMask} disabled={running}>
            <Paintbrush size={14} />
            <span>{uiText("Mask")}</span>
          </button>
          <strong>{maskRects.length ? `${maskRects.length}` : uiText("None")}</strong>
        </div>
      )}

      {mode === "upscale" && modeAvailable && (
        <div className="photo-generative-scale" role="group" aria-label={uiText("Upscale size")}>
          {[2, 4].map((value) => (
            <button
              key={value}
              type="button"
              className={scale === value ? "active" : ""}
              onClick={() => setScale(value as 2 | 4)}
              disabled={running}
            >
              {value}x
            </button>
          ))}
        </div>
      )}

      {heavyMode && modeAvailable && (
        <div className="photo-generative-heavy-options">
          <label>
            <span>{uiText("Aspect")}</span>
            <select value={aspect} onChange={(event) => setAspect(event.currentTarget.value)} disabled={running}>
              <option value="original">{uiText("Original")}</option>
              <option value="square">1:1</option>
              <option value="landscape">16:9</option>
              <option value="portrait">4:5</option>
              <option value="9:16">9:16</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label>
            <span>{uiText("Direction")}</span>
            <input
              value={prompt}
              maxLength={400}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              disabled={running}
              aria-label={uiText("AI edit direction")}
            />
          </label>
        </div>
      )}

      {preview && (
        <div className="photo-generative-preview-actions">
          <div className="photo-generative-compare" role="group" aria-label={uiText("Compare AI edit")}>
            <button
              type="button"
              className={!showAfter ? "active" : ""}
              onClick={() => {
                setShowAfter(false);
                onPreviewChange(null);
              }}
            >
              {uiText("Before")}
            </button>
            <button
              type="button"
              className={showAfter ? "active" : ""}
              onClick={() => {
                setShowAfter(true);
                onPreviewChange(preview);
              }}
            >
              {uiText("After")}
            </button>
          </div>
          <span title={uiText("AI-generated preview")}><Eye size={14} /></span>
        </div>
      )}

      <div className="photo-generative-command-row">
        {preview ? (
          <>
            <button
              type="button"
              className="secondary compact-action"
              onClick={() => void discardPreview()}
              disabled={running}
            >
              <X size={14} />
              <span>{uiText("Discard")}</span>
            </button>
            <button
              type="button"
              className="primary compact-action"
              onClick={() => void applyPreview()}
              disabled={running || !contentCredentialsAvailable}
              title={uiText(contentCredentialsAvailable ? "Apply with workspace-local Content Credentials" : "Content Credentials unavailable")}
            >
              {running ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
              <span>{running ? uiText("Applying") : uiText("Apply AI edit")}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void generatePreview()}
            disabled={!canRender}
          >
            {running ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
            <span>{running ? uiText("Generating") : uiText("Preview")}</span>
          </button>
        )}
      </div>
    </section>
  );
}
