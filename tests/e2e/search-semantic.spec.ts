/**
 * Search tab — on-device semantic (AI) ranking with real thumbnails (Phase 1 polish).
 * Runs with the ML models ENABLED (no CROSSAGE_FORCE_FALLBACK), imports two solid
 * colour photos, runs an AI query in the Search tab, and asserts the ranked results
 * render with preview thumbnails and the matching colour ranks first.
 *
 * Run: npx playwright test tests/e2e/search-semantic.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT_DIR =
  process.env.QA_SHOT_DIR ||
  "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/qa-shots-search";

function makeFixtures(dir: string) {
  mkdirSync(dir, { recursive: true });
  const red = path.join(dir, "red.png");
  const blue = path.join(dir, "blue.png");
  const py = [
    "from PIL import Image",
    `Image.new('RGB',(256,256),(220,20,20)).save(r'${red}')`,
    `Image.new('RGB',(256,256),(20,40,220)).save(r'${blue}')`,
  ].join("\n");
  const res = spawnSync(".venv/bin/python", ["-c", py], { cwd: process.cwd(), encoding: "utf-8" });
  if (res.status !== 0) throw new Error("fixtures failed: " + (res.stderr || res.stdout));
  return { red, blue };
}

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    const secondary = page.locator(".modal-backdrop .secondary:visible").last();
    if (await secondary.isVisible().catch(() => false)) await secondary.click().catch(() => undefined);
    else await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Search tab: semantic AI ranking renders thumbnails and ranks the match first", async () => {
  test.setTimeout(240_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-search-"));
  const fixtures = makeFixtures(path.join(temp, "fixtures"));
  mkdirSync(SHOT_DIR, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(projectRoot, "desktop/main.cjs")], cwd: projectRoot, env });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  await page.evaluate(async (paths) => {
    const crossAge = (window as any).crossAge as { invoke(c: string, p?: Record<string, unknown>): Promise<unknown> };
    await crossAge.invoke("import_photos", { sourcePaths: paths, storageMode: "referenced", sourceLabel: "Search QA" });
  }, [fixtures.red, fixtures.blue]);

  await page.locator(".nav-list").getByRole("button", { name: "Search" }).click();
  await expect(page.locator(".search-ai-toggle")).toHaveClass(/active/); // AI on by default
  await page.locator(".search-hero-input").fill("a solid red image");
  await page.locator(".search-hero-submit").click();

  // First use queues the bounded local embedding job and immediately falls
  // back to lexical results instead of leaving Search blank.
  await expect(page.locator('.search-status[role="status"]')).toContainText("Semantic indexing is queued", { timeout: 60_000 });
  await expect(page.locator('.search-status[role="status"]')).toContainText("Showing keyword matches instead");
  await expect(page.getByRole("region", { name: "Photos" })).toBeVisible();
  await page.evaluate(async () => {
    const crossAge = (window as any).crossAge as { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
    await crossAge.invoke("run_photo_indexing_queue", { maxJobs: 1, ignoreSettings: true });
  });
  await page.locator(".search-hero-submit").click();

  const grid = page.getByRole("region", { name: "Semantic search results" }).locator(".search-results-grid");
  await expect(grid).toBeVisible({ timeout: 60_000 });
  const firstCard = grid.locator(".search-result-card").first();
  await expect(firstCard).toBeVisible();
  // Thumbnail rendered (img, not the placeholder icon).
  await expect(firstCard.locator("img")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "search-semantic-thumbs.png") });

  // The red photo should rank first for a "red" query.
  const firstName = await firstCard.locator(".search-result-name").textContent();
  expect((firstName || "").toLowerCase()).toContain("red");

  await app.close();
  expect(pageErrors, "renderer page errors").toEqual([]);
});
