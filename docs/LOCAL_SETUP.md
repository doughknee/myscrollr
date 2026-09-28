# Local development

## Front-end only: no Docker

Working in `desktop/` or `myscrollr.com/` and not touching Go or Rust? Skip the
local backend. A permanent, keyless dev backend runs at
`https://dev-api.myscrollr.com` (core + finance/sports/rss ingesters, its own
Postgres and Redis, seeded and kept "live" by the same `make seed` / `make live`
logic; see `docker/compose.dev-remote.yml`).

```bash
make setup DEV_API=remote   # writes desktop/.env + myscrollr.com/.env pointing at it
make setup DEV_API=local    # point them back at localhost:18080 (other settings kept)
make desktop                # or: make web
```

You need Node 22+ and make; **no Docker**. Setup asks for the Logto app ids
(desktop and website) and defaults the Logto URL to the shared tenant. Existing
`.env` files are kept, so delete `desktop/.env` first if you had a local-stack one.

What to know:

- It is shared and keyless. Data is the dev snapshot, moved by a clock, never
  real quotes. Do not expect data to persist across a redeploy of the stack.
- No Sequin, so SSE / CDC live pushes do not flow (identical to the local stack).
- Sign-in uses the shared Logto tenant. The desktop dev build's localhost
  redirect works as-is; the website needs `http://localhost:3000/callback`
  allowed on its Logto app.
- CORS allows `localhost:3000`, `:5174` and `:5180` (the browser shim).
- To edit Go or Rust, use the Docker loop below; the remote stack runs published
  `main` images, not your working tree.

Operating it (Coolify, secrets, redeploys): the compose file's header comment.

## Full local stack

Three commands from a fresh clone:

```bash
make setup   # generate every .env file (once)
make up      # start the whole backend
make seed    # load the dev dataset (no API keys, no API calls)

The seed is a snapshot and does not move on its own; a day later the ticker shows only
floors and stale finals. `make live` re-anchors it on "now" and then advances it every
few seconds (games kick off, scores change, finals land, prices drift) with no upstream
requests. Ctrl-C to stop. `scripts/dev/seed.sh rebase` re-anchors without the loop.
```

Then `make dev` to also open the marketing site and the desktop app, or
`make web` / `make desktop` individually.

`make` on its own prints every command, grouped. That help screen is the
reference — this page only covers what it can't fit.

## What you need installed

| | Why |
|---|---|
| **Docker Desktop** | The entire backend runs in containers. This is the only hard requirement. |
| **Node 22+** | The marketing site and desktop app run natively on the host. |
| **make** | The entry point. Windows: `winget install ezwinports.make`. |

**No Go or Rust toolchain is required.** Both compile inside their
containers. `make doctor` checks all of the above and names the fix for
anything missing.

## What runs where

| Component | Where | Port |
|---|---|---|
| Postgres, Redis | Docker | 5432, 6379 |
| Core API | Docker | **18080** |
| finance / sports / rss ingesters (Rust) | Docker | 3001 / 3002 / 3004 |
| Marketing site | Native (Vite) | 3000 |
| Desktop app | Native (Tauri) | — |

Core is on **18080, not 8080** — Steam's CEF debugger claims localhost:8080
on Windows. Containers still reach core on 8080 over the compose network.

The two front-ends stay native on purpose: a GUI window can't run in a Linux
container, and both hot-reload better on the host.

## Disk footprint

Roughly **12-15 GB** once everything is built: Docker Desktop itself (~2.5 GB),
the base images (~1.5 GB), and the Rust build caches (~8 GB, the bulk of it).
WSL2 with `--no-distribution` adds only ~150 MB -- it is not the expensive part.

Two levers if that matters:

- `make up svc=core-api` starts one service and whatever it depends on,
  instead of all six. Each Rust ingester you skip is ~2 GB of build cache
  you never create.
- `make reset` wipes the caches (and your database) when they go stale.

The three Rust services share one `cargo_registry` volume, so overlapping
crate sources are downloaded once rather than three times.

## Editing backend code

**You don't rebuild anything.** Each service's container runs a file watcher
against your bind-mounted source — `air` for Go, `cargo watch` for Rust — so
saving a `.go` or `.rs` file rebuilds that one service in place.

`make logs svc=core-api` to watch it happen.

`make rebuild` is only for **dependency** changes (`go.mod`, `Cargo.toml`),
which need the image rebuilt. Add `svc=` to do just one.

> Both watchers run in polling mode. Bind mounts on Windows and macOS don't
> deliver filesystem events reliably, and the failure mode is silent — the
> watcher simply never fires and looks broken.

## Auth

