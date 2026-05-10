/**
 * Settings route — consolidated settings page.
 *
 * Three tab-like areas (Appearance / Ticker / Account) but no in-page
 * tab band — the active area's name renders as the last breadcrumb
 * segment in the TopBar, and clicking it opens a dropdown to switch.
 * Mirrors the source-page Options pattern so Settings, Catalog, and
 * channel/widget pages all share one navigation idiom.
 *
 * URL slug "general" retained for backward compat with billing
 * banners and existing routing; the user-facing label is "Appearance".
 */
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Settings as SettingsIcon, Sliders, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RouteError from "../components/RouteError";
import { useShell } from "../shell-context";
import GeneralSettings from "../components/settings/GeneralSettings";
import TickerSettings from "../components/settings/TickerSettings";
import AccountSettings from "../components/settings/AccountSettings";
import PageLayout from "../components/layout/PageLayout";
import type { OverflowMenuItem } from "../components/OverflowMenu";
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

const TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: SettingsIcon,
  ticker: Sliders,
  account: User,
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

  // The dropdown menu items are the OTHER tabs — clicking one
  // switches. The currently-active tab is hidden from the menu since
  // its label is already rendered as the trigger itself.
  const menuItems: OverflowMenuItem[] = useMemo(() => {
    const items: OverflowMenuItem[] = [];
    for (const t of VALID_TABS) {
      if (t === tab) continue;
      items.push({
        key: t,
        label: TAB_LABELS[t],
        hint: TAB_DESCRIPTIONS[t],
        icon: TAB_ICONS[t],
        onSelect: () => setTab(t),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <PageLayout
      title="Settings"
      subtitle={TAB_LABELS[tab]}
      width="narrow"
      menuItems={menuItems}
      menuLabel="Settings sections"
    >
      {tab === "general" && (
        <GeneralSettings
          appearance={prefs.appearance}
          window_={prefs.window}
          onAppearanceChange={(appearance) =>
            onPrefsChange({ ...prefs, appearance })
          }
          onWindowChange={(window_) =>
            onPrefsChange({ ...prefs, window: window_ })
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
