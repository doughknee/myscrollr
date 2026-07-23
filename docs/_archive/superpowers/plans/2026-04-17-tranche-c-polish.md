# Tranche C: Sports Standings, Finance Pagination, Support Categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish three desktop app areas: collapsible/annotated standings, paginated finance feed, expanded support ticket categories.

**Architecture:** Three independent frontend changes (StandingsTab, FeedTab, ContactForm) plus one small backend change (support.go topic routing). No shared state or dependencies between the three areas.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Lucide icons, TanStack Query (desktop app). Go/Fiber (core API). clsx for conditional classes.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/src/channels/sports/StandingsTab.tsx` | Modify | Collapsible groups, favorite auto-scroll, zone indicators |
| `desktop/src/channels/finance/FeedTab.tsx` | Modify | Client-side pagination (page state, controls, reset logic) |
| `desktop/src/components/support/ContactForm.tsx` | Modify | 3 new categories, channel selector, updated canSubmit |
| `api/core/support.go` | Modify | 3 new topic ID env vars, channel field, billing/account body formatting |
| `k8s/configmap-core.yaml` | Modify | 3 new env var placeholders |

---

### Task 1: Sports Standings — Collapsible Groups

**Files:**
- Modify: `desktop/src/channels/sports/StandingsTab.tsx`

**Context:** The `StandingsTab` component (270 lines) groups standings by `group_name` using a `Map`. Each group renders a `GroupHeader` component (lines 113-121) followed by its standing rows. We need to make these groups collapsible.

- [ ] **Step 1: Add collapsed state and toggle handler**

In `StandingsTab` function body (after line 124's `selected` state), add:

```tsx
const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

