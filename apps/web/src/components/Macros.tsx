// Food against the targets from his food app (the macro targets brief, 2026-11-16).
//
//   MacrosToday     today's calories, protein, carbs and fat as bars against the target (a tick
//                   at the target, its tolerance shaded), and fiber against its 30 to 40 g range
//                   (the range shaded). Today is still going, so it says how much is left.
//   MacrosWeek      this week (Monday on) day by day: what he ate and the target that day, a
//                   quiet check where a day landed within tolerance; this week's and last week's
//                   averages at the foot, leaving out today and incomplete days.
//   TargetHistory   every check-in from his food app: the targets, the trend weight, the goal rate, the note.
//
// Everything here is worked out on the server (packages/core/src/macros.ts): which targets
// applied on a day, the differences, the tolerances and the averages. The page only lays it out.

import { Check, History, Target, CalendarRange } from "lucide-react";
import type { DayVsTarget, MacroTargets, MacroView, TargetSet, WeekSummary } from "@health/core";
import { Card, Empty } from "./ui";
import { colorOf } from "../lib/colors";
import { dayLabel, longDay } from "../lib/measures";

type Key = "kcal" | "protein_g" | "carbs_g" | "fat_g";
const MACROS: { key: Key; field: string; label: string; short: string; unit: string }[] = [
  { key: "kcal", field: "kcal_eaten", label: "Calories", short: "Cal", unit: "" },
  { key: "protein_g", field: "protein_g", label: "Protein", short: "Prot", unit: " g" },
  { key: "carbs_g", field: "carbs_g", label: "Carbs", short: "Carb", unit: " g" },
  { key: "fat_g", field: "fat_g", label: "Fat", short: "Fat", unit: " g" },
];

/** A column header: the full name with its unit, or on a phone a short name, so six columns fit. */
const Head = ({ label, short, unit, className = "num" }: { label: string; short: string; unit: string; className?: string }) => (
  <th scope="col" className={className}>
    <span className="lbl-long">
      {label}
      {unit ? <span className="th-unit">{unit}</span> : null}
    </span>
    <span className="lbl-short" aria-hidden>
      {short}
    </span>
  </th>
);
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const amount = (n: number, unit: string) => `${whole.format(n)}${unit}`;
const short = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const weekday = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day}T12:00:00Z`));
const hasFood = (d: MacroView["this_week"][number]): d is DayVsTarget => "actual" in d && Object.values(d.actual).some((v) => v !== null);

// ---------- today ----------

/**
 * One bar. The scale puts the target four fifths of the way along, so there is room to see going
 * over. `band` is shaded on the track: the tolerance around a target, or fiber's range.
 */
function Bar({ value, target, band, color, label }: { value: number | null; target: number | null; band: [number, number]; color: string; label: string }) {
  const max = Math.max(band[1] / 0.8, value ?? 0, 1);
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <div className="macro-bar" role="img" aria-label={label}>
      <span className="macro-band" style={{ left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})` }} />
      {value !== null && value > 0 ? <span className="macro-fill" style={{ width: pct(value), background: color }} /> : null}
      {target !== null ? <span className="macro-tick" style={{ left: pct(target) }} /> : null}
    </div>
  );
}

export function MacrosToday({ macros, className }: { macros: MacroView; className?: string }) {
  const t = macros.current;
  if (!t) return null;
  const today = macros.this_week.find((d) => d.date === macros.today);
  const actual = today && "actual" in today ? today.actual : null;
  const logged = !!today && hasFood(today);
  return (
    <Card
      icon={Target}
      color={colorOf("kcal_eaten")}
      title="Today"
      subtitle="what you've eaten against your targets"
      actions={<span className="pill">In progress</span>}
      className={className}
      footer={<span>Targets from your food app's check-in on {short(t.effective_date)}. Today's totals are still growing.</span>}
    >
      {!logged ? <p className="macro-none">Nothing logged today yet. Food comes from your food app through Apple Health when you sync.</p> : null}
      <ul className="macro-rows">
        {MACROS.map((m) => {
          const target = t[m.key];
          const value = actual?.[m.key] ?? null;
          const tol = macros.tolerance[m.key] * target;
          const left = value === null ? null : target - value;
          const note =
            value === null ? "no data" : Math.abs(left!) <= tol ? "on target" : left! > 0 ? `${amount(left!, m.unit)} to go` : `${amount(-left!, m.unit)} over`;
          return (
            <li key={m.key} className="macro-row">
              <div className="macro-head">
                <span className="measure">
                  <span className="measure-dot" style={{ background: colorOf(m.field) }} aria-hidden />
                  {m.label}
                </span>
                <span className="macro-value">
                  <b>{value === null ? "—" : amount(value, m.unit)}</b>
                  <span className="faint"> of {amount(target, m.unit)}</span>
                </span>
              </div>
              <Bar value={value} target={target} band={[target - tol, target + tol]} color={colorOf(m.field)} label={`${m.label}: ${value === null ? "no data" : amount(value, m.unit)} of ${amount(target, m.unit)}`} />
              <div className="macro-note">{note}</div>
            </li>
          );
        })}
        <FiberRow value={actual?.fiber_g ?? null} t={t} />
      </ul>
    </Card>
  );
}

