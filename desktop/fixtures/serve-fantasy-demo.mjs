#!/usr/bin/env node
/**
 * Fantasy demo backend — serves a deterministic `MyLeaguesResponse` so
 * the fantasy widget can be screenshotted out of season.
 *
 * WHY THIS EXISTS
 * The fantasy UI is only interesting during an NFL week. From February
 * to September every real league is empty, so marketing captures of the
 * fantasy widget are impossible for two thirds of the year. This serves
 * a fixed Week 12 scenario instead, against the REAL app — no mock
 * components, no edited pixels, just seeded data.
 *
 * HONESTY BOUNDARY — read before using a capture from this.
 * The player names are real; the stat lines are REPRESENTATIVE, not a
 * verified historical box score. Do not caption a screenshot from this
 * with "no edits", "live", or a specific real date. Caption it as a
 * demo league (e.g. "DEMO LEAGUE · WEEK 12 · SEEDED DATA"). The app in
 * the shot is genuinely the app; the week in it never happened exactly
 * this way. Those are different claims and only the first one is safe.
 * If you want a real box score in here, replace a ROSTER below with
 * actual numbers — the arithmetic downstream is source-agnostic.
 *
 * Avatars are generated monograms, never synthetic faces. Inventing a
 * stat line for a real player is a demo; inventing their photograph is
 * something else.
 *
 * HOW IT WORKS
 * This is a PROXY, not a stub. It overrides the two endpoints the
 * fantasy ACCOUNT panel calls (/users/me/yahoo-status and
 * /users/me/yahoo-leagues), grafts the same payload onto
 * `data.fantasy` in /dashboard (which is where the TABS read from),
 * and forwards everything else untouched to the real local core-api.
 * Auth, the widget catalog, entitlements, and SSE all keep working.
 *
 * Do NOT use VITE_DEMO=1 for this. That flag is Kalshi-specific: it
 * pins the widget list to ["predictions"] when the dashboard is empty
 * (desktop/src/App.tsx) and reroutes /dashboard to the predictions
 * bridge — it would hide the fantasy widget entirely. Sign in normally;
 * the proxy passes your real token through.
 *
 * USAGE
 *   make up                                       # real stack on :18080
 *   node desktop/fixtures/serve-fantasy-demo.mjs
 *   cd desktop && npm run tauri:dev:fantasy-demo  # vite + native window
 *
 *   --port N       listen elsewhere (default 8788)
 *   --upstream URL proxy target (default http://localhost:18080)
 *   --emit         dump the JSON payload and exit
 *   --live         let the live players drift (see below). OFF by
 *                  default: a recording shouldn't shift under you, and
 *                  a static server is one you never have to restart.
 */

import { createServer, request as httpRequest } from 'node:http'
import {
  PANEL_HTML,
  applyControl,
  controlState,
  emptyOps,
  nudgeFrame,
} from './control-panel.mjs'

// ── Scoring ──────────────────────────────────────────────────────
// Yahoo NFL stat_ids. Full PPR. Every point total in the payload is
// COMPUTED from these modifiers rather than typed by hand — a fantasy
// player reading the screenshot will check that the stat line and the
// score agree, and hand-entered totals never do.
const STAT_CATALOG = {
  stats: [
    { stat_id: '4', display_name: 'Pass Yds', name: 'Passing Yards', position_type: 'O', sort_order: 1, display_only: false },
    { stat_id: '5', display_name: 'Pass TD', name: 'Passing Touchdowns', position_type: 'O', sort_order: 2, display_only: false },
    { stat_id: '6', display_name: 'Int', name: 'Interceptions', position_type: 'O', sort_order: 3, display_only: false },
    { stat_id: '9', display_name: 'Rush Yds', name: 'Rushing Yards', position_type: 'O', sort_order: 4, display_only: false },
    { stat_id: '10', display_name: 'Rush TD', name: 'Rushing Touchdowns', position_type: 'O', sort_order: 5, display_only: false },
    { stat_id: '11', display_name: 'Rec', name: 'Receptions', position_type: 'O', sort_order: 6, display_only: false },
    { stat_id: '12', display_name: 'Rec Yds', name: 'Receiving Yards', position_type: 'O', sort_order: 7, display_only: false },
    { stat_id: '13', display_name: 'Rec TD', name: 'Receiving Touchdowns', position_type: 'O', sort_order: 8, display_only: false },
    { stat_id: '18', display_name: 'Fum Lost', name: 'Fumbles Lost', position_type: 'O', sort_order: 9, display_only: false },
    // Kicking — position_type 'K'. The Roster view groups by
    // position_type, so these have to carry it to land in their own table.
    { stat_id: '19', display_name: 'FG 0-19', name: 'Field Goals 0-19 Yards', position_type: 'K', sort_order: 10, display_only: false },
    { stat_id: '20', display_name: 'FG 20-29', name: 'Field Goals 20-29 Yards', position_type: 'K', sort_order: 11, display_only: false },
    { stat_id: '21', display_name: 'FG 30-39', name: 'Field Goals 30-39 Yards', position_type: 'K', sort_order: 12, display_only: false },
    { stat_id: '22', display_name: 'FG 40-49', name: 'Field Goals 40-49 Yards', position_type: 'K', sort_order: 13, display_only: false },
    { stat_id: '23', display_name: 'FG 50+', name: 'Field Goals 50+ Yards', position_type: 'K', sort_order: 14, display_only: false },
    { stat_id: '24', display_name: 'PAT', name: 'Point After Attempt Made', position_type: 'K', sort_order: 15, display_only: false },
    // Defense / Special Teams — position_type 'D'.
    { stat_id: '29', display_name: 'Sack', name: 'Sacks', position_type: 'D', sort_order: 16, display_only: false },
    { stat_id: '30', display_name: 'Int', name: 'Interceptions', position_type: 'D', sort_order: 17, display_only: false },
    { stat_id: '31', display_name: 'Fum Rec', name: 'Fumble Recoveries', position_type: 'D', sort_order: 18, display_only: false },
    { stat_id: '32', display_name: 'Ret TD', name: 'Return Touchdowns', position_type: 'D', sort_order: 19, display_only: false },
    { stat_id: '33', display_name: 'Safety', name: 'Safeties', position_type: 'D', sort_order: 20, display_only: false },
    // Points allowed scores on a bracket, not a rate, so it can't carry a
    // flat modifier. Shown in the table, scored via ptsAllowedBonus().
    { stat_id: '34', display_name: 'Pts Allow', name: 'Points Allowed', position_type: 'D', sort_order: 21, display_only: true },
  ],
  modifiers: {
    4: 0.04, 5: 4, 6: -1, 9: 0.1, 10: 6, 11: 1, 12: 0.1, 13: 6, 18: -2,
    19: 3, 20: 3, 21: 3, 22: 4, 23: 5, 24: 1,
    29: 1, 30: 2, 31: 2, 32: 6, 33: 2,
  },
}

