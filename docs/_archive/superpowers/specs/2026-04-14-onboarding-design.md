# Desktop App Onboarding — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Problem

New users open the desktop app and see the full UI — sidebar, navigation, all routes — with no guidance. The only sign-in prompt is buried in the feed page empty state or the Account settings tab. There is no centralized auth gate, no onboarding wizard, and no first-run experience. Users are confused about what to do first.

## Solution

Three-part onboarding system:

1. **Auth gate** — Full-screen sign-in wall when unauthenticated. No app chrome, no sidebar, no navigation. Forces authentication before app access.
2. **Onboarding wizard** — After first sign-in, a multi-step wizard guides the user through channel and widget setup. User lands on a populated feed.
3. **Product tour** (future) — react-joyride installed now for post-onboarding spotlight walkthroughs. Wired up in a separate iteration.

## Architecture

### Auth Gate

When `!authenticated`, the `__root.tsx` layout renders only the auth gate — no sidebar, no `<Outlet />`, no title bar navigation icons. Just a centered card with:

- App logo + tagline
- "Sign In" button (triggers existing PKCE flow via `onLogin`)
- "Create Account" link (opens Logto sign-up page in browser via the same PKCE flow with `prompt=login` or `interaction_mode=signUp` if supported; falls back to standard sign-in)
- Standard window decorations remain (main window has `decorations: true`). The auth gate simply doesn't render the custom TitleBar, sidebar, or navigation — only the OS-native title bar is visible.

The auth gate is a component rendered conditionally in `__root.tsx`, not a separate route. This avoids TanStack Router complexity and keeps the gate at the layout level.

### Onboarding Wizard

After authentication, if the user has never completed onboarding (`!prefs.onboardingComplete`), the wizard renders in place of the normal `<Outlet />`. The sidebar remains hidden until the wizard completes.

#### State

New preference field in `AppPreferences`:
```ts
onboardingComplete: boolean; // default: false
```

Detection logic in `__root.tsx`:
```ts
const showOnboarding = authenticated && !prefs.onboardingComplete;
const showAuthGate = !authenticated;
const showApp = authenticated && prefs.onboardingComplete;
```

Existing users (who already have channels or whose store already exists from a pre-onboarding version) get `onboardingComplete` auto-set to `true` on first load via a migration check: if `dashboard.channels.length > 0`, set the flag and skip the wizard.

#### Wizard Steps

**Step 1: Pick Your Channels**
- 2x2 grid of channel cards: Finance, Sports, RSS, Fantasy
- Each card is a toggle — click to select/deselect
- Visual checkmark on selected cards
- "Skip" and "Next" buttons
- No API calls on this step — selection is held in wizard state

**Step 2: Configure Your Channels** (one sub-step per enabled channel)
- Shown only for channels selected in Step 1. If none selected, skip entirely.
- Curated quick-pick UI per channel type:
  - **Finance:** "Popular Stocks" checkbox grid (AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, META, JPM, V, DIS) + "Popular Crypto" row (BTC, ETH, SOL). Pre-built list, user checks boxes.
  - **Sports:** "Popular Leagues" checklist (NFL, NBA, MLB, NHL, MLS, Premier League, La Liga, Bundesliga, Serie A, Champions League, Ligue 1). Check the ones you follow.
  - **RSS:** "Recommended Feeds" grouped by category (Tech: TechCrunch, Ars Technica, The Verge; Business: Bloomberg, Reuters; News: AP News, BBC). Check to subscribe. Optional URL input for custom feed.
  - **Fantasy:** "Connect Yahoo" button triggers existing OAuth flow. If skipped, channel is created but unconfigured.
- "Back" and "Next" buttons per sub-step
- API calls happen on "Next": `channelsApi.create()` + `channelsApi.update()` with selected config

**Step 3: Pick Your Widgets**
- Same card-toggle pattern as Step 1
- Cards: Weather, Clock, System Monitor, Uptime Kuma, GitHub Actions
- Each card shows a brief description
- Selected widgets get added to `prefs.widgets.enabledWidgets` and `prefs.widgets.widgetsOnTicker`
- "Skip" and "Finish" buttons
- On "Finish": set `onboardingComplete: true`, auto-pin all selected items to sidebar

**Completion:**
- Wizard unmounts, sidebar appears, `<Outlet />` renders
- Dashboard query fires, fetching freshly configured channel data
- User lands on `/feed` with a populated feed

#### Wizard Component Structure

```
desktop/src/components/onboarding/
  OnboardingWizard.tsx      — Step orchestrator (state machine, navigation)
  StepChannels.tsx          — Step 1: channel selection cards
  StepConfigureFinance.tsx  — Step 2a: finance quick-picks
  StepConfigureSports.tsx   — Step 2b: sports quick-picks
  StepConfigureRss.tsx      — Step 2c: RSS quick-picks
  StepConfigureFantasy.tsx  — Step 2d: fantasy Yahoo connect
  StepWidgets.tsx           — Step 3: widget selection cards
  WizardShell.tsx           — Layout wrapper (progress bar, navigation buttons)
```

