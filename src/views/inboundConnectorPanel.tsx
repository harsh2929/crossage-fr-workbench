import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudDownload,
  Globe2,
  HardDrive,
  Link,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  InboundConnectorCredentialSummary,
  InboundConnectorsValue,
  PhotoSourceJob,
  PhotoSourceJobStartValue,
  PhotoSourceJobStatusValue,
  PhotoSourcePreviewValue,
  RemotePhotoSourceProvider,
} from "../types";


type ConnectorDefinition = {
  provider: RemotePhotoSourceProvider;
  label: string;
  detail: string;
  credentialLabel: string;
  icon: typeof Cloud;
};

const CONNECTORS: ConnectorDefinition[] = [
  { provider: "slack", label: "Slack", detail: "Images shared in channels your app can read.", credentialLabel: "Slack bot or user token", icon: MessageSquare },
  { provider: "web", label: "Web pages", detail: "Public page, gallery, and direct image URLs.", credentialLabel: "No credential required", icon: Globe2 },
  { provider: "google_drive", label: "Google Drive", detail: "Images and videos from My Drive or a shared drive folder.", credentialLabel: "OAuth access token", icon: HardDrive },
  { provider: "onedrive", label: "OneDrive", detail: "Images and videos available through Microsoft Graph.", credentialLabel: "OAuth access token", icon: Cloud },
  { provider: "dropbox", label: "Dropbox", detail: "A read-only Dropbox folder with recursive sync.", credentialLabel: "OAuth access token", icon: Cloud },
  { provider: "webdav", label: "WebDAV", detail: "Standards-based read-only media storage.", credentialLabel: "Bearer token or account password", icon: Link },
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Inbound connector action failed.");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "source";
}

