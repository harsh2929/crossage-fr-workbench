// A runnable demonstration of the composed capability — the actual product moment.
//
// The desktop (the licensed face-embedding oracle) computes a raw cosine + an adaptive calibrator
// and syncs them to the phone. The phone then does what Apple Photos cannot: it re-bands and
// re-thresholds the match locally and instantly, with no network and no model download — including
// widening the REVIEW floor for a verified cross-age gap.
//
// Run: npx tsx test/demo.ts

import {
  AdaptiveLinearCalibrator,
  CohortNormalizer,
  computeAgeGap,
  reviewThresholdForGap,
  bandForScore,
  DEFAULT_THRESHOLDS,
} from '../src/index';

// --- What the desktop synced down (parameters only; zero pixels, zero model weights) ---
const rawCosine = 0.33; // recognizer similarity for one candidate vs a reference
const calibratorPayload = {
  version: 'adaptive-linear-v1',
  weights: [0.4, -0.2, 0.1, 0.05, 2.5], // dim=4, last weight (cosine) > 0 → monotonic
  bias: -0.3,
  dimension: 4,
  modelName: 'buffalo_l',
};
const pairCenter = [0.5, -0.5, 0.5, -0.5];
const cohort = [
  [0.2, 0.1, -0.3, 0.4],
  [-0.1, 0.5, 0.2, 0.1],
  [0.3, -0.2, 0.1, 0.5],
  [0.1, 0.4, -0.4, 0.2],
];

console.log('=== On-device decision layer (offline, no round-trip) ===\n');

// 1. Calibrated probability — the desktop's calibrator, run on the phone.
const calib = AdaptiveLinearCalibrator.fromPayload(calibratorPayload);
const probability = calib.probability(pairCenter, rawCosine);
console.log(`raw cosine            : ${rawCosine.toFixed(3)}`);
console.log(`calibrated P(same)    : ${probability.toFixed(4)}`);

// 2. AS-Norm — how far this match stands out from the probe's own impostor cohort.
const normalizer = new CohortNormalizer(cohort);
const z = normalizer.normalize(pairCenter, rawCosine);
console.log(`AS-Norm z-score       : ${z.toFixed(3)}  (std-devs above the impostor cohort)\n`);

// 3. Re-band under two strictness settings the USER can flip locally — instant, offline.
const strict = { ...DEFAULT_THRESHOLDS, confident: 0.45, likely: 0.35, relaxedChild: 0.28 };
console.log(`band @ default (confident=${DEFAULT_THRESHOLDS.confident}) : ${bandForScore(rawCosine, DEFAULT_THRESHOLDS)}`);
console.log(`band @ strict  (confident=${strict.confident}) : ${bandForScore(rawCosine, strict)}\n`);

// 4. The cross-age wedge: a verified 8-year gap widens the REVIEW floor (never confident/likely).
const gap = computeAgeGap('2024-06-01', '2016-06-01', 'exif', 'exif');
const reviewFloor = reviewThresholdForGap(DEFAULT_THRESHOLDS.relaxedChild, gap.years, gap.confidence);
console.log(`cross-age gap         : ${gap.years} yrs → confidence "${gap.confidence}", flag "${gap.flag}"`);
console.log(`review floor          : ${DEFAULT_THRESHOLDS.relaxedChild} → ${reviewFloor}  (relaxed for the wide verified gap)`);
console.log(`  → this candidate is ${rawCosine >= reviewFloor ? 'SURFACED for review' : 'below review'} at the widened floor`);
console.log('\nApple Photos exposes none of this. It runs here on the phone, offline.');
