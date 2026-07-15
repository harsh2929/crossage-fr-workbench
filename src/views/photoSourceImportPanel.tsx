import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CloudDownload,
  Download,
  ExternalLink,
  FolderOpen,
  Images,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type {
  DamPhotoSourceProvider,
  PhotoSourceDiscoveryValue,
  PhotoSourceJob,
  PhotoSourceJobStartValue,
  PhotoSourceJobsValue,
  PhotoSourceJobStatusValue,
  PhotoSourcePeopleHint,
  PhotoSourcePeopleHintsValue,
  PhotoSourcePreviewValue,
  PhotoSourceProvider,
  PhotoSourceProviderStatus,
  PhotoSourceScopes,
} from "../types";
import { InboundConnectorPanel } from "./inboundConnectorPanel";
import "./photoSourceImportPanel.css";


const DEFAULT_SCOPES: PhotoSourceScopes = {
  originals: true,
  edited: true,
  raw: true,
  livePhotoMotion: true,
  albumsFolders: true,
  keywords: true,
  labelsOcr: true,
  extractDetectedText: false,
  favorites: true,
  peopleFaces: false,
  preciseLocation: false,
  hidden: false,
  deleted: false,
  shared: false,
  commentsLikes: false,
};

const SENSITIVE_SCOPE_KEYS: Array<keyof PhotoSourceScopes> = [
  "peopleFaces",
  "preciseLocation",
  "hidden",
  "deleted",
  "shared",
  "commentsLikes",
];

const SCOPE_ROWS: Array<{ key: keyof PhotoSourceScopes; label: string; appleOnly?: boolean; damSupported?: boolean }> = [
  { key: "originals", label: "Originals", damSupported: true },
  { key: "edited", label: "Edited versions", appleOnly: true },
  { key: "raw", label: "RAW companions", damSupported: true },
  { key: "livePhotoMotion", label: "Live Photo motion", appleOnly: true },
  { key: "albumsFolders", label: "Albums and folders", damSupported: true },
  { key: "keywords", label: "Keywords", damSupported: true },
  { key: "labelsOcr", label: "Labels and saved text", damSupported: true },
  { key: "extractDetectedText", label: "Run Apple text detection", appleOnly: true },
  { key: "favorites", label: "Favorites", damSupported: true },
  { key: "peopleFaces", label: "People and face regions" },
  { key: "preciseLocation", label: "Precise location" },
  { key: "hidden", label: "Hidden items", appleOnly: true },
  { key: "deleted", label: "Recently deleted", appleOnly: true },
  { key: "shared", label: "Shared metadata", appleOnly: true },
  { key: "commentsLikes", label: "Comments and likes", appleOnly: true },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "The photo source action failed.");
}

function sourceLabel(provider: PhotoSourceProvider): string {
  if (provider === "apple_photos") return "Apple Photos";
  if (provider === "windows_folders") return "Photo folders";
  if (provider === "lightroom_catalog") return "Lightroom Classic catalog";
  if (provider === "capture_one_catalog") return "Capture One catalog";
  return "Photo source";
}

function isDamProvider(provider: PhotoSourceProvider): provider is DamPhotoSourceProvider {
  return provider === "lightroom_catalog" || provider === "capture_one_catalog";
}

