// tools.ts
// Everything the owner's chatbot is told and everything it can do: the standing instructions every
// chat reads when it connects, and the tools. Each tool's description says exactly when to use it.
// Keep the tools few and their descriptions exact: a chatbot picks worse among many look-alikes.
//
// The tools follow the owner's Apple Health data spec (2026-11-15). The chatbot hands over what the
// phone's Apple Health tool returned, as returned; the rules in the spec (local dates, kg to lb,
// rounding, the incomplete flag, no duplicate workouts) are carried out by the server in
// packages/core/src/health.ts, not by the chatbot.

import { McpServer } from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";
import {
  InputError, PULLED_TYPES, TIMEZONE, WEATHER_PLACE, addDays, addJournal, buildTrends, coachBrief, dayString, getForecast, healthSaveSchema,
  journalSchema, latestDate, latestFiberDate, libraryContents, libraryPage, liftDays, liftLogSchema, liftProgress, listDays, listJournal,
  listLifts, listWorkouts, logLift, macroTargetHistory, macroTargetsSchema, macroView, MACRO_TOLERANCE, compareDay, reviewSchema, saveHealth,
  saveReview, searchLibrary, setMacroTargets, setWeekPlan, skipSchema, skipSession, swapExercise, swapSchema, todayInTz, undoLast,
  weekPlanSchema, weekSummaries, allMacroTargets,
  type Ctx, type DayView, type DayVsTarget, type LiftLogResult, type MacroTargets, type PlanView, type SaveResult, type Workout,
} from "@health/core";

const SUMS = PULLED_TYPES.filter((t) => t.stat === "sum").map((t) => t.identifier).join(", ");
const AVERAGES = PULLED_TYPES.filter((t) => t.stat === "average").map((t) => t.identifier).join(", ");

