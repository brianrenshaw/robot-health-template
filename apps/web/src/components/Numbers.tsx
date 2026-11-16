// "Your numbers": every headline number in one table, in place of a wall of tiles. A row is the
// measure, where it stands, its change against the stretch before, and a small line of the
// range. Pressing a row's name opens the page with its chart.
//
// A change is coloured only where the better direction does not depend on his goals (series.ts
// `tone`): more steps or training, a lower resting heart rate. Food and weight stay ink.

import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import type { Kpi } from "../lib/series";
import { Card, Delta, Spark } from "./ui";
import { rangeWords } from "./Charts";
import { CARD_COLOR, colorOf } from "../lib/colors";

/** Which page each number's chart is on. */
export const PAGE_OF: Record<string, string> = {
  kcal_eaten: "/food", protein_g: "/food", carbs_g: "/food", fat_g: "/food", fiber_g: "/food",
  weight_lb: "/body", resting_hr: "/body", vo2max: "/body",
  steps: "/activity", active_kcal: "/activity",
  lift_days: "/training", rides: "/activity",
};

export function Numbers({ kpis, range, className }: { kpis: Kpi[]; range: number; className?: string }) {
  if (!kpis.length) return null;
  return (
    <Card icon={ListChecks} color={CARD_COLOR.numbers} title="Your numbers" subtitle={`${rangeWords(range)}, against the stretch before`} className={className} flush>
      <table className="table numbers">
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col" className="num">Now</th>
            <th scope="col" className="num">Change</th>
            <th scope="col" className="trend-col">Trend</th>
          </tr>
        </thead>
        <tbody>
          {kpis.map((k) => (
            <tr key={k.key}>
              <th scope="row">
                <span className="measure">
                  <span className="measure-dot" style={{ background: colorOf(k.key) }} aria-hidden />
                  <Link to={PAGE_OF[k.key] ?? "/"}>{k.label}</Link>
                </span>
              </th>
              <td className="num">
                <b>{k.value}</b>
                <span className="cell-note">{k.note}</span>
              </td>
              <td className="num">{k.delta && k.delta !== "no change" ? <Delta text={k.delta} tone={k.tone} chip /> : <span className="faint">—</span>}</td>
              <td className="trend-col">
                <Spark values={k.spark} label={`${k.label} across ${rangeWords(range)}`} color={colorOf(k.key)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
