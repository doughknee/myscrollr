import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import clsx from "clsx";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { Ticker } from "motion-plus/react";
import { useMotionValue, animate, AnimatePresence, motion } from "motion/react";
import type { DashboardResponse, Trade, Game, RssItem, WidgetTickerData } from "../types";
import type {
  MixMode,
  ChipColorMode,
  TickerDirection,
  ScrollMode,
  WidgetPinConfig,
  ChannelDisplayPrefs,
  TickerRowConfig,
} from "../preferences";
import { shouldShowOnTicker } from "../preferences";
import type { LeagueResponse as FantasyLeague } from "../channels/fantasy/types";
import TradeChip from "./chips/TradeChip";
import GameChip from "./chips/GameChip";
import RssChip from "./chips/RssChip";
import FantasyStatChip from "./chips/FantasyStatChip";
import FollowedPlayerChip from "./chips/FollowedPlayerChip";
import ConsolidatedChip from "./chips/ConsolidatedChip";
import { selectRssForTicker } from "../channels/rss/view";
import { selectFinanceForTicker } from "../channels/finance/view";
import { selectFantasyForTicker } from "../channels/fantasy/view";
import { selectSportsForTicker, getSportsDisplayConfig } from "../channels/sports/view";
import {
  findTopN,
  findTopBench,
  findWorstStarter,
  findInjuredPlayers,
} from "../channels/fantasy/playerStats";
import { buildYahooLeagueUrl, buildYahooPlayerUrl, chipUrlForFinance, chipUrlForSports, chipUrlForRss } from "../utils/chipUrl";

// ── Module-level constants ───────────────────────────────────────

const WIDGET_TYPES = ["clock", "timer", "weather", "sysmon", "uptime", "github"] as const;
type WidgetType = (typeof WIDGET_TYPES)[number];

// ── Types ────────────────────────────────────────────────────────

interface ScrollrTickerProps {
  dashboard: DashboardResponse | null;
  activeTabs: string[];
  /** Pre-built widget chip data (clock, weather, sysmon). */
  widgetData?: WidgetTickerData;
  /** Click handler. The optional `url` argument is set when the
   * underlying chip has an external destination (article link, game
   * page, etc.). When undefined, the consumer should fall back to
   * opening the in-app channel page. */
  onChipClick?: (channelType: string, itemId: string | number, url?: string) => void;
  /** Toggle pin state for a widget (hover pin icon). */
  onTogglePin?: (widgetId: string) => void;
  /** Which widgets are pinned (excluded from scrolling ticker). */
  pinnedWidgets?: Record<string, WidgetPinConfig>;
  /** Scroll speed in px/sec (default 40) */
  speed?: number;
  /** Gap between chips in px (default 8) */
  gap?: number;
  /** Whether hovering slows the ticker (default true) */
  pauseOnHover?: boolean;
  /** Speed multiplier on hover, 0 = full pause (default 0.3) */
  hoverSpeed?: number;
  /** Show 2-row comfort chips with extra detail */
  comfort?: boolean;
  /** How items from different channels are ordered */
  mixMode?: MixMode;
  /** Chip color scheme */
  chipColorMode?: ChipColorMode;
  /** Per-channel display preferences (controls what data chips show) */
  channelDisplay?: ChannelDisplayPrefs;
  /** Which row this ticker represents (0-indexed, for multi-row splitting) */
  rowIndex?: number;
  /** Total number of ticker rows (items distributed round-robin) */
  totalRows?: number;
  /** Scroll direction: left (default) or right */
  direction?: TickerDirection;
  /** Scroll mode: continuous, step, or flip */
  scrollMode?: ScrollMode;
  /** Seconds to pause between transitions in step/flip modes (default 2) */
  stepPause?: number;
  /**
   * Per-row config for the multi-deck ticker. When present, `sources`
   * lives on `row.sources` (but App.tsx already pre-filtered activeTabs
   * to match) and row-level scroll overrides (Ultimate-only) are read
   * from here. When `undefined`, this behaves like the legacy single-row.
   */
  rowConfig?: TickerRowConfig;
  /**
   * True when `rowConfig.sources` was non-empty AND at least one
   * source was configured. Used to decide whether to show the
   * "empty row" CTA when all of a row's sources get filtered away.
   */
  rowHasExplicitSources?: boolean;
  /**
   * When true, this row should render the "no sources installed yet"
   * empty-shell CTA instead of returning null. Only the parent
   * (App.tsx) knows whether the user is signed-in with zero channels
   * vs. a row that legitimately has nothing to show right now, so the
   * decision is hoisted up there. The parent should set this only on
   * the first row to avoid stacking duplicate CTAs in multi-row
   * layouts.
   */
  showSourcelessCTA?: boolean;
  /** Click handler for the sourceless CTA (opens the catalog). */
  onAddSources?: () => void;
  /**
   * When true, this row should render the "you have channels installed
   * but none are currently on the ticker" CTA — a row of per-channel
   * quick-link chips that open each channel's Configure tab. Mutually
   * exclusive with `showSourcelessCTA`; only one fires at a time.
   * Parent (App.tsx) gates this on first row + authenticated + has
   * installed channels + no ticker-enabled channels + no pinned widgets.
   */
  showInstalledOffCTA?: boolean;
  /**
   * Visual metadata for each installed channel, used to render the
   * per-channel quick-link chips. Empty when `showInstalledOffCTA` is
   * false; non-empty when true. Order should match the canonical
   * channel order from the registry.
   */
  installedChannels?: Array<{
    id: string;
    name: string;
    hex: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }>;
  /** Click handler for the per-channel quick-link chips (opens Configure). */
  onConfigureChannel?: (channelId: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Round-robin interleave across buckets:
 *  bucket0[0], bucket1[0], bucket2[0], bucket0[1], bucket1[1], ... */
function weave<T>(buckets: T[][]): T[] {
  if (buckets.length === 0) return [];
  const result: T[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) result.push(bucket[i]);
    }
  }
  return result;
}

