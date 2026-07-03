// Shared toast-host state machine (Wave 0 substrate for the product-love system).
//
// A toast is a transient, past-tense, count-bearing notice ("Saved face photos
// added: 12.") announced via a single global aria-live host — replacing the
// per-tab role="alert"/aria-live one-offs scattered across App/PhotosView/Search.
// This module is the pure logic (no React) so it can be unit-tested directly;
// the ToastHost component + useToast hook wrap it.

export type ToastTone = "ok" | "warn" | "error" | "busy";

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  /** epoch ms when the toast was created (drives auto-prune). */
  createdAt: number;
  /** ms to live before auto-prune; 0 = sticky (dismissed programmatically). */
  ttl: number;
};

export type ToastInput = {
  tone: ToastTone;
  message: string;
  id?: string;
  ttl?: number;
};

// Tone-specific lifetimes. Errors linger longest (blameless copy needs reading
// time); "busy" is sticky until the caller resolves it into ok/error.
export const TONE_TTL: Record<ToastTone, number> = {
  ok: 3500,
  warn: 5000,
  error: 6500,
  busy: 0,
};

// At most this many toasts are visible; a push past the cap evicts the oldest.
export const MAX_TOASTS = 4;

export function createToast(input: ToastInput, now: number, seq: number): Toast {
  const ttl = input.ttl ?? TONE_TTL[input.tone];
  return {
    id: input.id ?? `toast-${seq}`,
    tone: input.tone,
    message: input.message,
    createdAt: now,
    ttl,
  };
}

export type ToastAction =
  | { type: "push"; toast: Toast }
  | { type: "dismiss"; id: string }
  | { type: "prune"; now: number }
  | { type: "clear" };

export function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case "push": {
      const next = [...state, action.toast];
      // Keep only the newest MAX_TOASTS (drop oldest first).
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    }
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
    case "prune":
      // Sticky (ttl 0) toasts never auto-expire; others live until createdAt+ttl.
      return state.filter((t) => t.ttl === 0 || t.createdAt + t.ttl > action.now);
    case "clear":
      return [];
    default:
      return state;
  }
}
