import { describe, expect, it } from "vitest";
import { daysFromPeriods, getForecast } from "../src";
import { memoryDb } from "./helpers";

// The shape the National Weather Service returns (checked against the live service 2026-11-15).
const period = (startTime: string, isDaytime: boolean, temperature: number, rain: number | null, windSpeed: string, shortForecast: string) => ({
  startTime, isDaytime, temperature, temperatureUnit: "F", probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: rain }, windSpeed, shortForecast,
});
const periods = [
  period("2026-11-15T18:00:00-05:00", false, 34, 0, "3 mph", "Mostly Clear"),
  period("2026-11-16T06:00:00-05:00", true, 56, 0, "1 mph", "Sunny"),
  period("2026-11-16T18:00:00-05:00", false, 34, 0, "1 mph", "Mostly Clear"),
  period("2026-11-17T06:00:00-05:00", true, 61, 40, "5 to 15 mph", "Chance Rain Showers"),
  period("2026-11-17T18:00:00-05:00", false, 48, 70, "10 mph", "Rain Likely"),
  period("2026-11-18T06:00:00-05:00", true, 52, null, "", "Cloudy"),
];
const answer = (ok = true) => async () => ({ ok, json: async () => ({ properties: { periods } }) });

describe("the forecast", () => {
  it("makes one entry per day from the day and night periods", () => {
    expect(daysFromPeriods(periods)).toEqual([
      { date: "2026-11-15", high_f: null, low_f: 34, rain_pct: null, wind_mph: null, summary: "Tonight: Mostly Clear" },
      { date: "2026-11-16", high_f: 56, low_f: 34, rain_pct: 0, wind_mph: 1, summary: "Sunny" },
      { date: "2026-11-17", high_f: 61, low_f: 48, rain_pct: 40, wind_mph: 15, summary: "Chance Rain Showers" },
      { date: "2026-11-18", high_f: 52, low_f: null, rain_pct: null, wind_mph: null, summary: "Cloudy" },
    ]);
  });
  it("asks the Weather Service once an hour at most, and never sends anything personal", async () => {
    const { db } = memoryDb();
    let calls = 0;
    const seen: unknown[] = [];
    const fetcher = async (url: string, init: { headers: Record<string, string> }) => {
      calls++;
      seen.push(url, init.headers);
      return answer()();
    };
    const at = new Date("2026-11-15T20:00:00Z");
    expect((await getForecast(db, fetcher, at)).length).toBe(4);
    expect((await getForecast(db, fetcher, new Date(at.getTime() + 59 * 60_000))).length).toBe(4);
    expect(calls).toBe(1);
    await getForecast(db, fetcher, new Date(at.getTime() + 61 * 60_000));
    expect(calls).toBe(2);
    expect(seen[0]).toBe("https://api.weather.gov/gridpoints/OKX/34,45/forecast");
    expect(seen[1]).toEqual({ "User-Agent": "personal-health-page", Accept: "application/geo+json" });
  });
  it("falls back to the last forecast kept when the Weather Service fails, and to nothing when there is none", async () => {
    const { db } = memoryDb();
    const down = async () => {
      throw new Error("unreachable");
    };
    expect(await getForecast(db, down, new Date("2026-11-15T20:00:00Z"))).toEqual([]);
    await getForecast(db, answer(), new Date("2026-11-15T20:00:00Z"));
    expect((await getForecast(db, down, new Date("2026-11-16T09:00:00Z"))).length).toBe(4);
    expect((await getForecast(db, answer(false), new Date("2026-11-16T09:00:00Z"))).length).toBe(4);
  });
});
