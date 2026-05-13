# Sentry Rollout Across the Scrollr Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add error monitoring (Sentry) to every Scrollr component — marketing site, desktop app (JS + Rust), core API, 4 channel APIs, 3 Rust ingestion services — with strict privacy defaults aligned with the Scrollr brand promise of zero personal data collection.

**Architecture:** Each component initializes the appropriate Sentry SDK at startup. All sensitive data (IPs, request bodies, cookies, query strings, user identifiers) is scrubbed via `BeforeSend` hooks before transmission. User identity, when set, is a salted SHA-256 hash of the Logto subject — irreversibly anonymous. Tauri uses two SDKs (one per process) sharing a single DSN, distinguished by `runtime` tags.

**Tech Stack:**
- `@sentry/react@^10.53` + `@sentry/vite-plugin@^5.3` for both frontends
- `sentry-go@v0.46` + `sentry-go/fiber` for all 5 Go services
- `sentry@0.48` Rust crate for the desktop Rust core + 3 ingestion services

**Privacy constraints (hard requirements):**
1. No IP addresses captured.
2. No request/response bodies captured.
3. No cookies, no query strings (Logto auth flow includes `code=`/`state=`).
4. No user emails, usernames, or other PII.
5. User ID, if attached, is `sha256(logto_sub + SENTRY_USER_SALT)[:8]`.
6. No session replay, no user feedback widget.
7. Trace propagation locked to `api.myscrollr.relentnet.dev` only — never to Stripe, Logto, Yahoo, TwelveData, ESPN, RSS sources.

**Project structure in Sentry:** One project per major component (recommended). Names:
- `scrollr-web` — marketing site
- `scrollr-desktop` — Tauri app (both JS windows + Rust core, distinguished by tags)
- `scrollr-core-api` — Go gateway
- `scrollr-finance-api`, `scrollr-sports-api`, `scrollr-rss-api`, `scrollr-fantasy-api` — channel Go APIs
- `scrollr-finance-svc`, `scrollr-sports-svc`, `scrollr-rss-svc` — Rust ingestion services

That's **10 Sentry projects**. The user creates them in the Sentry UI before this plan executes; each task assumes the DSN is already provisioned in the relevant env file.

**Sequencing:**
- Task 1 — Provision Sentry org + 10 projects (manual user task with checklist)
- Tasks 2-3 — Marketing site (lowest risk, easiest verification)
- Tasks 4-6 — Desktop app (most complex — two SDKs, source maps, releases)
- Tasks 7-9 — Go services (parallelizable across the 5 services after the core is done)
- Tasks 10-12 — Rust services (`#[tokio::main]` refactor is the gotcha)
- Task 13 — Release/version coordination
- Task 14 — Privacy audit (manual deploy + verify-scrubbing test)
- Task 15 — Documentation updates

---

## Task 1: Provision Sentry projects and shared secrets

**Files:**
- Modify: `api/.env.example`
- Modify: `desktop/.env.example`
- Modify: `myscrollr.com/.env.example`
- Modify: `channels/finance/api/.env.example`
- Modify: `channels/sports/api/.env.example`
- Modify: `channels/rss/api/.env.example`
- Modify: `channels/fantasy/api/.env.example`
- Modify: `channels/finance/service/.env.example`
- Modify: `channels/sports/service/.env.example`
- Modify: `channels/rss/service/.env.example`

**Rationale:** Every component needs its own DSN. Get them all provisioned upfront so the rest of the plan is purely code.

- [ ] **Step 1: Create Sentry projects (manual — user does this once)**

In the Sentry web UI:
1. Confirm the org slug — used as `SENTRY_ORG` later. Likely `scrollr` or `brandon-relentnet`.
2. Create these 10 projects (Settings → Projects → Create Project):
   - `scrollr-web` (platform: React)
   - `scrollr-desktop` (platform: React — frontend wins for source maps; Rust events go to the same project)
   - `scrollr-core-api` (platform: Go)
   - `scrollr-finance-api` (platform: Go)
   - `scrollr-sports-api` (platform: Go)
   - `scrollr-rss-api` (platform: Go)
   - `scrollr-fantasy-api` (platform: Go)
   - `scrollr-finance-svc` (platform: Rust)
   - `scrollr-sports-svc` (platform: Rust)
   - `scrollr-rss-svc` (platform: Rust)
3. For each project, copy the DSN (Settings → Client Keys (DSN)).
4. In Settings → Auth Tokens, create a token named `scrollr-source-maps` with `project:releases` + `project:read` scopes. This is the `SENTRY_AUTH_TOKEN` used by the Vite plugins.
5. In each project's Security & Privacy settings: enable "Data Scrubbing" and add custom rules for: `*authorization*`, `*cookie*`, `*token*`, `*secret*`, `*api[_-]?key*`. Belt-and-suspenders alongside our BeforeSend hooks.
6. Generate a random salt for hashing user IDs:
   ```bash
   openssl rand -hex 32
   ```
   This is `SENTRY_USER_SALT`. Once chosen, it must never rotate — all historical events would un-cluster.

- [ ] **Step 2: Update each `.env.example` with Sentry variables**

For `myscrollr.com/.env.example` and `desktop/.env.example`, append:
```sh
# Sentry — error monitoring
VITE_SENTRY_DSN=
SENTRY_ORG=
SENTRY_AUTH_TOKEN=   # CI only — used by @sentry/vite-plugin for source map upload
```

For `api/.env.example` and each `channels/*/api/.env.example`, append:
```sh
# Sentry — error monitoring
SENTRY_DSN=
SENTRY_USER_SALT=    # constant random hex string; do not rotate
ENVIRONMENT=development   # set to "production" on Coolify
```

For each `channels/*/service/.env.example`, append:
```sh
# Sentry — error monitoring
SENTRY_DSN=
ENVIRONMENT=development
```

For `desktop/src-tauri/`, the Rust DSN is read from a compile-time env var. Add to `desktop/.env.example`:
```sh
# Compiled into the Rust binary at `cargo build` time
SENTRY_DSN_RUST=
```

(Note: the Rust crate uses `option_env!()` which reads at build time, not runtime. The Tauri build command must export `SENTRY_DSN_RUST=$SENTRY_DSN_RUST` before invoking `cargo build`. The Tauri release workflow needs this wired up — see Task 13.)

- [ ] **Step 3: Coolify env config (manual — user adds these to each Coolify service)**

For each deployed service, set in Coolify:
- `SENTRY_DSN` = the matching project DSN
- `SENTRY_USER_SALT` = the salt from Step 1
- `ENVIRONMENT` = `production`
- `GIT_SHA` = `${COOLIFY_GIT_SHA}` or equivalent template variable (used for release tagging)

- [ ] **Step 4: Commit env example changes**

```bash
git add api/.env.example desktop/.env.example myscrollr.com/.env.example channels/*/.env.example channels/*/service/.env.example
git commit -m "chore: add Sentry env vars to all service .env.example files"
```

---

## Task 2: Sentry on the marketing site (`myscrollr.com`)

**Files:**
- Modify: `myscrollr.com/package.json`
- Create: `myscrollr.com/src/sentry.ts`
- Modify: `myscrollr.com/src/main.tsx`
- Modify: `myscrollr.com/vite.config.ts`

