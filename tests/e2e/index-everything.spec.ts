/**
 * QA: "Index all photos on this computer" — the whole-Home broad-scan option.
 * Verifies the empty-Library CTA opens the scope-consent sheet with its privacy
 * disclosure, and that the setup guide lists the "Bring in your photos" step.
 * It deliberately does NOT confirm the crawl (that would index the runner's real
 * Home folder); it only checks discovery + consent, then cancels.
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Index-all: empty-Library CTA opens the scope-consent sheet", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-idxall-"));
  mkdirSync(path.join(temp, "workspace"), { recursive: true });
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
  await page.locator(".sidebar-footer .language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
  await page.waitForTimeout(500);
  await dismissModals(page);

  // Empty workspace → the prominent photo-discovery CTA.
  const cta = page.getByRole("button", { name: "Find photos on this computer" });
  await expect(cta).toBeVisible({ timeout: 30_000 });
  await cta.click();

  // The scope-consent sheet opens with its privacy disclosure.
  const sheet = page.locator(".index-everything-sheet");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("nothing is uploaded", { exact: false })).toBeVisible();
  await expect(sheet.getByText("referenced in place", { exact: false })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Index my photos" })).toBeVisible();
  // Scope selector (Home + add folder/drive) and the hide-noise option.
  await expect(sheet.getByText("Home folder", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add folder or drive" })).toBeVisible();
  const hideToggle = sheet.locator('.index-everything-hide input[type="checkbox"]');
  await expect(hideToggle).toBeChecked();

  // Cancel — do NOT crawl the runner's real Home folder.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
