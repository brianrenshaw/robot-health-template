import { describe, expect, it } from "vitest";
import { FIELDS, type DayView, type Workout } from "@health/core";
import { bucketAverages, bucketCounts, buckets, kpis, rolling, trainingDays } from "./series";
import { axisFormat, niceTicks } from "./scale";
import { shiftDay } from "./measures";

const today = "2026-11-30"; // a Monday
const blank = { kcal_eaten: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, active_kcal: null, steps: null, resting_hr: null, vo2max: null, weight_lb: null, weight_source: null, incomplete: false, partial: false };
const day = (ago: number, more: Partial<DayView>): DayView => ({ date: shiftDay(today, -ago), ...blank, ...more, partial: ago === 0 });
const workout = (ago: number, activity_type: string): Workout => ({ id: ago, local_date: shiftDay(today, -ago), start_utc: "", end_utc: "", activity_type, duration_sec: null, distance_m: null, energy_kcal: null, indoor: null, temp_c: null, avg_hr: null, max_hr: null, source: "apple_health" });

describe("bars", () => {
  it("draws a bar a day for 30 days, a week for 90, a month for a year", () => {
    const d = buckets(today, 30);
    expect([d.length, d[0]!.from, d.at(-1)!.to, d.at(-1)!.label]).toEqual([30, "2026-11-01", "2026-11-30", "Nov 30"]);
    const w = buckets(today, 90);
    expect(w.every((b) => new Date(`${b.from}T12:00:00Z`).getUTCDay() === 1)).toBe(true); // weeks start on Monday
    expect([w.length, w.at(-1)!.from, w.at(-1)!.label]).toEqual([14, "2026-11-30", "Nov 30 to Dec 6"]);
    const m = buckets(today, 365);
    expect([m.length, m[0]!.from, m.at(-1)!.label, m.at(-1)!.axis]).toEqual([12, "2025-12-01", "November 2026", "Nov"]);
  });
  it("averages what falls in a bar and leaves an empty bar empty", () => {
    const bars = buckets(today, 90).slice(-2);
    expect(bucketAverages(bars, [{ day: "2026-11-23", value: 100 }, { day: "2026-11-25", value: 200 }])).toEqual([150, null]);
    expect(bucketCounts(bars, ["2026-11-23", "2026-11-29", "2026-11-30"])).toEqual([2, 1]);
  });
});

describe("lines", () => {
  it("smooths with the seven days ending on each point", () => {
    const points = [{ day: "2026-11-01", value: 10 }, { day: "2026-11-03", value: 20 }, { day: "2026-11-12", value: 40 }];
    expect(rolling(points).map((p) => p.value)).toEqual([10, 15, 40]);
  });
  it("picks clean axis values", () => {
    expect(niceTicks(0, 2300)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(181.2, 186.4)).toEqual([180, 182, 184, 186, 188]);
    const flat = niceTicks(54, 54); // a flat line still gets an axis around it
    expect(flat[0]! < 54 && flat.at(-1)! > 54).toBe(true);
    expect(axisFormat([0, 5000, 10000])(10000)).toBe("10K");
    expect(axisFormat([0, 1000, 2000])(2000)).toBe("2,000");
  });
});

describe("training", () => {
  it("merges a logged lift with the watch's strength workout for the same day", () => {
    const t = trainingDays([workout(1, "functionalStrengthTraining"), workout(2, "cycling"), workout(2, "cycling"), workout(3, "basketball"), workout(4, "walking")], [shiftDay(today, -1), shiftDay(today, -5)]);
    expect(t.lift.sort()).toEqual([shiftDay(today, -5), shiftDay(today, -1)]);
    expect([t.ride.length, t.ball.length, t.other.length]).toEqual([1, 1, 1]);
  });
});

describe("the headline numbers", () => {
  const days: DayView[] = [];
  for (let ago = 59; ago >= 0; ago--) {
    days.push(day(ago, { kcal_eaten: ago === 5 ? 800 : ago >= 30 ? 2300 : 2100, incomplete: ago === 5, steps: ago === 0 ? 300 : 9000, weight_lb: ago <= 6 ? 183 : ago >= 30 && ago <= 35 ? 185 : null, resting_hr: 55 }));
  }
  const all = kpis({ today, range: 30, fields: FIELDS, days, workouts: [workout(2, "cycling"), workout(40, "cycling"), workout(41, "cycling")], liftDays: [shiftDay(today, -3), shiftDay(today, -9)] });
  const kpi = (key: string) => all.find((k) => k.key === key)!;

  it("has a tile only for numbers that have data", () => {
    expect(all.map((k) => k.key)).toEqual(["kcal_eaten", "weight_lb", "steps", "resting_hr", "lift_days", "rides"]);
  });
  it("averages running totals per day, leaving out today and incomplete days, against the stretch before", () => {
    expect(kpi("kcal_eaten")).toMatchObject({ value: "2,100", note: "a day", delta: "−200", direction: "down" });
    expect(kpi("steps")).toMatchObject({ value: "9,000", delta: "no change", direction: "flat" });
  });
  it("takes weight as its seven-day average, against where it stood when the range began", () => {
    expect(kpi("weight_lb")).toMatchObject({ value: "183.0 lb", note: "7-day avg", delta: "−2.0 lb", direction: "down" });
  });
  it("counts lifting days and rides against the stretch before", () => {
    expect(kpi("lift_days")).toMatchObject({ value: "2", note: "in 30 days", delta: "+2", direction: "up" });
    expect(kpi("rides")).toMatchObject({ value: "1", delta: "−1", direction: "down" });
  });
  it("colours a change only where the better direction does not depend on his goals", () => {
    expect(kpi("lift_days").tone).toBe("good");
    expect(kpi("rides").tone).toBe("bad");
    expect(kpi("steps").tone).toBe("neutral"); // no change
    expect(kpi("kcal_eaten").tone).toBe("neutral");
    expect(kpi("weight_lb").tone).toBe("neutral");
  });
  it("colours weight by the way to his goal weight, once he has one", () => {
    const withGoal = (goalWeight: number) => kpis({ today, range: 30, fields: FIELDS, days, workouts: [], liftDays: [], goalWeight }).find((k) => k.key === "weight_lb")!;
    expect(withGoal(170).tone).toBe("good"); // down 2 lb, heading for 170
    expect(withGoal(195).tone).toBe("bad"); // down 2 lb, but the goal is to gain
  });
  it("gives each tile twelve points for its small line", () => {
    expect(kpi("kcal_eaten").spark).toHaveLength(12);
    expect(kpi("weight_lb").spark.filter((v) => v !== null).length).toBeGreaterThan(0);
  });
});
