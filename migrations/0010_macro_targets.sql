-- 0010: macro targets from his food app, and fiber.
-- The owner's brief "Health Dashboard: Macro Targets and Tracking" (2026-11-16). After each check-in
-- in his food app (Carbon Diet Coach, MacroFactor or similar) he sends Claude a screenshot and the targets are saved here. The dashboard and
-- the chatbot then set each day's food against the targets in effect that day.
--
-- One row per check-in. A row holds until the next one replaces it: the targets for any date are
-- the row with the latest effective_date on or before that date (packages/core/src/macros.ts).
-- Sending the same check-in date again replaces that row (one row per date).
CREATE TABLE macro_targets (
  id                    TEXT PRIMARY KEY,
  effective_date        TEXT NOT NULL UNIQUE,      -- the check-in date, his local date
  kcal                  INTEGER NOT NULL,
  protein_g             REAL NOT NULL,
  carbs_g               REAL NOT NULL,
  fat_g                 REAL NOT NULL,
  fiber_min_g           REAL NOT NULL DEFAULT 30,
  fiber_max_g           REAL NOT NULL DEFAULT 40,
  source                TEXT NOT NULL DEFAULT 'food app',
  trend_weight_lb       REAL,                      -- from the check-in screen, when shown
  goal_rate_lb_per_week REAL,                      -- e.g. -1.5
  note                  TEXT,                      -- e.g. "Held steady, not enough clarity to adjust"
  created_at            TEXT NOT NULL,
  updated_at            TEXT
);

-- Fiber joins the daily numbers: Apple Health's dietaryFiber, the day's sum in grams.
ALTER TABLE daily_metrics ADD COLUMN fiber_g REAL;