// ── Component ────────────────────────────────────────────────────

export default function ScrollrTicker({
  dashboard,
  activeTabs,
  widgetData,
  onChipClick,
  onTogglePin,
  pinnedWidgets = {},
  speed = 25,
  gap = 8,
  pauseOnHover = true,
  hoverSpeed = 0.3,
  mixMode = "grouped",
  chipColorMode = "channel",
  channelDisplay,
  comfort = false,
  rowIndex = 0,
  totalRows = 1,
  direction = "left",
  scrollMode = "continuous",
  stepPause = 5,
  rowConfig,
  rowHasExplicitSources = false,
  showSourcelessCTA = false,
  onAddSources,
  showInstalledOffCTA = false,
  installedChannels = [],
  onConfigureChannel,
}: ScrollrTickerProps) {
  // Per-row overrides shadow the globals. The Ultimate-gate is enforced
  // upstream — Settings only lets Ultimate/super_user WRITE these fields,
  // so reading them unconditionally here is safe. (If a downgraded user
  // still has row overrides in their prefs, we honour them until they
  // edit the row — no surprise resets.)
  const effectiveScrollMode: ScrollMode = rowConfig?.scrollMode ?? scrollMode;
  const effectiveDirection: TickerDirection = rowConfig?.direction ?? direction;
  const effectiveSpeed: number = rowConfig?.speed ?? speed;
  const effectiveMixMode: MixMode = rowConfig?.mixMode ?? mixMode;
  // Build chip arrays per channel/widget, then combine based on mixMode.
  // Row filtering (multi-deck) happens UPSTREAM in App.tsx — activeTabs
  // here is already the per-row source list. No round-robin split.
  const chips = useMemo(() => {
    const wrap = (key: string, chip: React.ReactNode) => (
      <div key={key} className="py-1">
        {chip}
      </div>
    );

    const buckets: React.ReactNode[][] = [];

    for (const tab of activeTabs) {
      const bucket: React.ReactNode[] = [];

      // Pinned widgets never scroll — they render in a pinned zone on
      // their assigned row (pin.row). See render-time pinned loop below.
      const isPinnedAnywhere = !!pinnedWidgets[tab];

      // ── Widget tabs: consolidated chips (skip if pinned) ────────
      if (WIDGET_TYPES.includes(tab as WidgetType)) {
        const wt = tab as WidgetType;
        const items = widgetData?.[wt];
        if (items?.length && !isPinnedAnywhere) {
          bucket.push(
            wrap(`${wt}-consolidated`,
              <ConsolidatedChip
                type={wt}
                items={items}
                comfort={comfort}
                colorMode={chipColorMode}
                onTogglePin={onTogglePin ? () => onTogglePin(wt) : undefined}
                // Widget chips don't have a meaningful external URL —
                // omit the third argument so handleChipClick falls back
                // to opening the desktop app on the widget's page.
                onClick={() => onChipClick?.(wt, wt)}
              />
            )
          );
          buckets.push(bucket);
        }
        continue;
      }

      // ── Channel tabs: use dashboard.data ──────────────────────
      const data = dashboard?.data?.[tab];

      // Fantasy arrives as a structured { leagues: [...] } object, so it
      // needs its own branch before the generic array check below.
      // Uses `selectFantasyForTicker` which honours enabledLeagueKeys +
      // primaryLeagueKey from Display prefs — so the ticker stays in sync
      // with the Fantasy feed page.
      if (tab === "fantasy") {
        const fantasyPayload = data as { leagues?: unknown } | undefined;
        const leagues = Array.isArray(fantasyPayload?.leagues)
          ? (fantasyPayload.leagues as FantasyLeague[])
          : [];
        if (leagues.length === 0) continue;
        const fantasyPrefs = channelDisplay?.fantasy;
        if (!fantasyPrefs) continue;

        // ── Followed-player chips render FIRST so the user's tracked
        //    players lead the fantasy bucket. They render even when
        //    the league-summary chips are gated off (the user
        //    explicitly opted in to per-player tracking).
        // Pre-build a player → owning-league lookup so we can resolve
        // each player's `game_code` (canonical Yahoo sport name like
        // "nfl") for URL construction. Yahoo's `player_key` prefix is
        // a numeric game id, not the sport name, so we MUST use the
        // owning league's `game_code` field to build a working URL.
        const playerToLeagueGameCode = new Map<string, string>();
        for (const lg of leagues) {
          if (!lg.rosters) continue;
          for (const roster of lg.rosters) {
            for (const player of roster.data.players) {
              if (player.player_key) {
                playerToLeagueGameCode.set(player.player_key, lg.game_code);
              }
            }
          }
        }
        for (const playerKey of fantasyPrefs.followedPlayerKeys ?? []) {
          const playerGameCode = playerToLeagueGameCode.get(playerKey);
          bucket.push(
            wrap(`follow-${playerKey}`,
              <FollowedPlayerChip
                playerKey={playerKey}
                leagues={leagues}
                comfort={comfort}
                colorMode={chipColorMode}
                onClick={() => onChipClick?.("fantasy", playerKey, buildYahooPlayerUrl(playerKey, playerGameCode))}
              />
            )
          );
        }

        const ranked = selectFantasyForTicker(leagues, fantasyPrefs);
        for (const league of ranked) {
          // 1. The league summary chip itself (matchup-level: score,
          //    week, win-prob, record, standings, top scorer, etc).
          bucket.push(
            wrap(`fan-${league.league_key}`,
              <FantasyStatChip
                league={league}
                prefs={fantasyPrefs}
                comfort={comfort}
                colorMode={chipColorMode}
                onClick={() => onChipClick?.("fantasy", league.league_key, buildYahooLeagueUrl(league.league_key, league.game_code))}
              />
            )
          );

          // 2. Per-player chips derived from the user's roster in this
          //    league. Each "Player stats" venue toggle that's enabled
          //    on the ticker spawns one FollowedPlayerChip per derived
          //    player. Render order mirrors the Display prefs grouping:
          //    top scorers (top3), worst starter, bench leader,
          //    injury report.
          //
          //    Skip this whole block if the league has no roster (rare
          //    pre-import or partial-sync state).
          const userTeam = league.rosters?.find((r) => r.team_key === league.team_key);
          if (!userTeam) continue;
          const players = userTeam.data.players;

          if (shouldShowOnTicker(fantasyPrefs.topThreeScorers)) {
            const top3 = findTopN(players, 3, { startersOnly: true });
            // Skip top1 if topScorer is also enabled — it's already on
            // the league chip as "★ Mahomes 32" and would duplicate.
            const startIdx = shouldShowOnTicker(fantasyPrefs.topScorer) && top3.length > 0 ? 1 : 0;
            for (let i = startIdx; i < top3.length; i++) {
              const p = top3[i];
              bucket.push(
                wrap(`fan-${league.league_key}-top-${p.player_key}`,
                  <FollowedPlayerChip
                    playerKey={p.player_key}
                    leagueKey={league.league_key}
                    leagues={leagues}
                    comfort={comfort}
                    colorMode={chipColorMode}
                    accent="top"
                    onClick={() => onChipClick?.("fantasy", p.player_key, buildYahooPlayerUrl(p.player_key, league.game_code))}
                  />
                )
              );
            }
          }

          if (shouldShowOnTicker(fantasyPrefs.worstStarter)) {
            const worst = findWorstStarter(players);
            if (worst) {
              bucket.push(
                wrap(`fan-${league.league_key}-worst-${worst.player_key}`,
                  <FollowedPlayerChip
                    playerKey={worst.player_key}
                    leagueKey={league.league_key}
                    leagues={leagues}
                    comfort={comfort}
                    colorMode={chipColorMode}
                    accent="worst"
                    onClick={() => onChipClick?.("fantasy", worst.player_key, buildYahooPlayerUrl(worst.player_key, league.game_code))}
                  />
                )
              );
            }
          }

          if (shouldShowOnTicker(fantasyPrefs.benchOpportunity)) {
            const topBench = findTopBench(players);
            if (topBench) {
              bucket.push(
                wrap(`fan-${league.league_key}-bench-${topBench.player_key}`,
                  <FollowedPlayerChip
                    playerKey={topBench.player_key}
                    leagueKey={league.league_key}
                    leagues={leagues}
                    comfort={comfort}
                    colorMode={chipColorMode}
                    accent="bench"
                    onClick={() => onChipClick?.("fantasy", topBench.player_key, buildYahooPlayerUrl(topBench.player_key, league.game_code))}
                  />
                )
              );
            }
          }

          if (shouldShowOnTicker(fantasyPrefs.injuryDetail)) {
            const injured = findInjuredPlayers(players);
            for (const p of injured) {
              bucket.push(
                wrap(`fan-${league.league_key}-inj-${p.player_key}`,
                  <FollowedPlayerChip
                    playerKey={p.player_key}
                    leagueKey={league.league_key}
                    leagues={leagues}
                    comfort={comfort}
                    colorMode={chipColorMode}
                    accent="injury"
                    onClick={() => onChipClick?.("fantasy", p.player_key, buildYahooPlayerUrl(p.player_key, league.game_code))}
                  />
                )
              );
            }
          }
        }

        // Only push the bucket when something is actually in it (no
        // league chips AND no followed players → empty bucket → skip).
        if (bucket.length > 0) buckets.push(bucket);
        continue;
      }

      if (!Array.isArray(data) || data.length === 0) continue;

      switch (tab) {
        case "finance": {
          // Apply Display prefs: `defaultSort` affects both feed and
          // ticker (universal sort). Per-field visibility (showChange,
          // showPrevClose, showLastUpdated) consults the Venue enum —
          // the ticker only renders what's set to "both" or "ticker".
          const financePrefs = channelDisplay?.finance;
          if (!financePrefs) continue;
          const sorted = selectFinanceForTicker(data as Trade[], financePrefs);
          for (const trade of sorted) {
            bucket.push(
              wrap(`fin-${trade.symbol}`,
                <TradeChip
                  trade={trade}
                  comfort={comfort}
                  colorMode={chipColorMode}
                  showChange={shouldShowOnTicker(financePrefs.showChange)}
                  directionMarker={financePrefs.tickerDirectionMarker ?? "arrow"}
                  onClick={() => onChipClick?.("finance", trade.symbol, chipUrlForFinance(trade))}
                />
              )
            );
          }
          break;
        }

        case "sports": {
          // Sports display prefs live server-side on channel config.display.
          // Per-field visibility uses the Venue enum mirroring the client-
          // only channels; read each field through shouldShowOnTicker.
          const sportsConfig = getSportsDisplayConfig(dashboard);
          const showLogos = shouldShowOnTicker(sportsConfig.showLogos ?? "both");
          const showTimer = shouldShowOnTicker(sportsConfig.showTimer ?? "both");
          const sorted = selectSportsForTicker(data as Game[], sportsConfig);
          for (const game of sorted) {
            bucket.push(
              wrap(`spo-${game.id}`,
                <GameChip
                  game={game}
                  comfort={comfort}
                  colorMode={chipColorMode}
                  showLogos={showLogos}
                  showTimer={showTimer}
                  onClick={() => onChipClick?.("sports", game.id, chipUrlForSports(game))}
                />
              )
            );
          }
          break;
        }

        case "rss": {
          // Apply Display prefs: `articlesPerSource` is feed-structural
          // but still applies universally (both surfaces cap at the same
          // per-source count). Per-field visibility (showSource, etc.)
          // consults the Venue enum.
          const rssPrefs = channelDisplay?.rss;
          if (!rssPrefs) continue;
          const curated = selectRssForTicker(data as RssItem[], rssPrefs);
          for (const item of curated) {
            bucket.push(
              wrap(`rss-${item.id}`,
                <RssChip
                  item={item}
                  comfort={comfort}
                  colorMode={chipColorMode}
                  showSource={shouldShowOnTicker(rssPrefs.showSource)}
                  showTimestamps={shouldShowOnTicker(rssPrefs.showTimestamps)}
                  onClick={() => onChipClick?.("rss", item.id, chipUrlForRss(item))}
                />
              )
            );
          }
          break;
        }

      }

      buckets.push(bucket);
    }

    // Combine based on mix mode. Row filtering is handled upstream now,
    // so no round-robin distribution here.
    const allItems: React.ReactNode[] = effectiveMixMode === "weave"
      ? weave(buckets)
      : buckets.flat();

    return allItems;
  }, [dashboard, activeTabs, widgetData, onChipClick, onTogglePin, pinnedWidgets, comfort, effectiveMixMode, chipColorMode, channelDisplay, rowIndex]);

  // ── Shared refs ─────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveredRef = useRef(false);

  // ── Step mode: external offset driven by async animate loop ──
  const offset = useMotionValue(0);
  const stepLoopRef = useRef(false);

  const transitionDuration = speedToTransitionDuration(effectiveSpeed);

  // Measure the width of the first ticker item + gap to determine step size.
  // Queries .ticker-item inside containerRef — works because <Ticker> renders
  // its items as descendants of our wrapper div. Only called once per step
  // cycle (~5s apart), not in a tight loop, so the layout read is safe.
  const measureStepSize = useCallback((): number => {
    const container = containerRef.current;
    if (!container) return 200; // fallback
    const firstItem = container.querySelector(".ticker-item") as HTMLElement | null;
    if (!firstItem) return 200;
    return firstItem.offsetWidth + gap;
  }, [gap]);

  // Reset step offset when entering step mode or when direction changes,
  // so the ticker doesn't start from a stale accumulated position.
  useEffect(() => {
    if (effectiveScrollMode === "step") offset.set(0);
  }, [effectiveScrollMode, effectiveDirection, offset]);

  // Step loop: animate offset by one item width, pause, repeat
  useEffect(() => {
    if (effectiveScrollMode !== "step" || chips.length === 0) return;

    stepLoopRef.current = true;
    let cancelled = false;

    async function stepLoop() {
      // Small delay to let DOM render and measure
      await sleep(500);

      while (!cancelled && stepLoopRef.current) {
        // Skip advancing while hovered and pauseOnHover is enabled
        if (pauseOnHover && isHoveredRef.current) {
          await sleep(100);
          continue;
        }

        const stepSize = measureStepSize();
        const sign = effectiveDirection === "left" ? 1 : -1;
        const current = offset.get();
        const target = current + sign * stepSize;

        // Animate one step — duration derived from unified speed slider
        await animate(offset, target, {
          duration: transitionDuration,
          ease: [0.25, 0.1, 0.25, 1],
        });

        if (cancelled) break;

        // Pause between steps
        await sleep(stepPause * 1000);
      }
    }

    stepLoop();

    return () => {
      cancelled = true;
      stepLoopRef.current = false;
    };
  }, [effectiveScrollMode, effectiveDirection, stepPause, pauseOnHover, effectiveSpeed, chips.length, measureStepSize, offset, transitionDuration]);

  // ── Flip mode: paginated vertical slide ───────────────────────
  const [flipPage, setFlipPage] = useState(0);

  // Estimate how many chips fit visually, then rotate the array
  const visibleCount = useMemo(() => {
    const containerWidth = containerRef.current?.clientWidth ?? 1200;
    const avgChipWidth = comfort ? 180 : 120;
    return Math.max(1, Math.floor(containerWidth / (avgChipWidth + gap)));
  }, [comfort, gap, chips.length]); // re-estimate when chip count changes

  const flipChips = useMemo(() => {
    if (chips.length === 0) return [];
    const shift = (flipPage * visibleCount) % chips.length;
    return [...chips.slice(shift), ...chips.slice(0, shift)];
  }, [chips, flipPage, visibleCount]);

  // Flip timer: cycle pages on stepPause interval.
  // Also resets flipPage when chips change (chips.length in deps triggers
  // cleanup → fresh start) avoiding a separate effect with ordering concerns.
  useEffect(() => {
    if (effectiveScrollMode !== "flip" || chips.length === 0) return;

    setFlipPage(0);

    const timer = setInterval(() => {
      if (pauseOnHover && isHoveredRef.current) return;
      setFlipPage((p) => p + 1);
    }, stepPause * 1000);

    return () => clearInterval(timer);
  }, [effectiveScrollMode, stepPause, pauseOnHover, chips.length]);

  // ── Build pinned chip arrays (rendered inside this row) ─────────
  //
  // Pinned widgets are visually static, single-instance elements. With
  // multi-deck layout, each pin targets exactly one row (pin.row). This
  // replaces the old "only render on row 0" bandaid — now we scope by
  // pin.row so users can pin widgets to any row independently.

  const pinnedLeft: React.ReactNode[] = [];
  const pinnedRight: React.ReactNode[] = [];

  for (const [widgetId, pin] of Object.entries(pinnedWidgets)) {
    if ((pin.row ?? 0) !== rowIndex) continue;
    const target = pin.side === "left" ? pinnedLeft : pinnedRight;

    if (WIDGET_TYPES.includes(widgetId as WidgetType)) {
      const wt = widgetId as WidgetType;
      const items = widgetData?.[wt];
      if (items?.length) {
        target.push(
          <ConsolidatedChip
            key={`pinned-${wt}`}
            type={wt}
            items={items}
            comfort={comfort}
            colorMode={chipColorMode}
            pinned
            onTogglePin={onTogglePin ? () => onTogglePin(wt) : undefined}
            // Widget chips don't have a meaningful external URL —
            // omit the third argument so handleChipClick falls back
            // to opening the desktop app on the widget's page.
            onClick={() => onChipClick?.(wt, wt)}
          />
        );
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────
  const hasPinnedLeft = pinnedLeft.length > 0;
  const hasPinnedRight = pinnedRight.length > 0;
  const hasScrollingChips = chips.length > 0;

  // Empty-row CTA: the user explicitly configured sources for this row
  // but none of them produced any chips (e.g. they deleted the channel
  // from their subscription). Show a dismissible CTA rather than silently
  // pretending the row doesn't exist — per spec §Edge Cases #1.
  const isEmptyRowWithExplicitSources =
    !hasScrollingChips && !hasPinnedLeft && !hasPinnedRight && rowHasExplicitSources;

  // Sourceless CTA: signed-in user has zero channels installed and zero
  // pinned widgets, so there's literally nothing to put on the ticker.
  // Instead of returning `null` (which makes the ticker invisible and
  // the user wonder what they're supposed to do next), render an empty
  // bar with a single inline CTA that opens the catalog. The decision
  // of *when* to show this is hoisted to App.tsx — see `showSourcelessCTA`.
  const isSourceless =
    !hasScrollingChips && !hasPinnedLeft && !hasPinnedRight && showSourcelessCTA;

  // Installed-but-ticker-off CTA: signed-in user has channels installed
  // but none are currently flagged for the ticker (every channel's
  // `ticker_enabled` is false). Show a row of per-channel quick-link
  // chips so the user can jump straight to that channel's Configure
  // tab and flip the toggle. This is the "you have stuff, you just
  // turned it off" recovery state.
  const isInstalledButTickerOff =
    !hasScrollingChips
    && !hasPinnedLeft
    && !hasPinnedRight
    && showInstalledOffCTA
    && installedChannels.length > 0;

  const containerClass = `ticker-container ${comfort ? "h-16" : "h-11"} flex items-center bg-base-150 border-b border-edge/50 flex-shrink-0 relative w-full overflow-hidden`;

  if (isSourceless) {
    return (
      <div className={containerClass}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10" />
        <div className="flex flex-col items-center justify-center gap-0.5 w-full h-full px-4 min-w-0">
          {/* Primary row: headline + action hint + catalog button */}
          <div className="flex items-center justify-center gap-2 min-w-0">
            <span className="text-ui-meta font-medium text-fg-2 shrink-0">
              You haven&rsquo;t added any sources yet.
            </span>
            <span className="text-ui-meta text-fg-4 shrink-0 hidden sm:inline">
              Browse the catalog to add one:
            </span>
            <button
              type="button"
              onClick={onAddSources}
              disabled={!onAddSources}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md shrink-0",
                "px-2.5 py-1 text-ui-meta font-semibold",
                "text-accent bg-accent/10 hover:bg-accent/15",
                "border border-accent/25 hover:border-accent/40",
                "transition-colors active:scale-[0.97]",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
              Browse the catalog
            </button>
          </div>
          {/* Secondary row: teaching tip pointing at the sidebar's
              + Add source button. Same suppression rule as the
              installed-off variant — compact ticker hides it for room. */}
          {comfort && (
            <p className="text-[10px] text-fg-4/80 shrink-0 leading-tight hidden md:inline-flex items-center gap-1">
              <span className="text-fg-4">Tip:</span>
              <span>use</span>
              <span
                className={clsx(
                  "inline-flex items-center gap-0.5 align-baseline",
                  "px-1 py-px rounded",
                  "bg-fg-4/10 text-fg-2 font-semibold",
                )}
              >
                + Add source
              </span>
              <span>in the sidebar to do this yourself next time.</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (isInstalledButTickerOff) {
    return (
      <div className={containerClass}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10" />
        <div className="flex flex-col items-center justify-center gap-0.5 w-full h-full px-4 min-w-0">
          {/* Primary row: headline + action hint + per-channel chips */}
          <div className="flex items-center justify-center gap-2 min-w-0">
            <span className="text-ui-meta font-medium text-fg-2 shrink-0">
              Your ticker is empty right now.
            </span>
            <span className="text-ui-meta text-fg-4 shrink-0 hidden sm:inline">
              Open a source to pick what shows up here:
            </span>
            <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto scrollbar-none">
              {installedChannels.map((ch) => {
                const ChannelIcon = ch.icon;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => onConfigureChannel?.(ch.id)}
                    disabled={!onConfigureChannel}
                    className={clsx(
                      "inline-flex items-center gap-1.5 shrink-0 rounded-md",
                      "px-2 py-1 text-ui-meta font-semibold",
                      "border transition-colors active:scale-[0.97]",
                      "disabled:opacity-50 disabled:pointer-events-none",
                    )}
                    style={{
                      color: ch.hex,
                      backgroundColor: `${ch.hex}14`,   // ~8% alpha
                      borderColor: `${ch.hex}3D`,       // ~24% alpha
                    }}
                    title={`Configure ${ch.name}`}
                  >
                    <ChannelIcon size={12} className="shrink-0" />
                    <span className="truncate">{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Secondary row: teaching tip pointing at the "Options"
              pill in the TopBar. Hidden on the compact ticker (h-11
              ≈ 44px) because there's no room for a second line without
              cramping; comfort mode (h-16 ≈ 64px) has plenty. The
              equivalent tip is also shown on every channel's empty
              feed (see EmptyChannelState.tsx), so users still discover
              the pill there even when this row is suppressed. */}
          {comfort && (
            <p className="text-[10px] text-fg-4/80 shrink-0 leading-tight hidden md:inline-flex items-center gap-1">
              <span className="text-fg-4">Tip:</span>
              <span>open a source and click</span>
              <span
                className={clsx(
                  "inline-flex items-center gap-1 align-baseline",
                  "px-1 py-px rounded",
                  "bg-fg-4/10 text-fg-2 font-semibold",
                )}
              >
                <Settings2 size={8} strokeWidth={2.5} aria-hidden="true" />
                Options
                <ChevronDown size={8} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span>in the title bar to do this yourself next time.</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  if (isEmptyRowWithExplicitSources) {
    return (
      <div className={containerClass}>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10" />
        <div className="flex items-center justify-center w-full h-full px-4 text-ui-meta font-mono text-fg-3">
          <span>This row has no sources to show. Edit it in Settings &rarr; Ticker.</span>
        </div>
      </div>
    );
  }

  // Nothing to show at all
  if (!hasScrollingChips && !hasPinnedLeft && !hasPinnedRight) return null;
  const accentLine = (
    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent z-10" />
  );

  const pinnedZone = (side: "left" | "right", items: React.ReactNode[]) =>
    items.length > 0 ? (
      <div
        className={clsx(
          "ticker-pinned-zone flex items-center shrink-0 h-full z-10 px-2 bg-base-150",
          side === "left" ? "border-r" : "border-l",
          "border-edge/30",
        )}
        style={{ gap }}
      >
        {items}
      </div>
    ) : null;

  // ── Flip mode: AnimatePresence with vertical slide ────────────
  if (effectiveScrollMode === "flip") {
    return (
      <div
        ref={containerRef}
        className={containerClass}
        onMouseEnter={() => { isHoveredRef.current = true; }}
        onMouseLeave={() => { isHoveredRef.current = false; }}
      >
        {accentLine}
        {pinnedZone("left", pinnedLeft)}
        <div className="ticker-scroll-wrapper">
          <AnimatePresence mode="wait">
            <motion.div
              key={flipPage}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-100%", opacity: 0 }}
              transition={{ duration: transitionDuration, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex items-center h-full"
              style={{ gap }}
            >
              {flipChips}
            </motion.div>
          </AnimatePresence>
        </div>
        {pinnedZone("right", pinnedRight)}
      </div>
    );
  }

  // ── Continuous / Step mode: motion-plus Ticker ────────────────
  const velocity = effectiveDirection === "left" ? effectiveSpeed : -effectiveSpeed;
  const isStepMode = effectiveScrollMode === "step";

  return (
    <div
      ref={containerRef}
      className={containerClass}
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => { isHoveredRef.current = false; }}
    >
      {accentLine}
      {pinnedZone("left", pinnedLeft)}
      <div className="ticker-scroll-wrapper">
        <Ticker
          items={chips}
          velocity={isStepMode ? 0 : velocity}
          offset={isStepMode ? offset : undefined}
          hoverFactor={isStepMode ? 1 : (pauseOnHover ? hoverSpeed : 1)}
          gap={gap}
          fade={hasPinnedLeft || hasPinnedRight ? 20 : 40}
        />
      </div>
      {pinnedZone("right", pinnedRight)}
    </div>
  );
}

// ── Helpers (module-level) ───────────────────────────────────────

/** Promise-based sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Map speed slider (5–150) to transition duration for step/flip modes.
 *  speed 5 → ~1.2s (crawl), speed 25 → ~0.9s (default),
 *  speed 60 → ~0.55s, speed 150 → ~0.15s (blazing). */
function speedToTransitionDuration(speed: number): number {
  return Math.max(0.15, 1.2 - (speed - 5) * 0.0072);
}
