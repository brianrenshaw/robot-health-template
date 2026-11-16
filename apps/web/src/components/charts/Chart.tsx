// The charts. Two kinds, both drawn as plain SVG sized to the card they sit in:
//   LineChart  one or two lines over time (weight, resting heart rate), with optional raw dots
//   BarChart   one bar per day, week or month (calories, steps), or stacked bars (training)
//
// Built to the dataviz rules this project follows:
// - thin marks: 2px lines, bars at most 24px wide with a rounded top and a square foot;
// - a 2px gap of the card colour between stacked parts; a ring of it around dots;
// - hairline, solid gridlines and clean round axis values; nothing dashed;
// - one y axis, never two; bars start at zero, lines fit their own range;
// - text is always ink, never the data colour;
// - hover, touch and the arrow keys all pick the nearest day or bar and show its values;
// - every chart has a table of the same numbers behind "Table" (ChartCard).
// Colours are the --series-* and chart tokens in styles.css, validated for colour blindness.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartLine, Table2, type LucideIcon } from "lucide-react";
import { axisFormat, niceTicks } from "../../lib/scale";
import { Card, Metric, Toggle, type Tone } from "../ui";
import { daysBetween } from "../../lib/measures";

const H_DEFAULT = 240; // the whole drawing, axis labels included
const M = { top: 12, right: 8, bottom: 28, left: 44 };

/**
 * The room the chart has to draw in, kept current as the card resizes. The drawing is placed
 * over its box (not in the flow), so a chart can grow to fill a card made tall by the card
 * beside it, and shrink again, without the drawing itself holding the box open.
 */
function useSize(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size.w, size.h];
}

