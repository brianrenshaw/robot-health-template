// The coach: a made-up two-week program, lifted through in order.
import { describe, expect, it } from "vitest";
import { addJournal, coachBrief, estMinutes, importProgram, liftProgress, programProgress, listAudit, listJournal, listLifts, logLift, saveHealth, setWeekPlan, skipSession, suggest, swapExercise, undoLast, weekStart, type Ctx } from "../src";
import { memoryDb } from "./helpers";

const at = (day: string) => new Date(`${day}T17:00:00Z`); // noon in New York
function ctx(): Ctx {
  return { db: memoryDb().db, actor: "mcp:claude" };
}
/** The same database, as one request from the chatbot: everything it changes can be undone together. */
let ops = 0;
const call = (c: Ctx): Ctx => ({ ...c, op: `op-${++ops}` });
const ex = (name: string, more: Record<string, unknown> = {}) => ({ name, working_sets: 3, reps: "8-10", early_rpe: "~7-8", last_rpe: "~8-9", rest: "~2-3 min", ...more });
const week = (n: number) => [
  { week: n, position: 1, name: "Day A", block: "BLOCK 1", exercises: [ex("Leg Press", { sub1: "Belt Squat", sub2: "Back Squat", warmup_sets: "2-4", video_url: "https://youtu.be/legpress", sub1_video_url: "https://youtu.be/beltsquat" }), ex("Superset A1: Pull-Up"), ex("Weak Point Exercise 1")] },
  { week: n, position: 2, name: "Day B", block: "BLOCK 1", rest_after: true, exercises: [ex("Row"), ex("Curl")] },
];
const program = { name: "Made-up program", notes: "Warm up first.", cycle_days: 10, sessions: [...week(1), ...week(2)] };

