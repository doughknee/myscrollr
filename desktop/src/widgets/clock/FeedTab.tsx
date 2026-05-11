/**
 * Clock widget FeedTab — desktop-native.
 *
 * Combines World Clock and Timer under a single tabbed interface.
 * Internal tab selection ("clocks" | "timer") is persisted to
 * Tauri store for session continuity.
 */
import { useState, useCallback } from "react";
import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
import { Timer } from "./Timer";
import { getStore, setStore } from "../../lib/store";
import type { FeedTabProps, WidgetManifest } from "../../types";
import type { ClockTab } from "./types";

// ── Tab persistence ─────────────────────────────────────────────

const TAB_KEY = "scrollr:widget:clock:tab";

function loadTab(): ClockTab {
  const raw = getStore<string>(TAB_KEY, "clocks");
  return raw === "clocks" || raw === "timer" ? raw : "clocks";
}

function saveTab(tab: ClockTab): void {
  setStore(TAB_KEY, tab);
}

// ── Widget manifest ─────────────────────────────────────────────

export const clockWidget: WidgetManifest = {
  id: "clock",
  name: "Clock",
  tabLabel: "Clock",
  description: "Local time, world clocks, and timers",
  hex: "#6366f1",
  icon: Clock,
  info: {
    about:
      "The Clock widget displays your local time on the ticker and provides " +
      "world clocks for tracking multiple time zones. It also includes a " +
      "countdown and stopwatch timer.",
    usage: [
      "Your local time appears on the ticker by default.",
      "Turn on world clocks in the Configure tab to add more time zones.",
      "Use the timer tab in the feed view to set countdowns or run a stopwatch.",
      "Hide specific time zones from the ticker in the Configure tab.",
    ],
  },
  FeedTab: ClockFeedTab,
};

// ── FeedTab ─────────────────────────────────────────────────────

function ClockFeedTab({ mode }: FeedTabProps) {
  const compact = mode === "compact";
  const [activeTab, setActiveTab] = useState<ClockTab>(loadTab);

  const switchTab = useCallback((tab: ClockTab) => {
    setActiveTab(tab);
    saveTab(tab);
  }, []);

  return (
    <div className="p-3 space-y-2">
      {/* Top-level tabs: Clocks | Timer */}
      <div className="flex items-center gap-1 px-1">
        {(["clocks", "timer"] as ClockTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`text-xs font-mono font-semibold uppercase tracking-wider px-3 py-1 rounded-lg transition-colors ${
              activeTab === tab
                ? tab === "clocks"
                  ? "text-widget-clock bg-widget-clock/10 border border-widget-clock/20"
                  : "text-widget-timer bg-widget-timer/10 border border-widget-timer/20"
                : "text-fg-2 hover:text-fg border border-transparent hover:border-edge"
            }`}
          >
            {tab === "clocks" ? "Clocks" : "Timer"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "clocks" ? (
        <WorldClock compact={compact} />
      ) : (
        <Timer compact={compact} />
      )}
    </div>
  );
}
