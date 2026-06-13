import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_SOAK !== "1", "Set VINTRACE_SOAK=1 to run the Electron memory soak test.");

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

test("UI interaction soak stays responsive without unbounded memory growth", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-soak-"));
  const workspace = path.join(temp, "workspace");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeDialogIfVisible(page);
  await page.waitForTimeout(250);

  const beforeMain = await mainMemory(app);
  const beforeRenderer = await rendererSnapshot(page);
  for (let cycle = 0; cycle < 14; cycle += 1) {
    await closeDialogIfVisible(page);
    for (const name of ["Dashboard", "People", "Scan", "Review", "Settings"]) {
      await page.locator(".nav-list").getByRole("button", { name }).click();
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(30);
    }
    await page.locator(".language-picker select").selectOption(cycle % 2 === 0 ? "hi" : "en");
    await page.locator(".language-picker select").selectOption("en");
    await page.getByRole("button", { name: /Guide/i }).click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
    await closeDialogIfVisible(page);
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
  await expect(page.locator(".nav-list").getByRole("button", { name: "Dashboard" })).toBeVisible();
  await app.close();
});
