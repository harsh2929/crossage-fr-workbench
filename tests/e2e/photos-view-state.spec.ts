import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { mkdirSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";

type HarnessCall = {
  name: string;
  params: Record<string, unknown>;
  at: number;
};

declare global {
  interface Window {
    __photosViewStateHarness?: {
      calls: HarnessCall[];
      clearCalls: () => void;
      setItemDelay: (query: string, delayMs: number) => void;
      clearItemDelays: () => void;
    };
  }
}

let server: ViteDevServer;
let baseUrl = "";

test.beforeAll(async () => {
  server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

test.afterAll(async () => {
  await server?.close();
});

async function itemRequests(page: import("@playwright/test").Page): Promise<HarnessCall[]> {
  return page.evaluate(() => window.__photosViewStateHarness?.calls.filter((call) => call.name === "listPhotoFolderItems") || []);
}

test("PhotosView state updates drive grid requests and selection UI", async ({ page }) => {
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toBeVisible();

  await page.evaluate(() => window.__photosViewStateHarness?.clearCalls());

  await page.getByLabel("Search photos").fill("sunrise");
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.query === "sunrise");
  }, { timeout: 5000 }).toBe(true);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);

  await page.getByLabel("Clear search").click();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toBeVisible();

  await page.evaluate(() => window.__photosViewStateHarness?.clearCalls());
  await page.getByRole("button", { name: "Filters" }).click();
  await page.locator(".photo-filter-toggle", { hasText: "Favorites" }).getByRole("checkbox").check();
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.favoriteOnly === true);
  }, { timeout: 5000 }).toBe(true);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);

  await page.getByLabel("Select Mountain Sunrise").check();
  await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
  await expect(page.getByLabel("Deselect Mountain Sunrise")).toBeChecked();
});

test("PhotosView ignores stale item pages that resolve after a newer filter", async ({ page }) => {
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toBeVisible();
  await page.evaluate(() => {
    window.__photosViewStateHarness?.clearCalls();
    window.__photosViewStateHarness?.clearItemDelays();
    window.__photosViewStateHarness?.setItemDelay("receipt", 900);
  });

  await page.getByLabel("Search photos").fill("receipt");
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.query === "receipt");
  }, { timeout: 5000 }).toBe(true);

  await page.getByLabel("Search photos").fill("sunrise");
  await expect.poll(async () => {
    const requests = await itemRequests(page);
    return requests.some((call) => call.params.query === "sunrise");
  }, { timeout: 5000 }).toBe(true);

  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);

  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: "Open photo Mountain Sunrise" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open photo Cafe Receipt" })).toHaveCount(0);
});

