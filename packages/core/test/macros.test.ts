// Macro targets from his food app, and food against them (the macro targets brief, 2026-11-16).
import { describe, expect, it } from "vitest";
import {
  compareDay, listDays, macroTargetHistory, macroView, saveHealth, setMacroTargets, targetsOn, undoLast, weekSummaries,
  type Ctx, type DayView, type MacroTargets,
} from "../src";
import { memoryDb } from "./helpers";

const now = new Date("2026-11-18T20:00:00Z"); // Wednesday afternoon, Nov 18, in New York
const ctx = (): Ctx => ({ db: memoryDb().db, actor: "mcp:claude", op: crypto.randomUUID() });
const again = (c: Ctx): Ctx => ({ ...c, op: crypto.randomUUID() });

/** The Nov 16 check-in, as the brief gives it. */
const nov16 = { effective_date: "2026-11-16", kcal: 2350, protein_g: 180, carbs_g: 240, fat_g: 75, trend_weight_lb: 185.1, goal_rate_lb_per_week: -1.5, note: "Macros unchanged, held steady." };

const day = (date: string, food: Partial<Pick<DayView, "kcal_eaten" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g">>, extra: Partial<DayView> = {}): DayView => ({
  date, incomplete: false, partial: false, weight_lb: null, weight_source: null,
  kcal_eaten: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, active_kcal: null, steps: null, resting_hr: null, vo2max: null,
  ...food, ...extra,
});
const row = (date: string, values: Partial<MacroTargets>): MacroTargets => ({
  id: date, effective_date: date, kcal: 3000, protein_g: 200, carbs_g: 300, fat_g: 100, fiber_min_g: 30, fiber_max_g: 40,
  source: "MacroFactor", trend_weight_lb: null, goal_rate_lb_per_week: null, note: null, goal: null, start_weight_lb: null, goal_weight_lb: null, created_at: "", updated_at: null, ...values,
});

describe("saving a check-in", () => {
  it("saves the numbers as given, with fiber at 30 to 40 g to start and 'food app' as the source", async () => {
    const c = ctx();
    const { targets, replaced } = await setMacroTargets(c, nov16, now);
    expect(replaced).toBe(false);
    expect(targets).toMatchObject({ ...nov16, fiber_min_g: 30, fiber_max_g: 40, source: "food app" });
  });

  it("defaults the date to today", async () => {
    const { targets } = await setMacroTargets(ctx(), { kcal: 3000, protein_g: 200, carbs_g: 300, fat_g: 100 }, now);
    expect(targets.effective_date).toBe("2026-11-18");
  });

  it("replaces a check-in sent again for the same date, keeping one row", async () => {
    const c = ctx();
    const first = await setMacroTargets(c, nov16, now);
    const second = await setMacroTargets(again(c), { ...nov16, kcal: 3185, note: undefined }, now);
    expect(second.replaced).toBe(true);
    expect(second.targets.id).toBe(first.targets.id);
    expect(second.targets).toMatchObject({ kcal: 3185, note: null });
    expect(await macroTargetHistory(c.db)).toHaveLength(1);
  });

  it("carries the fiber range forward from the check-in before when it is left out", async () => {
    const c = ctx();
    await setMacroTargets(c, { ...nov16, effective_date: "2026-11-09", fiber_min_g: 32, fiber_max_g: 45 }, now);
    const { targets } = await setMacroTargets(again(c), nov16, now);
    expect(targets).toMatchObject({ fiber_min_g: 32, fiber_max_g: 45 });
  });

  it("carries the goal and its weights forward when a later check-in leaves them out", async () => {
    const c = ctx();
    await setMacroTargets(c, { ...nov16, effective_date: "2026-11-09", goal: "fat loss", start_weight_lb: 192.4, goal_weight_lb: 175 }, now);
    const { targets } = await setMacroTargets(again(c), nov16, now);
    expect(targets).toMatchObject({ goal: "fat loss", start_weight_lb: 192.4, goal_weight_lb: 175 });
    const changed = await setMacroTargets(again(c), { ...nov16, goal_weight_lb: 170 }, now);
    expect(changed.targets).toMatchObject({ goal: "fat loss", start_weight_lb: 192.4, goal_weight_lb: 170 });
  });

  it("refuses a future date and a backwards fiber range", async () => {
    await expect(setMacroTargets(ctx(), { ...nov16, effective_date: "2026-11-25" }, now)).rejects.toThrow(/future/);
    await expect(setMacroTargets(ctx(), { ...nov16, fiber_min_g: 40, fiber_max_g: 30 }, now)).rejects.toThrow(/backwards/);
  });

  it("can be undone: a new check-in is removed, a replaced one goes back", async () => {
    const c = ctx();
    await setMacroTargets(c, nov16, now);
    await setMacroTargets(again(c), { ...nov16, kcal: 3185 }, now);
    expect((await undoLast(c))?.what).toBe("1 set of macro targets");
    expect((await macroTargetHistory(c.db))[0]!.kcal).toBe(2350);
    await undoLast(c);
    expect(await macroTargetHistory(c.db)).toEqual([]);
  });
});

