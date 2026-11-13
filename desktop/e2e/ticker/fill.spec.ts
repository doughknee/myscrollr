import { test, expect } from "@playwright/test";

test("sparse Fill rows occupy the canvas and keep their geometry during data refresh", async ({ page, context }) => {
  await context.clock.install();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/ticker-shim.html?fixture=pages&pages=1&fill=grid&utils=clock,weather&weather=demo&pin=sports_nfl:Chicago Bears&pin=sports_nfl:Houston Texans&live=1');
  const rows = page.locator('[data-page] [data-display-row]');
  await expect(rows).toHaveCount(3);
  await context.clock.runFor(1000);
  const read = () => rows.evaluateAll(nodes => nodes.map(row => ({
    count: row.children.length,
    boxes: [...row.children].map(cell => {
      const r = cell.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(n => Math.round(n));
    }),
  })));
  const before = await read();
  expect(before.map(r => r.count)).toEqual([3, 2, 2]);
  for (const row of before) {
    expect(row.boxes[0][0]).toBe(0);
    expect(row.boxes.at(-1)![0] + row.boxes.at(-1)![2]).toBe(1920);
  }
  const ids = await page.locator('[data-page] [data-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-item')));
  expect(new Set(ids).size).toBe(7);
  await page.evaluate(() => window.__shimDashboard?.(prev => ({ ...prev, data: { ...prev.data, sports: [] } })));
  await context.clock.runFor(500);
  expect(await read()).toEqual(before);
});

test("a single available game uses one row and one column without copies", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/ticker-shim.html?fixture=onegame&pages=1&fill=grid&utils=');
  await expect(page.locator('[data-page]')).toHaveAttribute('data-grid-columns', '1');
  await expect(page.locator('[data-page] [data-display-row]')).toHaveCount(1);
  await expect(page.locator('[data-page] [data-chip]')).toHaveCount(1);
});

test("header pin markers leave content clear and controls do not move data on idle or focus", async ({ page, context }) => {
  await context.clock.install();
  await page.setViewportSize({ width: 1920, height: 360 });
  await page.goto('/ticker-shim.html?fixture=pages&pages=1&fill=grid&utils=clock,weather&weather=demo&pin=sports_nfl:Chicago Bears&pin=finance_stocks:AAPL');
  const markers = page.locator('[data-pin-indicator]');
  await expect(markers).toHaveCount(2);
  await context.clock.runFor(1000);
  for (const marker of await markers.all()) {
    expect(await marker.evaluate(el => {
      const icon = el.getBoundingClientRect();
      const cell = el.parentElement!;
      return [...cell.querySelectorAll('[data-part$="-name"], [data-part="price"], [data-part="change"]')].every(part => {
        const r = part.getBoundingClientRect();
        return icon.right <= r.left || icon.left >= r.right || icon.bottom <= r.top || icon.top >= r.bottom;
      });
    })).toBe(true);
  }
  const controls = page.locator('[data-fill-controls]');
  const header = page.locator('[data-display-header]');
  const before = await header.boundingBox();
  const actions = await controls.boundingBox();
  await context.clock.runFor(5100);
  expect(await header.boundingBox()).toEqual(before);
  expect(await controls.boundingBox()).toEqual(actions);
  await controls.getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__shimCalls.some(call => call.startsWith('show_app_window')))).toBe(true);
  await controls.getByRole('button', { name: 'Exit full display', exact: true }).click();
  await expect(page.locator('[data-fill-display]')).toHaveCount(0);
});

for (const height of [240, 360]) {
  for (const reading of [100, 150]) {
    test(`sports composition uses short display height ${height} at ${reading}% without overlap`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height });
      await page.goto(`/ticker-shim.html?fixture=pages&pages=1&fill=grid&reading=${reading}&theme=default-light`);
      const games = page.locator('[data-page] [data-chip]').filter({ has: page.locator('[data-part="away-row"]') });
      await expect(games.first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const metrics of await games.evaluateAll(nodes => nodes.map(cell => {
        const box = cell.getBoundingClientRect();
        const rect = (part: string) => cell.querySelector(`[data-part="${part}"]`)!.getBoundingClientRect();
        const away = rect("away-row"), home = rect("home-row"), status = rect("status");
        return {
          rowShare: (away.height + home.height) / box.height,
          ordered: away.bottom <= home.top + 0.5 && home.bottom <= status.top + 0.5,
          footerGap: (box.bottom - status.bottom) / box.height,
          contained: ["away-name", "away-score", "away-record", "home-name", "home-score", "home-record", "status"].every(part => {
            const r = rect(part);
            return r.left >= box.left && r.right <= box.right + 0.5 && r.top >= box.top && r.bottom <= box.bottom + 0.5;
          }),
        };
      }))) {
        expect(metrics.rowShare).toBeGreaterThan(0.6);
        expect(metrics.ordered).toBe(true);
        expect(metrics.footerGap).toBeLessThan(0.1);
        expect(metrics.contained).toBe(true);
      }
    });
  }
}

