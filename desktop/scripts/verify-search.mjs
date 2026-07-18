/**
 * Playwright verification for the Kalshi channel market search bar.
 * Drives the channel preview harness (real FeedTab + fixture data) at
 * 1440px and 375px, asserts each behavior-spec state, and screenshots to
 * ui-review/. Exits non-zero on the first failed assertion.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE =
  "http://localhost:5174/src/datawidgets/predictions/preview/index.html";
const OUT = process.env.UI_REVIEW_OUT ?? "ui-review-out";
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const INPUT = '[aria-label="Search markets"]';

async function cardCount(page) {
  return page.locator("[data-nav-idx], .grid > div > .h-full, .grid .rounded-lg.border").count();
}

/** Count rendered event cards (motion wrappers carry h-full min-w-0). */
async function eventCards(page) {
  return page.evaluate(() => document.querySelectorAll(".grid span.text-ui-title").length);
}

async function sectionHeaders(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-section-title]")].map((h) => h.textContent?.trim()),
  );
}

async function run() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ── 1440px desktop ────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const consoleErrors = [];
    // Known-benign in the browser-only harness: asset 404s and the Tauri
    // pref-store fallback (no keychain/IPC outside the desktop shell).
    const benign = /Failed to load resource|Store write failed/;
    page.on("console", (msg) => {
      if (msg.type() === "error" && !benign.test(msg.text()))
        consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-section-title]"); // category sections rendered
    console.log("== 1440px ==");

    const initialCards = await eventCards(page);
    check("initial browse renders cards", initialCards > 20, `got ${initialCards}`);
    check("search input present", (await page.locator(INPUT).count()) === 1);
    await page.screenshot({ path: `${OUT}/search-01-idle-1440.png` });

    // Expand on focus.
    const idleW = await page.locator(INPUT).evaluate((el) => el.parentElement.offsetWidth);
    await page.click(INPUT);
    await page.waitForTimeout(300);
    const focusW = await page.locator(INPUT).evaluate((el) => el.parentElement.offsetWidth);
    check("expands on focus", focusW > idleW + 40, `${idleW} -> ${focusW}`);
    await page.screenshot({ path: `${OUT}/search-02-focused-1440.png` });

    // Fast typing — instant filtering, no submit.
    await page.keyboard.type("trump", { delay: 0 });
    await page.waitForTimeout(400); // let exit animations settle
    const trumpCards = await eventCards(page);
    const marks = await page.locator("mark").count();
    check("typing filters instantly", trumpCards > 0 && trumpCards < initialCards, `cards ${initialCards} -> ${trumpCards}`);
    check("matched substrings highlighted", marks > 0, `marks=${marks}`);
    const headers = await sectionHeaders(page);
    const hasEmptySection = await page.evaluate(() =>
      [...document.querySelectorAll(".grid")].some((g) => g.children.length === 0),
    );
    check("only matching categories keep headers", !hasEmptySection, headers.join(","));
    await page.screenshot({ path: `${OUT}/search-03-results-trump-1440.png` });

    // Typo tolerance ("bitcion" -> Bitcoin, transposition).
    await page.fill(INPUT, "");
    await page.keyboard.type("bitcion", { delay: 10 });
    await page.waitForTimeout(400);
    const typoCards = await eventCards(page);
    const typoMarks = await page.locator("mark").count();
    check("typo query matches (bitcion→bitcoin)", typoCards > 0 && typoMarks > 0, `cards=${typoCards} marks=${typoMarks}`);
    await page.screenshot({ path: `${OUT}/search-04-typo-bitcion-1440.png` });

    // Zero results.
    await page.fill(INPUT, "");
    await page.keyboard.type("zzzquux", { delay: 0 });
    await page.waitForTimeout(400);
    const emptyText = await page.locator('p:has-text("No markets match")').count();
    const echoed = await page.locator("text=zzzquux").count();
    check("no-results state with echoed query", emptyText === 1 && echoed >= 1);
    const clearBtn = page.locator('button:has-text("Clear search")');
    check("clear-search action present", (await clearBtn.count()) === 1);
    await page.screenshot({ path: `${OUT}/search-05-empty-1440.png` });
    await clearBtn.click();
    await page.waitForTimeout(400);
    check("clear restores browse", (await eventCards(page)) === initialCards);
    check("clear refocuses input", await page.locator(INPUT).evaluate((el) => document.activeElement === el));
    await page.screenshot({ path: `${OUT}/search-06-cleared-1440.png` });

    // ── Keyboard-only end to end ────────────────────────────────
    await page.locator(INPUT).evaluate((el) => el.blur());
    await page.keyboard.press("/");
    check("'/' focuses search", await page.locator(INPUT).evaluate((el) => document.activeElement === el));
    await page.keyboard.type("fed", { delay: 0 });
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    const ringed = await page.locator('[data-nav-idx="1"]').evaluate((el) => el.className.includes("ring-2"));
    check("arrow keys move visible selection", ringed);
    await page.screenshot({ path: `${OUT}/search-07-keynav-1440.png` });
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="dialog"]', { timeout: 2000 });
    check("Enter opens selected market detail", true);
    await page.screenshot({ path: `${OUT}/search-08-detail-1440.png` });
    await page.keyboard.press("Escape"); // close modal
    await page.waitForTimeout(300);
    check("modal closed", (await page.locator('[role="dialog"]').count()) === 0);

    // Escape clears, then blurs.
    await page.click(INPUT);
    await page.keyboard.press("Escape");
    check("Escape clears query", (await page.inputValue(INPUT)) === "");
    await page.keyboard.press("Escape");
    check("second Escape blurs", await page.locator(INPUT).evaluate((el) => document.activeElement !== el));
    await page.waitForTimeout(400);
    check("browse restored after keyboard flow", (await eventCards(page)) === initialCards);

    // Star (tap interactivity) survives search filtering.
    await page.click(INPUT);
    await page.keyboard.type("trump", { delay: 0 });
    await page.waitForTimeout(400);
    const star = page.locator('button[aria-label="Add to watchlist"]').first();
    await star.click();
    check("cards stay interactive (star works)", await page.locator('button[aria-label="Remove from watchlist"]').count() >= 1);
    await page.locator('button[aria-label="Remove from watchlist"]').first().click(); // un-star: leave no state behind

    // "/" must NOT steal focus while the detail modal is open.
    await page.locator(".grid button.text-left").first().click();
    await page.waitForSelector('[role="dialog"]');
    await page.keyboard.press("/");
    check(
      "'/' ignored while modal open",
      await page.locator(INPUT).evaluate((el) => document.activeElement !== el),
    );
    await page.keyboard.press("Escape");

    check("no console errors (1440 flow)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await page.close();
  }

  // ── 375px mobile ──────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-section-title]");
    console.log("== 375px ==");

    check("no horizontal page overflow (idle)", await page.evaluate(() => document.documentElement.scrollWidth <= 375));
    await page.screenshot({ path: `${OUT}/search-09-idle-375.png` });

    await page.click(INPUT);
    await page.waitForTimeout(300);
    check("no horizontal overflow when expanded", await page.evaluate(() => document.documentElement.scrollWidth <= 375));
    await page.screenshot({ path: `${OUT}/search-10-focused-375.png` });

    await page.keyboard.type("trump", { delay: 0 });
    await page.waitForTimeout(400);
    const cards = await eventCards(page);
    const marks = await page.locator("mark").count();
    check("mobile results render with highlights", cards > 0 && marks > 0, `cards=${cards} marks=${marks}`);
    await page.screenshot({ path: `${OUT}/search-11-results-375.png` });

    await page.fill(INPUT, "");
    await page.keyboard.type("zzzquux", { delay: 0 });
    await page.waitForTimeout(400);
    check("mobile no-results state", (await page.locator('p:has-text("No markets match")').count()) === 1);
    await page.screenshot({ path: `${OUT}/search-12-empty-375.png` });
    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
