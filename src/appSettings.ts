import type { LearningMode, Thresholds, VideoDecoderConfig } from "./types";

export type SettingsMode = "recommended" | "privacy" | "precision" | "discovery" | "custom";
export type PresetMode = Exclude<SettingsMode, "custom">;

export type SettingsDraft = {
  modelPack: string;
  thresholds: Thresholds;
  clusterMinSize: number;
  faceDetectorSize: number;
  twoPassScan: boolean;
  verificationDetectorSize: number;
  learningMode: LearningMode;
  safeMode: boolean;
  safeModeMultimodal?: boolean;
  safeModeZeroAdmittance?: boolean;
  safeModeThreshold: number;
  safeModeProfile?: string;
  storageBudgetBytes: number;
  maxMediaFileBytes: number;
  videoDecoder: VideoDecoderConfig;
  reviewRules: {
    autoRejectBelow: number;
    autoUncertainLowQuality: boolean;
    autoRejectLowQualityVideo: boolean;
  };
  scanExclusions: {
    dirNames: string[];
    pathKeywords: string[];
    extensions: string[];
    filePaths: string[];
  };
  mode: SettingsMode;
};

export type SettingsValues = Omit<SettingsDraft, "mode" | "modelPack">;

export type SettingsPreset = {
  key: PresetMode;
  label: string;
  detail: string;
  bestFor: string;
  values: SettingsValues;
};

export const defaultScanExclusions = {
  // Keep this list in lockstep with crossage_fr.config.DEFAULT_EXCLUDED_DIR_NAMES.
  // Preset inference compares values structurally; a shortened renderer copy made
  // a brand-new workspace appear "Custom" even though it was untouched.
  dirNames: [
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".mypy_cache",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "$RECYCLE.BIN",
    "System Volume Information",
    "node_modules",
    "venv",
  ],
  pathKeywords: [],
  extensions: [],
  filePaths: []
};

export const defaultVideoDecoder: VideoDecoderConfig = {
  ffmpegPath: "",
  ffprobePath: ""
};

