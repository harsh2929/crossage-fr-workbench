import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/agents";
const agentPlatform = JSON.parse(readFileSync(path.join(process.cwd(), "mcp", "agent-platform.json"), "utf8")) as {
  counts: { imageActions: number; mcpTools: number; apiOperations: number };
};

async function dismissOnboarding(page: Page) {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
}

async function requestAgentJson(
  apiUrl: string,
  token: string,
  resource: string,
  init: { method?: string; body?: Record<string, unknown>; authenticated?: boolean } = {},
) {
  const response = await fetch(`${apiUrl}${resource}`, {
    method: init.method || "GET",
    headers: {
      ...(init.authenticated === false ? {} : { Authorization: `Bearer ${token}` }),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function occupyAgentPort(): Promise<Server> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const server = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(8765, "127.0.0.1", resolve);
      });
      server.removeAllListeners("error");
      return server;
    } catch (error) {
      lastError = error;
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("AI agent platform verifies setup, authenticated API, approvals, failures, and responsive states", async () => {
  test.setTimeout(240_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-agent-ui-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  let portBlocker: Server | null = null;
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    const onboarding = page.getByRole("dialog").last();
    await expect(onboarding.getByText("Connect an AI agent")).toBeVisible();
    await expect(onboarding.locator(".onboarding-step")).toHaveCount(8);
    await dismissOnboarding(page);

    const agentNav = page.locator('.nav-list [data-tab="agents"]');
    await expect(agentNav.locator(".nav-label")).toHaveText("AI Agents");
    await expect(agentNav.locator(".nav-badge")).toHaveText("New");
    const announcement = page.getByRole("complementary", { name: "New AI agent platform" });
    await expect(announcement).toContainText("Your image library now works with AI agents");
    await announcement.getByRole("button", { name: "Explore AI Agents" }).click();

    const platform = page.locator(".agent-platform-page-destination");
    await expect(platform.getByRole("heading", { name: "Your entire image library, ready for AI agents." })).toBeVisible();
    await expect(platform.locator(".agent-capability-card")).toHaveCount(7);
    await expect(platform.locator(".agent-recipe-card")).toHaveCount(8);
    await expect(platform.locator(".agent-foundation-card")).toHaveCount(5);
    await expect(platform.locator(".agent-connection-card")).toHaveCount(4);
    await expect(platform.locator(".agent-trust-grid > div")).toHaveCount(4);

    const learnMore = platform.locator(".agent-learn-more");
    await expect(learnMore).not.toHaveAttribute("open", "");
    await learnMore.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(learnMore).toHaveAttribute("open", "");
    await expect(platform.locator(".agent-platform-stats")).toContainText(String(agentPlatform.counts.imageActions));
    await expect(platform.locator(".agent-platform-stats")).toContainText(String(agentPlatform.counts.mcpTools));
    await expect(platform.locator(".agent-platform-stats")).toContainText(String(agentPlatform.counts.apiOperations));
    await page.keyboard.press("Enter");
    await expect(learnMore).not.toHaveAttribute("open", "");

    const runtime = platform.locator(".agent-runtime-strip");
    await expect(runtime.getByRole("status")).toContainText("Stopped");
    await expect(platform.locator(".agent-api-details")).toHaveCount(0);
    const activityRefresh = platform.getByRole("button", { name: "Refresh", exact: true });
    await expect(activityRefresh).toBeEnabled({ timeout: 30_000 });
    await expect(platform.locator(".agent-activity-empty")).toContainText("No agent calls yet");
    const mobilePanel = platform.locator(".mobile-companion-panel");
    await expect(mobilePanel.getByRole("heading", { name: "Read your library from a phone" })).toBeVisible();
    await expect(mobilePanel).toContainText("Ready");
    await expect(mobilePanel).toContainText("No mobile devices");
    expect(await visibleSurfaceIssues(page), "Agents stopped/empty state").toEqual([]);
    await platform.locator("#agent-connections").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-stopped-empty.png") });

    const configCards = platform.locator(".mcp-config-card");
    await expect(configCards).toHaveCount(3);
    for (const title of ["Claude Code", "Claude Desktop", "Codex"]) {
      const card = configCards.filter({ hasText: title }).first();
      const summary = card.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(card).toHaveAttribute("open", "");
      await expect(card.locator("pre")).toBeVisible();
      await expect(card.getByRole("button", { name: "Copy config" })).toBeVisible();
    }
    const claudeCodeCard = configCards.filter({ hasText: "Claude Code" }).first();
    await claudeCodeCard.getByRole("button", { name: "Copy config" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".notice")).toContainText("Claude Code config copied");
    expect(await visibleSurfaceIssues(page), "expanded agent configs").toEqual([]);
    await claudeCodeCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-config-expanded.png") });

    const serverButton = platform.getByRole("button", { name: "Start server" });
    await serverButton.focus();
    await page.keyboard.press("Enter");
    await expect(platform.getByRole("button", { name: "Stop server" })).toBeVisible({ timeout: 30_000 });
    await expect(runtime.getByRole("status")).toContainText("Running");
    const apiDetails = platform.locator(".agent-api-details");
    await expect(apiDetails).toBeVisible();
    await expect(apiDetails).toContainText("••••••••••••••••");
    const connection = await page.evaluate(async () => {
      const info = await window.crossAge.getMcpConnectionInfo();
      return { apiUrl: info.agentApiUrl, token: info.http.token };
    });
    expect(connection.token).toMatch(/^[a-f0-9]{48}$/);
    expect(await page.locator("body").innerText()).not.toContain(connection.token);

    await mobilePanel.getByLabel("Device name").fill("Agent QA phone");
    await mobilePanel.getByLabel("Access expires").selectOption("1");
    await mobilePanel.getByRole("button", { name: "Create pairing code" }).click();
    const pairingResult = mobilePanel.locator(".mobile-pairing-result");
    await expect(pairingResult).toContainText("Agent QA phone");
    await expect(pairingResult.getByRole("img", { name: "Mobile pairing QR code" })).toHaveAttribute("src", /^data:image\/png;base64,/);
    const mobileDevice = mobilePanel.locator(".mobile-device-row").filter({ hasText: "Agent QA phone" });
    await expect(mobileDevice).toContainText("pending");
    await expect(mobilePanel).toContainText("Server running");
    expect(await visibleSurfaceIssues(page), "Mobile companion pairing state").toEqual([]);
    await mobilePanel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-mobile-pairing.png") });
    await mobileDevice.getByRole("button", { name: "Revoke mobile access" }).click();
    await mobileDevice.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(mobilePanel).toContainText("No mobile devices");
    await expect(pairingResult).toHaveCount(0);

    const unauthenticated = await requestAgentJson(connection.apiUrl, connection.token, "/health", { authenticated: false });
    expect(unauthenticated.status).toBe(401);
    expect((unauthenticated.body.error as Record<string, unknown>).code).toBe("unauthorized");
    const health = await requestAgentJson(connection.apiUrl, connection.token, "/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, service: "vintrace-agent-images", transport: "http" });
    const openApi = await requestAgentJson(connection.apiUrl, connection.token, "/openapi.json");
    expect(openApi.status).toBe(200);
    expect(openApi.body.openapi).toBe("3.1.0");
    const operationCount = Object.values(openApi.body.paths as Record<string, Record<string, unknown>>)
      .reduce((count, route) => count + Object.keys(route).filter((method) => ["get", "post", "put", "patch", "delete"].includes(method)).length, 0);
    expect(operationCount).toBe(agentPlatform.counts.apiOperations);
    const capabilities = await requestAgentJson(connection.apiUrl, connection.token, "/capabilities");
    expect(capabilities.status).toBe(200);
    expect((capabilities.body.data as Record<string, unknown>).actionCount).toBe(agentPlatform.counts.imageActions);
    const permissionRequired = await requestAgentJson(connection.apiUrl, connection.token, "/library");
    expect(permissionRequired.status).toBe(412);
    expect((permissionRequired.body.error as Record<string, unknown>).code).toBe("consent_required");

    await page.locator('.nav-list [data-tab="settings"]').click();
    await page.locator('.section-tabs [data-section-key="privacy"]').click();
    const consentToggle = page.locator('input[aria-label="Permission for this app folder"]');
    await consentToggle.click();
    const consentDialog = page.getByRole("dialog", { name: "Confirm permission" });
    await expect(consentDialog).toBeVisible();
    await consentDialog.getByRole("textbox", { name: "Optional note" }).fill("Agent platform state-matrix verification.");
    await consentDialog.getByRole("checkbox", { name: /acknowledge the current AI and biometric processing notice/i }).check();
    await consentDialog.getByRole("button", { name: "Confirm permission" }).click();
    await expect(consentToggle).toBeChecked();
    await agentNav.click();
    await expect(platform).toBeVisible();
    await expect(runtime.getByRole("status")).toContainText("Running");

    const library = await requestAgentJson(connection.apiUrl, connection.token, "/library");
    expect(library.status).toBe(200);
    expect(library.body.ok).toBe(true);

    const destructivePlan = await requestAgentJson(connection.apiUrl, connection.token, "/actions/plan", {
      method: "POST",
      body: { action: "delete_photo_album", payload: { albumId: "album_missing_for_agent_qa" } },
    });
    expect(destructivePlan.status).toBe(200);
    expect((destructivePlan.body.policy as Record<string, unknown>).destructive).toBe(true);
    expect((destructivePlan.body.data as Record<string, unknown>).nextTool).toBe("run_destructive_image_action");
    const unconfirmedRun = await requestAgentJson(connection.apiUrl, connection.token, "/actions/run", {
      method: "POST",
      body: {
        action: "delete_photo_album",
        payload: { albumId: "album_missing_for_agent_qa" },
        lane: "destructive",
        confirm: false,
      },
    });
    expect(unconfirmedRun.status).toBe(428);
    expect((unconfirmedRun.body.error as Record<string, unknown>).code).toBe("confirmation_required");

    const copyToken = apiDetails.getByRole("button", { name: "Copy token" });
    await copyToken.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".notice")).toContainText("MCP auth token copied");
    expect(await page.locator("body").innerText()).not.toContain(connection.token);
    expect(await visibleSurfaceIssues(page), "Agents running/API state").toEqual([]);
    await platform.locator("#agent-connections").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-running-api.png") });

    await activityRefresh.click();
    const activity = platform.locator(".agent-activity-list");
    await expect(activity).toContainText("get_image_library_overview", { timeout: 30_000 });
    await expect(activity).toContainText("plan_image_action");
    await expect(activity).toContainText("run_destructive_image_action");
    await expect(activity).toContainText("required");
    await expect(activity).toContainText("failed");
    await expect(platform.locator(".agent-activity-summary")).toContainText("Needs attention");
    expect(await visibleSurfaceIssues(page), "Agents approval/failure activity").toEqual([]);
    await platform.locator(".agent-activity-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-activity-approval.png") });

    await platform.getByRole("button", { name: "Stop server" }).click();
    await expect(runtime.getByRole("status")).toContainText("Stopped", { timeout: 30_000 });
    portBlocker = await occupyAgentPort();
    await platform.getByRole("button", { name: "Start server" }).click();
    const serverAlert = platform.getByRole("alert").filter({ hasText: "port 8765 is already in use" });
    await expect(serverAlert).toBeVisible({ timeout: 30_000 });
    await expect(platform.getByText("Local agent server could not start because port 8765 is already in use. Stop the other service and try again.", { exact: true })).toHaveCount(1);
    await expect(runtime.getByRole("status")).toContainText("Stopped");
    await expect(platform.locator(".agent-api-details")).toHaveCount(0);
    expect(await serverAlert.textContent()).not.toContain(root);
    expect(await visibleSurfaceIssues(page), "Agents server failure state").toEqual([]);
    await platform.locator("#agent-connections").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-server-error.png") });

    await closeServer(portBlocker);
    portBlocker = null;
    await platform.getByRole("button", { name: "Start server" }).click();
    await expect(runtime.getByRole("status")).toContainText("Running", { timeout: 30_000 });
    await expect(platform.getByRole("alert")).toHaveCount(0);
    await platform.getByRole("button", { name: "Stop server" }).click();
    await expect(runtime.getByRole("status")).toContainText("Stopped", { timeout: 30_000 });

    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(780, 900));
    await page.waitForTimeout(250);
    const overflow = await platform.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
    expect(await visibleSurfaceIssues(page), "Agents compact state").toEqual([]);
    await platform.locator(".agent-activity-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-compact-activity.png") });

    await page.locator('.nav-list [data-tab="settings"]').click();
    await page.locator('.section-tabs [data-section-key="agents"]').click();
    const settingsPanel = page.locator(".agent-platform-page-settings");
    await expect(settingsPanel).toBeVisible();
    await expect(settingsPanel.locator(".agent-platform-hero")).toHaveCount(0);
    await expect(settingsPanel.locator(".agent-learn-more")).toHaveCount(0);
    await expect(settingsPanel.getByRole("heading", { name: "Start locally in a few clicks" })).toBeVisible();
    await expect(page.locator(".settings-save-status")).toContainText("Saved");
    expect(await visibleSurfaceIssues(page), "Agents Settings variant").toEqual([]);
    await settingsPanel.locator("#agent-connections").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, "agents-settings.png") });

    await page.locator('.nav-list [data-tab="library"]').click();
    await expect(page.locator(".agent-discovery-banner")).toHaveCount(0);
    await expect(agentNav.locator(".nav-badge")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeServer(portBlocker);
    await app.close();
  }
});
