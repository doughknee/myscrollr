# Fill security audit

Reviewed PR #529 at `75a74c4bafd7584d54629ca7b7040ec8c68fa9f1` against origin/main, plus the affected command implementations and rendering workaround. Read-only review; no native app interaction, preferences changes, dependency installs, production actions, or source edits. No confirmed new P0/P1/P2 security finding in this scope. This is not a whole-app security clearance.

## Native / IPC boundary

Every Fill-related custom command is listed below; unrelated authentication, billing, diagnostics and connection commands are excluded. Commands are registered in `desktop/src-tauri/src/lib.rs:242`. A compromised local webview already has significant application authority; this review checks whether Fill adds a path to arbitrary files, processes, or external content.

| Entry point | Input validation and authority | Verdict / evidence |
|---|---|---|
| `sync_ticker_windows` | `Vec<String>` and optional map; mode is a serde enum (`docked/grid/strip`), reading size `u16`; monitor names must match attached OS monitors and are deduplicated. Window labels/titles/config come from native constants, not supplied URLs. Can change all ticker windows. | No new arbitrary window URL/process/path. `commands/window.rs:250`, `:198`, `:295`. Existing global command has no caller-role check; main ownership is a frontend convention, not a security boundary. Map/string lengths are not capped, but no new external route to this IPC was found. |
| `ticker_display` | Uses Tauri-injected caller window; no caller-supplied label. Maps unsupported reading sizes to 100. Reads display/leader state only. | Validated, read-only. `commands/window.rs:74`, `:93`. |
| `position_ticker` | Only top/bottom; optional height must be finite and 1..10000. Monitor resolves through OS inventory. Fill sizes derive from monitor dimensions; moves/fullscreens the injected caller window. | No arbitrary geometry-to-shell text path introduced. `commands/window.rs:327`, `:334`, `:362`, `:375`. Existing Wayland adapters use fixed programs, escaped titles and integer geometry. |
| `list_monitors` | No inputs; returns OS monitor inventory. | Read-only local display metadata. `commands/window.rs:12`. |
| `identify_monitors` | No inputs; creates fixed local `identify.html` windows, one per OS monitor, with a native integer in the initialization script; destroys after 1.5 seconds. | No external script interpolation. `commands/window.rs:533`, `:544`, `:548`, `:568`. Unchanged implementation. |
| `pin_window` | Boolean; acts on injected caller window. Existing compositor dispatch uses a fixed executable and escaped/native target identity. | Bounded window authority. `commands/window.rs:590`. |
| `set_ticker_visible` | Boolean; unregisters injected caller window's Windows AppBar on hide. UI separately invokes Tauri window show/hide. | No new authority. `commands/window.rs:656`; `hooks/useTickerDisplay.ts:36`. |
| `set_hide_on_fullscreen` | Boolean; changes process-wide AppBar policy. | No new input path or authority. `commands/window.rs:639`; `hooks/useTickerDisplay.ts:72`. |
| `show_app_window` | No inputs; selects literal `main`, clamps sizing to OS screen bounds, shows/focuses it. | No caller-selected target or command execution. `commands/window.rs:602`. |

Paths in the table beginning `commands/` are relative to `desktop/src-tauri/src/`; `hooks/` is relative to `desktop/src/`.

Fill also uses existing Tauri window `hide/show`, event listen/emit, plugin-store, menu and shell-open bridges. It introduces no permission in `desktop/src-tauri/capabilities/{default,ticker}.json`. Those capabilities remain local-window scoped; `ticker-*` covers native-generated ticker labels. CSP remains unchanged (`tauri.conf.json:76`): production scripts self-only, inline styles permitted, HTTPS connect/image wildcards. HTTP plugin permissions retain broad HTTPS plus localhost (`capabilities/ticker.json:27`). These are inherited constraints, not new Fill findings; narrowing unrelated networking authority belongs in the existing security audit.

## Windows rendering workaround

`desktop/src-tauri/src/lib.rs:45` reads the existing `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` as an `OsString`, checks for the exact whitespace-delimited switch, appends a space and `--disable-direct-composition` when absent, and writes only the current process environment. Existing flag bytes are preserved, including quoted argument values; it does not reconstruct them from split tokens. An already-present unquoted exact switch is not duplicated. A quoted spelling may produce a duplicate switch, but no destructive rewrite was found. It neither invokes a shell nor changes user/machine environment or registry values. It runs before Sentry/plugins/webviews at `lib.rs:153`; later child processes can inherit the process environment, as expected.

