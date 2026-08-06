#!/usr/bin/env node
/**
 * Fantasy demo backend — serves a deterministic `MyLeaguesResponse` so
 * the fantasy widget can be screenshotted out of season.
 *
 * WHY THIS EXISTS
 * The fantasy UI is only interesting during an NFL week. From February
 * to September every real league is empty, so marketing captures of the
 * fantasy widget are impossible for two thirds of the year. This serves
 * a fixed Week 12 Monday-night scenario instead, against the REAL app —
 * no mock components, no edited pixels, just seeded data.
 *
 * HONESTY BOUNDARY — read before using a capture from this.
 * The player names are real; the stat lines are REPRESENTATIVE, not a
 * verified historical box score. Do not caption a screenshot from this
 * with "no edits", "live", or a specific real date. Caption it as a
 * demo league (e.g. "DEMO LEAGUE · WEEK 12 · SEEDED DATA"). The app in
 * the shot is genuinely the app; the week in it never happened exactly
 * this way. Those are different claims and only the first one is safe.
 * If you want a real box score in here, replace ROSTER/OPPONENT below
 * with actual numbers — the arithmetic downstream is source-agnostic.
 *
 * USAGE
 *   node desktop/fixtures/serve-fantasy-demo.mjs          # :8788
 *   node desktop/fixtures/serve-fantasy-demo.mjs --port 9000
 *   node desktop/fixtures/serve-fantasy-demo.mjs --emit   # dump JSON, no server
 *
 * Then run the desktop app pointed at it, signed out:
 *   VITE_DEMO=1 VITE_API_URL=http://localhost:8788 npm run dev
 *
 * Only the two endpoints the fantasy widget calls are implemented
 * (see desktop/src/api/queries.ts): /users/me/yahoo-status and
 * /users/me/yahoo-leagues. Everything else 404s on purpose — this is a
 * screenshot rig, not a backend stub.
 */

import { createServer } from 'node:http'

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
  ],
  modifiers: {
    4: 0.04, 5: 4, 6: -1, 9: 0.1, 10: 6, 11: 1, 12: 0.1, 13: 6, 18: -2,
  },
}

/** points = Σ stat × modifier, rounded to Yahoo's 2dp display. */
function scoreOf(stats) {
  let total = 0
  for (const [id, raw] of Object.entries(stats)) {
    const mod = STAT_CATALOG.modifiers[id]
    if (mod == null) continue
    const val = Number(raw)
    if (Number.isNaN(val)) continue
    total += val * mod
  }
  return Math.round(total * 100) / 100
}

// ── The scenario ─────────────────────────────────────────────────
// Week 12, Monday night. The user is behind with exactly one player
// left to play — the situation SEC 03 of /fantasy describes ("down
// eleven with one player left"). A one-score deficit with a live flex
// reads far better in a screenshot than a blowout in either direction.
//
// `pending: true` means the player has not played yet: their stats are
// empty, they score 0 so far, and `proj` feeds the projected total.
const ROSTER = [
  { pos: 'QB',  name: 'Jalen Hurts',        team: 'PHI', dp: 'QB', stats: { 4: 261, 5: 2, 6: 1, 9: 47, 10: 1 }, proj: 21.4 },
  { pos: 'WR',  name: 'Ja’Marr Chase', team: 'CIN', dp: 'WR', stats: { 11: 9, 12: 121, 13: 1 }, proj: 19.8 },
  { pos: 'WR',  name: 'Nico Collins',       team: 'HOU', dp: 'WR', stats: { 11: 5, 12: 74 }, proj: 14.1 },
  { pos: 'RB',  name: 'Bijan Robinson',     team: 'ATL', dp: 'RB', stats: { 9: 88, 10: 1, 11: 4, 12: 31 }, proj: 18.9 },
  { pos: 'RB',  name: 'Kenneth Walker III', team: 'SEA', dp: 'RB', stats: { 9: 52, 11: 2, 12: 18, 18: 1 }, proj: 13.2 },
  { pos: 'TE',  name: 'Trey McBride',       team: 'ARI', dp: 'TE', stats: { 11: 7, 12: 68 }, proj: 12.6 },
  { pos: 'W/R/T', name: 'Jaxon Smith-Njigba', team: 'SEA', dp: 'WR', stats: { 11: 6, 12: 83, 13: 1 }, proj: 15.5 },
  // The live one. Monday night, still to play.
  { pos: 'W/R/T', name: 'De’Von Achane', team: 'MIA', dp: 'RB', stats: {}, proj: 14.2, pending: true },
  // Bench — one of them is the injury line the /fantasy copy promises.
  { pos: 'BN',  name: 'Tank Dell',          team: 'HOU', dp: 'WR', stats: {}, proj: 9.4,
    status: 'Q', status_full: 'Questionable', injury_note: 'Hamstring — limited in Friday practice' },
  { pos: 'BN',  name: 'Tyjae Spears',       team: 'TEN', dp: 'RB', stats: { 9: 31, 11: 1, 12: 9 }, proj: 7.8 },
  { pos: 'BN',  name: 'Jordan Addison',     team: 'MIN', dp: 'WR', stats: { 11: 4, 12: 52 }, proj: 11.2 },
  { pos: 'IR',  name: 'Rashee Rice',        team: 'KC',  dp: 'WR', stats: {}, proj: 0,
    status: 'IR', status_full: 'Injured Reserve', injury_note: 'Knee' },
]

