/**
 * Phase 4 QA: the dedicated People & Pets ("Browse") face-circle gallery.
 * Verifies the empty state, the populated circle gallery (people + pets + actions),
 * drill-in into the scoped grid, Browse↔Add/Review cohesion, the Library-tab gate
 * (destination must NOT trigger off the people rail item), and no page errors.
 *
 * NOTE: e2e runs the prebuilt dist bundle — run `npm run build` after src edits.
 * Run: npx playwright test tests/e2e/phase4-people-pets.spec.ts --reporter=list
 */
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SHOT = process.env.QA_SHOT_DIR || "/private/tmp/claude-501/-Users-harshbishnoi-face/8cb82d9f-58ab-4fff-a7db-d8bc428637ae/scratchpad/p4-qa";

function makeFixtures(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const names = ["alice1.png", "alice2.png", "bob1.png", "bob2.png", "rex.png"];
  const cols = [[230, 150, 120], [225, 145, 118], [120, 160, 220], [118, 158, 218], [150, 200, 130]];
  const py = ["from PIL import Image"];
  names.forEach((n, i) => py.push(`Image.new('RGB',(320,320),(${cols[i].join(",")})).save(r'${path.join(dir, n)}')`));
  const r = spawnSync(".venv/bin/python", ["-c", py.join("\n")], { cwd: process.cwd(), encoding: "utf-8" });
  if (r.status !== 0) throw new Error("fixtures: " + (r.stderr || r.stdout));
  return names.map((n) => path.join(dir, n));
}

async function dismissModals(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("Phase 4: People & Pets gallery renders, drills in, coheres, gated, no errors", async () => {
  test.setTimeout(240_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-p4-"));
  const media = path.join(temp, "media");
  const paths = makeFixtures(media);
  mkdirSync(SHOT, { recursive: true });
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

  // --- Empty state ---
  await goTab("People & Pets");
  await expect(page.locator(".people-gallery-empty")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".people-gallery-empty").getByRole("button", { name: "Add someone" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOT, "people-empty.png") });

  // --- Populate: consent + import + enroll 2 people + assign a pet ---
  await page.evaluate(async ({ imgs }) => {
    const ca = (window as any).crossAge as { invoke<T>(c: string, p?: Record<string, unknown>): Promise<T> };
    await ca.invoke("set_consent", { value: true });
    const imp = await ca.invoke<{ value: { importedPaths: string[] } }>("import_photos", { sourcePaths: imgs, storageMode: "referenced", sourceLabel: "P4 spec" });
    const imported = imp.value.importedPaths || imgs;
    await ca.invoke("enroll_paths", { personName: "Alice", ageBucket: "adult", paths: imgs.slice(0, 2) });
    await ca.invoke("enroll_paths", { personName: "Bob", ageBucket: "adult", paths: imgs.slice(2, 4) });
    const rex = imported.find((p) => /rex\.png$/.test(p)) || imported[imported.length - 1];
    await ca.invoke("assign_photo_pet", { petName: "Rex", petKind: "dog", sourcePath: rex });
  }, { imgs: paths });

  // --- Populated gallery ---
  await goTab("Library");
  await goTab("People & Pets");
  await expect(page.locator(".photos-people-gallery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".people-circle-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add someone" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Review matches" })).toBeVisible();
  await expect(page.locator(".people-circle-card")).not.toHaveCount(0);
  await page.screenshot({ path: path.join(SHOT, "people.png") });

  // --- Cohesion: Add someone -> Enroll, then Review matches -> Review ---
  await page.getByRole("button", { name: "Add someone" }).first().click();
  await page.waitForTimeout(500);
  await expect(page.locator(".add-person-panel")).toBeVisible({ timeout: 10_000 });
  await goTab("People & Pets");
  await expect(page.locator(".photos-people-gallery")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Review matches" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator(".review-page, .review-queue, .candidate-table, .photos-review")).not.toHaveCount(0);

  // --- Drill-in: open a person -> exits destination into the scoped grid ---
  await goTab("People & Pets");
  await page.locator(".people-circle-cover-btn").first().click();
  await page.waitForTimeout(700);
  await expect(page.locator(".photos-destination")).toHaveCount(0);
  await expect(page.locator(".photos-rail")).toBeVisible();

  // --- Gate: Library-tab people rail item must NOT trigger the gallery ---
  await goTab("Library");
  const peopleSectionHeader = page.locator(".photos-rail").getByRole("button", { name: /People & Pets/ }).first();
  if (await peopleSectionHeader.isVisible().catch(() => false)) {
    await peopleSectionHeader.click().catch(() => undefined);
    await page.waitForTimeout(200);
  }
  const aliceRow = page.locator(".photos-rail .photos-rail-name", { hasText: "Alice" }).first();
  if (await aliceRow.isVisible().catch(() => false)) {
    await aliceRow.click();
    await page.waitForTimeout(500);
    await expect(page.locator(".photos-people-gallery")).toHaveCount(0);
    await expect(page.locator(".photos-rail")).toBeVisible();
  }

  expect(pageErrors, "renderer page errors").toEqual([]);
  await app.close();
});
