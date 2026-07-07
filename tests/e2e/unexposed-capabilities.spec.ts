/**
 * QA: backend capabilities newly wired to the frontend. Each previously had a
 * registered backend command with NO frontend caller; this verifies the new UI
 * control reaches the backend and renders a result without renderer errors.
 *
 * Covered: add_workspace (Settings>General), list_jurisdictions +
 * audit_chain_status (Settings>Privacy), accuracy_validation_history
 * (Settings>Advanced), storage_io_benchmark (Settings>Storage),
 * model_distribution_audit (Tools>Models), list_photo_assets (Tools>Diagnostics).
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 * Run: npx playwright test tests/e2e/unexposed-capabilities.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/unexposed-qa";

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Newly wired backend capabilities reach the backend and render", async () => {
  test.setTimeout(220_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-unexposed-"));
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
  await page.locator(".sidebar-footer .language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  const gotoSettings = async (label: string) => {
    await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
    await page.locator(".section-tab", { hasText: label }).click();
    await page.waitForTimeout(300);
    await dismissModals(page);
  };
  const gotoTools = async (label: string) => {
    await page.locator(".nav-list").getByRole("button", { name: "Tools" }).click();
    await page.locator(".section-tab", { hasText: label }).click();
    await page.waitForTimeout(300);
    await dismissModals(page);
  };

  // add_workspace — Settings > General
  await gotoSettings("General");
  await expect(page.getByRole("button", { name: "Add case folder" })).toBeVisible();

  // list_jurisdictions — Settings > Privacy: catalog populated + disclaimer
  await gotoSettings("Privacy & Safety");
  const jurisdiction = page.locator('select[aria-label="Jurisdiction preset"]');
  await expect(jurisdiction).toBeVisible();
  expect(await jurisdiction.locator("option").count()).toBeGreaterThanOrEqual(5);

  // audit_chain_status — Settings > Privacy: Verify integrity → a status pill
  await page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(page.locator(".audit-panel .pill").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOT, "privacy.png") });

  // accuracy_validation_history — Settings > Advanced
  await gotoSettings("Advanced");
  await expect(page.locator(".validation-history")).toBeVisible({ timeout: 20_000 });

  // storage_io_benchmark — Settings > Storage: run a small drive test
  await gotoSettings("Storage & Data");
  await expect(page.getByText("Drive speed test")).toBeVisible();
  await page.getByRole("button", { name: "Test drive speed" }).click();
  await expect(page.locator(".panel", { hasText: "Drive speed test" }).locator(".workspace-health-grid")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOT, "storage.png") });

  // model_distribution_audit — Tools > Models
  await gotoTools("Models");
  await expect(page.getByText("Model licenses & distribution")).toBeVisible();
  await page.getByRole("button", { name: "Check model licenses" }).click();
  await expect(page.locator(".model-license-panel .pill").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOT, "models.png") });

  // list_photo_assets — Tools > Diagnostics: inspect the raw index
  await gotoTools("Diagnostics");
  await expect(page.getByText("Photo asset index")).toBeVisible();
  await page.locator(".photo-asset-inspector").getByRole("button", { name: "Inspect index" }).click();
  await expect(page.locator(".photo-asset-inspector .pill").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOT, "diagnostics.png") });

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
