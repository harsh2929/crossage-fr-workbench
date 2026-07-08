import { expect, test } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";

type HarnessCall = {
  name: string;
  params: Record<string, unknown>;
  at: number;
};

declare global {
  interface Window {
    __photosViewStateHarness?: {
      calls: HarnessCall[];
      clearCalls: () => void;
    };
  }
}

let server: ViteDevServer;
let baseUrl = "";

test.beforeAll(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

test.afterAll(async () => {
  await server?.close();
});

async function itemRequests(page: import("@playwright/test").Page): Promise<HarnessCall[]> {
  return page.evaluate(() => window.__photosViewStateHarness?.calls.filter((call) => call.name === "listPhotoFolderItems") || []);
}

test("PhotosView state updates drive grid requests and selection UI", async ({ page }) => {
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toBeVisible();

  await page.evaluate(() => window.__photosViewStateHarness?.clearCalls());

  await page.getByLabel("Search photos").fill("sunrise");
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.query === "sunrise");
  }, { timeout: 5000 }).toBe(true);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);

  await page.getByLabel("Clear search").click();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toBeVisible();

  await page.evaluate(() => window.__photosViewStateHarness?.clearCalls());
  await page.locator(".photo-filter-toggle", { hasText: "Favorites" }).getByRole("checkbox").check();
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.favoriteOnly === true);
  }, { timeout: 5000 }).toBe(true);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);

  await page.getByLabel("Select Mountain Sunrise").check();
  await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
  await expect(page.getByLabel("Deselect Mountain Sunrise")).toBeChecked();
});
