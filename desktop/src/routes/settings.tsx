/**
 * Settings route — consolidated settings page.
 *
 * Three tab areas (Appearance / Ticker / Account) rendered as an
 * explicit in-page tab band at the top of the content. The hidden
 * breadcrumb-dropdown pattern was confusing to walkthrough testers
 * (2026-05-11) — tabs are now the single, obvious navigation.
 *
 * URL slug "general" retained for backward compat with billing
 * banners and existing routing; the user-facing label is "Appearance".
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import { useShell } from "../shell-context";
import GeneralSettings from "../components/settings/GeneralSettings";
import TickerSettings from "../components/settings/TickerSettings";
import AccountSettings from "../components/settings/AccountSettings";
import PageLayout from "../components/layout/PageLayout";
import { resetCategory, resetAll, type AppPreferences } from "../preferences";

// ── Types ───────────────────────────────────────────────────────

type SettingsTab = "general" | "ticker" | "account";

const VALID_TABS: SettingsTab[] = ["general", "ticker", "account"];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "Appearance",
  ticker: "Ticker",
  account: "Account",
};

const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  general: "Theme, scale, window, startup, and updates",
  ticker: "Ticker layout, style, and live preview",
  account: "Profile, subscription, plan, data, and reset",
};

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => {
    const raw = search.tab as string | undefined;
    if (raw === "reset") return { tab: "account" };
    return {
      tab: VALID_TABS.includes(raw as SettingsTab)
        ? (raw as SettingsTab)
        : "general",
    };
  },
  component: SettingsRoute,
  errorComponent: RouteError,
});

// ── Component ───────────────────────────────────────────────────

function SettingsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const shell = useShell();
  const { prefs, onPrefsChange } = shell;

  const setTab = (next: SettingsTab) => {
    navigate({
      to: "/settings",
      search: { tab: next },
      replace: true,
    });
  };

  const handleResetAll = () => {
    const next = resetAll();
    onPrefsChange(next);
  };

  return (
    <PageLayout
      title="Settings"
      width="narrow"
      tabs={{
        items: VALID_TABS.map((t) => ({
          key: t,
          label: TAB_LABELS[t],
          description: TAB_DESCRIPTIONS[t],
        })),
        activeKey: tab,
        onChange: (next) => setTab(next as SettingsTab),
      }}
    >
      {tab === "general" && (
        <GeneralSettings
          appearance={prefs.appearance}
          window_={prefs.window}
          startup={prefs.startup}
          onAppearanceChange={(appearance) =>
            onPrefsChange({ ...prefs, appearance })
          }
          onWindowChange={(window_) =>
            onPrefsChange({ ...prefs, window: window_ })
          }
          onStartupChange={(startup) =>
            onPrefsChange({ ...prefs, startup })
          }
          onReset={() => {
            let next: AppPreferences = resetCategory(prefs, "appearance");
            next = resetCategory(next, "window");
            onPrefsChange(next);
          }}
          autostartEnabled={shell.autostartEnabled}
          onAutostartChange={shell.onAutostartChange}
          appVersion={shell.appVersion}
        />
      )}

      {tab === "ticker" && (
        <TickerSettings prefs={prefs} onPrefsChange={onPrefsChange} />
      )}

      {tab === "account" && (
        <AccountSettings
          authenticated={shell.authenticated}
          tier={shell.tier}
          subscriptionInfo={shell.subscriptionInfo}
          onLogin={shell.onLogin}
          onLogout={shell.onLogout}
          onResetAll={handleResetAll}
        />
      )}
    </PageLayout>
  );
}
