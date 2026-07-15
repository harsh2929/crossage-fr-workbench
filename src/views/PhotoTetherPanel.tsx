import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleStop,
  FolderInput,
  History,
  ImageIcon,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  PhotoTetherEvent,
  PhotoTetherCameraStatus,
  PhotoTetherStartOptions,
  PhotoTetherStatus,
} from "../types";
import "./photoTetherPanel.css";

type PhotoTetherPanelProps = {
  defaultStorageMode: "referenced" | "managed";
  managedRoot?: string;
  chooseFolder: () => Promise<string | null>;
  getStatus: (refreshCamera?: boolean) => Promise<PhotoTetherStatus>;
  start: (options: PhotoTetherStartOptions) => Promise<PhotoTetherStatus>;
  stop: () => Promise<PhotoTetherStatus>;
  resume: (sessionId: string) => Promise<PhotoTetherStatus>;
  capture: () => Promise<unknown>;
  subscribe: (callback: (event: PhotoTetherEvent) => void) => () => void;
  onImported?: (event: PhotoTetherEvent) => void;
  uiText: (source: string) => string;
  formatNumber: (value: number) => string;
};

const EMPTY_CAMERA_STATUS: PhotoTetherCameraStatus = {
  available: false,
  version: "",
  cameras: [],
  captureSupported: false,
  message: "Direct camera control has not been checked yet.",
};

function shortPath(value: string) {
  const clean = String(value || "").replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || clean;
}

function captureStatusLabel(status: string, uiText: (source: string) => string) {
  if (status === "imported") return uiText("Imported");
  if (status === "failed") return uiText("Failed");
  if (status === "interrupted") return uiText("Interrupted");
  return uiText("Pending");
}

