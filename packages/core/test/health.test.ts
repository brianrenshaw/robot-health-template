// Tests for the Apple Health data spec (2026-11-15). The example rows are the spec's own.
import { describe, expect, it } from "vitest";
import { DATA_TYPES, latestDate, listAudit, listDays, listWorkouts, localDay, saveHealth, todayInTz, undoLast, type Ctx } from "../src";
import { memoryDb } from "./helpers";

const now = new Date("2026-11-15T20:00:00Z"); // Sunday afternoon, Nov 15, in New York
function ctx(): Ctx & { raw: ReturnType<typeof memoryDb>["raw"] } {
  const { db, raw } = memoryDb();
  return { db, actor: "mcp:claude", raw };
}
/** A statistics row for a local date, the way Apple Health returns it (spec section 3). */
const row = (date: string, stats: Record<string, number>, unit = "kcal") => ({
  period_start: `${date}T05:00:00Z`,
  period_end: `${date}T05:00:00Z`,
  ...stats,
  unit,
});
const kcal = (date: string, sum: number) => row(date, { sum, average: sum, min: sum, max: sum });
const day = async (c: Ctx, date: string) => (await listDays(c.db, date, date, now))[0];

/** Spec section 4, verbatim. */
const basketball = {
  start: "2026-11-12T11:13:34Z",
  end: "2026-11-12T12:12:44Z",
  value: {
    workout: {
      activity_type: "basketball",
      duration: 3550.39,
      total_distance: 1747.76,
      total_energy_burned: 582.37,
      indoor: false,
      weather: { temperature_celsius: 8.11 },
      statistics: [{ sample_type: "heartRate", unit: "count/min", average: 122.98, min: 100, max: 166 }],
    },
  },
};