- [ ] **Step 1: Install Sentry**

```bash
cd myscrollr.com && npm install @sentry/react
cd myscrollr.com && npm install --save-dev @sentry/vite-plugin
```

- [ ] **Step 2: Create the init module**

Create `myscrollr.com/src/sentry.ts`:
```ts
import * as Sentry from '@sentry/react'

export function initSentry() {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  if (!import.meta.env.PROD) return // dev never reports

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: 'production',
    release: `myscrollr-web@${__APP_VERSION__}`,

    // Privacy
    sendDefaultPii: false,
    attachStacktrace: true,
    maxBreadcrumbs: 50,

    tracesSampleRate: 0.1,
    tracePropagationTargets: [/^https:\/\/api\.myscrollr\./],

    beforeSend(event) {
      // Strip query strings (may contain Logto code/state)
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url)
          u.search = ''
          event.request.url = u.toString()
        } catch {
          // malformed URL — leave it alone
        }
      }
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      if (event.user) {
        delete event.user.ip_address
        delete event.user.email
        delete event.user.username
      }
      // Strip user home from filenames
      if (event.exception?.values) {
        for (const v of event.exception.values) {
          for (const frame of v.stacktrace?.frames ?? []) {
            if (frame.filename) {
              frame.filename = frame.filename.replace(
                /\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+/g,
                '~',
              )
            }
          }
        }
      }
      return event
    },
  })
}
```

- [ ] **Step 3: Wire init into `main.tsx`**

Modify `myscrollr.com/src/main.tsx`. Add at the **very top** (before any other imports):
```ts
import { initSentry } from './sentry'
initSentry()
```

Wrap the app in Sentry's error boundary. Replace the `root.render(...)` call (or `hydrateRoot(...)` if Plan A is already applied):
```tsx
import * as Sentry from '@sentry/react'

const FallbackComponent = ({ error }: { error: unknown }) => {
  // Match the existing RootErrorComponent visual
  return (
    <div className="flex flex-col items-center justify-center px-6 py-32 text-center">
      <p className="text-sm font-semibold text-error">Error</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 text-base text-base-content/60 max-w-md">
        An unexpected error occurred. The team has been notified.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content shadow-sm hover:brightness-110 transition-[filter] cursor-pointer"
      >
        Refresh
      </button>
    </div>
  )
}

root.render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={FallbackComponent}>
      <LogtoProvider config={logtoConfig}>
        <ScrollrAuthProvider>
          <RouterProvider router={router} />
        </ScrollrAuthProvider>
      </LogtoProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
```

If Plan A's `hydrateRoot` is used instead of `createRoot`, wrap the `StartClient` children with `<Sentry.ErrorBoundary>` the same way.

- [ ] **Step 4: Wire the Vite source map plugin**

Modify `myscrollr.com/vite.config.ts`:
```ts
import { sentryVitePlugin } from '@sentry/vite-plugin'

// ... existing imports

export default defineConfig({
  build: {
    sourcemap: 'hidden', // generate but don't expose via comment
  },
  plugins: [
    // ... existing plugins (tanstackRouter or tanstackStart, viteReact, tailwindcss)
    // Sentry plugin MUST be last
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: 'scrollr-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: `myscrollr-web@${pkg.version}` },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN, // local builds skip upload
      telemetry: false,
    }),
  ],
  // ... rest unchanged
})
```

Add `.env.sentry-build-plugin` to `myscrollr.com/.gitignore` (the plugin writes a cache file here):
```bash
echo ".env.sentry-build-plugin" >> myscrollr.com/.gitignore
```

- [ ] **Step 5: Test locally**

```bash
cd myscrollr.com && VITE_SENTRY_DSN=https://test@test.ingest.sentry.io/0 npm run dev
```

Open `http://localhost:3000`, then in DevTools console:
```js
throw new Error('Sentry test from marketing site')
```

In `dev` mode `initSentry()` returns early (we gated it on `PROD`), so no event is sent. But the import itself shouldn't crash. Verify no console errors during normal navigation.

Now test the production path:
```bash
cd myscrollr.com && VITE_SENTRY_DSN=https://test@test.ingest.sentry.io/0 npm run build && npm run serve
```

The build should succeed. With a fake DSN, the runtime will attempt to upload but get an HTTP error in the browser console — that's fine for verification. The point is the build pipeline works.

- [ ] **Step 6: Verify source maps are generated and deleted**

```bash
cd myscrollr.com && ls dist/client/assets/*.map 2>/dev/null | wc -l
```

Expected with `SENTRY_AUTH_TOKEN` set: 0 (uploaded then deleted). Without the token: any number (build skipped Sentry plugin).

- [ ] **Step 7: Commit**

```bash
cd myscrollr.com && git add package.json package-lock.json src/sentry.ts src/main.tsx vite.config.ts .gitignore
git commit -m "feat(myscrollr.com): integrate Sentry with privacy-first config"
```

---

## Task 3: Deploy and verify marketing site Sentry

**Files:** None (verification only)

- [ ] **Step 1: Deploy to staging or preview environment**

(Manual: trigger Coolify deploy with `VITE_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_AUTH_TOKEN` set in the build env.)

- [ ] **Step 2: Trigger a test error**

After deploy, open the deployed URL in an incognito tab. In DevTools console:
```js
throw new Error('Sentry smoke test from staging')
```

- [ ] **Step 3: Verify in Sentry UI**

Within ~60 seconds, the error appears in the `scrollr-web` project Issues view. Verify:
- The release tag is `myscrollr-web@2.1.0` (or whatever version)
- The stack trace is symbolicated (filenames are `.tsx`, not `assets/index-xxxxx.js`)
- No `user.ip_address` is shown
- No `request.cookies` or `request.data` is shown
- The URL has no query string

If any of these fail, debug `beforeSend` or source map upload.

- [ ] **Step 4: Document the smoke test**

In `myscrollr.com/SENTRY.md` (new file):
```markdown
# Sentry verification

After every release, verify Sentry is working:

1. Open the production site in incognito.
2. DevTools console: `throw new Error('release smoke test')`.
3. Within 60s, the error should appear in https://sentry.io/organizations/<org>/issues/?project=<id>.
4. Stack trace must show `.tsx` filenames (source maps working).
5. Event details must show NO ip_address, cookies, query strings.

If smoke test fails: check Vite plugin source map upload logs in CI, and confirm `SENTRY_AUTH_TOKEN` is set in the build env.
```

- [ ] **Step 5: Commit doc**

```bash
git add myscrollr.com/SENTRY.md
git commit -m "docs(myscrollr.com): Sentry verification runbook"
```

---

## Task 4: Sentry on the Tauri frontend (`desktop/src/`)

**Files:**
- Modify: `desktop/package.json`
- Create: `desktop/src/sentry.ts`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/app-main.tsx`
- Modify: `desktop/vite.config.ts`

- [ ] **Step 1: Install Sentry**

```bash
cd desktop && npm install @sentry/react
cd desktop && npm install --save-dev @sentry/vite-plugin
```

- [ ] **Step 2: Create the init module**

Create `desktop/src/sentry.ts`:
```ts
import * as Sentry from "@sentry/react"

