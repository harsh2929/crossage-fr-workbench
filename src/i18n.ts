export type LanguageCode = "en" | "zh" | "es" | "fr" | "ar" | "hi" | "ja";

export const languageOptions: Array<{ code: LanguageCode; label: string; nativeLabel: string }> = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" }
];

export type TranslationKey =
  | "app.subtitle"
  | "nav.dashboard"
  | "nav.enroll"
  | "nav.scan"
  | "nav.review"
  | "nav.photos"
  | "nav.settings"
  | "nav.library"
  | "nav.memories"
  | "nav.albums"
  | "nav.search"
  | "nav.peoplePets"
  | "nav.tools"
  | "nav.toolsOverview"
  | "nav.toolsModels"
  | "nav.toolsDiagnostics"
  | "topbar.guide"
  | "topbar.choose"
  | "topbar.show"
  | "topbar.refresh"
  | "topbar.lock"
  | "topbar.unlock"
  | "topbar.permission"
  | "topbar.appFolder"
  | "topbar.folderReadiness"
  | "shell.local"
  | "shell.demo"
  | "shell.model"
  | "shell.safeMode"
  | "shell.on"
  | "shell.off"
  | "shell.toReview"
  | "status.ready"
  | "status.simpleMatching"
  | "language.label"
  | "language.title"
  | "boot.restart"
  | "boot.exportDiagnostics"
  | "boot.couldNotLoad"
  | "boot.interfaceFailed"
  | "boot.rootMissing"
  | "boot.bridgeUnavailable"
  | "boot.bridgeMessage"
  | "onboarding.eyebrow"
  | "onboarding.title"
  | "onboarding.body"
  | "onboarding.progress"
  | "onboarding.ready"
  | "onboarding.complete"
  | "onboarding.workspace.title"
  | "onboarding.workspace.detail"
  | "onboarding.workspace.action"
  | "onboarding.permission.title"
  | "onboarding.permission.detail"
  | "onboarding.permission.action"
  | "onboarding.permission.done"
  | "onboarding.person.title"
  | "onboarding.person.detail"
  | "onboarding.person.action"
  | "onboarding.scan.title"
  | "onboarding.scan.detail"
  | "onboarding.scan.action"
  | "onboarding.review.title"
  | "onboarding.review.detail"
  | "onboarding.review.action"
  | "onboarding.safe.title"
  | "onboarding.safe.detail"
  | "onboarding.safe.action"
  | "onboarding.guard.permission"
  | "onboarding.guard.safe"
  | "onboarding.guard.local"
  | "onboarding.later"
  | "onboarding.done"
  | "onboarding.continue"
  | "consent.title"
  | "consent.scope"
  | "consent.body"
  | "consent.note"
  | "consent.notePlaceholder"
  | "consent.cancel"
  | "consent.confirm"
  | "addPerson.title"
  | "addPerson.body"
  | "addPerson.who"
  | "addPerson.personName"
  | "addPerson.namePlaceholder"
  | "addPerson.age"
  | "addPerson.ageRange"
  | "addPerson.photosStep"
  | "addPerson.dropzone"
  | "addPerson.or"
  | "addPerson.choosePhotos"
  | "addPerson.choosePersonPhotos"
  | "addPerson.chooseFolder"
  | "addPerson.choosePersonPhotoFolder"
  | "addPerson.review"
  | "addPerson.emptyPreview"
  | "addPerson.addPhotos"
  | "addPerson.clear"
  | "addPerson.clearStaged"
  | "addPerson.removePhoto"
  | "addPerson.removeFolder";

