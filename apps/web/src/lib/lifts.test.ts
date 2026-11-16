import { describe, expect, it } from "vitest";
import { setsLine, weightText } from "./lifts";

describe("how sets read", () => {
  it("says the weight once when it did not change", () => {
    expect(setsLine([{ weight_lb: 270, reps: 8 }, { weight_lb: 270, reps: 8 }, { weight_lb: 270, reps: 7 }])).toBe("270 lb × 8, 8, 7");
  });
  it("pairs each set with its weight when it changed", () => {
    expect(setsLine([{ weight_lb: 270, reps: 8 }, { weight_lb: 275, reps: 6 }])).toBe("270 × 8, 275 × 6");
  });
  it("handles bodyweight and half-pound steps", () => {
    expect(setsLine([{ weight_lb: null, reps: 9 }, { weight_lb: null, reps: 8 }])).toBe("9, 8");
    expect(weightText(22.5)).toBe("22.5 lb");
    expect(setsLine([])).toBe("");
  });
});