test("spatial photos expose only capability-backed depth and alternate-eye views", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html?spatial=1`);

  await page.getByRole("button", { name: "Open photo Spatial Portrait" }).click();
  const dialog = page.getByRole("dialog", { name: /Photo preview/ });
  await expect(dialog).toBeVisible();
  const viewer = dialog.locator(".photos-spatial-viewer");
  await expect(viewer).toHaveAttribute("data-spatial-kind", "stereo");
  await expect(viewer).toContainText("Stereo media");
  await expect(viewer).toContainText("Original, depth, and alternate-eye files are available.");

  const modes = dialog.getByRole("group", { name: "Spatial view mode" });
  const photoMode = modes.getByRole("button", { name: "Photo" });
  const depthMode = modes.getByRole("button", { name: "Depth" });
  const rightEyeMode = modes.getByRole("button", { name: "Right eye" });
  await expect(photoMode).toHaveAttribute("aria-pressed", "true");
  await depthMode.click();
  await expect(depthMode).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator("img.photos-lightbox-image")).toHaveAttribute("src", /#depth$/);
  await expect(dialog.locator("img.photos-lightbox-image")).toHaveAttribute("alt", "Spatial Portrait - Depth");
  await rightEyeMode.click();
  await expect(rightEyeMode).toHaveAttribute("aria-pressed", "true");
  await expect(rightEyeMode).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(dialog.locator("img.photos-lightbox-image")).toHaveAttribute("src", /#right-eye$/);
  await expect(dialog.locator("img.photos-lightbox-image")).toHaveAttribute("alt", "Spatial Portrait - Right eye");
  await dialog.screenshot({ path: "/tmp/vintrace-spatial-viewer-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect.poll(async () => modes.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.screenshot({ path: "/tmp/vintrace-spatial-viewer-mobile.png" });

  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open photo Embedded Depth" }).click();
  const metadataDialog = page.getByRole("dialog", { name: /Photo preview/ });
  const metadataViewer = metadataDialog.locator(".photos-spatial-viewer");
  await expect(metadataViewer).toHaveAttribute("data-spatial-kind", "spatial-metadata");
  await expect(metadataViewer).toContainText("Spatial metadata");
  await expect(metadataViewer).toContainText("no separately viewable companion was found");
  await expect(metadataDialog.getByRole("group", { name: "Spatial view mode" })).toHaveCount(0);
});

test("semantic video moments open the exact timestamp without automatic playback actions", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html?semanticVideo=1`);
  await expect(page.getByRole("button", { name: "Open photo Sunset Walk" })).toBeVisible();
  await page.evaluate(() => {
    const state = new WeakMap<HTMLMediaElement, { currentTime: number }>();
    const current = (media: HTMLMediaElement) => {
      const value = state.get(media) || { currentTime: 0 };
      state.set(media, value);
      return value;
    };
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() { return 4; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return current(this as HTMLMediaElement).currentTime; },
      set(value: number) { current(this as HTMLMediaElement).currentTime = Math.max(0, Number(value) || 0); },
    });
    window.__photosViewStateHarness?.clearCalls();
  });

  await page.getByLabel("Find photos and video moments by meaning").fill("sunset beside the lake");
  await page.getByRole("button", { name: "Search by meaning" }).click();
  await expect.poll(async () => page.evaluate(() => (
    window.__photosViewStateHarness?.calls.filter((call) => call.name === "semanticSearchPhotos").length || 0
  ))).toBe(1);

  const semanticPanel = page.getByRole("region", { name: "Semantic search results" });
  const moment = semanticPanel.getByRole("button", { name: /sunset-walk\.mp4, 100% match, video moment 0:02/i });
  await expect(moment).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Photo preview/ })).toHaveCount(0);
  await moment.click();

  const dialog = page.getByRole("dialog", { name: /Photo preview/ });
  await expect(dialog).toBeVisible();
  const video = dialog.locator("video.photos-lightbox-video");
  await expect(video).toHaveCount(1);
  await video.evaluate((element) => element.dispatchEvent(new Event("loadedmetadata")));
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(2.5);

  await dialog.getByRole("button", { name: "Close" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(moment).toBeVisible();
  const overflow = await page.evaluate(() => ({
    pixels: document.documentElement.scrollWidth - window.innerWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter((entry) => entry.right > window.innerWidth + 1)
      .slice(0, 12),
  }));
  expect(overflow.pixels, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(1);
});

test("video playback exposes synchronized generated captions and a keyboard-seekable transcript", async ({ page }) => {
  const screenshotDir = "/tmp/vintrace-ui-audit/accessibility";
  mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html?semanticVideo=1`);
  await page.evaluate(() => {
    const state = new WeakMap<HTMLMediaElement, { currentTime: number }>();
    const current = (media: HTMLMediaElement) => {
      const value = state.get(media) || { currentTime: 0 };
      state.set(media, value);
      return value;
    };
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() { return 4; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return current(this as HTMLMediaElement).currentTime; },
      set(value: number) { current(this as HTMLMediaElement).currentTime = Math.max(0, Number(value) || 0); },
    });
  });

  await page.getByRole("button", { name: "Open photo Sunset Walk" }).click();
  const dialog = page.getByRole("dialog", { name: /Photo preview/ });
  const video = dialog.locator("video.photos-lightbox-video");
  await expect(dialog).toBeVisible();
  await expect(video).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "photo_audio_segments",
  ).length || 0)).toBe(1);

  const captionsToggle = dialog.getByRole("button", { name: "Hide captions" });
  await expect(captionsToggle).toHaveAttribute("aria-pressed", "true");
  await video.evaluate((element) => {
    (element as HTMLVideoElement).currentTime = 0.6;
    element.dispatchEvent(new Event("timeupdate"));
  });
  const cue = dialog.locator(".photos-video-caption-cue");
  await expect(cue).toContainText("We reached the lake at sunset.");
  await expect(cue).toContainText("[music]");

  const transcript = dialog.getByRole("region", { name: "Transcript" });
  await expect(transcript).toContainText("Generated locally; review for accuracy.");
  await transcript.getByText("Full transcript", { exact: true }).click();
  await expect(transcript.getByRole("button", { name: /Seek to 0s: We reached the lake at sunset/ })).toBeVisible();
  await expect(transcript.getByRole("button", { name: /Seek to 0s: music/ })).toBeVisible();
  const secondSpeech = transcript.getByRole("button", { name: /Seek to 2s: The sky turned gold/ });
  await expect(secondSpeech).toBeVisible();
  await secondSpeech.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(2);
  await video.evaluate((element) => element.dispatchEvent(new Event("timeupdate")));
  await expect(cue).toContainText("The sky turned gold.");

  const axe = await new AxeBuilder({ page })
    .include(".photos-lightbox")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target),
  }))).toEqual([]);
  await dialog.screenshot({ path: `${screenshotDir}/video-captions-desktop.png` });

  await captionsToggle.click();
  await expect(dialog.getByRole("button", { name: "Show captions" })).toHaveAttribute("aria-pressed", "false");
  await expect(cue).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.evaluate((element) => { element.scrollTop = 0; });
  await dialog.screenshot({ path: `${screenshotDir}/video-captions-compact-top.png` });
  await transcript.scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: `${screenshotDir}/video-captions-compact-transcript.png` });
});

test("relationship naming suggestions require review before an undoable merge", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html?relationships=1`);

  const panel = page.getByRole("region", { name: "Who is this?" });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "suggestPhotoRelationshipNames",
  ).length || 0)).toBe(0);

  await panel.getByRole("button", { name: "Find suggestions" }).click();
  await expect(panel).toContainText("May be Sam");
  await expect(panel).toContainText("Alice · 2");
  await expect(panel).toContainText("Bob · 2");
  await expect(panel).toContainText("Relationship context is not proof of identity");
  await panel.screenshot({ path: "/tmp/vintrace-photo-relationships-desktop.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-photo-relationships-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });

  await panel.getByRole("button", { name: "Review and merge" }).click();
  const confirmation = page.getByRole("dialog", { name: "Review identity suggestion" });
  await expect(confirmation).toBeVisible();
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "reviewPhotoRelationshipNameSuggestion",
  ).length || 0)).toBe(0);

  await confirmation.getByRole("button", { name: "Merge identity" }).click();
  await expect(panel).not.toContainText("May be Sam");
  const reviewCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "reviewPhotoRelationshipNameSuggestion",
  ) || []);
  expect(reviewCalls).toHaveLength(1);
  expect(reviewCalls[0].params).toMatchObject({
    suggestionId: "relationship_name_fixture",
    sourceCluster: "Unmatched cluster graph-a",
    targetPerson: "Sam",
    decision: "applied",
    confirm: true,
  });
  expect(String(reviewCalls[0].params.idempotencyKey || "")).toMatch(/^photo-relationship:relationship_name_fixture:/);
});

