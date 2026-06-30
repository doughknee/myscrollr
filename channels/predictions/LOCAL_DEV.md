# Predictions channel — local dev & live demo

Run the **premier Predictions channel with live Kalshi data inside the real
desktop app** — no Postgres, Redis, Sequin, or Logto required. Two terminals.

> ⚠️ **Rotate the Kalshi key before shipping.** The key used below is a
> **production (real-money) credential** that has been shared in plaintext
> (chat transcript + `~/Downloads`). It's fine for local dev, but **regenerate
> the Kalshi API key pair before any production deploy**, and never commit the
> PEM. Everything here reads it from `~/Downloads`, outside the repo; `.env` is
> gitignored.

---

## Where to run these
The `cd` paths below are **relative to the repository root**. This work currently
lives in a git worktree (branch `claude/dreamy-curran-8f2152`), so the root is:
```
C:\Users\Brandon Harris\Documents\.code\myscrollr\.claude\worktrees\dreamy-curran-8f2152
```
Either `cd` there first, or prepend that path to the `cd` commands below (e.g.
`cd "C:\...\dreamy-curran-8f2152\channels\predictions\service"`). After this branch
is merged to `main`, run from your normal repo checkout instead.

---

## Prerequisites
- **Rust** (`cargo` on PATH) — already present.
- **Node + npm** — already present. (Tauri also needs the platform webview, which Windows has built-in.)
- The Kalshi **API key id** and the **RSA private key** PEM file.
- **No database/infra needed** for the demo — the bridge holds live state in memory.

---

## 1. Terminal 1 — start the live Kalshi bridge

The bridge signs requests with your key, streams live Kalshi markets (REST sweep
+ WebSocket ticker), and serves them unauthenticated on port **3005** at
`/public/feed`, `/dashboard`, and `/events` (SSE).

**PowerShell:**
```powershell
cd channels/predictions/service
$env:KALSHI_API_KEY_ID = "<YOUR_KALSHI_KEY_ID>"
$env:KALSHI_PRIVATE_KEY_PATH = "C:\Users\Brandon Harris\Downloads\scrollr-api.txt"
cargo run --bin serve_bridge
```
**Git Bash:**
```bash
cd channels/predictions/service
KALSHI_API_KEY_ID="<YOUR_KALSHI_KEY_ID>" \
KALSHI_PRIVATE_KEY_PATH="C:/Users/Brandon Harris/Downloads/scrollr-api.txt" \
cargo run --bin serve_bridge
```

Wait for: `initial sweep complete: N live predictions loaded` and
`serve_bridge listening on 0.0.0.0:3005`. (First run compiles for ~30s.)

Sanity check (optional, new terminal): `curl http://localhost:3005/public/feed`
should print a JSON `predictions` array with real markets.

---

## 2. Terminal 2 — start the desktop app in demo mode

`VITE_DEMO=1` makes the app run **signed out** against the bridge (bypassing
Logto); `VITE_API_URL` points it at the bridge.

**PowerShell:**
```powershell
cd desktop
$env:VITE_API_URL = "http://localhost:3005"
$env:VITE_DEMO = "1"
npm install   # first time only
npm run tauri:dev
```
**Git Bash:**
```bash
cd desktop
VITE_API_URL="http://localhost:3005" VITE_DEMO="1" npm run tauri:dev
```

> If `VITE_DEMO` isn't picked up (blank/auth screen), create `desktop/.env.local`
> with the two lines below and re-run — Vite always loads `.env.local`, and it's
> gitignored by Vite convention (verify it's not tracked):
> ```
> VITE_API_URL=http://localhost:3005
> VITE_DEMO=1
> ```

### What you'll see
- The **always-on-top ticker** scrolls live prediction chips: the market
  question, the **implied probability** (e.g. `Marco Rubio  19%`), a **▲/▼
  delta** that flashes as the price moves, plus category / volume / close
  countdown in comfort mode. Prices update **live** via SSE (the bridge pushes
  every Kalshi ticker tick).
- The **main window** opens on the Predictions feed: the premier card grid with
  movers/volume/closing sorts, category filters, and the same live updates.

---

## 3. Test the account link ("Connect your Kalshi account" + My Positions)

This is the **on-device** account link — completely separate from the bridge.
Your Kalshi key never leaves your machine: the desktop's own Rust backend
(`src-tauri`) reads the file you drag in, signs requests locally, stores the
credential in the **OS keychain** (Windows Credential Manager, under service
`com.myscrollr.desktop.kalshi`), and talks to Kalshi directly — read-only. It is
**never** sent to Scrollr/the bridge/Postgres, never logged, never written to
disk in plaintext.

> Run the bridge (step 1) **and** the desktop app (step 2) first. The link works
> without the bridge, but the bridge supplies the live market prices that power
> the **live P&L** mark-to-market and the sparklines, so you want both.

**Steps (in the desktop app):**
1. Open the **Predictions** channel's full page (click the channel to open its
   Source page — the in-feed **“Markets / My Positions”** switcher only shows
   there, not in the small Home preview).
