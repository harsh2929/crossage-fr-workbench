/**
 * Phase 5 QA: the Settings tab reorganized into a SectionTabs sub-nav
 * (General / Engine & Models / Privacy & Safety / Storage & Data / AI Agents / Advanced).
 * Verifies the sub-nav renders, each section shows its own panels and hides others,
 * a deep-link lands on General, and no page errors. Screenshots for visual review.
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 * Run: npx playwright test tests/e2e/phase5-settings.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/p5-qa";

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Phase 5: Settings sub-nav sections, panels gated, no errors", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-p5-"));
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
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  await dismissModals(page);

  // Sub-nav renders with every settings section, including the compatibility
  // entry point for the first-class AI Agents destination.
  const tabs = page.locator(".section-tabs");
  await expect(tabs).toBeVisible({ timeout: 20_000 });
  for (const label of ["General", "Engine & Models", "Privacy & Safety", "Storage & Data", "AI Agents", "Advanced"]) {
    await expect(tabs.locator(".section-tab", { hasText: label })).toBeVisible();
  }

  const goto = async (label: string) => {
    await page.locator(".section-tab", { hasText: label }).click();
    await page.waitForTimeout(300);
  };

  // General is the default: Matching choices + Updates present; Accuracy lab hidden.
  await expect(page.getByText("Matching choices")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check updates" })).toBeVisible();
  await expect(page.getByText("Accuracy lab")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOT, "settings-general.png") });

  // Advanced: Accuracy lab + Error reports + Performance center; Matching choices hidden.
  await goto("Advanced");
  await expect(page.getByText("Accuracy lab")).toBeVisible();
  await expect(page.getByText("Error reports")).toBeVisible();
  await expect(page.getByText("Performance center")).toBeVisible();
  await expect(page.getByText("Matching choices")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOT, "settings-advanced.png") });

  // Storage & Data: Storage limit + Save and clean up.
  await goto("Storage & Data");
  await expect(page.getByText("Storage limit")).toBeVisible();
  await expect(page.getByText("Save and clean up")).toBeVisible();
  await expect(page.getByText("Accuracy lab")).toHaveCount(0);

  // Privacy & Safety: Activity history present.
  await goto("Privacy & Safety");
  await expect(page.getByText("Activity history", { exact: true })).toBeVisible();
  const encryptionPanel = page.locator(".settings-panel", { has: page.locator(".panel-title", { hasText: "Data encryption" }) });
  await expect(encryptionPanel).toBeVisible();
  await expect(encryptionPanel.locator(".status")).toHaveText("encrypted");
  await expect(page.getByRole("button", { name: "Rotate key" })).toBeVisible();
  await expect(page.getByRole("button", { name: /agent code/i })).toBeVisible();
  await expect(page.getByText("Matching choices")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOT, "settings-privacy-encryption.png") });
  const browserWindow = await app.browserWindow(page);
  await browserWindow.evaluate((window) => window.setSize(760, 800));
  await page.waitForTimeout(250);
  const compactOverflow = await encryptionPanel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(compactOverflow.scrollWidth).toBeLessThanOrEqual(compactOverflow.clientWidth + 2);
  await page.screenshot({ path: path.join(SHOT, "settings-privacy-encryption-compact.png") });
  await browserWindow.evaluate((window) => window.setSize(1240, 820));
  await page.waitForTimeout(250);

  // Engine & Models: a distinct section (the General matching card is not here).
  await goto("Engine & Models");
  await expect(page.getByText("Matching choices")).toHaveCount(0);

  // Back to General works.
  await goto("General");
  await expect(page.getByText("Matching choices")).toBeVisible();

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