describe("the program takes turns", () => {
  it("starts at the first session and shows what it prescribes", async () => {
    const c = ctx();
    expect(await importProgram(c, program, at("2026-11-16"))).toMatchObject({ sessions: 4, exercises: 10 });
    const brief = await coachBrief(c.db, at("2026-11-16"));
    expect(brief).toMatchObject({ today: "2026-11-16", weekday: "Monday", program: { name: "Made-up program", cycle_days: 10 }, last_lift: null, rest_day_today: false });
    expect(brief.next).toMatchObject({ name: "Day A", week: 1, position: 1, sessions_in_week: 2, in_progress: false });
    expect(brief.next!.exercises[0]).toMatchObject({
      name: "Leg Press", prescribed: "Leg Press", swapped: false, video_url: "https://youtu.be/legpress",
      working_sets: 3, reps: "8-10", warmup_sets: "2-4", substitutions: ["Belt Squat", "Back Squat"], logged: [], last_time: null,
    });
    expect(brief.next!.exercises[0]!.suggestion.text).toMatch(/^First time on this lift/);
    expect(brief.program).not.toHaveProperty("notes");
    expect((await coachBrief(c.db, at("2026-11-16"), { includeProgramNotes: true })).program!.notes).toBe("Warm up first.");
    expect(brief.queue).toEqual([
      { name: "Day A", week: 1, status: "next" }, { name: "Day B", week: 1, status: "later" },
      { name: "Day A", week: 2, status: "later" }, { name: "Day B", week: 2, status: "later" },
    ]);
  });

  it("logs sets as he goes, then moves to the next session when he says he is finished", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    const first = await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }, { exercise: "leg press", set: 2, weight_lb: 270, reps: 7, rpe: 9 }] }, at("2026-11-16"));
    expect(first).toMatchObject({ session: "Day A", sets_saved: 2, finished: false, not_logged_yet: ["Superset A1: Pull-Up", "Weak Point Exercise 1"], est_minutes_left: 22, next: null });
    let brief = await coachBrief(c.db, at("2026-11-16"));
    expect(brief.next).toMatchObject({ name: "Day A", in_progress: true });
    expect(brief.next!.exercises[0]!.logged).toEqual([{ set: 1, weight_lb: 270, reps: 8, rpe: null }, { set: 2, weight_lb: 270, reps: 7, rpe: 9 }]);

    const done = await logLift(c, { sets: [{ exercise: "Pull-Up", set: 1, reps: 9 }, { exercise: "Weak Point Exercise 1", did: "Machine Lateral Raise", set: 1, weight_lb: 40, reps: 12 }], finished: true, notes: "felt strong" }, at("2026-11-16"));
    expect(done).toMatchObject({ finished: true, not_logged_yet: [], next: "Day B (week 1)" });
    brief = await coachBrief(c.db, at("2026-11-17"));
    expect(brief.next).toMatchObject({ name: "Day B", week: 1, in_progress: false });
    expect(brief.last_lift).toEqual({ name: "Day A", date: "2026-11-16", days_ago: 1 });
    expect(brief.cycle).toEqual({ week: 1, started: "2026-11-16", day: 2, of_days: 10, done: [{ name: "Day A", date: "2026-11-16" }], skipped: [] });
  });

  it("a missed stretch changes nothing: the next session is still the next one", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }], finished: true }, at("2026-11-16"));
    const brief = await coachBrief(c.db, at("2026-11-29"));
    expect(brief.next!.name).toBe("Day B");
    expect(brief.cycle).toMatchObject({ day: 14, of_days: 10 });
  });

  it("shows last time's numbers when the lift comes round again, and marks the rest day", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 10 }, { exercise: "Leg Press", set: 2, weight_lb: 270, reps: 9 }], finished: true }, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Row", set: 1, weight_lb: 120, reps: 10 }], finished: true }, at("2026-11-18"));
    const brief = await coachBrief(c.db, at("2026-11-19"));
    expect(brief.rest_day_today).toBe(true); // Day B is followed by a mandatory rest day
    expect(brief.next).toMatchObject({ name: "Day A", week: 2 });
    expect(brief.next!.exercises[0]!.last_time).toEqual({
      date: "2026-11-16", sets: [{ set: 1, weight_lb: 270, reps: 10, rpe: null }, { set: 2, weight_lb: 270, reps: 9, rpe: null }],
    });
    expect(brief.next!.exercises[0]!.suggestion).toEqual({ weight_lb: 270, text: "Last time 10, 9 at 270 lb. Stay at 270 lb and add a rep to at least one set, until every set reaches 10. If a rep will not come, cleaner form counts too." });
    expect((await coachBrief(c.db, at("2026-11-20"))).rest_day_today).toBe(false);
    expect(brief.cycle).toMatchObject({ week: 2, started: null, day: null, done: [] });
  });

  it("logging a set again replaces it", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }] }, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 275, reps: 8 }] }, at("2026-11-16"));
    const [lift] = await listLifts(c.db, "2026-11-16", "2026-11-16");
    expect(lift).toMatchObject({ session: "Day A", week: 1, finished: false });
    expect(lift!.sets).toEqual([{ exercise: "Leg Press", date: "2026-11-16", set: 1, weight_lb: 275, reps: 8, rpe: null }]);
  });

  it("never files a set under a guess", async () => {
    const c = ctx();
    await expect(logLift(c, { sets: [{ exercise: "Leg Press", set: 1 }] }, at("2026-11-16"))).rejects.toThrow(/no lifting program/);
    await importProgram(c, program, at("2026-11-16"));
    await expect(logLift(c, { sets: [{ exercise: "Leg Press", set: 1, reps: 8 }, { exercise: "Bench Press", set: 1, reps: 8 }] }, at("2026-11-16"))).rejects.toThrow(/not an exercise of Day A.*Leg Press; Superset A1: Pull-Up/);
    await expect(logLift(c, { finished: true }, at("2026-11-16"))).rejects.toThrow(/No sets are logged/);
    await expect(logLift(c, { sets: [{ exercise: "Leg Press", set: 1, reps: 8 }], date: "2026-12-25" }, at("2026-11-16"))).rejects.toThrow(/future/);
    expect(await listLifts(c.db, "2000-01-01", "2100-01-01")).toEqual([]);
  });

  it("loading a new program archives the old one and keeps what he lifted", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }], finished: true }, at("2026-11-16"));
    await importProgram(c, { ...program, name: "Second program" }, at("2026-11-20"));
    const brief = await coachBrief(c.db, at("2026-11-20"));
    expect(brief.program!.name).toBe("Second program");
    expect(brief.next).toMatchObject({ name: "Day A", week: 1 });
    expect(brief.next!.exercises[0]!.last_time).toMatchObject({ date: "2026-11-16" }); // history carries over by the lift's name
    expect(await listLifts(c.db, "2026-11-16", "2026-11-16")).toHaveLength(1);
  });
});