interface TipRow {
  /** The colour key beside the row: a CSS colour, or none for a single series. */
  color?: string;
  label: string;
  value: string;
}
interface Tip {
  x: number;
  title: string;
  rows: TipRow[];
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 70), Math.max(width - 70, 70));
  return (
    <div className="chart-tip" style={{ left }} role="status">
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="chart-tip-row">
          {r.color ? <span className="chart-key" style={{ background: r.color }} /> : null}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function YAxis({ ticks, y, width, format }: { ticks: number[]; y: (v: number) => number; width: number; format: (n: number) => string }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
          <text className="chart-tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

const shortDate = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const longDate = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

// ---------- line ----------

export interface LineSeries {
  name: string;
  points: { day: string; value: number }[];
  /** "line" joins the points; "dots" draws them faintly, for raw readings behind an average. */
  kind: "line" | "dots";
  color: string;
}

/** A day marked on a line chart with a dashed rule (a check-in from his food app on the weight chart), with what to say about it on hover. */
export interface ChartMark {
  day: string;
  name: string;
  value: string;
}

export function LineChart({ series, from, to, format, label, height = H_DEFAULT, marks = [], goal }: { series: LineSeries[]; from: string; to: string; format: (n: number) => string; label: string; height?: number; marks?: ChartMark[]; goal?: { value: number; label: string } | null }) {
  const [ref, width, boxH] = useSize();
  const H = Math.max(height, boxH);
  const gid = useId().replace(/:/g, "");
  const [picked, setPicked] = useState<string | null>(null);
  const all = series.flatMap((s) => s.points).filter((p) => p.day >= from && p.day <= to);
  const shownMarks = marks.filter((m) => m.day >= from && m.day <= to);
  const days = [...new Set([...all.map((p) => p.day), ...shownMarks.map((m) => m.day)])].sort();
  const values = all.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const span = Math.max(daysBetween(from, to), 1);
  const x = (day: string) => M.left + (daysBetween(from, day) / span) * (width - M.left - M.right);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * (H - M.top - M.bottom);
  const path = (points: LineSeries["points"]) =>
    points.filter((p) => p.day >= from && p.day <= to).map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  // Four or five dates along the bottom, evenly spaced.
  const tickCount = width < 420 ? 3 : 5;
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.round((span * i) / (tickCount - 1)));
    return d.toISOString().slice(0, 10);
  });

  const pickAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || !days.length) return;
    const at = clientX - box.left;
    setPicked(days.reduce((best, d) => (Math.abs(x(d) - at) < Math.abs(x(best) - at) ? d : best), days[0]!));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = picked ? days.indexOf(picked) : days.length - 1;
    setPicked(days[Math.min(Math.max(i + (e.key === "ArrowLeft" ? -1 : 1), 0), days.length - 1)] ?? null);
  };
  const tip: Tip | null =
    picked && width
      ? {
          x: x(picked),
          title: longDate(picked),
          rows: [
            ...series.flatMap((s) => {
              const p = s.points.find((q) => q.day === picked);
              return p ? [{ color: series.length > 1 ? s.color : undefined, label: s.name, value: format(p.value) }] : [];
            }),
            ...shownMarks.filter((m) => m.day === picked).map((m) => ({ label: m.name, value: m.value })),
          ],
        }
      : null;

  return (
    <div className="chart" ref={ref} style={{ minHeight: height }}>
      {width ? (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => pickAt(e.clientX)}
          onPointerDown={(e) => pickAt(e.clientX)}
          onPointerLeave={() => setPicked(null)}
          onBlur={() => setPicked(null)}
          onKeyDown={onKey}
        >
          <YAxis ticks={ticks} y={y} width={width} format={axisFormat(ticks)} />
          {xTicks.map((d, i) => (
            <text key={d} className="chart-tick" x={x(d)} y={H - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
              {shortDate(d)}
            </text>
          ))}
          {/* A soft fill under the main line, fading to nothing at the foot. */}
          {series.filter((s) => s.kind === "line").slice(0, 1).map((s) => {
            const pts = s.points.filter((p) => p.day >= from && p.day <= to);
            if (pts.length < 2) return null;
            const d = `${path(s.points)} L${x(pts.at(-1)!.day).toFixed(1)} ${H - M.bottom} L${x(pts[0]!.day).toFixed(1)} ${H - M.bottom} Z`;
            return (
              <g key="area">
                <defs>
                  <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={d} fill={`url(#area-${gid})`} />
              </g>
            );
          })}
          {/* The goal, as a quiet dashed line with its words, only when it sits inside the axis:
              stretching the axis down to a far-off goal would flatten the line he is watching. */}
          {goal && goal.value >= lo && goal.value <= hi ? (
            <g className="chart-goal">
              <line x1={M.left} x2={width - M.right} y1={y(goal.value)} y2={y(goal.value)} />
              <text x={width - M.right} y={y(goal.value) - 5} textAnchor="end">
                {goal.label}
              </text>
            </g>
          ) : null}
          {shownMarks.map((m) => (
            <line key={`mark-${m.day}`} className="chart-mark" x1={x(m.day)} x2={x(m.day)} y1={M.top} y2={H - M.bottom} />
          ))}
          {picked ? <line className="chart-cross" x1={x(picked)} x2={x(picked)} y1={M.top} y2={H - M.bottom} /> : null}
          {series.map((s) =>
            s.kind === "dots" ? (
              <g key={s.name}>
                {s.points.filter((p) => p.day >= from && p.day <= to).map((p) => (
                  <circle key={p.day} className="chart-raw" cx={x(p.day)} cy={y(p.value)} r={2.5} style={{ fill: s.color }} />
                ))}
              </g>
            ) : (
              <path key={s.name} className="chart-line" d={path(s.points)} style={{ stroke: s.color }} />
            ),
          )}
          {/* The end of each line, and the picked day, get a dot with a ring of the card colour. */}
          {series.filter((s) => s.kind === "line").map((s) => {
            const p = (picked && s.points.find((q) => q.day === picked)) || s.points.filter((q) => q.day <= to).at(-1);
            return p ? <circle key={s.name} className="chart-dot" cx={x(p.day)} cy={y(p.value)} r={4} style={{ fill: s.color }} /> : null;
          })}
        </svg>
      ) : null}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------- bars ----------

export interface BarPart {
  key: string;
  label: string;
  color: string;
}
export interface Bar {
  /** What the bar is called in the tooltip ("Nov 3 to 9") and on the axis ("Nov 3"). */
  label: string;
  axis: string;
  /** One value per part. A single-series chart has one part. Null means no data. */
  values: (number | null)[];
}

export function BarChart({ bars, parts, format, label, height = H_DEFAULT }: { bars: Bar[]; parts: BarPart[]; format: (n: number) => string; label: string; height?: number }) {
  const [ref, width, boxH] = useSize();
  const H = Math.max(height, boxH);
  const gid = useId().replace(/:/g, "");
  const [picked, setPicked] = useState<number | null>(null);
  const totals = bars.map((b) => b.values.reduce<number>((sum, v) => sum + (v ?? 0), 0));
  const ticks = niceTicks(0, Math.max(...totals, 1), 4);
  const hi = ticks[ticks.length - 1]!;
  const plotW = width - M.left - M.right;
  const band = plotW / Math.max(bars.length, 1);
  const barW = Math.max(Math.min(band * 0.72, 40), 1);
  const y = (v: number) => M.top + (1 - v / (hi || 1)) * (H - M.top - M.bottom);
  const base = y(0);
  const cx = (i: number) => M.left + band * (i + 0.5);
  const every = Math.max(1, Math.ceil(bars.length / (width < 420 ? 4 : 7))); // label every nth bar so they never collide

  const pickAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.floor((clientX - box.left - M.left) / band);
    setPicked(i >= 0 && i < bars.length ? i : null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = picked ?? bars.length - 1;
    setPicked(Math.min(Math.max(i + (e.key === "ArrowLeft" ? -1 : 1), 0), bars.length - 1));
  };
  const pickedBar = picked !== null ? bars[picked] : null;
  const tip: Tip | null =
    pickedBar && width
      ? {
          x: cx(picked!),
          title: pickedBar.label,
          rows: pickedBar.values.every((v) => v === null)
            ? [{ label: "nothing recorded", value: "" }]
            : parts.flatMap((p, k) => (pickedBar.values[k] ? [{ color: parts.length > 1 ? p.color : undefined, label: p.label, value: format(pickedBar.values[k]!) }] : [])),
        }
      : null;

  return (
    <div className="chart" ref={ref} style={{ minHeight: height }}>
      {width ? (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => pickAt(e.clientX)}
          onPointerDown={(e) => pickAt(e.clientX)}
          onPointerLeave={() => setPicked(null)}
          onBlur={() => setPicked(null)}
          onKeyDown={onKey}
        >
          <defs>
            {parts.map((p, k) => (
              <linearGradient key={p.key} id={`bar-${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.color} />
                <stop offset="100%" stopColor={p.color} stopOpacity="0.62" />
              </linearGradient>
            ))}
          </defs>
          <YAxis ticks={ticks} y={y} width={width} format={axisFormat(ticks)} />
          {bars.map((b, i) => {
            let top = base;
            return (
              <g key={i} className={picked === i ? "chart-bar picked" : "chart-bar"}>
                {parts.map((p, k) => {
                  const v = b.values[k];
                  if (!v) return null;
                  const h = base - y(v);
                  const gap = top === base ? 0 : 2; // a 2px gap of the card colour between stacked parts
                  const y1 = top - h;
                  top = y1;
                  const isTop = b.values.slice(k + 1).every((later) => !later);
                  const r = isTop ? Math.min(4, barW / 2, Math.max(h - gap, 0)) : 0;
                  const hh = Math.max(h - gap, 1);
                  // Rounded at the data end, square at the foot.
                  const d = `M${cx(i) - barW / 2} ${y1 + hh} V${y1 + r} Q${cx(i) - barW / 2} ${y1} ${cx(i) - barW / 2 + r} ${y1} H${cx(i) + barW / 2 - r} Q${cx(i) + barW / 2} ${y1} ${cx(i) + barW / 2} ${y1 + r} V${y1 + hh} Z`;
                  return <path key={p.key} d={d} fill={`url(#bar-${gid}-${k})`} />;
                })}
              </g>
            );
          })}
          <line className="chart-axis" x1={M.left} x2={width - M.right} y1={base} y2={base} />
          {bars.map((b, i) =>
            i % every === 0 ? (
              <text key={i} className="chart-tick" x={cx(i)} y={H - 6} textAnchor="middle">
                {b.axis}
              </text>
            ) : null,
          )}
        </svg>
      ) : null}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---------- the card around a chart ----------

