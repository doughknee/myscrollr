/**
 * Weather settings surface — rendered inside the in-feed gear popover.
 * 2026-07-17 unification: every tracked city reaches the ticker, so
 * only widget-level behavior (units) lives here.
 */
import { useCallback } from "react";
import {
  Section,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { LS_WEATHER_UNIT } from "../../constants";
import { loadUnit } from "./types";
import type { TempUnit } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const UNIT_OPTIONS: { value: TempUnit; label: string }[] = [
  { value: "fahrenheit", label: "°F" },
  { value: "celsius", label: "°C" },
];

export default function WeatherSettings(_props: WidgetConfigPanelProps) {
  const [unit, setUnitState] = useStoreData(LS_WEATHER_UNIT, loadUnit);

  const handleUnitChange = useCallback((v: TempUnit) => {
    setUnitState(v);
    setStore(LS_WEATHER_UNIT, v);
  }, []);

  return (
    <Section title="Display">
      <SegmentedRow
        label="Units"
        value={unit}
        options={UNIT_OPTIONS}
        onChange={handleUnitChange}
      />
    </Section>
  );
}
