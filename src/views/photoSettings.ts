import type { PhotoLibrarySettingsValue, PhotoManagedRootProfile } from "../types";

export type PhotoVideoAutoplayMode = "off" | "muted" | "sound";
export type PhotoHdrViewingMode = "auto" | "standard" | "hdr";
export type PhotoIndexingPowerMode = "low" | "balanced" | "performance";

export const PHOTO_LOCAL_SETTINGS_KEY = "vintrace.photos.localSettings";

type PhotoManagedRootCoverage = NonNullable<PhotoLibrarySettingsValue["backupPolicyStatus"]>["rootCoverage"][number];
export type PhotoLibraryMediaSettingsOverride = Partial<Pick<PhotoLocalSettings, "videoAutoplay" | "pauseVideoWhenBackgrounded" | "hdrViewing">>;

export interface PhotoRailPreferences {
  showUtilityCollections: boolean;
  showSensitiveCollections: boolean;
  showScreenshotCollections: boolean;
  showSharedCollections: boolean;
  showLowValueCollections: boolean;
  pinnedIds: string[];
  collapsedSections: string[];
  sectionOrder: string[];
  itemOrder: Record<string, string[]>;
}

export interface PhotoManagedRootProfileBadge {
  key: string;
  label: string;
  tone?: "warn" | "ok";
  title?: string;
}

export interface PhotoManagedRootProfileRow {
  key: string;
  profile: PhotoManagedRootProfile;
  name: string;
  path: string;
  isDefault: boolean;
  builtIn: boolean;
  badges: PhotoManagedRootProfileBadge[];
  details: string[];
}

export type PhotoHdrEffectiveDisplayMode = "standard" | "hdr";
export type PhotoHdrDisplayBadgeTone = "ok" | "warn" | "muted";

export interface PhotoHdrDisplayState {
  requestedMode: PhotoHdrViewingMode;
  effectiveMode: PhotoHdrEffectiveDisplayMode;
  runtimeHdrAvailable: boolean;
  badgeLabel: string;
  badgeTone: PhotoHdrDisplayBadgeTone;
  detail: string;
}

export interface PhotoLocalSettings {
  referencedFileWarnings: boolean;
  stripLocationOnExport: boolean;
  lockSensitiveCollections: boolean;
  relockSensitiveCollectionsOnLeave: boolean;
  sensitiveSessionLockMinutes: number;
  sensitiveOsAuthEnabled: boolean;
  sensitivePasscodeEnabled: boolean;
  sensitivePasscodeSalt: string;
  sensitivePasscodeHash: string;
  recentActivityRetentionDays: number;
  videoAutoplay: PhotoVideoAutoplayMode;
  pauseVideoWhenBackgrounded: boolean;
  hdrViewing: PhotoHdrViewingMode;
  mediaSettingsByLibraryRoot: Record<string, PhotoLibraryMediaSettingsOverride>;
  localIntelligenceEnabled: boolean;
  noNetworkIntelligence: boolean;
  modelSourceDisclosure: boolean;
  petModelRecognitionEnabled: boolean;
  backgroundIndexingPaused: boolean;
  backgroundIndexingAutoRun: boolean;
  indexingPowerMode: PhotoIndexingPowerMode;
  railPreferences: PhotoRailPreferences;
}

const DEFAULT_PHOTO_RAIL_PREFERENCES: PhotoRailPreferences = {
  showUtilityCollections: true,
  showSensitiveCollections: true,
  showScreenshotCollections: true,
  showSharedCollections: true,
  showLowValueCollections: true,
  pinnedIds: [],
  collapsedSections: [],
  sectionOrder: [],
  itemOrder: {},
};

