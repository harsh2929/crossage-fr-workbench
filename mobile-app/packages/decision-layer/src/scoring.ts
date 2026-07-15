// Port of the banding/threshold surface of crossage_fr/match/scoring.py + config.Thresholds.
// This is what lets the phone re-band a match instantly when the user changes strictness,
// with no round-trip to the desktop.

export interface Thresholds {
  confident: number;
  likely: number;
  relaxedChild: number;
  qualityMin: number;
}

/** The desktop's default thresholds (config.Thresholds). */
export const DEFAULT_THRESHOLDS: Thresholds = {
  confident: 0.4,
  likely: 0.28,
  relaxedChild: 0.2,
  qualityMin: 0.15,
};

/** Map a fused score to its review band. */
export function bandForScore(score: number, thresholds: Thresholds): string {
  if (score >= thresholds.confident) return 'confident';
  if (score >= thresholds.likely) return 'likely';
  if (score >= thresholds.relaxedChild) return 'child-bucket maybe';
  return 'below-review';
}

const POSE_REVIEW_DELTAS: Readonly<Record<string, number>> = {
  profile: 0.08,
  'edge-face': 0.08,
  'three-quarter': 0.04,
};
const POSE_REVIEW_MINIMUM = 0.12;

/**
 * Relax ONLY the child-bucket review floor for hard poses (profile / edge / three-quarter),
 * never the confident/likely operating points. Returns the input unchanged when there is no
 * applicable relaxation.
 */
export function thresholdsForPose(thresholds: Thresholds, poseBucket: string | null | undefined): Thresholds {
  const pose = String(poseBucket ?? 'unknown').trim().toLowerCase().replace(/_/g, '-');
  const delta = POSE_REVIEW_DELTAS[pose] ?? 0.0;
  if (delta <= 0) return thresholds;
  const relaxed = Math.max(POSE_REVIEW_MINIMUM, thresholds.relaxedChild - delta);
  if (relaxed >= thresholds.relaxedChild) return thresholds;
  return {
    confident: thresholds.confident,
    likely: thresholds.likely,
    relaxedChild: relaxed,
    qualityMin: thresholds.qualityMin,
  };
}
