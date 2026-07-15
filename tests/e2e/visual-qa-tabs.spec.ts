/**
 * Visual QA helper (not an assertion suite): launches the app and screenshots
 * every primary tab so the UI/UX enhancements can be eyeballed. Run on demand:
 *   npx playwright test tests/e2e/visual-qa-tabs.spec.ts --reporter=line
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/uiux-qa";

async function dismiss(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test.skip(process.env.VINTRACE_VISUAL_QA !== "1", "Set VINTRACE_VISUAL_QA=1 to capture tab screenshots on demand.");
test("Visual QA: screenshot every tab", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-vqa-"));
  mkdirSync(SHOT, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  if (process.env.VINTRACE_VISUAL_DARK === "1") await page.emulateMedia({ colorScheme: "dark" });
  if (process.env.VINTRACE_VISUAL_COMPACT === "1") {
    // Electron pages keep the BrowserWindow layout viewport when only the page
    // viewport is changed, which produces a misleading crop of a desktop layout.
    // Resize the native window so responsive CSS is exercised for real.
    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(800, 900));
    await page.waitForTimeout(200);
  }
  page.on("pageerror", (error) => console.log("VQA_PAGE_ERROR=" + (error.stack || error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("VQA_CONSOLE_ERROR=" + message.text());
  });
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".sidebar-footer .language-picker select").selectOption("en").catch(() => undefined);
  await dismiss(page);
  await page.screenshot({ path: path.join(SHOT, "startup.png") });
  await expect(page.locator(".nav-list")).toBeVisible({ timeout: 5_000 });

  const tabs = [
    ["library", "Library"],
    ["memories", "Memories"],
    ["albums", "Albums"],
    ["search", "Search"],
    ["agents", "AI Agents"],
    ["people", "People & Pets"],
    ["tools", "Tools"],
    ["settings", "Settings"],
  ] as const;
  for (const [key, tab] of tabs) {
    // data-tab is the stable navigation contract. The accessible name can
    // legitimately include a live count/status badge and changes by locale.
    await page.locator(`.nav-list [data-tab="${key}"]`).click();
    await page.waitForTimeout(700);
    await dismiss(page);
    await page.screenshot({ path: path.join(SHOT, `tab-${tab.replace(/[^a-z]+/gi, "-").toLowerCase()}.png`) });
  }

  const captureSections = async (tabKey: string, labels: string[]) => {
    await page.locator(`.nav-list [data-tab="${tabKey}"]`).click();
    for (const label of labels) {
      await page.locator(".section-tabs .section-tab", { hasText: label }).click();
      await page.waitForTimeout(450);
      await dismiss(page);
      const slug = label.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      await page.screenshot({ path: path.join(SHOT, `${tabKey}-${slug}.png`) });
    }
  };

  await captureSections("people", ["Browse", "Add person", "Review"]);
  await captureSections("tools", ["Overview", "Scan", "Models", "Diagnostics"]);
  await captureSections("settings", ["General", "Engine & Models", "Privacy & Safety", "Storage & Data", "AI Agents", "Advanced"]);
  await app.close();
});
