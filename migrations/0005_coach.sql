-- 0005: the coach. The lifting program, what the owner actually lifted, the plan for each week,
-- and his journal.
--
-- How the pieces fit (his words, 2026-11-15): the program is a full-body lifting program whose
-- "week" of five sessions he spreads over about 10 days; basketball is on Thursdays; he sets how
-- many days he plans to bike at the start of each week; and he keeps notes and a journal that
-- the coach (his chatbot) reads together with everything else.
--
-- A bought program's text is copyrighted. It lives only
-- in these tables, loaded by scripts/import-program.ts. It is never committed to the repository.

-- A lifting program. One is active at a time (archived_at IS NULL).
CREATE TABLE programs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  notes       TEXT,                       -- the program's own general notes: warm-up, weak points, ...
  cycle_days  INTEGER NOT NULL DEFAULT 10,-- how many days he gives one program week
  created_at  TEXT NOT NULL,
  archived_at TEXT
);

-- One lifting session of the program, in the order they are done: week 1 session 1, 2, ... 5,
-- then week 2 session 1, and so on.
CREATE TABLE program_sessions (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  seq         INTEGER NOT NULL,           -- 1, 2, 3 ... across the whole program
  week        INTEGER NOT NULL,           -- the program's week number
  position    INTEGER NOT NULL,           -- 1 to 5 within the week
  name        TEXT NOT NULL,              -- "Full Body #1", "Arms & Weak Points"
  block       TEXT,                       -- "BLOCK 1: 5-WEEK BUILD PHASE"
  week_note   TEXT,                       -- e.g. the semi-deload instruction for that week
  rest_after  INTEGER NOT NULL DEFAULT 0 CHECK (rest_after IN (0, 1)),  -- a mandatory rest day follows
  UNIQUE (program_id, seq)
);

-- One exercise of a session, as the program prescribes it. Text columns hold the program's own
-- wording ("8-10", "~7-8", "~2-3 min").
CREATE TABLE program_exercises (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES program_sessions(id),
  position      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  technique     TEXT,                     -- last-set intensity technique
  warmup_sets   TEXT,
  working_sets  INTEGER,
  reps          TEXT,
  early_rpe     TEXT,
  last_rpe      TEXT,
  rest          TEXT,
  sub1          TEXT,                     -- substitution option 1
  sub2          TEXT,                     -- substitution option 2
  notes         TEXT,
  video_url      TEXT,                    -- the program's how-to video for the exercise
  sub1_video_url TEXT,
  sub2_video_url TEXT
);
CREATE INDEX program_exercises_by_session ON program_exercises (session_id, position);

-- A standing swap: "my gym has no hack squat, I do the machine squat instead". Wherever the
-- program prescribes `prescribed`, he does `use_instead`, for the rest of the program or until
-- the swap is ended. It is also how he fills a weak-point slot with his pick.
CREATE TABLE exercise_swaps (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  prescribed  TEXT NOT NULL,              -- the exercise name as the program writes it
  use_instead TEXT NOT NULL,
  note        TEXT,                       -- why, in his words
  created_at  TEXT NOT NULL,
  ended_at    TEXT                        -- set when he goes back, or swaps to something else
);
CREATE INDEX exercise_swaps_by_program ON exercise_swaps (program_id, prescribed);

-- A lifting session he did. finished_at set means that program session is done and the next one
-- is up. program_session_id is NULL for lifting outside the program.
CREATE TABLE lift_sessions (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,       -- his local date
  program_session_id TEXT REFERENCES program_sessions(id),
  notes              TEXT,
  finished_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX lift_sessions_by_date ON lift_sessions (date);

-- One set he did. `exercise` is what he actually did: the prescribed exercise, one of its
-- substitutions, or his pick for a weak-point slot.
CREATE TABLE lift_sets (
  id              TEXT PRIMARY KEY,
  lift_session_id TEXT NOT NULL REFERENCES lift_sessions(id),
  program_exercise_id TEXT REFERENCES program_exercises(id),  -- which prescribed exercise this set fills, if any
  exercise        TEXT NOT NULL,
  set_number      INTEGER NOT NULL,
  weight_lb       REAL,                   -- NULL for bodyweight or when he did not say
  reps            REAL,
  rpe             REAL,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  UNIQUE (lift_session_id, exercise, set_number)
);
CREATE INDEX lift_sets_by_exercise ON lift_sets (exercise);

-- The plan he sets at the start of a week (weeks start on Monday).
CREATE TABLE week_plans (
  week_start  TEXT PRIMARY KEY,           -- the Monday, YYYY-MM-DD
  bike_days   INTEGER,                    -- how many days he plans to bike this week
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Notes for the day and how he is feeling, in his words. Any number per day.
CREATE TABLE journal_entries (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,               -- his local date
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX journal_entries_by_date ON journal_entries (date);

-- Things that happen on the same weekday every week. 0 is Sunday ... 4 is Thursday.
CREATE TABLE weekly_fixtures (
  weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  activity  TEXT NOT NULL,
  PRIMARY KEY (weekday, activity)
);
INSERT INTO weekly_fixtures (weekday, activity) VALUES (4, 'basketball');  -- "on Thursdays, I play basketball"

-- The coach's reference library: the text of the books and handbooks the owner has supplied (a
-- program's handbook, a training book), one row per page, so the coach can look
-- something up and quote it with its page instead of answering from memory. Copyrighted text:
-- it lives only here, loaded by scripts/import-library.ts, never in the repository.
CREATE TABLE library_pages (
  id        TEXT PRIMARY KEY,
  document  TEXT NOT NULL,                -- the book's title, e.g. "My program handbook"
  page      INTEGER NOT NULL,             -- the page number printed in the book
  section   TEXT,                         -- the chapter the page is in
  body      TEXT NOT NULL,
  UNIQUE (document, page)
);
