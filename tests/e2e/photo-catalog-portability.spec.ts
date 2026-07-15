import AxeBuilder from "@axe-core/playwright";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/photo-portability";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function python(root: string, script: string, args: string[] = []) {
  const result = spawnSync(".venv/bin/python", ["-c", script, ...args], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Python fixture failed.");
  return result.stdout.trim();
}

function makeLightroomFixture(root: string, catalog: string, mediaRoot: string) {
  python(root, String.raw`
import sqlite3
import sys
from pathlib import Path
from PIL import Image

catalog = Path(sys.argv[1])
media_root = Path(sys.argv[2])
shoot = media_root / "Shoot"
shoot.mkdir(parents=True, exist_ok=True)
Image.new("RGB", (640, 420), (205, 70, 45)).save(shoot / "hero.jpg", quality=94)
Image.new("RGB", (560, 460), (40, 135, 200)).save(shoot / "alternate.jpg", quality=93)
(shoot / "hero.xmp").write_text("<x:xmpmeta>portable e2e sidecar</x:xmpmeta>", encoding="utf-8")
catalog.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(catalog) as conn:
    conn.executescript("""
    PRAGMA user_version = 140;
    CREATE TABLE AgLibraryRootFolder(id_local INTEGER PRIMARY KEY, absolutePath TEXT NOT NULL);
    CREATE TABLE AgLibraryFolder(id_local INTEGER PRIMARY KEY, rootFolder INTEGER NOT NULL, pathFromRoot TEXT NOT NULL);
    CREATE TABLE AgLibraryFile(id_local INTEGER PRIMARY KEY, folder INTEGER NOT NULL, baseName TEXT NOT NULL, extension TEXT NOT NULL);
    CREATE TABLE Adobe_images(
        id_local INTEGER PRIMARY KEY, rootFile INTEGER NOT NULL, rating INTEGER,
        pick INTEGER, colorLabels TEXT, captureTime TEXT, touchTime TEXT,
        title TEXT, caption TEXT, fileFormat TEXT, width INTEGER, height INTEGER
    );
    CREATE TABLE AgLibraryKeyword(id_local INTEGER PRIMARY KEY, name TEXT NOT NULL, parent INTEGER);
    CREATE TABLE AgLibraryKeywordImage(image INTEGER NOT NULL, tag INTEGER NOT NULL);
    CREATE TABLE AgLibraryCollection(id_local INTEGER PRIMARY KEY, name TEXT NOT NULL, parent INTEGER);
    CREATE TABLE AgLibraryCollectionContent(collection INTEGER NOT NULL, image INTEGER NOT NULL, position INTEGER NOT NULL);
    """)
    conn.execute("INSERT INTO AgLibraryRootFolder VALUES(1, '/Volumes/Retired RAID/Photos')")
    conn.execute("INSERT INTO AgLibraryFolder VALUES(10, 1, 'Shoot')")
    conn.executemany("INSERT INTO AgLibraryFile VALUES(?, 10, ?, 'jpg')", [(100, "hero"), (101, "alternate")])
    conn.executemany(
        "INSERT INTO Adobe_images VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'JPEG', ?, ?)",
        [
            (1000, 100, 5, 1, "Red", "2026-06-01T10:00:00", "2026-06-02T10:00:00", "Campaign hero", "Client approved", 640, 420),
            (1001, 101, 2, -1, "Blue", "2026-06-01T10:01:00", "2026-06-02T10:01:00", "Alternate", "Hold", 560, 460),
        ],
    )
    conn.executemany("INSERT INTO AgLibraryKeyword VALUES(?, ?, ?)", [(1, "Client", None), (2, "Acme", 1), (3, "Portfolio", None)])
    conn.executemany("INSERT INTO AgLibraryKeywordImage VALUES(?, ?)", [(1000, 2), (1000, 3), (1001, 2)])
    conn.executemany("INSERT INTO AgLibraryCollection VALUES(?, ?, ?)", [(20, "Clients", None), (21, "Acme", 20), (22, "Campaign Selects", 21)])
    conn.executemany("INSERT INTO AgLibraryCollectionContent VALUES(?, ?, ?)", [(22, 1001, 0), (22, 1000, 1)])
`, [catalog, mediaRoot]);
}

