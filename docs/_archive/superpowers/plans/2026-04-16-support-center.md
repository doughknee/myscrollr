# Support Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the minimal bug-report support page into a full-featured support center with FAQ, troubleshooting, getting started guide, feature guides, billing help, and a unified contact form.

**Architecture:** Hub-and-drill-down layout at the `/support` route. A `SupportHub` component renders a search bar and 6 category cards. Local state (`activeSection`) controls which section sub-component is displayed. All content is hardcoded in a TypeScript data file. The existing `BugReportForm` is replaced by a unified `ContactForm` with category-specific fields (Bug Report / Feature Request / Feedback). Feature guides pull `SourceInfo` content from channel/widget manifests dynamically.

**Tech Stack:** React 19, TanStack Router, Lucide icons, clsx, sonner (toast), Tauri IPC (`invoke`), `@tauri-apps/plugin-http` (`fetch`), `@tauri-apps/plugin-shell` (`open`)

**Spec:** `docs/superpowers/specs/2026-04-16-support-center-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `desktop/src/components/support/support-content.ts` | All static content: FAQ items, troubleshooting articles, getting started steps, billing FAQ |
| Create | `desktop/src/components/support/SupportHub.tsx` | Hub view: search bar, category card grid, search results overlay |
| Create | `desktop/src/components/support/GettingStartedSection.tsx` | 6-step walkthrough |
| Create | `desktop/src/components/support/FAQSection.tsx` | Expandable Q&A accordion |
| Create | `desktop/src/components/support/TroubleshootingSection.tsx` | Problem-solution cards |
| Create | `desktop/src/components/support/FeatureGuidesSection.tsx` | Channel/widget info from manifests |
| Create | `desktop/src/components/support/BillingHelpSection.tsx` | Billing FAQ + quick-action portal/plans links |
| Create | `desktop/src/components/support/ContactForm.tsx` | Unified contact form replacing BugReportForm |
| Modify | `desktop/src/routes/support.tsx` | Rewrite to render SupportHub + drill-down sections |
| Delete | `desktop/src/components/support/BugReportForm.tsx` | Replaced by ContactForm |
| Modify | `api/core/support.go` | Add `Category` field, per-category topic IDs, adjusted HTML body |
| Modify | `k8s/configmap-core.yaml` | Add `OSTICKET_TOPIC_ID_FEATURE`, `OSTICKET_TOPIC_ID_FEEDBACK` |

---

### Task 1: Static Content Data File

**Files:**
- Create: `desktop/src/components/support/support-content.ts`

This file exports all static help content used by the section components. Centralizing it here keeps the UI components clean and makes content easy to update.

- [ ] **Step 1: Create the content data file**

```typescript
// desktop/src/components/support/support-content.ts

// ── FAQ Items ─────────────────────────────────────────────────────