function activeJob(job: PhotoSourceJob | null) {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

export function InboundConnectorPanel(props: {
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onLibraryChanged?: (job: PhotoSourceJob) => void | Promise<void>;
}) {
  const { uiText, formatCount, onLibraryChanged } = props;
  const [catalog, setCatalog] = useState<InboundConnectorsValue | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState("");
  const [provider, setProvider] = useState<RemotePhotoSourceProvider>("slack");
  const [displayName, setDisplayName] = useState("Design Slack");
  const [accessToken, setAccessToken] = useState("");
  const [channelIds, setChannelIds] = useState("");
  const [urls, setUrls] = useState("");
  const [folderId, setFolderId] = useState("root");
  const [folderPath, setFolderPath] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(true);
  const [preview, setPreview] = useState<PhotoSourcePreviewValue | null>(null);
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(new Set());
  const [downloadConsent, setDownloadConsent] = useState(false);
  const [removedPolicy, setRemovedPolicy] = useState<"keep" | "trash">("keep");
  const [job, setJob] = useState<PhotoSourceJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  const completedIds = useRef(new Set<string>());

  const selected = useMemo(
    () => catalog?.credentials.find((row) => `${row.provider}:${row.connectionId}` === selectedId) || null,
    [catalog, selectedId]
  );
  const selectedDefinition = CONNECTORS.find((row) => row.provider === selected?.provider);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const next = await window.crossAge.listInboundConnectors();
      setCatalog(next);
      setSelectedId((current) => current || (next.credentials[0] ? `${next.credentials[0].provider}:${next.credentials[0].connectionId}` : ""));
    } catch (nextError) {
      setError(errorText(nextError));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!job?.jobId || !activeJob(job)) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await window.crossAge.invoke<{ value: PhotoSourceJobStatusValue }>("photo_source_job_status", { jobId: job.jobId });
        const next = result.value?.job || null;
        if (cancelled || !next) return;
        setJob(next);
        if (next.status === "completed" && !completedIds.current.has(next.jobId)) {
          completedIds.current.add(next.jobId);
          setNotice(next.jobKind === "sync" ? uiText("Online source synced into the library.") : uiText("Online media imported into the library."));
          if (onLibraryChanged) await onLibraryChanged(next);
          await refresh();
          return;
        }
        if (next.status === "failed" || next.status === "cancelled") {
          setError(next.error || next.progress?.message || uiText("Connector job did not complete."));
          return;
        }
        timer = window.setTimeout(poll, 1_200);
      } catch (pollError) {
        if (!cancelled) setError(errorText(pollError));
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [job?.jobId, job?.status, onLibraryChanged, refresh, uiText]);

  function resetForm(nextProvider: RemotePhotoSourceProvider = provider) {
    setEditingConnectionId("");
    setProvider(nextProvider);
    const definition = CONNECTORS.find((row) => row.provider === nextProvider);
    setDisplayName(definition?.label || "Online source");
    setAccessToken("");
    setChannelIds("");
    setUrls("");
    setFolderId("root");
    setFolderPath("");
    setBaseUrl("");
    setUsername("");
    setPassword("");
    setRecursive(true);
    setIncludeVideos(true);
    setError("");
    setNotice("");
  }

  function editSelected() {
    if (!selected) return;
    const config = selected.config || {};
    const text = (key: string, fallback = "") => typeof config[key] === "string" ? String(config[key]) : fallback;
    const lines = (key: string) => Array.isArray(config[key]) ? (config[key] as unknown[]).map(String).join(key === "urls" ? "\n" : ", ") : "";
    setProvider(selected.provider);
    setEditingConnectionId(selected.connectionId);
    setDisplayName(selected.displayName);
    setAccessToken("");
    setChannelIds(lines("channelIds"));
    setUrls(lines("urls"));
    setFolderId(text("folderId", "root"));
    setFolderPath(text("folderPath"));
    setBaseUrl(text("baseUrl"));
    setUsername(text("username"));
    setPassword("");
    setRecursive(config.recursive !== false);
    setIncludeVideos(config.includeVideos !== false);
    setError("");
    setNotice(uiText(selected.provider === "web" ? "Update this connection." : "Enter a fresh credential to update this connection."));
    setEditing(true);
  }

  async function save() {
    const definition = CONNECTORS.find((row) => row.provider === provider);
    const connectionId = editingConnectionId || `${slug(displayName || definition?.label || provider)}-${Date.now().toString(36)}`;
    setBusy(true);
    setError("");
    try {
      const config: Record<string, unknown> = {
        accessToken,
        channelIds: channelIds.split(/[\s,]+/).map((row) => row.trim()).filter(Boolean),
        urls: urls.split(/\r?\n/).map((row) => row.trim()).filter(Boolean),
        folderId: folderId || "root",
        folderPath,
        baseUrl,
        username,
        password,
        recursive,
        includeVideos,
        maxItems: 2_000,
        maxPages: 10,
      };
      const saved = await window.crossAge.saveInboundConnector({ provider, connectionId, displayName, config });
      await refresh();
      setSelectedId(`${saved.provider}:${saved.connectionId}`);
      setEditing(false);
      setEditingConnectionId("");
      setAccessToken("");
      setPassword("");
      const persistence = typeof saved.configured?.credentialPersistence === "string"
        ? saved.configured.credentialPersistence
        : "";
      setNotice(uiText(
        provider !== "web" && persistence && persistence !== "os-vault"
          ? "Connection saved for the desktop. Reconnect after restarting a standalone agent server on this OS."
          : "Connection saved with OS-backed encryption."
      ));
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.crossAge.invokeInboundConnector<{ value: PhotoSourcePreviewValue }>(selected.provider, selected.connectionId, "preview", {
        itemLimit: 5_000,
        sampleLimit: 40,
        timeBudgetMs: 2_000,
      });
      setPreview(result.value || null);
      setSelectedExternalIds(new Set());
    } catch (previewError) {
      setError(errorText(previewError));
    } finally {
      setBusy(false);
    }
  }

  async function startJob(kind: "import" | "sync") {
    if (!selected || !downloadConsent || activeJob(job)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.crossAge.invokeInboundConnector<{ value: PhotoSourceJobStartValue }>(selected.provider, selected.connectionId, kind, {
        explicitExternalDownloadConsent: true,
        storageMode: "managed",
        removedPolicy,
        ...(selectedExternalIds.size ? { externalIds: [...selectedExternalIds] } : {}),
      });
      setJob(result.value?.job || null);
    } catch (jobError) {
      setError(errorText(jobError));
    } finally {
      setBusy(false);
    }
  }

  async function cancelJob() {
    if (!job || !activeJob(job)) return;
    try {
      const result = await window.crossAge.invoke<{ value: PhotoSourceJob }>("cancel_photo_source_job", { jobId: job.jobId });
      setJob(result.value);
    } catch (cancelError) {
      setError(errorText(cancelError));
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setBusy(true);
    try {
      await window.crossAge.removeInboundConnector(selected.provider, selected.connectionId);
      setSelectedId("");
      setPreview(null);
      setRemoveArmed(false);
      await refresh();
      setNotice(uiText("Connection and encrypted credentials removed. Imported managed copies remain in Vintrace."));
    } catch (removeError) {
      setError(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  function toggleSample(externalId: string) {
    setSelectedExternalIds((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  }

  if (!catalog) {
    return <div className="inbound-connector-loading" role="status"><Loader2 className="spin" size={16} /> {uiText("Loading online sources…")}</div>;
  }

  return (
    <div className="inbound-connectors">
      <div className="inbound-connector-policy" role="note">
        <ShieldCheck size={18} />
        <span><strong>{uiText("Discover first. Download only after approval.")}</strong><small>{uiText("Preview reads bounded metadata. Imports create managed local copies, receive stable asset IDs, and enter the same Safe Mode and review pipeline as every other image.")}</small></span>
      </div>

      {!catalog.encryptionAvailable && (
        <div className="photo-source-message error"><AlertTriangle size={14} /><span>{uiText("OS-backed encryption is unavailable, so connector credentials cannot be saved safely on this computer.")}</span></div>
      )}

      <div className="inbound-connector-layout">
        <aside className="inbound-connector-sidebar" aria-label={uiText("Online sources")}>
          <div className="inbound-connector-sidebar-head">
            <strong>{uiText("Connections")}</strong>
            <button type="button" className="ghost icon-only" onClick={() => { resetForm(); setEditing(true); }} disabled={!catalog.encryptionAvailable} aria-label={uiText("Add online source")}><Plus size={15} /></button>
          </div>
          {catalog.credentials.length ? catalog.credentials.map((row) => {
            const definition = CONNECTORS.find((item) => item.provider === row.provider);
            const Icon = definition?.icon || Cloud;
            const key = `${row.provider}:${row.connectionId}`;
            return (
              <button key={key} type="button" className={selectedId === key && !editing ? "inbound-connector-source active" : "inbound-connector-source"} onClick={() => { setSelectedId(key); setEditing(false); setPreview(null); setDownloadConsent(false); setRemoveArmed(false); }}>
                <Icon size={17} />
                <span><strong>{row.displayName}</strong><small>{definition?.label || row.provider}</small></span>
                <CheckCircle2 size={14} />
              </button>
            );
          }) : (
            <button type="button" className="inbound-connector-empty-source" onClick={() => setEditing(true)} disabled={!catalog.encryptionAvailable}><Plus size={18} /><span>{uiText("Add your first online source")}</span></button>
          )}
        </aside>

        <main className="inbound-connector-main">
          {editing ? (
            <section className="photo-source-band inbound-connector-form" aria-label={uiText("Configure online source")}>
              <div className="photo-source-band-head"><strong>{uiText("Connect a read-only source")}</strong><span><LockKeyhole size={13} /> {uiText("OS encrypted")}</span></div>
              <div className="inbound-connector-provider-grid" role="radiogroup" aria-label={uiText("Connector provider")}>
                {CONNECTORS.map((definition) => {
                  const Icon = definition.icon;
                  return <button key={definition.provider} type="button" role="radio" aria-checked={provider === definition.provider} className={provider === definition.provider ? "active" : ""} onClick={() => resetForm(definition.provider)}><Icon size={16} /><span><strong>{definition.label}</strong><small>{definition.detail}</small></span></button>;
                })}
              </div>
              <label>{uiText("Connection name")}<input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} maxLength={120} /></label>
              {provider === "web" ? (
                <label>{uiText("Page or image URLs")}<textarea value={urls} onChange={(event) => setUrls(event.currentTarget.value)} rows={4} placeholder="https://example.com/gallery" /></label>
              ) : (
                <label>{uiText(CONNECTORS.find((row) => row.provider === provider)?.credentialLabel || "Access token")}<input type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.currentTarget.value)} /></label>
              )}
              {provider === "slack" && <label>{uiText("Channel IDs")}<input value={channelIds} onChange={(event) => setChannelIds(event.currentTarget.value)} placeholder="C012345, C067890" /><small>{uiText("Leave empty to discover all files visible to the token.")}</small></label>}
              {provider === "slack" && <div className="photo-source-message"><ShieldCheck size={14} /><span>{uiText("Use a token with files:read. Private-channel files are visible only where that Slack identity is already a member.")}</span></div>}
              {provider === "google_drive" && <div className="photo-source-message"><ShieldCheck size={14} /><span>{uiText("Use a read-only Drive OAuth token; Vintrace never asks for write access to the source.")}</span></div>}
              {provider === "onedrive" && <div className="photo-source-message"><ShieldCheck size={14} /><span>{uiText("Use a Microsoft Graph Files.Read token. Source files remain unchanged.")}</span></div>}
              {(provider === "google_drive" || provider === "onedrive") && <label>{uiText("Folder ID")}<input value={folderId} onChange={(event) => setFolderId(event.currentTarget.value)} placeholder="root" /></label>}
              {provider === "dropbox" && <label>{uiText("Folder path")}<input value={folderPath} onChange={(event) => setFolderPath(event.currentTarget.value)} placeholder="/Photos" /></label>}
              {provider === "webdav" && <><label>{uiText("WebDAV URL")}<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="https://dav.example.com/photos/" /></label><div className="inbound-connector-two"><label>{uiText("Username")}<input value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoComplete="username" /></label><label>{uiText("Password")}<input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete="new-password" /></label></div></>}
              <div className="inbound-connector-two"><label className="photo-source-option-row"><input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.currentTarget.checked)} /><span>{uiText("Include nested folders or pages")}</span></label><label className="photo-source-option-row"><input type="checkbox" checked={includeVideos} onChange={(event) => setIncludeVideos(event.currentTarget.checked)} /><span>{uiText("Include videos")}</span></label></div>
              <div className="button-row"><button type="button" className="ghost" onClick={() => { setEditing(false); setEditingConnectionId(""); }}>{uiText("Cancel")}</button><button type="button" className="primary" onClick={() => void save()} disabled={busy || !displayName.trim() || (provider === "web" ? !urls.trim() : provider === "webdav" ? !baseUrl.trim() || (!accessToken.trim() && (!username.trim() || !password)) : !accessToken.trim())}>{busy ? <Loader2 className="spin" size={15} /> : <LockKeyhole size={15} />}{uiText(editingConnectionId ? "Update connection" : "Save connection")}</button></div>
            </section>
          ) : selected ? (
            <>
              <section className="photo-source-band inbound-connector-overview">
                <div className="photo-source-band-head"><strong>{selected.displayName}</strong><span>{selectedDefinition?.label}</span></div>
                <div className="inbound-connector-status"><CheckCircle2 size={16} /><span><strong>{uiText(selected.provider === "web" ? "Connection ready" : "Credential ready")}</strong><small>{uiText(selected.provider === "web" ? "Public URLs are contacted only when you discover or import from this connection." : "The secret stays OS-encrypted and is supplied only to the backend for this connection.")}</small></span></div>
                <div className="button-row"><button type="button" className="secondary" onClick={() => void runPreview()} disabled={busy || activeJob(job)}>{busy ? <Loader2 className="spin" size={15} /> : <Globe2 size={15} />}{uiText("Discover metadata")}</button><button type="button" className="ghost" onClick={editSelected} disabled={busy || activeJob(job)}><RefreshCcw size={15} />{uiText("Update connection")}</button><button type="button" className={removeArmed ? "secondary danger" : "ghost"} onClick={() => void removeSelected()} disabled={busy || activeJob(job)}><Trash2 size={15} />{removeArmed ? uiText("Confirm remove connection") : uiText("Remove connection")}</button></div>
              </section>

              {preview && <section className="photo-source-band photo-source-preview-band">
                <div className="photo-source-band-head"><strong>{uiText("Discovery preview")}</strong><span>{preview.complete ? uiText("Complete") : uiText("Bounded")}</span></div>
                <div className="photo-source-count-grid">{Object.entries(preview.counts).filter(([, value]) => value > 0).slice(0, 8).map(([key, value]) => <span key={key}><small>{uiText(key.replace(/([A-Z])/g, " $1"))}</small><strong>{formatCount(value)}</strong></span>)}</div>
                {preview.samples.length > 0 && <div className="photo-source-samples" role="list" aria-label={uiText("Remote preview items")}>{preview.samples.map((sample) => <label key={sample.externalId} role="listitem"><input type="checkbox" checked={selectedExternalIds.has(sample.externalId)} onChange={() => toggleSample(sample.externalId)} /><span title={sample.filename}><strong>{sample.title || sample.filename}</strong><small>{[sample.mediaKind, sample.captureDate].filter(Boolean).join(" · ")}</small></span><CloudDownload size={13} /></label>)}</div>}
                <label className="photo-source-consent-row inbound-download-consent"><input type="checkbox" checked={downloadConsent} onChange={(event) => setDownloadConsent(event.currentTarget.checked)} /><ShieldCheck size={14} /><span><strong>{uiText("Download managed copies for this action")}</strong><small>{uiText("Selected remote bytes will be copied into your managed library, checked, assigned stable IDs, and processed locally.")}</small></span></label>
                <label className="photo-source-removal-row"><span>{uiText("If an item later disappears remotely")}</span><select value={removedPolicy} onChange={(event) => setRemovedPolicy(event.currentTarget.value === "trash" ? "trash" : "keep")}><option value="keep">{uiText("Keep the local copy")}</option><option value="trash">{uiText("Move local copy to Recently Deleted")}</option></select></label>
                <div className="button-row"><button type="button" className="secondary" onClick={() => void startJob("sync")} disabled={!downloadConsent || busy || activeJob(job)}><RefreshCcw size={15} />{uiText("Sync source")}</button><button type="button" className="primary" onClick={() => void startJob("import")} disabled={!downloadConsent || busy || activeJob(job)}><CloudDownload size={15} />{selectedExternalIds.size ? `${uiText("Import selected")} (${formatCount(selectedExternalIds.size)})` : uiText("Import discovered media")}</button></div>
              </section>}

              {job && <section className={`photo-source-band inbound-connector-job ${job.status}`} role="status"><span>{activeJob(job) ? <Loader2 className="spin" size={16} /> : job.status === "completed" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><span><strong>{uiText(`${job.jobKind} ${job.status}`)}</strong><small>{job.progress?.message || job.error || job.updatedAt}</small></span>{activeJob(job) && <button type="button" className="ghost" onClick={() => void cancelJob()}>{uiText("Cancel")}</button>}</section>}
            </>
          ) : <div className="inbound-connector-zero"><Cloud size={24} /><strong>{uiText("Connect an online image source")}</strong><span>{uiText("Slack, public web pages, Google Drive, OneDrive, Dropbox, and WebDAV all feed the same safe managed-library pipeline.")}</span><button type="button" className="primary" onClick={() => setEditing(true)} disabled={!catalog.encryptionAvailable}><Plus size={15} />{uiText("Add online source")}</button></div>}

          {error && <div className="photo-source-message error" role="alert"><AlertTriangle size={14} /><span>{error}</span></div>}
          {notice && <div className="photo-source-message ok" role="status"><CheckCircle2 size={14} /><span>{notice}</span></div>}
        </main>
      </div>
    </div>
  );
}
