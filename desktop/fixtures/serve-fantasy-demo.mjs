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
 */

import { createServer, request as httpRequest } from 'node:http'

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
  modifiers: { 4: 0.04, 5: 4, 6: -1, 9: 0.1, 10: 6, 11: 1, 12: 0.1, 13: 6, 18: -2 },
}

const round2 = (n) => Math.round(n * 100) / 100

/** points = Σ stat × modifier, at Yahoo's 2dp display precision. */
function scoreOf(stats) {
  let total = 0
  for (const [id, raw] of Object.entries(stats)) {
    const mod = STAT_CATALOG.modifiers[id]
    if (mod == null) continue
    const val = Number(raw)
    if (!Number.isNaN(val)) total += val * mod
  }
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
  // Live Monday night. Behind, one starter left, projected to pass them.
  sunday: [
    { pos: 'QB', name: 'Jalen Hurts', team: 'PHI', dp: 'QB', stats: { 4: 261, 5: 2, 6: 1, 9: 47, 10: 1 }, proj: 21.4 },
    { pos: 'WR', name: 'Ja’Marr Chase', team: 'CIN', dp: 'WR', stats: { 11: 9, 12: 121, 13: 1 }, proj: 19.8 },
    { pos: 'WR', name: 'Nico Collins', team: 'HOU', dp: 'WR', stats: { 11: 5, 12: 74 }, proj: 14.1 },
    { pos: 'RB', name: 'Bijan Robinson', team: 'ATL', dp: 'RB', stats: { 9: 88, 10: 1, 11: 4, 12: 31 }, proj: 18.9 },
    { pos: 'RB', name: 'Kenneth Walker III', team: 'SEA', dp: 'RB', stats: { 9: 52, 11: 2, 12: 18, 18: 1 }, proj: 13.2 },
    { pos: 'TE', name: 'Trey McBride', team: 'ARI', dp: 'TE', stats: { 11: 7, 12: 68 }, proj: 12.6 },
    { pos: 'W/R/T', name: 'Jaxon Smith-Njigba', team: 'SEA', dp: 'WR', stats: { 11: 6, 12: 83, 13: 1 }, proj: 15.5 },
    { pos: 'W/R/T', name: 'De’Von Achane', team: 'MIA', dp: 'RB', stats: {}, proj: 14.2, pending: true },
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
    { pos: 'RB', name: 'Jahmyr Gibbs', team: 'DET', dp: 'RB', stats: { 9: 104, 10: 2, 11: 3, 12: 22 }, proj: 19.7 },
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
    { pos: 'WR', name: 'Amon-Ra St. Brown', team: 'DET', dp: 'WR', stats: { 11: 8, 12: 79, 13: 1 }, proj: 18.3 },
    { pos: 'WR', name: 'DK Metcalf', team: 'PIT', dp: 'WR', stats: { 11: 4, 12: 61 }, proj: 13.7 },
    { pos: 'RB', name: 'Josh Jacobs', team: 'GB', dp: 'RB', stats: { 9: 79, 10: 1, 11: 2, 12: 14 }, proj: 16.2 },
    { pos: 'RB', name: 'Chuba Hubbard', team: 'CAR', dp: 'RB', stats: {}, proj: 12.9, pending: true },
    { pos: 'TE', name: 'Sam LaPorta', team: 'DET', dp: 'TE', stats: { 11: 5, 12: 52 }, proj: 11.4 },
    { pos: 'W/R/T', name: 'Courtland Sutton', team: 'DEN', dp: 'WR', stats: {}, proj: 12.1, pending: true },
    { pos: 'BN', name: 'Zay Flowers', team: 'BAL', dp: 'WR', stats: { 11: 6, 12: 71 }, proj: 12.8 },
    { pos: 'BN', name: 'Isiah Pacheco', team: 'KC', dp: 'RB', stats: {}, proj: 6.4, status: 'D', status_full: 'Doubtful', injury_note: 'Ankle — did not practice Friday' },
    { pos: 'BN', name: 'Jerry Jeudy', team: 'CLE', dp: 'WR', stats: { 11: 3, 12: 38 }, proj: 9.9 },
  ],
}

const BENCH = new Set(['BN', 'IR', 'IL', 'NA'])
const isStarter = (p) => !BENCH.has(p.selected_position)

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
      position_type: 'O',
      image_url: playerAvatar(p.name),
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

