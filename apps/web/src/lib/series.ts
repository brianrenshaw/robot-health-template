// The arithmetic behind the dashboard's tiles and charts: grouping days into bars, a rolling
// average, and each headline number with its change from the stretch before.
//
// Which days count comes from lib/measures.ts (today's running totals and incomplete food days
// are left out), so a tile, its chart and the trend sentence beside them always agree.

import type { DayView, FieldInfo, Workout } from "@health/core";
import { measures, shiftDay, daysBetween, type Point } from "./measures";

// ---------- bars ----------

export interface Bucket {
  /** The first and last day the bar covers. */
  from: string;
  to: string;
  /** What the bar is called on the axis and in the tooltip: "Nov 3", "Nov 3 to 9", "November". */
  label: string;
  axis: string;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
const monthDay = fmt({ month: "short", day: "numeric" });
const month = fmt({ month: "short" });
const monthLong = fmt({ month: "long" });

/**
 * The bars for a range: one per day for 30 days, one per week (Monday to Sunday) for 90, one
 * per month for a year. Oldest first. The last bar may still be filling.
 */
export function buckets(today: string, range: number): Bucket[] {
  const from = shiftDay(today, -(range - 1));
  const out: Bucket[] = [];
  if (range <= 31) {
    for (let d = from; d <= today; d = shiftDay(d, 1)) out.push({ from: d, to: d, label: monthDay(d), axis: monthDay(d) });
    return out;
  }
  if (range <= 100) {
    const weekday = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7;
    for (let d = shiftDay(from, -weekday); d <= today; d = shiftDay(d, 7)) {
      const end = shiftDay(d, 6);
      out.push({ from: d, to: end, label: `${monthDay(d)} to ${monthDay(end)}`, axis: monthDay(d) });
    }
    return out;
  }
  for (let d = `${from.slice(0, 7)}-01`; d <= today; ) {
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextDay = next.toISOString().slice(0, 10);
    out.push({ from: d, to: shiftDay(nextDay, -1), label: `${monthLong(d)} ${d.slice(0, 4)}`, axis: month(d) });
    d = nextDay;
  }
  return out;
}

/** The average of the points inside each bar, or null where there are none. */
export function bucketAverages(bars: Bucket[], points: Point[]): (number | null)[] {
  return bars.map((b) => {
    const inside = points.filter((p) => p.day >= b.from && p.day <= b.to);
    return inside.length ? inside.reduce((sum, p) => sum + p.value, 0) / inside.length : null;
  });
}

/** How many of the given days fall inside each bar. */
export function bucketCounts(bars: Bucket[], days: string[]): number[] {
  return bars.map((b) => days.filter((d) => d >= b.from && d <= b.to).length);
}

// ---------- lines ----------

/** For each point, the average of the points in the `window` days ending on it. Smooths daily scatter. */
export function rolling(points: Point[], window = 7): Point[] {
  return points.map((p) => {
    const from = shiftDay(p.day, -(window - 1));
    const inside = points.filter((q) => q.day >= from && q.day <= p.day);
    return { day: p.day, value: inside.reduce((sum, q) => sum + q.value, 0) / inside.length };
  });
}

// ---------- training ----------

export const TRAINING_KINDS = [
  { key: "lift", label: "Lifting" },
  { key: "ride", label: "Rides" },
  { key: "ball", label: "Basketball" },
  { key: "other", label: "Other" },
] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number]["key"];

/**
 * The days he trained, by kind. A lifting day is a day with logged sets or a strength workout
 * from his watch (the same session shows up as both, so the days are merged, not added).
 */
export function trainingDays(workouts: Workout[], liftDays: string[]): Record<TrainingKind, string[]> {
  const days = (test: (w: Workout) => boolean) => [...new Set(workouts.filter(test).map((w) => w.local_date))];
  const strength = (w: Workout) => /strength/i.test(w.activity_type);
  return {
    lift: [...new Set([...liftDays, ...days(strength)])],
    ride: days((w) => w.activity_type === "cycling"),
    ball: days((w) => w.activity_type === "basketball"),
    other: days((w) => !strength(w) && w.activity_type !== "cycling" && w.activity_type !== "basketball"),
  };
}

// ---------- headline numbers ----------

export interface Kpi {
  key: string;
  label: string;
  /** The number as it is read: "2,150", "183.1 lb", "9". */
  value: string;
  /** What kind of number it is, in a few words: "a day", "7-day avg", "latest". */
  note: string;
  /** The change from the stretch before, signed: "+120", "−1.8 lb". Null when there is nothing to compare. */
  delta: string | null;
  direction: "up" | "down" | "flat" | null;
  /**
   * Whether the change is good, bad or neither. Only numbers whose good direction does not
   * depend on his goals get a tone (more steps, a lower resting heart rate, more training
   * days); food and weight stay neutral until he has set goals.
   */
  tone: "good" | "bad" | "neutral";
  /** Twelve values across the range, for the small line. Null where there is no data. */
  spark: (number | null)[];
}

/**
 * Which way is better, for the numbers where that does not depend on his goals. Weight joins
 * them once he has a goal weight (from his food app's check-in): toward the goal is better.
 */
