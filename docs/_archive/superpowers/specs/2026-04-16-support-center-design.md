# Support Center Design Spec

**Date:** 2026-04-16
**Scope:** Desktop app only (`desktop/src/`)
**Route:** `/support` (replaces the current minimal support page)

---

## Overview

Transform the current two-card support page into a full-featured support center with self-service help content, searchable FAQ, troubleshooting guides, feature documentation, billing help, and a unified contact form. Architecture is hub-and-drill-down: a landing page with search and category cards, each drilling into a dedicated sub-view.

## Architecture

### Layout: Hub + Drill-Down

The `/support` route renders a `SupportHub` component by default. Local state (`activeSection`) controls which section is displayed. Clicking a category card sets `activeSection`; a back button clears it to return to the hub.

No URL-based sub-routing — all navigation is local state within the route component.

### Content Storage

All help content is hardcoded in TypeScript data files shipped with the app. No API calls for content. Works offline. Content updates require an app release.

Feature guide content for channels and widgets is pulled from the existing `SourceInfo` data on channel/widget manifests (`info.about` and `info.usage` fields), which are currently defined but never rendered.

### Search

A single search input at the top of the hub. Typing filters across all content types (FAQ questions + answers, troubleshooting titles + symptoms, guide names, billing topics) and renders matching results inline, replacing the category card grid. Each result shows its section badge (FAQ, Troubleshooting, etc.) and clicking it drills into that section with the matched item expanded/highlighted.

Search is client-side string matching (case-insensitive `includes()` against a pre-built index of searchable text per item).

---

## Hub View

### Header

- Icon: `LifeBuoy` (matches sidebar)
- Title: "Support Center"
- Subtitle: "Get help, find answers, and contact us"

### Search Bar

Full-width input below the header: "Search help articles, FAQs, troubleshooting..."

### Category Cards (2-column grid, 6 cards)

| Card | Icon | Label | Description | Section Component |
|------|------|-------|-------------|-------------------|
| 1 | `Rocket` | Getting Started | Set up channels, customize your ticker | `GettingStartedSection` |
| 2 | `HelpCircle` | FAQ | Common questions answered | `FAQSection` |
| 3 | `Wrench` | Troubleshooting | Fix common issues | `TroubleshootingSection` |
| 4 | `BookOpen` | Feature Guides | Learn about each channel and widget | `FeatureGuidesSection` |
| 5 | `CreditCard` | Account & Billing | Subscriptions, plans, payments | `BillingHelpSection` |
| 6 | `MessageCircle` | Contact Us | Report bugs, request features, send feedback | `ContactForm` |

Each card is a clickable button with the icon tinted in accent color, bold label, and muted description. Hover: `bg-surface-hover`. Active (current section): `border-accent/30`.

---

## Section 1: Getting Started

A concise 6-step walkthrough for new users. Each step is a card with an icon, title, and 2-3 sentence description.

### Steps

1. **Sign In** (`LogIn`) — Create an account or sign in to sync your channels and settings across devices. Free accounts get full access to all features with generous limits.
2. **Add Channels** (`LayoutGrid`) — Open the Catalog from the sidebar to browse available data sources. Add Finance for stock prices, Sports for live scores, News for RSS feeds, or Fantasy for Yahoo leagues.
3. **Configure Your Feeds** (`Settings`) — Each channel has a Settings tab where you pick what to track. Add stock symbols, select sports leagues, subscribe to news feeds, or connect your Yahoo account.
4. **Customize the Ticker** (`Monitor`) — The ticker bar runs across your screen showing live data. Adjust its position (top/bottom), size (compact/comfort), and number of rows in Settings > Ticker.
5. **Explore Widgets** (`Puzzle`) — Add utility widgets like Weather, Clock, System Monitor, Uptime Kuma, or GitHub Actions from the Catalog. Widgets appear on your ticker alongside channel data.
6. **Upgrade Your Plan** (`Zap`) — Free accounts have limits on symbols, feeds, and leagues. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.

Layout: Vertical list of step cards, each with a left-aligned number badge, icon, title, and description.

---

## Section 2: FAQ

Expandable accordion list. Each item has a question (always visible) and an answer (expands on click with a chevron indicator).

### Content

Port the 8 existing FAQ items from the website (`myscrollr.com/src/components/landing/FAQSection.tsx`) plus add app-specific ones:

**From website (adapted for desktop context):**
1. Is Scrollr free?
2. Does it affect performance?
3. Is my data private?
4. What platforms are supported?
5. Do I need an account?
6. What data does Scrollr show?
7. Can I customize the feed?
8. Is Scrollr open source?