export function initSentry(window: "ticker" | "app") {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  if (!import.meta.env.PROD) return

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: "production",
    release: `scrollr-desktop@${__APP_VERSION__}`,

    sendDefaultPii: false,
    attachStacktrace: true,
    maxBreadcrumbs: 50,

    initialScope: {
      tags: { runtime: "webview", window },
    },

    tracesSampleRate: 0.1,
    tracePropagationTargets: [/^https:\/\/api\.myscrollr\./],

    beforeSend(event) {
      // Strip filesystem paths (Tauri webview can leak them in stack frames)
      if (event.exception?.values) {
        for (const v of event.exception.values) {
          for (const frame of v.stacktrace?.frames ?? []) {
            if (frame.filename) {
              frame.filename = frame.filename.replace(
                /\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+/g,
                "~",
              )
            }
          }
        }
      }
      delete event.user
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      return event
    },
  })
}
```

- [ ] **Step 3: Initialize in both entry points**

Edit `desktop/src/main.tsx`. Add at the top (before any other imports):
```ts
import { initSentry } from "./sentry"
initSentry("ticker")
```

Edit `desktop/src/app-main.tsx`. Add at the top:
```ts
import { initSentry } from "./sentry"
initSentry("app")
```

- [ ] **Step 4: Inject `__APP_VERSION__` in Vite config**

The marketing site already has `define: __APP_VERSION__`. The desktop config likely doesn't. Modify `desktop/vite.config.ts`:
```ts
import { readFileSync } from "node:fs"
import { URL, fileURLToPath } from "node:url"

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8",
  ),
)

export default defineConfig({
  // ... existing config
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: "hidden",
    // ... existing rollupOptions etc
  },
})
```

Also add the type declaration. Modify or create `desktop/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

declare const __APP_VERSION__: string
```

- [ ] **Step 5: Wire the source map plugin**

Modify `desktop/vite.config.ts` plugins:
```ts
import { sentryVitePlugin } from "@sentry/vite-plugin"

export default defineConfig({
  plugins: [
    // ... existing plugins
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: "scrollr-desktop",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: `scrollr-desktop@${pkg.version}` },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    }),
  ],
})
```

Add `.env.sentry-build-plugin` to `desktop/.gitignore`.

- [ ] **Step 6: Wrap each window's root with ErrorBoundary**

In both `desktop/src/main.tsx` and `desktop/src/app-main.tsx`, wrap the existing render tree with `<Sentry.ErrorBoundary>`. The fallback should be inline (avoid importing shared component to keep the bundles independent):
```tsx
import * as Sentry from "@sentry/react"

// inside render():
<Sentry.ErrorBoundary
  fallback={
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ marginTop: 8, opacity: 0.7 }}>
        Reload to recover. The team has been notified.
      </p>
    </div>
  }
>
  {/* existing app tree */}
</Sentry.ErrorBoundary>
```

- [ ] **Step 7: Build and verify**

```bash
cd desktop && npm run build
```

Expected: succeeds with warnings only. Check `dist/` for hidden source maps.

- [ ] **Step 8: Commit**

```bash
cd desktop && git add package.json package-lock.json src/sentry.ts src/main.tsx src/app-main.tsx src/vite-env.d.ts vite.config.ts .gitignore
git commit -m "feat(desktop): integrate Sentry on Tauri webview (both windows)"
```

---

## Task 5: Sentry on the Tauri Rust core (`desktop/src-tauri/`)

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/src/lib.rs`

**Rationale:** The Rust process owns native panics, OS API errors, and `tauri::command` failures. Init before any plugin builder runs.

- [ ] **Step 1: Add the dependency**

In `desktop/src-tauri/Cargo.toml` under `[dependencies]`:
```toml
sentry = { version = "0.48", default-features = false, features = [
  "backtrace",
  "contexts",
  "panic",
  "reqwest",
  "rustls",
  "release-health",
] }
dirs = "5"
```

(`dirs` is for resolving the home directory in path scrubbing — small, well-maintained.)

- [ ] **Step 2: Initialize Sentry in `run()`**

Modify `desktop/src-tauri/src/lib.rs`. Replace the top of `pub fn run()` (currently around line 9-21 which has the Windows COM init) with:
```rust
pub fn run() {
    // Sentry must initialize before any async runtime or plugin starts.
    // The DSN is baked in at compile time via SENTRY_DSN_RUST.
    let _sentry_guard = sentry::init(sentry::ClientOptions {
        dsn: option_env!("SENTRY_DSN_RUST").and_then(|s| s.parse().ok()),
        release: Some(format!("scrollr-desktop@{}", env!("CARGO_PKG_VERSION")).into()),
        environment: Some(
            if cfg!(debug_assertions) { "development" } else { "production" }.into()
        ),

        send_default_pii: false,
        attach_stacktrace: true,
        max_breadcrumbs: 50,

        traces_sample_rate: 0.1,

        before_send: Some(std::sync::Arc::new(|mut event| {
            // Strip user home from stack frame filenames
            let home = dirs::home_dir()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_default();
            for exc in event.exception.values.iter_mut() {
                if let Some(st) = exc.stacktrace.as_mut() {
                    for frame in st.frames.iter_mut() {
                        if let Some(filename) = frame.filename.as_mut() {
                            if !home.is_empty() {
                                let s: String = filename.to_string();
                                *filename = s.replace(&home, "~").into();
                            }
                        }
                    }
                }
            }
            event.user = None;
            Some(event)
        })),

        ..Default::default()
    });

    sentry::configure_scope(|scope| {
        scope.set_tag("runtime", "rust-core");
        scope.set_tag("platform", std::env::consts::OS);
    });

    // Windows: claim the main thread for STA before any plugin can initialize COM.
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        unsafe {
            CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        }
    }

    // ... rest of existing run() body (tauri::Builder::default() etc)
```

**Important:** the `_sentry_guard` binding's `Drop` flushes events on shutdown. It MUST live for the entire lifetime of the function. Since Tauri's `.run()` blocks until shutdown, binding it in `run()` is correct.

- [ ] **Step 3: Add an `option_env!` build-time DSN injection note**

Because `option_env!()` reads at compile time, the build command must export `SENTRY_DSN_RUST` before invoking `cargo build` / `tauri build`. We'll wire this into the GH Actions release workflow in Task 13.

For local dev (`npm run tauri:dev`), the DSN is empty and Sentry is disabled — which is what we want.

- [ ] **Step 4: Build and verify it compiles**

```bash
cd desktop/src-tauri && cargo check
```

Expected: clean compile. Any error here means a Cargo.toml feature mismatch — verify the `sentry` crate features above.

- [ ] **Step 5: Add a Sentry-aware command error helper**

