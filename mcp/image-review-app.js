import { App } from "@modelcontextprotocol/ext-apps";

(() => {
  const existing = window.openai;
  if (existing && (typeof existing.callTool === "function" || existing.toolOutput !== undefined)) {
    document.documentElement.dataset.vintraceHostBridge = "chatgpt";
    return;
  }

  const app = new App(
    { name: "Vintrace image review", version: "1.0.0" },
    {},
    { autoResize: true, strict: true },
  );
  const state = {
    connected: false,
    toolOutput: null,
    widgetState: { selectedAssetIds: [] },
  };

  const notifyGlobals = () => window.dispatchEvent(new Event("openai:set_globals"));
  const selectedAssetIds = (value) =>
    Array.isArray(value?.selectedAssetIds) ? value.selectedAssetIds.map(String).slice(0, 100) : [];

  const bridge = {
    get toolOutput() {
      return state.toolOutput;
    },
    get widgetState() {
      return state.widgetState;
    },
    async callTool(name, args) {
      if (!state.connected) throw new Error("MCP Apps host bridge is not connected.");
      return app.callServerTool({ name, arguments: args || {} });
    },
    async readServerResource(params) {
      if (!state.connected) throw new Error("MCP Apps host bridge is not connected.");
      return app.readServerResource(params);
    },
    async readResource(params) {
      return bridge.readServerResource(params);
    },
    setWidgetState(value) {
      state.widgetState = { selectedAssetIds: selectedAssetIds(value) };
      if (state.connected && app.getHostCapabilities()?.updateModelContext) {
        void app.updateModelContext({ structuredContent: state.widgetState }).catch(() => {});
      }
    },
    sendFollowUpMessage(value) {
      const prompt = String(value?.prompt || "").trim();
      if (!state.connected || !prompt || !app.getHostCapabilities()?.message) return;
      void app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] }).catch(() => {});
    },
    notifyIntrinsicHeight() {
      // App.connect() owns standard size-change notifications through ResizeObserver.
    },
  };

  Object.defineProperty(window, "openai", {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false,
  });

  app.ontoolresult = (result) => {
    state.toolOutput = result?.structuredContent || result || null;
    notifyGlobals();
  };
  app.onhostcontextchanged = () => notifyGlobals();
  void app.connect().then(() => {
    state.connected = true;
    document.documentElement.dataset.vintraceHostBridge = "mcp-apps";
    notifyGlobals();
  }).catch(() => {
    document.documentElement.dataset.vintraceHostBridge = "unavailable";
  });
})();