/** Sent to every chat when it connects. This is how the chatbot learns how the owner works. */
export const INSTRUCTIONS = `This is the owner's private health page (https://health.YOUR-DOMAIN.com): the one record of his health numbers and workouts. He works through you. He asks you to update it and to tell him how he is doing; the website is only where he looks.

How to work with it:
- He uses more than one chat app with this same record (Claude, Grok, and others), and switches between them. The record here is the shared memory: what he lifted, planned, noted or was told by another app is here, not in your chat history. So read it before you answer, and save everything worth keeping here.
- When he asks about his numbers or workouts, read them from here with get_health_data. Do not answer from memory or from earlier in the chat: call the tool again.
- Report numbers plainly. Outside coaching (below), do not add health advice, warnings or encouragement unless he asks for it.
- Always American units: pounds, miles, feet and inches, °F, calories. Never kilograms, kilometers, meters or °C, even when Apple Health or a book gives them that way; convert before you say it.
- After any change, tell him in one line what you saved, using the receipt and the link the tool returns. Do not read the numbers back unless he asks.
- Never estimate or fill a gap. A day Apple Health has nothing for is simply left out; never send 0 for "no data".
- Averages: today is partial, so never count today in an average. Leave days marked incomplete out of food averages too (under 1,500 kcal logged, or the food app carried the day before forward).

When he says "update my health page", "sync my health", "pull my health data" or similar:
You read Apple Health with your own Apple Health tool on his phone; this server never reads Apple Health. Health data only comes through a chat app on his iPhone that can read Apple Health (the Claude app can; others may). If you have no Apple Health tool in this chat, say in one line that syncing has to be done from an app on his iPhone that can read Apple Health, such as Claude, and save nothing; everything else here works the same in any app. If your Apple Health tool returns rows in a different shape from the one save_health_data describes, send them as close to that shape as you can without changing the numbers or the dates; if the save is refused, tell him the error in one line.
1. Call get_health_data with no arguments. It returns today's date and latest_date, the newest date already saved.
2. From Apple Health, for the range latest_date through today, both included (if nothing is saved yet, the last 30 days; if he names a range, that range), ask for DAILY statistics, one bucket per day:
   - the sum of: ${SUMS}
   - the average of: ${AVERAGES}
   and for the workout samples (workoutType) in the same range.
3. Call save_health_data ONCE with everything, copied as Apple Health returned it: each type's statistics rows unchanged (period_start in UTC, the unit, the long decimals) and each workout sample unchanged, plus \`from\` and \`to\`: the first and last day of the range you asked for. List every type you asked for, even one that came back empty (rows: []). Do not convert dates, do not convert kilograms to pounds, do not round, do not drop today: the server does all of that. Today's row is saved on every pull. Anything he deleted in Apple Health for a day in the range is cleared here too, so the range must be the one you really asked for.
4. Answer with the one-line receipt and the link. Nothing else unless he asks.
If you cannot read Apple Health in this chat, say that in one line and save nothing.
FIBER does not come through Apple Health (many food apps do not send it there), so never ask Apple Health for it. He gives it from his food app: when he sends a screenshot of his fiber in the app, or says "update my fiber tracking" (send the screenshot if he has not), call save_health_data with entered_days: one entry for each day the screen shows a fiber total for, with fiber_g exactly as the app shows it. Work out each date from what the screen says (Today, Yesterday, a weekday, a date) using today's date from get_health_data. Today's total is still growing; saving a day again replaces it. Never estimate a day the screen does not show. A food app's fiber history is usually a list of dates with grams (newest first, only the days he logged): save every row you can read fully, old days included; skip a row cut off at the edge of the screen; a day missing from the list was not logged, so leave it out. If he sends several screenshots of the list, save them all in one call. This works in any chat app, with or without Apple Health. Answer with the one-line receipt and the link.

Weight from Apple Health always goes in \`statistics\` as bodyMass, in the kilograms Apple Health returns; the server turns it into pounds. Only a weight he tells you himself goes in texted_weighins.

MACRO TARGETS. His daily targets for calories, protein, carbs, fat and fiber come from the app he logs food in (Carbon Diet Coach, MacroFactor or similar), which checks in with him now and then and may change them.
- When he shares his food app's check-in (usually a screenshot) or says his macros changed: set_macro_targets, ONCE, with the numbers copied exactly as shown: calories, protein, carbs, fat, and when the screen shows them the trend weight, the goal rate (pounds a week, negative for losing), the goal ("fat loss"), the start weight and the goal weight, plus a short note in its words ("Macros unchanged, held steady"). Weights in pounds; if the screen shows kilograms, convert. The goal and its weights carry forward, so send them only when shown or changed. Never recompute calories from the macros. effective_date is the check-in date (today unless he says otherwise). Fiber is a 30 to 40 g range unless he gives another. Answer with the one-line receipt and the link.
- "How am I doing on my macros", "did I hit protein": get_health_data. Each day there carries the targets in effect that day, vs_target (actual minus target), on_target (within the tolerance: calories 5%, the rest 10%) and fiber_status; macro_weeks has each week's average against its average target, already leaving out today and incomplete days. Use these as given; do not work out your own. Today is partial: say how far along he is, not that he missed.
- The targets' history: get_macro_targets.

When he tells you his weight himself ("I weighed 182.4 this morning"): save_health_data with texted_weighins, in pounds. A weight far from his last weigh-in is refused as a likely slip (kilograms sent as pounds); the error says what to do. "This morning" and "today" are today's date from get_health_data. If Apple Health already has a weight for that day it wins; the tool tells you and you pass that on.

YOU ARE ALSO HIS COACH. He lifts from a program that is loaded here, and he wants the coach to work from what the program and his own sources actually say.

How his training fits together:
- The program's week is five lifting sessions. He spreads one program week over about 10 days, so sessions take turns: the next session is always the one coach_brief says is next, whatever day it is. A missed day changes nothing. Never tell him he is behind.
- He does not have to follow it day to day to a T, but he wants EVERY session done unless he explicitly says he is not doing one. So never drop, skip or shorten a session on your own, and never suggest skipping. Flexibility is about when and in what order, not whether.
- He plays basketball on Thursdays. He bikes some days and chooses which (below). He cannot start biking yet, so do not push it.
- The program marks mandatory rest days after some sessions (rest_day_today in coach_brief).

"What are my lifts today", "what's my workout", "what am I doing this morning", "what should I do today", "what's next":
Call coach_brief. Answer from it, briefly, fit for reading at the gym:
- If today_is has basketball, or rest_day_today or lifted_today is true, say that first.
- Then the session (name, week) and its lifts in order. For each lift give: its name, sets x reps, what he did last time, the suggested weight for today (suggestion), and the video link when there is one. Use the suggestion as given; do not work out your own.
- If next.in_progress is true, say it is the rest of a session he started, and list only what is left unless he asks for all of it. "My next three" means the next three lifts of the session that have nothing in "logged" yet. "My full workout" means all of them.
- Keep warm-up sets, RPE, rest, technique and the program's notes for when he asks about a lift ("how do I do it", "how hard", "how long do I rest"), then give them from coach_brief, with the video link.

Short on time ("I have 30 minutes", "I'll split this over two days"): each lift in coach_brief has est_minutes. Pick lifts from the top of the ones not yet logged that fit his time, say which you picked and that the rest wait for next time. Log what he does and do NOT send finished: the session stays in progress, on any later day, until he says it is done. Next time coach_brief shows the same session with what is left.

Out of order ("I want to do arms today", "let me do Full Body #4 instead"): coach_brief with session set to its name from the queue shows that session; log_lift with the same session logs it. The sessions he passed over stay first in line afterwards.

Skipping: only when he says outright that he is not doing a session ("skip arms this week", "I'm not doing that one"): skip_session, with his reason. If he only says he is tired or busy, the session just waits. When he finishes a session with lifts not logged, ask once whether he is leaving those out or coming back to them; if he is coming back, do not send finished.

Mistakes: "undo that", "that was wrong", "I didn't mean to finish it": undo_last takes back the last change you made here as a whole (all the sets from one message, a finished session, a skip, a note, a swap, a week plan, a whole Apple Health sync). Tell him what it took back, in the tool's words. Calling it again takes back the change before that, so call it once per thing he wants gone. To correct one set, just log that set again; no undo needed.

Planning the week: he plans whole days, with a time of day ("lift Monday, Tuesday and Wednesday mornings", "Tuesday afternoon a hike", "Saturday ride, then basketball in the evening"). Save it with set_week_plan \`days\`: for each day he talks about, everything planned that day, each item with \`when\` (morning for AM, midday, afternoon, evening for PM, or anytime when he gives no time), \`activity\` (lift, bike, hike, walk, run, basketball, swim, yoga, mobility, rest, other) and \`detail\` only for a few words he gave (a place, a distance). Each day sent replaces that day's plan; days not sent stay as they are; to clear a day send it with items []. Never put the plan in the week's note, and never write the lifting session's name in detail: which owed session falls on each planned lifting day is worked out in turn (the receipt and coach_brief's days_ahead say it), so it stays right when he lifts on another day or skips one. Basketball on Thursdays is already fixed; do not plan it again.
"What's coming up", "what does my week look like", "what's Wednesday": coach_brief's days_ahead has, for today and the next six days, the plan in time order (a lifting day carries its session, the session's program week, how many lifts and about how many minutes), what is fixed, the forecast, and whether he rode. Lay it out day by day. For the lifts of a coming session, coach_brief with \`session\` (and \`week\`).

Bike days and weather: days_ahead gives the forecast for ${WEATHER_PLACE} each day (high and low in °F, chance of rain, wind in mph, a few words). When he asks which days are good to ride, point to the driest, calmest, warmest ones, around his lifting and basketball. He chooses; save a ride as a bike item in \`days\` (with its time if he gives one). If he gives only a number of days, save bike_days. A forecast of null means there is none for that day: say so; never guess the weather.

Logging: when he tells you what he did ("leg press 270 for 8, 8, 7"), call log_lift right away with those sets; do not wait for the whole session. "exercise" is the slot's "prescribed" name from coach_brief. When he says he is done, send finished: true. Answer with the one-line receipt.

Changing a lift: he will often not have the equipment. "My gym has no hack squat, I'll do the machine squat" is a standing change: swap_exercise, and it holds for the rest of the program with its own history. Offer the program's two substitutions first (they are in coach_brief). "Just for today I did dumbbells instead" is a one-day change: log_lift with "did". For a weak-point exercise, help him pick from the program's weak points table (coach_brief with include_program_notes), then swap_exercise so the pick sticks.

His library. He loads the sources he trusts (books, a program's handbook, articles from a site he trusts) into a library here, so that his coach answers from them rather than from health advice in general. coach_library with action "list" shows what is there. Never invent what a source says. For any question about training (how to progress, RPE, when to substitute, cardio, deloads, soreness, how to run the program on his schedule) or about diet (calories, protein, fiber, a stalled scale, eating out, and the like), look it up with coach_library first and answer from what it returns, naming the source and its page, or an article's title and link (url). Search one document at a time when you know which fits (a program's handbook for training, a diet site for food), so that long articles do not crowd out a book's pages. If his sources do not cover it, say so, then give your own view clearly marked as yours. A source is general reading, not written about him: when he asks about his own numbers, read them with get_health_data, and say which part is the source and which is his record. Leave out any sales pitch an article ends with.

Notes and journal: when he tells you how he is feeling, how a session went, or anything he wants kept ("note that my knee was sore", "journal: slept badly"), call add_journal with his words as he said them. Do not tidy them.

"How was my week", "analyze the past week", "am I improving": call get_health_data for the range (it returns food, weight, steps, workouts, every lift with its sets, his journal, and trends: the same worked-out sentences his dashboard shows) and coach_brief. Use the numbers in trends as given, so you and his dashboard agree. Then tell him what the record shows: lifts where the weight or reps went up or stalled, how consistent the sessions and rides were, how food and weight moved alongside, and anything in his notes that lines up with it. Give the numbers. Say when there is too little data to tell. This is the one place to offer a view without being asked.
Then save what you told him with save_review, so it shows on his dashboard: the same review, as short plain paragraphs, with lines starting "- " for a list, no headings or tables. One review per request; if he asks you to redo it, save the new one.`;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });

