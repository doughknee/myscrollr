# Yahoo Fantasy API Reference

Canonical notes on the Yahoo Fantasy Sports v2 API for MyScrollr's fantasy
channel. Generated from live probe output (April 2026) against league
`469.l.35099` — MLB H2H categories. See `scripts/yahoo-probe/` for the
read-only probing tool, including the `manifest.tsv` that produced the raw
XML samples this doc is based on.

## TL;DR

- Yahoo refresh tokens are **rotated on every use**. Our prod sync clobbers
  any token you try to share — pause the deployment (`kubectl scale
  deployment/fantasy-api --replicas=0`) before probing.
- The DB stores refresh tokens **encrypted** with AES-256-GCM under
  `ENCRYPTION_KEY`. Read + decrypt before using.
- Stat labels are league-specific and must come from
  `league/{key}/settings`. Hardcoded `stat_id → label` tables are a bug
  magnet because:
  - Stats are scoped per league (a league can choose its categories).
  - `stat_id` values are shared across sports — `28` is `W` in some
    codebases but `1BA` in MLB.
  - Leagues can include display-only stats (`H/AB`, `IP`) that aren't
    scored but are meaningful.
- Stat values are **strings**, not numbers. `5/17`, `3.2` (meaning 3⅔
  innings), `.686`, and `-` all come back as strings.

## OAuth flow

- Token endpoint: `https://api.login.yahoo.com/oauth2/get_token`
- **Form body** auth (NOT HTTP Basic):
  ```
  client_id=...
  client_secret=...
  grant_type=refresh_token
  refresh_token=...
  ```
- Response: JSON `{ "access_token": "...", "refresh_token": "...", "expires_in": 3600, "token_type": "bearer" }`
- **Yahoo rotates the refresh_token** on every exchange. Store the new
  value back if it's different from what you sent.
- Access tokens last 1 hour. Refresh as needed.

## Base URL

```
https://fantasysports.yahooapis.com/fantasy/v2
```

Header: `Authorization: Bearer {access_token}`. Responses are XML with the
namespace `http://fantasysports.yahooapis.com/fantasy/v2/base.rng` on every
element (painful for lxml-style strict parsers — regex works fine).

## Endpoint Catalog

### `league/{league_key}/settings` — stat catalog + scoring rules

The authoritative source for what stats exist in a league.

```xml
<league>
  <settings>
    <stat_categories>
      <stats>
        <stat>
          <stat_id>7</stat_id>
          <enabled>1</enabled>
          <name>Runs</name>
          <display_name>R</display_name>
          <sort_order>1</sort_order>
          <position_type>B</position_type>
          <stat_position_types>
            <stat_position_type>
              <position_type>B</position_type>
            </stat_position_type>
          </stat_position_types>
        </stat>
        <stat>
          <stat_id>60</stat_id>
          <enabled>1</enabled>
          <display_name>H/AB</display_name>
          <position_type>B</position_type>
          <stat_position_types>
            <stat_position_type>
              <position_type>B</position_type>
              <is_only_display_stat>1</is_only_display_stat>
            </stat_position_type>
          </stat_position_types>
          <is_only_display_stat>1</is_only_display_stat>
        </stat>
        <!-- ... one <stat> per enabled category ... -->
      </stats>
    </stat_categories>
    <stat_modifiers>
      <stats>
        <!-- empty for H2H cats leagues; populated for H2H/Rotisserie points -->
        <stat>
          <stat_id>12</stat_id>
          <value>4.0</value>
        </stat>
      </stats>
    </stat_modifiers>
  </settings>
</league>
```

**Key fields per stat:**
- `stat_id` — numeric identifier, NOT globally consistent between sports
- `display_name` — what the UI should show (e.g. `R`, `HR`, `OPS`)
- `name` — long form (e.g. `Runs`)
- `position_type` — `B` (batter), `P` (pitcher), `O` (offense), `D` (defense), etc.
- `sort_order` — the league's preferred display order
- `is_only_display_stat` — 1 means "shown but not scored"; 0 means "counted"
- `enabled` — 1 means part of this league's config

### `team/{team_key}/roster` — roster without stats

Returns the lineup (players + their `selected_position`) with NO stats.
Use only when you explicitly don't need points.

