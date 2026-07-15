import AxeBuilder from "@axe-core/playwright";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/photo-tether";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function makePhoto(target: string, color: [number, number, number]) {
  const result = spawnSync(".venv/bin/python", ["-c", `from PIL import Image\nImage.new('RGB',(720,480),(${color.join(",")})).save(r'${target}', quality=92)`], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function makeFakeGphoto(target: string, fixture: string) {
  writeFileSync(target, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "gphoto2 2.5.e2e"
  exit 0
fi
if [ "$1" = "--auto-detect" ]; then
  echo "Model                          Port"
  echo "----------------------------------------------------------"
  echo "Vintrace Fixture Camera        usb:009,001"
  exit 0
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--filename" ]; then
    shift
    output="$1"
  fi
  shift
done
output=$(printf "%s" "$output" | sed 's/%C/JPG/g')
cp "${fixture}" "$output"
echo "Saving file as $output"
`, { mode: 0o755 });
  chmodSync(target, 0o755);
}

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function launch(root: string, env: Record<string, string>) {
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
  await dismissDialogs(page);
  return { app, page };
}

async function openTether(page: Page) {
  const launcher = page.getByRole("button", { name: "Tethered capture", exact: true });
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.click();
  const dialog = page.locator(".photo-tether-dialog");
  await expect(dialog).toBeVisible();
  return { launcher, dialog };
}

async function libraryCount(page: Page) {
  return page.evaluate(async () => {
    const result = await window.crossAge.invoke<{ total: number }>("list_photo_folder_items", {
      folderId: "all",
      previewBudget: 0,
      limit: 20,
    });
    return Number(result.total || 0);
  });
}

async function closeApp(app: ElectronApplication | null) {
  if (app) await app.close().catch(() => undefined);
}

test("tether watch resumes after restart and direct PTP capture imports with live review", async () => {
  test.setTimeout(300_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photo-tether-"));
  const captureFolder = path.join(temp, "capture-folder");
  const fixtures = path.join(temp, "fixtures");
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  mkdirSync(captureFolder, { recursive: true });
  mkdirSync(fixtures, { recursive: true });
  const firstFixture = path.join(fixtures, "first.jpg");
  const secondFixture = path.join(fixtures, "second.jpg");
  const cameraFixture = path.join(fixtures, "camera.jpg");
  makePhoto(firstFixture, [42, 126, 198]);
  makePhoto(secondFixture, [48, 158, 103]);
  makePhoto(cameraFixture, [222, 128, 54]);
  const fakeGphoto = path.join(temp, "gphoto2");
  makeFakeGphoto(fakeGphoto, cameraFixture);

  const baseEnv: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS: "1",
    CROSSAGE_GPHOTO2_PATH: fakeGphoto,
    PYTHONPATH: root,
  };
  delete baseEnv.ELECTRON_RUN_AS_NODE;

  let firstApp: ElectronApplication | null = null;
  let secondApp: ElectronApplication | null = null;
  try {
    const firstLaunch = await launch(root, { ...baseEnv, CROSSAGE_TEST_DIALOG_PATHS: captureFolder });
    firstApp = firstLaunch.app;
    const firstPage = firstLaunch.page;
    const pageErrors: string[] = [];
    firstPage.on("pageerror", (error) => pageErrors.push(error.message));
    const firstUi = await openTether(firstPage);
    await expect(firstUi.dialog.getByRole("button", { name: "Watched folder" })).toBeFocused();
    await firstUi.dialog.getByRole("button", { name: "Choose folder" }).click();
    await expect(firstUi.dialog.locator(".photo-tether-folder-row")).toContainText("capture-folder");
    await firstUi.dialog.getByRole("button", { name: "Start session" }).click();
    await expect(firstUi.dialog.getByText("Session active")).toBeVisible({ timeout: 30_000 });

    const partialTarget = path.join(captureFolder, "watch-first.jpg");
    const firstBytes = readFileSync(firstFixture);
    writeFileSync(partialTarget, firstBytes.subarray(0, Math.floor(firstBytes.length / 2)));
    await firstPage.waitForTimeout(500);
    appendFileSync(partialTarget, firstBytes.subarray(Math.floor(firstBytes.length / 2)));
    await expect(firstUi.dialog.locator(".photo-tether-live-review img")).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => libraryCount(firstPage), { timeout: 60_000 }).toBe(1);
    await expect(firstUi.dialog.locator(".photo-tether-history li")).toHaveCount(1);
    await expect(firstUi.dialog.locator(".photo-tether-history li").first()).toContainText("Imported");
    await firstPage.screenshot({ path: path.join(SHOT, "tether-watch-desktop.png"), fullPage: true });
    expect(pageErrors).toEqual([]);

    await closeApp(firstApp);
    firstApp = null;

    const secondLaunch = await launch(root, { ...baseEnv, CROSSAGE_TEST_DIALOG_PATHS: captureFolder });
    secondApp = secondLaunch.app;
    const page = secondLaunch.page;
    const resumedUi = await openTether(page);
    await expect(resumedUi.dialog.getByText("Session active")).toBeVisible({ timeout: 30_000 });
    await expect(resumedUi.dialog.getByRole("button", { name: "Stop session" })).toBeVisible();

    copyFileSync(secondFixture, path.join(captureFolder, "watch-second.jpg"));
    await expect.poll(() => libraryCount(page), { timeout: 60_000 }).toBe(2);
    await expect(resumedUi.dialog.locator(".photo-tether-history li")).toHaveCount(2);
    await resumedUi.dialog.getByRole("button", { name: "Stop session" }).click();
    await expect(resumedUi.dialog.getByRole("button", { name: "Start session" })).toBeVisible();

    await resumedUi.dialog.getByRole("button", { name: "Direct camera" }).click();
    await expect(resumedUi.dialog.locator(".photo-tether-camera-status")).toContainText("1 supported camera detected", { timeout: 30_000 });
    await resumedUi.dialog.getByRole("button", { name: "Choose folder" }).click();
    await resumedUi.dialog.getByRole("button", { name: "Start session" }).click();
    await expect(resumedUi.dialog.getByRole("button", { name: "Capture", exact: true })).toBeVisible({ timeout: 30_000 });
    await resumedUi.dialog.getByRole("button", { name: "Capture", exact: true }).click();
    await expect.poll(() => libraryCount(page), { timeout: 60_000 }).toBe(3);
    await expect(resumedUi.dialog.locator(".photo-tether-live-review img")).toBeVisible();
    await expect(resumedUi.dialog.locator(".photo-tether-history li").first()).toContainText("Imported");

    const imageReady = await resumedUi.dialog.locator(".photo-tether-live-review img").evaluate((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth === 720 && image.naturalHeight === 480;
    });
    expect(imageReady).toBe(true);
    const desktopAxe = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).include(".photo-tether-dialog").analyze();
    expect(desktopAxe.violations, "desktop tether accessibility").toEqual([]);
    expect((await visibleSurfaceIssues(page)).filter((issue) => /photo-tether/.test(issue.className)), "desktop tether geometry").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "tether-ptp-desktop.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 740 });
    const compactGeometry = await resumedUi.dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const footer = node.querySelector<HTMLElement>(".photo-tether-actions")?.getBoundingClientRect();
      const body = node.querySelector<HTMLElement>(".photo-tether-body")?.getBoundingClientRect();
      return {
        insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        bodyBeforeFooter: Boolean(body && footer && body.bottom <= footer.top + 1),
      };
    });
    expect(compactGeometry).toEqual({ insideViewport: true, bodyBeforeFooter: true });
    const compactAxe = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).include(".photo-tether-dialog").analyze();
    expect(compactAxe.violations, "compact tether accessibility").toEqual([]);
    expect((await visibleSurfaceIssues(page)).filter((issue) => /photo-tether/.test(issue.className)), "compact tether geometry").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "tether-ptp-compact.png"), fullPage: true });

    const focusable = resumedUi.dialog.locator("button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled)");
    await focusable.last().focus();
    await page.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(focusable.last()).toBeFocused();

    await resumedUi.dialog.getByRole("button", { name: "Stop session" }).click();
    await resumedUi.dialog.getByRole("button", { name: "Close" }).click();
    await expect(resumedUi.launcher).toBeFocused();
  } finally {
    await closeApp(firstApp);
    await closeApp(secondApp);
  }
});
