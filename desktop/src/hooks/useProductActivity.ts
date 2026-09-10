import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recordProductActivity } from "../api/client";
import { DEMO } from "../config";
import { isPrimaryTicker } from "../lib/windowRole";
import type { ProductActivityCategory } from "../api/client";

const TICK_MS = 1_000;
const MAX_CONTINUOUS_GAP_MS = 2_500;
const QUALIFY_MS = 30_000;

export interface QualificationState {
  day: string;
  lastMs: number;
  elapsedMs: number;
  attempts: number;
  sent: boolean;
  ready: boolean;
}

export function initialQualification(day: string, nowMs: number): QualificationState {
  return { day, lastMs: nowMs, elapsedMs: 0, attempts: 0, sent: false, ready: false };
}

export function advanceQualification(
  state: QualificationState,
  tick: { nowMs: number; utcDay: string; eligible: boolean },
): QualificationState {
  if (tick.utcDay !== state.day) return initialQualification(tick.utcDay, tick.nowMs);
  const gap = tick.nowMs - state.lastMs;
  if (!tick.eligible || gap <= 0 || gap > MAX_CONTINUOUS_GAP_MS) {
    return initialQualification(state.day, tick.nowMs);
  }
  if (state.sent || state.attempts >= 2) return { ...state, lastMs: tick.nowMs };
  const elapsedMs = state.elapsedMs + gap;
  return { ...state, lastMs: tick.nowMs, elapsedMs, ready: elapsedMs >= QUALIFY_MS };
}

const categoryMap: Record<string, ProductActivityCategory | undefined> = {
  sports: "sports",
  finance: "markets",
  markets: "markets",
  rss: "news",
  news: "news",
  fantasy: "fantasy",
  predictions: "predictions",
  utility: "utilities",
  utilities: "utilities",
};

export function categoriesForTicker(
  widgetIds: string[],
  resolveCategory: (id: string) => string | undefined,
): ProductActivityCategory[] {
  const categories = new Set<ProductActivityCategory>();
  for (const id of widgetIds) {
    const category = categoryMap[resolveCategory(id) ?? ""];
    if (category) categories.add(category);
  }
  return [...categories];
}

export function useProductActivity({
  authenticated,
  optedIn,
  widgetIds,
  resolveCategory,
  production = import.meta.env.PROD && !DEMO,
}: {
  authenticated: boolean;
  optedIn: boolean;
  widgetIds: string[];
  resolveCategory: (id: string) => string | undefined;
  production?: boolean;
}): void {
  useEffect(() => {
    if (!production || !isPrimaryTicker()) return;
    let state = initialQualification(new Date().toISOString().slice(0, 10), performance.now());
    let busy = false;
    let stopped = false;
    let request: AbortController | null = null;
    const tickerWindow = getCurrentWindow();

    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      const categories = categoriesForTicker(widgetIds, resolveCategory);
      const visible = await tickerWindow.isVisible().catch(() => false);
      const eligible =
        authenticated && optedIn && visible && document.visibilityState === "visible" && categories.length > 0;
      state = advanceQualification(state, {
        nowMs: performance.now(),
        utcDay: new Date().toISOString().slice(0, 10),
        eligible,
      });
      if (!eligible && request) {
        request.abort();
        request = null;
      }
      if (state.ready) {
        state = { ...state, ready: false, attempts: state.attempts + 1 };
        request = new AbortController();
        try {
          await recordProductActivity(categories, request.signal);
          state = { ...state, sent: true };
        } catch {
          // One retry is allowed by attempts < 2. Measurement never reaches UI.
        } finally {
          request = null;
        }
      }
      busy = false;
    };

    const timer = globalThis.setInterval(() => void tick(), TICK_MS);
    return () => {
      stopped = true;
      request?.abort();
      globalThis.clearInterval(timer);
    };
  }, [authenticated, optedIn, production, resolveCategory, widgetIds]);
}
