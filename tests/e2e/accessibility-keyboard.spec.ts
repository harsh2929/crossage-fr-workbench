import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

test.skip(process.env.VINTRACE_A11Y !== "1", "Set VINTRACE_A11Y=1 to run accessibility and keyboard QA.");

async function closeDialogIfVisible(page: Page) {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

async function activeElementSnapshot(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      tag: active?.tagName || "",
      text: (active?.textContent || active?.getAttribute("aria-label") || active?.getAttribute("title") || "").replace(/\s+/g, " ").trim(),
      className: active?.className?.toString() || "",
      insideDialog: Boolean(active?.closest("[role='dialog']"))
    };
  });
}

async function auditSurfaceTabOrder(page: Page, context: string) {
  await expect(page.locator(".photo-deferred-surface")).toHaveCount(0, { timeout: 15_000 });
  const expectedIds = await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>("[data-a11y-audit-id]").forEach((node) => node.removeAttribute("data-a11y-audit-id"));
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, summary, [tabindex]"
    ));
    const eligible = candidates.filter((node) => {
      const input = node as HTMLInputElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return !input.disabled
        && node.tabIndex >= 0
        && !node.closest("[aria-hidden='true'], [inert]")
        && style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width > 0
        && rect.height > 0;
    });
    eligible.forEach((node, index) => node.setAttribute("data-a11y-audit-id", `${index}`));
    const body = document.body;
    body.tabIndex = -1;
    body.focus();
    return eligible.map((node) => node.getAttribute("data-a11y-audit-id") || "");
  });
  const reached = new Set<string>();
  const focusTrail: Array<{ id: string; name: string; tag: string }> = [];
  const firstExpectedId = expectedIds[0] || "";
  let wrapped = false;
  for (let index = 0; index < expectedIds.length * 3 + 50; index += 1) {
    await page.keyboard.press("Tab");
    const snapshot = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null;
      if (!node) return { id: "", name: "", tag: "", width: 0, height: 0, visible: false, unobscured: false };
      const labelledBy = (node.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const input = node as HTMLInputElement;
      const wrapperLabel = node.closest("label")?.textContent || "";
      const name = (node.getAttribute("aria-label") || labelledBy || node.textContent || node.getAttribute("title") || input.placeholder || wrapperLabel)
        .replace(/\s+/g, " ")
        .trim();
      const rect = node.getBoundingClientRect();
      const visible = rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
      const samplePoints = [
        [Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))],
        [Math.max(0, Math.min(window.innerWidth - 1, rect.left + 2)), Math.max(0, Math.min(window.innerHeight - 1, rect.top + 2))],
        [Math.max(0, Math.min(window.innerWidth - 1, rect.right - 2)), Math.max(0, Math.min(window.innerHeight - 1, rect.bottom - 2))],
      ];
      const unobscured = samplePoints.some(([x, y]) => document.elementsFromPoint(x, y).some((hit) => hit === node || node.contains(hit) || hit.contains(node)));
      return {
        id: node.getAttribute("data-a11y-audit-id") || "",
        name,
        tag: node.tagName,
        width: rect.width,
        height: rect.height,
        visible,
        unobscured,
      };
    });
    if (!snapshot.id) continue;
    if (snapshot.id === firstExpectedId && reached.size > 1) {
      wrapped = true;
      break;
    }
    reached.add(snapshot.id);
    focusTrail.push({ id: snapshot.id, name: snapshot.name, tag: snapshot.tag });
    expect(snapshot.name, `${context} focusable ${snapshot.id} has an accessible name`).not.toBe("");
    expect(snapshot.visible, `${context} focusable ${snapshot.id} is visible after focus`).toBe(true);
    expect(snapshot.unobscured, `${context} focusable ${snapshot.id} is not fully obscured`).toBe(true);
    if (snapshot.tag === "BUTTON" || snapshot.tag === "SUMMARY") {
      expect(snapshot.width, `${context} focusable ${snapshot.id} width`).toBeGreaterThanOrEqual(28);
      expect(snapshot.height, `${context} focusable ${snapshot.id} height`).toBeGreaterThanOrEqual(28);
    }
  }
  expect(wrapped, `${context} focus cycle returned to its first control`).toBe(true);
  const missingIds = await page.evaluate(({ ids, reachedIds }) => ids.filter((id) => (
    !reachedIds.includes(id) && Boolean(document.querySelector(`[data-a11y-audit-id="${CSS.escape(id)}"]`))
  )), { ids: expectedIds, reachedIds: [...reached] });
  const missing = await page.evaluate((ids) => ids.map((id) => {
    const node = document.querySelector<HTMLElement>(`[data-a11y-audit-id="${CSS.escape(id)}"]`);
    const details = node?.closest("details") as HTMLDetailsElement | null;
    return {
      id,
      tag: node?.tagName || "",
      text: (node?.getAttribute("aria-label") || node?.textContent || node?.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 100),
      className: node?.className?.toString() || "",
      detailsOpen: details ? details.open : null,
    };
  }), missingIds);
  expect(missing, `${context} Tab order reaches every rendered focusable; trail=${JSON.stringify(focusTrail)}`).toEqual([]);
  await page.evaluate(() => {
    document.body.removeAttribute("tabindex");
    document.querySelectorAll<HTMLElement>("[data-a11y-audit-id]").forEach((node) => node.removeAttribute("data-a11y-audit-id"));
  });
}

