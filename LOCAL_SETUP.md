# Local full-stack dev

Run MyScrollr locally with **real sign-in** (your prod Logto tenant) but a
**local database + local API**. No prod data is touched. Two milestones:

- **Milestone 1 — Core + auth** (below): sign in, manage channels/widgets.
  Exercises slot-gating, Configure-from-catalog, the removed Display pages,
  server-side slot enforcement, and the `000014` channel→widget migration.
  Channels show empty (no data services yet).
- **Milestone 2 — Live channel data**: run the channel services for real
  stock/score/feed data. Needs provider API keys. See the bottom.

## What runs where

| Piece | How | Port |
|---|---|---|
| Postgres + Redis | Docker (`docker-compose.local.yml`) | 5432 / 6379 |
| Core API | native `go run .` in `api/` | **18080** |
| Desktop app | native `npm run tauri:dev` in `desktop/` | 5174 (Vite) |
| Auth | your **prod** Logto (`auth.myscrollr.com`) | — |

Config files (all gitignored except the compose + this doc):
`docker-compose.local.yml`, `api/.env`, `desktop/.env`.

---

> **Why 18080, not 8080?** Steam's CEF webhelper runs with
> `--remote-debugging-port=8080` bound to `127.0.0.1`, and on Windows that
> specific bind BEATS a `0.0.0.0:8080` bind for all `localhost` traffic —
> whenever Steam is open, every `localhost:8080` request silently lands in
> Steam's debugger (404s) while the Core API looks healthy. Discovered
> 2026-07-02 mid feel-pass. `api/.env` sets `PORT=18080` and
> `desktop/.env` points at it.

## Milestone 1 — Core + auth

### 0. Prereqs
- **Docker Desktop** (installing).
- Go + Node + cargo — already present.

### 1. Paste your desktop Logto app id
Edit `desktop/.env` and replace `PASTE_YOUR_DESKTOP_LOGTO_APP_ID_HERE` with
your desktop Logto app id (GitHub secret `DESKTOP_VITE_LOGTO_APP_ID`, or the
Logto admin console → your desktop app). Public OAuth client id — safe here.

### 2. Bring up Postgres + Redis
```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps   # wait for both healthy
```

### 3. Start the Core API (auto-migrates on boot)
```bash
cd api
go run .
```
Watch for: `[Auth] Initialized Logto JWKS from https://auth.myscrollr.com/oidc/jwks`,
the migrations applying, and the server listening on `:8080`.
Sanity check (new terminal): `curl http://localhost:18080/health`.

### 4. Start the desktop app
```bash
cd desktop
npm run tauri:dev
```
Click **Sign in** → your browser opens prod Logto → sign in → it redirects
back to the app (PKCE callback on `127.0.0.1:19284`). You're now authenticated
against the **local** API with your real account + tier.

### 5. Try it
- **Add channels** from the Catalog — this hits the local API's slot check.
  Add up to your tier's cap; the next one shows **"Widget limit reached"**.
  (On an unlimited tier you won't hit it — temporarily lower a number in
  `desktop/src/tierLimits.ts` + `api/core/tier_limits.go` to test the cap.)
- **Configure** an added channel straight from its catalog card.
- Open a source page → the **Options** menu has no "Display preferences".

---

## Milestone 2 — Live channel data (all four channels local)

All four data channels run locally against the **same** Postgres/Redis as the
Core API. Each channel is a **Go API** (registers itself in Redis; the Core
discovers + proxies it) plus, for finance/sports/rss, a **Rust ingester**
(polls the provider, writes rows). Fantasy is Go-native (in-process sync).

### Ports & secrets

| Channel | Go API | Rust ingester | Provider secret |
|---|---|---|---|
| rss     | 8083     | 3004 | none (public feeds) |
| finance | **8181** | 3001 | `TWELVEDATA_API_KEY` |
| sports  | 8082     | 3002 | `API_SPORTS_KEY` |
| fantasy | 8084     | —    | `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` |

Finance's Go API uses **8181**, not the default 8081 (a Windows `svchost` holds
8081 here). Provider keys live in the DO cluster secret `scrollr-secrets`
(namespace `scrollr`); pull them into gitignored `channels/<ch>/.env` with
kubectl, e.g.:

```bash
KUBECTL="$LOCALAPPDATA/kubectl/kubectl.exe"
"$KUBECTL" -n scrollr get secret scrollr-secrets -o "jsonpath={.data.TWELVEDATA_API_KEY}" | base64 -d
```

`ENCRYPTION_KEY` (sports, fantasy) must equal the **Core API's** local
`ENCRYPTION_KEY` in `api/.env` — it encrypts Yahoo tokens shared between Core
and the fantasy channel.

### Run each channel (Docker + Core API already up)

Each `channels/<ch>/.env` is shared by that channel's Go API and Rust ingester,
so export it before running. **Never put `PORT` in the shared `.env`** — both
processes read it and would collide; pass the Go API's port inline instead.

```bash
GO="$LOCALAPPDATA/go-toolchain/go/bin/go.exe"

# rss  (no key)          finance                          sports                fantasy (Go-native)
( cd channels/rss/service     && set -a && . ../.env && set +a && cargo run )              # :3004
( cd channels/rss/api         && set -a && . ../.env && set +a && "$GO" run . )            # :8083
( cd channels/finance/service && set -a && . ../.env && set +a && cargo run )              # :3001
( cd channels/finance/api     && set -a && . ../.env && set +a && PORT=8181 "$GO" run . )  # :8181
( cd channels/sports/service  && set -a && . ../.env && set +a && cargo run )              # :3002
( cd channels/sports/api      && set -a && . ../.env && set +a && "$GO" run . )            # :8082
( cd channels/fantasy/api     && set -a && . ../.env && set +a && "$GO" run . )            # :8084
```

The Core logs `[Discovery] Channels updated: 4 active [fantasy,finance,rss,sports]`
within ~10s of each Go API starting.

### Gotchas (hit and fixed)

- **RSS migrations are mis-ordered on a fresh DB.** `130000000001_user_custom_feeds`
  sorts *before* `20250601000001_initial` (which creates `tracked_feeds`), so a
  fresh DB fails. All four are idempotent — apply them once in dependency order,
  then the ingester's boot re-run is a clean no-op:
  ```bash
  for f in 20250601000001_initial 20250601000002_add_failure_tracking \
           130000000001_user_custom_feeds 130000000002_cleanup_dup_user_custom_feeds; do
    docker exec -i scrollr-postgres psql -U scrollr -d scrollr -v ON_ERROR_STOP=1 \
      < channels/rss/service/migrations/$f.up.sql
  done
  ```
  (finance `110…` and sports `120…` migrations are correctly ordered — no manual step.)
- **Shared `_sqlx_migrations`.** All Rust services share it by design
  (`set_ignore_missing(true)`), so their different version ranges coexist. The
  Core (golang-migrate) and fantasy (`schema_migrations_fantasy`) use their own
  tables, so no collision.
- **Fantasy Yahoo OAuth callback.** The connect flow redirects to
  `http://localhost:8084/fantasy/callback`; that URI must be registered in the
  Yahoo app or token exchange fails. The service runs regardless.
- **No Sequin locally** → no real-time SSE push; the desktop polls for updates.

### Predictions (Kalshi)

Not wired here — Kalshi isn't in `scrollr-secrets` (on-device key model). See
`channels/predictions/LOCAL_DEV.md`; that path is a signed-out demo bridge.

---

## Teardown
```bash
docker compose -f docker-compose.local.yml down     # keep data
docker compose -f docker-compose.local.yml down -v  # wipe data
```
