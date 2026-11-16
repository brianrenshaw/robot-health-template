-- The week planner. The owner, 2026-11-16: "i should be able to plan out the entire week like AM -
-- lift, afternoon hike, etc". Until now a week could only hold which days he bikes
-- (planned_days), so his lifting days ended up in the week's note.
--
-- One row per thing planned: a day, a time of day, an activity, and a few words of detail if he
-- gave any ("Riverside Park loop", "10 miles"). A day's plan is replaced as a whole when he
-- changes it; a row taken off is marked deleted_at, never removed (undo puts it back).
-- Which lifting session falls on a planned lifting day is not stored: it is worked out each
-- time from the sessions still owed, in turn (coach.ts planItems), so it never goes stale.
CREATE TABLE plan_items (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,                -- his local date
  slot       TEXT NOT NULL CHECK (slot IN ('morning', 'midday', 'afternoon', 'evening', 'anytime')),
  activity   TEXT NOT NULL CHECK (activity IN ('lift', 'bike', 'hike', 'walk', 'run', 'basketball', 'swim', 'yoga', 'mobility', 'rest', 'other')),
  detail     TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX plan_items_by_date ON plan_items (date);

-- Bike days still planned in the old table become plan items. planned_days is retired: nothing
-- reads or writes it any more; its rows are kept.
INSERT INTO plan_items (id, date, slot, activity, detail, created_at)
SELECT lower(hex(randomblob(16))), date, 'anytime', activity, note, created_at FROM planned_days WHERE cancelled_at IS NULL;
