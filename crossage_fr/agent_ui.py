from __future__ import annotations

from crossage_fr.agent_ui_bridge import IMAGE_REVIEW_BRIDGE_SCRIPT


IMAGE_REVIEW_RESOURCE_URI = "ui://vintrace/image-review-v1.html"
MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"


IMAGE_REVIEW_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Vintrace image review</title>
  <style>
    :root { color-scheme: light dark; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--color-text, CanvasText); background: transparent; }
    main { padding: 14px; }
    header, .actions, .card-head, .meta { display: flex; align-items: center; gap: 10px; }
    header { justify-content: space-between; margin-bottom: 12px; }
    h1 { margin: 0; font-size: 16px; }
    .muted { color: color-mix(in srgb, currentColor 62%, transparent); }
    .actions { flex-wrap: wrap; margin: 10px 0; }
    button { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 9px; padding: 7px 10px; background: color-mix(in srgb, Canvas 88%, currentColor 12%); color: inherit; cursor: pointer; }
    button:hover { border-color: color-mix(in srgb, currentColor 52%, transparent); }
    button:disabled { cursor: wait; opacity: .55; }
    #grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .card { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 12px; padding: 10px; background: color-mix(in srgb, Canvas 95%, currentColor 5%); }
    .card.selected { outline: 2px solid #6d8cff; outline-offset: -2px; }
    .card-head { align-items: flex-start; }
    .card-head label { min-width: 0; flex: 1; }
    .title { display: block; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .asset-id { display: block; font: 11px/1.35 ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { flex-wrap: wrap; font-size: 12px; margin: 8px 0; }
    .pill { border-radius: 999px; padding: 2px 7px; background: color-mix(in srgb, #6d8cff 18%, transparent); }
    .preview { width: 100%; max-height: 240px; object-fit: contain; margin-top: 8px; border-radius: 8px; background: color-mix(in srgb, Canvas 82%, currentColor 18%); }
    .reason { margin: 6px 0 0; font-size: 12px; }
    #empty { padding: 18px; text-align: center; border: 1px dashed color-mix(in srgb, currentColor 24%, transparent); border-radius: 12px; }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Vintrace image review</h1>
      <div id="summary" class="muted">Waiting for search results…</div>
    </div>
    <span class="pill">Path-free</span>
  </header>
  <div class="actions">
    <button id="select-all" type="button">Select all shown</button>
    <button id="clear" type="button">Clear</button>
    <button id="continue" type="button">Continue with selection</button>
  </div>
  <div id="grid" aria-live="polite"></div>
  <div id="empty" hidden>No bounded image results were returned.</div>
</main>
<script>__VINTRACE_MCP_APP_BRIDGE__</script>
<script>
(() => {
  const selected = new Set((window.openai?.widgetState?.selectedAssetIds || []).map(String));
  const previews = new Map();
  const busy = new Set();
  let lastOutput = null;

  const output = () => window.openai?.toolOutput || null;
  const items = () => {
    const value = output();
    return Array.isArray(value?.data?.items) ? value.data.items.slice(0, 100) : [];
  };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const save = () => window.openai?.setWidgetState?.({ selectedAssetIds: [...selected] });

  async function preview(assetId) {
    if (!window.openai?.callTool || busy.has(assetId)) return;
    busy.add(assetId); render();
    try {
      const result = await window.openai.callTool("get_image_preview", { asset_id: assetId, max_dimension: 1024, max_bytes: 2097152 });
      const link = (result?.content || []).find((entry) => entry?.type === "resource_link" && entry?.uri);
      const reader = window.openai?.readServerResource || window.openai?.readResource;
      if (link && reader) {
        const resource = await reader.call(window.openai, { uri: link.uri });
        const content = (resource?.contents || []).find((entry) => entry?.blob);
        if (content) previews.set(assetId, `data:${content.mimeType || link.mimeType || "image/jpeg"};base64,${content.blob}`);
      }
    } finally {
      busy.delete(assetId); render();
    }
  }

  function render() {
    const rows = items();
    const value = output();
    const signature = JSON.stringify([value?.requestId, rows.map((row) => row?.assetId)]);
    if (signature !== lastOutput) lastOutput = signature;
    document.getElementById("summary").textContent = `${rows.length} shown · ${selected.size} selected · previews require host approval`;
    document.getElementById("empty").hidden = rows.length > 0;
    document.getElementById("grid").innerHTML = rows.map((row) => {
      const assetId = String(row?.assetId || "");
      const active = selected.has(assetId);
      const reasons = Array.isArray(row?.matchReasons) ? row.matchReasons.slice(0, 2).join(" · ") : "";
      const dimensions = row?.width && row?.height ? `${row.width}×${row.height}` : "";
      const date = row?.captureDate ? String(row.captureDate).slice(0, 10) : "";
      const previewUrl = previews.get(assetId);
      return `<article class="card${active ? " selected" : ""}" data-id="${escape(assetId)}">
        <div class="card-head">
          <input class="select" type="checkbox" ${active ? "checked" : ""} aria-label="Select ${escape(row?.title || assetId)}" />
          <label><span class="title">${escape(row?.title || "Untitled asset")}</span><span class="asset-id muted">${escape(assetId)}</span></label>
        </div>
        <div class="meta">${dimensions ? `<span>${escape(dimensions)}</span>` : ""}${date ? `<span>${escape(date)}</span>` : ""}${row?.favorite ? '<span class="pill">Favorite</span>' : ""}</div>
        ${reasons ? `<p class="reason muted">${escape(reasons)}</p>` : ""}
        <button class="preview-button" type="button" ${busy.has(assetId) ? "disabled" : ""}>${busy.has(assetId) ? "Requesting…" : previewUrl ? "Refresh preview" : "Request preview"}</button>
        ${previewUrl ? `<img class="preview" src="${previewUrl}" alt="Policy-approved preview for selected asset" />` : ""}
      </article>`;
    }).join("");
    document.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      card.querySelector(".select")?.addEventListener("change", (event) => {
        if (event.target.checked) selected.add(id); else selected.delete(id);
        save(); render();
      });
      card.querySelector(".preview-button")?.addEventListener("click", () => preview(id));
    });
    window.openai?.notifyIntrinsicHeight?.();
  }

  document.getElementById("select-all").addEventListener("click", () => { items().forEach((row) => row?.assetId && selected.add(String(row.assetId))); save(); render(); });
  document.getElementById("clear").addEventListener("click", () => { selected.clear(); save(); render(); });
  document.getElementById("continue").addEventListener("click", () => {
    const ids = [...selected];
    if (!ids.length) return;
    window.openai?.sendFollowUpMessage?.({ prompt: `Continue the image workflow using only these reviewed stable asset IDs: ${ids.join(", ")}. Plan any mutation before asking for approval.` });
  });
  window.addEventListener("openai:set_globals", render);
  render();
})();
</script>
</body>
</html>"""

IMAGE_REVIEW_HTML = IMAGE_REVIEW_HTML.replace("__VINTRACE_MCP_APP_BRIDGE__", IMAGE_REVIEW_BRIDGE_SCRIPT)
