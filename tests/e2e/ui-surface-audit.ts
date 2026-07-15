import type { Page } from "@playwright/test";

export type UiSurfaceIssue = {
  kind: "unnamed" | "positive-tabindex" | "small-target" | "horizontal-overflow" | "clipped-control" | "unexplained-ellipsis";
  tag: string;
  text: string;
  className: string;
  width?: number;
  height?: number;
  scrollWidth?: number;
  scrollHeight?: number;
};

export async function visibleSurfaceIssues(page: Page): Promise<UiSurfaceIssue[]> {
  return page.evaluate(() => {
    const issues: UiSurfaceIssue[] = [];
    const intersectsViewport = (rect: DOMRect) => (
      rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth
    );
    const controls = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], input, select, textarea, summary"));
    for (const node of controls) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      if (rect.width <= 0 || rect.height <= 0 || !intersectsViewport(rect) || style.visibility === "hidden" || style.display === "none") continue;
      if (node.closest("[aria-hidden='true']")) continue;
      const input = node as HTMLInputElement;
      const explicitLabel = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || "" : "";
      const wrapper = node.closest("label");
      const wrapperLabel = wrapper?.getAttribute("aria-label") || wrapper?.textContent || "";
      const labelledBy = (node.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const name = (node.getAttribute("aria-label") || labelledBy || node.textContent || node.getAttribute("title") || input.placeholder || explicitLabel || wrapperLabel)
        .replace(/\s+/g, " ")
        .trim();
      const snapshot = { tag: node.tagName, text: name.slice(0, 100), className: node.className?.toString() || "" };
      if (!name) issues.push({ kind: "unnamed", ...snapshot });
      if (node.tabIndex > 0) issues.push({ kind: "positive-tabindex", ...snapshot });
      if (node.matches("button, [role='button'], summary") && !input.disabled && (rect.width < 28 || rect.height < 28)) {
        issues.push({ kind: "small-target", ...snapshot, width: Math.round(rect.width), height: Math.round(rect.height) });
      }
      if (
        !node.closest("[data-allow-overflow]")
        && (node.scrollWidth > Math.ceil(node.clientWidth) + 2 || node.scrollHeight > Math.ceil(node.clientHeight) + 2)
      ) {
        issues.push({
          kind: "clipped-control",
          ...snapshot,
          width: node.clientWidth,
          height: node.clientHeight,
          scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight,
        });
      }
    }
    const ellipsisNodes = Array.from(document.querySelectorAll<HTMLElement>("*"));
    for (const node of ellipsisNodes) {
      const style = window.getComputedStyle(node);
      if (style.textOverflow !== "ellipsis" || style.overflowX === "visible") continue;
      if (node.scrollWidth <= Math.ceil(node.clientWidth) + 2) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || !intersectsViewport(rect) || style.visibility === "hidden" || style.display === "none") continue;
      if (node.closest("[aria-hidden='true']")) continue;
      const hasDirectText = Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && Boolean(child.textContent?.trim()));
      if (!hasDirectText) continue;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const explainingNode = node.closest<HTMLElement>("[title], [aria-label], [aria-describedby]");
      const explanation = explainingNode?.getAttribute("title") || explainingNode?.getAttribute("aria-label") || explainingNode?.getAttribute("aria-describedby") || "";
      if (explanation.trim()) continue;
      issues.push({
        kind: "unexplained-ellipsis",
        tag: node.tagName,
        text: text.slice(0, 100),
        className: node.className?.toString() || "",
        width: node.clientWidth,
        height: node.clientHeight,
        scrollWidth: node.scrollWidth,
        scrollHeight: node.scrollHeight,
      });
    }
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (workspace && workspace.scrollWidth > workspace.clientWidth + 2) {
      issues.push({
        kind: "horizontal-overflow",
        tag: "WORKSPACE",
        text: "",
        className: "workspace",
        width: workspace.clientWidth,
        height: workspace.clientHeight,
        scrollWidth: workspace.scrollWidth,
        scrollHeight: workspace.scrollHeight,
      });
    }
    return issues;
  });
}
