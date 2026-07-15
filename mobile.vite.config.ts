import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "mobile-dist");

function copyBrandIcon(): Plugin {
  return {
    name: "vintrace-mobile-brand-icon",
    closeBundle() {
      fs.mkdirSync(output, { recursive: true });
      fs.copyFileSync(path.join(root, "mcp", "icon.png"), path.join(output, "icon.png"));
    },
  };
}

export default defineConfig({
  root: path.join(root, "mobile"),
  base: "/mobile/",
  publicDir: path.join(root, "mobile", "public"),
  plugins: [copyBrandIcon()],
  build: {
    outDir: output,
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        entryFileNames: "assets/mobile-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/mobile-[hash][extname]",
      },
    },
  },
});
