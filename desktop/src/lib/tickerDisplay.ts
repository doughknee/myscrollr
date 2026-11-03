/** Device-local display presentation. Content selections remain shared. */
export type DisplayMode = "docked" | "grid" | "strip";
/** Two compact action buttons and their gutters, in the header's 64px coordinates. */
export const FILL_CONTROLS_W = 84;
export interface DisplayPreference {
  mode: DisplayMode;
  readingSize: 100 | 125 | 150;
}
export interface TickerDisplay extends DisplayPreference {
  monitor: string;
  suspended: boolean;
  pageLeader: boolean;
}
export const DEFAULT_DISPLAY: DisplayPreference = {
  mode: "docked",
  readingSize: 100,
};

export function sanitizeDisplays(
  value: unknown,
): Record<string, DisplayPreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, raw]) => {
      if (!raw || typeof raw !== "object" || !name) return [];
      const p = raw as Partial<DisplayPreference>;
      if (!["docked", "grid", "strip"].includes(p.mode ?? "")) return [];
      return [
        [
          name,
          {
            mode: p.mode!,
            readingSize:
              p.readingSize === 125 || p.readingSize === 150
                ? p.readingSize
                : 100,
          },
        ],
      ];
    }),
  );
}

/** Scale the shared cells uniformly; never enlarge beyond one readable column. */
export function displayGeometry(
  width: number,
  height: number,
  mode: DisplayMode,
  readingSize = 100,
) {
  const w = Math.max(1, width),
    h = Math.max(1, height);
  const wide = w / h >= 4;
  const grid = mode === "grid";
  const desired =
    ((grid
      ? Math.min(w / (h > w ? 420 : 950), h / (wide ? 280 : 440))
      : wide
        ? h / 64
        : Math.min(w / (780 + FILL_CONTROLS_W), h / 330)) *
      readingSize) /
    100;
  const scale = Math.min(
    desired,
    w / (grid ? 420 : 780 + FILL_CONTROLS_W),
    h / (grid ? 272 : 64),
  );
  return { scale, width: w / scale, height: h / scale, grid };
}