export type UiMessageKey =
  | "notice.savedFacePhotosAdded"
  | "notice.savedFacePhotosAddedAcrossAges"
  | "notice.scanCancelled"
  | "notice.possibleMatchesFound"
  | "notice.resumeComplete"
  | "notice.cameraSavedNext"
  | "notice.cameraSavedMatches"
  | "notice.folderCheckSummary"
  | "notice.updatedPossibleMatches"
  | "notice.exportedSelectedMatches"
  | "notice.clearedSavedPhotos"
  | "notice.deletedPersonData"
  | "notice.removedReviewedMatches"
  | "notice.supportBundleExported"
  | "notice.faceModelReady"
  | "notice.workspaceRepaired"
  | "notice.pathsRelinked"
  | "notice.duplicateRowsRemoved"
  | "notice.workspaceOptimized"
  | "notice.oldReviewedRemoved"
  | "notice.reportExported"
  | "notice.backupCreated"
  | "notice.oldBackupsRemoved"
  | "notice.scanRunsExported"
  | "notice.oldScanRunsRemoved"
  | "notice.inventoryExported"
  | "notice.activityEventsExported"
  | "notice.consentReceiptExported"
  | "notice.retentionReportLoaded"
  | "notice.retentionReportEmpty"
  | "notice.safeModeAuditExported"
  | "notice.reviewLedgerExported"
  | "notice.activityEventsLoaded"
  | "notice.modelDriftStale"
  | "notice.modelDriftReady"
  | "notice.accuracyLabelsExported"
  | "notice.mediaFilesExported"
  | "notice.personRenamed"
  | "notice.issueFilesIgnored"
  | "notice.retryFilesComplete"
  | "notice.scanQueueFinished"
  | "notice.failedFoldersReady"
  | "addPerson.stagedReadyOne"
  | "addPerson.stagedReadyMany"
  | "addPerson.addCountOne"
  | "addPerson.addCountMany"
  | "addPerson.addCountNamedOne"
  | "addPerson.addCountNamedMany"
  | "dialog.deleteSavedPhoto"
  | "dialog.clearMatches"
  | "dialog.clearSavedPhotos"
  | "dialog.deletePerson"
  | "dialog.purgeReviewed"
  | "dialog.repairMissingLinks"
  | "dialog.forceRepairMissingDrive"
  | "dialog.relinkSavedPaths"
  | "dialog.removeDuplicateRows"
  | "dialog.optimizeWorkspace"
  | "dialog.renamePerson";

type TranslationTable = Record<TranslationKey, string>;
type UiMessageTable = Record<UiMessageKey, string>;