function jobActive(job?: PhotoSourceJob | null): boolean {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

function jobDone(job?: PhotoSourceJob | null): boolean {
  return Boolean(job && (job.status === "completed" || job.status === "failed" || job.status === "cancelled"));
}

function formatTimestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PhotoSourceImportPanel(props: {
  platform?: string;
  busy?: boolean;
  defaultStorageMode: "referenced" | "managed";
  managedRoot: string;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  chooseFolder: () => Promise<string | null>;
  chooseDamCatalog: (provider: DamPhotoSourceProvider) => Promise<{ path: string; isDir?: boolean } | null>;
  getProviderStatus: (provider: PhotoSourceProvider) => Promise<{ value: PhotoSourceProviderStatus }>;
  listLibraries: (provider: PhotoSourceProvider) => Promise<{ value: PhotoSourceDiscoveryValue }>;
  previewSource: (provider: PhotoSourceProvider, params: Record<string, unknown>) => Promise<{ value: PhotoSourcePreviewValue | PhotoSourceJobStartValue }>;
  importSource: (provider: PhotoSourceProvider, params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStartValue }>;
  syncSource: (provider: PhotoSourceProvider, params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStartValue }>;
  exportAppleAssets: (params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStartValue }>;
  listJobs: (params?: Record<string, unknown>) => Promise<{ value: PhotoSourceJobsValue }>;
  getJobStatus: (params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStatusValue }>;
  cancelJob: (params: Record<string, unknown>) => Promise<{ value: PhotoSourceJob }>;
  retryJob: (params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStartValue }>;
  dismissJob: (params: Record<string, unknown>) => Promise<{ value: { jobId: string; deleted: boolean } }>;
  listPeopleHints: (params?: Record<string, unknown>) => Promise<{ value: PhotoSourcePeopleHintsValue }>;
  reviewPeopleHint: (params: Record<string, unknown>) => Promise<{ value: PhotoSourcePeopleHint }>;
  revokeConsent: (params: Record<string, unknown>) => Promise<{ value: PhotoSourceJobStartValue }>;
  openPrivacySettings: () => Promise<{ ok: boolean; platform: string; suppressed?: boolean; error?: string }>;
  onLibraryChanged?: (job: PhotoSourceJob) => void | Promise<void>;
}) {
  const {
    uiText,
    formatCount,
    getProviderStatus,
    listLibraries,
    previewSource,
    importSource,
    syncSource,
    exportAppleAssets,
    listJobs,
    getJobStatus,
    cancelJob,
    retryJob,
    dismissJob,
    listPeopleHints,
    reviewPeopleHint,
    revokeConsent,
    openPrivacySettings,
    chooseFolder,
    chooseDamCatalog,
    onLibraryChanged,
  } = props;
  const initialProvider: PhotoSourceProvider = String(props.platform || "").toLowerCase().includes("win")
    ? "windows_folders"
    : "apple_photos";
  const [open, setOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<"local" | "dam" | "online">("local");
  const [provider, setProvider] = useState<PhotoSourceProvider>(initialProvider);
  const [status, setStatus] = useState<PhotoSourceProviderStatus | null>(null);
  const [discovery, setDiscovery] = useState<PhotoSourceDiscoveryValue | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const [customFolderPath, setCustomFolderPath] = useState("");
  const [damCatalogPaths, setDamCatalogPaths] = useState<Partial<Record<DamPhotoSourceProvider, string>>>({});
  const [mediaRoot, setMediaRoot] = useState("");
  const [rootMappings, setRootMappings] = useState<Array<{ sourceRoot: string; targetRoot: string }>>([]);
  const [scopes, setScopes] = useState<PhotoSourceScopes>(DEFAULT_SCOPES);
  const [sensitiveConsent, setSensitiveConsent] = useState(false);
  const [storageMode, setStorageMode] = useState<"referenced" | "managed">(props.defaultStorageMode);
  const [managedRoot, setManagedRoot] = useState(props.managedRoot);
  const [preferEdited, setPreferEdited] = useState(false);
  const [allowPhotosExport, setAllowPhotosExport] = useState(false);
  const [cloudDownloadConsent, setCloudDownloadConsent] = useState(false);
  const [removedPolicy, setRemovedPolicy] = useState<"keep" | "trash">("keep");
  const [preview, setPreview] = useState<PhotoSourcePreviewValue | null>(null);
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<PhotoSourceJob[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [peopleHints, setPeopleHints] = useState<PhotoSourcePeopleHint[]>([]);
  const [peopleHintTotal, setPeopleHintTotal] = useState(0);
  const [peopleNames, setPeopleNames] = useState<Record<string, string>>({});
  const [reviewingHintId, setReviewingHintId] = useState("");
  const [revokeScopes, setRevokeScopes] = useState<Set<string>>(new Set());
  const [expandedJobId, setExpandedJobId] = useState("");
  const [failureQuery, setFailureQuery] = useState("");
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const completedJobIds = useRef(new Set<string>());
  const providerLoadSequence = useRef(0);

  const activeJob = useMemo(
    () => jobs.find((job) => job.jobId === activeJobId) || jobs.find(jobActive) || null,
    [activeJobId, jobs]
  );
  const libraries = discovery?.libraries || [];
  const selectedLibrary = libraries.find((library) => library.path === libraryPath) || null;
  const configuredSources = discovery?.configuredSources || status?.sources || [];
  const selectedSource = configuredSources.find((source) => (
    selectedLibrary?.libraryId
      ? source.libraryId === selectedLibrary.libraryId
      : source.rootPath === libraryPath
  ))
    || preview?.source
    || null;
  const selectedSourceId = selectedSource?.sourceId || "";
  const selectedConsentScopes = selectedSource?.consent?.sensitiveScopes || [];
  const selectedSensitiveScopes = SENSITIVE_SCOPE_KEYS.filter((key) => scopes[key]);
  const damProvider = isDamProvider(provider);
  const visibleScopeRows = SCOPE_ROWS.filter((row) => (
    damProvider ? row.damSupported : !row.appleOnly || provider === "apple_photos"
  ));
  const privacyReady = selectedSensitiveScopes.length === 0 || sensitiveConsent;
  const cloudReady = !allowPhotosExport || cloudDownloadConsent;
  const selectedLibraryReady = !selectedLibrary || selectedLibrary.status === "ready";
  const sourceReady = Boolean(libraryPath && status?.available && selectedLibraryReady && privacyReady && cloudReady);
  const providerJobs = jobs.filter((job) => job.provider === provider);
  const modalBusyRef = useRef(false);
  modalBusyRef.current = jobActive(activeJob);

  const refreshJobs = useCallback(async () => {
    const result = await listJobs({ limit: 50 });
    setJobs(result.value?.jobs || []);
  }, [listJobs]);

  const refreshPeopleHints = useCallback(async (
    nextProvider: PhotoSourceProvider,
    sourceId = "",
  ) => {
    const result = await listPeopleHints({
      provider: nextProvider,
      ...(sourceId ? { sourceId } : {}),
      status: "pending",
      limit: 50,
    });
    const nextHints = result.value?.hints || [];
    setPeopleHints(nextHints);
    setPeopleHintTotal(Number(result.value?.total || 0));
    setPeopleNames((current) => {
      const next = { ...current };
      for (const hint of nextHints) {
        if (!(hint.hintId in next)) next[hint.hintId] = hint.personName;
      }
      return next;
    });
  }, [listPeopleHints]);

  function closeDialog() {
    if (modalBusyRef.current) return;
    setOpen(false);
  }

  const loadProvider = useCallback(async (nextProvider: PhotoSourceProvider) => {
    const loadSequence = providerLoadSequence.current + 1;
    providerLoadSequence.current = loadSequence;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [statusResult, discoveryResult, jobsResult] = await Promise.all([
        getProviderStatus(nextProvider),
        listLibraries(nextProvider),
        listJobs({ limit: 50 }),
      ]);
      if (loadSequence !== providerLoadSequence.current) return;
      setStatus(statusResult.value || null);
      setDiscovery(discoveryResult.value || null);
      setJobs(jobsResult.value?.jobs || []);
      const nextLibraries = discoveryResult.value?.libraries || [];
      const preferred = nextLibraries.find((library) => library.systemLibrary)
        || nextLibraries.find((library) => library.lastUsed)
        || nextLibraries.find((library) => library.available)
        || nextLibraries[0];
      setLibraryPath(isDamProvider(nextProvider)
        ? damCatalogPaths[nextProvider] || ""
        : preferred?.path || (nextProvider === "windows_folders" ? customFolderPath : ""));
      setPreview(null);
      setSelectedExternalIds(new Set());
      try {
        await refreshPeopleHints(nextProvider, preferred
          ? (discoveryResult.value?.configuredSources || []).find((source) => source.rootPath === preferred.path)?.sourceId || ""
          : "");
      } catch {
        setPeopleHints([]);
        setPeopleHintTotal(0);
      }
    } catch (loadError) {
      if (loadSequence === providerLoadSequence.current) setError(errorText(loadError));
    } finally {
      if (loadSequence === providerLoadSequence.current) setLoading(false);
    }
  }, [customFolderPath, damCatalogPaths, getProviderStatus, listJobs, listLibraries, refreshPeopleHints]);

  useEffect(() => {
    if (!open) return;
    void loadProvider(provider);
  }, [loadProvider, open, provider]);

  useEffect(() => {
    if (!open) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : launcherRef.current;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!modalBusyRef.current) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await getJobStatus({ jobId: activeJobId });
        if (cancelled) return;
        const job = result.value?.job;
        if (!job) {
          setActiveJobId("");
          return;
        }
        setJobs((current) => {
          const next = current.filter((item) => item.jobId !== job.jobId);
          return [job, ...next];
        });
        if (jobDone(job)) {
          if (job.status === "completed") {
            if (job.jobKind === "preview") {
              const previewResult = job.result as unknown as PhotoSourcePreviewValue;
              if (previewResult?.library && Array.isArray(previewResult.samples)) {
                setPreview(previewResult);
                setSelectedExternalIds(new Set());
                setNotice(uiText("Photo source preview completed."));
              } else {
                setError(uiText("The photo source preview returned no result."));
              }
            } else {
              setNotice(job.jobKind === "sync"
                ? uiText("Photo source sync completed.")
                : job.jobKind === "revoke_consent"
                  ? uiText("Selected metadata was removed from Vintrace.")
                  : uiText("Photo source job completed."));
            }
            if (job.jobKind !== "preview" && !completedJobIds.current.has(job.jobId)) {
              completedJobIds.current.add(job.jobId);
              await onLibraryChanged?.(job);
            }
            await refreshPeopleHints(provider, job.sourceId || selectedSourceId);
            if (job.jobKind !== "preview") {
              const updatedDiscovery = await listLibraries(provider);
              setDiscovery(updatedDiscovery.value || null);
            }
            if (job.jobKind === "revoke_consent") {
              setRevokeScopes(new Set());
            }
          } else if (job.error) {
            setError(job.error);
          }
          setActiveJobId("");
          await refreshJobs();
          return;
        }
        timer = window.setTimeout(poll, 500);
      } catch (pollError) {
        if (!cancelled) {
          setError(errorText(pollError));
          timer = window.setTimeout(poll, 1200);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeJobId, getJobStatus, listLibraries, onLibraryChanged, provider, refreshJobs, refreshPeopleHints, selectedSourceId, uiText]);

  function setProviderAndReset(nextProvider: PhotoSourceProvider) {
    if (nextProvider === provider) return;
    providerLoadSequence.current += 1;
    setProvider(nextProvider);
    setStatus(null);
    setDiscovery(null);
    setLibraryPath("");
    setPreview(null);
    setError("");
    setNotice("");
    setScopes(DEFAULT_SCOPES);
    setSensitiveConsent(false);
    setAllowPhotosExport(false);
    setCloudDownloadConsent(false);
    setMediaRoot("");
    setRootMappings([]);
  }

  function moveProviderTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!event.currentTarget.parentElement) return;
    const tabs = Array.from(event.currentTarget.parentElement.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  function updateScope(key: keyof PhotoSourceScopes, value: boolean) {
    setScopes((current) => ({ ...current, [key]: value }));
    setPreview(null);
    if (SENSITIVE_SCOPE_KEYS.includes(key) && !value) {
      const remaining = SENSITIVE_SCOPE_KEYS.some((candidate) => candidate !== key && scopes[candidate]);
      if (!remaining) setSensitiveConsent(false);
    }
  }

  function commandParams(): Record<string, unknown> {
    const effectiveScopes = damProvider
      ? {
        ...scopes,
        edited: false,
        livePhotoMotion: false,
        extractDetectedText: false,
        peopleFaces: false,
        preciseLocation: false,
        hidden: false,
        deleted: false,
        shared: false,
        commentsLikes: false,
      }
      : scopes;
    return {
      libraryPath,
      scopes: effectiveScopes,
      sensitiveConsent: selectedSensitiveScopes.length > 0 && sensitiveConsent,
      storageMode,
      managedRoot: managedRoot || undefined,
      preferEdited,
      allowPhotosExport,
      explicitCloudDownloadConsent: allowPhotosExport && cloudDownloadConsent,
      removedPolicy,
      ...(damProvider && mediaRoot ? { mediaRoot } : {}),
      ...(damProvider && rootMappings.some((mapping) => mapping.sourceRoot.trim() && mapping.targetRoot) ? {
        rootMappings: rootMappings.filter((mapping) => mapping.sourceRoot.trim() && mapping.targetRoot),
      } : {}),
    };
  }

  async function runPreview() {
    if (!sourceReady) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await previewSource(provider, {
        ...commandParams(),
        itemLimit: 5000,
        sampleLimit: 30,
        timeBudgetMs: 1800,
        runAsJob: true,
      });
      const value = result.value;
      if (value && "job" in value) {
        const job = value.job;
        setJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
        setActiveJobId(job.jobId);
      } else {
        setPreview(value || null);
        setSelectedExternalIds(new Set());
      }
    } catch (previewError) {
      setError(errorText(previewError));
    } finally {
      setLoading(false);
    }
  }

  async function startJob(kind: "import" | "sync") {
    if (!sourceReady || jobActive(activeJob)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = {
        ...commandParams(),
        ...(selectedExternalIds.size ? { externalIds: [...selectedExternalIds] } : {}),
      };
      const result = kind === "import"
        ? await importSource(provider, params)
        : await syncSource(provider, params);
      const job = result.value?.job;
      if (job) {
        setJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
        setActiveJobId(job.jobId);
      }
    } catch (jobError) {
      setError(errorText(jobError));
    } finally {
      setLoading(false);
    }
  }

  async function exportSelected() {
    if (provider !== "apple_photos" || !selectedExternalIds.size || !cloudReady || jobActive(activeJob)) return;
    const destination = await chooseFolder();
    if (!destination) return;
    setLoading(true);
    setError("");
    try {
      const result = await exportAppleAssets({
        libraryPath,
        externalIds: [...selectedExternalIds],
        destination,
        edited: preferEdited,
        includeRaw: scopes.raw,
        includeLivePhoto: scopes.livePhotoMotion,
        allowPhotosExport,
        explicitCloudDownloadConsent: allowPhotosExport && cloudDownloadConsent,
      });
      const job = result.value?.job;
      if (job) {
        setJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
        setActiveJobId(job.jobId);
      }
    } catch (exportError) {
      setError(errorText(exportError));
    } finally {
      setLoading(false);
    }
  }

  async function chooseCustomFolder() {
    const folder = await chooseFolder();
    if (!folder) return;
    setCustomFolderPath(folder);
    setLibraryPath(folder);
    setPreview(null);
  }

  async function chooseDamCatalogPath() {
    if (!isDamProvider(provider)) return;
    const selected = await chooseDamCatalog(provider);
    if (!selected?.path) return;
    setDamCatalogPaths((current) => ({ ...current, [provider]: selected.path }));
    setLibraryPath(selected.path);
    setPreview(null);
  }

  async function chooseMediaRoot() {
    const folder = await chooseFolder();
    if (folder) {
      setMediaRoot(folder);
      setPreview(null);
    }
  }

  async function chooseMappingTarget(index: number) {
    const folder = await chooseFolder();
    if (!folder) return;
    setRootMappings((current) => current.map((mapping, mappingIndex) => (
      mappingIndex === index ? { ...mapping, targetRoot: folder } : mapping
    )));
    setPreview(null);
  }

  async function chooseManagedRoot() {
    const folder = await chooseFolder();
    if (folder) setManagedRoot(folder);
  }

  async function cancelActiveJob(job: PhotoSourceJob | null = activeJob) {
    if (!job) return;
    try {
      const result = await cancelJob({ jobId: job.jobId });
      setJobs((current) => [result.value, ...current.filter((item) => item.jobId !== result.value.jobId)]);
    } catch (cancelError) {
      setError(errorText(cancelError));
    }
  }

  async function retry(job: PhotoSourceJob) {
    setError("");
    try {
      const result = await retryJob({ jobId: job.jobId });
      const next = result.value?.job;
      if (next) {
        setJobs((current) => [next, ...current]);
        setActiveJobId(next.jobId);
      }
    } catch (retryError) {
      setError(errorText(retryError));
    }
  }

  async function dismiss(job: PhotoSourceJob) {
    try {
      await dismissJob({ jobId: job.jobId });
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
    } catch (dismissError) {
      setError(errorText(dismissError));
    }
  }

  async function reviewHint(hint: PhotoSourcePeopleHint, decision: "accepted" | "rejected") {
    const personName = String(peopleNames[hint.hintId] || hint.personName || "").trim();
    if (decision === "accepted" && !personName) return;
    setReviewingHintId(hint.hintId);
    setError("");
    try {
      await reviewPeopleHint({ hintId: hint.hintId, decision, personName });
      await refreshPeopleHints(provider, selectedSourceId);
      setNotice(decision === "accepted" ? uiText("People hint accepted.") : uiText("People hint dismissed."));
    } catch (reviewError) {
      setError(errorText(reviewError));
    } finally {
      setReviewingHintId("");
    }
  }

  function toggleRevokeScope(scope: string, selected: boolean) {
    setRevokeScopes((current) => {
      const next = new Set(current);
      if (selected) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  async function revokeSelectedConsent() {
    if (!selectedSourceId || !revokeScopes.size || jobActive(activeJob)) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await revokeConsent({ sourceId: selectedSourceId, scopes: [...revokeScopes] });
      const job = result.value?.job;
      if (job) {
        setJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
        setActiveJobId(job.jobId);
      }
    } catch (revokeError) {
      setError(errorText(revokeError));
    } finally {
      setLoading(false);
    }
  }

  async function openSystemPrivacySettings() {
    const result = await openPrivacySettings();
    if (!result.ok) setError(result.error || uiText("Could not open photo privacy settings."));
  }

  function toggleSample(externalId: string) {
    setSelectedExternalIds((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  }

  return (
    <>
      <button ref={launcherRef} type="button" className="secondary photo-source-launcher" onClick={() => setOpen(true)}>
        <Images size={15} />
        <span>{uiText("Import images")}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="photo-source-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section ref={dialogRef} className="photo-source-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-source-title">
            <header className="photo-source-dialog-head">
              <div>
                <h3 id="photo-source-title">{uiText("Import images")}</h3>
                <span>{sourceMode === "online" ? uiText("Online and cloud sources") : uiText(sourceLabel(provider))}</span>
              </div>
              <button ref={closeButtonRef} type="button" className="ghost icon-only" onClick={closeDialog} disabled={jobActive(activeJob)} aria-label={uiText("Close")} title={uiText("Close")}>
                <X size={17} />
              </button>
            </header>

            <div className="photo-source-provider-tabs" role="tablist" aria-label={uiText("Photo source")}>
              <button id="photo-source-tab-apple" type="button" role="tab" aria-controls="photo-source-panel" aria-selected={sourceMode === "local" && provider === "apple_photos"} tabIndex={sourceMode === "local" && provider === "apple_photos" ? 0 : -1} className={sourceMode === "local" && provider === "apple_photos" ? "active" : ""} onKeyDown={moveProviderTabFocus} onClick={() => { setSourceMode("local"); setProviderAndReset("apple_photos"); }}>
                {uiText("Apple Photos")}
              </button>
              <button id="photo-source-tab-folders" type="button" role="tab" aria-controls="photo-source-panel" aria-selected={sourceMode === "local" && provider === "windows_folders"} tabIndex={sourceMode === "local" && provider === "windows_folders" ? 0 : -1} className={sourceMode === "local" && provider === "windows_folders" ? "active" : ""} onKeyDown={moveProviderTabFocus} onClick={() => { setSourceMode("local"); setProviderAndReset("windows_folders"); }}>
                {uiText("Photo folders")}
              </button>
              <button id="photo-source-tab-dam" type="button" role="tab" aria-controls="photo-source-panel" aria-selected={sourceMode === "dam"} tabIndex={sourceMode === "dam" ? 0 : -1} className={sourceMode === "dam" ? "active" : ""} onKeyDown={moveProviderTabFocus} onClick={() => { setSourceMode("dam"); if (!isDamProvider(provider)) setProviderAndReset("lightroom_catalog"); }}>
                {uiText("Pro catalogs")}
              </button>
              <button id="photo-source-tab-online" type="button" role="tab" aria-controls="photo-source-panel" aria-selected={sourceMode === "online"} tabIndex={sourceMode === "online" ? 0 : -1} className={sourceMode === "online" ? "active" : ""} onKeyDown={moveProviderTabFocus} onClick={() => setSourceMode("online")}>
                {uiText("Online & cloud")}
              </button>
            </div>

            <div id="photo-source-panel" className="photo-source-dialog-body" role="tabpanel">
              {sourceMode === "online" ? (
                <InboundConnectorPanel uiText={uiText} formatCount={formatCount} onLibraryChanged={onLibraryChanged} />
              ) : (<>
              <section className="photo-source-band photo-source-picker-band">
                <div className="photo-source-band-head">
                  <strong>{uiText("Source")}</strong>
                  <button type="button" className="ghost icon-only" onClick={() => void loadProvider(provider)} disabled={loading} aria-label={uiText("Refresh sources")}>
                    <RefreshCcw size={14} />
                  </button>
                </div>
                {damProvider && (
                  <label className="photo-source-dam-provider-row">
                    <span>{uiText("Catalog app")}</span>
                    <select
                      value={provider}
                      onChange={(event) => setProviderAndReset(event.currentTarget.value as DamPhotoSourceProvider)}
                    >
                      <option value="lightroom_catalog">{uiText("Lightroom Classic")}</option>
                      <option value="capture_one_catalog">{uiText("Capture One")}</option>
                    </select>
                  </label>
                )}
                <div className="photo-source-picker-row">
                  {damProvider ? (
                    <input
                      type="text"
                      readOnly
                      value={libraryPath}
                      title={libraryPath}
                      placeholder={uiText("Choose catalog")}
                      aria-label={uiText("DAM catalog")}
                    />
                  ) : (
                    <select aria-label={uiText("Photo library")} value={libraryPath} onChange={(event) => { setLibraryPath(event.currentTarget.value); setPreview(null); }}>
                      <option value="">{uiText("Select source")}</option>
                      {libraries.map((library) => (
                        <option key={library.libraryId} value={library.path} disabled={!library.available}>
                          {library.name}{library.systemLibrary ? ` (${uiText("System")})` : ""}{!library.available ? ` (${uiText("Unavailable")})` : ""}
                        </option>
                      ))}
                      {customFolderPath && !libraries.some((library) => library.path === customFolderPath) && (
                        <option value={customFolderPath}>{customFolderPath}</option>
                      )}
                    </select>
                  )}
                  {provider === "windows_folders" && (
                    <button type="button" className="secondary icon-only" onClick={() => void chooseCustomFolder()} aria-label={uiText("Choose folder")}>
                      <FolderOpen size={15} />
                    </button>
                  )}
                  {damProvider && (
                    <button type="button" className="secondary icon-only" onClick={() => void chooseDamCatalogPath()} aria-label={uiText("Choose catalog")} title={uiText("Choose catalog")}>
                      <FolderOpen size={15} />
                    </button>
                  )}
                </div>
                <div className={`photo-source-status ${status?.available && selectedLibraryReady ? "ok" : "warn"}`} role="status" aria-live="polite">
                  {loading ? <Loader2 size={14} className="spin" /> : status?.available && selectedLibraryReady ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  <span>{!status?.available
                    ? status?.error || uiText("Unavailable")
                    : selectedLibrary?.status === "permission_denied"
                      ? uiText("Photo library permission is required")
                      : selectedLibrary?.status === "missing"
                        ? uiText("Photo library is missing")
                        : uiText("Ready")}</span>
                  {status?.dependencyVersion && <small>{status.dependencyVersion}</small>}
                  {provider === "apple_photos" && selectedLibrary?.status === "permission_denied" && (
                    <button type="button" className="ghost compact-action" onClick={() => void openSystemPrivacySettings()}>
                      <ExternalLink size={13} />
                      <span>{uiText("Open privacy settings")}</span>
                    </button>
                  )}
                </div>
              </section>

              <section className="photo-source-band">
                <div className="photo-source-band-head"><strong>{uiText("Import scope")}</strong></div>
                <div className="photo-source-scope-grid">
                  {visibleScopeRows.map((row) => (
                    <label key={row.key} className={SENSITIVE_SCOPE_KEYS.includes(row.key) ? "sensitive" : ""}>
                      <input type="checkbox" checked={scopes[row.key]} onChange={(event) => updateScope(row.key, event.currentTarget.checked)} />
                      <span>{uiText(row.label)}</span>
                      {SENSITIVE_SCOPE_KEYS.includes(row.key) && <ShieldCheck size={13} />}
                    </label>
                  ))}
                </div>
                {selectedSensitiveScopes.length > 0 && (
                  <label className="photo-source-consent-row">
                    <input type="checkbox" checked={sensitiveConsent} onChange={(event) => setSensitiveConsent(event.currentTarget.checked)} />
                    <span>{uiText("Allow selected sensitive metadata")}</span>
                  </label>
                )}
              </section>

              <section className="photo-source-band photo-source-storage-band">
                <div className="photo-source-band-head"><strong>{uiText("Storage")}</strong></div>
                <div className="photo-source-segmented" role="group" aria-label={uiText("Storage mode")}>
                  <button type="button" className={storageMode === "referenced" ? "active" : ""} onClick={() => setStorageMode("referenced")}>{uiText("Referenced")}</button>
                  <button type="button" className={storageMode === "managed" ? "active" : ""} onClick={() => setStorageMode("managed")}>{uiText("Managed")}</button>
                </div>
                {storageMode === "managed" && (
                  <div className="photo-source-managed-row">
                    <span title={managedRoot}>{managedRoot || uiText("Workspace photo library")}</span>
                    <button type="button" className="secondary icon-only" onClick={() => void chooseManagedRoot()} aria-label={uiText("Choose managed library folder")}>
                      <FolderOpen size={15} />
                    </button>
                  </div>
                )}
                {damProvider && (
                  <div className="photo-source-dam-relocation">
                    <div className="photo-source-dam-relocation-head">
                      <span>{uiText("Relocated media")}</span>
                      <button
                        type="button"
                        className="ghost compact-action"
                        onClick={() => setRootMappings((current) => [...current, { sourceRoot: "", targetRoot: "" }])}
                      >
                        <Plus size={13} />
                        <span>{uiText("Add root mapping")}</span>
                      </button>
                    </div>
                    <div className="photo-source-managed-row">
                      <span title={mediaRoot}>{mediaRoot || uiText("Use catalog media paths")}</span>
                      <button type="button" className="secondary icon-only" onClick={() => void chooseMediaRoot()} aria-label={uiText("Choose relocated media folder")} title={uiText("Choose relocated media folder")}>
                        <FolderOpen size={15} />
                      </button>
                    </div>
                    {rootMappings.map((mapping, index) => (
                      <div className="photo-source-dam-mapping" key={`dam-mapping-${index}`}>
                        <input
                          type="text"
                          value={mapping.sourceRoot}
                          onChange={(event) => {
                            const sourceRoot = event.currentTarget.value;
                            setRootMappings((current) => current.map((item, mappingIndex) => mappingIndex === index ? { ...item, sourceRoot } : item));
                            setPreview(null);
                          }}
                          placeholder={uiText("Original catalog root")}
                          aria-label={`${uiText("Original catalog root")} ${index + 1}`}
                        />
                        <span title={mapping.targetRoot}>{mapping.targetRoot || uiText("Current media folder")}</span>
                        <button type="button" className="secondary icon-only" onClick={() => void chooseMappingTarget(index)} aria-label={uiText("Choose current media folder")} title={uiText("Choose current media folder")}>
                          <FolderOpen size={14} />
                        </button>
                        <button type="button" className="ghost icon-only" onClick={() => setRootMappings((current) => current.filter((_, mappingIndex) => mappingIndex !== index))} aria-label={uiText("Remove root mapping")} title={uiText("Remove root mapping")}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {provider === "apple_photos" && (
                  <>
                    <label className="photo-source-option-row">
                      <input type="checkbox" checked={preferEdited} onChange={(event) => setPreferEdited(event.currentTarget.checked)} />
                      <span>{uiText("Prefer edited versions")}</span>
                    </label>
                    <label className="photo-source-option-row">
                      <input type="checkbox" checked={allowPhotosExport} onChange={(event) => { setAllowPhotosExport(event.currentTarget.checked); if (!event.currentTarget.checked) setCloudDownloadConsent(false); }} />
                      <CloudDownload size={14} />
                      <span>{uiText("Export missing originals through Photos")}</span>
                    </label>
                    {allowPhotosExport && (
                      <label className="photo-source-consent-row">
                        <input type="checkbox" checked={cloudDownloadConsent} onChange={(event) => setCloudDownloadConsent(event.currentTarget.checked)} />
                        <span>{uiText("Allow explicit iCloud download for this action")}</span>
                      </label>
                    )}
                  </>
                )}
                <label className="photo-source-removal-row">
                  <span>{uiText("Items removed from source")}</span>
                  <select value={removedPolicy} onChange={(event) => setRemovedPolicy(event.currentTarget.value === "trash" ? "trash" : "keep")}>
                    <option value="keep">{uiText("Keep in Vintrace")}</option>
                    <option value="trash">{uiText("Move to Recently Deleted")}</option>
                  </select>
                </label>
              </section>

              {preview && (
                <section className="photo-source-band photo-source-preview-band">
                  <div className="photo-source-band-head">
                    <strong>{uiText("Preview")}</strong>
                    <span>{preview.complete ? uiText("Complete") : uiText("Bounded")}</span>
                  </div>
                  <div className="photo-source-count-grid">
                    {Object.entries(preview.counts).filter(([, value]) => value > 0).slice(0, 12).map(([key, value]) => (
                      <span key={key}><small>{uiText(key.replace(/([A-Z])/g, " $1"))}</small><strong>{formatCount(value)}</strong></span>
                    ))}
                  </div>
                  {preview.warnings.map((warning) => (
                    <div className="photo-source-inline-warning" key={warning.code}>
                      <AlertTriangle size={13} />
                      <span>{warning.message}</span>
                      {provider === "apple_photos" && warning.code === "apple-photos-missing-originals" && !allowPhotosExport && (
                        <button type="button" className="ghost compact-action" onClick={() => setAllowPhotosExport(true)}>
                          <CloudDownload size={13} />
                          <span>{uiText("Enable explicit Photos export")}</span>
                        </button>
                      )}
                    </div>
                  ))}
                  {preview.samples.length > 0 && (
                    <div className="photo-source-samples" role="list" aria-label={uiText("Preview items")}>
                      {preview.samples.map((sample) => (
                        <label key={sample.externalId} role="listitem">
                          <input type="checkbox" checked={selectedExternalIds.has(sample.externalId)} onChange={() => toggleSample(sample.externalId)} />
                          <span title={sample.filename}><strong>{sample.title || sample.filename}</strong><small>{[sample.mediaKind, sample.captureDate].filter(Boolean).join(" · ")}</small></span>
                          {sample.missing && <CloudDownload size={13} />}
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {peopleHintTotal > 0 && (
                <section className="photo-source-band photo-source-people-review">
                  <div className="photo-source-band-head">
                    <strong>{uiText("People hints to review")}</strong>
                    <span>{formatCount(peopleHintTotal)}</span>
                  </div>
                  <div className="photo-source-people-list" role="list" aria-label={uiText("Pending people hints")}>
                    {peopleHints.map((hint) => (
                      <div className="photo-source-people-row" role="listitem" key={hint.hintId}>
                        <span title={hint.sourcePath}>
                          <strong>{hint.filename || uiText("Photo")}</strong>
                          <small>{uiText("Imported name hint")}</small>
                        </span>
                        <input
                          type="text"
                          value={peopleNames[hint.hintId] ?? hint.personName}
                          onChange={(event) => setPeopleNames((current) => ({ ...current, [hint.hintId]: event.currentTarget.value }))}
                          aria-label={`${uiText("Person name")} ${hint.filename}`}
                        />
                        <button
                          type="button"
                          className="ghost icon-only"
                          onClick={() => void reviewHint(hint, "accepted")}
                          disabled={reviewingHintId === hint.hintId || !String(peopleNames[hint.hintId] ?? hint.personName).trim()}
                          aria-label={uiText("Accept people hint")}
                          title={uiText("Accept people hint")}
                        >
                          {reviewingHintId === hint.hintId ? <Loader2 size={14} className="spin" /> : <UserCheck size={14} />}
                        </button>
                        <button
                          type="button"
                          className="ghost icon-only"
                          onClick={() => void reviewHint(hint, "rejected")}
                          disabled={reviewingHintId === hint.hintId}
                          aria-label={uiText("Dismiss people hint")}
                          title={uiText("Dismiss people hint")}
                        >
                          <UserX size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {selectedSourceId && selectedConsentScopes.length > 0 && (
                <section className="photo-source-band photo-source-privacy-controls">
                  <div className="photo-source-band-head">
                    <strong>{uiText("Imported sensitive metadata")}</strong>
                    <ShieldOff size={14} />
                  </div>
                  <div className="photo-source-revoke-scopes">
                    {selectedConsentScopes.map((scope) => {
                      const row = SCOPE_ROWS.find((candidate) => candidate.key === scope);
                      return (
                        <label key={scope}>
                          <input type="checkbox" checked={revokeScopes.has(scope)} onChange={(event) => toggleRevokeScope(scope, event.currentTarget.checked)} />
                          <span>{uiText(row?.label || scope)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="photo-source-revoke-action">
                    <span>{uiText("Removes imported metadata from Vintrace only. Source photos are never changed.")}</span>
                    <button type="button" className="secondary" onClick={() => void revokeSelectedConsent()} disabled={!revokeScopes.size || loading || jobActive(activeJob)}>
                      <ShieldOff size={14} />
                      <span>{uiText("Remove selected metadata")}</span>
                    </button>
                  </div>
                </section>
              )}

              {providerJobs.length > 0 && (
                <section className="photo-source-band photo-source-jobs-band">
                  <div className="photo-source-band-head"><strong>{uiText("Recent source jobs")}</strong></div>
                  <div className="photo-source-job-list">
                    {providerJobs.slice(0, 8).map((job) => {
                      const progress = job.progress || { phase: job.status };
                      const processed = Number(progress.processed || 0);
                      const total = Number(progress.total || 0);
                      const percent = total > 0 ? Math.min(100, (processed / total) * 100) : job.status === "completed" ? 100 : 0;
                      const failures = Array.isArray(job.result?.failures) ? job.result.failures : [];
                      const normalizedFailureQuery = failureQuery.trim().toLowerCase();
                      const matchingFailures = failures.filter((failure) => !normalizedFailureQuery || [
                        failure.filename,
                        failure.externalId,
                        failure.reason,
                      ].some((value) => String(value || "").toLowerCase().includes(normalizedFailureQuery)));
                      return (
                        <div className="photo-source-job-entry" key={job.jobId}>
                          <div className={`photo-source-job-row ${job.status}`}>
                            <span className="photo-source-job-icon">{jobActive(job) ? <Loader2 size={14} className="spin" /> : job.status === "completed" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span>
                            <span><strong>{uiText(job.jobKind)}</strong><small>{progress.message || job.error || formatTimestamp(job.updatedAt)}</small></span>
                            <div
                              className="photo-source-job-progress"
                              role="progressbar"
                              aria-label={uiText("Job progress")}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(percent)}
                            ><i style={{ width: `${percent}%` }} /></div>
                            {jobActive(job) ? (
                              <button type="button" className="ghost icon-only" onClick={() => { setActiveJobId(job.jobId); void cancelActiveJob(job); }} aria-label={uiText("Cancel job")} title={uiText("Cancel job")}><X size={14} /></button>
                            ) : job.status === "failed" || job.status === "cancelled" ? (
                              <button type="button" className="ghost icon-only" onClick={() => void retry(job)} aria-label={uiText("Retry job")} title={uiText("Retry job")}><RotateCcw size={14} /></button>
                            ) : (
                              <button type="button" className="ghost icon-only" onClick={() => void dismiss(job)} aria-label={uiText("Dismiss job")} title={uiText("Dismiss job")}><X size={14} /></button>
                            )}
                          </div>
                          {failures.length > 0 && (
                            <div className="photo-source-job-failures">
                              <button
                                type="button"
                                className="ghost photo-source-job-detail-toggle"
                                aria-expanded={expandedJobId === job.jobId}
                                onClick={() => {
                                  setExpandedJobId((current) => current === job.jobId ? "" : job.jobId);
                                  setFailureQuery("");
                                }}
                              >
                                <AlertTriangle size={13} />
                                <span>{formatCount(Number(job.result.failureCount || failures.length))} {uiText("failed items")}</span>
                                <ChevronDown size={13} />
                              </button>
                              {expandedJobId === job.jobId && (
                                <div className="photo-source-job-failure-body">
                                  <label className="photo-source-failure-search">
                                    <Search size={13} />
                                    <input type="search" value={failureQuery} onChange={(event) => setFailureQuery(event.currentTarget.value)} placeholder={uiText("Filter failed items")} aria-label={uiText("Filter failed items")} />
                                  </label>
                                  <div className="photo-source-failure-list" role="list">
                                    {matchingFailures.map((failure, index) => (
                                      <div role="listitem" key={`${failure.externalId}:${index}`}>
                                        <strong>{failure.filename || failure.externalId || uiText("Unknown item")}</strong>
                                        <small>{failure.reason}</small>
                                      </div>
                                    ))}
                                    {!matchingFailures.length && <span>{uiText("No failed items match this filter.")}</span>}
                                  </div>
                                  {job.result.failureSummaryTruncated && <small>{uiText("Only the first 500 failures are shown.")}</small>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {error && <div className="photo-source-message error" role="alert" aria-live="assertive"><AlertTriangle size={14} /><span>{error}</span></div>}
              {notice && <div className="photo-source-message ok" role="status" aria-live="polite"><CheckCircle2 size={14} /><span>{notice}</span></div>}
              </>)}
            </div>

            {sourceMode !== "online" && <footer className="photo-source-dialog-actions">
              <button type="button" className="secondary" onClick={() => void runPreview()} disabled={!sourceReady || loading || jobActive(activeJob)}>
                {loading ? <Loader2 size={15} className="spin" /> : <RefreshCcw size={15} />}
                <span>{uiText("Preview")}</span>
              </button>
              {provider === "apple_photos" && selectedExternalIds.size > 0 && (
                <button type="button" className="secondary" onClick={() => void exportSelected()} disabled={!sourceReady || loading || jobActive(activeJob)}>
                  <Download size={15} />
                  <span>{uiText("Export selected")}</span>
                </button>
              )}
              <button type="button" className="secondary" onClick={() => void startJob("sync")} disabled={!sourceReady || loading || jobActive(activeJob)}>
                <RefreshCcw size={15} />
                <span>{uiText("Sync")}</span>
              </button>
              <button type="button" className="primary" onClick={() => void startJob("import")} disabled={!sourceReady || loading || jobActive(activeJob)}>
                <Images size={15} />
                <span>{selectedExternalIds.size ? `${uiText("Import selected")} (${formatCount(selectedExternalIds.size)})` : uiText("Import")}</span>
              </button>
            </footer>}
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
