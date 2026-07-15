import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { largePhotoLibraryCount, seedLargePhotoLibrary } from "./large-photo-library";

test.skip(process.env.VINTRACE_SOAK !== "1", "Set VINTRACE_SOAK=1 to run the Electron memory soak test.");
test.setTimeout(420_000);

type MemoryInfo = {
  residentSet?: number;
  private?: number;
  shared?: number;
};

async function mainMemory(app: ElectronApplication): Promise<MemoryInfo> {
  return app.evaluate(async () => {
    const getter = (process as unknown as { getProcessMemoryInfo?: () => Promise<MemoryInfo> }).getProcessMemoryInfo;
    return getter ? getter() : {};
  });
}

async function rendererSnapshot(page: Page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0
  }));
}

async function closeDialogIfVisible(page: Page) {
  const dialog = page.getByRole("dialog").last();
  if (!(await dialog.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(80);
  if (!(await dialog.isVisible().catch(() => false))) return;
  for (const name of [/Remind me later/i, /Done/i, /Close/i, /Cancel/i]) {
    const button = dialog.getByRole("button", { name }).last();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      await page.waitForTimeout(80);
      return;
    }
  }
}

async function selectEnglishAndWaitForNav(page: Page) {
  await page.locator(".language-picker select").selectOption("en");
  await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible({ timeout: 15_000 });
}

function soakPhotoCount() {
  return largePhotoLibraryCount(process.env.VINTRACE_SOAK_PHOTO_COUNT);
}

async function photoLibraryTotal(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const crossAge = (window as unknown as {
      crossAge?: { invoke?: <T>(command: string, params?: Record<string, unknown>) => Promise<T> };
    }).crossAge;
    if (!crossAge?.invoke) return 0;
    const pageResult = await crossAge.invoke<{ total?: number }>("list_photo_assets", { limit: 1, backfill: false });
    return Number(pageResult.total || 0);
  });
}

test("UI interaction soak stays responsive without unbounded memory growth", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-soak-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const photoCount = soakPhotoCount();
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;
  seedLargePhotoLibrary(projectRoot, env, workspace, photoCount);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await selectEnglishAndWaitForNav(page);
  await closeDialogIfVisible(page);
  await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
  await expect(page.locator(".photos-rail").getByRole("button", { name: /^All Photos\b/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => photoLibraryTotal(page), { timeout: 60_000 }).toBe(photoCount);
  await expect(page.locator(".photo-tile-wrap").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(250);

  const beforeMain = await mainMemory(app);
  const beforeRenderer = await rendererSnapshot(page);
  for (let cycle = 0; cycle < 14; cycle += 1) {
    await closeDialogIfVisible(page);
    for (const name of ["Library", "Memories", "Albums", "Search", "People & Pets", "Tools", "Settings"]) {
      await page.locator(".nav-list").getByRole("button", { name }).click();
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(30);
    }
    await selectEnglishAndWaitForNav(page);
    await page.locator(".sidebar-guide-button").click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
    await closeDialogIfVisible(page);
    await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(40);
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  }

  const afterMain = await mainMemory(app);
  const afterRenderer = await rendererSnapshot(page);
  const mainGrowth = Math.max(0, (afterMain.residentSet || 0) - (beforeMain.residentSet || 0));
  const heapGrowth = beforeRenderer.heap && afterRenderer.heap ? afterRenderer.heap - beforeRenderer.heap : 0;

  expect(pageErrors).toEqual([]);
  expect(afterRenderer.nodes).toBeLessThan(12_000);
  expect(afterRenderer.nodes - beforeRenderer.nodes).toBeLessThan(2_000);
  expect(mainGrowth, "main-process resident set growth in KB").toBeLessThan(300 * 1024);
  if (heapGrowth > 0) {
    expect(heapGrowth, "renderer heap growth in bytes").toBeLessThan(120 * 1024 * 1024);
  }
  await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible();
  await app.close();
});
