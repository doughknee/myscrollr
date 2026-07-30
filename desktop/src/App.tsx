import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTauriListener } from "./hooks/useTauriListener";
import { useDashboardCDC } from "./hooks/useDashboardCDC";
import { Menu, Submenu, CheckMenuItem, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { dashboardQueryOptions, queryKeys } from "./api/queries";
import { onStoreChange, setStore } from "./lib/store";
import ScrollrTicker from "./components/ScrollrTicker";
import TickerToolbar from "./components/TickerToolbar";
import { useReliableHover } from "./hooks/useReliableHover";
import {
  getValidToken,
  isAuthenticated as checkAuth,
  getTier,
} from "./auth";
import {
  dataWidgetsApi,
  isWidgetTickerEnabled,
  toggleDataWidgetVisibility,
} from "./api/client";
import {
  loadPref,
  savePref,
  loadPrefs,
  savePrefs,
  TICKER_GAPS,
  TICKER_HEIGHTS,
  toggleWidgetPin,
  toggleWidgetOnTicker,
} from "./preferences";
import type { SubscriptionTier } from "./auth";
import type { WidgetId } from "./api/client";
import type { DeliveryMode } from "./types";
import type { AppPreferences, TickerPosition } from "./preferences";
import { getCatalogItems, sourceForWidget } from "./marketplace";
import { getAllWidgets } from "./widgets/registry";
import { useWidgetTickerData } from "./hooks/useWidgetTickerData";
import { useTheme } from "./hooks/useTheme";
import { useCatalog } from "./hooks/useCatalog";


// ── Constants ────────────────────────────────────────────────────

import { API_BASE as API_URL, DEMO } from "./config";

/** Ticker window height in px: per-mode row height × scale. */
function tickerHeight(p: AppPreferences): number {
  return Math.round(
    TICKER_HEIGHTS[p.ticker.tickerMode] * (p.appearance.tickerScale / 100),
  );
}

// ── App (Ticker Window) ─────────────────────────────────────────

export default function App() {
  const queryClient = useQueryClient();

  // Keep the ticker's widget metadata in sync with the server catalog; falls
  // back to the bundled snapshot when offline.
  //
  // The version is used, not discarded. A catalog swap re-renders this
  // component, but `installedWidgetsMeta` below is memoised on [widgets]
  // alone — without the version in its deps it hands back the pre-refresh
  // names, colors and icons forever. This is the fourth instance of that
  // shape; __root.tsx, catalog.tsx and feed.tsx were the first three.
  const catalogVersion = useCatalog();

  // Auth + tier state (drives refetchInterval)
  const [authenticated, setAuthenticated] = useState(() => checkAuth());
  const [tier, setTier] = useState<SubscriptionTier>(() =>
    // getTier() decodes the stored JWT even when expired — gate on live auth
    // so an overnight-expired token starts at "free", not a stale paid tier.
    checkAuth() ? getTier() : "free",
  );

  // Delivery mode
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("polling");

  // ── Dashboard data ──────────────────────────────────────────────
  // The main window is the primary fetcher and broadcasts via Tauri store.
  // The ticker reads from the store and only polls as a slow fallback
  // (5 min) in case the main window is closed or slow.

  // ── Dashboard data — fed by the main window via store broadcast ──
  // The main window is the single source of truth for dashboard polling.
  // This query has no refetchInterval; it only serves as the TanStack Query
  // cache holder so child components can useQuery(dashboardQueryOptions()).
  // Data arrives via: (1) store broadcast from main window, (2) CDC merge.
  const { data: dashboard } = useQuery({
    ...dashboardQueryOptions(),
    refetchInterval: false,
  });

  // ── CDC merge engine (processes SSE events into dashboard cache) ──
  useDashboardCDC();

  // ── Sync dashboard from main window via store ──
  useEffect(() => {
    const unsub = onStoreChange("scrollr:dashboard", (newDashboard: unknown) => {
      if (newDashboard) {
        queryClient.setQueryData(queryKeys.dashboard, newDashboard);
      }
    });
    return unsub;
  }, [queryClient]);

  // Derive widgets and active tabs from query data
  const widgets = useMemo(
    () => dashboard?.widgets ?? [],
    [dashboard?.widgets],
  );

  const widgetTabs = useMemo(() => {
    if (widgets.length === 0) {
      // Demo mode (VITE_DEMO) talks to the local bridge, which serves only the
      // predictions slice and may not surface widgets[] on the ticker window
      // in time — show predictions rather than the finance/sports teaser the
      // bridge can't fill.
      if (DEMO) return ["predictions"];
      // Signed-out users get the finance + sports demo tabs so the
      // public-feed teaser renders on the ticker. Signed-in users with
      // zero widgets deliberately get an empty tab list so the ticker
      // renders its inline "no sources yet" CTA instead of pretending
      // to have data the user never opted into.
      return authenticated
        ? []
        : loadPref("activeFeedTabs", ["finance", "sports"]);
    }
    return widgets
      .filter((ch) => ch.enabled && isWidgetTickerEnabled(ch))
      .map((ch) => ch.widget_type);
  }, [widgets, authenticated]);

  // Visual metadata for installed widgets — used by the ticker's
  // "installed but nothing ticker-enabled" empty CTA so it can render
  // one quick-link chip per installed widget. We join the dashboard's
  // `widgets` (which gives us the truthy install state) with the
  // build-time widget registry (which gives us the display name, icon,
  // and brand hex). Memoized to keep referential equality stable across
  // renders that don't change the widget set.
  const installedWidgetsMeta = useMemo(() => {
    if (widgets.length === 0) return [];
    // Resolve each enabled widget row to its WIDGET display (name/icon/hex)
    // from the flat catalog, so split widgets show as "MLB"/"Stocks" — not
    // the coarse "Sports"/"Finance" source they read from.
    const metaById = new Map(getCatalogItems().map((it) => [it.id, it]));
    return widgets
      .filter((ch) => ch.enabled)
      .map((ch) => metaById.get(ch.widget_type))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({
        id: m.id,
        name: m.name,
        hex: m.hex,
        icon: m.icon,
      }));
  }, [widgets, catalogVersion]);

  // Persist active tabs when they change (side effect, not in useMemo)
  useEffect(() => {
    if (widgets.length > 0) {
      savePref("activeFeedTabs", widgetTabs);
    }
  }, [widgetTabs, widgets.length]);

  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  // Pin (always-on-top) state
  const [pinned, setPinned] = useState(() => loadPref("feedPinned", true));

  // Ticker position state (top/bottom of screen)
  const [tickerPosition, setTickerPosition] = useState<TickerPosition>(() =>
    loadPref("tickerPosition", "top"),
  );

  // Hover state for toolbar visibility.
  //
  // We use a custom `useReliableHover` hook instead of plain
  // `onMouseEnter` / `onMouseLeave` because the ticker is a
  // borderless, always-on-top Tauri window where standard
  // `mouseleave` sticks: alt-tabbing, switching desktops, or
  // clicking through to a window behind the ticker leaves the
  // hover state stuck in `true`, keeping the toolbar visible and
  // the persistent right-click hint hidden indefinitely. The hook
  // layers `pointerleave` + `window.blur` +
  // `document.visibilitychange` + a grace-poll backstop so the
  // state always settles back to `false` when the user's
  // attention is elsewhere. See `hooks/useReliableHover.ts`.
  const { hovered, bind: hoverBind } = useReliableHover();

  // Settings preferences
  const [prefs, setPrefs] = useState<AppPreferences>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const tierRef = useRef<SubscriptionTier>(tier);
  tierRef.current = tier;
  const sseActiveRef = useRef(false);

  // ── SSE lifecycle ───────────────────────────────────────────

  const startSSE = useCallback(async () => {
    // Demo mode talks to the no-auth bridge, which ignores the Bearer —
    // use a placeholder so the SSE stream still starts without Logto.
    const token = DEMO ? "demo" : await getValidToken();
    if (!token) return;
    sseActiveRef.current = true;
    setDeliveryMode("sse");
    await invoke("start_sse", { token, apiBase: API_URL }).catch(() => {
      sseActiveRef.current = false;
      setDeliveryMode("polling");
    });
  }, []);

  const stopSSE = useCallback(async () => {
    sseActiveRef.current = false;
    setDeliveryMode("polling");
    await invoke("stop_sse").catch(() => {});
  }, []);

  // Listen for SSE status events from the Rust backend
  useTauriListener<{ status: string; code?: number; error?: string }>(
    "sse-status",
    async (event) => {
      const { status: sseStatus } = event.payload;

      switch (sseStatus) {
        case "connected":
          setDeliveryMode("sse");
          break;
        case "auth-expired":
          sseActiveRef.current = false;
          setDeliveryMode("polling");
          await startSSE();
          break;
        case "disconnected":
        case "error":
          setDeliveryMode("polling");
          break;
      }
    },
  );

  // ── Initial SSE start ─────────────────────────────────────────
  // Real-time is universal: the server dropped the Ultimate-only gate
  // on /events with the widget-slot redesign (8e9f0f9, 2026-06-30) —
  // monetization is the slot count, not delivery. Every authenticated
  // tier streams; polling is only the reconnect fallback.

  useEffect(() => {
    async function init() {
      // Attempt silent token refresh to determine the real tier
      const token = await getValidToken();
      const resolvedTier = token ? getTier() : "free";
      setTier(resolvedTier);
      tierRef.current = resolvedTier;

      if (token && !authenticatedRef.current) {
        setAuthenticated(true);
      }

      if (DEMO || token) {
        startSSE();
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth sync from app window ──────────────────────────────────
  // When the user logs in/out via the app window, auth tokens change
  // in the store. onStoreChange fires here so we can react.

  useEffect(() => {
    return onStoreChange("scrollr:auth", () => {
      const wasAuth = authenticatedRef.current;
      const isAuth = checkAuth();
      setAuthenticated(isAuth);

      if (!isAuth && wasAuth) {
        // Just logged out — tear down SSE, reset to free tier
        if (sseActiveRef.current) stopSSE();
        setTier("free");
        tierRef.current = "free";
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        return;
      }

      if (isAuth) {
        // Re-read tier on every auth store change (login OR token refresh).
        // A forced refresh after subscription change writes new roles to the JWT.
        const newTier = getTier();
        setTier(newTier);
        tierRef.current = newTier;

        if (!wasAuth) {
          // Fresh login — invalidate dashboard and open the stream.
          // Tier no longer affects delivery (real-time is universal).
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          if (!sseActiveRef.current) startSSE();
        }
      }
    });
  }, [startSSE, stopSSE, queryClient]);

  // ── Cross-window prefs sync ─────────────────────────────────

  useEffect(() => {
    return onStoreChange<AppPreferences>("scrollr:settings", (next) => {
      if (!next) return;

      const prev = prefsRef.current;
      setPrefs(next);

      // Side effects: pin toggle
      if (next.window.pinned !== prev.window.pinned) {
        setPinned(next.window.pinned);
        savePref("feedPinned", next.window.pinned);
        invoke("pin_window", { pinned: next.window.pinned }).catch(() => {});
        // Keep the tray's "Pin on Top" checkmark in sync with the pref.
        invoke("sync_tray_pin", { pinned: next.window.pinned }).catch(() => {});
      }

      // Side effects: hide-on-fullscreen toggle (Windows AppBar)
      if (next.window.hideOnFullscreen !== prev.window.hideOnFullscreen) {
        invoke("set_hide_on_fullscreen", {
          value: next.window.hideOnFullscreen,
        }).catch(() => {});
      }

      // Side effects: ticker position
      if (next.window.tickerPosition !== prev.window.tickerPosition) {
        setTickerPosition(next.window.tickerPosition);
        savePref("tickerPosition", next.window.tickerPosition);
        invoke("position_ticker", { position: next.window.tickerPosition, height: tickerHeight(next) }).catch(() => {});
      }

    });
  }, []);

  // ── Theme + UI scale (shared hook) ────────────────────────────
  // The ticker window uses its own `tickerScale` so resizing the
  // ticker chips doesn't change the main app and vice versa.
  useTheme({
    shellId: "desktop-shell",
    themeFamily: prefs.appearance.themeFamily,
    themeMode: prefs.appearance.themeMode,
    uiScale: prefs.appearance.tickerScale,
    fontWeight: prefs.appearance.fontWeight,
    highContrast: prefs.appearance.highContrast,
  });

  // ── Broadcast delivery mode to app window ─────────────────────

  useEffect(() => {
    savePref("deliveryMode", deliveryMode);
  }, [deliveryMode]);

  // ── Initial setup ────────────────────────────────────────────

  useEffect(() => {
    const tickerH = prefs.ticker.showTicker ? tickerHeight(prefs) : 0;
    if (tickerH > 0) {
      // position_ticker sets size + position atomically via compositor
      invoke("position_ticker", { position: tickerPosition, height: tickerH })
        .then(() => getCurrentWindow().show())
        .catch(() => {});
    }
    invoke("pin_window", { pinned }).catch(() => {});
    // Initial state sync for the system-tray "Pin on Top" checkmark.
    // The tray is built with checked=false by default; mirror the stored
    // pref so the checkmark is accurate on app launch.
    invoke("sync_tray_pin", { pinned }).catch(() => {});
    // Initial sync for the Windows AppBar hide-on-fullscreen behavior.
    invoke("set_hide_on_fullscreen", {
      value: prefs.window.hideOnFullscreen,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize ticker when row/mode prefs change ───────────────────
  // position_ticker sets the full geometry (x, y, width, height)
  // atomically via compositor-specific commands. This avoids the
  // race condition where set_size() hasn't propagated before the
  // position calculation reads the old height.

  useEffect(() => {
    const tickerH = prefs.ticker.showTicker ? tickerHeight(prefs) : 0;
    if (tickerH > 0) {
      invoke("position_ticker", { position: tickerPosition, height: tickerH }).catch(() => {});
    }
  }, [
    prefs.ticker.tickerMode,
    prefs.appearance.tickerScale,
    prefs.ticker.showTicker,
    tickerPosition,
  ]);

  // ── Show/hide ticker window based on visibility ────────────────
  //
  // Also informs the Windows AppBar layer so the screen-space
  // reservation is released when the ticker is hidden (otherwise
  // maximized windows still respect a ticker that isn't there).
  // The AppBar will be re-registered automatically on the next
  // position_ticker invocation.

  useEffect(() => {
    const win = getCurrentWindow();
    if (prefs.ticker.showTicker) {
      // Show the window first, then re-apply position. Tauri's
      // show() restores the window's saved geometry which would
      // otherwise stomp the position the position_ticker effect
      // just set (effect ordering: position runs before this one).
      win.show()
        .then(() => {
          const h = tickerHeight(prefsRef.current);
          if (h > 0) {
            invoke("position_ticker", {
              position: prefsRef.current.window.tickerPosition,
              height: h,
            }).catch(() => {});
          }
        })
        .catch(() => {});
    } else {
      win.hide().catch(() => {});
    }
    invoke("set_ticker_visible", { visible: prefs.ticker.showTicker }).catch(() => {});
  }, [prefs.ticker.showTicker]);

  // ── Chip click → open external URL (or fall back to app) ───────

  const handleChipClick = useCallback(
    (widgetType: string, _itemId: string | number, url?: string) => {
      if (url) {
        // Try to open the URL in the system browser. If the shell IPC
        // rejects (e.g. capability not granted, malformed URL), fall
        // back to opening the desktop app so the user always gets SOME
        // observable response to the click — earlier behavior silently
        // logged to console where the user couldn't see it.
        open(url)
          .catch((err) => {
            console.error("[Scrollr] Failed to open external URL:", err);
            // Fallback: bring the main app window forward.
            savePref("activeItem", widgetType);
            invoke("show_app_window").catch(() => {});
          });
        return;
      }
      // No URL provided (widget chip, missing data) — open the desktop
      // app on the relevant widget page.
      savePref("activeItem", widgetType);
      invoke("show_app_window").catch(() => {});
    },
    [],
  );

  // ── Empty-ticker CTAs → open the main window on a specific route ──
  //
  // Both empty-ticker states (no widgets installed; widgets installed
  // but none ticker-enabled) need to navigate the main window to a
  // specific route and bring it forward. We use the existing
  // cross-window `scrollr:navigate` store key (already listened to in
  // __root.tsx around line 497) so the main window picks up the route
  // hint, navigates there, and clears the key — then we bring the main
  // window forward via the existing `show_app_window` Tauri command.
  const navigateMainWindow = useCallback((path: string) => {
    setStore("scrollr:navigate", path);
    invoke("show_app_window").catch(() => {});
  }, []);

  /** Sourceless state: nothing installed → open the Catalog. */
  const handleAddSources = useCallback(() => {
    navigateMainWindow("/catalog");
  }, [navigateMainWindow]);

  /**
   * Installed-but-ticker-off state: open a specific widget's feed —
   * the show-on-ticker toggle lives in the widget's own bar now.
   * Used by the per-widget quick-link chips.
   */
  const handleOpenWidget = useCallback(
    (widgetId: string) => {
      navigateMainWindow(`/widget/${widgetId}`);
    },
    [navigateMainWindow],
  );

  // ── DataWidgetRow quick-toggle (for context menu) ────────────────────

  // ── Unified row-selector handlers (for tray submenus) ──────────
  // Both feed.tsx and the tray menu now use the same mental model
  // ("Where should this source live? Off / Row 1 / 2 / 3"), so these
  // handlers mirror the row-change logic in routes/feed.tsx exactly.
  // See preferences.ts §"Unified ticker row selector helpers".

  const handleDataWidgetTickerChange = useCallback(
    async (widgetType: WidgetId, onTicker: boolean) => {
      // Server-side only: a data widget's ticker membership lives on
      // DataWidgetRow.ticker_enabled, not in prefs.
      try {
        await toggleDataWidgetVisibility(widgetType, onTicker);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch {
        // Silently fail — will sync on next dashboard poll/CDC event.
      }
    },
    [queryClient],
  );

  const handleWidgetTickerChange = useCallback((widgetId: string) => {
    setPrefs((prev) => {
      const updated = toggleWidgetOnTicker(prev, widgetId);
      savePrefs(updated);
      return updated;
    });
  }, []);

  // ── Widget pin toggle (hover icon on consolidated chip) ─────────

  const handleTogglePin = useCallback(
    (widgetId: string) => {
      setPrefs((prev) => {
        const updated = toggleWidgetPin(prev, widgetId);
        savePrefs(updated);
        return updated;
      });
    },
    [],
  );

  // ── Ticker position toggle ─────────────────────────────────────

  const handleTogglePosition = useCallback(() => {
    const next: TickerPosition = tickerPosition === "top" ? "bottom" : "top";
    setTickerPosition(next);
    savePref("tickerPosition", next);
    const updated = {
      ...prefsRef.current,
      window: { ...prefsRef.current.window, tickerPosition: next },
    };
    setPrefs(updated);
    savePrefs(updated);
    invoke("position_ticker", { position: next, height: tickerHeight(updated) }).catch(() => {});
  }, [tickerPosition]);

  // ── Toggle ticker visibility ─────────────────────────────────

  const handleToggleTicker = useCallback((forceHide?: boolean) => {
    const next = forceHide === undefined ? !prefsRef.current.ticker.showTicker : !forceHide;
    const updated = {
      ...prefsRef.current,
      ticker: { ...prefsRef.current.ticker, showTicker: next },
    };
    setPrefs(updated);
    savePrefs(updated);
  }, []);

  // ── System tray "Show/Hide Ticker" → toggle via prefs ──────────
  useTauriListener("toggle-ticker", () => handleToggleTicker());

  const handleToggleWindowPin = useCallback(() => {
    const next = !prefsRef.current.window.pinned;
    setPinned(next);
    savePref("feedPinned", next);
    const updated = {
      ...prefsRef.current,
      window: { ...prefsRef.current.window, pinned: next },
    };
    setPrefs(updated);
    savePrefs(updated);
    invoke("pin_window", { pinned: next }).catch(() => {});
    // Mirror the new state back into the system-tray "Pin on Top"
    // CheckMenuItem so its checkmark stays in sync with the right-click
    // menu. Harmless if the tray command is unavailable (e.g. dev mode).
    invoke("sync_tray_pin", { pinned: next }).catch(() => {});
  }, []);

  // ── System tray "Pin on Top" → same handler as the right-click menu ──
  useTauriListener("toggle-pin", () => handleToggleWindowPin());

  // ── Right-click → native context menu ──────────────────────────

  useEffect(() => {
    async function onContextMenu(e: MouseEvent) {
      e.preventDefault();

      const items: (Submenu | CheckMenuItem | MenuItem | PredefinedMenuItem)[] = [];
      const chs = widgetsRef.current;

      // Open Scrollr — most common action, top of menu
      items.push(
        await MenuItem.new({
          text: "Open Scrollr",
          action: () => {
            invoke("show_app_window").catch(() => {});
          },
        }),
      );

      items.push(await PredefinedMenuItem.new({ item: "Separator" }));

      // Per-source ticker toggles. One checkable item per widget: on the
      // ticker or not. This was a submenu of [Off, Row 1, Row 2, …] when
      // the ticker had multiple rows.

      // Widgets submenu — one unified row-picker list. The widget/slot model
      // has no coarse "widgets": server-backed data widgets (sports_nfl,
      // finance_stocks, …) and local widgets (clock, weather, …) sit together,
      // each labeled by its catalog name.
      const widgetSubmenus: CheckMenuItem[] = [];

      // Data widgets — the user's enabled widgets, labeled by their catalog
      // name ("NFL", "Stocks", "BBC News"), not the raw widget_type.
      const metaById = new Map(getCatalogItems().map((it) => [it.id, it]));
      for (const ch of chs) {
        const label =
          metaById.get(ch.widget_type)?.name ??
          `${ch.widget_type.charAt(0).toUpperCase()}${ch.widget_type.slice(1)}`;
        const onTicker = isWidgetTickerEnabled(ch);
        widgetSubmenus.push(
          await CheckMenuItem.new({
            text: label,
            checked: onTicker,
            enabled: ch.enabled !== false,
            action: () => {
              // Optimistic — flip the ref so the next menu build reflects
              // the change without waiting for the API round trip.
              const target = widgetsRef.current.find(
                (c) => c.widget_type === ch.widget_type,
              );
              if (target) target.ticker_enabled = !onTicker;
              handleDataWidgetTickerChange(ch.widget_type, !onTicker);
            },
          }),
        );
      }

      // Local widgets (clock, weather, …) — same row-picker pattern, over the
      // ones the user actually added.
      //
      // This used to iterate the whole renderer registry, which asks "does
      // this build ship the widget" when the question is "did the user add
      // it". A fresh install enables only `clock`, so the tray offered rows
      // for the other five — and picking one routes through
      // a handler that writes widgetsOnTicker but never enabledWidgets. activeTabs is widgetTabs + widgetsOnTicker, so
      // the chip really renders (sysmon needs no config to produce data)
      // while every slot count reads enabledWidgets.length — including the
      // one useAddWidget reports to the server. A widget on the ticker that
      // no cap can see.
      //
      // The widgetsOnTicker term keeps any pre-existing orphan listed, so it
      // stays removable rather than stranding its chip.
      const wp = prefsRef.current.widgets;
      for (const widget of getAllWidgets().filter(
        (mf) =>
          wp.enabledWidgets.includes(mf.id) ||
          wp.widgetsOnTicker.includes(mf.id),
      )) {
        widgetSubmenus.push(
          await CheckMenuItem.new({
            text: widget.name,
            checked: wp.widgetsOnTicker.includes(widget.id),
            action: () => handleWidgetTickerChange(widget.id),
          }),
        );
      }

      if (widgetSubmenus.length > 0) {
        items.push(
          await Submenu.new({ text: "Widgets", items: widgetSubmenus }),
        );
      }

      items.push(await PredefinedMenuItem.new({ item: "Separator" }));

      // Pin on Top
      items.push(
        await CheckMenuItem.new({
          text: "Pin on Top",
          checked: prefsRef.current.window.pinned,
          action: handleToggleWindowPin,
        }),
      );

      // Customize Ticker — opens main app to ticker settings
      items.push(
        await MenuItem.new({
          text: "Customize Ticker",
          action: () => {
            invoke("show_app_window").catch(() => {});
            // /ticker merged into /customize (its default tab); the
            // redirect shim that used to cover this is gone.
            setStore("scrollr:navigate", "/customize");
          },
        }),
      );

      // Position submenu (Top / Bottom)
      const currentPos = prefsRef.current.window.tickerPosition ?? "top";
      items.push(
        await Submenu.new({
          text: "Position",
          items: [
            await CheckMenuItem.new({
              text: "Top",
              checked: currentPos === "top",
              action: () => {
                if (currentPos !== "top") handleTogglePosition();
              },
            }),
            await CheckMenuItem.new({
              text: "Bottom",
              checked: currentPos === "bottom",
              action: () => {
                if (currentPos !== "bottom") handleTogglePosition();
              },
            }),
          ],
        }),
      );

      items.push(await PredefinedMenuItem.new({ item: "Separator" }));

      // Hide Ticker — action verb, not a checkbox
      items.push(
        await MenuItem.new({
          text: "Hide Ticker",
          action: () => handleToggleTicker(true),
        }),
      );

      // Quit
      items.push(
        await MenuItem.new({
          text: "Quit",
          action: () => {
            invoke("quit_app").catch(() => {});
          },
        }),
      );

      const menu = await Menu.new({ items });
      await menu.popup().catch(() => {});
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [handleDataWidgetTickerChange, handleWidgetTickerChange, handleTogglePosition]);

  // ── Merge widget + widget tabs ──────────────────────────────
  const activeTabs = useMemo(
    () => [...widgetTabs, ...prefs.widgets.widgetsOnTicker],
    [widgetTabs, prefs.widgets.widgetsOnTicker],
  );

  // ── Widget ticker data (local polling for clock/weather/sysmon) ──
  const widgetData = useWidgetTickerData(prefs.widgets);

  // ── Render ─────────────────────────────────────────────────────

  const showTicker = prefs.ticker.showTicker;

  return (
    <div id="desktop-shell" {...hoverBind}>
      {showTicker && (
        <>
          <TickerToolbar
            position={tickerPosition}
            hovered={hovered}
            onTogglePosition={handleTogglePosition}
            onHideTicker={() => handleToggleTicker(true)}
          />
          {(() => {
            // Empty-state CTAs, both gated on "the ticker would otherwise
            // render nothing":
            //   - Sourceless:   signed in, ZERO installed widgets.
            //                   CTA -> Browse catalog.
            //   - InstalledOff: signed in, has installed widgets, but
            //                   nothing would render for ANY reason —
            //                   widgets off, nothing picked yet (Finance
            //                   on but no symbols), offseason, etc. The
            //                   "has no chips" gate lives in the ticker
            //                   itself; this just says "if you have
            //                   nothing, here's the recovery UI".
            //                   CTA -> per-widget chips.
            const hasAnyPinnedWidget =
              Object.keys(prefs.widgets.pinnedWidgets ?? {}).length > 0;
            const showSourcelessCTA =
              authenticated && widgets.length === 0 && !hasAnyPinnedWidget;
            const showInstalledOffCTA =
              authenticated &&
              installedWidgetsMeta.length > 0 &&
              !hasAnyPinnedWidget;
            return (
              <ScrollrTicker
                dashboard={dashboard ?? null}
                activeTabs={activeTabs}
                widgetData={widgetData}
                onChipClick={handleChipClick}
                onTogglePin={handleTogglePin}
                pinnedWidgets={prefs.widgets.pinnedWidgets}
                speed={prefs.ticker.tickerSpeed}
                gap={TICKER_GAPS[prefs.ticker.tickerGap]}
                pauseOnHover={prefs.ticker.pauseOnHover}
                hoverSpeed={prefs.ticker.hoverSpeed}
                mixMode={prefs.ticker.mixMode}
                chipColorMode={prefs.ticker.chipColors}
                widgetDisplay={prefs.widgetDisplay}
                comfort={prefs.ticker.tickerMode === "comfort"}
                direction={prefs.ticker.tickerDirection}
                scrollMode={prefs.ticker.scrollMode}
                stepPause={prefs.ticker.stepPause}
                showSourcelessCTA={showSourcelessCTA}
                onAddSources={handleAddSources}
                showInstalledOffCTA={showInstalledOffCTA}
                installedWidgets={installedWidgetsMeta}
                onOpenWidget={handleOpenWidget}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
