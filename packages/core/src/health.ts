// health.ts
// The owner's Apple Health data spec (2026-11-15), carried out. The spec says what the Claude phone
// app's Apple Health tool returns and how to store it; the tables are in migration 0004 exactly
// as the spec gives them. This file is "the MCP" the spec's rules are addressed to.
//
// The chatbot hands over what Apple Health returned, as returned. Everything else happens here,
// so the chatbot does no arithmetic:
//
//   Spec rule 1  Convert UTC period starts to the local date before writing.   -> localDay
//   Spec rule 2  Empty or missing values are NULL. Never write 0 for "no data". -> only what is sent is written
//                Bent on 2026-11-16 at the owner's word ("it's ok if it bends the rule"): a number
//                saved earlier that Apple Health no longer returns for a day the pull covered is
//                cleared back to NULL, so deleting something in Apple Health deletes it here.  -> clearing, in saveHealth
//   Spec rule 3  Today is partial. Upsert today's row on every pull, and don't
//                count it in averages.                                           -> `partial` on a day; the page and chatbot leave it out
//   Spec rule 4  Convert bodyMass from kg to lb.                                 -> LB_PER_KG
//   Spec rule 5  Flag `incomplete` when kcal is under 1,500, or when kcal is
//                identical to the day before (food app forward-fill).              -> flagIncomplete
//   Spec rule 6  Dedupe workouts on start_utc plus activity_type.                -> saveHealth, workouts
//   Spec rule 7  Health data only comes through on a turn sent from the Claude
//                phone app, so scheduled runs can't refresh the database.        -> said in the chatbot's instructions
//
//   Rounding (spec section 3): kcal and steps to whole numbers, grams to 0.1, weight to 0.1 lb.
//   Stat to use (spec section 2): cumulative types use `sum`, discrete types use `average`.
//   Weigh-ins (spec section 5): two sources, 'apple_health' and 'texted'; Apple Health wins.

import { z } from "zod";
import { InputError, recordAudit, type Ctx } from "./audit";
import type { Db } from "./db";

/** the owner's days are New York days. */
export const TIMEZONE = "America/New_York";
export const LB_PER_KG = 2.20462;
/** Spec rule 5: a day with fewer calories logged than this is flagged incomplete. */
export const INCOMPLETE_BELOW_KCAL = 1500;
/**
 * A weight he texts that is further than this (a share) from his last weigh-in is refused as a
 * slip. Added 2026-11-16, after the first syncs saved Apple Health's kilograms as pounds for
 * months of weigh-ins: kilograms read as pounds are less than half the right number.
 */
export const WEIGHT_JUMP = 0.25;

/**
 * Spec section 2: the data types pulled from Apple Health. `column` is where each lands
 * (bodyMass lands in `weighins`, the rest in `daily_metrics`). `min` and `max` only catch a slip.
 */
export const DATA_TYPES = [
  { identifier: "dietaryEnergyConsumed", column: "kcal_eaten", stat: "sum", round: 0, min: 0, max: 20000 },
  { identifier: "dietaryProtein", column: "protein_g", stat: "sum", round: 1, min: 0, max: 1000 },
  { identifier: "dietaryCarbohydrates", column: "carbs_g", stat: "sum", round: 1, min: 0, max: 3000 },
  { identifier: "dietaryFatTotal", column: "fat_g", stat: "sum", round: 1, min: 0, max: 1500 },
  // Added 2026-11-16 (the macro targets brief): fiber, tracked against a 30 to 40 g range. Many food
  // apps do not send fiber to Apple Health, so he enters it from food-app screenshots (ENTERED_TYPES).
  { identifier: "dietaryFiber", column: "fiber_g", stat: "sum", round: 1, min: 0, max: 300 },
  { identifier: "activeEnergyBurned", column: "active_kcal", stat: "sum", round: 0, min: 0, max: 20000 },
  { identifier: "stepCount", column: "steps", stat: "sum", round: 0, min: 0, max: 200000 },
  { identifier: "bodyMass", column: "lb", stat: "average", round: 1, min: 50, max: 700 },
  { identifier: "restingHeartRate", column: "resting_hr", stat: "average", round: 1, min: 20, max: 220 },
  { identifier: "vo2Max", column: "vo2max", stat: "average", round: 1, min: 5, max: 100 },
] as const;