export interface FAQItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FAQItem[] = [
  // From website (adapted for desktop context)
  {
    question: "Is Scrollr free?",
    answer:
      "Yes. The free tier gives you real-time data across all four channels with generous limits and no ads. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.",
  },
  {
    question: "Does it affect my computer's performance?",
    answer:
      "Not noticeably. All data flows through a single lightweight connection. The ticker uses minimal CPU and memory. You can check resource usage anytime with the built-in System Monitor widget.",
  },
  {
    question: "Is my data private?",
    answer:
      "Scrollr contains zero analytics, zero tracking pixels, and zero telemetry. Your channel configurations and preferences are stored on your device. The only server-side data is your account profile and subscription status.",
  },
  {
    question: "What platforms are supported?",
    answer:
      "Scrollr runs natively on macOS (Apple Silicon and Intel), Windows (x64), and Linux (x64). Each platform gets a dedicated build optimized for that OS.",
  },
  {
    question: "Do I need an account?",
    answer:
      "You can browse widgets and explore the app without signing in. An account is needed to add channels (Finance, Sports, News, Fantasy) and to sync your setup.",
  },
  {
    question: "What data does Scrollr show?",
    answer:
      "Four channels: live stock and crypto prices (Finance), scores across 20+ leagues (Sports), articles from RSS feeds (News), and Yahoo Fantasy Sports leagues (Fantasy). Plus utility widgets for weather, clocks, system monitoring, uptime, and GitHub Actions.",
  },
  {
    question: "Can I customize the feed?",
    answer:
      "Extensively. Position the ticker at the top or bottom of your screen, adjust rows and density, pin favorite sources to the sidebar, filter and sort within each channel, and toggle individual data points on or off in each channel's Display settings.",
  },
  {
    question: "Is Scrollr open source?",
    answer:
      "Yes. Every line of code is publicly available on GitHub under the GNU AGPL v3.0 license. You can inspect, fork, or contribute.",
  },
  // Desktop-specific
  {
    question: "How do I update the app?",
    answer:
      "Scrollr checks for updates automatically on launch. When an update is available, you'll see a notification prompting you to install. Updates are downloaded in the background and applied on next restart.",
  },
  {
    question: "Can I use Scrollr on multiple monitors?",
    answer:
      "Yes. The ticker automatically spans the full width of your primary monitor. You can move it between monitors by changing the ticker position in Settings > Ticker.",
  },
  {
    question: "How does live data work vs. polling?",
    answer:
      "Free and Uplink tiers use polling — the app fetches fresh data at regular intervals (60s for free, 30s for Uplink, 10s for Pro). Uplink Ultimate uses a persistent SSE connection for instant live updates as data changes on the server. You can see your current mode (Live or Polling) in the sidebar footer.",
  },
  {
    question: "What's the difference between Uplink tiers?",
    answer:
      "Free: 5 symbols, 1 feed, 1 league. Uplink: 25 symbols, 25 feeds, 8 leagues, 30s polling. Uplink Pro: 75 symbols, 100 feeds, 20 leagues, 10s polling. Uplink Ultimate: unlimited everything, live streaming via SSE, priority support.",
  },
];

// ── Troubleshooting Articles ──────────────────────────────────────

export interface TroubleshootingArticle {
  title: string;
  symptoms: string[];
  steps: string[];
}

