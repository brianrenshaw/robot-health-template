import { describe, expect, it } from "vitest";
import type { DayView, MacroTargets } from "@health/core";
import { INSTRUCTIONS, dayBrief, liftReceipt, planReceipt, saveReceipt, targetsReceipt, workoutBrief } from "../src/tools";

const nothing = { days: [], weighins: [], kept: [], workouts_added: 0, workouts_updated: 0, cleared: [] as string[], entered: [] as string[] };

describe("the one-line receipt after saving", () => {
  it("names the span and what was saved", () => {
    expect(saveReceipt({ ...nothing, days: ["2026-11-13", "2026-11-14", "2026-11-15"], weighins: ["2026-11-13", "2026-11-15"], workouts_added: 1, workouts_updated: 3 }))
      .toBe("Saved Nov 13 to Nov 15: daily numbers for 3 days, 2 weigh-ins, 4 workouts (1 new).");
  });
  it("reads naturally for a single texted weight", () => {
    expect(saveReceipt({ ...nothing, weighins: ["2026-11-15"] })).toBe("Saved Nov 15: 1 weigh-in.");
  });
  it("says what was cleared because Apple Health no longer has it", () => {
    expect(saveReceipt({ ...nothing, days: ["2026-11-15"], cleared: ["2026-11-15: kcal_eaten", "2026-11-15: protein_g"] }))
      .toBe("Saved Nov 15: daily numbers for 1 day. Cleared 2 numbers Apple Health no longer has (Nov 15).");
  });
  it("tells the chatbot to send the range it pulled", () => {
    expect(INSTRUCTIONS).toMatch(/plus `from` and `to`/);
  });
  it("names fiber entered from a food-app screenshot", () => {
    expect(saveReceipt({ ...nothing, entered: ["2026-11-16: 32.5"] })).toBe("Saved Nov 16: fiber 32.5 g.");
    expect(saveReceipt({ ...nothing, entered: ["2026-11-14: 30", "2026-11-15: 28.4"] })).toBe("Saved Nov 14 to Nov 15: fiber for 2 days.");
  });
  it("says so when Apple Health's weight was kept", () => {
    expect(saveReceipt({ ...nothing, kept: ["2026-11-14: kept the Apple Health weight of 183.4 lb"] }))
      .toBe("Nothing new to save. Apple Health already had a weight for Nov 14, so that one was kept.");
  });
});

describe("the standing instructions follow the spec", () => {
  it("ask for the sum of cumulative types and the average of discrete ones", () => {
    expect(INSTRUCTIONS).toContain("the sum of: dietaryEnergyConsumed, dietaryProtein, dietaryCarbohydrates, dietaryFatTotal, activeEnergyBurned, stepCount");
    expect(INSTRUCTIONS).toContain("the average of: bodyMass, restingHeartRate, vo2Max");
  });
  it("tell the chatbot to hand data over untouched and never count today in averages", () => {
    expect(INSTRUCTIONS).toMatch(/do not convert kilograms to pounds/);
    expect(INSTRUCTIONS).toMatch(/never count today in an average/);
    expect(INSTRUCTIONS).toMatch(/only comes through a chat app on his iPhone that can read Apple Health/);
  });
});

describe("the receipt after logging a lift", () => {
  const base = { session: "Full Body #1", date: "2026-11-16", sets_saved: 3, finished: false, not_logged_yet: ["Leg Press", "Cable Crunch"], est_minutes_left: 22, next: null };
  it("says what is still to do, and about how long it will take", () => {
    expect(liftReceipt(base)).toBe("Logged 3 sets for Full Body #1. Still to do (about 22 min): Leg Press; Cable Crunch.");
  });
  it("names the next session when he finishes", () => {
    expect(liftReceipt({ ...base, sets_saved: 0, finished: true, not_logged_yet: [], next: "Full Body #2 (week 1)" })).toBe("Finished Full Body #1. Next up: Full Body #2 (week 1).");
  });
});

describe("the coach's standing instructions", () => {
  it("make sessions take turns, use the server's suggestion, and never invent what a source says", () => {
    expect(INSTRUCTIONS).toMatch(/sessions take turns/);
    expect(INSTRUCTIONS).toMatch(/Use the suggestion as given; do not work out your own/);
    expect(INSTRUCTIONS).toMatch(/Never invent what a source says/);
    expect(INSTRUCTIONS).toMatch(/Never tell him he is behind/);
  });
  it("keep every session owed unless he says otherwise, and never guess the weather", () => {
    expect(INSTRUCTIONS).toMatch(/he wants EVERY session done unless he explicitly says/);
    expect(INSTRUCTIONS).toMatch(/never suggest skipping/);
    expect(INSTRUCTIONS).toMatch(/do NOT send finished/);
    expect(INSTRUCTIONS).toMatch(/never guess the weather/);
    expect(INSTRUCTIONS).toMatch(/New York, NY/);
  });
});

