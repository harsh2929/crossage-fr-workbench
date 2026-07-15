import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function photoFeatureChunk(id: string) {
  const file = id.replaceAll("\\", "/").split("/").pop()?.toLowerCase() || "";
  if (file.includes("slideshow")) return "photos-slideshow-helpers";
  if (/(image|lightbox|export|selection|contact|color|portrait|subject|media)/.test(file)) {
    return "photos-editing-helpers";
  }
  if (/(import|source|backup|repair|recovered|managed|consolidat)/.test(file)) {
    return "photos-import-helpers";
  }
  if (/(album|people|person|pet|memory|story|group|relationship|curation|duplicate|burst)/.test(file)) {
    return "photos-library-helpers";
  }
  return "photos-library-helpers";
}

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    react(),
    {
      name: "crossage-dev-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';");
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    // Electron's Chromium runtime supports modulepreload natively, so the
    // compatibility polyfill only adds bytes to the initial application chunk.
    modulePreload: { polyfill: false },
    // M3: emit source maps only in dev (or when explicitly requested for crash
    // symbolication). The production build was shipping ~2.1MB of maps.
    sourcemap: process.env.VINTRACE_SOURCEMAP === "1" ? true : command === "serve",
    rollupOptions: {
      output: {
        manualChunks(id, { getModuleInfo }) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "icons";
          }
          if (id.endsWith("/src/i18n.ts") || id.endsWith("\\src\\i18n.ts")) {
            return "i18n";
          }
          const localeMatch = id.match(/[\\/]src[\\/]i18n[\\/]locales[\\/](ar|es|fr|hi|ja|zh)\.ts$/);
          if (localeMatch) {
            return `i18n-${localeMatch[1]}`;
          }
          const normalized = id.replaceAll("\\", "/");
          if (normalized.includes("/src/views/") && !normalized.endsWith("/PhotosView.tsx")) {
            if (normalized.endsWith("/reviewFocusHistory.ts")) {
              return undefined;
            }
            if (normalized.endsWith("/photoGroupReview.ts")) {
              return "photos-review-helpers";
            }
            if (normalized.endsWith(".ts") && !normalized.includes("/photoDeferred")) {
              return photoFeatureChunk(normalized);
            }
            if (
              normalized.endsWith(".tsx")
              && getModuleInfo(id)?.importers.some((importer) => importer.replaceAll("\\", "/").endsWith("/PhotosView.tsx"))
            ) {
              return "photos-core-components";
            }
          }
        }
      }
    }
  }
}));
