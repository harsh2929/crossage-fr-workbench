import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface FixtureInfo {
  base: string;
  pairingUrl: string;
  accountsPath: string;
  accountId: string;
}

function pythonExecutable() {
  const explicit = String(process.env.PYTHON || "").trim();
  if (explicit) return explicit;
  const venv = path.join(process.cwd(), ".venv", "bin", "python3");
  return existsSync(venv) ? venv : "python3";
}

async function startFixture(): Promise<{ child: ChildProcessWithoutNullStreams; info: FixtureInfo }> {
  const child = spawn(pythonExecutable(), ["tests/fixtures/mobile_companion_server.py"], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: process.cwd() },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const info = await new Promise<FixtureInfo>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Mobile fixture timed out. ${stderr}`)), 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as FixtureInfo);
      } catch (error) {
        reject(new Error(`Mobile fixture returned invalid startup metadata: ${stdout}\n${stderr}\n${String(error)}`));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Mobile fixture exited before startup (${code}). ${stderr}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { child, info };
}

async function stopFixture(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("paired mobile companion is responsive, useful, read-only, and revocable", async ({ browser }, testInfo) => {
  const { child, info } = await startFixture();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    locale: "en-US",
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ status: number; url: string }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });

  try {
    await page.goto(info.pairingUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.getByText("Recent photos")).toBeVisible();
    await expect(page).toHaveURL(`${info.base}/mobile/`);
    await expect(page.locator(".overview-band").getByText("6").first()).toBeVisible();
    await expect(page.locator(".asset-card .asset-preview img").first()).toBeVisible();
    await expect.poll(async () => page.locator(".asset-card .asset-preview img").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      hash: location.hash,
    }));
    expect(storage).toEqual({ local: [], session: [], hash: "" });
    const cookies = await context.cookies(info.base);
    const mobileCookie = cookies.find((cookie) => cookie.name === "vintrace_mobile_dev");
    expect(mobileCookie?.httpOnly).toBe(true);
    expect(mobileCookie?.sameSite).toBe("Strict");

    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
    await page.screenshot({ path: testInfo.outputPath("mobile-library.png"), fullPage: true });

    await page.locator(".bottom-nav button").filter({ hasText: "Search" }).click();
    await page.getByPlaceholder("Search photos, places, text, or objects").fill("Sunset garden");
    await page.locator(".search-submit").click();
    const sunset = page.locator(".asset-card").filter({ hasText: "Sunset garden" });
    await expect(sunset).toBeVisible();
    await sunset.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Sunset garden", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /save|edit|delete|upload/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();

    const forged = await page.evaluate(async () => {
      const response = await fetch("/v1/actions/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane: "read", action: "update_photo_asset_metadata", payload: {} }),
      });
      return { status: response.status, payload: await response.json() };
    });
    expect(forged.status).toBe(403);
    expect(forged.payload.error.code).toBe("mobile_read_only");

    await page.locator(".bottom-nav button").filter({ hasText: "Session" }).click();
    await expect(page.getByText("Browser test phone")).toBeVisible();
    await expect(page.getByText("Read only").first()).toBeVisible();
    await expect(page.getByText("Photo previews enabled")).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile-session-wide.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    const accountsDocument = JSON.parse(await readFile(info.accountsPath, "utf8")) as { accounts: Array<Record<string, unknown>> };
    const account = accountsDocument.accounts.find((row) => row.accountId === info.accountId);
    expect(account).toBeTruthy();
    Object.assign(account!, {
      disabled: true,
      revokedAt: new Date().toISOString(),
      tokenSha256: "0".repeat(64),
    });
    const temporary = `${info.accountsPath}.playwright.tmp`;
    await writeFile(temporary, `${JSON.stringify(accountsDocument, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, info.accountsPath);

    await page.locator(".header-refresh").click();
    await expect(page.getByText("Mobile access is disconnected")).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((message) => !message.startsWith("Failed to load resource:"))).toEqual([]);
    expect(failedResponses.length).toBeGreaterThanOrEqual(2);
    expect(failedResponses.every((response) => (
      (response.status === 403 && response.url.endsWith("/v1/actions/run"))
      || (response.status === 401 && response.url.includes("/v1/library"))
    ))).toBe(true);
  } finally {
    await context.close();
    await stopFixture(child);
  }
});
