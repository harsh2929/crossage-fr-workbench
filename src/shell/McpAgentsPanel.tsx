import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import "./McpAgentsPanel.css";
import {
  Activity,
  Bot,
  ChevronRight,
  Copy as CopyIcon,
  Database,
  Download,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import agentPlatform from "../../mcp/agent-platform.json";
import type { McpConnectionInfo, McpHttpStatus } from "../types";
import { LocalSyncPanel } from "./LocalSyncPanel";
import { MobileCompanionPanel } from "./MobileCompanionPanel";

interface McpAgentsPanelProps {
  active: boolean;
  copyText(text: string, label?: string): void;
  uiText(source: string): string;
  variant?: "destination" | "settings";
}

interface AgentAuditEvent {
  seq?: number;
  at?: string;
  action?: string;
  agent_action?: string;
  status?: string;
  approval_state?: string;
  read_only?: boolean;
  destructive?: boolean;
  pixel_disclosure?: boolean;
  replayed?: boolean;
  error_code?: string;
  principal_id?: string;
  auth_type?: string;
}

interface AgentAuditResult {
  events: AgentAuditEvent[];
  total: number;
}

const capabilityIcons = [Search, Sparkles, ImageIcon, Download, Database, Users];

function localFolderLabel(value: string) {
  const normalized = String(value || "").trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).pop() || "Current workspace";
}

