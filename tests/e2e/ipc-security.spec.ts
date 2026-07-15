import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skip(process.env.VINTRACE_IPC_FUZZ !== "1", "Set VINTRACE_IPC_FUZZ=1 to run IPC security fuzzing.");

test("renderer IPC boundary rejects malformed and untrusted requests", async () => {
  const projectRoot = process.cwd();
  const temp = mkdtempSync(path.join(os.tmpdir(), "vintrace-ipc-fuzz-"));
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
  await expect(page.getByText("Backend ready.")).toBeAttached({ timeout: 120_000 });
  await page.locator(".language-picker select").selectOption("en");

  const results = await page.evaluate(async () => {
    const crossAge = window.crossAge as unknown as {
      invoke(command: string, params?: Record<string, unknown>): Promise<unknown>;
      revealPath(targetPath: string): Promise<boolean>;
      openPath(targetPath: string): Promise<{ ok: boolean; error: string }>;
      openPathWith(targetPath: string, editorPath?: string): Promise<{ ok: boolean; error: string }>;
      writeClipboardImagePath(targetPath: string): Promise<{ ok: boolean; error: string }>;
      startFileDrag(targetPath: string): Promise<{ ok: boolean; error: string }>;
      startFolderWatch(folder: string): Promise<unknown>;
    };
    async function capture(label: string, fn: () => Promise<unknown> | unknown) {
      try {
        const value = await fn();
        return { label, ok: true, value };
      } catch (error) {
        const err = error as Error & { code?: string };
        const message = err.message || String(error);
        return { label, ok: false, code: err.code || message.match(/\b[EW]-[A-Z0-9-]{2,}\b/)?.[0] || "", message };
      }
    }
    return [
      await capture("blocked command", () => crossAge.invoke("__proto__", {})),
      await capture("bad params", () => crossAge.invoke("get_state", [] as unknown as Record<string, unknown>)),
      await capture("oversized params", () => crossAge.invoke("get_state", { padding: "x".repeat(1_000_010) })),
      await capture("empty folder watch", () => crossAge.startFolderWatch("")),
      await capture("untrusted reveal", () => crossAge.revealPath("/etc/passwd")),
      await capture("untrusted open", () => crossAge.openPath("/etc/passwd")),
      await capture("untrusted open with", () => crossAge.openPathWith("/etc/passwd", "/Applications/Preview.app")),
      await capture("untrusted image clipboard", () => crossAge.writeClipboardImagePath("/etc/passwd")),
      await capture("untrusted file drag", () => crossAge.startFileDrag("/etc/passwd"))
    ];
  });

  expect(results.find((item) => item.label === "blocked command")).toMatchObject({ ok: false, code: "E-IPC-BLOCKED-COMMAND" });
  expect(results.find((item) => item.label === "bad params")).toMatchObject({ ok: false, code: "E-IPC-PAYLOAD" });
  expect(results.find((item) => item.label === "oversized params")).toMatchObject({ ok: false, code: "E-IPC-PARAMS-LARGE" });
  expect(results.find((item) => item.label === "empty folder watch")).toMatchObject({ ok: false, code: "E-FOLDER-WATCH-PATH" });
  expect(results.find((item) => item.label === "untrusted reveal")).toMatchObject({ ok: true, value: false });
  expect(results.find((item) => item.label === "untrusted open")).toMatchObject({ ok: true, value: { ok: false } });
  expect(results.find((item) => item.label === "untrusted open with")).toMatchObject({ ok: true, value: { ok: false } });
  expect(results.find((item) => item.label === "untrusted image clipboard")).toMatchObject({ ok: true, value: { ok: false } });
  expect(results.find((item) => item.label === "untrusted file drag")).toMatchObject({ ok: true, value: { ok: false } });
  expect(pageErrors).toEqual([]);
  await app.close();
});