**New desktop-specific items:**
9. How do I update the app?
10. Can I use Scrollr on multiple monitors?
11. How does live data work vs. polling?
12. What's the difference between Uplink tiers?

Each item: `{ question: string; answer: string }`. Answers can contain basic inline formatting (bold, links rendered as accent-colored text).

---

## Section 3: Troubleshooting

Problem-solution cards. Each has a title (the problem), symptoms list, and numbered solution steps. Cards are collapsible (title always visible, expand to see details).

### Articles

1. **Sign-in fails or shows "Sign-in failed"**
   - Symptoms: Browser opens but returns to app with error toast, or browser shows "authorization successful" but app shows failure
   - Steps: Check internet connection. Try signing out (Settings > Account) then signing in again. If the browser shows an error page, check that your Logto redirect URI is configured correctly.

2. **Data not loading / feed shows empty**
   - Symptoms: Channel added but shows "No data right now", ticker shows empty slots
   - Steps: Open the channel's Settings tab and verify items are configured. Check that you're signed in (Settings > Account). Try switching away and back to the feed tab.

3. **Ticker not visible**
   - Symptoms: Ticker bar disappeared, only the main window shows
   - Steps: Press Ctrl+T (or Cmd+T on macOS) to toggle ticker visibility. Or go to Settings > General and enable "Show Ticker". Check if the ticker is set to your current monitor's edge.

4. **Finance prices not updating**
   - Symptoms: Stock prices appear frozen, last updated time is stale
   - Steps: The finance data service reconnects automatically after brief disconnections. Wait 2-5 minutes for auto-recovery. If persistent, check your internet connection and try restarting the app.

5. **Yahoo Fantasy connect fails**
   - Symptoms: Clicking "Connect Yahoo" opens browser but nothing happens, or returns an error
   - Steps: Yahoo's OAuth can be intermittent. Wait 30 seconds and try again. Make sure you're authorizing the correct Yahoo account. If you see "invalid redirect URI", this is a known Yahoo issue — retry usually works.

6. **Sports scores appear stale**
   - Symptoms: Scores don't match live TV, games still showing yesterday's scores
   - Steps: Scores update via polling on a schedule based on your plan tier. Free tier polls every 60 seconds, Uplink every 30 seconds. Ultimate tier gets live updates via SSE. Check your current delivery mode in the sidebar footer (Live vs Polling).

7. **Can't add channels**
   - Symptoms: Clicking "Add" in the Catalog shows an error toast
   - Steps: Sign out and sign back in to refresh your session. If the error persists, report a bug from the Contact Us section — diagnostics will help us identify the issue.

8. **RSS feeds show no articles**
   - Symptoms: Feed added but shows "No articles right now"
   - Steps: Check the feed's health indicator in Settings (green = healthy, amber = stale, red = failing). Some feeds may be temporarily down. Try adding a different feed to verify your connection works.

9. **Subscription not reflecting after purchase**
   - Symptoms: Completed checkout but app still shows "Free" tier limits
   - Steps: The app checks subscription status every 5 minutes and on window focus. Try clicking away from and back to the app window. If it persists, sign out and sign back in — the fresh token will include your updated role.

10. **App feels slow or unresponsive**
    - Symptoms: UI lag, delayed responses to clicks, high CPU usage
    - Steps: Try reducing ticker rows (Settings > Ticker). Reduce the number of tracked symbols/feeds. Check System Monitor widget for CPU/memory usage. Restart the app if it's been running for a long time.

---

## Section 4: Feature Guides

A grid of cards showing all channels and widgets with their existing `SourceInfo` content. Each card shows the source's icon (colored with its hex accent), name, and `info.about` text. Clicking a card expands or drills into a detail view showing:

- **About** — The `info.about` paragraph
- **How to use** — The `info.usage` array rendered as a bulleted list
- **Tier requirements** — What plan is needed (from `CHANNEL_TIERS` in marketplace.ts)

Content is pulled dynamically from `getAllChannels()` and `getAllWidgets()` registries — no duplication.

Layout: 2-column card grid for the list, full-width detail view when expanded.

---

## Section 5: Account & Billing

A curated FAQ-style list of billing-specific topics, plus quick-action links.

### Quick Actions (top of section)

- **Manage Subscription** — Opens Stripe Customer Portal via `POST /users/me/subscription/portal` (same as Settings > Account)
- **View Plans** — Opens `https://myscrollr.com/uplink` in system browser

### Billing FAQ Items

