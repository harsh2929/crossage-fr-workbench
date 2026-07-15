// Port of crossage_fr/vector_math.py — the vector helpers the decision layer needs.
// Kept minimal and dependency-free so it runs identically on the phone and in Node.

/**
 * L2-normalize a 1-D vector. Degenerate inputs (zero-norm, tiny-norm, non-finite) normalize
 * to a zero vector rather than propagating NaN/Inf — matching the Python convention exactly.
 */
export function l2normalize(values: readonly number[], eps = 0.0): number[] {
  let sumSq = 0;
  for (const v of values) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  const valid = Number.isFinite(norm) && norm > eps;
  if (!valid) return values.map(() => 0.0);
  return values.map((v) => v / norm);
}

/** Dot product of two equal-length vectors. */
export function dot(a: readonly number[], b: readonly number[]): number {
  let acc = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) acc += a[i] * b[i];
  return acc;
}

/** Euclidean norm. */
export function norm(v: readonly number[]): number {
  return Math.sqrt(dot(v, v));
}