describe("spec section 2: the data types", () => {
  it("uses sum for cumulative types and average for discrete ones", () => {
    const stat = Object.fromEntries(DATA_TYPES.map((t) => [t.identifier, t.stat]));
    expect(stat).toEqual({
      dietaryEnergyConsumed: "sum", dietaryProtein: "sum", dietaryCarbohydrates: "sum", dietaryFatTotal: "sum", dietaryFiber: "sum",
      activeEnergyBurned: "sum", stepCount: "sum", bodyMass: "average", restingHeartRate: "average", vo2Max: "average",
    });
  });
  it("puts each type in its column", async () => {
    const c = ctx();
    await saveHealth(c, {
      statistics: [
        { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-13", 2150.4)] },
        { type: "dietaryProtein", rows: [row("2026-11-13", { sum: 164.26 }, "g")] },
        { type: "dietaryCarbohydrates", rows: [row("2026-11-13", { sum: 201.04 }, "g")] },
        { type: "dietaryFatTotal", rows: [row("2026-11-13", { sum: 72.449 }, "g")] },
        { type: "dietaryFiber", rows: [row("2026-11-13", { sum: 31.26 }, "g")] },
        { type: "activeEnergyBurned", rows: [kcal("2026-11-13", 612.7)] },
        { type: "stepCount", rows: [row("2026-11-13", { sum: 9120.0000001 }, "count")] },
        { type: "bodyMass", rows: [row("2026-11-13", { average: 83.2 }, "kg")] },
        { type: "restingHeartRate", rows: [row("2026-11-13", { average: 54.333333 }, "count/min")] },
        { type: "vo2Max", rows: [row("2026-11-13", { average: 41.26 }, "mL/min·kg")] },
      ],
    }, now);
    expect(await day(c, "2026-11-13")).toEqual({
      date: "2026-11-13", incomplete: false, partial: false,
      kcal_eaten: 2150, protein_g: 164.3, carbs_g: 201, fat_g: 72.4, fiber_g: 31.3, active_kcal: 613, steps: 9120,
      resting_hr: 54.3, vo2max: 41.3, weight_lb: 183.4, weight_source: "apple_health",
    });
  });
});

describe("spec section 3: statistics rows", () => {
  it("stores the local date, not the UTC timestamp, in winter and in summer", () => {
    expect(localDay("2026-11-14T05:00:00Z")).toBe("2026-11-14"); // EST
    expect(localDay("2026-07-04T04:00:00Z")).toBe("2026-07-04"); // EDT
  });
  it("refuses buckets that were not cut at his midnight", async () => {
    const c = ctx();
    await expect(saveHealth(c, { statistics: [{ type: "stepCount", rows: [{ period_start: "2026-11-14T00:00:00Z", sum: 1 }] }] }, now)).rejects.toThrow(/not midnight/);
  });
  it("rounds on write: kcal and steps to whole numbers, grams to 0.1, weight to 0.1 lb", async () => {
    const c = ctx();
    await saveHealth(c, {
      statistics: [
        { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 870.0789999999995)] }, // the spec's example row
        { type: "dietaryProtein", rows: [row("2026-11-14", { sum: 99.96000000001 }, "g")] },
        { type: "bodyMass", rows: [row("2026-11-14", { average: 83.31999999 }, "kg")] },
      ],
    }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: 870, protein_g: 100, weight_lb: 183.7 });
  });
  it("takes a discrete type that carries only the stat asked for", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "restingHeartRate", rows: [{ period_start: "2026-11-14T05:00:00Z", average: 55, unit: "count/min" }] }] }, now);
    expect((await day(c, "2026-11-14"))!.resting_hr).toBe(55);
  });
  it("says which stat to ask for when the wrong one came back", async () => {
    const c = ctx();
    await expect(saveHealth(c, { statistics: [{ type: "stepCount", rows: [{ period_start: "2026-11-14T05:00:00Z", average: 400 }] }] }, now)).rejects.toThrow(/no `sum`/);
  });
  it("a missing day or an empty array is NULL, never 0", async () => {
    const c = ctx();
    await saveHealth(c, {
      statistics: [
        { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-12", 2000), kcal("2026-11-14", 2100)] },
        { type: "stepCount", rows: [] },
      ],
    }, now);
    expect(await day(c, "2026-11-13")).toBeUndefined();
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: 2100, steps: null, protein_g: null, weight_lb: null });
  });
  it("clears a number Apple Health no longer has for a day the pull covered (bent 2026-11-16)", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [
      { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-13", 2000), kcal("2026-11-14", 2100), kcal("2026-11-15", 680)] },
      { type: "stepCount", rows: [row("2026-11-15", { sum: 7000 })] },
    ] }, now);
    // He deleted all of today's food in Apple Health and Nov 13's too: the next pull sends nothing for them.
    const r = await saveHealth(c, { from: "2026-11-13", to: "2026-11-15", statistics: [
      { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] },
      { type: "stepCount", rows: [row("2026-11-15", { sum: 7246 })] },
    ] }, now);
    expect(r.cleared).toEqual(["2026-11-13: kcal_eaten", "2026-11-15: kcal_eaten"]);
    expect(await day(c, "2026-11-15")).toMatchObject({ kcal_eaten: null, steps: 7246, incomplete: false });
    expect(await day(c, "2026-11-13")).toMatchObject({ kcal_eaten: null });
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: 2100 });
  });
  it("an empty type with a range clears that type only; a type not sent is left alone", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [
      { type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] },
      { type: "stepCount", rows: [row("2026-11-14", { sum: 8000 })] },
    ] }, now);
    await saveHealth(c, { from: "2026-11-14", to: "2026-11-15", statistics: [{ type: "dietaryEnergyConsumed", rows: [] }] }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: null, steps: 8000 });
  });
  it("without a range, only days inside the rows sent are cleared, never days outside them", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 2000), kcal("2026-11-12", 2000), kcal("2026-11-14", 2100)] }] }, now);
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-12", 1900), kcal("2026-11-14", 2100)] }] }, now);
    expect(await day(c, "2026-11-10")).toMatchObject({ kcal_eaten: 2000 });
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 2000), kcal("2026-11-14", 2100)] }] }, now);
    expect(await day(c, "2026-11-12")).toMatchObject({ kcal_eaten: null });
  });
  it("a clearing can be undone with the rest of its pull", async () => {
    const c = { ...ctx(), op: "a" };
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] }] }, now);
    await saveHealth({ ...c, op: "b" }, { from: "2026-11-14", to: "2026-11-14", statistics: [{ type: "dietaryEnergyConsumed", rows: [] }] }, now);
    await undoLast({ ...c, op: "c" });
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: 2100 });
  });
  it("refuses a range given by half, or backwards", async () => {
    const c = ctx();
    await expect(saveHealth(c, { from: "2026-11-14", statistics: [] }, now)).rejects.toThrow(/both/);
    await expect(saveHealth(c, { from: "2026-11-15", to: "2026-11-14", statistics: [] }, now)).rejects.toThrow(/after/);
  });
  it("a later pull of one type leaves the day's other numbers alone", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] }, { type: "stepCount", rows: [row("2026-11-14", { sum: 8000 })] }] }, now);
    await saveHealth(c, { statistics: [{ type: "stepCount", rows: [row("2026-11-14", { sum: 9500 })] }] }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ kcal_eaten: 2100, steps: 9500 });
  });
});