export const TROUBLESHOOTING_ARTICLES: TroubleshootingArticle[] = [
  {
    title: "Sign-in fails or shows \"Sign-in failed\"",
    symptoms: [
      "Browser opens but returns to app with error toast",
      "Browser shows \"authorization successful\" but app shows failure",
    ],
    steps: [
      "Check your internet connection.",
      "Try signing out (Settings > Account) then signing in again.",
      "If the browser shows an error page, close it and retry from the app.",
      "If the problem persists, report a bug from the Contact Us section — diagnostics will help us investigate.",
    ],
  },
  {
    title: "Data not loading / feed shows empty",
    symptoms: [
      "Channel added but shows \"No data right now\"",
      "Ticker shows empty slots where data should be",
    ],
    steps: [
      "Open the channel's Settings tab and verify items are configured (symbols, leagues, or feeds).",
      "Check that you're signed in (Settings > Account).",
      "Try switching away from and back to the feed tab.",
      "Check your internet connection.",
    ],
  },
  {
    title: "Ticker not visible",
    symptoms: [
      "Ticker bar disappeared from the screen edge",
      "Only the main window shows",
    ],
    steps: [
      "Press Ctrl+T (Cmd+T on macOS) to toggle ticker visibility.",
      "Or go to Settings > General and enable the \"Show Ticker\" toggle.",
      "Right-click the system tray icon and check \"Toggle Ticker\".",
    ],
  },
  {
    title: "Finance prices not updating",
    symptoms: [
      "Stock prices appear frozen or stale",
      "\"Last updated\" time doesn't change",
    ],
    steps: [
      "The finance data service reconnects automatically after brief disconnections. Wait 2-5 minutes.",
      "Check your internet connection.",
      "If persistent, try restarting the app.",
    ],
  },
  {
    title: "Yahoo Fantasy connect fails",
    symptoms: [
      "Clicking \"Connect Yahoo\" opens browser but nothing happens",
      "Returns an error after authorizing",
    ],
    steps: [
      "Yahoo's OAuth can be intermittent. Wait 30 seconds and try again.",
      "Make sure you're authorizing the correct Yahoo account.",
      "If you see \"invalid redirect URI\", this is a known Yahoo issue — retry usually works.",
    ],
  },
  {
    title: "Sports scores appear stale",
    symptoms: [
      "Scores don't match live TV",
      "Yesterday's games still showing as live",
    ],
    steps: [
      "Scores update via polling based on your plan tier. Free: 60s, Uplink: 30s, Pro: 10s, Ultimate: live.",
      "Check your current delivery mode in the sidebar footer (Live vs Polling).",
      "Try switching to a different tab and back.",
    ],
  },
  {
    title: "Can't add channels",
    symptoms: [
      "Clicking \"Add\" in the Catalog shows an error toast",
      "\"Failed to create channel\" message",
    ],
    steps: [
      "Sign out and sign back in to refresh your session.",
      "If the error persists, report a bug from the Contact Us section — diagnostics will help us identify the issue.",
    ],
  },
  {
    title: "RSS feeds show no articles",
    symptoms: [
      "Feed added but shows \"No articles right now\"",
      "Some feeds show data but others don't",
    ],
    steps: [
      "Check the feed's health indicator in Settings — green is healthy, amber is stale, red is failing.",
      "Some feeds may be temporarily down. Try adding a different feed to verify your connection works.",
      "Custom feeds must be valid RSS or Atom URLs.",
    ],
  },
  {
    title: "Subscription not reflecting after purchase",
    symptoms: [
      "Completed checkout but app still shows Free tier limits",
      "Tier says \"free\" after upgrading",
    ],
    steps: [
      "The app checks subscription status every 5 minutes and on window focus. Click away from and back to the app window.",
      "If it persists, sign out and sign back in — the fresh token will include your updated role.",
    ],
  },
  {
    title: "App feels slow or unresponsive",
    symptoms: [
      "UI lag when clicking buttons",
      "High CPU usage from Scrollr",
    ],
    steps: [
      "Try reducing ticker rows in Settings > Ticker.",
      "Reduce the number of tracked symbols, feeds, or leagues.",
      "Check the System Monitor widget for overall CPU/memory usage.",
      "Restart the app if it has been running for a long time.",
    ],
  },
];

// ── Getting Started Steps ─────────────────────────────────────────

export interface GettingStartedStep {
  title: string;
  description: string;
  iconName: string; // Lucide icon name — resolved by the component
}

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    title: "Sign In",
    iconName: "LogIn",
    description:
      "Create an account or sign in to sync your channels and settings. Free accounts get full access to all features with generous limits.",
  },
  {
    title: "Add Channels",
    iconName: "LayoutGrid",
    description:
      "Open the Catalog from the sidebar to browse available data sources. Add Finance for stock prices, Sports for live scores, News for RSS feeds, or Fantasy for Yahoo leagues.",
  },
  {
    title: "Configure Your Feeds",
    iconName: "Settings",
    description:
      "Each channel has a Settings tab where you pick what to track. Add stock symbols, select sports leagues, subscribe to news feeds, or connect your Yahoo account.",
  },
  {
    title: "Customize the Ticker",
    iconName: "Monitor",
    description:
      "The ticker bar runs across your screen showing live data. Adjust its position (top/bottom), size (compact/comfort), and number of rows in Settings > Ticker.",
  },
  {
    title: "Explore Widgets",
    iconName: "Puzzle",
    description:
      "Add utility widgets like Weather, Clock, System Monitor, Uptime Kuma, or GitHub Actions from the Catalog. Widgets appear on your ticker alongside channel data.",
  },
  {
    title: "Upgrade Your Plan",
    iconName: "Zap",
    description:
      "Free accounts have limits on symbols, feeds, and leagues. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.",
  },
];