describe("progressive overload", () => {
  const e = { reps: "8-10", early_rpe: "~7-8", last_rpe: "~8-9" };
  const sets = (weight: number | null, ...reps: number[]) => ({ sets: reps.map((r, i) => ({ set: i + 1, weight_lb: weight, reps: r, rpe: null })) });
  it("goes up a step once every set reached the top of the rep range", () => {
    expect(suggest(e, sets(270, 10, 10, 10), false)).toEqual({ weight_lb: 275, text: "Last time 10, 10, 10 at 270 lb, the top of 8-10 on every set. Go up to about 275 lb (the next step on that equipment) and start again from 8 reps." });
    expect(suggest(e, sets(22.5, 10, 11), false).weight_lb).toBe(25); // small weights move in smaller steps
  });
  it("stays put and chases reps until then", () => {
    expect(suggest(e, sets(270, 10, 9, 8), false)).toMatchObject({ weight_lb: 270 });
    expect(suggest(e, sets(270, 10, 9, 8), false).text).toMatch(/Stay at 270 lb and add a rep to at least one set/);
  });
  it("on a fixed rep count, adds weight instead of reps", () => {
    const fixed = { ...e, reps: "8" };
    expect(suggest(fixed, sets(360, 8, 8, 8), false)).toEqual({ weight_lb: 365, text: "Last time 8, 8, 8 at 360 lb. This lift stays at 8 reps, so add weight when form allows: try about 365 lb (the next step on that equipment)." });
    expect(suggest(fixed, sets(360, 8, 7, 6), false)).toEqual({ weight_lb: 360, text: "Last time 8, 7, 6 at 360 lb. Stay at 360 lb until every set is a clean 8, then add weight." });
  });
  it("holds back in a deload week, and says how to start a new lift", () => {
    expect(suggest(e, sets(270, 10, 10, 10), true)).toMatchObject({ weight_lb: 270 });
    expect(suggest(e, sets(270, 10, 10, 10), true).text).toMatch(/^Semi-deload week/);
    expect(suggest(e, null, false)).toEqual({ weight_lb: null, text: "First time on this lift. Find a weight you can do for 8-10 reps at about RPE 7-8, and that becomes the number to beat." });
  });
  it("does not pretend to understand a rep scheme it cannot read", () => {
    expect(suggest({ ...e, reps: "5,4,3+" }, sets(100, 5, 4, 3), false)).toEqual({ weight_lb: 100, text: "Last time 5, 4, 3 at 100 lb. Match it and try to beat it by a rep." });
  });
  it("handles a bodyweight lift", () => {
    expect(suggest(e, sets(null, 10, 10), false)).toMatchObject({ weight_lb: null });
  });
});