describe("which targets apply on a date", () => {
  const rows = [row("2026-11-09", { kcal: 3400 }), row("2026-11-16", { kcal: 2350 })];
  it("is the latest check-in on or before that date", () => {
    expect(targetsOn(rows, "2026-11-08")).toBeNull();
    expect(targetsOn(rows, "2026-11-09")!.kcal).toBe(3400);
    expect(targetsOn(rows, "2026-11-15")!.kcal).toBe(3400);
    expect(targetsOn(rows, "2026-11-16")!.kcal).toBe(2350);
    expect(targetsOn(rows, "2027-01-01")!.kcal).toBe(2350);
  });
  it("a range's history starts with the check-in in effect at its start", async () => {
    const c = ctx();
    for (const date of ["2026-11-02", "2026-11-09", "2026-11-16"]) await setMacroTargets(again(c), { ...nov16, effective_date: date }, now);
    expect((await macroTargetHistory(c.db, "2026-11-12", "2026-11-18")).map((r) => r.effective_date)).toEqual(["2026-11-09", "2026-11-16"]);
    expect((await macroTargetHistory(c.db, "2026-11-09")).map((r) => r.effective_date)).toEqual(["2026-11-09", "2026-11-16"]);
  });
});

describe("a day against its targets", () => {
  const rows = [row("2026-11-16", { kcal: 2350, protein_g: 180, carbs_g: 240, fat_g: 75 })];
  it("gives actual minus target, whether each is within tolerance, and where fiber falls", () => {
    const c = compareDay(day("2026-11-17", { kcal_eaten: 2250, protein_g: 192, carbs_g: 189, fat_g: 75, fiber_g: 28.5 }), rows)!;
    expect(c.vs_target).toEqual({ kcal: -100, protein_g: 12, carbs_g: -51, fat_g: 0 });
    // Calories within 5% (117.5 kcal), the rest within 10%.
    expect(c.on_target).toEqual({ kcal: true, protein_g: true, carbs_g: false, fat_g: true });
    expect(c.fiber_status).toBe("under");
    expect(c.targets_from).toBe("2026-11-16");
  });
  it("leaves out what was not logged, rather than counting it as zero", () => {
    const c = compareDay(day("2026-11-17", { kcal_eaten: 2365 }), rows)!;
    expect(c.vs_target).toEqual({ kcal: 15 });
    expect(c.fiber_status).toBeNull();
  });
  it("has nothing to say before the first check-in", () => {
    expect(compareDay(day("2026-11-15", { kcal_eaten: 3000 }), rows)).toBeNull();
  });
  it("calls fiber in range at both ends and over above the top", () => {
    expect(compareDay(day("2026-11-17", { fiber_g: 30 }), rows)!.fiber_status).toBe("in range");
    expect(compareDay(day("2026-11-17", { fiber_g: 40 }), rows)!.fiber_status).toBe("in range");
    expect(compareDay(day("2026-11-17", { fiber_g: 40.1 }), rows)!.fiber_status).toBe("over");
  });
});

describe("weekly averages", () => {
  const rows = [row("2026-11-09", { kcal: 3400 }), row("2026-11-18", { kcal: 3200 })];
  it("averages the counted days against the targets in effect on each, leaving out today and incomplete days", () => {
    const weeks = weekSummaries([
      day("2026-11-16", { kcal_eaten: 3300, fiber_g: 35 }),
      day("2026-11-17", { kcal_eaten: 3500, fiber_g: 25 }),
      day("2026-11-18", { kcal_eaten: 3100 }), // a new target from today
      day("2026-11-19", { kcal_eaten: 1200 }, { incomplete: true }),
      day("2026-11-20", { kcal_eaten: 900 }, { partial: true }),
    ], rows);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({
      week_start: "2026-11-16", days_counted: 3,
      average: { kcal: 3300, fiber_g: 30 },
      average_target: { kcal: 3333, fiber_min_g: 30, fiber_max_g: 40 },
      vs_target: { kcal: -33 },
      on_target: { kcal: true },
      fiber_status: "in range",
    });
  });
  it("splits by Monday-to-Sunday week and skips a week with nothing logged", () => {
    const weeks = weekSummaries([day("2026-11-15", { kcal_eaten: 3400 }), day("2026-11-16", { kcal_eaten: 3400 })], rows);
    expect(weeks.map((w) => w.week_start)).toEqual(["2026-11-09", "2026-11-16"]);
  });
});

describe("what the dashboard gets", () => {
  it("lists this week from Monday, with today in progress and a day with nothing logged marked", async () => {
    const c = ctx();
    await setMacroTargets(c, nov16, now);
    await saveHealth(again(c), {
      statistics: [
        { type: "dietaryEnergyConsumed", rows: [{ period_start: "2026-11-16T05:00:00Z", sum: 2390, unit: "kcal" }, { period_start: "2026-11-18T05:00:00Z", sum: 900, unit: "kcal" }] },
      ],
      entered_days: [{ date: "2026-11-16", fiber_g: 33.04 }, { date: "2026-11-18", fiber_g: 9 }],
    }, now);
    const view = await macroView(c.db, await listDays(c.db, "2026-11-09", "2026-11-18", now), "2026-11-18");
    expect(view.current?.kcal).toBe(2350);
    expect(view.this_week.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(view.this_week[0]).toMatchObject({ actual: { kcal: 2390, fiber_g: 33 }, on_target: { kcal: true }, fiber_status: "in range" });
    expect(view.this_week[1]).toMatchObject({ none: true, targets: { kcal: 2350 } });
    expect(view.this_week[2]).toMatchObject({ partial: true });
    expect(view.week_average).toMatchObject({ days_counted: 1, average: { kcal: 2390 } });
    expect(view.last_week_average).toBeNull();
    expect(view.fiber_latest).toBe("2026-11-18");
  });
});
