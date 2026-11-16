// coach.ts
// The coach's side of the record: the lifting program, what the owner actually lifted, the plan for
// each week, and his journal. His chatbot is the coach; this file gives it the facts and keeps
// what he tells it.
//
// How it fits together (his words, 2026-11-15):
// - The program is a full-body lifting program. Its "week" is five sessions, which he spreads
//   over about 10 days (`programs.cycle_days`). So sessions TAKE TURNS: the next session is
//   always the first one, in program order, that he has not finished. A missed day changes
//   nothing.
// - "On Thursdays, I play basketball" (`weekly_fixtures`).
// - "When I'm starting my week: how many days do I plan to bike?" (`week_plans`, weeks start on
//   Monday). Rides themselves come from Apple Health (`workouts`, activity_type cycling).
// - Notes for the day and how he is feeling go in `journal_entries`, in his words.
// - Progressive overload is the point: for every lift the briefing gives what he did last time
//   on that lift and a suggested weight for today (`suggest`).
// - He swaps lifts often, "based on what's available at my gym". A swap is standing
//   (`exercise_swaps`): wherever the program prescribes X he does Y, and his history and
//   suggestion follow Y. A one-day change is just logged as what he did.
// - Each exercise carries the program's how-to video link, to open at the gym.
// - "If I don't follow it day to day to a T, that can be okay, but I do want to get all the
//   workouts in unless I explicitly say I'm not doing this." So: every session stays owed until
//   he finishes it or explicitly skips it (`skipSession`); he may do any owed session out of
//   order (the ones passed over stay first in line); and a session may be split over days: it
//   simply stays in progress until he says it is done. Each lift carries a rough time
//   (`est_minutes`) so "I have 30 minutes" can be answered.
// - He chooses his bike days (`planned_days`); the forecast (weather.ts) is shown beside them.
//
// The program's text is copyrighted. It is loaded into the database by scripts/import-program.ts
// and is never committed to the repository.

import { z } from "zod";
import { InputError, recordAudit, type Ctx } from "./audit";
import type { Db } from "./db";
import { addDays, dayString, listWorkouts, todayInTz, type Workout } from "./health";
import type { ForecastDay } from "./weather";

// ---------- what is stored ----------

