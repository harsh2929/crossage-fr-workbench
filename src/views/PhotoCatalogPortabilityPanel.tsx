import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  CrossAgeApi,
  OpenPhotoCatalogExportResult,
  OpenPhotoCatalogImportResult,
  OpenPhotoCatalogInspection,
  OpenPhotoCatalogProgress,
  OpenPhotoCatalogStatus,
} from "../types";
import "./photoCatalogPortabilityPanel.css";


type CatalogAction = "" | "inspect" | "export" | "import";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "The catalog transfer failed.");
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function PhotoCatalogPortabilityPanel(props: {
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  chooseFolder: () => Promise<string | null>;
  chooseCatalog: CrossAgeApi["chooseOpenPhotoCatalog"];
  getStatus: CrossAgeApi["getPhotoCatalogStatus"];
  inspectCatalog: CrossAgeApi["inspectOpenPhotoCatalog"];
  exportCatalog: CrossAgeApi["exportOpenPhotoCatalog"];
  importCatalog: CrossAgeApi["importOpenPhotoCatalog"];
  cancelCatalog: CrossAgeApi["cancelOpenPhotoCatalog"];
  subscribeProgress: CrossAgeApi["onScanProgress"];
  revealPath: (path: string) => void | Promise<void>;
  onImported?: () => void | Promise<void>;
}) {
  const {
    uiText,
    formatCount,
    chooseFolder,
    chooseCatalog,
    getStatus,
    inspectCatalog,
    exportCatalog,
    importCatalog,
    cancelCatalog,
    subscribeProgress,
    revealPath,
    onImported,
  } = props;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"export" | "import">("export");
  const [status, setStatus] = useState<OpenPhotoCatalogStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [action, setAction] = useState<CatalogAction>("");
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<OpenPhotoCatalogProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [destination, setDestination] = useState("");
  const [packageName, setPackageName] = useState("");
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [includeSidecars, setIncludeSidecars] = useState(true);
  const [exportResult, setExportResult] = useState<OpenPhotoCatalogExportResult | null>(null);
  const [catalogPath, setCatalogPath] = useState("");
  const [inspection, setInspection] = useState<OpenPhotoCatalogInspection | null>(null);
  const [managedRoot, setManagedRoot] = useState("");
  const [mergeByHash, setMergeByHash] = useState(true);
  const [importResult, setImportResult] = useState<OpenPhotoCatalogImportResult | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);
  const busy = Boolean(action);
  busyRef.current = busy;

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      const result = await getStatus();
      setStatus(result.value || null);
    } catch (statusError) {
      setError(errorText(statusError));
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    return subscribeProgress((event) => {
      if (event.name === "photo_catalog") setProgress(event.payload);
    });
  }, [getStatus, open, subscribeProgress]);

  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : launcherRef.current;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.offsetParent !== null);
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
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      (priorFocus || launcherRef.current)?.focus();
    };
  }, [open]);

  function resetMessages() {
    setError("");
    setNotice("");
    setProgress(null);
  }

  async function chooseExportFolder() {
    const folder = await chooseFolder();
    if (folder) setDestination(folder);
  }

  async function chooseManagedFolder() {
    const folder = await chooseFolder();
    if (folder) setManagedRoot(folder);
  }

  async function chooseImportCatalog() {
    const selected = await chooseCatalog();
    if (!selected?.path) return;
    setCatalogPath(selected.path);
    setInspection(null);
    setImportResult(null);
    resetMessages();
    setAction("inspect");
    try {
      const result = await inspectCatalog({ catalogPath: selected.path, verifyMedia: false });
      setInspection(result.value || null);
      setNotice(uiText("Catalog structure verified."));
    } catch (inspectError) {
      const message = errorText(inspectError);
      if (message.toLowerCase().includes("cancel")) setNotice(uiText("Catalog inspection cancelled."));
      else setError(message);
    } finally {
      setAction("");
      setCancelling(false);
      setProgress(null);
    }
  }

  async function runExport() {
    if (!destination || busy) return;
    resetMessages();
    setExportResult(null);
    setAction("export");
    try {
      const result = await exportCatalog({
        destination,
        metadataOnly,
        includeSidecars,
        name: packageName,
      });
      setExportResult(result.value || null);
      setNotice(uiText("Open catalog export completed."));
    } catch (exportError) {
      const message = errorText(exportError);
      if (message.toLowerCase().includes("cancel")) setNotice(uiText("Catalog export cancelled."));
      else setError(message);
    } finally {
      setAction("");
      setCancelling(false);
      setProgress(null);
    }
  }

  async function runImport() {
    if (!catalogPath || !inspection || busy) return;
    resetMessages();
    setImportResult(null);
    setAction("import");
    try {
      const result = await importCatalog({ catalogPath, managedRoot: managedRoot || undefined, mergeByHash });
      setImportResult(result.value || null);
      setNotice(uiText("Open catalog import completed."));
      await onImported?.();
      await refreshStatus();
    } catch (importError) {
      const message = errorText(importError);
      if (message.toLowerCase().includes("cancel")) setNotice(uiText("Catalog import cancelled."));
      else setError(message);
    } finally {
      setAction("");
      setCancelling(false);
      setProgress(null);
    }
  }

  async function requestCancel() {
    if (!busy || cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelCatalog();
      if (result.cancelRequested) setNotice(uiText("Cancellation requested."));
    } catch (cancelError) {
      setError(errorText(cancelError));
      setCancelling(false);
    }
  }

  const progressTotal = Math.max(0, Number(progress?.total || 0));
  const progressProcessed = Math.max(0, Number(progress?.processed || 0));
  const progressPercent = progressTotal > 0 ? Math.min(100, (progressProcessed / progressTotal) * 100) : 0;

  return (
    <>
      <button ref={launcherRef} type="button" className="secondary photo-catalog-launcher" onClick={() => setOpen(true)}>
        <Archive size={15} />
        <span>{uiText("Transfer catalog")}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="photo-catalog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <section ref={dialogRef} className="photo-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-catalog-title">
            <header className="photo-catalog-head">
              <div>
                <h3 id="photo-catalog-title">{uiText("Catalog transfer")}</h3>
                <span>{uiText("Open photo catalog v1")}</span>
              </div>
              <button ref={closeRef} type="button" className="ghost icon-only" onClick={() => setOpen(false)} disabled={busy} aria-label={uiText("Close")} title={uiText("Close")}>
                <X size={17} />
              </button>
            </header>

            <div className="photo-catalog-tabs" role="tablist" aria-label={uiText("Catalog action")}>
              <button type="button" role="tab" aria-selected={mode === "export"} tabIndex={mode === "export" ? 0 : -1} className={mode === "export" ? "active" : ""} onClick={() => { setMode("export"); resetMessages(); }} disabled={busy}>
                <Download size={14} />
                <span>{uiText("Export")}</span>
              </button>
              <button type="button" role="tab" aria-selected={mode === "import"} tabIndex={mode === "import" ? 0 : -1} className={mode === "import" ? "active" : ""} onClick={() => { setMode("import"); resetMessages(); }} disabled={busy}>
                <Upload size={14} />
                <span>{uiText("Import")}</span>
              </button>
            </div>

            <div className="photo-catalog-body" role="tabpanel">
              <section className="photo-catalog-status-band" aria-label={uiText("Current catalog") }>
                <div className="photo-catalog-band-head">
                  <strong>{uiText("Current catalog")}</strong>
                  {statusLoading ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                </div>
                <div className="photo-catalog-counts">
                  {[
                    ["Assets", status?.counts.assets || 0],
                    ["Albums", status?.counts.albums || 0],
                    ["Keywords", status?.counts.keywords || 0],
                    ["Edit versions", status?.counts.editVersions || 0],
                  ].map(([label, value]) => (
                    <span key={String(label)}><small>{uiText(String(label))}</small><strong>{formatCount(Number(value))}</strong></span>
                  ))}
                </div>
                <div className="photo-catalog-security-note">
                  <AlertTriangle size={14} />
                  <span>{uiText("Open catalog packages are not encrypted.")}</span>
                </div>
              </section>

              {mode === "export" ? (
                <>
                  <section className="photo-catalog-band">
                    <div className="photo-catalog-band-head"><strong>{uiText("Export package")}</strong></div>
                    <div className="photo-catalog-path-row">
                      <input type="text" readOnly value={destination} title={destination} placeholder={uiText("Choose export folder")} aria-label={uiText("Export folder")} />
                      <button type="button" className="secondary icon-only" onClick={() => void chooseExportFolder()} disabled={busy} aria-label={uiText("Choose export folder")} title={uiText("Choose export folder")}><FolderOpen size={15} /></button>
                    </div>
                    <label className="photo-catalog-field">
                      <span>{uiText("Package name")}</span>
                      <input type="text" value={packageName} onChange={(event) => setPackageName(event.currentTarget.value)} maxLength={120} placeholder={uiText("Automatic timestamp")} disabled={busy} />
                    </label>
                    <div className="photo-catalog-segmented" role="group" aria-label={uiText("Package contents")}>
                      <button type="button" className={!metadataOnly ? "active" : ""} onClick={() => setMetadataOnly(false)} disabled={busy}>{uiText("Full archive")}</button>
                      <button type="button" className={metadataOnly ? "active" : ""} onClick={() => setMetadataOnly(true)} disabled={busy}>{uiText("Catalog only")}</button>
                    </div>
                    <label className="photo-catalog-check-row">
                      <input type="checkbox" checked={includeSidecars} onChange={(event) => setIncludeSidecars(event.currentTarget.checked)} disabled={busy} />
                      <span>{uiText("Include sidecars")}</span>
                    </label>
                  </section>
                  {exportResult && (
                    <section className="photo-catalog-result" role="status">
                      <CheckCircle2 size={16} />
                      <span><strong>{uiText("Export verified")}</strong><small>{formatCount(exportResult.counts.assets || 0)} {uiText("assets")}</small></span>
                      <button type="button" className="secondary" onClick={() => void revealPath(exportResult.catalogPath)}><FolderOpen size={14} /><span>{uiText("Show in folder")}</span></button>
                    </section>
                  )}
                </>
              ) : (
                <>
                  <section className="photo-catalog-band">
                    <div className="photo-catalog-band-head"><strong>{uiText("Import package")}</strong></div>
                    <div className="photo-catalog-path-row">
                      <input type="text" readOnly value={catalogPath} title={catalogPath} placeholder={uiText("Choose open catalog")} aria-label={uiText("Open catalog folder")} />
                      <button type="button" className="secondary icon-only" onClick={() => void chooseImportCatalog()} disabled={busy} aria-label={uiText("Choose open catalog")} title={uiText("Choose open catalog")}><FolderOpen size={15} /></button>
                    </div>
                    {inspection && (
                      <div className="photo-catalog-inspection" role="status">
                        <ShieldCheck size={15} />
                        <span><strong>{uiText("Catalog structure verified")}</strong><small>{formatCount(inspection.members)} {uiText("members")} · {formatBytes(inspection.verifiedBytes)}</small></span>
                        <span>{inspection.mediaPolicy === "full" ? uiText("Full archive") : uiText("Catalog only")}</span>
                      </div>
                    )}
                    <div className="photo-catalog-path-row">
                      <input type="text" readOnly value={managedRoot} title={managedRoot} placeholder={uiText("Workspace photo library")} aria-label={uiText("Managed import folder")} />
                      <button type="button" className="secondary icon-only" onClick={() => void chooseManagedFolder()} disabled={busy} aria-label={uiText("Choose managed import folder")} title={uiText("Choose managed import folder")}><FolderOpen size={15} /></button>
                    </div>
                    <label className="photo-catalog-check-row">
                      <input type="checkbox" checked={mergeByHash} onChange={(event) => setMergeByHash(event.currentTarget.checked)} disabled={busy} />
                      <span>{uiText("Merge matching originals by hash")}</span>
                    </label>
                  </section>
                  {importResult && (
                    <section className="photo-catalog-result" role="status">
                      <CheckCircle2 size={16} />
                      <span><strong>{uiText("Import verified")}</strong><small>{formatCount(importResult.counts.created || 0)} {uiText("created")} · {formatCount(importResult.counts.merged || 0)} {uiText("merged")}</small></span>
                    </section>
                  )}
                </>
              )}

              {busy && (
                <section className="photo-catalog-progress" aria-live="polite">
                  <span><Loader2 size={14} className="spin" /><strong>{progress?.message || uiText(action === "inspect" ? "Inspecting catalog" : action === "export" ? "Exporting catalog" : "Importing catalog")}</strong></span>
                  <div role="progressbar" aria-label={uiText("Catalog progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}><i style={{ width: `${progressPercent}%` }} /></div>
                  {progressTotal > 0 && <small>{formatCount(progressProcessed)} / {formatCount(progressTotal)}</small>}
                </section>
              )}
              {error && <div className="photo-catalog-message error" role="alert"><AlertTriangle size={14} /><span>{error}</span></div>}
              {notice && <div className="photo-catalog-message ok" role="status"><CheckCircle2 size={14} /><span>{notice}</span></div>}
            </div>

            <footer className="photo-catalog-actions">
              <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>{uiText("Close")}</button>
              {busy && (
                <button type="button" className="secondary" onClick={() => void requestCancel()} disabled={cancelling}>
                  {cancelling ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                  <span>{cancelling ? uiText("Cancelling") : uiText("Cancel")}</span>
                </button>
              )}
              {mode === "export" ? (
                <button type="button" className="primary" onClick={() => void runExport()} disabled={!destination || busy}>
                  {action === "export" ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                  <span>{uiText("Export catalog")}</span>
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => void runImport()} disabled={!catalogPath || !inspection || busy}>
                  {action === "import" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                  <span>{uiText("Import catalog")}</span>
                </button>
              )}
            </footer>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
