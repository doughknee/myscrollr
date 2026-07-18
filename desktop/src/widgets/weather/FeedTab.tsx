/**
 * Weather widget FeedTab — desktop-native.
 *
 * Reads weather data from TanStack Query (kept fresh by the shell-level
 * observer in __root.tsx). City add/remove writes to the store and
 * invalidates the query for immediate refetch.
 */
import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tooltip from "../../components/Tooltip";
import { CloudSun, LocateFixed } from "lucide-react";
import { WeatherCard } from "./WeatherCard";
import { CitySearch } from "./CitySearch";
import { WidgetBar, BarPill } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SearchBox } from "../../components/widget-bar/SearchBox";
import { useStoreData } from "../../hooks/useStoreData";
import { LS_WEATHER_UNIT } from "../../constants";
import { weatherQueryOptions, queryKeys } from "../../api/queries";
import type { FeedTabProps, WidgetManifest } from "../../types";
import type { TempUnit, WeatherLocation } from "./types";
import { loadCities, saveCities, loadUnit, saveUnit } from "./types";
import { toast } from "sonner";

// ── Widget manifest ─────────────────────────────────────────────

export const weatherWidget: WidgetManifest = {
  id: "weather",
  name: "Weather",
  tabLabel: "Weather",
  description: "Current conditions for your locations",
  hex: "#0ea5e9",
  icon: CloudSun,
  info: {
    about:
      "The Weather widget shows current weather conditions for one or more " +
      "locations on your ticker. Weather data updates automatically.",
    usage: [
      "Search for a city in the feed view to add it to your weather locations.",
      "Each location appears on the ticker with temperature, conditions, and an icon.",
      "Add multiple cities to track weather across different locations.",
      "Use the °F/°C control in the top bar to change units.",
    ],
  },
  FeedTab: WeatherFeedTab,
};

// ── FeedTab ─────────────────────────────────────────────────────

const UNIT_OPTIONS: SegmentedOption<TempUnit>[] = [
  { value: "fahrenheit", label: "°F" },
  { value: "celsius", label: "°C" },
];

function WeatherFeedTab(props: FeedTabProps) {
  // Unit + city-add state live here because the bar writes them and the
  // body renders from them — useStoreData only relays cross-window
  // writes, so bar and body as siblings would desync in-window.
  const [unit, setUnitState] = useStoreData(LS_WEATHER_UNIT, loadUnit);
  const handleUnitChange = useCallback(
    (v: TempUnit) => {
      setUnitState(v);
      saveUnit(v);
    },
    [setUnitState],
  );

  const [cityQuery, setCityQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [detecting, setDetecting] = useState(false);
  const queryClient = useQueryClient();

  // Add city — write to store, then invalidate query for immediate fetch
  const addCity = useCallback(
    (location: WeatherLocation) => {
      const current = loadCities();
      const exists = current.some(
        (c) =>
          c.location.lat === location.lat && c.location.lon === location.lon,
      );
      if (exists) return;
      saveCities([...current, { location, weather: null, lastFetched: 0 }]);
      queryClient.invalidateQueries({ queryKey: queryKeys.weather });
      setCityQuery("");
    },
    [queryClient],
  );

  // Detect location via IP-based geolocation
  const detectLocation = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await fetch("http://ip-api.com/json/?fields=status,city,lat,lon,country,regionName");
      if (!res.ok) throw new Error("Request failed");
      const data = (await res.json()) as {
        status: string;
        city?: string;
        lat?: number;
        lon?: number;
        country?: string;
        regionName?: string;
      };
      if (data.status !== "success" || data.lat == null || data.lon == null) {
        throw new Error("Location not found");
      }
      addCity({
        name: data.city || "My Location",
        lat: data.lat,
        lon: data.lon,
        country: data.country ?? "",
        admin1: data.regionName,
      });
    } catch {
      toast.error("Couldn't detect your location — try searching for a city instead");
    } finally {
      setDetecting(false);
    }
  }, [addCity]);

  const comfort = props.mode === "comfort";
  return (
    <div className="flex min-h-full flex-col">
      {comfort && (
        <WidgetBar>
          <Segmented
            ariaLabel="Temperature unit"
            value={unit}
            onChange={handleUnitChange}
            options={UNIT_OPTIONS}
          />
          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            <Tooltip content="Use my location">
              <span>
                <BarPill active={false} onClick={detectLocation}>
                  <LocateFixed
                    size={13}
                    className={detecting ? "animate-pulse" : undefined}
                  />
                </BarPill>
              </span>
            </Tooltip>
            <SearchBox
              inputRef={searchRef}
              query={cityQuery}
              onQueryChange={setCityQuery}
              resultCount={null}
              ariaLabel="Add city"
              noun="cities"
            />
          </div>
        </WidgetBar>
      )}
      <WeatherFeedBody
        {...props}
        unit={unit}
        cityQuery={comfort ? cityQuery : undefined}
        onAddCity={addCity}
        onDetect={detectLocation}
        detecting={detecting}
        onFocusSearch={() => searchRef.current?.focus()}
      />
    </div>
  );
}

