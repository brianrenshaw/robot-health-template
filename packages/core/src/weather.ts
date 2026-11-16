// weather.ts
// The forecast, for choosing bike days. This is the ONE outside thing the site reads, and the
// only code that does it. The owner asked for it (2026-11-15): "Biking will kind of be determined by
// the weather, so we need to be able to figure out what to do next and kind of have a forecast
// built in as well."
//
// Source: the US National Weather Service (api.weather.gov). Free, no account, no key. Nothing
// about the owner is sent: only the request for one forecast grid square.
// Place: New York (Central Park, 40.78, -73.97), which the Weather Service maps to
// its grid square LMK 50,78. To move it, look up a new square at
// https://api.weather.gov/points/<lat>,<lon> and change FORECAST_URL.
// (Open-Meteo was tried first and refused: its free tier limits by network address, and the
// addresses Cloudflare Workers share are over the limit.)
//
// The forecast is fetched only when the page or the coach asks, and kept for an hour in
// `weather_cache`. If the Weather Service does not answer, the last one kept is used; if there
// is none, the forecast is simply absent. Nothing else depends on it.

import type { Db } from "./db";

export const WEATHER_PLACE = "New York, NY";
const FORECAST_URL = "https://api.weather.gov/gridpoints/OKX/34,45/forecast";
const KEEP_FOR_MS = 60 * 60 * 1000;

/** One day of forecast. Anything the Weather Service did not give is null. */
export interface ForecastDay {
  date: string;
  /** Daytime high and overnight low, °F. */
  high_f: number | null;
  low_f: number | null;
  /** Chance of rain or snow during the day, percent. */
  rain_pct: number | null;
  /** Strongest daytime wind, mph. */
  wind_mph: number | null;
  /** "Mostly Sunny", "Chance Rain Showers". */
  summary: string | null;
}

interface Period {
  startTime?: string;
  isDaytime?: boolean;
  temperature?: number | null;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  windSpeed?: string | null;
  shortForecast?: string | null;
}

/**
 * Turn the Weather Service's day and night periods into one entry per day. A period's day is
 * the local date it starts on (its startTime carries the local offset). The night that starts
 * on a day gives that day's low. The evening of today has no daytime period: it gets a low only.
 */
export function daysFromPeriods(periods: Period[]): ForecastDay[] {
  const days = new Map<string, ForecastDay>();
  const day = (date: string) => {
    if (!days.has(date)) days.set(date, { date, high_f: null, low_f: null, rain_pct: null, wind_mph: null, summary: null });
    return days.get(date)!;
  };
  for (const p of periods) {
    const date = /^\d{4}-\d{2}-\d{2}/.exec(p.startTime ?? "")?.[0];
    if (!date) continue;
    const temp = typeof p.temperature === "number" ? (p.temperatureUnit === "C" ? Math.round((p.temperature * 9) / 5 + 32) : p.temperature) : null;
    const d = day(date);
    if (p.isDaytime) {
      d.high_f = temp;
      d.rain_pct = typeof p.probabilityOfPrecipitation?.value === "number" ? p.probabilityOfPrecipitation.value : null;
      const speeds = (p.windSpeed ?? "").match(/\d+/g)?.map(Number) ?? [];
      d.wind_mph = speeds.length ? Math.max(...speeds) : null;
      d.summary = p.shortForecast ?? null;
    } else {
      d.low_f = temp;
      if (d.summary === null) d.summary = p.shortForecast ? `Tonight: ${p.shortForecast}` : null;
    }
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * The forecast for the days ahead, oldest first. Uses the copy kept in the database when it is
 * under an hour old; otherwise asks the Weather Service and keeps the answer. Never throws:
 * when the Weather Service is unreachable it returns the last copy kept, or an empty list.
 */
export async function getForecast(db: Db, fetcher: Fetcher = fetch as unknown as Fetcher, now = new Date()): Promise<ForecastDay[]> {
  const kept = await db.first<{ fetched_at: string; body: string }>("SELECT fetched_at, body FROM weather_cache WHERE place = ?", [WEATHER_PLACE]);
  const keptDays = (): ForecastDay[] => {
    try {
      return kept ? (JSON.parse(kept.body) as ForecastDay[]) : [];
    } catch {
      return [];
    }
  };
  if (kept && now.getTime() - Date.parse(kept.fetched_at) < KEEP_FOR_MS) return keptDays();
  try {
    // The Weather Service asks every caller to name itself. A generic name, nothing personal.
    const res = await fetcher(FORECAST_URL, { headers: { "User-Agent": "personal-health-page", Accept: "application/geo+json" } });
    if (!res.ok) return keptDays();
    const body = (await res.json()) as { properties?: { periods?: Period[] } };
    const days = daysFromPeriods(body.properties?.periods ?? []);
    if (!days.length) return keptDays();
    await db.run(
      `INSERT INTO weather_cache (place, fetched_at, body) VALUES (?, ?, ?)
       ON CONFLICT(place) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body`,
      [WEATHER_PLACE, now.toISOString(), JSON.stringify(days)],
    );
    return days;
  } catch {
    return keptDays();
  }
}