There is no local Logto. `make setup` asks for the shared tenant's URL and
app ids; leave them blank and the stack still boots and serves public data,
you just can't sign in.

The desktop app requests its token for the **production** API resource while
calling your local API — Logto only recognises resources it has registered.
That's what `VITE_LOGTO_RESOURCE` in `desktop/.env` is for. Without it,
sign-in fails with *"resource indicator is missing, or unknown"*.

## Data

Local Postgres is yours; production is never touched. Core applies every
migration on boot, so a fresh volume becomes a working schema by itself — but
an empty one. `make seed` fills it.

```bash
make seed
```

That loads `scripts/dev/seed.sql.gz`, a committed snapshot of the content
tables (trades, games, standings, teams, rss items and the tracked_*
config). It makes **no upstream API requests**, and it is idempotent — re-run
it whenever you want a clean dataset back.

**Do not paste production API keys into `channels/*/.env`.** `make setup`
leaves them blank on purpose, and the ingesters handle that correctly: they
stay up, skip polling, and serve what is in Postgres. The keys that would
work there are the production ones, and the quota they draw on belongs to
real users — api-sports bills a shared daily quota per sport host (7,500 on Pro, 75,000 on Ultra)
across every league. Seeding gives you the same app without spending any of it.

Because those keyless ingesters never poll by design, `/health` reports
`finance` and `sports` as `idle` (not `down`) in this setup — that is
expected, not a broken stack.

Loading also rebases timestamps, because several read paths are
time-relative: RSS articles older than 7 days are deleted by the ingester,
and the RSS janitor disables curated feeds that look stale. A snapshot
restored months later would be present in the database and invisible in the
app. `seed.sh` documents which shift belongs to which query.

- `make down` stops everything and **keeps** your data.
- `make reset` wipes the database, Redis and the build caches. Re-seed after.

### Re-recording the dataset

Rare, and only when the schema or the shape of the content changes:

```bash
make seed-capture                                   # from your local database
SOURCE_DATABASE_URL=postgres://... make seed-capture # from a read-only replica
```

The second form costs **zero** upstream requests — production already paid
for that data. Point it at a `kubectl port-forward` with
`host.docker.internal` as the host. Only the content tables are read;
nothing containing user data (`yahoo_*`, `user_*`, `stripe_*`, `support_*`)
is touched, which is what makes the snapshot safe to commit. Commit the
regenerated `scripts/dev/seed.sql.gz`.

## Driving the app from a script

The dev build listens for commands from the dev server, so a script (or an
AI agent) can set state in either window and read back what it rendered:

```bash
node scripts/dev/devctl.mjs ticker 'text().slice(0, 200)'          # what the bar shows
node scripts/dev/devctl.mjs main 'router.navigate({ to: "/catalog" })'
node scripts/dev/devctl.mjs main 'savePrefs({ ...prefs(), appearance: { ...prefs().appearance, themeMode: "light" } })'
```

`prefs()`, `savePrefs`, `qc` (the query client), `invoke`, `text()`, `rect()` and
`router` (main window) are in scope; `await import("/src/…")` reaches anything
else. Set prefs from the **main** window: the ticker listens cross-window and
ignores writes that match its own cache. Dev builds only. The window name is
the Tauri label, so with the ticker on two monitors `ticker-2` addresses the
second one (its window title is "Scrollr Ticker 2").

To see a window as it really is, capture it (no screen grab, other windows do
not matter):

```bash
powershell -File scripts/dev/capture-window.ps1 -Title "Scrollr Ticker" -Out ticker.png
```

`make screenshots` chains the two to re-shoot every ticker screenshot on the
website (theme × density × channel) from the running app, then runs the site's
optimizer. It puts your prefs and bar back afterwards. Windows only.

## The Windows "run this .exe?" prompt

The Tauri dev binary is unsigned, so Windows SmartScreen and the firewall
both ask on first run. Allow it once:

```powershell
New-NetFirewallRule -DisplayName "Scrollr dev" -Direction Inbound `
  -Program "C:\path\to\myscrollr\desktop\src-tauri\target\debug\scrollr-desktop.exe" `
  -Action Allow
```

## When something's wrong

1. `make doctor` — Docker, ports, env files, tooling.
2. `make logs svc=<service>` — one service's output.
3. `make ps` — what's actually running.
4. `make reset && make up && make seed` — start from a clean database.

**The app is empty.** You have not run `make seed`, or you seeded within the
last 30 seconds and are seeing a cached response. Check the database directly:

```bash
curl -s localhost:18080/public/feed | head -c 200
```

Empty arrays there with rows in Postgres means a stale cache; `make seed`
clears it on every run.

Ports already held by something else are the most common failure; `doctor`
reports those specifically, and ignores ports held by our own containers.
