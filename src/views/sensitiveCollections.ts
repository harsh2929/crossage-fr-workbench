// Pure decision logic for the sensitive-collection privacy lock, extracted from
// PhotosView.tsx for isolated testing (see tests/sensitive_collections.test.mjs).
// This is the guard around Safe Mode's hidden collections: when they start locked,
// when the session auto-relocks, whether leaving the window relocks, and what proof
// an unlock still needs. No React/DOM — the effects/handlers in PhotosView call these.

export interface SensitiveLockSettings {
  lockSensitiveCollections: boolean;
  relockSensitiveCollectionsOnLeave: boolean;
  sensitiveSessionLockMinutes: number;
  sensitiveOsAuthEnabled: boolean;
}

export interface SensitiveUnlockContext {
  /** A passcode was supplied for this unlock attempt. */
  passcodeProvided: boolean;
  /** OS/device authentication already succeeded this attempt. */
  verifiedWithDevice: boolean;
  /** The workspace has a sensitive-collection passcode configured. */
  passcodeConfigured: boolean;
}

export interface SensitiveUnlockRequirements {
  deviceAuthRequired: boolean;
  passcodeRequired: boolean;
}

/** Collections start unlocked only when locking is disabled. */
export function initialSensitiveUnlocked(settings: SensitiveLockSettings): boolean {
  return !settings.lockSensitiveCollections;
}

/** Milliseconds until the unlocked session auto-relocks, or null when no timer
 *  should run. Requires locking on, an unlocked session, and a positive minute
 *  budget; a positive budget below one minute is clamped up to one minute. */
export function sensitiveSessionLockTimeoutMs(settings: SensitiveLockSettings, unlocked: boolean): number | null {
  if (!settings.lockSensitiveCollections || !unlocked || settings.sensitiveSessionLockMinutes <= 0) {
    return null;
  }
  return Math.max(1, settings.sensitiveSessionLockMinutes) * 60 * 1000;
}

/** Re-lock when the window loses focus/leaves only when both toggles are on. */
export function shouldRelockOnLeave(settings: SensitiveLockSettings): boolean {
  return Boolean(settings.lockSensitiveCollections && settings.relockSensitiveCollectionsOnLeave);
}

/** What proof unlock still needs, given the current attempt context. Device auth is
 *  prompted when OS auth is on and no passcode was typed; a passcode is required when
 *  one is configured and device auth has not verified. Either path satisfies unlock. */
export function sensitiveUnlockRequirements(
  settings: SensitiveLockSettings,
  ctx: SensitiveUnlockContext,
): SensitiveUnlockRequirements {
  const locked = Boolean(settings.lockSensitiveCollections);
  return {
    deviceAuthRequired: Boolean(locked && settings.sensitiveOsAuthEnabled && !ctx.passcodeProvided),
    passcodeRequired: Boolean(locked && ctx.passcodeConfigured && !ctx.verifiedWithDevice),
  };
}
