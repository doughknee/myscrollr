import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { devBus } from "./scripts/dev-bus";
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

/**
 * Web mode (SCROLLR-250, `npm run web`, desktop/web.html). Dev server only:
 * `/__api` proxies to VITE_API_URL, which sends no CORS headers for
 * localhost, and `/callback` (Logto's web-mode redirect) serves web.html.
 */
function webMode(): Plugin {
  return {
    name: "scrollr-web-mode",
    apply: "serve",
    config: (_config, { mode }) => ({
      server: {
        proxy: {
          "/__api": {
            // Same fallback as src/config.ts DEFAULT_API.
            target: loadEnv(mode, projectRoot, "VITE_").VITE_API_URL || "http://localhost:8080",
            changeOrigin: true,
            rewrite: (path) => path.slice("/__api".length),
          },
        },
      },
    }),
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/callback?")) req.url = `/web.html${req.url.slice("/callback".length)}`;
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    // Dev only (apply: "serve"): lets scripts/dev/devctl.mjs run code in a window.
    devBus(),
    webMode(),
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
    watch: { ignored: ["**/src-tauri/target/**"] },
  },

  // The website's ticker (SCROLLR-310): `npm run build:embed` builds
  // embed.html alone into dist-embed/, served by the site at /bar/. No
  // desktop .env is read (no DSN, no API URL baked in); the Tauri build is
  // untouched.
  ...(mode === "embed" && {
    base: "/bar/",
    envDir: resolve(projectRoot, "src/embed"),
  }),

  // Multi-page build: ticker (index.html) + app window (app.html) +
  // the Identify tile (identify.html, no JS of its own)
  build: {
    outDir: mode === "embed" ? "dist-embed" : "dist",
    emptyOutDir: true,
    target: "esnext",
    // Generate source maps but don't expose them via comment. The Sentry
    // plugin uploads them and deletes locally when SENTRY_AUTH_TOKEN is set.
    sourcemap: mode === "embed" ? false : "hidden",
    rollupOptions: {
      input:
        mode === "embed"
          ? { embed: resolve(projectRoot, "embed.html") }
          : {
              main: resolve(projectRoot, "index.html"),
              app: resolve(projectRoot, "app.html"),
              identify: resolve(projectRoot, "identify.html"),
            },
    },
  },
}));
