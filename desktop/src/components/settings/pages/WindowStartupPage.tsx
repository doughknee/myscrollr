/**
 * Window & startup.
 *
 * "Check for updates on startup" lives here rather than on Updates:
 * it is a startup behavior, and grouping it with autostart puts the two
 * "what happens when Scrollr launches" switches together. The Updates
 * page points at this row instead of duplicating it.
 *
 * Monitors: one switch per detected screen plus a map drawn from the
 * real positions. The pref stores monitor names; empty means primary,
 * so a fresh install shows the primary switched on with nothing saved.
 * The main window turns the pref into windows (routes/__root.tsx).
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StartupPrefs, WindowPrefs } from "../../../preferences";
import { RowList, SettingsGroup, ToggleRow } from "../SettingsControls";
import { Row } from "./Row";

/** Shape of one `list_monitors` entry (logical coordinates). */
interface MonitorInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

/** `\\.\DISPLAY2` → `DISPLAY2`; other platforms' names pass through. */
const displayName = (name: string) => name.replace(/^\\\\\.\\/, "");

function MonitorMap({ monitors, on }: { monitors: MonitorInfo[]; on: Set<string> }) {
  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  const pad = (maxX - minX) * 0.02;
  return (
    <svg
      role="img"
      aria-label="Monitor layout"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      className="mx-auto block h-24 w-full"
    >
      {monitors.map((m) => (
        <g key={m.name}>
          <rect
            x={m.x}
            y={m.y}
            width={m.width}
            height={m.height}
            rx={m.width * 0.015}
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.5}
            className={
              on.has(m.name)
                ? "fill-accent/25 stroke-accent"
                : "fill-base-250/50 stroke-edge"
            }
          />
          <text
            x={m.x + m.width / 2}
            y={m.y + m.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={m.height * 0.16}
            className={on.has(m.name) ? "fill-fg font-medium" : "fill-fg-4"}
          >
            {displayName(m.name)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function MonitorsGroup({
  chosen,
  onChange,
}: {
  chosen: string[];
  onChange: (names: string[]) => void;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    invoke<MonitorInfo[]>("list_monitors").then(setMonitors).catch(() => {});
  }, []);
  if (monitors.length === 0) return null;

  const primary = monitors.find((m) => m.isPrimary) ?? monitors[0];
  const on = new Set(chosen.filter((n) => monitors.some((m) => m.name === n)));
  if (on.size === 0) on.add(primary.name);

  // Save in detection order so the first ticker window's screen is
  // stable no matter which switch was flipped last.
  const toggle = (name: string, checked: boolean) =>
    onChange(
      monitors
        .filter((m) => (m.name === name ? checked : on.has(m.name)))
        .map((m) => m.name),
    );

  return (
    <SettingsGroup label="Monitors">
      <Row id="tickerMonitors">
        <div className="border-b border-edge/60 px-4 py-3">
          <MonitorMap monitors={monitors} on={on} />
        </div>
        <RowList>
          {monitors.map((m) => (
            <ToggleRow
              key={m.name}
              label={displayName(m.name)}
              badge={m.isPrimary ? "Primary" : undefined}
              description={`${Math.round(m.width * m.scaleFactor)} × ${Math.round(m.height * m.scaleFactor)}`}
              checked={on.has(m.name)}
              disabled={on.size === 1 && on.has(m.name)}
              onChange={(v) => toggle(m.name, v)}
            />
          ))}
        </RowList>
      </Row>
    </SettingsGroup>
  );
}

interface WindowStartupPageProps {
  window_: WindowPrefs;
  onWindowChange: (prefs: WindowPrefs) => void;
  startup: StartupPrefs;
  onStartupChange: (prefs: StartupPrefs) => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
}

export default function WindowStartupPage({
  window_,
  onWindowChange,
  startup,
  onStartupChange,
  autostartEnabled,
  onAutostartChange,
}: WindowStartupPageProps) {
  return (
    <>
      <SettingsGroup label="Window">
        <RowList>
          <Row id="alwaysOnTop">
            <ToggleRow
              label="Always on top"
              description="Keep the ticker above all other windows"
              checked={window_.pinned}
              onChange={(v) => onWindowChange({ ...window_, pinned: v })}
            />
          </Row>
          <Row id="hideFullscreen">
            <ToggleRow
              label="Hide when an app goes fullscreen"
              badge="Windows"
              description="Hides the ticker when YouTube, games, or other apps enter fullscreen so they aren't visually clipped."
              checked={window_.hideOnFullscreen}
              onChange={(v) =>
                onWindowChange({ ...window_, hideOnFullscreen: v })
              }
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <MonitorsGroup
        chosen={window_.tickerMonitors}
        onChange={(tickerMonitors) =>
          onWindowChange({ ...window_, tickerMonitors })
        }
      />

      <SettingsGroup label="Startup">
        <RowList>
          <Row id="autostart">
            <ToggleRow
              label="Launch on system startup"
              description="Automatically open Scrollr when you start your computer"
              checked={autostartEnabled}
              onChange={onAutostartChange}
            />
          </Row>
          <Row id="autoCheck">
            <ToggleRow
              label="Check for updates on startup"
              description="Notify me when a new version is available shortly after launch"
              checked={startup.autoCheckUpdates}
              onChange={(v) =>
                onStartupChange({ ...startup, autoCheckUpdates: v })
              }
            />
          </Row>
        </RowList>
      </SettingsGroup>
    </>
  );
}
