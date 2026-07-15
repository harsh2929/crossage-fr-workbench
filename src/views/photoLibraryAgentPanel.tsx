import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import type {
  PhotoLibraryAgentCitation,
  PhotoLibraryAgentPlan,
  PhotoLibraryAgentPlanExecution,
  PhotoLibraryAgentResponse,
  PhotoLibraryAgentStatus,
} from "../types";

type AgentTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: PhotoLibraryAgentResponse;
};

export type PhotoLibraryAgentPanelProps = {
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  getStatus: () => Promise<{ value: PhotoLibraryAgentStatus }>;
  query: (params: Record<string, unknown>) => Promise<{ value: PhotoLibraryAgentResponse }>;
  executePlan: (params: Record<string, unknown>) => Promise<{ value: PhotoLibraryAgentPlanExecution }>;
  onOpenCitation: (citation: PhotoLibraryAgentCitation) => void;
};

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "The local library agent could not complete the request.");
}

function modelTier(status: PhotoLibraryAgentStatus | null) {
  const model = status?.model && typeof status.model === "object" ? status.model : {};
  const route = "route" in model && model.route && typeof model.route === "object"
    ? model.route as Record<string, unknown>
    : {};
  return String(route.tier || "");
}

function actionLabel(action: string) {
  return String(action || "").replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

export function PhotoLibraryAgentPanel({
  uiText,
  formatCount,
  getStatus,
  query,
  executePlan,
  onOpenCitation,
}: PhotoLibraryAgentPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<PhotoLibraryAgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [confirmingPlanId, setConfirmingPlanId] = useState("");
  const [executingPlanId, setExecutingPlanId] = useState("");
  const [planResults, setPlanResults] = useState<Record<string, PhotoLibraryAgentPlanExecution>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      const result = await getStatus();
      setStatus(result.value);
    } catch (nextError) {
      const message = messageForError(nextError);
      setStatus({ version: "unavailable", available: false, offline: true, reason: message });
      setError(message);
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    if (!expanded || status || statusLoading) return;
    void refreshStatus();
  }, [expanded, status, statusLoading]);

  useEffect(() => {
    if (!expanded) return;
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [busy, expanded, turns]);

  const history = useMemo(() => turns.slice(-8).map((turn) => ({
    role: turn.role,
    text: turn.text,
    assetIds: turn.response?.resultAssetIds || [],
  })), [turns]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || status?.available === false) return;
    const userTurn: AgentTurn = { id: `user-${Date.now()}`, role: "user", text };
    setTurns((current) => [...current, userTurn]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const result = await query({ query: text, history });
      setTurns((current) => [...current, {
        id: result.value.requestId,
        role: "assistant",
        text: result.value.answer,
        response: result.value,
      }]);
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function confirmPlan(plan: PhotoLibraryAgentPlan) {
    if (executingPlanId) return;
    setExecutingPlanId(plan.planId);
    setError("");
    try {
      const result = await executePlan({
        planId: plan.planId,
        confirm: true,
        idempotencyKey: `photo-agent:${plan.planId}`,
      });
      setPlanResults((current) => ({ ...current, [plan.planId]: result.value }));
      setConfirmingPlanId("");
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setExecutingPlanId("");
    }
  }

  function useFollowUp(value: string) {
    setDraft(value);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const tier = modelTier(status);
  return (
    <section className={expanded ? "photo-library-agent expanded" : "photo-library-agent"} aria-label={uiText("Ask Library")}>
      <div className="photo-library-agent-head">
        <button
          type="button"
          className="photo-library-agent-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <MessageSquareText size={18} />
          <span>
            <strong>{uiText("Ask Library")}</strong>
            <small>{uiText("Private on-device answers")}</small>
          </span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expanded && (
          <div className="photo-library-agent-head-actions">
            <span className={status?.available ? "photo-library-agent-state ready" : "photo-library-agent-state"}>
              <ShieldCheck size={13} />
              {statusLoading
                ? uiText("Checking local model")
                : status?.available
                  ? `${uiText("Offline")} · ${tier || uiText("Local model")}`
                  : uiText("Model setup required")}
            </span>
            <button
              type="button"
              className="icon-button compact"
              onClick={() => void refreshStatus()}
              disabled={statusLoading}
              title={uiText("Refresh agent status")}
              aria-label={uiText("Refresh agent status")}
            >
              <RefreshCw size={15} className={statusLoading ? "spin" : ""} />
            </button>
            {turns.length > 0 && (
              <button
                type="button"
                className="icon-button compact"
                onClick={() => {
                  setTurns([]);
                  setPlanResults({});
                  setError("");
                }}
                title={uiText("Clear conversation")}
                aria-label={uiText("Clear conversation")}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="photo-library-agent-body">
          {status && !status.available && (
            <div className="photo-library-agent-alert" role="status">
              <AlertTriangle size={16} />
              <span>{status.reason || uiText("Install a local vision model in Photos settings to use Ask Library.")}</span>
            </div>
          )}

          {turns.length > 0 && (
            <div className="photo-library-agent-thread" ref={threadRef} aria-live="polite">
              {turns.map((turn) => (
                <article key={turn.id} className={`photo-library-agent-turn ${turn.role}`}>
                  <span className="photo-library-agent-avatar" aria-hidden="true">
                    {turn.role === "assistant" ? <Bot size={15} /> : null}
                  </span>
                  <div className="photo-library-agent-message">
                    <p>{turn.text}</p>
                    {turn.response?.uncertainty && <small>{turn.response.uncertainty}</small>}
                    {turn.response && turn.response.citations.length > 0 && (
                      <div className="photo-library-agent-citations" aria-label={uiText("Cited library assets")}>
                        {turn.response.citations.map((citation) => (
                          <button
                            key={citation.assetId}
                            type="button"
                            onClick={() => onOpenCitation(citation)}
                            title={uiText("Find cited asset")}
                          >
                            <span>[{citation.citationId}]</span>
                            <strong>{citation.title}</strong>
                            {citation.captureDate && <small>{citation.captureDate}</small>}
                          </button>
                        ))}
                      </div>
                    )}
                    {turn.response && turn.response.pendingPlans.length > 0 && (
                      <div className="photo-library-agent-plans" aria-label={uiText("Actions awaiting confirmation")}>
                        {turn.response.pendingPlans.map((plan) => {
                          const executed = planResults[plan.planId];
                          const confirming = confirmingPlanId === plan.planId;
                          const executing = executingPlanId === plan.planId;
                          return (
                            <div key={plan.planId} className={plan.destructive ? "photo-library-agent-plan destructive" : "photo-library-agent-plan"}>
                              <div>
                                <strong>{actionLabel(plan.action)}</strong>
                                <small>
                                  {plan.destructive ? uiText("Destructive lane") : uiText("Write lane")}
                                  {plan.estimatedAffectedItems > 0
                                    ? ` · ${formatCount(plan.estimatedAffectedItems)} ${uiText("items")}`
                                    : ""}
                                </small>
                              </div>
                              {executed?.ok ? (
                                <span className="photo-library-agent-plan-complete"><Check size={15} /> {uiText("Completed")}</span>
                              ) : confirming ? (
                                <div className="photo-library-agent-confirm">
                                  <button
                                    type="button"
                                    className={plan.destructive ? "danger compact-action" : "primary compact-action"}
                                    onClick={() => void confirmPlan(plan)}
                                    disabled={executing}
                                  >
                                    {executing ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                                    <span>{plan.destructive ? uiText("Confirm destructive action") : uiText("Confirm action")}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-button compact"
                                    onClick={() => setConfirmingPlanId("")}
                                    disabled={executing}
                                    title={uiText("Cancel confirmation")}
                                    aria-label={uiText("Cancel confirmation")}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="ghost compact-action"
                                  onClick={() => setConfirmingPlanId(plan.planId)}
                                >
                                  <ShieldCheck size={14} />
                                  <span>{uiText("Review action")}</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {turn.response && turn.response.followUps.length > 0 && (
                      <div className="photo-library-agent-followups">
                        {turn.response.followUps.map((followUp) => (
                          <button key={followUp} type="button" onClick={() => useFollowUp(followUp)}>{followUp}</button>
                        ))}
                      </div>
                    )}
                    {turn.response && (
                      <button
                        type="button"
                        className="photo-library-agent-details-toggle"
                        onClick={() => setDetailsOpen((current) => ({ ...current, [turn.id]: !current[turn.id] }))}
                        aria-expanded={Boolean(detailsOpen[turn.id])}
                      >
                        {detailsOpen[turn.id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        <span>{uiText("Local tool activity")}</span>
                      </button>
                    )}
                    {turn.response && detailsOpen[turn.id] && (
                      <div className="photo-library-agent-trace">
                        {turn.response.toolTrace.map((trace) => (
                          <span key={`${turn.id}-${trace.index}`} className={trace.ok ? "ok" : "failed"}>
                            {trace.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                            {actionLabel(trace.tool)}
                          </span>
                        ))}
                        <small>
                          {formatCount(turn.response.grounding.validCitations)} {uiText("grounded citations")}
                          {` · ${Math.max(0, Math.round(turn.response.elapsedMs / 100) / 10)}s`}
                        </small>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="photo-library-agent-thinking" role="status">
                  <LoaderCircle size={16} className="spin" />
                  <span>{uiText("Planning with the local model")}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="photo-library-agent-alert error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form className="photo-library-agent-composer" onSubmit={(event) => void submit(event)}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={uiText("Ask about photos, people, places, dates, text, or captions")}
              aria-label={uiText("Ask Library question")}
              maxLength={2000}
              disabled={busy || status?.available === false}
            />
            <button
              type="submit"
              className="primary icon-button"
              disabled={!draft.trim() || busy || status?.available === false}
              title={uiText("Send question")}
              aria-label={uiText("Send question")}
            >
              {busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