/**
 * Standard Yahoo points-allowed bracket for a D/ST. Derived from the
 * number the table displays, so the column and the score still agree —
 * the same rule the rest of the fixture follows.
 */
function ptsAllowedBonus(allowed) {
  const n = Number(allowed)
  if (Number.isNaN(n)) return 0
  if (n === 0) return 10
  if (n <= 6) return 7
  if (n <= 13) return 4
  if (n <= 20) return 1
  if (n <= 27) return 0
  if (n <= 34) return -1
  return -4
}

const round2 = (n) => Math.round(n * 100) / 100

/** points = Σ stat × modifier (+ D/ST bracket), at Yahoo's 2dp precision. */
function scoreOf(stats) {
  let total = 0
  for (const [id, raw] of Object.entries(stats)) {
    const mod = STAT_CATALOG.modifiers[id]
    if (mod == null) continue
    const val = Number(raw)
    if (!Number.isNaN(val)) total += val * mod
  }
  if (stats['34'] != null) total += ptsAllowedBonus(stats['34'])
  return round2(total)
}

// ── Avatars ──────────────────────────────────────────────────────
// Yahoo serves real crests and headshots from its CDN. Those URLs are
// useless here (offline, and hotlinking someone else's CDN into a demo
// is rude), and empty strings make every component fall back to a blank
// placeholder — which is what made the first capture look broken.
// Inline SVG data URIs render as genuine <img> content, need no
// network, and are permitted by the Tauri CSP (img-src includes data:).
const svgUri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** Stable hue per string, so a team keeps its colour across renders. */
function hueOf(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

const initialsOf = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** Team crest — monogram on a tinted rounded square. */
function teamLogo(name) {
  const h = hueOf(name)
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="14" fill="hsl(${h} 58% 44%)"/>` +
      `<text x="32" y="42" text-anchor="middle" font-family="system-ui,sans-serif" ` +
      `font-size="26" font-weight="700" fill="#ffffff">${initialsOf(name)}</text></svg>`,
  )
}

/** Player disc — monogram, deliberately NOT a synthetic face. */
function playerAvatar(name) {
  const h = hueOf(name)
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<circle cx="32" cy="32" r="32" fill="hsl(${h} 34% 30%)"/>` +
      `<text x="32" y="41" text-anchor="middle" font-family="system-ui,sans-serif" ` +
      `font-size="24" font-weight="600" fill="hsl(${h} 45% 88%)">${initialsOf(name)}</text></svg>`,
  )
}