// Opponent finished Sunday — a single number is enough, their roster is
// never shown in the matchup view.
//
// Tuned so the user is DOWN with one starter left but PROJECTED to pass
// them: banked 130.64, opponent 142.04 (-11.40), pending flex projects
// 14.2 for a 144.84 finish. That is the shot — a live deficit the
// projection says you win, which is the whole reason to keep a bar on
// screen. Recomputed on boot and logged, so editing ROSTER above
// re-derives it instead of silently breaking the story.
const OPPONENT_POINTS = 142.04

const TEAM_KEY = '449.l.884213.t.4'
const OPP_KEY = '449.l.884213.t.9'
const LEAGUE_KEY = '449.l.884213'

function buildPlayers() {
  return ROSTER.map((p, i) => {
    const played = !p.pending && Object.keys(p.stats).length > 0
    const [first, ...rest] = p.name.split(' ')
    return {
      player_key: `449.p.${30000 + i}`,
      player_id: 30000 + i,
      name: { full: p.name, first, last: rest.join(' ') },
      editorial_team_abbr: p.team,
      display_position: p.dp,
      selected_position: p.pos,
      eligible_positions: [p.dp],
      position_type: 'O',
      image_url: '',
      status: p.status ?? null,
      status_full: p.status_full ?? null,
      injury_note: p.injury_note ?? null,
      player_points: played ? scoreOf(p.stats) : 0,
      player_stats: played
        ? Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, String(v)]))
        : Object.fromEntries(STAT_CATALOG.stats.map((s) => [s.stat_id, '-'])),
    }
  })
}

const players = buildPlayers()
const isStarter = (p) => !['BN', 'IR', 'IL', 'NA'].includes(p.selected_position)

// Actual = what starters have banked. Projected = actual + the pending
// starter's projection. Derived, never typed, so the matchup header and
// the roster table can't contradict each other.
const userPoints =
  Math.round(players.filter(isStarter).reduce((n, p) => n + (p.player_points ?? 0), 0) * 100) / 100
const pendingProj = ROSTER.filter((p) => p.pending).reduce((n, p) => n + p.proj, 0)
const userProjected = Math.round((userPoints + pendingProj) * 100) / 100

const heroMatchup = {
  week: 12,
  week_start: '2025-11-20',
  week_end: '2025-11-24',
  status: 'midevent',
  is_playoffs: false,
  is_consolation: false,
  is_tied: false,
  winner_team_key: null,
  teams: [
    {
      team_key: TEAM_KEY, team_id: 4, name: 'Brunch Money', team_logo: '',
      manager_name: 'You', points: userPoints, projected_points: userProjected,
    },
    {
      team_key: OPP_KEY, team_id: 9, name: 'Fourth and Long', team_logo: '',
      manager_name: 'D. Ramos', points: OPPONENT_POINTS, projected_points: OPPONENT_POINTS,
    },
  ],
}

const STANDINGS_SEED = [
  ['Fourth and Long', OPP_KEY, 9, 8, 3, 0, 1301.08, 'W', 1, true],
  ['Brunch Money', TEAM_KEY, 4, 8, 3, 0, 1289.44, 'W', 2, true],
  ['Waiver Wire Villains', '449.l.884213.t.2', 2, 7, 4, 0, 1244.9, 'L', 1, false],
  ['Sunday Scaries', '449.l.884213.t.7', 7, 7, 4, 0, 1198.62, 'W', 3, false],
  ['The Autodrafters', '449.l.884213.t.1', 1, 6, 5, 0, 1210.16, 'L', 2, false],
  ['Zero RB Truthers', '449.l.884213.t.5', 5, 5, 6, 0, 1155.38, 'W', 1, false],
  ['Bench Warmers', '449.l.884213.t.3', 3, 4, 7, 0, 1102.74, 'L', 4, false],
  ['Punt Returners', '449.l.884213.t.6', 6, 2, 9, 0, 1017.2, 'L', 6, false],
]

