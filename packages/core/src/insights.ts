// insights.ts
// The dashboard's trends: plain sentences worked out from the record, with no judgement in them.
// "Weight is down 1.8 lb over the last 30 days." "Calories averaged 2,150 a day, down from 2,240."
//
// These are the "analysis" the site can do by itself. It has no AI in it, so everything here is
// arithmetic with a test. Interpretation (is that good, what to change) is the coach's job; the
// coach is handed these same sentences (get_health_data) so its numbers agree with the page's.
//
// Rules carried over from the Apple Health spec: today is partial and is never averaged; a day
// flagged incomplete is left out of food averages.
//
// Nothing here says "good" or "bad": he has not set goals, and weight going down is good or bad
// depending on what he is trying to do. When he sets targets, this is where they would be used.

import { addDays, type DayView, type Workout } from "./health";
import type { LiftProgress } from "./coach";

export interface Trend {
  /** What the sentence is about: weight, calories, protein, energy, logging, steps, heart, training, lifts. */
  key: string;
  text: string;
}

export interface TrendInput {
  today: string;
  /** How many days the dashboard is looking at. */
  range: number;
  /** Days covering at least twice the range, oldest first. */
  days: DayView[];
  /** Workouts covering at least the range. */
  workouts: Workout[];
  /** Every day he logged lifting sets, covering at least the range. */
  liftDays: string[];
  lifts: LiftProgress[];
}

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const one = (n: number) => Math.abs(n).toFixed(1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** The slope of a straight line through the points, in units per day. */
export function slopePerDay(points: { day: string; value: number }[]): number {
  const x0 = points[0]!.day;
  const xs = points.map((p) => daysBetween(x0, p.day));
  const mx = mean(xs);
  const my = mean(points.map((p) => p.value));
  const spread = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  if (!spread) return 0;
  return xs.reduce((sum, x, i) => sum + (x - mx) * (points[i]!.value - my), 0) / spread;
}

export function buildTrends(input: TrendInput): Trend[] {
  const { today, range } = input;
  const from = addDays(today, -(range - 1));
  const before = addDays(from, -range);
  const now = input.days.filter((d) => d.date >= from && d.date <= today);
  const prev = input.days.filter((d) => d.date >= before && d.date < from);
  const out: Trend[] = [];
  const span = `the last ${range} days`;

  // Weight: a line through the weigh-ins, so one odd morning does not swing it.
  const weights = now.filter((d) => d.weight_lb !== null).map((d) => ({ day: d.date, value: d.weight_lb! }));
  let perWeek: number | null = null;
  if (weights.length >= 3 && daysBetween(weights[0]!.day, weights.at(-1)!.day) >= 7) {
    const slope = slopePerDay(weights);
    perWeek = slope * 7;
    const covered = daysBetween(weights[0]!.day, weights.at(-1)!.day);
    const latest = `${weights.at(-1)!.value.toFixed(1)} lb`;
    out.push({
      key: "weight",
      text:
        Math.abs(perWeek) < 0.1
          ? `Weight is holding steady over the last ${covered} days. Latest ${latest}.`
          : `Weight is ${slope < 0 ? "down" : "up"} about ${one(slope * covered)} lb over the last ${covered} days, around ${one(perWeek)} lb a week. Latest ${latest}.`,
    });
  } else if (weights.length) {
    out.push({ key: "weight", text: `Latest weight ${weights.at(-1)!.value.toFixed(1)} lb. Too few weigh-ins in ${span} to call a trend.` });
  }

  // Food: only whole, trustworthy days.
  const fed = (ds: DayView[]) => ds.filter((d) => !d.partial && !d.incomplete && d.kcal_eaten !== null);
  const foodNow = fed(now);
  const foodPrev = fed(prev);
  let kcal: number | null = null;
  if (foodNow.length >= 3) {
    kcal = mean(foodNow.map((d) => d.kcal_eaten!));
    const was = foodPrev.length >= 3 ? mean(foodPrev.map((d) => d.kcal_eaten!)) : null;
    const moved = was === null || Math.abs(kcal - was) < 25 ? "" : `, ${kcal > was ? "up" : "down"} from ${whole.format(was)} in the ${range} days before`;
    const same = was !== null && Math.abs(kcal - was) < 25 ? `, about the same as the ${range} days before` : "";
    out.push({ key: "calories", text: `Calories averaged ${whole.format(kcal)} a day over ${span} (${plural(foodNow.length, "full day")} logged)${moved}${same}.` });

    const protein = foodNow.filter((d) => d.protein_g !== null).map((d) => d.protein_g!);
    if (protein.length >= 3) {
      const grams = mean(protein);
      const weight = weights.at(-1)?.value ?? null;
      out.push({ key: "protein", text: `Protein averaged ${whole.format(grams)} g a day${weight ? `, ${(grams / weight).toFixed(2)} g per pound of body weight` : ""}.` });
    }
    if (perWeek !== null) {
      out.push({
        key: "energy",
        text: Math.abs(perWeek) < 0.1 ? `On about ${whole.format(kcal)} calories a day, weight held steady.` : `On about ${whole.format(kcal)} calories a day, weight moved ${perWeek < 0 ? "down" : "up"} around ${one(perWeek)} lb a week.`,
      });
    }
  }
  // Gaps are counted from the first day he logged food in this stretch through yesterday, so a
  // record that has only just begun is not called full of holes. Days with no row at all count.
  if (foodNow.length >= 3) {
    const first = now.find((d) => d.kcal_eaten !== null)!.date;
    const gaps = daysBetween(first, addDays(today, -1)) + 1 - foodNow.length;
    if (gaps > 0) {
      out.push({ key: "logging", text: `Food was missing or only partly logged on ${plural(gaps, "day")} of ${span}. Those days are left out of the averages.` });
    }
  }

  // Steps and resting heart rate: this stretch against the one before.
  const compare = (key: "steps" | "resting_hr", label: string, unit: string, tolerance: number, needWhole: boolean) => {
    const pick = (ds: DayView[]) => ds.filter((d) => d[key] !== null && !(needWhole && d.partial)).map((d) => d[key]!);
    const a = pick(now);
    const b = pick(prev);
    if (a.length < 3) return;
    const avg = mean(a);
    const was = b.length >= 3 ? mean(b) : null;
    const value = `${whole.format(avg)}${unit}`;
    const tail = was === null ? "" : Math.abs(avg - was) < tolerance ? `, about the same as the ${range} days before` : `, ${avg > was ? "up" : "down"} from ${whole.format(was)}${unit}`;
    out.push({ key: key === "steps" ? "steps" : "heart", text: `${label} averaged ${value} over ${span}${tail}.` });
  };
  compare("steps", "Steps", " a day", 250, true);
  compare("resting_hr", "Resting heart rate", " bpm", 1, false);

  // Training: how many days of each kind.
  const inRange = input.workouts.filter((w) => w.local_date >= from && w.local_date <= today);
  const daysOf = (test: (w: Workout) => boolean) => new Set(inRange.filter(test).map((w) => w.local_date));
  const strength = daysOf((w) => /strength/i.test(w.activity_type));
  const lifting = new Set([...input.liftDays.filter((d) => d >= from && d <= today), ...strength]).size;
  const rides = daysOf((w) => w.activity_type === "cycling").size;
  const ball = daysOf((w) => w.activity_type === "basketball").size;
  const parts = [lifting ? plural(lifting, "lifting day") : null, rides ? plural(rides, "ride") : null, ball ? `${ball} basketball` : null].filter(Boolean);
  if (parts.length) out.push({ key: "training", text: `In ${span}: ${parts.join(", ")}.` });

  // Lifts: each lift's latest time against the time before.
  const up: string[] = [];
  const down: string[] = [];
  let held = 0;
  for (const lift of input.lifts) {
    const last = lift.points.at(-1)!;
    const prior = lift.points.at(-2);
    if (!prior || last.date < from) continue;
    const dw = last.weight_lb - prior.weight_lb;
    const dr = (last.reps ?? 0) - (prior.reps ?? 0);
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    if (dw > 0) up.push(`${lift.lift} +${fmt(dw)} lb`);
    else if (dw < 0) down.push(`${lift.lift} −${fmt(-dw)} lb`);
    else if (dr > 0) up.push(`${lift.lift} +${plural(dr, "rep")}`);
    else if (dr < 0) down.push(`${lift.lift} −${plural(-dr, "rep")}`);
    else held++;
  }
  if (up.length + down.length + held) {
    const name = (xs: string[]) => `${xs.slice(0, 3).join(", ")}${xs.length > 3 ? `, and ${xs.length - 3} more` : ""}`;
    const bits = [
      up.length ? `${plural(up.length, "lift")} went up (${name(up)})` : null,
      held ? `${held} held` : null,
      down.length ? `${down.length} came down (${name(down)})` : null,
    ].filter(Boolean);
    out.push({ key: "lifts", text: `Against the time before: ${bits.join("; ")}.` });
  }
  return out;
}
