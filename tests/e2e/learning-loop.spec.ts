import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function confirmDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Please confirm" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

async function closeOnboardingIfVisible(page: Page) {
  await page.getByRole("dialog").last().waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function openSettingsSection(page: Page, section: "Advanced" | "General") {
  await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: section, exact: true }).click();
}

function seedLearningWorkspace(workspace: string, registry: string) {
  const script = String.raw`
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.embed.engine import FallbackEmbeddingEngine
from crossage_fr.enroll.manager import ProjectState
from crossage_fr.ingest.image_io import sha256_file
from crossage_fr.models import EmbeddingResult, ReferenceFace, ReviewCandidate

workspace = Path(sys.argv[1])
workspace.mkdir(parents=True, exist_ok=True)
media = workspace / "seed-media"
media.mkdir(parents=True, exist_ok=True)

def draw_face(path: Path, *, shirt, background, offset=0, hair=(45, 52, 64), smile=(128, 58, 58)):
    img = Image.new("RGB", (280, 280), background)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 280, 48), fill=hair)
    draw.ellipse((80 + offset, 52, 200 + offset, 184), fill=(232, 196, 164))
    draw.ellipse((112 + offset, 96, 126 + offset, 110), fill=(30, 30, 38))
    draw.ellipse((154 + offset, 96, 168 + offset, 110), fill=(30, 30, 38))
    draw.arc((112 + offset, 116, 168 + offset, 156), 12, 168, fill=smile, width=4)
    draw.rectangle((110 + offset, 168, 174 + offset, 252), fill=shirt)
    img.save(path, quality=95)

ref_path = media / "person_a_ref.jpg"
draw_face(ref_path, shirt=(54, 92, 132), background=(180, 154, 126), offset=0)

engine = FallbackEmbeddingEngine()
ref_embedding = engine.embed_image(ref_path)[0]

project = ProjectState(workspace)
project.set_consent(True, source="e2e", operator="Learning Loop E2E", note="Seeded consent for local learning loop E2E.")

project.references.clear()
project.vector_store.clear()
project.references["ref_seed_person_a"] = ReferenceFace(
    ref_id="ref_seed_person_a",
    person_name="Person A",
    age_bucket="adult",
    source_path=str(ref_path),
    capture_date=None,
    quality=0.95,
    model_name=ref_embedding.model_name,
    vector=list(ref_embedding.vector),
    source_hash=sha256_file(ref_path),
    pose_bucket="frontal",
)
project.vector_store.add("ref_seed_person_a", list(ref_embedding.vector))

for i in range(12):
    project.db.add_calibration_label(
        f"e2e_pos_{i}",
        {
            "sourcePath": f"/synthetic/e2e_pos_{i}.jpg",
            "expectedPerson": "Person A",
            "actualPerson": "Person A",
            "matchScore": 0.56 + 0.01 * i,
            "isMatch": True,
            "rawCosine": 0.54 + 0.01 * i,
            "modelName": ref_embedding.model_name,
        },
    )
    project.db.add_calibration_label(
        f"e2e_neg_{i}",
        {
            "sourcePath": f"/synthetic/e2e_neg_{i}.jpg",
            "expectedPerson": "Person A",
            "actualPerson": "",
            "matchScore": 0.10 + 0.01 * i,
            "isMatch": False,
            "rawCosine": 0.08 + 0.01 * i,
            "modelName": ref_embedding.model_name,
        },
    )

staged_calibration = project.stage_calibration_update()
if staged_calibration.get("status") != "staged":
    raise RuntimeError(f"expected staged calibration, got {staged_calibration!r}")

candidate_variants = [
    {"shirt": (68, 116, 92), "background": (182, 154, 118), "offset": 3, "hair": (48, 56, 70)},
    {"shirt": (118, 78, 126), "background": (178, 148, 120), "offset": -4, "hair": (62, 62, 72)},
    {"shirt": (76, 124, 150), "background": (170, 150, 126), "offset": 5, "hair": (38, 58, 82)},
]

selected = None
for index, variant in enumerate(candidate_variants):
    candidate_path = media / f"person_a_candidate_{index}.jpg"
    draw_face(candidate_path, **variant)
    embedding = engine.embed_image(candidate_path)[0]
    candidate = ReviewCandidate(
        candidate_id=f"cand_seed_reference_{index}",
        source_path=str(candidate_path),
        person_name="Person A",
        best_ref_id="ref_seed_person_a",
        best_ref_path=str(ref_path),
        score=0.82,
        band="confident",
        quality=0.92,
        model_name=embedding.model_name,
        status="accepted",
        source_hash=sha256_file(candidate_path),
        pose_bucket="frontal",
        raw_cosine=0.76,
        align_error=0.03,
        ied_px=52.0,
    )
    evaluation = project._evaluate_reference_suggestion(candidate, embedding)
    if evaluation.get("eligible"):
        selected = (candidate, embedding)
        break

if selected is None:
    raise RuntimeError("no synthetic candidate passed reference-suggestion eligibility")

candidate, embedding = selected
project.candidates.clear()
project.candidates[candidate.candidate_id] = candidate
project._mark_candidate_dirty(candidate.candidate_id)
staged_reference = project.stage_reference_suggestions({candidate.candidate_id: embedding}, limit=5)
if staged_reference.get("staged") != 1:
    raise RuntimeError(f"expected one staged reference suggestion, got {staged_reference!r}")

project.save()
  `;

  execFileSync(
    "node",
    [path.join(process.cwd(), "desktop", "scripts", "run-python.cjs"), "-c", script, workspace],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CROSSAGE_FORCE_FALLBACK: "1",
        CROSSAGE_REGISTRY_HOME: registry,
        PYTHONPATH: process.cwd(),
        VINTRACE_REGISTRY_HOME: registry,
        VINTRACE_RUN_PYTHON_USE_ENV_REGISTRY: "1"
      },
      stdio: "inherit"
    }
  );
}

