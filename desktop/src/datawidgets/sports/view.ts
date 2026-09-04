/**
 * Sports view selectors — shared filter/sort pipeline.
 *
 * Sports display prefs live server-side on the dashboard widget config
 * (not in `prefs.widgetDisplay`), so this selector accepts the config
 * blob shape. Both `FeedTab` and `ScrollrTicker` call `selectSportsForTicker`
 * to apply the day window (v1.1.3 Time Controls) + engagement sort.
 *
 * SINGLE SOURCE OF TRUTH for Sports display prefs.
 */
import type { Game } from "../../types";
import { isLive, isCloseGame } from "../../utils/gameHelpers";
import { teamShortName } from "../../utils/teamShortName";
import { rotateSlots } from "../ticker";
import { migrateVenue } from "../../preferences";

// ── Display prefs shape (mirrors server-side widget config.display) ─
//
// Stored per-user in `user_widgets.config.display` as JSONB.

export interface SportsDisplayConfig {
  /**
   * Day window (v1.1.3 Time Controls): show games whose start_time falls
   * between `daysBack` days ago and `daysAhead` days ahead. LIVE games
   * always show regardless of the window — a live game is definitionally
   * "now". Replaces the retired showUpcoming/showFinal venue toggles
   * (normalizeSportsDisplayConfig still maps legacy stored values).
   */
  daysBack?: number;
  daysAhead?: number;
}

/** Defaults: yesterday's finals through next week's slate. */
export const SPORTS_WINDOW_DEFAULTS = { daysBack: 1, daysAhead: 7 } as const;

/**
 * Four non-favourite games on the rail at once; the rest rotate through
 * those four one lap at a time. Favourites are pinned on top.
 *
 * Not a setting. A full MLB day is ~30 eligible games and four slots
 * brings the slate round in about eight laps without a league widget
 * burying the clock and the weather behind twenty-six chips in a row.
 * The number is the chip's width and the sport's volume, which the user
 * should not have to think about; the rail just works.
 */
export const TICKER_SLOTS = 4;

/**
 * Hard ceiling looking BACK. cleanup_old_games (sports service) deletes
 * finals and postponements older than 7 days, so a wider back window can
 * only ever show emptiness.
 */
export const SPORTS_WINDOW_MAX_DAYS = 7;

/**
 * Hard ceiling looking AHEAD, and deliberately not the same number.
 *
 * The retention job prunes only the PAST -- forward fixtures are never
 * deleted, so the server holds a full season of them (F1 through
 * December, ~135 upcoming MLB games). Capping both directions at 7 was
 * therefore right on one side and wrong on the other, and the wrong side
 * broke every league that does not play weekly: with races 1-3 weeks
 * apart, an F1 user whose next race was 9 days out had NO setting -- not
 * even "Everything" -- that could show it. The Scores tab was
 * permanently empty and the widget looked broken.
 *
 * A year is effectively unbounded against what the server stores, which
 * is what "Everything" should mean. It stays a finite clamp so a corrupt
 * stored config cannot produce an infinite window.
 */
export const SPORTS_WINDOW_MAX_DAYS_AHEAD = 365;

const DAY_MS = 86_400_000;

/**
 * Window predicate shared by the ticker + feed selectors.
 *
 * Bounds are anchored to LOCAL CALENDAR DAYS, not rolling 24h periods:
 * "Today" (0 back / 0 ahead) means all of today — a 7pm tip-off must
 * not vanish from the window at 3pm. daysBack counts whole days before
 * today; daysAhead counts whole days after today (inclusive of their
 * full span).
 */
function inDayWindow(
  g: Game,
  daysBack: number,
  daysAhead: number,
  now: number,
): boolean {
  if (isLive(g)) return true;
  const t = new Date(g.start_time).getTime();
  // Defensive: an unparseable start_time stays visible rather than
  // silently vanishing from every surface.
  if (!Number.isFinite(t)) return true;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const lower = dayStart.getTime() - daysBack * DAY_MS;
  const upper = dayStart.getTime() + (daysAhead + 1) * DAY_MS;
  return t >= lower && t < upper;
}

