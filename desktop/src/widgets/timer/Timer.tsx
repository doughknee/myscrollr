/**
 * Timer section — pomodoro, countdown, and stopwatch.
 *
 * Timer state is persisted to Tauri store so it survives
 * window close/reopen within the same session.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { LS_TIMER_STATE } from "../../constants";
import { getStore, setStore } from "../../lib/store";
import { loadPrefs } from "../../preferences";
import { getPomodoroTiming, reconcileIdlePomodoroTarget } from "./pomodoro";
import type { TimerMode, TimerState } from "./types";

// ── Constants ───────────────────────────────────────────────────

const COUNTDOWN_PRESETS = [
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "10m", secs: 600 },
  { label: "15m", secs: 900 },
  { label: "30m", secs: 1800 },
  { label: "60m", secs: 3600 },
];

// ── Storage ─────────────────────────────────────────────────────

const TIMER_KEY = LS_TIMER_STATE;

function loadPomodoroTiming() {
  return getPomodoroTiming(loadPrefs().widgets.timer.pomodoro);
}

function defaultTimerState(): TimerState {
  return {
    mode: "pomodoro",
    startedAt: null,
    bankedMs: 0,
    targetSecs: loadPomodoroTiming().workSecs,
    completedSessions: 0,
  };
}

function loadTimerState(): TimerState {
  const s = getStore<TimerState | null>(TIMER_KEY, null);
  return s && typeof s.mode === "string"
    ? reconcileIdlePomodoroTarget(s, loadPomodoroTiming().workSecs)
    : defaultTimerState();
}

function saveTimerState(s: TimerState): void {
  setStore(TIMER_KEY, s);
}

// ── Helpers ─────────────────────────────────────────────────────

function getElapsedMs(s: TimerState): number {
  return s.startedAt === null
    ? s.bankedMs
    : s.bankedMs + (Date.now() - s.startedAt);
}

function fmtDuration(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function playCompletionTone(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [520, 780].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.5);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    /* Web Audio not available */
  }
}

// ── Circular Progress ───────────────────────────────────────────

