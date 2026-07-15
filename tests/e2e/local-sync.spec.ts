import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/local-sync";

async function dismissOnboarding(page: Page) {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
}

test("encrypted local sync panel covers setup, invitation, recovery, and responsive layout", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-local-sync-ui-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    VINTRACE_WORKSPACE: path.join(temp, "workspace"),
    CROSSAGE_WORKSPACE: path.join(temp, "workspace"),
    VINTRACE_WORKSPACE_DB_KEY: Buffer.alloc(32, 37).toString("base64url"),
    VINTRACE_REQUIRE_DB_ENCRYPTION: "1",
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
    await page.locator(".language-picker select").selectOption("en");
    await dismissOnboarding(page);
    await page.locator('.nav-list [data-tab="agents"]').click();
    const panel = page.locator(".local-sync-panel");
    await expect(panel.getByRole("heading", { name: "Keep catalog edits in step" })).toBeVisible();
    await expect(panel).toContainText("Stopped");
    await expect(panel).not.toContainText("Workspace encryption required");

    await panel.getByLabel("Device name").fill("QA studio Mac");
    const setup = panel.getByRole("button", { name: "Set up device" });
    await expect(setup).toBeEnabled();
    await setup.focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("button", { name: "Save name" })).toBeVisible();
    await expect(panel.locator(".local-sync-summary")).toContainText("0paired");

    await panel.getByLabel("This device address").fill("127.0.0.1");
    await panel.getByRole("button", { name: "Create one-use code" }).click();
    const invitation = panel.locator(".local-sync-invitation");
    await expect(invitation).toContainText("127.0.0.1:");
    await expect(invitation.getByRole("img", { name: "Local sync pairing QR code" })).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(panel).toContainText("Listening");
    await expect(panel.getByRole("button", { name: "Stop listener" })).toBeVisible();

    const recovery = panel.locator(".local-sync-recovery");
    await recovery.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(recovery).toHaveAttribute("open", "");
    await recovery.getByPlaceholder("Recovery passphrase").first().fill("local sync ui recovery phrase");
    await recovery.getByRole("button", { name: "Create bundle" }).click();
    await expect(recovery.getByRole("button", { name: "Copy bundle" })).toBeVisible();
    await expect(panel).toContainText("Recovery bundle created.");

    await page.setViewportSize({ width: 1280, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    expect(await visibleSurfaceIssues(page), "local sync desktop state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "local-sync-desktop.png") });

    await page.setViewportSize({ width: 540, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator(".local-sync-pair-grid")).toBeVisible();
    expect(await visibleSurfaceIssues(page), "local sync compact state").toEqual([]);
    await page.screenshot({ path: path.join(SHOT, "local-sync-compact.png") });

    await panel.getByRole("button", { name: "Stop listener" }).click();
    await expect(panel).toContainText("Stopped");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