function clampWindowDays(v: unknown, fallback: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(0, Math.round(v)))
    : fallback;
}

// ── Pure: engagement score ──────────────────────────────────────

/**
 * Coarse priority bucket for ranking games on the ticker.
 *
 * **Stable across consecutive renders / refetches** — the score for any
 * given game only changes when its `state` transitions (pre → live →
 * final) or its `isCloseGame` status flips. It is NOT a function of
 * `Date.now()`, so dashboard refetches that bring back the same data
 * produce the same sort order, which keeps the ticker rail from
 * snapping every ~30 seconds as games drift across arbitrary clock
 * thresholds (within-1-hour, within-24-hours, within-2-hours-ago).
 *
 * The previous time-bucketed implementation produced 4000-9000px
 * marquee transform jumps on every dashboard refetch when any game
 * crossed a threshold, which the user observed as "weird movement".
 * Continuous time-of-day priority (sooner pre-games surface, more
 * recent finals surface) is now expressed via the secondary sort in
 * `selectSportsForTicker` instead — same UX, no jank.
 */
export function gameEngagement(g: Game): number {
  if (isLive(g)) return isCloseGame(g) ? 100 : 80;
  if (g.state === "pre") return 60;
  if (g.state === "final") return 30;
  return 0;
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Baseline pipeline used by the ticker: applies the day window from the
 * widget config.display blob (v1.1.3 Time Controls — live games always
 * pass), then sorts by engagement (live games first, then upcoming, then
 * finals) with a deterministic tie-break on `start_time` so the ticker
 * rail stays stable across dashboard refetches.
 *
 * Tie-break direction is per-state:
 *   - pre/live   → start_time ASC (sooner / more in-progress first)
 *   - final      → start_time DESC (most recently finished first)
 *
 * This preserves the continuous "closer games matter more" priority the
 * old time-bucketed engagement encoded discretely, without producing a
 * different sort order on every refetch as games drift across clock
 * thresholds.
 *
 * `now` is injectable for tests; production callers omit it.
 */
export function selectSportsForTicker(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
  now: number = Date.now(),
): Game[] {
  return sortForDisplay(onTicker(withinDayWindow(games, config, now), now));
}

/**
 * How long before kickoff an upcoming game earns a ticker slot.
 *
 * The ticker used to show every game in the widget's day window, which is
 * up to a week: three league widgets produced 38 chips, 30 of them from
 * MLS, none of them live. The bar became a fixture list. A horizon rather
 * than a fixed count because it is a rule that can be stated -- "what is
 * on soon" -- and it breathes: a busy Saturday fills the bar and a quiet
 * Tuesday nearly empties it, where a fixed count pads a quiet day with
 * games nobody is thinking about yet.
 *
 * 24h is the line where the chip stops reading as a countdown ("3h05")
 * and starts reading as a date ("1d"), which is also roughly where a
 * fixture stops being something you are about to watch.
 */
export const TICKER_UPCOMING_HOURS = 24;

/**
 * How long a finished game keeps its slot, measured from KICKOFF (not the
 * final whistle -- nothing records that; `updated_at` is the ingester's
 * write time and `make seed` deliberately does not rebase it).
 *
 * 18h so last night's results are still there over breakfast, which is
 * most of the value a final has on a glanceable bar.
 */
export const TICKER_FINAL_HOURS = 18;

/**
 * How far ahead the floor below will reach for a league's next fixture.
 *
 * The floor exists so a league you follow is never absent from the bar.
 * Left unbounded it also surfaced fixtures a month out, which sat beside
 * a 19h chip reading as an arbitrary date rather than as "this is all
 * this league has". A week is the compromise: F1 and Champions League
 * appear in the run-up to a fixture, and a league between seasons stays
 * off the bar entirely rather than advertising a date nobody is thinking
 * about yet.
 */
export const TICKER_FLOOR_DAYS = 7;

/**
 * The ticker's own tightening of the widget's day window.
 *
 * Live games always pass. Everything else has to be near enough in time to
 * be worth a slot on a bar you glance at.
 *
 * The floor matters as much as the horizon: if a league contributes
 * NOTHING, its single soonest fixture is admitted anyway, provided it is
 * within TICKER_FLOOR_DAYS. Without the floor, following Formula 1 --
 * races one to three weeks apart -- would mean an empty bar 13 days in
 * 14, and a widget you deliberately added would silently show nothing at
 * all. Without the cap, it reached a month out and the chip read as an
 * arbitrary date rather than as the league's only news.
 */
function onTicker(games: Game[], now: number): Game[] {
  const kept = games.filter((g) => {
    if (isLive(g)) return true;
    const t = new Date(g.start_time).getTime();
    if (!Number.isFinite(t)) return true; // same defensive stance as inDayWindow
    const hours = (t - now) / 3_600_000;
    return g.state === "final"
      ? hours >= -TICKER_FINAL_HOURS
      : hours >= 0 && hours <= TICKER_UPCOMING_HOURS;
  });
  if (kept.length > 0) return kept;

  const floorLimit = now + TICKER_FLOOR_DAYS * 86_400_000;
  const soonest = games
    .filter((g) => {
      if (g.state !== "pre") return false;
      const t = new Date(g.start_time).getTime();
      return t > now && t <= floorLimit;
    })
    .sort((a, b) => +new Date(a.start_time) - +new Date(b.start_time))[0];
  return soonest ? [soonest] : [];
}

/** The day-window filter, shared by the ticker and the feed. */
function withinDayWindow(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
  now: number,
): Game[] {
  const cfg = config ?? {};
  const daysBack = cfg.daysBack ?? SPORTS_WINDOW_DEFAULTS.daysBack;
  const daysAhead = cfg.daysAhead ?? SPORTS_WINDOW_DEFAULTS.daysAhead;
  return games.filter((g) => inDayWindow(g, daysBack, daysAhead, now));
}

function sortForDisplay(games: Game[]): Game[] {
  return games.sort((a, b) => {
    const eDiff = gameEngagement(b) - gameEngagement(a);
    if (eDiff !== 0) return eDiff;
    // Same engagement bucket — break ties by start_time. Finals sort
    // newest-first; everything else sorts soonest-first.
    const aT = new Date(a.start_time).getTime();
    const bT = new Date(b.start_time).getTime();
    if (a.state === "final" && b.state === "final") return bT - aT;
    return aT - bT;
  });
}

/**
 * Feed-side selector: the same useful default order as the ticker, with
 * favorite teams promoted ahead of live, upcoming, and recent finals.
 */
export function selectSportsForFeed(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
  favoriteTeams: ReadonlySet<string>,
  now: number = Date.now(),
): Game[] {
  // Deliberately NOT selectSportsForTicker: the ticker's near-term horizon
  // is a rule about a glanceable bar. The widget page is where you go to
  // read the whole slate, so it keeps everything the day window allows.
  return sortForDisplay(withinDayWindow(games, config, now)).sort((a, b) => {
    const aFavorite =
      favoriteTeams.has(a.home_team_name) || favoriteTeams.has(a.away_team_name);
    const bFavorite =
      favoriteTeams.has(b.home_team_name) || favoriteTeams.has(b.away_team_name);
    return Number(bFavorite) - Number(aFavorite);
  });
}

// ── Helper: extract sports display config from dashboard ────────

import type { DashboardResponse } from "../../types";

/**
 * Read a sports widget's display config from the dashboard payload.
 *
 * Post-split (migration 000014) each sports league is its own row
 * (sports_nfl, sports_nba, ...) carrying its own display toggles, so the
 * caller passes the widget id it's rendering. The bare "sports" row only
 * exists for legacy un-split configs -- it's the fallback, not the target.
 */
export function getSportsDisplayConfig(
  dashboard: DashboardResponse | null | undefined,
  widgetType?: string,
): SportsDisplayConfig {
  const widgets = dashboard?.widgets ?? [];
  const widget =
    (widgetType
      ? widgets.find((c) => c.widget_type === widgetType)
      : undefined) ?? widgets.find((c) => c.widget_type === "sports");
  return normalizeSportsDisplayConfig(widget?.config?.display);
}

export function normalizeSportsDisplayConfig(
  raw: unknown,
): SportsDisplayConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Legacy mapping (v1.1.3): the retired showUpcoming/showFinal venue
  // toggles collapse into the day window. Only "off" ever hid a category
  // on every surface, so it's the only value whose intent survives:
  //   showFinal: "off"    → daysBack 0  (user didn't want past games)
  //   showUpcoming: "off" → daysAhead 0 (user didn't want future games)
  // Explicit stored day values always win over the legacy inference.
  const legacyUpcoming = migrateVenue(obj.showUpcoming);
  const legacyFinal = migrateVenue(obj.showFinal);

  return {
    daysBack: clampWindowDays(
      obj.daysBack,
      legacyFinal === "off" ? 0 : SPORTS_WINDOW_DEFAULTS.daysBack,
      SPORTS_WINDOW_MAX_DAYS,
    ),
    daysAhead: clampWindowDays(
      obj.daysAhead,
      legacyUpcoming === "off" ? 0 : SPORTS_WINDOW_DEFAULTS.daysAhead,
      SPORTS_WINDOW_MAX_DAYS_AHEAD,
    ),
  };
}

