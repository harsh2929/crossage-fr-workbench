import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";


async function dismissModals(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    const secondary = page.locator(".modal-backdrop .secondary:visible").last();
    if (await secondary.isVisible().catch(() => false)) await secondary.click().catch(() => undefined);
    else await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

async function expectDialogToFit(page: Page) {
  const metrics = await page.locator(".photo-source-dialog").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>(".photo-source-dialog-body");
    const actionRects = [...element.querySelectorAll<HTMLElement>(".photo-source-dialog-actions button")]
      .filter((button) => button.offsetParent !== null)
      .map((button) => button.getBoundingClientRect())
      .map((button) => ({ left: button.left, right: button.right, top: button.top, bottom: button.bottom }));
    const actionsOverlap = actionRects.some((first, index) => actionRects.slice(index + 1).some((second) => (
      Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
      && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1
    )));
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      horizontalOverflow: body ? body.scrollWidth - body.clientWidth : 0,
      actionsOverlap,
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(metrics.actionsOverlap).toBe(false);
}

test("native folder source previews, imports, and remains usable at narrow widths", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photo-source-e2e-"));
  const home = path.join(temp, "home");
  const photoFolder = path.join(home, "Pictures", "Trips");
  mkdirSync(photoFolder, { recursive: true });
  copyFileSync(path.join(root, "desktop", "assets", "icon-192.png"), path.join(photoFolder, "qa-source.png"));
  const sourceBytes = readFileSync(path.join(photoFolder, "qa-source.png"));
  writeFileSync(path.join(photoFolder, "qa-source.xmp"), `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:dc="http://purl.org/dc/elements/1.1/"
           xmlns:xmp="http://ns.adobe.com/xap/1.0/"
           xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/">
    <rdf:Description rdf:about="" xmp:Rating="5">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">QA source image</rdf:li></rdf:Alt></dc:title>
      <dc:subject><rdf:Bag><rdf:li>travel</rdf:li><rdf:li>qa</rdf:li></rdf:Bag></dc:subject>
      <mwg-rs:Regions>
        <rdf:Bag><rdf:li mwg-rs:Name="Test Person" mwg-rs:Type="Face" mwg-rs:Rectangle="0.2, 0.2, 0.4, 0.4" /></rdf:Bag>
      </mwg-rs:Regions>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`, "utf8");

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    HOME: home,
    USERPROFILE: home,
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop", "main.cjs")], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await expect(page.getByText("Startup needs attention")).toHaveCount(0);
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissModals(page);

    const photoSourceLauncher = page.getByRole("button", { name: "Import images", exact: true });
    await expect(photoSourceLauncher).toBeAttached({ timeout: 30_000 });
    await photoSourceLauncher.click();
    await expect(page.locator(".photo-source-dialog")).toBeVisible();
    const applePhotosTab = page.getByRole("tab", { name: "Apple Photos" });
    const photoFoldersTab = page.getByRole("tab", { name: "Photo folders" });
    await applePhotosTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(photoFoldersTab).toBeFocused();
    await expect(photoFoldersTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".photo-source-status")).toContainText("Ready", { timeout: 30_000 });
    await expect.poll(() => page.getByLabel("Photo library", { exact: true }).inputValue()).toContain(path.join(home, "Pictures"));

    const previewButton = page.getByRole("button", { name: "Preview", exact: true });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(page.locator(".photo-source-preview-band")).toContainText("QA source image", { timeout: 30_000 });

    await page.setViewportSize({ width: 1280, height: 900 });
    await expectDialogToFit(page);
    await page.screenshot({ path: testInfo.outputPath("photo-source-desktop.png"), fullPage: true });

    await page.getByText("People and face regions", { exact: true }).click();
    await expect(page.getByText("Allow selected sensitive metadata", { exact: true })).toBeVisible();
    await expect(previewButton).toBeDisabled();
    await page.getByText("Allow selected sensitive metadata", { exact: true }).click();
    await expect(previewButton).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 740 });
    await expectDialogToFit(page);
    await page.screenshot({ path: testInfo.outputPath("photo-source-narrow.png"), fullPage: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.locator(".photo-source-message.ok")).toContainText("completed", { timeout: 90_000 });
    await expect(page.locator(".photo-source-job-row.completed").filter({ hasText: /^import/ })).toBeVisible();

    const peopleReview = page.locator(".photo-source-people-review");
    await expect(peopleReview.getByRole("textbox")).toHaveValue("Test Person", { timeout: 30_000 });
    await peopleReview.getByRole("button", { name: "Accept people hint" }).click();
    await expect(peopleReview).toHaveCount(0);

    const privacyControls = page.locator(".photo-source-privacy-controls");
    await expect(privacyControls).toContainText("People and face regions", { timeout: 30_000 });
    await privacyControls.getByText("People and face regions", { exact: true }).click();
    await privacyControls.getByRole("button", { name: "Remove selected metadata" }).click();
    await expect(page.locator(".photo-source-message.ok")).toContainText("removed from Vintrace", { timeout: 90_000 });
    await expect(privacyControls).toHaveCount(0);
    expect(readFileSync(path.join(photoFolder, "qa-source.png"))).toEqual(sourceBytes);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(photoSourceLauncher).toBeFocused();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