// ── Rosters ──────────────────────────────────────────────────────
// `pending: true` = has not played yet: no stats, scores 0 so far, and
// `proj` feeds the projected total. Everything else is derived.
const ROSTERS = {
  // Sunday evening: the afternoon slate is final, one starter is still
  // to play the night game. Behind, but projected to pass them.
  //
  // Sunday rather than Monday so the Today window has something in it —
  // on a Monday every Sunday stat belongs to yesterday, and the Today
  // table would be an empty grid.
  sunday: [
    { pos: 'QB', name: 'Jalen Hurts', team: 'PHI', dp: 'QB', stats: { 4: 260, 5: 2, 6: 1, 9: 47, 10: 1 }, proj: 21.4, game: 'Final' },
    { pos: 'WR', name: 'Ja’Marr Chase', team: 'CIN', dp: 'WR', stats: { 11: 9, 12: 121, 13: 1 }, proj: 19.8 },
    { pos: 'WR', name: 'Nico Collins', team: 'HOU', dp: 'WR', stats: { 11: 5, 12: 74 }, proj: 14.1, thursday: true },
    { pos: 'RB', name: 'Bijan Robinson', team: 'ATL', dp: 'RB', stats: { 9: 88, 10: 1, 11: 4, 12: 31 }, proj: 18.9 },
    { pos: 'RB', name: 'Kenneth Walker III', team: 'SEA', dp: 'RB', stats: { 9: 31, 11: 1, 12: 8 }, proj: 13.2, live: true, game: 'Q2 5:18' },
    { pos: 'TE', name: 'Trey McBride', team: 'ARI', dp: 'TE', stats: { 11: 4, 12: 39 }, proj: 12.6, live: true, game: 'Q2 5:18' },
    { pos: 'W/R/T', name: 'Jaxon Smith-Njigba', team: 'SEA', dp: 'WR', stats: { 11: 6, 12: 83, 13: 1 }, proj: 15.5 },
    // The live one. 8.30 banked of a 14.2 projection, so 5.90 still to
    // come — which is what makes the hero read "need 7.2 more".
    { pos: 'W/R/T', name: 'De’Von Achane', team: 'MIA', dp: 'RB', stats: { 9: 43, 11: 2, 12: 20 }, proj: 14.2, live: true, game: 'Q3 8:42' },
    { pos: 'K', name: 'Jake Elliott', team: 'PHI', dp: 'K', stats: { 20: 1, 21: 1, 22: 1, 24: 1 }, proj: 8.5, game: 'Final' },
    { pos: 'DEF', name: 'Denver Broncos', team: 'DEN', dp: 'DEF', stats: { 29: 3, 30: 1, 31: 1, 34: 17 }, proj: 7.8, game: 'Final' },
    { pos: 'BN', name: 'Tank Dell', team: 'HOU', dp: 'WR', stats: {}, proj: 9.4, status: 'Q', status_full: 'Questionable', injury_note: 'Hamstring — limited in Friday practice' },
    { pos: 'BN', name: 'Tyjae Spears', team: 'TEN', dp: 'RB', stats: { 9: 31, 11: 1, 12: 9 }, proj: 7.8 },
    { pos: 'BN', name: 'Jordan Addison', team: 'MIN', dp: 'WR', stats: { 11: 4, 12: 52 }, proj: 11.2 },
    { pos: 'IR', name: 'Rashee Rice', team: 'KC', dp: 'WR', stats: {}, proj: 0, status: 'IR', status_full: 'Injured Reserve', injury_note: 'Knee' },
  ],
  // Finished Sunday. Comfortable win — the "week went right" view.
  dynasty: [
    { pos: 'QB', name: 'Josh Allen', team: 'BUF', dp: 'QB', stats: { 4: 317, 5: 3, 9: 62, 10: 1 }, proj: 24.1 },
    { pos: 'WR', name: 'Justin Jefferson', team: 'MIN', dp: 'WR', stats: { 11: 11, 12: 148, 13: 1 }, proj: 21.6 },
    { pos: 'WR', name: 'Malik Nabers', team: 'NYG', dp: 'WR', stats: { 11: 8, 12: 96 }, proj: 16.4 },
    { pos: 'RB', name: 'Jahmyr Gibbs', team: 'DET', dp: 'RB', stats: { 9: 104, 10: 2, 11: 3, 12: 22 }, proj: 19.7, thursday: true },
    { pos: 'RB', name: 'Breece Hall', team: 'NYJ', dp: 'RB', stats: { 9: 61, 11: 5, 12: 44 }, proj: 15.1 },
    { pos: 'TE', name: 'Brock Bowers', team: 'LV', dp: 'TE', stats: { 11: 9, 12: 101, 13: 1 }, proj: 16.8 },
    { pos: 'W/R/T', name: 'Puka Nacua', team: 'LAR', dp: 'WR', stats: { 11: 7, 12: 88 }, proj: 15.9 },
    { pos: 'W/R/T', name: 'Chase Brown', team: 'CIN', dp: 'RB', stats: { 9: 73, 11: 4, 12: 29 }, proj: 13.4 },
    { pos: 'BN', name: 'Rome Odunze', team: 'CHI', dp: 'WR', stats: { 11: 3, 12: 41 }, proj: 10.1 },
    { pos: 'BN', name: 'Tucker Kraft', team: 'GB', dp: 'TE', stats: { 11: 4, 12: 46 }, proj: 9.2 },
    { pos: 'BN', name: 'Jaylen Warren', team: 'PIT', dp: 'RB', stats: { 9: 44, 11: 2, 12: 15 }, proj: 8.6 },
  ],
  // Live, narrowly behind with two left. The uncomfortable one.
  work: [
    { pos: 'QB', name: 'Baker Mayfield', team: 'TB', dp: 'QB', stats: { 4: 244, 5: 2, 6: 1 }, proj: 18.2 },
    { pos: 'WR', name: 'Amon-Ra St. Brown', team: 'DET', dp: 'WR', stats: { 11: 8, 12: 79, 13: 1 }, proj: 18.3, thursday: true },
    { pos: 'WR', name: 'DK Metcalf', team: 'PIT', dp: 'WR', stats: { 11: 4, 12: 61 }, proj: 13.7 },
    { pos: 'RB', name: 'Josh Jacobs', team: 'GB', dp: 'RB', stats: { 9: 79, 10: 1, 11: 2, 12: 14 }, proj: 16.2 },
    { pos: 'RB', name: 'Chuba Hubbard', team: 'CAR', dp: 'RB', stats: { 9: 38, 11: 2, 12: 14 }, proj: 12.9, live: true, game: 'Q2 5:18' },
    { pos: 'TE', name: 'Sam LaPorta', team: 'DET', dp: 'TE', stats: { 11: 5, 12: 52 }, proj: 11.4 },
    { pos: 'W/R/T', name: 'Courtland Sutton', team: 'DEN', dp: 'WR', stats: { 11: 3, 12: 44 }, proj: 12.1, live: true, game: 'Q3 11:02' },
    { pos: 'BN', name: 'Zay Flowers', team: 'BAL', dp: 'WR', stats: { 11: 6, 12: 71 }, proj: 12.8 },
    { pos: 'BN', name: 'Isiah Pacheco', team: 'KC', dp: 'RB', stats: {}, proj: 6.4, status: 'D', status_full: 'Doubtful', injury_note: 'Ankle — did not practice Friday' },
    { pos: 'BN', name: 'Jerry Jeudy', team: 'CLE', dp: 'WR', stats: { 11: 3, 12: 38 }, proj: 9.9 },
  ],

  // ── Opponents ──────────────────────────────────────────────────
  // Without these, league.rosters had a single entry: MatchupView
  // rendered "Roster not available yet" for the opponent and
  // RosterView's team selector had nothing but your own team in it.
  //
  // No player appears on both sides of the same league — two managers
  // can't roster the same person, and that is the first thing anyone
  // who plays fantasy would notice.
  sundayOpp: [
    { pos: 'QB', name: 'Patrick Mahomes', team: 'KC', dp: 'QB', stats: { 4: 220, 5: 2, 6: 1 }, proj: 22.8, game: 'Final' },
    { pos: 'WR', name: 'CeeDee Lamb', team: 'DAL', dp: 'WR', stats: { 11: 10, 12: 134, 13: 1 }, proj: 20.4 },
    { pos: 'WR', name: 'Garrett Wilson', team: 'NYJ', dp: 'WR', stats: { 11: 7, 12: 82 }, proj: 15.2 },
    { pos: 'RB', name: 'Saquon Barkley', team: 'PHI', dp: 'RB', stats: { 9: 121, 10: 1, 11: 2, 12: 17 }, proj: 20.1 },
    { pos: 'RB', name: 'James Cook', team: 'BUF', dp: 'RB', stats: { 9: 67, 10: 1, 11: 3, 12: 24 }, proj: 14.8, thursday: true },
    { pos: 'TE', name: 'George Kittle', team: 'SF', dp: 'TE', stats: { 11: 3, 12: 41 }, proj: 14.2, live: true, game: 'Q2 5:18' },
    { pos: 'W/R/T', name: 'Davante Adams', team: 'LAR', dp: 'WR', stats: { 11: 5, 12: 54 }, proj: 16.1, live: true, game: 'Q3 11:02' },
    { pos: 'W/R/T', name: 'Kyren Williams', team: 'LAR', dp: 'RB', stats: { 9: 58, 11: 3, 12: 21 }, proj: 13.6 },
    { pos: 'K', name: 'Brandon Aubrey', team: 'DAL', dp: 'K', stats: { 22: 1, 23: 1, 24: 3 }, proj: 9.6, game: 'Final' },
    { pos: 'DEF', name: 'Houston Texans', team: 'HOU', dp: 'DEF', stats: { 29: 3, 30: 2, 34: 10 }, proj: 8.4, game: 'Final' },
    { pos: 'BN', name: 'Khalil Shakir', team: 'BUF', dp: 'WR', stats: { 11: 5, 12: 48 }, proj: 10.4, thursday: true },
    { pos: 'BN', name: 'Cade Otton', team: 'TB', dp: 'TE', stats: { 11: 4, 12: 39 }, proj: 8.1 },
  ],
  dynastyOpp: [
    { pos: 'QB', name: 'Lamar Jackson', team: 'BAL', dp: 'QB', stats: { 4: 188, 5: 3, 9: 54, 10: 1 }, proj: 23.4 },
    { pos: 'WR', name: 'Drake London', team: 'ATL', dp: 'WR', stats: { 11: 9, 12: 118, 13: 1 }, proj: 15.8 },
    { pos: 'WR', name: 'Tee Higgins', team: 'CIN', dp: 'WR', stats: { 11: 5, 12: 63, 13: 1 }, proj: 14.6 },
    { pos: 'RB', name: 'Derrick Henry', team: 'BAL', dp: 'RB', stats: { 9: 131, 10: 2, 11: 1, 12: 6 }, proj: 18.2 },
    { pos: 'RB', name: 'Bucky Irving', team: 'TB', dp: 'RB', stats: { 9: 77, 11: 3, 12: 26 }, proj: 12.4 },
    { pos: 'TE', name: 'Mark Andrews', team: 'BAL', dp: 'TE', stats: { 11: 6, 12: 62, 13: 1 }, proj: 11.1 },
    { pos: 'W/R/T', name: 'Jameson Williams', team: 'DET', dp: 'WR', stats: { 11: 4, 12: 58 }, proj: 12.9 },
    { pos: 'W/R/T', name: 'Tony Pollard', team: 'TEN', dp: 'RB', stats: { 9: 41, 11: 2, 12: 19 }, proj: 10.7 },
    { pos: 'BN', name: 'Wan’Dale Robinson', team: 'NYG', dp: 'WR', stats: { 11: 6, 12: 43 }, proj: 10.2 },
  ],
  workOpp: [
    { pos: 'QB', name: 'Jared Goff', team: 'DET', dp: 'QB', stats: { 4: 278, 5: 2, 6: 1 }, proj: 17.6 },
    { pos: 'WR', name: 'Terry McLaurin', team: 'WAS', dp: 'WR', stats: { 11: 8, 12: 94, 13: 1 }, proj: 14.3 },
    { pos: 'WR', name: 'Jaylen Waddle', team: 'MIA', dp: 'WR', stats: { 11: 4, 12: 77 }, proj: 12.8 },
    { pos: 'RB', name: 'De’Von Achane', team: 'MIA', dp: 'RB', stats: { 9: 27, 11: 1, 12: 11 }, proj: 14.2, live: true, game: 'Q2 5:18' },
    { pos: 'RB', name: 'Rhamondre Stevenson', team: 'NE', dp: 'RB', stats: { 9: 63, 11: 2, 12: 12 }, proj: 12.1 },
    { pos: 'TE', name: 'Dalton Kincaid', team: 'BUF', dp: 'TE', stats: { 11: 3, 12: 34 }, proj: 9.4, thursday: true },
    { pos: 'W/R/T', name: 'Calvin Ridley', team: 'TEN', dp: 'WR', stats: { 11: 4, 12: 57 }, proj: 12.2 },
    { pos: 'BN', name: 'Romeo Doubs', team: 'GB', dp: 'WR', stats: { 11: 3, 12: 31 }, proj: 8.8 },
  ],

}

