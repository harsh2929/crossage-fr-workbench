import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function packagedExecutable(projectRoot: string) {
  const explicit = String(process.env.VINTRACE_PACKAGED_EXECUTABLE || "").trim();
  if (explicit) return path.resolve(explicit);
  if (process.platform === "darwin") {
    const candidates = ["mac-arm64", "mac-x64", "mac"].map((dir) => path.join(projectRoot, "dist", dir, "Vintrace.app", "Contents", "MacOS", "Vintrace"));
    return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  }
  if (process.platform === "win32") {
    return path.join(projectRoot, "dist", "win-unpacked", "Vintrace.exe");
  }
  return path.join(projectRoot, "dist", "linux-unpacked", "vintrace");
}

function isAppImageExecutable(executablePath: string) {
  return process.platform === "linux" && /\.AppImage$/i.test(executablePath);
}

function packagedNotice(executablePath: string) {
  if (process.platform === "darwin") {
    return path.resolve(path.dirname(executablePath), "..", "Resources", "THIRD_PARTY_NOTICES.md");
  }
  return path.join(path.dirname(executablePath), "resources", "THIRD_PARTY_NOTICES.md");
}

function packagedProductionLock(executablePath: string) {
  if (process.platform === "darwin") {
    return path.resolve(path.dirname(executablePath), "..", "Resources", "requirements-production.lock.txt");
  }
  return path.join(path.dirname(executablePath), "resources", "requirements-production.lock.txt");
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
  const translatedX64Audit = process.env.VINTRACE_E2E_TRANSLATED_X64 === "1";
  test.setTimeout(translatedX64Audit ? 10 * 60_000 : 5 * 60_000);
  const projectRoot = process.cwd();
  const executablePath = packagedExecutable(projectRoot);
  test.skip(process.env.VINTRACE_PACKAGED_SMOKE !== "1", "Run npm run test:e2e:packaged.");
  test.skip(!existsSync(executablePath), `Packaged app not found at ${executablePath}. Run npm run pack:unsigned first.`);
  if (!isAppImageExecutable(executablePath)) {
    expect(existsSync(packagedNotice(executablePath)), "packaged third-party notice").toBe(true);
    expect(existsSync(packagedProductionLock(executablePath)), "packaged production hash lock").toBe(true);
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-packaged-e2e-"));
  const refDir = path.join(temp, "references");
  const scanDir = path.join(temp, "scan");
  const diagnosticsPath = path.join(temp, "diagnostics.json");
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  writeSyntheticPpm(path.join(refDir, "person.ppm"), [34, 74, 132]);
  writeSyntheticPpm(path.join(scanDir, "candidate.ppm"), [34, 74, 132]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    CROSSAGE_TEST_DIAGNOSTICS_PATH: diagnosticsPath,
    CROSSAGE_WORKSPACE: workspace,
    VINTRACE_WORKSPACE: workspace
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const launchArgs = process.env.VINTRACE_E2E_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
  if (translatedX64Audit) {
    launchArgs.push("--disable-gpu", "--enable-features=NetworkServiceInProcess2");
  }
  const app = await electron.launch({
    executablePath,
    cwd: projectRoot,
    env,
    args: launchArgs,
  });
  try {
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await expect(page.getByText("Vintrace", { exact: true })).toBeVisible();
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 180_000 });
    const electronVersions = await app.evaluate(() => process.versions);
    expect(electronVersions.electron).toBe("43.1.0");
    expect(electronVersions.chrome).toBe("150.0.7871.47");
    expect(electronVersions.node).toBe("24.18.0");
    expect(electronVersions.modules).toBe("148");
    const runtimeSelfTest = await page.evaluate(() => (window as any).crossAge.invoke("runtime_self_test", {}));
    const runtimeReport = runtimeSelfTest.value ?? runtimeSelfTest;
    const onnxRuntime = runtimeReport.checks?.find((item: any) => item.name === "ONNX Runtime 1.27.0");
    expect(onnxRuntime?.ok).toBe(true);
    expect(onnxRuntime?.value?.packageVersion).toBe("1.27.0");
    expect(onnxRuntime?.value?.runtimeVersion).toBe("1.27.0");
    expect(onnxRuntime?.value?.nativeModulePresent).toBe(true);
    expect(onnxRuntime?.value?.providers).toContain("CPUExecutionProvider");
    expect(onnxRuntime?.value?.inferenceOutput).toEqual([0.25, -1.5]);
    const appleStatus = await page.evaluate(() => (window as any).crossAge.invoke("apple_photos_status", {}));
    if (process.platform === "darwin") {
      expect(appleStatus.value?.available).toBe(true);
      expect(appleStatus.value?.dependencyVersion).toBe("0.76.1");
    } else {
      expect(appleStatus.value?.available).toBe(false);
    }
    const guide = page.getByRole("dialog", { name: "Set up your first scan" });
    await guide.waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
    if (await guide.isVisible().catch(() => false)) {
      await guide.getByRole("button", { name: "Remind me later" }).click();
      await expect(guide).toBeHidden();
    }
    await page.locator(".nav-list").getByRole("button", { name: "Settings" }).click();
    await page.locator(".section-tab", { hasText: "Engine & Models" }).click();
    await expect(page.getByText("Model switch guide")).toBeVisible();
    const modelDryRun = await page.evaluate(() => (window as any).crossAge.invoke("model_switch_dry_run", { targetPack: "antelopev2" }));
    expect(modelDryRun.targetPack).toBe("antelopev2");
    expect(Array.isArray(modelDryRun.actions)).toBe(true);
    await page.locator(".section-tab", { hasText: "Advanced" }).click();
    await expect(page.getByText("Performance center")).toBeVisible();
    const performanceCenter = page.locator(".performance-center");
    await expect(performanceCenter.locator(".performance-mode")).toHaveCount(4);
    for (const name of [/^Auto\b/, /^Fast\b/, /^Balanced\b/, /^Quality\b/]) {
      const modeButton = performanceCenter.getByRole("button", { name });
      await expect(modeButton).toBeVisible();
      await expect(modeButton).toBeEnabled();
      await modeButton.click({ trial: true });
    }
    await page.evaluate((scope) => (window as any).crossAge.invoke("set_consent", {
      value: true,
      source: "packaged-smoke",
      operator: "Packaged smoke",
      scope
    }), scanDir);
    const relationshipSuggestions = await page.evaluate(() => (
      window as any
    ).crossAge.invoke("suggest_photo_relationship_names", { limit: 5 }));
    expect(relationshipSuggestions.value?.available).toBe(true);
    expect(relationshipSuggestions.value?.offline).toBe(true);
    expect(relationshipSuggestions.value?.reviewRequired).toBe(true);
    expect(relationshipSuggestions.value?.suggestions).toEqual([]);
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
