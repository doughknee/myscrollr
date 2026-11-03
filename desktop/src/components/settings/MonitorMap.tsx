/**
 * Monitors: the map, the per-screen switches, and the Identify button.
 *
 * Rendered by the Ticker page under "Where" (REL-204); the page owns
 * the group, this owns the rows and the Identify button.
 *
 * The map draws PHYSICAL rects: that is the one plane where mixed-DPI
 * screens sit side by side the way Windows' Display settings shows
 * them. Logical rects divide each screen by its own scale, so a 4K
 * screen at 300 % came out a third the size, overlapping its
 * neighbour (REL-203).
 *
 * Screens are numbered in `list_monitors` order, and "Identify" flashes
 * that number on each screen so the user can match switch to glass.
 */
import { Fragment, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriListener } from "../../hooks/useTauriListener";
import {
  RowList,
  SegmentedRow,
  SettingsButton,
  ToggleRow,
} from "./SettingsControls";
import { DEFAULT_DISPLAY } from "../../lib/tickerDisplay";
import { Row } from "./pages/Row";
import type { DisplayPreference } from "../../lib/tickerDisplay";

/** One `list_monitors` entry. `x/y/width/height` are logical (that
 *  screen's own scale); `physical*` are the OS's shared plane. */
export interface MonitorInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
  physicalX: number;
  physicalY: number;
  physicalWidth: number;
  physicalHeight: number;
}

/** "Display 3 · 3840 × 2160" — what Windows calls it, at its real size. */
export const monitorLabel = (i: number, m: MonitorInfo) =>
  `Display ${i + 1} · ${m.physicalWidth} × ${m.physicalHeight}`;

