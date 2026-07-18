/**
 * WeatherCard — renders a single city's current weather.
 *
 * Supports compact (single-row) and comfort (expanded with
 * humidity, wind, feels-like) display modes.
 */
import { clsx } from "clsx";
import { X } from "lucide-react";
import type { SavedCity, TempUnit } from "./types";
import {
  weatherCodeToIcon,
  weatherCodeToLabel,
  windDirectionToLabel,
  formatTemp,
  formatWind,
} from "./types";
import Tooltip from "../../components/Tooltip";
import { FEED_CARD, FEED_CARD_STATIC } from "../../components/feedCard";

// ── Inline SVG Icons ────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 5.5A4 4 0 0 0 2.5 4M2 6.5A4 4 0 0 0 9.5 8" />
      <path d="M10 2.5V5.5H7M2 9.5V6.5H5" />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────

interface WeatherCardProps {
  city: SavedCity;
  unit: TempUnit;
  compact: boolean;
  onRemove: () => void;
  onRefresh: () => void;
}

export function WeatherCard({
  city,
  unit,
  compact,
  onRemove,
  onRefresh,
}: WeatherCardProps) {
  const { location, weather, error } = city;
  const label = location.admin1
    ? `${location.name}, ${location.admin1}`
    : `${location.name}, ${location.country}`;

  if (compact) {
    return (
      <div
        className={clsx(
          FEED_CARD,
          FEED_CARD_STATIC,
          "group flex items-center justify-between",
        )}
        style={{ animation: "widget-card-enter 0.25s ease-out both" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono text-widget-weather/80 uppercase tracking-wider shrink-0 w-24 truncate">
            {location.name}
          </span>
          {weather ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">
                {weatherCodeToIcon(weather.weatherCode, weather.isDay)}
              </span>
              <span className="text-sm font-mono font-semibold text-fg tabular-nums">
                {formatTemp(weather.temperature, unit)}
              </span>
              <span className="text-[11px] font-mono text-fg-2">
                {weatherCodeToLabel(weather.weatherCode)}
              </span>
            </div>
          ) : error ? (
            <span className="text-[11px] font-mono text-error truncate">
              {error}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-fg-3">Loading...</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content="Refresh">
            <button
              onClick={onRefresh}
              className="text-fg-3 hover:text-widget-weather opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <RefreshIcon />
            </button>
          </Tooltip>
          <Tooltip content="Remove city">
            <button
              onClick={onRemove}
              className="text-fg-3 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(FEED_CARD, FEED_CARD_STATIC, "group relative")}
      style={{ animation: "widget-card-enter 0.25s ease-out both" }}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip content="Refresh">
          <button
            onClick={onRefresh}
            className="text-fg-3 hover:text-widget-weather p-0.5"
          >
            <RefreshIcon />
          </button>
        </Tooltip>
        <Tooltip content="Remove city">
          <button
            onClick={onRemove}
            className="text-fg-3 hover:text-error p-0.5"
          >
            <X size={12} />
          </button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono text-widget-weather/80 uppercase tracking-wider truncate">
          {label}
        </span>
      </div>

      {weather ? (
        <>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">
              {weatherCodeToIcon(weather.weatherCode, weather.isDay)}
            </span>
            <div>
              <div className="text-xl font-mono font-bold text-fg tabular-nums leading-none">
                {formatTemp(weather.temperature, unit)}
              </div>
              <div className="text-xs font-mono text-fg-2 mt-0.5">
                Feels {formatTemp(weather.feelsLike, unit)}
              </div>
            </div>
          </div>

          <div className="text-xs font-mono text-fg mb-2">
            {weatherCodeToLabel(weather.weatherCode)}
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono text-fg-2">
            <span>
              {"\u{1F4A7}"} {weather.humidity}%
            </span>
            <span>
              {"\u{1F4A8}"} {formatWind(weather.windSpeed, unit)}{" "}
              {windDirectionToLabel(weather.windDirection)}
            </span>
          </div>
        </>
      ) : error ? (
        <div className="py-3">
          <span className="text-xs font-mono text-error">{error}</span>
          <button
            onClick={onRefresh}
            className="block text-[11px] font-mono text-widget-weather/70 hover:text-widget-weather mt-1 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="py-3">
          <span className="text-[11px] font-mono text-fg-3">
            Loading weather...
          </span>
        </div>
      )}
    </div>
  );
}