describe("swapping a lift", () => {
  it("a standing swap changes the lift everywhere in the program, with its own history, suggestion and video", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    expect(await swapExercise(c, { exercise: "leg press", use_instead: "Belt Squat", note: "no leg press at my gym" }, at("2026-11-16")))
      .toEqual({ prescribed: "Leg Press", use_instead: "Belt Squat", sessions_affected: 2, video_url: "https://youtu.be/beltsquat" });
    let lift = (await coachBrief(c.db, at("2026-11-16"))).next!.exercises[0]!;
    expect(lift).toMatchObject({ name: "Belt Squat", prescribed: "Leg Press", swapped: true, video_url: "https://youtu.be/beltsquat", last_time: null });

    // Logged against the slot, it is filed under the lift he really does.
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 180, reps: 10 }], finished: true }, at("2026-11-16"));
    expect((await listLifts(c.db, "2026-11-16", "2026-11-16"))[0]!.sets[0]).toMatchObject({ exercise: "Belt Squat", weight_lb: 180 });
    await logLift(c, { sets: [{ exercise: "Row", set: 1, weight_lb: 120, reps: 10 }], finished: true }, at("2026-11-18"));
    lift = (await coachBrief(c.db, at("2026-11-20"))).next!.exercises[0]!; // week 2, same slot
    expect(lift).toMatchObject({ name: "Belt Squat", last_time: { date: "2026-11-16" }, suggestion: { weight_lb: 185 } });

    // Going back to the program's own exercise.
    expect(await swapExercise(c, { exercise: "Leg Press", use_instead: null }, at("2026-11-21"))).toMatchObject({ use_instead: null });
    expect((await coachBrief(c.db, at("2026-11-21"))).next!.exercises[0]).toMatchObject({ name: "Leg Press", swapped: false, last_time: null });
  });
  it("fills a weak-point slot with his pick, and a one-day change is just logged as what he did", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await swapExercise(c, { exercise: "Weak Point Exercise 1", use_instead: "Machine Lateral Raise" }, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Weak Point Exercise 1", set: 1, weight_lb: 40, reps: 12 }, { exercise: "Leg Press", did: "Back Squat", set: 1, weight_lb: 185, reps: 8 }] }, at("2026-11-16"));
    expect((await listLifts(c.db, "2026-11-16", "2026-11-16"))[0]!.sets.map((s) => s.exercise).sort()).toEqual(["Back Squat", "Machine Lateral Raise"]);
    expect((await coachBrief(c.db, at("2026-11-16"))).next!.exercises[0]).toMatchObject({ name: "Leg Press", swapped: false }); // the one-day change did not stick
  });
  it("refuses a name the program does not have, and offers the close ones", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await expect(swapExercise(c, { exercise: "Leg Curl Press", use_instead: "X" }, at("2026-11-16"))).rejects.toThrow(/no exercise named "Leg Curl Press".*Did he mean: Curl; Leg Press/);
  });
});

describe("the week", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // a Monday
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // the Sunday after
    expect(weekStart("2026-11-19")).toBe("2026-11-16");
  });
  it("keeps how many days he plans to bike, counts rides from Apple Health, and knows Thursday is basketball", async () => {
    const c = ctx();
    const ride = (start: string) => ({ start, end: start.replace("T15", "T16"), value: { workout: { activity_type: "cycling", duration: 3600 } } });
    await saveHealth(c, { workouts: [ride("2026-11-14T15:00:00Z"), ride("2026-11-16T15:00:00Z"), ride("2026-11-18T15:00:00Z")] }, at("2026-11-19"));
    expect(await setWeekPlan(c, { bike_days: 3 }, at("2026-11-16"))).toMatchObject({ week_start: "2026-11-16", bike_days: 3 });
    await setWeekPlan(c, { note: "travel Friday" }, at("2026-11-17"));
    const brief = await coachBrief(c.db, at("2026-11-19")); // a Thursday
    expect(brief.week).toEqual({ week_start: "2026-11-16", bike_days_planned: 3, bike_dates: [], rides_done: 2, note: "travel Friday", fixtures: ["basketball every Thursday"], today_is: ["basketball"] });
    expect((await coachBrief(c.db, at("2026-11-20"))).week.today_is).toEqual([]);
    expect((await coachBrief(c.db, at("2026-11-23"))).week).toMatchObject({ week_start: "2026-11-23", bike_days_planned: null, rides_done: 0 });
  });
});