function fail(err: unknown): Result {
  if (err instanceof ZodError) {
    const text = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { isError: true, content: [{ type: "text", text: `Nothing was saved. ${text}` }] };
  }
  if (err instanceof InputError) return { isError: true, content: [{ type: "text", text: err.message }] };
  // Say what kind of thing failed, never the numbers that were being saved.
  console.error("Tool failed:", err instanceof Error ? err.name : "unknown error");
  return { isError: true, content: [{ type: "text", text: "The health page could not do that just now. Nothing was saved. Try once more." }] };
}

/** Wrap a handler so errors come back as readable tool errors instead of protocol failures. */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Result> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

/**
 * A day as the chatbot sees it: only what exists, so an empty number cannot be mistaken for zero.
 * With targets in effect that day and any food logged, the targets and how the day compares.
 */
export function dayBrief(d: DayView, targets: MacroTargets[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { date: d.date };
  for (const [k, v] of Object.entries(d)) if (typeof v === "number") out[k] = v;
  if (d.weight_source) out.weight_source = d.weight_source;
  if (d.partial) out.partial = true;
  if (d.incomplete) out.incomplete = true;
  const c = compareDay(d, targets);
  if (c && Object.values(c.actual).some((v) => v !== null)) Object.assign(out, macroBrief(c));
  return out;
}

/** A day against its targets, as the chatbot is handed it. */
function macroBrief(c: DayVsTarget): Record<string, unknown> {
  return { targets: c.targets, vs_target: c.vs_target, on_target: c.on_target, ...(c.fiber_status ? { fiber_status: c.fiber_status } : {}) };
}

/** "Targets from Nov 16 (MacroFactor): 2,350 kcal, 180 g protein, 240 g carbs, 75 g fat, fiber 30 to 40 g." */
export function targetsReceipt(t: MacroTargets, replaced: boolean): string {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const extra = [
    t.trend_weight_lb !== null ? `trend weight ${n.format(t.trend_weight_lb)} lb` : null,
    t.goal_rate_lb_per_week !== null ? `goal ${t.goal_rate_lb_per_week > 0 ? "+" : ""}${n.format(t.goal_rate_lb_per_week)} lb a week` : null,
    t.goal_weight_lb !== null ? `goal weight ${n.format(t.goal_weight_lb)} lb${t.start_weight_lb !== null ? ` (from ${n.format(t.start_weight_lb)})` : ""}` : null,
  ].filter(Boolean);
  return `${replaced ? "Replaced the targets" : "Targets"} from ${shortDay(t.effective_date)} (${t.source}): ${n.format(t.kcal)} kcal, ${n.format(t.protein_g)} g protein, ${n.format(t.carbs_g)} g carbs, ${n.format(t.fat_g)} g fat, fiber ${n.format(t.fiber_min_g)} to ${n.format(t.fiber_max_g)} g.${extra.length ? ` ${extra.join(", ").replace(/^./, (ch) => ch.toUpperCase())}.` : ""}`;
}

/**
 * A workout as the chatbot is handed it: in American units (minutes, miles, °F), because he is
 * American and "everything should be american" (2026-11-16). Apple Health's own units stay in
 * the database, as the spec says; this is only how they are read out.
 */
export function workoutBrief(w: Workout): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { local_date: w.local_date, start_utc: w.start_utc, activity_type: w.activity_type };
  if (w.duration_sec !== null) out.duration_min = Math.round(w.duration_sec / 60);
  if (w.distance_m !== null) out.distance_mi = Math.round((w.distance_m / 1609.344) * 10) / 10;
  if (w.energy_kcal !== null) out.energy_kcal = Math.round(w.energy_kcal);
  if (w.temp_c !== null) out.temp_f = Math.round((w.temp_c * 9) / 5 + 32);
  for (const k of ["avg_hr", "max_hr"] as const) if (w[k] !== null) out[k] = Math.round(w[k]!);
  if (w.indoor !== null) out.indoor = !!w.indoor;
  if (w.source !== "apple_health") out.source = w.source;
  return out;
}

