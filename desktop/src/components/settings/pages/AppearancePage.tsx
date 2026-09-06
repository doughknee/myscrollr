/**
 * Appearance — theme, color mode, app size, readability, units.
 *
 * The theme picker is a grid of every palette rather than a select: each
 * swatch carries `data-theme` for its own family, so its three dots are
 * rendered from THAT palette's tokens (style.css matches `.theme-swatch`
 * alongside the shells). The choice is the preview.
 *
 * Units & formats live here because °F/°C and 12h/24h are a person's
 * preference, not a per-widget one — Weather, Sysmon and Clock all read
 * `appearance.units`.
 */
import { Check } from "lucide-react";
import { clsx } from "clsx";
import {
  THEME_FAMILIES,
  THEME_FAMILY_LABELS,
  SCALE_PRESETS,
  resolveThemeMode,
  resolveThemeName,
  type AppearancePrefs,
  type ThemeMode,
  type UnitsPrefs,
} from "../../../preferences";
import {
  SegmentedRow,
  SettingsGroup,
  RowList,
  ToggleRow,
} from "../SettingsControls";
import { Row } from "./Row";

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

const FONT_WEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "bold", label: "Bold" },
];

const APP_SCALE_OPTIONS = SCALE_PRESETS.map((p) => ({
  value: String(p),
  label: `${p}%`,
}));

const TEMPERATURE_OPTIONS: { value: UnitsPrefs["temperature"]; label: string }[] = [
  { value: "fahrenheit", label: "°F" },
  { value: "celsius", label: "°C" },
];

const TIME_FORMAT_OPTIONS: { value: UnitsPrefs["timeFormat"]; label: string }[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];

interface AppearancePageProps {
  appearance: AppearancePrefs;
  onAppearanceChange: (prefs: AppearancePrefs) => void;
}

export default function AppearancePage({
  appearance,
  onAppearanceChange,
}: AppearancePageProps) {
  const set = <K extends keyof AppearancePrefs>(
    key: K,
    value: AppearancePrefs[K],
  ) => onAppearanceChange({ ...appearance, [key]: value });
  const setUnit = <K extends keyof UnitsPrefs>(key: K, value: UnitsPrefs[K]) =>
    set("units", { ...appearance.units, [key]: value });

  // Swatches preview each family in the mode you are in now.
  const mode = resolveThemeMode(appearance.themeMode);

  return (
    <>
      <SettingsGroup>
        <RowList>
          <Row id="theme">
            <div className="px-4 py-3">
              <div className="text-ui-body font-medium text-fg">Theme</div>
              <div className="mt-0.5 text-ui-meta text-fg-3">
                Pick a color palette
              </div>
              <div
                role="radiogroup"
                aria-label="Theme"
                className="mt-3 grid grid-cols-5 gap-2"
              >
                {THEME_FAMILIES.map((family) => {
                  const selected = family === appearance.themeFamily;
                  return (
                    <button
                      key={family}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set("themeFamily", family)}
                      // Dots above the name so five fit across the card
                      // without truncating "Tokyo Night" or "Everforest".
                      className={clsx(
                        "relative flex cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2 text-left text-ui-chip",
                        selected
                          ? "border-accent bg-accent/10 font-semibold text-fg ring-1 ring-accent"
                          : "border-edge/55 text-fg-2 hover:border-edge-2 hover:text-fg",
                      )}
                    >
                      <span
                        className="theme-swatch inline-flex items-center gap-1"
                        data-theme={resolveThemeName(family, mode)}
                        aria-hidden
                      >
                        <span className="size-3 rounded-full bg-accent" />
                        <span className="size-3 rounded-full bg-accent-purple" />
                        <span className="size-3 rounded-full bg-info" />
                      </span>
                      <span className="w-full truncate">
                        {THEME_FAMILY_LABELS[family]}
                      </span>
                      {selected && (
                        <Check
                          size={14}
                          className="absolute right-2 top-2 text-accent"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </Row>
          <Row id="colorMode">
            <SegmentedRow
              label="Color mode"
              description="Light, dark, or follow the system"
              value={appearance.themeMode}
              options={THEME_MODE_OPTIONS}
              onChange={(v) => set("themeMode", v)}
            />
          </Row>
          <Row id="appSize">
            <SegmentedRow
              label="App size"
              description="Resize the main app window. The ticker has its own scale."
              value={String(appearance.uiScale)}
              options={APP_SCALE_OPTIONS}
              onChange={(v) => set("uiScale", Number(v))}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Readability">
        <RowList>
          <Row id="fontWeight">
            <SegmentedRow
              label="Font weight"
              description="Increase text thickness for readability"
              value={appearance.fontWeight}
              options={FONT_WEIGHT_OPTIONS}
              onChange={(v) =>
                set("fontWeight", v as AppearancePrefs["fontWeight"])
              }
            />
          </Row>
          <Row id="highContrast">
            <ToggleRow
              label="High contrast text"
              description="Brighten muted text for easier reading"
              checked={appearance.highContrast}
              onChange={(v) => set("highContrast", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Units & formats">
        <RowList>
          <Row id="temperature">
            <SegmentedRow
              label="Temperature"
              description="Used by Weather and System monitor"
              value={appearance.units.temperature}
              options={TEMPERATURE_OPTIONS}
              onChange={(v) => setUnit("temperature", v)}
            />
          </Row>
          <Row id="timeFormat">
            <SegmentedRow
              label="Time"
              description="Used by Clock and the ticker"
              value={appearance.units.timeFormat}
              options={TIME_FORMAT_OPTIONS}
              onChange={(v) => setUnit("timeFormat", v)}
            />
          </Row>
        </RowList>
      </SettingsGroup>
    </>
  );
}
