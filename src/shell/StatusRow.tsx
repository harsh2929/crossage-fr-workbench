// Presentational status row: busy ▸ notice ▸ ready three-state + simple-engine
// banner + inline scan-cancel. Extracted verbatim from App.tsx (behavior-identical).
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import type { LanguageCode, TranslationKey, UiMessageKey } from "../i18n";

interface ShellNotice {
  tone: "ok" | "warn" | "error";
  text: string;
  messageKey?: UiMessageKey;
  values?: Record<string, string | number>;
  errorCode?: string;
  action?: string;
}

interface StatusRowProps {
  busy: string | null;
  uiText: (source: string) => string;
  scanInFlight: boolean;
  cancelActiveScan: () => void;
  scanCancelRequested: boolean;
  notice: ShellNotice | null;
  language: LanguageCode;
  formatErrorMessage: (language: LanguageCode, code: string | null | undefined, fallback: string, action?: string) => string;
  uiMessage: (key: UiMessageKey, values?: Record<string, string | number>) => string;
  t: (key: TranslationKey) => string;
  isDemoMode: boolean;
}

export function StatusRow(props: StatusRowProps) {
  const { busy, uiText, notice, language, t, isDemoMode } = props;
  return (
    <div className="status-row">
      {busy ? (
        <div className="notice busy" role="status" aria-live="polite" aria-atomic="true">
          <Loader2 className="spin" size={16} /> {uiText(busy)}
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
      ) : (
        <div className="notice neutral" role="status" aria-live="polite" aria-atomic="true">{t("status.ready")}</div>
      )}
      {isDemoMode && <div className="notice warn">{t("status.simpleMatching")}</div>}
    </div>
  );
}
