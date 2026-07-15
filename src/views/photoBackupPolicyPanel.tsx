import type { PhotoBackupPolicy, PhotoBackupPolicyStatus } from "../types";

type PhotoBackupPolicyPanelText = (value: string) => string;

export type PhotoBackupPolicyPanelProps = {
  policy: PhotoBackupPolicy | null;
  status: PhotoBackupPolicyStatus | null;
  enabled: boolean;
  intervalHours: number;
  statusText: string;
  uiText: PhotoBackupPolicyPanelText;
  formatCount: (value: number) => string;
  onChange: (patch: Partial<PhotoBackupPolicy>) => void;
};

export function PhotoBackupPolicyPanel(props: PhotoBackupPolicyPanelProps) {
  return (
    <>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(event) => props.onChange({ enabled: event.currentTarget.checked })}
        />
        <span>{props.uiText("Scheduled backup checks")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.policy?.autoCheckOnOpen !== false}
          onChange={(event) => props.onChange({ autoCheckOnOpen: event.currentTarget.checked })}
          disabled={!props.enabled}
        />
        <span>{props.uiText("Check when due")}</span>
      </label>
      <label>
        <span>{props.uiText("Backup interval")}</span>
        <select
          value={String(props.intervalHours)}
          onChange={(event) => props.onChange({ intervalHours: Number(event.currentTarget.value) || 168 })}
          disabled={!props.enabled}
        >
          <option value="24">{props.uiText("Daily")}</option>
          <option value="168">{props.uiText("Weekly")}</option>
          <option value="720">{props.uiText("Monthly")}</option>
        </select>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={Boolean(props.policy?.includeGenerated)}
          onChange={(event) => props.onChange({ includeGenerated: event.currentTarget.checked })}
          disabled={!props.enabled}
        />
        <span>{props.uiText("Include generated caches")}</span>
      </label>
      <div className={props.status?.status === "attention" ? "photo-settings-note warn" : "photo-settings-note"}>
        <small>{props.statusText}</small>
        {props.status && (
          <small>
            {props.formatCount(props.status.counts.assetsRequiringExternalBackup)} {props.uiText("external originals")} · {props.status.latestBackup.exists ? props.uiText("backup found") : props.uiText("no backup")}
          </small>
        )}
      </div>
    </>
  );
}
