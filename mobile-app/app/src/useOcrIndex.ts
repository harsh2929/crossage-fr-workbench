/**
 * The on-device OCR / Live-Text indexer — recognizes the text inside every photo so Search can find
 * it. Apple Photos indexes Live Text; we do the same, on-device and offline, via ML Kit's text
 * recognizer (@react-native-ml-kit/text-recognition).
 *
 * State machine: idle → indexing (recognize each un-OCR'd photo, newest-first) → ready. If the native
 * module isn't in the build yet (Expo prebuild + a native rebuild is required for it), the FIRST
 * recognize() call throws a link error — we catch it and settle into `unavailable` so the app keeps
 * working with visual-only search; it never crashes render.
 *
 * It's incremental and idempotent: a photo with a row in `photo_text` (even an empty one) is never
 * revisited, so a re-run only OCRs new photos. It snapshots the whole target list ONCE and walks a
 * fixed array (like the CLIP indexer) — a per-photo failure just skips that photo, so the pass always
 * terminates and can never restart-storm. Runs in small batches with a yield between them so it never
 * blocks the UI thread's JS for long, and is gated behind the same opt-in as CLIP via `enabled`.
 */
import { useEffect, useRef, useState } from 'react';
import { Asset } from 'expo-media-library';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { assetsForOcr, putPhotoText, ocrIndexedCount, type OcrTarget } from './replica';

export type OcrStatus = 'idle' | 'indexing' | 'ready' | 'unavailable' | 'error';

export interface OcrIndex {
  status: OcrStatus;
  done: number;
  total: number;
  error: string | null;
}

// OCR needs legible text, so we cap the LONGEST edge higher than CLIP's 512 (small text would vanish
// at that size) but still downscale huge 4000px+ originals so recognition stays fast.
const OCR_MAX_EDGE = 2200;
const BATCH = 8;
// A snapshot ceiling far above any real phone library — we want ALL current image targets in one
// fixed array so the pass is bounded and never re-queries mid-run (which is what let a failed write
// re-surface the same photo forever).
const SNAPSHOT_MAX = 1_000_000;

/**
 * Resolve a file:// URI for a PHAsset id. ML Kit's recognizer reads a concrete image file, not an iOS
 * `ph://` identifier, so we go through getInfo() (which exports a file:// path on iOS). Mirrors the
 * CLIP path's loadableUri.
 */
async function loadableUri(externalId: string): Promise<string> {
  const asset = new Asset(externalId);
  try {
    const info = await asset.getInfo();
    if (info?.uri && !info.uri.startsWith('ph://')) return info.uri;
  } catch {
    /* fall through to the ph:// id */
  }
  return asset.getUri();
}

/**
 * Transcode to a downscaled JPEG the recognizer can read. HEIC is the bulk of a real iPhone library
 * and ML Kit is happiest with JPEG, so we always render to JPEG; we only DOWNSCALE (never upscale —
 * that just wastes time and adds no legibility) when the original's longest edge exceeds the cap.
 */
async function toOcrJpeg(uri: string, width: number | null, height: number | null): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const longest = Math.max(width ?? 0, height ?? 0);
  if (longest > OCR_MAX_EDGE) {
    // Resize the longer edge to the cap; the other follows via preserved aspect ratio.
    if ((width ?? 0) >= (height ?? 0)) ctx.resize({ width: OCR_MAX_EDGE });
    else ctx.resize({ height: OCR_MAX_EDGE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return out.uri;
}

/** A native link error from the recognizer means the module isn't in the build yet (needs a rebuild). */
function isLinkError(e: unknown): boolean {
  return /doesn't seem to be linked|rebuilt the app|pod install/i.test(String(e));
}

export function useOcrIndex(enabled: boolean): OcrIndex {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // One-shot guard: the pass runs at most once per mount. `enabled` is monotonic (it's driven by the
  // CLIP index reaching 'ready', which never regresses), so we never need to restart — which is
  // exactly why `status` is NOT an effect dependency: a self-triggered status change can't re-fire the
  // effect and spawn a second loop or a restart-storm.
  const started = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    cancelled.current = false;

    (async () => {
      try {
        // Snapshot ALL current image targets once (cheap — just external_ids + dims) and walk the
        // fixed array. Nothing is re-queried mid-run, so a photo whose write fails can't re-surface.
        const targets: OcrTarget[] = assetsForOcr(SNAPSHOT_MAX);
        const already = ocrIndexedCount();
        setTotal(already + targets.length);
        setDone(already);
        setStatus('indexing');

        for (let i = 0; i < targets.length; i++) {
          if (cancelled.current) return;
          const t = targets[i];
          try {
            const uri = await loadableUri(t.external_id);
            const jpeg = await toOcrJpeg(uri, t.width, t.height);
            const result = await TextRecognition.recognize(jpeg);
            // Store the ORIGINAL-case text (for viewer display); putPhotoText also derives a
            // Unicode-lowercased column for case-insensitive search across all scripts.
            putPhotoText(t.external_id, (result?.text ?? '').trim());
          } catch (e) {
            // The recognizer not being linked is terminal (needs a rebuild): stop and degrade to
            // "unavailable" instead of hammering every photo with the same link error.
            if (isLinkError(e)) {
              if (!cancelled.current) setStatus('unavailable');
              return;
            }
            // A single unreadable/corrupt asset (or a transient write hiccup) must not stall or abort
            // the pass — record it as OCR'd with no text so we move on and never revisit it. If even
            // that write fails, swallow and continue: one bad photo can't take down the whole index.
            try {
              putPhotoText(t.external_id, '');
            } catch {
              /* skip this photo entirely */
            }
          }
          if (!cancelled.current) setDone((d) => d + 1);
          // Yield to the event loop every batch so a long OCR run never starves the UI.
          if ((i + 1) % BATCH === 0) await new Promise<void>((r) => setTimeout(r, 0));
        }
        if (!cancelled.current) setStatus('ready');
      } catch (e) {
        // Reaches here only on an unexpected systemic failure (e.g. assetsForOcr itself throwing).
        // Terminal: `status` isn't a dep, so this never re-triggers the effect.
        if (!cancelled.current) {
          setError(String(e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [enabled]);

  return { status, done, total, error };
}
