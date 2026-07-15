import { expect, test } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let baseUrl = "";

test.beforeAll(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not expose a TCP address.");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

test.afterAll(async () => {
  await server?.close();
});

test("model lifecycle panel exposes offline gates and responsive rollback controls", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 820 });
  await page.goto(`${baseUrl}/tests/fixtures/model-lifecycle/index.html`);
  const panel = page.locator(".model-lifecycle-panel");
  await expect(panel).toContainText("Regression gates ready");
  await expect(panel.getByRole("listitem")).toHaveCount(9);
  await expect(panel).toContainText("9/9");
  await expect(panel).toContainText("offline only");
  await panel.getByRole("button", { name: "Run lifecycle gate again" }).click();
  await expect(page.getByRole("status", { name: "Last action" })).toHaveText("run");
  await panel.getByRole("button", { name: "Restore previous model routes" }).click();
  await expect(page.getByRole("status", { name: "Last action" })).toHaveText("rollback");
  await panel.screenshot({ path: "/tmp/vintrace-model-lifecycle-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-model-lifecycle-mobile.png" });
});

test("model lifecycle panel presents a blocking runtime drift", async ({ page }) => {
  await page.goto(`${baseUrl}/tests/fixtures/model-lifecycle/index.html?blocked=1`);
  const panel = page.locator(".model-lifecycle-panel");
  await expect(panel).toContainText("Regression gate blocked");
  const row = panel.getByRole("listitem").filter({ hasText: "Photo OCR" });
  await expect(row).toContainText("Blocked");
  await expect(row).toContainText("Runtime fingerprint drifted.");
});
