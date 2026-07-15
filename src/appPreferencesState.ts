import { recordAppStorageIssue } from "./appStorageDiagnostics";
import { normalizeLanguage, type LanguageCode } from "./i18n";

export const languageStorageKey = "vintrace:language";
export const onboardingStorageKey = "vintrace:onboarding:v1";
export const photoImportFlagStorageKey = "vintrace.hasImportedPhotos";
export const agentDiscoveryStorageKey = "vintrace:agent-platform-discovery:v1";

export function readInitialLanguage(): LanguageCode {
  try {
    const saved = window.localStorage.getItem(languageStorageKey);
    if (saved) return normalizeLanguage(saved);
  } catch (error) {
    recordAppStorageIssue("language", "read", languageStorageKey, error);
  }
  return normalizeLanguage(typeof navigator !== "undefined" ? navigator.language : "en");
}

export function writeLanguage(language: LanguageCode) {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch (error) {
    recordAppStorageIssue("language", "write", languageStorageKey, error);
  }
}

export function readOnboardingDismissed() {
  try {
    return window.localStorage.getItem(onboardingStorageKey) === "dismissed";
  } catch (error) {
    recordAppStorageIssue("onboarding", "read", onboardingStorageKey, error);
    return false;
  }
}

export function writeOnboardingDismissed() {
  try {
    window.localStorage.setItem(onboardingStorageKey, "dismissed");
  } catch (error) {
    recordAppStorageIssue("onboarding", "write", onboardingStorageKey, error);
  }
}

export function readPhotoImportFlag() {
  try {
    return window.localStorage?.getItem(photoImportFlagStorageKey) === "1";
  } catch (error) {
    recordAppStorageIssue("photoImportFlag", "read", photoImportFlagStorageKey, error);
    return false;
  }
}

export function writePhotoImportFlag() {
  try {
    window.localStorage?.setItem(photoImportFlagStorageKey, "1");
  } catch (error) {
    recordAppStorageIssue("photoImportFlag", "write", photoImportFlagStorageKey, error);
  }
}

export function readAgentDiscoverySeen() {
  try {
    return window.localStorage.getItem(agentDiscoveryStorageKey) === "seen";
  } catch (error) {
    recordAppStorageIssue("agentDiscovery", "read", agentDiscoveryStorageKey, error);
    return false;
  }
}

export function writeAgentDiscoverySeen() {
  try {
    window.localStorage.setItem(agentDiscoveryStorageKey, "seen");
  } catch (error) {
    recordAppStorageIssue("agentDiscovery", "write", agentDiscoveryStorageKey, error);
  }
}
