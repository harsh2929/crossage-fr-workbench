import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { visibleSurfaceIssues } from "./ui-surface-audit";


function seedAgeReview(projectRoot: string, workspace: string, env: Record<string, string>) {
  const script = String.raw`
from pathlib import Path
import hashlib

from PIL import Image, ImageDraw

from crossage_fr.enroll import ProjectState
from crossage_fr.match.age_trajectory import IMAGE_AGE_AUGMENTATION_METHOD_VERSION
from crossage_fr.models import ReferenceFace

workspace = Path(${JSON.stringify(workspace)})
project = ProjectState(workspace, actor="synthetic-age-e2e")
project.set_consent(True, source="e2e", operator="e2e", scope="synthetic-age-review")

source = workspace.parent / "media" / "dana-source.jpg"
source.parent.mkdir(parents=True, exist_ok=True)
source_image = Image.new("RGB", (320, 320), (45, 72, 98))
source_draw = ImageDraw.Draw(source_image)
source_draw.ellipse((82, 34, 238, 236), fill=(220, 178, 148))
source_draw.ellipse((120, 112, 138, 130), fill=(25, 25, 30))
source_draw.ellipse((180, 112, 198, 130), fill=(25, 25, 30))
source_draw.arc((120, 145, 198, 198), 15, 165, fill=(105, 45, 58), width=5)
source_image.save(source, format="JPEG", quality=94)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

vector = [0.0] * 512
vector[0] = 1.0
parent = ReferenceFace(
    ref_id="ref_synthetic_age_e2e_parent",
    person_name="Dana",
    age_bucket="adult",
    source_path=str(source),
    capture_date=None,
    quality=0.96,
    model_name="e2e-local",
    vector=vector,
    source_hash=source_hash,
)
project.references[parent.ref_id] = parent
project.vector_store.add(parent.ref_id, vector)
project._mark_reference_dirty(parent.ref_id)

generated = project.synthetic_age_images_path / "reviewed-senior.png"
generated_image = Image.new("RGB", (320, 320), (48, 69, 90))
generated_draw = ImageDraw.Draw(generated_image)
generated_draw.ellipse((82, 34, 238, 236), fill=(198, 160, 136))
generated_draw.line((105, 101, 148, 96), fill=(214, 214, 220), width=4)
generated_draw.line((172, 96, 215, 101), fill=(214, 214, 220), width=4)
generated_draw.ellipse((120, 112, 138, 130), fill=(25, 25, 30))
generated_draw.ellipse((180, 112, 198, 130), fill=(25, 25, 30))
generated_draw.arc((120, 145, 198, 198), 15, 165, fill=(105, 45, 58), width=5)
generated_image.save(generated, format="PNG")
generated_hash = hashlib.sha256(generated.read_bytes()).hexdigest()

project.db.upsert_learned_artifact("syn_age_img_e2e", {
    "artifactType": "synthetic_age_image_review",
    "status": "staged",
    "modelName": "Qwen/Qwen-Image-Edit-2511",
    "versionKey": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
    "trainingDataHash": source_hash,
    "inputCount": 1,
    "positiveCount": 1,
    "negativeCount": 0,
    "metrics": {
        "quality": 0.91,
        "targetIdentityCosine": 0.93,
        "parentCosine": 0.92,
        "nearestOtherCosine": 0.18,
        "identityMargin": 0.75,
        "reasons": [],
    },
    "payload": {
        "personName": "Dana",
        "parentRefId": parent.ref_id,
        "parentSourceHash": source_hash,
        "generatedPath": project._synthetic_age_image_storage_key(generated),
        "generatedHash": generated_hash,
        "targetAgeBucket": "senior",
        "recognizerModel": "e2e-local",
        "authenticCapture": False,
        "futureAppearancePrediction": False,
        "generationProvenance": {
            "model": {
                "id": "Qwen/Qwen-Image-Edit-2511",
                "revision": "e2e-pinned-fixture",
                "license": "Apache-2.0",
            },
        },
    },
})
project.save()
`;
  const result = spawnSync(path.join(projectRoot, ".venv", "bin", "python"), ["-c", script], {
    cwd: projectRoot,
    env,
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "synthetic age review seed failed");
}


async function dismissModals(page: Page) {
  for (let index = 0; index < 4; index += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}


test("synthetic age portrait is private, reviewable, responsive, and rejectable", async () => {
  test.setTimeout(180_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-synthetic-age-e2e-"));
  const workspace = path.join(temp, "workspace");
  const generatedPath = path.join(workspace, "synthetic-age-images", "reviewed-senior.png");
  const shotDir = process.env.QA_SHOT_DIR || path.join(temp, "shots");
  mkdirSync(shotDir, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  seedAgeReview(projectRoot, workspace, env);
  expect(existsSync(generatedPath)).toBe(true);

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(projectRoot, "desktop/main.cjs")], cwd: projectRoot, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissModals(page);
    await page.locator(".nav-list").getByRole("button", { name: "People & Pets" }).click();
    await page.locator(".section-tab", { hasText: "Add person" }).click();

    const review = page.getByRole("region", { name: "Synthetic age-reference reviews" });
    await expect(review).toBeVisible({ timeout: 30_000 });
    await expect(review).toContainText("Dana");
    await expect(review).toContainText("Senior");
    await expect(review).toContainText("93% identity");
    const image = review.getByRole("img", { name: "AI-generated age reference: Dana (Senior)" });
    await expect(image).toBeVisible();
    expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(review.getByRole("button", { name: "Approve" })).toBeEnabled();
    await expect(review.getByRole("button", { name: "Delete" })).toBeEnabled();

    const personCard = page.locator(".person-card").filter({ hasText: "Dana" });
    await personCard.locator(".person-name").click();
    await expect(personCard.getByText("AI age reference", { exact: true })).toBeVisible();
    await expect(personCard.getByRole("combobox", { name: "Target age range: Dana" })).toBeEnabled();
    await expect(personCard.getByRole("button", { name: "Generate" })).toBeEnabled();

    await page.setViewportSize({ width: 620, height: 800 });
    await review.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(await visibleSurfaceIssues(page), "synthetic age review compact surface").toEqual([]);
    const reviewBox = await review.boundingBox();
    const approveBox = await review.getByRole("button", { name: "Approve" }).boundingBox();
    const deleteBox = await review.getByRole("button", { name: "Delete" }).boundingBox();
    expect(reviewBox && approveBox && deleteBox).toBeTruthy();
    expect((approveBox?.x || 0) + (approveBox?.width || 0)).toBeLessThanOrEqual((reviewBox?.x || 0) + (reviewBox?.width || 0) + 1);
    expect((deleteBox?.x || 0) + (deleteBox?.width || 0)).toBeLessThanOrEqual((reviewBox?.x || 0) + (reviewBox?.width || 0) + 1);
    await page.screenshot({ path: path.join(shotDir, "synthetic-age-image-review.png"), fullPage: false });

    await review.getByRole("button", { name: "Delete" }).click();
    await expect(review).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".notice.ok")).toContainText("private image deleted", { ignoreCase: true });
    expect(existsSync(generatedPath)).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