function digest(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function allFiles(root: string): string[] {
  const output: string[] = [];
  for (const name of readdirSync(root)) {
    const target = path.join(root, name);
    if (statSync(target).isDirectory()) output.push(...allFiles(target));
    else output.push(target);
  }
  return output;
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function launch(
  root: string,
  workspace: string,
  registry: string,
  dialogPaths: string[],
) {
  const home = path.join(path.dirname(workspace), "home");
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    HOME: home,
    USERPROFILE: home,
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_TEST_DIALOG_PATHS: dialogPaths.join(path.delimiter),
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await expect(page.getByText("Startup needs attention")).toHaveCount(0);
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissDialogs(page);
  return { app, page };
}

async function closeApp(app: ElectronApplication | null) {
  if (app) await app.close().catch(() => undefined);
}

async function curationRows(page: Page) {
  return page.evaluate(async () => {
    const crossAge = (window as unknown as {
      crossAge: { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
    }).crossAge;
    const result = await crossAge.invoke<{
      items: Array<{
        sourcePath: string;
        title?: string;
        rating?: number;
        colorLabel?: string;
        pickStatus?: string;
      }>;
    }>("list_photo_folder_items", { folderId: "all", previewBudget: 0, limit: 20 });
    return result.items.map((item) => ({
      sourcePath: item.sourcePath,
      title: String(item.title || ""),
      rating: Number(item.rating || 0),
      colorLabel: String(item.colorLabel || ""),
      pickStatus: String(item.pickStatus || ""),
    })).sort((left, right) => left.title.localeCompare(right.title));
  });
}

async function albumTitles(page: Page, albumId: string) {
  return page.evaluate(async (id) => {
    const crossAge = (window as unknown as {
      crossAge: { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
    }).crossAge;
    const result = await crossAge.invoke<{ items: Array<{ title?: string }> }>("list_photo_folder_items", {
      folderId: `album:${id}`,
      sort: "manual",
      previewBudget: 0,
      limit: 20,
    });
    return result.items.map((item) => String(item.title || ""));
  }, albumId);
}

async function backupCounts(page: Page) {
  return page.evaluate(async () => {
    const crossAge = (window as unknown as {
      crossAge: { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
    }).crossAge;
    const result = await crossAge.invoke<{
      counts?: Record<string, number>;
      value?: { counts?: Record<string, number> };
    }>("photo_library_backup_check", { sampleLimit: 2 });
    return result.counts || result.value?.counts || {};
  });
}

async function auditDialog(page: Page, selector: string, label: string) {
  const surface = page.locator(selector);
  await expect(surface).toBeVisible();
  const geometry = await surface.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const body = node.querySelector<HTMLElement>("[class$='-body']")?.getBoundingClientRect();
    const footer = node.querySelector<HTMLElement>("[class$='-actions']")?.getBoundingClientRect();
    return {
      insideViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      bodyBeforeFooter: !body || !footer || body.bottom <= footer.top + 1,
      horizontalOverflow: Math.max(0, (node as HTMLElement).scrollWidth - (node as HTMLElement).clientWidth),
    };
  });
  expect(geometry.insideViewport, `${label} viewport bounds`).toBe(true);
  expect(geometry.bodyBeforeFooter, `${label} body/footer order`).toBe(true);
  expect(geometry.horizontalOverflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).include(selector).analyze();
  expect(axe.violations, `${label} accessibility`).toEqual([]);
  const prefix = selector.replace(/^\./, "").split("-").slice(0, 2).join("-");
  const issues = (await visibleSurfaceIssues(page)).filter((issue) => issue.className.includes(prefix));
  expect(issues, `${label} visible geometry`).toEqual([]);
}

function packageGraph(packagePath: string) {
  const wrappers = readFileSync(path.join(packagePath, "catalog", "entities.ndjson"), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { entity: string; record: Record<string, unknown> });
  const metadata = new Map(
    wrappers
      .filter((wrapper) => wrapper.entity === "photo_asset_metadata")
      .map((wrapper) => [String(wrapper.record.asset_id || ""), String(wrapper.record.title || "")]),
  );
  const album = wrappers.find((wrapper) => (
    wrapper.entity === "photo_albums" && wrapper.record.name === "Campaign Selects"
  ));
  const albumId = String(album?.record.album_id || "");
  const albumOrder = wrappers
    .filter((wrapper) => wrapper.entity === "photo_album_items" && wrapper.record.album_id === albumId)
    .sort((left, right) => Number(left.record.position || 0) - Number(right.record.position || 0))
    .map((wrapper) => metadata.get(String(wrapper.record.asset_id || "")) || "");
  const externalLinks = wrappers.filter((wrapper) => (
    wrapper.entity === "photo_asset_external_ids" && wrapper.record.provider === "lightroom_catalog"
  )).length;
  return { albumId, albumOrder, externalLinks };
}

test("Lightroom migration exports and imports a verified path-free whole catalog", async () => {
  test.setTimeout(360_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photo-portability-e2e-"));
  const mediaRoot = path.join(temp, "relocated-media");
  const catalog = path.join(temp, "Client Catalog.lrcat");
  const exportRoot = path.join(temp, "exports");
  const targetManaged = path.join(temp, "target-managed");
  const sourceWorkspace = path.join(temp, "source-workspace");
  const targetWorkspace = path.join(temp, "target-workspace");
  mkdirSync(exportRoot, { recursive: true });
  mkdirSync(targetManaged, { recursive: true });
  makeLightroomFixture(root, catalog, mediaRoot);
  const catalogHash = digest(catalog);
  const hero = realpathSync(path.join(mediaRoot, "Shoot", "hero.jpg"));
  const alternate = realpathSync(path.join(mediaRoot, "Shoot", "alternate.jpg"));
  const heroHash = digest(hero);
  const alternateHash = digest(alternate);

  let sourceApp: ElectronApplication | null = null;
  let targetApp: ElectronApplication | null = null;
  let packagePath = "";
  let graph = { albumId: "", albumOrder: [] as string[], externalLinks: 0 };
  try {
    const source = await launch(
      root,
      sourceWorkspace,
      path.join(temp, "source-registry"),
      [catalog, mediaRoot, exportRoot],
    );
    sourceApp = source.app;
    const page = source.page;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const ungranted = path.join(temp, "never-picked-export");
    mkdirSync(ungranted, { recursive: true });
    const ungrantedError = await page.evaluate(async (destination) => {
      try {
        await window.crossAge.exportOpenPhotoCatalog({ destination });
        return "";
      } catch (error) {
        return String(error);
      }
    }, ungranted);
    expect(ungrantedError).toContain("E-PHOTO-CATALOG-PATH");

    const importLauncher = page.getByRole("button", { name: "Import images", exact: true });
    await importLauncher.click();
    const sourceDialog = page.locator(".photo-source-dialog");
    await expect(sourceDialog).toBeVisible();
    await sourceDialog.getByRole("tab", { name: "Pro catalogs" }).click();
    await expect(sourceDialog.getByLabel("Catalog app")).toHaveValue("lightroom_catalog");
    await sourceDialog.getByRole("button", { name: "Choose catalog" }).click();
    await expect(sourceDialog.getByLabel("DAM catalog")).toHaveValue(catalog);
    await sourceDialog.getByRole("button", { name: "Choose relocated media folder" }).click();
    await expect(sourceDialog.locator(".photo-source-dam-relocation")).toContainText("relocated-media");
    await sourceDialog.getByRole("button", { name: "Referenced", exact: true }).click();
    await sourceDialog.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(sourceDialog.locator(".photo-source-preview-band")).toContainText("Campaign hero", { timeout: 60_000 });
    await expect(sourceDialog.locator(".photo-source-preview-band")).toContainText("Alternate");

    await auditDialog(page, ".photo-source-dialog", "DAM desktop");
    await page.screenshot({ path: path.join(SHOT, "dam-lightroom-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 740 });
    await auditDialog(page, ".photo-source-dialog", "DAM compact");
    const compactCatalogPicker = sourceDialog.getByRole("button", { name: "Choose catalog" });
    const compactPickerBounds = await compactCatalogPicker.boundingBox();
    expect(compactPickerBounds, "DAM compact catalog picker bounds").not.toBeNull();
    expect(compactPickerBounds!.x, "DAM compact catalog picker left edge").toBeGreaterThanOrEqual(0);
    expect(compactPickerBounds!.x + compactPickerBounds!.width, "DAM compact catalog picker right edge").toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(SHOT, "dam-lightroom-compact.png"), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 900 });

    await sourceDialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(sourceDialog.locator(".photo-source-message.ok")).toContainText("completed", { timeout: 90_000 });
    await expect.poll(() => curationRows(page), { timeout: 30_000 }).toEqual([
      { sourcePath: alternate, title: "Alternate", rating: 2, colorLabel: "blue", pickStatus: "reject" },
      { sourcePath: hero, title: "Campaign hero", rating: 5, colorLabel: "red", pickStatus: "pick" },
    ]);
    expect(digest(catalog)).toBe(catalogHash);
    await sourceDialog.getByRole("button", { name: "Close" }).click();
    await expect(importLauncher).toBeFocused();

    const transferLauncher = page.getByRole("button", { name: "Transfer catalog", exact: true });
    await transferLauncher.click();
    const catalogDialog = page.locator(".photo-catalog-dialog");
    await expect(catalogDialog).toBeVisible();
    await expect(catalogDialog.locator(".photo-catalog-counts")).toContainText("2");
    await catalogDialog.getByRole("button", { name: "Choose export folder" }).click();
    await expect(catalogDialog.getByRole("textbox", { name: "Export folder", exact: true })).toHaveValue(exportRoot);
    await catalogDialog.getByLabel("Package name").fill("e2e-roundtrip");
    await catalogDialog.getByRole("button", { name: "Export catalog" }).click();
    await expect(catalogDialog.locator(".photo-catalog-result")).toContainText("Export verified", { timeout: 90_000 });
    await auditDialog(page, ".photo-catalog-dialog", "catalog export desktop");
    await page.screenshot({ path: path.join(SHOT, "open-catalog-export-desktop.png"), fullPage: true });
    packagePath = path.join(exportRoot, "e2e-roundtrip.vintracecatalog");
    await expect.poll(() => statSync(packagePath).isDirectory()).toBe(true);
    await catalogDialog.locator(".photo-catalog-actions").getByRole("button", { name: "Close", exact: true }).click();
    await expect(transferLauncher).toBeFocused();
    expect(pageErrors).toEqual([]);

    await closeApp(sourceApp);
    sourceApp = null;
    expect(digest(catalog)).toBe(catalogHash);

    const packageText = Buffer.concat(
      allFiles(packagePath)
        .filter((filePath) => /\.(?:json|ndjson)$/i.test(filePath))
        .map((filePath) => readFileSync(filePath)),
    ).toString("utf-8");
    expect(packageText).not.toContain(mediaRoot);
    expect(packageText).not.toContain(realpathSync(mediaRoot));
    expect(packageText).not.toContain("/Volumes/Retired RAID/Photos");
    const manifest = JSON.parse(readFileSync(path.join(packagePath, "manifest.json"), "utf-8"));
    expect(manifest.pathFree).toBe(true);
    expect(manifest.mediaPolicy).toBe("full");
    expect(manifest.counts.assets).toBe(2);
    expect(manifest.counts.sidecars).toBeGreaterThanOrEqual(1);
    graph = packageGraph(packagePath);
    expect(graph.albumId).not.toBe("");
    expect(graph.albumOrder).toEqual(["Alternate", "Campaign hero"]);
    expect(graph.externalLinks).toBe(2);

    const target = await launch(
      root,
      targetWorkspace,
      path.join(temp, "target-registry"),
      [packagePath, targetManaged],
    );
    targetApp = target.app;
    const targetPage = target.page;
    const targetErrors: string[] = [];
    targetPage.on("pageerror", (error) => targetErrors.push(error.message));
    const targetLauncher = targetPage.getByRole("button", { name: "Transfer catalog", exact: true });
    await targetLauncher.click();
    const targetDialog = targetPage.locator(".photo-catalog-dialog");
    await targetDialog.getByRole("tab", { name: "Import", exact: true }).click();
    await targetDialog.getByRole("button", { name: "Choose open catalog" }).click();
    await expect(targetDialog.locator(".photo-catalog-inspection")).toContainText("Catalog structure verified", { timeout: 60_000 });
    await auditDialog(targetPage, ".photo-catalog-dialog", "catalog import inspect desktop");
    await targetPage.screenshot({ path: path.join(SHOT, "open-catalog-import-inspect-desktop.png"), fullPage: true });
    await targetDialog.getByRole("button", { name: "Choose managed import folder" }).click();
    await expect(targetDialog.getByRole("textbox", { name: "Managed import folder", exact: true })).toHaveValue(targetManaged);
    await targetDialog.getByRole("button", { name: "Import catalog" }).click();
    await expect(targetDialog.locator(".photo-catalog-result")).toContainText("Import verified", { timeout: 120_000 });

    const targetRows = await curationRows(targetPage);
    expect(targetRows.map(({ title, rating, colorLabel, pickStatus }) => ({ title, rating, colorLabel, pickStatus }))).toEqual([
      { title: "Alternate", rating: 2, colorLabel: "blue", pickStatus: "reject" },
      { title: "Campaign hero", rating: 5, colorLabel: "red", pickStatus: "pick" },
    ]);
    expect(targetRows.every((row) => path.resolve(row.sourcePath).startsWith(realpathSync(targetManaged) + path.sep))).toBe(true);
    expect(await albumTitles(targetPage, graph.albumId)).toEqual(graph.albumOrder);
    const restoredCounts = await backupCounts(targetPage);
    expect(restoredCounts.assets).toBe(2);
    expect(restoredCounts.albums).toBe(1);
    expect(restoredCounts.albumItems).toBe(2);
    expect(restoredCounts.externalSources).toBeGreaterThanOrEqual(2);
    expect(restoredCounts.externalAssetLinks).toBe(4);
    await auditDialog(targetPage, ".photo-catalog-dialog", "catalog import result desktop");
    await targetPage.screenshot({ path: path.join(SHOT, "open-catalog-import-result-desktop.png"), fullPage: true });

    await targetPage.setViewportSize({ width: 390, height: 740 });
    await auditDialog(targetPage, ".photo-catalog-dialog", "catalog import compact");
    await targetPage.screenshot({ path: path.join(SHOT, "open-catalog-import-result-compact.png"), fullPage: true });
    const focusable = targetDialog.locator("button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled)");
    await focusable.last().focus();
    await targetPage.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();
    await targetPage.keyboard.press("Shift+Tab");
    await expect(focusable.last()).toBeFocused();
    await targetDialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(targetLauncher).toBeFocused();
    expect(targetErrors).toEqual([]);

    await closeApp(targetApp);
    targetApp = null;
  } finally {
    await closeApp(sourceApp);
    await closeApp(targetApp);
  }

  const targetFiles = allFiles(targetManaged);
  const targetHero = targetFiles.find((filePath) => path.basename(filePath) === "hero.jpg");
  const targetAlternate = targetFiles.find((filePath) => path.basename(filePath) === "alternate.jpg");
  const targetSidecar = targetFiles.find((filePath) => path.basename(filePath) === "hero.xmp");
  expect(targetHero && digest(targetHero)).toBe(heroHash);
  expect(targetAlternate && digest(targetAlternate)).toBe(alternateHash);
  expect(targetSidecar && readFileSync(targetSidecar, "utf-8")).toContain("portable e2e sidecar");
});