const en: TranslationTable = {
  "app.subtitle": "Photo Review",
  "nav.dashboard": "Dashboard",
  "nav.enroll": "People",
  "nav.scan": "Scan",
  "nav.review": "Review",
  "nav.photos": "Photos",
  "nav.settings": "Settings",
  "nav.library": "Library",
  "nav.memories": "Memories",
  "nav.albums": "Albums",
  "nav.search": "Search",
  "nav.peoplePets": "People & Pets",
  "nav.tools": "Tools",
  "nav.toolsOverview": "Overview",
  "nav.toolsModels": "Models",
  "nav.toolsDiagnostics": "Diagnostics",
  "topbar.guide": "Guide",
  "topbar.choose": "Choose",
  "topbar.show": "Show",
  "topbar.refresh": "Refresh",
  "topbar.lock": "Lock",
  "topbar.unlock": "Unlock",
  "topbar.permission": "Permission",
  "topbar.appFolder": "App folder",
  "topbar.folderReadiness": "App folder readiness",
  "shell.local": "Local",
  "shell.demo": "Demo",
  "shell.model": "Model",
  "shell.safeMode": "Safe Mode",
  "shell.on": "On",
  "shell.off": "Off",
  "shell.toReview": "To review",
  "status.ready": "Ready",
  "status.simpleMatching": "Simple image matching active",
  "language.label": "Language",
  "language.title": "Choose interface language",
  "boot.restart": "Quit and reopen the desktop app. If this repeats, export diagnostics from the app bundle logs.",
  "boot.exportDiagnostics": "Export diagnostics",
  "boot.couldNotLoad": "Vintrace could not load",
  "boot.interfaceFailed": "The interface failed to start.",
  "boot.rootMissing": "The app root was not found.",
  "boot.bridgeUnavailable": "Vintrace desktop bridge is unavailable",
  "boot.bridgeMessage": "The secure desktop bridge did not load, so the app cannot talk to the local photo pipeline.",
  "onboarding.eyebrow": "First use",
  "onboarding.title": "Set up your first scan",
  "onboarding.body": "Add a person, choose a folder of photos or videos, and review possible matches. Everything stays local, and Safe Mode stays on.",
  "onboarding.progress": "Onboarding {progress}% complete",
  "onboarding.ready": "{completed}/6 ready",
  "onboarding.complete": "{progress}% complete",
  "onboarding.workspace.title": "Choose an app folder",
  "onboarding.workspace.detail": "This is where Vintrace keeps saved people, possible matches, notes, and exports.",
  "onboarding.workspace.action": "Choose folder",
  "onboarding.permission.title": "Confirm permission",
  "onboarding.permission.detail": "Only scan people and photos you have permission to process.",
  "onboarding.permission.action": "Confirm",
  "onboarding.permission.done": "Permission set",
  "onboarding.person.title": "Add the person to find",
  "onboarding.person.detail": "Pick clear photos of the person. Add child, teen, and adult photos when you have them.",
  "onboarding.person.action": "Add person",
  "onboarding.scan.title": "Scan a photo folder",
  "onboarding.scan.detail": "Check the folder first, then search photos and videos for possible matches.",
  "onboarding.scan.action": "Start scan",
  "onboarding.review.title": "Review possible matches",
  "onboarding.review.detail": "Vintrace suggests matches. You make the final decision.",
  "onboarding.review.action": "Review",
  "onboarding.safe.title": "Keep private photos protected",
  "onboarding.safe.detail": "Safe Mode keeps likely intimate photos out of matching, previews, groups, and exports.",
  "onboarding.safe.action": "See settings",
  "onboarding.guard.permission": "Permission required",
  "onboarding.guard.safe": "Safe Mode on",
  "onboarding.guard.local": "Saved locally",
  "onboarding.later": "Remind me later",
  "onboarding.done": "Done",
  "onboarding.continue": "Continue",
  "consent.title": "Confirm permission",
  "consent.scope": "Applies to this app folder",
  "consent.body": "Confirm that you have permission to scan these people and photos in this local app folder. Vintrace only suggests possible matches; you make the final decision.",
  "consent.note": "Optional note",
  "consent.notePlaceholder": "Add a case, folder, or operator note",
  "consent.cancel": "Cancel",
  "consent.confirm": "Confirm permission",
  "addPerson.title": "Add a person",
  "addPerson.body": "Name them, add a few clear photos, and they'll appear in your people list.",
  "addPerson.who": "Who is this?",
  "addPerson.personName": "Person name",
  "addPerson.namePlaceholder": "Name shown in results",
  "addPerson.age": "Age",
  "addPerson.ageRange": "Age range in these photos",
  "addPerson.photosStep": "Add their photos",
  "addPerson.dropzone": "Drag photos or a folder here",
  "addPerson.or": "or",
  "addPerson.choosePhotos": "Choose photos",
  "addPerson.choosePersonPhotos": "Choose person photos",
  "addPerson.chooseFolder": "Choose folder",
  "addPerson.choosePersonPhotoFolder": "Choose person photo folder",
  "addPerson.review": "Review & add",
  "addPerson.emptyPreview": "Photos you add will preview here before they're saved.",
  "addPerson.addPhotos": "Add photos",
  "addPerson.clear": "Clear",
  "addPerson.clearStaged": "Clear staged photos",
  "addPerson.removePhoto": "Remove photo",
  "addPerson.removeFolder": "Remove folder"
};

export type LocaleBundle = {
  translations?: Partial<TranslationTable>;
  uiMessages?: Partial<UiMessageTable>;
  errorMessages?: Record<string, string>;
  literals?: Record<string, string>;
  safeModeReviewLiterals?: Record<string, string>;
  uiPhrases?: Record<string, string>;
  newFeaturePhrases?: Record<string, string>;
  photoUiFallbackTerms?: Record<string, string>;
  photoUiAdditionalFallbackTerms?: Record<string, string>;
};

type LazyLanguageCode = Exclude<LanguageCode, "en">;

const loadedLocaleBundles: Partial<Record<LazyLanguageCode, LocaleBundle>> = {};
const localeLoadPromises: Partial<Record<LazyLanguageCode, Promise<void>>> = {};
const localeLoaders: Record<LazyLanguageCode, () => Promise<{ default: LocaleBundle }>> = {
  zh: () => import("./i18n/locales/zh"),
  es: () => import("./i18n/locales/es"),
  fr: () => import("./i18n/locales/fr"),
  ar: () => import("./i18n/locales/ar"),
  hi: () => import("./i18n/locales/hi"),
  ja: () => import("./i18n/locales/ja")
};

function isLazyLanguage(language: LanguageCode): language is LazyLanguageCode {
  return language !== "en";
}

function localeBundle(language: LanguageCode): LocaleBundle {
  return isLazyLanguage(language) ? loadedLocaleBundles[language] ?? {} : {};
}

