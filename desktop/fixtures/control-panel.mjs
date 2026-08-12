/**
 * A control panel for the fantasy demo rig — open http://localhost:8788/
 * on the same machine as the app and drive the ticker by hand.
 *
 * WHY THIS EXISTS
 * The interesting frames are the MOMENTS: a touchdown landing, a lead
 * flipping, a player going down, a game going final. `--live` drifts one
 * player on a fixed two-minute curve, which means capturing any of those
 * is a matter of starting the server and waiting for the right second.
 * That is a bad way to record anything. This makes each moment a button.
 *
 * HOW A CLICK REACHES THE APP IN UNDER A SECOND
 * The desktop app polls /dashboard every 30-60s depending on tier, which
 * is far too slow to click a button and film the result. But it also
 * listens on SSE, and useDashboardCDC has a fantasy fast-path: any record
 * whose metadata.table_name is one of the yahoo_* tables invalidates the
 * dashboard query immediately. So the panel writes one synthetic frame
 * into the SSE stream and the app re-fetches on its own.
 *
 * That is also why this rig SERVES /events rather than proxying it.
 * Injecting into a piped upstream stream works right up until upstream
 * closes it — and /events is Ultimate-gated, so on most accounts there is
 * nothing to inject into. Nothing is lost: fantasy has no CDC tables of
 * its own, and the other ingesters are down in this mode anyway.
 *
 * Same honesty boundary as the fixture it drives: real players,
 * REPRESENTATIVE stat lines. A score you clicked into existence is not a
 * box score. Do not caption a capture from this "live".
 */

const round2 = (n) => Math.round(n * 100) / 100
const BENCH = new Set(['BN', 'IR', 'IL', 'NA'])
const isLive = (p) => /^q[1-4]/i.test(p.game_state ?? '')

/** Empty set of operations — also the shape `/control/reset` restores. */
export const emptyOps = () => ({ points: {}, out: {}, final: {} })

/**
 * Apply the panel's operations to a payload.
 *
 * Pure, and layered on top of whatever the fixture (or --live drift)
 * already produced, so the two compose instead of fighting: the panel
 * moves a number by a DELTA rather than asserting an absolute, and a
 * drifting player keeps drifting under an applied touchdown.
 */
export function applyControl(base, ops) {
  const touched =
    Object.keys(ops.points).length +
    Object.keys(ops.out).length +
    Object.keys(ops.final).length
  if (touched === 0) return base

  const leagues = base.leagues.map((league) => {
    const goFinal = !!ops.final[league.league_key]

    const rosters = (league.rosters ?? []).map((roster) => {
      let changed = false
      const players = roster.data.players.map((player) => {
        let next = player
        const delta = ops.points[player.player_key]
        if (delta) {
          next = {
            ...next,
            player_points: round2((next.player_points ?? 0) + delta),
            // A projection that stayed put while the score climbed past
            // it renders as "proj" below a bigger number, which reads as
            // a bug rather than as a big afternoon. Carry it along.
            projected_points:
              next.projected_points == null
                ? null
                : round2(next.projected_points + delta),
          }
          changed = true
        }
        if (ops.out[player.player_key]) {
          next = {
            ...next,
            status: 'O',
            status_full: 'Out',
            injury_note: 'Ruled out — trainers on the field',
          }
          changed = true
        }
        if (goFinal && isLive(next)) {
          // The whole point of FINAL is that nothing is still running.
          next = { ...next, game_state: 'Final' }
          changed = true
        }
        return next
      })
      return changed
        ? { ...roster, data: { ...roster.data, players } }
        : roster
    })

    // Re-derive every total from the rosters rather than adjusting the
    // header separately. The fixture holds this invariant for the same
    // reason: a matchup number that doesn't reconcile to the table under
    // it is the most obvious possible tell in a screenshot.
    const matchups = (league.matchups ?? []).map((m) => {
      const teams = m.teams.map((team) => {
        const roster = rosters.find((r) => r.team_key === team.team_key)
        if (!roster) return team
        const starters = roster.data.players.filter(
          (p) => !BENCH.has(p.selected_position),
        )
        const points = round2(
          starters.reduce((n, p) => n + (p.player_points ?? 0), 0),
        )
        if (points === team.points) return team
        return {
          ...team,
          points,
          // Projection tracks the delta so it can never fall below the
          // banked score it is supposed to be forecasting.
          projected_points: round2(
            Math.max(team.projected_points + (points - team.points), points),
          ),
        }
      })
      if (!goFinal) return { ...m, teams }
      const [me, opp] = teams
      return {
        ...m,
        teams,
        status: 'postevent',
        is_tied: me.points === opp.points,
        winner_team_key:
          me.points === opp.points
            ? null
            : me.points > opp.points
              ? me.team_key
              : opp.team_key,
      }
    })

    return { ...league, rosters, matchups }
  })

  return { leagues }
}

