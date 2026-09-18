import { test, expect } from "@playwright/test";
import { openShim, TRACK } from "./shim";
import fixture from "../../src/dev/__fixtures__/dashboard.default.json" with { type: "json" };

// Timing-based: lap length is measured, not known; one retry is allowed.
test.describe.configure({ retries: 1 });

const SPEED = 80; // px/s, the fastest preset; the shim snaps ?speed= to it
const POLL_MS = 500;
const LAPS = 3;

/**
 * Sports has four slots and the default fixture has eight MLB games, so
 * with slot i cycling its residue class one step per lap, every game has
 * been on the rail within two laps. Poll the slots for three.
 */
test("every game in the fixture comes round", async ({ page }) => {
  // A sports chip's pin subject is its home team (the pinning model is
  // per subject, not per game); every home team in the fixture is distinct.
  const expected = new Set(fixture.data.sports.map((g) => g.home_team_name));
  expect(expected.size).toBe(fixture.data.sports.length);
  expect(expected.size).toBeGreaterThan(4);

  await openShim(page, `?speed=${SPEED}`);

  // One lap = the original track's length at the configured speed. The
  // container's own width is what a slot has to clear on top of that
  // before it counts as gone, so add it.
  const lapMs = await page.locator(TRACK).first().evaluate((ul, speed) => {
    const items = [...ul.querySelectorAll<HTMLElement>(".ticker-item")];
    const gap = parseFloat(getComputedStyle(ul).gap || "0") || 0;
    const track = items.reduce((w, li) => w + li.offsetWidth + gap, 0);
    const container = ul.closest(".ticker-container")!.getBoundingClientRect().width;
    return ((track + container) / speed) * 1000;
  }, SPEED);
  const budget = Math.ceil(lapMs * LAPS);
  test.setTimeout(budget + 60_000);

  const seen = new Set<string>();
  const deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const ids = await page.$$eval('[data-rotate-slot^="spo-"]', (els) =>
      els.map((el) => {
        const raw = el.getAttribute("data-pin-subject");
        return raw ? String((JSON.parse(raw) as { subject: string }).subject) : "";
      }),
    );
    for (const id of ids) if (id) seen.add(id);
    if ([...expected].every((id) => seen.has(id))) break;
    await page.waitForTimeout(POLL_MS);
  }
  expect([...seen].sort(), `lap ≈ ${Math.round(lapMs / 1000)} s`).toEqual([...expected].sort());
});