The existing pattern for Tauri commands is `Result<(), String>` with `.map_err(|e| format!("context: {e}"))`. These swallow errors into JS strings — Sentry won't see them. Add a helper in `desktop/src-tauri/src/lib.rs` (or a new `errors.rs` if `lib.rs` is getting too large):
```rust
/// Wrap a command error to both report it to Sentry and return a string for the JS layer.
///
/// Usage:
/// ```
/// fn do_thing() -> Result<(), String> {
///     std::fs::read("foo").map_err(sentry_err("read foo"))?;
///     Ok(())
/// }
/// ```
pub fn sentry_err<E: std::fmt::Display>(context: &'static str) -> impl Fn(E) -> String {
    move |e: E| {
        let msg = format!("{context}: {e}");
        sentry::capture_message(&msg, sentry::Level::Error);
        msg
    }
}
```

**Do NOT mass-refactor existing commands** to use this helper in this task. Apply opportunistically as future work touches command code. Mass-refactor risks breaking command return signatures and is out of scope.

- [ ] **Step 6: Trigger a panic in dev to confirm wiring (test only — revert before commit)**

Temporarily add somewhere in `lib.rs`:
```rust
#[tauri::command]
fn debug_panic() {
    panic!("Sentry test panic from Rust core")
}
```

Register it in the `invoke_handler`. Run `npm run tauri:dev` with `SENTRY_DSN_RUST` exported. Trigger from the JS console via the IPC.

With release-mode build + DSN set, the panic should appear in the `scrollr-desktop` Sentry project tagged `runtime=rust-core`. Once verified, **remove the test command and revert the change**.

- [ ] **Step 7: Commit**

```bash
cd desktop && git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(desktop): integrate Sentry on Rust core with panic handler + path scrubbing"
```

---

## Task 6: Wire desktop Sentry into the GitHub Actions release workflow

**Files:**
- Modify: `.github/workflows/desktop-release.yml`

**Rationale:** Source maps + Rust DSN need to be available at build time. CI is the only place this matters in practice (local builds run with debug mode where Sentry is disabled).

- [ ] **Step 1: Add Sentry secrets to GitHub repo settings**

(Manual — user does this once.)
1. Repo → Settings → Secrets and variables → Actions → New repository secret
2. Add: `SENTRY_AUTH_TOKEN` (the token from Task 1 Step 1)
3. Add: `SENTRY_DSN_DESKTOP_WEBVIEW` (the `scrollr-desktop` DSN for the JS side)
4. Add: `SENTRY_DSN_DESKTOP_RUST` (the same DSN, but for the Rust compile-time injection)
5. Add: `SENTRY_ORG` (the org slug)

(JS and Rust use the same project DSN, but separate env vars to keep them grep-able.)

- [ ] **Step 2: Read current workflow**

Inspect `.github/workflows/desktop-release.yml` to identify:
- The job that builds the frontend (Vite)
- The job that builds Tauri (`tauri-action`)
- The env block where additional env vars can be inserted

- [ ] **Step 3: Inject Sentry env vars**

Add to the relevant job's `env:` block (or expose at the step level):
```yaml
env:
  # ... existing vars
  VITE_SENTRY_DSN: ${{ secrets.SENTRY_DSN_DESKTOP_WEBVIEW }}
  SENTRY_DSN_RUST: ${{ secrets.SENTRY_DSN_DESKTOP_RUST }}
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
  SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
```

The Vite source map upload happens automatically inside `npm run build` when the auth token is present. The Rust DSN is baked at `cargo build` time via `option_env!`.

- [ ] **Step 4: Add a "create release in Sentry" step (optional but recommended)**

After the build completes, register the release explicitly so Sentry knows it exists and assigns issues to it:
```yaml
- name: Create Sentry release
  uses: getsentry/action-release@v1
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
    SENTRY_PROJECT: scrollr-desktop
  with:
    environment: production
    version: scrollr-desktop@${{ steps.read-version.outputs.version }}
```

(The `steps.read-version.outputs.version` depends on how your current workflow reads the version — adapt accordingly.)

- [ ] **Step 5: Test by triggering a manual workflow_dispatch**

After committing, trigger the workflow manually and verify the Sentry release appears at https://sentry.io/organizations/<org>/releases/.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/desktop-release.yml
git commit -m "ci(desktop): wire Sentry source maps + Rust DSN into release workflow"
```

---

## Task 7: Sentry on the core Go API (`api/`)

**Files:**
- Modify: `api/go.mod`
- Modify: `api/main.go`
- Modify: `api/core/server.go` (or wherever middleware is registered — investigate)

- [ ] **Step 1: Add Sentry Go deps**

```bash
cd api && go get github.com/getsentry/sentry-go@v0.46.2
cd api && go get github.com/getsentry/sentry-go/fiber@v0.46.2
cd api && go mod tidy
```

- [ ] **Step 2: Find the middleware registration point**

Find `func (s *Server) Setup()` in `api/core/`. Investigate which file it's in (likely `api/core/server.go` or similar). The Sentry Fiber middleware must be the FIRST middleware registered so it can wrap panics in everything that follows.

- [ ] **Step 3: Add init in `api/main.go`**

Modify `api/main.go`. Add imports:
```go
import (
    // ... existing
    "crypto/sha256"
    "encoding/hex"
    "strings"
    "time"

    "github.com/getsentry/sentry-go"
)
```

Replace the top of `main()` (immediately after `_ = godotenv.Load()`):
```go
func main() {
    _ = godotenv.Load()

    // Sentry init — before any other infrastructure
    if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
        err := sentry.Init(sentry.ClientOptions{
            Dsn:              dsn,
            Environment:      envOr("ENVIRONMENT", "development"),
            Release:          envOr("GIT_SHA", "unknown"),
            EnableTracing:    true,
            TracesSampleRate: 0.1,
            AttachStacktrace: true,
            SendDefaultPII:   false,

            BeforeSend: func(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
                scrubEvent(event)
                return event
            },
        })
        if err != nil {
            log.Printf("[Sentry] init failed: %v", err)
        } else {
            log.Printf("[Sentry] initialized for environment=%s", envOr("ENVIRONMENT", "development"))
            sentry.ConfigureScope(func(scope *sentry.Scope) {
                scope.SetTag("service", "scrollr-core-api")
            })
            defer sentry.Flush(2 * time.Second)
        }
    }

    // ... rest of existing main()
}

// envOr returns the env value or fallback.
func envOr(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}

// scrubEvent removes PII and sensitive fields from a Sentry event.
func scrubEvent(event *sentry.Event) {
    if event.Request != nil {
        event.Request.Cookies = ""
        event.Request.Data = ""
        event.Request.QueryString = ""
        // Keep only safe request headers
        safe := map[string]string{}
        for k, v := range event.Request.Headers {
            switch strings.ToLower(k) {
            case "user-agent", "content-type", "x-request-id":
                safe[k] = v
            }
        }
        event.Request.Headers = safe
        event.Request.Env = nil
    }
    if event.User.IPAddress != "" {
        event.User.IPAddress = ""
    }
    event.User.Email = ""
    event.User.Username = ""
}

// hashUserSub deterministically hashes a Logto subject to a short anonymous ID.
// Returns "" if the salt isn't configured.
func hashUserSub(sub string) string {
    salt := os.Getenv("SENTRY_USER_SALT")
    if salt == "" {
        return ""
    }
    sum := sha256.Sum256([]byte(sub + salt))
    return hex.EncodeToString(sum[:8])
}
```

The `hashUserSub` helper is exported via `core.HashUserSub` in the next step so middleware can use it.

- [ ] **Step 4: Expose the hasher in `core/`**

