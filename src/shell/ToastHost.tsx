// Global toast-host (Wave 0 substrate). One aria-live region for the whole app,
// replacing the per-tab role="alert"/aria-live one-offs. Consumers call
// useToast().notify({ tone, message }) with past-tense, count-bearing copy
// ("Saved face photos added: 12."); the host handles stacking, auto-dismiss,
// accessibility, and the toast-notice entrance (motion tokens, reduced-motion aware).
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, Loader2, X } from "lucide-react";
import { createToast, toastReducer, type Toast, type ToastInput, type ToastTone } from "../lib/toast";

interface ToastContextValue {
  toasts: Toast[];
  notify: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const seqRef = useRef(0);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    dispatch({ type: "dismiss", id });
  }, []);

  const notify = useCallback((input: ToastInput) => {
    seqRef.current += 1;
    const toast = createToast(input, Date.now(), seqRef.current);
    dispatch({ type: "push", toast });
    // ttl 0 = sticky (busy); the caller dismisses it when the work resolves.
    if (toast.ttl > 0) {
      const timer = setTimeout(() => {
        timersRef.current.delete(toast.id);
        dispatch({ type: "dismiss", id: toast.id });
      }, toast.ttl);
      timersRef.current.set(toast.id, timer);
    }
    return toast.id;
  }, []);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    dispatch({ type: "clear" });
  }, []);

  // Clear every pending timer if the provider ever unmounts.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toasts, notify, dismiss, clear }), [toasts, notify, dismiss, clear]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// A stable no-op used when there is no provider (tests, error screens). Keeps
// useToast() safe to call anywhere — a stray notify() is a silent no-op, not a crash.
const NOOP_TOAST: ToastContextValue = {
  toasts: [],
  notify: () => "",
  dismiss: () => {},
  clear: () => {},
};

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST;
}

const TONE_ICON: Record<ToastTone, typeof Check> = {
  ok: Check,
  warn: AlertTriangle,
  error: AlertCircle,
  busy: Loader2,
};

/** The visual overlay. Render once, near the app root, inside <ToastProvider>. */
export function ToastHost() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        const isError = toast.tone === "error";
        return (
          <div
            key={toast.id}
            className={`toast ${toast.tone}`}
            role={isError ? "alert" : "status"}
            aria-live={isError ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <Icon size={16} className={toast.tone === "busy" ? "spin" : undefined} aria-hidden="true" />
            <span className="toast-message">{toast.message}</span>
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            <button type="button" className="toast-dismiss" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
