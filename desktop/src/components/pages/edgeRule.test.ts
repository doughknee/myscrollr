import { describe, expect, it } from "vitest";
import type { WidgetPin } from "../../preferences";
import { MAX_PINS, togglePin } from "../../preferences";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_MIN_COL, NEWS_PIN_W } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { edgeBudget, edgeCanHold, fitsEdge, gridHeaderPlan, pinRefusal, pinWidth, stepBack, type EdgeRoom } from "./edgeRule";
import { displayGeometry } from "../../lib/tickerDisplay";

describe("Fill header capacity", () => {
  const tabs = ["sports_nfl", "finance_stocks", "news_bbc", "clock", "weather"];
  it.each([[3440, 1440], [1920, 360], [800, 480], [720, 1280], [1080, 1920]])(
    "%ix%i shares one bounded header at every reading size",
    (width, height) => {
      for (const reading of [100, 125, 150]) {
        const geometry = displayGeometry(width, height, "grid", reading);
        const pins = [nfl(1), news(1), nfl(2), news(2)];
        const header = gridHeaderPlan(geometry.width, 5, tabs, pins);
        const placed = stepBack(pins, header.room);
        expect(header.utilitiesWidth + 1 + (placed.length ? 1 : 0) + placed.reduce((sum, p) => sum + pinWidth(p.widget), 0) + 192).toBeLessThanOrEqual(geometry.width / header.scale + 0.01);
        expect(header.utilitiesWidth).toBeGreaterThanOrEqual(180);
        expect(fitsEdge(placed, header.room)).toBe(true);
        if (placed.length < pins.length) {
          const next = pins[placed.length];
          expect(pinRefusal(placed, { ...next, label: "Next" }, header.room)).not.toBeNull();
          expect(fitsEdge([...placed, next], header.room)).toBe(false);
        }
      }
    },
  );
  it("portrait reclaims the unusable pin area for both utilities without changing admission", () => {
    const header = gridHeaderPlan(420, 2, tabs, [nfl(1)]);
    expect(stepBack([nfl(1)], header.room)).toHaveLength(0);
    expect(header.utilitiesWidth).toBe(367);
    expect(header.room).toEqual(gridHeaderPlan(420, 2, tabs).room);
    const wide = gridHeaderPlan(800, 2, tabs, [nfl(1)]);
    expect(stepBack([nfl(1)], wide.room)).toHaveLength(1);
    expect(wide.utilitiesWidth).toBe(360);
    expect(gridHeaderPlan(420, 0, tabs).utilitiesWidth).toBe(0);
  });
  it("ignores inactive/utility pins in admission and restores saved overflow after widening", () => {
    const pins = [nfl(1), news(1), nfl(2)];
    const narrow = gridHeaderPlan(420, 2, tabs).room;
    const wide = gridHeaderPlan(1800, 2, tabs).room;
    expect(stepBack(pins, narrow)).toHaveLength(0);
    expect(stepBack(pins, wide)).toEqual(pins);
    expect(fitsEdge([pin("clock", "local"), pin("sports_mlb", "Cubs"), ...pins], wide)).toBe(fitsEdge(pins, wide));
    expect(pinRefusal([], { ...nfl(1), label: "Bears" }, narrow)).toBe("Not enough header space for Bears at this reading size");
  });
  it("only promises an unpin when that removal really makes room", () => {
    const header = gridHeaderPlan(600, 2, tabs).room;
    const add = { ...news(2), label: "BBC" };
    expect(pinRefusal([nfl(1)], add, header)).toContain("unpin Team 1 first");
    expect(pinRefusal([nfl(1), nfl(2), nfl(3)], add, header)).toBe("Header pin area is full — unpin some items first");
  });
});

const pin = (widget: string, subject: string): WidgetPin => ({ widget, subject, side: "right" });
const nfl = (i: number) => pin("sports_nfl", `Team ${i}`);
const news = (i: number) => pin("news_bbc", `https://feed/${i}`);
const college = (i: number) => pin("sports_premierleague", `Club ${i}`);

/** Local time + 3 zones + weather: the measured utilities strip at 1280 (SCROLLR-273). */
const FULL = 194;
/** One clock. */
const ONE = 102;
const room = (bar: number, util = FULL): EdgeRoom => ({ bar, util });

describe("the widths", () => {
  it("a news pin is the narrow one-line column, not the page column", () => {
    expect(pinWidth("news_bbc")).toBe(NEWS_PIN_W);
    expect(NEWS_PIN_W).toBe(260);
    expect(NEWS_PIN_W).toBeLessThan(NEWS_MIN_COL);
    expect(pinWidth("sports_nfl")).toBe(gameMinCol("NFL"));
    expect(pinWidth("sports_premierleague")).toBe(gameMinCol("PREMIERLEAGUE"));
    expect(pinWidth("finance_stocks")).toBe(QUOTE_MIN_COL);
  });
  it("a pinned utility adds nothing: it is already on the edge", () => {
    expect(pinWidth("clock")).toBe(0);
    expect(pinWidth("weather")).toBe(0);
  });
});