The app does not set Wry's `additional_browser_args` override. Installed Wry 0.54.2 `src/webview2/mod.rs:294` constructs its defaults and passes them to WebView2 at `:328`. Microsoft's [environment creation reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?preserve-view=true&view=webview2-1.0.2420.47) specifies that environment additional arguments append to API arguments. Thus preserving Wry defaults is supported by both the local dependency source and upstream API semantics. No added sandbox, TLS, origin-security or remote-debugging disabling switch was found.

**Uncertain / release validation, not a demonstrated security vulnerability:** effective flag behavior on every supported WebView2 runtime and device was not exercised in this audit. Microsoft [warns against depending on browser flags in production](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags), because flags can change or disappear. The relevant source is `lib.rs:45`; reproduce on a disposable Windows launch with an unrelated preexisting browser argument and inspect the WebView2 command line, then test Fill and normal main/ticker rendering on the target mini PC. Keep the existing runtime revalidation/release gate; retain a documented removal/fallback path. This audit does not establish a new security effect from disabling DirectComposition.

## Injection, credentials, callbacks and networking

- Searched changed desktop files for HTML/eval/script sinks, URL use, process calls and credential markers, and inspected changed cell rendering plus the compositor paths reached by Fill. Feed titles/summaries remain React text (`components/pages/cells/NewsCell.tsx:69`); the new style element in `TickerSurface.tsx:110` contains constant CSS. `web.html:41` and `:47` use constant HTML, not feed data. Its same-origin message check remains at `web.html:63`. The identify initialization script interpolates an integer only. No new injectable sink found.
- Fill adds only monitor names, modes and reading sizes to disk preferences (`preferences.ts:215`, `:939`), sanitized by `lib/tickerDisplay.ts:17`. It adds no credential, token storage or authentication callback. Existing credential-at-rest design was deliberately not re-audited. The fixture token is a literal fake (`ticker-shim.html:218`); web mode/fixture HTML are absent from release build inputs (`vite.config.ts:113`).
- No webhook, server-side fetch or new external endpoint exists in Fill. Existing data/SSE and clicked external links are reused. `App.tsx:379` still delegates external links to the shell plugin and catches rejection. New Settings/Exit controls use local routes/preferences. Existing backend webhook signatures/idempotency and external endpoint TLS handling are out of scope.
- AppBar's changed foreground process check (`commands/appbar_win.rs:684`) compares an OS-reported PID to the current process. No user-controlled pointer, buffer, or process identifier is introduced.

## Dependency and secret checks

Reused the completed [security workflow](https://github.com/doughknee/myscrollr/actions/runs/41583098173), verified its head SHA matches `75a74c4b...`. [Desktop npm audit](https://github.com/doughknee/myscrollr/actions/runs/41583098173/job/125742205303) executed `npm audit --omit=dev --audit-level=moderate` and reported zero vulnerabilities. [Desktop Rust audit](https://github.com/doughknee/myscrollr/actions/runs/41583098173/job/125742205230) passed under the existing workflow exception policy and reported **19 allowed warnings**. It is not a warning-free dependency result; `.github/workflows/security-checks.yml:77` lists desktop advisory exceptions. No dependency/lockfile change is part of this Fill diff, and no new vulnerable dependency path was demonstrated. Full reachability analysis of inherited exceptions remains with the prior security work. [Committed-secret scanning](https://github.com/doughknee/myscrollr/actions/runs/41583098173/job/125742205166) also passed. No expensive duplicate dependency scan was run.

## Findings summary

| Severity | Confirmed new findings | Disposition |
|---|---:|---|
| P0 blocker | 0 | No demonstrated security blocker from Fill. |
| P1 prerelease | 0 | Runtime flag validation remains an existing release gate, not a newly proven security flaw. |
| P2 backlog | 0 | Existing broad capabilities/advisory exceptions are outside this change's scope. |

Unverified boundaries: hostile IPC runtime probes, macOS/Linux compositor execution, effective WebView2 arguments across runtimes, and physical-device behavior. Native app remained untouched.
