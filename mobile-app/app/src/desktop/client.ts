/**
 * Desktop uplink client — the native side of the deep desktop integration.
 *
 * Talks to the desktop's SEC-09 read-only companion HTTP surface (the same authenticated /v1/* routes
 * the web companion uses). Pairing POSTs the one-use code to /v1/mobile/pair; the desktop sets a
 * session cookie which iOS's shared NSURLSession cookie store then carries on every subsequent
 * request (RN fetch + expo-image alike), so no token handling is needed on-device. The phone pulls
 * what it legally/technically cannot compute itself: real-resolution previews, the desktop catalog,
 * and — the oracle value — face recognition / people via /v1/assets/analyze.
 *
 * All ingested text (titles, captions, OCR) arrives wrapped in the MCP-05 untrusted-text envelope and
 * MUST be unwrapped before display (`untrust`).
 */

export interface DesktopDevice {
  accountId: string;
  label: string;
  readOnly: boolean;
  allowPreviews: boolean;
  expiresAt: number;
  expiresInSeconds: number;
}

export interface DesktopAsset {
  assetId: string;
  title: string;
  width?: number;
  height?: number;
  mediaKind?: string;
  captureDate?: string | null;
}

export interface DesktopPerson {
  personName: string;
  candidateId: string;
  status: string;
  score?: number;
  band?: string;
}

const UNTRUSTED_MARKERS = /[⟪]\/?UNTRUSTED[⟫]/g; // ⟪UNTRUSTED⟫ … ⟪/UNTRUSTED⟫

/** Unwrap the MCP-05 untrusted-text envelope so text can be shown (never executed). */
export function untrust(v: unknown): string {
  if (v == null) return '';
  const raw =
    typeof v === 'string'
      ? v
      : typeof v === 'object' && 'value' in (v as Record<string, unknown>)
        ? String((v as { value?: unknown }).value ?? '')
        : String(v);
  return raw.replace(UNTRUSTED_MARKERS, '').trim();
}

export function normalizeBase(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(s)) s = 'http://' + s;
  return s;
}

async function req(base: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(base + path, {
    ...init,
    credentials: 'include', // send the session cookie the desktop set at pairing
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (e.g. preview bytes) — handled by the caller */
  }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json;
}

/** Exchange the one-use pairing code; the desktop sets the session cookie the OS then reuses. */
export async function pairDesktop(
  hostInput: string,
  pairingCode: string,
): Promise<{ base: string; device: DesktopDevice }> {
  const base = normalizeBase(hostInput);
  const j = await req(base, '/v1/mobile/pair', {
    method: 'POST',
    body: JSON.stringify({ pairingCode: pairingCode.trim() }),
  });
  return { base, device: j.data.device as DesktopDevice };
}

export async function getSession(base: string): Promise<DesktopDevice> {
  const j = await req(base, '/v1/mobile/session');
  return j.data.device as DesktopDevice;
}

export async function getLibrary(base: string): Promise<{ assetCount: number; collectionCount: number }> {
  const j = await req(base, '/v1/library?includeHealth=false');
  return { assetCount: j.data.assetCount ?? 0, collectionCount: (j.data.collections ?? []).length };
}

export async function searchDesktop(
  base: string,
  query: string,
  mode: 'lexical' | 'semantic' | 'hybrid' = 'lexical',
  limit = 60,
): Promise<DesktopAsset[]> {
  const j = await req(base, '/v1/search', {
    method: 'POST',
    body: JSON.stringify({ query: query.slice(0, 500), mode: query.trim() ? mode : 'lexical', limit, offset: 0 }),
  });
  return (j.data.items ?? []).map(
    (it: any): DesktopAsset => ({
      assetId: it.assetId,
      title: untrust(it.title),
      width: it.width,
      height: it.height,
      mediaKind: it.mediaKind,
      captureDate: it.captureDate ?? null,
    }),
  );
}

/** The oracle call: per-photo face recognition + metadata the phone cannot compute itself. */
export async function analyzeDesktop(
  base: string,
  assetId: string,
): Promise<{ people: DesktopPerson[]; meta: Record<string, unknown> }> {
  const j = await req(base, '/v1/assets/analyze', {
    method: 'POST',
    body: JSON.stringify({ assetIds: [assetId], capabilities: ['people', 'metadata'] }),
  });
  const item = (j.data.items ?? [])[0] ?? {};
  const intel = item.intelligence ?? {};
  return {
    people: (intel.people ?? []).map(
      (p: any): DesktopPerson => ({
        personName: untrust(p.personName),
        candidateId: p.candidateId,
        status: p.status,
        score: p.score,
        band: p.band,
      }),
    ),
    meta: intel.metadata ?? {},
  };
}

/** A desktop-rendered preview URL — expo-image loads it directly (the OS cookie authenticates it). */
export function desktopPreviewUrl(base: string, assetId: string, maxDimension = 640): string {
  return `${base}/v1/assets/${assetId}/preview?maxDimension=${maxDimension}&maxBytes=786432`;
}
