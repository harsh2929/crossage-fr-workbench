import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/populated";

function makeFixtures(directory: string) {
  mkdirSync(directory, { recursive: true });
  const rows = [
    ["library-red.png", 228, 92, 74],
    ["library-blue.png", 75, 125, 210],
    ["library-green.png", 75, 164, 112],
    ["library-gold.png", 232, 172, 62],
  ];
  const script = ["from PIL import Image"];
  for (const [name, red, green, blue] of rows) {
    script.push(`Image.new('RGB',(480,360),(${red},${green},${blue})).save(r'${path.join(directory, String(name))}')`);
  }
  const result = spawnSync(".venv/bin/python", ["-c", script.join("\n")], { cwd: process.cwd(), encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`Library fixtures failed: ${result.stderr || result.stdout}`);
  return rows.map(([name]) => path.join(directory, String(name)));
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

test("populated Library, selection toolbar, and lightbox remain coherent", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-library-states-"));
  const media = makeFixtures(path.join(temp, "media"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissDialogs(page);
    await page.evaluate(async (sourcePaths) => {
      const crossAge = (window as unknown as {
        crossAge: { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
      }).crossAge;
      await crossAge.invoke("import_photos", { sourcePaths, storageMode: "referenced", sourceLabel: "Library state QA" });
    }, media);

    const libraryTab = page.locator('.nav-list [data-tab="library"]');
    await page.locator('.nav-list [data-tab="memories"]').click();
    await libraryTab.click();
    await libraryTab.click();
    await expect(page.locator(".photo-tile-wrap").first()).toBeVisible({ timeout: 30_000 });
    const libraryManagement = page.locator(".photo-library-maintenance");
    const libraryManagementSummary = libraryManagement.locator(":scope > summary");
    await expect(libraryManagementSummary).toContainText("Library management");
    await expect(page.getByText("Customize collections", { exact: true })).toBeHidden();
    expect(await visibleSurfaceIssues(page), "populated Library").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-populated.png"), fullPage: true });
    await libraryManagementSummary.click();
    await expect(page.getByText("Customize collections", { exact: true })).toBeVisible();
    expect(await visibleSurfaceIssues(page), "expanded Library management").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-management-expanded.png"), fullPage: true });
    await libraryManagementSummary.click();

    const selectionTargets = page.locator(".photo-select-box");
    await selectionTargets.nth(0).click();
    await selectionTargets.nth(1).click();
    const bulkBar = page.locator(".photo-bulk-bar.active");
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText("2 selected");
    await expect(bulkBar.getByText("Edit, organize & manage", { exact: true })).toBeVisible();
    await expect(bulkBar.getByRole("button", { name: "Consolidate" })).toBeHidden();
    await expect(bulkBar.getByRole("button", { name: "Contact sheet" })).toBeHidden();
    expect(await visibleSurfaceIssues(page), "Library selection toolbar").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-selection-populated.png"), fullPage: true });

    const outputActions = bulkBar.locator(".photo-selection-output-actions");
    const advancedActions = bulkBar.locator(".photo-selection-advanced-actions");
    await outputActions.locator("summary").click();
    await advancedActions.locator("summary").click();
    await expect(bulkBar.getByRole("button", { name: "Consolidate" })).toBeVisible();
    await expect(bulkBar.getByRole("button", { name: "Contact sheet" })).toBeVisible();
    expect(await visibleSurfaceIssues(page), "expanded Library selection actions").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-selection-expanded.png"), fullPage: true });
    await outputActions.locator("summary").click();
    await advancedActions.locator("summary").click();

    const firstPhoto = page.getByRole("button", { name: /^Open photo/ }).first();
    await firstPhoto.click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator(".photos-lightbox-image")).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Export subject cutout PNG" })).toBeHidden();
    await expect(lightbox.getByRole("button", { name: "Rotate image edit" })).toBeHidden();
    await expect(lightbox.getByRole("button", { name: "Reveal original" })).toBeHidden();
    await expect(lightbox.getByLabel("Title", { exact: true })).toBeHidden();
    await expect(lightbox.locator(".photos-info-inspector")).toBeHidden();
    expect(await visibleSurfaceIssues(page), "Library lightbox").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-lightbox-populated.png"), fullPage: true });

    const lightboxDisclosures = [
      lightbox.locator(".photo-lightbox-create-disclosure"),
      lightbox.locator(".photo-lightbox-edit-disclosure"),
      lightbox.locator(".photo-lightbox-file-disclosure"),
      lightbox.locator(".photo-lightbox-meta-disclosure"),
    ];
    for (const disclosure of lightboxDisclosures) await disclosure.locator(":scope > summary").click();
    await expect(lightbox.getByRole("button", { name: "Export subject cutout PNG" })).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Rotate image edit" })).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Reveal original" })).toBeVisible();
    await expect(lightbox.getByLabel("Title", { exact: true })).toBeVisible();
    await expect(lightbox.locator(".photos-info-inspector")).toBeVisible();
    expect(await visibleSurfaceIssues(page), "expanded Library lightbox tools").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "library-lightbox-expanded.png"), fullPage: true });
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    await expect(firstPhoto).toBeFocused();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