const BENCH = new Set(['BN', 'IR', 'IL', 'NA'])
const isStarter = (p) => !BENCH.has(p.selected_position)

/** display_position -> Yahoo position_type. Everything else is offense. */
const POSITION_TYPE = { K: 'K', DEF: 'D', 'D/ST': 'D', DST: 'D' }

/**
 * Game state for a player who wasn't given one explicitly.
 *
 * Hand-tagging every player is data entry that drifts the moment a
 * roster changes, and leaving it blank was worse than it looked: the
 * Roster view's GAME column read "—" for 57 of 64 players and the
 * ON THE FIELD strip had exactly one card in it. The state is already
 * implied by whether they played and when, so derive it.
 *
 * `live` players always carry an explicit clock — there's no honest way
 * to invent a quarter.
 */
function derivedGameState(p, played) {
  if (p.live) return null // must be explicit; see `game` on the roster
  if (played) return p.thursday ? 'Final · Thu' : 'Final'
  // Ruled out, not waiting to play. Giving an IR player a kickoff time
  // is a small lie the Roster view would print in bold as "Sun 8:20 PM"
  // next to their OUT badge.
  if (p.pos === 'IR' || p.status === 'IR' || p.status === 'O') return null
  return 'Sun 8:20 PM'
}

/** Yahoo ships stat values as STRINGS — see the note on RosterPlayer. */
const asStatMap = (stats) =>
  Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)]))
