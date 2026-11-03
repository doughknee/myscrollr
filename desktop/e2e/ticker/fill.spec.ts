import { test, expect } from "@playwright/test";

test("Fill controls idle without hiding the native pointer and wake on movement or focus", async ({
  page,
  context,
}) => {
  await context.clock.install();
  await page.goto("/ticker-shim.html?fixture=pages&pages=1&fill=grid");
  await expect(page.locator("[data-page]")).toHaveCount(1);
  await page.mouse.move(300, 200);
  const controls = page.locator("[data-fill-controls]");
  await expect(controls).toHaveCSS("opacity", "1");
  await context.clock.runFor(5100);
  await expect(controls).toHaveCSS("opacity", "0");
  await expect(controls).toHaveCSS("pointer-events", "none");
  await expect(page.locator("[data-fill-display]")).not.toHaveCSS(
    "cursor",
    "none",
  );
  await page.mouse.move(301, 200);
  await expect(controls).toHaveCSS("opacity", "1");
  await controls.getByRole("button", { name: "Settings", exact: true }).focus();
  await context.clock.runFor(5100);
  await expect(controls).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-fill-display]")).toHaveCount(0);
});

test("grid uses its canvas for quotes and reserves a footer only for saved pins", async ({
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
      expect(bounds!.width).toBeCloseTo(width, 0);
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
    await expect(page.locator("[data-fill-controls]")).toHaveCSS(
      "opacity",
      "0",
      { timeout: 8000 },
    );
    expect(errors).toEqual([]);
  });
}
