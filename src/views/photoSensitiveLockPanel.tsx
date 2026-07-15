import { EyeOff, Lock, Unlock } from "lucide-react";

type PhotoSensitiveLockPanelText = (value: string) => string;
type PhotoSensitiveLockPanelAction = unknown | Promise<unknown>;

export type PhotoSensitiveLockPanelProps = {
  activeLabel: string;
  osAuthEnabled: boolean;
  osAuthConfigured: boolean;
  osAuthAvailable: boolean;
  osAuthMethodLabel: string;
  osAuthUnavailableMessage: string;
  authStatusMessage: string;
  passcodeConfigured: boolean;
  passcode: string;
  unlockError: string;
  authPrompting: boolean;
  uiText: PhotoSensitiveLockPanelText;
  onPasscodeChange: (value: string) => void;
  onUnlock: (passcode?: string) => PhotoSensitiveLockPanelAction;
  onHideSensitive: () => void;
};

export function PhotoSensitiveLockPanel(props: PhotoSensitiveLockPanelProps) {
  const lockHelpText = props.osAuthEnabled
    ? props.passcodeConfigured
      ? `${props.uiText("Use")} ${props.osAuthMethodLabel} ${props.uiText("or your local passcode to view photos here.")}`
      : `${props.uiText("Use")} ${props.osAuthMethodLabel} ${props.uiText("to view photos here.")}`
    : props.osAuthConfigured && !props.osAuthAvailable
      ? props.authStatusMessage || props.osAuthUnavailableMessage
      : props.passcodeConfigured
        ? props.uiText("Enter your local passcode to view photos here.")
        : props.uiText("Unlock this session to view photos here and use sensitive collection actions.");

  return (
    <section className="photo-sensitive-lock" aria-label={props.uiText("Sensitive collection locked")}>
      <span className="photo-sensitive-lock-icon"><Lock size={20} /></span>
      <div>
        <strong>{props.activeLabel} {props.uiText("is locked")}</strong>
        <small>{lockHelpText}</small>
      </div>
      <div className="photo-sensitive-lock-actions">
        {props.osAuthEnabled && (
          <button type="button" className="secondary compact-action" onClick={() => void props.onUnlock()} disabled={props.authPrompting}>
            <Unlock size={14} />
            <span>{props.authPrompting ? props.uiText("Authenticating") : `${props.uiText("Unlock with")} ${props.osAuthMethodLabel}`}</span>
          </button>
        )}
        {props.passcodeConfigured ? (
          <form
            className="photo-sensitive-passcode-form"
            onSubmit={(event) => {
              event.preventDefault();
              void props.onUnlock(props.passcode);
            }}
          >
            <input
              type="password"
              value={props.passcode}
              onChange={(event) => props.onPasscodeChange(event.currentTarget.value)}
              placeholder={props.uiText("Passcode")}
              autoComplete="current-password"
            />
            <button type="submit" className="secondary compact-action">
              <Unlock size={14} />
              <span>{props.uiText("Unlock")}</span>
            </button>
            {props.unlockError && <small className="photo-inline-status">{props.unlockError}</small>}
          </form>
        ) : !props.osAuthConfigured ? (
          <button type="button" className="secondary compact-action" onClick={() => void props.onUnlock()}>
            <Unlock size={14} />
            <span>{props.uiText("Unlock")}</span>
          </button>
        ) : (
          props.unlockError && <small className="photo-inline-status">{props.unlockError}</small>
        )}
        <button type="button" className="ghost compact-action" onClick={props.onHideSensitive}>
          <EyeOff size={14} />
          <span>{props.uiText("Hide sensitive")}</span>
        </button>
      </div>
    </section>
  );
}
