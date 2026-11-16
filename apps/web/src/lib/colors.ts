// Each measure keeps one colour everywhere it appears: its card's icon, its chart, its row in
// "Your numbers". He asked for colour (2026-11-16: "it should have some color to it... it looks
// flat and boring"), and a colour that means one thing is colour that does work.
//
// The values are CSS variables (--m-*, light and dark, at the top of styles.css). Green and red
// are kept apart from these on purpose: they mean good and bad on a change.

export const MEASURE_COLOR: Record<string, string> = {
  weight_lb: "var(--m-weight)",
  weight: "var(--m-weight)",
  kcal_eaten: "var(--m-calories)",
  protein_g: "var(--m-protein)",
  carbs_g: "var(--m-carbs)",
  fat_g: "var(--m-fat)",
  fiber_g: "var(--m-fiber)",
  steps: "var(--m-steps)",
  active_kcal: "var(--m-active)",
  resting_hr: "var(--m-heart)",
  vo2max: "var(--m-vo2)",
  lift_days: "var(--m-lifting)",
  rides: "var(--m-ride)",
  training: "var(--m-lifting)",
};

/** The colour of a card about something that is not a single measure. */
export const CARD_COLOR = {
  coach: "var(--m-coach)",
  next: "var(--m-lifting)",
  week: "var(--m-sky)",
  numbers: "var(--m-weight)",
  trends: "var(--m-coach)",
  lifts: "var(--m-lifting)",
  workouts: "var(--m-ride)",
  journal: "var(--m-carbs)",
} as const;

export const colorOf = (key: string) => MEASURE_COLOR[key] ?? "var(--c1)";