function WeatherFeedBody({
  mode: feedMode,
  unit,
  cityQuery,
  onAddCity,
  onDetect,
  detecting,
  onFocusSearch,
}: FeedTabProps & {
  unit: TempUnit;
  /** Set in comfort mode — the bar's SearchBox drives the city results. */
  cityQuery?: string;
  onAddCity: (location: WeatherLocation) => void;
  onDetect: () => void;
  detecting: boolean;
  onFocusSearch: () => void;
}) {
  const compact = feedMode === "compact";
  const barDriven = cityQuery !== undefined;

  // Weather data from TanStack Query — shared cache with __root.tsx observer
  const { data: cities = [] } = useQuery(weatherQueryOptions());
  const queryClient = useQueryClient();

  const [showSearch, setShowSearch] = useState(false);

  // Compact's in-body picker closes itself after an add; the bar path
  // clears its query in the FeedTab instead.
  const addFromPanel = useCallback(
    (location: WeatherLocation) => {
      onAddCity(location);
      setShowSearch(false);
    },
    [onAddCity],
  );

  // Remove city — write to store, then invalidate
  const removeCity = useCallback(
    (lat: number, lon: number) => {
      const current = loadCities();
      saveCities(
        current.filter(
          (c) => c.location.lat !== lat || c.location.lon !== lon,
        ),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.weather });
    },
    [queryClient],
  );

  // Refresh — invalidate triggers refetch for all cities
  const refreshCity = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.weather });
  }, [queryClient]);

  // ── Empty state ─────────────────────────────────────────────
  if (cities.length === 0 && !showSearch && !cityQuery?.trim()) {
    return (
      <div className="p-4 flex flex-col items-center justify-center gap-3">
        <span className="text-2xl">{"\u2600"}</span>
        <span className="text-xs font-mono text-fg-2 text-center">
          Add a city to see weather
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => (barDriven ? onFocusSearch() : setShowSearch(true))}
            className="text-xs font-mono font-semibold text-widget-weather px-3 py-1.5 rounded-lg bg-widget-weather/10 border border-widget-weather/25 hover:bg-widget-weather/15 transition-colors"
          >
            Search City
          </button>
          <button
            onClick={onDetect}
            disabled={detecting}
            className="text-xs font-mono text-fg px-3 py-1.5 rounded-lg bg-surface-2 border border-edge hover:border-edge-2 transition-colors disabled:opacity-40"
          >
            {detecting ? "Detecting..." : "Use My Location"}
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────
  return (
    <div className="p-3 space-y-2">
      {/* Header — compact only; comfort's controls live in the bar. */}
      {compact && (
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs font-mono font-semibold text-widget-weather/80 uppercase tracking-wider">
            Weather
          </span>
          <div className="flex items-center gap-2">
            <Tooltip content="Use my location">
              <button
                onClick={onDetect}
                disabled={detecting}
                className="text-xs font-mono text-widget-weather/70 hover:text-widget-weather transition-colors disabled:opacity-40"
              >
                {detecting ? "..." : "\u{1F4CD}"}
              </button>
            </Tooltip>
            <button
              onClick={() => {
                setShowSearch(!showSearch);
              }}
              className="text-xs font-mono text-widget-weather/70 hover:text-widget-weather transition-colors"
            >
              {showSearch ? "Done" : "+ Add"}
            </button>
          </div>
        </div>
      )}

      {/* Search — bar-driven results in comfort, in-body panel in compact */}
      {barDriven
        ? cityQuery.trim().length > 0 && (
            <CitySearch query={cityQuery} onSelect={onAddCity} />
          )
        : showSearch && <CitySearch onSelect={addFromPanel} />}

      {/* Weather cards */}
      <div className={compact ? "space-y-1" : "grid gap-2"}>
        {cities.map((city) => (
          <WeatherCard
            key={`${city.location.lat}-${city.location.lon}`}
            city={city}
            unit={unit}
            compact={compact}
            onRemove={() =>
              removeCity(city.location.lat, city.location.lon)
            }
            onRefresh={() => refreshCity()}
          />
        ))}
      </div>
    </div>
  );
}
