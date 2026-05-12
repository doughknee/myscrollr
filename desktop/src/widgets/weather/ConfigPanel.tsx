import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { DEFAULT_WEATHER_TICKER } from "../../preferences";
import { LS_WEATHER_CITIES, LS_WEATHER_UNIT } from "../../constants";
import { loadCities, loadUnit } from "./types";
import type { TempUnit } from "../../preferences";
import type { SavedCity } from "./types";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

function cityName(city: SavedCity): string {
  return city.location.name;
}

const UNIT_OPTIONS: { value: TempUnit; label: string }[] = [
  { value: "fahrenheit", label: "\u00B0F" },
  { value: "celsius", label: "\u00B0C" },
];

export default function WeatherConfigPanel({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("weather", prefs, onPrefsChange);
  const [cities] = useStoreData(LS_WEATHER_CITIES, loadCities);
  const [unit, setUnitState] = useStoreData(LS_WEATHER_UNIT, loadUnit);
  const { isExcluded: isCityExcluded, toggle: toggleCity } =
    useTickerExclusion(config.ticker.excludedCities, "excludedCities", setTicker);

  const handleUnitChange = useCallback((v: TempUnit) => {
    setUnitState(v);
    setStore(LS_WEATHER_UNIT, v);
  }, []);

  const resetAll = useCallback(() => {
    update({
      ticker: { ...DEFAULT_WEATHER_TICKER },
    });
    setStore(LS_WEATHER_UNIT, "fahrenheit");
    setUnitState("fahrenheit");
  }, [update]);

  const weatherIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-widget-weather)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );

  return (
    <ConfigPanelLayout
      icon={weatherIcon}
      hex="var(--color-widget-weather)"
      title="Weather Settings"
      subtitle="Current conditions for your saved cities"
      onReset={resetAll}
    >
      <Section title="Ticker">
        {cities.map((city) => (
          <ToggleRow
            key={cityName(city)}
            label={cityName(city)}
            description={[city.location.admin1, city.location.country].filter(Boolean).join(", ")}
            checked={!isCityExcluded(cityName(city))}
            onChange={() => toggleCity(cityName(city))}
          />
        ))}
        {cities.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-fg-4">
            Add cities in the Weather tab to choose what shows on the ticker.
          </div>
        )}
        <TickerPinSection widgetId="weather" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

      <Section title="Display">
        <SegmentedRow
          label="Units"
          value={unit}
          options={UNIT_OPTIONS}
          onChange={handleUnitChange}
        />
      </Section>
    </ConfigPanelLayout>
  );
}