Since `scrubEvent` is in `main.go` (package `main`) but middleware lives in `package core`, the hasher needs to live somewhere both can reach.

Create `api/core/sentry_helpers.go`:
```go
package core

import (
    "crypto/sha256"
    "encoding/hex"
    "os"
)

// HashUserSub deterministically hashes a Logto subject to a short anonymous ID.
// Returns "" if SENTRY_USER_SALT isn't configured.
func HashUserSub(sub string) string {
    salt := os.Getenv("SENTRY_USER_SALT")
    if salt == "" {
        return ""
    }
    sum := sha256.Sum256([]byte(sub + salt))
    return hex.EncodeToString(sum[:8])
}
```

Then remove the duplicate `hashUserSub` from `main.go`.

- [ ] **Step 5: Register Fiber middleware**

In the file containing `func (s *Server) Setup()`, add Sentry middleware as the FIRST middleware. Add imports:
```go
import (
    // ... existing
    "github.com/getsentry/sentry-go"
    sentryfiber "github.com/getsentry/sentry-go/fiber"
    "github.com/gofiber/fiber/v2"
)
```

Inside `Setup()`, before any other `s.App.Use(...)` call:
```go
// Sentry middleware MUST be first so panics from later middleware are caught.
if os.Getenv("SENTRY_DSN") != "" {
    s.App.Use(sentryfiber.New(sentryfiber.Options{
        Repanic:         true,  // also let Fiber's recover() see panics
        WaitForDelivery: false, // never block requests on Sentry
        Timeout:         2 * time.Second,
    }))
}
```

- [ ] **Step 6: Attach anonymous user ID in the existing auth middleware**

Find the auth middleware that sets `c.Locals("user_sub", sub)`. After the existing logic, add:
```go
if hub := sentryfiber.GetHubFromContext(c); hub != nil {
    if hashed := HashUserSub(sub); hashed != "" {
        hub.Scope().SetUser(sentry.User{ID: hashed})
    }
}
```

- [ ] **Step 7: Build and run a smoke test**

```bash
cd api && go build -o scrollr_api && SENTRY_DSN=https://test@test.ingest.sentry.io/0 SENTRY_USER_SALT=test ENVIRONMENT=development ./scrollr_api &
```

Hit an endpoint that will deliberately fail (or temporarily add a `/__panic` test route that calls `panic("sentry test")`). Verify the process recovers and logs the event attempt (a real DSN would receive it).

- [ ] **Step 8: Commit**

```bash
cd api && git add go.mod go.sum main.go core/sentry_helpers.go core/<server-file>.go
git commit -m "feat(api): integrate Sentry on core gateway with privacy-first scrubbing"
```

---

## Task 8: Sentry on each channel Go API (parallelizable)

**Files (per channel):**
- Modify: `channels/<name>/api/go.mod`
- Modify: `channels/<name>/api/main.go` (and possibly the file defining the `App` struct + middleware)

**Rationale:** AGENTS.md is explicit: "Module isolation is absolute ... Code duplication between channels is intentional." So each channel gets its own near-identical Sentry init. Four channels: `finance`, `sports`, `rss`, `fantasy`.

This task can be **parallelized** across the 4 channels. A subagent runner can dispatch 4 instances of this task in parallel — but each operates on its own module.

- [ ] **Step 1: Add deps (per channel)**

For each of `channels/{finance,sports,rss,fantasy}/api/`:
```bash
cd channels/<name>/api && go get github.com/getsentry/sentry-go@v0.46.2 && go get github.com/getsentry/sentry-go/fiber@v0.46.2 && go mod tidy
```

- [ ] **Step 2: Add init in `main.go` (per channel)**

In each `channels/<name>/api/main.go`, at the top of `main()`:
```go
import (
    // ... existing
    "strings"
    "time"

    "github.com/getsentry/sentry-go"
    sentryfiber "github.com/getsentry/sentry-go/fiber"
)

func main() {
    _ = godotenv.Load()

    if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
        err := sentry.Init(sentry.ClientOptions{
            Dsn:              dsn,
            Environment:      envOr("ENVIRONMENT", "development"),
            Release:          envOr("GIT_SHA", "unknown"),
            EnableTracing:    true,
            TracesSampleRate: 0.1,
            AttachStacktrace: true,
            SendDefaultPII:   false,
            BeforeSend: func(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
                if event.Request != nil {
                    event.Request.Cookies = ""
                    event.Request.Data = ""
                    event.Request.QueryString = ""
                    safe := map[string]string{}
                    for k, v := range event.Request.Headers {
                        switch strings.ToLower(k) {
                        case "user-agent", "content-type", "x-request-id":
                            safe[k] = v
                        }
                    }
                    event.Request.Headers = safe
                    event.Request.Env = nil
                }
                if event.User.IPAddress != "" {
                    event.User.IPAddress = ""
                }
                event.User.Email = ""
                event.User.Username = ""
                return event
            },
        })
        if err != nil {
            log.Printf("[Sentry] init failed: %v", err)
        } else {
            sentry.ConfigureScope(func(scope *sentry.Scope) {
                scope.SetTag("service", "scrollr-<name>-api") // replace <name>
            })
            defer sentry.Flush(2 * time.Second)
        }
    }

    // ... existing code
}

func envOr(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}
```

Replace `<name>` with the channel name in `scope.SetTag(...)`.

- [ ] **Step 3: Register Fiber middleware (per channel)**

In each channel's middleware setup (likely the same file where `App` registers routes — investigate per channel):
```go
if os.Getenv("SENTRY_DSN") != "" {
    a.app.Use(sentryfiber.New(sentryfiber.Options{
        Repanic:         true,
        WaitForDelivery: false,
        Timeout:         2 * time.Second,
    }))
}
```

