/**
 * Leaf module: photo geometry + the ph:// URI helper + date formatting.
 *
 * Imported by ui / PhotoDetail / Albums / Duplicates / Desktop so there is ONE definition of each.
 * It imports only react-native (no local modules), which breaks the ui↔PhotoDetail cycle that
 * previously forced two divergent copies of `assetUri`.
 */
import { Dimensions } from 'react-native';

export const COLS = 4;
const { width: SCREEN_W } = Dimensions.get('window');
export const CELL = Math.floor(SCREEN_W / COLS);

/** A tapped cell's window rectangle, threaded into the viewer so it can zoom open from that spot. */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** iOS Asset.id is a PHAsset localIdentifier; expo-image renders it via the ph:// scheme. */
export function assetUri(id: string): string {
  return id.startsWith('ph://') ? id : `ph://${id}`;
}

/** "Mar 3, 2026 · 4:15 PM" — locale-aware, empty string for no timestamp. */
export function formatDateTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