/** What the panel renders from — a flat, UI-shaped view of the payload. */
export function controlState(payload) {
  return {
    leagues: payload.leagues.map((league) => {
      const m = league.matchups[0]
      const [me, opp] = m.teams
      const side = (teamKey) =>
        (league.rosters.find((r) => r.team_key === teamKey)?.data.players ?? [])
          .filter((p) => !BENCH.has(p.selected_position))
          .map((p) => ({
            key: p.player_key,
            name: p.name.full,
            pos: p.selected_position,
            points: p.player_points ?? 0,
            live: isLive(p),
            out: p.status === 'O',
          }))
      return {
        key: league.league_key,
        name: league.name,
        final: m.status === 'postevent',
        me: { name: me.name, points: me.points, proj: me.projected_points },
        opp: { name: opp.name, points: opp.points, proj: opp.projected_points },
        mine: side(me.team_key),
        theirs: side(opp.team_key),
      }
    }),
  }
}

/**
 * The frame that makes the app re-fetch. `yahoo_matchups` is in
 * useDashboardCDC's FANTASY_CDC_TABLES, which is what routes this down
 * the sub-second fast-path instead of the 500ms-debounced safety net.
 */
export const nudgeFrame = () =>
  `data: ${JSON.stringify({
    data: [{ metadata: { table_name: 'yahoo_matchups' } }],
  })}\n\n`