function clearLanguageCaches(language: LanguageCode) {
  structuredLiteralTranslationCache.delete(language);
  photoUiFallbackCache.delete(language);
  phraseTranslationCache.delete(language);
}

export function isLanguageLoaded(language: LanguageCode): boolean {
  return !isLazyLanguage(language) || Boolean(loadedLocaleBundles[language]);
}

export async function preloadLanguage(language: LanguageCode): Promise<void> {
  const normalized = normalizeLanguage(language);
  if (!isLazyLanguage(normalized) || loadedLocaleBundles[normalized]) return;
  const existing = localeLoadPromises[normalized];
  if (existing) return existing;
  const promise = localeLoaders[normalized]()
    .then((module) => {
      loadedLocaleBundles[normalized] = module.default;
      clearLanguageCaches(normalized);
    })
    .catch((error) => {
      delete localeLoadPromises[normalized];
      if (import.meta.env?.DEV) console.warn("[i18n] failed to load locale " + normalized, error);
    });
  localeLoadPromises[normalized] = promise;
  return promise;
}

export function normalizeLanguage(value: string | null | undefined): LanguageCode {
  const lowered = String(value || "").toLowerCase();
  if (lowered.startsWith("hi")) return "hi";
  if (lowered.startsWith("es")) return "es";
  if (lowered.startsWith("zh")) return "zh";
  if (lowered.startsWith("fr")) return "fr";
  if (lowered.startsWith("ar")) return "ar";
  if (lowered.startsWith("ja")) return "ja";
  return "en";
}