export type Identifier = (typeof DATA_TYPES)[number]["identifier"];

/**
 * Types Apple Health does not carry for him: he gives them himself, from a screenshot of his food app
 * ("update my fiber tracking"), in `entered_days`. A sync does not ask Apple Health for them and
 * never clears them, so a pull cannot wipe what he entered. (The owner, 2026-11-16: "apparently fiber
 * can't be sent through Apple Health".)
 */
export const ENTERED_TYPES: readonly Identifier[] = ["dietaryFiber"];
/** The types a sync asks Apple Health for. */
export const PULLED_TYPES = DATA_TYPES.filter((t) => !ENTERED_TYPES.includes(t.identifier));
const IDENTIFIERS = DATA_TYPES.map((t) => t.identifier) as [Identifier, ...Identifier[]];
export type MetricColumn = Exclude<(typeof DATA_TYPES)[number]["column"], "lb">;
export const METRIC_COLUMNS = DATA_TYPES.map((t) => t.column).filter((c): c is MetricColumn => c !== "lb");

/** One row of `daily_metrics`. */
export type DailyMetrics = { date: string; incomplete: 0 | 1; pulled_at: string | null } & Record<MetricColumn, number | null>;
/** One row of `weighins`. */
export interface Weighin {
  date: string;
  lb: number;
  source: "apple_health" | "texted";
  pulled_at: string | null;
}
/** One row of `workouts`. */
export interface Workout {
  id: number;
  local_date: string;
  start_utc: string;
  end_utc: string;
  activity_type: string;
  duration_sec: number | null;
  distance_m: number | null;
  energy_kcal: number | null;
  indoor: 0 | 1 | null;
  temp_c: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  source: string;
}

/** A day as the page and the chatbot see it: its metrics and its weigh-in together. */
export type DayView = { date: string; incomplete: boolean; partial: boolean; weight_lb: number | null; weight_source: Weighin["source"] | null } & Record<
  MetricColumn,
  number | null
>;

/** The rows the page shows, in order, and how each reads. */
export interface FieldInfo {
  key: MetricColumn | "weight_lb";
  label: string;
  unit: string;
  group: "food" | "body" | "activity" | "heart";
  /** A "total" adds up over the day, so today's is unfinished. A "reading" is a measurement. */
  kind: "total" | "reading";
  decimals: number;
}
export const FIELDS: FieldInfo[] = [
  { key: "kcal_eaten", label: "Calories", unit: "", group: "food", kind: "total", decimals: 0 },
  { key: "protein_g", label: "Protein", unit: "g", group: "food", kind: "total", decimals: 0 },
  { key: "carbs_g", label: "Carbs", unit: "g", group: "food", kind: "total", decimals: 0 },
  { key: "fat_g", label: "Fat", unit: "g", group: "food", kind: "total", decimals: 0 },
  { key: "fiber_g", label: "Fiber", unit: "g", group: "food", kind: "total", decimals: 0 },
  { key: "weight_lb", label: "Weight", unit: "lb", group: "body", kind: "reading", decimals: 1 },
  { key: "steps", label: "Steps", unit: "", group: "activity", kind: "total", decimals: 0 },
  { key: "active_kcal", label: "Active calories", unit: "", group: "activity", kind: "total", decimals: 0 },
  { key: "resting_hr", label: "Resting heart rate", unit: "bpm", group: "heart", kind: "reading", decimals: 0 },
  { key: "vo2max", label: "VO2 max", unit: "", group: "heart", kind: "reading", decimals: 1 },
];

// ---------- what the chatbot sends: Apple Health's own shapes ----------

export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written YYYY-MM-DD")
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "That is not a real date");

const num = z.number().nullish();
/** Spec section 3: one statistics row (one day's bucket). Extra fields are ignored. */
const statRow = z.looseObject({ period_start: z.string(), sum: num, average: num, unit: z.string().nullish() });

