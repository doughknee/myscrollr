# Bug Report & Support Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app bug reporting system with automatic diagnostic collection, proxied through the core API to OS Ticket.

**Architecture:** Desktop app collects diagnostics via a Rust Tauri command and user input via a React form, then POSTs to the core API's `/support/ticket` endpoint. The core API formats and forwards the ticket to OS Ticket's REST API. A new `/support` route in the desktop app hosts the bug report form and a contact card.

**Tech Stack:** Tauri v2 (Rust commands), React 19 (form UI), Go/Fiber (API proxy), OS Ticket REST API, sysinfo crate (diagnostics), TanStack Router (routing)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `desktop/src-tauri/src/commands/diagnostics.rs` | Rust command: collects system info, window state, runtime state, log tail |
| `desktop/src/routes/support.tsx` | Support page route with card layout + bug report form |
| `desktop/src/components/support/BugReportForm.tsx` | Bug report form component with diagnostics preview |
| `api/core/support.go` | Go handler: receives ticket, proxies to OS Ticket API |

### Modified files

| File | Change |
|------|--------|
| `desktop/src-tauri/src/commands/mod.rs` | Add `pub mod diagnostics;` |
| `desktop/src-tauri/src/lib.rs` | Register `collect_diagnostics` command |
| `desktop/src/components/Sidebar.tsx` | Add Support nav item with LifeBuoy icon |
| `desktop/src-tauri/src/tray.rs` | Add "Report a Bug" menu item |
| `api/core/server.go` | Register `POST /support/ticket` route |
| `k8s/configmap-core.yaml` | Add `OSTICKET_URL`, `OSTICKET_TOPIC_ID` |
| `k8s/secrets.yaml.template` | Add `OSTICKET_API_KEY` |

---

### Task 1: Diagnostic Collection Rust Command

**Files:**
- Create: `desktop/src-tauri/src/commands/diagnostics.rs`
- Modify: `desktop/src-tauri/src/commands/mod.rs`
- Modify: `desktop/src-tauri/src/lib.rs:73-83`

- [ ] **Step 1: Add module declaration**

In `desktop/src-tauri/src/commands/mod.rs`, add the new module:

```rust
pub mod auth;
pub mod diagnostics;
pub mod sse;
pub mod system_info;
pub mod window;
```

- [ ] **Step 2: Create diagnostics.rs with the collect_diagnostics command**

Create `desktop/src-tauri/src/commands/diagnostics.rs`:

