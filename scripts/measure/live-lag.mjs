#!/usr/bin/env node
// SCROLLR-302: how far behind the broadcast are our live scores?
//
// Every 15 s, for every game of one league, sample four sources:
//   api_date  api-sports  /games?league=L&season=S&date=<UTC today>   (what the ingester polls)
//   api_live  api-sports  /games?live=all                              (never used by the ingester)
//   espn      ESPN public scoreboard   (REFERENCE CLOCK ONLY, never a product source)
//   prod      core's GET /sports/public (the games rows the bar reads; <=10 s cache)
// Raw samples go to a jsonl file; `summary <file>` derives per-event lag vs ESPN.
//
//   node scripts/measure/live-lag.mjs --sport baseball --minutes 3
//   node scripts/measure/live-lag.mjs --sport nfl --from 2026-10-06T00:00:00Z --until 2026-10-06T04:30:00Z
//   node scripts/measure/live-lag.mjs summary results/2026-10-06-nfl-lag.jsonl
//   node scripts/measure/live-lag.mjs selftest
//
// API_SPORTS_KEY comes from the environment only. It is never printed or written.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const INTERVAL_MS = 15_000 // locked: do not go faster
const TIMEOUT_MS = 10_000
const PROD = 'https://api.myscrollr.com/sports/public'

const SPORTS = {
  nfl: { host: 'v1.american-football.api-sports.io', league: 1, espn: 'football/nfl', prod: 'NFL' },
  baseball: { host: 'v1.baseball.api-sports.io', league: 1, espn: 'baseball/mlb', prod: 'MLB' },
}

// ── normalisation: every source becomes {key,home,away,hs,as,period,clock,status,state} ──

const nick = (name) => String(name).trim().split(/\s+/).pop().toLowerCase()
// a game is its two nicknames + UTC start day: a playoff series repeats the matchup, and prod keeps old rows
// ponytail: a same-day doubleheader between the same two teams would merge; add the start hour if that bites
const keyOf = (home, away, start) => `${nick(home)}|${nick(away)}|${new Date(start).toISOString().slice(0, 10)}`

function apiState(short) {
  if (['NS', 'TBD'].includes(short)) return 'pre'
  if (['FT', 'AOT', 'AET', 'PEN', 'AP', 'AWD', 'ABD'].includes(short)) return 'post'
  if (['PST', 'CANC', 'SUSP', 'WO', 'INT'].includes(short)) return 'other'
  return 'in'
}

// "Q3" / "IN7" / "P2" -> 3 / 7 / 2; "HT" -> 2; "OT" -> 5; anything else -> null (no period claim)
function periodOf(short) {
  const m = /(\d+)$/.exec(short ?? '')
  if (m) return Number(m[1])
  if (short === 'HT') return 2
  if (short === 'OT') return 5
  return null
}

function fromApi(item) {
  const g = item.game ?? item // american-football nests under .game, baseball is flat
  const short = g.status?.short ?? 'NS'
  const sc = (side) => {
    const s = item.scores?.[side]
    if (s?.innings && typeof s.innings === 'object') // baseball: the ingester sums innings (total lags)
      return Object.values(s.innings).reduce((a, v) => a + (Number(v) || 0), 0)
    return s?.total ?? null
  }
  return {
    key: keyOf(item.teams.home.name, item.teams.away.name, (g.date?.timestamp ?? item.timestamp) * 1000),
    home: item.teams.home.name, away: item.teams.away.name,
    hs: sc('home'), as: sc('away'),
    period: periodOf(short), clock: g.status?.timer ?? null,
    status: short, state: apiState(short),
  }
}

function fromEspn(ev) {
  const c = ev.competitions[0]
  const home = c.competitors.find((x) => x.homeAway === 'home')
  const away = c.competitors.find((x) => x.homeAway === 'away')
  const st = ev.status
  return {
    key: keyOf(home.team.displayName, away.team.displayName, ev.date),
    home: home.team.displayName, away: away.team.displayName,
    hs: Number(home.score), as: Number(away.score),
    period: st.period || null, clock: st.displayClock ?? null,
    status: st.type.description, state: st.type.state, // pre | in | post
  }
}

function fromProd(r) {
  const state = { pre: 'pre', in: 'in', final: 'post' }[r.state] ?? 'other'
  return {
    key: keyOf(r.home_team_name, r.away_team_name, r.start_time),
    home: r.home_team_name, away: r.away_team_name,
    hs: Number(r.home_team_score), as: Number(r.away_team_score),
    period: periodOf(r.status_short), clock: r.short_detail ?? null,
    status: r.status_short, state, updated_at: r.updated_at,
  }
}

// ── fetching ──