/** "-" means "no data for this coverage window", not zero. */
const BLANK_STATS = Object.fromEntries(
  STAT_CATALOG.stats.map((s) => [s.stat_id, '-']),
)

function buildPlayers(roster, idBase) {
  return roster.map((p, i) => {
    const played = !p.pending && Object.keys(p.stats).length > 0
    const [first, ...rest] = p.name.split(' ')
    return {
      player_key: `449.p.${idBase + i}`,
      player_id: idBase + i,
      name: { full: p.name, first, last: rest.join(' ') },
      editorial_team_abbr: p.team,
      display_position: p.dp,
      selected_position: p.pos,
      eligible_positions: [p.dp],
      // Drives groupByPositionType, which is what splits the Roster view
      // into its Offense / Kickers / Defense tables.
      position_type: POSITION_TYPE[p.dp] ?? 'O',
      image_url: playerAvatar(p.name),
      // NOT a Yahoo field. Per-player game state has to come from a join
      // against the sports service (team abbr -> clock/kickoff) that
      // doesn't exist yet; the fixture is currently its only provider so
      // the live treatments have something to render. gameStateForPlayer()
      // is the seam that reads it, and every view degrades to "—" when
      // it's absent — which is exactly what real data does today.
      game_state: p.game ?? derivedGameState(p, played),
      status: p.status ?? null,
      status_full: p.status_full ?? null,
      injury_note: p.injury_note ?? null,
      player_points: played ? scoreOf(p.stats) : 0,
      // Per-player projection. Yahoo's roster payload may not carry this
      // for NFL — flagged in the handoff's data requirements — but the
      // redesign shows "proj N" under every points cell, so the fixture
      // supplies it and the UI renders "—" wherever it's missing.
      projected_points: p.proj ?? null,
      player_stats: played ? asStatMap(p.stats) : BLANK_STATS,
      // The Today toggle reads player_stats_today, and RosterView
      // disables the toggle outright when no player has any (see
      // hasTodayStats). Omitting it is why Today was greyed out.
      //
      // The scenario is Sunday evening, so for anyone whose game was
      // today the week window and the today window are the same numbers.
      // Players marked `thursday: true` played earlier in the week —
      // they keep week stats but have nothing for today, which is what
      // makes the two windows visibly different instead of identical.
      player_stats_today: played && !p.thursday ? asStatMap(p.stats) : BLANK_STATS,
    }
  })
}

/**
 * Banked + projected for a roster, derived so views can't disagree.
 *
 * Three player states, not two. A `pending` starter contributes their
 * whole projection; a `live` one contributes only what's LEFT of it
 * (proj minus what they've already banked), floored at zero so a player
 * outperforming his projection can't drag the total down. Treating live
 * players as pending would double-count the points already on the board.
 */
function totalsFor(roster, players) {
  const byName = new Map(players.map((p) => [p.name.full, p]))
  const banked = round2(
    players.filter(isStarter).reduce((n, p) => n + (p.player_points ?? 0), 0),
  )
  const remaining = round2(
    roster
      .filter((p) => (p.pending || p.live) && !BENCH.has(p.pos))
      .reduce((n, p) => {
        const scored = byName.get(p.name)?.player_points ?? 0
        return n + Math.max(0, p.proj - scored)
      }, 0),
  )
  return { banked, projected: round2(banked + remaining), remaining }
}

/**
 * One league, fully populated — standings, matchup, and roster.
 *
 * `margin` is the opponent's lead over the user's BANKED total, so the
 * storyline survives edits to the roster above: change a stat line and
 * the deficit stays put instead of silently inverting (which it did on
 * the first pass, turning "down eleven" into "up 0.62").
 */
