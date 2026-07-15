import AxeBuilder from "@axe-core/playwright";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/photo-pro-culling";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function makeFixtures(directory: string) {
  mkdirSync(directory, { recursive: true });
  const rows = [
    ["cull-red.png", 226, 74, 67],
    ["cull-blue.png", 55, 118, 211],
    ["cull-green.png", 55, 154, 96],
    ["cull-gold.png", 228, 165, 49],
  ] as const;
  const script = ["from PIL import Image"];
  for (const [name, red, green, blue] of rows) {
    script.push(`Image.new('RGB',(640,480),(${red},${green},${blue})).save(r'${path.join(directory, name)}')`);
  }
  const result = spawnSync(".venv/bin/python", ["-c", script.join("\n")], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`Pro culling fixtures failed: ${result.stderr || result.stdout}`);
  return rows.map(([name]) => path.join(directory, name));
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function curationRows(page: Page) {
  return page.evaluate(async () => {
    const crossAge = (window as unknown as {
      crossAge: { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
    }).crossAge;
    const result = await crossAge.invoke<{
      items: Array<{ sourcePath: string; rating?: number; colorLabel?: string; pickStatus?: string }>;
    }>("list_photo_folder_items", { folderId: "all", previewBudget: 0, limit: 20 });
    return result.items.map((item) => ({
      filename: item.sourcePath.split(/[\\/]/).pop() || "",
      rating: Number(item.rating || 0),
      colorLabel: String(item.colorLabel || ""),
      pickStatus: String(item.pickStatus || ""),
    })).sort((left, right) => left.filename.localeCompare(right.filename));
  });
}

function relevantSurfaceIssues(page: Page) {
  return visibleSurfaceIssues(page).then((issues) => issues.filter((issue) => (
    /photo-(?:pro|compare)/.test(issue.className)
  )));
}

test("professional curation batches, compares, surveys, and round-trips through Electron", async () => {
  test.setTimeout(240_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photo-pro-culling-"));
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
    CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS: "1",
    CROSSAGE_TEST_DIALOG_PATHS: media.join(path.delimiter),
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissDialogs(page);
    const importPhotosButton = page.getByRole("button", { name: "Import photos", exact: true }).first();
    await importPhotosButton.click();
    const importReview = page.locator(".photo-import-review-panel");
    await expect(importReview).toContainText("4 items");
    await importReview.getByRole("button", { name: "Confirm import" }).click();
    await expect(importReview).toHaveCount(0, { timeout: 60_000 });
    await expect(importPhotosButton).toBeEnabled({ timeout: 60_000 });

    await page.locator(".photo-rail-row-main:visible").filter({ hasText: "All Photos" }).first().click();
    await expect(page.locator(".photos-gallery-title > strong")).toHaveText("All Photos");
    await expect(page.locator(".photo-tile-wrap")).toHaveCount(4, { timeout: 30_000 });

    const selectionTargets = page.locator(".photo-select-box");
    for (let index = 0; index < 4; index += 1) await selectionTargets.nth(index).click();
    const bulkBar = page.locator(".photo-bulk-bar.active");
    await expect(bulkBar).toContainText("4 selected");

    await bulkBar.getByRole("button", { name: "5 stars" }).click();
    await expect.poll(async () => (await curationRows(page)).every((row) => row.rating === 5), { timeout: 30_000 }).toBe(true);
    await expect(bulkBar.getByRole("button", { name: "5 stars" })).toHaveAttribute("aria-pressed", "true");
    await expect(bulkBar.getByRole("button", { name: "5 stars" })).toBeEnabled();
    await bulkBar.getByRole("button", { name: "Green label" }).click();
    await expect.poll(async () => (await curationRows(page)).every((row) => row.colorLabel === "green"), { timeout: 30_000 }).toBe(true);
    await expect(bulkBar.getByRole("button", { name: "Green label" })).toHaveAttribute("aria-pressed", "true");
    await expect(bulkBar.getByRole("button", { name: "Green label" })).toBeEnabled();
    await bulkBar.getByRole("button", { name: "Mark as pick" }).click();
    await expect.poll(async () => curationRows(page), { timeout: 30_000 }).toEqual(media.map((sourcePath) => ({
      filename: path.basename(sourcePath),
      rating: 5,
      colorLabel: "green",
      pickStatus: "pick",
    })).sort((left, right) => left.filename.localeCompare(right.filename)));
    await expect(bulkBar.getByRole("button", { name: "Mark as pick" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".photo-pro-grid-badges")).toHaveCount(4);
    expect(await relevantSurfaceIssues(page), "desktop bulk curation controls").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "photo-pro-grid-desktop.png"), fullPage: true });

    const compareTrigger = bulkBar.getByRole("button", { name: "Compare" });
    await compareTrigger.click();
    const dialog = page.locator(".photo-compare-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(dialog.locator(".photo-compare-tile")).toHaveCount(4);
    await expect(dialog.locator(".photo-compare-media img")).toHaveCount(4);
    expect(await dialog.locator(".photo-compare-media img").evaluateAll((images) => images.map((image) => {
      const element = image as HTMLImageElement;
      return element.complete && element.naturalWidth >= 640 && element.naturalHeight >= 480;
    }))).toEqual([true, true, true, true]);

    const focusable = dialog.locator("button:visible:not(:disabled)");
    await focusable.last().focus();
    await page.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(focusable.last()).toBeFocused();

    await dialog.getByRole("tab", { name: "Compare" }).click();
    await expect(dialog.locator(".photo-compare-tile")).toHaveCount(2);
    await page.keyboard.press("x");
    await expect(dialog.locator(".photo-compare-tile.active")).toHaveClass(/rejected/);
    await page.keyboard.press("ArrowRight");
    const activeFilename = await dialog.locator(".photo-compare-tile.active strong").innerText();
    await page.keyboard.press("4");
    await expect.poll(async () => (await curationRows(page)).find((row) => row.filename === activeFilename)?.rating).toBe(4);
    await expect.poll(async () => (await curationRows(page)).filter((row) => row.pickStatus === "reject").length).toBe(1);

    await dialog.getByRole("tab", { name: "Survey" }).click();
    await expect(dialog.locator(".photo-compare-tile")).toHaveCount(4);
    const desktopAxe = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).include(".photo-compare-dialog").analyze();
    expect(desktopAxe.violations, "desktop compare/survey accessibility").toEqual([]);
    expect(await relevantSurfaceIssues(page), "desktop compare/survey controls").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "photo-pro-survey-desktop.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 740 });
    await expect(dialog.locator(".photo-compare-tile")).toHaveCount(4);
    const compactGeometry = await dialog.evaluate((node) => {
      const dialogRect = node.getBoundingClientRect();
      const toolbarRect = node.querySelector<HTMLElement>(".photo-compare-toolbar")?.getBoundingClientRect();
      const gridRect = node.querySelector<HTMLElement>(".photo-compare-grid")?.getBoundingClientRect();
      const tiles = Array.from(node.querySelectorAll<HTMLElement>(".photo-compare-tile")).map((tile) => tile.getBoundingClientRect());
      return {
        dialogInsideViewport: dialogRect.left >= 0 && dialogRect.top >= 0 && dialogRect.right <= innerWidth && dialogRect.bottom <= innerHeight,
        toolbarBeforeGrid: Boolean(toolbarRect && gridRect && toolbarRect.bottom <= gridRect.top + 1),
        tilesInsideGrid: Boolean(gridRect && tiles.every((tile) => tile.left >= gridRect.left && tile.right <= gridRect.right + 1)),
      };
    });
    expect(compactGeometry).toEqual({ dialogInsideViewport: true, toolbarBeforeGrid: true, tilesInsideGrid: true });
    const compactAxe = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).include(".photo-compare-dialog").analyze();
    expect(compactAxe.violations, "compact compare/survey accessibility").toEqual([]);
    expect(await relevantSurfaceIssues(page), "compact compare/survey controls").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "photo-pro-survey-compact.png"), fullPage: true });

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(compareTrigger).toBeFocused();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
