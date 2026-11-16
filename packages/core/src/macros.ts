// macros.ts
// Macro targets from his food app, and each day's food set against them. The owner's brief "Health
// Dashboard: Macro Targets and Tracking" (2026-11-16):
//
// - Each Monday after his food app's check-in he sends Claude a screenshot; set_macro_targets saves
//   it here (setMacroTargets). One row per check-in date; sending the same date again replaces it.
// - The targets for any date are the row with the latest effective_date on or before that date
//   (targetsOn). A day before the first check-in has no targets.
// - A day's food is set against the targets in effect that day: actual minus target for calories,
//   protein, carbs and fat, and fiber against its range (compareDay).
// - Weekly averages leave out today (it is partial) and incomplete food days, the rule every
//   other average follows (weekSummary).
//
// The tolerances that decide "on target" are here, in one place (MACRO_TOLERANCE). The page and
// the chatbot both get them from the server, so they always agree.

import { z } from "zod";
import { InputError, recordAudit, type Ctx } from "./audit";
import type { Db } from "./db";
import { addDays, dayString, todayInTz, type DayView } from "./health";

/** One check-in's targets: one row of `macro_targets`. */
export interface MacroTargets {
  id: string;
  effective_date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_min_g: number;
  fiber_max_g: number;
  source: string;
  trend_weight_lb: number | null;
  goal_rate_lb_per_week: number | null;
  note: string | null;
  /** The food app's goal and its weights: "fat loss", where he started, where he is headed. They carry forward. */
  goal: string | null;
  start_weight_lb: number | null;
  goal_weight_lb: number | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * How close counts as on target, as a share of the target (0.05 is within 5%). Fiber has its
 * own range on each check-in (30 to 40 g to start). Change these here and nowhere else.
 */
export const MACRO_TOLERANCE = { kcal: 0.05, protein_g: 0.1, carbs_g: 0.1, fat_g: 0.1 } as const;
export type MacroKey = keyof typeof MACRO_TOLERANCE;
export const MACRO_KEYS = Object.keys(MACRO_TOLERANCE) as MacroKey[];
/** A day's column for each target: calories eaten is `kcal_eaten`, the rest share their names. */
const ACTUAL: Record<MacroKey, "kcal_eaten" | "protein_g" | "carbs_g" | "fat_g"> = { kcal: "kcal_eaten", protein_g: "protein_g", carbs_g: "carbs_g", fat_g: "fat_g" };

export const FIBER_DEFAULT = { min: 30, max: 40 } as const;

// ---------- saving a check-in ----------

export const macroTargetsSchema = z.object({
  effective_date: dayString.optional().describe("The check-in date, YYYY-MM-DD (his local date). Default: today"),
  kcal: z.number().int().min(800).max(10000).describe("Daily calories, exactly as the check-in shows them"),
  protein_g: z.number().min(0).max(1000).describe("Daily protein in grams, as shown"),
  carbs_g: z.number().min(0).max(2000).describe("Daily carbs in grams, as shown"),
  fat_g: z.number().min(0).max(1000).describe("Daily fat in grams, as shown"),
  fiber_min_g: z.number().min(0).max(200).optional().describe("Bottom of the daily fiber range in grams. Leave out to keep the last one (30 to start)"),
  fiber_max_g: z.number().min(0).max(200).optional().describe("Top of the daily fiber range in grams. Leave out to keep the last one (40 to start)"),
  source: z.string().trim().min(1).max(60).optional().describe('Where the targets came from. Default: "food app". Name the app when it is clear, e.g. "Carbon Diet Coach" or "MacroFactor"'),
  trend_weight_lb: z.number().min(50).max(700).optional().describe("The trend weight on the check-in screen, in pounds, when it shows one"),
  goal_rate_lb_per_week: z.number().min(-5).max(5).optional().describe("The goal rate on the check-in screen, pounds a week, negative for losing (e.g. -1.5)"),
  note: z.string().trim().max(500).optional().describe("What the check-in said about the change, in its words or his (e.g. 'Macros unchanged, held steady')"),
  goal: z.string().trim().min(1).max(60).optional().describe("The food app's goal, in its words (e.g. 'fat loss'). Leave out to keep the last one"),
  start_weight_lb: z.number().min(50).max(700).optional().describe("The food app's start weight in pounds, when the screen shows it. Leave out to keep the last one"),
  goal_weight_lb: z.number().min(50).max(700).optional().describe("The food app's goal weight in pounds, when the screen shows it. Leave out to keep the last one"),
});

const id = () => crypto.randomUUID();

/**
 * Save a check-in's targets. One row per effective date: sending the same date again replaces
 * that row (a corrected check-in). The fiber range, the goal and its start and goal weights,
 * when left out, carry forward from the row before (fiber 30 to 40 g if there is none).
 */
export async function setMacroTargets(ctx: Ctx, input: unknown, now = new Date()): Promise<{ targets: MacroTargets; replaced: boolean }> {
  const data = macroTargetsSchema.parse(input);
  const today = todayInTz(now);
  const date = data.effective_date ?? today;
  if (date > addDays(today, 1)) throw new InputError(`${date} is in the future. Nothing was saved.`);
  const before = await ctx.db.first<MacroTargets>("SELECT * FROM macro_targets WHERE effective_date = ?", [date]);
  const earlier = before ?? (await ctx.db.first<MacroTargets>("SELECT * FROM macro_targets WHERE effective_date < ? ORDER BY effective_date DESC LIMIT 1", [date]));
  const fiberMin = data.fiber_min_g ?? earlier?.fiber_min_g ?? FIBER_DEFAULT.min;
  const fiberMax = data.fiber_max_g ?? earlier?.fiber_max_g ?? FIBER_DEFAULT.max;
  if (fiberMin > fiberMax) throw new InputError(`The fiber range ${fiberMin} to ${fiberMax} g runs backwards. Nothing was saved.`);
  const stamp = now.toISOString();
  const targets: MacroTargets = {
    id: before?.id ?? id(),
    effective_date: date,
    kcal: data.kcal,
    protein_g: data.protein_g,
    carbs_g: data.carbs_g,
    fat_g: data.fat_g,
    fiber_min_g: fiberMin,
    fiber_max_g: fiberMax,
    source: data.source ?? "food app",
    trend_weight_lb: data.trend_weight_lb ?? null,
    goal_rate_lb_per_week: data.goal_rate_lb_per_week ?? null,
    note: data.note || null,
    goal: data.goal ?? earlier?.goal ?? null,
    start_weight_lb: data.start_weight_lb ?? earlier?.start_weight_lb ?? null,
    goal_weight_lb: data.goal_weight_lb ?? earlier?.goal_weight_lb ?? null,
    created_at: before?.created_at ?? stamp,
    updated_at: before ? stamp : null,
  };
  const cols = Object.keys(targets) as (keyof MacroTargets)[];
  if (before) {
    const set = cols.filter((c) => c !== "id");
    await ctx.db.run(`UPDATE macro_targets SET ${set.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...set.map((c) => targets[c]), targets.id]);
  } else {
    await ctx.db.run(`INSERT INTO macro_targets (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => targets[c]));
  }
  await recordAudit(ctx, { table: "macro_targets", rowId: targets.id, before, after: targets });
  return { targets, replaced: !!before };
}

// ---------- reading ----------

/** Every check-in, oldest first. */
export async function allMacroTargets(db: Db): Promise<MacroTargets[]> {
  return db.all<MacroTargets>("SELECT * FROM macro_targets ORDER BY effective_date");
}

/**
 * The check-ins that matter for a stretch, oldest first: the one in effect on `from` (if any)
 * and every one made after it up to `to`.
 */
export async function macroTargetHistory(db: Db, from?: string, to?: string): Promise<MacroTargets[]> {
  const rows = await allMacroTargets(db);
  return rows.filter((r, i) => (!to || r.effective_date <= to) && (!from || r.effective_date >= from || (rows[i + 1]?.effective_date ?? "9999") > from));
}

/** The targets in effect on a date: the latest check-in on or before it. Null before the first one. */
export function targetsOn(rows: MacroTargets[], date: string): MacroTargets | null {
  let found: MacroTargets | null = null;
  for (const r of rows) if (r.effective_date <= date && (!found || r.effective_date > found.effective_date)) found = r;
  return found;
}

// ---------- a day against its targets ----------

export type FiberStatus = "under" | "in range" | "over";

export interface TargetSet {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_min_g: number;
  fiber_max_g: number;
}

export interface DayVsTarget {
  date: string;
  /** What he ate. A number Apple Health had nothing for is null, never zero. */
  actual: { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null };
  targets: TargetSet;
  /** The check-in these targets came from. */
  targets_from: string;
  /** Actual minus target, for what was logged. */
  vs_target: Partial<Record<MacroKey, number>>;
  /** Whether each logged number is within its tolerance (MACRO_TOLERANCE). */
  on_target: Partial<Record<MacroKey, boolean>>;
  fiber_status: FiberStatus | null;
  /** Today: the totals are still growing. */
  partial: boolean;
  /** Doubtful food numbers (under 1,500 kcal logged, or the food app carried the day before forward). */
  incomplete: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pick = (t: MacroTargets): TargetSet => ({ kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, fiber_min_g: t.fiber_min_g, fiber_max_g: t.fiber_max_g });

export function fiberStatus(fiber: number | null, t: Pick<TargetSet, "fiber_min_g" | "fiber_max_g">): FiberStatus | null {
  if (fiber === null) return null;
  return fiber < t.fiber_min_g ? "under" : fiber > t.fiber_max_g ? "over" : "in range";
}

/** Whether a number is within its tolerance of the target. */
export const withinTolerance = (key: MacroKey, actual: number, target: number) => Math.abs(actual - target) <= target * MACRO_TOLERANCE[key] + 1e-9;

/** One day set against the targets in effect that day. Null when no targets were in effect. */
export function compareDay(day: DayView, rows: MacroTargets[]): DayVsTarget | null {
  const t = targetsOn(rows, day.date);
  if (!t) return null;
  const actual = { kcal: day.kcal_eaten, protein_g: day.protein_g, carbs_g: day.carbs_g, fat_g: day.fat_g, fiber_g: day.fiber_g };
  const vs_target: DayVsTarget["vs_target"] = {};
  const on_target: DayVsTarget["on_target"] = {};
  for (const k of MACRO_KEYS) {
    const a = day[ACTUAL[k]];
    if (a === null) continue;
    vs_target[k] = k === "kcal" ? Math.round(a - t[k]) : round1(a - t[k]);
    on_target[k] = withinTolerance(k, a, t[k]);
  }
  return {
    date: day.date, actual, targets: pick(t), targets_from: t.effective_date, vs_target, on_target,
    fiber_status: fiberStatus(day.fiber_g, t), partial: day.partial, incomplete: day.incomplete,
  };
}

export interface WeekSummary {
  /** Monday. */
  week_start: string;
  week_end: string;
  /** The days whose food counts: logged, not today, not incomplete. */
  days_counted: number;
  /** The average a day of what he ate, over the days counted. A number never logged is left out. */
  average: Partial<Record<MacroKey | "fiber_g", number>>;
  /** The average of the targets in effect on those days (they can change mid-week). */
  average_target: Partial<TargetSet>;
  /** Average minus average target. */
  vs_target: Partial<Record<MacroKey, number>>;
  on_target: Partial<Record<MacroKey, boolean>>;
  fiber_status: FiberStatus | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The Monday of a date's week. */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Average intake against average target for each week (Monday to Sunday) that has counted days,
 * oldest first. Today (partial) and incomplete food days are left out, as in every average.
 */
export function weekSummaries(days: DayView[], rows: MacroTargets[]): WeekSummary[] {
  const compared = days.map((d) => compareDay(d, rows)).filter((c): c is DayVsTarget => !!c && !c.partial && !c.incomplete);
  const byWeek = new Map<string, DayVsTarget[]>();
  for (const c of compared) {
    if (Object.values(c.actual).every((v) => v === null)) continue;
    byWeek.set(mondayOf(c.date), [...(byWeek.get(mondayOf(c.date)) ?? []), c]);
  }
  return [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([monday, list]) => {
    const average: WeekSummary["average"] = {};
    const average_target: WeekSummary["average_target"] = {};
    const vs_target: WeekSummary["vs_target"] = {};
    const on_target: WeekSummary["on_target"] = {};
    for (const k of MACRO_KEYS) {
      const logged = list.filter((c) => c.actual[k] !== null);
      if (!logged.length) continue;
      const a = mean(logged.map((c) => c.actual[k]!));
      const t = mean(logged.map((c) => c.targets[k]));
      average[k] = k === "kcal" ? Math.round(a) : round1(a);
      average_target[k] = k === "kcal" ? Math.round(t) : round1(t);
      vs_target[k] = k === "kcal" ? Math.round(a - t) : round1(a - t);
      on_target[k] = withinTolerance(k, a, t);
    }
    const fiberDays = list.filter((c) => c.actual.fiber_g !== null);
    let fiber_status: FiberStatus | null = null;
    if (fiberDays.length) {
      average.fiber_g = round1(mean(fiberDays.map((c) => c.actual.fiber_g!)));
      average_target.fiber_min_g = round1(mean(fiberDays.map((c) => c.targets.fiber_min_g)));
      average_target.fiber_max_g = round1(mean(fiberDays.map((c) => c.targets.fiber_max_g)));
      fiber_status = fiberStatus(average.fiber_g, { fiber_min_g: average_target.fiber_min_g, fiber_max_g: average_target.fiber_max_g });
    }
    return { week_start: monday, week_end: addDays(monday, 6), days_counted: list.length, average, average_target, vs_target, on_target, fiber_status };
  });
}

/**
 * What the dashboard and the coach need about food and targets, worked out once: the targets
 * now, every check-in, today and the days of this week against their targets, and this week's
 * and last week's averages.
 */
export interface MacroView {
  today: string;
  current: MacroTargets | null;
  history: MacroTargets[];
  tolerance: typeof MACRO_TOLERANCE;
  /** Monday of this week to today, oldest first; a day with nothing logged is still listed. */
  this_week: (DayVsTarget | { date: string; none: true; targets: TargetSet | null; partial: boolean })[];
  week_average: WeekSummary | null;
  last_week_average: WeekSummary | null;
  /** The newest date with fiber saved: null means fiber has never come through from Apple Health. */
  fiber_latest: string | null;
}

export async function macroView(db: Db, days: DayView[], today: string): Promise<MacroView> {
  const history = await allMacroTargets(db);
  const monday = mondayOf(today);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const this_week: MacroView["this_week"] = [];
  for (let d = monday; d <= today; d = addDays(d, 1)) {
    const day = byDate.get(d);
    const compared = day ? compareDay(day, history) : null;
    const t = targetsOn(history, d);
    this_week.push(compared ?? { date: d, none: true, targets: t ? pick(t) : null, partial: d === today });
  }
  const weeks = weekSummaries(days.filter((d) => d.date >= addDays(monday, -7) && d.date <= today), history);
  const fiber = days.filter((d) => d.fiber_g !== null).map((d) => d.date).sort().at(-1) ?? null;
  return {
    today,
    current: targetsOn(history, today),
    history,
    tolerance: MACRO_TOLERANCE,
    this_week,
    week_average: weeks.find((w) => w.week_start === monday) ?? null,
    last_week_average: weeks.find((w) => w.week_start === addDays(monday, -7)) ?? null,
    fiber_latest: fiber,
  };
}
