/**
 * Phase 3 QA: the dedicated Memories ("For You") + Albums gallery destinations.
 * Verifies the empty states, the populated feed/gallery (cards + play/new affordances),
 * that opening a card drills into the scoped PhotosView grid, and no page errors.
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 * Run: npx playwright test tests/e2e/phase3-memories-albums.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function makeFixtures(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const names = ["beach.png", "sunset.png", "party.png", "hike.png", "city.png"];
  const cols = [[230, 120, 90], [250, 180, 60], [200, 80, 160], [90, 170, 120], [120, 140, 210]];
  const py = ["from PIL import Image"];
  names.forEach((n, i) => py.push(`Image.new('RGB',(320,240),(${cols[i].join(",")})).save(r'${path.join(dir, n)}')`));
  const r = spawnSync(".venv/bin/python", ["-c", py.join("\n")], { cwd: process.cwd(), encoding: "utf-8" });
  if (r.status !== 0) throw new Error("fixtures: " + (r.stderr || r.stdout));
  return names;
}

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Phase 3: Memories feed + Albums gallery render, drill in, no errors", async () => {
  test.setTimeout(240_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-p3-"));
  const media = path.join(temp, "media");
  const files = makeFixtures(media);
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
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  const goTab = async (name: string) => {
    await page.locator(".nav-list").getByRole("button", { name }).click();
    await page.waitForTimeout(500);
    await dismissModals(page);
  };

  // --- Empty states ---
  await goTab("Memories");
  await expect(page.locator(".memories-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".memories-empty").getByRole("button", { name: "New Memory" })).toBeVisible();
  await goTab("Albums");
  await expect(page.locator(".albums-empty")).toBeVisible({ timeout: 20_000 });

  // --- Populate via IPC ---
  await page.evaluate(async ({ mediaFolder, names }) => {
    const ca = (window as any).crossAge as { invoke<T>(c: string, p?: Record<string, unknown>): Promise<T> };
    const imp = await ca.invoke<{ value: { importedPaths: string[] } }>("import_photos", { sourcePaths: [mediaFolder], storageMode: "referenced", sourceLabel: "P3 spec" });
    const paths = imp.value.importedPaths || [];
    const t = new Date();
    const md = `-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < paths.length; i += 1) {
      await ca.invoke("update_photo_asset_metadata", { sourcePath: paths[i], title: names[i]?.replace(".png", ""), dateOverride: i < 2 ? `2024${md}` : `2023-07-${String(10 + i).padStart(2, "0")}` });
    }
    await ca.invoke("save_photo_user_memory", { name: "Beach Day", subtitle: "Sunny", sourcePaths: paths.slice(0, 2), coverSourcePath: paths[0] });
    await ca.invoke("save_photo_user_memory", { name: "City Lights", subtitle: "Evening", sourcePaths: paths.slice(2, 5), coverSourcePath: paths[2] });
    const folder = await ca.invoke<{ value: { folderId: string } }>("save_photo_album_folder", { name: "Trips" });
    await ca.invoke("save_photo_album", { name: "Best Sunsets", albumKind: "smart", rules: { favoriteOnly: false } });
    await ca.invoke("save_photo_album", { name: "Nested Trip", albumKind: "smart", folderId: folder.value.folderId, rules: { favoriteOnly: false } });
  }, { mediaFolder: media, names: files });

  // --- Populated Memories feed ---
  await goTab("Library");
  await goTab("Memories");
  await expect(page.locator(".memories-feed")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".memory-card").first()).toBeVisible();
  await expect(page.locator(".memory-hero").getByRole("button", { name: "Play the movie" })).toBeVisible();

  // --- Populated Albums gallery + folder nesting ---
  await goTab("Albums");
  await expect(page.locator(".albums-gallery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".album-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New smart album" })).toBeVisible();
  // open the "Trips" folder -> nested view -> breadcrumb back
  await page.locator(".album-folder-card").first().click();
  await expect(page.locator(".albums-breadcrumb")).toBeVisible({ timeout: 10_000 });
  await page.locator(".albums-breadcrumb").getByRole("button", { name: "All albums" }).click();
  await expect(page.locator(".albums-breadcrumb")).toHaveCount(0);

  // --- Drill into an album -> exits destination mode into the scoped grid ---
  await page.locator(".album-card-open").first().click();
  await page.waitForTimeout(700);
  await expect(page.locator(".photos-destination")).toHaveCount(0);
  await expect(page.locator(".photos-rail")).toBeVisible();

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
