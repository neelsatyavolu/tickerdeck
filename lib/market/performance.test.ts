import { describe, expect, it } from "vitest";
import { lastDays, periodReturns } from "./performance";

const DAY = 86_400_000;
const start = Date.UTC(2024, 0, 2, 20);
// Two years of daily points rising 1 per day from 100.
const series = Array.from({ length: 731 }, (_, i) => ({ t: start + i * DAY, close: 100 + i }));

describe("periodReturns", () => {
  it("measures each window from the closest earlier close", () => {
    const rows = Object.fromEntries(periodReturns(series).map((r) => [r.label, r.value]));
    const last = 830;
    expect(rows["1W"]).toBeCloseTo(last / (last - 7) - 1);
    expect(rows["1Y"]).toBeCloseTo(last / (last - 365) - 1);
    expect(rows["3Y"]).toBeNull();
    expect(rows["5Y"]).toBeNull();
    expect(rows.YTD).not.toBeNull();
  });

  it("starts a window at the first point when history begins a few days late (weekly data)", () => {
    const weekly = Array.from({ length: 525 }, (_, i) => ({ t: start + 4 * DAY + i * 7 * DAY, close: 100 + i }));
    const tenYears = [...weekly, { t: start + 3652 * DAY, close: 1000 }];
    const r = periodReturns(tenYears).find((x) => x.label === "10Y")!;
    expect(r.value).toBeCloseTo(1000 / 100 - 1);
  });

  it("uses a live price when given", () => {
    const oneWeek = periodReturns(series, 1000).find((r) => r.label === "1W")!;
    expect(oneWeek.value).toBeCloseTo(1000 / 823 - 1);
  });

  it("orders labels with YTD after 6M", () => {
    expect(periodReturns(series).map((r) => r.label)).toEqual(["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y"]);
    expect(periodReturns([])).toEqual([]);
  });
});

describe("lastDays", () => {
  it("keeps the trailing window", () => {
    expect(lastDays(series, 10)).toHaveLength(11);
  });
});
