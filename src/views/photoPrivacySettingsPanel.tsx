import { Lock, RefreshCcw, X } from "lucide-react";
import type { PhotoLocalSettings } from "./photoSettings";

type PhotoPrivacySettingsPanelText = (value: string) => string;

export type PhotoPrivacySettingsPanelProps = {
  settings: PhotoLocalSettings;
  sensitiveAuthLoading: boolean;
  sensitiveOsAuthAvailable: boolean;
  sensitiveOsAuthMethodLabel: string;
  sensitiveAuthStatusMessage: string;
  sensitiveOsAuthUnavailableMessage: string;
  sensitivePasscodeConfigured: boolean;
  sensitivePasscodeDraft: string;
  sensitivePasscodeConfirmDraft: string;
  sensitivePasscodeStatus: string;
  sensitivePasscodeSaving: boolean;
  uiText: PhotoPrivacySettingsPanelText;
  onSettingsChange: (patch: Partial<PhotoLocalSettings>) => void;
  onRefreshSensitiveAuthStatus: () => void;
  onSensitivePasscodeDraftChange: (value: string) => void;
  onSensitivePasscodeConfirmDraftChange: (value: string) => void;
  onSaveSensitivePasscode: () => void;
  onClearSensitivePasscode: () => void;
};

export function PhotoPrivacySettingsPanel(props: PhotoPrivacySettingsPanelProps) {
  const sensitiveControlsDisabled = !props.settings.lockSensitiveCollections;
  const osAuthDisabled = sensitiveControlsDisabled
    || props.sensitiveAuthLoading
    || (!props.sensitiveOsAuthAvailable && !props.settings.sensitiveOsAuthEnabled);
  return (
    <>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.referencedFileWarnings}
          onChange={(event) => props.onSettingsChange({ referencedFileWarnings: event.currentTarget.checked })}
        />
        <span>{props.uiText("Referenced-file warnings")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.stripLocationOnExport}
          onChange={(event) => props.onSettingsChange({ stripLocationOnExport: event.currentTarget.checked })}
        />
        <span>{props.uiText("Strip location by default")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.lockSensitiveCollections}
          onChange={(event) => props.onSettingsChange({ lockSensitiveCollections: event.currentTarget.checked })}
        />
        <span>{props.uiText("Lock sensitive collections")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.relockSensitiveCollectionsOnLeave}
          onChange={(event) => props.onSettingsChange({ relockSensitiveCollectionsOnLeave: event.currentTarget.checked })}
          disabled={sensitiveControlsDisabled}
        />
        <span>{props.uiText("Relock after leaving sensitive")}</span>
      </label>
      <label>
        <span>{props.uiText("Sensitive session lock")}</span>
        <select
          value={String(props.settings.sensitiveSessionLockMinutes)}
          onChange={(event) => props.onSettingsChange({ sensitiveSessionLockMinutes: Number(event.currentTarget.value) })}
          disabled={sensitiveControlsDisabled}
        >
          <option value="0">{props.uiText("Off")}</option>
          <option value="5">{props.uiText("5 minutes")}</option>
          <option value="15">{props.uiText("15 minutes")}</option>
          <option value="30">{props.uiText("30 minutes")}</option>
          <option value="60">{props.uiText("1 hour")}</option>
          <option value="240">{props.uiText("4 hours")}</option>
        </select>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.sensitiveOsAuthEnabled}
          onChange={(event) => props.onSettingsChange({ sensitiveOsAuthEnabled: event.currentTarget.checked })}
          disabled={osAuthDisabled}
        />
        <span>{props.uiText("Use device authentication")}</span>
      </label>
      <label>
        <span>{props.uiText("Recent activity")}</span>
        <select
          value={String(props.settings.recentActivityRetentionDays)}
          onChange={(event) => props.onSettingsChange({ recentActivityRetentionDays: Number(event.currentTarget.value) })}
        >
          <option value="7">{props.uiText("7 days")}</option>
          <option value="30">{props.uiText("30 days")}</option>
          <option value="90">{props.uiText("90 days")}</option>
          <option value="365">{props.uiText("1 year")}</option>
          <option value="0">{props.uiText("Keep all")}</option>
        </select>
      </label>
      <div className="photo-settings-auth-note">
        <small>
          {props.sensitiveAuthLoading
            ? props.uiText("Checking device authentication...")
            : props.sensitiveOsAuthAvailable
              ? `${props.sensitiveOsAuthMethodLabel} ${props.uiText("can unlock Hidden and Recently Deleted.")}`
              : props.sensitiveAuthStatusMessage || props.sensitiveOsAuthUnavailableMessage}
        </small>
        <button type="button" className="ghost compact-action" onClick={props.onRefreshSensitiveAuthStatus} disabled={props.sensitiveAuthLoading}>
          <RefreshCcw size={13} />
          <span>{props.uiText("Check")}</span>
        </button>
      </div>
      <div className="photo-settings-passcode" aria-label={props.uiText("Sensitive passcode")}>
        <span>{props.uiText("Sensitive passcode")}</span>
        <small>{props.sensitivePasscodeConfigured ? props.uiText("Passcode required for Hidden and Recently Deleted.") : props.uiText("Optional local passcode for Hidden and Recently Deleted.")}</small>
        <input
          type="password"
          value={props.sensitivePasscodeDraft}
          onChange={(event) => props.onSensitivePasscodeDraftChange(event.currentTarget.value)}
          placeholder={props.uiText("New passcode")}
          disabled={sensitiveControlsDisabled || props.sensitivePasscodeSaving}
        />
        <input
          type="password"
          value={props.sensitivePasscodeConfirmDraft}
          onChange={(event) => props.onSensitivePasscodeConfirmDraftChange(event.currentTarget.value)}
          placeholder={props.uiText("Confirm passcode")}
          disabled={sensitiveControlsDisabled || props.sensitivePasscodeSaving}
        />
        <div className="photo-settings-passcode-actions">
          <button type="button" className="secondary compact-action" onClick={props.onSaveSensitivePasscode} disabled={sensitiveControlsDisabled || props.sensitivePasscodeSaving}>
            <Lock size={13} />
            <span>{props.uiText("Set passcode")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={props.onClearSensitivePasscode} disabled={!props.sensitivePasscodeConfigured || props.sensitivePasscodeSaving}>
            <X size={13} />
            <span>{props.uiText("Clear passcode")}</span>
          </button>
        </div>
        {props.sensitivePasscodeStatus && <small className="photo-inline-status">{props.sensitivePasscodeStatus}</small>}
      </div>
    </>
  );
}