/**
 * A chart's card: its name and what it shows in the header, with a switch between the chart and
 * a table of the same numbers (so nothing is readable only by hovering); the headline number and
 * its change; a legend when there is more than one series; and a footer line.
 */
export function ChartCard({
  icon, color, title, subtitle, metric, legend, table, footer, children, className,
}: {
  icon?: LucideIcon;
  color?: string;
  title: string;
  subtitle?: string;
  metric?: { label: string; value: string; delta?: string | null; tone?: Tone; note?: string };
  legend?: { label: string; color: string; kind: "line" | "box" | "dot" | "rule" }[];
  table: { columns: string[]; rows: string[][] };
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  useEffect(() => setView("chart"), [title]);
  return (
    <Card
      icon={icon}
      color={color}
      title={title}
      subtitle={subtitle}
      className={className}
      footer={footer}
      actions={
        <Toggle
          label={`Show ${title} as`}
          value={view}
          onChange={setView}
          options={[
            { value: "chart", icon: ChartLine, label: "Chart" },
            { value: "table", icon: Table2, label: "Table" },
          ]}
        />
      }
    >
      {metric ? <Metric {...metric} /> : null}
      {legend && view === "chart" ? (
        <ul className="chart-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className={`chart-key ${l.kind}`} style={l.kind === "rule" ? { borderColor: l.color } : { background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {view === "table" ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
