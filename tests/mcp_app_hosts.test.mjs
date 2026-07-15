import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.VINTRACE_PYTHON || path.join(root, ".venv", "bin", "python");

function imageReviewHtml() {
  const result = spawnSync(
    python,
    ["-c", "import base64; from crossage_fr.agent_ui import IMAGE_REVIEW_HTML; print(base64.b64encode(IMAGE_REVIEW_HTML.encode()).decode())"],
    { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } },
  );
  assert.equal(result.status, 0, result.stderr);
  return Buffer.from(result.stdout.trim(), "base64").toString("utf8");
}

function hostBridgeBundle() {
  const source = `
    import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
    window.startVintraceHost = async (iframe, toolResult) => {
      const events = window.__hostEvents = { calls: [], reads: [], contexts: [], messages: [], initialized: 0 };
      const bridge = new AppBridge(
        null,
        { name: "Vintrace conformance host", version: "1.0.0" },
        {
          serverTools: {},
          serverResources: {},
          updateModelContext: { structuredContent: {} },
          message: { text: {} },
        },
        {
          hostContext: {
            theme: "light",
            displayMode: "inline",
            availableDisplayModes: ["inline"],
            containerDimensions: { width: 760, maxHeight: 900 },
            locale: "en-US",
            platform: "web",
          },
        },
      );
      bridge.oncalltool = async (params) => {
        events.calls.push(params);
        return {
          content: [{ type: "resource_link", name: "Preview", uri: "vintrace://images/previews/grant", mimeType: "image/jpeg" }],
          structuredContent: { ok: true },
        };
      };
      bridge.onreadresource = async (params) => {
        events.reads.push(params);
        return { contents: [{ uri: params.uri, mimeType: "image/jpeg", blob: "aGVsbG8=" }] };
      };
      bridge.onupdatemodelcontext = async (params) => {
        events.contexts.push(params);
        return {};
      };
      bridge.onmessage = async (params) => {
        events.messages.push(params);
        return {};
      };
      bridge.oninitialized = async () => {
        events.initialized += 1;
        await bridge.sendToolInput({ arguments: { query: "sunset" } });
        await bridge.sendToolResult(toolResult);
      };
      await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
      window.__bridge = bridge;
    };
  `;
  return buildSync({
    stdin: { contents: source, resolveDir: root, sourcefile: "mcp-app-test-host.js" },
    bundle: true,
    format: "iife",
    minify: true,
    platform: "browser",
    target: ["chrome120"],
    write: false,
  }).outputFiles[0].text;
}

const toolResult = {
  content: [{ type: "text", text: "One path-free result" }],
  structuredContent: {
    ok: true,
    requestId: "request-test",
    data: {
      items: [{
        assetId: "asset_test_001",
        title: "Sunset frame",
        width: 1200,
        height: 800,
        captureDate: "2026-07-01T10:00:00Z",
        favorite: true,
        matchReasons: ["semantic"],
      }],
    },
  },
};

async function testMcpAppsHost(browser, html) {
  const page = await browser.newPage();
  const network = [];
  page.on("request", (request) => network.push(request.url()));
  await page.setContent(`<script>${hostBridgeBundle()}</script><iframe id="app" sandbox="allow-scripts"></iframe>`);
  await page.evaluate(({ html: appHtml, result }) => {
    const iframe = document.getElementById("app");
    void window.startVintraceHost(iframe, result);
    iframe.srcdoc = appHtml;
  }, { html, result: toolResult });

  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame);
  await frame.waitForFunction(() => document.documentElement.dataset.vintraceHostBridge === "mcp-apps");
  await frame.waitForFunction(() => document.querySelector("#summary")?.textContent?.includes("1 shown"));
  await frame.locator(".select").check();
  await page.waitForFunction(() => window.__hostEvents?.contexts?.length === 1);
  await frame.locator(".preview-button").click();
  await frame.waitForSelector("img.preview");
  await page.waitForFunction(() => window.__hostEvents?.calls?.length === 1 && window.__hostEvents?.reads?.length === 1);
  await frame.locator("#continue").click();
  await page.waitForFunction(() => window.__hostEvents?.messages?.length === 1);

  const events = await page.evaluate(() => window.__hostEvents);
  assert.equal(events.initialized, 1);
  assert.equal(events.calls[0].name, "get_image_preview");
  assert.equal(events.calls[0].arguments.asset_id, "asset_test_001");
  assert.deepEqual(events.contexts.at(-1).structuredContent.selectedAssetIds, ["asset_test_001"]);
  assert.match(events.messages[0].content[0].text, /asset_test_001/);
  assert.equal(network.length, 0, `MCP App made direct network requests: ${network.join(", ")}`);
  await page.close();
}

async function testChatGptCompatibility(browser, html) {
  const page = await browser.newPage();
  const setup = `<script>
    window.__chatgptEvents = { calls: [], reads: [], states: [], messages: [] };
    window.openai = {
      toolOutput: ${JSON.stringify(toolResult.structuredContent)},
      widgetState: { selectedAssetIds: [] },
      setWidgetState(value) { window.__chatgptEvents.states.push(value); this.widgetState = value; },
      async callTool(name, args) {
        window.__chatgptEvents.calls.push({ name, args });
        return { content: [{ type: "resource_link", uri: "vintrace://images/previews/chatgpt", mimeType: "image/jpeg" }] };
      },
      async readServerResource(params) {
        window.__chatgptEvents.reads.push(params);
        return { contents: [{ uri: params.uri, mimeType: "image/jpeg", blob: "aGVsbG8=" }] };
      },
      sendFollowUpMessage(value) { window.__chatgptEvents.messages.push(value); },
      notifyIntrinsicHeight() {},
    };
  </script>`;
  const chatGptHtml = html.replace("<head>", `<head>${setup}`);
  await page.setContent(`<iframe id="app" sandbox="allow-scripts"></iframe>`);
  await page.locator("#app").evaluate((iframe, value) => { iframe.srcdoc = value; }, chatGptHtml);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(frame);
  await frame.waitForFunction(() => document.documentElement.dataset.vintraceHostBridge === "chatgpt");
  await frame.waitForFunction(() => document.querySelector("#summary")?.textContent?.includes("1 shown"));
  await frame.locator(".select").check();
  await frame.locator(".preview-button").click();
  await frame.waitForSelector("img.preview");
  await frame.locator("#continue").click();
  const events = await frame.evaluate(() => window.__chatgptEvents);
  assert.equal(events.calls[0].name, "get_image_preview");
  assert.deepEqual(events.states.at(-1).selectedAssetIds, ["asset_test_001"]);
  assert.match(events.messages[0].prompt, /asset_test_001/);
  await page.close();
}

const html = imageReviewHtml();
assert(html.includes("@modelcontextprotocol/ext-apps") === false, "MCP App dependency must be bundled");
assert(html.includes("ui/initialize"), "official MCP Apps initialization must be bundled");

const browser = await chromium.launch({ headless: true });
try {
  await testMcpAppsHost(browser, html);
  await testChatGptCompatibility(browser, html);
} finally {
  await browser.close();
}

console.log("ok MCP Apps iframe and ChatGPT window.openai host compatibility");
