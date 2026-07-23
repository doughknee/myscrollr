# Setup Wizard Overhaul — Design Spec

## Goal

Fix bugs and add tier awareness to the desktop app's setup wizard. Five changes: fix sports league IDs, enforce tier limits, fix weather geolocation, fix back-navigation desync, and auto-disable wizard on completion.

## Current State

The wizard lives in `desktop/src/components/onboarding/`. It has a welcome screen, then dynamic steps: channel picker -> configure selected channels -> widget picker. Navigation: Next, Back, Skip. Back button exists but has a step-index desync bug. No tier enforcement. Sports sends wrong IDs. Weather geolocation silently fails in Tauri.

Key files:
- `OnboardingWizard.tsx` (381 lines) — orchestrator, state, provisioning
- `WizardShell.tsx` (113 lines) — chrome, progress bar, buttons
- `StepChannels.tsx` (59 lines) — channel picker (2x2 grid)
- `StepConfigureFinance.tsx` (50 lines) — stock/crypto symbol picker
- `StepConfigureSports.tsx` (55 lines) — league picker
- `StepConfigureRss.tsx` (55 lines) — feed picker
- `StepConfigureFantasy.tsx` (42 lines) — Yahoo connect (non-functional)
- `StepWidgets.tsx` (59 lines) — widget picker (2x2 grid)
- `curated-picks.ts` (66 lines) — static data for finance/sports/RSS
- `widgets/weather/FeedTab.tsx` (226 lines) — weather widget with broken geolocation

## Changes

### 1. Sports League ID Fix

**Bug:** `curated-picks.ts` assigns sequential/arbitrary numeric IDs to leagues (e.g., NFL=`"1"`, NBA=`"2"`). The backend expects league **name strings** (e.g., `"NFL"`, `"NBA"`). The configure page works because it uses names from the catalog API. NBA and Champions League both have `id: "2"`, causing toggle collisions.

**Fix:** In `StepConfigureSports.tsx`, change selection key from `league.id` to `league.name`. The `sportsLeagues` state in `OnboardingWizard.tsx` already holds `Set<string>` — just the values change from IDs to names. The `toggleLeague` callback passes `league.name` instead of `league.id`. The provisioning call `{ leagues: [...sportsLeagues] }` then sends correct name strings.

No changes to `curated-picks.ts` data structure needed — the `id` field becomes unused metadata in the wizard context.

### 2. Tier-Dependent Wizard

**Problem:** The wizard shows all channels and all curated picks to every user regardless of tier. Free users can select unlimited items.

**Solution:** Pass `tier: SubscriptionTier` as a new prop to `OnboardingWizard` from `__root.tsx` (where `auth.tier` is already available at line 532).

#### Channel Picker (StepChannels.tsx)

All 4 channels always visible. Channels where the tier's limit is 0 get a lock overlay with a tier badge showing the minimum tier required. Locked channels are not selectable (`onToggle` is a no-op for them).

Channel-to-limit mapping for lock decisions:
- Finance: `symbols` limit. Lock if 0 (currently no tier has 0 symbols, so finance is always unlocked).
- Sports: `leagues` limit. Lock if 0 (currently no tier has 0 leagues, so sports is always unlocked).
- RSS: `feeds` limit. Lock if 0 (currently no tier has 0 feeds, so RSS is always unlocked).
- Fantasy: `fantasy` limit. Lock if 0 (free tier has 0 — locked for free users).

The lock badge shows the minimum tier that unlocks the channel. For fantasy, that's "Uplink" (the lowest paid tier with `fantasy: 1`).

New props for `StepChannels`: `tier: SubscriptionTier` and `lockedChannels: Set<ChannelType>`.

#### Configure Steps (StepConfigureFinance, StepConfigureSports, StepConfigureRss)

Each configure step receives a `maxItems: number | undefined` prop (undefined = unlimited). When the selection count reaches `maxItems`, unselected items become disabled (grayed out, non-clickable). A counter shows below the step subtitle: `"3 / 5 selected"` (or `"3 selected"` if unlimited). When maxed out, show a hint: `"Upgrade for more — you've reached the free tier limit"`.

Limit keys per channel:
- Finance: `getLimit(tier, "symbols")` — free=5, uplink=25, pro=75, ultimate/super=unlimited
- Sports: `getLimit(tier, "leagues")` — free=1, uplink=8, pro=20, ultimate/super=unlimited
- RSS: `getLimit(tier, "feeds")` — free=1, uplink=25, pro=100, ultimate/super=unlimited

The counter renders inside each configure step component, above the item grid: `"3 / 5 selected"` when limited, `"3 selected"` when unlimited. When at the limit, the counter text turns amber and shows an upgrade hint below it: `"Free tier limit reached — upgrade for more"`.