// ── Billing FAQ ───────────────────────────────────────────────────

export const BILLING_FAQ: FAQItem[] = [
  {
    question: "How do I upgrade my plan?",
    answer:
      "Open the Catalog or go to Settings > Account and click \"Upgrade\". You'll be directed to our website to complete checkout with Stripe.",
  },
  {
    question: "How do I cancel my subscription?",
    answer:
      "Go to Settings > Account and click \"Manage Subscription\". Paid subscriptions cancel at the end of the billing period so you keep access until then. Trials cancel immediately.",
  },
  {
    question: "What happens when my trial ends?",
    answer:
      "Your card is charged automatically at the plan rate you selected during checkout. During the trial, you get full Uplink Ultimate access regardless of which plan you chose.",
  },
  {
    question: "Can I change my plan?",
    answer:
      "Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period.",
  },
  {
    question: "How do I update my payment method?",
    answer:
      "Click \"Manage Subscription\" in Settings > Account to open the Stripe billing portal where you can update your card.",
  },
  {
    question: "I was charged incorrectly",
    answer:
      "Contact us using the Contact form with your account email and a description of the issue. We'll investigate and resolve it promptly.",
  },
];

// ── Search Index ──────────────────────────────────────────────────

export type SearchResultSection =
  | "faq"
  | "troubleshooting"
  | "getting-started"
  | "billing"
  | "guides";

export interface SearchResult {
  section: SearchResultSection;
  sectionLabel: string;
  title: string;
  preview: string;
  /** Index into the source array for highlighting/expanding on drill-in */
  index: number;
}

/** Build a flat searchable index from all content. Called once at module level. */
function buildSearchIndex(): Array<{
  text: string;
  result: SearchResult;
}> {
  const entries: Array<{ text: string; result: SearchResult }> = [];

  FAQ_ITEMS.forEach((item, i) => {
    entries.push({
      text: `${item.question} ${item.answer}`.toLowerCase(),
      result: {
        section: "faq",
        sectionLabel: "FAQ",
        title: item.question,
        preview: item.answer.slice(0, 120),
        index: i,
      },
    });
  });

  TROUBLESHOOTING_ARTICLES.forEach((item, i) => {
    entries.push({
      text:
        `${item.title} ${item.symptoms.join(" ")} ${item.steps.join(" ")}`.toLowerCase(),
      result: {
        section: "troubleshooting",
        sectionLabel: "Troubleshooting",
        title: item.title,
        preview: item.symptoms[0] ?? "",
        index: i,
      },
    });
  });

  GETTING_STARTED_STEPS.forEach((item, i) => {
    entries.push({
      text: `${item.title} ${item.description}`.toLowerCase(),
      result: {
        section: "getting-started",
        sectionLabel: "Getting Started",
        title: item.title,
        preview: item.description.slice(0, 120),
        index: i,
      },
    });
  });

  BILLING_FAQ.forEach((item, i) => {
    entries.push({
      text: `${item.question} ${item.answer}`.toLowerCase(),
      result: {
        section: "billing",
        sectionLabel: "Account & Billing",
        title: item.question,
        preview: item.answer.slice(0, 120),
        index: i,
      },
    });
  });

  return entries;
}

const SEARCH_INDEX = buildSearchIndex();

/**
 * Search all support content. Returns matching results with section info.
 * Feature guides are NOT included here — they are searched separately
 * from manifest data in FeatureGuidesSection.
 */
