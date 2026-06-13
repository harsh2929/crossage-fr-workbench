import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    // M3: emit source maps only in dev (or when explicitly requested for crash
    // symbolication). The production build was shipping ~2.1MB of maps.
    sourcemap: process.env.VINTRACE_SOURCEMAP === "1" ? true : command === "serve",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "icons";
          }
          if (id.endsWith("/src/i18n.ts") || id.endsWith("\\src\\i18n.ts")) {
            return "i18n";
          }
        }
      }
    }
  }
}));