export function PhotoTetherPanel(props: PhotoTetherPanelProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PhotoTetherStatus | null>(null);
  const [mode, setMode] = useState<"watch" | "ptp">("watch");
  const [sourcePath, setSourcePath] = useState("");
  const [storageMode, setStorageMode] = useState<"referenced" | "managed">(props.defaultStorageMode);
  const [namingTemplate, setNamingTemplate] = useState("capture_{date}_{sequence:04}");
  const [nextSequence, setNextSequence] = useState(1);
  const [cameraId, setCameraId] = useState("");
  const [includeExisting, setIncludeExisting] = useState(false);
  const [autoResume, setAutoResume] = useState(true);
  const [liveReview, setLiveReview] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [latestEvent, setLatestEvent] = useState<PhotoTetherEvent | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstControlRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  const loadStatus = useCallback(async (refreshCamera = false) => {
    try {
      const next = await props.getStatus(refreshCamera);
      setStatus(next);
      setError("");
      if (next.camera?.cameras?.[0]?.id) setCameraId((current) => current || next.camera.cameras[0].id);
      const durableSession = next.session || next.recoverable?.[0] || null;
      if (durableSession && ["active", "recoverable"].includes(durableSession.status)) {
        setMode(durableSession.mode);
        setSourcePath(durableSession.sourcePath);
        setStorageMode(durableSession.storageMode);
        setNamingTemplate(durableSession.namingTemplate || "capture_{date}_{sequence:04}");
        setNextSequence(Math.max(1, durableSession.nextSequence || 1));
        setCameraId(durableSession.camera?.id || next.camera?.cameras?.[0]?.id || "");
        setIncludeExisting(Boolean(durableSession.settings?.includeExisting));
        setAutoResume(durableSession.settings?.autoResume !== false);
        setLiveReview(durableSession.settings?.liveReview !== false);
      }
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  }, [props.getStatus]);

  useEffect(() => {
    if (typeof props.subscribe !== "function") return undefined;
    return props.subscribe((event) => {
      setLatestEvent(event);
      if (event.type === "imported") props.onImported?.(event);
      void loadStatus(false);
    });
  }, [loadStatus, props.onImported, props.subscribe]);

  useEffect(() => {
    if (!open) return;
    void loadStatus(false);
    const frame = window.requestAnimationFrame(() => firstControlRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [loadStatus, open]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      launcherRef.current?.focus();
    }
  }, [open]);

  const activeSession = status?.active ? status.session : null;
  const recoverableSession = !activeSession ? status?.recoverable?.[0] || null : null;
  const displaySession = activeSession || recoverableSession || status?.session || status?.recent?.[0] || null;
  const cameraStatus = status?.camera || EMPTY_CAMERA_STATUS;
  const latestCapture = latestEvent?.capture || displaySession?.captures?.[0] || null;
  const latestPreviewUrl = latestEvent?.previewUrl || latestCapture?.previewUrl || "";
  const captureRows = useMemo(() => (displaySession?.captures || []).slice(0, 8), [displaySession]);
  const active = Boolean(activeSession);
  const actionBusy = Boolean(busyAction);
  const cameraStatusText = cameraStatus.captureSupported
    ? `${props.formatNumber(cameraStatus.cameras.length)} ${props.uiText(cameraStatus.cameras.length === 1 ? "supported camera detected" : "supported cameras detected")}`
    : cameraStatus.available
      ? props.uiText("gphoto2 is available, but no supported camera is connected.")
      : props.uiText(cameraStatus.error
        ? "gphoto2 could not be queried. Watched-folder tethering remains available."
        : "gphoto2 is not installed. Watched-folder tethering remains available.");

  const close = () => {
    if (!actionBusy) setOpen(false);
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || []).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const chooseCaptureFolder = async () => {
    const selected = await props.chooseFolder();
    if (selected) setSourcePath(selected);
  };

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    setBusyAction(name);
    setError("");
    try {
      await action();
      await loadStatus(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyAction("");
    }
  };

  const startSession = () => runAction("start", async () => {
    if (!sourcePath) throw new Error(props.uiText("Choose a capture folder."));
    await props.start({
      mode,
      sourcePath,
      destinationPath: sourcePath,
      storageMode,
      managedRoot: storageMode === "managed" ? props.managedRoot || "" : "",
      namingTemplate,
      nextSequence,
      cameraId,
      includeExisting,
      autoResume,
      liveReview,
      refreshCamera: mode === "ptp",
    });
  });

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="secondary compact-action photo-tether-launcher"
        onClick={() => setOpen(true)}
      >
        <Radio size={15} />
        <span>{props.uiText("Tethered capture")}</span>
        {status?.active && <span className="photo-tether-launcher-live" aria-label={props.uiText("Active")} />}
      </button>
      {open && createPortal((
        <div className="photo-tether-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div
            ref={dialogRef}
            className="photo-tether-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-tether-title"
            onKeyDown={handleDialogKeyDown}
          >
            <header className="photo-tether-head">
              <div>
                <span className={active ? "photo-tether-state active" : "photo-tether-state"}>
                  <Radio size={15} />
                  {active ? props.uiText("Session active") : props.uiText("Tethered capture")}
                </span>
                <h3 id="photo-tether-title">{props.uiText("Tethered capture")}</h3>
              </div>
              <button type="button" className="ghost icon-only" onClick={close} disabled={actionBusy} aria-label={props.uiText("Close")} title={props.uiText("Close")}>
                <X size={18} />
              </button>
            </header>

            <div className="photo-tether-body">
              <section className="photo-tether-band" aria-labelledby="photo-tether-mode-title">
                <div className="photo-tether-band-head">
                  <strong id="photo-tether-mode-title">{props.uiText("Capture source")}</strong>
                  <span>{active ? props.uiText("Locked while active") : props.uiText("Session setup")}</span>
                </div>
                <div className="photo-tether-segmented" role="group" aria-label={props.uiText("Capture mode")}>
                  <button ref={firstControlRef} type="button" className={mode === "watch" ? "active" : ""} aria-pressed={mode === "watch"} onClick={() => setMode("watch")} disabled={active || actionBusy}>
                    <FolderInput size={15} /> {props.uiText("Watched folder")}
                  </button>
                  <button type="button" className={mode === "ptp" ? "active" : ""} aria-pressed={mode === "ptp"} onClick={() => { setMode("ptp"); void loadStatus(true); }} disabled={active || actionBusy}>
                    <Camera size={15} /> {props.uiText("Direct camera")}
                  </button>
                </div>
                <div className="photo-tether-folder-row">
                  <FolderInput size={16} />
                  <span title={sourcePath}>{sourcePath ? shortPath(sourcePath) : props.uiText("No capture folder selected")}</span>
                  <button type="button" className="secondary compact-action" onClick={() => void chooseCaptureFolder()} disabled={active || actionBusy}>
                    {props.uiText("Choose folder")}
                  </button>
                </div>
                {mode === "ptp" && (
                  <div className={cameraStatus.captureSupported ? "photo-tether-camera-status ok" : "photo-tether-camera-status"}>
                    {cameraStatus.captureSupported ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    <span>{cameraStatusText}</span>
                    <button type="button" className="ghost icon-only" onClick={() => void loadStatus(true)} disabled={actionBusy} aria-label={props.uiText("Refresh cameras")} title={props.uiText("Refresh cameras")}>
                      <RefreshCcw size={15} />
                    </button>
                  </div>
                )}
                {mode === "ptp" && cameraStatus.cameras.length > 0 && (
                  <label className="photo-tether-field">
                    <span>{props.uiText("Camera")}</span>
                    <select value={cameraId || cameraStatus.cameras[0].id} onChange={(event) => setCameraId(event.target.value)} disabled={active || actionBusy}>
                      {cameraStatus.cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.model}</option>)}
                    </select>
                  </label>
                )}
              </section>

              <section className="photo-tether-band" aria-labelledby="photo-tether-import-title">
                <div className="photo-tether-band-head">
                  <strong id="photo-tether-import-title">{props.uiText("Import and naming")}</strong>
                  {displaySession && <span>{props.formatNumber(displaySession.importedCount)} {props.uiText("imported")}</span>}
                </div>
                <div className="photo-tether-segmented" role="group" aria-label={props.uiText("Storage mode")}>
                  <button type="button" className={storageMode === "referenced" ? "active" : ""} aria-pressed={storageMode === "referenced"} onClick={() => setStorageMode("referenced")} disabled={active || actionBusy}>
                    {props.uiText("Referenced")}
                  </button>
                  <button type="button" className={storageMode === "managed" ? "active" : ""} aria-pressed={storageMode === "managed"} onClick={() => setStorageMode("managed")} disabled={active || actionBusy}>
                    {props.uiText("Managed")}
                  </button>
                </div>
                {mode === "ptp" && (
                  <div className="photo-tether-name-grid">
                    <label className="photo-tether-field">
                      <span>{props.uiText("Filename template")}</span>
                      <input value={namingTemplate} onChange={(event) => setNamingTemplate(event.target.value)} disabled={active || actionBusy} spellCheck={false} />
                    </label>
                    <label className="photo-tether-field compact">
                      <span>{props.uiText("Next sequence")}</span>
                      <input type="number" min={1} max={999999999} value={nextSequence} onChange={(event) => setNextSequence(Math.max(1, Number(event.target.value) || 1))} disabled={active || actionBusy} />
                    </label>
                  </div>
                )}
                <div className="photo-tether-options">
                  <label><input type="checkbox" checked={includeExisting} onChange={(event) => setIncludeExisting(event.target.checked)} disabled={active || actionBusy} /> <span>{props.uiText("Import existing files")}</span></label>
                  <label><input type="checkbox" checked={autoResume} onChange={(event) => setAutoResume(event.target.checked)} disabled={active || actionBusy} /> <span>{props.uiText("Resume after restart")}</span></label>
                  <label><input type="checkbox" checked={liveReview} onChange={(event) => setLiveReview(event.target.checked)} disabled={active || actionBusy} /> <span>{props.uiText("Live review")}</span></label>
                </div>
              </section>

              {(latestCapture || active) && (
                <section className="photo-tether-band photo-tether-review-band" aria-labelledby="photo-tether-review-title">
                  <div className="photo-tether-band-head">
                    <strong id="photo-tether-review-title">{props.uiText("Live review")}</strong>
                    {status && <span>{props.formatNumber(status.queued)} {props.uiText("queued")}</span>}
                  </div>
                  <div className="photo-tether-live-review">
                    <div className="photo-tether-preview">
                      {latestPreviewUrl ? <img src={latestPreviewUrl} alt={props.uiText("Latest tethered capture")} /> : <ImageIcon size={30} aria-hidden="true" />}
                    </div>
                    <div>
                      <strong>{latestCapture ? shortPath(latestCapture.targetPath || latestCapture.sourcePath) : props.uiText("Waiting for capture")}</strong>
                      <span>{latestCapture ? captureStatusLabel(latestCapture.status, props.uiText) : status?.message}</span>
                      {latestCapture?.capturedAt && <time dateTime={latestCapture.capturedAt}>{new Date(latestCapture.capturedAt).toLocaleString()}</time>}
                    </div>
                  </div>
                </section>
              )}

              {captureRows.length > 0 && (
                <section className="photo-tether-band" aria-labelledby="photo-tether-history-title">
                  <div className="photo-tether-band-head">
                    <strong id="photo-tether-history-title"><History size={14} /> {props.uiText("Recent captures")}</strong>
                    <span>{props.formatNumber(displaySession?.failedCount || 0)} {props.uiText("failed")}</span>
                  </div>
                  <ol className="photo-tether-history">
                    {captureRows.map((capture) => (
                      <li key={capture.captureId}>
                        <span>{props.formatNumber(capture.sequence)}</span>
                        <strong title={capture.targetPath || capture.sourcePath}>{shortPath(capture.targetPath || capture.sourcePath)}</strong>
                        <small className={capture.status}>{captureStatusLabel(capture.status, props.uiText)}</small>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            <footer className="photo-tether-actions">
              <div className="photo-tether-action-status" role="status" aria-live="polite">
                {error ? <><AlertTriangle size={15} /><span>{error}</span></> : <span>{props.uiText(status?.message || "Ready")}</span>}
              </div>
              {recoverableSession && !active && (
                <button type="button" className="secondary" onClick={() => void runAction("resume", () => props.resume(recoverableSession.sessionId))} disabled={actionBusy}>
                  <RotateCcw size={16} /> {busyAction === "resume" ? props.uiText("Resuming") : props.uiText("Resume session")}
                </button>
              )}
              {active && activeSession?.mode === "ptp" && (
                <button type="button" className="primary" onClick={() => void runAction("capture", props.capture)} disabled={actionBusy || status?.captureBusy}>
                  <Camera size={16} /> {busyAction === "capture" ? props.uiText("Capturing") : props.uiText("Capture")}
                </button>
              )}
              {active ? (
                <button type="button" className="secondary" onClick={() => void runAction("stop", props.stop)} disabled={actionBusy}>
                  <CircleStop size={16} /> {busyAction === "stop" ? props.uiText("Stopping") : props.uiText("Stop session")}
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => void startSession()} disabled={actionBusy || !sourcePath || (mode === "ptp" && !cameraStatus.captureSupported)}>
                  <Play size={16} /> {busyAction === "start" ? props.uiText("Starting") : props.uiText("Start session")}
                </button>
              )}
            </footer>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
