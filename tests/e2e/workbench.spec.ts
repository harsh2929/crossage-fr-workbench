import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function makeFixtures(root: string) {
  const refs = path.join(root, "refs");
  const adultRefs = path.join(root, "refs-adult");
  const scan = path.join(root, "scan");
  const python = path.join(process.cwd(), ".venv", "bin", "python");
  execFileSync(python, [
    "-c",
    `
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(${JSON.stringify(root)})
refs = root / "refs"
adult_refs = root / "refs-adult"
scan = root / "scan"
refs.mkdir(parents=True, exist_ok=True)
adult_refs.mkdir(parents=True, exist_ok=True)
scan.mkdir(parents=True, exist_ok=True)
img = Image.new("RGB", (280, 280), (182, 152, 116))
draw = ImageDraw.Draw(img)
draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
draw.rectangle((116, 168, 164, 246), fill=(74, 88, 138))
img.save(refs / "person_a.jpg", quality=95)
img.save(scan / "candidate_a.jpg", quality=95)
adult = Image.new("RGB", (280, 280), (176, 154, 126))
draw = ImageDraw.Draw(adult)
draw.rectangle((0, 0, 280, 52), fill=(62, 68, 76))
draw.ellipse((78, 52, 202, 184), fill=(226, 190, 158))
draw.ellipse((110, 96, 124, 110), fill=(32, 32, 38))
draw.ellipse((156, 96, 170, 110), fill=(32, 32, 38))
draw.arc((112, 116, 170, 156), 12, 168, fill=(110, 52, 52), width=4)
draw.rectangle((108, 168, 172, 252), fill=(52, 92, 112))
adult.save(adult_refs / "person_a_adult.jpg", quality=95)
(scan / "broken.jpg").write_bytes(b"not an image")
    `
  ]);
  return { refs, adultRefs, scan };
}

function writeFaceFixture(folder: string, filename: string) {
  const python = path.join(process.cwd(), ".venv", "bin", "python");
  execFileSync(python, [
    "-c",
    `
from pathlib import Path
from PIL import Image, ImageDraw
folder = Path(${JSON.stringify(folder)})
folder.mkdir(parents=True, exist_ok=True)
img = Image.new("RGB", (280, 280), (182, 152, 116))
draw = ImageDraw.Draw(img)
draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
draw.rectangle((116, 168, 164, 246), fill=(92, 116, 88))
img.save(folder / ${JSON.stringify(filename)}, quality=95)
    `
  ]);
}

function writeSensitiveFixture(folder: string, filename: string) {
  const python = path.join(process.cwd(), ".venv", "bin", "python");
  execFileSync(python, [
    "-c",
    `
from pathlib import Path
from PIL import Image, ImageDraw
folder = Path(${JSON.stringify(folder)})
folder.mkdir(parents=True, exist_ok=True)
img = Image.new("RGB", (280, 280), (232, 198, 168))
draw = ImageDraw.Draw(img)
draw.ellipse((20, 10, 260, 290), fill=(236, 198, 164))
draw.rectangle((0, 0, 280, 28), fill=(34, 34, 42))
img.save(folder / ${JSON.stringify(filename)}, quality=95)
    `
  ]);
}