export function translate(language: LanguageCode, key: TranslationKey, values: Record<string, string | number> = {}): string {
  const resolved = language === "en" ? en[key] : localeBundle(language).translations?.[key] ?? en[key];
  if (resolved === undefined && import.meta.env?.DEV) {
    // Surface missing/typo'd keys during development instead of silently
    // rendering the raw key string (and its uninterpolated placeholders).
    console.warn(`[i18n] missing translation key: ${key}`);
  }
  const template = resolved ?? key;
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

const uiMessageEn: UiMessageTable = {
  "notice.savedFacePhotosAdded": "Saved face photos added: {count}.{skipped}",
  "notice.savedFacePhotosAddedAcrossAges": "Saved face photos added: {count}. Age folders: {groups}.{skipped}",
  "notice.scanCancelled": "Scan cancelled after {processed} files. Resume will skip completed files.",
  "notice.possibleMatchesFound": "Possible matches found: {count}.{skipped}{protected}",
  "notice.resumeComplete": "Resume complete. Possible matches found: {count}.{skipped}",
  "notice.cameraSavedNext": "Camera photo saved. {nextStep}",
  "notice.cameraSavedMatches": "Camera photo saved. Possible matches found: {count}.{skipped}{protected}",
  "notice.folderCheckSummary": "Folder check found {media} photo or video files: {images} images, {videos} videos.{issues}",
  "notice.updatedPossibleMatches": "Possible matches updated: {count}.",
  "notice.exportedSelectedMatches": "Selected possible matches exported: {count}.",
  "notice.clearedSavedPhotos": "Saved face photos cleared: {count}.",
  "notice.deletedPersonData": "Deleted saved photos: {references}. Deleted possible matches: {candidates}.",
  "notice.removedReviewedMatches": "Reviewed possible matches removed: {count}.",
  "notice.supportBundleExported": "Support bundle exported ({bytes}).",
  "notice.faceModelReady": "Face model ready{label}.",
  "notice.workspaceRepaired": "Repaired app folder: removed {references} saved photo link(s) and {candidates} match row(s).",
  "notice.pathsRelinked": "Relinked {count} saved path(s).",
  "notice.duplicateRowsRemoved": "Removed {count} duplicate match row(s).",
  "notice.workspaceOptimized": "Optimized app folder and reclaimed {bytes}.",
  "notice.oldReviewedRemoved": "Removed {count} old reviewed possible match(es).",
  "notice.reportExported": "Exported report for {count} possible match(es).",
  "notice.backupCreated": "Backup created: {name} ({bytes}).",
  "notice.oldBackupsRemoved": "Removed {count} old backup(s) and reclaimed {bytes}.",
  "notice.scanRunsExported": "Exported {count} scan run(s).",
  "notice.oldScanRunsRemoved": "Removed {runs} old scan run(s) and {rows} manifest row(s).",
  "notice.inventoryExported": "Exported inventory for {count} source folder(s).",
  "notice.activityEventsExported": "Exported {count} activity event(s).",
  "notice.consentReceiptExported": "Consent receipt exported for {count} person label(s).",
  "notice.retentionReportLoaded": "Retention report loaded for {count} reviewed match(es).",
  "notice.retentionReportEmpty": "Retention report loaded; no reviewed matches are ready for cleanup.",
  "notice.safeModeAuditExported": "Safe Mode audit exported with {count} protected item(s).",
  "notice.reviewLedgerExported": "Review ledger exported with {count} decision event(s).",
  "notice.activityEventsLoaded": "Loaded {count} activity event(s).",
  "notice.modelDriftStale": "{count} saved item(s) were created with a different face model.",
  "notice.modelDriftReady": "Saved faces and matches use the active face model.",
  "notice.accuracyLabelsExported": "Exported {count} accuracy label(s).",
  "notice.mediaFilesExported": "Exported {count} media file(s) to a shareable folder.",
  "notice.personRenamed": "Updated {references} saved photo(s) and {candidates} possible match(es).",
  "notice.issueFilesIgnored": "Ignored {count} file(s) for future scans.",
  "notice.retryFilesComplete": "Retried {files} file(s) and found {matches} possible match(es).{skipped}",
  "notice.scanQueueFinished": "Scan queue finished {count} folder(s).",
  "notice.failedFoldersReady": "{count} failed folder(s) ready to retry.",
  "addPerson.stagedReadyOne": "{count} photo ready",
  "addPerson.stagedReadyMany": "{count} photos ready",
  "addPerson.addCountOne": "Add {count} photo",
  "addPerson.addCountMany": "Add {count} photos",
  "addPerson.addCountNamedOne": "Add {count} photo to “{name}”",
  "addPerson.addCountNamedMany": "Add {count} photos to “{name}”",
  "dialog.deleteSavedPhoto": "Delete this saved photo for {person}?",
  "dialog.clearMatches": "Clear all possible matches from the review list?",
  "dialog.clearSavedPhotos": "Clear all saved face photos? Activity history is preserved.",
  "dialog.deletePerson": "Delete saved photos and possible matches for {person}? Activity history is preserved.",
  "dialog.purgeReviewed": "Remove reviewed possible matches from the active list? Activity history is preserved.",
  "dialog.repairMissingLinks": "Remove {references} missing saved photo link(s) and {candidates} missing match row(s)? Original photos are not touched.{rootWarning}",
  "dialog.forceRepairMissingDrive": "Repair was blocked because several saved links look like a disconnected or moved drive:\n\n{roots}\n\nChoose Cancel, reconnect the drive, then use Relink. Choose OK only if you want to remove these saved links from the app.",
  "dialog.relinkSavedPaths": "Update {count} saved path(s) to the selected folder? Original photos are not moved or copied.{partialWarning}",
  "dialog.removeDuplicateRows": "Remove {count} duplicate match row(s)? The strongest row in each group will be kept.",
  "dialog.optimizeWorkspace": "Optimize generated app-folder data? Original photos and videos will not be touched.",
  "dialog.renamePerson": "Rename {oldName} to {newName}?{mergeText}"
};

export function formatUiMessage(language: LanguageCode, key: UiMessageKey, values: Record<string, string | number> = {}): string {
  const resolved = localeBundle(language).uiMessages?.[key] ?? uiMessageEn[key];
  if (resolved === undefined && import.meta.env?.DEV) {
    console.warn(`[i18n] missing UI message key: ${key}`);
  }
  const template = resolved ?? key;
  return Object.entries(values).reduce((text, [name, value]) => {
    const rendered = String(value);
    const isolated = language === "ar" && typeof value === "string" && rendered && !/[\u0600-\u06ff]/.test(rendered) ? `\u2068${rendered}\u2069` : rendered;
    return text.replaceAll(`{${name}}`, isolated);
  }, template);
}

const errorMessageEn: Record<string, string> = {
  "E-WORKSPACE-LOCKED": "App folder is locked. Unlock it before making changes or reading private review data.",
  "E-WORKSPACE-LOCK-UNAVAILABLE": "Workspace Lock is not available on this computer.",
  "E-WORKSPACE-LOCK-OFF": "Turn Workspace Lock on before locking this app folder.",
  "E-WORKSPACE-LOCK-UNLOCK": "This app folder could not be unlocked on this computer.",
  "E-SECURITY-IPC": "The app blocked an untrusted desktop request.",
  "E-IPC-PAYLOAD": "The app received a request it could not read.",
  "E-IPC-BLOCKED-COMMAND": "The app blocked an unsupported command.",
  "E-IPC-PARAMS-LARGE": "The request is too large to process safely.",
  "E-DIAG-EVENT-LARGE": "The diagnostics event is too large to save.",
  "E-CAMERA-FRAME-TYPE": "Camera capture must be a PNG, JPEG, or WebP image.",
  "E-CAMERA-FRAME-EMPTY": "Camera capture was empty.",
  "E-CAMERA-FRAME-LARGE": "Camera capture was too large.",
  "E-FOLDER-WATCH-PATH": "Choose a folder before starting folder watch.",
  "E-BACKEND-START": "The local photo engine did not start in time.",
  "E-BACKEND-EXIT": "The local photo engine stopped unexpectedly.",
  "E-BACKEND-TIMEOUT": "The local photo engine took too long to answer.",
  "E-BACKEND-COMMAND": "The local photo engine could not complete the action.",
  "E-BACKEND-PERMISSION": "Permission is required before this action can continue.",
  "E-BACKEND-VALIDATION": "Review the requested values and try again.",
  "E-BACKEND-NOT-FOUND": "The selected item was not found. Refresh and try again.",
  "E-FS-NOT-FOUND": "The file or folder was not found. Reconnect the drive or choose another location.",
  "E-FS-PERMISSION": "The app does not have permission to read or write that location.",
  "E-MEDIA-IMAGE-DECODE": "This image could not be read. Convert it or skip it.",
  "E-MEDIA-VIDEO-DECODE": "This video could not be read. Convert it or skip it.",
  "E-SCAN-FILE-CHANGED": "A file changed while scanning. Run the scan again after copying finishes.",
  "E-SCAN-CANCELLED": "The scan was cancelled.",
  "E-UPDATE-CHECK": "Update check failed. Check the network and try again.",
  "E-UPDATE-DOWNLOAD": "Update download failed. Check the network and try again.",
  "E-UPDATE-FAILED": "The update action failed.",
  "E-APP-ERROR": "The app could not complete the action."
};

export function formatErrorMessage(language: LanguageCode, code: string | null | undefined, fallback: string, action = ""): string {
  const normalizedCode = String(code || "").trim();
  const table = localeBundle(language).errorMessages;
  const message = normalizedCode ? table?.[normalizedCode] || errorMessageEn[normalizedCode] || fallback : fallback;
  const localizedAction = action ? translateUiText(language, action) : "";
  return normalizedCode ? `[${normalizedCode}] ${localizedAction ? `${message} ${localizedAction}` : message}` : message;
}

type LocalizedNodeState = {
  source: string;
  lastApplied: string;
};

const textNodeSources = new WeakMap<Text, LocalizedNodeState>();
const attributeSources = new WeakMap<Element, Map<string, LocalizedNodeState>>();

const structuredLiteralTranslationCache = new Map<LanguageCode, Record<string, string>>();

function buildStructuredLiteralTranslations(language: LanguageCode): Record<string, string> {
  if (language === "en") return {};
  const cached = structuredLiteralTranslationCache.get(language);
  if (cached) return cached;
  const translations = localeBundle(language).translations || {};
  const built = Object.fromEntries(
    Object.entries(en).map(([key, english]) => [english, translations[key as TranslationKey] || english])
  );
  structuredLiteralTranslationCache.set(language, built);
  return built;
}

function translateLiteral(language: LanguageCode, source: string): string {
  if (language === "en") return source;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return source;
  const [, leading, core, trailing] = match;
  if (!core.trim()) return source;
  const structured = buildStructuredLiteralTranslations(language);
  const bundle = localeBundle(language);
  const translated = bundle.literals?.[core] || bundle.safeModeReviewLiterals?.[core] || bundle.newFeaturePhrases?.[core] || structured[core];
  return translated ? `${leading}${translated}${trailing}` : source;
}

const photoUiFallbackCache = new Map<LanguageCode, Array<[RegExp, string]>>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPhotoUiFallbackTerms(language: LanguageCode): Array<[RegExp, string]> {
  if (language === "en") return [];
  const cached = photoUiFallbackCache.get(language);
  if (cached) return cached;
  const bundle = localeBundle(language);
  const terms = Object.entries({
    ...(bundle.photoUiFallbackTerms || {}),
    ...(bundle.photoUiAdditionalFallbackTerms || {})
  })
    .filter((item): item is [string, string] => Boolean(item[1]))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([source, translated]) => {
      const leftBoundary = /^[A-Za-z0-9]/.test(source) ? "\\b" : "";
      const rightBoundary = /[A-Za-z0-9]$/.test(source) ? "\\b" : "";
      return [new RegExp(`${leftBoundary}${escapeRegExp(source)}${rightBoundary}`, "gi"), translated] as [RegExp, string];
    });
  photoUiFallbackCache.set(language, terms);
  return terms;
}

