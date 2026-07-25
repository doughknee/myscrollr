# Local development

Two commands from a fresh clone:

```bash
make setup   # generate every .env file (once)
make up      # start the whole backend
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
migration on boot, so a fresh volume becomes a working schema by itself.

- `make down` stops everything and **keeps** your data.
- `make reset` wipes the database, Redis and the build caches.

## Predictions (Kalshi) — optional

Off unless you have a key. `make kalshi-key` pulls one from the cluster
(needs `kubectl`), then regenerates its env file. Everything else runs fine
without it.

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
4. `make reset && make up` — start from a clean database.

Ports already held by something else are the most common failure; `doctor`
reports those specifically, and ignores ports held by our own containers.