/** The attached monitors, re-listed when one is plugged or unplugged. */
export function useMonitors(): MonitorInfo[] {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const refresh = () =>
    invoke<MonitorInfo[]>("list_monitors")
      .then(setMonitors)
      .catch(() => {});
  useEffect(() => {
    void refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useTauriListener("monitors-changed", refresh);
  return monitors;
}

export function MonitorMap({
  monitors,
  on,
  onToggle,
}: {
  monitors: MonitorInfo[];
  on: Set<string>;
  /** Click on a screen. Absent = display only. */
  onToggle?: (name: string, checked: boolean) => void;
}) {
  const minX = Math.min(...monitors.map((m) => m.physicalX));
  const minY = Math.min(...monitors.map((m) => m.physicalY));
  const maxX = Math.max(...monitors.map((m) => m.physicalX + m.physicalWidth));
  const maxY = Math.max(...monitors.map((m) => m.physicalY + m.physicalHeight));
  const pad = (maxX - minX) * 0.02;
  return (
    // The switches below are the accessible control; the rects are the
    // pointer shortcut, so the SVG stays one labelled image.
    <svg
      role="img"
      aria-label="Monitor layout"
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      className="mx-auto block h-24 w-full"
    >
      {monitors.map((m, i) => {
        const checked = on.has(m.name);
        // The last screen on stays on (same rule as its switch).
        const locked = checked && on.size === 1;
        return (
          <g
            key={m.name}
            data-monitor={m.name}
            onClick={
              onToggle && !locked ? () => onToggle(m.name, !checked) : undefined
            }
            className={onToggle && !locked ? "cursor-pointer" : undefined}
          >
            <rect
              x={m.physicalX}
              y={m.physicalY}
              width={m.physicalWidth}
              height={m.physicalHeight}
              rx={m.physicalWidth * 0.015}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
              className={
                checked
                  ? "fill-accent/25 stroke-accent"
                  : "fill-base-250/50 stroke-edge"
              }
            />
            <text
              x={m.physicalX + m.physicalWidth / 2}
              y={m.physicalY + m.physicalHeight / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={m.physicalHeight * 0.35}
              className={checked ? "fill-fg font-medium" : "fill-fg-4"}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Flashes each screen's number on it, so switch matches glass. */
export function IdentifyButton() {
  return (
    <SettingsButton
      onClick={() => void invoke("identify_monitors").catch(() => {})}
    >
      Identify
    </SettingsButton>
  );
}

/**
 * The map plus one switch per screen. `chosen` is `window.tickerMonitors`
 * (names; empty means primary, so a fresh install shows the primary
 * switched on with nothing saved). The main window turns the pref into
 * windows (routes/__root.tsx). Renders nothing until the list arrives.
 */
export function MonitorsRows({
  chosen,
  onChange,
  displays = {},
  onDisplayChange,
}: {
  chosen: string[];
  onChange: (names: string[]) => void;
  displays?: Record<string, DisplayPreference>;
  onDisplayChange?: (name: string, pref: DisplayPreference) => void;
}) {
  const monitors = useMonitors();
  if (monitors.length === 0) return null;

  const primary = monitors.find((m) => m.isPrimary) ?? monitors[0];
  const on = new Set(chosen.filter((n) => monitors.some((m) => m.name === n)));
  if (
    on.size === 0 &&
    !chosen.some((n) => displays[n]?.mode && displays[n].mode !== "docked")
  )
    on.add(primary.name);

  // Save in detection order so the first ticker window's screen is
  // stable no matter which switch was flipped last.
  const toggle = (name: string, checked: boolean) =>
    onChange(
      monitors
        .filter((m) => (m.name === name ? checked : on.has(m.name)))
        .map((m) => m.name),
    );

  return (
    <Row id="tickerMonitors">
      <div className="border-b border-edge/60 px-4 py-3">
        <MonitorMap monitors={monitors} on={on} onToggle={toggle} />
      </div>
      <div className="border-b border-edge/60">
        <RowList>
          {monitors.map((m, i) => {
            const locked = on.size === 1 && on.has(m.name);
            const pref = displays[m.name] ?? DEFAULT_DISPLAY;
            return (
              <Fragment key={m.name}>
                <ToggleRow
                  key={m.name}
                  label={monitorLabel(i, m)}
                  badge={m.isPrimary ? "Primary" : undefined}
                  checked={on.has(m.name)}
                  disabled={locked}
                  title={locked ? "Keep at least one" : undefined}
                  onChange={(v) => toggle(m.name, v)}
                />
                {on.has(m.name) && onDisplayChange && (
                  <>
                    <SegmentedRow
                      label={`Display ${i + 1} mode`}
                      description="Fill this display for a dedicated screen."
                      value={pref.mode === "docked" ? "docked" : "fill"}
                      options={[
                        { value: "docked", label: "Docked" },
                        { value: "fill", label: "Fill this display" },
                      ]}
                      onChange={(v) =>
                        onDisplayChange(m.name, {
                          ...pref,
                          mode: v === "docked" ? "docked" : "grid",
                        })
                      }
                    />
                    {pref.mode !== "docked" && (
                      <>
                        <SegmentedRow
                          label={`Display ${i + 1} layout`}
                          description="Page grid adapts to the screen. Ticker strip uses your scroll mode."
                          value={pref.mode}
                          options={[
                            { value: "grid", label: "Page grid" },
                            { value: "strip", label: "Ticker strip" },
                          ]}
                          onChange={(v) =>
                            onDisplayChange(m.name, {
                              ...pref,
                              mode: v === "strip" ? "strip" : "grid",
                            })
                          }
                        />
                        <SegmentedRow
                          label={`Display ${i + 1} reading size`}
                          description="Larger text shows fewer items at once."
                          value={String(pref.readingSize)}
                          options={[
                            { value: "100", label: "Auto" },
                            { value: "125", label: "Larger" },
                            { value: "150", label: "Largest" },
                          ]}
                          onChange={(v) =>
                            onDisplayChange(m.name, {
                              ...pref,
                              readingSize: Number(
                                v,
                              ) as DisplayPreference["readingSize"],
                            })
                          }
                        />
                      </>
                    )}
                  </>
                )}
              </Fragment>
            );
          })}
        </RowList>
      </div>
    </Row>
  );
}