test("Ask Library renders grounded answers and confirms writes at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);

  const panel = page.getByRole("region", { name: "Ask Library" });
  await panel.getByRole("button", { name: /Ask Library/ }).click();
  await expect(panel).toContainText("Offline · quality");

  await panel.getByRole("textbox", { name: "Ask Library question" }).fill("Find my cafe receipt and make a memory");
  await panel.getByRole("button", { name: "Send question" }).click();
  await expect(panel).toContainText("I found the cafe receipt from July 2");
  await expect(panel.getByRole("button", { name: /Cafe Receipt/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Review action" })).toBeVisible();

  await panel.getByRole("button", { name: "Local tool activity" }).click();
  await expect(panel).toContainText("Search Images");
  await expect(panel).toContainText("Analyze Image Assets");

  await panel.getByRole("button", { name: "Review action" }).click();
  await expect(panel.getByRole("button", { name: "Confirm action" })).toBeVisible();
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "executePhotoLibraryAgentPlan",
  ).length || 0)).toBe(0);
  await panel.getByRole("button", { name: "Confirm action" }).click();
  await expect(panel).toContainText("Completed");
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "executePhotoLibraryAgentPlan",
  ).length || 0)).toBe(1);

  await panel.screenshot({ path: "/tmp/vintrace-photo-agent-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-photo-agent-mobile.png" });
});

