# CLAUDE.md

> **This is a template.** It was built by one person, with an AI doing all the coding, and then
> cleaned up to share. Read these notes before changing anything.
>
> - **The idea, in one line:** the owner works from their chatbot, which reads and writes one
>   database that is the canonical record of their health; the website is a dashboard for
>   seeing how they are doing. The server holds every rule, so any chat app works the same.
> - **"The owner" means the person whose health page this is: you**, once you have set it up.
>   Every number, name and note in the code, tests and sample data is made up.
> - **The decisions recorded below are the first owner's**, with his reasons, in his words where
>   quoted. They are kept because the reasons are the useful part. They are not rules for you.
>   When the new owner wants something different, change it, and update this file so it
>   describes their setup, not his.
> - **Nothing is set up yet.** `SETUP.md` has the steps. Anything written `YOUR-...` or
>   `YOUR_...` (in the `wrangler.jsonc` files and in the docs) is a blank to fill in.
> - **No program, book or article ships with it.** `scripts/sample-program.json` is a made-up
>   program for trying it locally. The owner loads their own program and library (SETUP.md).
> - Days are counted in `America/New_York`, and the forecast is for New York. `SETUP.md` lists
>   where to change both.

Notes for the next AI session that fixes or extends this project. The owner does not read or edit
the code. Favor clarity and easy repair over cleverness. Explain things in plain language.
Read this whole file before changing anything.

## What this is

A private health record for the owner. Only they can reach it. It is a project of its own: its
own Workers, its own database, its own backup bucket, its own login apps. (Its sister template,
a project dashboard for tasks and people, is built the same way and shares nothing with it.)

It has two faces on one D1 database:

- **The chatbot is where he works.** In the first owner's words: "It needs to be interactive
  with my chatbot, which will be kind of like my primary interaction, and use the site as a
  dashboard, database, and tracking to see how I'm doing. Also, we can have the MCP, so updates
  have one central location." He tells Claude on his phone to update the page; Claude reads
  Apple Health with its own tool and saves what it got here through the chatbot Worker.
- **The website is where he looks**: https://health.YOUR-DOMAIN.com. It shows the state of
  things. It has no AI inside it and reads nothing from outside itself but the weather.

Because this is health data, privacy rules are strict. See "Rules".

## The Apple Health data spec: follow it as written

The first owner wrote a spec, "Apple Health Data Spec for the Fitness MCP": what the Claude phone
app's Apple Health tool returns, the tables to store it in, and seven rules for writing. **It is
the specification for this part of the project.** A first version here departed from it
(different table and column names, extra numbers, its own idea of an unfinished day) and he
was blunt: build what the spec says. So:

- The tables in migration 0004 are the spec's, with its names, columns and types:
  `daily_metrics`, `weighins`, `workouts`, `workout_stats`.
