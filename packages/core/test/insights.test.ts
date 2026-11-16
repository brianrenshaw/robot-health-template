import { describe, expect, it } from "vitest";
import { addDays, buildTrends, slopePerDay, type DayView, type Workout } from "../src";

const today = "2026-11-30";
const blank = { kcal_eaten: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, active_kcal: null, steps: null, resting_hr: null, vo2max: null, weight_lb: null, weight_source: null, incomplete: false, partial: false };
const day = (ago: number, more: Partial<DayView>): DayView => ({ date: addDays(today, -ago), ...blank, ...more, partial: ago === 0 });
const workout = (ago: number, activity_type: string): Workout => ({ id: ago, local_date: addDays(today, -ago), start_utc: "", end_utc: "", activity_type, duration_sec: null, distance_m: null, energy_kcal: null, indoor: null, temp_c: null, avg_hr: null, max_hr: null, source: "apple_health" });
const text = (trends: { key: string; text: string }[], key: string) => trends.find((t) => t.key === key)?.text;

// Sixty days: weight sliding half a pound a week; food a little lower in the recent thirty.
const days: DayView[] = [];
for (let ago = 59; ago >= 0; ago--) {
  days.push(day(ago, {
    weight_lb: ago % 2 === 0 ? 184 + (ago * 0.5) / 7 : null,
    kcal_eaten: ago === 12 ? 900 : ago >= 30 ? 2300 : 2100, incomplete: ago === 12,
    protein_g: 160, steps: ago >= 30 ? 7000 : 9000, resting_hr: ago >= 30 ? 58 : 55,
  }));
}

describe("the dashboard's trends", () => {
  const trends = buildTrends({
    today, range: 30, days,
    workouts: [workout(2, "cycling"), workout(5, "cycling"), workout(5, "basketball"), workout(9, "functionalStrengthTraining"), workout(40, "cycling")],
    liftDays: [addDays(today, -9), addDays(today, -6), addDays(today, -3), addDays(today, -45)],
    lifts: [
      { lift: "Leg Press", points: [{ date: addDays(today, -9), weight_lb: 270, reps: 8 }, { date: addDays(today, -3), weight_lb: 275, reps: 8 }] },
      { lift: "Row", points: [{ date: addDays(today, -9), weight_lb: 120, reps: 9 }, { date: addDays(today, -3), weight_lb: 120, reps: 10 }] },
      { lift: "Curl", points: [{ date: addDays(today, -9), weight_lb: 30, reps: 12 }, { date: addDays(today, -3), weight_lb: 30, reps: 12 }] },
      { lift: "Hack Squat", points: [{ date: addDays(today, -9), weight_lb: 180, reps: 6 }, { date: addDays(today, -3), weight_lb: 170, reps: 8 }] },
      { lift: "Old Lift", points: [{ date: addDays(today, -50), weight_lb: 50, reps: 8 }, { date: addDays(today, -45), weight_lb: 55, reps: 8 }] },
      { lift: "New Lift", points: [{ date: addDays(today, -3), weight_lb: 40, reps: 10 }] },
    ],
  });

  it("fits a line through the weigh-ins", () => {
    expect(slopePerDay([{ day: "2026-11-01", value: 185 }, { day: "2026-11-08", value: 184.5 }, { day: "2026-11-15", value: 184 }])).toBeCloseTo(-0.5 / 7);
    expect(text(trends, "weight")).toBe("Weight is down about 2.0 lb over the last 28 days, around 0.5 lb a week. Latest 184.0 lb.");
  });
  it("averages food over whole, trustworthy days only, and compares with the stretch before", () => {
    expect(text(trends, "calories")).toBe("Calories averaged 2,100 a day over the last 30 days (28 full days logged), down from 2,300 in the 30 days before.");
    expect(text(trends, "protein")).toBe("Protein averaged 160 g a day, 0.87 g per pound of body weight.");
    expect(text(trends, "logging")).toBe("Food was missing or only partly logged on 1 day of the last 30 days. Those days are left out of the averages.");
  });
  it("puts eating beside weight without judging either", () => {
    expect(text(trends, "energy")).toBe("On about 2,100 calories a day, weight moved down around 0.5 lb a week.");
    expect(trends.map((t) => t.text).join(" ")).not.toMatch(/good|bad|should|great/i);
  });
  it("compares steps and resting heart rate with the stretch before", () => {
    expect(text(trends, "steps")).toBe("Steps averaged 9,000 a day over the last 30 days, up from 7,000 a day.");
    expect(text(trends, "heart")).toBe("Resting heart rate averaged 55 bpm over the last 30 days, down from 58 bpm.");
  });
  it("counts training days, taking a lift from either the log or the watch", () => {
    expect(text(trends, "training")).toBe("In the last 30 days: 3 lifting days, 2 rides, 1 basketball.");
  });
  it("says which lifts moved since the time before", () => {
    expect(text(trends, "lifts")).toBe("Against the time before: 2 lifts went up (Leg Press +5 lb, Row +1 rep); 1 held; 1 came down (Hack Squat −10 lb).");
  });
  it("says nothing it cannot support", () => {
    expect(buildTrends({ today, range: 30, days: [], workouts: [], liftDays: [], lifts: [] })).toEqual([]);
    const thin = buildTrends({ today, range: 30, days: [day(1, { weight_lb: 184, kcal_eaten: 2000 })], workouts: [], liftDays: [], lifts: [] });
    expect(thin).toEqual([{ key: "weight", text: "Latest weight 184.0 lb. Too few weigh-ins in the last 30 days to call a trend." }]);
  });
});