Each step component receives wizard state and callbacks as props. The orchestrator manages which step is active, handles back/next/skip, and collects selections.

### Auth Gate Component

```
desktop/src/components/onboarding/
  AuthGate.tsx              — Full-screen sign-in card
```

Rendered in `__root.tsx` when `!authenticated`.

### Integration Point — `__root.tsx`

Current render:
```tsx
<div id="app-shell">
  <TitleBar />
  <div className="flex ...">
    <Sidebar ... />
    <main>
      <Outlet />
    </main>
  </div>
</div>
```

New render:
```tsx
<div id="app-shell">
  {showAuthGate && <AuthGate onLogin={auth.handleLogin} />}
  {showOnboarding && <OnboardingWizard onComplete={handleOnboardingComplete} />}
  {showApp && (
    <>
      <TitleBar />
      <div className="flex ...">
        <Sidebar ... />
        <main>
          <Outlet />
        </main>
      </div>
    </>
  )}
</div>
```

The `TitleBar` is only rendered when `showApp` is true. The auth gate and wizard provide their own minimal window chrome (just drag region + close/minimize).

### react-joyride (Future Tour)

Install `react-joyride@3` now. Do not wire up any tour steps in this iteration. The tour will be added in a future spec to highlight key UI elements after onboarding completes (sidebar navigation, ticker controls, catalog, settings).

## Curated Quick-Pick Data

The curated lists are static data defined in a new file:

```
desktop/src/components/onboarding/curated-picks.ts
```

Contains:
- `POPULAR_STOCKS: { symbol: string; name: string }[]` — ~10 entries
- `POPULAR_CRYPTO: { symbol: string; name: string }[]` — ~3 entries
- `POPULAR_LEAGUES: { id: string; name: string; sport: string }[]` — ~11 entries
- `RECOMMENDED_FEEDS: { url: string; name: string; category: string }[]` — ~9 entries grouped by category

These are hardcoded, not fetched from an API. The existing catalog/config endpoints are used only for the actual channel creation and update API calls.

## Existing User Migration

Users upgrading from a pre-onboarding version already have channels and preferences in the store. To avoid forcing them through the wizard:

In `__root.tsx` (or `useAuthState`), on first render when `authenticated && !prefs.onboardingComplete`:
1. Check if `dashboard.channels.length > 0`
2. If yes: set `onboardingComplete: true` immediately, skip wizard
3. If no: show wizard

This is a one-time check. Once `onboardingComplete` is set, it persists.

## Ticker Window

The ticker window (`App.tsx`) is unaffected by the auth gate or wizard. It already handles unauthenticated state gracefully (shows widgets only, no channel data). The ticker becomes visible after the wizard completes when `prefs.ticker.showTicker` is true (existing behavior).

## Error Handling

- **Sign-in failure:** Auth gate shows the same "Sign-in failed" toast as today (via `useAuthState`). Gate stays visible.
- **Channel creation failure during wizard:** Toast error, channel is skipped. User can add it later from the catalog.
- **Network failure during wizard:** Steps that require API calls show inline error with retry button. Non-API steps (widget selection) work offline.
- **Wizard abandoned** (app closed mid-wizard): `onboardingComplete` is still `false`, wizard resumes on next launch. Wizard state is not persisted — user starts from Step 1.

## Files Changed

**New files:**
- `desktop/src/components/onboarding/AuthGate.tsx`
- `desktop/src/components/onboarding/OnboardingWizard.tsx`
- `desktop/src/components/onboarding/WizardShell.tsx`
- `desktop/src/components/onboarding/StepChannels.tsx`
- `desktop/src/components/onboarding/StepConfigureFinance.tsx`
- `desktop/src/components/onboarding/StepConfigureSports.tsx`
- `desktop/src/components/onboarding/StepConfigureRss.tsx`
- `desktop/src/components/onboarding/StepConfigureFantasy.tsx`
- `desktop/src/components/onboarding/StepWidgets.tsx`
- `desktop/src/components/onboarding/curated-picks.ts`

**Modified files:**
- `desktop/src/routes/__root.tsx` — Conditional rendering: auth gate / wizard / app shell
- `desktop/src/preferences.ts` — Add `onboardingComplete: boolean` to preferences
- `desktop/package.json` — Add `react-joyride@3` dependency

**Not modified:**
- `desktop/src/App.tsx` — Ticker window unchanged
- `desktop/src/auth.ts` — Auth flow unchanged
- `desktop/src/hooks/useAuthState.ts` — Hook unchanged
- Existing routes — All route components unchanged
