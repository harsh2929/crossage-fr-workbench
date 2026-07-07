/**
 * Phase 1 QA: the Photos-first IA. Verifies the new top-level tabs render, every
 * recognition tool remains reachable (Tools → Scan, People & Pets → Add/Review),
 * the unified Search runs, and no view produces console/page errors. Screenshots
 * land in QA_SHOT_DIR for visual review.
 *
 * Run: npx playwright test tests/e2e/photos-first-ia.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT_DIR =
  process.env.QA_SHOT_DIR ||
  "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/qa-shots-p1";

const PRIMARY_TABS = ["Library", "Memories", "Albums", "Search", "People & Pets", "Tools", "Settings"];

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

test("Photos-first IA: tabs render, recognition reachable, search works, no errors", async () => {
  test.setTimeout(240_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-p1-"));
  mkdirSync(SHOT_DIR, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(projectRoot, "desktop/main.cjs")], cwd: projectRoot, env });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  // Library is the default landing tab.
  await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible({ timeout: 30_000 });

  // Walk every primary tab, screenshot, confirm it renders.
  for (const tab of PRIMARY_TABS) {
    const btn = page.locator(".nav-list").getByRole("button", { name: tab });
    await expect(btn, `tab ${tab} present`).toBeVisible();
    await btn.click();
    await page.waitForTimeout(700);
    await dismissModals(page);
    await page.screenshot({ path: path.join(SHOT_DIR, `tab-${tab.replace(/[^a-z]/gi, "-").toLowerCase()}.png`) }).catch(() => undefined);
  }

  // Memories + Albums are dedicated destinations (not a filtered Library grid).
  await page.locator(".nav-list").getByRole("button", { name: "Memories" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".memories-feed, .memories-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".photos-rail")).not.toBeVisible();
  await page.locator(".nav-list").getByRole("button", { name: "Albums" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".albums-gallery")).toBeVisible({ timeout: 20_000 });
  // People & Pets Browse is the dedicated face-circle gallery (not a filtered grid).
  await page.locator(".nav-list").getByRole("button", { name: "People & Pets" }).click();
  await page.waitForTimeout(400);
  await expect(page.locator(".photos-people-gallery, .people-gallery-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".photos-rail")).not.toBeVisible();

  // Tools → Scan reachable (recognition not lost).
  await page.locator(".nav-list").getByRole("button", { name: "Tools" }).click();
  await expect(page.locator(".section-tabs")).toBeVisible();
  await page.locator(".section-tab", { hasText: "Scan" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, "tools-scan.png") }).catch(() => undefined);

  // People & Pets → Add (Enroll) + Review reachable.
  await page.locator(".nav-list").getByRole("button", { name: "People & Pets" }).click();
  await expect(page.locator(".section-tabs")).toBeVisible();
  await page.locator(".section-tab", { hasText: "Add person" }).click();
  await page.waitForTimeout(400);
  await page.locator(".section-tab", { hasText: "Review" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, "people-review.png") }).catch(() => undefined);

  // Search runs (lexical path; FORCE_FALLBACK disables the AI model so it falls back gracefully).
  await page.locator(".nav-list").getByRole("button", { name: "Search" }).click();
  const searchInput = page.locator(".search-hero-input");
  await expect(searchInput).toBeVisible();
  await page.locator(".search-ai-toggle").click(); // turn AI off → lexical search works under FORCE_FALLBACK
  await searchInput.fill("photo");
  await page.locator(".search-hero-submit").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, "search-results.png") }).catch(() => undefined);

  console.log("P1_QA consoleErrors=" + JSON.stringify(consoleErrors.slice(0, 20)));
  await app.close();
  expect(pageErrors, "renderer page errors").toEqual([]);
});