describe("getting every session in, his way", () => {
  const sets = (exercise: string, n = 1) => Array.from({ length: n }, (_, i) => ({ exercise, set: i + 1, weight_lb: 100, reps: 10 }));

  it("a session can be split over two days and stays in progress until he says it is done", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: sets("Leg Press", 3) }, at("2026-11-16"));
    let brief = await coachBrief(c.db, at("2026-11-17")); // the next day: still Day A, two lifts to go
    expect(brief.next).toMatchObject({ name: "Day A", in_progress: true, est_minutes_left: 22 });
    expect(brief.queue[0]).toEqual({ name: "Day A", week: 1, status: "in progress" });
    expect(brief.lifted_today).toBe(false);
    const done = await logLift(c, { sets: [...sets("Pull-Up", 2), ...sets("Weak Point Exercise 1")], finished: true }, at("2026-11-17"));
    expect(done).toMatchObject({ finished: true, not_logged_yet: [], next: "Day B (week 1)" });
    const [lift] = await listLifts(c.db, "2026-11-17", "2026-11-17"); // found by the second day too
    expect(lift!.sets.map((x) => x.date)).toEqual(["2026-11-16", "2026-11-16", "2026-11-16", "2026-11-17", "2026-11-17", "2026-11-17"]);
    brief = await coachBrief(c.db, at("2026-11-17"));
    expect(brief).toMatchObject({ lifted_today: true, last_lift: { name: "Day A", date: "2026-11-17", days_ago: 0 } });
    expect(brief.cycle).toMatchObject({ started: "2026-11-16", day: 2, done: [{ name: "Day A", date: "2026-11-17" }] });
  });

  it("he can do a session out of order; the one he passed over is still next", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    expect((await coachBrief(c.db, at("2026-11-16"), { session: "day b" })).next).toMatchObject({ name: "Day B", week: 1 });
    const done = await logLift(c, { session: "Day B", sets: sets("Row", 3), finished: true }, at("2026-11-16"));
    expect(done).toMatchObject({ session: "Day B", finished: true, next: "Day A (week 1)" });
    const brief = await coachBrief(c.db, at("2026-11-18"));
    expect(brief.next).toMatchObject({ name: "Day A", week: 1 });
    expect(brief.queue.map((q) => `${q.name} ${q.week}`)).toEqual(["Day A 1", "Day A 2", "Day B 2"]);
    expect(brief.rest_day_today).toBe(false); // the rest day after Day B was the 17th
  });

  it("nothing is skipped unless he says so, and a skip moves on", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    expect(await skipSession(c, { reason: "travelling, no gym" }, at("2026-11-16"))).toEqual({ skipped: "Day A (week 1)", next: "Day B (week 1)" });
    const brief = await coachBrief(c.db, at("2026-11-16"));
    expect(brief.next).toMatchObject({ name: "Day B", week: 1 });
    expect(brief.cycle!.skipped).toEqual([{ name: "Day A", reason: "travelling, no gym" }]);
    expect((await listLifts(c.db, "2026-11-16", "2026-11-16"))[0]).toMatchObject({ session: "Day A", skipped: true, finished: false, sets: [] });
    // A session with sets logged is finished, not skipped.
    await logLift(c, { sets: sets("Row") }, at("2026-11-16"));
    await expect(skipSession(c, {}, at("2026-11-16"))).rejects.toThrow(/already has sets logged/);
    await expect(skipSession(c, { session: "Day Z" }, at("2026-11-16"))).rejects.toThrow(/no session still to do called "Day Z".*Day B \(week 1\); Day A \(week 2\)/);
  });

  it("gives each lift a rough time, for 'I have 30 minutes'", () => {
    expect(estMinutes({ working_sets: 3, rest: "~2-3 min", warmup_sets: "2-4" })).toBe(17); // 3 x 3.5 + 4 x 1.5
    expect(estMinutes({ working_sets: 3, rest: "~0.5-1 min", warmup_sets: "1" })).toBe(7);
    expect(estMinutes({ working_sets: 2, rest: "N/A", warmup_sets: "0" })).toBe(5);
  });
});

