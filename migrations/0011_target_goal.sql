-- 0011: the goal on a check-in from his food app. The owner, 2026-11-16: keep The food app's start weight and goal
-- weight with every check-in (until now they sat only in a journal note). `goal` is the food app's own
-- words for it, e.g. "fat loss". A check-in sent without them keeps the last ones (macros.ts).
ALTER TABLE macro_targets ADD COLUMN goal TEXT;
ALTER TABLE macro_targets ADD COLUMN start_weight_lb REAL;
ALTER TABLE macro_targets ADD COLUMN goal_weight_lb REAL;
