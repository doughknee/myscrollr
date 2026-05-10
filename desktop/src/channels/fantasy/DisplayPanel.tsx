/**
 * Fantasy display preferences — the "/channel/fantasy/display" page.
 *
 * Mirrors the Finance/Sports/RSS DisplayPanel shape (2026-05-09 IA refactor)
 * with two notable differences:
 *
 *   1. Fantasy has 14 venue toggles spread across 4 groups
 *      (Score & status / Standings / Roster / Player stats). All 14
 *      flow through the shared `DisplayItemsGrid` widget, which
 *      handles the section sub-headers automatically.
 *
 *   2. Feed-side rendering of the Fantasy channel uses dedicated
 *      sub-views (MatchupHero, StandingsView, RosterView etc.) which
 *      do NOT currently honor the per-item Venue.feed booleans —
 *      they always show their full layout. Only the ticker side
 *      reads the per-item visibility (via FantasyStatChip). The
 *      Feed preview here therefore renders the canonical
 *      MatchupHero card statically and the helper text spells out
 *      this asymmetry. Fixing it is a follow-up that would propagate
 *      `shouldShowOnFeed` reads through MatchupHero — out of scope
 *      for the live-preview rollout.
 *
 * Sample league:
 *   1. Prefer the user's first dashboard league
 *   2. Fall back to a hardcoded "Sunday Funday" NFL sample with a
 *      live week-5 matchup, full standings entry, and a roster that
 *      lights up every player-stats segment (top scorer, worst
 *      starter, top bench, two injuries) so the user can see every
 *      Display item respond when toggled.
 *
 * Persisted shape unchanged: `Venue` enum (off|feed|ticker|both) +
 * `FantasyDisplayPrefs` legacy boolean fields untouched.
 */