async function launchApp(workspace: string, registry: string, pageErrors: string[]) {
  const projectRoot = process.cwd();
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_REGISTRY_HOME: registry,
    CROSSAGE_WORKSPACE: workspace,
    PYTHONPATH: projectRoot,
    VINTRACE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());

  await expect(page.getByText("Vintrace", { exact: true })).toBeVisible();
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeOnboardingIfVisible(page);
  return { app, page };
}

test("desktop learning loop stages, promotes, rolls back, approves references, and persists learning mode", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-learning-e2e-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const pageErrors: string[] = [];
  seedLearningWorkspace(workspace, registry);

  let launched = await launchApp(workspace, registry, pageErrors);
  let app = launched.app;
  let page = launched.page;

  await openSettingsSection(page, "Advanced");
  const accuracyLab = page.locator(".panel", { hasText: "Accuracy lab" });
  const rdCard = accuracyLab.locator(".validation-pack-card", { hasText: "Self-learning R&D" });
  await expect(rdCard.locator(".status", { hasText: "R&D blocked" })).toBeVisible({ timeout: 120_000 });
  await expect(rdCard.locator(".workspace-health-grid span", { hasText: "Satisfied" }).getByText("5", { exact: true })).toBeVisible();
  await expect(rdCard.locator(".workspace-health-grid span", { hasText: "Blocked" }).getByText("1", { exact: true })).toBeVisible();
  await expect(rdCard.getByText(/phase6\.legalReview/)).toBeVisible();
  await expect(rdCard.getByRole("button", { name: "Update R&D status" })).toBeEnabled();

  const calibrationCard = accuracyLab.locator(".validation-pack-card", { hasText: "Learned calibration" });
  await expect(calibrationCard.locator(".status", { hasText: "Staged" })).toBeVisible({ timeout: 120_000 });
  await expect(calibrationCard.getByText("24", { exact: true })).toBeVisible();

  await expect(calibrationCard.getByRole("button", { name: "Apply learned calibration" })).toBeEnabled();
  await calibrationCard.getByRole("button", { name: "Apply learned calibration" }).click();
  await confirmDialog(page);
  await expect(page.getByText("Learned calibration applied to matching levels.")).toBeVisible({ timeout: 120_000 });
  await expect(calibrationCard.locator(".status", { hasText: "Promoted" })).toBeVisible();

  await expect(calibrationCard.getByRole("button", { name: "Rollback" })).toBeEnabled();
  await calibrationCard.getByRole("button", { name: "Rollback" }).click();
  await confirmDialog(page);
  await expect(page.getByText("Learned calibration rolled back.")).toBeVisible({ timeout: 120_000 });

  await page.locator(".nav-list").getByRole("button", { name: "People" }).click();
  await page.getByRole("tab", { name: "Add person", exact: true }).click();
  const personCard = page.locator(".person-card", { hasText: "Person A" });
  await expect(personCard.locator(".person-count")).toHaveText("1");
  const suggestions = page.locator(".reference-suggestions");
  await expect(suggestions.getByText("1 staged")).toBeVisible({ timeout: 120_000 });
  await suggestions.getByRole("button", { name: "Approve" }).click();
  await confirmDialog(page);
  await expect(page.getByText("Suggested reference added to saved person photos.")).toBeVisible({ timeout: 120_000 });
  await expect(personCard.locator(".person-count")).toHaveText("2", { timeout: 120_000 });

  await openSettingsSection(page, "General");
  await expect(page.getByLabel("Learning mode")).toHaveValue("manual");
  await page.getByLabel("Learning mode").selectOption("auto_stage");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".settings-summary").getByText("Auto-stage")).toBeVisible();

  await app.close();

  launched = await launchApp(workspace, registry, pageErrors);
  app = launched.app;
  page = launched.page;
  await openSettingsSection(page, "General");
  await expect(page.getByLabel("Learning mode")).toHaveValue("auto_stage");
  await expect(page.locator(".settings-summary").getByText("Auto-stage")).toBeVisible();
  await app.close();

  expect(pageErrors).toEqual([]);
});
