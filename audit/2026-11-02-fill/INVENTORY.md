# Fill this display audit inventory

Scope: PR #529 at 75a74c4b versus origin/main, limited to Fill and shared ticker behavior it changes. User requested continued auditing and improvements, preserving original slide/wipe animation. No merge/release authorization. P0 blocks this feature review; P1 fix before release; P2 backlog. Existing audit/2026-10-26-security is unrelated and must be preserved.

## Stack and surfaces
- Tauri 2, Windows WebView2 / macOS WebKit / Linux WebKitGTK; Rust native adapter in desktop/src-tauri/src/commands/window.rs, appbar_win.rs, lib.rs and tray.rs.
- React 19, Vite, Motion, TypeScript shared ticker. desktop/src/App.tsx owns each window. TickerSurface.tsx owns Fill scaling, controls and Escape.
- Page grid and Pages/Continuous strip; reading sizes 100/125/150; compact header, utility slots, optional pins footer; shared sport/quote/news/other cells under components/pages.
- Settings TickerPage.tsx and MonitorMap.tsx: monitor selection, per-monitor display modes, identify, reading size. Main window constrained-screen sizing.
- Preferences.ts and lib/tickerDisplay.ts: device-local display storage, sanitation, geometry. useTickerDisplay.ts coordinates native placement; __root.tsx synchronizes windows.

## Data and boundaries
- Existing core API dashboard, widget queries and Rust-owned SSE. App.tsx, hooks/useSharedSSE.ts and datawidgets provide data to shared Pages and Continuous. No new network sources introduced by Fill. Audit interactions with existing ownership and stale/loading/errors; unrelated backend/auth/billing internals outside scope.
- Native Fill commands: sync_ticker_windows, ticker_display, position_ticker, list_monitors, identify_monitors, pin_window, set_ticker_visible, show_app_window. Tauri capabilities ticker.json/default.json; no new filesystem/network authority intended.
- Windows rendering workaround: process-local WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS appends --disable-direct-composition before runtime init. All Scrollr webviews share it. User confirmed keys/wheel responsive with original slides. Runtime flag review and mini-PC performance remain release gates.

## Long-running behavior
- Per-display page dwell/active hover; wheel coalescing; timers/animations/edge rotations in PagedBar/EdgeZone; 5s Fill control idle; window resize listeners.
- Rust 5s monitor polling plus WM_DISPLAYCHANGE; main window re-sync; queued native placement in useTickerDisplay. Process SSE ownership must remain one-per-app; docked elected leader vs independent filled pages.

## Verification and resources
- Native dev app already running at localhost:5174, user's real account/preferences. Do not restart, modify preferences, or manipulate native UI during audit without coordinating with root. Read-only devctl is available at scripts/dev/devctl.mjs.
- Isolated browser fixture host desktop/ticker-shim.html via Vite; use dedicated ports per agent, not 5174. Playwright/Edge installed under desktop. Queries fixture=pages|busy|longnames|quiet|googl, pages=1, fill=grid|strip, reading=150, weather=1, zones=...; inspect shim for exact fixtures.
- npm run build; npx vitest run; npx playwright test e2e/ticker/fill.spec.ts; cargo test --lib in desktop/src-tauri. Do not run cargo concurrently with native source mutations. No dependency installation required.
- Existing evidence: 1027 Vitest, 32 native tests, Fill 15 cases (one idle timeout passed retry); user confirmed workaround. Physical hotplug, sleep/wake, mixed DPI, customer mini PC, macOS/Linux runtime still unverified.
- Reports and screenshots ONLY under audit/2026-11-02-fill; temporary scripts under results. Read docs/CHIP_SPEC.md for shared render contract. Read-only audits; root handles authorized fixes after triage.

## Existing uncommitted work to preserve
- desktop/src-tauri/Cargo.toml and desktop/src/routeTree.gen.ts predate this audit.
- audit/2026-10-26-security/ belongs to other work.
