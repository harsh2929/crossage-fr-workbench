import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function packagedExecutable(projectRoot: string) {
  if (process.platform === "darwin") {
    const candidates = ["mac-arm64", "mac-x64", "mac"].map((dir) => path.join(projectRoot, "dist", dir, "Vintrace.app", "Contents", "MacOS", "Vintrace"));
    return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  }
  if (process.platform === "win32") {
    return path.join(projectRoot, "dist", "win-unpacked", "Vintrace.exe");
  }
  return path.join(projectRoot, "dist", "linux-unpacked", "vintrace");
}

function writeSyntheticPpm(filePath: string, accent: [number, number, number]) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const width = 32;
  const height = 32;
  const pixels: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const face = x >= 9 && x <= 22 && y >= 6 && y <= 23;
      const eye = (y === 13 && (x === 13 || x === 19));
      const mouth = y === 19 && x >= 13 && x <= 19;
      if (eye || mouth) pixels.push("35 35 42");
      else if (face) pixels.push("232 198 168");
      else pixels.push(`${accent[0]} ${accent[1]} ${accent[2]}`);
    }
  }
  writeFileSync(filePath, `P3\n${width} ${height}\n255\n${pixels.join("\n")}\n`, "utf8");
}

test("packaged desktop app launches, scans, exports diagnostics, and exposes production controls", async () => {
  const projectRoot = process.cwd();
  const executablePath = packagedExecutable(projectRoot);
  test.skip(!existsSync(executablePath), `Packaged app not found at ${executablePath}. Run npm run pack:unsigned first.`);
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-packaged-e2e-"));
  const refDir = path.join(temp, "references");
  const scanDir = path.join(temp, "scan");
  const diagnosticsPath = path.join(temp, "diagnostics.json");
  writeSyntheticPpm(path.join(refDir, "person.ppm"), [34, 74, 132]);
  writeSyntheticPpm(path.join(scanDir, "candidate.ppm"), [34, 74, 132]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_REGISTRY_HOME: path.join(temp, "registry"),
    CROSSAGE_TEST_DIAGNOSTICS_PATH: diagnosticsPath,
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
    await expect(page.getByText("Model switch guide")).toBeVisible();
    const modelDryRun = await page.evaluate(() => (window as any).crossAge.invoke("model_switch_dry_run", { targetPack: "antelopev2" }));
    expect(modelDryRun.targetPack).toBe("antelopev2");
    expect(Array.isArray(modelDryRun.actions)).toBe(true);
    await page.evaluate((scope) => (window as any).crossAge.invoke("set_consent", {
      value: true,
      source: "packaged-smoke",
      operator: "Packaged smoke",
      scope
    }), scanDir);
    const enrolled = await page.evaluate((folder) => (window as any).crossAge.invoke("enroll", {
      personName: "Packaged Smoke",
      ageBucket: "adult",
      folder
    }), refDir);
    expect(enrolled.added ?? 0).toBeGreaterThan(0);
    const scanned = await page.evaluate((folder) => (window as any).crossAge.invoke("scan", {
      folder,
      source: "packaged-smoke",
      resume: false,
      allowIncompatibleModel: true
    }), scanDir);
    expect(scanned.metrics?.processed ?? 0).toBeGreaterThan(0);
    const diagnostics = await page.evaluate(() => (window as any).crossAge.exportDiagnosticsReport(false));
    expect(diagnostics.cancelled).toBe(false);
    expect(diagnostics.path).toBeTruthy();
    expect(existsSync(diagnosticsPath)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