test("local AI editor previews before one confirmed apply at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);
  await page.getByRole("button", { name: "Open photo Mountain Sunrise" }).click();
  await page.getByText("Edit photo", { exact: true }).click();

  const panel = page.getByRole("region", { name: "Local AI edits" });
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Upscale" }).click();
  await panel.getByRole("button", { name: "Preview" }).click();
  await expect(panel.getByRole("button", { name: "After" })).toHaveAttribute("class", /active/);
  await expect(panel.getByRole("button", { name: "Apply AI edit" })).toBeVisible();

  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "applyPhotoGenerativeEdit",
  ).length || 0)).toBe(0);
  await panel.getByRole("button", { name: "Apply AI edit" }).click();
  await expect(panel.getByRole("button", { name: "Preview" })).toBeVisible();
  const applyCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "applyPhotoGenerativeEdit",
  ) || []);
  expect(applyCalls).toHaveLength(1);
  expect(applyCalls[0].params.confirm).toBe(true);
  expect(String(applyCalls[0].params.idempotencyKey || "")).toContain("photo-generative:generative-preview-1:");

  await panel.screenshot({ path: "/tmp/vintrace-photo-generative-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-photo-generative-mobile.png" });
});

test("Content Credentials inspection distinguishes local trust from no credential", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);
  await page.getByRole("button", { name: "Open photo Mountain Sunrise" }).click();
  await page.getByText("Info & metadata", { exact: true }).click();

  const inspector = page.locator(".photos-info-inspector");
  await inspector.getByRole("button", { name: "Inspect Content Credentials" }).click();
  await expect(inspector).toContainText("Active edit");
  await expect(inspector).toContainText("Workspace-local trust (not global)");
  await expect(inspector).toContainText("AI edit in this manifest");
  await expect(inspector).toContainText("Original");
  await expect(inspector).toContainText("No Content Credential");

  const calls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "inspectPhotoContentCredentials",
  ) || []);
  expect(calls.map((call) => call.params.scope)).toEqual(["original", "active"]);

  await inspector.screenshot({ path: "/tmp/vintrace-content-credentials-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await inspector.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect.poll(async () => inspector.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const toolbarBox = await page.locator(".photos-lightbox-zoom-controls").boundingBox();
  const panelBox = await page.locator(".photos-lightbox-panel").boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect((panelBox?.y || 0) - ((toolbarBox?.y || 0) + (toolbarBox?.height || 0))).toBeGreaterThanOrEqual(8);
  for (const navigation of await page.locator(".photos-lightbox-nav").all()) {
    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect((inspectorBox?.y || 0) - ((navigationBox?.y || 0) + (navigationBox?.height || 0))).toBeGreaterThanOrEqual(8);
  }
  await page.locator(".photos-lightbox-panel").screenshot({ path: "/tmp/vintrace-content-credentials-mobile.png" });
});

