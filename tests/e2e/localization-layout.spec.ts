import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_I18N_LAYOUT !== "1", "Set VINTRACE_I18N_LAYOUT=1 to run all-language layout QA.");

const languages = [
  { code: "en", libraryNav: "Library", allPhotos: "All Photos", emptyPhotos: "No photos here yet", dir: "ltr" },
  { code: "zh", libraryNav: "图库", allPhotos: "所有照片", emptyPhotos: "这里还没有照片", dir: "ltr" },
  { code: "es", libraryNav: "Fototeca", allPhotos: "Todas las fotos", emptyPhotos: "Aún no hay fotos aquí", dir: "ltr" },
  { code: "fr", libraryNav: "Photothèque", allPhotos: "Toutes les photos", emptyPhotos: "Aucune photo ici pour le moment", dir: "ltr" },
  { code: "ar", libraryNav: "المكتبة", allPhotos: "كل الصور", emptyPhotos: "لا توجد صور هنا بعد", dir: "rtl" },
  { code: "hi", libraryNav: "लाइब्रेरी", allPhotos: "सभी फ़ोटो", emptyPhotos: "यहाँ अभी कोई फ़ोटो नहीं", dir: "ltr" },
  { code: "ja", libraryNav: "ライブラリ", allPhotos: "すべての写真", emptyPhotos: "ここにはまだ写真がありません", dir: "ltr" }
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
    const controlIssues = nodes
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
    const containerIssues = Array.from(document.querySelectorAll<HTMLElement>(
      ".workspace, .main-content, .section-tabs, [role='dialog'], [role='menu']"
    )).filter((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return false;
      if (node.closest("[data-allow-overflow]") || ["auto", "scroll"].includes(style.overflowX)) return false;
      return node.scrollWidth > Math.ceil(node.clientWidth) + 2;
    }).map((node) => ({
      tag: node.tagName,
      text: (node.getAttribute("aria-label") || node.className || node.getAttribute("role") || "container").toString().slice(0, 120),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    return [...controlIssues, ...containerIssues];
  });
}

async function expectNavigationScrollbarHidden(page: Page, context: string) {
  const state = await page.locator(".nav-list").evaluate((node) => {
    const element = node as HTMLElement;
    const pseudo = window.getComputedStyle(element, "::-webkit-scrollbar");
    return {
      overflows: element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2,
      webkitDisplay: pseudo.display,
      scrollbarWidth: window.getComputedStyle(element).scrollbarWidth,
    };
  });
  if (state.overflows) {
    expect(
      state.webkitDisplay === "none" || state.scrollbarWidth === "none",
      `${context} navigation keeps overflow reachable without native scrollbar chrome`,
    ).toBe(true);
  }
}

test("all supported languages keep primary tabs readable", async ({}, testInfo) => {
  test.setTimeout(300_000);
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

  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await closeOnboarding(page);

  for (const language of languages) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".language-picker select").selectOption(language.code);
    await closeOnboarding(page);
    await expect(page.locator("html")).toHaveAttribute("dir", language.dir);
    const libraryTab = page.locator('.nav-list [data-tab="library"]');
    await expect(libraryTab).toBeVisible();
    await expect(libraryTab.locator(".nav-label")).toHaveText(language.libraryNav);
    if (language.code === "ar") {
      const albumsTab = page.locator('.nav-list [data-tab="albums"]');
      await albumsTab.click();
      await albumsTab.focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator('.nav-list [data-tab="memories"]')).toHaveClass(/active/);
      await page.keyboard.press("ArrowLeft");
      await expect(albumsTab).toHaveClass(/active/);
    }
    await libraryTab.click();
    const photosPage = page.locator(".photos-page");
    await expect(photosPage.locator(".photos-gallery-head strong")).toHaveText(language.allPhotos);
    await expect(photosPage.getByText(language.emptyPhotos, { exact: true })).toBeVisible();
    await page.locator(".nav-list button").first().click();
    await page.screenshot({ path: testInfo.outputPath(`layout-${language.code}-library.png`), fullPage: true });
    const navCount = await page.locator(".nav-list button").count();
    for (let index = 1; index < navCount; index += 1) {
      await page.locator(".nav-list button").nth(index).click();
      await page.screenshot({ path: testInfo.outputPath(`layout-${language.code}-tab-${index}.png`), fullPage: true });
      const clipped = await visibleOverflow(page);
      expect(clipped, `${language.code} tab ${index} clipped controls`).toEqual([]);
    }

    await page.setViewportSize({ width: 800, height: 900 });
    for (let index = 0; index < navCount; index += 1) {
      await page.locator(".nav-list button").nth(index).click();
      const clipped = await visibleOverflow(page);
      expect(clipped, `${language.code} compact tab ${index} clipped controls or containers`).toEqual([]);
      await expectNavigationScrollbarHidden(page, `${language.code} compact tab ${index}`);
    }
    await page.locator('.nav-list [data-tab="tools"]').click();
    await expect(page.locator(".section-tabs")).toBeVisible();
    expect(await visibleOverflow(page), `${language.code} compact Tools section tabs`).toEqual([]);
    await page.locator(".sidebar-guide-button").click();
    const guideDialog = page.getByRole("dialog").last();
    await expect(guideDialog).toBeVisible();
    expect(await visibleOverflow(page), `${language.code} compact Guide dialog`).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`layout-${language.code}-compact-dialog.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(guideDialog).toHaveCount(0);
  }

  expect(pageErrors).toEqual([]);
  await app.close();
});

test("Hindi translations roll back to English in cached tabs", async () => {
  test.setTimeout(180_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-i18n-rollback-"));
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

  try {
    await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
    await closeOnboarding(page);

    // Prime the cached routes with English React output, then translate them
    // while hidden. React still believes these nodes contain English, so only
    // the reverse DOM-localization pass can reliably restore them.
    const languagePicker = page.locator(".sidebar-footer .language-picker select");
    const agentsTab = page.locator('.nav-list [data-tab="agents"]');
    const searchTab = page.locator('.nav-list [data-tab="search"]');
    const settingsTab = page.locator('.nav-list [data-tab="settings"]');
    const libraryTab = page.locator('.nav-list [data-tab="library"]');
    await languagePicker.selectOption("en");
    await agentsTab.click();
    await expect(page.locator(".agent-platform-page h1")).toHaveText("Your entire image library, ready for AI agents.");
    await searchTab.click();
    await expect(page.locator(".search-hero-input")).toHaveAttribute("placeholder", "Search photos, people, places, things");
    await settingsTab.click();
    await expect(page.locator(".primary-settings > p.compact")).toHaveText("Most people should use a preset. Custom controls are still here for advanced tuning.");
    await libraryTab.click();

    await languagePicker.selectOption("hi");
    await expect(page.locator(".agent-platform-page h1")).toHaveText("आपकी पूरी इमेज लाइब्रेरी, AI एजेंट के लिए तैयार।");
    await expect(page.locator(".primary-settings > p.compact")).toHaveText("अधिकतर लोगों को प्रीसेट उपयोग करना चाहिए। उन्नत सेटिंग के लिए कस्टम नियंत्रण उपलब्ध हैं।");
    await expect(page.locator('input[aria-label="लॉगिन पर शुरू करें"]')).toHaveCount(1);

    await languagePicker.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    // Assert while routes are hidden, before activating them gives React
    // another opportunity to rewrite their content.
    await expect(page.locator(".agent-platform-page h1")).toHaveText("Your entire image library, ready for AI agents.");
    await expect(page.locator(".primary-settings > p.compact")).toHaveText("Most people should use a preset. Custom controls are still here for advanced tuning.");
    await expect(page.locator('input[aria-label="Start at login"]')).toHaveCount(1);
    await expect(page.locator(".search-hero-input")).toHaveAttribute("placeholder", "Search photos, people, places, things");
    await expect(languagePicker).toHaveValue("en");

    const tabCount = await page.locator(".nav-list button").count();
    for (let index = 0; index < tabCount; index += 1) {
      await page.locator(".nav-list button").nth(index).click();
      const visibleWorkspaceText = await page.locator(".workspace").innerText();
      const englishUiText = visibleWorkspaceText.replaceAll("हिन्दी", "");
      expect(englishUiText, `English rollback left Hindi text on tab ${index}`).not.toMatch(/[\u0900-\u097f]/u);
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
