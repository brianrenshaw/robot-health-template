// How logged sets and weights read on the page.

interface SetLike {
  weight_lb: number | null;
  reps: number | null;
}

/** "275 lb", "22.5 lb". */
export function weightText(lb: number): string {
  return `${Number.isInteger(lb) ? lb : lb.toFixed(1)} lb`;
}

/**
 * Sets on one line: "270 lb × 8, 8, 7" when the weight is the same throughout,
 * "270 × 8, 275 × 6" when it changes, "9, 8" for a bodyweight lift.
 */
export function setsLine(sets: SetLike[]): string {
  if (!sets.length) return "";
  const reps = (s: SetLike) => (s.reps === null ? "?" : String(s.reps));
  const weights = new Set(sets.map((s) => s.weight_lb));
  if (weights.size === 1) {
    const w = sets[0]!.weight_lb;
    return w === null ? sets.map(reps).join(", ") : `${weightText(w)} × ${sets.map(reps).join(", ")}`;
  }
  return sets.map((s) => (s.weight_lb === null ? reps(s) : `${Number.isInteger(s.weight_lb) ? s.weight_lb : s.weight_lb.toFixed(1)} × ${reps(s)}`)).join(", ");
}
