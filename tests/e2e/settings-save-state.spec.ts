import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

test("Settings keeps saved and unsaved state visible across sections and routes", async () => {
  test.setTimeout(120_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-settings-state-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissDialogs(page);

    await page.locator('.nav-list [data-tab="settings"]').click();
    const status = page.locator(".settings-save-status");
    await expect(status).toContainText("Saved");
    await expect(status).toContainText("Settings match this app folder");

    await page.getByRole("button", { name: /Privacy first/ }).click();
    await expect(status).toContainText("Unsaved changes");
    await expect(status.getByRole("button", { name: "Save now" })).toBeVisible();

    await page.locator('.section-tabs [role="tab"]').filter({ hasText: "Storage & Data" }).click();
    await expect(status).toContainText("Unsaved changes");
    await page.locator('.nav-list [data-tab="tools"]').click();
    await page.locator('.nav-list [data-tab="settings"]').click();
    await expect(status).toContainText("Unsaved changes");

    await status.getByRole("button", { name: "Save now" }).click();
    await expect(status).toContainText("Saved", { timeout: 30_000 });
    await expect(status.getByRole("button", { name: "Save now" })).toHaveCount(0);
    expect(await visibleSurfaceIssues(page), "saved Settings surface").toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
