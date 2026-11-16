-- 0006: undo, skipping a session, sets that know their day, chosen bike days, and the forecast.
-- (The owner, 2026-11-15: "We need to build out the weather and me choosing the bike days. We also
-- need, for sure, an undo, and then skipping a session or doing one out of order." And: a
-- workout may be split between two days.)

-- Undo. Everything one request from the chatbot changes shares an `op`, so "undo that" takes the
-- whole thing back together. `undone_at` marks changes that have been taken back.
ALTER TABLE audit_log ADD COLUMN op TEXT;
ALTER TABLE audit_log ADD COLUMN undone_at TEXT;
CREATE INDEX audit_log_by_op ON audit_log (op);

-- Skipping. A program session he has explicitly said he is not doing: a lift_sessions row with
-- skipped_at set and no sets. Nothing is ever skipped by itself.
ALTER TABLE lift_sessions ADD COLUMN skipped_at TEXT;

-- A session can be split over two days, so each set records the day it was done.
ALTER TABLE lift_sets ADD COLUMN date TEXT;
UPDATE lift_sets SET date = (SELECT l.date FROM lift_sessions l WHERE l.id = lift_sets.lift_session_id) WHERE date IS NULL;

-- The days he has chosen to bike (or hike). cancelled_at is set when he changes his mind.
CREATE TABLE planned_days (
  date         TEXT NOT NULL,             -- his local date
  activity     TEXT NOT NULL CHECK (activity IN ('bike', 'hike')),
  note         TEXT,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT,
  PRIMARY KEY (date, activity)
);

-- The last forecast read from the National Weather Service, kept so the page and the coach do
-- not ask for it more than once an hour. One row per place.
CREATE TABLE weather_cache (
  place      TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  body       TEXT NOT NULL                -- the days, as JSON
);
