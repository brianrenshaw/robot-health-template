-- 0003: the daily numbers, and the record of every change.
--
-- daily_numbers: one row per day, one plain column per number. The owner's chatbot copies these from
-- Apple Health on his phone (the site itself never reads Apple Health). A column left NULL means
-- "nothing recorded for that day", never zero. Units are in the column names.
-- The list of columns is mirrored in packages/core/src/days.ts (DAY_FIELDS): keep them in step.

CREATE TABLE daily_numbers (
  day              TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- his local day
  -- food: the day's totals, from the food app by way of Apple Health
  calories         REAL,
  protein_g        REAL,
  carbs_g          REAL,
  fat_g            REAL,
  -- body
  weight_lb        REAL,
  body_fat_pct     REAL,
  -- activity
  steps            INTEGER,
  active_calories  REAL,
  exercise_minutes REAL,
  -- heart
  resting_hr       REAL,   -- beats per minute
  hrv_ms           REAL,   -- heart rate variability, milliseconds
  bp_systolic      REAL,   -- blood pressure, the top number
  bp_diastolic     REAL,   -- blood pressure, the bottom number
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- audit_log: one row per change to a health record: who made it (the page or which chat app),
-- and the row before and after. Every write function in packages/core adds one (recordAudit).
-- It is what an Undo will be built on.
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,            -- "web", or "mcp:claude" for the chatbot
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('create', 'update')),
  before     TEXT,                     -- the row as JSON before the change; NULL when created
  after      TEXT NOT NULL             -- the row as JSON after it
);

CREATE INDEX audit_log_by_time ON audit_log (at);
CREATE INDEX audit_log_by_row ON audit_log (table_name, row_id);
