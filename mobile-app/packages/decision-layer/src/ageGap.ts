// Port of crossage_fr/match/age_gap.py — NIST-grounded cross-age confidence banding.
//
// This never asserts identity. It turns the gap between a reference photo's capture date and a
// candidate photo's capture date into an honest confidence band, and relaxes the REVIEW floor
// (never the confident/likely operating points) for verified wide gaps. This is our wedge:
// Apple Photos has no published cross-age mechanism.

// (maxInclusiveYears, band) — mirrors the NIST IFPC 2025 TAR cliff.
const BANDS: ReadonlyArray<readonly [number, string]> = [
  [2.0, 'high'],
  [4.0, 'moderate'],
  [6.0, 'low'],
];
const WIDE_GAP_BAND = 'very-low';
export const ESTIMATED_BAND = 'estimated';

export const FLAG_THRESHOLD_YEARS = 4.0;
export const CROSS_AGE_GAP_FLAG = 'cross-age-gap';
const MIN_CROSS_AGE_REVIEW_THRESHOLD = 0.12;

/**
 * Parse the date formats the reference tolerates: ISO, EXIF (`YYYY:MM:DD HH:MM:SS`), a trailing
 * Z, and a bare ISO date prefix. Returns a UTC-midnight epoch-day count, or null.
 */
export function parseDateToDays(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const textRaw = value.trim();
  if (!textRaw) return null;
  const text = textRaw.endsWith('Z') ? textRaw.slice(0, -1) : textRaw;

  // EXIF `YYYY:MM:DD[ HH:MM:SS]` and ISO `YYYY-MM-DD[THH:MM:SS | space HH:MM:SS]`.
  const m = text.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    // Validate real calendar date (reject 2020-13-40 etc.), matching strptime strictness.
    const utc = Date.UTC(y, mo - 1, d);
    const back = new Date(utc);
    if (back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d) {
      return Math.floor(utc / 86_400_000);
    }
  }
  return null;
}

/** NIST-grounded confidence band for an absolute age gap in years. */
export function confidenceForGap(years: number): string {
  const magnitude = Math.abs(years);
  for (const [ceiling, band] of BANDS) {
    if (magnitude <= ceiling) return band;
  }
  return WIDE_GAP_BAND;
}

export interface AgeGapResult {
  years: number | null;
  confidence: string | null;
  flag: string | null;
}

/**
 * Compute (ageGapYears, confidenceBand, reviewFlag). Returns all-null when either date is
 * missing/unparseable — the feature is purely additive and must never block a candidate.
 * The NIST band and cross-age flag are only emitted when BOTH dates are real EXIF event dates;
 * otherwise the gap is returned as informational ("estimated") with no flag.
 */
export function computeAgeGap(
  candidateDate: string | null | undefined,
  referenceDate: string | null | undefined,
  candidateProvenance = 'exif',
  referenceProvenance = 'exif',
): AgeGapResult {
  const cand = parseDateToDays(candidateDate);
  const ref = parseDateToDays(referenceDate);
  if (cand === null || ref === null) return { years: null, confidence: null, flag: null };
  // round(x, 2) — Python uses banker's rounding, but at 2 dp over day/365.25 the ties that
  // differ are astronomically unlikely; we match round-half-away and the fixtures confirm it.
  const years = roundTo(Math.abs(cand - ref) / 365.25, 2);
  const verified = candidateProvenance === 'exif' && referenceProvenance === 'exif';
  if (!verified) return { years, confidence: ESTIMATED_BAND, flag: null };
  const confidence = confidenceForGap(years);
  const flag = years >= FLAG_THRESHOLD_YEARS ? CROSS_AGE_GAP_FLAG : null;
  return { years, confidence, flag };
}

/** Review-only threshold floor for a verified wide gap. Strong/likely operating points never move. */
export function reviewThresholdForGap(
  baseThreshold: number,
  years: number | null | undefined,
  confidence: string | null | undefined,
): number {
  const base = Number(baseThreshold);
  if (!Number.isFinite(base)) return baseThreshold;
  const gap = years == null ? 0.0 : Math.abs(Number(years));
  if (confidence === 'very-low' && gap > 6.0) {
    return roundTo(Math.max(MIN_CROSS_AGE_REVIEW_THRESHOLD, base - 0.04), 6);
  }
  if (confidence === 'low' && gap > 4.0) {
    return roundTo(Math.max(MIN_CROSS_AGE_REVIEW_THRESHOLD, base - 0.02), 6);
  }
  return roundTo(base, 6);
}

/** Round-half-away-from-zero to `digits` decimals, matching Python's round() for these fixtures. */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
