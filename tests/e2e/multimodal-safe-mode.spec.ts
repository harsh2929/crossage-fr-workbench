import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || path.join(os.tmpdir(), "vintrace-multimodal-safe-mode-e2e");

async function dismissModals(page: Page) {
  for (let index = 0; index < 5; index += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
}

async function continueConfirmation(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Please confirm" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test("category-aware Safe Mode readiness, persistence, and compact layout", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-multimodal-safe-mode-"));
  mkdirSync(SHOT, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    VINTRACE_VLM_ROOT: path.join(os.homedir(), ".vintrace", "models", "vlm"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CROSSAGE_FORCE_FALLBACK;
  delete env.VINTRACE_FORCE_FALLBACK;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissModals(page);
    await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
    await page.locator(".section-tab", { hasText: "General" }).click();
    await page.locator(".settings-presets").getByRole("button", { name: /Custom/ }).click();

    const toggle = page.getByLabel("Category-aware local guardrail");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Ready: Qwen\/Qwen3-VL-4B-Instruct-GGUF/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Install model" })).toHaveCount(0);
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async () => {
      const state = await (window as any).crossAge.getInitialState();
      return Boolean(state?.config?.safeModeMultimodal);
    })).toBe(true);

    const panel = toggle.locator("xpath=ancestor::div[contains(@class,'advanced-settings')]");
    await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SHOT, "multimodal-safe-mode-desktop.png"), fullPage: true });

    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(390, 844));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await toggle.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const compact = await panel.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth + 2);
    await page.screenshot({ path: path.join(SHOT, "multimodal-safe-mode-mobile.png"), fullPage: true });

    await toggle.uncheck();
    await page.getByRole("button", { name: "Save now" }).click();
    await continueConfirmation(page);
    await expect.poll(async () => page.evaluate(async () => {
      const state = await (window as any).crossAge.getInitialState();
      return Boolean(state?.config?.safeModeMultimodal);
    })).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