export function searchSupportContent(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return SEARCH_INDEX.filter((entry) => entry.text.includes(q)).map(
    (entry) => entry.result,
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit` from `desktop/`

Expected: No errors (file is pure data, no JSX)

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/support/support-content.ts
git commit -m "feat(desktop): add support center content data file"
```

---

### Task 2: Backend — Add Category Support to Ticket Endpoint

**Files:**
- Modify: `api/core/support.go:20-30` (request type), lines 124-178 (payload construction)
- Modify: `k8s/configmap-core.yaml:34-36` (add topic IDs)

- [ ] **Step 1: Add Category field to request type and adjust handler**

In `api/core/support.go`, add `Category string` to `SupportTicketRequest`:

```go
type SupportTicketRequest struct {
	Category         string                 `json:"category"` // "bug", "feature", "feedback"
	Subject          string                 `json:"subject"`
	Description      string                 `json:"description"`
	WhatWentWrong    string                 `json:"what_went_wrong"`
	ExpectedBehavior string                 `json:"expected_behavior,omitempty"`
	Frequency        string                 `json:"frequency"`
	Priority         string                 `json:"priority,omitempty"` // for feature requests
	Diagnostics      map[string]interface{} `json:"diagnostics,omitempty"`
	Attachments      []TicketAttachment     `json:"attachments,omitempty"`
	Email            string                 `json:"email,omitempty"`
	Name             string                 `json:"name,omitempty"`
}
```

Update validation (around line 100): accept `WhatWentWrong` OR `Description` as required (feature requests and feedback use `Description` only):

```go
if strings.TrimSpace(req.WhatWentWrong) == "" && strings.TrimSpace(req.Description) == "" {
    return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
        Status: "error",
        Error:  "Either 'what_went_wrong' or 'description' is required",
    })
}
```

Update subject construction to use category prefix:

```go
var subjectPrefix string
switch req.Category {
case "feature":
    subjectPrefix = "Feature Request: "
case "feedback":
    subjectPrefix = "Feedback: "
default:
    subjectPrefix = "Bug Report: "
}
if req.Subject != "" {
    subject = req.Subject
} else {
    content := req.WhatWentWrong
    if content == "" {
        content = req.Description
    }
    if len(content) > 80 {
        subject = subjectPrefix + content[:80] + "..."
    } else {
        subject = subjectPrefix + content
    }
}
```

Update topic ID resolution:

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
}
```

Update HTML body construction to be category-aware:

```go
var body strings.Builder
switch req.Category {
case "feature":
    body.WriteString("<h3>Feature Request</h3>")
    body.WriteString("<p>" + escapeHTML(req.Description) + "</p>")
    if req.Priority != "" {
        body.WriteString("<p><strong>Priority:</strong> " + escapeHTML(req.Priority) + "</p>")
    }
case "feedback":
    body.WriteString("<h3>Feedback</h3>")
    body.WriteString("<p>" + escapeHTML(req.Description) + "</p>")
default: // bug
    if req.Description != "" {
        body.WriteString("<h3>What were you trying to do?</h3>")
        body.WriteString("<p>" + escapeHTML(req.Description) + "</p>")
    }
    body.WriteString("<h3>What went wrong?</h3>")
    body.WriteString("<p>" + escapeHTML(req.WhatWentWrong) + "</p>")
    if req.ExpectedBehavior != "" {
        body.WriteString("<h3>What did you expect?</h3>")
        body.WriteString("<p>" + escapeHTML(req.ExpectedBehavior) + "</p>")
    }
    if req.Frequency != "" {
        body.WriteString("<p><strong>Frequency:</strong> " + escapeHTML(req.Frequency) + "</p>")
    }
}
// Diagnostics block (all categories)
if req.Diagnostics != nil { ... } // existing code
```

- [ ] **Step 2: Update configmap**

In `k8s/configmap-core.yaml`, add two new entries after `OSTICKET_TOPIC_ID`:

```yaml
  OSTICKET_TOPIC_ID: "12"
  OSTICKET_TOPIC_ID_FEATURE: "12"
  OSTICKET_TOPIC_ID_FEEDBACK: "12"
```

(All set to "12" for now — the user can create separate OS Ticket topics later and update the values.)

- [ ] **Step 3: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add api/core/support.go k8s/configmap-core.yaml
git commit -m "feat(api): add category support to ticket endpoint (bug/feature/feedback)"
```

---

### Task 3: SupportHub Component + Route Rewrite

**Files:**
- Create: `desktop/src/components/support/SupportHub.tsx`
- Modify: `desktop/src/routes/support.tsx`

The hub is the landing view with search bar and 6 category cards. It manages the `activeSection` state and renders the appropriate section component.

- [ ] **Step 1: Create SupportHub**

Create `desktop/src/components/support/SupportHub.tsx`. This component:

- Renders a header with `LifeBuoy` icon, "Support Center" title, "Get help, find answers, and contact us" subtitle
- A full-width search input
- When search is active (query non-empty): renders search results from `searchSupportContent()` plus manifest matches
- When search is inactive: renders a 2x3 grid of category cards
- Each card: icon (accent-colored), bold label, muted description. Clickable, calls `onSelectSection(sectionId)`
- Cards: Getting Started (`Rocket`), FAQ (`HelpCircle`), Troubleshooting (`Wrench`), Feature Guides (`BookOpen`), Account & Billing (`CreditCard`), Contact Us (`MessageCircle`)

Props: `{ onSelectSection: (id: SectionId) => void }`

Search results: each result shows a section badge (colored pill), title, and preview text. Clicking navigates to that section.

For feature guide search results, search across `getAllChannels()` and `getAllWidgets()` manifest `info.about` and `info.usage` text.

- [ ] **Step 2: Rewrite the route file**

Replace `desktop/src/routes/support.tsx` to use a state machine:

```typescript
type SectionId =
  | "getting-started"
  | "faq"
  | "troubleshooting"
  | "guides"
  | "billing"
  | "contact";

function SupportPage() {
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);

  if (!activeSection) {
    return <SupportHub onSelectSection={setActiveSection} />;
  }

  // Section header with back button
  return (
    <div>
      <button onClick={() => setActiveSection(null)}>← Back to Support</button>
      {activeSection === "getting-started" && <GettingStartedSection />}
      {activeSection === "faq" && <FAQSection />}
      {activeSection === "troubleshooting" && <TroubleshootingSection />}
      {activeSection === "guides" && <FeatureGuidesSection />}
      {activeSection === "billing" && <BillingHelpSection />}
      {activeSection === "contact" && <ContactForm onBack={() => setActiveSection(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` from `desktop/`

Expected: Build passes (section components don't exist yet — use lazy imports or stub them)

Note: You will need to either create stub files for the section components OR use dynamic imports with fallbacks. The simplest approach: create all section files as minimal stubs first, then fill them in subsequent tasks. Alternatively, comment out the section renders and only render the hub — uncomment as each section is built.

Recommended: Create minimal stub exports for each section component:

```typescript
// desktop/src/components/support/GettingStartedSection.tsx (stub)
export default function GettingStartedSection() {
  return <div className="p-6 text-fg-3 text-sm">Getting Started — coming soon</div>;
}
```

Do this for all 6 section components so the route compiles.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/support/SupportHub.tsx desktop/src/routes/support.tsx
git add desktop/src/components/support/GettingStartedSection.tsx
git add desktop/src/components/support/FAQSection.tsx
git add desktop/src/components/support/TroubleshootingSection.tsx
git add desktop/src/components/support/FeatureGuidesSection.tsx
git add desktop/src/components/support/BillingHelpSection.tsx
git add desktop/src/components/support/ContactForm.tsx
git commit -m "feat(desktop): add support center hub with search and category cards"
```

---

### Task 4: Section Components (FAQ + Troubleshooting + Getting Started)

**Files:**
- Modify: `desktop/src/components/support/FAQSection.tsx` (replace stub)
- Modify: `desktop/src/components/support/TroubleshootingSection.tsx` (replace stub)
- Modify: `desktop/src/components/support/GettingStartedSection.tsx` (replace stub)

- [ ] **Step 1: Implement FAQSection**

Expandable accordion. Each item: question (always visible, clickable), answer (expands with chevron rotation). Local state: `Set<number>` of expanded indices.

Import `FAQ_ITEMS` from `./support-content`. Map items to clickable rows with `ChevronDown` icon that rotates 180deg when expanded. Answer text with `text-fg-3 text-sm` styling. Expand/collapse via `clsx` and `max-h-0 overflow-hidden` to `max-h-[500px]` transition.

- [ ] **Step 2: Implement TroubleshootingSection**

Collapsible problem cards. Each card: title (always visible), symptoms list + solution steps (expand on click). Similar pattern to FAQ but with two sub-sections per card.

Import `TROUBLESHOOTING_ARTICLES` from `./support-content`. Render each article as a card with `border border-edge/30 rounded-lg`. Title row is clickable with chevron. Expanded state shows:
- "Symptoms" label + bulleted list of symptoms in `text-fg-3`
- "Steps to fix" label + numbered list of steps

- [ ] **Step 3: Implement GettingStartedSection**

Vertical step list. Each step: number badge (1-6), icon, title, description.

Import `GETTING_STARTED_STEPS` from `./support-content`. Map `iconName` strings to Lucide icon components using a lookup object:

```typescript
import { LogIn, LayoutGrid, Settings, Monitor, Puzzle, Zap } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  LogIn, LayoutGrid, Settings, Monitor, Puzzle, Zap,
};
```

Each step renders as a horizontal row: circular number badge (`w-8 h-8 rounded-full bg-accent/15 text-accent font-bold text-sm flex items-center justify-center`), icon (accent-colored, 18px), title (`font-semibold text-fg`), description (`text-fg-3 text-sm`).

- [ ] **Step 4: Verify build**

Run: `npm run build` from `desktop/`

Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/support/FAQSection.tsx
git add desktop/src/components/support/TroubleshootingSection.tsx
git add desktop/src/components/support/GettingStartedSection.tsx
git commit -m "feat(desktop): implement FAQ, troubleshooting, and getting started sections"
```

---

### Task 5: Section Components (Feature Guides + Billing Help)

**Files:**
- Modify: `desktop/src/components/support/FeatureGuidesSection.tsx` (replace stub)
- Modify: `desktop/src/components/support/BillingHelpSection.tsx` (replace stub)

- [ ] **Step 1: Implement FeatureGuidesSection**

Pulls content dynamically from manifests. Two sections: Channels and Widgets.

```typescript
import { getAllChannels } from "../../channels/registry";
import { getAllWidgets } from "../../widgets/registry";
```

Renders a 2-column card grid. Each card shows:
- Source icon (colored with `style={{ color: manifest.hex }}`, 24px)
- Name (bold)
- Description (from `manifest.description`)
- Click to expand detail view with:
  - "About" section: `manifest.info.about`
  - "How to use" section: `manifest.info.usage` as bulleted list
  - For channels: tier requirement badge (from a local `CHANNEL_TIERS` map: finance/sports/rss = "Free", fantasy = "Uplink")

State: `expandedId: string | null`. Clicking a card sets it; clicking again or clicking another clears it.

- [ ] **Step 2: Implement BillingHelpSection**

Two parts: quick actions at top, billing FAQ below.

Quick actions: two buttons in a row:
- "Manage Subscription" — calls `authFetch("/users/me/subscription/portal", { method: "POST" })`, then `open(response.url)` via Tauri shell
- "View Plans" — calls `open("https://myscrollr.com/uplink")`

Both styled as bordered action cards with icons (`Settings` and `ExternalLink`).

Below: import `BILLING_FAQ` from `./support-content`. Render as expandable accordion (same pattern as FAQSection). Can extract a shared `Accordion` sub-component or inline it.

Note: The "Manage Subscription" button requires authentication. If `!isAuthenticated()`, show a "Sign in to manage your subscription" message instead.

- [ ] **Step 3: Verify build**

Run: `npm run build` from `desktop/`

Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/support/FeatureGuidesSection.tsx
git add desktop/src/components/support/BillingHelpSection.tsx
git commit -m "feat(desktop): implement feature guides and billing help sections"
```

---

### Task 6: ContactForm (Unified, Replacing BugReportForm)

**Files:**
- Modify: `desktop/src/components/support/ContactForm.tsx` (replace stub)
- Delete: `desktop/src/components/support/BugReportForm.tsx`

- [ ] **Step 1: Implement ContactForm**

This is an evolution of the existing `BugReportForm` with category support. Reuse the same patterns but add a category picker at the top.

Props: `{ onBack: () => void }`

Category state: `"bug" | "feature" | "feedback"` (default `"bug"`)

**Category picker:** Three pill buttons matching the direction filter style from the finance feed tab:
- Bug Report (`Bug` icon)
- Feature Request (`Lightbulb` icon)
- General Feedback (`MessageSquare` icon)

Active pill: `bg-accent/15 text-accent border-accent/30`. Inactive: `text-fg-3 border-edge/30`.

**Bug Report fields** (same as current BugReportForm):
- What were you trying to do? (textarea, required)
- What went wrong? (textarea, required)
- What did you expect? (textarea, optional)
- Frequency pills: Always / Sometimes / First time
- File attachments (max 5, 10MB)
- System diagnostics (auto-collected, collapsible)

**Feature Request fields:**
- What feature would you like? (textarea, required — maps to `description` in payload)
- Why is this important to you? (textarea, optional — maps to `expected_behavior`)
- Priority pills: Nice to have / Important / Critical

**General Feedback fields:**
- Your feedback (textarea, required — maps to `description` in payload)
- Hint text below: "Share suggestions, thoughts, or anything else"

**Shared across all:**
- Email pre-fill from JWT (show input only if not authenticated)
- Submit to `POST /support/ticket` with `category` field added
- 60-second cooldown after success
- Diagnostics always collected (but only shown collapsible for bug reports)

Payload shape for each category:

Bug: `{ category: "bug", description, what_went_wrong, expected_behavior, frequency, diagnostics, attachments, email, name }`

Feature: `{ category: "feature", description, priority, email, name }`

Feedback: `{ category: "feedback", description, email, name }`

- [ ] **Step 2: Delete BugReportForm**

```bash
rm desktop/src/components/support/BugReportForm.tsx
```

Verify no other files import it (the old `support.tsx` route imported it, but that was rewritten in Task 3).

- [ ] **Step 3: Verify build**

Run: `npm run build` from `desktop/`

Expected: Clean build, no broken imports

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/support/ContactForm.tsx
git rm desktop/src/components/support/BugReportForm.tsx
git commit -m "feat(desktop): add unified contact form with bug/feature/feedback categories"
```

---

### Task 7: Manual Testing + Polish

**Files:**
- Any files from Tasks 1-6 that need fixes

- [ ] **Step 1: Run tauri:dev and test all sections**

Test checklist:
1. Hub loads with search bar and 6 cards
2. Search filters across all content types
3. Clicking a search result drills into the correct section
4. Getting Started shows 6 numbered steps
5. FAQ expands/collapses items
6. Troubleshooting expands/collapses with symptoms + steps
7. Feature Guides shows all 4 channels + 5 widgets with expand
8. Billing Help shows quick actions + FAQ
9. Contact form: category picker switches fields
10. Bug report submits to OS Ticket (retest with existing flow)
11. Feature request submits with correct subject prefix
12. Feedback submits with correct subject prefix
13. Back button from every section returns to hub
14. Tray "Report a Bug" navigates to /support

- [ ] **Step 2: Contrast audit**

Apply the established contrast rules:
- `text-fg-3` minimum for muted text (never `fg-4/50`)
- `border-edge/30` minimum for borders
- `focus:border-accent/60` for focus rings
- `text-[9px]` minimum for smallest text
- `bg-accent/10` minimum for tinted backgrounds

- [ ] **Step 3: Verify build**

Run: `npm run build` from `desktop/`

Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(desktop): support center polish and contrast fixes"
```
