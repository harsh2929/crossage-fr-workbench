import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/populated";

function makeFixtures(directory: string) {
  mkdirSync(directory, { recursive: true });
  const fixtures = [
    { name: "beach-sunset.png", color: [235, 125, 72] },
    { name: "mountain-hike.png", color: [74, 145, 116] },
    { name: "birthday-cake.png", color: [167, 102, 190] },
  ];
  const script = ["from PIL import Image"];
  for (const fixture of fixtures) {
    script.push(`Image.new('RGB',(320,240),(${fixture.color.join(",")})).save(r'${path.join(directory, fixture.name)}')`);
  }
  const result = spawnSync(".venv/bin/python", ["-c", script.join("\n")], { cwd: process.cwd(), encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`Search fixtures failed: ${result.stderr || result.stdout}`);
  return fixtures.map((fixture) => path.join(directory, fixture.name));
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function submitSearch(page: Page, value: string) {
  await page.locator(".search-hero-input").fill(value);
  await page.locator(".search-hero-submit").click();
  await expect(page.locator(".search-status, .search-results").first()).toBeVisible({ timeout: 30_000 });
}

test("Search state matrix renders AI unavailable, lexical results, and no results coherently", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-search-states-"));
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
      await crossAge.invoke("import_photos", { sourcePaths, storageMode: "referenced", sourceLabel: "Search state QA" });
    }, media);

    await page.locator('.nav-list [data-tab="search"]').click();
    await expect(page.locator(".search-view")).toBeVisible();
    await expect(page.locator(".search-ai-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".search-start")).toContainText("Search your photo library");
    await expect(page.locator(".search-start")).toContainText("after local indexing is ready");
    await expect(page.locator(".search-start")).toContainText("immediately");
    expect(await visibleSurfaceIssues(page), "Search start state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-start-guidance.png"), fullPage: true });

    await submitSearch(page, "beach sunset");
    await expect(page.locator('.search-status[role="alert"]')).toBeVisible();
    await expect(page.locator('.search-status[role="alert"]')).toContainText("On-device AI search is turned off");
    await expect(page.locator('.search-status[role="alert"]')).toContainText("Showing keyword matches instead");
    await expect(page.locator('.search-status[role="alert"]')).not.toContainText("CROSSAGE_FORCE_FALLBACK");
    await expect(page.locator('.search-status[role="alert"]')).not.toContainText("SEMANTIC_ENGINE");
    await expect(page.locator(".search-results")).toBeVisible();
    await expect(page.locator(".search-result-card").first()).toContainText("beach-sunset");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(await visibleSurfaceIssues(page), "AI unavailable state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-ai-unavailable.png"), fullPage: true });

    await page.locator(".search-ai-toggle").click();
    await expect(page.locator(".search-ai-toggle")).toHaveAttribute("aria-pressed", "false");
    await submitSearch(page, "beach");
    await expect(page.locator(".search-results").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".search-result-card").first()).toContainText("beach-sunset");
    await expect(page.locator(".search-result-card").first().locator(".search-result-thumb img")).toBeVisible();
    expect(await visibleSurfaceIssues(page), "lexical populated results").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-lexical-results.png"), fullPage: true });

    await page.locator(".search-result-card").first().click();
    await expect(page.locator('.nav-list [data-tab="library"]')).toHaveAttribute("aria-current", "page");
    const openedResult = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(openedResult).toBeVisible({ timeout: 30_000 });
    await expect(openedResult).toContainText("beach-sunset");
    await page.keyboard.press("Escape");
    await expect(openedResult).toHaveCount(0);
    await page.locator('.nav-list [data-tab="search"]').click();
    await expect(page.locator(".search-view")).toBeVisible();

    await submitSearch(page, "zzzxqvvnotfound");
    await expect(page.locator('.search-status[role="status"]')).toContainText("No matches found");
    await expect(page.locator(".search-results")).toHaveCount(0);
    expect(await visibleSurfaceIssues(page), "lexical no-results state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-no-results.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Search reports partial lexical indexing without hiding available results", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-search-partial-index-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const seed = spawnSync(".venv/bin/python", ["-c", String.raw`
from pathlib import Path
import sys
from crossage_fr.api_server import DesktopApi

workspace = Path(sys.argv[1])
api = DesktopApi(workspace)
api.save_photo_library_settings({"localSettings": {"backgroundIndexingAutoRun": False}})
rows = []
for index in range(1002):
    stamp = f"2026-01-01T00:{index // 60:02d}:{index % 60:02d}Z"
    rows.append((f"asset_partial_{index:04d}", str(workspace / "media" / f"partial-find-{index:04d}.jpg"), stamp, stamp, stamp))
with api.project.db.connect() as conn:
    conn.executemany(
        """
        INSERT INTO photo_assets(asset_id, source_path, source_kind, media_kind, capture_date, added_at, updated_at)
        VALUES(?, ?, 'referenced', 'image', ?, ?, ?)
        """,
        rows,
    )
    api.project.db._index_photo_asset("asset_partial_0000", conn)
`, workspace], { cwd: root, encoding: "utf-8", env: { ...process.env, PYTHONPATH: root } });
  if (seed.status !== 0) throw new Error(seed.stderr || seed.stdout || "Partial-index fixture failed");

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
    await page.locator('.nav-list [data-tab="search"]').click();
    await page.locator(".search-ai-toggle").click();
    await submitSearch(page, "partial-find");
    await expect(page.locator(".search-results").first()).toBeVisible({ timeout: 30_000 });
    const indexing = page.getByRole("status", { name: "Search indexing status" });
    await expect(indexing).toBeVisible();
    await expect(indexing).toContainText("Search results may be incomplete");
    await expect(indexing).toContainText("1 remaining");
    await expect(indexing).toContainText("queued");
    expect(await visibleSurfaceIssues(page), "partial Search index state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-partial-index.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Search discards interrupted responses and recovers from injected failures", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-search-resilience-"));
  const media = makeFixtures(path.join(temp, "media"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_SEARCH_DELAY_QUERY: "slow beach",
    CROSSAGE_TEST_SEARCH_DELAY_MS: "900",
    CROSSAGE_TEST_SEARCH_FAILURE_QUERY: "force-failure",
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
      const crossAge = (window as any).crossAge as { invoke<T>(command: string, params?: Record<string, unknown>): Promise<T> };
      await crossAge.invoke("import_photos", { sourcePaths, storageMode: "referenced", sourceLabel: "Search resilience QA" });
    }, media);
    await page.locator('.nav-list [data-tab="search"]').click();
    await page.locator(".search-ai-toggle").click();

    await page.locator(".search-hero-input").fill("slow beach");
    await page.locator(".search-hero-submit").click();
    await expect(page.locator('.search-status[role="status"]')).toContainText("Searching");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".search-hero-input")).toHaveValue("");
    await page.waitForTimeout(1_200);
    await expect(page.locator(".search-results")).toHaveCount(0);
    await expect(page.locator(".search-start")).toBeVisible();
    await expect(page.locator(".search-status")).toHaveCount(0);

    await submitSearch(page, "force-failure");
    const failure = page.locator('.search-status[role="alert"]');
    await expect(failure).toContainText("Search could not finish. Try again.");
    await expect(failure).not.toContainText("Injected local search failure");
    await expect(failure.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(await visibleSurfaceIssues(page), "Search injected failure state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "search-injected-failure.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
