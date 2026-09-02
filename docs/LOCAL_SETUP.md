# Local development

Three commands from a fresh clone:

```bash
make setup   # generate every .env file (once)
make up      # start the whole backend
make seed    # load the dev dataset (no API keys, no API calls)
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
| Fantasy API (Go) | Docker | 8084 |
| finance / sports / rss ingesters (Rust) | Docker | 3001 / 3002 / 3004 |
| predictions ingester (Rust, opt-in) | Docker | 3005 |
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
  instead of all seven. Each Rust ingester you skip is ~2 GB of build cache
  you never create.
- `make reset` wipes the caches (and your database) when they go stale.

The four Rust services share one `cargo_registry` volume, so overlapping
crate sources are downloaded once rather than four times.

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

That loads `scripts/dev/seed.sql.gz`, a committed snapshot of the ten content
tables (trades, games, standings, teams, markets, rss items and the tracked_*
config). It makes **no upstream API requests**, and it is idempotent — re-run
it whenever you want a clean dataset back.

**Do not paste production API keys into `channels/*/.env`.** `make setup`
leaves them blank on purpose, and the ingesters handle that correctly: they
stay up, skip polling, and serve what is in Postgres. The keys that would
work there are the production ones, and the quota they draw on belongs to
real users — api-sports bills a shared 7,500 requests/day per sport host
across every league. Seeding gives you the same app without spending any of it.

Loading also rebases timestamps, because several read paths are
time-relative: RSS articles older than 7 days are deleted by the ingester,
prediction markets only show while `close_time` is in the future, and the RSS
janitor disables curated feeds that look stale. A snapshot restored months
later would be present in the database and invisible in the app. `seed.sh`
documents which shift belongs to which query.

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
`host.docker.internal` as the host. Only the ten content tables are read;
nothing containing user data (`yahoo_*`, `user_*`, `stripe_*`, `support_*`)
is touched, which is what makes the snapshot safe to commit. Commit the
regenerated `scripts/dev/seed.sql.gz`.

## Predictions (Kalshi) — optional

Off unless you have a key, and you probably do not need one: `make seed`
populates the predictions widget along with everything else.

The credential in the cluster is the **live, real-money** Kalshi key, so
`make kalshi-key` refuses to copy it unless you ask by name:

```bash
make kalshi-key prod=1
```

Prefer your own Kalshi **demo** credentials — put the key id and
`KALSHI_ENV=demo` in `secrets/predictions.docker.env` and the PEM at
`secrets/kalshi-private-key.pem`. Everything else runs fine without any of it.

Its private key is a multiline PEM, which Docker's `env_file` cannot parse —
hence the separate file mounted at `/run/secrets/kalshi.pem` and the
`KALSHI_PRIVATE_KEY_PATH` var.

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
