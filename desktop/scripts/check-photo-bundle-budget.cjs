const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");
const REPORT = path.join(ROOT, "benchmarks/results/photo-frontend-architecture-20260713.json");

const baseline = {
  photosViewBytes: 1_123_060,
  globalCssBytes: 399_580,
};
const budgets = {
  photosViewBytes: 450_000,
  largestJavaScriptBytes: 500_000,
  initialJavaScriptBytes: 760_000,
  globalCssBytes: 385_000,
  deferredSurfaceBytes: 100_000,
  minimumPhotosViewReductionPercent: 60,
  minimumGlobalCssReductionPercent: 4,
  minimumDeferredSurfaceChunks: 6,
};

if (!fs.existsSync(ASSETS) || !fs.existsSync(path.join(DIST, "index.html"))) {
  throw new Error("Production assets are missing. Run `npm run build:vite` first.");
}

const files = fs.readdirSync(ASSETS).sort();
const onlyMatch = (pattern, label) => {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.join(", ") || "none"}.`);
  return matches[0];
};
const bytes = (file) => fs.statSync(path.join(ASSETS, file)).size;
const roundPercent = (value) => Math.round(value * 100) / 100;

const photosViewFile = onlyMatch(/^PhotosView-.+\.js$/, "PhotosView JavaScript chunk");
const globalCssFile = onlyMatch(/^index-.+\.css$/, "global CSS chunk");
const deferredSurfaceFiles = files.filter((file) => /^photoDeferred.+Surfaces-.+\.js$/.test(file));
const routeCssFiles = files.filter((file) => /^(?:PhotosView|photoDeferred.+Surfaces)-.+\.css$/.test(file));
const javascriptFiles = files.filter((file) => file.endsWith(".js"));
const largestJavaScriptFile = javascriptFiles
  .map((file) => ({ file, bytes: bytes(file) }))
  .sort((left, right) => right.bytes - left.bytes || left.file.localeCompare(right.file))[0];
const indexHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const initialJavaScriptFiles = [...indexHtml.matchAll(/(?:src|href)="\.\/assets\/([^"?]+\.js)"/g)]
  .map((match) => match[1])
  .filter((file, index, all) => all.indexOf(file) === index)
  .sort();
const initialJavaScriptBytes = initialJavaScriptFiles.reduce((total, file) => total + bytes(file), 0);
const photosViewBytes = bytes(photosViewFile);
const globalCssBytes = bytes(globalCssFile);
const photosViewReductionPercent = roundPercent((1 - photosViewBytes / baseline.photosViewBytes) * 100);
const globalCssReductionPercent = roundPercent((1 - globalCssBytes / baseline.globalCssBytes) * 100);
const deferredCategories = ["Destination", "Import", "Lightbox", "Search", "Settings", "Slideshow"];
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

check("PhotosView chunk budget", photosViewBytes <= budgets.photosViewBytes, `${photosViewBytes} <= ${budgets.photosViewBytes} bytes`);
check(
  "PhotosView baseline reduction",
  photosViewReductionPercent >= budgets.minimumPhotosViewReductionPercent,
  `${photosViewReductionPercent}% >= ${budgets.minimumPhotosViewReductionPercent}%`,
);
check(
  "largest JavaScript chunk budget",
  largestJavaScriptFile.bytes <= budgets.largestJavaScriptBytes,
  `${largestJavaScriptFile.file}: ${largestJavaScriptFile.bytes} <= ${budgets.largestJavaScriptBytes} bytes`,
);
check(
  "initial JavaScript transfer budget",
  initialJavaScriptBytes <= budgets.initialJavaScriptBytes,
  `${initialJavaScriptBytes} <= ${budgets.initialJavaScriptBytes} bytes`,
);
check("global CSS budget", globalCssBytes <= budgets.globalCssBytes, `${globalCssBytes} <= ${budgets.globalCssBytes} bytes`);
check(
  "global CSS baseline reduction",
  globalCssReductionPercent >= budgets.minimumGlobalCssReductionPercent,
  `${globalCssReductionPercent}% >= ${budgets.minimumGlobalCssReductionPercent}%`,
);
check(
  "deferred surface count",
  deferredSurfaceFiles.length >= budgets.minimumDeferredSurfaceChunks,
  `${deferredSurfaceFiles.length} >= ${budgets.minimumDeferredSurfaceChunks}`,
);
for (const category of deferredCategories) {
  check(
    `deferred ${category.toLowerCase()} surface emitted`,
    deferredSurfaceFiles.some((file) => file.includes(category)),
    category,
  );
}
check(
  "deferred surface chunk budgets",
  deferredSurfaceFiles.every((file) => bytes(file) <= budgets.deferredSurfaceBytes),
  deferredSurfaceFiles.map((file) => `${file}:${bytes(file)}`).join(", "),
);
check(
  "deferred surfaces not preloaded",
  initialJavaScriptFiles.every((file) => !/(?:PhotosView|photoDeferred|photos-(?:core|editing|import|library|slideshow)-)/.test(file)),
  initialJavaScriptFiles.join(", "),
);
check("route-owned CSS emitted", routeCssFiles.length >= 3, routeCssFiles.join(", "));
check("production source maps disabled", !files.some((file) => file.endsWith(".map")), "no .map assets");

const report = {
  schemaVersion: 1,
  auditItem: "PHOTO-10",
  reportDate: "2026-07-13",
  ok: checks.every((item) => item.ok),
  baseline,
  budgets,
  current: {
    photosView: { file: photosViewFile, bytes: photosViewBytes },
    globalCss: { file: globalCssFile, bytes: globalCssBytes },
    largestJavaScript: largestJavaScriptFile,
    initialJavaScript: { files: initialJavaScriptFiles, bytes: initialJavaScriptBytes },
    deferredSurfaces: deferredSurfaceFiles.map((file) => ({ file, bytes: bytes(file) })),
    routeCss: routeCssFiles.map((file) => ({ file, bytes: bytes(file) })),
  },
  improvements: {
    photosViewReductionPercent,
    globalCssReductionPercent,
  },
  checks,
};

if (!process.argv.includes("--no-write")) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`PHOTO-10 bundle budget: ${report.ok ? "PASS" : "FAIL"}`);
console.log(`PhotosView ${photosViewBytes} bytes (${photosViewReductionPercent}% below baseline)`);
console.log(`Initial JavaScript ${initialJavaScriptBytes} bytes; global CSS ${globalCssBytes} bytes`);
if (!report.ok) {
  for (const failed of checks.filter((item) => !item.ok)) console.error(`FAIL ${failed.name}: ${failed.detail}`);
  process.exitCode = 1;
}
