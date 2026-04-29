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
import {
  getValidToken,
  isAuthenticated as checkAuth,
  getTier,
} from "./auth";
import {
  channelsApi,
  isChannelTickerEnabled,
  toggleChannelVisibility,
} from "./api/client";
import {
  loadPref,
  savePref,
  loadPrefs,
  savePrefs,
  TICKER_GAPS,
  TICKER_HEIGHTS,
  toggleWidgetPin,
  setChannelTickerRow,
  setWidgetTickerRow,
  getChannelTickerRow,
  getWidgetTickerRow,
} from "./preferences";
import { getMaxTickerRows } from "./tierLimits";
import type { SubscriptionTier } from "./auth";
import type { ChannelType } from "./api/client";
import type { DeliveryMode } from "./types";
import type { AppPreferences, TickerPosition } from "./preferences";
import { getAllWidgets } from "./widgets/registry";
import { useWidgetTickerData } from "./hooks/useWidgetTickerData";
import { useTheme } from "./hooks/useTheme";


// ── Constants ────────────────────────────────────────────────────

import { API_BASE as API_URL } from "./config";

// ── App (Ticker Window) ─────────────────────────────────────────

export default function App() {
  const queryClient = useQueryClient();

  // Auth + tier state (drives refetchInterval)
  const [authenticated, setAuthenticated] = useState(() => checkAuth());
  const [tier, setTier] = useState<SubscriptionTier>(() =>
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

  // Derive channels and active tabs from query data
  const channels = useMemo(
    () => dashboard?.channels ?? [],
    [dashboard?.channels],
  );

  const channelTabs = useMemo(() => {
    if (channels.length === 0) {
      return loadPref("activeFeedTabs", ["finance", "sports"]);
    }
    return channels
      .filter((ch) => ch.enabled && isChannelTickerEnabled(ch))
      .map((ch) => ch.channel_type);
  }, [channels]);

  // Persist active tabs when they change (side effect, not in useMemo)
  useEffect(() => {
    if (channels.length > 0) {
      savePref("activeFeedTabs", channelTabs);
    }
  }, [channelTabs, channels.length]);

  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  // Pin (always-on-top) state
  const [pinned, setPinned] = useState(() => loadPref("feedPinned", true));

  // Ticker position state (top/bottom of screen)
  const [tickerPosition, setTickerPosition] = useState<TickerPosition>(() =>
    loadPref("tickerPosition", "top"),
  );

  // Hover state for toolbar visibility
  const [hovered, setHovered] = useState(false);

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
    const token = await getValidToken();
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
        case "auth-expired": {
          sseActiveRef.current = false;
          setDeliveryMode("polling");
          const newToken = await getValidToken();
          if (newToken) {
            sseActiveRef.current = true;
            setDeliveryMode("sse");
            invoke("start_sse", { token: newToken, apiBase: API_URL }).catch(() => {
              sseActiveRef.current = false;
              setDeliveryMode("polling");
            });
          }
          break;
        }
        case "disconnected":
        case "error":
          setDeliveryMode("polling");
          break;
      }
    },
  );

  // ── Initial SSE start for ultimate tier ───────────────────────

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

      if (resolvedTier === "uplink_ultimate" || resolvedTier === "super_user") {
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
        const oldTier = tierRef.current;
        setTier(newTier);
        tierRef.current = newTier;

        if (!wasAuth) {
          // Fresh login — invalidate dashboard
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        }

        // Start/stop SSE based on tier change
        const newHasSSE = newTier === "uplink_ultimate" || newTier === "super_user";
        const oldHasSSE = oldTier === "uplink_ultimate" || oldTier === "super_user";
        if (newHasSSE && !oldHasSSE) {
          startSSE();
        } else if (!newHasSSE && sseActiveRef.current) {
          stopSSE();
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

      // Side effects: ticker position
      if (next.window.tickerPosition !== prev.window.tickerPosition) {
        setTickerPosition(next.window.tickerPosition);
        savePref("tickerPosition", next.window.tickerPosition);
        const h = Math.round(TICKER_HEIGHTS[next.ticker.tickerMode] * next.appearance.tickerRows * (next.appearance.uiScale / 100));
        invoke("position_ticker", { position: next.window.tickerPosition, height: h }).catch(() => {});
      }

    });
  }, []);

  // ── Theme + UI scale (shared hook) ────────────────────────────
  useTheme({
    shellId: "desktop-shell",
    theme: prefs.appearance.theme,
    uiScale: prefs.appearance.uiScale,
    fontWeight: prefs.appearance.fontWeight,
    highContrast: prefs.appearance.highContrast,
  });

  // ── Broadcast delivery mode to app window ─────────────────────

  useEffect(() => {
    savePref("deliveryMode", deliveryMode);
  }, [deliveryMode]);

  // ── Initial setup ────────────────────────────────────────────

  useEffect(() => {
    const tickerH = prefs.ticker.showTicker
      ? Math.round(TICKER_HEIGHTS[prefs.ticker.tickerMode] * prefs.appearance.tickerRows * (prefs.appearance.uiScale / 100))
      : 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize ticker when row/mode prefs change ───────────────────
  // position_ticker sets the full geometry (x, y, width, height)
  // atomically via compositor-specific commands. This avoids the
  // race condition where set_size() hasn't propagated before the
  // position calculation reads the old height.

  useEffect(() => {
    const tickerH = prefs.ticker.showTicker
      ? Math.round(TICKER_HEIGHTS[prefs.ticker.tickerMode] * prefs.appearance.tickerRows * (prefs.appearance.uiScale / 100))
      : 0;
    if (tickerH > 0) {
      invoke("position_ticker", { position: tickerPosition, height: tickerH }).catch(() => {});
    }
  }, [
    prefs.ticker.tickerMode,
    prefs.appearance.tickerRows,
    prefs.appearance.uiScale,
    prefs.ticker.showTicker,
    tickerPosition,
  ]);

  // ── Show/hide ticker window based on visibility ────────────────

  useEffect(() => {
    const win = getCurrentWindow();
    if (prefs.ticker.showTicker) {
      win.show().catch(() => {});
    } else {
      win.hide().catch(() => {});
    }
  }, [prefs.ticker.showTicker]);

  // ── Chip click → open external URL (or fall back to app) ───────

  const handleChipClick = useCallback(
    (channelType: string, _itemId: string | number, url?: string) => {
      if (url) {
        open(url).catch((err) => {
          console.error("[Scrollr] Failed to open external URL:", err);
        });
        return;
      }
      // No URL (widget chip, missing data) — fall back to opening
      // the desktop app on the relevant channel/widget page.
      savePref("activeItem", channelType);
      invoke("show_app_window").catch(() => {});
    },
    [],
  );

  // ── Channel quick-toggle (for context menu) ────────────────────

  // ── Unified row-selector handlers (for tray submenus) ──────────
  // Both feed.tsx and the tray menu now use the same mental model
  // ("Where should this source live? Off / Row 1 / 2 / 3"), so these
  // handlers mirror the row-change logic in routes/feed.tsx exactly.
  // See preferences.ts §"Unified ticker row selector helpers".

  const handleChannelRowChange = useCallback(
    async (channelType: ChannelType, row: number | null) => {
      // 1) Client-side: assign / unassign in tickerLayout. Optimistic update
      //    so the next tray menu rebuild reflects the change immediately.
      setPrefs((prev) => {
        const updated = setChannelTickerRow(prev, channelType, row);
        savePrefs(updated);
        return updated;
      });
      // 2) Server-side: flip Channel.ticker_enabled (true if row is set).
      try {
        await toggleChannelVisibility(channelType, row !== null);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch {
        // Silently fail — will sync on next dashboard poll/CDC event.
      }
    },
    [queryClient],
  );

  const handleWidgetRowChange = useCallback((widgetId: string, row: number | null) => {
    setPrefs((prev) => {
      const updated = setWidgetTickerRow(prev, widgetId, row);
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
    const h = Math.round(TICKER_HEIGHTS[updated.ticker.tickerMode] * updated.appearance.tickerRows * (updated.appearance.uiScale / 100));
    invoke("position_ticker", { position: next, height: h }).catch(() => {});
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
      const chs = channelsRef.current;

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

      // Per-source row picker — same mental model as the feed page
      // RowSelector. Each channel/widget gets its own submenu with
      // [Off, Row 1, Row 2, …] CheckMenuItems where exactly one is
      // checked at any time. The row count is dynamic: we show only
      // the rows the user has actually enabled in their ticker layout
      // (clamped to tier max, with a minimum of 1). A user running a
      // single row sees [Off, On]; a user with 3 rows sees all four
      // entries. This keeps the menu in lockstep with what's actually
      // visible on the ticker.
      const tierMax = getMaxTickerRows(tierRef.current);
      const layoutRows = prefsRef.current?.appearance?.tickerLayout?.rows
        ?.length ?? 1;
      const maxRows = Math.max(1, Math.min(tierMax, layoutRows));

      // Build one submenu of row CheckMenuItems for a source. The "Off"
      // entry is always present; row entries 1..maxRows follow.
      async function buildRowSubmenuItems(
        currentRow: number | null,
        onPick: (row: number | null) => void,
        disabled: boolean,
      ): Promise<CheckMenuItem[]> {
        const rowItems: CheckMenuItem[] = [];
        rowItems.push(
          await CheckMenuItem.new({
            text: "Off",
            checked: currentRow === null,
            enabled: !disabled,
            action: () => onPick(null),
          }),
        );
        if (maxRows === 1) {
          rowItems.push(
            await CheckMenuItem.new({
              text: "On",
              checked: currentRow === 0,
              enabled: !disabled,
              action: () => onPick(0),
            }),
          );
        } else {
          for (let i = 0; i < maxRows; i++) {
            rowItems.push(
              await CheckMenuItem.new({
                text: `Row ${i + 1}`,
                checked: currentRow === i,
                enabled: !disabled,
                action: () => onPick(i),
              }),
            );
          }
        }
        return rowItems;
      }

      // Channels submenu (only when authenticated with channels)
      if (chs.length > 0) {
        const channelSubmenus: Submenu[] = [];
        for (const ch of chs) {
          const channelType = ch.channel_type;
          const label =
            channelType.charAt(0).toUpperCase() + channelType.slice(1);
          const currentRow = getChannelTickerRow(prefsRef.current, ch);
          const rowItems = await buildRowSubmenuItems(
            currentRow,
            (row) => {
              // Optimistic update — flip the ref immediately so the next
              // menu build reflects the change without waiting for the API.
              const target = channelsRef.current.find(
                (c) => c.channel_type === channelType,
              );
              if (target) target.ticker_enabled = row !== null;
              handleChannelRowChange(channelType, row);
            },
            !ch.enabled,
          );
          channelSubmenus.push(
            await Submenu.new({ text: label, items: rowItems }),
          );
        }
        items.push(
          await Submenu.new({ text: "Channels", items: channelSubmenus }),
        );
      }

      // Widgets submenu — same row-picker pattern.
      const allWidgets = getAllWidgets();
      if (allWidgets.length > 0) {
        const widgetSubmenus: Submenu[] = [];
        for (const widget of allWidgets) {
          const currentRow = getWidgetTickerRow(prefsRef.current, widget.id);
          const rowItems = await buildRowSubmenuItems(
            currentRow,
            (row) => handleWidgetRowChange(widget.id, row),
            false,
          );
          widgetSubmenus.push(
            await Submenu.new({ text: widget.name, items: rowItems }),
          );
        }
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
            setStore("scrollr:navigate", "/settings?tab=ticker");
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
  }, [handleChannelRowChange, handleWidgetRowChange, handleTogglePosition]);

  // ── Merge channel + widget tabs ──────────────────────────────
  const activeTabs = useMemo(
    () => [...channelTabs, ...prefs.widgets.widgetsOnTicker],
    [channelTabs, prefs.widgets.widgetsOnTicker],
  );

  // ── Widget ticker data (local polling for clock/weather/sysmon) ──
  const widgetData = useWidgetTickerData(prefs.widgets);

  // ── Render ─────────────────────────────────────────────────────

  const showTicker = prefs.ticker.showTicker;

  return (
    <div
      id="desktop-shell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showTicker && (
        <>
          <TickerToolbar
            position={tickerPosition}
            hovered={hovered}
            onTogglePosition={handleTogglePosition}
            onHideTicker={() => handleToggleTicker(true)}
          />
          {prefs.appearance.tickerLayout.rows.map((row, i) => {
            // Empty sources = "show everything on this row" (1-row behaviour).
            // Otherwise filter activeTabs down to only the row's configured
            // sources. We pass activeTabs (not row.sources directly) so the
            // downstream pipeline still respects onboarding-level visibility.
            const rowTabs = row.sources.length > 0
              ? activeTabs.filter((tab) => row.sources.includes(tab))
              : activeTabs;
            return (
              <ScrollrTicker
                key={`row${i}`}
                dashboard={dashboard ?? null}
                activeTabs={rowTabs}
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
                channelDisplay={prefs.channelDisplay}
                comfort={prefs.ticker.tickerMode === "comfort"}
                rowIndex={i}
                totalRows={prefs.appearance.tickerLayout.rows.length}
                direction={prefs.ticker.tickerDirection}
                scrollMode={prefs.ticker.scrollMode}
                stepPause={prefs.ticker.stepPause}
                rowConfig={row}
                rowHasExplicitSources={row.sources.length > 0}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