describe("spec rule 3: today is partial", () => {
  it("upserts today's row on every pull and marks it partial", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100), kcal("2026-11-15", 600)] }] }, now);
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-15", 1900)] }] }, now);
    const days = await listDays(c.db, "2026-11-14", "2026-11-15", now);
    expect(days.map((d) => [d.date, d.kcal_eaten, d.partial])).toEqual([["2026-11-14", 2100, false], ["2026-11-15", 1900, true]]);
    expect(todayInTz(now)).toBe("2026-11-15");
  });
});

describe("spec rule 5: the incomplete flag", () => {
  it("flags a day under 1,500 kcal", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 1499), kcal("2026-11-11", 1500)] }] }, now);
    expect((await day(c, "2026-11-10"))!.incomplete).toBe(true);
    expect((await day(c, "2026-11-11"))!.incomplete).toBe(false);
  });
  it("flags a day whose kcal is identical to the day before (food app forward-fill)", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 2180), kcal("2026-11-11", 2180), kcal("2026-11-12", 2181)] }] }, now);
    expect((await listDays(c.db, "2026-11-10", "2026-11-12", now)).map((d) => d.incomplete)).toEqual([false, true, false]);
  });
  it("re-checks the next day when a day changes, and clears the flag when a re-pull fixes it", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 2000), kcal("2026-11-11", 2180)] }] }, now);
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-10", 2180)] }] }, now); // now equals the 11th
    expect((await day(c, "2026-11-11"))!.incomplete).toBe(true);
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-11", 2240)] }] }, now);
    expect((await day(c, "2026-11-11"))!.incomplete).toBe(false);
  });
  it("does not flag a day that has no calories at all", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "stepCount", rows: [row("2026-11-10", { sum: 5000 })] }] }, now);
    expect((await day(c, "2026-11-10"))!.incomplete).toBe(false);
  });
});

