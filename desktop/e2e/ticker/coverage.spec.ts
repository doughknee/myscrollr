import { test, expect } from "@playwright/test";
import { FIXTURES, measureLapMs, openShim } from "./shim";
import { TICKER_SLOTS } from "../../src/datawidgets/sports/view";
import defaultFx from "../../src/dev/__fixtures__/dashboard.default.json" with { type: "json" };
import busy from "../../src/dev/__fixtures__/dashboard.busy.json" with { type: "json" };
import longnames from "../../src/dev/__fixtures__/dashboard.longnames.json" with { type: "json" };

// Timing-based: lap length is measured, not known; one retry is allowed.
test.describe.configure({ retries: 1 });

const SPEED = 80; // px/s, the fastest preset; the shim snaps ?speed= to it
const POLL_MS = 500;

const GAMES: Record<(typeof FIXTURES)[number], { home_team_name: string }[]> = {
  default: defaultFx.data.sports,
  busy: busy.data.sports,
  longnames: longnames.data.sports,
};

/**
 * Slot i cycles its residue class one step per lap, so a pool of n games
 * over TICKER_SLOTS slots has every game on the rail within ceil(n/slots)
 * laps: 8 MLB games is 2, the fifty-game Saturday plus six live is 14
 * (CHIP_SPEC §8.6: "fifty college games through four places is about
 * thirteen laps"). A slot only advances once it has LEFT the viewport,
 * and from its starting position that first exit can take most of a
 * lap, so the budget is one lap more than the arithmetic. The bound
 * comes from the fixture, never a literal.
 */
for (const fixture of FIXTURES) {
  test(`[${fixture}] every game in the fixture comes round`, async ({ page }) => {
    const games = GAMES[fixture];
    // A sports chip's pin subject is its home team (the pinning model is
    // per subject, not per game); every home team in the fixture is distinct.
    const expected = new Set(games.map((g) => g.home_team_name));
    expect(expected.size).toBe(games.length);
    const laps = Math.ceil(games.length / TICKER_SLOTS) + 1;

    await openShim(page, `?fixture=${fixture}&speed=${SPEED}`);

    const lapMs = await measureLapMs(page, SPEED);
    const budget = Math.ceil(lapMs * laps);
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
    expect([...seen].sort(), `${laps} laps of ≈ ${Math.round(lapMs / 1000)} s`).toEqual(
      [...expected].sort(),
    );
  });
}