test("Fill controls remain reachable while idle and wake on movement or focus", async ({
  page,
  context,
}) => {
  await context.clock.install();
  await page.goto("/ticker-shim.html?fixture=pages&pages=1&fill=grid");
  await expect(page.locator("[data-page]")).toHaveCount(1);
  await page.mouse.move(300, 200);
  const controls = page.locator("[data-fill-controls]");
  await expect(controls).toHaveAttribute("data-active", "");
  await context.clock.runFor(5100);
  await expect(controls).not.toHaveAttribute("data-active");
  await expect(controls).toHaveCSS("pointer-events", "auto");
  await expect(page.locator("[data-fill-display]")).not.toHaveCSS(
    "cursor",
    "none",
  );
  await page.mouse.move(301, 200);
  await expect(controls).toHaveAttribute("data-active", "");
  await controls.getByRole("button", { name: "Settings", exact: true }).focus();
  await context.clock.runFor(5100);
  await expect(controls).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-fill-display]")).toHaveCount(0);
});

test("grid uses its canvas for quotes and places saved pins in the header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto("/ticker-shim.html?fixture=googl&pages=1&fill=grid");
  await expect(page.locator('[data-page^="finance_stocks:"]')).toHaveCount(1);
  await expect(page.locator("[data-display-pins]")).toHaveCount(0);
  const shape = await page
    .locator('[data-display-cell="quote"]')
    .first()
    .evaluate((el) => {
      const cell = el.getBoundingClientRect();
      const spark = el
        .querySelector('[data-part="spark"]')!
        .getBoundingClientRect();
      const price = el
        .querySelector('[data-part="price"]')!
        .getBoundingClientRect();
      return {
        chartShare: spark.width / cell.width,
        chartHeight: spark.height,
        belowPrice: spark.top >= price.bottom,
      };
    });
  expect(shape.chartShare).toBeGreaterThan(0.8);
  expect(shape.chartHeight).toBeGreaterThan(80);
  expect(shape.belowPrice).toBe(true);
  const header = await page.locator("[data-display-header]").boundingBox();
  expect(header!.height).toBeLessThan(160);
  await page.goto(
    "/ticker-shim.html?fixture=pages&pages=1&fill=grid&pin=sports_nfl:Chicago Bears",
  );
  await expect(page.locator("[data-display-pins]")).toHaveCount(1);
  await expect(page.locator("[data-display-pins]")).toContainText("Bears");
  await expect(page.locator("[data-display-header] [data-display-pins]")).toHaveCount(1);
});

