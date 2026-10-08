import { describe, expect, it } from "vitest";
import { addTradingDays, nearestIndex, niceTicks, scale, tickLabel } from "./chart";

describe("niceTicks", () => {
  it("picks round steps that cover the range", () => {
    expect(niceTicks(103, 187, 4)).toEqual([100, 125, 150, 175, 200]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("pads a flat series", () => {
    const t = niceTicks(50, 50);
    expect(t[0]).toBeLessThan(50);
    expect(t[t.length - 1]).toBeGreaterThan(50);
  });
});

describe("scale and nearestIndex", () => {
  it("maps linearly and finds the closest x", () => {
    expect(scale(0, 10, 0, 100)(5)).toBe(50);
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([0], 99)).toBe(0);
  });
});

describe("addTradingDays", () => {
  it("skips weekends", () => {
    const fri = Date.UTC(2026, 9, 9); // Fri 9 Oct 2026
    expect(new Date(addTradingDays(fri, 1)).getUTCDay()).toBe(1);
    expect(new Date(addTradingDays(fri, 5)).toISOString().slice(0, 10)).toBe("2026-10-16");
  });
});

describe("tickLabel", () => {
  it("abbreviates large values", () => {
    expect(tickLabel(2_500_000)).toBe("$2.5M");
    expect(tickLabel(25_000)).toBe("$25K");
    expect(tickLabel(1500)).toBe("$1,500");
    expect(tickLabel(7.5)).toBe("$7.5");
  });
});
