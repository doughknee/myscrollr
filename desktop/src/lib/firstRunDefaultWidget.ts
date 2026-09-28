/**
 * First-run default widget (SCROLLR-246): a fresh signed-in account's
 * first ticker scrolls NPR (`news_npr`) instead of the "no sources yet"
 * CTA. Extracted from App.tsx so the decision and the two-call sequence
 * are unit-testable without mounting the whole ticker window — App.tsx
 * only supplies `authenticated`/`dashboard` and gates the actual call on
 * `ownsSharedConnection()` so N ticker windows never race each other into
 * N POSTs (see the effect in App.tsx).
 */
import { dataWidgetsApi, preferencesApi } from "../api/client";
import type { DashboardResponse } from "../types";

export const FIRST_RUN_DEFAULT_WIDGET = "news_npr";

/**
 * True while an authenticated, zero-widget account has never been offered
 * the default (server flag false). `dashboard.preferences` rides along on
 * every /dashboard response (core's getDashboard always calls
 * GetOrCreatePreferences), so this needs no extra round trip to decide.
 *
 * The flag, not the widget count, is what "once" means: after the add
 * succeeds the account has 1 widget, which alone would already make this
 * false — but if the user later removes it back down to zero, widget
 * count alone would look "fresh" again. The flag is what keeps it false
 * forever for that account once the default has been offered.
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
 * Applies the default: sets the once-flag FIRST, then adds the widget
 * through the normal server add path (the same `POST /users/me/widgets`
 * the catalog uses).
 *
 * That order — flag before create, not after — is deliberate. If the
 * create fails or the app closes mid-flight after the flag lands, the
 * account simply never gets the default this one time (a silent, rare
 * miss). The reverse order risks the one thing the acceptance criteria
 * cannot tolerate: a create that succeeds followed by a flag write that
 * never lands would look "fresh" again the moment the user removes the
 * widget, re-adding it right back.
 */
export async function applyDefaultWidget(): Promise<void> {
  await preferencesApi.update({ default_widgets_applied: true });
  await dataWidgetsApi.create(FIRST_RUN_DEFAULT_WIDGET, {});
}