import { useMemo } from "react";
import { Tv } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fantasyLeaguesOptions } from "../../api/queries";
import { useShell } from "../../shell-context";
import {
  Section,
  SegmentedRow,
  ToggleRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
import DisplayItemsGrid from "../../components/settings/DisplayItemsGrid";
import type { DisplayItemsSection } from "../../components/settings/DisplayItemsGrid";
import FollowedPlayersPicker from "../../components/settings/FollowedPlayersPicker";
import type { FantasyDisplayPrefs, Venue } from "../../preferences";
import type { LeagueResponse } from "./types";
import FantasyStatChip from "../../components/chips/FantasyStatChip";
import FollowedPlayerChip from "../../components/chips/FollowedPlayerChip";
import {
  findTopN,
  findTopBench,
  findWorstStarter,
  findInjuredPlayers,
} from "./playerStats";
import { shouldShowOnTicker } from "../../preferences";

// ── Constants ────────────────────────────────────────────────────

const DEFAULTS: FantasyDisplayPrefs = {
  matchupScore: "both",
  winProbability: "both",
  matchupStatus: "both",
  projectedPoints: "both",
  week: "both",
  record: "both",
  standingsPosition: "both",
  streak: "both",
  injuryCount: "both",
  topScorer: "both",
  topThreeScorers: "both",
  worstStarter: "both",
  benchOpportunity: "both",
  injuryDetail: "both",
  // Followed players are user picks — reset clears them.
  followedPlayerKeys: [],
  showStandings: true,
  showMatchups: true,
  defaultSort: "name",
  defaultSubTab: "overview",
  primaryLeagueKey: null,
  enabledLeagueKeys: [],
};

const SUB_TAB_OPTIONS = [
  { value: "overview", label: "Overview" },
  { value: "matchup", label: "Matchup" },
  { value: "standings", label: "Standings" },
  { value: "roster", label: "Roster" },
];

// Keys on FantasyDisplayPrefs that are venue-typed.
type FantasyVenueKey =
  | "matchupScore"
  | "winProbability"
  | "matchupStatus"
  | "projectedPoints"
  | "week"
  | "record"
  | "standingsPosition"
  | "streak"
  | "injuryCount"
  | "topScorer"
  | "topThreeScorers"
  | "worstStarter"
  | "benchOpportunity"
  | "injuryDetail";

interface FantasyVenueRow {
  key: FantasyVenueKey;
  label: string;
  description: string;
}

interface FantasyVenueGroup {
  title: string;
  rows: FantasyVenueRow[];
}

// Visual sub-grouping inside the grid. Three "feeds" + one player-
// stats group match the user's mental model of which segments are
// about live game state, season-wide rank, and roster health.
const FANTASY_VENUE_GROUPS: FantasyVenueGroup[] = [
  {
    title: "Score & status",
    rows: [
      { key: "matchupScore", label: "Matchup score", description: "Your team vs. opponent, live or final" },
      { key: "winProbability", label: "Win probability", description: "62% chance to win" },
      { key: "matchupStatus", label: "Matchup status", description: "LIVE / FINAL / PRE badge" },
      { key: "projectedPoints", label: "Projected points", description: "Your projected total this week" },
      { key: "week", label: "Week number", description: "Current matchup week label" },
    ],
  },
  {
    title: "Standings",
    rows: [
      { key: "record", label: "Team record", description: "Season wins / losses (optionally ties)" },
      { key: "standingsPosition", label: "Standings position", description: "3rd of 10" },
      { key: "streak", label: "Current streak", description: "W3 / L2 badge" },
    ],
  },
  {
    title: "Roster",
    rows: [
      { key: "injuryCount", label: "Injury count", description: "Count of IR / DTD players on your roster" },
      { key: "topScorer", label: "Top scorer", description: "Highest-scoring active player on your team" },
    ],
  },
  {
    title: "Player stats",
    rows: [
      {
        key: "topThreeScorers",
        label: "Top 3 starters",
        description: "Mahomes 32, Hill 18, CMC 14 — each as its own segment",
      },
      {
        key: "worstStarter",
        label: "Lowest starter",
        description: "↓ Andrews 0 — the dud you couldn't sit (red)",
      },
      {
        key: "benchOpportunity",
        label: "Bench leader",
        description: "BN Pacheco 18 — points your bench is producing",
      },
      {
        key: "injuryDetail",
        label: "Injury report",
        description: "🚨 Saquon OUT, Mixon DTD — names + status (max 2 + overflow)",
      },
    ],
  },
];

// Hardcoded sample league. Engineered so every player-stats
// segment has data: 4 starters with declining scores (so top3,
// top, worst all resolve), 1 bench player with points, 2 injured
// players (one OUT, one DTD).
function buildSampleLeague(): LeagueResponse {
  const teamKey = "preview.sample.team";
  const oppKey = "preview.sample.opp";
  return {
    league_key: "preview.sample.league",
    name: "Sunday Funday",
    game_code: "nfl",
    season: "2025",
    team_key: teamKey,
    team_name: "Field Goal Punters",
    data: {
      num_teams: 10,
      is_finished: false,
      current_week: 5,
      scoring_type: "head",
    },
    standings: [
      {
        team_key: teamKey,
        name: "Field Goal Punters",
        team_logo: "",
        manager_name: "You",
        rank: 3,
        wins: 3,
        losses: 1,
        ties: 0,
        points_for: "512.4",
        streak_type: "win",
        streak_value: 2,
        playoff_seed: 3,
        clinched_playoffs: false,
        waiver_priority: 7,
      },
    ],
    matchups: [
      {
        week: 5,
        status: "midevent",
        is_playoffs: false,
        winner_team_key: null,
        teams: [
          {
            team_key: teamKey,
            name: "Field Goal Punters",
            team_logo: "",
            manager_name: "You",
            points: 89.4,
            projected_points: 121.6,
          },
          {
            team_key: oppKey,
            name: "Trick or Cleat",
            team_logo: "",
            manager_name: "Sam",
            points: 76.2,
            projected_points: 108.4,
          },
        ],
      },
    ],
    rosters: [
      {
        team_key: teamKey,
        data: {
          team_key: teamKey,
          team_name: "Field Goal Punters",
          players: [
            {
              player_key: "preview.qb",
              name: { full: "Patrick Mahomes", first: "Patrick", last: "Mahomes" },
              editorial_team_abbr: "KC",
              display_position: "QB",
              selected_position: "QB",
              image_url: "",
              status: null,
              status_full: null,
              injury_note: null,
              player_points: 32.4,
            },
            {
              player_key: "preview.wr1",
              name: { full: "Tyreek Hill", first: "Tyreek", last: "Hill" },
              editorial_team_abbr: "MIA",
              display_position: "WR",
              selected_position: "WR",
              image_url: "",
              status: null,
              status_full: null,
              injury_note: null,
              player_points: 18.2,
            },
            {
              player_key: "preview.rb",
              name: { full: "Christian McCaffrey", first: "Christian", last: "McCaffrey" },
              editorial_team_abbr: "SF",
              display_position: "RB",
              selected_position: "RB",
              image_url: "",
              status: null,
              status_full: null,
              injury_note: null,
              player_points: 14.7,
            },
            {
              player_key: "preview.te",
              name: { full: "Mark Andrews", first: "Mark", last: "Andrews" },
              editorial_team_abbr: "BAL",
              display_position: "TE",
              selected_position: "TE",
              image_url: "",
              status: null,
              status_full: null,
              injury_note: null,
              player_points: 0.0,
            },
            {
              player_key: "preview.bn1",
              name: { full: "Isiah Pacheco", first: "Isiah", last: "Pacheco" },
              editorial_team_abbr: "KC",
              display_position: "RB",
              selected_position: "BN",
              image_url: "",
              status: null,
              status_full: null,
              injury_note: null,
              player_points: 17.8,
            },
            {
              player_key: "preview.ir1",
              name: { full: "Saquon Barkley", first: "Saquon", last: "Barkley" },
              editorial_team_abbr: "PHI",
              display_position: "RB",
              selected_position: "IR",
              image_url: "",
              status: "OUT",
              status_full: "Out — Hamstring",
              injury_note: null,
              player_points: null,
            },
            {
              player_key: "preview.dtd",
              name: { full: "Joe Mixon", first: "Joe", last: "Mixon" },
              editorial_team_abbr: "HOU",
              display_position: "RB",
              selected_position: "BN",
              image_url: "",
              status: "DTD",
              status_full: "Day-to-day",
              injury_note: null,
              player_points: 6.1,
            },
          ],
        },
      },
    ],
  };
}

// ── Component ────────────────────────────────────────────────────

export default function FantasyDisplayPanel() {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.channelDisplay.fantasy;

  // Pull a real league from the user's data so the preview shows
  // something they recognise. Falls back to the engineered sample.
  const { data: leaguesData } = useQuery(fantasyLeaguesOptions());
  const previewLeague: LeagueResponse = useMemo(() => {
    const leagues = leaguesData?.leagues ?? [];
    if (leagues.length === 0) return buildSampleLeague();
    // Prefer leagues with an active matchup so the chip's segments
    // have data; otherwise return the first.
    return leagues.find((l) => l.matchups && l.matchups.length > 0) ?? leagues[0];
  }, [leaguesData?.leagues]);

  // ── Patch helpers ──────────────────────────────────────────────

  function patch(next: Partial<FantasyDisplayPrefs>) {
    onPrefsChange({
      ...prefs,
      channelDisplay: {
        ...prefs.channelDisplay,
        fantasy: { ...dp, ...next },
      },
    });
  }

  function applyDisplayChanges(changes: Record<string, Venue>) {
    patch(changes as Partial<FantasyDisplayPrefs>);
  }

  function toggle(
    key: keyof Pick<FantasyDisplayPrefs, "showStandings" | "showMatchups">,
  ) {
    patch({ [key]: !dp[key] } as Partial<FantasyDisplayPrefs>);
  }

  function handleReset() {
    patch(DEFAULTS);
  }

  // ── Preview player chips ──────────────────────────────────────
  // Mirrors the fantasy bucket builder in ScrollrTicker so the
  // preview shows exactly what'll appear on the rail. Each enabled
  // "Player stats" venue spawns one chip per derived player. Memoized
  // on the league data + prefs so toggling a venue checkbox produces
  // an immediate visual response without re-deriving on every render.

  const previewPlayerChips = useMemo<
    Array<{
      key: string;
      playerKey: string;
      accent: "top" | "worst" | "bench" | "injury";
    }>
  >(() => {
    const userTeam = previewLeague.rosters?.find(
      (r) => r.team_key === previewLeague.team_key,
    );
    if (!userTeam) return [];
    const players = userTeam.data.players;
    const out: Array<{
      key: string;
      playerKey: string;
      accent: "top" | "worst" | "bench" | "injury";
    }> = [];

    if (shouldShowOnTicker(dp.topThreeScorers)) {
      const top3 = findTopN(players, 3, { startersOnly: true });
      const startIdx =
        shouldShowOnTicker(dp.topScorer) && top3.length > 0 ? 1 : 0;
      for (let i = startIdx; i < top3.length; i++) {
        out.push({
          key: `top-${top3[i].player_key}`,
          playerKey: top3[i].player_key,
          accent: "top",
        });
      }
    }

    if (shouldShowOnTicker(dp.worstStarter)) {
      const worst = findWorstStarter(players);
      if (worst) {
        out.push({
          key: `worst-${worst.player_key}`,
          playerKey: worst.player_key,
          accent: "worst",
        });
      }
    }

    if (shouldShowOnTicker(dp.benchOpportunity)) {
      const topBench = findTopBench(players);
      if (topBench) {
        out.push({
          key: `bench-${topBench.player_key}`,
          playerKey: topBench.player_key,
          accent: "bench",
        });
      }
    }

    if (shouldShowOnTicker(dp.injuryDetail)) {
      const injured = findInjuredPlayers(players);
      for (const p of injured) {
        out.push({
          key: `inj-${p.player_key}`,
          playerKey: p.player_key,
          accent: "injury",
        });
      }
    }

    return out;
  }, [
    previewLeague,
    dp.topThreeScorers,
    dp.topScorer,
    dp.worstStarter,
    dp.benchOpportunity,
    dp.injuryDetail,
  ]);

  // ── Display-items grid model ──────────────────────────────────

  const sections: DisplayItemsSection[] = FANTASY_VENUE_GROUPS.map((group) => ({
    title: group.title,
    rows: group.rows.map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      value: dp[row.key],
    })),
  }));

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-8">
      {/* ── Live preview ─────────────────────────────────────────── */}
      {/* Mirrors what ScrollrTicker actually renders for this league:
          the league summary chip, then per-player chips for each
          enabled "Player stats" venue. Each row of chips reacts in
          real time as toggles flip — enabling Top 3 starters spawns
          three chips, etc. PreviewSurface scrolls horizontally if
          there are more chips than fit. */}
      <Section title="Live preview">
        <div className="px-3 pb-1 space-y-3">
          <p className="text-[11px] text-fg-4 leading-snug">
            Toggle any Display item below to watch it appear on the
            ticker. The four "Player stats" venues each spawn their own
            chip(s) so you can scan them individually as the rail
            scrolls. The Fantasy Feed view always shows the full
            matchup card and is unaffected by these toggles.
          </p>

          <PreviewSurface label="Ticker chips" icon={Tv}>
            <div className="flex items-center gap-2">
              <FantasyStatChip
                league={previewLeague}
                prefs={dp}
                comfort
                colorMode="channel"
              />
              {previewPlayerChips.map(({ key, playerKey, accent }) => (
                <FollowedPlayerChip
                  key={key}
                  playerKey={playerKey}
                  leagueKey={previewLeague.league_key}
                  leagues={[previewLeague]}
                  comfort
                  colorMode="channel"
                  accent={accent}
                />
              ))}
            </div>
          </PreviewSurface>
        </div>
      </Section>

      {/* ── Display items grid ───────────────────────────────────── */}
      <DisplayItemsGrid sections={sections} onChange={applyDisplayChanges} />

      {/* ── Followed players ─────────────────────────────────────── */}
      <Section title="Followed players">
        <p className="text-[11px] text-fg-4 px-3 pb-2 leading-snug">
          Pick specific players from your rosters to track on the ticker.
          Each player gets their own chip showing their name, team, and
          current points.
        </p>
        <FollowedPlayersPicker
          followedPlayerKeys={dp.followedPlayerKeys}
          onChange={(next) => patch({ followedPlayerKeys: next })}
        />
      </Section>

      {/* ── Feed layout ─────────────────────────────────────────── */}
      <Section title="Feed layout">
        <SegmentedRow
          label="Default view"
          description="Which sub-tab opens when you enter the Fantasy feed"
          value={dp.defaultSubTab}
          options={SUB_TAB_OPTIONS}
          onChange={(value) =>
            patch({
              defaultSubTab: value as FantasyDisplayPrefs["defaultSubTab"],
            })
          }
        />
        <ToggleRow
          label="Show standings section"
          checked={dp.showStandings}
          onChange={() => toggle("showStandings")}
        />
        <ToggleRow
          label="Show matchups section"
          checked={dp.showMatchups}
          onChange={() => toggle("showMatchups")}
        />
      </Section>

      {/* ── Footer reset ─────────────────────────────────────────── */}
      <div className="flex items-center justify-end pt-2">
        <ResetButton label="Reset display settings" onClick={handleReset} />
      </div>
    </div>
  );
}

// ── Preview surface card ────────────────────────────────────────

interface PreviewSurfaceProps {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}

function PreviewSurface({ label, icon: Icon, children }: PreviewSurfaceProps) {
  return (
    <div className="rounded-lg border border-edge/40 bg-base-200/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/40 bg-surface-2/30">
        <Icon size={11} className="text-fg-4" />
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-4">
          {label}
        </span>
      </div>
      {/* `overflow-x-auto` instead of `overflow-hidden` so any future chip
          that exceeds the surface width is pannable rather than silently
          clipped (the previous bug). `justify-start` keeps the chip flush
          left so its head segments stay visible by default. The vertical
          padding still centers a normal-height chip nicely. */}
      <div className="p-2.5 min-h-[64px] flex items-center justify-start overflow-x-auto scrollbar-thin">
        {children}
      </div>
    </div>
  );
}