describe("undo", () => {
  it("takes back everything one message changed, and then the one before", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }, { exercise: "Leg Press", set: 2, weight_lb: 270, reps: 7 }] }, at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 2, weight_lb: 270, reps: 9 }, { exercise: "Pull-Up", set: 1, reps: 10 }], finished: true }, at("2026-11-16"));
    expect((await coachBrief(c.db, at("2026-11-16"))).next!.name).toBe("Day B");

    // Undo the second message: the session is open again, set 2 is back to 7 reps, the pull-up is gone.
    expect(await undoLast(call(c), at("2026-11-16"))).toMatchObject({ what: "1 session change, 2 sets", rows: 3 });
    const brief = await coachBrief(c.db, at("2026-11-16"));
    expect(brief.next).toMatchObject({ name: "Day A", in_progress: true });
    expect(brief.next!.exercises[0]!.logged).toEqual([{ set: 1, weight_lb: 270, reps: 8, rpe: null }, { set: 2, weight_lb: 270, reps: 7, rpe: null }]);
    expect(brief.next!.exercises[1]!.logged).toEqual([]);

    // Undo again: the first message goes too, and the session with it.
    expect(await undoLast(call(c), at("2026-11-16"))).toMatchObject({ what: "2 sets, 1 session change" });
    expect((await coachBrief(c.db, at("2026-11-16"))).next).toMatchObject({ name: "Day A", in_progress: false });
    expect(await listLifts(c.db, "2026-11-16", "2026-11-16")).toEqual([]);
    expect(await undoLast(call(c), at("2026-11-16"))).toBeNull(); // the program was loaded by a script, not the chatbot
  });

  it("a set logged again after an undo comes back cleanly", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }] }, at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Pull-Up", set: 1, reps: 9 }] }, at("2026-11-16"));
    await undoLast(call(c), at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Pull-Up", set: 1, reps: 11 }] }, at("2026-11-16"));
    expect((await listLifts(c.db, "2026-11-16", "2026-11-16"))[0]!.sets.map((x) => [x.exercise, x.reps])).toEqual([["Leg Press", 8], ["Superset A1: Pull-Up", 11]]);
  });

  it("takes back a skip, a note, a swap, a week plan and a whole Apple Health sync", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await skipSession(call(c), {}, at("2026-11-16"));
    await undoLast(call(c));
    expect((await coachBrief(c.db, at("2026-11-16"))).next!.name).toBe("Day A");

    await addJournal(call(c), { text: "wrong note" }, at("2026-11-16"));
    expect(await undoLast(call(c))).toMatchObject({ what: "1 note" });
    expect(await listJournal(c.db, "2026-11-01", "2026-11-30")).toEqual([]);

    await swapExercise(call(c), { exercise: "Leg Press", use_instead: "Belt Squat" }, at("2026-11-16"));
    await swapExercise(call(c), { exercise: "Leg Press", use_instead: "Back Squat" }, at("2026-11-16"));
    await undoLast(call(c)); // back to Belt Squat, not to the program's own
    expect((await coachBrief(c.db, at("2026-11-16"))).next!.exercises[0]!.name).toBe("Belt Squat");

    await setWeekPlan(call(c), { bike_dates: ["2026-11-17", "2026-11-19"] }, at("2026-11-16"));
    await setWeekPlan(call(c), { bike_dates: ["2026-11-17", "2026-11-21"] }, at("2026-11-16"));
    await undoLast(call(c));
    expect((await coachBrief(c.db, at("2026-11-16"))).week).toMatchObject({ bike_days_planned: 2, bike_dates: ["2026-11-17", "2026-11-19"] });

    const bucket = (date: string, sum: number) => ({ period_start: `${date}T05:00:00Z`, sum });
    await saveHealth(call(c), { statistics: [{ type: "dietaryEnergyConsumed", rows: [bucket("2026-11-14", 2100)] }] }, at("2026-11-16"));
    await saveHealth(call(c), {
      statistics: [{ type: "dietaryEnergyConsumed", rows: [bucket("2026-11-14", 900), bucket("2026-11-15", 2000)] }, { type: "bodyMass", rows: [{ period_start: "2026-11-15T05:00:00Z", average: 83, unit: "kg" }] }],
      workouts: [{ start: "2026-11-15T15:00:00Z", end: "2026-11-15T16:00:00Z", value: { workout: { activity_type: "cycling", statistics: [{ sample_type: "heartRate", average: 120 }] } } }],
    }, at("2026-11-16"));
    expect(await undoLast(call(c))).toMatchObject({ what: "1 workout, 1 weigh-in, 2 days of numbers" });
    const { listDays, listWorkouts } = await import("../src");
    expect((await listDays(c.db, "2026-11-01", "2026-11-30", at("2026-11-16"))).map((d) => [d.date, d.kcal_eaten, d.incomplete, d.weight_lb])).toEqual([["2026-11-14", 2100, false, null]]);
    expect(await listWorkouts(c.db, "2026-11-01", "2026-11-30")).toEqual([]);
  });
});

