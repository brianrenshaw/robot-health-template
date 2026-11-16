// The week ahead: today and the six days after it, each with what he planned and when, what is
// fixed (basketball on Thursdays), whether he rode, and the forecast.
//
// He plans the whole week through his chatbot ("AM lift, afternoon hike", 2026-11-16) and wants
// "an outlook: if it's a lifting day, knowing what is coming up". So a lifting day shows the
// session that falls there (worked out in turn from the sessions still owed, coach.ts
// planItems), with how many lifts and about how long. Each kind of activity keeps one colour
// and icon. The page only shows the plan; he changes it by telling his chatbot.
//
// Class names are prefixed (plan-*, tag-*): a bare "fixed" is Tailwind's position: fixed, which
// once pinned "Basketball" to the bottom of the screen.

import type { CSSProperties } from "react";
import {
  Activity, BedDouble, Bike, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Dumbbell, Footprints, Moon, Mountain,
  PersonStanding, Sparkle, Sun, Volleyball, Waves, type LucideIcon,
} from "lucide-react";
import type { CoachBrief } from "@health/core";
import { Card } from "./ui";
import { CARD_COLOR } from "../lib/colors";

/** A picture for the forecast words, with its colour: sun amber, rain blue, cloud and fog grey. */
function sky(summary: string | undefined | null): { icon: LucideIcon; color: string } | null {
  if (!summary) return null;
  const s = summary.toLowerCase();
  if (/thunder|storm/.test(s)) return { icon: CloudLightning, color: "var(--m-vo2)" };
  if (/snow|sleet|flurr/.test(s)) return { icon: CloudSnow, color: "var(--m-ride)" };
  if (/rain|shower|drizzle/.test(s)) return { icon: CloudRain, color: "var(--m-ride)" };
  if (/fog|haze|mist/.test(s)) return { icon: CloudFog, color: "var(--faint)" };
  if (/tonight/.test(s) && /clear/.test(s)) return { icon: Moon, color: "var(--m-vo2)" };
  if (/partly|mostly cloudy|then sunny/.test(s)) return { icon: CloudSun, color: "var(--m-ball)" };
  if (/cloud|overcast/.test(s)) return { icon: Cloud, color: "var(--faint)" };
  if (/sun|clear/.test(s)) return { icon: Sun, color: "var(--m-ball)" };
  return null;
}

/** Each kind of activity: its name, icon and colour, the same everywhere. */
const KINDS: Record<string, { name: string; icon: LucideIcon; color: string }> = {
  lift: { name: "Lift", icon: Dumbbell, color: "var(--m-lifting)" },
  bike: { name: "Ride", icon: Bike, color: "var(--m-ride)" },
  hike: { name: "Hike", icon: Mountain, color: "var(--m-steps)" },
  walk: { name: "Walk", icon: Footprints, color: "var(--m-steps)" },
  run: { name: "Run", icon: Footprints, color: "var(--m-active)" },
  basketball: { name: "Basketball", icon: Volleyball, color: "var(--m-ball)" },
  swim: { name: "Swim", icon: Waves, color: "var(--m-ride)" },
  yoga: { name: "Yoga", icon: PersonStanding, color: "var(--m-protein)" },
  mobility: { name: "Mobility", icon: Activity, color: "var(--m-protein)" },
  rest: { name: "Rest", icon: BedDouble, color: "var(--c4)" },
  other: { name: "Other", icon: Sparkle, color: "var(--c4)" },
};
const WHEN: Record<string, string> = { morning: "Morning", midday: "Midday", afternoon: "Afternoon", evening: "Evening", anytime: "" };

type PlanEntry = CoachBrief["days_ahead"][number]["plan"][number] & { fixed: boolean };

export function WeekAhead({ brief, place, className }: { brief: CoachBrief; place: string; className?: string }) {
  const days = brief.days_ahead;
  if (!days.length) return null;
  const hasWeather = days.some((d) => d.forecast);
  const lifting = days.flatMap((d) => d.plan).filter((p) => p.activity === "lift").length;
  const planned = days.reduce((a, d) => a + d.plan.length, 0);
  return (
    <Card
      icon={CloudSun}
      color={CARD_COLOR.week}
      title="Week ahead"
      subtitle={hasWeather ? `your plan and the forecast for ${place}` : "your plan"}
      className={className}
      footer={
        <span>
          {planned
            ? `${planned} planned${lifting ? ` · ${lifting} lifting ${lifting === 1 ? "day" : "days"}` : ""}${brief.week.rides_done ? ` · ${brief.week.rides_done} ${brief.week.rides_done === 1 ? "ride" : "rides"} so far` : ""}`
            : "Tell your coach what you'll do each day, like “lift Monday morning, hike Tuesday afternoon”"}
        </span>
      }
      flush
    >
      <ul className="plan-week">
        {days.map((d, i) => {
          const f = d.forecast;
          const temp = f?.high_f ?? f?.low_f ?? null;
          const pic = sky(f?.summary);
          const items: PlanEntry[] = [
            ...d.plan.map((p) => ({ ...p, fixed: false })),
            ...d.fixtures
              .filter((x) => !d.plan.some((p) => p.activity === x))
              .map((x) => ({ when: "anytime" as const, activity: x as PlanEntry["activity"], detail: null, session: null, fixed: true })),
          ];
          return (
            <li key={d.date} className={i === 0 ? "today" : undefined}>
              <span className="plan-day">
                <b>{i === 0 ? "Today" : d.weekday.slice(0, 3)}</b>
                <span>{Number(d.date.slice(8))}</span>
              </span>
              <span className="plan-items">
                {items.length || d.rode ? null : <span className="plan-free">Nothing planned</span>}
                {d.rode && !items.some((x) => x.activity === "bike") ? <PlanLine activity="bike" title="Rode" sub="from Apple Health" /> : null}
                {items.map((p, k) => (
                  <PlanLine
                    key={k}
                    activity={p.activity}
                    when={WHEN[p.when]}
                    title={p.session ?? KINDS[p.activity]?.name ?? p.activity}
                    sub={
                      p.session
                        ? [p.session_week ? `week ${p.session_week}` : null, p.lifts ? `${p.lifts} lifts` : null, p.minutes ? `about ${p.minutes} min` : null].filter(Boolean).join(" · ")
                        : p.fixed
                          ? "every week"
                          : (p.detail ?? (p.activity === "bike" && d.rode ? "done" : ""))
                    }
                  />
                ))}
              </span>
              <span className="plan-sky">
                {pic ? <pic.icon size={17} strokeWidth={2} style={{ color: pic.color }} aria-hidden /> : null}
                <span className="plan-sky-words">{f?.summary?.replace(/^(Tonight|This Afternoon|Today): /, "") ?? ""}</span>
                {f?.rain_pct !== null && f?.rain_pct !== undefined && f.rain_pct >= 20 ? <span className="plan-rain">{f.rain_pct}%</span> : null}
                <b className="plan-temp">{temp !== null ? `${temp}°` : ""}</b>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PlanLine({ activity, title, sub, when }: { activity: string; title: string; sub?: string; when?: string }) {
  const kind = KINDS[activity] ?? KINDS.other!;
  return (
    <span className="plan-line" style={{ "--tone": kind.color } as CSSProperties}>
      <span className="plan-icon" aria-hidden>
        <kind.icon size={15} strokeWidth={2} />
      </span>
      <span className="plan-text">
        <span className="plan-title">
          {title}
          {when ? <span className="plan-when">{when}</span> : null}
        </span>
        {sub ? <span className="plan-sub">{sub}</span> : null}
      </span>
    </span>
  );
}