export const settingsPresets: SettingsPreset[] = [
  {
    key: "recommended",
    label: "Recommended",
    detail: "Balanced matching, quality, and Safe Mode.",
    bestFor: "Most libraries",
    values: {
      thresholds: { confident: 0.4, likely: 0.28, relaxedChild: 0.2, qualityMin: 0.15 },
      clusterMinSize: 2,
      faceDetectorSize: 512,
      twoPassScan: true,
      verificationDetectorSize: 640,
      learningMode: "manual",
      safeMode: true,
      safeModeMultimodal: false,
      safeModeThreshold: 0.58,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "privacy",
    label: "Privacy first",
    detail: "More protective filtering before media enters review.",
    bestFor: "Mixed personal albums",
    values: {
      thresholds: { confident: 0.44, likely: 0.32, relaxedChild: 0.24, qualityMin: 0.2 },
      clusterMinSize: 3,
      faceDetectorSize: 512,
      twoPassScan: true,
      verificationDetectorSize: 640,
      learningMode: "manual",
      safeMode: true,
      safeModeMultimodal: true,
      safeModeThreshold: 0.45,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "precision",
    label: "High confidence",
    detail: "Fewer results, stronger evidence per match.",
    bestFor: "Detailed review",
    values: {
      thresholds: { confident: 0.56, likely: 0.42, relaxedChild: 0.3, qualityMin: 0.24 },
      clusterMinSize: 3,
      faceDetectorSize: 640,
      twoPassScan: false,
      verificationDetectorSize: 640,
      learningMode: "manual",
      safeMode: true,
      safeModeMultimodal: false,
      safeModeThreshold: 0.58,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "discovery",
    label: "Find more",
    detail: "Broader possible-match discovery with more review items.",
    bestFor: "Early exploration",
    values: {
      thresholds: { confident: 0.34, likely: 0.24, relaxedChild: 0.16, qualityMin: 0.1 },
      clusterMinSize: 2,
      faceDetectorSize: 384,
      twoPassScan: true,
      verificationDetectorSize: 640,
      learningMode: "manual",
      safeMode: true,
      safeModeMultimodal: false,
      safeModeThreshold: 0.62,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  }
];

export function normalizeLearningMode(value: unknown): LearningMode {
  const mode = String(value || "").toLowerCase().replace(/-/g, "_");
  return mode === "off" || mode === "auto_stage" ? mode : "manual";
}

function sameSettingValue(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function parseListText(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

export function finiteNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function finiteInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(finiteNumber(value, fallback, min, max));
}

export function booleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function stringListSetting(value: unknown, fallback: string[]) {
  const raw = Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : "").join("\n")
    : typeof value === "string"
      ? value
      : fallback.join("\n");
  return parseListText(raw).slice(0, 1000);
}

export function listText(value: string[]) {
  return Array.isArray(value) ? value.join(", ") : "";
}

export function coerceSettingsProfile(incoming: unknown, current: SettingsDraft): SettingsDraft {
  const profile = asRecord(incoming);
  if (!profile) {
    throw new Error("Profile must contain a settings object.");
  }
  const thresholds = asRecord(profile.thresholds) ?? {};
  const reviewRules = asRecord(profile.reviewRules) ?? {};
  const scanExclusions = asRecord(profile.scanExclusions) ?? {};
  const videoDecoder = asRecord(profile.videoDecoder) ?? {};
  return {
    ...current,
    modelPack: safeText(profile.modelPack, current.modelPack),
    thresholds: {
      confident: finiteNumber(thresholds.confident, current.thresholds.confident, 0, 1),
      likely: finiteNumber(thresholds.likely, current.thresholds.likely, 0, 1),
      relaxedChild: finiteNumber(thresholds.relaxedChild, current.thresholds.relaxedChild, 0, 1),
      qualityMin: finiteNumber(thresholds.qualityMin, current.thresholds.qualityMin, 0, 1)
    },
    clusterMinSize: finiteInteger(profile.clusterMinSize, current.clusterMinSize, 1, 100),
    faceDetectorSize: finiteInteger(profile.faceDetectorSize, current.faceDetectorSize, 128, 2048),
    twoPassScan: booleanSetting(profile.twoPassScan, current.twoPassScan),
    verificationDetectorSize: finiteInteger(profile.verificationDetectorSize, current.verificationDetectorSize, 128, 2048),
    learningMode: normalizeLearningMode(profile.learningMode ?? current.learningMode),
    safeMode: booleanSetting(profile.safeMode, current.safeMode),
    safeModeThreshold: finiteNumber(profile.safeModeThreshold, current.safeModeThreshold, 0, 1),
    safeModeProfile: safeText(profile.safeModeProfile, current.safeModeProfile ?? "custom"),
    storageBudgetBytes: finiteInteger(profile.storageBudgetBytes, current.storageBudgetBytes, 0, 10 * 1024 * 1024 * 1024 * 1024),
    maxMediaFileBytes: finiteInteger(profile.maxMediaFileBytes, current.maxMediaFileBytes, 0, 1024 * 1024 * 1024 * 1024),
    videoDecoder: {
      ffmpegPath: safeText(videoDecoder.ffmpegPath, current.videoDecoder.ffmpegPath),
      ffprobePath: safeText(videoDecoder.ffprobePath, current.videoDecoder.ffprobePath)
    },
    reviewRules: {
      autoRejectBelow: finiteNumber(reviewRules.autoRejectBelow, current.reviewRules.autoRejectBelow, 0, 1),
      autoUncertainLowQuality: booleanSetting(reviewRules.autoUncertainLowQuality, current.reviewRules.autoUncertainLowQuality),
      autoRejectLowQualityVideo: booleanSetting(reviewRules.autoRejectLowQualityVideo, current.reviewRules.autoRejectLowQualityVideo)
    },
    scanExclusions: {
      dirNames: stringListSetting(scanExclusions.dirNames, current.scanExclusions.dirNames),
      pathKeywords: stringListSetting(scanExclusions.pathKeywords, current.scanExclusions.pathKeywords),
      extensions: stringListSetting(scanExclusions.extensions, current.scanExclusions.extensions),
      filePaths: stringListSetting(scanExclusions.filePaths, current.scanExclusions.filePaths)
    },
    mode: "custom"
  };
}

export function settingsValuesEqual(left: SettingsValues, right: SettingsValues) {
  return (
    sameSettingValue(left.thresholds.confident, right.thresholds.confident) &&
    sameSettingValue(left.thresholds.likely, right.thresholds.likely) &&
    sameSettingValue(left.thresholds.relaxedChild, right.thresholds.relaxedChild) &&
    sameSettingValue(left.thresholds.qualityMin, right.thresholds.qualityMin) &&
    left.clusterMinSize === right.clusterMinSize &&
    left.faceDetectorSize === right.faceDetectorSize &&
    left.twoPassScan === right.twoPassScan &&
    left.verificationDetectorSize === right.verificationDetectorSize &&
    left.learningMode === right.learningMode &&
    left.safeMode === right.safeMode &&
    (left.safeModeMultimodal ?? false) === (right.safeModeMultimodal ?? false) &&
    (left.safeModeZeroAdmittance ?? false) === (right.safeModeZeroAdmittance ?? false) &&
    sameSettingValue(left.safeModeThreshold, right.safeModeThreshold) &&
    (left.safeModeProfile ?? "custom") === (right.safeModeProfile ?? "custom") &&
    left.storageBudgetBytes === right.storageBudgetBytes &&
    left.maxMediaFileBytes === right.maxMediaFileBytes &&
    left.videoDecoder.ffmpegPath === right.videoDecoder.ffmpegPath &&
    left.videoDecoder.ffprobePath === right.videoDecoder.ffprobePath &&
    sameSettingValue(left.reviewRules.autoRejectBelow, right.reviewRules.autoRejectBelow) &&
    left.reviewRules.autoUncertainLowQuality === right.reviewRules.autoUncertainLowQuality &&
    left.reviewRules.autoRejectLowQualityVideo === right.reviewRules.autoRejectLowQualityVideo &&
    sameStringList(left.scanExclusions.dirNames, right.scanExclusions.dirNames) &&
    sameStringList(left.scanExclusions.pathKeywords, right.scanExclusions.pathKeywords) &&
    sameStringList(left.scanExclusions.extensions, right.scanExclusions.extensions) &&
    sameStringList(left.scanExclusions.filePaths, right.scanExclusions.filePaths)
  );
}

export function inferSettingsMode(values: SettingsValues): SettingsMode {
  return settingsPresets.find((preset) => settingsValuesEqual(values, preset.values))?.key ?? "custom";
}