/** Spec section 4: one workout sample. Extra fields are ignored. */
const workoutSample = z.looseObject({
  start: z.string(),
  end: z.string(),
  value: z.looseObject({
    workout: z.looseObject({
      activity_type: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,59}$/, "Send Apple Health's own name for the activity, e.g. cycling"),
      duration: num,
      total_distance: num,
      total_energy_burned: num,
      indoor: z.boolean().nullish(),
      weather: z.looseObject({ temperature_celsius: num }).nullish(),
      statistics: z.array(z.looseObject({ sample_type: z.string().min(1).max(80), unit: z.string().nullish(), sum: num, average: num, min: num, max: num })).nullish(),
    }),
  }),
  source: z.enum(["apple_health", "garmin_confirmed"]).optional(),
});

export const healthSaveSchema = z.object({
  statistics: z
    .array(
      z.object({
        type: z.enum(IDENTIFIERS).describe("The Apple Health data type these rows are for"),
        rows: z.array(statRow).max(400).describe("The `statistics` array Apple Health returned for this type with one bucket per day, copied as returned. An empty array is fine"),
      }),
    )
    .optional()
    .describe("Daily statistics from Apple Health, one entry per data type. Ask for `sum` on dietaryEnergyConsumed, dietaryProtein, dietaryCarbohydrates, dietaryFatTotal, activeEnergyBurned and stepCount; ask for `average` on bodyMass, restingHeartRate and vo2Max"),
  from: dayString.optional().describe("The first day you asked Apple Health for, YYYY-MM-DD (his local date). Send it with `to` on every pull"),
  to: dayString.optional().describe("The last day you asked Apple Health for, YYYY-MM-DD, normally today. With `from`, a number saved earlier for a day in that range that Apple Health no longer returns (he deleted it there) is cleared"),
  workouts: z.array(workoutSample).max(200).optional().describe("Workout samples from Apple Health (workoutType), each copied as returned: { start, end, value: { workout: { ... } } }"),
  texted_weighins: z
    .array(z.object({ date: dayString.describe("The day he weighed in, YYYY-MM-DD, his local time"), lb: z.number().min(50).max(700).describe("His weight in pounds, as he said it") }))
    .optional()
    .describe("Weights the owner told you himself instead of Apple Health ('I weighed 182.4 this morning')"),
  entered_days: z
    .array(
      z.object({
        date: dayString.describe("The day, YYYY-MM-DD, his local date"),
        fiber_g: z.number().min(0).max(300).describe("That day's fiber in grams, exactly as his food app shows it"),
      }),
    )
    .max(60)
    .optional()
    .describe("Numbers Apple Health does not carry, from a screenshot of his food app or his own words: fiber. One entry per day shown. Saving a day again replaces it. Not cleared by an Apple Health pull"),
});

// ---------- dates ----------