export function McpAgentsPanel({ active, copyText, uiText, variant = "destination" }: McpAgentsPanelProps) {
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionNote, setActionNote] = useState<{ tone: "ok" | "danger-text"; text: string } | null>(null);
  const [httpStatus, setHttpStatus] = useState<McpHttpStatus | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentAuditEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    window.crossAge.getMcpConnectionInfo()
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setHttpStatus(next.http);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    const unsubscribe = window.crossAge.onMcpHttpStatus((status) => setHttpStatus(status));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active]);

  async function loadAgentActivity() {
    setActivityLoading(true);
    setActivityError("");
    try {
      const result = await window.crossAge.invoke<AgentAuditResult>("audit_events", { limit: 200, offset: 0 });
      setAgentActivity(
        (result.events || []).filter((event) =>
          event.action === "agent_tool_result" || event.action === "agent_tool_failure"
        ),
      );
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : String(error));
    } finally {
      setActivityLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    void loadAgentActivity();
  }, [active]);

  const running = Boolean(httpStatus?.running);
  const activitySummary = {
    reads: agentActivity.filter((event) => event.read_only !== false).length,
    writes: agentActivity.filter((event) => event.read_only === false && !event.destructive).length,
    destructive: agentActivity.filter((event) => event.destructive).length,
    approvals: agentActivity.filter((event) => event.approval_state === "confirmed").length,
    needsAttention: agentActivity.filter((event) => event.approval_state === "required" || event.approval_state === "proposed").length,
    disclosures: agentActivity.filter((event) => event.pixel_disclosure).length,
  };

  function activitySubtitle(event: AgentAuditEvent) {
    return `${event.at ? new Date(event.at).toLocaleString() : uiText("Recent")}${event.principal_id ? ` · ${event.principal_id}` : ""}${event.auth_type ? ` (${event.auth_type})` : ""}${event.replayed ? ` · ${uiText("replayed safely")}` : ""}`;
  }

  async function runAction(
    key: string,
    fn: () => Promise<{ ok?: boolean; cancelled?: boolean; message?: string; error?: string; backupPath?: string }>,
    okText: string,
  ) {
    setBusyAction(key);
    setActionNote(null);
    try {
      const result = await fn();
      if (result?.cancelled) {
        return;
      }
      if (result?.ok) {
        setActionNote({ tone: "ok", text: result.backupPath ? `${okText} — ${uiText("Previous file backed up safely")}` : okText });
      } else {
        setActionNote({ tone: "danger-text", text: result?.message || result?.error || uiText("Action failed.") });
      }
    } catch (error) {
      setActionNote({ tone: "danger-text", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function toggleHttp() {
    setBusyAction("http");
    setActionNote(null);
    try {
      const status = running ? await window.crossAge.stopMcpHttpServer() : await window.crossAge.startMcpHttpServer();
      setHttpStatus(status);
    } catch (error) {
      setActionNote({ tone: "danger-text", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyAction("");
    }
  }

  function jumpToConnections() {
    document.getElementById("agent-connections")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loadError) {
    return (
      <section className="agent-platform-page">
        <div className="panel settings-panel">
          <div className="panel-title"><Bot size={18} /> {uiText("AI Agents")}</div>
          <p className="compact danger-text">{uiText("Could not load connection details:")} {loadError}</p>
        </div>
      </section>
    );
  }
  if (!info) {
    return (
      <section className="agent-platform-page">
        <div className="panel settings-panel">
          <div className="panel-title"><Bot size={18} /> {uiText("AI Agents")}</div>
          <p className="compact"><Loader2 className="spin" size={14} /> {uiText("Loading agent platform…")}</p>
        </div>
      </section>
    );
  }

  const preStyle: CSSProperties = {
    margin: "0.5rem 0 0",
    padding: "0.75rem",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "12px",
    lineHeight: 1.5,
    whiteSpace: "pre",
    overflowX: "auto",
    maxWidth: "100%",
  };

  const configCards = [
    { key: "claudeCode", title: "Claude Code", hint: "Save as .mcp.json in your project, or run claude mcp add.", config: info.configs.claudeCode },
    { key: "claudeDesktop", title: "Claude Desktop", hint: "Paste under Developer settings, or use the one-click bundle.", config: info.configs.claudeDesktop },
    { key: "codex", title: "Codex", hint: "Add to ~/.codex/config.toml, or use Add to Codex.", config: info.configs.codex },
  ];

  return (
    <section className={`agent-platform-page agent-platform-page-${variant}`} aria-label={uiText(variant === "settings" ? "AI agent settings" : "AI agent platform")}>
      {variant === "destination" && (<>
      <header className="panel agent-platform-hero">
        <div className="agent-platform-hero-copy">
          <div className="agent-hero-readiness" role="status" aria-live="polite">
            <span className="agent-hero-readiness-icon"><Terminal size={17} /></span>
            <span>
              <strong>{uiText("Local agent access is ready")}</strong>
              <small>{running ? uiText("MCP and API server running") : uiText("Connect a desktop agent now, or start the local API server below")}</small>
            </span>
            <i className={running ? "online" : "ready"} aria-hidden="true" />
          </div>
          <span className="section-kicker"><Sparkles size={14} /> {uiText("Connect an AI agent")}</span>
          <h1>{uiText("Your entire image library, ready for AI agents.")}</h1>
          <p>{uiText("Connect Codex, Claude, or any MCP-compatible client to find, understand, organize, edit, export, and maintain images at library scale—without handing an agent unrestricted file access.")}</p>
          <div className="button-row wrap agent-hero-actions">
            <button className="primary" onClick={() => void runAction("codex", () => window.crossAge.addMcpToCodex(), uiText("Added Vintrace to Codex"))} disabled={busyAction !== ""}>
              {busyAction === "codex" ? <Loader2 className="spin" size={16} /> : <Terminal size={16} />} {uiText("Add to Codex")}
            </button>
            <button className="secondary" onClick={jumpToConnections} type="button">
              <Terminal size={16} /> {uiText("See every connection option")}
            </button>
          </div>
          <div className="agent-client-chips" aria-label={uiText("Supported agent clients")}>
            {['Codex', 'Claude Code', 'Claude Desktop', 'MCP', 'REST API'].map((client) => <span key={client}>{client}</span>)}
          </div>
          {actionNote && <p className={`compact agent-action-note ${actionNote.tone === "danger-text" ? "danger-text" : "ok"}`}>{actionNote.text}</p>}
        </div>
      </header>

      <details className="agent-learn-more">
        <summary><Sparkles size={16} /><span>{uiText("Explore capabilities and built-in workflows")}</span><ChevronRight size={16} aria-hidden="true" /></summary>
        <div className="agent-learn-more-body">
      <div className="agent-platform-stats" aria-label={uiText("Agent platform coverage")}>
        <div><strong>{agentPlatform.counts.imageActions}</strong><span>{uiText("Image actions")}</span></div>
        <div><strong>{agentPlatform.counts.mcpTools}</strong><span>{uiText("MCP tools")}</span></div>
        <div><strong>{agentPlatform.counts.apiOperations}</strong><span>{uiText("API operations")}</span></div>
        <div><strong>{agentPlatform.counts.builtInRecipes}</strong><span>{uiText("Built-in recipes")}</span></div>
      </div>
      <div className="agent-how-it-works" aria-label={uiText("How agent workflows work")}>
        <div><span>1</span><strong>{uiText("Connect")}</strong><small>{uiText("Use a one-click setup or copy a standard MCP configuration.")}</small></div>
        <ChevronRight size={18} aria-hidden="true" />
        <div><span>2</span><strong>{uiText("Ask naturally")}</strong><small>{uiText("Describe the visual result you want instead of browsing folders and menus.")}</small></div>
        <ChevronRight size={18} aria-hidden="true" />
        <div><span>3</span><strong>{uiText("Review and approve")}</strong><small>{uiText("Preview finalists, inspect the plan, and explicitly approve every mutation.")}</small></div>
      </div>

      <section className="agent-platform-section" aria-labelledby="agent-unlocks-title">
        <div className="agent-section-heading">
          <div><span className="section-kicker">{uiText("What this unlocks")}</span><h2 id="agent-unlocks-title">{uiText("From a visual question to a reviewed deliverable")}</h2></div>
          <p>{uiText("The agent works through stable asset IDs and bounded tools while Vintrace remains the visual system of record.")}</p>
        </div>
        <div className="agent-capability-grid">
          {agentPlatform.capabilityGroups.map((group, index) => {
            const Icon = capabilityIcons[index] || Sparkles;
            return (
              <article className="panel agent-capability-card" key={group.id}>
                <span className={`agent-capability-icon tone-${index + 1}`}><Icon size={20} /></span>
                <h3>{uiText(group.title)}</h3>
                <p>{uiText(group.description)}</p>
                <ul>{group.examples.map((example) => <li key={example}>{uiText(example)}</li>)}</ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel agent-recipes-panel" aria-labelledby="agent-recipes-title">
        <div className="agent-section-heading compact-heading">
          <div><span className="section-kicker">{uiText("Reusable workflows")}</span><h2 id="agent-recipes-title">{uiText("Eight built-in recipes make complex work repeatable")}</h2></div>
          <p>{uiText("Recipes produce an ordered plan and stop at preview, write, destructive, or operator approval points. Planning never executes the workflow.")}</p>
        </div>
        <div className="agent-recipe-grid">
          {agentPlatform.recipes.map((recipe) => (
            <article className="agent-recipe-card" key={recipe.id}>
              <span><Sparkles size={15} /><em>{uiText(recipe.approval)}</em></span>
              <strong>{uiText(recipe.name)}</strong>
              <p>{uiText(recipe.description)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="agent-platform-section" aria-labelledby="agent-foundations-title">
        <div className="agent-section-heading">
          <div><span className="section-kicker">{uiText("Platform foundations")}</span><h2 id="agent-foundations-title">{uiText("A complete agent platform, not a thin connector")}</h2></div>
          <p>{uiText("The same contract serves local coding agents, visual MCP hosts, direct API clients, and controlled enterprise automation.")}</p>
        </div>
        <div className="agent-foundation-grid">
          {agentPlatform.platformFeatures.map((feature, index) => {
            const Icon = [Terminal, Eye, Activity, ShieldCheck][index] || Wrench;
            return (
              <article className="panel agent-foundation-card" key={feature.id}>
                <Icon size={19} />
                <span><strong>{uiText(feature.title)}</strong><small>{uiText(feature.description)}</small></span>
              </article>
            );
          })}
        </div>
      </section>
        </div>
      </details>
      </>)}

      <section className="agent-platform-section" id="agent-connections" aria-labelledby="agent-connections-title">
        <div className="agent-section-heading">
          <div><span className="section-kicker">{uiText("Connect your agent")}</span><h2 id="agent-connections-title">{uiText("Start locally in a few clicks")}</h2></div>
          <p>{uiText("Most desktop clients use stdio. Streamable HTTP and the OpenAPI endpoint are available for SDKs and private-network deployments.")}</p>
        </div>
        <div className="agent-connection-grid">
          <article className="panel agent-connection-card featured">
            <span className="agent-connection-logo"><Bot size={22} /></span>
            <div><strong>Codex</strong><small>{uiText("One-click local MCP setup")}</small></div>
            <button className="primary compact-action" onClick={() => void runAction("codex", () => window.crossAge.addMcpToCodex(), uiText("Added Vintrace to Codex"))} disabled={busyAction !== ""}>
              {busyAction === "codex" ? <Loader2 className="spin" size={14} /> : <Terminal size={14} />} {uiText("Add to Codex")}
            </button>
          </article>
          <article className="panel agent-connection-card">
            <span className="agent-connection-logo"><Sparkles size={22} /></span>
            <div><strong>Claude Desktop</strong><small>{info.bundlePath ? uiText("Desktop bundle ready") : uiText("Build the one-click desktop bundle")}</small></div>
            <button className="secondary compact-action" onClick={() => void runAction("bundle", () => window.crossAge.revealOrBuildMcpBundle(), uiText("Claude Desktop bundle ready"))} disabled={busyAction !== ""}>
              {busyAction === "bundle" ? <Loader2 className="spin" size={14} /> : <Download size={14} />} {info.bundlePath ? uiText("Reveal bundle") : uiText("Build bundle")}
            </button>
          </article>
          <article className="panel agent-connection-card">
            <span className="agent-connection-logo"><Terminal size={22} /></span>
            <div><strong>Claude Code</strong><small>{uiText("Project-scoped MCP configuration")}</small></div>
            <button className="secondary compact-action" onClick={() => copyText(info.configs.claudeCode, uiText("Claude Code config"))}>
              <CopyIcon size={14} /> {uiText("Copy config")}
            </button>
          </article>
          <article className="panel agent-connection-card">
            <span className="agent-connection-logo"><Wrench size={22} /></span>
            <div><strong>{uiText("MCP and API clients")}</strong><small>{running ? uiText("Local server is running") : uiText("Start the authenticated local server")}</small></div>
            <button className="secondary compact-action" onClick={() => void toggleHttp()} disabled={busyAction === "http"}>
              {busyAction === "http" ? <Loader2 className="spin" size={14} /> : running ? <Pause size={14} /> : <Play size={14} />} {busyAction === "http" ? uiText(running ? "Stopping…" : "Starting…") : running ? uiText("Stop server") : uiText("Start server")}
            </button>
          </article>
        </div>
        <div className="agent-runtime-strip">
          <span role="status" aria-live="polite" aria-atomic="true"><i className={running ? "online" : ""} /> <strong>{uiText("Local HTTP")}</strong> {running ? uiText("Running") : uiText("Stopped")}</span>
          <span><strong>{uiText("Workspace")}</strong> <span title={localFolderLabel(info.workspace)}>{localFolderLabel(info.workspace)}</span></span>
          <span><strong>{uiText("Backend")}</strong> {info.mode === "packaged" ? uiText("Bundled app sidecar") : uiText("Source checkout")}</span>
          {running && httpStatus?.url && <button className="ghost compact-action" onClick={() => copyText(httpStatus.url, uiText("MCP HTTP URL"))}><CopyIcon size={14} /> {uiText("Copy MCP URL")}</button>}
        </div>
        {running && httpStatus?.token && (
          <div className="panel agent-api-details">
            <div><span>{uiText("MCP URL")}</span><code title={httpStatus.url}>{httpStatus.url}</code><button className="ghost compact-action" onClick={() => copyText(httpStatus.url, uiText("MCP URL"))}><CopyIcon size={13} /> {uiText("Copy")}</button></div>
            <div><span>{uiText("Agent API")}</span><code title={info.agentApiUrl}>{info.agentApiUrl}</code><button className="ghost compact-action" onClick={() => copyText(info.agentApiUrl, uiText("Agent API URL"))}><CopyIcon size={13} /> {uiText("Copy")}</button></div>
            <div><span>OpenAPI</span><code title={`${info.agentApiUrl}/openapi.json`}>{info.agentApiUrl}/openapi.json</code><button className="ghost compact-action" onClick={() => copyText(`${info.agentApiUrl}/openapi.json`, uiText("Agent OpenAPI URL"))}><CopyIcon size={13} /> {uiText("Copy")}</button></div>
            <div><span>{uiText("Bearer token")}</span><code>••••••••••••••••</code><button className="ghost compact-action" onClick={() => copyText(httpStatus.token, uiText("MCP auth token"))}><CopyIcon size={13} /> {uiText("Copy token")}</button></div>
          </div>
        )}
        {httpStatus?.error && <p className="compact danger-text" role="alert">{httpStatus.error}</p>}
        {actionNote && variant === "settings" && <p className={`compact agent-action-note ${actionNote.tone === "danger-text" ? "danger-text" : "ok"}`}>{actionNote.text}</p>}
      </section>

      <LocalSyncPanel active={active} copyText={copyText} uiText={uiText} />

      <MobileCompanionPanel active={active} copyText={copyText} uiText={uiText} />

      <section className="panel agent-activity-panel">
        <div className="panel-title agent-activity-title">
          <span><Activity size={18} /> {uiText("Agent activity and approvals")}</span>
          <button className="ghost compact-action" onClick={() => void loadAgentActivity()} disabled={activityLoading}>
            <RefreshCw className={activityLoading ? "spin" : ""} size={14} /> {uiText("Refresh")}
          </button>
        </div>
        <p className="compact">{uiText("A path-free view of requests, confirmations, failures, safe retries, and pixel disclosures across stdio MCP and authenticated HTTP.")}</p>
        <div className="settings-summary agent-activity-summary" aria-label={uiText("Agent activity summary")}>
          <div><strong>{activitySummary.reads}</strong><span>{uiText("Read calls")}</span></div>
          <div><strong>{activitySummary.writes}</strong><span>{uiText("Write calls")}</span></div>
          <div><strong>{activitySummary.destructive}</strong><span>{uiText("Destructive")}</span></div>
          <div><strong>{activitySummary.approvals}</strong><span>{uiText("Confirmed")}</span></div>
          <div><strong>{activitySummary.needsAttention}</strong><span>{uiText("Needs attention")}</span></div>
          <div><strong>{activitySummary.disclosures}</strong><span>{uiText("Pixel disclosures")}</span></div>
        </div>
        {activityError ? (
          <p className="compact danger-text">{uiText("Could not load agent activity:")} {activityError}</p>
        ) : activityLoading && agentActivity.length === 0 ? (
          <p className="compact muted"><Loader2 className="spin" size={14} /> {uiText("Loading agent activity…")}</p>
        ) : agentActivity.length === 0 ? (
          <div className="agent-activity-empty"><Bot size={22} /><span><strong>{uiText("No agent calls yet")}</strong><small>{uiText("Connect a client above, then activity and approval decisions will appear here.")}</small></span></div>
        ) : (
          <div className="agent-activity-list" aria-label={uiText("Recent agent activity")}>
            {agentActivity.slice(0, 8).map((event, index) => {
              const state = event.status === "failed"
                ? event.error_code === "confirmation_required" ? "required" : "failed"
                : event.approval_state || "complete";
              return (
                <div className="agent-activity-row" key={`${event.seq || index}-${event.agent_action || "agent"}`}>
                  <span>
                    <strong title={event.agent_action || uiText("Agent request")}>{event.agent_action || uiText("Agent request")}</strong>
                    <small title={activitySubtitle(event)}>{activitySubtitle(event)}</small>
                  </span>
                  <span className={`status-pill ${event.status === "failed" || state === "required" ? "weak" : state === "confirmed" ? "strong" : ""}`}>{uiText(state.replaceAll("_", " "))}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {variant === "destination" && <section className="panel agent-trust-panel" aria-labelledby="agent-trust-title">
        <div className="agent-section-heading compact-heading">
          <div><span className="section-kicker">{uiText("Trust is part of the workflow")}</span><h2 id="agent-trust-title">{uiText("Powerful without handing over the keys")}</h2></div>
          <p>{uiText("The same safety and execution policy applies whether the request comes from Codex, Claude, MCP, or the direct API.")}</p>
        </div>
        <div className="agent-trust-grid">
          <div><ShieldCheck size={18} /><span><strong>{uiText("Approval-aware writes")}</strong><small>{uiText("Every mutation is planned, confirmed, and deduplicated before execution.")}</small></span></div>
          <div><Eye size={18} /><span><strong>{uiText("Bounded pixel access")}</strong><small>{uiText("Search is path-free; previews are selected, capped, Safe Mode checked, and audited.")}</small></span></div>
          <div><Database size={18} /><span><strong>{uiText("Stable asset IDs")}</strong><small>{uiText("Agents work with durable IDs instead of receiving broad filesystem access.")}</small></span></div>
          <div><Users size={18} /><span><strong>{uiText("Human identity authority")}</strong><small>{uiText("Consent and identity decisions stay with the operator, never the model.")}</small></span></div>
        </div>
      </section>}

      <section className="agent-advanced-section" aria-label={uiText("Advanced agent configuration")}>
        <div className="agent-section-heading">
          <div><span className="section-kicker">{uiText("Advanced setup")}</span><h2>{uiText("Copy configuration or inspect endpoints")}</h2></div>
          <button className="ghost compact-action" onClick={() => void runAction("configs", () => window.crossAge.revealMcpConfigs(), uiText("Opened the example configs"))} disabled={busyAction !== ""}>
            <FolderOpen size={14} /> {uiText("Reveal example configs")}
          </button>
        </div>
        {configCards.map((card) => (
          <details className="panel settings-panel mcp-config-card" key={card.key}>
            <summary tabIndex={0}><span><strong>{card.title}</strong><small title={uiText(card.hint)}>{uiText(card.hint)}</small></span><ChevronRight size={15} aria-hidden="true" /></summary>
            <div className="mcp-config-card-body">
              <pre style={preStyle} aria-label={`${card.title} MCP config`} data-no-localize>{card.config}</pre>
              <div className="button-row"><button className="ghost compact-action" onClick={() => copyText(card.config, `${card.title} config`)}><CopyIcon size={14} /> {uiText("Copy config")}</button></div>
            </div>
          </details>
        ))}
      </section>
    </section>
  );
}