```rust
use serde::Serialize;
use std::sync::atomic::Ordering;
use sysinfo::System;
use tauri::{AppHandle, Manager};

use crate::state;

// ── Types ───────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    app: AppMetadata,
    system: SystemInfo,
    environment: EnvironmentInfo,
    windows: WindowsState,
    runtime: RuntimeState,
    logs: LogInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppMetadata {
    version: String,
    tauri_version: String,
    platform: String,
    arch: String,
    build_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CpuInfo {
    model: String,
    cores: usize,
    frequency_mhz: Option<u64>,
    usage_percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuInfo {
    model: Option<String>,
    vram_total_bytes: Option<u64>,
    vram_used_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryInfo {
    ram_total_bytes: u64,
    ram_used_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    cpu: CpuInfo,
    gpu: GpuInfo,
    memory: MemoryInfo,
    os_name: String,
    hostname: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    name: Option<String>,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentInfo {
    desktop_environment: Option<String>,
    session_type: String,
    monitors: Vec<MonitorInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    label: String,
    position_x: i32,
    position_y: i32,
    width: u32,
    height: u32,
    visible: bool,
    always_on_top: bool,
    decorated: bool,
    maximized: bool,
    minimized: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsState {
    ticker: Option<WindowState>,
    main: Option<WindowState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    auth_server_running: bool,
    sse_active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogInfo {
    log_file_path: Option<String>,
    recent_lines: Vec<String>,
}

// ── Helpers ─────────────────────────────────────────────────────

fn get_window_state(app: &AppHandle, label: &str) -> Option<WindowState> {
    let win = app.get_webview_window(label)?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    let visible = win.is_visible().unwrap_or(false);
    let always_on_top = win.is_always_on_top().unwrap_or(false);
    let decorated = win.is_decorated().unwrap_or(true);
    let maximized = win.is_maximized().unwrap_or(false);
    let minimized = win.is_minimized().unwrap_or(false);

    Some(WindowState {
        label: label.to_string(),
        position_x: pos.x,
        position_y: pos.y,
        width: size.width,
        height: size.height,
        visible,
        always_on_top,
        decorated,
        maximized,
        minimized,
    })
}

fn get_session_type() -> String {
    if cfg!(target_os = "macos") {
        return "macOS".to_string();
    }
    if cfg!(target_os = "windows") {
        return "Windows".to_string();
    }
    std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "unknown".to_string())
}

fn get_desktop_environment() -> Option<String> {
    if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
        return None;
    }
    std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("DESKTOP_SESSION"))
        .ok()
}

fn read_log_tail(app: &AppHandle, max_lines: usize) -> LogInfo {
    let log_dir = app.path().app_log_dir().ok();
    let log_path = log_dir.map(|d| d.join(format!("{}.log", app.package_info().name)));

    let (path_str, lines) = match &log_path {
        Some(p) if p.exists() => {
            let content = std::fs::read_to_string(p).unwrap_or_default();
            let all_lines: Vec<String> = content.lines().map(String::from).collect();
            let start = all_lines.len().saturating_sub(max_lines);
            (
                Some(p.to_string_lossy().to_string()),
                all_lines[start..].to_vec(),
            )
        }
        Some(p) => (Some(p.to_string_lossy().to_string()), vec![]),
        None => (None, vec![]),
    };

    LogInfo {
        log_file_path: path_str,
        recent_lines: lines,
    }
}

// ── Command ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn collect_diagnostics(app: AppHandle) -> Result<DiagnosticReport, String> {
    let sysinfo_state = app.state::<state::SysInfoState>();
    let inner = &sysinfo_state.0;

    // Refresh system info
    {
        let mut sys = inner.sys.lock().map_err(|e| format!("sysinfo lock: {e}"))?;
        sys.refresh_cpu_all();
        sys.refresh_memory();
    }

    let sys = inner.sys.lock().map_err(|e| format!("sysinfo lock: {e}"))?;

    // CPU info
    let cpu_usage = if sys.cpus().is_empty() {
        0.0
    } else {
        sys.cpus().iter().map(|c| c.cpu_usage() as f64).sum::<f64>() / sys.cpus().len() as f64
    };

    let cpu = CpuInfo {
        model: sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default(),
        cores: sys.cpus().len(),
        frequency_mhz: sys.cpus().first().map(|c| c.frequency()),
        usage_percent: (cpu_usage * 10.0).round() / 10.0,
    };

    // GPU info (from cached static info)
    let static_info = inner.static_info.lock().map_err(|e| format!("static lock: {e}"))?;
    let gpu = GpuInfo {
        model: static_info.as_ref().and_then(|s| s.gpu_name.clone()),
        vram_total_bytes: static_info.as_ref().and_then(|s| s.gpu_vram_total),
        vram_used_bytes: None, // dynamic, would need a full probe -- skip for diagnostics
    };

    // Memory
    let memory = MemoryInfo {
        ram_total_bytes: sys.total_memory(),
        ram_used_bytes: sys.used_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
    };

    // OS info
    let os_name = format!(
        "{} {}",
        System::name().unwrap_or_default(),
        System::os_version().unwrap_or_default()
    );
    let hostname = System::host_name().unwrap_or_default();

    drop(sys);
    drop(static_info);

    // Environment
    let monitors: Vec<MonitorInfo> = app
        .available_monitors()
        .map(|list| {
            list.into_iter()
                .map(|m| {
                    let size = m.size();
                    MonitorInfo {
                        name: m.name().map(String::from),
                        width: size.width,
                        height: size.height,
                        scale_factor: m.scale_factor(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let environment = EnvironmentInfo {
        desktop_environment: get_desktop_environment(),
        session_type: get_session_type(),
        monitors,
    };

    // Window state
    let windows = WindowsState {
        ticker: get_window_state(&app, "ticker"),
        main: get_window_state(&app, "main"),
    };

    // Runtime state
    let auth_running = app
        .state::<state::AuthServerRunning>()
        .0
        .lock()
        .map(|v| *v)
        .unwrap_or(false);

    let sse_active = app
        .state::<state::SseHandle>()
        .0
        .lock()
        .map(|h| h.is_some())
        .unwrap_or(false);

    let runtime = RuntimeState {
        auth_server_running: auth_running,
        sse_active,
    };

    // Logs
    let logs = read_log_tail(&app, 200);

    // App metadata
    let app_meta = AppMetadata {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        build_type: if cfg!(debug_assertions) { "debug" } else { "release" }.to_string(),
    };

    Ok(DiagnosticReport {
        app: app_meta,
        system: SystemInfo {
            cpu,
            gpu,
            memory,
            os_name,
            hostname,
        },
        environment,
        windows,
        runtime,
        logs,
    })
}
```

