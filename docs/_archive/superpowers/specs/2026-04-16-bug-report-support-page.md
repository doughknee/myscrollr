# Bug Report & Support Page — Design Spec

## Overview

Add an in-app bug reporting system with automatic diagnostic collection. Users submit structured bug reports from a dedicated Support page. Reports are proxied through the core API to OS Ticket, with system info, log files, and optional file attachments.

## Architecture

```
Desktop App                    Core API                    OS Ticket
-----------                    --------                    ---------
/support page                  POST /support/ticket        POST /api/tickets.json
  |                              |                           |
  ├─ Bug report form             ├─ Validate JWT             ├─ Creates ticket
  ├─ invoke("collect_diagnostics")├─ Rate limit (1/min/user) ├─ Attaches files
  ├─ authFetch POST              ├─ Build OS Ticket payload  └─ Returns ticket ID
  └─ File attachments (base64)   ├─ Forward to OS Ticket
                                 └─ Return ticket ID
```

## 1. Support Page (`/support` route)

New sidebar nav item below Settings: **LifeBuoy** icon, label "Support".

**Default view** (two cards):

- **Report a Bug** — icon: Bug, description: "Something not working? Let us know with details and we'll automatically include diagnostics." Click opens the bug report form.
- **Contact Us** — icon: Mail, description: "Questions about your account, billing, or anything else?" Shows support email (`support@myscrollr.com`) with a link to open the email client.

System tray gets a "Report a Bug" item that writes to `scrollr:navigate` store key (same cross-window pattern as "Customize Ticker"), main window navigates to `/support`.

### Files

- Create: `desktop/src/routes/support.tsx`
- Modify: `desktop/src/components/Sidebar.tsx` (add nav item)
- Modify: `desktop/src-tauri/src/tray.rs` (add menu item)

## 2. Diagnostic Collection (Rust Command)

New Tauri command: `collect_diagnostics` → returns `DiagnosticReport` JSON.

### Data collected

**App Metadata:**

- App version (`env!("CARGO_PKG_VERSION")`)
- Tauri version (`tauri::VERSION`)
- Platform (`std::env::consts::OS` + `std::env::consts::ARCH`)
- Build type (`cfg!(debug_assertions)` → "debug" / "release")

**System Info** (reuse existing `SysInfoState`):

- CPU: model, core count, frequency, usage %
- GPU: model, VRAM total/used, usage % (Linux only via sysfs/nvidia-smi)
- Memory: RAM total/used, swap total/used
- OS: name + version, hostname

**Environment:**

- Desktop environment (`XDG_CURRENT_DESKTOP` or `DESKTOP_SESSION` env vars)
- Display count + resolutions (Tauri `app.available_monitors()`)
- Session type (`XDG_SESSION_TYPE` → Wayland/X11, or "macOS"/"Windows")

**Window State** (both ticker + main):

- Position (x, y), size (w, h)
- Always on top, visible, decorated, maximized, minimized

**Runtime State:**

- Auth server running (from `AuthServerRunning` managed state)
- SSE handle active (from `SseHandle` managed state)

**Logs:**

- Last 200 lines from the Tauri log file (platform log directory)
- Log file path included for reference

**User Preferences** (read from Tauri store):

- Enabled channels, enabled widgets
- Ticker settings (mode, rows, position, showTicker)
- Theme, UI scale

### Files

- Create: `desktop/src-tauri/src/commands/diagnostics.rs`
- Modify: `desktop/src-tauri/src/commands/mod.rs` (add module)
- Modify: `desktop/src-tauri/src/lib.rs` (register command)

## 3. Bug Report Form Component

Renders inside the Support page when "Report a Bug" is clicked.

**Form fields:**

1. "What were you trying to do?" — textarea, required, 4 rows
2. "What went wrong?" — textarea, required, 4 rows
3. "What did you expect to happen instead?" — textarea, optional, 3 rows
4. "Does this happen every time?" — pill buttons: Always / Sometimes / First time
5. Attachments — file picker (multiple), selected files shown as removable chips, max 5 files, max 10 MB each

**Auto-collected on mount:**