function FiberRow({ value, t }: { value: number | null; t: Pick<TargetSet, "fiber_min_g" | "fiber_max_g"> }) {
  const note =
    value === null ? "comes from your food-app screenshots" : value < t.fiber_min_g ? `${amount(t.fiber_min_g - value, " g")} to reach ${whole.format(t.fiber_min_g)}` : value > t.fiber_max_g ? `${amount(value - t.fiber_max_g, " g")} over the range` : "in range";
  const range = `${whole.format(t.fiber_min_g)} to ${whole.format(t.fiber_max_g)} g`;
  return (
    <li className="macro-row">
      <div className="macro-head">
        <span className="measure">
          <span className="measure-dot" style={{ background: colorOf("fiber_g") }} aria-hidden />
          Fiber
        </span>
        <span className="macro-value">
          <b>{value === null ? "—" : amount(value, " g")}</b>
          <span className="faint"> of {range}</span>
        </span>
      </div>
      <Bar value={value} target={null} band={[t.fiber_min_g, t.fiber_max_g]} color={colorOf("fiber_g")} label={`Fiber: ${value === null ? "no data" : amount(value, " g")}, range ${range}`} />
      <div className="macro-note">{note}</div>
    </li>
  );
}

// ---------- this week ----------

const OnMark = () => <Check className="on-mark" size={13} strokeWidth={2.75} aria-label="on target" />;

function Cell({ value, target, on, unit, judged }: { value: number | null; target: string | null; on?: boolean; unit: string; judged: boolean }) {
  return (
    <td className="num">
      <span className="macro-cell">
        {judged && on ? <OnMark /> : null}
        <b>{value === null ? "—" : amount(value, unit)}</b>
      </span>
      {target ? <span className="cell-note">of {target}</span> : null}
    </td>
  );
}

function AverageRow({ label, w }: { label: string; w: WeekSummary | null }) {
  return (
    <tr>
      <th scope="row">
        {label}
        <span className="cell-note">{w ? `${w.days_counted} ${w.days_counted === 1 ? "day" : "days"}` : "none yet"}</span>
      </th>
      {MACROS.map((m) => (
        <Cell key={m.key} value={w?.average[m.key] ?? null} target={w?.average_target[m.key] !== undefined ? amount(w.average_target[m.key]!, "") : null} on={w?.on_target[m.key]} unit="" judged />
      ))}
      <td className="num">
        <span className="macro-cell">
          {w?.fiber_status === "in range" ? <OnMark /> : null}
          <b>{w?.average.fiber_g === undefined ? "—" : amount(w.average.fiber_g, "")}</b>
        </span>
        {w?.average_target.fiber_min_g !== undefined ? <span className="cell-note">of {whole.format(w.average_target.fiber_min_g)}–{whole.format(w.average_target.fiber_max_g!)}</span> : null}
      </td>
    </tr>
  );
}