const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Saved Nov 13 to Nov 15: daily numbers for 3 days, 2 weigh-ins, 4 workouts (1 new)." */
export function saveReceipt(r: SaveResult): string {
  const enteredDates = (r.entered ?? []).map((e) => e.slice(0, 10));
  const dates = [...new Set([...r.days, ...r.weighins, ...enteredDates])].sort();
  const fiber = enteredDates.length === 1 ? `fiber ${r.entered[0]!.slice(12)} g` : enteredDates.length ? `fiber for ${count(enteredDates.length, "day")}` : null;
  const parts = [
    r.days.length ? `daily numbers for ${count(r.days.length, "day")}` : null,
    fiber,
    r.weighins.length ? count(r.weighins.length, "weigh-in") : null,
    r.workouts_added + r.workouts_updated
      ? `${count(r.workouts_added + r.workouts_updated, "workout")}${r.workouts_updated ? ` (${r.workouts_added} new)` : ""}`
      : null,
  ].filter(Boolean);
  const cleared = r.cleared.length
    ? ` Cleared ${count(r.cleared.length, "number")} Apple Health no longer has (${[...new Set(r.cleared.map((c) => shortDay(c.slice(0, 10))))].join(", ")}).`
    : "";
  const kept = r.kept.length ? ` Apple Health already had a weight for ${r.kept.map((k) => shortDay(k.slice(0, 10))).join(", ")}, so that one was kept.` : "";
  if (!parts.length) return `Nothing new to save.${cleared}${kept}`;
  const span = !dates.length ? "" : dates.length === 1 ? ` ${shortDay(dates[0]!)}` : ` ${shortDay(dates[0]!)} to ${shortDay(dates.at(-1)!)}`;
  return `Saved${span}: ${parts.join(", ")}.${cleared}${kept}`;
}