(Adjust receiver name `a` to match the channel's actual `App` struct.)

- [ ] **Step 4: Attach user ID in `X-User-Sub` handler (per channel)**

Each channel API receives `X-User-Sub` from the core gateway. Find where it's parsed (search for `X-User-Sub` in each channel). After parsing, add:
```go
if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
    if hub := sentryfiber.GetHubFromContext(c); hub != nil {
        if salt := os.Getenv("SENTRY_USER_SALT"); salt != "" {
            sum := sha256.Sum256([]byte(sub + salt))
            hub.Scope().SetUser(sentry.User{ID: hex.EncodeToString(sum[:8])})
        }
    }
}
```

(With `import "crypto/sha256"` and `"encoding/hex"`.)

- [ ] **Step 5: Build each channel**

```bash
for ch in finance sports rss fantasy; do
  echo "--- $ch ---"
  cd channels/$ch/api && go build -o ${ch}_api && cd ../../..
done
```

Expected: all 4 builds succeed.

- [ ] **Step 6: Commit per channel**

For each channel:
```bash
cd channels/<name>/api && git add go.mod go.sum main.go <middleware-file>
git commit -m "feat(<name>-api): integrate Sentry with privacy-first scrubbing"
```

(Four separate commits — keeps the history per-service clean.)

---

## Task 9: Verify core + channel Go APIs

**Files:** None (verification only)

- [ ] **Step 1: Deploy each Go service to staging with `SENTRY_DSN` set**

(Manual — user triggers Coolify deploys.)

- [ ] **Step 2: Trigger a deliberate error on each service**

For each service, temporarily add a `/__sentry_test` route that calls `panic("sentry verification")`. Hit it through `curl` from a different shell. Then remove the route.

Alternative without code changes: hit an endpoint that's known to fail under specific inputs (e.g., a malformed `Authorization` header → 401 won't trigger Sentry; an invalid JSON body to a POST → may trigger Fiber's error handler — investigate).

- [ ] **Step 3: Verify each project receives events**

In Sentry UI, for each project (`scrollr-core-api`, `scrollr-finance-api`, etc.):
- An event appears within 60s of triggering
- The `service` tag matches the project name
- The `release` is the GIT_SHA
- `user.ip_address` is NOT present
- `request.cookies` and `request.data` are NOT present
- `request.headers` contains only `User-Agent`, `Content-Type`, `X-Request-Id` (if set)
- `user.id` is an 8-byte hex string (or absent for unauthenticated requests)

---

## Task 10: Sentry on the Rust ingestion services (finance, sports, rss)

**Files (per service):**
- Modify: `channels/<name>/service/Cargo.toml`
- Modify: `channels/<name>/service/src/main.rs` (replace `#[tokio::main]`)

**Rationale:** Sentry's docs explicitly state `#[tokio::main]` is unsupported. Sentry must initialize BEFORE the async runtime starts. All three Rust services need this refactor.

This task can be **parallelized** across the 3 services.

- [ ] **Step 1: Add Sentry deps (per service)**

Edit each `channels/<name>/service/Cargo.toml` `[dependencies]`:
```toml
sentry = { version = "0.48", default-features = false, features = [
  "backtrace",
  "contexts",
  "panic",
  "reqwest",
  "rustls",
  "tower",
  "tower-http",
  "anyhow",
  "release-health",
] }
dirs = "5"
```

- [ ] **Step 2: Refactor `main.rs` (per service)**

This is the most invasive change in Plan C. The existing `#[tokio::main] async fn main()` must become a synchronous `main()` that initializes Sentry, then manually constructs the Tokio runtime.

For each `channels/<name>/service/src/main.rs`:

Move the existing async body into a new `async fn run_service() -> anyhow::Result<()>` function. Replace `main` with:
```rust
fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    let _ = finance_service::log::init_async_logger("./logs"); // adjust crate name per service

    // Sentry init — MUST happen before tokio runtime starts.
    let _sentry_guard = sentry::init((
        std::env::var("SENTRY_DSN").ok(),
        sentry::ClientOptions {
            release: Some(
                format!("scrollr-<name>-svc@{}", env!("CARGO_PKG_VERSION")).into(),
            ),
            environment: Some(
                std::env::var("ENVIRONMENT")
                    .unwrap_or_else(|_| "development".to_string())
                    .into(),
            ),
            traces_sample_rate: 0.1,
            attach_stacktrace: true,
            send_default_pii: false,
            max_request_body_size: sentry::MaxRequestBodySize::None,
            max_breadcrumbs: 50,
            before_send: Some(std::sync::Arc::new(|mut event| {
                event.user = None;
                if let Some(req) = event.request.as_mut() {
                    req.cookies = None;
                    req.headers.clear();
                    req.data = None;
                    req.query_string = None;
                }
                let home = dirs::home_dir()
                    .map(|h| h.to_string_lossy().into_owned())
                    .unwrap_or_default();
                for exc in event.exception.values.iter_mut() {
                    if let Some(st) = exc.stacktrace.as_mut() {
                        for frame in st.frames.iter_mut() {
                            if let Some(filename) = frame.filename.as_mut() {
                                if !home.is_empty() {
                                    let s: String = filename.to_string();
                                    *filename = s.replace(&home, "~").into();
                                }
                            }
                        }
                    }
                }
                Some(event)
            })),
            ..Default::default()
        },
    ));

    sentry::configure_scope(|scope| {
        scope.set_tag("service", "scrollr-<name>-svc"); // replace <name>
    });

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    runtime.block_on(run_service())
}

async fn run_service() -> anyhow::Result<()> {
    // <-- everything from the old `#[tokio::main] async fn main()` body goes here -->
}
```

**Critical adaptation per service:**
1. Replace `<name>` with `finance`, `sports`, or `rss` in `scope.set_tag` and `release`.
2. Replace `finance_service` (the crate name) with `sports_service` or `rss_service` as appropriate.
3. The existing `main` does NOT currently return `Result` — it uses `.unwrap()` on listener bind etc. Convert those to `?` propagation:
   - `tokio::net::TcpListener::bind(&addr).await.unwrap()` → `tokio::net::TcpListener::bind(&addr).await.context("bind health server")?`
   - `axum::serve(listener, app).await` calls that `.await?` should be left as `.await?`. Confirm signatures.

Subagents implementing this: read the existing `main.rs` carefully. The finance service has supervised init tasks (`spawn_supervised`) — those stay inside `run_service`. Only the outer wrapping changes.

- [ ] **Step 3: Capture anyhow errors at the supervisor boundary**

The Rust services use `init::spawn_supervised` to wrap background tasks. Find that function (likely `channels/<name>/service/src/init.rs`) and inspect its error handling. After the task fails:
```rust
use sentry::integrations::anyhow::capture_anyhow;

if let Err(e) = result {
    capture_anyhow(&e);
    // ... existing error handling
}
```

If the supervisor currently uses `eprintln!`/`log::error!` only, add `capture_anyhow(&e)` immediately before that.

- [ ] **Step 4: Add Sentry tower layers to the Axum router**

Find the `Router::new()` chain (probably in `run_service` after the refactor). Add layers:
```rust
use sentry::integrations::tower::{NewSentryLayer, SentryHttpLayer};
use tower::ServiceBuilder;

let app = Router::new()
    .route("/health", get(health_ready_handler))
    .route("/health/live", get(health_live_handler))
    .route("/health/ready", get(health_ready_handler))
    .with_state(state)
    .layer(
        ServiceBuilder::new()
            .layer(NewSentryLayer::new_from_top())
            .layer(SentryHttpLayer::new().enable_transaction()),
    );
```

(Use `ServiceBuilder` to avoid the "memory leak when binding directly" warning from Sentry docs.)

- [ ] **Step 5: Build each Rust service**

```bash
for svc in finance sports rss; do
  echo "--- $svc ---"
  cd channels/$svc/service && cargo build --release && cd ../../..
