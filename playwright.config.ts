import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  workers: 1,
  // Electron+Python(ONNX) cold-start is heavy; under many sequential launches a
  // BrowserWindow occasionally takes >30s to appear, so `firstWindow()` times out.
  // A timed-out spec skips its `app.close()` and orphans the Electron+Python group,
  // which pins CPU and slows the next launch — a cascade. One retry restarts the
  // worker (reaping the orphan and freeing CPU) and re-runs the spec, so transient
  // launch timeouts self-heal and are reported as "flaky" rather than failing.
  retries: 1,
  reporter: [["list"]]
});

