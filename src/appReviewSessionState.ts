export function reviewPrefStorageKey(key: string) {
  return `vintrace:review:${key}`;
}

// Session-scoped store for the review filter context. It is intentionally best
// effort and clears with the browser session like other transient UI prefs.
export function readReviewPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(reviewPrefStorageKey(key));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeReviewPref(values: Record<string, unknown>) {
  try {
    for (const [key, value] of Object.entries(values)) {
      window.sessionStorage.setItem(reviewPrefStorageKey(key), JSON.stringify(value));
    }
  } catch {
    // Persisting review prefs is best effort.
  }
}