- [ ] **Step 3: Register the command in lib.rs**

In `desktop/src-tauri/src/lib.rs`, add to the `generate_handler!` macro (after line 82):

```rust
        .invoke_handler(tauri::generate_handler![
            commands::window::position_ticker,
            commands::window::pin_window,
            commands::auth::start_auth_server,
            commands::auth::stop_auth_server,
            commands::sse::start_sse,
            commands::sse::stop_sse,
            commands::window::show_app_window,
            commands::window::quit_app,
            commands::system_info::get_system_info,
            commands::diagnostics::collect_diagnostics,
        ])
```

- [ ] **Step 4: Verify Rust builds**

Run: `cargo build` in `desktop/src-tauri/`
Expected: Clean compilation, no errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/commands/diagnostics.rs desktop/src-tauri/src/commands/mod.rs desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add collect_diagnostics Tauri command"
```

---

### Task 2: Core API Support Endpoint

**Files:**
- Create: `api/core/support.go`
- Modify: `api/core/server.go:170-180`
- Modify: `k8s/configmap-core.yaml`
- Modify: `k8s/secrets.yaml.template`

- [ ] **Step 1: Add K8s configuration**

In `k8s/configmap-core.yaml`, add after the last line in the `data:` section:

```yaml
  # Support / OS Ticket
  OSTICKET_URL: "https://support.myscrollr.com"
  OSTICKET_TOPIC_ID: ""
```

In `k8s/secrets.yaml.template`, add after the last entry:

```yaml
  # Support (OS Ticket)
  OSTICKET_API_KEY: ""
```

- [ ] **Step 2: Create support.go**

Create `api/core/support.go`:

```go
package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ===== Support ticket types =====

type SupportTicketRequest struct {
	Subject          string                 `json:"subject"`
	Description      string                 `json:"description"`
	WhatWentWrong    string                 `json:"what_went_wrong"`
	ExpectedBehavior string                 `json:"expected_behavior,omitempty"`
	Frequency        string                 `json:"frequency"`
	Diagnostics      map[string]interface{} `json:"diagnostics,omitempty"`
	Attachments      []TicketAttachment     `json:"attachments,omitempty"`
	Email            string                 `json:"email,omitempty"`
	Name             string                 `json:"name,omitempty"`
}

type TicketAttachment struct {
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
	Data     string `json:"data"` // base64
}

type osTicketPayload struct {
	Name        string                    `json:"name"`
	Email       string                    `json:"email"`
	Subject     string                    `json:"subject"`
	Message     string                    `json:"message"`
	TopicID     string                    `json:"topicId,omitempty"`
	Attachments []osTicketAttachmentEntry `json:"attachments,omitempty"`
}

type osTicketAttachmentEntry struct {
	Filename string `json:"name"`
	MimeType string `json:"type"`
	Data     string `json:"data"` // base64
}

// ===== Per-user rate limiting =====

var (
	supportRateMu    sync.Mutex
	supportRateMap   = make(map[string]time.Time)
	supportRateLimit = 1 * time.Minute
)

func checkSupportRateLimit(userID string) bool {
	supportRateMu.Lock()
	defer supportRateMu.Unlock()

	if last, ok := supportRateMap[userID]; ok {
		if time.Since(last) < supportRateLimit {
			return false
		}
	}
	supportRateMap[userID] = time.Now()
	return true
}

// ===== Handler =====

