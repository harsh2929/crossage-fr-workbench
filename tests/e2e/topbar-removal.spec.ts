/**
 * QA: the always-on dark "App folder" top bar was removed and every control it
 * carried was relocated to a proper home. Verifies:
 *   (a) no `.topbar` chrome element exists anywhere,
 *   (b) the refreshed brand lockup renders top-left,
 *   (c) the slim language picker is still reachable on first load (the selector
 *       ~20 other specs drive in their setup), now in the sidebar footer,
 *   (d) Settings > General exposes Guide / Choose folder / Refresh / Language,
 *   (e) Settings > Privacy & Safety exposes the consent on/off (grant + revoke)
 *       toggle — the ONLY two-way consent control, which previously lived only
 *       in the removed top bar.
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 * Run: npx playwright test tests/e2e/topbar-removal.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/topbar-qa";

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Top bar removed: brand lockup, relocated controls, first-load language picker", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-topbar-"));
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

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });

  // (a) The old chrome is gone entirely.
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".workspace-path")).toHaveCount(0);
  await expect(page.locator(".workspace-meta-strip")).toHaveCount(0);

  // (b) The brand lockup renders top-left with the wordmark.
  await expect(page.locator(".brand--lockup")).toBeVisible();
  await expect(page.locator(".brand-name")).toHaveText("Vintrace");

  // (c) The slim language picker survives on first load (same selector the
  // shared e2e setup relies on), now in the sidebar footer.
  const sidebarPicker = page.locator(".sidebar-footer .language-picker select");
  await expect(sidebarPicker).toBeVisible();
  await sidebarPicker.selectOption("en");
  await dismissModals(page);
  await page.screenshot({ path: path.join(SHOT, "shell-no-topbar.png") });

  // Navigate to Settings.
  await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await dismissModals(page);

  // (d) Settings > General exposes the relocated workspace/guide/language controls.
  await page.locator(".section-tab", { hasText: "General" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open guide" })).toBeVisible();
  await expect(page.locator('select[aria-label="Interface language"]')).toBeVisible();
  await page.screenshot({ path: path.join(SHOT, "settings-general-controls.png") });

  // (e) Settings > Privacy & Safety exposes the consent grant/revoke toggle.
  await page.locator(".section-tab", { hasText: "Privacy & Safety" }).click();
  await page.waitForTimeout(300);
  const consentToggle = page.locator('input[aria-label="Permission for this app folder"]');
  await expect(consentToggle).toBeVisible();
  await expect(consentToggle).toBeEnabled();
  await page.screenshot({ path: path.join(SHOT, "settings-privacy-consent.png") });

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
