import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

test("primary UI supports keyboard navigation and modal focus trapping", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-a11y-"));
  const workspace = path.join(temp, "workspace");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
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

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeDialogIfVisible(page);

  const unnamedControls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], input, select, textarea"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return false;
        const input = node as HTMLInputElement;
        const explicitLabel = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || "" : "";
        const wrapperLabel = node.closest("label")?.textContent || "";
        const text = (node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || input.placeholder || explicitLabel || wrapperLabel).trim();
        return !text && node.tagName !== "SELECT";
      })
      .map((node) => ({ tag: node.tagName, className: node.className?.toString() || "" }));
  });
  expect(unnamedControls).toEqual([]);

  const visited = new Set<string>();
  for (let index = 0; index < 18; index += 1) {
    await page.keyboard.press("Tab");
    const snapshot = await activeElementSnapshot(page);
    visited.add(`${snapshot.tag}:${snapshot.text}:${snapshot.className}`);
    expect(snapshot.tag, `focus step ${index}`).not.toBe("BODY");
  }
  expect(visited.size).toBeGreaterThan(6);

  for (const tabName of ["Dashboard", "People", "Scan", "Review", "Settings"]) {
    const tab = page.locator(".nav-list").getByRole("button", { name: tabName });
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveClass(/active/);
  }

  await page.getByRole("button", { name: /Guide/i }).click();
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
