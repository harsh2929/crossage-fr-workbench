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
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT_DIR = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/populated";

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
  mkdirSync(SHOT_DIR, { recursive: true });
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

  const goTab = async (name: string) => {
    await page.locator(".nav-list").getByRole("button", { name }).click();
    await page.waitForTimeout(500);
    await dismissModals(page);
  };

  // --- Empty states ---
  await goTab("Memories");
  await expect(page.locator(".memories-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".memories-empty").getByRole("button", { name: "Add photos" })).toBeVisible();
  await expect(page.locator(".memories-empty").getByRole("button", { name: "New Memory" })).toHaveCount(0);
  await goTab("Albums");
  await expect(page.locator(".albums-empty")).toBeVisible({ timeout: 20_000 });

  // --- Populate via IPC ---
  await page.evaluate(async ({ mediaFolder, names }) => {
    const ca = (window as any).crossAge as { invoke<T>(c: string, p?: Record<string, unknown>): Promise<T> };
    const imp = await ca.invoke<{ value: { importedPaths: string[] } }>("import_photos", { sourcePaths: [mediaFolder], storageMode: "referenced", sourceLabel: "P3 spec" });
    const paths = imp.value.importedPaths || [];
    const t = new Date();
    const recent = new Date(t.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentDate = `${recent.getFullYear()}-${String(recent.getMonth() + 1).padStart(2, "0")}-${String(recent.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < paths.length; i += 1) {
      await ca.invoke("update_photo_asset_metadata", {
        sourcePath: paths[i],
        title: names[i]?.replace(".png", ""),
        dateOverride: i === paths.length - 1
          ? recentDate
          : i < 2
            ? `2024-06-${String(i + 1).padStart(2, "0")}`
            : `2023-07-${String(10 + i).padStart(2, "0")}`,
      });
    }
    await ca.invoke("save_photo_user_memory", { name: "Beach Day", subtitle: "Sunny", sourcePaths: paths.slice(0, 2), coverSourcePath: paths[0] });
    await ca.invoke("save_photo_user_memory", { name: "City Lights", subtitle: "Evening", sourcePaths: paths.slice(2, 5), coverSourcePath: paths[2] });
    const folder = await ca.invoke<{ value: { folderId: string } }>("save_photo_album_folder", { name: "Trips" });
    await ca.invoke("save_photo_album", { name: "Best Sunsets", albumKind: "smart", rules: { favoriteOnly: false } });
    await ca.invoke("save_photo_album", { name: "Nested Trip", albumKind: "smart", folderId: folder.value.folderId, rules: { favoriteOnly: false } });
    await ca.invoke("save_photo_album", { name: "No matching photos", albumKind: "smart", rules: { query: "definitely-no-such-photo" } });
  }, { mediaFolder: media, names: files });
  const populatedCatalog = await page.evaluate(async () => {
    const ca = (window as any).crossAge as { invoke<T>(c: string, p?: Record<string, unknown>): Promise<T> };
    const result = await ca.invoke<{ folders?: Array<{ id?: string; kind?: string; name?: string }> }>("list_photo_folders", {
      railMode: "interactive",
      coverPreviewBudget: 24,
    });
    const memories = await ca.invoke<{ value?: { memories?: Array<{ memoryId?: string; name?: string }> } }>("photo_user_memories", {});
    const suggestions = await ca.invoke<{ value?: { suggestions?: Array<{ id?: string; name?: string; matchCount?: number }> } }>("suggest_photo_albums", { limit: 12 });
    return {
      folders: (result.folders || []).map((folder) => ({ id: folder.id, kind: folder.kind, name: folder.name })),
      memories: memories.value?.memories || [],
      suggestions: suggestions.value?.suggestions || [],
    };
  });
  expect(populatedCatalog.memories, JSON.stringify(populatedCatalog)).toHaveLength(2);
  expect(populatedCatalog.folders.filter((folder) => folder.kind === "album"), JSON.stringify(populatedCatalog)).not.toHaveLength(0);
  expect(populatedCatalog.suggestions, JSON.stringify(populatedCatalog)).not.toHaveLength(0);

  // --- Populated Memories feed ---
  await goTab("Library");
  // The fixture mutated the catalog directly through IPC, outside the mounted
  // Photos controller. A deliberate reselect is the explicit external-change
  // refresh gesture; ordinary destination switches intentionally reuse cache.
  await goTab("Library");
  await goTab("Memories");
  await expect(page.locator(".memories-feed")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".memory-card").first()).toBeVisible();
  await expect(page.locator(".memory-hero").getByRole("button", { name: "Play the movie" })).toBeVisible();
  expect(await visibleSurfaceIssues(page), "populated Memories surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "memories-populated.png"), fullPage: true });

  // Favorite and launch state stay coherent on the destination surface.
  const memoryCard = page.locator(".memory-card").first();
  const memoryName = String(await memoryCard.locator(".memory-card-meta strong").textContent() || "").trim();
  expect(memoryName).toBeTruthy();
  await memoryCard.getByRole("button", { name: `Favorite ${memoryName}` }).click();
  await expect(page.getByRole("button", { name: `Unfavorite ${memoryName}` })).toHaveAttribute("aria-pressed", "true");
  expect(await visibleSurfaceIssues(page), "favorite Memory surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "memories-favorite-populated.png"), fullPage: true });

  await page.locator(".memory-hero").getByRole("button", { name: "Play the movie" }).click();
  const slideshow = page.getByRole("dialog", { name: /Slideshow:/ });
  await expect(slideshow).toBeVisible({ timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "Memory playback launch surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "memory-playback-populated.png"), fullPage: true });
  await slideshow.getByRole("button", { name: "Close slideshow" }).click();
  await goTab("Memories");
  await expect(page.locator(".memories-feed")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: `Feature less ${memoryName}` }).click();
  await expect(page.getByRole("button", { name: `Open memory ${memoryName}` })).toHaveCount(0, { timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "feature-less Memory surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "memories-feature-less-populated.png"), fullPage: true });

  // --- Populated Albums gallery + folder nesting ---
  await goTab("Albums");
  await expect(page.locator(".albums-gallery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".album-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "New smart album" })).toBeVisible();
  await expect(page.locator(".album-card").filter({ hasText: "No matching photos" }).locator(".album-card-warn")).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  const suggestedAlbums = page.getByRole("region", { name: "Suggested albums" });
  await expect(suggestedAlbums).toBeVisible({ timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "populated Albums surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "albums-populated.png"), fullPage: true });

  // Editor validation and preview state remain legible without leaving Albums.
  await page.getByRole("button", { name: "New smart album" }).click();
  const albumEditor = page.locator(".photo-album-editor");
  await expect(albumEditor).toBeVisible();
  await expect(albumEditor.getByRole("button", { name: "Save" })).toBeDisabled();
  await albumEditor.getByLabel("Album name").fill("Beach picks");
  await albumEditor.getByLabel("Search text").fill("beach");
  await expect(albumEditor.getByRole("status")).toContainText(/match|Checking/, { timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "smart album editor surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "albums-editor-populated.png"), fullPage: true });
  await albumEditor.getByRole("button", { name: "Cancel" }).click();
  await expect(albumEditor).toHaveCount(0);

  const firstSuggestion = suggestedAlbums.locator(".album-suggestion-card").first();
  const suggestedName = String(await firstSuggestion.locator("strong").textContent() || "").trim();
  await firstSuggestion.getByRole("button", { name: "Add album" }).click();
  await expect(page.locator(".photos-gallery-title")).toContainText(suggestedName, { timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "saved album suggestion drill-in surface").toEqual([]);
  await goTab("Albums");
  await expect(page.locator(".albums-gallery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".album-card").filter({ hasText: "Best Sunsets" })).toContainText("5 photos", { timeout: 20_000 });
  await expect(page.locator(".album-card").filter({ hasText: suggestedName })).toContainText("1 photo", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Suggested albums" }).getByText(suggestedName, { exact: true })).toHaveCount(0, { timeout: 20_000 });
  expect(await visibleSurfaceIssues(page), "saved album suggestion surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "albums-suggestion-saved.png"), fullPage: true });
  // open the "Trips" folder -> nested view -> breadcrumb back
  await page.locator(".album-folder-card").first().click();
  await expect(page.locator(".albums-breadcrumb")).toBeVisible({ timeout: 10_000 });
  expect(await visibleSurfaceIssues(page), "nested album folder surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "albums-folder-populated.png"), fullPage: true });
  await page.locator(".albums-breadcrumb").getByRole("button", { name: "All albums" }).click();
  await expect(page.locator(".albums-breadcrumb")).toHaveCount(0);

  // --- Drill into an album -> exits destination mode into the scoped grid ---
  await page.locator(".album-card").filter({ hasText: "Best Sunsets" }).locator(".album-card-open").click();
  await page.waitForTimeout(700);
  await expect(page.locator(".photos-destination")).toHaveCount(0);
  await expect(page.locator(".photos-rail")).toBeVisible();
  expect(await visibleSurfaceIssues(page), "album drill-in Library surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT_DIR, "album-drill-in-populated.png"), fullPage: true });

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