test("primary UI supports keyboard navigation and modal focus trapping", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-a11y-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeDialogIfVisible(page);

  const surfaceMatrix = [
    { tab: "library", sections: [] },
    { tab: "memories", sections: [] },
    { tab: "albums", sections: [] },
    { tab: "search", sections: [] },
    { tab: "agents", sections: [] },
    { tab: "people", sections: ["Browse", "Add person", "Review"] },
    { tab: "tools", sections: ["Overview", "Scan", "Models", "Diagnostics"] },
    { tab: "settings", sections: ["General", "Engine & Models", "Privacy & Safety", "Storage & Data", "AI Agents", "Advanced"] },
  ];
  for (const surface of surfaceMatrix) {
    await page.locator(`.nav-list [data-tab="${surface.tab}"]`).click();
    if (!surface.sections.length) {
      expect(await visibleSurfaceIssues(page), surface.tab).toEqual([]);
      await auditSurfaceTabOrder(page, surface.tab);
      continue;
    }
    for (const section of surface.sections) {
      await page.locator(".section-tabs .section-tab", { hasText: section }).click();
      expect(await visibleSurfaceIssues(page), `${surface.tab} / ${section}`).toEqual([]);
      await auditSurfaceTabOrder(page, `${surface.tab} / ${section}`);
    }
  }

  const libraryNavigation = page.locator('.nav-list [data-tab="library"]');
  await libraryNavigation.click();
  await libraryNavigation.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.nav-list [data-tab="memories"]')).toHaveClass(/active/);
  await page.keyboard.press("End");
  await expect(page.locator('.nav-list [data-tab="settings"]')).toHaveClass(/active/);
  await page.keyboard.press("Home");
  await expect(libraryNavigation).toHaveClass(/active/);

  await page.locator('.nav-list [data-tab="tools"]').click();
  const overviewSection = page.locator('.section-tabs [role="tab"]').filter({ hasText: "Overview" });
  await overviewSection.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.section-tabs [role="tab"]').filter({ hasText: "Scan" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.locator('.section-tabs [role="tab"]').filter({ hasText: "Diagnostics" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(overviewSection).toHaveAttribute("aria-selected", "true");

  for (const tabName of ["library", "memories", "albums", "search", "agents", "people", "tools", "settings"]) {
    const tab = page.locator(`.nav-list [data-tab="${tabName}"]`);
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveClass(/active/);
  }

  await page.locator(".sidebar-guide-button").click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-labelledby", /.+/);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect((await activeElementSnapshot(page)).insideDialog, `dialog focus step ${index}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await app.close();
});