describe("spec section 5: weigh-ins", () => {
  it("converts bodyMass from kg to lb (rule 4)", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "bodyMass", rows: [row("2026-11-14", { average: 100 }, "kg")] }] }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ weight_lb: 220.5, weight_source: "apple_health" });
  });
  it("saves a texted weight, and Apple Health wins when a date has both", async () => {
    const c = ctx();
    const first = await saveHealth(c, { texted_weighins: [{ date: "2026-11-14", lb: 184.25 }] }, now);
    expect(first.weighins).toEqual(["2026-11-14"]);
    expect(await day(c, "2026-11-14")).toMatchObject({ weight_lb: 184.3, weight_source: "texted" });

    await saveHealth(c, { statistics: [{ type: "bodyMass", rows: [row("2026-11-14", { average: 83.2 }, "kg")] }] }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ weight_lb: 183.4, weight_source: "apple_health" });

    const later = await saveHealth(c, { texted_weighins: [{ date: "2026-11-14", lb: 190 }] }, now);
    expect(later.kept).toEqual(["2026-11-14: kept the Apple Health weight of 183.4 lb"]);
    expect(await day(c, "2026-11-14")).toMatchObject({ weight_lb: 183.4, weight_source: "apple_health" });
  });
  it("refuses a texted weight far from the last weigh-in, such as kilograms sent as pounds", async () => {
    const c = ctx();
    await saveHealth(c, { texted_weighins: [{ date: "2026-11-12", lb: 182.6 }] }, now);
    await expect(saveHealth(c, { texted_weighins: [{ date: "2026-11-14", lb: 82.8 }] }, now)).rejects.toThrow(/far from his last weigh-in \(182.6 lb\).*send 182.5 lb instead/);
    expect(await day(c, "2026-11-14")).toBeUndefined();
    // An ordinary change is fine, and so is the first weight ever.
    await saveHealth(c, { texted_weighins: [{ date: "2026-11-14", lb: 181.9 }] }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ weight_lb: 181.9 });
  });
  it("removes an Apple Health weigh-in Apple Health no longer has for a day the pull covered, and undo puts it back", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "bodyMass", rows: [row("2026-11-13", { average: 82.8 }, "kg"), row("2026-11-14", { average: 82.7 }, "kg")] }] }, now);
    await saveHealth(c, { texted_weighins: [{ date: "2026-11-12", lb: 182.4 }] }, now);
    const pull = { ...c, op: "second-pull" };
    const r = await saveHealth(pull, { from: "2026-11-12", to: "2026-11-15", statistics: [{ type: "bodyMass", rows: [row("2026-11-14", { average: 82.7 }, "kg")] }] }, now);
    expect(r.cleared).toEqual(["2026-11-13: weight"]);
    expect(await day(c, "2026-11-13")).toBeUndefined();
    expect(await day(c, "2026-11-12")).toMatchObject({ weight_lb: 182.4, weight_source: "texted" }); // texted: never removed by a pull
    await undoLast(pull);
    expect(await day(c, "2026-11-13")).toMatchObject({ weight_lb: 182.5, weight_source: "apple_health" });
  });
  it("a day with only a weigh-in still shows up, and counts as the latest date", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "stepCount", rows: [row("2026-11-12", { sum: 5000 })] }], texted_weighins: [{ date: "2026-11-14", lb: 184 }] }, now);
    expect((await listDays(c.db, "2026-11-01", "2026-11-30", now)).map((d) => d.date)).toEqual(["2026-11-12", "2026-11-14"]);
    expect(await latestDate(c.db)).toBe("2026-11-14");
  });
});

describe("fiber, entered from food-app screenshots (Apple Health does not carry it)", () => {
  it("saves each day as given, rounded to 0.1 g, and says what was entered", async () => {
    const c = ctx();
    const r = await saveHealth(c, { entered_days: [{ date: "2026-11-14", fiber_g: 31.26 }, { date: "2026-11-15", fiber_g: 12 }] }, now);
    expect(r.entered).toEqual(["2026-11-14: 31.3", "2026-11-15: 12"]);
    expect(r.days).toEqual([]);
    expect(await day(c, "2026-11-14")).toMatchObject({ fiber_g: 31.3, kcal_eaten: null });
    // Saving a day again replaces it.
    await saveHealth(c, { entered_days: [{ date: "2026-11-15", fiber_g: 27.5 }] }, now);
    expect(await day(c, "2026-11-15")).toMatchObject({ fiber_g: 27.5 });
  });
  it("is never cleared by an Apple Health pull, even one that lists fiber as empty", async () => {
    const c = ctx();
    await saveHealth(c, { entered_days: [{ date: "2026-11-14", fiber_g: 33 }] }, now);
    await saveHealth(c, {
      from: "2026-11-13", to: "2026-11-15",
      statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] }, { type: "dietaryFiber", rows: [] }],
    }, now);
    expect(await day(c, "2026-11-14")).toMatchObject({ fiber_g: 33, kcal_eaten: 2100 });
  });
  it("refuses the same day twice in one save", async () => {
    await expect(saveHealth(ctx(), { entered_days: [{ date: "2026-11-14", fiber_g: 30 }, { date: "2026-11-14", fiber_g: 31 }] }, now)).rejects.toThrow(/listed twice/);
  });
});

