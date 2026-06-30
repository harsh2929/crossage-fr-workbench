import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_I18N_LAYOUT !== "1", "Set VINTRACE_I18N_LAYOUT=1 to run all-language layout QA.");

const languages = [
  { code: "en", nav: "Dashboard", photosNav: "Photos", allPhotos: "All Photos", emptyPhotos: "No photos here yet", dir: "ltr" },
  { code: "zh", nav: "仪表盘", photosNav: "照片", allPhotos: "所有照片", emptyPhotos: "这里还没有照片", dir: "ltr" },
  { code: "es", nav: "Panel", photosNav: "Fotos", allPhotos: "Todas las fotos", emptyPhotos: "Aún no hay fotos aquí", dir: "ltr" },
  { code: "fr", nav: "Tableau", photosNav: "Photos", allPhotos: "Toutes les photos", emptyPhotos: "Aucune photo ici pour le moment", dir: "ltr" },
  { code: "ar", nav: "لوحة التحكم", photosNav: "الصور", allPhotos: "كل الصور", emptyPhotos: "لا توجد صور هنا بعد", dir: "rtl" },
  { code: "hi", nav: "डैशबोर्ड", photosNav: "तस्वीरें", allPhotos: "सभी फ़ोटो", emptyPhotos: "यहाँ अभी कोई फ़ोटो नहीं", dir: "ltr" },
  { code: "ja", nav: "ダッシュボード", photosNav: "写真", allPhotos: "すべての写真", emptyPhotos: "ここにはまだ写真がありません", dir: "ltr" }
];

async function closeOnboarding(page: Page) {
  await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) return;
    const secondary = page.locator(".modal-backdrop .secondary:visible").last();
    if (await secondary.isVisible().catch(() => false)) {
      await secondary.click().catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await page.waitForTimeout(100);
  }
}

async function visibleOverflow(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("button, .nav-item, select"));
    return nodes
      .filter((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return false;
        if (node.closest("[data-allow-overflow]")) return false;
        return node.scrollWidth > Math.ceil(node.clientWidth) + 2 || node.scrollHeight > Math.ceil(node.clientHeight) + 2;
      })
      .map((node) => ({
        tag: node.tagName,
        text: (node.textContent || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 120),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight
      }));
  });
}

test("all supported languages keep primary tabs readable", async ({}, testInfo) => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-i18n-layout-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const pageErrors: string[] = [];
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_TEST_DIALOG_PATHS: workspace,
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
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

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await closeOnboarding(page);

  for (const language of languages) {
    await page.locator(".language-picker select").selectOption(language.code);
    await closeOnboarding(page);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    await expect(page.locator(".nav-list").getByRole("button", { name: language.nav })).toBeVisible();
    await page.locator(".nav-list").getByRole("button", { name: language.photosNav }).click();
    const photosPage = page.locator(".photos-page");
    await expect(photosPage.locator(".photos-gallery-head strong")).toHaveText(language.allPhotos);
    await expect(photosPage.getByText(language.emptyPhotos, { exact: true })).toBeVisible();
    await page.locator(".nav-list button").first().click();
    await page.screenshot({ path: testInfo.outputPath(`layout-${language.code}-dashboard.png`), fullPage: true });
    const navCount = await page.locator(".nav-list button").count();
    for (let index = 1; index < navCount; index += 1) {
      await page.locator(".nav-list button").nth(index).click();
      await page.screenshot({ path: testInfo.outputPath(`layout-${language.code}-tab-${index}.png`), fullPage: true });
      const clipped = await visibleOverflow(page);
      expect(clipped, `${language.code} tab ${index} clipped controls`).toEqual([]);
    }
  }

  expect(pageErrors).toEqual([]);
  await app.close();
});
