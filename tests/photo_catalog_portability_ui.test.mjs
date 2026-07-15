import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const main = read("desktop/main.cjs");
const preload = read("desktop/preload.cjs");
const bridge = read("src/bridgeValidation.ts");
const types = read("src/types.ts");
const app = read("src/App.tsx");
const photos = read("src/views/PhotosView.tsx");
const sourcePanel = read("src/views/photoSourceImportPanel.tsx");
const catalogPanel = read("src/views/PhotoCatalogPortabilityPanel.tsx");
const catalogStyles = read("src/views/photoCatalogPortabilityPanel.css");
const deferred = read("src/views/photoDeferredSurfaces.tsx");
const phrases = read("src/i18n/photoCatalogPhrases.ts");

for (const command of [
  "photo_catalog_status",
  "inspect_open_photo_catalog",
  "export_open_photo_catalog",
  "import_open_photo_catalog",
]) {
  assert.match(main, new RegExp(`backend\\.invoke\\(\\"${command}\\"|invokeCancellablePhotoCatalog\\(\\"${command}\\"`));
}
for (const command of [
  "dam_catalog_status",
  "list_dam_catalogs",
  "preview_dam_catalog",
  "import_dam_catalog",
  "sync_dam_catalog",
]) {
  assert.match(main, new RegExp(`\\"${command}\\"`));
}

const broadPreloadCommands = preload.match(/const TRUSTED_BACKEND_COMMANDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
for (const command of [
  "photo_catalog_status",
  "inspect_open_photo_catalog",
  "export_open_photo_catalog",
  "import_open_photo_catalog",
  "dam_catalog_status",
  "list_dam_catalogs",
  "preview_dam_catalog",
  "import_dam_catalog",
  "sync_dam_catalog",
]) {
  assert.ok(!broadPreloadCommands.includes(`"${command}"`), `${command} must remain outside generic renderer invoke`);
}

for (const channel of ["status", "inspect", "export", "import", "cancel"]) {
  assert.match(main, new RegExp(`ipcMain\\.handle\\(\\"photo-catalog:${channel}\\"`));
}
for (const channel of ["status", "list", "preview", "import", "sync"]) {
  assert.match(main, new RegExp(channel === "preview" || channel === "import" || channel === "sync"
    ? `\\[\\"photo-dam:${channel}\\"`
    : `ipcMain\\.handle\\(\\"photo-dam:${channel}\\"`));
}
assert.match(main, /grantedPhotoPortabilityPath/);
assert.match(main, /isUserGrantedPath\(resolved\)/);
assert.match(main, /rootMappings\.slice\(0, 64\)/);
assert.match(main, /activePhotoCatalogCancelToken/);
assert.match(main, /cancelToken: token/);
assert.match(main, /\.photo-catalog-cancel/);
assert.match(main, /requireUnlockedPhotoPortability\(\)/);

for (const method of [
  "chooseDamCatalog",
  "chooseOpenPhotoCatalog",
  "getPhotoCatalogStatus",
  "inspectOpenPhotoCatalog",
  "exportOpenPhotoCatalog",
  "importOpenPhotoCatalog",
  "cancelOpenPhotoCatalog",
  "getDamCatalogStatus",
  "listDamCatalogs",
  "previewDamCatalog",
  "importDamCatalog",
  "syncDamCatalog",
]) {
  assert.match(preload, new RegExp(`${method}:`));
  assert.match(bridge, new RegExp(`\\"${method}\\"`));
  assert.match(types, new RegExp(`${method}\\(`));
}

assert.match(types, /export type DamPhotoSourceProvider = "lightroom_catalog" \| "capture_one_catalog"/);
assert.match(app, /window\.crossAge\.previewDamCatalog/);
assert.match(app, /window\.crossAge\.importDamCatalog/);
assert.match(app, /window\.crossAge\.syncDamCatalog/);
assert.match(sourcePanel, /photo-source-tab-dam/);
assert.match(sourcePanel, /Lightroom Classic/);
assert.match(sourcePanel, /Capture One/);
assert.match(sourcePanel, /rootMappings/);
assert.match(sourcePanel, /chooseMappingTarget/);
assert.match(sourcePanel, /visibleScopeRows/);

assert.match(deferred, /PhotoCatalogPortabilityPanel/);
assert.match(photos, /<PhotoCatalogPortabilityPanel/);
assert.match(catalogPanel, /role="dialog" aria-modal="true"/);
assert.match(catalogPanel, /role="tablist"/);
assert.match(catalogPanel, /Open catalog packages are not encrypted\./);
assert.match(catalogPanel, /metadataOnly/);
assert.match(catalogPanel, /includeSidecars/);
assert.match(catalogPanel, /mergeByHash/);
assert.match(catalogPanel, /verifyMedia: false/);
assert.match(catalogPanel, /requestCancel/);
assert.match(catalogPanel, /event\.key === "Escape"/);
assert.match(catalogPanel, /event\.key !== "Tab"/);
assert.match(catalogPanel, /role="progressbar"/);
assert.match(catalogStyles, /@media \(max-width: 620px\)/);
assert.match(catalogStyles, /height: 100vh/);
assert.doesNotMatch(catalogPanel, /style=\{\{[^}]*fontSize/);

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.match(phrases, new RegExp(`\\b${language}: \\{`));
}
for (const phrase of [
  "Pro catalogs",
  "Open catalog packages are not encrypted.",
  "Catalog structure verified.",
  "Catalog export cancelled.",
  "Catalog import cancelled.",
]) {
  assert.equal((phrases.match(new RegExp(`\\"${phrase.replaceAll(".", "\\.")}\\"`, "g")) || []).length, 6, `${phrase} must cover six translated locales`);
}

console.log("photo catalog portability and DAM UI contract ok");
