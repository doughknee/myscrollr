/**
 * Root layout route — the persistent app shell.
 *
 * Renders TitleBar + Sidebar + content <Outlet />.
 * Single navigation paradigm via the labeled Sidebar component.
 */
import {
  createRootRouteWithContext,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { Toaster, toast } from "sonner";
// Note: sonner CSS is imported in src/app-main.tsx so it ships in the
// entry bundle. Importing it here would put it in this route's
// code-split chunk, causing toasts to appear unstyled until the chunk
// CSS arrives (the original "unstyled until first Undo click" bug).

// Shell components
import TitleBar from "../components/TitleBar";
import Sidebar from "../components/Sidebar";
import ConnectionBanner from "../components/ConnectionBanner";
import TopBar from "../components/TopBar";

// Onboarding
import AuthGate from "../components/onboarding/AuthGate";

// Registries
import { getAllChannels } from "../channels/registry";
import { getAllWidgets, getWidget } from "../widgets/registry";
import { CANONICAL_ORDER } from "../marketplace";

// Data
import { dashboardQueryOptions } from "../api/queries";

// Preferences
import {
  loadPref,
  loadPrefs,
  savePrefs,
  consumeTickerLayoutChanged,
  resolveTheme,
} from "../preferences";
import type { AppPreferences } from "../preferences";
import {
  gcExpired as undoStackGc,
  pushSnapshot as pushUndoSnapshot,
  restoreSnapshot as restoreUndoSnapshot,
} from "../lib/undoStack";
import { showTipOnce, TIP_IDS } from "../lib/tips";

// Types
import type { DeliveryMode } from "../types";
import type { Channel, SubscriptionInfo } from "../api/client";

// Hooks
import { useTheme } from "../hooks/useTheme";
import { useAuthState } from "../hooks/useAuthState";
import { useChannelActions } from "../hooks/useChannelActions";
import { useWidgetActions } from "../hooks/useWidgetActions";
import { useDashboardCDC } from "../hooks/useDashboardCDC";
import { useTauriListener } from "../hooks/useTauriListener";
import { useDeliveryHealth } from "../hooks/useDeliveryHealth";
import { useNavHistory } from "../hooks/useNavHistory";
import { weatherQueryOptions } from "../api/queries";
import { fetchSubscription } from "../api/client";
import { getValidToken } from "../auth";

// CDC
import { POLL_INTERVALS } from "../cdc";

// Shell context
import { ShellContext, ShellDataContext } from "../shell-context";
import { PageIdentityProvider } from "../components/layout/page-context";

// Store
import { onStoreChange, setStore, removeStore } from "../lib/store";

// ── Route context ────────────────────────────────────────────────

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

// ── Platform detection ──────────────────────────────────────────

const IS_MACOS =
  (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform === "macOS" || /Mac/.test(navigator.platform);

// ── URL helpers ─────────────────────────────────────────────────

function parseRoute(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const [kind, itemId] = segments;

  if (kind === "feed" || pathname === "/") {
    return {
      activeItem: "",
      isChannel: false, isWidget: false, isFeed: true,
      isSettings: false, isMarketplace: false, isSupport: false,
    };
  }
  if (kind === "channel" && itemId) {
    return {
      activeItem: itemId,
      isChannel: true, isWidget: false, isFeed: false,
      isSettings: false, isMarketplace: false, isSupport: false,
    };
  }
  if (kind === "widget" && itemId) {
    return {
      activeItem: itemId,
      isChannel: false, isWidget: true, isFeed: false,
      isSettings: false, isMarketplace: false, isSupport: false,
    };
  }
  if (kind === "catalog") {
    return {
      activeItem: "",
      isChannel: false, isWidget: false, isFeed: false,
      isSettings: false, isMarketplace: true, isSupport: false,
    };
  }
  if (kind === "settings") {
    return {
      activeItem: "settings",
      isChannel: false, isWidget: false, isFeed: false,
      isSettings: true, isMarketplace: false, isSupport: false,
    };
  }
  if (kind === "support") {
    return {
      activeItem: "",
      isChannel: false, isWidget: false, isFeed: false,
      isSettings: false, isMarketplace: false, isSupport: true,
    };
  }
  return {
    activeItem: "",
    isChannel: false, isWidget: false, isFeed: true,
    isSettings: false, isMarketplace: false, isSupport: false,
  };
}

// ── Root Layout ─────────────────────────────────────────────────

function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const navHistory = useNavHistory();
  const route = parseRoute(location.pathname);

  // ── Auth (must be before dashboard query — tier drives refetchInterval) ──
  const auth = useAuthState();

  // ── Dashboard data (TanStack Query) ─────────────────────────
  const {
    data: dashboard,
    isLoading: loading,
  } = useQuery({
    ...dashboardQueryOptions(),
    refetchInterval: POLL_INTERVALS[auth.tier],
  });

  // ── CDC merge engine (processes SSE events into dashboard cache) ──
  useDashboardCDC();

  // ── Broadcast dashboard to ticker window via store ──
  useEffect(() => {
    if (dashboard) {
      setStore("scrollr:dashboard", dashboard);
    }
  }, [dashboard]);

  const channels: Channel[] = useMemo(() => dashboard?.channels ?? [], [dashboard]);

  // Filter to enabled channels only — Sidebar handles sorting by CHANNEL_ORDER
  const enabledChannels = useMemo(
    () => channels.filter((ch) => ch.enabled),
    [channels],
  );

  // ── Manifests ───────────────────────────────────────────────
  const allChannelManifests = useMemo(() => getAllChannels(), []);
  const allWidgets = useMemo(() => getAllWidgets(), []);

  // ── Preferences ─────────────────────────────────────────────
  const [prefs, setPrefs] = useState<AppPreferences>(loadPrefs);
  const [autostartOn, setAutostartOn] = useState(false);
  const enabledWidgets = prefs.widgets.enabledWidgets;

  // Surface the tier-clamp toast once when loadPrefs() dropped pinned
  // ticker rows (e.g. user downgraded Pro→Uplink and lost rows 2/3 of
  // their layout). Empty rows getting sliced doesn't trigger this.
  // See `migrateTickerLayout` and `consumeTickerLayoutChanged` in
  // preferences.ts for why we use a transient module-level signal
  // instead of plumbing a flag through the loadPrefs return value.
  //
  // Phase 1 (Apr 26) upgrade: the toast now lists the affected
  // sources by name and offers Undo. Clicking Undo restores the
  // pre-clamp layout from a snapshot the migration captured before
  // it dropped rows. The undo here is best-effort — if the user is
  // genuinely on a lower tier the next loadPrefs will re-clamp; the
  // user is expected to take a real action (upgrade or rearrange)
  // within the same session for the restore to "stick".
  useEffect(() => {
    const change = consumeTickerLayoutChanged();
    if (!change) return;

    const sourceList = change.droppedSources.slice(0, 3).join(", ");
    const more =
      change.droppedSources.length > 3
        ? ` and ${change.droppedSources.length - 3} more`
        : "";
    const description =
      change.droppedSources.length > 0
        ? `Removed: ${sourceList}${more}.`
        : undefined;

    // Snapshot the *current* (post-clamp) prefs before the toast
    // fires. If the user clicks Undo we splice the saved pre-clamp
    // rows back into that snapshot so the rest of the prefs (theme,
    // widgets, channels) stay current.
    const id = pushUndoSnapshot("Tier-clamp restore", prefs);

    toast.message("Your ticker layout was simplified to fit your plan.", {
      id: "scrollr-tier-clamp",
      description,
      duration: 8_000,
      action: {
        label: "Undo",
        onClick: () => {
          const base = restoreUndoSnapshot(id) ?? prefs;
          const restored: AppPreferences = {
            ...base,
            appearance: {
              ...base.appearance,
              tickerLayout: { rows: change.preClampRows },
            },
          };
          setPrefs(restored);
          savePrefs(restored);
          toast.success("Layout restored", {
            id: "scrollr-tier-clamp",
            duration: 1_500,
          });
        },
      },
    });
    // We intentionally exclude `prefs` from the deps array. The toast
    // and snapshot are a one-shot reaction to the migration that
    // already happened during loadPrefs; capturing the post-clamp
    // prefs at mount-time is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // ── Undo snapshot GC ───────────────────────────────────────
  // Snapshots pushed by `useUndoableAction` live in a module-level
  // ring buffer (see lib/undoStack.ts). They auto-expire 60s after
  // creation, but the module doesn't run its own timer to keep tests
  // deterministic — the shell drives GC instead. A 10s cadence is
  // generous: snapshots only need to be cleaned up roughly on the
  // order of their lifetime, and we don't want a per-second timer
  // adding noise to React DevTools.
  useEffect(() => {
    const timer = setInterval(() => undoStackGc(), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Inline persist helper used by the tip-firing effects below — we
  // can't reach `handlePrefsChange` here because it's declared further
  // down (after Sidebar / Outlet). Tip effects live up here so they
  // can subscribe to authentication early.
  const persistPrefs = useCallback((next: AppPreferences) => {
    setPrefs(next);
    savePrefs(next);
  }, []);

  // ── First-run discovery tip: right-click the ticker ─────────
  // Surfaces the ticker context menu (channels, widgets, position,
  // "Customize Ticker") to users who would never know it exists.
  // Fires exactly once per install, gated on `prefs.tipsShown`. We
  // delay 4 seconds to let the wizard close and the dashboard paint
  // first — the toast is meant to be a gentle nudge, not a greeting.
  useEffect(() => {
    if (!auth.authenticated) return;
    if (!prefs.ticker.showTicker) return;
    if (prefs.tipsShown.includes(TIP_IDS.TICKER_RIGHT_CLICK)) return;
    const t = setTimeout(() => {
      showTipOnce(TIP_IDS.TICKER_RIGHT_CLICK, prefs, persistPrefs, {
        title: "Tip: right-click the ticker",
        description:
          "Quick controls for channels, widgets, position, and Customize Ticker.",
        duration: 7_000,
      });
    }, 4_000);
    return () => clearTimeout(t);
    // We only want this to fire once per session at most. The deps
    // are intentionally narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.authenticated, prefs.ticker.showTicker]);

  // ── First-run discovery tip: tray still running on close ────
  // Triggered when the user clicks the title-bar X for the first
  // time. Tauri's default behavior on this app is "hide, don't quit"
  // — the tray icon keeps running. New users assume X = quit (most
  // apps do), so when they realise the ticker is still on top they
  // panic. This tip explicitly tells them where to find the app
  // again.
  //
  // We listen for the close-requested event AND fire the tip BEFORE
  // hiding so the toast lingers in the user's last frame of the
  // window. It also nudges them to use the tray icon next time.
  useEffect(() => {
    if (!auth.authenticated) return;
    if (prefs.tipsShown.includes(TIP_IDS.TRAY_STILL_RUNNING)) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onCloseRequested(() => {
        showTipOnce(TIP_IDS.TRAY_STILL_RUNNING, prefs, persistPrefs, {
          title: "Scrollr is still running",
          description:
            "Click the tray icon (top of your screen) to bring the app back.",
          duration: 8_000,
        });
        // Don't preventDefault — let Tauri's hide-on-close behavior
        // run as configured. The toast appears, the window hides;
        // next time the user reopens, the toast is gone but the
        // tipsShown flag is set so it never fires again.
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.authenticated, prefs.tipsShown.length]);

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    loadPref<DeliveryMode>("deliveryMode", "polling"),
  );
  const [billingBannerDismissed, setBillingBannerDismissed] = useState(false);

  // ── App / auth state ────────────────────────────────────────
  // The wizard was removed in the IA refactor (2026-05-09). New
  // users land directly on /feed which renders an empty hero card.
  const showAuthGate = !auth.authenticated;
  const showApp = auth.authenticated;

  // ── SSE status tracking ─────────────────────────────────────
  // Listen directly for SSE status events from the Rust backend.
  // Both windows receive these via Tauri's broadcast; no store relay needed.
  useTauriListener<{ status: string }>(
    "sse-status",
    (event) => {
      const mode: DeliveryMode =
        event.payload.status === "connected" ? "sse" : "polling";
      setDeliveryMode(mode);
    },
  );

  // ── Connection-health tick ──────────────────────────────────
  // Drives the "X ago" age label in `ConnectionIndicator`. We tick
  // once every 5s — the indicator only changes label visibly at the
  // boundary between "Live" and "Stale" (60s) and at the offline
  // threshold (5min), so a 1Hz timer would over-render. 5s is enough
  // resolution to keep the age label feeling alive without burning
  // a frame per second.
  const [healthNow, setHealthNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setHealthNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const deliveryHealth = useDeliveryHealth({
    deliveryMode,
    tier: auth.tier,
    now: healthNow,
  });

  // ── Tray navigation (e.g. "Report a Bug" menu item) ────────
  useTauriListener<string>("navigate-to", (event) => {
    if (event.payload) {
      navigate({ to: event.payload });
    }
  });

  // ── Extracted hooks ─────────────────────────────────────────

  const channelActions = useChannelActions();
  const widgetActions = useWidgetActions(prefs, setPrefs, route.activeItem);

  // Shell-level weather polling — keeps data fresh regardless of which page is visible.
  // Permanent observer so refetchInterval runs even when WeatherFeedTab is unmounted.
  // The queryFn writes to the Tauri store on success (cross-window sync for ticker).
  useQuery({
    ...weatherQueryOptions(),
    enabled: enabledWidgets.includes("weather"),
  });

  // ── Subscription info — fetched for billing UI in Account tab + banner ──
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);

  const refreshSubscription = useCallback(async () => {
    if (!auth.authenticated) { setSubscriptionInfo(null); return; }
    try {
      const sub = await fetchSubscription();
      setSubscriptionInfo(sub);

      // Super users get their tier from the Logto role, not from Stripe.
      // Skip mismatch detection — they have no subscription to compare against.
      if (auth.tier === "super_user") return;

      // Detect tier mismatch: the JWT may still carry stale roles after a
      // subscription change.  Force a token refresh so the new Logto roles
      // propagate to the JWT, which updates tier / SSE / enforcement.
      const expected = sub.status === "trialing"
        ? "uplink_ultimate"
        : sub.plan.startsWith("ultimate") ? "uplink_ultimate"
        : sub.plan.startsWith("pro") ? "uplink_pro"
        : sub.plan === "free" || sub.status === "none" ? "free"
        : "uplink";
      if (auth.tier !== expected) {
        await getValidToken(true);   // force refresh — writes new auth to store
        auth.refreshTier();          // re-read tier from the fresh JWT
      }
    } catch {
      setSubscriptionInfo(null);
    }
  }, [auth.authenticated, auth.tier, auth.refreshTier]);

  // Fetch on auth change + periodic refresh every 5 minutes
  useEffect(() => {
    refreshSubscription();
    if (!auth.authenticated) return;
    const id = setInterval(refreshSubscription, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshSubscription]);

  // Also refresh when window gains focus
  useEffect(() => {
    const onFocus = () => { if (auth.authenticated) refreshSubscription(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [auth.authenticated, refreshSubscription]);

  // Apply theme + UI scale
  useTheme({
    shellId: "app-shell",
    theme: prefs.appearance.theme,
    uiScale: prefs.appearance.uiScale,
    fontWeight: prefs.appearance.fontWeight,
    highContrast: prefs.appearance.highContrast,
  });

  // ── Auth sync — refresh tier on dashboard load ──────────────
  useEffect(() => {
    auth.syncAuthFromDashboard(dashboard);
  }, [dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve empty route — redirect / to /feed ───────────────
  useEffect(() => {
    if (location.pathname === "/" && !loading) {
      navigate({ to: "/feed" });
    }
  }, [location.pathname, loading, navigate]);

  // ── Cross-window sync ───────────────────────────────────────
  // Delivery mode is now synced via the direct sse-status Tauri listener above.
  useEffect(() => {
    const unsub1 = onStoreChange<AppPreferences>("scrollr:settings", (val) => {
      if (val) setPrefs(val);
    });
    // Cross-window navigation requests (e.g. ticker context menu → "Customize Ticker")
    const unsub2 = onStoreChange<string>("scrollr:navigate", (path) => {
      if (path) {
        navigate({ to: path });
        // Clear the key so it can be triggered again
        removeStore("scrollr:navigate");
      }
    });
    return () => { unsub1(); unsub2(); };
  }, [navigate]);

  useEffect(() => {
    isAutostartEnabled().then(setAutostartOn).catch(() => {});
  }, []);

  // ── Navigation handlers ─────────────────────────────────────

  // Keep a ref to channels so handleSelectItem doesn't depend on
  // the volatile `channels` array, which changes every dashboard refetch.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const handleSelectItem = useCallback(
    (id: string) => {
      if (id === "settings") {
        navigate({ to: "/settings", search: { tab: "general" } });
        return;
      }
      if (channelsRef.current.some((ch) => ch.channel_type === id)) {
        navigate({ to: "/channel/$type/$tab", params: { type: id, tab: "feed" } });
        return;
      }
      if (getWidget(id)) {
        navigate({ to: "/widget/$id/$tab", params: { id, tab: "feed" } });
        return;
      }
      navigate({ to: "/feed" });
    },
    [navigate],
  );

  const handleNavigateToFeed = useCallback(() => navigate({ to: "/feed" }), [navigate]);
  const handleNavigateToSettings = useCallback(() => navigate({ to: "/settings", search: { tab: "general" } }), [navigate]);
  const handleNavigateToMarketplace = useCallback(() => navigate({ to: "/catalog" }), [navigate]);
  const handleNavigateToSupport = useCallback(() => navigate({ to: "/support" }), [navigate]);

  const handleSelectPinned = useCallback(
    (id: string, kind: "channel" | "widget") => {
      if (kind === "channel") {
        navigate({ to: "/channel/$type/$tab", params: { type: id, tab: "feed" } });
      } else {
        navigate({ to: "/widget/$id/$tab", params: { id, tab: "feed" } });
      }
    },
    [navigate],
  );

  // Build the sidebar source list from the user's enabled channels and
  // widgets. Channels come from the live `dashboard.channels` payload
  // (filtered to `enabled === true`); widgets come from
  // `prefs.widgets.enabledWidgets`. Both are sorted via the shared
  // CANONICAL_ORDER so the sidebar matches the catalog grid order.
  // `Channel.ticker_enabled` is intentionally NOT consulted here — that
  // flag controls whether chips appear on the ticker, not whether the
  // channel appears in navigation.
  const sidebarSources = useMemo(() => {
    const enabledChannelIds = new Set<string>(
      (dashboard?.channels ?? [])
        .filter((c) => c.enabled === true)
        .map((c) => c.channel_type),
    );
    const enabledWidgetIds = new Set(prefs.widgets.enabledWidgets);

    const sources: Array<{
      id: string;
      name: string;
      hex: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      kind: "channel" | "widget";
    }> = [];

    for (const id of CANONICAL_ORDER) {
      if (enabledChannelIds.has(id)) {
        const m = allChannelManifests.find((m) => m.id === id);
        if (m) {
          sources.push({ id, name: m.name, hex: m.hex, icon: m.icon, kind: "channel" });
        }
      } else if (enabledWidgetIds.has(id)) {
        const m = allWidgets.find((w) => w.id === id);
        if (m) {
          sources.push({ id, name: m.name, hex: m.hex, icon: m.icon, kind: "widget" });
        }
      }
    }
    return sources;
  }, [dashboard?.channels, prefs.widgets.enabledWidgets, allChannelManifests, allWidgets]);

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ctrl+, → open settings
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/settings", search: { tab: "general" } });
        return;
      }

      // Ctrl+T → toggle standalone ticker visibility
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        const next = {
          ...prefs,
          ticker: { ...prefs.ticker, showTicker: !prefs.ticker.showTicker },
        };
        setPrefs(next);
        savePrefs(next);
        return;
      }

      // Ctrl+Shift+T → cycle theme
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
        e.preventDefault();
        const cycle: Record<string, string> = { dark: "light", light: "system", system: "dark" };
        const nextTheme = cycle[prefs.appearance.theme] ?? "dark";
        const next = {
          ...prefs,
          appearance: { ...prefs.appearance, theme: nextTheme as AppPreferences["appearance"]["theme"] },
        };
        setPrefs(next);
        savePrefs(next);
        return;
      }

      if (e.key === "Escape") {
        if (auth.loggingIn) { auth.setLoggingIn(false); return; }
        if (auth.sessionExpired) { auth.setSessionExpired(false); return; }
        if (route.isChannel || route.isWidget) {
          const segments = location.pathname.split("/").filter(Boolean);
          const tab = segments[2];
          if (tab && tab !== "feed") {
            if (route.isChannel) {
              navigate({ to: "/channel/$type/$tab", params: { type: route.activeItem, tab: "feed" } });
            } else {
              navigate({ to: "/widget/$id/$tab", params: { id: route.activeItem, tab: "feed" } });
            }
            return;
          }
          navigate({ to: "/feed" });
          return;
        }
        if (route.isSettings) {
          navigate({ to: "/feed" });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [auth.loggingIn, auth.sessionExpired, route, location.pathname, navigate, prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Settings handlers ───────────────────────────────────────

  // Alias for the inline `persistPrefs` declared earlier in this
  // component — kept under its original name so all the existing
  // shell-context wiring further down continues to read naturally.
  const handlePrefsChange = persistPrefs;

  const handleAutostartChange = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      setAutostartOn(enabled);
    } catch (err) {
      console.error("[Scrollr] Autostart toggle failed:", err);
      toast.error("Couldn't update startup settings");
    }
  }, []);

  // ── ControlStrip handlers ───────────────────────────────────
  // Two ambient toggles always visible below the title bar so users
  // never have to dig into Settings → Ticker to toggle the entire
  // product on/off. Same prefs as Settings → Ticker top toggle and
  // Settings → Appearance → Always on top — single source of truth.
  const handleTickerToggle = useCallback(() => {
    persistPrefs({
      ...prefs,
      ticker: { ...prefs.ticker, showTicker: !prefs.ticker.showTicker },
    });
  }, [prefs, persistPrefs]);

  const handlePinToggle = useCallback(() => {
    persistPrefs({
      ...prefs,
      window: { ...prefs.window, pinned: !prefs.window.pinned },
    });
  }, [prefs, persistPrefs]);

  // ── Shell context values (split: stable + volatile) ────────

  const shellStableValue = useMemo(
    () => ({
      prefs,
      onPrefsChange: handlePrefsChange,
      authenticated: auth.authenticated,
      tier: auth.tier,
      subscriptionInfo,
      onLogin: auth.handleLogin,
      onLogout: auth.handleLogout,
      autostartEnabled: autostartOn,
      onAutostartChange: handleAutostartChange,
      appVersion,
      allChannelManifests,
      allWidgets,
      onToggleChannelTicker: channelActions.handleToggleChannel,
      onToggleWidgetTicker: widgetActions.handleToggleWidgetTicker,
      onAddChannel: channelActions.handleAddChannel,
      onDeleteChannel: channelActions.handleDeleteChannel,
      onToggleWidget: widgetActions.handleToggleWidget,
      onSelectItem: handleSelectItem,
    }),
    [
      prefs, handlePrefsChange, auth.authenticated, auth.tier, subscriptionInfo,
      auth.handleLogin, auth.handleLogout, autostartOn, handleAutostartChange,
      appVersion, allChannelManifests, allWidgets,
      channelActions.handleToggleChannel, widgetActions.handleToggleWidgetTicker,
      channelActions.handleAddChannel, channelActions.handleDeleteChannel,
      widgetActions.handleToggleWidget, handleSelectItem,
    ],
  );

  const shellDataValue = useMemo(
    () => ({ channels, dashboard }),
    [channels, dashboard],
  );

  // ── Render ──────────────────────────────────────────────────

  // Resolve theme for portal-based components (Toaster) that don't
  // inherit the shell's data-theme attribute.
  const resolvedToasterTheme = resolveTheme(prefs.appearance.theme);

  return (
    <div
      id="app-shell"
      className={clsx(
        "flex flex-col h-screen w-screen overflow-hidden bg-surface text-fg",
        !IS_MACOS && "custom-chrome",
      )}
    >
      {/* ── Auth gate: unauthenticated users ── */}
      {showAuthGate && <AuthGate onLogin={auth.handleLogin} />}

      {/* ── Main app shell: authenticated ── */}
      {showApp && (
        <PageIdentityProvider>
          {!IS_MACOS && <TitleBar />}

          {/* TopBar — primary chrome row spanning the full window.
              Houses the Scrollr brand mark, Spotify-style forward/back
              navigation, page-identity breadcrumb (read from
              PageContext), entityAction, and the ambient ticker/pin/
              connection controls. Always visible regardless of route. */}
          <TopBar
            tickerOn={prefs.ticker.showTicker}
            pinned={prefs.window.pinned}
            health={deliveryHealth}
            canBack={navHistory.canBack}
            canForward={navHistory.canForward}
            onNavigateHome={handleNavigateToFeed}
            onBack={navHistory.back}
            onForward={navHistory.forward}
            onToggleTicker={handleTickerToggle}
            onTogglePin={handlePinToggle}
          />

          <div className="flex flex-1 min-h-0 overflow-hidden">
            <Sidebar
              isSettings={route.isSettings}
              isMarketplace={route.isMarketplace}
              isSupport={route.isSupport}
              activeItem={route.activeItem}
              sources={sidebarSources}
              onNavigateToMarketplace={handleNavigateToMarketplace}
              onNavigateToSettings={handleNavigateToSettings}
              onNavigateToSupport={handleNavigateToSupport}
              onSelectItem={handleSelectPinned}
            />

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
              <ConnectionBanner deliveryMode={deliveryMode} tier={auth.tier} />

              {auth.sessionExpired && (
                <div className="flex items-center justify-between px-4 py-2 bg-warn/10 border-b border-warn/20 shrink-0">
                  <span className="text-xs text-warn">
                    Your session has expired. Sign in again to access your channels.
                  </span>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button
                      onClick={auth.handleLogin}
                      className="text-xs font-medium text-warn hover:text-fg transition-colors"
                    >
                      Sign in
                    </button>
                    <button
                      onClick={() => auth.setSessionExpired(false)}
                      className="text-xs text-fg-4 hover:text-fg-3 transition-colors"
                      aria-label="Dismiss"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Billing banner — trial ending, past-due, or canceling */}
              {auth.authenticated && !billingBannerDismissed && (() => {
                const s = subscriptionInfo;
                if (!s) return null;
                // Trial ending in ≤3 days
                if (s.status === "trialing" && s.trial_end) {
                  const days = Math.max(0, Math.ceil((s.trial_end * 1000 - Date.now()) / 86_400_000));
                  if (days <= 3) {
                    return (
                      <div className="flex items-center justify-between px-4 py-2 bg-info/10 border-b border-info/20 shrink-0">
                        <span className="text-xs text-info">
                          {days === 0 ? "Your trial ends today." : `Your trial ends in ${days} day${days === 1 ? "" : "s"}.`}
                          {" "}Your card will be charged automatically.
                        </span>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <button
                            onClick={() => navigate({ to: "/settings", search: { tab: "account" } })}
                            className="text-xs font-medium text-info hover:text-fg transition-colors"
                          >
                            View plan
                          </button>
                          <button
                            onClick={() => setBillingBannerDismissed(true)}
                            className="text-xs text-fg-4 hover:text-fg-3 transition-colors"
                            aria-label="Dismiss"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    );
                  }
                }
                // Past due
                if (s.status === "past_due") {
                  return (
                    <div className="flex items-center justify-between px-4 py-2 bg-error/10 border-b border-error/20 shrink-0">
                      <span className="text-xs text-error">
                        Your payment failed. Update your payment method to keep your plan.
                      </span>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                          onClick={() => navigate({ to: "/settings", search: { tab: "account" } })}
                          className="text-xs font-medium text-error hover:text-fg transition-colors"
                        >
                          Fix payment
                        </button>
                        <button
                          onClick={() => setBillingBannerDismissed(true)}
                          className="text-xs text-fg-4 hover:text-fg-3 transition-colors"
                          aria-label="Dismiss"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                }
                // Canceling
                if (s.status === "canceling") {
                  return (
                    <div className="flex items-center justify-between px-4 py-2 bg-warn/10 border-b border-warn/20 shrink-0">
                      <span className="text-xs text-warn">
                        Your subscription is set to cancel.
                        {s.current_period_end && ` Access until ${new Date(s.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`}
                      </span>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                          onClick={() => navigate({ to: "/settings", search: { tab: "account" } })}
                          className="text-xs font-medium text-warn hover:text-fg transition-colors"
                        >
                          Manage
                        </button>
                        <button
                          onClick={() => setBillingBannerDismissed(true)}
                          className="text-xs text-fg-4 hover:text-fg-3 transition-colors"
                          aria-label="Dismiss"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* PageLayout (used by every route) owns its own scroll
                  for its content area. The outer wrapper just provides
                  the flex slot for it to fill. */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ShellContext.Provider value={shellStableValue}>
                  <ShellDataContext.Provider value={shellDataValue}>
                    <Outlet />
                  </ShellDataContext.Provider>
                </ShellContext.Provider>
              </div>

              <Toaster theme={resolvedToasterTheme} richColors position="bottom-right" />
            </main>
          </div>
        </PageIdentityProvider>
      )}

      {/* Signing-in overlay — shows on ALL states (auth gate triggers login too) */}
      {auth.loggingIn && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Signing in"
          className="absolute inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm"
        >
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-fg-2">
              Signing you in...
            </p>
            <p className="text-xs text-fg-3 mt-1">
              Finish signing in from your browser
            </p>
            <button
              onClick={() => auth.setLoggingIn(false)}
              className="mt-4 px-4 py-1.5 rounded-lg text-xs font-medium text-fg-3 hover:text-fg-2 hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toaster must be available in all states */}
      {!showApp && <Toaster theme={resolvedToasterTheme} richColors position="bottom-right" />}
    </div>
  );
}
