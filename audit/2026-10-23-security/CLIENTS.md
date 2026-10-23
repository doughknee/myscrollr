# Client security review — 23 October 2026

Scope: desktop React/Tauri and marketing/admin website client code. Source review and isolated fixtures only; no customer content, production writes, token reads, browser attacks or application changes. Findings are incremental. API/webhook and dependency reviews are owned by the other reviewers.

## C1 — P1: Development command bus accepts unauthenticated code from foreign origins

Evidence: `desktop/scripts/dev-bus.ts:45` parses every body as JSON without checking its media type; `:62-69` accepts POST `/__dev/cmd` without Origin, Host, authentication or socket validation; `:91-104` exposes polling and result completion without authentication. `desktop/src/dev/bus.ts:35-39` supplies persistent store and native `invoke`, and `:50-54` executes the submitted JavaScript. `desktop/vite.config.ts:100` normally binds loopback, but permits `TAURI_DEV_HOST` to expose the same endpoint elsewhere.

Verification: executed the actual middleware, transpiled in memory using the installed TypeScript compiler, with disposable EventEmitter request/response doubles. A POST with `Origin: https://attacker.invalid`, `Content-Type: text/plain` and body `{"window":"audit-fixture","code":"1+1"}` was accepted and retrieved through `/__dev/poll`; a second unauthenticated result POST completed it. Assertions passed. No dev app or network was contacted. A text/plain body is a browser simple-request shape, so lack of CORS permission to read the response is not a server-side execution defense. Browser local/private-network permission behavior can prevent the cross-origin delivery in some configurations; that end-to-end browser path is UNCERTAIN and was not tested. Direct HTTP reachability when bound to a LAN interface is independently sufficient. A running development app is required; this is not a released-app endpoint.

Impact: a caller that can deliver a request to the dev server can execute code in an attached dev renderer, read auth state and invoke native commands. The bus is correctly gated out of production, but development machines are still a security boundary.

Suggested fix: require an unpredictable per-session secret on all bus endpoints, reject foreign origins and unexpected body types before enqueueing, and retain loopback-only binding unless explicitly authorized.

## C2 — P2: Desktop refresh tokens are stored as ordinary JSON

Evidence: `desktop/src/auth.ts:44-47` includes access and refresh tokens in AuthState, and `:97-98` saves the complete state with `setStorePersisted`; `desktop/src/lib/store.ts:24` uses `LazyStore("scrollr.json")`, and `:107-110` persists the value unchanged. `desktop/src-tauri/src/presence.rs:284-297` confirms the native side reads the access token directly from that JSON store. The OS keyring dependency exists but `desktop/src-tauri/src/lib.rs:52-65` uses it only to remove a legacy integration credential.

Verification: source trace above, without opening any real user's store. No encryption or secure-store transformation exists in this path.

Impact: someone who obtains the app-data file or an unencrypted backup obtains a refresh credential. Requires local file/back-up access; this is hardening, not demonstrated remote account takeover. OS access permissions and actual backup policies were not measured.

Suggested fix: store refresh credentials in the platform secure credential store, leave ordinary preferences in JSON, and migrate/delete the legacy plaintext value without breaking refresh rotation.

## C3 — P2: Native egress has a broader trust boundary than the app needs

Evidence: `desktop/src-tauri/capabilities/default.json:45-46` and `ticker.json:29-30` permit native HTTP to every HTTPS host and HTTP localhost port. `desktop/src-tauri/src/commands/sse.rs:9-20` accepts arbitrary `api_base` and `:67-70` sends the provided token there. `desktop/src-tauri/src/presence.rs:188-191` stores arbitrary `api_base`, and `:396-398` sends the current user's stored bearer token to that host. These custom Rust calls do not pass through plugin HTTP capabilities. `desktop/src-tauri/tauri.conf.json:76` also permits browser connections to all HTTPS hosts.

Verification: source trace; normal callers use the build-time configured API origin, and no external-content-to-api_base path was found. No actual credential or internal endpoint was contacted. A compromised renderer can choose `http://127.0.0.1:<port>` for SSE/presence or an attacker HTTPS origin for egress; it can already read auth state through the shared store. This is defense in depth and client-side request capability, not production server SSRF.

Suggested fix: enforce trusted production API origins inside native SSE/presence commands and narrow HTTP permissions to the fixed API/GitHub origins, with separately gated development loopback allowances.

## C4 — P2: Native external opener accepts arbitrary paths and URI schemes

Evidence: `desktop/src-tauri/src/commands/open_external.rs:47-58` passes arbitrary strings to xdg-open/BROWSER/gio on Linux; `:64-74` exposes this through `open_external` and invokes the Rust shell opener on other platforms without URL validation. The legitimate caller at `desktop/src/auth.ts:466` supplies the fixed configured OAuth URL.

