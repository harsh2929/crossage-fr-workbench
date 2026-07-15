// Port of the INFERENCE surface of crossage_fr/match/calibration.py.
//
// The phone never fits calibrators (that stays on the desktop). It consumes desktop-computed
// parameters and, given a raw cosine, produces the calibrated probability / normalized score —
// so it can re-band and re-rank matches offline, instantly, with zero model download. This is
// the product's moat, and it is pure arithmetic.
//
// Every function here must match the Python reference exactly; the conformance test enforces it.

import { l2normalize, norm } from './vectorMath';

/** Logistic, clipped to [-60, 60] before exp to match numpy's np.clip behaviour. */
export function sigmoid(z: number): number {
  const clipped = Math.max(-60.0, Math.min(60.0, z));
  return 1.0 / (1.0 + Math.exp(-clipped));
}

/** Platt logistic map: score -> P(same identity) = sigmoid(a * score + b). */
export class PlattCalibrator {
  constructor(
    public readonly a: number,
    public readonly b: number,
  ) {}

  probability(score: number): number {
    return sigmoid(this.a * score + this.b);
  }

  toList(): [number, number] {
    return [this.a, this.b];
  }

  static fromList(values: readonly number[]): PlattCalibrator {
    if (!values || values.length !== 2) {
      throw new Error('PlattCalibrator.fromList expects exactly [a, b].');
    }
    return new PlattCalibrator(values[0], values[1]);
  }
}

/**
 * Weighted average of per-model match scores (score-level fusion, never embedding
 * concatenation — cross-model spaces are not compatible). Uniform weights by default;
 * 0.0 for an empty input; falls back to uniform when weights are absent or non-positive.
 */
