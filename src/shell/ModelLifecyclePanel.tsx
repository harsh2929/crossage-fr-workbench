import { Activity, CheckCircle2, CircleOff, RotateCcw, ShieldAlert } from "lucide-react";
import type { ModelLifecycleStatus } from "../types";
import "./ModelLifecyclePanel.css";

type Props = {
  report: ModelLifecycleStatus | null;
  busy: boolean;
  uiText: (source: string) => string;
  onRun: () => void;
  onRollbackConfiguration: () => void;
};

function statusLabel(status: string): string {
  if (status === "pass") return "Verified";
  if (status === "not-installed") return "Not installed";
  if (status === "unavailable") return "Unavailable";
  if (status === "candidate-rejected") return "Candidate rejected";
  return "Blocked";
}

export function ModelLifecyclePanel({ report, busy, uiText, onRun, onRollbackConfiguration }: Props) {
  return (
    <div
      className="panel settings-panel model-lifecycle-panel"
      role="region"
      aria-labelledby="model-lifecycle-title"
      aria-busy={busy}
    >
      <div className="panel-title">
        <Activity size={18} />
        <span id="model-lifecycle-title">{uiText("Model lifecycle")}</span>
        <div className="spacer" />
        {report && (
          <small
            className={report.ready ? "model-lifecycle-state ready" : "model-lifecycle-state blocked"}
            role="status"
            aria-live="polite"
          >
            {uiText(report.ready ? "Regression gates ready" : "Regression gate blocked")}
          </small>
        )}
      </div>
      <p className="compact">
        {uiText("Checks versioned model evidence, datasets, runtime integrity, upgrade regressions, drift, and rollback state without sending library data off device.")}
      </p>
      {report ? (
        <>
          <div className="model-lifecycle-summary" aria-label={uiText("Model lifecycle summary")}>
            <span><strong>{report.counts.passed}</strong><small>{uiText("Verified")}</small></span>
            <span><strong>{report.counts.notInstalled}</strong><small>{uiText("Optional")}</small></span>
            <span><strong>{report.counts.blocked}</strong><small>{uiText("Blocked")}</small></span>
            <span><strong>{report.counts.datasetManifestsVerified}/{report.counts.datasetManifests}</strong><small>{uiText("Datasets")}</small></span>
          </div>
          <div className="model-lifecycle-list" role="list" aria-label={uiText("Model evaluation gates")}>
            {report.components.map((component) => (
              <div className={`model-lifecycle-row ${component.status}`} role="listitem" key={component.id}>
                <span className="model-lifecycle-icon" aria-hidden="true">
                  {component.status === "pass" ? <CheckCircle2 size={17} /> : component.status === "not-installed" ? <CircleOff size={17} /> : <ShieldAlert size={17} />}
                </span>
                <span>
                  <strong>{uiText(component.label)}</strong>
                  <small>
                    {component.runtime.version || component.family}
                    {component.datasets.length ? ` · ${component.datasets.length} ${uiText(component.datasets.length === 1 ? "dataset" : "datasets")}` : ""}
                  </small>
                </span>
                <span>
                  <strong>{uiText(statusLabel(component.status))}</strong>
                  <small>{uiText(component.failures[0] || component.runtime.reason || "Accepted baseline and runtime agree.")}</small>
                </span>
              </div>
            ))}
          </div>
          <small className="model-lifecycle-policy">
            {uiText("Policy")} {report.policyVersion} · {report.policySha256.slice(0, 12)} · {uiText("offline only")}
          </small>
        </>
      ) : (
        <div className="model-lifecycle-empty">
          <ShieldAlert size={18} />
          <span>{uiText("Run the lifecycle gate to compare installed runtimes with accepted offline evidence.")}</span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" type="button" onClick={onRun} disabled={busy}>
          <Activity size={16} />
          <span>{uiText(report ? "Run lifecycle gate again" : "Run lifecycle gate")}</span>
        </button>
        <button className="ghost" type="button" onClick={onRollbackConfiguration} disabled={busy || !report || report.state.configurationHistory < 2}>
          <RotateCcw size={16} />
          <span>{uiText("Restore previous model routes")}</span>
        </button>
      </div>
    </div>
  );
}
