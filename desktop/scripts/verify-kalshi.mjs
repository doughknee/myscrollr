/**
 * Playwright verification for the Kalshi channel version-bump pass
 * (A1 fallbacks, A2 positions, B1 card targets, B2 +N more, B3 time
 * indicators, B4 sticky/collapsed filters, B5 category select).
 *
 * Drives the channel preview harness (real FeedTab + fixture + Tauri-bridge
 * mock) at 1440px / 720px / 375px. `?demo=1` injects the states today's
 * payload can't produce (LIVE, Starts-in, >2 legs, served candles) — see
 * docs/kalshi-ui-review-notes.md. Run with the vite dev server on :5174:
 *   node desktop/scripts/verify-kalshi.mjs  (needs `npm i playwright` somewhere on the resolve path)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5174/src/datawidgets/predictions/preview/index.html";
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

const CARD = '[role="button"][aria-label^="Open "]';
const DIALOG = '[role="dialog"]';
const SEARCH_INPUT = '[aria-label="Search markets"]';

function watchConsole(page, consoleErrors) {
  const benign = /Failed to load resource|Store write failed|mock: unhandled command|Token unavailable/;
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
  await page.waitForSelector("[data-section-title]");
  return { page, consoleErrors };
}

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ════ 1440px — B1 interaction targets ═══════════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · B1 card targets ==");

    const card = page.locator(CARD).first();
    await card.hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/vb-01-card-hover-1440.png` });

    // Whole-card click opens the detail modal.
    await card.click();
    check("whole-card click opens detail", (await page.locator(DIALOG).count()) === 1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    // Star inside the card does NOT open the modal.
    const star = page.locator(`${CARD} [aria-label="Add to watchlist"]`).first();
    await star.click();
    await page.waitForTimeout(150);
    check("star click stays its own target", (await page.locator(DIALOG).count()) === 0);
    const starred = page.locator(`${CARD} [aria-label="Remove from watchlist"]`).first();
    check("star actually toggled", (await starred.count()) === 1);
    await starred.click(); // reset watchlist state

    // An outcome pill opens ITS leg, not the card's lead.
    const secondRow = page.locator(`${CARD} button:has(span.text-ui-meta)`).nth(1);
    const rowLabel = (await secondRow.locator("span").first().innerText()).trim();
    await secondRow.click();
    const dialogText = await page.locator(DIALOG).innerText();
    check(
      "outcome row opens its own leg",
      dialogText.includes(rowLabel) || rowLabel === "No",
      `row="${rowLabel}"`,
    );
    await page.keyboard.press("Escape");

    // Keyboard: focused card opens on Enter.
    await page.locator(CARD).first().focus();
    await page.keyboard.press("Enter");
    check("Enter on focused card opens detail", (await page.locator(DIALOG).count()) === 1);
    await page.keyboard.press("Escape");

    // Section header row is fully clickable → category focus.
    const header = page.locator('button[aria-label^="View all "]').first();
    const headerCat = (await header.locator("[data-section-title]").innerText()).trim();
    await header.hover();
    await page.screenshot({ path: `${OUT}/vb-02-header-hover-1440.png` });
    // Hover surface must not touch the cards below (mb gap).
    const headerBox = await header.boundingBox();
    const firstCardBox = await page.locator(CARD).first().boundingBox();
    check(
      "header hover surface clears the cards",
      headerBox && firstCardBox && firstCardBox.y - (headerBox.y + headerBox.height) >= 3,
      `gap=${firstCardBox && headerBox ? firstCardBox.y - (headerBox.y + headerBox.height) : "?"}`,
    );
    await header.click();
    await page.waitForTimeout(300);
    const catTrigger = page.locator('button[aria-label="Filter by category"]');
    check(
      "header click focuses its category",
      (await catTrigger.innerText()).trim().toUpperCase() === headerCat.toUpperCase(),
      `trigger="${await catTrigger.innerText()}" header="${headerCat}"`,
    );
    check("category focus flattens sections", (await page.locator("[data-section-title]").count()) === 0);
    await page.screenshot({ path: `${OUT}/vb-03-category-focus-1440.png` });

    check("no console errors (B1 page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — B5 category menu (multi-select) × search ═════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · B5 category menu × search ==");

    const trigger = page.locator('button[aria-label="Filter by category"]');
    const rowsSel = '[role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitemcheckbox"]';

    await trigger.click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250); // entrance animation settles
    const rows = await page.locator(rowsSel).allTextContents();
    check("menu lists All + data categories", rows.length > 6 && rows[0] === "All categories", rows.join(","));
    check(
      "menu panel is rounded (not the OS square)",
      (await page.locator('[role="menu"]').evaluate((el) => getComputedStyle(el).borderRadius)) !== "0px",
    );
    await page.screenshot({ path: `${OUT}/vb-04a-category-menu-1440.png` });

    // Multi-select: Sports + Crypto combine, menu STAYS OPEN between picks.
    await page.locator('[role="menuitemcheckbox"]:has-text("Sports")').click();
    check("menu stays open after a toggle", (await page.locator('[role="menu"]').count()) === 1);
    const sportsOnly = await page.locator(CARD).count();
    await page.locator('[role="menuitemcheckbox"]:has-text("Crypto")').click();
    await page.waitForTimeout(300);
    const both = await page.locator(CARD).count();
    check("multi-select combines categories", both >= sportsOnly && both > 0, `${sportsOnly} -> ${both}`);
    check("trigger shows the selection count", (await trigger.innerText()).includes("2 categories"));
    check("sections collapse under a category filter", (await page.locator("[data-section-title]").count()) === 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Esc closes the category menu", (await page.locator('[role="menu"]').count()) === 0);
    await page.screenshot({ path: `${OUT}/vb-04b-category-multi-1440.png` });

    // Composes with search inside the category union.
    await page.click(SEARCH_INPUT);
    await page.keyboard.type("world cup", { delay: 0 });
    await page.waitForTimeout(400);
    const combined = await page.locator(CARD).count();
    check("search composes within categories", combined > 0 && combined <= both, `${both} -> ${combined}`);
    await page.screenshot({ path: `${OUT}/vb-04-category-plus-search-1440.png` });
    await page.fill(SEARCH_INPUT, "");

    // Options identical across lenses (stable category universe).
    await trigger.click();
    await page.waitForTimeout(250);
    const optionsTrending = await page.locator(rowsSel).allTextContents();
    await page.keyboard.press("Escape");
    await page.locator('button:has-text("Resolved")').first().click();
    await page.waitForTimeout(250);
    await trigger.click();
    await page.waitForTimeout(250);
    const optionsResolved = await page.locator(rowsSel).allTextContents();
    await page.keyboard.press("Escape");
    check(
      "category options stable across lenses",
      JSON.stringify(optionsResolved) === JSON.stringify(optionsTrending),
      `trending=${optionsTrending.length} resolved=${optionsResolved.length}`,
    );
    await page.locator('button:has-text("Trending")').first().click();
    await page.waitForTimeout(250);

    // "All categories" clears back to section browse.
    await trigger.click();
    await page.locator('[role="menuitemradio"]:has-text("All categories")').click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("All restores section browse", (await page.locator("[data-section-title]").count()) > 0);

    // Focus ring follows the pill radius (global rule inherits the
    // PARENT's border-radius — a square wrapper drew a rectangle).
    await trigger.focus();
    const focusRadius = await trigger.evaluate((el) => getComputedStyle(el).borderRadius);
    check("focused trigger keeps its rounded shape", focusRadius !== "0px", `border-radius=${focusRadius}`);

    check("no console errors (B5 page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — Ticker fallback SelectMenu (the gear is retired) ══
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · ticker fallback select ==");

    const ticker = page.locator('[aria-label="Ticker fallback when nothing is starred"]');
    check("Ticker select renders in the bar", (await ticker.count()) === 1);
    check(
      "no gear popover remains",
      (await page.locator('[aria-label="Predictions settings"]').count()) === 0,
    );
    await ticker.click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(250);

    const menuText = (await page.locator('[role="menu"]').innerText()).toUpperCase();
    check(
      "menu lists the three fallbacks",
      menuText.includes("TRENDING") &&
        menuText.includes("MOVERS") &&
        menuText.includes("CLOSING SOON"),
    );
    await page.screenshot({ path: `${OUT}/vb-18-ticker-select-1440.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Esc closes the menu", (await page.locator('[role="menu"]').count()) === 0);

    check("no console errors (ticker-select page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — B4 sticky elevation ═══════════════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · B4 sticky bar ==");

    const bar = page.locator("div.sticky.top-0");
    const before = await bar.getAttribute("class");
    check("bar starts un-elevated", !before.includes("backdrop-blur-sm"));
    const headerBefore = await page.locator("[data-section-title]").first().boundingBox();

    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 400;
    });
    await page.waitForTimeout(250);

    // The bar must ACTUALLY PIN — its box stays at the scroller top while
    // the content underneath moves. (The original in-app bug passed a
    // classlist-only check: the inner overflow container swallowed sticky.)
    const barBox = await bar.boundingBox();
    const headerAfter = await page.locator("[data-section-title]").first().boundingBox();
    check(
      "bar pins to the top while content scrolls",
      barBox && barBox.y <= 1 && headerBefore && headerAfter && headerAfter.y < headerBefore.y - 300,
      `bar.y=${barBox?.y} header ${headerBefore?.y}->${headerAfter?.y}`,
    );

    const after = await bar.getAttribute("class");
    check("bar elevates once stuck", after.includes("backdrop-blur-sm"));
    await page.screenshot({ path: `${OUT}/vb-05-sticky-elevated-1440.png` });

    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 0;
    });
    await page.waitForTimeout(250);
    const reset = await bar.getAttribute("class");
    check("elevation clears at top", !reset.includes("backdrop-blur-sm"));

    // Regression: switching Markets → Positions → Markets while scrolled
    // must not resurrect the shadow at the top (the observer used to keep
    // watching a detached sentinel, freezing `stuck` at its last value).
    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 400;
    });
    await page.waitForTimeout(250);
    await page.locator('[role="tab"]:has-text("Positions")').click();
    await page.waitForSelector("text=Open positions");
    await page.locator('[role="tab"]:has-text("Markets")').click();
    await page.waitForSelector("[data-section-title]");
    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const afterSwitch = await bar.getAttribute("class");
    check(
      "no stale shadow after a view round-trip",
      !afterSwitch.includes("backdrop-blur-sm"),
    );

    check("no console errors (B4 page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ demo=1 @ 1440px — B3 LIVE/countdown, B2 +N more, A1 chart ══
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900, "?demo=1");
    console.log("== 1440px · demo states (B2/B3/A1) ==");

    const live = page.locator(`${CARD} >> text="Live"`).first();
    check("LIVE badge renders", (await live.count()) === 1);
    const startsIn = page.locator(CARD, { hasText: /Starts in \d/ }).first();
    check("Starts-in countdown renders", (await startsIn.count()) >= 1);
    const more = page.locator('button:has-text("+2 more")').first();
    check("+2 more affordance renders", (await more.count()) === 1);
    await page.screenshot({ path: `${OUT}/vb-06-demo-live-starts-1440.png`, fullPage: false });

    // Reserved width: countdown text box width unchanged across the tick.
    const startsSpan = page.locator('span:has-text("Starts in")').first();
    const w1 = (await startsSpan.boundingBox())?.width;
    await page.waitForTimeout(1500);
    const w2 = (await startsSpan.boundingBox())?.width;
    check("countdown width reserved (no reflow)", w1 === w2, `${w1} vs ${w2}`);

    // +N more opens the detail with ALL outcomes, price-sorted, landing on
    // the top-priced leg (the first row the card showed).
    await more.click();
    await page.waitForSelector(DIALOG);
    const currentFirst = page.locator(`${DIALOG} [aria-current]`);
    check(
      "card/+N opens the top-priced leg",
      (await currentFirst.count()) === 1 &&
        (await page.locator(`${DIALOG} li button`).first().getAttribute("aria-current")) !== null,
    );
    const outcomeRows = page.locator(`${DIALOG} [aria-current], ${DIALOG} li button`);
    const n = await outcomeRows.count();
    check("detail lists all outcomes (4)", n === 4, `got ${n}`);
    const pcts = [];
    for (let i = 0; i < n; i++) {
      const t = await outcomeRows.nth(i).innerText();
      const m = t.match(/(\d+)%/);
      if (m) pcts.push(Number(m[1]));
    }
    const sorted = [...pcts].every((v, i) => i === 0 || pcts[i - 1] >= v);
    check("detail outcomes sorted by price", sorted && pcts.length === 4, pcts.join(","));

    // A1: the history chart renders from served candles.
    const chart = page.locator(`${DIALOG} svg[aria-label^="7-day price history"]`);
    check("history chart renders with data", (await chart.count()) === 1);
    await page.screenshot({ path: `${OUT}/vb-07-detail-all-outcomes-1440.png` });

    // Tapping another outcome switches the modal to that leg.
    await outcomeRows.nth(2).click();
    await page.waitForTimeout(250);
    check(
      "tapping an outcome switches the detail",
      (await page.locator(`${DIALOG} [aria-current]`).count()) === 1 &&
        (await page.locator(`${DIALOG} [aria-current]`).innerText()).includes(
          (pcts[2] ?? "") + "%",
        ),
    );
    await page.keyboard.press("Escape");

    // Dark theme spot-check of the demo states.
    await page.goto(`${BASE}?demo=1&theme=scrollr-dark`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-section-title]");
    await page.screenshot({ path: `${OUT}/vb-08-demo-dark-1440.png` });

    check("no console errors (demo page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ A1 fallback (no demo shim): error state styled ═════════════
  {
    const { page } = await newPage(browser, 1440, 900);
    console.log("== 1440px · A1 fallback states ==");
    await page.locator(CARD).first().click();
    await page.waitForSelector(DIALOG);
    // No API on :18080 in the harness → the query errors → styled fallback.
    await page.waitForSelector(`${DIALOG} >> text=Price history unavailable`, { timeout: 15000 });
    check("error fallback is styled + labeled", true);
    await page.screenshot({ path: `${OUT}/vb-09-chart-error-fallback-1440.png` });
    await page.close();
  }

  // ════ Positions page (mocked open positions) ═════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · A2 positions (mocked) ==");

    const positionsTab = page.locator('[role="tab"]:has-text("Positions")');
    check("view switcher renders in harness (bridge mock)", (await positionsTab.count()) === 1);
    await positionsTab.click();
    await page.waitForSelector("text=Open positions");
    const panel = await page.locator("#root").innerText();
    check("both mocked open positions render", panel.includes("15 contracts") && panel.includes("4 contracts"));
    check("P&L marks to live prices", /[+\-]\$\d/.test(panel));
    check("balance renders", panel.includes("$1,482.50"));
    await page.screenshot({ path: `${OUT}/vb-10-positions-1440.png` });

    check("no console errors (positions page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 375px — B4 collapsed filters + positions ═══════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 375, 812);
    console.log("== 375px · collapsed filters ==");

    check(
      "lens pills hidden at 375",
      !(await page.locator('button:has-text("Closing soon")').first().isVisible()),
    );
    const filterBtn = page.locator('[aria-label="Filters"]');
    check("filter button visible at 375", await filterBtn.isVisible());
    const clipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check("no horizontal clipping at 375", !clipped);
    await page.screenshot({ path: `${OUT}/vb-11-collapsed-idle-375.png` });

    await filterBtn.click();
    await page.waitForSelector('[role="menu"]');
    check(
      "menu marks current view + category",
      (await page.locator('[role="menuitemradio"][aria-checked="true"]').count()) === 2,
    );
    check(
      "selected rows render the check glyph",
      (await page.locator('[role="menu"] svg.lucide-check').count()) === 2,
    );
    const menuBox = await page.locator('[role="menu"]').boundingBox();
    check(
      "menu fits inside the viewport",
      menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 375,
      JSON.stringify(menuBox),
    );
    await page.screenshot({ path: `${OUT}/vb-12-filter-menu-375.png` });

    // Pick a lens + a category from the menu; badge shows 2 active.
    await page.locator('[role="menuitemradio"]:has-text("Movers")').click();
    await page.locator('[role="menuitemcheckbox"]:has-text("Sports")').click();
    await page.waitForTimeout(300);
    const badge = await filterBtn.innerText();
    check("active-filter badge counts 2", badge.trim() === "2", `badge="${badge}"`);
    check("menu picks filter the grid", (await page.locator(CARD).count()) > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250); // exit animation
    check("Esc closes the menu", (await page.locator('[role="menu"]').count()) === 0);
    await page.screenshot({ path: `${OUT}/vb-13-menu-filtered-375.png` });

    // Positions at 375.
    await page.locator('[role="tab"]:has-text("Positions")').click();
    await page.waitForSelector("text=Open positions");
    await page.screenshot({ path: `${OUT}/vb-14-positions-375.png` });

    check("no console errors (375 page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 960px — mid width where pills used to render cut off ═══════
  {
    const { page } = await newPage(browser, 960, 800);
    console.log("== 960px · early collapse ==");
    check(
      "pills collapsed at 960 (no cut-off row)",
      await page.locator('[aria-label="Filters"]').isVisible(),
    );
    check(
      "lens pills hidden at 960",
      !(await page.locator('button:has-text("Closing soon")').first().isVisible()),
    );
    const clipped960 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check("no horizontal clipping at 960", !clipped960);
    await page.screenshot({ path: `${OUT}/vb-17-midwidth-960.png` });
    await page.close();
  }

  // ════ 720px — app minimum channel width ══════════════════════════
  {
    const { page } = await newPage(browser, 720, 800);
    console.log("== 720px · min channel width ==");
    const clipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check("no horizontal clipping at 720", !clipped);
    check("filters collapsed below container 5xl", await page.locator('[aria-label="Filters"]').isVisible());
    await page.screenshot({ path: `${OUT}/vb-15-minwidth-720.png` });
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
