/**
 * The unified settings surface: rail + single-column pane.
 *
 * Replaces the four-tab SectionNav layout. Everything lives on one
 * route (`/customize?page=`); the rail owns movement between pages.
 *
 * Two deliberate choices:
 *
 * 1. Only the active page is mounted. Several behaviors are scoped to a
 *    page's lifetime — the updater's state machine, the 30s
 *    password-reset cooldown — and used to reset when you navigated
 *    between the old /account, /updates and /customize routes. Rendering
 *    all seven and hiding six would silently turn those into
 *    session-length state.
 *
 * 2. Rail navigation replaces rather than pushes. useNavHistory is a raw
 *    history-index model with no notion of route vs. search param, so
 *    pushing would make Back walk backwards through seven settings pages
 *    instead of leaving Settings.
 *
 * This registers its page identity directly instead of going through
 * PageLayout: the rail has to be full-height beside a 680px pane, and
 * PageLayout's fillHeight mode hard-codes a centered, padded, width-
 * clamped content box with no escape hatch.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useRegisterPageIdentity } from "../layout/page-context";
import { useShell } from "../../shell-context";
import { resetAll } from "../../preferences";
import {
  DEFAULT_SETTINGS_PAGE,
  SETTINGS_PAGE_META,
  type SettingsPage,
} from "./pages";
import { flashRow, searchSettings } from "./searchIndex";
import SettingsRail from "./SettingsRail";
import { CARD_SURFACE, SettingsButton } from "./SettingsControls";
import PageHeader from "./pages/PageHeader";
import AppearancePage from "./pages/AppearancePage";
import WindowStartupPage from "./pages/WindowStartupPage";
import ShortcutsPage from "./pages/ShortcutsPage";
import TickerPage, { useTickerReset } from "./pages/TickerPage";
import ProfilePlanPage from "./pages/ProfilePlanPage";
import DataPrivacyPage from "./pages/DataPrivacyPage";
import UpdatesPage from "./pages/UpdatesPage";

interface SettingsSurfaceProps {
  page: SettingsPage;
  /** Search box contents. Lives in the route so ⌘F can reach it. */
  query: string;
  onQueryChange: (query: string) => void;
}

