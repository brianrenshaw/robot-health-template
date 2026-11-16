// The analysis cards.
//
// Trends: plain sentences the site works out from the record (packages/core/src/insights.ts).
// They state what happened and judge nothing.
//
// Coach: the program ring (sessions finished out of all of them) beside the coach's latest
// written review: what his chatbot wrote when he asked it to review a stretch, saved with its
// save_review tool. The site has no AI in it; this is how written analysis gets here. The text
// is shown as written: paragraphs, and lines starting "- " as a list. Never treated as HTML.

import { Sparkles, TrendingUp } from "lucide-react";
import type { ProgramProgress, Review, Trend } from "@health/core";
import type { CoachBrief } from "@health/core";
import { Card, Ring, Weeks } from "./ui";
import { CARD_COLOR } from "../lib/colors";
import { dayLabel } from "../lib/measures";

export function Trends({ trends, className }: { trends: Trend[]; className?: string }) {
  if (!trends.length) return null;
  return (
    <Card icon={TrendingUp} color={CARD_COLOR.trends} title="Trends" subtitle="worked out from your record" className={className}>
      <ul className="trends">
        {trends.map((t) => (
          <li key={t.key}>{t.text}</li>
        ))}
      </ul>
    </Card>
  );
}

const shortDay = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

export function Coach({ program, brief, review, today, className }: { program: ProgramProgress | null; brief: CoachBrief; review: Review | null; today: string; className?: string }) {
  const toGo = program ? program.total - program.finished - program.skipped : 0;
  const week = brief.next?.week ?? brief.cycle?.week ?? null;
  return (
    <Card
      icon={Sparkles}
      color={CARD_COLOR.coach}
      title="Coach"
      subtitle="your lifting program, and your coach's latest review"
      className={className}
      footer={
        <>
          <span>{program ? `${program.name}${week ? ` · week ${week} of ${program.weeks}` : ""}` : "No program loaded"}</span>
          {review ? (
            <span className="foot-right">
              Review of {shortDay(review.from_date)} to {shortDay(review.to_date)} · written {dayLabel(review.created_at.slice(0, 10), today)}
            </span>
          ) : null}
        </>
      }
    >
      <div className="coach">
        {program ? (
          <div className="coach-ring">
            <Ring done={program.finished} skipped={program.skipped} total={program.total} big={String(program.finished)} small={`of ${program.total} workouts done`} />
            <ul className="ring-legend">
              <li><span className="chart-key box" style={{ background: "var(--tone)" }} />{program.finished} finished</li>
              {program.skipped ? <li><span className="chart-key box" style={{ background: "var(--ring-skip)" }} />{program.skipped} skipped</li> : null}
              <li><span className="chart-key box" style={{ background: "var(--ring-track)" }} />{toGo} to go</li>
            </ul>
          </div>
        ) : null}
        <div className="coach-review">
          {review ? (
            <Prose text={review.body} />
          ) : (
            <div className="coach-empty">
              <h3>{brief.next ? `Next up: ${brief.next.name}` : program ? "Every workout is done" : "No program yet"}</h3>
              <p>
                The ring counts the lifting workouts in your program that you've finished. Ask your coach to review your week, and
                the review will appear here.
              </p>
            </div>
          )}
          {program ? <Weeks weeks={program.by_week} current={week} /> : null}
        </div>
      </div>
    </Card>
  );
}

/** Paragraphs and "- " lists, nothing else. The text is the coach's; it is never treated as HTML. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="prose">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim());
        const items = lines.filter((l) => /^[-•*]\s+/.test(l));
        if (items.length && items.length === lines.length) {
          return (
            <ul key={i}>
              {items.map((l, j) => (
                <li key={j}>{l.replace(/^[-•*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.join(" ")}</p>;
      })}
    </div>
  );
}
