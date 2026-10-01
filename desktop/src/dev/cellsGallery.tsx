/**
 * Dev gallery of the widget-page cells (SCROLLR-271). Not a build input:
 * the ticker shim loads it instead of the ticker when the URL has
 * `?cells=1`, so the cells can be looked at, captured and measured in a
 * plain browser before the page engine (SCROLLR-272) exists.
 *
 *   /ticker-shim.html?cells=1[&theme=light|<family>-<light|dark>]
 *
 * Every bar is one page as the canvas draws it, split by pagePlan.ts: a stand-in label (the real
 * one is the engine's), then equal columns. Data is dashboard.pages.json
 * with the clock pinned to its capture time. The `data-strip` rows at the
 * bottom hold one item in every state it passes through, in equal fixed
 * columns, for e2e/ticker/cells.spec.ts to measure.
 */
import { StrictMode, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "../style.css";
import type { Game, RssItem, Trade } from "../types";
import type { LeagueMeta } from "../api/queries";
import { catalogItemById } from "../marketplace";
import { isLive } from "../utils/gameHelpers";
import { sportsTickerStatus } from "../datawidgets/sports/view";
import { LABEL_W, columnsFor, contentWidth, paginate } from "../components/pages/pagePlan";
import GameCell, { gameMinCol } from "../components/pages/cells/GameCell";
import NewsCell, { NEWS_MIN_COL } from "../components/pages/cells/NewsCell";
import QuoteCell, { QUOTE_MIN_COL } from "../components/pages/cells/QuoteCell";
import AlsoCell, { ALSO_MIN_COL } from "../components/pages/cells/AlsoCell";
import { Rule, accentFor, accentStyle, inkFor, mix } from "../components/pages/cells/parts";
import fixture from "./__fixtures__/dashboard.pages.json";

const params = new URLSearchParams(location.search);
// `light`, or a palette: `nord-light`, `rose-pine-dark` (e2e/ticker/pages-themes.spec.ts).
const themeParam = /^(?:([a-z-]+)-)?(light|dark)$/.exec(params.get("theme") ?? "");
const dark = themeParam?.[2] !== "light";
const dataTheme = `${themeParam?.[1] ?? "scrollr"}-${dark ? "dark" : "light"}`;
const NOW = Date.parse(fixture._captured_at);
// The shim pins html/body to the window for the bar; the gallery scrolls.
for (const el of [document.documentElement, document.body]) Object.assign(el.style, { overflow: "auto", height: "auto" });
const data = fixture.data as unknown as { sports: Game[]; finance: Trade[]; rss: RssItem[]; sports_meta: { leagues: LeagueMeta[] } };

/** Page `page` of `items` at this window's width, by pagePlan's arithmetic and the cell's own minimum column. */
function firstPage<T>(items: T[], minCol: number, page = 0): T[] {
  return paginate(items, columnsFor(contentWidth(window.innerWidth), minCol))[page] ?? [];
}

function Bar({ tab, code, sub, children, caption }: { tab: string; code: string; sub: string; children: ReactNode[]; caption: string }) {
  const hex = catalogItemById(tab)?.hex;
  return (
    <figure className="m-0 flex shrink-0 flex-col gap-1">
      <figcaption className="px-1 font-mono text-[10px] tracking-[0.06em] text-fg-4">{caption}</figcaption>
      <div className="flex h-16 w-full items-stretch overflow-hidden border-b border-edge/50 bg-base-150" style={accentStyle(accentFor(hex, dark), inkFor(hex, dark))} data-bar={tab}>
        <div
          className="flex shrink-0 flex-col justify-center gap-[3px] pl-3.5 pr-2"
          style={{ width: LABEL_W, background: mix(dark ? 16 : 12), borderRight: `1px solid ${mix(40)}` }}
        >
          <span className="truncate font-sans text-[19px] font-extrabold leading-none tracking-[0.04em]" style={{ color: "var(--accent-ink)" }}>{code}</span>
          <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-2">{sub}</span>
        </div>
        <Columns>{children}</Columns>
      </div>
    </figure>
  );
}

function Columns({ children, width }: { children: ReactNode[]; width?: number }) {
  return (
    <div
      className="grid min-w-0 flex-1"
      style={{ gridTemplateColumns: width ? `repeat(${children.length}, ${width}px)` : `repeat(${children.length}, minmax(0, 1fr))` }}
    >
      {children.map((c, i) => (
        <div key={i} className="relative min-w-0" data-col={i}>
          {i > 0 && <Rule />}
          {c}
        </div>
      ))}
    </div>
  );
}

function colWidth(n: number) {
  return (window.innerWidth - LABEL_W) / n;
}

// ── The pages ────────────────────────────────────────────────────

const favourite = "Chicago Bears";
const isMine = (g: Game) => g.home_team_name === favourite || g.away_team_name === favourite;
const byKick = (a: Game, b: Game) => a.start_time.localeCompare(b.start_time) || Number(a.id) - Number(b.id);
const nfl = [
  ...data.sports.filter(isMine).sort(byKick),
  ...data.sports.filter((g) => isLive(g) && !isMine(g)).sort(byKick),
  ...data.sports.filter((g) => !isLive(g) && !isMine(g)).sort(byKick),
];
const live = nfl.filter(isLive).length;
const stocks = data.finance.filter((t) => !t.symbol.includes("/"));
const crypto = data.finance.filter((t) => t.symbol.includes("/"));
const bbc = data.rss.filter((r) => r.source_name.startsWith("BBC"));
const npr = data.rss.filter((r) => r.source_name.startsWith("NPR"));
const epl = sportsTickerStatus([], data.sports_meta.leagues, ["Premier League"], NOW);
const also = [
  { tab: "sports_premierleague", code: "EPL", text: epl?.text ?? "" },
  // Representative, not from the fixture: the other two status templates.
  { tab: "sports_nba", code: "NBA", text: "off-season" },
  { tab: "news_pbs", code: "PBS", text: "no headlines in the last 2 days" },
];

function games(page: number) {
  const items = firstPage(nfl, gameMinCol("NFL"), page);
  return items.map((g) => <GameCell key={g.id} game={g} width={colWidth(items.length)} mine={isMine(g)} now={NOW} />);
}

// ── Width-stability strips (measured by e2e/ticker/cells.spec.ts) ──

const base = nfl.find(isMine)!;
const GAME_STATES: [string, Game][] = [
  ["pre", { ...base, state: "pre", status_short: "NS", timer: "", away_team_score: "", home_team_score: "" }],
  ["live-1", { ...base, state: "in", status_short: "Q1", timer: "9:12", away_team_score: 7, home_team_score: 3 }],
  ["live-2", { ...base, state: "in", status_short: "Q4", timer: "12:59", away_team_score: 24, home_team_score: 20 }],
  ["final", { ...base, state: "final", status_short: "FT", timer: "", away_team_score: 31, home_team_score: 28 }],
];
const aapl = stocks[0];
const QUOTE_STATES: [string, Trade][] = [
  ["small", { ...aapl, price: 9.99, percentage_change: 0.89, day_low: 9.5, day_high: 10.2 }],
  ["large", { ...aapl, price: 1253.69, percentage_change: -12.4, day_low: 1201.1, day_high: 61260.55 }],
  ["no-range", { ...aapl, price: 253.69, percentage_change: 0, day_low: 0, day_high: 0 }],
];
const NEWS_STATES: [string, RssItem][] = [
  ["fresh", { ...bbc[0], published_at: new Date(NOW - 9 * 60_000).toISOString() }],
  ["old", { ...bbc[0], published_at: new Date(NOW - 12 * 3_600_000).toISOString() }],
];

function Strip({ name, width, children }: { name: string; width: number; children: [string, ReactNode][] }) {
  return (
    <div className="flex h-16 shrink-0 items-stretch border-b border-edge/50 bg-base-150" data-strip={name} style={accentStyle(accentFor("#0b2265", dark), inkFor("#0b2265", dark))}>
      <Columns width={width}>
        {children.map(([state, node]) => (
          <div key={state} className="h-full" data-state={state}>{node}</div>
        ))}
      </Columns>
    </div>
  );
}

function Gallery() {
  return (
    <div
      id="desktop-shell"
      data-theme={dataTheme}
      className="flex min-h-screen flex-col gap-3 bg-surface p-0 pb-6"
      // The real shell is one window tall; the gallery is a page.
      style={{ height: "auto", overflow: "visible" }}
    >
      <Bar tab="sports_nfl" code="NFL" sub={`${live} LIVE`} caption="NFL · PAGE 1 · YOURS (BEARS) AND LIVE">{games(0)}</Bar>
      <Bar tab="sports_nfl" code="NFL" sub={`${live} LIVE`} caption="NFL · PAGE 2 · THE REST: LIVE, LATE KICK-OFFS, FINALS">{games(1)}</Bar>
      <Bar tab="finance_stocks" code="STOCKS" sub={`▲${stocks.filter((t) => Number(t.percentage_change) >= 0).length}  ▼${stocks.filter((t) => Number(t.percentage_change) < 0).length}`} caption="STOCKS">
        {firstPage(stocks, QUOTE_MIN_COL).map((t) => <QuoteCell key={t.symbol} trade={t} />)}
      </Bar>
      <Bar tab="finance_crypto" code="CRYPTO" sub="COINS" caption="CRYPTO">
        {firstPage(crypto, QUOTE_MIN_COL).map((t) => <QuoteCell key={t.symbol} trade={t} />)}
      </Bar>
      <Bar tab="news_bbc" code="BBC" sub="HEADLINES" caption="BBC">
        {firstPage(bbc, NEWS_MIN_COL).map((r, _i, a) => <NewsCell key={r.id} item={r} width={colWidth(a.length)} now={NOW} />)}
      </Bar>
      <Bar tab="news_npr" code="NPR" sub="HEADLINES" caption="NPR">
        {firstPage(npr, NEWS_MIN_COL).map((r, _i, a) => <NewsCell key={r.id} item={r} width={colWidth(a.length)} now={NOW} />)}
      </Bar>
      <Bar tab="quiet" code="ALSO" sub="NOTHING ON" caption="ALSO · WIDGETS WITH NOTHING ON">
        {firstPage(also, ALSO_MIN_COL).map((q) => (
          <AlsoCell key={q.tab} code={q.code} text={q.text} hex={catalogItemById(q.tab)?.hex} dark={dark} />
        ))}
      </Bar>

      <div className="px-1 pt-3 font-mono text-[10px] tracking-[0.06em] text-fg-4">ONE ITEM IN EVERY STATE · SAME COLUMN WIDTH · NOTHING MAY MOVE</div>
      <Strip name="game-stacked" width={240}>{GAME_STATES.map(([s, g]) => [s, <GameCell game={g} width={240} mine now={NOW} />])}</Strip>
      <Strip name="game-wide" width={460}>{GAME_STATES.map(([s, g]) => [s, <GameCell game={g} width={460} mine now={NOW} />])}</Strip>
      <Strip name="quote" width={200}>{QUOTE_STATES.map(([s, t]) => [s, <QuoteCell trade={t} />])}</Strip>
      <Strip name="news" width={420}>{NEWS_STATES.map(([s, r]) => [s, <NewsCell item={r} width={420} now={NOW} />])}</Strip>
      {/* style.css stretches the shell's last child div to fill the window; this is it. */}
      <div aria-hidden />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
