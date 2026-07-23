# Batch D — Account Expansion + GitHub Sweep + Ticker Rework

**Date:** 2026-04-28 (later same evening as Batch C)
**Status:** Plan locked, executing
**Spec/plan:** combined in this single doc (compact, since the three streams have minimal cross-coupling)

## Why this batch

Three separate concerns surfaced in the post-Batch-C session:

1. **Account management gaps**: super_user not rendering correctly on website /account; no inline name/email/password edit on either platform; username should be locked everywhere.
2. **GitHub redirect cleanup**: marketing site sends users to `github.com/.../discussions` for support paths; should route to `/support` now that it exists (Batch C shipped that route).
3. **Ticker visibility intuition**: three surfaces (tray right-click, feed page Eye/EyeOff toggle, Settings multi-deck source picker) all controlling overlapping state with different mental models — needs a single coherent UX.

Decisions locked from m1108 (full text in compressed block b6).

## Stream 1 — Account expansion

### Backend

New file `api/core/handlers_account.go`:
- `HandleUpdateProfile` — `PUT /users/me/profile`, body `{ name?, email? }`. Calls existing `updateUserIdentity` and/or `updateUserProfile` from `invite.go`. Rejects username changes with 403 (defense-in-depth on top of Logto admin lock).
- `HandleRequestPasswordReset` — `POST /users/me/password/reset`. Triggers Logto's standard forgot-password flow with the user's email pre-filled. Returns 204.

`api/core/server.go`: register both routes with `LogtoAuth`. Invalidate overview cache after profile updates.

### Marketing site

- `myscrollr.com/src/api/client.ts:14` — add `'super_user'` to `subscription_tier` union.
- New `userApi.updateProfile(payload)` and `userApi.requestPasswordReset()`.
- `SubscriptionStatus.tsx:149-164` — add super_user branch BEFORE the early-return-to-FreeTier path. Render dedicated "Super User" badge with no upgrade/cancel actions.
- `account.tsx:458` — pass `overview.tier` down to SubscriptionStatus (drops redundant `getPreferences()` call).
- New inline edit forms for name + email next to the identity row.
- New "Send password reset" button under a Security section.

### Desktop

- `desktop/src/api/client.ts` — add `userApi.updateProfile(payload)` and `userApi.requestPasswordReset()`.
- `AccountSettings.tsx` — new inline edit-in-place forms for name + email + "Send password reset" button under a new Security section.

### Manual one-time admin (post-merge)

- Logto admin → Sign-in experience → User profile → set Username field to read-only. API also rejects username PUT requests as defense-in-depth.

## Stream 2 — GitHub redirect sweep

14 mechanical edits across 9 files.

**Link href swaps (6):**
- `myscrollr.com/src/components/landing/CallToAction.tsx:302` — `discussions` → `<Link to="/support">`
- `myscrollr.com/src/components/landing/TrustSection.tsx:265` — same
- `myscrollr.com/src/components/landing/TrustSection.tsx:548` — `discussions/categories/integration-requests` → `/support`
- `myscrollr.com/src/routes/channels.tsx:404` — same path → `/support`
- `myscrollr.com/src/routes/account.tsx:66` — `releases/latest` → `<Link to="/download">` (better path)
- `myscrollr.com/src/routes/legal.tsx:435` — repo link in "Questions about this document?" → `<Link to="/support">` (also update visible text "GitHub" → "Support")

**Legal copy text changes (6 in `documents.ts`):** lines 130, 217, 284, 552, 769, 871. All currently say "reach out via our GitHub repository or community channels"; change to "reach out via our Support page or community Discord server". Plain-text replacement.

**Edge case at line 806 (security disclosure):** keep GHSA path (security researchers expect it), ADD /support as the primary general-feedback path.

**npm `bugs` metadata (2):**
- `myscrollr.com/package.json:14` — `bugs` → `https://myscrollr.com/support`
- `desktop/package.json:14` — same

**Untouched:** Footer GitHub social icon, all "Star/Fork/View on GitHub/View Source/Build Your Own" CTAs (these are legitimate source-code references), `getDownloadInfo.ts` release-asset host, `tauri.conf.json` updater manifest, `useGitHubStats.ts` star/fork fetcher, GitHub Actions widget files, CSP allowlist, factual mentions ("source on GitHub", "manifest from GitHub releases").

## Stream 3 — Ticker rework

### Mental model
"Where should this channel appear?" → **Off / Row 1 / Row 2 / Row 3**

### Data model "Path Z"
Keep both existing layers; new UI writes to both atomically:
1. `Channel.ticker_enabled` (server-side, controls master gate via `App.tsx:99` filter)
2. `tickerLayout.rows[i].sources[]` (client-side, controls per-row inclusion)

### New helpers in `desktop/src/preferences.ts`

```ts
// row: 0..2 means "include in row N"; null means "off"
export function setChannelTickerRow(
  prefs: AppPreferences,
  channelType: ChannelType,
  row: number | null,
): AppPreferences

export function getChannelTickerRow(
  prefs: AppPreferences,
  dashboard: DashboardResponse | null,
  channelType: ChannelType,
): number | null
```

`set` writes BOTH `Channel.ticker_enabled` (via dashboard mutation) AND `tickerLayout.rows[i].sources[]` (replace channel's row membership atomically).

`get` reads first from `tickerLayout.rows[].sources` (explicit assignment); if not found, falls back to `Channel.ticker_enabled` to determine row 0 vs off.

### New `desktop/src/components/RowSelector.tsx`
Reusable segmented control `[Off] [1] [2] [3]`. Tier-aware: hides rows above `tierLimits.maxTickerRows`. Disabled state for channels with `enabled === false` with hint "Enable from the Catalog first".

### Surfaces updated

- `routes/feed.tsx:243-329` (ChannelSection) — replace Eye/EyeOff button with RowSelector.
- `routes/feed.tsx:697-761` (WidgetSection) — same pattern.
- `App.tsx:480-506` (tray Channels submenu) — each channel becomes a Submenu with radio MenuItems for Off / Row 1 / Row 2 / Row 3.
- Tray Widgets submenu — same.
- `components/settings/TickerSettings.tsx` — source picker stays as bulk-edit alternative.

### Edge cases

1. Free tier (max 1 row): selector shows only `[Off] [1]`.
2. Tier downgrade: existing tier-clamp in `loadPrefs` collapses higher rows; add toast "Your ticker layout was simplified to 1 row".
3. Empty `sources: []` materializes to explicit list when modified via selector.
4. Channel with `enabled === false`: disabled selector with hint.

## Branch + PR

- Branch: `feature/batch-d-account-and-ticker-rework`
- 3 commits (one per stream)
- Single squash-mergeable PR.

## Acceptance criteria

- `go vet ./...` clean across all Go modules
- `go test ./core/...` clean
- `npx tsc --noEmit` clean (desktop)
- `npx vitest run` passes (178/178 baseline, +new tests where added)
- `npm run build` clean (desktop + marketing)
- `cargo check` clean (desktop tauri)
- `npm run check` clean (marketing — Prettier + ESLint)
- Manual smoke after merge: super_user shows correct badge on web /account, password reset email arrives, channel row reassignment works across all three surfaces

## Out of scope (deferred)

- Embedded change-password form (Option B from m1108 — chose C instead)
- Desktop-side delete-account UI (per user — stays website-only)
- Dedicated "Channel suggestion" form category (per user — use Feature request)
- Markdown-link support in legal-doc renderer (per user — plain text)
- Removing `Channel.ticker_enabled` field from server (kept as derived; future cleanup)
