import { Bot, ChevronRight, ShieldCheck, X } from "lucide-react";

interface AgentDiscoveryBannerProps {
  onExplore(): void;
  onDismiss(): void;
  uiText(source: string): string;
}

export function AgentDiscoveryBanner({ onExplore, onDismiss, uiText }: AgentDiscoveryBannerProps) {
  return (
    <aside className="agent-discovery-banner" aria-label={uiText("New AI agent platform")}>
      <span className="agent-discovery-icon" aria-hidden="true"><Bot size={20} /></span>
      <span className="agent-discovery-copy">
        <strong>{uiText("Your image library now works with AI agents")}</strong>
        <small>{uiText("Connect Codex, Claude, or any MCP client to search, organize, edit, export, and maintain images with review-first safeguards.")}</small>
      </span>
      <span className="agent-discovery-trust"><ShieldCheck size={14} /> {uiText("Local, bounded, approval-aware")}</span>
      <button type="button" className="primary compact-action" onClick={onExplore}>
        <span>{uiText("Explore AI Agents")}</span><ChevronRight size={15} />
      </button>
      <button type="button" className="icon-button agent-discovery-dismiss" onClick={onDismiss} aria-label={uiText("Dismiss AI agent announcement")}>
        <X size={15} />
      </button>
    </aside>
  );
}
