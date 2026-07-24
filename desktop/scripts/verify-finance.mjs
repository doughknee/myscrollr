/**
 * Playwright verification for the finance widget bar + search-to-add
 * (the Symbols view is folded into the bar search). Drives the finance
 * preview harness
 * (real FeedTab + inline fixture) at 1440 / 960 / 720 / 375.
 *
 * Run with the vite dev server on :5174:
 *   node desktop/scripts/verify-finance.mjs
 * (needs `npm i playwright` somewhere on the resolve path; uses system Edge)
 */
import { chromium } from "playwright";
import { OUT, check, pageFactory, finish } from "./harness.mjs";

const BASE = "http://localhost:5174/src/datawidgets/finance/preview/index.html";

const ROW = ".grid a"; // TradeItem anchors
const SEARCH = '[aria-label="Search symbols"]';

const newPage = pageFactory(BASE, ROW, /Token unavailable/);

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ════ 1440px — bar anatomy + filters ═════════════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · bar anatomy ==");

    check(
      "no view switch (Symbols view is gone)",
      (await page.locator('[aria-label="Finance view"]').count()) === 0,
    );
    check("direction pills visible", await page.locator('button:has-text("Gainers")').first().isVisible());
    check("sort menu present", (await page.locator('[aria-label="Sort symbols"]').count()) === 1);
    check("category menu present", (await page.locator('[aria-label="Filter by category"]').count()) === 1);
    check("search present", (await page.locator(SEARCH).count()) === 1);
    check(
      "no gear (nothing left to configure — sort persists from the bar)",
      (await page.locator('[aria-label="Finance settings"]').count()) === 0,
    );
    check("no chips/counts bands (one bar only)", (await page.locator("text=/\\d+ up/").count()) === 0);
    const rowsAll = await page.locator(ROW).count();
    check("feed rows render", rowsAll > 10, `rows=${rowsAll}`);
    await page.screenshot({ path: `${OUT}/fin-01-bar-1440.png` });

    // Direction filter: every visible row is a loser (counts are capped
    // by the 20-row page, so assert content, not count).
    await page.locator('button:has-text("Losers")').first().click();
    await page.waitForTimeout(200);
    const loserRows = await page.locator(ROW).allInnerTexts();
    check(
      "Losers filter shows only losers",
      loserRows.length > 0 && loserRows.every((t) => t.includes("-")),
      `rows=${loserRows.length}`,
    );
    await page.locator('button:has-text("All")').first().click();
    await page.waitForTimeout(200);

    // Category menu: counts in rows, multi-select stays open.
    const catTrigger = page.locator('[aria-label="Filter by category"]');
    await catTrigger.click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250);
    const catRows = await page.locator('[role="menu"] [role="menuitemcheckbox"]').count();
    check("category rows listed", catRows >= 4, `rows=${catRows}`);
    const firstRowText = await page.locator('[role="menu"] [role="menuitemcheckbox"]').first().innerText();
    check("category rows carry counts", /\d/.test(firstRowText), firstRowText);
    await page.locator('[role="menu"] [role="menuitemcheckbox"]:has-text("Tech")').click();
    check("menu stays open after toggle", (await page.locator('[role="menu"]').count()) === 1);
    await page.waitForTimeout(200);
    const techRows = await page.locator(ROW).allInnerTexts();
    check(
      "category filter shows only that category",
      techRows.length > 0 && techRows.every((t) => t.includes("Tech")),
      `rows=${techRows.length}`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Esc closes category menu", (await page.locator('[role="menu"]').count()) === 0);
    await page.screenshot({ path: `${OUT}/fin-02-category-1440.png` });
    await catTrigger.click();
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("All categories")').click();
    await page.keyboard.press("Escape");

    // Sort menu switches ordering.
    await page.locator('[aria-label="Sort symbols"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("% Change")').click();
    await page.waitForTimeout(250);
    check("sort menu closes on pick", (await page.locator('[role="menu"]').count()) === 0);
    const firstPct = await page.locator(ROW).first().innerText();
    check("sort by % puts a gainer first", firstPct.includes("+"), firstPct.replace(/\n/g, " | "));

    // Search: plain substring on symbol.
    await page.click(SEARCH);
    await page.keyboard.type("TSLA", { delay: 0 });
    await page.waitForTimeout(250);
    const searchRows = await page.locator(ROW).allInnerTexts();
    check(
      "search narrows to matching symbols",
      searchRows.length > 0 &&
        searchRows.length < rowsAll &&
        searchRows.every((t) => t.includes("TSLA")),
      `rows=${searchRows.length}`,
    );
    await page.keyboard.press("Escape");
    check("first Esc clears query", (await page.inputValue(SEARCH)) === "");
    await page.keyboard.press("Escape");
    check("second Esc blurs", await page.locator(SEARCH).evaluate((el) => document.activeElement !== el));

    check("no console errors (bar page)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await page.close();
  }

  // ════ 1440px — sticky pin (bounding box, not classlist) ══════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · sticky bar ==");

    const bar = page.locator("div.sticky.top-0");
    check("bar starts un-elevated", !(await bar.getAttribute("class")).includes("backdrop-blur-sm"));

    // Render the whole list so there is real scroll travel, then reset
    // to the top before measuring (Load more leaves the page scrolled).
    for (let i = 0; i < 10; i++) {
      const more = page.locator('button:has-text("Load more")');
      if ((await more.count()) === 0) break;
      await more.click();
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 0;
    });
    await page.waitForTimeout(250);
    const rowBefore = await page.locator(ROW).first().boundingBox();

    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 400;
    });
    await page.waitForTimeout(250);

    const barBox = await bar.boundingBox();
    const rowAfter = await page.locator(ROW).first().boundingBox();
    check(
      "bar pins while content scrolls ≥300px",
      barBox && barBox.y <= 1 && rowBefore && rowAfter && rowAfter.y < rowBefore.y - 300,
      `bar.y=${barBox?.y} row ${rowBefore?.y}->${rowAfter?.y}`,
    );
    check("bar elevates once stuck", (await bar.getAttribute("class")).includes("backdrop-blur-sm"));
    await page.screenshot({ path: `${OUT}/fin-03-sticky-1440.png` });

    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 0;
    });
    await page.waitForTimeout(250);
    check("elevation clears at top", !(await bar.getAttribute("class")).includes("backdrop-blur-sm"));

    check("no console errors (sticky page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — sticky sort (2026-07-17 unification) ══════════════
  // The bar's sort choice also writes dp.defaultSort; here we assert
  // the choice survives a search interaction and keeps ordering the feed.
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · sticky sort ==");

    await page.locator('[aria-label="Sort symbols"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("% Change")').click();
    await page.waitForTimeout(250);
    await page.locator(SEARCH).fill("AAPL");
    await page.waitForTimeout(250);
    await page.locator(SEARCH).fill("");
    await page.waitForTimeout(250);
    const sortLabel = await page.locator('[aria-label="Sort symbols"]').innerText();
    check("sort survives a search round-trip", sortLabel.includes("% Change"), sortLabel);
    const firstRow = await page.locator(ROW).first().innerText();
    check("feed still sorted by % change", firstRow.includes("+"), firstRow.split(String.fromCharCode(10)).join(" | "));

    check("no console errors (sticky-sort page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — search-to-add (render-only; writes ride the same
  // useChannelConfig mutation the Symbols view used) ═════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · search-to-add ==");

    // NVDA is in the catalog but not in the tracked config: an Add row.
    await page.locator(SEARCH).fill("NVDA");
    await page.waitForTimeout(300);
    const addBtns = await page.locator('button:has-text("+ Add")').count();
    check("untracked catalog match shows an Add action", addBtns >= 1, `addBtns=${addBtns}`);

    // AAPL is tracked: a Remove row.
    await page.locator(SEARCH).fill("AAPL");
    await page.waitForTimeout(300);
    const removeBtns = await page.locator('button:has-text("Remove")').count();
    check("tracked catalog match shows a Remove action", removeBtns >= 1, `removeBtns=${removeBtns}`);

    // Crypto is scoped out of the stocks widget's matches.
    await page.locator(SEARCH).fill("BTC");
    await page.waitForTimeout(300);
    const bodyText = await page.locator("#root").innerText();
    check("crypto scoped out (stocks widget)", !bodyText.includes("BTC/USD"));

    await page.locator(SEARCH).fill("NVDA");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/fin-06-search-add-1440.png` });

    check("no console errors (search-add page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ Narrow widths — collapse-before-clip ═══════════════════════
  for (const width of [960, 720, 375]) {
    const { page, consoleErrors } = await newPage(browser, width, 812);
    console.log(`== ${width}px · collapsed filters ==`);

    check(`pills hidden at ${width}`, !(await page.locator('button:has-text("Gainers")').first().isVisible()));
    const filterBtn = page.locator('[aria-label="Filters"]');
    check(`filter button visible at ${width}`, await filterBtn.isVisible());
    const clipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`no horizontal clipping at ${width}`, !clipped);

    await filterBtn.click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250);
    // innerText reflects the CSS uppercase transform on headings.
    const menuText = (await page.locator('[role="menu"]').innerText()).toUpperCase();
    check(
      `menu lists Direction/Sort/Category at ${width}`,
      menuText.includes("DIRECTION") && menuText.includes("SORT") && menuText.includes("CATEGORY"),
    );
    const menuBox = await page.locator('[role="menu"]').boundingBox();
    check(
      `menu fits inside the viewport at ${width}`,
      menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width,
      JSON.stringify(menuBox),
    );
    await page.keyboard.press("Escape");
    if (width === 375) await page.screenshot({ path: `${OUT}/fin-07-collapsed-375.png` });

    check(`no console errors (${width})`, consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  await finish(browser);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
