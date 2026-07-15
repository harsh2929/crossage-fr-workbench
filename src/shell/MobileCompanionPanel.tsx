import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  QrCode,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import type { MobileCompanionPairingResult, MobileCompanionStatus } from "../types";

interface MobileCompanionPanelProps {
  active: boolean;
  copyText(text: string, label?: string): void;
  uiText(source: string): string;
}

function formatExpiry(value: number | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value * 1000));
}

export function MobileCompanionPanel({ active, copyText, uiText }: MobileCompanionPanelProps) {
  const [status, setStatus] = useState<MobileCompanionStatus | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [allowPreviews, setAllowPreviews] = useState(true);
  const [pairing, setPairing] = useState<MobileCompanionPairingResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError("");
    window.crossAge.getMobileCompanionStatus()
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        setEndpoint(value.publicUrl);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    if (!pairing?.pairingUrl) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(pairing.pairingUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: { dark: "#17191cff", light: "#ffffffff" },
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [pairing]);

  const activeDevices = useMemo(
    () => (status?.devices || []).filter((device) => device.status !== "revoked"),
    [status],
  );

  async function saveEndpoint() {
    setBusy("endpoint");
    setError("");
    try {
      const next = await window.crossAge.configureMobileCompanion(endpoint);
      setStatus(next);
      setEndpoint(next.publicUrl);
      setPairing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }

  async function createPairing() {
    setBusy("pair");
    setError("");
    setPairing(null);
    try {
      const result = await window.crossAge.createMobileCompanion({
        label,
        expiresInDays,
        allowPreviews,
      });
      setPairing(result);
      setStatus(result.status);
      setLabel("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }

  async function revoke(accountId: string) {
    setBusy(accountId);
    setError("");
    try {
      const result = await window.crossAge.revokeMobileCompanion(accountId);
      setStatus(result.status);
      if (pairing?.device.accountId === accountId) setPairing(null);
      setConfirmRevoke("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel mobile-companion-panel" aria-labelledby="mobile-companion-title">
      <div className="mobile-companion-heading">
        <span className="mobile-companion-mark"><Smartphone size={22} /></span>
        <div>
          <span className="section-kicker">{uiText("Mobile companion")}</span>
          <h2 id="mobile-companion-title">{uiText("Read your library from a phone")}</h2>
        </div>
        <span className={`status-pill ${status?.readyForPairing ? "strong" : "weak"}`}>
          {status?.readyForPairing ? uiText("Ready") : uiText("HTTPS required")}
        </span>
      </div>

      {!status ? (
        <p className="compact"><Loader2 className="spin" size={14} /> {uiText("Loading mobile access…")}</p>
      ) : (
        <>
          <div className="mobile-endpoint-row">
            <label htmlFor="mobile-public-endpoint">{uiText("Public HTTPS endpoint")}</label>
            <div>
              <input
                id="mobile-public-endpoint"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                disabled={!status.canEditEndpoint || busy !== ""}
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://photos.example.com"
              />
              <button className="icon-button" onClick={() => void saveEndpoint()} disabled={!status.canEditEndpoint || busy !== ""} title={uiText("Save endpoint")} aria-label={uiText("Save endpoint")}>
                {busy === "endpoint" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              </button>
            </div>
            <small><LockKeyhole size={13} /> {status.secure ? uiText("Trusted HTTPS origin") : uiText("Loopback development origin")}</small>
          </div>

          <div className="mobile-pair-form">
            <label>
              <span>{uiText("Device name")}</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={64} placeholder={uiText("My phone")} />
            </label>
            <label>
              <span>{uiText("Access expires")}</span>
              <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                <option value={1}>{uiText("1 day")}</option>
                <option value={7}>{uiText("7 days")}</option>
                <option value={30}>{uiText("30 days")}</option>
              </select>
            </label>
            <label className="mobile-preview-toggle">
              <input type="checkbox" checked={allowPreviews} onChange={(event) => setAllowPreviews(event.target.checked)} />
              <span><ImageIcon size={16} /> <strong>{uiText("Allow photo previews")}</strong><small>{uiText("Safe Mode still applies")}</small></span>
            </label>
            <button className="primary" onClick={() => void createPairing()} disabled={!status.readyForPairing || busy !== ""}>
              {busy === "pair" ? <Loader2 className="spin" size={16} /> : <QrCode size={16} />} {uiText("Create pairing code")}
            </button>
          </div>

          {pairing && (
            <div className="mobile-pairing-result" role="status" aria-live="polite">
              <div className="mobile-pairing-qr">
                {qrDataUrl ? <img src={qrDataUrl} alt={uiText("Mobile pairing QR code")} /> : <Loader2 className="spin" size={24} />}
              </div>
              <div>
                <span><ShieldCheck size={17} /> {uiText("One-use pairing link")}</span>
                <strong>{pairing.device.label}</strong>
                <small>{uiText("Pairing code expires")} {formatExpiry(pairing.device.pairingExpiresAt)}</small>
                <div className="button-row wrap">
                  <button className="secondary compact-action" onClick={() => copyText(pairing.pairingUrl, uiText("Mobile pairing link"))}><Copy size={14} /> {uiText("Copy link")}</button>
                  <button className="ghost compact-action" onClick={() => setPairing(null)}><X size={14} /> {uiText("Hide")}</button>
                </div>
              </div>
            </div>
          )}

          <div className="mobile-device-list">
            <div className="mobile-device-list-heading">
              <strong>{uiText("Paired devices")}</strong>
              <small>{activeDevices.length}</small>
            </div>
            {activeDevices.length === 0 ? (
              <div className="mobile-device-empty"><Smartphone size={20} /><span>{uiText("No mobile devices")}</span></div>
            ) : activeDevices.map((device) => (
              <div className="mobile-device-row" key={device.accountId}>
                <span className="mobile-device-state"><Smartphone size={18} /></span>
                <span>
                  <strong>{device.label}</strong>
                  <small>{uiText(device.status.replaceAll("-", " "))} · {formatExpiry(device.expiresAt)} · {device.allowPreviews ? uiText("Previews") : uiText("Metadata only")}</small>
                </span>
                {confirmRevoke === device.accountId ? (
                  <span className="mobile-revoke-confirm">
                    <button className="danger compact-action" onClick={() => void revoke(device.accountId)} disabled={busy !== ""}>
                      {busy === device.accountId ? <Loader2 className="spin" size={14} /> : <Check size={14} />} {uiText("Revoke")}
                    </button>
                    <button className="ghost icon-button" onClick={() => setConfirmRevoke("")} aria-label={uiText("Cancel")} title={uiText("Cancel")}><X size={14} /></button>
                  </span>
                ) : (
                  <button className="ghost icon-button" onClick={() => setConfirmRevoke(device.accountId)} aria-label={uiText("Revoke mobile access")} title={uiText("Revoke mobile access")}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>

          <div className="mobile-policy-strip">
            <span><ShieldCheck size={15} /> {uiText("Permanently read-only")}</span>
            <span><ExternalLink size={15} /> {status.serverRunning ? uiText("Server running") : uiText("Server starts when pairing")}</span>
          </div>
        </>
      )}
      {error && <p className="compact danger-text" role="alert">{error}</p>}
    </section>
  );
}