Verification: source inspection only; no path or protocol handler was opened. No shell interpolation exists (`Command` uses argument arrays), but opening local files and registered handlers is broader than opening an HTTPS login page. Requires control of IPC input; no untrusted RSS-to-this-command path was identified.

Suggested fix: parse the URL in the native command and permit HTTPS browser URLs only, with explicit development exceptions if needed.

## C5 — P2: Website CSP allows all inline JavaScript

Evidence: `myscrollr.com/Dockerfile:278` and `:284` set `script-src 'self' 'unsafe-inline'` for the website and embed; `myscrollr.com/src/routes/__root.tsx:134` emits a constant inline theme script.

Verification: source configuration; the main reviewer owns current production header verification. Actual external HTML sinks use DOMPurify (release notes), so no separate exploitable injection path is asserted here. Inline allowance weakens the fallback defense if an HTML injection bypass occurs.

Suggested fix: replace inline script allowance with build-generated hashes/nonces for the known scripts and keep styles governed separately.

## C6 — P1: Sentry callback credentials survive in navigation breadcrumbs

Evidence: `myscrollr.com/src/sentry.ts:47-64` strips the query from `event.request.url` but never sanitizes `event.breadcrumbs`; `myscrollr.com/src/routes/callback.tsx:23-26` navigates from the OAuth callback URL after sign-in. Sentry starts before Logto in `myscrollr.com/src/client.tsx:16`. The installed SDK enables `breadcrumbsIntegration()` by default (`myscrollr.com/node_modules/@sentry/browser/build/npm/esm/prod/sdk.js:28`), and its history handler records the relative `from`/`to` URLs with query strings (`.../integrations/breadcrumbs.js:297-320`). `desktop/src/sentry.tsx:59-91` likewise strips only top-level request fields; its fetch/navigation/console breadcrumbs are not comprehensively scrubbed.

Verification: transpiled the actual website `sentry.ts` in memory, mocked `Sentry.init`, and passed its captured `beforeSend` a synthetic callback URL and navigation breadcrumb. Assertions confirmed the top-level URL was scrubbed while the synthetic `code` and `state` remained in `breadcrumbs[0].data.from`. No network or telemetry was sent. A later captured error within the breadcrumb window can carry these values; no historical telemetry was inspected, so past exposure is not asserted. OAuth codes are short-lived and ordinarily already redeemed, so this is a confirmed violation of the repository's no-token/query-data telemetry contract, not proven reusable account access.

Suggested fix: sanitize or drop sensitive navigation/fetch/console breadcrumbs at collection and serialization boundaries, and add a worst-case callback URL breadcrumb regression test for both clients.

## Native/IPC inventory and verdicts

The full custom command registration is `desktop/src-tauri/src/lib.rs:220-241`. No per-command application permission manifest narrows these custom commands; the main/ticker renderer must be treated as privileged. No unrestricted shell spawn/execute plugin permission is granted. Remote URL capabilities are not configured. The table includes every registered application command (20).

| Entry point | Source | Verdict / compromised renderer capability |
|---|---|---|
| position_ticker | commands/window.rs:216 | Validates top/bottom and finite height 1–10000; monitor resolves from real enumeration. Can move/resize its window; no arbitrary process/path input. |
| list_monitors | commands/window.rs:9 | Read-only native monitor metadata; expected feature surface. |
| sync_ticker_windows | commands/window.rs:147 | Filters requested monitors against actual enumeration and uses built-in window config; can create/destroy ticker windows, not arbitrary content windows. |
| identify_monitors | commands/window.rs:359 | Fixed identify.html and numeric generated script input; no external script interpolation. |
| pin_window | commands/window.rs:416 | Boolean and actual calling window; compositor inputs numeric/escaped; can pin its window. |
| set_hide_on_fullscreen | commands/window.rs:444 | Boolean Windows feature flag; no external I/O. |
| set_ticker_visible | commands/window.rs:461 | Boolean and calling window; AppBar registration change only. |
| start_auth_server | commands/auth.rs:168 | Fixed 127.0.0.1:19284, timeout and bounded reader; see callback observations below. |
| stop_auth_server | commands/auth.rs:222 | Stops fixed internal listener, no arbitrary service/process target. |
| open_external | commands/open_external.rs:64,70 | C4: arbitrary local path or URI handler input; no shell-string interpolation. |
| start_sse | commands/sse.rs:9 | C3: arbitrary destination with caller bearer token; no native origin guard. |
| stop_sse | commands/sse.rs:26 | Can disrupt the single shared connection; expected privileged renderer ability. |
| show_app_window | commands/window.rs:428 | Fixed main window show/focus. |
| quit_app | commands/window.rs:437 | Terminates own process; expected tray/application capability. |
| get_system_info | commands/system_info.rs:246 | Read-only device/hostname/hardware stats; fixed sysfs/WMI/nvidia-smi probes; no renderer supplied path/process. |
| collect_diagnostics | commands/diagnostics.rs:328 | Read-only hardware and application log tail from fixed app directory; sensitive local information, no arbitrary path. |
| sync_tray_ticker | tray.rs:102 | Changes existing tray checkmark with boolean. |
| set_crash_reports | lib.rs:38 | Boolean telemetry switch, no external input. |
| configure_presence | presence.rs:188 | C3: accepts arbitrary destination and subsequently uses stored bearer token; consent still read per tick. |
| report_screen_state | presence.rs:199 | Restricts caller to ticker label, 64 items, each <=64 bytes, deduplicates; backend must validate catalog names. |

