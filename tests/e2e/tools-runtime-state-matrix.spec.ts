import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/tools-runtime";

interface RuntimeFixtures {
  referencePath: string;
  scanFolder: string;
  queueFolderA: string;
  queueFolderB: string;
  watchFolder: string;
  watchSource: string;
}

function runtimeEnv(root: string, temp: string, workspace: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function createRuntimeFixtures(root: string, temp: string, workspace: string): RuntimeFixtures {
  const script = String.raw`
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from crossage_fr.api_server import DesktopApi

root = Path(sys.argv[1])
workspace = Path(sys.argv[2])
refs = root / "refs"
scan = root / "scan-large"
queue_a = root / "queue-a"
queue_b = root / "queue-b"
watch = root / "watch"
for folder in (refs, scan, queue_a, queue_b, watch):
    folder.mkdir(parents=True, exist_ok=True)

def face(seed=0):
    image = Image.new("RGB", (280, 280), (182 + seed % 6, 152, 116))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 280, 52), fill=(34, 74 + seed % 12, 132))
    draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
    draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
    draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
    draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
    draw.rectangle((116, 168, 164, 246), fill=(74, 88 + seed % 18, 138))
    return image

reference = refs / "runtime-person.jpg"
face().save(reference, quality=92)
for index in range(500):
    image = face(index)
    ImageDraw.Draw(image).rectangle((index % 210, 258, index % 210 + 32, 266), fill=(40 + index % 180, 90, 130))
    image.save(scan / f"runtime-{index:04d}.jpg", quality=86)
for folder, count, offset in ((queue_a, 28, 600), (queue_b, 28, 700)):
    for index in range(count):
        face(index + offset).save(folder / f"queued-{offset + index:04d}.jpg", quality=88)
watch_source = root / "watch-source.jpg"
face(900).save(watch_source, quality=90)

api = DesktopApi(workspace, actor="tools-runtime-seed")
api.handle("set_consent", {"value": True, "operator": "Runtime state matrix", "source": "test"})
result = api.handle("enroll", {"personName": "Runtime Person", "ageBucket": "adult", "folder": str(refs), "recursive": True})
assert result["added"] == 1, result
`;
  const result = spawnSync(".venv/bin/python", ["-c", script, temp, workspace], {
    cwd: root,
    env: runtimeEnv(root, temp, workspace),
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`Runtime fixture seed failed: ${result.stderr || result.stdout}`);
  return {
    referencePath: path.join(temp, "refs", "runtime-person.jpg"),
    scanFolder: path.join(temp, "scan-large"),
    queueFolderA: path.join(temp, "queue-a"),
    queueFolderB: path.join(temp, "queue-b"),
    watchFolder: path.join(temp, "watch"),
    watchSource: path.join(temp, "watch-source.jpg"),
  };
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function gotoToolsSection(page: Page, key: "overview" | "scan" | "models" | "diagnostics") {
  await page.locator('.nav-list [data-tab="tools"]').click();
  await page.locator(`.section-tabs [data-section-key="${key}"]`).click();
}

async function capture(page: Page, name: string, label: string) {
  expect(await visibleSurfaceIssues(page), label).toEqual([]);
  await page.screenshot({ path: path.join(SHOT, name) });
}

async function confirmDanger(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Please confirm" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

async function launchRuntimeApp(root: string, env: Record<string, string>) {
  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissDialogs(page);
  return { app, page, pageErrors };
}

test("Tools runtime matrix covers scan lifecycle, queue, watch, review, and repair", async () => {
  test.setTimeout(300_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-tools-runtime-"));
  const workspace = path.join(temp, "workspace");
  const fixtures = createRuntimeFixtures(root, temp, workspace);
  const { app, page, pageErrors } = await launchRuntimeApp(root, runtimeEnv(root, temp, workspace, {
    CROSSAGE_TEST_CAMERA: "1",
    CROSSAGE_TEST_SCAN_ITEM_DELAY_MS: "20",
  }));
  try {
    await gotoToolsSection(page, "scan");
    const scanPage = page.locator(".scan-page");
    await expect(scanPage.locator('.readiness-list .pill.green')).toHaveCount(2);
    await expect(scanPage.locator('.readiness-list .pill.neutral')).toContainText("Folder");

    const camera = page.locator(".camera-panel");
    await expect(camera).toContainText("Camera standby");
    await camera.getByRole("button", { name: "Start camera" }).click();
    await expect(camera.getByRole("button", { name: "Capture best frame" })).toBeEnabled({ timeout: 30_000 });
    await expect(camera.locator(".scanner-stage video.live")).toBeVisible();
    await camera.scrollIntoViewIfNeeded();
    await capture(page, "tools-camera-live.png", "camera live state");
    await camera.getByRole("button", { name: "Capture best frame" }).click();
    await expect(page.locator(".notice")).toContainText("Camera photo saved", { timeout: 30_000 });
    await camera.getByRole("button", { name: "Stop camera" }).click();

    const scanInput = page.getByRole("textbox", { name: "Scan folder", exact: true });
    await scanInput.fill(fixtures.scanFolder);
    await expect(scanPage.locator('.readiness-list .pill.green')).toHaveCount(3);
    await page.locator(".form-panel").getByRole("button", { name: "Scan folder", exact: true }).click();
    await confirmDanger(page);
    const activity = page.locator(".scan-activity").first();
    await expect(activity.locator(".activity-head > span")).toContainText(/Scanning|Rechecking/, { timeout: 30_000 });
    await activity.scrollIntoViewIfNeeded();
    await capture(page, "tools-scan-active.png", "active scan state");

    const scanControls = page.getByRole("group", { name: "Scan controls" });
    await scanControls.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(activity.locator(".activity-head > span")).toHaveText("Paused", { timeout: 30_000 });
    await expect(page.locator(".status-row")).toContainText("Scan paused");
    await expect(page.locator(".status-row").getByRole("button", { name: "Resume scan" })).toBeVisible();
    await capture(page, "tools-scan-paused.png", "paused scan state");

    await scanControls.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(activity.locator(".activity-head > span")).toContainText(/Scanning|Rechecking/, { timeout: 30_000 });
    await capture(page, "tools-scan-resumed.png", "resumed scan state");
    await scanControls.getByRole("button", { name: "Cancel scan" }).click();
    await expect(page.locator(".status-row")).toContainText("Cancelling scan");
    await expect(activity.locator(".activity-head > span")).toHaveText("Cancelled", { timeout: 60_000 });
    await capture(page, "tools-scan-cancelled.png", "cancelled scan state");

    const queuePanel = page.locator(".scan-queue-panel");
    for (const folder of [fixtures.queueFolderA, fixtures.queueFolderB]) {
      await scanInput.fill(folder);
      await queuePanel.getByRole("button", { name: "Add", exact: true }).click();
    }
    await expect(queuePanel.locator(".scan-queue-row.queued")).toHaveCount(2);
    await queuePanel.scrollIntoViewIfNeeded();
    await capture(page, "tools-queue-queued.png", "queued folders state");
    await queuePanel.getByRole("button", { name: "Run", exact: true }).click();
    await expect(queuePanel.locator(".scan-queue-row.running")).toHaveCount(1, { timeout: 30_000 });
    await capture(page, "tools-queue-running.png", "running queue state");
    await expect(queuePanel.locator(".scan-queue-row.done")).toHaveCount(2, { timeout: 120_000 });
    await capture(page, "tools-queue-complete.png", "completed queue state");

    const missingFolder = path.join(temp, "missing-folder");
    await scanInput.fill(missingFolder);
    await queuePanel.getByRole("button", { name: "Add", exact: true }).click();
    await queuePanel.getByRole("button", { name: "Run", exact: true }).click();
    const failedQueueRow = queuePanel.locator(".scan-queue-row.error");
    await expect(failedQueueRow).toHaveCount(1, { timeout: 60_000 });
    await expect(queuePanel.getByRole("button", { name: "Retry failed" })).toBeEnabled();
    await failedQueueRow.scrollIntoViewIfNeeded();
    await capture(page, "tools-queue-failed.png", "failed queue state");
    await queuePanel.getByRole("button", { name: "Retry failed" }).click();
    await expect(queuePanel.locator(".scan-queue-row.queued")).toHaveCount(1);
    await queuePanel.getByRole("button", { name: /Remove missing-folder/ }).click();

    await scanInput.fill(fixtures.watchFolder);
    await page.locator(".form-panel").getByRole("button", { name: "Watch for new files" }).click();
    await expect(activity).toContainText("Watching for new media files", { timeout: 30_000 });
    await expect(activity.locator(".activity-head > span")).toHaveText("Watching");
    await activity.scrollIntoViewIfNeeded();
    await capture(page, "tools-watch-active.png", "active watch state");
    copyFileSync(fixtures.watchSource, path.join(fixtures.watchFolder, "watched-runtime.jpg"));
    await expect(activity).toContainText(/Processed 1 new file|Scanning 1 new file/, { timeout: 60_000 });
    await activity.scrollIntoViewIfNeeded();
    await capture(page, "tools-watch-processed.png", "watch ingestion state");
    await page.locator(".form-panel").getByRole("button", { name: /Stop watching|Watching/ }).click();

    await page.locator('.nav-list [data-tab="people"]').click();
    await page.locator('.section-tabs [data-section-key="review"]').click();
    const review = page.locator(".review-queue-panel");
    await expect(review.locator(".review-candidate-row").first()).toBeVisible({ timeout: 60_000 });
    await review.scrollIntoViewIfNeeded();
    await capture(page, "tools-review-populated.png", "populated review state");
    const preview = page.locator(".preview-panel");
    await preview.locator(".review-actions").getByRole("button", { name: "Looks right" }).click();
    const decisionReceipt = review.locator(".undo-strip");
    await expect(decisionReceipt.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(decisionReceipt.getByRole("button", { name: "Undo decision" })).toBeEnabled();
    await decisionReceipt.scrollIntoViewIfNeeded();
    await capture(page, "tools-review-accepted.png", "accepted review state");

    rmSync(fixtures.referencePath);
    await gotoToolsSection(page, "diagnostics");
    const diagnostics = page.locator(".diagnostics-health-summary");
    await diagnostics.getByRole("button", { name: "Check health" }).click();
    await expect(page.locator(".notice")).toContainText("App folder check complete", { timeout: 30_000 });
    await diagnostics.getByRole("button", { name: "Open diagnostics" }).click();
    await expect(page.locator('.nav-list [data-tab="settings"]')).toHaveClass(/active/);
    await expect(page.locator('.section-tabs [data-section-key="storage"]')).toHaveAttribute("aria-selected", "true");
    const healthPanel = page.locator(".workspace-health-panel");
    await expect(healthPanel).toContainText("Missing saved photos");
    await expect(healthPanel.getByRole("button", { name: "Repair missing links" })).toBeEnabled();
    await healthPanel.scrollIntoViewIfNeeded();
    await capture(page, "tools-repair-ready.png", "repair-ready diagnostics state");

    await healthPanel.getByRole("button", { name: "Repair missing links" }).click();
    const repairDialog = page.getByRole("dialog", { name: "Please confirm" });
    await expect(repairDialog).toContainText("Remove 1 missing saved photo link");
    await capture(page, "tools-repair-confirmation.png", "repair confirmation state");
    await repairDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".notice")).toContainText("Repair cancelled");
    await healthPanel.getByRole("button", { name: "Repair missing links" }).click();
    await page.getByRole("dialog", { name: "Please confirm" }).getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(".notice")).toContainText("Repaired app folder", { timeout: 60_000 });
    await expect(healthPanel).toContainText("Last repair removed 1 saved photo link");
    await capture(page, "tools-repair-complete.png", "repair complete state");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Tools camera permission failure is actionable and path-free", async () => {
  test.setTimeout(120_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-tools-camera-error-"));
  const workspace = path.join(temp, "workspace");
  const { app, page, pageErrors } = await launchRuntimeApp(root, runtimeEnv(root, temp, workspace, { CROSSAGE_TEST_CAMERA_ERROR: "1" }));
  try {
    await gotoToolsSection(page, "scan");
    const camera = page.locator(".camera-panel");
    await camera.getByRole("button", { name: "Start camera" }).click();
    await expect(camera.locator(".scanner-state")).toHaveText("Needs access");
    await expect(camera).toContainText("Camera permission was denied.");
    await expect(camera).toContainText("Check camera permission, then try again.");
    expect(await camera.innerText()).not.toContain(root);
    await camera.scrollIntoViewIfNeeded();
    await capture(page, "tools-camera-permission-error.png", "camera permission failure state");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
