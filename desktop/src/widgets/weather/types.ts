/**
 * Weather widget types, utilities, and API functions.
 *
 * Canonical source for weather-related types and helpers.
 * Import from here — do not redefine locally.
 */
import type { TempUnit } from "../../preferences";
import { LS_WEATHER_CITIES, LS_WEATHER_UNIT } from "../../constants";
import { getStore, setStore } from "../../lib/store";

export type { TempUnit };

export interface WeatherLocation {
  name: string;
  lat: number;
  lon: number;
  country: string;
  /** Admin region (state, province, etc.) */
  admin1?: string;
}

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  /** WMO weather code */
  weatherCode: number;
  isDay: boolean;
  /**
   * Today's forecast high/low, for the chip's range bar.
   *
   * Optional because a cached city fetched before these were requested
   * won't have them — the bar hides itself rather than the chip
   * breaking. They fill in on the next poll.
   */
  tempMax?: number;
  tempMin?: number;
}

export interface SavedCity {
  location: WeatherLocation;
  weather: CurrentWeather | null;
  lastFetched: number;
  error?: string;
}

// ── WMO Weather Codes ───────────────────────────────────────────

export function weatherCodeToLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing Rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code === 77) return "Snow Grains";
  if (code >= 80 && code <= 82) return "Rain Showers";
  if (code >= 85 && code <= 86) return "Snow Showers";
  if (code === 95) return "Thunderstorm";
  if (code >= 96 && code <= 99) return "Hail Storm";
  return "Unknown";
}

export function weatherCodeToIcon(code: number, isDay?: boolean): string {
  if (code === 0) return isDay === false ? "\u263E" : "\u2600";
  if (code <= 2) return isDay === false ? "\u263E" : "\u26C5";
  if (code === 3) return "\u2601";
  if (code === 45 || code === 48) return "\u2588";
  if (code >= 51 && code <= 55) return "\u2602";
  if (code >= 56 && code <= 57) return "\u2602";
  if (code >= 61 && code <= 65) return "\u2614";
  if (code >= 66 && code <= 67) return "\u2614";
  if (code >= 71 && code <= 77) return "\u2744";
  if (code >= 80 && code <= 82) return "\u2614";
  if (code >= 85 && code <= 86) return "\u2744";
  if (code >= 95) return "\u26A1";
  return "\u2601";
}

export function windDirectionToLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

// ── Formatting ──────────────────────────────────────────────────

export { formatTemp } from "../../utils/format";

export function formatWind(kmh: number, unit: TempUnit): string {
  if (unit === "fahrenheit") {
    return `${Math.round(kmh * 0.621371)} mph`;
  }
  return `${Math.round(kmh)} km/h`;
}

// ── Storage ─────────────────────────────────────────────────────

export function loadCities(): SavedCity[] {
  const cities = getStore<SavedCity[]>(LS_WEATHER_CITIES, []);
  return Array.isArray(cities) && cities.length > 0 ? cities : [];
}

export function saveCities(cities: SavedCity[]): void {
  setStore(LS_WEATHER_CITIES, cities);
}

export function loadUnit(): TempUnit {
  const unit = getStore<string>(LS_WEATHER_UNIT, "fahrenheit");
  return unit === "celsius" || unit === "fahrenheit" ? unit : "fahrenheit";
}

export function saveUnit(unit: TempUnit): void {
  setStore(LS_WEATHER_UNIT, unit);
}

// ── Open-Meteo API ──────────────────────────────────────────────

export async function searchCities(query: string): Promise<WeatherLocation[]> {
  if (query.trim().length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      country: string;
      admin1?: string;
    }>;
  };
  if (!data.results) return [];
  return data.results.map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    country: r.country,
    admin1: r.admin1,
  }));
}

export async function fetchWeather(
  lat: number,
  lon: number,
): Promise<CurrentWeather> {
  // `daily` added for the chip's range bar. `timezone=auto` matters:
  // without it Open-Meteo computes the day boundary in UTC, so a city
  // several hours off would get yesterday's high in its evening.
  // forecast_days=1 keeps the response small — we only want today.
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const data = (await res.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      apparent_temperature: number;
      weather_code: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
      is_day: number;
    };
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  const c = data.current;
  const d = data.daily;
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    windSpeed: c.wind_speed_10m,
    windDirection: c.wind_direction_10m,
    weatherCode: c.weather_code,
    isDay: c.is_day === 1,
    tempMax: d?.temperature_2m_max?.[0],
    tempMin: d?.temperature_2m_min?.[0],
  };
}
