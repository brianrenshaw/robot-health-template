// The lifting session that is up next: what to do at the gym.
//
// At rest it is the session's name and one row per lift: the lift, sets x reps, and the weight
// to aim for today (or, once he has logged it through his chatbot, what he did, with a check).
// Pressing a lift opens it in place: why that weight, what he did last time, how hard, how long
// to rest, the program's cues, the substitutions, and the link to the how-to video.
//
// Sessions take turns, so nothing here says "today" or "late": it is simply what is next.
// One line under the name speaks up only when it matters: a rest day, basketball, a session
// already done today, a deload week.

import { useState } from "react";
import { Check, ChevronDown, CirclePlay, Dumbbell } from "lucide-react";
import type { CoachBrief, ExerciseBrief, SetBrief } from "@health/core";
import { Card, Empty } from "./ui";
import { dayLabel } from "../lib/measures";
import { setsLine, weightText } from "../lib/lifts";
import { CARD_COLOR } from "../lib/colors";

export function NextLift({ brief, className }: { brief: CoachBrief; className?: string }) {
  const next = brief.next;
  if (!next) {
    return (
      <Card icon={Dumbbell} color={CARD_COLOR.next} title="Up next" className={className}>
        <Empty>{brief.program ? "Every session of the program is done." : "No lifting program is loaded yet."}</Empty>
      </Card>
    );
  }
  const notes = [
    next.in_progress ? "The rest of a session you started." : brief.lifted_today ? "You lifted today. This is next." : null,
    brief.rest_day_today ? "Rest day today. This is next." : null,
    brief.week.today_is.length ? `${capital(brief.week.today_is.join(" and "))} today.` : null,
    next.week_note ? capital(next.week_note.toLowerCase().replace(/!+$/, ".")) : null,
  ].filter(Boolean);
  const pace = brief.cycle?.week === next.week && brief.cycle.day ? `day ${brief.cycle.day} of about ${brief.cycle.of_days}` : null;
  const minutes = next.in_progress ? next.est_minutes_left : next.exercises.reduce((a, e) => a + e.est_minutes, 0);
  const done = next.exercises.filter((e) => e.logged.length).length;

  return (
    <Card
      icon={Dumbbell}
      color={CARD_COLOR.next}
      title="Up next"
      subtitle="the next session of your program"
      className={className}
      footer={
        <>
          <span>
            {next.exercises.length} lifts · about {minutes} min{next.in_progress ? " left" : ""}
          </span>
          {done ? <span className="foot-right">{done} of {next.exercises.length} logged</span> : null}
        </>
      }
    >
      <h3 className="session-name">{next.name}</h3>
      <p className="session-meta">{[`Week ${next.week}`, `session ${next.position} of ${next.sessions_in_week}`, pace].filter(Boolean).join(" · ")}</p>
      {notes.map((line) => (
        <p key={line} className="session-note">
          {line}
        </p>
      ))}
      <div className="lifts">
        {next.exercises.map((e, i) => (
          <Lift key={e.prescribed} lift={e} n={i + 1} today={brief.today} />
        ))}
      </div>
    </Card>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Lift({ lift: e, n, today }: { lift: ExerciseBrief; n: number; today: string }) {
  const [open, setOpen] = useState(false);
  const panel = `lift-${e.prescribed.replace(/\W+/g, "-")}`;
  const done = e.logged.length > 0;
  return (
    <div className={`lift${open ? " open" : ""}${done ? " done" : ""}`}>
      <button type="button" className="lift-row" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <span className="lift-name">
          <span className={done ? "lift-n done" : "lift-n"} aria-hidden={!done}>
            {done ? <Check size={13} strokeWidth={3} aria-label="Logged" /> : n}
          </span>
          {e.name}
        </span>
        <span className="lift-scheme">
          {e.working_sets} × {e.reps}
        </span>
        <span className={e.suggestion.weight_lb === null && !done ? "lift-target first" : "lift-target"}>
          {done ? setsLine(e.logged) : e.suggestion.weight_lb !== null ? weightText(e.suggestion.weight_lb) : e.working_sets ? "first time" : ""}
        </span>
        <ChevronDown className="lift-chevron" size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="collapse" id={panel} aria-hidden={!open}>
        <div className="collapse-inner">
          <div className="lift-detail">
            <p className="lift-aim">{e.suggestion.text}</p>
            {e.last_time ? (
              <p>
                Last time, {dayLabel(e.last_time.date, today)}: <b>{setsLine(e.last_time.sets as SetBrief[])}</b>
              </p>
            ) : null}
            <p className="lift-facts">
              {[
                e.warmup_sets && e.warmup_sets !== "0" ? `Warm-up sets ${e.warmup_sets}` : null,
                e.early_rpe ? `RPE ${e.early_rpe.replace("~", "")}${e.last_rpe ? `, last set ${e.last_rpe.replace("~", "")}` : ""}` : null,
                e.rest && e.rest !== "N/A" ? `Rest ${e.rest.replace("~", "")}` : null,
                `about ${e.est_minutes} min`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {e.technique ? <p>Last set: {e.technique}</p> : null}
            {e.notes ? <p className="lift-notes">{e.notes}</p> : null}
            {e.swapped ? <p>In place of {e.prescribed}.</p> : e.substitutions.length ? <p>Or: {e.substitutions.join(", ")}</p> : null}
            {e.video_url ? (
              <a className="button-link" href={e.video_url} target="_blank" rel="noreferrer">
                <CirclePlay size={16} strokeWidth={1.75} aria-hidden />
                Watch how to do it
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