test("photo stories generate only on request, save revisions, and hand off to movie studio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);
  await page.getByRole("button", { name: /Fixture Memory/ }).first().click();

  const panel = page.getByRole("region", { name: "Photo story" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No story draft");
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "generatePhotoStory",
  ).length || 0)).toBe(0);

  await panel.getByRole("button", { name: "Generate draft" }).click();
  const title = panel.getByLabel("Story title");
  await expect(title).toHaveValue("Two Days in the Hills");
  const generateCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "generatePhotoStory",
  ) || []);
  expect(generateCalls).toHaveLength(1);
  expect(generateCalls[0].params.confirm).toBe(true);
  expect(String(generateCalls[0].params.idempotencyKey || "")).toMatch(/^photo-story:/);
  expect(generateCalls[0].params.memoryId).toBe("memory-story-fixture");

  await title.fill("Edited Hills Journal");
  await panel.getByLabel("Chapter narrative 1").fill("A carefully edited local narrative.");
  await panel.getByRole("button", { name: "Save story" }).click();
  await expect(panel).toContainText("Story saved");
  const saveCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "savePhotoStory",
  ) || []);
  expect(saveCalls).toHaveLength(1);
  expect(saveCalls[0].params.expectedRevision).toBe(1);
  expect(saveCalls[0].params.title).toBe("Edited Hills Journal");

  await panel.getByRole("button", { name: "Export story" }).click();
  await expect(panel).toContainText("Story exported");
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "exportPhotoStory",
  ).length || 0)).toBe(1);

  await panel.screenshot({ path: "/tmp/vintrace-photo-story-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-photo-story-mobile.png" });

  await title.fill("Movie-ready Hills Journal");
  await panel.getByRole("button", { name: "Create movie" }).click();
  await expect.poll(async () => page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "createPhotoStorySlideshow",
  ).length || 0)).toBe(1);
  const movieCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "createPhotoStorySlideshow",
  ) || []);
  expect(movieCalls[0].params.storyId).toBe("story-fixture-1");
  const finalSaveCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "savePhotoStory",
  ) || []);
  expect(finalSaveCalls).toHaveLength(2);
  expect(finalSaveCalls[1].params.expectedRevision).toBe(2);
  expect(finalSaveCalls[1].params.title).toBe("Movie-ready Hills Journal");
});

test("assisted burst culling explains recommendations and never applies them silently", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${baseUrl}/tests/fixtures/photos-view-state/index.html`);
  await page.getByRole("button", { name: "Bursts 3" }).click();

  const panel = page.getByRole("region", { name: "Burst stacks" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Review only");
  await expect(panel).toContainText("Sharpness and motion only");
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "analyzePhotoBurstCulling",
  ).length || 0)).toBe(0);

  await panel.getByRole("button", { name: "Analyze burst" }).click();
  await expect(panel).toContainText("Recommended: Burst Frame 2");
  await expect(panel).toContainText("Top overall");
  await expect(panel).toContainText("Motion blur risk");
  await expect(panel).toContainText("Soft focus");
  await expect(panel).toContainText("Face signals require consent");
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "applyPhotoCullingRecommendation",
  ).length || 0)).toBe(0);
  await expect(panel.getByRole("button", { name: /delete/i })).toHaveCount(0);

  await panel.getByRole("button", { name: "Use recommendation" }).click();
  await expect(panel).toContainText("1 keeper");
  const applyCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "applyPhotoCullingRecommendation",
  ) || []);
  expect(applyCalls).toHaveLength(1);
  expect(applyCalls[0].params.confirm).toBe(true);
  expect(applyCalls[0].params.analysisId).toBe("culling-fixture-1");
  expect(applyCalls[0].params.resultSha256).toBe("a".repeat(64));
  expect(String(applyCalls[0].params.idempotencyKey || "")).toMatch(/^photo-culling:culling-fixture-1:/);

  await panel.locator(".photo-burst-frame", { hasText: "Burst Frame 1" }).click();
  const manualCalls = await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "setPhotoBurstSelection",
  ) || []);
  expect(manualCalls).toHaveLength(1);
  expect(manualCalls[0].params.keepSourcePaths).toEqual(["/library/2026/burst-frame-01.jpg"]);
  expect(await page.evaluate(() => window.__photosViewStateHarness?.calls.filter(
    (call) => call.name === "permanentlyDeletePhotos",
  ).length || 0)).toBe(0);

  await panel.screenshot({ path: "/tmp/vintrace-photo-culling-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await expect.poll(async () => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: "/tmp/vintrace-photo-culling-mobile.png" });
});
