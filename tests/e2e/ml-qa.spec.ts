/**
 * End-to-end QA of the real Electron app with the on-device ML models ENABLED
 * (no CROSSAGE_FORCE_FALLBACK, so BiRefNet / SigLIP2 / Depth-Anything engage from
 * the vendored model packs). Walks every nav view capturing screenshots +
 * console/page errors, then exercises the three ML commands over the real
 * window.crossAge IPC bridge. Screenshots land in SHOT_DIR for visual QA.
 *
 * Run: npx playwright test tests/e2e/ml-qa.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT_DIR =
  process.env.QA_SHOT_DIR ||
  "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/qa-shots";

const NAV_VIEWS = ["Dashboard", "Enroll", "Scan", "Review", "Photos", "Settings"];

function makeFixtures(dir: string): { red: string; blue: string; checker: string } {
  mkdirSync(dir, { recursive: true });
  const red = path.join(dir, "red.png");
  const blue = path.join(dir, "blue.png");
  const checker = path.join(dir, "checker.png");
  const py = [
    "from PIL import Image",
    "import numpy as np",
    `Image.new('RGB',(256,256),(220,20,20)).save(r'${red}')`,
    `Image.new('RGB',(256,256),(20,40,220)).save(r'${blue}')`,
    "s=192; c=12; yy,xx=np.mgrid[0:s,0:s]; p=(((xx//c)+(yy//c))%2).astype('uint8')*255",
    "import numpy as _n; rgb=_n.dstack([p,_n.roll(p,c,axis=1),255-p]).astype('uint8')",
    `Image.fromarray(rgb,'RGB').save(r'${checker}')`,
  ].join("\n");
  const res = spawnSync(".venv/bin/python", ["-c", py], { cwd: process.cwd(), encoding: "utf-8" });
  if (res.status !== 0) throw new Error("fixture generation failed: " + (res.stderr || res.stdout));
  return { red, blue, checker };
}

async function unwrap<T = any>(page: Page, command: string, params: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    async ({ command, params }) => {
      const crossAge = (window as any).crossAge as { invoke<R>(c: string, p?: Record<string, unknown>): Promise<R> };
      const raw: any = await crossAge.invoke(command, params);
      return raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
    },
    { command, params },
  );
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

test("ML-enabled end-to-end QA: nav walk + screenshots + ML command IPC", async () => {
  test.setTimeout(240_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-ml-qa-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const fixtures = makeFixtures(path.join(temp, "fixtures"));
  mkdirSync(SHOT_DIR, { recursive: true });

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
    // NOTE: intentionally NOT setting CROSSAGE_FORCE_FALLBACK so the ML engines engage.
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const report: Record<string, unknown> = {};

  const app = await electron.launch({ args: [path.join(projectRoot, "desktop/main.cjs")], cwd: projectRoot, env });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  // 1) Walk every nav view, screenshot each, note per-view console errors.
  const perViewErrors: Record<string, number> = {};
  for (const view of NAV_VIEWS) {
    const before = consoleErrors.length;
    const btn = page.locator(".nav-list").getByRole("button", { name: view });
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(900);
      await dismissModals(page);
      await page.screenshot({ path: path.join(SHOT_DIR, `view-${view.toLowerCase()}.png`), fullPage: false }).catch(() => undefined);
    }
    perViewErrors[view] = consoleErrors.length - before;
  }
  report.perViewConsoleErrors = perViewErrors;

  // 2) Import fixtures into the library (Photos).
  const imported = await unwrap(page, "import_photos", {
    sourcePaths: [fixtures.red, fixtures.blue, fixtures.checker],
    storageMode: "referenced",
    sourceLabel: "ML QA",
  });
  report.import = { importedCount: (imported as any)?.importedCount };

  // 3) Semantic search (SigLIP2) over the real IPC path.
  const sem = await unwrap(page, "semantic_search_photos", { query: "a solid red image", limit: 5 });
  report.semantic = {
    available: (sem as any)?.available,
    scored: (sem as any)?.scored,
    top: ((sem as any)?.results || []).map((r: any) => path.basename(r.sourcePath || "")),
    reason: (sem as any)?.reason,
  };

  // 4) Portrait blur (Depth-Anything-V2).
  const blur = await unwrap(page, "export_photo_portrait_blur", { sourcePath: fixtures.checker, blurStrength: 16 });
  report.portraitBlur = {
    depthModel: (blur as any)?.depthModel,
    targetExists: (blur as any)?.targetPath ? existsSync((blur as any).targetPath) : false,
    algorithm: (blur as any)?.blur?.algorithm,
  };

  // 5) Subject cutout (BiRefNet) — the ML-upgraded existing command.
  let cut: any = null;
  let cutoutTargetExists = false;
  try {
    cut = await unwrap(page, "export_photo_subject_cutout", { sourcePath: fixtures.red, exportVariant: "cutout" });
    cutoutTargetExists = typeof cut?.targetPath === "string" && existsSync(cut.targetPath);
  } catch (e) {
    cut = { error: (e as Error).message };
  }
  report.cutout = { targetPath: cut?.targetPath, targetExists: cutoutTargetExists, algorithm: cut?.mask?.algorithm };

  // Final screenshot of Photos view with the imported library.
  await page.locator(".nav-list").getByRole("button", { name: "Photos" }).click().catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT_DIR, "photos-with-library.png") }).catch(() => undefined);

  report.consoleErrors = consoleErrors.slice(0, 40);
  report.pageErrors = pageErrors;
  console.log("QA_REPORT " + JSON.stringify(report, null, 2));

  await app.close();

  // Health assertions (after the report is printed so failures are diagnosable).
  expect(pageErrors, "renderer page errors").toEqual([]);
  expect((imported as any)?.importedCount, "imported 3 fixtures").toBe(3);
  // ML models are vendored + FORCE_FALLBACK is off, so these must be the model paths.
  expect((sem as any)?.available, "semantic search available").toBe(true);
  expect(report.semantic && (report.semantic as any).top?.[0], "red ranks first").toBe("red.png");
  expect((blur as any)?.depthModel, "portrait blur used depth model").toBeTruthy();
  expect((blur as any)?.blur?.algorithm, "depth-aware blur").toBe("depth-anything-v2");
  expect(cutoutTargetExists, "cutout png written").toBe(true);
});

test("ML UI affordances: AI search box + Portrait blur button (clicked)", async () => {
  test.setTimeout(240_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-ml-ui-"));
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
  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);

  await unwrap(page, "import_photos", {
    sourcePaths: [fixtures.red, fixtures.blue, fixtures.checker],
    storageMode: "referenced",
    sourceLabel: "ML UI QA",
  });

  await page.locator(".nav-list").getByRole("button", { name: "Photos" }).click();
  await dismissModals(page);
  await page.locator(".photos-rail").getByRole("button", { name: /^All Photos\b/ }).first().click().catch(() => undefined);
  await expect(page.locator(".photo-tile-wrap").first()).toBeVisible({ timeout: 30_000 });

  // --- AI (semantic) search box ---
  const aiInput = page.getByRole("searchbox", { name: "Search photos by meaning" });
  await aiInput.fill("a solid red image");
  await page.getByRole("button", { name: "Search by meaning" }).click();
  const semanticPanel = page.locator(".photos-semantic-search");
  await expect(semanticPanel).toBeVisible({ timeout: 30_000 });
  await expect(semanticPanel.locator(".photo-semantic-score").first()).toBeVisible({ timeout: 30_000 });
  const topScore = await semanticPanel.locator(".photo-semantic-score").first().textContent();
  await page.screenshot({ path: path.join(SHOT_DIR, "ui-semantic-search.png") });

  // --- Portrait blur button (lightbox) ---
  await page.getByRole("button", { name: /^Open photo/ }).first().click();
  const blurBtn = page.getByRole("button", { name: "Export depth-aware portrait blur PNG" });
  await expect(blurBtn).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "ui-lightbox-portrait-button.png") });
  await blurBtn.click();
  await expect(page.getByText(/portrait blur/i).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "ui-portrait-blur-done.png") });

  console.log("UI_QA topSemanticScore=" + topScore);
  await app.close();
  expect(pageErrors, "renderer page errors").toEqual([]);
});
