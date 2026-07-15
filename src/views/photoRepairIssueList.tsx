import { AlertTriangle, Archive, FolderInput, RefreshCcw, RotateCcw, Wrench } from "lucide-react";
import { photoRepairIssueActionLabel, type PhotoRepairIssue } from "./photoRepairCenter";

type PhotoRepairIssueListText = (value: string) => string;

export type PhotoRepairIssueListProps = {
  issues: PhotoRepairIssue[];
  uiText: PhotoRepairIssueListText;
  formatCount: (value: number) => string;
  isActionDisabled: (issue: PhotoRepairIssue) => boolean;
  onAction: (issue: PhotoRepairIssue) => void;
};

function PhotoRepairIssueActionIcon(props: { issue: PhotoRepairIssue }) {
  const action = props.issue.action;
  if (action === "openRecovered" || action === "relinkMissingOriginal") return <FolderInput size={14} />;
  if (action === "runRestoreRehearsal") return <RotateCcw size={14} />;
  if (action === "runBackupRestoreRehearsal") return <Archive size={14} />;
  if (action === "cleanCatalogDrift" || action === "openRootProfiles") return <Wrench size={14} />;
  return <RefreshCcw size={14} />;
}

export function PhotoRepairIssueList(props: PhotoRepairIssueListProps) {
  if (!props.issues.length) return null;
  return (
    <div className="photo-repair-issue-list">
      {props.issues.map((issue) => (
        <article key={issue.id} className={`photo-repair-issue ${issue.severity}`}>
          <span className="photo-repair-issue-icon">
            {issue.severity === "error" ? <AlertTriangle size={14} /> : <RefreshCcw size={14} />}
          </span>
          <div>
            <strong>{props.uiText(issue.label)}</strong>
            <small>{props.formatCount(issue.count)} · {props.uiText(issue.detail)}</small>
            {issue.scopeLabel && <small className="photo-repair-issue-scope">{props.uiText(issue.scopeLabel)}</small>}
          </div>
          {issue.action && (
            <button
              type="button"
              className={issue.severity === "error" ? "secondary compact-action" : "ghost compact-action"}
              onClick={() => props.onAction(issue)}
              disabled={props.isActionDisabled(issue)}
            >
              <PhotoRepairIssueActionIcon issue={issue} />
              <span>{props.uiText(photoRepairIssueActionLabel(issue.action))}</span>
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