function translatePhotoUiFallback(language: LanguageCode, source: string): string {
  if (language === "en" || !/[A-Za-z]/.test(source)) return source;
  let translated = source;
  for (const [pattern, replacement] of buildPhotoUiFallbackTerms(language)) {
    translated = translated.replace(pattern, replacement);
  }
  return translated;
}

const phraseTranslationCache = new Map<LanguageCode, Array<[string, string]>>();

function buildPhraseTranslations(language: LanguageCode): Array<[string, string]> {
  if (language === "en") return [];
  const cached = phraseTranslationCache.get(language);
  if (cached) return cached;
  const structured = buildStructuredLiteralTranslations(language);
  const bundle = localeBundle(language);
  const phrases = Object.entries({
    ...structured,
    ...(bundle.literals || {}),
    ...(bundle.safeModeReviewLiterals || {}),
    ...(bundle.uiPhrases || {}),
    ...(bundle.newFeaturePhrases || {})
  })
    .filter(([source, translated]) => source.length >= 8 && translated && source !== translated)
    .sort((a, b) => b[0].length - a[0].length);
  phraseTranslationCache.set(language, phrases);
  return phrases;
}

export function translateUiText(language: LanguageCode, source: string, options: { phrases?: boolean } = {}): string {
  const exact = translateLiteral(language, source);
  if (exact !== source || language === "en") return exact;
  if (options.phrases === false) return source;
  let translated = source;
  for (const [phrase, replacement] of buildPhraseTranslations(language)) {
    if (translated.includes(phrase)) {
      translated = translated.split(phrase).join(replacement);
    }
  }
  return translatePhotoUiFallback(language, translated);
}

function isLocalizableTextElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (["SCRIPT", "STYLE", "TEXTAREA"].includes(tag)) return false;
  if (element.closest("[data-no-localize], pre, code")) return false;
  return true;
}

function isLocalizableAttributeElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (["SCRIPT", "STYLE"].includes(tag)) return false;
  if (element.closest("[data-no-localize], pre, code")) return false;
  return true;
}

function localizeTextNode(node: Text, language: LanguageCode) {
  if (!isLocalizableTextElement(node.parentElement)) return;
  const current = node.nodeValue || "";
  const previous = textNodeSources.get(node);
  const source = previous && (current === previous.lastApplied || current === previous.source) ? previous.source : current;
  const next = translateLiteral(language, source);
  textNodeSources.set(node, { source, lastApplied: next });
  if (current !== next) node.nodeValue = next;
}

function localizeAttribute(element: Element, attr: string, language: LanguageCode) {
  const current = element.getAttribute(attr);
  if (!current) return;
  let stateByAttr = attributeSources.get(element);
  if (!stateByAttr) {
    stateByAttr = new Map<string, LocalizedNodeState>();
    attributeSources.set(element, stateByAttr);
  }
  const previous = stateByAttr.get(attr);
  const source = previous && (current === previous.lastApplied || current === previous.source) ? previous.source : current;
  const next = translateLiteral(language, source);
  stateByAttr.set(attr, { source, lastApplied: next });
  if (current !== next) element.setAttribute(attr, next);
}

export function localizeDom(root: ParentNode, language: LanguageCode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isLocalizableTextElement(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  let textNode = walker.nextNode();
  while (textNode) {
    localizeTextNode(textNode as Text, language);
    textNode = walker.nextNode();
  }

  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll("*"))] : Array.from(root.querySelectorAll("*"));
  for (const element of elements) {
    if (!isLocalizableAttributeElement(element)) continue;
    localizeAttribute(element, "aria-label", language);
    localizeAttribute(element, "title", language);
    localizeAttribute(element, "placeholder", language);
    localizeAttribute(element, "alt", language);
  }
}