describe("choosing bike days, with the forecast beside them", () => {
  const forecast = [
    { date: "2026-11-16", high_f: 56, low_f: 34, rain_pct: 0, wind_mph: 4, summary: "Sunny" },
    { date: "2026-11-17", high_f: 61, low_f: 48, rain_pct: 60, wind_mph: 15, summary: "Rain Likely" },
  ];
  it("keeps the days he chose; saying the week again replaces them", async () => {
    const c = ctx();
    expect(await setWeekPlan(c, { bike_dates: ["2026-11-18", "2026-11-16", "2026-11-21"] }, at("2026-11-16"))).toMatchObject({ week_start: "2026-11-16", bike_days: 3, bike_dates: ["2026-11-16", "2026-11-18", "2026-11-21"] });
    expect(await setWeekPlan(c, { bike_dates: ["2026-11-16", "2026-11-20"] }, at("2026-11-16"))).toMatchObject({ bike_days: 2, bike_dates: ["2026-11-16", "2026-11-20"] });
    expect(await setWeekPlan(c, { bike_dates: ["2026-11-16", "2026-11-18"] }, at("2026-11-16"))).toMatchObject({ bike_dates: ["2026-11-16", "2026-11-18"] }); // the 18th comes back
    await expect(setWeekPlan(c, { week_of: "2026-11-16", bike_dates: ["2026-11-25"] }, at("2026-11-16"))).rejects.toThrow(/not in the week of 2026-11-16/);
    expect((await setWeekPlan(c, { bike_dates: ["2026-11-25"] }, at("2026-11-16"))).week_start).toBe("2026-11-23"); // next week, by its own dates
  });
  it("lays out the seven days ahead: forecast, what he planned, what is fixed, what he rode", async () => {
    const c = ctx();
    await setWeekPlan(c, { bike_dates: ["2026-11-16", "2026-11-18"] }, at("2026-11-16"));
    await saveHealth(c, { workouts: [{ start: "2026-11-16T13:00:00Z", end: "2026-11-16T14:00:00Z", value: { workout: { activity_type: "cycling" } } }] }, at("2026-11-16"));
    const brief = await coachBrief(c.db, at("2026-11-16"), { forecast });
    expect(brief.days_ahead).toHaveLength(7);
    expect(brief.days_ahead[0]).toEqual({ date: "2026-11-16", weekday: "Monday", forecast: { high_f: 56, low_f: 34, rain_pct: 0, wind_mph: 4, summary: "Sunny" }, planned: ["bike"], plan: [{ when: "anytime", activity: "bike", detail: null, session: null }], fixtures: [], rode: true });
    expect(brief.days_ahead[1]).toMatchObject({ weekday: "Tuesday", forecast: { rain_pct: 60 }, planned: [], rode: false });
    expect(brief.days_ahead[2]).toMatchObject({ planned: ["bike"], forecast: null });
    expect(brief.days_ahead[3]).toMatchObject({ weekday: "Thursday", fixtures: ["basketball"] });
    expect(brief.week).toMatchObject({ bike_days_planned: 2, bike_dates: ["2026-11-16", "2026-11-18"], rides_done: 1 });
    expect((await coachBrief(c.db, at("2026-11-16"))).days_ahead[0]!.forecast).toBeNull(); // no forecast given, none invented
  });
  it("plans whole days, AM lift and an afternoon hike, and says which session falls on each lifting day", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-15"));
    const saved = await setWeekPlan(call(c), {
      days: [
        { date: "2026-11-16", items: [{ when: "morning", activity: "lift" }] },
        { date: "2026-11-17", items: [{ when: "afternoon", activity: "hike", detail: "Riverside Park" }, { when: "morning", activity: "lift" }] },
        { date: "2026-11-18", items: [{ when: "morning", activity: "lift" }] },
      ],
    }, at("2026-11-15"));
    expect(saved.week_start).toBe("2026-11-16");
    expect(saved.plan.map((p) => [p.date, p.when, p.activity, p.session ?? p.detail])).toEqual([
      ["2026-11-16", "morning", "lift", "Day A"],
      ["2026-11-17", "morning", "lift", "Day B"],
      ["2026-11-17", "afternoon", "hike", "Riverside Park"],
      ["2026-11-18", "morning", "lift", "Day A"],
    ]);
    expect(saved.plan[0]).toMatchObject({ session_week: 1, lifts: expect.any(Number), minutes: expect.any(Number) });
    // He does Day A on Monday: Tuesday still gets Day B, Wednesday the next one owed.
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }], finished: true }, at("2026-11-16"));
    const brief = await coachBrief(c.db, at("2026-11-17"));
    expect(brief.days_ahead[0]!.plan.map((p) => p.session ?? p.activity)).toEqual(["Day B", "hike"]);
    expect(brief.days_ahead[1]!.plan[0]!.session).toBe("Day A");
    // Changing one day leaves the others; [] clears a day; undo puts it back.
    await setWeekPlan(call(c), { days: [{ date: "2026-11-18", items: [] }] }, at("2026-11-17"));
    expect((await coachBrief(c.db, at("2026-11-17"))).days_ahead[1]!.plan).toEqual([]);
    await undoLast(call(c));
    expect((await coachBrief(c.db, at("2026-11-17"))).days_ahead[1]!.plan[0]!.activity).toBe("lift");
    // Bike days added later sit beside what is already planned.
    await setWeekPlan(call(c), { bike_dates: ["2026-11-17"] }, at("2026-11-17"));
    expect((await coachBrief(c.db, at("2026-11-17"))).days_ahead[0]!.planned.sort()).toEqual(["bike", "hike", "lift"]);
    await expect(setWeekPlan(call(c), { days: [{ date: "2026-11-17", items: [] }, { date: "2026-11-17", items: [] }] }, at("2026-11-17"))).rejects.toThrow(/listed twice/);
  });
});