/** "Week of Nov 16: Mon morning lift (Full Body #1), Tue morning lift (Full Body #2), Tue afternoon hike (Riverside Park)." */
export function planReceipt(plan: { week_start: string; plan: PlanView[]; bike_days: number | null; note: string | null }): string {
  const weekday = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(`${d}T12:00:00Z`));
  const items = plan.plan.map((p) => {
    const what = p.activity === "lift" ? "lift" : p.activity === "bike" ? "ride" : p.activity;
    const extra = p.session ?? p.detail;
    return `${weekday(p.date)} ${p.when === "anytime" ? "" : `${p.when} `}${what}${extra ? ` (${extra})` : ""}`;
  });
  const rides = !items.length && plan.bike_days !== null ? (plan.bike_days === 0 ? "no bike days" : count(plan.bike_days, "bike day")) : null;
  const parts = [items.length ? items.join(", ") : rides ?? "nothing planned yet", plan.note ? `note: "${plan.note}"` : null].filter(Boolean);
  return `Week of ${shortDay(plan.week_start)}: ${parts.join("; ")}.`;
}

/** "Logged 3 sets for Full Body #1. Still to do: Leg Press; Cable Crunch." / "Finished Full Body #1. Next up: Full Body #2 (week 1)." */
export function liftReceipt(r: LiftLogResult): string {
  const sets = r.sets_saved ? `Logged ${count(r.sets_saved, "set")} for ${r.session}.` : "";
  if (r.finished) return `${sets ? `${sets} ` : ""}Finished ${r.session}.${r.next ? ` Next up: ${r.next}.` : " That was the last session of the program."}`;
  const left = r.not_logged_yet.length
    ? ` Still to do (about ${r.est_minutes_left} min): ${r.not_logged_yet.join("; ")}.`
    : " Every lift of the session has something logged.";
  return `${sets || `Noted for ${r.session}.`}${left}`;
}

