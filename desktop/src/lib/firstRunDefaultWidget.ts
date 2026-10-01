/**
 * First-run starter (SCROLLR-246, widened by SCROLLR-283): a fresh signed-in
 * account's first bar shows NPR headlines and Stocks quotes as two pages, with
 * the Clock on the edge, instead of the "no sources yet" CTA. Extracted from
 * App.tsx so the decision and the sequence are unit-testable without mounting
 * the whole ticker window — App.tsx only supplies `authenticated`/`dashboard`
 * and the hook gates the actual call on `ownsSharedConnection()` so N ticker
 * windows never race each other into N calls (see the effect in App.tsx).
 */
import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react";
import { dataWidgetsApi } from "../api/client";
import { ownsSharedConnection } from "./windowRole";
import type { AppPreferences } from "../preferences";
import type { DashboardResponse } from "../types";

/**
 * The starter's edge widget. Clock is a free local utility (SCROLLR-282): it
 * lives in client preferences, not in `user_widgets`, so the server cannot
 * create it and the client turns it on once the server's set has landed.
 */
export const STARTER_EDGE_WIDGET = "clock";

/**
 * True while an authenticated, zero-widget account has never been offered
 * the starter (server flag false). `dashboard.preferences` rides along on
 * every /dashboard response (core's getDashboard always calls
 * GetOrCreatePreferences), so this needs no extra round trip to decide.
 *
 * The flag, not the widget count, is what "once" means: after the starter
 * lands the account has widgets, which alone would already make this false —
 * but if the user later removes them back down to zero, widget count alone
 * would look "fresh" again. The flag is what keeps it false forever for that
 * account once the starter has been offered.
 *
 * An account with any existing widget, or whose preferences are unknown
 * (dashboard not loaded yet, or the flag genuinely absent), is left
 * alone — untouched accounts must never see a surprise add.
 */
export function shouldOfferDefaultWidget(
  authenticated: boolean,
  dashboard: Pick<DashboardResponse, "widgets" | "preferences"> | undefined,
): boolean {
  if (!authenticated || !dashboard) return false;
  if ((dashboard.widgets?.length ?? 0) > 0) return false;
  return dashboard.preferences?.default_widgets_applied === false;
}

/**
 * Applies the starter with ONE server call. The server flips the once-flag
 * and creates NPR + Stocks in a single transaction, so there is no half state
 * to clean up: it either all landed (flag and widgets) or none of it did, and
 * a failure here simply leaves the account fresh for the retry. Resolves
 * `applied: false` when the server found nothing to do (another window or
 * device got there first, or the account already has widgets).
 */
export async function applyStarterWidgets(): Promise<boolean> {
  const { applied } = await dataWidgetsApi.applyStarter();
  return applied;
}

/**
 * The preferences with the Clock enabled and on the ticker. Returns the same
 * object when it already is, so the caller can skip the write.
 */
export function withStarterClock(prefs: AppPreferences): AppPreferences {
  const w = prefs.widgets;
  const enabled = w.enabledWidgets.includes(STARTER_EDGE_WIDGET);
  const onTicker = w.widgetsOnTicker.includes(STARTER_EDGE_WIDGET);
  if (enabled && onTicker) return prefs;
  return {
    ...prefs,
    widgets: {
      ...w,
      enabledWidgets: enabled ? w.enabledWidgets : [...w.enabledWidgets, STARTER_EDGE_WIDGET],
      widgetsOnTicker: onTicker ? w.widgetsOnTicker : [...w.widgetsOnTicker, STARTER_EDGE_WIDGET],
    },
  };
}

/** One retry after a failed apply; never more (see useFirstRunDefaultWidget). */
export const DEFAULT_WIDGET_RETRY_MS = 30_000;

/**
 * Runs the first-run starter for this window and returns `awaiting`: true
 * while the empty-state CTA should stay suppressed. The call itself only
 * runs from the window that owns the shared connection, so N ticker windows
 * never race into N calls.
 *
 * `onApplied(applied)` runs after the server call succeeds — and only then,
 * so the Clock is never enabled for a starter that did not land. `applied`
 * is false when the server had nothing to do; the caller still refetches in
 * that case but must not touch the Clock.
 *
 * If the apply throws (offline, 5xx) the CTA stops being suppressed at once,
 * so a failed first run degrades to the normal "no sources yet" state, and
 * exactly ONE retry is scheduled after DEFAULT_WIDGET_RETRY_MS. There is no
 * loop: after the retry the account simply keeps the CTA.
 */
export function useFirstRunDefaultWidget(
  authenticated: boolean,
  dashboard: Parameters<typeof shouldOfferDefaultWidget>[1],
  onApplied: (applied: boolean) => void,
): boolean {
  const eligible = shouldOfferDefaultWidget(authenticated, dashboard);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  useEffect(() => {
    if (!eligible || started.current) return;
    started.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (isRetry: boolean) => {
      if (!(await ownsSharedConnection())) return;
      try {
        const applied = await applyStarterWidgets();
        setFailed(false);
        onAppliedRef.current(applied);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "first-run-default-widget" },
        });
        setFailed(true);
        if (!isRetry) timer = setTimeout(() => void attempt(true), DEFAULT_WIDGET_RETRY_MS);
      }
    };
    void attempt(false);
    return () => clearTimeout(timer);
  }, [eligible]);

  return eligible && !failed;
}