async function expectTopbarControlsReadable(page: Page, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  const activeContrasts = await page.locator(".topbar-actions").evaluate((container) => {
    function parseColor(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0];
      return match[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    }
    function channel(value: number) {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }
    function luminance([r, g, b]: number[]) {
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }
    function contrast(foreground: string, background: string) {
      const light = Math.max(luminance(parseColor(foreground)), luminance(parseColor(background)));
      const dark = Math.min(luminance(parseColor(foreground)), luminance(parseColor(background)));
      return (light + 0.05) / (dark + 0.05);
    }
    return Array.from(container.querySelectorAll<HTMLElement>("button, label")).map((node) => {
      const style = window.getComputedStyle(node);
      return {
        label: node.textContent?.trim() || node.getAttribute("aria-label") || node.getAttribute("title") || node.tagName,
        contrast: contrast(style.color, style.backgroundColor)
      };
    });
  });
  expect(activeContrasts.filter((item) => item.contrast < 4.5)).toEqual([]);

  const disabledContrasts = await page.locator(".topbar-actions").evaluate((container) => {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
    const buttonStates = buttons.map((button) => button.disabled);
    const inputStates = inputs.map((input) => input.disabled);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    inputs.forEach((input) => {
      input.disabled = true;
    });
    function parseColor(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return [0, 0, 0];
      return match[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    }
    function channel(value: number) {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }
    function luminance([r, g, b]: number[]) {
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }
    function contrast(foreground: string, background: string) {
      const light = Math.max(luminance(parseColor(foreground)), luminance(parseColor(background)));
      const dark = Math.min(luminance(parseColor(foreground)), luminance(parseColor(background)));
      return (light + 0.05) / (dark + 0.05);
    }
    const result = Array.from(container.querySelectorAll<HTMLElement>("button, label")).map((node) => {
      const style = window.getComputedStyle(node);
      return {
        label: node.textContent?.trim() || node.getAttribute("aria-label") || node.getAttribute("title") || node.tagName,
        contrast: contrast(style.color, style.backgroundColor)
      };
    });
    buttons.forEach((button, index) => {
      button.disabled = buttonStates[index];
    });
    inputs.forEach((input, index) => {
      input.disabled = inputStates[index];
    });
    return result;
  });
  expect(disabledContrasts.filter((item) => item.contrast < 4.5)).toEqual([]);
}

async function closeOnboardingIfVisible(page: Page) {
  const guide = page.getByRole("dialog", { name: "Set up your first scan" });
  await guide.waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
  if (await guide.isVisible().catch(() => false)) {
    await expect(guide.getByText("Choose an app folder")).toBeVisible();
    await expect(guide.getByText("Permission required")).toBeVisible();
    await guide.getByRole("button", { name: "Remind me later" }).click();
    await expect(guide).toBeHidden();
  }
}

test("desktop workbench renders and every primary control path works", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-e2e-"));
  const workspace = path.join(temp, "workspace");
  const fixtures = makeFixtures(temp);
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_CAMERA: "1",
    CROSSAGE_TEST_DIALOG_PATHS: [workspace, fixtures.refs, fixtures.scan].join(path.delimiter),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_WORKSPACE: path.join(temp, "initial-workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on("dialog", (dialog) => dialog.accept());

  await expect(page.getByText("Vintrace", { exact: true })).toBeVisible();
  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".nav-list").getByRole("button", { name: "Dashboard" })).toBeVisible();
  const languageSelect = page.locator(".language-picker select");
  await languageSelect.selectOption("fr");
  await expect(page.locator(".nav-list").getByRole("button", { name: "Tableau" })).toBeVisible();
  await languageSelect.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".nav-list").getByRole("button", { name: "لوحة التحكم" })).toBeVisible();
  await languageSelect.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".nav-list").getByRole("button", { name: "Dashboard" })).toBeVisible();
  await closeOnboardingIfVisible(page);
  await page.getByRole("button", { name: "Guide" }).click();
  await expect(page.getByRole("dialog", { name: "Set up your first scan" })).toBeVisible();
  await expect(page.getByText("Safe Mode on")).toBeVisible();
  await page.getByRole("button", { name: "Remind me later" }).click();
  await expect(page.locator("body")).not.toHaveText("");
  const integration = await page.evaluate(() => (window as any).crossAge.getSystemIntegration());
  expect(integration.protocolScheme).toBe("vintrace");
  expect(typeof integration.launchAtLogin).toBe("boolean");
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);

  for (const name of ["Dashboard", "People", "Scan", "Review", "Settings"]) {
    await page.locator(".nav-list").getByRole("button", { name }).click();
    await expect(page.locator(".nav-list").getByRole("button", { name })).toHaveClass(/active/);
  }

  await page.locator(".topbar-actions").getByRole("button", { name: "Choose", exact: true }).click();
  await expect(page.getByText(workspace)).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator(".status-row").getByText("Ready", { exact: true })).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "People" }).click();
  await page.getByLabel("Person name").fill("Person A");
  await page.getByLabel("Age range in these photos").selectOption("child");
  await page.getByRole("button", { name: "Choose person photo folder" }).click();
  await expect(page.getByRole("textbox", { name: "Person photo folder", exact: true })).toHaveValue(fixtures.refs);
  const enrollButton = page.locator(".form-panel").getByRole("button", { name: /^Add photos$/ });
  await expect(enrollButton).toBeDisabled();

  await page.locator(".topbar-actions").getByText("Permission").click();
  await expect(page.getByRole("dialog", { name: "Confirm permission" })).toBeVisible();
  await page.getByRole("textbox", { name: "Optional note" }).fill("E2E operator consent.");
  await page.getByRole("button", { name: "Confirm permission" }).click();
  await expect(enrollButton).toBeEnabled();
  await enrollButton.click();
  await expect(page.getByText(/Added 1 saved face photo/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("person_a.jpg")).toBeVisible();
  await page.getByRole("textbox", { name: "Adult photo folder" }).fill(fixtures.adultRefs);
  await page.getByRole("button", { name: "Add age folders" }).click();
  await expect(page.getByText(/across 1 age folder/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("person_a_adult.jpg")).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "Scan" }).click();
  await expect(page.getByText("Add from camera")).toBeVisible();
  await expect(page.locator(".sakura-face-field")).toBeVisible();
  await expect(page.locator(".sakura-petal")).toHaveCount(34);
  await expect(page.getByText("No possible matches yet")).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  const captureButton = page.getByRole("button", { name: "Capture best frame" });
  await expect(captureButton).toBeEnabled({ timeout: 60_000 });
  await captureButton.click();
  await expect(page.getByText(/Camera photo saved\./)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Arm auto capture" }).click();
  await expect(page.getByRole("button", { name: "Auto ready" })).toBeVisible();
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.locator(".camera-panel").getByText("Camera standby").first()).toBeVisible();

  await page.getByRole("button", { name: "Choose scan folder" }).click();
  await expect(page.getByRole("textbox", { name: "Scan folder", exact: true })).toHaveValue(fixtures.scan);
  await page.getByRole("button", { name: "Check folder" }).click();
  await expect(page.getByText(/Folder check found 2 photo or video file/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.getByText("Files that need attention")).toBeVisible();
  await page.locator(".form-panel").getByRole("button", { name: /^Scan folder$/ }).click();
  await expect(page.getByText(/Found 1 possible match/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("candidate_a.jpg")).toBeVisible();
  const scanActivity = page.locator(".scan-activity").first();
  await expect(scanActivity.locator(".activity-head-actions strong")).toHaveText(/\d+\/\d+/, { timeout: 120_000 });
  await expect(scanActivity).toContainText("cached faces");
  await expect(scanActivity).toContainText("rechecked");
  await page.getByRole("button", { name: "Toggle scan ETA" }).click();
  await expect(scanActivity.locator(".eta-detail")).toBeVisible();

  await page.getByRole("button", { name: "Clear results" }).click();
  await expect(page.getByText("No possible matches yet")).toBeVisible();
  await page.getByRole("button", { name: "Watch for new files" }).click();
  await expect(page.locator(".scan-activity small")).toHaveText("Watching for new media files.");
  writeSensitiveFixture(fixtures.scan, "private_frame.jpg");
  await expect(page.locator(".scan-activity")).toContainText("1 protected", { timeout: 120_000 });
  await expect(page.getByText("private_frame.jpg")).toHaveCount(0);
  await expect(page.getByText("No possible matches yet")).toBeVisible();
  writeFaceFixture(fixtures.scan, "watched_candidate.jpg");
  await expect(page.getByText("watched_candidate.jpg")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/Processed 1 new file|Scanning 1 new file/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: /Stop watching|Watching/ }).click();

  await page.locator(".nav-list").getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Find people together")).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Minimum people together" })).toHaveValue("2");
  const peopleTogether = page.getByRole("group", { name: "People to find together" });
  await expect(peopleTogether).toBeVisible();
  await peopleTogether.getByRole("button", { name: "Person A" }).click();
  await expect(page.locator(".person-chip.selected", { hasText: "Person A" })).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("group", { name: "Review priority lanes" })).toBeVisible();
  await page.getByRole("button", { name: /Strong matches/ }).click();
  await page.getByRole("button", { name: /All/ }).click();
  await expect(page.getByText("Saved person photo")).toBeVisible();
  await expect(page.getByLabel("Review session progress")).toBeVisible();
  const previewPanel = page.locator(".preview-panel");
  await expect(previewPanel.locator(".image-preview img").first()).toHaveAttribute("src", /^vintrace-media:\/\//);
  await expect(previewPanel.getByRole("button", { name: "Reveal" })).toBeVisible();
  await expect(previewPanel.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(page.getByText("Why this appeared")).toBeVisible();
  await previewPanel.getByRole("button", { name: "Hide previews" }).click();
  await expect(page.getByText("Preview hidden").first()).toBeVisible();
  await previewPanel.getByRole("button", { name: "Show previews" }).click();
  const reviewActions = previewPanel.locator(".review-actions");
  await reviewActions.getByRole("button", { name: "Looks right" }).click();
  await expect(page.locator(".status.accepted").first()).toHaveText("Accepted");
  await reviewActions.getByRole("button", { name: "Not a match" }).click();
  await expect(page.locator(".status.rejected").first()).toHaveText("Rejected");
  await reviewActions.getByRole("button", { name: "Not sure" }).click();
  await expect(page.locator(".status.uncertain").first()).toHaveText("Not sure");
  await page.getByRole("textbox", { name: "Review note" }).fill("Operator verified in test run.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Review note saved.")).toBeVisible();
  await page.getByLabel("Status filter").selectOption("all");
  await expect(page.getByRole("button", { name: "Undo decision" })).toBeVisible();
  await page.getByRole("button", { name: "Undo decision" }).click();
  await expect(page.getByText(/Restored/)).toBeVisible();
  await page.getByRole("button", { name: "Select shown" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.locator(".bulk-bar").getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByText(/Updated 1 possible match/)).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "Scan" }).click();
  await page.getByRole("button", { name: "Clear results" }).click();
  await expect(page.getByText("No possible matches yet")).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "People" }).click();
  await page.getByRole("button", { name: "Delete selected saved photo" }).click();
  await expect(page.getByText("person_a_adult.jpg")).toBeVisible();
  await page.getByRole("button", { name: "Clear saved face photos" }).click();
  await expect(page.getByText("No people added yet")).toBeVisible();
  await enrollButton.click();
  await expect(page.getByText(/Added 1 saved face photo/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("person_a.jpg")).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Configuration presets" })).toBeVisible();
  await page.getByRole("button", { name: /Privacy first/ }).click();
  await expect(page.locator(".settings-summary").getByText("Privacy first")).toBeVisible();
  await page.getByRole("button", { name: /Custom/ }).click();
  await page.getByLabel("Strong match value").fill("0.10");
  await page.getByLabel("Likely match value").fill("0.50");
  await expect(page.getByText(/Advanced match levels/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Safe Mode" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Start at login" })).toBeVisible();
  await expect(page.getByText(/vintrace:\/\/ ready|Not registered/)).toBeVisible();
  await expect(page.getByText("System check")).toBeVisible();
  await page.locator(".panel", { hasText: "Local engine" }).getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText(/System check (passed|found items to review)/)).toBeVisible({ timeout: 120_000 });
  const updatesPanel = page.locator(".panel").filter({ has: page.getByRole("button", { name: "Check updates" }) });
  await expect(updatesPanel).toBeVisible();
  await expect(updatesPanel.getByRole("button", { name: "Check updates" })).toBeVisible();
  await expect(updatesPanel.getByRole("group", { name: "Update channel" })).toBeVisible();
  await expect(updatesPanel.getByRole("button", { name: "Stable" })).toBeVisible();
  const diagnosticsPanel = page.locator(".panel", { hasText: "Error reports" });
  await expect(diagnosticsPanel).toBeVisible();
  await diagnosticsPanel.getByRole("button", { name: "Preview report" }).click();
  await expect(page.getByText("Diagnostics report preview loaded.")).toBeVisible();
  await expect(diagnosticsPanel.getByText("Events", { exact: true })).toBeVisible();
  await expect(diagnosticsPanel.getByText("Latest code", { exact: true })).toBeVisible();
  await expect(diagnosticsPanel.getByRole("textbox", { name: "Diagnostics JSON preview" })).toHaveValue(/summary/);
  await expect(page.getByText("Performance center")).toBeVisible();
  await expect(page.getByText("Storage limit")).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Storage limit in GB" })).toBeVisible();
  const performanceCenter = page.locator(".performance-center");
  await expect(performanceCenter.getByRole("group", { name: "Performance modes" })).toBeVisible();
  await performanceCenter.getByRole("button", { name: /Fast/ }).click();
  await expect(performanceCenter.locator(".performance-mode.selected").getByText("Fast")).toBeVisible();
  await performanceCenter.getByRole("button", { name: "Copy report" }).click();
  await expect(page.getByText("Performance report copied.")).toBeVisible();
  await performanceCenter.getByRole("button", { name: "Warm previews" }).click();
  await expect(page.getByText(/Prepared \d+ preview/)).toBeVisible({ timeout: 120_000 });
  await performanceCenter.getByRole("button", { name: "Clear samples" }).click();
  await expect(page.getByText("Latency samples cleared.")).toBeVisible();
  await page.getByLabel("Strong match value").fill("0.60");
  await page.getByLabel("Likely match value").fill("0.40");
  await page.getByLabel("Review more value").fill("0.20");
  await page.getByLabel("Photo quality minimum value").fill("0.10");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByText("Save and clean up")).toBeVisible();
  await page.getByRole("button", { name: "Copy app summary" }).click();
  await expect(page.getByText("App summary copied.")).toBeVisible();
  await page.getByRole("button", { name: "Export review report" }).click();
  await expect(page.getByText(/Exported report/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Backup app folder" }).click();
  await expect(page.getByText(/Backup created:/)).toBeVisible({ timeout: 120_000 });
  await page.getByLabel("New person name").fill("Person Renamed");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText(/Updated 1 saved photo/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel("Person to rename")).toHaveValue("Person Renamed");
  await page.getByLabel("Retention days").fill("1");
  await page.getByRole("button", { name: "Remove old reviewed" }).click();
  await expect(page.getByText(/Removed \d+ old reviewed possible match/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Activity history", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load history" }).click();
  await expect(page.getByText(/Loaded \d+ activity event/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Copy events" }).click();
  await expect(page.getByText("Activity history copied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove reviewed matches" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete person" })).toBeVisible();

  await page.locator(".nav-list").getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByText("First scan checklist")).toBeVisible();
  await expect(page.getByText("Top 7 current priorities")).toBeVisible();
  await expect(page.locator(".dashboard-metrics").getByText("Files scanned", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent scan runs")).toBeVisible();
  await expect(page.getByText("Review mix")).toBeVisible();
  await expect(page.getByText("System and safety")).toBeVisible();

  const smallControls = await page.locator("button:visible, input:not([type='checkbox']):visible, select:visible, .consent:visible").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return { tag: node.tagName, text: (node.textContent || (node as HTMLInputElement).ariaLabel || "").trim(), width: rect.width, height: rect.height };
      })
      .filter((rect) => rect.height < 36 || rect.width < 36)
  );
  expect(smallControls).toEqual([]);
  await expectTopbarControlsReadable(page, "light");
  await expectTopbarControlsReadable(page, "dark");

  await app.close();
});