/** A date in the owner's time zone, YYYY-MM-DD. With no argument, today. */
export function todayInTz(now = new Date(), timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Spec rule 1. The owner's local date for the start of an Apple Health daily bucket. Local midnight
 * in New York is T05:00:00Z in EST and T04:00:00Z in EDT. A period_start that is not his local
 * midnight means the buckets were cut on some other day boundary, and is refused.
 */
export function localDay(periodStart: string, timeZone = TIMEZONE): string {
  const at = new Date(periodStart);
  if (Number.isNaN(at.getTime())) throw new InputError(`"${periodStart}" is not a time. Nothing was saved.`);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (clock !== "00:00") {
    throw new InputError(`period_start ${periodStart} is ${clock} in New York, not midnight. Ask Apple Health for one bucket per day and send the rows as returned. Nothing was saved.`);
  }
  return todayInTz(at, timeZone);
}

/** A date some days before or after another. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const roundTo = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
/** 2026-11-12T11:13:34Z: one spelling for a moment, so the same workout always matches itself. */
function utc(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new InputError(`"${s}" is not a time. Nothing was saved.`);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

// ---------- writing ----------

export interface SaveResult {
  /** The dates whose daily metrics were written. */
  days: string[];
  /** The dates whose weigh-in was written. */
  weighins: string[];
  /** Texted weights that were not saved because Apple Health already has that day. */
  kept: string[];
  workouts_added: number;
  workouts_updated: number;
  /** Numbers cleared because Apple Health no longer has them, as "2026-11-15: kcal_eaten". */
  cleared: string[];
  /** Fiber he entered (from a food-app screenshot), as "2026-11-16: 32.5". */
  entered: string[];
}

/**
 * Save what the chatbot read from Apple Health (and any weight the owner texted). Everything is
 * checked first; if anything is wrong, nothing is saved.
 */
export async function saveHealth(ctx: Ctx, input: unknown, now = new Date()): Promise<SaveResult> {
  const data = healthSaveSchema.parse(input);
  const today = todayInTz(now);
  const checkDate = (date: string) => {
    if (date > addDays(today, 1)) throw new InputError(`${date} is in the future. Nothing was saved.`);
    if (date < "2000-01-01") throw new InputError(`${date} is too long ago to be right. Nothing was saved.`);
    return date;
  };

  // 1. Work out every value before touching the database.
  const metrics = new Map<string, Map<MetricColumn, number>>();
  const appleWeights = new Map<string, number>();
  const seenTypes = new Set<string>();
  for (const group of data.statistics ?? []) {
    if (seenTypes.has(group.type)) throw new InputError(`${group.type} is listed twice. Nothing was saved.`);
    seenTypes.add(group.type);
    const type = DATA_TYPES.find((t) => t.identifier === group.type)!;
    const dates = new Set<string>();
    for (const row of group.rows) {
      const date = checkDate(localDay(row.period_start)); // spec rule 1
      if (dates.has(date)) throw new InputError(`${group.type} has two rows for ${date}. Nothing was saved.`);
      dates.add(date);
      let value = row[type.stat];
      if (value === null || value === undefined) {
        throw new InputError(`${group.type} for ${date} has no \`${type.stat}\`. Ask Apple Health for the ${type.stat} of ${group.type}. Nothing was saved.`);
      }
      if (type.identifier === "bodyMass") {
        const unit = (row.unit ?? "kg").toLowerCase();
        if (unit === "kg") value = value * LB_PER_KG; // spec rule 4
        else if (unit !== "lb" && unit !== "lbs") throw new InputError(`bodyMass came in "${row.unit}", which is neither kg nor lb. Nothing was saved.`);
      }
      value = roundTo(value, type.round);
      if (value < type.min || value > type.max) {
        throw new InputError(`${group.type} for ${date} is ${value}, which looks like a slip. Nothing was saved.`);
      }
      if (type.column === "lb") appleWeights.set(date, value);
      else metrics.set(date, (metrics.get(date) ?? new Map()).set(type.column, value));
    }
  }

  // What Apple Health no longer has. For each daily type sent, the days the pull covered are
  // `from` to `to` when given, else the first to the last row of that type. A number already
  // saved for a covered day that did not come back this time was deleted in Apple Health, and is
  // cleared. Weights too (The owner, 2026-11-16: "It should match my apple health data"): an Apple
  // Health weigh-in for a covered day that Apple Health no longer has is removed. A weight he
  // texted is never removed by a pull; it was never in Apple Health.
  if ((data.from === undefined) !== (data.to === undefined)) throw new InputError("Send both `from` and `to`, or neither. Nothing was saved.");
  if (data.from && data.to && data.from > data.to) throw new InputError(`\`from\` (${data.from}) is after \`to\` (${data.to}). Nothing was saved.`);
  if (data.to) checkDate(data.to);
  const clears = new Map<string, Set<MetricColumn>>();
  const removeWeights: string[] = [];
  for (const group of data.statistics ?? []) {
    const type = DATA_TYPES.find((t) => t.identifier === group.type)!;
    if (ENTERED_TYPES.includes(type.identifier)) continue; // entered by him: a pull never clears it
    if (type.column === "lb") {
      const sent = new Set(group.rows.map((r) => localDay(r.period_start)));
      const range = data.from && data.to ? [data.from, data.to] : sent.size ? [[...sent].sort()[0]!, [...sent].sort().at(-1)!] : null;
      if (!range) continue;
      const saved = await ctx.db.all<{ date: string }>("SELECT date FROM weighins WHERE date >= ? AND date <= ? AND source = 'apple_health'", range);
      for (const { date } of saved) if (!sent.has(date)) removeWeights.push(date);
      continue;
    }
    const column = type.column;
    const sent = new Set(group.rows.map((r) => localDay(r.period_start)));
    const range = data.from && data.to ? [data.from, data.to] : sent.size ? [[...sent].sort()[0]!, [...sent].sort().at(-1)!] : null;
    if (!range) continue;
    const saved = await ctx.db.all<{ date: string }>(`SELECT date FROM daily_metrics WHERE date >= ? AND date <= ? AND ${column} IS NOT NULL`, range);
    for (const { date } of saved) if (!sent.has(date)) clears.set(date, (clears.get(date) ?? new Set()).add(column));
  }

  const texted = new Map<string, number>();
  for (const w of data.texted_weighins ?? []) {
    checkDate(w.date);
    if (texted.has(w.date)) throw new InputError(`Two texted weights for ${w.date}. Nothing was saved.`);
    const lb = roundTo(w.lb, 1);
    const last =
      [...appleWeights].filter(([d]) => d < w.date).sort(([a], [b]) => (a < b ? 1 : -1))[0]?.[1] ??
      (await ctx.db.first<{ lb: number }>("SELECT lb FROM weighins WHERE date < ? ORDER BY date DESC LIMIT 1", [w.date]))?.lb;
    if (last && Math.abs(lb - last) / last > WEIGHT_JUMP) {
      throw new InputError(
        `${lb} lb for ${w.date} is far from his last weigh-in (${last} lb). If that number is in kilograms, send ${roundTo(lb * LB_PER_KG, 1)} lb instead; if it is right, check with him. Nothing was saved.`,
      );
    }
    texted.set(w.date, lb);
  }

  // What he entered himself (fiber from a food-app screenshot). It is written with the day's other
  // numbers, but counted apart, so the receipt can say it.
  const entered = new Map<string, number>();
  for (const e of data.entered_days ?? []) {
    checkDate(e.date);
    if (entered.has(e.date)) throw new InputError(`Fiber for ${e.date} is listed twice. Nothing was saved.`);
    if (metrics.get(e.date)?.has("fiber_g")) throw new InputError(`Fiber for ${e.date} came both from Apple Health and from his entry. Send it once. Nothing was saved.`);
    entered.set(e.date, roundTo(e.fiber_g, 1));
  }
  const statDates = new Set(metrics.keys());
  for (const [date, g] of entered) metrics.set(date, (metrics.get(date) ?? new Map()).set("fiber_g", g));

  const workouts = (data.workouts ?? []).map((s) => {
    const w = s.value.workout;
    const start_utc = utc(s.start);
    const heart = (w.statistics ?? []).find((x) => x.sample_type === "heartRate");
    return {
      local_date: checkDate(todayInTz(new Date(start_utc))),
      start_utc,
      end_utc: utc(s.end),
      activity_type: w.activity_type,
      duration_sec: w.duration ?? null,
      distance_m: w.total_distance ?? null,
      energy_kcal: w.total_energy_burned ?? null,
      indoor: w.indoor === null || w.indoor === undefined ? null : w.indoor ? 1 : 0,
      temp_c: w.weather?.temperature_celsius ?? null,
      avg_hr: heart?.average ?? null,
      max_hr: heart?.max ?? null,
      source: s.source ?? "apple_health",
      stats: w.statistics ?? [],
    };
  });
  const keys = workouts.map((w) => `${w.start_utc} ${w.activity_type}`);
  if (new Set(keys).size !== keys.length) throw new InputError("The same workout is listed twice. Nothing was saved.");

  // 2. Write.
  const stamp = now.toISOString();
  const result: SaveResult = { days: [], weighins: [], kept: [], workouts_added: 0, workouts_updated: 0, cleared: [], entered: [] };

  // Daily metrics: only the columns that were sent are written (spec rule 2).
  const befores = new Map<string, DailyMetrics | null>();
  for (const date of [...metrics.keys()].sort()) {
    const sets = metrics.get(date)!;
    const before = await getMetrics(ctx.db, date);
    befores.set(date, before);
    const cols = [...sets.keys()];
    const values = [...sets.values()];
    if (before) {
      await ctx.db.run(`UPDATE daily_metrics SET ${cols.map((c) => `${c} = ?`).join(", ")}, pulled_at = ? WHERE date = ?`, [...values, stamp, date]);
    } else {
      await ctx.db.run(`INSERT INTO daily_metrics (date, ${cols.join(", ")}, pulled_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)`, [date, ...values, stamp]);
    }
    if (statDates.has(date)) result.days.push(date);
    if (entered.has(date)) result.entered.push(`${date}: ${entered.get(date)}`);
  }
  for (const date of [...clears.keys()].sort()) {
    const cols = [...clears.get(date)!];
    befores.set(date, await getMetrics(ctx.db, date));
    await ctx.db.run(`UPDATE daily_metrics SET ${cols.map((c) => `${c} = NULL`).join(", ")}, pulled_at = ? WHERE date = ?`, [stamp, date]);
    for (const c of cols) result.cleared.push(`${date}: ${c}`);
  }
  // Spec rule 5, for every day written or cleared and the day after each (its "day before" just changed).
  const toFlag = new Set<string>();
  for (const date of [...metrics.keys(), ...clears.keys()]) toFlag.add(date).add(addDays(date, 1));
  for (const date of [...toFlag].sort()) {
    if (!befores.has(date)) befores.set(date, await getMetrics(ctx.db, date));
    await flagIncomplete(ctx.db, date);
  }
  for (const [date, before] of befores) {
    const after = await getMetrics(ctx.db, date);
    if (after && JSON.stringify(after) !== JSON.stringify(before)) await recordAudit(ctx, { table: "daily_metrics", rowId: date, before, after });
  }

  // Weigh-ins. Apple Health always writes; a texted weight never replaces an Apple Health one.
  const writeWeighin = async (date: string, lb: number, source: Weighin["source"]) => {
    const before = await getWeighin(ctx.db, date);
    if (source === "texted" && before?.source === "apple_health") {
      result.kept.push(`${date}: kept the Apple Health weight of ${before.lb} lb`);
      return;
    }
    await ctx.db.run(
      `INSERT INTO weighins (date, lb, source, pulled_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET lb = excluded.lb, source = excluded.source, pulled_at = excluded.pulled_at`,
      [date, lb, source, stamp],
    );
    await recordAudit(ctx, { table: "weighins", rowId: date, before, after: (await getWeighin(ctx.db, date))! });
    result.weighins.push(date);
  };
  for (const [date, lb] of appleWeights) await writeWeighin(date, lb, "apple_health");
  // Apple Health weigh-ins it no longer has. The change record keeps the row; undo puts it back.
  for (const date of removeWeights.sort()) {
    const before = await getWeighin(ctx.db, date);
    if (!before) continue;
    await ctx.db.run("DELETE FROM weighins WHERE date = ?", [date]);
    await recordAudit(ctx, { table: "weighins", rowId: date, before, after: { date, removed: "no longer in Apple Health" } });
    result.cleared.push(`${date}: weight`);
  }
  for (const [date, lb] of texted) {
    if (appleWeights.has(date)) result.kept.push(`${date}: kept the Apple Health weight of ${appleWeights.get(date)} lb`);
    else await writeWeighin(date, lb, "texted");
  }

  // Workouts (spec rule 6): the same start and kind is the same workout.
  const COLS = ["local_date", "end_utc", "duration_sec", "distance_m", "energy_kcal", "indoor", "temp_c", "avg_hr", "max_hr", "source"] as const;
  const find = (w: { start_utc: string; activity_type: string }) =>
    ctx.db.first<Workout>("SELECT * FROM workouts WHERE start_utc = ? AND activity_type = ?", [w.start_utc, w.activity_type]);
  for (const w of workouts) {
    const before = await find(w);
    if (before) {
      await ctx.db.run(`UPDATE workouts SET ${COLS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...COLS.map((c) => w[c]), before.id]);
      result.workouts_updated++;
    } else {
      await ctx.db.run(
        `INSERT INTO workouts (start_utc, activity_type, ${COLS.join(", ")}) VALUES (?, ?, ${COLS.map(() => "?").join(", ")})`,
        [w.start_utc, w.activity_type, ...COLS.map((c) => w[c])],
      );
      result.workouts_added++;
    }
    const after = (await find(w))!;
    if (JSON.stringify(after) !== JSON.stringify(before)) await recordAudit(ctx, { table: "workouts", rowId: String(after.id), before, after });
    for (const s of w.stats) {
      await ctx.db.run(
        `INSERT INTO workout_stats (workout_id, sample_type, unit, sum, average, min, max) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workout_id, sample_type) DO UPDATE SET unit = excluded.unit, sum = excluded.sum, average = excluded.average, min = excluded.min, max = excluded.max`,
        [after.id, s.sample_type, s.unit ?? null, s.sum ?? null, s.average ?? null, s.min ?? null, s.max ?? null],
      );
    }
  }
  return result;
}

/**
 * Spec rule 5: a day is incomplete when its calories are under 1,500, or exactly the same as
 * the day before (the food app carries yesterday's number forward when nothing was
 * logged). A day with no calories at all is not flagged: there is nothing to doubt.
 */
async function flagIncomplete(db: Db, date: string): Promise<void> {
  const row = await getMetrics(db, date);
  if (!row) return;
  const dayBefore = await getMetrics(db, addDays(date, -1));
  const incomplete =
    row.kcal_eaten !== null && (row.kcal_eaten < INCOMPLETE_BELOW_KCAL || (dayBefore?.kcal_eaten ?? null) === row.kcal_eaten) ? 1 : 0;
  if (incomplete !== row.incomplete) await db.run("UPDATE daily_metrics SET incomplete = ? WHERE date = ?", [incomplete, date]);
}

// ---------- reading ----------

export async function getMetrics(db: Db, date: string): Promise<DailyMetrics | null> {
  return db.first<DailyMetrics>("SELECT * FROM daily_metrics WHERE date = ?", [date]);
}
export async function getWeighin(db: Db, date: string): Promise<Weighin | null> {
  return db.first<Weighin>("SELECT * FROM weighins WHERE date = ?", [date]);
}

/**
 * Every date between two dates (both included) that has metrics or a weigh-in, oldest first.
 * `partial` marks today (spec rule 3): its totals are still growing, so leave it out of averages.
 */
export async function listDays(db: Db, from: string, to: string, now = new Date()): Promise<DayView[]> {
  const today = todayInTz(now);
  const metrics = await db.all<DailyMetrics>("SELECT * FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date", [from, to]);
  const weighins = await db.all<Weighin>("SELECT * FROM weighins WHERE date >= ? AND date <= ? ORDER BY date", [from, to]);
  const byDate = new Map<string, DayView>();
  const blank = (date: string): DayView => ({
    date, incomplete: false, partial: date >= today, weight_lb: null, weight_source: null,
    ...(Object.fromEntries(METRIC_COLUMNS.map((c) => [c, null])) as Record<MetricColumn, null>),
  });
  for (const m of metrics) {
    const day = blank(m.date);
    for (const c of METRIC_COLUMNS) day[c] = m[c];
    day.incomplete = !!m.incomplete;
    byDate.set(m.date, day);
  }
  for (const w of weighins) {
    const day = byDate.get(w.date) ?? blank(w.date);
    day.weight_lb = w.lb;
    day.weight_source = w.source;
    byDate.set(w.date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The newest date with fiber saved (he enters it from food-app screenshots), or null when there is none. */
export async function latestFiberDate(db: Db): Promise<string | null> {
  return (await db.first<{ date: string | null }>("SELECT MAX(date) AS date FROM daily_metrics WHERE fiber_g IS NOT NULL"))?.date ?? null;
}

/** The newest date with anything saved, or null when nothing has been saved yet. */
export async function latestDate(db: Db): Promise<string | null> {
  const row = await db.first<{ date: string | null }>(
    "SELECT MAX(date) AS date FROM (SELECT MAX(date) AS date FROM daily_metrics UNION ALL SELECT MAX(date) FROM weighins)",
  );
  return row?.date ?? null;
}

/** The workouts between two local dates (both included), oldest first. */
export async function listWorkouts(db: Db, from: string, to: string): Promise<Workout[]> {
  return db.all<Workout>("SELECT * FROM workouts WHERE local_date >= ? AND local_date <= ? ORDER BY start_utc", [from, to]);
}