function buildLeague({
  key, name, teamId, teamName, oppName, margin, week, status,
  rosterName, oppRosterName, idBase, rivals,
}) {
  const teamKey = `${key}.t.${teamId}`
  const oppKey = `${key}.t.99`
  const roster = ROSTERS[rosterName]
  const players = buildPlayers(roster, idBase)
  const { banked, projected } = totalsFor(roster, players)

  // The opponent's score is now the sum of THEIR starters, not
  // `banked + margin`. Once they have a visible roster, a header
  // number that didn't reconcile to it would be the most obvious
  // possible tell in a screenshot.
  const oppRoster = ROSTERS[oppRosterName]
  const oppPlayers = buildPlayers(oppRoster, idBase + 500)
  const oppTotals = totalsFor(oppRoster, oppPlayers)
  const oppPoints = oppTotals.banked

  // `margin` is now an ASSERTION about the intended storyline rather
  // than an input. Editing any stat line above re-derives both totals,
  // and if that silently flips "down eleven" into "up two" — which it
  // did once already — this fails loudly instead of shipping a
  // screenshot that contradicts the copy pointing at it.
  const actual = round2(oppPoints - banked)
  if (Math.abs(actual - margin) > 0.005) {
    throw new Error(
      `[fantasy-demo] ${name}: intended margin ${margin} but rosters produce ${actual}. ` +
        `Adjust a stat line, or update the expected margin if the new story is the one you want.`,
    )
  }
  const final = status === 'postevent'

  // Sorted by wins, then points-for — the usual Yahoo tiebreak — so
  // rank/seed follow from the records instead of being asserted.
  const rows = [
    [teamName, teamKey, teamId, ...rivals.userRecord],
    [oppName, oppKey, 99, ...rivals.oppRecord],
    ...rivals.others.map((r, i) => [
      r[0], `${key}.t.${10 + i}`, 10 + i, r[1], r[2], r[3], r[4],
    ]),
  ]
    .sort((a, b) => b[3] - a[3] || b[5] - a[5])
  const table = rows.map(([tName, tKey, tId, w, l, pf, pa], i) => ({
      team_key: tKey,
      team_id: tId,
      name: tName,
      team_logo: teamLogo(tName),
      manager_name: tKey === teamKey ? 'You' : `Manager ${tId}`,
      rank: i + 1,
      wins: w,
      losses: l,
      ties: 0,
      percentage: (w / (w + l)).toFixed(3),
      points_for: pf,
      // Season history, not derivable from one week's payload, so it's
      // explicit data like the records. Yahoo ships it as a string.
      points_against: String(pa),
      streak_type: i % 2 === 0 ? 'win' : 'loss',
      streak_value: (i % 3) + 1,
      playoff_seed: i < Math.ceil(rows.length / 2) ? i + 1 : null,
      clinched_playoffs: i < 2,
      waiver_priority: rows.length - i,
  }))

  return {
    league_key: key,
    name,
    game_code: 'nfl',
    season: '2025',
    team_key: teamKey,
    team_name: teamName,
    data: {
      // Derived from the table, never asserted — a hardcoded count that
      // disagreed with the rows it summarises is exactly the kind of
      // detail that makes a screenshot look fabricated.
      num_teams: table.length,
      is_finished: false,
      current_week: week,
      scoring_type: 'head',
      stat_catalog: STAT_CATALOG,
    },
    standings: table,
    matchups: [
      {
        week,
        week_start: '2025-11-20',
        week_end: '2025-11-24',
        status,
        is_playoffs: false,
        is_consolation: false,
        is_tied: false,
        winner_team_key: final ? (banked > oppPoints ? teamKey : oppKey) : null,
        teams: [
          { team_key: teamKey, team_id: teamId, name: teamName, team_logo: teamLogo(teamName), manager_name: 'You', points: banked, projected_points: projected },
          { team_key: oppKey, team_id: 99, name: oppName, team_logo: teamLogo(oppName), manager_name: 'D. Ramos', points: oppPoints, projected_points: oppTotals.projected },
        ],
      },
    ],
    previous_matchups: null,
    rosters: [
      { team_key: teamKey, data: { team_key: teamKey, team_name: teamName, players } },
      { team_key: oppKey, data: { team_key: oppKey, team_name: oppName, players: oppPlayers } },
    ],
  }
}

const LEAGUES = [
  buildLeague({
    key: '449.l.884213', name: 'The Sunday Money League', teamId: 4,
    teamName: 'Brunch Money', oppName: 'Fourth and Long',
    // Four starters still on the field across both sides, so the
    // deficit is small and the projection genuinely in play — which is
    // the state the redesign was built to make readable.
    margin: 1.8, week: 12, status: 'midevent',
    rosterName: 'sunday', oppRosterName: 'sundayOpp', idBase: 30000,
    rivals: {
      userRecord: [8, 3, 1289.44, 1204.9],
      oppRecord: [8, 3, 1301.08, 1188.62],
      others: [
        ['Waiver Wire Villains', 7, 4, 1244.9, 1198.3],
        ['Sunday Scaries', 7, 4, 1198.62, 1176.04],
        ['The Autodrafters', 6, 5, 1210.16, 1221.5],
        ['Zero RB Truthers', 5, 6, 1155.38, 1209.7],
        ['Bench Warmers', 4, 7, 1102.74, 1244.18],
        ['Punt Returners', 2, 9, 1017.2, 1288.6],
      ],
    },
  }),
  buildLeague({
    key: '449.l.220417', name: 'Dynasty or Bust', teamId: 3,
    teamName: 'Regression Candidates', oppName: 'Air Yards Only',
    margin: -33.46, week: 12, status: 'postevent',
    rosterName: 'dynasty', oppRosterName: 'dynastyOpp', idBase: 31000,
    rivals: {
      userRecord: [9, 2, 1402.3, 1188.02],
      oppRecord: [5, 6, 1188.44, 1240.9],
      others: [
        ['Dead Cap Dynasty', 8, 3, 1355.1, 1244.7],
        ['Rebuild Forever', 7, 4, 1290.66, 1266.2],
        ['Taxi Squad', 6, 5, 1240.02, 1258.44],
        ['Contend Now', 6, 5, 1233.5, 1249.8],
        ['Draft Capital', 4, 7, 1150.8, 1301.06],
        ['Win-Now Window', 3, 8, 1098.42, 1330.5],
      ],
    },
  }),
  buildLeague({
    key: '449.l.671902', name: 'Work League (Keeper)', teamId: 6,
    teamName: 'Third and Inches', oppName: 'Gridiron Ghosts',
    // Now AHEAD by 7.24 with two of your own still playing and one of
    // theirs — a lead you can still lose, which reads differently on the
    // card than the deficit in the other live league.
    margin: -7.24, week: 12, status: 'midevent',
    rosterName: 'work', oppRosterName: 'workOpp', idBase: 32000,
    rivals: {
      userRecord: [6, 5, 1176.9, 1190.44],
      oppRecord: [7, 4, 1204.18, 1166.3],
      others: [
        ['Copier Jam', 8, 3, 1288.44, 1180.2],
        ['HR Violations', 7, 4, 1221.06, 1198.5],
        ['The Cubicles', 5, 6, 1160.3, 1204.66],
        ['Standing Desk', 5, 6, 1142.88, 1188.9],
        ['Out of Office', 4, 7, 1099.5, 1240.34],
        ['Reply All', 3, 8, 1044.62, 1288.1],
      ],
    },
  }),
]