// ── Pure: rotating slots for the ticker ──────────────────────────

/** One position on the rail: a fixed game, or a slot cycling through several. */
export interface TickerSlot {
  /** Stable key. A rotating slot keeps its key while its game changes. */
  key: string;
  game: Game;
  /** Set on rotating slots; the ticker counts this slot's laps under it. */
  rotateSlot?: string;
  /**
   * The longest short names this slot will ever show, so the chip can
   * reserve their width and a swap never resizes it. Absent on fixed
   * games, whose names never change.
   */
  reserveNames?: { away: string; home: string };
}

/**
 * Lay eligible games out as pinned games plus rotating slots.
 *
 * Favourites are pinned: every one of them is on the rail, keyed by the
 * game, exempt from the count. Everything else goes into a pool in the
 * display order (live and close first, then live, soonest upcoming,
 * newest finals) and rotateSlots cycles the slots through it. The
 * reservation is the widest short names in each slot's own class.
 */
export function arrangeTickerSlots(
  eligible: Game[],
  favoriteTeams: ReadonlySet<string>,
  slots: number,
  cycles: Readonly<Record<string, number>>,
  keyPrefix: string,
): TickerSlot[] {
  const pinned: Game[] = [];
  const pool: Game[] = [];
  for (const g of eligible) {
    const fav = favoriteTeams.has(g.home_team_name) || favoriteTeams.has(g.away_team_name);
    (fav ? pinned : pool).push(g);
  }
  const widest = (cls: Game[], pick: (g: Game) => string) =>
    cls.map((g) => teamShortName(g.league, pick(g))).reduce((a, b) => (b.length > a.length ? b : a), "");
  const rotating = rotateSlots(pool, slots, cycles, keyPrefix, (g) => g.id, (cls) => ({
    away: widest(cls, (g) => g.away_team_name),
    home: widest(cls, (g) => g.home_team_name),
  }));
  return [
    ...pinned.map((g) => ({ key: `${keyPrefix}-${g.id}`, game: g })),
    ...rotating.map((r) => ({ key: r.key, game: r.item, rotateSlot: r.rotateSlot, reserveNames: r.reserve })),
  ];
}