export default function SettingsSurface({
  page,
  query,
  onQueryChange,
}: SettingsSurfaceProps) {
  const shell = useShell();
  const { prefs, onPrefsChange } = shell;
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const resetTicker = useTickerReset();

  const searching = query.trim().length > 0;
  const results = useMemo(() => searchSettings(query), [query]);
  const meta = SETTINGS_PAGE_META[page] ?? SETTINGS_PAGE_META[DEFAULT_SETTINGS_PAGE];

  const goTo = useCallback(
    (next: SettingsPage, rowId?: string) => {
      onQueryChange("");
      void navigate({
        to: "/customize",
        search: { page: next },
        // Replace, don't push: useNavHistory is a raw history-index
        // model with no notion of route vs. search param, so pushing
        // would make Back walk backwards through settings pages instead
        // of leaving Settings.
        replace: true,
      }).then(() => {
        if (rowId) requestAnimationFrame(() => flashRow(rowId));
      });
    },
    [navigate, onQueryChange],
  );

  // Must be a stable reference: useRegisterPageIdentity keeps
  // `onParentClick` in its effect deps, so a fresh arrow every render
  // re-registers the identity every render, which sets state, which
  // renders again — "Maximum update depth exceeded".
  const goToDefault = useCallback(
    () => goTo(DEFAULT_SETTINGS_PAGE),
    [goTo],
  );

  // TopBar breadcrumb: "Settings / {page}".
  useRegisterPageIdentity({
    title: searching ? "Search" : meta.label,
    parentLabel: "Settings",
    onParentClick: goToDefault,
  });

  // ⌘F / Ctrl+F focuses the search box while this surface is mounted.
  // Registered here rather than in __root so it unbinds on the way out
  // and never shadows a find shortcut on other routes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Each page is its own reading position; PageLayout would normally do
  // this, but the pane owns its scroll here.
  useEffect(() => {
    paneRef.current?.scrollTo(0, 0);
  }, [page, searching]);

  // Arriving at a page clears any live query. The query lives in the
  // route so it survives a rail click, but that also meant a query left
  // in the box swallowed every arrival from OUTSIDE the surface —
  // Ctrl+, the sidebar, the account menu, the feed's ticker pill would
  // all navigate correctly and then land you on stale search results,
  // because `searching` outranks the page. Rail clicks already clear it
  // via goTo; this covers everyone else.
  useEffect(() => {
    onQueryChange("");
  }, [page, onQueryChange]);

  const handleResetAll = useCallback(() => {
    onPrefsChange(resetAll());
  }, [onPrefsChange]);

  return (
    <div className="flex h-full min-h-0">
      <SettingsRail
        ref={searchRef}
        active={searching ? null : page}
        onSelect={goTo}
        query={query}
        onQueryChange={onQueryChange}
        appVersion={shell.appVersion}
        onWhatsNew={() => goTo("updates")}
      />

      <div
        ref={paneRef}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin [scrollbar-gutter:stable]"
      >
        <div className="mx-auto max-w-[680px] px-8 pt-7 pb-10">
          {searching ? (
            <SearchResults query={query} results={results} onPick={goTo} />
          ) : (
            <>
              {/* Updates renders its own header — its subtitle is live
                  updater state rather than a fixed string. */}
              {page !== "updates" && (
                <PageHeader
                  title={meta.title}
                  subtitle={meta.subtitle}
                  action={
                    page === "ticker" ? (
                      <SettingsButton onClick={resetTicker}>
                        Reset ticker settings
                      </SettingsButton>
                    ) : undefined
                  }
                />
              )}

              {page === "appearance" && (
                <AppearancePage
                  appearance={prefs.appearance}
                  onAppearanceChange={(appearance) =>
                    onPrefsChange({ ...prefs, appearance })
                  }
                />
              )}

              {page === "window" && (
                <WindowStartupPage
                  window_={prefs.window}
                  onWindowChange={(window_) =>
                    onPrefsChange({ ...prefs, window: window_ })
                  }
                  startup={prefs.startup}
                  onStartupChange={(startup) =>
                    onPrefsChange({ ...prefs, startup })
                  }
                  autostartEnabled={shell.autostartEnabled}
                  onAutostartChange={shell.onAutostartChange}
                />
              )}

              {page === "shortcuts" && <ShortcutsPage />}

              {page === "ticker" && (
                <TickerPage prefs={prefs} onPrefsChange={onPrefsChange} />
              )}

              {page === "profile" && (
                <ProfilePlanPage
                  authenticated={shell.authenticated}
                  tier={shell.tier}
                  subscriptionInfo={shell.subscriptionInfo}
                  onLogin={shell.onLogin}
                  onLogout={shell.onLogout}
                />
              )}

              {page === "data" && (
                <DataPrivacyPage
                  authenticated={shell.authenticated}
                  onResetAll={handleResetAll}
                />
              )}

              {page === "updates" && (
                <UpdatesPage appVersion={shell.appVersion} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Search results ──────────────────────────────────────────────

function SearchResults({
  query,
  results,
  onPick,
}: {
  query: string;
  results: ReturnType<typeof searchSettings>;
  onPick: (page: SettingsPage, rowId: string) => void;
}) {
  return (
    <>
      <PageHeader
        title="Search"
        subtitle={
          results.length === 0
            ? `No settings match "${query.trim()}"`
            : `${results.length} setting${results.length === 1 ? " matches" : "s match"} "${query.trim()}"`
        }
      />

      {results.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge/60 px-4 py-10 text-center">
          <p className="text-ui-body font-medium text-fg">No settings found</p>
          <p className="mt-1 text-ui-meta text-fg-4">
            Try a different word — or pick a section on the left.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={`${r.page}:${r.rowId}`}>
              <button
                type="button"
                onClick={() => onPick(r.page, r.rowId)}
                className={`${CARD_SURFACE} flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left hover:border-accent/40`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ui-body font-semibold text-fg">
                    {r.label}
                  </span>
                  <span className="truncate text-ui-meta text-fg-4">
                    {r.description}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-ui-chip text-fg-4">
                  {SETTINGS_PAGE_META[r.page].label}
                  <ChevronRight size={13} aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