describe("American units", () => {
  it("hands workouts over in minutes, miles and °F", () => {
    const w = { id: 1, local_date: "2026-11-12", start_utc: "2026-11-12T11:13:34Z", end_utc: "2026-11-12T12:12:44Z", activity_type: "cycling", duration_sec: 3550.39, distance_m: 24140.16, energy_kcal: 582.37, indoor: 0 as const, temp_c: 8.11, avg_hr: 122.98, max_hr: 166, source: "apple_health" };
    expect(workoutBrief(w)).toMatchObject({ duration_min: 59, distance_mi: 15, temp_f: 47, energy_kcal: 582, avg_hr: 123 });
    expect(workoutBrief(w)).not.toHaveProperty("distance_m");
  });
  it("tells the chatbot never to speak in kilograms", () => {
    expect(INSTRUCTIONS).toMatch(/Never kilograms/);
    expect(INSTRUCTIONS).toMatch(/bodyMass, in the kilograms Apple Health returns/);
  });
});

describe("the week plan's receipt", () => {
  it("says each day, its time and what falls on it", () => {
    const plan = [
      { date: "2026-11-16", when: "morning" as const, activity: "lift" as const, detail: null, session: "Full Body #1" },
      { date: "2026-11-17", when: "afternoon" as const, activity: "hike" as const, detail: "Riverside Park", session: null },
      { date: "2026-11-21", when: "anytime" as const, activity: "bike" as const, detail: null, session: null },
    ];
    expect(planReceipt({ week_start: "2026-11-16", plan, bike_days: null, note: null })).toBe("Week of Nov 16: Mon morning lift (Full Body #1), Tue afternoon hike (Riverside Park), Sat ride.");
    expect(planReceipt({ week_start: "2026-11-16", plan: [], bike_days: 0, note: "bike not here yet" })).toBe('Week of Nov 16: no bike days; note: "bike not here yet".');
  });
});

describe("macro targets", () => {
  const t: MacroTargets = {
    id: "x", effective_date: "2026-11-16", kcal: 2350, protein_g: 180, carbs_g: 240, fat_g: 75, fiber_min_g: 30, fiber_max_g: 40,
    source: "MacroFactor", trend_weight_lb: 185.1, goal_rate_lb_per_week: -1.5, note: "Macros unchanged, held steady.", goal: null, start_weight_lb: null, goal_weight_lb: null, created_at: "", updated_at: null,
  };
  it("answer a check-in with one line", () => {
    expect(targetsReceipt(t, false)).toBe("Targets from Nov 16 (MacroFactor): 2,350 kcal, 180 g protein, 240 g carbs, 75 g fat, fiber 30 to 40 g. Trend weight 185.1 lb, goal -1.5 lb a week.");
    expect(targetsReceipt({ ...t, goal: "fat loss", start_weight_lb: 192.4, goal_weight_lb: 175 }, false)).toMatch(/goal -1.5 lb a week, goal weight 175 lb \(from 192.4\)\.$/);
    expect(targetsReceipt({ ...t, trend_weight_lb: null, goal_rate_lb_per_week: null }, true)).toBe("Replaced the targets from Nov 16 (MacroFactor): 2,350 kcal, 180 g protein, 240 g carbs, 75 g fat, fiber 30 to 40 g.");
  });
  const day = (date: string, food: Partial<DayView>): DayView => ({
    date, incomplete: false, partial: false, weight_lb: null, weight_source: null,
    kcal_eaten: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, active_kcal: null, steps: null, resting_hr: null, vo2max: null, ...food,
  });
  it("set each day with food against the targets in effect that day", () => {
    expect(dayBrief(day("2026-11-17", { kcal_eaten: 2365, fiber_g: 41 }), [t])).toMatchObject({
      kcal_eaten: 2365, targets: { kcal: 2350, fiber_min_g: 30, fiber_max_g: 40 }, vs_target: { kcal: 15 }, on_target: { kcal: true }, fiber_status: "over",
    });
    expect(dayBrief(day("2026-11-17", { steps: 9000 }), [t])).not.toHaveProperty("targets");
    expect(dayBrief(day("2026-11-15", { kcal_eaten: 3300 }), [t])).not.toHaveProperty("targets");
  });
  it("tell any chat app that the record is the shared memory, and that only Claude on his iPhone can sync", () => {
    expect(INSTRUCTIONS).toMatch(/more than one chat app with this same record/);
    expect(INSTRUCTIONS).toMatch(/If you have no Apple Health tool/);
  });
  it("tell the chatbot to backfill fiber in a separate save, and to copy check-ins exactly", () => {
    expect(INSTRUCTIONS).toMatch(/FIBER does not come through Apple Health/);
    expect(INSTRUCTIONS).toMatch(/update my fiber tracking/);
    expect(INSTRUCTIONS).toMatch(/skip a row cut off at the edge of the screen/);
    expect(INSTRUCTIONS).not.toMatch(/the sum of: [^\n]*dietaryFiber/);
    expect(INSTRUCTIONS).toMatch(/Never recompute calories from the macros/);
  });
});
