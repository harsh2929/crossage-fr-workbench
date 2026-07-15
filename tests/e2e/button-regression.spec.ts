import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_BUTTON_AUDIT !== "1", "Set VINTRACE_BUTTON_AUDIT=1 to run the exhaustive button audit.");

async function closeDialogIfVisible(page: Page) {
  const safeReviewClose = page.locator(".safe-review-overlay:visible .safe-review-close").last();
  if (await safeReviewClose.isVisible().catch(() => false)) {
    await safeReviewClose.click({ timeout: 1_000 }).catch(() => undefined);
  }
  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    for (const name of [/Remind me later/i, /Cancel/i, /Close/i, /Done/i, /Not now/i]) {
      const button = dialog.getByRole("button", { name }).last();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => undefined);
        return;
      }
    }
    await page.keyboard.press("Escape").catch(() => undefined);
  }
}

async function assertHealthy(page: Page, pageErrors: string[], context: string) {
  await expect(page.getByRole("alert").filter({ hasText: "Vintrace could not load" }), context).toHaveCount(0);
  expect(pageErrors, context).toEqual([]);
}

async function clickSafeVisibleButtons(page: Page, pageErrors: string[], tabName: string) {
  const skipped = /download|install|quit|start camera|capture|auto ready|arm auto|stop camera|choose|open$|reveal$|delete|trash|remove|purge|export|backup|copy files|move files|scan folder|watch|unlock|lock|repair|relink|update|force retry|clear saved|clear results|confirm permission|add to codex|build bundle|start server|copy token/i;
  const clicked = new Set<string>();

  // Two passes cover controls revealed by the first interaction without
  // repeatedly traversing the same Photos-backed surface for every IA alias.
  for (let pass = 0; pass < 2; pass += 1) {
    const buttons = page.locator(".workspace button:visible:not(.section-tab), .onboarding-card button:visible, .sidebar-footer button:visible");
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      const label = (
        (await button.innerText().catch(() => "")) ||
        (await button.getAttribute("aria-label").catch(() => "")) ||
        (await button.getAttribute("title").catch(() => "")) ||
        ""
      ).replace(/\s+/g, " ").trim();
      if (!label || skipped.test(label)) continue;
      const key = `${tabName}:${label}`;
      if (clicked.has(key)) continue;
      clicked.add(key);
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      // The DOM can legitimately re-render after each click. A stale snapshot
      // is not a five-second failure path; skip it and let the next pass see the
      // newly mounted control instead.
      await button.click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(60);
      await closeDialogIfVisible(page);
      await assertHealthy(page, pageErrors, key);
    }
  }
  return clicked;
}

test("every visible safe button path remains non-crashing", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const projectRoot = process.cwd();
  const guardedEvidence = {
    "destructive-photo-actions": ["tests/e2e/photos-album-folders.spec.ts", "Photos Recently Deleted permanent delete and lightbox restore stay recoverable"],
    "reversible-photo-safety": ["tests/e2e/photos-album-folders.spec.ts", "Photos safety actions expose undo for delete and hide"],
    "external-import-confirmation": ["tests/e2e/photos-album-folders.spec.ts", "Photos external import handoff preserves app attribution after confirm"],
    "export-and-file-output": ["tests/e2e/photos-album-folders.spec.ts", "Photos rendered image export honors browser export options"],
    "camera-permission-failure": ["tests/e2e/tools-runtime-state-matrix.spec.ts", "Tools camera permission failure is actionable and path-free"],
    "scan-watch-repair-lifecycle": ["tests/e2e/tools-runtime-state-matrix.spec.ts", "Tools runtime matrix covers scan lifecycle, queue, watch, review, and repair"],
    "agent-permission-and-destructive-approval": ["tests/e2e/agent-platform.spec.ts", "authenticated API, approvals, failures"],
    "settings-data-loss-guard": ["tests/e2e/settings-save-state.spec.ts", "saved and unsaved state visible across sections and routes"],
  } satisfies Record<string, [string, string]>;
  for (const [family, [relativePath, evidenceText]] of Object.entries(guardedEvidence)) {
    const source = readFileSync(path.join(projectRoot, relativePath), "utf8");
    expect(source, `${family} has a dedicated guarded workflow`).toContain(evidenceText);
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-button-audit-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const pageErrors: string[] = [];
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_CAMERA: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
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
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => undefined));

  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeDialogIfVisible(page);
  const clicked = new Set<string>();
  const interactionManifest: Record<string, string[]> = {};
  const destinations = ["library", "memories", "albums", "search", "agents", "people", "tools", "settings"];
  const nestedSections: Record<string, string[]> = {
    people: ["Browse", "Add person", "Review"],
    tools: ["Overview", "Scan", "Models", "Diagnostics"],
    settings: ["General", "Engine & Models", "Privacy & Safety", "Storage & Data", "AI Agents", "Advanced"],
  };
  for (const destination of destinations) {
    await closeDialogIfVisible(page);
    const tab = page.locator(`.nav-list [data-tab="${destination}"]`);
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    const sections = nestedSections[destination] || [];
    if (!sections.length) {
      const surfaceItems = await clickSafeVisibleButtons(page, pageErrors, destination);
      interactionManifest[destination] = [...surfaceItems].sort();
      for (const item of surfaceItems) clicked.add(item);
      continue;
    }
    for (const section of sections) {
      await closeDialogIfVisible(page);
      await tab.click();
      await expect(page.locator(".section-tabs")).toBeVisible();
      await page.locator(".section-tabs .section-tab", { hasText: section }).click();
      const surfaceKey = `${destination}/${section}`;
      const surfaceItems = await clickSafeVisibleButtons(page, pageErrors, surfaceKey);
      interactionManifest[surfaceKey] = [...surfaceItems].sort();
      for (const item of surfaceItems) clicked.add(item);
    }
  }

  await assertHealthy(page, pageErrors, "final button audit");
  writeFileSync(testInfo.outputPath("safe-interaction-manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalClicked: clicked.size,
    surfaces: interactionManifest,
    guardedFamilies: Object.fromEntries(Object.entries(guardedEvidence).map(([family, [relativePath, evidenceText]]) => (
      [family, { test: relativePath, evidence: evidenceText }]
    ))),
  }, null, 2));
  // Five standalone destinations plus People (3), Tools (4), and Settings (6).
  expect(Object.keys(interactionManifest), "every primary and nested surface is inventoried").toHaveLength(18);
  expect(clicked.size, "safe button audit should cover real control paths").toBeGreaterThanOrEqual(70);
  await app.close();
});