for (const [width, height] of [[3440, 1440], [1920, 360], [800, 480], [720, 1280], [1080, 1920]]) {
  for (const reading of [100, 150]) {
    test(`header pins fit ${width}x${height} at ${reading}% without a footer`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/ticker-shim.html?fixture=pages&pages=1&fill=grid&reading=${reading}&utils=clock,weather&weather=demo&pin=sports_nfl:Chicago Bears&pin=sports_nfl:Houston Texans&pin=finance_stocks:AAPL`);
      await expect(page.locator("[data-display-grid]")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("[data-page]")).toHaveCount(1);
      const header = (await page.locator("[data-display-header]").boundingBox())!;
      const controls = (await page.locator("[data-fill-controls]").boundingBox())!;
      expect(header.height).toBeLessThan(height * 0.25);
      for (const el of await page.locator('[data-display-header] [data-pin-subject], [data-display-header] [data-edge-utils] > [data-widget]').all()) {
        const box = (await el.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(controls.x + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(header.height + 1);
      }
      const content = (await page.locator("[data-page]").boundingBox())!;
      expect(content.y).toBeCloseTo(header.height, 0);
      expect(content.y + content.height).toBeCloseTo(height, 0);
      const pins = page.locator('[data-display-header] [data-pin-subject]');
      if (width === 3440 && reading === 100) expect(await pins.count()).toBe(3);
      if (width < height) {
        expect(await pins.count()).toBe(0);
        const utilities = page.locator('[data-display-header] [data-edge-utils] > [data-widget]');
        await expect(utilities).toHaveCount(2);
        const first = (await utilities.first().boundingBox())!;
        const last = (await utilities.last().boundingBox())!;
        // The band is 192/560 of this portrait header. No phantom pin gap.
        expect(first.x / width).toBeCloseTo(192 / 560, 2);
        expect(last.x + last.width).toBeCloseTo(controls.x, 0);
      }
    });
  }
}

test("saved header pins return to pages on portrait resize and restore when widened", async ({ page, context }) => {
  await context.clock.install();
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto('/ticker-shim.html?fixture=pages&pages=1&fill=grid&utils=clock,weather&weather=demo&pin=sports_nfl:Chicago Bears');
  await expect(page.locator('[data-display-header] [data-pin-subject]')).toHaveCount(1);
  await page.setViewportSize({ width: 720, height: 1280 });
  await context.clock.runFor(1000);
  await expect(page.locator('[data-display-header] [data-pin-subject]')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await context.clock.runFor(1000);
  await page.locator('[data-seg="sports_nfl"]').click();
  await context.clock.runFor(1000);
  await expect(page.locator('[data-page] [data-pin-subject]').filter({ hasText: 'Bears' })).toHaveCount(1);
  await page.setViewportSize({ width: 3440, height: 1440 });
  await context.clock.runFor(1000);
  await expect(page.locator('[data-display-header] [data-pin-subject]')).toHaveCount(1);
});

test("late pin data keeps neighbouring header cells in place", async ({ page, context }) => {
  await context.clock.install();
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto('/ticker-shim.html?fixture=pages&pages=1&fill=grid&utils=clock,weather&weather=demo&pin=sports_nfl:Chicago Bears&pin=finance_stocks:TEST&live=1');
  const pins = page.locator('[data-display-header] [data-display-pins]');
  await expect(pins.locator('[data-pin-reserved]')).toHaveCount(1);
  const bears = pins.locator('[data-pin-subject]').filter({ hasText: 'Bears' });
  const before = (await bears.boundingBox())!;
  await page.evaluate(() => window.__shimDashboard?.(prev => ({
    ...prev,
    widgets: prev.widgets.map(w => w.widget_type === 'finance_stocks' ? { ...w, config: { ...w.config, symbols: ['AAPL', 'TEST'] } } : w),
    data: { ...prev.data, finance: [...prev.data!.finance as object[], { ...(prev.data!.finance as object[])[0], symbol: 'TEST' }] },
  })));
  await context.clock.runFor(100);
  await expect(pins.locator('[data-pin-reserved]')).toHaveCount(0);
  const after = (await bears.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
});

test("grid context menu uses header capacity and names the right constraint", async ({ page, context }) => {
  await context.clock.install();
  await page.setViewportSize({ width: 720, height: 1280 });
  await page.goto('/ticker-shim.html?fixture=googl&pages=1&fill=grid&utils=clock');
  const quote = page.locator('[data-display-cell="quote"]').first();
  await expect(quote).toBeVisible();
  await page.evaluate(() => {
    const win = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: any) => Promise<any> }; __pinMenu: any[] };
    const original = win.__TAURI_INTERNALS__.invoke;
    win.__pinMenu = [];
    win.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'plugin:menu|new') {
        win.__pinMenu.push(args);
        return [100 + win.__pinMenu.length, `test-${win.__pinMenu.length}`];
      }
      if (cmd.startsWith('plugin:menu|')) return null;
      return original(cmd, args);
    };
  });
  await quote.click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __pinMenu: unknown[] }).__pinMenu))).toContain('Not enough header space');
  await page.setViewportSize({ width: 3440, height: 1440 });
  await context.clock.runFor(1000);
  await page.evaluate(() => { (window as unknown as { __pinMenu: unknown[] }).__pinMenu = []; });
  await quote.click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __pinMenu: unknown[] }).__pinMenu))).toContain('Pin GOOGL');
});

test("grid ignores header-only pins and refreshes a visible quote in place", async ({ page, context }) => {
  await context.clock.install();
  await page.goto("/ticker-shim.html?fixture=googl&pages=1&fill=grid&pin=clock:clock&utils=clock&live=1");
  const cell = page.locator('[data-display-cell="quote"]').filter({ hasText: "GOOGL" }).first();
  await expect(cell).toBeVisible();
  await expect(page.locator("[data-display-pins]")).toHaveCount(0);
  const visit = await page.locator("[data-page]").getAttribute("data-visit");
  await page.evaluate(() => window.__shimDashboard?.(prev => ({
    ...prev, data: { ...prev.data, finance: (prev.data!.finance as { symbol: string; price: number }[]).map(t => t.symbol === "GOOGL" ? { ...t, price: 432.10 } : t) },
  })));
  await context.clock.runFor(100);
  await expect(cell.locator('[data-part="price"]')).toContainText("432.10");
  await expect(page.locator("[data-page]")).toHaveAttribute("data-visit", visit!);
  await cell.click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __shimCalls: string[] }).__shimCalls.some(call => call.startsWith("open_external")),
  )).toBe(true);
});

test("previous grid pages enter from the left", async ({ page, context }) => {
  await context.clock.install();
  await page.goto("/ticker-shim.html?fixture=pages&pages=1&fill=grid");
  await expect(page.locator("[data-page]")).toHaveCount(1);
  await context.clock.runFor(1000);
  await page.keyboard.press("ArrowUp");
  await context.clock.runFor(100);
  const positions = await page.locator("[data-page]").evaluateAll(nodes => nodes.map(node =>
    new DOMMatrixReadOnly(getComputedStyle(node).transform).m41,
  ));
  expect(positions).toHaveLength(2);
  expect(positions[0]).toBeGreaterThan(0);
  expect(positions[1]).toBeLessThan(0);
});

test("continuous strip keeps overflowing pins accessible without blocking its tape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto(
    "/ticker-shim.html?fixture=pinned-far&fill=strip&pin=sports_mlb:Chicago Cubs&pin=sports_mlb:Pittsburgh Pirates&pin=sports_mlb:Cleveland Guardians&pin=sports_mlb:Milwaukee Brewers",
  );
  await expect(page.locator(".ticker-container")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.locator(".ticker-container").evaluate((el) => {
        const width = el.getBoundingClientRect().width;
        const fixed = [...el.querySelectorAll(".ticker-pinned-zone")].reduce(
          (sum, zone) => sum + zone.getBoundingClientRect().width,
          0,
        );
        return fixed / width;
      }),
    )
    .toBeLessThanOrEqual(0.4);
  // The far-future pin must bypass the normal horizon even when it moves
  // onto this display's tape. Keeping only the normal pool would lose it.
  await expect(page.locator(".ticker-scroll-wrapper")).toContainText(
    "Milwaukee Brewers",
  );
  await page.setViewportSize({ width: 8000, height: 160 });
  await expect(page.locator(".ticker-pinned-zone")).toContainText([
    "Chicago Cubs",
  ]);
  await page.setViewportSize({ width: 1080, height: 1920 });
  await expect(page.locator(".ticker-pinned-zone")).toHaveCount(0);
  await expect(page.locator(".ticker-scroll-wrapper")).toContainText(
    "Milwaukee Brewers",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".ticker-pinned-zone")).toContainText([
    "Milwaukee Brewers",
  ]);
});

for (const [width, height] of [
  [1920, 360],
  [1920, 1080],
  [1080, 1920],
  [800, 480],
]) {
  for (const mode of ["grid", "strip"]) {
    test(`${mode} fits ${width}x${height} and Escape restores docking`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(
        `/ticker-shim.html?fixture=pages&pages=1&fill=${mode}&theme=default-dark`,
      );
      await expect(page.locator("[data-page]")).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page
            .locator("[data-page]")
            .evaluate((el) => getComputedStyle(el).transform),
        )
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
      const bounds = await page.locator("[data-pages]").boundingBox();
      expect(bounds!.x).toBeCloseTo(0);
      const controls = (await page.locator("[data-fill-controls]").boundingBox())!;
      expect(bounds!.width + (mode === "strip" ? controls.width : 0)).toBeCloseTo(width, 0);
      if (mode === "strip") expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(controls.x + 1);
      expect(bounds!.height).toBeLessThanOrEqual(height + 1);
      if (mode === "grid") {
        expect(bounds!.height).toBeCloseTo(height, 0);
        for (const box of await page
          .locator("[data-display-header] [data-edge]")
          .evaluateAll((nodes) =>
            nodes.map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, bottom: r.bottom };
            }),
          )) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width + 1);
          expect(box.bottom).toBeLessThanOrEqual(height);
        }
        for (const box of await page
          .locator(
            '[data-page] [data-part="status"], [data-page] [data-part$="-score"]',
          )
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
            }),
          )) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width + 1);
          expect(box.bottom).toBeLessThanOrEqual(height + 1);
        }
      }
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-fill-display]")).toHaveCount(0);
      await expect(page.locator("[data-pages]")).toHaveCSS("height", "64px");
    });
  }
}

test("a filled primary cannot drive or hold a docked secondary's pages", async ({
  context,
}) => {
  const fill = await context.newPage();
  const dock = await context.newPage();
  await fill.goto(
    "/ticker-shim.html?fixture=pages&pages=1&fill=grid&label=ticker",
  );
  await dock.goto(
    "/ticker-shim.html?fixture=pages&pages=1&label=ticker-2&leader=1",
  );
  await expect(fill.locator("[data-page]")).toHaveCount(1);
  await expect(dock.locator("[data-page]")).toHaveCount(1);
  const original = await dock.locator("[data-page]").getAttribute("data-page");
  await fill.keyboard.press("ArrowDown");
  await expect(fill.locator("[data-page]").last()).not.toHaveAttribute(
    "data-page",
    original!,
  );
  await expect(dock.locator("[data-page]")).toHaveAttribute(
    "data-page",
    original!,
  );
  const measurements = await fill.evaluate(async () => {
    // @ts-expect-error Vite resolves the browser module.
    const { currentEdgeRoom } = await import("/src/lib/edgeMeasure.ts");
    return currentEdgeRoom();
  });
  expect(measurements?.bar).toBe(1280);
});

for (const change of ["fill", "removed"]) {
  test(`a hovered docked follower releases the leader when ${change}`, async ({ page, context }) => {
    await context.clock.install();
    await page.goto("/ticker-shim.html?fixture=pages&pages=1&label=ticker");
    await page.mouse.move(600, 700);
    await expect(page.locator("[data-page]")).toHaveCount(1, { timeout: 15000 });
    const follower = await context.newPage();
    await follower.goto("/ticker-shim.html?fixture=pages&pages=1&label=ticker-2");
    await context.clock.runFor(1000);
    await expect(follower.locator("[data-page]")).toHaveCount(1);
    await follower.mouse.move(400, 30);
    await context.clock.runFor(100);
    const before = await page.locator("[data-page]").getAttribute("data-visit");
    if (change === "fill") {
      await follower.evaluate(async () => {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<any> } }).__TAURI_INTERNALS__;
        const original = bridge.invoke;
        bridge.invoke = async (cmd, args) => {
          const value = await original(cmd, args);
          return cmd === "ticker_display" ? { ...value, mode: "grid" } : value;
        };
        await original("plugin:event|emit_to", { event: "ticker-reposition", payload: null, target: { kind: "WebviewWindow", label: "ticker-2" } });
      });
      await context.clock.runFor(1000);
      await expect(follower.locator("[data-fill-display]")).toHaveAttribute("data-fill-display", "grid");
    } else {
      await follower.close();
      await page.evaluate(async () => {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
        await bridge.invoke("plugin:event|emit", { event: "ticker-windows-changed", payload: ["ticker"] });
      });
    }
    await context.clock.runFor(14000);
    await expect(page.locator("[data-page]").last()).not.toHaveAttribute("data-visit", before!);
  });
}

for (const [width, height] of [[720, 1280], [1920, 360]]) {
  for (const reading of [100, 150]) {
  for (const fixture of ["empty", "off"]) {
    test(`grid ${fixture} recovery actions fit ${width}x${height} at ${reading}%`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/ticker-shim.html?fixture=${fixture}&pages=1&fill=grid&utils=&reading=${reading}`);
      const empty = page.locator("[data-empty]");
      await expect(empty).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const bounds = (await empty.boundingBox())!;
      expect(bounds.height).toBeCloseTo(height, 0);
      const actions = empty.getByRole("button");
      expect(await actions.count()).toBeGreaterThan(0);
      for (const button of await actions.all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      }
      await actions.first().click();
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { __shimCalls: string[] }).__shimCalls.filter(call => call.startsWith("show_app_window")).length,
      )).toBeGreaterThan(0);
    });
  }
  }
}

for (const fixture of ["busy", "longnames", "quiet"]) {
  test(`largest grid handles ${fixture}, reduced motion and viewport changes`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1920, height: 360 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `/ticker-shim.html?fixture=${fixture}&pages=1&fill=grid&reading=150&weather=1&zones=America/Chicago,Europe/London,Asia/Tokyo`,
    );
    await expect(page.locator("[data-display-grid]")).toBeVisible();
    await expect(page.locator("[data-display-grid]")).toHaveAttribute(
      "data-motion-style",
      "fade",
    );
    await page.setViewportSize({ width: 1080, height: 1920 });
    await expect
      .poll(async () =>
        Math.round(
          (await page.locator("[data-display-grid]").boundingBox())!.height,
        ),
      )
      .toBe(1920);
    await expect(page.locator("[data-fill-controls]")).not.toHaveAttribute("data-active", { timeout: 8000 });
    expect(errors).toEqual([]);
  });
}
