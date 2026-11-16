// The chart cards, built from the same days the headline numbers and trends use. Each page picks
// the ones it shows (chartCards(data).weight, ...); a chart with nothing to draw is null.
//
//   weight          each weigh-in as a faint dot, the 7-day average as the line, each
//                   check-in from his food app as a dashed rule (so a change of targets lines up with the trend)
//   kcal_eaten      a bar per day, week or month: the average eaten per day
//   protein_g, carbs_g, fat_g, fiber_g, steps, active_kcal   the same
//   resting_hr      each day as a faint dot, the 7-day average as the line
//   vo2max          each reading joined by a line (it is measured only now and then)
//   training        bars stacked by kind: lifting, rides, basketball, other (days, not sessions)
//
// Bars are per day for 30 days, per week for 90, per month for a year (lib/series.ts). The
// headline number and its change come from `kpis`, so a chart and the "Your numbers" table
// always agree.

import type { ReactNode } from "react";
import { Activity, Beef, Droplet, Dumbbell, Flame, Footprints, Gauge, HeartPulse, Leaf, Scale, Wheat, type LucideIcon } from "lucide-react";
import type { Dashboard } from "../api";
import { BarChart, ChartCard, LineChart, type Bar, type ChartMark } from "./charts/Chart";
import { Delta } from "./ui";
import { colorOf } from "../lib/colors";
import { longDay, measures, shiftDay, type Measure } from "../lib/measures";
import { TRAINING_KINDS, bucketAverages, bucketCounts, buckets, rolling, trainingDays, type Kpi } from "../lib/series";

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** The training chart's kinds, in a fixed order: lifting, rides, basketball, other. */
export const SERIES = ["var(--m-lifting)", "var(--m-ride)", "var(--m-ball)", "var(--c4)"];

export const rangeWords = (range: number) => (range >= 365 ? "the last year" : `the last ${range} days`);
const priorWords = (range: number) => (range >= 365 ? "the year before" : `the ${range} days before`);

export type ChartKey = "weight" | "kcal_eaten" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g" | "steps" | "active_kcal" | "resting_hr" | "vo2max" | "training";

/** Each check-in from his food app, for the weight chart: what the targets became, said on hover. */
function checkIns(data: Dashboard): ChartMark[] {
  return (data.macros?.history ?? []).map((t) => ({
    day: t.effective_date,
    name: "Targets changed",
    value: `${whole.format(t.kcal)} kcal${t.trend_weight_lb !== null ? `, trend ${one.format(t.trend_weight_lb)} lb` : ""}`,
  }));
}