const payload = { leagues: LEAGUES }

// ── Live drift ───────────────────────────────────────────────────
// A static fixture can't demo anything that MOVES, and half the
// redesign is about movement: the points flash, the spine glow, the
// in-play chip appearing and leaving, the breaking-injury chip that by
// design only fires when a status CHANGES. On a frozen payload
// reconcileInjuries never sees a change and that chip can never render.
//
// So the base payload above stays deterministic — the margin guard and
// `--emit` both read it untouched, which is what keeps the assertions
// meaningful — and this transform is applied per REQUEST on top. The
// demo evolves; the thing under test doesn't.
//
// Deliberately a pure function of elapsed time rather than a mutating
// timer: two requests one second apart get the same answer, so a
// reload mid-demo doesn't jump the story sideways.
//
// OFF unless --live. Drift is useful for showing that the live
// treatments animate, and actively unhelpful while recording: numbers
// move between takes, the scenario ages out, and getting back to the
// opening state means restarting the server. Static is the default
// because that's the common case.

const STARTED_AT = process.hrtime.bigint()
const elapsedSeconds = () =>
  Number((process.hrtime.bigint() - STARTED_AT) / 1_000_000_000n)

/**
 * Q3 8:42 winding down on the SAME clock the points climb on, so the
 * two agree: when he reaches his projection the quarter is over. Tying
 * them to different rates had the quarter ending while he still had
 * two thirds of his day left to score.
 */
function driftedClock(progress) {
  const startSec = 8 * 60 + 42
  const remaining = Math.max(0, Math.round(startSec * (1 - progress)))
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  return remaining === 0 ? 'Q4 0:00' : `Q3 ${mmss}`
}

/**
 * Advance the live player toward his projection and flip a bench
 * injury partway through, then recompute every total that depends on
 * either. Recomputing is the whole point — a drifting player whose
 * team total stayed put would put the header and the roster table into
 * visible disagreement, which is the exact failure this fixture exists
 * to avoid.
 */
function applyLiveDrift(base, elapsed) {
  // 8.30 -> 14.20 over two minutes, then holds. Ceiling is his
  // projection: a demo that runs all afternoon shouldn't end with a
  // running back on 400 points.
  const progress = Math.min(1, elapsed / 120)
  const livePoints = round2(8.3 + (14.2 - 8.3) * progress)
  const clock = driftedClock(progress)
  // The injury lands at 20s — long enough to see the rail before it
  // changes, short enough that nobody waits around for it.
  const injuryBroken = elapsed >= 20

  const leagues = base.leagues.map((league) => {
    const rosters = (league.rosters ?? []).map((roster) => {
      let changed = false
      const players = roster.data.players.map((player) => {
        let next = player
        if (player.game_state && /^q[1-4]/i.test(player.game_state)) {
          next = { ...next, player_points: livePoints, game_state: clock }
          changed = true
        }
        if (injuryBroken && player.name.full === 'Tank Dell') {
          next = {
            ...next,
            status: 'O',
            status_full: 'Out',
            injury_note: 'Hamstring — ruled out during warmups',
          }
          changed = true
        }
        return next
      })
      return changed
        ? { ...roster, data: { ...roster.data, players } }
        : roster
    })

    // Re-derive the matchup from the drifted rosters so the header can
    // never disagree with the table under it.
    const matchups = (league.matchups ?? []).map((m) => ({
      ...m,
      teams: m.teams.map((team) => {
        const roster = rosters.find((r) => r.team_key === team.team_key)
        if (!roster) return team
        const starters = roster.data.players.filter(
          (pl) => !BENCH.has(pl.selected_position),
        )
        if (!starters.some((pl) => /^q[1-4]/i.test(pl.game_state ?? ''))) {
          return team
        }
        const points = round2(
          starters.reduce((n, pl) => n + (pl.player_points ?? 0), 0),
        )
        // Projection is banked + whatever the live player has left.
        const remaining = round2(Math.max(0, 14.2 - livePoints))
        return {
          ...team,
          points,
          projected_points: round2(points + remaining),
        }
      }),
    }))

    return { ...league, rosters, matchups }
  })

  return { leagues }
}

// ── Serve ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
if (args.includes('--emit')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(0)
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : fallback
}
const LIVE = args.includes('--live')
const PORT = Number(flag('port', 8788))
const UPSTREAM = new URL(flag('upstream', 'http://localhost:18080'))

// Whole-response overrides. These two feed the fantasy ACCOUNT panel
// (YahooConnectFlow / ConnectedView).
/**
 * Whatever the control panel has been clicked into. Layered ON TOP of
 * the drift rather than replacing it, so a hand-applied touchdown and a
 * drifting live player coexist instead of one clobbering the other.
 */
let ops = emptyOps()

/** The payload as served: drifted only when --live, then panel ops. */
const currentPayload = () =>
  applyControl(LIVE ? applyLiveDrift(payload, elapsedSeconds()) : payload, ops)

/**
 * Open SSE clients. The app polls /dashboard every 30-60s, which is far
 * too slow to click a button and film the result — but useDashboardCDC
 * re-fetches within a second of any yahoo_* record arriving on SSE. So
 * every panel action writes one synthetic frame here.
 */
const sseClients = new Set()

/** SSE frame terminator — a blank line ends a frame. */
const BREAK = "\n\n"