describe("spec section 4: workouts", () => {
  it("stores the spec's example workout in its units, with the local date and heart rate", async () => {
    const c = ctx();
    const r = await saveHealth(c, { workouts: [basketball] }, now);
    expect(r).toMatchObject({ workouts_added: 1, workouts_updated: 0 });
    expect(await listWorkouts(c.db, "2026-11-12", "2026-11-12")).toEqual([{
      id: 1, local_date: "2026-11-12", start_utc: "2026-11-12T11:13:34Z", end_utc: "2026-11-12T12:12:44Z", activity_type: "basketball",
      duration_sec: 3550.39, distance_m: 1747.76, energy_kcal: 582.37, indoor: 0, temp_c: 8.11, avg_hr: 122.98, max_hr: 166, source: "apple_health",
    }]);
    expect(c.raw.prepare("SELECT * FROM workout_stats").all().map((s) => ({ ...s }))).toEqual([
      { workout_id: 1, sample_type: "heartRate", unit: "count/min", sum: null, average: 122.98, min: 100, max: 166 },
    ]);
  });
  it("any field can be missing, and missing is NULL", async () => {
    const c = ctx();
    await saveHealth(c, { workouts: [{ start: "2026-11-08T15:00:00Z", end: "2026-11-08T15:40:00Z", value: { workout: { activity_type: "basketball", duration: 2400 } } }] }, now);
    expect((await listWorkouts(c.db, "2026-11-08", "2026-11-08"))[0]).toMatchObject({ distance_m: null, energy_kcal: null, indoor: null, temp_c: null, avg_hr: null, max_hr: null });
  });
  it("a re-pull does not duplicate (rule 6): same start and activity_type is the same workout", async () => {
    const c = ctx();
    await saveHealth(c, { workouts: [basketball] }, now);
    const again = await saveHealth(c, { workouts: [basketball, { ...basketball, value: { workout: { ...basketball.value.workout, activity_type: "cycling" } } }] }, now);
    expect(again).toMatchObject({ workouts_added: 1, workouts_updated: 1 });
    expect((await listWorkouts(c.db, "2026-11-12", "2026-11-12")).map((w) => w.activity_type)).toEqual(["basketball", "cycling"]);
  });
  it("uses the local date of the start, even late in the evening", async () => {
    const c = ctx();
    await saveHealth(c, { workouts: [{ start: "2026-11-13T02:30:00Z", end: "2026-11-13T03:10:00Z", value: { workout: { activity_type: "walking" } } }] }, now);
    expect((await listWorkouts(c.db, "2026-11-12", "2026-11-12"))[0]!.local_date).toBe("2026-11-12"); // 9:30 PM on the 12th
  });
});

describe("saving as a whole", () => {
  it("saves nothing when anything in the call is wrong", async () => {
    const c = ctx();
    await expect(saveHealth(c, {
      statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] }, { type: "stepCount", rows: [row("2026-11-14", { sum: 9e9 })] }],
      workouts: [basketball],
    }, now)).rejects.toThrow(/slip/);
    await expect(saveHealth(c, { statistics: [{ type: "stepCount", rows: [row("2026-12-25", { sum: 1 })] }] }, now)).rejects.toThrow(/future/);
    await expect(saveHealth(c, { statistics: [{ type: "sleepAnalysis", rows: [] }] }, now)).rejects.toThrow();
    expect(await listDays(c.db, "2000-01-01", "2100-01-01", now)).toEqual([]);
    expect(await listWorkouts(c.db, "2000-01-01", "2100-01-01")).toEqual([]);
    expect(await listAudit(c.db)).toEqual([]);
  });
  it("records who changed what", async () => {
    const c = ctx();
    await saveHealth(c, { statistics: [{ type: "dietaryEnergyConsumed", rows: [kcal("2026-11-14", 2100)] }], texted_weighins: [{ date: "2026-11-14", lb: 184 }], workouts: [basketball] }, now);
    expect((await listAudit(c.db)).map((r) => [r.actor, r.table_name, r.action]).sort()).toEqual([
      ["mcp:claude", "daily_metrics", "create"], ["mcp:claude", "weighins", "create"], ["mcp:claude", "workouts", "create"],
    ]);
  });
});
