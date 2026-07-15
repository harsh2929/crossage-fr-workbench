import { _electron as electron, expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";


const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAYAAABmJxwEAAAABmJLR0QA/wD/AP+gvaeTAAAALUlEQVQ4jWNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAXDDAAEFAABb3iJYQAAAABJRU5ErkJggg==",
  "base64",
);

async function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    if (request.url === "/gallery") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<html><head><title>Connector QA</title><meta property="og:image" content="/hero.png"></head><body><img src="/detail.png" alt="Connector detail"></body></html>');
      return;
    }
    if (request.url === "/hero.png" || request.url === "/detail.png") {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(PNG.length) });
      response.end(PNG);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("public web connector discovers metadata and imports approved managed copies", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-inbound-e2e-"));
  const fixture = await startFixtureServer();
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((row): row is [string, string] => typeof row[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_SHOW_WINDOW: "1",
    VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const dialog = page.getByRole("dialog").last();
      if (!(await dialog.isVisible().catch(() => false))) break;
      await page.keyboard.press("Escape");
    }

    await page.getByRole("button", { name: "Import images" }).click();
    const sourceDialog = page.locator(".photo-source-dialog");
    await sourceDialog.getByRole("tab", { name: "Online & cloud" }).click();
    await expect(sourceDialog.getByText("Discover first. Download only after approval.")).toBeVisible();
    await sourceDialog.getByRole("button", { name: "Add your first online source" }).click();
    await sourceDialog.getByRole("radio", { name: /Web pages/ }).click();
    await sourceDialog.getByLabel("Connection name").fill("QA website");
    await sourceDialog.getByLabel("Page or image URLs").fill(`${fixture.baseUrl}/gallery`);
    await sourceDialog.getByRole("button", { name: "Save connection" }).click();

    await expect(sourceDialog.getByText("Connection ready")).toBeVisible({ timeout: 30_000 });
    await sourceDialog.getByRole("button", { name: "Discover metadata" }).click();
    await expect(sourceDialog.getByText("Discovery preview")).toBeVisible({ timeout: 30_000 });
    await expect(sourceDialog.locator(".photo-source-samples > label")).toHaveCount(2);
    await sourceDialog.locator(".photo-source-samples > label").first().click();
    await sourceDialog.getByText("Download managed copies for this action", { exact: true }).click();
    await sourceDialog.getByRole("button", { name: /Import selected/ }).click();
    await expect(sourceDialog.getByText("Online media imported into the library.")).toBeVisible({ timeout: 90_000 });
    await expect(sourceDialog.locator(".inbound-connector-job.completed")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("inbound-web-complete.png"), fullPage: true });
    await page.setViewportSize({ width: 820, height: 760 });
    await expect(sourceDialog).toBeVisible();
    const overflow = await sourceDialog.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      viewport: element.getBoundingClientRect().right - window.innerWidth,
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.viewport).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("inbound-web-compact.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  }
});
