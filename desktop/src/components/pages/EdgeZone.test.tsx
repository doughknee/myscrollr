import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ClockChipData, DashboardResponse, Game, WidgetTickerData } from "../../types";
import type { WidgetPin } from "../../preferences";
import fixture from "../../dev/__fixtures__/dashboard.pages.json";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_PIN_W } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import EdgeZone, { buildEdge, edgeTabs, reserveOf, type Edge } from "./EdgeZone";
import { ALSO_TAB, buildPageWidgets } from "./widgetPages";

const dash = fixture as unknown as DashboardResponse;
const NOW = Date.parse(fixture._captured_at);
const TABS = (fixture.widgets as { widget_type: string }[]).map((w) => w.widget_type);
const games = (dash.data!.sports as Game[]).filter((g) => g.league === "NFL");
const BEARS = games[0].home_team_name;

const clock = (id: string, label: string, value: string): ClockChipData => ({ id, kind: "clock", label, value, detail: "Thu, Oct 1" });
const data = {
  clock: [clock("clock-local", "Local", "7:21 PM"), clock("clock-ny", "New York", "8:21 PM"), clock("clock-tokyo", "Tokyo", "9:21 AM")],
  timer: [],
  weather: [{ id: "weather-Chicago", label: "Chicago", temp: "61°F", unit: "fahrenheit", icon: "⛅", low: 11, high: 19 }],
  sysmon: [],
  uptime: [],
  github: [],
} as WidgetTickerData;
const pin = (widget: string, subject: string): WidgetPin => ({ widget, subject, side: "right" });

describe("reserveOf", () => {
  it("widens every digit and pads the first run, so a ticking value never grows its slot", () => {
    expect(reserveOf("7:21 PM", 2)).toBe("00:00 PM");
    expect(reserveOf("12:59 AM", 2)).toBe("00:00 AM");
    expect(reserveOf("9:05", 2)).toBe("00:00");
    expect(reserveOf("61°F", 3)).toBe("000°F");
    expect(reserveOf("-4°C", 3)).toBe("-000°C");
  });
});

describe("buildEdge", () => {
  it("utilities on the ticker with data, in a fixed order, then pins that resolve", () => {
    const edge = buildEdge(data, [pin("sports_nfl", BEARS), pin("finance_stocks", "AAPL"), pin("news_bbc", "https://feeds.bbci.co.uk/news/rss.xml")], dash, ["weather", "clock", ...TABS]);
    expect(edge.utilities.map((u) => u.tab)).toEqual(["clock", "weather"]);
    expect(edge.pins.map((p) => [p.kind, p.width])).toEqual([
      ["sports", gameMinCol("NFL")],
      ["finance", QUOTE_MIN_COL],
      ["news", NEWS_PIN_W],
    ]);
    expect(JSON.parse(edge.pins[0].pin)).toMatchObject({ widget: "sports_nfl", subject: BEARS });
    expect(edgeTabs(edge)).toEqual(["clock", "weather", "sports_nfl", "finance_stocks", "news_bbc"]);
  });

  it("weather range follows the chip's unit, not the temperature's suffix", () => {
    const edge = buildEdge(data, [], dash, ["weather"]);
    expect(edge.utilities[0].items[0].detail).toBe("52° / 66°");
    const c = { ...data, weather: [{ ...data.weather[0], temp: "16°C", unit: "celsius" as const }] } as WidgetTickerData;
    expect(buildEdge(c, [], dash, ["weather"]).utilities[0].items[0].detail).toBe("11° / 19°");
  });

  it("skips utilities off the ticker, pins of widgets off the ticker, pinned utilities and subjects with nothing", () => {
    const edge = buildEdge(data, [pin("clock", "clock"), pin("sports_mlb", "Milwaukee Brewers"), pin("sports_nfl", "Nobody FC")], dash, ["clock", ...TABS]);
    expect(edge.utilities.map((u) => u.tab)).toEqual(["clock"]);
    expect(edge.pins).toEqual([]);
  });

  it("nothing at all: an empty edge, which renders nothing and so takes no width", () => {
    const edge = buildEdge(undefined, [], dash, TABS);
    expect(edge).toEqual({ utilities: [], pins: [] });
    const { container } = render(<EdgeZone edge={edge} tick={3} reduced={false} dark edgeRef={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("EdgeZone (Cycle)", () => {
  const edge: Edge = buildEdge(data, [], dash, ["clock"]);
  const shown = (tick: number) => {
    const { container, unmount } = render(<EdgeZone edge={edge} tick={tick} reduced={false} dark edgeRef={() => {}} />);
    const out = {
      item: container.querySelector("[data-item]")!.getAttribute("data-item"),
      sizers: [...container.querySelectorAll('[aria-hidden="true"]')].map((s) => s.textContent),
    };
    unmount();
    return out;
  };

  it("shows ONE zone, stepping one per page turn and wrapping", () => {
    expect([0, 1, 2, 3, 4].map((t) => shown(t).item)).toEqual(["clock-local", "clock-ny", "clock-tokyo", "clock-local", "clock-ny"]);
  });

  it("reserves every zone at its widest, whichever is up (widest-first: the width never changes)", () => {
    expect(shown(0).sizers).toEqual(["Local00:00 PM", "New York00:00 PM", "Tokyo00:00 AM"]);
    expect(shown(2).sizers).toEqual(shown(0).sizers);
  });
});

describe("buildPageWidgets with pins", () => {
  it("a pinned team leaves the pages: no page cell holds it", () => {
    const nfl = (pins: WidgetPin[]) => buildPageWidgets(dash, TABS, NOW, pins).find((w) => w.tab === "sports_nfl")!;
    const has = (w: ReturnType<typeof nfl>) => w.items.some((i) => [(i.data as Game).home_team_name, (i.data as Game).away_team_name].includes(BEARS));
    expect(has(nfl([]))).toBe(true);
    expect(has(nfl([pin("sports_nfl", BEARS)]))).toBe(false);
  });

  it("a widget whose every item is pinned has no page and says nothing on Also (it is on the edge)", () => {
    const symbols = buildPageWidgets(dash, ["finance_crypto"], NOW)[0].items.map((i) => i.key.slice(2));
    const widgets = buildPageWidgets(dash, ["finance_crypto"], NOW, symbols.map((s) => pin("finance_crypto", s)));
    expect(widgets.map((w) => w.tab)).not.toContain("finance_crypto");
    expect(widgets.map((w) => w.tab)).not.toContain(ALSO_TAB);
  });
});
