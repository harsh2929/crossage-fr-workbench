import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import appIconUrl from "../desktop/assets/icon.png";
import { normalizeLanguage, translate } from "./i18n";
import type { LanguageCode, TranslationKey } from "./i18n";
import "./styles.css";

const languageStorageKey = "vintrace:language";

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

function BootDiagnostic({ title, message }: { title: string; message: string }) {
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
      </section>
    </main>
  );
}

class RendererBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Renderer failed", error);
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
      return <BootDiagnostic title={bootT("boot.couldNotLoad")} message={this.state.error.message || bootT("boot.interfaceFailed")} />;
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
        <App />
      </RendererBoundary>
  </React.StrictMode>
  );
}