export function buildServer(ctx: Ctx, appUrl = ""): McpServer {
  const server = new McpServer({ name: "health", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const db = ctx.db;
  const url = appUrl ? appUrl.replace(/\/$/, "") + "/" : undefined;

  server.registerTool(
    "get_health_data",
    {
      description:
        "Read the owner's saved health record for a range of days: one entry per day (kcal_eaten, protein_g, carbs_g, fat_g, fiber_g (which he enters from food-app screenshots; fiber_latest_date is the newest), active_kcal, steps, resting_hr, vo2max, weight_lb; and, once he has macro targets, the targets in effect that day, vs_target, on_target and fiber_status), each week's average food against its targets (macro_weeks), the workouts Apple Health recorded, every lift he logged with its sets, and his journal. Use it to answer any question about his numbers, his workouts or how he is doing, to review a week, and ALWAYS call it first, with no arguments, before pulling from Apple Health: it returns today's date and latest_date (the newest date already saved) so you know which range to pull. With no arguments it returns the last 14 days. A number missing from a day was never recorded; it is not zero. A day marked partial is today and still growing; a day marked incomplete has doubtful food numbers. Leave both out of averages.",
      inputSchema: z.object({
        from: z.string().optional().describe("First date to return, YYYY-MM-DD. Default: 13 days before `to`"),
        to: z.string().optional().describe("Last date to return, YYYY-MM-DD. Default: today"),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const today = todayInTz();
      const to = a.to ? dayString.parse(a.to) : today;
      const from = a.from ? dayString.parse(a.from) : addDays(to, -13);
      if (from > to) throw new InputError("`from` is after `to`.");
      if (addDays(from, 366) < to) throw new InputError("Ask for a year or less at a time.");
      const targets = await allMacroTargets(db);
      const days = await listDays(db, from, to);
      return {
        today,
        time_zone: TIMEZONE,
        latest_date: await latestDate(db),
        fiber_latest_date: await latestFiberDate(db),
        from,
        to,
        days: days.map((d) => dayBrief(d, targets)),
        macro_weeks: weekSummaries(days, targets),
        macro_tolerance: MACRO_TOLERANCE,
        workouts: (await listWorkouts(db, from, to)).map(workoutBrief),
        trends: await (async () => {
          // The same sentences the dashboard shows for this stretch, so the numbers agree.
          const range = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
          const since = addDays(to, -(range * 2 - 1));
          const trendDays = await listDays(db, since, to);
          return buildTrends({
            today: to, range, days: trendDays, workouts: await listWorkouts(db, since, to),
            liftDays: await liftDays(db, since), lifts: await liftProgress(db, addDays(to, -(Math.max(range, 120) - 1))),
          }).map((t) => t.text);
        })(),
        lifts: await listLifts(db, from, to),
        journal: (await listJournal(db, from, to)).map((j) => ({ date: j.date, text: j.body })),
        units: { kcal_eaten: "calories", protein_g: "grams", carbs_g: "grams", fat_g: "grams", fiber_g: "grams", active_kcal: "calories", weight_lb: "pounds", resting_hr: "beats a minute", vo2max: "mL/kg/min", duration_min: "minutes", distance_mi: "miles", energy_kcal: "calories", temp_f: "°F", avg_hr: "beats a minute", max_hr: "beats a minute" },
        url,
      };
    }),
  );

  server.registerTool(
    "save_health_data",
    {
      description:
        "Save what you read from Apple Health on the owner's phone, a weight he told you, or his fiber from a food-app screenshot (entered_days). Use it once per pull, with everything in ONE call. Copy Apple Health's results as returned: the statistics rows for each data type (with period_start, sum or average, and unit) and each workout sample ({ start, end, value: { workout } }). Do not convert dates or units and do not round: the server stores the local date, converts kilograms to pounds, rounds, flags incomplete days and never duplicates a workout. Include today; it is saved again on every pull. Send `from` and `to` (the range you asked for) and list every type you asked for, even an empty one: a number saved earlier that Apple Health no longer returns for a day in that range is cleared. Never send 0 for a day with no data: leave the day out. Returns a one-line receipt and a link to pass on.",
      inputSchema: healthSaveSchema,
    },
    safe(async (a) => {
      const result = await saveHealth(ctx, a);
      return { receipt: saveReceipt(result), url, ...result };
    }),
  );

  // ---------- the coach ----------

  server.registerTool(
    "coach_brief",
    {
      description:
        "Everything the coach needs to tell the owner what to do today, in one call: the lifting session that is up (the one in progress, else the next one owed) with each lift's prescription (sets, reps, RPE, rest, warm-up sets, technique, the program's notes, substitutions), what he did last time on that lift, the suggested weight for today, a rough time for the lift, the how-to video link, and what is already logged; the queue of sessions still owed; how the current program week is going; whether today is a rest day or basketball; the next seven days: what he planned each day and when (each lifting day with the session that falls there), what is fixed, and the weather forecast; recent workouts; his last 7 days of notes; and his macro targets with yesterday's food against them. Use it for 'what are my lifts today', 'what's my workout', 'what's next', 'I have 30 minutes', 'how do I do this lift', 'what's coming up this week', 'what's Wednesday', 'which days should I bike', 'what's the weather this week', and before logging so you know the slot names. Set include_program_notes for the warm-up protocol and the weak points table.",
      inputSchema: z.object({
        include_program_notes: z.boolean().optional().describe("Also return the program's general notes: the warm-up protocol and the weak points table. Long; ask only when needed"),
        session: z.string().optional().describe("Only to look at a session out of order: its name from `queue`, e.g. 'Full Body #4'. Leave out for the session that is up"),
        week: z.number().int().optional().describe("With `session`, which program week, when he means a later one"),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => ({
      ...(await (async () => {
        const brief = await coachBrief(db, new Date(), { includeProgramNotes: !!a.include_program_notes, session: a.session, week: a.week, forecast: await getForecast(db) });
        return { ...brief, recent_workouts: brief.recent_workouts.map(workoutBrief) };
      })()),
      macros: await (async () => {
        // The targets now, yesterday's food against the targets that applied to it, and this week so far.
        const today = todayInTz();
        const yesterday = addDays(today, -1);
        const view = await macroView(db, await listDays(db, addDays(today, -13), today), today);
        const t = view.current;
        const yDay = (await listDays(db, yesterday, yesterday))[0];
        const y = yDay ? compareDay(yDay, view.history) : null;
        return {
          targets: t
            ? Object.fromEntries(
                Object.entries({ from: t.effective_date, kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, fiber_min_g: t.fiber_min_g, fiber_max_g: t.fiber_max_g, note: t.note, goal: t.goal, goal_rate_lb_per_week: t.goal_rate_lb_per_week, start_weight_lb: t.start_weight_lb, goal_weight_lb: t.goal_weight_lb }).filter(([, v]) => v !== null),
              )
            : null,
          yesterday: y && Object.values(y.actual).some((v) => v !== null)
            ? { date: yesterday, eaten: y.actual, ...macroBrief(y), ...(y.incomplete ? { incomplete: true } : {}) }
            : { date: yesterday, eaten: null },
          this_week_average: view.week_average,
        };
      })(),
      forecast_for: WEATHER_PLACE,
      url,
    })),
  );

  server.registerTool(
    "log_lift",
    {
      description:
        "Log the working sets the owner did in the lifting session that is up (or, with `session`, one he is doing out of order). Use it as soon as he tells you what he did ('leg press 270 for 8, 8, 7' is three sets). Send finished: true only when he says the session is done; until then it stays in progress, even across days. `exercise` is the slot's `prescribed` name from coach_brief. Logging a set again replaces it. An exercise that is not in the session is refused with the session's exercise names; ask him which he meant. Returns a one-line receipt.",
      inputSchema: liftLogSchema,
    },
    safe(async (a) => {
      const result = await logLift(ctx, a);
      return { receipt: liftReceipt(result), url, ...result };
    }),
  );

  server.registerTool(
    "swap_exercise",
    {
      description:
        "Make a standing change to the program: from now on the owner does a different lift wherever the program prescribes this one. Use it when he says his gym lacks the equipment, when he prefers a substitution for good, and to set his pick for a weak-point exercise. His history and suggested weight then follow the new lift. Not for a one-day change (use log_lift's `did`). use_instead: null goes back to the program's own exercise.",
      inputSchema: swapSchema,
    },
    safe(async (a) => {
      const r = await swapExercise(ctx, a);
      const receipt = r.use_instead
        ? `From now on: ${r.use_instead} in place of ${r.prescribed} (${count(r.sessions_affected, "session")} of the program).`
        : `Back to ${r.prescribed}, as the program has it.`;
      return { receipt, url, ...r };
    }),
  );

  server.registerTool(
    "set_week_plan",
    {
      description:
        "Save the owner's plan for a week, day by day: what he will do each day and when (morning, midday, afternoon, evening, anytime): lifting, a ride, a hike, a walk, rest, and so on. Use it whenever he plans or changes his week ('lift Monday, Tuesday and Wednesday mornings', 'hike Tuesday afternoon', 'move Saturday's ride to Sunday', 'nothing planned Friday'). Send `days`: each day he talked about with everything planned on it (that day's plan is replaced; other days are left alone). A lifting day gets the session that falls there by itself. `bike_days` is only for a number of rides without chosen days; `note` is for anything else about the week, never the plan itself. Weeks start on Monday; plan one week per call.",
      inputSchema: weekPlanSchema,
    },
    safe(async (a) => {
      const plan = await setWeekPlan(ctx, a);
      return { receipt: planReceipt(plan), url, plan };
    }),
  );

  server.registerTool(
    "skip_session",
    {
      description:
        "Mark a lifting session as one the owner is NOT doing, so the program moves on. Use it ONLY when he says so outright ('skip arms this week', 'I'm not doing that one'); he wants every session done otherwise, so never use it because he is busy, tired or behind, and never suggest it. With no arguments it skips the session that is up; `session` names another from coach_brief's queue. A session that already has sets logged is finished with log_lift instead. Can be taken back with undo_last.",
      inputSchema: skipSchema,
    },
    safe(async (a) => {
      const r = await skipSession(ctx, a);
      return { receipt: `Skipped ${r.skipped}.${r.next ? ` Next up: ${r.next}.` : ""}`, url, ...r };
    }),
  );

  server.registerTool(
    "undo_last",
    {
      description:
        "Take back the last change you made to the owner's record here, as a whole: all the sets from one log_lift, a session marked finished, a skip, a note, a review, a swap, a week plan, or an entire Apple Health save. Use it when he says 'undo that', 'that was wrong', 'I didn't mean to finish it'. It undoes exactly one change per call, the most recent one not already undone; calling it again undoes the one before, so call it once for each thing he wants gone. Not needed to correct a single set: log that set again and it replaces. Returns what was taken back.",
      inputSchema: z.object({}),
    },
    safe(async () => {
      const r = await undoLast(ctx);
      if (!r) return { receipt: "There is nothing to undo.", url };
      const minutes = Math.max(0, Math.round((Date.now() - Date.parse(r.made_at)) / 60000));
      const ago = minutes < 1 ? "just now" : minutes < 90 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} hours ago` : `${Math.round(minutes / 1440)} days ago`;
      return { receipt: `Undone: ${r.what} (saved ${ago}).`, url, ...r };
    }),
  );

  server.registerTool(
    "save_review",
    {
      description:
        "Save a review you have just given the owner of a stretch of his training and health (a week, a month), so it shows on his dashboard under the coach's review. Use it right after you answer 'how was my week', 'analyze the past week', 'am I improving' and the like. Send the review as you gave it: short plain paragraphs, and lines starting with '- ' for a list; no headings, tables or other markdown. The dashboard shows the most recent one.",
      inputSchema: reviewSchema,
    },
    safe(async (a) => {
      const review = await saveReview(ctx, a);
      return { receipt: `Saved the review of ${shortDay(review.from_date)} to ${shortDay(review.to_date)} to your dashboard.`, url };
    }),
  );

  server.registerTool(
    "add_journal",
    {
      description:
        "Keep a note or journal entry for a day, in the owner's own words: how he is feeling, how a session went, sleep, soreness, anything he says to note or journal. Use it whenever he says 'note that...', 'journal: ...', or tells you how he feels and wants it kept. Any number per day. The coach reads these back in coach_brief and get_health_data.",
      inputSchema: journalSchema,
    },
    safe(async (a) => {
      const entry = await addJournal(ctx, a);
      return { receipt: `Noted for ${shortDay(entry.date)}.`, url };
    }),
  );

  server.registerTool(
    "read_me_first",
    {
      description:
        "How to help the owner with this server: how he works, the Apple Health sync routine, how to coach his lifting, his macro targets, and what to say after a change. Call it once at the start of a chat if your app did not already give you this server's instructions (Claude does; some other apps do not). It returns the same text every chat is meant to start with.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => ({ instructions: INSTRUCTIONS, url })),
  );

  server.registerTool(
    "set_macro_targets",
    {
      description:
        "Save the owner's daily macro targets from his food app's check-in (the app he logs food in, such as Carbon Diet Coach or MacroFactor). Use it when he shares the check-in, usually a screenshot, or says his macros changed. Copy the numbers exactly as shown: calories, protein, carbs, fat, and the trend weight, goal rate, goal, start weight and goal weight when the screen shows them (weights in pounds). Don't recompute calories from macros. effective_date is the check-in date (default today); sending the same date again replaces that check-in. Leave the fiber range out to keep the last one (30 to 40 g to start). Returns a one-line receipt and a link to pass on.",
      inputSchema: macroTargetsSchema,
    },
    safe(async (a) => {
      const { targets, replaced } = await setMacroTargets(ctx, a);
      return { receipt: targetsReceipt(targets, replaced), url, targets };
    }),
  );

  server.registerTool(
    "get_macro_targets",
    {
      description:
        "Read the owner's macro targets: the ones in effect now, and the history of his check-ins (date, calories, protein, carbs, fat, fiber range, trend weight, goal rate, note), oldest first. Use it for 'what are my macros', 'what are my targets', 'how have my targets changed'. With `from` and `to`, only the check-ins that applied in that stretch. To see how his eating compared with the targets, use get_health_data instead.",
      inputSchema: z.object({
        from: z.string().optional().describe("First date, YYYY-MM-DD. The check-in in effect on it is included"),
        to: z.string().optional().describe("Last date, YYYY-MM-DD"),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const from = a.from ? dayString.parse(a.from) : undefined;
      const to = a.to ? dayString.parse(a.to) : undefined;
      if (from && to && from > to) throw new InputError("`from` is after `to`.");
      const today = todayInTz();
      const all = await allMacroTargets(db);
      const strip = (t: MacroTargets) => {
        const { id: _id, created_at: _c, updated_at: _u, ...rest } = t;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
      };
      const current = [...all].reverse().find((t) => t.effective_date <= today) ?? null;
      const history = await macroTargetHistory(db, from, to);
      return { today, current: current ? strip(current) : null, history: history.map(strip), ...(all.length ? {} : { note: "No targets saved yet. They come from his food app's check-in." }), url };
    }),
  );

  server.registerTool(
    "coach_library",
    {
      description:
        "Look something up in the sources the owner trusts and loaded into his library: books (a program's handbook, say) and articles from sites he trusts. Use it BEFORE answering any training question (progressive overload, RPE, intensity techniques, substitutions, cardio, deloads, rest days, running the program on a different schedule, recovery, weak points) or any diet question (calories, macros, protein, fiber, weight loss, maintenance, reverse dieting) so the answer is what the source says: for a book, with its page; for an article, with its title (section) and link (url). With no arguments it lists the documents with their chapters or article titles. With `search` it returns the pages that contain every word (use two or three plain words, e.g. 'cardio recovery', 'protein per meal'); add `document` to look in one source only. With `document` and `page` it returns that page or article whole. If nothing comes back, the library does not cover it: say so.",
      inputSchema: z.object({
        search: z.string().optional().describe("Words that must all appear on the page"),
        document: z.string().optional().describe("Limit the search to one document, or with `page` read one page of it"),
        page: z.number().int().optional().describe("A page number printed in the book, or an article's number from a search. Needs `document`"),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      if (a.page !== undefined) {
        if (!a.document) throw new InputError("Give the document as well as the page.");
        const page = await libraryPage(db, a.document, a.page);
        if (!page) throw new InputError(`There is no page ${a.page} in "${a.document}".`);
        return { document: page.document, page: page.page, section: page.section, ...(page.url ? { url: page.url } : {}), text: page.body };
      }
      if (a.search) {
        const hits = await searchLibrary(db, a.search, a.document);
        return hits.length ? { pages: hits } : { pages: [], note: "No page in the library has all of those words. Try fewer or different words; if it still finds nothing, the library does not cover it." };
      }
      return { documents: await libraryContents(db) };
    }),
  );

  return server;
}
