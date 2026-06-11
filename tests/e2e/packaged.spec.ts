import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function packagedExecutable(projectRoot: string) {
  if (process.platform === "darwin") {
    return path.join(projectRoot, "dist", "mac-arm64", "Vintrace.app", "Contents", "MacOS", "Vintrace");
  }
  if (process.platform === "win32") {
    return path.join(projectRoot, "dist", "win-unpacked", "Vintrace.exe");
  }
  return path.join(projectRoot, "dist", "linux-unpacked", "vintrace");
}

test("packaged desktop app launches and exposes performance controls", async () => {
  const projectRoot = process.cwd();
  const executablePath = packagedExecutable(projectRoot);
  test.skip(!existsSync(executablePath), `Packaged app not found at ${executablePath}. Run npm run pack:unsigned first.`);
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-packaged-e2e-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace")
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    executablePath,
    cwd: projectRoot,
    env
  });
  try {
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await expect(page.getByText("Vintrace", { exact: true })).toBeVisible();
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 180_000 });
    const guide = page.getByRole("dialog", { name: "Set up your first scan" });
    await guide.waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
    if (await guide.isVisible().catch(() => false)) {
      await guide.getByRole("button", { name: "Remind me later" }).click();
      await expect(guide).toBeHidden();
    }
    await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Performance center")).toBeVisible();
    await page.getByRole("button", { name: /Fast/ }).click();
    await expect(page.locator(".performance-mode.selected").filter({ hasText: "Fast" })).toBeVisible();
    await page.getByRole("button", { name: /Auto/ }).click();
    await expect(page.locator(".performance-mode.selected").filter({ hasText: "Auto" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
