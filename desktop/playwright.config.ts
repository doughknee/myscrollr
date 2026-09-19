import { defineConfig } from "@playwright/test";

/**
 * Browser checks against the ticker shim (SCROLLR-227). These see what
 * jsdom cannot: motion, layout width, rotation over real laps. Run with
 * `npm run test:browser`; deliberately NOT part of `npm test`.
 *
 * Locally the Edge already on the machine is driven (channel "msedge");
 * CI installs its own Chromium (`npx playwright install --with-deps chromium`).
 */
const ci = !!process.env.CI;
// Fixed port unless overridden: a parallel worktree's vite on 5180 would be
// reused (`reuseExistingServer`) and serve ITS fixtures, not this checkout's.
const port = Number(process.env.SHIM_PORT) || 5180;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  webServer: {
    command: `npx vite --port ${port}`,
    url: `http://localhost:${port}/ticker-shim.html`,
    reuseExistingServer: !ci,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    ci
      ? { name: "chromium", use: { browserName: "chromium" } }
      : { name: "msedge", use: { browserName: "chromium", channel: "msedge" } },
  ],
});
