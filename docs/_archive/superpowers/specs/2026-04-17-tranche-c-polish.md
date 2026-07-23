# Tranche C: Sports Standings, Finance Pagination, Support Categories

## Overview

Three independent desktop app polish items: improved sports standings UX, client-side finance pagination, and expanded support ticket categories.

---

## 1. Sports Standings Polish

**File:** `desktop/src/channels/sports/StandingsTab.tsx`

### 1a. Collapsible Groups

Each `group_name` section (e.g. "AFC East", "Eastern Conference") becomes a collapsible accordion.

- All groups start **expanded** by default.
- Click the group header row to toggle collapse/expand.
- Collapsed state is ephemeral — resets on league change or component remount.
- Track collapsed groups in a `Set<string>` state variable.
- The `GroupHeader` component gets a chevron icon (rotates on collapse) and `cursor-pointer`.
- When collapsed, the group's standing rows are hidden (`display: none` or conditional render).

### 1b. Favorite Team Auto-Scroll

On mount and league change, scroll the first favorite team's row into view.

- After standings data loads, find the first `Standing` where `favoriteTeams.has(s.team_name)`.
- Use a ref on that row and call `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
- Only fires if a favorite exists in the current standings data.
- Use `useEffect` keyed on `[standings, favoriteTeams]` to trigger.

### 1c. Playoff/Relegation Zone Indicators

For soccer leagues where `description` is populated, add a colored left border on the row.

- **Green** (`border-l-2 border-l-green-500`) — description contains "Champions League"
- **Blue** (`border-l-2 border-l-blue-500`) — description contains "Europa" (covers Europa League and Europa Conference League)
- **Red** (`border-l-2 border-l-red-500`) — description contains "Relegation"
- **No border** — description is null/empty or doesn't match any keyword

Helper function `getZoneColor(description?: string): string | null` does the keyword matching.

Add a small legend below the table when any zone indicators are present:
- Three colored dots with labels: "Champions League", "Europa League", "Relegation"
- Only rendered when the current league has at least one standing with a non-null description.

For non-soccer leagues (NFL, NBA, NHL, MLB) where `description` is always null, no visual change at all.

---

## 2. Finance Pagination

**File:** `desktop/src/channels/finance/FeedTab.tsx`

Add client-side pagination to the trade grid.

### Rules

- **Page size:** 20 items per page. Not user-configurable.
- **Pagination controls:** Below the grid. Previous/Next buttons + "Page X of Y" indicator. Buttons disabled at boundaries.
- **Reset on filter change:** Page resets to 1 when direction filter, category filter, or sort order changes.
- **Summary bar:** Reflects the full filtered set count, not just the current page.
- **Scroll to top:** On page change, scroll the feed container to the top.
- **Small sets:** If filtered results are <= 20, no pagination controls shown.

### Implementation

- Add `page` state (default 1).
- After computing `filtered` array, derive `totalPages = Math.ceil(filtered.length / PAGE_SIZE)`.
- Slice: `const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)`.
- Render `pageItems` instead of `filtered` in the grid.
- Add `useEffect` to reset `page` to 1 when `directionFilter`, `selectedCategories`, or `sortKey` change.
- Add a `containerRef` on the outer `div` and call `containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })` on page change.

---

## 3. Support Contact Form — Expanded Categories

**Files:** `desktop/src/components/support/ContactForm.tsx`, `api/core/support.go`, `k8s/configmap-core.yaml`

### New Categories

Expand from 3 to 6 categories:

| Category | Value | Icon | Form Fields |
|----------|-------|------|-------------|
| Bug Report | `bug` | Bug | (existing — no change) |
| Feature Request | `feature` | Lightbulb | (existing — no change) |
| General Feedback | `feedback` | MessageSquare | (existing — no change) |
| Billing & Subscription | `billing` | CreditCard | description only |
| Account & Login | `account` | UserCog | description only |
| Channel Help | `channel` | Radio | channel selector dropdown + description |

### Frontend Changes (`ContactForm.tsx`)

- Extend `Category` type to include `"billing" | "account" | "channel"`.
- Add 3 entries to `CATEGORY_OPTIONS` with appropriate Lucide icons (`CreditCard`, `UserCog`, `Radio`).
- Add entries to `HEADER_CONFIG`, `SUBMIT_LABELS`, `SUCCESS_MESSAGES` for the 3 new categories.
- Update `canSubmit`: billing and account require `description.trim().length > 0`. Channel requires `description.trim().length > 0` AND a selected channel.
- Add `channelSelection` state (`"finance" | "sports" | "rss" | "fantasy" | ""`).
- Add a channel selector dropdown in the `category === "channel"` section with 4 options: Finance, Sports, RSS, Fantasy.
- For channel help, include `channel` field in the payload: `{ category: "channel", channel: channelSelection, description }`.
- For billing and account, send `{ category: "billing"|"account", description, email, name }`.

### Backend Changes (`support.go`)

- Add 3 new topic ID resolution cases in the switch statement (lines 186-196):
  - `"billing"` → `OSTICKET_TOPIC_ID_BILLING`
  - `"account"` → `OSTICKET_TOPIC_ID_ACCOUNT`
  - `"channel"` → `OSTICKET_TOPIC_ID_CHANNEL`
- For channel category, read the `channel` field from the request and prepend it to the subject: `"Channel Help (Finance): ..."`.
- Add `Channel` field to `SupportTicketRequest` struct: `Channel string json:"channel,omitempty"`.
- Add channel help body format in the HTML message builder.

### Config Changes (`k8s/configmap-core.yaml`)

Add 3 new env var placeholders (values set manually in Coolify after creating osTicket topics):
- `OSTICKET_TOPIC_ID_BILLING`
- `OSTICKET_TOPIC_ID_ACCOUNT`
- `OSTICKET_TOPIC_ID_CHANNEL`

### Manual Step

After deploying, create 3 new help topics in the osTicket admin panel and configure the env vars in Coolify.

---

## Out of Scope

- Sports game detail/box scores (no data exists — deferred)
- Server-side finance pagination (not needed, tier limits cap the data)
- Support ticket viewing/history
- Any backend changes to sports or finance APIs
