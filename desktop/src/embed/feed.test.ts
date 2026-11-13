import { describe, expect, it, vi } from "vitest";
import { feedUrl, fromPublicFeed, isUtility, readFeed, rebase, resolveWidget, sportsTonight, widgetRows } from "./feed";

const NOW = Date.parse("2026-10-02T17:00:00Z");

describe("embed feed", () => {
  it("resolves short names and catalog ids, drops unknowns", () => {
    expect(["nfl", "npr", "stocks", "sports_nhl", "github", "nope"].map(resolveWidget)).toEqual([
      "sports_nfl",
      "news_npr",
      "finance_stocks",
      "sports_nhl",
      "github",
      null,
    ]);
    expect(isUtility("github")).toBe(true);
    expect(isUtility("news_npr")).toBe(false);
  });

  it("asks the feed for the data widgets only, the full feed when there are none", () => {
    const base = "https://api.myscrollr.com/public/feed";
    expect(feedUrl(base, ["sports_nfl", "clock", "news_npr", "finance_stocks"])).toBe(
      `${base}?widgets=sports_nfl,news_npr,finance_stocks`,
    );
    expect(feedUrl(base, ["clock", "github"])).toBe(base);
    expect(feedUrl(base, null)).toBe(base);
  });

  it("builds rows for data widgets only, with the catalog's default config", () => {
    const rows = widgetRows(["clock", "sports_nfl"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ widget_type: "sports_nfl", enabled: true, ticker_enabled: true, config: { leagues: ["NFL"] } });
  });

  it("picks the first catalog league with a game live or within 12 hours", () => {
    const games = [
      { league: "NCAA Football", state: "pre", start_time: "2026-10-02T23:00:00Z" },
      { league: "NHL", state: "pre", start_time: "2026-10-02T22:30:00Z" },
      { league: "NFL", state: "pre", start_time: "2026-10-04T17:00:00Z" },
    ];
    expect(sportsTonight(games, NOW)).toBe("sports_nhl");
    expect(sportsTonight([{ league: "KHL", state: "in" }], NOW)).toBe("sports_khl");
    expect(sportsTonight([], NOW)).toBeNull();
  });

  it("reshapes the public feed into the dashboard, null when it is empty", () => {
    const feed = { data: { finance: [{ symbol: "AAPL" }], sports: { sports: [{ league: "NHL" }], meta: { leagues: [{ name: "NHL" }] } } } };
    const d = fromPublicFeed(feed, ["sports_nhl"], [{ title: "x" }])!;
    expect(d.data).toEqual({
      finance: [{ symbol: "AAPL" }],
      sports: [{ league: "NHL" }],
      sports_meta: { leagues: [{ name: "NHL" }] },
      rss: [{ title: "x" }],
    });
    expect(d.widgets.map((w) => w.widget_type)).toEqual(["sports_nhl"]);
    const live = { data: { ...feed.data, rss: [{ title: "real" }] } };
    expect(fromPublicFeed(live, [], [{ title: "x" }])!.data.rss).toEqual([{ title: "real" }]);
    // A news-only bar's feed has no finance or sports: still live.
    expect(fromPublicFeed({ data: { finance: [], rss: [{ title: "real" }] } }, ["news_npr"], [])).not.toBeNull();
    expect(fromPublicFeed({ data: {} }, [], [])).toBeNull();
    expect(fromPublicFeed(null, [], [])).toBeNull();
  });

  it("rebases ISO timestamps and leaves other strings alone", () => {
    expect(rebase({ a: ["2026-10-02T17:00:00Z", "AAPL"], n: 1 }, 60_000)).toEqual({
      a: ["2026-10-02T17:01:00.000Z", "AAPL"],
      n: 1,
    });
  });

  it("gives up on a feed that never answers, so the bar falls back to the sample (RC-15)", async () => {
    vi.useFakeTimers();
    const hung = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const result = readFeed(hung as typeof fetch, "https://x/public/feed", 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeNull();
    vi.useRealTimers();
    const ok = async () => new Response('{"data":{}}', { status: 200 });
    expect(await readFeed(ok as typeof fetch, "https://x")).toEqual({ data: {} });
  });
});
