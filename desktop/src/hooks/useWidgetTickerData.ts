import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { WidgetPrefs } from "../preferences";
import type { TempUnit } from "../preferences";
import { fetchSysmonData } from "./useSysmonData";
import type { SystemInfo } from "./useSysmonData";
import { LS_CLOCK_TIMEZONES, LS_CLOCK_FORMAT, LS_TIMER_STATE, LS_WEATHER_CITIES, LS_WEATHER_UNIT, LS_UPTIME_MONITORS, LS_GITHUB_REPOS } from "../constants";
import { getStore, onStoreChange } from "../lib/store";
import { formatBytes, timeAgo } from "../utils/format";
import { weatherCodeToIcon, weatherCodeToLabel, formatTemp } from "../widgets/weather/types";
import { findCpuTemp, findGpuTemp } from "../widgets/sysmon/utils";
import { tzLabel } from "../widgets/clock/storage";
import type { ClockChipData, WeatherChipData, SysmonChipData, UptimeChipData, GitHubChipData, WidgetTickerData } from "../types";
import type { TimerState } from "../widgets/timer/types";
import type { SavedCity } from "../widgets/weather/types";
import { loadMonitors } from "../widgets/uptime/types";
import { loadRepoData, repoKey } from "../widgets/github/types";

const EMPTY: WidgetTickerData = { clock: [], timer: [], weather: [], sysmon: [], uptime: [], github: [] };

// ── Time formatting helpers ─────────────────────────────────────

function formatTime(date: Date, tz: string | undefined, format: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
    ...(tz ? { timeZone: tz } : {}),
  };
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

function formatDetail(date: Date, tz: string | undefined): string {
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
    ...(tz ? { timeZone: tz } : {}),
  }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";

  const dateStr = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(tz ? { timeZone: tz } : {}),
  }).format(date);

  return `${tzName} \u00B7 ${dateStr}`;
}

function tzShortLabel(tz: string): string {
  const city = tzLabel(tz);
  // Abbreviate long city names for compact ticker chips
  if (city.length > 10) {
    const words = city.split(" ");
    return words.map((w) => w[0]).join("").toUpperCase();
  }
  return city;
}

// ── Timer helpers ───────────────────────────────────────────────

