# Batch C — Standardization (final batch)

**Date:** 2026-04-28
**Status:** In flight; user authorized direct execution
**Scope:** Three workstreams shipping the remaining standardization work identified in the pre-launch audit.

## Workstreams

### Stream A — Rename `Channel.visible` → `Channel.ticker_enabled`

`visible` semantically misled users (the field controls whether a channel's chips appear on the ticker, NOT whether the channel itself is hidden from the UI). Caused a real reported bug where RSS chips silently disappeared from the ticker even though the channel was enabled.

**Surface area:**
- Migration: `api/migrations/000007_rename_channel_visible.up.sql` + `.down.sql` — `ALTER TABLE user_channels RENAME COLUMN visible TO ticker_enabled`
- Core API: `api/core/models.go` (struct field + JSON tag), `api/core/channels.go` (queries), `api/core/handlers_overview.go` (overview by_type), any other reads/writes
- Desktop: `desktop/src/api/client.ts` (`Channel` interface), `desktop/src/App.tsx:95, 480` (filter usage), `desktop/src/routes/feed.tsx:151-156` (the toggle UI label "ticker"), all chip filtering paths
- No marketing site changes (it doesn't read this field)

**Decisions:**
- JSON field becomes `ticker_enabled` (snake_case server contract)
- TypeScript field becomes `tickerEnabled` (camelCase client convention)
- The user-facing toggle label stays "Show on ticker" (already correct in `feed.tsx`)
- Migration is renaming, not duplicating — no compatibility shim. Pre-1.0.4 desktop builds reading `visible` will see `null` and treat it as falsy → the toggle defaults to off. Acceptable since v1.0.4 ships in the same release.

### Stream B — Website `/support` route + anonymous contact endpoint

The marketing site has zero support surface today (just `mailto:support@myscrollr.com` in footer). The desktop has a comprehensive support hub. Port the desktop's content as a single-page `/support` route on the website, plus a contact form that works for anonymous visitors.

**Surface area:**
- New: `myscrollr.com/src/routes/support.tsx` — Hero + sections (Getting Started / FAQ / Troubleshooting / Billing / Contact form)
- New: `myscrollr.com/src/components/support/` — section components, content lifted from desktop's `support-content.ts` (literal copy, both files diverge over time independently)
- New: `myscrollr.com/src/components/support/ContactForm.tsx` — auth-aware form
- Modify: `myscrollr.com/src/components/Footer.tsx` — replace `mailto:` with `/support` link
- Modify: `myscrollr.com/src/api/client.ts` — `supportApi.submitTicket(payload, isAuthed)` (chooses authed vs public endpoint)

**Backend (additive, additive only):**
- New: `api/core/handlers_support_public.go` — `HandleSubmitPublicSupportTicket` (anonymous, requires `email` in body, per-IP rate limit)
- Modify: `api/core/support.go` — extract `forwardToOSTicket(ticket SupportTicket) error` helper (single-source for OS Ticket forwarding logic; both authed + public callers use it)
- Modify: `api/core/server.go` — register `POST /support/ticket/public` (no `LogtoAuth`)

**Decisions:**
- Anonymous tickets restricted categories: `bug | feedback | billing | feature` (no `account` — account issues require auth)
- Per-IP rate limit: 5 tickets/hour for `/support/ticket/public`. Use Redis key `support:public:{ip}:hour`.
- Diagnostics field omitted entirely on the website (no Tauri to collect from)
- Attachments NOT supported on the public endpoint (anti-spam vector)
- FAQ/Troubleshooting/Getting Started/Billing content **copied** from desktop, not abstracted — accept divergence; both files are content, not logic
- One `/support` route on the website (no sub-routes); collapsible sections inside the page
- "Channels" category from desktop's contact form omitted on the website (auth-required context)

### Stream C — Settings IA polish on desktop

The Settings tab strip is too small/text-only and users miss it entirely. The General tab is a junk drawer of unrelated topics. The Account tab carries an unrelated "Reset all settings" destructive action.

**Surface area:**
- Modify: `desktop/src/routes/settings.tsx` — search param now accepts `general | ticker | account | reset`. Tab strip gets icons + larger spacing + descriptive labels.
- Modify: `desktop/src/components/settings/AccountSettings.tsx` — REMOVE "Reset all settings" section (move to new Reset tab)
- New: `desktop/src/components/settings/ResetSettings.tsx` — extracted Reset section + ConfirmDialog
- Modify: `desktop/src/components/settings/GeneralSettings.tsx` — add subtle visual section dividers (Appearance / Window / Startup / Updates / About) so the tab reads like a structured page rather than a list
- Modify: `desktop/src/components/Sidebar.tsx` (or wherever the Settings link comes from) — add a small "Channels" cross-link beneath Settings that navigates to `/catalog` (where channels are managed)

**Decisions:**
- Don't redo the IA from scratch — keep the 3-tab base (General / Ticker / Account). Add a 4th: **Reset**.
- Tab nav: bigger pill (`px-4 py-2.5 text-sm`), icons (`Cog6Tooth`/`Wrench`/`Person`/`ArrowPath` from lucide-react), uppercase labels.
- General tab section headers get small icon + tighter spacing — visual hierarchy improvement only, no logic changes.
- "Channels" cross-link under Settings is the cheapest way to point users at where channel-specific configs live (the catalog page already drives users into `/channel/$type/$tab`).

## Integration / cross-stream concerns

- Stream A and Stream C both touch `desktop/src/api/client.ts` — Stream A renames `Channel.visible`. Stream C doesn't touch the Channel interface directly; it only consumes existing types.
- Stream A and Stream B both touch `api/core/server.go` — Stream A modifies queries elsewhere, Stream B adds a route. Different lines, no conflict.
- The Stream A migration runs on backend deploy. Backend deploys before desktop. Desktop v1.0.4 ships TODAY (current draft). Decision: **Stream A migration changes are server-side only on this PR. Desktop changes go in this PR but ship to users via v1.0.5 next desktop release.**

Wait — that's a problem. If we rename the column and the API serves `ticker_enabled` while v1.0.4 desktop reads `visible`, v1.0.4 users break.

**Resolution:** v1.0.4 hasn't shipped to users yet (draft is unpublished). We have two windows:
1. Hold v1.0.4 publish until Batch C ships AND another v1.0.5 with the rename ships
2. Make the Stream A API change backwards-compatible: server returns BOTH `visible` and `ticker_enabled` in JSON until next desktop release; future cleanup removes `visible` after v1.0.5 ships

Going with option 2 — simpler operationally. Marshal `visible` AND `ticker_enabled` from the same struct field with two JSON tags via a wrapper, OR (simpler) just embed both in the response struct. Update the desktop here to read `ticker_enabled`; v1.0.4 still reads `visible` and works fine because the API still emits it as an alias.

Actually, simplest: keep the column AND struct field as `Visible` server-side, just add a JSON-output alias `ticker_enabled` so clients reading either name get the same data. The "rename" becomes purely client-facing terminology, not a column rename. Database stays `visible`; struct stays `Visible`; JSON output is `{"visible": true, "ticker_enabled": true}` (both populated). Desktop reads `tickerEnabled` going forward. Migration NOT needed for this batch.

Adopting that resolution: Stream A skips the migration entirely. Just adds a JSON alias on the response side.

## Acceptance criteria

- `go vet ./...` clean across api/core
- `go test ./api/core/...` all pass
- Desktop: `npx tsc --noEmit` clean, `npx vitest run` 178/178+, `npm run build` clean, `cargo check` clean
- Marketing: `npm run check` clean, `npm run build` clean
- Manual smoke (post-deploy):
  - RSS toggle on /feed page works (now correctly labeled "ticker")
  - Website /support page renders, FAQ accordion works, contact form submits as anonymous + as authed
  - Desktop Settings has 4 tabs (General / Ticker / Account / Reset); icons visible; Reset tab contains the danger button; Channels cross-link navigates to catalog

## Out of scope

- Database column rename (deferred — see Resolution above)
- Settings tab full IA rebuild (only polish in this batch)
- New Logto JWT claims (already done in Batch B)
- Per-channel settings consolidation under global Settings (deferred — `/catalog` cross-link is sufficient for now)