### `team/{team_key}/roster;week={W}/players/stats;type=week;week={W}` — roster with weekly stats

**Our canonical endpoint for live matchup data.** Returns each player on
the team plus their stats for that week as `<player_stats>` blocks.

- Outer `;week=W` pins the lineup (the week's roster layout).
- Nested `/players/stats;type=week;week=W` pins the stat window to that
  week.

```xml
<player>
  <player_key>469.p.11531</player_key>
  <name>
    <full>Cal Raleigh</full>
  </name>
  <position_type>B</position_type>
  <selected_position>
    <position>C</position>
  </selected_position>
  <player_stats>
    <coverage_type>week</coverage_type>
    <week>4</week>
    <stats>
      <stat><stat_id>60</stat_id><value>5/17</value></stat>
      <stat><stat_id>7</stat_id><value>2</value></stat>
      <stat><stat_id>12</stat_id><value>0</value></stat>
      <stat><stat_id>13</stat_id><value>1</value></stat>
      <stat><stat_id>16</stat_id><value>0</value></stat>
      <stat><stat_id>55</stat_id><value>.686</value></stat>
    </stats>
  </player_stats>
</player>
```

Yahoo returns **only the stats relevant to the league's categories** at
this coverage type. For a 6-cat H2H cats league you get 6 stats per
hitter. For a 6-cat pitcher block you get pitcher stats, and Yahoo will
often include one or two "close cousin" stats (e.g. `SV+H`/stat_id 89) as
context even if the league doesn't score them.

**Bench, IR, and NA players** return the same `<stat>` elements but with
`<value>-</value>`. A dash means "no data for this coverage" — it is NOT
zero.

### `team/{team_key}/roster;week={W}/players/stats;type=season` — season stats

Returns every stat Yahoo tracks for each player season-to-date. ~40
stats per hitter, ~50 per pitcher. Much larger payload. Not what we want
for weekly matchup display, but useful for deep views.

### `players;player_keys={k1},{k2}/stats;type=week;week={W}` — single-player drill-down

Batch stats fetch. Accepts a comma-separated list of player_keys. Used
for targeted lookups without pulling the whole roster.

### `game/{sport}/stat_categories` — sport-wide catalog

Returns every stat_id Yahoo tracks for a sport, regardless of league
configuration. Useful as a fallback label map but do NOT use this in
place of a league's own `<stat_categories>` — leagues can rename stats
and exclude ones they don't score.

### `game/{sport}/position_types` — position_type vocabulary

Enumerates valid position_type values for the sport. For MLB: `B`
(batter), `P` (pitcher). Used to route batters vs pitchers through
different display logic.

## Stat ID Reference (MLB — per league 469.l.35099)

| stat_id | display_name | position_type | display-only | Example value |
|---|---|---|---|---|
| 60 | H/AB | B | **yes** | `5/17` (ratio string) |
| 7 | R | B | no | `2` |
| 12 | HR | B | no | `0` |
| 13 | RBI | B | no | `1` |
| 16 | SB | B | no | `0` |
| 55 | OPS | B | no | `.686` (leading period) |
| 50 | IP | P | **yes** | `3.0` (⅓-innings, `.1` = 1/3, `.2` = 2/3) |
| 42 | K | P | no | `5` |
| 26 | ERA | P | no | `0.00` |
| 27 | WHIP | P | no | `0.33` |
| 83 | QS | P | no | `0` |

**Observed bonus stats returned by `type=week` even though the league
doesn't score them:**

| stat_id | display_name | position_type | Notes |
|---|---|---|---|
| 89 | SV+H | P | Saves + Holds, always returned for relievers |

## MLB IP (innings pitched) is NOT a float

Yahoo encodes innings as a decimal where the **fractional part represents
thirds**, not tenths:

| Yahoo value | Real innings |
|---|---|
| `0.0` | 0 (no innings pitched) |
| `0.1` | ⅓ |
| `0.2` | ⅔ |
| `1.0` | 1 |
| `3.2` | 3⅔ |
| `6.0` | 6 |

Do NOT run this through `parseFloat` and display the result as a decimal —
`3.2` must render as `3.2` (or `3 2/3`), not `3.2`. Treat as an opaque
string.

## Value formats you will encounter

| Format | Example | Meaning |
|---|---|---|
| Integer | `"5"` | Counting stat (HRs, RBIs, SBs, Ks, etc.) |
| Float | `"0.00"`, `"1.093"` | Rate stat (ERA, WHIP) |
| Leading-period decimal | `".686"`, `".333"` | Percentage/ratio (OPS, AVG) |
| Ratio | `"5/17"` | Hits/At-Bats |
| Innings | `"3.2"` | Thirds-encoded IP |
| Dash | `"-"` | No data for this coverage window |

**If you need a float (e.g. for synthetic points math), try
`strconv.ParseFloat` and treat failures as "not countable." Never assume
every Yahoo value parses cleanly.**

## Stat modifiers — points leagues only

For points-style leagues, `<stat_modifiers>` populates with
`stat_id → value` pairs. Synthetic points = `sum(stat_value * modifier)`
across all countable stats.

For pure categories leagues (like the user's MLB H2H cats), the
`<stat_modifiers>` block is present but has zero `<stat>` children.
No synthetic total should be computed; the individual categories ARE the
scoreboard.

## Position types (MLB)

- `B` — Batter (hitter)
- `P` — Pitcher

A stat's `position_type` determines which player types should display it.
Mixing hitter stats into a pitcher's row (or vice versa) makes the UI
nonsensical.

## Rotations + gotchas

- **Refresh token rotation races.** Our 120s sync loop rotates tokens on
  every cycle. Two clients sharing a token will fight; one always wins.
- **Encrypted at rest.** `yahoo_users.refresh_token` is
  AES-256-GCM-encrypted with `ENCRYPTION_KEY` (base64 of 32 bytes). Wire
  format: `base64(12-byte nonce || ciphertext || 16-byte GCM tag)`.
- **Rate limits** are poorly documented. Our prod sync spaces requests
  by `DefaultAPIDelay`. The probe tool uses 300ms between requests,
  which has been reliable.
- **XML namespace pollution.** Yahoo duplicates `xmlns` on every element;
  strict XML parsers (lxml, Python's ElementTree) choke. Regex
  extraction or encoding/xml's lenient decoder handle it fine.

## Reference: the user's league (`469.l.35099`) verified values

These are the **actual** week 4 (current) stats for two players, as
returned by Yahoo on 2026-04-18:

### Cal Raleigh (C, hitter) — `469.p.11531`
```
H/AB 5/17 · R 2 · HR 0 · RBI 1 · SB 0 · OPS .686
```

### Ryan Helsley (P, pitcher) — `469.p.10946`
```
IP 3.0 · K 5 · ERA 0.00 · WHIP 0.33 · QS 0 · SV+H 2
```

## Reproducing the probe

```sh
cd scripts/yahoo-probe

# Scale prod down to avoid rotation fights
kubectl scale deployment -n scrollr fantasy-api --replicas=0

# Credentials
export YAHOO_CLIENT_ID=$(kubectl get secret -n scrollr scrollr-secrets \
    -o jsonpath='{.data.YAHOO_CLIENT_ID}' | base64 -d)
export YAHOO_CLIENT_SECRET=$(kubectl get secret -n scrollr scrollr-secrets \
    -o jsonpath='{.data.YAHOO_CLIENT_SECRET}' | base64 -d)
export ENCRYPTION_KEY=$(kubectl get secret -n scrollr scrollr-secrets \
    -o jsonpath='{.data.ENCRYPTION_KEY}' | base64 -d)

# Refresh token (encrypted; the probe decrypts in-memory)
export YAHOO_REFRESH_TOKEN_ENCRYPTED=$(kubectl run -n scrollr psql-tmp --rm -i \
    --restart=Never --image=postgres:16 --env="PGPASSWORD=..." \
    -- psql -h ... -t -A -c \
    "SELECT refresh_token FROM yahoo_users WHERE guid='...';")

# Run
go run . --batch manifest.tsv

# Restore prod
kubectl scale deployment -n scrollr fantasy-api --replicas=1

# Scrub local env when done
unset YAHOO_REFRESH_TOKEN_ENCRYPTED YAHOO_CLIENT_ID YAHOO_CLIENT_SECRET ENCRYPTION_KEY
rm -rf out/
```
