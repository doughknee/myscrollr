/**
 * Settings route — consolidated settings page with tabs.
 *
 * Four tabs:
 *   General  — appearance, window, startup, updates
 *   Ticker   — ticker presentation settings with live preview
 *   Account  — profile, billing, plan, data export
 *   Reset    — destructive: reset all local preferences
 *
 * Tab state is persisted in the URL via ?tab= search param.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { clsx } from "clsx";
import { Settings, Sliders, User, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import RouteError from "../components/RouteError";
import { useShell } from "../shell-context";
import GeneralSettings from "../components/settings/GeneralSettings";
import TickerSettings from "../components/settings/TickerSettings";
import AccountSettings from "../components/settings/AccountSettings";
import ResetSettings from "../components/settings/ResetSettings";
import Tooltip from "../components/Tooltip";
import { resetCategory, resetAll, type AppPreferences } from "../preferences";

// ── Types ───────────────────────────────────────────────────────

type SettingsTab = "general" | "ticker" | "account" | "reset";

const VALID_TABS: SettingsTab[] = ["general", "ticker", "account", "reset"];

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  ticker: "Ticker",
  account: "Account",
  reset: "Reset",
};

/**
 * Per-tab one-liner used as the tooltip when hovering a tab. Keeps
 * tabs themselves short while still explaining what each does to
 * first-time users — Phase 2 (Apr 26) tooltip-coverage audit.
 */
const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  general: "Appearance, window, startup, and updates",
  ticker: "Ticker layout, style, and live preview",
  account: "Profile, subscription, plan, and data",
  reset: "Restore all preferences to defaults",
};

const TAB_ICONS: Record<SettingsTab, LucideIcon> = {
  general: Settings,
  ticker: Sliders,
  account: User,
  reset: RotateCcw,
};

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => ({
    tab: VALID_TABS.includes(search.tab as SettingsTab)
      ? (search.tab as SettingsTab)
      : "general",
  }),
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
    navigate({ to: "/settings", search: { tab: next }, replace: true });
  };

  const handleResetAll = () => {
    const next = resetAll();
    onPrefsChange(next);
  };

  return (
    <div className="p-5 max-w-6xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-[11px] font-mono font-semibold text-fg-4 uppercase tracking-wider mb-1">
          Settings
        </h1>
        <p className="text-xs text-fg-4">
          Appearance, ticker, and account preferences
        </p>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <nav className="flex flex-wrap gap-2 mb-6" aria-label="Settings sections">
        {VALID_TABS.map((t) => {
          const Icon = TAB_ICONS[t];
          const isActive = tab === t;
          return (
            <Tooltip key={t} content={TAB_DESCRIPTIONS[t]} side="bottom">
              <button
                onClick={() => setTab(t)}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border",
                  isActive
                    ? "bg-accent/15 text-accent border-accent/30"
                    : "text-fg-3 hover:text-fg-2 hover:bg-surface-hover border-transparent",
                )}
              >
                <Icon className="w-4 h-4" aria-hidden />
                <span>{TAB_LABELS[t]}</span>
              </button>
            </Tooltip>
          );
        })}
      </nav>

      {/* ── Tab content ────────────────────────────────────────── */}
      <div className="max-w-2xl">
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
          <TickerSettings
            prefs={prefs}
            onPrefsChange={onPrefsChange}
          />
        )}

        {tab === "account" && (
          <AccountSettings
            authenticated={shell.authenticated}
            tier={shell.tier}
            subscriptionInfo={shell.subscriptionInfo}
            onLogin={shell.onLogin}
            onLogout={shell.onLogout}
          />
        )}

        {tab === "reset" && <ResetSettings onResetAll={handleResetAll} />}
      </div>
    </div>
  );
}