- `invoke("collect_diagnostics")` populates a collapsible "Diagnostic Info" preview section
- User can expand to see exactly what's being sent (formatted, read-only)
- User email + name pre-filled from JWT (editable fallback inputs if not authenticated)

**Submit behavior:**

- `authFetch("POST", "/support/ticket", { ...formData, diagnostics, attachments[] })`
- Attachments sent as base64-encoded with filename + MIME type
- On success: toast "Bug report submitted — we'll follow up by email", form resets, show "Back to Support" link
- On failure: toast error, form stays filled, retry button
- Cooldown: disable submit for 60s after successful submission (prevent duplicates)

### Files

- Create: `desktop/src/components/support/BugReportForm.tsx`

## 4. Core API Proxy Endpoint

New route: `POST /support/ticket` (requires `LogtoAuth`)

**Request body:**

```json
{
  "subject": "Bug Report: <first 80 chars of 'what went wrong'>",
  "description": "<what were you trying to do>",
  "what_went_wrong": "<what went wrong>",
  "expected_behavior": "<what did you expect>",
  "frequency": "always|sometimes|first_time",
  "diagnostics": { ... },
  "attachments": [
    { "filename": "screenshot.png", "mime_type": "image/png", "data": "<base64>" }
  ]
}
```

**Handler:**

1. Extract user email from JWT claims (or request body fallback)
2. Rate limit: max 1 ticket per user per minute (in-memory, keyed by user sub)
3. Build OS Ticket API payload:
   - `name`: user display name or email prefix
   - `email`: user email from JWT
   - `subject`: from request
   - `message`: formatted HTML combining all text fields + diagnostics as a collapsible `<details>` block
   - `topicId`: configured via env var (`OSTICKET_TOPIC_ID`)
   - `attachments[]`: forwarded as-is (base64 with filename and MIME type)
4. POST to `{OSTICKET_URL}/api/tickets.json` with `X-API-Key` header
5. Return `{ status: "ok", ticket_id: "<id>" }` or error

**Dual API key handling:**

Both node IPs have separate OS Ticket API keys. The Go handler sends the request with the configured key. If there's a single `OSTICKET_API_KEY` env var, both nodes use the same one. Since the pod only runs on one node at a time, the key for the active node's IP should be used. Simplest approach: configure both keys comma-separated, or use a single key if OS Ticket allows multiple IPs per key.

For v1: use a single `OSTICKET_API_KEY` env var. If the pod moves between nodes, the admin updates the secret. This is acceptable since pod rescheduling is rare.

**Environment variables:**

- `OSTICKET_URL`: `https://support.myscrollr.com` (configmap)
- `OSTICKET_API_KEY`: API key for the active node IP (secret)
- `OSTICKET_TOPIC_ID`: help topic ID for bug reports (configmap)

### Files

- Create: `api/core/support.go`
- Modify: `api/core/server.go` (register route)
- Modify: `k8s/configmap-core.yaml` (add OSTICKET_URL, OSTICKET_TOPIC_ID)
- Modify: `k8s/secrets.yaml.template` (add OSTICKET_API_KEY)

## 5. Capabilities & Permissions

- The `default.json` capability already allows HTTP to `https://*/*` — no changes needed for frontend HTTP
- The new `collect_diagnostics` command is registered in `lib.rs` alongside existing commands
- File attachments use HTML `<input type="file" multiple>` which works natively in Tauri webviews — no additional plugin needed
- Log file reading in the Rust command uses `std::fs::read_to_string` on the known log path — no additional permissions needed

## 6. OS Ticket Configuration

- **Instance URL**: `https://support.myscrollr.com`
- **API endpoint**: `https://support.myscrollr.com/api/tickets.json`
- **API Keys** (per node IP):
  - Node 159.65.161.169: `FA96AE47C62C7710AB2944F757BF9F15`
  - Node 104.131.61.209: `6F6A5C4CA484841256C2EF1D92560E88`

## 7. Deferred to Phase 2

- FAQ section on the Support page
- Tutorials / getting started guide
- General support tickets (account, billing categories)
- JS error buffer capture (window.onerror + unhandledrejection)
- In-app screenshot capture
- Ticket status tracking / "My Tickets" view
- Rate limiting via Redis (for multi-replica support)
