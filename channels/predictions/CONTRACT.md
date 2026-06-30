# Predictions channel — canonical data contract (pin this across all layers)

All three layers (Rust ingestion service, Go API, desktop UI) MUST agree on these
names. Pricing is stored as **integer cents 0–100** (== implied probability %),
derived from Kalshi's `*_dollars` decimal strings (`round(dollars * 100)`).
JSON keys == DB column names (snake_case), matching the finance channel convention.

## Postgres tables (Rust service owns; migrations prefix `14*`)

### `markets` — the CDC/display table (one row per tracked Kalshi market)
| column | type | notes |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | `"kalshi:" || ticker` |
| `source` | TEXT NOT NULL DEFAULT 'kalshi' | future: polymarket, etc. |
| `ticker` | TEXT NOT NULL | Kalshi market ticker |
| `event_ticker` | TEXT | grouping key |
| `series_ticker` | TEXT | for candlesticks |
| `category` | TEXT | derived bucket: Politics/Sports/Economics/Weather/Crypto/World/Other |
| `title` | TEXT | short display title (from event title / sub_title) |
| `subtitle` | TEXT | `yes_sub_title` |
| `yes_price` | INT | cents 0–100 == implied % (from `last_price_dollars`) |
| `yes_bid` | INT | cents |
| `yes_ask` | INT | cents |
| `prev_yes_price` | INT | cents — previous value, drives "movers" |
| `volume` | BIGINT | from `volume_fp` (floor) |
| `volume_24h` | BIGINT | from `volume_24h_fp` |
| `open_interest` | BIGINT | from `open_interest_fp` |
| `status` | TEXT | lifecycle: active/closed/determined/settled |
| `result` | TEXT | yes/no/'' when settled |
| `is_primary` | BOOLEAN NOT NULL DEFAULT TRUE | representative market per event (filter noise) |
| `open_time` | TIMESTAMPTZ | |
| `close_time` | TIMESTAMPTZ | |
| `link` | TEXT | `https://kalshi.com/markets/{series}/{event}` |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | CDC ordering |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

`REPLICA IDENTITY FULL`. Upsert on `id`. **Coalesce/change-detect**: only UPDATE
when a displayed field actually changed (skip no-op ticks) — finance has no such
guard; predictions needs it (Kalshi ticks are high-frequency).

### `tracked_markets` — catalog (mirrors finance `tracked_symbols`)
`id SERIAL PK, ticker TEXT UNIQUE, title TEXT, category TEXT, series_ticker TEXT,
is_enabled BOOL DEFAULT true, last_polled_at TIMESTAMPTZ, last_poll_success_at
TIMESTAMPTZ, last_poll_error TEXT, created_at TIMESTAMPTZ DEFAULT now()`.

## Desktop `Prediction` type (`desktop/src/types/index.ts`) — JSON from CDC/dashboard
```ts
export interface Prediction {
  id: string;
  source: string;
  ticker: string;
  event_ticker?: string;
  category?: string;
  title: string;
  subtitle?: string;
  yes_price: number;       // cents 0-100 == implied %
  yes_bid?: number;
  yes_ask?: number;
  prev_yes_price?: number; // for ▲/▼ delta
  volume?: number;
  open_interest?: number;
  status?: string;
  result?: string;
  close_time?: string;     // RFC3339
  link?: string;
  updated_at?: string;     // RFC3339
}
```
`DashboardResponse.data.predictions?: Prediction[]`.

## CDC + routing names (pin exactly)
- **CDC/Postgres table name: `markets`** (NOT "predictions").
- Channel id / `channel_type` / dashboard dataKey: **`predictions`**.
- `cdc_tables` in manifest + Go registration: **`["markets"]`**.
- Desktop `CDC_TABLES` entry: `{ table: "markets", dataKey: "predictions", keyOf: i => (i as Prediction).id, ... }`.
- Go `handleInternalDashboard` response key: **`"predictions"`**.
- Core topic routing (v1 = channel-wide broadcast, simplest correct wiring):
  - `constants.go`: `TopicPrefixPredictions = "cdc:predictions:"`
  - `handlers_webhook.go` `topicForRecord`: `case "markets": return TopicPrefixPredictions + "all"`
  - `events.go` `listenToTopics`: add `TopicPrefixPredictions+"*"` to `PSubscribe` (+ the log line)
  - `events.go` `subscribeUserToTopics`: `case "predictions": globalHub.registry.subscribe(userID, TopicPrefixPredictions+"all")` (subscribe whenever predictions channel is enabled; no per-entity config needed in v1)
- **Tier limits: do NOT add a new cap field in v1** (avoids the 5-file sync). The
  desktop ConfigPanel reuses an existing limit key (e.g. `symbols`) for the
  favorites cap. Tier placement is open product decision Q10.

## User channel config shape (`user_channels.config` for channel_type=predictions)
`{ "categories": string[], "favorites": string[] }` — categories drive the
ticker contents; favorites pin specific markets. (v1 routing ignores these and
broadcasts; they're stored for the UI + future per-category routing.)

## Ports / env (Rust service + Go API)
- Rust service: PORT default `3005` (finance 3001, sports 3002, rss 3004).
- Go API: PORT default `8085` (finance 8081, sports 8082, rss 8083, fantasy 8084).
- Rust env: `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY` (inline PEM) or `KALSHI_PRIVATE_KEY_PATH`, `KALSHI_ENV` (demo|prod), `DATABASE_URL`.
- Go env: `DATABASE_URL`, `REDIS_URL`, `PORT`, `CHANNEL_URL`, `INTERNAL_PREDICTIONS_URL`, Sentry vars.