1. **How do I upgrade my plan?** — Open the Catalog or Settings > Account and click "Upgrade". You'll be directed to our website to complete checkout.
2. **How do I cancel my subscription?** — Go to Settings > Account > Manage Subscription. Paid subscriptions cancel at the end of the billing period. Trials cancel immediately.
3. **What happens when my trial ends?** — Your card is charged automatically at the plan rate you selected. You'll get Ultimate access during the trial regardless of the plan you chose.
4. **Can I change my plan?** — Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period.
5. **How do I update my payment method?** — Click "Manage Subscription" above to open the Stripe billing portal where you can update your card.
6. **I was charged incorrectly** — Contact us using the Contact form below with your account email and we'll investigate.

---

## Section 6: Contact Us (Unified Contact Form)

Replaces the current `BugReportForm.tsx` with a unified form that handles three categories.

### Category Picker

Three pill buttons at the top (same style as direction filter pills in finance feed):

- **Bug Report** (default) — `Bug` icon
- **Feature Request** — `Lightbulb` icon
- **General Feedback** — `MessageSquare` icon

### Category-Specific Fields

**Bug Report** (preserves all current BugReportForm fields):
- What were you trying to do? (textarea, required)
- What went wrong? (textarea, required)
- What did you expect? (textarea, optional)
- Frequency pills: Always / Sometimes / First time
- File attachments (max 5, 10MB each)
- System diagnostics (auto-collected, collapsible preview)

**Feature Request:**
- What feature would you like? (textarea, required)
- Why is this important to you? (textarea, optional)
- Priority: Nice to have / Important / Critical (pill buttons)

**General Feedback:**
- Your feedback (textarea, required)
- Category hint text: "Share suggestions, thoughts, or anything else"

### Shared Fields (all categories)
- Email (pre-filled from JWT, shown only if not authenticated)
- Name (pre-filled from JWT)
- Submit button with 60-second cooldown
- All submit to `POST /support/ticket` with a `category` field added to the payload

### Backend Changes

Modify `api/core/support.go`:
- Add `Category string` to `SupportTicketRequest` (values: `"bug"`, `"feature"`, `"feedback"`)
- Use different OS Ticket topic IDs per category (configurable via env: `OSTICKET_TOPIC_ID_BUG`, `OSTICKET_TOPIC_ID_FEATURE`, `OSTICKET_TOPIC_ID_FEEDBACK`)
- Adjust HTML message body template based on category
- Subject prefix based on category: "Bug Report: ...", "Feature Request: ...", "Feedback: ..."

---

## File Structure

### New Files

```
desktop/src/components/support/
  support-content.ts          — Static content: FAQ items, troubleshooting articles, getting started steps, billing FAQ
  SupportHub.tsx              — Hub view: search bar + category card grid + search results
  GettingStartedSection.tsx   — Step walkthrough
  FAQSection.tsx              — Expandable Q&A accordion
  TroubleshootingSection.tsx  — Problem-solution cards
  FeatureGuidesSection.tsx    — Channel/widget info from manifests
  BillingHelpSection.tsx      — Billing FAQ + portal quick actions
  ContactForm.tsx             — Unified contact form (Bug/Feature/Feedback)
```

### Modified Files

```
desktop/src/routes/support.tsx              — Replace with hub + drill-down routing
desktop/src/components/support/BugReportForm.tsx — DELETE (replaced by ContactForm.tsx)
api/core/support.go                         — Add category field + per-category topic IDs
k8s/configmap-core.yaml                     — Add OSTICKET_TOPIC_ID_FEATURE, OSTICKET_TOPIC_ID_FEEDBACK
```

### Unchanged Files

- `desktop/src/components/Sidebar.tsx` — Already has Support nav item
- `desktop/src-tauri/src/tray.rs` — Already has "Report a Bug" menu item
- `desktop/src-tauri/src/commands/diagnostics.rs` — Reused as-is by ContactForm

---

## Styling

- Follows existing dark-first design system with CSS custom properties
- Minimum contrast: `text-fg-3` for muted text, `border-edge/30` for borders
- Category cards: `bg-surface-2 border border-edge/30 rounded-lg` with hover state
- Expandable items (FAQ, troubleshooting): chevron rotation animation via `clsx`
- Search input: matches existing pattern from channel filter inputs
- Section headers: back arrow + section title + icon, consistent with SourcePageLayout breadcrumbs
- No new dependencies required

---

## Not In Scope

- Live chat or real-time support
- Ticket status tracking / "My tickets" view
- Video tutorials or embedded media
- Community forum or discussion
- Contextual help overlays (react-joyride product tour is a separate project)
- Content management system or API-served content
