/**
 * One-time move of existing users to Pages (SCROLLR-288).
 *
 * 1.6.10 wrote `scrollMode: "continuous"` for everyone, so a stored
 * `continuous` cannot be told from a deliberate choice. Once, at the first
 * run of the widget-pages release, every such user moves to Pages and sees
 * one notice. The marker is its own store key (not a pref, so "Reset
 * ticker settings" cannot clear it): after it is written a user who goes
 * back to Continuous is never flipped again. A fresh install is already on
 * Pages and only gets the marker.
 *
 * Runs from the main window only (one per process; App.tsx runs once per
 * ticker window and must not call this). The marker is written BEFORE the
 * flip, as autostartDefault does, so no failure can make it run twice.
 */
import { readStoreShared, setStorePersisted } from "./store";
import { showTipOnce, TIP_IDS } from "./tips";
import type { AppPreferences } from "../preferences";

export const PAGES_INTRO_KEY = "scrollr:pages-intro-applied";

export async function applyPagesIntro(
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
  openTickerSettings: () => void,
): Promise<boolean> {
  if (await readStoreShared<boolean>(PAGES_INTRO_KEY)) return false;
  await setStorePersisted(PAGES_INTRO_KEY, true);
  if (prefs.ticker.scrollMode !== "continuous") return false;
  showTipOnce(
    TIP_IDS.PAGES_INTRO,
    { ...prefs, ticker: { ...prefs.ticker, scrollMode: "pages" } },
    onPrefsChange,
    {
      title: "Your bar has a new look: one widget per page",
      description: "Prefer the scrolling bar? Settings › Ticker › Continuous",
      duration: 12_000,
      actionLabel: "Open Ticker settings",
      onAction: openTickerSettings,
    },
  );
  return true;
}