async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function sources(cfg, key) {
  const h = { 'x-apisports-key': key }
  const api = `https://${cfg.host}/games`
  const date = new Date().toISOString().slice(0, 10)
  const season = date.slice(0, 4)
  const apiRows = (j) => {
    // api-sports reports problems in a 200 body: errors is [] when fine, an object when not
    const e = j.errors && !Array.isArray(j.errors) ? j.errors : null
    if (e) throw new Error(`api-sports: ${JSON.stringify(e)}`)
    return j.response.filter((it) => (it.league?.id ?? cfg.league) === cfg.league).map(fromApi)
  }
  return {
    api_date: async () => apiRows(await getJson(`${api}?league=${cfg.league}&season=${season}&date=${date}`, h)),
    api_live: async () => apiRows(await getJson(`${api}?live=all`, h)),
    espn: async () => (await getJson(`https://site.api.espn.com/apis/site/v2/sports/${cfg.espn}/scoreboard`)).events.map(fromEspn),
    prod: async () => (await getJson(PROD)).sports.filter((r) => r.league === cfg.prod).map(fromProd),
  }
}

// ── run ──

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }

async function run() {
  const sport = arg('sport') ?? 'nfl'
  const cfg = SPORTS[sport]
  if (!cfg) throw new Error(`--sport must be one of ${Object.keys(SPORTS)}`)
  const key = process.env.API_SPORTS_KEY
  if (!key) throw new Error('API_SPORTS_KEY not set in the environment')

  const mins = arg('minutes')
  const from = mins ? Date.now() : Date.parse(arg('from') ?? new Date().toISOString())
  const until = mins ? from + Number(mins) * 60_000 : Date.parse(arg('until'))
  if (!(until > from)) throw new Error('need --minutes N, or --from/--until ISO times with until > from')
  const out = arg('out') ?? `results/${new Date(from).toISOString().slice(0, 10)}-${sport}-lag.jsonl`
  mkdirSync(dirname(out), { recursive: true })
  const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n')

  console.log(`${new Date().toISOString()} sport=${sport} from=${new Date(from).toISOString()} until=${new Date(until).toISOString()} out=${out}`)
  log({ meta: true, sport, from: new Date(from).toISOString(), until: new Date(until).toISOString(), interval_s: INTERVAL_MS / 1000 })
  if (from > Date.now()) await sleep(from - Date.now())

  const src = sources(cfg, key)
  const disabled = new Set() // a source the host rejects outright (e.g. live=all on baseball) is logged once, then skipped
  const last = new Map() // `${src}|${key}` -> last logged JSON, so unchanged finished/pre games don't bloat the file

  for (let next = Math.max(from, Date.now()); next < until; next += INTERVAL_MS) {
    await sleep(next - Date.now())
    await Promise.all(Object.entries(src).filter(([n]) => !disabled.has(n)).map(async ([name, fn]) => {
      try {
        const rows = await fn()
        const t = new Date().toISOString()
        for (const r of rows) {
          const sig = JSON.stringify({ ...r, updated_at: undefined })
          if (r.state !== 'in' && last.get(`${name}|${r.key}`) === sig) continue
          last.set(`${name}|${r.key}`, sig)
          log({ t, src: name, ...r })
        }
      } catch (e) {
        log({ t: new Date().toISOString(), src: name, error: String(e.message ?? e) })
        if (/not exist|not match/.test(String(e.message))) disabled.add(name)
      }
    }))
  }
  console.log(`${new Date().toISOString()} done`)
  return out
}

// ── summary ──

const NAMES = { api_date: 'date-query', api_live: 'live=all', prod: 'prod-row' }

// events = changes in the ESPN timeline: kickoff/period, score, final
export function espnEvents(samples) {
  const ev = []
  let prev
  for (const s of samples) {
    if (prev) {
      if (s.period != null && s.period !== (prev.state === 'pre' ? 0 : prev.period ?? 0) && s.state === 'in')
        ev.push({ kind: 'period', t: s.t, period: s.period, label: `period ${s.period}` })
      if (s.hs + s.as > prev.hs + prev.as)
        ev.push({ kind: 'score', t: s.t, hs: s.hs, as: s.as, label: `${nick(s.away)} ${s.as}-${s.hs} ${nick(s.home)}` })
      if (prev.state !== 'post' && s.state === 'post') ev.push({ kind: 'final', t: s.t, label: 'final' })
    }
    prev = s
  }
  return ev
}

// first time a source's samples satisfy the event (monotonic, so skipped intermediate states still count)
export function seenAt(samples, e) {
  const ok = {
    score: (s) => s.hs >= e.hs && s.as >= e.as && s.state !== 'pre',
    period: (s) => s.period != null && s.period >= e.period && s.state !== 'pre',
    final: (s) => s.state === 'post',
  }[e.kind]
  return samples.find(ok)?.t
}

const hms = (t) => new Date(t).toISOString().slice(11, 19)
const pad = (s, n) => String(s).padEnd(n)
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }

export function summarize(lines) {
  const rows = lines.filter((r) => r.src && !r.error).map((r) => ({ ...r, t: Date.parse(r.t) }))
  const errs = {}
  for (const r of lines) if (r.error) errs[`${r.src}: ${r.error}`] = (errs[`${r.src}: ${r.error}`] ?? 0) + 1
  const lags = { api_date: [], api_live: [], prod: [] }
  const missed = { api_date: 0, api_live: 0, prod: 0 }
  const out = []
  const games = [...new Set(rows.map((r) => r.key))]
  for (const g of games) {
    const by = (name) => rows.filter((r) => r.key === g && r.src === name).sort((a, b) => a.t - b.t)
    const events = espnEvents(by('espn'))
    if (!events.length) continue
    const first = by('espn')[0]
    out.push(`\n${first.away} @ ${first.home}`)
    out.push(`${pad('event', 22)}${pad('ESPN (UTC)', 12)}${pad('date-query', 12)}${pad('live=all', 12)}${pad('prod-row', 12)}`)
    for (const e of events) {
      const cells = Object.keys(lags).map((name) => {
        const t = seenAt(by(name), e)
        if (t == null) { missed[name]++; return by(name).length ? 'never' : '-' }
        const lag = Math.round((t - e.t) / 1000)
        lags[name].push(lag)
        return `${lag >= 0 ? '+' : ''}${lag}s`
      })
      out.push(`${pad(e.label, 22)}${pad(hms(e.t), 12)}${cells.map((c) => pad(c, 12)).join('')}`)
    }
  }
  if (!out.length) out.push('no ESPN events (no game changed state during the run)')
  out.push('\nlag vs ESPN, seconds (ESPN time has +/-15 s sampling resolution; ESPN itself trails the broadcast)')
  out.push(`${pad('source', 12)}${pad('seen', 6)}${pad('never', 7)}${pad('min', 7)}${pad('median', 8)}${pad('max', 7)}shape`)
  for (const [name, l] of Object.entries(lags)) {
    if (!l.length) { out.push(`${pad(NAMES[name], 12)}${pad(0, 6)}${pad(missed[name], 7)}no data`); continue }
    const [mn, md, mx] = [Math.min(...l), median(l), Math.max(...l)]
    out.push(`${pad(NAMES[name], 12)}${pad(l.length, 6)}${pad(missed[name], 7)}${pad(mn, 7)}${pad(md, 8)}${pad(mx, 7)}${mx - mn <= 30 ? 'constant (spread <= 30 s)' : 'bursty (spread > 30 s)'}`)
  }
  for (const [e, n] of Object.entries(errs)) out.push(`errors x${n}: ${e}`)
  return out.join('\n')
}

// smallest check that fails if the lag logic breaks: a fake game where date-query trails ESPN by 60 s on
// the score and 120 s on the final, live=all trails by 30 s and skips a score, prod never shows the final
function selftest() {
  const mk = (src, t, hs, as, period, state) => ({ src, key: 'a|b|d', home: 'A b', away: 'B a', t: new Date(t * 1000).toISOString(), hs, as, period, state })
  const L = [
    mk('espn', 0, 0, 0, null, 'pre'), mk('espn', 15, 0, 0, 1, 'in'), mk('espn', 30, 0, 7, 1, 'in'), mk('espn', 60, 3, 7, 1, 'in'), mk('espn', 100, 3, 7, 4, 'post'),
    mk('api_date', 0, 0, 0, null, 'pre'), mk('api_date', 75, 0, 0, 1, 'in'), mk('api_date', 90, 0, 7, 1, 'in'), mk('api_date', 120, 3, 7, 1, 'in'), mk('api_date', 220, 3, 7, 4, 'post'),
    mk('api_live', 45, 0, 7, 1, 'in'), mk('api_live', 90, 3, 7, 1, 'in'),
    mk('prod', 0, 0, 0, null, 'pre'), mk('prod', 20, 0, 7, 1, 'in'),
  ]
  const ev = espnEvents(L.filter((r) => r.src === 'espn'))
  const lag = (name, i) => { const t = seenAt(L.filter((r) => r.src === name), ev[i]); return t && (Date.parse(t) - Date.parse(ev[i].t)) / 1000 }
  console.assert(ev.map((e) => e.label).join() === 'period 1,a 7-0 b,a 7-3 b,final', ev.map((e) => e.label).join())
  const [kick, s1, s2, fin] = [0, 1, 2, 3]
  const ok = lag('api_date', kick) === 60 && lag('api_date', s1) === 60 && lag('api_date', s2) === 60 && lag('api_date', fin) === 120
    && lag('api_live', s1) === 15 && lag('api_live', s2) === 30 && lag('prod', s1) === -10 && lag('prod', fin) === undefined
  if (!ok) { console.error('selftest FAILED'); process.exit(1) }
  console.log('selftest ok\n' + summarize(L))
}

const cmd = process.argv[2]
const load = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
if (process.argv[1].endsWith('live-lag.mjs')) {
  if (cmd === 'summary') console.log(summarize(load(process.argv[3])))
  else if (cmd === 'selftest') selftest()
  else run().then((out) => { if (arg('minutes')) console.log(summarize(load(out))) }, (e) => { console.error(e.message); process.exit(1) })
}
