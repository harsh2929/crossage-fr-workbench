import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import appIconUrl from "../desktop/assets/icon.png";
import { normalizeLanguage, translate } from "./i18n";
import type { LanguageCode, TranslationKey } from "./i18n";
import "./styles.css";

const languageStorageKey = "vintrace:language";
const startupIssueStorageKey = "vintrace:startup-recovery:v1";
const startupSafeModeStorageKey = "vintrace:startup-safe-mode:v1";

function readBootLanguage(): LanguageCode {
  try {
    return normalizeLanguage(window.localStorage.getItem(languageStorageKey) || navigator.language);
  } catch {
    return normalizeLanguage(typeof navigator !== "undefined" ? navigator.language : "en");
  }
}

function applyBootLanguage(language: LanguageCode) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

function bootT(key: TranslationKey) {
  return translate(readBootLanguage(), key);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStartupIssue(): { message: string; stack?: string; at: string; count: number } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(startupIssueStorageKey) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStartupIssue(error: Error) {
  try {
    const previous = readStartupIssue();
    window.localStorage.setItem(startupIssueStorageKey, JSON.stringify({
      message: error.message || "Renderer startup failed.",
      stack: error.stack || "",
      at: new Date().toISOString(),
      count: Math.min(99, (previous?.count || 0) + 1)
    }));
  } catch {
    // Recovery state is best effort.
  }
}

function clearStartupIssue() {
  try {
    window.localStorage.removeItem(startupIssueStorageKey);
  } catch {
    // Recovery state is best effort.
  }
}

function resetLocalUiState() {
  try {
    const preservedLanguage = window.localStorage.getItem(languageStorageKey);
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("vintrace:")) {
        window.localStorage.removeItem(key);
      }
    }
    if (preservedLanguage) {
      window.localStorage.setItem(languageStorageKey, preservedLanguage);
    }
    window.sessionStorage.clear();
  } catch {
    // Reset is best effort.
  }
}

function BootDiagnostic({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  const language = readBootLanguage();
  applyBootLanguage(language);
  const t = (key: TranslationKey) => translate(language, key);
  const bridge = (window as Window & {
    crossAge?: {
      exportDiagnosticsReport?: (includePaths?: boolean) => Promise<unknown>;
    };
  }).crossAge;
  return (
    <main className="boot-fallback" role="alert">
      <section>
        <div className="app-icon"><img src={appIconUrl} alt="" /></div>
        <h1>{title}</h1>
        <p>{message}</p>
        <p className="muted">{t("boot.restart")}</p>
        {bridge?.exportDiagnosticsReport && (
          <button type="button" onClick={() => bridge.exportDiagnosticsReport?.(false).catch(() => undefined)}>
            {t("boot.exportDiagnostics")}
          </button>
        )}
        {children}
      </section>
    </main>
  );
}

function StartupRecoveryGate({ children }: { children: React.ReactNode }) {
  const [issue, setIssue] = React.useState(() => readStartupIssue());
  const [status, setStatus] = React.useState("");
  const bridge = (window as Window & {
    crossAge?: {
      invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
      exportDiagnosticsReport?: (includePaths?: boolean) => Promise<unknown>;
      recordDiagnosticEvent?: (event: Record<string, unknown>) => Promise<boolean>;
    };
  }).crossAge;

  if (!issue) return <>{children}</>;

  async function repairWorkspace() {
    setStatus("Checking and repairing the app folder...");
    try {
      await bridge?.invoke?.("repair_workspace", { dryRun: false });
      await bridge?.recordDiagnosticEvent?.({
        type: "startup_recovery_repair",
        level: "info",
        category: "renderer",
        message: "Startup recovery repair workspace completed."
      });
      setStatus("App folder repair completed. Continue in safe mode or reopen Vintrace.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "App folder repair failed.");
    }
  }

  function continueSafely() {
    resetLocalUiState();
    try {
      window.localStorage.setItem(startupSafeModeStorageKey, new Date().toISOString());
    } catch {
      // Best effort.
    }
    clearStartupIssue();
    setIssue(null);
  }

  function resetAndReload() {
    resetLocalUiState();
    clearStartupIssue();
    window.location.reload();
  }

  return (
    <BootDiagnostic
      title="Vintrace startup recovery"
      message={`The previous launch failed before the interface was ready. Last error: ${issue.message}`}
    >
      <div className="boot-recovery-actions">
        <button type="button" onClick={continueSafely}>Continue in safe mode</button>
        <button type="button" onClick={resetAndReload}>Reset UI state</button>
        <button type="button" onClick={() => void repairWorkspace()}>Repair app folder</button>
      </div>
      <p className="muted">{status || "Safe mode clears local UI preferences for this launch. It does not delete original photos."}</p>
    </BootDiagnostic>
  );
}

class RendererBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Renderer failed", error);
    writeStartupIssue(error);
    const bridge = (window as Window & {
      crossAge?: {
        recordDiagnosticEvent?: (event: Record<string, unknown>) => Promise<boolean>;
      };
    }).crossAge;
    bridge?.recordDiagnosticEvent?.({
      type: "renderer_runtime_error",
      level: "fatal",
      category: "renderer",
      message: error.message || "React renderer failed.",
      stack: error.stack || "",
      componentStack: info.componentStack || "",
      recoverable: false
    }).catch(() => undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <BootDiagnostic title={bootT("boot.couldNotLoad")} message={this.state.error.message || bootT("boot.interfaceFailed")}>
          <div className="boot-recovery-actions">
            <button type="button" onClick={() => {
              resetLocalUiState();
              clearStartupIssue();
              window.location.reload();
            }}>
              Reset UI state
            </button>
            <button type="button" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </BootDiagnostic>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  const language = readBootLanguage();
  applyBootLanguage(language);
  document.body.innerHTML = `<main class="boot-fallback" role="alert"><section><h1>${escapeHtml(translate(language, "boot.couldNotLoad"))}</h1><p>${escapeHtml(translate(language, "boot.rootMissing"))}</p></section></main>`;
} else if (!(window as Window & { crossAge?: unknown }).crossAge) {
  createRoot(rootElement).render(
    <BootDiagnostic
      title={bootT("boot.bridgeUnavailable")}
      message={bootT("boot.bridgeMessage")}
    />
  );
} else {
  createRoot(rootElement).render(
  <React.StrictMode>
      <RendererBoundary>
        <StartupRecoveryGate>
          <App />
        </StartupRecoveryGate>
      </RendererBoundary>
  </React.StrictMode>
  );
}
