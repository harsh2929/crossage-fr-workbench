export interface PhotoBurstStackItem {
  assetId: string;
  sourcePath: string;
  mediaKind: string;
  title: string;
  captureDate: string;
  sequence: number;
  keeper: boolean;
  selectionRole: string;
  selectedAt: string;
  coverHint: boolean;
}

export interface PhotoCullingReason {
  code: string;
  impact: "positive" | "negative" | "neutral";
  signal: string;
}

export interface PhotoCullingFrame {
  assetId: string;
  sequence: number;
  score: number;
  rank: number;
  recommended: boolean;
  sharpness: number | null;
  motionClarity: number | null;
  faceQuality: number | null;
  eyesOpen: number | null;
  facesDetected: number;
  eyesConfidence: string;
  faceQualitySource: string;
  reasons: PhotoCullingReason[];
}

export interface PhotoCullingResult {
  analysisId: string;
  version: string;
  stackId: string;
  analyzedAt: string;
  resultSha256: string;
  recommendedAssetId: string;
  recommendationScore: number;
  recommendationConfidence: "high" | "medium" | "low";
  recommendationMargin: number;
  recommendationOnly: boolean;
  requiresReview: boolean;
  automaticDeletion: boolean;
  faceSignalsAllowed: boolean;
  frames: PhotoCullingFrame[];
  application?: { assetId?: string; appliedAt?: string };
}

export interface PhotoCullingStatus {
  available: boolean;
  offline: boolean;
  version: string;
  maxFrames: number;
  recommendationOnly: boolean;
  automaticDeletion: boolean;
  faceSignalsAllowed: boolean;
  faceSignalsReason: string;
  privacyDefault: string;
  eyes?: { available?: boolean; method?: string; heuristic?: boolean };
  fiqa?: { available?: boolean; modelId?: string; modelName?: string; license?: string; reason?: string };
}

export function normalizePhotoCullingStatus(value: unknown): PhotoCullingStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Record<string, unknown>;
  const eyes = status.eyes && typeof status.eyes === "object"
    ? status.eyes as Record<string, unknown>
    : {};
  const fiqa = status.fiqa && typeof status.fiqa === "object"
    ? status.fiqa as Record<string, unknown>
    : {};
  return {
    available: Boolean(status.available),
    offline: status.offline !== false,
    version: String(status.version || ""),
    maxFrames: Math.max(1, Math.min(60, Number(status.maxFrames || 60) || 60)),
    recommendationOnly: true,
    automaticDeletion: false,
    faceSignalsAllowed: Boolean(status.faceSignalsAllowed),
    faceSignalsReason: String(status.faceSignalsReason || ""),
    privacyDefault: String(status.privacyDefault || "local-review-only"),
    eyes: {
      available: Boolean(eyes.available),
      method: String(eyes.method || ""),
      heuristic: eyes.heuristic !== false,
    },
    fiqa: {
      available: Boolean(fiqa.available),
      modelId: String(fiqa.modelId || ""),
      modelName: String(fiqa.modelName || ""),
      license: String(fiqa.license || ""),
      reason: String(fiqa.reason || ""),
    },
  };
}

export interface PhotoBurstStack {
  stackId: string;
  name: string;
  count: number;
  keeperCount: number;
  coverSourcePath: string;
  sourcePaths: string[];
  items: PhotoBurstStackItem[];
  culling?: PhotoCullingResult | null;
}

function normalizedScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

