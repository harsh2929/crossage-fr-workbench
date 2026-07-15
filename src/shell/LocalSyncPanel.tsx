import { useEffect, useState } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  KeyRound,
  Laptop,
  Link2,
  Loader2,
  LockKeyhole,
  Network,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type { LocalSyncConflictResult, LocalSyncInvitation, LocalSyncStatus } from "../types";

interface LocalSyncPanelProps {
  active: boolean;
  copyText(text: string, label?: string): void;
  uiText(source: string): string;
}

interface ValueResult<T> {
  value: T;
}

function formatDate(value: string, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : fallback;
}

async function invokeValue<T>(command: string, params: Record<string, unknown> = {}) {
  const result = await window.crossAge.invoke<ValueResult<T>>(command, params);
  return result.value;
}

export function LocalSyncPanel({ active, copyText, uiText }: LocalSyncPanelProps) {
  const [status, setStatus] = useState<LocalSyncStatus | null>(null);
  const [conflicts, setConflicts] = useState<LocalSyncConflictResult>({ total: 0, conflicts: [] });
  const [deviceLabel, setDeviceLabel] = useState("");
  const [discovery, setDiscovery] = useState(false);
  const [advertisedHost, setAdvertisedHost] = useState("");
  const [invitation, setInvitation] = useState<LocalSyncInvitation | null>(null);
  const [invitationQr, setInvitationQr] = useState("");
  const [incomingInvitation, setIncomingInvitation] = useState("");
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [recoveryBundle, setRecoveryBundle] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreBundle, setRestoreBundle] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setBusy((value) => value || "load");
    setError("");
    try {
      const next = await invokeValue<LocalSyncStatus>("local_sync_status");
      setStatus(next);
      setDeviceLabel((value) => value || next.deviceLabel);
      setDiscovery(next.server.discoveryEnabled);
      if (next.encryptionReady) {
        setConflicts(await invokeValue<LocalSyncConflictResult>("local_sync_conflicts", { limit: 20 }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy((value) => value === "load" ? "" : value);
    }
  }

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    if (!invitation?.invitation) {
      setInvitationQr("");
      return;
    }
    QRCode.toDataURL(invitation.invitation, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: { dark: "#17191cff", light: "#ffffffff" },
    }).then((value) => {
      if (!cancelled) setInvitationQr(value);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [invitation]);

  async function run(key: string, action: () => Promise<void>, success = "") {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await action();
      if (success) setNote(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }

  function initialize() {
    void run("initialize", async () => {
      const next = await invokeValue<LocalSyncStatus>("local_sync_initialize", { label: deviceLabel });
      setStatus(next);
      setDeviceLabel(next.deviceLabel);
    }, uiText("Encrypted sync is ready."));
  }

  function toggleServer() {
    const running = Boolean(status?.server.running);
    void run("server", async () => {
      const next = await invokeValue<LocalSyncStatus>(running ? "local_sync_stop" : "local_sync_start", { discovery });
      setStatus(next);
      setDiscovery(next.server.discoveryEnabled);
    }, uiText(running ? "Local sync stopped." : "Local sync started."));
  }

  function createInvitation() {
    void run("invite", async () => {
      const next = await invokeValue<LocalSyncInvitation>("local_sync_create_invitation", {
        host: advertisedHost,
        expiresInSeconds: 600,
      });
      setInvitation(next);
      await load();
    });
  }

  function acceptInvitation() {
    void run("accept", async () => {
      const result = await invokeValue<{ status: LocalSyncStatus }>("local_sync_accept_invitation", {
        invitation: incomingInvitation,
        label: deviceLabel,
        host: advertisedHost,
      });
      setStatus(result.status);
      setIncomingInvitation("");
    }, uiText("Device paired."));
  }

  function syncPeer(deviceId: string) {
    void run(`sync:${deviceId}`, async () => {
      const result = await invokeValue<{ status: LocalSyncStatus }>("local_sync_sync_peer", { deviceId });
      setStatus(result.status);
      setConflicts(await invokeValue<LocalSyncConflictResult>("local_sync_conflicts", { limit: 20 }));
    }, uiText("Catalog metadata synchronized."));
  }

  function revokePeer(deviceId: string) {
    void run(`revoke:${deviceId}`, async () => {
      const result = await invokeValue<{ status: LocalSyncStatus }>("local_sync_revoke_peer", { deviceId });
      setStatus(result.status);
      setConfirmRevoke("");
    }, uiText("Device access revoked."));
  }

  function exportRecovery() {
    void run("export-recovery", async () => {
      const result = await invokeValue<{ bundle: string }>("local_sync_export_recovery", { passphrase: recoveryPassphrase });
      setRecoveryBundle(result.bundle);
      setRecoveryPassphrase("");
    }, uiText("Recovery bundle created."));
  }

  function restoreRecovery() {
    void run("restore-recovery", async () => {
      const result = await invokeValue<{ status: LocalSyncStatus }>("local_sync_restore_recovery", {
        bundle: restoreBundle,
        passphrase: restorePassphrase,
        confirm: confirmRestore,
      });
      setStatus(result.status);
      setRestoreBundle("");
      setRestorePassphrase("");
      setConfirmRestore(false);
    }, uiText("Sync identity restored."));
  }

  const running = Boolean(status?.server.running);
  const activePeers = status?.peers.filter((peer) => peer.status === "active") || [];

  return (
    <section className="panel local-sync-panel" aria-labelledby="local-sync-title">
      <div className="local-sync-heading">
        <span className="local-sync-mark"><Network size={22} /></span>
        <div>
          <span className="section-kicker">{uiText("Encrypted local sync")}</span>
          <h2 id="local-sync-title">{uiText("Keep catalog edits in step")}</h2>
        </div>
        <span className={`status-pill ${running ? "strong" : "weak"}`} role="status">
          {running ? uiText("Listening") : status?.encryptionReady ? uiText("Stopped") : uiText("Encryption required")}
        </span>
        <button className="ghost icon-button" onClick={() => void load()} disabled={busy !== ""} title={uiText("Refresh local sync")} aria-label={uiText("Refresh local sync")}>
          <RefreshCw className={busy === "load" ? "spin" : ""} size={16} />
        </button>
      </div>

      {!status ? (
        <p className="compact"><Loader2 className="spin" size={14} /> {uiText("Loading local sync…")}</p>
      ) : !status.encryptionReady ? (
        <div className="local-sync-locked" role="status">
          <LockKeyhole size={20} />
          <span><strong>{uiText("Workspace encryption required")}</strong><small>{uiText("Unlock or encrypt this workspace before pairing devices.")}</small></span>
        </div>
      ) : (
        <>
          <div className="local-sync-runtime">
            <label>
              <span>{uiText("Device name")}</span>
              <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} maxLength={64} placeholder={uiText("This device")} />
            </label>
            {!status.initialized ? (
              <button className="primary" onClick={initialize} disabled={busy !== "" || !deviceLabel.trim()}>
                {busy === "initialize" ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />} {uiText("Set up device")}
              </button>
            ) : (
              <button className="secondary" onClick={initialize} disabled={busy !== "" || !deviceLabel.trim() || deviceLabel === status.deviceLabel}>
                {busy === "initialize" ? <Loader2 className="spin" size={16} /> : <Save size={16} />} {uiText("Save name")}
              </button>
            )}
            <label className="local-sync-discovery-toggle">
              <input type="checkbox" checked={discovery} onChange={(event) => setDiscovery(event.target.checked)} disabled={running || busy !== "" || !status.initialized} />
              <span><Network size={15} /><strong>{uiText("Bonjour discovery")}</strong></span>
            </label>
            <button className={running ? "secondary" : "primary"} onClick={toggleServer} disabled={busy !== "" || !status.initialized}>
              {busy === "server" ? <Loader2 className="spin" size={16} /> : running ? <Pause size={16} /> : <Play size={16} />}
              {uiText(running ? "Stop listener" : "Start listener")}
            </button>
          </div>

          {status.initialized && (
            <>
              <div className="local-sync-summary" aria-label={uiText("Local sync summary")}>
                <span><strong>{activePeers.length}</strong>{uiText("paired")}</span>
                <span><strong>{status.counts.operations}</strong>{uiText("operations")}</span>
                <span><strong>{status.counts.pendingAssets}</strong>{uiText("pending originals")}</span>
                <span><strong>{conflicts.total}</strong>{uiText("resolved conflicts")}</span>
              </div>

              <div className="local-sync-pair-grid">
                <div className="local-sync-pair-column">
                  <div className="local-sync-section-title"><QrCode size={16} /><strong>{uiText("Invite a device")}</strong></div>
                  <label>
                    <span>{uiText("This device address")}</span>
                    <input value={advertisedHost} onChange={(event) => setAdvertisedHost(event.target.value)} inputMode="decimal" spellCheck={false} placeholder={status.server.addresses[0] || "192.168.1.10"} />
                  </label>
                  <button className="secondary" onClick={createInvitation} disabled={busy !== ""}>
                    {busy === "invite" ? <Loader2 className="spin" size={16} /> : <QrCode size={16} />} {uiText("Create one-use code")}
                  </button>
                </div>
                <div className="local-sync-pair-column">
                  <div className="local-sync-section-title"><Link2 size={16} /><strong>{uiText("Pair from an invitation")}</strong></div>
                  <label>
                    <span>{uiText("Invitation")}</span>
                    <textarea value={incomingInvitation} onChange={(event) => setIncomingInvitation(event.target.value)} rows={2} spellCheck={false} placeholder="vintrace-sync://pair/…" />
                  </label>
                  <button className="secondary" onClick={acceptInvitation} disabled={busy !== "" || !incomingInvitation.trim()}>
                    {busy === "accept" ? <Loader2 className="spin" size={16} /> : <ClipboardPaste size={16} />} {uiText("Pair device")}
                  </button>
                </div>
              </div>

              {invitation && (
                <div className="local-sync-invitation" role="status" aria-live="polite">
                  <div className="local-sync-qr">
                    {invitationQr ? <img src={invitationQr} alt={uiText("Local sync pairing QR code")} /> : <Loader2 className="spin" size={24} />}
                  </div>
                  <div>
                    <span><ShieldCheck size={16} /> {uiText("One-use encrypted invitation")}</span>
                    <strong>{invitation.host}:{invitation.port}</strong>
                    <small>{uiText("Expires")} {formatDate(invitation.expiresAt, uiText("Soon"))}</small>
                    <div className="button-row wrap">
                      <button className="secondary compact-action" onClick={() => copyText(invitation.invitation, uiText("Local sync invitation"))}><Copy size={14} /> {uiText("Copy invitation")}</button>
                      <button className="ghost icon-button" onClick={() => setInvitation(null)} title={uiText("Hide invitation")} aria-label={uiText("Hide invitation")}><X size={14} /></button>
                    </div>
                  </div>
                </div>
              )}

              <div className="local-sync-peer-list">
                <div className="local-sync-peer-heading"><strong>{uiText("Paired devices")}</strong><small>{activePeers.length}</small></div>
                {activePeers.length === 0 ? (
                  <div className="local-sync-empty"><Laptop size={20} /><span>{uiText("No paired devices")}</span></div>
                ) : activePeers.map((peer) => (
                  <div className="local-sync-peer-row" key={peer.deviceId}>
                    <span className="local-sync-peer-icon"><Laptop size={17} /></span>
                    <span>
                      <strong>{peer.label}</strong>
                      <small>{peer.host}:{peer.port} · {peer.lastSyncAt ? `${uiText("Synced")} ${formatDate(peer.lastSyncAt, uiText("Recently"))}` : uiText("Not synced yet")}</small>
                    </span>
                    <button className="secondary compact-action" onClick={() => syncPeer(peer.deviceId)} disabled={busy !== ""}>
                      {busy === `sync:${peer.deviceId}` ? <Loader2 className="spin" size={14} /> : <RotateCw size={14} />} {uiText("Sync now")}
                    </button>
                    {confirmRevoke === peer.deviceId ? (
                      <span className="local-sync-revoke-confirm">
                        <button className="danger compact-action" onClick={() => revokePeer(peer.deviceId)} disabled={busy !== ""}>
                          {busy === `revoke:${peer.deviceId}` ? <Loader2 className="spin" size={14} /> : <Check size={14} />} {uiText("Revoke")}
                        </button>
                        <button className="ghost icon-button" onClick={() => setConfirmRevoke("")} title={uiText("Cancel")} aria-label={uiText("Cancel")}><X size={14} /></button>
                      </span>
                    ) : (
                      <button className="ghost icon-button" onClick={() => setConfirmRevoke(peer.deviceId)} title={uiText("Revoke device")} aria-label={uiText("Revoke device")}><Trash2 size={15} /></button>
                    )}
                  </div>
                ))}
              </div>

              <details className="local-sync-recovery">
                <summary><KeyRound size={16} /><span>{uiText("Sync identity recovery")}</span></summary>
                <div className="local-sync-recovery-grid">
                  <div>
                    <strong>{uiText("Create recovery bundle")}</strong>
                    <input type="password" value={recoveryPassphrase} onChange={(event) => setRecoveryPassphrase(event.target.value)} minLength={12} autoComplete="new-password" placeholder={uiText("Recovery passphrase")} />
                    <button className="secondary compact-action" onClick={exportRecovery} disabled={busy !== "" || recoveryPassphrase.length < 12}>
                      {busy === "export-recovery" ? <Loader2 className="spin" size={14} /> : <KeyRound size={14} />} {uiText("Create bundle")}
                    </button>
                    {recoveryBundle && <button className="ghost compact-action" onClick={() => copyText(recoveryBundle, uiText("Sync recovery bundle"))}><Copy size={14} /> {uiText("Copy bundle")}</button>}
                  </div>
                  <div>
                    <strong>{uiText("Restore sync identity")}</strong>
                    <textarea value={restoreBundle} onChange={(event) => setRestoreBundle(event.target.value)} rows={2} spellCheck={false} placeholder="vtrecovery1:…" />
                    <input type="password" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} autoComplete="current-password" placeholder={uiText("Recovery passphrase")} />
                    <label className="local-sync-confirm"><input type="checkbox" checked={confirmRestore} onChange={(event) => setConfirmRestore(event.target.checked)} /><span>{uiText("Replace this device identity")}</span></label>
                    <button className="danger compact-action" onClick={restoreRecovery} disabled={busy !== "" || !confirmRestore || !restoreBundle.trim() || !restorePassphrase}>
                      {busy === "restore-recovery" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} {uiText("Restore identity")}
                    </button>
                  </div>
                </div>
              </details>

              <div className="local-sync-policy-strip">
                <span><ShieldCheck size={15} /> {uiText("Catalog metadata only")}</span>
                <span><LockKeyhole size={15} /> {uiText("End-to-end encrypted")}</span>
                <span><Network size={15} /> {uiText("Private network only")}</span>
              </div>
            </>
          )}
        </>
      )}
      {status?.server.discoveryError && <p className="compact danger-text" role="alert">{status.server.discoveryError}</p>}
      {error && <p className="compact danger-text" role="alert">{error}</p>}
      {note && <p className="compact ok" role="status" aria-live="polite">{note}</p>}
    </section>
  );
}
