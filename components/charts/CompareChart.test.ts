import { describe, expect, it } from "vitest";
import { normalize, spanChanges } from "./CompareChart";

describe("normalize", () => {
  it("indexes each series to its first close and carries values across missing dates", () => {
    const { dates, lines } = normalize([
      { symbol: "A", points: [{ t: 1, close: 100 }, { t: 2, close: 110 }, { t: 3, close: 121 }] },
      { symbol: "B", points: [{ t: 1, close: 50 }, { t: 3, close: 25 }] },
    ]);
    expect(dates).toEqual([1, 2, 3]);
    expect(lines[0].values.map((v) => Number(v?.toFixed(2)))).toEqual([0, 0.1, 0.21]);
    expect(lines[1].values).toEqual([0, 0, -0.5]);
  });
});

describe("spanChanges", () => {
  it("measures each series between two dates, not from the chart start", () => {
    const lines = [{ symbol: "A", values: [0, 0.1, 0.21] }, { symbol: "B", values: [0, null, -0.5] }];
    const out = spanChanges(lines, 1, 2);
    expect(out[0].change).toBeCloseTo(0.1);
    expect(out[1].change).toBeNull();
  });
});
