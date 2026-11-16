// Turns the last 30 days into the rows the page shows: one row per number (calories, weight,
// steps, ...), each with its points over time and its latest value. A number that has never been
// saved gets no row at all.
//
// Two rules from the owner's Apple Health spec decide which days count:
// - Today is partial: its running totals (food, steps, active calories) are still growing, so
//   they are not drawn and not averaged. Readings (weight, resting heart rate) from today count.
// - A day flagged incomplete has doubtful food numbers (under 1,500 kcal logged, or the food app
//   carried the day before forward), so its food is not drawn and not averaged.
// Those days are still listed when a row is opened, marked, so nothing is hidden.

import type { DayView, FieldInfo, Workout } from "@health/core";

export interface Point {
  day: string;
  value: number;
}

export interface Measure {
  key: string;
  label: string;
  group: FieldInfo["group"];
  /** Every day that counts for this number, oldest first. */
  points: Point[];
  /** Days that have a value but do not count, with why: "so far" (today) or "incomplete". */
  set_aside: (Point & { why: string })[];
  /** How a value reads as text: "2,150", "183.6 lb". */
  format: (n: number) => string;
}

function formatter(f: FieldInfo): (n: number) => string {
  const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals });
  return (n) => (f.unit ? `${nf.format(n)} ${f.unit}` : nf.format(n));
}

export function measures(fields: FieldInfo[], days: DayView[]): Measure[] {
  const out: Measure[] = [];
  for (const f of fields) {
    const points: Point[] = [];
    const set_aside: Measure["set_aside"] = [];
    for (const d of days) {
      const value = d[f.key];
      if (value === null) continue;
      if (f.kind === "total" && d.partial) set_aside.push({ day: d.date, value, why: "so far" });
      else if (f.group === "food" && d.incomplete) set_aside.push({ day: d.date, value, why: "incomplete" });
      else points.push({ day: d.date, value });
    }
    if (!points.length && !set_aside.length) continue;
    out.push({ key: f.key, label: f.label, group: f.group, points, set_aside, format: formatter(f) });
  }
  return out;
}

/** The average of the points that fall in the last `span` days ending today, or null if none do. */
export function average(points: Point[], today: string, span: number): number | null {
  const from = shiftDay(today, -(span - 1));
  const inSpan = points.filter((p) => p.day >= from && p.day <= today);
  if (!inSpan.length) return null;
  return inSpan.reduce((sum, p) => sum + p.value, 0) / inSpan.length;
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "today", "yesterday", or "Nov 12". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "today";
  if (day === shiftDay(today, -1)) return "yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
}

/** "Sun, Nov 15", for the list of days under a row. */
export function longDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/** How many days lie between two dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ---------- workouts ----------

const ACTIVITY_NAMES: Record<string, string> = {
  cycling: "Bike ride",
  hiking: "Hike",
  walking: "Walk",
  running: "Run",
  swimming: "Swim",
  functionalStrengthTraining: "Strength",
  traditionalStrengthTraining: "Strength",
};

/** Apple Health's name for an activity, as he would say it. An unknown one is spelled out: "Basketball". */
export function activityName(type: string): string {
  if (ACTIVITY_NAMES[type]) return ACTIVITY_NAMES[type]!;
  const words = type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "59 min", "1 h 12 min". Apple Health gives seconds. */
export function duration(sec: number): string {
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** "12.3 mi". Apple Health gives meters. */
export function miles(meters: number): string {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(meters / 1609.344)} mi`;
}

/** What a workout row says after its name: "59 min · 12.3 mi". Only what Apple Health recorded. */
export function workoutFacts(w: Pick<Workout, "duration_sec" | "distance_m">): string {
  return [w.duration_sec !== null ? duration(w.duration_sec) : null, w.distance_m ? miles(w.distance_m) : null].filter(Boolean).join(" · ");
}