/** Banked + projected for a roster, derived so views can't disagree. */
function totalsFor(roster, players) {
  const banked = round2(
    players.filter(isStarter).reduce((n, p) => n + (p.player_points ?? 0), 0),
  )
  const pending = round2(
    roster.filter((p) => p.pending && !BENCH.has(p.pos)).reduce((n, p) => n + p.proj, 0),
  )
  return { banked, projected: round2(banked + pending), pending }
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
  numTeams, rosterName, idBase, rivals,
}) {
  const teamKey = `${key}.t.${teamId}`
  const oppKey = `${key}.t.99`
  const roster = ROSTERS[rosterName]
  const players = buildPlayers(roster, idBase)
  const { banked, projected } = totalsFor(roster, players)
  const oppPoints = round2(banked + margin)
  const final = status === 'postevent'

  // Sorted by wins, then points-for — the usual Yahoo tiebreak — so
  // rank/seed follow from the records instead of being asserted.
  const rows = [
    [teamName, teamKey, teamId, ...rivals.userRecord],
    [oppName, oppKey, 99, ...rivals.oppRecord],
    ...rivals.others.map((r, i) => [r[0], `${key}.t.${10 + i}`, 10 + i, r[1], r[2], r[3]]),
  ]
    .sort((a, b) => b[3] - a[3] || b[5] - a[5])
  const table = rows.map(([tName, tKey, tId, w, l, pf], i) => ({
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
          { team_key: oppKey, team_id: 99, name: oppName, team_logo: teamLogo(oppName), manager_name: 'D. Ramos', points: oppPoints, projected_points: oppPoints },
        ],
      },
    ],
    previous_matchups: null,
    rosters: [
      { team_key: teamKey, data: { team_key: teamKey, team_name: teamName, players } },
    ],
  }
}

const LEAGUES = [
  buildLeague({
    key: '449.l.884213', name: 'The Sunday Money League', teamId: 4,
    teamName: 'Brunch Money', oppName: 'Fourth and Long',
    margin: 11.4, week: 12, status: 'midevent', numTeams: 8,
    rosterName: 'sunday', idBase: 30000,
    rivals: {
      userRecord: [8, 3, 1289.44],
      oppRecord: [8, 3, 1301.08],
      others: [
        ['Waiver Wire Villains', 7, 4, 1244.9], ['Sunday Scaries', 7, 4, 1198.62],
        ['The Autodrafters', 6, 5, 1210.16], ['Zero RB Truthers', 5, 6, 1155.38],
        ['Bench Warmers', 4, 7, 1102.74], ['Punt Returners', 2, 9, 1017.2],
      ],
    },
  }),
  buildLeague({
    key: '449.l.220417', name: 'Dynasty or Bust', teamId: 3,
    teamName: 'Regression Candidates', oppName: 'Air Yards Only',
    margin: -33.46, week: 12, status: 'postevent', numTeams: 10,
    rosterName: 'dynasty', idBase: 31000,
    rivals: {
      userRecord: [9, 2, 1402.3],
      oppRecord: [5, 6, 1188.44],
      others: [
        ['Dead Cap Dynasty', 8, 3, 1355.1], ['Rebuild Forever', 7, 4, 1290.66],
        ['Taxi Squad', 6, 5, 1240.02], ['Contend Now', 6, 5, 1233.5],
        ['Draft Capital', 4, 7, 1150.8], ['Win-Now Window', 3, 8, 1098.42],
      ],
    },
  }),
  buildLeague({
    key: '449.l.671902', name: 'Work League (Keeper)', teamId: 6,
    teamName: 'Third and Inches', oppName: 'Gridiron Ghosts',
    margin: 2.56, week: 12, status: 'midevent', numTeams: 10,
    rosterName: 'work', idBase: 32000,
    rivals: {
      userRecord: [6, 5, 1176.9],
      oppRecord: [7, 4, 1204.18],
      others: [
        ['Copier Jam', 8, 3, 1288.44], ['HR Violations', 7, 4, 1221.06],
        ['The Cubicles', 5, 6, 1160.3], ['Standing Desk', 5, 6, 1142.88],
        ['Out of Office', 4, 7, 1099.5], ['Reply All', 3, 8, 1044.62],
      ],
    },
  }),
]

const payload = { leagues: LEAGUES }

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
const PORT = Number(flag('port', 8788))
const UPSTREAM = new URL(flag('upstream', 'http://localhost:18080'))

// Whole-response overrides. These two feed the fantasy ACCOUNT panel
// (YahooConnectFlow / ConnectedView).
const OVERRIDES = {
  '/users/me/yahoo-status': { connected: true, synced: true },
  '/users/me/yahoo-leagues': payload,
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
    body.data.fantasy = payload
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

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
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
    res.end(JSON.stringify(override))
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
  console.log('[fantasy-demo] then: cd desktop && npm run tauri:dev:fantasy-demo')
})
