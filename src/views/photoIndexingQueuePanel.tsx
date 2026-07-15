import { AudioLines, Clock, Images, Layers, Play, PlusCircle, RefreshCcw, X } from "lucide-react";

type PhotoIndexingQueuePanelText = (value: string) => string;

export type PhotoIndexingQueueJob = Record<string, unknown>;

export type PhotoIndexingQueuePanelProps = {
  error: string;
  notice: string;
  text: string;
  jobs: PhotoIndexingQueueJob[];
  activeJobId: string;
  busy: boolean;
  queueBusy: boolean;
  localIntelligenceEnabled: boolean;
  backgroundIndexingPaused: boolean;
  hasItems: boolean;
  hasVideos: boolean;
  canRunQueuedJobs: boolean;
  canRetryFailedJobs: boolean;
  queuedCount: number;
  pausedCount: number;
  failedCount: number;
  uiText: PhotoIndexingQueuePanelText;
  formatCount: (value: number) => string;
  onRefresh: () => void;
  onQueueLoadedOcr: () => void;
  onQueuePendingOcr: () => void;
  onQueuePendingBarcode: () => void;
  onQueueLoadedObjects: () => void;
  onQueuePendingObjects: () => void;
  onQueueLoadedAudio: () => void;
  onQueuePendingAudio: () => void;
  onQueueGeneratedCollections: () => void;
  onQueueSmartAlbums: () => void;
  onRunNext: () => void;
  onRunQueue: () => void;
  onRetryFailedQueue: () => void;
  onRunJob: (jobId: string, retry?: boolean) => void;
  onCancelJob: (jobId: string) => void;
  onDismissJob: (jobId: string) => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jobRequiresLocalIntelligence(jobKind: string): boolean {
  return jobKind !== "search" && jobKind !== "generated_collections" && jobKind !== "smart_albums";
}

function jobKindLabel(jobKind: string, uiText: PhotoIndexingQueuePanelText): string {
  if (jobKind === "barcode") return uiText("Barcodes");
  if (jobKind === "objects") return uiText("Detected items");
  if (jobKind === "search") return uiText("Search index");
  if (jobKind === "generated_collections") return uiText("Generated collections");
  if (jobKind === "smart_albums") return uiText("Smart albums");
  if (jobKind === "semantic") return uiText("Semantic media");
  if (jobKind === "audio") return uiText("Transcripts and sounds");
  return uiText("OCR");
}

export function PhotoIndexingQueuePanel(props: PhotoIndexingQueuePanelProps) {
  const runnableCount = props.queuedCount + props.pausedCount;
  const noteText = props.error || props.notice || props.text;
  return (
    <div className={props.error ? "photo-settings-note warn" : "photo-settings-note"}>
      <small>{noteText}</small>
      <div className="photo-settings-note-actions">
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onRefresh}
          disabled={props.queueBusy}
          aria-label={props.uiText("Refresh local indexing queue")}
        >
          <RefreshCcw size={13} />
          <span>{props.uiText("Queue status")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueueLoadedOcr}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled || !props.hasItems}
          aria-label={props.uiText("Queue loaded OCR indexing")}
        >
          <PlusCircle size={13} />
          <span>{props.uiText("Queue loaded OCR")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueuePendingOcr}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled}
          aria-label={props.uiText("Queue pending OCR indexing")}
        >
          <Clock size={13} />
          <span>{props.uiText("Queue pending OCR")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueuePendingBarcode}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled}
          aria-label={props.uiText("Queue pending barcode indexing")}
        >
          <Clock size={13} />
          <span>{props.uiText("Queue pending barcodes")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueueLoadedObjects}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled || !props.hasItems}
          aria-label={props.uiText("Queue loaded detected item indexing")}
        >
          <PlusCircle size={13} />
          <span>{props.uiText("Queue loaded detected items")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueuePendingObjects}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled}
          aria-label={props.uiText("Queue pending detected item indexing")}
        >
          <Clock size={13} />
          <span>{props.uiText("Queue pending detected items")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueueLoadedAudio}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled || !props.hasVideos}
          aria-label={props.uiText("Queue loaded video audio indexing")}
        >
          <AudioLines size={13} />
          <span>{props.uiText("Queue loaded audio")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueuePendingAudio}
          disabled={props.busy || props.queueBusy || !props.localIntelligenceEnabled}
          aria-label={props.uiText("Queue pending video audio indexing")}
        >
          <Clock size={13} />
          <span>{props.uiText("Queue pending audio")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueueGeneratedCollections}
          disabled={props.busy || props.queueBusy}
          aria-label={props.uiText("Queue generated collections refresh")}
        >
          <Images size={13} />
          <span>{props.uiText("Queue generated collections")}</span>
        </button>
        <button
          type="button"
          className="ghost compact-action"
          onClick={props.onQueueSmartAlbums}
          disabled={props.busy || props.queueBusy}
          aria-label={props.uiText("Queue smart album refresh")}
        >
          <Layers size={13} />
          <span>{props.uiText("Queue smart albums")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onRunNext}
          disabled={
            props.busy
            || props.queueBusy
            || !props.canRunQueuedJobs
            || props.backgroundIndexingPaused
            || runnableCount === 0
          }
          aria-label={props.uiText("Run next local indexing job")}
        >
          <Play size={13} />
          <span>{props.queueBusy ? props.uiText("Running") : props.uiText("Run next")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onRunQueue}
          disabled={
            props.busy
            || props.queueBusy
            || !props.canRunQueuedJobs
            || props.backgroundIndexingPaused
            || runnableCount === 0
          }
          aria-label={props.uiText("Run local indexing queue")}
        >
          <Play size={13} />
          <span>{props.queueBusy ? props.uiText("Running") : props.uiText("Run queue")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={props.onRetryFailedQueue}
          disabled={
            props.busy
            || props.queueBusy
            || !props.canRetryFailedJobs
            || props.backgroundIndexingPaused
            || props.failedCount === 0
          }
          aria-label={props.uiText("Retry failed local indexing jobs")}
        >
          <RefreshCcw size={13} />
          <span>{props.queueBusy ? props.uiText("Running") : props.uiText("Retry failed queue")}</span>
        </button>
      </div>
      {props.jobs.length > 0 && (
        <div className="photo-indexing-job-list" aria-label={props.uiText("Local indexing jobs")}>
          {props.jobs.map((job) => {
            const jobId = String(job.jobId || "");
            const jobKind = String(job.jobKind || "");
            const status = String(job.status || "");
            const activeJob = Boolean(jobId && props.activeJobId === jobId);
            const displayStatus = activeJob ? "running" : status;
            const jobLabel = jobKindLabel(jobKind, props.uiText);
            const costClass = String(job.costClass || "");
            const requiresLocalIntelligence = jobRequiresLocalIntelligence(jobKind);
            const scope = asRecord(job.scope);
            const sourcePaths = Array.isArray(scope.sourcePaths) ? scope.sourcePaths : [];
            const scopeLabel = sourcePaths.length
              ? `${props.formatCount(sourcePaths.length)} ${props.uiText("loaded")}`
              : scope.pendingOnly
                ? props.uiText("pending")
                : scope.failedOnly
                  ? props.uiText("failed")
                  : scope.allPhotos || scope.all
                    ? props.uiText("all photos")
                    : props.uiText("custom scope");
            const result = asRecord(job.result);
            const progress = asRecord(result.progress);
            const history = Array.isArray(job.history)
              ? (job.history as unknown[]).filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>
              : [];
            const lastHistory = history.length ? history[history.length - 1] : null;
            const terminalAttemptFallback = (job.startedAt || job.completedAt) && ["paused", "completed", "failed"].includes(status) ? 1 : 0;
            const attempts = Number(job.attempts || history.length || terminalAttemptFallback || 0) || 0;
            const progressLabel = progress.processed !== undefined
              ? `${props.uiText("processed")} ${props.formatCount(Number(progress.processed || 0) || 0)}`
              : String(job.error || "");
            const attemptLabel = attempts > 0 ? `${props.uiText("attempts")} ${props.formatCount(attempts)}` : "";
            const lastStatus = String(lastHistory?.status || (terminalAttemptFallback ? status : "") || "");
            const lastProgress = lastHistory?.progress && typeof lastHistory.progress === "object"
              ? lastHistory.progress as Record<string, unknown>
              : null;
            const lastProgressParts = lastProgress ? [
              Number(lastProgress.updated || 0) ? `${props.uiText("updated")} ${props.formatCount(Number(lastProgress.updated || 0) || 0)}` : "",
              Number(lastProgress.failed || 0) ? `${props.uiText("failed")} ${props.formatCount(Number(lastProgress.failed || 0) || 0)}` : "",
              Number(lastProgress.deferred || 0) ? `${props.uiText("deferred")} ${props.formatCount(Number(lastProgress.deferred || 0) || 0)}` : "",
            ].filter(Boolean) : [];
            const lastHistoryLabel = lastStatus
              ? `${props.uiText("last")} ${lastStatus}${lastProgressParts.length ? ` (${lastProgressParts.join(", ")})` : ""}`
              : "";
            const activeProgressLabel = activeJob ? props.uiText("running") : progressLabel;
            const costLabel = costClass ? `${props.uiText("cost")} ${props.uiText(costClass)}` : "";
            const jobSummary = [scopeLabel, costLabel, activeProgressLabel, attemptLabel, lastHistoryLabel].filter(Boolean).join(" · ");
            const jobError = String(job.error || result.error || "");
            const progressDetails = [
              progress.processed !== undefined ? `${props.uiText("processed")} ${props.formatCount(Number(progress.processed || 0) || 0)}` : "",
              progress.updated !== undefined ? `${props.uiText("updated")} ${props.formatCount(Number(progress.updated || 0) || 0)}` : "",
              progress.failed !== undefined ? `${props.uiText("failed")} ${props.formatCount(Number(progress.failed || 0) || 0)}` : "",
              progress.deferred !== undefined ? `${props.uiText("deferred")} ${props.formatCount(Number(progress.deferred || 0) || 0)}` : "",
            ].filter(Boolean);
            const sourceFileNames = sourcePaths
              .map((value) => String(value || "").split(/[\\/]/).filter(Boolean).pop() || String(value || ""))
              .filter(Boolean)
              .slice(0, 4);
            const scopeDetails = [
              sourceFileNames.length ? `${props.uiText("Sources")}: ${sourceFileNames.join(", ")}${sourcePaths.length > sourceFileNames.length ? ` +${props.formatCount(sourcePaths.length - sourceFileNames.length)}` : ""}` : "",
              scope.pendingOnly ? props.uiText("Pending-only scope") : "",
              scope.failedOnly ? props.uiText("Failed-only scope") : "",
              scope.allPhotos || scope.all ? props.uiText("All photos scope") : "",
              scope.budgetLimit ? `${props.uiText("Budget")} ${props.formatCount(Number(scope.budgetLimit || 0) || 0)}` : "",
              scope.language ? `${props.uiText("Language")}: ${String(scope.language)}` : "",
              scope.libraryRoot ? `${props.uiText("Library root")}: ${String(scope.libraryRoot)}` : "",
              scope.albumId ? `${props.uiText("Album")}: ${String(scope.albumId)}` : "",
              scope.folderId ? `${props.uiText("Folder")}: ${String(scope.folderId)}` : "",
              scope.sidecarOnly ? props.uiText("Sidecar-only") : "",
            ].filter(Boolean);
            const historyRows = history.slice(-3).reverse();
            const canRunJob = Boolean(!activeJob && jobId && (status === "queued" || status === "paused"));
            const canRetryJob = Boolean(!activeJob && jobId && status === "failed");
            const canCancelJob = Boolean(!activeJob && jobId && (status === "queued" || status === "paused"));
            const canDismissJob = Boolean(!activeJob && jobId && status !== "running" && status !== "queued" && status !== "paused");
            return (
              <div key={jobId || `${jobKind}:${status}:${scopeLabel}`} className={`photo-indexing-job-row ${displayStatus}`}>
                <strong>{jobLabel} · {displayStatus || props.uiText("queued")}</strong>
                <small>{jobSummary}</small>
                <span className="photo-indexing-job-actions">
                  {canRunJob && (
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onRunJob(jobId)}
                      disabled={props.busy || props.queueBusy || (requiresLocalIntelligence && !props.localIntelligenceEnabled) || props.backgroundIndexingPaused}
                      aria-label={props.uiText("Run indexing job")}
                    >
                      <Play size={12} />
                      <span>{props.uiText("Run")}</span>
                    </button>
                  )}
                  {canRetryJob && (
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onRunJob(jobId, true)}
                      disabled={props.busy || props.queueBusy || (requiresLocalIntelligence && !props.localIntelligenceEnabled) || props.backgroundIndexingPaused}
                      aria-label={props.uiText("Retry indexing job")}
                    >
                      <RefreshCcw size={12} />
                      <span>{props.uiText("Retry")}</span>
                    </button>
                  )}
                  {canCancelJob && (
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onCancelJob(jobId)}
                      disabled={props.busy || props.queueBusy}
                      aria-label={props.uiText("Cancel indexing job")}
                    >
                      <X size={12} />
                      <span>{props.uiText("Cancel")}</span>
                    </button>
                  )}
                  {canDismissJob && (
                    <button
                      type="button"
                      className="ghost compact-action"
                      onClick={() => props.onDismissJob(jobId)}
                      disabled={props.busy || props.queueBusy}
                      aria-label={props.uiText("Dismiss indexing job")}
                    >
                      <X size={12} />
                      <span>{props.uiText("Dismiss")}</span>
                    </button>
                  )}
                </span>
                <details className="photo-indexing-job-details">
                  <summary>{props.uiText("Job details")}</summary>
                  <div>
                    <span>{props.uiText("Status")}: {displayStatus || props.uiText("queued")}</span>
                    {costLabel && <span>{props.uiText("Runtime cost")}: {props.uiText(costClass)}</span>}
                    {jobError && <span>{props.uiText("Error")}: {jobError}</span>}
                    {progressDetails.length > 0 && <span>{props.uiText("Progress")}: {progressDetails.join(" · ")}</span>}
                    {scopeDetails.map((detail) => <span key={detail}>{detail}</span>)}
                    {historyRows.length > 0 && (
                      <span>
                        {props.uiText("History")}: {historyRows.map((entry) => {
                          const entryStatus = String(entry.status || entry.event || "");
                          const entryAttempt = Number(entry.attempt || 0) || 0;
                          const entryProgress = asRecord(entry.progress);
                          const entryUpdated = Number(entryProgress.updated || 0) || 0;
                          const entryFailed = Number(entryProgress.failed || 0) || 0;
                          const suffix = [
                            entryUpdated ? `${props.uiText("updated")} ${props.formatCount(entryUpdated)}` : "",
                            entryFailed ? `${props.uiText("failed")} ${props.formatCount(entryFailed)}` : "",
                          ].filter(Boolean).join(", ");
                          return `${entryAttempt ? `${props.uiText("attempt")} ${props.formatCount(entryAttempt)} ` : ""}${entryStatus}${suffix ? ` (${suffix})` : ""}`;
                        }).join(" · ")}
                      </span>
                    )}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
