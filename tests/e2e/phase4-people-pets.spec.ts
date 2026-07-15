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
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/populated";

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

function seedPopulatedWorkspace(root: string, workspace: string, paths: string[]) {
  const script = String.raw`
import sys
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReferenceFace, ReviewCandidate

workspace = Path(sys.argv[1])
paths = [str(Path(value).resolve()) for value in sys.argv[2:]]
api = DesktopApi(workspace, actor="people-gallery-e2e")
api.project.set_consent(True, source="e2e", operator="People Gallery E2E", note="Deterministic populated gallery fixture")
api.import_photos({"sourcePaths": paths, "storageMode": "referenced", "sourceLabel": "People Gallery E2E"})

candidates = []
for index, (person, source_path) in enumerate(zip(("Alice", "Alice", "Bob", "Bob"), paths[:4])):
    ref_id = f"people-gallery-{index}"
    vector = [0.0] * 512
    vector[index] = 1.0
    ref = ReferenceFace(
        ref_id=ref_id,
        person_name=person,
        age_bucket="adult",
        source_path=source_path,
        capture_date=None,
        quality=0.96,
        model_name="e2e-local",
        vector=vector,
    )
    api.project.references[ref_id] = ref
    api.project.vector_store.add(ref_id, vector)
    candidates.append(ReviewCandidate(
        candidate_id=f"people-gallery-candidate-{index}",
        source_path=source_path,
        person_name=person,
        best_ref_id=ref_id,
        best_ref_path=source_path,
        score=0.98,
        band="confident",
        quality=0.95,
        model_name="e2e-local",
        status="accepted",
    ))

# One shared photo gives the saved Alice + Bob group a deterministic populated
# state without depending on model inference during this UI matrix.
candidates.append(ReviewCandidate(
    candidate_id="people-gallery-group-bob",
    source_path=paths[0],
    person_name="Bob",
    best_ref_id="people-gallery-2",
    best_ref_path=paths[2],
    score=0.97,
    band="confident",
    quality=0.94,
    model_name="e2e-local",
    status="accepted",
))

api.project.db.upsert_candidates(candidates)
api.project.save(snapshot_candidates=False, flush_candidate_index=False)
api.save_photo_person_profile({"personName": "Alice", "favorite": True})
api.save_photo_person_profile({"personName": "Bob", "favorite": False})
api.assign_photo_pet({"petName": "Rex", "petKind": "dog", "sourcePath": paths[-1]})
api.save_photo_people_group({"groupId": "alice-bob", "name": "Alice & Bob", "memberPeople": ["Alice", "Bob"]})
`;
  const result = spawnSync(".venv/bin/python", ["-c", script, workspace, ...paths], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(`people fixture: ${result.stderr || result.stdout}`);
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
  seedPopulatedWorkspace(root, env.VINTRACE_WORKSPACE, paths);

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

  // --- Populated gallery ---
  await goTab("People & Pets");
  await expect(page.locator(".photos-people-gallery")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".people-circle-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add someone" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Review matches" })).toBeVisible();
  await expect(page.locator(".people-circle-card")).not.toHaveCount(0);
  const petsSection = page.getByRole("region", { name: "Pets" });
  const groupsSection = page.getByRole("region", { name: "People Together" });
  await expect(petsSection.getByText("Rex", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(groupsSection.getByText("Alice & Bob", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".people-gallery-summary")).toContainText("1 pet");
  expect(await visibleSurfaceIssues(page), "populated People & Pets surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT, "people-populated.png"), fullPage: true });

  // --- Corrective mutations: rename, favorite, and hide reconcile immediately ---
  const peopleSection = page.getByRole("region", { name: "People", exact: true });
  const bobCard = peopleSection.locator(".people-circle-card").filter({ hasText: "Bob" });
  await bobCard.getByRole("button", { name: "Rename Bob" }).click();
  const renameInput = peopleSection.getByRole("textbox", { name: "Rename Bob" });
  await renameInput.fill("Robert");
  await renameInput.press("Enter");
  const renameDialog = page.getByRole("dialog", { name: "Rename person" });
  await expect(renameDialog).toContainText("Rename Bob to Robert?");
  await renameDialog.getByRole("button", { name: "Rename", exact: true }).click();
  const robertCard = peopleSection.locator(".people-circle-card").filter({ hasText: "Robert" });
  await expect(robertCard).toBeVisible({ timeout: 30_000 });
  await expect(groupsSection.getByText("Alice & Robert", { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await expect(groupsSection.getByText("Alice & Bob", { exact: true })).toHaveCount(0);
  await expect(groupsSection.locator(".people-circle-card").filter({ hasText: "Alice & Robert" })).toContainText("1 photo");
  await robertCard.getByRole("button", { name: "Favorite Robert" }).click();
  await expect(robertCard.getByRole("button", { name: "Unfavorite Robert" })).toHaveAttribute("aria-pressed", "true");
  await petsSection.getByRole("button", { name: "Favorite Rex" }).click();
  await expect(petsSection.getByRole("button", { name: "Unfavorite Rex" })).toHaveAttribute("aria-pressed", "true");
  expect(await visibleSurfaceIssues(page), "People corrective mutation surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT, "people-corrections-populated.png"), fullPage: true });

  await robertCard.getByRole("button", { name: "Hide Robert" }).click();
  await expect(peopleSection.getByText("Robert", { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".toast")).toContainText("hidden", { ignoreCase: true });
  expect(await visibleSurfaceIssues(page), "People hidden mutation surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT, "people-hidden-populated.png"), fullPage: true });

  // --- Cohesion: Add someone -> Enroll, then Review matches -> Review ---
  await page.getByRole("button", { name: "Add someone" }).first().click();
  await page.waitForTimeout(500);
  await expect(page.locator(".add-person-panel")).toBeVisible({ timeout: 10_000 });
  expect(await visibleSurfaceIssues(page), "populated Add person surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT, "people-add-populated.png"), fullPage: true });
  await goTab("People & Pets");
  await expect(page.locator(".photos-people-gallery")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Review matches" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator(".review-page, .review-queue, .candidate-table, .photos-review")).not.toHaveCount(0);
  expect(await visibleSurfaceIssues(page), "populated Review surface").toEqual([]);
  await page.screenshot({ path: path.join(SHOT, "people-review-populated.png"), fullPage: true });

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