const toggleGroup = useCallback((groupName: string) => {
  setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(groupName)) next.delete(groupName);
    else next.add(groupName);
    return next;
  });
}, []);
```

Add `useCallback` to the imports on line 1:
```tsx
import { Fragment, useState, useMemo, useCallback } from "react";
```

- [ ] **Step 2: Reset collapsed state on league change**

Add a `useEffect` after the collapsed state to reset when the league changes:

```tsx
useEffect(() => {
  setCollapsed(new Set());
}, [selected]);
```

Add `useEffect` to the imports on line 1:
```tsx
import { Fragment, useState, useMemo, useCallback, useEffect } from "react";
```

- [ ] **Step 3: Update GroupHeader to be clickable with chevron**

Add `ChevronDown` to imports:
```tsx
import { ChevronDown } from "lucide-react";
```

Replace the `GroupHeader` component (lines 113-121) with:

```tsx
function GroupHeader({
  name,
  isCollapsed,
  onToggle,
}: {
  name: string;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      className="bg-surface-hover cursor-pointer select-none hover:bg-surface-hover/80 transition-colors"
      onClick={onToggle}
    >
      <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-fg-2">
        <div className="flex items-center gap-1.5">
          <ChevronDown
            size={14}
            className={clsx(
              "text-fg-3 transition-transform duration-200",
              isCollapsed && "-rotate-90",
            )}
          />
          {name}
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Conditionally render rows based on collapsed state**

In the tbody render (lines 231-263), update the `GroupHeader` usage and add conditional row rendering:

Replace lines 232-233:
```tsx
{group.groupName && <GroupHeader name={group.groupName} />}
```

With:
```tsx
{group.groupName && (
  <GroupHeader
    name={group.groupName}
    isCollapsed={collapsed.has(group.groupName)}
    onToggle={() => toggleGroup(group.groupName)}
  />
)}
```

Wrap the standings rows (lines 234-261) with a collapsed check:
```tsx
{!collapsed.has(group.groupName) &&
  group.standings.map((s, i) => {
    // ... existing row render
  })}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 6: Commit**

```bash
git add desktop/src/channels/sports/StandingsTab.tsx
git commit -m "feat(standings): add collapsible group sections"
```

---

### Task 2: Sports Standings — Favorite Auto-Scroll

**Files:**
- Modify: `desktop/src/channels/sports/StandingsTab.tsx` (after Task 1 changes)

**Context:** After Task 1, the file has `useEffect` and `useCallback` imports, `collapsed` state, and the clickable `GroupHeader`. We now add auto-scroll to the first favorite team row.

- [ ] **Step 1: Add useRef import and create a ref map**

Add `useRef` to the imports (should already have `useEffect` from Task 1):
```tsx
import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
```

Inside `StandingsTab`, after the `collapsed` state, add:
```tsx
const favRowRef = useRef<HTMLTableRowElement | null>(null);
```

- [ ] **Step 2: Add auto-scroll effect**

After the collapsed-reset useEffect, add:

```tsx
useEffect(() => {
  if (favRowRef.current) {
    favRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}, [standings, favoriteTeams]);
```

- [ ] **Step 3: Attach ref to the first favorite row**

In the row rendering section, we need to track whether we've already assigned the ref. Add a `let` before the grouped rows map:

Inside the `useMemo` or render, track which team is the first favorite. The simplest approach: in the JSX, compute a boolean and conditionally attach the ref.

In the row `<tr>` element, add:
```tsx
ref={isFav && !favRefAssigned ? ((el) => { favRowRef.current = el; favRefAssigned = true; }) : undefined}
```

To track assignment, add before the `groupedRows.map`:
```tsx
let favRefAssigned = false;
```

The complete row render becomes:
```tsx
{(() => {
  let favRefAssigned = false;
  return groupedRows.map((group, groupIdx) => (
    <Fragment key={group.groupName || `group-${groupIdx}`}>
      {group.groupName && (
        <GroupHeader
          name={group.groupName}
          isCollapsed={collapsed.has(group.groupName)}
          onToggle={() => toggleGroup(group.groupName)}
        />
      )}
      {!collapsed.has(group.groupName) &&
        group.standings.map((s, i) => {
          const isFav = favoriteTeams.has(s.team_name);
          const attachRef = isFav && !favRefAssigned;
          if (attachRef) favRefAssigned = true;
          return (
            <tr
              key={`${s.team_name}-${i}`}
              ref={attachRef ? favRowRef : undefined}
              className={clsx(
                "border-b border-edge/30 hover:bg-surface-hover transition-colors",
                isFav && "bg-[#f97316]/5",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={clsx(
                    "px-2 py-1.5",
                    col.width,
                    col.key !== "team" && "font-mono text-fg-2",
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right",
                    !col.align && "text-left",
                  )}
                >
                  {col.getValue(s)}
                </td>
              ))}
            </tr>
          );
        })}
    </Fragment>
  ));
})()}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/channels/sports/StandingsTab.tsx
git commit -m "feat(standings): auto-scroll to favorite team on load"
```

---

### Task 3: Sports Standings — Zone Indicators

**Files:**
- Modify: `desktop/src/channels/sports/StandingsTab.tsx` (after Tasks 1-2 changes)

**Context:** After Tasks 1-2, the file has collapsible groups and auto-scroll. We now add colored left borders for soccer qualification/relegation zones.

- [ ] **Step 1: Add zone color helper function**

Before the `StandingsTab` function, add:

```tsx
function getZoneColor(description?: string): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("champions league")) return "border-l-green-500";
  if (lower.includes("europa")) return "border-l-blue-500";
  if (lower.includes("relegation")) return "border-l-red-500";
  return null;
}
```

- [ ] **Step 2: Apply zone border to rows**

In the row `<tr>`, add the zone border class. The `className` should include:

```tsx
const zoneColor = getZoneColor(s.description);
```

Add to the `<tr>` className:
```tsx
className={clsx(
  "border-b border-edge/30 hover:bg-surface-hover transition-colors",
  isFav && "bg-[#f97316]/5",
  zoneColor ? `border-l-2 ${zoneColor}` : "border-l-2 border-l-transparent",
)}
```

Note: We always add `border-l-2` so the layout doesn't shift between rows with and without zones. Transparent border for non-zone rows.

- [ ] **Step 3: Add zone legend below the table**

After the `</table>` closing tag (and inside the `overflow-x-auto` div), add a legend. First compute whether any zones exist:

Inside the `useMemo` that computes `columns` and `groupedRows`, also compute `hasZones`:

```tsx
const hasZones = standings.some((s) => getZoneColor(s.description) !== null);
```

Return `hasZones` from the useMemo alongside `columns` and `groupedRows`:
```tsx
return { columns: cols, groupedRows: groups, hasZones: allStandings.some(s => getZoneColor(s.description) !== null) };
```

Actually, simpler: compute `hasZones` separately or inside the same useMemo. The useMemo already has access to `standings`. Add `hasZones` to the returned object.

After the `</table>`, add:
```tsx
{hasZones && (
  <div className="flex items-center gap-4 px-3 py-2 border-t border-edge/30 text-[10px] text-fg-3">
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      Champions League
    </div>
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-blue-500" />
      Europa League
    </div>
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-red-500" />
      Relegation
    </div>
  </div>
)}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/channels/sports/StandingsTab.tsx
git commit -m "feat(standings): add playoff/relegation zone indicators for soccer"
```

---

### Task 4: Finance Pagination

**Files:**
- Modify: `desktop/src/channels/finance/FeedTab.tsx`

**Context:** The finance `FeedTab` (474 lines) renders all filtered trades via `filtered.map()` in a grid (lines 322-332). We add client-side pagination with 20 items per page.

- [ ] **Step 1: Add page state and PAGE_SIZE constant**

After the `SORT_OPTIONS` constant (line 62), add:
```tsx
const PAGE_SIZE = 20;
```

Inside `FinanceFeedTab`, after the `hasFilters` line (line 126), add:
```tsx
const [page, setPage] = useState(1);
const containerRef = useRef<HTMLDivElement>(null);
```

Add `useRef` to imports (line 12):
```tsx
import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
```
(This already imports `useRef` and `useEffect` — verify.)

- [ ] **Step 2: Reset page on filter/sort change**

After the `page` state, add:
```tsx
useEffect(() => {
  setPage(1);
}, [directionFilter, selectedCategories, sortKey]);
```

- [ ] **Step 3: Compute page slice and total pages**

After the `filtered` useMemo (line 187), add:
```tsx
const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
const safePage = Math.min(page, totalPages);
const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
```

- [ ] **Step 4: Scroll to top on page change**

Add:
```tsx
useEffect(() => {
  if (page > 1) {
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }
}, [page]);
```

- [ ] **Step 5: Replace `filtered` with `pageItems` in the grid**

On line 323, change `filtered.map((trade) => (` to `pageItems.map((trade) => (`.

- [ ] **Step 6: Attach containerRef to the outer div**

Change line 218:
```tsx
<div className="flex flex-col h-full">
```
to:
```tsx
<div ref={containerRef} className="flex flex-col h-full overflow-y-auto">
```

- [ ] **Step 7: Add pagination controls below the grid**

After the closing `</div>` of the trade grid (after line 332), but still inside the non-empty branch (before the closing of the ternary), add:

```tsx
{filtered.length > PAGE_SIZE && (
  <div className="sticky bottom-0 flex items-center justify-center gap-3 px-3 py-2 bg-surface border-t border-edge/30">
    <button
      onClick={() => setPage((p) => Math.max(1, p - 1))}
      disabled={safePage <= 1}
      className={clsx(
        "px-3 py-1 rounded text-xs font-medium transition-colors",
        safePage <= 1
          ? "text-fg-4 cursor-not-allowed"
          : "text-fg-2 hover:bg-surface-hover cursor-pointer",
      )}
    >
      Previous
    </button>
    <span className="text-xs text-fg-3 tabular-nums font-mono">
      Page {safePage} of {totalPages}
    </span>
    <button
      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
      disabled={safePage >= totalPages}
      className={clsx(
        "px-3 py-1 rounded text-xs font-medium transition-colors",
        safePage >= totalPages
          ? "text-fg-4 cursor-not-allowed"
          : "text-fg-2 hover:bg-surface-hover cursor-pointer",
      )}
    >
      Next
    </button>
  </div>
)}
```

- [ ] **Step 8: Build and verify**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 9: Commit**

```bash
git add desktop/src/channels/finance/FeedTab.tsx
git commit -m "feat(finance): add client-side pagination to trade grid"
```

---

### Task 5: Support Categories — Backend

**Files:**
- Modify: `api/core/support.go`
- Modify: `k8s/configmap-core.yaml`

**Context:** The support handler (306 lines) resolves osTicket topic IDs from env vars based on the `category` field. We add 3 new categories (billing, account, channel) and a `Channel` field for channel-specific help.

- [ ] **Step 1: Add Channel field to SupportTicketRequest**

In the `SupportTicketRequest` struct (lines 20-32), add after the `Name` field:
```go
Channel string `json:"channel,omitempty"`
```

- [ ] **Step 2: Extend topic ID resolution**

Replace the topic ID switch (lines 186-196) with:

```go
topicID := os.Getenv("OSTICKET_TOPIC_ID")
switch req.Category {
case "feature":
    if id := os.Getenv("OSTICKET_TOPIC_ID_FEATURE"); id != "" {
        topicID = id
    }
case "feedback":
    if id := os.Getenv("OSTICKET_TOPIC_ID_FEEDBACK"); id != "" {
        topicID = id
    }
case "billing":
    if id := os.Getenv("OSTICKET_TOPIC_ID_BILLING"); id != "" {
        topicID = id
    }
case "account":
    if id := os.Getenv("OSTICKET_TOPIC_ID_ACCOUNT"); id != "" {
        topicID = id
    }
case "channel":
    if id := os.Getenv("OSTICKET_TOPIC_ID_CHANNEL"); id != "" {
        topicID = id
    }
}
```

- [ ] **Step 3: Update subject prefix for new categories**

Replace the subject prefix switch (lines 127-135) with:

```go
var subjectPrefix string
switch req.Category {
case "feature":
    subjectPrefix = "Feature Request: "
case "feedback":
    subjectPrefix = "Feedback: "
case "billing":
    subjectPrefix = "Billing: "
case "account":
    subjectPrefix = "Account: "
case "channel":
    ch := strings.TrimSpace(req.Channel)
    if ch != "" {
        subjectPrefix = fmt.Sprintf("Channel Help (%s): ", ch)
    } else {
        subjectPrefix = "Channel Help: "
    }
default:
    subjectPrefix = "Bug Report: "
}
```

- [ ] **Step 4: Add HTML body formatting for new categories**

In the body switch (lines 151-173), add cases for the 3 new categories before the `default`:

```go
case "billing":
    body.WriteString("<h3>Billing & Subscription</h3>")
    body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
case "account":
    body.WriteString("<h3>Account & Login</h3>")
    body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
case "channel":
    ch := strings.TrimSpace(req.Channel)
    if ch != "" {
        body.WriteString(fmt.Sprintf("<h3>Channel Help — %s</h3>", escapeHTML(ch)))
    } else {
        body.WriteString("<h3>Channel Help</h3>")
    }
    body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
```

- [ ] **Step 5: Update configmap template**

In `k8s/configmap-core.yaml`, after the existing `OSTICKET_TOPIC_ID_FEEDBACK` entry, add:

```yaml
OSTICKET_TOPIC_ID_BILLING: ""
OSTICKET_TOPIC_ID_ACCOUNT: ""
OSTICKET_TOPIC_ID_CHANNEL: ""
```

- [ ] **Step 6: Build and verify**

Run: `go build ./...` from `api/`
Expected: Build passes with zero errors

- [ ] **Step 7: Commit**

```bash
git add api/core/support.go k8s/configmap-core.yaml
git commit -m "feat(support): add billing, account, channel help topic routing"
```

---

### Task 6: Support Categories — Frontend

**Files:**
- Modify: `desktop/src/components/support/ContactForm.tsx`

**Context:** The ContactForm (599 lines) has 3 categories defined in `CATEGORY_OPTIONS` (lines 36-40). We add 3 new categories with appropriate form fields.

- [ ] **Step 1: Extend Category type and add imports**

Change line 23:
```tsx
type Category = "bug" | "feature" | "feedback";
```
to:
```tsx
type Category = "bug" | "feature" | "feedback" | "billing" | "account" | "channel";
```

Add new Lucide icons to the import (line 11):
```tsx
import { Bug, Lightbulb, MessageSquare, CreditCard, UserCog, Radio, Paperclip, X, Loader2 } from "lucide-react";
```

- [ ] **Step 2: Add new category options**

Extend `CATEGORY_OPTIONS` (lines 36-40) — add after the feedback entry:
```tsx
{ value: "billing", label: "Billing & Subscription", icon: CreditCard },
{ value: "account", label: "Account & Login", icon: UserCog },
{ value: "channel", label: "Channel Help", icon: Radio },
```

- [ ] **Step 3: Add HEADER_CONFIG entries**

Extend `HEADER_CONFIG` (lines 54-67) — add after the feedback entry:
```tsx
billing: {
  title: "Billing & Subscription Help",
  subtitle: "Questions about charges, plan changes, or cancellations",
},
account: {
  title: "Account & Login Help",
  subtitle: "Issues with signing in, password, or account settings",
},
channel: {
  title: "Channel Help",
  subtitle: "Issues with a specific data channel",
},
```

- [ ] **Step 4: Add SUBMIT_LABELS and SUCCESS_MESSAGES entries**

Extend `SUBMIT_LABELS` (lines 69-73):
```tsx
billing: "Submit Billing Question",
account: "Submit Account Question",
channel: "Submit Channel Issue",
```

Extend `SUCCESS_MESSAGES` (lines 75-79):
```tsx
billing: "Billing question submitted — we'll follow up by email",
account: "Account question submitted — we'll follow up by email",
channel: "Channel issue submitted — we'll follow up by email",
```

- [ ] **Step 5: Add channel selection state**

After the `priority` state (line 118), add:
```tsx
const [channelSelection, setChannelSelection] = useState("");
```

- [ ] **Step 6: Update canSubmit logic**

Replace the `canSubmit` logic (lines 202-212) with:

```tsx
const canSubmit = (() => {
  if (submitting || cooldown > 0) return false;
  switch (category) {
    case "bug":
      return description.trim().length > 0 && whatWentWrong.trim().length > 0;
    case "feature":
    case "feedback":
    case "billing":
    case "account":
      return description.trim().length > 0;
    case "channel":
      return description.trim().length > 0 && channelSelection !== "";
  }
})();
```

- [ ] **Step 7: Add payload builders for new categories**

In the `handleSubmit` function, after the feedback payload builder (before `await authFetch`), add cases for the 3 new categories. The simplest approach: extend the existing if/else chain.

After the `} else {` block for feedback (lines 255-262), change to:

```tsx
} else if (category === "billing" || category === "account") {
  payload = {
    category,
    description: description.trim(),
    email: email.trim() || undefined,
    name: name.trim() || undefined,
  };
} else {
  // channel
  payload = {
    category: "channel",
    channel: channelSelection,
    description: description.trim(),
    email: email.trim() || undefined,
    name: name.trim() || undefined,
  };
}
```

Wait — the original code already has `else` as the feedback fallback. We need to restructure. The full chain should be:

```tsx
if (category === "bug") {
  // existing bug payload
} else if (category === "feature") {
  // existing feature payload
} else if (category === "channel") {
  payload = {
    category: "channel",
    channel: channelSelection,
    description: description.trim(),
    email: email.trim() || undefined,
    name: name.trim() || undefined,
  };
} else {
  // feedback, billing, account — all just description
  payload = {
    category,
    description: description.trim(),
    email: email.trim() || undefined,
    name: name.trim() || undefined,
  };
}
```

- [ ] **Step 8: Add form sections for new categories**

After the feedback form section (after line 572's closing `</div>` and `)`), add:

```tsx
{/* ── Billing fields ────────────────────────────────── */}
{category === "billing" && (
  <div>
    <label className="block text-xs font-medium text-fg-2 mb-1.5">
      Describe your billing question
    </label>
    <textarea
      value={description}
      onChange={(e) => setDescription(e.target.value)}
      rows={5}
      required
      placeholder="Questions about charges, plan changes, cancellations..."
      className={inputClass}
    />
  </div>
)}

{/* ── Account fields ────────────────────────────────── */}
{category === "account" && (
  <div>
    <label className="block text-xs font-medium text-fg-2 mb-1.5">
      Describe your account issue
    </label>
    <textarea
      value={description}
      onChange={(e) => setDescription(e.target.value)}
      rows={5}
      required
      placeholder="Issues with signing in, password, account settings..."
      className={inputClass}
    />
  </div>
)}

{/* ── Channel Help fields ───────────────────────────── */}
{category === "channel" && (
  <>
    <div>
      <label className="block text-xs font-medium text-fg-2 mb-1.5">
        Which channel?
      </label>
      <select
        value={channelSelection}
        onChange={(e) => setChannelSelection(e.target.value)}
        className="w-full bg-surface-2 border border-edge/30 rounded-lg px-3 py-2 text-sm text-fg focus:border-accent/60 focus:outline-none"
      >
        <option value="">Select a channel...</option>
        <option value="Finance">Finance</option>
        <option value="Sports">Sports</option>
        <option value="RSS">RSS</option>
        <option value="Fantasy">Fantasy</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-medium text-fg-2 mb-1.5">
        Describe your issue
      </label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
        required
        placeholder="What's happening with this channel?"
        className={inputClass}
      />
    </div>
  </>
)}
```

- [ ] **Step 9: Build and verify**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 10: Commit**

```bash
git add desktop/src/components/support/ContactForm.tsx
git commit -m "feat(support): add billing, account, channel help categories"
```

---

### Task 7: Final Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Desktop build**

Run: `npm run build` from `desktop/`
Expected: vite build + tsc --noEmit pass with zero errors

- [ ] **Step 2: Go build**

Run: `go build ./...` from `api/`
Expected: Build passes with zero errors

- [ ] **Step 3: Verify all commits on branch**

Run: `git log --oneline feature/tranche-c-polish ^main`
Expected: 5 commits (standings x3, finance x1, support-backend x1, support-frontend x1)
