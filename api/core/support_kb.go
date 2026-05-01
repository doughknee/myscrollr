package core

// SupportKnowledgeBase is the canonical product reference passed to the
// AI triage prompt on every ticket. Keep this AUTHORITATIVE — Claude
// will treat anything stated here as ground truth and may parrot it
// verbatim in user-facing replies. If a number, name, or behavior in
// this file is wrong, AI replies will be wrong.
//
// Editing rules (for whoever owns this file next):
//
//  1. Tier names are CANONICAL: "Free", "Uplink", "Uplink Pro",
//     "Uplink Ultimate", "Super User". Never use "Premium", "Plus",
//     "Pro Max", or any other variant.
//  2. List ALL FOUR tier-tiers (Free, Uplink, Pro, Ultimate) any time
//     pricing or limits come up — do NOT skip Uplink Ultimate. The AI
//     has skipped it in past replies because it inferred "Pro" was the
//     top tier from incomplete context. The KB is now explicit.
//  3. Never quote prices the AI wouldn't be confident about. If pricing
//     drift is a concern, point users at /uplink on the marketing site
//     instead of citing dollar amounts directly.
//  4. Channel-specific troubleshooting goes in its own section so the
//     AI can quote the relevant block when triaging that category.
//  5. When you add new product features, add them HERE in the same edit
//     as the feature ships. The KB drift between ship and update is
//     where wrong-answer replies come from.
//
// Size budget: keep this under ~6 KB to leave room for recent-ticket
// context + the user's actual ticket body in Claude's context window.
// At ~6 KB this is sent verbatim on every triage call (~thousands per
// month at scale); at 20 KB it would noticeably impact token cost.
//
// Last updated: 2026-05-01
func supportKnowledgeBase() string {
	return `# Scrollr Knowledge Base — authoritative reference for support replies

## Product overview
Scrollr is a desktop ticker application that streams real-time data
across the top of your screen. Channels: Finance (TwelveData), Sports
(api-sports.io), News (RSS), and Fantasy (Yahoo OAuth). Available for
macOS, Windows, and Linux. Current desktop version: v1.0.4 (April 2026).
Source code is publicly available on GitHub under AGPL-3.0; the
Scrollr-hosted infrastructure (auth, billing, channel APIs) is the
product users pay for.

## Tiers — canonical names + limits
There are FOUR paid tier-tiers and one early-access program tier.
ALWAYS list all four when discussing pricing or limits:

### Free
- 5 finance symbols
- 1 RSS feed
- 0 fantasy leagues
- 1 ticker row
- Polling-based updates (no real-time streaming)
- No multi-row customisation

### Uplink (entry paid tier)
- 25 finance symbols
- 25 RSS feeds (1 custom)
- 1 fantasy league
- 2 ticker rows
- Polling-based updates

### Uplink Pro
- 75 finance symbols
- 100 RSS feeds (3 custom)
- 3 fantasy leagues
- 3 ticker rows
- Polling-based updates

### Uplink Ultimate (top paid tier)
- Unlimited finance symbols
- Unlimited RSS feeds (10 custom)
- 10 fantasy leagues
- 3 ticker rows + per-row scroll customisation
- REAL-TIME SSE streaming (no polling — instant data)
- Priority support

### Super User (early-access program)
- Same caps as Uplink Ultimate (unlimited everything, real-time SSE,
  3 rows + customisation).
- Permanent and free for life as part of the early-access program.
- Granted by invite only via the Scrollr team.
- Not refundable, transferable, or convertible to monetary value
  (per the Super User Early Access Terms).

When users ask "what tier am I on" or "what do I get", refer them to
the Account page → Subscription card. When users ask "how do I upgrade"
or "what does X cost", point them at https://myscrollr.com/uplink for
the current pricing — don't quote dollar amounts in replies (pricing
shifts; the marketing page is the source of truth).

## Authentication & account management
- Auth provider: Logto (auth.myscrollr.com). Sign-in via email +
  password, Google OAuth, or magic-link invite.
- Username is IMMUTABLE — set once at sign-up, never editable. Tell
  users this directly when they ask.
- Display name + primary email ARE editable: Settings → Account on
  the desktop app, or myscrollr.com/account in the browser. Inline
  edit-in-place fields, save and the change propagates within ~30s.
- Password reset: Account page → "Send password reset email". Triggers
  a Logto-driven flow; user gets an email and resets via Logto's
  hosted page. We do not have an embedded "type new password" form
  by design — the Logto reset flow is the source of truth.
- Account deletion is website-only: myscrollr.com/account → Danger
  Zone → Delete Account. 30-day grace period during which the user can
  cancel via the same UI. Desktop intentionally does NOT have this
  affordance (avoids accidental clicks on a destructive action).
- Two-factor auth, passkeys, social-login linking: managed via Logto's
  hosted Account Center. The /account hub card "Security Node" links
  to it.

## Billing
- Stripe is the payment processor. Checkout flow for new subscriptions
  and the customer portal for changes are both at the Account page.
- Cancel: in-app on the website (account page → "Cancel Subscription").
  Desktop sends users to the Stripe portal — no in-app cancel on
  desktop by design.
- Refund policy: 7-day refund window for monthly + annual paid plans
  (per Refund Policy doc). Lifetime is non-refundable. Super User is
  free → not refundable.
- Trial: 7-day free trial for new paid plans. During trial the user
  has full Ultimate-tier access regardless of which plan they trial.
- Payment method updates / invoice history: Stripe portal → linked
  from "Manage Subscription" on the Account page.

## Channels — common issues by channel

### Finance
- Provider: TwelveData via WebSocket on Ultimate, polling on lower
  tiers. Crypto + stocks both supported.
- "Stocks not updating" → first check if the user is on a tier that
  supports the data they want. Free + Uplink + Pro use polling
  (intervals of 60-30-10 seconds respectively); Ultimate uses
  real-time SSE.
- Symbol limit hit: tell them which tier upgrade unblocks their use
  case (Pro for 75, Ultimate for unlimited).
- "AAPL missing" or specific symbol not present: TwelveData covers all
  major exchanges; if a specific niche symbol is missing, that's a
  TwelveData coverage gap and should be flagged as a feature request.

### Sports
- Provider: api-sports.io. Major leagues only (NFL, NBA, MLB, NHL,
  Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions
  League). College sports NOT supported as of April 2026.
- "Wrong score" → very rarely a real bug; usually api-sports.io is
  catching up. Ask user for the game ID + their local timestamp; we
  can look up the source.
- "Game missing" → confirm the league is supported (above list); if
  not, feature request.

### News (RSS)
- Pull-based polling against arbitrary RSS feeds. Default feeds curated
  by tier; custom feeds counted separately.
- "Feed broken" → diagnose by URL. Some feeds rotate URLs without
  redirecting. We log fetch errors in the channel service; if a feed
  has been failing for 24h+ we'll flag it for the user.
- Custom feed URL must be a valid RSS or Atom feed; HTML pages are
  not supported (we don't scrape).

### Fantasy
- Yahoo OAuth only. ESPN + Sleeper + CBS Fantasy NOT supported (most
  common feature request — flag as such).
- Connect: open the Fantasy channel page → "Connect Yahoo" → walk
  through OAuth in the browser. Leagues import automatically once
  connected. Token refreshed every ~30 days; if expired, the channel
  shows a "Reconnect" prompt.
- League limits: Free 0, Uplink 1, Pro 3, Ultimate 10. Super User
  unlimited.
- "Leagues not showing up" → check (1) Yahoo session not expired,
  (2) leagues are visible to the connected Yahoo account, (3) league
  is for a sport we support (NFL primarily; NBA/MLB/NHL also work).

## Multi-row ticker (the visual layout feature)
- Free: 1 row only.
- Uplink: 2 rows.
- Pro + Ultimate + Super User: 3 rows.
- Per-row source assignment: tray right-click → channel name → row
  picker. Or Settings → Ticker → multi-row source picker.
- Ultimate + Super User additionally get per-row scroll customisation
  (different speeds / directions per row). Lower tiers see a
  "Customize scroll — Ultimate only" teaser.

## "Channel disappeared from the ticker"
By far the most common confusion. The per-channel "ticker_enabled"
toggle on the Home/Feed page (eye icon next to each channel header)
is independent of the channel being enabled. If the user has a
channel enabled in Settings but it's not on the ticker, that toggle
is the answer 95% of the time.

## Updating the desktop app
- Settings → General → Updates → Check for Updates.
- Auto-update prompts on launch when a new version is available.
- v1.0.4 is the current latest (April 2026).
- Windows: MSI + NSIS installers. macOS: .dmg + .app.tar.gz (universal
  arm64; Intel Macs not supported as of v1.0.4 — we may add a build
  later).
- Linux: AppImage, .deb, .rpm.

## Bug-report etiquette
When users report a bug, the desktop's Contact Us form auto-collects
diagnostics (OS, Scrollr version, redacted system metadata). Always
include those in the ticket — they're auto-filled, the user just
needs to submit. If a user reports a bug WITHOUT diagnostics, ask
politely for OS + Scrollr version (Settings → General → About).

## What to do if you don't know
If a user asks something that isn't covered by this KB:
- Don't guess. The reply will be visible to the user and partner.
- Acknowledge the question, say you'll look into it, and indicate the
  partner will follow up. The partner can edit the reply via the
  approval link before sending.
- Set confidence: low. The partner is more likely to edit a low-
  confidence draft.

## What to NEVER say in replies
- Specific dollar amounts (point at /uplink instead — pricing drifts).
- Promised feature delivery dates (we don't commit to dates publicly).
- Internal infrastructure details (Logto, Sequin, Coolify, K8s — all
  opaque to users).
- Anything contradicting this KB. If your training data and this KB
  disagree, the KB wins.
`
}
