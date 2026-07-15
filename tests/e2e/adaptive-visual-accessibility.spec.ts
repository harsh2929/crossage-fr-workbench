import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { visibleSurfaceIssues } from "./ui-surface-audit";

test.skip(
  process.env.VINTRACE_ADAPTIVE_VISUAL !== "1",
  "Set VINTRACE_ADAPTIVE_VISUAL=1 to run reduced-motion and forced-colors QA.",
);

const SHOT = process.env.QA_SHOT_DIR || "/tmp/vintrace-ui-audit/adaptive";

async function dismissDialogs(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function selectTab(page: Page, tab: string) {
  const button = page.locator(`.nav-list [data-tab="${tab}"]`);
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

async function reducedMotionIssues(page: Page) {
  return page.evaluate(() => {
    const seconds = (value: string) => value.split(",").map((part) => {
      const token = part.trim();
      if (token.endsWith("ms")) return Number.parseFloat(token) / 1_000;
      if (token.endsWith("s")) return Number.parseFloat(token);
      return 0;
    }).filter(Number.isFinite);
    const label = (element: Element) => {
      const html = element as HTMLElement;
      return `${element.tagName.toLowerCase()}.${String(html.className || "").trim().replace(/\s+/g, ".")}`.slice(0, 180);
    };
    const issues: Array<Record<string, unknown>> = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (!element.getClientRects().length) continue;
      const style = getComputedStyle(element);
      const transitions = seconds(style.transitionDuration);
      if (transitions.some((duration) => duration > 0.000_002)) {
        issues.push({ kind: "transition", element: label(element), duration: style.transitionDuration });
      }
      if (!element.classList.contains("spin") && style.animationName !== "none") {
        const animations = seconds(style.animationDuration);
        if (animations.some((duration) => duration > 0.000_002)) {
          issues.push({ kind: "animation", element: label(element), name: style.animationName, duration: style.animationDuration });
        }
      }
      if (issues.length >= 20) break;
    }
    return issues;
  });
}

test("primary surfaces honor reduced motion and remain legible in forced colors", async () => {
  test.setTimeout(180_000);
  mkdirSync(SHOT, { recursive: true });
  const root = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-adaptive-visual-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: root,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: [path.join(root, "desktop/main.cjs")], cwd: root, env });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en").catch(() => undefined);
    await dismissDialogs(page);

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    for (const tab of ["library", "memories", "albums", "search", "agents", "people", "tools", "settings"]) {
      await selectTab(page, tab);
      expect(await reducedMotionIssues(page), `${tab} reduced motion`).toEqual([]);
    }
    await page.screenshot({ path: path.join(SHOT, "reduced-motion-settings.png"), fullPage: true });

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect.poll(() => page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    for (const tab of ["library", "memories", "albums", "search", "agents", "people", "tools", "settings"]) {
      await selectTab(page, tab);
      expect(await visibleSurfaceIssues(page), `${tab} forced colors`).toEqual([]);
      const activeOutline = await page.locator(`.nav-list [data-tab="${tab}"]`).evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) || 0 };
      });
      expect(activeOutline.style, `${tab} active outline`).not.toBe("none");
      expect(activeOutline.width, `${tab} active outline width`).toBeGreaterThanOrEqual(2);
    }
    await page.keyboard.press("Tab");
    const focusOutline = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return { style: "none", width: 0, focusVisible: false };
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth) || 0,
        focusVisible: element.matches(":focus-visible"),
      };
    });
    expect(focusOutline.focusVisible).toBe(true);
    expect(focusOutline.style).not.toBe("none");
    expect(focusOutline.width).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: path.join(SHOT, "forced-colors-settings.png"), fullPage: true });

    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    const browserWindow = await app.browserWindow(page);
    await browserWindow.evaluate((window) => window.webContents.setZoomFactor(4));
    const zoomFactor = await browserWindow.evaluate((window) => window.webContents.getZoomFactor());
    expect(zoomFactor).toBeCloseTo(4, 2);
    for (const tab of ["library", "memories", "albums", "search", "agents", "people", "tools", "settings"]) {
      await selectTab(page, tab);
      await page.waitForTimeout(100);
      const activeRouteVisibility = await page.locator(`.nav-list [data-tab="${tab}"]`).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const navRect = element.closest(".nav-list")?.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: document.documentElement.clientWidth,
          insideNav: Boolean(navRect && rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1),
        };
      });
      expect(activeRouteVisibility.left, `${tab} left edge at 400% zoom`).toBeGreaterThanOrEqual(0);
      expect(activeRouteVisibility.right, `${tab} right edge at 400% zoom`).toBeLessThanOrEqual(activeRouteVisibility.viewportWidth + 1);
      expect(activeRouteVisibility.insideNav, `${tab} active route clipped at 400% zoom`).toBe(true);
      const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(documentOverflow, `${tab} document horizontal overflow at 400% zoom`).toBeLessThanOrEqual(1);
      expect(await visibleSurfaceIssues(page), `${tab} at 400% zoom`).toEqual([]);
    }
    const zoomCaptureDataUrl = await browserWindow.evaluate(async (window) => (
      await window.webContents.capturePage()
    ).toDataURL());
    writeFileSync(
      path.join(SHOT, "zoom-400-settings.png"),
      Buffer.from(zoomCaptureDataUrl.replace(/^data:image\/png;base64,/, ""), "base64"),
    );
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