export function MacrosWeek({ macros, className }: { macros: MacroView; className?: string }) {
  if (!macros.current && !macros.this_week.some((d) => d.targets)) return null;
  const rows = [...macros.this_week].reverse();
  return (
    <Card
      icon={CalendarRange}
      color={colorOf("kcal_eaten")}
      title="This week"
      subtitle="each day against its targets"
      className={className}
      flush
      footer={<span><Check className="on-mark" size={13} strokeWidth={2.75} aria-hidden /> within 5% on calories, 10% on the rest, or in the fiber range. Today and incomplete days are not counted in the averages.</span>}
    >
      <div className="table-scroll">
        <table className="table macros-week">
          <thead>
            <tr>
              <th scope="col">Day</th>
              {MACROS.map((m) => (
                <Head key={m.key} label={m.label} short={m.short} unit={m.unit} />
              ))}
              <Head label="Fiber" short="Fib" unit=" g" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const food = hasFood(d) ? d : null;
              const judged = !!food && !food.partial && !food.incomplete;
              const why = d.partial ? "so far" : food?.incomplete ? "incomplete, not counted" : null;
              return (
                <tr key={d.date}>
                  <th scope="row">
                    {d.date === macros.today ? "Today" : weekday(d.date)}
                    <span className="cell-note">{why ?? (d.date === macros.today ? short(d.date) : dayLabel(d.date, macros.today))}</span>
                  </th>
                  {MACROS.map((m) => (
                    <Cell key={m.key} value={food?.actual[m.key] ?? null} target={d.targets ? amount(d.targets[m.key], "") : null} on={food?.on_target[m.key]} unit="" judged={judged} />
                  ))}
                  <td className="num">
                    <span className="macro-cell">
                      {judged && food?.fiber_status === "in range" ? <OnMark /> : null}
                      <b>{food?.actual.fiber_g == null ? "—" : amount(food.actual.fiber_g, "")}</b>
                    </span>
                    {d.targets ? <span className="cell-note">of {whole.format(d.targets.fiber_min_g)}–{whole.format(d.targets.fiber_max_g)}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <AverageRow label="Average" w={macros.week_average} />
            <AverageRow label="Last week" w={macros.last_week_average} />
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ---------- the check-ins ----------

/** "−1.5 lb/wk". */
const rate = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} lb/wk`;

export function TargetHistory({ history, className }: { history: MacroTargets[]; className?: string }) {
  if (!history.length) {
    return (
      <Card icon={History} color={colorOf("kcal_eaten")} title="Target check-ins" subtitle="your targets over time" className={className}>
        <Empty>No targets yet. Send your food app's check-in to your chatbot and they will show here.</Empty>
      </Card>
    );
  }
  const rows = [...history].reverse();
  const change = (now: number, before: number | undefined, unit: string) =>
    before === undefined || before === now ? null : `${now > before ? "+" : "−"}${amount(Math.abs(now - before), unit)}`;
  return (
    <Card
      icon={History}
      color={colorOf("kcal_eaten")}
      title="Target check-ins"
      subtitle="your targets over time"
      className={className}
      flush
      footer={<span>{history.length} {history.length === 1 ? "check-in" : "check-ins"}. Each one holds until the next. They are marked on the weight chart.</span>}
    >
      <div className="table-scroll">
        <table className="table targets">
          <thead>
            <tr>
              <th scope="col">Check-in</th>
              {MACROS.map((m) => (
                <Head key={m.key} label={m.label} short={m.short} unit={m.unit} />
              ))}
              <Head label="Fiber" short="Fib" unit=" g" className="num wide-only" />
              <th scope="col" className="num wide-only">Trend weight</th>
              <th scope="col" className="num wide-only">Goal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const before = rows[i + 1];
              return (
                <tr key={t.id}>
                  <th scope="row">
                    {longDay(t.effective_date)}
                    {t.note ? <span className="cell-note target-note">{t.note}</span> : null}
                  </th>
                  {MACROS.map((m) => {
                    const c = change(t[m.key], before?.[m.key], "");
                    return (
                      <td key={m.key} className="num">
                        <b>{amount(t[m.key], "")}</b>
                        {c ? <span className="cell-note">{c}</span> : null}
                      </td>
                    );
                  })}
                  <td className="num wide-only">{whole.format(t.fiber_min_g)}–{whole.format(t.fiber_max_g)}</td>
                  <td className="num wide-only">{t.trend_weight_lb === null ? <span className="faint">—</span> : `${t.trend_weight_lb.toFixed(1)} lb`}</td>
                  <td className="num wide-only">
                    {t.goal_weight_lb === null && t.goal_rate_lb_per_week === null ? (
                      <span className="faint">—</span>
                    ) : (
                      <>
                        <b>{t.goal_weight_lb !== null ? `${t.goal_weight_lb.toFixed(1)} lb` : rate(t.goal_rate_lb_per_week!)}</b>
                        <span className="cell-note">
                          {[t.goal_weight_lb !== null && t.goal_rate_lb_per_week !== null ? rate(t.goal_rate_lb_per_week) : null, t.start_weight_lb !== null ? `from ${t.start_weight_lb.toFixed(1)}` : null, t.goal]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
