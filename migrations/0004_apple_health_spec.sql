-- 0004: the tables from the owner's Apple Health data spec (2026-11-15), as written there.
-- The spec describes what the Claude phone app's Apple Health tool returns and how to store it.
-- The rules it sets for writing (local dates, NULL for missing, today is partial, kg to lb, the
-- incomplete flag, no duplicate workouts) are carried out in packages/core/src/health.ts.
--
-- daily_numbers was this project's first guess at the same thing, made earlier the same day. It
-- never held a row and is replaced by daily_metrics and weighins.

DROP TABLE daily_numbers;

-- One row per local date. Wide, because every metric is one number per day.
CREATE TABLE daily_metrics (
  date            DATE PRIMARY KEY,   -- local date, YYYY-MM-DD
  kcal_eaten      INTEGER,            -- dietaryEnergyConsumed
  protein_g       REAL,               -- dietaryProtein
  carbs_g         REAL,               -- dietaryCarbohydrates
  fat_g           REAL,               -- dietaryFatTotal
  active_kcal     INTEGER,            -- activeEnergyBurned
  steps           INTEGER,            -- stepCount
  resting_hr      REAL,               -- restingHeartRate
  vo2max          REAL,               -- vo2Max
  incomplete      BOOLEAN DEFAULT 0,  -- under 1,500 kcal or food app forward-fill
  pulled_at       TIMESTAMP           -- when this row was last refreshed
);

-- Separate, because weight is sparse and has two sources. When a date has both, Apple Health wins.
CREATE TABLE weighins (
  date       DATE PRIMARY KEY,
  lb         REAL NOT NULL,
  source     TEXT NOT NULL,   -- 'apple_health' or 'texted'
  pulled_at  TIMESTAMP
);

CREATE TABLE workouts (
  id              INTEGER PRIMARY KEY,
  local_date      DATE NOT NULL,
  start_utc       TIMESTAMP NOT NULL,
  end_utc         TIMESTAMP NOT NULL,
  activity_type   TEXT NOT NULL,
  duration_sec    REAL,
  distance_m      REAL,
  energy_kcal     REAL,
  indoor          BOOLEAN,
  temp_c          REAL,
  avg_hr          REAL,
  max_hr          REAL,
  source          TEXT DEFAULT 'apple_health',  -- or 'garmin_confirmed'
  UNIQUE (start_utc, activity_type)
);

CREATE INDEX workouts_by_date ON workouts (local_date);

-- Everything in a workout's `statistics` array, not just heart rate.
CREATE TABLE workout_stats (
  workout_id   INTEGER REFERENCES workouts(id),
  sample_type  TEXT,
  unit         TEXT,
  sum          REAL,
  average      REAL,
  min          REAL,
  max          REAL,
  PRIMARY KEY (workout_id, sample_type)
);
