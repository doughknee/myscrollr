/**
 * Dev gallery of the widget-page cells (SCROLLR-271). Not a build input:
 * the ticker shim loads it instead of the ticker when the URL has
 * `?cells=1`, so the cells can be looked at, captured and measured in a
 * plain browser before the page engine (SCROLLR-272) exists.
 *
 *   /ticker-shim.html?cells=1[&theme=light|<family>-<light|dark>]
 *
 * Below the strips, `data-board` rows put every state of a family side by
 * side at the real column widths (SCROLLR-295's as-built canvas).
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
import { isLive, isCloseGame } from "../utils/gameHelpers";
import { sportsTickerStatus } from "../datawidgets/sports/view";
import { LABEL_W, columnsFor, contentWidth, paginate } from "../components/pages/pagePlan";
import GameCell, { gameMinCol } from "../components/pages/cells/GameCell";
import NewsCell, { NEWS_MIN_COL, NEWS_PIN_W } from "../components/pages/cells/NewsCell";
import QuoteCell, { QUOTE_MIN_COL } from "../components/pages/cells/QuoteCell";
import AlsoCell, { ALSO_MIN_COL } from "../components/pages/cells/AlsoCell";
import { Rule, accentFor, accentStyle, inkFor, mix } from "../components/pages/cells/parts";
import fixture from "./__fixtures__/dashboard.pages.json";
import longnames from "./__fixtures__/dashboard.longnames.json";
import nprFx from "./__fixtures__/dashboard.npr.json";

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
  // One stock through a day (SCROLLR-296 round 5: the price zone is the price's own width, so a
  // state changes digits, not how many): a one- and a two-digit move, a new low and high, no range.
  ["up", { ...aapl, price: 253.69, percentage_change: 0.89, day_low: 251.5, day_high: 254.2 }],
  ["down", { ...aapl, price: 249.1, percentage_change: -12.4, day_low: 201.1, day_high: 289.55 }],
  ["no-range", { ...aapl, price: 250.01, percentage_change: 0, day_low: 0, day_high: 0 }],
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

// ── Every state at the bar's real column widths (SCROLLR-295) ────
// The design-pass canvas: one item per state, side by side at the width a
// real page gives the family at 1280 and 1920, plus the roomy and wide
// widths a split page reaches. Captioned per column. Not measured by any
// spec (no data-strip); capture with `[data-board="…"]`.

const byName = (n: string) => data.sports.find((g) => g.home_team_name === n || g.away_team_name === n)!;
const liveGames = data.sports.filter(isLive);
const close = liveGames.find((g) => isCloseGame(g) && !isMine(g));
const notClose = liveGames.find((g) => !isCloseGame(g) && !isMine(g));
const GAME_BOARD: [string, Game, boolean][] = [
  ["pre · today", byName("Minnesota Vikings"), false],
  ["pre · later day", byName("New Orleans Saints"), false],
  ["live", notClose!, false],
  ["live · close (marked)", close!, false],
  ["live · yours", data.sports.find(isMine)!, true],
  ["final · longest nickname", byName("Washington Commanders"), false],
  ["postponed", { ...byName("Las Vegas Raiders"), state: "postponed", status_short: "PST" }, false],
];
const longRss = (longnames.data as unknown as { rss: RssItem[] }).rss;
const nprRss = (nprFx.data as unknown as { rss: RssItem[] }).rss;
const ago = (r: RssItem, h: number) => ({ ...r, published_at: new Date(NOW - h * 3_600_000).toISOString() });
const NEWS_BOARD: [string, RssItem][] = [
  ["9m · summary", { ...ago(nprRss[0], 0.15) }],
  ["1d · summary", ago(nprRss[17], 26)],
  ["5d · no summary", ago(nprRss[29], 120)],
  ["long headline · no summary", ago(longRss[0], 2)],
  ["long headline · summary", { ...ago(longRss[3], 3), description: nprRss[6].description }],
  ["short headline · no summary", ago(nprRss[22], 4)],
];
const fin = (s: string) => data.finance.find((t) => t.symbol === s)!;
const QUOTE_BOARD: [string, Trade][] = [
  ["up", fin("JPM")],
  ["down", fin("AAPL")],
  ["flat", { ...fin("SPY"), percentage_change: 0 }],
  ["5-digit price", fin("BTC/USD")],
  ["crypto < $1", fin("DOGE/USD")],
  ["no range, no change", { ...fin("MSFT"), percentage_change: "" as unknown as number, day_low: 0, day_high: 0 }],
];

/** Equal fixed columns, each captioned, wrapping to rows no wider than a 1920 bar's content. */
function Board({ name, tab, width, children }: { name: string; tab: string; width: number; children: [string, ReactNode][] }) {
  const hex = catalogItemById(tab)?.hex;
  const per = Math.max(1, Math.floor(contentWidth(1920) / width));
  const rows: [string, ReactNode][][] = [];
  for (let i = 0; i < children.length; i += per) rows.push(children.slice(i, i + per));
  return (
    <figure className="m-0 flex shrink-0 flex-col gap-1 px-4" data-board={name}>
      <figcaption className="font-mono text-[10px] tracking-[0.06em] text-fg-3">{name.toUpperCase()} · {width.toFixed(1)}PX COLUMNS</figcaption>
      {rows.map((row, r) => (
        <div key={r} className="flex flex-col">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${row.length}, ${width}px)` }}>
            {row.map(([state]) => <span key={state} className="truncate px-3 font-mono text-[9.5px] text-fg-3">{state}</span>)}
          </div>
          <div className="flex h-16 items-stretch self-start border-b border-edge/50 bg-base-150" style={accentStyle(accentFor(hex, dark), inkFor(hex, dark))}>
            <Columns width={width}>{row.map(([, node]) => node)}</Columns>
          </div>
        </div>
      ))}
    </figure>
  );
}

const col = (viewport: number, minCol: number) => contentWidth(viewport) / columnsFor(contentWidth(viewport), minCol);

function States() {
  const games = (w: number): [string, ReactNode][] => GAME_BOARD.map(([s, g, m]) => [s, <GameCell key={s} game={g} width={w} mine={m} now={NOW} />]);
  const news = (w: number, line?: boolean): [string, ReactNode][] => NEWS_BOARD.map(([s, r]) => [s, <NewsCell key={s} item={r} width={w} line={line} now={NOW} />]);
  const quotes = [
    ...QUOTE_BOARD.map(([s, t]): [string, ReactNode] => [s, <QuoteCell key={s} trade={t} />]),
    ["popular fill", <QuoteCell key="fill" trade={fin("NVDA")} fill />] as [string, ReactNode],
  ];
  return (
    <>
      <div className="px-4 pt-6 font-mono text-[10px] tracking-[0.06em] text-fg-4">EVERY STATE AT THE BAR&apos;S REAL COLUMN WIDTHS (SCROLLR-295)</div>
      <Board name="game-1280" tab="sports_nfl" width={col(1280, gameMinCol("NFL"))}>{games(col(1280, gameMinCol("NFL")))}</Board>
      <Board name="game-1920" tab="sports_nfl" width={col(1920, gameMinCol("NFL"))}>{games(col(1920, gameMinCol("NFL")))}</Board>
      <Board name="game-roomy" tab="sports_nfl" width={contentWidth(1920) / 5}>{games(contentWidth(1920) / 5)}</Board>
      <Board name="game-wide" tab="sports_nfl" width={contentWidth(1920) / 4}>{games(contentWidth(1920) / 4)}</Board>
      <Board name="news-1280" tab="news_npr" width={col(1280, NEWS_MIN_COL)}>{news(col(1280, NEWS_MIN_COL))}</Board>
      <Board name="news-1920" tab="news_npr" width={col(1920, NEWS_MIN_COL)}>{news(col(1920, NEWS_MIN_COL))}</Board>
      <Board name="news-pin" tab="news_npr" width={NEWS_PIN_W}>{news(NEWS_PIN_W, true)}</Board>
      <Board name="quote-1280" tab="finance_stocks" width={col(1280, QUOTE_MIN_COL)}>{quotes}</Board>
      <Board name="quote-1920" tab="finance_stocks" width={col(1920, QUOTE_MIN_COL)}>{quotes}</Board>
    </>
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
      <Strip name="game-stacked" width={gameMinCol("NFL")}>{GAME_STATES.map(([s, g]) => [s, <GameCell game={g} width={gameMinCol("NFL")} mine now={NOW} />])}</Strip>
      <Strip name="game-wide" width={460}>{GAME_STATES.map(([s, g]) => [s, <GameCell game={g} width={460} mine now={NOW} />])}</Strip>
      <Strip name="quote" width={QUOTE_MIN_COL}>{QUOTE_STATES.map(([s, t]) => [s, <QuoteCell trade={t} />])}</Strip>
      <Strip name="news" width={420}>{NEWS_STATES.map(([s, r]) => [s, <NewsCell item={r} width={420} now={NOW} />])}</Strip>
      <States />
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