const standings = STANDINGS_SEED.map(
  ([name, key, id, w, l, t, pf, streakType, streakVal, clinched], i) => ({
    team_key: key, team_id: id, name, team_logo: '',
    manager_name: key === TEAM_KEY ? 'You' : `Manager ${id}`,
    rank: i + 1, wins: w, losses: l, ties: t,
    percentage: (w / (w + l + t)).toFixed(3),
    points_for: pf,
    streak_type: streakType === 'W' ? 'win' : 'loss',
    streak_value: streakVal,
    playoff_seed: i + 1 <= 6 ? i + 1 : null,
    clinched_playoffs: clinched,
    waiver_priority: 12 - i,
  }),
)

/** A second/third league so "every league on your account" is visible. */
function sideLeague({ key, name, teamKey, teamName, opp, mine, theirs, week, status }) {
  return {
    league_key: key, name, game_code: 'nfl', season: '2025',
    team_key: teamKey, team_name: teamName,
    data: { num_teams: 10, is_finished: false, current_week: week, scoring_type: 'head', stat_catalog: STAT_CATALOG },
    standings: null,
    matchups: [
      {
        week, status, is_playoffs: false, is_tied: false,
        winner_team_key: status === 'postevent' ? (mine > theirs ? teamKey : `${key}.t.99`) : null,
        teams: [
          { team_key: teamKey, team_id: 3, name: teamName, team_logo: '', manager_name: 'You', points: mine, projected_points: mine },
          { team_key: `${key}.t.99`, team_id: 99, name: opp, team_logo: '', manager_name: 'K. Whitfield', points: theirs, projected_points: theirs },
        ],
      },
    ],
    rosters: null,
  }
}

const payload = {
  leagues: [
    {
      league_key: LEAGUE_KEY,
      name: 'The Sunday Money League',
      game_code: 'nfl',
      season: '2025',
      team_key: TEAM_KEY,
      team_name: 'Brunch Money',
      data: {
        num_teams: 8, is_finished: false, current_week: 12,
        scoring_type: 'head', stat_catalog: STAT_CATALOG,
      },
      standings,
      matchups: [heroMatchup],
      previous_matchups: null,
      rosters: [{ team_key: TEAM_KEY, data: { team_key: TEAM_KEY, team_name: 'Brunch Money', players } }],
    },
    sideLeague({
      key: '449.l.220417', name: 'Dynasty or Bust', teamKey: '449.l.220417.t.3',
      teamName: 'Regression Candidates', opp: 'Air Yards Only',
      mine: 141.68, theirs: 108.22, week: 12, status: 'postevent',
    }),
    sideLeague({
      key: '449.l.671902', name: 'Work League (Keeper)', teamKey: '449.l.671902.t.6',
      teamName: 'Third and Inches', opp: 'Gridiron Ghosts',
      mine: 96.54, theirs: 99.1, week: 12, status: 'midevent',
    }),
  ],
}

// ── Serve ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
if (args.includes('--emit')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(0)
}
const portArg = args.indexOf('--port')
const PORT = portArg !== -1 ? Number(args[portArg + 1]) : 8788

const ROUTES = {
  '/users/me/yahoo-status': { connected: true, synced: true },
  '/users/me/yahoo-leagues': payload,
}

createServer((req, res) => {
  // Wide-open CORS: this binds to localhost and serves invented data.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const path = new URL(req.url, 'http://x').pathname
  const body = ROUTES[path]
  if (!body) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'error', error: `no fixture for ${path}` }))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[fantasy-demo] http://localhost:${PORT}`)
  console.log(`[fantasy-demo] Week 12 · Brunch Money ${userPoints} vs Fourth and Long ${OPPONENT_POINTS}`)
  console.log(
    `[fantasy-demo] down ${Math.round((OPPONENT_POINTS - userPoints) * 100) / 100}, ` +
      `1 starter left (proj ${userProjected})`,
  )
  console.log('[fantasy-demo] run the app with:')
  console.log(`[fantasy-demo]   VITE_DEMO=1 VITE_API_URL=http://localhost:${PORT} npm run dev`)
})
