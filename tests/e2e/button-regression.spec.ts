import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_BUTTON_AUDIT !== "1", "Set VINTRACE_BUTTON_AUDIT=1 to run the exhaustive button audit.");

async function closeDialogIfVisible(page: Page) {
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
  const skipped = /download|install|quit|start camera|capture|auto ready|arm auto|stop camera|choose|open$|reveal$|delete|trash|remove|purge|export|backup|copy files|move files|scan folder|watch|unlock|lock|repair|relink|update|force retry|clear saved|clear results|confirm permission/i;
  const clicked = new Set<string>();

  for (let pass = 0; pass < 4; pass += 1) {
    const buttons = page.locator(".workspace button:visible, .onboarding-card button:visible, .topbar-actions button:visible");
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
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(100);
      await closeDialogIfVisible(page);
      await assertHealthy(page, pageErrors, key);
    }
  }
  return clicked;
}

test("every visible safe button path remains non-crashing", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-button-audit-"));
  const workspace = path.join(temp, "workspace");
  const pageErrors: string[] = [];
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_CAMERA: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
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

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeDialogIfVisible(page);
  const clicked = new Set<string>();
  for (const name of ["Dashboard", "People", "Scan", "Review", "Settings"]) {
    await page.locator(".nav-list").getByRole("button", { name }).click();
    await expect(page.locator(".nav-list").getByRole("button", { name })).toHaveClass(/active/);
    for (const item of await clickSafeVisibleButtons(page, pageErrors, name)) clicked.add(item);
  }

  await assertHealthy(page, pageErrors, "final button audit");
  expect(clicked.size, "safe button audit should cover real control paths").toBeGreaterThanOrEqual(35);
  await app.close();
});