const BETTER: Record<string, "up" | "down"> = { steps: "up", active_kcal: "up", vo2max: "up", resting_hr: "down", lift_days: "up", rides: "up" };
const toneOf = (key: string, direction: Kpi["direction"], better: Record<string, "up" | "down"> = BETTER): Kpi["tone"] =>
  !better[key] || !direction || direction === "flat" ? "neutral" : direction === better[key] ? "good" : "bad";

const numberFormat = (decimals: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function sparkOf(points: Point[], today: string, range: number): (number | null)[] {
  const from = shiftDay(today, -(range - 1));
  return Array.from({ length: 12 }, (_, i) => {
    const a = shiftDay(from, Math.floor((i * range) / 12));
    const b = shiftDay(from, Math.floor(((i + 1) * range) / 12) - 1);
    const inside = points.filter((p) => p.day >= a && p.day <= b);
    return inside.length ? mean(inside.map((p) => p.value)) : null;
  });
}

function change(now: number, before: number | null, decimals: number, unit: string, tolerance: number): Pick<Kpi, "delta" | "direction"> {
  if (before === null) return { delta: null, direction: null };
  const diff = now - before;
  if (Math.abs(diff) < tolerance) return { delta: "no change", direction: "flat" };
  return { delta: `${diff > 0 ? "+" : "−"}${numberFormat(decimals).format(Math.abs(diff))}${unit}`, direction: diff > 0 ? "up" : "down" };
}

const withTone = (key: string, c: Pick<Kpi, "delta" | "direction">, better?: Record<string, "up" | "down">) => ({ ...c, tone: toneOf(key, c.direction, better) });

/**
 * The headline numbers for a range. Running totals (food, steps, active calories) are the
 * average per day over the range, set against the average over the range before. Weight is
 * the average of the last seven days of weigh-ins, set against the seven days that ended when
 * the range began. Counts (lifting days, rides) are totals, set against the range before.
 * A number with no data gets no tile.
 */
export function kpis(input: { today: string; range: number; fields: FieldInfo[]; days: DayView[]; workouts: Workout[]; liftDays: string[]; goalWeight?: number | null }): Kpi[] {
  const { today, range } = input;
  const from = shiftDay(today, -(range - 1));
  const before = shiftDay(from, -range);
  const rows = measures(input.fields, input.days);
  const out: Kpi[] = [];
  const within = (points: Point[], a: string, b: string) => points.filter((p) => p.day >= a && p.day <= b);

  for (const f of input.fields) {
    const points = rows.find((r) => r.key === f.key)?.points ?? [];
    const now = within(points, from, today);
    if (!now.length) continue;
    const unit = f.unit ? ` ${f.unit}` : "";
    if (f.key === "weight_lb" || f.key === "vo2max") {
      // A reading: where it stands now, against where it stood when the range began.
      const recent = within(points, shiftDay(today, -6), today);
      const value = f.key === "weight_lb" && recent.length ? mean(recent.map((p) => p.value)) : now.at(-1)!.value;
      const then = within(points, shiftDay(from, -6), from);
      const start = then.length ? mean(then.map((p) => p.value)) : now.length > 1 ? now[0]!.value : null;
      const goal = f.key === "weight_lb" && input.goalWeight ? input.goalWeight : null;
      const better = goal !== null && goal !== value ? { ...BETTER, weight_lb: goal < value ? ("down" as const) : ("up" as const) } : undefined;
      out.push({
        key: f.key, label: f.label, value: `${numberFormat(1).format(value)}${unit}`,
        note: f.key === "weight_lb" && recent.length > 1 ? "7-day avg" : "latest",
        ...withTone(f.key, change(value, start, 1, unit, 0.05), better), spark: sparkOf(points, today, range),
      });
      continue;
    }
    const prior = within(points, before, shiftDay(from, -1));
    const value = mean(now.map((p) => p.value));
    out.push({
      key: f.key, label: f.label, value: `${numberFormat(f.decimals).format(value)}${unit}`,
      note: f.kind === "total" ? "a day" : "average",
      ...withTone(f.key, change(value, prior.length ? mean(prior.map((p) => p.value)) : null, f.decimals, unit, f.key === "resting_hr" ? 0.5 : 1)),
      spark: sparkOf(points, today, range),
    });
  }

  const training = trainingDays(input.workouts, input.liftDays);
  const counted = [
    { key: "lift_days", label: "Lifting days", days: training.lift },
    { key: "rides", label: "Rides", days: training.ride },
  ];
  for (const c of counted) {
    const now = c.days.filter((d) => d >= from && d <= today).length;
    const prior = c.days.filter((d) => d >= before && d < from).length;
    if (!now && !prior) continue;
    const perBucket = Array.from({ length: 12 }, (_, i) => {
      const a = shiftDay(from, Math.floor((i * range) / 12));
      const b = shiftDay(from, Math.floor(((i + 1) * range) / 12) - 1);
      return c.days.filter((d) => d >= a && d <= b).length;
    });
    out.push({ key: c.key, label: c.label, value: String(now), note: `in ${range} days`, ...withTone(c.key, change(now, prior, 0, "", 0.5)), spark: perBucket });
  }
  return out;
}

export { daysBetween };