- Only the spec's data types are pulled (its section 2): dietaryEnergyConsumed, dietaryProtein,
  dietaryCarbohydrates, dietaryFatTotal, activeEnergyBurned, stepCount, bodyMass,
  restingHeartRate, vo2Max, and workouts. Fiber (`fiber_g`, migration 0010, from the macro
  targets brief) is tracked too, but many food apps do not send it to Apple Health ("apparently fiber
  can't be sent through Apple Health"): he enters it from food-app screenshots
  (`entered_days` on `save_health_data`; `ENTERED_TYPES` in `health.ts`), a sync never asks for
  it, and a sync never clears it. Do not add body fat, sleep, blood pressure or anything else
  unless he asks.
- Its rules are carried out **by the server** (`packages/core/src/health.ts`, with a test per
  rule in `test/health.test.ts`), not left to the chatbot:
  1. UTC period starts become his local date (`localDay`; a start that is not his local
     midnight is refused).
  2. Missing is NULL, never 0: only what was sent is written.
     **Bent on 2026-11-16, at his word** ("it's ok if it bends the rule. we made the rule
     thinking ahead but don't know every situation"): a number saved earlier that Apple Health
     no longer returns, for a day the pull covered, is cleared back to NULL, so that deleting
     food in Apple Health deletes it here. The covered days are `from` to `to` on
     `save_health_data` (the chatbot is told to send the range it asked for), else the first
     to the last row of that type. Only types listed in the call are cleared. Weights too, since
     2026-11-16 ("It should match my apple health data", after a test weigh-in on Nov 15 stayed):
     an Apple Health weigh-in on a covered day that Apple Health no longer has is removed (the
     row, since `lb` cannot be empty); a texted one never is. Fiber, which he enters from his food app,
     never is. The receipt says what was cleared, and undo puts it back (undo re-creates a removed
     row from the change record). Tests in `test/health.test.ts`.
  3. Today is partial: its row is saved on every pull and never counted in averages (`partial`).
  4. bodyMass is converted from kg to lb (x 2.20462).
  5. `incomplete` is flagged when kcal is under 1,500 or identical to the day before (the food
     app carries a day forward when nothing was logged).
  6. Workouts are deduped on `start_utc` plus `activity_type`.
  7. Health data only comes through on a turn sent from the Claude phone app, so nothing
     scheduled can refresh the database. (Said in the chatbot's instructions.)
  Rounding on write: kcal and steps to whole numbers, grams to 0.1, weight to 0.1 lb. Cumulative
  types use `sum`, discrete types use `average`. Weigh-ins have two sources, `apple_health` and
  `texted`; when a date has both, Apple Health wins.
- When the spec and an idea of your own disagree, the spec wins (he can bend it, as with rule 2). If the spec is silent or seems
  wrong for him, ask; do not improvise.

The spec itself is not in the repo. Its content is restated above and in the comments of
migration 0004 and `health.ts`.

## What goes on the page

**Built (2026-11-15):** the daily numbers and weigh-ins from the spec; the workouts Apple Health
recorded; **macro targets from his food app** and each day's food against them (2026-11-16, see "Macro
targets"); and **the coach**: his lifting program, what he lifted, the week's plan, his journal,
and a library of the sources he trusts, so the coach answers from them.
See "The coach" below.

**The page is his health dashboard, in the full sense.** He asked (2026-11-15): "you're going to
update the site so it is a comprehensive health dashboard for me right?" and then, when the
first answer was a quiet list of rows: "Health dashboard site is a comprehensive look at me.
KPIs, graphs, trends, analysis etc". So it is dense on purpose: headline tiles with their
change, real charts, computed trends, and the coach's written review. Do not strip it back to
a minimal list; that was tried and he asked for more. (His project dashboard went the same way:
its first, quieter version he found "plain and empty".) See "How the page is put together".

**Not built yet:**

- **Goals for anything but food and weight.** Food has targets and weight has a goal weight,
  both from his food app's check-in (see "Macro targets"). Ask him before adding more.
- **Per-weekday targets.** Some food apps set different targets by day of the week. If he
  uses that, add an optional per-weekday override to `macro_targets` (the brief says: later, not
  in the first build).
- A way to remove one set, one journal entry or one recorded workout that is not the most recent
  change (undo only takes back the latest change, then the one before).
- The page still cannot change anything except "Back up now". He works through his chatbot.

What is known about his taste, from the dashboard: bare minimum; a page shows what he needs and
nothing else; an empty state is never the loudest thing; no counts, cards or color for
decoration; no filler line repeated down a list; plain copy. He does not want his decisions
second-guessed or a long back-and-forth: when he gives a spec or a decision, build it. His design
language is the `quiet-depth` skill: load it before any UI work. Load the `dataviz` skill before
any chart.

## The coach

His words (2026-11-15): "Basically, we're building out a coach and then able to track things.
The coach will work through the MCP." The coach is his chatbot. This project gives it the facts
in one call and keeps what he tells it. Everything is in `packages/core/src/coach.ts` and
`library.ts`, with tests.

**How his training fits together**

- He lifts from a bought program loaded into the database (his was ten weeks, five sessions a
  program week). "Obviously I'm going to be doing this over 10 days": one program week is spread
  over about ten days (`programs.cycle_days`). `scripts/sample-program.json` is a made-up
  four-week, three-session program in the same shape, for trying it out.
- So **sessions take turns.** The next session is always the first one, in program order, that
  he has not finished. A missed day changes nothing, and nothing ever says he is behind. (His program's
  handbook allowed this, as most do.)
- "On Thursdays, I play basketball" (`weekly_fixtures`). The program's mandatory rest days are
  kept as a flag on the session before them (`rest_after`).
- "When I'm starting my week: how many days do I plan to bike?" (`week_plans`; weeks start on
  Monday). Rides are counted from Apple Health workouts. He bikes "probably 3 to 5 times a week,
  even though I can't start that yet".

**Getting every session in, his way.** "If I don't follow it day to day to a T, that can be
okay, but I do want to get all the workouts in unless I explicitly say I'm not doing this."

- Every session stays owed until he **finishes** it or **explicitly skips** it (`skipSession`,
  the `skip_session` tool; a `lift_sessions` row with `skipped_at`). Nothing is ever skipped or
  shortened by itself, and the chatbot is told never to suggest it.
- He may do any owed session **out of order** (`session` on `coach_brief` and `log_lift`). The
  ones he passed over stay first in line (`pickSession`).
- A session may be **split over days**: "I have 30 minutes... I'm going to split up this workout
  between two days". It simply stays in progress until he says it is done; each set records
  the day it was done (`lift_sets.date`). Each lift carries a rough time (`estMinutes`: a minute
  per working set plus the middle of the program's rest range, and a minute and a half per
  warm-up set) so the coach can fit lifts to the time he has.
- "What is up" is the session in progress (the one touched last, if several), else the first one
  owed.

**Undo** ("We also need, for sure, an undo"). Each tool call from the chatbot carries an `op`
(set in `workers/mcp/src/index.ts`); every audit row it writes shares it. `undoLast`
(`audit.ts`, the `undo_last` tool) takes back the most recent op that has not been undone:
every row goes back to its `before`; a row that was added is marked deleted where the table has
`deleted_at`, and removed where it does not (the spec's tables, plans, swaps). Calling it again
takes back the op before. It covers sets, finishing, skipping, notes, swaps, week plans and
Apple Health saves. Program and book loads are not undoable (their actor is `import`).

**Planning the week.** "I should be able to plan out the entire week like AM - lift, afternoon
hike, etc" and "if it's a lifting day, knowing what is coming up" (2026-11-16). A day holds any
number of planned things (`plan_items`, migration 0009): a time of day (morning, midday,
afternoon, evening, anytime), an activity (lift, bike, hike, walk, run, basketball, swim, yoga,
mobility, rest, other) and a few words of detail. He plans through `set_week_plan` `days`: each
day sent is that day's whole plan (unchanged items kept, the rest marked deleted, new ones
added); days not sent are left alone. **Which session falls on a planned lifting day is never
stored**: `planItems` in `coach.ts` works it out each time, giving the sessions still owed, in
turn, to the lifting days from today on (the one in progress first), with its program week, how
many lifts and about how long. So it stays right when he lifts on another day or skips one.
(The first chat to plan a week, before this existed, put his lifting days in the week's note;
the chatbot is now told never to.) `planned_days` (bike days only) is retired: migration 0009
copied its rows into `plan_items`; `bike_dates` on `set_week_plan` still works and writes
bike items.

**Bike days and the weather.** "We need to build out the weather and me choosing the bike days."
He chooses the days (a bike item in his plan). The forecast (`weather.ts`) comes from the US
National Weather Service for New York (Central Park): the one outside thing the site reads,
fetched only when the page or the coach asks, kept an hour in `weather_cache`, and nothing about
him is sent. The briefing's `days_ahead` lays out the next seven days: forecast, what he planned,
what is fixed, whether he rode. The coach points to the best days; he decides. There are no
"good day to ride" thresholds in the code on purpose: none have been agreed with him.

**Progressive overload** ("suggesting weight, what I did last week or last time on that lift").
For every lift the briefing gives what he did last time on that lift and a suggestion for today
(`suggest` in `coach.ts`). It is the program's own rule (double progression, as his handbook put it): on a lift with a rep
range, add a rep to at least one set each time, and only when every set reaches the top of the
range add weight and start again from the bottom ("double progression"); on a lift with a fixed
rep count, keep the reps and add weight when form allows. In a semi-deload week it holds back.
The step up is 5 lb (2.5 lb under 50 lb), worded as "about" because equipment differs. The
suggestion is worked out on the server; the chatbot is told to use it as given.

**Changing a lift** ("the flexibility to change a lift, because I'm going to have to do that
quite a bit... based on what's available at my gym").

- A **standing swap** (`exercise_swaps`, the `swap_exercise` tool): wherever the program
  prescribes X he does Y, for the rest of the program. His history and suggestion follow Y. It
  is also how he fills a weak-point slot with his pick.
- A **one-day change** is just logged as what he did (`did` in `log_lift`).
- A set is always filed against a slot of the session (the program's `prescribed` name). A name
  that is not in the session is refused with the session's names; nothing lands on a guess.

**How-to videos.** Every exercise and substitution in his program's spreadsheet linked to a short
video.
The link is stored with the exercise and comes back in the briefing ("a link to how to do the
lift... that I can just open up at the gym real quick").

**Notes and journal** (`journal_entries`): "notes for the day, logs, and... a journal for saying
how I'm feeling", in his words, any number a day.

**The weekly review.** "Can you analyze the past week, take in all the information, and give me
a rundown of some trends that you're seeing with my notes and stuff like that, like workouts? Am
I improving? How does this relate to eating and everything else?" `get_health_data` returns the
days, workouts, every lift with its sets and the journal for a range, so the chatbot has it all
in one place. The analysis is the chatbot's; the site only supplies the record.

**The library** (`library_pages`, the `coach_library` tool). The owner loads the sources he
trusts, so the coach answers from them instead of from health advice in general: a program's
handbook, training or nutrition books (one row per page, cited by page), and articles from a
website he trusts (one row per article: its title in `section`, its link in `url`, migration
0008). The rule, borrowed from a cited coach project he pointed at: **the coach never invents
what a source says.** It looks the question up, answers from the page or article with its name
and page or link, and says so when the library does not cover it. Search is plain: every word
must be on the page. Articles are much longer than a book's page and search ranks by how often
the words appear, so the chatbot is told to search one document at a time when it knows which
fits; a search sends whole pages only up to about 25,000 characters (`WHOLE_PAGES_BUDGET` in
`library.ts`), the rest as the lines around the words. Articles often end with a sales pitch;
the chatbot is told to leave it out.

**Bought material stays out of GitHub.** A program spreadsheet and books are things the owner
bought, and a website's articles are someone else's writing. Their content lives in the
database (loaded by the scripts below), and the original files can go in the private bucket
under `sources/`. `.gitignore` covers `*.xlsx` and `program*.json`; never commit the files, the
parsed JSON, or long passages of them.

**Loading a program or the library** (from a session with the Cloudflare token; work in a
scratch folder, not the repo):

- **A program**: `scripts/import-program.ts <program.json>` loads a JSON file in the shape of
  `scripts/sample-program.json` (what may be in it: `programImportSchema` in `coach.ts`). For a
  spreadsheet, have the AI write a small parser for its layout into that shape (the first
  owner's was a Python script reading his program's spreadsheet with `openpyxl`).
- **A book**: `scripts/parse-pdf.py` turns a PDF into pages (its comment shows how), then
  `scripts/import-library.ts` loads them.
- **A website's articles**: scrape each article to Markdown (the first owner used the Firecrawl
  connector from a Claude Code session, since the cloud sandbox cannot fetch most sites; one
  scrape per article), have the AI write a parser for that site's layout into the same JSON
  shape `parse-pdf.py` makes (title in `section`, link in `url`), and load it with
  `import-library.ts`. Read the parsed list before loading: a post that parsed to a few words
  means the page was laid out differently. It is a copy; nothing refreshes it.

```bash
NODE_USE_ENV_PROXY=1 npx tsx scripts/import-program.ts /tmp/x/program.json          # add --local for the dev database
python3 -I scripts/parse-pdf.py /tmp/x/book.json "My training book" "1:Chapter one;16:Chapter two" book.pdf
NODE_USE_ENV_PROXY=1 npx tsx scripts/import-library.ts /tmp/x/book.json
```

`NODE_USE_ENV_PROXY=1` matters in the Claude Code cloud sandbox: without it Node's `fetch` skips
the proxy that supplies the real Cloudflare token, and the database answers "Authentication
error". Loading a program archives the one before it (what he lifted stays, and "last time"
still finds it by the lift's name). Loading a document again replaces its pages.

## Macro targets

The first owner's brief "Health Dashboard: Macro Targets and Tracking" (his food app was Carbon
Diet Coach; MacroFactor and others work the same way): "Each Monday after the check-in, he sends a screenshot to Claude and the targets get
saved. The dashboard then shows each day's intake against the targets that were in effect that
day, and the weekly averages against target." Everything is in `packages/core/src/macros.ts`,
with tests in `test/macros.test.ts`.

- **`macro_targets`** (migration 0010): one row per check-in date: kcal, protein, carbs, fat,
  fiber range (30 to 40 g to start), source (the app's name), trend weight, goal rate (lb a week), note;
  and (0011, at his word, 2026-11-16) The food app's goal ("fat loss"), start weight and goal weight.
  Sending the same date again replaces that row. A fiber range, goal or goal weights left out
  carry forward from the check-in before.
- **The goal weight on the page:** beside the weight's headline number, and as a dashed line on
  the weight chart only when it falls inside the chart's own range (drawing a far-off goal would
  flatten the line he watches). The weight change is coloured green toward it, red away.
- **Which targets apply on a date:** the check-in with the latest `effective_date` on or before
  it (`targetsOn`). A day before the first check-in has none.
- **A day against its targets** (`compareDay`): actual minus target for calories, protein, carbs
  and fat; whether each is within tolerance (`MACRO_TOLERANCE`: calories 5%, the rest 10%, the one
  place to change them; the page and the chatbot both get them from the server); fiber "under",
  "in range" or "over". Something not logged is left out, never counted as zero.
- **Weekly averages** (`weekSummaries`): Monday to Sunday, average eaten against the average of
  the targets in effect on the days counted. Today (partial) and incomplete days are left out, as
  in every other average.
- **Tools:** `set_macro_targets` (copy the check-in's numbers exactly; never recompute calories
  from macros) and `get_macro_targets` (now and the history). `get_health_data` gives each day
  its targets, `vs_target`, `on_target` and `fiber_status`, plus `macro_weeks`; `coach_brief`
  gives the targets now, yesterday against them and this week's average.
- **The page:** "Today" (a bar per macro: a tick at the target with its tolerance shaded, and
  fiber's range shaded; "In progress"), "This week" (each day as actual over target, a green
  check when within tolerance, this week's and last week's averages at the foot), "Target
  check-ins" (every check-in, with what changed), and a dashed rule on the weight chart at each
  check-in. All in `apps/web/src/components/Macros.tsx`. The Overview shows "Today" only once
  this week has food logged; the Food page always shows them once there are targets.
- **Fiber comes from food-app screenshots**, not Apple Health (many food apps do not send it there).
  "Update my fiber tracking" with a screenshot: `save_health_data` `entered_days`, one entry per
  day the screen shows, grams exactly as shown; saving a day again replaces it. A pull never
  clears entered fiber, even one that lists dietaryFiber empty (an old chat might). Works from
  any chat app. The brief's 30-day backfill through Apple Health was dropped for this reason.

## Architecture

Two Cloudflare Workers share one D1 database (`health`) and one data layer (`packages/core`).
One R2 bucket holds the backups.

- **The page Worker** (`workers/app`, name `health`) serves three things:
  - the page: the React app, bundled into the Worker script by `scripts/embed-web.ts`;
  - the JSON API under `/api/*` (Hono);
  - the nightly backup (`scheduled`, on the timer in `wrangler.jsonc`).
  `health.YOUR-DOMAIN.com` is behind Cloudflare Access (one-time PIN to the owner's email, only
  his email allowed). On top of that, the Worker itself checks **every request, page or API**:
  it must carry a valid Access JWT (`Cf-Access-Jwt-Assertion`), verified with `jose` against the
  team's certs and this app's AUD tag, and the email must match `OWNER_EMAIL`. If any setting is
  missing the Worker answers 503; a missing or bad login gets 401; another person's login gets
  403. It never falls back to open (`packages/core/src/access.ts`, with tests). The workers.dev
  address and preview addresses are switched off, so the custom domain is the only way in.
  Requests that change something (anything but GET) are refused when the browser says they came
  from another site (`Origin` check in `workers/app/src/index.ts`).
- **The chatbot Worker** (`workers/mcp`, name `health-mcp`): a stateless remote MCP server at
  `/mcp` (Streamable HTTP, `createMcpHandler` from `agents/mcp/server` with
  `@modelcontextprotocol/server` v2, no Durable Objects). **One way in: OAuth**, handled by
  `@cloudflare/workers-oauth-provider` (`OAuthProvider` in `src/index.ts`). A chat app discovers
  the server, registers itself (`/oauth/register`), and sends the owner to `/authorize`. That one
  path is behind Cloudflare Access, and `src/authorize.ts` verifies the Access login again before
  showing an Allow / Deny page. Tokens last an hour and refresh for as long as the app is used at
  least every 90 days. Anything else gets 401.
  **There is no long-lived token**, unlike the dashboard's `MCP_TOKEN`. `MCP_TOKEN` here works
  only when `ENVIRONMENT=local` and the request is to localhost, for the local test scripts.
  The OAuth library expects a Workers KV namespace named `OAUTH_KV`; `src/index.ts` hands it
  `dbKv()` from `packages/core/src/kv.ts`, which stores the same records in the D1 table
  `oauth_kv`. It lives on workers.dev on purpose (see "Names").
- **`packages/core`**: the Access check, the database wrapper, the health record (the spec), the
  change record, the backup. **All SQL lives here.** Both Workers and the tests import from
  `@health/core`.
- **Frontend** (`apps/web`): React 19, Vite, Tailwind 4, TanStack Query. Every server call is in
  `apps/web/src/api.ts`. It imports only *types* from `@health/core`, so none of the server code
  ends up in the browser; what a number is called comes from the API (`fields`). Six pages
  with `react-router-dom` (the Worker answers every address with the page); icons are
  `lucide-react`, bundled like the rest.

### The tables

| Table | What it holds |
| --- | --- |
| `daily_metrics` | spec: one row per local date: kcal_eaten, protein_g, carbs_g, fat_g, fiber_g (added in 0010), active_kcal, steps, resting_hr, vo2max, incomplete, pulled_at |
| `macro_targets` | his food app's check-ins: one row per check-in date (kcal, protein, carbs, fat, fiber range, trend weight, goal rate, note); each holds until the next |
| `weighins` | spec: one row per date: lb, source (`apple_health` or `texted`), pulled_at |
| `workouts` | spec: one row per workout Apple Health recorded, in Apple's units (seconds, meters, kcal, Celsius); unique on start_utc + activity_type |
| `workout_stats` | spec: everything in a workout's `statistics` array (heart rate, steps, power, ...), one row per sample type |
| `programs`, `program_sessions`, `program_exercises` | the lifting program as written: sessions in order (`seq`), each exercise's prescription in the program's own words, its substitutions and video links |
| `exercise_swaps` | his standing swaps: wherever the program says X, he does Y |
| `lift_sessions`, `lift_sets` | what he lifted. A session is finished when `finished_at` is set and skipped when `skipped_at` is; until then it is in progress, across days if need be. A set is unique on session, lift and set number, so logging it again replaces it; it carries the day it was done |
| `week_plans` | per week (Monday): how many days he plans to bike, and a note |
| `plan_items` | his plan for each day: time of day, activity, detail (`deleted_at` when he changes it). Which session falls on a lifting day is worked out, not stored |
| `planned_days` | retired: the bike days before the planner; its rows were copied into `plan_items` |
| `weather_cache` | the last forecast read, one row per place |
| `weekly_fixtures` | what happens on the same weekday every week (Thursday: basketball) |
| `journal_entries` | his notes and journal, in his words |
| `reviews` | the coach's written reviews of a stretch (a week, a month); the dashboard shows the latest |
| `library_pages` | the coach's library: the books he loads, one row per page, and articles from websites he trusts, one row per article (title in `section`, link in `url`) |
| `audit_log` | every change: who made it (`mcp:claude`, `import`), the row before and after, the request it belonged to (`op`), and whether it has been undone |
| `backup_runs` | how each backup went |
| `oauth_kv` | the chatbot's sign-ins (tokens only as hashes) |

### Repo map

```
CLAUDE.md, README.md          this file; plain-language overview for the owner
migrations/                   numbered D1 SQL migrations (never edit one that has been applied)
packages/core/src/            access.ts (the login check), db.ts (database wrapper),
                              health.ts (the Apple Health spec: what the chatbot sends, the
                              rules on write, the reads), coach.ts (the program, where he is
                              in it, the suggested weight, swaps, logging lifts, the week's
                              plan, the journal, the briefing, skipping, lifts over time),
                              insights.ts (the dashboard's trends: plain sentences worked out
                              from the record), macros.ts (his food app's targets, which apply on a
                              date, each day and week against them), weather.ts (the forecast: the only code that
                              reads anything outside), library.ts (the library: load, list, search), audit.ts
                              (the record of every
                              change), backup.ts (the nightly copy), kv.ts (storage for the
                              chatbot's sign-ins), index.ts
packages/core/test/           Vitest tests (node:sqlite in memory with the real migrations,
                              and a pretend bucket). health.test.ts has a test per spec rule
apps/web/src/                 the page: App.tsx, api.ts, styles.css,
                              pages.tsx (the six pages), components/ (ui.tsx the card, the
                              headline number, the ring, the switch; page.tsx the shared data
                              and grid; charts/Chart.tsx the line and bar charts and their
                              card; Charts.tsx the chart cards; Numbers.tsx "Your numbers";
                              Analysis.tsx the coach card and trends; NextLift.tsx,
                              WeekAhead.tsx, Lifts.tsx, Workouts.tsx, Journal.tsx, Macros.tsx
                              the food-against-targets cards),
                              lib/ (series.ts bars, rolling averages and the tiles' numbers;
                              scale.ts axis values; measures.ts which days count; lifts.ts;
                              backupLine.ts), tests beside them
workers/app/                  the page Worker (src/index.ts: login, routes, the page, the timer)
workers/mcp/                  the chatbot Worker (src/index.ts sign-in and routing,
                              src/authorize.ts the Allow / Deny page, src/tools.ts every tool
                              and the standing instructions)
scripts/                      embed-web.ts (bundles the page into the Worker), oauth-smoke.ts
                              (tests the chat-app sign-in, local only), seed-local.ts (a month
                              of made-up data in the spec's shapes, local only),
                              import-program.ts (a program in the shape of
                              sample-program.json into the database), parse-pdf.py +
                              import-library.ts (a book into the coach's library),
                              sample-program.json (a made-up program to try it with)
.github/workflows/deploy.yml  checks on every push to main; deploys once the secret exists
```

## Rules

1. **Never edit an applied migration.** Add `migrations/000N_description.sql` instead.
2. **Never hard delete health records.** A wrong number is replaced by saving the right one, and
   the change record keeps what it was. (The library's pages are reference text, not records:
   loading a document again deletes and rewrites its pages.) (Migration 0004 dropped `daily_numbers`, a first-guess
   table made the same day that never held a row. That is the only drop there has been.)
3. **Every write goes through `packages/core`** and records an `audit_log` row (`recordAudit`):
   who, and the row before and after. Keep SQL in `packages/core`.
4. **Database copies never go to GitHub.** No dumps, exports, snapshots or screenshots of real
   data in the repo, in a commit, in a workflow artifact or in a workflow log. Backups are made
   by the Worker and stay in Cloudflare (R2 first, D1 Time Travel second). This is the opposite
   of the dashboard, which commits nightly dumps; do not copy that part.
5. **Never log health data.** `console.error` may say what kind of thing failed, never a request
   body or a row. Error messages returned to the browser or the chatbot follow the same rule.
   The chatbot Worker's `DEBUG_LOG` never records anything sent to or from `/mcp`.
6. **The doors stay as they are.** The page: the Access check on everything, fail-closed; do not
   add a route above the `app.use("*")` check or turn `workers_dev` / `preview_urls` back on.
   The chatbot: OAuth after an Access sign-in is the only way in; do not add a long-lived token
   or key for production without the owner asking for it.
7. **No virtual tables (FTS5) and no `WITHOUT ROWID` tables.** The backup cannot copy them.
8. **Run every check the deploy runs before pushing**:
   `npm run lint && npm run typecheck && npm test`.
9. **Nothing happens behind his back.** The site reads ONE outside thing, the weather forecast
   he asked for (`packages/core/src/weather.ts`, the only code that calls out), and only when
   the page or the coach asks. Nothing else: no analytics, no fonts or scripts from other sites
   (the Content-Security-Policy header in `workers/app/src/index.ts` enforces this for the
   page), no AI key, and it never reads Apple Health; his chatbot does, on his phone. Ask before
   connecting it to anything more.
10. **Tests and local development use made-up data**, never copies of his.
11. **The chatbot hands data over untouched; the server applies the rules.** Dates, units,
    rounding, flags and duplicates are settled in `health.ts`, where they are tested. Do not
    move arithmetic into the chatbot's instructions.
12. **Keep the chatbot's tools few and their descriptions exact.** Every tool description in
    `workers/mcp/src/tools.ts` says when to use it. Before adding a tool, see whether an existing
    one can answer. There are 14 now.
13. **Copyrighted material stays out of the repository**: a program spreadsheet, books,
    a website's articles, anything parsed from them, and long passages. It lives in the database
    and the bucket.
14. **The coach never invents what a source says, and never does its own progression arithmetic.**
    Training answers come from `coach_library` with the page; the suggested weight comes from
    `suggest`. Keep both on the server. The same holds for diet: the coach never invents what an
    article says; it looks it up and gives the article's title and link.
15. **The site has no AI in it, and its analysis never judges.** Trends are arithmetic with a
    test (`insights.ts`) and say what happened, not whether it is good. Written analysis is the
    coach's, saved with `save_review`. Do not add an AI key to the site. A change is coloured
    good or bad only where the better direction does not depend on his goals (`tone` in
    `lib/series.ts`: more steps, active calories, VO2 max or training; a lower resting heart
    rate). Weight joins them once a check-in from his food app carries a goal weight: toward the goal is
    good (`goalWeight` in `kpis`). Food changes stay ink; in the food cards, a day within
    tolerance of its target gets a small green check (`Macros.tsx`).

16. **Everything he sees is in American units** ("everything should be american",
    2026-11-16): pounds, miles, feet and inches, °F, calories. The database keeps what the spec
    says (workouts in Apple's seconds, meters and Celsius; weight already in pounds), and every
    way out converts: the page (`lib/measures.ts`), and what the chatbot is handed
    (`workoutBrief` in `workers/mcp/src/tools.ts`, the `units` of `get_health_data`). The
    chatbot is told never to say kilograms, kilometers, meters or °C, and that a weight from
    Apple Health goes in `statistics` as bodyMass in kilograms (the server converts it), never
    in `texted_weighins`. (The first owner's first syncs sent Apple Health's kilograms as texted
    pounds, and it took a direct fix. A texted weight more than 25% from the last weigh-in is now
    refused as a slip, `WEIGHT_JUMP` in `health.ts`.)

## Where each kind of change goes

| Change | Files |
| --- | --- |
| A new Apple Health data type | only when he asks. A migration adding the column; one line in `DATA_TYPES` in `packages/core/src/health.ts` (identifier, column, sum or average, rounding, slip limits); a line in `FIELDS` if the page should show it; a test. The chatbot's instructions list the types from `DATA_TYPES` by themselves |
| How close counts as on target (5% calories, 10% the rest) | `MACRO_TOLERANCE` in `packages/core/src/macros.ts` (with tests in `test/macros.test.ts`) |
| Which targets apply on a date, a day or a week against them | `targetsOn`, `compareDay`, `weekSummaries` in `macros.ts`; what the page gets: `macroView` |
| The food-against-targets cards (Today, This week, Target check-ins) | `apps/web/src/components/Macros.tsx`, the `.macro-*` rules in `styles.css` |
| The check-in marks on the weight chart | `checkIns` in `components/Charts.tsx`; `marks` on `LineChart` |
| A spec rule (the incomplete threshold, kg to lb, rounding, the midnight check) | `packages/core/src/health.ts`, with its test in `test/health.test.ts` |
| A new kind of record (the workout plan) | new migration; a file in `packages/core/src/` with its types, queries and writes, each calling `recordAudit` (export it from `index.ts`); tests; tools in `workers/mcp/src/tools.ts`; a route in `workers/app/src/index.ts`; the call in `apps/web/src/api.ts`; the UI in `apps/web/src/` |
| How the suggested weight is worked out | `suggest` in `packages/core/src/coach.ts` (with tests in `test/coach.test.ts`); it follows double progression, as the first owner's program handbook put it |
| Which session is next, or what the briefing contains | `position` and `coachBrief` in `coach.ts` |
| Which session is "up", doing one out of order, skipping | `pickSession` and `skipSession` in `coach.ts` |
| The rough time a lift takes | `estMinutes` in `coach.ts` |
| What undo can take back, and how | `UNDOABLE` and `undoLast` in `packages/core/src/audit.ts`; a new table whose writes should be undoable needs a line in `UNDOABLE` |
| Where the forecast comes from, or for which place | `FORECAST_URL` and `WEATHER_PLACE` in `packages/core/src/weather.ts` (its comment says how to find another place's grid square) |
| How the week is planned and kept, the times of day and activities on offer | `SLOTS`, `ACTIVITIES`, `weekPlanSchema` and `setWeekPlan` in `coach.ts` (a new activity also needs the CHECK in a migration and an icon in `components/WeekAhead.tsx`) |
| Which session falls on a planned lifting day | `planItems` in `coach.ts` (with a test) |
| What the next seven days contain | `days_ahead` in `coachBrief` |
| Each lift's line over time | `liftProgress` in `coach.ts`; `components/Lifts.tsx` |
| The week ahead on the page | `components/WeekAhead.tsx`, the `.plan-*` rules in `styles.css` |
| A headline number: which numbers get one, what is compared with what, which changes are coloured | `kpis` and `BETTER` in `apps/web/src/lib/series.ts` (with tests); shown in "Your numbers" (`components/Numbers.tsx`) and on each chart card |
| Which cards a page shows, and in what order | `apps/web/src/pages.tsx`; the sections in the sidebar and tabs: `SECTIONS` in `App.tsx` |
| How a card looks (header, headline number, footer) | `components/ui.tsx` and the `.card` rules in `styles.css` |
| The program ring | `programProgress` in `coach.ts` (with a test); `Coach` in `components/Analysis.tsx` |
| A trend sentence | `buildTrends` in `packages/core/src/insights.ts` (with tests); the chatbot gets the same sentences in `get_health_data` |
| A chart: add one, or change what one shows | `components/Charts.tsx`; the drawing itself is `components/charts/Chart.tsx` |
| How days are grouped into bars (day, week, month) | `buckets` in `lib/series.ts` |
| The ranges on offer (30, 90, 365 days) | `RANGES` in `apps/web/src/App.tsx` and in `workers/app/src/index.ts` |
| Colours: which measure or card is which colour | `apps/web/src/lib/colors.ts`; the values are the `--m-*` tokens in `styles.css` (light and dark) |
| What the dashboard is sent | `/api/dashboard` in `workers/app/src/index.ts`; `Dashboard` in `apps/web/src/api.ts` |
| The coach's review on the page | `saveReview` / `latestReview` in `coach.ts`; the `save_review` tool; `Coach` in `components/Analysis.tsx` |
| How a set is matched to a lift, or how a swap behaves | `logLift` and `swapExercise` in `coach.ts` |
| What happens on a fixed weekday | a row in `weekly_fixtures` (a migration; there is no tool for it yet) |
| How long he gives a program week | `programs.cycle_days` (10) |
| What a program may contain | `programImportSchema` in `coach.ts`; `scripts/sample-program.json` shows the shape |
| How a book is split into pages and numbered | `scripts/parse-pdf.py` |
| A trusted website | scrape it as "Loading a program or the library" says, have the AI write a parser for its layout, load it as its own document, and name it in `INSTRUCTIONS` if the chatbot should prefer it for some questions |
| How much whole-page text one search sends back | `WHOLE_PAGES_BUDGET` in `packages/core/src/library.ts` |
| How the library is searched | `searchLibrary` in `packages/core/src/library.ts` (with tests) |
| How the next session looks on the page | `components/NextLift.tsx`, `lib/lifts.ts`, the `.next` / `.lift` rules in `styles.css` |
| What the chatbot is told about how the owner works | `INSTRUCTIONS` at the top of `workers/mcp/src/tools.ts` (every chat reads it when it connects) |
| A chatbot tool | `workers/mcp/src/tools.ts`; add a check to `scripts/oauth-smoke.ts` |
| What a write tells the chatbot afterwards | the `receipt` and `url` each write tool returns (`saveReceipt` in `tools.ts`, with a test) |
| A new API route | `workers/app/src/index.ts` calling a core function; add the call in `apps/web/src/api.ts` |
| Which rows the page shows, their order and names | `FIELDS` in `packages/core/src/health.ts` |
| Which days count toward a row's line and averages | `measures` in `apps/web/src/lib/measures.ts` (with tests beside it) |
| How a workout is named and its numbers read (minutes, miles) | `activityName`, `duration`, `miles` in `apps/web/src/lib/measures.ts` |
| How a table, its small lines or the workout list looks | `components/Numbers.tsx`, `Lifts.tsx`, `Workouts.tsx`, `Spark` in `ui.tsx`, and the `.table` / `.spark` / `.rows` rules in `styles.css` |
| Who may sign in | the "Only the owner" policy on **both** Access apps ("Health" and "Health chatbot sign-in"), **and** the `OWNER_EMAIL` secret on **both** Workers. All four must agree |
| How the login is checked | `packages/core/src/access.ts` (with tests) |
| What the Allow / Deny page says | `workers/mcp/src/authorize.ts` |
| When the backup runs | `triggers.crons` in `workers/app/wrangler.jsonc` (UTC) |
| How many backups are kept | `BACKUPS_KEPT` in `packages/core/src/backup.ts` |
| What the backup file contains | `dumpSql` in `packages/core/src/backup.ts` (with tests that rebuild a database from the file) |
| What the page says about backups | `apps/web/src/lib/backupLine.ts` (with tests beside it) |
| Colors, type, spacing, motion | the tokens and notes at the top of `apps/web/src/styles.css` |
| What the browser is allowed to load | the `Content-Security-Policy` header in `workers/app/src/index.ts` |
| His time zone | `TIMEZONE` in `packages/core/src/health.ts` (New York) |

## The chatbot

This is the face that matters most. Everything is in `workers/mcp/src/tools.ts`.

- **Standing instructions** (`INSTRUCTIONS`): sent to every chat when it connects. They say the
  page is the record and is read first; to report numbers plainly without advice unless he asks;
  to answer every change with one line; never to estimate or fill a gap; never to count today
  (or an incomplete day's food) in an average; and the routine for "update my health page":
  1. `get_health_data` with no arguments: today's date and `latest_date`;
  2. from Apple Health, for `latest_date` through today (the last 30 days if nothing is saved),
     daily statistics: the **sum** of the cumulative types and the **average** of the discrete
     ones, plus the workout samples;
  3. `save_health_data` once, with everything **copied as Apple Health returned it**;
  4. the one-line receipt and the link.
  If the chat cannot read Apple Health it says so and saves nothing. A weight he says himself
  goes in `texted_weighins`.
  The second half makes it his coach: sessions take turns and he is never "behind"; how to answer
  "what are my lifts today" (rest day or basketball first, then each lift with last time, the
  suggestion as given, and the video link); that every session is done unless he says otherwise;
  how to fit lifts to "I have 30 minutes" and leave the session in progress; out of order;
  skipping only on his explicit word; undo; laying out the forecast and saving the bike days he
  picks; to log sets as he says them; standing swap against one-day change; never to invent what a source says (look it up in his library, give the page or the article's title and link); to keep his notes
  in his words; and how to do the weekly review, the one place it offers a view unasked, and to save that
  review with `save_review` afterwards.
- **14 tools.**
  - `get_health_data` (read): a range of days (14 by default), the workouts, every lift with its
    sets, and the journal. A missing number is left out so it cannot be mistaken for zero; today
    is marked `partial` and doubtful food days `incomplete`. It also returns `trends`: the same
    worked-out sentences the dashboard shows for that stretch, so the coach's numbers agree with
    the page's. This is the data for a weekly review.
  - `save_health_data` (write): `statistics` (one entry per data type, each with the rows Apple
    Health returned: `period_start`, `sum` or `average`, `unit`), `workouts` (samples as
    returned: `{ start, end, value: { workout } }`), `texted_weighins`, and `from` / `to`, the
    range the chatbot asked Apple Health for (what lets a deletion there clear a number here). Extra fields in a row
    or a sample are ignored, so the chatbot can paste what it got. If anything in the call is
    wrong, nothing is saved and the error says what to fix.
  - `coach_brief` (read): the session that is up (or, with `session`, another owed one) with, for
    each lift, the prescription, what he did last time, the suggested weight, a rough time, the
    video link and what is already logged; the queue of sessions owed; the program week so far;
    rest day, basketball; the next seven days with forecast and bike days; recent workouts; a
    week of his notes. Answers "what are my lifts today", "I have 30 minutes", "which days
    should I bike".
  - `log_lift` (write): the sets he did, as he says them; `session` to do one out of order;
    `finished: true` only when he says the session is done.
  - `skip_session` (write): only on his explicit say-so.
  - `undo_last` (write): takes back the chatbot's last change, whole.
  - `save_review` (write): saves the review the coach just gave, so the dashboard shows it.
  - `swap_exercise` (write): a standing swap, or his pick for a weak-point slot.
  - `set_week_plan` (write): the days he chose to bike (or just how many), and a note.
  - `add_journal` (write): a note or journal entry, in his words.
  - `coach_library` (read): list the documents in the library, search them (all, or one
    document), or read a page or an article whole. An article comes back with its `url`.
  - `set_macro_targets` (write): a check-in from his food app, numbers copied exactly; the same date again
    replaces it.
  - `get_macro_targets` (read): the targets now and every check-in, or those in a range.
  - `read_me_first` (read): returns `INSTRUCTIONS`, for a chat app that does not pass a server's
    instructions to its model (added for Grok, 2026-11-16; Claude does not need it).
- **Receipts.** Every write returns `receipt` (one plain line, e.g. "Saved Nov 13 to Nov 15:
  daily numbers for 3 days, 2 weigh-ins, 4 workouts (1 new).") and `url`.

**The server is the product; chat apps are interchangeable.** His words (2026-11-16): "the
goal of this is really to have all my data on the server and in the SQLite database through
Cloudflare, and then I can go use whatever tool that I want. If I switch to ChatGPT... I would
just add the MCP connector to that... It's not dependent on my chat history. Everything is
stored on my own server... Rules get updated and stuff through that." So: keep every rule, every
piece of arithmetic and everything worth remembering on the server (the tools, `INSTRUCTIONS`,
the database), never in one app's settings or memory, and never assume the app is Claude. If
another app's Apple Health tool returns a different shape, make `save_health_data` accept it on
the server rather than asking the app to reshape numbers.

**More than one chat app.** He also uses Grok (2026-11-16: "I want to make sure that it's kind
of flawless between me using Claude and me using Grokbot or whatever"). The server is not tied
to Claude: any app that speaks MCP with OAuth can connect, each registers itself, and its changes
are recorded as `mcp:<app>` (undo works from any of them). What makes it seamless:
- The record is the shared memory; the instructions say so, and to read it before answering.
- Only an app on his iPhone with an Apple Health tool can sync (Claude can; ChatGPT may). Any
  other app says so and sends him there to sync; everything else (coaching, logging, planning, targets from a screenshot,
  reviews, the library) works the same.
- An app that does not pass the server's instructions to its model has `read_me_first`.
- **Grok:** at grok.com/connectors in a browser, New Connector, Custom, paste
  `https://health-mcp.YOUR-SUBDOMAIN.workers.dev/mcp`, sign in with the PIN, press Allow. If it
  fails, set `DEBUG_LOG` (below) and look at what Grok asked for. Grok also lets him give a connector its own instructions; leave those empty so the
  server's own are used.

**Connecting Claude to it** (The owner does this once): at claude.ai/settings/connectors in a
browser, add a custom connector with the address
`https://health-mcp.YOUR-SUBDOMAIN.workers.dev/mcp`, sign in with the one-time PIN, press
Allow. It then appears in the Claude app on his phone as well. (On the dashboard in Nov 2026 the
desktop app's "Add custom connector" dialog failed and the website worked.) Chat apps cache a
server's tool list and instructions; after a deploy he may need to start a new chat.

If a save fails, the error text the chatbot shows says which rule it tripped. A chat that was
open before a deploy keeps the old tool list and instructions; a new chat picks up the current
ones.

To see what a chat app is asking for when it will not connect, set `DEBUG_LOG` to `"1"` in
`workers/mcp/wrangler.jsonc`, deploy, and read the `debug:*` rows in `oauth_kv`. Set it back.

## How the page is put together

**The bar.** On 2026-11-16 he looked at the first version (one long scroll of tiles and small
charts) and said: "It looks like a basic amateur did it", with two screenshots of the
Searchable analytics dashboard as what good looks like. The page was rebuilt to that standard:
a frame with sections, and on each page a few large cards, each one idea. Keep it there. Do not
go back to rows of small tiles or a single long scroll.

**The frame** (`App.tsx`): on a desktop a sidebar (the name, the six sections, the backup note
and "Back up now", his name at the foot); on a phone the name and a row of tabs instead. Each
page has its title, the date, and the range picker ("Last 30 days", "Last 90 days", "Last year";
remembered in the browser; it scopes every number on every page). One request feeds every page
(`/api/dashboard?days=30|90|365`); while a new range loads the old one stays, dimmed.

**A card** (`components/ui.tsx`): a header row (icon, title, "· what it shows", and on chart
cards a chart/table switch on the right), a hairline, the body, and a footer strip saying what
the card covers (and its change as a small chip). A chart card's body is the headline number
large with its change beside it, the legend when there is more than one series, and the chart,
which grows to fill the card when the card beside it is taller. Tables run edge to edge.

**The pages** (`pages.tsx`):

1. **Overview** (once this week has food logged, **Today** against the targets sits beside
   **Calories** after Up next and Week ahead): the **Coach** card across the top (a ring of program sessions done out of
   all of them, `programProgress`, beside the latest review the coach saved, with a strip of
   the program's ten weeks under it); **Up next**
   beside **Week ahead**; **Your numbers** (every headline number as a table row: now, change,
   a small line; the name links to its page) beside **Weight**; **Calories** beside **Steps**;
   **Training** beside **Resting heart rate**; **Trends** across the bottom. On a phone Up
   next and Week ahead come first.
2. **Training**: Up next beside Week ahead; **Lifts** across (a table: latest, best, change
   since the first time, days, a small line; a row opens to its days); Training beside
   **Workouts**.
3. **Body**: Weight large; Resting heart rate beside VO2 max.
4. **Food**: **Today** beside Calories; **This week** across; Protein, Carbs, Fat and Fiber two
   across; **Target check-ins** across. Without targets: Calories large, then the four.
5. **Activity**: Steps beside Active calories; Training beside Workouts.
6. **Journal**: the Coach card; the **Journal** beside Trends.

What each card holds:
- **Up next**: the session's name and where it falls ("Week 3 · session 4 of 5 · day 11 of
  about 10"), one line only when it matters (a session started, a rest day, basketball, a
  deload week), then a row per lift: the lift (his swap if he has one), sets x reps, and the
  weight to aim for today; once logged, a check and what he did. Pressing a lift opens it in
  place: why that weight, last time, warm-up sets, RPE, rest, about how long, the last-set
  technique, the program's cue, the substitutions, and a "Watch how to do it" button.
- **Week ahead**: today and six more days, each with its plan in time order: an icon and
  colour per activity, the time of day, and for a lifting day the session that falls there with
  its program week, lifts and minutes ("Full Body #1 · Morning · week 1 · 6 lifts · about 63
  min"); basketball on Thursdays; "Rode" once Apple Health shows it. On the right the weather
  icon, the chance of rain when 20% or more, and the high (the words only on wide cards).
- **Weight** and **Resting heart rate**: each reading a faint dot, the 7-day average the line.
  **Calories, Protein, Carbs, Fat, Steps, Active calories**: a bar per day for 30 days, per
  week for 90, per month for a year (the average per day). **VO2 max**: each reading joined by
  a line. **Training**: days trained per week (or month), stacked by kind: lifting, rides,
  basketball, other. Every chart has values on hover, touch and the arrow keys, and the table
  switch. A chart with nothing to draw is left out.
- **Trends**: the sentences from `insights.ts`. **Coach**: the review shown as written
  (paragraphs, and "- " lines as a list; never treated as HTML).
- **Journal**: the last 30 days, newest first, the day said once per day.

**Which days count** (the spec's rules 3 and 5, in `lib/measures.ts`): today's running totals
are not drawn or averaged; an incomplete day's food is not drawn or averaged. Such days appear
in a chart's table, marked "so far" or "incomplete, not counted". Tiles, charts and trends all
use the same rule.

**The look** (the notes at the top of `styles.css` are the design system):

- Quiet chrome so the data is the loud thing: neutral greys, hairline borders, white cards on a
  near-white page, one accent (green) for data and progress. Light and dark designed together.
- **Colour.** He asked for more ("it should have some color to it... it looks flat and
  boring", 2026-11-16). Each measure has its own colour everywhere it appears (weight blue,
  calories orange, protein violet, carbs amber, fat teal, steps emerald, active calories rose,
  resting heart rate pink, VO2 max indigo, lifting green, rides sky; `lib/colors.ts`, the
  `--m-*` tokens): its card's icon tile, its chart (gradient bars, a soft fill under lines), its
  dot and small line in "Your numbers". Other cards have one too (coach violet, up next green,
  this week sky). Weather words get a coloured icon. Cards sit on a soft shadow. A change is green when good and red
  when bad only where that does not depend on his goals; food and weight changes stay ink.
  The first owner is not colour-blind; if the new owner is, check the measure colours.
- Type: one typeface, the system font. 15 body, 24 page titles, 32 headline numbers.
- Every control has hover, pressed, focus and disabled states. Reduced motion is respected.
- The page cannot change anything except "Back up now" and the range. He works through his
  chatbot.
- **Two screens matter: his iPhone Pro Max (430 points wide) and a desktop** ("Just needs to
  be mobile friendly on my iPhone Max and a desktop", 2026-11-15). On the phone: one column,
  tabs under the name, nothing scrolls sideways, and everything he can tap is at least 44
  points tall (the `@media (pointer: coarse)` rules). The sidebar shows from 1024px; cards go
  two across from 900px (three for `.cols-3` from 1200px).
- **Class names can clash with Tailwind.** Tailwind makes a style for any class name it knows
  (`ring` draws an outline, `collapse` sets visibility, `table`, `grid`). Ours are unlayered,
  so they win where both set the same property, but anything ours leaves unset comes from
  Tailwind. A stray outline around the ring was exactly this (`.ring` was renamed
  `.progress-ring`), and so was "Basketball" floating to the bottom of the screen (a label
  class `fixed` is Tailwind's `position: fixed`; the labels are now `tag-ride`, `tag-fixed`,
  `tag-done`). Before naming a class, make sure it is not a Tailwind utility.

**To look at a change:** run both Workers locally, load a program
(`scripts/import-program.ts scripts/sample-program.json --local`), fill them with `scripts/seed-local.ts` (four
months of made-up numbers, lifts, notes and a review), and take screenshots with the Playwright
preinstalled in the Claude Code cloud sandbox: a desktop (1440 wide) and the iPhone Pro Max
(Playwright's `iPhone 15 Pro Max`), light and dark, every page, each
range, a chart hovered and as a table. Local `wrangler dev` cannot reach the Weather Service, so
the week ahead shows no forecast unless a row is put in `weather_cache` by hand.

## Backups and restore

**First line: the nightly copy in R2.** Every night at 08:15 UTC (3:15 AM in New York in
winter, 4:15 AM in summer) the page Worker's timer runs `runBackup`
(`packages/core/src/backup.ts`):

1. reads every table and writes one `.sql` file that rebuilds the database from nothing
   (tables, rows, indexes, and `d1_migrations` so a restored database knows its migrations);
2. puts it in the private bucket `health-backups` as `backups/<UTC time>.sql`;
3. checks the file arrived whole, then deletes the oldest so the newest 30 remain;
4. adds a row to `backup_runs` saying how it went. A failure is recorded there too, and the
   page's backup line says so.

"Back up now" on the page does the same thing on demand (`POST /api/backup`). It counts toward
the 30.

The bucket has no public address (r2.dev access is off and there is no custom domain). Only the
Worker and the owner's Cloudflare account can read it. The copy includes `oauth_kv` (the chatbot's
sign-ins, tokens only as hashes) and `audit_log`.

**Second line: D1 Time Travel.** Point-in-time restore to any minute in the last 30 days on the
Workers Paid plan (7 days on Free).
`npx wrangler d1 time-travel info health` shows the current bookmark;
`npx wrangler d1 time-travel restore health --timestamp=<ISO time>` restores. It replaces the
whole database, so press "Back up now" first.

**To restore from a nightly copy** (needs `CLOUDFLARE_API_TOKEN`). Work in a scratch folder
outside the repo so the file can never be committed:

```bash
# 1. See which copies exist (newest last).
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/r2/buckets/health-backups/objects"
# 2. Download one.
npx wrangler r2 object get "health-backups/backups/<name>.sql" --remote --file /tmp/restore.sql
# 3. Load it into a NEW, empty database and look at it before trusting it.
npx wrangler d1 create health-restored
npx wrangler d1 execute health-restored --remote --file /tmp/restore.sql
# 4. Point both Workers at it: put the new database's id and name in workers/app/wrangler.jsonc
#    and workers/mcp/wrangler.jsonc (and the name in package.json's db:migrate scripts and
#    deploy.yml), then deploy.
# 5. Delete /tmp/restore.sql.
```

Never load a backup file over the live database: the file creates tables, so it only loads into
an empty one. This restore path was tested end to end on 2026-11-15 (a copy made by the deployed
Worker was loaded into a fresh D1 database and matched), before the health tables existed; test
it again once there is real data in them.

## Names (never the secret values)

| Thing | Name |
| --- | --- |
| The page | https://health.YOUR-DOMAIN.com (custom domain, `routes` in `workers/app/wrangler.jsonc`; zone `YOUR-DOMAIN.com`). There is no workers.dev address |
| Page Worker | `health` |
| Chatbot Worker | `health-mcp` → https://health-mcp.YOUR-SUBDOMAIN.workers.dev/mcp. On workers.dev on purpose, like the dashboard's: that is the address confirmed to work with Claude's connector, and no zone setting can get in the way of the chat app's requests. Moving it would mean re-adding the connector in every chat app |
| D1 database | `health` (id in both `wrangler.jsonc` files) |
| R2 bucket | `health-backups` (private; binding `BACKUPS` on the page Worker only). `backups/` holds the nightly copies (only these are pruned); `sources/` holds the original program spreadsheet and book PDFs he uploaded |
| Cloudflare account | id in both `wrangler.jsonc` files (`account_id`). Not a secret |
| Cloudflare Access | Zero Trust team `YOUR-TEAM`, login by one-time PIN. App **"Health"** covers `health.YOUR-DOMAIN.com` (its AUD is the page Worker's `ACCESS_AUD`). App **"Health chatbot sign-in"** covers only `health-mcp.YOUR-SUBDOMAIN.workers.dev/authorize` (its AUD is the chatbot Worker's `ACCESS_AUD`); the rest of the chatbot Worker is deliberately not behind Access, because chat apps cannot pass a PIN. Both: policy "Only the owner" (his email), 30-day sessions |
| Page Worker vars | `ENVIRONMENT`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
| Chatbot Worker vars | `ENVIRONMENT`, `DEBUG_LOG`, `APP_URL`, `PUBLIC_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
| Worker secrets | `OWNER_EMAIL` on each Worker (the allowed login email; comma separated if ever more than one) |
| GitHub Actions secrets | `CLOUDFLARE_API_TOKEN` only (the Edit Cloudflare Workers template plus D1 Write and R2 Edit, zone YOUR-DOMAIN.com; see SETUP.md). If it is ever revoked or expires, deploys stop with a Cloudflare error; make a new one the same way |
| Cloudflare API token permissions | Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Access: Apps and Policies Edit, Account Settings Read; for the custom domain: Zone Edit, DNS Edit, Workers Routes Edit |

Worker secrets are set with `wrangler secret put NAME -c <worker>/wrangler.jsonc` and are never
committed. To sign every chat app out, delete all rows from `oauth_kv`.

## Running locally

```bash
npm install
npm run db:migrate:local
npm run build:web                       # builds apps/web and embeds it into the page Worker
cd workers/app && npx wrangler dev --local-upstream localhost:8787 --var ENVIRONMENT:local --test-scheduled
# http://localhost:8787  (a local database and a local pretend bucket; nothing real is touched)
# (--local-upstream is needed because of the custom domain: without it the Worker sees the
#  request as coming for health.YOUR-DOMAIN.com and answers "Access is not configured".)
curl "http://localhost:8787/__scheduled?cron=15+8+*+*+*"     # runs the nightly backup now, locally

# The chatbot Worker against the same local database (its own debugger port, or it fails with
# "Address already in use"):
cd workers/mcp && npx wrangler dev --port 8788 --inspector-port 9240 --persist-to ../app/.wrangler/state \
  --var ENVIRONMENT:local --var PUBLIC_URL:http://localhost:8788 --var MCP_TOKEN:testtoken
npx tsx scripts/oauth-smoke.ts          # the whole chat-app sign-in, then save and read a pull
npx tsx scripts/seed-local.ts           # a month of made-up data, to look at the page
```

`oauth-smoke.ts` saves a made-up day (2001-01-01), so on a second run against the same local
database its receipt check reports the workout as "0 new"; that is the dedupe working.

The login check is skipped only when `ENVIRONMENT=local` **and** the request comes from
localhost. For frontend work with hot reload run `npm run dev:web` (Vite proxies `/api` to 8787).

## Deploying

The owner asked (2026-11-15) for `main` to exist and for GitHub to deploy on its own. A push to
`main` runs `.github/workflows/deploy.yml`: install, build, typecheck, lint, test, then apply D1
migrations and deploy both Workers. The deploy steps run only when the `CLOUDFLARE_API_TOKEN`
repository secret exists (it does, since 2026-11-16); without it the run ends with the notice
"Not deployed". Work on a branch, run the checks, then push `main`, and check the Actions run
finished. A change only to `.md` files does not start a run; the workflow can also be started by
hand (`workflow_dispatch`).

By hand, from a session that has the Cloudflare token: `npm run deploy` (builds the page, applies
migrations, deploys both Workers).

In the Claude Code cloud sandbox, set `CLOUDFLARE_API_TOKEN` to any placeholder value: the
environment's proxy swaps in the real token. That proxy is also **why the frontend is embedded
instead of using Workers static assets**: static asset uploads use a one-time token in the
`Authorization` header, the proxy overwrites it, and the upload fails with 401.

**Checking a deploy without his login.** Nothing can get past the sign-in without the owner, but a
session can confirm the walls are up:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://health.YOUR-DOMAIN.com/api/status
# 302 https://YOUR-TEAM.cloudflareaccess.com/cdn-cgi/access/login/health.YOUR-DOMAIN.com?...
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://health-mcp.YOUR-SUBDOMAIN.workers.dev/mcp
# 401
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://health-mcp.YOUR-SUBDOMAIN.workers.dev/authorize?response_type=code&client_id=x"
# 302 https://YOUR-TEAM.cloudflareaccess.com/cdn-cgi/access/login/health-mcp.YOUR-SUBDOMAIN.workers.dev?...
```

Anything else (a 200 above all) means a door is open: stop and fix that before anything else.
In a Claude Code cloud session, the requests are blocked until both hosts are on the
environment's allowed list. To see the
page itself or the connector working, ask him.

## Rolling back a deploy

`npx wrangler deployments list -c workers/app/wrangler.jsonc` then
`npx wrangler rollback <version-id> -c workers/app/wrangler.jsonc` (same for `workers/mcp`).
Rolling back code does not roll back the database; migrations only move forward.

## Known limitations

- **Undo only goes backwards from the latest change.** To remove something older, the changes
  after it have to be undone first (or it needs a direct database change).
- **Undoing an Apple Health save removes the rows it added** (the spec's tables have no
  `deleted_at`). The audit row still holds them.
- **The forecast works from the deployed Worker** (a full seven days was in `weather_cache`
  on 2026-11-15). If the week ahead ever shows no weather, look at that row and at the
  Worker's logs. The National Weather Service asks callers to
  name themselves; the request sends the generic name "personal-health-page".
- **The forecast is for New York (Central Park)** whatever he is doing or wherever he is, and
  covers seven days; a day beyond that has none.
- **A lift's time is a rough guess** from set counts and rest ranges; supersets are counted as
  if done separately.
- **The suggested weight knows only the last time.** It does not look at RPE, at a run of
  stalled weeks, or at the intensity techniques. Rep schemes it cannot read ("5,4,3+",
  "8-10 + 4-6", "4, 6, 8") get "match it and try to beat it by a rep".
- **A swap applies to every week the exercise appears in**, including the second block. A swap
  to a lift the program never mentions has no video link.
- **Library search is literal.** Every word must be on the page; a PDF whose headings are
  letter-spaced ("T h e  T r a i n i n g") will not match them.
- **A website loaded into the library is a copy** from the day it was scraped. Nothing
  refreshes it. The date on an article is whatever the page showed.
- **The briefing is about 7 KB of text**, mostly the program's notes for each lift.
- **Nothing removes a workout.** If Apple Health holds a bogus one it stays until a delete is
  built (as a `deleted_at`-style mark, not a hard delete; that would be a column the spec does
  not have, so ask him first).
- **A re-pulled workout replaces its row with what was sent**, so a field Apple Health no longer
  returns becomes empty. `workout_stats` rows are only added or updated, never taken away.
- **The incomplete flag is only as good as its two tests.** A day he really ate 1,400 kcal is
  flagged; a forward-filled day that happens to differ by a calorie is not. Both are the spec's
  rules as written.
- **A weight deleted in Apple Health goes only when a pull covers its day.** A pull runs from the
  newest saved date to today, so a deletion further back stays until a pull is asked for that
  range ("update my health page for the last two months").
- **A weigh-in he texts never replaces an Apple Health one for the same day**, even when the
  Apple Health one is the mistake. Fixing that takes a direct database change for now.
- **A period_start that is not his local midnight is refused.** If he travels and his phone
  reports buckets on another time zone's day, pulls will fail with a message that says so, until
  he is home or `TIMEZONE` handling is widened.
- **The page looks back a year at most.** Older days are in the database and the chatbot can
  read any range.
- **Goals cover food and weight only** (from his food app's check-in). See "Not built yet".
- **The dashboard request does a few dozen database reads** (the briefing looks up each lift's
  last time). Fine now; if the page feels slow, that is where to look.
- **Workout heart rate, calories and temperature are stored but not shown** on the page.
- **The lifts line is the heaviest set of the day**, not volume or an estimated max.
- **A person newly allowed in Access needs both Workers' `OWNER_EMAIL` changed too.**
- **The backup reads the whole database into the Worker's memory and uses about three database
  queries per table plus one per 1,000 rows.** Fine for years of daily rows. If something bulky
  is ever stored, move the backup to a streamed, multi-part upload and watch the per-request
  query limit (50 on the Workers Free plan, 1,000 on Paid).
- **A single value over about 100 KB may not restore**, because D1 limits the size of one SQL
  statement. Keep files and scans out of the database.
- **Two backups in the same second share a name**; the second replaces the first.
- **Tables that point at each other in a circle** rely on the `PRAGMA defer_foreign_keys` line at
  the top of the backup file when restoring. Parent and child tables (`workouts` and
  `workout_stats`) are written parents first and need nothing special.
- **Writes are not transactional.** D1 has no BEGIN/COMMIT from Workers. Everything in a save is
  checked before the first write, but a failure partway through the writes would leave the
  earlier ones in place; pulling again repairs it.
- **Backup times on the page are in the browser's time zone.** Days are New York days.
- **`backup_runs` and `audit_log` are never trimmed.**
- **Sessions last 30 days**, the same as the dashboard. For a shorter one, change
  `session_duration` on the Access apps.
- **Chat apps cache the tool list and instructions.** After a deploy he may need a new chat.
