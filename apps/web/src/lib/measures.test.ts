import { describe, expect, it } from "vitest";
import { FIELDS, type DayView } from "@health/core";
import { activityName, average, dayLabel, daysBetween, duration, measures, miles, workoutFacts } from "./measures";

const blank = { kcal_eaten: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, active_kcal: null, steps: null, resting_hr: null, vo2max: null, weight_lb: null, weight_source: null, incomplete: false, partial: false };
const day = (date: string, numbers: Partial<DayView>): DayView => ({ date, ...blank, ...numbers });

const today = "2026-11-15";
const days = [
  day("2026-11-12", { kcal_eaten: 2000, weight_lb: 184.2, steps: 7000 }),
  day("2026-11-13", { kcal_eaten: 1100, protein_g: 60, incomplete: true, steps: 8000 }),
  day("2026-11-14", { kcal_eaten: 2200, steps: 9120, resting_hr: 54.3 }),
  day("2026-11-15", { kcal_eaten: 600, steps: 2100, weight_lb: 183.6, partial: true }),
];

describe("the rows of numbers", () => {
  const rows = measures(FIELDS, days);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it("has a row only for numbers that have been saved, in the page's order", () => {
    expect(rows.map((r) => r.key)).toEqual(["kcal_eaten", "protein_g", "weight_lb", "steps", "resting_hr"]);
  });
  it("leaves today out of running totals, but keeps today's readings", () => {
    expect(row("steps").points.map((p) => p.day)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(row("steps").set_aside).toEqual([{ day: "2026-11-15", value: 2100, why: "so far" }]);
    expect(row("weight_lb").points.at(-1)).toEqual({ day: "2026-11-15", value: 183.6 });
  });
  it("leaves an incomplete day's food out, but not its steps", () => {
    expect(row("kcal_eaten").points.map((p) => p.day)).toEqual(["2026-11-12", "2026-11-14"]);
    expect(row("kcal_eaten").set_aside).toEqual([
      { day: "2026-11-13", value: 1100, why: "incomplete" },
      { day: "2026-11-15", value: 600, why: "so far" },
    ]);
    expect(row("protein_g").points).toEqual([]); // its only day is incomplete; the row still exists
  });
  it("writes each number the way it is said", () => {
    expect(row("kcal_eaten").format(2150)).toBe("2,150");
    expect(row("weight_lb").format(183.6)).toBe("183.6 lb");
    expect(row("resting_hr").format(54.3)).toBe("54 bpm");
  });
  it("averages only the days that count", () => {
    expect(average(row("kcal_eaten").points, today, 7)).toBeCloseTo((2000 + 2200) / 2);
    expect(average(row("kcal_eaten").points, "2026-11-10", 7)).toBeNull();
  });
  it("names days the way he would", () => {
    expect(dayLabel("2026-11-15", today)).toBe("today");
    expect(dayLabel("2026-11-14", today)).toBe("yesterday");
    expect(dayLabel("2026-11-12", today)).toBe("Nov 12");
    expect(daysBetween("2026-10-17", "2026-11-15")).toBe(29);
  });
});

describe("workouts", () => {
  it("names activities plainly", () => {
    expect(activityName("cycling")).toBe("Bike ride");
    expect(activityName("functionalStrengthTraining")).toBe("Strength");
    expect(activityName("basketball")).toBe("Basketball");
    expect(activityName("highIntensityIntervalTraining")).toBe("High intensity interval training");
  });
  it("converts Apple Health's seconds and meters for reading", () => {
    expect(duration(3550.39)).toBe("59 min");
    expect(duration(4320)).toBe("1 h 12 min");
    expect(duration(3600)).toBe("1 h");
    expect(miles(1747.76)).toBe("1.1 mi");
    expect(workoutFacts({ duration_sec: 3550.39, distance_m: 1747.76 })).toBe("59 min · 1.1 mi");
    expect(workoutFacts({ duration_sec: 2400, distance_m: null })).toBe("40 min");
  });
});
