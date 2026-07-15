import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/App.tsx");
const photos = read("src/views/PhotosView.tsx");
const deferred = read("src/views/photoDeferredSurfaces.tsx");
const boundary = read("src/views/deferredPhotoComponent.tsx");
const relationshipPanel = read("src/views/photoRelationshipSuggestionsPanel.tsx");
const sourcePanel = read("src/views/photoSourceImportPanel.tsx");
const globalCss = read("src/styles.css");
const vite = read("vite.config.ts");
const runtimePhotoImports = new Set(
  [...photos.matchAll(/import\s+(type\s+)?[^;]+?from "(\.\/[^\"]+)";/g)]
    .filter((match) => !match[1])
    .map((match) => match[2]),
);

assert.match(app, /const loadPhotosViewModule = \(\) => import\("\.\/views\/PhotosView"\)/);
assert.match(app, /const PhotosView = lazy\(loadPhotosViewModule\)/);
assert.doesNotMatch(app, /import \{ PhotosView \} from "\.\/views\/PhotosView"/);
assert.match(photos, /from "\.\/photoDeferredSurfaces"/);
assert.match(photos, /usePhotoRelationshipSuggestions\(\{/);
assert.doesNotMatch(photos, /decision: "(?:applied|dismissed)"/);
assert.match(photos, /import "\.\/photosRoute\.css"/);

for (const group of ["Destination", "Import", "Lightbox", "Search", "Settings", "Slideshow"]) {
  assert.match(deferred, new RegExp(`const load${group}Surfaces = \\(\\) => import\\(\\"\\./photoDeferred${group}Surfaces\\"\\)`));
  const groupSource = read(`src/views/photoDeferred${group}Surfaces.ts`);
  for (const match of groupSource.matchAll(/from "\.\/(.+)"/g)) {
    assert.equal(runtimePhotoImports.has(`./${match[1]}`), false, `${match[1]} must stay behind its deferred boundary`);
  }
}

assert.match(boundary, /lazy\(loader as/);
assert.match(boundary, /<Suspense[\s\S]*fallback=\{/);
assert.match(boundary, /className="photo-deferred-surface"/);
assert.match(relationshipPanel, /import "\.\/photoRelationshipSuggestionsPanel\.css"/);
assert.match(sourcePanel, /import "\.\/photoSourceImportPanel\.css"/);
assert.doesNotMatch(globalCss, /\.photo-relationship-suggestions/);
assert.doesNotMatch(globalCss, /\.photo-source-launcher/);

for (const chunk of [
  "photos-core-components",
  "photos-editing-helpers",
  "photos-import-helpers",
  "photos-library-helpers",
  "photos-slideshow-helpers",
]) {
  assert.ok(vite.includes(`"${chunk}"`), `missing stable ${chunk} chunk`);
}
assert.match(vite, /normalized\.endsWith\("\/reviewFocusHistory\.ts"\)[\s\S]*return undefined/);
assert.match(vite, /normalized\.endsWith\("\/photoGroupReview\.ts"\)[\s\S]*return "photos-review-helpers"/);

for (const language of ["ar", "es", "fr", "hi", "ja", "zh"]) {
  assert.match(read(`src/i18n/locales/${language}.ts`), /uiCoveragePhrases/);
}

console.log("PHOTO-10 frontend architecture contract ok");
