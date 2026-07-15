import AxeBuilder from "@axe-core/playwright";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_AXE !== "1", "Set VINTRACE_AXE=1 to run automated WCAG QA.");

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function closeDialogIfVisible(page: Page) {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function scanSurface(page: Page, context: string) {
  await expect(page.locator(".photo-deferred-surface")).toHaveCount(0, { timeout: 15_000 });
  // Electron's BrowserContext cannot create the temporary aggregation page used
  // by AxeBuilder's default frame strategy. Vintrace has no embedded frames, so
  // legacy injection audits the same renderer surface without losing coverage.
  const result = await new AxeBuilder({ page }).setLegacyMode().withTags(WCAG_TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 8).map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));
  expect(violations, `${context} automated WCAG violations`).toEqual([]);
}

test("primary Electron surfaces have no automatically detectable WCAG A/AA violations", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-axe-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await closeDialogIfVisible(page);

    const surfaces = [
      { tab: "library", sections: [] },
      { tab: "memories", sections: [] },
      { tab: "albums", sections: [] },
      { tab: "search", sections: [] },
      { tab: "agents", sections: [] },
      { tab: "people", sections: ["Browse", "Add person", "Review"] },
      { tab: "tools", sections: ["Overview", "Scan", "Models", "Diagnostics"] },
      { tab: "settings", sections: ["General", "Engine & Models", "Privacy & Safety", "Storage & Data", "AI Agents", "Advanced"] },
    ];
    for (const surface of surfaces) {
      await page.locator(`.nav-list [data-tab="${surface.tab}"]`).click();
      if (!surface.sections.length) {
        await scanSurface(page, surface.tab);
        continue;
      }
      for (const section of surface.sections) {
        await page.locator(".section-tabs .section-tab", { hasText: section }).click();
        await scanSurface(page, `${surface.tab} / ${section}`);
      }
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
