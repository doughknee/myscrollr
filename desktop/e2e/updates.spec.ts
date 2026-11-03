import { test, expect } from "@playwright/test";

// Render the real Settings page/controller, with only OS/network effects replaced.
// No native installer, account, live release feed or on-disk app preferences are touched.
for (const width of [960, 400]) {
  test(`updates survive navigation and recover from restart failure at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 740 });
    await page.route("**/__updates_test__", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/src/style.css"></head><body style="margin:0"><main id="root" style="max-width:768px;padding:24px;margin:auto"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      window.fixtureReady = true;
    </script></body></html>` }));
    await page.goto("/__updates_test__");
    await page.waitForFunction(() => (window as any).fixtureReady);
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { default: React } = await load("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await load("/node_modules/.vite/deps/react-dom_client.js");
      const { updateController } = await load("/src/lib/updateController.ts");
      const { default: Page } = await load("/src/components/settings/pages/UpdatesPage.tsx");
      const fixture = { saved: "stable", installs: 0, downloads: 0, finish: () => {}, restartFails: true, render: (_show: boolean) => {} };
      const candidate = { version: "1.8.0-beta.1", body: "Preview release: improved display layouts and update controls.", close: async () => {},
        download: async (progress: (event: unknown) => void) => { fixture.downloads++;
          progress({ event: "Started", data: { contentLength: 100 } });
          progress({ event: "Progress", data: { chunkLength: 40 } });
          await new Promise<void>(done => { fixture.finish = done; });
        }, install: async () => { fixture.installs++; } };
      updateController.deps = {
        load: async () => ({ version: "1.7.2", channel: fixture.saved, fresh: false }),
        saveChannel: async (channel: string) => { fixture.saved = channel; },
        check: async () => ({ feedVersion: candidate.version, update: candidate }),
        restart: async () => { if (fixture.restartFails) throw new Error("OS refused"); },
      };
      const root = ReactDOM.createRoot(document.getElementById("root"));
      fixture.render = show => root.render(show ? React.createElement(Page) : React.createElement("div", null, "Another settings page"));
      (window as any).updateFixture = fixture;
      fixture.render(true);
    });
    // Release history is unrelated network data and may fail gracefully in this harness.
    await page.getByRole("radio", { name: "Beta", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Beta", exact: true })).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => (window as any).updateFixture.downloads)).toBe(0);
    await page.getByRole("button", { name: "Check now", exact: true }).click();
    await expect(page.getByRole("button", { name: "Download & install" })).toBeVisible();
    await page.waitForTimeout(350); // Let the existing segmented-control spring settle for the screenshot.
    await page.screenshot({ path: info.outputPath(`updates-beta-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Download & install" }).click();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    await page.evaluate(() => (window as any).updateFixture.render(false));
    await expect(page.getByText("Another settings page")).toBeVisible();
    await page.evaluate(() => (window as any).updateFixture.render(true));
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    await expect(page.getByRole("radio", { name: "Stable", exact: true })).toBeDisabled();
    await page.evaluate(() => (window as any).updateFixture.finish());
    await page.getByRole("button", { name: "Restart now" }).click();
    await expect(page.getByRole("alert")).toContainText("already installed");
    await expect(page.getByRole("button", { name: "Restart now" })).toBeVisible();
    expect(await page.evaluate(() => (window as any).updateFixture.downloads)).toBe(1);
  });
}