done
```

Expected: each builds. Warnings are fine; errors must be resolved before continuing.

- [ ] **Step 6: Smoke test each service**

For one service (say finance), run with a fake DSN and trigger an error:
```bash
cd channels/finance/service && SENTRY_DSN=https://test@test.ingest.sentry.io/0 ENVIRONMENT=development cargo run --release
```

In another shell:
```bash
curl http://localhost:3001/__panic_test  # if you added one (then remove)
```

Watch the service log for `[Sentry]` lines (the SDK does log init success on startup).

Alternative: temporarily add a `tokio::spawn(async { panic!("test"); })` somewhere in `run_service`. Confirm the panic is captured by the SDK's panic handler (visible in logs).

- [ ] **Step 7: Commit per service**

```bash
cd channels/<name>/service && git add Cargo.toml Cargo.lock src/main.rs src/init.rs
git commit -m "feat(<name>-service): integrate Sentry; refactor to synchronous main"
```

(Three separate commits — one per service.)

---

## Task 11: Verify each Rust service in production

**Files:** None (verification only)

- [ ] **Step 1: Deploy each Rust service to staging**

(Manual — Coolify deploys with `SENTRY_DSN`, `ENVIRONMENT=production`, and `GIT_SHA` set.)

- [ ] **Step 2: Force a panic on each service**

Easiest method: temporarily add a `/__sentry_panic` route that calls `panic!("sentry verification")`, deploy, hit it, then remove and redeploy.

Less invasive: cause a real failure (e.g., set `DATABASE_URL` to an invalid value → migration failure on startup will produce an anyhow error if `capture_anyhow` is wired into init).

- [ ] **Step 3: Verify in Sentry UI**

For each Rust service project:
- Event arrives within 60s
- `service` tag matches
- `runtime=rust` (implicit from SDK)
- No user info, no headers, no bodies
- Stack trace with file paths showing `~` instead of `/Users/<name>` or `/home/<name>`

---

## Task 12: Sentry on the fantasy API (Go, but unique — has Yahoo OAuth)

**Files:**
- Modify: `channels/fantasy/api/go.mod`
- Modify: `channels/fantasy/api/main.go`
- Modify: relevant Yahoo OAuth handler files

**Rationale:** Fantasy is structurally a Go API (covered by Task 8), but its Yahoo OAuth flow is unique. Verify Sentry doesn't capture Yahoo tokens.

- [ ] **Step 1: Apply Task 8 pattern to fantasy**

Already done as part of Task 8 if `fantasy` was included in the loop. Verify:
```bash
grep -l 'sentry-go' channels/fantasy/api/
```
Expected: matches in `main.go`.

- [ ] **Step 2: Audit Yahoo OAuth handlers for token capture risk**

Search for files dealing with Yahoo OAuth:
```bash
grep -rln 'yahoo\|oauth' channels/fantasy/api/ | head -10
```

For each OAuth handler, ensure that:
- The `access_token`, `refresh_token`, and `state` are NOT logged via `fmt.Errorf("token: %s", token)` — use `fmt.Errorf("failed to refresh token: %w", err)` patterns instead.
- The Sentry middleware's `BeforeSend` strips request data — already covered by Task 8's `scrubEvent`.

If any handler captures the token directly into a Sentry-bound error, refactor to omit it. Example:
```go
// BAD
return fmt.Errorf("yahoo refresh failed for token %s: %w", token, err)

// GOOD
return fmt.Errorf("yahoo refresh failed: %w", err)
```

- [ ] **Step 3: Add an integration test (optional)**

Create `channels/fantasy/api/sentry_scrubbing_test.go`:
```go
package main

import (
    "testing"

    "github.com/getsentry/sentry-go"
)

