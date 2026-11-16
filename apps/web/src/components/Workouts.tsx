// The workouts Apple Health recorded in the range, newest first: what it was, how long and how
// far, and the day. This is the record of what happened; sets he logs with his coach are in
// "Lifts".

import { useState, type CSSProperties } from "react";
import { Bike, Dumbbell, Footprints, Mountain, Timer, Trophy, Watch, type LucideIcon } from "lucide-react";
import type { Workout } from "@health/core";
import { Card, Empty } from "./ui";
import { activityName, dayLabel, workoutFacts } from "../lib/measures";
import { CARD_COLOR } from "../lib/colors";

const FIRST = 8;
/** Each kind of workout's icon and colour (rides blue, lifting green, basketball amber, walks and hikes teal). */
const COLORS: Record<string, string> = {
  cycling: "var(--m-ride)", basketball: "var(--m-ball)", walking: "var(--m-steps)", hiking: "var(--m-steps)", running: "var(--m-steps)",
  traditionalStrengthTraining: "var(--m-lifting)", functionalStrengthTraining: "var(--m-lifting)", highIntensityIntervalTraining: "var(--m-active)",
};
const ICONS: Record<string, LucideIcon> = {
  cycling: Bike, walking: Footprints, running: Footprints, hiking: Mountain, basketball: Trophy,
  traditionalStrengthTraining: Dumbbell, functionalStrengthTraining: Dumbbell, highIntensityIntervalTraining: Timer,
};

export function Workouts({ workouts, today, className }: { workouts: Workout[]; today: string; className?: string }) {
  const [all, setAll] = useState(false);
  if (!workouts.length) {
    return (
      <Card icon={Watch} color={CARD_COLOR.workouts} title="Workouts" className={className}>
        <Empty>Workouts your watch records will be listed here.</Empty>
      </Card>
    );
  }
  const newest = [...workouts].reverse();
  return (
    <Card
      icon={Watch}
      color={CARD_COLOR.workouts}
      title="Workouts"
      subtitle="recorded by Apple Health"
      className={className}
      flush
      footer={
        newest.length > FIRST && !all ? (
          <button type="button" className="text-button" onClick={() => setAll(true)}>
            Show all {newest.length} workouts
          </button>
        ) : (
          <span>{newest.length} {newest.length === 1 ? "workout" : "workouts"}</span>
        )
      }
    >
      <ul className="rows">
        {(all ? newest : newest.slice(0, FIRST)).map((w) => {
          const Icon = ICONS[w.activity_type] ?? Watch;
          return (
            <li key={w.id}>
              <span className="row-icon" style={{ "--tone": COLORS[w.activity_type] ?? "var(--c4)" } as CSSProperties}><Icon size={16} strokeWidth={2} aria-hidden /></span>
              <span className="row-main">{activityName(w.activity_type)}</span>
              <span className="row-facts">{workoutFacts(w)}</span>
              <span className="row-when">{dayLabel(w.local_date, today)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
