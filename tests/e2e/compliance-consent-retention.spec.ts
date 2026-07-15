import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOT = process.env.QA_SHOT_DIR || path.join(os.tmpdir(), "vintrace-compliance-e2e");

async function dismissModals(page: Page) {
  for (let index = 0; index < 4; index += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
}

async function continueConfirmation(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Please confirm" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test("strict consent, publication, retention, and one-subject deletion", async () => {
  test.setTimeout(180_000);
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-compliance-ui-"));
  mkdirSync(SHOT, { recursive: true });
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
    await dismissModals(page);
    await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
    await page.locator(".section-tab", { hasText: "Privacy & Safety" }).click();
    await expect(page.getByRole("heading", { name: "Consent, disclosure, and retention" })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Jurisdiction preset").selectOption("bipa-il");
    await continueConfirmation(page);
    await expect(page.getByLabel("Jurisdiction preset")).toHaveValue("bipa-il");

    await page.getByLabel("Permission for this app folder").click();
    const consent = page.getByRole("dialog", { name: "Confirm permission" });
    await expect(consent.getByText("Vintrace AI and biometric processing notice")).toBeVisible();
    await expect(consent.getByText(/probabilistic investigative suggestions/)).toBeVisible();
    const consentButton = consent.getByRole("button", { name: "Confirm permission" });
    await expect(consentButton).toBeDisabled();
    await consent.getByLabel(/I have read and acknowledge/).check();
    await expect(consentButton).toBeEnabled();
    await consentButton.click();
    await expect(page.getByText("Allowed", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: "Subject", exact: true }).fill("Alice Example");
    await page.getByRole("textbox", { name: "Signer", exact: true }).fill("Alice Example");
    await page.getByRole("combobox", { name: "Signer role", exact: true }).selectOption("self");
    await page.getByRole("spinbutton", { name: "Collection term", exact: true }).fill("365");
    await page.getByRole("textbox", { name: "Specific purpose", exact: true }).fill("Find and review a private family archive.");
    await page.getByRole("textbox", { name: "Lawful basis", exact: true }).fill("informed-written-release");
    await page.getByLabel(/received written notice/).check();
    await page.getByLabel(/reviewed the current AI/).check();
    await page.getByLabel(/adopts this record/).check();
    await page.getByRole("button", { name: "Save written release" }).click();
    const releaseRow = page.locator(".release-record-row", { hasText: "Alice Example" });
    await expect(releaseRow).toContainText("Valid through", { timeout: 20_000 });

    await page.getByRole("textbox", { name: "Public policy URL", exact: true }).fill("https://example.test/privacy/biometric-retention");
    await page.getByRole("textbox", { name: "Approved by", exact: true }).fill("Privacy Officer");
    await page.getByRole("button", { name: "Record publication" }).click();
    await continueConfirmation(page);
    await expect(page.getByText("Current public policy recorded")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Current", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Enforce now" }).click();
    await continueConfirmation(page);
    await expect(page.getByText(/Retention enforced:/)).toBeAttached({ timeout: 20_000 });

    const panel = page.locator(".compliance-governance");
    await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOT, "compliance-desktop.png"), fullPage: true });
    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.setSize(390, 844));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
    const compact = await panel.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth + 2);
    await page.screenshot({ path: path.join(SHOT, "compliance-mobile.png"), fullPage: true });

    await page.getByRole("button", { name: "Revoke release and delete subject data: Alice Example" }).click();
    await continueConfirmation(page);
    await expect(releaseRow).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/original media was preserved/i)).toBeAttached();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