function nudgeClients() {
  const frame = nudgeFrame()
  for (const res of sseClients) res.write(frame)
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

/** Panel routes. Returns true if it handled the request. */
async function control(req, res, path) {
  if (path === '/' || path === '/control') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PANEL_HTML)
    return true
  }
  if (path === '/control/state') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(controlState(currentPayload())))
    return true
  }
  if (path === '/control/op') {
    const op = await readJson(req)
    if (op.type === 'reset') ops = emptyOps()
    else if (op.type === 'points' && op.player) {
      ops.points[op.player] = round2((ops.points[op.player] ?? 0) + Number(op.delta || 0))
    } else if (op.type === 'out' && op.player) ops.out[op.player] = true
    else if (op.type === 'final' && op.league) ops.final[op.league] = true
    console.log(`[fantasy-demo] control ${op.type} ${op.player ?? op.league ?? ''}`)
    nudgeClients()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return true
  }
  return false
}

const OVERRIDES = {
  '/users/me/yahoo-status': () => ({ connected: true, synced: true }),
  '/users/me/yahoo-leagues': () => currentPayload(),
}

// Response rewrites. The fantasy TABS (Overview / Matchup / Standings /
// Roster) do NOT read /users/me/yahoo-leagues — FeedTab pulls them out
// of `dashboard.data.fantasy` (see extractLeagues in
// desktop/src/datawidgets/fantasy/FeedTab.tsx). Overriding only the
// yahoo-* endpoints therefore fills the account panel and leaves every
// tab empty, which is exactly the symptom it produced.
//
// So /dashboard is proxied for real and the fantasy slice is grafted
// onto the upstream body, keeping widgets[], entitlements, and every
// other source intact.
const TRANSFORMS = {
  '/dashboard': (body) => {
    body.data = body.data ?? {}
    body.data.fantasy = currentPayload()
    return body
  },
}

// Plain http.request rather than fetch: it pipes response bodies
// straight through, which keeps SSE (/events) working. fetch would
// force us to hand-manage the stream for no benefit.
function proxy(req, res, path, transform) {
  const headers = { ...req.headers, host: UPSTREAM.host }
  // A transform has to parse the body, so ask upstream not to compress
  // it. Untransformed responses keep the client's original encoding.
  if (transform) delete headers['accept-encoding']
  const upstreamReq = httpRequest(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port,
      method: req.method,
      path,
      headers,
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502
      // Stream anything we're not rewriting — this is what keeps SSE
      // (/events) working.
      if (!transform || status !== 200) {
        res.writeHead(status, upstreamRes.headers)
        upstreamRes.pipe(res)
        return
      }
      const chunks = []
      upstreamRes.on('data', (c) => chunks.push(c))
      upstreamRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let out
        try {
          out = JSON.stringify(transform(JSON.parse(raw)))
          console.log(`[fantasy-demo] grafted fixture into ${path}`)
        } catch (err) {
          // Upstream sent something unparseable — pass it through
          // untouched rather than turning a working app into a 500.
          console.error(`[fantasy-demo] ${path} not JSON, passing through: ${err.message}`)
          out = raw
        }
        const headersOut = { ...upstreamRes.headers }
        delete headersOut['content-length']
        delete headersOut['content-encoding']
        res.writeHead(status, headersOut)
        res.end(out)
      })
    },
  )
  upstreamReq.on('error', (err) => {
    console.error(`[fantasy-demo] upstream ${path}: ${err.message}`)
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'error',
        error: `fantasy-demo proxy could not reach ${UPSTREAM.origin} — is \`make up\` running?`,
      }),
    )
  })
  req.pipe(upstreamReq)
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname

  if (await control(req, res, path)) return

  // SERVED, not proxied. Injecting into a piped upstream stream works
  // right up until upstream closes it, and /events is Ultimate-gated —
  // on most accounts there would be nothing to inject into. Nothing is
  // lost: fantasy has no CDC tables of its own, and the other ingesters
  // are down in this mode anyway.
  if (path === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    res.write(': connected' + BREAK)
    sseClients.add(res)
    const beat = setInterval(() => res.write(': keep-alive' + BREAK), 15000)
    req.on('close', () => {
      clearInterval(beat)
      sseClients.delete(res)
    })
    return
  }

  const override = OVERRIDES[path]

  if (override) {
    // CORS only on the overridden routes; proxied responses keep
    // whatever the real API sent.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    console.log(`[fantasy-demo] served fixture ${path}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(override()))
    return
  }
  proxy(req, res, req.url, TRANSFORMS[path])
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[fantasy-demo] listening  http://localhost:${PORT}`)
  console.log(`[fantasy-demo] proxying   -> ${UPSTREAM.origin}`)
  console.log(`[fantasy-demo] overriding ${Object.keys(OVERRIDES).join('  ')}`)
  console.log(`[fantasy-demo] grafting   ${Object.keys(TRANSFORMS).join('  ')} (.data.fantasy)`)
  for (const l of LEAGUES) {
    const [me, opp] = l.matchups[0].teams
    const diff = round2(me.points - opp.points)
    const state = l.matchups[0].status === 'postevent' ? 'FINAL' : 'LIVE '
    console.log(
      `[fantasy-demo]   ${state} ${l.name} — ${me.name} ${me.points} vs ${opp.points} ` +
        `(${diff >= 0 ? '+' : ''}${diff}, proj ${me.projected_points}) · ` +
        `${l.rosters[0].data.players.length} players · ${l.standings.length} teams`,
    )
  }
  console.log(
    `[fantasy-demo] data       ${LIVE ? 'DRIFTING (--live) — numbers move' : 'static — pass --live to animate'}`,
  )
  console.log(`[fantasy-demo] CONTROL    http://localhost:${PORT}/  <- open this to spark moments`)
  console.log('[fantasy-demo] then: cd desktop && npm run tauri:dev:fantasy-demo')
})