export function fuseScores(scores: readonly number[], weights?: readonly number[] | null): number {
  const values = scores.map(Number);
  if (values.length === 0) return 0.0;
  if (weights == null) {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  const w = weights.slice(0, values.length).map(Number);
  const total = w.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  let acc = 0;
  for (let i = 0; i < values.length; i++) acc += values[i] * (w[i] ?? 0);
  return acc / total;
}

/**
 * Adaptive symmetric-style normalization: how far a match score stands out from the probe's own
 * impostor cohort, in standard deviations. z = (raw - mean(top-K)) / std(top-K), sigma floored
 * at 0.05 so a degenerate zero-variance cohort cannot blow up. Returns 0.0 for an empty cohort.
 */
export function asNormScore(rawCosine: number, cohortScores: readonly number[], topK = 10): number {
  const cohort = Array.from(cohortScores, Number);
  if (cohort.length === 0) return 0.0;
  const k = Math.max(1, Math.min(Math.trunc(topK), cohort.length));
  const top = cohort.slice().sort((x, y) => y - x).slice(0, k);
  const mu = top.reduce((s, v) => s + v, 0) / top.length;
  // Population standard deviation (numpy's default ddof=0), to match the reference.
  const variance = top.reduce((s, v) => s + (v - mu) * (v - mu), 0) / top.length;
  const sigma = Math.max(Math.sqrt(variance), 0.05);
  return (rawCosine - mu) / sigma;
}

/**
 * AS-Norm using a fixed cohort of impostor embeddings. The cohort vectors are L2-normalized on
 * construction (rejecting non-finite or zero-norm cohorts), and each probe is compared by cosine.
 */
export class CohortNormalizer {
  private readonly vectors: number[][];
  private readonly dim: number;

  constructor(cohort: readonly (readonly number[])[]) {
    if (!cohort || cohort.length === 0) {
      this.vectors = [];
      this.dim = 0;
      return;
    }
    const dim = cohort[0].length;
    for (const row of cohort) {
      if (row.length !== dim || !row.every((v) => Number.isFinite(v))) {
        throw new Error('Cohort vectors must be a finite 2-D array');
      }
      if (norm(row) <= 1e-12) {
        throw new Error('Cohort vectors must have non-zero norm');
      }
    }
    this.vectors = cohort.map((row) => l2normalize(row));
    this.dim = dim;
  }

  scores(vector: readonly number[]): number[] {
    if (this.vectors.length === 0) return [];
    if (vector.length !== this.dim || !vector.every((v) => Number.isFinite(v))) return [];
    const n = norm(vector);
    if (n <= 1e-12) return [];
    const unit = vector.map((v) => v / n);
    return this.vectors.map((row) => {
      let acc = 0;
      for (let i = 0; i < unit.length; i++) acc += row[i] * unit[i];
      return acc;
    });
  }

  normalize(probeVector: readonly number[], rawCosine: number, topK = 10): number {
    return asNormScore(rawCosine, this.scores(probeVector), topK);
  }

  /** True symmetric AS-Norm: average of probe- and reference-side z scores. */
  normalizePair(
    probeVector: readonly number[],
    referenceVector: readonly number[],
    rawCosine: number,
    topK = 20,
  ): number {
    const probeScores = this.scores(probeVector);
    const refScores = this.scores(referenceVector);
    if (probeScores.length === 0 || refScores.length === 0) return 0.0;
    const value = 0.5 * (asNormScore(rawCosine, probeScores, topK) + asNormScore(rawCosine, refScores, topK));
    return Number.isFinite(value) ? value : 0.0;
  }
}

/** Symmetric pair-location feature (Adaptive Calibration). Returns null on degenerate inputs. */
export function normalizedPairCenter(
  left: readonly number[],
  right: readonly number[],
): number[] | null {
  if (left.length !== right.length || left.length === 0) return null;
  if (!left.every((v) => Number.isFinite(v)) || !right.every((v) => Number.isFinite(v))) return null;
  const ln = norm(left);
  const rn = norm(right);
  if (ln <= 1e-12 || rn <= 1e-12) return null;
  const center = left.map((v, i) => v / ln + right[i] / rn);
  const cn = norm(center);
  if (cn <= 1e-12) return null;
  return center.map((v) => v / cn);
}

export const ADAPTIVE_CALIBRATOR_VERSION = 'adaptive-linear-v1';

export interface AdaptiveCalibratorPayload {
  version: string;
  weights: number[];
  bias: number;
  dimension: number;
  modelName?: string;
  inputCount?: number;
  positiveCount?: number;
  negativeCount?: number;
}

/** AC-Linear: sigmoid(w^T [normalized pair center, cosine] + b). */
export class AdaptiveLinearCalibrator {
  constructor(
    public readonly weights: readonly number[],
    public readonly bias: number,
    public readonly modelName = '',
    public readonly inputCount = 0,
    public readonly positiveCount = 0,
    public readonly negativeCount = 0,
    public readonly version = ADAPTIVE_CALIBRATOR_VERSION,
  ) {}

  get dimension(): number {
    return Math.max(0, this.weights.length - 1);
  }

  probability(pairCenter: readonly number[], rawCosine: number): number {
    if (pairCenter.length !== this.dimension || !pairCenter.every((v) => Number.isFinite(v))) {
      throw new Error('Adaptive calibrator pair center has the wrong shape');
    }
    const n = norm(pairCenter);
    if (n <= 1e-12) throw new Error('Adaptive calibrator pair center has zero norm');
    if (!Number.isFinite(rawCosine)) throw new Error('Adaptive calibrator score must be finite');
    const features = [...pairCenter.map((v) => v / n), rawCosine];
    let logit = this.bias;
    for (let i = 0; i < this.weights.length; i++) logit += this.weights[i] * features[i];
    return sigmoid(logit);
  }

  toPayload(): AdaptiveCalibratorPayload {
    return {
      version: this.version,
      weights: this.weights.map(Number),
      bias: this.bias,
      dimension: this.dimension,
      modelName: this.modelName,
      inputCount: this.inputCount,
      positiveCount: this.positiveCount,
      negativeCount: this.negativeCount,
    };
  }

  static fromPayload(payload: AdaptiveCalibratorPayload): AdaptiveLinearCalibrator {
    if (!payload || payload.version !== ADAPTIVE_CALIBRATOR_VERSION) {
      throw new Error('Unsupported adaptive calibrator payload');
    }
    const weightsRaw = payload.weights;
    if (!Array.isArray(weightsRaw) || weightsRaw.length < 2 || weightsRaw.length > 2049) {
      throw new Error('Adaptive calibrator weights are invalid');
    }
    const weights = weightsRaw.map(Number);
    const bias = Number(payload.bias);
    if (![...weights, bias].every((v) => Number.isFinite(v))) {
      throw new Error('Adaptive calibrator contains non-finite parameters');
    }
    const dimension = Math.trunc(payload.dimension ?? weights.length - 1) || 0;
    if (dimension !== weights.length - 1) {
      throw new Error('Adaptive calibrator dimension mismatch');
    }
    if (weights[weights.length - 1] <= 0.0) {
      throw new Error('Adaptive calibrator must remain monotonic in cosine similarity');
    }
    return new AdaptiveLinearCalibrator(
      weights,
      bias,
      String(payload.modelName ?? '').slice(0, 200),
      Math.max(0, Math.trunc(payload.inputCount ?? 0)),
      Math.max(0, Math.trunc(payload.positiveCount ?? 0)),
      Math.max(0, Math.trunc(payload.negativeCount ?? 0)),
    );
  }
}
