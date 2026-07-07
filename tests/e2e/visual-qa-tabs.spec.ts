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
  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".sidebar-footer .language-picker select").selectOption("en").catch(() => undefined);
  await dismiss(page);

  for (const tab of ["Library", "Memories", "Albums", "Search", "People & Pets", "Tools", "Settings"]) {
    await page.locator(".nav-list").getByRole("button", { name: tab }).click();
    await page.waitForTimeout(700);
    await dismiss(page);
    await page.screenshot({ path: path.join(SHOT, `tab-${tab.replace(/[^a-z]+/gi, "-").toLowerCase()}.png`) });
  }
  await app.close();
});
