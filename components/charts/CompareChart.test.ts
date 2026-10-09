import { describe, expect, it } from "vitest";
import { normalize } from "./CompareChart";

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
