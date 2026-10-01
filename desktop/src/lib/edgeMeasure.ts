/**
 * What every ticker window says about its edge, shared across windows
 * (SCROLLR-284). A window cannot see another's bar, and the main window
 * sees none, yet the pin rule is measured on the NARROWEST ticker, so each
 * pages bar publishes `{bar, util}` and every window keeps the set.
 *
 * Tauri events carry it (`edge:measure`); a window that starts asks
 * (`edge:ask`) and the tickers answer. A ticker that closes without saying
 * so ages out: each republishes every 5 s and an entry expires after 15 s.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { emit } from "@tauri-apps/api/event";
import type { EdgeRoom } from "../components/pages/edgeRule";
import { useTauriListener } from "../hooks/useTauriListener";

const MEASURE = "edge:measure";
const ASK = "edge:ask";
const BEAT_MS = 5_000;
const TTL_MS = 15_000;

interface Measure {
  label: string;
  bar: number;
  util: number;
}

const seen = new Map<string, Measure & { at: number }>();
const subs = new Set<() => void>();
let room: EdgeRoom | null = null;

/** The narrowest bar and the widest utilities strip among the fresh reports, or null. */
export function currentEdgeRoom(): EdgeRoom | null {
  return room;
}

function refresh(now = Date.now()) {
  let next: EdgeRoom | null = null;
  for (const [label, m] of seen) {
    if (now - m.at > TTL_MS) seen.delete(label);
    else if (m.bar > 0) next = next ? { bar: Math.min(next.bar, m.bar), util: Math.max(next.util, m.util) } : { bar: m.bar, util: m.util };
  }
  if (next?.bar === room?.bar && next?.util === room?.util) return;
  room = next;
  subs.forEach((f) => f());
}

export function recordEdge(m: Measure, now = Date.now()) {
  seen.set(m.label, { ...m, at: now });
  refresh(now);
}

/** Forget everything (tests). */
export function resetEdge() {
  seen.clear();
  refresh();
}

/** Every window: keep the set, and ask the tickers for it once. */
export function useEdgeMeasures() {
  useTauriListener<Measure>(MEASURE, (e) => recordEdge(e.payload));
  useEffect(() => {
    emit(ASK).catch(() => {});
    const id = window.setInterval(() => refresh(), BEAT_MS);
    return () => window.clearInterval(id);
  }, []);
}

/** A pages bar: publish this window's measure now, on every change, and on each beat. */
export function usePublishEdge(label: string, bar: number, util: number) {
  const send = useCallback(() => {
    if (bar <= 0) return;
    recordEdge({ label, bar, util });
    emit(MEASURE, { label, bar, util } satisfies Measure).catch(() => {});
  }, [label, bar, util]);
  useEffect(() => {
    send();
    const id = window.setInterval(send, BEAT_MS);
    return () => window.clearInterval(id);
  }, [send]);
  useTauriListener(ASK, send);
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** The room, re-rendering when it changes. */
export function useEdgeRoom(): EdgeRoom | null {
  return useSyncExternalStore(subscribe, currentEdgeRoom);
}