func HandleSubmitSupportTicket(c *fiber.Ctx) error {
	setCORSHeaders(c)

	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "error",
			Error:  "Authentication required",
		})
	}

	if !checkSupportRateLimit(userID) {
		return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
			Status: "error",
			Error:  "Please wait before submitting another ticket",
		})
	}

	var req SupportTicketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if strings.TrimSpace(req.WhatWentWrong) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Description of what went wrong is required",
		})
	}

	// Determine user identity (email is set by LogtoAuth middleware in c.Locals)
	email, _ := c.Locals("user_email").(string)
	if email == "" {
		email = req.Email
	}
	if email == "" {
		email = "anonymous@scrollr.user"
	}

	name := req.Name
	if name == "" {
		parts := strings.SplitN(email, "@", 2)
		name = parts[0]
	}

	// Build subject
	subject := req.Subject
	if subject == "" {
		what := strings.TrimSpace(req.WhatWentWrong)
		if len(what) > 80 {
			what = what[:80] + "..."
		}
		subject = fmt.Sprintf("Bug Report: %s", what)
	}

	// Build HTML message body
	var body strings.Builder
	body.WriteString("<h3>What were you trying to do?</h3>")
	body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
	body.WriteString("<h3>What went wrong?</h3>")
	body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.WhatWentWrong)))
	if req.ExpectedBehavior != "" {
		body.WriteString("<h3>What did you expect to happen instead?</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.ExpectedBehavior)))
	}
	if req.Frequency != "" {
		body.WriteString(fmt.Sprintf("<p><strong>Frequency:</strong> %s</p>", escapeHTML(req.Frequency)))
	}

	// Append diagnostics as collapsible block
	if req.Diagnostics != nil {
		diagJSON, err := json.MarshalIndent(req.Diagnostics, "", "  ")
		if err == nil {
			body.WriteString("<details><summary><strong>System Diagnostics</strong></summary>")
			body.WriteString(fmt.Sprintf("<pre>%s</pre>", escapeHTML(string(diagJSON))))
			body.WriteString("</details>")
		}
	}

	// Build OS Ticket payload
	payload := osTicketPayload{
		Name:    name,
		Email:   email,
		Subject: subject,
		Message: fmt.Sprintf("data:text/html;charset=utf-8,%s", body.String()),
	}

	topicID := os.Getenv("OSTICKET_TOPIC_ID")
	if topicID != "" {
		payload.TopicID = topicID
	}

	// Forward attachments
	for _, att := range req.Attachments {
		payload.Attachments = append(payload.Attachments, osTicketAttachmentEntry{
			Filename: att.Filename,
			MimeType: att.MimeType,
			Data:     att.Data,
		})
	}

	// POST to OS Ticket
	osTicketURL := os.Getenv("OSTICKET_URL")
	apiKey := os.Getenv("OSTICKET_API_KEY")
	if osTicketURL == "" || apiKey == "" {
		log.Println("[Support] OSTICKET_URL or OSTICKET_API_KEY not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Support ticket system is not configured",
		})
	}

	ticketURL := strings.TrimSuffix(osTicketURL, "/") + "/api/tickets.json"

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Support] Failed to marshal OS Ticket payload: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to prepare ticket",
		})
	}

	client := &http.Client{Timeout: 15 * time.Second}
	httpReq, err := http.NewRequest("POST", ticketURL, bytes.NewReader(payloadBytes))
	if err != nil {
		log.Printf("[Support] Failed to create OS Ticket request: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to submit ticket",
		})
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-API-Key", apiKey)

	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[Support] OS Ticket request failed: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to reach support system",
		})
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		log.Printf("[Support] OS Ticket returned %d: %s", resp.StatusCode, string(respBody))
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Support system rejected the ticket",
		})
	}

	log.Printf("[Support] Ticket created for user %s", userID)

	return c.JSON(fiber.Map{
		"status":  "ok",
		"message": "Bug report submitted successfully",
	})
}

// escapeHTML replaces < > & " with HTML entities.
func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
```

- [ ] **Step 3: Register the route in server.go**

In `api/core/server.go`, add after the billing routes (around line 180, in the protected routes section):

```go
	// Support
	s.App.Post("/support/ticket", LogtoAuth, HandleSubmitSupportTicket)
