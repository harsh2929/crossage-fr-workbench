import { Suspense, lazy, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import type { AppState, PhotoSensitiveAuthResult, PhotoSensitiveAuthStatus } from "../types";
import type { SettingsDraft, SettingsValues } from "../appSettings";

const SafeModeReview = lazy(() => import("../views/SafeModeReview"));

type SafeModeProfileThresholds = {
  privacy: number;
  balanced: number;
  permissive: number;
};

interface SafeModeSettingsPanelProps {
  settings: SettingsDraft;
  safeModeModel: AppState["safeModeModel"];
  safeModeExplain: AppState["safeModeExplain"];
  profileThresholds: SafeModeProfileThresholds;
  setCustomSettings(values: Partial<SettingsValues>): void;
  getSensitiveAuthStatus(): Promise<PhotoSensitiveAuthStatus | null>;
  authenticateSensitiveAccess(reason: string): Promise<PhotoSensitiveAuthResult | null>;
  uiText(source: string): string;
}

function RouteFallback({ uiText, label }: { uiText: (text: string) => string; label: string }) {
  return (
    <section className="photos-route-loading" role="status" aria-busy="true">
      <Loader2 className="spin" size={18} aria-hidden="true" />
      <span>{uiText(label)}</span>
    </section>
  );
}

function RangeControl({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label className="slider-row">{label}
      <div>
        <input aria-label={`${label} slider`} type="range" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <input aria-label={`${label} value`} type="number" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      </div>
    </label>
  );
}

export function SafeModeSettingsPanel({
  settings,
  safeModeModel,
  safeModeExplain,
  profileThresholds,
  setCustomSettings,
  getSensitiveAuthStatus,
  authenticateSensitiveAccess,
  uiText,
}: SafeModeSettingsPanelProps) {
  const [safeCalibBusy, setSafeCalibBusy] = useState(false);
  const [safeCalibResult, setSafeCalibResult] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainStatus, setExplainStatus] = useState("");
  const [safeReviewOpen, setSafeReviewOpen] = useState(false);
  const initialGuardrail = safeModeModel?.categoryAware ? safeModeModel : safeModeModel?.multimodal;
  const [guardrailReady, setGuardrailReady] = useState(Boolean(initialGuardrail?.available));
  const [guardrailLabel, setGuardrailLabel] = useState(initialGuardrail?.modelName || "");
  const [guardrailDetail, setGuardrailDetail] = useState(initialGuardrail?.reason || "");
  const [guardrailBusy, setGuardrailBusy] = useState(false);

  useEffect(() => {
    const report = safeModeModel?.categoryAware ? safeModeModel : safeModeModel?.multimodal;
    setGuardrailReady(Boolean(report?.available));
    setGuardrailLabel(report?.modelName || "");
    setGuardrailDetail(report?.reason || "");
  }, [safeModeModel]);

  async function refreshGuardrailStatus() {
    const bridge = window.crossAge;
    if (!bridge?.invoke) return;
    setGuardrailBusy(true);
    try {
      const response = await bridge.invoke<{ value?: Record<string, unknown> }>("photo_vlm_status", { tier: "quality" });
      const value = response?.value && typeof response.value === "object" ? response.value : {};
      const route = value.route && typeof value.route === "object" ? value.route as Record<string, unknown> : {};
      const packs = Array.isArray(value.packs) ? value.packs.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
      const selected = packs.find((item) => String(item.tier || "") === "quality");
      const available = Boolean(route.available) && String(route.tier || "") === "quality";
      setGuardrailReady(available);
      setGuardrailLabel(String(selected?.label || route.modelId || ""));
      setGuardrailDetail(String(available
        ? route.reason || uiText("Local category model is ready.")
        : uiText("The validated Qwen3-VL quality tier is required for category-aware Safe Mode.")));
    } catch (error) {
      setGuardrailReady(false);
      setGuardrailDetail(error instanceof Error ? error.message : "Could not check the local category model.");
    } finally {
      setGuardrailBusy(false);
    }
  }

  async function installGuardrailModel() {
    const bridge = window.crossAge;
    if (!bridge?.invoke) return;
    const acknowledged = window.confirm(uiText(
      "Install the validated Qwen3-VL quality pack for category-aware Safe Mode? The download is about 3 GB; moderation runs locally after installation."
    ));
    if (!acknowledged) return;
    setGuardrailBusy(true);
    setGuardrailDetail(uiText("Downloading and verifying the local category model..."));
    try {
      await bridge.invoke("install_photo_vlm", { tier: "quality" });
      setGuardrailDetail(uiText("Local category model installed."));
      setGuardrailReady(true);
      setGuardrailLabel("Qwen3-VL 4B quality");
    } catch (error) {
      setGuardrailReady(false);
      setGuardrailDetail(error instanceof Error ? error.message : uiText("Category model installation failed."));
    } finally {
      setGuardrailBusy(false);
    }
  }

  async function calibrateSafeModeFromFolders() {
    const bridge = window.crossAge;
    if (!bridge?.chooseFolder || !bridge?.invoke) return;
    setSafeCalibResult("");
    const sensitivePick = await bridge.chooseFolder();
    const sensitivePath = typeof sensitivePick === "string" ? sensitivePick : (sensitivePick as { path?: string } | null)?.path;
    if (!sensitivePath) return;
    const safePick = await bridge.chooseFolder();
    const safePath = typeof safePick === "string" ? safePick : (safePick as { path?: string } | null)?.path;
    if (!safePath) return;
    setSafeCalibBusy(true);
    try {
      const res = (await bridge.invoke("calibrate_safe_mode", {
        folders: [
          { path: sensitivePath, sensitive: true },
          { path: safePath, sensitive: false },
        ],
      })) as { ok?: boolean; queued?: boolean; message?: string; jobId?: string; temperature?: number; sampleCount?: number; reason?: string; nllBefore?: number; nllAfter?: number };
      if (res?.queued) {
        setSafeCalibResult(res.message || "Safe Mode calibration queued. Check the Photos indexing queue for progress.");
        return;
      }
      setSafeCalibResult(
        res?.ok
          ? `Calibrated on ${res.sampleCount ?? 0} images - temperature ${Number(res.temperature ?? 1).toFixed(2)} (error ${Number(res.nllBefore ?? 0).toFixed(3)} -> ${Number(res.nllAfter ?? 0).toFixed(3)}).`
          : res?.reason || "Calibration needs more labeled examples."
      );
    } catch (error) {
      setSafeCalibResult(error instanceof Error ? error.message : "Calibration failed.");
    } finally {
      setSafeCalibBusy(false);
    }
  }

  async function resetSafeModeCalibration() {
    const bridge = window.crossAge;
    if (!bridge?.invoke) return;
    setSafeCalibBusy(true);
    try {
      await bridge.invoke("calibrate_safe_mode", { reset: true });
      setSafeCalibResult("Calibration reset to the raw model (temperature 1.0).");
    } catch (error) {
      setSafeCalibResult(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setSafeCalibBusy(false);
    }
  }

  async function installExplainerFromFile() {
    const bridge = window.crossAge;
    if (!bridge?.chooseModelFile || !bridge?.invoke) return;
    const acknowledged = window.confirm(
      "NudeNet is licensed AGPL-3.0. This installs a model you downloaded yourself (nothing is bundled or redistributed), and you must comply with the AGPL, including its source-offer obligation. Continue?"
    );
    if (!acknowledged) return;
    const pick = await bridge.chooseModelFile();
    const modelPath = typeof pick === "string" ? pick : (pick as { path?: string } | null)?.path;
    if (!modelPath) return;
    setExplainBusy(true);
    try {
      const res = (await bridge.invoke("install_safety_explainer", {
        sourcePath: modelPath,
        modelName: "nudenet-explainer",
        license: "AGPL-3.0",
        confirmAgpl: true,
        format: "nudenet",
        inputSize: 640,
      })) as { ok?: boolean; modelName?: string; reason?: string };
      setExplainStatus(
        res?.ok
          ? `Explainer installed (${res.modelName ?? "model"}). Flagged photos can now show which regions triggered Safe Mode.`
          : res?.reason || "Install failed."
      );
    } catch (error) {
      setExplainStatus(error instanceof Error ? error.message : "Install failed.");
    } finally {
      setExplainBusy(false);
    }
  }

  return (
    <>
      <label className="switch-row">
        <span>
          <strong>Safe Mode</strong>
          <small>Protect likely intimate media from matching, thumbnails, and similar-photo groups.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.safeMode}
          onChange={(event) => setCustomSettings({ safeMode: event.currentTarget.checked })}
          aria-label="Safe Mode"
        />
      </label>
      <label className="switch-row">
        <span>
          <strong>{uiText("Safe Mode profile")}</strong>
          <small>{uiText("Privacy-first catches more sensitive content (more false positives on swimwear/medical); Permissive minimizes them. Custom uses the slider below.")}</small>
        </span>
        <select
          value={settings.safeModeProfile ?? "custom"}
          disabled={!settings.safeMode}
          aria-label="Safe Mode profile"
          onChange={(event) => {
            const profile = event.currentTarget.value;
            setCustomSettings(
              profile in profileThresholds
                ? { safeModeProfile: profile, safeModeThreshold: profileThresholds[profile as keyof SafeModeProfileThresholds] }
                : { safeModeProfile: "custom" }
            );
          }}
        >
          <option value="privacy">{uiText("Privacy-first (aggressive)")}</option>
          <option value="balanced">{uiText("Balanced")}</option>
          <option value="permissive">{uiText("Permissive (fewer false positives)")}</option>
          <option value="custom">{uiText("Custom")}</option>
        </select>
      </label>
      <RangeControl
        label={uiText("Safe Mode sensitivity")}
        value={settings.safeModeThreshold}
        onChange={(value) => setCustomSettings({ safeModeThreshold: value, safeModeProfile: "custom" })}
      />
      <label className="switch-row">
        <span>
          <strong>{uiText("Category-aware local guardrail")}</strong>
          <small>{uiText("Score sexually explicit content, violence or gore, dangerous activity, and self-harm with the validated local quality model. This is substantially slower per image; the compatibility detector remains protective when unavailable or disabled.")}</small>
        </span>
        <input
          type="checkbox"
          checked={settings.safeModeMultimodal ?? false}
          disabled={!settings.safeMode}
          onChange={(event) => setCustomSettings({ safeModeMultimodal: event.currentTarget.checked })}
          aria-label={uiText("Category-aware local guardrail")}
        />
      </label>
      <div className={`explainer-install-status ${guardrailReady ? "is-installed" : "is-absent"}`} role="status" aria-live="polite">
        {guardrailReady ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}
        <span>
          {guardrailReady
            ? `${uiText("Ready")}: ${guardrailLabel || uiText("local category model")}. ${guardrailDetail}`
            : `${uiText("Compatibility detector active")}. ${guardrailDetail || uiText("Install the local category model to enable per-category verdicts.")}`}
        </span>
        <span className="settings-inline-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={uiText("Refresh category model status")}
            title={uiText("Refresh category model status")}
            disabled={guardrailBusy}
            onClick={() => void refreshGuardrailStatus()}
          >
            <RefreshCw className={guardrailBusy ? "spin" : ""} size={15} />
          </button>
          {!guardrailReady && (
            <button type="button" className="secondary compact-action" disabled={guardrailBusy} onClick={() => void installGuardrailModel()}>
              {guardrailBusy ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
              <span>{guardrailBusy ? uiText("Installing...") : uiText("Install model")}</span>
            </button>
          )}
        </span>
      </div>
      <label className="switch-row">
        <span>
          <strong>{uiText("Calibrate to your library")}</strong>
          <small>{uiText("Vendor accuracy claims don't transfer — fit Safe Mode to your own photos. Pick a folder of sensitive examples, then a folder of safe examples; everything stays on this device.")}</small>
        </span>
        <span className="settings-inline-actions">
          <button type="button" className="secondary compact-action" disabled={!settings.safeMode || safeCalibBusy} onClick={() => void calibrateSafeModeFromFolders()}>
            {safeCalibBusy ? uiText("Calibrating...") : uiText("Calibrate...")}
          </button>
          <button type="button" className="ghost compact-action" disabled={safeCalibBusy} onClick={() => void resetSafeModeCalibration()}>
            {uiText("Reset")}
          </button>
        </span>
      </label>
      {safeCalibResult && <p className="muted safe-calib-result" role="status" aria-live="polite">{safeCalibResult}</p>}
      <label className="switch-row">
        <span>
          <strong>{uiText("Explain why flagged (optional)")}</strong>
          <small>{uiText("Install an on-device body-part detector to see which regions triggered Safe Mode. NudeNet is AGPL-3.0 — download it yourself, then install the .onnx here. Nothing is bundled or sent anywhere.")}</small>
        </span>
        <button type="button" className="secondary compact-action" disabled={explainBusy} onClick={() => void installExplainerFromFile()}>
          {explainBusy ? uiText("Installing...") : safeModeExplain?.available ? uiText("Replace explainer...") : uiText("Install explainer...")}
        </button>
      </label>
      <p className={`explainer-install-status ${safeModeExplain?.available ? "is-installed" : "is-absent"}`} role="status">
        {safeModeExplain?.available ? (
          <>
            <ShieldCheck size={14} aria-hidden="true" />
            <span>
              Installed: <strong>{safeModeExplain.modelName || "explainer model"}</strong>
              {safeModeExplain.license && safeModeExplain.license !== "unknown" ? ` (${safeModeExplain.license})` : ""}. "Why flagged?" is available on revealed sensitive photos.
            </span>
          </>
        ) : (
          <>
            <ShieldOff size={14} aria-hidden="true" />
            <span>Not installed - the "Why flagged?" overlay stays hidden until you add a model.</span>
          </>
        )}
      </p>
      {explainStatus && <p className="muted safe-calib-result" role="status" aria-live="polite">{explainStatus}</p>}
      <label className="switch-row">
        <span>
          <strong>{uiText("Review flagged photos")}</strong>
          <small>{uiText("See every photo Safe Mode marked sensitive and correct false positives. Your keep/allow choices override the classifier and stay on this device.")}</small>
        </span>
        <button type="button" className="secondary compact-action" onClick={() => setSafeReviewOpen(true)}>
          <ShieldAlert size={16} /> {uiText("Review...")}
        </button>
      </label>
      {safeReviewOpen && (
        <Suspense fallback={<RouteFallback uiText={uiText} label="Loading Safe Mode review" />}>
          <SafeModeReview
            open={safeReviewOpen}
            onClose={() => setSafeReviewOpen(false)}
            invoke={window.crossAge.invoke}
            getSensitiveAuthStatus={getSensitiveAuthStatus}
            authenticateSensitiveAccess={authenticateSensitiveAccess}
            uiText={uiText}
          />
        </Suspense>
      )}
      <label className="switch-row">
        <span>
          <strong>Zero-admittance (strict)</strong>
          <small>Never let borderline-sensitive images enter matching, even a centered single-face portrait. Recommended for child-safety / CSAM victim-ID work.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.safeModeZeroAdmittance ?? false}
          disabled={!settings.safeMode}
          onChange={(event) => setCustomSettings({ safeModeZeroAdmittance: event.currentTarget.checked })}
          aria-label="Safe Mode zero-admittance"
        />
      </label>
    </>
  );
}