Paths in the table are relative to `desktop/src-tauri/src/`.

Plugin capabilities reviewed: window/event/menu primitives, shell open, store/log and HTTP in both windows; updater/restart/autostart in main only (`capabilities/default.json`, `ticker.json`). No shell execute/spawn permissions. The store default grants broad plugin-store manipulation in an already privileged renderer, rather than isolating auth from preferences. Updater endpoint is fixed HTTPS with a configured public verification key (`tauri.conf.json:36-41`); no private signing key was found in client configuration.

## Injection, callbacks, endpoint and secret review

- Production HTML sinks: desktop `lib/releases.ts:190-198` and website `routes/releases.tsx:60-74` sanitize GitHub-authored release Markdown with `DOMPurify.sanitize(..., { USE_PROFILES: { html: true } })`, then only add constant table wrappers. Release-note HTML is not user RSS HTML. Website has a regex-only SSR fallback, but release fetching occurs client-side and the notes are lazily rendered on expansion; no current untrusted SSR caller was found. Dependency advisory reachability is reported separately by the main reviewer.
- Website `routes/__root.tsx:134` injects the constant theme script. Test-only innerHTML uses were excluded. The only `new Function` sink in application source is the dev bus (C1). Identifying monitor scripts interpolate only a generated integer. KWin title strings escape JS terminators; Sway escapes criteria syntax; Hyprland addresses come from native compositor output. No shell command-string interpolation from API/feed data found.
- Desktop OAuth uses cryptographic random state, S256 PKCE, equality check before exchange (`auth.ts:371-373`, `:477-482`), a fixed loopback listener and static callback HTML. No callback input is injected into response HTML. Listener path matching is substring-based and terminates on the first callback-shaped request before JS validates state; an unsolicited local callback can cancel a pending login, but it cannot bypass PKCE/state to authenticate an attacker. The fixed-port callback is intentionally plain HTTP loopback. Website auth callback delegates protocol validation to Logto SDK.
- Client endpoints: normal product data via build-time core API; desktop native SSE and presence to API; desktop token exchange/refresh through API, authorization through configured Logto; GitHub release list at fixed `api.github.com/repos/brandon-relentnet/myscrollr/releases`; fixed signed-updater GitHub release endpoint; website Stripe JS/API, Logto, same-origin Sentry tunnel and PostHog ingestion. RSS URLs are registered through core, rather than fetched directly by client code. Client-side image HTTPS allowance is broad for content icons. Native reqwest defaults retain TLS certificate validation; no `danger_accept_invalid_certs` override found in reviewed client paths.
- VITE values read by these clients are public API/auth/resource origins, public Logto app IDs, Stripe price/publishable keys, Sentry DSNs and PostHog ingestion keys. No private API credential value was read or printed. The Sentry upload auth token is used only by the build plugin, not exposed as a VITE definition. Secret persistence finding is C2. A full git-history secret scan and actual signed release-binary inspection were not performed by this subtask.
- Dev-only boundaries: dev bus middleware is `apply: "serve"`; its executing function immediately returns outside `import.meta.env.DEV`; web adapter refuses non-dev execution. MCP bridge registration is gated by feature + debug_assertions + non-Windows (`lib.rs:204-208`). No production dev-bus execution path found. This source review does not certify every historical binary.
- Server webhooks, server-side SQL, infrastructure egress and API authorization are outside this delegated client scope and covered by other reviewers. Dependency audit execution belongs to main; no application-authored seroval/fromJSON/createServerFn calls were found in desktop/src or myscrollr.com/src. Website Dockerfile deploys static client assets rather than a TanStack server runtime, so server-only advisories must not be equated with reachable production exploits.

## Summary

| Severity | Count | Findings |
|---|---:|---|
| P0 | 0 | No demonstrated client ship blocker |
| P1 | 2 | C1 unauthenticated development command execution; C6 telemetry breadcrumb privacy leak |
| P2 | 4 | C2 plaintext credential storage; C3 broad native egress; C4 unchecked native opener; C5 inline-script CSP |

Limits: source and disposable middleware/telemetry fixtures only. No live browser-to-loopback exploit, native protocol launch, customer credential read, production telemetry access, physical OS test or released binary inspection. C2–C5 are explicitly defense in depth, not independently demonstrated remote compromises.