export interface Program {
  id: string;
  name: string;
  notes: string | null;
  cycle_days: number;
  created_at: string;
  archived_at: string | null;
}
export interface ProgramSession {
  id: string;
  program_id: string;
  seq: number;
  week: number;
  position: number;
  name: string;
  block: string | null;
  week_note: string | null;
  rest_after: 0 | 1;
}
export interface ProgramExercise {
  id: string;
  session_id: string;
  position: number;
  name: string;
  technique: string | null;
  warmup_sets: string | null;
  working_sets: number | null;
  reps: string | null;
  early_rpe: string | null;
  last_rpe: string | null;
  rest: string | null;
  sub1: string | null;
  sub2: string | null;
  notes: string | null;
  video_url: string | null;
  sub1_video_url: string | null;
  sub2_video_url: string | null;
}
export interface ExerciseSwap {
  id: string;
  program_id: string;
  prescribed: string;
  use_instead: string;
  note: string | null;
  created_at: string;
  ended_at: string | null;
}
export interface LiftSession {
  id: string;
  date: string;
  program_session_id: string | null;
  notes: string | null;
  finished_at: string | null;
  /** Set when he explicitly said he is not doing this session. */
  skipped_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface LiftSet {
  id: string;
  lift_session_id: string;
  program_exercise_id: string | null;
  exercise: string;
  set_number: number;
  weight_lb: number | null;
  reps: number | null;
  rpe: number | null;
  note: string | null;
  /** The day the set was done (a session can be split over days). */
  date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface WeekPlan {
  week_start: string;
  bike_days: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}
export interface JournalEntry {
  id: string;
  date: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** The Monday of the week a day falls in. */
export const weekStart = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const id = () => crypto.randomUUID();

// ---------- loading a program ----------

const text = z.string().trim().max(4000).nullish();
export const programImportSchema = z.object({
  name: z.string().trim().min(1).max(200),
  notes: z.string().max(40000).nullish(),
  cycle_days: z.number().int().min(5).max(21).default(10),
  sessions: z
    .array(
      z.object({
        week: z.number().int().min(1).max(60),
        position: z.number().int().min(1).max(7),
        name: z.string().trim().min(1).max(120),
        block: text,
        week_note: text,
        rest_after: z.boolean().default(false),
        exercises: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(200),
              technique: text, warmup_sets: text, working_sets: z.number().int().min(0).max(20).nullish(), reps: text,
              early_rpe: text, last_rpe: text, rest: text, sub1: text, sub2: text, notes: text,
              video_url: z.url().max(500).nullish(), sub1_video_url: z.url().max(500).nullish(), sub2_video_url: z.url().max(500).nullish(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

/**
 * Load a lifting program and make it the active one. A program already active is archived, not
 * deleted: what he lifted on it stays. Sessions are numbered in the order given.
 */
export async function importProgram(ctx: Ctx, input: unknown, now = new Date()): Promise<{ program: Program; sessions: number; exercises: number }> {
  const data = programImportSchema.parse(input);
  const stamp = now.toISOString();
  for (const old of await ctx.db.all<Program>("SELECT * FROM programs WHERE archived_at IS NULL")) {
    await ctx.db.run("UPDATE programs SET archived_at = ? WHERE id = ?", [stamp, old.id]);
    await recordAudit(ctx, { table: "programs", rowId: old.id, before: old, after: { ...old, archived_at: stamp } });
  }
  const program: Program = { id: id(), name: data.name, notes: data.notes ?? null, cycle_days: data.cycle_days, created_at: stamp, archived_at: null };
  await ctx.db.run("INSERT INTO programs (id, name, notes, cycle_days, created_at) VALUES (?, ?, ?, ?, ?)", [
    program.id, program.name, program.notes, program.cycle_days, stamp,
  ]);
  let exercises = 0;
  for (const [i, s] of data.sessions.entries()) {
    const sessionId = id();
    await ctx.db.run(
      "INSERT INTO program_sessions (id, program_id, seq, week, position, name, block, week_note, rest_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [sessionId, program.id, i + 1, s.week, s.position, s.name, s.block ?? null, s.week_note ?? null, s.rest_after ? 1 : 0],
    );
    for (const [j, e] of s.exercises.entries()) {
      await ctx.db.run(
        `INSERT INTO program_exercises (id, session_id, position, name, technique, warmup_sets, working_sets, reps, early_rpe, last_rpe, rest, sub1, sub2, notes, video_url, sub1_video_url, sub2_video_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id(), sessionId, j + 1, e.name, e.technique ?? null, e.warmup_sets ?? null, e.working_sets ?? null, e.reps ?? null,
          e.early_rpe ?? null, e.last_rpe ?? null, e.rest ?? null, e.sub1 ?? null, e.sub2 ?? null, e.notes ?? null,
          e.video_url ?? null, e.sub1_video_url ?? null, e.sub2_video_url ?? null,
        ],
      );
      exercises++;
    }
  }
  await recordAudit(ctx, { table: "programs", rowId: program.id, before: null, after: { ...program, notes: program.notes ? `(${program.notes.length} characters)` : null } });
  return { program, sessions: data.sessions.length, exercises };
}

export async function activeProgram(db: Db): Promise<Program | null> {
  return db.first<Program>("SELECT * FROM programs WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1");
}

// ---------- where he is in the program ----------

type SessionLift = LiftSession & { name: string; week: number; position: number; seq: number; rest_after: 0 | 1 };

interface Position {
  program: Program;
  /** The sessions he still owes, in program order: not finished and not skipped. */
  owed: ProgramSession[];
  /** Lift sessions started and not finished, the one touched most recently first. */
  open: SessionLift[];
  /** Finished sessions, in program order. */
  done: SessionLift[];
  /** Sessions he explicitly skipped, in program order. */
  skipped: SessionLift[];
}

async function position(db: Db): Promise<Position | null> {
  const program = await activeProgram(db);
  if (!program) return null;
  const sessions = await db.all<ProgramSession>("SELECT * FROM program_sessions WHERE program_id = ? ORDER BY seq", [program.id]);
  const lifts = await db.all<SessionLift>(
    `SELECT l.*, s.name, s.week, s.position, s.seq, s.rest_after FROM lift_sessions l JOIN program_sessions s ON s.id = l.program_session_id
     WHERE s.program_id = ? AND l.deleted_at IS NULL ORDER BY s.seq, l.created_at`,
    [program.id],
  );
  const done = lifts.filter((l) => l.finished_at && !l.skipped_at);
  const skipped = lifts.filter((l) => l.skipped_at);
  const closed = new Set([...done, ...skipped].map((l) => l.program_session_id));
  return {
    program,
    owed: sessions.filter((x) => !closed.has(x.id)),
    open: lifts.filter((l) => !l.finished_at && !l.skipped_at && !closed.has(l.program_session_id)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    done,
    skipped,
  };
}

const sessionKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const sessionLabel = (x: { name: string; week: number }) => `${x.name} (week ${x.week})`;

/**
 * Which owed session is meant. With no name: the one in progress (the one touched last, if he
 * has more than one going), else the first one owed. With a name ("Full Body #4", "Arms & Weak
 * Points"): the first owed session of that name, so he can do one out of order. A name that
 * fits none is refused with what is owed next; nothing is guessed.
 */
function pickSession(pos: Position, name?: string, week?: number): ProgramSession | null {
  if (!name) {
    const going = pos.open[0];
    return (going && pos.owed.find((x) => x.id === going.program_session_id)) || pos.owed[0] || null;
  }
  const hit = pos.owed.find((x) => sessionKey(x.name) === sessionKey(name) && (week === undefined || x.week === week));
  if (!hit) {
    throw new InputError(
      `There is no session still to do called "${name}"${week === undefined ? "" : ` in week ${week}`}. Still to do, in order: ${pos.owed.slice(0, 6).map(sessionLabel).join("; ") || "nothing"}. Nothing was changed.`,
    );
  }
  return hit;
}

const exercisesOf = (db: Db, sessionId: string) =>
  db.all<ProgramExercise>("SELECT * FROM program_exercises WHERE session_id = ? ORDER BY position", [sessionId]);
const setsOf = (db: Db, liftSessionId: string) =>
  db.all<LiftSet>("SELECT * FROM lift_sets WHERE lift_session_id = ? AND deleted_at IS NULL ORDER BY created_at, exercise, set_number", [liftSessionId]);
/** The last day he worked on a lift session: the newest day among its sets. */
async function lastDayOf(db: Db, lift: LiftSession): Promise<string> {
  const row = await db.first<{ day: string | null }>("SELECT MAX(date) AS day FROM lift_sets WHERE lift_session_id = ? AND deleted_at IS NULL", [lift.id]);
  return row?.day ?? lift.date;
}

/** A name as it is compared: lower case, single spaces, and without a "Superset A1:" style prefix. */
const plain = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
const short = (name: string) => plain(name).replace(/^(superset\s+)?[a-z]\d:\s*/, "");

export interface SetBrief {
  set: number;
  weight_lb: number | null;
  reps: number | null;
  rpe: number | null;
  note?: string;
}
const setBrief = (s: LiftSet): SetBrief => ({ set: s.set_number, weight_lb: s.weight_lb, reps: s.reps, rpe: s.rpe, ...(s.note ? { note: s.note } : {}) });

/** The last time he did a lift (by its name) outside the session in progress: the day and the sets. */
async function lastTime(db: Db, lift: string, notSession: string | null): Promise<{ date: string; sets: SetBrief[] } | null> {
  const row = await db.first<{ lift_session_id: string; date: string }>(
    `SELECT st.lift_session_id, COALESCE(st.date, l.date) AS date FROM lift_sets st JOIN lift_sessions l ON l.id = st.lift_session_id
     WHERE st.deleted_at IS NULL AND l.deleted_at IS NULL AND l.id != ? AND lower(st.exercise) = lower(?)
     ORDER BY COALESCE(st.date, l.date) DESC, l.created_at DESC LIMIT 1`,
    [notSession ?? "", lift],
  );
  if (!row) return null;
  const sets = await db.all<LiftSet>(
    "SELECT * FROM lift_sets WHERE lift_session_id = ? AND deleted_at IS NULL AND lower(exercise) = lower(?) ORDER BY set_number",
    [row.lift_session_id, lift],
  );
  return { date: row.date, sets: sets.map(setBrief) };
}

/**
 * Roughly how long a lift takes, in minutes: each working set is about a minute of work plus
 * the program's rest (the middle of its range), and each warm-up set about a minute and a half.
 * It is only for answering "I have 30 minutes".
 */
export function estMinutes(e: { working_sets: number | null; rest: string | null; warmup_sets: string | null }): number {
  const numbers = (text: string | null) => (text ?? "").match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  const rest = numbers(e.rest);
  const restMinutes = rest.length ? (Math.min(...rest) + Math.max(...rest)) / 2 : 1.5;
  const warmups = numbers(e.warmup_sets);
  return Math.round((e.working_sets ?? 3) * (restMinutes + 1) + (warmups.length ? Math.max(...warmups) : 0) * 1.5);
}

/** The standing swaps of a program: prescribed name (lower case) to what he does instead. */
async function swapsOf(db: Db, programId: string): Promise<Map<string, ExerciseSwap>> {
  const rows = await db.all<ExerciseSwap>("SELECT * FROM exercise_swaps WHERE program_id = ? AND ended_at IS NULL", [programId]);
  return new Map(rows.map((r) => [plain(r.prescribed), r]));
}

/** The program's how-to video for a lift, wherever the program mentions it (as an exercise or as a substitution). */
async function videoFor(db: Db, programId: string, lift: string): Promise<string | null> {
  const row = await db.first<{ url: string | null }>(
    `SELECT CASE WHEN lower(e.name) = lower(?1) THEN e.video_url WHEN lower(e.sub1) = lower(?1) THEN e.sub1_video_url ELSE e.sub2_video_url END AS url
     FROM program_exercises e JOIN program_sessions s ON s.id = e.session_id
     WHERE s.program_id = ?2 AND (lower(e.name) = lower(?1) OR lower(e.sub1) = lower(?1) OR lower(e.sub2) = lower(?1))
     ORDER BY url IS NULL, s.seq LIMIT 1`,
    [lift, programId],
  );
  return row?.url ?? null;
}

// ---------- progressive overload ----------

const sayWeight = (lb: number) => `${Number.isInteger(lb) ? lb : lb.toFixed(1)} lb`;

/**
 * What to aim for today on a lift, from what he did last time. This is progressive overload as
 * most hypertrophy programs lay it out (the first owner's program handbook said it this way):
 * - "Adding reps": on a lift with a rep range, add a rep to at least one set each time; "only
 *   once you've maxed out the rep range you should add some weight and then reduce reps back
 *   down to the bottom of the range" (double progression).
 * - "Adding weight": on a lift with a fixed rep count, "keep the reps the same and try to add
 *   weight when you can, without sacrificing form."
 * - When neither is there: better form and control of the negative also count.
 */
export function suggest(
  e: { reps: string | null; early_rpe: string | null; last_rpe: string | null },
  last: { sets: SetBrief[] } | null,
  deload: boolean,
): { weight_lb: number | null; text: string } {
  const effort = e.early_rpe ? ` at about RPE ${e.early_rpe.replace("~", "")}` : "";
  if (!last || !last.sets.length) {
    return { weight_lb: null, text: `First time on this lift. Find a weight you can do for ${e.reps ?? "the prescribed"} reps${effort}, and that becomes the number to beat.` };
  }
  const weights = last.sets.map((s) => s.weight_lb).filter((w): w is number => w !== null);
  const reps = last.sets.map((s) => s.reps).filter((r): r is number => r !== null);
  const weight = weights.length ? Math.max(...weights) : null;
  const did = `${reps.join(", ")}${weight !== null ? ` at ${sayWeight(weight)}` : ""}`;
  if (deload) return { weight_lb: weight, text: `Semi-deload week: last time ${did}. Use that weight or a little less and stop well short of failure.` };

  const range = /^(\d+)(?:\s*-\s*(\d+))?$/.exec((e.reps ?? "").trim());
  if (!range || !reps.length) return { weight_lb: weight, text: `Last time ${did}. Match it and try to beat it by a rep.` };
  const bottom = Number(range[1]);
  const top = Number(range[2] ?? range[1]);
  const fixed = top === bottom;
  const same = weight !== null ? sayWeight(weight) : "the same load";
  if (reps.length === last.sets.length && reps.every((r) => r >= top)) {
    if (weight === null) return { weight_lb: null, text: `Last time ${did}, ${fixed ? `all ${top}s` : `the top of ${e.reps}`}. Add load if you can; if not, slow the negative and tighten the form.` };
    const step = weight >= 50 ? 5 : 2.5;
    const up = sayWeight(weight + step);
    return fixed
      ? { weight_lb: weight + step, text: `Last time ${did}. This lift stays at ${top} reps, so add weight when form allows: try about ${up} (the next step on that equipment).` }
      : { weight_lb: weight + step, text: `Last time ${did}, the top of ${e.reps} on every set. Go up to about ${up} (the next step on that equipment) and start again from ${bottom} reps.` };
  }
  return fixed
    ? { weight_lb: weight, text: `Last time ${did}. Stay at ${same} until every set is a clean ${top}, then add weight.` }
    : { weight_lb: weight, text: `Last time ${did}. Stay at ${same} and add a rep to at least one set, until every set reaches ${top}. If a rep will not come, cleaner form counts too.` };
}

// ---------- the briefing ----------

export interface ExerciseBrief {
  /** The lift he does for this slot: the prescribed exercise, or his standing swap for it. */
  name: string;
  /** The program's own name for the slot, when he has swapped it. Use THIS name in log_lift's `exercise`. */
  prescribed: string;
  swapped: boolean;
  /** The program's how-to video for the lift he does, when it has one. */
  video_url: string | null;
  technique: string | null;
  warmup_sets: string | null;
  working_sets: number | null;
  reps: string | null;
  early_rpe: string | null;
  last_rpe: string | null;
  rest: string | null;
  substitutions: string[];
  notes: string | null;
  /** Roughly how long the lift takes with its rests and warm-ups, in minutes. */
  est_minutes: number;
  /** The sets already logged for it in the session in progress. */
  logged: SetBrief[];
  /** What he did the last time he did this lift. */
  last_time: { date: string; sets: SetBrief[] } | null;
  /** What to aim for today (progressive overload). */
  suggestion: { weight_lb: number | null; text: string };
}

export interface CoachBrief {
  today: string;
  weekday: string;
  program: { name: string; cycle_days: number; notes?: string | null } | null;
  /**
   * The lifting session to do: the one in progress if he has one going, else the first one he
   * still owes (or the one asked for). Null when there is no program or nothing is owed.
   */
  next: {
    name: string;
    week: number;
    position: number;
    sessions_in_week: number;
    block: string | null;
    week_note: string | null;
    /** True when he has logged sets for it but not said he is finished. It can stay that way across days. */
    in_progress: boolean;
    /** Roughly how long the lifts not yet logged will take, in minutes. */
    est_minutes_left: number;
    exercises: ExerciseBrief[];
  } | null;
  /** The sessions he still owes, in order, so he can pick one out of turn. At most six. */
  queue: { name: string; week: number; status: "in progress" | "next" | "later" }[];
  /** How the program week he is in (five sessions over about ten days) is going. */
  cycle: { week: number; started: string | null; day: number | null; of_days: number; done: { name: string; date: string }[]; skipped: { name: string; reason: string | null }[] } | null;
  last_lift: { name: string; date: string; days_ago: number } | null;
  /** True when the program puts a mandatory rest day on today: he finished such a session yesterday. */
  rest_day_today: boolean;
  /** True when he has already logged sets today. */
  lifted_today: boolean;
  week: {
    week_start: string;
    bike_days_planned: number | null;
    /** The days he has chosen to bike this week. */
    bike_dates: string[];
    rides_done: number;
    note: string | null;
    fixtures: string[];
    today_is: string[];
  };
  /** Today and the six days after: the forecast, what he has planned, and what is fixed. */
  days_ahead: {
    date: string;
    weekday: string;
    forecast: Omit<ForecastDay, "date"> | null;
    /** The activities planned that day (as in `plan`), for a quick look. */
    planned: string[];
    /** Everything planned that day, in time order; a lifting day carries the session that falls there. */
    plan: Omit<PlanView, "date">[];
    fixtures: string[];
    rode: boolean;
  }[];
  /** Workouts Apple Health recorded in the last 10 days. */
  recent_workouts: Workout[];
  /** His notes and journal for the last 7 days, oldest first. */
  journal: { date: string; body: string }[];
}

export interface BriefOptions {
  includeProgramNotes?: boolean;
  /** Brief a different owed session than the one that is up ("show me Full Body #4"). */
  session?: string;
  week?: number;
  /** The forecast, from getForecast. Left out, the days ahead carry no weather. */
  forecast?: ForecastDay[];
}

/** Everything the coach needs to say what to do today. One call. */
export async function coachBrief(db: Db, now = new Date(), options: BriefOptions = {}): Promise<CoachBrief> {
  const today = todayInTz(now);
  const pos = await position(db);
  const monday = weekStart(today);

  let next: CoachBrief["next"] = null;
  let cycle: CoachBrief["cycle"] = null;
  const target = pos ? pickSession(pos, options.session, options.week) : null;
  if (pos && target) {
    const open = pos.open.find((o) => o.program_session_id === target.id) ?? null;
    const logged = open ? await setsOf(db, open.id) : [];
    const exercises: ExerciseBrief[] = [];
    const swaps = await swapsOf(db, pos.program.id);
    const deload = /deload/i.test(target.week_note ?? "");
    for (const e of await exercisesOf(db, target.id)) {
      const swap = swaps.get(plain(e.name));
      const lift = swap?.use_instead ?? e.name;
      const last = await lastTime(db, lift, open?.id ?? null);
      exercises.push({
        name: lift, prescribed: e.name, swapped: !!swap,
        video_url: swap ? await videoFor(db, pos.program.id, lift) : e.video_url,
        technique: e.technique, warmup_sets: e.warmup_sets, working_sets: e.working_sets, reps: e.reps,
        early_rpe: e.early_rpe, last_rpe: e.last_rpe, rest: e.rest, substitutions: [e.sub1, e.sub2].filter((x): x is string => !!x), notes: e.notes,
        est_minutes: estMinutes(e),
        logged: logged.filter((x) => x.program_exercise_id === e.id).map(setBrief),
        last_time: last,
        suggestion: suggest(e, last, deload),
      });
    }
    const inWeek = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM program_sessions WHERE program_id = ? AND week = ?", [pos.program.id, target.week]);
    next = {
      name: target.name, week: target.week, position: target.position, sessions_in_week: inWeek?.n ?? 0,
      block: target.block, week_note: target.week_note, in_progress: logged.length > 0,
      est_minutes_left: exercises.filter((x) => !x.logged.length).reduce((sum, x) => sum + x.est_minutes, 0),
      exercises,
    };
  }
  if (pos?.owed.length) {
    const week = pos.owed[0]!.week;
    const doneThisWeek = [];
    for (const d of pos.done.filter((x) => x.week === week)) doneThisWeek.push({ name: d.name, date: await lastDayOf(db, d) });
    // The week began the first day he worked on any of its sessions, finished or not.
    const started = [...pos.done, ...pos.open].filter((x) => x.week === week).map((x) => x.date).sort()[0] ?? null;
    cycle = {
      week, started, day: started ? daysBetween(started, today) + 1 : null, of_days: pos.program.cycle_days,
      done: doneThisWeek,
      skipped: pos.skipped.filter((x) => x.week === week).map((x) => ({ name: x.name, reason: x.notes })),
    };
  }

  // The last session he finished, by the day he last worked on it.
  let last: { name: string; date: string; rest_after: 0 | 1 } | null = null;
  for (const d of pos?.done ?? []) {
    const date = await lastDayOf(db, d);
    if (!last || date >= last.date) last = { name: d.name, date, rest_after: d.rest_after };
  }
  const setsToday = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM lift_sets st JOIN lift_sessions l ON l.id = st.lift_session_id WHERE st.deleted_at IS NULL AND l.deleted_at IS NULL AND COALESCE(st.date, l.date) = ?",
    [today],
  );

  const plan = await db.first<WeekPlan>("SELECT * FROM week_plans WHERE week_start = ?", [monday]);
  const ahead = addDays(today, 6);
  const planned = await planItems(db, monday < today ? monday : today, addDays(monday, 6) > ahead ? addDays(monday, 6) : ahead, today);
  const workouts = await listWorkouts(db, addDays(today, -9), today);
  const rodeOn = new Set(workouts.filter((w) => w.activity_type === "cycling").map((w) => w.local_date));
  const fixtures = await db.all<{ weekday: number; activity: string }>("SELECT * FROM weekly_fixtures ORDER BY weekday");
  const journal = await db.all<JournalEntry>(
    "SELECT * FROM journal_entries WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, created_at",
    [addDays(today, -6), today],
  );
  const forecast = new Map((options.forecast ?? []).map((f) => [f.date, f]));
  const inWeek = (date: string) => date >= monday && date <= addDays(monday, 6);

  return {
    today,
    weekday: WEEKDAYS[weekdayOf(today)]!,
    program: pos ? { name: pos.program.name, cycle_days: pos.program.cycle_days, ...(options.includeProgramNotes ? { notes: pos.program.notes } : {}) } : null,
    next,
    queue: (pos?.owed ?? []).slice(0, 6).map((x, i) => ({
      name: x.name, week: x.week, status: pos!.open.some((o) => o.program_session_id === x.id) ? "in progress" : i === 0 ? "next" : "later",
    })),
    cycle,
    last_lift: last ? { name: last.name, date: last.date, days_ago: daysBetween(last.date, today) } : null,
    rest_day_today: !!last && last.rest_after === 1 && last.date === addDays(today, -1),
    lifted_today: (setsToday?.n ?? 0) > 0,
    week: {
      week_start: monday,
      bike_days_planned: plan?.bike_days ?? null,
      bike_dates: [...new Set(planned.filter((p) => p.activity === "bike" && inWeek(p.date)).map((p) => p.date))],
      rides_done: [...rodeOn].filter(inWeek).length,
      note: plan?.note ?? null,
      fixtures: fixtures.map((f) => `${f.activity} every ${WEEKDAYS[f.weekday]}`),
      today_is: fixtures.filter((f) => f.weekday === weekdayOf(today)).map((f) => f.activity),
    },
    days_ahead: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const f = forecast.get(date);
      return {
        date,
        weekday: WEEKDAYS[weekdayOf(date)]!,
        forecast: f ? { high_f: f.high_f, low_f: f.low_f, rain_pct: f.rain_pct, wind_mph: f.wind_mph, summary: f.summary } : null,
        planned: planned.filter((p) => p.date === date).map((p) => p.activity),
        plan: planned.filter((p) => p.date === date).map(({ date: _date, ...rest }) => rest),
        fixtures: fixtures.filter((x) => x.weekday === weekdayOf(date)).map((x) => x.activity),
        rode: rodeOn.has(date),
      };
    }),
    recent_workouts: workouts,
    journal: journal.map((j) => ({ date: j.date, body: j.body })),
  };
}

// ---------- logging what he lifted ----------

export const liftLogSchema = z.object({
  date: dayString.optional().describe("The day he did these sets, YYYY-MM-DD. Default: today"),
  session: z.string().trim().max(120).optional().describe("Only to log a session out of order: its name from coach_brief's queue, e.g. 'Full Body #4'. Leave out for the session that is up"),
  week: z.number().int().optional().describe("With `session`, which program week, when he means a later one"),
  sets: z
    .array(
      z.object({
        exercise: z.string().trim().min(1).max(200).describe("Which slot of the session this set is for: the `prescribed` name of the exercise exactly as coach_brief lists it in next.exercises"),
        did: z.string().trim().min(1).max(200).optional().describe("What he actually did, ONLY for a one-day change. Leave it out normally: the set is filed under his standing swap for that slot if he has one, else under the prescribed exercise"),
        set: z.number().int().min(1).max(20).describe("Which working set this is: 1, 2, 3 ... Warm-up sets are not logged"),
        weight_lb: z.number().min(0).max(2000).optional().describe("Weight in pounds. Leave out for bodyweight or when he did not say"),
        reps: z.number().min(0).max(200).optional().describe("Reps he got"),
        rpe: z.number().min(1).max(10).optional().describe("How hard it was, 1 to 10, only if he says"),
        note: z.string().trim().max(500).optional().describe("Anything he said about the set, in his words"),
      }),
    )
    .max(80)
    .default([]),
  finished: z.boolean().optional().describe("True ONLY when he says the session is done. Until then it stays in progress, across days if he splits it. Lifts with nothing logged are then left undone"),
  notes: z.string().trim().max(4000).optional().describe("Anything he said about the session as a whole, in his words"),
});

export interface LiftLogResult {
  session: string;
  date: string;
  sets_saved: number;
  finished: boolean;
  /** The lifts of the session with nothing logged yet, by the name he does them under. */
  not_logged_yet: string[];
  /** Roughly how long those will take, in minutes. */
  est_minutes_left: number;
  /** The session that is up after this, when this one was finished. */
  next: string | null;
}

/**
 * Log sets for the session that is up next in the program. Logging a set again (same exercise,
 * same set number) replaces it. An exercise that is not in the session is refused with the
 * session's exercise names, so a set never lands on a guess.
 */
export async function logLift(ctx: Ctx, input: unknown, now = new Date()): Promise<LiftLogResult> {
  const data = liftLogSchema.parse(input);
  const pos = await position(ctx.db);
  if (!pos) throw new InputError("There is no lifting program loaded yet. Nothing was saved.");
  const target = pickSession(pos, data.session, data.week);
  if (!target) throw new InputError("Every session of the program is finished. Nothing was saved.");
  const today = todayInTz(now);
  const date = data.date ?? today;
  if (date > today) throw new InputError(`${date} is in the future. Nothing was saved.`);
  const prescribed = await exercisesOf(ctx.db, target.id);

  // Match every set to a prescribed exercise before writing anything.
  const swaps = await swapsOf(ctx.db, pos.program.id);
  const matched = data.sets.map((s) => {
    const hits = prescribed.filter((e) => plain(e.name) === plain(s.exercise) || short(e.name) === short(s.exercise));
    if (hits.length !== 1) {
      throw new InputError(
        `"${s.exercise}" is not an exercise of ${sessionLabel(target)}. Its exercises are: ${prescribed.map((e) => e.name).join("; ")}. Use one of those names in \`exercise\`, and put what he actually did in \`did\`. Nothing was saved.`,
      );
    }
    return { ...s, slot: hits[0]!, did: s.did ?? swaps.get(plain(hits[0]!.name))?.use_instead ?? hits[0]!.name };
  });
  const keys = matched.map((m) => `${plain(m.did)} #${m.set}`);
  if (new Set(keys).size !== keys.length) throw new InputError("The same set is listed twice. Nothing was saved.");
  if (!matched.length && !data.finished && data.notes === undefined) throw new InputError("There is nothing to log. Nothing was saved.");
  const open = pos.open.find((o) => o.program_session_id === target.id) ?? null;
  if (data.finished && !matched.length && !(open && (await setsOf(ctx.db, open.id)).length)) {
    throw new InputError("No sets are logged for this session, so it cannot be marked finished. To leave it out altogether, skip it. Nothing was saved.");
  }

  const stamp = now.toISOString();
  let session: LiftSession | null = open;
  if (!session) {
    session = { id: id(), date, program_session_id: target.id, notes: null, finished_at: null, skipped_at: null, created_at: stamp, updated_at: stamp, deleted_at: null };
    await ctx.db.run("INSERT INTO lift_sessions (id, date, program_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      session.id, date, target.id, stamp, stamp,
    ]);
    await recordAudit(ctx, { table: "lift_sessions", rowId: session.id, before: null, after: session });
  }

  for (const m of matched) {
    const before = await ctx.db.first<LiftSet>("SELECT * FROM lift_sets WHERE lift_session_id = ? AND exercise = ? AND set_number = ?", [session.id, m.did, m.set]);
    const values = [m.slot.id, m.weight_lb ?? null, m.reps ?? null, m.rpe ?? null, m.note ?? null, date];
    if (before) {
      await ctx.db.run("UPDATE lift_sets SET program_exercise_id = ?, weight_lb = ?, reps = ?, rpe = ?, note = ?, date = ?, updated_at = ?, deleted_at = NULL WHERE id = ?", [...values, stamp, before.id]);
    } else {
      await ctx.db.run(
        "INSERT INTO lift_sets (id, lift_session_id, exercise, set_number, program_exercise_id, weight_lb, reps, rpe, note, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id(), session.id, m.did, m.set, ...values, stamp, stamp],
      );
    }
    const after = (await ctx.db.first<LiftSet>("SELECT * FROM lift_sets WHERE lift_session_id = ? AND exercise = ? AND set_number = ?", [session.id, m.did, m.set]))!;
    await recordAudit(ctx, { table: "lift_sets", rowId: after.id, before, after });
  }

  // Touch the session so the one he worked on last is the one that is "in progress" first.
  const before = (await ctx.db.first<LiftSession>("SELECT * FROM lift_sessions WHERE id = ?", [session.id]))!;
  await ctx.db.run("UPDATE lift_sessions SET notes = ?, finished_at = ?, updated_at = ? WHERE id = ?", [
    data.notes ?? before.notes, data.finished ? stamp : before.finished_at, stamp, session.id,
  ]);
  if (data.finished || data.notes !== undefined) {
    await recordAudit(ctx, { table: "lift_sessions", rowId: session.id, before, after: (await ctx.db.first<LiftSession>("SELECT * FROM lift_sessions WHERE id = ?", [session.id]))! });
  }

  const all = await setsOf(ctx.db, session.id);
  const loggedSlots = new Set(all.map((s) => s.program_exercise_id));
  const left = prescribed.filter((e) => !loggedSlots.has(e.id));
  const after = data.finished ? await position(ctx.db) : null;
  const upNext = after ? pickSession(after) : null;
  return {
    session: target.name,
    date,
    sets_saved: matched.length,
    finished: !!data.finished,
    not_logged_yet: left.map((e) => swaps.get(plain(e.name))?.use_instead ?? e.name),
    est_minutes_left: left.reduce((sum, e) => sum + estMinutes(e), 0),
    next: upNext ? sessionLabel(upNext) : null,
  };
}

// ---------- skipping a session ----------

export const skipSchema = z.object({
  session: z.string().trim().max(120).optional().describe("The session's name from coach_brief's queue. Leave out for the session that is up"),
  week: z.number().int().optional().describe("With `session`, which program week"),
  reason: z.string().trim().max(500).optional().describe("Why, in his words"),
});

/**
 * Mark a session as one he is not doing. Only ever on his explicit say-so: he wants every
 * session done otherwise. A session with sets already logged is finished, not skipped.
 */
export async function skipSession(ctx: Ctx, input: unknown, now = new Date()): Promise<{ skipped: string; next: string | null }> {
  const data = skipSchema.parse(input);
  const pos = await position(ctx.db);
  if (!pos) throw new InputError("There is no lifting program loaded yet. Nothing was changed.");
  const target = pickSession(pos, data.session, data.week);
  if (!target) throw new InputError("Every session of the program is finished. Nothing was changed.");
  const open = pos.open.find((o) => o.program_session_id === target.id) ?? null;
  if (open && (await setsOf(ctx.db, open.id)).length) {
    throw new InputError(`${sessionLabel(target)} already has sets logged. Say it is finished instead (log_lift with finished: true); the lifts not done are simply left. Nothing was changed.`);
  }
  const stamp = now.toISOString();
  if (open) {
    const row = (await ctx.db.first<LiftSession>("SELECT * FROM lift_sessions WHERE id = ?", [open.id]))!;
    await ctx.db.run("UPDATE lift_sessions SET skipped_at = ?, notes = ?, updated_at = ? WHERE id = ?", [stamp, data.reason ?? open.notes, stamp, open.id]);
    await recordAudit(ctx, { table: "lift_sessions", rowId: open.id, before: row, after: (await ctx.db.first<LiftSession>("SELECT * FROM lift_sessions WHERE id = ?", [open.id]))! });
  } else {
    const row: LiftSession = { id: id(), date: todayInTz(now), program_session_id: target.id, notes: data.reason ?? null, finished_at: null, skipped_at: stamp, created_at: stamp, updated_at: stamp, deleted_at: null };
    await ctx.db.run("INSERT INTO lift_sessions (id, date, program_session_id, notes, skipped_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      row.id, row.date, row.program_session_id, row.notes, stamp, stamp, stamp,
    ]);
    await recordAudit(ctx, { table: "lift_sessions", rowId: row.id, before: null, after: row });
  }
  const after = await position(ctx.db);
  const upNext = after ? pickSession(after) : null;
  return { skipped: sessionLabel(target), next: upNext ? sessionLabel(upNext) : null };
}

// ---------- swapping a lift ----------

export const swapSchema = z.object({
  exercise: z.string().trim().min(1).max(200).describe("The exercise as the program names it (the `prescribed` name in coach_brief), e.g. Hack Squat or Weak Point Exercise 1"),
  use_instead: z.string().trim().min(1).max(200).nullable().describe("The lift he will do instead from now on, named the way he says it or as one of the program's substitutions. null goes back to the program's own exercise"),
  note: z.string().trim().max(500).optional().describe("Why, in his words ('no hack squat at my gym')"),
});

/**
 * Make a standing swap: wherever the active program prescribes `exercise`, he does `use_instead`
 * from now on. His history and the suggested weight then follow the new lift. An exercise name
 * the program does not contain is refused, with the close matches, so nothing is swapped on a guess.
 */
export async function swapExercise(ctx: Ctx, input: unknown, now = new Date()): Promise<{ prescribed: string; use_instead: string | null; sessions_affected: number; video_url: string | null }> {
  const data = swapSchema.parse(input);
  const program = await activeProgram(ctx.db);
  if (!program) throw new InputError("There is no lifting program loaded yet. Nothing was changed.");
  const names = await ctx.db.all<{ name: string; n: number }>(
    "SELECT e.name, COUNT(*) AS n FROM program_exercises e JOIN program_sessions s ON s.id = e.session_id WHERE s.program_id = ? GROUP BY e.name",
    [program.id],
  );
  const hits = names.filter((n) => plain(n.name) === plain(data.exercise) || short(n.name) === short(data.exercise));
  if (hits.length !== 1) {
    const words = short(data.exercise).split(" ").filter((w) => w.length > 3);
    const close = names.filter((n) => words.some((w) => plain(n.name).includes(w))).map((n) => n.name);
    throw new InputError(
      `The program has ${hits.length ? "more than one exercise" : "no exercise"} named "${data.exercise}".${close.length ? ` Did he mean: ${close.slice(0, 8).join("; ")}?` : ""} Use the program's own name. Nothing was changed.`,
    );
  }
  const prescribed = hits[0]!.name;
  const stamp = now.toISOString();
  for (const old of await ctx.db.all<ExerciseSwap>("SELECT * FROM exercise_swaps WHERE program_id = ? AND lower(prescribed) = lower(?) AND ended_at IS NULL", [program.id, prescribed])) {
    await ctx.db.run("UPDATE exercise_swaps SET ended_at = ? WHERE id = ?", [stamp, old.id]);
    await recordAudit(ctx, { table: "exercise_swaps", rowId: old.id, before: old, after: { ...old, ended_at: stamp } });
  }
  if (data.use_instead !== null && plain(data.use_instead) !== plain(prescribed)) {
    const swap: ExerciseSwap = { id: id(), program_id: program.id, prescribed, use_instead: data.use_instead, note: data.note ?? null, created_at: stamp, ended_at: null };
    await ctx.db.run("INSERT INTO exercise_swaps (id, program_id, prescribed, use_instead, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      swap.id, swap.program_id, swap.prescribed, swap.use_instead, swap.note, swap.created_at,
    ]);
    await recordAudit(ctx, { table: "exercise_swaps", rowId: swap.id, before: null, after: swap });
    return { prescribed, use_instead: swap.use_instead, sessions_affected: hits[0]!.n, video_url: await videoFor(ctx.db, program.id, swap.use_instead) };
  }
  return { prescribed, use_instead: null, sessions_affected: hits[0]!.n, video_url: await videoFor(ctx.db, program.id, prescribed) };
}

// ---------- the week's plan and the journal ----------

export const SLOTS = ["morning", "midday", "afternoon", "evening", "anytime"] as const;
export const ACTIVITIES = ["lift", "bike", "hike", "walk", "run", "basketball", "swim", "yoga", "mobility", "rest", "other"] as const;
export type Slot = (typeof SLOTS)[number];
export type PlanActivity = (typeof ACTIVITIES)[number];

/** One thing planned on a day. */
export interface PlanItem {
  id: string;
  date: string;
  slot: Slot;
  activity: PlanActivity;
  detail: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** A planned item as the page and the chatbot see it: on a lifting day, the session that falls there. */
export interface PlanView {
  date: string;
  when: Slot;
  activity: PlanActivity;
  detail: string | null;
  /** On a lifting day from today on: the owed session that falls there, in turn ("Full Body #1"). */
  session: string | null;
  /** That session's program week, how many lifts it has, and roughly how long it takes. */
  session_week?: number;
  lifts?: number;
  minutes?: number;
}

const planDaySchema = z.object({
  date: dayString.describe("The day, YYYY-MM-DD"),
  items: z
    .array(
      z.object({
        when: z.enum(SLOTS).describe("Time of day: morning (AM), midday (lunch), afternoon, evening (PM), or anytime when he gave no time"),
        activity: z.enum(ACTIVITIES).describe("lift (his program's session), bike, hike, walk, run, basketball, swim, yoga, mobility, rest (a day off on purpose), other"),
        detail: z.string().trim().max(200).optional().describe("A few words he gave: a place, a distance, who with ('Riverside Park loop', '10 miles'). Never the lifting session's name: that is worked out"),
      }),
    )
    .max(8)
    .describe("Everything planned that day. This replaces the day's plan; [] clears the day"),
});

export const weekPlanSchema = z.object({
  week_of: dayString.optional().describe("Any day in the week being planned, YYYY-MM-DD. Default: this week. Weeks start on Monday"),
  days: z.array(planDaySchema).max(7).optional().describe("The plan for each day he talked about, each the whole list for that day. Days not sent are left as they are"),
  bike_dates: z.array(dayString).max(7).optional().describe("The days he has chosen to bike that week, YYYY-MM-DD each. This is the whole list for the week: a day left out is no longer planned. [] clears them"),
  bike_days: z.number().int().min(0).max(7).optional().describe("How many days he plans to bike that week, when he has given a number but not chosen the days. With bike_dates it is taken from the list"),
  note: z.string().trim().max(2000).optional().describe("Anything else about the week, in his words"),
});

export async function setWeekPlan(ctx: Ctx, input: unknown, now = new Date()): Promise<WeekPlan & { bike_dates: string[]; plan: PlanView[] }> {
  const data = weekPlanSchema.parse(input);
  if (data.bike_days === undefined && data.bike_dates === undefined && data.note === undefined && data.days === undefined) {
    throw new InputError("Send the days he planned, which days or how many days he plans to bike, or a note. Nothing was saved.");
  }
  const monday = weekStart(data.week_of ?? data.days?.[0]?.date ?? data.bike_dates?.[0] ?? todayInTz(now));
  const sunday = addDays(monday, 6);
  const dates = data.bike_dates ? [...new Set(data.bike_dates)].sort() : undefined;
  const outside = [...(dates ?? []), ...(data.days ?? []).map((d) => d.date)].find((d) => d < monday || d > sunday);
  if (outside) throw new InputError(`${outside} is not in the week of ${monday} (Monday to Sunday). Plan one week at a time. Nothing was saved.`);
  const dayDates = (data.days ?? []).map((d) => d.date);
  if (new Set(dayDates).size !== dayDates.length) throw new InputError("A day is listed twice. Send each day once, with everything planned on it. Nothing was saved.");
  const stamp = now.toISOString();

  // A day's whole plan: keep what is unchanged, take off what is no longer wanted, add what is new.
  const setDay = async (date: string, wanted: { slot: Slot; activity: PlanActivity; detail: string | null }[]) => {
    const existing = await ctx.db.all<PlanItem>("SELECT * FROM plan_items WHERE date = ? AND deleted_at IS NULL", [date]);
    const key = (x: { slot: string; activity: string; detail: string | null }) => `${x.slot}|${x.activity}|${(x.detail ?? "").toLowerCase()}`;
    const left = [...wanted];
    for (const row of existing) {
      const i = left.findIndex((w) => key(w) === key(row));
      if (i >= 0) {
        left.splice(i, 1);
        continue;
      }
      await ctx.db.run("UPDATE plan_items SET deleted_at = ? WHERE id = ?", [stamp, row.id]);
      await recordAudit(ctx, { table: "plan_items", rowId: row.id, before: row, after: { ...row, deleted_at: stamp } });
    }
    for (const w of left) {
      const row: PlanItem = { id: id(), date, slot: w.slot, activity: w.activity, detail: w.detail, created_at: stamp, deleted_at: null };
      await ctx.db.run("INSERT INTO plan_items (id, date, slot, activity, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)", [row.id, date, row.slot, row.activity, row.detail, stamp]);
      await recordAudit(ctx, { table: "plan_items", rowId: row.id, before: null, after: row });
    }
  };
  for (const day of data.days ?? []) await setDay(day.date, day.items.map((x) => ({ slot: x.when, activity: x.activity, detail: x.detail || null })));

  // bike_dates: the whole list of bike days for the week. A day left out loses its ride; a day
  // added gets one ("anytime"). Other plans on those days are left alone.
  if (dates) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      if (dayDates.includes(date)) continue;
      const items = await ctx.db.all<PlanItem>("SELECT * FROM plan_items WHERE date = ? AND deleted_at IS NULL", [date]);
      const hasBike = items.some((x) => x.activity === "bike");
      if (dates.includes(date) === hasBike) continue;
      const keep = items.filter((x) => x.activity !== "bike").map((x) => ({ slot: x.slot, activity: x.activity, detail: x.detail }));
      await setDay(date, dates.includes(date) ? [...keep, { slot: "anytime", activity: "bike", detail: null }] : keep);
    }
  }

  const before = await ctx.db.first<WeekPlan>("SELECT * FROM week_plans WHERE week_start = ?", [monday]);
  await ctx.db.run(
    `INSERT INTO week_plans (week_start, bike_days, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET bike_days = excluded.bike_days, note = excluded.note, updated_at = excluded.updated_at`,
    [monday, dates ? dates.length : (data.bike_days ?? before?.bike_days ?? null), data.note ?? before?.note ?? null, stamp, stamp],
  );
  const after = (await ctx.db.first<WeekPlan>("SELECT * FROM week_plans WHERE week_start = ?", [monday]))!;
  await recordAudit(ctx, { table: "week_plans", rowId: monday, before, after });
  const plan = await planItems(ctx.db, monday, sunday, todayInTz(now));
  return { ...after, bike_dates: [...new Set(plan.filter((p) => p.activity === "bike").map((p) => p.date))], plan };
}

const SLOT_ORDER: Record<Slot, number> = { morning: 0, midday: 1, afternoon: 2, anytime: 3, evening: 4 };

/**
 * What is planned between two days, in day and time order. Each lifting day from today on gets
 * the session that falls there: the sessions still owed, in turn (the one in progress first).
 * Nothing is stored about it, so it never goes stale when he lifts on another day or skips one.
 */
export async function planItems(db: Db, from: string, to: string, today: string): Promise<PlanView[]> {
  const rows = await db.all<PlanItem>("SELECT * FROM plan_items WHERE date >= ? AND date <= ? AND deleted_at IS NULL", [from, to]);
  rows.sort((a, b) => (a.date === b.date ? SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] : a.date < b.date ? -1 : 1));
  const pos = await position(db);
  const going = pos?.open[0];
  const owed = pos ? [...pos.owed] : [];
  if (going) {
    const i = owed.findIndex((x) => x.id === going.program_session_id);
    if (i > 0) owed.unshift(...owed.splice(i, 1));
  }
  // Lifting days before today are not assigned; count those still ahead from the first owed.
  let k = 0;
  const out: PlanView[] = [];
  for (const r of rows) {
    const s = r.activity === "lift" && r.date >= today ? owed[k++] : undefined;
    const view: PlanView = { date: r.date, when: r.slot, activity: r.activity, detail: r.detail, session: s?.name ?? null };
    if (s) {
      const exercises = await exercisesOf(db, s.id);
      Object.assign(view, { session_week: s.week, lifts: exercises.length, minutes: Math.round(exercises.reduce((a, e) => a + estMinutes(e), 0)) });
    }
    out.push(view);
  }
  return out;
}

export const journalSchema = z.object({
  date: dayString.optional().describe("The day the note is about, YYYY-MM-DD. Default: today"),
  text: z.string().trim().min(1).max(8000).describe("What he said, in his words. Do not summarize or tidy it"),
});

export async function addJournal(ctx: Ctx, input: unknown, now = new Date()): Promise<JournalEntry> {
  const data = journalSchema.parse(input);
  const today = todayInTz(now);
  const date = data.date ?? today;
  if (date > today) throw new InputError(`${date} is in the future. Nothing was saved.`);
  const entry: JournalEntry = { id: id(), date, body: data.text, created_at: now.toISOString(), deleted_at: null };
  await ctx.db.run("INSERT INTO journal_entries (id, date, body, created_at) VALUES (?, ?, ?, ?)", [entry.id, entry.date, entry.body, entry.created_at]);
  await recordAudit(ctx, { table: "journal_entries", rowId: entry.id, before: null, after: entry });
  return entry;
}

/** Journal entries between two dates (both included), oldest first. */
export async function listJournal(db: Db, from: string, to: string): Promise<JournalEntry[]> {
  return db.all<JournalEntry>("SELECT * FROM journal_entries WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY date, created_at", [from, to]);
}

export interface LiftView {
  /** The day the session was started. A set carries its own day when the session was split. */
  date: string;
  session: string | null;
  week: number | null;
  finished: boolean;
  skipped: boolean;
  notes: string | null;
  sets: ({ exercise: string; date: string } & SetBrief)[];
}

/** What he lifted between two dates (both included), oldest first, with every set. Skipped sessions are included, marked. */
export async function listLifts(db: Db, from: string, to: string): Promise<LiftView[]> {
  const sessions = await db.all<LiftSession & { name: string | null; week: number | null }>(
    `SELECT l.*, s.name, s.week FROM lift_sessions l LEFT JOIN program_sessions s ON s.id = l.program_session_id
     WHERE l.deleted_at IS NULL AND (l.date BETWEEN ?1 AND ?2 OR EXISTS (
       SELECT 1 FROM lift_sets st WHERE st.lift_session_id = l.id AND st.deleted_at IS NULL AND st.date BETWEEN ?1 AND ?2))
     ORDER BY l.date, l.created_at`,
    [from, to],
  );
  const out: LiftView[] = [];
  for (const l of sessions) {
    out.push({
      date: l.date, session: l.name, week: l.week, finished: !!l.finished_at, skipped: !!l.skipped_at, notes: l.notes,
      sets: (await setsOf(db, l.id)).map((s) => ({ exercise: s.exercise, date: s.date ?? l.date, ...setBrief(s) })),
    });
  }
  return out;
}

// ---------- the coach's written reviews ----------

export interface Review {
  id: string;
  from_date: string;
  to_date: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

export const reviewSchema = z.object({
  from: dayString.describe("The first day the review covers, YYYY-MM-DD"),
  to: dayString.describe("The last day the review covers, YYYY-MM-DD"),
  text: z.string().trim().min(1).max(6000).describe("The review as you gave it to him: short plain paragraphs, and lines starting with '- ' for a list. No headings, tables or other markdown"),
});

/** Keep a review the coach wrote, so the dashboard can show it. */
export async function saveReview(ctx: Ctx, input: unknown, now = new Date()): Promise<Review> {
  const data = reviewSchema.parse(input);
  if (data.from > data.to) throw new InputError("`from` is after `to`. Nothing was saved.");
  if (data.to > addDays(todayInTz(now), 1)) throw new InputError(`${data.to} is in the future. Nothing was saved.`);
  const review: Review = { id: id(), from_date: data.from, to_date: data.to, body: data.text, created_at: now.toISOString(), deleted_at: null };
  await ctx.db.run("INSERT INTO reviews (id, from_date, to_date, body, created_at) VALUES (?, ?, ?, ?, ?)", [review.id, review.from_date, review.to_date, review.body, review.created_at]);
  await recordAudit(ctx, { table: "reviews", rowId: review.id, before: null, after: review });
  return review;
}

/** The review written most recently, or null when there is none. */
export async function latestReview(db: Db): Promise<Review | null> {
  return db.first<Review>("SELECT * FROM reviews WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1");
}

/** Every day he logged lifting sets, from a day on, oldest first. */
export async function liftDays(db: Db, since: string): Promise<string[]> {
  const rows = await db.all<{ date: string }>(
    `SELECT DISTINCT COALESCE(st.date, l.date) AS date FROM lift_sets st JOIN lift_sessions l ON l.id = st.lift_session_id
     WHERE st.deleted_at IS NULL AND l.deleted_at IS NULL AND COALESCE(st.date, l.date) >= ? ORDER BY 1`,
    [since],
  );
  return rows.map((r) => r.date);
}

export interface LiftProgress {
  /** The lift, by the name he does it under. */
  lift: string;
  /** One point per day he did it, oldest first: the heaviest working set that day and its reps. */
  points: { date: string; weight_lb: number; reps: number | null }[];
}

/**
 * How each lift has gone over time, for the page: per lift, per day, the heaviest set he logged.
 * Lifts logged without a weight (bodyweight) are left out; there is nothing to draw. Most
 * recently done lifts come first.
 */
export async function liftProgress(db: Db, since: string): Promise<LiftProgress[]> {
  const rows = await db.all<{ exercise: string; date: string; weight_lb: number; reps: number | null }>(
    `SELECT st.exercise, COALESCE(st.date, l.date) AS date, st.weight_lb, st.reps FROM lift_sets st JOIN lift_sessions l ON l.id = st.lift_session_id
     WHERE st.deleted_at IS NULL AND l.deleted_at IS NULL AND st.weight_lb IS NOT NULL AND COALESCE(st.date, l.date) >= ?
     ORDER BY COALESCE(st.date, l.date), st.weight_lb DESC, st.reps DESC`,
    [since],
  );
  const lifts = new Map<string, LiftProgress>();
  for (const r of rows) {
    const key = r.exercise.toLowerCase();
    const lift = lifts.get(key) ?? { lift: r.exercise, points: [] };
    if (lift.points.at(-1)?.date !== r.date) lift.points.push({ date: r.date, weight_lb: r.weight_lb, reps: r.reps }); // the first row of a day is its heaviest
    lifts.set(key, lift);
  }
  return [...lifts.values()].sort((a, b) => (a.points.at(-1)!.date < b.points.at(-1)!.date ? 1 : -1));
}

// ---------- how far through the program ----------

export interface ProgramProgress {
  name: string;
  /** Every session of the program. */
  total: number;
  /** Sessions he finished. */
  finished: number;
  /** Sessions he said he was skipping. */
  skipped: number;
  /** The program's last week number (10 for a ten-week program). */
  weeks: number;
  /** Each week of the program in order: its sessions finished or skipped, out of how many. */
  by_week: { done: number; of: number }[];
}

/**
 * How far through the active program he is, for the dashboard's ring: sessions finished and
 * skipped out of all of them. Null when no program is loaded.
 */
export async function programProgress(db: Db): Promise<ProgramProgress | null> {
  const program = await activeProgram(db);
  if (!program) return null;
  const row = await db.first<{ total: number; weeks: number | null; finished: number | null; skipped: number | null }>(
    `SELECT COUNT(*) AS total, MAX(ps.week) AS weeks,
            SUM(EXISTS (SELECT 1 FROM lift_sessions ls WHERE ls.program_session_id = ps.id AND ls.deleted_at IS NULL AND ls.finished_at IS NOT NULL)) AS finished,
            SUM(EXISTS (SELECT 1 FROM lift_sessions ls WHERE ls.program_session_id = ps.id AND ls.deleted_at IS NULL AND ls.skipped_at IS NOT NULL AND ls.finished_at IS NULL)) AS skipped
       FROM program_sessions ps WHERE ps.program_id = ?`,
    [program.id],
  );
  const weeks = await db.all<{ week: number; of: number; done: number | null }>(
    `SELECT ps.week AS week, COUNT(*) AS of,
            SUM(EXISTS (SELECT 1 FROM lift_sessions ls WHERE ls.program_session_id = ps.id AND ls.deleted_at IS NULL AND (ls.finished_at IS NOT NULL OR ls.skipped_at IS NOT NULL))) AS done
       FROM program_sessions ps WHERE ps.program_id = ? GROUP BY ps.week ORDER BY ps.week`,
    [program.id],
  );
  return {
    name: program.name, total: row?.total ?? 0, finished: row?.finished ?? 0, skipped: row?.skipped ?? 0, weeks: row?.weeks ?? 0,
    by_week: weeks.map((w) => ({ done: w.done ?? 0, of: w.of })),
  };
}