```

Also add `/support/ticket` to the `coreExemptPaths` slice (rate limiter exemption) since the handler has its own per-user rate limiting:

In the `coreExemptPaths` variable, add `"/support/ticket"`.

- [ ] **Step 4: Verify Go builds**

Run: `go build ./...` in `api/`
Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add api/core/support.go api/core/server.go k8s/configmap-core.yaml k8s/secrets.yaml.template
git commit -m "feat(api): add POST /support/ticket endpoint proxying to OS Ticket"
```

---

### Task 3: Support Page Route + Bug Report Form

**Files:**
- Create: `desktop/src/routes/support.tsx`
- Create: `desktop/src/components/support/BugReportForm.tsx`

- [ ] **Step 1: Create the BugReportForm component**

Create `desktop/src/components/support/BugReportForm.tsx`:

This component should:
- Accept `onBack: () => void` prop to return to the support card view
- On mount, call `invoke("collect_diagnostics")` and store result in state
- Show a loading spinner while diagnostics are being collected
- Render the form fields:
  1. "What were you trying to do?" — `<textarea>` required, 4 rows
  2. "What went wrong?" — `<textarea>` required, 4 rows
  3. "What did you expect to happen instead?" — `<textarea>` optional, 3 rows
  4. "Does this happen every time?" — 3 pill buttons (Always / Sometimes / First time)
  5. Attachments — `<input type="file" multiple>` hidden, triggered by button, max 5 files, max 10 MB each. Show selected files as removable chips.
  6. Collapsible "Diagnostic Info" section — shows JSON preview of what will be sent
- Pre-fill user email/name from `getUserIdentity()` (from `auth.ts`). If not authenticated, show editable email input.
- Submit: reads each file as base64 via `FileReader`, then `authFetch<{ status: string; message: string }>("/support/ticket", { method: "POST", body: JSON.stringify(payload) })`
- On success: toast.success, reset form, call onBack
- On failure: toast.error, keep form filled
- 60s cooldown after successful submit (disable button with countdown)
- Use the project's styling conventions: `clsx`, semicolons, double quotes, Tailwind v4, `text-fg-*` tokens, `border-edge/*` tokens

The form should follow the existing app's dark-first design with proper contrast (min `text-fg-3` for muted text, `border-edge/30` for borders, `focus:border-accent/60` for focus rings).

- [ ] **Step 2: Create the Support page route**

Create `desktop/src/routes/support.tsx`:

This component should:
- Use `createFileRoute("/support")` from TanStack Router
- Default export: `SupportPage` function component
- Two states: card view (default) and bug report form
- Card view shows two cards side by side:
  - **Report a Bug** card: Bug icon (from lucide-react), title, description, click handler sets form view
  - **Contact Us** card: Mail icon, title, shows `support@myscrollr.com`, click opens email client via `@tauri-apps/plugin-shell` `open("mailto:support@myscrollr.com")`
- When in form view, render `<BugReportForm onBack={() => setView("cards")} />`
- Page title: "Support" with LifeBuoy icon, styled like other page headers

- [ ] **Step 3: Verify frontend builds**

Run: `npm run build` in `desktop/`
Expected: Clean build (vite + tsc --noEmit).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/routes/support.tsx desktop/src/components/support/BugReportForm.tsx
git commit -m "feat(desktop): add Support page with bug report form"
```

---

### Task 4: Sidebar + Tray Integration

**Files:**
- Modify: `desktop/src/components/Sidebar.tsx:168-183`
- Modify: `desktop/src-tauri/src/tray.rs`

- [ ] **Step 1: Add Support nav item to Sidebar**

In `desktop/src/components/Sidebar.tsx`:

Add `LifeBuoy` to the lucide-react import at the top of the file.

Add a new prop `onNavigateToSupport` to the `SidebarProps` interface (same pattern as `onNavigateToSettings`).

Add a new `isSupport` prop (boolean, same pattern as `isSettings`).

In the footer section (after the Settings `NavItem` at line 183), add:

```tsx
<NavItem
  icon={<LifeBuoy size={15} />}
  label="Support"
  active={isSupport}
  collapsed={collapsed}
  onClick={onNavigateToSupport}
