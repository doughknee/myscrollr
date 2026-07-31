import type {
  AppearancePrefs,
  WindowPrefs,
  ThemeMode,
  ThemeFamily,
} from "../../preferences";
import { THEME_FAMILIES, THEME_FAMILY_LABELS } from "../../preferences";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  SelectRow,
  ResetButton,
} from "./SettingsControls";

// ── Props ───────────────────────────────────────────────────────

interface GeneralSettingsProps {
  appearance: AppearancePrefs;
  window_: WindowPrefs;
  onAppearanceChange: (prefs: AppearancePrefs) => void;
  onWindowChange: (prefs: WindowPrefs) => void;
  onReset: () => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
}

// ── Options ─────────────────────────────────────────────────────

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

const THEME_FAMILY_OPTIONS: { value: ThemeFamily; label: string }[] =
  THEME_FAMILIES.map((family) => ({
    value: family,
    label: THEME_FAMILY_LABELS[family],
  }));

const FONT_WEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "bold", label: "Bold" },
];

const APP_SCALE_PRESETS: { value: string; label: string }[] = [
  { value: "85", label: "85%" },
  { value: "100", label: "100%" },
  { value: "115", label: "115%" },
  { value: "130", label: "130%" },
];

// ── Component ───────────────────────────────────────────────────

export default function GeneralSettings({
  appearance,
  window_,
  onAppearanceChange,
  onWindowChange,
  onReset,
  autostartEnabled,
  onAutostartChange,
}: GeneralSettingsProps) {
  const setApp = <K extends keyof AppearancePrefs>(
    key: K,
    value: AppearancePrefs[K],
  ) => {
    onAppearanceChange({ ...appearance, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-2 items-start">
        <div className="space-y-4">
          <Section title="Appearance" variant="card">
            <SelectRow
              label="Theme"
              description="Pick a color palette"
              value={appearance.themeFamily}
              options={THEME_FAMILY_OPTIONS}
              onChange={(v) => setApp("themeFamily", v)}
            />
            <SegmentedRow
              label="Color mode"
              description="Light, dark, or follow the system"
              value={appearance.themeMode}
              options={THEME_MODE_OPTIONS}
              onChange={(v) => setApp("themeMode", v)}
            />
            <SegmentedRow
              label="Display size"
              description="Resize the main app window. Ticker has its own scale."
              value={String(appearance.uiScale)}
              options={APP_SCALE_PRESETS}
              onChange={(v) => setApp("uiScale", Number(v) as AppearancePrefs["uiScale"])}
            />
            <SegmentedRow
              label="Font weight"
              description="Increase text thickness for readability"
              value={appearance.fontWeight}
              options={FONT_WEIGHT_OPTIONS}
              onChange={(v) => setApp("fontWeight", v as AppearancePrefs["fontWeight"])}
            />
            <ToggleRow
              label="High contrast text"
              description="Brighten muted text for easier reading"
              checked={appearance.highContrast}
              onChange={(v) => setApp("highContrast", v)}
            />
          </Section>

          <Section title="Window" variant="card">
            <ToggleRow
              label="Always on top"
              description="Keep the ticker above all other windows"
              checked={window_.pinned}
              onChange={(v) => onWindowChange({ ...window_, pinned: v })}
            />
            <ToggleRow
              label="Hide when an app goes fullscreen"
              description="Hides the ticker when YouTube, games, or other apps enter fullscreen so they aren't visually clipped. Windows only."
              checked={window_.hideOnFullscreen}
              onChange={(v) => onWindowChange({ ...window_, hideOnFullscreen: v })}
            />
          </Section>

          <Section title="Startup" variant="card">
            <ToggleRow
              label="Launch on system startup"
              description="Automatically open Scrollr when you start your computer"
              checked={autostartEnabled}
              onChange={onAutostartChange}
            />
          </Section>
        </div>

        <div className="space-y-4">

          <Section title="In-app shortcuts" variant="card">
            <ShortcutsList />
          </Section>

        </div>
      </div>

      <div className="flex items-center justify-end pt-3">
        <ResetButton label="Reset general settings" onClick={onReset} />
      </div>
    </div>
  );
}

// ── Keyboard shortcuts list (read-only) ─────────────────────────
//
// The desktop app already implements these shortcuts in __root.tsx —
// this component just documents them where users can find them.
// Customization is intentionally out of scope for now.

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘/Ctrl", ","], label: "Open Customize" },
  { keys: ["⌘/Ctrl", "T"], label: "Toggle ticker visibility" },
  { keys: ["⌘/Ctrl", "Shift", "T"], label: "Cycle theme (light → dark → auto)" },
  { keys: ["Esc"], label: "Back / close current view" },
];


function ShortcutsList() {
  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3 pb-1">
        <p className="text-ui-meta leading-snug">
          Available while Scrollr is the focused app.
        </p>
        <span className="shrink-0 rounded-full border border-edge/40 bg-base-200/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-fg-4">
          Focused
        </span>
      </div>
      {SHORTCUTS.map(({ keys, label }) => (
        <div key={label} className="flex items-center justify-between gap-4 rounded-lg py-1.5">
          <span className="text-ui-muted leading-tight">{label}</span>
          <div className="flex items-center gap-1">
            {keys.map((k, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-ui-chip text-fg-4">+</span>}
                <kbd className="px-1.5 py-0.5 rounded bg-base-250 border border-edge/40 text-ui-chip font-mono font-medium text-fg-2 shadow-sm">
                  {k}
                </kbd>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
