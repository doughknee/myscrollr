# Local full-stack dev

Run MyScrollr locally with **real sign-in** (your prod Logto tenant) but a
**local database + local API**. No prod data is touched.

---

## Quick start (one command)

The whole **backend** — Postgres, Redis, the Core API, and every channel (Go
API + Rust ingester) — runs in Docker via `docker-compose.dev.yml`, driven by
a `Makefile`. The **front-ends stay native**: the Tauri desktop app is a GUI
window that can't run in a Linux container, and the marketing site hot-reloads
better on the host.

```bash
make up        # build + start the entire backend, wait until it's healthy
make web       # (new terminal) marketing site   → http://localhost:3000
make desktop   # (new terminal) the Tauri desktop app
```

…or `make dev` to bring the backend up and open `web` + `desktop` in their own
windows. `make help` lists everything. Day-to-day:

| Command | What it does |
|---|---|
| `make up` | Build + start the backend in Docker; waits for health + channel discovery. |
| `make down` | Stop the backend (**keeps** your local DB). |
| `make logs` \| `make logs svc=core-api` | Tail all logs, or one service. |
| `make ps` | Container status. |
| `make rebuild` | Force a clean image rebuild after you edit backend code. |
| `make clean` | Stop **and wipe** the Postgres + Redis volumes. |
| `make web` / `make desktop` | Run the front-ends natively. |

**Ports** (host): core `18080` (serves `/finance/*`, `/sports/*`, `/rss/*`,
and `/predictions/*` natively per ADR-0002), fantasy `8084`,
site `3000`. Postgres `5432`, Redis `6379`.

### Prereqs (one-time)

1. **Docker Desktop** running.
2. The gitignored `.env` files must exist — `api/.env`, `desktop/.env`, and
   `channels/<ch>/.env`. `make up` reuses them for secrets/config and only
   overrides the container networking (DB/Redis host, `CHANNEL_URL`,
   `INTERNAL_*_URL`, `PORT`). If you're starting from scratch, populate them
   per the milestones below.
3. **Predictions/Kalshi** is optional. `make up` runs `make prep`, which
   extracts the Kalshi key from `channels/predictions/.env` into gitignored
   files under `secrets/` (the RSA PEM is mounted as a file — Docker's
   `env_file` can't carry a multiline value). No `.env`? `make kalshi-key`
   pulls it from the `scrollr-secrets` cluster secret. If neither is present,
   the predictions channel is simply skipped and the rest of the stack runs.

### After editing backend code

Images are built from the committed source, so a code change needs a rebuild:
`make rebuild` (or `make up` again — it does an incremental `--build`). The Go
images build in seconds; the Rust ones use `cargo-chef`, so only your changed
crate recompiles.

### The desktop ".exe" prompt

That's Windows SmartScreen / the firewall reacting to the **unsigned local dev
build** — it runs on the host, so Docker can't remove it. It's a host-side
thing, not part of this stack. (See the note at the end of this doc.)

---

## The two milestones (manual runbook / underlying detail)

`make up` automates everything below; this section is the fallback and explains
what the containers actually do.

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

All data channels run locally against the **same** Postgres/Redis as the
Core API. fantasy is the one remaining **Go API** (registers itself in
Redis; the Core discovers + proxies it); the finance, sports, rss, and
predictions Go APIs were folded into core (ADR-0002). finance/sports/rss/
predictions each have a **Rust ingester** (polls the provider, writes
rows). Fantasy is Go-native (in-process sync).

### Ports & secrets

| Channel | Go API | Rust ingester | Provider secret |
|---|---|---|---|
| rss     | (in core) | 3004 | none (public feeds) |
| finance | (in core) | 3001 | `TWELVEDATA_API_KEY` |
| sports  | (in core) | 3002 | `API_SPORTS_KEY` |
| fantasy | 8084     | —    | `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` |
| predictions | (in core) | 3005 | Kalshi key via `make prep` |

Provider keys live in the DO cluster secret `scrollr-secrets`
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

# Rust ingesters                                                       fantasy (Go-native)
( cd channels/rss/service     && set -a && . ../.env && set +a && cargo run )              # :3004
( cd channels/finance/service && set -a && . ../.env && set +a && cargo run )              # :3001
( cd channels/sports/service  && set -a && . ../.env && set +a && cargo run )              # :3002
( cd channels/fantasy/api     && set -a && . ../.env && set +a && "$GO" run . )            # :8084
```

The finance, sports, rss, and predictions Go APIs were folded into core
(ADR-0002): core serves `/finance/*`, `/sports/*`, `/rss/*`, and
`/predictions/*` itself and probes the Rust ingesters via
`INTERNAL_{FINANCE,SPORTS,RSS,PREDICTIONS}_URL` (set them in `api/.env`,
e.g. `http://localhost:3001`; unset means core reports that source
healthy without probing). Core also runs the RSS janitor (Redis-locked).

The Core logs `[Discovery] Channels updated: 1 active [fantasy]`
within ~10s of the fantasy API starting.

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
make down     # stop the whole backend, keep data   (≡ compose down)
make clean    # stop AND wipe the Postgres + Redis volumes (≡ compose down -v)
```
The front-ends are native, so stop them by closing their window / Ctrl+C.

Legacy (infra-only) equivalents still work and share the same containers:
```bash
docker compose -f docker-compose.local.yml down     # keep data
docker compose -f docker-compose.local.yml down -v  # wipe data
```

---

## The desktop dev build & the Windows "run this .exe?" prompt

The Tauri desktop app is a native Windows binary (`scrollr-desktop.exe` +
WebView2). Because it's an **unsigned local dev build**, Windows Defender
SmartScreen and/or the firewall prompt the first time it runs. This is a
host-side OS behavior — the app can't be containerized, so Docker has no
bearing on it.

To stop the nag, pre-approve the dev binary once (PowerShell as admin):

```powershell
# Allow the Tauri dev binary through the firewall (adjust the path if needed)
$exe = "$PWD\desktop\src-tauri\target\debug\scrollr-desktop.exe"
New-NetFirewallRule -DisplayName "Scrollr dev" -Direction Inbound `
  -Program $exe -Action Allow -Profile Any
```

SmartScreen's "Windows protected your PC" dialog (a separate thing from the
firewall) only appears for downloaded/packaged builds; the `tauri dev` binary
running from your own build tree usually doesn't trigger it. If it does, "More
info → Run anyway" once is remembered. The real fix is code-signing, which the
**release** builds already do — this only affects local dev.
