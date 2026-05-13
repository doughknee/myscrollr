import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolve } from "path";

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;
const projectRoot = __dirname;

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8",
  ),
);

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    // Sentry plugin MUST be last so it sees the final bundle output.
    // Disabled automatically when SENTRY_AUTH_TOKEN isn't set (local builds).
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: "scrollr-desktop",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: `scrollr-desktop@${pkg.version}` },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    }),
  ],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
  },

  // Multi-page build: ticker (index.html) + app window (app.html)
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    // Generate source maps but don't expose them via comment. The Sentry
    // plugin uploads them and deletes locally when SENTRY_AUTH_TOKEN is set.
    sourcemap: "hidden",
    rollupOptions: {
      input: {
        main: resolve(projectRoot, "index.html"),
        app: resolve(projectRoot, "app.html"),
      },
    },
  },
});