function CircularProgress({
  progress,
  size,
  strokeWidth,
  running,
  children,
}: {
  progress: number;
  size: number;
  strokeWidth: number;
  running: boolean;
  children: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-widget-timer/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="text-widget-timer transition-[stroke-dashoffset] duration-300"
          style={
            running
              ? {
                  filter:
                    "drop-shadow(0 0 4px rgba(245, 158, 11, 0.4))",
                }
              : undefined
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ── Timer Mode Tabs ─────────────────────────────────────────────

function TimerModeTabs({
  activeMode,
  size,
  onSwitch,
}: {
  activeMode: TimerMode;
  size: "sm" | "md";
  onSwitch: (m: TimerMode) => void;
}) {
  const cls =
    size === "sm"
      ? "text-[11px] px-2 py-0.5 rounded"
      : "text-xs px-3 py-1.5 rounded-lg";
  return (
    <div className="flex items-center justify-center gap-1">
      {(["pomodoro", "countdown", "stopwatch"] as TimerMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onSwitch(m)}
          className={`font-mono uppercase tracking-wider transition-colors ${cls} ${
            activeMode === m
              ? "text-widget-timer bg-widget-timer/10 border border-widget-timer/25"
              : "text-fg-2 hover:text-fg border border-transparent hover:border-edge"
          }`}
        >
          {m === "pomodoro"
            ? size === "sm"
              ? "Pomo"
              : "Pomodoro"
            : m === "countdown"
              ? size === "sm"
                ? "Count"
                : "Countdown"
              : size === "sm"
                ? "Stop"
                : "Stopwatch"}
        </button>
      ))}
    </div>
  );
}

// ── Confirm Dialog ──────────────────────────────────────────────

function TimerConfirmDialog({
  targetMode,
  isRunning,
  onCancel,
  onConfirm,
}: {
  targetMode: TimerMode | null;
  isRunning: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!targetMode) return null;
  const name =
    targetMode === "pomodoro"
      ? "Pomodoro"
      : targetMode === "countdown"
        ? "Countdown"
        : "Stopwatch";
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80 backdrop-blur-sm rounded-xl"
      style={{ animation: "widget-card-enter 150ms ease-out" }}
    >
      <div className="text-center space-y-3 px-4">
        <p className="text-[13px] font-mono text-fg">
          Timer is {isRunning ? "running" : "paused"}.
        </p>
        <p className="text-xs font-mono text-fg-2">
          Switch to {name} and reset?
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={onCancel}
            className="text-xs font-mono text-fg-2 px-3 py-1.5 rounded-lg border border-edge hover:text-fg hover:border-edge-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs font-mono font-semibold text-widget-timer px-3 py-1.5 rounded-lg bg-widget-timer/10 border border-widget-timer/25 hover:bg-widget-timer/15 transition-colors"
          >
            Switch
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Timer Section ───────────────────────────────────────────────

interface TimerProps {
  compact: boolean;
}

export function Timer({ compact }: TimerProps) {
  const [state, setState] = useState(loadTimerState);
  const [, setTick] = useState(0);
  const [confirmSwitch, setConfirmSwitch] = useState<TimerMode | null>(null);
  const [customMinutes, setCustomMinutes] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const { workSecs } = loadPomodoroTiming();
    setState((p) => reconcileIdlePomodoroTarget(p, workSecs));
  });

  useEffect(() => {
    saveTimerState(state);
  }, [state]);

  useEffect(() => {
    if (state.startedAt !== null) {
      tickRef.current = setInterval(() => {
        setTick((t) => t + 1);
        const s = stateRef.current;
        if (s.mode !== "stopwatch" && s.startedAt !== null) {
          if (getElapsedMs(s) >= s.targetSecs * 1000) {
            setState((p) => ({
              ...p,
              startedAt: null,
              bankedMs: p.targetSecs * 1000,
              completedSessions:
                p.mode === "pomodoro"
                  ? p.completedSessions + 1
                  : p.completedSessions,
            }));
            playCompletionTone();
            if (
              "Notification" in globalThis &&
              Notification.permission === "granted"
            ) {
              const title =
                s.mode === "pomodoro" ? "Pomodoro Complete!" : "Timer Done!";
              new Notification(title, {
                body:
                  s.mode === "pomodoro"
                    ? "Time for a break."
                    : `${fmtDuration(s.targetSecs)} elapsed.`,
                silent: false,
              });
            }
          }
        }
      }, 200);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state.startedAt]);

  useEffect(() => {
    if (showCustom && customInputRef.current) customInputRef.current.focus();
  }, [showCustom]);

  const elapsedMs = getElapsedMs(state);
  const elapsedSecs = elapsedMs / 1000;
  const isRunning = state.startedAt !== null;
  const isCountdown = state.mode === "pomodoro" || state.mode === "countdown";
  const remainingSecs = isCountdown
    ? Math.max(0, state.targetSecs - elapsedSecs)
    : elapsedSecs;
  const progress = isCountdown
    ? state.targetSecs > 0
      ? elapsedSecs / state.targetSecs
      : 0
    : 0;
  const isComplete = isCountdown && elapsedMs >= state.targetSecs * 1000;
  const displayTime = isCountdown
    ? fmtDuration(remainingSecs)
    : fmtDuration(elapsedSecs);

  const start = useCallback(() => {
    setState((p) => ({ ...p, startedAt: Date.now() }));
  }, []);
  const pause = useCallback(() => {
    setState((p) => ({ ...p, startedAt: null, bankedMs: getElapsedMs(p) }));
  }, []);
  const reset = useCallback(() => {
    setState((p) => ({
      ...p,
      startedAt: null,
      bankedMs: 0,
      targetSecs: p.mode === "pomodoro" ? loadPomodoroTiming().workSecs : p.targetSecs,
    }));
  }, []);

  const doSwitchMode = useCallback((m: TimerMode) => {
    const timing = loadPomodoroTiming();
    setState((p) => ({
      ...p,
      mode: m,
      startedAt: null,
      bankedMs: 0,
      targetSecs:
        m === "pomodoro"
          ? timing.workSecs
          : m === "countdown"
            ? 300
            : 0,
    }));
    setConfirmSwitch(null);
    setShowCustom(false);
    setCustomMinutes("");
  }, []);

  const requestSwitchMode = useCallback(
    (m: TimerMode) => {
      if (m === stateRef.current.mode) return;
      if (stateRef.current.startedAt !== null || stateRef.current.bankedMs > 0)
        setConfirmSwitch(m);
      else doSwitchMode(m);
    },
    [doSwitchMode],
  );

  const setTarget = useCallback((secs: number) => {
    setState((p) => ({ ...p, startedAt: null, bankedMs: 0, targetSecs: secs }));
    setShowCustom(false);
    setCustomMinutes("");
  }, []);

  const handleCustomSubmit = useCallback(() => {
    const m = parseFloat(customMinutes);
    if (m > 0 && m <= 600) setTarget(Math.round(m * 60));
  }, [customMinutes, setTarget]);

  const startBreak = useCallback((long: boolean) => {
    const timing = loadPomodoroTiming();
    setState((p) => ({
      ...p,
      startedAt: Date.now(),
      bankedMs: 0,
      targetSecs: long ? timing.longBreakSecs : timing.shortBreakSecs,
    }));
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if ("Notification" in globalThis) {
      await Notification.requestPermission();
      setTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (confirmSwitch) return;
      if (e.key === " ") {
        e.preventDefault();
        if (isComplete) reset();
        else if (isRunning) pause();
        else start();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        reset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning, isComplete, start, pause, reset, confirmSwitch]);

  const pomodoroTiming = loadPomodoroTiming();
  const notifPermission =
    "Notification" in globalThis ? Notification.permission : "denied";

  // ── Compact timer ───────────────────────────────────────────
  if (compact) {
    return (
      <div className="space-y-2 relative">
        <TimerConfirmDialog
          targetMode={confirmSwitch}
          isRunning={isRunning}
          onCancel={() => setConfirmSwitch(null)}
          onConfirm={() => {
            if (confirmSwitch) doSwitchMode(confirmSwitch);
          }}
        />
        <TimerModeTabs
          activeMode={state.mode}
          size="sm"
          onSwitch={requestSwitchMode}
        />
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-widget-timer/[0.04] border border-widget-timer/10">
          <div className="flex items-center gap-2">
            {isRunning && (
              <div
                className="w-1.5 h-1.5 rounded-full bg-widget-timer"
                style={{
                  animation: "widget-pulse 1.5s ease-in-out infinite",
                }}
              />
            )}
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className={`text-lg font-mono font-bold tabular-nums ${isComplete ? "text-widget-timer" : "text-fg"}`}
              >
                {displayTime}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-widget-timer/70">
                {state.mode === "pomodoro" ? "Pomodoro" : state.mode === "countdown" ? "Countdown" : "Stopwatch"}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            {isComplete ? (
              <button
                onClick={reset}
                className="text-xs font-mono text-widget-timer hover:text-widget-timer/80 px-2 py-1 rounded bg-widget-timer/10 transition-colors"
              >
                Reset
              </button>
            ) : isRunning ? (
              <button
                onClick={pause}
                className="text-xs font-mono text-widget-timer hover:text-widget-timer/80 px-2 py-1 rounded bg-widget-timer/10 transition-colors"
              >
                Pause
              </button>
            ) : (
              <>
                <button
                  onClick={start}
                  className="text-xs font-mono text-widget-timer hover:text-widget-timer/80 px-2 py-1 rounded bg-widget-timer/10 transition-colors"
                >
                  {state.bankedMs > 0 ? "Resume" : "Start"}
                </button>
                {state.bankedMs > 0 && (
                  <button
                    onClick={reset}
                    className="text-xs font-mono text-fg-2 hover:text-fg px-2 py-1 rounded transition-colors"
                  >
                    Reset
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Comfort timer ───────────────────────────────────────────
  return (
    <div className="space-y-4 relative">
      <TimerConfirmDialog
        targetMode={confirmSwitch}
        isRunning={isRunning}
        onCancel={() => setConfirmSwitch(null)}
        onConfirm={() => {
          if (confirmSwitch) doSwitchMode(confirmSwitch);
        }}
      />

      <TimerModeTabs
        activeMode={state.mode}
        size="md"
        onSwitch={requestSwitchMode}
      />

      {/* Display */}
      <div className="rounded-2xl border border-widget-timer/15 bg-widget-timer/[0.04] px-4 py-5 shadow-[inset_0_1px_0_0_rgba(245,158,11,0.08)]">
        <div className="flex flex-col items-center">
          {isCountdown ? (
            <CircularProgress
              progress={progress}
              size={160}
              strokeWidth={4}
              running={isRunning}
            >
              <span
                className={`text-2xl font-mono font-bold tabular-nums ${isComplete ? "text-widget-timer" : "text-fg"}`}
              >
                {displayTime}
              </span>
              {state.mode === "pomodoro" && (
                <span className="text-[11px] font-mono text-fg-2 mt-1">
                  Session {state.completedSessions + 1}
                </span>
              )}
            </CircularProgress>
          ) : (
            <div className="text-center py-4">
              <div className="flex items-center justify-center gap-2">
                {isRunning && (
                  <div
                    className="w-2 h-2 rounded-full bg-widget-timer"
                    style={{
                      animation: "widget-pulse 1.5s ease-in-out infinite",
                    }}
                  />
                )}
                <span className="text-3xl font-mono font-bold text-fg tabular-nums">
                  {displayTime}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        {isComplete ? (
          <>
            <button
              onClick={reset}
              className="text-xs font-mono font-semibold text-widget-timer px-5 py-2 rounded-full bg-widget-timer/10 border border-widget-timer/25 hover:bg-widget-timer/15 transition-colors"
            >
              Reset
            </button>
            {state.mode === "pomodoro" && (
              <>
                <button
                  onClick={() => startBreak(false)}
                  className="text-xs font-mono text-fg px-4 py-2 rounded-full bg-surface-2 border border-edge hover:border-edge-2 transition-colors"
                >
                  Short Break
                </button>
                {state.completedSessions > 0 &&
                  state.completedSessions % pomodoroTiming.longBreakEvery === 0 && (
                    <button
                      onClick={() => startBreak(true)}
                      className="text-xs font-mono text-fg px-4 py-2 rounded-full bg-surface-2 border border-edge hover:border-edge-2 transition-colors"
                    >
                      Long Break
                    </button>
                  )}
              </>
            )}
          </>
        ) : isRunning ? (
          <button
            onClick={pause}
            className="text-xs font-mono font-semibold text-widget-timer px-5 py-2 rounded-full bg-widget-timer/10 border border-widget-timer/25 hover:bg-widget-timer/15 transition-colors"
          >
            Pause
          </button>
        ) : (
          <>
            <button
              onClick={start}
              className="text-xs font-mono font-semibold text-widget-timer px-5 py-2 rounded-full bg-widget-timer/10 border border-widget-timer/25 hover:bg-widget-timer/15 transition-colors"
            >
              {state.bankedMs > 0 ? "Resume" : "Start"}
            </button>
            {state.bankedMs > 0 && (
              <button
                onClick={reset}
                className="text-xs font-mono text-fg-2 px-4 py-2 rounded-full hover:text-fg hover:bg-surface-2 transition-colors"
              >
                Reset
              </button>
            )}
          </>
        )}
      </div>

      {/* Countdown presets */}
      {state.mode === "countdown" && !isRunning && state.bankedMs === 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {COUNTDOWN_PRESETS.map((p) => (
              <button
                key={p.secs}
                onClick={() => setTarget(p.secs)}
                className={`text-xs font-mono px-2.5 py-1 rounded-full transition-colors ${
                  state.targetSecs === p.secs && !showCustom
                    ? "text-widget-timer bg-widget-timer/10 border border-widget-timer/25"
                    : "text-fg-2 border border-edge hover:text-fg hover:border-edge-2"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setShowCustom((v) => !v)}
              className={`text-xs font-mono px-2.5 py-1 rounded-full transition-colors ${
                showCustom
                  ? "text-widget-timer bg-widget-timer/10 border border-widget-timer/25"
                  : "text-fg-2 border border-edge hover:text-fg hover:border-edge-2"
              }`}
            >
              Custom
            </button>
          </div>
          {showCustom && (
            <div
              className="flex items-center justify-center gap-2"
              style={{ animation: "widget-card-enter 150ms ease-out" }}
            >
              <input
                ref={customInputRef}
                type="number"
                min="0.5"
                max="600"
                step="0.5"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit();
                }}
                placeholder="Minutes"
                className="w-20 text-center text-xs font-mono bg-surface-2 border border-edge rounded-lg px-2 py-1.5 text-fg placeholder:text-fg-3 outline-none focus:border-widget-timer/30 transition-colors"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={
                  !customMinutes || parseFloat(customMinutes) <= 0
                }
                className="text-xs font-mono font-semibold text-widget-timer px-3 py-1.5 rounded-lg bg-widget-timer/10 border border-widget-timer/25 hover:bg-widget-timer/15 transition-colors disabled:opacity-30 disabled:cursor-default"
              >
                Set
              </button>
            </div>
          )}
        </div>
      )}

      {state.mode === "pomodoro" && state.completedSessions > 0 && (
        <div className="text-center">
          <span className="text-[11px] font-mono text-fg-2">
            {state.completedSessions} session
            {state.completedSessions !== 1 ? "s" : ""} completed
          </span>
        </div>
      )}

      {notifPermission === "default" && (
        <div
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-widget-timer/[0.04] border border-widget-timer/10"
          style={{ animation: "widget-card-enter 200ms ease-out" }}
        >
          <span className="text-[11px] font-mono text-fg-2">
            Enable notifications for timer alerts?
          </span>
          <button
            onClick={requestNotificationPermission}
            className="text-[11px] font-mono font-semibold text-widget-timer hover:text-widget-timer/80 transition-colors"
          >
            Allow
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-3 pt-1">
        <span className="text-[10px] font-mono text-fg-3">
          <kbd className="px-1 py-0.5 rounded bg-surface-2 border border-edge text-fg-2">
            Space
          </kbd>{" "}
          start/pause
        </span>
        <span className="text-[10px] font-mono text-fg-3">
          <kbd className="px-1 py-0.5 rounded bg-surface-2 border border-edge text-fg-2">
            R
          </kbd>{" "}
          reset
        </span>
      </div>
    </div>
  );
}