Fantasy (StepConfigureFantasy) has no item selection (it's just a connect button), so no limit enforcement needed there — the channel is either locked or unlocked at the picker level.

#### OnboardingWizard Changes

- Accept `tier: SubscriptionTier` prop
- Compute `lockedChannels` from tier limits (any channel where limit is 0)
- Filter `selectedChannels`: if a user somehow has a locked channel selected (shouldn't happen but defensive), exclude it from `buildSteps()`
- Pass `maxItems` to each configure step component
- Pass `tier` and `lockedChannels` to `StepChannels`

### 3. Weather Geolocation Fix

**Bug:** `navigator.geolocation.getCurrentPosition()` does not work in Tauri v2 webviews. The error callback silently swallows failures, so "Use My Location" appears to do nothing.

**Fix:** Replace `navigator.geolocation` with an IP-based geolocation API. Use `http://ip-api.com/json/` (free, no key, returns `city`, `lat`, `lon`, `country`, `regionName`). Remove the `navigator.geolocation` code path entirely.

Changes to `widgets/weather/FeedTab.tsx`:
- Replace `detectLocation` callback: `fetch("http://ip-api.com/json/")` → parse response → `addCity({ name: data.city, lat: data.lat, lon: data.lon, country: data.country, admin1: data.regionName })`
- Add loading state for the detect button (show spinner while fetching)
- On failure: show `toast.error("Couldn't detect your location")` instead of silent failure
- Remove `navigator.geolocation` import/usage entirely

### 4. Back Button Desync Fix

**Bug:** The step array rebuilds from `selectedChannels` on every render. If the user goes back to the channel picker, changes selections, and navigates forward, `stepIndex` may point to the wrong step or be out of bounds.

**Fix:** When the user is on the channel picker step (`stepIndex === 0` where `currentStep.kind === "channels"`), any channel toggle doesn't need step index adjustment — they're already on step 0. The issue occurs when going back TO the channel step from a later step: `stepIndex` is decremented but the step array may shrink if channels are removed.

Simplest correct fix: in the `toggleChannel` callback, if the channel is being removed (deselected), clamp `stepIndex` to be within the bounds of the resulting step array. Specifically, after updating `selectedChannels`, compute the new step count and set `stepIndex` to `Math.min(stepIndex, newStepCount - 1)`.

In practice: since channel toggles only happen on the channel picker step (step 0), `stepIndex` is already 0 and clamping is a no-op. The real protection is: always clamp `stepIndex` when the step array length changes (use an effect or derive it safely). Add `Math.min(stepIndex, steps.length - 1)` as the effective index.

### 5. Wizard Completion Behavior

**Bug:** Finishing the wizard doesn't set `showSetupOnLogin: false`. The wizard shows again on every login. The "Don't show this again" checkbox defaults to unchecked.

**Fix:**
- In `OnboardingWizard.finish()`: set `nextPrefs.showSetupOnLogin = false` before calling `onComplete(nextPrefs)`.
- In `WelcomeScreen`: change `dontShow` initial state from `false` to `true` (checkbox defaults to checked).
- Users can re-enable the wizard from Settings > General (existing toggle, no changes needed).

## Files Changed

| File | Change |
|------|--------|
| `OnboardingWizard.tsx` | Add `tier` prop, compute locked channels, pass limits to steps, fix step index clamping, set `showSetupOnLogin: false` in `finish()` |
| `WizardShell.tsx` | Add optional limit counter display in subtitle area |
| `StepChannels.tsx` | Add `tier`/`lockedChannels` props, render lock overlay + tier badge on locked channels |
| `StepConfigureSports.tsx` | Toggle on `league.name` instead of `league.id`, add `maxItems` prop, disable items past limit |
| `StepConfigureFinance.tsx` | Add `maxItems` prop, disable items past limit |
| `StepConfigureRss.tsx` | Add `maxItems` prop, disable items past limit |
| `WelcomeScreen` (in OnboardingWizard.tsx) | Default `dontShow` to `true` |
| `__root.tsx` (line 532) | Pass `tier={auth.tier}` to `OnboardingWizard` |
| `widgets/weather/FeedTab.tsx` | Replace `navigator.geolocation` with IP-based geolocation, add error feedback |

## Out of Scope

- Fantasy Yahoo OAuth flow (non-functional connect button) — separate feature
- Weather wizard step (adding a city picker step to the wizard) — not requested
- Widget tier limits (all widgets are available to all tiers currently)
- Double provisioning cleanup (channels provisioned on Next AND in finish()) — cosmetic, not harmful