describe("the journal", () => {
  it("keeps what he said, in his words, any number of times a day", async () => {
    const c = ctx();
    await addJournal(c, { text: "  Slept badly, legs heavy.  " }, at("2026-11-16"));
    await addJournal(c, { text: "Felt better after lunch." }, at("2026-11-16"));
    await addJournal(c, { date: "2026-11-14", text: "Knee a little sore after basketball." }, at("2026-11-16"));
    expect((await listJournal(c.db, "2026-11-01", "2026-11-30")).map((j) => [j.date, j.body])).toEqual([
      ["2026-11-14", "Knee a little sore after basketball."], ["2026-11-16", "Slept badly, legs heavy."], ["2026-11-16", "Felt better after lunch."],
    ]);
    expect((await coachBrief(c.db, at("2026-11-17"))).journal).toHaveLength(3);
    expect((await coachBrief(c.db, at("2026-11-21"))).journal).toHaveLength(2); // the last 7 days
    await expect(addJournal(c, { date: "2026-12-25", text: "x" }, at("2026-11-16"))).rejects.toThrow(/future/);
    expect((await listAudit(c.db)).every((r) => r.table_name === "journal_entries" && r.actor === "mcp:claude")).toBe(true);
  });
});

describe("lifts over time", () => {
  it("gives each lift its heaviest set per day, most recently done first", async () => {
    const c = ctx();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }, { exercise: "Leg Press", set: 2, weight_lb: 280, reps: 6 }, { exercise: "Pull-Up", set: 1, reps: 9 }], finished: true }, at("2026-11-16"));
    await logLift(c, { sets: [{ exercise: "Row", set: 1, weight_lb: 120, reps: 10 }], finished: true }, at("2026-11-18"));
    await logLift(c, { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 285, reps: 8 }] }, at("2026-11-20"));
    expect(await liftProgress(c.db, "2026-01-01")).toEqual([
      { lift: "Leg Press", points: [{ date: "2026-11-16", weight_lb: 280, reps: 6 }, { date: "2026-11-20", weight_lb: 285, reps: 8 }] },
      { lift: "Row", points: [{ date: "2026-11-18", weight_lb: 120, reps: 10 }] },
    ]); // the bodyweight pull-up has no weight to chart
    expect(await liftProgress(c.db, "2026-11-19")).toHaveLength(1);
  });
});

describe("how far through the program", () => {
  it("counts sessions finished and skipped out of all of them", async () => {
    const c = ctx();
    expect(await programProgress(c.db)).toBeNull();
    await importProgram(c, program, at("2026-11-16"));
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 270, reps: 8 }], finished: true }, at("2026-11-16"));
    await skipSession(call(c), { reason: "travelling" }, at("2026-11-17"));
    await logLift(call(c), { sets: [{ exercise: "Leg Press", set: 1, weight_lb: 275, reps: 8 }] }, at("2026-11-18"));
    expect(await programProgress(c.db)).toEqual({ name: "Made-up program", total: 4, finished: 1, skipped: 1, weeks: 2, by_week: [{ done: 2, of: 2 }, { done: 0, of: 2 }] });
  });
});
