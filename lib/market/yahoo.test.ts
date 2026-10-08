import { describe, expect, it } from "vitest";
import { parseChart, parseTargets } from "./yahoo";

describe("parseChart", () => {
  it("prefers adjusted closes and drops gaps", () => {
    const points = parseChart({
      chart: {
        result: [{
          timestamp: [1, 2, 3],
          indicators: { adjclose: [{ adjclose: [10, null, 12] }], quote: [{ close: [11, 11, 13] }] },
        }],
      },
    });
    expect(points).toEqual([{ t: 1000, close: 10 }, { t: 3000, close: 12 }]);
  });

  it("falls back to raw closes and survives an error payload", () => {
    expect(parseChart({ chart: { result: [{ timestamp: [5], indicators: { quote: [{ close: [7] }] } }] } })).toEqual([{ t: 5000, close: 7 }]);
    expect(parseChart({ chart: { result: null, error: { description: "No data found" } } })).toEqual([]);
  });
});

describe("parseTargets", () => {
  it("maps financialData fields", () => {
    const t = parseTargets({
      quoteSummary: {
        result: [{ financialData: { targetLowPrice: { raw: 215 }, targetMeanPrice: { raw: 328 }, targetMedianPrice: { raw: 340 }, targetHighPrice: { raw: 405 }, numberOfAnalystOpinions: { raw: 39 }, recommendationKey: "strong_buy" } }],
      },
    });
    expect(t).toEqual({ low: 215, mean: 328, median: 340, high: 405, analysts: 39, rating: "strong buy" });
  });

  it("returns null when there is no coverage", () => {
    expect(parseTargets({ quoteSummary: { result: [{ financialData: { recommendationKey: "none" } }] } })).toBeNull();
    expect(parseTargets({})).toBeNull();
  });
});