describe("the 40% rule", () => {
  it("is 40% of the bar", () => {
    expect([1280, 1920, 3440].map(edgeBudget)).toEqual([512, 768, 1376]);
  });

  it("1280: one headline or one game fits beside clocks and weather; two of either do not", () => {
    const r = room(1280);
    expect(fitsEdge([news(1)], r)).toBe(true);
    expect(fitsEdge([nfl(1)], r)).toBe(true);
    expect(fitsEdge([nfl(1), nfl(2)], r)).toBe(false);
    expect(fitsEdge([news(1), news(2)], r)).toBe(false);
    // Two headlines fit when the edge holds only a clock.
    expect(fitsEdge([news(1), news(2)], room(1280, ONE))).toBe(false);
    expect(fitsEdge([news(1)], room(1280, ONE))).toBe(true);
  });

  it("1920: two news pins, two games and two league games all fit", () => {
    const r = room(1920);
    expect(fitsEdge([news(1), news(2)], r)).toBe(true);
    expect(fitsEdge([nfl(1), nfl(2)], r)).toBe(true);
    expect(fitsEdge([college(1), college(2)], r)).toBe(true);
    expect(fitsEdge([news(1), news(2), news(3)], r)).toBe(false);
  });

  it("3440: four headlines fit, a fifth does not", () => {
    const r = room(3440);
    expect(fitsEdge([1, 2, 3, 4].map(news), r)).toBe(true);
    expect(fitsEdge([1, 2, 3, 4, 5].map(news), r)).toBe(false);
  });

  it("the edge's border and the utilities count against the budget", () => {
    // 512 - 1 (border) - 194 = 317 left at 1280: a 264 game fits, a 317+ pin set does not.
    expect(fitsEdge([nfl(1)], room(1280))).toBe(true);
    expect(fitsEdge([], room(1280, 600))).toBe(false);
  });
});

describe("stepBack: a screen that shrinks gives the newest pins back to their pages", () => {
  const pins = [nfl(1), nfl(2), news(1)];
  it("keeps the oldest that fit, in order", () => {
    expect(stepBack(pins, room(1280, ONE))).toEqual([nfl(1)]);
    expect(stepBack(pins, room(2560, ONE))).toEqual(pins);
  });
  it("is not destructive: widening again brings them back", () => {
    const small = stepBack(pins, room(1280, ONE));
    expect(small.length).toBeLessThan(pins.length);
    expect(stepBack(pins, room(2560, ONE))).toHaveLength(pins.length);
  });
  it("can give back all of them", () => {
    expect(stepBack(pins, room(1280, 600))).toEqual([]);
  });
});

describe("pinRefusal", () => {
  const add = { widget: "news_bbc", subject: "https://feed/2", label: "BBC" };
  it("null when it fits, and never for an unpin", () => {
    expect(pinRefusal([], add, room(1280))).toBeNull();
    expect(pinRefusal([news(2)], add, room(1280, 9999))).toBeNull();
  });
  it("one line, naming the pin to unpin", () => {
    const msg = pinRefusal([nfl(1)], add, room(1280));
    expect(msg).toBe("No room on the edge at this screen size — unpin Team 1 first");
    expect(msg).not.toContain("\n");
  });
  it("names the newest pin whose removal makes room", () => {
    // 1920 (768), util 100: [nfl 264, news 260] = 625 fits; adding a game (264) = 889 does not.
    // The newest pin whose removal makes room is the news pin.
    const msg = pinRefusal([nfl(1), news(1)], { widget: "sports_nfl", subject: "Team 9", label: "Team 9" }, room(1920, 100));
    expect(msg).toBe("No room on the edge at this screen size — unpin BBC News first");
  });
  it("with nothing pinned, says the clocks and weather fill it", () => {
    expect(pinRefusal([], add, room(1280, 600))).toBe("No room on the edge at this screen size — its clocks and weather fill it");
  });
  it("with no ticker reporting a width the old count cap stands", () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => nfl(i));
    expect(pinRefusal(full, add, null)).toBe(`The ticker already holds ${MAX_PINS} pins — unpin one to pin BBC`);
    expect(pinRefusal(full.slice(0, 1), add, null)).toBeNull();
  });
});

describe("togglePin with the width rule", () => {
  const base = (pins: WidgetPin[]) => ({ widgets: { pins } }) as unknown as Parameters<typeof togglePin>[0];
  it("refuses with the same reference, and allows what fits (not capped at MAX_PINS)", () => {
    const wide = edgeCanHold(room(3440));
    const three = base([news(1), news(2), news(3)]);
    const four = togglePin(three, news(4), wide);
    expect(four.widgets.pins).toHaveLength(4);
    const tight = edgeCanHold(room(1280));
    const one = base([nfl(1)]);
    expect(togglePin(one, nfl(2), tight)).toBe(one);
  });
  it("no room known: the count cap", () => {
    expect(edgeCanHold(null)).toBeUndefined();
    const full = base(Array.from({ length: MAX_PINS }, (_, i) => nfl(i)));
    expect(togglePin(full, news(1))).toBe(full);
  });
});