export function chartCards(data: Dashboard, kpis: Kpi[], height?: Partial<Record<ChartKey, number>>): Record<ChartKey, ReactNode> {
  const { today, range } = data;
  const from = shiftDay(today, -(range - 1));
  const rows = measures(data.fields, data.days);
  const row = (key: string) => rows.find((r) => r.key === key);
  const kpi = (key: string) => kpis.find((k) => k.key === key);
  const inRange = (m: Measure | undefined) => (m ? m.points.filter((p) => p.day >= from && p.day <= today) : []);
  const bars = buckets(today, range);
  const per = range <= 31 ? "Day" : range <= 100 ? "Week" : "Month";
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  /** The footer: how much the card covers, and its change as a chip. */
  const foot = (k: Kpi | undefined, words: string) => (
    <>
      <span>{words}</span>
      {k?.delta && k.delta !== "no change" ? (
        <span className="foot-right">
          <Delta text={`${k.delta} vs ${priorWords(range)}`} tone={k.tone} chip />
        </span>
      ) : null}
    </>
  );

  /** A bar chart of a daily number, averaged per bar. */
  const averaged = (key: ChartKey, title: string, unit: string, icon: LucideIcon, subtitle: string) => {
    const m = row(key);
    const points = inRange(m);
    if (!points.length) return null;
    const values = bucketAverages(bars, points);
    const chartBars: Bar[] = bars.map((b) => ({ label: b.label, axis: b.axis, values: [values[bars.indexOf(b)] ?? null] }));
    const format = (n: number) => `${whole.format(n)}${unit}`;
    const aside = (m?.set_aside ?? []).filter((p) => p.day >= from);
    const k = kpi(key);
    return (
      <ChartCard
        key={key}
        icon={icon}
        color={colorOf(key)}
        title={title}
        subtitle={subtitle}
        metric={{ label: "Average a day", value: format(mean(points.map((p) => p.value))), delta: k?.delta, tone: k?.tone }}
        footer={foot(k, `${points.length} ${points.length === 1 ? "day" : "days"} counted`)}
        table={{
          columns: [per, range <= 31 ? title : `${title}, average a day`],
          rows: [
            ...bars.map((b, i) => [b.label, values[i] === null || values[i] === undefined ? "none" : format(values[i]!)]).reverse(),
            ...aside.map((p) => [`${longDay(p.day)} (${p.why}, not counted)`, format(p.value)]),
          ],
        }}
      >
        <BarChart bars={chartBars} parts={[{ key, label: title, color: colorOf(key) }]} format={format} label={`${title} per ${per.toLowerCase()}`} height={height?.[key]} />
      </ChartCard>
    );
  };

  /** A line chart of a reading: each reading as a faint dot, and (smooth) its 7-day average as the line. */
  const line = (key: ChartKey, field: string, title: string, unit: string, each: string, icon: LucideIcon, subtitle: string, smooth = true, marks: ChartMark[] = [], goal: number | null = null) => {
    const m = row(field);
    const points = inRange(m);
    if (points.length < 2) return null;
    const format = (n: number) => `${one.format(n)}${unit}`;
    const avg = rolling(m!.points).filter((p) => p.day >= from);
    const k = kpi(field);
    const latest = (smooth ? avg : points).at(-1)!.value;
    return (
      <ChartCard
        key={key}
        icon={icon}
        color={colorOf(field)}
        title={title}
        subtitle={subtitle}
        metric={{ label: smooth ? "7-day average" : "Latest", value: format(latest), delta: k?.delta, tone: k?.tone, note: goal !== null ? `goal ${format(goal)}` : undefined }}
        legend={
          smooth
            ? [
                { label: "7-day average", color: colorOf(field), kind: "line" as const },
                { label: each, color: "var(--chart-muted)", kind: "dot" as const },
                ...(marks.some((m) => m.day >= from && m.day <= today) ? [{ label: "Targets changed", color: "var(--chart-mark)", kind: "rule" as const }] : []),
              ]
            : undefined
        }
        footer={foot(k, `${points.length} ${points.length === 1 ? "reading" : "readings"}`)}
        table={{
          columns: smooth ? ["Day", title, "7-day average"] : ["Day", title],
          rows: [...points].reverse().map((p) => [longDay(p.day), format(p.value), ...(smooth ? [format(avg.find((a) => a.day === p.day)!.value)] : [])]),
        }}
      >
        <LineChart
          from={from}
          to={today}
          format={format}
          label={`${title} over ${rangeWords(range)}`}
          height={height?.[key]}
          marks={marks}
          goal={goal !== null ? { value: goal, label: `Goal ${format(goal)}` } : null}
          series={
            smooth
              ? [{ name: each.replace(/^Each /, "That "), points, kind: "dots", color: "var(--chart-muted)" }, { name: "7-day average", points: avg, kind: "line", color: colorOf(field) }]
              : [{ name: title, points, kind: "line", color: colorOf(field) }]
          }
        />
      </ChartCard>
    );
  };

  const training = () => {
    const days = trainingDays(data.workouts, data.lift_days);
    // Training is always shown by the week (or the month, over a year): a bar a day says little.
    const weeks = range <= 100 ? buckets(today, Math.max(range, 35)).filter((b) => b.to >= from) : bars;
    const counts = TRAINING_KINDS.map((k) => bucketCounts(weeks, days[k.key].filter((d) => d >= from && d <= today)));
    const total = counts.flat().reduce((a, b) => a + b, 0);
    if (!total) return null;
    const used = TRAINING_KINDS.map((k, i) => ({ ...k, color: SERIES[i]!, n: counts[i]!.reduce((a, b) => a + b, 0) }));
    const unit = range <= 100 ? "Week" : "Month";
    return (
      <ChartCard
        key="training"
        icon={Dumbbell}
        color={colorOf("training")}
        title="Training"
        subtitle={`days trained each ${unit.toLowerCase()}, by kind`}
        metric={{ label: "Training days", value: String(total), note: `in ${rangeWords(range)}` }}
        legend={used.filter((k) => k.n).map((k) => ({ label: `${k.label} ${k.n}`, color: k.color, kind: "box" as const }))}
        footer={<span>Lifting from what you logged with your coach; rides, basketball and the rest from Apple Health</span>}
        table={{
          columns: [unit, ...used.map((k) => k.label)],
          rows: weeks.map((b, i) => [b.label, ...counts.map((c) => String(c[i]))]).reverse(),
        }}
      >
        <BarChart
          bars={weeks.map((b, i) => ({ label: b.label, axis: b.axis, values: counts.map((c) => c[i] || null) }))}
          parts={used.map((k) => ({ key: k.key, label: k.label, color: k.color }))}
          format={(n) => `${n} ${n === 1 ? "day" : "days"}`}
          label={`Training days per ${unit.toLowerCase()}, by kind`}
          height={height?.training}
        />
      </ChartCard>
    );
  };

  return {
    weight: line("weight", "weight_lb", "Weight", " lb", "Each weigh-in", Scale, "your weight over time", true, checkIns(data), data.macros?.current?.goal_weight_lb ?? null),
    kcal_eaten: averaged("kcal_eaten", "Calories", "", Flame, "what you ate each day"),
    protein_g: averaged("protein_g", "Protein", " g", Beef, "grams eaten each day"),
    carbs_g: averaged("carbs_g", "Carbs", " g", Wheat, "grams eaten each day"),
    fat_g: averaged("fat_g", "Fat", " g", Droplet, "grams eaten each day"),
    fiber_g: averaged("fiber_g", "Fiber", " g", Leaf, "grams eaten each day"),
    steps: averaged("steps", "Steps", "", Footprints, "steps walked each day"),
    active_kcal: averaged("active_kcal", "Active calories", "", Activity, "calories burned moving each day"),
    resting_hr: line("resting_hr", "resting_hr", "Resting heart rate", " bpm", "Each day", HeartPulse, "beats a minute at rest"),
    vo2max: line("vo2max", "vo2max", "VO2 max", "", "Each reading", Gauge, "your watch's estimate of fitness", false),
    training: training(),
  };
}
