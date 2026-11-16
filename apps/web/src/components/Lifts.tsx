// How each lift has gone, as a table: one row per lift he has logged with a weight, most
// recently done first. A row is the lift, the latest heaviest set ("285 lb × 8"), the best,
// the change in weight since the first time, how many days, and a small line of the heaviest
// set each day. Pressing a row lists the days.
//
// It answers "am I improving" at a glance. Ten show; the rest are one press away.

import { Fragment, useState } from "react";
import { Trophy } from "lucide-react";
import type { LiftProgress } from "@health/core";
import { Card, Delta, Empty, Spark } from "./ui";
import { dayLabel, longDay } from "../lib/measures";
import { weightText } from "../lib/lifts";
import { CARD_COLOR } from "../lib/colors";

const FIRST = 10;
const setText = (p: { weight_lb: number; reps: number | null }) => `${weightText(p.weight_lb)}${p.reps !== null ? ` × ${p.reps}` : ""}`;

export function Lifts({ lifts, today, className }: { lifts: LiftProgress[]; today: string; className?: string }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (!lifts.length) {
    return (
      <Card icon={Trophy} color={CARD_COLOR.lifts} title="Lifts" className={className}>
        <Empty>Each lift you log with your coach will get a row here.</Empty>
      </Card>
    );
  }
  const shown = all ? lifts : lifts.slice(0, FIRST);
  return (
    <Card
      icon={Trophy}
      color={CARD_COLOR.lifts}
      title="Lifts"
      subtitle="heaviest set each day, most recent first"
      className={className}
      flush
      footer={
        lifts.length > FIRST && !all ? (
          <button type="button" className="text-button" onClick={() => setAll(true)}>
            Show all {lifts.length} lifts
          </button>
        ) : (
          <span>{lifts.length} lifts</span>
        )
      }
    >
      <table className="table lifts-table">
        <thead>
          <tr>
            <th scope="col">Lift</th>
            <th scope="col" className="num">Latest</th>
            <th scope="col" className="num wide-only">Best</th>
            <th scope="col" className="num">Since first</th>
            <th scope="col" className="num wide-only">Days</th>
            <th scope="col" className="trend-col">Trend</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => {
            const first = l.points[0]!;
            const latest = l.points[l.points.length - 1]!;
            const best = l.points.reduce((a, p) => (p.weight_lb > a.weight_lb || (p.weight_lb === a.weight_lb && (p.reps ?? 0) > (a.reps ?? 0)) ? p : a), first);
            const diff = latest.weight_lb - first.weight_lb;
            const isOpen = open === l.lift;
            return (
              <Fragment key={l.lift}>
                <tr className={isOpen ? "open" : undefined}>
                  <th scope="row">
                    <button type="button" className="row-button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.lift)}>
                      {l.lift}
                    </button>
                    <span className="cell-note">{dayLabel(latest.date, today)}</span>
                  </th>
                  <td className="num"><b>{setText(latest)}</b></td>
                  <td className="num wide-only">{setText(best)}</td>
                  <td className="num">
                    {l.points.length > 1 ? <Delta text={diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${weightText(Math.abs(diff))}`} tone={diff > 0 ? "good" : diff < 0 ? "bad" : "neutral"} chip arrow={diff !== 0} /> : <span className="faint">first time</span>}
                  </td>
                  <td className="num wide-only">{l.points.length}</td>
                  <td className="trend-col">
                    <Spark values={l.points.map((p) => p.weight_lb)} label={`${l.lift}, heaviest set each day`} color={CARD_COLOR.lifts} />
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="detail-row">
                    <td colSpan={6}>
                      <ul className="lift-days">
                        {[...l.points].reverse().map((p) => (
                          <li key={p.date}>
                            <span>{longDay(p.date)}</span>
                            <b>{setText(p)}</b>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
