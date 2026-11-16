-- 0001: the record of each backup.
-- Every night (and whenever "Back up now" is pressed) the Worker writes a copy of this database
-- to the private R2 bucket and adds one row here saying how it went. The page reads the newest
-- rows to show when the last copy was made. See packages/core/src/backup.ts.

CREATE TABLE backup_runs (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,                                  -- ISO time, UTC
  finished_at TEXT NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0, 1)),
  source      TEXT NOT NULL CHECK (source IN ('nightly', 'manual')),
  object_key  TEXT,                                           -- the file in the bucket, when it worked
  bytes       INTEGER,
  table_count INTEGER,
  row_count   INTEGER,
  removed     INTEGER NOT NULL DEFAULT 0,                     -- older copies deleted to keep the newest 30
  error       TEXT                                            -- what went wrong, when it did not work
);

CREATE INDEX backup_runs_by_time ON backup_runs (started_at);
