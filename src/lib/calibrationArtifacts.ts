import type {
  CalibrationLearningArtifact,
  CalibrationLearningResult,
  CalibrationLearningStatus,
  EmbeddingAdapterStatus,
  LearningJobsResult,
} from "../types";

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : null;
}

function stringField(record: AnyRecord, camelKey: string, snakeKey = camelKey): string {
  const value = record[camelKey] ?? record[snakeKey];
  return value === null || value === undefined ? "" : String(value);
}

function numberField(record: AnyRecord, camelKey: string, snakeKey = camelKey): number | undefined {
  const value = record[camelKey] ?? record[snakeKey];
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function recordField(record: AnyRecord, key: string): Record<string, unknown> | undefined {
  const value = asRecord(record[key]);
  return value ? { ...value } : undefined;
}

function optionalString(value: string): string | undefined {
  return value ? value : undefined;
}

export function normalizeCalibrationLearningArtifact(value: unknown): CalibrationLearningArtifact | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    artifactId: optionalString(stringField(record, "artifactId", "artifact_id")),
    artifactType: optionalString(stringField(record, "artifactType", "artifact_type")),
    status: stringField(record, "status") || "candidate",
    modelName: optionalString(stringField(record, "modelName", "model_name")),
    versionKey: optionalString(stringField(record, "versionKey", "version_key")),
    trainingDataHash: optionalString(stringField(record, "trainingDataHash", "training_data_hash")),
    inputCount: numberField(record, "inputCount", "input_count"),
    positiveCount: numberField(record, "positiveCount", "positive_count"),
    negativeCount: numberField(record, "negativeCount", "negative_count"),
    metrics: recordField(record, "metrics"),
    payload: recordField(record, "payload"),
    artifactHash: optionalString(stringField(record, "artifactHash", "artifact_hash")),
    parentArtifactId: optionalString(stringField(record, "parentArtifactId", "parent_artifact_id")),
    createdAt: optionalString(stringField(record, "createdAt", "created_at")),
    promotedAt: stringField(record, "promotedAt", "promoted_at") || null,
  };
}

export function normalizeCalibrationLearningArtifacts(value: unknown): CalibrationLearningArtifact[] {
  return Array.isArray(value)
    ? value.map(normalizeCalibrationLearningArtifact).filter((item): item is CalibrationLearningArtifact => Boolean(item))
    : [];
}

export function normalizeCalibrationLearningStatus(value: unknown): CalibrationLearningStatus {
  const record = asRecord(value) ?? {};
  return {
    ...(record as Partial<CalibrationLearningStatus>),
    summary: (asRecord(record.summary) ?? {}) as unknown as CalibrationLearningStatus["summary"],
    current: (asRecord(record.current) ?? {}) as unknown as CalibrationLearningStatus["current"],
    artifacts: normalizeCalibrationLearningArtifacts(record.artifacts),
    readiness: asRecord(record.readiness) as unknown as CalibrationLearningStatus["readiness"] | undefined,
  };
}

export function normalizeEmbeddingAdapterStatus(value: unknown): EmbeddingAdapterStatus {
  const record = asRecord(value) ?? {};
  return {
    ...(record as Partial<EmbeddingAdapterStatus>),
    summary: (asRecord(record.summary) ?? {}) as unknown as EmbeddingAdapterStatus["summary"],
    artifacts: normalizeCalibrationLearningArtifacts(record.artifacts),
    activeArtifact: normalizeCalibrationLearningArtifact(record.activeArtifact),
    readiness: asRecord(record.readiness) as unknown as EmbeddingAdapterStatus["readiness"] | undefined,
    coverage: asRecord(record.coverage) as unknown as EmbeddingAdapterStatus["coverage"] | undefined,
  };
}

export function normalizeCalibrationLearningResult(value: unknown): CalibrationLearningResult {
  const record = asRecord(value) ?? {};
  return {
    ...(record as Partial<CalibrationLearningResult>),
    artifact: normalizeCalibrationLearningArtifact(record.artifact) ?? undefined,
    payload: recordField(record, "payload"),
    metrics: recordField(record, "metrics"),
    summary: asRecord(record.summary) as unknown as CalibrationLearningResult["summary"] | undefined,
  };
}

export function normalizeLearningJobsResult(value: unknown): LearningJobsResult {
  const record = asRecord(value) ?? {};
  return {
    ...(record as Partial<LearningJobsResult>),
    staged: Boolean(record.staged),
    artifactCreated: Boolean(record.artifactCreated),
    reason: stringField(record, "reason"),
    calibration: record.calibration ? normalizeCalibrationLearningResult(record.calibration) : undefined,
    readiness: (asRecord(record.readiness) ?? {}) as unknown as LearningJobsResult["readiness"],
    summary: asRecord(record.summary) as unknown as LearningJobsResult["summary"] | undefined,
    status: record.status ? normalizeCalibrationLearningStatus(record.status) : undefined,
  };
}
