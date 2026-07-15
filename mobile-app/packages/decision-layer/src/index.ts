// @vintrace/decision-layer — the desktop decision layer, ported to TypeScript.
//
// Zero model weights, zero native deps: given desktop-computed calibration parameters and a raw
// cosine, the phone re-bands, re-thresholds, and re-ranks face matches offline and instantly.
// Apple Photos exposes no decision layer at all; this is the product's moat, running on-device.
//
// Conformance with the Python reference (crossage_fr/match) is enforced by the golden-fixture
// test in ./test/conformance.test.ts.

export {
  sigmoid,
  PlattCalibrator,
  fuseScores,
  asNormScore,
  CohortNormalizer,
  normalizedPairCenter,
  AdaptiveLinearCalibrator,
  ADAPTIVE_CALIBRATOR_VERSION,
} from './calibration';
export type { AdaptiveCalibratorPayload } from './calibration';

export {
  parseDateToDays,
  confidenceForGap,
  computeAgeGap,
  reviewThresholdForGap,
  FLAG_THRESHOLD_YEARS,
  CROSS_AGE_GAP_FLAG,
  ESTIMATED_BAND,
} from './ageGap';
export type { AgeGapResult } from './ageGap';

export { bandForScore, thresholdsForPose, DEFAULT_THRESHOLDS } from './scoring';
export type { Thresholds } from './scoring';

export { l2normalize, dot, norm } from './vectorMath';
