/**
 * Playwright verification for the News/RSS widget bar + Feeds view
 * (in-widget config pass, PR 3). Drives the rss preview harness at
 * 1440 / 960 / 720 / 375.
 *
 * Run with the vite dev server on :5174:
 *   node desktop/scripts/verify-rss.mjs
 *
 * Note: window select + Feeds view are asserted render-only — their writes ride
 * useChannelConfig (authenticated API mutation), which a plain browser
 * can't exercise. showAll / filters / sort are pure client state and
 * are exercised for real.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5174/src/channels/rss/preview/index.html";
const OUT = process.env.UI_REVIEW_OUT ?? "ui-review-out";
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const ROW = ".grid a"; // RssArticle anchors

function watchConsole(page, consoleErrors) {
  const benign = /Failed to load resource|Store write failed|Token unavailable/;
  page.on("console", (msg) => {
    if (msg.type() === "error" && !benign.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
}

async function newPage(browser, width, height, query = "") {
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleErrors = [];
  watchConsole(page, consoleErrors);
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector(ROW);
  return { page, consoleErrors };
}

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ════ 1440px — bar anatomy + filters (rss_custom) ════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · bar anatomy (rss_custom) ==");

    check("view switch renders", (await page.locator('[aria-label="News view"] [role="tab"]').count()) === 2);
    check("sort menu present", (await page.locator('[aria-label="Sort articles"]').count()) === 1);
    check("sources menu present", (await page.locator('[aria-label="Filter by source"]').count()) === 1);
    check("category menu present", (await page.locator('[aria-label="Filter by category"]').count()) === 1);
    check("window select present", (await page.locator('[aria-label="Article time window"]').count()) === 1);
    const bodyText = await page.locator("#root").innerText();
    check("old limit band gone (footer only)", !bodyText.includes("Showing 5 per source"));
    const rowsAll = await page.locator(ROW).count();
    check("article rows render", rowsAll >= 20, `rows=${rowsAll}`);
    await page.screenshot({ path: `${OUT}/rss-01-bar-1440.png` });

    // Per-source cap → footer "Show all" reveals; inverse restores.
    const showAllBtn = page.locator('button:has-text("Show all")');
    check("Show all lives at the list footer", (await showAllBtn.count()) === 1);
    await showAllBtn.click();
    await page.waitForTimeout(200);
    const rowsExpanded = await page.locator(ROW).count();
    check("Show all reveals hidden articles", rowsExpanded > rowsAll, `${rowsAll} -> ${rowsExpanded}`);
    const limitBtn = page.locator('button:has-text("Limit to 5 per source")');
    check("limit affordance replaces it", (await limitBtn.count()) === 1);
    await limitBtn.click();
    await page.waitForTimeout(200);
    check("limit restores the cap", (await page.locator(ROW).count()) === rowsAll);

    // Sources menu: counts, multi-select stays open, filters rows.
    await page.locator('[aria-label="Filter by source"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250);
    const srcRows = await page.locator('[role="menu"] [role="menuitemcheckbox"]').allTextContents();
    check("source rows carry counts", srcRows.length >= 5 && srcRows.every((t) => /\d/.test(t)), srcRows.join(","));
    await page.locator('[role="menu"] [role="menuitemcheckbox"]:has-text("BBC News")').click();
    check("menu stays open after toggle", (await page.locator('[role="menu"]').count()) === 1);
    await page.waitForTimeout(200);
    const bbcRows = await page.locator(ROW).allInnerTexts();
    check(
      "source filter narrows to that source",
      bbcRows.length > 0 && bbcRows.every((t) => t.includes("BBC")),
      `rows=${bbcRows.length}`,
    );
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("All sources")').click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    // Category menu filters via feed categories.
    await page.locator('[aria-label="Filter by category"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.locator('[role="menu"] [role="menuitemcheckbox"]:has-text("Tech")').click();
    await page.waitForTimeout(200);
    const techRows = await page.locator(ROW).allInnerTexts();
    check(
      "category filter narrows to tech feeds",
      techRows.length > 0 && techRows.every((t) => /Verge|Ars|Hacker/i.test(t)),
      `rows=${techRows.length}`,
    );
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("All categories")').click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    // Sort: By Source renders group headers with overflow affordances.
    await page.locator('[aria-label="Sort articles"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.locator('[role="menu"] [role="menuitemradio"]:has-text("By Source")').click();
    await page.waitForTimeout(250);
    check("sort menu closes on pick", (await page.locator('[role="menu"]').count()) === 0);
    check("By Source renders group headers", (await page.locator('button:has-text("more")').count()) >= 3);
    await page.screenshot({ path: `${OUT}/rss-02-by-source-1440.png` });

    check("no console errors (bar page)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await page.close();
  }

  // ════ 1440px — sticky pin (bounding box) ═════════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · sticky bar ==");

    const bar = page.locator("div.sticky.top-0");
    check("bar starts un-elevated", !(await bar.getAttribute("class")).includes("backdrop-blur-sm"));
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
    await page.screenshot({ path: `${OUT}/rss-03-sticky-1440.png` });

    check("no console errors (sticky page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — window select (render-only) + Feeds view ══════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · window select + Feeds view ==");

    check(
      "no gear popover remains",
      (await page.locator('[aria-label="News settings"]').count()) === 0,
    );
    await page.locator('[aria-label="Article time window"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250);
    const windowText = (await page.locator('[role="menu"]').innerText()).toUpperCase();
    check(
      "window menu lists the age presets",
      windowText.includes("TODAY") &&
        windowText.includes("3 DAYS") &&
        windowText.includes("WEEK") &&
        windowText.includes("ALL"),
    );
    await page.screenshot({ path: `${OUT}/rss-04-window-1440.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    // Feeds view (rss_custom only): the Configure page's manager, in-feed.
    await page.locator('[role="tab"]:has-text("Feeds")').click();
    await page.waitForSelector('button:has-text("Custom feed")');
    const feedRows = await page.locator('[role="listitem"]').count();
    check("feed manager renders rows", feedRows >= 5, `rows=${feedRows}`);
    check("custom feed is badged", (await page.locator('[role="listitem"]:has-text("My Blog") >> text=custom').count()) === 1);
    check("no tier caps in header", !(await page.locator("#root").innerText()).includes(" / "));
    await page.screenshot({ path: `${OUT}/rss-05-feeds-view-1440.png` });

    await page.locator('[role="tab"]:has-text("Articles")').click();
    await page.waitForSelector(ROW);
    check("Articles tab returns to the list", (await page.locator(ROW).count()) > 10);

    check("no console errors (window/feeds page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — curated single-feed widget (news_bbc) ═════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900, "?widget=news_bbc");
    console.log("== 1440px · curated widget (news_bbc) ==");

    check("NO view switch (intrinsic feed)", (await page.locator('[aria-label="News view"]').count()) === 0);
    check("NO sources menu (single source)", (await page.locator('[aria-label="Filter by source"]').count()) === 0);
    check(
      "NO categories menu (single category — the NASA case)",
      (await page.locator('[aria-label="Filter by category"]').count()) === 0,
    );
    check("window select still present", (await page.locator('[aria-label="Article time window"]').count()) === 1);
    const rows = await page.locator(ROW).allInnerTexts();
    check("scoped to the widget's feed", rows.length > 0 && rows.every((t) => t.includes("BBC")), `rows=${rows.length}`);
    await page.screenshot({ path: `${OUT}/rss-06-curated-1440.png` });

    check("no console errors (curated page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ Narrow widths ══════════════════════════════════════════════
  // The rss cluster is light: inline menus hold to @2xl (672px
  // container) and collapse into the Filter button below it.
  for (const { width, collapsed } of [
    { width: 960, collapsed: false },
    { width: 720, collapsed: false },
    { width: 375, collapsed: true },
  ]) {
    const { page, consoleErrors } = await newPage(browser, width, 812);
    console.log(`== ${width}px · ${collapsed ? "collapsed" : "inline"} controls ==`);

    const clipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`no horizontal clipping at ${width}`, !clipped);

    if (collapsed) {
      check(`inline menus hidden at ${width}`, !(await page.locator('[aria-label="Sort articles"]').isVisible()));
      const filterBtn = page.locator('[aria-label="Filters"]');
      check(`filter button visible at ${width}`, await filterBtn.isVisible());
      await filterBtn.click();
      await page.waitForSelector('[role="menu"]');
      await page.waitForTimeout(250);
      const menuText = (await page.locator('[role="menu"]').innerText()).toUpperCase();
      check(
        `menu lists Sort/Sources/Category at ${width}`,
        menuText.includes("SORT") && menuText.includes("SOURCES") && menuText.includes("CATEGORY"),
      );
      const menuBox = await page.locator('[role="menu"]').boundingBox();
      check(
        `menu fits inside the viewport at ${width}`,
        menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width,
        JSON.stringify(menuBox),
      );
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${OUT}/rss-07-collapsed-${width}.png` });
    } else {
      check(`inline menus visible at ${width}`, await page.locator('[aria-label="Sort articles"]').isVisible());
      check(`no filter button at ${width}`, !(await page.locator('[aria-label="Filters"]').isVisible()));
    }

    check(`no console errors (${width})`, consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
