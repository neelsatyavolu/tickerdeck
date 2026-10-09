import { describe, expect, it } from "vitest";
import { summarize } from "./overview";

const DAY = 86_400_000;
const start = Date.UTC(2025, 9, 1, 20);
const points = Array.from({ length: 370 }, (_, i) => ({ t: start + i * DAY, close: 100 + i }));

describe("summarize", () => {
  it("returns a 3-month sparkline, returns and the 52-week range", () => {
    const o = summarize(points);
    expect(o.spark).toHaveLength(63);
    expect(o.spark.at(-1)).toBe(469);
    expect(o.high52).toBe(469);
    expect(o.low52).toBe(104); // only the last 365 days count
    expect(o.r1m).toBeCloseTo(469 / 439 - 1);
    expect(o.r1y).toBeCloseTo(469 / 104 - 1);
  });

  it("handles an empty series", () => {
    expect(summarize([])).toEqual({ spark: [], r1m: null, r3m: null, ytd: null, r1y: null, high52: null, low52: null });
  });
});
