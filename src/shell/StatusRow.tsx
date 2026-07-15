// Presentational status row: busy ▸ notice ▸ ready three-state + simple-engine
// banner + inline scan-cancel. Extracted verbatim from App.tsx (behavior-identical).
import { AlertCircle, Check, Loader2, Pause, Play, X } from "lucide-react";
import type { LanguageCode, TranslationKey, UiMessageKey } from "../i18n";

type UiMessageValue = string | number | { text: string | number; localize: true };

interface ShellNotice {
  tone: "ok" | "warn" | "error";
  text: string;
  messageKey?: UiMessageKey;
  values?: Record<string, UiMessageValue>;
  errorCode?: string;
  action?: string;
}

interface StatusRowProps {
  busy: string | null;
  uiText: (source: string) => string;
  scanInFlight: boolean;
  cancelActiveScan: () => void;
  resumeActiveScan: () => void;
  scanCancelRequested: boolean;
  scanPaused: boolean;
  notice: ShellNotice | null;
  language: LanguageCode;
  formatErrorMessage: (language: LanguageCode, code: string | null | undefined, fallback: string, action?: string) => string;
  uiMessage: (key: UiMessageKey, values?: Record<string, UiMessageValue>) => string;
  t: (key: TranslationKey) => string;
  isDemoMode: boolean;
}

export function StatusRow(props: StatusRowProps) {
  const { busy, uiText, notice, language } = props;
  // Operational feedback is transient UI, not permanent page chrome. Engine
  // mode already has a dedicated, actionable home in the sidebar.
  if (!busy && !notice) return null;
  return (
    <div className="status-row" aria-label="Activity status">
      {busy ? (
        <div className="notice busy" role="status" aria-live="polite" aria-atomic="true">
          {props.scanPaused ? <Pause size={16} /> : <Loader2 className="spin" size={16} />}
          {props.scanCancelRequested ? uiText("Cancelling scan…") : props.scanPaused ? uiText("Scan paused") : uiText(busy)}
          {props.scanPaused && !props.scanCancelRequested && (
            <button
              type="button"
              className="ghost compact-action inline-resume-scan"
              onClick={props.resumeActiveScan}
              aria-label="Resume scan"
            >
              <Play size={14} />
              <span>Resume scan</span>
            </button>
          )}
          {props.scanInFlight && (
            <button
              type="button"
              className="ghost compact-action danger inline-cancel-scan"
              onClick={props.cancelActiveScan}
              disabled={props.scanCancelRequested}
              aria-label="Cancel scan"
            >
              <X size={14} />
              <span>{props.scanCancelRequested ? "Cancelling…" : "Cancel scan"}</span>
            </button>
          )}
        </div>
      ) : notice ? (
        <div
          className={`notice ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {notice.tone === "error" ? <AlertCircle size={16} /> : <Check size={16} />}
          {notice.errorCode
            ? props.formatErrorMessage(language, notice.errorCode, notice.text, notice.action)
            : notice.messageKey && language !== "en"
            ? props.uiMessage(notice.messageKey, notice.values)
            : uiText(notice.text)}
        </div>
      ) : null}
    </div>
  );
}
