import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Check, Copy as CopyIcon, Download, FolderOpen, Loader2, Pause, Play, ShieldCheck, Users } from "lucide-react";
import type { McpConnectionInfo, McpHttpStatus } from "../types";

interface McpAgentsPanelProps {
  copyText(text: string, label?: string): void;
}

export function McpAgentsPanel({ copyText }: McpAgentsPanelProps) {
  const [info, setInfo] = useState<McpConnectionInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionNote, setActionNote] = useState<{ tone: "ok" | "danger-text"; text: string } | null>(null);
  const [httpStatus, setHttpStatus] = useState<McpHttpStatus | null>(null);

  useEffect(() => {
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
  }, []);

  const running = Boolean(httpStatus?.running);

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
        // User dismissed the confirmation; leave the panel quiet.
      } else if (result?.ok) {
        setActionNote({ tone: "ok", text: result.backupPath ? `${okText} — previous file backed up to ${result.backupPath}` : okText });
      } else {
        setActionNote({ tone: "danger-text", text: result?.message || result?.error || "Action failed." });
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
      if (status.error) setActionNote({ tone: "danger-text", text: status.error });
    } catch (error) {
      setActionNote({ tone: "danger-text", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyAction("");
    }
  }

  if (loadError) {
    return (
      <div className="panel settings-panel">
        <div className="panel-title"><Users size={18} /> AI Agents (MCP)</div>
        <p className="compact danger-text">Could not load connection details: {loadError}</p>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="panel settings-panel">
        <div className="panel-title"><Users size={18} /> AI Agents (MCP)</div>
        <p className="compact"><Loader2 className="spin" size={14} /> Loading connection details...</p>
      </div>
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

  const cards = [
    { key: "claudeCode", title: "Claude Code", hint: "Save as .mcp.json in your project, or run: claude mcp add.", config: info.configs.claudeCode },
    { key: "claudeDesktop", title: "Claude Desktop", hint: "Paste under Developer settings, or use the one-click bundle below.", config: info.configs.claudeDesktop },
    { key: "codex", title: "Codex", hint: "Add to ~/.codex/config.toml, or use \"Add to Codex\" below.", config: info.configs.codex },
  ];

  return (
    <>
      <div className="panel settings-panel">
        <div className="panel-title"><Users size={18} /> AI Agents (MCP)</div>
        <p className="compact">
          Connect Claude Code, Claude Desktop, Codex, or any MCP-compatible agent to this workspace. Agents can
          enroll references, scan, and review — every action is consent-gated and review-first, and destructive
          operations require an explicit confirmation. Nothing runs until you add one of these configs to your agent.
        </p>
        <dl className="mini-list">
          <dt>Workspace</dt><dd title={info.workspace}>{info.workspace}</dd>
          <dt>Backend</dt><dd>{info.mode === "packaged" ? "Bundled app sidecar" : "Source checkout (.venv)"}</dd>
        </dl>
        <div className="button-row wrap">
          <button className="ghost compact-action" onClick={() => void runAction("codex", () => window.crossAge.addMcpToCodex(), "Added Vintrace to Codex")} disabled={busyAction !== ""}>
            {busyAction === "codex" ? <Loader2 className="spin" size={14} /> : <Check size={14} />} Add to Codex
          </button>
          <button className="ghost compact-action" onClick={() => void runAction("bundle", () => window.crossAge.revealOrBuildMcpBundle(), "Claude Desktop bundle ready")} disabled={busyAction !== ""}>
            {busyAction === "bundle" ? <Loader2 className="spin" size={14} /> : <Download size={14} />} {info.bundlePath ? "Reveal Claude Desktop bundle" : "Build Claude Desktop bundle"}
          </button>
          <button className="ghost compact-action" onClick={() => void runAction("configs", () => window.crossAge.revealMcpConfigs(), "Opened the example configs")} disabled={busyAction !== ""}>
            <FolderOpen size={14} /> Reveal example configs
          </button>
        </div>
        {actionNote && <p className={`compact ${actionNote.tone === "danger-text" ? "danger-text" : "ok"}`}>{actionNote.text}</p>}
      </div>

      {cards.map((card) => (
        <div className="panel settings-panel" key={card.key}>
          <div className="panel-title">{card.title}</div>
          <p className="compact">{card.hint}</p>
          <pre style={preStyle} aria-label={`${card.title} MCP config`}>{card.config}</pre>
          <div className="button-row">
            <button className="ghost compact-action" onClick={() => copyText(card.config, `${card.title} config`)}>
              <CopyIcon size={14} /> Copy config
            </button>
          </div>
        </div>
      ))}

      <div className="panel settings-panel">
        <div className="panel-title"><Play size={18} /> Local HTTP server</div>
        <p className="compact">
          Optional — for agent-SDK / HTTP clients. Runs the MCP server over localhost HTTP, bound to 127.0.0.1 and
          never exposed off this machine. It requires a per-session Bearer token (shown below when running); most
          desktop agents use the stdio configs above instead.
        </p>
        <div className="button-row wrap center">
          <button className="ghost compact-action" onClick={() => void toggleHttp()} disabled={busyAction === "http"}>
            {busyAction === "http" ? <Loader2 className="spin" size={14} /> : running ? <Pause size={14} /> : <Play size={14} />} {running ? "Stop server" : "Start server"}
          </button>
          <span className={`status-pill ${running ? "strong" : "weak"}`}>{running ? "Running" : "Stopped"}</span>
          {running && httpStatus?.url && (
            <button className="ghost compact-action" onClick={() => copyText(httpStatus.url, "MCP HTTP URL")}>
              <CopyIcon size={14} /> Copy {httpStatus.url}
            </button>
          )}
        </div>
        {running && httpStatus?.token && (
          <dl className="mini-list">
            <dt>URL</dt><dd>{httpStatus.url}</dd>
            <dt>Auth</dt>
            <dd>
              Bearer token —{" "}
              <button className="ghost compact-action" onClick={() => copyText(httpStatus.token, "MCP auth token")}>
                <CopyIcon size={14} /> Copy token
              </button>
              <span className="compact muted"> Send header: Authorization: Bearer &lt;token&gt;</span>
            </dd>
          </dl>
        )}
        {httpStatus?.error && <p className="compact danger-text">{httpStatus.error}</p>}
      </div>

      <div className="panel settings-panel">
        <div className="panel-title"><ShieldCheck size={18} /> Safety</div>
        <p className="compact">
          Enrollment and scanning stay consent-gated, protected media is excluded from agent responses, and
          destructive review or delete actions require the agent to pass an explicit confirmation. See the agent
          guide resource (vintrace://agent-guide) for the full policy.
        </p>
      </div>
    </>
  );
}
