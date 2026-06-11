import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.endsWith("/src/i18n.ts") || id.endsWith("\\src\\i18n.ts")) {
            return "i18n";
          }
        }
      }
    }
  }
});