export const PANEL_HTML = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scrollr demo control</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    background: #0b0e14; color: #e6edf3;
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  h1 { font-size: 16px; margin: 0 0 4px; letter-spacing: .02em; }
  .sub { color: #8b949e; margin: 0 0 20px; font-size: 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
  .card { background: #11151d; border: 1px solid #222a36; border-radius: 12px; padding: 16px; }
  .name { font-weight: 600; font-size: 15px; }
  .tag { font-size: 10px; letter-spacing: .08em; padding: 2px 7px; border-radius: 999px; vertical-align: 2px; margin-left: 8px; }
  .live { background: #1d3b2a; color: #3ee0a4; }
  .fin  { background: #2a2f3a; color: #8b949e; }
  .score { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 4px; font-variant-numeric: tabular-nums; }
  .big { font-size: 26px; font-weight: 700; }
  .vs { color: #8b949e; }
  .margin { font-size: 12px; font-weight: 600; }
  .ahead { color: #3ee0a4; } .behind { color: #ff3b5c; }
  .proj { color: #8b949e; font-size: 11px; margin-bottom: 12px; }
  label { display: block; font-size: 11px; color: #8b949e; margin: 10px 0 4px; letter-spacing: .04em; }
  select { width: 100%; padding: 7px 9px; background: #0b0e14; color: #e6edf3;
           border: 1px solid #2b3441; border-radius: 7px; font: inherit; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  button { padding: 7px 11px; border-radius: 7px; border: 1px solid #2b3441;
           background: #1a212c; color: #e6edf3; font: inherit; cursor: pointer; }
  button:hover { background: #232c3a; }
  button.hero { background: #14532d; border-color: #1d6b3c; color: #7ff0bd; font-weight: 600; }
  button.hero:hover { background: #1a6839; }
  button.warn { background: #451a22; border-color: #6b2530; color: #ff9aab; }
  button:disabled { opacity: .4; cursor: default; }
  footer { margin-top: 24px; color: #8b949e; font-size: 12px; }
  .note { max-width: 60ch; }
</style>
<h1>Scrollr demo control</h1>
<p class="sub">Every click re-renders the app in under a second. Seeded data &mdash; not a live game.</p>
<div class="grid" id="grid"></div>
<footer>
  <div class="row"><button class="warn" onclick="reset()">Reset everything</button></div>
  <p class="note">Scores here are typed by you. Real players, representative numbers &mdash;
  don't caption a capture from this &ldquo;live&rdquo; or with a real date.</p>
</footer>
<script>
const $ = (id) => document.getElementById(id)
let picks = {}

async function post(body) {
  await fetch('/control/op', {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify(body),
  })
  await load()
}
const reset = () => post({ type: 'reset' })
const bump  = (league, delta) => post({ type: 'points', player: picks[league], delta })
const rule  = (league) => post({ type: 'out', player: picks[league] })
const final = (league) => post({ type: 'final', league })

function lead(l) {
  // Exactly past them, not a landslide — the frame worth filming is the
  // one where the number crosses.
  const need = Math.round((l.opp.points - l.me.points + 0.1) * 100) / 100
  return post({ type: 'points', player: picks[l.key], delta: need })
}

function card(l) {
  const diff = Math.round((l.me.points - l.opp.points) * 100) / 100
  const all = l.mine.concat(l.theirs)
  if (!picks[l.key] || !all.some(p => p.key === picks[l.key])) {
    picks[l.key] = (l.mine.find(p => p.live) || l.mine[0]).key
  }
  const group = (label, ps) => '<optgroup label="' + label + '">'
    + ps.map(p => '<option value="' + p.key + '"'
        + (picks[l.key] === p.key ? ' selected' : '') + '>'
        + p.pos + ' · ' + p.name + ' · ' + p.points.toFixed(1)
        + (p.live ? ' — live' : '') + (p.out ? ' — OUT' : '')
        + '</option>').join('')
    + '</optgroup>'

  return '<div class="card">'
    + '<div class="name">' + l.name
      + '<span class="tag ' + (l.final ? 'fin' : 'live') + '">'
      + (l.final ? 'FINAL' : 'LIVE') + '</span></div>'
    + '<div class="score"><span class="big">' + l.me.points.toFixed(2) + '</span>'
      + '<span class="vs">vs</span><span class="big">' + l.opp.points.toFixed(2) + '</span>'
      + '<span class="margin ' + (diff >= 0 ? 'ahead' : 'behind') + '">'
      + (diff >= 0 ? '+' : '') + diff.toFixed(2) + '</span></div>'
    + '<div class="proj">' + l.me.name + ' &middot; proj ' + l.me.proj.toFixed(1)
      + '  &mdash;  ' + l.opp.name + ' &middot; proj ' + l.opp.proj.toFixed(1) + '</div>'
    + '<label>Who scores</label>'
    + '<select onchange="picks[\\'' + l.key + '\\'] = this.value">'
      + group('Your starters', l.mine) + group('Their starters', l.theirs) + '</select>'
    + '<div class="row">'
      + '<button onclick="bump(\\'' + l.key + '\\', 6)">TD +6</button>'
      + '<button onclick="bump(\\'' + l.key + '\\', 6.6)">TD +6.6</button>'
      + '<button onclick="bump(\\'' + l.key + '\\', 3)">FG +3</button>'
      + '<button onclick="bump(\\'' + l.key + '\\', 1.4)">Chunk +1.4</button>'
      + '<button onclick="bump(\\'' + l.key + '\\', -2)">&minus;2</button>'
    + '</div><div class="row">'
      + '<button class="hero" onclick="lead(STATE[\\'' + l.key + '\\'])"'
        + (diff >= 0 ? ' disabled' : '') + '>Take the lead ('
        + (diff >= 0 ? 'ahead' : '+' + (Math.abs(diff) + 0.1).toFixed(1)) + ')</button>'
      + '<button onclick="rule(\\'' + l.key + '\\')">Rule out</button>'
      + '<button onclick="final(\\'' + l.key + '\\')"'
        + (l.final ? ' disabled' : '') + '>Go FINAL</button>'
    + '</div></div>'
}

let STATE = {}
let painted = ''
async function load() {
  // Restarting the fixture server is routine; a poll loop that throws an
  // unhandled rejection every 2s until the tab is reloaded is not.
  let s
  try { s = await (await fetch('/control/state')).json() } catch { return }
  STATE = Object.fromEntries(s.leagues.map(l => [l.key, l]))
  // Repaint only on an actual change, and never while a dropdown is
  // open — blowing away innerHTML on a timer snaps the picker shut
  // mid-selection, which makes the panel unusable for the one thing
  // it exists for.
  const next = JSON.stringify(s)
  if (next === painted) return
  if (document.activeElement && document.activeElement.tagName === 'SELECT') return
  painted = next
  $('grid').innerHTML = s.leagues.map(card).join('')
}
load()
setInterval(load, 2000)
</script>
`
