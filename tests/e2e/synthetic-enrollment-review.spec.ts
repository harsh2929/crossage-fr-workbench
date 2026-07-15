import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

function seedReview(projectRoot: string, workspace: string, source: string, env: Record<string, string>) {
  const script = `
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib
from crossage_fr.enroll import ProjectState

source = Path(${JSON.stringify(source)})
source.parent.mkdir(parents=True, exist_ok=True)
image = Image.new("RGB", (320, 240), (38, 64, 92))
draw = ImageDraw.Draw(image)
draw.ellipse((80, 20, 240, 225), fill=(205, 170, 140))
draw.ellipse((115, 92, 132, 110), fill=(25, 25, 30))
draw.ellipse((170, 92, 187, 110), fill=(25, 25, 30))
draw.arc((115, 122, 190, 174), 15, 165, fill=(110, 45, 58), width=5)
image.save(source, format="JPEG", quality=94)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
project = ProjectState(Path(${JSON.stringify(workspace)}))
project.set_consent(True, source="e2e", operator="e2e", scope="synthetic-review")
project.db.upsert_learned_artifact("syn_enroll_e2e", {
    "artifactType": "synthetic_enrollment_review",
    "status": "staged",
    "modelName": "vintrace-siglip2-linear-synthetic-screen",
    "versionKey": "2026-07-12.1",
    "trainingDataHash": source_hash,
    "inputCount": 1,
    "positiveCount": 1,
    "negativeCount": 0,
    "metrics": {
        "quality": 0.94,
        "stableScore": 0.99,
        "originalScore": 0.995,
        "recompressedScore": 0.99,
        "reviewThreshold": 0.951046228,
        "screenAvailable": True,
    },
    "payload": {
        "personName": "Dana",
        "ageBucket": "adult",
        "sourcePath": str(source),
        "sourceHash": source_hash,
        "captureDate": None,
        "captureDateProvenance": "none",
        "bbox": [80, 20, 240, 225],
        "faceIndex": 0,
        "quality": 0.94,
        "poseBucket": "frontal",
        "recognizerModel": "unit-face-model",
        "screenModelId": "vintrace-siglip2-linear-synthetic-screen",
        "screenModelVersion": "2026-07-12.1",
        "screenAvailable": True,
        "reviewReason": "score-threshold",
    },
})
`;
  const result = spawnSync(path.join(projectRoot, ".venv", "bin", "python"), ["-c", script], {
    cwd: projectRoot,
    env,
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "review seed failed");
}

async function dismissModals(page: import("@playwright/test").Page) {
  for (let index = 0; index < 4; index += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

test("held enrollment is visible, responsive, and rejectable from People", async () => {
  test.setTimeout(180_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-synthetic-review-e2e-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const source = path.join(temp, "media", "held.jpg");
  const shotDir = process.env.QA_SHOT_DIR || path.join(temp, "shots");
  mkdirSync(shotDir, { recursive: true });
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  seedReview(projectRoot, workspace, source, env);

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(projectRoot, "desktop/main.cjs")], cwd: projectRoot, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissModals(page);
  await page.locator(".nav-list").getByRole("button", { name: "People & Pets" }).click();
  await page.locator(".section-tab", { hasText: "Add person" }).click();

  const review = page.getByRole("region", { name: "Enrollment authenticity reviews" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.getByText("Dana", { exact: true })).toBeVisible();
  await expect(review.getByText("99% review score", { exact: false })).toBeVisible();
  await expect(review.getByRole("button", { name: "Approve" })).toBeEnabled();
  await expect(review.getByRole("button", { name: "Reject" })).toBeEnabled();

  await page.setViewportSize({ width: 900, height: 700 });
  await review.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await expect(review).toBeInViewport();
  const reviewBox = await review.boundingBox();
  const approveBox = await review.getByRole("button", { name: "Approve" }).boundingBox();
  const rejectBox = await review.getByRole("button", { name: "Reject" }).boundingBox();
  expect(reviewBox && approveBox && rejectBox).toBeTruthy();
  expect((approveBox?.x || 0) + (approveBox?.width || 0)).toBeLessThanOrEqual((reviewBox?.x || 0) + (reviewBox?.width || 0) + 1);
  expect((rejectBox?.x || 0) + (rejectBox?.width || 0)).toBeLessThanOrEqual((reviewBox?.x || 0) + (reviewBox?.width || 0) + 1);
  const controlsOverlap = Boolean(
    approveBox && rejectBox &&
    approveBox.x < rejectBox.x + rejectBox.width &&
    approveBox.x + approveBox.width > rejectBox.x &&
    approveBox.y < rejectBox.y + rejectBox.height &&
    approveBox.y + approveBox.height > rejectBox.y
  );
  expect(controlsOverlap).toBe(false);
  await page.screenshot({ path: path.join(shotDir, "synthetic-enrollment-review.png"), fullPage: false });

  await review.getByRole("button", { name: "Reject" }).click();
  await expect(review).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".notice.ok")).toContainText("rejected", { ignoreCase: true });
  await app.close();
  expect(pageErrors).toEqual([]);
});
