// The pieces every page is built from. Read with the design notes at the top of styles.css.
//
//   Card     a white card on a soft shadow: a header row (an icon on a tile of the card's
//            colour, the title, "· what it shows", actions on the right), a body, and an
//            optional footer strip. One card is one idea.
//   Metric   a card's headline: a small label, the big number, its change as a chip beside it.
//   Delta    a change, with an arrow; green or red only when its tone is known (series.ts).
//   Ring     the progress ring, in the card's colour, on a tint of it.
//   Weeks    a strip of the program's weeks, each filled as far as it is done.
//   Toggle   a pair of icon buttons in a card header (chart or table).
//   Spark    a small line for a table row, in the measure's colour.
//   Empty    one quiet line where a card has nothing yet.

import { useId, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

/** Sets --tone on an element, which the card's icon tile, ring and charts take their colour from. */
const toneStyle = (color?: string): CSSProperties | undefined => (color ? ({ "--tone": color } as CSSProperties) : undefined);

export function Card({
  icon: Icon, color, title, subtitle, actions, footer, children, className, flush,
}: {
  icon?: LucideIcon;
  /** The card's colour: its icon tile, and whatever in it is drawn in the card's colour. */
  color?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The body has no padding of its own (a table that runs edge to edge). */
  flush?: boolean;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ""}`} style={toneStyle(color)}>
      <header className="card-head">
        <h2 className="card-title">
          {Icon ? (
            <span className="card-icon" aria-hidden>
              <Icon size={16} strokeWidth={2} />
            </span>
          ) : null}
          <span>{title}</span>
          {subtitle ? <span className="card-subtitle">{subtitle}</span> : null}
        </h2>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </header>
      <div className={flush ? "card-body flush" : "card-body"}>{children}</div>
      {footer ? <footer className="card-foot">{footer}</footer> : null}
    </section>
  );
}

export type Tone = "good" | "bad" | "neutral";

export function Delta({ text, tone = "neutral", chip = false, arrow = true }: { text: string | null; tone?: Tone; chip?: boolean; arrow?: boolean }) {
  if (!text) return null;
  const Arrow = /^\+/.test(text) ? ArrowUpRight : /^[−-]/.test(text) ? ArrowDownRight : Minus;
  return (
    <span className={`delta ${tone}${chip ? " chip" : ""}`}>
      {arrow ? <Arrow size={chip ? 14 : 13} strokeWidth={2.25} aria-hidden /> : null}
      {text}
    </span>
  );
}

export function Metric({ label, value, delta, tone, note }: { label: string; value: string; delta?: string | null; tone?: Tone; note?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-line">
        <span className="metric-value">{value}</span>
        {delta && delta !== "no change" ? <Delta text={delta} tone={tone} chip /> : null}
        {note ? <span className="metric-note">{note}</span> : null}
      </div>
    </div>
  );
}

export function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; icon: LucideIcon; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="toggle" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} aria-label={o.label} title={o.label} onClick={() => onChange(o.value)}>
          <o.icon size={15} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/**
 * A progress ring: the finished part in the card's colour (a gradient of it), the skipped part
 * in grey, the rest a tint of the colour. With nothing done yet a small cap marks where it starts.
 * The number in the middle and the line under it say the same thing in words.
 */
export function Ring({ done, skipped = 0, total, big, small }: { done: number; skipped?: number; total: number; big: string; small: string }) {
  const id = useId().replace(/:/g, "");
  const r = 70;
  const c = 2 * Math.PI * r;
  const part = (n: number) => (total ? (n / total) * c : 0);
  return (
    <div className="progress-ring">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={`${big} ${small}`}>
        <defs>
          <linearGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--tone)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="var(--tone)" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="90" cy="90" r={r} />
        {skipped ? (
          <circle className="ring-skipped" cx="90" cy="90" r={r} strokeDasharray={`${part(skipped)} ${c}`} strokeDashoffset={-part(done)} transform="rotate(-90 90 90)" />
        ) : null}
        {done ? (
          <circle className="ring-done" cx="90" cy="90" r={r} stroke={`url(#ring-${id})`} strokeDasharray={`${part(done)} ${c}`} transform="rotate(-90 90 90)" />
        ) : (
          <circle className="ring-start" cx="90" cy={90 - r} r="7" />
        )}
      </svg>
      <div className="ring-center">
        <span className="ring-big">{big}</span>
        <span className="ring-small">{small}</span>
      </div>
    </div>
  );
}

/** The program's weeks as a strip: each filled as far as its sessions are done; the current one marked. */
export function Weeks({ weeks, current }: { weeks: { done: number; of: number }[]; current: number | null }) {
  if (!weeks.length) return null;
  return (
    <div className="weeks">
      <ol className="weeks-strip" aria-label="Weeks of the program">
        {weeks.map((w, i) => (
          <li key={i} className={current === i + 1 ? "now" : undefined} aria-label={`Week ${i + 1}: ${w.done} of ${w.of} done`}>
            <span className="weeks-fill" style={{ width: `${w.of ? (w.done / w.of) * 100 : 0}%` }} />
          </li>
        ))}
      </ol>
      <div className="weeks-scale" aria-hidden>
        <span>Week 1</span>
        {current ? <span className="weeks-now">You're in week {current}</span> : null}
        <span>Week {weeks.length}</span>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A small line of a dozen values, for a table row, in the measure's colour with a soft fill. */
export function Spark({ values, label, color }: { values: (number | null)[]; label: string; color?: string }) {
  const id = useId().replace(/:/g, "");
  const have = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (have.length < 2) return <span className="spark" />;
  const lo = Math.min(...have.map((p) => p.v));
  const hi = Math.max(...have.map((p) => p.v));
  const W = 96;
  const H = 30;
  const x = (i: number) => 3 + (i / Math.max(values.length - 1, 1)) * (W - 6);
  const y = (v: number) => (hi === lo ? H / 2 : 4 + (1 - (v - lo) / (hi - lo)) * (H - 8));
  const last = have[have.length - 1]!;
  const line = have.map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(last.i).toFixed(1)} ${H} L${x(have[0]!.i).toFixed(1)} ${H} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={toneStyle(color)}>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tone)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--tone)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path className="spark-line" d={line} />
      <circle className="spark-dot" cx={x(last.i)} cy={y(last.v)} r={2.75} />
    </svg>
  );
}
