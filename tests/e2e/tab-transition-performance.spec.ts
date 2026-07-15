import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { largePhotoLibraryCount, seedLargePhotoLibrary } from "./large-photo-library";

type TransitionSample = {
  from: string;
  to: string;
  elapsedMs: number;
};

async function dismissModals(page: Page) {
  for (let index = 0; index < 4; index += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function photoLibraryTotal(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const crossAge = (window as unknown as {
      crossAge?: { invoke?: <T>(command: string, params?: Record<string, unknown>) => Promise<T> };
    }).crossAge;
    if (!crossAge?.invoke) return 0;
    const result = await crossAge.invoke<{ total?: number }>("list_photo_assets", { limit: 1, backfill: false });
    return Number(result.total || 0);
  });
}

async function measureTransition(
  page: Page,
  from: string,
  to: string,
  readySelector: string,
): Promise<TransitionSample> {
  return page.evaluate(async ({ from, to, readySelector }) => {
    const button = document.querySelector<HTMLButtonElement>(`.nav-list [data-tab="${to}"]`);
    if (!button) throw new Error(`Missing navigation button: ${to}`);

    const startedAt = performance.now();
    button.click();
    const deadline = startedAt + 5_000;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const target = document.querySelector<HTMLElement>(readySelector);
      const targetVisible = Boolean(target && target.getClientRects().length > 0);
      if (targetVisible && button.getAttribute("aria-current") === "page") {
        // Include the next paint so this measures committed, visible content rather
        // than only the synchronous click handler.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return { from, to, elapsedMs: performance.now() - startedAt };
      }
    }
    throw new Error(`Transition ${from} -> ${to} did not become visible`);
  }, { from, to, readySelector });
}

test("primary tab transitions commit visible content within the interaction budget", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-tab-perf-"));
  const suppliedWorkspace = process.env.VINTRACE_TAB_PERF_WORKSPACE;
  const workspace = suppliedWorkspace || path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const photoCount = largePhotoLibraryCount(process.env.VINTRACE_TAB_PERF_PHOTO_COUNT);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_ENABLE_GPU: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!suppliedWorkspace) seedLargePhotoLibrary(root, env, workspace, photoCount);

  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissModals(page);
    await expect(page.locator("html")).toHaveAttribute("data-renderer-gpu", "hardware");
    await expect(page.locator('.nav-list [data-tab="library"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".photos-page")).toHaveAttribute("data-reload-signal", "0");
    if (suppliedWorkspace) {
      await expect.poll(() => photoLibraryTotal(page), { timeout: 60_000 }).toBeGreaterThan(0);
    } else {
      await expect.poll(() => photoLibraryTotal(page), { timeout: 60_000 }).toBe(photoCount);
    }
    await expect(page.locator(".photo-tile-wrap").first()).toBeVisible({ timeout: 30_000 });

    const samples = [
      await measureTransition(page, "library", "memories", ".memories-feed, .memories-empty"),
      await measureTransition(page, "memories", "albums", ".albums-gallery"),
      await measureTransition(page, "albums", "library", ".photos-page:not(.photos-destination-mode) .photos-gallery"),
    ];

    // Ordinary destination changes must reuse the catalog instead of being
    // misclassified as a reselect and triggering the full refresh fan-out.
    await expect(page.locator(".photos-page")).toHaveAttribute("data-reload-signal", "0");
    await page.locator(".photos-page").evaluate((element) => {
      element.setAttribute("data-route-instance", "preserved");
    });
    samples.push(await measureTransition(page, "library", "search", ".search-view"));
    samples.push(await measureTransition(page, "search", "library", ".photos-page:not(.photos-destination-mode) .photos-gallery"));
    await expect(page.locator('.photos-page[data-route-instance="preserved"]')).toBeVisible();
    samples.push(await measureTransition(page, "library", "agents", ".agent-platform-page"));
    samples.push(await measureTransition(page, "agents", "people", ".photos-people-gallery, .people-gallery-empty"));
    samples.push(await measureTransition(page, "people", "tools", ".dashboard-page"));
    samples.push(await measureTransition(page, "tools", "settings", ".page-grid"));
    samples.push(await measureTransition(page, "settings", "library", ".photos-page:not(.photos-destination-mode) .photos-gallery"));

    // A true reselect remains the explicit refresh gesture.
    await page.locator('.nav-list [data-tab="library"]').click();
    await expect(page.locator(".photos-page")).toHaveAttribute("data-reload-signal", "1");

    console.log(`TAB_TRANSITION_SAMPLES=${JSON.stringify(samples)}`);
    for (const sample of samples) {
      expect(sample.elapsedMs, `${sample.from} -> ${sample.to}`).toBeLessThan(150);
    }
  } finally {
    await app.close();
  }
});