/>
```

In `desktop/src/routes/__root.tsx`, wire the new props:
- Add `isSupport: location.pathname === "/support"` alongside the existing `isSettings`, `isFeed`, `isMarketplace` checks
- Add `onNavigateToSupport: () => navigate({ to: "/support" })` alongside the existing navigation callbacks
- Pass both as props to `<Sidebar>`

- [ ] **Step 2: Add "Report a Bug" to system tray**

In `desktop/src-tauri/src/tray.rs`:

Add a new menu item before the quit separator:

```rust
let report_bug = MenuItemBuilder::with_id("report_bug", "Report a Bug").build(app)?;
```

Add it to the menu builder items array (before the last separator and quit):

```rust
let menu = MenuBuilder::new(app)
    .items(&[&open, &sep1, &toggle_ticker, &sep2, &report_bug, &sep3, &quit])
    .build()?;
```

(Rename the existing `sep2` to `sep2` and add a new `sep3` before quit, or just insert `report_bug` before the existing quit separator.)

In the `on_menu_event` handler, add a match arm:

```rust
"report_bug" => {
    // Show main window and navigate to /support
    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app_handle.emit("navigate-to", "/support");
}
```

Wait — the existing cross-window nav uses the store pattern (`scrollr:navigate`). But the tray handler is Rust-side. Use `app_handle.emit()` which broadcasts a Tauri event to all windows. In `__root.tsx`, add a `useTauriListener("navigate-to", (path) => navigate({ to: path }))` alongside the existing `scrollr:navigate` store listener.

Actually, simpler: use the same store-based pattern. The Rust `tray.rs` doesn't have direct store access easily. The `emit()` pattern is cleaner for tray → window communication. Add a `useTauriListener` in `__root.tsx` for `"navigate-to"` events.

- [ ] **Step 3: Wire the tray navigation in __root.tsx**

In `desktop/src/routes/__root.tsx`, add a `useTauriListener` for `"navigate-to"` events:

```tsx
useTauriListener<string>("navigate-to", (event) => {
  if (event.payload) {
    navigate({ to: event.payload });
  }
});
```

This should go near the existing cross-window sync effects (around line 290-303).

- [ ] **Step 4: Verify both Rust and frontend build**

Run: `cargo build` in `desktop/src-tauri/` and `npm run build` in `desktop/`
Expected: Both clean.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/Sidebar.tsx desktop/src/routes/__root.tsx desktop/src-tauri/src/tray.rs
git commit -m "feat(desktop): add Support nav item to sidebar and Report a Bug to system tray"
```

---

### Task 5: Manual Testing + Polish

**Files:**
- Potentially any of the above files for fixes

- [ ] **Step 1: Test the diagnostics command**

Run: `npm run tauri:dev` in `desktop/`

Open the browser dev tools console and run:
```js
window.__TAURI__.core.invoke("collect_diagnostics")
```

Verify it returns a JSON object with all expected sections (app, system, environment, windows, runtime, logs). Check that log lines are present if the log file exists.

- [ ] **Step 2: Test the support page**

Navigate to `/support` via the sidebar. Verify:
- Two cards render (Report a Bug + Contact Us)
- Clicking "Report a Bug" shows the form
- Form collects diagnostics on mount (visible in preview)
- Frequency pills work (single selection)
- File picker works, shows selected files, can remove
- Collapsible diagnostics preview expands/collapses

- [ ] **Step 3: Test the tray menu**

Right-click the system tray icon. Verify "Report a Bug" appears. Click it. Verify:
- Main window opens and gains focus
- Navigates to `/support`

- [ ] **Step 4: Test end-to-end submission (requires OS Ticket config)**

This requires the `OSTICKET_URL`, `OSTICKET_API_KEY`, and `OSTICKET_TOPIC_ID` to be set in the K8s environment. Once configured:
- Fill out the bug report form
- Click Submit
- Verify toast success
- Check OS Ticket for the new ticket with diagnostics attached

- [ ] **Step 5: Build verification**

Run: `npm run build` in `desktop/`
Run: `go build ./...` in `api/`
Expected: Both clean.

- [ ] **Step 6: Commit any polish fixes**

```bash
git add -A
git commit -m "fix(desktop): bug report polish and testing fixes"
```
