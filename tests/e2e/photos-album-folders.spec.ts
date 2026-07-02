import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const MARKUP_TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAYAAABU1PscAAAHOklEQVR42hXPIQsyCQIA0K8cB4a1uEE4LFPkwLBT3CAclinDwoSzuEFYLFOGBcNaXA5hsUyRgwk3xQ3CYZkiB4a1zAZhsUyRA8sUiz/i7hneD3hfvnz5x//+RIcuPfoMCBgyImTMhCkRMQkz5ixYkpKxYs2GLTty9hSUHDhyouLMhSs1N+40PHjS8uLNly9/FqBDlx59BgQMGREyZsKUiJiEGXMWLEnJWLFmw5YdOXsKSg4cOVFx5sKVmht3Gh48aXnx/vMn8JUAHbr06DMgYMiIkDETpkTEJMyYs2BJSsaKNRu27MjZU1By4MiJijMXrtTcuNPw4EnLi/dXn8DXAnTo0qPPgIAhI0LGTJgSEZMwY86CJSkZK9Zs2LIjZ09ByYEjJyrOXLhSc+NOw4MnLS/eX38CfxGgQ5cefQYEDBkRMmbClIiYhBlzFixJyVixZsOWHTl7CkoOHDlRcebClZobdxoePGl58f7LJxAI0KFLjz4DAoaMCBkzYUpETMKMOQuWpGSsWLNhy46cPQUlB46cqDhz4UrNjTsND560vHgHn8BfBejQpUefAQFDRoSMmTAlIiZhxpwFS1IyVqzZsGVHzp6CkgNHTlScuXCl5sadhgdPWl68//oJfCNAhy49+gwIGDIiZMyEKRExCTPmLFiSkrFizYYtO3L2FJQcOHKi4syFKzU37jQ8eNLy4v3NJ/CtAB269OgzIGDIiJAxE6ZExCTMmLNgSUrGijUbtuzI2VNQcuDIiYozF67U3LjT8OBJy4v3t5/A3wTo0KVHnwEBQ0aEjJkwJSImYcacBUtSMlas2bBlR86egpIDR05UnLlwpebGnYYHT1pevP/2CUQCdOjSo8+AgCEjQsZMmBIRkzBjzoIlKRkr1mzYsiNnT0HJgSMnKs5cuFJz407DgyctL97RJ/CdAB269OgzIGDIiJAxE6ZExCTMmLNgSUrGijUbtuzI2VNQcuDIiYozF67U3LjT8OBJy4v3d5/A3wXo0KVHnwEBQ0aEjJkwJSImYcacBUtSMlas2bBlR86egpIDR05UnLlwpebGnYYHT1pevP/+CXwvQIcuPfoMCBgyImTMhCkRMQkz5ixYkpKxYs2GLTty9hSUHDhyouLMhSs1N+40PHjS8uL9/SfwgwAduvToMyBgyIiQMROmRMQkzJizYElKxoo1G7bsyNlTUHLgyImKMxeu1Ny40/DgScuL9w+fQCpAhy49+gwIGDIiZMyEKRExCTPmLFiSkrFizYYtO3L2FJQcOHKi4syFKzU37jQ8eNLy4p1+Aj8K0KFLjz4DAoaMCBkzYUpETMKMOQuWpGSsWLNhy46cPQUlB46cqDhz4UrNjTsND560vHj/+An8JECHLj36DAgYMiJkzIQpETEJM+YsWJKSsWLNhi07cvYUlBw4cqLizIUrNTfuNDx40vLi/dMn8LMAHbr06DMgYMiIkDETpkTEJMyYs2BJSsaKNRu27MjZU1By4MiJijMXrtTcuNPw4EnLi/fPn8AvAnTo0qPPgIAhI0LGTJgSEZMwY86CJSkZK9Zs2LIjZ09ByYEjJyrOXLhSc+NOw4MnLS/ev3wCuQAduvToMyBgyIiQMROmRMQkzJizYElKxoo1G7bsyNlTUHLgyImKMxeu1Ny40/DgScuLd/4J/FOADl169BkQMGREyJgJUyJiEmbMWbAkJWPFmg1bduTsKSg5cORExZkLV2pu3Gl48KTlxfufn8C/BOjQpUefAQFDRoSMmTAlIiZhxpwFS1IyVqzZsGVHzp6CkgNHTlScuXCl5sadhgdPWl68//UJ/CpAhy49+gwIGDIiZMyEKRExCTPmLFiSkrFizYYtO3L2FJQcOHKi4syFKzU37jQ8eNLy4v3rJ/BvATp06dFnQMCQESFjJkyJiEmYMWfBkpSMFWs2bNmRs6eg5MCRExVnLlypuXGn4cGTlhfvf38ClQAduvToMyBgyIiQMROmRMQkzJizYElKxoo1G7bsyNlTUHLgyImKMxeu1Ny40/DgScuLd/UJ/EeADl169BkQMGREyJgJUyJiEmbMWbAkJWPFmg1bduTsKSg5cORExZkLV2pu3Gl48KTlxfs/n8BvAnTo0qPPgIAhI0LGTJgSEZMwY86CJSkZK9Zs2LIjZ09ByYEjJyrOXLhSc+NOw4MnLS/ev30CvwvQoUuPPgMChowIGTNhSkRMwow5C5akZKxYs2HLjpw9BSUHjpyoOHPhSs2NOw0PnrS8eP/+CfwhQIcuPfoMCBgyImTMhCkRMQkz5ixYkpKxYs2GLTty9hSUHDhyouLMhSs1N+40PHjS8uL9xyfQCNChS48+AwKGjAgZM2FKREzCjDkLlqRkrFizYcuOnD0FJQeOnKg4c+FKzY07DQ+etLx4N5/AfwXo0KVHnwEBQ0aEjJkwJSImYcacBUtSMlas2bBlR86egpIDR05UnLlwpebGnYYHT1pevPk/iQVG0zKjAnEAAAAASUVORK5CYII=",
  "base64"
);

type SlideshowTemplateRegion = { x?: number; y?: number; width?: number; height?: number };
type SlideshowTemplateRegionMap = Record<string, SlideshowTemplateRegion>;

async function closeOnboardingIfVisible(page: Page) {
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

async function continueStartupRecoveryIfVisible(page: Page) {
  const recoveryHeading = page.getByRole("heading", { name: "Vintrace startup recovery" });
  if (!(await recoveryHeading.isVisible({ timeout: 1_000 }).catch(() => false))) return;
  await page.getByRole("button", { name: "Continue in safe mode" }).click();
  await expect(recoveryHeading).toBeHidden({ timeout: 15_000 });
}

async function waitForPhotosBackendReady(page: Page) {
  await continueStartupRecoveryIfVisible(page);
  if (await page.getByText("Backend ready.").waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    return;
  }
  await expect.poll(async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      getInitialState?: () => Promise<{ workspace?: string }>;
    } | undefined;
    if (!crossAge?.getInitialState) return false;
    try {
      const state = await crossAge.getInitialState();
      return Boolean(state?.workspace);
    } catch {
      return false;
    }
  }), { timeout: 120_000 }).toBe(true);
  await continueStartupRecoveryIfVisible(page);
  await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible({ timeout: 30_000 });
}

async function dropRailRowInside(page: Page, sourceText: string, targetText: string) {
  const exactName = (value: string) => new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const rail = page.locator(".photos-rail");
  const source = rail.locator(".photo-rail-row").filter({
    has: page.locator(".photos-rail-name", { hasText: exactName(sourceText) })
  });
  const target = rail.locator(".photo-rail-row").filter({
    has: page.locator(".photos-rail-name", { hasText: exactName(targetText) })
  });
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error(`Missing drag target box: ${targetText}`);
  await source.dragTo(target, {
    sourcePosition: { x: 80, y: 15 },
    targetPosition: {
      x: Math.max(24, Math.min(targetBox.width - 8, targetBox.width / 2)),
      y: targetBox.height / 2
    }
  });
}

function writePhotoFixtureSet(folder: string, names: string[]) {
  mkdirSync(folder, { recursive: true });
  for (const name of names) {
    writeFileSync(path.join(folder, name), ONE_PIXEL_PNG);
  }
}

function writeVideoFixtureSet(folder: string, names: string[]) {
  mkdirSync(folder, { recursive: true });
  for (const name of names) {
    writeFileSync(path.join(folder, name), Buffer.from("vintrace mock video fixture\n", "utf8"));
  }
}

function writeFakeFfmpeg(folder: string) {
  mkdirSync(folder, { recursive: true });
  const target = path.join(folder, "fake-ffmpeg");
  writeFileSync(target, [
    "#!/usr/bin/env python3",
    "from pathlib import Path",
    "import sys",
    "target = Path(sys.argv[-1])",
    "target.parent.mkdir(parents=True, exist_ok=True)",
    "target.write_bytes(b'fake browser transcoded video')",
    "",
  ].join("\n"), "utf8");
  chmodSync(target, 0o755);
  return target;
}

function runPythonSeed(projectRoot: string, env: Record<string, string>, script: string, args: string[]) {
  const candidates = [
    env.PYTHON || "",
    path.join(projectRoot, ".venv", "bin", "python"),
    "python3",
    "python"
  ].filter(Boolean);
  const tried = new Set<string>();
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["-c", script, ...args], {
      cwd: projectRoot,
      env,
      encoding: "utf8"
    });
    if (result.status === 0) return;
    errors.push(`${candidate}: ${(result.stderr || result.stdout || "failed").trim()}`);
  }
  throw new Error(`Could not seed workspace with Python. ${errors.join(" | ")}`);
}

function e2eBudgetMs(name: string, fallbackMs: number) {
  const parsed = Number(process.env[`VINTRACE_E2E_${name.toUpperCase()}_MS`]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

type RealVideoFixtureResult = {
  ok: boolean;
  ffmpegPath?: string;
  detail?: string;
};

function writeRealVideoFixture(folder: string, name: string): RealVideoFixtureResult {
  mkdirSync(folder, { recursive: true });
  const target = path.join(folder, name);
  const script = String.raw`
import json
import shutil
import subprocess
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)

def finish(payload):
    print(json.dumps(payload))
    sys.exit(0 if payload.get("ok") else 1)

ffmpeg = shutil.which("ffmpeg") or ""
if not ffmpeg:
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ffmpeg = ""

def write_with_opencv():
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        return f"opencv import failed: {exc}"
    last_error = "opencv writer unavailable"
    for codec in ("mp4v", "avc1", "MJPG", "XVID"):
        writer = None
        try:
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), 6.0, (64, 64))
            if not writer.isOpened():
                writer.release()
                continue
            for index in range(10):
                frame = np.zeros((64, 64, 3), dtype=np.uint8)
                frame[:, :, 0] = 30 + index * 14
                frame[:, :, 1] = 110
                frame[:, :, 2] = 220 - index * 10
                cv2.putText(frame, str(index), (18, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                writer.write(frame)
            writer.release()
            if path.exists() and path.stat().st_size > 0:
                return ""
        except Exception as exc:
            last_error = str(exc)
            if writer is not None:
                try:
                    writer.release()
                except Exception:
                    pass
    return last_error

opencv_error = write_with_opencv()
if not opencv_error:
    finish({"ok": True, "backend": "opencv", "ffmpegPath": ffmpeg})

if ffmpeg:
    completed = subprocess.run([
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x64:rate=6",
        "-t",
        "1.5",
        "-pix_fmt",
        "yuv420p",
        "-y",
        str(path),
    ], capture_output=True, text=True, timeout=30, check=False)
    if completed.returncode == 0 and path.exists() and path.stat().st_size > 0:
        finish({"ok": True, "backend": "ffmpeg", "ffmpegPath": ffmpeg})
    finish({"ok": False, "detail": (completed.stderr or completed.stdout or opencv_error or "ffmpeg writer failed")[:400], "ffmpegPath": ffmpeg})

finish({"ok": False, "detail": opencv_error or "no video fixture writer available"})
`;
  const candidates = [
    process.env.PYTHON || "",
    path.join(process.cwd(), ".venv", "bin", "python"),
    "python3",
    "python"
  ].filter(Boolean);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["-c", script, target], { encoding: "utf8" });
    const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
    let parsed: RealVideoFixtureResult | null = null;
    if (line) {
      try {
        parsed = JSON.parse(line) as RealVideoFixtureResult;
      } catch {
        parsed = null;
      }
    }
    if (parsed?.ok && existsSync(target)) return parsed;
    if (parsed?.detail) return parsed;
  }
  return { ok: false, detail: "No usable Python runtime was found for generating a tiny video fixture." };
}

async function installMockVideoElementState(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    if (win.__vintraceVideoMockInstalled) return;
    win.__vintraceVideoMockInstalled = true;
    const state = new WeakMap<HTMLMediaElement, { currentTime: number; duration: number; muted: boolean; paused: boolean }>();
    const ensure = (video: HTMLMediaElement) => {
      let current = state.get(video);
      if (!current) {
        current = { currentTime: 0, duration: 4, muted: false, paused: true };
        state.set(video, current);
      }
      return current;
    };
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() {
        return ensure(this as HTMLMediaElement).duration;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() {
        return ensure(this as HTMLMediaElement).currentTime;
      },
      set(value: number) {
        ensure(this as HTMLMediaElement).currentTime = Math.max(0, Number(value) || 0);
        this.dispatchEvent(new Event("timeupdate"));
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return ensure(this as HTMLMediaElement).paused;
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "muted", {
      configurable: true,
      get() {
        return ensure(this as HTMLMediaElement).muted;
      },
      set(value: boolean) {
        ensure(this as HTMLMediaElement).muted = Boolean(value);
        this.dispatchEvent(new Event("volumechange"));
      }
    });
    HTMLMediaElement.prototype.play = function play() {
      ensure(this).paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      ensure(this).paused = true;
      this.dispatchEvent(new Event("pause"));
    };
  });
}

function tileByFilename(page: Page, filename: string) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.locator(".photo-tile-wrap").filter({
    has: page.getByRole("button", { name: new RegExp(`^\\s*Open photo\\s+${escaped}\\s*$`) })
  });
}

function cssAttributeString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function macPathVariants(value: string) {
  const variants = new Set([value]);
  if (value.startsWith("/private/var/")) variants.add(value.replace(/^\/private/, ""));
  if (value.startsWith("/var/")) variants.add(`/private${value}`);
  return Array.from(variants);
}

function rootProfileRowByPath(panel: Locator, rootPath: string) {
  return panel.locator(macPathVariants(rootPath).map((variant) => (
    `.photo-managed-root-profile-row:has(small[title="${cssAttributeString(variant)}"])`
  )).join(", "));
}

async function setSmartQueryRule(rule: Locator, field: string, operator: string, value: string | number | boolean) {
  await rule.getByLabel("Rule field").selectOption(field);
  await rule.getByLabel("Rule operator").selectOption(operator);
  const valueControl = rule.getByLabel("Rule value");
  if (typeof value === "boolean") {
    await valueControl.selectOption(value ? "true" : "false");
    return;
  }
  await valueControl.fill(String(value));
}

async function addSmartQueryRule(builder: Locator, field: string, operator: string, value: string | number | boolean) {
  await builder.getByRole("button", { name: "Add rule" }).first().click();
  const rule = builder.locator(".photo-smart-query-rule").last();
  await setSmartQueryRule(rule, field, operator, value);
  return rule;
}

async function dragPhotoTile(page: Page, sourceFilename: string, targetFilename: string, placement: "before" | "after") {
  const source = tileByFilename(page, sourceFilename);
  const target = tileByFilename(page, targetFilename);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox) throw new Error(`Missing tile drag source box: ${sourceFilename}`);
  if (!targetBox) throw new Error(`Missing tile drag target box: ${targetFilename}`);
  await source.dragTo(target, {
    sourcePosition: {
      x: Math.max(16, Math.min(sourceBox.width - 8, sourceBox.width / 2)),
      y: Math.max(16, Math.min(sourceBox.height - 8, sourceBox.height / 2))
    },
    targetPosition: {
      x: placement === "before" ? Math.max(2, Math.min(8, targetBox.width / 4)) : Math.max(12, targetBox.width - 8),
      y: Math.max(12, Math.min(targetBox.height - 8, targetBox.height / 2))
    }
  });
}

async function manualAlbumFilenames(page: Page, albumId: string, limit = 20) {
  return page.evaluate(async ({ albumId: currentAlbumId, limit: pageLimit }) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const page = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
      folderId: `album:${currentAlbumId}`,
      sort: "manual",
      previewBudget: 0,
      limit: pageLimit
    });
    return page.items.map((item) => String(item.sourcePath || "").split(/[\\/]/).filter(Boolean).pop() || "");
  }, { albumId, limit });
}

async function visiblePhotoTileFilenames(page: Page) {
  return page.locator(".photo-tile-wrap").evaluateAll((tiles) => (
    tiles
      .map((tile) => tile.querySelector<HTMLButtonElement>(".photo-tile")?.getAttribute("title") || "")
      .filter(Boolean)
  ));
}

async function dragSlideshowTimelineCard(page: Page, sourceFilename: string, targetFilename: string, placement: "before" | "after") {
  const timeline = page.getByLabel("Slideshow projects").getByRole("list", { name: "Slideshow timeline" });
  const source = timeline.getByRole("listitem").filter({ hasText: sourceFilename });
  const target = timeline.getByRole("listitem").filter({ hasText: targetFilename });
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox) throw new Error(`Missing slideshow timeline source box: ${sourceFilename}`);
  if (!targetBox) throw new Error(`Missing slideshow timeline target box: ${targetFilename}`);
  await source.dragTo(target, {
    sourcePosition: {
      x: Math.max(16, Math.min(sourceBox.width - 8, sourceBox.width / 2)),
      y: Math.max(12, Math.min(sourceBox.height - 8, sourceBox.height / 2))
    },
    targetPosition: {
      x: placement === "before" ? Math.max(2, Math.min(8, targetBox.width / 4)) : Math.max(12, targetBox.width - 8),
      y: Math.max(12, Math.min(targetBox.height - 8, targetBox.height / 2))
    }
  });
}

async function setSlideshowPathAnchor(page: Page, label: string, xPercent: number, yPercent: number) {
  const editor = page.getByLabel("Slideshow projects").getByLabel("Slideshow path editor", { exact: true });
  const canvas = editor.getByLabel("Slideshow path canvas", { exact: true });
  const anchor = editor.getByLabel(`Move ${label} path anchor`);
  await expect(canvas).toBeVisible();
  await expect(anchor).toBeVisible();
  await anchor.focus();
  const current = await anchor.evaluate((node) => {
    const circle = node as SVGCircleElement;
    return {
      x: Number(circle.getAttribute("cx") || 50),
      y: Number(circle.getAttribute("cy") || 50),
    };
  });
  async function pressDelta(delta: number, negativeKey: string, positiveKey: string) {
    const key = delta < 0 ? negativeKey : positiveKey;
    let remaining = Math.abs(delta);
    while (remaining >= 5) {
      await page.keyboard.press(`Shift+${key}`);
      remaining -= 5;
    }
    while (remaining > 0) {
      await page.keyboard.press(key);
      remaining -= 1;
    }
  }
  await pressDelta(Math.round(xPercent - current.x), "ArrowLeft", "ArrowRight");
  await pressDelta(Math.round(yPercent - current.y), "ArrowUp", "ArrowDown");
  await expect(anchor).toHaveAttribute("cx", String(xPercent));
  await expect(anchor).toHaveAttribute("cy", String(yPercent));
}

async function setSlideshowBezierHandle(page: Page, label: string, xPercent: number, yPercent: number) {
  const editor = page.getByLabel("Slideshow projects").getByLabel("Slideshow path editor", { exact: true });
  const canvas = editor.getByLabel("Slideshow path canvas", { exact: true });
  const handle = editor.getByLabel(`Move ${label} path handle`);
  await expect(canvas).toBeVisible();
  await expect(handle).toBeVisible();
  await handle.focus();
  const current = await handle.evaluate((node) => {
    const circle = node as SVGCircleElement;
    return {
      x: Number(circle.getAttribute("cx") || 50),
      y: Number(circle.getAttribute("cy") || 50),
    };
  });
  async function pressDelta(delta: number, negativeKey: string, positiveKey: string) {
    const key = delta < 0 ? negativeKey : positiveKey;
    let remaining = Math.abs(delta);
    while (remaining >= 5) {
      await page.keyboard.press(`Shift+${key}`);
      remaining -= 5;
    }
    while (remaining > 0) {
      await page.keyboard.press(key);
      remaining -= 1;
    }
  }
  await pressDelta(Math.round(xPercent - current.x), "ArrowLeft", "ArrowRight");
  await pressDelta(Math.round(yPercent - current.y), "ArrowUp", "ArrowDown");
  await expect(handle).toHaveAttribute("cx", String(xPercent));
  await expect(handle).toHaveAttribute("cy", String(yPercent));
}

async function setSlideshowCaptionRegion(page: Page, xPercent: number, yPercent: number, widthPercent: number, heightPercent: number) {
  const editor = page.getByLabel("Slideshow projects").getByLabel("Caption region editor", { exact: true });
  const canvas = editor.getByLabel("Caption region canvas", { exact: true });
  const box = editor.getByLabel("Move caption region");
  const handle = editor.getByLabel("Resize caption region southeast");
  await expect(canvas).toBeVisible();
  await expect(box).toBeVisible();
  await expect(handle).toBeVisible();

  async function pressDelta(delta: number, negativeKey: string, positiveKey: string) {
    const key = delta < 0 ? negativeKey : positiveKey;
    let remaining = Math.abs(delta);
    while (remaining >= 5) {
      await page.keyboard.press(`Shift+${key}`);
      remaining -= 5;
    }
    while (remaining > 0) {
      await page.keyboard.press(key);
      remaining -= 1;
    }
  }

  await box.focus();
  const currentPosition = await box.evaluate((node) => {
    const rect = node as SVGRectElement;
    return {
      x: Number(rect.getAttribute("x") || 0),
      y: Number(rect.getAttribute("y") || 0),
    };
  });
  await pressDelta(Math.round(xPercent - currentPosition.x), "ArrowLeft", "ArrowRight");
  await pressDelta(Math.round(yPercent - currentPosition.y), "ArrowUp", "ArrowDown");
  await expect(box).toHaveAttribute("x", String(xPercent));
  await expect(box).toHaveAttribute("y", String(yPercent));

  await handle.focus();
  const currentSize = await box.evaluate((node) => {
    const rect = node as SVGRectElement;
    return {
      width: Number(rect.getAttribute("width") || 1),
      height: Number(rect.getAttribute("height") || 1),
    };
  });
  await pressDelta(Math.round(widthPercent - currentSize.width), "ArrowLeft", "ArrowRight");
  await pressDelta(Math.round(heightPercent - currentSize.height), "ArrowUp", "ArrowDown");
  await expect(box).toHaveAttribute("width", String(widthPercent));
  await expect(box).toHaveAttribute("height", String(heightPercent));
}

async function photoWorkspaceScrollState(page: Page) {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>(".workspace");
    return {
      scrollTop: workspace?.scrollTop || 0,
      scrollHeight: workspace?.scrollHeight || 0,
      clientHeight: workspace?.clientHeight || 0,
    };
  });
}

async function photoDateOverridesByTitle(page: Page, titles: string[]) {
  return page.evaluate(async (targetTitles) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ items: Array<{ title?: string; dateOverride?: string }> }>("list_photo_folder_items", {
      folderId: "all",
      previewBudget: 0,
      limit: 100
    });
    const wanted = new Set(targetTitles);
    return Object.fromEntries(
      result.items
        .filter((item) => wanted.has(String(item.title || "")))
        .map((item) => [String(item.title || ""), String(item.dateOverride || "")])
    );
  }, titles);
}

function savedFilterRow(page: Page, name: string) {
  return page.locator(".photo-rail-row.saved-filter").filter({
    has: page.locator(".photos-rail-name", { hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) })
  });
}

async function savedFilterNames(page: Page) {
  return page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ value: { filters: Array<{ name: string; pinned?: boolean; position?: number; count?: number; previewSamples?: string[] }> } }>("list_photo_saved_filters", {});
    return result.value.filters.map((filter) => ({
      name: String(filter.name || ""),
      pinned: Boolean(filter.pinned),
      position: Number(filter.position || 0),
      count: Number(filter.count || 0),
      previewSamples: filter.previewSamples || []
    }));
  });
}

async function photoFolderCounts(page: Page) {
  return page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
    return Object.fromEntries(result.folders.map((folder) => [folder.id, Number(folder.count || 0)]));
  });
}

async function photoAlbumByName(page: Page, name: string) {
  return page.evaluate(async (albumName) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ folders: Array<{ id: string; name: string; count: number; albumId?: string; albumKind?: string; description?: string; coverSourcePath?: string; rules?: Record<string, unknown> }> }>("list_photo_folders", {});
    return result.folders.find((folder) => folder.name === albumName) || null;
  }, name);
}

async function photoFolderById(page: Page, folderId: string) {
  return page.evaluate(async (targetFolderId) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{
      folders: Array<{
        id: string;
        kind?: string;
        name?: string;
        count?: number;
        coverSourcePath?: string;
        coverCrop?: { left?: number; top?: number; width?: number; height?: number };
        utilityProfile?: { keyAssetId?: string };
      }>;
    }>("list_photo_folders", {});
    return result.folders.find((folder) => folder.id === targetFolderId) || null;
  }, folderId);
}

async function photoMemoryByName(page: Page, name: string) {
  return page.evaluate(async (memoryName) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{
      folders: Array<{ id: string; kind?: string; name?: string; count?: number; memoryId?: string; memory?: { memoryId?: string; category?: string; sourcePaths?: string[] } }>;
    }>("list_photo_folders", {});
    return result.folders.find((folder) => folder.kind === "memory" && folder.name === memoryName) || null;
  }, name);
}

async function photoUserMemoryByName(page: Page, name: string) {
  return page.evaluate(async (memoryName) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ value: { memories?: Array<{ memoryId?: string; name?: string; subtitle?: string; sourcePaths?: string[]; movieSettings?: Record<string, any> }> } }>("photo_user_memories", {});
    return (result.value.memories || []).find((memory) => memory.name === memoryName) || null;
  }, name);
}

async function photoPlaceByName(page: Page, name: string) {
  return page.evaluate(async (placeName) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{
      folders: Array<{
        id: string;
        kind?: string;
        name?: string;
        count?: number;
        coverSourcePath?: string;
        placeId?: string;
        placeProfile?: { keyAssetId?: string };
        place?: { coverAssetId?: string; coverSourcePath?: string; placeProfile?: { keyAssetId?: string } };
      }>;
    }>("list_photo_folders", {});
    return result.folders.find((folder) => folder.kind === "place" && folder.name === placeName) || null;
  }, name);
}

test("Photos album folders support drag/drop moves in the rail", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-folders-"));
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
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");
  await closeOnboardingIfVisible(page);

  const seeded = await page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const parent = await crossAge.invoke<{ value: { folderId: string } }>("save_photo_album_folder", { name: "Trips E2E" });
    const child = await crossAge.invoke<{ value: { folderId: string } }>("save_photo_album_folder", { name: "Loose Folder E2E" });
    const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
      name: "Loose Album E2E",
      albumKind: "manual"
    });
    return {
      parentFolderId: parent.value.folderId,
      childFolderId: child.value.folderId,
      albumId: album.value.albumId
    };
  });

  await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
  const rail = page.locator(".photos-rail");
  await expect(rail.getByText("Trips E2E", { exact: true })).toBeVisible();
  await expect(rail.getByText("Loose Folder E2E", { exact: true })).toBeVisible();
  await expect(rail.getByText("Loose Album E2E", { exact: true })).toBeVisible();

  const tripsRow = rail.locator(".photo-rail-row").filter({ hasText: "Trips E2E" });
  await dropRailRowInside(page, "Loose Album E2E", "Trips E2E");
  await expect.poll(async () => page.evaluate(async ({ albumId, parentFolderId }) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const folders = await crossAge.invoke<{ folders: Array<{ albumId?: string; folderId?: string }> }>("list_photo_folders", {});
    return folders.folders.find((folder) => folder.albumId === albumId)?.folderId === parentFolderId;
  }, seeded)).toBe(true);
  await expect(rail.locator(".photo-rail-row-main.nested").filter({ hasText: "Loose Album E2E" })).toBeVisible();

  await dropRailRowInside(page, "Loose Folder E2E", "Trips E2E");
  await expect.poll(async () => page.evaluate(async ({ childFolderId, parentFolderId }) => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const folders = await crossAge.invoke<{ folders: Array<{ kind: string; folderId?: string; parentFolderId?: string }> }>("list_photo_folders", {});
    return folders.folders.find((folder) => folder.kind === "albumFolder" && folder.folderId === childFolderId)?.parentFolderId === parentFolderId;
  }, seeded)).toBe(true);

  await expect(tripsRow.getByRole("button", { name: /Collapse folder Trips E2E|Expand folder Trips E2E/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await app.close();
});

test("Photos settings manage managed-root profile history", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-root-profiles-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const alphaRoot = path.join(temp, "alpha-managed-library");
  const betaRoot = path.join(temp, "beta-managed-library");
  const relinkOldRoot = path.join(temp, "relink-old-library");
  const relinkNewRoot = path.join(temp, "relink-new-library");
  const relinkOldTrip = path.join(relinkOldRoot, "trip");
  const relinkNewTrip = path.join(relinkNewRoot, "trip");
  const viewRoot = path.join(temp, "referenced-view-library");
  const viewChildRoot = path.join(viewRoot, "nested-view-library");
  const policyImportRoot = path.join(temp, "policy-import-source");
  const policyImportNested = path.join(policyImportRoot, "Events", "Policy Day");
  const consolidateSourceRoot = path.join(temp, "consolidate-source");
  mkdirSync(alphaRoot, { recursive: true });
  mkdirSync(betaRoot, { recursive: true });
  mkdirSync(viewChildRoot, { recursive: true });
  writePhotoFixtureSet(relinkOldTrip, ["browser-relink.png"]);
  writePhotoFixtureSet(viewRoot, ["view-root.png"]);
  writePhotoFixtureSet(policyImportNested, ["policy-default.png"]);
  writePhotoFixtureSet(consolidateSourceRoot, ["browser-consolidate.png"]);
  mkdirSync(relinkNewTrip, { recursive: true });
  const alphaRootResolved = realpathSync(alphaRoot);
  const betaRootResolved = realpathSync(betaRoot);
  const viewRootResolved = realpathSync(viewRoot);
  const viewChildRootResolved = realpathSync(viewChildRoot);
  const relinkNewTripResolved = realpathSync(relinkNewTrip);
  const relinkOriginalPath = realpathSync(path.join(relinkOldTrip, "browser-relink.png"));
  const relinkMovedPath = path.join(relinkNewTrip, "browser-relink.png");
  const viewRootPhotoPath = realpathSync(path.join(viewRoot, "view-root.png"));
  const consolidateSourcePath = realpathSync(path.join(consolidateSourceRoot, "browser-consolidate.png"));
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    CROSSAGE_TEST_DIALOG_PATHS: relinkNewTripResolved
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ alphaRoot: firstRoot, betaRoot: secondRoot, viewRoot: thirdRoot, viewChildRoot: fourthRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("save_photo_library_settings", {
        defaultManagedRoot: firstRoot,
        defaultStorageMode: "managed",
        profileName: "Root Alpha E2E"
      });
      await crossAge.invoke("save_photo_library_settings", {
        defaultManagedRoot: secondRoot,
        defaultStorageMode: "managed",
        profileName: "Root Beta E2E"
      });
      await crossAge.invoke("save_photo_library_settings", {
        libraryRootProfile: {
          path: thirdRoot,
          name: "Referenced View E2E"
        }
      });
      await crossAge.invoke("save_photo_library_settings", {
        libraryRootProfile: {
          path: fourthRoot,
          name: "Referenced Child View E2E"
        }
      });
    }, { alphaRoot: alphaRootResolved, betaRoot: betaRootResolved, viewRoot: viewRootResolved, viewChildRoot: viewChildRootResolved });
    await page.evaluate(async ({ sourcePath, viewPath, consolidatePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [sourcePath],
        storageMode: "referenced",
        sourceLabel: "Relink history E2E"
      });
      await crossAge.invoke("import_photos", {
        sourcePaths: [viewPath],
        storageMode: "referenced",
        sourceLabel: "Referenced view E2E"
      });
      await crossAge.invoke("import_photos", {
        sourcePaths: [consolidatePath],
        storageMode: "referenced",
        sourceLabel: "Consolidation history E2E"
      });
    }, { sourcePath: relinkOriginalPath, viewPath: viewRootPhotoPath, consolidatePath: consolidateSourcePath });
    renameSync(relinkOriginalPath, relinkMovedPath);
    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        detectMissingOriginals: true
      });
    });

    const photosNavButton = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Library" });
    await photosNavButton.scrollIntoViewIfNeeded();
    await photosNavButton.click();
    const rail = page.locator(".photos-rail");
    await rail.getByRole("button", { name: "Settings" }).click();
    const settingsPanel = page.locator("#photos-local-settings");
    await expect(settingsPanel.getByText("Managed library roots", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Root Alpha E2E", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Root Beta E2E", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Workspace managed library", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Library view roots", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Referenced View E2E", { exact: true })).toBeVisible();
    await expect(settingsPanel.getByText("Referenced Child View E2E", { exact: true })).toBeVisible();
    const managedRootsPanel = settingsPanel.getByLabel("Managed library roots", { exact: true });
    const libraryViewRootsPanel = settingsPanel.getByLabel("Library view roots", { exact: true });
    const viewScopeSelect = page.getByLabel("Library view scope");
    await expect(viewScopeSelect).toContainText("Referenced View E2E");
    const referencedViewRow = rootProfileRowByPath(libraryViewRootsPanel, viewRootResolved);
    const referencedChildViewRow = rootProfileRowByPath(libraryViewRootsPanel, viewChildRootResolved);
    await expect(referencedViewRow).toContainText("1 photo");
    await expect(referencedViewRow.locator(".photo-managed-root-profile-badges")).toContainText("Overlapping root");
    await expect(referencedViewRow.locator(".photo-managed-root-profile-details")).toContainText("scoped counts and repairs can overlap");
    await expect(referencedChildViewRow.locator(".photo-managed-root-profile-badges")).toContainText("Overlapping root");
    await expect(referencedChildViewRow.locator(".photo-managed-root-profile-details")).toContainText("scoped counts and repairs can overlap");
    await referencedViewRow.locator(".photo-managed-root-profile-rename input").fill("Referenced View Display E2E");
    const enabledViewRenameButton = libraryViewRootsPanel.locator("button[aria-label^='Rename library view root']:not(:disabled)");
    await expect(enabledViewRenameButton).toHaveCount(1, { timeout: 20_000 });
    await enabledViewRenameButton.click();
    await expect(settingsPanel.getByText("Referenced View Display E2E", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ viewRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { libraryRoots?: Array<{ path: string; name: string }> } }>("photo_library_settings", {});
      return result.value.libraryRoots?.find((root) => root.path === expectedRoot)?.name;
    }, { viewRoot: viewRootResolved }), { timeout: 20_000 }).toBe("Referenced View Display E2E");
    const viewScopeOptionValue = await viewScopeSelect.evaluate((select) => {
      const element = select as HTMLSelectElement;
      return Array.from(element.options).find((option) => option.textContent?.includes("Referenced View Display E2E"))?.value || "";
    });
    expect(viewScopeOptionValue).toBeTruthy();
    await viewScopeSelect.selectOption(viewScopeOptionValue);
    await expect.poll(async () => page.evaluate(async ({ viewRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string; activeLibraryRootProfileId?: string; defaultManagedRoot: string } }>("photo_library_settings", {});
      return result.value.activeLibraryRoot === expectedRoot && result.value.activeLibraryRootProfileId ? result.value.defaultManagedRoot : "";
    }, { viewRoot: viewRootResolved }), { timeout: 20_000 }).toBe(betaRootResolved);
    await rail.getByRole("button", { name: /^All Photos\b/ }).first().click();
    await expect(tileByFilename(page, "view-root.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "browser-consolidate.png")).toHaveCount(0);
    await settingsPanel.getByRole("button", { name: /Forget library view root Referenced View Display E2E/ }).click();
    await expect(settingsPanel.getByText("Referenced View Display E2E", { exact: true })).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ viewRoot: removedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string; libraryRoots?: Array<{ path: string }> } }>("photo_library_settings", {});
      return !result.value.activeLibraryRoot && !result.value.libraryRoots?.some((root) => root.path === removedRoot);
    }, { viewRoot: viewRootResolved }), { timeout: 20_000 }).toBe(true);
    const betaRow = rootProfileRowByPath(managedRootsPanel, betaRootResolved);
    await betaRow.locator(".photo-managed-root-profile-rename input").fill("Root Beta Display E2E");
    const enabledManagedRenameButton = managedRootsPanel.locator("button[aria-label^='Rename managed root profile']:not(:disabled)");
    await expect(enabledManagedRenameButton).toHaveCount(1, { timeout: 20_000 });
    await enabledManagedRenameButton.click();
    await expect(settingsPanel.getByText("Root Beta Display E2E", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ betaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { managedRoots: Array<{ path: string; name: string }> } }>("photo_library_settings", {});
      return result.value.managedRoots.find((root) => root.path === expectedRoot)?.name;
    }, { betaRoot: betaRootResolved }), { timeout: 20_000 }).toBe("Root Beta Display E2E");

    await settingsPanel.getByRole("button", { name: /Use managed root profile Root Alpha E2E/ }).click();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { defaultManagedRoot: string; defaultManagedRootPersisted?: boolean } }>("photo_library_settings", {});
      return result.value.defaultManagedRootPersisted === true && result.value.defaultManagedRoot === expectedRoot;
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
    const alphaRow = rootProfileRowByPath(managedRootsPanel, alphaRootResolved);
    const keepFoldersPolicyToggle = alphaRow.getByRole("checkbox", { name: /Keep folders Root Alpha E2E/ });
    await expect(keepFoldersPolicyToggle).toBeEnabled({ timeout: 20_000 });
    await keepFoldersPolicyToggle.click();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        value: { managedRoots: Array<{ path: string; policy?: { keepFolderOrganizationDefault?: boolean } }> };
      }>("photo_library_settings", {});
      const root = result.value.managedRoots.find((entry) => entry.path === expectedRoot);
      return Boolean(root?.policy?.keepFolderOrganizationDefault);
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
    const externalBackupPolicyToggle = alphaRow.getByRole("checkbox", { name: /External backup Root Alpha E2E/ });
    await expect(externalBackupPolicyToggle).toBeEnabled({ timeout: 20_000 });
    await externalBackupPolicyToggle.click();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        value: {
          managedRoots: Array<{ path: string; policy?: { keepFolderOrganizationDefault?: boolean; externalBackupCovered?: boolean } }>;
          backupPolicyStatus?: { rootCoverage?: Array<{ path: string; externalBackupCovered?: boolean }> };
        };
      }>("photo_library_settings", {});
      const root = result.value.managedRoots.find((entry) => entry.path === expectedRoot);
      const coverage = result.value.backupPolicyStatus?.rootCoverage?.find((entry) => entry.path === expectedRoot);
      return Boolean(root?.policy?.keepFolderOrganizationDefault && root?.policy?.externalBackupCovered && coverage?.externalBackupCovered);
	    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
	    await alphaRow.getByRole("button", { name: /Show managed root health Root Alpha E2E/ }).click();
	    const alphaHealth = alphaRow.locator(".photo-managed-root-health-panel");
	    await expect(alphaHealth).toBeVisible({ timeout: 20_000 });
	    await alphaHealth.getByRole("button", { name: /Check managed root Root Alpha E2E/ }).click();
	    await expect(alphaHealth).toContainText("Checked Root Alpha E2E", { timeout: 20_000 });
	    await alphaHealth.getByRole("button", { name: /Preview managed root orphans Root Alpha E2E/ }).click();
	    await expect(alphaHealth).toContainText("Orphan preview Root Alpha E2E", { timeout: 20_000 });
	    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
	      const crossAge = (window as any).crossAge as {
	        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
	      };
	      const result = await crossAge.invoke<{
	        value: { events: Array<{ action: string; details?: { libraryRootPath?: string } }> };
	      }>("photo_repair_history", { limit: 8 });
	      return result.value.events.some((event) => (
	        event.action === "photo_library_backup_check" && event.details?.libraryRootPath === expectedRoot
	      ));
	    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
	    await alphaRow.getByRole("button", { name: /View only managed root profile Root Alpha E2E/ }).click();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string } }>("photo_library_settings", {});
      return result.value.activeLibraryRoot || "";
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(alphaRootResolved);
    const libraryMediaDefaults = settingsPanel.getByLabel("Library media defaults");
    await expect(libraryMediaDefaults).toBeVisible({ timeout: 20_000 });
    await expect(libraryMediaDefaults).toContainText("Global · Root Alpha E2E");
    await libraryMediaDefaults.getByLabel("Video autoplay").selectOption("muted");
    await libraryMediaDefaults.getByLabel("HDR viewing").selectOption("hdr");
    await libraryMediaDefaults.getByLabel("Pause when backgrounded").uncheck();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        value: {
          localSettings?: {
            mediaSettingsByLibraryRoot?: Record<string, {
              videoAutoplay?: string;
              pauseVideoWhenBackgrounded?: boolean;
              hdrViewing?: string;
            }>;
          };
        };
      }>("photo_library_settings", {});
      const override = result.value.localSettings?.mediaSettingsByLibraryRoot?.[expectedRoot];
      return override?.videoAutoplay === "muted"
        && override.pauseVideoWhenBackgrounded === false
        && override.hdrViewing === "hdr";
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
    await expect(libraryMediaDefaults).toContainText("Custom · Root Alpha E2E");
    await libraryMediaDefaults.getByRole("button", { name: "Reset media defaults" }).click();
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { localSettings?: { mediaSettingsByLibraryRoot?: Record<string, unknown> } } }>("photo_library_settings", {});
      return !result.value.localSettings?.mediaSettingsByLibraryRoot?.[expectedRoot];
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);
    await expect(libraryMediaDefaults).toContainText("Global · Root Alpha E2E");
    await page.locator(".photo-import-controls[aria-label='Library view']").getByRole("button", { name: "All libraries" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string } }>("photo_library_settings", {});
      return result.value.activeLibraryRoot || "";
    }), { timeout: 20_000 }).toBe("");
    const policyImport = await page.evaluate(async ({ sourceRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        value: { importId: string; keepFolderOrganization?: boolean; importedPaths: string[] };
      }>("import_photos", {
        sourcePaths: [sourceRoot],
        storageMode: "managed",
        sourceLabel: "Root policy E2E"
      });
      return result.value;
    }, { sourceRoot: policyImportRoot });
    expect(policyImport.keepFolderOrganization).toBe(true);
    expect(path.dirname(policyImport.importedPaths[0])).toBe(path.join(alphaRootResolved, policyImport.importId, "Events", "Policy Day"));
    await expect.poll(async () => page.evaluate(async ({ alphaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        value: { backupPolicyStatus?: { counts?: Record<string, number>; rootCoverage?: Array<{ path: string; requiresExternalBackup?: boolean; externalBackupCovered?: boolean }> } };
      }>("photo_library_settings", {});
      const status = result.value.backupPolicyStatus;
      const coverage = status?.rootCoverage?.find((entry) => entry.path === expectedRoot);
      return status?.counts?.externalManagedAssets === 1
        && status?.counts?.externalManagedAssetsCovered === 1
        && status?.counts?.externalManagedAssetsRequiringBackup === 0
        && coverage?.requiresExternalBackup === false
        && coverage?.externalBackupCovered === true;
    }, { alphaRoot: alphaRootResolved }), { timeout: 20_000 }).toBe(true);

    await rail.getByRole("button", { name: /^All Photos\b/ }).first().click();
    await expect(tileByFilename(page, "browser-consolidate.png")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "browser-consolidate.png").locator(".photo-select-box").click();
    const bulkBar = page.locator(".photo-bulk-bar");
    await expect(bulkBar).toContainText("1 selected");
    await bulkBar.getByRole("button", { name: "Consolidate" }).click();
    const consolidateConfirm = page.getByRole("dialog", { name: "Consolidate originals" });
    await expect(consolidateConfirm).toBeVisible({ timeout: 20_000 });
    await consolidateConfirm.getByRole("button", { name: "Consolidate" }).click();
    const consolidationHistory = page.getByLabel("Recent consolidations");
    await expect(consolidationHistory).toContainText("Consolidate originals", { timeout: 20_000 });
    await expect(consolidationHistory).toContainText("Copied: 1");
    await expect(consolidationHistory).toContainText("Undo available");
    await expect(consolidationHistory).toContainText("browser-consolidate.png");
    if (!await settingsPanel.isVisible()) {
      await rail.getByRole("button", { name: "Settings" }).click();
    }

    const betaDisplayRow = rootProfileRowByPath(managedRootsPanel, betaRootResolved);
    await betaDisplayRow.getByRole("button", { name: /View only managed root profile Root Beta Display E2E/ }).click();
    await expect.poll(async () => page.evaluate(async ({ betaRoot: expectedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string } }>("photo_library_settings", {});
      return result.value.activeLibraryRoot || "";
    }, { betaRoot: betaRootResolved }), { timeout: 20_000 }).toBe(betaRootResolved);
    await settingsPanel.getByRole("button", { name: /Forget managed root profile Root Beta Display E2E/ }).click();
    await expect(settingsPanel.getByText("Root Beta Display E2E", { exact: true })).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ betaRoot: removedRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { activeLibraryRoot?: string; managedRoots: Array<{ path: string }> } }>("photo_library_settings", {});
      return !result.value.managedRoots.some((root) => root.path === removedRoot) && !result.value.activeLibraryRoot;
    }, { betaRoot: betaRootResolved }), { timeout: 20_000 }).toBe(true);

    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("photo_library_preview_sweep", {
        limit: 4,
        sampleLimit: 4
      });
      await crossAge.invoke("photo_library_catalog_cleanup", {
        sampleLimit: 4
      });
      await crossAge.invoke("photo_restore_rehearsal", {
        limit: 4
      });
    });
    await page.getByRole("button", { name: "Backup check" }).click();
    const repairCenter = page.getByRole("region", { name: "Photos repair center" });
    await expect(repairCenter.getByText("Missing originals", { exact: true })).toBeVisible({ timeout: 20_000 });
    await repairCenter.getByRole("button", { name: "Relink folder" }).click();
    const relinkConfirm = page.getByRole("dialog", { name: "Relink originals" });
    await expect(relinkConfirm).toBeVisible({ timeout: 20_000 });
    await relinkConfirm.getByRole("button", { name: "Relink" }).click();
    const repairHistory = page.getByLabel("Recent repair history");
    await expect(repairHistory).toContainText("Relink originals", { timeout: 20_000 });
    await expect(repairHistory).toContainText("Backup check", { timeout: 20_000 });
    await expect(repairHistory).toContainText("1 missing originals");
    await expect(repairHistory).toContainText("Preview sweep");
    await expect(repairHistory).toContainText(/\d+ previews generated, 0 remaining\./);
    await expect(repairHistory).toContainText("Catalog cleanup");
    await expect(repairHistory).toContainText("0 rows cleaned, 0 remaining.");
    await expect(repairHistory).toContainText("Restore rehearsal");
    await expect(repairHistory).toContainText("1 operation(s), 0 blocker(s).");
    await expect(repairHistory).toContainText("1 originals relinked from 1 match(es).");

    await settingsPanel.getByRole("button", { name: /Use managed root profile Workspace managed library/ }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { defaultManagedRoot: string; defaultManagedRootPersisted?: boolean; workspaceDefaultManagedRoot?: string } }>("photo_library_settings", {});
      return result.value.defaultManagedRootPersisted === false && result.value.defaultManagedRoot === result.value.workspaceDefaultManagedRoot;
    }), { timeout: 20_000 }).toBe(true);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos managed import destination selector follows root profile policy", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-import-destination-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const alphaRoot = path.join(temp, "alpha-managed-library");
  const betaRoot = path.join(temp, "beta-managed-library");
  mkdirSync(alphaRoot, { recursive: true });
  mkdirSync(betaRoot, { recursive: true });
  const alphaRootResolved = realpathSync(alphaRoot);
  const betaRootResolved = realpathSync(betaRoot);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ alphaRoot: firstRoot, betaRoot: secondRoot }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("save_photo_library_settings", {
        defaultManagedRoot: secondRoot,
        defaultStorageMode: "managed",
        profileName: "Import Beta E2E"
      });
      const alpha = await crossAge.invoke<{
        value: { managedRoots: Array<{ profileId?: string; path: string; name?: string; policy?: Record<string, unknown> }> };
      }>("save_photo_library_settings", {
        defaultManagedRoot: firstRoot,
        defaultStorageMode: "managed",
        profileName: "Import Alpha E2E"
      });
      const alphaProfile = alpha.value.managedRoots.find((root) => root.path === firstRoot);
      if (!alphaProfile) throw new Error("Missing alpha managed-root profile");
      await crossAge.invoke("save_photo_library_settings", {
        managedRootPolicy: {
          profileId: alphaProfile.profileId,
          path: firstRoot,
          name: alphaProfile.name || "Import Alpha E2E",
          policy: {
            ...(alphaProfile.policy || {}),
            keepFolderOrganizationDefault: true
          }
        }
      });
    }, { alphaRoot: alphaRootResolved, betaRoot: betaRootResolved });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const importStorageControls = page.locator(".photo-import-controls[aria-label='Import storage']");
    const copyDestination = importStorageControls.getByLabel("Copy destination");
    await expect(copyDestination).toBeVisible({ timeout: 20_000 });
    await expect(copyDestination).toHaveValue(alphaRootResolved);
    const importKeepFoldersToggle = importStorageControls.locator(".photo-import-keep-folders input");
    await expect(importKeepFoldersToggle).toBeChecked();
    await copyDestination.selectOption(betaRootResolved);
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.importManagedRoot"))).toBe(betaRootResolved);
    await expect(importKeepFoldersToggle).not.toBeChecked();
    await copyDestination.selectOption(alphaRootResolved);
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.importManagedRoot"))).toBe(alphaRootResolved);
    await expect(importKeepFoldersToggle).toBeChecked();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Recovered previews scans and saves managed-root orphans", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-recovered-orphans-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const managedRoot = path.join(temp, "managed-library");
  const orphanFolder = path.join(managedRoot, "lost");
  mkdirSync(orphanFolder, { recursive: true });
  const orphanPath = path.join(orphanFolder, "browser-orphan.png");
  const staleOrphanPath = path.join(orphanFolder, "browser-stale-orphan.png");
  writeFileSync(orphanPath, ONE_PIXEL_PNG);
  writeFileSync(staleOrphanPath, ONE_PIXEL_PNG);
  const managedRootResolved = realpathSync(managedRoot);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ managedRoot: rootPath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("save_photo_library_settings", {
        defaultManagedRoot: rootPath,
        defaultStorageMode: "managed",
        profileName: "Recovered orphan E2E root"
      });
    }, { managedRoot: managedRootResolved });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await page.locator(".photos-rail").getByText("Recovered", { exact: true }).click();
    const recoveredPanel = page.locator(".photo-recovered-panel");
    await expect(recoveredPanel).toContainText("No recovered import issues.");
    await expect(recoveredPanel.getByRole("button", { name: "Purge old files" })).toBeVisible();

    await recoveredPanel.getByRole("button", { name: "Preview orphans" }).click();
    await expect(recoveredPanel).toContainText("Preview found 2 recovered files", { timeout: 20_000 });
    await expect(recoveredPanel).toContainText("No recovered import issues.");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { total: number } }>("list_photo_import_failures", {});
      return result.value.total;
    })).toBe(0);

    await recoveredPanel.getByRole("button", { name: "Scan orphans" }).click();
    await expect(recoveredPanel).toContainText("Found 2 recovered files", { timeout: 20_000 });
    await expect(recoveredPanel).toContainText("browser-orphan.png", { timeout: 20_000 });
    await expect(recoveredPanel).toContainText("browser-stale-orphan.png", { timeout: 20_000 });
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recovered: 2
    }));

    unlinkSync(staleOrphanPath);
    await recoveredPanel.getByRole("button", { name: "Preview cleanup" }).click();
    await expect(recoveredPanel).toContainText("Cleanup preview found 1 stale row.", { timeout: 20_000 });
    await recoveredPanel.getByRole("button", { name: "Clean stale" }).click();
    const cleanupConfirm = page.getByRole("dialog", { name: "Clean Recovered" });
    await expect(cleanupConfirm).toBeVisible();
    await cleanupConfirm.getByRole("button", { name: "Clean Recovered" }).click();
    await expect(recoveredPanel).toContainText("Recovered cleanup dismissed 1, purged 0.", { timeout: 20_000 });
    await expect(recoveredPanel).not.toContainText("browser-stale-orphan.png");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recovered: 1
    }));
    const repairHistory = page.getByLabel("Recent repair history");
    await expect(repairHistory).toContainText("Recovered cleanup", { timeout: 20_000 });
    await expect(repairHistory).toContainText("1 row(s) dismissed, 0 purged.");

    await recoveredPanel.getByRole("button", { name: "Save to library" }).click();
    await expect(recoveredPanel).toContainText("No recovered import issues.", { timeout: 20_000 });
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recovered: 0
    }));
    await page.locator(".photos-rail").getByRole("button", { name: /^All Photos\b/ }).first().click();
    await expect(tileByFilename(page, "browser-orphan.png")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos export options reuse recent destinations", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-export-destinations-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const destination = path.join(temp, "recent-export-destination");
  writePhotoFixtureSet(media, ["browser-export-alpha.png"]);
  mkdirSync(destination, { recursive: true });
  const destinationResolved = realpathSync(destination);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const exportedFixtureExists = () => {
    for (const entry of readdirSync(destinationResolved, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("vintrace-photo-selection-")) continue;
      const bundle = path.join(destinationResolved, entry.name);
      if (existsSync(path.join(bundle, "media", "00001-browser-export-alpha.png"))) return true;
      if (existsSync(path.join(bundle, "00001-browser-export-alpha.png"))) return true;
    }
    return false;
  };

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.evaluate((recentDestination) => {
      window.localStorage.setItem("vintrace.photos.exportDestinations", JSON.stringify([recentDestination]));
    }, destinationResolved);
    await page.reload();
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Export destination E2E media"
      });
      const target = (imported.value.importedPaths || []).find((item) => /browser-export-alpha\.png$/.test(item));
      if (target) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: target,
          title: "Browser Export Alpha"
        });
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Browser Export Alpha")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Browser Export Alpha").locator(".photo-select-box").click();
    await page.getByRole("button", { name: "Export options" }).click();
    const destinations = page.getByLabel("Export destinations");
    await expect(destinations.locator("select")).toHaveValue(destinationResolved);
    await destinations.getByRole("button", { name: "Export to destination" }).click();
    await expect.poll(exportedFixtureExists, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem("vintrace.photos.exportDestinations") || "[]";
      return JSON.parse(raw)[0] || "";
    })).toBe(destinationResolved);

    await destinations.getByRole("button", { name: "Forget destination" }).click();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.exportDestinations"))).toBe("[]");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Recently Viewed and Shared show browser activity rows", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-activity-info-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["activity-viewed.png", "activity-shared.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder, exportBundle }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Activity info E2E media"
      });
      const viewedPath = (imported.value.importedPaths || []).find((item) => /activity-viewed\.png$/.test(item));
      const sharedPath = (imported.value.importedPaths || []).find((item) => /activity-shared\.png$/.test(item));
      if (!viewedPath || !sharedPath) throw new Error("Missing activity info fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: viewedPath,
        title: "Browser Activity Viewed"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: sharedPath,
        title: "Browser Activity Shared"
      });
      await crossAge.invoke("record_photo_asset_event", {
        eventType: "viewed",
        sourcePaths: [viewedPath],
        metadata: { surface: "photos-lightbox", session: "browser-activity-info" }
      });
      await crossAge.invoke("record_photo_asset_event", {
        eventType: "shared",
        sourcePaths: [sharedPath],
        metadata: { action: "export", bundlePath: exportBundle }
      });
    }, { mediaFolder: media, exportBundle: path.join(workspace, "exports", "browser-activity-export") });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByRole("button", { name: "Settings" }).click();
    const activityRetention = page.locator("#photos-local-settings label").filter({ hasText: "Recent activity" }).locator("select");
    await expect(activityRetention).toHaveValue("30");
    await activityRetention.selectOption("0");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const settings = await crossAge.invoke<{ value: { localSettings?: { recentActivityRetentionDays?: number } } }>("photo_library_settings", {});
      return settings.value.localSettings?.recentActivityRetentionDays;
    }), { timeout: 20_000 }).toBe(0);

    await rail.getByRole("button", { name: /^Recently Viewed\b/ }).click();
    await expect(tileByFilename(page, "Browser Activity Viewed")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Browser Activity Viewed").getByRole("button", { name: /Open photo/ }).click();
    const viewedLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(viewedLightbox).toBeVisible();
    const viewedInfo = viewedLightbox.locator(".photos-info-inspector");
    await expect(viewedInfo).toContainText("Activity");
    await expect(viewedInfo).toContainText("Viewed");
    await expect(viewedInfo).toContainText("lightbox");
    await viewedLightbox.getByRole("button", { name: "Close" }).click();
    await expect(viewedLightbox).toHaveCount(0);

    await rail.getByRole("button", { name: /^Recently Shared\b/ }).click();
    await expect(tileByFilename(page, "Browser Activity Shared")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Browser Activity Shared").getByRole("button", { name: /Open photo/ }).click();
    const sharedLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(sharedLightbox).toBeVisible();
    const sharedInfo = sharedLightbox.locator(".photos-info-inspector");
    await expect(sharedInfo).toContainText("Activity");
    await expect(sharedInfo).toContainText("Exported");
    await expect(sharedInfo).toContainText("browser-activity-export");
    await sharedLightbox.getByRole("button", { name: "Close" }).click();
    await expect(sharedLightbox).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosDateBucketDuplicateVersionChips(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["date-dupe-a.png", "date-dupe-b.png", "date-version.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "date-duplicate-version-chip-e2e"
api.project.db.create_scan_run(run_id, "Date Chip E2E", "manual", str(media))
metadata = {
    "date-dupe-a.png": {
        "title": "Date chip duplicate A",
        "dateOverride": "2026-06-18",
        "favorite": True,
        "locationOverride": {"label": "Date Chip Beach", "latitude": "36.9741", "longitude": "-122.0308"},
    },
    "date-dupe-b.png": {
        "title": "Date chip duplicate B",
        "dateOverride": "2026-06-19",
    },
    "date-version.png": {
        "title": "Date chip version",
        "dateOverride": "2026-06-20",
        "edited": True,
    },
}
for name, fields in metadata.items():
    source = media / name
    content_hash = "date-chip-duplicate-content" if name.startswith("date-dupe-") else f"hash:{name}"
    api.project.db.record_scan_file(run_id, source, path_signature(source), "completed", phase="processed", content_hash=content_hash)
    api.update_photo_asset_metadata({"sourcePath": str(source), **fields})

dupe_asset = api.project.db.photo_asset_by_path(str(media / "date-dupe-a.png"))
version_asset = api.project.db.photo_asset_by_path(str(media / "date-version.png"))
if dupe_asset is None or version_asset is None:
    raise RuntimeError("Date chip assets were not indexed")
with api.project.db.connect() as conn:
    conn.execute(
        """
        INSERT OR REPLACE INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (dupe_asset["assetId"], "date-chip-person", "Date Chip Person", "accepted", 0.98, 0.94, "confident", "2026-06-28T00:00:00Z"),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO photo_edit_stack_versions(
            version_id, asset_id, label, operations_json, source_edit_id, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "date-chip-version-e2e",
            version_asset["assetId"],
            "Browser saved version",
            '[{"kind":"adjust","setting":"exposure","value":0.2}]',
            "",
            "2026-06-28T00:00:00Z",
            "2026-06-28T00:00:00Z",
        ),
    )
api.project.db.rebuild_photo_duplicate_groups()
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 900, height: 620 });

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Date chip duplicate A")).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize(viewportSize);

    await page.getByLabel("Date view").getByRole("button", { name: "Months" }).click();
    const bucket = page.locator(".photo-date-bucket-card").filter({ hasText: "June 2026" });
    await expect(bucket).toBeVisible({ timeout: 20_000 });
    await expect(bucket).toContainText("3 photos");
    await expect(bucket).toContainText("1 favorite");
    await expect(bucket).toContainText("1 with people");
    await expect(bucket).toContainText("1 place");
    await expect(bucket).toContainText("2 duplicates");
    await expect(bucket).toContainText("1 version");
    await expect(bucket.locator(".photo-date-bucket-badges small")).toHaveCount(6);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos date buckets show duplicate and version chips", async () => {
  await exercisePhotosDateBucketDuplicateVersionChips({ width: 900, height: 620 }, "vintrace-photos-date-chips-");
});

test("Photos compact date buckets show duplicate and version chips", async () => {
  await exercisePhotosDateBucketDuplicateVersionChips({ width: 390, height: 740 }, "vintrace-photos-date-chips-compact-");
});

test("Photos date buckets demote feature-less representative covers", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-date-curation-cover-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["date-curation-favorite.png", "date-curation-neutral.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "date-curation-cover-e2e"
api.project.db.create_scan_run(run_id, "Date Curation Cover E2E", "manual", str(media))
favorite = media / "date-curation-favorite.png"
neutral = media / "date-curation-neutral.png"
for source in (favorite, neutral):
    api.project.db.record_scan_file(run_id, source, path_signature(source), "completed", phase="processed")
api.update_photo_asset_metadata({
    "sourcePath": str(favorite),
    "title": "Featureless favorite cover",
    "dateOverride": "2026-06-18",
    "favorite": True,
    "keywords": ["concert"],
    "locationOverride": {"label": "Curation Beach", "latitude": "36.9741", "longitude": "-122.0308"},
})
api.update_photo_asset_metadata({
    "sourcePath": str(neutral),
    "title": "Neutral city cover",
    "dateOverride": "2026-06-19",
})
favorite_asset = api.project.db.photo_asset_by_path(str(favorite))
if favorite_asset is None:
    raise RuntimeError("Date curation favorite asset was not indexed")
with api.project.db.connect() as conn:
    conn.execute(
        """
        INSERT OR REPLACE INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (favorite_asset["assetId"], "date-curation-alice", "Alice", "accepted", 0.99, 0.95, "confident", "2026-06-28T00:00:00Z"),
    )
api.save_photo_curation_preferences({
    "featureLessPeople": ["Alice"],
    "featureLessPlaces": ["Curation Beach"],
    "featureLessDates": ["2026-06-18"],
    "featureLessContent": ["concert"],
})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 900, height: 620 });

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Featureless favorite cover")).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Date view").getByRole("button", { name: "Months" }).click();
    const bucket = page.locator(".photo-date-bucket-card").filter({ hasText: "June 2026" });
    await expect(bucket).toBeVisible({ timeout: 20_000 });
    await expect(bucket).toContainText("Neutral city cover");
    await expect(bucket).not.toContainText("Featureless favorite cover");
    await expect(bucket).toContainText("2 photos");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos date bucket modes drill into years days recent days and filtered months", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-date-mode-matrix-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, [
    "date-matrix-june-a.png",
    "date-matrix-june-b.png",
    "date-matrix-july-favorite.png",
    "date-matrix-old.png",
  ]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "date-mode-matrix-e2e"
api.project.db.create_scan_run(run_id, "Date Mode Matrix E2E", "manual", str(media))
metadata = {
    "date-matrix-june-a.png": {"title": "Matrix June A", "dateOverride": "2026-06-18"},
    "date-matrix-june-b.png": {"title": "Matrix June B", "dateOverride": "2026-06-19"},
    "date-matrix-july-favorite.png": {"title": "Matrix July Favorite", "dateOverride": "2026-07-02", "favorite": True},
    "date-matrix-old.png": {"title": "Matrix Last Year", "dateOverride": "2025-12-31"},
}
for name, fields in metadata.items():
    source = media / name
    api.project.db.record_scan_file(run_id, source, path_signature(source), "completed", phase="processed")
    api.update_photo_asset_metadata({"sourcePath": str(source), **fields})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 900, height: 620 });

  const dateView = () => page.getByLabel("Date view");
  const activeFilters = () => page.getByLabel("Active filters");
  const clearActiveDate = async (label: string | RegExp) => {
    await activeFilters().getByRole("button", { name: label }).click();
    await expect(page.locator(".photo-date-bucket-card").first()).toBeVisible({ timeout: 20_000 });
  };

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Matrix July Favorite")).toBeVisible({ timeout: 20_000 });

    await dateView().getByRole("button", { name: "Years", exact: true }).click();
    const year2026 = page.locator(".photo-date-bucket-card").filter({ hasText: "2026" });
    await expect(year2026).toContainText("3 photos", { timeout: 20_000 });
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "2025" })).toContainText("1 photo");
    await year2026.click();
    await expect(activeFilters()).toContainText("Date: 2026", { timeout: 20_000 });
    await expect(tileByFilename(page, "Matrix June A")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Matrix Last Year")).toHaveCount(0);
    await clearActiveDate(/Date:\s*2026/);

    await dateView().getByRole("button", { name: "Days", exact: true }).click();
    const june18 = page.locator(".photo-date-bucket-card").filter({ hasText: "Jun 18, 2026" });
    await expect(june18).toContainText("1 photo", { timeout: 20_000 });
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "Dec 31, 2025" })).toContainText("1 photo");
    await june18.click();
    await expect(activeFilters()).toContainText("Date: Jun 18, 2026", { timeout: 20_000 });
    await expect(tileByFilename(page, "Matrix June A")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Matrix June B")).toHaveCount(0);
    await clearActiveDate(/Date:\s*Jun 18, 2026/);

    await dateView().getByRole("button", { name: "Recent Days", exact: true }).click();
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "Jul 2, 2026" })).toContainText("1 photo", { timeout: 20_000 });
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "Jun 18, 2026" })).toContainText("1 photo");
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "Dec 31, 2025" })).toHaveCount(0);

    await page.getByRole("checkbox", { name: "Favorites", exact: true }).check();
    await dateView().getByRole("button", { name: "Months", exact: true }).click();
    const filteredJuly = page.locator(".photo-date-bucket-card").filter({ hasText: "July 2026" });
    await expect(filteredJuly).toContainText("1 photo", { timeout: 20_000 });
    await expect(filteredJuly).toContainText("1 favorite");
    await expect(page.locator(".photo-date-bucket-card").filter({ hasText: "June 2026" })).toHaveCount(0);
    await filteredJuly.click();
    await expect(activeFilters()).toContainText("Favorites", { timeout: 20_000 });
    await expect(activeFilters()).toContainText("Date: July 2026");
    await expect(tileByFilename(page, "Matrix July Favorite")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Matrix June A")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosRenderedImageExport(
  viewportSize: { width: number; height: number },
  tempPrefix: string,
  options: { customProfileFixture?: "valid" | "invalid"; targetProfile?: "srgb" | "custom-icc" } = {}
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  mkdirSync(media, { recursive: true });
  writeFileSync(path.join(media, "render-image-alpha.png"), MARKUP_TEST_PNG);
  writeFileSync(path.join(media, "render-image-alpha.png.xmp"), "existing browser sidecar", "utf8");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const targetProfile = options.targetProfile || "srgb";
  const customProfileFixture = options.customProfileFixture || "valid";
  const customProfileFileName = customProfileFixture === "invalid" ? "browser-invalid.icc" : "browser-custom.icc";
  const customProfilePath = targetProfile === "custom-icc" ? path.join(temp, "profiles", customProfileFileName) : "";
  if (customProfilePath) {
    if (customProfileFixture === "invalid") {
      mkdirSync(path.dirname(customProfilePath), { recursive: true });
      writeFileSync(customProfilePath, "not an icc profile", "utf8");
    } else {
      runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys
from PIL import ImageCms

target = Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
`, [customProfilePath]);
    }
  }
  const customProfileResolved = customProfilePath ? realpathSync(customProfilePath) : "";

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Rendered image export E2E media"
      });
      const sourcePath = (imported.value.importedPaths || []).find((item) => /render-image-alpha\.png$/.test(item));
      if (!sourcePath) throw new Error("Missing imported rendered-image export fixture");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath,
        title: "Browser Rendered Image",
        caption: "Rendered browser export caption",
        keywords: ["browser", "export"],
        dateOverride: "2026-06-20T09:30:00Z",
        locationOverride: { label: "Private Browser Beach", latitude: "36.9741", longitude: "-122.0308" },
        accessibilityDescription: "Rendered image browser accessibility"
      });
      const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: "Browser Export Album",
        albumKind: "manual"
      });
      await crossAge.invoke("add_photo_album_items", {
        albumId: album.value.albumId,
        sourcePaths: [sourcePath]
      });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Browser Rendered Image")).toBeVisible({ timeout: 20_000 });
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
      await expect(tileByFilename(page, "Browser Rendered Image")).toBeVisible({ timeout: 20_000 });
    }
    await tileByFilename(page, "Browser Rendered Image").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");

    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Render format").selectOption("jpeg");
    await page.getByLabel("Render quality").fill("81");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("24");
    if (targetProfile === "custom-icc") {
      await app.evaluate((_electron, profilePath) => {
        (globalThis as any).process.env.CROSSAGE_TEST_DIALOG_PATHS = profilePath;
      }, customProfilePath);
      await page.getByLabel("Target profile").selectOption("custom-icc");
      await expect(page.getByText("No ICC selected")).toBeVisible();
      await page.getByRole("button", { name: "Choose ICC profile" }).click();
      await expect(page.getByText(customProfileFileName)).toBeVisible();
      if (customProfileFixture === "invalid") {
        await expect(page.getByText(/Profile check failed:/)).toBeVisible();
        await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
        // The invalid profile is rejected both by the inline status check and by the
        // export preflight, so the message can appear in more than one element.
        await expect(page.getByText(/Custom color profile file is not a valid ICC\/ICM profile/).first()).toBeVisible();
        expect(pageErrors).toEqual([]);
        return;
      }
      await expect(page.getByText(/Profile ready:/)).toBeVisible();
      await expect(page.getByText(/Profile available: browser-custom\.icc/)).toBeVisible({ timeout: 10_000 });
    } else {
      await page.getByLabel("Target profile").selectOption("srgb");
      await expect(page.getByText(/Profile available: Generated sRGB profile is available\./)).toBeVisible({ timeout: 10_000 });
    }
    const exportGrid = page.locator(".photo-export-options");
    await exportGrid.locator("label").filter({ has: page.locator("span", { hasText: /^Layout$/ }) }).locator("select").selectOption("bundle");
    await exportGrid.locator("label").filter({ has: page.locator("span", { hasText: /^Filename$/ }) }).locator("select").selectOption("template");
    await page.getByLabel("Filename template").fill("{sequence}-{title}-{kind}");
    await page.getByLabel("Subfolder template").fill("{date}/{album}");
    await page.getByLabel("Metadata JSON").check();
    await page.getByLabel("XMP sidecars").check();
    await page.getByLabel("Existing sidecars").check();
    await page.getByLabel("Strip location").check();

    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 1 photo; rendered 1 with 2 sidecars\./)).toBeVisible({ timeout: 30_000 });
    const exportResult = page.locator(".photo-export-result");
    await expect(exportResult).toContainText("1 written");
    await expect(exportResult).toContainText("1 rendered");
    await expect(exportResult).toContainText("3 sidecars");
    await expect(exportResult).toContainText("All selected files were written.");
    const writtenFiles = exportResult.locator(".photo-export-result-success-details");
    await writtenFiles.locator(":scope > summary").click();
    await expect(writtenFiles).toContainText("render-image-alpha.png");
    const writtenFileDetails = writtenFiles.locator(".photo-export-result-row-details").first();
    await writtenFileDetails.locator("summary").click();
    await expect(writtenFileDetails).toContainText("Result: rendered");
    await expect(writtenFileDetails).toContainText("Variant: rendered");
    await expect(writtenFileDetails).toContainText("Render format: jpeg");
    await expect(writtenFileDetails).toContainText(`Color profile: ${targetProfile}`);
    if (targetProfile === "custom-icc") {
      await expect(writtenFileDetails).toContainText("Profile file: browser-custom.icc");
    }

    await expect.poll(() => {
      const exportRoot = path.join(workspace, "exports");
      if (!existsSync(exportRoot)) return [] as string[];
      return readdirSync(exportRoot)
        .filter((entry) => entry.startsWith("vintrace-photo-selection-"))
        .sort();
    }, { timeout: 20_000 }).not.toEqual([]);
    const exportRoot = path.join(workspace, "exports");
    const bundleName = readdirSync(exportRoot).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const bundlePath = path.join(exportRoot, bundleName || "");
    const manifest = JSON.parse(readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest).toEqual(expect.objectContaining({
      action: "export",
      exportVariant: "rendered",
      renderFormat: "jpeg",
      renderQuality: 81,
      renderMaxDimension: 24,
      targetColorProfile: targetProfile,
      layout: "bundle",
      filenameMode: "template",
      filenameTemplate: "{sequence}-{title}-{kind}",
      subfolderTemplate: "{date}/{album}",
      includeMetadata: true,
      includeXmp: true,
      includeExistingSidecars: true,
      stripLocation: true
    }));
    expect(manifest.counts).toEqual(expect.objectContaining({
      selected: 1,
      copied: 1,
      rendered: 1,
      metadata: 1,
      xmp: 1,
      existingSidecars: 1,
      renderFallback: 0
    }));
    expect(manifest.items).toHaveLength(1);
    const row = manifest.items[0] as Record<string, any>;
    expect(row).toEqual(expect.objectContaining({
      result: "rendered",
      exportVariant: "rendered",
      renderFormat: "jpeg",
      targetColorProfile: targetProfile
    }));
    if (targetProfile === "custom-icc") {
      expect(manifest.targetColorProfilePath).toBe(customProfileResolved);
      expect(row.targetColorProfilePath).toBe(customProfileResolved);
    }
    expect(row.targetPath).toContain(path.join("media", "2026-06-20", "Browser-Export-Album"));
    expect(path.basename(String(row.targetPath || ""))).toBe("00001-Browser-Rendered-Image-image.jpg");
    expect(readFileSync(String(row.targetPath || "")).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const metadata = JSON.parse(readFileSync(String(row.metadataPath || ""), "utf8")) as Record<string, any>;
    expect(metadata.locationStripped).toBe(true);
    expect(metadata.metadata.title).toBe("Browser Rendered Image");
    expect(metadata.metadata.caption).toBe("Rendered browser export caption");
    expect(metadata.metadata.keywords).toEqual(["browser", "export"]);
    expect(metadata.metadata.accessibilityDescription).toBe("Rendered image browser accessibility");
    expect(metadata.metadata.locationOverride).toEqual({});
    expect(metadata.metadata.locationHidden).toBe(true);
    const xmpText = readFileSync(String(row.xmpPath || ""), "utf8");
    expect(xmpText).toContain("Browser Rendered Image");
    expect(xmpText).not.toContain("Private Browser Beach");
    expect(xmpText).not.toContain("GPSLatitude");
    expect(row.existingSidecarPaths).toHaveLength(1);
    expect(readFileSync(String(row.existingSidecarPaths[0] || ""), "utf8")).toBe("existing browser sidecar");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos rendered image export honors browser export options", async () => {
  await exercisePhotosRenderedImageExport({ width: 900, height: 620 }, "vintrace-photos-rendered-image-export-");
});

test("Photos rendered image export honors compact browser export options", async () => {
  await exercisePhotosRenderedImageExport({ width: 390, height: 740 }, "vintrace-photos-rendered-image-export-compact-");
});

test("Photos rendered image export supports custom ICC profile picker", async () => {
  await exercisePhotosRenderedImageExport({ width: 900, height: 620 }, "vintrace-photos-rendered-image-export-custom-icc-", { targetProfile: "custom-icc" });
});

test("Photos rendered image export rejects invalid custom ICC profile picker files", async () => {
  await exercisePhotosRenderedImageExport({ width: 900, height: 620 }, "vintrace-photos-rendered-image-export-invalid-icc-", {
    customProfileFixture: "invalid",
    targetProfile: "custom-icc"
  });
});

test("Photos missing-original export drilldown works in compact layout", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-missing-export-compact-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["compact-missing.png", "compact-present.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 900, height: 620 });

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Compact missing export E2E media"
      });
    }, { mediaFolder: media });
    unlinkSync(path.join(media, "compact-missing.png"));

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "compact-missing.png")).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 390, height: 740 });
    await expect(tileByFilename(page, "compact-missing.png")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".photo-load-error").filter({ hasText: "Missing originals" })).toContainText("compact-missing.png", { timeout: 20_000 });
    await expect(tileByFilename(page, "compact-missing.png").locator(".photo-missing-badge")).toContainText("Missing");

    await tileByFilename(page, "compact-missing.png").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 0 photos; missing 1\./)).toBeVisible({ timeout: 20_000 });

    const exportResult = page.locator(".photo-export-result");
    await expect(exportResult).toContainText("compact-missing.png");
    await expect(exportResult).toContainText("missing");
    await expect(exportResult).toContainText("1 needs attention");
    const exportDetails = exportResult.locator(".photo-export-result-row-details").first();
    await exportDetails.locator("summary").click();
    await expect(exportDetails).toContainText("Result: missing");
    await expect(exportDetails).toContainText("Source: compact-missing.png");
    await expect(exportDetails).toContainText("No target was written.");
    await exportResult.getByRole("button", { name: "Dismiss export result" }).click();
    await expect(page.locator(".photo-export-result")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos mixed export result shows written files and capped missing issues", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-mixed-export-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const filenames = [
    "mixed-present.png",
    "mixed-missing-1.png",
    "mixed-missing-2.png",
    "mixed-missing-3.png",
    "mixed-missing-4.png",
    "mixed-missing-5.png",
    "mixed-missing-6.png",
    "mixed-missing-7.png"
  ];
  writePhotoFixtureSet(media, filenames);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Mixed export E2E media"
      });
    }, { mediaFolder: media });
    for (const name of filenames.filter((name) => name.startsWith("mixed-missing-"))) {
      unlinkSync(path.join(media, name));
    }

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "mixed-present.png")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".photo-load-error").filter({ hasText: "Missing originals" })).toContainText("mixed-missing-1.png", { timeout: 20_000 });
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Select page" }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("8 selected");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 1 photo; missing 7\./)).toBeVisible({ timeout: 30_000 });

    const exportResult = page.getByRole("alert", { name: "Last export result" });
    await expect(exportResult).toContainText("1 written");
    await expect(exportResult).toContainText("7 needs attention");
    const issueList = exportResult.locator(":scope > .photo-export-result-issues");
    await expect(issueList.locator(":scope > .photo-export-result-row")).toHaveCount(6);
    await expect(issueList).toContainText("mixed-missing-1.png");
    await expect(issueList).toContainText("No output file");
    await expect(issueList).toContainText("1 more item(s)");
    const firstIssueDetails = issueList.locator(".photo-export-result-row-details").first();
    await firstIssueDetails.locator("summary").click();
    await expect(firstIssueDetails).toContainText("Result: missing");
    await expect(firstIssueDetails).toContainText("No target was written.");

    const writtenFiles = exportResult.locator(".photo-export-result-success-details");
    await expect(writtenFiles).toBeVisible();
    await writtenFiles.locator(":scope > summary").click();
    await expect(writtenFiles).toContainText("mixed-present.png");
    const writtenFileDetails = writtenFiles.locator(".photo-export-result-row-details").first();
    await writtenFileDetails.locator("summary").click();
    await expect(writtenFileDetails).toContainText("Result: copied");
    await expect(writtenFileDetails).toContainText("Variant: original");
    await exportResult.getByRole("button", { name: "Dismiss export result" }).click();
    await expect(page.locator(".photo-export-result")).toHaveCount(0);

    const exportRoot = path.join(workspace, "exports");
    const bundleName = readdirSync(exportRoot).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const manifest = JSON.parse(readFileSync(path.join(exportRoot, bundleName || "", "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.counts).toEqual(expect.objectContaining({
      selected: 8,
      copied: 1,
      missing: 7
    }));
    expect(manifest.items.filter((item: Record<string, any>) => item.result === "missing")).toHaveLength(7);
    expect(manifest.items.filter((item: Record<string, any>) => item.result === "copied")).toHaveLength(1);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos safety actions expose undo for delete and hide", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-safety-undo-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["undo-target.png", "kept.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Safety undo E2E media"
      });
      const target = (imported.value.importedPaths || []).find((item) => /undo-target\.png$/.test(item));
      if (target) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: target,
          title: "Undo target",
          captureDate: "2026-06-12T07:30:00Z"
        });
      }
    }, { mediaFolder: media });
    unlinkSync(path.join(media, "kept.png"));

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const sensitiveDisplayToggle = page.locator(".photo-rail-display-controls label").filter({ hasText: "Sensitive" }).locator("input");
    await sensitiveDisplayToggle.uncheck();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showSensitiveCollections"))).toBe("false");
    await sensitiveDisplayToggle.check();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showSensitiveCollections"))).toBe("true");
    const screenshotDisplayToggle = page.locator(".photo-rail-display-controls label").filter({ hasText: "Screenshots" }).locator("input");
    await screenshotDisplayToggle.uncheck();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showScreenshotCollections"))).toBe("false");
    await screenshotDisplayToggle.check();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showScreenshotCollections"))).toBe("true");
    const sharedDisplayToggle = page.locator(".photo-rail-display-controls label").filter({ hasText: "Shared" }).locator("input");
    await sharedDisplayToggle.uncheck();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showSharedCollections"))).toBe("false");
    await sharedDisplayToggle.check();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showSharedCollections"))).toBe("true");
    const lowValueDisplayToggle = page.locator(".photo-rail-display-controls label").filter({ hasText: "Low-value" }).locator("input");
    await lowValueDisplayToggle.uncheck();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showLowValueCollections"))).toBe("false");
    await lowValueDisplayToggle.check();
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.showLowValueCollections"))).toBe("true");
    await expect(page.locator(".photo-load-error").filter({ hasText: "Missing originals" })).toContainText("kept.png", { timeout: 20_000 });
    await expect(tileByFilename(page, "kept.png").locator(".photo-missing-badge")).toContainText("Missing");
    await tileByFilename(page, "kept.png").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 0 photos; missing 1\./)).toBeVisible({ timeout: 20_000 });
    const exportResult = page.locator(".photo-export-result");
    await expect(exportResult).toContainText("kept.png");
    await expect(exportResult).toContainText("missing");
    await expect(exportResult).toContainText("1 needs attention");
    const exportDetails = exportResult.locator(".photo-export-result-row-details").first();
    await exportDetails.locator("summary").click();
    await expect(exportDetails).toContainText("Result: missing");
    await expect(exportDetails).toContainText("Source: kept.png");
    await expect(exportDetails).toContainText("No target was written.");
    await exportResult.getByRole("button", { name: "Dismiss export result" }).click();
    await expect(page.locator(".photo-export-result")).toHaveCount(0);
    await tileByFilename(page, "kept.png").locator(".photo-select-box").click();
    await tileByFilename(page, "kept.png").getByRole("button", { name: /Open photo/ }).click();
    const missingLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(missingLightbox).toContainText("Original file is missing");
    await expect(missingLightbox.getByRole("button", { name: "Reveal original" })).toBeDisabled();
    await expect(missingLightbox.getByRole("button", { name: "Open original" })).toBeDisabled();
    await missingLightbox.getByRole("button", { name: "Close" }).click();
    await expect(missingLightbox).toHaveCount(0);
    await expect(tileByFilename(page, "Undo target")).toBeVisible({ timeout: 20_000 });

    await tileByFilename(page, "Undo target").getByRole("button", { name: /Photo actions/ }).click();
    await expect(page.getByRole("menu")).toContainText("Reveal original");
    await expect(page.getByRole("menu")).toContainText("Delete");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    const allPhotosRow = page.locator(".photos-rail .photo-rail-row").filter({
      has: page.locator(".photos-rail-name", { hasText: /^\s*All Photos\s*$/ })
    });
    await allPhotosRow.getByRole("button", { name: /Collection actions/ }).click();
    await expect(page.getByRole("menu")).toContainText("Open collection");
    await expect(page.getByRole("menu")).toContainText("Pin collection");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await tileByFilename(page, "Undo target").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByLabel("Original date")).toHaveValue("2026-06-12");
    await lightbox.getByLabel("Original date").fill("2026-06-17");
    await lightbox.getByLabel("Original time", { exact: true }).fill("08:09");
    await lightbox.getByLabel("Original timezone offset").fill("+05:30");
    await lightbox.getByRole("button", { name: "Save info" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; originalCaptureDate?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      return result.items.find((item) => item.title === "Undo target")?.originalCaptureDate || "";
    })).toBe("2026-06-17T08:09:00+05:30");
    await expect(lightbox.getByLabel("Original date")).toHaveValue("2026-06-17");
    await expect(lightbox.getByLabel("Original time", { exact: true })).toHaveValue("08:09");
    const adjustedDateInput = lightbox.locator("label").filter({ has: page.locator("span", { hasText: /^Adjusted date$/ }) }).locator('input[type="date"]');
    const saveInfoButton = lightbox.getByRole("button", { name: "Save info" });
    await expect(saveInfoButton).toBeDisabled();
    await page.waitForTimeout(200);
    await adjustedDateInput.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2026-06-18");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(adjustedDateInput).toHaveValue("2026-06-18");
    await expect(saveInfoButton).toBeEnabled();
    await saveInfoButton.click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; dateOverride?: string; captureDate?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      return result.items.find((item) => item.title === "Undo target")?.dateOverride || "";
    })).toBe("2026-06-18");
    await expect(lightbox.getByLabel("Adjusted date")).toHaveValue("2026-06-18");
    await expect(lightbox.getByRole("button", { name: "Revert date" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Revert date" }).click();
    await expect(lightbox.getByLabel("Adjusted date")).toHaveValue("");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; dateOverride?: string; captureDate?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      return result.items.find((item) => item.title === "Undo target")?.dateOverride || "";
    })).toBe("");
    await lightbox.getByLabel("Location", { exact: true }).fill("Private Beach");
    await lightbox.getByLabel("Latitude").fill("36.9741");
    await lightbox.getByLabel("Longitude").fill("-122.0308");
    await lightbox.getByLabel("Hide location").check();
    await lightbox.getByRole("button", { name: "Save info" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert location" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Revert location" }).click();
    await expect(lightbox.getByLabel("Location", { exact: true })).toHaveValue("");
    await expect(lightbox.getByLabel("Latitude")).toHaveValue("");
    await expect(lightbox.getByLabel("Longitude")).toHaveValue("");
    await expect(lightbox.getByLabel("Hide location")).not.toBeChecked();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; locationOverride?: Record<string, unknown>; locationHidden?: boolean }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        label: String(target?.locationOverride?.label || ""),
        hidden: Boolean(target?.locationHidden)
      };
    })).toEqual({ label: "", hidden: false });
    await expect(lightbox.locator(".photos-depth-controls")).toBeVisible();
    await lightbox.getByLabel("Depth mode").selectOption("portrait");
    await lightbox.getByLabel("Depth aperture").fill("2.8");
    await lightbox.getByLabel("Depth focus distance").fill("0.9");
    await lightbox.getByLabel("Depth portrait effect").fill("Studio Light");
    await expect(saveInfoButton).toBeEnabled();
    await saveInfoButton.click();
    await expect(lightbox.locator(".photos-info-inspector")).toContainText("Studio Light", { timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; assetMetadata?: { localDepthControls?: Record<string, unknown> } }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      return result.items.find((item) => item.title === "Undo target")?.assetMetadata?.localDepthControls || {};
    })).toEqual({
      mode: "portrait",
      modeLabel: "Portrait",
      aperture: "2.8",
      focusDistance: "0.9",
      effect: "Studio Light"
    });
    await expect(lightbox.getByRole("button", { name: "Rotate image edit" })).toBeVisible();
    await lightbox.getByRole("button", { name: "Rotate image edit" }).click();
    await lightbox.getByLabel("Image straighten angle").evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2.5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await lightbox.getByRole("button", { name: "Use manual crop box" }).click();
    await lightbox.getByLabel("Manual crop left").fill("20");
    await lightbox.getByLabel("Manual crop top").fill("5");
    await lightbox.getByLabel("Manual crop width").fill("60");
    await lightbox.getByLabel("Manual crop height").fill("90");
    await lightbox.getByLabel("Image crop aspect").selectOption("3:2");
    await lightbox.getByRole("button", { name: "Adjust image" }).click();
    const setImageSlider = async (label: string, value: string) => {
      await lightbox.getByLabel(label).evaluate((element, nextValue) => {
        const input = element as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    };
    await setImageSlider("Image exposure", "0.5");
    await setImageSlider("Image contrast", "20");
    await setImageSlider("Image saturation", "15");
    await setImageSlider("Image warmth", "10");
    await setImageSlider("Image sharpness", "25");
    await expect(lightbox.getByRole("group", { name: "Image filter thumbnails" })).toBeVisible();
    await lightbox.getByRole("button", { name: "Preview filter Noir" }).click();
    await setImageSlider("Image filter intensity", "50");
    await lightbox.getByRole("button", { name: "Flip image horizontally" }).click();
    await expect(lightbox).toContainText("R90 / S+2.5 / Box 20/5/60/90 / 3:2 / Adj E+0.5/C+20/S+15/W+10/Sh+25 / Filter Noir 50% / H");
    await lightbox.getByRole("button", { name: "Flip image vertically" }).click();
    await expect(lightbox).toContainText("R90 / S+2.5 / Box 20/5/60/90 / 3:2 / Adj E+0.5/C+20/S+15/W+10/Sh+25 / Filter Noir 50% / HV");
    await page.keyboard.press("c");
    await expect(lightbox).toContainText("R90 / S+2.5 / Box 20/5/60/90 / 2:3 / Adj E+0.5/C+20/S+15/W+10/Sh+25 / Filter Noir 50% / HV");
    await page.keyboard.press("x");
    await expect(lightbox).toContainText("R90 / S+2.5 / Box 20/5/60/90 / 2:3 / Adj E+0.5/C+20/S+15/W+10/Sh+25 / Filter Noir 50% / V");
    await page.keyboard.press("x");
    await page.keyboard.press("r");
    await expect(lightbox).toContainText("R180 / S+2.5 / Box 20/5/60/90 / 2:3 / Adj E+0.5/C+20/S+15/W+10/Sh+25 / Filter Noir 50% / HV");
    await expect(lightbox.getByRole("button", { name: "Save image edit stack" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Save image edit stack" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Duplicate edit version" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Duplicate edit version" }).click();
    await expect(lightbox.getByLabel("Edit stack versions")).toBeVisible();
    const editVersionPreview = lightbox.getByRole("group", { name: "Edit version preview" });
    await expect(editVersionPreview).toContainText("Operations");
    await expect(editVersionPreview).toContainText("1 operation");
    await expect(editVersionPreview).toContainText("Preview");
    await expect(editVersionPreview).toContainText("R180");
    await expect(editVersionPreview).toContainText("Saved");
    await expect(editVersionPreview).toContainText("Source edit");
    const editInfo = lightbox.locator(".photos-info-inspector");
    await expect(editInfo).toContainText("Edits");
    await expect(editInfo).toContainText("Active edit: 1 operation");
    await expect(editInfo).toContainText("R180");
    await expect(editInfo).toContainText("1 saved version");
    const activeOperationHistory = lightbox.getByRole("group", { name: "Current edit operations" });
    await expect(activeOperationHistory).toBeVisible();
    await expect(activeOperationHistory).toContainText("Step 1");
    await expect(activeOperationHistory).toContainText("Image crop rotate");
    await expect(activeOperationHistory).toContainText("R180");
    const editVersionHistory = lightbox.getByRole("group", { name: "Edit version history" });
    await expect(editVersionHistory).toBeVisible();
    await expect(editVersionHistory).toContainText("1 operation");
    await expect(editVersionHistory).toContainText("R180");
    await expect(editVersionHistory).toContainText("Saved");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; sourcePath: string; previewPath?: string | null; edited?: boolean; hasEditStack?: boolean }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        edited: Boolean(target?.edited),
        hasEditStack: Boolean(target?.hasEditStack),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews")
      };
    })).toEqual({ edited: true, hasEditStack: true, hasRenderedPreview: true });
    const compareButton = lightbox.getByRole("button", { name: "Compare original and edited photo" });
    await expect(compareButton).toBeVisible();
    await expect(compareButton).toContainText("Show original");
    await compareButton.click();
    await expect(compareButton).toContainText("Show edit");
    await compareButton.click();
    await expect(compareButton).toContainText("Show original");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    await tileByFilename(page, "Undo target").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Snapshot edit versions for selected photos" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const pageResult = await crossAge.invoke<{ items: Array<{ title?: string; sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = pageResult.items.find((item) => item.title === "Undo target");
      if (!target?.sourcePath) return 0;
      const versions = await crossAge.invoke<{ value: { versions?: unknown[] } }>("list_photo_edit_stack_versions", {
        sourcePath: target.sourcePath
      });
      return Array.isArray(versions.value?.versions) ? versions.value.versions.length : 0;
    })).toBeGreaterThanOrEqual(2);
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Revert edits for selected photos" }).click();
    const revertSelectedConfirm = page.getByRole("dialog", { name: "Revert selected edits?" });
    await expect(revertSelectedConfirm).toBeVisible();
    await revertSelectedConfirm.getByRole("button", { name: "Revert edits" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; sourcePath: string; previewPath?: string | null; edited?: boolean; hasEditStack?: boolean }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        edited: Boolean(target?.edited),
        hasEditStack: Boolean(target?.hasEditStack),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews")
      };
    })).toEqual({ edited: true, hasEditStack: false, hasRenderedPreview: false });
    await expect(page.locator(".photo-bulk-bar")).toContainText("0 selected");

    await tileByFilename(page, "Undo target").getByRole("button", { name: /Open photo/ }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeHidden();
    const revertedVersionInfo = lightbox.locator(".photos-info-inspector");
    await expect(revertedVersionInfo).toContainText("Edits");
    await expect(revertedVersionInfo).toContainText("No active edits");
    await expect(revertedVersionInfo).toContainText("saved versions");
    await expect(lightbox.getByRole("group", { name: "Current edit operations" })).toHaveCount(0);
    const revertedVersionHistory = lightbox.getByRole("group", { name: "Edit version history" });
    await expect(revertedVersionHistory).toBeVisible();
    await expect(revertedVersionHistory.getByRole("button")).toHaveCount(2);
    await expect(revertedVersionHistory).toContainText("1 operation");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await tileByFilename(page, "Undo target").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Restore latest edit versions for selected photos" }).click();
    const restoreVersionsConfirm = page.getByRole("dialog", { name: "Restore latest saved versions?" });
    await expect(restoreVersionsConfirm).toBeVisible();
    await restoreVersionsConfirm.getByRole("button", { name: "Restore versions" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; sourcePath: string; previewPath?: string | null; edited?: boolean; hasEditStack?: boolean; editStackVersionCount?: number }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        edited: Boolean(target?.edited),
        hasEditStack: Boolean(target?.hasEditStack),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews"),
        versionCount: Number(target?.editStackVersionCount || 0)
      };
    })).toEqual({ edited: true, hasEditStack: true, hasRenderedPreview: true, versionCount: 2 });

    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Delete saved edit versions for selected photos" }).click();
    const deleteVersionsConfirm = page.getByRole("dialog", { name: "Delete saved edit versions?" });
    await expect(deleteVersionsConfirm).toBeVisible();
    await deleteVersionsConfirm.getByRole("button", { name: "Delete versions" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; previewPath?: string | null; hasEditStack?: boolean; editStackVersionCount?: number }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        hasEditStack: Boolean(target?.hasEditStack),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews"),
        versionCount: Number(target?.editStackVersionCount || 0)
      };
    })).toEqual({ hasEditStack: true, hasRenderedPreview: true, versionCount: 0 });

    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Revert edits for selected photos" }).click();
    const secondRevertConfirm = page.getByRole("dialog", { name: "Revert selected edits?" });
    await expect(secondRevertConfirm).toBeVisible();
    await secondRevertConfirm.getByRole("button", { name: "Revert edits" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; previewPath?: string | null; hasEditStack?: boolean; editStackVersionCount?: number }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Undo target");
      return {
        hasEditStack: Boolean(target?.hasEditStack),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews"),
        versionCount: Number(target?.editStackVersionCount || 0)
      };
    })).toEqual({ hasEditStack: false, hasRenderedPreview: false, versionCount: 0 });
    await expect(page.locator(".photo-bulk-bar")).toContainText("0 selected");

    await tileByFilename(page, "Undo target").getByRole("button", { name: /Open photo/ }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeHidden();
    await expect(lightbox.locator(".photos-info-inspector")).not.toContainText("Edits");
    await lightbox.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => page.evaluate(() => window.sessionStorage.getItem("vintrace.photos.session.lightboxZoom"))).toBe("1.25");
    await expect(lightbox).toContainText("125%");
    await lightbox.getByRole("button", { name: "Fill" }).click();
    await expect.poll(async () => page.evaluate(() => window.sessionStorage.getItem("vintrace.photos.session.lightboxFitMode"))).toBe("fill");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    await tileByFilename(page, "Undo target").getByRole("button", { name: /Open photo/ }).click();
    await expect(lightbox).toContainText("125%");
    await expect(lightbox.getByRole("button", { name: "Fit" })).toBeVisible();
    await page.keyboard.press("=");
    await expect.poll(async () => page.evaluate(() => window.sessionStorage.getItem("vintrace.photos.session.lightboxZoom"))).toBe("1.45");
    await expect(lightbox).toContainText("145%");
    await page.keyboard.press("0");
    await expect.poll(async () => page.evaluate(() => window.sessionStorage.getItem("vintrace.photos.session.lightboxZoom"))).toBe("1");
    await expect(lightbox).toContainText("100%");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await tileByFilename(page, "Undo target").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Delete", exact: true }).click();
    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("Moved to Recently Deleted 1 photo");
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("Type: visibility_delete");
    await expect(operationDetails).toContainText("Affected: 1");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      all: 1,
      recentlyDeleted: 1
    }));
    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const repairCenter = page.getByRole("region", { name: "Photos repair center" });
    await repairCenter.getByRole("button", { name: "Restore rehearsal" }).click();
    await expect(repairCenter).toContainText(/Restore rehearsal: [1-9]\d* operation/, { timeout: 20_000 });
    const restoreDetails = repairCenter.locator(".photo-restore-rehearsal-details");
    await restoreDetails.locator("summary").click();
    await expect(restoreDetails).toContainText("Operation: visibility_delete");
    await expect(restoreDetails).toContainText("Undo kind: metadata");
    await expect(restoreDetails).toContainText("metadata_only");
    await expect(restoreDetails).toContainText("Catalog: restorable");
    await expect(restoreDetails).toContainText("Original: restorable");
    await repairCenter.locator(".photo-repair-center-actions").getByRole("button", { name: "Backup rehearsal" }).click();
    await expect(repairCenter).toContainText(/Backup rehearsal: .*blockers/, { timeout: 30_000 });
    const backupDetails = repairCenter.locator(".photo-backup-restore-details");
    await backupDetails.locator("summary").click();
    await expect(backupDetails).toContainText("Photos library readiness");
    await expect(backupDetails).toContainText("Check: photos-readiness");
    await expect(backupDetails).toContainText("Severity: error");
    await expect(backupDetails).toContainText("Referenced originals");

    await page.locator(".photo-operation-undo").getByRole("button", { name: "Undo" }).click();
    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "Undo target")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      all: 2,
      recentlyDeleted: 0
    }));

    await tileByFilename(page, "Undo target").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Hide" }).click();
    await expect(page.locator(".photo-operation-undo")).toContainText("Hid 1 photo");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      all: 1,
      hidden: 1
    }));

    await page.locator(".photos-rail").getByText("Hidden", { exact: true }).click();
    await expect(page.locator(".photo-sensitive-lock")).toContainText("Hidden is locked");
    await expect(tileByFilename(page, "Undo target")).toHaveCount(0);
    await expect(page.locator(".photo-bulk-bar")).toHaveCount(0);
    await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    await expect(tileByFilename(page, "Undo target")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".photo-bulk-bar")).toBeVisible();
    await page.locator(".photo-rail-display-controls").getByRole("button", { name: "Unlocked" }).click();
    await expect(page.locator(".photo-sensitive-lock")).toContainText("Hidden is locked");
    await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    await expect(tileByFilename(page, "Undo target")).toBeVisible({ timeout: 20_000 });

    await page.locator(".photo-operation-undo").getByRole("button", { name: "Undo" }).click();
    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "Undo target")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      all: 2,
      hidden: 0
    }));
    const sensitiveLockToggle = page.locator(".photo-rail-display-controls").getByRole("button", { name: "Unlocked" });
    if (await sensitiveLockToggle.isVisible().catch(() => false)) {
      await sensitiveLockToggle.click();
    }

    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const page = await crossAge.invoke<{ items: Array<{ sourcePath: string; title?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        visibility: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = page.items.find((item) => String(item.title || "").includes("Undo target")) || page.items[0];
      const recent = page.items.find((item) => item.sourcePath !== target?.sourcePath) || page.items[1];
      if (!target || !recent) throw new Error("Missing retention cleanup fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: target.sourcePath,
        title: "Retention old",
        hidden: false,
        deletedAt: "2000-01-01T00:00:00Z"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: recent.sourcePath,
        title: "Retention recent",
        hidden: false,
        deletedAt: new Date().toISOString()
      });
    });

    await page.getByLabel("Visibility filter").selectOption("deleted");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recentlyDeleted: 2
    }));
    await expect(page.locator(".photo-sensitive-lock")).toContainText("Recently Deleted is locked");
    await expect(tileByFilename(page, "Retention old")).toHaveCount(0);
    await expect(page.locator(".photo-bulk-bar")).toHaveCount(0);
    await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    await expect(tileByFilename(page, "Retention old")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".photo-retention-control")).toBeVisible();
    await page.locator(".photo-retention-control input").fill("30");
    await page.getByRole("button", { name: "Delete older" }).click();
    const confirmDeleteOlder = page.getByRole("dialog", { name: "Delete older photos" });
    await expect(confirmDeleteOlder).toBeVisible();
    await confirmDeleteOlder.getByRole("button", { name: "Delete older" }).click();
    await expect(page.locator(".photo-retention-control")).toContainText("Deleted 1 photo.");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recentlyDeleted: 1
    }));
    await expect(tileByFilename(page, "Retention old")).toHaveCount(0);
    await expect(tileByFilename(page, "Retention recent")).toBeVisible({ timeout: 20_000 });

    await page.evaluate(async ({ missingPath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [missingPath],
        storageMode: "referenced",
        sourceKind: "mail",
        sourceLabel: "Recovered E2E missing media",
        sourceDetail: "Mail from qa@example.test"
      });
    }, { missingPath: path.join(media, "missing-recovered.jpg") });
    await page.getByRole("button", { name: "Refresh albums" }).click();
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recovered: 1
    }));
    await page.locator(".photos-rail").getByText("Recovered", { exact: true }).click();
    const recoveredPanel = page.locator(".photo-recovered-panel");
    await expect(recoveredPanel).toContainText("missing-recovered.jpg", { timeout: 20_000 });
    await expect(recoveredPanel).toContainText("Import: Recovered E2E missing media");
    await expect(recoveredPanel).toContainText("Recovered source: Mail · Reference originals · Mail from qa@example.test");
    await recoveredPanel.getByRole("button", { name: "Dismiss" }).click();
    await expect(recoveredPanel).toContainText("No recovered import issues.");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      recovered: 0
    }));
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Recently Deleted permanent delete and lightbox restore stay recoverable", async () => {
  test.setTimeout(120_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-deleted-actions-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["bulk-delete.png", "lightbox-restore.png", "lightbox-delete.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Recently Deleted actions E2E media"
      });
      const titles: Record<string, string> = {
        "bulk-delete.png": "Bulk permanent delete",
        "lightbox-restore.png": "Lightbox restore",
        "lightbox-delete.png": "Lightbox permanent delete"
      };
      for (const sourcePath of imported.value.importedPaths || []) {
        const filename = String(sourcePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title: titles[filename] || filename,
          deletedAt: "2026-06-28T00:00:00Z"
        });
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await page.getByLabel("Visibility filter").selectOption("deleted");
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 0,
      recentlyDeleted: 3
    }));
    await expect(page.locator(".photo-sensitive-lock")).toContainText("Recently Deleted is locked");
    await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    await expect(tileByFilename(page, "Bulk permanent delete")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Lightbox restore")).toBeVisible();
    await expect(tileByFilename(page, "Lightbox permanent delete")).toBeVisible();

    await tileByFilename(page, "Bulk permanent delete").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Delete permanently" }).click();
    const bulkDeleteConfirm = page.getByRole("dialog", { name: "Delete permanently" });
    await expect(bulkDeleteConfirm).toContainText("Permanently remove selected photos");
    await bulkDeleteConfirm.getByRole("button", { name: "Delete permanently" }).click();
    await expect(tileByFilename(page, "Bulk permanent delete")).toHaveCount(0);
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 0,
      recentlyDeleted: 2
    }));
    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("Permanently deleted 1 photo from catalog");
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("Type: catalog_permanent_delete");
    await expect(operationDetails).toContainText("bulk-delete.png");
    await operationUndo.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 0,
      recentlyDeleted: 3
    }));
    await expect(tileByFilename(page, "Bulk permanent delete")).toBeVisible({ timeout: 20_000 });

    await tileByFilename(page, "Lightbox restore").getByRole("button", { name: /Open photo/ }).click();
    const restoreLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(restoreLightbox).toContainText("Lightbox restore");
    await restoreLightbox.getByRole("button", { name: "Restore" }).click();
    await expect(restoreLightbox).toHaveCount(0);
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 1,
      recentlyDeleted: 2
    }));
    await expect(tileByFilename(page, "Lightbox restore")).toHaveCount(0);
    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.getByLabel("Visibility filter").selectOption("all");
    await expect(tileByFilename(page, "Lightbox restore")).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Visibility filter").selectOption("deleted");
    if (await page.locator(".photo-sensitive-lock").isVisible().catch(() => false)) {
      await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    }
    await expect(tileByFilename(page, "Lightbox permanent delete")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Lightbox permanent delete").getByRole("button", { name: /Open photo/ }).click();
    const deleteLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(deleteLightbox).toContainText("Lightbox permanent delete");
    await deleteLightbox.getByRole("button", { name: "Delete permanently" }).click();
    const lightboxDeleteConfirm = page.getByRole("dialog", { name: "Delete permanently" });
    await expect(lightboxDeleteConfirm).toContainText("Permanently remove this photo");
    await lightboxDeleteConfirm.getByRole("button", { name: "Delete permanently" }).click();
    await expect(deleteLightbox).toHaveCount(0);
    await expect(tileByFilename(page, "Lightbox permanent delete")).toHaveCount(0);
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 1,
      recentlyDeleted: 1
    }));
    await expect(page.locator(".photo-operation-undo")).toContainText("Permanently deleted 1 photo from catalog");
    expect(existsSync(path.join(media, "bulk-delete.png"))).toBe(true);
    expect(existsSync(path.join(media, "lightbox-delete.png"))).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos lightbox related media can add relink remove and ignore generated pairs", async () => {
  test.setTimeout(120_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-related-media-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["manual-author.png", "generated-pair.jpg"]);
  const manualPrimary = path.join(media, "manual-author.png");
  const generatedPrimary = path.join(media, "generated-pair.jpg");
  const manualRelated = path.join(media, "manual-related.dng");
  const manualReplacement = path.join(media, "manual-replacement.dng");
  const generatedRelated = path.join(media, "generated-pair.dng");
  writeFileSync(manualRelated, Buffer.from("manual related raw sidecar\n", "utf8"));
  writeFileSync(manualReplacement, Buffer.from("manual replacement raw sidecar\n", "utf8"));
  writeFileSync(generatedRelated, Buffer.from("generated adjacent raw sidecar\n", "utf8"));

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await app.evaluate(({ ipcMain }, payload) => {
      const paths = Array.isArray((payload as { paths?: unknown[] }).paths) ? (payload as { paths: unknown[] }).paths.map((item) => String(item || "")) : [];
      let index = 0;
      ipcMain.removeHandler("dialog:choose-images");
      ipcMain.handle("dialog:choose-images", async () => {
        const sourcePath = paths[Math.min(index, Math.max(0, paths.length - 1))] || "";
        index += 1;
        return sourcePath ? [{ path: sourcePath }] : [];
      });
    }, { paths: [manualRelated, manualReplacement] });

    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as any;
      holder.__relatedMediaRevealPaths = [];
      holder.__relatedMediaOpenPaths = [];
      holder.__relatedMediaSharePaths = [];
      ipcMain.removeHandler("shell:reveal-path");
      ipcMain.handle("shell:reveal-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__relatedMediaRevealPaths.push(String(record.path || ""));
        return true;
      });
      ipcMain.removeHandler("shell:open-path");
      ipcMain.handle("shell:open-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__relatedMediaOpenPaths.push(String(record.path || ""));
        return { ok: true, path: String(record.path || "") };
      });
      ipcMain.removeHandler("shell:share-paths");
      ipcMain.handle("shell:share-paths", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { paths?: unknown } : {};
        const paths = Array.isArray(record.paths) ? record.paths.map((item) => String(item || "")) : [];
        holder.__relatedMediaSharePaths.push(paths);
        return { ok: true, supported: true, shared: true, count: paths.length, filePaths: paths };
      });
    });

    await page.evaluate(async ({ manualPrimaryPath, generatedPrimaryPath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [manualPrimaryPath, generatedPrimaryPath],
        storageMode: "referenced",
        sourceLabel: "Related media E2E media"
      });
      for (const sourcePath of imported.value.importedPaths || []) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title: /generated-pair\.jpg$/.test(sourcePath) ? "Generated media pair" : "Manual media pair"
        });
      }
    }, { manualPrimaryPath: manualPrimary, generatedPrimaryPath: generatedPrimary });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Manual media pair")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Manual media pair").getByRole("button", { name: /Open photo/ }).click();
    const manualLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    const manualRelatedRow = manualLightbox.locator(".photos-related-media-row");
    await manualRelatedRow.scrollIntoViewIfNeeded();
    await manualRelatedRow.getByLabel("Related media kind").selectOption("raw_sidecar");
    await manualRelatedRow.locator(".photos-related-media-author").getByRole("button", { name: "Add" }).click();
    await expect(manualRelatedRow).toContainText("Related media added.");
    await expect(manualRelatedRow).toContainText("RAW sidecar");
    await expect(manualRelatedRow).toContainText("manual-related.dng");
    await expect(manualRelatedRow).toContainText("Available");
    await expect(manualRelatedRow).toContainText("Added");

    const manualRelatedItem = manualRelatedRow.locator(".photos-related-media-item").filter({ hasText: "manual-related.dng" });
    await manualRelatedItem.getByRole("button", { name: "Reveal" }).click();
    await manualRelatedItem.getByRole("button", { name: "Open" }).click();
    await manualRelatedItem.getByRole("button", { name: "Share" }).click();

    await manualRelatedItem.getByRole("button", { name: "Relink" }).click();
    await expect(manualRelatedRow).toContainText("Related media relinked.");
    await expect(manualRelatedRow).toContainText("manual-replacement.dng");
    await expect(manualRelatedRow).toContainText("Relinked");

    await manualRelatedRow.locator(".photos-related-media-item").filter({ hasText: "manual-replacement.dng" }).getByRole("button", { name: "Remove" }).click();
    const removeRelatedMedia = page.getByRole("dialog", { name: "Remove related media" });
    await expect(removeRelatedMedia).toContainText("Remove RAW sidecar");
    await removeRelatedMedia.getByRole("button", { name: "Remove" }).click();
    await expect(manualRelatedRow).toContainText("Related media removed.");
    await expect(manualRelatedRow.locator(".photos-related-media-item")).toHaveCount(0);
    await manualLightbox.getByRole("button", { name: "Close" }).click();
    await expect(manualLightbox).toHaveCount(0);

    await expect(tileByFilename(page, "Generated media pair")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Generated media pair").getByRole("button", { name: /Open photo/ }).click();
    const generatedLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    const generatedRelatedRow = generatedLightbox.locator(".photos-related-media-row");
    await generatedRelatedRow.scrollIntoViewIfNeeded();
    await expect(generatedRelatedRow).toContainText("generated-pair.dng");
    await expect(generatedRelatedRow).toContainText("RAW sidecar");
    const generatedRelatedItem = generatedRelatedRow.locator(".photos-related-media-item").filter({ hasText: "generated-pair.dng" });
    await generatedRelatedItem.getByRole("button", { name: "Reveal" }).click();
    await generatedRelatedItem.getByRole("button", { name: "Open" }).click();
    await generatedRelatedItem.getByRole("button", { name: "Share" }).click();
    await generatedRelatedItem.getByRole("button", { name: "Ignore" }).click();
    const ignoreGenerated = page.getByRole("dialog", { name: "Ignore generated related media" });
    await expect(ignoreGenerated).toContainText("Future scans will not recreate this generated row");
    await ignoreGenerated.getByRole("button", { name: "Ignore" }).click();
    await expect(generatedRelatedRow).toContainText("Generated related media ignored.");
    await expect(generatedRelatedRow.locator(".photos-related-media-item")).toHaveCount(0);
    await generatedLightbox.getByRole("button", { name: "Close" }).click();

    const relatedShellActions = await app.evaluate(() => {
      const holder = globalThis as any;
      return {
        reveal: holder.__relatedMediaRevealPaths || [],
        open: holder.__relatedMediaOpenPaths || [],
        share: holder.__relatedMediaSharePaths || []
      };
    });
    expect(relatedShellActions.reveal.map((item: string) => path.basename(item))).toEqual(expect.arrayContaining(["manual-related.dng", "generated-pair.dng"]));
    expect(relatedShellActions.open.map((item: string) => path.basename(item))).toEqual(expect.arrayContaining(["manual-related.dng", "generated-pair.dng"]));
    expect(relatedShellActions.share.flat().map((item: string) => path.basename(item))).toEqual(expect.arrayContaining(["manual-related.dng", "generated-pair.dng"]));

    await page.evaluate(async ({ generatedPrimaryPath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [generatedPrimaryPath],
        storageMode: "referenced",
        sourceLabel: "Related media E2E resync"
      });
    }, { generatedPrimaryPath: generatedPrimary });
    await page.getByRole("button", { name: "Refresh albums" }).click();
    await expect(tileByFilename(page, "Generated media pair")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Generated media pair").getByRole("button", { name: /Open photo/ }).click();
    const resyncedLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(resyncedLightbox.locator(".photos-related-media-item")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos related media missing companion repair clears backup warning", async () => {
  test.setTimeout(120_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-related-media-repair-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["missing-companion.jpg"]);
  const primary = path.join(media, "missing-companion.jpg");
  const generatedRelated = path.join(media, "missing-companion.dng");
  const replacementRelated = path.join(media, "missing-companion-replacement.dng");
  writeFileSync(generatedRelated, Buffer.from("generated companion before loss\n", "utf8"));
  writeFileSync(replacementRelated, Buffer.from("replacement companion after repair\n", "utf8"));

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await app.evaluate(({ ipcMain }, sourcePath) => {
      ipcMain.removeHandler("dialog:choose-images");
      ipcMain.handle("dialog:choose-images", async () => [{ path: String(sourcePath || "") }]);
    }, replacementRelated);

    await page.evaluate(async ({ primaryPath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [primaryPath],
        storageMode: "referenced",
        sourceLabel: "Related media repair E2E media"
      });
      const sourcePath = imported.value.importedPaths?.[0] || primaryPath;
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath,
        title: "Missing companion repair"
      });
    }, { primaryPath: primary });
    unlinkSync(generatedRelated);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Missing companion repair")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Missing companion repair").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    const relatedRow = lightbox.locator(".photos-related-media-row");
    await relatedRow.scrollIntoViewIfNeeded();
    await expect(relatedRow).toContainText("missing-companion.dng");
    await expect(relatedRow).toContainText("Missing");
    const missingRelatedItem = relatedRow.locator(".photos-related-media-item").filter({ hasText: "missing-companion.dng" });
    await expect(missingRelatedItem.getByRole("button", { name: "Reveal" })).toBeDisabled();
    await expect(missingRelatedItem.getByRole("button", { name: "Open" })).toBeDisabled();
    await expect(missingRelatedItem.getByRole("button", { name: "Share" })).toBeDisabled();
    await lightbox.getByRole("button", { name: "Close" }).click();

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const backupReadiness = page.getByRole("region", { name: "Backup readiness" });
    await backupReadiness.getByRole("button", { name: "Backup check" }).click();
    const repairCenter = page.getByRole("region", { name: "Photos repair center" });
    await expect(repairCenter.getByText("Media pair files", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(repairCenter).toContainText("1 companion file missing");

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "Missing companion repair")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Missing companion repair").getByRole("button", { name: /Open photo/ }).click();
    const repairLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    const repairRelatedRow = repairLightbox.locator(".photos-related-media-row");
    await repairRelatedRow.scrollIntoViewIfNeeded();
    await repairRelatedRow.locator(".photos-related-media-item").filter({ hasText: "missing-companion.dng" }).getByRole("button", { name: "Relink" }).click();
    await expect(repairRelatedRow).toContainText("Related media relinked.");
    await expect(repairRelatedRow).toContainText("missing-companion-replacement.dng");
    await expect(repairRelatedRow).toContainText("Available");
    await repairLightbox.getByRole("button", { name: "Close" }).click();

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    await backupReadiness.getByRole("button", { name: "Backup check" }).click();
    await expect(repairCenter.getByText("Media pair files", { exact: true })).toHaveCount(0);
    await expect(backupReadiness).toContainText("Ready", { timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosVirtualizedGridWorkspaceScroll(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const photoCount = 100;
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, String.raw`
import json
import sys
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.workspace_registry import now_iso

workspace = Path(sys.argv[1])
count = int(sys.argv[2])
api = DesktopApi(workspace, actor="virtual-grid-scroll-seed")
timestamp = now_iso()
asset_rows = []
metadata_rows = []
for index in range(count):
    name = f"scroll-{index:04d}.jpg"
    asset_id = f"virtual_scroll_{index:04d}"
    source_path = f"/synthetic/no-photo-used/virtual-scroll/{name}"
    asset_rows.append((
        asset_id,
        source_path,
        "referenced",
        json.dumps({"pathKey": source_path, "size": 2048 + index, "mtimeNs": 1800001000000000000 + index}, separators=(",", ":")),
        f"virtual-scroll-hash-{index:04d}",
        "",
        "image",
        "image/jpeg",
        1200,
        900,
        None,
        "2026-06-20T12:00:00Z",
        timestamp,
        timestamp,
        None,
        "virtual-grid-scroll",
        json.dumps({}, separators=(",", ":")),
    ))
    metadata_rows.append((
        asset_id,
        name,
        "Synthetic browser virtual-scroll row",
        0,
        0,
        None,
        None,
        None,
        0,
        0,
        timestamp,
    ))
with api.project.db.connect() as conn:
    conn.executemany(
        """
        INSERT OR REPLACE INTO photo_assets(
            asset_id, source_path, source_kind, file_signature_json, content_hash,
            perceptual_hash, media_kind, mime_type, width, height, duration_ms,
            capture_date, added_at, updated_at, missing_at, source_scan_run,
            metadata_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        asset_rows,
    )
    conn.executemany(
        """
        INSERT OR REPLACE INTO photo_asset_metadata(
            asset_id, title, caption, favorite, hidden, deleted_at, date_override,
            location_override_json, location_hidden, edited, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        metadata_rows,
    )
    api.project.db.rebuild_photo_search_index(conn)
`, [workspace, String(photoCount)]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const photosNavButton = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Library" });
    await photosNavButton.scrollIntoViewIfNeeded();
    await photosNavButton.click();
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
    }
    const sortSelect = page.getByLabel("Sort photos");
    await sortSelect.selectOption("filename");
    await expect(sortSelect).toHaveValue("filename");
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toContain("scroll-0000.jpg");
    const initialVisible = await visiblePhotoTileFilenames(page);
    expect(initialVisible.length).toBeGreaterThan(0);
    expect(initialVisible.length).toBeLessThan(photoCount);
    expect(initialVisible).not.toContain("scroll-0099.jpg");

    await page.evaluate(() => {
      const workspaceNode = document.querySelector<HTMLElement>(".workspace");
      if (!workspaceNode) throw new Error("Missing workspace scroll container");
      workspaceNode.scrollTop = workspaceNode.scrollHeight;
      workspaceNode.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toContain("scroll-0099.jpg");
    const bottomVisible = await visiblePhotoTileFilenames(page);
    expect(bottomVisible.length).toBeGreaterThan(0);
    expect(bottomVisible.length).toBeLessThan(photoCount);
    expect(bottomVisible).not.toContain("scroll-0000.jpg");
    const bottomScroll = await photoWorkspaceScrollState(page);
    expect(bottomScroll.scrollTop).toBeGreaterThan(0);
    expect(bottomScroll.scrollHeight).toBeGreaterThan(bottomScroll.clientHeight);

    await page.evaluate(() => {
      const workspaceNode = document.querySelector<HTMLElement>(".workspace");
      if (!workspaceNode) throw new Error("Missing workspace scroll container");
      workspaceNode.scrollTop = 0;
      workspaceNode.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toContain("scroll-0000.jpg");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos virtualized grid follows workspace scroll for larger libraries", async () => {
  test.setTimeout(120_000);
  await exercisePhotosVirtualizedGridWorkspaceScroll({ width: 900, height: 620 }, "vintrace-photos-virtual-scroll-");
});

test("Photos virtualized grid follows compact viewport workspace scroll", async () => {
  test.setTimeout(120_000);
  await exercisePhotosVirtualizedGridWorkspaceScroll({ width: 390, height: 740 }, "vintrace-photos-virtual-scroll-compact-");
});

test("Photos shortcut discovery panel covers keyboard and restore routes", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-shortcuts-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["shortcut-alpha.png", "shortcut-beta.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const commandKey = process.platform === "darwin" ? "Meta" : "Control";
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const dispatchCommandShortcut = (key: string) => page.evaluate(({ shortcutKey, modKey }) => {
    const event = new KeyboardEvent("keydown", {
      key: shortcutKey,
      metaKey: modKey === "Meta",
      ctrlKey: modKey === "Control",
      bubbles: true,
      cancelable: true
    });
    (document.body || window).dispatchEvent(event);
  }, { shortcutKey: key, modKey: commandKey });

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Shortcut E2E media"
      });
      for (const sourcePath of imported.value.importedPaths || []) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title: /shortcut-alpha\.png$/.test(sourcePath)
            ? "Shortcut alpha"
            : "Shortcut beta"
        });
      }
      await crossAge.invoke("save_photo_keyword", { name: "Browser Tag", shortcut: "Shift+B" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Shortcut alpha")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Shortcut beta")).toBeVisible();
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      all: 2,
      favorites: 0
    }));

    await page.getByRole("button", { name: "Shortcuts" }).click();
    const shortcutPanel = page.locator(".photos-shortcut-panel");
    await expect(shortcutPanel).toBeVisible();
    await expect(shortcutPanel).toContainText("Photos shortcuts");
    await expect(shortcutPanel).toContainText("Search photos");
    await expect(shortcutPanel).toContainText("Cmd/Ctrl-F");
    await expect(shortcutPanel).toContainText("Image Edit");
    await expect(shortcutPanel).toContainText("Browser Tag");
    await expect(shortcutPanel).toContainText("Shift+B");
    await shortcutPanel.getByRole("button", { name: "Close shortcuts" }).click();
    await expect(shortcutPanel).toHaveCount(0);

    await page.keyboard.press("Shift+/");
    await expect(shortcutPanel).toBeVisible();
    await page.keyboard.press("Shift+/");
    await expect(shortcutPanel).toHaveCount(0);

    const searchBox = page.getByLabel("Search photos");
    await searchBox.focus();
    await page.keyboard.press("Shift+/");
    await expect(shortcutPanel).toHaveCount(0);
    await expect(searchBox).toHaveValue(/^[/?]$/);
    await searchBox.fill("");

    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await page.keyboard.press(`${commandKey}+F`);
    await expect(searchBox).toBeFocused();
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await dispatchCommandShortcut("a");
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");
    await page.keyboard.press("f");
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      favorites: 2
    }));

    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Clear page" }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("0 selected");
    await tileByFilename(page, "Shortcut alpha").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await dispatchCommandShortcut("i");
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(page.getByRole("dialog", { name: /Shortcut alpha/ })).toBeVisible();
    await expect(lightbox.locator(".photos-info-inspector")).toBeFocused();
    await lightbox.getByLabel("Title").fill("Shortcut alpha polished");
    await lightbox.getByLabel("Caption").fill("Keyboard browser caption");
    await lightbox.getByRole("button", { name: "Save info" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ title?: string; caption?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "Shortcut alpha polished");
      return { title: String(target?.title || ""), caption: String(target?.caption || "") };
    }), { timeout: 20_000 }).toEqual({ title: "Shortcut alpha polished", caption: "Keyboard browser caption" });
    await expect(page.getByRole("dialog", { name: /Shortcut alpha polished/ })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: /Shortcut beta/ })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("dialog", { name: /Shortcut alpha polished/ })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("h");
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 1,
      hidden: 1
    }));
    if (await lightbox.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await expect(lightbox).toHaveCount(0);
    await tileByFilename(page, "Shortcut alpha polished").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await expect(page.locator(".photo-bulk-bar").getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 0,
      hidden: 1,
      recentlyDeleted: 1
    }));

    await page.locator(".photos-rail").getByText("Recently Deleted", { exact: true }).click();
    await expect(page.locator(".photo-sensitive-lock")).toContainText("Recently Deleted is locked");
    await page.locator(".photo-sensitive-lock").getByRole("button", { name: "Unlock" }).click();
    await expect(tileByFilename(page, "Shortcut alpha polished")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Shortcut alpha polished").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Restore", exact: true }).click();
    await expect.poll(async () => photoFolderCounts(page), { timeout: 20_000 }).toEqual(expect.objectContaining({
      all: 1,
      hidden: 1,
      recentlyDeleted: 0
    }));
    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "Shortcut alpha polished")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Shortcut beta")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos keyword manager shortcuts chips and bulk apply work", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-keywords-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["keyword-alpha.png", "keyword-beta.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const keywordsByTitle = () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ items: Array<{ title?: string; keywords?: string[] }> }>("list_photo_folder_items", {
      folderId: "all",
      previewBudget: 0,
      limit: 10
    });
    return Object.fromEntries(result.items.map((item) => [String(item.title || ""), item.keywords || []]));
  });

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Keyword workflow E2E media"
      });
      for (const sourcePath of imported.value.importedPaths || []) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title: /keyword-alpha\.png$/.test(sourcePath) ? "Keyword alpha" : "Keyword beta"
        });
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Keyword alpha")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Keyword beta")).toBeVisible();

    await page.getByRole("button", { name: "Keyword manager" }).click();
    await expect(page.locator(".photos-keyword-panel")).toBeVisible();
    await page.getByLabel("New keyword name").fill("Browser Blue");
    await page.getByLabel("New keyword shortcut").fill("Shift+B");
    await page.getByRole("button", { name: "Create keyword" }).click();
    await expect(page.getByLabel("Keyword Browser Blue")).toHaveValue("Browser Blue", { timeout: 20_000 });
    await page.locator(".photos-keyword-panel").getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".photos-keyword-panel")).toHaveCount(0);

    await tileByFilename(page, "Keyword alpha").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.keyboard.press("Shift+B");
    await expect.poll(keywordsByTitle, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "Keyword alpha": ["Browser Blue"],
      "Keyword beta": []
    }));

    const keywordStrip = page.locator(".photo-keyword-filter-strip");
    await expect(keywordStrip).toContainText("Browser Blue", { timeout: 20_000 });
    await keywordStrip.getByRole("button", { name: /Browser Blue/ }).click();
    await expect(tileByFilename(page, "Keyword alpha")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Keyword beta")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(tileByFilename(page, "Keyword beta")).toBeVisible({ timeout: 20_000 });

    await tileByFilename(page, "Keyword beta").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.getByLabel("Bulk keywords").fill("Browser Blue");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Add keywords" }).click();
    await expect.poll(keywordsByTitle, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "Keyword alpha": ["Browser Blue"],
      "Keyword beta": ["Browser Blue"]
    }));
    await expect(keywordStrip.getByRole("button", { name: /Browser Blue/ })).toContainText("2", { timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos keyword vocabulary import export round trips", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-keyword-transfer-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["keyword-transfer.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Keyword transfer E2E media"
      });
      await crossAge.invoke("save_photo_keyword", { name: "Browser Alpha", shortcut: "A" });
      await crossAge.invoke("save_photo_keyword", { name: "Browser Beta", shortcut: "Shift+B" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "keyword-transfer.png")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Keyword manager" }).click();
    await expect(page.locator(".photos-keyword-panel")).toBeVisible();
    await expect(page.getByLabel("Keyword Browser Alpha")).toHaveValue("Browser Alpha", { timeout: 20_000 });
    await expect(page.getByLabel("Shortcut Browser Beta")).toHaveValue("Shift+B");

    await page.getByRole("button", { name: "Export keywords" }).click();
    const transferStatus = page.locator(".photos-keyword-transfer-status");
    await expect(transferStatus).toContainText("Exported keywords", { timeout: 20_000 });
    const exportPath = ((await transferStatus.textContent()) || "").split(" · ").pop()?.trim() || "";
    expect(exportPath).toContain("vintrace-photo-keywords-");
    const exportedJson = readFileSync(exportPath, "utf8");
    const exportedPayload = JSON.parse(exportedJson) as { format?: string; keywords?: Array<{ name?: string; shortcut?: string }> };
    expect(exportedPayload.format).toBe("vintrace-photo-keywords-v1");
    expect(exportedPayload.keywords?.map((keyword) => [keyword.name, keyword.shortcut])).toEqual([
      ["Browser Alpha", "A"],
      ["Browser Beta", "Shift+B"]
    ]);

    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const listed = await crossAge.invoke<{ value: { keywords: Array<{ keywordId: string; name: string }> } }>("list_photo_keywords", {});
      const alpha = listed.value.keywords.find((keyword) => keyword.name === "Browser Alpha");
      if (alpha) await crossAge.invoke("delete_photo_keyword", { keywordId: alpha.keywordId });
      await crossAge.invoke("save_photo_keyword", { name: "Browser Beta", shortcut: "Old" });
    });

    await page.getByLabel("Keyword import JSON").fill(exportedJson);
    await page.getByRole("button", { name: "Import keywords" }).click();
    await expect(transferStatus).toContainText("Imported keywords: 2", { timeout: 20_000 });
    await expect(transferStatus).toContainText("Created 1");
    await expect(transferStatus).toContainText("Updated 1");
    await expect(page.getByLabel("Keyword Browser Alpha")).toHaveValue("Browser Alpha", { timeout: 20_000 });
    await expect(page.getByLabel("Shortcut Browser Alpha")).toHaveValue("A");
    await expect(page.getByLabel("Shortcut Browser Beta")).toHaveValue("Shift+B");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos bulk date and timezone controls update selected photos", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-bulk-dates-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["bulk-date-alpha.png", "bulk-date-beta.png", "bulk-date-gamma.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Bulk date E2E media"
      });
      for (const sourcePath of imported.value.importedPaths || []) {
        if (/bulk-date-alpha\.png$/.test(sourcePath)) {
          await crossAge.invoke("update_photo_asset_metadata", {
            sourcePath,
            title: "Bulk Date Alpha",
            dateOverride: "2026-06-20T09:30:00Z"
          });
        } else if (/bulk-date-beta\.png$/.test(sourcePath)) {
          await crossAge.invoke("update_photo_asset_metadata", {
            sourcePath,
            title: "Bulk Date Beta",
            dateOverride: "2026-06-21T10:45:00Z"
          });
        } else if (/bulk-date-gamma\.png$/.test(sourcePath)) {
          await crossAge.invoke("update_photo_asset_metadata", {
            sourcePath,
            title: "Bulk Date Gamma",
            dateOverride: "2026-06-22T11:15:00Z"
          });
        }
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Bulk Date Alpha")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Bulk Date Beta")).toBeVisible();
    await tileByFilename(page, "Bulk Date Alpha").locator(".photo-select-box").click();
    await tileByFilename(page, "Bulk Date Beta").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    await page.getByLabel("Date offset days").fill("2");
    await page.getByRole("button", { name: "Shift dates" }).click();
    await expect(page.locator(".photo-operation-undo")).toContainText("Offset selected dates", { timeout: 20_000 });
    await expect.poll(async () => photoDateOverridesByTitle(page, ["Bulk Date Alpha", "Bulk Date Beta", "Bulk Date Gamma"]), { timeout: 20_000 }).toEqual({
      "Bulk Date Alpha": "2026-06-22T09:30:00.000Z",
      "Bulk Date Beta": "2026-06-23T10:45:00.000Z",
      "Bulk Date Gamma": "2026-06-22T11:15:00Z",
    });
    await expect(page.getByLabel("Date offset days")).toHaveValue("0");

    await page.getByLabel("Bulk timezone offset").fill("+05:30");
    await page.getByRole("button", { name: "Set timezone" }).click();
    await expect(page.locator(".photo-operation-undo")).toContainText("Corrected selected timezones", { timeout: 20_000 });
    await expect.poll(async () => photoDateOverridesByTitle(page, ["Bulk Date Alpha", "Bulk Date Beta", "Bulk Date Gamma"]), { timeout: 20_000 }).toEqual({
      "Bulk Date Alpha": "2026-06-22T09:30:00+05:30",
      "Bulk Date Beta": "2026-06-23T10:45:00+05:30",
      "Bulk Date Gamma": "2026-06-22T11:15:00Z",
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosDuplicateReview(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  mkdirSync(media, { recursive: true });
  writeFileSync(path.join(media, "dup-alpha.png"), ONE_PIXEL_PNG);
  writeFileSync(path.join(media, "dup-beta.png"), ONE_PIXEL_PNG);
  writeFileSync(path.join(media, "dismiss-alpha.png"), MARKUP_TEST_PNG);
  writeFileSync(path.join(media, "dismiss-beta.png"), MARKUP_TEST_PNG);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Duplicate review E2E media"
      });
      const beta = (imported.value.importedPaths || []).find((item) => /dup-beta\.png$/.test(item));
      if (!beta) throw new Error("Missing imported duplicate keep fixture");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: beta,
        title: "Browser duplicate keep",
        favorite: true
      });
    }, { mediaFolder: media });

    const photosNavButton = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Library" });
    await photosNavButton.scrollIntoViewIfNeeded();
    await photosNavButton.click();
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
    }
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      duplicates: 4
    }));
    await page.locator(".photos-rail").getByText("Duplicates", { exact: true }).click();
    await expect(tileByFilename(page, "dup-alpha.png")).toBeVisible({ timeout: 20_000 });
    const reviewPanel = page.locator(".photos-duplicate-review-panel");
    await expect(reviewPanel).toBeVisible();
    await expect(reviewPanel).toContainText("Duplicate review");
    await expect(reviewPanel).toContainText("Browser duplicate keep");
    await expect(reviewPanel).toContainText("Recommended keep");

    const dismissCard = reviewPanel.locator(".photos-duplicate-review-card").filter({ hasText: "dismiss-alpha.png" });
    await expect(dismissCard).toBeVisible();
    await dismissCard.getByRole("button", { name: "Dismiss", exact: true }).click();
    const dismissDialog = page.getByRole("dialog", { name: "Dismiss duplicate group" });
    await expect(dismissDialog).toBeVisible();
    await dismissDialog.getByRole("button", { name: "Dismiss group" }).click();
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      duplicates: 2
    }));
    await expect(reviewPanel).not.toContainText("dismiss-alpha.png");

    const alphaRow = reviewPanel.locator(".photos-duplicate-review-row").filter({ hasText: "dup-alpha.png" });
    await alphaRow.getByRole("button", { name: "Select", exact: true }).click();
    await expect(alphaRow.getByRole("button", { name: "Selected", exact: true })).toBeVisible();
    await expect(reviewPanel).toContainText("1 selected");

    await alphaRow.locator(".photos-duplicate-review-open").click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toContainText("Duplicate comparison");
    await expect(lightbox).toContainText("dup-beta.png");
    await expect(lightbox.locator(".photos-duplicate-visual-compare img")).toHaveCount(2);
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await page.keyboard.press("Control+Enter");
    await expect.poll(async () => photoFolderCounts(page)).toEqual(expect.objectContaining({
      duplicates: 0,
      recentlyDeleted: 1
    }));
    await expect(reviewPanel).toHaveCount(0);
    await expect(page.locator(".photo-operation-undo")).toContainText("Merged 1 duplicate photo");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos duplicate review panel opens, dismisses, selects, and merges loaded groups", async () => {
  await exercisePhotosDuplicateReview({ width: 900, height: 620 }, "vintrace-photos-duplicate-review-");
});

test("Photos duplicate review panel works in compact viewport", async () => {
  await exercisePhotosDuplicateReview({ width: 390, height: 740 }, "vintrace-photos-duplicate-review-compact-");
});

test("Photos copy and paste image edits across selected photos", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-copy-paste-edits-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["edit-source.png", "edit-target.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Copy paste edit E2E media"
      });
      for (const sourcePath of imported.value.importedPaths || []) {
        if (/edit-source\.png$/.test(sourcePath)) {
          await crossAge.invoke("update_photo_asset_metadata", { sourcePath, title: "edit-source" });
        }
        if (/edit-target\.png$/.test(sourcePath)) {
          await crossAge.invoke("update_photo_asset_metadata", { sourcePath, title: "edit-target" });
        }
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "edit-source")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "edit-source").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole("button", { name: "Rotate image edit" }).click();
    await lightbox.getByRole("button", { name: "Adjust image" }).click();
    await lightbox.getByLabel("Image exposure").evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "0.5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await lightbox.getByLabel("Image filter preset").selectOption("noir");
    await expect(lightbox).toContainText("R90 / Original / Adj E+0.5 / Filter Noir / No flip");
    await lightbox.getByRole("button", { name: "Copy image edits" }).click();
    await expect(lightbox).toContainText("Copied edits");
    await expect(lightbox.getByLabel("Image edit clipboard history")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const raw = window.localStorage.getItem("vintrace.photos.imageEditClipboardHistory") || "[]";
      const history = JSON.parse(raw) as Array<{ label?: string; operation?: Record<string, any> }>;
      return {
        count: history.length,
        label: history[0]?.label || "",
        filterPreset: history[0]?.operation?.filterPreset || "",
        exposure: history[0]?.operation?.adjustments?.exposure || 0
      };
    })).toEqual({
      count: 1,
      label: "R90 / Original / Adj E+0.5 / Filter Noir / No flip",
      filterPreset: "noir",
      exposure: 0.5
    });
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await tileByFilename(page, "edit-target").locator(".photo-select-box").click();
    await page.getByRole("button", { name: "Paste copied edits to selected photos" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string; previewPath?: string | null; edited?: boolean }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => /edit-target\.png$/.test(item.sourcePath));
      return {
        edited: Boolean(target?.edited),
        hasRenderedPreview: String(target?.previewPath || "").includes("photo-edit-previews")
      };
    })).toEqual({ edited: true, hasRenderedPreview: true });
    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => /edit-target\.png$/.test(item.sourcePath));
      if (!target) throw new Error("edit target not found");
      await crossAge.invoke("save_photo_edit_stack", {
        sourcePath: target.sourcePath,
        operations: [{
          kind: "image_crop_rotate",
          filterPreset: "vivid",
          adjustments: { exposure: -0.4, contrast: 0, saturation: 0, warmth: 0, sharpness: 0 },
          renderQuality: 88,
          renderMaxDimension: 1600,
          source: "e2e-target-base-filter"
        }]
      });
    });
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => /edit-target\.png$/.test(item.sourcePath));
      if (!target) return null;
      const stackResult = await crossAge.invoke<{ value: { stack?: { operations?: Array<Record<string, any>> }, operations?: Array<Record<string, any>> } }>("get_photo_edit_stack", {
        sourcePath: target.sourcePath
      });
      const stack = stackResult.value.stack || stackResult.value;
      const operation = (stack.operations || [])[0] || {};
      return {
        filterPreset: operation.filterPreset || "",
        exposure: operation.adjustments?.exposure || 0,
        source: operation.source || ""
      };
    })).toEqual({
      filterPreset: "vivid",
      exposure: -0.4,
      source: "e2e-target-base-filter"
    });
    await tileByFilename(page, "edit-target").locator(".photo-select-box input").check({ force: true });
    await page.getByRole("button", { name: "Paste copied adjustments to selected photos" }).click();
    const replaceAdjustments = page.getByRole("dialog", { name: "Replace existing adjustments?" });
    await expect(replaceAdjustments).toBeVisible();
    await expect(replaceAdjustments).toContainText("Pasting adjustments will replace those sliders");
    await expect(replaceAdjustments).toContainText("Copied adjustments: Adj E+0.5.");
    await replaceAdjustments.getByRole("button", { name: "Replace adjustments" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => /edit-target\.png$/.test(item.sourcePath));
      if (!target) return null;
      const stackResult = await crossAge.invoke<{ value: { stack?: { operations?: Array<Record<string, any>> }, operations?: Array<Record<string, any>> } }>("get_photo_edit_stack", {
        sourcePath: target.sourcePath
      });
      const stack = stackResult.value.stack || stackResult.value;
      const operation = (stack.operations || [])[0] || {};
      return {
        rotateDegrees: operation.rotateDegrees || 0,
        filterPreset: operation.filterPreset || "",
        exposure: operation.adjustments?.exposure || 0,
        source: operation.source || ""
      };
    })).toEqual({
      rotateDegrees: 0,
      filterPreset: "vivid",
      exposure: 0.5,
      source: "photos-bulk-adjustment-paste"
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual curve graph saves and reloads image adjustments", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-manual-curve-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["manual-curve-source.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Manual curve E2E media"
      });
      const target = (imported.value.importedPaths || []).find((item) => /manual-curve-source\.png$/.test(item));
      if (!target) throw new Error("manual curve source import missing");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: target, title: "manual-curve-source" });
      return { target };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "manual-curve-source")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "manual-curve-source").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole("button", { name: "Adjust image" }).click();
    const curveGraph = lightbox.getByLabel("Draw manual tone curve");
    await expect(curveGraph).toBeVisible();
    await lightbox.getByRole("button", { name: "Auto enhance image" }).click();
    await expect(lightbox).toContainText("Auto enhance applied.");
    const imageAdjustmentValue = async (label: string) => {
      const number = Number(await lightbox.getByLabel(label).inputValue());
      return Object.is(number, -0) ? 0 : number;
    };
    const autoEnhanceValues = {
      exposure: await imageAdjustmentValue("Image exposure"),
      contrast: await imageAdjustmentValue("Image contrast"),
      highlights: await imageAdjustmentValue("Image highlights"),
      shadows: await imageAdjustmentValue("Image shadows"),
      brilliance: await imageAdjustmentValue("Image brilliance"),
      saturation: await imageAdjustmentValue("Image saturation"),
      sharpness: await imageAdjustmentValue("Image sharpness"),
      noiseReduction: await imageAdjustmentValue("Image noise reduction")
    };
    expect(Number.isFinite(autoEnhanceValues.exposure)).toBe(true);
    expect(autoEnhanceValues.contrast).toBeGreaterThanOrEqual(0);
    expect(autoEnhanceValues.highlights).toBeLessThanOrEqual(-5);
    expect(autoEnhanceValues.shadows).toBeGreaterThanOrEqual(5);
    expect(autoEnhanceValues.brilliance).toBeGreaterThanOrEqual(10);
    await expect(lightbox).toContainText("Adj ");
    const graphBox = await curveGraph.boundingBox();
    if (!graphBox) throw new Error("manual curve graph had no bounding box");

    await page.mouse.move(graphBox.x + graphBox.width * 0.5, graphBox.y + graphBox.height * 0.18);
    await page.mouse.down();
    await page.mouse.move(graphBox.x + graphBox.width * 0.75, graphBox.y + graphBox.height * 0.72);
    await page.mouse.up();

    await expect(lightbox.getByLabel("Image manual curve midpoint")).toHaveValue("65");
    await expect(lightbox.getByLabel("Image manual curve three-quarter point")).toHaveValue("-45");
    await expect(lightbox).toContainText("MC50+65");
    await expect(lightbox).toContainText("MC75-45");
    await lightbox.getByRole("button", { name: "Save image edit stack" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeVisible();

    await expect.poll(async () => page.evaluate(async ({ sourcePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const stackResult = await crossAge.invoke<{ value: { stack?: { operations?: Array<Record<string, any>> }, operations?: Array<Record<string, any>> } }>("get_photo_edit_stack", {
        sourcePath
      });
      const stack = stackResult.value.stack || stackResult.value;
      const operation = (stack.operations || [])[0] || {};
      const folder = await crossAge.invoke<{ items: Array<{ sourcePath: string; previewPath?: string | null; hasEditStack?: boolean }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const item = folder.items.find((row) => row.sourcePath === sourcePath);
      return {
        exposure: operation.adjustments?.exposure || 0,
        contrast: operation.adjustments?.contrast || 0,
        highlights: operation.adjustments?.highlights || 0,
        shadows: operation.adjustments?.shadows || 0,
        brilliance: operation.adjustments?.brilliance || 0,
        saturation: operation.adjustments?.saturation || 0,
        sharpness: operation.adjustments?.sharpness || 0,
        noiseReduction: operation.adjustments?.noiseReduction || 0,
        manualCurveMid: operation.adjustments?.manualCurveMid || 0,
        manualCurveThreeQuarter: operation.adjustments?.manualCurveThreeQuarter || 0,
        hasEditStack: Boolean(item?.hasEditStack),
        hasRenderedPreview: String(item?.previewPath || "").includes("photo-edit-previews")
      };
    }, { sourcePath: seeded.target })).toEqual({
      ...autoEnhanceValues,
      manualCurveMid: 65,
      manualCurveThreeQuarter: -45,
      hasEditStack: true,
      hasRenderedPreview: true
    });

    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    await tileByFilename(page, "manual-curve-source").getByRole("button", { name: /Open photo/ }).click();
    const reopenedLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(reopenedLightbox).toContainText("Adj ");
    await expect(reopenedLightbox).toContainText("MC50+65");
    await expect(reopenedLightbox).toContainText("MC75-45");
    const reopenedCurveGraph = reopenedLightbox.getByLabel("Draw manual tone curve");
    if (!(await reopenedCurveGraph.isVisible().catch(() => false))) {
      await reopenedLightbox.getByRole("button", { name: "Adjust image" }).click();
    }
    await expect(reopenedCurveGraph).toBeVisible();
    await expect(reopenedLightbox.getByLabel("Image manual curve midpoint")).toHaveValue("65");
    await expect(reopenedLightbox.getByLabel("Image manual curve three-quarter point")).toHaveValue("-45");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Markup and description-region metadata persist from the lightbox", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-markup-regions-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  mkdirSync(media, { recursive: true });
  writeFileSync(path.join(media, "markup-region.png"), MARKUP_TEST_PNG);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const sourcePath = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Markup region E2E media"
      });
      const target = (imported.value.importedPaths || []).find((item) => /markup-region\.png$/.test(item));
      if (!target) throw new Error("markup-region import missing");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: target, title: "markup-region" });
      return target;
    }, { mediaFolder: media });

    await page.evaluate(() => window.localStorage.removeItem("vintrace.photos.imageSignaturePresets"));
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "markup-region")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "markup-region").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();

    await lightbox.getByRole("button", { name: "Add markup annotation" }).click();
    await lightbox.getByLabel("Markup text").fill("Browser markup note");
    await lightbox.getByLabel("Markup left").fill("14");
    await lightbox.getByLabel("Markup top").fill("16");
    await lightbox.getByLabel("Markup width").fill("46");
    await lightbox.getByLabel("Markup height").fill("15");
    await lightbox.getByRole("button", { name: "Add markup annotation row" }).click();
    await lightbox.getByLabel("Markup kind").selectOption("arrow");
    await lightbox.getByLabel("Markup left").fill("6");
    await lightbox.getByLabel("Markup top").fill("76");
    await lightbox.getByLabel("Markup width").fill("52");
    await lightbox.getByLabel("Markup height").fill("4");
    await lightbox.getByRole("button", { name: "Add markup annotation row" }).click();
    await lightbox.getByLabel("Markup kind").selectOption("signature");
    await lightbox.getByRole("button", { name: "Draw markup stroke" }).click();
    const stage = lightbox.locator(".photos-lightbox-stage");
    const stageBox = await stage.boundingBox();
    if (!stageBox) throw new Error("Missing lightbox stage for signature draw");
    await page.mouse.move(stageBox.x + stageBox.width * 0.36, stageBox.y + stageBox.height * 0.62);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + stageBox.width * 0.48, stageBox.y + stageBox.height * 0.48, { steps: 4 });
    await page.mouse.move(stageBox.x + stageBox.width * 0.62, stageBox.y + stageBox.height * 0.61, { steps: 4 });
    await page.mouse.up();
    await expect(lightbox.getByRole("button", { name: "Save selected signature" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Save selected signature" }).click();
    await expect.poll(async () => page.evaluate(() => {
      const rows = JSON.parse(window.localStorage.getItem("vintrace.photos.imageSignaturePresets") || "[]") as Array<{ points?: unknown[] }>;
      return { count: rows.length, hasPath: Boolean(rows[0]?.points && rows[0].points.length >= 2) };
    })).toEqual({ count: 1, hasPath: true });

    await lightbox.getByRole("button", { name: "Retouch image" }).click();
    await lightbox.getByLabel("Retouch kind").selectOption("blemish");
    await lightbox.getByLabel("Retouch width").fill("10");
    await lightbox.getByLabel("Retouch height").fill("8");
    await lightbox.getByRole("button", { name: "Brush retouch spots" }).click();
    const retouchStageBox = await stage.boundingBox();
    if (!retouchStageBox) throw new Error("Missing lightbox stage for retouch brush");
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.38, retouchStageBox.y + retouchStageBox.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.50, retouchStageBox.y + retouchStageBox.height * 0.50, { steps: 4 });
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.62, retouchStageBox.y + retouchStageBox.height * 0.54, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => lightbox.locator(".photos-edit-retouch-overlay").count()).toBeGreaterThanOrEqual(2);
    await lightbox.getByRole("button", { name: "Add clone retouch" }).click();
    await lightbox.getByRole("button", { name: "Pick clone source" }).click();
    await page.mouse.click(retouchStageBox.x + retouchStageBox.width * 0.22, retouchStageBox.y + retouchStageBox.height * 0.42);
    await expect(lightbox.locator(".photos-edit-retouch-source-overlay")).toBeVisible();
    await lightbox.getByRole("button", { name: "Brush retouch spots" }).click();
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.66, retouchStageBox.y + retouchStageBox.height * 0.44);
    await page.mouse.down();
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.78, retouchStageBox.y + retouchStageBox.height * 0.48, { steps: 4 });
    await page.mouse.move(retouchStageBox.x + retouchStageBox.width * 0.86, retouchStageBox.y + retouchStageBox.height * 0.52, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => lightbox.locator(".photos-edit-retouch-overlay").count()).toBeGreaterThanOrEqual(4);

    await expect(lightbox.getByRole("button", { name: "Save image edit stack" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Save image edit stack" }).click();
    await expect.poll(async () => page.evaluate(async (targetPath) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { stack?: { operations?: Array<Record<string, any>> }, operations?: Array<Record<string, any>> } }>("get_photo_edit_stack", {
        sourcePath: targetPath
      });
      const stack = result.value.stack || result.value;
      const operation = (stack.operations || [])[0] || {};
      const markup = Array.isArray(operation.markup) ? operation.markup : [];
      const retouch = Array.isArray(operation.retouch) ? operation.retouch : [];
      const blemish = retouch.filter((row: Record<string, unknown>) => String(row.kind || "") === "blemish");
      const clone = retouch.filter((row: Record<string, unknown>) => String(row.kind || "") === "clone");
      const spotInBounds = (row: Record<string, unknown>) => (
        Number(row.left) >= 0
        && Number(row.top) >= 0
        && Number(row.width) > 0
        && Number(row.height) > 0
        && Number(row.left) + Number(row.width) <= 100
        && Number(row.top) + Number(row.height) <= 100
      );
      return {
        kinds: markup.map((row: Record<string, unknown>) => String(row.kind || "")),
        text: String(markup[0]?.text || ""),
        signaturePointReady: (Array.isArray(markup[2]?.points) ? markup[2].points.length : 0) >= 2,
        retouchReady: blemish.length >= 2
          && clone.length >= 2
          && retouch.every(spotInBounds)
          && clone.every((row: Record<string, unknown>) => (
            Number(row.sourceLeft) >= 0
            && Number(row.sourceTop) >= 0
            && Number(row.sourceLeft) <= 99
            && Number(row.sourceTop) <= 99
          ))
      };
    }, sourcePath)).toEqual({
      kinds: ["text", "arrow", "signature"],
      text: "Browser markup note",
      signaturePointReady: true,
      retouchReady: true
    });
    const signaturePointCount = await page.evaluate(async (targetPath) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { stack?: { operations?: Array<Record<string, any>> }, operations?: Array<Record<string, any>> } }>("get_photo_edit_stack", {
        sourcePath: targetPath
      });
      const stack = result.value.stack || result.value;
      const markup = ((stack.operations || [])[0]?.markup || []) as Array<Record<string, any>>;
      return Array.isArray(markup[2]?.points) ? markup[2].points.length : 0;
    }, sourcePath);
    expect(signaturePointCount).toBeGreaterThanOrEqual(2);

    await lightbox.getByRole("button", { name: "Add region" }).click();
    await lightbox.getByLabel("Region description").fill("Browser region handle text");
    await lightbox.getByLabel("Region 1 X").fill("18");
    await lightbox.getByLabel("Region 1 Y").fill("22");
    await lightbox.getByLabel("Region 1 W").fill("31");
    await lightbox.getByLabel("Region 1 H").fill("19");
    await expect(lightbox.getByRole("button", { name: "Save info" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Save info" }).click();
    await expect.poll(async () => page.evaluate(async (targetPath) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string; assetMetadata?: Record<string, any> }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.sourcePath === targetPath);
      const regions = Array.isArray(target?.assetMetadata?.descriptionRegions) ? target.assetMetadata.descriptionRegions : [];
      return {
        regionText: String(regions[0]?.text || ""),
        regionX: Number(regions[0]?.x || 0),
        regionWidth: Number(regions[0]?.width || 0)
      };
    }, sourcePath)).toEqual({
      regionText: "Browser region handle text",
      regionX: 18,
      regionWidth: 31
    });
    await expect(lightbox).toContainText("Browser region handle text");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await page.getByLabel("Search photos").fill("Browser region handle");
    await expect(tileByFilename(page, "markup-region")).toBeVisible({ timeout: 15_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos saved filters can save apply pin reorder and delete from the rail", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-saved-filters-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["harbor.png", "quiet.png", "zebra.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Saved filter E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const harbor = paths.find((item) => /harbor\.png$/.test(item));
      const quiet = paths.find((item) => /quiet\.png$/.test(item));
      if (harbor) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: harbor,
          title: "Harbor sunset",
          favorite: true
        });
      }
      if (quiet) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: quiet,
          title: "Quiet cove"
        });
      }
    }, { mediaFolder: media });

    await page.evaluate(() => window.localStorage.removeItem("vintrace.photos.savedFilters"));
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(page.getByLabel("Search photos")).toBeVisible();

    await page.getByLabel("Search photos").fill("Harbor");
    await page.getByRole("checkbox", { name: "Favorites", exact: true }).check();
    await page.getByRole("button", { name: "Save filter" }).click();
    const harborName = "Saved filter: Harbor + Favorites";
    await expect(savedFilterRow(page, harborName)).toBeVisible({ timeout: 15_000 });
    await expect(savedFilterRow(page, harborName).locator(".photos-rail-count")).toHaveText("1");
    await expect(savedFilterRow(page, harborName).locator(".photo-saved-filter-snippet")).toContainText("Harbor sunset");
    await savedFilterRow(page, harborName).getByRole("button", { name: /Saved filter actions/ }).click();
    await expect(page.getByRole("menu")).toContainText("Apply saved filter");
    await expect(page.getByRole("menu")).toContainText("Pin saved filter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByLabel("Search photos").fill("Quiet");
    await page.getByRole("checkbox", { name: "Favorites", exact: true }).uncheck();
    await page.getByRole("button", { name: "Save filter" }).click();
    const quietName = "Saved filter: Quiet";
    await expect(savedFilterRow(page, quietName)).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Search photos").fill("");
    await page.getByRole("button", { name: `Pin saved filter ${harborName}` }).click();
    await expect.poll(async () => savedFilterNames(page)).toEqual([
      expect.objectContaining({ name: harborName, pinned: true, count: 1 }),
      expect.objectContaining({ name: quietName, pinned: false, count: 1 })
    ]);

    await page.getByRole("button", { name: `Pin saved filter ${quietName}` }).click();
    await expect.poll(async () => savedFilterNames(page)).toEqual([
      expect.objectContaining({ name: harborName, pinned: true, position: 0 }),
      expect.objectContaining({ name: quietName, pinned: true, position: 1 })
    ]);

    await page.getByRole("button", { name: `Move saved filter down ${harborName}` }).click();
    await expect.poll(async () => savedFilterNames(page)).toEqual([
      expect.objectContaining({ name: quietName, pinned: true, position: 0 }),
      expect.objectContaining({ name: harborName, pinned: true, position: 1 })
    ]);

    await savedFilterRow(page, harborName).locator(".photo-rail-row-main").click();
    await expect(page.getByLabel("Search photos")).toHaveValue("Harbor");
    await expect(page.getByRole("checkbox", { name: "Favorites", exact: true })).toBeChecked();
    await expect(tileByFilename(page, "Harbor sunset")).toBeVisible();

    await page.getByRole("button", { name: `Delete saved filter ${quietName}` }).click();
    await expect.poll(async () => savedFilterNames(page)).toEqual([
      expect.objectContaining({ name: harborName, pinned: true, position: 0 })
    ]);
    await expect(savedFilterRow(page, quietName)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos global search shows categorized local results snippets and routes", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-global-search-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const harborMedia = path.join(temp, "Harbor Sources");
  writePhotoFixtureSet(harborMedia, [
    "harbor.png",
    "harbor-neutral.png",
    "hidden-harbor.png"
  ]);
  writePhotoFixtureSet(media, [
    "overflow-result-1.png",
    "overflow-result-2.png",
    "overflow-result-3.png",
    "overflow-result-4.png",
    "overflow-result-5.png",
    "portrait.png",
    "receipt.png"
  ]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
harbor_media = Path(sys.argv[3])
api = DesktopApi(workspace)
run_id = "global-search-e2e"
api.project.db.create_scan_run(run_id, "Global Search E2E", "manual", str(media.parent))
paths = {}
for name in ("harbor.png", "harbor-neutral.png", "overflow-result-1.png", "overflow-result-2.png", "overflow-result-3.png", "overflow-result-4.png", "overflow-result-5.png", "portrait.png", "receipt.png", "hidden-harbor.png"):
    path = harbor_media / name if name in {"harbor.png", "harbor-neutral.png", "hidden-harbor.png"} else media / name
    paths[name] = str(path)
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

harbor = paths["harbor.png"]
api.update_photo_asset_metadata({
    "sourcePath": harbor,
    "title": "Harbor picnic E2E",
    "caption": "Blue hour by the boats",
    "dateOverride": "2026-06-19",
    "locationOverride": {"label": "Harbor Point E2E", "latitude": "36.9741", "longitude": "-122.0308"},
    "keywords": ["harbor-key", "travel"],
})
harbor_asset = api.project.db.photo_asset_by_path(harbor)
if not harbor_asset:
    raise RuntimeError("Harbor asset was not indexed")
with api.project.db.connect() as conn:
    conn.execute(
        """
        INSERT OR REPLACE INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (harbor_asset["assetId"], "global-search-harbor-guest", "Harbor Guest E2E", "accepted", 0.99, 0.95, "confident", "2026-06-26T00:00:00Z"),
    )

api.update_photo_asset_metadata({"sourcePath": paths["harbor-neutral.png"], "title": "Harbor neutral E2E", "dateOverride": "2026-06-20"})
for index, name in enumerate(("overflow-result-1.png", "overflow-result-2.png", "overflow-result-3.png", "overflow-result-4.png", "overflow-result-5.png"), start=1):
    api.update_photo_asset_metadata({
        "sourcePath": paths[name],
        "title": f"Overflow result E2E {index}",
        "dateOverride": f"2026-06-2{index}",
    })
api.update_photo_asset_metadata({"sourcePath": paths["portrait.png"], "title": "Studio portrait E2E", "dateOverride": "2025-01-02"})
portrait_asset = api.project.db.photo_asset_by_path(paths["portrait.png"])
api.project.db.update_photo_asset_metadata_json(
    asset_id=portrait_asset["assetId"],
    patch={
        "ocrText": "Boarding pass ticket number ZX-42",
        "exif": {"cameraModel": "SearchCam 1000"},
        "colorProfile": "Dolby Vision HDR",
    },
)
api.update_photo_asset_metadata({"sourcePath": paths["receipt.png"], "title": "Cafe receipt E2E", "dateOverride": "2026-06-21"})
receipt_asset = api.project.db.photo_asset_by_path(paths["receipt.png"])
api.project.db.update_photo_asset_metadata_json(
    asset_id=receipt_asset["assetId"],
    patch={"ocrText": "Cafe Receipt Total $18.50"},
)
api.update_photo_asset_metadata({"sourcePath": paths["hidden-harbor.png"], "title": "Secret Harbor E2E", "hidden": True})
album = api.save_photo_album({"name": "Harbor album E2E", "albumKind": "manual"})
api.add_photo_album_items({"albumId": album["albumId"], "sourcePaths": [harbor]})
api.save_photo_curation_preferences({"featureLessPeople": ["Harbor Guest E2E"]})
api.project.db.rebuild_photo_search_index()
		`, [workspace, media, harborMedia]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await expect(rail.getByText("Sources", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByRole("button", { name: /^Harbor Sources\b/ })).toBeVisible({ timeout: 20_000 });
    const searchBox = page.getByLabel("Search photos");
    await expect(searchBox).toBeVisible({ timeout: 20_000 });
    await searchBox.fill("Harbor");

    const globalSearch = page.getByLabel("Library search results");
    await expect(globalSearch).toBeVisible({ timeout: 20_000 });
    await expect(globalSearch).toContainText("Library search");
    await expect(globalSearch).toContainText("Photos");
    await expect(globalSearch).toContainText("Albums");
    await expect(globalSearch).toContainText("People");
    await expect(globalSearch).toContainText("Places");
    await expect(globalSearch).toContainText("Keywords");
    await expect(globalSearch).toContainText("Source Folders");
    await expect(globalSearch).toContainText("Harbor picnic E2E");
    await expect(globalSearch).toContainText("Title: Harbor picnic E2E");
    await expect(globalSearch).toContainText("Harbor album E2E");
    await expect(globalSearch).toContainText("Harbor Guest E2E");
    await expect(globalSearch).toContainText("Harbor Point E2E");
    await expect(globalSearch).toContainText("harbor-key");
    await expect(globalSearch).toContainText("Harbor Sources");
    await expect(globalSearch).not.toContainText("Secret Harbor E2E");
    await expect(globalSearch.locator(".photo-search-highlight").filter({ hasText: "Harbor" }).first()).toBeVisible();
    const photoGroup = globalSearch.locator(".photo-global-search-group").filter({
      has: page.locator(".photo-global-search-group-head", { hasText: "Photos" })
    });
    const sourceFolderGroup = globalSearch.locator(".photo-global-search-group").filter({
      has: page.locator(".photo-global-search-group-head", { hasText: "Source Folders" })
    });
    await searchBox.press("ArrowDown");
    await expect(searchBox).toHaveAttribute("aria-activedescendant", "photo-global-search-result-0");
    const activeSearchItem = globalSearch.locator(".photo-global-search-item.active");
    await expect(activeSearchItem).toHaveCount(1);
    await expect(activeSearchItem.first()).toContainText("Harbor neutral E2E");
    await searchBox.press("ArrowDown");
    await expect(searchBox).toHaveAttribute("aria-activedescendant", "photo-global-search-result-1");
    await expect(activeSearchItem.first()).toContainText("Harbor picnic E2E");
    await searchBox.press("Escape");
    await expect(activeSearchItem).toHaveCount(0);
    await searchBox.press("ArrowDown");
    await searchBox.press("Enter");
    await expect(searchBox).toHaveValue(/harbor-neutral\.png/);
    await searchBox.fill("Harbor");
    await expect(globalSearch).toContainText("Harbor picnic E2E", { timeout: 20_000 });
    await expect(photoGroup.locator(".photo-global-search-reasons").filter({ hasText: "Title" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(sourceFolderGroup.locator(".photo-global-search-reasons").filter({ hasText: "Source folder" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(photoGroup.getByRole("button", { name: /Harbor neutral E2E/ })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const labels = await photoGroup.locator(".photo-global-search-item").evaluateAll((buttons) => buttons.map((button) => button.textContent || ""));
      const neutralIndex = labels.findIndex((label) => label.includes("Harbor neutral E2E"));
      const featuredLessIndex = labels.findIndex((label) => label.includes("Harbor picnic E2E"));
      return neutralIndex >= 0 && featuredLessIndex >= 0 && neutralIndex < featuredLessIndex;
    }, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => {
      const values = await page.locator("#photos-search-suggestions option").evaluateAll((options) => (
        options.map((option) => option.getAttribute("value") || "")
      ));
      const neutralIndex = values.indexOf("Harbor neutral E2E");
      const personIndex = values.indexOf("Harbor Guest E2E");
      return neutralIndex >= 0 && personIndex >= 0 && neutralIndex < personIndex;
    }, { timeout: 20_000 }).toBe(true);

    const overflowSources = [1, 2, 3, 4, 5].map((index) => path.join(media, `overflow-result-${index}.png`));
    await page.evaluate(async (sources) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      for (let index = 0; index < sources.length; index += 1) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: sources[index],
          title: `Overflow result E2E ${index + 1}`,
          caption: "Lower priority Harbor overflow match",
        });
      }
    }, overflowSources);
    await searchBox.fill("");
    await searchBox.fill("Harbor");
    await expect(photoGroup).toContainText("6 / 7", { timeout: 20_000 });
    await expect(photoGroup.getByRole("button", { name: "Show all Photos" })).toBeVisible();

    await photoGroup.getByRole("button", { name: "Show all Photos" }).click();
    await expect(searchBox).toHaveValue("Harbor");
    await expect(tileByFilename(page, "Overflow result E2E 5")).toBeVisible({ timeout: 20_000 });

    await globalSearch.getByRole("button", { name: /Harbor album E2E/ }).click();
    await expect(searchBox).toHaveValue("");
    await expect(tileByFilename(page, "Harbor picnic E2E")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor neutral E2E")).toHaveCount(0);

    await searchBox.fill("Harbor");
    await expect(globalSearch.getByRole("button", { name: /Harbor Guest E2E/ })).toBeVisible({ timeout: 20_000 });
    await globalSearch.getByRole("button", { name: /Harbor Guest E2E/ }).click();
    await expect(searchBox).toHaveValue("");
    await expect(tileByFilename(page, "Harbor picnic E2E")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor neutral E2E")).toHaveCount(0);

    await searchBox.fill("Harbor");
    await expect(globalSearch.getByRole("button", { name: /Harbor Point E2E/ })).toBeVisible({ timeout: 20_000 });
    await globalSearch.getByRole("button", { name: /Harbor Point E2E/ }).click();
    await expect(searchBox).toHaveValue("");
    await expect(tileByFilename(page, "Harbor picnic E2E")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor neutral E2E")).toHaveCount(0);

    await searchBox.fill("Harbor");
    await expect(sourceFolderGroup.getByRole("button", { name: /Harbor Sources/ })).toBeVisible({ timeout: 20_000 });
    await sourceFolderGroup.getByRole("button", { name: /Harbor Sources/ }).click();
    await expect(searchBox).toHaveValue("");
    await expect(page.getByLabel("Source filter")).toHaveValue(harborMedia);
    await expect(rail.locator(".photo-rail-row-main.active").filter({ hasText: "Harbor Sources" })).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor neutral E2E")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Overflow result E2E 1")).toHaveCount(0);

    await searchBox.fill("harbor-key");
    const keywordGroup = globalSearch.locator(".photo-global-search-group").filter({
      has: page.locator(".photo-global-search-group-head", { hasText: "Keywords" })
    });
    await expect(keywordGroup.getByRole("button", { name: /^harbor-key\b/ })).toBeVisible({ timeout: 20_000 });
    await keywordGroup.getByRole("button", { name: /^harbor-key\b/ }).click();
    await expect(searchBox).toHaveValue("");
    await expect(page.getByLabel("Keyword filter", { exact: true })).toHaveValue("harbor-key");
    await expect(tileByFilename(page, "Harbor picnic E2E")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Clear filters" }).click();
    await searchBox.fill("ticket");
    await expect(globalSearch).toBeVisible({ timeout: 20_000 });
    await expect(globalSearch).toContainText("Detected text: Boarding pass ticket number");
    await expect(globalSearch.locator(".photo-search-highlight").filter({ hasText: "ticket" }).first()).toBeVisible();

    await searchBox.fill("2026");
    await expect(globalSearch).toBeVisible({ timeout: 20_000 });
    await expect(globalSearch).toContainText("Dates");
    await expect(globalSearch.getByRole("button", { name: /2026/ }).first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos search explains cold indexing and routes to the queued search job", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-cold-search-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["cold-alpha.png", "cold-beta.png", "cold-gamma.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": True,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": False,
        "indexingPowerMode": "low",
    }
})
run_id = "cold-search-index-e2e"
api.project.db.create_scan_run(run_id, "Cold Search E2E", "manual", str(media))
for index, name in enumerate(("cold-alpha.png", "cold-beta.png", "cold-gamma.png"), start=1):
    source = media / name
    api.project.db.record_scan_file(run_id, source, path_signature(source), "completed", phase="processed")
    api.update_photo_asset_metadata({
        "sourcePath": str(source),
        "title": f"Cold queued title {index}",
        "caption": "Cold search browser fixture",
        "dateOverride": "2026-06-20",
    })

with api.project.db.connect() as conn:
    conn.execute("DELETE FROM photo_search_fts")
api.enqueue_photo_indexing_job({"jobKind": "search", "scope": {"all": True, "budgetLimit": 2}})
	`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Cold queued title 1")).toBeVisible({ timeout: 20_000 });
    const searchBox = page.getByLabel("Search photos");
    await searchBox.fill("Cold queued title 3");
    const searchIndexNotice = page.locator(".photo-search-index-notice");
    await expect(searchIndexNotice).toBeVisible({ timeout: 20_000 });
    await expect(searchIndexNotice).toContainText("Search index is catching up");
    await expect(searchIndexNotice).toContainText("3 photo search rows need indexing");
    await expect(searchIndexNotice).toContainText("Search index job queued.");
    await expect(tileByFilename(page, "Cold queued title 3")).toHaveCount(0);

    await searchIndexNotice.getByRole("button", { name: "Queue status" }).click();
    const settingsPanel = page.locator("#photos-local-settings");
    await expect(settingsPanel).toBeVisible({ timeout: 20_000 });
    const indexingJobs = settingsPanel.getByLabel("Local indexing jobs", { exact: true });
    const searchJobRow = indexingJobs.locator(".photo-indexing-job-row").filter({ hasText: "Search index" }).first();
    await expect(searchJobRow).toBeVisible({ timeout: 20_000 });
    await expect(searchJobRow).toContainText("queued");
    const searchJobDetails = searchJobRow.locator(".photo-indexing-job-details");
    await searchJobDetails.locator("summary").click();
    await expect(searchJobDetails).toContainText("Status: queued");
    await expect(searchJobDetails).toContainText("All photos scope");
    await expect(searchJobDetails).toContainText("Budget 2");

    await settingsPanel.getByRole("button", { name: "Run next local indexing job" }).click();
    await expect(searchJobRow).toContainText("deferred 1", { timeout: 20_000 });
    await expect(searchJobDetails).toContainText("Progress: processed 2");
    await expect(searchJobDetails).toContainText("updated 2");
    await expect(searchJobDetails).toContainText("deferred 1");
    await settingsPanel.getByRole("button", { name: "Run next local indexing job" }).click();
    await expect(indexingJobs.locator(".photo-indexing-job-row.completed").filter({ hasText: "Search index" })).toHaveCount(1, { timeout: 20_000 });

    await searchIndexNotice.getByRole("button", { name: "Retry search" }).click();
    await expect(tileByFilename(page, "Cold queued title 3")).toBeVisible({ timeout: 20_000 });
    await expect(searchIndexNotice).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Live Text regions are selectable from the lightbox inspector", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-live-text-regions-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["live-text-ticket.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
photo = str((media / "live-text-ticket.png").resolve())
api.import_photos({"sourcePaths": [photo], "storageMode": "referenced", "sourceLabel": "Live Text E2E"})
api.update_photo_asset_metadata({"sourcePath": photo, "title": "Live Text Ticket E2E"})
asset = api.project.db.photo_asset_by_path(photo)
regions = [
    {
        "text": "https://example.test/pass",
        "x": 10,
        "y": 20,
        "width": 35,
        "height": 10,
        "confidence": 0.94,
        "source": "tesseract-tsv",
        "bounds": {
            "x": 10,
            "y": 20,
            "width": 35,
            "height": 10,
            "unit": "percent",
            "pixelX": 40,
            "pixelY": 40,
            "pixelWidth": 140,
            "pixelHeight": 20,
            "imageWidth": 400,
            "imageHeight": 200,
        },
    },
    {
        "text": "hello@example.test",
        "x": 58,
        "y": 20,
        "width": 28,
        "height": 10,
        "confidence": 0.91,
        "source": "tesseract-tsv",
        "bounds": {
            "x": 58,
            "y": 20,
            "width": 28,
            "height": 10,
            "unit": "percent",
            "pixelX": 232,
            "pixelY": 40,
            "pixelWidth": 112,
            "pixelHeight": 20,
            "imageWidth": 400,
            "imageHeight": 200,
        },
    },
]
api.project.db.update_photo_asset_metadata_json(
    asset_id=asset["assetId"],
    patch={
        "width": 400,
        "height": 200,
        "ocrText": "Visit https://example.test/pass or email hello@example.test",
        "detectedText": "Visit https://example.test/pass or email hello@example.test",
        "ocrConfidence": 0.925,
        "textRegions": regions,
        "textBlocks": regions,
        "localOcr": {
            "status": "indexed",
            "source": "tesseract",
            "engine": "tesseract",
            "language": "eng",
            "regionSource": "tesseract-tsv",
            "detectedScript": "Latin",
            "detectedScripts": [{"script": "Latin", "count": 42, "ratio": 1}],
            "detectedLanguageSource": "script-heuristic",
            "regionCount": 2,
        },
    },
)
api.project.db.replace_photo_ocr_blocks(asset["assetId"], regions, default_language="eng", default_confidence=0.925)
    `, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Live Text Ticket E2E")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Live Text Ticket E2E").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole("button", { name: /Select text region: https:\/\/example\.test\/pass/ })).toBeVisible();

    const info = lightbox.locator(".photos-info-inspector");
    await expect(info).toContainText("Detected text");
    await expect(info).toContainText("Visit https://example.test/pass");
    await expect(info).toContainText("OCR metadata");
    await expect(info).toContainText("Engine tesseract");
    await expect(info).toContainText("Language eng");
    await expect(info).toContainText("Script Latin");
    const liveTextRegions = info.getByLabel("Live Text regions");
    await expect(liveTextRegions).toBeVisible();
    await expect(liveTextRegions.getByRole("button", { name: /Select Live Text snippet: https:\/\/example\.test\/pass/ })).toBeVisible();
    await expect(liveTextRegions.getByRole("button", { name: /Select Live Text snippet: hello@example\.test/ })).toBeVisible();

    await liveTextRegions.getByRole("button", { name: /Select Live Text snippet: https:\/\/example\.test\/pass/ }).click();
    const selectedUrlActions = info.locator(".photos-qr-action-row.active");
    await expect(selectedUrlActions).toContainText("Selected text");
    await expect(selectedUrlActions).toContainText("94%");
    await expect(selectedUrlActions.getByRole("button", { name: "Copy selected text" })).toBeVisible();
    await expect(selectedUrlActions.getByRole("link", { name: "Open detected URL" })).toHaveAttribute("href", "https://example.test/pass");

    await liveTextRegions.getByRole("button", { name: /Select Live Text snippet: hello@example\.test/ }).click();
    const selectedEmailActions = info.locator(".photos-qr-action-row.active");
    await expect(selectedEmailActions).toContainText("91%");
    await expect(selectedEmailActions.getByRole("link", { name: "Email detected address" })).toHaveAttribute("href", "mailto:hello@example.test");
    await expect(selectedEmailActions.getByRole("link", { name: "Save contact card" })).toHaveAttribute("download", "hello.vcf");
    await selectedEmailActions.getByRole("button", { name: "Clear selected text" }).click();
    await expect(info.locator(".photos-qr-action-row.active")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos QR barcode overlays and indexing controls work in browser flows", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-qr-browser-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, [
    "qr-region.png",
    "failed-code.png",
    "pending-code.png",
    "queue-run-ocr.png",
    "queue-cancel-ocr.png",
    "queue-retry-ocr.png"
  ]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": True,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": False,
        "indexingPowerMode": "low",
    }
})
run_id = "qr-browser-e2e"
api.project.db.create_scan_run(run_id, "QR Browser E2E", "manual", str(media))
paths = {}
for name in ("qr-region.png", "failed-code.png", "pending-code.png", "queue-run-ocr.png", "queue-cancel-ocr.png", "queue-retry-ocr.png"):
    path = media / name
    paths[name] = str(path)
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

qr_path = paths["qr-region.png"]
api.update_photo_asset_metadata({"sourcePath": qr_path, "title": "QR Browser Code"})
qr_asset = api.project.db.photo_asset_by_path(qr_path)
payload = "https://example.test/e2e-pass"
region = {
    "type": "QR Code",
    "text": payload,
    "confidence": 0.94,
    "source": "e2e-fixture",
    "x": 10,
    "y": 20,
    "width": 35,
    "height": 30,
}
api.project.db.update_photo_asset_metadata_json(
    asset_id=qr_asset["assetId"],
    patch={
        "barcodeType": "QR Code",
        "barcodeText": payload,
        "decodedText": payload,
        "barcodeConfidence": 0.94,
        "barcodeSource": "e2e-fixture",
        "qrText": payload,
        "qrConfidence": 0.94,
        "barcodes": [{
            "type": "QR Code",
            "text": payload,
            "confidence": 0.94,
            "source": "e2e-fixture",
            "bounds": {"x": 10, "y": 20, "width": 35, "height": 30},
        }],
        "barcodeRegions": [region],
        "qrRegions": [region],
        "localBarcode": {
            "status": "indexed",
            "indexedAt": "2026-06-27T00:00:00Z",
            "decoders": ["e2e-fixture"],
            "barcodeCount": 1,
            "source": "e2e-fixture",
            "error": "",
        },
    },
)

failed_path = paths["failed-code.png"]
api.update_photo_asset_metadata({"sourcePath": failed_path, "title": "Failed Barcode Browser"})
failed_asset = api.project.db.photo_asset_by_path(failed_path)
api.project.db.update_photo_asset_metadata_json(
    asset_id=failed_asset["assetId"],
    patch={
        "localBarcode": {
            "status": "no_code",
            "indexedAt": "2026-06-27T00:01:00Z",
            "decoders": ["e2e-fixture"],
            "barcodeCount": 0,
            "source": "e2e-fixture",
            "error": "No barcode was decoded.",
        }
    },
)

api.update_photo_asset_metadata({"sourcePath": paths["pending-code.png"], "title": "Pending Barcode Browser"})
queue_run_path = paths["queue-run-ocr.png"]
queue_cancel_path = paths["queue-cancel-ocr.png"]
queue_retry_path = paths["queue-retry-ocr.png"]
Path(queue_run_path).with_suffix(".txt").write_text("Browser row run OCR payload", encoding="utf-8")
Path(queue_cancel_path).with_suffix(".txt").write_text("Browser row cancel OCR payload", encoding="utf-8")
Path(queue_retry_path).with_suffix(".txt").write_text("Browser row retry OCR payload", encoding="utf-8")
api.update_photo_asset_metadata({"sourcePath": queue_run_path, "title": "Queue Row Run Browser"})
api.update_photo_asset_metadata({"sourcePath": queue_cancel_path, "title": "Queue Row Cancel Browser"})
api.update_photo_asset_metadata({"sourcePath": queue_retry_path, "title": "Queue Row Retry Browser"})
api.save_photo_album({
    "name": "Queue Smart Album Browser",
    "albumKind": "smart",
    "rules": {"op": "all", "conditions": [{"field": "query", "operator": "contains", "value": "Queue Row"}]},
})
for queue_path in (queue_run_path, queue_cancel_path, queue_retry_path):
    queue_asset = api.project.db.photo_asset_by_path(queue_path)
    api.project.db.update_photo_asset_metadata_json(
        asset_id=queue_asset["assetId"],
        patch={
            "localBarcode": {
                "status": "skipped",
                "indexedAt": "2026-06-27T00:02:00Z",
                "decoders": ["e2e-fixture"],
                "barcodeCount": 0,
                "source": "e2e-fixture",
                "error": "",
            }
        },
    )
api.enqueue_photo_indexing_job({
    "jobKind": "ocr",
    "scope": {"sourcePaths": [queue_run_path], "sidecarOnly": True, "language": "eng"},
})
api.enqueue_photo_indexing_job({
    "jobKind": "ocr",
    "scope": {"sourcePaths": [queue_cancel_path], "sidecarOnly": True, "language": "eng"},
})
retry_job = api.enqueue_photo_indexing_job({
    "jobKind": "ocr",
    "scope": {"sourcePaths": [queue_retry_path], "sidecarOnly": True, "language": "eng"},
})
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": False,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": False,
        "indexingPowerMode": "low",
    }
})
api.run_photo_indexing_job({"jobId": retry_job["job"]["jobId"]})
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": True,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": False,
        "indexingPowerMode": "low",
    }
})
api.project.db.rebuild_photo_search_index()
	`, [workspace, media]);
  env.CROSSAGE_PHOTO_INDEXING_JOB_DELAY_MS = "750";

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "QR Browser Code")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "QR Browser Code").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByText("https://example.test/e2e-pass", { exact: true })).toBeVisible();
    await expect(lightbox.getByRole("link", { name: "Open URL" })).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Copy URL" })).toBeVisible();
    await expect(lightbox.locator(".photos-qr-region")).toHaveCount(1);
    const overlayRegion = lightbox.getByRole("button", { name: "Select QR region: https://example.test/e2e-pass" });
    await expect(overlayRegion).toBeVisible();
    await overlayRegion.click();
    await expect(overlayRegion).toHaveAttribute("aria-pressed", "true");
    await expect(lightbox.getByText(/Selected QR \(94%\): https:\/\/example\.test\/e2e-pass/)).toBeVisible();
    const regionSummary = lightbox.getByLabel("QR regions");
    await expect(regionSummary).toBeVisible();
    await expect(regionSummary.getByRole("button").first()).toHaveClass(/active/);
    await lightbox.getByRole("button", { name: "Clear QR region" }).click();
    await expect(overlayRegion).toHaveAttribute("aria-pressed", "false");
    await lightbox.getByRole("button", { name: "Close" }).click();

    const rail = page.locator(".photos-rail");
    await rail.getByRole("button", { name: "Settings" }).click();
    const settingsPanel = page.locator("#photos-local-settings");
    await expect(settingsPanel).toBeVisible();
    await settingsPanel.getByRole("button", { name: "Refresh barcode index status" }).click();
    await expect(settingsPanel.getByText(/Barcodes indexed 1 .* pending 1 .* failed 1/)).toBeVisible({ timeout: 20_000 });
    await expect(settingsPanel.getByLabel("Barcode failed jobs")).toContainText("failed-code.png");
    await expect(settingsPanel.getByRole("button", { name: "Index loaded barcodes", exact: true })).toBeEnabled();
    await expect(settingsPanel.getByRole("button", { name: "Reindex loaded barcodes", exact: true })).toBeEnabled();
    await expect(settingsPanel.getByRole("button", { name: "Retry failed barcode jobs", exact: true })).toBeEnabled();
    await expect(settingsPanel.getByRole("button", { name: "Index all pending barcodes", exact: true })).toBeEnabled();
    await settingsPanel.getByRole("button", { name: "Refresh local indexing queue" }).click();
    const indexingJobs = settingsPanel.getByLabel("Local indexing jobs", { exact: true });
    await expect(indexingJobs).toBeVisible({ timeout: 20_000 });
    await expect(indexingJobs.locator(".photo-indexing-job-row.queued")).toHaveCount(2);
    await expect(indexingJobs.locator(".photo-indexing-job-row.failed")).toHaveCount(1);
    await expect(indexingJobs.getByRole("button", { name: "Run indexing job" }).first()).toBeEnabled();
    await expect(indexingJobs.getByRole("button", { name: "Retry indexing job" }).first()).toBeEnabled();
    await expect(indexingJobs.getByRole("button", { name: "Cancel indexing job" }).first()).toBeEnabled();
    await expect(indexingJobs.locator(".photo-indexing-job-row.failed")).toContainText("attempts 1");
    await expect(indexingJobs.locator(".photo-indexing-job-row.failed")).toContainText("last failed");
    const failedDrilldown = indexingJobs.locator(".photo-indexing-job-row.failed").locator(".photo-indexing-job-details");
    await failedDrilldown.locator("summary").click();
    await expect(failedDrilldown).toContainText("Status: failed");
    await expect(failedDrilldown).toContainText("Error: Local intelligence is disabled");
    await expect(failedDrilldown).toContainText("Sources: queue-retry-ocr.png");
    await expect(failedDrilldown).toContainText("History: attempt 1 failed");

    const localIntelligenceToggle = settingsPanel.getByLabel("Local intelligence", { exact: true });
    await localIntelligenceToggle.uncheck();
    await expect(localIntelligenceToggle).not.toBeChecked();
    await expect(settingsPanel.getByRole("button", { name: "Queue pending OCR indexing" })).toBeDisabled();
    await expect(settingsPanel.getByRole("button", { name: "Queue smart album refresh" })).toBeEnabled();
    await settingsPanel.getByRole("button", { name: "Queue smart album refresh" }).click();
    const queuedSmartAlbumRows = indexingJobs.locator(".photo-indexing-job-row.queued").filter({ hasText: "Smart albums" });
    await expect(queuedSmartAlbumRows).toHaveCount(1, { timeout: 20_000 });
    await page.locator(".photos-rail").getByText("Queue Smart Album Browser", { exact: true }).click();
    const smartCatalogNotice = page.locator(".photo-catalog-index-notice.smart-albums");
    await expect(smartCatalogNotice).toBeVisible({ timeout: 20_000 });
    await expect(smartCatalogNotice).toContainText("Smart album cache is catching up");
    await expect(smartCatalogNotice).toContainText("Queue Smart Album Browser");
    await expect(smartCatalogNotice).toContainText("queued");
    await expect(smartCatalogNotice).toContainText("Waiting for the local indexing queue.");
    await smartCatalogNotice.getByRole("button", { name: "Queue status" }).click();
    await expect(settingsPanel).toBeVisible({ timeout: 20_000 });
    await expect(settingsPanel.getByRole("button", { name: "Run local indexing queue" })).toBeEnabled();
    await settingsPanel.getByRole("button", { name: "Run local indexing queue" }).click();
    const completedSmartAlbumRows = indexingJobs.locator(".photo-indexing-job-row.completed").filter({ hasText: "Smart albums" });
    await expect(completedSmartAlbumRows).toHaveCount(1, { timeout: 20_000 });
    await expect(smartCatalogNotice).toHaveCount(0);
    await expect(indexingJobs.locator(".photo-indexing-job-row.queued").filter({ hasText: "OCR" })).toHaveCount(2);
    await expect(indexingJobs.locator(".photo-indexing-job-row.failed").filter({ hasText: "OCR" })).toHaveCount(1);
    await localIntelligenceToggle.check();
    await expect(localIntelligenceToggle).toBeChecked();

    await indexingJobs.getByRole("button", { name: "Run indexing job" }).first().click();
    const runningRow = indexingJobs.locator(".photo-indexing-job-row.running");
    await expect(runningRow).toHaveCount(1, { timeout: 5_000 });
    await expect(runningRow).toContainText("running");
    await expect(runningRow.getByRole("button", { name: "Run indexing job" })).toHaveCount(0);
    const completedOcrRows = indexingJobs.locator(".photo-indexing-job-row.completed").filter({ hasText: "OCR" });
    await expect(completedOcrRows).toHaveCount(1, { timeout: 20_000 });
    await expect(completedOcrRows.filter({ hasText: "attempts 1" })).toHaveCount(1);
    await expect(completedOcrRows.filter({ hasText: "processed 1" })).toHaveCount(1);
    await expect(completedOcrRows.filter({ hasText: "last completed" })).toHaveCount(1);
    const completedDrilldown = completedOcrRows.first().locator(".photo-indexing-job-details");
    await completedDrilldown.locator("summary").click();
    await expect(completedDrilldown).toContainText("Status: completed");
    await expect(completedDrilldown).toContainText("Progress: processed 1");
    await expect(completedDrilldown).toContainText(/Sources: queue-(run|cancel)-ocr\.png/);
    await expect(completedDrilldown).toContainText("History: attempt 1 completed");
    await expect(indexingJobs.locator(".photo-indexing-job-row.queued")).toHaveCount(1);

    await indexingJobs.locator(".photo-indexing-job-row.failed").getByRole("button", { name: "Retry indexing job" }).click();
    await expect(indexingJobs.locator(".photo-indexing-job-row.failed")).toHaveCount(0, { timeout: 20_000 });
    await expect(completedOcrRows).toHaveCount(2);
    await expect(completedOcrRows.filter({ hasText: "attempts 2" })).toHaveCount(1);
    await expect(completedOcrRows.filter({ hasText: "last completed" })).toHaveCount(2);

    await indexingJobs.locator(".photo-indexing-job-row.queued").getByRole("button", { name: "Cancel indexing job" }).click();
    await expect(indexingJobs.locator(".photo-indexing-job-row.cancelled")).toHaveCount(1, { timeout: 20_000 });
    await expect(indexingJobs.locator(".photo-indexing-job-row.cancelled")).toContainText("last cancelled");
    await expect(settingsPanel.getByText(/cancelled 1/)).toBeVisible();
    await expect(indexingJobs.locator(".photo-indexing-job-row.cancelled").getByRole("button", { name: "Dismiss indexing job" })).toBeEnabled();
    await indexingJobs.locator(".photo-indexing-job-row.cancelled").getByRole("button", { name: "Dismiss indexing job" }).click();
    await expect(indexingJobs.locator(".photo-indexing-job-row.cancelled")).toHaveCount(0, { timeout: 20_000 });
    await expect(settingsPanel.getByText(/cancelled 0/)).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos headless local indexing scheduler runs queued jobs outside Photos view", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-headless-indexing-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["headless-ocr.png"]);
  writeFileSync(path.join(media, "headless-ocr.txt"), "Headless scheduler ticket 6249", "utf8");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_INITIAL_MS: "1000",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_INTERVAL_MS: "1000",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_BATCH_SIZE: "1",
    CROSSAGE_PHOTO_INDEXING_IGNORE_RUNTIME_POLICY: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
photo = media / "headless-ocr.png"
api = DesktopApi(workspace)
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": True,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": True,
        "indexingPowerMode": "low",
    }
})
api.import_photos({"sourcePaths": [str(photo)], "storageMode": "referenced", "sourceLabel": "Headless scheduler E2E"})
api.enqueue_photo_indexing_job({
    "jobKind": "ocr",
    "scope": {"sourcePaths": [str(photo)], "sidecarOnly": True, "language": "eng"},
})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#photos-local-settings")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const queue = await crossAge.invoke<{ value: { jobs?: Array<Record<string, any>> } }>("photo_indexing_jobs", { limit: 5 });
      const job = (queue.value.jobs || [])[0] || {};
      const search = await crossAge.invoke<{ groups?: Array<{ id?: string; items?: Array<{ sourcePath?: string }> }> }>("search_photo_library", {
        query: "Headless scheduler ticket 6249"
      });
      const found = Boolean((search.groups || []).find((group) => group.id === "photos")?.items?.length);
      return {
        status: String(job.status || ""),
        attempts: Number(job.attempts || 0),
        found
      };
    }), { timeout: 20_000 }).toEqual({ status: "completed", attempts: 1, found: true });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos headless local indexing scheduler respects battery runtime policy", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-headless-battery-skip-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["battery-skip-ocr.png"]);
  writeFileSync(path.join(media, "battery-skip-ocr.txt"), "Battery skipped scheduler ticket 7731", "utf8");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_INITIAL_MS: "1000",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_INTERVAL_MS: "1000",
    CROSSAGE_PHOTO_INDEXING_HEADLESS_BATCH_SIZE: "1",
    CROSSAGE_PHOTO_INDEXING_FORCE_BATTERY: "1",
    CROSSAGE_PHOTO_INDEXING_FORCE_IDLE_STATE: "active",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
photo = media / "battery-skip-ocr.png"
api = DesktopApi(workspace)
api.save_photo_library_settings({
    "localSettings": {
        "localIntelligenceEnabled": True,
        "noNetworkIntelligence": True,
        "backgroundIndexingPaused": False,
        "backgroundIndexingAutoRun": True,
        "indexingPowerMode": "balanced",
    }
})
api.import_photos({"sourcePaths": [str(photo)], "storageMode": "referenced", "sourceLabel": "Battery scheduler E2E"})
api.enqueue_photo_indexing_job({
    "jobKind": "ocr",
    "scope": {"sourcePaths": [str(photo)], "sidecarOnly": True, "language": "eng"},
})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("#photos-local-settings")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        getDiagnosticsReport(includePaths?: boolean): Promise<{ diagnostics?: { events?: Array<Record<string, any>> } }>;
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const report = await crossAge.getDiagnosticsReport(false);
      const skipEvent = (report.diagnostics?.events || []).find((event) => event.type === "photo_indexing_headless_runtime_skip");
      const queue = await crossAge.invoke<{ value: { jobs?: Array<Record<string, any>> } }>("photo_indexing_jobs", { limit: 5 });
      const job = (queue.value.jobs || [])[0] || {};
      return {
        status: String(job.status || ""),
        attempts: Number(job.attempts || 0),
        runtimeReason: String(skipEvent?.runtimeReason || "")
      };
    }), { timeout: 12_000 }).toEqual({ status: "queued", attempts: 0, runtimeReason: "battery" });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Places map supports modes zoom and nearby navigation", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-places-map-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["santa-one.png", "santa-two.png", "oakland.png", "paris.png", "hidden-place.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Places map E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const byName = (name: string) => paths.find((item) => item.endsWith(name));
      const updates = [
        ["santa-one.png", "Santa Cruz", 36.9741, -122.0308, "Boardwalk"],
        ["santa-two.png", "Santa Cruz", 36.9780, -122.0200, "Beach path"],
        ["oakland.png", "Oakland", 37.8044, -122.2712, "Oakland pier"],
        ["paris.png", "Paris", 48.8566, 2.3522, "Paris walk"],
        ["hidden-place.png", "Secret Point", 1, 2, "Hidden place"],
      ] as const;
      for (const [filename, label, latitude, longitude, title] of updates) {
        const sourcePath = byName(filename);
        if (!sourcePath) continue;
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title,
          locationOverride: { label, latitude, longitude },
          locationHidden: filename === "hidden-place.png",
        });
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; kind?: string; name?: string; count?: number }> }>("list_photo_folders", {});
      return result.folders
        .filter((folder) => folder.kind === "place")
        .map((folder) => `${folder.name}:${folder.count}`)
        .sort();
    }), { timeout: 20_000 }).toEqual(["Oakland:1", "Paris:1", "Santa Cruz:2"]);

    await rail.locator(".photo-rail-row-main").filter({ hasText: /^Places\s*\d+$/ }).click();
    const map = page.getByRole("region", { name: "Places map" });
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect(map).toContainText("3 places");
    await expect(map.getByRole("button", { name: "Pins" })).toBeVisible();
    await map.getByRole("button", { name: "Pins" }).click();
    await expect(map.getByRole("button", { name: "Open place Santa Cruz" })).toBeVisible();
    await expect(map.getByRole("button", { name: "Open place Oakland" })).toBeVisible();
    await expect(map.getByRole("button", { name: "Open place Paris" })).toBeVisible();
    await expect(map).not.toContainText("Secret Point");
    await map.getByRole("button", { name: "Density" }).click();
    await expect(map.getByRole("button", { name: /Open dense place area near/ }).first()).toBeVisible();
    await map.getByRole("button", { name: "Clusters" }).click();
    await expect(map.getByRole("button", { name: /Open (place|clustered places near) Santa Cruz/ })).toBeVisible();
    await map.getByRole("button", { name: "Zoom in" }).click();
    await expect(map.locator(".photo-place-map-zoom")).toHaveText("3x");
    await map.getByRole("button", { name: "Zoom out" }).click();
    await expect(map.locator(".photo-place-map-zoom")).toHaveText("2x");

    await map.getByRole("button", { name: "Pins" }).click();
    const santaCruzPin = map.getByRole("button", { name: "Open place Santa Cruz" });
    await santaCruzPin.locator("span").click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Santa Cruz", { timeout: 20_000 });
    await expect(tileByFilename(page, "Boardwalk")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Beach path")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Beach path").getByRole("button", { name: /Open photo/ }).click();
    const placeLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(placeLightbox.getByRole("button", { name: "Use as place cover" })).toBeVisible();
    await placeLightbox.getByRole("button", { name: "Use as place cover" }).click();
    await expect.poll(async () => {
      const place = await photoPlaceByName(page, "Santa Cruz");
      const keyAssetId = String(place?.placeProfile?.keyAssetId || place?.place?.placeProfile?.keyAssetId || "");
      const coverAssetId = String(place?.place?.coverAssetId || "");
      return {
        coverFile: String(place?.coverSourcePath || "").split(/[\\/]/).pop() || "",
        keyAssetIdSet: Boolean(keyAssetId),
        keyMatchesCover: Boolean(keyAssetId && coverAssetId && keyAssetId === coverAssetId),
      };
    }, { timeout: 20_000 }).toEqual(expect.objectContaining({
      coverFile: "santa-two.png",
      keyAssetIdSet: true,
      keyMatchesCover: true,
    }));
    await placeLightbox.getByRole("button", { name: "Close" }).click();
    await expect(placeLightbox).toHaveCount(0);
    await page.getByRole("button", { name: "Clear place cover" }).click();
    await expect.poll(async () => {
      const place = await photoPlaceByName(page, "Santa Cruz");
      return {
        coverFile: String(place?.coverSourcePath || "").split(/[\\/]/).pop() || "",
        keyAssetId: String(place?.placeProfile?.keyAssetId || place?.place?.placeProfile?.keyAssetId || ""),
      };
    }, { timeout: 20_000 }).toEqual({ coverFile: "santa-one.png", keyAssetId: "" });
    const nearby = map.locator(".photo-place-nearby");
    await expect(nearby.getByText("Nearby places")).toBeVisible();
    await expect(nearby.getByRole("button", { name: /Oakland/ })).toBeVisible();
    await nearby.getByRole("button", { name: /Oakland/ }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Oakland", { timeout: 20_000 });
    await expect(tileByFilename(page, "Oakland pier")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Oakland pier").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await lightbox.getByRole("button", { name: "Show nearby" }).click();
    await expect(lightbox).toHaveCount(0);
    await expect(page.locator(".photos-gallery-title")).toContainText("All Photos", { timeout: 20_000 });
    await expect(map.locator(".photo-place-map-radius")).toContainText("25 km");
    await expect(map.locator(".photo-place-map-radius-summary")).toContainText("Nearby radius 25 km");
    await expect(map.locator(".photo-place-map-radius-summary")).toContainText("1 place");
    const radiusPlaces = map.getByRole("group", { name: "Places in radius" });
    await expect(radiusPlaces).toBeVisible();
    await expect(radiusPlaces).toContainText("Oakland");
    await expect(radiusPlaces).not.toContainText("Santa Cruz");
    await expect(radiusPlaces).not.toContainText("Secret Point");
    await page.getByLabel("Nearby radius").getByRole("button", { name: "100 km" }).click();
    await expect(map.locator(".photo-place-map-radius")).toContainText("100 km");
    await expect(map.locator(".photo-place-map-radius-summary")).toContainText("100 km");
    await expect(radiusPlaces).toContainText("Santa Cruz");
    await expect(radiusPlaces).not.toContainText("Secret Point");
    await radiusPlaces.getByRole("button", { name: /Santa Cruz/ }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Santa Cruz", { timeout: 20_000 });
    await expect(tileByFilename(page, "Boardwalk")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos reverse place lookup previews and applies from the lightbox", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-reverse-geocode-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["gps-lookup.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_REVERSE_GEOCODE_FIXTURE_JSON: JSON.stringify({
      label: "Mock Harbor",
      provider: "offline-fixture",
      attribution: "Offline reverse geocode fixture"
    }),
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("save_photo_library_settings", {
        localSettings: {
          localIntelligenceEnabled: true,
          noNetworkIntelligence: false
        }
      });
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Reverse geocode E2E media"
      });
      const target = (imported.value.importedPaths || []).find((item) => /gps-lookup\.png$/.test(item));
      if (!target) throw new Error("Reverse geocode fixture photo did not import.");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: target,
        title: "GPS lookup target",
        locationOverride: { latitude: 36.9741, longitude: -122.0308 }
      });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "GPS lookup target")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "GPS lookup target").getByRole("button", { name: /Open photo/ }).click();

    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByLabel("Location", { exact: true })).toHaveValue("");
    await expect(lightbox.getByLabel("Latitude")).toHaveValue("36.9741");
    await expect(lightbox.getByLabel("Longitude")).toHaveValue("-122.0308");
    await expect(lightbox.getByRole("button", { name: "Look up place name" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Look up place name" }).click();
    await expect(lightbox.locator(".photo-metadata-status")).toContainText("Found Mock Harbor", { timeout: 20_000 });
    await expect(lightbox.getByRole("button", { name: "Apply place name" })).toBeVisible();
    await lightbox.getByRole("button", { name: "Apply place name" }).click();
    await expect(lightbox.getByLabel("Location", { exact: true })).toHaveValue("Mock Harbor");

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{
        items: Array<{ title?: string; locationOverride?: Record<string, unknown>; locationHidden?: boolean }>;
      }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const target = result.items.find((item) => item.title === "GPS lookup target");
      return {
        label: String(target?.locationOverride?.label || ""),
        provider: String(target?.locationOverride?.provider || ""),
        source: String(target?.locationOverride?.source || ""),
        hidden: Boolean(target?.locationHidden)
      };
    }), { timeout: 20_000 }).toEqual({
      label: "Mock Harbor",
      provider: "offline-fixture",
      source: "reverseGeocode",
      hidden: false
    });

    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos compact Places map supports modes radius results and density areas", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-places-map-compact-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["compact-santa.png", "compact-oakland.png", "compact-oakland-two.png", "compact-berkeley.png", "compact-paris.png", "compact-hidden.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Compact Places map E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const byName = (name: string) => paths.find((item) => item.endsWith(name));
      const updates = [
        ["compact-santa.png", "Compact Santa Cruz", 36.9741, -122.0308, "Compact Boardwalk"],
        ["compact-oakland.png", "Compact Oakland", 37.8044, -122.2712, "Compact Oakland pier"],
        ["compact-oakland-two.png", "Compact Oakland", 37.8052, -122.2697, "Compact Oakland ferry"],
        ["compact-berkeley.png", "Compact Berkeley", 37.8715, -122.2730, "Compact Berkeley walk"],
        ["compact-paris.png", "Compact Paris", 48.8566, 2.3522, "Compact Paris walk"],
        ["compact-hidden.png", "Compact Secret", 37.8050, -122.2700, "Compact hidden place"],
      ] as const;
      for (const [filename, label, latitude, longitude, title] of updates) {
        const sourcePath = byName(filename);
        if (!sourcePath) continue;
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath,
          title,
          locationOverride: { label, latitude, longitude },
          locationHidden: filename === "compact-hidden.png",
        });
      }
    }, { mediaFolder: media });

    await page.setViewportSize({ width: 900, height: 620 });
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; kind?: string; name?: string; count?: number }> }>("list_photo_folders", {});
      return result.folders
        .filter((folder) => folder.kind === "place")
        .map((folder) => `${folder.name}:${folder.count}`)
        .sort();
    }), { timeout: 20_000 }).toEqual(["Compact Berkeley:1", "Compact Oakland:2", "Compact Paris:1", "Compact Santa Cruz:1"]);

    await rail.locator(".photo-rail-row-main").filter({ hasText: /^Places\s*\d+$/ }).click();
    const map = page.getByRole("region", { name: "Places map" });
    await expect(map).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 390, height: 740 });
    await expect(map).toContainText("4 places");
    await expect(map).not.toContainText("Compact Secret");

    await expect.poll(async () => map.evaluate((node) => {
      const element = node as HTMLElement;
      const controls = element.querySelector(".photo-place-map-controls") as HTMLElement | null;
      const canvas = element.querySelector(".photo-place-map-canvas") as HTMLElement | null;
      return {
        panelWidth: Math.round(element.getBoundingClientRect().width),
        controlsOverflow: controls ? Math.ceil(controls.scrollWidth - controls.clientWidth) : 0,
        canvasOverflow: canvas ? Math.ceil(canvas.scrollWidth - canvas.clientWidth) : 0,
      };
    }), { timeout: 10_000 }).toEqual(expect.objectContaining({
      panelWidth: expect.any(Number),
      controlsOverflow: 0,
      canvasOverflow: 0,
    }));

    await map.getByRole("button", { name: "Density" }).click();
    await expect(map.locator(".photo-place-map-density").first()).toBeVisible({ timeout: 10_000 });
    const areaPanel = map.locator(".photo-place-map-areas");
    await expect(areaPanel).toBeVisible();
    await expect(areaPanel.getByRole("button").first()).toContainText(/Compact/);

    await areaPanel.getByRole("button").filter({ hasText: "Compact Oakland" }).first().click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Compact Oakland", { timeout: 20_000 });
    await expect(tileByFilename(page, "Compact Oakland pier")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Compact Oakland pier").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await lightbox.getByRole("button", { name: "Show nearby" }).click();
    await expect(lightbox).toHaveCount(0);

    await expect(page.locator(".photos-gallery-title")).toContainText("All Photos", { timeout: 20_000 });
    await expect(map.locator(".photo-place-map-radius-summary")).toContainText("25 km");
    const radiusPlaces = map.getByRole("group", { name: "Places in radius" });
    await expect(radiusPlaces).toBeVisible();
    await expect(radiusPlaces).toContainText("Compact Oakland");
    await expect(radiusPlaces).toContainText("Compact Berkeley");
    await expect(radiusPlaces).not.toContainText("Compact Santa Cruz");
    await expect(radiusPlaces).not.toContainText("Compact Secret");
    await expect.poll(async () => radiusPlaces.evaluate((node) => {
      const element = node as HTMLElement;
      return Math.ceil(element.scrollWidth - element.clientWidth);
    }), { timeout: 10_000 }).toBe(0);

    await page.getByLabel("Nearby radius").getByRole("button", { name: "100 km" }).click();
    await expect(radiusPlaces).toContainText("Compact Santa Cruz");
    await radiusPlaces.getByRole("button", { name: /Compact Santa Cruz/ }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Compact Santa Cruz", { timeout: 20_000 });
    await expect(tileByFilename(page, "Compact Boardwalk")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Places map stays responsive for large local place sets", async () => {
  test.setTimeout(120_000);
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-places-map-scale-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const placeCountRaw = Number(process.env.VINTRACE_E2E_PLACES_MAP_SCALE_COUNT || "180");
  const placeCount = Number.isFinite(placeCountRaw) && placeCountRaw > 20 ? Math.round(placeCountRaw) : 180;
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, String.raw`
import json
import sys
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.workspace_registry import now_iso

workspace = Path(sys.argv[1])
count = int(sys.argv[2])
api = DesktopApi(workspace, actor="places-map-scale-seed")
timestamp = now_iso()
asset_rows = []
metadata_rows = []
for index in range(count):
    row = index // 30
    column = index % 30
    latitude = 25.0 + row * 0.11 + (column % 5) * 0.003
    longitude = -124.0 + column * 0.16
    asset_id = f"place_scale_{index:04d}"
    source_path = f"/synthetic/no-photo-used/places-map-scale/photo-{index:04d}.jpg"
    label = f"Scale Place {index:04d}"
    asset_rows.append((
        asset_id,
        source_path,
        "referenced",
        json.dumps({"pathKey": source_path, "size": 1024 + index, "mtimeNs": 1800000000000000000 + index}, separators=(",", ":")),
        f"scale-place-hash-{index:04d}",
        "",
        "image",
        "image/jpeg",
        1200,
        800,
        None,
        f"2026-06-{(index % 28) + 1:02d}T12:00:00Z",
        timestamp,
        timestamp,
        None,
        "places-map-scale",
        json.dumps({"location": {"label": label, "latitude": latitude, "longitude": longitude}}, separators=(",", ":")),
    ))
    metadata_rows.append((
        asset_id,
        f"Scale place photo {index:04d}",
        "Synthetic map browser scale row",
        0,
        0,
        None,
        None,
        json.dumps({"label": label, "latitude": latitude, "longitude": longitude}, separators=(",", ":")),
        0,
        0,
        timestamp,
    ))
with api.project.db.connect() as conn:
    conn.executemany(
        """
        INSERT OR REPLACE INTO photo_assets(
            asset_id, source_path, source_kind, file_signature_json, content_hash,
            perceptual_hash, media_kind, mime_type, width, height, duration_ms,
            capture_date, added_at, updated_at, missing_at, source_scan_run,
            metadata_json
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        asset_rows,
    )
    conn.executemany(
        """
        INSERT OR REPLACE INTO photo_asset_metadata(
            asset_id, title, caption, favorite, hidden, deleted_at, date_override,
            location_override_json, location_hidden, edited, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        metadata_rows,
    )
    api.project.db.rebuild_photo_search_index(conn)
`, [workspace, String(placeCount)]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ kind?: string }> }>("list_photo_folders", { coverPreviewBudget: 0 });
      return result.folders.filter((folder) => folder.kind === "place").length;
    }), { timeout: 20_000 }).toBe(placeCount);

    const rail = page.locator(".photos-rail");
    const openStarted = Date.now();
    await rail.locator(".photo-rail-row-main").filter({ hasText: /^Places\s*\d+$/ }).click();
    const map = page.getByRole("region", { name: "Places map" });
    await expect(map).toBeVisible({ timeout: 20_000 });
    await expect(map).toContainText(`${placeCount} places`);
    const openElapsed = Date.now() - openStarted;
    expect(openElapsed).toBeLessThanOrEqual(e2eBudgetMs("places_map_open", 20_000));

    const clusteredPins = await map.locator(".photo-place-map-dot").count();
    expect(clusteredPins).toBeGreaterThan(0);
    expect(clusteredPins).toBeLessThan(placeCount);

    const densityStarted = Date.now();
    await map.getByRole("button", { name: "Density" }).click();
    await expect(map.locator(".photo-place-map-density").first()).toBeVisible({ timeout: 10_000 });
    const densityElapsed = Date.now() - densityStarted;
    const densityCount = await map.locator(".photo-place-map-density").count();
    expect(densityCount).toBeGreaterThan(1);
    expect(densityCount).toBeLessThanOrEqual(36);
    expect(densityElapsed).toBeLessThanOrEqual(e2eBudgetMs("places_map_density", 8_000));
    const areaPanel = map.locator(".photo-place-map-areas");
    await expect(areaPanel).toBeVisible();
    await expect(areaPanel.getByRole("button").first()).toContainText(/place/);
    await areaPanel.getByRole("button").first().click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Scale Place", { timeout: 10_000 });

    const pinsStarted = Date.now();
    await map.getByRole("button", { name: "Pins" }).click();
    await expect(map.locator(".photo-place-map-dot")).toHaveCount(placeCount, { timeout: 10_000 });
    const pinsElapsed = Date.now() - pinsStarted;
    expect(pinsElapsed).toBeLessThanOrEqual(e2eBudgetMs("places_map_pins", 8_000));
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos smart albums support visual query builder and saved search creation", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-smart-query-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const advancedMedia = path.join(temp, "advanced-media");
  writePhotoFixtureSet(media, ["harbor.png", "quiet.png", "pier.png", "family-recent.png", "family-old.png", "work-recent.png"]);
  writeVideoFixtureSet(media, ["family-clip.mp4"]);
  writePhotoFixtureSet(advancedMedia, [
    "advanced-ticket.png",
    "advanced-draft.png",
    "advanced-far.png",
    "advanced-low-confidence.png",
    "iptc-harbor.png",
    "iptc-archive.png"
  ]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, String.raw`
from pathlib import Path
import json
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature
from crossage_fr.workspace_registry import now_iso

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "smart-query-advanced-e2e"
timestamp = now_iso()
api.project.db.create_scan_run(run_id, "Smart Query Advanced E2E", "manual", str(media))

base_location = {"label": "Santa Cruz Harbor", "latitude": 36.9741, "longitude": -122.0308}
rows = [
    {
        "name": "advanced-ticket.png",
        "title": "Advanced ticket harbor",
        "location": base_location,
        "width": 4000,
        "height": 3000,
        "duration_ms": 9000,
        "metadata": {
            "ocrText": "Boarding pass ticket number VX-42",
            "textRegions": [{"text": "ticket number VX-42", "confidence": 0.94}],
            "detectedItems": [{"label": "surfboard", "confidence": 0.95}],
            "objectTags": [{"label": "surfboard", "confidence": 0.95}],
            "imageDescription": "Surfboard beside a harbor ticket booth",
            "exif": {"cameraMake": "SearchCo", "cameraModel": "SearchCam 1000", "lensModel": "Prime Lens 50mm"},
            "lens": {"name": "Prime Lens 50mm"},
        },
    },
    {
        "name": "advanced-draft.png",
        "title": "Advanced draft harbor",
        "location": base_location,
        "width": 1920,
        "height": 1080,
        "duration_ms": 9000,
        "metadata": {
            "ocrText": "Boarding pass ticket number VX-42",
            "textRegions": [{"text": "ticket number VX-42", "confidence": 0.93}],
            "detectedItems": [{"label": "surfboard", "confidence": 0.94}],
            "objectTags": [{"label": "surfboard", "confidence": 0.94}],
            "imageDescription": "Draft camera harbor ticket frame",
            "exif": {"cameraMake": "DraftCo", "cameraModel": "DraftCam", "lensModel": "Kit Lens"},
            "lens": {"name": "Kit Lens"},
        },
    },
    {
        "name": "advanced-far.png",
        "title": "Advanced far harbor",
        "location": {"label": "Far Harbor", "latitude": 40.7128, "longitude": -74.0060},
        "width": 4000,
        "height": 3000,
        "duration_ms": 9000,
        "metadata": {
            "ocrText": "Boarding pass ticket number VX-42",
            "textRegions": [{"text": "ticket number VX-42", "confidence": 0.94}],
            "detectedItems": [{"label": "surfboard", "confidence": 0.95}],
            "objectTags": [{"label": "surfboard", "confidence": 0.95}],
            "imageDescription": "Surfboard beside a distant harbor ticket booth",
            "exif": {"cameraMake": "SearchCo", "cameraModel": "SearchCam 1000", "lensModel": "Prime Lens 50mm"},
            "lens": {"name": "Prime Lens 50mm"},
        },
    },
    {
        "name": "advanced-low-confidence.png",
        "title": "Advanced low confidence",
        "location": base_location,
        "width": 4000,
        "height": 3000,
        "duration_ms": 9000,
        "metadata": {
            "ocrText": "Boarding pass ticket number VX-42",
            "textRegions": [{"text": "ticket number VX-42", "confidence": 0.52}],
            "detectedItems": [{"label": "surfboard", "confidence": 0.53}],
            "objectTags": [{"label": "surfboard", "confidence": 0.53}],
            "imageDescription": "Low-confidence harbor ticket frame",
            "exif": {"cameraMake": "SearchCo", "cameraModel": "SearchCam 1000", "lensModel": "Prime Lens 50mm"},
            "lens": {"name": "Prime Lens 50mm"},
        },
    },
    {
        "name": "iptc-harbor.png",
        "title": "IPTC smart harbor",
        "location": base_location,
        "width": 2400,
        "height": 1600,
        "duration_ms": 0,
        "metadata": {
            "xmp": {
                "iptc": {
                    "creator": ["Harbor Studio", "A. Editor"],
                    "credit": "Unit News",
                    "source": "Harbor Archive",
                    "copyright": "Copyright 2026 Harbor Studio",
                    "usageTerms": "Editorial use only",
                    "event": "Bay Lights Opening",
                    "headline": "Ferry headline",
                    "jobId": "JOB-42",
                    "instructions": "Ask before syndication",
                    "locationCreated": {
                        "sublocation": "Ferry Building",
                        "city": "San Francisco",
                        "state": "California",
                        "country": "United States",
                        "countryCode": "US",
                    },
                },
            },
        },
    },
    {
        "name": "iptc-archive.png",
        "title": "IPTC archive room",
        "location": {"label": "Oakland Archive", "latitude": 37.8044, "longitude": -122.2712},
        "width": 2400,
        "height": 1600,
        "duration_ms": 0,
        "metadata": {
            "iptc": {
                "creator": "City Archivist",
                "credit": "Museum Desk",
                "source": "Historical Archive",
                "rights": "Public domain review",
                "usageTerms": "Research desk only",
                "event": "Archive Intake",
                "locationCreated": {
                    "sublocation": "Reading Room",
                    "city": "Oakland",
                    "country": "United States",
                },
            },
        },
    },
]

asset_sizes = []
for row in rows:
    path = media / row["name"]
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")
    source_path = str(path)
    api.update_photo_asset_metadata({
        "sourcePath": source_path,
        "title": row["title"],
        "dateOverride": "2026-06-24",
        "locationOverride": row["location"],
    })
    asset = api.project.db.photo_asset_by_path(source_path)
    if not asset:
        raise RuntimeError(f"Missing advanced smart-query asset: {row['name']}")
    api.project.db.update_photo_asset_metadata_json(asset_id=asset["assetId"], patch=row["metadata"])
    asset_sizes.append((row["width"], row["height"], row["duration_ms"], asset["assetId"]))

with api.project.db.connect() as conn:
    for width, height, duration_ms, asset_id in asset_sizes:
        conn.execute(
            """
            UPDATE photo_assets
            SET width = ?, height = ?, duration_ms = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (width, height, duration_ms, timestamp, asset_id),
        )
    api.project.db.rebuild_photo_search_index(conn)
`, [workspace, advancedMedia]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Smart query E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const harbor = paths.find((item) => /harbor\.png$/.test(item));
      const quiet = paths.find((item) => /quiet\.png$/.test(item));
      const pier = paths.find((item) => /pier\.png$/.test(item));
      const familyRecent = paths.find((item) => /family-recent\.png$/.test(item));
      const familyOld = paths.find((item) => /family-old\.png$/.test(item));
      const familyClip = paths.find((item) => /family-clip\.mp4$/.test(item));
      const workRecent = paths.find((item) => /work-recent\.png$/.test(item));
      if (harbor) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: harbor,
          title: "Harbor sunset",
          favorite: true
        });
      }
      if (quiet) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: quiet,
          title: "Quiet cove"
        });
      }
      if (pier) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: pier,
          title: "Harbor pier"
        });
      }
      if (familyRecent) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: familyRecent,
          title: "Family June beach",
          keywords: ["family"],
          dateOverride: "2026-06-20"
        });
      }
      if (familyOld) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: familyOld,
          title: "Family archive",
          keywords: ["family"],
          dateOverride: "2025-01-01"
        });
      }
      if (familyClip) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: familyClip,
          title: "Family clip",
          keywords: ["family"],
          dateOverride: "2025-01-01"
        });
      }
      if (workRecent) {
        await crossAge.invoke("update_photo_asset_metadata", {
          sourcePath: workRecent,
          title: "Work June beach",
          keywords: ["work"],
          dateOverride: "2026-06-20"
        });
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Harbor sunset")).toBeVisible({ timeout: 20_000 });

    await page.locator(".photo-album-toolbar").getByRole("button", { name: "New album" }).click();
    const editor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await editor.getByLabel("Album name").fill("Visual Smart Harbor");
    const builder = editor.locator(".photo-smart-query-builder");
    await builder.getByLabel("Rule field").first().selectOption("title");
    await builder.getByLabel("Rule value").first().fill("Harbor");
    await builder.getByRole("button", { name: "Add rule" }).click();
    const secondRule = builder.locator(".photo-smart-query-rule").nth(1);
    await secondRule.getByLabel("Rule field").selectOption("favorite");
    await secondRule.getByLabel("Rule value").selectOption("true");
    await expect(builder.locator(".photo-smart-query-preview")).toContainText("1 match", { timeout: 20_000 });
    await expect(builder.locator(".photo-smart-query-preview")).toContainText("Harbor sunset");
    await editor.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => photoAlbumByName(page, "Visual Smart Harbor"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 1,
      rules: expect.objectContaining({
        op: "all",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "title", operator: "contains", value: "Harbor" }),
          expect.objectContaining({ field: "favorite", operator: "is", value: true })
        ])
      })
    }));
    await page.locator(".photos-rail").getByText("Visual Smart Harbor", { exact: true }).click();
    await expect(tileByFilename(page, "Harbor sunset")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor pier")).toHaveCount(0);

    await tileByFilename(page, "Harbor sunset").getByRole("button", { name: /Open photo/ }).click();
    const smartAlbumLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(smartAlbumLightbox).toContainText("Album membership");
    const smartAlbumMembership = smartAlbumLightbox.locator(".photos-album-membership-row").filter({ hasText: "Visual Smart Harbor" });
    await expect(smartAlbumMembership).toContainText("Smart match");
    await expect(smartAlbumMembership).toContainText("Read-only");
    await smartAlbumLightbox.getByLabel("Album membership filter").selectOption("smart");
    await expect(smartAlbumMembership).toBeVisible();
    await smartAlbumMembership.getByRole("button", { name: "Open" }).click();
    await expect(smartAlbumLightbox).toHaveCount(0);
    await expect(page.locator(".photos-gallery-title")).toContainText("Visual Smart Harbor");

    await page.locator(".photo-album-toolbar").getByRole("button", { name: "New album" }).click();
    const nestedEditor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await nestedEditor.getByLabel("Album name").fill("Visual Smart Family Media");
    const nestedBuilder = nestedEditor.locator(".photo-smart-query-builder");
    await nestedBuilder.getByLabel("Rule field").first().selectOption("keyword");
    await nestedBuilder.getByLabel("Rule operator").first().selectOption("is");
    await nestedBuilder.getByLabel("Rule value").first().fill("family");
    await nestedBuilder.getByRole("button", { name: "Add group" }).first().click();
    const nestedGroup = nestedBuilder.locator(".photo-smart-query-group.nested").first();
    await nestedGroup.getByLabel("Group match").selectOption("any");
    const nestedFirstRule = nestedGroup.locator(".photo-smart-query-rule").nth(0);
    await nestedFirstRule.getByLabel("Rule field").selectOption("mediaKind");
    await nestedFirstRule.getByLabel("Rule value").selectOption("video");
    await nestedGroup.getByRole("button", { name: "Add rule" }).click();
    const nestedSecondRule = nestedGroup.locator(".photo-smart-query-rule").nth(1);
    await nestedSecondRule.getByLabel("Rule field").selectOption("date");
    await nestedSecondRule.getByLabel("Rule value").fill("2026-06-01");
    await expect(nestedBuilder.locator(".photo-smart-query-preview")).toContainText("2 matches", { timeout: 20_000 });
    await expect(nestedBuilder.locator(".photo-smart-query-preview")).toContainText("Family June beach");
    await expect(nestedBuilder.locator(".photo-smart-query-preview")).toContainText("Family clip");
    await nestedEditor.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => photoAlbumByName(page, "Visual Smart Family Media"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      rules: expect.objectContaining({
        op: "all",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "keyword", operator: "is", value: "family" }),
          expect.objectContaining({
            op: "any",
            conditions: expect.arrayContaining([
              expect.objectContaining({ field: "mediaKind", operator: "is", value: "video" }),
              expect.objectContaining({ field: "date", operator: "onOrAfter", value: "2026-06-01" })
            ])
          })
        ])
      })
    }));
    await page.locator(".photos-rail").getByText("Visual Smart Family Media", { exact: true }).click();
    await expect(tileByFilename(page, "Family June beach")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Family clip")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Family archive")).toHaveCount(0);
    await expect(tileByFilename(page, "Work June beach")).toHaveCount(0);

    const actions = page.locator(".photos-gallery-actions");
    await actions.getByRole("button", { name: "Edit" }).click();
    const editNestedEditor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await expect(editNestedEditor.getByLabel("Album name")).toHaveValue("Visual Smart Family Media");
    const editNestedBuilder = editNestedEditor.locator(".photo-smart-query-builder");
    const editNestedGroup = editNestedBuilder.locator(".photo-smart-query-group.nested").first();
    await editNestedGroup.getByLabel("Group match").selectOption("all");
    await expect(editNestedBuilder.locator(".photo-smart-query-preview")).toContainText("0 matches", { timeout: 20_000 });
    await editNestedGroup.getByLabel("Group match").selectOption("any");
    await editNestedGroup.locator(".photo-smart-query-rule").nth(1).getByRole("button", { name: "Remove rule" }).click();
    await expect(editNestedBuilder.locator(".photo-smart-query-preview")).toContainText("1 match", { timeout: 20_000 });
    await expect(editNestedBuilder.locator(".photo-smart-query-preview")).toContainText("Family clip");
    await editNestedEditor.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => {
      const album = await photoAlbumByName(page, "Visual Smart Family Media") as Record<string, any> | null;
      const rules = album?.rules as Record<string, any> | undefined;
      const conditions = Array.isArray(rules?.conditions) ? rules.conditions as Array<Record<string, any>> : [];
      const group = conditions.find((condition) => condition.op === "any");
      const groupConditions = Array.isArray(group?.conditions) ? group.conditions as Array<Record<string, any>> : [];
      return {
        count: album?.count ?? -1,
        groupSize: groupConditions.length,
        hasDate: groupConditions.some((condition) => condition.field === "date"),
        hasVideo: groupConditions.some((condition) => condition.field === "mediaKind" && condition.value === "video"),
      };
    }, { timeout: 20_000 }).toEqual({
      count: 1,
      groupSize: 1,
      hasDate: false,
      hasVideo: true,
    });
    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.locator(".photos-rail").getByText("Visual Smart Family Media", { exact: true }).click();
    await expect(tileByFilename(page, "Family clip")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Family June beach")).toHaveCount(0);

    await page.locator(".photo-album-toolbar").getByRole("button", { name: "New album" }).click();
    const advancedEditor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await advancedEditor.getByLabel("Album name").fill("Visual Smart Advanced Signals");
    const advancedBuilder = advancedEditor.locator(".photo-smart-query-builder");
    await setSmartQueryRule(advancedBuilder.locator(".photo-smart-query-rule").first(), "ocrText", "contains", "ticket number");
    await addSmartQueryRule(advancedBuilder, "ocrConfidence", "atLeast", 0.9);
    await addSmartQueryRule(advancedBuilder, "detectedItem", "contains", "surfboard");
    await addSmartQueryRule(advancedBuilder, "detectedItemConfidence", "atLeast", 0.9);
    await addSmartQueryRule(advancedBuilder, "nearby", "is", "36.9741,-122.0308,2");
    await addSmartQueryRule(advancedBuilder, "camera", "isNot", "DraftCam");
    await addSmartQueryRule(advancedBuilder, "durationMs", "atMost", 10000);
    await advancedBuilder.getByRole("button", { name: "Add group" }).first().click();
    const advancedNestedGroup = advancedBuilder.locator(".photo-smart-query-group.nested").first();
    await advancedNestedGroup.getByLabel("Group match").selectOption("any");
    await setSmartQueryRule(advancedNestedGroup.locator(".photo-smart-query-rule").first(), "lens", "contains", "Prime Lens");
    await addSmartQueryRule(advancedNestedGroup, "imageDescription", "contains", "ticket booth");
    await expect(advancedBuilder.locator(".photo-smart-query-preview")).toContainText("1 match", { timeout: 20_000 });
    await expect(advancedBuilder.locator(".photo-smart-query-preview")).toContainText("Advanced ticket harbor");
    await advancedEditor.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => photoAlbumByName(page, "Visual Smart Advanced Signals"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 1,
      rules: expect.objectContaining({
        op: "all",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "ocrText", operator: "contains", value: "ticket number" }),
          expect.objectContaining({ field: "ocrConfidence", operator: "atLeast", value: 0.9 }),
          expect.objectContaining({ field: "detectedItem", operator: "contains", value: "surfboard" }),
          expect.objectContaining({ field: "detectedItemConfidence", operator: "atLeast", value: 0.9 }),
          expect.objectContaining({ field: "nearby", operator: "is", value: "36.9741,-122.0308,2" }),
          expect.objectContaining({ field: "camera", operator: "isNot", value: "DraftCam" }),
          expect.objectContaining({ field: "durationMs", operator: "atMost", value: 10000 }),
          expect.objectContaining({
            op: "any",
            conditions: expect.arrayContaining([
              expect.objectContaining({ field: "lens", operator: "contains", value: "Prime Lens" }),
              expect.objectContaining({ field: "imageDescription", operator: "contains", value: "ticket booth" })
            ])
          })
        ])
      })
    }));
    await page.locator(".photos-rail").getByText("Visual Smart Advanced Signals", { exact: true }).click();
    await expect(tileByFilename(page, "Advanced ticket harbor")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Advanced draft harbor")).toHaveCount(0);
    await expect(tileByFilename(page, "Advanced far harbor")).toHaveCount(0);
    await expect(tileByFilename(page, "Advanced low confidence")).toHaveCount(0);

    await page.locator(".photo-album-toolbar").getByRole("button", { name: "New album" }).click();
    const iptcEditor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await iptcEditor.getByLabel("Album name").fill("Visual Smart IPTC Signals");
    const iptcBuilder = iptcEditor.locator(".photo-smart-query-builder");
    await setSmartQueryRule(iptcBuilder.locator(".photo-smart-query-rule").first(), "iptcCreator", "contains", "Unit News");
    await addSmartQueryRule(iptcBuilder, "iptcRights", "contains", "Editorial use");
    await addSmartQueryRule(iptcBuilder, "iptcEvent", "is", "Bay Lights Opening");
    await addSmartQueryRule(iptcBuilder, "iptcLocation", "notContains", "Oakland");
    await expect(iptcBuilder.locator(".photo-smart-query-preview")).toContainText("1 match", { timeout: 20_000 });
    await expect(iptcBuilder.locator(".photo-smart-query-preview")).toContainText("IPTC smart harbor");
    await iptcEditor.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => photoAlbumByName(page, "Visual Smart IPTC Signals"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 1,
      rules: expect.objectContaining({
        op: "all",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "iptcCreator", operator: "contains", value: "Unit News" }),
          expect.objectContaining({ field: "iptcRights", operator: "contains", value: "Editorial use" }),
          expect.objectContaining({ field: "iptcEvent", operator: "is", value: "Bay Lights Opening" }),
          expect.objectContaining({ field: "iptcLocation", operator: "notContains", value: "Oakland" })
        ])
      })
    }));
    await page.locator(".photos-rail").getByText("Visual Smart IPTC Signals", { exact: true }).click();
    await expect(tileByFilename(page, "IPTC smart harbor")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "IPTC archive room")).toHaveCount(0);

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.getByLabel("Search photos").fill("Harbor");
    await page.getByRole("checkbox", { name: "Favorites", exact: true }).check();
    await page.getByRole("button", { name: "Save search" }).click();
    const savedSearchName = "Saved search: Harbor + Favorites";
    await expect.poll(async () => photoAlbumByName(page, savedSearchName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 1,
      rules: expect.objectContaining({
        op: "all",
        conditions: expect.arrayContaining([
          expect.objectContaining({ field: "query", operator: "contains", value: "Harbor" }),
          expect.objectContaining({ field: "favorite", operator: "is", value: true })
        ])
      })
    }));
    await expect(page.locator(".photos-rail").getByText(savedSearchName, { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos album editor edits duplicates merges and deletes manual albums", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-album-editor-crud-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["crud-alpha.png", "crud-beta.png", "crud-gamma.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const sourceName = "Album Editor Source";
    const targetName = "Album Editor Target";
    const renamedName = "Album Editor Renamed";
    const duplicateName = `${renamedName} copy`;
    const editedDescription = "Edited through toolbar";

    const seeded = await page.evaluate(async ({ mediaFolder, sourceAlbumName, targetAlbumName }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Album editor CRUD E2E media"
      });
      const byName = Object.fromEntries((imported.value.importedPaths || []).map((sourcePath) => [
        String(sourcePath).split(/[\\/]/).pop() || sourcePath,
        sourcePath
      ]));
      const source = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: sourceAlbumName,
        albumKind: "manual",
        description: "Original editor description"
      });
      const target = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: targetAlbumName,
        albumKind: "manual",
        description: "Target editor description"
      });
      await crossAge.invoke("add_photo_album_items", {
        albumId: source.value.albumId,
        sourcePaths: [byName["crud-alpha.png"], byName["crud-beta.png"]]
      });
      await crossAge.invoke("add_photo_album_items", {
        albumId: target.value.albumId,
        sourcePaths: [byName["crud-gamma.png"]]
      });
      return { targetAlbumId: target.value.albumId };
    }, { mediaFolder: media, sourceAlbumName: sourceName, targetAlbumName: targetName });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    const actions = page.locator(".photos-gallery-actions");
    await rail.getByText(sourceName, { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText(sourceName, { timeout: 20_000 });

    await actions.getByRole("button", { name: "Edit" }).click();
    const editor = page.locator(".photo-album-editor").filter({ has: page.getByLabel("Album name") });
    await expect(editor.getByLabel("Album name")).toHaveValue(sourceName);
    await editor.getByLabel("Album name").fill(renamedName);
    await editor.getByLabel("Album description").fill(editedDescription);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => photoAlbumByName(page, renamedName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      albumKind: "manual",
      count: 2,
      description: editedDescription
    }));
    await expect.poll(async () => photoAlbumByName(page, sourceName), { timeout: 20_000 }).toBeNull();
    await expect(page.locator(".photos-gallery-title")).toContainText(renamedName, { timeout: 20_000 });
    await expect(page.locator(".photos-gallery-title")).toContainText(editedDescription);

    await actions.getByRole("button", { name: "Duplicate" }).click();
    await expect(editor.getByLabel("Album name")).toHaveValue(duplicateName);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => photoAlbumByName(page, duplicateName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      albumKind: "manual",
      count: 2
    }));
    const duplicateAlbum = await photoAlbumByName(page, duplicateName);
    expect(duplicateAlbum?.albumId).toBeTruthy();
    await expect.poll(async () => manualAlbumFilenames(page, String(duplicateAlbum?.albumId || ""))).toEqual([
      "crud-alpha.png",
      "crud-beta.png"
    ]);

    await page.getByLabel("Merge into album").selectOption({ label: targetName });
    await actions.getByRole("button", { name: "Merge" }).click();
    await expect.poll(async () => photoAlbumByName(page, duplicateName), { timeout: 20_000 }).toBeNull();
    await expect.poll(async () => photoAlbumByName(page, targetName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      albumKind: "manual",
      count: 3
    }));
    await expect.poll(async () => manualAlbumFilenames(page, seeded.targetAlbumId)).toEqual([
      "crud-gamma.png",
      "crud-alpha.png",
      "crud-beta.png"
    ]);

    await rail.getByText(renamedName, { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText(renamedName, { timeout: 20_000 });
    await actions.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(async () => photoAlbumByName(page, renamedName), { timeout: 20_000 }).toBeNull();
    await expect(page.locator(".photos-gallery-title")).toContainText("All Photos", { timeout: 20_000 });
    await expect.poll(async () => photoAlbumByName(page, targetName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 3
    }));

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos video lightbox exposes play scrub mute and keyboard controls", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-video-lightbox-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writeVideoFixtureSet(media, ["clip.mp4"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await installMockVideoElementState(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Video lightbox E2E media"
      });
      const clip = (imported.value.importedPaths || []).find((item) => /clip\.mp4$/.test(item));
      if (!clip) throw new Error("Missing imported video fixture");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: clip, title: "Clip controls" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Clip controls")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Clip controls").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    const video = lightbox.getByLabel("Video preview");
    await expect(video).toBeVisible();
    await video.evaluate((node) => node.dispatchEvent(new Event("loadedmetadata")));

    const controls = lightbox.locator(".photos-lightbox-video-controls");
    await expect(controls.getByRole("button", { name: "Play video" })).toBeVisible();
    await expect(controls.getByLabel("Scrub video")).toHaveAttribute("max", "4000");
    await expect(controls).toContainText("0s");
    await expect(controls).toContainText("4s");

    await controls.getByRole("button", { name: "Play video" }).click();
    await expect(controls.getByRole("button", { name: "Pause video" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(controls.getByRole("button", { name: "Play video" })).toBeVisible();

    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toBeHidden();
    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const settingsPanel = page.locator("#photos-local-settings");
    await expect(settingsPanel).toBeVisible({ timeout: 20_000 });
    const pauseBackgroundToggle = settingsPanel.getByLabel("Pause video when backgrounded");
    await expect(pauseBackgroundToggle).toBeChecked();
    await pauseBackgroundToggle.uncheck();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { localSettings?: { pauseVideoWhenBackgrounded?: boolean } } }>("photo_library_settings", {});
      return result.value.localSettings?.pauseVideoWhenBackgrounded;
    }), { timeout: 20_000 }).toBe(false);
    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();

    await tileByFilename(page, "Clip controls").getByRole("button", { name: /Open photo/ }).click();
    await expect(lightbox).toBeVisible();
    await expect(video).toBeVisible();
    await video.evaluate((node) => node.dispatchEvent(new Event("loadedmetadata")));
    await controls.getByRole("button", { name: "Play video" }).click();
    await expect(controls.getByRole("button", { name: "Pause video" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(controls.getByRole("button", { name: "Pause video" })).toBeVisible();
    await controls.getByLabel("Scrub video").evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "2000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(controls).toContainText("2s");
    await expect(controls.getByRole("button", { name: "Mark video trim start" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Mark video trim end" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Export selected video trim" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Rotate video export" })).toBeVisible();
    await expect(controls.getByLabel("Video crop aspect")).toBeVisible();
    const trimTimeline = controls.getByRole("group", { name: "Video trim timeline" });
    await expect(trimTimeline).toBeVisible();
    const trimStartHandle = trimTimeline.getByLabel("Video trim start handle");
    const trimEndHandle = trimTimeline.getByLabel("Video trim end handle");
    await expect(trimStartHandle).toHaveValue("0");
    await expect(trimEndHandle).toHaveValue("4000");
    await trimStartHandle.evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "1000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(trimStartHandle).toHaveValue("1000");
    await expect(controls).toContainText("1s-4s");
    await trimEndHandle.evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "3000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(trimEndHandle).toHaveValue("3000");
    await expect(controls).toContainText("1s-3s");
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.keyboard.press("Shift+ArrowRight");
    await expect(controls).toContainText("3s");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(controls).toContainText("2s");
    await page.keyboard.press("BracketLeft");
    await expect(trimStartHandle).toHaveValue("2000");
    await controls.getByLabel("Scrub video").evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "3000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.keyboard.press("BracketRight");
    await expect(trimEndHandle).toHaveValue("3000");
    await expect(controls).toContainText("2s-3s");
    await page.keyboard.press("r");
    await expect(controls).toContainText("R90 / Original");
    await page.keyboard.press("Shift+R");
    await expect(controls).toContainText("R0 / Original");
    await page.keyboard.press("r");
    await controls.getByLabel("Video crop aspect").selectOption("square");
    await expect(controls).toContainText("R90 / 1:1");
    await expect(controls.getByRole("button", { name: "Reset video export transform" })).toBeEnabled();
    await lightbox.getByRole("button", { name: "Save video edit stack" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeVisible();
    await lightbox.getByRole("button", { name: "Revert photo edit stack" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeHidden();
    await expect(controls.getByRole("button", { name: "Export selected video trim" })).toBeEnabled();
    await controls.getByRole("button", { name: "Mute video" }).click();
    await expect(controls.getByRole("button", { name: "Unmute video" })).toBeVisible();
    await page.keyboard.press("m");
    await expect(controls.getByRole("button", { name: "Mute video" })).toBeVisible();
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.keyboard.press("Space");
    await expect(controls.getByRole("button", { name: "Play video" })).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos saved video edit stack applies to rendered selection export", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-saved-video-edit-export-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writeVideoFixtureSet(media, ["edited-export.mp4"]);
  const fakeFfmpeg = writeFakeFfmpeg(temp);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: fakeFfmpeg,
    CROSSAGE_FFMPEG_PATH: fakeFfmpeg
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await installMockVideoElementState(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Saved video edit export E2E media"
      });
      const clip = (imported.value.importedPaths || []).find((item) => /edited-export\.mp4$/.test(item));
      if (!clip) throw new Error("Missing imported saved video edit fixture");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: clip, title: "Saved edited export clip" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Saved edited export clip")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Saved edited export clip").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    const video = lightbox.getByLabel("Video preview");
    await expect(video).toBeVisible();
    await video.evaluate((node) => node.dispatchEvent(new Event("loadedmetadata")));

    const controls = lightbox.locator(".photos-lightbox-video-controls");
    const trimTimeline = controls.getByRole("group", { name: "Video trim timeline" });
    await expect(trimTimeline).toBeVisible();
    const trimStartHandle = trimTimeline.getByLabel("Video trim start handle");
    const trimEndHandle = trimTimeline.getByLabel("Video trim end handle");
    await expect(trimStartHandle).toHaveValue("0");
    await expect(trimEndHandle).toHaveValue("4000");
    await trimStartHandle.evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "1000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await trimEndHandle.evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "3000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(trimStartHandle).toHaveValue("1000");
    await expect(trimEndHandle).toHaveValue("3000");
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.keyboard.press("r");
    await controls.getByLabel("Video crop aspect").selectOption("square");
    await expect(controls).toContainText("1s-3s");
    await expect(controls).toContainText("R90 / 1:1");
    await lightbox.getByRole("button", { name: "Save video edit stack" }).click();
    await expect(lightbox.getByRole("button", { name: "Revert photo edit stack" })).toBeVisible();
    const editOperations = lightbox.getByRole("group", { name: "Current edit operations" });
    await expect(editOperations).toContainText("Trim 1s-3s (2s of 4s)");
    await expect(editOperations).toContainText("Transform R90 / 1:1");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toBeHidden();

    await tileByFilename(page, "Saved edited export clip").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Video format").selectOption("mp4");
    await page.getByLabel("Video quality").selectOption("high");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("96");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 1 photo; rendered 1 \(1 video\)\./)).toBeVisible({ timeout: 120_000 });

    const exportResult = page.locator(".photo-export-result");
    await expect(exportResult).toContainText("1 written");
    await expect(exportResult).toContainText("1 rendered");
    const writtenFiles = exportResult.locator(".photo-export-result-success-details");
    await writtenFiles.locator(":scope > summary").click();
    const writtenFileDetails = writtenFiles.locator(".photo-export-result-row-details").first();
    await writtenFileDetails.locator("summary").click();
    await expect(writtenFileDetails).toContainText("Result: rendered_video_edit");
    await expect(writtenFileDetails).toContainText("Variant: rendered");
    await expect(writtenFileDetails).toContainText("Render format: mp4");
    await expect(writtenFileDetails).toContainText("Video quality: high");
    await expect(writtenFileDetails).toContainText("Video edit: Trim 1s-3s (2s of 4s) / R90 / 1:1 / MP4 high max 96px");
    await expect(writtenFileDetails).toContainText("Video timeline: Trim 1s-3s (2s of 4s)");
    await expect(writtenFileDetails).toContainText("Video trim: 1s-3s");
    await expect(writtenFileDetails).toContainText("Video edit transform: R90 / 1:1");
    await expect(writtenFileDetails).toContainText("Video rotation: 90");
    await expect(writtenFileDetails).toContainText("Video crop: square");
    await expect(writtenFileDetails).toContainText("Video edit render: MP4 high max 96px");
    await expect(writtenFileDetails).toContainText("Video transform: Applied");
    await expect(writtenFileDetails).toContainText("Edit stack:");

    const exportsFolder = path.join(workspace, "exports");
    const bundleName = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const bundlePath = path.join(exportsFolder, bundleName || "");
    const manifest = JSON.parse(readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.action).toBe("export");
    expect(manifest.exportVariant).toBe("rendered");
    expect(manifest.videoRenderFormat).toBe("mp4");
    expect(manifest.videoRenderQuality).toBe("high");
    expect(manifest.renderMaxDimension).toBe(96);
    expect(manifest.counts).toEqual(expect.objectContaining({
      selected: 1,
      copied: 1,
      rendered: 1,
      videoRendered: 1,
      editStackRendered: 1,
      renderFallback: 0
    }));
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toEqual(expect.objectContaining({
      result: "rendered_video_edit",
      exportVariant: "rendered",
      renderFormat: "mp4",
      videoRenderFormat: "mp4",
      videoRenderQuality: "high",
      videoTrimStartMs: 1000,
      videoTrimEndMs: 3000,
      videoTrimDurationMs: 2000,
      videoSourceDurationMs: 4000,
      videoRotateDegrees: 90,
      videoCropAspect: "square",
      videoTransformApplied: true,
      videoEditTimeline: "Trim 1s-3s (2s of 4s)",
      videoEditTransform: "R90 / 1:1",
      videoEditRender: "MP4 high max 96px",
      videoEditSummary: "Trim 1s-3s (2s of 4s) / R90 / 1:1 / MP4 high max 96px"
    }));
    expect(String(manifest.items[0].editStackId || "")).toBeTruthy();
    expect(path.basename(String(manifest.items[0].targetPath || ""))).toMatch(/^(00001-)?edited-export.*\.mp4$/);
    expect(existsSync(String(manifest.items[0].targetPath || ""))).toBe(true);
    expect(readFileSync(String(manifest.items[0].targetPath || ""), "utf8")).toBe("fake browser transcoded video");
    expect(existsSync(path.join(bundlePath, "media", path.basename(String(manifest.items[0].targetPath || ""))))).toBe(true);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos video frame export writes a still-frame bundle from the lightbox", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-video-frame-export-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const videoFixture = writeRealVideoFixture(media, "frame-clip.mp4");
  test.skip(!videoFixture.ok, `Could not create a decodable video fixture: ${videoFixture.detail || "unknown error"}`);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    ...(videoFixture.ffmpegPath ? {
      VINTRACE_FFMPEG_PATH: videoFixture.ffmpegPath,
      CROSSAGE_FFMPEG_PATH: videoFixture.ffmpegPath
    } : {})
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await installMockVideoElementState(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Video frame export E2E media"
      });
      const clip = (imported.value.importedPaths || []).find((item) => /frame-clip\.mp4$/.test(item));
      if (!clip) throw new Error("Missing imported video frame export fixture");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: clip, title: "Frame export clip" });
      return { clip };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Frame export clip")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Render format").selectOption("png");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("32");

    await tileByFilename(page, "Frame export clip").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    const video = lightbox.getByLabel("Video preview");
    await expect(video).toBeVisible();
    await video.evaluate((node) => node.dispatchEvent(new Event("loadedmetadata")));

    const controls = lightbox.locator(".photos-lightbox-video-controls");
    await expect(controls.getByRole("button", { name: "Export current video frame" })).toBeVisible();
    await expect(controls.getByLabel("Video poster policy")).toBeVisible();
    await expect(controls).toContainText("Generated poster");
    await controls.getByLabel("Video poster policy").selectOption("auto");
    await expect(controls).toContainText("Auto poster");
    await expect(controls.getByRole("button", { name: "Export saved video poster frame" })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => page.evaluate(async ({ sourcePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const pageResult = await crossAge.invoke<{ items: Array<{ sourcePath: string; assetMetadata?: Record<string, any>; previewPath?: string }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 10
      });
      const item = pageResult.items.find((row) => row.sourcePath === sourcePath);
      const poster = item?.assetMetadata?.videoPoster || {};
      return {
        policy: poster.policy || "",
        hasAutoTimestamp: Number(poster.timestampMs || 0) > 0,
        hasPreview: Boolean(poster.previewPath && String(item?.previewPath || "") === String(poster.previewPath || ""))
      };
    }, { sourcePath: seeded.clip })).toEqual({
      policy: "auto",
      hasAutoTimestamp: true,
      hasPreview: true
    });
    await controls.getByLabel("Scrub video").evaluate((input) => {
      const range = input as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(range, "2000");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(controls).toContainText("2s");
    await controls.getByRole("button", { name: "Export current video frame" }).click();
    await expect(page.getByText("Exported video frame at 2s as PNG.")).toBeVisible({ timeout: 120_000 });

    const exportsFolder = path.join(workspace, "exports");
    const bundleName = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-video-frame-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const bundlePath = path.join(exportsFolder, bundleName || "");
    const manifest = JSON.parse(readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.action).toBe("export_photo_video_frame");
    expect(path.basename(String(manifest.sourcePath || ""))).toBe("frame-clip.mp4");
    expect(manifest.renderFormat).toBe("png");
    expect(manifest.renderMaxDimension).toBe(32);
    expect(manifest.timestampMs).toBe(2000);
    expect(manifest.posterFrameReused).toBe(false);
    expect(path.basename(String(manifest.targetPath || ""))).toMatch(/^frame-clip-0000002000ms.*\.png$/);
    expect(existsSync(String(manifest.targetPath || ""))).toBe(true);
    expect(existsSync(path.join(bundlePath, "media", path.basename(String(manifest.targetPath || ""))))).toBe(true);
    expect(Math.max(Number(manifest.width || 0), Number(manifest.height || 0))).toBeLessThanOrEqual(32);
    expect(Number(manifest.width || 0)).toBeGreaterThan(0);
    expect(Number(manifest.height || 0)).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosRenderedVideoExport(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const videoFixture = writeRealVideoFixture(media, "render-clip.mp4");
  test.skip(!videoFixture.ok, `Could not create a decodable video fixture: ${videoFixture.detail || "unknown error"}`);
  const fakeFfmpeg = writeFakeFfmpeg(temp);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: fakeFfmpeg,
    CROSSAGE_FFMPEG_PATH: fakeFfmpeg
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Rendered video export E2E media"
      });
      const clip = (imported.value.importedPaths || []).find((item) => /render-clip\.mp4$/.test(item));
      if (!clip) throw new Error("Missing imported rendered-video export fixture");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: clip, title: "Rendered export clip" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Rendered export clip")).toBeVisible({ timeout: 20_000 });
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
      await expect(tileByFilename(page, "Rendered export clip")).toBeVisible({ timeout: 20_000 });
    }
    await tileByFilename(page, "Rendered export clip").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");

    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Video format").selectOption("mov");
    await page.getByLabel("Video quality").selectOption("high");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("48");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText(/Exported 1 photo; rendered 1 \(1 video\)\./)).toBeVisible({ timeout: 120_000 });

    const exportsFolder = path.join(workspace, "exports");
    const bundleName = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const bundlePath = path.join(exportsFolder, bundleName || "");
    const manifest = JSON.parse(readFileSync(path.join(bundlePath, "manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest.action).toBe("export");
    expect(manifest.exportVariant).toBe("rendered");
    expect(manifest.videoRenderFormat).toBe("mov");
    expect(manifest.videoRenderQuality).toBe("high");
    expect(manifest.renderMaxDimension).toBe(48);
    expect(manifest.counts).toEqual(expect.objectContaining({
      selected: 1,
      copied: 1,
      rendered: 1,
      videoRendered: 1,
      renderFallback: 0
    }));
    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toEqual(expect.objectContaining({
      result: "rendered_video",
      exportVariant: "rendered",
      renderFormat: "mov",
      videoRenderFormat: "mov",
      videoRenderQuality: "high"
    }));
    expect(path.basename(String(manifest.items[0].targetPath || ""))).toMatch(/^(00001-)?render-clip.*\.mov$/);
    expect(existsSync(String(manifest.items[0].targetPath || ""))).toBe(true);
    expect(readFileSync(String(manifest.items[0].targetPath || ""), "utf8")).toBe("fake browser transcoded video");
    expect(existsSync(path.join(bundlePath, "media", path.basename(String(manifest.items[0].targetPath || ""))))).toBe(true);

    const beforeWebmBundleCount = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).length;
    if (!(await page.getByLabel("Video format").isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Export options" }).click();
    }
    await page.getByLabel("Video format").selectOption("webm");
    await page.getByLabel("Video quality").selectOption("medium");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("64");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect.poll(() => (
      readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).length
    ), { timeout: 120_000 }).toBeGreaterThan(beforeWebmBundleCount);
    await expect.poll(() => {
      const latestBundle = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
      return latestBundle ? existsSync(path.join(exportsFolder, latestBundle, "manifest.json")) : false;
    }, { timeout: 120_000 }).toBe(true);

    const webmBundleName = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(webmBundleName).toBeTruthy();
    const webmBundlePath = path.join(exportsFolder, webmBundleName || "");
    const webmManifest = JSON.parse(readFileSync(path.join(webmBundlePath, "manifest.json"), "utf8")) as Record<string, any>;
    expect(webmManifest.action).toBe("export");
    expect(webmManifest.exportVariant).toBe("rendered");
    expect(webmManifest.videoRenderFormat).toBe("webm");
    expect(webmManifest.videoRenderQuality).toBe("medium");
    expect(webmManifest.renderMaxDimension).toBe(64);
    expect(webmManifest.counts).toEqual(expect.objectContaining({
      selected: 1,
      copied: 1,
      rendered: 1,
      videoRendered: 1,
      renderFallback: 0
    }));
    expect(webmManifest.items).toHaveLength(1);
    expect(webmManifest.items[0]).toEqual(expect.objectContaining({
      result: "rendered_video",
      exportVariant: "rendered",
      renderFormat: "webm",
      videoRenderFormat: "webm",
      videoRenderQuality: "medium"
    }));
    expect(path.basename(String(webmManifest.items[0].targetPath || ""))).toMatch(/^(00001-)?render-clip.*\.webm$/);
    expect(existsSync(String(webmManifest.items[0].targetPath || ""))).toBe(true);
    expect(readFileSync(String(webmManifest.items[0].targetPath || ""), "utf8")).toBe("fake browser transcoded video");
    expect(existsSync(path.join(webmBundlePath, "media", path.basename(String(webmManifest.items[0].targetPath || ""))))).toBe(true);

    for (const codecCase of [
      { format: "hevc", quality: "medium", maxEdge: "72", suffix: ".mp4" },
      { format: "prores", quality: "high", maxEdge: "80", suffix: ".mov" },
    ]) {
      const beforeCodecBundleCount = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).length;
      if (!(await page.getByLabel("Video format").isVisible().catch(() => false))) {
        await page.getByRole("button", { name: "Export options" }).click();
      }
      await page.getByLabel("Video format").selectOption(codecCase.format);
      await page.getByLabel("Video quality").selectOption(codecCase.quality);
      await page.getByLabel("Render size").selectOption("custom");
      await page.getByLabel("Render max edge").fill(codecCase.maxEdge);
      await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
      await expect.poll(() => (
        readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).length
      ), { timeout: 120_000 }).toBeGreaterThan(beforeCodecBundleCount);
      await expect.poll(() => {
        const latestBundle = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
        return latestBundle ? existsSync(path.join(exportsFolder, latestBundle, "manifest.json")) : false;
      }, { timeout: 120_000 }).toBe(true);

      const codecBundleName = readdirSync(exportsFolder).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
      expect(codecBundleName).toBeTruthy();
      const codecBundlePath = path.join(exportsFolder, codecBundleName || "");
      const codecManifest = JSON.parse(readFileSync(path.join(codecBundlePath, "manifest.json"), "utf8")) as Record<string, any>;
      expect(codecManifest.action).toBe("export");
      expect(codecManifest.exportVariant).toBe("rendered");
      expect(codecManifest.videoRenderFormat).toBe(codecCase.format);
      expect(codecManifest.videoRenderQuality).toBe(codecCase.quality);
      expect(codecManifest.renderMaxDimension).toBe(Number(codecCase.maxEdge));
      expect(codecManifest.counts).toEqual(expect.objectContaining({
        selected: 1,
        copied: 1,
        rendered: 1,
        videoRendered: 1,
        renderFallback: 0
      }));
      expect(codecManifest.items).toHaveLength(1);
      expect(codecManifest.items[0]).toEqual(expect.objectContaining({
        result: "rendered_video",
        exportVariant: "rendered",
        renderFormat: codecCase.format,
        videoRenderFormat: codecCase.format,
        videoRenderQuality: codecCase.quality
      }));
      expect(path.basename(String(codecManifest.items[0].targetPath || "")).endsWith(codecCase.suffix)).toBe(true);
      expect(existsSync(String(codecManifest.items[0].targetPath || ""))).toBe(true);
      expect(readFileSync(String(codecManifest.items[0].targetPath || ""), "utf8")).toBe("fake browser transcoded video");
      expect(existsSync(path.join(codecBundlePath, "media", path.basename(String(codecManifest.items[0].targetPath || ""))))).toBe(true);
    }

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos rendered video export supports MOV WebM HEVC and ProRes formats from browser controls", async () => {
  await exercisePhotosRenderedVideoExport(
    { width: 900, height: 620 },
    "vintrace-photos-rendered-video-export-"
  );
});

test("Photos rendered video export supports compact MOV WebM HEVC and ProRes browser controls", async () => {
  await exercisePhotosRenderedVideoExport(
    { width: 390, height: 740 },
    "vintrace-photos-rendered-video-compact-export-"
  );
});

test("Photos Live Photo lightbox exposes motion and export controls", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-live-lightbox-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["live.png"]);
  writeVideoFixtureSet(media, ["live.mp4"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await installMockVideoElementState(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Live Photo lightbox E2E media"
      });
      const still = (imported.value.importedPaths || []).find((item) => /live\.png$/.test(item));
      if (!still) throw new Error("Missing imported Live Photo still fixture");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: still, title: "Live controls" });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Live controls")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Live controls").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toContainText("Live Photo");
    const video = lightbox.getByLabel("Live Photo motion preview");
    await expect(video).toBeVisible();
    await video.evaluate((node) => node.dispatchEvent(new Event("loadedmetadata")));

    const controls = lightbox.locator(".photos-lightbox-video-controls");
    await expect(controls.getByRole("button", { name: "Play Live Photo" })).toBeVisible();
    await controls.getByRole("button", { name: "Play Live Photo" }).click();
    await expect(controls.getByRole("button", { name: "Pause Live Photo" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Export current video frame" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Export Live Photo motion" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Export Live Photo loop GIF" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Export Live Photo bounce GIF" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Use current Live Photo frame as key photo" })).toBeVisible();

    await controls.getByRole("button", { name: "Export Live Photo motion" }).click();
    await expect(page.getByText("Exported Live Photo motion clip.")).toBeVisible({ timeout: 120_000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual albums support selection create cover and lightbox membership editing", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-manual-workflow-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["alpha.png", "beta.png", "gamma.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Manual workflow E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /alpha\.png$/.test(item));
      const beta = paths.find((item) => /beta\.png$/.test(item));
      const gamma = paths.find((item) => /gamma\.png$/.test(item));
      if (!alpha || !beta || !gamma) throw new Error("Missing imported manual workflow fixtures");
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: alpha, title: "Alpha cover" });
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: beta, title: "Beta member" });
      await crossAge.invoke("update_photo_asset_metadata", { sourcePath: gamma, title: "Gamma extra" });
      return { alpha, beta, gamma };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Alpha cover")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Beta member")).toBeVisible();
    await expect(tileByFilename(page, "Gamma extra")).toBeVisible();

    await tileByFilename(page, "Alpha cover").locator(".photo-select-box").click();
    await tileByFilename(page, "Beta member").locator(".photo-select-box").click();
    await page.getByLabel("New manual album name").fill("Trip Picks E2E");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Add to album" }).click();

    const albumName = "Trip Picks E2E";
    await expect.poll(async () => photoAlbumByName(page, albumName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.alpha
    }));
    const album = await photoAlbumByName(page, albumName);
    if (!album?.albumId) throw new Error("Manual album was not created");
    await expect(page.locator(".photos-rail").getByText(albumName, { exact: true })).toBeVisible();
    await expect(tileByFilename(page, "Alpha cover")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Beta member")).toBeVisible();
    await expect(tileByFilename(page, "Gamma extra")).toHaveCount(0);
    await expect.poll(async () => manualAlbumFilenames(page, album.albumId || "", 10)).toEqual(["alpha.png", "beta.png"]);

    await tileByFilename(page, "Beta member").getByRole("button", { name: /Open photo/ }).click();
    const albumLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(albumLightbox).toContainText("Album membership");
    const betaMembership = albumLightbox.locator(".photos-album-membership-row").filter({ hasText: albumName });
    await expect(betaMembership).toContainText("Manual");
    await albumLightbox.getByRole("button", { name: "Use as cover" }).click();
    await expect.poll(async () => photoAlbumByName(page, albumName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.beta
    }));
    await betaMembership.getByRole("button", { name: "Open" }).click();
    await expect(albumLightbox).toHaveCount(0);
    await expect(tileByFilename(page, "Alpha cover")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Beta member")).toBeVisible();
    await expect(tileByFilename(page, "Gamma extra")).toHaveCount(0);

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "Gamma extra")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Gamma extra").getByRole("button", { name: /Open photo/ }).click();
    const gammaLightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(gammaLightbox).toContainText("Not in any album");
    await gammaLightbox.getByLabel("Add current photo to album").selectOption({ label: albumName });
    await gammaLightbox.getByRole("button", { name: "Add current photo" }).click();
    await expect.poll(async () => photoAlbumByName(page, albumName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 3,
      coverSourcePath: seeded.beta
    }));
    await expect(gammaLightbox.locator(".photos-album-membership-row").filter({ hasText: albumName })).toContainText("Manual");

    const gammaMembership = gammaLightbox.locator(".photos-album-membership-row").filter({ hasText: albumName });
    await gammaMembership.getByRole("button", { name: "Remove" }).click();
    await expect.poll(async () => photoAlbumByName(page, albumName), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.beta
    }));
    await expect(gammaLightbox).toContainText("Not in any album");
    await gammaLightbox.getByRole("button", { name: "Close" }).click();
    await expect(gammaLightbox).toHaveCount(0);

    await page.locator(".photos-rail").getByText(albumName, { exact: true }).click();
    await expect.poll(async () => manualAlbumFilenames(page, album.albumId || "", 10)).toEqual(["alpha.png", "beta.png"]);
    await expect(tileByFilename(page, "Alpha cover")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Beta member")).toBeVisible();
    await expect(tileByFilename(page, "Gamma extra")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos utility folders support custom covers", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-utility-covers-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["favorite-alpha.png", "favorite-beta.png", "not-favorite.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Utility cover E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /favorite-alpha\.png$/.test(item));
      const beta = paths.find((item) => /favorite-beta\.png$/.test(item));
      const extra = paths.find((item) => /not-favorite\.png$/.test(item));
      if (!alpha || !beta || !extra) throw new Error("Missing imported utility cover fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: alpha,
        title: "Favorite alpha",
        favorite: true,
        dateOverride: "2026-06-20"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: beta,
        title: "Favorite beta",
        favorite: true,
        dateOverride: "2026-06-19"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: extra,
        title: "Not favorite",
        dateOverride: "2026-06-18"
      });
      return { alpha, beta, extra };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(page.locator(".photos-rail").getByText("Favorites", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => photoFolderById(page, "favorites"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.alpha
    }));
    await page.locator(".photos-rail").getByText("Favorites", { exact: true }).click();
    await expect(tileByFilename(page, "Favorite alpha")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Favorite beta")).toBeVisible();
    await expect(tileByFilename(page, "Not favorite")).toHaveCount(0);

    await tileByFilename(page, "Favorite beta").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox.getByRole("button", { name: "Use as utility cover" })).toBeVisible();
    await lightbox.getByRole("button", { name: "Use as utility cover" }).click();
    await expect.poll(async () => photoFolderById(page, "favorites"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.beta,
      utilityProfile: expect.objectContaining({ keyAssetId: expect.any(String) })
    }));
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    await page.getByRole("button", { name: "Clear utility cover" }).click();
    await expect.poll(async () => photoFolderById(page, "favorites"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: seeded.alpha,
      utilityProfile: expect.objectContaining({ keyAssetId: "" })
    }));

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos person folders support cropped key-photo covers", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-person-cover-crop-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["alice-wide.png", "alice-close.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "person-cover-crop-e2e"
api.project.db.create_scan_run(run_id, "Person Cover Crop E2E", "manual", str(media))
for index, name in enumerate(("alice-wide.png", "alice-close.png"), start=1):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")
    api.project.db.update_photo_asset_metadata(source_path=str(path), title="Alice wide" if "wide" in name else "Alice close")
    asset = api.project.db.photo_asset_by_path(str(path))
    if "close" in name:
        api.project.db.update_photo_asset_metadata_json(
            asset_id=asset["assetId"],
            patch={
                "detectedFaces": [
                    {"bounds": {"left": 0.35, "top": 0.2, "width": 0.2, "height": 0.3}, "confidence": 0.93}
                ]
            },
        )
    with api.project.db.connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (asset["assetId"], f"alice-cover-{index}", "Alice", "accepted", 0.99 - index / 100, 0.95, "confident", "2026-06-26T00:00:00Z"),
        )
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect.poll(async () => photoFolderById(page, "person:Alice"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      name: "Alice"
    }));
    await page.locator(".photos-rail").getByText("Alice", { exact: true }).click();
    await expect(tileByFilename(page, "Alice close")).toBeVisible({ timeout: 20_000 });

    await tileByFilename(page, "Alice close").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    const cropTools = lightbox.getByLabel("Person cover crop");
    await expect(cropTools).toBeVisible();
    await cropTools.getByRole("button", { name: "Face", exact: true }).click();
    await expect.poll(async () => photoFolderById(page, "person:Alice"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 2,
      coverSourcePath: expect.stringContaining("alice-close.png"),
      coverCrop: expect.objectContaining({ left: 20, top: 8, width: 60, height: 60 })
    }));
    await expect(cropTools.getByRole("button", { name: "Face", exact: true })).toHaveAttribute("aria-pressed", "true");

    const detectedFaceButton = cropTools.getByRole("button", { name: "Detected face" });
    await expect(detectedFaceButton).toBeVisible();
    await detectedFaceButton.click();
    await expect.poll(async () => {
      const folder = await photoFolderById(page, "person:Alice");
      const crop = folder?.coverCrop || {};
      return {
        count: folder?.count,
        coverSourcePath: String(folder?.coverSourcePath || "").endsWith("alice-close.png"),
        left: Math.round(Number(crop.left || 0) * 10) / 10,
        top: Math.round(Number(crop.top || 0) * 10) / 10,
        width: Math.round(Number(crop.width || 0) * 10) / 10,
        height: Math.round(Number(crop.height || 0) * 10) / 10
      };
    }, { timeout: 20_000 }).toEqual({
      count: 2,
      coverSourcePath: true,
      left: 14.3,
      top: 2.8,
      width: 61.5,
      height: 67.5
    });
    await expect(detectedFaceButton).toHaveAttribute("aria-pressed", "true");

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos person rename shows undo audit details and rolls back", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-person-rename-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["rename-alice.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "person-rename-e2e"
api.project.db.create_scan_run(run_id, "Person Rename E2E", "manual", str(media))
path = media / "rename-alice.png"
api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")
api.project.db.upsert_candidates([
    ReviewCandidate(
        candidate_id="alice-rename",
        source_path=str(path),
        person_name="Alice",
        best_ref_id=None,
        best_ref_path=None,
        score=0.98,
        band="confident",
        quality=0.94,
        model_name="e2e-local",
        status="accepted",
    )
])
ref = ReferenceFace(
    ref_id="ref-alice-rename",
    person_name="Alice",
    age_bucket="adult",
    source_path=str(path),
    capture_date=None,
    quality=0.98,
    model_name="e2e-local",
    vector=[1.0] + [0.0] * 511,
)
api.project.references[ref.ref_id] = ref
api.project.vector_store.add(ref.ref_id, ref.vector)
api.project.save(snapshot_candidates=False, flush_candidate_index=False)
alice_asset = api.project.db.photo_asset_by_path(str(path))
api.save_photo_person_profile({
    "personName": "Alice",
    "favorite": True,
    "keyAssetId": alice_asset["assetId"] if alice_asset else "",
})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const peopleFolderCounts = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
    return {
      alice: result.folders.find((folder) => folder.id === "person:Alice")?.count ?? 0,
      alicia: result.folders.find((folder) => folder.id === "person:Alicia")?.count ?? 0,
    };
  });
  const candidatePeople = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const state = await crossAge.invoke<{ candidates: Array<{ candidateId: string; personName: string }> }>("get_state", {});
    return Object.fromEntries(state.candidates.map((candidate) => [candidate.candidateId, candidate.personName]));
  });

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, alicia: 0 });
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Alice", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Alice", { timeout: 20_000 });
    await expect(tileByFilename(page, "rename-alice.png")).toBeVisible({ timeout: 20_000 });

    const renameControl = page.locator(".photo-person-rename-control").filter({ has: page.locator('input[aria-label="Person name"]') }).first();
    const renameInput = renameControl.locator('input[aria-label="Person name"]');
    await expect(renameInput).toHaveValue("Alice", { timeout: 20_000 });
    await renameInput.fill("Alicia");
    await expect(renameControl.getByRole("button", { name: "Rename" })).toBeEnabled();
    await renameControl.getByRole("button", { name: "Rename" }).click();
    const renameDialog = page.getByRole("dialog", { name: "Rename person" });
    await expect(renameDialog).toContainText("Rename Alice to Alicia?");
    await renameDialog.getByRole("button", { name: "Rename" }).click();

    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 0, alicia: 1 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({ "alice-rename": "Alicia" }));
    await expect(page.locator(".photos-gallery-title")).toContainText("Alicia", { timeout: 20_000 });
    await expect(tileByFilename(page, "rename-alice.png")).toBeVisible({ timeout: 20_000 });

    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("person_label_rename", { timeout: 20_000 });
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("From: Alice");
    await expect(operationDetails).toContainText("To: Alicia");
    await expect(operationDetails).toContainText("Reference labels: 1");
    await expect(operationDetails).toContainText("Review rows: 1");
    await expect(operationDetails).toContainText("Photo index rows: 1");
    await expect(operationDetails).toContainText("Merged into existing: No");
    await expect(operationDetails).toContainText("Affected reference 1: rename-alice.png");
    await expect(operationDetails).toContainText("Affected review 2: rename-alice.png · accepted · 98%");
    await expect(operationDetails).toContainText("Affected photo index 3: rename-alice.png · accepted · 98%");

    await operationUndo.getByRole("button", { name: "Undo" }).click();
    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, alicia: 0 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({ "alice-rename": "Alice" }));
    await rail.getByText("Alice", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Alice", { timeout: 20_000 });
    await expect(tileByFilename(page, "rename-alice.png")).toBeVisible({ timeout: 20_000 });

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos person merge shows undo audit details and rolls back", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-person-merge-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["alice-person.png", "bob-person.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "person-merge-e2e"
api.project.db.create_scan_run(run_id, "Person Merge E2E", "manual", str(media))
for name in ("alice-person.png", "bob-person.png"):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

def candidate(candidate_id, filename, person_name, score):
    return ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(media / filename),
        person_name=person_name,
        best_ref_id=None,
        best_ref_path=None,
        score=score,
        band="confident",
        quality=0.94,
        model_name="e2e-local",
        status="accepted",
    )

api.project.db.upsert_candidates([
    candidate("alice-merge", "alice-person.png", "Alice", 0.98),
    candidate("bob-merge", "bob-person.png", "Bob", 0.97),
])
reference_vector = [1.0] + [0.0] * 511
for ref_id, filename, person_name in (
    ("ref-alice-merge", "alice-person.png", "Alice"),
    ("ref-bob-merge", "bob-person.png", "Bob"),
):
    ref = ReferenceFace(
        ref_id=ref_id,
        person_name=person_name,
        age_bucket="adult",
        source_path=str(media / filename),
        capture_date=None,
        quality=0.98,
        model_name="e2e-local",
        vector=reference_vector,
    )
    api.project.references[ref.ref_id] = ref
    api.project.vector_store.add(ref.ref_id, ref.vector)
api.project.save(snapshot_candidates=False, flush_candidate_index=False)
alice_asset = api.project.db.photo_asset_by_path(str(media / "alice-person.png"))
api.save_photo_person_profile({
    "personName": "Alice",
    "favorite": True,
    "keyAssetId": alice_asset["assetId"] if alice_asset else "",
})
api.save_photo_person_profile({"personName": "Bob", "manualOrder": 0})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const peopleFolderCounts = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
    return {
      alice: result.folders.find((folder) => folder.id === "person:Alice")?.count ?? 0,
      bob: result.folders.find((folder) => folder.id === "person:Bob")?.count ?? 0,
    };
  });
  const candidatePeople = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const state = await crossAge.invoke<{ candidates: Array<{ candidateId: string; personName: string }> }>("get_state", {});
    return Object.fromEntries(state.candidates.map((candidate) => [candidate.candidateId, candidate.personName]));
  });
  const expectMergeAuditAndUndo = async () => {
    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 0, bob: 2 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "alice-merge": "Bob",
      "bob-merge": "Bob",
    }));
    await expect(page.locator(".photos-gallery-title")).toContainText("Bob", { timeout: 20_000 });
    await expect(tileByFilename(page, "alice-person.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "bob-person.png")).toBeVisible();

    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("person_label_merge", { timeout: 20_000 });
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("From: Alice");
    await expect(operationDetails).toContainText("To: Bob");
    await expect(operationDetails).toContainText("Reference labels: 1");
    await expect(operationDetails).toContainText("Review rows: 1");
    await expect(operationDetails).toContainText("Photo index rows: 1");
    await expect(operationDetails).toContainText("Merged into existing: Yes");
    await expect(operationDetails).toContainText("Affected reference 1: alice-person.png");
    await expect(operationDetails).toContainText("Affected review 2: alice-person.png · accepted · 98%");
    await expect(operationDetails).toContainText("Affected photo index 3: alice-person.png · accepted · 98%");
    await expect(page.getByLabel("Duplicate people suggestions")).toHaveCount(0);

    await operationUndo.getByRole("button", { name: "Undo" }).click();
    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, bob: 1 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "alice-merge": "Alice",
      "bob-merge": "Bob",
    }));
    await expect(page.getByLabel("Duplicate people suggestions")).toContainText(/Alice and Bob|Bob and Alice/, { timeout: 20_000 });
  };

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, bob: 1 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "alice-merge": "Alice",
      "bob-merge": "Bob",
    }));

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Alice", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Alice", { timeout: 20_000 });
    await expect(tileByFilename(page, "alice-person.png")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Find duplicates" }).click();
    const duplicatePanel = page.getByLabel("Duplicate people suggestions");
    await expect(duplicatePanel).toContainText("Alice and Bob", { timeout: 20_000 });
    await expect(duplicatePanel.getByLabel("Person merge preview").first()).toContainText("Undoable");
    await duplicatePanel.getByRole("button", { name: "Merge into Bob" }).click();
    const duplicateMergeDialog = page.getByRole("dialog", { name: "Merge person" });
    await expect(duplicateMergeDialog).toContainText("Merge Alice into Bob?");
    await duplicateMergeDialog.getByRole("button", { name: "Merge" }).click();
    await expectMergeAuditAndUndo();

    await rail.getByText("Alice", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Alice", { timeout: 20_000 });
    await expect(tileByFilename(page, "alice-person.png")).toBeVisible({ timeout: 20_000 });

    const renameControl = page.locator(".photo-person-rename-control").filter({ has: page.locator('input[aria-label="Person name"]') }).first();
    const renameInput = renameControl.locator('input[aria-label="Person name"]');
    await expect(renameInput).toHaveValue("Alice", { timeout: 20_000 });
    await renameInput.fill("Bob");
    await expect(renameInput).toHaveValue("Bob");
    const mergePreview = page.getByLabel("Person merge preview").first();
    await expect(mergePreview).toContainText("Merge preview");
    await expect(mergePreview).toContainText("Alice:");
    await expect(mergePreview).toContainText("Bob:");
    await expect(mergePreview).toContainText("Undoable");
    await renameControl.getByRole("button", { name: "Merge" }).click();
    const mergeDialog = page.getByRole("dialog", { name: "Merge person" });
    await expect(mergeDialog).toContainText("Merge Alice into Bob?");
    await mergeDialog.getByRole("button", { name: "Merge" }).click();
    await expectMergeAuditAndUndo();

    await rail.getByText("Bob", { exact: true }).click();
    await expect(tileByFilename(page, "bob-person.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "alice-person.png")).toHaveCount(0);
    await rail.getByText("Alice", { exact: true }).click();
    await expect(tileByFilename(page, "alice-person.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "bob-person.png")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos People Manager row merge shows undo audit details and rolls back", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-manager-merge-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["manager-alice.png", "manager-bob.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "manager-merge-e2e"
api.project.db.create_scan_run(run_id, "Manager Merge E2E", "manual", str(media))
for name in ("manager-alice.png", "manager-bob.png"):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

def candidate(candidate_id, filename, person_name, score):
    return ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(media / filename),
        person_name=person_name,
        best_ref_id=None,
        best_ref_path=None,
        score=score,
        band="confident",
        quality=0.94,
        model_name="e2e-local",
        status="accepted",
    )

api.project.db.upsert_candidates([
    candidate("alice-manager-merge", "manager-alice.png", "Alice", 0.98),
    candidate("bob-manager-merge", "manager-bob.png", "Bob", 0.97),
])
reference_vector = [1.0] + [0.0] * 511
for ref_id, filename, person_name in (
    ("ref-alice-manager-merge", "manager-alice.png", "Alice"),
    ("ref-bob-manager-merge", "manager-bob.png", "Bob"),
):
    ref = ReferenceFace(
        ref_id=ref_id,
        person_name=person_name,
        age_bucket="adult",
        source_path=str(media / filename),
        capture_date=None,
        quality=0.98,
        model_name="e2e-local",
        vector=reference_vector,
    )
    api.project.references[ref.ref_id] = ref
    api.project.vector_store.add(ref.ref_id, ref.vector)
api.project.save(snapshot_candidates=False, flush_candidate_index=False)
api.save_photo_person_profile({"personName": "Alice"})
api.save_photo_person_profile({"personName": "Bob"})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const peopleFolderCounts = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
    return {
      alice: result.folders.find((folder) => folder.id === "person:Alice")?.count ?? 0,
      bob: result.folders.find((folder) => folder.id === "person:Bob")?.count ?? 0,
    };
  });
  const candidatePeople = async () => page.evaluate(async () => {
    const crossAge = (window as any).crossAge as {
      invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
    };
    const state = await crossAge.invoke<{ candidates: Array<{ candidateId: string; personName: string }> }>("get_state", {});
    return Object.fromEntries(state.candidates.map((candidate) => [candidate.candidateId, candidate.personName]));
  });

  try {
    await waitForPhotosBackendReady(page);
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, bob: 1 });
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(page.locator(".photo-rail-people-sort button[title='Manage People']")).toBeVisible({ timeout: 20_000 });
    await page.locator(".photo-rail-people-sort button[title='Manage People']").click();

    const manager = page.getByLabel("People management");
    await expect(manager).toBeVisible({ timeout: 20_000 });
    const aliceRow = manager.locator('article.photos-people-manager-row[data-person-name="Alice"]');
    const bobRow = manager.locator('article.photos-people-manager-row[data-person-name="Bob"]');
    await expect(aliceRow).toBeVisible({ timeout: 20_000 });
    await expect(bobRow).toBeVisible();

    await aliceRow.locator('input[aria-label="Person name Alice"]').fill("Bob");
    await expect(aliceRow.getByLabel("Person merge preview")).toContainText("Undoable");
    const managerMergeButton = aliceRow.getByRole("button", { name: "Merge" });
    await expect(managerMergeButton).toBeEnabled();
    await managerMergeButton.click();
    const mergeDialog = page.getByRole("dialog", { name: "Merge person" });
    await expect(mergeDialog).toContainText("Merge Alice into Bob?");
    await mergeDialog.getByRole("button", { name: "Merge" }).click();

    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 0, bob: 2 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "alice-manager-merge": "Bob",
      "bob-manager-merge": "Bob",
    }));
    await expect(aliceRow).toHaveCount(0);
    await expect(bobRow).toContainText("2 photos", { timeout: 20_000 });

    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("person_label_merge", { timeout: 20_000 });
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("From: Alice");
    await expect(operationDetails).toContainText("To: Bob");
    await expect(operationDetails).toContainText("Affected reference 1: manager-alice.png");
    await expect(operationDetails).toContainText("Affected review 2: manager-alice.png · accepted · 98%");
    await expect(operationDetails).toContainText("Affected photo index 3: manager-alice.png · accepted · 98%");

    await operationUndo.getByRole("button", { name: "Undo" }).click();
    await expect.poll(peopleFolderCounts, { timeout: 20_000 }).toEqual({ alice: 1, bob: 1 });
    await expect.poll(candidatePeople, { timeout: 20_000 }).toEqual(expect.objectContaining({
      "alice-manager-merge": "Alice",
      "bob-manager-merge": "Bob",
    }));

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos creation suggestions apply export presets from the export panel", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-creation-suggestions-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const tools = path.join(temp, "tools");
  const fakeFfmpeg = writeFakeFfmpeg(tools);
  mkdirSync(media, { recursive: true });
  writeFileSync(path.join(media, "creation-landscape.png"), MARKUP_TEST_PNG);
  writeFileSync(path.join(media, "creation-memory.png"), MARKUP_TEST_PNG);
  writeFileSync(path.join(media, "creation-extra.png"), MARKUP_TEST_PNG);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: fakeFfmpeg,
    CROSSAGE_FFMPEG_PATH: fakeFfmpeg
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Creation suggestions E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const landscape = paths.find((item) => /creation-landscape\.png$/.test(item));
      const memory = paths.find((item) => /creation-memory\.png$/.test(item));
      const extra = paths.find((item) => /creation-extra\.png$/.test(item));
      if (!landscape || !memory || !extra) throw new Error("Missing imported creation suggestion fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: landscape,
        title: "Creation landscape",
        favorite: true,
        keywords: ["Milo"]
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: memory,
        title: "Creation memory",
        keywords: ["memory"]
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: extra,
        title: "Creation extra"
      });
      const saved = await crossAge.invoke<{ value: { memoryId: string } }>("save_photo_user_memory", {
        name: "Creation Memory E2E",
        subtitle: "Creation suggestions",
        sourcePaths: [landscape, memory],
        coverSourcePath: landscape
      });
      return { landscape, memory, extra, memoryId: saved.value.memoryId };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await expect(rail.getByText("Creation Memory E2E", { exact: true })).toBeVisible({ timeout: 20_000 });
    await rail.getByText("Creation Memory E2E", { exact: true }).click();
    await expect(tileByFilename(page, "Creation landscape")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Creation memory")).toBeVisible();
    await expect(tileByFilename(page, "Creation extra")).toHaveCount(0);

    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Slideshow" }).click();
    const memorySlideshow = page.getByRole("dialog", { name: /Slideshow: Creation Memory E2E/ });
    await expect(memorySlideshow).toBeVisible({ timeout: 20_000 });
    await expect(memorySlideshow.getByLabel("Memory chapters")).toBeVisible();
    await expect(memorySlideshow.getByRole("button", { name: /Chapter 1: Creation landscape/ })).toBeVisible();
    await memorySlideshow.getByRole("button", { name: /Chapter 2: Creation memory/ }).click();
    await expect(memorySlideshow).toContainText("2 / 2");
    await memorySlideshow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(memorySlideshow).toHaveCount(0);

    const memorySlideshowProjects = page.getByLabel("Slideshow projects");
    await memorySlideshowProjects.getByLabel("Title card").check();
    await memorySlideshowProjects.getByLabel("Title-card title").fill("Styled Memory Card");
    await memorySlideshowProjects.getByLabel("Title-card subtitle").fill("Browser styling");
    await memorySlideshowProjects.getByLabel("Title-card duration ms").fill("3500");
    await memorySlideshowProjects.getByLabel("Title-card palette").selectOption("paper");
    await memorySlideshowProjects.getByLabel("Title-card layout").selectOption("left");
    await memorySlideshowProjects.getByLabel("Title-card type").selectOption("large");
    await memorySlideshowProjects.getByLabel("Title-card footer").uncheck();
    await memorySlideshowProjects.getByLabel("Template layout").selectOption("poster");
    await memorySlideshowProjects.getByLabel("Template stage width").fill("76");
    await memorySlideshowProjects.getByLabel("Template chrome").selectOption("compact");
    await memorySlideshowProjects.getByLabel("Music").selectOption("calm");

    const memoryMovieStyle = page.getByLabel("Memory movie style");
    await expect(memoryMovieStyle).toBeVisible({ timeout: 20_000 });
    await expect(memoryMovieStyle.getByRole("button", { name: "Save movie style" })).toBeEnabled();
    await memoryMovieStyle.getByRole("button", { name: "Save movie style" }).click();
    await expect.poll(async () => {
      const memory = await photoUserMemoryByName(page, "Creation Memory E2E");
      const settings = memory?.movieSettings || {};
      return {
        layout: settings.themeTemplateLayout,
        stageWidth: settings.themeTemplateStageWidth,
        chrome: settings.themeTemplateChromeDensity,
        music: settings.music,
        titleCardTitle: settings.titleCardTitle,
        titleCardPalette: settings.titleCardPalette,
      };
    }, { timeout: 20_000 }).toEqual({
      layout: "poster",
      stageWidth: 76,
      chrome: "compact",
      music: "calm",
      titleCardTitle: "Styled Memory Card",
      titleCardPalette: "paper",
    });
    await expect(memoryMovieStyle).toContainText("Saved movie style", { timeout: 20_000 });
    await memorySlideshowProjects.getByLabel("Template layout").selectOption("minimal");
    await memorySlideshowProjects.getByLabel("Template stage width").fill("60");
    await memorySlideshowProjects.getByLabel("Template chrome").selectOption("spacious");
    await memoryMovieStyle.getByRole("button", { name: "Apply movie style" }).click();
    await expect(memorySlideshowProjects.getByLabel("Template layout")).toHaveValue("poster");
    await expect(memorySlideshowProjects.getByLabel("Template stage width")).toHaveValue("76");
    await expect(memorySlideshowProjects.getByLabel("Template chrome")).toHaveValue("compact");

    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as any;
      holder.__photoMemoryRevealPaths = [];
      ipcMain.removeHandler("shell:reveal-path");
      ipcMain.handle("shell:reveal-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__photoMemoryRevealPaths.push(String(record.path || ""));
        return true;
      });
    });
    const memoryActions = page.getByLabel("Memory actions");
    await expect(memoryActions.getByRole("button", { name: "Export memory movie" })).toBeEnabled();
    await memoryActions.getByRole("button", { name: "Export memory movie" }).click();
    await expect(page.getByText(/Exported Memory movie with 2 slides as MP4/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => {
      const exportRoot = path.join(workspace, "exports");
      if (!existsSync(exportRoot)) return [] as string[];
      return readdirSync(exportRoot)
        .filter((name) => /^vintrace-memory-movie-/.test(name))
        .map((name) => path.join(exportRoot, name))
        .sort();
    }, { timeout: 20_000 }).not.toEqual([]);
    const memoryMovieBundle = readdirSync(path.join(workspace, "exports"))
      .filter((name) => /^vintrace-memory-movie-/.test(name))
      .map((name) => path.join(workspace, "exports", name))
      .sort()
      .at(-1) || "";
    const memoryMovieManifest = JSON.parse(readFileSync(path.join(memoryMovieBundle, "manifest.json"), "utf8")) as {
      action?: string;
      exportKind?: string;
      memoryId?: string;
      memoryName?: string;
      outputMode?: string;
      targetPath?: string;
      videoRenderFormat?: string;
      videoRenderQuality?: string;
      themeTemplateLayout?: string;
      themeTemplateStageWidth?: number;
      themeTemplateChromeDensity?: string;
      videoRender?: { targetPath?: string; slideCount?: number; audioTrack?: string; audioGenerated?: boolean; titleCardIncluded?: boolean; themeTemplateLayout?: string; themeTemplateStageWidth?: number; templateStageFrame?: { x?: number; y?: number; width?: number; height?: number }; templateChromeDensity?: string };
      chapters?: Array<{ label?: string; kind?: string; startMs?: number; durationMs?: number; slideIndex?: number }>;
      titleCard?: { included?: boolean; title?: string; subtitle?: string; durationMs?: number; targetPath?: string; relativePath?: string; palette?: string; layout?: string; fontScale?: string; showFooter?: boolean };
      counts?: Record<string, number>;
      items?: Array<{ sourcePath?: string; result?: string; generated?: boolean; relativePath?: string }>;
    };
    expect(memoryMovieManifest).toEqual(expect.objectContaining({
      action: "export_photo_memory_movie",
      exportKind: "memoryMovie",
      memoryId: seeded.memoryId,
      memoryName: "Creation Memory E2E",
      outputMode: "video",
      videoRenderFormat: "mp4",
      videoRenderQuality: "medium",
    }));
    expect(memoryMovieManifest.counts).toEqual(expect.objectContaining({ selected: 2, included: 2 }));
    expect(memoryMovieManifest.titleCard).toEqual(expect.objectContaining({
      included: true,
      title: "Styled Memory Card",
      subtitle: "Browser styling",
      durationMs: 3500,
      palette: "paper",
      layout: "left",
      fontScale: "large",
      showFooter: false,
    }));
    expect(memoryMovieManifest.titleCard?.relativePath).toMatch(/title-card\.png$/);
    expect(existsSync(String(memoryMovieManifest.titleCard?.targetPath || ""))).toBe(true);
    expect(memoryMovieManifest.themeTemplateLayout).toBe("poster");
    expect(memoryMovieManifest.themeTemplateStageWidth).toBe(76);
    expect(memoryMovieManifest.themeTemplateChromeDensity).toBe("compact");
    expect(memoryMovieManifest.videoRender?.slideCount).toBe(3);
    expect(memoryMovieManifest.videoRender?.titleCardIncluded).toBe(true);
    expect(memoryMovieManifest.videoRender?.audioTrack).toBe("calm");
    expect(memoryMovieManifest.videoRender?.audioGenerated).toBe(true);
    expect(memoryMovieManifest.videoRender?.targetPath).toBe(memoryMovieManifest.targetPath);
    expect(memoryMovieManifest.videoRender?.themeTemplateLayout).toBe("poster");
    expect(memoryMovieManifest.videoRender?.themeTemplateStageWidth).toBe(76);
    expect(memoryMovieManifest.videoRender?.templateStageFrame?.width).toBeGreaterThan(0);
    expect(memoryMovieManifest.videoRender?.templateChromeDensity).toBe("compact");
    expect(memoryMovieManifest.items?.[0]).toEqual(expect.objectContaining({
      result: "title_card",
      generated: true,
    }));
    expect(memoryMovieManifest.items?.[0]?.relativePath || "").toMatch(/title-card\.png$/);
    expect(memoryMovieManifest.items
      ?.filter((item) => item.result === "included")
      .map((item) => path.basename(item.sourcePath || ""))
      .sort()
    ).toEqual(["creation-landscape.png", "creation-memory.png"]);
    expect(memoryMovieManifest.chapters?.map((chapter) => ({
      label: chapter.label,
      kind: chapter.kind,
      startMs: chapter.startMs,
      durationMs: chapter.durationMs,
      slideIndex: chapter.slideIndex,
    }))).toEqual([
      { label: "Styled Memory Card", kind: "titleCard", startMs: 0, durationMs: 3500, slideIndex: 0 },
      { label: "creation-landscape.png", kind: "image", startMs: 3500, durationMs: 4500, slideIndex: 1 },
      { label: "creation-memory.png", kind: "image", startMs: 8000, durationMs: 4500, slideIndex: 2 },
    ]);
    expect(memoryMovieManifest.targetPath || "").toMatch(/\.mp4$/);
    expect(existsSync(String(memoryMovieManifest.targetPath || ""))).toBe(true);
    expect(readFileSync(String(memoryMovieManifest.targetPath || ""), "utf8")).toBe("fake browser transcoded video");
    const memoryRevealBasenames = (await app.evaluate(() => ((globalThis as any).__photoMemoryRevealPaths || []) as string[]))
      .map((item) => path.basename(item));
    expect(memoryRevealBasenames.some((name) => /^vintrace-memory-movie-/.test(name))).toBe(true);

    await page.getByRole("button", { name: "Export options" }).click();
    const creationSuggestions = page.locator(".photo-creation-suggestions");
    await expect(creationSuggestions).toBeVisible();
    await expect(creationSuggestions.getByRole("button", { name: /Suggested wallpaper/ })).toBeVisible();
    await expect(creationSuggestions.getByRole("button", { name: /Suggested collage/ })).toBeVisible();
    await expect(creationSuggestions.getByRole("button", { name: /Suggested poster/ })).toBeVisible();
    await expect(creationSuggestions).toContainText("Memory context");
    await expect(creationSuggestions.locator(".photo-creation-crop-preview").first()).toContainText(/16:9/);
    const librarySuggestionsButton = creationSuggestions.getByRole("button", { name: /Library suggestions/ });
    await expect(librarySuggestionsButton).toBeVisible();
    await expect(librarySuggestionsButton).toContainText(/All visible photos|Preparing cache|Cached 3 photos/);
    await librarySuggestionsButton.click();
    await expect(librarySuggestionsButton).toContainText("3 photos", { timeout: 20_000 });

    await creationSuggestions.getByRole("button", { name: /Suggested wallpaper/ }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await expect(page.getByLabel("Export preset name")).toHaveValue("Suggested wallpaper");
    await expect(page.getByLabel("Export kind")).toHaveValue("rendered");
    await expect(page.getByLabel("Render max edge")).toHaveValue("3840");
    await expect(page.getByLabel("Filename template")).toHaveValue("{title}-wallpaper");
    await expect(page.getByLabel("Subfolder template")).toHaveValue("Wallpapers");

    await creationSuggestions.getByRole("button", { name: /Suggested collage/ }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("3 selected");
    await expect(page.getByLabel("Export preset name")).toHaveValue("Suggested collage");
    await expect(page.getByLabel("Contact format")).toHaveValue("jpeg");
    await expect(page.getByLabel("Contact sheet columns")).toHaveValue("3");
    await expect(page.getByLabel("Contact sheet thumbnail size")).toHaveValue("320");
    await expect(page.getByLabel("Contact captions")).not.toBeChecked();
    await expect(page.getByLabel("Filename template")).toHaveValue("{date}-collage");
    await expect(page.getByLabel("Subfolder template")).toHaveValue("Collages");

    await creationSuggestions.getByRole("button", { name: /Suggested poster/ }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("1 selected");
    await expect(page.getByLabel("Export preset name")).toHaveValue("Suggested poster");
    await expect(page.getByLabel("Render quality")).toHaveValue("100");
    await expect(page.getByLabel("Render max edge")).toHaveValue("6000");
    await expect(page.getByLabel("Filename template")).toHaveValue("{title}-poster");
    await expect(page.getByLabel("Subfolder template")).toHaveValue("Posters");
    await expect.poll(async () => page.evaluate(async ({ expected }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: `memory:${expected.memoryId}`,
        previewBudget: 0,
        limit: 10
      });
      return result.items.some((item) => item.sourcePath === expected.landscape);
    }, { expected: seeded })).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Memory topic feedback reshapes generated memories", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-memory-topic-feedback-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["birthday-cake.png", "birthday-candles.png", "birthday-balloons.png", "neutral.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      // This test drives the indexing queue manually ("Run next local indexing job"),
      // so disable background auto-run — otherwise auto-running jobs keep the queue
      // busy and the manual run button stays disabled (flaky under load).
      await crossAge.invoke("save_photo_library_settings", {
        localSettings: { backgroundIndexingAutoRun: false }
      });
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Memory topic feedback E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const cake = paths.find((item) => /birthday-cake\.png$/.test(item));
      const candles = paths.find((item) => /birthday-candles\.png$/.test(item));
      const balloons = paths.find((item) => /birthday-balloons\.png$/.test(item));
      const neutral = paths.find((item) => /neutral\.png$/.test(item));
      if (!cake || !candles || !balloons || !neutral) throw new Error("Missing imported Memory topic fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: cake,
        title: "Birthday cake",
        keywords: ["Birthday"],
        dateOverride: "2026-04-08"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: candles,
        title: "Birthday candles",
        keywords: ["Birthday"],
        dateOverride: "2026-04-09"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: balloons,
        title: "Birthday balloons",
        keywords: ["Birthday"],
        dateOverride: "2026-04-09"
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: neutral,
        title: "Quiet afternoon",
        dateOverride: "2026-04-10"
      });
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect.poll(async () => photoMemoryByName(page, "Birthday 2026"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 3,
      name: "Birthday 2026"
    }));
    await page.locator(".photos-rail").getByText("Birthday 2026", { exact: true }).click();
    await expect(tileByFilename(page, "Birthday cake")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Birthday candles")).toBeVisible();
    await expect(tileByFilename(page, "Birthday balloons")).toBeVisible();
    await expect(tileByFilename(page, "Quiet afternoon")).toHaveCount(0);

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const generatedSettingsPanel = page.locator("#photos-local-settings");
    await expect(generatedSettingsPanel).toBeVisible({ timeout: 20_000 });
    await generatedSettingsPanel.getByRole("button", { name: "Queue generated collections refresh" }).click();
    const generatedCatalogNotice = page.locator(".photo-catalog-index-notice.generated-collections");
    await expect(generatedCatalogNotice).toBeVisible({ timeout: 20_000 });
    await expect(generatedCatalogNotice).toContainText("Generated collections are catching up");
    await expect(generatedCatalogNotice).toContainText("Memory: Birthday 2026");
    await expect(generatedCatalogNotice).toContainText("queued");
    await expect(generatedCatalogNotice).toContainText("Waiting for the local indexing queue.");
    await generatedCatalogNotice.getByRole("button", { name: "Queue status" }).click();
    const generatedIndexingJobs = generatedSettingsPanel.getByLabel("Local indexing jobs", { exact: true });
    await expect(generatedIndexingJobs.locator(".photo-indexing-job-row.queued").filter({ hasText: "Generated collections" })).toHaveCount(1, { timeout: 20_000 });
    await generatedSettingsPanel.getByRole("button", { name: "Run next local indexing job" }).click();
    await expect(generatedIndexingJobs.locator(".photo-indexing-job-row.completed").filter({ hasText: "Generated collections" })).toHaveCount(1, { timeout: 20_000 });
    await expect(generatedCatalogNotice).toHaveCount(0);
    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    await expect(generatedSettingsPanel).toHaveCount(0);

    const seededMemory = await photoMemoryByName(page, "Birthday 2026");
    const birthdayMemoryId = seededMemory?.memoryId || seededMemory?.memory?.memoryId || "";
    const cakeSource = (seededMemory?.memory?.sourcePaths || []).find((sourcePath) => /birthday-cake\.png$/.test(sourcePath)) || "";
    expect(birthdayMemoryId).toBeTruthy();
    expect(cakeSource).toBeTruthy();
    const memoryActions = page.getByLabel("Memory actions");
    await memoryActions.getByRole("button", { name: "Favorite memory" }).click();
    await expect(memoryActions.getByRole("button", { name: "Unfavorite memory" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { favoriteMemories?: string[] } }>("photo_curation_preferences", {});
      return result.value.favoriteMemories || [];
    }, { memoryId: birthdayMemoryId }), { timeout: 20_000 }).toContain(birthdayMemoryId);

    await tileByFilename(page, "Birthday cake").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Remove from memory" }).click();
    await expect(tileByFilename(page, "Birthday cake")).toHaveCount(0, { timeout: 20_000 });
    await expect(tileByFilename(page, "Birthday candles")).toBeVisible();
    await expect(tileByFilename(page, "Birthday balloons")).toBeVisible();
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return (result.value.memoryRemovedItems || {})[memoryId] || [];
    }, { memoryId: birthdayMemoryId }), { timeout: 20_000 }).toEqual([cakeSource]);

    await memoryActions.getByRole("button", { name: "Reset removed" }).click();
    await expect(tileByFilename(page, "Birthday cake")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return (result.value.memoryRemovedItems || {})[memoryId] || [];
    }, { memoryId: birthdayMemoryId }), { timeout: 20_000 }).toEqual([]);

    await memoryActions.getByRole("button", { name: "Feature memory less" }).click();
    await expect.poll(async () => photoMemoryByName(page, "Birthday 2026"), { timeout: 20_000 }).toBeNull();
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { hiddenMemories?: string[] } }>("photo_curation_preferences", {});
      return result.value.hiddenMemories || [];
    }, { memoryId: birthdayMemoryId }), { timeout: 20_000 }).toContain(birthdayMemoryId);

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const settingsPanel = page.locator("#photos-local-settings");
    await expect(settingsPanel).toBeVisible({ timeout: 20_000 });
    await settingsPanel.getByRole("button", { name: /Reset Memory feedback/ }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { favoriteMemories?: string[]; hiddenMemories?: string[]; memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return {
        favorites: result.value.favoriteMemories || [],
        hidden: result.value.hiddenMemories || [],
        removed: result.value.memoryRemovedItems || {}
      };
    }), { timeout: 20_000 }).toEqual({ favorites: [], hidden: [], removed: {} });
    await expect.poll(async () => photoMemoryByName(page, "Birthday 2026"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 3,
      name: "Birthday 2026"
    }));
    await page.locator(".photos-rail").getByText("Birthday 2026", { exact: true }).click();
    await expect(tileByFilename(page, "Birthday cake")).toBeVisible({ timeout: 20_000 });

    await expect(memoryActions.getByRole("button", { name: "Feature Birthday less" })).toBeVisible();
    await memoryActions.getByRole("button", { name: "Feature Birthday less" }).click();
    await expect.poll(async () => photoMemoryByName(page, "Birthday 2026"), { timeout: 20_000 }).toBeNull();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { featureLessContent?: string[] } }>("photo_curation_preferences", {});
      return result.value.featureLessContent || [];
    }), { timeout: 20_000 }).toContain("Birthday");
    await expect(page.locator(".photos-rail").getByText("Birthday 2026", { exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos IPTC XMP sidecars surface in Info search and export", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-iptc-xmp-e2e-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  mkdirSync(media, { recursive: true });
  const photoPath = path.join(media, "iptc-browser.png");
  writeFileSync(photoPath, ONE_PIXEL_PNG);
  writeFileSync(path.join(media, "iptc-browser.png.xmp"), `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:exif="http://ns.adobe.com/exif/1.0/"
      xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
      xmp:Rating="4"
      photoshop:DateCreated="2026-06-28T09:30:00"
      photoshop:City="San Francisco"
      photoshop:State="California"
      photoshop:Country="United States"
      photoshop:Credit="Browser Unit News"
      photoshop:Source="Browser Harbor Archive"
      photoshop:Headline="Browser ferry headline"
      photoshop:TransmissionReference="BROWSER-JOB-42"
      photoshop:Instructions="Browser syndication note"
      Iptc4xmpCore:CountryCode="US"
      Iptc4xmpExt:Event="Bay Lights Browser"
      exif:GPSLatitude="37,47.548N"
      exif:GPSLongitude="122,23.456W">
      <dc:creator><rdf:Seq><rdf:li>Browser Studio</rdf:li><rdf:li>B. Editor</rdf:li></rdf:Seq></dc:creator>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">IPTC Browser Harbor</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Browser IPTC sidecar caption</rdf:li></rdf:Alt></dc:description>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright 2026 Browser Studio</rdf:li></rdf:Alt></dc:rights>
      <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">Browser editorial use only</rdf:li></rdf:Alt></xmpRights:UsageTerms>
      <dc:subject><rdf:Bag><rdf:li>browser-iptc</rdf:li><rdf:li>metadata</rdf:li></rdf:Bag></dc:subject>
      <Iptc4xmpCore:Location>Browser Ferry Building</Iptc4xmpCore:Location>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`, "utf8");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "IPTC XMP E2E media"
      });
      const sourcePath = (imported.value.importedPaths || []).find((item) => /iptc-browser\.png$/.test(item)) || "";
      if (!sourcePath) throw new Error("Missing imported IPTC browser fixture");
      const page = await crossAge.invoke<{ items: Array<{ sourcePath: string; assetMetadata?: Record<string, any> }> }>("list_photo_folder_items", {
        folderId: "all",
        previewBudget: 0,
        limit: 20
      });
      const item = page.items.find((row) => row.sourcePath === sourcePath);
      return {
        sourcePath,
        iptc: item?.assetMetadata?.xmp?.iptc || {}
      };
    }, { mediaFolder: media });
    expect(seeded.iptc).toEqual(expect.objectContaining({
      credit: "Browser Unit News",
      source: "Browser Harbor Archive",
      event: "Bay Lights Browser",
      jobId: "BROWSER-JOB-42"
    }));

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "IPTC Browser Harbor")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "IPTC Browser Harbor").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible({ timeout: 20_000 });
    const info = lightbox.locator(".photos-info-inspector");
    await expect(info).toContainText("Creator / credit");
    await expect(info).toContainText("Browser Studio");
    await expect(info).toContainText("Browser Unit News");
    await expect(info).toContainText("Rights");
    await expect(info).toContainText("Browser editorial use only");
    await expect(info).toContainText("Event / job");
    await expect(info).toContainText("Bay Lights Browser");
    await expect(info).toContainText("BROWSER-JOB-42");
    await expect(info).toContainText("IPTC location");
    await expect(info).toContainText("Browser Ferry Building");
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);

    const searchBox = page.getByLabel("Search photos");
    await searchBox.fill("Bay Lights Browser");
    const globalSearch = page.getByLabel("Library search results");
    await expect(globalSearch).toBeVisible({ timeout: 20_000 });
    await expect(globalSearch).toContainText("IPTC Browser Harbor");
    await expect(globalSearch).toContainText("IPTC:");
    await expect(globalSearch).toContainText("Bay Lights Browser");
    await searchBox.fill("");

    await tileByFilename(page, "IPTC Browser Harbor").locator(".photo-select-box").click();
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("XMP sidecars").check();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.locator(".photo-export-result")).toContainText("1 written", { timeout: 30_000 });
    const exportRoot = path.join(workspace, "exports");
    const bundleName = readdirSync(exportRoot).filter((entry) => entry.startsWith("vintrace-photo-selection-")).sort().at(-1);
    expect(bundleName).toBeTruthy();
    const manifest = JSON.parse(readFileSync(path.join(exportRoot, bundleName || "", "manifest.json"), "utf8")) as Record<string, any>;
    const row = manifest.items[0] as Record<string, any>;
    const xmpText = readFileSync(String(row.xmpPath || ""), "utf8");
    expect(xmpText).toContain("<dc:creator><rdf:Seq>");
    expect(xmpText).toContain("<rdf:li>Browser Studio</rdf:li>");
    expect(xmpText).toContain("<photoshop:Credit>Browser Unit News</photoshop:Credit>");
    expect(xmpText).toContain("<photoshop:Source>Browser Harbor Archive</photoshop:Source>");
    expect(xmpText).toContain("Copyright 2026 Browser Studio");
    expect(xmpText).toContain("<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang=\"x-default\">Browser editorial use only</rdf:li></rdf:Alt></xmpRights:UsageTerms>");
    expect(xmpText).toContain("<Iptc4xmpExt:Event>Bay Lights Browser</Iptc4xmpExt:Event>");
    expect(xmpText).toContain("<photoshop:TransmissionReference>BROWSER-JOB-42</photoshop:TransmissionReference>");
    expect(xmpText).toContain("<Iptc4xmpCore:CountryCode>US</Iptc4xmpCore:CountryCode>");

    const stripped = await page.evaluate(async ({ sourcePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      return crossAge.invoke<{ value: { items: Array<{ xmpPath?: string }> } }>("export_photo_selection", {
        sourcePaths: [sourcePath],
        includeXmp: true,
        stripLocation: true
      });
    }, { sourcePath: seeded.sourcePath });
    const strippedXmpPath = stripped.value.items[0]?.xmpPath || "";
    expect(strippedXmpPath).toBeTruthy();
    const strippedXmp = readFileSync(strippedXmpPath, "utf8");
    expect(strippedXmp).toContain("Browser editorial use only");
    expect(strippedXmp).toContain("Browser Studio");
    expect(strippedXmp).not.toContain("GPSLatitude");
    expect(strippedXmp).not.toContain("CountryCode");
    expect(strippedXmp).not.toContain("Browser Ferry Building");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Custom Memories expose source-aware album search person place and date creation", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-custom-memory-sources-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, [
    "album-source-one.png",
    "album-source-two.png",
    "album-source-three.png",
    "harbor-source-one.png",
    "harbor-source-two.png",
    "alice-source-one.png",
    "alice-source-two.png",
    "place-source-one.png",
    "place-source-two.png",
    "date-source-one.png",
    "date-source-two.png",
  ]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "custom-memory-source-e2e"
api.project.db.create_scan_run(run_id, "Custom Memory Source E2E", "manual", str(media))
metadata = {
    "album-source-one.png": {"title": "Album source one", "dateOverride": "2026-06-01"},
    "album-source-two.png": {"title": "Album source two", "dateOverride": "2026-06-02"},
    "album-source-three.png": {"title": "Album source three", "dateOverride": "2026-06-03"},
    "harbor-source-one.png": {"title": "Harbor source one", "dateOverride": "2026-06-04"},
    "harbor-source-two.png": {"title": "Harbor source two", "dateOverride": "2026-06-05"},
    "alice-source-one.png": {"title": "Alice source one", "dateOverride": "2026-06-06"},
    "alice-source-two.png": {"title": "Alice source two", "dateOverride": "2026-06-07"},
    "place-source-one.png": {"title": "Place source one", "dateOverride": "2026-06-08", "locationOverride": {"label": "Santa Cruz", "latitude": 36.9741, "longitude": -122.0308}},
    "place-source-two.png": {"title": "Place source two", "dateOverride": "2026-06-09", "locationOverride": {"label": "Santa Cruz", "latitude": 36.9741, "longitude": -122.0308}},
    "date-source-one.png": {"title": "Date source one", "dateOverride": "2026-05-10"},
    "date-source-two.png": {"title": "Date source two", "dateOverride": "2026-05-11"},
}
for index, (name, fields) in enumerate(metadata.items(), start=1):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")
    api.update_photo_asset_metadata({"sourcePath": str(path), **fields})
    if name.startswith("alice-"):
        asset = api.project.db.photo_asset_by_path(str(path))
        with api.project.db.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO photo_asset_people(asset_id, candidate_id, person_name, status, score, quality, band, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (asset["assetId"], f"custom-memory-alice-{index}", "Alice", "accepted", 0.99, 0.95, "confident", "2026-06-26T00:00:00Z"),
            )
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  async function expectUserMemory(name: string, subtitle: string, basenames: string[]) {
    await expect.poll(async () => {
      const memory = await photoUserMemoryByName(page, name);
      if (!memory) return null;
      return {
        subtitle: memory.subtitle || "",
        basenames: (memory.sourcePaths || []).map((item) => path.basename(item)).sort(),
      };
    }, { timeout: 20_000 }).toEqual({
      subtitle,
      basenames: [...basenames].sort(),
    });
  }

  async function createNamedMemory(buttonName: string, memoryName: string) {
    await expect(page.getByRole("button", { name: buttonName })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Memory name").fill(memoryName);
    await page.getByRole("button", { name: buttonName }).click();
    await expect(page.locator(".photos-rail").getByText(memoryName, { exact: true })).toBeVisible({ timeout: 20_000 });
  }

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Album source one")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "Album source one").locator(".photo-select-box").click();
    await tileByFilename(page, "Album source two").locator(".photo-select-box").click();
    await tileByFilename(page, "Album source three").locator(".photo-select-box").click();
    await page.getByLabel("New manual album name").fill("Source Album E2E");
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Add to album" }).click();
    await expect.poll(async () => photoAlbumByName(page, "Source Album E2E"), { timeout: 20_000 }).toEqual(expect.objectContaining({ count: 3 }));
    await createNamedMemory("Create memory from album", "Album Source Memory");
    await expectUserMemory("Album Source Memory", "Album: Source Album E2E", ["album-source-one.png", "album-source-two.png", "album-source-three.png"]);
    await page.locator(".photos-rail").getByText("Album Source Memory", { exact: true }).click();
    await expect(tileByFilename(page, "Album source one")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Album source two")).toBeVisible();
    await expect(tileByFilename(page, "Album source three")).toBeVisible();
    const albumMemory = await photoMemoryByName(page, "Album Source Memory");
    const albumMemoryId = albumMemory?.memoryId || albumMemory?.memory?.memoryId || "";
    const albumSourceOne = (albumMemory?.memory?.sourcePaths || []).find((sourcePath) => /album-source-one\.png$/.test(sourcePath)) || "";
    expect(albumMemoryId).toBeTruthy();
    expect(albumSourceOne).toBeTruthy();
    const albumMemoryActions = page.getByLabel("Memory actions");
    await albumMemoryActions.getByRole("button", { name: "Favorite memory" }).click();
    await expect(albumMemoryActions.getByRole("button", { name: "Unfavorite memory" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { favoriteMemories?: string[] } }>("photo_curation_preferences", {});
      return result.value.favoriteMemories || [];
    }, { memoryId: albumMemoryId }), { timeout: 20_000 }).toContain(albumMemoryId);

    await tileByFilename(page, "Album source one").locator(".photo-select-box").click();
    await page.locator(".photo-bulk-bar").getByRole("button", { name: "Remove from memory" }).click();
    await expect(tileByFilename(page, "Album source one")).toHaveCount(0, { timeout: 20_000 });
    await expect(tileByFilename(page, "Album source two")).toBeVisible();
    await expect(tileByFilename(page, "Album source three")).toBeVisible();
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return (result.value.memoryRemovedItems || {})[memoryId] || [];
    }, { memoryId: albumMemoryId }), { timeout: 20_000 }).toEqual([albumSourceOne]);

    await albumMemoryActions.getByRole("button", { name: "Reset removed" }).click();
    await expect(tileByFilename(page, "Album source one")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return (result.value.memoryRemovedItems || {})[memoryId] || [];
    }, { memoryId: albumMemoryId }), { timeout: 20_000 }).toEqual([]);

    await albumMemoryActions.getByRole("button", { name: "Feature memory less" }).click();
    await expect.poll(async () => photoMemoryByName(page, "Album Source Memory"), { timeout: 20_000 }).toBeNull();
    await expect.poll(async () => page.evaluate(async ({ memoryId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { hiddenMemories?: string[] } }>("photo_curation_preferences", {});
      return result.value.hiddenMemories || [];
    }, { memoryId: albumMemoryId }), { timeout: 20_000 }).toContain(albumMemoryId);

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const customMemorySettingsPanel = page.locator("#photos-local-settings");
    await expect(customMemorySettingsPanel).toBeVisible({ timeout: 20_000 });
    await customMemorySettingsPanel.getByRole("button", { name: /Reset Memory feedback/ }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { favoriteMemories?: string[]; hiddenMemories?: string[]; memoryRemovedItems?: Record<string, string[]> } }>("photo_curation_preferences", {});
      return {
        favorites: result.value.favoriteMemories || [],
        hidden: result.value.hiddenMemories || [],
        removed: result.value.memoryRemovedItems || {}
      };
    }), { timeout: 20_000 }).toEqual({ favorites: [], hidden: [], removed: {} });
    await expect.poll(async () => photoMemoryByName(page, "Album Source Memory"), { timeout: 20_000 }).toEqual(expect.objectContaining({
      count: 3,
      name: "Album Source Memory"
    }));

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.getByLabel("Search photos").fill("Harbor source");
    await expect(tileByFilename(page, "Harbor source one")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Harbor source two")).toBeVisible();
    await createNamedMemory("Create memory from search", "Search Source Memory");
    await expectUserMemory("Search Source Memory", "Search: Harbor source", ["harbor-source-one.png", "harbor-source-two.png"]);

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.getByLabel("Search photos").fill("");
    await expect.poll(async () => photoFolderById(page, "person:Alice"), { timeout: 20_000 }).toEqual(expect.objectContaining({ count: 2 }));
    await page.locator(".photos-rail").getByText("Alice", { exact: true }).click();
    await expect(tileByFilename(page, "Alice source one")).toBeVisible({ timeout: 20_000 });
    await createNamedMemory("Create memory from person", "Person Source Memory");
    await expectUserMemory("Person Source Memory", "Person: Alice", ["alice-source-one.png", "alice-source-two.png"]);

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await expect.poll(async () => photoPlaceByName(page, "Santa Cruz"), { timeout: 20_000 }).toEqual(expect.objectContaining({ count: 2 }));
    await page.locator(".photos-rail").getByText("Santa Cruz", { exact: true }).click();
    await expect(tileByFilename(page, "Place source one")).toBeVisible({ timeout: 20_000 });
    await createNamedMemory("Create memory from place", "Place Source Memory");
    await expectUserMemory("Place Source Memory", "Place: Santa Cruz", ["place-source-one.png", "place-source-two.png"]);

    await page.locator(".photos-rail").getByText("All Photos", { exact: true }).click();
    await page.getByLabel("From date filter").fill("2026-05-10");
    await page.getByLabel("Through date filter").fill("2026-05-11");
    await expect(tileByFilename(page, "Date source one")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "Date source two")).toBeVisible();
    await createNamedMemory("Create memory from date", "Date Source Memory");
    await expectUserMemory("Date Source Memory", "Date: 2026-05-10 to 2026-05-11", ["date-source-one.png", "date-source-two.png"]);
    await expect(page.getByLabel("Memory details")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Memory title").fill("Edited Date Memory");
    await page.getByLabel("Memory subtitle").fill("Edited date subtitle");
    await page.getByRole("button", { name: "Save memory details" }).click();
    await expect(page.locator(".photos-rail").getByText("Edited Date Memory", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectUserMemory("Edited Date Memory", "Edited date subtitle", ["date-source-one.png", "date-source-two.png"]);
    await expect.poll(async () => photoUserMemoryByName(page, "Date Source Memory"), { timeout: 20_000 }).toBeNull();

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosContactSheetExport(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["sheet-alpha.png", "sheet-beta.png", "sheet-extra.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Contact sheet E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /sheet-alpha\.png$/.test(item));
      const beta = paths.find((item) => /sheet-beta\.png$/.test(item));
      const extra = paths.find((item) => /sheet-extra\.png$/.test(item));
      if (!alpha || !beta || !extra) throw new Error("Missing imported contact-sheet fixtures");
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: alpha,
        title: "Sheet Alpha",
        keywords: ["contact"]
      });
      await crossAge.invoke("update_photo_asset_metadata", {
        sourcePath: beta,
        title: "Sheet Beta"
      });
      return { alpha, beta, extra };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Sheet Alpha")).toBeVisible({ timeout: 20_000 });
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
      await expect(tileByFilename(page, "Sheet Alpha")).toBeVisible({ timeout: 20_000 });
    }
    await tileByFilename(page, "Sheet Alpha").locator(".photo-select-box").click();
    await tileByFilename(page, "Sheet Beta").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    const bulkBar = page.locator(".photo-bulk-bar");
    await expect(bulkBar.getByRole("button", { name: "Print sheet" })).toBeDisabled();
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Contact format").selectOption("png");
    await page.getByLabel("Contact sheet title").fill("Browser Proof Sheet");
    await page.getByLabel("Page size").selectOption("a4");
    await page.getByLabel("Caption details").selectOption("metadata");
    await page.getByLabel("Contact sheet columns").fill("8");
    await page.getByLabel("Contact sheet thumbnail size").fill("128");
    await page.getByLabel("Print layout").selectOption("four_up");
    await expect(page.getByLabel("Contact sheet columns")).toBeDisabled();
    await expect(page.getByLabel("Contact sheet thumbnail size")).toBeDisabled();
    await expect(page.getByLabel("Contact captions")).toBeChecked();

    await bulkBar.getByRole("button", { name: "Contact sheet" }).click();
    await expect(page.getByText(/Exported contact sheet with 1 page/)).toBeVisible({ timeout: 20_000 });
    await expect(bulkBar.getByRole("button", { name: "Print sheet" })).toBeEnabled();

    await expect.poll(() => {
      const exportRoot = path.join(workspace, "exports");
      if (!existsSync(exportRoot)) return [] as string[];
      return readdirSync(exportRoot)
        .filter((name) => /^vintrace-contact-sheet-/.test(name))
        .map((name) => path.join(exportRoot, name))
        .sort();
    }, { timeout: 20_000 }).not.toEqual([]);
    const exportRoot = path.join(workspace, "exports");
    const bundlePath = readdirSync(exportRoot)
      .filter((name) => /^vintrace-contact-sheet-/.test(name))
      .map((name) => path.join(exportRoot, name))
      .sort()
      .at(-1) || "";
    const manifestPath = path.join(bundlePath, "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      action?: string;
      format?: string;
      layoutPreset?: string;
      columns?: number;
      thumbnailSize?: number;
      effectiveColumns?: number;
      effectiveThumbnailSize?: number;
      includeCaptions?: boolean;
      captionMode?: string;
      title?: string;
      pageSize?: string;
      counts?: Record<string, number>;
      targetPath?: string;
      bundlePath?: string;
      items?: Array<{ sourcePath?: string; result?: string; label?: string }>;
    };
    expect(manifest).toEqual(expect.objectContaining({
      action: "export_photo_contact_sheet",
      format: "png",
      layoutPreset: "four_up",
      columns: 2,
      thumbnailSize: 520,
      effectiveColumns: 2,
      effectiveThumbnailSize: 520,
      includeCaptions: true,
      captionMode: "metadata",
      title: "Browser Proof Sheet",
      pageSize: "a4",
    }));
    expect(manifest.counts).toEqual(expect.objectContaining({ selected: 2, included: 2, pages: 1 }));
    expect(path.basename(manifest.bundlePath || "")).toBe(path.basename(bundlePath));
    expect(existsSync(manifest.bundlePath || "")).toBe(true);
    expect(manifest.targetPath || "").toMatch(/contact-sheet\.png$/);
    expect(existsSync(manifest.targetPath || "")).toBe(true);
    expect(manifest.items?.map((item) => path.basename(item.sourcePath || "")).sort()).toEqual(["sheet-alpha.png", "sheet-beta.png"]);
    expect(manifest.items?.some((item) => /Keywords: contact/.test(item.label || ""))).toBe(true);

    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as any;
      holder.__photoRevealPaths = [];
      holder.__photoOpenPaths = [];
      holder.__photoOpenWithPaths = [];
      holder.__photoSharePaths = [];
      holder.__photoShareMode = "native";
      holder.__photoPrintPaths = [];
      ipcMain.removeHandler("shell:reveal-path");
      ipcMain.handle("shell:reveal-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__photoRevealPaths.push(String(record.path || ""));
        return true;
      });
      ipcMain.removeHandler("shell:open-path");
      ipcMain.handle("shell:open-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__photoOpenPaths.push(String(record.path || ""));
        return { ok: true, path: String(record.path || "") };
      });
      ipcMain.removeHandler("shell:open-path-with");
      ipcMain.handle("shell:open-path-with", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown; editorPath?: unknown } : {};
        holder.__photoOpenWithPaths.push(String(record.path || ""));
        const editorPath = String(record.editorPath || "/Applications/Vintrace Test Editor.app");
        return {
          ok: true,
          opened: true,
          canceled: false,
          path: String(record.path || ""),
          editorPath,
          editors: [{ path: editorPath, label: "Vintrace Test Editor" }]
        };
      });
      ipcMain.removeHandler("shell:share-paths");
      ipcMain.handle("shell:share-paths", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { paths?: unknown } : {};
        const paths = Array.isArray(record.paths) ? record.paths.map((item) => String(item || "")) : [];
        holder.__photoSharePaths.push(paths);
        if (holder.__photoShareMode === "fallback") {
          return {
            ok: true,
            supported: false,
            shared: false,
            fallback: "reveal",
            count: paths.length,
            filePaths: paths,
            fallbackPath: paths[0] || "",
            fallbackDirectory: paths[0] ? String(paths[0]).replace(/[\\/][^\\/]*$/, "") : ""
          };
        }
        return { ok: true, supported: true, shared: true, count: paths.length, filePaths: paths };
      });
      ipcMain.removeHandler("shell:print-path");
      ipcMain.handle("shell:print-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        const targetPath = String(record.path || "");
        holder.__photoPrintPaths.push(targetPath);
        return { ok: true, supported: true, printed: true };
      });
    });
    const capturedBasenames = async (key: "__photoRevealPaths" | "__photoOpenPaths" | "__photoOpenWithPaths" | "__photoPrintPaths") => {
      const captured = await app.evaluate(() => ({
        __photoRevealPaths: ((globalThis as any).__photoRevealPaths || []) as string[],
        __photoOpenPaths: ((globalThis as any).__photoOpenPaths || []) as string[],
        __photoOpenWithPaths: ((globalThis as any).__photoOpenWithPaths || []) as string[],
        __photoPrintPaths: ((globalThis as any).__photoPrintPaths || []) as string[],
      }));
      return captured[key].map((item) => path.basename(item));
    };
    const capturedShareBasenames = async () => {
      const captured = await app.evaluate(() => ((globalThis as any).__photoSharePaths || []) as string[][]);
      return captured.map((group) => group.map((item) => path.basename(item)));
    };
    const printedBasenames = async () => {
      return capturedBasenames("__photoPrintPaths");
    };

    await page.locator(".photos-rail").getByRole("button", { name: "Settings" }).click();
    const stripLocationDefault = page.locator(".photo-settings-panel label").filter({ hasText: "Strip location by default" }).locator("input");
    await stripLocationDefault.uncheck();
    await expect(stripLocationDefault).not.toBeChecked();

    await bulkBar.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Opened system share menu for 2 photos.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(capturedShareBasenames, { timeout: 10_000 }).toEqual([["sheet-alpha.png", "sheet-beta.png"]]);

    await stripLocationDefault.check();
    await expect(stripLocationDefault).toBeChecked();

    await bulkBar.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Opened system share menu for 2 photos.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(capturedShareBasenames, { timeout: 20_000 }).toEqual([
      ["sheet-alpha.png", "sheet-beta.png"],
      ["sheet-alpha.jpg", "sheet-beta.jpg"]
    ]);

    await app.evaluate(() => {
      (globalThis as any).__photoShareMode = "fallback";
    });
    await bulkBar.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Native share is not available here, so I opened the folder containing 2 selected photos.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(capturedShareBasenames, { timeout: 10_000 }).toEqual([
      ["sheet-alpha.png", "sheet-beta.png"],
      ["sheet-alpha.jpg", "sheet-beta.jpg"],
      ["sheet-alpha.jpg", "sheet-beta.jpg"]
    ]);

    await bulkBar.getByRole("button", { name: "Reveal original" }).click();
    await expect(page.getByText("Photo original shown.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => capturedBasenames("__photoRevealPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png"]);

    await bulkBar.getByRole("button", { name: "Open original" }).click();
    await expect(page.getByText("Photo original opened.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => capturedBasenames("__photoOpenPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png"]);

    await bulkBar.getByRole("button", { name: "Open with..." }).click();
    await expect(page.getByText("Photo original sent to external editor.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => capturedBasenames("__photoOpenWithPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png"]);

    await bulkBar.getByRole("button", { name: "Print original" }).click();
    await expect(page.getByText("Opened the system print dialog.")).toBeVisible({ timeout: 10_000 });
    await expect.poll(printedBasenames, { timeout: 10_000 }).toEqual(["sheet-alpha.png"]);

    await tileByFilename(page, "Sheet Beta").getByRole("button", { name: /Photo actions/ }).click();
    await page.getByRole("menuitem", { name: "Reveal original" }).click();
    await expect.poll(() => capturedBasenames("__photoRevealPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png"]);

    await tileByFilename(page, "Sheet Beta").getByRole("button", { name: /Photo actions/ }).click();
    await page.getByRole("menuitem", { name: "Open original" }).click();
    await expect.poll(() => capturedBasenames("__photoOpenPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png"]);

    await tileByFilename(page, "Sheet Beta").getByRole("button", { name: /Photo actions/ }).click();
    await page.getByRole("menuitem", { name: "Open with..." }).click();
    await expect.poll(() => capturedBasenames("__photoOpenWithPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png"]);

    await tileByFilename(page, "Sheet Beta").getByRole("button", { name: /Photo actions/ }).click();
    await page.getByRole("menuitem", { name: "Print original" }).click();
    await expect.poll(printedBasenames, { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png"]);

    await tileByFilename(page, "sheet-extra.png").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole("button", { name: "Reveal original" }).click();
    await expect.poll(() => capturedBasenames("__photoRevealPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png", "sheet-extra.png"]);
    await lightbox.getByRole("button", { name: "Open original" }).click();
    await expect.poll(() => capturedBasenames("__photoOpenPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png", "sheet-extra.png"]);
    await lightbox.getByRole("button", { name: "Open with..." }).click();
    await expect.poll(() => capturedBasenames("__photoOpenWithPaths"), { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png", "sheet-extra.png"]);
    await lightbox.getByRole("button", { name: "Print original" }).click();
    await expect.poll(printedBasenames, { timeout: 10_000 }).toEqual(["sheet-alpha.png", "sheet-beta.png", "sheet-extra.png"]);
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos contact sheet export uses browser controls and enables print", async () => {
  await exercisePhotosContactSheetExport({ width: 900, height: 620 }, "vintrace-photos-contact-sheet-");
});

test("Photos contact sheet export uses compact browser controls and enables print", async () => {
  await exercisePhotosContactSheetExport({ width: 390, height: 740 }, "vintrace-photos-contact-sheet-compact-");
});

test("Photos burst stacks panel selects and clears a keeper", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-burst-panel-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const burstNames = [
    "Birthday Burst 0001.png",
    "Birthday Burst 0002.png",
    "Birthday Burst 0003 cover.png",
  ];
  writePhotoFixtureSet(media, [...burstNames, "Birthday solo.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Burst panel E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const keeperCandidate = paths.find((item) => /Birthday Burst 0002\.png$/.test(item));
      if (!keeperCandidate || paths.length < 4) throw new Error("Missing imported burst fixtures");
      return { keeperCandidate };
    }, { mediaFolder: media });

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { stacks: Array<{ count: number; keeperCount: number }> } }>("list_photo_burst_stacks", {
        includeItems: true
      });
      return result.value.stacks.map((stack) => ({ count: stack.count, keeperCount: stack.keeperCount }));
    }), { timeout: 20_000 }).toEqual([{ count: 3, keeperCount: 0 }]);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "Birthday Burst 0001.png")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Media filter").selectOption("burst");

    const burstPanel = page.locator(".photo-burst-stack-panel");
    await expect(burstPanel).toBeVisible({ timeout: 20_000 });
    await expect(burstPanel).toContainText("1 stack");
    await expect(burstPanel).toContainText("3 frames · No keeper");

    await burstPanel.getByRole("button", { name: "Select stack" }).click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("3 selected");
    await expect(tileByFilename(page, "Birthday solo.png")).toHaveCount(0);

    const frameTwo = burstPanel.getByRole("button", { name: /Birthday Burst 0002\.png/ });
    await frameTwo.click();
    await expect.poll(async () => page.evaluate(async ({ sourcePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { stacks: Array<{ keeperCount: number; items: Array<{ sourcePath: string; keeper: boolean; selectionRole?: string }> }> } }>("list_photo_burst_stacks", {
        includeItems: true
      });
      const stack = result.value.stacks[0];
      const selected = stack?.items.find((item) => item.sourcePath === sourcePath);
      return { keeperCount: stack?.keeperCount || 0, selectedKeeper: Boolean(selected?.keeper), selectedRole: selected?.selectionRole || "" };
    }, { sourcePath: seeded.keeperCandidate }), { timeout: 20_000 }).toEqual({
      keeperCount: 1,
      selectedKeeper: true,
      selectedRole: "keeper"
    });
    await expect(burstPanel).toContainText("1 keeper");
    await expect(frameTwo).toHaveAttribute("aria-pressed", "true");

    await burstPanel.getByRole("button", { name: "Clear keepers" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { stacks: Array<{ keeperCount: number; items: Array<{ keeper: boolean; selectionRole?: string }> }> } }>("list_photo_burst_stacks", {
        includeItems: true
      });
      const stack = result.value.stacks[0];
      return { keeperCount: stack?.keeperCount || 0, keeperFlags: stack?.items.map((item) => Boolean(item.keeper)) || [] };
    }), { timeout: 20_000 }).toEqual({ keeperCount: 0, keeperFlags: [false, false, false] });
    await expect(burstPanel).toContainText("No keeper");
    await expect(frameTwo).toHaveAttribute("aria-pressed", "false");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos slideshow projects save and play selected photos", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-slideshow-project-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const tools = path.join(temp, "tools");
  const fakeFfmpeg = writeFakeFfmpeg(tools);
  const audio = path.join(temp, "weekend-track.mp3");
  writeFileSync(audio, "fake browser audio fixture", "utf8");
  writePhotoFixtureSet(media, ["slide-alpha.png", "slide-beta.png", "slide-extra.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: fakeFfmpeg,
    CROSSAGE_FFMPEG_PATH: fakeFfmpeg,
    CROSSAGE_TEST_DIALOG_PATHS: audio
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Slideshow project E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /slide-alpha\.png$/.test(item));
      const beta = paths.find((item) => /slide-beta\.png$/.test(item));
      const extra = paths.find((item) => /slide-extra\.png$/.test(item));
      if (!alpha || !beta || !extra) throw new Error("Missing imported slideshow fixtures");
      return { alpha, beta, extra };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "slide-alpha.png")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "slide-alpha.png").locator(".photo-select-box").click();
    await tileByFilename(page, "slide-beta.png").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    const slideshowProjects = page.getByLabel("Slideshow projects");
    const expectedKeyframes = { startX: 20, startY: 40, endX: 80, endY: 60, startZoom: 1.02, endZoom: 1.16, pathMode: "bezier", quarterX: 35, quarterY: 40, quarterZoom: 1.05, midX: 50, midY: 50, midZoom: 1.09, threeQuarterX: 65, threeQuarterY: 60, threeQuarterZoom: 1.12, curve: "cinematic", bezierControl1X: 40, bezierControl1Y: 30, bezierControl2X: 60, bezierControl2Y: 70 };
    const expectedCaptionFields = { captionTypography: "cinematic", captionWrap: "two-line" };
    const expectedExtraCaptions = [{
      id: "caption-2",
      captionText: "Pier seven note",
      captionPlacement: "lower-left",
      captionRegion: { x: 8, y: 76, width: 30, height: 10 },
      captionTypography: "editorial",
      captionWrap: "single-line",
    }];
    const expectedTemplateRegionMap: SlideshowTemplateRegionMap = {
      primary: { x: 11, y: 62, width: 37, height: 16 },
    };
    const expectedTemplateResolvedRegionMap: SlideshowTemplateRegionMap = {
      title: { x: 2, y: 3, width: 46, height: 10 },
      source: { x: 58, y: 3, width: 36, height: 8 },
      chapter: { x: 7, y: 88, width: 55, height: 8 },
      primary: { x: 11, y: 62, width: 37, height: 16 },
      context: { x: 58, y: 13, width: 34, height: 10 },
      counter: { x: 72, y: 82, width: 20, height: 7 },
    };
    await slideshowProjects.getByLabel("Slideshow project name").fill("Weekend Selects");
    await slideshowProjects.getByLabel("Slideshow title").fill("Weekend Highlights");
    await slideshowProjects.getByLabel("Title card", { exact: true }).check();
    await slideshowProjects.getByLabel("Title-card title").fill("Weekend Title Card");
    await slideshowProjects.getByLabel("Title-card subtitle").fill("Two-photo story");
    await slideshowProjects.getByLabel("Title-card duration ms").fill("2500");
    await slideshowProjects.getByLabel("Title-card palette").selectOption("forest");
    await slideshowProjects.getByLabel("Title-card layout").selectOption("lower-third");
    await slideshowProjects.getByLabel("Title-card type").selectOption("compact");
    await slideshowProjects.getByLabel("Title-card footer").uncheck();
    await slideshowProjects.getByLabel("Selected slide duration ms").fill("6000");
    await slideshowProjects.getByRole("button", { name: "Apply selected" }).click();
    const slideshowTimeline = slideshowProjects.getByRole("list", { name: "Slideshow timeline" });
    await slideshowProjects.getByLabel("Theme").selectOption("ken-burns");
    await expect(slideshowTimeline).toContainText("Auto -> Slow zoom");
    await expect(slideshowTimeline).toContainText("Auto -> Pan left");
    await expect(slideshowTimeline).toContainText("Zoom 650ms");
    await slideshowProjects.getByLabel("Selected slide motion").selectOption("pan-left");
    await slideshowProjects.getByRole("button", { name: "Apply motion" }).click();
    await slideshowProjects.getByLabel("Slideshow focal X").fill("35");
    await slideshowProjects.getByLabel("Slideshow focal Y").fill("43");
    await slideshowProjects.getByLabel("Slideshow crop zoom").fill("1.4");
    await slideshowProjects.getByRole("button", { name: "Apply crop" }).click();
    await slideshowProjects.getByLabel("Selected slide caption").fill("Boardwalk at golden hour");
    await slideshowProjects.getByLabel("Selected caption placement").selectOption("upper-right");
    await slideshowProjects.getByLabel("Selected caption typography").selectOption("cinematic");
    await slideshowProjects.getByLabel("Selected caption wrap").selectOption("two-line");
    await setSlideshowCaptionRegion(page, 58, 12, 34, 11);
    await slideshowProjects.getByRole("button", { name: "Apply caption", exact: true }).click();
    await expect(slideshowTimeline).toContainText("Caption: Boardwalk at golden hour");
    await slideshowProjects.getByLabel("Selected caption layer").selectOption("block-0");
    await slideshowProjects.getByLabel("Selected slide caption").fill("Pier seven note");
    await slideshowProjects.getByLabel("Selected caption placement").selectOption("lower-left");
    await slideshowProjects.getByLabel("Selected caption typography").selectOption("editorial");
    await slideshowProjects.getByLabel("Selected caption wrap").selectOption("single-line");
    await setSlideshowCaptionRegion(page, 8, 76, 30, 10);
    await slideshowProjects.getByRole("button", { name: "Apply caption", exact: true }).click();
    await expect(slideshowTimeline).toContainText("Captions: Boardwalk at golden hour +1");
    await slideshowProjects.getByLabel("Path curve").selectOption("cinematic");
    await slideshowProjects.getByLabel("Path editor", { exact: true }).selectOption("anchors");
    await setSlideshowPathAnchor(page, "Start", 20, 40);
    await setSlideshowPathAnchor(page, "End", 80, 60);
    await slideshowProjects.getByLabel("Path editor", { exact: true }).selectOption("bezier");
    await setSlideshowBezierHandle(page, "Bezier control 1", 40, 30);
    await setSlideshowBezierHandle(page, "Bezier control 2", 60, 70);
    await expect(slideshowProjects.getByLabel("Path start X")).toHaveValue("20");
    await expect(slideshowProjects.getByLabel("Path 75% Y")).toHaveValue("60");
    await expect(slideshowProjects.getByLabel("Bezier control 1 Y")).toHaveValue("30");
    await expect(slideshowProjects.getByLabel("Bezier control 2 Y")).toHaveValue("70");
    await slideshowProjects.getByLabel("Start zoom").fill("1.02");
    await slideshowProjects.getByLabel("25% zoom").fill("1.05");
    await slideshowProjects.getByLabel("Mid zoom").fill("1.09");
    await slideshowProjects.getByLabel("75% zoom").fill("1.12");
    await slideshowProjects.getByLabel("End zoom").fill("1.16");
    await slideshowProjects.getByRole("button", { name: "Apply keyframes" }).click();
    await slideshowProjects.getByLabel("Theme").selectOption("fade");
    await slideshowProjects.getByLabel("Timeline style").selectOption("ken-burns-drift");
    await slideshowProjects.getByLabel("Template name").fill("Weekend Matte");
    await slideshowProjects.getByLabel("Template palette").selectOption("paper");
    await slideshowProjects.getByLabel("Template typography").selectOption("editorial");
    await slideshowProjects.getByLabel("Template backdrop", { exact: true }).selectOption("spotlight");
    await slideshowProjects.getByLabel("Template layout").selectOption("poster");
    await slideshowProjects.getByLabel("Template backdrop intensity").fill("70");
    await slideshowProjects.getByLabel("Template stage width").fill("82");
    await slideshowProjects.getByLabel("Template frame").selectOption("matte");
    await slideshowProjects.getByLabel("Template chrome").selectOption("compact");
    await slideshowProjects.getByLabel("Template caption preset").selectOption("split-story");
    await slideshowProjects.getByLabel("Template region slot").selectOption("primary");
    await slideshowProjects.getByLabel("Template region X").fill("11");
    await slideshowProjects.getByLabel("Template region Y").fill("62");
    await slideshowProjects.getByLabel("Template region width").fill("37");
    await slideshowProjects.getByLabel("Template region height").fill("16");
    await slideshowProjects.getByLabel("Transition", { exact: true }).selectOption("dissolve");
    await slideshowProjects.getByLabel("Transition duration ms", { exact: true }).fill("900");
    await slideshowProjects.getByRole("button", { name: "Save template" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { templates: Array<{ name: string; theme: string; themeTimelinePreset?: string; themeTemplatePalette?: string; themeTemplateTypography?: string; themeTemplateBackdrop?: string; themeTemplateLayout?: string; themeTemplateBackdropIntensity?: number; themeTemplateStageWidth?: number; themeTemplateFrameStyle?: string; themeTemplateChromeDensity?: string; themeTemplateCaptionPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap; transitionEffect?: string; transitionDurationMs?: number; titleCardLayout?: string; titleCardFontScale?: string }> } }>("photo_slideshow_theme_templates", {});
      const template =
        result.value.templates.find((item) => item.name === "Weekend Matte" && item.themeTemplateBackdrop === "spotlight" && item.themeTemplateLayout === "poster") ||
        result.value.templates.find((item) => item.name === "Weekend Matte");
      return template
        ? {
          name: template.name,
          theme: template.theme,
          themeTimelinePreset: template.themeTimelinePreset,
          themeTemplatePalette: template.themeTemplatePalette,
          themeTemplateTypography: template.themeTemplateTypography,
          themeTemplateBackdrop: template.themeTemplateBackdrop,
          themeTemplateLayout: template.themeTemplateLayout,
          themeTemplateBackdropIntensity: template.themeTemplateBackdropIntensity,
          themeTemplateStageWidth: template.themeTemplateStageWidth,
          themeTemplateFrameStyle: template.themeTemplateFrameStyle,
          themeTemplateChromeDensity: template.themeTemplateChromeDensity,
          themeTemplateCaptionPreset: template.themeTemplateCaptionPreset,
          themeTemplateRegionMap: template.themeTemplateRegionMap,
          transitionEffect: template.transitionEffect,
          transitionDurationMs: template.transitionDurationMs,
          titleCardLayout: template.titleCardLayout,
          titleCardFontScale: template.titleCardFontScale,
        }
        : null;
    }), { timeout: 20_000 }).toEqual({
      name: "Weekend Matte",
      theme: "fade",
      themeTimelinePreset: "ken-burns-drift",
      themeTemplatePalette: "paper",
      themeTemplateTypography: "editorial",
      themeTemplateBackdrop: "spotlight",
      themeTemplateLayout: "poster",
      themeTemplateBackdropIntensity: 70,
      themeTemplateStageWidth: 82,
      themeTemplateFrameStyle: "matte",
      themeTemplateChromeDensity: "compact",
      themeTemplateCaptionPreset: "split-story",
      themeTemplateRegionMap: expectedTemplateRegionMap,
      transitionEffect: "dissolve",
      transitionDurationMs: 900,
      titleCardLayout: "lower-third",
      titleCardFontScale: "compact",
    });
    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as any;
      holder.__photoSlideshowTemplateRevealPaths = [];
      ipcMain.removeHandler("shell:reveal-path");
      ipcMain.handle("shell:reveal-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__photoSlideshowTemplateRevealPaths.push(String(record.path || ""));
        return true;
      });
    });
    await slideshowProjects.getByRole("button", { name: "Export templates" }).click();
    await expect(slideshowProjects).toContainText("Exported templates:");
    await expect.poll(() => {
      const exportRoot = path.join(workspace, "exports");
      if (!existsSync(exportRoot)) return 0;
      return readdirSync(exportRoot).filter((entry) => /^vintrace-photo-slideshow-theme-templates-.*\.json$/.test(entry)).length;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    const templateLibraryPath = path.join(
      workspace,
      "exports",
      readdirSync(path.join(workspace, "exports"))
        .filter((entry) => /^vintrace-photo-slideshow-theme-templates-.*\.json$/.test(entry))
        .sort()
        .at(-1) || ""
    );
    const templateLibraryPayload = JSON.parse(readFileSync(templateLibraryPath, "utf8")) as {
      format?: string;
      templateCount?: number;
      templates?: Array<{ name?: string; themeTemplateBackdrop?: string; themeTemplateLayout?: string; themeTemplateBackdropIntensity?: number; themeTemplateStageWidth?: number; themeTemplateFrameStyle?: string; themeTemplateChromeDensity?: string; themeTemplateCaptionPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap }>;
    };
    expect(templateLibraryPayload.format).toBe("vintrace-photo-slideshow-theme-templates-v1");
    expect(templateLibraryPayload.templateCount || 0).toBeGreaterThanOrEqual(1);
    expect(templateLibraryPayload.templates?.find((item) => item.name === "Weekend Matte" && item.themeTemplateBackdrop === "spotlight" && item.themeTemplateLayout === "poster")).toMatchObject({
      name: "Weekend Matte",
      themeTemplateBackdrop: "spotlight",
      themeTemplateLayout: "poster",
      themeTemplateBackdropIntensity: 70,
      themeTemplateStageWidth: 82,
      themeTemplateFrameStyle: "matte",
      themeTemplateChromeDensity: "compact",
      themeTemplateCaptionPreset: "split-story",
      themeTemplateRegionMap: expectedTemplateRegionMap,
    });
    await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { templates: Array<{ id: string; name: string }> } }>("photo_slideshow_theme_templates", {});
      const templates = result.value.templates.filter((item) => item.name === "Weekend Matte");
      for (const template of templates) {
        await crossAge.invoke("delete_photo_slideshow_theme_template", { id: template.id });
      }
    });
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { templates: Array<{ name: string }> } }>("photo_slideshow_theme_templates", {});
      return result.value.templates.some((item) => item.name === "Weekend Matte");
    }), { timeout: 20_000 }).toBe(false);
    await app.evaluate((_electron, libraryPath) => {
      (globalThis as any).process.env.CROSSAGE_TEST_DIALOG_PATHS = libraryPath;
    }, templateLibraryPath);
    await slideshowProjects.getByRole("button", { name: "Import templates" }).click();
    await expect(slideshowProjects).toContainText("Imported templates:");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { templates: Array<{ name: string; themeTemplateBackdrop?: string; themeTemplateLayout?: string; themeTemplateBackdropIntensity?: number; themeTemplateStageWidth?: number; themeTemplateFrameStyle?: string; themeTemplateChromeDensity?: string; themeTemplateCaptionPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap }> } }>("photo_slideshow_theme_templates", {});
      const template =
        result.value.templates.find((item) => item.name === "Weekend Matte" && item.themeTemplateBackdrop === "spotlight" && item.themeTemplateLayout === "poster") ||
        result.value.templates.find((item) => item.name === "Weekend Matte");
      return template
        ? {
          backdrop: template.themeTemplateBackdrop || "",
          layout: template.themeTemplateLayout || "",
          backdropIntensity: template.themeTemplateBackdropIntensity,
          stageWidth: template.themeTemplateStageWidth,
          frameStyle: template.themeTemplateFrameStyle || "",
          chromeDensity: template.themeTemplateChromeDensity || "",
          captionPreset: template.themeTemplateCaptionPreset || "",
          regionMap: template.themeTemplateRegionMap || {},
        }
        : null;
    }), { timeout: 20_000 }).toEqual({ backdrop: "spotlight", layout: "poster", backdropIntensity: 70, stageWidth: 82, frameStyle: "matte", chromeDensity: "compact", captionPreset: "split-story", regionMap: expectedTemplateRegionMap });
    await app.evaluate((_electron, audioPath) => {
      (globalThis as any).process.env.CROSSAGE_TEST_DIALOG_PATHS = audioPath;
    }, audio);
    await slideshowProjects.getByLabel("Template palette").selectOption("forest");
    await slideshowProjects.getByLabel("Template typography").selectOption("clean");
    await slideshowProjects.getByLabel("Template backdrop", { exact: true }).selectOption("glass");
    await slideshowProjects.getByLabel("Template layout").selectOption("minimal");
    await slideshowProjects.getByLabel("Template backdrop intensity").fill("25");
    await slideshowProjects.getByLabel("Template stage width").fill("60");
    await slideshowProjects.getByLabel("Template frame").selectOption("none");
    await slideshowProjects.getByLabel("Template chrome").selectOption("spacious");
    await slideshowProjects.getByLabel("Transition", { exact: true }).selectOption("cut");
    await slideshowProjects.getByLabel("Template preset").selectOption({ label: "Weekend Matte" });
    await expect(slideshowProjects.getByLabel("Template palette")).toHaveValue("paper");
    await expect(slideshowProjects.getByLabel("Template typography")).toHaveValue("editorial");
    await expect(slideshowProjects.getByLabel("Template backdrop", { exact: true })).toHaveValue("spotlight");
    await expect(slideshowProjects.getByLabel("Template layout")).toHaveValue("poster");
    await expect(slideshowProjects.getByLabel("Template backdrop intensity")).toHaveValue("70");
    await expect(slideshowProjects.getByLabel("Template stage width")).toHaveValue("82");
    await expect(slideshowProjects.getByLabel("Template frame")).toHaveValue("matte");
    await expect(slideshowProjects.getByLabel("Template chrome")).toHaveValue("compact");
    await expect(slideshowProjects.getByLabel("Template caption preset")).toHaveValue("split-story");
    await expect(slideshowProjects.getByLabel("Template region slot")).toHaveValue("primary");
    await expect(slideshowProjects.getByLabel("Template region X")).toHaveValue("11");
    await expect(slideshowProjects.getByLabel("Template region Y")).toHaveValue("62");
    await expect(slideshowProjects.getByLabel("Template region width")).toHaveValue("37");
    await expect(slideshowProjects.getByLabel("Template region height")).toHaveValue("16");
    await expect(slideshowProjects.getByLabel("Transition", { exact: true })).toHaveValue("dissolve");
    await slideshowProjects.getByLabel("Selected transition", { exact: true }).selectOption("fade");
    await slideshowProjects.getByLabel("Selected transition duration ms", { exact: true }).fill("500");
    await slideshowProjects.getByRole("button", { name: "Apply transition" }).click();
    await tileByFilename(page, "slide-alpha.png").locator(".photo-select-box").click();
    await tileByFilename(page, "slide-beta.png").locator(".photo-select-box").click();
    await slideshowProjects.getByLabel("Music").selectOption("calm");
    await slideshowProjects.getByRole("button", { name: "Audio file" }).click();
    await expect(slideshowProjects.getByRole("button", { name: "weekend-track.mp3" })).toBeVisible();
    await slideshowProjects.getByLabel("Audio volume").fill("55");
    await slideshowProjects.getByLabel("Audio fade ms").fill("750");
    await slideshowProjects.getByLabel("Audio start ms").fill("500");
    await slideshowProjects.getByLabel("Audio end ms").fill("1500");
    await expect(slideshowTimeline).toContainText("slide-alpha.png");
    await expect(slideshowTimeline).toContainText("slide-beta.png");
    await expect(slideshowTimeline).toContainText("6.0s");
    await expect(slideshowTimeline).toContainText("Custom path");
    await expect(slideshowTimeline).toContainText("Path 20,40->35,40->50,50->65,60->80,60");
    await expect(slideshowTimeline).toContainText("Bezier handles 40,30 / 60,70");
    await expect(slideshowTimeline).toContainText("Cinematic curve");
    await expect(slideshowTimeline).toContainText("Focus 35,43 · 1.40x");
    await expect(slideshowTimeline).toContainText("Fade 500ms");
    await dragSlideshowTimelineCard(page, "slide-alpha.png", "slide-beta.png", "after");
    await expect(slideshowTimeline.getByRole("listitem").nth(0)).toContainText("slide-beta.png");
    await expect(slideshowTimeline.getByRole("listitem").nth(1)).toContainText("slide-alpha.png");
    await tileByFilename(page, "slide-beta.png").locator(".photo-select-box").click();
    await slideshowProjects.getByRole("button", { name: "Set audio start" }).click();
    await tileByFilename(page, "slide-beta.png").locator(".photo-select-box").click();
    await tileByFilename(page, "slide-alpha.png").locator(".photo-select-box").click();
    await slideshowProjects.getByRole("button", { name: "Set audio end" }).click();
    await tileByFilename(page, "slide-alpha.png").locator(".photo-select-box").click();
    await expect(slideshowTimeline).toContainText("Audio starts");
    await expect(slideshowTimeline).toContainText("Audio ends");
    await slideshowProjects.getByRole("button", { name: "Save slideshow" }).click();

    await expect.poll(async () => page.evaluate(async ({ expected }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { projects: Array<{ name: string; title: string; theme: string; themeTimelinePreset?: string; themeTemplateName?: string; themeTemplatePalette?: string; themeTemplateTypography?: string; themeTemplateBackdrop?: string; themeTemplateLayout?: string; themeTemplateBackdropIntensity?: number; themeTemplateStageWidth?: number; themeTemplateFrameStyle?: string; themeTemplateChromeDensity?: string; themeTemplateCaptionPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap; music: string; musicPath?: string; audioVolume?: number; audioFadeMs?: number; audioStartMs?: number; audioEndMs?: number; audioPlacementStartSourcePath?: string; audioPlacementEndSourcePath?: string; includeTitleCard?: boolean; titleCardTitle?: string; titleCardSubtitle?: string; titleCardDurationMs?: number; titleCardPalette?: string; titleCardLayout?: string; titleCardFontScale?: string; titleCardShowFooter?: boolean; timelineItems?: Array<{ sourcePath?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; transitionDurationMs?: number }>; transitionEffect?: string; transitionDurationMs?: number; sourcePaths: string[] }> } }>("photo_slideshow_projects", {});
      const project = result.value.projects.find((item) => item.name === "Weekend Selects");
      return project
        ? {
          title: project.title,
          theme: project.theme,
          themeTimelinePreset: project.themeTimelinePreset,
          themeTemplateName: project.themeTemplateName,
          themeTemplatePalette: project.themeTemplatePalette,
          themeTemplateTypography: project.themeTemplateTypography,
          themeTemplateBackdrop: project.themeTemplateBackdrop,
          themeTemplateLayout: project.themeTemplateLayout,
          themeTemplateBackdropIntensity: project.themeTemplateBackdropIntensity,
          themeTemplateStageWidth: project.themeTemplateStageWidth,
          themeTemplateFrameStyle: project.themeTemplateFrameStyle,
          themeTemplateChromeDensity: project.themeTemplateChromeDensity,
          themeTemplateCaptionPreset: project.themeTemplateCaptionPreset,
          themeTemplateRegionMap: project.themeTemplateRegionMap,
          music: project.music,
          musicPath: project.musicPath || "",
          audioVolume: project.audioVolume,
          audioFadeMs: project.audioFadeMs,
          audioStartMs: project.audioStartMs,
          audioEndMs: project.audioEndMs,
          audioPlacementStartName: project.audioPlacementStartSourcePath ? project.audioPlacementStartSourcePath.split(/[\\/]/).pop() : "",
          audioPlacementEndName: project.audioPlacementEndSourcePath ? project.audioPlacementEndSourcePath.split(/[\\/]/).pop() : "",
          includeTitleCard: project.includeTitleCard,
          titleCardTitle: project.titleCardTitle,
          titleCardSubtitle: project.titleCardSubtitle,
          titleCardDurationMs: project.titleCardDurationMs,
          titleCardPalette: project.titleCardPalette,
          titleCardLayout: project.titleCardLayout,
          titleCardFontScale: project.titleCardFontScale,
          titleCardShowFooter: project.titleCardShowFooter,
          transitionEffect: project.transitionEffect,
          transitionDurationMs: project.transitionDurationMs,
          timelineDurations: (project.timelineItems || []).map((item) => ({
            name: item.sourcePath ? item.sourcePath.split(/[\\/]/).pop() : "",
            durationMs: item.durationMs,
            motion: item.motion,
            keyframes: item.keyframes || null,
            focalX: item.focalX,
            focalY: item.focalY,
            cropZoom: item.cropZoom,
            captionText: item.captionText,
            captionPlacement: item.captionPlacement,
            captionRegion: item.captionRegion,
            captionTypography: item.captionTypography,
            captionWrap: item.captionWrap,
            captions: (item as any).captions,
            transitionEffect: item.transitionEffect,
            transitionDurationMs: item.transitionDurationMs,
          })),
          sourceOrder: project.sourcePaths.map((item) => item.split(/[\\/]/).pop()),
          hasAlpha: project.sourcePaths.includes(expected.alpha),
          hasBeta: project.sourcePaths.includes(expected.beta),
          hasExtra: project.sourcePaths.includes(expected.extra),
          count: project.sourcePaths.length,
        }
        : null;
    }, { expected: seeded }), { timeout: 20_000 }).toEqual({
      title: "Weekend Highlights",
      theme: "fade",
      themeTimelinePreset: "ken-burns-drift",
      themeTemplateName: "Weekend Matte",
      themeTemplatePalette: "paper",
      themeTemplateTypography: "editorial",
      themeTemplateBackdrop: "spotlight",
      themeTemplateLayout: "poster",
      themeTemplateBackdropIntensity: 70,
      themeTemplateStageWidth: 82,
      themeTemplateFrameStyle: "matte",
      themeTemplateChromeDensity: "compact",
      themeTemplateCaptionPreset: "split-story",
      themeTemplateRegionMap: expectedTemplateRegionMap,
      music: "custom",
      musicPath: audio,
      audioVolume: 0.55,
      audioFadeMs: 750,
      audioStartMs: 500,
      audioEndMs: 1500,
      audioPlacementStartName: "slide-beta.png",
      audioPlacementEndName: "slide-alpha.png",
      includeTitleCard: true,
      titleCardTitle: "Weekend Title Card",
      titleCardSubtitle: "Two-photo story",
      titleCardDurationMs: 2500,
      titleCardPalette: "forest",
      titleCardLayout: "lower-third",
      titleCardFontScale: "compact",
      titleCardShowFooter: false,
      transitionEffect: "dissolve",
      transitionDurationMs: 900,
      timelineDurations: [
        { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
        { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
      ],
      sourceOrder: ["slide-beta.png", "slide-alpha.png"],
      hasAlpha: true,
      hasBeta: true,
      hasExtra: false,
      count: 2,
    });

    await tileByFilename(page, "slide-alpha.png").locator(".photo-select-box").click();
    await tileByFilename(page, "slide-beta.png").locator(".photo-select-box").click();
    await slideshowProjects.getByRole("button", { name: "Save slideshow" }).click();
    await expect.poll(async () => page.evaluate(async ({ expected }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { projects: Array<{ name: string; sourcePaths: string[] }> } }>("photo_slideshow_projects", {});
      const project = result.value.projects.find((item) => item.name === "Weekend Selects");
      return project
        ? {
          sourceOrder: project.sourcePaths.map((item) => item.split(/[\\/]/).pop()),
          hasAlpha: project.sourcePaths.includes(expected.alpha),
          hasBeta: project.sourcePaths.includes(expected.beta),
          hasExtra: project.sourcePaths.includes(expected.extra),
          count: project.sourcePaths.length,
        }
        : null;
    }, { expected: seeded }), { timeout: 20_000 }).toEqual({
      sourceOrder: ["slide-beta.png", "slide-alpha.png"],
      hasAlpha: true,
      hasBeta: true,
      hasExtra: false,
      count: 2,
    });

    await expect(slideshowProjects.getByRole("button", { name: "Play project" })).toBeEnabled();
    await slideshowProjects.getByRole("button", { name: "Play project" }).click();
    const slideshow = page.getByRole("dialog", { name: /Slideshow: Weekend Highlights/ });
    await expect(slideshow).toBeVisible({ timeout: 20_000 });
    await expect(slideshow).toHaveClass(/transition-fade/);
    await expect(slideshow.locator(".photos-slideshow-media-frame.motion-custom")).toBeVisible();
    const playbackCaptions = slideshow.locator(".photos-slideshow-caption");
    await expect(playbackCaptions).toHaveCount(2);
    await expect(playbackCaptions.nth(0)).toContainText("Boardwalk at golden hour");
    await expect(playbackCaptions.nth(0)).toHaveClass(/typography-cinematic/);
    await expect(playbackCaptions.nth(0)).toHaveClass(/wrap-two-line/);
    await expect(playbackCaptions.nth(1)).toContainText("Pier seven note");
    await expect(playbackCaptions.nth(1)).toHaveClass(/typography-editorial/);
    await expect(playbackCaptions.nth(1)).toHaveClass(/wrap-single-line/);
    await expect(slideshow).toContainText("1 / 2");
    await expect(slideshow).toContainText("Selection");
    await expect(slideshow).toContainText("Music: weekend-track.mp3");
    await expect(slideshow).toContainText("Template: Weekend Matte / paper / editorial / spotlight / poster / Frame matte / Chrome compact / Captions split story / Backdrop 70% / Stage 82%");
    await expect(slideshow).toHaveClass(/template-layout-poster/);
    await expect(slideshow).toHaveClass(/template-frame-matte/);
    await expect(slideshow).toHaveClass(/template-chrome-compact/);
    const playbackCropStyle = await slideshow.locator(".photos-slideshow-image").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        objectPosition: style.objectPosition,
        transformOrigin: style.transformOrigin,
      };
    });
    expect(playbackCropStyle.objectPosition).toBe("35% 43%");
    const playbackCaptionStyle = await slideshow.locator(".photos-slideshow-caption").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        left: style.left,
        top: style.top,
        width: style.width,
      };
    });
    expect(Number.parseFloat(playbackCaptionStyle.left)).toBeGreaterThan(0);
    expect(Number.parseFloat(playbackCaptionStyle.top)).toBeGreaterThan(0);
    expect(Number.parseFloat(playbackCaptionStyle.width)).toBeGreaterThan(0);
    const playbackTemplateVars = await slideshow.evaluate((element) => {
      const style = getComputedStyle(element);
      const stageWidth = style.getPropertyValue("--photo-slideshow-template-stage-poster-width").trim();
      return {
        backdropOpacity: Number(style.getPropertyValue("--photo-slideshow-template-overlay-opacity").trim()),
        posterWidth: Number.parseFloat(stageWidth),
        framePadding: style.getPropertyValue("--photo-slideshow-template-frame-padding").trim(),
        chromePadding: style.getPropertyValue("--photo-slideshow-template-chrome-padding").trim(),
        chapterSize: style.getPropertyValue("--photo-slideshow-template-chapter-size").trim(),
      };
    });
    expect(playbackTemplateVars.backdropOpacity).toBeCloseTo(0.7, 3);
    expect(playbackTemplateVars.posterWidth).toBeCloseTo(60.68, 2);
    expect(playbackTemplateVars.framePadding).toBe("8px");
    expect(playbackTemplateVars.chromePadding).toBe("6px");
    expect(playbackTemplateVars.chapterSize).toBe("28px");
    await expect(slideshow.getByRole("button", { name: "Mute music" })).toBeVisible();
    await slideshow.getByRole("button", { name: "Mute music" }).click();
    await expect(slideshow.getByRole("button", { name: "Unmute music" })).toBeVisible();
    await page.keyboard.press("m");
    await expect(slideshow.getByRole("button", { name: "Mute music" })).toBeVisible();
    await slideshow.getByRole("button", { name: "Next slide" }).click();
    await expect(slideshow).toContainText("2 / 2");
    await expect(slideshow).toHaveClass(/transition-fade/);
    await slideshow.getByRole("button", { name: "Previous slide" }).click();
    await expect(slideshow).toContainText("1 / 2");
    await slideshow.getByRole("button", { name: "Pause" }).click();
    await expect(slideshow.getByRole("button", { name: "Play" })).toBeVisible();
    await slideshow.getByRole("button", { name: "Fill" }).click();
    await expect(slideshow.getByRole("button", { name: "Fit" })).toBeVisible();
    await slideshow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(slideshow).toHaveCount(0);

    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as any;
      holder.__photoSlideshowRevealPaths = [];
      ipcMain.removeHandler("shell:reveal-path");
      ipcMain.handle("shell:reveal-path", async (_event, payload = {}) => {
        const record = payload && typeof payload === "object" ? payload as { path?: unknown } : {};
        holder.__photoSlideshowRevealPaths.push(String(record.path || ""));
        return true;
      });
    });
    await expect(slideshowProjects.getByRole("button", { name: "Export slideshow" })).toBeEnabled();
    await slideshowProjects.getByRole("button", { name: "Export slideshow" }).click();
    await expect(page.getByText(/Exported slideshow with 2 slides/)).toBeVisible({ timeout: 20_000 });

    await expect.poll(() => {
      const exportRoot = path.join(workspace, "exports");
      if (!existsSync(exportRoot)) return [] as string[];
      return readdirSync(exportRoot)
        .filter((name) => /^vintrace-slideshow-/.test(name))
        .map((name) => path.join(exportRoot, name))
        .sort();
    }, { timeout: 20_000 }).not.toEqual([]);
    const exportRoot = path.join(workspace, "exports");
    const bundlePath = readdirSync(exportRoot)
      .filter((name) => /^vintrace-slideshow-/.test(name))
      .map((name) => path.join(exportRoot, name))
      .sort()
      .at(-1) || "";
    const manifestPath = path.join(bundlePath, "manifest.json");
    const htmlPath = path.join(bundlePath, "index.html");
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      action?: string;
      title?: string;
      sourceLabel?: string;
      theme?: string;
      music?: string;
      audioVolume?: number;
      audioFadeMs?: number;
      audioStartMs?: number;
      audioEndMs?: number;
      audioPlacementStartSourcePath?: string;
      audioPlacementEndSourcePath?: string;
      audioPlacementStartMs?: number;
      audioPlacementEndMs?: number;
      transitionEffect?: string;
      transitionResolvedEffect?: string;
      transitionDurationMs?: number;
      themeTimelinePreset?: string;
      themeTemplateName?: string;
      themeTemplatePalette?: string;
      themeTemplateTypography?: string;
      themeTemplateBackdrop?: string;
      themeTemplateLayout?: string;
      themeTemplateBackdropIntensity?: number;
      themeTemplateStageWidth?: number;
      themeTemplateFrameStyle?: string;
      themeTemplateChromeDensity?: string;
      themeTemplateCaptionPreset?: string;
      themeTemplateRegionMap?: SlideshowTemplateRegionMap;
      templateCaptionResolvedRegionMap?: SlideshowTemplateRegionMap;
      fitMode?: string;
      intervalMs?: number;
      timelineDurationMs?: number;
      timelineItems?: Array<{ sourcePath?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; transitionDurationMs?: number }>;
      resolvedTimelineItems?: Array<{ sourcePath?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; resolvedMotion?: string; transitionOut?: string; transitionDurationMs?: number; themeCue?: string }>;
      motionPresets?: string[];
      resolvedMotionPresets?: string[];
      chapters?: Array<{ label?: string; kind?: string; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; resolvedMotion?: string; startMs?: number; durationMs?: number; slideIndex?: number }>;
      customAudio?: { included?: boolean; sourcePath?: string; targetPath?: string; relativePath?: string; trimStartMs?: number; trimEndMs?: number; placementStartMs?: number; placementEndMs?: number };
      titleCard?: { included?: boolean; title?: string; subtitle?: string; durationMs?: number; targetPath?: string; relativePath?: string; palette?: string; resolvedPalette?: string; layout?: string; fontScale?: string; showFooter?: boolean };
      counts?: Record<string, number>;
      bundlePath?: string;
      htmlPath?: string;
      items?: Array<{ sourcePath?: string; targetPath?: string; relativePath?: string; result?: string; mediaKind?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; resolvedMotion?: string; transitionOut?: string; transitionDurationMs?: number; themeCue?: string; timelineStartMs?: number; timelineEndMs?: number; generated?: boolean }>;
    };
    expect(manifest).toEqual(expect.objectContaining({
      action: "export_photo_slideshow",
      title: "Weekend Highlights",
      sourceLabel: "Selection",
      theme: "fade",
      music: "custom",
      audioVolume: 0.55,
      audioFadeMs: 750,
      audioStartMs: 500,
      audioEndMs: 1500,
      audioPlacementStartMs: 2500,
      audioPlacementEndMs: 14500,
      transitionEffect: "dissolve",
      transitionResolvedEffect: "dissolve",
      transitionDurationMs: 900,
      themeTimelinePreset: "ken-burns-drift",
      themeTemplateName: "Weekend Matte",
      themeTemplatePalette: "paper",
      themeTemplateTypography: "editorial",
      themeTemplateBackdrop: "spotlight",
      themeTemplateLayout: "poster",
      themeTemplateBackdropIntensity: 70,
      themeTemplateStageWidth: 82,
      themeTemplateFrameStyle: "matte",
      themeTemplateChromeDensity: "compact",
      themeTemplateCaptionPreset: "split-story",
      themeTemplateRegionMap: expectedTemplateRegionMap,
      templateCaptionResolvedRegionMap: expectedTemplateResolvedRegionMap,
      fitMode: "fit",
      intervalMs: 4500,
      timelineDurationMs: 14500,
    }));
    expect(manifest.timelineItems?.map((item) => ({
      name: path.basename(item.sourcePath || ""),
      durationMs: item.durationMs,
      motion: item.motion,
      keyframes: item.keyframes || null,
      focalX: item.focalX,
      focalY: item.focalY,
      cropZoom: item.cropZoom,
      captionText: item.captionText,
      captionPlacement: item.captionPlacement,
      captionRegion: item.captionRegion,
      captionTypography: item.captionTypography,
      captionWrap: item.captionWrap,
      captions: (item as any).captions,
      transitionEffect: item.transitionEffect,
      transitionDurationMs: item.transitionDurationMs,
    }))).toEqual([
      { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
      { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
    ]);
    expect(manifest.motionPresets).toEqual(["still", "pan-left"]);
    expect(manifest.resolvedMotionPresets).toEqual(["still", "custom"]);
    expect(manifest.resolvedTimelineItems?.map((item) => ({
      name: path.basename(item.sourcePath || ""),
      durationMs: item.durationMs,
      motion: item.motion,
      keyframes: item.keyframes || null,
      focalX: item.focalX,
      focalY: item.focalY,
      cropZoom: item.cropZoom,
      captionText: item.captionText,
      captionPlacement: item.captionPlacement,
      captionRegion: item.captionRegion,
      captionTypography: item.captionTypography,
      captionWrap: item.captionWrap,
      captions: (item as any).captions,
      transitionEffect: item.transitionEffect,
      resolvedMotion: item.resolvedMotion,
      transitionOut: item.transitionOut,
      transitionDurationMs: item.transitionDurationMs,
      themeCue: item.themeCue,
    }))).toEqual([
      { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "fade", transitionDurationMs: 500, themeCue: "Custom keyframes 1" },
      { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "cut", transitionDurationMs: 0, themeCue: "Custom keyframes 2" },
    ]);
    expect(manifest.customAudio?.included).toBe(true);
    expect(path.basename(manifest.customAudio?.sourcePath || "")).toBe("weekend-track.mp3");
    expect(manifest.customAudio?.trimStartMs).toBe(500);
    expect(manifest.customAudio?.trimEndMs).toBe(1500);
    expect(manifest.customAudio?.placementStartMs).toBe(2500);
    expect(manifest.customAudio?.placementEndMs).toBe(14500);
    expect(manifest.customAudio?.relativePath || "").toMatch(/^media\/\d{5}-weekend-track\.mp3$/);
    expect(existsSync(String(manifest.customAudio?.targetPath || ""))).toBe(true);
    expect(manifest.titleCard).toEqual(expect.objectContaining({
      included: true,
      title: "Weekend Title Card",
      subtitle: "Two-photo story",
      durationMs: 2500,
      palette: "forest",
      layout: "lower-third",
      fontScale: "compact",
      showFooter: false,
    }));
    expect(manifest.titleCard?.relativePath || "").toMatch(/title-card\.png$/);
    expect(existsSync(String(manifest.titleCard?.targetPath || ""))).toBe(true);
    expect(manifest.counts).toEqual(expect.objectContaining({ selected: 2, included: 2, missing: 0, unsupported: 0 }));
    expect(path.basename(manifest.bundlePath || "")).toBe(path.basename(bundlePath));
    expect(path.basename(manifest.htmlPath || "")).toBe("index.html");
    expect(manifest.items?.[0]).toEqual(expect.objectContaining({ result: "title_card", generated: true }));
    expect(manifest.items?.[0]).toEqual(expect.objectContaining({ durationMs: 2500, timelineStartMs: 0, timelineEndMs: 2500 }));
    expect(manifest.items
      ?.filter((item) => item.result === "included")
      .map((item) => path.basename(item.sourcePath || ""))
      .sort()
    ).toEqual(["slide-alpha.png", "slide-beta.png"]);
    expect(manifest.items?.filter((item) => item.result === "included").map((item) => ({
      name: path.basename(item.sourcePath || ""),
      durationMs: item.durationMs,
      motion: item.motion,
      keyframes: item.keyframes || null,
      focalX: item.focalX,
      focalY: item.focalY,
      cropZoom: item.cropZoom,
      captionText: item.captionText,
      captionPlacement: item.captionPlacement,
      captionRegion: item.captionRegion,
      captionTypography: item.captionTypography,
      captionWrap: item.captionWrap,
      captions: (item as any).captions,
      transitionEffect: item.transitionEffect,
      resolvedMotion: item.resolvedMotion,
      transitionOut: item.transitionOut,
      transitionDurationMs: item.transitionDurationMs,
      themeCue: item.themeCue,
      timelineStartMs: item.timelineStartMs,
      timelineEndMs: item.timelineEndMs,
    }))).toEqual([
      { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "fade", transitionDurationMs: 500, themeCue: "Custom keyframes 1", timelineStartMs: 2500, timelineEndMs: 8500 },
      { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "cut", transitionDurationMs: 0, themeCue: "Custom keyframes 2", timelineStartMs: 8500, timelineEndMs: 14500 },
    ]);
    expect(manifest.chapters?.map((chapter) => ({
      label: chapter.label,
      kind: chapter.kind,
      motion: chapter.motion,
      keyframes: chapter.keyframes || null,
      focalX: chapter.focalX,
      focalY: chapter.focalY,
      cropZoom: chapter.cropZoom,
      captionText: chapter.captionText,
      captionPlacement: chapter.captionPlacement,
      captionRegion: chapter.captionRegion,
      captionTypography: chapter.captionTypography,
      captionWrap: chapter.captionWrap,
      captions: (chapter as any).captions,
      resolvedMotion: chapter.resolvedMotion,
      startMs: chapter.startMs,
      durationMs: chapter.durationMs,
      slideIndex: chapter.slideIndex,
    }))).toEqual([
      { label: "Weekend Title Card", kind: "titleCard", motion: "still", keyframes: null, focalX: undefined, focalY: undefined, cropZoom: undefined, captionText: undefined, captionPlacement: undefined, captionRegion: undefined, captionTypography: undefined, captionWrap: undefined, captions: undefined, resolvedMotion: "still", startMs: 0, durationMs: 2500, slideIndex: 0 },
      { label: "Boardwalk at golden hour", kind: "image", motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, resolvedMotion: "custom", startMs: 2500, durationMs: 6000, slideIndex: 1 },
      { label: "Boardwalk at golden hour", kind: "image", motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, resolvedMotion: "custom", startMs: 8500, durationMs: 6000, slideIndex: 2 },
    ]);
    expect(manifest.items?.filter((item) => item.result === "included").every((item) => item.mediaKind === "image")).toBe(true);
    for (const item of (manifest.items || []).filter((entry) => entry.result === "included")) {
      expect(item.relativePath || "").toMatch(/^media\/\d{5}-slide-(alpha|beta)\.png$/);
      expect(existsSync(String(item.targetPath || ""))).toBe(true);
      expect(existsSync(path.join(bundlePath, String(item.relativePath || "")))).toBe(true);
    }
    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain("Weekend Highlights");
    expect(html).toContain("const slides = ");
    expect(html).toContain("const chapters = ");
    expect(html).toContain("const customAudio = ");
    expect(html).toContain("weekend-track.mp3");
    expect(html).toContain("transition-dissolve");
    expect(html).toContain("timeline: ken-burns-drift");
    expect(html).toContain("template: Weekend Matte / paper / editorial / spotlight / poster / frame matte / chrome compact / captions split-story / backdrop 70% / stage 82%");
    expect(html).toContain("--template-bg: #eeeae0");
    expect(html).toContain("--template-font: Georgia, Times New Roman, serif");
    expect(html).toContain("--template-overlay: radial-gradient");
    expect(html).toContain("--template-overlay-opacity: 0.700");
    expect(html).toContain("--template-stage-poster-width: 60.680vw");
    expect(html).toContain("--template-frame-padding: 8px");
    expect(html).toContain("--template-chrome-padding: 6px");
    expect(html).toContain("--template-stage-shadow: 0 0 120px");
    expect(html).toContain('class="template-layout-poster template-frame-matte template-chrome-compact"');
    expect(html).toContain("body.template-layout-poster main");
    expect(html).toContain("body.template-frame-none main, body.template-frame-hairline main, body.template-frame-matte main, body.template-frame-accent main");
    expect(html).toContain("motion-custom");
    expect(html).toContain('"startX": 20');
    expect(html).toContain('"pathMode": "bezier"');
    expect(html).toContain('"bezierControl1Y": 30');
    expect(html).toContain('"curve": "cinematic"');
    expect(html).toContain('"focalX": 35');
    expect(html).toContain('"cropZoom": 1.4');
    expect(html).toContain('"captionText": "Boardwalk at golden hour"');
    expect(html).toContain('"captionText": "Pier seven note"');
    expect(html).toContain('"captions": [');
    expect(html).toContain('"captionPlacement": "upper-right"');
    expect(html).toContain('"captionRegion"');
    expect(html).toContain("const templateCaptionResolvedRegionMap = ");
    expect(html).toContain('"primary": {"x": 11.0, "y": 62.0, "width": 37.0, "height": 16.0}');
    expect(html).toContain('"captionTypography": "cinematic"');
    expect(html).toContain('"captionWrap": "two-line"');
    expect(html).toContain("captionLayers.forEach");
    expect(html).toContain("placement-upper-right");
    expect(html).toContain("typography-cinematic");
    expect(html).toContain("wrap-two-line");
    expect(html).toContain("caption.style.left = `${x}%`");
    expect(html).toContain("media.style.objectPosition");
    expect(html).toContain("--motion-timing");
    expect(html).toContain("cubic-bezier(0.22, 0.61, 0.36, 1)");
    expect(html).toContain('"midX": 50');
    expect(html).toContain("var(--transition-duration, 900ms)");
    expect(html).toContain('"transitionOut": "fade"');
    expect(html).toContain("media/00001-slide-beta.png");
    expect(html).toContain("media/00002-slide-alpha.png");
    expect(html).toContain(".ken-burns .slide.active img");
    const revealBasenames = (await app.evaluate(() => ((globalThis as any).__photoSlideshowRevealPaths || []) as string[]))
      .map((item) => path.basename(item));
    expect(revealBasenames.some((name) => /^vintrace-slideshow-/.test(name))).toBe(true);

    await expect(slideshowProjects.getByRole("button", { name: "Export movie" })).toBeEnabled();
    await slideshowProjects.getByRole("button", { name: "Export movie" }).click();
    await expect(page.getByText(/Exported slideshow movie with 2 slides as MP4/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => {
      if (!existsSync(exportRoot)) return [] as string[];
      return readdirSync(exportRoot)
        .filter((name) => /^vintrace-slideshow-/.test(name))
        .map((name) => path.join(exportRoot, name))
        .filter((candidate) => {
          const candidateManifest = path.join(candidate, "manifest.json");
          if (!existsSync(candidateManifest)) return false;
          try {
            return JSON.parse(readFileSync(candidateManifest, "utf8")).outputMode === "video";
          } catch {
            return false;
          }
        })
        .sort();
    }, { timeout: 20_000 }).not.toEqual([]);
    const movieBundlePath = readdirSync(exportRoot)
      .filter((name) => /^vintrace-slideshow-/.test(name))
      .map((name) => path.join(exportRoot, name))
      .filter((candidate) => {
        const candidateManifest = path.join(candidate, "manifest.json");
        if (!existsSync(candidateManifest)) return false;
        try {
          return JSON.parse(readFileSync(candidateManifest, "utf8")).outputMode === "video";
        } catch {
          return false;
        }
      })
      .sort()
      .at(-1) || "";
    const movieManifest = JSON.parse(readFileSync(path.join(movieBundlePath, "manifest.json"), "utf8")) as {
      outputMode?: string;
      targetPath?: string;
      timelineDurationMs?: number;
      timelineItems?: Array<{ sourcePath?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; transitionDurationMs?: number }>;
      resolvedTimelineItems?: Array<{ sourcePath?: string; durationMs?: number; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; transitionEffect?: string; resolvedMotion?: string; transitionOut?: string; transitionDurationMs?: number; themeCue?: string }>;
      motionPresets?: string[];
      resolvedMotionPresets?: string[];
      transitionEffect?: string;
      transitionResolvedEffect?: string;
      transitionDurationMs?: number;
      themeTimelinePreset?: string;
      themeTemplateName?: string;
      themeTemplatePalette?: string;
      themeTemplateTypography?: string;
      themeTemplateBackdrop?: string;
      themeTemplateLayout?: string;
      themeTemplateBackdropIntensity?: number;
      themeTemplateStageWidth?: number;
      themeTemplateFrameStyle?: string;
      themeTemplateChromeDensity?: string;
      themeTemplateCaptionPreset?: string;
      themeTemplateRegionMap?: SlideshowTemplateRegionMap;
      templateCaptionResolvedRegionMap?: SlideshowTemplateRegionMap;
      videoRenderFormat?: string;
      videoRenderQuality?: string;
      audioPlacementStartMs?: number;
      audioPlacementEndMs?: number;
      chapters?: Array<{ label?: string; kind?: string; motion?: string; keyframes?: Record<string, number | string>; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; resolvedMotion?: string; startMs?: number; durationMs?: number; slideIndex?: number }>;
      videoRender?: { targetPath?: string; slideCount?: number; durationMs?: number; width?: number; height?: number; audioTrack?: string; audioGenerated?: boolean; audioImported?: boolean; audioPath?: string; audioVolume?: number; audioFadeMs?: number; audioStartMs?: number; audioEndMs?: number; audioPlacementStartMs?: number; audioPlacementEndMs?: number; transitionEffect?: string; transitionDurationMs?: number; transitionFfmpegEffect?: string; transitionTimeline?: Array<{ index?: number; transitionOut?: string; transitionDurationMs?: number; transitionFfmpegEffect?: string }>; transitionApplied?: boolean; motionPresets?: string[]; resolvedMotionPresets?: string[]; motionApplied?: boolean; themeTemplateFrameStyle?: string; templateFrameRendered?: boolean; templateFrameBorderPx?: number; templateFrameColor?: string; themeTemplateStageWidth?: number; templateStageFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateLayout?: string; templateLayoutChromeRendered?: boolean; templateLayoutChromeStyle?: string; templateLayoutMediaFrame?: { x?: number; y?: number; width?: number; height?: number }; templateLayoutBackgroundColor?: string; themeTemplateChromeDensity?: string; templateChromeDensity?: string; themeTemplateCaptionPreset?: string; templateCaptionPreset?: string; templateCaptionResolvedPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap; templateCaptionResolvedRegionMap?: SlideshowTemplateRegionMap; templateChromeRendered?: boolean; templateChromeBarPx?: number; templateChromeColor?: string; templateChromeOverlayRendered?: boolean; templateChromeTextRendered?: boolean; templateChromeOverlayCount?: number; templateChromeOverlayKinds?: string[]; templateChromeOverlayRows?: Array<{ index?: number; title?: string; sourceLabel?: string; chapterLabel?: string; counter?: string; themeTemplateStageWidth?: number; templateStageFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateLayout?: string; templateLayoutChromeRendered?: boolean; templateLayoutChromeStyle?: string; templateLayoutMediaFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateCaptionPreset?: string; templateCaptionResolvedPreset?: string; themeTemplateRegionMap?: SlideshowTemplateRegionMap; templateCaptionResolvedRegionMap?: SlideshowTemplateRegionMap; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string }>; templateCaptionRendered?: boolean; templateCaptionOverlayCount?: number; cropFocusRendered?: boolean };
      customAudio?: { included?: boolean; sourcePath?: string; targetPath?: string; relativePath?: string; trimStartMs?: number; trimEndMs?: number; placementStartMs?: number; placementEndMs?: number };
      titleCard?: { included?: boolean; title?: string; subtitle?: string; durationMs?: number; targetPath?: string; relativePath?: string; palette?: string; resolvedPalette?: string; layout?: string; fontScale?: string; showFooter?: boolean };
      counts?: Record<string, number>;
    };
    expect(movieManifest.outputMode).toBe("video");
    expect(movieManifest.videoRenderFormat).toBe("mp4");
    expect(movieManifest.videoRenderQuality).toBe("medium");
    expect(movieManifest.transitionEffect).toBe("dissolve");
    expect(movieManifest.transitionResolvedEffect).toBe("dissolve");
    expect(movieManifest.transitionDurationMs).toBe(900);
    expect(movieManifest.themeTimelinePreset).toBe("ken-burns-drift");
    expect(movieManifest.themeTemplateName).toBe("Weekend Matte");
    expect(movieManifest.themeTemplatePalette).toBe("paper");
    expect(movieManifest.themeTemplateTypography).toBe("editorial");
    expect(movieManifest.themeTemplateBackdrop).toBe("spotlight");
    expect(movieManifest.themeTemplateLayout).toBe("poster");
    expect(movieManifest.themeTemplateBackdropIntensity).toBe(70);
    expect(movieManifest.themeTemplateStageWidth).toBe(82);
    expect(movieManifest.themeTemplateFrameStyle).toBe("matte");
    expect(movieManifest.themeTemplateChromeDensity).toBe("compact");
    expect(movieManifest.themeTemplateCaptionPreset).toBe("split-story");
    expect(movieManifest.themeTemplateRegionMap).toEqual(expectedTemplateRegionMap);
    expect(movieManifest.templateCaptionResolvedRegionMap).toEqual(expectedTemplateResolvedRegionMap);
    expect(movieManifest.videoRender?.themeTemplateFrameStyle).toBe("matte");
    expect(movieManifest.videoRender?.templateFrameRendered).toBe(true);
    expect(movieManifest.videoRender?.templateFrameBorderPx || 0).toBeGreaterThan(0);
    expect(movieManifest.videoRender?.themeTemplateStageWidth).toBe(82);
    expect(movieManifest.videoRender?.templateStageFrame).toEqual({ x: 166, y: 0, width: 1504, height: 996 });
    expect(movieManifest.videoRender?.themeTemplateLayout).toBe("poster");
    expect(movieManifest.videoRender?.templateLayoutChromeRendered).toBe(true);
    expect(movieManifest.videoRender?.templateLayoutChromeStyle).toBe("poster-stage");
    expect(movieManifest.videoRender?.templateLayoutMediaFrame).toEqual({ x: 332, y: 78, width: 1172, height: 840 });
    expect(movieManifest.videoRender?.templateLayoutBackgroundColor).toBe("0x111018");
    expect(movieManifest.videoRender?.themeTemplateChromeDensity).toBe("compact");
    expect(movieManifest.videoRender?.templateChromeDensity).toBe("compact");
    expect(movieManifest.videoRender?.themeTemplateCaptionPreset).toBe("split-story");
    expect(movieManifest.videoRender?.templateCaptionPreset).toBe("split-story");
    expect(movieManifest.videoRender?.templateCaptionResolvedPreset).toBe("split-story");
    expect(movieManifest.videoRender?.themeTemplateRegionMap).toEqual(expectedTemplateRegionMap);
    expect(movieManifest.videoRender?.templateCaptionResolvedRegionMap).toEqual(expectedTemplateResolvedRegionMap);
    expect(movieManifest.videoRender?.templateChromeRendered).toBe(true);
    expect(movieManifest.videoRender?.templateChromeBarPx || 0).toBeGreaterThan(0);
    expect(movieManifest.videoRender?.templateChromeColor).toBe("black@0.48");
    expect(movieManifest.videoRender?.templateChromeOverlayRendered).toBe(true);
    expect(movieManifest.videoRender?.templateChromeTextRendered).toBe(true);
    expect(movieManifest.videoRender?.templateChromeOverlayCount).toBe(3);
    expect(movieManifest.videoRender?.templateChromeOverlayKinds).toEqual(["layout", "title", "chapter", "counter", "caption"]);
    expect(movieManifest.videoRender?.templateCaptionRendered).toBe(true);
    expect(movieManifest.videoRender?.templateCaptionOverlayCount).toBe(3);
    expect((movieManifest.videoRender as any)?.templateCaptionItemCount).toBe(4);
    expect(movieManifest.videoRender?.templateChromeOverlayRows?.map((row) => ({
      index: row.index,
      title: row.title,
      sourceLabel: row.sourceLabel,
      chapterLabel: row.chapterLabel,
      counter: row.counter,
      themeTemplateStageWidth: row.themeTemplateStageWidth,
      templateStageFrame: row.templateStageFrame,
      themeTemplateLayout: row.themeTemplateLayout,
      templateLayoutChromeRendered: row.templateLayoutChromeRendered,
      templateLayoutChromeStyle: row.templateLayoutChromeStyle,
      templateLayoutMediaFrame: row.templateLayoutMediaFrame,
      themeTemplateCaptionPreset: row.themeTemplateCaptionPreset,
      templateCaptionResolvedPreset: row.templateCaptionResolvedPreset,
      themeTemplateRegionMap: row.themeTemplateRegionMap,
      templateCaptionResolvedRegionMap: row.templateCaptionResolvedRegionMap,
      captionText: row.captionText,
      captionPlacement: row.captionPlacement,
      captionRegion: row.captionRegion,
      captionTypography: row.captionTypography,
      captionWrap: row.captionWrap,
      captions: (row as any).captions,
    }))).toEqual([
      { index: 0, title: "Weekend Highlights", sourceLabel: "Selection", chapterLabel: "Weekend Title Card", counter: "1 / 3", themeTemplateStageWidth: 82, templateStageFrame: { x: 166, y: 0, width: 1504, height: 996 }, themeTemplateLayout: "poster", templateLayoutChromeRendered: true, templateLayoutChromeStyle: "poster-stage", templateLayoutMediaFrame: { x: 332, y: 78, width: 1172, height: 840 }, themeTemplateCaptionPreset: "split-story", templateCaptionResolvedPreset: "split-story", themeTemplateRegionMap: expectedTemplateRegionMap, templateCaptionResolvedRegionMap: expectedTemplateResolvedRegionMap, captionText: undefined, captionPlacement: undefined, captionRegion: undefined, captionTypography: undefined, captionWrap: undefined, captions: undefined },
      { index: 1, title: "Weekend Highlights", sourceLabel: "Selection", chapterLabel: "Boardwalk at golden hour", counter: "2 / 3", themeTemplateStageWidth: 82, templateStageFrame: { x: 166, y: 0, width: 1504, height: 996 }, themeTemplateLayout: "poster", templateLayoutChromeRendered: true, templateLayoutChromeStyle: "poster-stage", templateLayoutMediaFrame: { x: 332, y: 78, width: 1172, height: 840 }, themeTemplateCaptionPreset: "split-story", templateCaptionResolvedPreset: "split-story", themeTemplateRegionMap: expectedTemplateRegionMap, templateCaptionResolvedRegionMap: expectedTemplateResolvedRegionMap, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions },
      { index: 2, title: "Weekend Highlights", sourceLabel: "Selection", chapterLabel: "Boardwalk at golden hour", counter: "3 / 3", themeTemplateStageWidth: 82, templateStageFrame: { x: 166, y: 0, width: 1504, height: 996 }, themeTemplateLayout: "poster", templateLayoutChromeRendered: true, templateLayoutChromeStyle: "poster-stage", templateLayoutMediaFrame: { x: 332, y: 78, width: 1172, height: 840 }, themeTemplateCaptionPreset: "split-story", templateCaptionResolvedPreset: "split-story", themeTemplateRegionMap: expectedTemplateRegionMap, templateCaptionResolvedRegionMap: expectedTemplateResolvedRegionMap, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions },
    ]);
    expect(movieManifest.videoRender?.cropFocusRendered).toBe(false);
    expect(movieManifest.timelineDurationMs).toBe(14500);
    expect(movieManifest.timelineItems?.map((item) => ({
      name: path.basename(item.sourcePath || ""),
      durationMs: item.durationMs,
      motion: item.motion,
      keyframes: item.keyframes || null,
      focalX: item.focalX,
      focalY: item.focalY,
      cropZoom: item.cropZoom,
      captionText: item.captionText,
      captionPlacement: item.captionPlacement,
      captionRegion: item.captionRegion,
      captionTypography: item.captionTypography,
      captionWrap: item.captionWrap,
      captions: (item as any).captions,
      transitionEffect: item.transitionEffect,
      transitionDurationMs: item.transitionDurationMs,
    }))).toEqual([
      { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
      { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", transitionDurationMs: 500 },
    ]);
    expect(movieManifest.motionPresets).toEqual(["still", "pan-left"]);
    expect(movieManifest.resolvedMotionPresets).toEqual(["still", "custom"]);
    expect(movieManifest.resolvedTimelineItems?.map((item) => ({
      name: path.basename(item.sourcePath || ""),
      durationMs: item.durationMs,
      motion: item.motion,
      keyframes: item.keyframes || null,
      focalX: item.focalX,
      focalY: item.focalY,
      cropZoom: item.cropZoom,
      captionText: item.captionText,
      captionPlacement: item.captionPlacement,
      captionRegion: item.captionRegion,
      captionTypography: item.captionTypography,
      captionWrap: item.captionWrap,
      captions: (item as any).captions,
      transitionEffect: item.transitionEffect,
      resolvedMotion: item.resolvedMotion,
      transitionOut: item.transitionOut,
      transitionDurationMs: item.transitionDurationMs,
      themeCue: item.themeCue,
    }))).toEqual([
      { name: "slide-beta.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "fade", transitionDurationMs: 500, themeCue: "Custom keyframes 1" },
      { name: "slide-alpha.png", durationMs: 6000, motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, transitionEffect: "fade", resolvedMotion: "custom", transitionOut: "cut", transitionDurationMs: 0, themeCue: "Custom keyframes 2" },
    ]);
    expect(movieManifest.videoRender?.slideCount).toBe(3);
    expect(movieManifest.videoRender?.durationMs).toBe(14500);
    expect(movieManifest.videoRender?.audioTrack).toBe("custom");
    expect(movieManifest.videoRender?.audioImported).toBe(true);
    expect(movieManifest.videoRender?.audioGenerated).toBe(false);
    expect(movieManifest.videoRender?.audioVolume).toBe(0.55);
    expect(movieManifest.videoRender?.audioFadeMs).toBe(750);
    expect(movieManifest.videoRender?.audioStartMs).toBe(500);
    expect(movieManifest.videoRender?.audioEndMs).toBe(1500);
    expect(movieManifest.audioPlacementStartMs).toBe(2500);
    expect(movieManifest.audioPlacementEndMs).toBe(14500);
    expect(movieManifest.videoRender?.audioPlacementStartMs).toBe(2500);
    expect(movieManifest.videoRender?.audioPlacementEndMs).toBe(14500);
    expect(movieManifest.videoRender?.transitionEffect).toBe("dissolve");
    expect(movieManifest.videoRender?.transitionDurationMs).toBe(900);
    expect(movieManifest.videoRender?.transitionFfmpegEffect).toBe("dissolve");
    expect(movieManifest.videoRender?.transitionTimeline).toEqual([
      { index: 0, transitionOut: "dissolve", transitionDurationMs: 900, transitionFfmpegEffect: "dissolve" },
      { index: 1, transitionOut: "fade", transitionDurationMs: 500, transitionFfmpegEffect: "fade" },
      { index: 2, transitionOut: "cut", transitionDurationMs: 0, transitionFfmpegEffect: "" },
    ]);
    expect(movieManifest.videoRender?.transitionApplied).toBe(true);
    expect(movieManifest.videoRender?.motionPresets).toEqual(["still", "pan-left"]);
    expect(movieManifest.videoRender?.resolvedMotionPresets).toEqual(["still", "custom"]);
    expect(movieManifest.videoRender?.motionApplied).toBe(true);
    expect(movieManifest.chapters?.map((chapter) => ({
      label: chapter.label,
      kind: chapter.kind,
      motion: chapter.motion,
      keyframes: chapter.keyframes || null,
      focalX: chapter.focalX,
      focalY: chapter.focalY,
      cropZoom: chapter.cropZoom,
      captionText: chapter.captionText,
      captionPlacement: chapter.captionPlacement,
      captionRegion: chapter.captionRegion,
      captionTypography: chapter.captionTypography,
      captionWrap: chapter.captionWrap,
      captions: (chapter as any).captions,
      resolvedMotion: chapter.resolvedMotion,
      startMs: chapter.startMs,
      durationMs: chapter.durationMs,
      slideIndex: chapter.slideIndex,
    }))).toEqual([
      { label: "Weekend Title Card", kind: "titleCard", motion: "still", keyframes: null, focalX: undefined, focalY: undefined, cropZoom: undefined, captionText: undefined, captionPlacement: undefined, captionRegion: undefined, captionTypography: undefined, captionWrap: undefined, captions: undefined, resolvedMotion: "still", startMs: 0, durationMs: 2500, slideIndex: 0 },
      { label: "Boardwalk at golden hour", kind: "image", motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, resolvedMotion: "custom", startMs: 2500, durationMs: 6000, slideIndex: 1 },
      { label: "Boardwalk at golden hour", kind: "image", motion: "pan-left", keyframes: expectedKeyframes, focalX: 35, focalY: 43, cropZoom: 1.4, captionText: "Boardwalk at golden hour", captionPlacement: "upper-right", captionRegion: { x: 58, y: 12, width: 34, height: 11 }, ...expectedCaptionFields, captions: expectedExtraCaptions, resolvedMotion: "custom", startMs: 8500, durationMs: 6000, slideIndex: 2 },
    ]);
    expect(movieManifest.customAudio?.included).toBe(true);
    expect(path.basename(movieManifest.customAudio?.sourcePath || "")).toBe("weekend-track.mp3");
    expect(movieManifest.customAudio?.trimStartMs).toBe(500);
    expect(movieManifest.customAudio?.trimEndMs).toBe(1500);
    expect(movieManifest.customAudio?.placementStartMs).toBe(2500);
    expect(movieManifest.customAudio?.placementEndMs).toBe(14500);
    expect(movieManifest.titleCard).toEqual(expect.objectContaining({
      included: true,
      title: "Weekend Title Card",
      subtitle: "Two-photo story",
      durationMs: 2500,
      palette: "forest",
      layout: "lower-third",
      fontScale: "compact",
      showFooter: false,
    }));
    expect(movieManifest.titleCard?.relativePath || "").toMatch(/title-card\.png$/);
    expect(existsSync(String(movieManifest.titleCard?.targetPath || ""))).toBe(true);
    expect(movieManifest.videoRender?.audioPath).toBe(movieManifest.customAudio?.targetPath);
    expect(movieManifest.counts).toEqual(expect.objectContaining({ selected: 2, included: 2 }));
    expect(movieManifest.targetPath || "").toMatch(/\.mp4$/);
    expect(movieManifest.videoRender?.targetPath).toBe(movieManifest.targetPath);
    expect(existsSync(String(movieManifest.targetPath || ""))).toBe(true);
    expect(readFileSync(String(movieManifest.targetPath || ""), "utf8")).toBe("fake browser transcoded video");

    await slideshowProjects.getByRole("button", { name: "Delete project" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { projects: Array<{ name: string }> } }>("photo_slideshow_projects", {});
      return result.value.projects.some((project) => project.name === "Weekend Selects");
    }), { timeout: 20_000 }).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos slideshow timeline drag moves selected slides as a block", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-slideshow-block-drag-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["timeline-alpha.png", "timeline-beta.png", "timeline-gamma.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Slideshow selected block E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /timeline-alpha\.png$/.test(item));
      const beta = paths.find((item) => /timeline-beta\.png$/.test(item));
      const gamma = paths.find((item) => /timeline-gamma\.png$/.test(item));
      if (!alpha || !beta || !gamma) throw new Error("Missing imported slideshow timeline fixtures");
      const project = await crossAge.invoke<{ value: { id: string } }>("save_photo_slideshow_project", {
        name: "Timeline Block Drag E2E",
        title: "Timeline Block Drag",
        sourcePaths: [alpha, beta, gamma],
        theme: "classic"
      });
      return { alpha, beta, gamma, projectId: project.value.id };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "timeline-alpha.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "timeline-beta.png")).toBeVisible();
    await expect(tileByFilename(page, "timeline-gamma.png")).toBeVisible();

    await tileByFilename(page, "timeline-alpha.png").locator(".photo-select-box").click();
    await tileByFilename(page, "timeline-beta.png").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    const slideshowProjects = page.getByLabel("Slideshow projects");
    await slideshowProjects.locator("label").filter({ has: page.locator("span", { hasText: /^Slideshow project$/ }) }).locator("select").selectOption(seeded.projectId);
    const slideshowTimeline = slideshowProjects.getByRole("list", { name: "Slideshow timeline" });
    await expect(slideshowTimeline.getByRole("listitem").nth(0)).toContainText("timeline-alpha.png");
    await expect(slideshowTimeline.getByRole("listitem").nth(1)).toContainText("timeline-beta.png");
    await expect(slideshowTimeline.getByRole("listitem").nth(2)).toContainText("timeline-gamma.png");

    await dragSlideshowTimelineCard(page, "timeline-alpha.png", "timeline-gamma.png", "after");
    await expect(slideshowTimeline.getByRole("listitem").nth(0)).toContainText("timeline-gamma.png");
    await expect(slideshowTimeline.getByRole("listitem").nth(1)).toContainText("timeline-alpha.png");
    await expect(slideshowTimeline.getByRole("listitem").nth(2)).toContainText("timeline-beta.png");

    await tileByFilename(page, "timeline-alpha.png").getByRole("checkbox").uncheck();
    await tileByFilename(page, "timeline-beta.png").getByRole("checkbox").uncheck();
    await expect(page.locator(".photo-bulk-bar")).toContainText("0 selected");
    await slideshowProjects.getByRole("button", { name: "Save slideshow" }).click();

    await expect.poll(async () => page.evaluate(async ({ projectId }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value: { projects: Array<{ id: string; sourcePaths: string[] }> } }>("photo_slideshow_projects", {});
      const project = result.value.projects.find((item) => item.id === projectId);
      return project?.sourcePaths.map((item) => item.split(/[\\/]/).pop()) || [];
    }, { projectId: seeded.projectId }), { timeout: 20_000 }).toEqual(["timeline-gamma.png", "timeline-alpha.png", "timeline-beta.png"]);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function exercisePhotosRealSlideshowMovieExport(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const ffmpegProbe = writeRealVideoFixture(path.join(temp, "ffmpeg-probe"), "probe.mp4");
  test.skip(!ffmpegProbe.ok || !ffmpegProbe.ffmpegPath, `Real FFmpeg unavailable for slideshow movie render: ${ffmpegProbe.detail || "missing ffmpeg"}`);
  writePhotoFixtureSet(media, ["real-alpha.png", "real-beta.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: ffmpegProbe.ffmpegPath || "",
    CROSSAGE_FFMPEG_PATH: ffmpegProbe.ffmpegPath || ""
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Real FFmpeg slideshow E2E media"
      });
      const paths = imported.value.importedPaths || [];
      if (!paths.some((item) => /real-alpha\.png$/.test(item)) || !paths.some((item) => /real-beta\.png$/.test(item))) {
        throw new Error("Missing imported real FFmpeg slideshow fixtures");
      }
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await expect(tileByFilename(page, "real-alpha.png")).toBeVisible({ timeout: 20_000 });
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
      await expect(tileByFilename(page, "real-alpha.png")).toBeVisible({ timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("96");
    await page.getByLabel("Video quality").selectOption("small");
    await page.getByLabel("Video format").selectOption("mp4");

    await tileByFilename(page, "real-alpha.png").locator(".photo-select-box").click();
    await tileByFilename(page, "real-beta.png").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    const slideshowProjects = page.getByLabel("Slideshow projects");
    await slideshowProjects.getByLabel("Slideshow project name").fill("Real FFmpeg Selects");
    await slideshowProjects.getByLabel("Slideshow title").fill("Real FFmpeg Render");
    await slideshowProjects.getByLabel("Selected slide duration ms").fill("1000");
    await slideshowProjects.getByRole("button", { name: "Apply selected" }).click();
    await slideshowProjects.getByLabel("Selected slide motion").selectOption("pan-left");
    await slideshowProjects.getByRole("button", { name: "Apply motion" }).click();
    await slideshowProjects.getByLabel("Path start X").fill("20");
    await slideshowProjects.getByLabel("Path start Y").fill("45");
    await slideshowProjects.getByLabel("Path 25% X").fill("35");
    await slideshowProjects.getByLabel("Path 25% Y").fill("40");
    await slideshowProjects.getByLabel("Path mid X").fill("50");
    await slideshowProjects.getByLabel("Path mid Y").fill("35");
    await slideshowProjects.getByLabel("Path 75% X").fill("65");
    await slideshowProjects.getByLabel("Path 75% Y").fill("45");
    await slideshowProjects.getByLabel("Path end X").fill("80");
    await slideshowProjects.getByLabel("Path end Y").fill("55");
    await slideshowProjects.getByLabel("Start zoom").fill("1.01");
    await slideshowProjects.getByLabel("25% zoom").fill("1.04");
    await slideshowProjects.getByLabel("Mid zoom").fill("1.08");
    await slideshowProjects.getByLabel("75% zoom").fill("1.11");
    await slideshowProjects.getByLabel("End zoom").fill("1.14");
    await slideshowProjects.getByRole("button", { name: "Apply keyframes" }).click();
    await slideshowProjects.getByLabel("Theme").selectOption("classic");
    await slideshowProjects.getByLabel("Transition", { exact: true }).selectOption("cut");
    await slideshowProjects.getByLabel("Music").selectOption("none");
    await slideshowProjects.getByRole("button", { name: "Save slideshow" }).click();
    await expect(slideshowProjects.getByRole("button", { name: "Export movie" })).toBeEnabled({ timeout: 20_000 });
    await slideshowProjects.getByRole("button", { name: "Export movie" }).click();
    await expect(page.getByText(/Exported slideshow movie with 2 slides as MP4/)).toBeVisible({ timeout: 120_000 });

    const exportRoot = path.join(workspace, "exports");
    const movieBundlePath = readdirSync(exportRoot)
      .filter((name) => /^vintrace-slideshow-/.test(name))
      .map((name) => path.join(exportRoot, name))
      .filter((candidate) => {
        const candidateManifest = path.join(candidate, "manifest.json");
        if (!existsSync(candidateManifest)) return false;
        try {
          return JSON.parse(readFileSync(candidateManifest, "utf8")).outputMode === "video";
        } catch {
          return false;
        }
      })
      .sort()
      .at(-1) || "";
    expect(movieBundlePath).toBeTruthy();
    const movieManifest = JSON.parse(readFileSync(path.join(movieBundlePath, "manifest.json"), "utf8")) as {
      outputMode?: string;
      targetPath?: string;
      renderMaxDimension?: number;
      timelineDurationMs?: number;
      motionPresets?: string[];
      resolvedMotionPresets?: string[];
      videoRender?: { targetPath?: string; slideCount?: number; durationMs?: number; width?: number; height?: number; audioTrack?: string; motionPresets?: string[]; resolvedMotionPresets?: string[]; motionApplied?: boolean; transitionApplied?: boolean };
    };
    expect(movieManifest.outputMode).toBe("video");
    expect(movieManifest.renderMaxDimension).toBe(96);
    expect(movieManifest.timelineDurationMs).toBe(2000);
    expect(movieManifest.motionPresets).toEqual(["pan-left"]);
    expect(movieManifest.resolvedMotionPresets).toEqual(["custom"]);
    expect(movieManifest.videoRender).toEqual(expect.objectContaining({
      targetPath: movieManifest.targetPath,
      slideCount: 2,
      durationMs: 2000,
      width: 96,
      height: 54,
      audioTrack: "none",
      motionPresets: ["pan-left"],
      resolvedMotionPresets: ["custom"],
      motionApplied: true,
      transitionApplied: false,
    }));
    expect(movieManifest.targetPath || "").toMatch(/\.mp4$/);
    expect(existsSync(String(movieManifest.targetPath || ""))).toBe(true);
    const renderedBytes = readFileSync(String(movieManifest.targetPath || ""));
    expect(renderedBytes.length).toBeGreaterThan(1000);
    expect(renderedBytes.includes(Buffer.from("ftyp"))).toBe(true);
    expect(renderedBytes.toString("utf8", 0, Math.min(64, renderedBytes.length))).not.toContain("fake browser transcoded video");
    const probe = spawnSync(ffmpegProbe.ffmpegPath || "", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      String(movieManifest.targetPath || ""),
      "-f",
      "null",
      "-"
    ], { encoding: "utf8" });
    expect(probe.status, probe.stderr || probe.stdout).toBe(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos slideshow projects render a real FFmpeg movie when available", async () => {
  test.setTimeout(120_000);
  await exercisePhotosRealSlideshowMovieExport(
    { width: 900, height: 620 },
    "vintrace-photos-slideshow-real-ffmpeg-"
  );
});

test("Photos slideshow projects render a compact real FFmpeg movie when available", async () => {
  test.setTimeout(120_000);
  await exercisePhotosRealSlideshowMovieExport(
    { width: 390, height: 740 },
    "vintrace-photos-slideshow-real-ffmpeg-compact-"
  );
});

async function exercisePhotosRealMemoryMovieExport(
  viewportSize: { width: number; height: number },
  tempPrefix: string
) {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), tempPrefix));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const ffmpegProbe = writeRealVideoFixture(path.join(temp, "ffmpeg-probe"), "probe.mp4");
  test.skip(!ffmpegProbe.ok || !ffmpegProbe.ffmpegPath, `Real FFmpeg unavailable for Memory movie render: ${ffmpegProbe.detail || "missing ffmpeg"}`);
  writePhotoFixtureSet(media, ["memory-real-alpha.png", "memory-real-beta.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot,
    VINTRACE_FFMPEG_PATH: ffmpegProbe.ffmpegPath || "",
    CROSSAGE_FFMPEG_PATH: ffmpegProbe.ffmpegPath || ""
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const navigationViewport = viewportSize.width < 760 ? { width: 900, height: 620 } : viewportSize;
  await page.setViewportSize(navigationViewport);

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Real FFmpeg Memory movie E2E media"
      });
      const paths = imported.value.importedPaths || [];
      const alpha = paths.find((item) => /memory-real-alpha\.png$/.test(item));
      const beta = paths.find((item) => /memory-real-beta\.png$/.test(item));
      if (!alpha || !beta) throw new Error("Missing imported real FFmpeg Memory fixtures");
      const saved = await crossAge.invoke<{ value: { memoryId: string } }>("save_photo_user_memory", {
        name: "Real FFmpeg Memory",
        subtitle: "Real renderer",
        sourcePaths: [alpha, beta],
        coverSourcePath: alpha
      });
      return { alpha, beta, memoryId: saved.value.memoryId };
    }, { mediaFolder: media });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await expect(rail.getByText("Real FFmpeg Memory", { exact: true })).toBeVisible({ timeout: 20_000 });
    await rail.getByText("Real FFmpeg Memory", { exact: true }).click();
    await expect(tileByFilename(page, "memory-real-alpha.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "memory-real-beta.png")).toBeVisible();
    if (navigationViewport.width !== viewportSize.width || navigationViewport.height !== viewportSize.height) {
      await page.setViewportSize(viewportSize);
      await expect(tileByFilename(page, "memory-real-alpha.png")).toBeVisible({ timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByLabel("Export kind").selectOption("rendered");
    await page.getByLabel("Render size").selectOption("custom");
    await page.getByLabel("Render max edge").fill("96");
    await page.getByLabel("Video quality").selectOption("small");
    await page.getByLabel("Video format").selectOption("mp4");

    const memorySlideshowProjects = page.getByLabel("Slideshow projects");
    await memorySlideshowProjects.getByLabel("Title-card title").fill("Real Memory Card");
    await memorySlideshowProjects.getByLabel("Title-card subtitle").fill("Real FFmpeg proof");
    await memorySlideshowProjects.getByLabel("Title-card duration ms").fill("1500");
    await memorySlideshowProjects.getByLabel("Transition", { exact: true }).selectOption("cut");

    const memoryActions = page.getByLabel("Memory actions");
    await expect(memoryActions.getByRole("button", { name: "Export memory movie" })).toBeEnabled();
    await memoryActions.getByRole("button", { name: "Export memory movie" }).click();
    await expect(page.getByText(/Exported Memory movie with 2 slides as MP4/)).toBeVisible({ timeout: 120_000 });

    const exportRoot = path.join(workspace, "exports");
    const movieBundlePath = readdirSync(exportRoot)
      .filter((name) => /^vintrace-memory-movie-/.test(name))
      .map((name) => path.join(exportRoot, name))
      .filter((candidate) => {
        const candidateManifest = path.join(candidate, "manifest.json");
        if (!existsSync(candidateManifest)) return false;
        try {
          return JSON.parse(readFileSync(candidateManifest, "utf8")).outputMode === "video";
        } catch {
          return false;
        }
      })
      .sort()
      .at(-1) || "";
    expect(movieBundlePath).toBeTruthy();
    const movieManifest = JSON.parse(readFileSync(path.join(movieBundlePath, "manifest.json"), "utf8")) as {
      action?: string;
      exportKind?: string;
      memoryId?: string;
      outputMode?: string;
      targetPath?: string;
      renderMaxDimension?: number;
      timelineDurationMs?: number;
      themeTimelinePreset?: string;
      motionPresets?: string[];
      resolvedMotionPresets?: string[];
      titleCard?: { included?: boolean; title?: string; durationMs?: number };
      videoRender?: { targetPath?: string; slideCount?: number; durationMs?: number; width?: number; height?: number; audioTrack?: string; audioGenerated?: boolean; motionPresets?: string[]; resolvedMotionPresets?: string[]; motionApplied?: boolean; titleCardIncluded?: boolean; transitionApplied?: boolean; templateChromeRendered?: boolean; templateChromeBarPx?: number; templateChromeOverlayRendered?: boolean; templateChromeOverlayCount?: number };
    };
    expect(movieManifest).toEqual(expect.objectContaining({
      action: "export_photo_memory_movie",
      exportKind: "memoryMovie",
      memoryId: seeded.memoryId,
      outputMode: "video",
      renderMaxDimension: 96,
      themeTimelinePreset: "ken-burns-drift",
      timelineDurationMs: 10_500,
      motionPresets: ["still", "auto"],
      resolvedMotionPresets: ["still", "slow-zoom", "pan-left"],
    }));
    expect(movieManifest.titleCard).toEqual(expect.objectContaining({
      included: true,
      title: "Real Memory Card",
      durationMs: 1500,
    }));
    expect(movieManifest.videoRender).toEqual(expect.objectContaining({
      targetPath: movieManifest.targetPath,
      slideCount: 3,
      durationMs: 10_500,
      width: 96,
      height: 54,
      audioTrack: "calm",
      audioGenerated: true,
      motionPresets: ["still", "auto"],
      resolvedMotionPresets: ["still", "slow-zoom", "pan-left"],
      motionApplied: true,
      titleCardIncluded: true,
      transitionApplied: false,
      templateChromeRendered: false,
      templateChromeBarPx: 0,
      templateChromeOverlayRendered: false,
      templateChromeOverlayCount: 0,
    }));
    expect(movieManifest.targetPath || "").toMatch(/\.mp4$/);
    expect(existsSync(String(movieManifest.targetPath || ""))).toBe(true);
    const renderedBytes = readFileSync(String(movieManifest.targetPath || ""));
    expect(renderedBytes.length).toBeGreaterThan(1000);
    expect(renderedBytes.includes(Buffer.from("ftyp"))).toBe(true);
    expect(renderedBytes.toString("utf8", 0, Math.min(64, renderedBytes.length))).not.toContain("fake browser transcoded video");
    const probe = spawnSync(ffmpegProbe.ffmpegPath || "", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      String(movieManifest.targetPath || ""),
      "-f",
      "null",
      "-"
    ], { encoding: "utf8" });
    expect(probe.status, probe.stderr || probe.stdout).toBe(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
}

test("Photos Memory movies render a real FFmpeg movie when available", async () => {
  test.setTimeout(120_000);
  await exercisePhotosRealMemoryMovieExport(
    { width: 900, height: 620 },
    "vintrace-photos-memory-real-ffmpeg-"
  );
});

test("Photos Memory movies render a compact real FFmpeg movie when available", async () => {
  test.setTimeout(120_000);
  await exercisePhotosRealMemoryMovieExport(
    { width: 390, height: 740 },
    "vintrace-photos-memory-real-ffmpeg-compact-"
  );
});

test("Photos external import handoff preserves app attribution after confirm", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-external-import-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "external-source");
  writePhotoFixtureSet(media, ["external-handoff.png"]);
  const sourcePath = path.join(media, "external-handoff.png");
  const sourceDetail = "Sender: taylor@example.test | Source URL: mail-message-42 | App: Spark Mail | Bundle: com.readdle.smartemail-Mac";
  const importUrl = [
    `vintrace://photos-import?path=${encodeURIComponent(sourcePath)}`,
    `source=${encodeURIComponent("mail")}`,
    `appName=${encodeURIComponent("Spark Mail")}`,
    `sender=${encodeURIComponent("taylor@example.test")}`,
    `sourceUrl=${encodeURIComponent("mail-message-42")}`,
    `bundleId=${encodeURIComponent("com.readdle.smartemail-Mac")}`,
  ].join("&");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await expect(page.locator(".nav-list").getByRole("button", { name: "Library" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => Number((await photoFolderCounts(page)).all || 0)).toBe(0);

    await app.evaluate(({ app: electronApp }, url) => {
      electronApp.emit("open-url", { preventDefault() {} } as any, url);
    }, importUrl);

    const externalConfirm = page.getByRole("dialog").filter({ hasText: "Review these photos for import from an external link" });
    await expect(externalConfirm).toBeVisible({ timeout: 20_000 });
    await externalConfirm.getByRole("button", { name: "Continue" }).click();

    const review = page.getByRole("status", { name: "Import review" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText("external-handoff.png");
    await expect(review).toContainText("Spark Mail · Mail · Reference originals");
    await expect(review).toContainText(sourceDetail);
    await expect(page.getByLabel("Import source detail")).toHaveValue(sourceDetail);
    await expect.poll(async () => Number((await photoFolderCounts(page)).all || 0)).toBe(0);
    await review.getByRole("button", { name: "Confirm import" }).click();
    await expect(review).toHaveCount(0);
    await expect.poll(async () => Number((await photoFolderCounts(page)).all || 0), { timeout: 30_000 }).toBe(1);
    await expect(page.getByLabel("Import details")).toBeVisible({ timeout: 20_000 });

    await page.locator(".photos-rail").getByRole("button", { name: /^Imports\b/ }).click();
    const importHistory = page.getByRole("region", { name: "Import history" });
    await expect(importHistory).toBeVisible({ timeout: 20_000 });
    await expect(importHistory).toContainText("Spark Mail");
    await expect(importHistory).toContainText("Mail · Reference originals · Completed");
    await expect(importHistory).toContainText(sourceDetail);
    await importHistory.getByLabel("Search import history").fill("Spark");
    await importHistory.getByLabel("Import history source").selectOption("mail");
    const sparkHistoryRow = importHistory.locator(".photo-import-history-main").filter({ hasText: "Spark Mail" });
    await expect(sparkHistoryRow).toBeVisible();

    await page.locator(".photos-rail").getByRole("button", { name: /^Last Import\b/ }).click();
    const importDetails = page.getByLabel("Import details");
    await expect(importDetails).toBeVisible({ timeout: 20_000 });
    await expect(importDetails).toContainText("Spark Mail");
    await expect(importDetails).toContainText("Mail");
    await expect(importDetails).toContainText("Reference originals");
    await expect(importDetails).toContainText(sourceDetail);
    await importDetails.getByRole("button", { name: /Edit import source/ }).click();
    await importDetails.getByLabel("Edit import source kind").selectOption("safari");
    await importDetails.getByLabel("Edit import source label").fill("Safari Research");
    await importDetails.getByLabel("Edit import source detail").fill("Source URL: https://example.test/story");
    await importDetails.getByRole("button", { name: "Save source" }).click();
    await expect(importDetails).toContainText("Updated import source", { timeout: 20_000 });
    await expect(importDetails).toContainText("Safari Research");
    await expect(importDetails).toContainText("Safari");
    await expect(importDetails).toContainText("Source URL: https://example.test/story");
    await importDetails.getByRole("button", { name: "Open import" }).click();
    await expect(tileByFilename(page, "external-handoff.png")).toBeVisible({ timeout: 20_000 });

    await tileByFilename(page, "external-handoff.png").getByRole("button", { name: /Open photo/ }).click();
    const lightbox = page.getByRole("dialog", { name: /Photo preview/ });
    await expect(lightbox).toBeVisible();
    const info = lightbox.locator(".photos-info-inspector");
    await expect(info).toContainText("Saved from");
    await expect(info).toContainText("Safari Research");
    await expect(info).toContainText("Source URL: https://example.test/story");
    await lightbox.getByRole("button", { name: "Close" }).click();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos import review can create a manual album destination", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-import-review-album-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "Library", "Containers", "com.apple.mail", "Data", "Library", "Mail Downloads", "message-1");
  writePhotoFixtureSet(media, ["review-import.png"]);
  const reviewPhoto = path.join(media, "review-import.png");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await app.evaluate(({ ipcMain }, sourcePath) => {
      ipcMain.removeHandler("dialog:choose-images");
      ipcMain.handle("dialog:choose-images", async () => [{ path: sourcePath }]);
      ipcMain.removeHandler("media:prepare-paths");
      ipcMain.handle("media:prepare-paths", async (_event, payload = {}) => {
        const paths = Array.isArray((payload as { paths?: unknown[] }).paths) ? (payload as { paths: unknown[] }).paths : [];
        return paths.map((item) => ({ path: String(item || ""), isDir: false }));
      });
    }, reviewPhoto);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await page.locator(".photo-album-toolbar").getByRole("button", { name: "Import files" }).click();
    const review = page.getByRole("status", { name: "Import review" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText("review-import.png");
    await expect(review).toContainText("Mail · Reference originals");
    await expect(page.getByLabel("Import source detail")).toHaveValue(/Mail Downloads/);
    await page.getByLabel("Import source detail").fill("Mail from Taylor");
    await expect(review).toContainText("Mail from Taylor");
    await review.getByLabel("Import to album").selectOption("__new_import_album__");
    await review.getByLabel("New import album name").fill("Review Import Album E2E");
    await review.getByRole("button", { name: "Confirm import" }).click();

    await expect.poll(async () => photoAlbumByName(page, "Review Import Album E2E"), { timeout: 30_000 }).toEqual(expect.objectContaining({
      count: 1
    }));
    const album = await photoAlbumByName(page, "Review Import Album E2E");
    if (!album?.albumId) throw new Error("Import review album was not created");
    await expect(page.locator(".photos-rail").getByText("Review Import Album E2E", { exact: true })).toBeVisible();
    await expect(tileByFilename(page, "review-import.png")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => manualAlbumFilenames(page, album.albumId || "", 10)).toEqual(["review-import.png"]);
    await expect(review).toHaveCount(0);

    await page.locator(".photos-rail").getByRole("button", { name: /^Imports\b/ }).click();
    const importHistory = page.getByRole("region", { name: "Import history" });
    await expect(importHistory).toBeVisible({ timeout: 20_000 });
    await expect(importHistory).toContainText("Mail");
    await expect(importHistory).toContainText("Mail from Taylor");
    await expect(importHistory).toContainText("Reference originals");
    await expect(importHistory).toContainText("Completed");
    await importHistory.getByLabel("Search import history").fill("Taylor");
    await importHistory.getByLabel("Import history status").selectOption("completed");
    await importHistory.getByLabel("Import history storage").selectOption("referenced");
    await importHistory.getByLabel("Import history source").selectOption("mail");
    const mailHistoryRow = importHistory.locator(".photo-import-history-main").filter({ hasText: "Mail" });
    await expect(mailHistoryRow).toBeVisible();
    await importHistory.getByLabel("Search import history").fill("no matching import");
    await expect(importHistory).toContainText("No matching imports");
    await importHistory.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(mailHistoryRow).toBeVisible();
    await importHistory.getByLabel("Search import history").fill("Taylor");
    await importHistory.getByRole("button", { name: "Archive matches" }).click();
    await expect(importHistory).toContainText("Archived imports", { timeout: 20_000 });
    await expect(importHistory).toContainText("No matching imports");
    await importHistory.getByLabel("Show archived").check();
    await expect(importHistory).toContainText("Archived");
    await importHistory.getByRole("button", { name: "Restore" }).click();
    await expect(importHistory).toContainText("Restored imports", { timeout: 20_000 });
    await expect(mailHistoryRow).toBeVisible();
    await importHistory.getByLabel("Show archived").uncheck();
    await importHistory.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(mailHistoryRow).toBeVisible();
    await mailHistoryRow.click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Import:", { timeout: 20_000 });
    await expect(tileByFilename(page, "review-import.png")).toBeVisible({ timeout: 20_000 });

    await page.locator(".photos-rail").getByRole("button", { name: /^Last Import\b/ }).click();
    const importDetails = page.getByLabel("Import details");
    await expect(importDetails).toBeVisible({ timeout: 20_000 });
    await expect(importDetails).toContainText("Mail");
    await expect(importDetails).toContainText("Reference originals");
    await expect(importDetails).toContainText("Completed");
    await expect(importDetails).toContainText("Mail from Taylor");
    await expect(importDetails).toContainText("1");
    await importDetails.getByRole("button", { name: "Open import" }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Import:", { timeout: 20_000 });
    await expect(tileByFilename(page, "review-import.png")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos import review surfaces per-file import issues", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-import-issues-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["issue-valid.png"]);
  const validPhoto = path.join(media, "issue-valid.png");
  const unsupportedFile = path.join(media, "issue-notes.txt");
  writeFileSync(unsupportedFile, "not a photo", "utf8");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await app.evaluate(({ ipcMain }, payload) => {
      ipcMain.removeHandler("dialog:choose-images");
      ipcMain.handle("dialog:choose-images", async () => payload.paths.map((sourcePath) => ({ path: sourcePath })));
      ipcMain.removeHandler("media:prepare-paths");
      ipcMain.handle("media:prepare-paths", async (_event, request = {}) => {
        const paths = Array.isArray((request as { paths?: unknown[] }).paths) ? (request as { paths: unknown[] }).paths : [];
        return paths.map((item) => ({ path: String(item || ""), isDir: false }));
      });
    }, { paths: [validPhoto, unsupportedFile] });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await page.locator(".photo-album-toolbar").getByRole("button", { name: "Import files" }).click();
    const review = page.getByRole("status", { name: "Import review" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText("issue-valid.png");
    await expect(review).toContainText("issue-notes.txt");
    await review.getByRole("button", { name: "Confirm import" }).click();

    await expect(review).toHaveCount(0, { timeout: 20_000 });
    await expect(tileByFilename(page, "issue-valid.png")).toBeVisible({ timeout: 20_000 });
    const importIssues = page.getByRole("alert").filter({ hasText: "Import issues" });
    await expect(importIssues).toBeVisible({ timeout: 20_000 });
    await expect(importIssues).toContainText("1 item failed");
    await expect(importIssues).toContainText("issue-notes.txt");
    await expect(importIssues).toContainText("Unsupported");
    await page.locator(".photos-rail").getByRole("button", { name: /^Recovered\b/ }).click();
    const recoveredIssues = page.getByLabel("Recovered import issues");
    await expect(recoveredIssues).toBeVisible({ timeout: 20_000 });
    await expect(recoveredIssues).toContainText("issue-notes.txt");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos gallery drop stages dropped files for import review", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-drop-import-review-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["drop-import.png"]);
  const droppedPhoto = path.join(media, "drop-import.png");
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    CROSSAGE_E2E_FILE_DROP_PATH_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();

    await page.locator(".photos-gallery").evaluate((element, sourcePath) => {
      const file = new File(["vintrace dropped fixture"], "drop-import.png", { type: "image/png" });
      Object.defineProperty(file, "path", { configurable: true, value: sourcePath });
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        configurable: true,
        value: { files: [file], types: ["Files"], dropEffect: "copy" },
      });
      element.dispatchEvent(event);
    }, droppedPhoto);

    const review = page.getByRole("status", { name: "Import review" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review).toContainText("Dropped files");
    await expect(review).toContainText("drop-import.png");
    await review.getByRole("button", { name: "Confirm import" }).click();
    await expect(review).toHaveCount(0, { timeout: 20_000 });
    await expect(tileByFilename(page, "drop-import.png")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual albums persist tile drag/drop custom order", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-album-items-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const expectedStartOrder = ["alpha.png", "beta.png", "delta.png", "gamma.png"];
  const expectedDraggedOrder = ["alpha.png", "delta.png", "beta.png", "gamma.png"];
  const expectedSelectedBlockDraggedOrder = ["alpha.png", "gamma.png", "delta.png", "beta.png"];
  writePhotoFixtureSet(media, expectedStartOrder);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Manual album E2E media"
      });
      const orderedPaths = [...(imported.value.importedPaths || [])].sort((left, right) => left.localeCompare(right));
      const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: "Tile Drag Album E2E",
        albumKind: "manual"
      });
      await crossAge.invoke<{ value: unknown }>("add_photo_album_items", {
        albumId: album.value.albumId,
        sourcePaths: orderedPaths
      });
      return { albumId: album.value.albumId, orderedPaths };
    }, { mediaFolder: media });

    expect(await manualAlbumFilenames(page, seeded.albumId)).toEqual(expectedStartOrder);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Tile Drag Album E2E", { exact: true }).click();
    await expect(page.getByLabel("Sort photos")).toHaveValue("manual");
    await expect(tileByFilename(page, "alpha.png")).toBeVisible();
    await expect(tileByFilename(page, "delta.png")).toBeVisible();

    await dragPhotoTile(page, "delta.png", "beta.png", "before");

    await expect.poll(async () => manualAlbumFilenames(page, seeded.albumId)).toEqual(expectedDraggedOrder);
    await expect.poll(async () => page.locator(".photo-tile-wrap").evaluateAll((tiles) => (
      tiles
        .map((tile) => tile.querySelector<HTMLButtonElement>(".photo-tile")?.getAttribute("title") || "")
        .filter(Boolean)
    ))).toEqual(expectedDraggedOrder);

    await tileByFilename(page, "delta.png").getByRole("checkbox").check();
    await tileByFilename(page, "beta.png").getByRole("checkbox").check();
    await expect(tileByFilename(page, "delta.png").getByRole("checkbox")).toBeChecked();
    await expect(tileByFilename(page, "beta.png").getByRole("checkbox")).toBeChecked();
    await dragPhotoTile(page, "delta.png", "gamma.png", "after");

    await expect.poll(async () => manualAlbumFilenames(page, seeded.albumId)).toEqual(expectedSelectedBlockDraggedOrder);
    await expect.poll(async () => page.locator(".photo-tile-wrap").evaluateAll((tiles) => (
      tiles
        .map((tile) => tile.querySelector<HTMLButtonElement>(".photo-tile")?.getAttribute("title") || "")
        .filter(Boolean)
    ))).toEqual(expectedSelectedBlockDraggedOrder);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual albums save current filename sort as custom order", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-save-sort-album-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const filenames = ["sort-alpha.png", "sort-beta.png", "sort-gamma.png"];
  const expectedManualStart = ["sort-gamma.png", "sort-alpha.png", "sort-beta.png"];
  const expectedFilenameOrder = ["sort-alpha.png", "sort-beta.png", "sort-gamma.png"];
  writePhotoFixtureSet(media, filenames);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder, startOrder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Save sort manual album E2E media"
      });
      const byName = Object.fromEntries((imported.value.importedPaths || []).map((sourcePath) => [
        String(sourcePath).split(/[\\/]/).filter(Boolean).pop() || "",
        sourcePath,
      ]));
      const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: "Save Sort Album E2E",
        albumKind: "manual"
      });
      await crossAge.invoke<{ value: unknown }>("add_photo_album_items", {
        albumId: album.value.albumId,
        sourcePaths: startOrder.map((name) => byName[name]).filter(Boolean)
      });
      return { albumId: album.value.albumId };
    }, { mediaFolder: media, startOrder: expectedManualStart });

    expect(await manualAlbumFilenames(page, seeded.albumId, 10)).toEqual(expectedManualStart);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Save Sort Album E2E", { exact: true }).click();
    const sortSelect = page.getByLabel("Sort photos");
    await expect(sortSelect).toHaveValue("manual");
    await expect.poll(async () => visiblePhotoTileFilenames(page)).toEqual(expectedManualStart);

    await sortSelect.selectOption("filename");
    await expect(sortSelect).toHaveValue("filename");
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toEqual(expectedFilenameOrder);

    const saveSort = page.getByRole("button", { name: "Save sort as custom" });
    await expect(saveSort).toBeEnabled();
    await saveSort.click();

    await expect(sortSelect).toHaveValue("manual", { timeout: 20_000 });
    await expect.poll(async () => manualAlbumFilenames(page, seeded.albumId, 10), { timeout: 20_000 }).toEqual(expectedFilenameOrder);
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toEqual(expectedFilenameOrder);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual albums move selected items to a typed custom position", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-position-album-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const filenames = Array.from({ length: 7 }, (_, index) => `position-${String(index).padStart(3, "0")}.png`);
  const expectedMovedOrder = [
    "position-000.png",
    "position-003.png",
    "position-005.png",
    "position-001.png",
    "position-002.png",
    "position-004.png",
    "position-006.png",
  ];
  writePhotoFixtureSet(media, filenames);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Position manual album E2E media"
      });
      const orderedPaths = [...(imported.value.importedPaths || [])].sort((left, right) => left.localeCompare(right));
      const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: "Position Album E2E",
        albumKind: "manual"
      });
      await crossAge.invoke<{ value: unknown }>("add_photo_album_items", {
        albumId: album.value.albumId,
        sourcePaths: orderedPaths
      });
      return { albumId: album.value.albumId };
    }, { mediaFolder: media });

    expect(await manualAlbumFilenames(page, seeded.albumId, 10)).toEqual(filenames);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Position Album E2E", { exact: true }).click();
    await expect(page.getByLabel("Sort photos")).toHaveValue("manual");
    await expect(tileByFilename(page, "position-000.png")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "position-003.png").getByRole("checkbox").check({ force: true });
    await tileByFilename(page, "position-005.png").getByRole("checkbox").check({ force: true });
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    const searchBox = page.getByLabel("Search photos");
    await searchBox.fill("position-003");
    await expect(page.locator(".photo-album-order-hint").first()).toContainText("Clear search and filters before changing custom order.", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Move to" })).toBeDisabled();
    await searchBox.fill("");
    await expect(tileByFilename(page, "position-005.png")).toBeVisible({ timeout: 20_000 });
    if (!(await tileByFilename(page, "position-003.png").getByRole("checkbox").isChecked().catch(() => false))) {
      await tileByFilename(page, "position-003.png").getByRole("checkbox").check({ force: true });
    }
    if (!(await tileByFilename(page, "position-005.png").getByRole("checkbox").isChecked().catch(() => false))) {
      await tileByFilename(page, "position-005.png").getByRole("checkbox").check({ force: true });
    }
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");

    await page.getByLabel("Custom order position").fill("2");
    const moveTo = page.getByRole("button", { name: "Move to" });
    await expect(moveTo).toBeEnabled();
    await moveTo.click();

    await expect.poll(async () => manualAlbumFilenames(page, seeded.albumId, 10), { timeout: 20_000 }).toEqual(expectedMovedOrder);
    await expect.poll(async () => visiblePhotoTileFilenames(page), { timeout: 20_000 }).toEqual(expectedMovedOrder);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos manual album Move last uses the full order for large albums", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-large-album-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  const expectedStartOrder = Array.from({ length: 125 }, (_, index) => `photo-${String(index).padStart(3, "0")}.png`);
  const expectedMovedOrder = [...expectedStartOrder.slice(1), expectedStartOrder[0]];
  writePhotoFixtureSet(media, expectedStartOrder);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    const seeded = await page.evaluate(async ({ mediaFolder }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const imported = await crossAge.invoke<{ value: { importedPaths: string[] } }>("import_photos", {
        sourcePaths: [mediaFolder],
        storageMode: "referenced",
        sourceLabel: "Large manual album E2E media"
      });
      const orderedPaths = [...(imported.value.importedPaths || [])].sort((left, right) => left.localeCompare(right));
      const album = await crossAge.invoke<{ value: { albumId: string } }>("save_photo_album", {
        name: "Large Order Album E2E",
        albumKind: "manual"
      });
      await crossAge.invoke<{ value: unknown }>("add_photo_album_items", {
        albumId: album.value.albumId,
        sourcePaths: orderedPaths
      });
      return { albumId: album.value.albumId };
    }, { mediaFolder: media });

    expect(await manualAlbumFilenames(page, seeded.albumId, 130)).toEqual(expectedStartOrder);

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Large Order Album E2E", { exact: true }).click();
    await expect(page.getByLabel("Sort photos")).toHaveValue("manual");
    await expect(tileByFilename(page, "photo-000.png")).toBeVisible();
    await tileByFilename(page, "photo-000.png").getByRole("checkbox").check({ force: true });

    const moveLast = page.getByRole("button", { name: "Move last" });
    await expect(moveLast).toBeEnabled();
    await moveLast.click();

    await expect.poll(async () => manualAlbumFilenames(page, seeded.albumId, 130), { timeout: 20_000 }).toEqual(expectedMovedOrder);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos generated groups can open focused Review More queues", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-group-review-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["group-accepted.png", "ada-pending.png", "grace-uncertain.png", "bob-pending.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "group-review-e2e"
api.project.db.create_scan_run(run_id, "Group Review E2E", "manual", str(media))
for name in ("group-accepted.png", "ada-pending.png", "grace-uncertain.png", "bob-pending.png"):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

def candidate(candidate_id, filename, person_name, status, score, quality=0.88, best_ref_id=None):
    return ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(media / filename),
        person_name=person_name,
        best_ref_id=best_ref_id,
        best_ref_path=None,
        score=score,
        band="likely",
        quality=quality,
        model_name="e2e-local",
        status=status,
    )

api.project.db.upsert_candidates([
    candidate("ada-group", "group-accepted.png", "Ada", "accepted", 0.99),
    candidate("grace-group", "group-accepted.png", "Grace", "accepted", 0.98),
    candidate("ada-pending", "ada-pending.png", "Ada", "pending", 0.74, 0.92, "ada-reference"),
    candidate("grace-uncertain", "grace-uncertain.png", "Grace", "uncertain", 0.76, 0.9, "grace-reference"),
    candidate("bob-pending", "bob-pending.png", "Bob", "pending", 0.95, 0.95),
])
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; kind: string; name: string; count: number; groupPeople?: string[] }> }>("list_photo_folders", {});
      const group = result.folders.find((folder) => folder.kind === "group" && folder.name === "Ada & Grace");
      return group ? {
        id: group.id,
        count: group.count,
        groupPeople: group.groupPeople || [],
      } : null;
    }), { timeout: 20_000 }).toEqual({
      id: "group:Ada|Grace",
      count: 1,
      groupPeople: ["Ada", "Grace"],
    });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Ada & Grace", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Ada & Grace", { timeout: 20_000 });
    await expect(tileByFilename(page, "group-accepted.png")).toBeVisible({ timeout: 20_000 });
    const inlineReview = page.getByRole("region", { name: "Inline Review More" });
    await expect(inlineReview.locator(".photos-inline-review-row")).toHaveCount(2);
    await expect(inlineReview).toContainText("ada-pending.png");
    await expect(inlineReview).toContainText("grace-uncertain.png");
    await expect(inlineReview).toContainText("score 76%");
    await expect(inlineReview).toContainText("quality 90%");
    await expect(inlineReview).toContainText("likely");
    await expect(inlineReview).toContainText("uncertain");
    await expect(inlineReview).toContainText("best reference");
    const minScoreSlider = inlineReview.getByLabel("Review More minimum score");
    await minScoreSlider.evaluate((element) => {
      const input = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "0.8");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(inlineReview.locator(".photos-inline-review-row")).toHaveCount(0);
    await expect(inlineReview).toContainText("No suggestions at the current score threshold.");
    await minScoreSlider.evaluate((element) => {
      const input = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(inlineReview.locator(".photos-inline-review-row")).toHaveCount(2);

    const reviewMore = page.getByRole("button", { name: "Review More Ada & Grace" });
    await expect(reviewMore).toBeEnabled();
    await reviewMore.click();

    const focusStrip = page.locator(".review-focus-strip");
    await expect(focusStrip).toContainText("Ada & Grace Review More");
    await expect(focusStrip).toContainText("2 matches");
    await expect(page.locator(".review-queue-panel .title-count")).toHaveText("2");
    await expect(page.locator(".review-candidate-row")).toHaveCount(2);
    await expect(page.locator(".review-candidate-row").nth(0)).toContainText("Grace");
    await expect(page.locator(".review-candidate-row").nth(0)).toContainText("grace-uncertain.png");
    await expect(page.locator(".review-candidate-row").nth(0).locator(".review-provenance-chips")).toContainText("score 76%");
    await expect(page.locator(".review-candidate-row").nth(0).locator(".review-provenance-chips")).toContainText("quality 90%");
    await expect(page.locator(".review-candidate-row").nth(0).locator(".review-provenance-chips")).toContainText("likely");
    await expect(page.locator(".review-candidate-row").nth(0).locator(".review-provenance-chips")).toContainText("uncertain");
    await expect(page.locator(".review-candidate-row").nth(0).locator(".review-provenance-chips")).toContainText("best reference");
    await expect(page.locator(".review-candidate-row").nth(1)).toContainText("Ada");
    await expect(page.locator(".review-candidate-row").nth(1)).toContainText("ada-pending.png");
    await expect(page.locator(".review-candidate-row").nth(1).locator(".review-provenance-chips")).toContainText("score 74%");
    await expect(page.locator(".review-candidate-row").nth(1).locator(".review-provenance-chips")).toContainText("quality 92%");
    await expect(page.locator(".review-candidate-row").filter({ hasText: "Bob" })).toHaveCount(0);
    await expect(page.locator(".review-session-bar")).toContainText("1 / 2");
    await focusStrip.getByRole("button", { name: "Show all Review" }).click();
    await expect(page.locator(".review-focus-strip")).toHaveCount(0);
    const recentReviewMore = page.getByRole("group", { name: "Recent Review More" });
    await expect(recentReviewMore.getByRole("button", { name: /Ada & Grace Review More\s+2/ })).toBeVisible();
    await recentReviewMore.getByRole("button", { name: /Ada & Grace Review More\s+2/ }).click();
    await expect(page.locator(".review-focus-strip")).toContainText("Ada & Grace Review More");
    await expect(page.locator(".review-candidate-row")).toHaveCount(2);
    await recentReviewMore.getByRole("button", { name: "Remove Ada & Grace Review More from recent Review More" }).click();
    await expect(recentReviewMore.getByRole("button", { name: /Ada & Grace Review More\s+2/ })).toHaveCount(0);
    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    await rail.getByText("Ada & Grace", { exact: true }).click();
    await expect(inlineReview.getByRole("button", { name: "Looks right Ada ada-pending.png" })).toBeVisible();
    await inlineReview.getByRole("button", { name: "Looks right Ada ada-pending.png" }).click();
    const inlineDecisionHistory = page.getByRole("group", { name: "Recent Review More decisions" });
    await expect(inlineDecisionHistory).toContainText("Ada");
    await expect(inlineDecisionHistory).toContainText("ada-pending.png");
    await expect(inlineDecisionHistory).toContainText("Needs review -> Accepted");
    await expect(inlineDecisionHistory).toContainText(/\d+%/);
    const reviewAuditHistory = page.getByRole("group", { name: "Review More audit history" });
    await expect(reviewAuditHistory).toContainText("Ada");
    await expect(reviewAuditHistory).toContainText("ada-pending.png");
    await expect(reviewAuditHistory).toContainText("Needs review -> Accepted");
    await expect(reviewAuditHistory).toContainText("Operation journal");
    await expect(reviewAuditHistory).toContainText("Undoable");
    await expect.poll(async () => page.evaluate(() => {
      const parsed = JSON.parse(window.localStorage.getItem("vintrace.photos.inlineReviewDecisions") || "[]");
      const first = Array.isArray(parsed) ? parsed[0] : null;
      return {
        count: Array.isArray(parsed) ? parsed.length : 0,
        candidateId: first?.candidateId || "",
        personName: first?.personName || "",
        previousStatus: first?.previousStatus || "",
        status: first?.status || "",
        sourceName: String(first?.sourcePath || "").split(/[\\/]/).pop() || "",
      };
    })).toEqual({
      count: 1,
      candidateId: "ada-pending",
      personName: "Ada",
      previousStatus: "pending",
      status: "accepted",
      sourceName: "ada-pending.png",
    });
    await inlineDecisionHistory.getByRole("button", { name: "Clear recent Review More decisions" }).click();
    await expect(inlineDecisionHistory).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("vintrace.photos.inlineReviewDecisions"))).toBe("[]");
    await expect(reviewAuditHistory).toContainText("ada-pending.png");
    const inlineReviewList = inlineReview.locator(".photos-inline-review-list");
    await expect(inlineReviewList.locator(".photos-inline-review-row")).toHaveCount(1);
    await expect(inlineReviewList).not.toContainText("ada-pending.png");
    await expect(inlineReviewList).toContainText("grace-uncertain.png");
    await tileByFilename(page, "group-accepted.png").locator(".photo-select-box").click();
    const bulkBar = page.locator(".photo-bulk-bar");
    await expect(bulkBar).toContainText("1 selected");
    await expect(bulkBar.getByRole("combobox", { name: "Move selected matches to person" })).toBeVisible();
    await expect(bulkBar.getByRole("button", { name: "Move matches", exact: true })).toBeDisabled();
    await bulkBar.getByRole("button", { name: "Remove matches" }).click();
    const removeMatches = page.getByRole("dialog", { name: "Remove selected matches" });
    await expect(removeMatches).toBeVisible();
    await removeMatches.getByRole("button", { name: "Remove matches" }).click();
    await expect(tileByFilename(page, "group-accepted.png")).toHaveCount(0);
    const operationUndo = page.locator(".photo-operation-undo");
    await expect(operationUndo).toContainText("person_match_remove", { timeout: 20_000 });
    const operationDetails = operationUndo.locator(".photo-operation-details");
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText("Source: group-accepted.png");
    await expect(operationDetails).toContainText("Status: accepted -> rejected");
    await expect(operationDetails).toContainText("Blocked rows:");
    const countActiveRemoveOperations = async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ value?: { operations?: Array<{ operationType?: string; canUndo?: boolean }> } }>("list_photo_operations", { limit: 8 });
      return (result.value?.operations || []).filter((operation) => operation.operationType === "person_match_remove" && operation.canUndo !== false).length;
    });
    const removeUndoCount = await countActiveRemoveOperations();
    expect(removeUndoCount).toBeGreaterThan(0);
    await rail.getByText("All Photos", { exact: true }).click();
    await expect(tileByFilename(page, "bob-pending.png")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "bob-pending.png").locator(".photo-select-box").click();
    await expect(bulkBar).toContainText("1 selected");
    await bulkBar.getByRole("combobox", { name: "Move selected matches to person" }).fill("Ada");
    await expect(bulkBar.getByRole("button", { name: "Move matches", exact: true })).toBeEnabled();
    await bulkBar.getByRole("button", { name: "Move matches", exact: true }).click();
    const moveMatches = page.getByRole("dialog", { name: "Move selected matches" });
    await expect(moveMatches).toBeVisible();
    await moveMatches.getByRole("button", { name: "Move matches" }).click();
    await expect(operationUndo).toContainText("person_match_reassign", { timeout: 20_000 });
    await expect(operationDetails).toContainText("Source: bob-pending.png");
    await expect(operationDetails).toContainText("From: Bob");
    await expect(operationDetails).toContainText("To: Ada");
    await expect(operationDetails).toContainText("Status: pending -> uncertain");
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const state = await crossAge.invoke<{ candidates: Array<{ candidateId: string; personName: string; status: string }> }>("get_state", {});
      const candidate = state.candidates.find((row) => row.candidateId === "bob-pending");
      return candidate ? { personName: candidate.personName, status: candidate.status } : null;
    }), { timeout: 20_000 }).toEqual({ personName: "Ada", status: "uncertain" });
    await operationUndo.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const state = await crossAge.invoke<{ candidates: Array<{ candidateId: string; personName: string; status: string }> }>("get_state", {});
      const candidate = state.candidates.find((row) => row.candidateId === "bob-pending");
      return candidate ? { personName: candidate.personName, status: candidate.status } : null;
    }), { timeout: 20_000 }).toEqual({ personName: "Bob", status: "pending" });
    await expect.poll(countActiveRemoveOperations, { timeout: 20_000 }).toBe(removeUndoCount);
    for (let index = 0; index < removeUndoCount; index += 1) {
      await expect(operationUndo).toContainText("person_match_remove", { timeout: 20_000 });
      await operationUndo.getByRole("button", { name: "Undo" }).click();
      await expect.poll(countActiveRemoveOperations, { timeout: 20_000 }).toBe(removeUndoCount - index - 1);
    }
    await rail.getByText("Ada & Grace", { exact: true }).click();
    await expect(tileByFilename(page, "group-accepted.png")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos saved groups open include exclude focused Review More queues", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-saved-group-review-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["core-clean.png", "core-with-bob.png", "ada-pending.png", "grace-uncertain.png", "bob-pending.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "saved-group-review-e2e"
api.project.db.create_scan_run(run_id, "Saved Group Review E2E", "manual", str(media))
for name in ("core-clean.png", "core-with-bob.png", "ada-pending.png", "grace-uncertain.png", "bob-pending.png"):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")

def candidate(candidate_id, filename, person_name, status, score, quality=0.88):
    return ReviewCandidate(
        candidate_id=candidate_id,
        source_path=str(media / filename),
        person_name=person_name,
        best_ref_id=None,
        best_ref_path=None,
        score=score,
        band="likely",
        quality=quality,
        model_name="e2e-local",
        status=status,
    )

api.project.db.upsert_candidates([
    candidate("ada-core-clean", "core-clean.png", "Ada", "accepted", 0.99),
    candidate("grace-core-clean", "core-clean.png", "Grace", "accepted", 0.98),
    candidate("ada-core-bob", "core-with-bob.png", "Ada", "accepted", 0.99),
    candidate("grace-core-bob", "core-with-bob.png", "Grace", "accepted", 0.98),
    candidate("bob-core-bob", "core-with-bob.png", "Bob", "accepted", 0.97),
    candidate("ada-pending", "ada-pending.png", "Ada", "pending", 0.74, 0.92),
    candidate("grace-uncertain", "grace-uncertain.png", "Grace", "uncertain", 0.76, 0.9),
    candidate("bob-pending", "bob-pending.png", "Bob", "pending", 0.95, 0.95),
])
api.save_photo_people_group({
    "groupId": "core-duo",
    "name": "Core Duo",
    "memberPeople": ["Ada", "Grace"],
    "excludePeople": ["Bob"],
})
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; kind: string; name: string; count: number; groupPeople?: string[]; excludePeople?: string[] }> }>("list_photo_folders", {});
      const group = result.folders.find((folder) => folder.id === "group:saved:core-duo");
      return group ? {
        name: group.name,
        count: group.count,
        groupPeople: group.groupPeople || [],
        excludePeople: group.excludePeople || [],
      } : null;
    }), { timeout: 20_000 }).toEqual({
      name: "Core Duo",
      count: 1,
      groupPeople: ["Ada", "Grace"],
      excludePeople: ["Bob"],
    });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Core Duo", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Core Duo", { timeout: 20_000 });
    await expect(tileByFilename(page, "core-clean.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "core-with-bob.png")).toHaveCount(0);

    const managerToggle = page.locator(".photo-rail-people-sort button[title='Manage People']");
    await expect(managerToggle).toBeVisible({ timeout: 20_000 });
    await managerToggle.click();
    const manager = page.getByLabel("People management");
    const coreDuoManagerRow = manager.locator('article.photos-people-manager-row[data-group-name="Core Duo"]');
    await expect(coreDuoManagerRow).toContainText("2 Review More");
    const reviewMore = coreDuoManagerRow.getByRole("button", { name: "Review More Core Duo" });
    await expect(reviewMore).toBeEnabled();
    await reviewMore.click();

    const focusStrip = page.locator(".review-focus-strip");
    await expect(focusStrip).toContainText("Core Duo Review More");
    await expect(focusStrip).toContainText("2 matches");
    await expect(page.locator(".review-queue-panel .title-count")).toHaveText("2");
    await expect(page.locator(".review-candidate-row")).toHaveCount(2);
    await expect(page.locator(".review-candidate-row").nth(0)).toContainText("Grace");
    await expect(page.locator(".review-candidate-row").nth(0)).toContainText("grace-uncertain.png");
    await expect(page.locator(".review-candidate-row").nth(1)).toContainText("Ada");
    await expect(page.locator(".review-candidate-row").nth(1)).toContainText("ada-pending.png");
    await expect(page.locator(".review-candidate-row").filter({ hasText: "Bob" })).toHaveCount(0);
    await expect(page.locator(".review-session-bar")).toContainText("1 / 2");
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Photos Pet Review supports assigning selected pets from the bulk bar", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-photos-pet-review-"));
  const workspace = path.join(temp, "workspace");
  const registry = path.join(temp, "registry");
  const media = path.join(temp, "media");
  writePhotoFixtureSet(media, ["review-a.png", "review-b.png", "review-cat.png", "milo-existing.png"]);
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CROSSAGE_FORCE_FALLBACK: "1",
    VINTRACE_REGISTRY_HOME: registry,
    CROSSAGE_REGISTRY_HOME: registry,
    VINTRACE_WORKSPACE: workspace,
    CROSSAGE_WORKSPACE: workspace,
    CROSSAGE_ALLOW_MULTI_INSTANCE: "1",
    PYTHONPATH: projectRoot
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPythonSeed(projectRoot, env, `
from pathlib import Path
import sys

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature

workspace = Path(sys.argv[1])
media = Path(sys.argv[2])
api = DesktopApi(workspace)
run_id = "pet-review-e2e"
api.project.db.create_scan_run(run_id, "Pet Review E2E", "manual", str(media))
for name in ("review-a.png", "review-b.png", "review-cat.png", "milo-existing.png"):
    path = media / name
    api.project.db.record_scan_file(run_id, path, path_signature(path), "completed", phase="processed")
for name in ("review-a.png", "review-b.png"):
    api.project.db.update_photo_asset_metadata_json(
        source_path=str(media / name),
        patch={"labels": ["dog"], "objects": [{"label": "dog", "confidence": 0.97}]},
    )
api.project.db.update_photo_asset_metadata_json(
    source_path=str(media / "review-cat.png"),
    patch={"labels": ["cat"], "objects": [{"label": "cat", "confidence": 0.96}]},
)
api.project.db.update_photo_asset_metadata_json(
    source_path=str(media / "milo-existing.png"),
    patch={"petNames": ["Milo"], "labels": ["dog"], "objects": [{"label": "dog", "confidence": 0.97}]},
)
`, [workspace, media]);

  const pageErrors: string[] = [];
  const app = await electron.launch({
    args: [path.join(projectRoot, "desktop/main.cjs")],
    cwd: projectRoot,
    env
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await expect(page.getByText("Backend ready.")).toBeVisible({ timeout: 120_000 });
    await page.locator(".language-picker select").selectOption("en");
    await closeOnboardingIfVisible(page);
    await page.evaluate(async ({ workspacePath }) => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      await crossAge.invoke("set_workspace", { path: workspacePath });
    }, { workspacePath: workspace });

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
      return {
        petReview: result.folders.find((folder) => folder.id === "petReview")?.count || 0,
        milo: result.folders.find((folder) => folder.id === "pet:Milo")?.count || 0,
      };
    }), { timeout: 20_000 }).toEqual({ petReview: 3, milo: 1 });

    await page.locator(".nav-list").getByRole("button", { name: "Library" }).click();
    const rail = page.locator(".photos-rail");
    await rail.getByText("Pet Review", { exact: true }).click();
    await expect(page.locator(".photos-gallery-title")).toContainText("Dog 2", { timeout: 20_000 });
    await expect(page.locator(".photos-gallery-title")).toContainText("Cat 1", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Show Dog Pet Review items" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Show Dog Pet Review items" }).click();
    await expect(tileByFilename(page, "review-a.png")).toBeVisible({ timeout: 20_000 });
    await expect(tileByFilename(page, "review-b.png")).toBeVisible();
    await expect(tileByFilename(page, "review-cat.png")).toHaveCount(0);

    await tileByFilename(page, "review-a.png").locator(".photo-select-box").click();
    await tileByFilename(page, "review-b.png").locator(".photo-select-box").click();
    await expect(page.locator(".photo-bulk-bar")).toContainText("2 selected");
    await page.getByLabel("Bulk pet name").fill("Milo");
    await page.getByRole("button", { name: "Assign selected pets" }).click();

    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
      const petReview = result.folders.find((folder) => folder.id === "petReview");
      return {
        petReview: Boolean(petReview),
        petReviewCount: petReview?.count || 0,
        miloCount: result.folders.find((folder) => folder.id === "pet:Milo")?.count || 0,
      };
    }), { timeout: 20_000 }).toEqual({ petReview: true, petReviewCount: 1, miloCount: 3 });

    const miloFilenames = await page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const result = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "pet:Milo",
        sort: "filename",
        previewBudget: 0
      });
      return result.items.map((item) => String(item.sourcePath || "").split(/[\\/]/).filter(Boolean).pop() || "").sort();
    });
    expect(miloFilenames).toEqual(["milo-existing.png", "review-a.png", "review-b.png"]);

    await rail.getByText("Pet Review", { exact: true }).click();
    await expect(tileByFilename(page, "review-cat.png")).toBeVisible({ timeout: 20_000 });
    await tileByFilename(page, "review-cat.png").locator(".photo-select-box").click();
    await page.getByRole("button", { name: "Dismiss selected Pet Review items" }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const crossAge = (window as any).crossAge as {
        invoke<T>(command: string, params?: Record<string, unknown>): Promise<T>;
      };
      const folders = await crossAge.invoke<{ folders: Array<{ id: string; count: number }> }>("list_photo_folders", {});
      const allItems = await crossAge.invoke<{ items: Array<{ sourcePath: string }> }>("list_photo_folder_items", {
        folderId: "all",
        sort: "filename",
        previewBudget: 0,
        limit: 10
      });
      return {
        petReview: Boolean(folders.folders.find((folder) => folder.id === "petReview")),
        catStillInLibrary: allItems.items.some((item) => /review-cat\.png$/.test(item.sourcePath)),
      };
    }), { timeout: 20_000 }).toEqual({ petReview: false, catStillInLibrary: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