function getTimerChipData(state: TimerState, longBreakEvery: number): ClockChipData | null {
  const isRunning = state.startedAt != null;
  const elapsed = isRunning
    ? state.bankedMs + (Date.now() - state.startedAt!)
    : state.bankedMs;

  if (!isRunning && elapsed === 0) return null; // No active timer

  const isCountUp = state.mode === "stopwatch";
  const totalMs = isCountUp ? elapsed : Math.max(0, state.targetSecs * 1000 - elapsed);
  const totalSecs = Math.floor(totalMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const value = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const mode = state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
  const sessions = state.completedSessions ?? 0;
  const detail = state.mode === "pomodoro"
    ? `${mode} \u00B7 ${sessions}/${longBreakEvery} sessions`
    : mode;

  return {
    id: "timer",
    kind: "timer",
    label: "Timer",
    value,
    detail,
  };
}

// ── Hook ────────────────────────────────────────────────────────

export function useWidgetTickerData(
  widgetPrefs: WidgetPrefs,
): WidgetTickerData {
  const [data, setData] = useState<WidgetTickerData>(EMPTY);
  const sysInfoRef = useRef<SystemInfo | null>(null);

  const enabledWidgets = useMemo(
    () => new Set(widgetPrefs.widgetsOnTicker),
    [widgetPrefs.widgetsOnTicker],
  );

  // ── Build clock chips ─────────────────────────────────────────
  const buildClockChips = useCallback((): ClockChipData[] => {
    if (!enabledWidgets.has("clock")) return [];
    const cfg = widgetPrefs.clock;
    const chips: ClockChipData[] = [];
    const now = new Date();
    const format = getStore<string>(LS_CLOCK_FORMAT, "12h");

    // Local time
    if (cfg.ticker.localTime) {
      chips.push({
        id: "clock-local",
        kind: "clock",
        label: "Local",
        value: formatTime(now, undefined, format),
        detail: formatDetail(now, undefined),
      });
    }

    // Configured timezones (gated by showTimezones, then filtered by excludedTimezones)
    if (cfg.ticker.showTimezones) {
      const tzs = getStore<string[]>(LS_CLOCK_TIMEZONES, []);
      for (const tz of Array.isArray(tzs) ? tzs : []) {
        if (cfg.ticker.excludedTimezones.includes(tz)) continue;
        chips.push({
          id: `clock-${tz}`,
          kind: "clock",
          label: tzShortLabel(tz),
          value: formatTime(now, tz, format),
          detail: formatDetail(now, tz),
        });
      }
    }

    return chips;
  }, [widgetPrefs.clock, enabledWidgets]);

  // ── Build timer chips ─────────────────────────────────────────
  const buildTimerChips = useCallback((): ClockChipData[] => {
    if (!enabledWidgets.has("timer")) return [];
    if (!widgetPrefs.timer.ticker.activeTimer) return [];

    const state = getStore<TimerState | null>(LS_TIMER_STATE, null);
    if (!state) return [];

    const chip = getTimerChipData(state, widgetPrefs.timer.pomodoro.longBreakEvery);
    return chip ? [chip] : [];
  }, [widgetPrefs.timer, enabledWidgets]);

  // ── Build weather chips ───────────────────────────────────────
  const buildWeatherChips = useCallback((): WeatherChipData[] => {
    if (!enabledWidgets.has("weather")) return [];
    const cfg = widgetPrefs.weather;
    const chips: WeatherChipData[] = [];
    const unit = getStore<string>(LS_WEATHER_UNIT, "fahrenheit");

    const cities = getStore<SavedCity[]>(LS_WEATHER_CITIES, []);

    for (const city of Array.isArray(cities) ? cities : []) {
      const name = city.location.name;
      if (cfg.ticker.excludedCities.includes(name)) continue;

      const w = city.weather;
      const temp = w?.temperature != null ? formatTemp(w.temperature, unit as TempUnit, true) : "--";
      const feelsLike = w?.feelsLike != null ? formatTemp(w.feelsLike, unit as TempUnit, true) : "--";
      const icon = w?.weatherCode != null ? weatherCodeToIcon(w.weatherCode) : "\u2601";
      const condition = w?.weatherCode != null ? weatherCodeToLabel(w.weatherCode) : "";

      chips.push({
        id: `weather-${name}`,
        label: name.length > 12 ? name.slice(0, 10) + "\u2026" : name,
        temp,
        icon,
        detail: condition ? `${condition} \u00B7 Feels ${feelsLike}` : undefined,
      });
    }

    return chips;
  }, [widgetPrefs.weather, enabledWidgets]);

  // ── Build sysmon chips ────────────────────────────────────────
  const buildSysmonChips = useCallback((): SysmonChipData[] => {
    if (!enabledWidgets.has("sysmon")) return [];
    const info = sysInfoRef.current;
    if (!info) return [];

    const cfg = widgetPrefs.sysmon;
    const chips: SysmonChipData[] = [];
    const tu = cfg.tempUnit;

    if (cfg.ticker.cpu) {
      const pct = Math.round(info.cpuUsage);
      const freq = info.cpuFreqMhz ? `${(info.cpuFreqMhz / 1000).toFixed(1)} GHz` : "";
      const sensor = findCpuTemp(info.components);
      const temp = sensor ? formatTemp(sensor.temp, tu, true) : "";
      chips.push({
        id: "sysmon-cpu",
        label: "CPU",
        value: `${pct}%`,
        detail: [freq, temp].filter(Boolean).join(" \u00B7 ") || undefined,
        hot: pct >= 80,
      });
    }

    if (cfg.ticker.memory) {
      const pct = Math.round((info.memUsed / info.memTotal) * 100);
      const used = formatBytes(info.memUsed);
      const total = formatBytes(info.memTotal);
      chips.push({
        id: "sysmon-mem",
        label: "RAM",
        value: `${pct}%`,
        detail: `${used} / ${total}`,
        hot: pct >= 85,
      });
    }

    if (cfg.ticker.gpu && info.gpuUsage != null) {
      const pct = Math.round(info.gpuUsage);
      const clock = info.gpuClockMhz ? `${info.gpuClockMhz} MHz` : "";
      const sensor = findGpuTemp(info.components);
      const temp = sensor ? formatTemp(sensor.temp, tu, true) : "";
      chips.push({
        id: "sysmon-gpu",
        label: "GPU",
        value: `${pct}%`,
        detail: [clock, temp].filter(Boolean).join(" \u00B7 ") || undefined,
        hot: pct >= 80,
      });
    }

    if (cfg.ticker.gpuPower && info.gpuPowerWatts != null) {
      const watts = Math.round(info.gpuPowerWatts);
      const cap = info.gpuPowerCapWatts ? `/ ${Math.round(info.gpuPowerCapWatts)}W` : "";
      chips.push({
        id: "sysmon-pwr",
        label: "GPU",
        value: `${watts}W`,
        detail: cap ? `${watts}W ${cap} TDP` : undefined,
        hot: false,
      });
    }

    return chips;
  }, [widgetPrefs.sysmon, enabledWidgets]);

  // ── Build uptime chips ────────────────────────────────────────
  const buildUptimeChips = useCallback((): UptimeChipData[] => {
    if (!enabledWidgets.has("uptime")) return [];
    const monitors = loadMonitors();
    if (monitors.length === 0) return [];

    const cfg = widgetPrefs.uptime;
    const chips: UptimeChipData[] = [];

    for (const mon of monitors) {
      if (cfg.ticker.excludedMonitors.includes(mon.id)) continue;

      const uptimeStr = mon.uptimePercent != null
        ? `${mon.uptimePercent.toFixed(mon.uptimePercent === 100 ? 0 : 1)}%`
        : "--";

      const statusLabel = mon.status.charAt(0).toUpperCase() + mon.status.slice(1);
      const respTime = mon.responseTime != null ? `${mon.responseTime}ms` : "";
      const checked = timeAgo(mon.lastChecked, { suffix: true });
      const detail = [statusLabel, respTime, checked].filter(Boolean).join(" \u00B7 ");

      chips.push({
        id: `uptime-${mon.id}`,
        label: mon.name.length > 20 ? mon.name.slice(0, 18) + "\u2026" : mon.name,
        status: mon.status,
        uptime: uptimeStr,
        detail: detail || undefined,
        heartbeats: mon.recentHeartbeats.length > 0 ? mon.recentHeartbeats : undefined,
      });
    }

    return chips;
  }, [widgetPrefs.uptime, enabledWidgets]);

  // ── Build github chips ────────────────────────────────────────
  const buildGithubChips = useCallback((): GitHubChipData[] => {
    if (!enabledWidgets.has("github")) return [];
    const repos = loadRepoData();
    if (repos.length === 0) return [];

    const cfg = widgetPrefs.github;
    const chips: GitHubChipData[] = [];

    for (const repo of repos) {
      const key = repoKey(repo);
      if (cfg.ticker.excludedRepos.includes(key)) continue;

      const repoLabel = repo.repo.length > 20 ? repo.repo.slice(0, 18) + "\u2026" : repo.repo;
      const workflow = repo.workflowName ?? "CI";

      // Comfort detail: first line of commit message + time ago
      const firstLine = repo.commitMessage?.split("\n")[0] ?? "";
      const commit = firstLine.length > 30 ? firstLine.slice(0, 28) + "\u2026" : firstLine;
      const checked = timeAgo(repo.updatedAt, { suffix: true });
      const detail = [commit, checked].filter(Boolean).join(" \u00B7 ");

      chips.push({
        id: `github-${key}`,
        label: repoLabel,
        status: repo.status,
        workflowName: workflow,
        detail: detail || undefined,
      });
    }

    return chips;
  }, [widgetPrefs.github, enabledWidgets]);

  // ── Polling intervals ─────────────────────────────────────────

  useEffect(() => {
    const hasClock = enabledWidgets.has("clock");
    const hasTimer = enabledWidgets.has("timer");
    const hasWeather = enabledWidgets.has("weather");
    const hasSysmon = enabledWidgets.has("sysmon");
    const hasUptime = enabledWidgets.has("uptime");
    const hasGithub = enabledWidgets.has("github");

    if (!hasClock && !hasTimer && !hasWeather && !hasSysmon && !hasUptime && !hasGithub) {
      setData(EMPTY);
      return;
    }

    // Build initial data
    const refresh = () => {
      setData({
        clock: buildClockChips(),
        timer: buildTimerChips(),
        weather: buildWeatherChips(),
        sysmon: buildSysmonChips(),
        uptime: buildUptimeChips(),
        github: buildGithubChips(),
      });
    };

    // Clock: update every second
    const clockInterval = hasClock ? setInterval(() => {
      setData((prev) => ({ ...prev, clock: buildClockChips() }));
    }, 1000) : null;

    // Timer: update every second while enabled for live elapsed time
    const timerInterval = hasTimer ? setInterval(() => {
      setData((prev) => ({ ...prev, timer: buildTimerChips() }));
    }, 1000) : null;

    // Weather: listen for store changes instead of polling
    // (weatherQueryOptions in __root.tsx writes to LS_WEATHER_CITIES on every fetch)
    const unsubWeatherCities = hasWeather
      ? onStoreChange<SavedCity[]>(LS_WEATHER_CITIES, () => {
          setData((prev) => ({ ...prev, weather: buildWeatherChips() }));
        })
      : null;
    const unsubWeatherUnit = hasWeather
      ? onStoreChange<string>(LS_WEATHER_UNIT, () => {
          setData((prev) => ({ ...prev, weather: buildWeatherChips() }));
        })
      : null;

    // Timer: listen for store changes
    const unsubTimerState = hasTimer
      ? onStoreChange<TimerState | null>(LS_TIMER_STATE, () => {
          setData((prev) => ({ ...prev, timer: buildTimerChips() }));
        })
      : null;

    // Clock: listen for store changes (timezones, format)
    const unsubClockTimezones = hasClock
      ? onStoreChange<string[]>(LS_CLOCK_TIMEZONES, () => {
          setData((prev) => ({ ...prev, clock: buildClockChips() }));
        })
      : null;
    const unsubClockFormat = hasClock
      ? onStoreChange<string>(LS_CLOCK_FORMAT, () => {
          setData((prev) => ({ ...prev, clock: buildClockChips() }));
        })
      : null;

    // Uptime: listen for store changes (monitor data written by FeedTab)
    const unsubUptimeMonitors = hasUptime
      ? onStoreChange(LS_UPTIME_MONITORS, () => {
          setData((prev) => ({ ...prev, uptime: buildUptimeChips() }));
        })
      : null;

    // GitHub: listen for store changes (repo data written by FeedTab)
    const unsubGithubRepos = hasGithub
      ? onStoreChange(LS_GITHUB_REPOS, () => {
          setData((prev) => ({ ...prev, github: buildGithubChips() }));
        })
      : null;

    // Sysmon: poll Tauri IPC at the configured interval
    const sysmonMs = (widgetPrefs.sysmon.refreshInterval || 2) * 1000;
    const sysmonInterval = hasSysmon ? setInterval(async () => {
      try {
        sysInfoRef.current = await fetchSysmonData();
        setData((prev) => ({ ...prev, sysmon: buildSysmonChips() }));
      } catch { /* ignore IPC failures */ }
    }, sysmonMs) : null;

     // Uptime: re-read cached store data at poll cadence (FeedTab does the actual fetching)
    const uptimeMs = (widgetPrefs.uptime.pollInterval || 60) * 1000;
    const uptimeInterval = hasUptime ? setInterval(() => {
      setData((prev) => ({ ...prev, uptime: buildUptimeChips() }));
    }, uptimeMs) : null;

     // GitHub: re-read cached store data at poll cadence (FeedTab does the actual fetching)
    const githubMs = (widgetPrefs.github.pollInterval || 120) * 1000;
    const githubInterval = hasGithub ? setInterval(() => {
      setData((prev) => ({ ...prev, github: buildGithubChips() }));
    }, githubMs) : null;

    // Initial fetch for sysmon (only widget that needs async init)
    if (hasSysmon) {
      fetchSysmonData()
        .then((info) => { sysInfoRef.current = info; })
        .catch(() => {})
        .finally(refresh);
    } else {
      refresh();
    }

    return () => {
      if (clockInterval) clearInterval(clockInterval);
      if (timerInterval) clearInterval(timerInterval);
      unsubWeatherCities?.();
      unsubWeatherUnit?.();
      unsubTimerState?.();
      unsubClockTimezones?.();
      unsubClockFormat?.();
      unsubUptimeMonitors?.();
      unsubGithubRepos?.();
      if (sysmonInterval) clearInterval(sysmonInterval);
      if (uptimeInterval) clearInterval(uptimeInterval);
      if (githubInterval) clearInterval(githubInterval);
    };
  // Suppressed: JSON.stringify stabilizes the dep by value instead of reference,
  // so the effect only re-runs when the array contents actually change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(widgetPrefs.widgetsOnTicker),
    widgetPrefs.sysmon.refreshInterval,
    widgetPrefs.uptime.pollInterval,
    widgetPrefs.github.pollInterval,
    buildClockChips,
    buildTimerChips,
    buildWeatherChips,
    buildSysmonChips,
    buildUptimeChips,
    buildGithubChips,
  ]);

  return data;
}
