/**
 * Playwright verification for the sports widget bar + gear popover
 * (in-widget config pass, PR 4). Drives the sports preview harness at
 * 1440 / 960 / 720 / 375.
 *
 * Run with the vite dev server on :5174:
 *   node desktop/scripts/verify-sports.mjs
 *
 * Gear contents are asserted render-only (useSportsConfig mutates via
 * the authed API); status pills / tabs are pure client state and are
 * exercised for real.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5174/src/channels/sports/preview/index.html";
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
  await page.waitForSelector('[aria-label="Sports view"]');
  return { page, consoleErrors };
}

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ════ 1440px — bar anatomy + status filter + tabs ════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · bar anatomy ==");

    check("segmented tabs render", (await page.locator('[aria-label="Sports view"] [role="tab"]').count()) === 3);
    check("status pills visible", await page.locator('button:has-text("Upcoming")').first().isVisible());
    check("gear present", (await page.locator('[aria-label="Sports settings"]').count()) === 1);
    check("no league filter (single-league widget)", (await page.locator('button:has-text("Leagues")').count()) === 0);
    await page.screenshot({ path: `${OUT}/sp-01-bar-1440.png` });

    // Status pills narrow the scoreboard.
    const allCards = await page.locator("#root a[href]").count();
    check("score cards render", allCards > 5, `cards=${allCards}`);
    await page.locator('button:has-text("Live")').first().click();
    await page.waitForTimeout(250);
    const liveCards = await page.locator("#root a[href]").count();
    check("Live filter narrows cards", liveCards > 0 && liveCards < allCards, `${allCards} -> ${liveCards}`);
    await page.locator('button:has-text("All")').first().click();
    await page.waitForTimeout(250);

    // Tabs switch; standings hides pills + freshness.
    await page.locator('[role="tab"]:has-text("Schedule")').click();
    await page.waitForTimeout(250);
    check("Schedule tab renders", (await page.locator("#root").innerText()).length > 100);
    check("pills still present on Schedule", await page.locator('button:has-text("Upcoming")').first().isVisible());
    await page.locator('[role="tab"]:has-text("Standings")').click();
    await page.waitForTimeout(250);
    check("pills hidden on Standings", !(await page.locator('button:has-text("Upcoming")').first().isVisible()));
    await page.locator('[role="tab"]:has-text("Scores")').click();
    await page.waitForTimeout(250);

    check("no console errors (bar page)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await page.close();
  }

  // ════ 1440px — sticky pin (bounding box) ═════════════════════════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · sticky bar ==");

    const bar = page.locator("div.sticky.top-0");
    check("bar starts un-elevated", !(await bar.getAttribute("class")).includes("backdrop-blur-sm"));
    const cardBefore = await page.locator("#root a[href]").first().boundingBox();

    await page.evaluate(() => {
      document.querySelector("#root .overflow-y-auto").scrollTop = 400;
    });
    await page.waitForTimeout(250);

    const barBox = await bar.boundingBox();
    const cardAfter = await page.locator("#root a[href]").first().boundingBox();
    check(
      "bar pins while content scrolls ≥300px",
      barBox && barBox.y <= 1 && cardBefore && cardAfter && cardAfter.y < cardBefore.y - 300,
      `bar.y=${barBox?.y} card ${cardBefore?.y}->${cardAfter?.y}`,
    );
    check("bar elevates once stuck", (await bar.getAttribute("class")).includes("backdrop-blur-sm"));
    await page.screenshot({ path: `${OUT}/sp-02-sticky-1440.png` });

    check("no console errors (sticky page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ 1440px — gear popover (the per-league Configure page) ══════
  {
    const { page, consoleErrors } = await newPage(browser, 1440, 900);
    console.log("== 1440px · gear popover ==");

    await page.locator('[aria-label="Sports settings"]').click();
    await page.waitForSelector('[role="menu"]');
    await page.waitForTimeout(300);
    const gearText = (await page.locator('[role="menu"]').innerText()).toUpperCase();
    check(
      "gear lists favorite team + window + display",
      gearText.includes("FAVORITE NFL TEAM") &&
        gearText.includes("TIME WINDOW") &&
        gearText.includes("TEAM LOGOS") &&
        gearText.includes("GAME TIMER"),
    );

    // Teams fetched (from the seeded cache) on first open: the select
    // lists the league's teams with the favorite selected.
    const teamSelect = page.locator('[role="menu"] select[aria-label="Team"]');
    check("team select renders", (await teamSelect.count()) === 1);
    const optionCount = await teamSelect.locator("option").count();
    check("team select lists the league's teams", optionCount === 17, `options=${optionCount}`);
    const selected = await teamSelect.inputValue();
    check("favorite team pre-selected", selected === "1", `value=${selected}`);
    await page.screenshot({ path: `${OUT}/sp-03-gear-1440.png` });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Esc closes the gear", (await page.locator('[role="menu"]').count()) === 0);

    check("no console errors (gear page)", consoleErrors.length === 0, consoleErrors.join(" | "));
    await page.close();
  }

  // ════ Narrow widths — status pills collapse into the Filter menu ═
  for (const width of [960, 720, 375]) {
    const { page, consoleErrors } = await newPage(browser, width, 812);
    console.log(`== ${width}px · collapse ==`);

    const clipped = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`no horizontal clipping at ${width}`, !clipped);

    const collapsed = width < 672 + 24; // @2xl container threshold + px
    if (collapsed) {
      check(`pills hidden at ${width}`, !(await page.locator('button:has-text("Upcoming")').first().isVisible()));
      const filterBtn = page.locator('[aria-label="Filters"]');
      check(`filter button visible at ${width}`, await filterBtn.isVisible());
      await filterBtn.click();
      await page.waitForSelector('[role="menu"]');
      await page.waitForTimeout(250);
      const rows = await page.locator('[role="menu"] [role="menuitemradio"]').allTextContents();
      check(
        `status rows carry counts at ${width}`,
        rows.length === 4 && rows.every((t) => /\d/.test(t)),
        rows.join(","),
      );
      const menuBox = await page.locator('[role="menu"]').boundingBox();
      check(
        `menu fits inside the viewport at ${width}`,
        menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width,
        JSON.stringify(menuBox),
      );
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${OUT}/sp-04-collapsed-${width}.png` });
    } else {
      check(`pills visible at ${width}`, await page.locator('button:has-text("Upcoming")').first().isVisible());
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
