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

/**
 * CI runs the suite as three parallel jobs (SCROLLR-289): the real-time
 * continuous-bar laps (coverage; width + rule6) are the long poles, so each
 * gets a job and `rest` is everything else BY COMPLEMENT, so a new spec file
 * can never fall between the slices. Unset runs it all (the local default).
 */
// Five slices, balanced by CI time (2 Oct 2026: rest alone was 14 min; the
// pages laps are its long pole, the themes sweep its second).
const SLICES: Record<string, RegExp> = { coverage: /coverage\.spec/, rail: /(width|rule6)\.spec/, pages: /\/pages\.spec/, themes: /pages-themes\.spec/ };
const slice = process.env.SPEC_SLICE;
if (slice && slice !== "rest" && !SLICES[slice]) throw new Error(`SPEC_SLICE=${slice}: expected ${Object.keys(SLICES).join(", ")} or rest`);

export default defineConfig({
  testDir: "e2e",
  testMatch: slice && slice !== "rest" ? SLICES[slice] : undefined,
  testIgnore: slice === "rest" ? Object.values(SLICES) : undefined,
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