2. Click **My Positions** → the **“Connect your Kalshi account”** wizard appears.
3. Click **Open Kalshi** → your browser opens `kalshi.com/account/profile`.
   Choose **“Create New API Key”**; Kalshi downloads a small *connection file*
   (the RSA private key). You already have one at
   `C:\Users\Brandon Harris\Downloads\scrollr-api.txt`.
4. Paste your **Key ID** (`<YOUR_KALSHI_KEY_ID>`) into the field.
5. **Drag the connection file** from Explorer onto the drop zone (don't paste its
   contents — drag the file). It should show the filename with a ✓.
6. Click **Connect my account** → it calls `/portfolio/balance` to validate and
   shows **“Connected — $X.XX in your Kalshi account.”**
7. **My Positions** now shows your balance + account value, open positions with
   **live P&L** (updates as the bridge's market prices tick), recent fills, and
   resting orders. A **Live** pill confirms the authenticated WS stream
   (`market_positions` / `fill` / `user_orders`) is connected; account changes
   trigger a debounced refresh.
8. **Disconnect** (footer) wipes the credential from the keychain and stops the
   stream — you're back to the wizard.

**Verify the privacy invariants** (optional but reassuring):
- The credential lives only in the keychain. On Windows: *Credential Manager →
  Windows Credentials* → look for `com.myscrollr.desktop.kalshi`. There is no
  plaintext key on disk and nothing sent to the bridge.
- The bridge logs (terminal 1) never show your key or any `/portfolio/*` call —
  those requests go straight from the desktop app to Kalshi.

**Watchlist, alerts, market detail (no account needed):**
- Click any market card (comfort view) → a **detail modal** with a live
  price sparkline, bid/ask spread, volume/open-interest, a **★ watch** toggle,
  and **price alerts** ("alert me when this goes above/below N%").
- Star a few markets, then use the **★ Watchlist** lens to filter to them. Use
  the **category** pills as quick lenses. **Resolved today** shows a recap strip
  once markets settle.
- Alerts fire as a toast when a market *crosses* your threshold. Note: alerts
  currently evaluate **while the Predictions feed is open** (they're local, no
  background service) — keep that page up to see them fire.

---

## 4. Bonus — console proof (no UI)

Stream live Kalshi straight to the terminal (REST snapshot + live WS ticker):
```powershell
cd channels/predictions/service
$env:KALSHI_API_KEY_ID = "<YOUR_KALSHI_KEY_ID>"
$env:KALSHI_PRIVATE_KEY_PATH = "C:\Users\Brandon Harris\Downloads\scrollr-api.txt"
cargo run --bin kalshi_probe
```

---

## Notes & scope
- **The bridge + `VITE_DEMO` path are dev-only.** They are never enabled in
  release builds (the flag is unset) and never touch production. The bridge
  ignores auth entirely and exists solely to demo the channel without infra.
- **Tauri HTTP scope.** The desktop fetches via `@tauri-apps/plugin-http`, whose
  capability scope (`src-tauri/capabilities/{default,ticker}.json`) was
  `https://*/*` only. A `http://localhost:*/*` allowance was added so the
  webview can reach the local bridge — review/keep this before a prod build (it
  only permits localhost HTTP, which the app never uses in production).
- **The production data path is different** and not run here: the real service
  (`cargo run`, not `serve_bridge`) writes to Postgres → Sequin CDC → core API
  SSE → desktop. That requires Postgres + Redis + Sequin + Logto (see
  `AGENTS.md`), so it can't run on a box without them — which is exactly why the
  bridge exists for local testing.
- **`KALSHI_ENV=demo`** switches both binaries to Kalshi's demo environment (you
  need demo-specific keys for that).
- Tests (no infra): `cargo test` (service), `go test ./...` (api), `npx vitest
  run` + `npx tsc --noEmit` (desktop).