const DEFAULT_PHOTO_LOCAL_SETTINGS: PhotoLocalSettings = {
  referencedFileWarnings: true,
  stripLocationOnExport: false,
  lockSensitiveCollections: true,
  relockSensitiveCollectionsOnLeave: true,
  sensitiveSessionLockMinutes: 15,
  sensitiveOsAuthEnabled: false,
  sensitivePasscodeEnabled: false,
  sensitivePasscodeSalt: "",
  sensitivePasscodeHash: "",
  recentActivityRetentionDays: 30,
  videoAutoplay: "off",
  pauseVideoWhenBackgrounded: true,
  hdrViewing: "auto",
  mediaSettingsByLibraryRoot: {},
  localIntelligenceEnabled: false,
  noNetworkIntelligence: true,
  modelSourceDisclosure: true,
  petModelRecognitionEnabled: false,
  backgroundIndexingPaused: false,
  backgroundIndexingAutoRun: true,
  indexingPowerMode: "balanced",
  railPreferences: DEFAULT_PHOTO_RAIL_PREFERENCES,
};

type PhotoSettingsMetadataPath = string | readonly string[];

const PHOTO_HDR_METADATA_PATHS: readonly PhotoSettingsMetadataPath[] = [
  "colorProfile",
  "iccProfile",
  "profileDescription",
  "colorSpace",
  "dynamicRange",
  "hdrFormat",
  "transferFunction",
  "transferCharacteristic",
  "transferCharacteristics",
  "transfer",
  "videoRange",
  "pixelFormat",
  ["image", "colorProfile"],
  ["image", "iccProfile"],
  ["image", "profileDescription"],
  ["image", "colorSpace"],
  ["image", "dynamicRange"],
  ["video", "colorProfile"],
  ["video", "iccProfile"],
  ["video", "profileDescription"],
  ["video", "colorSpace"],
  ["video", "dynamicRange"],
  ["video", "hdrFormat"],
  ["video", "transferFunction"],
  ["video", "transferCharacteristic"],
  ["video", "transferCharacteristics"],
  ["probe", "colorProfile"],
  ["probe", "iccProfile"],
  ["probe", "profileDescription"],
  ["probe", "colorSpace"],
  ["probe", "dynamicRange"],
  ["probe", "hdrFormat"],
  ["probe", "transferFunction"],
  ["probe", "transferCharacteristic"],
  ["probe", "transferCharacteristics"],
  ["exif", "colorSpace"],
  ["xmp", "colorProfile"],
  ["xmp", "iccProfile"],
  ["xmp", "profileDescription"],
  ["xmp", "colorSpace"],
  ["xmp", "dynamicRange"],
];

const PHOTO_HDR_METADATA_TERMS = [
  "hdr",
  "hdr10",
  "hdr10+",
  "dolby vision",
  "hlg",
  "hybrid log",
  "pq",
  "perceptual quant",
  "smpte st 2084",
  "st 2084",
  "arib std-b67",
  "rec.2020",
  "rec 2020",
  "rec2020",
  "bt.2020",
  "bt 2020",
  "bt2020",
  "display p3 hdr",
];

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeVideoAutoplayMode(value: unknown): PhotoVideoAutoplayMode {
  return value === "muted" || value === "sound" || value === "off" ? value : DEFAULT_PHOTO_LOCAL_SETTINGS.videoAutoplay;
}

function normalizeHdrViewingMode(value: unknown): PhotoHdrViewingMode {
  return value === "standard" || value === "hdr" || value === "auto" ? value : DEFAULT_PHOTO_LOCAL_SETTINGS.hdrViewing;
}

function normalizeIndexingPowerMode(value: unknown): PhotoIndexingPowerMode {
  return value === "low" || value === "performance" || value === "balanced" ? value : DEFAULT_PHOTO_LOCAL_SETTINGS.indexingPowerMode;
}

function normalizeSensitiveSessionLockMinutes(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PHOTO_LOCAL_SETTINGS.sensitiveSessionLockMinutes;
  const minutes = Math.round(numeric);
  if (minutes <= 0) return 0;
  return Math.max(1, Math.min(240, minutes));
}

function normalizeRecentActivityRetentionDays(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_PHOTO_LOCAL_SETTINGS.recentActivityRetentionDays;
  const days = Math.round(numeric);
  if (days <= 0) return 0;
  return Math.max(1, Math.min(3650, days));
}

function cleanSettingsString(value: unknown): string {
  return String(value || "").trim();
}

function settingsMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function settingsMetadataPathValue(metadata: Record<string, unknown>, path: PhotoSettingsMetadataPath): unknown {
  if (typeof path === "string") return metadata[path];
  return path.reduce<unknown>((value, key) => settingsMetadataRecord(value)[key], metadata);
}

function settingsMetadataTextValues(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = cleanSettingsString(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => settingsMetadataTextValues(item, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => settingsMetadataTextValues(item, depth + 1));
  }
  return [];
}

function cleanLibraryRootKey(value: unknown): string {
  return cleanSettingsString(value).slice(0, 1024);
}

function fallbackFileName(sourcePath: string): string {
  return cleanSettingsString(sourcePath).split(/[\\/]/).filter(Boolean).pop() || cleanSettingsString(sourcePath);
}

function rootConflictBadgeLabel(kind: unknown): string {
  const text = cleanSettingsString(kind).toLowerCase();
  if (text === "duplicate") return "Duplicate root";
  if (text === "symlink" || text === "symlink_alias") return "Symlink root";
  if (text === "nested" || text === "overlap") return "Overlapping root";
  return "Root conflict";
}

function photoCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "photo" : "photos"}`;
}

function cleanPasscodeToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : "";
}

function cleanSettingsStringList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    const text = cleanSettingsString(item).slice(0, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    next.push(text);
    if (next.length >= limit) break;
  }
  return next;
}

function defaultPhotoRailPreferences(): PhotoRailPreferences {
  return {
    ...DEFAULT_PHOTO_RAIL_PREFERENCES,
    pinnedIds: [],
    collapsedSections: [],
    sectionOrder: [],
    itemOrder: {},
  };
}

export function defaultPhotoLocalSettings(): PhotoLocalSettings {
  return {
    ...DEFAULT_PHOTO_LOCAL_SETTINGS,
    mediaSettingsByLibraryRoot: {},
    railPreferences: defaultPhotoRailPreferences(),
  };
}

export function normalizePhotoLibraryMediaSettingsOverride(value: unknown): PhotoLibraryMediaSettingsOverride {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const override: PhotoLibraryMediaSettingsOverride = {};
  if (record.videoAutoplay === "muted" || record.videoAutoplay === "sound" || record.videoAutoplay === "off") {
    override.videoAutoplay = record.videoAutoplay;
  }
  if (typeof record.pauseVideoWhenBackgrounded === "boolean") {
    override.pauseVideoWhenBackgrounded = record.pauseVideoWhenBackgrounded;
  }
  if (record.hdrViewing === "standard" || record.hdrViewing === "hdr" || record.hdrViewing === "auto") {
    override.hdrViewing = record.hdrViewing;
  }
  return override;
}

export function normalizePhotoLibraryMediaSettingsByRoot(value: unknown): Record<string, PhotoLibraryMediaSettingsOverride> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, PhotoLibraryMediaSettingsOverride> = {};
  for (const [rawRoot, rawOverride] of Object.entries(value as Record<string, unknown>)) {
    const root = cleanLibraryRootKey(rawRoot);
    if (!root || next[root] || Object.keys(next).length >= 32) continue;
    const override = normalizePhotoLibraryMediaSettingsOverride(rawOverride);
    if (Object.keys(override).length > 0) next[root] = override;
  }
  return next;
}

export function normalizePhotoRailPreferences(value: unknown): PhotoRailPreferences {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const itemOrder: Record<string, string[]> = {};
  const rawItemOrder = record.itemOrder;
  if (rawItemOrder && typeof rawItemOrder === "object" && !Array.isArray(rawItemOrder)) {
    for (const [rawSectionId, rawOrder] of Object.entries(rawItemOrder as Record<string, unknown>)) {
      const sectionId = cleanSettingsString(rawSectionId).slice(0, 128);
      if (!sectionId || itemOrder[sectionId] || Object.keys(itemOrder).length >= 32) continue;
      const order = cleanSettingsStringList(rawOrder, 256, 512);
      if (order.length > 0) itemOrder[sectionId] = order;
    }
  }
  return {
    showUtilityCollections: asBoolean(record.showUtilityCollections, DEFAULT_PHOTO_RAIL_PREFERENCES.showUtilityCollections),
    showSensitiveCollections: asBoolean(record.showSensitiveCollections, DEFAULT_PHOTO_RAIL_PREFERENCES.showSensitiveCollections),
    showScreenshotCollections: asBoolean(record.showScreenshotCollections, DEFAULT_PHOTO_RAIL_PREFERENCES.showScreenshotCollections),
    showSharedCollections: asBoolean(record.showSharedCollections, DEFAULT_PHOTO_RAIL_PREFERENCES.showSharedCollections),
    showLowValueCollections: asBoolean(record.showLowValueCollections, DEFAULT_PHOTO_RAIL_PREFERENCES.showLowValueCollections),
    pinnedIds: cleanSettingsStringList(record.pinnedIds, 256, 512),
    collapsedSections: cleanSettingsStringList(record.collapsedSections, 64, 128),
    sectionOrder: cleanSettingsStringList(record.sectionOrder, 64, 128),
    itemOrder,
  };
}

export function normalizePhotoLocalSettings(value: unknown): PhotoLocalSettings {
  if (!value || typeof value !== "object") return defaultPhotoLocalSettings();
  const record = value as Record<string, unknown>;
  return {
    referencedFileWarnings: asBoolean(record.referencedFileWarnings, DEFAULT_PHOTO_LOCAL_SETTINGS.referencedFileWarnings),
    stripLocationOnExport: asBoolean(record.stripLocationOnExport, DEFAULT_PHOTO_LOCAL_SETTINGS.stripLocationOnExport),
    lockSensitiveCollections: asBoolean(record.lockSensitiveCollections, DEFAULT_PHOTO_LOCAL_SETTINGS.lockSensitiveCollections),
    relockSensitiveCollectionsOnLeave: asBoolean(record.relockSensitiveCollectionsOnLeave, DEFAULT_PHOTO_LOCAL_SETTINGS.relockSensitiveCollectionsOnLeave),
    sensitiveSessionLockMinutes: normalizeSensitiveSessionLockMinutes(record.sensitiveSessionLockMinutes),
    sensitiveOsAuthEnabled: asBoolean(record.sensitiveOsAuthEnabled, DEFAULT_PHOTO_LOCAL_SETTINGS.sensitiveOsAuthEnabled),
    sensitivePasscodeEnabled: asBoolean(record.sensitivePasscodeEnabled, DEFAULT_PHOTO_LOCAL_SETTINGS.sensitivePasscodeEnabled)
      && Boolean(cleanPasscodeToken(record.sensitivePasscodeSalt) && cleanPasscodeToken(record.sensitivePasscodeHash)),
    sensitivePasscodeSalt: cleanPasscodeToken(record.sensitivePasscodeSalt),
    sensitivePasscodeHash: cleanPasscodeToken(record.sensitivePasscodeHash),
    recentActivityRetentionDays: normalizeRecentActivityRetentionDays(record.recentActivityRetentionDays),
    videoAutoplay: normalizeVideoAutoplayMode(record.videoAutoplay),
    pauseVideoWhenBackgrounded: asBoolean(record.pauseVideoWhenBackgrounded, DEFAULT_PHOTO_LOCAL_SETTINGS.pauseVideoWhenBackgrounded),
    hdrViewing: normalizeHdrViewingMode(record.hdrViewing),
    mediaSettingsByLibraryRoot: normalizePhotoLibraryMediaSettingsByRoot(record.mediaSettingsByLibraryRoot),
    localIntelligenceEnabled: asBoolean(record.localIntelligenceEnabled, DEFAULT_PHOTO_LOCAL_SETTINGS.localIntelligenceEnabled),
    noNetworkIntelligence: asBoolean(record.noNetworkIntelligence, DEFAULT_PHOTO_LOCAL_SETTINGS.noNetworkIntelligence),
    modelSourceDisclosure: asBoolean(record.modelSourceDisclosure, DEFAULT_PHOTO_LOCAL_SETTINGS.modelSourceDisclosure),
    petModelRecognitionEnabled: asBoolean(record.petModelRecognitionEnabled, DEFAULT_PHOTO_LOCAL_SETTINGS.petModelRecognitionEnabled),
    backgroundIndexingPaused: asBoolean(record.backgroundIndexingPaused, DEFAULT_PHOTO_LOCAL_SETTINGS.backgroundIndexingPaused),
    backgroundIndexingAutoRun: asBoolean(record.backgroundIndexingAutoRun, DEFAULT_PHOTO_LOCAL_SETTINGS.backgroundIndexingAutoRun),
    indexingPowerMode: normalizeIndexingPowerMode(record.indexingPowerMode),
    railPreferences: normalizePhotoRailPreferences(record.railPreferences),
  };
}

export function photoLibraryMediaSettingsOverride(settings: PhotoLocalSettings, libraryRoot: unknown): PhotoLibraryMediaSettingsOverride {
  const root = cleanLibraryRootKey(libraryRoot);
  if (!root) return {};
  return normalizePhotoLibraryMediaSettingsOverride((settings.mediaSettingsByLibraryRoot || {})[root]);
}

export function photoLibraryHasMediaSettingsOverride(settings: PhotoLocalSettings, libraryRoot: unknown): boolean {
  return Object.keys(photoLibraryMediaSettingsOverride(settings, libraryRoot)).length > 0;
}

export function photoEffectiveMediaSettings(settings: PhotoLocalSettings, libraryRoot: unknown): PhotoLocalSettings {
  const override = photoLibraryMediaSettingsOverride(settings, libraryRoot);
  return normalizePhotoLocalSettings({
    ...settings,
    videoAutoplay: override.videoAutoplay ?? settings.videoAutoplay,
    pauseVideoWhenBackgrounded: override.pauseVideoWhenBackgrounded ?? settings.pauseVideoWhenBackgrounded,
    hdrViewing: override.hdrViewing ?? settings.hdrViewing,
    mediaSettingsByLibraryRoot: settings.mediaSettingsByLibraryRoot,
  });
}

export function photoMediaSettingsOverridePatch(
  settings: PhotoLocalSettings,
  libraryRoot: unknown,
  patch: PhotoLibraryMediaSettingsOverride | null,
): Pick<PhotoLocalSettings, "mediaSettingsByLibraryRoot"> {
  const root = cleanLibraryRootKey(libraryRoot);
  const current = normalizePhotoLibraryMediaSettingsByRoot(settings.mediaSettingsByLibraryRoot);
  if (!root) return { mediaSettingsByLibraryRoot: current };
  const next = { ...current };
  if (!patch) {
    delete next[root];
    return { mediaSettingsByLibraryRoot: next };
  }
  if (!next[root] && Object.keys(next).length >= 32) return { mediaSettingsByLibraryRoot: next };
  const override = normalizePhotoLibraryMediaSettingsOverride({
    ...next[root],
    ...patch,
  });
  if (Object.keys(override).length > 0) {
    next[root] = override;
  } else {
    delete next[root];
  }
  return { mediaSettingsByLibraryRoot: next };
}

export function shouldAutoplayPhotoVideo(settings: PhotoLocalSettings): boolean {
  return settings.videoAutoplay === "muted" || settings.videoAutoplay === "sound";
}

export function shouldMuteAutoplayPhotoVideo(settings: PhotoLocalSettings): boolean {
  return settings.videoAutoplay === "muted";
}

export function photoMetadataSuggestsHdr(assetMetadata: unknown): boolean {
  const metadata = settingsMetadataRecord(assetMetadata);
  const text = PHOTO_HDR_METADATA_PATHS
    .flatMap((path) => settingsMetadataTextValues(settingsMetadataPathValue(metadata, path)))
    .join(" ")
    .toLocaleLowerCase();
  if (!text) return false;
  return PHOTO_HDR_METADATA_TERMS.some((term) => text.includes(term));
}

export function photoHdrDisplayState(
  settings: Pick<PhotoLocalSettings, "hdrViewing"> | null | undefined,
  assetMetadata: unknown,
  runtimeHdrAvailable: boolean,
): PhotoHdrDisplayState | null {
  if (!photoMetadataSuggestsHdr(assetMetadata)) return null;
  const requestedMode = normalizeHdrViewingMode(settings?.hdrViewing);
  const runtimeAvailable = runtimeHdrAvailable === true;
  if (requestedMode === "standard") {
    return {
      requestedMode,
      effectiveMode: "standard",
      runtimeHdrAvailable: runtimeAvailable,
      badgeLabel: "SDR",
      badgeTone: "muted",
      detail: "HDR metadata detected; HDR viewing is set to Standard, so the standard-range preview is shown.",
    };
  }
  if (runtimeAvailable) {
    return {
      requestedMode,
      effectiveMode: "hdr",
      runtimeHdrAvailable: true,
      badgeLabel: "HDR",
      badgeTone: "ok",
      detail: requestedMode === "auto"
        ? "HDR metadata detected and this runtime advertises HDR display support."
        : "HDR was requested and this runtime advertises HDR display support.",
    };
  }
  if (requestedMode === "hdr") {
    return {
      requestedMode,
      effectiveMode: "standard",
      runtimeHdrAvailable: false,
      badgeLabel: "HDR unavailable",
      badgeTone: "warn",
      detail: "HDR was requested, but this runtime/display does not advertise HDR support. Showing the standard-range preview.",
    };
  }
  return {
    requestedMode,
    effectiveMode: "standard",
    runtimeHdrAvailable: false,
    badgeLabel: "HDR source",
    badgeTone: "muted",
    detail: "HDR metadata detected; this runtime/display does not advertise HDR support, so the standard-range preview is shown.",
  };
}

export function buildPhotoManagedRootProfileRows(settings: PhotoLibrarySettingsValue | null | undefined): PhotoManagedRootProfileRow[] {
  const coverageByPath = new Map<string, PhotoManagedRootCoverage>(
    (settings?.backupPolicyStatus?.rootCoverage || [])
      .map((coverage) => [cleanSettingsString(coverage.path), coverage])
      .filter(([path]) => Boolean(path)) as Array<[string, PhotoManagedRootCoverage]>,
  );
  return [...(settings?.managedRoots || [])]
    .filter((profile) => cleanSettingsString(profile.path))
    .sort((left, right) => {
      const defaultOrder = Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault));
      if (defaultOrder) return defaultOrder;
      const builtInOrder = Number(Boolean(left.builtIn)) - Number(Boolean(right.builtIn));
      if (builtInOrder) return builtInOrder;
      return cleanSettingsString(left.name || left.path).localeCompare(cleanSettingsString(right.name || right.path));
    })
    .map((profile) => {
      const path = cleanSettingsString(profile.path);
      const name = cleanSettingsString(profile.name) || fallbackFileName(path) || "Managed library";
      const coverage = coverageByPath.get(path);
      const policy = profile.policy || coverage?.policy || null;
      const assetCount = Number(coverage?.assetCount || 0) || 0;
      const issue = cleanSettingsString(coverage?.issue);
      const policyWarnings = [
        ...(coverage?.policyWarnings || []),
        ...(profile.policyWarnings || []),
      ].filter((warning, index, warnings) => (
        cleanSettingsString(warning?.message)
        && warnings.findIndex((candidate) => cleanSettingsString(candidate?.message) === cleanSettingsString(warning?.message)) === index
      ));
      const rootConflictMessage = cleanSettingsString(
        coverage?.rootConflictMessage
          || profile.rootConflictMessage
          || policyWarnings[0]?.message,
      );
      const rootConflictKind = cleanSettingsString(
        coverage?.rootConflictKind
          || profile.rootConflictKind
          || policyWarnings[0]?.kind,
      );
      const badges: PhotoManagedRootProfileBadge[] = [];
      const details: string[] = [];
      if (profile.isDefault) badges.push({ key: "default", label: "Default" });
      if (profile.builtIn || coverage?.builtIn) badges.push({ key: "workspace", label: "Workspace" });
      if (coverage) badges.push({ key: "assets", label: photoCountLabel(assetCount) });
      if (policy?.keepFolderOrganizationDefault) badges.push({ key: "keep-folders", label: "Keeps folders" });
      if (rootConflictMessage) badges.push({ key: "root-conflict", label: rootConflictBadgeLabel(rootConflictKind), tone: "warn", title: rootConflictMessage });
      if (issue) badges.push({ key: "issue", label: "Needs repair", tone: "warn", title: issue });
      if (coverage?.requiresExternalBackup) badges.push({ key: "external-backup", label: "External backup needed", tone: "warn" });
      if (coverage?.externalBackupCovered || policy?.externalBackupCovered) badges.push({ key: "external-backup-covered", label: "External backup covered", tone: "ok" });
      if (rootConflictMessage) {
        details.push(rootConflictMessage);
      }
      policyWarnings.forEach((warning) => {
        const message = cleanSettingsString(warning?.message);
        const action = cleanSettingsString(warning?.action);
        const detail = action ? `${message} ${action}` : message;
        if (detail && !details.includes(detail)) details.push(detail);
      });
      if (coverage?.insideWorkspace) {
        details.push("Inside the active workspace backup.");
      } else if (coverage?.externalBackupCovered || policy?.externalBackupCovered) {
        const label = cleanSettingsString(coverage?.externalBackupLabel || policy?.externalBackupLabel);
        details.push(label ? `External backup covered by ${label}.` : "External backup coverage recorded.");
      } else if (coverage) {
        details.push("Outside the active workspace; include it in an external backup.");
      } else if (profile.builtIn) {
        details.push("Workspace default managed folder.");
      }
      if (issue) {
        details.push(issue);
      } else if (coverage?.exists === false && coverage?.creatable) {
        details.push("Folder can be created when first used.");
      } else if (coverage?.writable) {
        details.push("Writable managed destination.");
      }
      if (profile.updatedAt) details.push(`Updated ${profile.updatedAt}`);
      return {
        key: profile.profileId || path,
        profile,
        name,
        path,
        isDefault: Boolean(profile.isDefault),
        builtIn: Boolean(profile.builtIn),
        badges,
        details: details.slice(0, 4),
      };
    });
}

export function photoSensitivePasscodeConfigured(settings: PhotoLocalSettings): boolean {
  return Boolean(settings.sensitivePasscodeEnabled && settings.sensitivePasscodeSalt && settings.sensitivePasscodeHash);
}

function base64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (index + 1 < bytes.length) {
      encoded += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    }
    if (index + 2 < bytes.length) {
      encoded += alphabet[third & 63];
    }
  }
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return base64Url(bytes);
}

async function digestPasscode(passcode: string, salt: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Crypto support is required for sensitive collection passcodes.");
  }
  const data = new TextEncoder().encode(`${salt}:${passcode}`);
  const digest = await cryptoApi.subtle.digest("SHA-256", data);
  return base64Url(new Uint8Array(digest));
}

export async function createPhotoSensitivePasscodeRecord(passcode: string, salt = randomSalt()): Promise<Pick<PhotoLocalSettings, "sensitivePasscodeEnabled" | "sensitivePasscodeSalt" | "sensitivePasscodeHash">> {
  const clean = String(passcode || "");
  if (clean.length < 4) {
    throw new Error("Sensitive collection passcodes must be at least 4 characters.");
  }
  const cleanSalt = cleanPasscodeToken(salt) || randomSalt();
  return {
    sensitivePasscodeEnabled: true,
    sensitivePasscodeSalt: cleanSalt,
    sensitivePasscodeHash: await digestPasscode(clean, cleanSalt),
  };
}

export async function verifyPhotoSensitivePasscode(settings: PhotoLocalSettings, passcode: string): Promise<boolean> {
  if (!photoSensitivePasscodeConfigured(settings)) return true;
  if (!passcode) return false;
  const digest = await digestPasscode(passcode, settings.sensitivePasscodeSalt);
  return digest === settings.sensitivePasscodeHash;
}
