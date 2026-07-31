/**
 * Appearance — theme, color mode, scale, weight, contrast.
 *
 * Same prefs and option sets as the old GeneralSettings appearance card;
 * only the chrome changed. The theme row gains a three-dot palette
 * preview so you can see what a family looks like before committing.
 */
import {
  THEME_FAMILIES,
  THEME_FAMILY_LABELS,
  type AppearancePrefs,
  type ThemeFamily,
  type ThemeMode,
} from "../../../preferences";
import {
  SegmentedRow,
  SelectRow,
  SettingsGroup,
  RowList,
  ToggleRow,
} from "../SettingsControls";
import { Row } from "./Row";
import ThemeDots from "../ThemeDots";

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

  return (
    <SettingsGroup>
      <RowList>
        <Row id="theme">
          <SelectRow
            label="Theme"
            description="Pick a color palette"
            value={appearance.themeFamily}
            options={THEME_FAMILY_OPTIONS}
            onChange={(v) => set("themeFamily", v)}
            preview={<ThemeDots />}
          />
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
        <Row id="displaySize">
          <SegmentedRow
            label="Display size"
            description="Resize the main app window. Ticker has its own scale."
            value={String(appearance.uiScale)}
            options={APP_SCALE_PRESETS}
            onChange={(v) =>
              set("uiScale", Number(v) as AppearancePrefs["uiScale"])
            }
          />
        </Row>
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
  );
}