export function normalizePhotoCullingResult(value: unknown): PhotoCullingResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const analysisId = String(result.analysisId || "").trim();
  const stackId = String(result.stackId || "").trim();
  const resultSha256 = String(result.resultSha256 || "").trim().toLowerCase();
  const recommendedAssetId = String(result.recommendedAssetId || "").trim();
  if (!analysisId || !stackId || !/^[a-f0-9]{64}$/.test(resultSha256) || !recommendedAssetId) return null;
  const frames = Array.isArray(result.frames) ? result.frames.flatMap((raw): PhotoCullingFrame[] => {
    if (!raw || typeof raw !== "object") return [];
    const frame = raw as Record<string, unknown>;
    const assetId = String(frame.assetId || "").trim();
    if (!assetId) return [];
    const reasons = Array.isArray(frame.reasons) ? frame.reasons.flatMap((rawReason): PhotoCullingReason[] => {
      if (!rawReason || typeof rawReason !== "object") return [];
      const reason = rawReason as Record<string, unknown>;
      const code = String(reason.code || "").trim();
      const impact = String(reason.impact || "neutral");
      if (!code) return [];
      return [{
        code,
        impact: impact === "positive" || impact === "negative" ? impact : "neutral",
        signal: String(reason.signal || ""),
      }];
    }) : [];
    return [{
      assetId,
      sequence: Math.max(1, Number(frame.sequence || 1) || 1),
      score: normalizedScore(frame.score) || 0,
      rank: Math.max(1, Number(frame.rank || 1) || 1),
      recommended: Boolean(frame.recommended),
      sharpness: normalizedScore(frame.sharpness),
      motionClarity: normalizedScore(frame.motionClarity),
      faceQuality: normalizedScore(frame.faceQuality),
      eyesOpen: normalizedScore(frame.eyesOpen),
      facesDetected: Math.max(0, Number(frame.facesDetected || 0) || 0),
      eyesConfidence: String(frame.eyesConfidence || ""),
      faceQualitySource: String(frame.faceQualitySource || ""),
      reasons,
    }];
  }) : [];
  const confidence = String(result.recommendationConfidence || "low");
  return {
    analysisId,
    version: String(result.version || ""),
    stackId,
    analyzedAt: String(result.analyzedAt || ""),
    resultSha256,
    recommendedAssetId,
    recommendationScore: normalizedScore(result.recommendationScore) || 0,
    recommendationConfidence: confidence === "high" || confidence === "medium" ? confidence : "low",
    recommendationMargin: normalizedScore(result.recommendationMargin) || 0,
    recommendationOnly: true,
    requiresReview: true,
    automaticDeletion: false,
    faceSignalsAllowed: Boolean(result.faceSignalsAllowed),
    frames,
    application: result.application && typeof result.application === "object"
      ? {
        assetId: String((result.application as Record<string, unknown>).assetId || ""),
        appliedAt: String((result.application as Record<string, unknown>).appliedAt || ""),
      }
      : {},
  };
}

export function normalizePhotoBurstStackItem(value: unknown): PhotoBurstStackItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const sourcePath = String(item.sourcePath || "").trim();
  if (!sourcePath) return null;
  const sequence = Number(item.sequence || 0);
  return {
    assetId: String(item.assetId || ""),
    sourcePath,
    mediaKind: String(item.mediaKind || ""),
    title: String(item.title || ""),
    captureDate: String(item.captureDate || ""),
    sequence: Number.isFinite(sequence) && sequence > 0 ? sequence : 0,
    keeper: Boolean(item.keeper),
    selectionRole: String(item.selectionRole || ""),
    selectedAt: String(item.selectedAt || ""),
    coverHint: Boolean(item.coverHint),
  };
}

export function normalizePhotoBurstStack(value: unknown): PhotoBurstStack | null {
  if (!value || typeof value !== "object") return null;
  const stack = value as Record<string, unknown>;
  const stackId = String(stack.stackId || "").trim();
  const sourcePaths = Array.isArray(stack.sourcePaths)
    ? stack.sourcePaths.map((sourcePath) => String(sourcePath || "").trim()).filter(Boolean)
    : [];
  const items = Array.isArray(stack.items)
    ? stack.items.map(normalizePhotoBurstStackItem).filter(Boolean) as PhotoBurstStackItem[]
    : sourcePaths.map((sourcePath, index) => ({
      assetId: "",
      sourcePath,
      mediaKind: "burst",
      title: "",
      captureDate: "",
      sequence: index + 1,
      keeper: false,
      selectionRole: "",
      selectedAt: "",
      coverHint: sourcePath === String(stack.coverSourcePath || ""),
    }));
  if (!stackId || (!sourcePaths.length && !items.length)) return null;
  const count = Number(stack.count || items.length || sourcePaths.length);
  const keeperCount = Number(stack.keeperCount || items.filter((item) => item.keeper).length);
  const culling = normalizePhotoCullingResult(stack.culling);
  return {
    stackId,
    name: String(stack.name || "Burst"),
    count: Number.isFinite(count) && count > 0 ? count : items.length || sourcePaths.length,
    keeperCount: Number.isFinite(keeperCount) && keeperCount > 0 ? keeperCount : 0,
    coverSourcePath: String(stack.coverSourcePath || ""),
    sourcePaths: sourcePaths.length ? sourcePaths : items.map((item) => item.sourcePath),
    items,
    ...(culling ? { culling } : {}),
  };
}

export function normalizePhotoBurstStackList(value: unknown): PhotoBurstStack[] {
  if (!value || typeof value !== "object") return [];
  const rawStacks = (value as { stacks?: unknown }).stacks;
  if (!Array.isArray(rawStacks)) return [];
  return rawStacks.map(normalizePhotoBurstStack).filter(Boolean) as PhotoBurstStack[];
}