func TestScrubEventRemovesPII(t *testing.T) {
    event := &sentry.Event{
        Request: &sentry.Request{
            Cookies:     "session=abc",
            QueryString: "code=xyz&state=123",
            Data:        "{\"refresh_token\":\"secret\"}",
            Headers: map[string]string{
                "Authorization": "Bearer secret",
                "User-Agent":    "test",
            },
        },
        User: sentry.User{
            IPAddress: "127.0.0.1",
            Email:     "a@b.com",
        },
    }
    scrubEvent(event)

    if event.Request.Cookies != "" {
        t.Errorf("Cookies not scrubbed: %q", event.Request.Cookies)
    }
    if event.Request.QueryString != "" {
        t.Errorf("QueryString not scrubbed: %q", event.Request.QueryString)
    }
    if event.Request.Data != "" {
        t.Errorf("Data not scrubbed: %q", event.Request.Data)
    }
    if _, ok := event.Request.Headers["Authorization"]; ok {
        t.Errorf("Authorization header not scrubbed")
    }
    if event.User.IPAddress != "" {
        t.Errorf("IP not scrubbed: %q", event.User.IPAddress)
    }
    if event.User.Email != "" {
        t.Errorf("Email not scrubbed: %q", event.User.Email)
    }
}
```

Run:
```bash
cd channels/fantasy/api && go test ./...
```

Expected: passes. Replicate this test in `channels/{finance,sports,rss}/api/` and `api/` for symmetry.

- [ ] **Step 4: Commit**

```bash
cd channels/fantasy/api && git add main.go sentry_scrubbing_test.go
git commit -m "test(fantasy-api): add Sentry PII scrubbing test"
```

Repeat the test addition + commit for the other 3 channel APIs + the core API.

---

## Task 13: Coordinate release versions across the stack

**Files:**
- Modify: `api/Dockerfile`
- Modify: `channels/<name>/api/Dockerfile` (each one)
- Modify: `channels/<name>/service/Dockerfile` (each one)

**Rationale:** Each service's Sentry release must be tied to the deployed git SHA so issues cluster correctly. Coolify passes a `GIT_SHA` env var at runtime, but it's also useful to bake it into the build for symbolication.

- [ ] **Step 1: Audit current Dockerfiles**

```bash
ls api/Dockerfile channels/*/api/Dockerfile channels/*/service/Dockerfile 2>/dev/null
```

For each Dockerfile, check whether it currently accepts a `GIT_SHA` build arg.

- [ ] **Step 2: Add `GIT_SHA` build arg to Go Dockerfiles**

For each Go service Dockerfile (`api/`, `channels/{finance,sports,rss,fantasy}/api/`):
```dockerfile
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
```

Add near the top, before the build step. The runtime `main.go` already reads `os.Getenv("GIT_SHA")` per Task 7/8.

For build-time injection into the binary (optional but cleaner), add `-ldflags`:
```dockerfile
RUN go build -ldflags "-X main.release=${GIT_SHA}" -o app .
```
And in `main.go`, read `release` instead of `os.Getenv("GIT_SHA")`. (Skip this in this task unless explicitly needed — env-var-at-runtime is simpler and works fine.)

- [ ] **Step 3: Same for Rust Dockerfiles**

For each Rust service Dockerfile (`channels/{finance,sports,rss}/service/`):
```dockerfile
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
```

The Rust release tag uses `env!("CARGO_PKG_VERSION")` (per Task 10), so `GIT_SHA` is supplementary — set it as a Sentry tag at runtime:

In each Rust service's `main.rs`, after `sentry::configure_scope`:
```rust
if let Ok(sha) = std::env::var("GIT_SHA") {
    sentry::configure_scope(|scope| {
        scope.set_tag("git_sha", sha);
    });
}
```

- [ ] **Step 4: Configure Coolify to pass `GIT_SHA`**

(Manual — user does this once per service in Coolify settings.)
- Build args: `GIT_SHA=${COOLIFY_GIT_COMMIT}` (or whatever the Coolify variable is named)
- Runtime env: `GIT_SHA=${COOLIFY_GIT_COMMIT}` (so the Go process can read it)

- [ ] **Step 5: Commit Dockerfile changes**

```bash
git add api/Dockerfile channels/*/api/Dockerfile channels/*/service/Dockerfile channels/*/service/src/main.rs
git commit -m "feat(deploy): wire GIT_SHA into all service builds for Sentry release tagging"
```

---

## Task 14: End-to-end privacy audit (manual + automated)

**Files:**
- Create: `docs/sentry-privacy-audit.md`

**Rationale:** Before declaring this done, manually verify every privacy promise. The marketing site publicly states "we don't track you" — Sentry must not introduce a contradiction.

- [ ] **Step 1: Document the audit procedure**

Create `docs/sentry-privacy-audit.md`:
```markdown
# Sentry Privacy Audit

Run this audit after every Sentry config change and at least quarterly.

## What we promise users (per the marketing site)

- No tracking
- No personal data collection
- No selling to brokers
- No ads

## What Sentry sees (must remain true)

### Identifiers
- IP addresses: **NEVER** sent
- User emails: **NEVER** sent
- User names: **NEVER** sent
- User identifiers: only an 8-byte SHA-256 hash of (logto_sub + salt)
- The salt is one-time-generated, never logged, never sent

### Request data
- Request bodies: **NEVER** sent
- Cookies: **NEVER** sent
- Query strings: **NEVER** sent
- Headers: only `User-Agent`, `Content-Type`, `X-Request-Id`

### Stack traces
- Filesystem paths: home directory replaced with `~`

### Tracing
- Trace headers propagated ONLY to `api.myscrollr.relentnet.dev`
- Never to: Stripe, Logto, Yahoo, TwelveData, ESPN, RSS sources

### Replay & feedback
- Session replay: **NOT installed**
- User feedback widget: **NOT installed**

## Audit checklist

### Per-service code audit
For each of the 10 projects, verify:
- [ ] `BeforeSend` / `before_send` is wired
- [ ] `sendDefaultPii: false` / `send_default_pii: false`
- [ ] No `Sentry.replayIntegration()` call anywhere
- [ ] No `Sentry.feedbackIntegration()` call anywhere
- [ ] `tracePropagationTargets` (JS) or `traces_propagation_targets` (default) restricts propagation

### Live event audit
For each project in Sentry UI, sample 10 recent events:
- [ ] None show `user.ip_address`
- [ ] None show `user.email` or `user.username`
- [ ] None show `request.cookies`
- [ ] None show `request.data` (request bodies)
- [ ] None show query strings in `request.url`
- [ ] User IDs (if any) are 8-byte hex strings, not Logto subs

### Server-side scrubbing audit
For each project in Sentry UI → Settings → Security & Privacy:
- [ ] "Data Scrubbing" is enabled
- [ ] Custom rules exist for: `*authorization*`, `*cookie*`, `*token*`, `*secret*`, `*api[_-]?key*`
- [ ] Default PII fields are scrubbed

### Sentry org settings
- [ ] Sentry is configured to delete events after the minimum retention (90 days for issues, default)
- [ ] No third-party integrations forward issues elsewhere

## Failure response

If the audit finds a violation:
1. Disable Sentry on the offending service (set `SENTRY_DSN=` empty in Coolify, redeploy)
2. Investigate the cause (incomplete BeforeSend, missing scrubbing rule, third-party integration leaking data)
3. Delete the offending events in Sentry UI (Issues → Discard)
4. Patch the code
5. Re-deploy
6. Re-run the audit
```

- [ ] **Step 2: Run the audit (manual)**

Walk through every checklist item. Document the date and outcome at the top of the file.

- [ ] **Step 3: Add the audit to release checklist**

If a release runbook exists (search `docs/` for `release` or `runbook`), add a step:
```markdown
- [ ] Sentry privacy audit performed (see docs/sentry-privacy-audit.md)
```

- [ ] **Step 4: Commit**

```bash
git add docs/sentry-privacy-audit.md
git commit -m "docs: Sentry privacy audit checklist"
```

---

## Task 15: Update all AGENTS.md files with Sentry conventions

**Files:**
- Modify: `AGENTS.md` (root)
- Modify: `myscrollr.com/AGENTS.md` (or its section in root)
- Modify: `desktop/AGENTS.md` (if exists)
- Modify: `api/AGENTS.md` (if exists)
- Modify: `channels/<name>/AGENTS.md` (if exists)

- [ ] **Step 1: Add a global Sentry section to root `AGENTS.md`**

In `/Users/doni/code/myscrollr/AGENTS.md`, add a new section:
```markdown
## Error Monitoring — Sentry

Every component has Sentry wired in. **Privacy is the hard constraint** — see `docs/sentry-privacy-audit.md`.

### Adding a new error capture site

**JS (React):**
```ts
import * as Sentry from '@sentry/react'

try {
  await doSomething()
} catch (err) {
  Sentry.captureException(err, { tags: { feature: 'checkout' } })
  // Show user-facing error too
}
```

**Go (Fiber):**
Panics are auto-captured by the `sentryfiber` middleware. For non-panic errors:
```go
hub := sentryfiber.GetHubFromContext(c)
if hub != nil {
    hub.CaptureException(err)
}
```

**Rust:**
```rust
use sentry::integrations::anyhow::capture_anyhow;
// or
sentry::capture_message("something went wrong", sentry::Level::Error);
```

### Forbidden patterns

- **Never** call `Sentry.replayIntegration()` or `Sentry.feedbackIntegration()`.
- **Never** add tokens, emails, IPs, or request bodies to a Sentry event.
- **Never** propagate trace headers to third-party services (Stripe, Logto, Yahoo, etc.). The default `tracePropagationTargets` covers this; don't widen it.
- **Never** rotate `SENTRY_USER_SALT` — existing hashes would un-cluster.

### When in doubt
Run `docs/sentry-privacy-audit.md` against the offending component.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document Sentry conventions in root AGENTS.md"
```

---

## Self-Review Checklist (post-implementation)

- [ ] 10 Sentry projects exist; each has a populated DSN
- [ ] `myscrollr.com` reports JS errors to `scrollr-web` with source maps symbolicated
- [ ] `desktop` reports JS errors from BOTH `ticker` and `app` windows, with `window` tag set correctly
- [ ] `desktop` reports Rust panics to `scrollr-desktop` with `runtime=rust-core` tag
- [ ] `api`, `finance-api`, `sports-api`, `rss-api`, `fantasy-api` each report Fiber panics to their respective project
- [ ] `finance-svc`, `sports-svc`, `rss-svc` each report Rust panics + supervised task failures
- [ ] Every released event has `release` tag tied to package version or git SHA
- [ ] Every released event has `service` tag matching the project name
- [ ] No event contains `user.ip_address`, `user.email`, `user.username`
- [ ] No event contains `request.cookies` or `request.data`
- [ ] No event has query strings in `request.url`
- [ ] User IDs in events are 8-byte hex hashes, never Logto subs
- [ ] `tokio::main` is gone from all 3 Rust services
- [ ] `docs/sentry-privacy-audit.md` is committed and the checklist has been run once
- [ ] `AGENTS.md` documents the Sentry conventions
- [ ] `npm run check` passes in `myscrollr.com` and `desktop`
- [ ] `cargo check` passes in `desktop/src-tauri` and all 3 Rust services
- [ ] `go build` succeeds in `api` and all 4 channel APIs
